// scripts/build-psra-agents.mjs — owned by Person A
// Turns the PSRA "Register of Licensed Property Services Providers" into data/psra-agents.json.
//
// 1. Download the register as Excel from psr.ie (Registers -> Register of Licensed Property Services Providers).
// 2. Open it in Excel and use File -> Save As -> "CSV UTF-8".
// 3. Run:  node scripts/build-psra-agents.mjs path/to/register.csv
//
// The script finds the header row by itself and keeps name, licence number, licence type and location.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Small CSV parser: handles quotes, commas and line breaks inside quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((s) => s.trim()));
}

export function toAgents(rows) {
  const headerAt = rows.findIndex((r) => r.some((c) => /name/i.test(c)));
  if (headerAt === -1) throw new Error("No header row with a 'name' column found");
  const header = rows[headerAt];
  const col = (re) => header.findIndex((h) => re.test(h));
  const cName = col(/name/i);
  const cLicence = col(/licen[cs]e\s*(no|num)/i) !== -1 ? col(/licen[cs]e\s*(no|num)/i) : col(/licen[cs]e/i);
  const cType = col(/type|class|categor/i);
  const cLoc = col(/county|town|location|address/i);
  const pick = (r, k) => (k === -1 ? "" : r[k] || "");

  return rows
    .slice(headerAt + 1)
    .filter((r) => pick(r, cName))
    .map((r) => ({ name: pick(r, cName), licence: pick(r, cLicence), type: pick(r, cType), location: pick(r, cLoc) }));
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/build-psra-agents.mjs path/to/register.csv");
    process.exit(1);
  }
  const text = (await readFile(file, "utf8")).replace(/^﻿/, "");
  const agents = toAgents(parseCsv(text));
  await mkdir("data", { recursive: true });
  await writeFile("data/psra-agents.json", JSON.stringify(agents, null, 1));
  console.log(`Saved ${agents.length} licensed providers to data/psra-agents.json`);
  console.log("First 3:", agents.slice(0, 3));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
