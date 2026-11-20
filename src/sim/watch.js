// The sea at the rhythm of the watches. In a scenario with ships (hasShips) the player
// commands from a headquarters ashore: what happens on the high seas no longer calls him
// event by event. It is noted, and every four hours, at the relief of the watch, a report is
// written whether the game stops or not: the convoys, the escort groups, the air, the
// intelligence, and what waits for a decision. Near us — in the waters the headquarters
// follows, or under one of its aircraft — a ship keeps its alerts as they come (followedLive).
//
// The game stops at a relief when a new decision waits (by default), and on the hours the
// player asked for (morning and evening, or every relief). Between two reliefs it stops for
// one thing only: the first attack on a convoy in the night. Air raids keep their own alerts.
//
// The reports are part of the world (and of its saves): world.watch.reports.

import { distance } from './geo.js';
import { emit, onEmit } from './events.js';
import { currentSpeed } from './convoy.js';
import { isPatrol } from './patrols.js';
import { inClosedWaters } from './uboatnav.js';
import { followedLive, inTrackedWaters, pendingOrders, shownPosition, watchesOverAShip } from './comms.js';

export const WATCH_S = 4 * 3600;

/** Stops at the reliefs: on a decision only, morning and evening too, or at every relief. */
export const WATCH_STOPS = ['decision', 'twice', 'every'];

/**
 * A scenario with ships lives at the rhythm of the watches (decision of 20 November 2026):
 * convoys at sea or in port as it begins, escort groups, or convoys that will sail. The rule
 * is read on the scenario as the game plays it — a lesson with the keys of its base — so
 * that no scenario has to say it, and none can forget it.
 */
export function hasShips(scenario) {
  return ['convoys', 'escorts', 'convoySchedule'].some((k) => Array.isArray(scenario[k]) && scenario[k].length > 0);
}

export function createWatch(world) {
  world.watch = hasShips(world.scenario)
    ? { notes: [], reports: [], nextId: 1, asked: [], told: [], nights: {} }
    : null;
}

/** Seconds on the game's clock (the one the player reads) since 1970: negative in 1941. */
function clockS(world, t = world.t) {
  return Math.round(world.startMs / 1000) + t;
}

/** Is this second the relief of a watch (0, 4, 8... by the clock)? */
export function isRelief(world) {
  return clockS(world) % WATCH_S === 0;
}

/** The hour of the clock (0, 4, 8…) at which the next report will be written. */
export function nextReliefHour(world) {
  const s = clockS(world);
  const next = (Math.floor(s / WATCH_S) + 1) * WATCH_S;
  return clockHour(world, world.t + (next - s));
}

/** The hour of the clock (0 to 23) at game time `t`. */
export function clockHour(world, t = world.t) {
  const inDay = ((clockS(world, t) % 86400) + 86400) % 86400;
  return Math.floor(inDay / 3600);
}

// ---- what is noted during a watch -------------------------------------------------------

// Each kind of event kept for the report: its family (the filters of the page), and whether
// it counts as a loss or an attack. What the enemy does unseen is not here.
const NOTED = {
  uboatAttack: 'attack', shipsSunk: 'attack', convoyLost: 'attack', condorAttack: 'attack', convoyBombed: 'attack', straggler: 'convoy',
  uboatSighted: 'uboat', uboatSunk: 'uboat', aircraftAttack: 'uboat', escortEngaged: 'uboat', escortHunting: 'uboat', escortHuntOver: 'uboat',
  uboatDrivenOff: 'uboat', depthChargePass: 'uboat',
  dfFix: 'intel', convoySighted: 'intel', condorSighted: 'intel',
  escortJoined: 'escort', escortLowFuel: 'escort', escortDry: 'escort', escortChargesOut: 'escort', escortInPort: 'escort', escortReady: 'escort',
  escortRadar: 'escort', convoyWaiting: 'escort',
  convoyDeparted: 'convoy', convoyArrived: 'convoy', convoyStopped: 'convoy', convoyInEscortRange: 'convoy', convoyEndAction: 'convoy',
  airborne: 'air', squadronLost: 'air', offerBought: 'convoy', scenarioEvent: 'intel',
};

