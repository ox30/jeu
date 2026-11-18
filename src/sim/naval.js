// The war at sea: U-boats that hunt the convoys at night, the escort groups that protect
// them, bombers against the coastal convoys, and the radio direction-finding fixes that
// betray a U-boat's position, roughly, when it reports a convoy.

import { KNOT_KMH, bearing, distance, headingVector, polylineLength, project, unproject } from './geo.js';
import { clearAtSea, fieldJoin, seaKmToPort, seaPath } from './searoute.js';
import { emit } from './events.js';
import { solveIntercept } from './intercept.js';
import { acceptingPorts, currentSpeed, stepShip } from './convoy.js';
import { canHunt, dive, endHunt, engage, isSubmerged, rearm, spotAttacker, startHunt, stepHunt, willCounter } from './asw.js';
import { callBoats, noteConvoy } from './bdu.js';
import { inClosedWaters, moveTo, openForUboat, steerUboat, uboatSpot } from './uboatnav.js';
import { completeEntity, declareFields } from './entities.js';
import { parseGameDate } from '../core/time.js';
import { isNight } from './daylight.js';

// Whether the player was told that the convoy came within reach of the escorts.
declareFields('convoy', (c) => {
  c.rangeAlerted = false;
});

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

// The first radar sets: a dated datum of the scenario, group by group (`radarFrom`), in place
// of a switch for the whole scenario. A game saved before gets it from the scenario too.
declareFields('escort', (e, world) => {
  const def = (world.scenario.escorts || []).find((d) => d.id === e.id);
  e.radar = Boolean(def && def.radar); // a set on board (rules.asw.radar)
  e.radarFrom = def && def.radarFrom ? (parseGameDate(def.radarFrom) - world.startMs) / 1000 : null; // fitted in port from then on
});

export function createEscortGroup(world, def) {
  const port = world.byId.port.get(def.from);
  return completeEntity('escort', {
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
    state: 'inPort', // inPort | atSea | waiting | escorting | hunting | refit
    berthed: true, // alongside: leaving takes escortGroups.sailDelayH to cast off
    portId: port.id,
    destination: null,
    joinTarget: null, // convoy the group is ordered to meet
    escorting: null, // convoy the group is with
    leftConvoy: null, // convoy it was ordered to leave: it does not take station again by itself
    schedule: null, // a sailing ordered for later (timetable.js)
    exitChannel: null, // how it goes out of port: null (the roads) or a channel's name
    boost: false, // sprinting above its sea speed (endurance burnt faster)
    boostKn: null,
    lateFor: null, // a support group it is catching up with (rally.js)
    enduranceMax: def.enduranceDays * 86400,
    endurance: def.enduranceDays * 86400,
    timer: 0,
    lowWarned: false,
    dry: false, // out of fuel: into port at a crawl (dryKn)
    dryKn: null,
    homeward: false,
    behaviour: def.behaviour || 'stay', // stay with the convoy, or hunt the contacts
    huntFor: null,
    huntPath: null, // a hunt's way around the land (searoute.js)
    huntGoal: null, // the point that way leads to
    huntStay: false, // a short counter-attack near its convoy, not a hunt
    engage: null, // the U-boat it is attacking: { uboatId, since, nextPass, reportId }
    endAction: { kind: 'stop' }, // at the end of its route: stop | hold | escort | hunt | port
    routeEnded: false,
    formation: null, // id of the support group (formation) it belongs to
    followEscort: null, // a support group's member: the leader it sails with
    followSlot: 0,
    waitForGroup: false, // a support group's leader slows down until its groups close up
  }, world);
}

/** Number of escort ships with a convoy (a group away hunting does not count). */
export function escortStrength(world, c) {
  let n = 0;
  for (const e of world.escorts) if (e.state === 'escorting' && e.escorting === c.id) n += e.ships;
  return n;
}

