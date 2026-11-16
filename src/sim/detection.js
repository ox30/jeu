// What the controller knows. Chain Home radars look out to sea; once a raid is over land the
// Observer Corps takes over. Every minute each detected raid gives a "plot": a position, an
// estimated number of aircraft and an estimated height, more or less accurate depending on
// the detection setting, sometimes shown late.

import { FOOT_M, bearing, distance, headingDiff } from './geo.js';
import { clockColorIndex } from '../core/time.js';
import { emit } from './events.js';
import { isActive, raidStrength } from './raid.js';
import { describeLocation } from './places.js';
import { radarRangeFactor } from './sites.js';

/** 'radar', 'observers' or null. */
export function sense(world, r) {
  const D = world.rules.detection;
  for (const s of world.radars) {
    const factor = radarRangeFactor(world, s);
    if (factor <= 0) continue;
    const range = Math.min(D.radarMaxRangeKm, D.radarMinRangeKm + D.radarRangePerM * r.alt) * factor;
    if (distance(s.x, s.y, r.x, r.y) > range) continue;
    if (Math.abs(headingDiff(s.azimuth, bearing(s.x, s.y, r.x, r.y))) > D.radarHalfArcDeg) continue;
    return 'radar';
  }
  if (r.alt <= D.observerMaxAltM && world.terrain.isOverBritain(r.x, r.y)) return 'observers';
  return null;
}

function makePlot(world, r, source) {
  const D = world.rules.detection;
  const mode = D.modes[world.settings.detection] || D.modes.approximate;
  const rng = world.rng;
  const k = source === 'observers' ? D.observerAccuracy : 1;
  const sigma = mode.posSigmaKm * k;
  const total = raidStrength(r);
  const count = mode.countError
    ? Math.max(1, Math.round(total * (1 + rng.range(-mode.countError, mode.countError / 2))))
    : total;
  const alt = r.alt + (mode.altSigmaM ? rng.gauss() * mode.altSigmaM * k : 0);
  const delay = mode.delayS[1] > 0 ? Math.round(rng.range(mode.delayS[0], mode.delayS[1])) : 0;
  return {
    t: world.t,
    visibleAt: world.t + delay,
    x: r.x + (sigma ? rng.gauss() * sigma : 0),
    y: r.y + (sigma ? rng.gauss() * sigma : 0),
    count,
    approx: mode.countError > 0,
    altFt: Math.max(500, Math.round(alt / FOOT_M / 500) * 500),
    source,
    color: clockColorIndex(world.startMs + world.t * 1000),
  };
}

/** Called once a minute of game time. */
export function updateDetection(world) {
  const D = world.rules.detection;
  for (const r of world.raids) {
    let contact = world.contacts.get(r.id);
    const source = isActive(r) && (!r.phantom || world.settings.falseAlarms) ? sense(world, r) : null;
    if (!source) {
      if (contact && !contact.lost && world.t - contact.lastSeen > D.lostAfterS) {
        contact.lost = true;
        emit(world, 'contactLost', { raid: contact.label, raidId: r.id });
      }
      continue;
    }
    if (!contact) {
      contact = { raidId: r.id, label: r.label, plots: [], firstSeen: world.t, lastSeen: world.t, lost: false, alerted: false };
      world.contacts.set(r.id, contact);
    }
    contact.plots.push(makePlot(world, r, source));
    contact.lastSeen = world.t;
    contact.lost = false;
    while (contact.plots.length && world.t - contact.plots[0].t > D.plotLifetimeS) contact.plots.shift();
  }
}

/** Raises the alert as soon as the first plot of a new contact reaches the table. */
export function checkAlerts(world) {
  for (const c of world.contacts.values()) {
    if (c.alerted) continue;
    const plot = c.plots.find((p) => p.visibleAt <= world.t);
    if (!plot) continue;
    c.alerted = true;
    emit(world, 'raidDetected', {
      raid: c.label,
      raidId: c.raidId,
      count: plot.count,
      approx: plot.approx,
      altFt: plot.altFt,
      location: describeLocation(world, plot.x, plot.y),
    });
  }
}
