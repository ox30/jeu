// The war at sea: U-boats that hunt the convoys at night, the escort groups that protect
// them, bombers against the coastal convoys, and the radio direction-finding fixes that
// betray a U-boat's position, roughly, when it reports a convoy.

import { KNOT_KMH, bearing, distance, headingVector, project, unproject } from './geo.js';
import { emit } from './events.js';
import { solveIntercept } from './intercept.js';
import { acceptingPorts, currentSpeed, stepShip } from './convoy.js';
import { dive, isSubmerged, spotAttacker, stepHunt } from './asw.js';

// ---- ships lost -------------------------------------------------------------------

/** Sinks `n` ships of a convoy; tankers and freighters go down in proportion. */
export function sinkShips(world, c, n, cause) {
  let tankers = 0;
  let freighters = 0;
  let fuel = 0;
  let materiel = 0;
  for (let i = 0; i < n && c.ships > 0; i++) {
    const tanker = c.tankers > 0 && world.rng.next() < c.tankers / c.ships;
    c.ships--;
    if (tanker) {
      c.tankers--;
      tankers++;
      const lost = Math.min(c.cargo.fuel, c.fuelPerTanker);
      c.cargo.fuel -= lost;
      fuel += lost;
    } else {
      c.freighters = Math.max(0, c.freighters - 1);
      freighters++;
      const lost = Math.min(c.cargo.materiel, c.materielPerFreighter);
      c.cargo.materiel -= lost;
      materiel += lost;
    }
  }
  const sunk = tankers + freighters;
  if (!sunk) return 0;
  world.stats.shipsSunk += sunk;
  world.stats.cargoLost += fuel + materiel;
  emit(world, 'shipsSunk', {
    convoy: c.name, convoyId: c.id, sunk, tankers, freighters, fuel: Math.round(fuel), materiel: Math.round(materiel), cause,
    x: c.x, y: c.y, left: c.ships,
  });
  if (c.ships <= 0) {
    c.state = 'lost';
    c.route = [];
    c.plan = [];
    emit(world, 'convoyLost', { convoy: c.name, convoyId: c.id });
  }
  return sunk;
}

/** Bombs on a convoy at sea (called when a raid sent against a convoy drops its load). */
export function attackConvoyFromAir(world, c, raid, accuracy) {
  if (c.state !== 'atSea') return;
  const p = Math.min(0.5, world.rules.convoyAir.pSinkPerBomber * accuracy);
  const n = world.rng.binomial(raid.bombers, p);
  emit(world, 'convoyBombed', { convoy: c.name, convoyId: c.id, raid: raid.label, sunk: n, x: c.x, y: c.y });
  sinkShips(world, c, n, 'air');
}

// ---- escort groups ----------------------------------------------------------------

export function createEscortGroup(world, def) {
  const port = world.byId.port.get(def.from);
  return {
    kind: 'escort',
    id: def.id,
    name: def.name,
    short: def.short || def.name,
    ships: def.ships,
    composition: def.composition || '',
    speedKn: def.speedKn,
    legKn: null,
    speed: (def.speedKn * KNOT_KMH) / 3600,
    x: port.x,
    y: port.y,
    px: port.x,
    py: port.y,
    heading: 270,
    course: 270,
    route: [],
    routeLocked: 0,
    plan: [],
    legState: null,
    state: 'inPort', // inPort | atSea | waiting | escorting | refit
    portId: port.id,
    destination: null,
    joinTarget: null, // convoy the group is ordered to meet
    escorting: null, // convoy the group is with
    enduranceMax: def.enduranceDays * 86400,
    endurance: def.enduranceDays * 86400,
    timer: 0,
    lowWarned: false,
    homeward: false,
    behaviour: def.behaviour || 'stay', // stay with the convoy, or hunt the contacts
    huntFor: null,
  };
}

/** Number of escort ships with a convoy (a group away hunting does not count). */
export function escortStrength(world, c) {
  let n = 0;
  for (const e of world.escorts) if (e.state === 'escorting' && e.escorting === c.id) n += e.ships;
  return n;
}

function enterPort(world, e, port) {
  e.state = 'refit';
  e.homeward = false;
  e.portId = port.id;
  e.x = port.x;
  e.y = port.y;
  e.route = [];
  e.plan = [];
  e.legState = null;
  e.destination = null;
  e.escorting = null;
  e.joinTarget = null;
  e.timer = world.rules.escortGroups.refitHours * 3600;
  emit(world, 'escortInPort', { escort: e.name, escortId: e.id, port: port.name });
}

