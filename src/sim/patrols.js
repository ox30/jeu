// Aircraft on watch. A spotter section (Spitfires flying high over the Channel, like the
// "Jim Crow" patrols) reports the raids it sees with their real numbers and height; Coastal
// Command (Ansons, Hudsons, Sunderlands) patrols the sea and the convoys, sees U-boats on
// the surface and makes them dive. Neither fights the raids, and both can be bounced by
// the German escort.

import { distance } from './geo.js';
import { emit } from './events.js';
import { isActive } from './raid.js';
import { pilotsKilled } from './crews.js';
import { isDaylight } from './daylight.js';

export function isPatrol(s) {
  return s.role === 'watch' || s.role === 'coastal';
}

function airborne(s) {
  return s.state === 'airborne' || s.state === 'returning';
}

function specOf(world, s) {
  return world.rules.patrols[s.type];
}

/** Distance at which a patrol sees aircraft now (day or night). */
export function sightKm(world, s) {
  const spec = specOf(world, s);
  return isDaylight(world, s.x, s.y) ? spec.sightDayKm : spec.sightNightKm;
}

/** A patrol in the air that sees (x, y) at height altM, or null. */
export function patrolSeeing(world, x, y, altM) {
  for (const s of world.squadrons) {
    if (!isPatrol(s) || !airborne(s) || s.aircraft <= 0) continue;
    const range = sightKm(world, s);
    if (distance(s.x, s.y, x, y) > range) continue;
    // Far above or below, a formation is hard to see: the range shrinks with the height gap.
    const gap = Math.abs(s.alt - altM);
    if (gap > world.rules.patrolRules.heightGapM && distance(s.x, s.y, x, y) > range / 2) continue;
    return s;
  }
  return null;
}

/** Once a minute: patrols that come close to an escorted raid may be bounced. */
export function updatePatrols(world) {
  const P = world.rules.patrolRules;
  for (const s of world.squadrons) {
    if (!isPatrol(s) || !airborne(s) || s.aircraft <= 0) continue;
    for (const r of world.raids) {
      if (!isActive(r) || r.phantom || r.escort <= 0) continue;
      if (distance(s.x, s.y, r.x, r.y) > P.bounceKm || Math.abs(s.alt - r.alt) > P.bounceHeightM) continue;
      const p = P.bouncePerMinute * Math.min(1, r.escort / 20) * (specOf(world, s).evasion ?? 1);
      if (world.rng.next() >= p) continue;
      s.aircraft -= 1;
      world.stats.rafLost += 1;
      pilotsKilled(world, s, 1, s.x, s.y);
      emit(world, 'patrolBounced', { squadron: s.name, squadronId: s.id, raid: r.label, raidId: r.id, left: s.aircraft, x: s.x, y: s.y });
      if (s.aircraft <= 0) {
        s.state = 'lost';
        emit(world, 'squadronLost', { squadron: s.name, squadronId: s.id });
      }
      break;
    }
  }
}
