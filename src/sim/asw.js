// The hunt for the U-boats. In 1940 a U-boat is found by eye when it is on the surface (far
// by day, hardly at night), at the periscope only very close, and under water by the ASDIC
// of an escort within a couple of kilometres; radar comes in 1941. Every sighting leaves a
// plot on the table: its age gives two circles, how far the boat may have gone on the
// surface and under water. A U-boat that is seen dives, and loses its convoy. An escort
// group told to hunt leaves its convoy to chase a fresh contact for a few hours.
// The U-boat command, for its part, moves the patrol areas toward the convoy routes.

import { bearing, distance, stepAlong, unproject } from './geo.js';
import { emit } from './events.js';
import { isPatrol } from './patrols.js';
import { isDaylight } from './daylight.js';
import { forgetUboat, putPlot, seeUboat } from './contact.js';
import { clearAtSea, seaPath } from './searoute.js';
import { WATCHING } from './sight.js';
import { sendEscortHome } from './naval.js';

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
  const plot = putPlot(world, u, { x, y, t: world.t, source, by, submerged: isSubmerged(world, u) });
  const [lon, lat] = unproject(x, y);
  emit(world, 'uboatPlot', { plotId: plot.id, source, by, lat, lon, x, y });
  return plot;
}

/** Escort groups at sea that look around: with a convoy, hunting, sailing or waiting for orders. */
function watchingGroups(world) {
  return world.escorts.filter((e) => WATCHING.includes(e.state));
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
  const day = isDaylight(world, u.x, u.y);
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
  if (isDaylight(world, u.x, u.y) && d <= spec.uboatSightKm && world.rng.next() < A.pAircraft) return { source: 'aircraft', error: 1 };
  if (s.asv && spec.asvKm && d <= spec.asvKm && world.rng.next() < A.pAsv) return { source: 'asv', error: 1.5 };
  return null;
}

/** Bombs from an aircraft on a U-boat: returns true when it is sunk. */
function attackUboat(world, u, p, by, x, y) {
  if (world.rng.next() >= p) return false;
  u.state = 'sunk';
  world.stats.uboatsSunk++;
  forgetUboat(world, u);
  emit(world, 'uboatSunk', { by, x, y });
  return true;
}

// ---- hunts and depth-charge attacks ---------------------------------------------------
//
// A group that holds a U-boat (ASDIC, or seen close by) attacks it: a depth-charge pass every
// ten minutes, each of which may sink it, damage it (it then makes for home) or lose it (it
// went deep, turned away). A group told to stay with its convoy attacks only what comes
// close, for half an hour at most, then takes station again; one told to hunt leaves its
// convoy for a fresh contact, for the time set when it was launched (three hours by default),
// and comes back on its own. Every order given to a hunting group ends the hunt.

/** How long (hours) a hunt of this group lasts. */
export function huntHours(world, e) {
  return e.huntHours || world.rules.asw.huntHours;
}

/** The group leaves to hunt around (x, y): for its convoy if it has one, or on its own. */
export function startHunt(world, e, x, y, { hours = huntHours(world, e), stay = false, quiet = false } = {}) {
  const A = world.rules.asw;
  if (e.state === 'escorting') e.huntFor = e.escorting;
  else if (e.state !== 'hunting') e.huntFor = e.joinTarget || null;
  e.state = 'hunting';
  e.escorting = null;
  e.joinTarget = null;
  e.huntX = x;
  e.huntY = y;
  e.huntPath = null;
  e.huntGoal = null;
  e.huntStay = stay;
  e.huntUntil = world.t + (stay ? A.engagement.stayMaxS : hours * 3600);
  e.route = [];
  e.plan = [];
  e.legState = null;
  if (!quiet) emit(world, 'escortHunting', { escort: e.name, escortId: e.id, convoy: world.convoys.find((c) => c.id === e.huntFor)?.name || '', hours: stay ? 0 : hours, x, y });
}

