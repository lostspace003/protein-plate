/* ProteinPlate – client-side app.
 * Calls Microsoft Foundry (Azure OpenAI) Responses API directly from the browser:
 *   POST {endpoint}/openai/v1/responses   header: api-key
 * Credentials are entered by the user at runtime and kept only in browser storage.
 * No secrets are stored in this repository.
 */
(() => {
  "use strict";

  const STORE_KEY = "proteinplate.conn";
  const $ = (id) => document.getElementById(id);

  // ---------- Connection settings (browser-only storage) ----------
  function loadConn() {
    const raw = sessionStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  function saveConn(conn, remember) {
    sessionStorage.removeItem(STORE_KEY);
    localStorage.removeItem(STORE_KEY);
    (remember ? localStorage : sessionStorage).setItem(STORE_KEY, JSON.stringify(conn));
  }
  function clearConn() {
    sessionStorage.removeItem(STORE_KEY);
    localStorage.removeItem(STORE_KEY);
  }
  function normalizeEndpoint(ep) {
    // Accept any pasted Foundry URL (resource endpoint, project endpoint, full "Target URI"
    // with /openai/deployments/...?... etc.) and reduce it to the resource origin.
    const raw = (ep || "").trim();
    try { return new URL(raw).origin; }
    catch { return raw.replace(/\/+$/, ""); }
  }
  function responsesUrl(conn) {
    return `${normalizeEndpoint(conn.endpoint)}/openai/v1/responses`;
  }
  function refreshBanner() {
    const c = loadConn();
    const b = $("connBanner");
    if (c && c.endpoint && c.apiKey && c.deployment) {
      b.className = "banner ok";
      b.innerHTML = `Connected to deployment <strong>${esc(c.deployment)}</strong> at <code>${esc(normalizeEndpoint(c.endpoint))}</code>`;
    } else {
      b.className = "banner warn";
      b.innerHTML = 'Foundry connection not configured. Click <strong>⚙️ Foundry Settings</strong> to add your endpoint, deployment and API key.';
    }
  }

  // ---------- Helpers ----------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const round5 = (n) => Math.round(n / 5) * 5;
  const fmt = (n) => (Math.round(Number(n) * 10) / 10).toString();

  // ---------- Protein requirement calculation ----------
  const ACTIVITY_FACTOR = { sedentary: 0.8, light: 1.0, moderate: 1.2, very: 1.4, athlete: 1.7 };

  function readProfile() {
    const weightRaw = parseFloat($("weight").value);
    const weightKg = $("weightUnit").value === "lb" ? weightRaw * 0.453592 : weightRaw;
    return {
      age: parseInt($("age").value, 10),
      sex: $("sex").value,
      weightKg,
      heightCm: parseFloat($("height").value),
      activity: $("activity").value,
      goal: $("goal").value,
      condition: $("condition").value,
      diet: $("diet").value,
      cuisine: $("cuisine").value.trim(),
      meals: parseInt($("meals").value, 10),
      budget: $("budget").value,
      cookTime: $("cookTime").value,
      allergies: $("allergies").value.trim(),
      notes: $("notes").value.trim(),
    };
  }

  function validateProfile(p) {
    const errs = [];
    if (!(p.age >= 14 && p.age <= 100)) errs.push("Age must be 14–100.");
    if (!(p.weightKg >= 25 && p.weightKg <= 350)) errs.push("Weight looks out of range.");
    if (!(p.heightCm >= 100 && p.heightCm <= 250)) errs.push("Height must be 100–250 cm.");
    return errs;
  }

  function calcProtein(p) {
    const notes = [];
    const bmi = p.weightKg / Math.pow(p.heightCm / 100, 2);
    let refWeight = p.weightKg;
    if (bmi >= 30) {
      const ibw = (p.sex === "male" ? 50 : 45.5) + 0.9 * (p.heightCm - 152.4);
      refWeight = ibw + 0.4 * (p.weightKg - ibw);
      notes.push(`BMI ${fmt(bmi)} ≥ 30, so an adjusted body weight of ${fmt(refWeight)} kg is used instead of total weight.`);
    }

    let factor = ACTIVITY_FACTOR[p.activity] ?? 1.0;
    notes.push(`Activity "${p.activity}" → ${factor} g/kg baseline.`);

    if (p.goal === "lose") {
      factor = Math.min(2.2, Math.max(factor + 0.4, 1.2));
      notes.push(`Fat-loss goal → raised to ${fmt(factor)} g/kg to help preserve muscle.`);
    } else if (p.goal === "gain") {
      factor = Math.min(2.2, Math.max(factor + 0.4, 1.6));
      notes.push(`Muscle-gain goal → raised to ${fmt(factor)} g/kg.`);
    }

    if (p.age >= 65 && factor < 1.0) {
      factor = 1.0;
      notes.push("Age 65+ → minimum 1.0 g/kg to help limit age-related muscle loss.");
    }

    let extra = 0;
    if (p.condition === "kidney") {
      factor = Math.min(factor, 0.8);
      notes.push("⚠️ Kidney disease: capped at 0.8 g/kg. Your nephrologist/dietitian may advise lower — please confirm with them.");
    } else if (p.condition === "pregnant" || p.condition === "lactating") {
      extra = 25;
      notes.push(`${p.condition === "pregnant" ? "Pregnancy" : "Breastfeeding"} → +25 g/day.`);
    }

    const grams = Math.max(40, round5(refWeight * factor + extra));
    return { grams, factor, refWeight, bmi, notes };
  }

  // ---------- Foundry Responses API ----------
  const MENU_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "daily_protein_target_g", "total_protein_g", "total_calories", "meals", "top_protein_sources", "grocery_list", "tips", "disclaimer"],
    properties: {
      summary: { type: "string" },
      daily_protein_target_g: { type: "number" },
      total_protein_g: { type: "number" },
      total_calories: { type: "number" },
      meals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "time", "items", "meal_protein_g", "meal_calories", "prep_note"],
          properties: {
            name: { type: "string" },
            time: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["food", "quantity", "protein_g", "calories"],
                properties: {
                  food: { type: "string" },
                  quantity: { type: "string" },
                  protein_g: { type: "number" },
                  calories: { type: "number" },
                },
              },
            },
            meal_protein_g: { type: "number" },
            meal_calories: { type: "number" },
            prep_note: { type: "string" },
          },
        },
      },
      top_protein_sources: { type: "array", items: { type: "string" } },
      grocery_list: { type: "array", items: { type: "string" } },
      tips: { type: "array", items: { type: "string" } },
      disclaimer: { type: "string" },
    },
  };

  const SYSTEM_PROMPT = `You are a careful sports & clinical nutrition assistant.
Build a realistic one-day food menu that meets the user's DAILY PROTEIN TARGET (within ±5%).
Rules:
- Strictly respect diet type, allergies, intolerances and dislikes. Never include an allergen.
- Use the preferred cuisine and commonly available foods; use practical household quantities with grams (e.g. "1 cup (200 g)").
- Spread protein fairly evenly across meals (roughly 20–40 g per main meal when the target allows).
- Use standard nutrition values; protein_g and calories per item must be realistic. meal totals must equal the sum of items; total_protein_g must equal the sum of meals.
- Respect the cooking time limit and budget.
- If a medical condition is given (e.g. kidney disease, pregnancy), be conservative and remind the user to consult a professional.
- Keep 'summary' to 2–3 sentences. Provide 3–6 tips. Grocery list should be consolidated.`;

  function profileText(p, target) {
    return [
      `Daily protein target: ${target} g`,
      `Age: ${p.age}, Sex: ${p.sex}, Weight: ${fmt(p.weightKg)} kg, Height: ${p.heightCm} cm`,
      `Activity: ${p.activity}, Goal: ${p.goal}, Condition: ${p.condition}`,
      `Diet type: ${p.diet}`,
      `Cuisine preference: ${p.cuisine || "any"}`,
      `Meals per day: ${p.meals}`,
      `Budget: ${p.budget}, Max cooking time per meal: ${p.cookTime} min`,
      `Allergies/intolerances: ${p.allergies || "none"}`,
      `Dislikes / notes: ${p.notes || "none"}`,
    ].join("\n");
  }

  function extractText(data) {
    if (typeof data.output_text === "string" && data.output_text) return data.output_text;
    let out = "";
    for (const item of data.output || []) {
      if (item.type === "message") {
        for (const c of item.content || []) {
          if (c.type === "output_text") out += c.text;
          if (c.type === "refusal") throw new Error(`Model refused: ${c.refusal}`);
        }
      }
    }
    return out;
  }

  function friendlyError(status, data, conn) {
    const msg = data?.error?.message || data?.message || "";
    let hint = "";
    if (status === 401) hint = "Check the API key (Key 1/Key 2 of the same resource as the endpoint).";
    else if (status === 404) hint = `Check the deployment name "${conn.deployment}" exactly matches your deployment in Foundry, and that the endpoint is that resource.`;
    else if (status === 403) hint = "The resource may block public network access or your IP.";
    else if (status === 429) hint = "Rate limit/quota hit. Wait and retry, or raise the deployment's TPM.";
    return `Foundry returned ${status}: ${msg || "error"}${hint ? " — " + hint : ""}`;
  }

  async function callFoundry(input, effort) {
    const conn = loadConn();
    if (!conn || !conn.apiKey || !conn.endpoint || !conn.deployment) {
      throw new Error("Please configure your Foundry endpoint, deployment and API key in ⚙️ Foundry Settings.");
    }
    const body = {
      model: conn.deployment,
      instructions: SYSTEM_PROMPT,
      input,
      reasoning: { effort: effort || "low" },
      max_output_tokens: 16000,
      store: false,
      text: {
        format: { type: "json_schema", name: "ProteinMenu", schema: MENU_SCHEMA, strict: true },
      },
    };
    let res;
    try {
      res = await fetch(responsesUrl(conn), {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": conn.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`Network/CORS error calling ${responsesUrl(conn)}. Check the endpoint URL and that the resource allows public network access. (${e.message})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendlyError(res.status, data, conn));
    if (data.status === "incomplete") {
      throw new Error(`Response incomplete (${data.incomplete_details?.reason || "unknown"}). Try lower reasoning effort.`);
    }
    const text = extractText(data);
    try { return JSON.parse(text); }
    catch { throw new Error("Could not parse the model output as JSON."); }
  }

  // ---------- Rendering ----------
  function renderMenu(m, target) {
    const pct = target ? Math.round((m.total_protein_g / target) * 100) : 0;
    const cls = pct >= 95 ? "good" : "low";
    const meals = (m.meals || []).map((meal) => `
      <div class="meal">
        <div class="meal-head">
          <h3>${esc(meal.name)} <span class="muted small">${esc(meal.time)}</span></h3>
          <span class="pill">${fmt(meal.meal_protein_g)} g protein · ${Math.round(meal.meal_calories)} kcal</span>
        </div>
        <table>
          <thead><tr><th>Food</th><th>Quantity</th><th class="num">Protein (g)</th><th class="num">kcal</th></tr></thead>
          <tbody>
            ${(meal.items || []).map((it) => `<tr><td>${esc(it.food)}</td><td>${esc(it.quantity)}</td><td class="num">${fmt(it.protein_g)}</td><td class="num">${Math.round(it.calories)}</td></tr>`).join("")}
          </tbody>
        </table>
        ${meal.prep_note ? `<p class="small muted">🧑‍🍳 ${esc(meal.prep_note)}</p>` : ""}
      </div>`).join("");

    $("menuOutput").innerHTML = `
      <p>${esc(m.summary)}</p>
      <div class="summary-row">
        <span class="pill">🎯 Target: ${fmt(target)} g</span>
        <span class="pill ${cls}">🥩 Menu: ${fmt(m.total_protein_g)} g (${pct}%)</span>
        <span class="pill">🔥 ${Math.round(m.total_calories)} kcal</span>
      </div>
      ${meals}
      <div class="cols">
        <div><h3>🏆 Top protein sources</h3><ul>${(m.top_protein_sources || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
        <div><h3>🛒 Grocery list</h3><ul>${(m.grocery_list || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
      </div>
      <h3>💡 Tips</h3><ul>${(m.tips || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      <p class="small muted">${esc(m.disclaimer)}</p>`;
  }

  function menuToText(m, target) {
    const lines = [`ProteinPlate menu – target ${target} g, menu ${fmt(m.total_protein_g)} g, ${Math.round(m.total_calories)} kcal`, ""];
    for (const meal of m.meals || []) {
      lines.push(`${meal.name} (${meal.time}) – ${fmt(meal.meal_protein_g)} g protein`);
      for (const it of meal.items || []) lines.push(`  • ${it.food} – ${it.quantity} – ${fmt(it.protein_g)} g`);
      lines.push("");
    }
    lines.push("Grocery list: " + (m.grocery_list || []).join(", "));
    return lines.join("\n");
  }

  function setStatus(html, isError) {
    const s = $("status");
    s.classList.remove("hidden");
    s.classList.toggle("error", !!isError);
    s.innerHTML = html;
  }

  // ---------- State & events ----------
  let state = { profile: null, target: 0, menu: null };

  function currentTarget() {
    const o = parseFloat($("targetOverride").value);
    return o >= 20 && o <= 400 ? Math.round(o) : state.target;
  }

  $("profileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const p = readProfile();
    const errs = validateProfile(p);
    if (errs.length) { alert(errs.join("\n")); return; }
    const r = calcProtein(p);
    state.profile = p;
    state.target = r.grams;
    $("targetValue").textContent = r.grams;
    $("targetOverride").value = "";
    $("targetExplain").innerHTML = `<div>≈ ${fmt(r.grams / p.weightKg)} g per kg of body weight · BMI ${fmt(r.bmi)}</div><ul class="small">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
    $("targetCard").classList.remove("hidden");
    $("targetCard").scrollIntoView({ behavior: "smooth" });
  });

  async function generate(extraInstruction) {
    const btns = [$("buildMenu"), $("refineBtn")];
    btns.forEach((b) => (b.disabled = true));
    $("menuCard").classList.remove("hidden");
    setStatus('<span class="spinner"></span>Asking gpt-5.4 to build your menu… this can take 10–60 seconds.');
    const target = currentTarget();
    try {
      const input = [{ role: "user", content: profileText(state.profile, target) }];
      if (extraInstruction && state.menu) {
        input.push({ role: "assistant", content: JSON.stringify(state.menu) });
        input.push({ role: "user", content: `Revise the menu above with this change, keeping the protein target: ${extraInstruction}` });
      }
      const menu = await callFoundry(input, $("effort").value);
      state.menu = menu;
      renderMenu(menu, target);
      $("status").classList.add("hidden");
      $("refineBox").classList.remove("hidden");
      $("menuCard").scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      setStatus(`❌ ${esc(err.message)}`, true);
    } finally {
      btns.forEach((b) => (b.disabled = false));
    }
  }

  $("buildMenu").addEventListener("click", () => generate());
  $("refineBtn").addEventListener("click", () => {
    const t = $("refineInput").value.trim();
    if (!t) return;
    generate(t).then(() => { $("refineInput").value = ""; });
  });
  $("refineInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("refineBtn").click(); });
  $("copyBtn").addEventListener("click", async () => {
    if (!state.menu) return;
    await navigator.clipboard.writeText(menuToText(state.menu, currentTarget()));
    $("copyBtn").textContent = "✅ Copied";
    setTimeout(() => ($("copyBtn").textContent = "📋 Copy menu"), 1500);
  });
  $("printBtn").addEventListener("click", () => window.print());

  // Settings dialog
  const dlg = $("settingsDialog");
  $("openSettings").addEventListener("click", () => {
    const c = loadConn() || {};
    $("endpoint").value = c.endpoint || "";
    $("deployment").value = c.deployment || "gpt-5.4";
    $("apiKey").value = c.apiKey || "";
    $("remember").checked = !!localStorage.getItem(STORE_KEY);
    $("testResult").textContent = "";
    dlg.showModal();
  });
  function readConnForm() {
    return { endpoint: $("endpoint").value.trim(), deployment: $("deployment").value.trim(), apiKey: $("apiKey").value.trim() };
  }
  $("saveConn").addEventListener("click", () => {
    const c = readConnForm();
    if (!c.endpoint || !c.deployment || !c.apiKey) { $("testResult").textContent = "All three fields are required."; return; }
    if (!/^https:\/\//i.test(c.endpoint)) { $("testResult").textContent = "Endpoint must start with https://"; return; }
    saveConn(c, $("remember").checked);
    refreshBanner();
    dlg.close();
  });
  $("clearConn").addEventListener("click", () => {
    clearConn();
    $("endpoint").value = ""; $("apiKey").value = "";
    $("testResult").textContent = "Cleared.";
    refreshBanner();
  });
  $("testConn").addEventListener("click", async () => {
    const c = readConnForm();
    if (!c.endpoint || !c.deployment || !c.apiKey) { $("testResult").textContent = "Fill in all fields first."; return; }
    $("testResult").innerHTML = '<span class="spinner"></span>Testing…';
    try {
      const res = await fetch(responsesUrl(c), {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": c.apiKey },
        body: JSON.stringify({ model: c.deployment, input: "Reply with OK.", max_output_tokens: 200, reasoning: { effort: "low" }, store: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) $("testResult").innerHTML = `✅ Connected. Model: <code>${esc(data.model || c.deployment)}</code>`;
      else $("testResult").textContent = `❌ ${friendlyError(res.status, data, c)}`;
    } catch (e) {
      $("testResult").textContent = `❌ Network/CORS error: ${e.message}`;
    }
  });

  refreshBanner();

  // Expose pure functions for testing (no secrets).
  window.ProteinPlate = { calcProtein, normalizeEndpoint, extractText };
})();