/** The family a watch report files this kind of event under, or null when it keeps none. */
export function watchFamily(type) {
  return NOTED[type] || null;
}

/** Every kind of event a watch report may keep. */
export const NOTED_TYPES = Object.keys(NOTED);

/** Does this event belong in the watch report? (A pass that changed nothing does not.) */
function isNoted(world, e) {
  if (!NOTED[e.type]) return false;
  if (e.type === 'depthChargePass') return e.result === 'damaged';
  if (e.type === 'airborne') {
    const s = world.squadrons.find((x) => x.id === e.squadronId);
    return Boolean(s && isPatrol(s) && s.role === 'coastal');
  }
  if (e.type === 'convoyWaiting') return e.unitKind === 'escort' ? world.t >= 120 : true;
  if (e.type === 'uboatSighted' && e.attack) return false; // the attack that follows says it
  if (e.type === 'scenarioEvent') return !e.important; // an important one opens its own page
  return true;
}

/** The event as kept in a report: its family, and its places rounded to the kilometre. */
function noteOf(e) {
  const note = { ...e, family: NOTED[e.type] };
  for (const k of ['x', 'y']) if (typeof note[k] === 'number') note[k] = Math.round(note[k]);
  for (const k of ['lat', 'lon']) if (typeof note[k] === 'number') note[k] = Math.round(note[k] * 100) / 100;
  delete note.stats;
  return note;
}

/** The night an attack belongs to: from noon to noon, numbered. */
function nightOf(world) {
  return Math.floor((clockS(world) - 12 * 3600) / 86400);
}

/** The ship an event of the sea is about: the group or the convoy it names, or null. */
function shipOf(world, e) {
  if (e.escortId) return world.escorts.find((x) => x.id === e.escortId) || null;
  if (e.type === 'uboatSighted') return e.unitKind === 'escort' ? world.escorts.find((x) => x.id === e.byId) || null : null;
  if (e.convoyId) return (e.unitKind === 'escort' ? world.escorts : world.convoys).find((x) => x.id === e.convoyId) || null;
  return null;
}

/**
 * Does this event of the sea happen near us? Its ship is in the waters the headquarters
 * follows, or under one of its aircraft (followedLive). A U-boat seen by an aircraft has no
 * ship of its own: it is near us when seen in those waters, or by an aircraft that watches
 * over one of our ships. Such an event calls the player as it comes, as it does without the
 * watches; elsewhere it waits for the report. Either way the report notes it.
 */
export function happensNearUs(world, e) {
  const u = shipOf(world, e);
  if (u) return followedLive(world, u);
  if (e.type === 'uboatSighted' && e.unitKind === 'squadron' && typeof e.x === 'number') {
    if (inTrackedWaters(world, e.x, e.y)) return true;
    const s = world.squadrons.find((x) => x.id === e.byId);
    return Boolean(s && watchesOverAShip(world, s));
  }
  return false;
}

// A decision the player was called for as it came (an alert near us) is asked: the relief
// lists it without stopping the game for it again.
const DECISION_OF = {
  convoyInEscortRange: (e) => `reach:${e.convoyId}`,
  convoyWaiting: (e) => `waiting:${e.convoyId}`,
  convoyStopped: (e) => `waiting:${e.convoyId}`,
  escortChargesOut: (e) => `charges:${e.escortId}`,
};

/**
 * Every event, as it is emitted — by a step of the world or by an order given between two
 * steps (an aircraft bought, a hunt ordered on a plot): the sea events go to the notes of the
 * watch under way. One that happens near us is marked `live` (the page gives its alert at
 * once: alertRules.js). On the high seas, the first attack on a convoy in the night stops
 * the game at once; near us its alert has called the player, and counts for the night.
 */
