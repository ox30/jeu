// Raids decided by the enemy as the game goes: while the coastal convoy is in the Channel in
// daylight, the Luftwaffe sends dive-bombers against it every few hours.

import { unproject } from './geo.js';
import { createRaid } from './raid.js';
import { emit } from './events.js';

function isoMinute(ms) {
  return new Date(ms).toISOString().slice(0, 16);
}

/** Once a minute of game time. */
export function updateConvoyRaids(world) {
  const def = world.scenario.convoyRaids;
  if (!def) return;
  const c = world.convoys.find((x) => x.id === def.convoy);
  if (!c || c.state !== 'atSea') return;
  const st = world.convoyRaidState || (world.convoyRaidState = { count: 0, next: null });
  if (st.count >= def.max) return;
  const [lon] = unproject(c.x, c.y);
  if (lon < def.zone.lonMin || lon > def.zone.lonMax) return;
  const hour = new Date(world.startMs + world.t * 1000).getUTCHours();
  if (hour < def.dayFrom || hour >= def.dayTo) return;
  if (st.next === null) st.next = world.t + def.firstAfterHours * 3600;
  if (world.t < st.next) return;
  const origin = def.origins.find((o) => lon >= o.lonMin) || def.origins[def.origins.length - 1];
  const n = def.labelFrom + st.count;
  const raid = createRaid(world, {
    id: `hc${st.count + 1}`,
    label: `H${String(n).padStart(2, '0')}`,
    time: isoMinute(world.startMs + (world.t + 60) * 1000),
    origin: { lon: origin.origin[0], lat: origin.origin[1] },
    assemblyMin: def.assemblyMin,
    target: `convoy:${c.id}`,
    bombers: def.bombers,
    bomberType: def.bomberType,
    escort: def.escort,
    escortType: def.escortType,
    altitudeFt: def.altitudeFt,
    speedKmh: def.speedKmh,
  });
  world.raids.push(raid);
  st.count++;
  st.next = world.t + def.everyHours * 3600;
  emit(world, 'convoyRaidPlanned', { convoy: c.name, convoyId: c.id, raidId: raid.id });
}
