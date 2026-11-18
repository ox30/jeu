import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run, runTo } from './helpers.js';
import { restore, snapshot } from '../src/save/game.js';
import { buyOffer, crossingHours, lineCost, offerArrival, offerInCargo, offers, tonnageForecast } from '../src/sim/shipping.js';
import { followSquadron, scramble } from '../src/sim/orders.js';
import { CHAIN, carryFor, recordResult, scenarioStatus } from '../src/ui/campaign.js';
import { isDaylight, isNight } from '../src/sim/daylight.js';
import { project } from '../src/sim/geo.js';

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
  assert.ok(dep, 'HX 102 sails');
  assert.equal(dep.convoy, 'HX 102');
  assert.equal(Math.round(w.currency.start - w.currency.stock), Math.round(full));
  const hx = w.convoys.find((c) => c.name === 'HX 102');
  assert.equal(hx.state, 'atSea');
  // No more share to set (I4): the next convoy sails fully laden too, at its full price.
  const before = w.currency.stock;
  const e2 = runTo(w, 2.5 * 86400).filter((e) => e.type === 'convoyDeparted');
  assert.equal(e2[0].convoy, 'SC 19');
  const scLine = w.shipping.lines.find((l) => l.prefix === 'SC');
  assert.equal(Math.round(before - w.currency.stock), Math.round(lineCost(w, scLine)));
  assert.equal(e2[0].share, 1);
  assert.equal(w.currency.purchase, undefined, 'the share bought is no longer a setting');
});

test('the reserve runs dry before Lend-Lease: the last convoys sail part laden, then in ballast', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const hx = w.shipping.lines.find((l) => l.prefix === 'HX');
  w.currency.stock = lineCost(w, hx) * 1.5; // one convoy and a half
  const dep = runTo(w, 6 * 86400).filter((e) => e.type === 'convoyDeparted');
  // HX 102 (10 January), SC 19 (12 January), HX 103 (15 January).
  assert.deepEqual(dep.map((e) => e.convoy), ['HX 102', 'SC 19', 'HX 103']);
  assert.equal(dep[0].share, 1);
  assert.ok(dep[1].share > 0 && dep[1].share < 1, 'what is left of the reserve');
  assert.equal(dep[2].share, 0);
  assert.equal(dep[2].fuel, 0);
  assert.ok(Math.abs(w.currency.stock) < 1e-9, 'not a dollar left');
  const hx103 = w.convoys.find((c) => c.name === 'HX 103');
  assert.equal(hx103.cargo.fuel + hx103.cargo.materiel, 0, 'in ballast');
});

test('an offer says what it costs in cargo and when the aircraft would arrive', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const catalina = offers(w).find((o) => o.id === 'catalina');
  const hudson = offers(w).find((o) => o.id === 'hudson');
  // 70 $ is about 1 750 t of fuel or 1 560 t of matériel; 45 $ is 1 125 t or 1 000 t.
  assert.equal(Math.round(offerInCargo(w, catalina).fuel), 1750);
  assert.equal(Math.round(offerInCargo(w, catalina).materiel), 1556);
  assert.equal(Math.round(offerInCargo(w, hudson).fuel), 1125);
  assert.equal(Math.round(offerInCargo(w, hudson).materiel), 1000);
  assert.equal(offerArrival(w, hudson) - w.t, 12 * 86400);
  assert.equal(offerArrival(w, catalina) - w.t, 18 * 86400);
  // Ordered on 11 March, after the vote: free, the Hudson on the 23rd, the Catalina on the 29th.
  w.t = 60 * 86400 - 600; // the clock is put forward to 11 March, 05:50
  runTo(w, 60 * 86400 + 3600); // 07:00: the vote was announced at 06:00
  assert.ok(w.flags.lendLease);
  const day = (o) => new Date(w.startMs + offerArrival(w, o) * 1000).getUTCDate();
  assert.equal(day(hudson), 23);
  assert.equal(day(catalina), 29);
  assert.deepEqual(offerInCargo(w, catalina), { fuel: 0, materiel: 0 });
});

