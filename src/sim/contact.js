// Direct contact. An enemy seen by one of the player's units is followed live on the table,
// with its real numbers, until it is lost from sight: a raid seen by a squadron or a patrol
// in the air, by a convoy or an escort group at sea, or by an installation it flies over or
// bombs; a U-boat seen by an escort (lookouts, radar, ASDIC) or by a patrol aircraft (eye,
// ASV radar). Radar and the Observer Corps, who report by plots, then take over again; a
// U-boat lost from sight leaves a plot where it was last seen, from which its circles grow.

import { distance, unproject } from './geo.js';
import { emit } from './events.js';
import { isActive } from './raid.js';
import { isPatrol, sightKm } from './patrols.js';
import { isDaylight } from './daylight.js';
import { isSubmerged } from './asw.js';

function flying(s) {
  return (s.state === 'airborne' || s.state === 'returning' || s.state === 'combat') && s.aircraft > 0;
}

function atSea(e) {
  return e.state === 'escorting' || e.state === 'atSea' || e.state === 'hunting' || e.state === 'returning';
}

/** The player's unit that sees raid `r` now, or null (the one already watching is kept a little longer). */
export function raidObserver(world, r) {
  const V = world.rules.visual;
  const gap = world.rules.patrolRules.heightGapM;
  const day = isDaylight(world, r.x, r.y); // the light where the raid is
  const keep = (id) => (r.seen && r.seen.byId === id ? V.keepFactor : 1);
  let best = null;
  for (const s of world.squadrons) {
    if (s.aircraft <= 0) continue;
    if (s.state === 'combat' && s.engagedRaid === r.id) return { by: s.name, byId: s.id, kind: 'squadron' };
    if (!flying(s)) continue;
    let range = (isPatrol(s) ? sightKm(world, s) : day ? V.airDayKm : V.airNightKm) * keep(s.id);
    // Far above or below, a formation is hard to see.
    if (Math.abs(s.alt - r.alt) > gap) range /= 2;
    const d = distance(s.x, s.y, r.x, r.y);
    if (d <= range && (!best || d < best.d)) best = { d, by: s.name, byId: s.id, kind: 'squadron' };
  }
  if (best) return { by: best.by, byId: best.byId, kind: best.kind };
  // Ships at sea: the convoys' and escorts' lookouts.
  const sea = day ? V.seaDayKm : V.seaNightKm;
  for (const c of world.convoys) {
    if (c.state !== 'atSea' || c.ships <= 0) continue;
    if (distance(c.x, c.y, r.x, r.y) <= sea * keep(c.id)) return { by: c.name, byId: c.id, kind: 'convoy' };
  }
  for (const e of world.escorts) {
    if (!atSea(e)) continue;
    if (distance(e.x, e.y, r.x, r.y) <= sea * keep(e.id)) return { by: e.name, byId: e.id, kind: 'escort' };
  }
  // Installations: the one the raid bombs, or one it flies close to.
  if (r.phase === 'bombing') {
    const target = world.sites.get(r.target);
    if (target && !target.foreign) return { by: target.name, byId: target.key, kind: 'site' };
  }
  const ground = day ? V.siteDayKm : V.siteNightKm;
  if (ground > 0) {
    for (const site of world.sites.values()) {
      if (site.foreign) continue;
      if (distance(site.x, site.y, r.x, r.y) <= ground * keep(site.key)) return { by: site.name, byId: site.key, kind: 'site' };
    }
  }
  return null;
}

function raidForce(r) {
  return { bombers: r.bombers, bomberType: r.bomberType, escort: r.escort, escortType: r.escortType };
}

function loseRaid(world, r) {
  const by = r.seen.by;
  r.seen = null;
  if (isActive(r)) emit(world, 'raidSightLost', { raid: r.label, raidId: r.id, by });
}

