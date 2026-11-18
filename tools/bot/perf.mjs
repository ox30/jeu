// How long the simulation steps take: one game per scenario by the automatic player, one after
// the other, on a machine doing nothing else (two games side by side spoil the figures).
// The criterion: no step over 20 ms on 80 days of Atlantic.
//   node tools/bot/perf.mjs [--seeds 2] [--only hiver]
import { play } from './run.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const seeds = Number(opt('seeds', 2));
const only = opt('only', null);
const GAMES = [
  ['kanalkampf', 'simple', 'standard'],
  ['adlertag', 'simple', 'standard'],
  ['quinze-septembre', 'simple', 'standard'],
  ['hiver-atlantique', 'simple', 'standard'],
  ['hiver-atlantique', 'chasser', 'realistic'],
];

console.log('| Scénario | Conduite | Graine | Pas | Durée | Pas le plus long | Pas de plus de 20 ms | Pas de plus de 2 ms | Un des pires |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
let over = 0;
for (const [scenario, conduct, preset] of GAMES) {
  if (only && !scenario.includes(only)) continue;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = play(scenario, conduct, preset, seed);
    const s = r.steps;
    over += s.over20;
    const top = [...(s.worst || [])].sort((a, b) => b.ms - a.ms)[0];
    const worst = top ? `jour ${(top.t / 86400).toFixed(1)}, ${top.ms} ms${top.events ? ` (${top.events})` : ''}` : '—';
    console.log(`| ${scenario} | ${conduct}, ${preset} | ${seed} | ${s.count} | ${s.totalS.toFixed(1)} s | ${s.maxMs.toFixed(1)} ms | ${s.over20} | ${s.over2} | ${worst} |`);
  }
}
if (over) process.exitCode = 1;
