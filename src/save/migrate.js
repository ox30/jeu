// Versions of the saved games. A snapshot carries the number of the format it was written in;
// each change of format has one migration here, from a version to the next, and a snapshot is
// brought up to the current format step by step before it is restored. A file that is not a
// game, comes from a later version, or is damaged is refused before anything is touched, with
// a reason the game can tell the player (save.errors.<code> in fr.json).

/** The format written today. 1: versions 2.6 to 2.8 · 2: version 2.9. */
export const SNAP_VERSION = 2;

/** A save that cannot be loaded: `code` says why (notAGame, tooNew, damaged, unknownScenario, wrongScenario). */
export class SaveError extends Error {
  constructor(code, detail = '') {
    super(`save: ${code}${detail ? ` (${detail})` : ''}`);
    this.name = 'SaveError';
    this.code = code;
    this.detail = detail;
  }
}

// Format 2 (version 2.9): the two readiness states on the ground got names that say what
// they are (thirty → min30, available → min5), wherever a squadron keeps one.
//
// Version 2.10 writes format 2 still. It added two fields inside records that existed, both
// read with a default, so that a save of 2.9 needs no migration and loses nothing:
//   - `outS` on an objective « outOfServiceBelow » (seconds out of service counted so far;
//     absent = 0). A save of 2.9 keeps the objectives it was saved with, which have none.
//   - `held` on a raid (a raid a lesson of the tutorial releases itself; absent = false).
// Version 2.10.2 too: `full` on an objective « enemyDown » (the count of the scenario, when
// the campaign cut it to the fighters carried over; absent = the count is the scenario's).
// The objectives come back as they were saved: a campaign battle begun before 2.10.2 keeps
// the count it began with.
// Version 2.10.3 too: two fields on an escort group, declared with their defaults
// (declareFields, naval.js): `routeHead` (the points of its charted way out of port, at the
// head of its route; absent = 0) and `exitPlanned` (an exit step given in port; absent =
// false). What 2.10.2 wrote in their place — the way out counted in `routeLocked`, a channel
// chosen kept as a bare name — is read again as 2.10.3 keeps it at the first step of the game
// (adoptWayOut, convoy.js): a group that waited in port with its channel sails, a group going
// down its channel has its line back in the player's hands. No migration, nothing lost.
// Version 2.10.5 too: two fields on a convoy, declared with their defaults (declareFields,
// convoy.js): `endAction` (what it was told to do at the end of its line or of its legs;
// absent = null, it ends as it always did) and `routeEnded` (a mark that lives within one
// step; absent = false). An order « endAction » waiting in `signals` for a convoy is new
// too: an earlier version would refuse it at the relief, as an order it does not know.
// A new part of the world, or a field that cannot be defaulted, takes a new number and a
// migration here (the check of the parts in src/save/game.js refuses a « complete » save
// that lacks one).
const ALERT_NAMES = { thirty: 'min30', available: 'min5' };
const alertName = (v) => (typeof v === 'string' && ALERT_NAMES[v] ? ALERT_NAMES[v] : v);

function renameAlertsOf(s) {
  for (const k of ['alert', 'alertFrom']) if (k in s) s[k] = alertName(s[k]);
  const r = s.roster;
  if (r && typeof r === 'object' && !Array.isArray(r)) {
    for (const entry of r.daily || []) if (entry && 'alert' in entry) entry.alert = alertName(entry.alert);
    if (r.override) for (const entry of r.override.entries || []) if (entry && 'alert' in entry) entry.alert = alertName(entry.alert);
  } else if (Array.isArray(r)) {
    // A roster of version 2.3: a plain list of dated changes.
    for (const entry of r) if (entry && 'alert' in entry) entry.alert = alertName(entry.alert);
  }
}

/** One function a version: it takes a snapshot of that version and leaves it one version up. */
const MIGRATIONS = {
  1(snap) {
    for (const s of snap.squadrons || []) renameAlertsOf(s);
    snap.version = 2;
  },
};

/** The version a snapshot says it is, or null when it says nothing usable. */
export function snapVersion(snap) {
  return snap && Number.isInteger(snap.version) && snap.version >= 1 ? snap.version : null;
}

/**
 * A copy of the snapshot in the current format. Throws a SaveError for something that is
 * not a snapshot (notAGame) or was written by a later version of the game (tooNew).
 */
