import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeWorld, run, runTo, scenarioData } from './helpers.js';
import { restore, snapshot } from '../src/save/game.js';
import { buyOffer, crossingHours, lineCost, offerArrival, offerInCargo, offers, tonnageForecast } from '../src/sim/shipping.js';
import { followSquadron, scramble } from '../src/sim/orders.js';
import { readFileSync } from 'node:fs';
import { campaignChain, carryFor, nextInChain, recordResult, scenarioIds, scenarioStatus, setCampaignData, trainingId } from '../src/ui/campaign.js';

// The lists of the campaign are data since 2.9 (data/campaign.json): given to the module as the page does.
setCampaignData(JSON.parse(readFileSync(new URL('../data/campaign.json', import.meta.url), 'utf8')));
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
  assert.equal(campaignChain().length, 4);
  assert.deepEqual(campaignChain(), ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique']);
  assert.equal(nextInChain('kanalkampf'), 'adlertag');
  assert.equal(nextInChain('hiver-atlantique'), null, 'the last of the chain');
  assert.equal(nextInChain('m0-july-1940'), null, 'the training scenario is outside it');
  assert.equal(trainingId(), 'm0-july-1940');
  assert.deepEqual(scenarioIds(), ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique', 'm0-july-1940']);
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

test('Code 6, N8: scenarios, campaign, views and maps are data, and every scenario declares its map', async () => {
  const { readFileSync: read } = await import('node:fs');
  const json = (p) => JSON.parse(read(new URL(`../${p}`, import.meta.url), 'utf8'));
  const campaign = json('data/campaign.json');
  assert.deepEqual(Object.keys(campaign.views).sort(), ['atlantic', 'britain', 'england']);
  for (const v of Object.values(campaign.views)) assert.ok(v.lon[0] < v.lon[1] && v.lat[0] < v.lat[1]);
  for (const id of [...campaign.scenarios, campaign.training]) {
    const sc = json(`data/scenarios/${id}.json`);
    assert.equal(sc.id, id);
    // Texts: a title, a line of what is at stake, the longer text.
    for (const k of ['title', 'stake', 'text']) assert.ok(typeof data.fr.scenarios[id][k] === 'string' && data.fr.scenarios[id][k].length > 5, `scenarios.${id}.${k}`);
    // An estimated length of play, from… to… minutes.
    const [lo, hi] = campaign.cards[id].minutes;
    assert.ok(lo > 0 && hi > lo, `${id}: ${lo} to ${hi} minutes`);
    // Its map: zone, first view, the views offered, layers and tools the game knows, the rhythm of its sea.
    const m = sc.map;
    assert.ok(m, `${id} declares its map`);
    assert.ok(campaign.views[m.zone], `${id}: zone ${m.zone}`);
    assert.ok(campaign.views[m.view], `${id}: view ${m.view}`);
    assert.ok(m.views.includes(m.view), `${id}: its first view is one it offers`);
    for (const v of m.views) assert.ok(campaign.views[v], `${id}: view ${v}`);
    for (const l of m.layers) assert.ok(campaign.layers.includes(l), `${id}: layer ${l}`);
    for (const tool of m.tools) assert.ok(campaign.tools.includes(tool), `${id}: tool ${tool}`);
    assert.ok(['watches', 'direct'].includes(sc.seaRhythm), `${id}: sea rhythm ${sc.seaRhythm}`);
    // The grid of the RAF is a layer only where the scenario has one.
    assert.equal(m.layers.includes('grid'), Boolean(sc.grid), `${id}: grid`);
  }
  assert.equal(json('data/scenarios/hiver-atlantique.json').seaRhythm, 'watches');
  assert.ok(campaign.chain.every((id) => campaign.scenarios.includes(id)));
});

test('Code 6, I10: the lessons of the tutorial are data the game can read', async () => {
  const { readFileSync: read } = await import('node:fs');
  const tutorial = JSON.parse(read(new URL('../data/tutorial.json', import.meta.url), 'utf8'));
  const { CONDITION_NAMES, ORDER_NAMES, holds, lessonById, lessonFor } = await import('../src/ui/tutorial.js');
  assert.equal(tutorial.lessons.length, 4);
  const known = new Set(CONDITION_NAMES);
  const check = (c) => {
    for (const [name, arg] of Object.entries(c)) {
      assert.ok(known.has(name), `condition ${name}`);
      if (name === 'any' || name === 'all') arg.forEach(check);
    }
  };
  for (const lesson of tutorial.lessons) {
    // Its own small scenario, written on one of the battles, with settings the game knows.
    const sc = scenarioData(lesson.scenario);
    assert.equal(sc.id, lesson.scenario);
    for (const k of ['title', 'stake', 'text']) assert.ok(data.fr.scenarios[sc.id][k], `${sc.id}: its ${k}`);
    assert.deepEqual(sc.objectives, [], `${sc.id}: a lesson is led by its steps, not by objectives`);
    assert.ok(!('base' in sc) && sc.ports.length > 0, `${lesson.id}: resolved on its base`);
    for (const [key, value] of Object.entries(lesson.settings || {})) {
      const choices = data.presets.choices[key];
      assert.ok(choices ? choices.includes(value) : typeof value === 'boolean', `${lesson.id}: setting ${key} = ${value}`);
    }
    assert.ok(lesson.minutes[0] >= 3 && lesson.minutes[1] <= 5, `${lesson.id}: three to five minutes`);
    assert.ok(lesson.steps.length >= 5);
    assert.ok(lesson.steps[lesson.steps.length - 1].last, 'the last step ends the lesson');
    for (const step of lesson.steps) {
      for (const k of ['title', 'text']) assert.ok(typeof data.fr.tutorial.lessons[lesson.id].steps[step.id][k] === 'string', `${lesson.id}.${step.id}.${k}`);
      assert.ok(step.manual || step.done, `${step.id}: a button or a condition to go on`);
      if (step.done) check(step.done);
      for (const entry of step.do || []) {
        if (entry.when) check(entry.when);
        assert.ok(!entry.order || ORDER_NAMES.some((name) => name in entry.order), `${lesson.id}.${step.id}: an order the instructor knows`);
      }
      // What fills the text is said in the text, and comes from an event or a mark of the lesson.
      const text = data.fr.tutorial.lessons[lesson.id].steps[step.id].text;
      for (const name of [...Object.keys(step.times || {}), ...Object.keys(step.gaps || {})]) assert.ok(text.includes(`{${name}}`), `${lesson.id}.${step.id}: {${name}} in its text`);
      for (const [from, to] of Object.values(step.gaps || {})) assert.ok(step.times[from] && step.times[to], `${lesson.id}.${step.id}: a gap between two known hours`);
    }
    // The units and installations the steps name exist in the scenario of the lesson.
    const w = makeWorld('standard', lesson.settings || {}, lesson.scenario);
    for (const step of lesson.steps) {
      const sel = step.select;
      if (sel && sel.site) assert.ok(w.sites.get(sel.site), `${lesson.id}.${step.id}: ${sel.site}`);
      if (sel && sel.id) assert.ok(w.squadrons.some((x) => x.id === sel.id) || w.escorts.some((x) => x.id === sel.id), `${lesson.id}.${step.id}: unit ${sel.id}`);
    }
    assert.equal(lessonFor(tutorial, lesson.scenario).id, lesson.id);
    assert.equal(lessonById(tutorial, lesson.id).scenario, lesson.scenario);
  }
  assert.equal(lessonFor(tutorial, 'adlertag'), null);
  // The conditions are read as the lesson reads them.
  const w = makeWorld('standard', {}, 'm0');
  const app = { world: w, paused: false, speed: 600, reportsOpened: false };
  assert.equal(holds(app, { speedAtLeast: 600 }, new Set()), true);
  assert.equal(holds(app, { contacts: 1 }, new Set()), false);
  assert.equal(holds(app, { any: [{ contacts: 1 }, { speedAtLeast: 600 }] }, new Set()), true);
  assert.equal(holds(app, { all: [{ contacts: 1 }, { speedAtLeast: 600 }] }, new Set()), false);
  assert.equal(holds(app, { seen: ['tallyHo', 'combatRound'] }, new Set(['combatRound'])), true);
  assert.equal(holds(app, { flag: 'reportsOpened' }, new Set()), false);
  assert.throws(() => holds(app, { nonsense: true }, new Set()));
});
