// Navigation by heading and steps ("legs"), shared by aircraft and ships.
// A leg is "steer this heading" until an end: a duration, a clock time, a grid square or a
// position. Legs are run one after the other; after the last one the unit keeps its heading.
// This is dead reckoning: a badly computed heading simply passes beside its goal, and the
// next leg starts from where the unit really is.

import { distance, headingDiff, headingVector, project } from './geo.js';
import { gridSquare, inSquare } from './grid.js';
import { emit } from './events.js';

/** Where a leg ends in the world: { x, y, square, radius } or null for time-based ends. */
export function legTarget(world, leg, domain) {
  const end = leg.end;
  if (!end) return null;
  const radius = world.rules.navigation.pointRadiusKm[domain];
  if (end.kind === 'square') {
    const sq = gridSquare(world.grid, end.ref);
    return sq ? { x: sq.cx, y: sq.cy, square: sq, radius } : null;
  }
  if (end.kind === 'position') {
    const [x, y] = project(end.lon, end.lat);
    return { x, y, square: null, radius };
  }
  return null;
}

function startLeg(world, u) {
  u.legState = { startT: world.t, best: Infinity, startX: u.x, startY: u.y };
}

function legFinished(world, u, leg, domain) {
  const end = leg.end;
  if (!end) return null;
  const st = u.legState;
  if (end.kind === 'duration') return world.t - st.startT >= end.s ? 'done' : null;
  if (end.kind === 'time') return world.t >= end.t ? 'done' : null;
  const target = legTarget(world, leg, domain);
  if (!target) return 'done';
  const d = distance(u.x, u.y, target.x, target.y);
  if (target.square ? inSquare(target.square, u.x, u.y) : d <= target.radius) return 'done';
  // Passed abeam: the goal is getting further away although the unit is on the leg heading.
  const settled = Math.abs(headingDiff(u.heading, leg.heading)) < 10;
  const moved = distance(u.x, u.y, st.startX, st.startY) > 1;
  if (d < st.best) st.best = d;
  else if (settled && moved && d > st.best + world.rules.navigation.passedMarginKm) return 'passed';
  return null;
}

/**
 * Heading to steer for the current leg, moving on to the next legs as they end.
 * Returns null when the unit has no plan.
 */
export function followPlan(world, u, domain) {
  for (let guard = 0; guard < 20 && u.plan.length; guard++) {
    const leg = u.plan[0];
    if (!u.legState) startLeg(world, u);
    const finished = legFinished(world, u, leg, domain);
    if (!finished) return leg.heading;
    const info = { unit: u.name, unitId: u.id, unitKind: u.kind, heading: leg.heading };
    if (finished === 'passed') {
      info.km = Math.round(u.legState.best);
      info.target = leg.end.kind === 'square' ? leg.end.ref : null;
      emit(world, 'legMissed', info);
    }
    u.plan.shift();
    u.legState = null;
    if (u.plan.length) {
      emit(world, 'legDone', { ...info, next: u.plan[0].heading });
    } else {
      // End of the plan: aircraft hold the last heading, ships keep their course.
      emit(world, 'planEnded', info);
      if (u.kind === 'squadron') u.vector = leg.heading;
      else u.course = leg.heading;
      return leg.heading;
    }
  }
  return null;
}

/** Distance along a ray from (sx, sy) on `heading` at which the leg ends (geometry only). */
function rayEnd(world, sx, sy, heading, leg, domain) {
  const target = legTarget(world, leg, domain);
  if (!target) return null;
  const [dx, dy] = headingVector(heading);
  const along = (target.x - sx) * dx + (target.y - sy) * dy;
  if (along <= 0) return 0;
  if (target.square) {
    // Ray against the square: entry distance if it is crossed, abeam point otherwise.
    const s = target.square;
    let t0 = 0;
    let t1 = Infinity;
    for (const [o, d, lo, hi] of [[sx, dx, s.x0, s.x1], [sy, dy, s.y0, s.y1]]) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return along;
      } else {
        const a = (lo - o) / d;
        const b = (hi - o) / d;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
    }
    return t0 <= t1 ? t0 : along;
  }
  const perp2 = (target.x - sx) ** 2 + (target.y - sy) ** 2 - along * along;
  const r2 = target.radius * target.radius;
  return perp2 <= r2 ? Math.max(0, along - Math.sqrt(r2 - perp2)) : along;
}

/**
 * Dead-reckoned track of a plan: [{ x, y, t, open }] starting at the unit. `speedOf(leg)`
 * gives the speed in km/s on each leg. `openKm` is the length drawn for a leg without end.
 */
