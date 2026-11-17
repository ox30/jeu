// Rendezvous plans for formations. A big wing (or a support group) is gathered either over its
// leader, as it takes off, or at a point on the map at a given time (or as early as possible).
// Each member has its own departure: the time its take-off (or sailing) order is given. In
// Arcade the departures are worked out so that all arrive together; in Standard they are the
// player's, and the plan shows when each will arrive; in Réaliste the plan shows distances
// only, and the player does the sums. At the rendezvous time, if someone is missing, the
// formation waits (up to a set time), slows down on its way, or goes without it; a big wing
// asks the player, who may change the plan's choice. With a time set, the formation leaves
// the rendezvous at that time (those there early circle, or heave to). Latecomers follow the plan, late, at
// full speed, and join when they catch up.

import { emit } from './events.js';
import { distance } from './geo.js';
import { aircraftSpec, isFlying } from './squadron.js';
import { scrambleSeconds } from './crews.js';
import { departConvoy, leaveConvoy, leavePort, scramble } from './orders.js';
import { askRallyQuestion, questionsOn } from './engagement.js';
import { formationById, leaderOf, linkToLeader, membersOf } from './formations.js';

const RALLY_KM = 8; // within this of the point, a squadron is at the rendezvous
const SEA_RALLY_KM = 12;
const JOIN_KM = 6; // a latecomer this close to its leader takes its place
export const MISSING = ['wait', 'slow', 'go'];

/** An empty plan for formation `f`: gather over the leader, departures now. */
export function newRally(world, f) {
  f.rally = {
    where: 'leader', x: null, y: null, altM: world.rules.squadron.defaultAltitudeFt * 0.3048,
    at: null, missing: 'wait', waitMin: f.kind === 'air' ? 10 : 360, departures: {}, route: [],
    phase: 'plan', decision: null, questionId: null, decidedAt: null, departedAt: null, rvT: null,
  };
  return f.rally;
}

export function rallyOf(f) {
  return f && f.rally ? f.rally : null;
}

/** The point of the rendezvous (world km) and its altitude; null when it is over the leader. */
export function rallyPoint(f) {
  const r = rallyOf(f);
  return r && r.where === 'point' && r.x !== null ? { x: r.x, y: r.y, altM: r.altM } : null;
}

export function setRallyPoint(world, f, x, y) {
  const r = rallyOf(f) || newRally(world, f);
  if (r.phase !== 'plan') return false;
  r.where = 'point';
  r.x = x;
  r.y = y;
  return true;
}

export function setRallyWhere(world, f, where) {
  const r = rallyOf(f) || newRally(world, f);
  if (r.phase !== 'plan' || (where !== 'leader' && where !== 'point')) return false;
  r.where = where;
  return true;
}

export function setRallyAlt(world, f, altM) {
  const r = rallyOf(f) || newRally(world, f);
  if (r.phase !== 'plan') return false;
  r.altM = Math.max(300, Math.min(10000, altM));
  return true;
}

/** The rendezvous time (game seconds), or null: as early as possible. */
export function setRallyTime(world, f, t) {
  const r = rallyOf(f) || newRally(world, f);
  if (r.phase !== 'plan') return false;
  r.at = t === null ? null : Math.round(t);
  return true;
}

export function setRallyMissing(world, f, missing, waitMin = null) {
  const r = rallyOf(f) || newRally(world, f);
  if (!MISSING.includes(missing)) return false;
  r.missing = missing;
  if (waitMin !== null && Number.isFinite(waitMin)) r.waitMin = Math.max(1, Math.round(waitMin));
  return true;
}

export function setDeparture(world, f, unitId, t) {
  const r = rallyOf(f) || newRally(world, f);
  if (r.phase !== 'plan' || !f.members.includes(unitId)) return false;
  if (t === null) delete r.departures[unitId];
  else r.departures[unitId] = Math.round(t);
  return true;
}

/** The route the formation follows from the rendezvous point. */
export function setRallyRoute(world, f, points) {
  const r = rallyOf(f) || newRally(world, f);
  r.route = points.map(([x, y, a]) => [x, y, a ?? null]);
  return true;
}

/** Where a member starts from: its aerodrome, its port, or where it is. */
function startOf(world, u) {
  if (u.kind === 'squadron') {
    if (isFlying(u)) return { x: u.x, y: u.y };
    const a = world.byId.airfield.get(u.airfield);
    return { x: a.x, y: a.y };
  }
  return { x: u.x, y: u.y };
}

/** The point the members make for: the rendezvous, or the leader's base or position. */
function goalOf(world, f) {
  const p = rallyPoint(f);
  if (p) return p;
  const leader = leaderOf(world, f);
  return leader ? { ...startOf(world, leader), altM: f.rally ? f.rally.altM : 0 } : null;
}

