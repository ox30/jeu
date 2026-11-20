// The U-boat command (BdU, at Kernével near Lorient): where it sends its boats.
//
// It knows of the convoys only what it hears: its boats' reports, the sightings of the Fw 200
// Condors that fly from Bordeaux over the Bay of Biscay and west of Ireland, and the British
// signals its listening service, the B-Dienst, reads (a share set in the settings: 0 to 100 %).
// - Every two days it draws a patrol line across the lane the convoys took lately (a rake of
//   boats some 60 km apart): at first across the Admiralty route; if convoys keep passing
//   farther south, the next line goes south too. Its orders by radio give direction-finding
//   fixes now and then: the player can see the line move.
// - A convoy whose routing it read: the nearest free boats go and wait on its route, where
//   they can be before it.
// - A Condor that finds a convoy circles it and reports it: boats within a few hundred km run
//   to it; the Condor may also bomb a ship.

import { distance, project, sphereKm, unproject } from './geo.js';
import { emit } from './events.js';
import { isNight } from './daylight.js';
import { escortStrength, sinkShips } from './naval.js';
import { currentSpeed } from './convoy.js';
import { inClosedWaters, openForUboat, uboatSpot } from './uboatnav.js';

const DAY = 86400;

export function createBdu() {
  return { seen: [], nextLineAt: null, lineLat: null };
}

function rules(world) {
  return { ...world.rules.bdu, ...(world.scenario.bdu || {}) };
}

/**
 * A convoy seen (or its route read) at (x, y): the command remembers where convoys pass, as
 * the latitude where that convoy crosses (or crossed) the line's meridian, on its course.
 */
export function noteConvoy(world, c, x, y, weight = 1) {
  if (!world.bdu) return;
  const B = rules(world);
  const [lon, lat] = unproject(x, y);
  let laneLat = lat;
  const h = c && Number.isFinite(c.heading) ? (c.heading * Math.PI) / 180 : null;
  if (h !== null && Math.abs(Math.sin(h)) > 0.3) {
    const [lx] = project(B.lineLon, lat);
    const k = (lx - x) / Math.sin(h);
    laneLat = unproject(lx, y + k * Math.cos(h))[1];
  }
  laneLat = Math.max(40, Math.min(62, laneLat));
  world.bdu.seen.push({ lon, lat: laneLat, t: world.t, w: weight, convoyId: c ? c.id : null });
}

/** Latitude of the convoys' lane at the line's longitude: the Admiralty route, then what was seen. */
function laneLatitude(world) {
  const B = rules(world);
  let sum = 0;
  let weight = 0;
  // What it assumes at first: the convoys follow the Admiralty route.
  const prior = admiraltyLatitude(world, B.lineLon);
  if (prior !== null) {
    sum += prior * B.priorWeight;
    weight += B.priorWeight;
  }
  for (const s of world.bdu.seen) {
    const age = (world.t - s.t) / DAY;
    const far = Math.abs(s.lon - B.lineLon);
    if (age > B.memoryDays || far > B.laneLonKm / 70) continue;
    // A sighting far from the line's meridian says less about where convoys cross it.
    const w = s.w * 0.5 ** (age / B.halfLifeDays) * Math.exp(-far / 15);
    sum += s.lat * w;
    weight += w;
  }
  return weight ? sum / weight : null;
}

/** Latitude where the scenario's Admiralty routes cross a meridian (their mean), or null. */
function admiraltyLatitude(world, lon) {
  const lats = [];
  for (const line of world.scenario.convoySchedule || []) {
    const r = line.admiraltyRoute || [];
    for (let i = 1; i < r.length; i++) {
      const [lo1, la1] = r[i - 1];
      const [lo2, la2] = r[i];
      if ((lo1 - lon) * (lo2 - lon) <= 0 && lo1 !== lo2) lats.push(la1 + ((lon - lo1) / (lo2 - lo1)) * (la2 - la1));
    }
  }
  for (const c of world.convoys) {
    if (c.type === 'coastal' || !c.admiraltyRoute || !c.admiraltyRoute.length) continue;
    const pts = c.admiraltyRoute.map(([x, y]) => unproject(x, y));
    for (let i = 1; i < pts.length; i++) {
      const [lo1, la1] = pts[i - 1];
      const [lo2, la2] = pts[i];
      if ((lo1 - lon) * (lo2 - lon) <= 0 && lo1 !== lo2) lats.push(la1 + ((lon - lo1) / (lo2 - lo1)) * (la2 - la1));
    }
  }
  return lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
}

/** Boats free for the line: on patrol, with no convoy to chase and no route to watch. */
function freeBoats(world) {
  return world.uboats.filter((u) => u.state === 'patrol' && !u.target && !(u.task && u.task.until > world.t));
}

/**
 * Orders by radio: the boat goes to wait at (x, y), or at the nearest open sea (never ashore
 * nor in closed waters); its acknowledgement may give a direction-finding fix. False if there
 * is no open sea near.
 */
