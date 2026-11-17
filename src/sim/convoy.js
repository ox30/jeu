// Ships: merchant convoys and escort groups. They follow a route (drawn by the player, or
// the Admiralty's) or a list of legs steered by heading, at the speed of their slowest ship.
// Near the entrance of a charted channel a pilot comes aboard and takes them into port.
// Convoys carry the cargo that feeds the defence: fuel in the tankers, matériel in the
// freighters.

import { KNOT_KMH, distance, headingOf, headingVector, polylineLength, project } from './geo.js';
import { emit } from './events.js';
import { followPlan } from './navigation.js';

export function createConvoy(world, def) {
  const port = def.from ? world.byId.port.get(def.from) : null;
  const [x, y] = port ? [port.x, port.y] : project(def.at.lon, def.at.lat);
  const tankers = def.tankers ?? 0;
  const freighters = def.freighters ?? (def.tankers === undefined ? def.ships : 0);
  const ships = def.tankers === undefined && def.freighters === undefined ? def.ships : tankers + freighters;
  const cargo = {
    fuel: tankers * (def.fuelPerTanker ?? 0),
    materiel: freighters * (def.materielPerFreighter ?? 0),
    ammo: def.ammo ?? 0,
  };
  return {
    kind: 'convoy',
    id: def.id,
    name: def.name,
    type: def.type || 'ocean', // ocean | coastal
    ships,
    shipsStart: ships,
    tankers,
    freighters,
    fuelPerTanker: def.fuelPerTanker ?? 0,
    materielPerFreighter: def.materielPerFreighter ?? 0,
    cargo,
    cargoStart: { ...cargo },
    delivered: { fuel: 0, materiel: 0, ammo: 0 },
    speedKn: def.speedKn,
    legKn: null, // speed ordered on the current leg, when slower than the convoy's best
    speed: (def.speedKn * KNOT_KMH) / 3600, // km/s at full speed
    x,
    y,
    px: x,
    py: y,
    heading: def.heading ?? 90,
    course: def.heading ?? 90,
    route: [],
    routeLocked: 0, // last points of the route that the player cannot move (channel, port)
    plan: [],
    legState: null,
    // inPort (also: at anchor, waiting for the order to sail) | atSea | waiting | arrived | lost
    state: port || def.anchored ? 'inPort' : 'atSea',
    anchored: Boolean(def.anchored),
    destination: null,
    portId: port ? port.id : null,
    arrivedAt: null,
    unloading: false,
    admiraltyRoute: (def.admiraltyRoute || []).map(([lon, lat]) => project(lon, lat)),
    // Speed ordered (null: the best the slowest ship can do). Ocean convoys keep a margin
    // below their best so that no ship falls behind; the player may push them.
    orderedKn: def.orderedKn !== undefined ? def.orderedKn : (def.type || 'ocean') === 'ocean' && !def.straggler ? safeKnots(def.speedKn, world.rules.asw?.stragglerFrom) : null,
    zigzag: false, // zigzagging: harder to torpedo, slower to advance
    straggler: false,
    parentId: null,
    children: [], // stragglers that fell behind
  };
}

/** The fastest whole number of knots that keeps a convoy together (below `from` of its best). */
export function safeKnots(best, from = 0.9) {
  return Math.max(1, Math.ceil(best * from) - 1);
}

/** Speed made good, knots: a zigzag costs part of the speed. */
function madeGood(u, kn) {
  return u.zigzag ? kn * (u.zigzagFactor || 0.85) : kn;
}

/** Knots ordered without a leg speed: the convoy's speed order, or its best. */
function standingKn(u) {
  return u.orderedKn ? Math.min(u.orderedKn, u.speedKn) : u.speedKn;
}

/** Speed in km/s on a leg (a leg can be slower than the ship, never faster). */
export function legSpeed(u, leg) {
  const kn = leg && leg.speedKn ? Math.min(leg.speedKn, u.speedKn) : standingKn(u);
  return (madeGood(u, kn) * KNOT_KMH) / 3600;
}

/** Speed in km/s along a route. */
export function routeSpeed(u) {
  return (madeGood(u, standingKn(u)) * KNOT_KMH) / 3600;
}

export function currentSpeed(u) {
  if (u.route.length) return routeSpeed(u);
  return legSpeed(u, u.plan[0]);
}

/** Knots the convoy is ordered to make through the water (before any zigzag). */
export function orderedKnots(u) {
  const leg = u.route.length ? null : u.plan[0];
  return leg && leg.speedKn ? Math.min(leg.speedKn, u.speedKn) : standingKn(u);
}

/** Ports that can take this ship: coastal convoys go to Channel ports, the rest to the convoy ports. */
export function acceptingPorts(world, u) {
  return world.ports.filter((p) => (u.type === 'coastal' ? p.coastal : p.convoys));
}

