// Logistics: what keeps the fighters flying. Ports, aerodromes and factories hold stocks of
// fuel and matériel (tonnes reserved for Fighter Command); convoys unload into the ports;
// trains carry the stocks along the railway, each line taking a limited number of trains a
// day; factories turn matériel into aircraft, ferried to the squadrons that lost some.

import { distance, project } from './geo.js';
import { emit } from './events.js';
import { airfieldDelayFactor, capacityFactor, isOperational } from './sites.js';

export const RESOURCES = ['fuel', 'materiel'];

function nodeOf(world, id) {
  return world.rail.nodes.get(id);
}

export function createLogistics(world, def) {
  const L = {
    enabled: Boolean(def),
    nodes: new Map(),
    links: [],
    adj: new Map(),
    paths: new Map(),
  };
  world.rail = L;
  world.trains = [];
  world.ferries = [];
  world.nextTrainId = 1;
  for (const site of world.sites.values()) {
    site.stocks = { fuel: 0, materiel: 0, aircraft: 0, ...(site.stocks || {}) };
    site.minStock = { fuel: null, materiel: null };
    site.progress = 0;
    site.starved = false;
    site.dryHours = 0;
  }
  if (!def) return;
  for (const j of def.junctions || []) {
    const [x, y] = project(j.lon, j.lat);
    L.nodes.set(j.id, { id: j.id, name: j.name, x, y, site: null });
  }
  const nodeFor = (id) => {
    if (L.nodes.has(id)) return L.nodes.get(id);
    const site = world.sites.get(id);
    if (!site) throw new Error(`rail: unknown node ${id}`);
    const node = { id, name: site.name, x: site.x, y: site.y, site: id };
    L.nodes.set(id, node);
    return node;
  };
  for (const r of def.rail) {
    const a = nodeFor(r.a);
    const b = nodeFor(r.b);
    const link = {
      a: a.id,
      b: b.id,
      km: distance(a.x, a.y, b.x, b.y) * world.rules.logistics.routeFactor,
      headway: 86400 / r.trainsPerDay,
      trainsPerDay: r.trainsPerDay,
      nextFree: 0,
    };
    L.links.push(link);
    for (const [from, to] of [[a.id, b.id], [b.id, a.id]]) {
      if (!L.adj.has(from)) L.adj.set(from, []);
      L.adj.get(from).push({ to, link });
    }
  }
}

/** Shortest rail path between two nodes: { nodes, links, km } or null. */
export function railPath(world, from, to) {
  const L = world.rail;
  const key = `${from}>${to}`;
  if (L.paths.has(key)) return L.paths.get(key);
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const open = new Set([from]);
  while (open.size) {
    let cur = null;
    for (const n of open) if (cur === null || dist.get(n) < dist.get(cur)) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const { to: next, link } of L.adj.get(cur) || []) {
      const d = dist.get(cur) + link.km;
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, { node: cur, link });
        open.add(next);
      }
    }
  }
  let result = null;
  if (dist.has(to)) {
    const nodes = [to];
    const links = [];
    let n = to;
    while (n !== from) {
      const p = prev.get(n);
      links.unshift(p.link);
      nodes.unshift(p.node);
      n = p.node;
    }
    result = { nodes, links, km: dist.get(to) };
  }
  L.paths.set(key, result);
  return result;
}

/** Hours a train needs from one installation to another (without waiting for a path). */
export function trainHours(world, fromKey, toKey) {
  const path = railPath(world, fromKey, toKey);
  if (!path) return null;
  const R = world.rules.logistics;
  return R.loadHours + path.km / R.trainKmh + R.unloadHours;
}

/** Tonnes of a resource on their way to an installation. */
export function inbound(world, key, resource) {
  let n = 0;
  for (const tr of world.trains) if (tr.to === key && tr.resource === resource) n += tr.amount;
  return n;
}

/** Can this installation send trains? Ports, factories and aerodromes in service can. */
function canLoad(world, site) {
  return isOperational(world, site);
}

/**
 * Loads a train at `fromKey` for `toKey`. Returns { ok, reason, train }.
 * `amount` defaults to a full train (or what is left in stock).
 */
