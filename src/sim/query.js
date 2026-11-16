// Read-only helpers for the interface: what the controller can see of each raid.

import { isActive } from './raid.js';

export function visiblePlots(world, contact) {
  return contact.plots.filter((p) => p.visibleAt <= world.t);
}

/**
 * Best estimate of a contact: position, velocity (km/s), numbers and height.
 * With exact detection the true raid is used. Returns null when nothing is shown.
 */
export function contactEstimate(world, contact) {
  if (contact.lost) return null;
  const raid = world.raids.find((r) => r.id === contact.raidId);
  if (world.settings.detection === 'exact') {
    if (!raid || !isActive(raid)) return null;
    const v = raid.phase === 'assembling' ? 0 : raid.speed;
    const rad = (raid.heading * Math.PI) / 180;
    return {
      x: raid.x,
      y: raid.y,
      vx: Math.sin(rad) * v,
      vy: Math.cos(rad) * v,
      count: raid.bombers + raid.escort,
      approx: false,
      altFt: Math.max(100, Math.round(raid.alt / 0.3048 / 100) * 100),
      altM: raid.alt,
      heading: raid.heading,
      exact: true,
    };
  }
  const plots = visiblePlots(world, contact);
  if (!plots.length) return null;
  const last = plots[plots.length - 1];
  let vx = 0;
  let vy = 0;
  // Velocity from a plot at least 3 minutes older, when there is one.
  for (let i = plots.length - 2; i >= 0; i--) {
    const dt = last.t - plots[i].t;
    if (dt >= 180) {
      vx = (last.x - plots[i].x) / dt;
      vy = (last.y - plots[i].y) / dt;
      break;
    }
  }
  const speed = Math.hypot(vx, vy);
  // The plotters average the heights of the last few plots.
  const recent = plots.slice(-3);
  const altFt = Math.round(recent.reduce((sum, p) => sum + p.altFt, 0) / recent.length / 500) * 500;
  return {
    x: last.x,
    y: last.y,
    vx,
    vy,
    count: last.count,
    approx: last.approx,
    altFt,
    altM: altFt * 0.3048,
    heading: speed > 0.01 ? ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360 : null,
    exact: false,
    source: last.source,
    age: world.t - last.t,
  };
}

/** Uncertainty (1 sigma, feet) of the estimated height of a contact. */
export function altitudeSigmaFt(world, est) {
  if (!est || est.exact) return 0;
  const D = world.rules.detection;
  const mode = D.modes[world.settings.detection] || D.modes.approximate;
  const k = est.source === 'observers' ? D.observerAccuracy : 1;
  return (mode.altSigmaM * k) / 0.3048;
}

/**
 * Nearest raid on the table to (x, y): { est, contact, raid } or null. Raids heading home
 * are skipped unless `includeOutbound` is set.
 */
export function nearestContact(world, x, y, includeOutbound = false) {
  let best = null;
  let bestD = Infinity;
  for (const contact of world.contacts.values()) {
    const est = contactEstimate(world, contact);
    if (!est) continue;
    const raid = world.raids.find((r) => r.id === contact.raidId);
    if (!includeOutbound && raid && raid.phase === 'outbound' && !raid.phantom) continue;
    const d = Math.hypot(est.x - x, est.y - y);
    if (d < bestD) {
      bestD = d;
      best = { est, contact, raid, km: d };
    }
  }
  return best;
}
