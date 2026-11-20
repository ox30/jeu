// The bars of the objectives, judged without playing again. The games of the air battles are
// played once by the automatic player, and what each objective measures is kept whatever its
// bar (the share of a cargo delivered, the aircraft shot down, the fighters left, the hours
// out of service…). The same games are then judged as often as wanted under other bars: a
// threshold is chosen on thirty seeds in a second, and checked on fresh ones.
//   node tools/bot/thresholds.mjs --collect m2.10 [--seeds 30] [--first 1] [--only kanalkampf,adlertag/standard] [--workers 2]
//   node tools/bot/thresholds.mjs --judge m2.10 [--set kanalkampf.convoy:cw=0.7,adlertag.fighters=0.44] [--split 10,30]
// --collect adds to tools/bot/out/<name>.raw.jsonl the games it does not hold yet (it can be
// stopped and run again, and more seeds added with --first). --judge prints the victories
// under the bars of the scenarios as they are written, or under those given by --set
// (scenario.what=value), by ranges of seeds (--split 10,30: seeds 1-10, 11-30, and all).
// Only the bars are judged again: a defeat by a rule of the scenario (no fuel, no fighters
// left) stays a defeat, and a change of the simulation needs the games played again.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONDUCTS, MATRIX, SEA_SCENARIOS } from './conducts.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * What an objective measures: its name in the files, its bar as the scenario writes it, and
 * whether a measured value passes a bar. (The objectives that are not a number against a bar
 * keep the verdict of the game: 1 when done.)
 */
export function barOf(o, index) {
  const atLeast = (v, bar) => v >= bar;
  const atMost = (v, bar) => v <= bar;
  switch (o.type) {
    case 'convoyDelivered': return { key: `convoy:${o.convoy}`, bar: o.share, pass: atLeast };
    case 'enemyDown': return { key: 'down', bar: o.count, pass: atLeast };
    case 'fighterStrength': return { key: 'fighters', bar: o.share, pass: atLeast };
    case 'basesOperational': return { key: 'bases', bar: o.min, pass: atLeast };
    case 'radarsOperational': return { key: 'radars', bar: o.min, pass: atLeast };
    case 'outOfServiceBelow': return { key: o.airfields ? 'fieldsOutH' : 'radarsOutH', bar: o.hours, pass: atMost };
    case 'siteDamageBelow': return { key: `damage:${o.site}`, bar: o.max, pass: atMost };
    default: return { key: `done:${index}:${o.type}`, bar: 1, pass: atLeast };
  }
}

/** The objectives a game missed under these bars (Map of key → { bar, pass }); a defeat by rule comes first. */
export function missed(row, bars) {
  if (row.reason) return [`défaite : ${row.reason}`];
  const out = [];
  for (const [key, { bar, pass }] of bars) if (!pass(row.values[key], bar)) out.push(key);
  return out;
}

