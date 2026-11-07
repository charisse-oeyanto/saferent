// netlify/functions/ai.mjs — owned by Person B
// The browser calls POST /.netlify/functions/ai. This function adds the secret API key
// (from Netlify's environment variables, never from the code) and calls OpenRouter.
//
// Two modes:
//   { "mode": "extract", "listing": "<ad text>" }   -> which Garda warning signs the ad contains
//   { "mode": "explain", "facts": { ... } }         -> the plain-English explanation
//
// Netlify setup: Site configuration -> Environment variables -> OPENROUTER_API_KEY = sk-or-...
// Optional: OPENROUTER_MODEL (default "openrouter/free" = OpenRouter's free models router).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_LISTING_CHARS = 6000;

const EXTRACT_SYSTEM =
  "You are a rental-listing checker for Ireland. You read a rental advert and report which scam warning signs it contains. Only report what the text clearly says. Never guess. Reply with JSON only, no other text.";

const extractUser = (listing) => `Listing text:
"""
${listing}
"""

For each warning sign below, set "value" to true only if the listing text clearly shows it. If true, copy the exact words that show it (max 20 words) into "evidence". If false, "evidence" is "".

1. deposit_before_viewing: asks for a deposit, rent or any payment before the person has viewed the property.
2. no_viewing: says the property cannot be viewed in person (for example: landlord abroad, keys sent by post, viewing not possible).
3. unusual_payment: asks for payment by money transfer service, cryptocurrency, gift cards, or to a personal account abroad.
4. pressure: pushes the person to decide or pay fast (for example: many people interested, pay today to secure it).
5. id_before_viewing: asks for a passport, ID or bank details before a viewing.
6. off_platform: asks to continue only on WhatsApp, email or social media.
7. claims_agency: says it is an estate agent or letting agency. Put the agency name in "agency_name" if stated.

Return exactly this JSON:
{"deposit_before_viewing":{"value":false,"evidence":""},"no_viewing":{"value":false,"evidence":""},"unusual_payment":{"value":false,"evidence":""},"pressure":{"value":false,"evidence":""},"id_before_viewing":{"value":false,"evidence":""},"off_platform":{"value":false,"evidence":""},"claims_agency":{"value":false,"evidence":"","agency_name":""}}`;

const EXPLAIN_SYSTEM =
  "You explain rental scam risk to busy, non-technical renters in Ireland. Use plain English and short sentences. You are not a lawyer and do not give legal advice. Never say a listing is definitely a scam or definitely safe.";

const explainUser = (f) => `Risk level: ${f.risk_level} (score ${f.score}/100)

Facts we checked:
- Asking rent: €${f.rent} per month for ${f.bedrooms} in ${f.area}
- Average RTB rent for this area and size: ${f.avg_rent ? `€${f.avg_rent} (${f.rent_diff}). Source: CSO/RTB, ${f.quarter}` : "not checked"}
- Agency on the PSRA licence register: ${f.psra_result}
- Warning signs found: ${f.flags_with_evidence || "none"}

Write:
1. One headline sentence with the risk level and the biggest reason.
2. Up to 3 bullet points with the reasons, each pointing to a fact above.
3. "What to do next": up to 3 steps. Always include: do not pay before viewing in person, and check the address on the RTB register.

Max 120 words. Use only the facts above. Do not invent numbers.`;

const FLAG_KEYS = [
  "deposit_before_viewing",
  "no_viewing",
  "unusual_payment",
  "pressure",
  "id_before_viewing",
  "off_platform",
  "claims_agency",
];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function chat(key, system, user) {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "SafeRent",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openrouter/free",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// Models sometimes wrap JSON in ``` fences or add a sentence. Pull out the {...} part.
export function parseFlags(text) {
  const cleaned = String(text).replace(/```(json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI reply had no JSON");
  const raw = JSON.parse(cleaned.slice(start, end + 1));
  const flags = {};
  for (const k of FLAG_KEYS) {
    const v = raw[k] || {};
    flags[k] = { value: v.value === true || v.value === "true", evidence: String(v.evidence || "").slice(0, 200) };
    if (k === "claims_agency") flags[k].agency_name = String(v.agency_name || "").slice(0, 120);
  }
  return flags;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return json({ error: "OPENROUTER_API_KEY is not set on Netlify" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  try {
    if (body.mode === "extract") {
      const listing = String(body.listing || "").trim().slice(0, MAX_LISTING_CHARS);
      if (!listing) return json({ error: "Listing text is empty" }, 400);
      const reply = await chat(key, EXTRACT_SYSTEM, extractUser(listing));
      return json({ flags: parseFlags(reply) });
    }

    if (body.mode === "explain") {
      const reply = await chat(key, EXPLAIN_SYSTEM, explainUser(body.facts || {}));
      return json({ text: reply.trim() });
    }

    return json({ error: 'mode must be "extract" or "explain"' }, 400);
  } catch (err) {
    return json({ error: err.message }, 502);
  }
};
