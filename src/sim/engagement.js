// Rules of engagement: what a fighter squadron does when it meets the enemy, and the
// questions put to the player when its standing order does not settle it.
//  - defend: it does not engage on its own, except a raid attacking the convoy it covers;
//  - attack (the usual order): it engages the raids coming in and leaves those going home;
//  - pursue: it also follows raids home, as far as mid-Channel.
// A squadron that sees a raid its order keeps it from attacking asks for clearance: to engage,
// to pursue a raid going home, or to carry on beyond mid-Channel. A question is put once per
// raid and per unit (a formation counts as one unit); questions raised for the same raid and
// the same reason are put together. Without an answer within a minute, the answer is no.
// With the questions switched off (settings), the standing orders apply on their own.

import { bearing, distance, headingVector, project } from './geo.js';
import { emit } from './events.js';
import { isActive } from './raid.js';
import { isDaylight } from './daylight.js';
import { solveIntercept } from './intercept.js';
import { rallyAnswer } from './rally.js';

export const ROES = ['defend', 'attack', 'pursue'];
const ROE_RANK = { defend: 0, attack: 1, pursue: 2 };

export function createQuestions(world) {
  world.questions = [];
  world.nextQuestionId = 1;
  world.asked = new Set();
}

export function questionsOn(world) {
  return !world.settings || world.settings.questions !== false;
}

/**
 * A new standing order. A more cautious one replaces the leave given before (to engage, to
 * pursue, to go beyond mid-Channel): a squadron told to defend no longer goes after a raid it
 * had leave to chase. A raid it is following home now is not asked about again: it breaks
 * off at its next round of combat.
 */
export function setRoe(world, s, roe) {
  if (!ROES.includes(roe)) return false;
  const before = s.roe || 'attack';
  s.roe = roe;
  if (ROE_RANK[roe] < ROE_RANK[before]) {
    for (const id of [s.engagedRaid, s.attackRaid]) {
      const r = id ? world.raids.find((x) => x.id === id) : null;
      if (r && r.phase === 'outbound') world.asked.add(`pursue:${r.id}:${unitKey(s)}`);
    }
    s.cleared.clear();
    s.clearedBeyond.clear();
    s.attackRaid = null;
  }
  return true;
}

/** Leave to attack raid `raidId` (an answer yes, a line drawn onto it, « Intercepter »). */
export function authorize(s, raidId) {
  s.cleared.add(raidId);
  s.letGo.delete(raidId);
}

/** Does squadron `s` see raid `r` (visual range by day or night, halved for a big height gap)? */
export function seesRaid(world, s, r, factor = 1) {
  const V = world.rules.visual;
  let range = (isDaylight(world, s.x, s.y) ? V.airDayKm : V.airNightKm) * factor;
  if (Math.abs(s.alt - r.alt) > world.rules.patrolRules.heightGapM) range /= 2;
  return distance(s.x, s.y, r.x, r.y) <= range;
}

function midLine(world) {
  if (!world.midChannelLine) world.midChannelLine = world.rules.pursuit.midChannel.map(([lon, lat]) => project(lon, lat));
  return world.midChannelLine;
}

/**
 * Is (x, y) on the far side of the mid-Channel line, the side of France and the Low
 * Countries? The line runs north to south; the far side is on its left.
 */
export function beyondMidChannel(world, x, y) {
  const line = midLine(world);
  let best = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - (ax + k * dx), y - (ay + k * dy));
    if (!best || d < best.d) best = { d, side: dx * (y - ay) - dy * (x - ax) };
  }
  return best.side > 0;
}

/** Is raid `r` after the convoy squadron `s` covers? */
function threatensCover(s, r) {
  return Boolean(s.cover) && r.targetKind === 'convoy' && r.target === `convoy:${s.cover}`;
}

/** Has the squadron leave to attack raid `r` (a clearance, or the controller guiding it there)? */
export function isCleared(s, r) {
  return s.cleared.has(r.id) || Boolean(s.intercept && s.intercept.raidId === r.id);
}

