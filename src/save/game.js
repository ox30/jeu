// Saving a game: a snapshot of everything that changes during play, restored onto a world
// freshly built from the same scenario. Kept in the browser (one game at a time) and
// exported or imported as a JSON file.

import { bringToSea } from '../sim/uboatnav.js';
import { normalizeRoster } from '../sim/roster.js';
import { fillMissingFields } from '../sim/entities.js';
import { LONG_AGO } from '../sim/naval.js';
import { SNAP_VERSION, SaveError, migrate, validate } from './migrate.js';

const VERSION = SNAP_VERSION;
const KEY = 'jeu-1940.game.v1';
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
 * Puts a snapshot back onto `world`, built from the same scenario. `addMobileRadar(world,
 * def)` rebuilds the mobile stations deployed during the game.
 */
export function restore(world, saved, addMobileRadar = null) {
  // Brought to the current format (a game of 2.6 to 2.8 is format 1), then looked over: a
  // damaged snapshot is refused before the world is touched.
  const snap = migrate(saved);
  const problem = validate(snap);
  if (problem) throw problem;
  if (snap.scenario !== world.scenario.id) throw new SaveError('wrongScenario', snap.scenario);
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

/** `meta`: what belongs to the game without being the simulation (the clock of real time played). */
export function saveToBrowser(world, meta = null) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), snap: snapshot(world), meta }));
    return true;
  } catch {
    return false;
  }
}

export function loadFromBrowser() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.snap && data.snap.version === VERSION ? data : null;
  } catch {
    return null;
  }
}

export function clearBrowserSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The game as a JSON file to download. */
export function exportText(world, extra = null) {
  return JSON.stringify({ game: 'jeu-1940', savedAt: Date.now(), snap: snapshot(world), ...(extra || {}) });
}

export function parseExport(text) {
  const data = JSON.parse(text);
  if (!data || data.game !== 'jeu-1940' || !data.snap) throw new Error('save: not a game file');
  return data;
}