function noteEvent(world, e) {
  const W = world.watch;
  if (!W || !isNoted(world, e)) return;
  W.notes.push(noteOf(e));
  const live = happensNearUs(world, e);
  if (live) {
    e.live = true;
    const key = DECISION_OF[e.type] ? DECISION_OF[e.type](e) : null;
    if (key && !W.asked.includes(key)) W.asked.push(key);
  }
  if (e.type !== 'uboatAttack') return;
  // A straggler counts with its convoy: one stop a convoy and a night.
  const c = world.convoys.find((x) => x.id === e.convoyId);
  const id = c && c.parentId ? c.parentId : e.convoyId;
  const night = nightOf(world);
  if (W.nights[id] === night) return;
  W.nights[id] = night;
  if (live) return;
  emit(world, 'seaStop', { reason: 'attack', convoy: e.convoy, convoyId: e.convoyId, sunk: e.sunk, x: e.x, y: e.y });
}

// ---- what waits for a decision ----------------------------------------------------------

// Orders that give a convoy something to follow, or say how what it follows ends.
const ROUTING_ORDERS = new Set(['route', 'editRoute', 'addLeg', 'updateLeg', 'endAction']);

/**
 * A convoy at sea with nothing left to follow: no line, no legs, no end told for them, and
 * no such order on its way to it (by radio at the next relief, or carried by a group). It
 * keeps its course, as far as the sea goes.
 */
export function noRoute(world, c) {
  if (c.state !== 'atSea' || c.route.length || c.plan.length || c.endAction) return false;
  return !pendingOrders(world, c).some((s) => ROUTING_ORDERS.has(s.name));
}


/** The groups that sail with a convoy, are on their way to it, or hunt for it. */
export function groupsOf(world, convoyId) {
  return world.escorts.filter((e) => e.escorting === convoyId || e.joinTarget === convoyId || e.huntFor === convoyId);
}

/** Groups in port, ready to sail. */
export function freeGroups(world) {
  return world.escorts.filter((e) => e.state === 'inPort' && !e.dry);
}

/** The way a ship follows over the next `hours`: [[x, y], ...] from where the table shows it. */
function wayAhead(world, u, hours) {
  let left = currentSpeed(u) * 3600 * hours;
  const p = shownPosition(world, u);
  const way = [[p.x, p.y]];
  for (const p of u.route) {
    const [ax, ay] = way[way.length - 1];
    const d = distance(ax, ay, p[0], p[1]);
    if (d >= left) {
      const k = d > 0 ? left / d : 0;
      way.push([ax + (p[0] - ax) * k, ay + (p[1] - ay) * k]);
      return way;
    }
    way.push([p[0], p[1]]);
    left -= d;
  }
  return way;
}

/** Shortest distance (km) from a point to a way. */
function distanceToWay(way, x, y) {
  let best = distance(way[0][0], way[0][1], x, y);
  for (let i = 1; i < way.length; i++) {
    const [ax, ay] = way[i - 1];
    const [bx, by] = way[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, distance(ax + dx * k, ay + dy * k, x, y));
  }
  return best;
}

/**
 * The U-boat markers on the way of a convoy over the next day: the plots of boats seen
 * (within `plotKm`) and the direction-finding fixes whose zone the way crosses.
 * [{ kind: 'plot' | 'df', id, key, x, y, t }]
 */
export function markersOnWay(world, c) {
  const R = world.rules.watches;
  const way = wayAhead(world, c, R.routeAheadH);
  const out = [];
  for (const p of world.uboatPlots) {
    if (distanceToWay(way, p.x, p.y) > R.plotKm) continue;
    out.push({ kind: 'plot', id: p.id, x: p.x, y: p.y, t: p.t });
  }
  for (const z of world.dfZones) {
    if (distanceToWay(way, z.x, z.y) > z.r) continue;
    out.push({ kind: 'df', id: `df${Math.round(z.t)}`, x: z.x, y: z.y, t: z.t });
  }
  return out;
}

/**
 * What waits for the player now, each with a key that tells one decision from another:
 * - reach: a convoy with no escort within reach of a group ready in port;
 * - waiting: a group at sea that has finished its orders, or ships stopped;
 * - charges: a group at sea with empty racks;
 * - marker: U-boat markers on the way of a convoy within a day. Asked once for each routing
 *   of the convoy: the player who keeps the route has answered; a new route is a new question;
 * - adrift: a convoy at sea with nothing left to follow, that keeps its course (noRoute).
 * The coastal convoys count for what stops them or leaves them without a route; the escort
 * and the markers are a matter of the ocean.
 */
