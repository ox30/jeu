// Saving a game: a snapshot of everything that changes during play, restored onto a world
// freshly built from the same scenario. Kept in the browser (one game at a time) and
// exported or imported as a JSON file.

const VERSION = 1;
const KEY = 'jeu-1940.game.v1';
const SITE_FIELDS = ['damage', 'attacks', 'wasOut', 'stocks', 'minStock', 'progress', 'starved', 'dryHours', 'lowWarned'];
const LISTS = ['convoys', 'escorts', 'uboats', 'squadrons', 'raids', 'dfZones', 'dfPending', 'uboatPlots', 'ferries'];
const VALUES = ['t', 'nextPlotId', 'nextTrainId', 'stats', 'objectives', 'allDone', 'ended', 'outcome', 'defeatReason',
  'dryHours', 'pilots', 'firedEvents', 'mru', 'flags', 'currency', 'shipping', 'convoyRaidState', 'scheduled', 'formations', 'nextFormationId'];

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
