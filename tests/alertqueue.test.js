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
  const bombed = alertFor(w, { type: 'convoyBombed', convoy: c.name, convoyId: c.id, raid: 'H01', sunk: 1, x: c.x, y: c.y }, new Map());
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
  const a = alertFor(w, { type: 'convoyInEscortRange', convoy: c.name, convoyId: c.id, free: 2, x: c.x, y: c.y }, new Map());
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

test('a base without fuel: the alert goes when the fuel is there again, not before', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  const field = w.airfields.find((f) => w.squadrons.some((s) => s.home === f.id));
  field.stocks.fuel = 0;
  const a = alertFor(w, { type: 'noFuel', squadron: 'x', squadronId: 'x', airfield: field.name }, new Map());
  assert.equal(a.decision, true);
  assert.equal(alertAnswered(w, a), false);
  field.stocks.fuel = 40;
  assert.equal(alertAnswered(w, a), true);
  // An installation the alert cannot find again is not « answered »: it waits to be closed.
  assert.equal(alertAnswered(w, { ...a, focus: null }), false);
});
