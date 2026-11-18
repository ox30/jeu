// An automatic player for the air scenarios (training, Kanalkampf, Adlertag, 15 septembre).
// It reads what the table shows (the estimate drawn from the plots, never the raids
// themselves) and gives the orders a player gives. It reacts within the minute and computes
// its interceptions without error: it measures balance and dominated choices, not how hard
// the game feels.
//   node tools/bot/run.mjs adlertag '{"preset":"standard","perRaid":2,"seed":3}'
import {
  createInterruptions, createStepTimer, gameClock, makeWorld, noteInterruptions, orders as O, sim,
} from './game.mjs';

const { distance, bearing, project, headingDiff } = sim.geo;
const FOOT = 0.3048;

export const AIR_DEFAULTS = {
  scenario: 'adlertag',
  preset: 'standard',
  seed: null,
  overrides: {}, // settings changed one by one
  rules: null, // patch of data/rules.json, for trials
  idle: false, // give no order at all
  perRaid: 2, // squadrons sent against each raid (0: the fighters stay on the ground)
  scale: false, // more squadrons against a big raid: one per `scaleBy` aircraft plotted
  scaleBy: 30,
  maxPerRaid: 6,
  ignoreHigh: false, // leave the very high raids (fighter sweeps) alone
  highFt: 20000,
  aboveFt: 2000, // height asked above the raid
  answers: { engage: true, pursue: true, beyond: false }, // answers to the squadrons' questions
  roe: null, // attitude given to every squadron: defend | attack | pursue (null: the default)
  revectorS: 60, // seconds between two looks at the table
  minStocks: true, // minimum stocks for the trains (manual logistics)
  bigWing: null, // ids of the squadrons flown as one formation
  reserveFuelMin: 25, // an airborne squadron with less fuel left (min) is not sent on
  naval: true, // route and escort the ocean convoys, sail the coastal convoy
  nightRest: false, // stand the squadrons down from 21:00 to 05:00
  carry: null, // what the campaign hands over from the battle before
  days: null, // stop after so many days
};

