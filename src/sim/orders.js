// Orders given by the player. Every order goes through these functions, so that a later
// version can record and replay them.

import { FOOT_M } from './geo.js';
import { emit } from './events.js';
import { disengage } from './combat.js';
import {
  aircraftSpec, airfieldsAround, applyEndAction, applyPointAltitude, isFlying, squadronSpeed, startReturn,
} from './squadron.js';
import { currentSpeed as currentSpeedOf, editShipRoute, editablePoints, legSpeed, routeConvoy } from './convoy.js';
import { projectPlan, resolveClock } from './navigation.js';
import { airfieldDelayFactor, isOperational } from './sites.js';
import { bearing, distance, headingDiff, polylineLength } from './geo.js';
import { sendEscortHome } from './naval.js';
import { endHunt, startHunt } from './asw.js';
import { interceptChance } from './control.js';
import { ALERT_STATES, changeAlert, scrambleSeconds, strength, tire } from './crews.js';
import { dispatchTrain } from './logistics.js';

export { editShipRoute, routeConvoy };

function copyLegs(legs) {
  return (legs || []).map((leg) => ({ ...leg, end: leg.end ? { ...leg.end } : null }));
}

/** Route points [x, y, altM or null], copied. */
function copyRoute(points) {
  return (points || []).map((p) => [p[0], p[1], p[2] ?? null]);
}

/** A height in feet kept between the limits (and the ceiling of the type) and rounded to the step. */
export function clampFeet(world, feet, s = null) {
  const R = world.rules.squadron;
  const spec = s ? aircraftSpec(world, s.type) : null;
  const top = Math.min(R.maxAltitudeFt, spec && spec.ceilingFt ? spec.ceilingFt : R.maxAltitudeFt);
  return Math.max(R.minAltitudeFt, Math.min(top, Math.round(feet / R.altitudeStepFt) * R.altitudeStepFt));
}

export function scramble(world, s, { route = null, vector = null, orbit = false, plan = null } = {}) {
  if (s.state !== 'ready') {
    emit(world, 'scrambleRefused', { squadron: s.name, squadronId: s.id, state: s.state });
    return false;
  }
  const field = world.byId.airfield.get(s.airfield);
  if (!isOperational(world, field)) {
    emit(world, 'scrambleRefused', { squadron: s.name, squadronId: s.id, state: 'airfieldOut' });
    return false;
  }
  const delay = scrambleSeconds(world, s); // from rest, the time to recall the crews (2 h)
  if (strength(world, s) <= 0) {
    emit(world, 'scrambleRefused', { squadron: s.name, squadronId: s.id, state: 'noPilots' });
    return false;
  }
  s.state = 'scrambling';
  s.timer = Math.round(delay * airfieldDelayFactor(world, field));
  tire(world, s, world.rules.crews.fatiguePerScramble);
  s.route = copyRoute(route);
  applyPointAltitude(s);
  if (plan) s.plan = copyLegs(plan);
  s.legState = null;
  s.vector = vector;
  s.cover = null;
  s.orbit = Boolean(orbit) && !route && vector === null && !s.plan.length;
  s.speedMode = 'cruise';
  checkEndAction(world, s);
  emit(world, 'scrambleOrdered', { squadron: s.name, squadronId: s.id, airfield: field.name });
  return true;
}

function canTakeNavigationOrder(world, s) {
  if (s.state === 'returning' && (s.returnReason === 'fuel' || s.returnReason === 'ammo')) {
    emit(world, 'orderRefused', { squadron: s.name, squadronId: s.id, reason: s.returnReason });
    return false;
  }
  return s.state === 'scrambling' || isFlying(s);
}

function prepareNavigation(world, s) {
  if (s.state === 'combat') disengage(world, s, true, 'order');
  if (s.state === 'returning') {
    s.state = 'airborne';
    s.returnReason = null;
  }
  s.orbit = false;
  s.cover = null;
  s.intercept = null;
  s.attackRaid = null;
  s.follow = null;
  s.inFormation = false;
}