function enterPort(world, e, port) {
  e.state = 'refit';
  e.berthed = true;
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

/**
 * The way into a port from where the ship is: by sea to the nearest point of one of the
 * port's channels (not back to its entrance when the ship is already in it), then up the
 * channel; straight to the port when it has none. { route, locked, km } or null.
 */
export function homeRoute(world, u, port) {
  const from = [u.x, u.y];
  const options = [];
  // Where the shortest way joins a channel, from the port's field (around the land already).
  const best = fieldJoin(world, port, u.x, u.y);
  if (best) options.push({ join: best.join, tail: best.tail, km: best.km });
  for (const a of port.approaches || []) {
    const pts = a.points;
    let rest = polylineLength(pts);
    // Beyond the field (far out at sea): by a channel's entrance.
    if (!best) {
      options.push({ join: pts[0], tail: pts.slice(1), km: distance(u.x, u.y, pts[0][0], pts[0][1]) + rest });
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const seg = distance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      rest -= seg;
      const near = closestOnSegment(pts[i - 1], pts[i], from);
      options.push({ join: [near.x, near.y], tail: pts.slice(i), km: near.d + rest + distance(near.x, near.y, pts[i][0], pts[i][1]) });
    }
  }
  if (!options.length) options.push({ join: [port.x, port.y], tail: [], km: distance(u.x, u.y, port.x, port.y) });
  // The field's join first; then the nearest points of the channels, as the crow flies.
  options.sort((a, b) => (a === options[0] && best ? -1 : b === options[0] && best ? 1 : a.km - b.km));
  for (const o of options.slice(0, 4)) {
    const path = seaPath(world, from, o.join, o.tail.length ? 0 : world.rules.convoy.harbourMarginKm);
    if (!path) continue;
    const route = [...path, ...o.tail.map(([x, y]) => [x, y])];
    // Two points one on the other (joining at a channel's corner): one is enough.
    const clean = route.filter((p, i) => i === 0 || distance(p[0], p[1], route[i - 1][0], route[i - 1][1]) > 0.2);
    return { route: clean, locked: o.tail.length, km: polylineLength([from, ...clean]) };
  }
  return null;
}

function closestOnSegment(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const x = a[0] + dx * k;
  const y = a[1] + dy * k;
  return { x, y, d: distance(x, y, p[0], p[1]) };
}

/**
 * Ports the group can go back to, nearest by sea first: [{ port, km, hours }]. The distances
 * come from each port's field (worked out once): cheap enough for a sheet redrawn every
 * moment at high speed.
 */
export function portChoices(world, e) {
  const list = [];
  // At the speed ordered (a group out of fuel: its crawl).
  const kn = Math.min(e.speedKn, e.orderedKn || e.speedKn, e.dryKn || Infinity);
  for (const port of acceptingPorts(world, e)) {
    if (port.foreign) continue;
    const km = seaKmToPort(world, port, e.x, e.y);
    if (km === null) continue;
    list.push({ port, km, hours: km / KNOT_KMH / kn });
  }
  return list.sort((a, b) => a.km - b.km);
}

/** Sends the group into a port (the one given, or the nearest by sea), around the land. */
export function sendEscortHome(world, e, portId = null) {
  let port = portId ? world.byId.port.get(portId) : null;
  let way = port ? homeRoute(world, e, port) : null;
  if (!way) {
    const best = portChoices(world, e)[0];
    port = best ? best.port : null;
    way = port ? homeRoute(world, e, port) : null;
  }
  e.escorting = null;
  e.joinTarget = null;
  clearHunt(e);
  e.state = 'atSea';
  e.plan = [];
  e.legState = null;
  e.homeward = true;
  if (way) {
    e.route = way.route;
    e.routeLocked = way.locked;
    e.destination = port.id;
  }
}

/** The group stops hunting (it keeps its other orders). */
export function clearHunt(e) {
  e.huntFor = null;
  e.huntUntil = null;
  e.huntPath = null;
  e.engage = null;
}

/** In port: the refit runs its time, then the group is ready, bunkers and racks full. */
function stayInPort(world, e, dt) {
  e.berthed = true;
  // The dockyard fits its first radar set, from the date the scenario gives for this group.
  if (!e.radar && e.radarFrom !== null && world.t >= e.radarFrom) {
    e.radar = true;
    emit(world, 'escortRadar', { escort: e.name, escortId: e.id, port: world.byId.port.get(e.portId).name });
  }
  if (e.state !== 'refit') return;
  e.timer -= dt;
  if (e.timer > 0) return;
  e.state = 'inPort';
  e.endurance = e.enduranceMax;
  rearm(e); // depth charges come aboard with the fuel, at no extra delay
  e.lowWarned = false;
  e.dry = false;
  e.dryKn = null;
  emit(world, 'escortReady', { escort: e.name, escortId: e.id, port: world.byId.port.get(e.portId).name });
}

/**
 * Raising steam and casting off: a group that leaves its berth stays alongside a while
 * (rules: escortGroups.sailDelayH). Returns true while it is still alongside.
 */
function castingOff(world, e) {
  if (e.berthed) {
    e.berthed = false;
    const berth = world.byId.port.get(e.portId);
    const delay = world.rules.escortGroups.sailDelayH ?? 0;
    if (e.state !== 'escorting' && berth && distance(e.x, e.y, berth.x, berth.y) < 1) e.underwayAt = world.t + delay * 3600;
  }
  return Boolean(e.underwayAt && world.t < e.underwayAt);
}

/**
 * Fuel for the way home: the group turns back while it still can (the way into the nearest
 * port at its speed, and a day to spare), looked at every ten minutes. Returns true when it
 * has just turned for home.
 */
function turnsHomeForFuel(world, e) {
  if (e.lowWarned || e.dry || world.t % 600 !== 0 || e.endurance >= homeReserve(world, e)) return false;
  e.lowWarned = true;
  const left = e.state === 'escorting' ? world.convoys.find((c) => c.id === e.escorting) : null;
  emit(world, 'escortLowFuel', {
    escort: e.name, escortId: e.id, convoy: left ? left.name : null, convoyId: left ? left.id : null, x: e.x, y: e.y,
  });
  sendEscortHome(world, e);
  return true;
}

/** With its convoy: in station ahead of it; the convoy in port (or lost), the group goes in too. */
function keepStation(world, e) {
  const c = world.convoys.find((x) => x.id === e.escorting);
  if (!c || c.state !== 'atSea') {
    if (c && c.state === 'arrived') enterPort(world, e, world.byId.port.get(c.portId));
    else sendEscortHome(world, e);
    return;
  }
  const [dx, dy] = headingVector(c.heading);
  e.x = c.x + dx * 4;
  e.y = c.y + dy * 4;
  e.heading = c.heading;
  e.course = c.heading;
}

/** Ordered to meet a convoy: steer for the meeting point, round the land if it is in the way. */
function steerForConvoy(world, e) {
  const c = world.convoys.find((x) => x.id === e.joinTarget);
  if (!c || c.state !== 'atSea') {
    e.joinTarget = null;
    return;
  }
  const v = currentSpeed(c);
  const [hx, hy] = headingVector(c.heading);
  const sol = solveIntercept(e.x, e.y, e.speed, c.x, c.y, hx * v, hy * v);
  e.course = sol ? sol.heading : bearing(e.x, e.y, c.x, c.y);
  // Land ahead on the way (a headland, an island): round it by sea. Looked at every 5
  // minutes, over the next 60 km.
  const d = distance(e.x, e.y, c.x, c.y);
  const k = Math.min(1, 60 / Math.max(d, 1e-6));
  if (world.t % 300 === 0 && !clearAtSea(world, [e.x, e.y], [e.x + (c.x - e.x) * k, e.y + (c.y - e.y) * k])) {
    const path = seaPath(world, [e.x, e.y], [c.x, c.y]);
    if (path && path.length > 1) {
      e.route = path.slice(0, -1);
      e.routeLocked = 0;
    }
  }
}

/**
 * A support group's member sails in station astern of its leader (formations.js). Returns
 * true when it is in station (nothing more to do this step).
 */
function followLeader(world, e, dt) {
  const leader = world.escorts.find((x) => x.id === e.followEscort);
  if (!leader || leader.state !== 'atSea') return false;
  const [hx, hy] = headingVector(leader.heading);
  const tx = leader.x - hx * 2 * e.followSlot;
  const ty = leader.y - hy * 2 * e.followSlot;
  if (distance(e.x, e.y, tx, ty) < Math.max(0.5, e.speed * dt * 1.5)) {
    e.x = tx;
    e.y = ty;
    e.heading = leader.heading;
    e.course = leader.heading;
    return true;
  }
  e.course = bearing(e.x, e.y, tx, ty);
  return false;
}

/** Its legs are flown out: into the port whose bubble it is in, or what it was told to do then. */
function afterLegs(world, e) {
  const bubble = world.rules.navigation.portBubbleKm;
  const port = acceptingPorts(world, e).find((p) => distance(e.x, e.y, p.x, p.y) <= bubble);
  if (port) sendEscortHome(world, e, port.id);
  else if (!e.route.length && !e.joinTarget && !e.homeward) shipEndAction(world, e);
  // What it does now (a stop or a hunt says so itself).
  const c = e.joinTarget ? world.convoys.find((x) => x.id === e.joinTarget) : null;
  const into = e.homeward && e.destination ? world.byId.port.get(e.destination) : null;
  const action = c ? 'escort' : into ? 'port' : e.state === 'atSea' && !e.route.length ? 'hold' : null;
  if (action) {
    emit(world, 'legsEnded', {
      escort: e.name, escortId: e.id, action, convoy: c ? c.name : '', port: into ? into.name : '', heading: Math.round(e.course),
    });
  }
}

/** Meeting: within sight of an ocean convoy, the group takes station. */
function meetConvoys(world, e) {
  const R = world.rules.escortGroups;
  for (const c of world.convoys) {
    if (c.state !== 'atSea' || c.type === 'coastal') continue;
    if (e.joinTarget && e.joinTarget !== c.id) continue;
    if (!e.joinTarget && e.leftConvoy === c.id) {
      // Ordered away from this convoy: it rejoins only when ordered to, or once well clear.
      if (distance(e.x, e.y, c.x, c.y) > 3 * R.joinKm) e.leftConvoy = null;
      continue;
    }
    if (distance(e.x, e.y, c.x, c.y) <= R.joinKm) {
      join(world, e, c);
      return;
    }
  }
}

export function updateEscort(world, e, dt) {
  e.px = e.x;
  e.py = e.y;
  const R = world.rules.escortGroups;
  if (e.state === 'refit' || e.state === 'inPort') {
    stayInPort(world, e, dt);
    return;
  }
  if (castingOff(world, e)) return;
  e.endurance = Math.max(0, e.endurance - dt * (e.boost ? R.boostEndurance : 1));
  // Bunkers empty: the group drops whatever it was doing and crawls into the nearest port.
  if (e.endurance <= 0 && !e.dry) {
    becomeDry(world, e);
    return;
  }
  if (e.state === 'hunting') {
    stepHunt(world, e, dt);
    return;
  }
  if (turnsHomeForFuel(world, e)) return;
  if (e.state === 'escorting') {
    keepStation(world, e);
    return;
  }
  if (e.state !== 'atSea') return;

  if (e.joinTarget && !e.route.length && !e.plan.length) steerForConvoy(world, e);
  if (e.followEscort && !e.joinTarget && !e.route.length && !e.plan.length && followLeader(world, e, dt)) return;
  // A support group's leader eases off while its groups close up.
  const ordered = e.orderedKn;
  if (e.waitForGroup) e.orderedKn = e.speedKn * world.rules.formations.waitSpeed;
  stepShip(world, e, dt, (port) => enterPort(world, e, port));
  e.orderedKn = ordered;
  if (e.routeEnded) {
    e.routeEnded = false;
    shipEndAction(world, e);
  }
  if (e.planJustEnded) {
    // The end of its legs is the end of its route.
    e.planJustEnded = false;
    afterLegs(world, e);
  }
  if (e.state !== 'atSea' || e.homeward || e.dry) return; // ordered home: it goes home
  meetConvoys(world, e);
}

/** Endurance (s) the group needs to get home: the way into the nearest port, and a margin. */
function homeReserve(world, e) {
  const R = world.rules.escortGroups;
  const home = portChoices(world, e)[0];
  const kn = Math.min(e.speedKn, e.orderedKn || e.speedKn);
  const hours = home ? home.km / (kn * KNOT_KMH) : 0;
  return (hours + R.lowEnduranceDays * 24) * 3600;
}

/** Out of fuel: no more hunting nor escorting; into the nearest port at a crawl. */
function becomeDry(world, e) {
  const R = world.rules.escortGroups;
  const convoy = e.state === 'escorting' ? world.convoys.find((c) => c.id === e.escorting) : null;
  e.endurance = 0;
  e.dry = true;
  e.dryKn = R.dryKn;
  e.boost = false;
  e.lowWarned = true;
  if (e.state === 'hunting') endHunt(world, e, false, 'fuel');
  if (convoy) e.leftConvoy = convoy.id;
  sendEscortHome(world, e);
  const port = e.destination ? world.byId.port.get(e.destination) : null;
  emit(world, 'escortDry', {
    escort: e.name, escortId: e.id, port: port ? port.name : '', kn: R.dryKn, convoy: convoy ? convoy.name : null, convoyId: convoy ? convoy.id : null, x: e.x, y: e.y,
  });
}

/** What a group does at the end of its route: stop, hold on, meet a convoy, hunt, go into port. */
function shipEndAction(world, e) {
  const a = e.endAction || { kind: 'stop' };
  if (a.kind === 'hold') return; // on along its course
  if (a.kind === 'escort') {
    const c = world.convoys.find((x) => x.id === a.id);
    if (c && c.state === 'atSea') {
      e.joinTarget = c.id;
      e.leftConvoy = null;
      return;
    }
  }
  if (a.kind === 'hunt' && canHunt(world, e)) {
    // A search on the spot; with its depth charges down to the reserve, it just stops there.
    startHunt(world, e, e.x, e.y);
    return;
  }
  if (a.kind === 'port') {
    sendEscortHome(world, e, a.id);
    return;
  }
  e.state = 'waiting';
  emit(world, 'convoyWaiting', { convoy: e.name, convoyId: e.id, unitKind: 'escort' });
}

/** End actions open to a group: stop, hold on, meet a convoy at sea, hunt there, go into a port. */
export function shipEndChoices(world, e) {
  const list = [{ kind: 'stop' }, { kind: 'hold' }, { kind: 'hunt' }];
  for (const c of world.convoys) if (c.state === 'atSea' && c.type !== 'coastal' && !c.straggler) list.push({ kind: 'escort', id: c.id });
  for (const p of acceptingPorts(world, e)) if (!p.foreign) list.push({ kind: 'port', id: p.id });
  return list;
}

export function setShipEndAction(world, e, action) {
  const choice = shipEndChoices(world, e).find((c) => c.kind === action.kind && (c.id || null) === (action.id || null));
  if (!choice) return false;
  e.endAction = { ...choice };
  return true;
}

// ---- U-boats ----------------------------------------------------------------------

/**
 * "Never yet", as a game time, for the hour of a boat's last attack or last report: a number
 * a save can keep (JSON has no infinity: it came back as 0, the first second of the game).
 */
export const LONG_AGO = -1e9;

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
    deepUntil: 0, // gone deep after shaking off a hunt: no ASDIC holds it until then
    sunkAt: null,
    boat: 1,
    target: null,
    torpedoes: def.torpedoes ?? 3,
    torpedoesFull: def.torpedoes ?? 3,
    goneAt: null,
    lastAttack: LONG_AGO,
    lastReport: LONG_AGO,
    known: Boolean(def.known),
    way: null, // its way round the land to where it is going (uboatnav.js)
    wanderAt: 0,
  };
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
    // Seen (the flash, the torpedo tracks): the nearest group that can get at it goes for it
    // with depth charges. Out of reach of groups told to stay, it is only made to dive.
    if (spotAttacker(world, u, c)) {
      const group = world.escorts
        .filter((e) => e.state === 'escorting' && e.escorting === c.id && !e.engage && willCounter(world, e, u, c))
        .sort((a, b) => distance(a.x, a.y, u.x, u.y) - distance(b.x, b.y, u.x, u.y))[0];
      if (group) {
        engage(world, group, u, 'flash');
        return;
      }
      dive(world, u, A.diveHours);
    }
    // Unseen, it may still be driven off by the escort's sweep.
    if (rng.next() < U.pDriveOffPerEscort * escorts * A.unseenFactor) {
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
  if (u.state === 'sunk') {
    if (world.scenario.uboatRotation && world.t % 60 === 0) replaceSunk(world, u);
    return;
  }
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
    // Back to the bases in France, round the land; out of the game some way off.
    const [bx, by] = project(U.reentry.lon, U.reentry.lat);
    const went = steerUboat(world, u, bx, by, shadowV, dt);
    if (went !== 'moving' || distance(u.x, u.y, u.hx, u.hy) > 400) {
      u.state = 'gone';
      u.goneAt = world.t;
      u.way = null;
    }
    return;
  }
  if (u.state === 'patrol') {
    // To its station, then from point to point around it (open sea only, round the land).
    const went = steerUboat(world, u, u.wx, u.wy, patrolV, dt);
    if (went !== 'moving' && world.t >= (u.wanderAt || 0)) pickWander(world, u, went === 'blocked');
    if (world.t % 60 !== 0) return;
    const night = isNight(world, u.x, u.y);
    const sight = down ? (night ? 0 : A.periscopeSightKm) : night ? U.sightKmNight : U.sightKmDay;
    for (const c of world.convoys) {
      if (c.state !== 'atSea' || c.type === 'coastal') continue;
      if (distance(u.x, u.y, c.x, c.y) > sight) continue;
      u.state = 'shadow';
      u.target = c.id;
      u.task = null;
      u.lastReport = world.t;
      emit(world, 'convoySighted', { convoy: c.name, convoyId: c.id });
      dfFix(world, u);
      // The U-boat command learns where convoys pass, and sends the nearest boats toward the
      // reported convoy, a few at most (the others keep their patrol line for the next one).
      noteConvoy(world, c, c.x, c.y, 1);
      callBoats(world, c, U.callKm);
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
  // Into waters closed to them (the North Channel, the Irish Sea...): they let it go.
  if (world.t % 60 === 0 && inClosedWaters(world, c.x, c.y)) {
    breakOff(u);
    return;
  }
  if (u.state === 'closing') {
    // Called by the U-boat command: run toward the last reported position, round the land.
    if (steerUboat(world, u, c.x, c.y, shadowV, dt) === 'blocked') {
      breakOff(u);
      return;
    }
    if (world.t % 60 === 0) {
      const d = distance(u.x, u.y, c.x, c.y);
      if (!down && d <= (isNight(world, u.x, u.y) ? U.sightKmNight : U.sightKmDay)) u.state = 'shadow';
      else if (d > (u.closeLimitKm ?? U.callKm * 1.5)) breakOff(u);
    }
    return;
  }
  const [hx, hy] = headingVector(c.heading);
  const tx = c.x - hx * U.shadowDistanceKm;
  const ty = c.y - hy * U.shadowDistanceKm;
  // Astern of it; a point astern on the land (the convoy rounding a headland): straight at it.
  if (steerUboat(world, u, tx, ty, shadowV, dt) === 'blocked') moveTo(u, c.x, c.y, shadowV, dt);
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
  if (d >= U.shadowDistanceKm + 8 || world.t - u.lastAttack < U.attackGapH * 3600) return;
  // In place and ready: each boat picks its own moment, any time of the night. By day it
  // hardly ever attacks a convoy; a straggler or a ship alone tempts it more.
  const alone = c.straggler || c.ships <= U.aloneShips;
  const perHour = isNight(world, c.x, c.y) ? U.attackPerHourNight : alone ? U.attackPerHourDayAlone : U.attackPerHourDay;
  if (world.rng.next() < perHour / 60) attack(world, u, c);
}

/** The next point of a patrol: somewhere open around the station (or, if none, wait an hour). */
function pickWander(world, u, blocked) {
  for (let k = 0; k < 6; k++) {
    const a = world.rng.next() * Math.PI * 2;
    const r = Math.sqrt(world.rng.next()) * u.radius;
    const x = u.hx + Math.cos(a) * r;
    const y = u.hy + Math.sin(a) * r;
    if (openForUboat(world, x, y)) {
      u.wx = x;
      u.wy = y;
      u.wanderAt = blocked ? world.t + 1800 : 0; // a way that failed is not tried again at once
      return;
    }
  }
  u.wx = u.x;
  u.wy = u.y;
  u.wanderAt = world.t + 3600;
}

/** The boat lets its convoy go and goes back to its patrol. */
function breakOff(u) {
  u.state = 'patrol';
  u.target = null;
  u.closeLimitKm = null;
  u.way = null;
}

/**
 * A long scenario: a U-boat that went home for torpedoes and a refit sails again from
 * the Biscay bases and makes for its patrol area.
 */
function returnFromBase(world, u) {
  const U = world.rules.uboats;
  if (u.goneAt === null || world.t - u.goneAt < U.refitDays * 86400) return;
  sailFromBase(world, u);
}

/**
 * A long scenario: the U-boat command fills the gap left by a boat that was sunk. Another
 * one sails from the Biscay bases, replaceDays later, for the same patrol area. The player
 * is told nothing: a new boat is one more unknown on the table.
 */
function replaceSunk(world, u) {
  const U = world.rules.uboats;
  if (!U.replaceDays) return;
  // A game saved before the hour of the sinking was kept: counted from now.
  if (u.sunkAt === null || u.sunkAt === undefined) u.sunkAt = world.t;
  if (world.t - u.sunkAt < U.replaceDays * 86400) return;
  u.sunkAt = null;
  u.known = false;
  u.boat = (u.boat || 1) + 1; // the second, third... boat to hold this patrol area
  u.lastAttack = LONG_AGO;
  u.lastReport = LONG_AGO;
  sailFromBase(world, u);
}

/** The boat (back from its refit, or a new one) leaves the Biscay bases for its patrol area. */
function sailFromBase(world, u) {
  const U = world.rules.uboats;
  const [x, y] = project(U.reentry.lon, U.reentry.lat);
  u.x = x;
  u.y = y;
  const station = uboatSpot(world, u.hx, u.hy) || [x, y];
  [u.hx, u.hy] = station;
  u.wx = u.hx;
  u.wy = u.hy;
  u.way = null;
  u.wanderAt = 0;
  u.state = 'patrol';
  u.target = null;
  u.torpedoes = u.torpedoesFull;
  u.goneAt = null;
  u.submergedUntil = 0;
  u.deepUntil = 0;
  u.damaged = false; // repaired during its refit
}

/**
 * Once a minute: an ocean convoy with no escort that comes within reach of the escort
 * bases calls the player (once per convoy). `free` says how many groups wait in port.
 */
export function checkEscortRange(world) {
  if (!world.escorts.length) return;
  const reach = world.rules.escortGroups.alertKm;
  const bases = [...new Set(world.escorts.map((e) => e.portId))].map((id) => world.byId.port.get(id)).filter(Boolean);
  for (const c of world.convoys) {
    if (c.rangeAlerted || c.state !== 'atSea' || c.type === 'coastal' || c.straggler) continue;
    if (world.escorts.some((e) => e.escorting === c.id || e.joinTarget === c.id)) continue;
    let near = Infinity;
    for (const p of bases) near = Math.min(near, distance(c.x, c.y, p.x, p.y));
    if (near > reach) continue;
    c.rangeAlerted = true;
    const free = world.escorts.filter((e) => e.state === 'inPort').length;
    emit(world, 'convoyInEscortRange', { convoy: c.name, convoyId: c.id, free, km: Math.round(near), x: c.x, y: c.y });
  }
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
