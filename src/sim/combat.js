// Interceptions and air combat. Combat is resolved in one-minute rounds with simple odds:
// the escort keeps part of the squadron busy, height advantage helps the first pass, and a
// raid that takes losses may turn back. A squadron that passes a raid without seeing it is
// told how far off it was, and every fight ends with a combat report.

import { bearing, distance, octant } from './geo.js';
import { emit } from './events.js';
import { abortRaid, isActive, raidStrength } from './raid.js';
import { startReturn } from './squadron.js';
import { endGuidance } from './control.js';
import { formFactor, lossFactor, pilotsKilled, strength, tire } from './crews.js';
import { aircraftSpec } from './squadron.js';
import { askClearance, engagementCall, questionsOn, seesRaid } from './engagement.js';

/** Why a squadron cannot engage a raid at this distance and height difference, or null. */
export function engageProblem(world, km, dzM) {
  const R = world.rules.squadron;
  const wide = km > R.engageRangeKm;
  const low = dzM < -R.engageBelowM;
  const high = dzM > R.engageAboveM;
  if (!wide && !low && !high) return null;
  if (wide && low) return 'wideBelow';
  if (wide && high) return 'wideAbove';
  if (wide) return 'wide';
  return low ? 'below' : 'above';
}

/**
 * Starts combat for every airborne squadron that meets a raid its orders let it attack. A
 * raid it sees but may not attack (its standing order, a raid going home, mid-Channel)
 * brings a question to the player (engagement.js).
 */
export function checkEngagements(world) {
  const R = world.rules.squadron;
  const sight = Math.max(world.rules.visual.airDayKm, R.engageRangeKm);
  for (const s of world.squadrons) {
    if (s.state !== 'airborne' || s.ammo <= 0.05 || s.role !== 'fighter') continue;
    for (const r of world.raids) {
      if (!isActive(r)) continue;
      const d = distance(s.x, s.y, r.x, r.y);
      if (d > sight) continue;
      if (r.phantom) {
        if (d <= R.engageRangeKm && !s.nothingSeen.has(r.id)) {
          s.nothingSeen.add(r.id);
          emit(world, 'nothingSeen', { squadron: s.name, squadronId: s.id, raid: r.label, raidId: r.id, x: s.x, y: s.y });
        }
        continue;
      }
      const call = engagementCall(world, s, r);
      if (!call.engage) {
        if (call.ask && seesRaid(world, s, r)) askClearance(world, call.ask, s, r);
        continue;
      }
      if (d > R.engageRangeKm) continue;
      const dz = s.alt - r.alt;
      if (dz < -R.engageBelowM || dz > R.engageAboveM) continue;
      engage(world, s, r, dz);
      break;
    }
  }
}

/**
 * Watches every raid a flying squadron comes near. When the distance starts growing again
 * without a fight, the squadron has missed it: the closest approach is reported.
 */
export function checkMisses(world) {
  const R = world.rules.squadron;
  for (const s of world.squadrons) {
    if (s.state !== 'airborne') {
      if (s.state !== 'combat') s.watch.clear();
      continue;
    }
    for (const r of world.raids) {
      // A raid the player called it off is not a miss: it left it on purpose.
      if (r.phantom || s.letGo.has(r.id)) {
        s.watch.delete(r.id);
        continue;
      }
      const d = distance(s.x, s.y, r.x, r.y);
      let w = s.watch.get(r.id);
      if (!isActive(r) || r.phase === 'outbound') {
        if (w) s.watch.delete(r.id);
        continue;
      }
      if (d > R.watchKm) {
        if (w) s.watch.delete(r.id);
        continue;
      }
      if (!w) {
        w = { best: Infinity, reported: false };
        s.watch.set(r.id, w);
      }
      if (w.reported) continue;
      if (d < w.best) {
        Object.assign(w, { best: d, t: world.t, sx: s.x, sy: s.y, salt: s.alt, rx: r.x, ry: r.y, ralt: r.alt });
      } else if (d > w.best + R.missHysteresisKm) {
        w.reported = true;
        const dz = w.salt - w.ralt;
        const guided = s.intercept && s.intercept.raidId === r.id ? s.intercept : null;
        if (guided) endGuidance(world, s);
        emit(world, 'missed', {
          guided: guided ? guided.p : null,
          squadron: s.name,
          squadronId: s.id,
          raid: r.label,
          raidId: r.id,
          km: w.best,
          dir: octant(bearing(w.sx, w.sy, w.rx, w.ry)),
          dzM: dz,
          problem: engageProblem(world, w.best, dz) || 'wide',
          sx: w.sx,
          sy: w.sy,
          salt: w.salt,
          rx: w.rx,
          ry: w.ry,
          ralt: w.ralt,
        });
      }
    }
  }
}

