// Loads the game data from disk and builds a world, for the tests.

import { readFileSync } from 'node:fs';
import { createTerrain } from '../src/sim/terrain.js';
import { createWorld, step } from '../src/sim/world.js';
import { resolveScenario } from '../src/core/scenarios.js';
import { drainEvents } from '../src/sim/events.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));

export const data = {
  rules: read('data/rules.json'),
  presets: read('data/presets.json'),
  scenario: read('data/scenarios/m0-july-1940.json'),
  kanalkampf: read('data/scenarios/kanalkampf.json'),
  atlantic: read('data/maps/atlantic.json'),
  channel: read('data/maps/channel.json'),
  fr: read('data/i18n/fr.json'),
};

let terrain = null;
export function getTerrain() {
  if (!terrain) terrain = createTerrain(data.atlantic, data.channel);
  return terrain;
}

const scenarios = {};

/** A scenario's data by id ('m0' is the training scenario). */
export function scenarioData(id) {
  if (id === 'm0') return data.scenario;
  if (id === 'kanalkampf') return data.kanalkampf;
  // (A lesson of the tutorial is written as another scenario with changes: resolved on its base.)
  if (!scenarios[id]) scenarios[id] = resolveScenario(read(`data/scenarios/${id}.json`), (base) => scenarioData(base === 'm0-july-1940' ? 'm0' : base));
  return scenarios[id];
}

export function makeWorld(preset = 'standard', overrides = {}, scenario = 'm0', carry = null) {
  // Tests run without pilot fatigue unless they ask for it, so that take-off times stay put.
  const settings = { ...data.presets.presets[preset], fatigue: 'off', ...overrides };
  return createWorld({
    scenario: structuredClone(scenarioData(scenario)),
    rules: data.rules,
    settings,
    terrain: getTerrain(),
    carry,
  });
}

/** Runs the world for `seconds`, collecting events; stops early when `until(event)` is true. */
export function run(world, seconds, until = null) {
  const events = [];
  for (let i = 0; i < seconds && !world.ended; i++) {
    step(world, 1);
    const batch = drainEvents(world);
    events.push(...batch);
    if (until && batch.some(until)) break;
  }
  return events;
}

/** Runs until the given game time (seconds since start). */
export function runTo(world, t, until = null) {
  return run(world, Math.max(0, t - world.t), until);
}

export function makeKanalkampf(preset = 'standard', overrides = {}) {
  return makeWorld(preset, overrides, 'kanalkampf');
}
