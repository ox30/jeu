// Idea B of the audit: at sea, the zone a patrol covers rather than the aircraft. At ×3 600 a
// patrol aircraft crosses 250 km of map in a second of play while a convoy creeps 17: the
// aircraft flickers. From ×600 on, a Coastal Command patrol in the air is therefore drawn as
// what it does: the circle it watches, hatched, at a place that does not jump at each image
// (the convoy it covers, the end of its route, the point it orbits), and the way it flies
// there or home. Display only: the simulation flies the aircraft as before, and the gesture
// is the same (a line from the patrol to a convoy or to a place).
// Kept free of the page: the scene and the tests read it.

import { isDaylight } from '../sim/daylight.js';
import { distance } from '../sim/geo.js';
import { planTrack } from '../sim/orders.js';

/** From this speed on, a coastal patrol in the air is drawn as the zone it covers. */
export const ZONE_SPEED = 600;

/**
 * Is this squadron drawn as its zone now? The speed chosen decides, running or paused: the
 * image does not flip at every stop. The unit in hand keeps its aircraft, its route and its
 * handles: its orders need them. (Réglages, Carte et fiche: « Zones de patrouille ».)
 */
export function shownAsZone(app, s, selected = false) {
  return app.settings.patrolZones !== false && app.speed >= ZONE_SPEED && !selected
    && s.role === 'coastal' && s.aircraft > 0 && (s.state === 'airborne' || s.state === 'returning');
}

/**
 * The zone of a coastal patrol in the air, or null:
 *   { kind, anchor: [x, y], km, watchedKm, sightKm, sees, path: [[x, y], …], convoy, airfield }
 * `kind`: 'cover' (over a convoy), 'route' (on its way along a route or the legs of a plan),
 * 'station' (orbiting, or flying a heading with no end: the aircraft itself is the place) or
 * 'home' (on its way back).
 * `anchor`: where its mark stands. `km`: the radius of its circle around the anchor, as wide
 * as it watches by day (0: none there). `watchedKm`: what of that circle it watches now —
 * all of it by day, the short reach of its ASV radar by night, nothing by night without
 * radar. `sees`: it looks for U-boats on the surface now (not on its way home), as far as
 * `sightKm` around the aircraft. `path`: the way it flies, from the aircraft (empty when it
 * is on station).
 */
export function patrolZone(world, s) {
  const spec = world.rules.patrols[s.type];
  if (!spec || s.role !== 'coastal' || s.aircraft <= 0 || (s.state !== 'airborne' && s.state !== 'returning')) return null;
  const here = [s.x, s.y];
  if (s.state === 'returning') {
    const f = world.byId.airfield.get(s.airfield);
    return { kind: 'home', anchor: [f.x, f.y], km: 0, watchedKm: 0, sightKm: 0, sees: false, path: [here, [f.x, f.y]], convoy: null, airfield: f.id };
  }
  // What it sees of a U-boat on the surface: by eye by day, by ASV radar (sim/sight.js).
  const seeKm = Math.max(isDaylight(world, s.x, s.y) ? spec.uboatSightKm || 0 : 0, s.asv ? spec.asvKm || 0 : 0);
  const sees = seeKm > 0;
  // By night the circle keeps its size of the day; what is watched inside it shrinks to the
  // reach of the radar, or to nothing: the patrol is there, half blind or blind.
  const km = Math.max(seeKm, spec.uboatSightKm || 0);
  const atSea = (id) => world.convoys.find((c) => c.id === id && c.state === 'atSea') || null;
  const R = world.rules.squadron;
  // The way ahead: the route drawn, or the legs of a plan when the last one has an end.
  let ahead = s.route.map((p) => [p[0], p[1]]);
  if (!ahead.length && s.plan.length) {
    const track = planTrack(world, s);
    if (!track[track.length - 1].open) ahead = track.slice(1).map((p) => [p.x, p.y]);
  }
  if (ahead.length) {
    const end = ahead[ahead.length - 1];
    const a = s.endAction || { kind: 'orbit' };
    const convoy = a.kind === 'cover' ? atSea(a.id) : null;
    // At the end it goes home or lands (no circle there), covers a convoy, or orbits.
    const leaves = a.kind === 'land' || a.kind === 'home';
    const round = convoy ? R.coverRadiusKm : 0;
    return {
      kind: 'route', anchor: end, km: leaves ? 0 : km + round, watchedKm: leaves || !sees ? 0 : seeKm + round, sightKm: seeKm, sees, path: [here, ...ahead],
      convoy: convoy ? convoy.id : null, airfield: a.kind === 'land' ? a.id : null,
    };
  }
  const convoy = s.cover ? atSea(s.cover) : null;
  if (convoy) {
    const reach = km + R.coverRadiusKm;
    // Still far from the convoy: the way to it is drawn too.
    const far = distance(s.x, s.y, convoy.x, convoy.y) > reach;
    return {
      kind: 'cover', anchor: [convoy.x, convoy.y], km: reach, watchedKm: sees ? seeKm + R.coverRadiusKm : 0, sightKm: seeKm, sees,
      path: far ? [here, [convoy.x, convoy.y]] : [], convoy: convoy.id, airfield: null,
    };
  }
  return { kind: 'station', anchor: here, km, watchedKm: seeKm, sightKm: seeKm, sees, path: [], convoy: null, airfield: null };
}
