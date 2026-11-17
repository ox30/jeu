// The war at sea: U-boats that hunt the convoys at night, the escort groups that protect
// them, bombers against the coastal convoys, and the radio direction-finding fixes that
// betray a U-boat's position, roughly, when it reports a convoy.

import { KNOT_KMH, bearing, distance, headingVector, polylineLength, project, unproject } from './geo.js';
import { clearAtSea, seaPath } from './searoute.js';
import { emit } from './events.js';
import { solveIntercept } from './intercept.js';
import { acceptingPorts, currentSpeed, stepShip } from './convoy.js';
import { dive, engage, isSubmerged, spotAttacker, startHunt, stepHunt } from './asw.js';

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
    state: 'inPort', // inPort | atSea | waiting | escorting | hunting | refit
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
    homeward: false,
    behaviour: def.behaviour || 'stay', // stay with the convoy, or hunt the contacts
    huntFor: null,
    huntHours: null, // length of its hunts, set by the player (rules.asw.huntHours by default)
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

/**
 * The way into a port from where the ship is: by sea to the nearest point of one of the
 * port's channels (not back to its entrance when the ship is already in it), then up the
 * channel; straight to the port when it has none. { route, locked, km } or null.
 */
export function homeRoute(world, u, port) {
  const from = [u.x, u.y];
  const options = [];
  for (const a of port.approaches || []) {
    const pts = a.points;
    let rest = polylineLength(pts);
    for (let i = 1; i < pts.length; i++) {
      const seg = distance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      rest -= seg;
      const near = closestOnSegment(pts[i - 1], pts[i], from);
      options.push({ join: [near.x, near.y], tail: pts.slice(i), km: near.d + rest + distance(near.x, near.y, pts[i][0], pts[i][1]) });
    }
  }
  if (!options.length) options.push({ join: [port.x, port.y], tail: [], km: distance(u.x, u.y, port.x, port.y) });
  options.sort((a, b) => a.km - b.km);
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
 * Ports the group can go back to, nearest by sea first: [{ port, km, hours }]. Routes round the
 * land take time to work out: the list is kept while the group stays within 5 km and 10 minutes.
 */
export function portChoices(world, e) {
  const memo = PORT_MEMO.get(e);
  if (memo && world.t - memo.t < 600 && distance(e.x, e.y, memo.x, memo.y) < 5 && memo.world === world) return memo.list;
  const list = [];
  for (const port of acceptingPorts(world, e)) {
    if (port.foreign) continue;
    const r = homeRoute(world, e, port);
    if (r) list.push({ port, km: r.km, hours: r.km / KNOT_KMH / e.speedKn });
  }
  list.sort((a, b) => a.km - b.km);
  PORT_MEMO.set(e, { t: world.t, x: e.x, y: e.y, list, world });
  return list;
}

const PORT_MEMO = new WeakMap();

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
  e.endurance -= dt * (e.boost ? R.boostEndurance : 1);
  if (e.state === 'hunting') {
    stepHunt(world, e, dt);
    return;
  }
  if (!e.lowWarned && e.endurance < R.lowEnduranceDays * 86400) {
    e.lowWarned = true;
    const left = e.state === 'escorting' ? world.convoys.find((c) => c.id === e.escorting) : null;
    emit(world, 'escortLowFuel', {
      escort: e.name, escortId: e.id, convoy: left ? left.name : null, convoyId: left ? left.id : null, x: e.x, y: e.y,
    });
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
  }
  // A support group's member sails in station astern of its leader (formations.js).
  if (e.followEscort && !e.joinTarget && !e.route.length && !e.plan.length) {
    const leader = world.escorts.find((x) => x.id === e.followEscort);
    if (leader && leader.state === 'atSea') {
      const [hx, hy] = headingVector(leader.heading);
      const tx = leader.x - hx * 2 * e.followSlot;
      const ty = leader.y - hy * 2 * e.followSlot;
      if (distance(e.x, e.y, tx, ty) < Math.max(0.5, e.speed * dt * 1.5)) {
        e.x = tx;
        e.y = ty;
        e.heading = leader.heading;
        e.course = leader.heading;
        return;
      }
      e.course = bearing(e.x, e.y, tx, ty);
    }
  }
  // A support group's leader eases off while its groups close up.
  const ordered = e.orderedKn;
  if (e.waitForGroup) e.orderedKn = e.speedKn * world.rules.formations.waitSpeed;
  stepShip(world, e, dt, (port) => enterPort(world, e, port));
  e.orderedKn = ordered;
  if (e.routeEnded) {
    e.routeEnded = false;
    shipEndAction(world, e);
  }
  if (e.state !== 'atSea') return;
  // Meeting: within sight of an ocean convoy, the group takes station.
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
  if (a.kind === 'hunt') {
    startHunt(world, e, e.x, e.y, a.hours ? { hours: a.hours } : {});
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
    // Seen (the flash, the torpedo tracks): the nearest group goes for it with depth charges.
    if (spotAttacker(world, u, c)) {
      const group = world.escorts
        .filter((e) => e.state === 'escorting' && e.escorting === c.id && !e.engage)
        .sort((a, b) => distance(a.x, a.y, u.x, u.y) - distance(b.x, b.y, u.x, u.y))[0];
      if (group) {
        engage(world, group, u, 'flash');
        return;
      }
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