/** The hunt is over (time up, U-boat sunk, or an order): back to the convoy, or waiting. */
export function endHunt(world, e, sank = false, why = 'time') {
  const convoyId = e.huntFor;
  if (e.engage) closeEngagement(world, e, sank ? 'sunk' : 'brokenOff');
  e.huntFor = null;
  e.huntUntil = null;
  e.huntPath = null;
  e.huntGoal = null;
  e.huntStay = false;
  e.state = 'atSea';
  const c = world.convoys.find((x) => x.id === convoyId);
  if (c && c.state === 'atSea') e.joinTarget = c.id;
  emit(world, 'escortHuntOver', { escort: e.name, escortId: e.id, sank, why, convoy: c && c.state === 'atSea' ? c.name : '' });
  // A group on its way into port (attacked on the way): it goes on into port.
  if (!e.joinTarget && why !== 'order' && e.homeward && e.destination) {
    sendEscortHome(world, e, e.destination);
    return;
  }
  if (!e.joinTarget && why !== 'order') {
    e.state = 'waiting';
    emit(world, 'convoyWaiting', { convoy: e.name, convoyId: e.id, unitKind: 'escort' });
  }
}

/** The player stops the hunt: the group goes back to its convoy, or stops and waits. */
export function stopHunt(world, e) {
  if (e.state !== 'hunting') return false;
  endHunt(world, e, false, 'stopped');
  return true;
}

/**
 * Steers toward (tx, ty) at full speed: straight, or round the land by sea (the way worked
 * out again only when the target has moved by more than 3 km). A target ashore (a plot whose
 * error ran inland) is approached as near as the coast allows.
 */
function steerTo(world, e, tx, ty, dt) {
  if (!e.huntPath || !e.huntGoal || distance(e.huntGoal[0], e.huntGoal[1], tx, ty) > 3) {
    e.huntGoal = [tx, ty];
    e.huntPath = clearAtSea(world, [e.x, e.y], [tx, ty], 1) ? [[tx, ty]] : seaPath(world, [e.x, e.y], [tx, ty], 1) || [];
  }
  const way = e.huntPath;
  if (!way.length) return; // no way by sea: it waits where it is
  const [ax, ay] = way.length > 1 ? way[0] : [tx, ty];
  const d = distance(e.x, e.y, ax, ay);
  if (d <= 0.3) {
    if (way.length > 1) way.shift();
    return;
  }
  const h = bearing(e.x, e.y, ax, ay);
  const step = Math.min(d, e.speed * dt);
  const [dx, dy] = stepAlong(h, step, e.y);
  const nx = e.x + dx;
  const ny = e.y + dy;
  if (world.terrain.isLand(nx, ny)) {
    if (way.length > 1) way.shift(); // a turning point grazing the coast: on to the next
    return;
  }
  e.x = nx;
  e.y = ny;
  e.heading = h;
  e.course = h;
}

/** A group holds a U-boat: the attack begins (a pass at once, then every ten minutes). */
export function engage(world, e, u, how) {
  if (e.engage || u.state === 'sunk' || u.state === 'gone') return;
  if (e.state !== 'hunting') startHunt(world, e, u.x, u.y, { stay: e.behaviour !== 'hunt', quiet: true });
  const convoy = world.convoys.find((c) => c.id === e.huntFor);
  const report = {
    id: `N${world.nextNavalReportId++}`,
    escort: e.name,
    escortId: e.id,
    ships: e.ships,
    convoy: convoy ? convoy.name : '',
    how,
    start: world.t,
    end: null,
    passes: [],
    result: null,
    x: u.x,
    y: u.y,
  };
  world.navalReports.push(report);
  e.engage = { uboatId: u.id, since: world.t, nextPass: world.t, reportId: report.id };
  dive(world, u, world.rules.asw.diveHours);
  emit(world, 'escortEngaged', {
    escort: e.name, escortId: e.id, convoy: report.convoy, convoyId: e.huntFor, how, report: report.id, x: u.x, y: u.y,
  });
}

