// The sea at the rhythm of the watches. In a scenario whose sea rhythm is 'watches' the
// player commands from a headquarters ashore: what happens at sea no longer calls him event
// by event. It is noted, and every four hours, at the relief of the watch, a report is
// written whether the game stops or not: the convoys, the escort groups, the air, the
// intelligence, and what waits for a decision.
//
// The game stops at a relief when a new decision waits (by default), and on the hours the
// player asked for (morning and evening, or every relief). Between two reliefs it stops for
// one thing only: the first attack on a convoy in the night. Air raids keep their own alerts.
//
// The reports are part of the world (and of its saves): world.watch.reports.

import { distance } from './geo.js';
import { emit } from './events.js';
import { currentSpeed } from './convoy.js';
import { isPatrol } from './patrols.js';

export const WATCH_S = 4 * 3600;

/** Stops at the reliefs: on a decision only, morning and evening too, or at every relief. */
export const WATCH_STOPS = ['decision', 'twice', 'every'];

export function createWatch(world) {
  world.watch = world.scenario.seaRhythm === 'watches'
    ? { notes: [], reports: [], nextId: 1, asked: [], told: [], nights: {} }
    : null;
}

/** Seconds on the game's clock (the one the player reads) since 1970: negative in 1941. */
function clockS(world, t = world.t) {
  return Math.round(world.startMs / 1000) + t;
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
  convoyDeparted: 'convoy', convoyArrived: 'convoy', convoyStopped: 'convoy', convoyInEscortRange: 'convoy',
  airborne: 'air', squadronLost: 'air', offerBought: 'convoy', scenarioEvent: 'intel',
};

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

/**
 * Reads the events of the last step (from index `first`): the sea events go to the notes of
 * the watch under way; the first attack on a convoy in the night stops the game at once.
 */
export function noteWatch(world, first) {
  const W = world.watch;
  if (!W) return;
  const n = world.events.length;
  for (let i = first; i < n; i++) {
    const e = world.events[i];
    if (!isNoted(world, e)) continue;
    W.notes.push(noteOf(e));
    if (e.type !== 'uboatAttack') continue;
    // A straggler counts with its convoy: one stop a convoy and a night.
    const c = world.convoys.find((x) => x.id === e.convoyId);
    const id = c && c.parentId ? c.parentId : e.convoyId;
    const night = nightOf(world);
    if (W.nights[id] === night) continue;
    W.nights[id] = night;
    emit(world, 'seaStop', { reason: 'attack', convoy: e.convoy, convoyId: e.convoyId, sunk: e.sunk, x: e.x, y: e.y });
  }
}

// ---- what waits for a decision ----------------------------------------------------------

/** The groups that sail with a convoy, are on their way to it, or hunt for it. */
export function groupsOf(world, convoyId) {
  return world.escorts.filter((e) => e.escorting === convoyId || e.joinTarget === convoyId || e.huntFor === convoyId);
}

/** Groups in port, ready to sail. */
export function freeGroups(world) {
  return world.escorts.filter((e) => e.state === 'inPort' && !e.dry);
}

/** The way a ship follows over the next `hours`: [[x, y], ...] from where it is. */
function wayAhead(u, hours) {
  let left = currentSpeed(u) * 3600 * hours;
  const way = [[u.x, u.y]];
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
  const way = wayAhead(c, R.routeAheadH);
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
 *   of the convoy: the player who keeps the route has answered; a new route is a new question.
 */
export function pendingDecisions(world) {
  const out = [];
  const E = world.rules.escortGroups;
  const free = freeGroups(world);
  const bases = free.map((e) => world.byId.port.get(e.portId)).filter(Boolean);
  for (const c of world.convoys) {
    if (c.type !== 'ocean') continue;
    if (c.state === 'waiting') {
      out.push({ kind: 'waiting', key: `waiting:${c.id}`, unitKind: 'convoy', unitId: c.id });
      continue;
    }
    if (c.state !== 'atSea') continue;
    if (!c.straggler && bases.length && !groupsOf(world, c.id).length) {
      const near = Math.min(...bases.map((p) => distance(c.x, c.y, p.x, p.y)));
      if (near <= E.alertKm) {
        // The groups that could go, the nearest first.
        const groups = [...free].sort((a, b) => distance(a.x, a.y, c.x, c.y) - distance(b.x, b.y, c.x, c.y)).map((e) => e.id);
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
 * escorts and joining (group ids), markers (on its way), est (the place is an estimate).
 */
function convoyRow(world, c, notes) {
  const ids = new Set([c.id, ...(c.children || [])]);
  const mine = notes.filter((n) => ids.has(n.convoyId));
  const attacks = mine.filter((n) => n.type === 'uboatAttack' || n.type === 'condorAttack' || n.type === 'convoyBombed');
  const stragglers = (c.children || []).map((id) => world.convoys.find((x) => x.id === id)).filter((s) => s && s.state === 'atSea').length;
  return lean({
    id: c.id,
    state: c.state === 'atSea' ? null : c.state, // at sea unless said otherwise
    ships: c.ships,
    x: Math.round(c.x),
    y: Math.round(c.y),
    lost: sum(attacks, (n) => n.sunk || 0),
    attacks: attacks.length,
    stragglers,
    escorts: world.escorts.filter((e) => e.escorting === c.id || e.huntFor === c.id).map((e) => e.id),
    joining: world.escorts.filter((e) => e.joinTarget === c.id).map((e) => e.id),
    markers: c.state === 'atSea' ? markersOnWay(world, c).length : 0,
    est: false, // true when the place is an estimate (radio silence)
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
    if (c.type !== 'ocean' || c.straggler) continue;
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
    convoys: (r.convoys || []).map((c) => ({ state: 'atSea', lost: 0, attacks: 0, stragglers: 0, escorts: [], joining: [], markers: 0, est: false, ...c })),
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
  if (!world.watch || clockS(world) % WATCH_S !== 0) return;
  writeReport(world);
}

/** The report with this id (or the last one written), every part present; null if none. */
export function watchReport(world, id = null) {
  const list = world.watch ? world.watch.reports : [];
  const r = id ? list.find((x) => x.id === id) : list[list.length - 1];
  return r ? fullReport(world, r) : null;
}
