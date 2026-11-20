// Makes the fixture save-2.11.1-kanalkampf.json.gz from a checkout of version 2.11.1
// (git worktree add ../jeu-2.11.1 5ac2e08):
//   node tests/fixtures/make-save-2.11.1.mjs /path/to/jeu-2.11.1
// Kanalkampf on its second morning, as a player of 2.11.1 could leave it — the last version
// where the sea of the air battles was lived as it came, without watches (`watch` is nothing
// in the save, and the convoys are seen where they are):
//   - HX 55 on the Admiralty's route, EG 1 on its way to it;
//   - HX 57 left without a route: it keeps its course;
//   - CW 7 sailed on the Admiralty's route.
// Version 2.12 puts every scenario with ships at the rhythm of the watches: this game must go
// on at that rhythm (tests/oldsaves.test.js).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [checkout] = process.argv.slice(2);
if (!checkout) throw new Error('usage: make-save-2.11.1.mjs <checkout of version 2.11.1>');
const load = (path) => import(pathToFileURL(resolve(checkout, path)).href);
const { sim, orders: O, makeWorld } = await load('tools/bot/game.mjs');
const { VERSION } = await load('src/core/version.js');
if (VERSION !== '2.11.1') throw new Error(`this checkout is version ${VERSION}, not 2.11.1`);
const here = fileURLToPath(new URL('.', import.meta.url));

const w = makeWorld('kanalkampf', { preset: 'standard', seed: 7 });
if (w.watch !== null) throw new Error('this version already keeps watches in Kanalkampf');
const convoy = (id) => w.convoys.find((c) => c.id === id);
const run = (seconds) => {
  for (let i = 0; i < seconds; i++) {
    sim.world.step(w, 1);
    w.events.length = 0;
  }
};
const H = 3600;

const hx55 = convoy('hx55');
const routed = O.routeConvoy(w, hx55, hx55.admiraltyRoute.slice(sim.convoy.admiraltyAhead(hx55)));
const joined = O.joinConvoy(w, w.escorts.find((e) => e.id === 'eg1'), 'hx55');
const cw = convoy('cw');
const sailed = O.routeConvoy(w, cw, cw.admiraltyRoute.slice(1));
run(26 * H); // 08:00 on the second morning

const snap = JSON.parse(JSON.stringify(sim.save.snapshot(w)));
const note = w.convoys.map((c) => `${c.id} ${c.state}, route ${c.route.length}`).join(' ; ');
const text = JSON.stringify({ game: 'jeu-1940', madeBy: VERSION, note: `standard, seed 7, t ${w.t} ; ${note}`, snap });
writeFileSync(`${here}save-2.11.1-kanalkampf.json.gz`, gzipSync(text, { level: 9 }));
console.log(`orders: HX 55 routed ${routed.ok}, EG 1 sent ${joined === true || Boolean(joined && joined.ok)}, CW 7 sailed ${sailed.ok}`);
console.log(`format ${snap.version}, watch ${JSON.stringify(snap.watch)}`);
console.log(note);
console.log(`${(text.length / 1024).toFixed(0)} KiB of JSON`);
