// The summary shown when a scenario ends: its lines are chosen from what the scenario asks
// (its objectives) and from what it holds, so that an air battle does not list U-boats sunk
// nor the Atlantic the bombers shot down. Kept free of the page: the tests read it.

/** Does the scenario have this kind of objective? */
const asks = (world, ...types) => world.objectives.some((o) => types.includes(o.type));
const airBattle = (world) => world.raids.length > 0;

// In the order shown. Each line appears when the scenario asks for it (an objective of one of
// these types), or when `also` says the scenario holds the thing.
const LINES = [
  { key: 'bombersDown', also: airBattle },
  { key: 'fightersDown', also: airBattle },
  { key: 'rafLost', also: airBattle },
  { key: 'groundLosses', also: airBattle },
  { key: 'pilotsKilled', also: (w) => airBattle(w) && w.settings.fatigue === 'losses' },
  { key: 'raidsIntercepted', also: airBattle },
  { key: 'raidsRepelled', also: airBattle },
  { key: 'targetsHit', also: airBattle },
  { key: 'convoysArrived', also: (w) => w.convoys.length > 0 },
  { key: 'shipsSunk', objectives: ['convoyArrived', 'convoyDelivered', 'shipLossesBelow'], also: (w) => w.stats.shipsSunk > 0 },
  { key: 'uboatsSunk', objectives: ['shipLossesBelow'], also: (w) => w.stats.uboatsSunk > 0 },
  { key: 'unloaded', objectives: ['convoyDelivered', 'tonnageDelivered'] },
  { key: 'aircraftBuilt', also: (w) => asks(w, 'fighterStrength') && w.factories.length > 0 && w.stats.aircraftBuilt > 0 },
  // Supply: where a battle can be lost for want of fuel.
  { key: 'fuelUsed', also: (w) => airBattle(w) && Boolean(w.scenario.defeat && w.scenario.defeat.fuelOutageHours) },
  { key: 'ammoUsed', also: (w) => airBattle(w) && w.depots.length > 0 && Boolean(w.scenario.defeat && w.scenario.defeat.fuelOutageHours) },
  { key: 'dollars', also: (w) => Boolean(w.currency) },
];

/** The keys of the lines of the end summary, in order (texts: `end.<key>`). */
export function endSummaryKeys(world) {
  return LINES
    .filter((line) => (line.objectives && asks(world, ...line.objectives)) || (line.also && line.also(world)))
    .map((line) => line.key);
}

/** A name for a game, so that its saves are told from those of another game of the same scenario. */
export function newGameId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Real time spent on a game: { totalMs, pausedMs }, counted by the frame loop. */
export function createPlayClock(from = null) {
  return { totalMs: Math.max(0, Number(from && from.totalMs) || 0), pausedMs: Math.max(0, Number(from && from.pausedMs) || 0) };
}

/**
 * A frame went by. A long gap (the tab was hidden, the computer asleep) is not time played:
 * it counts for one second at most.
 */
export function tickPlayClock(clock, elapsedMs, paused) {
  const ms = Math.max(0, Math.min(1000, elapsedMs));
  clock.totalMs += ms;
  if (paused) clock.pausedMs += ms;
}
