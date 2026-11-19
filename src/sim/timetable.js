// Orders given in advance, carried out at their time (checked once a minute):
//  - the duty roster: a squadron's alert states, every day or for the coming hours (roster.js);
//  - a scheduled take-off: the order to scramble is given at its hour, with the route or legs
//    prepared on the ground; the squadron is in the air once its alert delay is over (from
//    rest, two hours later). Once or every day (a dawn patrol along the coast);
//  - a wing's scheduled take-off, all its squadrons together;
//  - a scheduled sailing for a convoy or an escort group, with its route or legs.
// An order that cannot be carried out at its time (squadron refuelling, aerodrome out of
// action, ships refitting) waits until it can and tells the player once.

import { emit } from './events.js';
import { departConvoy, scramble } from './orders.js';
import { formationById, formationOf, leaderOf, membersOf, scrambleFormation } from './formations.js';
import { launchMember } from './rally.js';
import { applyRoster } from './roster.js';
import { declareFields } from './entities.js';

const DAY = 86400;

// A sailing or a take-off ordered for later: on every convoy (a straggler included), every
// escort group and every squadron.
for (const kind of ['convoy', 'escort', 'squadron']) {
  declareFields(kind, (u) => {
    u.schedule = null;
  });
}

export function createTimetable(world) {
  world.nextTimetableId = 1;
}

function nextId(world) {
  const id = `T${world.nextTimetableId}`;
  world.nextTimetableId++;
  return id;
}

const copyRoute = (r) => (r || []).map((p) => [...p]);
const copyLegs = (l) => (l || []).map((x) => ({ ...x, end: x.end ? { ...x.end } : x.end }));

// ---- duty roster: roster.js (applied once a minute below) ----

// ---- scheduled take-offs ----

/**
 * The order to take off at `at` for a squadron on the ground: with the route or legs it has
 * (or will be given) on the ground; `join`: the id of a formation to join instead.
 */
export function scheduleTakeoff(world, s, at, { daily = false, join = null } = {}) {
  if (s.state === 'lost' || !Number.isFinite(at)) return null;
  s.schedule = {
    id: nextId(world), at: Math.round(at), daily: Boolean(daily), join, delayed: false,
    route: copyRoute(s.route), plan: copyLegs(s.plan), endAction: { ...s.endAction },
  };
  return s.schedule;
}

export function cancelTakeoff(world, s) {
  if (!s.schedule) return false;
  s.schedule = null;
  return true;
}

/** A whole wing takes off at `at` (the leader with its orders, the others with it). */
export function scheduleWing(world, f, at, { daily = false } = {}) {
  if (!f || f.kind !== 'air' || !Number.isFinite(at)) return null;
  f.schedule = { id: nextId(world), at: Math.round(at), daily: Boolean(daily), delayed: false };
  return f.schedule;
}

export function cancelWing(world, f) {
  if (!f || !f.schedule) return false;
  f.schedule = null;
  return true;
}

/** Why the squadron cannot take the order now, or null. */
function notReady(world, s) {
  if (s.state === 'lost') return 'lost';
  if (s.state !== 'ready') return s.state;
  return null;
}

/** The orders a squadron takes off with: its prepared route or legs, else a patrol overhead. */
function takeoffOrders(s, sched) {
  const route = s.route.length ? copyRoute(s.route) : copyRoute(sched && sched.route);
  const plan = s.plan.length ? copyLegs(s.plan) : copyLegs(sched && sched.plan);
  if (sched && sched.endAction && !s.route.length && !s.plan.length) s.endAction = { ...sched.endAction };
  if (route.length) return { route };
  if (plan.length) return { plan };
  return { orbit: true };
}

function delayed(world, holder, unit, reason) {
  if (holder.delayed) return;
  holder.delayed = true;
  emit(world, 'scheduleDelayed', { unit: unit.name, unitId: unit.id, unitKind: unit.kind, reason, x: unit.x, y: unit.y });
}

