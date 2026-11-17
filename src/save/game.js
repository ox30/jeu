// Saving a game: a snapshot of everything that changes during play, restored onto a world
// freshly built from the same scenario. Kept in the browser (one game at a time) and
// exported or imported as a JSON file.

import { normalizeRoster } from '../sim/roster.js';

const VERSION = 1;
const KEY = 'jeu-1940.game.v1';
const SITE_FIELDS = ['damage', 'attacks', 'wasOut', 'stocks', 'minStock', 'progress', 'starved', 'dryHours', 'lowWarned'];
const LISTS = ['convoys', 'escorts', 'uboats', 'squadrons', 'raids', 'dfZones', 'dfPending', 'uboatPlots', 'ferries'];
const VALUES = ['t', 'nextPlotId', 'nextTrainId', 'stats', 'objectives', 'allDone', 'ended', 'outcome', 'defeatReason',
  'dryHours', 'pilots', 'firedEvents', 'mru', 'flags', 'currency', 'shipping', 'convoyRaidState', 'scheduled', 'formations', 'nextFormationId',
  'questions', 'nextQuestionId', 'asked', 'nextTimetableId', 'navalReports', 'nextNavalReportId'];

// Fields added after a save was made: a game saved by an earlier version gets them on restore.
const SQUADRON_DEFAULTS = () => ({
  formation: null, holdForWing: false, wingSlowest: null, roe: 'attack', cleared: new Set(), letGo: new Set(), clearedBeyond: new Set(),
  attackRaid: null, breakOff: null, alertAt: null, alertFrom: null, alertLong: false, roster: { daily: [], override: null }, schedule: null, lateFor: null, rallySlow: null,
});
const SHIP_DEFAULTS = () => ({
  formation: null, followEscort: null, followSlot: 0, waitForGroup: false, leftConvoy: null, schedule: null, lateFor: null,
  huntHours: null, huntPath: null, huntGoal: null, huntStay: false, engage: null, endAction: { kind: 'stop' }, routeEnded: false,
});
const WORLD_DEFAULTS = () => ({
  formations: [], nextFormationId: 1, questions: [], nextQuestionId: 1, asked: new Set(), nextTimetableId: 1,
  navalReports: [], nextNavalReportId: 1,
});

function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) if (target[k] === undefined) target[k] = v;
}

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
    if (s.mobile) continue;
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
export function restore(world, snap, addMobileRadar = null) {
  if (!snap || snap.version !== VERSION || snap.scenario !== world.scenario.id) throw new Error('save: wrong game');
  world.rng.setState(snap.rng);
  for (const [key, st] of snap.sites) {
    const site = world.sites.get(key);
    if (site) Object.assign(site, decode(st));
  }
  for (const k of LISTS) world[k] = decode(snap[k] || []);
  for (const k of VALUES) if (k in snap) world[k] = decode(snap[k]);
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
  world.mobileRadars = [];
  if (addMobileRadar) for (const def of decode(snap.mobileRadars || [])) addMobileRadar(world, def);
  fillDefaults(world, WORLD_DEFAULTS());
  for (const s of world.squadrons) {
    fillDefaults(s, SQUADRON_DEFAULTS());
    normalizeRoster(world, s); // a roster of M2.3 (a list of dated changes) becomes a daily plan
  }
  for (const e of world.escorts) fillDefaults(e, SHIP_DEFAULTS());
  for (const c of world.convoys) if (c.schedule === undefined) c.schedule = null;
  world.events = [];
  return world;
}

export function saveToBrowser(world) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), snap: snapshot(world) }));
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
export function exportText(world) {
  return JSON.stringify({ game: 'jeu-1940', savedAt: Date.now(), snap: snapshot(world) });
}

export function parseExport(text) {
  const data = JSON.parse(text);
  if (!data || data.game !== 'jeu-1940' || !data.snap) throw new Error('save: not a game file');
  return data;
}
