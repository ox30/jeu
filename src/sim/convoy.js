// Ships: merchant convoys and escort groups. They follow a route (drawn by the player, or
// the Admiralty's) or a list of legs steered by heading, at the speed of their slowest ship.
// Near the entrance of a charted channel a pilot comes aboard and takes them into port.
// Convoys carry the cargo that feeds the defence: fuel in the tankers, matériel in the
// freighters.

import { KNOT_KMH, distance, headingOf, headingVector, polylineLength, project, stepAlong } from './geo.js';
import { emit } from './events.js';
import { completeEntity } from './entities.js';
import { followPlan } from './navigation.js';
import { clearAtSea, seaPath } from './searoute.js';

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
  return completeEntity('convoy', {
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
  }, world);
}

/** The fastest whole number of knots that keeps a convoy together (below `from` of its best). */
export function safeKnots(best, from = 0.9) {
  return Math.max(1, Math.ceil(best * from) - 1);
}

/** Speed made good, knots: a zigzag costs part of the speed. */
function madeGood(u, kn) {
  return u.zigzag ? kn * (u.zigzagFactor || 0.85) : kn;
}

/**
 * Knots ordered without a leg speed: the convoy's speed order, or its best (an escort's boost
 * above it). A group out of fuel crawls (dryKn).
 */
function standingKn(u) {
  const kn = u.boost && u.boostKn ? u.boostKn : u.orderedKn ? Math.min(u.orderedKn, u.speedKn) : u.speedKn;
  return u.dryKn ? Math.min(kn, u.dryKn) : kn;
}

/**
 * The speed a ship's « 100 % » stands for: a convoy's speed that keeps it together, a group's
 * sea speed. Its boost: a convoy's best (ships fall behind), a group's sprint (it burns its
 * endurance faster).
 */
export function fullKnots(world, u) {
  return u.kind === 'escort' || u.type !== 'ocean' || u.straggler ? u.speedKn : safeKnots(u.speedKn, world.rules.asw.stragglerFrom);
}

/** Throttle of a ship: { pct, boost } as the panel shows it. */
export function shipThrottle(world, u) {
  const full = fullKnots(world, u);
  if (u.kind === 'escort' ? u.boost : u.orderedKn === null ? u.speedKn > full : u.orderedKn > full) return { pct: 100, boost: true };
  const kn = u.orderedKn ? Math.min(u.orderedKn, u.speedKn) : u.speedKn;
  return { pct: Math.round(Math.min(100, (kn / full) * 100) / 5) * 5, boost: false };
}

