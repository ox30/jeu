// Mobile radar stations (MRU): a reduced Chain Home on lorries and trailers, kept in reserve
// to fill a gap in the chain or to stand in for a station put out of action. Deployed where
// the player chooses, facing the direction he gives, after some hours of installation.

import { project, unproject } from './geo.js';
import { emit } from './events.js';
import { initSite } from './sites.js';

export function createMru(world, def) {
  world.mru = { available: def ? def.available ?? 0 : 0, pending: [], next: 1 };
  world.mobileRadars = [];
}

/** Adds a deployed mobile station to the radar chain (also used when a game is restored). */
export function addMobileRadar(world, def) {
  const [x, y] = project(def.lon, def.lat);
  const site = initSite({ id: def.id, name: def.name, lon: def.lon, lat: def.lat, x, y, azimuth: def.azimuth, mobile: true, rangeFactor: def.rangeFactor }, 'radar');
  world.radars.push(site);
  world.sites.set(site.key, site);
  world.byId.radar.set(site.id, site);
  world.mobileRadars.push({ ...def });
  return site;
}

/** Orders a mobile station to (x, y), facing `azimuth`. Returns { ok, reason }. */
export function deployMru(world, x, y, azimuth) {
  const M = world.mru;
  const R = world.rules.mru;
  if (!M || M.available <= 0) return { ok: false, reason: 'none' };
  if (!world.terrain.isLand(x, y) || !world.terrain.isObserved(x, y, world.rules.detection.observerCellKm, 0)) return { ok: false, reason: 'place' };
  M.available--;
  const [lon, lat] = unproject(x, y);
  const n = M.next++;
  const def = { id: `mru${n}`, name: `MRU ${n}`, lon, lat, azimuth: Math.round(((azimuth % 360) + 360) % 360), rangeFactor: R.rangeFactor, readyAt: world.t + R.deployHours * 3600 };
  M.pending.push(def);
  emit(world, 'mruOrdered', { name: def.name, readyAt: def.readyAt, x, y });
  return { ok: true, def };
}

/** Once a minute: stations whose installation is finished join the chain. */
export function updateMru(world) {
  const M = world.mru;
  if (!M || !M.pending.length) return;
  M.pending = M.pending.filter((def) => {
    if (world.t < def.readyAt) return true;
    addMobileRadar(world, def);
    emit(world, 'mruReady', { name: def.name, x: project(def.lon, def.lat)[0], y: project(def.lon, def.lat)[1] });
    return false;
  });
}
