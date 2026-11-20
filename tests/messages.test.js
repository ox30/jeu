// The words of the journal (src/ui/messages.js): sorted by the families of the watch reports,
// one entry a kind of event, and the same sentences as before the sorting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld } from './helpers.js';
import { setDictionary } from '../src/core/i18n.js';
import { FAMILIES, eventMessage, messageFamily } from '../src/ui/messages.js';
import { NOTED_TYPES, watchFamily } from '../src/sim/watch.js';

setDictionary(data.fr);

const base = { t: 3600, escort: 'EG 1', escortId: 'eg1', convoy: 'HX 104', convoyId: 'hx104' };

test('each kind of event has one entry, in one family', () => {
  const seen = new Map();
  for (const [family, table] of Object.entries(FAMILIES)) {
    for (const type of Object.keys(table)) {
      assert.ok(!seen.has(type), `${type} is in ${seen.get(type)} and in ${family}`);
      seen.set(type, family);
      assert.equal(messageFamily(type), family);
    }
  }
  assert.ok(seen.size >= 100, `${seen.size} kinds of events`);
  assert.equal(messageFamily('noSuchEvent'), null);
});

test('the journal files the events of the sea under the families of the watch reports', () => {
  const sea = ['attack', 'uboat', 'intel', 'escort', 'convoy'];
  // Told in every scenario, not only at sea: they keep their own family in the journal.
  const elsewhere = { squadronLost: 'battle', scenarioEvent: 'game' };
  let checked = 0;
  for (const type of NOTED_TYPES) {
    const mine = messageFamily(type);
    if (!mine) continue; // no special wording: the sentence is log.<type>
    if (elsewhere[type]) {
      assert.equal(mine, elsewhere[type]);
      continue;
    }
    assert.ok(sea.includes(mine), `${type}: ${mine}`);
    assert.equal(mine, watchFamily(type), `${type}: ${mine} in the journal, ${watchFamily(type)} in the watch reports`);
    checked++;
  }
  assert.ok(checked >= 20, `${checked} kinds of events compared`);
});

test('every event a watch report keeps has its sentence', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const samples = {
    uboatSighted: { source: 'asdic', unitKind: 'escort', by: 'EG 1' },
    depthChargePass: { result: 'damaged', used: 10, left: 90, of: 160 },
    escortHuntOver: { why: 'lost', sank: false },
    escortEngaged: { how: 'flash' },
    shipsSunk: { cause: 'uboat', sunk: 2 },
    convoyDeparted: { share: 1, fuel: 640, materiel: 360 },
    offerBought: { offerId: 'hudson', readyAt: 86400 },
    scenarioEvent: { scenario: 'hiver-atlantique', key: 'lendLease', important: false },
    dfFix: { lat: 55, lon: -20 },
    straggler: { tanker: true },
    convoyBombed: { sunk: 0 }, // with losses, shipsSunk says it
    convoyEndAction: { action: 'port', port: 'Liverpool', channel: 'Canal Saint-Georges' },
  };
  // Kept for the filters of the page only: the decision of the report says it.
  const silent = new Set(['convoyInEscortRange']);
  for (const type of NOTED_TYPES.filter((x) => !silent.has(x))) {
    const e = { type, ...base, squadron: '502 Sqn', by: 'EG 1', sunk: 1, ...(samples[type] || {}) };
    const msg = eventMessage(w, e);
    assert.ok(msg && msg.text && !msg.text.startsWith('log.'), `${type}: ${msg && msg.text}`);
    assert.ok(typeof msg.level === 'string');
  }
});

test('the sentences of a hunt say how it ended, and what is left in the racks', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const say = (e) => eventMessage(w, { ...base, ...e });
  const lost = say({ type: 'escortHuntOver', why: 'lost', sank: false });
  const damaged = say({ type: 'escortHuntOver', why: 'damaged', sank: false });
  const charges = say({ type: 'escortHuntOver', why: 'charges', sank: false });
  const sank = say({ type: 'escortHuntOver', why: 'sunk', sank: true });
  assert.equal(new Set([lost.text, damaged.text, charges.text, sank.text]).size, 4, 'four different endings');
  assert.equal(say({ type: 'escortHuntOver', why: 'order', sank: false }), null, 'the order given says it');
  // A group on its own (no convoy) has its own wording.
  assert.notEqual(say({ type: 'escortHuntOver', why: 'lost', sank: false, convoy: '' }).text, lost.text);
  const pass = say({ type: 'depthChargePass', result: 'damaged', used: 10, left: 90, of: 160 });
  assert.equal(pass.level, 'warning');
  assert.ok(pass.text.includes('90') && pass.text.includes('160'), pass.text);
  const dry = say({ type: 'depthChargePass', result: 'nothing', used: 0, left: 0, of: 160 });
  assert.notEqual(dry.text, say({ type: 'depthChargePass', result: 'nothing', used: 10, left: 90, of: 160 }).text);
  assert.equal(say({ type: 'depthChargePass', result: 'sunk', used: 10, left: 90, of: 160 }), null, 'the sinking says it');
});

test('what the enemy does unseen is never told', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  assert.equal(eventMessage(w, { type: 'bduLine', t: 0 }), null);
  assert.equal(eventMessage(w, { type: 'bdienstRead', t: 0, convoy: 'HX 104' }), null);
  assert.equal(eventMessage(w, { type: 'noSuchEvent', t: 0 }), null);
});