/**
 * What squadron `s` may do about raid `r`: { engage: true }, or { ask } with the reason of
 * the question its order calls for ('engage', 'pursue', 'beyond').
 */
export function engagementCall(world, s, r) {
  // Called off this raid by the player: it leaves it alone, without asking, until sent back.
  if (s.letGo.has(r.id) && !(s.intercept && s.intercept.raidId === r.id)) return { engage: false, ask: null };
  const roe = s.roe || 'attack';
  const cleared = isCleared(s, r);
  if (r.phase !== 'outbound') {
    if (roe !== 'defend' || cleared || threatensCover(s, r)) return { engage: true };
    return { ask: 'engage' };
  }
  // A raid going home.
  if (!cleared && roe !== 'pursue') return { ask: 'pursue' };
  if (!s.clearedBeyond.has(r.id) && beyondMidChannel(world, r.x, r.y)) return { ask: 'beyond' };
  return { engage: true };
}

/** The key a unit is asked under: its formation, or itself. */
function unitKey(s) {
  return s.formation || s.id;
}

/** The squadrons a question is put for (all the members of a formation). */
export function questionSquadrons(world, q) {
  const list = [];
  for (const key of q.units) {
    const f = (world.formations || []).find((x) => x.id === key);
    if (f) {
      for (const id of f.members) {
        const s = world.squadrons.find((x) => x.id === id);
        if (s) list.push(s);
      }
    } else {
      const s = world.squadrons.find((x) => x.id === key);
      if (s) list.push(s);
    }
  }
  return list;
}

/** Names of the units a question is put for: "19 Sqn et Big Wing Duxford". */
export function questionUnitNames(world, q) {
  return q.units.map((key) => {
    const f = (world.formations || []).find((x) => x.id === key);
    if (f) return f.name;
    const s = world.squadrons.find((x) => x.id === key);
    return s ? s.name : key;
  });
}

/**
 * Asks for clearance (once per raid, reason and unit). Returns true when the question is
 * open (or was put now), false when the order stands without one (questions switched off,
 * or already answered).
 */
export function askClearance(world, kind, s, r) {
  if (!questionsOn(world)) return false;
  const unit = unitKey(s);
  const key = `${kind}:${r.id}:${unit}`;
  const open = world.questions.find((q) => q.kind === kind && q.raidId === r.id);
  if (world.asked.has(key)) return Boolean(open && open.units.includes(unit));
  world.asked.add(key);
  if (open) {
    // Another unit for the same raid and the same reason: one question for all of them.
    open.units.push(unit);
    return true;
  }
  const P = world.rules.pursuit;
  const q = {
    id: `Q${world.nextQuestionId}`, kind, raidId: r.id, raid: r.label, units: [unit], t: world.t, expires: world.t + P.answerS, x: r.x, y: r.y,
  };
  world.nextQuestionId++;
  world.questions.push(q);
  emit(world, 'question', {
    questionId: q.id, kind, raid: r.label, raidId: r.id, units: questionUnitNames(world, q).join(', '), x: r.x, y: r.y,
  });
  return true;
}

/**
 * A big wing at its rendezvous with squadrons missing: wait, slow down or go? The plan's
 * choice is the answer when there is none. Returns the question's id.
 */
export function askRallyQuestion(world, f, missingNames) {
  const P = world.rules.pursuit;
  const leader = world.squadrons.find((x) => x.id === f.members[0]);
  const q = {
    id: `Q${world.nextQuestionId}`, kind: 'rally', formationId: f.id, raidId: null, raid: '', units: [f.id],
    missing: missingNames.join(', '), options: ['wait', 'slow', 'go'], dflt: f.rally.missing,
    t: world.t, expires: world.t + P.answerS, x: leader ? leader.x : 0, y: leader ? leader.y : 0,
  };
  world.nextQuestionId++;
  world.questions.push(q);
  emit(world, 'question', { questionId: q.id, kind: 'rally', formation: f.name, formationId: f.id, missing: q.missing, x: q.x, y: q.y });
  return q.id;
}

