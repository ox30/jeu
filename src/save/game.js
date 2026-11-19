// Saving a game: a snapshot of everything that changes during play, restored onto a world
// freshly built from the same scenario. Where the saves are kept (the browser, a file) is
// the business of store.js and of the game's page.

import { bringToSea } from '../sim/uboatnav.js';
import { normalizeRoster } from '../sim/roster.js';
import { fillMissingFields } from '../sim/entities.js';
import { LONG_AGO } from '../sim/naval.js';
import { SNAP_VERSION, SaveError, migrate, snapVersion, validate } from './migrate.js';

const VERSION = SNAP_VERSION;
const SITE_FIELDS = ['damage', 'attacks', 'wasOut', 'stocks', 'minStock', 'progress', 'starved', 'dryHours', 'lowWarned'];
const LISTS = ['convoys', 'escorts', 'uboats', 'squadrons', 'raids', 'dfZones', 'dfPending', 'uboatPlots', 'ferries'];
const VALUES = ['t', 'nextPlotId', 'nextTrainId', 'stats', 'objectives', 'allDone', 'ended', 'outcome', 'defeatReason',
  'dryHours', 'pilots', 'firedEvents', 'mru', 'flags', 'currency', 'shipping', 'convoyRaidState', 'scheduled', 'formations', 'nextFormationId',
  'questions', 'nextQuestionId', 'asked', 'nextTimetableId', 'navalReports', 'nextNavalReportId', 'bdu', 'carry', 'fightersAtStart', 'watch', 'signals', 'nextSignalId',
  'settings', 'presetStart'];

// Fields added after a save was made: a game saved by an earlier version gets them on restore
// from the entity factory (entities.js), where each subsystem declares what it keeps on a
// squadron, a group, a convoy, a U-boat, a raid or an installation. What belongs to the world
// itself is already there: the snapshot is put back onto a world freshly built.

/** Plain JSON for Maps, Sets and nested objects. */
function encode(v) {
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [k, encode(x)]) };
  if (v instanceof Set) return { __set: [...v.values()].map(encode) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encode(x);
    return out;
  }
  return v;
}

function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (v.__map) return new Map(v.__map.map(([k, x]) => [k, decode(x)]));
    if (v.__set) return new Set(v.__set.map(decode));
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decode(x);
    return out;
  }
  return v;
}

/** What restore makes of a saved value: a list, a table (Map), a set, a record, a number… */
function kindOf(v) {
  if (v === null || v === undefined) return 'none';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'object') return v.__map ? 'map' : v.__set ? 'set' : 'record';
  return typeof v;
}

// The parts every save has had since the first format.
const ALWAYS = ['rng', 'sites', 'contacts', 'reports', 'trains', 'railFree', 'convoys', 'escorts', 'uboats', 'squadrons', 'raids', 't', 'stats', 'objectives'];
// What does not follow from the scenario alone: the losses the campaign carried over are
// nothing in a game begun outside it, whatever the world it is put back on was built with.
const MAY_BE_NOTHING = new Set(['carry']);
// Records whose entries are not all the game's: the settings of a game hold what the player's
// own held when it began. Only these entries are asked of them.
const OPEN_RECORDS = { settings: ['preset'] };

/**
 * Compares a snapshot (migrated) with the one of a world freshly built from the same
 * scenario: each part must be of the kind the game keeps there, and so must each entry of
 * the records with fixed entries (the counters, the settings, the reserves…). A save written
 * in the current format (`complete`) has every part; an older one may lack those added since,
 * which stay as the new world has them. Returns null when it is sound, or a SaveError
 * (damaged) naming the part.
 *
 * For whoever adds a part to the world or an entry to one of its records: the saves of the
 * format in use do not have it, and would be refused here. A new part means a new format
 * number and its migration (migrate.js); tests/oldsaves.test.js loads a save of each format.
 */
export function shapeProblem(fresh, snap, complete = false) {
  for (const [k, model] of Object.entries(fresh)) {
    if (!(k in snap)) {
      if (complete || ALWAYS.includes(k)) return new SaveError('damaged', k);
      continue;
    }
    const want = kindOf(model);
    if (want === 'none') continue; // nothing there as a game begins: it cannot be told
    const got = kindOf(snap[k]);
    if (got === 'none' && MAY_BE_NOTHING.has(k)) continue;
    if (got !== want) return new SaveError('damaged', k);
    if (want !== 'record') continue;
    const asked = OPEN_RECORDS[k] || null;
    for (const [j, sub] of Object.entries(model)) {
      if (!(j in snap[k])) {
        if (complete && (!asked || asked.includes(j))) return new SaveError('damaged', `${k}.${j}`);
        continue;
      }
      const wanted = kindOf(sub);
      if (wanted !== 'none' && kindOf(snap[k][j]) !== wanted) return new SaveError('damaged', `${k}.${j}`);
    }
  }
  return null;
}

/** Everything that changes during play, as plain data. */
export function snapshot(world) {
  const sites = [];
  for (const s of world.sites.values()) {
    const st = {};
    for (const f of SITE_FIELDS) if (f in s) st[f] = encode(s[f]);
    sites.push([s.key, st]);
  }
  const snap = {
    version: VERSION,
    scenario: world.scenario.id,
    rng: world.rng.state,
    sites,
    mobileRadars: encode(world.mobileRadars || []),
    contacts: encode(world.contacts),
    reports: encode(world.reports),
    trains: world.trains.map((tr) => encode({ ...tr, links: tr.links.map((l) => world.rail.links.indexOf(l)) })),
    railFree: world.rail.links.map((l) => l.nextFree),
  };
  for (const k of LISTS) snap[k] = encode(world[k] || []);
  for (const k of VALUES) if (k in world) snap[k] = encode(world[k]);
  return snap;
}