export function pendingDecisions(world) {
  const out = [];
  const E = world.rules.escortGroups;
  const free = freeGroups(world);
  const bases = free.map((e) => world.byId.port.get(e.portId)).filter(Boolean);
  for (const c of world.convoys) {
    if (c.state === 'waiting') {
      out.push({ kind: 'waiting', key: `waiting:${c.id}`, unitKind: 'convoy', unitId: c.id });
      continue;
    }
    if (c.state !== 'atSea') continue;
    if (noRoute(world, c)) out.push({ kind: 'adrift', key: `adrift:${c.id}`, unitKind: 'convoy', unitId: c.id, heading: Math.round(c.course), admiralty: c.admiraltyRoute.length > 0 });
    if (c.type !== 'ocean') continue;
    // (Once in the waters closed to the U-boats, a convoy needs no escort any more.)
    const at = shownPosition(world, c); // the headquarters decides on what its table shows
    if (!c.straggler && bases.length && !groupsOf(world, c.id).length && !inClosedWaters(world, at.x, at.y)) {
      const near = Math.min(...bases.map((p) => distance(at.x, at.y, p.x, p.y)));
      if (near <= E.alertKm) {
        // The groups that could go, the nearest first.
        const groups = [...free].sort((a, b) => distance(a.x, a.y, at.x, at.y) - distance(b.x, b.y, at.x, at.y)).map((e) => e.id);
        out.push({ kind: 'reach', key: `reach:${c.id}`, unitKind: 'convoy', unitId: c.id, groups, km: Math.round(near) });
      }
    }
    if (c.straggler) continue;
    const markers = markersOnWay(world, c);
    if (markers.length) {
      const newest = markers.reduce((a, b) => (b.t > a.t ? b : a));
      out.push({
        kind: 'marker', key: `marker:${c.id}:${c.routeVersion || 0}`, once: true, unitKind: 'convoy', unitId: c.id,
        plots: markers.filter((m) => m.kind === 'plot').length, fixes: markers.filter((m) => m.kind === 'df').length,
        x: Math.round(newest.x), y: Math.round(newest.y),
      });
    }
  }
  for (const e of world.escorts) {
    const atSea = e.state === 'atSea' || e.state === 'escorting' || e.state === 'hunting' || e.state === 'waiting';
    if (!atSea || e.dry) continue;
    if (e.state === 'waiting') out.push({ kind: 'waiting', key: `waiting:${e.id}`, unitKind: 'escort', unitId: e.id });
    if (e.charges <= 0 && !e.homeward) out.push({ kind: 'charges', key: `charges:${e.id}`, unitKind: 'escort', unitId: e.id, convoyId: e.escorting || e.huntFor || e.joinTarget || null });
  }
  return out;
}

// ---- the report of a watch --------------------------------------------------------------

const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);

/** Leaves out what is zero, false, null or empty: the reports of a whole game stay small. */
function lean(row) {
  for (const [k, v] of Object.entries(row)) if (v === 0 || v === false || v === null || (Array.isArray(v) && !v.length)) delete row[k];
  return row;
}

/**
 * The row of a convoy in a report (stragglers count with their convoy):
 * { id, ships, x, y } and, when they apply, state (when not at sea), lost and attacks (this watch), stragglers,
 * escorts and joining (group ids), markers (on its way), est (the place is an estimate),
 * adrift (nothing left to follow).
 */
function convoyRow(world, c, notes) {
  const ids = new Set([c.id, ...(c.children || [])]);
  const mine = notes.filter((n) => ids.has(n.convoyId));
  const attacks = mine.filter((n) => n.type === 'uboatAttack' || n.type === 'condorAttack' || n.type === 'convoyBombed');
  const stragglers = (c.children || []).map((id) => world.convoys.find((x) => x.id === id)).filter((s) => s && s.state === 'atSea').length;
  const at = shownPosition(world, c);
  return lean({
    id: c.id,
    state: c.state === 'atSea' ? null : c.state, // at sea unless said otherwise
    ships: c.ships,
    x: Math.round(at.x),
    y: Math.round(at.y),
    lost: sum(attacks, (n) => n.sunk || 0),
    attacks: attacks.length,
    stragglers,
    escorts: world.escorts.filter((e) => e.escorting === c.id || e.huntFor === c.id).map((e) => e.id),
    joining: world.escorts.filter((e) => e.joinTarget === c.id).map((e) => e.id),
    markers: c.state === 'atSea' && c.type === 'ocean' ? markersOnWay(world, c).length : 0,
    est: at.est, // the place is an estimate (radio silence)
    adrift: noRoute(world, c), // nothing left to follow: it keeps its course
  });
}

