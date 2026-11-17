// Convoys that sail on a schedule from the other side of the Atlantic, and the dollars
// their cargo costs before Lend-Lease: Britain pays cash for what it buys in America
// ("cash and carry"), and its reserves melt away. The player chooses how much of each
// convoy's capacity to buy; what is not bought sails in ballast.

import { parseGameDate } from '../core/time.js';
import { emit } from './events.js';
import { createConvoy, routeConvoy } from './convoy.js';
import { createUboat } from './naval.js';

export function createShipping(world) {
  const lines = world.scenario.convoySchedule || [];
  world.shipping = {
    lines: lines.map((l) => ({ ...l, sent: 0, nextS: (parseGameDate(l.first) - world.startMs) / 1000 })),
  };
  const cur = world.scenario.currency;
  world.currency = cur
    ? { stock: cur.stock, start: cur.stock, costFuel: cur.costFuel, costMateriel: cur.costMateriel, purchase: 1, spent: 0, bought: [] }
    : null;
}

/** What the dollars can buy besides cargo: aircraft ordered in America. */
export function offers(world) {
  return world.currency ? world.scenario.currency.offers || [] : [];
}

export function offerCost(world, offer) {
  return world.flags.lendLease ? 0 : offer.cost;
}

/**
 * Orders aircraft in America: paid now, they arrive at their base `days` later (a
 * scheduled event that adds the squadron). Each offer can be taken once.
 */
export function buyOffer(world, offerId) {
  const cur = world.currency;
  const offer = offers(world).find((o) => o.id === offerId);
  if (!cur || !offer || cur.bought.includes(offer.id)) return false;
  const cost = offerCost(world, offer);
  if (cur.stock < cost) return false;
  cur.stock -= cost;
  cur.spent += cost;
  cur.bought.push(offer.id);
  const atS = world.t + offer.days * 86400;
  world.scheduled.push({ key: offer.event || offer.id, index: world.scheduled.length, atS, important: true, effects: [{ type: 'squadron', def: offer.squadron }] });
  emit(world, 'offerBought', { offerId: offer.id, cost: Math.round(cost), readyAt: atS });
  return true;
}

/** Cost in dollars of a full convoy of a schedule line. */
export function lineCost(world, line) {
  const c = world.currency;
  if (!c) return 0;
  return line.tankers * line.fuelPerTanker * c.costFuel + line.freighters * line.materielPerFreighter * c.costMateriel;
}

/** Share of the capacity bought for the next convoys (1, 0.75, 0.5...). */
export function setPurchase(world, share) {
  if (!world.currency) return false;
  world.currency.purchase = Math.max(0, Math.min(1, share));
  return true;
}

function sail(world, line) {
  const n = line.firstNumber + line.sent;
  let k = 1;
  let cost = 0;
  if (world.currency && !world.flags.lendLease) {
    const full = lineCost(world, line);
    cost = Math.min(full * world.currency.purchase, world.currency.stock);
    k = full > 0 ? cost / full : 0;
    world.currency.stock -= cost;
    world.currency.spent += cost;
  }
  const [lon, lat] = line.admiraltyRoute[0];
  const c = createConvoy(world, {
    id: `${line.prefix.toLowerCase()}${n}`,
    name: `${line.prefix} ${n}`,
    type: 'ocean',
    at: { lon, lat },
    heading: line.heading ?? 60,
    speedKn: line.speedKn,
    tankers: line.tankers,
    fuelPerTanker: line.fuelPerTanker * k,
    freighters: line.freighters,
    materielPerFreighter: line.materielPerFreighter * k,
    admiraltyRoute: line.admiraltyRoute,
  });
  world.convoys.push(c);
  // The convoy sails the Admiralty route at once; the player may change it.
  routeConvoy(world, c, c.admiraltyRoute.slice(1));
  emit(world, 'convoyDeparted', {
    convoy: c.name, convoyId: c.id, ships: c.ships, fuel: Math.round(c.cargo.fuel), materiel: Math.round(c.cargo.materiel),
    cost: Math.round(cost), share: k, lendLease: Boolean(world.flags.lendLease),
  });
}

/** Once a minute. */
export function updateShipping(world) {
  for (const line of world.shipping.lines) {
    if (line.sent >= line.count || world.t < line.nextS) continue;
    sail(world, line);
    line.sent++;
    line.nextS += line.everyHours * 3600;
  }
}

/** New U-boats coming out from the French bases (a scheduled event). */
export function addUboats(world, boats) {
  for (const def of boats) if (!world.uboats.some((u) => u.id === def.id)) world.uboats.push(createUboat(world, def));
}
