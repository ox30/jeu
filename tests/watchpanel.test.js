// The watch reports on the page: the folded line, the filters, the report unfolded with the
// button that answers a decision, and every text it needs in fr.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run, runTo } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { project } from '../src/sim/geo.js';
import { joinConvoy } from '../src/sim/orders.js';
import { pendingDecisions } from '../src/sim/watch.js';
import { ORDER_NAMES } from '../src/sim/comms.js';
import { SIGNAL_FILTERS, createSignals, headlineText, passesFilter, reportHtml, unreadCount, watchLabel } from '../src/ui/watchPanel.js';

setDictionary(data.fr);
const H = 3600;

function game() {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  runTo(w, 6 * H + 60);
  const c = w.convoys.find((x) => x.type === 'ocean');
  const [x, y] = project(-25, 55);
  Object.assign(c, { x, y, px: x, py: y, route: [[x + 4000, y]], routeLocked: 0, plan: [], est: null, fix: null });
  for (const u of w.uboats) Object.assign(u, { state: 'gone', goneAt: w.t });
  return { w, c, app: { world: w, signals: createSignals() } };
}

test('a watch is one folded line: its day and hours, and what happened', () => {
  const { w, c } = game();
  run(w, 4 * H, (e) => e.type === 'seaStop');
  const r = w.watch.reports[w.watch.reports.length - 1];
  assert.equal(watchLabel(w, r), '10 janvier, 12-16 h');
  assert.equal(headlineText(w, r), '1 décision(s) à prendre');
  assert.equal(headlineText(w, { headline: [{ key: 'attackedLost', convoyId: c.id, n: 2 }] }), 'HX 102 attaqué, 2 navire(s) coulé(s)');
  assert.equal(headlineText(w, { headline: [{ key: 'quiet' }] }), 'rien à signaler');
  // The watch from 20 h to midnight belongs to the day it began in.
  run(w, 8 * H);
  assert.equal(watchLabel(w, w.watch.reports[w.watch.reports.length - 1]), '10 janvier, 20-24 h');
});

test('the filters: all, to decide, attacks and losses, U-boats, one convoy or group', () => {
  assert.deepEqual(SIGNAL_FILTERS, ['all', 'decide', 'attacks', 'uboats']);
  const quiet = { id: 'W1', convoys: [{ id: 'hx102' }], escorts: [{ id: 'eg1', state: 'inPort' }] };
  const attack = { id: 'W2', convoys: [{ id: 'hx103', attacks: 1 }], notes: [{ type: 'uboatAttack', family: 'attack', convoyId: 'hx103' }] };
  const decide = { id: 'W3', decisions: [{ kind: 'reach', key: 'reach:hx102' }] };
  const boat = { id: 'W4', notes: [{ type: 'uboatSighted', family: 'uboat', byId: 'eg2' }] };
  const fix = { id: 'W5', notes: [{ type: 'dfFix', family: 'intel' }] };
  const pass = (f, unit = '') => [quiet, attack, decide, boat, fix].filter((r) => passesFilter(r, f, unit)).map((r) => r.id);
  assert.deepEqual(pass('all'), ['W1', 'W2', 'W3', 'W4', 'W5']);
  assert.deepEqual(pass('decide'), ['W3']);
  assert.deepEqual(pass('attacks'), ['W2']);
  assert.deepEqual(pass('uboats'), ['W4', 'W5']);
  assert.deepEqual(pass('all', 'hx103'), ['W2']);
  assert.deepEqual(pass('all', 'hx102'), ['W1']);
  assert.deepEqual(pass('all', 'eg2'), ['W4']);
  assert.deepEqual(pass('all', 'eg1'), [], 'a group idle in port is not what a report is about');
});

test('the report unfolded: the decision with the button that answers it, then settled', () => {
  const { w, c, app } = game();
  run(w, 4 * H, (e) => e.type === 'seaStop');
  const r = w.watch.reports[w.watch.reports.length - 1];
  const html = reportHtml(app, r);
  assert.match(html, /À décider/);
  assert.match(html, /HX 102 navigue sans escorte/);
  const sends = html.match(/data-watch="send"/g) || [];
  assert.equal(sends.length, 3, 'the three nearest groups are proposed');
  assert.match(html, /Envoyer EG \d \((la Clyde|Liverpool)\)/);
  assert.match(html, /Convois/);
  assert.match(html, /position estimée/, 'radio silence: the place of the convoy is an estimate');
  assert.match(html, /Groupes d(&#39;|')escorte/);
  assert.match(html, /Grenades 160\/160/);
  assert.match(html, /consigne Rester ; grenadage plein/);
  assert.equal(unreadCount(app), 2, 'the sailing of noon and this decision; a quiet watch is not counted');
  // The decision answered: no button left, and it says so.
  const d = pendingDecisions(w).find((x) => x.kind === 'reach');
  assert.ok(joinConvoy(w, w.escorts.find((e) => e.id === d.groups[0]), c.id));
  const after = reportHtml(app, r);
  assert.ok(!/data-watch="send"/.test(after));
  assert.match(after, /\(réglé\)/);
});

test('every text of the watch reports and of radio silence is in fr.json', () => {
  const fr = data.fr;
  for (const key of ['attackedLost', 'attacked', 'uboatSunk', 'decisions', 'arrived', 'departed', 'chargesOut', 'radar', 'markers', 'quiet']) {
    assert.equal(typeof fr.watch.head[key], 'string', `watch.head.${key}`);
  }
  for (const key of ['reach', 'waitingEscort', 'waitingConvoy', 'charges', 'chargesAlone', 'marker']) assert.equal(typeof fr.watch.decide[key], 'string', `watch.decide.${key}`);
  for (const key of ['inPort', 'refit', 'escorting', 'hunting', 'huntingAlone', 'waiting', 'homeward', 'joining', 'atSea', 'dry']) {
    assert.equal(typeof fr.watch.order[key], 'string', `watch.order.${key}`);
  }
  for (const f of [...SIGNAL_FILTERS, 'unit']) assert.equal(typeof fr.watch.filters[f], 'string', `watch.filters.${f}`);
  for (const name of ORDER_NAMES) assert.equal(typeof fr.comms.orders[name], 'string', `comms.orders.${name}`);
  for (const how of ['port', 'tracked', 'aircraft', 'signal', 'attack']) assert.equal(typeof fr.comms.fix[how], 'string', `comms.fix.${how}`);
  for (const via of ['direct', 'lamp', 'radio']) assert.equal(typeof fr.comms.channel[via], 'string', `comms.channel.${via}`);
  for (const v of ['decision', 'twice', 'every']) assert.equal(typeof fr.settings.watchStopsChoices[v], 'string');
  for (const v of ['direct', 'silence']) assert.equal(typeof fr.settings.seaCommsChoices[v], 'string');
  for (const why of ['Lost', 'Damaged', 'Charges']) {
    assert.equal(typeof fr.log[`escortHuntOver${why}`], 'string');
    assert.equal(typeof fr.log[`escortHuntOver${why}Alone`], 'string');
  }
  for (const key of ['orderDelivered', 'orderDeliveredShip', 'orderFailed', 'orderByLamp', 'positionReported', 'aircraftAttack', 'escortRadar', 'escortChargesOut']) {
    assert.equal(typeof fr.log[key], 'string', `log.${key}`);
  }
  assert.equal(typeof fr.alerts.seaStop.text, 'string');
  assert.equal(typeof fr.alerts.seaStop.missed, 'string');
});