function engage(world, s, r, dz) {
  s.state = 'combat';
  s.engagedRaid = r.id;
  s.combatTimer = world.rules.combat.roundSeconds;
  s.heightAdvantage = dz >= world.rules.squadron.heightAdvantageM;
  s.firstPass = true;
  s.route = [];
  s.plan = [];
  s.legState = null;
  s.vector = null;
  s.orbit = false;
  s.intercept = null;
  s.watch.delete(r.id);
  r.engagedBy.add(s.id);
  s.engagement = {
    raidId: r.id,
    raid: r.label,
    startT: world.t,
    above: s.heightAdvantage,
    dzM: dz,
    bombersDown: 0,
    fightersDown: 0,
    losses: 0,
    bomberType: r.bomberType,
    escortType: r.escortType,
  };
  if (!r.intercepted && !r.bombed && (r.phase === 'assembling' || r.phase === 'inbound')) {
    r.intercepted = true;
    world.stats.raidsIntercepted++;
  }
  emit(world, 'tallyHo', {
    squadron: s.name,
    squadronId: s.id,
    raid: r.label,
    raidId: r.id,
    count: raidStrength(r),
    above: s.heightAdvantage,
    x: r.x,
    y: r.y,
  });
}

/** Ends the fight record of a squadron and publishes its combat report. */
function report(world, s, r, end) {
  const e = s.engagement;
  if (!e) return;
  s.engagement = null;
  let outcome = 'continues';
  if (r && r.destroyed) outcome = 'destroyed';
  else if (r && r.repelled) outcome = 'repelled';
  else if (r && r.phase === 'outbound') outcome = 'homeward';
  const data = {
    squadron: s.name,
    squadronId: s.id,
    raid: e.raid,
    raidId: e.raidId,
    startT: e.startT,
    endT: world.t,
    above: e.above,
    bombersDown: e.bombersDown,
    fightersDown: e.fightersDown,
    losses: e.losses,
    bomberType: e.bomberType,
    escortType: e.escortType,
    aircraftType: s.type,
    outcome,
    end,
  };
  s.lastReport = data;
  emit(world, 'combatReport', data);
}

/** Ends combat for a squadron, which keeps flying on its current heading. */
export function disengage(world, s, announce = true, end = 'order') {
  const r = world.raids.find((raid) => raid.id === s.engagedRaid);
  if (r) r.engagedBy.delete(s.id);
  s.engagedRaid = null;
  if (s.state === 'combat') {
    s.state = 'airborne';
    // After a fight the squadron circles where it is and waits for orders, rather than
    // flying on toward France.
    if (end === 'order') s.vector = s.heading;
    else {
      s.vector = null;
      s.orbit = true;
    }
  }
  if (announce && r) emit(world, 'disengage', { squadron: s.name, squadronId: s.id, raid: r.label, raidId: r.id });
  report(world, s, r, end);
}