function order(world, u, x, y, radiusKm) {
  const spot = uboatSpot(world, x, y);
  if (!spot) return false;
  [u.hx, u.hy] = spot;
  u.radius = radiusKm;
  u.wx = u.hx;
  u.wy = u.hy;
  u.wanderAt = 0;
  if (world.rng.next() < world.rules.asw.repositionDfP) world.dfPending.push(u.id);
  return true;
}

/** The patrol line: free boats spread north-south across the lane, on the line's meridian. */
function formLine(world) {
  const B = rules(world);
  const lat = laneLatitude(world);
  if (lat === null) return;
  world.bdu.lineLat = lat;
  const boats = freeBoats(world);
  if (!boats.length) return;
  const spacingDeg = B.spacingKm / 111.2;
  // On the meridian, north to south across the lane (stations ashore or in closed waters dropped).
  const stations = boats.map((_, i) => project(B.lineLon, lat + (i - (boats.length - 1) / 2) * spacingDeg))
    .filter(([x, y]) => openForUboat(world, x, y));
  // Each station to the nearest boat still unassigned (north to south).
  const left = [...boats];
  for (const [x, y] of stations) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (distance(left[i].x, left[i].y, x, y) < distance(left[best].x, left[best].y, x, y)) best = i;
    }
    order(world, left[best], x, y, B.stationRadiusKm);
    left.splice(best, 1);
  }
  emit(world, 'bduLine', { lat: Math.round(lat * 10) / 10, lon: B.lineLon, boats: boats.length });
}

/** A key for a convoy's routing: each new routing (a new signal) is a new chance for the B-Dienst. */
function routeKey(c) {
  return c.routeVersion || 0;
}

/** Latitude where a convoy's route crosses meridian `lon` (from where it is), or null. */
function crossing(c, lon) {
  const pts = [[c.x, c.y], ...c.route].map(([x, y]) => unproject(x, y));
  for (let i = 1; i < pts.length; i++) {
    const [lo1, la1] = pts[i - 1];
    const [lo2, la2] = pts[i];
    if ((lo1 - lon) * (lo2 - lon) <= 0 && lo1 !== lo2) return la1 + ((lon - lo1) / (lo2 - lo1)) * (la2 - la1);
  }
  return null;
}

/** The point `km` ahead of the convoy along its route (its signalled course), or null past its end. */
function alongRoute(c, km) {
  let [x, y] = [c.x, c.y];
  let left = km;
  for (const [px, py] of c.route) {
    const d = distance(x, y, px, py);
    if (d >= left) return [x + ((px - x) * left) / d, y + ((py - y) * left) / d];
    left -= d;
    [x, y] = [px, py];
  }
  return null;
}

/**
 * The B-Dienst reads the routing of a convoy: free boats go and wait on its route ahead of it,
 * out at sea (where the route goes into closed waters, they cannot follow).
 */
function readRoute(world, c) {
  const B = rules(world);
  const U = world.rules.uboats;
  const v = currentSpeed(c);
  if (v <= 0) return 0;
  const boatV = (U.patrolKn * 1.852) / 3600;
  // The points of the route a boat may wait at, hour by hour ahead of the convoy.
  const points = [];
  // (Not out in mid-ocean beyond westLon: in early 1941 the boats waited in the approaches.)
  const [westX] = project(B.westLon ?? -180, 50);
  for (let h = 6; h <= B.readHorizonH; h += 3) {
    const p = alongRoute(c, v * h * 3600);
    if (!p) break;
    if (p[0] >= westX && openForUboat(world, p[0], p[1])) points.push({ h, x: p[0], y: p[1] });
  }
  const picks = [];
  for (const u of freeBoats(world)) {
    // The first point of the route the boat can reach well before the convoy.
    const first = points.find((p) => distance(u.x, u.y, p.x, p.y) / boatV / 3600 + B.readMarginH <= p.h);
    if (first) picks.push({ u, ...first });
  }
  picks.sort((a, b) => a.h - b.h);
  const first = picks[0];
  let sent = 0;
  if (first) {
    // A short rake across the route at the first point a boat can reach: that boat, and those
    // that can be there in time too. One error for all (the read was that far off).
    const rake = [first, ...picks.slice(1).filter((p) => distance(p.u.x, p.u.y, first.x, first.y) / boatV / 3600 + B.readMarginH <= first.h)]
      .slice(0, B.readBoats);
    const km = v * first.h * 3600;
    const next = alongRoute(c, km + 20) || [first.x + (first.x - c.x), first.y + (first.y - c.y)];
    const len = Math.hypot(next[0] - first.x, next[1] - first.y) || 1;
    const [px, py] = [-(next[1] - first.y) / len, (next[0] - first.x) / len]; // across the route
    const ex = world.rng.gauss() * B.readErrorKm;
    const ey = world.rng.gauss() * B.readErrorKm;
    rake.forEach((p, i) => {
      const off = (i - (rake.length - 1) / 2) * (B.readSpacingKm ?? 40);
      if (!order(world, p.u, first.x + ex + px * off, first.y + ey + py * off, B.stationRadiusKm)) return;
      p.u.task = { kind: 'route', convoyId: c.id, until: world.t + (first.h + 24) * 3600 };
      sent++;
    });
  }
  // The route itself tells where convoys go: the lane of the next line.
  const lat = crossing(c, B.lineLon);
  if (lat !== null) {
    const [x, y] = project(B.lineLon, lat);
    noteConvoy(world, c, x, y, 1);
  }
  return sent;
}

