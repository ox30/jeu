// Pilots and their fatigue. A squadron at readiness on the ground tires; one stood down
// rests. Every hour in the air and every round of combat tires it more, and a tired
// squadron fights less well. In Réaliste pilots are killed with their aircraft, more often
// over the sea, and replacements come from the training units after some hours.

import { emit } from './events.js';
import { declareFields } from './entities.js';

// A recall under way (the alert state itself is the scenario's: createSquadron).
declareFields('squadron', (s) => {
  s.alertAt = null; // when the new state holds
  s.alertFrom = null; // the state it holds until then
  s.alertLong = false;
});

// Readiness on the ground, from the lowest: at rest (the pilots may be anywhere: two hours to
// get them back), available (30 min), at readiness (5 min), in the cockpit (2 min). The delay
// of a state is the time it takes to be in the air from it; raising the readiness takes the
// difference (from rest to readiness: 1 h 55), lowering it is immediate.
export const ALERT_STATES = ['rest', 'min30', 'min5', 'cockpit'];

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

function alertDelay(world, state) {
  return world.rules.crews.alert[state || 'min5'].scrambleS;
}

/** The alert state the squadron is really at now: until a recall is over, the one before. */
export function effectiveAlert(world, s) {
  if (s.alertAt !== null && s.alertAt !== undefined && world.t < s.alertAt) return s.alertFrom || 'rest';
  return s.alert || 'min5';
}

/** Seconds from now until the squadron can be in the air (a recall under way included). */
export function scrambleSeconds(world, s) {
  if (!fatigueOn(world)) return world.rules.squadron.scrambleSeconds;
  const pending = s.alertAt !== null && s.alertAt !== undefined && world.t < s.alertAt ? s.alertAt - world.t : 0;
  return pending + alertDelay(world, s.alert);
}

/** A new alert state: a lower readiness at once, a higher one once the time it takes is past. */
export function changeAlert(world, s, state) {
  if (!ALERT_STATES.includes(state)) return false;
  const now = scrambleSeconds(world, s);
  const target = alertDelay(world, state);
  if (!fatigueOn(world) || target >= now) {
    s.alert = state;
    s.alertAt = null;
    s.alertFrom = null;
    return true;
  }
  s.alertFrom = effectiveAlert(world, s);
  s.alert = state;
  s.alertAt = world.t + (now - target);
  s.alertLong = now - target >= 600; // a recall worth telling the player when it is over
  return true;
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
  else perHour = C.alert[effectiveAlert(world, s)].fatiguePerHour;
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

/** A recall (or a raise of readiness) over: the new state holds from now. */
function settleAlert(world, s) {
  if (s.alertAt === null || s.alertAt === undefined || world.t < s.alertAt) return;
  s.alertAt = null;
  s.alertFrom = null;
  if (s.alertLong) emit(world, 'alertReached', { squadron: s.name, squadronId: s.id, alert: s.alert });
  s.alertLong = false;
}

/** Once a minute of game time. */
export function updateCrews(world, dt) {
  if (fatigueOn(world)) {
    for (const s of world.squadrons) {
      settleAlert(world, s);
      updateFatigue(world, s, dt);
    }
  }
  if (pilotLossesOn(world)) replacePilots(world, dt);
}
