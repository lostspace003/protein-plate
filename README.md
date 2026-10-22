# 🥗 ProteinPlate – AI Daily Protein & Menu Planner

A static web app (GitHub Pages only – no Azure Web Apps / Functions) that:

1. Asks for your details (age, sex, weight, height, activity, goal, special condition, diet type, cuisine, allergies, budget, cooking time).
2. Calculates your **daily protein requirement** in the browser.
3. Calls **Microsoft Foundry `gpt-5.4`** via the Azure OpenAI **Responses API** (structured JSON output) to build a one-day menu that hits the target – with per-item protein/calories, grocery list and tips.
4. Lets you tweak the menu ("swap breakfast", "add a shake"), copy or print it.

## How credentials work (important)

GitHub Pages only serves static files, so there is no server to hide a secret.
**Your API key is never committed to this repo or baked into the build.**
Instead, you enter it at runtime in **⚙️ Foundry Settings**:

| Field | Example |
|---|---|
| Endpoint | `https://YOUR-RESOURCE.openai.azure.com` (or `https://YOUR-RESOURCE.services.ai.azure.com`) |
| Deployment name | `gpt-5.4` (the name you gave your deployment) |
| API key | Key 1 / Key 2 from your Foundry resource |

The key is stored only in your browser (`sessionStorage` by default, or `localStorage` if you tick *Remember*) and sent directly from your browser to your Foundry endpoint with the `api-key` header:

```
POST {endpoint}/openai/v1/responses
```

> ⚠️ Do **not** put the key into a GitHub Actions secret to "inject" it into the site – anything injected into a static site is publicly downloadable. Share the app URL freely; share the key only with people you trust, and rotate it if exposed.

## Protein calculation

| Factor | Rule |
|---|---|
| Activity baseline | Sedentary 0.8 · Light 1.0 · Moderate 1.2 · Very active 1.4 · Athlete 1.7 g/kg |
| Fat loss | +0.4 g/kg (min 1.2, max 2.2) |
| Muscle gain | +0.4 g/kg (min 1.6, max 2.2) |
| Age 65+ | min 1.0 g/kg |
| Pregnant / breastfeeding | +25 g/day |
| Kidney disease | capped at 0.8 g/kg – confirm with your doctor |
| BMI ≥ 30 | uses adjusted body weight |

Not medical advice.

## Deploy

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the *Deploy to GitHub Pages* workflow manually).
3. Open `https://<user>.github.io/<repo>/`, click **⚙️ Foundry Settings**, enter endpoint/deployment/key, **Test connection**, **Save**.

## References

- GPT-5.4 model: https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure#gpt-54
- Responses API: https://learn.microsoft.com/azure/foundry/openai/how-to/responses
- Structured outputs: https://learn.microsoft.com/azure/foundry/openai/how-to/structured-outputs
- v1 API: https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle
- Reasoning models: https://learn.microsoft.com/azure/foundry/openai/how-to/reasoning
