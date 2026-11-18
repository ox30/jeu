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
import { updateContacts } from './contact.js';
import { createFormations, updateFormations } from './formations.js';
import { prepareSeaRoutes } from './searoute.js';
import { closedRaster } from './uboatnav.js';
import { createWatch, noteWatch, updateWatch } from './watch.js';
import { createQuestions, updateQuestions } from './engagement.js';
import { createTimetable, updateTimetable } from './timetable.js';
import { updateRallies } from './rally.js';
import { createGrid } from './grid.js';
import { createSite, repairSites } from './sites.js';
import { checkDefeat, checkObjectives, createObjectives, fighterCount, finalize } from './objectives.js';
import { createLogistics, updateLogistics, updateTrains } from './logistics.js';
import {
  ageDfZones, checkEscortRange, createEscortGroup, createUboat, initialIntelligence, updateEscort, updateUboat,
} from './naval.js';
import { updateConvoyRaids } from './scheduler.js';
import { recordReports } from './reports.js';
import { createCrews, updateCrews } from './crews.js';
import { updatePatrols } from './patrols.js';
import { updateAsw } from './asw.js';
import { createBdu, updateBdu } from './bdu.js';
import { createMru, updateMru } from './mru.js';
import { createSchedule, updateSchedule } from './schedule.js';
import { createShipping, updateShipping } from './shipping.js';

function placed(item) {
  const [x, y] = project(item.lon, item.lat);
  return { ...item, x, y };
}

function placedPath(path) {
  return path.map(([lon, lat]) => project(lon, lat));
}

export function createWorld({ scenario, rules, settings, terrain, carry = null }) {
  const startMs = parseGameDate(scenario.start);
  const ports = scenario.ports.map((p) => ({
    ...placed(p),
    approaches: (p.approaches || []).map((a) => ({ name: a.name, points: placedPath(a.path) })),
  }));
  const airfields = scenario.airfields.map(placed);
  const radars = scenario.radars.map(placed);
  const factories = (scenario.factories || []).map(placed);
  const depots = (scenario.depots || []).map(placed);
  const sites = new Map();

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
    depots,
    sites,
    landmarks: (scenario.landmarks || []).map(placed),
    byId: {
      port: new Map(ports.map((p) => [p.id, p])),
      airfield: new Map(airfields.map((a) => [a.id, a])),
      radar: new Map(radars.map((r) => [r.id, r])),
      factory: new Map(factories.map((f) => [f.id, f])),
      depot: new Map(depots.map((f) => [f.id, f])),
    },
    convoys: [],
    escorts: [],
    uboats: [],
    dfZones: [],
    dfPending: [],
    bdu: createBdu(),
    uboatPlots: [],
    nextPlotId: 1,
    squadrons: [],
    clockOffsetH: scenario.clockOffsetH ?? 1, // the game's clock ahead of GMT (British summer time)
    carry: null, // campaign: the losses carried over from the battle before ({ fighterShare, from })
    fightersAtStart: 0, // fighter aircraft present as the scenario begins
    raids: [],
    contacts: new Map(),
    reports: new Map(),
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
      unloaded: { fuel: 0, materiel: 0, ammo: 0 },
      delivered: { fuel: 0, materiel: 0, ammo: 0 },
      ammoUsed: 0,
      pilotsKilled: 0,
    },
    objectives: [],
    flags: {},
    allDone: false,
    ended: false,
    outcome: null,
    dryHours: 0,
  };
  for (const [list, kind] of [[airfields, 'airfield'], [radars, 'radar'], [ports, 'port'], [factories, 'factory'], [depots, 'depot']]) {
    for (const item of list) {
      const site = createSite(world, item, kind);
      sites.set(site.key, site);
    }
  }
  createLogistics(world, scenario.logistics || null);
  world.convoys = scenario.convoys.map((c) => createConvoy(world, c));
  world.escorts = (scenario.escorts || []).map((e) => createEscortGroup(world, e));
  world.uboats = (scenario.uboats || []).map((u) => createUboat(world, u));
  world.squadrons = scenario.squadrons.map((s) => createSquadron(world, s));
  if (carry && carry.fighterShare < 1) applyCarry(world, carry);
  // The fighters present as the scenario begins: the objective of fighter strength is measured on them.
  world.fightersAtStart = fighterCount(world).now;
  createCrews(world, scenario.pilots || null);
  createMru(world, scenario.mru || null);
  createSchedule(world);
  createShipping(world);
  createFormations(world);
  // The rasters of the sea routes are built now rather than at the first route of the game.
  prepareSeaRoutes(world);
  if (world.uboats.length || (scenario.events || []).some((e) => (e.effects || []).some((fx) => fx.type === 'uboats'))) closedRaster(world);
  // And the grids of what the Observer Corps sees (with the strip of sea off the coast for the
  // raids, without it for the mobile radars): the first raid over land does not wait for them.
  const D = rules.detection;
  if (D && scenario.raids && scenario.raids.length) {
    world.terrain.observerMask(D.observerCellKm, D.observerOffshoreKm);
    world.terrain.observerMask(D.observerCellKm, 0);
  }
  createQuestions(world);
  createTimetable(world);
  createWatch(world);
  world.navalReports = []; // depth-charge attacks, one report each (asw.js)
  world.nextNavalReportId = 1;
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
  if (world.carry) {
    const total = fighterCount(world).establishment;
    emit(world, 'carryApplied', {
      share: total ? Math.round((100 * world.fightersAtStart) / total) : 100, from: world.carry.from,
      n: world.fightersAtStart, total,
    });
  }
  return world;
}

/**
 * Campaign: the fighter squadrons start short of the aircraft lost in the battle before.
 * Their establishment does not change: the factories and the ferry pilots fill the gaps.
 */
function applyCarry(world, carry) {
  for (const s of world.squadrons) {
    if (s.role !== 'fighter') continue;
    const n = Math.max(1, Math.round(s.aircraft * carry.fighterShare));
    s.aircraft = n;
    s.pilots = Math.min(s.pilots, n);
  }
  const { now, establishment } = fighterCount(world);
  world.carry = { ...carry, aircraft: now, establishment };
}

function end(world, reason = null) {
  world.ended = true;
  finalize(world, reason);
  emit(world, 'scenarioEnd', { stats: { ...world.stats }, outcome: world.outcome, reason });
}

/** Advances the world by `dt` whole seconds (default 1). */
export function step(world, dt = 1) {
  if (world.ended) return;
  const first = world.events.length;
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
  updateQuestions(world);
  if (world.t % world.rules.visual.checkEveryS === 0) {
    updateContacts(world);
    updateFormations(world);
    updateRallies(world);
  }
  const minute = world.rules.detection.plotIntervalS;
  if (world.t % minute === 0) {
    updateDetection(world);
    repairSites(world, minute);
    updateLogistics(world, minute);
    updateCrews(world, minute);
    updatePatrols(world);
    updateAsw(world);
    updateMru(world);
    updateSchedule(world);
    updateTimetable(world);
    updateShipping(world);
    updateConvoyRaids(world);
    ageDfZones(world);
    checkEscortRange(world);
    if (world.t % 3600 === 0) updateBdu(world);
  }
  checkAlerts(world);
  checkObjectives(world);
  recordReports(world, first);
  // The sea at the rhythm of the watches: what happened is noted, the relief writes its report.
  noteWatch(world, first);
  updateWatch(world);
  if (world.t % minute === 0) {
    const reason = checkDefeat(world);
    if (reason) {
      end(world, reason);
      return;
    }
  }
  if (world.t >= world.endS && !world.ended) end(world);
}