/** Once an hour: the B-Dienst, the Condors, and every two days the patrol line. */
export function updateBdu(world) {
  if (!world.bdu || !world.uboats.length) return;
  const B = rules(world);
  const share = Math.max(0, Math.min(100, Number(world.settings.bdienst ?? B.bdienstDefault))) / 100;
  for (const c of world.convoys) {
    if (c.state !== 'atSea' || c.type === 'coastal' || c.straggler || !c.route.length) continue;
    // Once per convoy: is its cipher traffic read? (the share set in the settings)
    if (!c.bdienst) c.bdienst = { read: world.rng.next() < share, key: null, at: null, done: true, boats: 0 };
    if (!c.bdienst.read) continue;
    // Each routing signal sent to it is read, some time after (decrypting takes a while).
    const key = routeKey(c);
    // A routing handed over by lamp or by a ship went on no air: nothing to read. And a
    // signal still being deciphered tells of a route the convoy has left: it is worth nothing.
    if (c.bdienst.key !== key && c.quietRoute === key) Object.assign(c.bdienst, { key, done: true });
    if (c.bdienst.key !== key) Object.assign(c.bdienst, { key, at: world.t + B.readDelayH * 3600, done: false });
    if (!c.bdienst.done && world.t >= c.bdienst.at) {
      c.bdienst.done = true;
      c.bdienst.boats = readRoute(world, c);
      emit(world, 'bdienstRead', { convoy: c.name, convoyId: c.id, boats: c.bdienst.boats });
    }
  }
  updateCondors(world);
  if (world.bdu.nextLineAt === null) world.bdu.nextLineAt = B.firstLineH * 3600;
  if (world.t >= world.bdu.nextLineAt) {
    world.bdu.nextLineAt = world.t + B.lineEveryH * 3600;
    formLine(world);
  }
  // Old memories go.
  world.bdu.seen = world.bdu.seen.filter((s) => world.t - s.t <= B.memoryDays * DAY);
}

// ---- the Condors -------------------------------------------------------------------

function condorBase(world) {
  const C = world.scenario.condors;
  return C ? project(C.base[0], C.base[1]) : null;
}

/** True if (x, y) is within the reach of the Condors (from their base, on the globe). */
export function inCondorReach(world, x, y) {
  const base = condorBase(world);
  if (!base) return false;
  const K = world.rules.condors;
  return sphereKm(base[0], base[1], x, y) <= (world.scenario.condors.rangeKm ?? K.rangeKm);
}

function updateCondors(world) {
  const K = world.rules.condors;
  if (!world.scenario.condors) return;
  const base = condorBase(world);
  const range = world.scenario.condors.rangeKm ?? K.rangeKm;
  for (const c of world.convoys) {
    if (c.state !== 'atSea' || c.type === 'coastal' || c.straggler) continue;
    if (isNight(world, c.x, c.y)) continue; // the Condors look for ships by day
    const d = sphereKm(base[0], base[1], c.x, c.y);
    if (d > range) continue;
    // Few aircraft: all over the Bay of Biscay and the south-western approaches, then the
    // farther from Bordeaux, the fewer sorties reach out there (west of Ireland: now and then).
    const reach = Math.max(K.farShare, Math.min(1, (range - d) / (range - K.fullKm)));
    if (world.rng.next() >= K.pSpotPerH * reach) continue;
    // Found: the Condor circles the convoy and reports it.
    noteConvoy(world, c, c.x, c.y, 1);
    const called = callBoats(world, c, K.callKm);
    emit(world, 'condorSighted', { convoy: c.name, convoyId: c.id, x: c.x, y: c.y, called });
    if (world.rng.next() < K.pAttack) {
      const escorts = escortStrength(world, c);
      const p = K.pHit / (1 + escorts * K.escortFactor);
      const n = world.rng.next() < p ? 1 : 0;
      emit(world, 'condorAttack', { convoy: c.name, convoyId: c.id, sunk: n, x: c.x, y: c.y });
      if (n) sinkShips(world, c, n, 'air');
    }
  }
}

/** Boats on patrol within `km` of the convoy run to it (a few at most). */
export function callBoats(world, c, km) {
  const U = world.rules.uboats;
  if (inClosedWaters(world, c.x, c.y)) return 0; // the convoy is where they do not go
  let pack = world.uboats.filter((o) => o.target === c.id && (o.state === 'shadow' || o.state === 'closing')).length;
  const near = world.uboats
    .filter((o) => o.state === 'patrol' && distance(o.x, o.y, c.x, c.y) <= km)
    .sort((a, b) => distance(a.x, a.y, c.x, c.y) - distance(b.x, b.y, c.x, c.y));
  let called = 0;
  for (const o of near) {
    if (pack >= (U.maxPack ?? Infinity)) break;
    o.state = 'closing';
    o.target = c.id;
    o.closeLimitKm = km * 1.5;
    pack++;
    called++;
  }
  return called;
}