export function updateCombat(world, dt) {
  for (const s of world.squadrons) {
    if (s.breakOff) {
      // Refused leave to go on beyond mid-Channel: it breaks off and goes home.
      const raidId = s.breakOff;
      s.breakOff = null;
      if (s.state === 'combat' && s.engagedRaid === raidId) disengage(world, s, true, 'midChannel');
      if (s.state === 'airborne') {
        startReturn(world, s, 'order');
        emit(world, 'brokeOff', { squadron: s.name, squadronId: s.id, raidId });
      }
    }
    if (s.state !== 'combat') {
      // Left the fight another way (fuel, ordered home): the report still goes out.
      if (s.engagement) report(world, s, world.raids.find((raid) => raid.id === s.engagement.raidId), s.returnReason || 'order');
      continue;
    }
    const r = world.raids.find((raid) => raid.id === s.engagedRaid);
    if (!r || !isActive(r)) {
      disengage(world, s, false, 'raidGone');
      continue;
    }
    s.combatTimer -= dt;
    if (s.combatTimer > 0) continue;
    s.combatTimer = world.rules.combat.roundSeconds;
    combatRound(world, s, r);
  }
}

export function combatRound(world, s, r) {
  const C = world.rules.combat;
  const rng = world.rng;
  const type = aircraftSpec(world, s.type);
  const bomberType = world.rules.bombers[r.bomberType] || { vulnerability: 1 };
  const escortType = world.rules.escorts[r.escortType] || { threat: 1 };
  const form = formFactor(world, s);
  const risk = lossFactor(world, s);

  const ours = strength(world, s);
  // The escort is shared out among all the squadrons on the raid: a big formation spreads it.
  let together = 0;
  for (const other of world.squadrons) if (other.engagedRaid === r.id) together += strength(world, other);
  together = Math.max(ours, together);
  const pressure = r.escort > 0 ? Math.min(C.escortPressureMax, r.escort / (together + r.escort)) : 0;
  const sweep = r.bombersStart === 0;
  const onBombers = sweep ? 0 : Math.round(ours * (1 - pressure * C.escortPressureWeight));
  const onEscort = ours - onBombers;
  const bonus = s.heightAdvantage && s.firstPass ? C.heightBonus : 1;
  s.firstPass = false;

  const bombersDown = Math.min(
    r.bombers,
    rng.binomial(onBombers, C.pKillBomber * bonus * form * type.vsBombers * bomberType.vulnerability),
  );
  const fightersDown = Math.min(r.escort, rng.binomial(onEscort, C.pKillEscort * bonus * form * type.vsFighters));
  const engagedEscort = Math.min(r.escort, ours);
  const losses = Math.min(
    ours,
    rng.binomial(engagedEscort, (C.pLossVsEscort * escortType.threat * risk) / type.vsFighters) +
      rng.binomial(onBombers, C.pLossVsGunners * risk),
  );

  r.bombers -= bombersDown;
  r.escort -= fightersDown;
  s.aircraft -= losses;
  const killed = pilotsKilled(world, s, losses, r.x, r.y);
  tire(world, s, world.rules.crews.fatiguePerCombatRound);
  s.ammo = Math.max(0, s.ammo - C.ammoPerRound);
  world.stats.bombersDown += bombersDown;
  world.stats.fightersDown += fightersDown;
  world.stats.rafLost += losses;
  if (s.engagement) {
    s.engagement.bombersDown += bombersDown;
    s.engagement.fightersDown += fightersDown;
    s.engagement.losses += losses;
  }

  emit(world, 'combatRound', {
    squadron: s.name,
    squadronId: s.id,
    raid: r.label,
    raidId: r.id,
    bombersDown,
    fightersDown,
    losses,
    killed,
    bomberType: r.bomberType,
    escortType: r.escortType,
    aircraftType: s.type,
    x: r.x,
    y: r.y,
    alt: r.alt,
  });

  if (raidStrength(r) <= 0) {
    r.phase = 'done';
    r.destroyed = true;
    emit(world, 'raidDestroyed', { raid: r.label, raidId: r.id, x: r.x, y: r.y });
    for (const other of world.squadrons) if (other.engagedRaid === r.id) disengage(world, other, false, 'destroyed');
  } else if (r.phase !== 'outbound') {
    // A fighter sweep breaks off on its losses; a bomber raid on its bombers' losses.
    const lossFraction = sweep ? 1 - r.escort / Math.max(1, r.escortStart) : 1 - r.bombers / Math.max(1, r.bombersStart);
    const pAbort = C.abortBase + C.abortPerLoss * lossFraction + C.abortPerExtraSquadron * (r.engagedBy.size - 1);
    if ((!sweep && r.bombers <= 0) || rng.next() < pAbort) abortRaid(world, r);
  }

  if (s.aircraft <= 0 || strength(world, s) <= 0) {
    r.engagedBy.delete(s.id);
    s.engagedRaid = null;
    report(world, s, r, 'lost');
    s.state = 'lost';
    emit(world, 'squadronLost', { squadron: s.name, squadronId: s.id });
    return;
  }
  if (s.state !== 'combat') return; // the raid was destroyed
  if (s.ammo <= 0.05) {
    report(world, s, r, 'ammo');
    startReturn(world, s, 'ammo');
    emit(world, 'outOfAmmo', { squadron: s.name, squadronId: s.id, airfield: world.byId.airfield.get(s.airfield).name });
    return;
  }
  if (r.phase === 'outbound') {
    // The raid is going home: the squadron goes on only with its order or leave to.
    const call = engagementCall(world, s, r);
    if (call.engage) return;
    if (call.ask === 'beyond') {
      // Mid-Channel: it fights on while the question waits; refused or unanswered, it breaks off.
      if (askClearance(world, 'beyond', s, r)) return;
      disengage(world, s, true, 'midChannel');
      startReturn(world, s, 'order');
      emit(world, 'brokeOff', { squadron: s.name, squadronId: s.id, raidId: r.id });
      return;
    }
    disengage(world, s, true, 'homeward');
    if (questionsOn(world) && call.ask) askClearance(world, 'pursue', s, r);
  }
}