export function runAir(cfg = {}) {
  const c = { ...AIR_DEFAULTS, ...cfg };
  const w = makeWorld(c.scenario, { preset: c.preset, overrides: c.overrides, seed: c.seed, carry: c.carry, rules: c.rules });
  const mode = w.settings.interceptAid === 'auto' ? 'guided' : w.settings.orders === 'headings' ? 'vector' : 'route';
  const tally = createInterruptions();
  const timer = createStepTimer();
  const step = timer.step;
  const questions = { engage: 0, pursue: 0, beyond: 0, rally: 0 };
  const assigned = new Map(); // squadron id → raid id
  const sailed = new Set(); // convoys the player has given a route to
  let sorties = 0;
  let tired = 0;
  let exhausted = 0;
  let maxFatigue = 0;
  let busyS = 0;
  const log = [];
  const fighters = () => w.squadrons.filter((s) => s.role === 'fighter');
  const london = project(-0.1, 51.5);
  const [restState, , readyState] = sim.crews.ALERT_STATES;

  if (!c.idle && c.roe) for (const s of fighters()) O.setRoe(w, s, c.roe);
  if (!c.idle && c.minStocks && w.settings.logistics === 'manual' && w.rail.enabled) {
    const homes = new Set(fighters().map((s) => s.home));
    for (const f of w.airfields) {
      if (!homes.has(f.id)) continue;
      O.setMinStock(w, f, 'fuel', 40);
      if (w.depots.length) O.setMinStock(w, f, 'ammo', 8);
    }
    for (const f of w.factories) O.setMinStock(w, f, 'materiel', 30);
  }
  let wing = null;
  if (c.bigWing && !c.idle) {
    wing = O.newFormation(w, 'air', c.bigWing[0]);
    for (const id of c.bigWing.slice(1)) O.addMember(w, wing, id);
  }

  const speedOf = (s) => sim.squadron.aircraftSpec(w, s.type).cruiseKmh / 3600;
  const goingAway = (est) => {
    if (est.heading === null || est.heading === undefined) return false;
    return Math.abs(headingDiff(est.heading, bearing(est.x, est.y, london[0], london[1]))) > 110;
  };
  const meet = (s, est, delay) => {
    const v = speedOf(s);
    const sol = sim.intercept.solveIntercept(s.x, s.y, v, est.x + est.vx * delay, est.y + est.vy * delay, est.vx, est.vy);
    if (sol) return { x: sol.x, y: sol.y, time: sol.time + delay, heading: sol.heading };
    return { x: est.x, y: est.y, time: distance(s.x, s.y, est.x, est.y) / v + delay, heading: bearing(s.x, s.y, est.x, est.y) };
  };
  const altFor = (s, est) => O.clampFeet(w, est.altFt + c.aboveFt, s) * FOOT;

  function send(s, raidId, est) {
    const delay = s.state === 'ready' ? sim.crews.scrambleSeconds(w, s) : 0;
    const m = meet(s, est, delay);
    const altM = altFor(s, est);
    let ok = false;
    if (mode === 'guided') {
      ok = O.interceptRaid(w, s, raidId) !== null;
    } else if (s.state === 'ready') {
      ok = mode === 'route' ? O.scramble(w, s, { route: [[m.x, m.y, altM]] }) : O.scramble(w, s, { vector: m.heading });
      if (ok && mode === 'vector') O.setAltitude(w, s, altM / FOOT);
    } else {
      ok = mode === 'route' ? O.setRoute(w, s, [[m.x, m.y, altM]]) : O.setVector(w, s, m.heading);
      if (ok && mode === 'vector') O.setAltitude(w, s, altM / FOOT);
    }
    if (ok) {
      O.authorize(s, raidId); // a line drawn onto the raid is leave to attack it
      assigned.set(s.id, raidId);
    }
    return ok;
  }

  function shipOrders() {
    for (const cv of w.convoys) {
      if (cv.type === 'coastal' && cv.state === 'inPort' && !sailed.has(cv.id) && cv.admiraltyRoute.length) {
        sailed.add(cv.id);
        const r = O.routeConvoy(w, cv, cv.admiraltyRoute.slice(1));
        if (!r.ok) log.push(`${gameClock(w)} coastal convoy route refused: ${r.reason}`);
      }
      if (cv.state !== 'atSea' || cv.type === 'coastal' || cv.straggler) continue;
      // The « Amirauté » button: the charted route from the nearest point ahead.
      if (!sailed.has(cv.id) && !cv.route.length && cv.admiraltyRoute.length) {
        sailed.add(cv.id);
        let from = 1;
        let best = Infinity;
        cv.admiraltyRoute.forEach(([x, y], i) => {
          const d = distance(cv.x, cv.y, x, y);
          if (d < best) {
            best = d;
            from = Math.min(cv.admiraltyRoute.length - 1, i + 1);
          }
        });
        const r = O.routeConvoy(w, cv, cv.admiraltyRoute.slice(from));
        if (!r.ok) log.push(`${gameClock(w)} ocean convoy route refused: ${r.reason}`);
      }
      if (w.escorts.some((e) => e.escorting === cv.id || e.joinTarget === cv.id)) continue;
      const free = w.escorts.filter((e) => e.state === 'inPort')
        .sort((a, b) => distance(a.x, a.y, cv.x, cv.y) - distance(b.x, b.y, cv.x, cv.y))[0];
      if (free && distance(free.x, free.y, cv.x, cv.y) < 1800) O.joinConvoy(w, free, cv.id);
    }
  }

  function standDown() {
    const hour = new Date(w.startMs + w.t * 1000).getUTCHours();
    const want = hour >= 21 || hour < 5 ? restState : readyState;
    for (const s of fighters()) if (s.state === 'ready' && s.alert !== want) O.setAlert(w, s, want);
  }

  const stopT = c.days ? c.days * 86400 : Infinity;
  while (!w.ended && w.t < stopT) {
    step(w, 1);
    if (w.events.length) {
      noteInterruptions(w, w.events, tally);
      for (const e of w.events) {
        if (e.type === 'question') questions[e.kind] = (questions[e.kind] || 0) + 1;
        else if (e.type === 'scrambleOrdered') sorties++;
        else if (e.type === 'squadronTired') tired++;
        else if (e.type === 'squadronExhausted') exhausted++;
        else if (e.type === 'siteOut') log.push(`${gameClock(w)} out of service: ${e.siteName}`);
      }
      w.events.length = 0;
    }
    // Time during which a raid is on the table (the game then holds the speed down).
    for (const ct of w.contacts.values()) {
      if (!ct.lost) {
        busyS++;
        break;
      }
    }
    if (c.idle) continue;
    if (w.questions.length) {
      for (const q of [...w.questions]) {
        if (q.kind === 'rally') O.answerQuestion(w, q.id, true);
        else if (c.answers[q.kind] !== null && c.answers[q.kind] !== undefined) O.answerQuestion(w, q.id, c.answers[q.kind]);
      }
    }
    if (w.t % c.revectorS !== 0) continue;
    for (const s of w.squadrons) if (s.role === 'fighter' && s.fatigue > maxFatigue) maxFatigue = s.fatigue;
    if (c.naval && w.t % 600 === 0) shipOrders();
    if (c.nightRest && w.t % 600 === 0) standDown();
    if (c.perRaid <= 0) continue;

    // What the table shows.
    const contacts = [];
    for (const contact of w.contacts.values()) {
      const est = sim.query.contactEstimate(w, contact);
      if (!est) continue;
      if (c.ignoreHigh && est.altFt >= c.highFt) continue;
      contacts.push({ id: contact.raidId, est, away: goingAway(est) });
    }
    const live = new Set(contacts.map((x) => x.id));
    // Squadrons whose raid has left the table, or that are out of the fight: free again.
    for (const [sid, rid] of [...assigned]) {
      const s = w.squadrons.find((x) => x.id === sid);
      if (!s || !live.has(rid) || ['returning', 'refuelling', 'ready', 'lost'].includes(s.state)) assigned.delete(sid);
    }
    contacts.sort((a, b) => b.est.count - a.est.count);
    for (const k of contacts) {
      if (k.away) continue; // a raid going home is left to those already on it
      const want = c.scale ? Math.max(c.perRaid, Math.min(c.maxPerRaid, Math.ceil(k.est.count / c.scaleBy))) : c.perRaid;
      const on = [...assigned].filter(([, rid]) => rid === k.id).map(([sid]) => w.squadrons.find((x) => x.id === sid));
      // Those on their way get a new vector.
      for (const s of on) if (s.state === 'airborne' && !s.follow && mode !== 'guided') send(s, k.id, k.est);
      let need = want - on.length;
      if (need <= 0) continue;
      const pool = fighters()
        .filter((s) => !assigned.has(s.id) && !s.follow && sim.crews.strength(w, s) > 0
          && (s.state === 'ready' || (s.state === 'airborne' && s.ammo > 0.4 && (w.settings.fuel === 'unlimited' || s.fuel > c.reserveFuelMin))))
        .map((s) => ({ s, t: meet(s, k.est, s.state === 'ready' ? sim.crews.scrambleSeconds(w, s) : 0).time }))
        .sort((a, b) => a.t - b.t);
      for (const { s } of pool) {
        if (need <= 0) break;
        // A big wing goes as one.
        if (wing && wing.members.includes(s.id)) {
          const leader = sim.formations.leaderOf(w, wing);
          if (leader && leader.state === 'ready') {
            const m = meet(leader, k.est, sim.crews.scrambleSeconds(w, leader) + 300);
            const n = O.scrambleFormation(w, wing, mode === 'vector' ? { vector: m.heading } : { route: [[m.x, m.y, altFor(leader, k.est)]] });
            if (n) {
              for (const id of wing.members) assigned.set(id, k.id);
              O.authorize(leader, k.id);
              need -= n;
            }
          }
          continue;
        }
        if (send(s, k.id, k.est)) need--;
      }
    }
    // A squadron in the air with nothing to do goes home.
    for (const s of fighters()) {
      if (s.state !== 'airborne' || assigned.has(s.id) || s.follow || s.cover || s.attackRaid) continue;
      O.returnToBase(w, s);
    }
  }
  if (c.returnWorld) return w;
  const squadrons = fighters();
  return {
    cfg: c,
    mode,
    outcome: w.outcome,
    reason: w.defeatReason || null,
    days: +(w.t / 86400).toFixed(2),
    objectives: w.objectives.map((o) => ({ type: o.type, done: Boolean(o.done) })),
    down: sim.objectives.enemyDown(w),
    rafLost: w.stats.rafLost,
    groundLosses: w.stats.groundLosses,
    fighterShare: +sim.objectives.fighterShare(w).toFixed(3),
    intercepted: w.stats.raidsIntercepted,
    bombed: w.stats.targetsHit,
    shipsSunk: w.stats.shipsSunk,
    tired,
    exhausted,
    maxFatigue: Math.round(maxFatigue),
    endFatigue: Math.round(squadrons.reduce((a, s) => a + s.fatigue, 0) / Math.max(1, squadrons.length)),
    pilotsKilled: w.stats.pilotsKilled,
    sorties,
    busyH: +(busyS / 3600).toFixed(1),
    alerts: tally.alerts,
    stops: tally.stops,
    questions,
    steps: timer.result(),
    log: log.slice(0, 30),
  };
}