function runTakeoff(world, s) {
  const sched = s.schedule;
  if (!sched || sched.at > world.t) return;
  // A squadron that joins a wing: handled with the wing (formations.js), unless it is alone.
  const f = sched.join ? formationById(world, sched.join) : null;
  if (sched.join && f && f.members.includes(s.id)) {
    if (notReady(world, s)) {
      delayed(world, sched, s, notReady(world, s));
      return;
    }
    if (!launchMember(world, f, s)) {
      delayed(world, sched, s, 'refused');
      return;
    }
  } else {
    const why = notReady(world, s);
    if (why) {
      delayed(world, sched, s, why);
      return;
    }
    const orders = takeoffOrders(s, sched);
    if (!scramble(world, s, orders)) {
      delayed(world, sched, s, 'refused');
      return;
    }
    if (orders.route) sched.route = copyRoute(orders.route);
    if (orders.plan) sched.plan = copyLegs(orders.plan);
  }
  emit(world, 'scheduledTakeoff', { squadron: s.name, squadronId: s.id, late: sched.delayed });
  if (sched.daily) {
    sched.delayed = false;
    while (sched.at <= world.t) sched.at += DAY;
  } else {
    s.schedule = null;
  }
}

function runWing(world, f) {
  const sched = f.schedule;
  if (!sched || sched.at > world.t) return;
  const leader = leaderOf(world, f);
  if (!leader) {
    f.schedule = null;
    return;
  }
  const ready = membersOf(world, f).filter((s) => s.state === 'ready');
  if (!ready.length) {
    delayed(world, sched, { name: f.name, id: f.id, kind: 'formation', x: leader.x, y: leader.y }, 'notReady');
    return;
  }
  const orders = takeoffOrders(leader, null);
  const n = scrambleFormation(world, f, orders);
  if (!n) {
    delayed(world, sched, { name: f.name, id: f.id, kind: 'formation', x: leader.x, y: leader.y }, 'refused');
    return;
  }
  emit(world, 'scheduledWing', { formation: f.name, formationId: f.id, n, late: sched.delayed });
  if (sched.daily) {
    sched.delayed = false;
    while (sched.at <= world.t) sched.at += DAY;
  } else f.schedule = null;
}

// ---- scheduled sailings ----

/**
 * A convoy or an escort group in port sails at `at` with the route or legs it has; a group
 * with nothing prepared goes out to the roads.
 */
export function scheduleSail(world, c, at) {
  if (!Number.isFinite(at) || (c.state !== 'inPort' && c.state !== 'refit')) return null;
  c.schedule = { id: nextId(world), at: Math.round(at), delayed: false };
  return c.schedule;
}

export function cancelSail(world, c) {
  if (!c.schedule) return false;
  c.schedule = null;
  return true;
}

function runSail(world, c) {
  const sched = c.schedule;
  if (!sched || sched.at > world.t) return;
  // A group of a support group sailing to its rendezvous (rally.js).
  const f = sched.join ? formationById(world, sched.join) : null;
  if (f && f.members.includes(c.id)) {
    if (c.state === 'refit') {
      delayed(world, sched, c, 'refit');
      return;
    }
    c.schedule = null;
    if (launchMember(world, f, c)) emit(world, 'scheduledSail', { unit: c.name, unitId: c.id, unitKind: c.kind, late: sched.delayed });
    return;
  }
  if (c.state !== 'inPort') {
    if (c.state === 'refit') {
      delayed(world, sched, c, 'refit');
      return;
    }
    c.schedule = null; // already at sea
    return;
  }
  if (c.kind === 'escort' || c.plan.length) {
    // An escort group sails at its hour as it does on « Appareiller »: by its exit step and
    // what follows it (a line, legs), or out to the roads when nothing was prepared, to wait
    // there for orders. (Until 2.10.2 a group with neither line nor legs never left.)
    c.schedule = null;
    departConvoy(world, c);
  } else if (c.route.length) {
    c.schedule = null;
    c.state = 'atSea';
    c.legState = null;
    emit(world, 'convoySailed', { convoy: c.name, convoyId: c.id, unitKind: c.kind });
  } else {
    delayed(world, sched, c, 'noRoute');
    return;
  }
  emit(world, 'scheduledSail', { unit: c.name, unitId: c.id, unitKind: c.kind, late: sched.delayed });
}

/** Once a minute: every order whose time has come. */
export function updateTimetable(world) {
  for (const s of world.squadrons) {
    if (s.roster) applyRoster(world, s);
    if (s.schedule) runTakeoff(world, s);
  }
  for (const f of world.formations || []) if (f.schedule) runWing(world, f);
  for (const c of world.convoys) if (c.schedule) runSail(world, c);
  for (const e of world.escorts) if (e.schedule) runSail(world, e);
}

/** The squadron's formation, if it is a member (for the panels). */
export function scheduledFormation(world, s) {
  return formationOf(world, s);
}
