// A measurement: the matrix of conducts played on several seeds, two games at a time, each
// in its own process. Results go to tools/bot/out/<name>.jsonl (one line a game) and a
// summary is printed as a Markdown table.
//   node tools/bot/measure.mjs --name depart [--seeds 10] [--only hiver] [--workers 2]
//   node tools/bot/measure.mjs --summary depart        (the table again, from the file)
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MATRIX } from './conducts.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fr = (n, digits = 0) => n.toFixed(digits).replace('.', ',');
const range = (a, digits = 0) => (a.length ? `${fr(Math.min(...a), digits)} à ${fr(Math.max(...a), digits)}` : '—');

export function summarize(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.scenario}|${r.preset}|${r.conduct}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const lines = ['| Scénario | Préréglage | Conduite | Victoires | Mesures | Objectifs manqués |', '| --- | --- | --- | --- | --- | --- |'];
  for (const [key, list] of groups) {
    const [scenario, preset, conduct] = key.split('|');
    const ok = list.filter((r) => !r.error);
    const wins = ok.filter((r) => r.outcome === 'victory').length;
    const failed = {};
    let detail = '';
    if (scenario === 'campagne') {
      const reach = (id) => ok.filter((r) => r.battles.some((b) => b.scenario === id)).length;
      const starts = ok.flatMap((r) => r.battles.filter((b) => b.scenario === 'quinze-septembre').map((b) => b.start * 100));
      detail = `arrivent au 15 septembre : ${reach('quinze-septembre')} ; départ de la chasse au 15 septembre : ${range(starts)} %`;
      for (const r of ok) if (r.outcome !== 'victory') for (const f of r.battles[r.battles.length - 1].failed) failed[`${r.reason} ${f}`] = (failed[`${r.reason} ${f}`] || 0) + 1;
    } else {
      for (const r of ok) for (const o of r.objectives) if (!o.done) failed[o.type] = (failed[o.type] || 0) + 1;
      for (const r of ok) if (r.reason) failed[`défaite : ${r.reason}`] = (failed[`défaite : ${r.reason}`] || 0) + 1;
      if (ok.length && ok[0].lossPct !== undefined) {
        detail = `navires perdus ${range(ok.map((r) => r.lossPct), 1)} % (moy. ${fr(mean(ok.map((r) => r.lossPct)), 1)}) ; U-Boote coulés ${fr(mean(ok.map((r) => r.uboatsSunk)), 1)} ; arrêts ${range(ok.map((r) => r.stops))} (moy. ${fr(mean(ok.map((r) => r.stops)))}) ; carburant ${fr(mean(ok.map((r) => r.fuel)))} t`;
      } else if (ok.length) {
        detail = `abattus ${fr(mean(ok.map((r) => r.down)))} (${range(ok.map((r) => r.down))}) ; perdus ${fr(mean(ok.map((r) => r.rafLost)))} ; chasse ${fr(mean(ok.map((r) => r.fighterShare * 100)))} % ; bombardements ${fr(mean(ok.map((r) => r.bombed)))} ; fatigue max ${fr(Math.max(...ok.map((r) => r.maxFatigue)))}`;
      }
      const slow = ok.filter((r) => r.steps);
      if (slow.length) detail += ` ; pas le plus long ${fr(Math.max(...slow.map((r) => r.steps.maxMs)))} ms, ${slow.reduce((n, r) => n + r.steps.over20, 0)} pas de plus de 20 ms`;
    }
    const errors = list.length - ok.length;
    lines.push(`| ${scenario} | ${preset} | ${conduct} | ${wins} sur ${ok.length}${errors ? ` (${errors} erreurs)` : ''} | ${detail} | ${Object.entries(failed).map(([k, n]) => `${k} ×${n}`).join(', ') || '—'} |`);
  }
  return lines.join('\n');
}

function readRows(file) {
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function main() {
  const summaryOf = opt('summary', null);
  if (summaryOf) {
    console.log(summarize(readRows(`${here}out/${summaryOf}.jsonl`)));
    return;
  }
  const name = opt('name', 'mesure');
  const seeds = Number(opt('seeds', 10));
  const only = opt('only', null);
  const workers = Number(opt('workers', Math.max(1, cpus().length)));
  mkdirSync(`${here}out`, { recursive: true });
  const out = `${here}out/${name}.jsonl`;
  if (existsSync(out) && !args.includes('--append')) rmSync(out);
  const jobs = [];
  for (const [scenario, preset, conduct] of MATRIX) {
    if (only && !`${scenario}/${preset}/${conduct}`.includes(only)) continue;
    for (let seed = 1; seed <= seeds; seed++) jobs.push({ scenario, preset, conduct, seed });
  }
  let next = 0;
  let done = 0;
  const t0 = Date.now();
  const runOne = () => {
    if (next >= jobs.length) return Promise.resolve();
    const job = jobs[next++];
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [`${here}run.mjs`, job.scenario, job.conduct, job.preset, String(job.seed)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '';
      let err = '';
      p.stdout.on('data', (d) => (buf += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => {
        let row;
        try {
          const r = JSON.parse(buf.trim().split('\n').pop());
          const { cfg, log, stopTimes, ...rest } = r;
          row = { ...job, ...rest };
        } catch {
          row = { ...job, error: (err || buf).slice(0, 600), code };
        }
        appendFileSync(out, `${JSON.stringify(row)}\n`);
        done++;
        process.stderr.write(`\r${done}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)   `);
        resolve(runOne());
      });
    });
  };
  await Promise.all(Array.from({ length: workers }, runOne));
  process.stderr.write('\n');
  console.log(summarize(readRows(out)));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
