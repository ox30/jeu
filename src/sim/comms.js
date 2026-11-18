// Radio silence at sea (N1). With the setting « Communications en mer » on silence, in a
// scenario at the rhythm of the watches, the headquarters sees its ships on the high seas by
// estimate only, and every way of talking to them has its price:
//
// - tracked waters (the waters closed to the U-boats, the approaches of the ports, the
//   surface cover of the coastal radars): everything as before, positions live and orders at
//   once;
// - elsewhere the place of a convoy or a group is an estimate, moved at each relief of the
//   watch, with a circle of doubt that grows since the last sure point. A sure point comes
//   from one of the player's aircraft in sight of the unit, from tracked waters, or from a
//   signal of the unit: after an attack (the U-boats know where it is anyway), or when asked
//   for its position;
// - an order goes by radio (it takes effect at the next relief; a new route may be read by
//   the B-Dienst, a position asked for gives the U-boat command a bearing), by the lamp of an
//   aircraft in sight (at once, at no cost), or by a group told in port or in tracked waters,
//   which hands it over when it joins the convoy.
//
// The standing orders of a group (stay or hunt, full or light patterns) need no signal: it
// applies them by itself. A group joining a convoy finds it where it really is.

import { createRandom } from '../core/random.js';
import { distance } from './geo.js';
import { emit } from './events.js';
import { declareFields } from './entities.js';
import { inClosedWaters } from './uboatnav.js';
import { isDaylight } from './daylight.js';
import { callBoats, noteConvoy } from './bdu.js';
import { currentSpeed } from './convoy.js';
import {
  addLeg, clearPlan, editShipRoute, escortHome, huntPlot, joinConvoy, leaveConvoy, removeLeg, routeConvoy, setConvoySpeed, setEscortBehaviour,
  setEscortPattern, setShipBoost, setShipSpeedPct, setZigzag, updateLeg,
} from './orders.js';
import { stopHunt } from './asw.js';
import { isFlying } from './squadron.js';
import { setShipEndAction } from './naval.js';

// The last sure point of a ship and its place on the table when that is an estimate.
for (const kind of ['convoy', 'escort']) {
  declareFields(kind, (u) => {
    u.fix = null; // { x, y, t, how: 'port' | 'tracked' | 'aircraft' | 'signal' | 'attack', by, g: [gx, gy] }
    u.est = null; // { x, y, t }: where the table shows it (null: its true place, live)
  });
}

export const SEA_COMMS = ['direct', 'silence'];

/** Radio silence applies: the scenario lives by the watches and the setting asks for it. */
export function isSilent(world) {
  return Boolean(world.watch) && world.settings.seaComms === 'silence';
}

function atSea(u) {
  return u.kind === 'escort' ? ['atSea', 'escorting', 'hunting', 'waiting'].includes(u.state) : u.state === 'atSea' || u.state === 'waiting';
}

/**
 * Waters where the headquarters follows its ships live: those closed to the U-boats, the
 * approaches of the ports, and what the coastal radars see on the surface.
 */
export function inTrackedWaters(world, x, y) {
  const R = world.rules.seaComms;
  if (inClosedWaters(world, x, y)) return true;
  // (Every port of the scenario is a friendly one: Halifax and Sydney as well as the Clyde.)
  for (const p of world.ports) if (distance(x, y, p.x, p.y) <= R.portKm) return true;
  for (const r of world.radars) if (r.surfaceKm && distance(x, y, r.x, r.y) <= r.surfaceKm) return true;
  return false;
}

/** One of the player's aircraft in sight of the ship (by day by eye, at night by ASV radar), or null. */
export function aircraftInSight(world, u) {
  const R = world.rules.seaComms;
  const day = isDaylight(world, u.x, u.y);
  for (const s of world.squadrons) {
    if (s.aircraft <= 0 || !isFlying(s)) continue;
    const km = day ? R.aircraftDayKm : s.asv ? R.aircraftAsvKm : R.aircraftNightKm;
    if (distance(s.x, s.y, u.x, u.y) <= km) return s;
  }
  return null;
}

