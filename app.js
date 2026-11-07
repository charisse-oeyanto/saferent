// app.js — owned by Person B
// Reads the form, looks up the CSO average rent and the PSRA register,
// asks the AI to find warning signs, scores the listing, and shows the result.

import { scoreListing, rentDiffPct, weeklyToMonthly, FLAG_RULES } from "./scoring.js";

const RTB_REGISTER_URL = "https://rtb.ie/check-the-register/";
const FALLBACK_AREAS = ["Cork City", "Ballincollig", "Bandon", "Bantry", "Carrigaline", "Cobh", "Fermoy", "Kinsale", "Macroom", "Mallow", "Midleton", "Youghal"];

const $ = (id) => document.getElementById(id);
const form = $("check-form");
const statusEl = $("status");
const resultEl = $("result");

let rents = null; // { source, quarter, rows: [{ location, bedrooms, propertyType, rent, quarter }] }
let agents = []; // [{ name, licence, ... }]

async function loadJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function init() {
  rents = await loadJson("data/cork-rents.json");
  agents = (await loadJson("data/psra-agents.json")) || [];

  const haveRents = rents && Array.isArray(rents.rows) && rents.rows.length > 0;
  const areas = haveRents ? [...new Set(rents.rows.map((r) => r.location))].sort(sortCorkFirst) : FALLBACK_AREAS;
  $("area").innerHTML = areas.map((a) => `<option>${escapeHtml(a)}</option>`).join("");

  $("data-note").textContent = haveRents
    ? `Rent averages: ${rents.source}, ${rents.quarter}.`
    : "Rent data not loaded yet: the price check is skipped. (Run scripts/build-cork-rents.mjs.)";

  document.querySelectorAll('input[name="kind"]').forEach((el) => el.addEventListener("change", toggleRoomFields));
  toggleRoomFields();
}

function sortCorkFirst(a, b) {
  if (a === "Cork City") return -1;
  if (b === "Cork City") return 1;
  return a.localeCompare(b);
}

function toggleRoomFields() {
  const isRoom = form.kind.value === "room";
  $("whole-fields").hidden = isRoom;
  $("room-note").hidden = !isRoom;
}

function findAverage(area, bedrooms, propertyType) {
  if (!rents || !rents.rows) return null;
  const match = (type) => rents.rows.find((r) => r.location === area && r.bedrooms === bedrooms && r.propertyType === type);
  return match(propertyType) || match("All property types") || null;
}

function checkPsra(name) {
  if (!agents.length) return "unknown";
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(name);
  if (n.length < 3) return "unknown";
  return agents.some((a) => norm(a.name).includes(n) || n.includes(norm(a.name))) ? "yes" : "no";
}

async function callAi(payload) {
  const res = await fetch("/.netlify/functions/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `AI request failed (${res.status})`);
  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("submit");
  btn.disabled = true;
  resultEl.hidden = true;
  const warnings = [];

  try {
    const listing = form.listing.value.trim();
    const area = form.area.value;
    const isRoom = form.kind.value === "room";
    const bedrooms = isRoom ? "a room in a shared house" : form.bedrooms.value;
    const propertyType = form.propertyType.value;
    const rentInput = Number(form.rent.value);
    const monthly = form.period.value === "week" ? weeklyToMonthly(rentInput) : rentInput;

    // 1. AI reads the listing for warning signs.
    setStatus("Reading the listing for warning signs…");
    let flags = {};
    try {
      flags = (await callAi({ mode: "extract", listing })).flags || {};
    } catch (err) {
      warnings.push(`The AI check didn't run (${err.message}). The score uses your answers and the rent check only.`);
    }

    // 2. The user's yes/no answers count the same as a flag the AI found.
    const answer = (name) => form[name].value === "yes";
    if (answer("q_pay")) flags.deposit_before_viewing = { value: true, evidence: "You said they asked for payment before a viewing" };
    if (answer("q_view")) flags.no_viewing = { value: true, evidence: "You said you can't view it in person" };
    if (answer("q_method")) flags.unusual_payment = { value: true, evidence: "You said they want an unusual payment method" };

    // 3. PSRA check, only if the listing claims to be an agency.
    const agencyName = form.agency.value.trim() || flags.claims_agency?.agency_name || "";
    const claimsAgency = Boolean(agencyName) || Boolean(flags.claims_agency?.value);
    const psra = claimsAgency ? (agencyName ? checkPsra(agencyName) : "unknown") : "not claimed";
    if (psra === "unknown" && claimsAgency) warnings.push("Couldn't check the PSRA register for this agency. Search it yourself on psr.ie.");

    // 4. Rent check (skipped for rooms: CSO data covers whole properties only).
    const avgRow = isRoom ? null : findAverage(area, bedrooms, propertyType);
    const diff = avgRow ? rentDiffPct(monthly, avgRow.rent) : null;

    // 5. Score with fixed rules.
    const { score, level, reasons } = scoreListing({ rentDiff: diff, flags, psra });

    // 6. AI writes the explanation (fallback: a fixed template).
    setStatus("Writing the explanation…");
    const facts = {
      risk_level: level,
      score,
      rent: Math.round(monthly),
      bedrooms: isRoom ? bedrooms : `a ${bedrooms.toLowerCase()}`,
      area,
      avg_rent: avgRow ? Math.round(avgRow.rent) : null,
      rent_diff: diff === null ? null : `${Math.abs(Math.round(diff))}% ${diff < 0 ? "below" : "above"} average`,
      quarter: avgRow ? avgRow.quarter : null,
      psra_result: psra,
      flags_with_evidence: reasons
        .filter((r) => r.evidence)
        .map((r) => `${r.label}: "${r.evidence}"`)
        .join("; "),
    };
    let explanation;
    try {
      explanation = (await callAi({ mode: "explain", facts })).text;
    } catch {
      explanation = templateExplanation(level, reasons);
    }

    render({ level, score, reasons, explanation, facts, avgRow, diff, psra, warnings, address: form.address.value.trim() });
  } finally {
    setStatus("");
    btn.disabled = false;
  }
});

