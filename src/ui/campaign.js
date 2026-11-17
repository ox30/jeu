// The campaign of Act I: the scenarios follow one another, each one unlocked by a victory
// in the one before. Between the air battles, what the fighting cost can be carried over
// (setting): the squadrons then start the next battle short of aircraft.

const KEY = 'jeu-1940.campaign.v1';

export const CHAIN = ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique'];
export const TRAINING = 'm0-july-1940';
const AIR = ['kanalkampf', 'adlertag', 'quinze-septembre'];

export function loadCampaign() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && typeof c === 'object') return { results: c.results || {}, unlockAll: Boolean(c.unlockAll) };
  } catch {
    // ignore unreadable storage
  }
  return { results: {}, unlockAll: false };
}

export function saveCampaign(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

/** Status of a scenario in the campaign: 'won', 'open', 'locked' or 'free' (not in the chain). */
export function scenarioStatus(c, id) {
  const i = CHAIN.indexOf(id);
  if (i < 0) return 'free';
  if (c.results[id]?.won) return 'won';
  if (i === 0 || c.unlockAll || c.results[CHAIN[i - 1]]?.won) return 'open';
  return 'locked';
}

/**
 * A scenario has ended: a victory is kept (a later defeat does not take it back).
 * Returns the id of the scenario it unlocks, or null.
 */
export function recordResult(c, world, fighterShare) {
  const id = world.scenario.id;
  const i = CHAIN.indexOf(id);
  if (i < 0) return null;
  const won = world.outcome === 'victory';
  const before = c.results[id] || {};
  c.results[id] = {
    won: Boolean(before.won) || won,
    fighterShare: won ? Math.min(1, fighterShare) : before.fighterShare ?? null,
    last: world.outcome,
  };
  saveCampaign(c);
  const next = CHAIN[i + 1];
  return won && !before.won && next && !c.unlockAll ? next : null;
}

/**
 * Losses carried into an air battle from the one before it: { fighterShare, from } or null.
 * 'light' (Standard): half the losses still show, at least 75 % of the aircraft.
 * 'full' (Réaliste): all of them, at least 60 %.
 */
export function carryFor(c, id, mode) {
  const i = CHAIN.indexOf(id);
  if (!mode || mode === 'none' || i <= 0) return null;
  const from = CHAIN[i - 1];
  if (!AIR.includes(id) || !AIR.includes(from)) return null;
  const r = c.results[from];
  if (!r || r.fighterShare === null || r.fighterShare === undefined) return null;
  const share = Math.max(0, Math.min(1, r.fighterShare));
  const k = mode === 'full' ? Math.max(0.6, share) : Math.max(0.75, 1 - (1 - share) / 2);
  return k < 0.999 ? { fighterShare: k, from } : null;
}