/** Is the ship out of the headquarters' sight now (radio silence, at sea, untracked, unseen)? */
export function onHighSeas(world, u) {
  return isSilent(world) && atSea(u) && Boolean(u.est);
}

/**
 * The lean of the estimate for this sure point: two numbers drawn once from the seed, the
 * ship and the hour of the fix (never from the dice of the simulation), of length 2 at most.
 */
function leanOf(world, u) {
  if (u.fix.g) return u.fix.g;
  let h = (world.scenario.seed || 1) >>> 0;
  for (const ch of `${u.id}|${Math.round(u.fix.t)}`) h = (Math.imul(h ^ ch.charCodeAt(0), 0x9e3779b1) + 0x7f4a7c15) >>> 0;
  const rng = createRandom(h);
  let gx = rng.gauss();
  let gy = rng.gauss();
  const n = Math.hypot(gx, gy);
  if (n > 2) {
    gx *= 2 / n;
    gy *= 2 / n;
  }
  u.fix.g = [Math.round(gx * 1000) / 1000, Math.round(gy * 1000) / 1000];
  return u.fix.g;
}

/** Doubt (km, one sigma) on a dead-reckoned place `hours` after the last sure point. */
function sigmaKm(world, hours) {
  return world.rules.seaComms.driftKm * Math.sqrt(Math.max(0, hours));
}

function setFix(world, u, how, by = null) {
  u.fix = { x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10, t: world.t, how, by };
}

/**
 * Where the headquarters puts the ship now: its dead reckoning since the last sure point.
 * A group away hunting on its standing order is believed to be with its convoy.
 */
function reckon(world, u) {
  let x = u.x;
  let y = u.y;
  if (u.kind === 'escort' && u.state === 'hunting' && u.huntFor) {
    const c = world.convoys.find((v) => v.id === u.huntFor);
    if (c) [x, y] = [c.x, c.y];
  }
  const s = sigmaKm(world, (world.t - u.fix.t) / 3600);
  const [gx, gy] = leanOf(world, u);
  return { x: Math.round((x + gx * s) * 10) / 10, y: Math.round((y + gy * s) * 10) / 10, t: world.t };
}

/**
 * Where the table shows a ship: { x, y, est } and, for an estimate, radiusKm (the circle of
 * doubt: it holds the ship) and fix (the last sure point). The map, the sheets, the watch
 * reports and the automatic player all ask here.
 */
export function shownPosition(world, u) {
  if (!isSilent(world) || !u.est || !u.fix) return { x: u.x, y: u.y, est: false };
  const hours = (world.t - u.fix.t) / 3600;
  // The doubt of the reckoning, and the way made since the marker was last moved.
  const radiusKm = 2 * sigmaKm(world, hours) + currentSpeed(u) * (world.t - u.est.t) + 2;
  return { x: u.est.x, y: u.est.y, est: true, radiusKm, fix: u.fix };
}

// ---- orders --------------------------------------------------------------------------------

// The orders a ship can be sent: the name kept in a signal, and the function that carries it out.
const ORDERS = {
  route: (w, u, points) => routeConvoy(w, u, points),
  editRoute: (w, u, points) => editShipRoute(w, u, points),
  addLeg: (w, u, leg) => addLeg(w, u, leg),
  updateLeg: (w, u, index, leg) => updateLeg(w, u, index, leg),
  removeLeg: (w, u, index) => removeLeg(w, u, index),
  clearPlan: (w, u) => clearPlan(w, u),
  speedPct: (w, u, pct) => setShipSpeedPct(w, u, pct),
  boost: (w, u, on) => setShipBoost(w, u, on),
  convoySpeed: (w, u, kn) => setConvoySpeed(w, u, kn),
  zigzag: (w, u, on) => setZigzag(w, u, on),
  join: (w, u, convoyId) => joinConvoy(w, u, convoyId),
  leave: (w, u) => leaveConvoy(w, u),
  home: (w, u, portId) => escortHome(w, u, portId || null),
  behaviour: (w, u, value) => setEscortBehaviour(w, u, value),
  pattern: (w, u, value) => setEscortPattern(w, u, value),
  huntPlot: (w, u, plotId) => huntPlot(w, u, plotId),
  huntStop: (w, u) => stopHunt(w, u),
  endAction: (w, u, action) => setShipEndAction(w, u, action),
  position: (w, u) => reportPosition(w, u),
};

