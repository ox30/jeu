// The hunt for the U-boats. In 1940 a U-boat is found by eye when it is on the surface (far
// by day, hardly at night), at the periscope only very close, and under water by the ASDIC
// of an escort within a couple of kilometres; radar comes in 1941. Every sighting leaves a
// plot on the table: its age gives two circles, how far the boat may have gone on the
// surface and under water. A U-boat that is seen dives, and loses its convoy. An escort
// group told to hunt leaves its convoy to chase a fresh contact for a few hours.
// The U-boat command, for its part, moves the patrol areas toward the convoy routes.

import { bearing, distance, headingVector, unproject } from './geo.js';
import { emit } from './events.js';
import { isPatrol, isDaylight } from './patrols.js';
import { currentSpeed } from './convoy.js';
import { seeUboat } from './contact.js';

const NM_KM = 1.852;

export function isSubmerged(world, u) {
  return u.submergedUntil > world.t;
}

/** Makes a U-boat dive for a while (it keeps its depth if already under water). */
export function dive(world, u, hours) {
  u.submergedUntil = Math.max(u.submergedUntil || 0, world.t + hours * 3600);
}

/** Radii (km) of the two circles around a U-boat plot of age `ageS`: surface and submerged. */
export function reachKm(world, ageS) {
  const A = world.rules.asw;
  const h = Math.max(0, ageS) / 3600;
  return {
    surface: h * A.surfaceKn * NM_KM,
    submerged: Math.min(h * A.submergedKn * NM_KM, A.batteryNm * NM_KM),
  };
}

/** Lays a U-boat plot on the table (one per boat and per few minutes). */
function addPlot(world, u, source, by, errorKm) {
  const A = world.rules.asw;
  const last = world.uboatPlots.find((p) => p.uboatId === u.id && world.t - p.t < A.plotEveryS);
  if (last) return null;
  const x = u.x + world.rng.gauss() * errorKm;
  const y = u.y + world.rng.gauss() * errorKm;
  const plot = { id: `P${world.nextPlotId++}`, uboatId: u.id, x, y, t: world.t, source, by, submerged: isSubmerged(world, u) };
  world.uboatPlots.push(plot);
  const [lon, lat] = unproject(x, y);
  emit(world, 'uboatPlot', { plotId: plot.id, source, by, lat, lon, x, y });
  return plot;
}

/** Escort groups at sea that look around: with a convoy, hunting, or sailing. */
function watchingGroups(world) {
  return world.escorts.filter((e) => e.state === 'escorting' || e.state === 'atSea' || e.state === 'hunting');
}

/** Has an escort of this convoy seen this U-boat lately (it can then counter-attack)? */
export function seenByEscorts(world, u, convoyId) {
  const A = world.rules.asw;
  return world.uboatPlots.some((p) => p.uboatId === u.id && world.t - p.t < A.counterWindowS
    && world.escorts.some((e) => e.id === p.byId && (e.escorting === convoyId || e.huntFor === convoyId)));
}

function escortLooks(world, e, u) {
  const A = world.rules.asw;
  const d = distance(e.x, e.y, u.x, u.y);
  const rng = world.rng;
  const day = isDaylight(world);
  const radar = world.scenario.escortRadar ? A.radar : null;
  if (!isSubmerged(world, u)) {
    const eye = day ? A.lookoutDayKm : A.lookoutNightKm;
    if (d <= eye && rng.next() < A.pLookout) return { source: 'seen', error: 0.5 };
    if (radar && d <= radar.surfaceKm && rng.next() < radar.p) return { source: 'radar', error: 0.3 };
    return null;
  }
  if (d <= A.asdicKm && rng.next() < A.pAsdic) return { source: 'asdic', error: 0.3 };
  if (day && d <= A.periscopeKm && rng.next() < A.pPeriscope) return { source: 'periscope', error: 0.2 };
  if (radar && d <= radar.periscopeKm && rng.next() < radar.p * 0.5) return { source: 'radar', error: 0.2 };
  return null;
}