export function dispatchTrain(world, fromKey, toKey, resource, amount = null, auto = false) {
  const R = world.rules.logistics;
  const from = world.sites.get(fromKey);
  const to = world.sites.get(toKey);
  if (!from || !to || fromKey === toKey) return { ok: false, reason: 'place' };
  if (!canLoad(world, from)) return { ok: false, reason: 'out' };
  const path = railPath(world, fromKey, toKey);
  if (!path) return { ok: false, reason: 'noLine' };
  const stock = from.stocks[resource] || 0;
  const wanted = amount ?? R.trainTonnes[resource];
  const load = Math.min(stock, wanted, R.trainTonnes[resource]);
  if (load < 1) return { ok: false, reason: 'empty' };
  from.stocks[resource] = stock - load;
  const train = {
    kind: 'train',
    id: `T${world.nextTrainId++}`,
    resource,
    amount: load,
    from: fromKey,
    to: toKey,
    path: path.nodes,
    links: path.links,
    seg: 0,
    km: 0,
    state: 'loading', // loading | waiting | moving | unloading
    timer: R.loadHours * 3600 * (from.kind === 'airfield' ? airfieldDelayFactor(world, from) : 1 / Math.max(0.25, capacityFactor(world, from))),
    x: from.x,
    y: from.y,
    px: from.x,
    py: from.y,
    departed: world.t,
    auto,
  };
  world.trains.push(train);
  const etaS = world.t + train.timer + (path.km / R.trainKmh + R.unloadHours) * 3600;
  emit(world, 'trainDispatched', {
    train: train.id, from: from.name, to: to.name, resource, amount: Math.round(load), etaMs: world.startMs + etaS * 1000, auto,
  });
  return { ok: true, train };
}

function updateTrain(world, tr, dt) {
  tr.px = tr.x;
  tr.py = tr.y;
  const R = world.rules.logistics;
  if (tr.state === 'loading' || tr.state === 'unloading') {
    tr.timer -= dt;
    if (tr.timer > 0) return false;
    if (tr.state === 'loading') {
      tr.state = 'waiting';
      return false;
    }
    const to = world.sites.get(tr.to);
    to.stocks[tr.resource] = (to.stocks[tr.resource] || 0) + tr.amount;
    world.stats.delivered[tr.resource] += tr.amount;
    emit(world, 'trainArrived', { train: tr.id, to: to.name, toKey: to.key, resource: tr.resource, amount: Math.round(tr.amount) });
    return true;
  }
  if (tr.state === 'waiting') {
    const link = tr.links[tr.seg];
    if (world.t < link.nextFree) return false;
    link.nextFree = world.t + link.headway;
    tr.state = 'moving';
    tr.km = 0;
  }
  const link = tr.links[tr.seg];
  tr.km += (R.trainKmh / 3600) * dt;
  const a = nodeOf(world, tr.path[tr.seg]);
  const b = nodeOf(world, tr.path[tr.seg + 1]);
  const k = Math.min(1, tr.km / link.km);
  tr.x = a.x + (b.x - a.x) * k;
  tr.y = a.y + (b.y - a.y) * k;
  if (k >= 1) {
    tr.seg++;
    if (tr.seg >= tr.links.length) {
      tr.state = 'unloading';
      tr.timer = R.unloadHours * 3600;
    } else {
      tr.state = 'waiting';
    }
  }
  return false;
}

export function updateTrains(world, dt) {
  if (!world.trains.length) return;
  world.trains = world.trains.filter((tr) => !updateTrain(world, tr, dt));
}

// ---- consumption, production, deliveries (once a minute) ---------------------------

/** Fuel needed to refuel a squadron after a sortie. */
export function sortieFuel(world, s) {
  return s.aircraft * world.rules.logistics.fuelPerAircraftSortie;
}

/** Takes fuel from an aerodrome's stock; false when there is not enough. */
export function drawFuel(world, field, tonnes) {
  if (!world.rail.enabled) return true;
  if (field.stocks.fuel + 1e-9 < tonnes) return false;
  field.stocks.fuel -= tonnes;
  world.stats.fuelUsed += tonnes;
  return true;
}