/**
 * Puts a snapshot back onto `world`, freshly built from the same scenario. `addMobileRadar(world,
 * def)` rebuilds the mobile stations deployed during the game.
 */
export function restore(world, saved, addMobileRadar = null) {
  // Brought to the current format (a game of 2.6 to 2.8 is format 1), then looked over: a
  // damaged snapshot is refused before the world is touched.
  const snap = migrate(saved);
  const problem = validate(snap);
  if (problem) throw problem;
  if (snap.scenario !== world.scenario.id) throw new SaveError('wrongScenario', snap.scenario);
  // Each part of the kind this world keeps there (as a file gives it: through JSON).
  const shape = shapeProblem(JSON.parse(JSON.stringify(snapshot(world))), snap, snapVersion(saved) === SNAP_VERSION);
  if (shape) throw shape;
  // The squadrons a new game of this scenario begins with (the others arrived as reliefs).
  const initialSquadrons = new Set(world.squadrons.map((s) => s.id));
  world.rng.setState(snap.rng);
  // The mobile stations first: their state is restored with that of the other installations.
  world.mobileRadars = [];
  if (addMobileRadar) for (const def of decode(snap.mobileRadars || [])) addMobileRadar(world, def);
  for (const [key, st] of snap.sites) {
    const site = world.sites.get(key);
    if (site) Object.assign(site, decode(st));
  }
  for (const k of LISTS) world[k] = decode(snap[k] || []);
  for (const k of VALUES) if (k in snap) world[k] = decode(snap[k]);
  // Saves of M2.5 and before piled up a plot every ten minutes of a hunt, and kept the plots of a
  // sunk U-boat: the table now keeps the newest plot of each U-boat still afloat.
  const newest = new Map();
  for (const p of world.uboatPlots) if (!newest.has(p.uboatId) || p.t > newest.get(p.uboatId).t) newest.set(p.uboatId, p);
  world.uboatPlots = world.uboatPlots.filter((p) => newest.get(p.uboatId) === p
    && !world.uboats.some((u) => u.id === p.uboatId && u.state === 'sunk'));
  world.contacts = decode(snap.contacts);
  world.reports = decode(snap.reports);
  // Saves made before reports kept what the RAF knows: a raid fought was seen.
  for (const rep of world.reports.values()) {
    if (rep.estimate === undefined) rep.estimate = null;
    if (rep.seen === undefined) {
      rep.seen = rep.squadrons.some((s) => s.fights)
        ? { t: rep.startT, by: '', bombers: rep.bombersStart, bomberType: rep.bomberType, escort: rep.escortStart, escortType: rep.escortType }
        : null;
    }
  }
  world.trains = snap.trains.map((tr) => {
    const x = decode(tr);
    x.links = x.links.map((i) => world.rail.links[i]);
    return x;
  });
  snap.railFree.forEach((v, i) => {
    if (world.rail.links[i]) world.rail.links[i].nextFree = v;
  });
  // The share of each convoy bought with dollars, a setting until 2.7, is gone (I4): the
  // convoys sail fully laden as long as the reserve can pay.
  if (world.currency) delete world.currency.purchase;
  for (const s of world.squadrons) {
    fillMissingFields('squadron', s, world);
    normalizeRoster(world, s); // a roster of M2.3 (a list of dated changes) becomes a daily plan
  }
  for (const e of world.escorts) {
    // A group saved before the depth charges (2.8) gets full racks and full patterns; the
    // length of its hunts, which the player used to set, is gone. A hunt under way then goes
    // on at most for the time of a search.
    fillMissingFields('escort', e, world);
    if ('huntHours' in e) {
      delete e.huntHours;
      if (e.state === 'hunting' && !e.huntStay) e.huntUntil = Math.min(e.huntUntil ?? Infinity, world.t + world.rules.asw.engagement.searchS);
    }
  }
  // Convoys and installations saved by an earlier version get the fields added since.
  for (const c of world.convoys) fillMissingFields('convoy', c, world);
  for (const site of world.sites.values()) fillMissingFields('site', site, world);
  // A save made before 2.7 does not say how many fighters its game began with: those of a new
  // game of the scenario (the world it is restored onto), and the reliefs arrived since.
  if (!('fightersAtStart' in snap)) {
    for (const s of world.squadrons) if (s.role === 'fighter' && !initialSquadrons.has(s.id)) world.fightersAtStart += s.aircraftStart;
  }
  for (const r of world.raids) fillMissingFields('raid', r, world);
  for (const u of world.uboats) {
    fillMissingFields('uboat', u, world);
    // "Never yet" was an infinity until 2.8, which a save turned into nothing.
    if (!Number.isFinite(u.lastAttack)) u.lastAttack = LONG_AGO;
    if (!Number.isFinite(u.lastReport)) u.lastReport = LONG_AGO;
    bringToSea(world, u); // a boat an earlier version left ashore
  }
  world.events = [];
  return world;
}

/** The game as a JSON file to download. */
export function exportText(world, extra = null) {
  return JSON.stringify({ game: 'jeu-1940', savedAt: Date.now(), snap: snapshot(world), ...(extra || {}) });
}