function join(world, e, c) {
  e.state = 'escorting';
  e.escorting = c.id;
  e.joinTarget = null;
  e.route = [];
  e.plan = [];
  e.legState = null;
  emit(world, 'escortJoined', { escort: e.name, escortId: e.id, convoy: c.name, convoyId: c.id });
}

/** Sends the group home by the nearest convoy port's channel. */
export function sendEscortHome(world, e) {
  let best = null;
  let bestD = Infinity;
  for (const port of acceptingPorts(world, e)) {
    for (const a of port.approaches || []) {
      const d = distance(e.x, e.y, a.points[0][0], a.points[0][1]);
      if (d < bestD) {
        bestD = d;
        best = { port, a };
      }
    }
  }
  e.escorting = null;
  e.joinTarget = null;
  e.state = 'atSea';
  e.plan = [];
  e.legState = null;
  e.homeward = true;
  if (best) {
    e.route = [[best.a.points[0][0], best.a.points[0][1]], ...best.a.points.slice(1)];
    e.routeLocked = e.route.length;
    e.destination = best.port.id;
  }
}

export function updateEscort(world, e, dt) {
  e.px = e.x;
  e.py = e.y;
  const R = world.rules.escortGroups;
  if (e.state === 'refit') {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'inPort';
      e.endurance = e.enduranceMax;
      e.lowWarned = false;
      emit(world, 'escortReady', { escort: e.name, escortId: e.id, port: world.byId.port.get(e.portId).name });
    }
    return;
  }
  if (e.state === 'inPort') return;
  e.endurance -= dt;
  if (e.state === 'hunting') {
    stepHunt(world, e, dt);
    return;
  }
  if (!e.lowWarned && e.endurance < R.lowEnduranceDays * 86400) {
    e.lowWarned = true;
    emit(world, 'escortLowFuel', { escort: e.name, escortId: e.id });
    sendEscortHome(world, e);
    return;
  }

  if (e.state === 'escorting') {
    const c = world.convoys.find((x) => x.id === e.escorting);
    if (!c || c.state !== 'atSea') {
      // The convoy is in port (or lost): the group goes into the same port, or home.
      if (c && c.state === 'arrived') enterPort(world, e, world.byId.port.get(c.portId));
      else sendEscortHome(world, e);
      return;
    }
    const [dx, dy] = headingVector(c.heading);
    e.x = c.x + dx * 4;
    e.y = c.y + dy * 4;
    e.heading = c.heading;
    e.course = c.heading;
    return;
  }
  if (e.state !== 'atSea') return;

  // Ordered to meet a convoy: steer for the meeting point (with an interception aid only).
  if (e.joinTarget && !e.route.length && !e.plan.length) {
    const c = world.convoys.find((x) => x.id === e.joinTarget);
    if (!c || c.state !== 'atSea') e.joinTarget = null;
    else {
      const v = currentSpeed(c);
      const [hx, hy] = headingVector(c.heading);
      const sol = solveIntercept(e.x, e.y, e.speed, c.x, c.y, hx * v, hy * v);
      e.course = sol ? sol.heading : bearing(e.x, e.y, c.x, c.y);
    }
  }
  stepShip(world, e, dt, (port) => enterPort(world, e, port));
  if (e.state !== 'atSea') return;
  // Meeting: within sight of an ocean convoy, the group takes station.
  for (const c of world.convoys) {
    if (c.state !== 'atSea' || c.type === 'coastal') continue;
    if (e.joinTarget && e.joinTarget !== c.id) continue;
    if (distance(e.x, e.y, c.x, c.y) <= R.joinKm) {
      join(world, e, c);
      return;
    }
  }
}

// ---- U-boats ----------------------------------------------------------------------

export function createUboat(world, def) {
  const [x, y] = project(def.lon, def.lat);
  return {
    kind: 'uboat',
    id: def.id,
    hx: x,
    hy: y,
    radius: def.radiusKm,
    x,
    y,
    wx: x,
    wy: y,
    state: 'patrol', // patrol | closing | shadow | leaving | gone | sunk
    submergedUntil: 0,
    target: null,
    torpedoes: def.torpedoes ?? 3,
    torpedoesFull: def.torpedoes ?? 3,
    goneAt: null,
    lastAttack: -Infinity,
    lastReport: -Infinity,
    known: Boolean(def.known),
  };
}