function homeFields(world) {
  const fields = new Set();
  for (const s of world.squadrons) if (s.state !== 'lost' || s.aircraft > 0) fields.add(s.home);
  return fields;
}

function consumeDaily(world, dt) {
  const R = world.rules.logistics;
  for (const id of homeFields(world)) {
    const f = world.byId.airfield.get(id);
    const use = Math.min(f.stocks.fuel, (R.baseDailyFuel * dt) / 86400);
    f.stocks.fuel -= use;
    world.stats.fuelUsed += use;
  }
}

function produce(world, dt) {
  for (const f of world.factories) {
    const factor = capacityFactor(world, f);
    if (f.stocks.materiel < f.materielPerAircraft) {
      f.starved = true;
      continue;
    }
    f.starved = false;
    f.progress += (f.perDay * factor * dt) / 86400;
    while (f.progress >= 1 && f.stocks.materiel >= f.materielPerAircraft) {
      f.progress -= 1;
      f.stocks.materiel -= f.materielPerAircraft;
      f.stocks.aircraft += 1;
      world.stats.aircraftBuilt++;
    }
  }
}

function inTransitTo(world, s) {
  let n = 0;
  for (const f of world.ferries) if (f.squadronId === s.id) n += f.count;
  return n;
}

/** Factories send new aircraft to the squadrons that need them (ferry pilots, a few hours). */
function deliver(world) {
  const R = world.rules.logistics;
  // Squadrons with the most missing aircraft first.
  const needy = world.squadrons
    .map((s) => ({ s, missing: s.aircraftStart - s.aircraft - inTransitTo(world, s) }))
    .filter((x) => x.missing > 0)
    .sort((a, b) => b.missing - a.missing);
  for (const { s, missing } of needy) {
    const home = world.byId.airfield.get(s.home);
    let best = null;
    for (const f of world.factories) {
      if (f.aircraftType !== s.type || f.stocks.aircraft < 1) continue;
      if (!best || distance(f.x, f.y, home.x, home.y) < distance(best.x, best.y, home.x, home.y)) best = f;
    }
    if (!best) continue;
    const n = Math.min(missing, Math.floor(best.stocks.aircraft), 4);
    best.stocks.aircraft -= n;
    world.ferries.push({ squadronId: s.id, count: n, from: best.name, eta: world.t + R.ferryHours * 3600 });
    emit(world, 'ferrySent', { squadron: s.name, squadronId: s.id, count: n, factory: best.name });
  }
  // Deliveries land at the home base when the squadron is on the ground.
  world.ferries = world.ferries.filter((f) => {
    if (world.t < f.eta) return true;
    const s = world.squadrons.find((x) => x.id === f.squadronId);
    if (!s) return false;
    if (s.state !== 'ready' && s.state !== 'refuelling' && s.state !== 'lost') return true;
    s.aircraft = Math.min(s.aircraftStart, s.aircraft + f.count);
    if (s.state === 'lost') {
      const home = world.byId.airfield.get(s.home);
      s.state = 'ready';
      s.airfield = home.id;
      s.x = home.x;
      s.y = home.y;
      s.px = home.x;
      s.py = home.y;
      s.fuel = world.rules.fighters[s.type].enduranceMin;
      s.ammo = 1;
    }
    world.stats.aircraftDelivered += f.count;
    emit(world, 'aircraftDelivered', { squadron: s.name, squadronId: s.id, count: f.count });
    return false;
  });
}

/** Convoys in port unload their cargo into the port's stock. */
function unloadConvoys(world, dt) {
  const R = world.rules.logistics;
  for (const c of world.convoys) {
    if (c.state !== 'arrived' || !c.unloading) continue;
    const port = world.byId.port.get(c.portId);
    const rate = (R.unloadPerHour * capacityFactor(world, port) * dt) / 3600;
    const total = c.cargo.fuel + c.cargo.materiel;
    if (total <= 0.01) {
      c.unloading = false;
      emit(world, 'convoyUnloaded', { convoy: c.name, convoyId: c.id, port: port.name });
      continue;
    }
    const k = Math.min(1, rate / total);
    for (const res of RESOURCES) {
      const moved = c.cargo[res] * k;
      c.cargo[res] -= moved;
      c.delivered[res] += moved;
      port.stocks[res] += moved;
      world.stats.unloaded[res] += moved;
    }
  }
}

