// Makes the fixture save-2.10.2-hiver-atlantique-sorties.json.gz from a checkout of version
// 2.10.2 (git worktree add ../jeu-2.10.2 b7e1c8c):
//   node tests/fixtures/make-save-2.10.2.mjs /path/to/jeu-2.10.2
// The Atlantic on its first morning, with the escort groups as a player of 2.10.2 could leave
// them, each in a state that version 2.10.3 keeps otherwise (tests/oldsaves.test.js):
//   - EG 1, Liverpool: a channel chosen and a sailing scheduled, its hour past. Version 2.10.2
//     never sailed it (« ni route ni étapes »): the order waits.
//   - EG 3, Liverpool: a channel chosen, a sailing scheduled for later, a line drawn from the
//     port that waits behind the channel.
//   - EG 2, the Clyde: a line drawn from the port, the group going down its channel. Its way
//     out is counted in `routeLocked`, at the wrong end of its route.
//   - EG 4, the Clyde: sailed to the roads on « Appareiller », waiting there.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [checkout] = process.argv.slice(2);
if (!checkout) throw new Error('usage: make-save-2.10.2.mjs <checkout of version 2.10.2>');
const load = (path) => import(pathToFileURL(resolve(checkout, path)).href);
const { sim, orders: O, makeWorld } = await load('tools/bot/game.mjs');
const { scheduleSail } = await load('src/sim/timetable.js');
const { project } = await load('src/sim/geo.js');
const { VERSION } = await load('src/core/version.js');
if (VERSION !== '2.10.2') throw new Error(`this checkout is version ${VERSION}, not 2.10.2`);
const here = fileURLToPath(new URL('.', import.meta.url));

const w = makeWorld('hiver-atlantique', { preset: 'standard', seed: 5 });
const group = (id) => w.escorts.find((e) => e.id === id);
const run = (seconds) => {
  for (let i = 0; i < seconds; i++) {
    sim.world.step(w, 1);
    w.events.length = 0;
  }
};
const H = 3600;

O.setExitChannel(w, group('eg1'), "Nord de l'Irlande");
scheduleSail(w, group('eg1'), w.t + 1 * H);
O.setExitChannel(w, group('eg3'), 'Canal Saint-Georges');
scheduleSail(w, group('eg3'), w.t + 8 * H);
const waiting = O.routeConvoy(w, group('eg3'), [project(-9, 50.5), project(-12, 50)]);
const sailed = O.routeConvoy(w, group('eg2'), [project(-11, 56.5), project(-14, 57), project(-17, 57.5)]);
O.sailEscort(w, group('eg4'));
run(4 * H);

const snap = JSON.parse(JSON.stringify(sim.save.snapshot(w)));
const note = w.escorts.map((e) => `${e.id} ${e.state}, route ${e.route.length}, locked ${e.routeLocked}, exit ${e.exitChannel}, schedule ${e.schedule ? `${e.schedule.at}${e.schedule.delayed ? ' delayed' : ''}` : 'none'}`).join(' ; ');
const text = JSON.stringify({ game: 'jeu-1940', madeBy: VERSION, note: `standard, seed 5, t ${w.t} ; ${note}`, snap });
writeFileSync(`${here}save-2.10.2-hiver-atlantique-sorties.json.gz`, gzipSync(text, { level: 9 }));
console.log(`routes: waiting ${waiting.ok}, sailed ${sailed.ok}`);
console.log(note);
console.log(`${(text.length / 1024).toFixed(0)} KiB of JSON`);