if (!isMainThread) {
  // One game, and what its objectives measured at the end.
  const { runAir } = await import('./air.mjs');
  const O = await import('../../src/sim/objectives.js');
  const { cargoShare } = await import('../../src/sim/convoy.js');
  const { scenario, preset, conduct, seed } = workerData;
  const cfg = CONDUCTS[scenario][conduct];
  const own = (cfg.byScenario && cfg.byScenario[scenario]) || {};
  const w = runAir({ ...cfg, ...own, scenario, preset, seed, returnWorld: true });
  const values = {};
  w.objectives.forEach((o, index) => {
    const { key } = barOf(o, index);
    if (o.type === 'convoyDelivered') {
      const c = w.convoys.find((x) => x.id === o.convoy);
      values[key] = c && c.state === 'arrived' ? Math.round(cargoShare(c, w) * 10000) / 10000 : -1;
    } else if (o.type === 'enemyDown') values[key] = O.enemyDown(w);
    else if (o.type === 'fighterStrength') values[key] = Math.round(O.fighterShare(w) * 10000) / 10000;
    else if (o.type === 'basesOperational') values[key] = O.basesInService(w, o);
    else if (o.type === 'radarsOperational') values[key] = O.radarsInService(w, o);
    else if (o.type === 'outOfServiceBelow') values[key] = Math.round(O.outOfServiceHours(o) * 1000) / 1000;
    else if (o.type === 'siteDamageBelow') values[key] = Math.round(w.sites.get(o.site).damage * 1000) / 1000;
    else values[key] = o.done ? 1 : 0;
  });
  parentPort.postMessage({ scenario, preset, conduct, seed, outcome: w.outcome, reason: w.defeatReason || null, values });
} else {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const readRows = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const lineOf = (r) => `${r.scenario}/${r.preset}/${r.conduct}`;

  if (opt('collect', null)) {
    const out = `${here}out/${opt('collect')}.raw.jsonl`;
    mkdirSync(`${here}out`, { recursive: true });
    const seeds = Number(opt('seeds', 30));
    const first = Number(opt('first', 1));
    const only = opt('only', null);
    const held = new Set(readRows(out).map((r) => `${lineOf(r)}/${r.seed}`));
    const jobs = [];
    for (const [scenario, preset, conduct] of MATRIX) {
      if (scenario === 'campagne' || SEA_SCENARIOS.includes(scenario)) continue; // the air battles, one at a time
      if (only && !only.split(',').some((part) => `${scenario}/${preset}/${conduct}`.includes(part))) continue;
      for (let seed = first; seed < first + seeds; seed++) if (!held.has(`${scenario}/${preset}/${conduct}/${seed}`)) jobs.push({ scenario, preset, conduct, seed });
    }
    let next = 0;
    let done = 0;
    const t0 = Date.now();
    const runOne = () => new Promise((resolve) => {
      if (next >= jobs.length) {
        resolve();
        return;
      }
      const job = jobs[next++];
      const worker = new Worker(new URL(import.meta.url), { workerData: job });
      worker.on('message', (row) => appendFileSync(out, `${JSON.stringify(row)}\n`));
      worker.on('error', (e) => process.stderr.write(`\n${JSON.stringify(job)}: ${e.message}\n`));
      worker.on('exit', () => {
        done++;
        process.stderr.write(`\r${done}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)} s)   `);
        resolve(runOne());
      });
    });
    await Promise.all(Array.from({ length: Number(opt('workers', Math.max(1, cpus().length))) }, runOne));
    process.stderr.write(`\n${jobs.length} game(s) added to ${out}\n`);
  } else if (opt('judge', null)) {
    const { scenarioData } = await import('./game.mjs');
    const rows = readRows(`${here}out/${opt('judge')}.raw.jsonl`);
    // The bars as the scenarios write them, then those given on the command line.
    const bars = new Map();
    for (const id of new Set(rows.map((r) => r.scenario))) bars.set(id, new Map(scenarioData(id).objectives.map((o, i) => [barOf(o, i).key, barOf(o, i)])));
    let agree = 0;
    for (const r of rows) if ((missed(r, bars.get(r.scenario)).length === 0 ? 'victory' : 'defeat') === r.outcome) agree++;
    const set = opt('set', null);
    for (const part of set ? set.split(',') : []) {
      const [where, value] = part.split('=');
      const scenario = where.slice(0, where.indexOf('.'));
      const key = where.slice(where.indexOf('.') + 1);
      const of = bars.get(scenario);
      if (!of || !of.has(key)) throw new Error(`no such bar: ${where} (known: ${[...bars].flatMap(([id, m]) => [...m.keys()].map((k) => `${id}.${k}`)).join(', ')})`);
      of.set(key, { ...of.get(key), bar: Number(value) });
    }
    const ends = opt('split', '').split(',').filter(Boolean).map(Number);
    const all = Math.max(...rows.map((r) => r.seed));
    const ranges = [...ends.map((end, i) => [i ? ends[i - 1] + 1 : Math.min(...rows.map((r) => r.seed)), end]), [Math.min(...rows.map((r) => r.seed)), all]];
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(lineOf(r))) groups.set(lineOf(r), []);
      groups.get(lineOf(r)).push(r);
    }
    console.log(`${rows.length} parties ; sous les barres des scénarios, ${rows.length - agree} verdict(s) différent(s) de celui du jeu${set ? ` ; barres changées : ${set}` : ''}`);
    console.log(`| Scénario | Préréglage | Conduite | ${ranges.map(([a, b]) => `Graines ${a} à ${b}`).join(' | ')} | Objectifs manqués |`);
    console.log(`| --- | --- | --- | ${ranges.map(() => '---').join(' | ')} | --- |`);
    for (const [line, list] of groups) {
      const of = bars.get(list[0].scenario);
      const cells = ranges.map(([a, b]) => {
        const sel = list.filter((r) => r.seed >= a && r.seed <= b);
        return `${sel.filter((r) => missed(r, of).length === 0).length} sur ${sel.length}`;
      });
      const why = {};
      for (const r of list) for (const k of missed(r, of)) why[k] = (why[k] || 0) + 1;
      console.log(`| ${line.split('/').join(' | ')} | ${cells.join(' | ')} | ${Object.entries(why).map(([k, n]) => `${k} ×${n}`).join(', ') || '—'} |`);
    }
  } else {
    console.log('node tools/bot/thresholds.mjs --collect <name> [--seeds 30] [--first 1] [--only …] [--workers 2]\nnode tools/bot/thresholds.mjs --judge <name> [--set scenario.what=value,…] [--split 10,30]');
  }
}