function aircraftLooks(world, s, u) {
  const A = world.rules.asw;
  const spec = world.rules.patrols[s.type];
  if (isSubmerged(world, u)) return null;
  const d = distance(s.x, s.y, u.x, u.y);
  if (isDaylight(world) && d <= spec.uboatSightKm && world.rng.next() < A.pAircraft) return { source: 'aircraft', error: 1 };
  if (s.asv && spec.asvKm && d <= spec.asvKm && world.rng.next() < A.pAsv) return { source: 'asv', error: 1.5 };
  return null;
}

/** Depth charges or bombs on a U-boat: returns true when it is sunk. */
function attackUboat(world, u, p, by, x, y) {
  if (world.rng.next() >= p) return false;
  u.state = 'sunk';
  world.stats.uboatsSunk++;
  emit(world, 'uboatSunk', { by, x, y });
  return true;
}

function startHunt(world, e, plot) {
  const A = world.rules.asw;
  e.huntFor = e.escorting;
  e.state = 'hunting';
  e.escorting = null;
  e.huntX = plot.x;
  e.huntY = plot.y;
  e.huntUntil = world.t + A.huntHours * 3600;
  e.route = [];
  e.plan = [];
  e.legState = null;
  emit(world, 'escortHunting', { escort: e.name, escortId: e.id, convoy: world.convoys.find((c) => c.id === e.huntFor)?.name || '' });
}

function endHunt(world, e, sank) {
  const convoyId = e.huntFor;
  e.huntFor = null;
  e.state = 'atSea';
  const c = world.convoys.find((x) => x.id === convoyId);
  if (c && c.state === 'atSea') e.joinTarget = c.id;
  emit(world, 'escortHuntOver', { escort: e.name, escortId: e.id, sank, convoy: c ? c.name : '' });
}

/** Steering and searching of a hunting escort group (called every second by the escort). */
export function stepHunt(world, e, dt) {
  const A = world.rules.asw;
  if (world.t >= e.huntUntil) {
    endHunt(world, e, false);
    return;
  }
  const d = distance(e.x, e.y, e.huntX, e.huntY);
  if (d > 0.5) {
    const h = bearing(e.x, e.y, e.huntX, e.huntY);
    const [dx, dy] = headingVector(h);
    const step = Math.min(d, e.speed * dt);
    e.x += dx * step;
    e.y += dy * step;
    e.heading = h;
    e.course = h;
  }
  if (world.t % 60 !== 0) return;
  // Within ASDIC range of a U-boat: depth charges, and it is kept down.
  for (const u of world.uboats) {
    if (u.state === 'sunk' || u.state === 'gone') continue;
    if (distance(e.x, e.y, u.x, u.y) > A.asdicKm * 1.5) continue;
    dive(world, u, 1);
    const pl = addPlot(world, u, 'asdic', e.name, 0.3);
    if (pl) pl.byId = e.id;
    seeUboat(world, u, { by: e.name, byId: e.id, kind: 'escort', how: 'asdic' });
    if (attackUboat(world, u, A.pKillHuntPerShip * e.ships, e.name, u.x, u.y)) {
      endHunt(world, e, true);
      return;
    }
    // The search follows the boat.
    e.huntX = u.x;
    e.huntY = u.y;
  }
}

function sunkOrGone(u) {
  return u.state === 'sunk' || u.state === 'gone';
}

