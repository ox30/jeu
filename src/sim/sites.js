// Installations: aerodromes, radar stations, ports and factories. Bombs damage them (0 to
// 100 %); a damaged installation works more slowly, a badly damaged one is out of service,
// and repair crews bring it back over the hours that follow.

import { emit } from './events.js';

export const SITE_KINDS = ['airfield', 'radar', 'port', 'factory'];

export function siteKey(kind, id) {
  return `${kind}:${id}`;
}

/** Adds the state shared by every installation to a placed scenario item. */
export function initSite(site, kind) {
  site.kind = kind;
  site.key = siteKey(kind, site.id);
  site.damage = 0;
  site.attacks = [];
  site.wasOut = false;
  return site;
}

export function siteRules(world, site) {
  return world.rules.sites[site.kind];
}

/** 'intact', 'damaged' or 'out' (out of service). */
export function siteStatus(world, site) {
  if (site.damage >= siteRules(world, site).outAt) return 'out';
  if (site.damage >= 1) return 'damaged';
  return 'intact';
}

export function isOperational(world, site) {
  return siteStatus(world, site) !== 'out';
}

/** Share of normal capacity still available (1 when intact, 0 when out of service). */
export function capacityFactor(world, site) {
  if (!isOperational(world, site)) return 0;
  return Math.max(0, 1 - site.damage / 100);
}

/** Take-offs and refuelling take longer on a cratered aerodrome. */
export function airfieldDelayFactor(world, field) {
  return 1 + field.damage / 50;
}

/** A damaged radar sees less far. */
export function radarRangeFactor(world, radar) {
  if (!isOperational(world, radar)) return 0;
  return 1 - radar.damage / 120;
}

export function severityOf(points) {
  if (points < 15) return 'light';
  if (points < 40) return 'moderate';
  return 'heavy';
}

/** Applies `points` of damage from a raid and records the attack. Returns the damage added. */
export function damageSite(world, site, points, raidLabel) {
  const before = site.damage;
  site.damage = Math.min(100, site.damage + points);
  const added = site.damage - before;
  site.attacks.push({ t: world.t, raid: raidLabel, damage: Math.round(added) });
  const out = !isOperational(world, site);
  emit(world, 'siteHit', {
    raid: raidLabel,
    site: site.key,
    siteName: site.name,
    siteKind: site.kind,
    x: site.x,
    y: site.y,
    damage: Math.round(site.damage),
    severity: severityOf(added),
    out,
  });
  if (out && !site.wasOut) {
    site.wasOut = true;
    emit(world, 'siteOut', { site: site.key, siteName: site.name, siteKind: site.kind });
  }
  return added;
}

/** Repair crews at work: called every minute of game time. */
export function repairSites(world, dt) {
  for (const site of world.sites.values()) {
    if (site.damage <= 0) continue;
    site.damage = Math.max(0, site.damage - (siteRules(world, site).repairPerHour * dt) / 3600);
    if (site.wasOut && isOperational(world, site)) {
      site.wasOut = false;
      emit(world, 'siteRestored', { site: site.key, siteName: site.name, siteKind: site.kind });
    }
  }
}

/** Nearest aerodrome in service, other than `exceptId` when given. */
export function nearestOperationalAirfield(world, x, y, exceptId = null) {
  let best = null;
  let bestD = Infinity;
  for (const f of world.airfields) {
    if (f.id === exceptId || !isOperational(world, f)) continue;
    const d = Math.hypot(f.x - x, f.y - y);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}