/** Share (0 to 1) of the convoy's cargo still afloat or delivered, its stragglers included. */
export function cargoShare(c, world = null) {
  const start = c.cargoStart.fuel + c.cargoStart.materiel;
  if (!start) return c.shipsStart ? c.ships / c.shipsStart : 1;
  let kept = c.cargo.fuel + c.cargo.materiel + c.delivered.fuel + c.delivered.materiel;
  if (world) {
    for (const id of c.children || []) {
      const s = world.convoys.find((x) => x.id === id);
      if (s) kept += s.cargo.fuel + s.cargo.materiel + s.delivered.fuel + s.delivered.materiel;
    }
  }
  return kept / start;
}

function arrive(world, c, port) {
  c.state = 'arrived';
  c.portId = port.id;
  c.arrivedAt = world.t;
  c.destination = null;
  c.plan = [];
  c.legState = null;
  c.unloading = c.cargo.fuel + c.cargo.materiel > 0;
  world.stats.convoysArrived++;
  emit(world, 'convoyArrived', {
    convoy: c.name,
    convoyId: c.id,
    port: port.name,
    portId: port.id,
    ships: c.ships,
    fuel: Math.round(c.cargo.fuel),
    materiel: Math.round(c.cargo.materiel),
  });
}

function followRoute(world, u, dt, onArrive) {
  let remaining = routeSpeed(u) * dt;
  while (remaining > 0 && u.route.length) {
    const [wx, wy] = u.route[0];
    const dx = wx - u.x;
    const dy = wy - u.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-9) u.heading = headingOf(dx, dy);
    if (d <= remaining) {
      u.x = wx;
      u.y = wy;
      remaining -= d;
      u.route.shift();
      if (u.routeLocked > u.route.length) u.routeLocked = u.route.length;
    } else {
      u.x += (dx / d) * remaining;
      u.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
  if (u.route.length) return;
  u.course = u.heading;
  if (u.destination) {
    onArrive(world.byId.port.get(u.destination));
  } else if (u.kind === 'escort' && (u.joinTarget || u.plan.length)) {
    // An escort group leaving port by its channel goes on to its meeting or its legs.
  } else {
    u.state = 'waiting';
    emit(world, 'convoyWaiting', { convoy: u.name, convoyId: u.id, unitKind: u.kind });
  }
}

/** A pilot boards near the entrance of a charted channel and takes the ship in. */
function checkPilot(world, u) {
  // Escort groups are only piloted in when they are on their way home.
  if (u.kind === 'escort' && !u.homeward) return false;
  const N = world.rules.navigation;
  for (const port of acceptingPorts(world, u)) {
    for (const approach of port.approaches || []) {
      const [gx, gy] = approach.points[0];
      if (distance(u.x, u.y, gx, gy) > N.pilotKm) continue;
      u.route = approach.points.map(([x, y]) => [x, y]);
      u.routeLocked = u.route.length;
      u.plan = [];
      u.legState = null;
      u.destination = port.id;
      emit(world, 'pilotAboard', { convoy: u.name, convoyId: u.id, port: port.name, channel: approach.name, unitKind: u.kind });
      return true;
    }
  }
  return false;
}

/** Stops the ship when the coast is right ahead (a leg that runs aground). */
function checkCoast(world, u) {
  const N = world.rules.navigation;
  const [dx, dy] = headingVector(u.heading);
  const ax = u.x + dx * N.coastLookaheadKm;
  const ay = u.y + dy * N.coastLookaheadKm;
  if (!world.terrain.isLand(ax, ay)) return false;
  const nearPort = world.ports.some((p) => distance(u.x, u.y, p.x, p.y) < N.harbourKm);
  if (nearPort) return false;
  u.state = 'waiting';
  u.plan = [];
  u.legState = null;
  emit(world, 'convoyStopped', { convoy: u.name, convoyId: u.id, x: ax, y: ay, unitKind: u.kind });
  return true;
}

/**
 * One step of a ship at sea: route, legs or course. `onArrive(port)` is called when a
 * route ends in a port.
 */
export function stepShip(world, u, dt, onArrive) {
  if (u.route.length) {
    followRoute(world, u, dt, onArrive);
    return;
  }
  const h = followPlan(world, u, 'sea');
  if (h !== null) u.course = h;
  u.legKn = u.plan[0] && u.plan[0].speedKn ? Math.min(u.plan[0].speedKn, u.speedKn) : null;
  u.heading = u.course;
  const v = legSpeed(u, u.plan[0]);
  const [dx, dy] = headingVector(u.heading);
  u.x += dx * v * dt;
  u.y += dy * v * dt;
  if (world.t % world.rules.navigation.checkEveryS === 0) {
    if (checkPilot(world, u)) return;
    checkCoast(world, u);
  }
}

export function updateConvoy(world, c, dt) {
  c.px = c.x;
  c.py = c.y;
  if (c.state !== 'atSea') return;
  stepShip(world, c, dt, (port) => arrive(world, c, port));
  if (world.t % 60 === 0) checkStragglers(world, c);
}

/**
 * A convoy driven near the best speed of its slowest ships loses some: a ship falls behind,
 * alone, an easy prey. Below that speed the convoy keeps together.
 */
function checkStragglers(world, c) {
  const A = world.rules.asw;
  if (c.type === 'coastal' || c.straggler || c.ships < 4) return;
  if ((c.children || []).length >= A.stragglerMax) return;
  if (orderedKnots(c) < A.stragglerFrom * c.speedKn) return;
  const p = (A.stragglerPerHour * (c.ships / 30)) / 60;
  if (world.rng.next() >= p) return;
  const tanker = c.tankers > 0 && world.rng.next() < c.tankers / c.ships;
  const n = (c.children || []).length + 1;
  c.ships--;
  if (tanker) c.tankers--;
  else c.freighters = Math.max(0, c.freighters - 1);
  const cargo = { fuel: 0, materiel: 0, ammo: 0 };
  if (tanker) {
    cargo.fuel = Math.min(c.cargo.fuel, c.fuelPerTanker);
    c.cargo.fuel -= cargo.fuel;
  } else {
    cargo.materiel = Math.min(c.cargo.materiel, c.materielPerFreighter);
    c.cargo.materiel -= cargo.materiel;
  }
  // The parent's starting cargo no longer counts this ship: the straggler carries it.
  c.cargoStart.fuel -= cargo.fuel;
  c.cargoStart.materiel -= cargo.materiel;
  c.shipsStart--;
  const [dx, dy] = headingVector(c.heading);
  const s = {
    kind: 'convoy',
    id: `${c.id}-s${n}`,
    name: `${c.name}·${n}`,
    strayIndex: n,
    type: 'ocean',
    ships: 1,
    shipsStart: 1,
    tankers: tanker ? 1 : 0,
    freighters: tanker ? 0 : 1,
    fuelPerTanker: c.fuelPerTanker,
    materielPerFreighter: c.materielPerFreighter,
    cargo,
    cargoStart: { ...cargo },
    delivered: { fuel: 0, materiel: 0, ammo: 0 },
    speedKn: Math.min(c.speedKn, A.stragglerKn),
    legKn: null,
    speed: (Math.min(c.speedKn, A.stragglerKn) * KNOT_KMH) / 3600,
    x: c.x - dx * 6,
    y: c.y - dy * 6,
    px: c.x - dx * 6,
    py: c.y - dy * 6,
    heading: c.heading,
    course: c.course,
    route: c.route.map(([x, y]) => [x, y]),
    routeLocked: c.routeLocked,
    plan: c.plan.map((leg) => ({ ...leg, end: leg.end ? { ...leg.end } : null })),
    legState: null,
    state: 'atSea',
    anchored: false,
    destination: c.destination,
    portId: null,
    arrivedAt: null,
    unloading: false,
    admiraltyRoute: [],
    orderedKn: null,
    zigzag: false,
    straggler: true,
    parentId: c.id,
    children: [],
  };
  c.children = [...(c.children || []), s.id];
  world.convoys.push(s);
  emit(world, 'straggler', { convoy: c.name, convoyId: c.id, stragglerId: s.id, n, tanker, x: s.x, y: s.y });
}

/** Remaining distance (km) of the convoy's route, or null when it steers by heading. */
export function convoyRemainingKm(c) {
  if (!c.route.length) return null;
  return polylineLength([[c.x, c.y], ...c.route]);
}

/** Closest point of segment a-b to point p: { x, y, d }. */
function closestOnSegment(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + dx * k;
  const y = ay + dy * k;
  return { x, y, d: distance(x, y, px, py) };
}

/**
 * British ports are entered through charted channels (north of Ireland, St George's
 * Channel). When the drawn route passes close to the entrance of a channel and ends near
 * the port, the end of the route is replaced by the channel: the player draws the ocean
 * crossing, the Admiralty pilots the coastal waters.
 */
function applyApproach(world, c, full) {
  const rules = world.rules.convoy;
  const end = full[full.length - 1];
  let best = null;
  for (const port of acceptingPorts(world, c)) {
    if (!port.approaches) continue;
    const toEnd = distance(end[0], end[1], port.x, port.y);
    if (toEnd > rules.approachEndKm) continue;
    for (const approach of port.approaches) {
      // The segment of the route that passes closest to the entrance of the channel.
      const [gx, gy] = approach.points[0];
      let nearest = null;
      for (let i = 1; i < full.length; i++) {
        const near = closestOnSegment(full[i - 1][0], full[i - 1][1], full[i][0], full[i][1], gx, gy);
        if (near.d <= rules.gateRadiusKm && (!nearest || near.d < nearest.near.d)) nearest = { near, i };
      }
      if (!nearest) continue;
      const score = toEnd * 10 + nearest.near.d;
      if (!best || score < best.score) best = { score, port, approach, index: nearest.i, cut: [nearest.near.x, nearest.near.y] };
    }
  }
  if (!best) return null;
  const route = [...full.slice(1, best.index), best.cut, ...best.approach.points];
  return { route, port: best.port, locked: best.approach.points.length };
}

/**
 * Gives a new route to a ship. `points` are world points after its position.
 * A route ending close to a British port is extended into the port.
 * Returns { ok, reason, at, destination }.
 */
export function routeConvoy(world, c, points) {
  if (c.state === 'arrived' || c.state === 'lost' || c.state === 'escorting' || c.state === 'refit') return { ok: false, reason: 'arrived' };
  let pts = points.map(([x, y]) => [x, y]);
  if (!pts.length) return { ok: false, reason: 'empty' };

  const rules = world.rules.convoy;
  let destination = null;
  let locked = 0;
  const approach = applyApproach(world, c, [[c.x, c.y], ...pts]);
  if (approach) {
    pts = approach.route;
    destination = approach.port;
    locked = approach.locked;
  } else {
    const last = pts[pts.length - 1];
    let best = rules.portSnapKm;
    for (const p of acceptingPorts(world, c)) {
      const d = distance(last[0], last[1], p.x, p.y);
      if (d <= best) {
        best = d;
        destination = p;
      }
    }
    if (destination) {
      if (best < 0.5) pts[pts.length - 1] = [destination.x, destination.y];
      else pts.push([destination.x, destination.y]);
      locked = 1;
    }
  }

  const full = [[c.x, c.y], ...pts];
  const skipStart = c.state === 'inPort' && !c.anchored ? rules.harbourMarginKm : 0;
  const skipEnd = destination ? rules.harbourMarginKm : 0;
  const land = world.terrain.findLandOnRoute(full, skipStart, skipEnd);
  if (land) {
    emit(world, 'convoyRouteRejected', { convoy: c.name, convoyId: c.id, x: land[0], y: land[1], unitKind: c.kind });
    return { ok: false, reason: 'land', at: land };
  }

  c.route = pts;
  c.routeLocked = locked;
  if (c.kind === 'escort') c.homeward = Boolean(destination);
  c.plan = [];
  c.legState = null;
  c.state = 'atSea';
  c.destination = destination ? destination.id : null;
  if (c.kind === 'escort') c.joinTarget = null;
  const etaMs = world.startMs + (world.t + polylineLength(full) / routeSpeed(c)) * 1000;
  emit(world, 'convoyRouted', {
    convoy: c.name,
    convoyId: c.id,
    destination: destination ? destination.name : null,
    etaMs,
    unitKind: c.kind,
  });
  return { ok: true, destination };
}

/** Points of a ship's route that the player can move: all but the channel into port. */
export function editablePoints(c) {
  const locked = Math.min(c.routeLocked || 0, c.route.length);
  return c.route.slice(0, c.route.length - locked);
}

/**
 * The player moved, added or removed points of a ship's route. A route that goes into port
 * keeps its channel; one that ends at sea is routed again (and may now reach a port).
 */
export function editShipRoute(world, c, points) {
  if (c.state !== 'atSea' && c.state !== 'inPort' && c.state !== 'waiting') return { ok: false, reason: 'arrived' };
  const locked = Math.min(c.routeLocked || 0, c.route.length);
  if (!c.destination || !locked) return routeConvoy(world, c, points);
  const tail = c.route.slice(c.route.length - locked);
  const route = [...points.map(([x, y]) => [x, y]), ...tail];
  const rules = world.rules.convoy;
  const full = [[c.x, c.y], ...route];
  const skipStart = c.state === 'inPort' && !c.anchored ? rules.harbourMarginKm : 0;
  const land = world.terrain.findLandOnRoute(full, skipStart, rules.harbourMarginKm);
  if (land) {
    emit(world, 'convoyRouteRejected', { convoy: c.name, convoyId: c.id, x: land[0], y: land[1], unitKind: c.kind });
    return { ok: false, reason: 'land', at: land };
  }
  c.route = route;
  c.routeLocked = locked;
  return { ok: true, destination: world.byId.port.get(c.destination) };
}