/** Speed in km/s on a leg (a leg can be slower than the ship, never faster). */
export function legSpeed(u, leg) {
  let kn = leg && leg.speedKn ? Math.min(leg.speedKn, u.speedKn) : standingKn(u);
  if (u.dryKn) kn = Math.min(kn, u.dryKn);
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
    const d = distance(u.x, u.y, wx, wy); // real km (the globe)
    if (d > 1e-9) u.heading = headingOf(dx, dy);
    if (d <= remaining) {
      u.x = wx;
      u.y = wy;
      remaining -= d;
      u.route.shift();
      if (u.routeHead > 0) u.routeHead--; // one point less of its charted way out of port
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
  } else if (u.kind === 'escort' && u.endAction && u.endAction.kind !== 'stop') {
    u.routeEnded = true; // naval.js does what it was told to do there
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
      if (u.kind === 'escort') u.routeHead = 0;
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
  const [dx, dy] = stepAlong(u.heading, v * dt, u.y);
  u.x += dx;
  u.y += dy;
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
  // A straggler is a convoy of one ship: it gets every field a convoy has.
  const s = completeEntity('convoy', {
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
  }, world);
  c.children = [...(c.children || []), s.id];
  world.convoys.push(s);
  emit(world, 'straggler', { convoy: c.name, convoyId: c.id, stragglerId: s.id, n, tanker, x: s.x, y: s.y });
}

/** Remaining distance (km) of the convoy's route, or null when it steers by heading. */
export function convoyRemainingKm(c, from = null) {
  if (!c.route.length) return null;
  // (`from`: the place the table gives the convoy, when it is only an estimate.)
  return polylineLength([from ? [from.x, from.y] : [c.x, c.y], ...c.route]);
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
/**
 * The roads of a port: the first point of its channel out at sea, just off the harbour (the
 * one nearest (x, y) when the channels part there). Null for a port without channel.
 */
export function harbourExit(world, portId, x = null, y = null) {
  const port = world.byId.port.get(portId);
  let best = null;
  for (const a of (port && port.approaches) || []) {
    if (a.points.length < 2) continue;
    const p = a.points[a.points.length - 2];
    const d = x === null ? 0 : distance(p[0], p[1], x, y);
    if (!best || d < best.d) best = { p, d };
  }
  return best ? [best.p[0], best.p[1]] : null;
}

/**
 * Down a port's charted channels toward (x, y): from the berth (or from the channel point
 * nearest to `from`, a group already in the harbour), outward, until the open water reaches
 * (x, y) in a straight line. Returns the points to follow (the best channel), or [].
 */
export function channelOut(world, port, x, y, from = null) {
  let best = null;
  for (const a of (port && port.approaches) || []) {
    const out = a.points.slice(0, -1).reverse();
    if (!out.length) continue;
    let i0 = 0;
    if (from) {
      let near = Infinity;
      out.forEach(([px, py], i) => {
        const d = distance(px, py, from[0], from[1]);
        if (d < near) {
          near = d;
          i0 = i;
        }
      });
    }
    const path = [];
    let km = 0;
    let prev = from || [port.x, port.y];
    for (let i = i0; i < out.length; i++) {
      path.push([out[i][0], out[i][1]]);
      km += distance(prev[0], prev[1], out[i][0], out[i][1]);
      prev = out[i];
      if (clearAtSea(world, out[i], [x, y], 0.5)) break;
    }
    const score = km + distance(prev[0], prev[1], x, y);
    if (!best || score < best.score) best = { path, score };
  }
  return best ? best.path : [];
}

/** The port whose harbour (charted channels) a ship at sea is in, or null. */
export function harbourOf(world, u) {
  const R = world.rules.navigation;
  let best = null;
  for (const p of world.ports) {
    if (p.foreign || !p.approaches) continue;
    const d = distance(u.x, u.y, p.x, p.y);
    if (d <= R.harbourKm && (!best || d < best.d)) best = { p, d };
  }
  return best ? best.p : null;
}

/**
 * How an escort group in port goes out (route points from the harbour): to the roads, close
 * to the port; or, when the player chose a channel (e.exitChannel, « Nord de l'Irlande »), down
 * that channel to its far end; or, toward a line drawn from port starting at (x, y), down the
 * channels until the open sea reaches it. The roads asked for as an exit step (e.exitPlanned
 * without a channel) are the roads, wherever the line drawn after them leads.
 */
export function harbourWayOut(world, e, x = null, y = null) {
  const port = world.byId.port.get(e.portId);
  if (!port) return [];
  const channel = e.exitChannel ? (port.approaches || []).find((a) => a.name === e.exitChannel) : null;
  if (channel) return channel.points.slice(0, -1).reverse().map(([px, py]) => [px, py]);
  if (!e.exitPlanned && x !== null && y !== null) {
    const out = channelOut(world, port, x, y);
    if (out.length) return out;
  }
  const roads = harbourExit(world, e.portId, x, y);
  return roads ? [roads] : [];
}

/** How many of the first points of a route follow a charted channel of a port, outward. */
export function chartedRun(world, route) {
  if (!route.length) return 0;
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  let best = 0;
  for (const port of world.byId.port.values()) {
    for (const a of port.approaches || []) {
      const out = a.points.slice(0, -1).reverse();
      const i = out.findIndex((p) => same(p, route[0]));
      if (i < 0) continue;
      let n = 0;
      while (i + n < out.length && n < route.length && same(out[i + n], route[n])) n++;
      best = Math.max(best, n);
    }
  }
  return best;
}

/**
 * A game saved before 2.10.3 counted a group's way out of port in `routeLocked`, with the
 * way into port and at the wrong end, and kept the channel chosen as a bare name. Both are
 * read again as what they now are: the head of the route (`routeHead`), and in port an exit
 * step. Nothing of a game of today matches (there a lock always has its port, a channel
 * chosen is always a step). Returns true when something was read again.
 */
export function adoptWayOut(world, e) {
  if (e.kind !== 'escort') return false;
  const oldStep = e.state === 'inPort' && Boolean(e.exitChannel) && !e.exitPlanned;
  const oldLock = (e.routeLocked || 0) > 0 && !e.destination && !(e.routeHead > 0) && e.route.length > 0;
  if (!oldStep && !oldLock) return false;
  if (oldStep && !e.route.length) return planExit(world, e, e.exitChannel).ok;
  const run = chartedRun(world, e.route);
  if (oldStep) {
    // (A route waiting in port that follows no channel: the name alone meant nothing.)
    e.exitPlanned = run > 0;
    if (!run) e.exitChannel = null;
    e.routeHead = run;
    e.routeLocked = e.destination ? Math.min(e.routeLocked || 0, e.route.length - run) : 0;
  } else {
    e.routeHead = Math.min(run, e.routeLocked);
    e.routeLocked = 0;
  }
  return true;
}

/** The exit step of a group in port: null (none), 'roads', or the name of a channel. */
export function plannedExit(e) {
  if (e.kind !== 'escort' || e.state !== 'inPort') return null;
  return e.exitChannel || (e.exitPlanned ? 'roads' : null);
}

/**
 * The way out of port as the first step of a group's orders, given in port: 'roads' (just
 * off the port), the name of a channel (down it to its far end), or null to take the step
 * away. The step is the head of the route that waits in port for the order to sail
 * (« Appareiller », or the hour of a scheduled sailing): `routeHead` points the player cannot
 * move. A line drawn after it is kept and joined by sea to the new way out; taking the
 * step away takes that line with it (it started at its end). Legs prepared stay as they are:
 * they start where the way out ends. Returns { ok, reason, kept, dropped }.
 */
export function planExit(world, e, choice) {
  if (e.kind !== 'escort' || e.state !== 'inPort') return { ok: false, reason: 'state' };
  const port = world.byId.port.get(e.portId);
  const channels = (port && port.approaches) || [];
  if (choice && choice !== 'roads' && !channels.some((a) => a.name === choice)) return { ok: false, reason: 'channel' };
  // What was drawn after the way out (its end in a port included: it is found again).
  const line = e.route.slice(Math.min(e.routeHead || 0, e.route.length)).map(([x, y]) => [x, y]);
  const bare = () => {
    e.routeHead = e.route.length;
    e.routeLocked = 0;
    e.destination = null;
    e.homeward = false;
  };
  if (!choice) {
    e.exitChannel = null;
    e.exitPlanned = false;
    e.route = [];
    bare();
    return { ok: true, kept: false, dropped: line.length > 0 };
  }
  e.exitChannel = choice === 'roads' ? null : choice;
  e.exitPlanned = true;
  if (line.length && !e.plan.length && routeConvoy(world, e, line).ok) return { ok: true, kept: true, dropped: false };
  e.route = harbourWayOut(world, e);
  bare();
  return { ok: true, kept: false, dropped: line.length > 0 && !e.plan.length };
}

function applyApproach(world, c, full) {
  const rules = world.rules.convoy;
  const end = full[full.length - 1];
  // An escort group goes where it is drawn: into port only by ending in its bubble.
  if (c.kind === 'escort') return null;
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
export function routeConvoy(world, c, points, { keepHead = false } = {}) {
  if (c.state === 'arrived' || c.state === 'lost' || c.state === 'refit') return { ok: false, reason: 'arrived' };
  if (c.dry) return { ok: false, reason: 'dry' }; // out of fuel: only « Rentrer au port »
  if (c.state === 'escorting' && c.kind !== 'escort') return { ok: false, reason: 'arrived' };
  let pts = points.map(([x, y]) => [x, y]);
  if (!pts.length) return { ok: false, reason: 'empty' };

  const rules = world.rules.convoy;
  let destination = null;
  let locked = 0;
  // An escort group drawn out of port goes out to the roads first, then by sea (round the
  // land if need be) to the start of the line drawn.
  let roads = null;
  if (c.kind === 'escort' && c.state === 'inPort') {
    const out = harbourWayOut(world, c, pts[0][0], pts[0][1]);
    if (out.length) roads = out;
  } else if (c.kind === 'escort' && keepHead && c.routeHead > 0 && c.route.length >= c.routeHead) {
    // Still on its charted way out of port, and only the line after it is changed: it keeps it.
    roads = c.route.slice(0, c.routeHead).map(([x, y]) => [x, y]);
  } else if (c.kind === 'escort' && !clearAtSea(world, [c.x, c.y], pts[0], 0.5)) {
    // A group still in a harbour (at the roads, say): out by the charted channel first.
    const port = harbourOf(world, c);
    const out = port ? channelOut(world, port, pts[0][0], pts[0][1], [c.x, c.y]) : [];
    if (out.length) roads = out;
  }
  if (roads) {
    const end = roads[roads.length - 1];
    const way = seaPath(world, end, pts[0]);
    pts = [...roads, ...(way ? way.slice(0, -1) : []), ...pts];
  }
  const approach = applyApproach(world, c, [[c.x, c.y], ...pts]);
  if (approach) {
    pts = approach.route;
    destination = approach.port;
    locked = approach.locked;
  } else {
    const last = pts[pts.length - 1];
    // Into port when the route ends in its bubble (like an aerodrome's for the aircraft).
    let best = world.rules.navigation.portBubbleKm;
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

  // From the roads on, the route must keep to the sea (the harbour channel is charted).
  const full = roads ? pts.slice(roads.length - 1) : [[c.x, c.y], ...pts];
  const skipStart = !roads && c.state === 'inPort' && !c.anchored ? rules.harbourMarginKm : 0;
  const skipEnd = destination ? rules.harbourMarginKm : 0;
  const land = world.terrain.findLandOnRoute(full, skipStart, skipEnd);
  if (land) {
    emit(world, 'convoyRouteRejected', { convoy: c.name, convoyId: c.id, x: land[0], y: land[1], unitKind: c.kind });
    return { ok: false, reason: 'land', at: land };
  }

  c.route = pts;
  c.routeVersion = (c.routeVersion || 0) + 1; // a new routing signal (the B-Dienst may read it)
  c.routeLocked = locked;
  if (c.kind === 'escort') {
    // The charted way out is the head of the route: its points are not the player's to move.
    // (Until 2.10.2 it was counted with the way into port, at the wrong end: a group that
    // left port on a line drawn could have neither a point moved nor its route lengthened.)
    c.routeHead = roads ? roads.length : 0;
    c.homeward = Boolean(destination);
    // A route drawn for a group with a convoy, or hunting, takes it away: it does not take
    // station again with that convoy by itself; and the hunt is over.
    if (c.state === 'escorting' || c.state === 'hunting') c.leftConvoy = c.escorting || c.huntFor;
    c.huntFor = null;
    c.huntUntil = null;
    c.huntPath = null;
    c.huntStay = false;
    c.engage = null;
    c.escorting = null;
  }
  c.plan = [];
  c.legState = null;
  // A sailing ordered for later, or an exit step given in port: the route waits there for
  // its hour, or for the order to sail (timetable.js, planExit above).
  if (!(c.state === 'inPort' && (c.schedule || c.exitPlanned))) c.state = 'atSea';
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

/** How a route is made: `head` points of the way out of port, the line, `locked` points into port. */
function routeParts(c) {
  const locked = Math.min(c.routeLocked || 0, c.route.length);
  const head = Math.min(c.routeHead || 0, c.route.length - locked);
  return { head, locked };
}

/**
 * Points of a ship's route that the player can move: all but the charted way out of port (the
 * first `routeHead` points of an escort group) and the channel into port (the last ones).
 */
export function editablePoints(c) {
  const { head, locked } = routeParts(c);
  return c.route.slice(head, c.route.length - locked);
}

/**
 * The player moved, added or removed points of a ship's route. A route that goes into port
 * keeps its channel; one that ends at sea is routed again (and may now reach a port).
 */
export function editShipRoute(world, c, points) {
  if (c.state !== 'atSea' && c.state !== 'inPort' && c.state !== 'waiting') return { ok: false, reason: 'arrived' };
  const { head, locked } = routeParts(c);
  if (!points.length && head) {
    // The line after the way out is taken away: the way out stays, and ends the route.
    c.route = c.route.slice(0, head);
    c.routeLocked = 0;
    c.destination = null;
    c.homeward = false;
    c.routeVersion = (c.routeVersion || 0) + 1;
    return { ok: true, destination: null };
  }
  if (!c.destination || !locked) return routeConvoy(world, c, points, { keepHead: true });
  const tail = c.route.slice(c.route.length - locked);
  const route = [...c.route.slice(0, head), ...points.map(([x, y]) => [x, y]), ...tail];
  const rules = world.rules.convoy;
  // From the end of the way out on (the harbour channel is charted), or from the ship.
  const full = head ? route.slice(head - 1) : [[c.x, c.y], ...route];
  const skipStart = !head && c.state === 'inPort' && !c.anchored ? rules.harbourMarginKm : 0;
  const land = world.terrain.findLandOnRoute(full, skipStart, rules.harbourMarginKm);
  if (land) {
    emit(world, 'convoyRouteRejected', { convoy: c.name, convoyId: c.id, x: land[0], y: land[1], unitKind: c.kind });
    return { ok: false, reason: 'land', at: land };
  }
  c.route = route;
  c.routeLocked = locked;
  // A new routing, like a route drawn afresh: what was asked or read about the old one
  // (a U-boat plot on the way, a signal the B-Dienst may read) no longer stands.
  c.routeVersion = (c.routeVersion || 0) + 1;
  return { ok: true, destination: world.byId.port.get(c.destination) };
}
