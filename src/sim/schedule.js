// Dated events of a scenario: a message at a given hour, reinforcements, mobile radar
// stations made available, the end of a constraint (Lend-Lease). Each fires once.

import { parseGameDate } from '../core/time.js';
import { emit } from './events.js';
import { createSquadron } from './squadron.js';
import { addUboats } from './shipping.js';

export function createSchedule(world) {
  world.scheduled = (world.scenario.events || []).map((e, index) => ({ ...e, index, atS: (parseGameDate(e.at) - world.startMs) / 1000 }));
  world.firedEvents = [];
}

function apply(world, fx) {
  switch (fx.type) {
    case 'mru':
      if (world.mru) world.mru.available += fx.count ?? 1;
      break;
    case 'squadron':
      if (!world.squadrons.some((s) => s.id === fx.def.id)) {
        const s = createSquadron(world, fx.def);
        world.squadrons.push(s);
        // A fighter squadron sent as a relief counts among the fighters the player was given:
        // the objective of fighter strength is measured on them too.
        if (s.role === 'fighter') world.fightersAtStart += s.aircraft;
      }
      break;
    case 'stock': {
      const site = world.sites.get(fx.site);
      if (site) for (const [res, n] of Object.entries(fx.add || {})) site.stocks[res] = (site.stocks[res] || 0) + n;
      break;
    }
    case 'flag':
      world.flags[fx.name] = fx.value ?? true;
      break;
    case 'uboats':
      addUboats(world, fx.boats || []);
      break;
    default:
  }
}

/** Once a minute. */
export function updateSchedule(world) {
  for (const e of world.scheduled) {
    if (world.firedEvents.includes(e.index) || world.t < e.atS) continue;
    world.firedEvents.push(e.index);
    for (const fx of e.effects || []) apply(world, fx);
    emit(world, 'scenarioEvent', { key: e.key, scenario: world.scenario.id, important: Boolean(e.important) });
  }
}