/** A question put for this squadron and raid, still waiting for its answer, or null. */
export function openQuestion(world, s, r, kind) {
  const unit = unitKey(s);
  return world.questions.find((q) => q.raidId === r.id && q.kind === kind && q.units.includes(unit)) || null;
}

function resolve(world, q, yes, how) {
  world.questions = world.questions.filter((x) => x !== q);
  if (q.kind === 'rally') {
    // `yes`: one of the options, or true for the plan's choice; no answer: the plan's choice.
    const choice = typeof yes === 'string' ? yes : how === 'expired' || yes === true ? q.dflt : 'go';
    rallyAnswer(world, q.formationId, choice);
    emit(world, 'rallyDecided', { formationId: q.formationId, units: questionUnitNames(world, q).join(', '), choice, expired: how === 'expired' });
    return;
  }
  const r = world.raids.find((x) => x.id === q.raidId);
  const squadrons = questionSquadrons(world, q);
  if (yes && r && isActive(r)) {
    for (const s of squadrons) {
      authorize(s, r.id);
      if (q.kind === 'beyond') s.clearedBeyond.add(r.id);
      if (q.kind !== 'engage') s.speedMode = 'max';
      // The leader of a formation goes after the raid; its squadrons follow it.
      if (!s.follow && (s.state === 'airborne' || s.state === 'combat')) s.attackRaid = r.id;
    }
  } else if (q.kind === 'beyond') {
    // No leave to cross: the squadrons break off and go home.
    for (const s of squadrons) {
      s.attackRaid = null;
      s.breakOff = q.raidId;
    }
  }
  const type = yes ? 'questionYes' : how === 'expired' ? 'questionExpired' : 'questionNo';
  emit(world, type, { questionId: q.id, kind: q.kind, raid: q.raid, raidId: q.raidId, units: questionUnitNames(world, q).join(', ') });
}

/**
 * The player's answer to a question: true or false, or for a rendezvous one of its options.
 * Returns false when it is no longer open.
 */
export function answerQuestion(world, id, answer) {
  const q = world.questions.find((x) => x.id === id);
  if (!q) return false;
  resolve(world, q, typeof answer === 'string' ? answer : Boolean(answer), 'answered');
  return true;
}

/** Every second: questions left unanswered are answered no; those that no longer apply go. */
export function updateQuestions(world) {
  if (!world.questions.length) return;
  for (const q of [...world.questions]) {
    if (q.kind === 'rally') {
      if (world.t >= q.expires) resolve(world, q, null, 'expired');
      continue;
    }
    const r = world.raids.find((x) => x.id === q.raidId);
    if (!r || !isActive(r)) {
      world.questions = world.questions.filter((x) => x !== q);
      emit(world, 'questionGone', { questionId: q.id, raid: q.raid, raidId: q.raidId });
    } else if (world.t >= q.expires) {
      resolve(world, q, false, 'expired');
    }
  }
}

/**
 * A squadron with leave to attack a raid goes after it while it can see it: the heading to
 * steer, or null (raid out of sight: it keeps to its orders; raid gone: the order ends).
 */
export function chaseHeading(world, s, v) {
  const r = world.raids.find((x) => x.id === s.attackRaid);
  if (!r || !isActive(r) || r.phantom) {
    s.attackRaid = null;
    return null;
  }
  if (!seesRaid(world, s, r, world.rules.visual.keepFactor)) return null;
  s.targetAlt = r.alt;
  const [hx, hy] = headingVector(r.heading);
  const sol = solveIntercept(s.x, s.y, v, r.x, r.y, hx * r.speed, hy * r.speed);
  return sol ? sol.heading : bearing(s.x, s.y, r.x, r.y);
}
