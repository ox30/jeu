// Convoys that sail on a schedule from the other side of the Atlantic, and the dollars
// their cargo costs before Lend-Lease: Britain pays cash for what it buys in America
// ("cash and carry"), and its reserves melt away. The convoys sail fully laden as long as
// the reserve can pay; what it cannot pay sails in ballast. The same dollars buy patrol
// aircraft: every dollar spent on them is cargo that will not sail.

import { parseGameDate } from '../core/time.js';
import { emit } from './events.js';
import { createConvoy, routeConvoy, safeKnots } from './convoy.js';
import { KNOT_KMH, polylineLength, project } from './geo.js';
import { tonnesDelivered } from './objectives.js';
import { createUboat } from './naval.js';

export function createShipping(world) {
  const lines = world.scenario.convoySchedule || [];
  world.shipping = {
    lines: lines.map((l) => ({ ...l, sent: 0, nextS: (parseGameDate(l.first) - world.startMs) / 1000 })),
  };
  const cur = world.scenario.currency;
  world.currency = cur
    ? { stock: cur.stock, start: cur.stock, costFuel: cur.costFuel, costMateriel: cur.costMateriel, spent: 0, bought: [] }
    : null;
}

/** What the dollars can buy besides cargo: aircraft ordered in America. */
export function offers(world) {
  return world.currency ? world.scenario.currency.offers || [] : [];
}

export function offerCost(world, offer) {
  return world.flags.lendLease ? 0 : offer.cost;
}

/** What an offer costs in cargo, at the prices of the day: { fuel, materiel } tonnes (either one, not both). */
export function offerInCargo(world, offer) {
  const cur = world.currency;
  const cost = offerCost(world, offer);
  return { fuel: cost / cur.costFuel, materiel: cost / cur.costMateriel };
}

/** When the aircraft of an offer would reach their base if ordered now (seconds of game time). */
export function offerArrival(world, offer) {
  return world.t + offer.days * 86400;
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
  const atS = offerArrival(world, offer);
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

/**
 * Hours a convoy of this line takes along the Admiralty route, at the speed convoys sail at
 * by themselves (the one that leaves no straggler), with no detour and no zigzag.
 */
export function crossingHours(world, line) {
  const route = line.admiraltyRoute.map(([lon, lat]) => project(lon, lat));
  return polylineLength(route) / (safeKnots(line.speedKn, world.rules.asw?.stragglerFrom) * KNOT_KMH);
}

/**
 * Where the tonnage stands against the objective, with the dollars left: what is unloaded,
 * what is at sea (paid for), and what the reserve can still buy for the convoys that can be
 * in port before the end. Losses to come are not counted, nor a Lend-Lease to come: it is
 * the forecast of a quartermaster, not a promise.
 * { fuel: { unloaded, atSea, buyable, total, target }, materiel: { ... }, lendLease }
 */
export function tonnageForecast(world) {
  const cur = world.currency;
  if (!cur) return null;
  const goal = (world.scenario.objectives || []).find((o) => o.type === 'tonnageDelivered') || {};
  const done = tonnesDelivered(world);
  const sea = { fuel: 0, materiel: 0 };
  for (const c of world.convoys) {
    if (c.state !== 'atSea' || c.type !== 'ocean') continue;
    sea.fuel += c.cargo.fuel;
    sea.materiel += c.cargo.materiel;
  }
  // The sailings to come, in order, each bought as far as the reserve goes (free once
  // Lend-Lease is voted); those that would reach port after the end are left out.
  const lend = Boolean(world.flags.lendLease);
  const sailings = [];
  for (const line of world.shipping.lines) {
    const crossS = crossingHours(world, line) * 3600;
    for (let k = line.sent; k < line.count; k++) {
      const atS = line.nextS + (k - line.sent) * line.everyHours * 3600;
      sailings.push({ line, atS, inTime: atS + crossS <= world.endS });
    }
  }
  sailings.sort((a, b) => a.atS - b.atS);
  let stock = cur.stock;
  const buy = { fuel: 0, materiel: 0 };
  for (const s of sailings) {
    const full = lineCost(world, s.line);
    const cost = lend ? 0 : Math.min(full, stock);
    const share = lend ? 1 : full > 0 ? cost / full : 0;
    stock -= cost;
    if (!s.inTime) continue;
    buy.fuel += s.line.tankers * s.line.fuelPerTanker * share;
    buy.materiel += s.line.freighters * s.line.materielPerFreighter * share;
  }
  const row = (k) => ({ unloaded: done[k], atSea: sea[k], buyable: buy[k], total: done[k] + sea[k] + buy[k], target: goal[k] || 0 });
  return { fuel: row('fuel'), materiel: row('materiel'), lendLease: lend };
}

function sail(world, line) {
  const n = line.firstNumber + line.sent;
  let k = 1;
  let cost = 0;
  if (world.currency && !world.flags.lendLease) {
    // Fully laden as long as the reserve can pay; the rest of the holds sails in ballast.
    const full = lineCost(world, line);
    cost = Math.min(full, world.currency.stock);
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