/** Once a minute: who sees which U-boat, dives, counter-attacks, hunts. */
export function updateAsw(world) {
  const A = world.rules.asw;
  for (const u of world.uboats) {
    if (sunkOrGone(u)) continue;
    for (const e of watchingGroups(world)) {
      const seen = escortLooks(world, e, u);
      if (!seen) continue;
      const plot = addPlot(world, u, seen.source, e.name, seen.error);
      if (plot) plot.byId = e.id;
      seeUboat(world, u, { by: e.name, byId: e.id, kind: 'escort', how: seen.source });
      dive(world, u, A.diveHours);
      emit(world, 'uboatSighted', { by: e.name, byId: e.id, source: seen.source, unitKind: 'escort' });
      // Close enough: an immediate attack with depth charges.
      if (distance(e.x, e.y, u.x, u.y) <= A.counterKm && attackUboat(world, u, A.pKillCounterPerShip * e.ships, e.name, u.x, u.y)) break;
      if (e.state === 'escorting' && e.behaviour === 'hunt' && plot) startHunt(world, e, plot);
      break;
    }
    if (sunkOrGone(u)) continue;
    for (const s of world.squadrons) {
      if (!isPatrol(s) || s.role !== 'coastal' || s.state !== 'airborne' || s.aircraft <= 0) continue;
      const seen = aircraftLooks(world, s, u);
      if (!seen) continue;
      addPlot(world, u, seen.source, s.name, seen.error);
      seeUboat(world, u, { by: s.name, byId: s.id, kind: 'squadron', how: seen.source });
      dive(world, u, A.diveHours);
      emit(world, 'uboatSighted', { by: s.name, byId: s.id, source: seen.source, unitKind: 'squadron' });
      const spec = world.rules.patrols[s.type];
      if (distance(s.x, s.y, u.x, u.y) <= A.aircraftAttackKm) attackUboat(world, u, spec.attackKill, s.name, u.x, u.y);
      break;
    }
  }
  const life = A.plotLifetimeH * 3600;
  world.uboatPlots = world.uboatPlots.filter((p) => world.t - p.t < life);
  if (world.t % (A.repositionEveryH * 3600) === 0) reposition(world);
}

/** Where a convoy will be in `hours`, following its route or its course. */
function predict(c, hours) {
  let left = currentSpeed(c) * hours * 3600;
  let x = c.x;
  let y = c.y;
  for (const [px, py] of c.route) {
    const d = distance(x, y, px, py);
    if (d >= left) {
      const k = left / d;
      return [x + (px - x) * k, y + (py - y) * k];
    }
    left -= d;
    x = px;
    y = py;
  }
  const [dx, dy] = headingVector(c.heading);
  return [x + dx * left, y + dy * left];
}

/**
 * The U-boat command sends the boats on patrol toward the probable route of the convoys
 * (its intelligence, the B-Dienst, reads part of the British signals). Their orders cost
 * them a radio message, sometimes caught by the direction-finding stations.
 */
function reposition(world) {
  const A = world.rules.asw;
  const convoys = world.convoys.filter((c) => c.state === 'atSea' && c.type !== 'coastal');
  if (!convoys.length) return;
  for (const u of world.uboats) {
    if (u.state !== 'patrol') continue;
    let best = null;
    for (const c of convoys) {
      const [px, py] = predict(c, A.predictHours);
      const d = distance(u.hx, u.hy, px, py);
      if (d < A.repositionMaxKm && (!best || d < best.d)) best = { d, px, py };
    }
    if (!best) continue;
    u.hx = best.px + world.rng.gauss() * A.repositionErrorKm;
    u.hy = best.py + world.rng.gauss() * A.repositionErrorKm;
    u.radius = Math.min(u.radius, A.repositionRadiusKm);
    u.wx = u.hx;
    u.wy = u.hy;
    if (world.rng.next() < A.repositionDfP) world.dfPending.push(u.id);
  }
}

/** The plots a squadron or group made, for the sheets. */
export function plotsNear(world, x, y, km) {
  return world.uboatPlots.filter((p) => distance(p.x, p.y, x, y) <= km);
}

/**
 * A U-boat has just attacked a convoy: the flash and the torpedo tracks may give it away to
 * the escort. Returns true when the escort has it (it may then counter-attack).
 */
export function spotAttacker(world, u, c) {
  const A = world.rules.asw;
  if (seenByEscorts(world, u, c.id)) return true;
  const groups = world.escorts.filter((e) => e.state === 'escorting' && e.escorting === c.id);
  if (!groups.length) return false;
  if (world.rng.next() >= A.pSpotAttacker * Math.min(1, groups.reduce((n, e) => n + e.ships, 0) / 4)) return false;
  const plot = addPlot(world, u, 'seen', groups[0].name, 0.5);
  if (plot) plot.byId = groups[0].id;
  seeUboat(world, u, { by: groups[0].name, byId: groups[0].id, kind: 'escort', how: 'seen' });
  return true;
}
