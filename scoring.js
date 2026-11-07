// scoring.js — owned by Person A
// Turns the facts about a listing into a score out of 100 and a risk level.
// Every point comes from a fixed rule below, so you can explain the score to the judges.
// The point values are STARTING values: test them on real listings and adjust.

export const FLAG_RULES = {
  deposit_before_viewing: { points: 30, label: "Deposit or payment asked for before a viewing" },
  no_viewing: { points: 30, label: "Property can't be viewed in person" },
  unusual_payment: { points: 20, label: "Unusual payment method (money transfer, crypto, gift cards, account abroad)" },
  pressure: { points: 10, label: "Pressure to decide or pay fast" },
  id_before_viewing: { points: 10, label: "Asks for ID, passport or bank details before a viewing" },
  off_platform: { points: 10, label: "Moves contact off the listing site only (WhatsApp, email)" },
};

export const PSRA_NOT_FOUND_POINTS = 25;

// Rent bands: how far BELOW the CSO average the asking rent is (in %).
export const RENT_BANDS = [
  { minBelow: 40, points: 40, label: "Rent 40% or more below the CSO average" },
  { minBelow: 25, points: 25, label: "Rent 25–39% below the CSO average" },
  { minBelow: 10, points: 10, label: "Rent 10–24% below the CSO average" },
];

// (asking − average) ÷ average × 100. Negative = cheaper than average.
export function rentDiffPct(askingMonthly, averageMonthly) {
  if (!askingMonthly || !averageMonthly) return null;
  return ((askingMonthly - averageMonthly) / averageMonthly) * 100;
}

export function weeklyToMonthly(weekly) {
  return (weekly * 52) / 12;
}

export function riskLevel(score) {
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

/**
 * @param {object} facts
 * @param {number|null} facts.rentDiff   result of rentDiffPct, or null if not checked (e.g. a room)
 * @param {object} facts.flags           { deposit_before_viewing: {value, evidence}, ... }
 * @param {"yes"|"no"|"not claimed"|"unknown"} facts.psra  agency found on the PSRA register?
 * @returns {{score:number, level:string, reasons:Array<{label:string, points:number, evidence?:string}>}}
 */
export function scoreListing({ rentDiff, flags = {}, psra = "not claimed" }) {
  const reasons = [];

  if (rentDiff !== null && rentDiff !== undefined) {
    const below = -rentDiff;
    const band = RENT_BANDS.find((b) => below >= b.minBelow);
    if (band) reasons.push({ label: band.label, points: band.points, evidence: `${Math.round(below)}% below average` });
  }

  for (const [key, rule] of Object.entries(FLAG_RULES)) {
    const flag = flags[key];
    if (flag && flag.value) reasons.push({ label: rule.label, points: rule.points, evidence: flag.evidence || "" });
  }

  if (psra === "no") {
    reasons.push({ label: "Claims to be an agency but is not on the PSRA register", points: PSRA_NOT_FOUND_POINTS });
  }

  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
  reasons.sort((a, b) => b.points - a.points);
  return { score, level: riskLevel(score), reasons };
}
