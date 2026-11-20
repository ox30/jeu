// C6 of the audit: an alert that asks for an order stays until the order is given or the player
// closes it; an information fades by itself; beyond four alerts waiting none is thrown away —
// the oldest goes to the journal as « not read », counted on the Journal button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeKanalkampf, makeWorld, run } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { DECISION_ALERTS, ALERT_TYPES, alertAnswered, alertFor } from '../src/ui/alertRules.js';
import { initAlert, openJournal, raiseAlert, resetAlerts, unreadAlerts, updateAlerts } from '../src/ui/alerts.js';
import { joinConvoy } from '../src/sim/orders.js';

setDictionary(data.fr);

/** A page reduced to what the alerts touch. */
function fakeApp(world) {
  const lines = new Map();
  const node = () => {
    const handlers = {};
    return {
      textContent: '', hidden: true, dataset: {}, offsetWidth: 0, firstElementChild: null,
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
      addEventListener(type, fn) { handlers[type] = fn; },
      click() { handlers.click(); },
      querySelector: (sel) => {
        const m = /data-log-id="(\d+)"/.exec(sel);
        return m ? lines.get(m[1]) || null : null;
      },
      querySelectorAll: () => [],
      closest: () => null,
    };
  };
  const el = {};
  for (const k of ['alert', 'alertTitle', 'alertText', 'alertShow', 'alertMore', 'alertKind', 'alertClose', 'panel', 'logSection', 'log']) el[k] = node();
  const app = { world, el, settings: { slowOnAlert: true, alertSpeeds: {} }, speed: 600, signals: { tab: 'signals' }, camera: {} };
  initAlert(app);
  app.line = (id) => {
    const li = node();
    lines.set(String(id), li);
    return li;
  };
  return app;
}

const info = (n) => ({ type: 'siteOut', t: 0, level: 'warning', variant: 'text', params: { site: `S${n}` }, focus: null, decision: false, logId: n });
const decision = (n) => ({ type: 'straggler', t: 0, level: 'warning', variant: 'text', params: { convoy: `HX ${n}`, n: 2 }, focus: null, decision: true, logId: n });

test('every alert is either a decision or an information, and the rule says which', () => {
  for (const type of DECISION_ALERTS) assert.ok(type === 'seaStop' || ALERT_TYPES.includes(type), type);
  const w = makeKanalkampf();
  const raid = alertFor(w, { type: 'raidDetected', raidId: 'r1', raid: 'H01', count: 20, approx: false, altFt: 12000, location: null }, new Map());
  assert.equal(raid.decision, true, 'a raid asks for an order');
  const c = w.convoys[0];
  // (At the rhythm of the watches, a sea event calls the player when it happens near us:
  // the simulation marks it `live`. Kanalkampf lives by the watches since 2.12.)
  const bombed = alertFor(w, { type: 'convoyBombed', convoy: c.name, convoyId: c.id, raid: 'H01', sunk: 1, x: c.x, y: c.y, live: true }, new Map());
  assert.equal(bombed.decision, false, 'a convoy bombed is an information');
});

test('an information fades by itself; a decision stays until it is closed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = fakeApp(makeKanalkampf());
  raiseAlert(app, info(1));
  assert.equal(app.el.alert.hidden, false);
  assert.equal(app.el.alertKind.hidden, true);
  t.mock.timers.tick(31000);
  assert.equal(app.el.alert.hidden, true, 'gone after half a minute');
  raiseAlert(app, decision(2));
  assert.equal(app.el.alertKind.hidden, false, 'marked « À décider »');
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(app.el.alert.hidden, false, 'still there ten minutes later');
  app.el.alertClose.click();
  assert.equal(app.el.alert.hidden, true, 'closed by the player');
  resetAlerts(app);
});

test('beyond four alerts waiting, the oldest goes to the journal as not read, none is lost', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = fakeApp(makeKanalkampf());
  // A raid on the banner; seven lesser alerts behind it.
  raiseAlert(app, { type: 'raidDetected', t: 0, level: 'raid', variant: 'text', params: {}, focus: { raidId: 'none' }, decision: true, logId: 100 });
  app.world.contacts.set('none', { lost: false, plots: [] });
  for (let n = 1; n <= 7; n++) raiseAlert(app, n % 2 ? info(n) : decision(n));
  assert.equal(app.alertBox.queue.length, 4, 'four wait');
  assert.equal(unreadAlerts(app), 3, 'three went to the journal');
  assert.deepEqual(app.alertBox.unread.map((u) => u.logId), [1, 2, 3], 'the oldest first');
  // The Journal button opens the journal on them: its lines are marked, the count is cleared.
  const marked = [1, 2, 3].map((n) => app.line(n));
  openJournal(app);
  assert.ok(marked.every((li) => li.classList.contains('unread')));
  assert.equal(unreadAlerts(app), 0);
  assert.equal(app.signals.tab, 'journal');
  assert.equal(app.el.logSection.classList.contains('collapsed'), false);
  resetAlerts(app);
});