/**
 * Seconds from the order to the rendezvous for member `u`: the delay to take off (or sail),
 * then the trip (and the climb, for aircraft).
 */
export function tripSeconds(world, f, u) {
  const goal = goalOf(world, f);
  if (!goal) return null;
  const from = startOf(world, u);
  const km = distance(from.x, from.y, goal.x, goal.y);
  if (u.kind === 'squadron') {
    const type = aircraftSpec(world, u.type);
    const cruise = type.cruiseKmh / 3600;
    const climb = Math.max(0, goal.altM - (isFlying(u) ? u.alt : 0)) / (type.climbMpm / 60);
    const delay = isFlying(u) ? 0 : scrambleSeconds(world, u);
    return Math.round(delay + Math.max(km / cruise, climb));
  }
  const kms = (u.speedKn * 1.852) / 3600;
  return Math.round(km / kms);
}

export function tripKm(world, f, u) {
  const goal = goalOf(world, f);
  if (!goal) return null;
  const from = startOf(world, u);
  return distance(from.x, from.y, goal.x, goal.y);
}

/**
 * Arcade: the departures worked out so that every member arrives together, at the plan's
 * time or as early as possible. Returns the rendezvous time.
 */
export function computeDepartures(world, f) {
  const r = rallyOf(f) || newRally(world, f);
  const members = membersOf(world, f);
  const trips = members.map((u) => ({ u, s: tripSeconds(world, f, u) ?? 0 }));
  let at = r.at;
  if (at === null || at < world.t + Math.max(...trips.map((x) => x.s))) {
    at = world.t + Math.max(...trips.map((x) => x.s)) + 60;
    if (r.at !== null) r.at = at;
  }
  for (const { u, s } of trips) r.departures[u.id] = Math.max(world.t, Math.round(at - s));
  return at;
}

/** When member `u` will be at the rendezvous with its planned departure (Arcade, Standard). */
export function arrivalOf(world, f, u) {
  const r = rallyOf(f);
  if (!r) return null;
  const dep = r.departures[u.id] ?? world.t;
  const trip = tripSeconds(world, f, u);
  return trip === null ? null : Math.max(dep, world.t) + trip;
}

/**
 * Sets the plan going: every member gets its order for its departure time (now when none is
 * set). Returns the number of members planned.
 */
export function armRally(world, f) {
  const r = rallyOf(f) || newRally(world, f);
  if (r.phase !== 'plan') return 0;
  if (r.where === 'point' && r.x === null) return 0;
  if (world.settings.interceptAid === 'auto' || world.settings.rallyAid === 'auto') computeDepartures(world, f);
  const leader = leaderOf(world, f);
  // The route after the rendezvous: the one drawn from its point, else the leader's own.
  if (!r.route.length && leader && leader.route.length) r.route = leader.route.map((p) => [...p]);
  let n = 0;
  for (const u of membersOf(world, f)) {
    const at = Math.max(world.t, r.departures[u.id] ?? world.t);
    r.departures[u.id] = at;
    if (u.kind === 'squadron') {
      if (u.state === 'lost') continue;
      u.schedule = { id: `R${f.id}-${u.id}`, at, daily: false, join: f.id, rally: true, delayed: false, route: [], plan: [], endAction: { kind: 'orbit' } };
    } else {
      if (u.state === 'lost') continue;
      u.schedule = { id: `R${f.id}-${u.id}`, at, join: f.id, rally: true, delayed: false };
    }
    n++;
  }
  r.phase = 'armed';
  // When everyone should be there: the time set, or the latest arrival expected.
  r.rvT = r.at ?? Math.max(...membersOf(world, f).map((u) => arrivalOf(world, f, u) ?? world.t));
  emit(world, 'rallyArmed', { formation: f.name, formationId: f.id, n, at: r.at });
  return n;
}

/** The plan called off: the orders not yet given are cancelled. */
export function cancelRally(world, f) {
  const r = rallyOf(f);
  if (!r) return false;
  for (const u of membersOf(world, f)) {
    if (u.schedule && u.schedule.rally) u.schedule = null;
    u.lateFor = null;
    if (u.kind === 'squadron') u.rallySlow = null;
  }
  f.rally = null;
  return true;
}

// ---- carrying out the plan ----

/**
 * A member's order comes (timetable.js): it takes off, or sails, for the rendezvous (or for
 * its leader). Returns false when it cannot go now.
 */
