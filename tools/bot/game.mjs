// Access to the game for the automatic player and the measurement scripts: the data files,
// the simulation modules and a few helpers. Nothing here knows more than a player does: the
// players in this folder read what the plotting table shows (plots, markers, their own
// units) and give their orders through `orders`.
import * as scenariosMod from '../../src/core/scenarios.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as worldMod from '../../src/sim/world.js';
import * as terrainMod from '../../src/sim/terrain.js';
import * as eventsMod from '../../src/sim/events.js';
import * as ordersMod from '../../src/sim/orders.js';
import * as queryMod from '../../src/sim/query.js';
import * as engagementMod from '../../src/sim/engagement.js';
import * as objectivesMod from '../../src/sim/objectives.js';
import * as shippingMod from '../../src/sim/shipping.js';
import * as geoMod from '../../src/sim/geo.js';
import * as formationsMod from '../../src/sim/formations.js';
import * as navalMod from '../../src/sim/naval.js';
import * as interceptMod from '../../src/sim/intercept.js';
import * as crewsMod from '../../src/sim/crews.js';
import * as squadronMod from '../../src/sim/squadron.js';
import * as saveMod from '../../src/save/game.js';
import * as alertRulesMod from '../../src/ui/alertRules.js';
import * as campaignMod from '../../src/ui/campaign.js';
import * as i18nMod from '../../src/core/i18n.js';
import * as searouteMod from '../../src/sim/searoute.js';

// Modules that came after 2.7: absent when the player runs on an earlier checkout.
const daylightMod = await import('../../src/sim/daylight.js').catch(() => null);
const commsMod = await import('../../src/sim/comms.js').catch(() => null);
const watchMod = await import('../../src/sim/watch.js').catch(() => null);

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));

export const data = {
  rules: read('data/rules.json'),
  presets: read('data/presets.json'),
  fr: read('data/i18n/fr.json'),
  atlantic: read('data/maps/atlantic.json'),
  channel: read('data/maps/channel.json'),
};
i18nMod.setDictionary(data.fr);
// The chain of the campaign is data (2.9): given to the module as the page does.
if (campaignMod.setCampaignData) campaignMod.setCampaignData(read('data/campaign.json'));

export const SCENARIOS = ['m0-july-1940', 'kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique'];
const scenarioCache = new Map();
export function scenarioData(id) {
  // (A lesson of the tutorial is written as another scenario with changes: resolved on its base.)
  if (!scenarioCache.has(id)) scenarioCache.set(id, scenariosMod.resolveScenario(read(`data/scenarios/${id}.json`), scenarioData));
  return scenarioCache.get(id);
}

export const sim = {
  world: worldMod,
  terrain: terrainMod,
  events: eventsMod,
  query: queryMod,
  engagement: engagementMod,
  objectives: objectivesMod,
  shipping: shippingMod,
  geo: geoMod,
  formations: formationsMod,
  naval: navalMod,
  intercept: interceptMod,
  crews: crewsMod,
  squadron: squadronMod,
  save: saveMod,
  alertRules: alertRulesMod,
  campaign: campaignMod,
  searoute: searouteMod,
  daylight: daylightMod,
  comms: commsMod,
  watch: watchMod,
};

/**
 * Every order a player can give. Most live in src/sim/orders.js; the few that the interface
 * still calls in their own module (attitudes, answers, purchases, formations) are added so
 * that the players of this folder give their orders in one place.
 */
export const orders = {
  setRoe: engagementMod.setRoe,
  answerQuestion: engagementMod.answerQuestion,
  authorize: engagementMod.authorize,
  buyOffer: shippingMod.buyOffer,
  newFormation: formationsMod.newFormation,
  addMember: formationsMod.addMember,
  scrambleFormation: formationsMod.scrambleFormation,
  ...ordersMod,
};

let terrain = null;
export function getTerrain() {
  if (!terrain) terrain = terrainMod.createTerrain(data.atlantic, data.channel);
  return terrain;
}

/** The settings a player gets with a preset: its values, then the options, as the game does. */
export function settingsFor(preset, overrides = {}) {
  return { preset, ...data.presets.presets[preset], ...data.presets.options, ...overrides };
}

/**
 * A new game. `seed` replaces the scenario's own seed; `carry` is what the campaign hands
 * over from the battle before ({ fighterShare, from }); `rules` patches data/rules.json
 * (one level deep, for trials).
 */
export function makeWorld(scenarioId, { preset = 'standard', overrides = {}, seed = null, carry = null, rules = null } = {}) {
  const scenario = structuredClone(scenarioData(scenarioId));
  if (seed !== null && seed !== undefined) scenario.seed = seed;
  let r = data.rules;
  if (rules) {
    r = structuredClone(data.rules);
    for (const [k, v] of Object.entries(rules)) r[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...r[k], ...v } : v;
  }
  const world = worldMod.createWorld({ scenario, rules: r, settings: settingsFor(preset, overrides), terrain: getTerrain(), carry });
  // As the page does in its first seconds, before anyone plays: the distance by sea to each
  // port, worked out ahead (they are kept with the coastlines; the game's results do not change).
  if (searouteMod.warmPortField) while (searouteMod.warmPortField(world));
  return world;
}

/** The game's date and time, for logs: "1941-01-14 02:10". */
export function gameClock(world) {
  return new Date(world.startMs + world.t * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Counts what interrupts the player. `stops` are the moments when the game comes down to ×1
 * or pauses (the measure of « arrêts par partie »); `alerts` counts every alert by type.
 */
export function createInterruptions() {
  return { memory: new Map(), alerts: {}, total: 0, stops: 0, times: [] };
}

export function noteInterruptions(world, events, tally) {
  for (const e of events) {
    // A pause ordered by the simulation itself (watch reports, from M2.8 on).
    if (e.type === 'seaStop') {
      tally.stops++;
      tally.times.push([world.t, e.reason || e.type]);
      continue;
    }
    const a = alertRulesMod.alertFor(world, e, tally.memory);
    if (!a) continue;
    tally.alerts[e.type] = (tally.alerts[e.type] || 0) + 1;
    tally.total++;
    const speed = alertRulesMod.alertSpeed(world.settings, a.type, a.level);
    if (speed === 1) {
      tally.stops++;
      tally.times.push([world.t, e.type]);
    }
  }
}

/**
 * Times every simulation step of a game: the criterion is that no step takes more than
 * 20 ms (a frame at 60 images a second has 16.7 ms for all of its steps).
 */
export function createStepTimer() {
  let max = 0;
  let over2 = 0;
  let over20 = 0;
  let total = 0;
  let count = 0;
  const worst = [];
  return {
    step(world, dt = 1) {
      const t0 = performance.now();
      worldMod.step(world, dt);
      const ms = performance.now() - t0;
      total += ms;
      count++;
      if (ms > 2) {
        over2++;
        if (ms > 20) {
          over20++;
          if (worst.length < 8) worst.push({ t: world.t, ms: Math.round(ms), events: world.events.slice(0, 5).map((e) => e.type).join(',') });
        }
        if (ms > max) max = ms;
      }
    },
    result() {
      return { count, totalS: +(total / 1000).toFixed(1), maxMs: +max.toFixed(1), over2, over20, worst };
    },
  };
}
