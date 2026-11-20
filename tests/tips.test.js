// The tips of a first time (2.11.0): five at most, each shown once when its occasion comes,
// one at a time, never during a lesson; « Compris » is remembered by the browser, and
// « Revoir les astuces » brings them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run } from './helpers.js';
import { isSilent, orderChannel } from '../src/sim/comms.js';
import { setDictionary, t } from '../src/core/i18n.js';
import { TIPS, TIP_NAMES, dismissTip, loadTips, panelHintDue, resetTips, sheetOpened, tipDue, tipOccasion, updateTips } from '../src/ui/tips.js';
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

// ---- 2.11.1: a tip does not outlive its occasion ----

test('a tip whose occasion goes leaves the card, not counted as seen; one that fits takes its place', () => {
  const { app, w, store, done } = appOn('hiver-atlantique');
  try {
    run(w, 12 * 3600);
    const group = w.escorts.find((x) => x.state === 'inPort' && (w.byId.port.get(x.portId).approaches || []).length);
    const convoy = w.convoys.find((x) => x.state === 'atSea');
    assert.ok(group && convoy && isSilent(w) && orderChannel(w, convoy) === 'radio');
    app.selection = { kind: 'escort', id: group.id };
    updateTips(app, 0);
    assert.equal(app.tips.shown, 'exit', '« Au port : la sortie »');
    assert.match(app.el.tip.innerHTML, /Au port : la sortie/);
    // (Seen in play: the group at sea, the tip stayed and kept « Silence radio » away.) The
    // group sails and reaches the high seas: its tip leaves, the one of the silence comes.
    group.state = 'atSea';
    group.x = convoy.x;
    group.y = convoy.y;
    assert.equal(orderChannel(w, group), 'radio');
    updateTips(app, 1000);
    assert.equal(app.tips.shown, 'silence', 'the card is free for the tip that fits');
    assert.match(app.el.tip.innerHTML, /Silence radio/);
    assert.equal(loadTips(store).seen.size, 0, 'gone by itself: not seen');
    assert.ok(!app.tips.seen.has('exit'));
    // The unit let go: nothing to say, the card is put away, and nothing is counted.
    app.selection = null;
    updateTips(app, 2000);
    assert.equal(app.tips.shown, null);
    assert.equal(app.el.tip.hidden, true);
    assert.equal(app.tips.seen.size, 0);
    // Taken in hand again, the tip comes back at once: nothing asked for a pause.
    app.selection = { kind: 'convoy', id: convoy.id };
    updateTips(app, 2500);
    assert.equal(app.tips.shown, 'silence');
    // « Compris » still counts, and still asks for a moment of quiet.
    dismissTip(app, 3000);
    assert.deepEqual([...loadTips(store).seen], ['silence']);
    app.selection = { kind: 'escort', id: w.escorts.find((x) => x.state === 'inPort' && x.id !== group.id && (w.byId.port.get(x.portId).approaches || []).length).id };
    updateTips(app, 4000);
    assert.equal(app.tips.shown, null, 'quiet after « Compris »');
    updateTips(app, 3000 + 20000);
    assert.equal(app.tips.shown, 'exit', 'the tip that left comes back with its occasion');
  } finally {
    done();
  }
});

test('the point no longer chosen, its tip leaves; a departure scheduled is an occasion while its unit stays in hand', () => {
  const { app, w, done } = appOn('kanalkampf');
  try {
    app.tips.seen.add('sheet');
    const sq = w.squadrons.find((s) => s.role === 'fighter');
    app.selection = { kind: 'squadron', id: sq.id };
    assert.ok(scramble(w, sq, { route: [[sq.x + 40, sq.y, null]] }));
    app.activePoint = { kind: 'squadron', id: sq.id, index: 0 };
    updateTips(app, 0);
    assert.equal(app.tips.shown, 'point');
    app.activePoint = null;
    updateTips(app, 100);
    assert.equal(app.tips.shown, null);
    assert.ok(!app.tips.seen.has('point'));
    // Something scheduled for this squadron: the tip, as long as the squadron is in hand.
    tipOccasion(app, 'schedule');
    updateTips(app, 200);
    assert.equal(app.tips.shown, 'schedule');
    const other = w.squadrons.find((s) => s.role === 'fighter' && s.id !== sq.id);
    app.selection = { kind: 'squadron', id: other.id };
    updateTips(app, 300);
    assert.equal(app.tips.shown, null, 'another unit in hand: the occasion is gone');
    app.selection = { kind: 'squadron', id: sq.id };
    updateTips(app, 400);
    assert.equal(app.tips.shown, null, 'and does not come back by itself');
    assert.ok(!app.tips.seen.has('schedule'), 'not seen: the next departure scheduled brings it');
    tipOccasion(app, 'schedule');
    updateTips(app, 500);
    assert.equal(app.tips.shown, 'schedule');
  } finally {
    done();
  }
});