export function launchMember(world, f, u) {
  const r = rallyOf(f);
  const leader = leaderOf(world, f);
  if (u.kind !== 'squadron') return sailMember(world, f, u);
  if (u.state !== 'ready') return false;
  const p = rallyPoint(f);
  if (r && p) {
    const gone = r.phase === 'gone';
    const route = gone && leader && leader !== u
      ? [[p.x, p.y, p.altM], ...leader.route.map((q) => [...q])]
      : [[p.x, p.y, p.altM]];
    if (!scramble(world, u, { route })) return false;
    u.endAction = { kind: 'orbit' };
    if (gone && leader !== u) {
      // Late: it follows the plan at full speed and joins when it catches up.
      u.lateFor = f.id;
      u.speedMode = 'max';
    }
    return true;
  }
  // Gathering over the leader.
  if (!leader || leader === u) {
    const orders = u.route.length ? { route: u.route.map((q) => [...q]) } : u.plan.length ? {} : { orbit: true };
    if (!scramble(world, u, orders)) return false;
    const flying = membersOf(world, f).some((s) => s !== u && s.follow === u.id);
    const later = membersOf(world, f).some((s) => s !== u && s.schedule && s.schedule.join === f.id);
    if (flying || later) {
      u.holdForWing = true;
      f.gatherUntil = world.t + world.rules.formations.gatherMaxS + scrambleSeconds(world, u);
    }
    return true;
  }
  if (!scramble(world, u, {})) return false;
  linkToLeader(u, leader);
  return true;
}

function sailMember(world, f, e) {
  const p = rallyPoint(f);
  if (e.state === 'refit' || e.state === 'lost') return false;
  if (!p) {
    // No point: the leader sails with its own orders (legs, or a route drawn from the port);
    // the others make for it, and formations.js has them take station once all have sailed.
    if (e.state === 'inPort') {
      const leader = leaderOf(world, f);
      if (!leader || leader === e) {
        if (e.plan.length) departConvoy(world, e);
        else if (e.route.length) {
          e.state = 'atSea';
          e.legState = null;
          emit(world, 'convoySailed', { convoy: e.name, convoyId: e.id, unitKind: 'escort' });
        } else leavePort(world, e, e.x, e.y);
      } else leavePort(world, e, leader.x, leader.y);
    }
    return true;
  }
  if (e.state === 'escorting') leaveConvoy(world, e);
  if (e.state === 'inPort') {
    leavePort(world, e, p.x, p.y);
    e.route.push([p.x, p.y]);
  } else {
    e.state = 'atSea';
    e.route = [[p.x, p.y]];
    e.routeLocked = 0;
  }
  e.plan = [];
  e.legState = null;
  e.joinTarget = null;
  e.homeward = false;
  e.destination = null;
  if (rallyOf(f).phase === 'gone') e.lateFor = f.id;
  emit(world, 'convoySailed', { convoy: e.name, convoyId: e.id, unitKind: 'escort' });
  return true;
}

function atRendezvous(world, f, u, p) {
  if (u.kind === 'squadron') return u.state === 'airborne' && distance(u.x, u.y, p.x, p.y) <= RALLY_KM;
  return (u.state === 'atSea' || u.state === 'waiting') && distance(u.x, u.y, p.x, p.y) <= SEA_RALLY_KM;
}

function missingOf(world, f, p) {
  return membersOf(world, f).filter((u) => u.state !== 'lost' && !atRendezvous(world, f, u, p));
}

/** The formation leaves the rendezvous: the leader takes the route, those present follow it. */
function depart(world, f, p, slow) {
  const r = rallyOf(f);
  const leader = leaderOf(world, f);
  if (!leader) return;
  r.phase = 'gone';
  r.departedAt = world.t;
  const late = missingOf(world, f, p);
  if (f.kind === 'air') {
    leader.holdForWing = false;
    if (r.route.length) {
      leader.route = r.route.map((q) => [...q]);
      leader.orbit = false;
    } else {
      leader.orbit = true;
    }
    leader.endAction = { kind: 'orbit' };
    for (const s of membersOf(world, f).slice(1)) {
      if (late.includes(s)) {
        // Late but on its way (or taking off): it follows the plan at full speed.
        if (isFlying(s) || s.state === 'scrambling') {
          s.lateFor = f.id;
          s.speedMode = 'max';
          s.route = [[p.x, p.y, p.altM], ...leader.route.map((q) => [...q])];
          s.orbit = false;
          s.follow = null;
          s.inFormation = false;
        }
      } else {
        linkToLeader(s, leader);
      }
    }
    if (slow && late.length) leader.rallySlow = world.rules.formations.slowFactor;
  } else {
    if (leader.state === 'waiting') leader.state = 'atSea';
    if (r.route.length) {
      leader.route = r.route.map(([x, y]) => [x, y]);
      leader.routeLocked = 0;
    }
    for (const e of membersOf(world, f).slice(1)) {
      if (e.state === 'waiting' && !late.includes(e)) e.state = 'atSea';
      if (late.includes(e)) e.lateFor = f.id;
    }
    if (slow && late.length) leader.waitForGroup = true;
  }
  emit(world, 'rallyDeparted', {
    formation: f.name, formationId: f.id, n: membersOf(world, f).length - late.length, of: membersOf(world, f).length,
    late: late.map((u) => u.name).join(', '),
  });
}

