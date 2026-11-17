// Fighter control. In Arcade the sector controller can guide a squadron onto a raid
// himself. How well depends on what the table knows of the raid there: in the heart of a
// radar beam he places the squadron where it must be; at the edge of the range, with a
// damaged station or with the Observer Corps alone, he may put it too low or beside the
// raid. A patrol in sight of the raid makes it certain.

import { FOOT_M, bearing, distance, headingDiff } from './geo.js';
import { emit } from './events.js';
import { solveIntercept } from './intercept.js';
import { contactEstimate } from './query.js';
import { isActive } from './raid.js';
import { radarRangeFactor } from './sites.js';
import { aircraftSpec } from './squadron.js';
import { patrolSeeing } from './patrols.js';

/**
 * How well the table knows a raid at (x, y) and height altM: { q (0 to 1), source }, where
 * source is 'radar', 'observers', 'patrol' or null.
 */
export function coverageQuality(world, x, y, altM) {
  const D = world.rules.detection;
  const C = world.rules.control;
  let best = 0;
  let source = null;
  let seen = 0;
  for (const s of world.radars) {
    const factor = radarRangeFactor(world, s);
    if (factor <= 0) continue;
    const range = Math.min(D.radarMaxRangeKm, D.radarMinRangeKm + D.radarRangePerM * altM) * factor;
    const d = distance(s.x, s.y, x, y);
    if (d > range) continue;
    const off = Math.abs(headingDiff(s.azimuth, bearing(s.x, s.y, x, y)));
    if (off > D.radarHalfArcDeg) continue;
    seen++;
    let q = 1;
    const edgeR = d / range;
    const edgeA = off / D.radarHalfArcDeg;
    if (edgeR > C.radarEdgeFrom) q -= ((edgeR - C.radarEdgeFrom) / (1 - C.radarEdgeFrom)) * C.radarEdgeLoss;
    if (edgeA > C.radarEdgeFrom) q -= ((edgeA - C.radarEdgeFrom) / (1 - C.radarEdgeFrom)) * C.radarEdgeLoss;
    q *= C.damagedRadar + (1 - C.damagedRadar) * factor;
    if (q > best) {
      best = q;
      source = 'radar';
    }
  }
  if (seen >= 2) best = Math.min(1, best + C.secondRadarBonus);
  if (altM <= D.observerMaxAltM && world.terrain.isObserved(x, y, D.observerCellKm, D.observerOffshoreKm) && C.observers > best) {
    best = C.observers;
    source = 'observers';
  }
  if (patrolSeeing(world, x, y, altM)) {
    best = 1;
    source = 'patrol';
  }
  return { q: Math.max(0, Math.min(1, best)), source };
}

function roundChance(q) {
  return Math.round(q * 20) / 20;
}

/** Speed of a squadron (km/s) as the controller reckons it. */
function speedOf(world, s) {
  const type = aircraftSpec(world, s.type);
  return (s.speedMode === 'max' ? type.maxKmh : type.cruiseKmh) / 3600;
}

/**
 * Chance that the controller brings squadron `s` onto raid `raidId`, judged at the point
 * where they should meet: { p, x, y, heading, time } or null when there is no contact.
 */
export function interceptChance(world, s, raidId) {
  const contact = world.contacts.get(raidId);
  const est = contact ? contactEstimate(world, contact) : null;
  if (!est) return null;
  const delay = s.state === 'ready' ? world.rules.squadron.scrambleSeconds : s.state === 'scrambling' ? s.timer : 0;
  const sx = s.x;
  const sy = s.y;
  const sol = solveIntercept(sx, sy, speedOf(world, s), est.x + est.vx * delay, est.y + est.vy * delay, est.vx, est.vy);
  const x = sol ? sol.x : est.x;
  const y = sol ? sol.y : est.y;
  const { q, source } = coverageQuality(world, x, y, est.altM);
  return { p: roundChance(q), source, x, y, heading: sol ? sol.heading : bearing(sx, sy, est.x, est.y), time: sol ? sol.time + delay : null };
}

/** The controller stops guiding the squadron, which then orbits where it is. */
export function endGuidance(world, s, reason = null) {
  const g = s.intercept;
  s.intercept = null;
  if (s.state === 'airborne') {
    s.vector = null;
    s.orbit = true;
  }
  if (g && reason) {
    const contact = world.contacts.get(g.raidId);
    emit(world, 'interceptEnded', { squadron: s.name, squadronId: s.id, raid: contact ? contact.label : g.raidId, raidId: g.raidId, reason });
  }
}

/**
 * Heading the controller gives a guided squadron this second (and its altitude, set on the
 * squadron), or null when the guidance ends. The odds are drawn once, when the squadron is
 * close: a failure puts it too low or beside the raid, and the miss is reported as usual.
 */
export function guidanceHeading(world, s, v) {
  const C = world.rules.control;
  const g = s.intercept;
  const contact = world.contacts.get(g.raidId);
  const raid = world.raids.find((r) => r.id === g.raidId);
  const est = contact ? contactEstimate(world, contact) : null;
  if (!est || !raid || !isActive(raid)) {
    endGuidance(world, s, 'lost');
    return null;
  }
  const d = distance(s.x, s.y, est.x, est.y);
  if (g.ok === null && d < C.rollKm) {
    g.p = roundChance(coverageQuality(world, est.x, est.y, est.altM).q);
    g.ok = world.rng.next() < g.p;
    if (!g.ok) {
      g.error = world.rng.next() < 0.5 ? 'low' : 'wide';
      g.side = world.rng.next() < 0.5 ? -1 : 1;
      g.errorT = world.t;
    }
  }
  const sol = solveIntercept(s.x, s.y, v, est.x, est.y, est.vx, est.vy);
  let heading = sol ? sol.heading : bearing(s.x, s.y, est.x, est.y);
  let altM = est.altM + C.guideAboveFt * FOOT_M;
  if (g.ok === false) {
    if (world.t - g.errorT > C.giveUpS) {
      endGuidance(world, s, 'failed');
      return null;
    }
    if (g.error === 'low') {
      altM = est.altM - C.missLowM;
    } else {
      // Aimed beside the raid's track.
      const mx = sol ? sol.x : est.x;
      const my = sol ? sol.y : est.y;
      const h = ((heading + 90 * g.side) * Math.PI) / 180;
      heading = bearing(s.x, s.y, mx + Math.sin(h) * C.missWideKm, my + Math.cos(h) * C.missWideKm);
    }
  }
  const R = world.rules.squadron;
  const spec = aircraftSpec(world, s.type);
  const top = Math.min(R.maxAltitudeFt, (spec && spec.ceilingFt) || R.maxAltitudeFt);
  const ft = Math.max(R.minAltitudeFt, Math.min(top, Math.round(altM / FOOT_M / 1000) * 1000));
  s.targetAlt = ft * FOOT_M;
  return heading;
}