/** Big wing: this squadron joins another in the air and flies with it. */
export function followSquadron(world, s, leaderId) {
  const leader = world.squadrons.find((x) => x.id === leaderId);
  if (!leader || leader === s || leader.follow || leader.role !== 'fighter' || s.role !== 'fighter') return false;
  if (!(leader.state === 'airborne' || leader.state === 'scrambling')) return false;
  if (!canTakeNavigationOrder(world, s)) return false;
  prepareNavigation(world, s);
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.follow = leader.id;
  s.inFormation = false;
  emit(world, 'formationOrdered', { squadron: s.name, squadronId: s.id, leader: leader.name, leaderId: leader.id });
  return true;
}

export function leaveFormation(world, s) {
  if (!s.follow) return false;
  s.follow = null;
  s.inFormation = false;
  s.vector = s.heading;
  return true;
}

/**
 * Arcade: the controller guides the squadron onto a raid (taking off first if needed).
 * Returns the chance he gives it, or null when the order is refused.
 */
export function interceptRaid(world, s, raidId) {
  if (s.role !== 'fighter') return null;
  const chance = interceptChance(world, s, raidId);
  if (!chance || chance.p <= 0) {
    emit(world, 'interceptRefused', { squadron: s.name, squadronId: s.id, raidId });
    return null;
  }
  if (s.state === 'ready') {
    if (!scramble(world, s, {})) return null;
  } else if (!canTakeNavigationOrder(world, s)) {
    return null;
  } else {
    prepareNavigation(world, s);
  }
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.orbit = false;
  s.cover = null;
  s.intercept = { raidId, p: chance.p, ok: null };
  s.letGo.delete(raidId);
  const contact = world.contacts.get(raidId);
  emit(world, 'interceptOrdered', { squadron: s.name, squadronId: s.id, raid: contact ? contact.label : raidId, raidId, p: chance.p });
  return chance.p;
}

/** A route prepared on the ground for a squadron that takes off later (timetable.js). */
export function planGroundRoute(world, s, points) {
  if ((s.state !== 'ready' && s.state !== 'refuelling') || !points.length) return false;
  s.route = copyRoute(points);
  s.plan = [];
  s.legState = null;
  s.vector = null;
  applyPointAltitude(s);
  checkEndAction(world, s);
  if (s.schedule) {
    s.schedule.route = copyRoute(points);
    s.schedule.plan = [];
    s.schedule.endAction = { ...s.endAction };
  }
  return true;
}

export function setRoute(world, s, points) {
  if (!canTakeNavigationOrder(world, s) || !points.length) return false;
  prepareNavigation(world, s);
  s.route = copyRoute(points);
  s.plan = [];
  s.legState = null;
  s.vector = null;
  applyPointAltitude(s);
  checkEndAction(world, s);
  return true;
}

/**
 * Points of a unit's route that the player can move with the mouse ([x, y, altM]), or null
 * when the unit has no route to edit.
 */
export function editableRoute(u) {
  if (!u) return null;
  if (u.kind === 'squadron') {
    const moving = u.state === 'airborne' || u.state === 'scrambling';
    return moving && u.route.length ? u.route : null;
  }
  if ((u.kind === 'convoy' || u.kind === 'escort') && u.state === 'atSea' && u.route.length) {
    const pts = editablePoints(u);
    return pts.length ? pts : null;
  }
  return null;
}

/** Ships whose route goes into port keep their channel: no point can be added beyond it. */
export function routeCanExtend(u) {
  if (u.kind === 'squadron') return true;
  return !(u.destination && (u.routeLocked || 0) > 0);
}

/** Where the current route or legs of a squadron end, or null (no end, or open leg). */
export function navigationEnd(world, s) {
  if (s.route.length) {
    const p = s.route[s.route.length - 1];
    return { x: p[0], y: p[1] };
  }
  if (s.plan.length) {
    const track = planTrack(world, s);
    const last = track[track.length - 1];
    return last.open ? null : { x: last.x, y: last.y };
  }
  return null;
}

