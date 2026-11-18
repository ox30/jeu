// Makes the saved games kept as fixtures, from a checkout of an EARLIER version of the game
// (2.6.1: git worktree add ../jeu-2.6.1 95379ee) with this repository's tools/bot copied into it:
//   node tests/fixtures/make-saves.mjs /path/to/jeu-2.6.1 2.6.1
// Each file is a game as that version saved it (the `snap` of its browser save), gzipped.
// The tests restore them with the current code (tests/oldsaves.test.js).
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [checkout, version] = process.argv.slice(2);
if (!checkout || !version) throw new Error('usage: make-saves.mjs <checkout of the old version> <its version>');
const bot = (name) => import(pathToFileURL(resolve(checkout, 'tools/bot', name)).href);
const { sim, orders: O } = await bot('game.mjs');
const { runAir } = await bot('air.mjs');
const { runSea } = await bot('sea.mjs');
const mru = await import(pathToFileURL(resolve(checkout, 'src/sim/mru.js')).href);
const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(here, { recursive: true });

function keep(name, world, note) {
  const snap = JSON.parse(JSON.stringify(sim.save.snapshot(world)));
  const text = JSON.stringify({ game: 'jeu-1940', madeBy: version, note, snap });
  writeFileSync(`${here}save-${version}-${name}.json.gz`, gzipSync(text, { level: 9 }));
  console.log(`${name}: day ${(world.t / 86400).toFixed(2)}, ${(text.length / 1024).toFixed(0)} KiB of JSON`);
}

// Adlertag after the relief squadron has arrived, a mobile station on its way, a wing formed.
{
  const w = runAir({ scenario: 'adlertag', preset: 'standard', seed: 3, days: 2.6, returnWorld: true });
  const field = w.byId.airfield.get('tangmere');
  const station = w.mru.available > 0 && mru.deployMru(w, field.x, field.y - 6, 180).ok;
  const ready = w.squadrons.filter((s) => s.role === 'fighter' && s.state === 'ready' && !s.formation);
  const f = ready.length >= 2 ? O.newFormation(w, 'air', ready[0].id) : null;
  if (f) O.addMember(w, f, ready[1].id);
  keep('adlertag', w, `standard, seed 3; relief arrived: ${w.squadrons.some((s) => s.id === '266')}; station ordered: ${station}; wing: ${Boolean(f)}`);
}
// 15 September in a campaign in Réaliste: the fighters start at 60 % of their establishment.
{
  const w = runAir({ scenario: 'quinze-septembre', preset: 'realistic', seed: 2, days: 0.2, carry: { fighterShare: 0.6, from: 'adlertag' }, returnWorld: true });
  const fighters = w.squadrons.filter((s) => s.role === 'fighter');
  keep('quinze-septembre-campagne', w, `realistic, seed 2, carry 0.6; ${fighters.reduce((n, s) => n + s.aircraft, 0)} fighters of ${fighters.reduce((n, s) => n + s.aircraftStart, 0)}`);
}
// The Atlantic on its fourteenth day: stragglers, a Hudson bought, a group escorting.
{
  const w = runSea({ preset: 'standard', seed: 3, days: 14, boost: true, buy: [{ id: 'hudson', day: 0 }], returnWorld: true });
  keep('hiver-atlantique', w, `standard, seed 3; stragglers: ${w.convoys.filter((c) => c.straggler).length}; Hudson: ${w.squadrons.some((s) => s.type === 'Hudson')}`);
}