// ---- what the review of 2.11.0 found ----

test('a browser that refuses its storage does not stop the game: the tips are shown for this visit', () => {
  // (All cookies blocked: the very name `localStorage` throws. The game no longer started.)
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('The operation is insecure.'); } });
  try {
    const tips = loadTips();
    assert.equal(tips.seen.size, 0);
    const app = { world: makeWorld('standard', {}, 'kanalkampf'), selection: null, activePoint: null, onMenu: false, tutorial: null, el: { tip: { dataset: {}, hidden: true, innerHTML: '' } }, tips };
    app.selection = { kind: 'squadron', id: app.world.squadrons[0].id };
    updateTips(app, 0);
    assert.equal(app.tips.shown, 'sheet');
    dismissTip(app, 10); // nothing to write to: no error, and seen for this visit
    assert.ok(app.tips.seen.has('sheet'));
    resetTips(app);
    sheetOpened(app);
  } finally {
    if (real) Object.defineProperty(globalThis, 'localStorage', real);
    else delete globalThis.localStorage;
  }
});

test('an order given during a lesson asks for no tip later; the word of the right panel counts sheets that open', () => {
  const { app, w, store, done } = appOn('kanalkampf');
  try {
    // (Lesson 5 schedules a state of alert: « Programmer un départ » came up in the next game.)
    app.tutorial = { index: 0 };
    tipOccasion(app, 'schedule');
    assert.equal(app.tips.asked.size, 0);
    app.tutorial = null;
    tipOccasion(app, 'schedule');
    app.tutorial = { index: 0 };
    updateTips(app, 0);
    app.tutorial = null;
    assert.equal(app.tips.asked.size, 0, 'an occasion that waited is dropped when a lesson begins');
    // The word « Cliquez sur une unité… »: until a sheet is opened.
    assert.equal(panelHintDue(app), true);
    sheetOpened(app);
    assert.equal(panelHintDue(app), true, 'nothing in hand: nothing opened');
    app.tutorial = { index: 0 };
    app.selection = { kind: 'squadron', id: w.squadrons[0].id };
    sheetOpened(app);
    assert.equal(panelHintDue(app), true, 'a sheet a lesson opens does not count');
    app.tutorial = null;
    app.selection = { kind: 'squadron', id: w.squadrons[1].id };
    sheetOpened(app);
    assert.equal(panelHintDue(app), false);
    assert.ok(loadTips(store).seen.has('panel'));
    // « Revoir les astuces » with that sheet still open: the word is due again, and stays
    // due while the same sheet is drawn again and again; the next sheet opened ends it.
    resetTips(app);
    sheetOpened(app);
    sheetOpened(app);
    assert.equal(panelHintDue(app), true, 'the sheet already open is no first sheet');
    app.selection = null;
    sheetOpened(app);
    assert.equal(panelHintDue(app), true);
    app.selection = { kind: 'squadron', id: w.squadrons[0].id };
    sheetOpened(app);
    assert.equal(panelHintDue(app), false);
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
    // With orders by headings there is no ring to pull the way out from: its own text.
    assert.equal(TIPS.exit.text(app), 'text');
    w.settings.orders = 'headings';
    assert.equal(TIPS.exit.text(app), 'textHeadings');
    assert.ok(!/anneau/.test(t('firstTips.exit.textHeadings')));
    w.settings.orders = 'draw';
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
