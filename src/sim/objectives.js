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
    if (s.role !== 'fighter') continue;
    now += s.aircraft;
    start += s.aircraftStart;
  }
  return start ? now / start : 1;
}

export function basesInService(world, o) {
  return o.airfields.filter((id) => isOperational(world, world.byId.airfield.get(id))).length;
}

export function radarsInService(world, o) {
  return o.radars.filter((id) => {
    const r = world.byId.radar.get(id);
    return r && isOperational(world, r);
  }).length;
}

export function enemyDown(world) {
  return world.stats.bombersDown + world.stats.fightersDown;
}

/** Ships of the ocean convoys that have sailed, and the share of them sunk. */
export function shipLosses(world) {
  let sailed = 0;
  for (const c of world.convoys) if (c.type !== 'coastal' && c.state !== 'inPort') sailed += c.shipsStart;
  return { sailed, sunk: world.stats.shipsSunk, share: sailed ? world.stats.shipsSunk / sailed : 0 };
}

export function tonnesDelivered(world) {
  return { fuel: world.stats.unloaded.fuel, materiel: world.stats.unloaded.materiel };
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
      if (cargoShare(c, world) < o.share) return false;
      if (c.state === 'arrived') return true;
      return atEnd ? false : null;
    }
    case 'basesOperational':
      return atEnd ? basesInService(world, o) >= o.min : null;
    case 'fighterStrength':
      return atEnd ? fighterShare(world) >= o.share : null;
    case 'radarsOperational':
      return atEnd ? radarsInService(world, o) >= o.min : null;
    case 'enemyDown':
      if (enemyDown(world) >= o.count) return true;
      return atEnd ? false : null;
    case 'siteDamageBelow': {
      const site = world.sites.get(o.site);
      return atEnd ? Boolean(site) && site.damage <= o.max : null;
    }
    case 'tonnageDelivered': {
      const d = tonnesDelivered(world);
      if (d.fuel >= (o.fuel || 0) && d.materiel >= (o.materiel || 0)) return true;
      return atEnd ? false : null;
    }
    case 'shipLossesBelow':
      return atEnd ? shipLosses(world).share <= o.share : null;
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
  if (d.shipLosses && world.t >= (d.shipLosses.afterDays || 0) * 86400) {
    const l = shipLosses(world);
    if (l.sailed >= 20 && l.share > d.shipLosses.share) return 'shipping';
  }
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