export const ORDER_NAMES = Object.keys(ORDERS);

/** How an order would reach the ship now: 'direct' (as before), 'lamp' (an aircraft in sight) or 'radio'. */
export function orderChannel(world, u) {
  if (!isSilent(world) || !atSea(u) || inTrackedWaters(world, u.x, u.y)) return 'direct';
  return aircraftInSight(world, u) ? 'lamp' : 'radio';
}

function unitOf(world, kind, id) {
  return (kind === 'escort' ? world.escorts : world.convoys).find((u) => u.id === id) || null;
}

function carryOut(world, u, name, args, via) {
  const before = u.routeVersion || 0;
  const result = ORDERS[name](world, u, ...args);
  // A routing handed over by lamp or by a ship is no radio signal: the B-Dienst cannot read it.
  if ((via === 'lamp' || via === 'ship') && (u.routeVersion || 0) !== before) u.quietRoute = u.routeVersion;
  return result;
}

/**
 * Sends an order to a ship: { ok, via, result?, at?, signalId? }. Direct or by lamp it is
 * carried out at once (`result` is what the order returned). By radio it waits for the next
 * relief; `ok` then only says that it is on its way.
 */
export function sendOrder(world, u, name, ...args) {
  if (!ORDERS[name]) return { ok: false, via: null, reason: 'unknown' };
  const via = orderChannel(world, u);
  if (via !== 'radio') {
    const result = carryOut(world, u, name, args, via);
    if (via === 'lamp') {
      const s = aircraftInSight(world, u);
      setFix(world, u, 'aircraft', s ? s.name : null);
      u.est = { x: u.x, y: u.y, t: world.t };
      emit(world, 'orderByLamp', { unit: u.name, unitId: u.id, unitKind: u.kind, by: s ? s.name : '', order: name });
    }
    const ok = result === true || Boolean(result && result.ok);
    return { ok, via, result };
  }
  // The same kind of order sent again replaces the one still waiting.
  const replace = ['route', 'editRoute', 'speedPct', 'boost', 'convoySpeed', 'zigzag', 'behaviour', 'pattern', 'endAction', 'position', 'home', 'join'];
  if (replace.includes(name)) world.signals = world.signals.filter((s) => !(s.unitId === u.id && s.name === name));
  const signal = { id: `S${world.nextSignalId++}`, unitKind: u.kind, unitId: u.id, name, args, via: 'radio', carrier: null, sentT: world.t };
  world.signals.push(signal);
  return { ok: true, via: 'radio', signalId: signal.id };
}

/** The orders waiting for a ship: [{ id, name, args, via, carrier, sentT }]. */
export function pendingOrders(world, u) {
  return world.signals.filter((s) => s.unitId === u.id && s.unitKind === u.kind);
}

export function cancelOrder(world, signalId) {
  const n = world.signals.length;
  world.signals = world.signals.filter((s) => s.id !== signalId);
  return world.signals.length < n;
}

/** Groups that can carry an order to this convoy: told in port or in tracked waters, and bound for it. */
export function carriersFor(world, convoyId) {
  return world.escorts.filter((e) => e.joinTarget === convoyId && !e.dry
    && (e.state === 'inPort' || (e.state === 'atSea' && inTrackedWaters(world, e.x, e.y))));
}

/** Gives a waiting order to a group to hand over when it joins (no signal on the air). */
export function carryByShip(world, signalId, escortId) {
  const s = world.signals.find((x) => x.id === signalId);
  if (!s || s.unitKind !== 'convoy' || !carriersFor(world, s.unitId).some((e) => e.id === escortId)) return false;
  s.via = 'ship';
  s.carrier = escortId;
  return true;
}

/** Asks a ship for its position (by radio at sea): a sure point, and a bearing for the enemy. */
export function requestPosition(world, u) {
  return sendOrder(world, u, 'position');
}