/** Standing orders: keep an installation above its minimum stock with trains from the ports. */
function standingOrders(world) {
  const R = world.rules.logistics;
  const auto = world.settings.logistics === 'auto';
  const homes = homeFields(world);
  for (const site of world.sites.values()) {
    for (const res of RESOURCES) {
      let min = site.minStock[res];
      if (min === null && auto) {
        if (res === 'fuel' && site.kind === 'airfield' && homes.has(site.id)) min = R.autoMinimum.airfield;
        if (res === 'materiel' && site.kind === 'factory') min = R.autoMinimum.factory;
      }
      if (min === null || min <= 0) continue;
      if (site.stocks[res] + inbound(world, site.key, res) >= min) continue;
      // The port that can deliver soonest, with enough in stock.
      let best = null;
      for (const p of world.ports) {
        if (p.foreign || p.stocks[res] < 10 || !isOperational(world, p)) continue;
        const h = trainHours(world, p.key, site.key);
        if (h === null) continue;
        if (!best || h < best.h) best = { p, h };
      }
      if (best) dispatchTrain(world, best.p.key, site.key, res, null, true);
    }
  }
}

/** Fighter Command grounded: no fuel at any aerodrome where squadrons are based. */
function fuelOutage(world, dt) {
  let dry = true;
  for (const id of homeFields(world)) {
    const f = world.byId.airfield.get(id);
    if (f.stocks.fuel >= 1) dry = false;
  }
  world.dryHours = dry ? (world.dryHours || 0) + dt / 3600 : 0;
}

/** Once a minute of game time. */
export function updateLogistics(world, dt) {
  if (!world.rail.enabled) return;
  consumeDaily(world, dt);
  produce(world, dt);
  unloadConvoys(world, dt);
  if (world.t % 600 === 0) deliver(world);
  if (world.t % 1800 === 0) standingOrders(world);
  fuelOutage(world, dt);
  // Warn once when an aerodrome with squadrons has less than a day of fuel left.
  const R = world.rules.logistics;
  for (const id of homeFields(world)) {
    const f = world.byId.airfield.get(id);
    const day = R.baseDailyFuel + world.squadrons.filter((s) => s.home === id).reduce((n, s) => n + sortieFuel(world, s) * 2, 0);
    const low = f.stocks.fuel + inbound(world, f.key, 'fuel') < day * R.lowFuelDays;
    if (low && !f.lowWarned) {
      f.lowWarned = true;
      emit(world, 'lowFuel', { airfield: f.name, airfieldId: f.id, fuel: Math.round(f.stocks.fuel) });
    } else if (!low && f.lowWarned && f.stocks.fuel > day * 1.5) {
      f.lowWarned = false;
    }
  }
}

/** Bombs destroy part of the stocks of an installation. */
export function bombStocks(world, site, damageAdded) {
  if (!world.rail.enabled) return;
  const k = Math.min(0.6, damageAdded * world.rules.logistics.stockLossPerDamage);
  const lost = {};
  let any = false;
  for (const res of ['fuel', 'materiel', 'aircraft']) {
    const v = site.stocks[res] || 0;
    const n = res === 'aircraft' ? Math.floor(v * k) : v * k;
    if (n <= 0) continue;
    site.stocks[res] = v - n;
    lost[res] = Math.round(n);
    any = any || lost[res] > 0;
  }
  if (any) emit(world, 'stocksLost', { site: site.key, siteName: site.name, ...lost });
}

/** Days of fuel left at an aerodrome at the usual rate (two sorties a day per squadron). */
export function fuelDays(world, field) {
  const based = world.squadrons.filter((s) => s.home === field.id && s.state !== 'lost');
  if (!based.length) return null;
  const perDay = world.rules.logistics.baseDailyFuel + based.reduce((n, s) => n + sortieFuel(world, s) * 2, 0);
  return field.stocks.fuel / perDay;
}
