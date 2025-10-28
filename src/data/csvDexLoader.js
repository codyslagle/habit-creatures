// src/data/csvDexLoader.js

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

const VALID = new Set(["fire","water","earth","air","light","metal","heart"]);
const clean = (s) => (s || "").trim();
const normEl = (s) => {
  const x = clean(s).toLowerCase();
  return (x === "n/a" || x === "na" || x === "-") ? "" : x;
};

function parseElementsFromRow(row) {
  const e1 = normEl(row.element1);
  const e2 = normEl(row.element2);
  const out = [];
  if (e1) out.push(e1);
  if (e2) out.push(e2);
  return out;
}

function parseCostPairs(costSection) {
  const cost = {};
  const pairs = (costSection || "").split(";").map(x => x.trim()).filter(Boolean);
  for (const pair of pairs) {
    const [rawEl, amtStr] = pair.split(":").map(x => x.trim());
    const el = normEl(rawEl);
    if (!el || !VALID.has(el)) continue;
    const amt = Number(amtStr || "0");
    cost[el] = isNaN(amt) ? 0 : amt;
  }
  return cost;
}

// evolutions cell: "toId:el1:amt1;el2:amt2 || toId2:el1:amt1"
function parseEvolutions(evoField) {
  const evolutions = [];
  const raw = clean(evoField);
  if (!raw) return evolutions;
  const evoParts = raw.split("||").map(x => x.trim()).filter(Boolean);
  for (const part of evoParts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const toId = part.slice(0, idx).trim();
    const cost = parseCostPairs(part.slice(idx + 1));
    evolutions.push({ to: toId, cost });
  }
  return evolutions;
}

export const ELEMENTS = ["fire","water","earth","air","light","metal","heart"];

export async function loadDexFromCSV() {
  const res = await fetch("/data/species.csv");
  if (!res.ok) throw new Error("species.csv not found");
  const text = await res.text();
  const rows = parseCSV(text);

  const DEX = {};

  for (const row of rows) {
    const id = clean(row.id);
    if (!id) continue;

    const stageNum = Number(clean(row.stage) || "0");
    const elements = parseElementsFromRow(row);
    const name = clean(row.name) || id;
    const parentId = clean(row.parentId) || undefined;

    DEX[id] = {
      id,
      stage: isNaN(stageNum) ? 0 : stageNum,
      elements,
      name,
      sprite: `/sprites/${id}.png`,   // auto-linked to /public/sprites/
      parentId,
      evolutions: parseEvolutions(row.evolutions),
    };
  }

  const getSpecies = (id) => DEX[id];
  const findBaseByElement = (el) =>
    Object.values(DEX).find(s => s.stage === 0 && s.elements.length === 1 && s.elements[0] === el);

  return { DEX, getSpecies, findBaseByElement };
}