/**
 * End actions open to a squadron: orbit, hold the heading, come home, cover a convoy at
 * sea, and land at an aerodrome when the route ends in its bubble.
 */
export function endChoices(world, s) {
  const list = [{ kind: 'orbit' }, { kind: 'hold' }, { kind: 'home' }];
  for (const c of world.convoys) if (c.state === 'atSea') list.push({ kind: 'cover', id: c.id });
  const end = navigationEnd(world, s);
  if (end) for (const f of airfieldsAround(world, end.x, end.y)) list.push({ kind: 'land', id: f.id });
  return list;
}

function sameAction(a, b) {
  return a.kind === b.kind && (a.id || null) === (b.id || null);
}

/** An end action that no longer fits the route (aerodrome left behind, convoy in port) is dropped. */
function checkEndAction(world, s) {
  if (!endChoices(world, s).some((c) => sameAction(c, s.endAction))) s.endAction = { kind: 'orbit' };
}

export function setEndAction(world, s, action) {
  const choice = endChoices(world, s).find((c) => sameAction(c, action));
  if (!choice) return false;
  s.endAction = { ...choice };
  return true;
}

/** Altitude written on a point of the route (feet, or null to clear it). */
export function setPointAltitude(world, s, index, feet) {
  if (index < 0 || index >= s.route.length) return null;
  const ft = feet === null ? null : clampFeet(world, feet, s);
  s.route[index][2] = ft === null ? null : ft * FOOT_M;
  if (index === 0) applyPointAltitude(s);
  return ft;
}

/** Removes a point of a squadron's route; with no point left the end action is done. */
export function removeRoutePoint(world, s, index) {
  if (index < 0 || index >= s.route.length) return false;
  s.route.splice(index, 1);
  if (!s.route.length) {
    if (isFlying(s)) applyEndAction(world, s);
  } else {
    if (index === 0) applyPointAltitude(s);
    checkEndAction(world, s);
  }
  return true;
}

export function setVector(world, s, heading) {
  if (!canTakeNavigationOrder(world, s)) return false;
  prepareNavigation(world, s);
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = ((heading % 360) + 360) % 360;
  return true;
}

export function setOrbit(world, s) {
  if (!canTakeNavigationOrder(world, s) || s.state === 'scrambling') return false;
  prepareNavigation(world, s);
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.orbit = true;
  return true;
}

/** Patrol over a convoy at sea, following it. */
export function setCover(world, s, convoyId) {
  if (!canTakeNavigationOrder(world, s) || s.state === 'scrambling') return false;
  prepareNavigation(world, s);
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.cover = convoyId;
  return true;
}

/** Ordered height in feet, kept between the limits and rounded to the altitude step. */
export function setAltitude(world, s, feet) {
  const ft = clampFeet(world, feet, s);
  s.targetAlt = ft * FOOT_M;
  return ft;
}

/** State of readiness on the ground: stood down (rest), available, or pilots in the cockpits. */
export function setAlert(world, s, state) {
  if (!ALERT_STATES.includes(state)) return false;
  return changeAlert(world, s, state);
}

export function setSpeed(world, s, mode) {
  s.speedMode = mode === 'max' ? 'max' : 'cruise';
}

export function returnToBase(world, s) {
  if (s.state !== 'airborne' && s.state !== 'combat') return false;
  startReturn(world, s, 'order');
  emit(world, 'returning', {
    squadron: s.name,
    squadronId: s.id,
    airfield: world.byId.airfield.get(s.airfield).name,
  });
  return true;
}

// ---- legs (navigation by heading) ----------------------------------------------------

function domainOf(u) {
  return u.kind === 'squadron' ? 'air' : 'sea';
}

function speedFn(world, u) {
  if (u.kind === 'squadron') {
    const v = squadronSpeed(world, u);
    return () => v;
  }
  return (leg) => legSpeed(u, leg);
}