function templateExplanation(level, reasons) {
  const top = reasons[0];
  const lines = [`${level.toUpperCase()} RISK${top ? `: ${top.label.toLowerCase()}.` : ": we found no warning signs."}`];
  reasons.slice(0, 3).forEach((r) => lines.push(`- ${r.label}`));
  lines.push("What to do next:");
  lines.push("- Don't pay anything before you view the property in person.");
  lines.push("- Check the address on the RTB register.");
  return lines.join("\n");
}

function render({ level, score, reasons, explanation, facts, avgRow, diff, psra, warnings, address }) {
  const factsHtml = [
    avgRow
      ? `Rent €${facts.rent}/month vs CSO average €${facts.avg_rent} for ${escapeHtml(facts.bedrooms)} in ${escapeHtml(facts.area)} (${escapeHtml(facts.rent_diff)}, ${escapeHtml(avgRow.quarter)})`
      : "Rent check skipped (no CSO average for this choice)",
    `PSRA register: ${escapeHtml(psra)}`,
    ...reasons.map((r) => `${escapeHtml(r.label)} (+${r.points})${r.evidence ? `: <em>"${escapeHtml(r.evidence)}"</em>` : ""}`),
  ];

  resultEl.innerHTML = `
    <div class="badge badge-${level.toLowerCase()}">${level} risk · ${score}/100</div>
    <div class="explanation">${formatText(explanation)}</div>
    <details>
      <summary>How we scored it</summary>
      <ul>${factsHtml.map((f) => `<li>${f}</li>`).join("")}</ul>
    </details>
    ${warnings.map((w) => `<p class="warning">${escapeHtml(w)}</p>`).join("")}
    <div class="actions">
      <a class="button" href="${RTB_REGISTER_URL}" target="_blank" rel="noopener">Check RTB register</a>
      ${address ? `<button type="button" class="button secondary" id="copy-address">Copy address</button>` : ""}
    </div>
    <p class="small">This is a guide, not legal advice. A low score doesn't prove a listing is safe.</p>`;
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth" });

  const copyBtn = $("copy-address");
  if (copyBtn) copyBtn.addEventListener("click", () => navigator.clipboard.writeText(address).then(() => (copyBtn.textContent = "Copied")));
}

// Plain text from the AI -> safe HTML: "- " lines become bullets, the rest paragraphs.
function formatText(text) {
  const out = [];
  let list = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };
  for (const raw of String(text).split("\n")) {
    const line = raw.trim().replace(/\*\*/g, "");
    if (!line) continue;
    if (/^[-*•]\s+/.test(line)) list.push(`<li>${escapeHtml(line.replace(/^[-*•]\s+/, ""))}</li>`);
    else {
      flush();
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}

function setStatus(text) {
  statusEl.textContent = text;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Exposed for quick checks in the browser console.
window.SafeRent = { FLAG_RULES, findAverage: (...a) => findAverage(...a) };

init();
