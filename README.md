# SafeRent

**Check if a rental listing in Cork is a scam.** Paste the ad and SafeRent compares the rent to official RTB/CSO averages, checks a claimed agency against the PSRA register, and looks for Garda warning signs. Then it explains the risk in plain English. Built at Corkathon 2026.

Gardaí recorded over 230 rental and reservation scam reports, with losses above €400,000, up to 31 July 2026 ([source](https://www.garda.ie/en/about-us/our-departments/office-of-corporate-communications/press-releases/2026/august/25-08-2026-an-garda-siochana-issues-student-fraud-warning-ahead-of-cao-offers-25th-august-2026.html)).

## How it works

1. The user pastes the listing and enters the area, bedrooms, rent and (optionally) the agency name and address.
2. **AI call 1** reads the listing for Garda warning signs and returns yes/no plus the exact words as evidence.
3. The app compares the rent with the **CSO/RTB average** for that area and size, and checks a claimed agency on the **PSRA register**.
4. **Fixed rules** in `scoring.js` turn the facts into a score out of 100: 0–24 Low, 25–49 Medium, 50+ High.
5. **AI call 2** writes the explanation and next steps. If the AI is down, a fixed template is used instead.

The AI never decides the score. It only finds evidence and writes the explanation, so every point can be explained.

## Data sources

| Source | Used for |
| --- | --- |
| [CSO RIQ02 – RTB Average Monthly Rent Report](https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/JSON-stat/1.0/en) | Average rent by location, bedrooms and property type |
| [PSRA Register of Licensed Property Services Providers](https://www.gov.ie/en/service/registers-held-by-the-property-services-regulatory-authority/) | Is a claimed letting agency licensed? |
| [RTB tenancy register](https://rtb.ie/check-the-register/) | Linked for the user to check the address themselves |
| Garda accommodation-fraud advice | The warning signs the AI looks for |
| [OpenRouter](https://openrouter.ai) (free models) | Reading the listing and writing the explanation |

## Project files

| File | Owner | What it does |
| --- | --- | --- |
| `index.html`, `style.css`, `app.js` | Person B | The form, the result card, calling the AI function |
| `netlify/functions/ai.mjs` | Person B | Calls OpenRouter with the secret key (two prompts: extract, explain) |
| `scoring.js` | Person A | Rent difference and the points rules |
| `scripts/build-cork-rents.mjs` → `data/cork-rents.json` | Person A | Downloads the CSO table and keeps the Cork rows |
| `scripts/build-psra-agents.mjs` → `data/psra-agents.json` | Person A | Converts the PSRA register (saved as CSV) to JSON |
| `test-listings/` | Charisse | Made-up scam, fair and borderline listings for testing and the demo |

## Run it

**Build the data (once, on a laptop with internet, Node 18+):**

```
node scripts/build-cork-rents.mjs
node scripts/build-psra-agents.mjs path/to/psra-register.csv
```

**Deploy on Netlify:** import this repo, then add `OPENROUTER_API_KEY` under *Site configuration → Environment variables* and trigger a new deploy.

**Run locally:** copy `.env.example` to `.env`, add your key, then:

```
npm install -g netlify-cli
netlify dev
```

## Limits

- CSO averages lag by a few months, and only cover whole properties, so the price check is skipped for rooms in shared houses.
- The RTB register only lists active tenancies, so a vacant property can be missing without being a scam.
- The AI can miss a warning sign. A low score does not prove a listing is safe.
- SafeRent is a guide, not legal advice.