/** The rule (or the player's answer) when someone is missing at the rendezvous. */
function decide(world, f, p, choice) {
  const r = rallyOf(f);
  r.decision = choice;
  r.decidedAt = world.t;
  if (choice === 'wait') {
    r.phase = 'waiting';
    emit(world, 'rallyWaiting', { formation: f.name, formationId: f.id, min: r.waitMin });
  } else {
    depart(world, f, p, choice === 'slow');
  }
}

/** The answer to a rendezvous question (engagement.js passes it on). */
export function rallyAnswer(world, formationId, choice) {
  const f = formationById(world, formationId);
  const r = rallyOf(f);
  if (!r || r.phase !== 'deciding') return false;
  r.questionId = null;
  decide(world, f, rallyPoint(f), MISSING.includes(choice) ? choice : r.missing);
  return true;
}

function updateOne(world, f) {
  const r = rallyOf(f);
  if (!r || r.phase === 'plan') return;
  const p = rallyPoint(f);
  const leader = leaderOf(world, f);
  if (!leader) return;
  // Members arriving at a point hold there (aircraft circle; ships heave to).
  if (p && f.kind === 'naval' && (r.phase === 'armed' || r.phase === 'waiting' || r.phase === 'deciding')) {
    for (const e of membersOf(world, f)) {
      if (e.state === 'atSea' && !e.route.length && distance(e.x, e.y, p.x, p.y) <= SEA_RALLY_KM) e.state = 'waiting';
    }
  }
  if (r.phase === 'armed' || r.phase === 'waiting') {
    if (!p) {
      // Over the leader: the gathering is the wing's usual one (formations.js).
      const pending = membersOf(world, f).some((u) => u.schedule && u.schedule.rally);
      if (!pending) {
        r.phase = 'gone';
        r.departedAt = world.t;
      }
      return;
    }
    const missing = missingOf(world, f, p);
    if (r.phase === 'armed') {
      // The formation leaves with its leader: nothing happens before it is there. With a time
      // set, it leaves at that time, even if all are there before; "as early as possible", as
      // soon as all are there.
      if (!atRendezvous(world, f, leader, p)) return;
      if (!missing.length) {
        if (r.at === null || world.t >= r.at) depart(world, f, p, false);
        return;
      }
      // The rendezvous time (set, or the expected one) is the moment to decide.
      if (world.t < (r.at ?? r.rvT ?? world.t)) return;
      // Someone is missing: the plan's choice, or the player's (a big wing asks).
      if (f.kind === 'air' && questionsOn(world)) {
        r.phase = 'deciding';
        r.questionId = askRallyQuestion(world, f, missing.map((u) => u.name));
        return;
      }
      decide(world, f, p, r.missing);
      return;
    }
    // Waiting: until everyone is there, or the time allowed is out.
    if (!missing.length || world.t - r.decidedAt >= r.waitMin * 60) depart(world, f, p, false);
    return;
  }
  if (r.phase === 'gone') {
    // Latecomers take their place when they catch up; the formation speeds up again.
    let behind = 0;
    for (const u of membersOf(world, f)) {
      if (u.lateFor !== f.id) continue;
      if (u.kind === 'squadron') {
        if (u.state === 'scrambling') {
          behind++;
          continue;
        }
        if (!isFlying(u) || u.state === 'returning') {
          u.lateFor = null;
          continue;
        }
        if (distance(u.x, u.y, leader.x, leader.y) <= JOIN_KM) {
          u.lateFor = null;
          linkToLeader(u, leader);
          emit(world, 'rallyCaughtUp', { formation: f.name, formationId: f.id, unit: u.name });
        } else behind++;
      } else if (u.state === 'atSea' && distance(u.x, u.y, leader.x, leader.y) <= SEA_RALLY_KM) {
        u.lateFor = null;
        u.route = [];
      } else if (u.state === 'atSea' || u.state === 'waiting') behind++;
      else u.lateFor = null;
    }
    const pending = membersOf(world, f).some((u) => u.schedule && u.schedule.rally);
    if (!behind) {
      leader.rallySlow = null;
      if (f.kind === 'naval') leader.waitForGroup = false;
    }
    if (!behind && !pending) {
      emit(world, 'rallyDone', { formation: f.name, formationId: f.id });
      f.rally = null;
    }
  }
}

/** Every few seconds, for every formation with a plan under way. */
export function updateRallies(world) {
  for (const f of [...(world.formations || [])]) if (f.rally) updateOne(world, f);
}
