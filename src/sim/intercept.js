// Interception geometry: where can a fighter flying at `speed` meet a target moving at
// constant velocity?

import { bearing } from './geo.js';

/**
 * Pursuer at (px, py) with speed `speed` (km/s); target at (tx, ty) with velocity (vx, vy)
 * in km/s. Returns { x, y, time (s), heading } or null when the target cannot be caught.
 */
export function solveIntercept(px, py, speed, tx, ty, vx, vy) {
  const dx = tx - px;
  const dy = ty - py;
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;
  let t;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return null;
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a);
    const t2 = (-b + root) / (2 * a);
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    t = lo > 0 ? lo : hi;
  }
  if (!(t > 0)) return null;
  const x = tx + vx * t;
  const y = ty + vy * t;
  return { x, y, time: t, heading: bearing(px, py, x, y) };
}