/**
 * The row of an escort group: { id, state, days (of fuel), charges } and, when they apply,
 * hunt (told to hunt), light (light patterns), radar, convoy, homeward, dry, port.
 */
function escortRow(world, e) {
  return lean({
    id: e.id,
    state: e.state,
    days: Math.round(Math.max(0, e.endurance) / 8640) / 10,
    charges: e.charges,
    empty: e.charges <= 0,
    hunt: e.behaviour === 'hunt',
    light: e.pattern === 'light',
    radar: Boolean(e.radar),
    convoy: e.escorting || e.joinTarget || e.huntFor || null,
    homeward: Boolean(e.homeward),
    dry: Boolean(e.dry),
    port: e.state === 'inPort' || e.state === 'refit' ? e.portId : e.homeward ? e.destination : null,
  });
}

/** Has this report nothing to say (no event, no new decision)? Such a report is not « unread ». */
export function isQuiet(r) {
  return !(r.notes && r.notes.length) && !(r.fresh && r.fresh.length);
}

/** The two or three things a folded line says: [{ key, ...params }], the gravest first. */
function headline(report, notes) {
  const out = [];
  for (const c of report.convoys || []) if (c.attacks) out.push({ key: c.lost ? 'attackedLost' : 'attacked', convoyId: c.id, n: c.lost || 0 });
  const sunk = notes.filter((n) => n.type === 'uboatSunk').length;
  if (sunk) out.push({ key: 'uboatSunk', n: sunk });
  if (report.fresh) out.push({ key: 'decisions', n: report.fresh.length });
  for (const n of notes) {
    if (out.length >= 3) break;
    if (n.type === 'convoyArrived') out.push({ key: 'arrived', convoyId: n.convoyId });
    else if (n.type === 'convoyDeparted') out.push({ key: 'departed', convoyId: n.convoyId });
    else if (n.type === 'escortChargesOut') out.push({ key: 'chargesOut', escortId: n.escortId });
    else if (n.type === 'escortRadar') out.push({ key: 'radar', escortId: n.escortId });
  }
  if (!out.length) {
    const plots = notes.filter((n) => n.type === 'uboatSighted' || n.type === 'dfFix').length;
    out.push(plots ? { key: 'markers', n: plots } : { key: 'quiet' });
  }
  return out.slice(0, 3);
}

/**
 * Writes the report of the watch that ends now:
 * { id, toS, convoys: [row], escorts: [row], headline: [{ key, ... }] } and, when there is
 * something to say, air: { sorties, sightings, attacks, sunk, lost }, intel: { plots, fixes,
 * shadowed: [convoy ids], condors: [{ convoyId, attack, sunk }] }, notes: [events of the
 * watch], decisions: [what waits], fresh: [keys of the decisions new at this relief],
 * stop: 'decision' | 'fixed'. Use the readers below rather than the fields: what is empty is
 * left out, so that the reports of a whole game stay small in a save.
 */