test('the tonnage forecast: unloaded, at sea, and what the reserve can still buy, against the objective', () => {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const start = tonnageForecast(w);
  assert.equal(start.fuel.target, 6800);
  assert.equal(start.materiel.target, 4400);
  assert.equal(start.fuel.unloaded + start.fuel.atSea, 0);
  // 520 $ do not pay for every convoy until the end: about twelve or thirteen of them.
  const hx = w.shipping.lines.find((l) => l.prefix === 'HX');
  const sc = w.shipping.lines.find((l) => l.prefix === 'SC');
  const spent = (start.fuel.buyable * w.currency.costFuel) + (start.materiel.buyable * w.currency.costMateriel);
  assert.ok(spent <= w.currency.stock + 1e-6, `${spent.toFixed(1)} $ of cargo for ${w.currency.stock} $`);
  assert.ok(spent > w.currency.stock - lineCost(w, hx), 'nearly the whole reserve is counted');
  assert.ok(crossingHours(w, hx) > 11 * 24 && crossingHours(w, hx) < 15 * 24, `HX: ${(crossingHours(w, hx) / 24).toFixed(1)} days`);
  assert.ok(crossingHours(w, sc) > crossingHours(w, hx), 'the slow convoys take longer');
  // An aircraft bought is cargo that will not sail: the forecast drops by its price in tonnes.
  const before = tonnageForecast(w);
  assert.ok(buyOffer(w, 'catalina'));
  const after = tonnageForecast(w);
  const lost = (before.fuel.buyable - after.fuel.buyable) * w.currency.costFuel + (before.materiel.buyable - after.materiel.buyable) * w.currency.costMateriel;
  assert.ok(Math.abs(lost - 70) < 1e-6, `${lost.toFixed(2)} $ of cargo less`);
  // What sails moves from « buyable » to « at sea », then to « unloaded »: the total stays.
  runTo(w, 7 * 3600);
  const sailed = tonnageForecast(w);
  assert.equal(Math.round(sailed.fuel.atSea), 640);
  assert.ok(Math.abs(sailed.fuel.total - after.fuel.total) < 1e-6 && Math.abs(sailed.materiel.total - after.materiel.total) < 1e-6);
  // After the vote, the convoys still to come that can arrive in time are free and full.
  w.flags.lendLease = true;
  const lend = tonnageForecast(w);
  assert.ok(lend.lendLease && lend.fuel.buyable > sailed.fuel.buyable);
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
  // Day and night by the sun (N6), where the convoys pass: 56° N 12° W. The clock is GMT+1.
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const [x, y] = project(-12, 56);
  runTo(w, 13 * 3600); // 19:00
  assert.ok(isNight(w, x, y) && !isDaylight(w, x, y));
  runTo(w, 26 * 3600 + 30 * 60); // 08:30 the next day: the sun is not up yet in January
  assert.ok(isNight(w, x, y), 'still night at 08:30');
  runTo(w, 31 * 3600); // 13:00
  assert.ok(!isNight(w, x, y) && isDaylight(w, x, y));
  // The night of mid-January lasts about sixteen hours out there (ten hours by the old rule).
  let night = 0;
  for (let m = 0; m < 1440; m++) {
    w.t += 60;
    if (isNight(w, x, y)) night++;
  }
  assert.ok(night > 15.5 * 60 && night < 17 * 60, `${(night / 60).toFixed(1)} h of night`);
  // The sun sets later in the west: at 18:30 it is night off Liverpool, still day at 30° W.
  const d = makeWorld('standard', {}, 'hiver-atlantique');
  runTo(d, 12 * 3600 + 30 * 60); // 18:30
  assert.ok(isNight(d, ...project(-3.5, 53.5)) && isDaylight(d, ...project(-30, 53.5)));
  const k = makeWorld('standard', {}, 'kanalkampf');
  const kent = project(0.5, 51.3);
  runTo(k, 13 * 3600); // 19:00 in July: still day
  assert.ok(!isNight(k, ...kent) && isDaylight(k, ...kent));
  runTo(k, 17 * 3600); // 23:00
  assert.ok(isNight(k, ...kent));
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

test('the Atlantic is won with fewer than 7.5 % of the ships lost, and the objective says so', async () => {
  const { objectiveText } = await import('../src/ui/format.js');
  const { setDictionary } = await import('../src/core/i18n.js');
  const { data: all } = await import('./helpers.js');
  setDictionary(all.fr);
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  const o = w.objectives.find((x) => x.type === 'shipLossesBelow');
  assert.equal(o.share, 0.075);
  const text = objectiveText(w, o);
  assert.ok(text.includes('7,5 %'), text);
  // A whole number of per cent is written without a decimal.
  assert.ok(objectiveText(w, { ...o, share: 0.08 }).includes('de 8 %'), objectiveText(w, { ...o, share: 0.08 }));
  assert.ok(objectiveText(w, { ...o, share: 0.2 }).includes('de 20 %'));
});
