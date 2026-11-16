// Orders given by the player. Every order goes through these functions, so that a later
// version can record and replay them.

import { FOOT_M } from './geo.js';
import { emit } from './events.js';
import { disengage } from './combat.js';
import { isFlying, squadronSpeed, startReturn } from './squadron.js';
import { legSpeed, routeConvoy } from './convoy.js';
import { projectPlan, resolveClock } from './navigation.js';
import { airfieldDelayFactor, isOperational } from './sites.js';
import { bearing, distance, headingDiff, polylineLength } from './geo.js';
import { sendEscortHome } from './naval.js';
import { dispatchTrain } from './logistics.js';

export { routeConvoy };

function copyLegs(legs) {
  return (legs || []).map((leg) => ({ ...leg, end: leg.end ? { ...leg.end } : null }));
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
  s.state = 'scrambling';
  s.timer = Math.round(world.rules.squadron.scrambleSeconds * airfieldDelayFactor(world, field));
  s.route = route ? route.map(([x, y]) => [x, y]) : [];
  if (plan) s.plan = copyLegs(plan);
  s.legState = null;
  s.vector = vector;
  s.cover = null;
  s.orbit = Boolean(orbit) && !route && vector === null && !s.plan.length;
  s.speedMode = 'cruise';
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
}

export function setRoute(world, s, points) {
  if (!canTakeNavigationOrder(world, s) || !points.length) return false;
  prepareNavigation(world, s);
  s.route = points.map(([x, y]) => [x, y]);
  s.plan = [];
  s.legState = null;
  s.vector = null;
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
  const R = world.rules.squadron;
  const ft = Math.max(R.minAltitudeFt, Math.min(R.maxAltitudeFt, Math.round(feet / R.altitudeStepFt) * R.altitudeStepFt));
  s.targetAlt = ft * FOOT_M;
  return ft;
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
      start = { x: gx, y: gy, t: world.t + km / u.speed };
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

/**
 * Adds a leg { heading, end, speedKn } at the end of a unit's plan.
 * Returns { ok, reason, at }.
 */
export function addLeg(world, u, leg) {
  if (!canPlan(world, u)) return { ok: false, reason: 'state' };
  const heading = Number(leg.heading);
  if (!Number.isFinite(heading) || heading < 0 || heading > 360) return { ok: false, reason: 'heading' };
  const last = u.plan[u.plan.length - 1];
  if (last && !last.end) {
    emit(world, 'legRefused', { unit: u.name, unitId: u.id, reason: 'open' });
    return { ok: false, reason: 'open' };
  }
  const track = planTrack(world, u);
  const startT = track[track.length - 1].t;
  const newLeg = {
    heading: Math.round(heading) % 360,
    end: resolveClock(world, leg.end ? { ...leg.end } : null, startT),
    speedKn: u.kind === 'squadron' || !leg.speedKn ? null : Math.max(1, Math.min(u.speedKn, Number(leg.speedKn))),
  };
  const legs = [...u.plan, newLeg];

  if (u.kind !== 'squadron') {
    // Ships: the leg must not run aground (a leg without end is checked as it is sailed).
    const full = planTrack(world, u, legs).filter((p) => !p.open).map((p) => [p.x, p.y]);
    const margin = u.state === 'inPort' && u.kind !== 'escort' ? world.rules.convoy.harbourMarginKm : 0;
    const land = full.length > 1 ? world.terrain.findLandOnRoute(full, margin, 0) : null;
    if (land) {
      emit(world, 'convoyRouteRejected', { convoy: u.name, convoyId: u.id, x: land[0], y: land[1] });
      return { ok: false, reason: 'land', at: land };
    }
  }

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
  emit(world, 'legAdded', { unit: u.name, unitId: u.id, unitKind: u.kind, index: legs.length - 1, heading: newLeg.heading });
  return { ok: true };
}

export function removeLeg(world, u, index) {
  if (index < 0 || index >= u.plan.length) return false;
  u.plan.splice(index, 1);
  if (index === 0) u.legState = null;
  if (!u.plan.length && u.kind === 'squadron' && isFlying(u)) u.vector = u.heading;
  return true;
}

export function clearPlan(world, u) {
  u.plan = [];
  u.legState = null;
  if (u.kind === 'squadron' && isFlying(u)) u.vector = u.heading;
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
  }
  c.state = 'atSea';
  c.legState = null;
  c.destination = null;
  emit(world, 'convoySailed', { convoy: c.name, convoyId: c.id, unitKind: c.kind });
  return true;
}

// ---- escort groups --------------------------------------------------------------------

/** Out of port by the charted channel that leads toward (x, y). */
function leavePort(world, e, x, y) {
  const port = world.byId.port.get(e.portId);
  let best = null;
  for (const a of port.approaches || []) {
    const [gx, gy] = a.points[0];
    const d = distance(gx, gy, x, y);
    if (!best || d < best.d) best = { a, d };
  }
  e.state = 'atSea';
  e.destination = null;
  e.legState = null;
  e.route = best ? best.a.points.slice(0, -1).reverse().map(([px, py]) => [px, py]) : [];
}

/** The group sails (or turns) to meet a convoy and take station with it. */
export function joinConvoy(world, e, convoyId) {
  const c = world.convoys.find((x) => x.id === convoyId);
  if (!c || c.state !== 'atSea') return false;
  if (e.state !== 'inPort' && e.state !== 'atSea' && e.state !== 'waiting') return false;
  e.plan = [];
  if (e.state === 'inPort') leavePort(world, e, c.x, c.y);
  else {
    e.state = 'atSea';
    e.route = [];
  }
  e.joinTarget = convoyId;
  e.homeward = false;
  emit(world, 'escortOrdered', { escort: e.name, escortId: e.id, convoy: c.name });
  return true;
}

export function leaveConvoy(world, e) {
  if (e.state !== 'escorting') return false;
  e.state = 'atSea';
  e.escorting = null;
  return true;
}

export function escortHome(world, e) {
  if (e.state !== 'atSea' && e.state !== 'escorting' && e.state !== 'waiting') return false;
  sendEscortHome(world, e);
  return true;
}

// ---- logistics ------------------------------------------------------------------------

export function sendTrain(world, fromKey, toKey, resource) {
  return dispatchTrain(world, fromKey, toKey, resource);
}

/** Standing order: keep at least `tonnes` of a resource (null: no order). */
export function setMinStock(world, site, resource, tonnes) {
  site.minStock[resource] = tonnes === null || !Number.isFinite(tonnes) || tonnes <= 0 ? null : Math.round(tonnes);
  return site.minStock[resource];
}