test('a more urgent alert takes the banner; the decision it replaced comes back after it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = fakeApp(makeKanalkampf());
  raiseAlert(app, decision(1));
  raiseAlert(app, { type: 'uboatAttack', t: 0, level: 'danger', variant: 'text', params: { convoy: 'HX', n: 1 }, focus: null, decision: false, logId: 2 });
  assert.equal(app.alertBox.current.type, 'uboatAttack');
  assert.equal(app.alertBox.queue[0].logId, 1, 'the decision waits, first in line');
  t.mock.timers.tick(31000);
  assert.equal(app.alertBox.current.logId, 1, 'and is shown again');
  resetAlerts(app);
});

test('a decision is answered when its order is given: an escort sent to the convoy in reach', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = makeWorld('standard', { seaComms: 'direct' }, 'kanalkampf');
  const app = fakeApp(w);
  const c = w.convoys.find((x) => x.type === 'ocean' && x.state === 'atSea');
  const a = alertFor(w, { type: 'convoyInEscortRange', convoy: c.name, convoyId: c.id, free: 2, x: c.x, y: c.y, live: true }, new Map());
  assert.equal(a.decision, true);
  raiseAlert(app, a);
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, false, 'waits for the order');
  assert.equal(alertAnswered(w, a), false);
  const group = w.escorts.find((e) => e.state === 'inPort');
  assert.ok(joinConvoy(w, group, c.id));
  run(w, 5);
  assert.equal(alertAnswered(w, a), true);
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, true, 'the order given closes the alert');
  resetAlerts(app);
});

test('a base without fuel: the alert goes when a train is sent or the squadron has its fuel, not before', () => {
  // (Review of 2.10: « answered » was a tonne in the tanks, when a squadron of twelve draws
  // four: the alert « Plus de carburant » left in the very image it appeared.)
  const w = makeWorld('standard', {}, 'adlertag');
  const sq = w.squadrons.find((s) => s.role === 'fighter');
  const field = w.byId.airfield.get(sq.airfield);
  // As the simulation leaves things when it says « noFuel »: the squadron waits on the ground.
  field.stocks.fuel = 0;
  sq.state = 'refuelling';
  sq.waitingFuel = true;
  const a = alertFor(w, { type: 'noFuel', squadron: sq.name, squadronId: sq.id, airfield: field.name }, new Map());
  assert.equal(a.decision, true);
  assert.equal(alertAnswered(w, a), false);
  field.stocks.fuel = 3.9;
  assert.equal(alertAnswered(w, a), false, 'less than a sortie in the tanks: the squadron still waits');
  // A train of fuel on its way is the order the alert asked for.
  w.trains.push({ id: 't1', to: field.key, cargo: { fuel: 20, materiel: 0, ammo: 0 } });
  assert.equal(alertAnswered(w, a), true);
  w.trains.length = 0;
  assert.equal(alertAnswered(w, a), false);
  // Or the squadron has refuelled (another train came in, a stock arrived).
  sq.waitingFuel = false;
  sq.state = 'ready';
  assert.equal(alertAnswered(w, a), true);
  // « Carburant bas » and « Plus de munitions » : answered by their train, and by nothing else.
  const low = alertFor(w, { type: 'lowFuel', airfield: field.name, airfieldId: field.id }, new Map());
  assert.equal(alertAnswered(w, low), false);
  field.stocks.fuel = 500;
  assert.equal(alertAnswered(w, low), false, 'a decision does not answer itself');
  w.trains.push({ id: 't2', to: field.key, cargo: { fuel: 0, materiel: 0, ammo: 5 } });
  assert.equal(alertAnswered(w, low), false);
  const ammo = alertFor(w, { type: 'noAmmo', squadron: sq.name, squadronId: sq.id, airfield: field.name }, new Map());
  assert.equal(alertAnswered(w, ammo), true);
  // An installation the alert cannot find again is not « answered »: it waits to be closed.
  assert.equal(alertAnswered(w, { ...a, focus: null }), false);
});

// ---- What the review of 2.10 found in the alerts ----

