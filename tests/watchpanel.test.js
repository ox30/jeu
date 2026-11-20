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
import {
  SIGNAL_FILTERS, createSignals, headlineText, onWatchClick, openWatch, passesFilter, renderSignals, reportHtml, unreadCount, watchLabel,
} from '../src/ui/watchPanel.js';
import { toolOffered } from '../src/ui/offered.js';

setDictionary(data.fr);
const H = 3600;
const WATCH = 4 * H;

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

/** A dialog of the page, enough for the report of a watch to open in it. */
function fakeDialog() {
  return {
    dataset: {}, innerHTML: '', open: false, addEventListener() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
}

/** A click on a button of the « Signaux » tab: `watch` is its action, `reportId` the line it is on. */
function click(app, watch, reportId = null) {
  const line = reportId ? { dataset: { reportId } } : null;
  const b = { dataset: { watch }, closest: (sel) => (sel === '[data-report-id]' ? line : null) };
  return onWatchClick(app, { target: { closest: (sel) => (sel === '[data-watch]' ? b : null) } });
}

test('the report of a watch closed without an answer opens again as it was: the top bar, the tab, each line', () => {
  const { w, app } = game();
  app.el = { dlgWatch: fakeDialog(), signals: {} };
  const dlg = app.el.dlgWatch;
  // The « Quart » button: from the start of every game at the rhythm of the watches (2.12),
  // and only there.
  assert.equal(toolOffered({ world: makeWorld('standard', {}, 'hiver-atlantique') }, 'watch'), true, 'no report yet: the button is there');
  assert.equal(toolOffered({ world: makeWorld('standard', {}, 'kanalkampf') }, 'watch'), true, 'Kanalkampf has ships');
  assert.equal(toolOffered({ world: makeWorld('standard', {}, 'quinze-septembre') }, 'watch'), false, 'no ship, no watch');
  run(w, 4 * H, (e) => e.type === 'seaStop');
  assert.equal(toolOffered(app, 'watch'), true);
  const stopped = w.watch.reports[w.watch.reports.length - 1];
  // As at the relief: the page with what waits and the buttons that answer.
  openWatch(app, stopped.id);
  const first = dlg.innerHTML;
  assert.match(first, /Relève de 16 h/);
  assert.match(first, /HX 102 navigue sans escorte/);
  assert.equal((first.match(/data-watch="send"/g) || []).length, 3);
  // Closed without an answer, then the « Quart » button (or its key Q): the very same page.
  dlg.close();
  dlg.innerHTML = '';
  openWatch(app);
  assert.equal(dlg.open, true);
  assert.equal(dlg.innerHTML, first, 'exactly the page of the relief');
  dlg.close();
  // Two watches on. The tab offers the last report, and each line its own.
  app.paused = false;
  run(w, 8 * H);
  const latest = w.watch.reports[w.watch.reports.length - 1];
  assert.notEqual(latest.id, stopped.id);
  app.signals.tab = 'signals';
  renderSignals(app);
  const tab = app.el.signals.innerHTML;
  assert.match(tab, /data-watch="last">Rouvrir le rapport de la relève de 0 h</);
  assert.equal((tab.match(/data-watch="page"/g) || []).length, w.watch.reports.length, 'a button « Ouvrir » on every line');
  assert.ok(click(app, 'last'));
  assert.deepEqual([dlg.open, dlg.dataset.reportId], [true, latest.id]);
  dlg.close();
  assert.ok(click(app, 'page', stopped.id));
  assert.deepEqual([dlg.open, dlg.dataset.reportId], [true, stopped.id]);
  assert.match(dlg.innerHTML, /Relève de 16 h/);
  assert.equal((dlg.innerHTML.match(/data-watch="send"/g) || []).length, 3, 'the decision still waits: its buttons are there');
  // Answered from the page opened again, it shows as settled.
  const d = pendingDecisions(w).find((x) => x.kind === 'reach');
  assert.ok(joinConvoy(w, w.escorts.find((e) => e.id === d.groups[0]), d.unitId));
  openWatch(app, stopped.id);
  assert.ok(!/data-watch="send"/.test(dlg.innerHTML));
  assert.match(dlg.innerHTML, /\(réglé\)/);
});

// ---- 2.12: the « Quart » button from the start, and the convoy without a route ----

test('before the first relief the page says that no report is written yet, when the first will be, and what waits already', () => {
  const w = makeWorld('standard', {}, 'kanalkampf');
  const app = { world: w, signals: createSignals(), el: { dlgWatch: fakeDialog(), signals: {} } };
  const dlg = app.el.dlgWatch;
  assert.equal(w.watch.reports.length, 0);
  openWatch(app); // the button, or its key Q
  assert.equal(dlg.open, true, 'the page opens without a report');
  assert.match(dlg.innerHTML, /Rapport de quart/);
  assert.match(dlg.innerHTML, /Aucun rapport n(&#39;|')est encore écrit : le premier viendra à la relève de 8 h\./);
  // The two ocean convoys came without a route: asked from the first second, with the buttons that answer.
  assert.match(dlg.innerHTML, /À décider/);
  assert.match(dlg.innerHTML, /HX 55 n(&#39;|')a plus de route à suivre : il garde son cap au 72°/);
  assert.match(dlg.innerHTML, /HX 57 n(&#39;|')a plus de route à suivre : il garde son cap au 60°/);
  assert.equal((dlg.innerHTML.match(/data-watch="admiralty"/g) || []).length, 2);
  assert.match(dlg.innerHTML, /data-watch="admiralty" data-id="hx55"[^>]*>Amirauté</);
  assert.ok((dlg.innerHTML.match(/data-watch="see"/g) || []).length >= 2, '« Voir » on each');
  assert.ok(!/data-watch="resume"/.test(dlg.innerHTML), 'nothing stopped the game: one button, « Fermer »');
  // « Amirauté » for HX 55: the order leaves by radio (silence), the question is answered, and the page says so.
  const hx55 = w.convoys.find((c) => c.id === 'hx55');
  const b = { dataset: { watch: 'admiralty', id: 'hx55' }, closest: () => null };
  assert.ok(onWatchClick(app, { target: { closest: (sel) => (sel === '[data-watch]' ? b : null) } }));
  assert.ok(w.signals.some((x) => x.unitId === 'hx55' && x.name === 'route'), 'on its way, for the relief');
  assert.match(dlg.innerHTML, /HX 55 n(&#39;|')a plus de route à suivre[^<]*<em>\(réglé\)<\/em>/);
  assert.equal((dlg.innerHTML.match(/data-watch="admiralty"/g) || []).length, 1, 'HX 57 still waits');
  dlg.close();
  // After the first relief the button opens the report, as before; the route has gone out.
  run(w, 2 * H);
  assert.ok(hx55.route.length > 0);
  openWatch(app);
  assert.match(dlg.innerHTML, /Relève de 8 h/);
  assert.match(dlg.innerHTML, /HX 57 n(&#39;|')a plus de route à suivre/);
  assert.match(dlg.innerHTML, /HX 57[^<]*<\/button> : [^<]*sans route, garde son cap/, 'and its row in « Convois » says so');
  // A game without ships has no page at all.
  const none = { world: makeWorld('standard', {}, 'quinze-septembre'), signals: createSignals(), el: { dlgWatch: fakeDialog(), signals: {} } };
  openWatch(none);
  assert.equal(none.el.dlgWatch.open, false);
});

test('the coastal convoy is in the reports and in the filter of the « Signaux » tab', () => {
  const w = makeWorld('standard', {}, 'kanalkampf');
  const app = { world: w, signals: createSignals(), el: { dlgWatch: fakeDialog(), signals: {} } };
  const cw = w.convoys.find((c) => c.type === 'coastal');
  run(w, 2 * H);
  assert.ok(!(w.watch.reports[0].convoys || []).some((c) => c.id === cw.id), 'at anchor: nothing to report');
  Object.assign(cw, { state: 'atSea', route: cw.admiraltyRoute.slice(1).map(([x, y]) => [x, y]) });
  run(w, WATCH);
  const r = w.watch.reports[w.watch.reports.length - 1];
  assert.ok(r.convoys.some((c) => c.id === cw.id), 'at sea: its row');
  const row = reportHtml(app, r).match(/CW 7<\/button> : [^<]*/)[0];
  assert.match(row, /^CW 7<\/button> : \d+ navires, 5\d°/);
  assert.ok(!/sans escorte/.test(row), 'no escort group is expected with a coastal convoy');
  assert.ok(passesFilter(r, 'all', cw.id));
  app.signals.tab = 'signals';
  renderSignals(app);
  assert.match(app.el.signals.innerHTML, /<option value="cw"[^>]*>CW 7<\/option>/);
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
