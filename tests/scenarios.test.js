import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run, runTo } from './helpers.js';
import { restore, snapshot } from '../src/save/game.js';
import { buyOffer, lineCost, setPurchase } from '../src/sim/shipping.js';
import { followSquadron, scramble } from '../src/sim/orders.js';
import { CHAIN, carryFor, recordResult, scenarioStatus } from '../src/ui/campaign.js';
import { isDaylight } from '../src/sim/patrols.js';
import { isNight } from '../src/sim/naval.js';

const IDS = ['adlertag', 'quinze-septembre', 'hiver-atlantique'];

test('each new scenario starts and runs a day without errors, with all its texts', () => {
  for (const id of IDS) {
    const w = makeWorld('standard', {}, id);
    const events = run(w, 86400);
    assert.ok(events.some((e) => e.type === 'scenarioStart'), id);
    assert.ok(data.fr.scenarios[id].title && data.fr.scenarios[id].text, `${id} briefing`);
    for (const e of w.scenario.events || []) {
      const txt = data.fr.events[id]?.[e.key];
      assert.ok(txt && txt.title && txt.text, `${id} event ${e.key}`);
    }
    for (const o of w.scenario.currency?.offers || []) {
      assert.ok(data.fr.events[id]?.[o.event], `${id} offer event ${o.event}`);
      assert.ok(data.fr.offers[o.id], `${id} offer text ${o.id}`);
    }
    for (const o of w.objectives) assert.ok(data.fr.objectives[o.type], `${id} objective ${o.type}`);
    assert.ok(Array.isArray(data.fr.help.scenario[id]), `${id} help`);
  }
});

test('Adlertag: a mobile radar becomes available and a fresh squadron arrives', () => {
  const w = makeWorld('standard', {}, 'adlertag');
  assert.equal(w.mru.available, 0);
  runTo(w, 8 * 3600);
  assert.equal(w.mru.available, 1);
  assert.ok(!w.squadrons.some((s) => s.id === '266'));
  runTo(w, 2 * 86400 + 12.5 * 3600);
  assert.ok(w.squadrons.some((s) => s.id === '266' && s.aircraft === 12), 'relief');
});

test('15 September: a big wing forms behind its leader', () => {
  const w = makeWorld('standard', {}, 'quinze-septembre');
  const ids = ['242', '310', '302'];
  const [lead, ...rest] = ids.map((id) => w.squadrons.find((s) => s.id === id));
  assert.ok(scramble(w, lead, { vector: 150 }));
  for (const s of rest) scramble(w, s, { vector: 150 });
  run(w, 240);
  for (const s of rest) assert.ok(followSquadron(w, s, lead.id), s.id);
  run(w, 900, () => rest.every((s) => s.inFormation));
  assert.ok(rest.every((s) => s.inFormation), 'in formation');
});

test('Atlantic 1941: convoys sail on a schedule and their cargo is paid in dollars', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const line = w.shipping.lines.find((l) => l.prefix === 'HX');
  const full = lineCost(w, line);
  const events = run(w, 7 * 3600);
  const dep = events.find((e) => e.type === 'convoyDeparted');
  assert.ok(dep, 'HX 100 sails');
  assert.equal(dep.convoy, 'HX 100');
  assert.equal(Math.round(w.currency.start - w.currency.stock), Math.round(full));
  const hx = w.convoys.find((c) => c.name === 'HX 100');
  assert.equal(hx.state, 'atSea');
  // Half the cargo for the next convoys: half the price.
  setPurchase(w, 0.5);
  const before = w.currency.stock;
  const e2 = runTo(w, 2.5 * 86400).filter((e) => e.type === 'convoyDeparted');
  assert.equal(e2[0].convoy, 'SC 19');
  const scLine = w.shipping.lines.find((l) => l.prefix === 'SC');
  assert.equal(Math.round(before - w.currency.stock), Math.round(lineCost(w, scLine) * 0.5));
  assert.ok(Math.abs(e2[0].share - 0.5) < 1e-9);
});

test('aircraft bought in America arrive later; after Lend-Lease cargo is free', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 3600);
  const stock = w.currency.stock;
  assert.ok(buyOffer(w, 'hudson'));
  assert.equal(w.currency.stock, stock - 45);
  assert.ok(!buyOffer(w, 'hudson'), 'once only');
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  const b = makeWorld('standard', {}, 'hiver-atlantique');
  restore(b, snap);
  runTo(b, 13 * 86400);
  const sq = b.squadrons.find((s) => s.id === '224');
  assert.ok(sq && sq.asv && sq.home === 'limavady', 'the Hudsons arrived after a restore');
  w.flags.lendLease = true;
  const s2 = w.currency.stock;
  const dep = runTo(w, 6 * 86400).filter((e) => e.type === 'convoyDeparted');
  assert.ok(dep.length > 0 && dep.every((e) => e.lendLease && e.share === 1));
  assert.equal(w.currency.stock, s2);
});

test('winter days are short: U-boats get long nights, patrols short days', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  runTo(w, 13 * 3600); // 19:00
  assert.ok(isNight(w) && !isDaylight(w));
  runTo(w, 26 * 3600 + 30 * 60); // 08:30 the next day
  assert.ok(!isNight(w) && isDaylight(w));
  const k = makeWorld('standard', {}, 'kanalkampf');
  runTo(k, 13 * 3600); // 19:00 in July: still day
  assert.ok(!isNight(k) && isDaylight(k));
});

test('a U-boat that went home comes back after its refit in a long scenario', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const u = w.uboats[0];
  u.state = 'gone';
  u.goneAt = w.t;
  u.torpedoes = 0;
  runTo(w, 13 * 86400);
  assert.equal(u.state, 'gone');
  runTo(w, 14 * 86400 + 120);
  assert.notEqual(u.state, 'gone');
  assert.equal(u.torpedoes, u.torpedoesFull);
});

test('campaign: a victory opens the next scenario, losses carry into the next air battle', () => {
  const c = { results: {}, unlockAll: false };
  assert.equal(scenarioStatus(c, 'kanalkampf'), 'open');
  assert.equal(scenarioStatus(c, 'adlertag'), 'locked');
  assert.equal(scenarioStatus(c, 'm0-july-1940'), 'free');
  const w = { scenario: { id: 'kanalkampf' }, outcome: 'victory' };
  assert.equal(recordResult(c, w, 0.6), 'adlertag');
  assert.equal(scenarioStatus(c, 'kanalkampf'), 'won');
  assert.equal(scenarioStatus(c, 'adlertag'), 'open');
  // A later defeat does not take the victory back.
  recordResult(c, { scenario: { id: 'kanalkampf' }, outcome: 'defeat' }, 0.2);
  assert.equal(scenarioStatus(c, 'kanalkampf'), 'won');
  assert.equal(carryFor(c, 'adlertag', 'none'), null);
  assert.equal(carryFor(c, 'adlertag', 'light').fighterShare, 0.8);
  assert.equal(carryFor(c, 'adlertag', 'full').fighterShare, 0.6);
  assert.equal(carryFor(c, 'hiver-atlantique', 'full'), null, 'no carry into the Atlantic');
  const wa = makeWorld('standard', {}, 'adlertag', carryFor(c, 'adlertag', 'light'));
  const sq = wa.squadrons.find((s) => s.id === '32');
  assert.equal(sq.aircraft, 10);
  assert.equal(sq.aircraftStart, 12, 'establishment unchanged');
  assert.equal(CHAIN.length, 4);
  c.unlockAll = true;
  assert.equal(scenarioStatus(c, 'hiver-atlantique'), 'open');
});