function closeEngagement(world, e, result) {
  const rep = world.navalReports.find((r) => r.id === e.engage.reportId);
  if (rep) {
    rep.end = world.t;
    rep.result = rep.result || result;
  }
  e.engage = null;
}

/** One depth-charge pass on the U-boat held: sunk, damaged, lost, or nothing seen. */
function depthChargePass(world, e, u) {
  const E = world.rules.asw.engagement;
  const rng = world.rng;
  const rep = world.navalReports.find((r) => r.id === e.engage.reportId);
  const pass = (rep ? rep.passes.length : 0) + 1;
  const pKill = Math.min(0.9, E.pKillPerShip * e.ships * (u.damaged ? E.damagedKillFactor : 1));
  const pDamage = Math.min(0.9, E.pDamagePerShip * e.ships);
  const pLose = Math.max(E.pLoseMin, E.pLoseBase - E.pLosePerShip * e.ships);
  let result = 'nothing';
  const roll = rng.next();
  if (roll < pKill) result = 'sunk';
  else if (!u.damaged && roll < pKill + pDamage) result = 'damaged';
  else if (rng.next() < pLose) result = 'lost';
  if (rep) rep.passes.push({ t: world.t, result });
  emit(world, 'depthChargePass', {
    escort: e.name, escortId: e.id, pass, result, report: e.engage.reportId, x: u.x, y: u.y,
  });
  if (result === 'sunk') {
    u.state = 'sunk';
    world.stats.uboatsSunk++;
    forgetUboat(world, u);
    emit(world, 'uboatSunk', { by: e.name, x: u.x, y: u.y });
    if (rep) rep.result = 'sunk';
    endHunt(world, e, true, 'sunk');
    return;
  }
  if (result === 'damaged') {
    // Oil on the water: hit, it breaks off its patrol and makes for home, under water.
    u.damaged = true;
    u.state = 'leaving';
    u.target = null;
    dive(world, u, 6);
    if (rep) rep.result = 'damaged';
  }
  if (result === 'lost') {
    if (rep && !rep.result) rep.result = 'lost';
    closeEngagement(world, e, 'lost');
    // The search goes on where it was last held.
    e.huntX = u.x;
    e.huntY = u.y;
    return;
  }
  dive(world, u, 1); // kept down
  e.engage.nextPass = world.t + E.passEveryS;
}

/** Steering, searching and attacking of a hunting group (called every second). */
export function stepHunt(world, e, dt) {
  const A = world.rules.asw;
  const u = e.engage ? world.uboats.find((x) => x.id === e.engage.uboatId) : null;
  if (e.engage && (!u || sunkOrGone(u))) closeEngagement(world, e, 'lost');
  if (world.t >= e.huntUntil) {
    endHunt(world, e, false, 'time');
    return;
  }
  // A group that only countered close to its convoy goes back when it strays too far.
  if (e.huntStay && world.t % 60 === 0) {
    const c = world.convoys.find((x) => x.id === e.huntFor);
    if (c && distance(e.x, e.y, c.x, c.y) > A.engagement.stayMaxKm) {
      endHunt(world, e, false, 'tooFar');
      return;
    }
  }
  const held = e.engage ? world.uboats.find((x) => x.id === e.engage.uboatId) : null;
  steerTo(world, e, held ? held.x : e.huntX, held ? held.y : e.huntY, dt);
  if (world.t % 60 !== 0) return;
  if (held) {
    if (world.t >= e.engage.nextPass) {
      // The attack needs the boat within ASDIC range; otherwise the group closes in first.
      if (distance(e.x, e.y, held.x, held.y) <= A.asdicKm * 1.5) depthChargePass(world, e, held);
      else if (world.t - e.engage.nextPass > 2 * A.engagement.passEveryS) {
        // Twenty minutes without getting over it: it got away.
        const rep = world.navalReports.find((r) => r.id === e.engage.reportId);
        if (rep && !rep.result) rep.result = 'lost';
        closeEngagement(world, e, 'lost');
      }
    }
    return;
  }
  // Searching: a U-boat within ASDIC range is found, and attacked.
  for (const x of world.uboats) {
    if (sunkOrGone(x)) continue;
    if (distance(e.x, e.y, x.x, x.y) > A.asdicKm * 1.5) continue;
    const pl = addPlot(world, x, 'asdic', e.name, 0.3);
    if (pl) pl.byId = e.id;
    seeUboat(world, x, { by: e.name, byId: e.id, kind: 'escort', how: 'asdic' });
    engage(world, e, x, 'asdic');
    return;
  }
}