function hourOf(world) {
  return new Date(world.startMs + world.t * 1000).getUTCHours();
}

export function isNight(world) {
  const U = world.rules.uboats;
  const h = hourOf(world);
  const day = world.scenario.daylightH;
  // A winter scenario: night from the end of the day until an hour before dawn.
  if (day) return h >= day[1] || h < day[0] - 1;
  return h >= U.nightFromH || h < U.nightToH;
}

function moveTo(u, tx, ty, speedKmS, dt) {
  const d = distance(u.x, u.y, tx, ty);
  const step = speedKmS * dt;
  if (d <= step) {
    u.x = tx;
    u.y = ty;
    return true;
  }
  u.x += ((tx - u.x) / d) * step;
  u.y += ((ty - u.y) / d) * step;
  return false;
}

/** A radio message from a U-boat gives a direction-finding fix, with an error. */
function dfFix(world, u) {
  const U = world.rules.uboats;
  const x = u.x + world.rng.gauss() * U.dfErrorKm;
  const y = u.y + world.rng.gauss() * U.dfErrorKm;
  world.dfZones.push({ x, y, r: U.dfRadiusKm, t: world.t });
  const [lon, lat] = unproject(x, y);
  emit(world, 'dfFix', { lat, lon, x, y });
}

function attack(world, u, c) {
  const U = world.rules.uboats;
  const A = world.rules.asw;
  const rng = world.rng;
  const escorts = escortStrength(world, c);
  u.lastAttack = world.t;
  u.torpedoes--;
  const pHit = (U.pHit / (1 + escorts * U.escortFactor)) * (c.zigzag ? A.zigzagHit : 1);
  const n = rng.next() < pHit ? 1 + (rng.next() < U.secondShipP ? 1 : 0) : 0;
  emit(world, 'uboatAttack', { convoy: c.name, convoyId: c.id, sunk: n, escorts, x: c.x, y: c.y });
  if (n) sinkShips(world, c, n, 'uboat');
  if (escorts > 0) {
    // The escort counter-attacks well only a U-boat it has seen.
    const k = spotAttacker(world, u, c) ? 1 : A.unseenFactor;
    if (rng.next() < U.pKillPerEscort * escorts * k) {
      u.state = 'sunk';
      world.stats.uboatsSunk++;
      emit(world, 'uboatSunk', { convoy: c.name, convoyId: c.id, x: u.x, y: u.y });
      return;
    }
    if (rng.next() < U.pDriveOffPerEscort * escorts * k) {
      u.state = 'leaving';
      dive(world, u, A.diveHours);
      emit(world, 'uboatDrivenOff', { convoy: c.name, convoyId: c.id });
      return;
    }
  }
  if (u.torpedoes <= 0) u.state = 'leaving';
}

