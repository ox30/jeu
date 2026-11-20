// The campaign of Act I: the scenarios follow one another, each one unlocked by a victory
// in the one before. Between the air battles, what the fighting cost can be carried over
// (setting): the squadrons then start the next battle short of aircraft. The lists — the
// scenarios, the chain, the air battles, the training scenario — are data (data/campaign.json).

import { presetStory } from '../sim/gameSettings.js';

const KEY = 'jeu-1940.campaign.v1';

let conf = { scenarios: [], chain: [], airBattles: [], training: null };

/** The lists of data/campaign.json, given once when the data are loaded. */
export function setCampaignData(data) {
  conf = {
    scenarios: [...(data.scenarios || [])],
    chain: [...(data.chain || [])],
    airBattles: [...(data.airBattles || [])],
    training: data.training || null,
  };
}

/** The scenarios of the chain, in order. */
export function campaignChain() {
  return conf.chain;
}

/** The training scenario (the tutorial is played on it). */
export function trainingId() {
  return conf.training;
}

/** Every scenario the game knows: those of the menu, then the training one. */
export function scenarioIds() {
  return [...conf.scenarios, ...(conf.training && !conf.scenarios.includes(conf.training) ? [conf.training] : [])];
}

/** The scenario that follows `id` in the chain, or null. */
export function nextInChain(id) {
  const i = conf.chain.indexOf(id);
  return i >= 0 && i + 1 < conf.chain.length ? conf.chain[i + 1] : null;
}

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
  const i = conf.chain.indexOf(id);
  if (i < 0) return 'free';
  if (c.results[id]?.won) return 'won';
  if (i === 0 || c.unlockAll || c.results[conf.chain[i - 1]]?.won) return 'open';
  return 'locked';
}

/**
 * A scenario has ended: a victory is kept (a later defeat does not take it back).
 * Returns the id of the scenario it unlocks, or null.
 */
export function recordResult(c, world, fighterShare) {
  const id = world.scenario.id;
  const i = conf.chain.indexOf(id);
  if (i < 0) return null;
  const won = world.outcome === 'victory';
  const before = c.results[id] || {};
  // The preset of the game that won it (N9): « commencée en Réaliste, terminée en Standard ».
  const story = world.settings ? presetStory(world) : { start: null, end: null };
  c.results[id] = {
    won: Boolean(before.won) || won,
    fighterShare: won ? Math.min(1, fighterShare) : before.fighterShare ?? null,
    last: world.outcome,
    preset: won ? story.end : before.preset ?? null,
    presetStart: won ? story.start : before.presetStart ?? null,
  };
  saveCampaign(c);
  const next = conf.chain[i + 1];
  return won && !before.won && next && !c.unlockAll ? next : null;
}

/**
 * Losses carried into an air battle from the one before it: { fighterShare, from } or null.
 * 'light' (Standard): half the losses still show, at least 75 % of the aircraft.
 * 'full' (Réaliste): all of them, at least 60 %.
 */
export function carryFor(c, id, mode) {
  const i = conf.chain.indexOf(id);
  if (!mode || mode === 'none' || i <= 0) return null;
  const from = conf.chain[i - 1];
  if (!conf.airBattles.includes(id) || !conf.airBattles.includes(from)) return null;
  const r = c.results[from];
  if (!r || r.fighterShare === null || r.fighterShare === undefined) return null;
  const share = Math.max(0, Math.min(1, r.fighterShare));
  const k = mode === 'full' ? Math.max(0.6, share) : Math.max(0.75, 1 - (1 - share) / 2);
  return k < 0.999 ? { fighterShare: k, from } : null;
}