/** Dead-reckoned track of a unit's plan, for drawing and checks. */
export function planTrack(world, u, legs = u.plan) {
  const N = world.rules.navigation;
  let start = null;
  if (u.kind === 'escort' && u.state === 'inPort' && legs.length) {
    // An escort group leaves port by a charted channel; its legs start at the entrance.
    const exit = exitApproach(world, u, legs[0].heading);
    if (exit) {
      const [gx, gy] = exit.points[0];
      const km = polylineLength(exit.points);
      start = { x: gx, y: gy, t: world.t + km / currentSpeedOf(u) };
    }
  }
  if (u.kind === 'squadron' && (u.state === 'ready' || u.state === 'scrambling')) {
    const field = world.byId.airfield.get(u.airfield);
    const delay = u.state === 'scrambling' ? u.timer : world.rules.squadron.scrambleSeconds * airfieldDelayFactor(world, field);
    start = { x: field.x, y: field.y, t: world.t + delay };
  }
  return projectPlan(world, u, legs, speedFn(world, u), domainOf(u), N.openLegKm[domainOf(u)], start);
}

function canPlan(world, u) {
  if (u.kind === 'squadron') {
    if (u.state === 'ready') return true;
    return canTakeNavigationOrder(world, u);
  }
  return u.state === 'inPort' || u.state === 'atSea' || u.state === 'waiting';
}

/** A leg as typed by the player, checked and normalised; null when the heading is wrong. */
function buildLeg(world, u, leg, startT) {
  const heading = Number(leg.heading);
  if (!Number.isFinite(heading) || heading < 0 || heading > 360) return null;
  return {
    heading: Math.round(heading) % 360,
    end: resolveClock(world, leg.end ? { ...leg.end } : null, startT),
    speedKn: u.kind === 'squadron' || !leg.speedKn ? null : Math.max(1, Math.min(u.speedKn, Number(leg.speedKn))),
    altFt: u.kind === 'squadron' && leg.altFt ? clampFeet(world, Number(leg.altFt), u) : null,
  };
}

/** Ships: the legs must not run aground (a leg without end is checked as it is sailed). */
function groundingPoint(world, u, legs) {
  if (u.kind === 'squadron') return null;
  const full = planTrack(world, u, legs).filter((p) => !p.open).map((p) => [p.x, p.y]);
  const margin = u.state === 'inPort' && u.kind !== 'escort' ? world.rules.convoy.harbourMarginKm : 0;
  const land = full.length > 1 ? world.terrain.findLandOnRoute(full, margin, 0) : null;
  if (land) emit(world, 'convoyRouteRejected', { convoy: u.name, convoyId: u.id, x: land[0], y: land[1], unitKind: u.kind });
  return land;
}

/** The unit drops its route (and its meeting) to steer by its legs. */
function takePlan(world, u, legs) {
  if (u.kind === 'squadron') {
    if (u.state !== 'ready') prepareNavigation(world, u);
    if (!u.plan.length) u.legState = null;
    u.route = [];
    u.vector = null;
  } else {
    u.route = [];
    if (u.kind === 'escort') {
      u.joinTarget = null;
      u.homeward = false;
    }
    if (u.state === 'atSea' || u.state === 'waiting') {
      if (!u.plan.length) u.legState = null;
      u.state = 'atSea';
      u.destination = null;
    }
  }
  u.plan = legs;
  if (u.kind === 'squadron') checkEndAction(world, u);
}

/**
 * Adds a leg { heading, end, speedKn, altFt } at the end of a unit's plan.
 * Returns { ok, reason, at }.
 */