export function updateUboat(world, u, dt) {
  const U = world.rules.uboats;
  const A = world.rules.asw;
  if (u.state === 'sunk') return;
  if (u.state === 'gone') {
    if (world.scenario.uboatRotation && world.t % 60 === 0) returnFromBase(world, u);
    return;
  }
  // Under water a U-boat crawls: it cannot keep up with a convoy.
  const down = isSubmerged(world, u);
  const slowV = (A.submergedKn * KNOT_KMH) / 3600;
  const patrolV = down ? slowV : (U.patrolKn * KNOT_KMH) / 3600;
  const shadowV = down ? slowV : (U.shadowKn * KNOT_KMH) / 3600;
  if (u.state === 'leaving') {
    // Back to the bases in France, out of the game.
    moveTo(u, u.x - 1, u.y - 2, shadowV, dt);
    if (distance(u.x, u.y, u.hx, u.hy) > 400) {
      u.state = 'gone';
      u.goneAt = world.t;
    }
    return;
  }
  if (u.state === 'patrol') {
    if (moveTo(u, u.wx, u.wy, patrolV, dt)) {
      const a = world.rng.next() * Math.PI * 2;
      const r = Math.sqrt(world.rng.next()) * u.radius;
      u.wx = u.hx + Math.cos(a) * r;
      u.wy = u.hy + Math.sin(a) * r;
    }
    if (world.t % 60 !== 0) return;
    const sight = down ? (isNight(world) ? 0 : A.periscopeSightKm) : isNight(world) ? U.sightKmNight : U.sightKmDay;
    for (const c of world.convoys) {
      if (c.state !== 'atSea' || c.type === 'coastal') continue;
      if (distance(u.x, u.y, c.x, c.y) > sight) continue;
      u.state = 'shadow';
      u.target = c.id;
      u.lastReport = world.t;
      emit(world, 'convoySighted', { convoy: c.name, convoyId: c.id });
      dfFix(world, u);
      // The U-boat command sends the nearest boats toward the reported convoy, a few at most
      // (the others keep their patrol line for the next one).
      let pack = world.uboats.filter((o) => o.target === c.id && (o.state === 'shadow' || o.state === 'closing')).length;
      const near = world.uboats
        .filter((o) => o !== u && o.state === 'patrol' && distance(o.x, o.y, c.x, c.y) <= U.callKm)
        .sort((a, b) => distance(a.x, a.y, c.x, c.y) - distance(b.x, b.y, c.x, c.y));
      for (const other of near) {
        if (pack >= (U.maxPack ?? Infinity)) break;
        other.state = 'closing';
        other.target = c.id;
        pack++;
      }
      return;
    }
    return;
  }
  // Shadowing: keep astern of the convoy, report it, attack at night.
  const c = world.convoys.find((x) => x.id === u.target);
  if (!c || c.state !== 'atSea') {
    u.state = 'patrol';
    u.target = null;
    return;
  }
  if (u.state === 'closing') {
    // Called by the U-boat command: run toward the last reported position.
    moveTo(u, c.x, c.y, shadowV, dt);
    if (world.t % 60 === 0) {
      const d = distance(u.x, u.y, c.x, c.y);
      if (!down && d <= (isNight(world) ? U.sightKmNight : U.sightKmDay)) u.state = 'shadow';
      else if (d > U.callKm * 1.5) {
        u.state = 'patrol';
        u.target = null;
      }
    }
    return;
  }
  const [hx, hy] = headingVector(c.heading);
  const tx = c.x - hx * U.shadowDistanceKm;
  const ty = c.y - hy * U.shadowDistanceKm;
  moveTo(u, tx, ty, shadowV, dt);
  if (world.t % 60 !== 0) return;
  const d = distance(u.x, u.y, c.x, c.y);
  if (d > U.lostKm) {
    u.state = 'patrol';
    u.target = null;
    return;
  }
  if (down) return; // no report and no attack from under water
  if (world.t - u.lastReport >= U.reportEveryH * 3600) {
    u.lastReport = world.t;
    dfFix(world, u);
  }
  if (isNight(world) && d < U.shadowDistanceKm + 8 && world.t - u.lastAttack >= U.attackGapH * 3600) attack(world, u, c);
}

/**
 * A long scenario: a U-boat that went home for torpedoes and a refit sails again from
 * the Biscay bases and makes for its patrol area.
 */
function returnFromBase(world, u) {
  const U = world.rules.uboats;
  if (u.goneAt === null || world.t - u.goneAt < U.refitDays * 86400) return;
  const [x, y] = project(U.reentry.lon, U.reentry.lat);
  u.x = x;
  u.y = y;
  u.wx = u.hx;
  u.wy = u.hy;
  u.state = 'patrol';
  u.target = null;
  u.torpedoes = u.torpedoesFull;
  u.goneAt = null;
  u.submergedUntil = 0;
}

/** Old direction-finding fixes fade away; new orders acknowledged by radio give fresh ones. */
export function ageDfZones(world) {
  const life = world.rules.uboats.dfLifetimeH * 3600;
  world.dfZones = world.dfZones.filter((z) => world.t - z.t < life);
  while (world.dfPending.length) {
    const u = world.uboats.find((x) => x.id === world.dfPending.shift());
    if (u && u.state !== 'sunk' && u.state !== 'gone') dfFix(world, u);
  }
}

/** Fixes known at the start of the scenario, from the days before. */
export function initialIntelligence(world) {
  const U = world.rules.uboats;
  for (const u of world.uboats) {
    if (!u.known) continue;
    const x = u.x + world.rng.gauss() * U.dfErrorKm;
    const y = u.y + world.rng.gauss() * U.dfErrorKm;
    world.dfZones.push({ x, y, r: U.dfRadiusKm, t: world.t - 6 * 3600 });
  }
}
