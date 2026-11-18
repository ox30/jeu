// Two measurements side by side, line by line of the matrix: victories, and the measures that
// tell a balance change (aircraft down and lost, ships lost, U-boats sunk, stops).
//   node tools/bot/compare.mjs depart m2.7-final        (names in tools/bot/out, or paths)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (name) => {
  const file = existsSync(name) ? name : `${here}out/${name}.jsonl`;
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fr = (n, digits = 0) => (Number.isFinite(n) ? n.toFixed(digits).replace('.', ',') : '—');

function groups(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.error) continue;
    const key = `${r.scenario}|${r.preset}|${r.conduct}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

/** The figures of one line of the matrix. */
function figures(list) {
  const wins = list.filter((r) => r.outcome === 'victory').length;
  const sea = list.filter((r) => r.lossPct !== undefined);
  const air = list.filter((r) => r.down !== undefined && r.lossPct === undefined);
  const out = { wins, n: list.length };
  if (sea.length) {
    out.lossPct = mean(sea.map((r) => r.lossPct));
    out.uboatsSunk = mean(sea.map((r) => r.uboatsSunk));
    out.stops = mean(sea.map((r) => r.stops));
    out.stopsMin = Math.min(...sea.map((r) => r.stops));
    out.stopsMax = Math.max(...sea.map((r) => r.stops));
  }
  if (air.length) {
    out.down = mean(air.map((r) => r.down));
    out.rafLost = mean(air.map((r) => r.rafLost));
    out.fighterShare = mean(air.map((r) => r.fighterShare * 100));
  }
  const steps = list.filter((r) => r.steps);
  if (steps.length) {
    out.maxMs = Math.max(...steps.map((r) => r.steps.maxMs));
    out.over20 = steps.reduce((n, r) => n + r.steps.over20, 0);
  }
  return out;
}

const [nameA, nameB] = process.argv.slice(2);
if (!nameA || !nameB) {
  console.error('usage: node tools/bot/compare.mjs <before> <after>');
  process.exit(1);
}
const a = groups(read(nameA));
const b = groups(read(nameB));
console.log(`| Scénario | Préréglage | Conduite | Victoires | Mesures (${nameA} → ${nameB}) |`);
console.log('| --- | --- | --- | --- | --- |');
for (const [key, listB] of b) {
  const listA = a.get(key);
  const [scenario, preset, conduct] = key.split('|');
  const fb = figures(listB);
  const fa = listA ? figures(listA) : null;
  const pair = (name, digits = 0, unit = '') => (fb[name] === undefined ? null : `${name} ${fa ? fr(fa[name], digits) : '—'} → ${fr(fb[name], digits)}${unit}`);
  const parts = [
    pair('down'), pair('rafLost'), pair('fighterShare', 0, ' %'), pair('lossPct', 1, ' %'), pair('uboatsSunk', 1),
    fb.stops === undefined ? null : `arrêts ${fa ? fr(fa.stops) : '—'} → ${fr(fb.stops)} (${fb.stopsMin} à ${fb.stopsMax})`,
    fb.maxMs === undefined ? null : `pas le plus long ${fa && fa.maxMs !== undefined ? fr(fa.maxMs) : '—'} → ${fr(fb.maxMs)} ms, plus de 20 ms : ${fa && fa.over20 !== undefined ? fa.over20 : '—'} → ${fb.over20}`,
  ].filter(Boolean);
  console.log(`| ${scenario} | ${preset} | ${conduct} | ${fa ? `${fa.wins} sur ${fa.n}` : '—'} → ${fb.wins} sur ${fb.n} | ${parts.join(' ; ')} |`);
}