/**
 * The three air battles played one after the other, as the campaign does: the game's own
 * recordResult and carryFor decide what each battle starts with. Stops at the first defeat.
 */
export function runChain(cfg = {}) {
  const { carryFor, recordResult } = sim.campaign;
  const campaign = { results: {}, unlockAll: false };
  const battles = [];
  let won = true;
  for (const scenario of ['kanalkampf', 'adlertag', 'quinze-septembre']) {
    const settings = makeWorld(scenario, { preset: cfg.preset || 'standard', overrides: cfg.overrides || {} }).settings;
    const carry = carryFor(campaign, scenario, settings.carry);
    const w = runAir({ ...cfg, scenario, carry, returnWorld: true });
    const share = sim.objectives.fighterShare(w);
    recordResult(campaign, w, share);
    battles.push({
      scenario,
      start: carry ? +carry.fighterShare.toFixed(3) : 1,
      outcome: w.outcome,
      down: sim.objectives.enemyDown(w),
      fighterShare: +share.toFixed(3),
      failed: w.objectives.filter((o) => !o.done).map((o) => o.type),
    });
    if (w.outcome !== 'victory') {
      won = false;
      break;
    }
  }
  return {
    cfg: { ...cfg, scenario: 'campagne' },
    outcome: won ? 'victory' : 'defeat',
    reason: won ? null : battles[battles.length - 1].scenario,
    battles,
  };
}