/** The ship breaks silence: a sure point for the table, and the U-boat command hears it too. */
function reportPosition(world, u) {
  setFix(world, u, 'signal');
  u.est = { x: u.x, y: u.y, t: world.t };
  const c = u.kind === 'convoy' ? u : world.convoys.find((v) => v.id === (u.escorting || u.huntFor)) || null;
  if (c && c.type === 'ocean') {
    noteConvoy(world, c, c.x, c.y, 1);
    callBoats(world, c, world.rules.seaComms.bearingCallKm);
  }
  emit(world, 'positionReported', { unit: u.name, unitId: u.id, unitKind: u.kind, x: u.x, y: u.y });
  return true;
}

function deliver(world, s, via) {
  const u = unitOf(world, s.unitKind, s.unitId);
  if (!u || !atSea(u)) return;
  const result = carryOut(world, u, s.name, s.args, via);
  const ok = result === true || Boolean(result && result.ok);
  emit(world, ok ? 'orderDelivered' : 'orderFailed', {
    unit: u.name, unitId: u.id, unitKind: u.kind, order: s.name, via, reason: result && result.reason ? result.reason : null,
    by: via === 'ship' ? (world.escorts.find((e) => e.id === s.carrier) || {}).name || '' : '',
  });
}

/**
 * Once a minute: the sure points (tracked waters, aircraft in sight, signals after an attack);
 * the orders carried by a group are handed over when it has joined. `first`: the events of
 * this step start there. At a relief (`relief` true) the radio orders go out and the
 * estimates on the table are moved.
 */
export function updateComms(world, first, relief) {
  if (!world.signals) return;
  const silent = isSilent(world);
  // An attack breaks the silence of the convoy and of its escort.
  let attacked = null;
  if (silent) {
    for (let i = first; i < world.events.length; i++) {
      const e = world.events[i];
      if (e.type === 'uboatAttack' || e.type === 'condorAttack') (attacked || (attacked = new Set())).add(e.convoyId);
    }
  }
  if (!attacked && world.t % 60 !== 0) return; // the rest is looked at once a minute
  for (const u of [...world.convoys, ...world.escorts]) {
    if (u.kind === 'convoy' && u.type !== 'ocean') continue; // coastal convoys sail in tracked waters
    if (!silent) {
      u.est = null;
      continue;
    }
    if (!atSea(u)) {
      u.est = null;
      if (u.kind === 'escort' && (!u.fix || u.fix.how !== 'port')) setFix(world, u, 'port');
      continue;
    }
    const withConvoy = u.kind === 'escort' ? u.escorting : u.id;
    if (attacked && attacked.has(withConvoy)) {
      setFix(world, u, 'attack');
      u.est = { x: u.x, y: u.y, t: world.t };
      continue;
    }
    if (world.t % 60 !== 0) continue;
    if (inTrackedWaters(world, u.x, u.y)) {
      setFix(world, u, 'tracked');
      u.est = null;
      continue;
    }
    const s = aircraftInSight(world, u);
    if (s) {
      setFix(world, u, 'aircraft', s.name);
      u.est = { x: u.x, y: u.y, t: world.t };
      continue;
    }
    if (!u.fix) setFix(world, u, 'tracked'); // met at sea for the first time (a straggler): from here
    if (!u.est || relief) u.est = reckon(world, u);
  }
  // Orders carried by a group: handed over when it is with the convoy.
  for (const s of [...world.signals]) {
    if (s.via !== 'ship') continue;
    const e = world.escorts.find((x) => x.id === s.carrier);
    if (e && e.escorting === s.unitId) {
      world.signals = world.signals.filter((x) => x !== s);
      deliver(world, s, 'ship');
    }
  }
  if (!relief) return;
  // The radio schedule of the relief: every order waiting goes out.
  const radio = world.signals.filter((s) => s.via === 'radio');
  world.signals = world.signals.filter((s) => s.via !== 'radio');
  for (const s of radio) deliver(world, s, 'radio');
}

export function createComms(world) {
  world.signals = [];
  world.nextSignalId = 1;
}