/**
 * What an escort makes of a U-boat under water: its depth (guessed, for the depth-charge
 * settings) and its course, both rough.
 */
function asdicEstimate(world, u) {
  const depthM = 10 * Math.round((40 + world.rng.next() * 110) / 10);
  const course = Number.isFinite(u.heading) ? (Math.round((u.heading + world.rng.gauss() * 12) / 5) * 5 + 360) % 360 : null;
  return { depthM, course };
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
      // Already held by this group: the same contact, not a new sighting.
      const held = Boolean(u.seen && u.seen.byId === e.id);
      const wasDown = isSubmerged(world, u);
      const plot = addPlot(world, u, seen.source, e.name, seen.error);
      if (plot) plot.byId = e.id;
      seeUboat(world, u, { by: e.name, byId: e.id, kind: 'escort', how: seen.source });
      dive(world, u, A.diveHours);
      const attack = !e.engage && distance(e.x, e.y, u.x, u.y) <= A.counterKm;
      if (!held) {
        u.asdicReportAt = world.t;
        emit(world, 'uboatSighted', {
          by: e.name, byId: e.id, source: seen.source, unitKind: 'escort', uboatId: u.id, plotId: plot ? plot.id : null,
          x: plot ? plot.x : u.x, y: plot ? plot.y : u.y, attack, dived: !wasDown, ...asdicEstimate(world, u),
        });
      } else if (wasDown && world.t - (u.asdicReportAt ?? -Infinity) >= (A.asdicReportEveryS ?? 1800)) {
        // A contact held at the ASDIC: now and then an estimate of its depth and course.
        u.asdicReportAt = world.t;
        emit(world, 'asdicContact', { by: e.name, byId: e.id, uboatId: u.id, x: u.x, y: u.y, ...asdicEstimate(world, u) });
      }
      // Close enough: the group attacks it with depth charges.
      if (attack) engage(world, e, u, seen.source);
      else if (e.state === 'escorting' && e.behaviour === 'hunt' && plot) startHunt(world, e, plot.x, plot.y);
      break;
    }
    if (sunkOrGone(u)) continue;
    for (const s of world.squadrons) {
      if (!isPatrol(s) || s.role !== 'coastal' || s.state !== 'airborne' || s.aircraft <= 0) continue;
      const seen = aircraftLooks(world, s, u);
      if (!seen) continue;
      const plot = addPlot(world, u, seen.source, s.name, seen.error);
      seeUboat(world, u, { by: s.name, byId: s.id, kind: 'squadron', how: seen.source });
      dive(world, u, A.diveHours);
      emit(world, 'uboatSighted', {
        by: s.name, byId: s.id, source: seen.source, unitKind: 'squadron', uboatId: u.id, plotId: plot ? plot.id : null,
        x: plot ? plot.x : u.x, y: plot ? plot.y : u.y, attack: false,
      });
      const spec = world.rules.patrols[s.type];
      if (distance(s.x, s.y, u.x, u.y) <= A.aircraftAttackKm) attackUboat(world, u, spec.attackKill, s.name, u.x, u.y);
      break;
    }
  }
  const life = A.plotLifetimeH * 3600;
  world.uboatPlots = world.uboatPlots.filter((p) => world.t - p.t < life);
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