test('seven decisions at once: the oldest raised go to the journal, not the one that just left the banner', (t) => {
  // (The decision chased from the banner was put first in line, then thrown out as the
  // « oldest »: the journal counted n° 5 and 6, and the four older ones stayed in line.)
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = fakeApp(makeKanalkampf());
  for (let n = 1; n <= 7; n++) raiseAlert(app, decision(n));
  assert.equal(app.alertBox.current.logId, 7, 'the last one raised has the banner');
  assert.deepEqual(app.alertBox.queue.map((a) => a.logId), [6, 5, 4, 3], 'the four raised just before wait, the latest first');
  assert.deepEqual(app.alertBox.unread.map((u) => u.logId), [1, 2], 'the two oldest are counted as not read');
  // Closed one after the other, they come back in that order, and none is lost on the way.
  const seen = [];
  for (let i = 0; i < 6 && !app.el.alert.hidden; i++) {
    seen.push(app.alertBox.current.logId);
    app.el.alertClose.click();
  }
  assert.deepEqual(seen, [7, 6, 5, 4, 3]);
  resetAlerts(app);
});

test('a decision does not age: it is still there after a day; an information left unseen is counted', (t) => {
  // (After six game hours — 36 seconds at ×600 — « Carburant bas… Envoyez un train » left by itself.)
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = makeKanalkampf();
  const app = fakeApp(w);
  raiseAlert(app, { ...decision(1), t: w.t });
  // Less urgent ones wait behind it (a raid has the banner).
  w.contacts.set('r1', { lost: false, plots: [] });
  raiseAlert(app, { type: 'raidDetected', t: w.t, level: 'raid', variant: 'text', params: {}, focus: { raidId: 'r1' }, decision: true, logId: 50 });
  raiseAlert(app, { ...decision(2), t: w.t });
  raiseAlert(app, { ...info(3), t: w.t });
  assert.equal(app.alertBox.current.logId, 50);
  run(w, 86400);
  updateAlerts(app);
  assert.equal(app.alertBox.current.logId, 50, 'the raid is still on the plot: its alert stays');
  // The raid leaves the plot: its alert goes, and the decisions of a day ago come back.
  w.contacts.get('r1').lost = true;
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, false);
  assert.equal(app.alertBox.current.logId, 1, 'the decision chased by the raid comes back first');
  updateAlerts(app);
  assert.equal(app.alertBox.current.logId, 1, 'and stays, a day old');
  app.el.alertClose.click();
  assert.equal(app.alertBox.current.logId, 2, 'the other decision too');
  app.el.alertClose.click();
  // The information is a day old: too late to show, but never seen, so counted in the journal.
  assert.equal(app.el.alert.hidden, true);
  assert.deepEqual(app.alertBox.unread.map((u) => u.logId), [3]);
  resetAlerts(app);
});

test('« Voir » shows the place: a decision stays, an information has been read', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = fakeApp(makeKanalkampf());
  raiseAlert(app, decision(1));
  app.el.alertShow.click();
  assert.equal(app.el.alert.hidden, false, 'looking is not answering');
  assert.equal(app.alertBox.current.logId, 1);
  app.el.alertClose.click();
  assert.equal(app.el.alert.hidden, true);
  raiseAlert(app, info(2));
  app.el.alertShow.click();
  assert.equal(app.el.alert.hidden, true);
  resetAlerts(app);
});

test('a raid alert goes when a fighter is ordered up, and when the raid has dropped its bombs', (t) => {
  // (It only went when a line ended on the raid: not after « Décoller », nor after a route
  // drawn ahead of the raid, which is what the first lesson teaches.)
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const app = fakeApp(w);
  const raid = (id, logId) => ({ type: 'raidDetected', t: w.t, level: 'raid', variant: 'text', params: {}, focus: { raidId: id }, decision: true, logId });
  w.contacts.set('r1', { lost: false, plots: [] });
  w.contacts.set('r2', { lost: false, plots: [] });
  // A patrol already in the air when the banner shows is not an answer to it.
  const [already, pupil] = w.squadrons.filter((s) => s.role === 'fighter' && s.state === 'ready');
  already.state = 'airborne';
  raiseAlert(app, raid('r1', 1));
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, false);
  // « Décoller » : the squadron leaves the ground, with no line to the raid.
  pupil.state = 'scrambling';
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, true, 'a fighter ordered up while the banner shows answers it');
  // Another raid, nobody left to send: it stays until the bombs have fallen.
  raiseAlert(app, raid('r2', 2));
  updateAlerts(app);
  assert.equal(app.alertBox.current.logId, 2, 'the squadron sent a moment ago does not answer the next raid');
  w.reports.set('r2', { hits: [], squadrons: [], outcome: null });
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, false);
  w.reports.get('r2').hits.push({ site: 'port:london', damage: 10 });
  updateAlerts(app);
  assert.equal(app.el.alert.hidden, true, 'bombs dropped: there is nothing left to decide');
  resetAlerts(app);
});