export function addLeg(world, u, leg) {
  if (!canPlan(world, u)) return { ok: false, reason: 'state' };
  const last = u.plan[u.plan.length - 1];
  if (last && !last.end) {
    emit(world, 'legRefused', { unit: u.name, unitId: u.id, reason: 'open' });
    return { ok: false, reason: 'open' };
  }
  const track = planTrack(world, u);
  const newLeg = buildLeg(world, u, leg, track[track.length - 1].t);
  if (!newLeg) return { ok: false, reason: 'heading' };
  const legs = [...u.plan, newLeg];
  const land = groundingPoint(world, u, legs);
  if (land) return { ok: false, reason: 'land', at: land };
  takePlan(world, u, legs);
  emit(world, 'legAdded', { unit: u.name, unitId: u.id, unitKind: u.kind, index: legs.length - 1, heading: newLeg.heading });
  return { ok: true };
}

/** Replaces leg `index` of a plan (the leg being flown starts again). */
export function updateLeg(world, u, index, leg) {
  if (!canPlan(world, u)) return { ok: false, reason: 'state' };
  if (index < 0 || index >= u.plan.length) return { ok: false, reason: 'state' };
  if (!leg.end && index < u.plan.length - 1) return { ok: false, reason: 'open' };
  const track = planTrack(world, u);
  const newLeg = buildLeg(world, u, leg, track[index].t);
  if (!newLeg) return { ok: false, reason: 'heading' };
  const legs = u.plan.map((l, i) => (i === index ? newLeg : l));
  const land = groundingPoint(world, u, legs);
  if (land) return { ok: false, reason: 'land', at: land };
  if (index === 0) u.legState = null;
  u.plan = legs;
  if (u.kind === 'squadron') checkEndAction(world, u);
  emit(world, 'legChanged', { unit: u.name, unitId: u.id, unitKind: u.kind, index, heading: newLeg.heading });
  return { ok: true };
}

export function removeLeg(world, u, index) {
  if (index < 0 || index >= u.plan.length) return false;
  u.plan.splice(index, 1);
  if (index === 0) u.legState = null;
  if (u.kind === 'squadron') {
    if (!u.plan.length && isFlying(u)) u.vector = u.heading;
    checkEndAction(world, u);
  }
  return true;
}

export function clearPlan(world, u) {
  u.plan = [];
  u.legState = null;
  if (u.kind === 'squadron') {
    if (isFlying(u)) u.vector = u.heading;
    checkEndAction(world, u);
  }
  return true;
}

/** The channel an escort group takes out of port for a first leg on `heading`. */
export function exitApproach(world, e, heading) {
  const port = world.byId.port.get(e.portId);
  let best = null;
  for (const a of port.approaches || []) {
    const [gx, gy] = a.points[0];
    const diff = Math.abs(headingDiff(bearing(port.x, port.y, gx, gy), heading));
    if (!best || diff < best.diff) best = { a, diff };
  }
  return best ? best.a : null;
}

/** A convoy (or an escort group) in port sails on its plan. */
export function departConvoy(world, c) {
  if (c.state !== 'inPort' || !c.plan.length) return false;
  if (c.kind === 'escort') {
    const exit = exitApproach(world, c, c.plan[0].heading);
    c.route = exit ? exit.points.slice(0, -1).reverse().map(([x, y]) => [x, y]) : [];
    c.routeLocked = c.route.length;
  }
  c.state = 'atSea';
  c.legState = null;
  c.destination = null;
  emit(world, 'convoySailed', { convoy: c.name, convoyId: c.id, unitKind: c.kind });
  return true;
}

/** Speed ordered on a convoy's route (null: its best), and zigzag on or off. */
export function setConvoySpeed(world, c, kn) {
  c.orderedKn = kn === null || !Number.isFinite(kn) ? null : Math.max(3, Math.min(c.speedKn, Math.round(kn)));
  return c.orderedKn;
}

export function setZigzag(world, c, on) {
  c.zigzag = Boolean(on);
  c.zigzagFactor = world.rules.asw.zigzagSpeed;
  return c.zigzag;
}

// ---- escort groups --------------------------------------------------------------------

/**
 * An escort group leaves port down the channel that brings it nearest to (x, y), and only as
 * far down it as that: a convoy in the North Channel is not met by way of the open sea.
 */