function writeReport(world) {
  const W = world.watch;
  const notes = W.notes;
  W.notes = [];
  const convoys = [];
  for (const c of world.convoys) {
    if (c.straggler) continue; // (ocean and coastal convoys alike: every convoy of the game)
    const ids = new Set([c.id, ...(c.children || [])]);
    const active = c.state === 'atSea' || c.state === 'waiting' || notes.some((n) => ids.has(n.convoyId));
    if (active) convoys.push(convoyRow(world, c, notes));
  }
  const count = (f) => notes.filter(f).length;
  const byAir = (n) => world.squadrons.some((s) => s.name === n.by);
  const air = lean({
    sorties: count((n) => n.type === 'airborne'),
    sightings: count((n) => n.type === 'uboatSighted' && n.unitKind === 'squadron'),
    attacks: count((n) => n.type === 'aircraftAttack' || (n.type === 'uboatSunk' && byAir(n))),
    sunk: count((n) => n.type === 'uboatSunk' && byAir(n)),
    lost: count((n) => n.type === 'squadronLost'),
  });
  const intel = lean({
    plots: count((n) => n.type === 'uboatSighted'),
    fixes: count((n) => n.type === 'dfFix'),
    shadowed: [...new Set(notes.filter((n) => n.type === 'convoySighted').map((n) => n.convoyId))],
    condors: notes.filter((n) => n.type === 'condorSighted' || n.type === 'condorAttack').map((n) => lean({ convoyId: n.convoyId, attack: n.type === 'condorAttack', sunk: n.sunk || 0 })),
  });
  const decisions = pendingDecisions(world);
  // A decision stops the game at the relief where it appears. Left unanswered, it stays in
  // the list of the next reports without stopping again; once gone, it may come back, except
  // those asked once only (the markers on a route: once for each routing of the convoy).
  const fresh = decisions.filter((d) => !W.asked.includes(d.key) && !W.told.includes(d.key)).map((d) => d.key);
  W.asked = decisions.map((d) => d.key);
  for (const d of decisions) if (d.once && !W.told.includes(d.key)) W.told.push(d.key);
  const mode = WATCH_STOPS.includes(world.settings.watchStops) ? world.settings.watchStops : 'decision';
  const hour = clockHour(world);
  const stop = fresh.length ? 'decision' : mode === 'every' || (mode === 'twice' && (hour === 8 || hour === 20)) ? 'fixed' : null;
  const report = lean({
    id: `W${W.nextId++}`,
    toS: world.t,
    convoys,
    escorts: world.escorts.map((e) => escortRow(world, e)),
    air: Object.keys(air).length ? air : null,
    intel: Object.keys(intel).length ? intel : null,
    notes,
    decisions,
    fresh,
    stop,
  });
  report.headline = headline(report, notes);
  W.reports.push(report);
  emit(world, 'watchReport', { reportId: report.id, stop, decisions: decisions.length, fresh: fresh.length });
  if (stop) emit(world, 'seaStop', { reason: 'relief', reportId: report.id, why: stop, decisions: fresh.length });
  return report;
}

// ---- readers: a report with its empty parts back in place ------------------------------

const EMPTY_AIR = { sorties: 0, sightings: 0, attacks: 0, sunk: 0, lost: 0 };
const EMPTY_INTEL = { plots: 0, fixes: 0, shadowed: [], condors: [] };

/** The report with every part present (what was left out is zero, false or empty). */
export function fullReport(world, r) {
  return {
    id: r.id,
    toS: r.toS,
    fromS: Math.max(0, r.toS - WATCH_S),
    convoys: (r.convoys || []).map((c) => ({ state: 'atSea', lost: 0, attacks: 0, stragglers: 0, escorts: [], joining: [], markers: 0, est: false, adrift: false, ...c })),
    escorts: (r.escorts || []).map((e) => {
      const unit = world.escorts.find((x) => x.id === e.id);
      return {
        hunt: false, light: false, radar: false, convoy: null, homeward: false, dry: false, port: null, charges: 0, days: 0, ...e,
        max: unit ? unit.chargesMax : e.charges || 0,
      };
    }),
    air: { ...EMPTY_AIR, ...(r.air || {}) },
    intel: { ...EMPTY_INTEL, ...(r.intel || {}) },
    notes: r.notes || [],
    decisions: r.decisions || [],
    fresh: r.fresh || [],
    stop: r.stop || null,
    headline: r.headline || [],
  };
}

/** Every second: at the relief of the watch (0, 4, 8... by the clock), the report is written. */
export function updateWatch(world) {
  if (!world.watch || !isRelief(world)) return;
  writeReport(world);
}

/** The report with this id (or the last one written), every part present; null if none. */
export function watchReport(world, id = null) {
  const list = world.watch ? world.watch.reports : [];
  const r = id ? list.find((x) => x.id === id) : list[list.length - 1];
  return r ? fullReport(world, r) : null;
}

onEmit(noteEvent);