/** Keeps a U-boat already seen by `obs` in sight? (no dice: a contact held is kept). */
function uboatHeld(world, u, obs) {
  const A = world.rules.asw;
  const k = world.rules.visual.keepFactor;
  const day = isDaylight(world, u.x, u.y);
  const under = isSubmerged(world, u);
  if (obs.kind === 'escort') {
    const e = world.escorts.find((x) => x.id === obs.byId);
    if (!e || !atSea(e)) return false;
    const d = distance(e.x, e.y, u.x, u.y);
    if (d <= A.asdicKm * k) return true;
    if (under) return false;
    if (d <= (day ? A.lookoutDayKm : A.lookoutNightKm) * k) return true;
    const radar = world.scenario.escortRadar ? A.radar : null;
    return Boolean(radar && d <= radar.surfaceKm * k);
  }
  if (obs.kind === 'squadron') {
    const s = world.squadrons.find((x) => x.id === obs.byId);
    if (!s || !flying(s) || under) return false;
    const spec = world.rules.patrols[s.type];
    if (!spec) return false;
    const d = distance(s.x, s.y, u.x, u.y);
    if (day && d <= spec.uboatSightKm * k) return true;
    return Boolean(s.asv && spec.asvKm && d <= spec.asvKm * k);
  }
  return false;
}

/** Another unit that can take over the contact (an escort close enough for its ASDIC). */
function uboatHandover(world, u) {
  const A = world.rules.asw;
  for (const e of world.escorts) {
    if (!atSea(e)) continue;
    if (distance(e.x, e.y, u.x, u.y) <= A.asdicKm) return { by: e.name, byId: e.id, kind: 'escort', how: 'asdic' };
  }
  return null;
}

/** A U-boat seen by `obs` ({ by, byId, kind, how }): the contact starts, or changes hands. */
export function seeUboat(world, u, obs) {
  if (u.state === 'sunk' || u.state === 'gone') return;
  if (u.seen) Object.assign(u.seen, obs, { since: u.seen.since });
  else u.seen = { ...obs, since: world.t };
}

/**
 * The table keeps one plot per U-boat: a new fix moves it (same marker, fresh circles from the
 * new time) instead of piling up a pair of growing circles every ten minutes of a hunt.
 */
export function putPlot(world, u, fields) {
  let plot = world.uboatPlots.find((p) => p.uboatId === u.id);
  if (plot) {
    for (const k of Object.keys(plot)) if (k !== 'id' && k !== 'uboatId') delete plot[k];
    Object.assign(plot, fields);
  } else {
    plot = { id: `P${world.nextPlotId++}`, uboatId: u.id, ...fields };
    world.uboatPlots.push(plot);
  }
  return plot;
}

/** A U-boat sunk: its plot leaves the table, and nobody tracks it any more. */
export function forgetUboat(world, u) {
  world.uboatPlots = world.uboatPlots.filter((p) => p.uboatId !== u.id);
  u.seen = null;
}

function loseUboat(world, u) {
  const obs = u.seen;
  u.seen = null;
  if (u.state === 'sunk' || u.state === 'gone') return;
  // The last position seen goes on the table as an exact plot: its circles grow from now.
  const plot = putPlot(world, u, { x: u.x, y: u.y, t: world.t, source: obs.how || 'seen', by: obs.by, byId: obs.byId, submerged: isSubmerged(world, u), lastSeen: true });
  const [lon, lat] = unproject(u.x, u.y);
  emit(world, 'uboatContactLost', { by: obs.by, byId: obs.byId, plotId: plot.id, x: u.x, y: u.y, lat, lon });
}

/** Every few seconds: who sees which raid and which U-boat. */
export function updateContacts(world) {
  for (const r of world.raids) {
    if (r.phantom || !isActive(r)) {
      if (r.seen) loseRaid(world, r);
      continue;
    }
    const obs = raidObserver(world, r);
    if (obs && !r.seen) {
      r.seen = { ...obs, since: world.t };
      emit(world, 'raidSighted', {
        raid: r.label, raidId: r.id, ...obs, ...raidForce(r), altFt: Math.round(r.alt / 0.3048 / 500) * 500, x: r.x, y: r.y,
      });
    } else if (obs) {
      Object.assign(r.seen, obs);
    } else if (r.seen) {
      loseRaid(world, r);
    }
  }
  for (const u of world.uboats) {
    if (!u.seen) continue;
    if (u.state === 'sunk' || u.state === 'gone') {
      u.seen = null;
      continue;
    }
    if (uboatHeld(world, u, u.seen)) continue;
    const other = uboatHandover(world, u);
    if (other) seeUboat(world, u, other);
    else loseUboat(world, u);
  }
}
