// The tips of a first time (2.11.0): five at most, each shown once when its occasion comes,
// one at a time, never during a lesson; « Compris » is remembered by the browser, and
// « Revoir les astuces » brings them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run } from './helpers.js';
import { isSilent, orderChannel } from '../src/sim/comms.js';
import { setDictionary, t } from '../src/core/i18n.js';
import { TIPS, TIP_NAMES, dismissTip, loadTips, resetTips, tipDue, tipOccasion, updateTips } from '../src/ui/tips.js';
import { helpRubrics } from '../src/ui/dialogs.js';
import { scramble } from '../src/sim/orders.js';

setDictionary(data.fr);

/** A browser's storage, as far as the tips use it. */
function storage(items = {}) {
  const map = new Map(Object.entries(items));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}

/** An app as the tips read it: a world, a selection, the card of the page. */
function appOn(scenario, store = storage()) {
  const real = globalThis.localStorage;
  globalThis.localStorage = store;
  const w = makeWorld('standard', {}, scenario);
  const app = { world: w, selection: null, activePoint: null, onMenu: false, tutorial: null, el: { tip: { dataset: {}, hidden: true, innerHTML: '' } }, tips: loadTips(store) };
  return { app, w, store, done: () => { globalThis.localStorage = real; } };
}

test('five tips at most, each with its title, its texts and a rubric of the help that exists', () => {
  assert.ok(TIP_NAMES.length <= 5, `${TIP_NAMES.length} tips`);
  assert.deepEqual(TIP_NAMES, ['schedule', 'point', 'silence', 'exit', 'sheet']);
  for (const id of TIP_NAMES) {
    const own = t(`firstTips.${id}`);
    assert.ok(own.title.length > 3 && own.title.length <= 30, `${id}: title`);
    for (const [k, text] of Object.entries(own)) {
      if (k === 'title') continue;
      assert.match(k, /^text/, `${id}.${k}`);
      assert.ok(text.length > 40 && text.length <= 260, `${id}.${k}: ${text.length} signs`);
    }
    const [tab, anchor] = TIPS[id].link;
    assert.ok(helpRubrics(tab).some((r) => r.id === anchor), `${id} → ${tab}:${anchor}`);
  }
});

test('a tip comes with its occasion, stays until « Compris », and is not shown again', () => {
  const { app, w, store, done } = appOn('kanalkampf');
  try {
    assert.equal(tipDue(app), null, 'nothing in hand, nothing to say');
    updateTips(app, 0);
    assert.equal(app.el.tip.hidden, true);
    const sq = w.squadrons.find((s) => s.role === 'fighter');
    app.selection = { kind: 'squadron', id: sq.id };
    assert.equal(tipDue(app), 'sheet', 'the first sheet of a unit that moves');
    updateTips(app, 0);
    assert.equal(app.tips.shown, 'sheet');
    assert.equal(app.el.tip.hidden, false);
    assert.match(app.el.tip.innerHTML, /Tracer et corriger/);
    assert.match(app.el.tip.innerHTML, /data-tip="seen"[^>]*>Compris</);
    // It stays while another occasion comes: one tip at a time.
    assert.ok(scramble(w, sq, { route: [[sq.x + 40, sq.y, null]] }));
    app.activePoint = { kind: 'squadron', id: sq.id, index: 0 };
    updateTips(app, 1000);
    assert.equal(app.tips.shown, 'sheet', 'the card is taken');
    // Not remembered before « Compris »: a page loaded again shows it again.
    assert.equal(loadTips(store).seen.size, 0);
    dismissTip(app, 2000);
    assert.equal(app.el.tip.hidden, true);
    assert.deepEqual([...loadTips(store).seen], ['sheet'], '« Compris » is kept by the browser');
    // Nothing for a while, then the next occasion: the point chosen on the route.
    updateTips(app, 5000);
    assert.equal(app.tips.shown, null, 'not one tip upon the other');
    updateTips(app, 2000 + 20000);
    assert.equal(app.tips.shown, 'point');
    assert.match(app.el.tip.innerHTML, /↑ ↓ règlent l&#39;altitude/);
    dismissTip(app, 30000);
    // Seen: neither comes back, in this visit or the next.
    app.tips = loadTips(store);
    assert.deepEqual([...app.tips.seen].sort(), ['point', 'sheet']);
    updateTips(app, 0);
    assert.equal(app.tips.shown, null);
    // « Revoir les astuces ».
    resetTips(app);
    assert.equal(loadTips(store).seen.size, 0);
    updateTips(app, 0);
    assert.equal(app.tips.shown, 'point', 'each comes back at its occasion (the point is still chosen)');
  } finally {
    done();
  }
});

test('no tip during a lesson, none on the menu; a scheduled departure asks for its own', () => {
  const { app, w, done } = appOn('kanalkampf');
  try {
    const sq = w.squadrons.find((s) => s.role === 'fighter');
    app.selection = { kind: 'squadron', id: sq.id };
    app.tutorial = { index: 0 };
    assert.equal(tipDue(app), null, 'a lesson has its instructor');
    updateTips(app, 0);
    assert.equal(app.tips.shown, null);
    app.tutorial = null;
    app.onMenu = true;
    assert.equal(tipDue(app), null);
    app.onMenu = false;
    // A tip on the screen when a lesson begins leaves the card, and is not counted as seen.
    updateTips(app, 0);
    assert.equal(app.el.tip.hidden, false);
    app.tutorial = { index: 0 };
    updateTips(app, 10);
    assert.equal(app.el.tip.hidden, true);
    assert.equal(app.tips.seen.size, 0);
    app.tutorial = null;
    dismissTip(app, 20);
    // Something scheduled: its tip comes first, whatever else is in hand.
    tipOccasion(app, 'schedule');
    updateTips(app, 20 + 20000);
    assert.equal(app.tips.shown, 'schedule');
    dismissTip(app, 50000);
    tipOccasion(app, 'schedule');
    assert.equal(app.tips.asked.has('schedule'), false, 'seen: not asked for again');
  } finally {
    done();
  }
});

test('the tips of the sea: the way out of an escort group in port, a ship under radio silence', () => {
  const { app, w, done } = appOn('hiver-atlantique');
  try {
    app.tips.seen.add('sheet');
    const e = w.escorts.find((x) => x.state === 'inPort' && (w.byId.port.get(x.portId).approaches || []).length);
    app.selection = { kind: 'escort', id: e.id };
    assert.equal(tipDue(app), 'exit');
    // On the high seas, where orders go by radio at the relief.
    run(w, 12 * 3600);
    const c = w.convoys.find((x) => x.state === 'atSea');
    assert.ok(c && isSilent(w) && orderChannel(w, c) === 'radio', 'Standard: a convoy at sea under radio silence');
    app.selection = { kind: 'convoy', id: c.id };
    assert.equal(tipDue(app), 'silence');
    // In waters where it is followed (« direct »), the tip has no occasion.
    w.settings.seaComms = 'direct';
    assert.equal(tipDue(app), null);
    // The tip the browser of 2.10 had already shown is not shown again.
    assert.ok(loadTips(storage({ 'jeu-1940.scheduleHint.v1': '1' })).seen.has('schedule'));
    assert.equal(loadTips(storage({ 'jeu-1940.tips.v1': 'not json' })).seen.size, 0);
  } finally {
    done();
  }
});
