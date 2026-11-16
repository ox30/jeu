// The world: creation from a scenario and one simulation step.
// step() always advances by whole seconds of game time; the main loop calls it as many times
// as the chosen speed requires.

import { project } from './geo.js';
import { createRandom } from '../core/random.js';
import { parseGameDate } from '../core/time.js';
import { emit } from './events.js';
import { createConvoy, updateConvoy } from './convoy.js';
import { createSquadron, updateSquadron } from './squadron.js';
import { createRaid, createPhantom, updateRaid } from './raid.js';
import { checkEngagements, checkMisses, updateCombat } from './combat.js';
import { checkAlerts, updateDetection } from './detection.js';
import { createGrid } from './grid.js';
import { initSite, repairSites } from './sites.js';
import { checkDefeat, checkObjectives, createObjectives, finalize } from './objectives.js';
import { createLogistics, updateLogistics, updateTrains } from './logistics.js';
import {
  ageDfZones, createEscortGroup, createUboat, initialIntelligence, updateEscort, updateUboat,
} from './naval.js';
import { updateConvoyRaids } from './scheduler.js';

function placed(item) {
  const [x, y] = project(item.lon, item.lat);
  return { ...item, x, y };
}

function placedPath(path) {
  return path.map(([lon, lat]) => project(lon, lat));
}

export function createWorld({ scenario, rules, settings, terrain }) {
  const startMs = parseGameDate(scenario.start);
  const ports = scenario.ports.map((p) => initSite({
    ...placed(p),
    approaches: (p.approaches || []).map((a) => ({ name: a.name, points: placedPath(a.path) })),
  }, 'port'));
  const airfields = scenario.airfields.map((a) => initSite(placed(a), 'airfield'));
  const radars = scenario.radars.map((r) => initSite(placed(r), 'radar'));
  const factories = (scenario.factories || []).map((f) => initSite(placed(f), 'factory'));
  const sites = new Map();
  for (const site of [...airfields, ...radars, ...ports, ...factories]) sites.set(site.key, site);

  const world = {
    t: 0,
    startMs,
    endS: (parseGameDate(scenario.end) - startMs) / 1000,
    rules,
    settings,
    terrain,
    rng: createRandom(scenario.seed ?? 1),
    scenario,
    grid: createGrid(scenario.grid),
    ports,
    airfields,
    radars,
    factories,
    sites,
    landmarks: (scenario.landmarks || []).map(placed),
    byId: {
      port: new Map(ports.map((p) => [p.id, p])),
      airfield: new Map(airfields.map((a) => [a.id, a])),
      radar: new Map(radars.map((r) => [r.id, r])),
      factory: new Map(factories.map((f) => [f.id, f])),
    },
    convoys: [],
    escorts: [],
    uboats: [],
    dfZones: [],
    squadrons: [],
    raids: [],
    contacts: new Map(),
    events: [],
    stats: {
      bombersDown: 0,
      fightersDown: 0,
      rafLost: 0,
      groundLosses: 0,
      raidsIntercepted: 0,
      raidsRepelled: 0,
      targetsHit: 0,
      convoysArrived: 0,
      shipsSunk: 0,
      cargoLost: 0,
      uboatsSunk: 0,
      aircraftBuilt: 0,
      aircraftDelivered: 0,
      fuelUsed: 0,
      unloaded: { fuel: 0, materiel: 0 },
      delivered: { fuel: 0, materiel: 0 },
    },
    objectives: [],
    allDone: false,
    ended: false,
    outcome: null,
    dryHours: 0,
  };
  createLogistics(world, scenario.logistics || null);
  world.convoys = scenario.convoys.map((c) => createConvoy(world, c));
  world.escorts = (scenario.escorts || []).map((e) => createEscortGroup(world, e));
  world.uboats = (scenario.uboats || []).map((u) => createUboat(world, u));
  world.squadrons = scenario.squadrons.map((s) => createSquadron(world, s));
  world.raids = [
    ...scenario.raids.map((r) => createRaid(world, r)),
    ...(scenario.phantoms || []).map((p) => createPhantom(world, p)),
  ];
  world.objectives = createObjectives(world, scenario.objectives || []);
  initialIntelligence(world);
  const first = world.convoys[0];
  emit(world, 'scenarioStart', {
    scenario: scenario.id,
    convoy: first ? first.name : null,
    port: first && first.portId ? world.byId.port.get(first.portId).name : null,
  });
  return world;
}

function end(world, reason = null) {
  world.ended = true;
  finalize(world, reason);
  emit(world, 'scenarioEnd', { stats: { ...world.stats }, outcome: world.outcome, reason });
}

/** Advances the world by `dt` whole seconds (default 1). */
export function step(world, dt = 1) {
  if (world.ended) return;
  world.t += dt;
  for (const c of world.convoys) updateConvoy(world, c, dt);
  for (const e of world.escorts) updateEscort(world, e, dt);
  for (const u of world.uboats) updateUboat(world, u, dt);
  for (const r of world.raids) updateRaid(world, r, dt);
  for (const s of world.squadrons) updateSquadron(world, s, dt);
  updateTrains(world, dt);
  checkEngagements(world);
  checkMisses(world);
  updateCombat(world, dt);
  const minute = world.rules.detection.plotIntervalS;
  if (world.t % minute === 0) {
    updateDetection(world);
    repairSites(world, minute);
    updateLogistics(world, minute);
    updateConvoyRaids(world);
    ageDfZones(world);
  }
  checkAlerts(world);
  checkObjectives(world);
  if (world.t % minute === 0) {
    const reason = checkDefeat(world);
    if (reason) {
      end(world, reason);
      return;
    }
  }
  if (world.t >= world.endS && !world.ended) end(world);
}
