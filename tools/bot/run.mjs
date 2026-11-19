// One game by the automatic player; prints its result as one line of JSON.
//   node tools/bot/run.mjs <scenario|campagne> [conduct or JSON settings] [preset] [seed]
//   node tools/bot/run.mjs adlertag simple standard 3
//   node tools/bot/run.mjs hiver-atlantique '{"behaviour":"hunt","preset":"realistic","seed":7}'
import { runAir, runChain } from './air.mjs';
import { runSea } from './sea.mjs';
import { CONDUCTS, SEA_SCENARIOS } from './conducts.mjs';

export function play(scenario, conduct, preset, seed, extra = {}) {
  const table = CONDUCTS[scenario === 'campagne' ? 'adlertag' : scenario];
  if (!table) throw new Error(`unknown scenario: ${scenario}`);
  const cfg = typeof conduct === 'string' ? table[conduct] : conduct;
  if (!cfg) throw new Error(`unknown conduct for ${scenario}: ${conduct}`);
  // (A conduct can differ by battle: `byScenario`, in a single battle as in the campaign.)
  const own = scenario === 'campagne' ? {} : (cfg.byScenario && cfg.byScenario[scenario]) || {};
  const full = { ...cfg, ...own, scenario, ...(preset ? { preset } : {}), ...(seed !== null && seed !== undefined ? { seed } : {}), ...extra };
  if (scenario === 'campagne') return runChain(full);
  return SEA_SCENARIOS.includes(scenario) ? runSea(full) : runAir(full);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [scenario = 'adlertag', what = 'simple', preset = null, seed = null] = process.argv.slice(2);
  const conduct = what.startsWith('{') ? JSON.parse(what) : what;
  const t0 = performance.now();
  const result = play(scenario, conduct, preset, seed === null ? null : Number(seed));
  console.log(JSON.stringify({ conduct: typeof conduct === 'string' ? conduct : 'custom', ...result, ms: Math.round(performance.now() - t0) }));
}
