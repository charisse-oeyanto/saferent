// scripts/build-cork-rents.mjs — owned by Person A
// Downloads the CSO table RIQ02 (RTB Average Monthly Rent Report, by quarter, bedrooms,
// property type and location) and saves only the Cork locations to data/cork-rents.json.
//
// Run once on a laptop with internet (Node 18 or newer):
//   node scripts/build-cork-rents.mjs           -> Cork locations only
//   node scripts/build-cork-rents.mjs --all     -> every location in Ireland (bigger file)
//
// For each location + bedrooms + property type it keeps the LATEST quarter that has a value.

import { writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CSO_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/JSON-stat/1.0/en";

// Cork towns to keep even if "Cork" isn't in the label. Edit after seeing the printed list.
const CORK_TOWNS = [
  "Ballincollig", "Bandon", "Bantry", "Blarney", "Carrigaline", "Carrigtwohill", "Clonakilty", "Cobh",
  "Douglas", "Fermoy", "Glanmire", "Kanturk", "Kinsale", "Macroom", "Mallow", "Midleton",
  "Mitchelstown", "Passage West", "Skibbereen", "Youghal",
];

// Works with JSON-stat 1.0 ({ dataset: {...} }) and 2.0 ({ class: "dataset", ... }).
export function parseJsonStat(doc) {
  const ds =
    doc.class === "dataset" ? doc : doc.dataset ?? Object.values(doc).find((v) => v && v.dimension && v.value);
  if (!ds) throw new Error("No JSON-stat dataset found in the response");
  const ids = ds.id ?? ds.dimension.id;
  const sizes = ds.size ?? ds.dimension.size;
  const dims = ids.map((id, k) => {
    const d = ds.dimension[id];
    const idx = d.category.index;
    const codes = !idx
      ? Object.keys(d.category.label)
      : Array.isArray(idx)
        ? idx
        : Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
    return { id, label: d.label ?? id, labels: codes.map((c) => d.category.label?.[c] ?? c), size: sizes[k] };
  });
  const value = (i) => (Array.isArray(ds.value) ? ds.value[i] : ds.value[String(i)]);
  return { dims, value };
}

export function extractRents(doc, keepLocation) {
  const { dims, value } = parseJsonStat(doc);
  const find = (re) => {
    const k = dims.findIndex((d) => re.test(d.label) || re.test(d.id));
    if (k === -1) throw new Error(`Dimension ${re} not found. Dimensions: ${dims.map((d) => d.label).join(", ")}`);
    return k;
  };
  const kQ = find(/quarter/i);
  const kB = find(/bedroom/i);
  const kT = find(/property type/i);
  const kL = find(/location/i);

  const total = dims.reduce((p, d) => p * d.size, 1);
  const latest = new Map();
  const coord = new Array(dims.length).fill(0);

  for (let i = 0; i < total; i++) {
    // mixed-radix coordinates, last dimension changes fastest
    let rem = i;
    for (let k = dims.length - 1; k >= 0; k--) {
      coord[k] = rem % dims[k].size;
      rem = Math.floor(rem / dims[k].size);
    }
    const location = dims[kL].labels[coord[kL]];
    if (!keepLocation(location)) continue;
    const v = value(i);
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) continue;
    const row = {
      location,
      bedrooms: dims[kB].labels[coord[kB]],
      propertyType: dims[kT].labels[coord[kT]],
      quarter: dims[kQ].labels[coord[kQ]],
      rent: Math.round(Number(v) * 100) / 100,
    };
    const key = `${row.location}|${row.bedrooms}|${row.propertyType}`;
    const prev = latest.get(key);
    if (!prev || row.quarter > prev.quarter) latest.set(key, row);
  }

  const rows = [...latest.values()].sort(
    (a, b) => a.location.localeCompare(b.location) || a.bedrooms.localeCompare(b.bedrooms) || a.propertyType.localeCompare(b.propertyType),
  );
  const quarter = rows.reduce((q, r) => (r.quarter > q ? r.quarter : q), "");
  return { source: "CSO RIQ02 – RTB Average Monthly Rent Report", quarter, rows };
}

export const isCork = (label) => /cork/i.test(label) || CORK_TOWNS.some((t) => label.toLowerCase().includes(t.toLowerCase()));

async function main() {
  const all = process.argv.includes("--all");
  console.log(`Downloading ${CSO_URL} …`);
  const res = await fetch(CSO_URL);
  if (!res.ok) throw new Error(`CSO returned ${res.status}`);
  const doc = await res.json();

  const out = extractRents(doc, all ? () => true : isCork);
  out.generated = new Date().toISOString();
  await mkdir("data", { recursive: true });
  await writeFile("data/cork-rents.json", JSON.stringify(out, null, 1));

  const locations = [...new Set(out.rows.map((r) => r.location))];
  console.log(`Saved ${out.rows.length} rows for ${locations.length} locations (latest quarter ${out.quarter}) to data/cork-rents.json`);
  console.log("Locations:", locations.join(" | "));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
