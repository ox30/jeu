// Robustness: a « monkey » gives random orders — every order the interface can give, to
// random units, with plausible and absurd arguments — all through a scenario, saving and
// restoring now and then. Any exception, any NaN position, any negative count is a problem.
// This is the test that found the mobile-radar crash (B1 of the audit).
//   node tools/bot/monkey.mjs <scenario> [orders] [seed] [preset]
//   node tools/bot/monkey.mjs --all [orders] [seed]      (npm run fuzz)
import {
  SCENARIOS, data, gameClock, getTerrain, makeWorld, orders as O, sim,
} from './game.mjs';
import * as rally from '../../src/sim/rally.js';
import * as roster from '../../src/sim/roster.js';
import * as timetable from '../../src/sim/timetable.js';
import * as mru from '../../src/sim/mru.js';
import * as combat from '../../src/sim/combat.js';
import * as asw from '../../src/sim/asw.js';
import * as settings from '../../src/sim/gameSettings.js';

const F = sim.formations;

function randomSource(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The orders, each given to whatever unit the monkey picks. `w` is the current world. */
function buildActions(rnd, world) {
  let w = world;
  const pick = (a) => (a && a.length ? a[Math.floor(rnd() * a.length)] : null);
  const near = (u, km) => [u.x + (rnd() - 0.5) * 2 * km, u.y + (rnd() - 0.5) * 2 * km];
  const ships = () => [...w.convoys, ...w.escorts];
  const movers = () => [...w.squadrons, ...w.convoys, ...w.escorts];
  const sites = () => [...w.sites.values()];
  const air = () => w.formations.filter((f) => f.kind === 'air');
  const states = sim.crews.ALERT_STATES;
  const channels = () => [null, 'x', ...w.ports.flatMap((p) => (p.approaches || []).map((a) => a.name))];
  const legEnd = () => pick([
    null,
    { kind: 'duration', s: 600 + rnd() * 7200 },
    { kind: 'clock', hh: Math.floor(rnd() * 24), mm: 0 },
    { kind: 'position', lat: 48 + rnd() * 10, lon: -30 + rnd() * 32 },
    { kind: 'square', ref: 'J5' },
  ]);
  const actions = {
    scramble: () => { const s = pick(w.squadrons); if (s) O.scramble(w, s, pick([{ vector: rnd() * 360 }, { orbit: true }, { route: [[...near(s, 150), null]] }, {}])); },
    setRoute: () => { const s = pick(w.squadrons); if (s) O.setRoute(w, s, [[...near(s, 120), rnd() < 0.5 ? 4000 + rnd() * 4000 : null], [...near(s, 200), null]]); },
    planGroundRoute: () => { const s = pick(w.squadrons); if (s) O.planGroundRoute(w, s, [[...near(s, 80), null], [...near(s, 160), null]]); },
    setVector: () => { const s = pick(w.squadrons); if (s) O.setVector(w, s, rnd() * 720 - 180); },
    setOrbit: () => { const s = pick(w.squadrons); if (s) O.setOrbit(w, s); },
    setCover: () => { const s = pick(w.squadrons); const c = pick(w.convoys); if (s && c) O.setCover(w, s, c.id); },
    returnToBase: () => { const s = pick(w.squadrons); if (s) O.returnToBase(w, s); },
    setAltitude: () => { const s = pick(w.squadrons); if (s) O.setAltitude(w, s, rnd() * 40000 - 2000); },
    setPointAltitude: () => { const s = pick(w.squadrons); if (s) O.setPointAltitude(w, s, Math.floor(rnd() * 3), rnd() * 30000); },
    removeRoutePoint: () => { const s = pick(w.squadrons); if (s) O.removeRoutePoint(w, s, Math.floor(rnd() * 3)); },
    setAlert: () => { const s = pick(w.squadrons); if (s) O.setAlert(w, s, pick(states)); },
    setRoe: () => { const s = pick(w.squadrons); if (s) O.setRoe(w, s, pick(sim.engagement.ROES)); },
    setSpeed: () => { const s = pick(w.squadrons); if (s) (rnd() < 0.5 ? O.setSpeedPct(w, s, rnd() * 150) : O.setSpeed(w, s, pick(['max', 'cruise']))); },
    interceptRaid: () => { const s = pick(w.squadrons); const r = pick([...w.contacts.keys()]); if (s && r) O.interceptRaid(w, s, r); },
    followSquadron: () => { const s = pick(w.squadrons); const l = pick(w.squadrons); if (s && l && s !== l) O.followSquadron(w, s, l.id); },
    leaveFormation: () => { const s = pick(w.squadrons); if (s) O.leaveFormation(w, s); },
    breakOff: () => { const s = pick(w.squadrons); const r = pick(w.raids); if (s && r) combat.breakOffRaid(w, [s], r.id); },
    addLeg: () => { const u = pick(movers()); if (u) O.addLeg(w, u, { heading: rnd() * 360, end: legEnd(), speedKn: rnd() < 0.3 ? 5 : null, altFt: rnd() < 0.3 ? 12000 : null }); },
    updateLeg: () => { const u = pick(movers()); if (u && u.plan.length) O.updateLeg(w, u, Math.floor(rnd() * u.plan.length), { heading: rnd() * 360, end: legEnd() }); },
    removeLeg: () => { const u = pick(movers()); if (u && u.plan.length) O.removeLeg(w, u, Math.floor(rnd() * u.plan.length)); },
    clearPlan: () => { const u = pick(movers()); if (u) O.clearPlan(w, u); },
    setEndAction: () => { const s = pick(w.squadrons); if (s) O.setEndAction(w, s, pick(O.endChoices(w, s))); },
    routeConvoy: () => { const c = pick(ships()); if (c) O.routeConvoy(w, c, [near(c, 300), near(c, 600)]); },
    editShipRoute: () => { const c = pick(ships()); if (c && c.route && c.route.length) O.editShipRoute(w, c, [...c.route.slice(0, 1), near(c, 400)]); },
    admiraltyRoute: () => { const c = pick(w.convoys); if (c && c.admiraltyRoute.length > 1) O.routeConvoy(w, c, c.admiraltyRoute.slice(1)); },
    setZigzag: () => { const c = pick(w.convoys); if (c) O.setZigzag(w, c, rnd() < 0.5); },
    shipSpeed: () => { const c = pick(w.convoys); if (c) (rnd() < 0.5 ? O.setConvoySpeed(w, c, rnd() * 14) : O.setShipSpeedPct(w, c, rnd() * 130)); },
    setShipBoost: () => { const c = pick(ships()); if (c) O.setShipBoost(w, c, rnd() < 0.5); },
    depart: () => { const c = pick(w.convoys); if (c) O.departConvoy(w, c); },
    sailEscort: () => { const e = pick(w.escorts); if (e) O.sailEscort(w, e); },
    // The exit step of a group in port (2.10.3): none, the roads, a channel of its port, or a name that is none.
    planExit: () => {
      const e = pick(w.escorts);
      if (!e || !O.planExit) return;
      const port = w.byId.port.get(e.portId);
      O.planExit(w, e, pick([null, 'roads', 'nowhere', ...((port && port.approaches) || []).map((a) => a.name)]));
    },
    // The line after the way out, drawn longer or taken away (as the ring and the cross of the sheet do).
    exitLine: () => {
      const e = pick(w.escorts);
      if (e && e.routeHead > 0) O.editShipRoute(w, e, rnd() < 0.3 ? [] : [near(e, 300), near(e, 700)]);
    },
    leavePort: () => { const e = pick(w.escorts); if (e) O.leavePort(w, e, ...near(e, 60)); },
    joinConvoy: () => { const e = pick(w.escorts); const c = pick(w.convoys); if (e && c) O.joinConvoy(w, e, c.id); },
    leaveConvoy: () => { const e = pick(w.escorts); if (e) O.leaveConvoy(w, e); },
    setEscortBehaviour: () => { const e = pick(w.escorts); if (e) O.setEscortBehaviour(w, e, pick(['stay', 'hunt'])); },
    setEscortPattern: () => { const e = pick(w.escorts); if (e && O.setEscortPattern) O.setEscortPattern(w, e, pick(['full', 'light', 'none'])); },
    // The orders of the sea as the interface sends them (2.8): at once, by lamp, by radio at
    // the next relief or carried by a group, with what goes with them.
    seaOrder: () => {
      const C = sim.comms;
      const u = pick(ships());
      if (!C || !u) return;
      const convoy = pick(w.convoys);
      const port = pick(w.ports);
      const args = {
        route: [[near(u, 300), near(u, 600)]],
        editRoute: [[near(u, 200), near(u, 500)]],
        addLeg: [{ heading: rnd() * 360, end: legEnd() }],
        updateLeg: [0, { heading: rnd() * 360, end: legEnd() }],
        removeLeg: [0],
        clearPlan: [],
        speedPct: [rnd() * 130],
        boost: [rnd() < 0.5],
        convoySpeed: [rnd() * 14],
        zigzag: [rnd() < 0.5],
        join: [convoy ? convoy.id : 'none'],
        leave: [],
        home: [rnd() < 0.5 || !port ? null : port.id],
        behaviour: [pick(['stay', 'hunt'])],
        pattern: [pick(['full', 'light'])],
        huntPlot: [pick(w.uboatPlots)?.id ?? 'none'],
        huntStop: [],
        endAction: [pick([{ kind: 'stop' }, { kind: 'hold' }, { kind: 'hunt' }, { kind: 'port', id: port ? port.id : null }])],
        position: [],
      };
      const name = pick(C.ORDER_NAMES);
      C.sendOrder(w, u, name, ...(args[name] || []));
    },
    commsCancel: () => { const C = sim.comms; const s = pick(w.signals || []); if (C && s) C.cancelOrder(w, s.id); },
    commsCarry: () => { const C = sim.comms; const s = pick(w.signals || []); const e = pick(w.escorts); if (C && s && e) C.carryByShip(w, s.id, e.id); },
    askPosition: () => { const C = sim.comms; const u = pick(ships()); if (C && u) C.requestPosition(w, u); },
    // The settings of the game, changed by an order during the game (N9, Code 4 of the audit).
    gameSetting: () => {
      const key = pick([...settings.GAME_SETTING_KEYS, 'nothing']);
      const values = Object.values(data.presets.presets).map((p) => p[key]).filter((v) => v !== undefined);
      settings.setGameSetting(w, key, pick([...values, ...(data.presets.choices?.[key] || []), 'absurd', true, false, null]), data.presets);
    },
    applyPreset: () => { if (rnd() < 0.3) settings.applyPreset(w, pick([...Object.keys(data.presets.presets), 'nothing']), data.presets); },
    huntPlot: () => { const e = pick(w.escorts); const p = pick(w.uboatPlots); if (e && p) O.huntPlot(w, e, p.id); },
    stopHunt: () => { const e = pick(w.escorts); if (e) asw.stopHunt(w, e); },
    escortHome: () => { const e = pick(w.escorts); if (e) O.escortHome(w, e, rnd() < 0.5 ? null : (pick(w.ports) || {}).id); },
    setShipEndAction: () => { const e = pick(w.escorts); if (e) sim.naval.setShipEndAction(w, e, pick(sim.naval.shipEndChoices(w, e))); },
    setExitChannel: () => { const e = pick(w.escorts); if (e) O.setExitChannel(w, e, pick(channels())); },
    sendTrain: () => { const a = pick(sites()); const b = pick(sites()); if (a && b) O.sendTrain(w, a.key, b.key, { fuel: rnd() * 120, materiel: rnd() < 0.5 ? rnd() * 60 : 0, ammo: rnd() < 0.3 ? 5 : 0 }); },
    setMinStock: () => { const a = pick(sites()); if (a) O.setMinStock(w, a, pick(['fuel', 'materiel', 'ammo']), pick([null, 0, 20, 60, NaN])); },
    buyOffer: () => { const o = pick(sim.shipping.offers(w)); if (o) O.buyOffer(w, o.id); },
    deployMru: () => { const f = pick(w.airfields); if (f) mru.deployMru(w, f.x + (rnd() - 0.5) * 60, f.y + (rnd() - 0.5) * 60, rnd() * 360); },
    answerQuestion: () => { const q = pick(w.questions); if (q) O.answerQuestion(w, q.id, pick([true, false, 'wait', 'slow', 'go'])); },
    newFormation: () => { const u = pick(rnd() < 0.7 ? w.squadrons : w.escorts); if (u) F.newFormation(w, u.kind === 'squadron' ? 'air' : 'naval', u.id); },
    addMember: () => { const f = pick(w.formations); if (f) { const u = pick(f.kind === 'air' ? w.squadrons : w.escorts); if (u) F.addMember(w, f, u.id); } },
    removeMember: () => { const f = pick(w.formations); if (f) F.removeMember(w, f, pick(f.members)); },
    setLeader: () => { const f = pick(w.formations); if (f) F.setLeader(w, f, pick(f.members)); },
    moveMember: () => { const f = pick(w.formations); if (f) F.moveMember(w, f, pick(f.members), pick([-1, 1])); },
    mergeFormations: () => { const a = pick(w.formations); const b = pick(w.formations); if (a && b) F.mergeFormations(w, a, b); },
    dissolveFormation: () => { const f = pick(w.formations); if (f && rnd() < 0.3) F.dissolveFormation(w, f); },
    scrambleFormation: () => { const f = pick(air()); if (f) F.scrambleFormation(w, f, pick([{ vector: rnd() * 360 }, { orbit: true }, {}])); },
    interceptFormation: () => { const f = pick(air()); const r = pick([...w.contacts.keys()]); if (f && r) F.interceptFormation(w, f, r); },
    launchWaiting: () => { const f = pick(w.formations); if (f) F.launchWaiting(w, f); },
    formationHome: () => { const f = pick(w.formations); if (f) F.formationHome(w, f, (u) => (f.kind === 'air' ? O.returnToBase(w, u) : O.escortHome(w, u))); },
    scheduleTakeoff: () => { const s = pick(w.squadrons); if (s) timetable.scheduleTakeoff(w, s, w.t + rnd() * 7200 - 600, { daily: rnd() < 0.5, join: rnd() < 0.3 && w.formations.length ? pick(w.formations).id : null }); },
    cancelTakeoff: () => { const s = pick(w.squadrons); if (s) timetable.cancelTakeoff(w, s); },
    scheduleWing: () => { const f = pick(air()); if (f) timetable.scheduleWing(w, f, w.t + rnd() * 7200, { daily: rnd() < 0.5 }); },
    scheduleSail: () => { const c = pick(ships()); if (c) timetable.scheduleSail(w, c, w.t + rnd() * 86400); },
    rosterDaily: () => { const s = pick(w.squadrons); if (s) roster.addDaily(w, s, Math.floor(rnd() * 86400), pick(states)); },
    rosterOverride: () => { const s = pick(w.squadrons); if (s) { roster.startOverride(w, s, pick([6, 12, 24, 48])); roster.addOverride(w, s, rnd() * 20, pick([states[0], states[3]])); } },
    rosterEnd: () => { const s = pick(w.squadrons); if (s) (rnd() < 0.5 ? roster.endOverride(w, s) : roster.resumeRoster(w, s)); },
    rosterCopy: () => { const a = pick(w.squadrons); const b = pick(w.squadrons); if (a && b) roster.copyDaily(w, a, b); },
    rallyNew: () => {
      const f = pick(w.formations);
      if (!f) return;
      rally.newRally(w, f);
      const l = F.leaderOf(w, f);
      if (!l || rnd() > 0.7) return;
      rally.setRallyWhere(w, f, pick(['leader', 'point']));
      rally.setRallyPoint(w, f, ...near(l, 80));
      rally.setRallyAlt(w, f, 2000 + rnd() * 6000);
      rally.setRallyTime(w, f, rnd() < 0.5 ? null : w.t + rnd() * 5400);
      rally.setRallyMissing(w, f, pick(['wait', 'slow', 'go']), pick([null, 5, 15]));
      rally.setRallyRoute(w, f, [near(l, 150)]);
    },
    rallyArm: () => { const f = pick(w.formations.filter((x) => x.rally)); if (f) { rally.computeDepartures(w, f); rally.armRally(w, f); } },
    rallyCancel: () => { const f = pick(w.formations.filter((x) => x.rally)); if (f) rally.cancelRally(w, f); },
  };
  return { actions, names: Object.keys(actions), setWorld: (next) => { w = next; }, pick };
}

/** Where two snapshots differ: the first few paths, with both values. */
function firstDifferences(a, b, path = '', out = []) {
  if (out.length >= 3) return out;
  const plain = (v) => v === null || typeof v !== 'object';
  if (plain(a) || plain(b) || Array.isArray(a) !== Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${String(JSON.stringify(a)).slice(0, 90)} ≠ ${String(JSON.stringify(b)).slice(0, 90)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) firstDifferences(a[k], b[k], `${path}.${k}`, out);
  return out;
}

/**
 * What is wrong with the `routeHead` of a group, or null: it counts the first points of the
 * route, and those are a run of points of one charted channel of a port, outward.
 */
export function wayOutFlaw(w, e) {
  const head = e.routeHead;
  if (!Number.isInteger(head) || head < 0 || head > e.route.length) return `has a way out of ${head} points on a route of ${e.route.length}`;
  if (!e.exitPlanned && e.exitChannel && e.state === 'inPort' && e.route.length) return 'keeps a channel that is no step';
  if (e.state === 'inPort' && e.route.length && !head) return 'has a route in port that does not start by a way out';
  if (!head) return null;
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  for (const port of w.byId.port.values()) {
    for (const a of port.approaches || []) {
      const out = a.points.slice(0, -1).reverse();
      for (let i = 0; i + head <= out.length; i++) {
        if (same(out[i], e.route[0]) && e.route.slice(0, head).every((p, k) => same(p, out[i + k]))) return null;
      }
    }
  }
  return `has a way out of ${head} points that follows no channel of a port`;
}

function check(w, label, problems) {
  const at = gameClock(w);
  for (const u of [...w.squadrons, ...w.convoys, ...w.escorts, ...w.uboats, ...w.raids]) {
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) problems.push(`${at} after « ${label} »: position NaN for ${u.kind} ${u.id}`);
  }
  for (const s of w.squadrons) {
    if (s.aircraft < 0 || s.pilots < 0 || !Number.isFinite(s.fuel) || !Number.isFinite(s.alt)) {
      problems.push(`${at} after « ${label} »: bad squadron ${s.id}: ${s.aircraft} aircraft, ${s.pilots} pilots, fuel ${s.fuel}, altitude ${s.alt}`);
    }
  }
  for (const c of w.convoys) {
    if (c.ships < 0 || c.cargo.fuel < -1e-6 || c.cargo.materiel < -1e-6) problems.push(`${at} after « ${label} »: bad convoy ${c.id}`);
  }
  // The head of a group's route (2.10.3): its charted way out of port, and nothing else.
  for (const e of w.escorts) {
    const flaw = wayOutFlaw(w, e);
    if (flaw) problems.push(`${at} after « ${label} »: group ${e.id} (${e.state}) ${flaw}`);
  }
  for (const site of w.sites.values()) {
    if (!site.stocks) {
      problems.push(`${at} after « ${label} »: site ${site.key} has no stocks`);
      continue;
    }
    for (const [k, v] of Object.entries(site.stocks)) if (!(v >= -1e-6)) problems.push(`${at} after « ${label} »: stock ${k} of ${site.key} = ${v}`);
  }
  if (w.currency && !(w.currency.stock >= -1e-6)) problems.push(`${at} after « ${label} »: dollars ${w.currency.stock}`);
}

/**
 * Plays games of a scenario until `orders` random orders have been given (a game that ends
 * early is followed by another one). Returns { orders, games, restores, problems }.
 */
/**
 * `orders` random orders spread over the scenario (over its first `days` days when given: a
 * shorter run for the everyday tests), with saves and restores. Returns the problems found.
 */
export function runMonkey({ scenario, preset = 'standard', seed = 1, orders = 10000, maxProblems = 5, days = null } = {}) {
  const rnd = randomSource(seed);
  const problems = [];
  let given = 0;
  let restores = 0;
  let games = 0;
  let last = 'start';
  while (given < orders && problems.length < maxProblems && games < 40) {
    let w = makeWorld(scenario, { preset, seed: seed * 1000 + games });
    games++;
    const kit = buildActions(rnd, w);
    const length = days ? Math.min(w.endS, days * 86400) : w.endS;
    const every = Math.max(1, Math.floor(length / orders));
    const saveEvery = Math.max(1800, Math.round(length / 40));
    try {
      while (!w.ended && given < orders && w.t < length) {
        sim.world.step(w, 1);
        w.events.length = 0;
        if (w.t % every === 0) {
          last = kit.pick(kit.names);
          given++;
          kit.actions[last]();
        }
        if (w.t % 3600 === 0) check(w, last, problems);
        if (w.t % saveEvery === 0 && rnd() < 0.5) {
          // Save and restore through JSON, as the browser does; the restored game goes on.
          const text = JSON.stringify(sim.save.snapshot(w));
          const fresh = sim.world.createWorld({ scenario: structuredClone(w.scenario), rules: data.rules, settings: w.settings, terrain: getTerrain() });
          sim.events.drainEvents(fresh);
          sim.save.restore(fresh, JSON.parse(text), (ww, def) => mru.addMobileRadar(ww, def));
          const again = JSON.stringify(sim.save.snapshot(fresh));
          if (again !== text) problems.push(`${gameClock(w)} after « ${last} »: the restored game differs from the saved one: ${firstDifferences(JSON.parse(text), JSON.parse(again)).join(' ; ')}`);
          w = fresh;
          kit.setWorld(w);
          restores++;
        }
        if (problems.length >= maxProblems) break;
      }
    } catch (err) {
      problems.push(`${gameClock(w)} EXCEPTION after « ${last} » (order ${given}, game ${games}): ${err.stack.split('\n').slice(0, 5).join(' | ')}`);
    }
  }
  return { scenario, preset, seed, orders: given, games, restores, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--all') {
    // npm run fuzz: every scenario, 10 000 orders each (the criterion of the M2.7 gate).
    const orders = Number(args[1] || 10000);
    let bad = 0;
    for (const scenario of SCENARIOS) {
      const t0 = performance.now();
      const r = runMonkey({ scenario, preset: scenario === 'hiver-atlantique' ? 'realistic' : 'standard', seed: Number(args[2] || 1), orders });
      console.log(`${r.problems.length ? 'FAIL' : 'ok  '} ${scenario}: ${r.orders} orders, ${r.games} game(s), ${r.restores} saves restored, ${Math.round((performance.now() - t0) / 1000)} s`);
      for (const p of r.problems) console.log(`     ${p}`);
      bad += r.problems.length;
    }
    if (bad) process.exitCode = 1;
  } else {
    const [scenario = 'adlertag', orders = '10000', seed = '1', preset = 'standard'] = args;
    const t0 = performance.now();
    const r = runMonkey({ scenario, preset, seed: Number(seed), orders: Number(orders) });
    console.log(JSON.stringify({ ...r, ms: Math.round(performance.now() - t0) }, null, 1));
    if (r.problems.length) process.exitCode = 1;
  }
}
