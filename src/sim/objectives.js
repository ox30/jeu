// Scenario objectives, and how the scenario ends. Some objectives are met during the game
// (a convoy delivered), others are judged at the end of the period (aerodromes still in
// service, fighter strength). The scenario can also be lost early (no fuel left anywhere,
// or Fighter Command bled white).

import { emit } from './events.js';
import { cargoShare } from './convoy.js';
import { isOperational } from './sites.js';

export function createObjectives(world, defs) {
  return defs.map((o) => ({ ...o, done: false, failed: false }));
}

export function fighterShare(world) {
  let now = 0;
  let start = 0;
  for (const s of world.squadrons) {
    now += s.aircraft;
    start += s.aircraftStart;
  }
  return start ? now / start : 1;
}

export function basesInService(world, o) {
  return o.airfields.filter((id) => isOperational(world, world.byId.airfield.get(id))).length;
}

/** true / false when settled, null while still open. */
function evaluate(world, o, atEnd) {
  switch (o.type) {
    case 'convoyArrived': {
      const c = world.convoys.find((convoy) => convoy.id === o.convoy);
      if (c && c.state === 'arrived') return true;
      if (c && c.state === 'lost') return false;
      return atEnd ? false : null;
    }
    case 'raidsIntercepted':
      if (world.stats.raidsIntercepted >= o.count) return true;
      return atEnd ? false : null;
    case 'convoyDelivered': {
      const c = world.convoys.find((convoy) => convoy.id === o.convoy);
      if (!c || c.state === 'lost') return false;
      if (cargoShare(c) < o.share) return false;
      if (c.state === 'arrived') return true;
      return atEnd ? false : null;
    }
    case 'basesOperational':
      return atEnd ? basesInService(world, o) >= o.min : null;
    case 'fighterStrength':
      return atEnd ? fighterShare(world) >= o.share : null;
    default:
      return null;
  }
}

function settle(world, o, index, result) {
  if (result === true && !o.done) {
    o.done = true;
    emit(world, 'objectiveDone', { index });
  } else if (result === false && !o.failed) {
    o.failed = true;
    emit(world, 'objectiveFailed', { index });
  }
}

export function checkObjectives(world) {
  world.objectives.forEach((o, index) => {
    if (o.done || o.failed) return;
    settle(world, o, index, evaluate(world, o, false));
  });
  if (!world.allDone && world.objectives.length && world.objectives.every((o) => o.done)) {
    world.allDone = true;
    emit(world, 'allObjectivesDone');
  }
}

/** Early defeat. Checked once a minute; returns the reason or null. */
export function checkDefeat(world) {
  const d = world.scenario.defeat;
  if (!d) return null;
  if (d.fuelOutageHours && (world.dryHours || 0) >= d.fuelOutageHours) return 'fuel';
  if (d.fighterShare && fighterShare(world) < d.fighterShare) return 'fighters';
  return null;
}

/** End of the period: the open objectives are judged and the outcome decided. */
export function finalize(world, defeatReason = null) {
  world.objectives.forEach((o, index) => {
    if (o.done || o.failed) return;
    settle(world, o, index, evaluate(world, o, true) === true);
  });
  world.outcome = !defeatReason && world.objectives.every((o) => o.done) ? 'victory' : 'defeat';
  world.defeatReason = defeatReason;
}
