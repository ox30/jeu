// What the player's units see, as circles on the map (Réglages, Carte: "zones de vue").
// The same ranges as the detection itself: contact.js for aircraft, asw.js for U-boats.

import { isDaylight, isPatrol, sightKm } from './patrols.js';
import { isFlying } from './squadron.js';

/** Escort group states in which the group keeps watch (asw.js). */
export const WATCHING = ['escorting', 'atSea', 'hunting', 'waiting'];

/**
 * The zones a unit sees now: [{ unit, x, y, km, kind }], kind 'air' (aircraft, at the same
 * height), 'surface' (a U-boat on the surface) or 'submerged' (a U-boat under water).
 */
export function viewZones(world, u, unitKind) {
  const day = isDaylight(world);
  const zones = [];
  const add = (kind, km) => {
    if (km > 0) zones.push({ unit: u, x: u.x, y: u.y, km, kind });
  };
  if (unitKind === 'squadron') {
    if (!isFlying(u) || u.aircraft <= 0) return zones;
    const V = world.rules.visual;
    add('air', isPatrol(u) ? sightKm(world, u) : day ? V.airDayKm : V.airNightKm);
    // Coastal patrols also look for U-boats on the surface: by eye by day, by ASV radar.
    const spec = isPatrol(u) && u.role === 'coastal' && u.state === 'airborne' ? world.rules.patrols[u.type] : null;
    if (spec) add('surface', Math.max(day ? spec.uboatSightKm || 0 : 0, u.asv ? spec.asvKm || 0 : 0));
    return zones;
  }
  if (unitKind === 'escort') {
    if (!WATCHING.includes(u.state)) return zones;
    const A = world.rules.asw;
    const radar = world.scenario.escortRadar ? A.radar : null;
    add('surface', Math.max(day ? A.lookoutDayKm : A.lookoutNightKm, radar ? radar.surfaceKm : 0));
    add('submerged', Math.max(A.asdicKm, day ? A.periscopeKm : 0, radar ? radar.periscopeKm : 0));
  }
  return zones;
}

/** All the zones to draw: none, those of the units given, or those of every unit. */
export function allViewZones(world, mode, chosen = []) {
  if (mode === 'none') return [];
  if (mode === 'all') {
    return [
      ...world.squadrons.flatMap((s) => viewZones(world, s, 'squadron')),
      ...world.escorts.flatMap((e) => viewZones(world, e, 'escort')),
    ];
  }
  return chosen.flatMap(({ unit, kind }) => viewZones(world, unit, kind));
}