export function migrate(input) {
  const from = snapVersion(input);
  if (from === null) throw new SaveError('notAGame');
  if (from > SNAP_VERSION) throw new SaveError('tooNew', `format ${from}`);
  const snap = structuredClone(input);
  for (let v = from; v < SNAP_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new SaveError('damaged', `no migration from format ${v}`);
    step(snap);
  }
  return snap;
}

const LISTS = ['convoys', 'escorts', 'uboats', 'squadrons', 'raids', 'sites', 'trains', 'railFree'];
const isList = (v) => Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Looks a migrated snapshot over before it is restored: the parts every game has are there
 * and of the right kind, the clock and the positions are numbers. Returns null when it is
 * sound, or a SaveError (damaged, unknownScenario) to show. `scenarios`: the ids the game knows.
 */
export function validate(snap, scenarios = null) {
  if (!snap || typeof snap !== 'object' || snapVersion(snap) === null) return new SaveError('notAGame');
  if (typeof snap.scenario !== 'string' || !snap.scenario) return new SaveError('damaged', 'no scenario');
  if (scenarios && !scenarios.includes(snap.scenario)) return new SaveError('unknownScenario', snap.scenario);
  if (!finite(snap.t) || snap.t < 0) return new SaveError('damaged', 'clock');
  if (snap.rng === undefined || snap.rng === null) return new SaveError('damaged', 'dice');
  for (const k of LISTS) if (!isList(snap[k])) return new SaveError('damaged', k);
  if (!snap.stats || typeof snap.stats !== 'object') return new SaveError('damaged', 'stats');
  if (!isList(snap.objectives)) return new SaveError('damaged', 'objectives');
  for (const k of ['convoys', 'escorts', 'uboats', 'squadrons', 'raids']) {
    for (const u of snap[k]) {
      if (!u || typeof u !== 'object' || typeof u.id !== 'string') return new SaveError('damaged', `${k}: an entry without a name`);
      if (!finite(u.x) || !finite(u.y)) return new SaveError('damaged', `${k} ${u.id}: position`);
    }
  }
  for (const entry of snap.sites) if (!isList(entry) || typeof entry[0] !== 'string') return new SaveError('damaged', 'sites');
  return null;
}

/**
 * What a file holds, checked and brought to the current format: { snap, meta, journal,
 * madeBy, savedAt }. Throws a SaveError (notAGame: not JSON, or not a file of this game).
 */
export function readSaveText(text, scenarios = null) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SaveError('notAGame', 'not JSON');
  }
  return readSave(data, scenarios);
}

/**
 * The journal of a save, with the lines the page can show: a text, its level, its hour, the
 * report it opens. A line that is none of that (a file damaged, or edited by hand) is left out
 * rather than refusing the whole game for it.
 */
export function soundJournal(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.text !== 'string') continue;
    out.push({
      text: e.text,
      level: typeof e.level === 'string' ? e.level : 'info',
      t: finite(e.t) ? e.t : 0,
      report: typeof e.report === 'string' || finite(e.report) ? e.report : null,
    });
  }
  return out;
}

/** What belongs to the game without being the simulation, each part of the kind the page expects. */
export function soundMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const clock = meta.playClock && typeof meta.playClock === 'object' ? meta.playClock : null;
  const out = {
    playClock: clock ? { totalMs: finite(clock.totalMs) ? Math.max(0, clock.totalMs) : 0, pausedMs: finite(clock.pausedMs) ? Math.max(0, clock.pausedMs) : 0 } : null,
    gameId: typeof meta.gameId === 'string' && meta.gameId ? meta.gameId : null,
    signalsRead: Array.isArray(meta.signalsRead) ? meta.signalsRead.filter((x) => typeof x === 'string' || finite(x)) : [],
    gameMs: finite(meta.gameMs) ? meta.gameMs : null,
  };
  if (typeof meta.preset === 'string') out.preset = meta.preset;
  return out;
}

/** The same for a save already parsed (from the browser's storage, or a file). */
export function readSave(data, scenarios = null) {
  if (!data || typeof data !== 'object' || !data.snap || (data.game !== undefined && data.game !== 'jeu-1940')) throw new SaveError('notAGame');
  // Written in the current format, a save has every part a game keeps (game.js checks it).
  const complete = snapVersion(data.snap) === SNAP_VERSION;
  const snap = migrate(data.snap);
  const problem = validate(snap, scenarios);
  if (problem) throw problem;
  return {
    snap,
    complete,
    meta: soundMeta(data.meta),
    journal: soundJournal(data.journal),
    madeBy: typeof data.madeBy === 'string' ? data.madeBy : null,
    savedAt: finite(data.savedAt) ? data.savedAt : null,
  };
}
