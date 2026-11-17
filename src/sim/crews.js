// Pilots and their fatigue. A squadron at readiness on the ground tires; one stood down
// rests. Every hour in the air and every round of combat tires it more, and a tired
// squadron fights less well. In Réaliste pilots are killed with their aircraft, more often
// over the sea, and replacements come from the training units after some hours.

import { emit } from './events.js';

export const ALERT_STATES = ['rest', 'available', 'cockpit'];

export function fatigueOn(world) {
  return world.settings.fatigue === 'on' || world.settings.fatigue === 'losses';
}

export function pilotLossesOn(world) {
  return world.settings.fatigue === 'losses';
}

/** Aircraft a squadron can put in the air: no more than it has pilots for (Réaliste). */
export function strength(world, s) {
  return pilotLossesOn(world) ? Math.max(0, Math.min(s.aircraft, s.pilots)) : s.aircraft;
}

/** Combat efficiency of a squadron (1 when fresh, less when tired). */
export function formFactor(world, s) {
  if (!fatigueOn(world)) return 1;
  const C = world.rules.crews;
  return 1 - C.effectAtMax * Math.pow(Math.min(100, s.fatigue) / 100, 1.5);
}

/** Extra risk of losses for a tired squadron (1 when fresh). */
export function lossFactor(world, s) {
  if (!fatigueOn(world)) return 1;
  return 1 + world.rules.crews.lossesAtMax * Math.min(100, s.fatigue) / 100;
}

/** "fresh", "tired" or "exhausted". */
export function fatigueLevel(world, s) {
  const C = world.rules.crews;
  if (s.fatigue >= C.exhaustedAt) return 'exhausted';
  if (s.fatigue >= C.tiredAt) return 'tired';
  return 'fresh';
}

/** Seconds for a squadron to get off the ground at its alert state, or null if stood down. */
export function scrambleSeconds(world, s) {
  if (!fatigueOn(world)) return world.rules.squadron.scrambleSeconds;
  return world.rules.crews.alert[s.alert || 'available'].scrambleS;
}

export function tire(world, s, points) {
  if (!fatigueOn(world)) return;
  s.fatigue = Math.max(0, Math.min(100, s.fatigue + points));
}

/** Pilots killed with `lost` aircraft shot down at (x, y): more of them over the sea. */
export function pilotsKilled(world, s, lost, x, y) {
  if (!lost || !pilotLossesOn(world)) return 0;
  const C = world.rules.crews;
  const p = world.terrain.isLand(x, y) ? C.pilotKilledOverLand : C.pilotKilledOverSea;
  const killed = Math.min(s.pilots, world.rng.binomial(lost, p));
  s.pilots -= killed;
  world.stats.pilotsKilled += killed;
  return killed;
}

export function createCrews(world, def) {
  world.pilots = {
    pool: def ? def.pool ?? 0 : 0,
    perDay: def ? def.perDay ?? 0 : 0,
    pending: [], // { squadronId, count, eta }
  };
}

function updateFatigue(world, s, dt) {
  const C = world.rules.crews;
  const flying = s.state === 'airborne' || s.state === 'combat' || s.state === 'returning' || s.state === 'scrambling';
  let perHour;
  if (flying) perHour = C.fatiguePerFlightHour;
  else if (s.state === 'lost') return;
  else perHour = C.alert[s.alert || 'available'].fatiguePerHour;
  const before = fatigueLevel(world, s);
  s.fatigue = Math.max(0, Math.min(100, s.fatigue + (perHour * dt) / 3600));
  const after = fatigueLevel(world, s);
  if (after !== before && after !== 'fresh' && (before === 'fresh' || after === 'exhausted')) {
    emit(world, after === 'exhausted' ? 'squadronExhausted' : 'squadronTired', { squadron: s.name, squadronId: s.id, n: Math.round(s.fatigue) });
  }
}

function replacePilots(world, dt) {
  const P = world.pilots;
  P.pool += (P.perDay * dt) / 86400;
  if (world.t % 3600 === 0) {
    for (const s of world.squadrons) {
      const coming = P.pending.filter((x) => x.squadronId === s.id).reduce((n, x) => n + x.count, 0);
      const missing = s.aircraftStart - s.pilots - coming;
      const n = Math.min(missing, Math.floor(P.pool), 4);
      if (n <= 0) continue;
      P.pool -= n;
      P.pending.push({ squadronId: s.id, count: n, eta: world.t + world.rules.crews.replacementHours * 3600 });
    }
  }
  P.pending = P.pending.filter((x) => {
    if (world.t < x.eta) return true;
    const s = world.squadrons.find((q) => q.id === x.squadronId);
    if (s) {
      s.pilots = Math.min(s.aircraftStart + 2, s.pilots + x.count);
      emit(world, 'pilotsArrived', { squadron: s.name, squadronId: s.id, count: x.count });
    }
    return false;
  });
}

/** Once a minute of game time. */
export function updateCrews(world, dt) {
  if (fatigueOn(world)) for (const s of world.squadrons) updateFatigue(world, s, dt);
  if (pilotLossesOn(world)) replacePilots(world, dt);
}