/**
 * The player calls squadrons off a raid (« Désengager H05 »): each one leaves the fight, the
 * chase or the controller's guidance onto it, loses its leave to attack it, and leaves it
 * alone whatever its standing order until an order sends it back (a line drawn onto the raid,
 * « Intercepter »). A squadron alone, or a wing's leader, circles where it is and waits for
 * orders; the wing gathers on its leader. Returns the names of the squadrons called off.
 */
export function breakOffRaid(world, squadrons, raidId) {
  const r = world.raids.find((x) => x.id === raidId);
  const names = [];
  for (const s of squadrons) {
    if (!s || s.kind !== 'squadron') continue;
    const involved = s.engagedRaid === raidId || s.attackRaid === raidId || Boolean(s.intercept && s.intercept.raidId === raidId);
    s.letGo.add(raidId);
    s.cleared.delete(raidId);
    s.clearedBeyond.delete(raidId);
    if (s.attackRaid === raidId) s.attackRaid = null;
    if (s.intercept && s.intercept.raidId === raidId) endGuidance(world, s);
    if (s.state === 'combat' && s.engagedRaid === raidId) disengage(world, s, false, 'order');
    if (involved && s.state === 'airborne' && !s.follow) {
      s.route = [];
      s.plan = [];
      s.legState = null;
      s.vector = null;
      s.orbit = true;
    }
    if (involved) names.push(s.name);
  }
  // A question still open about this raid for these squadrons no longer applies.
  const ids = new Set(squadrons.filter(Boolean).flatMap((s) => [s.id, s.formation]).filter(Boolean));
  for (const q of [...world.questions]) {
    if (q.raidId !== raidId || !q.units.some((u) => ids.has(u))) continue;
    world.questions = world.questions.filter((x) => x !== q);
    emit(world, 'questionGone', { questionId: q.id, raid: q.raid, raidId });
  }
  if (names.length) {
    emit(world, 'brokeOffOrdered', { units: names.join(', '), raid: r ? r.label : raidId, raidId, x: r ? r.x : null, y: r ? r.y : null });
  }
  return names;
}