export function leavePort(world, e, x, y) {
  const port = world.byId.port.get(e.portId);
  let best = null;
  for (const a of port.approaches || []) {
    const out = a.points.slice(0, -1).reverse();
    for (let i = 0; i < out.length; i++) {
      const d = distance(out[i][0], out[i][1], x, y);
      if (!best || d < best.d) best = { out, i, d };
    }
  }
  e.state = 'atSea';
  e.destination = null;
  e.legState = null;
  e.route = best ? best.out.slice(0, best.i + 1).map(([px, py]) => [px, py]) : [];
  e.routeLocked = e.route.length;
}

/** The group sails (or turns) to meet a convoy and take station with it. */
export function joinConvoy(world, e, convoyId) {
  const c = world.convoys.find((x) => x.id === convoyId);
  if (!c || c.state !== 'atSea') return false;
  // Hunting, or with another convoy: the order ends that.
  if (e.state === 'hunting') endHunt(world, e, false, 'order');
  else if (e.state === 'escorting' && e.escorting !== convoyId) {
    e.state = 'atSea';
    e.escorting = null;
  }
  if (e.state !== 'inPort' && e.state !== 'atSea' && e.state !== 'waiting') return false;
  e.plan = [];
  if (e.state === 'inPort') leavePort(world, e, c.x, c.y);
  else {
    e.state = 'atSea';
    e.route = [];
  }
  e.joinTarget = convoyId;
  e.leftConvoy = null;
  e.homeward = false;
  emit(world, 'escortOrdered', { escort: e.name, escortId: e.id, convoy: c.name });
  return true;
}

export function leaveConvoy(world, e) {
  if (e.state !== 'escorting') return false;
  e.state = 'atSea';
  e.leftConvoy = e.escorting;
  e.escorting = null;
  return true;
}

/**
 * Stay with the convoy, or leave it to hunt a fresh U-boat contact. Told to stay while
 * hunting, the group breaks off and goes back to its convoy.
 */
export function setEscortBehaviour(world, e, behaviour) {
  if (behaviour !== 'stay' && behaviour !== 'hunt') return false;
  e.behaviour = behaviour;
  if (behaviour === 'stay' && e.state === 'hunting' && !e.huntStay) endHunt(world, e, false, 'order');
  return true;
}

/** How long its hunts last (hours), set when the player sends it hunting. */
export function setHuntHours(world, e, hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 48) return false;
  e.huntHours = h;
  if (e.state === 'hunting' && !e.huntStay && e.huntUntil !== null) e.huntUntil = world.t + h * 3600;
  return true;
}

/** Sends the group to hunt a U-boat plot, for the hours set. */
export function huntPlot(world, e, plotId) {
  const p = world.uboatPlots.find((x) => x.id === plotId);
  if (!p) return false;
  if (e.state !== 'atSea' && e.state !== 'escorting' && e.state !== 'waiting' && e.state !== 'hunting') return false;
  // A new hunt: the one going on stops (its report is closed), the way into port too.
  if (e.state === 'hunting') endHunt(world, e, false, 'order');
  e.homeward = false;
  startHunt(world, e, p.x, p.y);
  return true;
}

/** Back to a port (the one chosen, or the nearest by sea). */
export function escortHome(world, e, portId = null) {
  if (!['atSea', 'escorting', 'waiting', 'hunting'].includes(e.state)) return false;
  if (e.state === 'hunting') endHunt(world, e, false, 'order');
  sendEscortHome(world, e, portId);
  return true;
}

// ---- logistics ------------------------------------------------------------------------

/** A train from one installation to another with `loads` ({ fuel: t, materiel: t }). */
export function sendTrain(world, fromKey, toKey, loads) {
  return dispatchTrain(world, fromKey, toKey, loads);
}

/** Standing order: keep at least `tonnes` of a resource (null: no order). */
export function setMinStock(world, site, resource, tonnes) {
  site.minStock[resource] = tonnes === null || !Number.isFinite(tonnes) || tonnes <= 0 ? null : Math.round(tonnes);
  return site.minStock[resource];
}