export function projectPlan(world, u, legs, speedOf, domain, openKm, start = null) {
  let x = start ? start.x : u.x;
  let y = start ? start.y : u.y;
  let t = start ? start.t : world.t;
  const points = [{ x, y, t, open: false }];
  legs.forEach((leg, index) => {
    const v = speedOf(leg);
    let km;
    let open = false;
    const current = index === 0 && u.legState && legs === u.plan;
    const end = leg.end;
    if (!end) {
      km = openKm;
      open = true;
    } else if (end.kind === 'duration') {
      const left = current ? Math.max(0, end.s - (world.t - u.legState.startT)) : end.s;
      km = v * left;
    } else if (end.kind === 'time') {
      km = v * Math.max(0, end.t - t);
    } else {
      km = rayEnd(world, x, y, leg.heading, leg, domain) ?? 0;
    }
    const [dx, dy] = headingVector(leg.heading);
    x += dx * km;
    y += dy * km;
    t += v > 0 ? km / v : 0;
    points.push({ x, y, t, open });
  });
  return points;
}

/**
 * Reads the end of a leg typed by the player:
 *   ""            → no end (until further orders)
 *   "6", "6 min", "1 h 30", "30 h" → a duration (bare numbers are in `defaultUnit`)
 *   "14:20", "à 14h20"             → a clock time
 *   "J5"                            → a grid square
 *   "56N 12O", "56°30'N 12°W"        → a position (longitude west unless E is given)
 * Returns { ok: true, end } or { ok: false, error }.
 */
export function parseLegEnd(text, { grid = null, defaultUnit = 'min', nowMs = 0 } = {}) {
  const raw = String(text || '').trim().toLowerCase().replace(/,/g, '.');
  if (!raw) return { ok: true, end: null };

  let m = /^(?:à\s*)?(\d{1,2})\s*:\s*(\d{2})$/.exec(raw) || /^à\s*(\d{1,2})\s*h\s*(\d{2})?$/.exec(raw);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2] || 0);
    if (hh > 23 || mm > 59) return { ok: false, error: 'time' };
    return { ok: true, end: { kind: 'clock', hh, mm } };
  }

  m = /^([a-hj-z])\s*(\d{1,2})$/.exec(raw);
  if (m) {
    const sq = gridSquare(grid, `${m[1]}${m[2]}`);
    return sq ? { ok: true, end: { kind: 'square', ref: sq.ref } } : { ok: false, error: 'square' };
  }

  m = /^(\d{1,3}(?:\.\d+)?)\s*h\s*(\d{1,2})?\s*(?:min|mn)?$/.exec(raw);
  if (m) {
    const s = Number(m[1]) * 3600 + Number(m[2] || 0) * 60;
    return s > 0 ? { ok: true, end: { kind: 'duration', s } } : { ok: false, error: 'zero' };
  }
  m = /^(\d{1,4}(?:\.\d+)?)\s*(min|mn|m)?$/.exec(raw);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2] ? 'min' : defaultUnit;
    const s = unit === 'h' ? n * 3600 : n * 60;
    return s > 0 ? { ok: true, end: { kind: 'duration', s } } : { ok: false, error: 'zero' };
  }

  const coord = String.raw`(\d{1,3}(?:\.\d+)?)\s*(?:°\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′])?)?\s*`;
  m = new RegExp(`^${coord}([ns])?[\\s;/]+${coord}([eow])?$`).exec(raw);
  if (m) {
    let lat = Number(m[1]) + Number(m[2] || 0) / 60;
    let lon = Number(m[4]) + Number(m[5] || 0) / 60;
    if (m[3] === 's') lat = -lat;
    if (m[6] !== 'e') lon = -lon;
    if (Math.abs(lat) > 89 || Math.abs(lon) > 180) return { ok: false, error: 'position' };
    return { ok: true, end: { kind: 'position', lat, lon } };
  }
  return { ok: false, error: 'format' };
}

/** Turns a clock end ({ hh, mm }) into the next game time at that hour, after `afterT`. */
export function resolveClock(world, end, afterT = world.t) {
  if (!end || end.kind !== 'clock') return end;
  const dayMs = 86400000;
  const afterMs = world.startMs + afterT * 1000;
  const midnight = Math.floor(afterMs / dayMs) * dayMs;
  let ms = midnight + (end.hh * 60 + end.mm) * 60000;
  if (ms <= afterMs) ms += dayMs;
  return { kind: 'time', t: (ms - world.startMs) / 1000 };
}
