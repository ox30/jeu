// What a ship has been told and does not know yet: under radio silence an order to a ship on
// the high seas waits for the next relief of the watch (or for the group that carries it).
// Until then the map and the sheet show it as on its way, and the player goes on working on
// it: a second line after the first, a point moved, another leg.

import { cancelOrder, pendingOrders, shownPosition } from '../sim/comms.js';
import { editableRoute, plannedLegs, planTrack, routeCanExtend } from '../sim/orders.js';

const ROUTINGS = new Set(['route', 'editRoute']);
const LEG_ORDERS = new Set(['addLeg', 'updateLeg', 'removeLeg', 'clearPlan']);

/**
 * The route and the legs a ship will have once the orders on their way are carried out, in
 * the order they were sent: { route, legs }.
 *   route: { id, name, points, via, carrier } — the routing still waiting ('route': a line
 *          drawn from the ship; 'editRoute': its route changed), or null;
 *   legs:  the plan as it will be when leg orders wait, or null (nothing on its way).
 * A routing does away with the legs, and a leg added does away with the route: as when the
 * orders are carried out.
 */
export function awaited(world, u) {
  if (!u || (u.kind !== 'convoy' && u.kind !== 'escort') || !world.signals || !world.signals.length) return { route: null, legs: null };
  let route = null;
  let changes = [];
  let base = u.plan;
  for (const s of pendingOrders(world, u)) {
    if (ROUTINGS.has(s.name) && Array.isArray(s.args[0])) {
      route = { id: s.id, name: s.name, points: s.args[0], via: s.via, carrier: s.carrier };
      changes = [];
      base = [];
    } else if (LEG_ORDERS.has(s.name)) {
      changes.push(s);
      if (s.name === 'addLeg') route = null;
    }
  }
  const legs = changes.length ? plannedLegs(world, u, changes, base) : null;
  return { route, legs };
}

/** The legs the sheet lists and the orders count from: those on their way, or the ship's own. */
export function plannedPlan(world, u) {
  return awaited(world, u).legs || u.plan;
}

/**
 * The route the player works on with the mouse: the one on its way to the ship when there is
 * one, else the ship's own (or a squadron's).
 *   points: the points that can be moved; pending: the name of the order that waits, or
 *   null; canExtend: a line can be drawn on from its end.
 */
export function workingRoute(world, u) {
  if (!u) return { points: null, pending: null, canExtend: false };
  const w = awaited(world, u).route;
  if (w) return { points: w.points, pending: w.name, id: w.id, canExtend: w.name === 'route' || routeCanExtend(u) };
  return { points: editableRoute(u), pending: null, canExtend: routeCanExtend(u) };
}

/**
 * An order just sent by radio does away with those still waiting that it would overwrite
 * when carried out: a line drawn from the ship replaces the changes to the old route and the
 * legs; a leg added replaces the line (the ship drops its route to steer by its legs).
 */
export function supersede(world, u, name, keepId) {
  const gone = name === 'route' ? new Set(['editRoute', ...LEG_ORDERS]) : name === 'addLeg' ? ROUTINGS : null;
  if (!gone || !world.signals) return;
  for (const s of pendingOrders(world, u)) if (s.id !== keepId && gone.has(s.name) && s.via === 'radio') cancelOrder(world, s.id);
}

// (The last answer of awaitedLand: the map asks at every frame for the ship in hand.)
let landMemo = { key: '', at: null };

/**
 * Where the route or the legs on their way to a ship would touch land, seen from where the
 * table holds it: [x, y], or null. The order is only checked when it is carried out, from
 * where the ship then is; this is the warning the player gets before it leaves.
 */
export function awaitedLand(world, u) {
  const w = awaited(world, u);
  if (!w.route && !(w.legs && w.legs.length)) return null;
  const p = shownPosition(world, u);
  const key = `${u.kind}:${u.id}:${pendingOrders(world, u).map((s) => s.id).join(',')}:${Math.round(p.x)}:${Math.round(p.y)}`;
  if (key === landMemo.key) return landMemo.at;
  let pts;
  if (w.route) {
    const head = w.route.name === 'editRoute' && u.kind === 'escort' ? Math.min(u.routeHead || 0, u.route.length) : 0;
    const lead = head > 0 ? u.route[head - 1] : [p.x, p.y];
    pts = [[lead[0], lead[1]], ...w.route.points.map(([x, y]) => [x, y])];
  } else {
    pts = planTrack(world, u, w.legs, { x: p.x, y: p.y, t: world.t }).filter((q) => !q.open).map((q) => [q.x, q.y]);
  }
  // (The end of a line may be a port: its last kilometres are the harbour's, as when it is carried out.)
  const at = pts.length > 1 ? world.terrain.findLandOnRoute(pts, 0, w.route ? world.rules.convoy.harbourMarginKm : 0) : null;
  landMemo = { key, at: at || null };
  return landMemo.at;
}
