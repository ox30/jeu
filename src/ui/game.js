// The life of a game on the page: a new game of a scenario, a saved game resumed, and the
// saves — the game under way (written every few minutes and when the page is left), the
// automatic saves (one a game day, every two game hours in a battle of one day), the manual
// ones, the file exported or imported. A save holds the simulation, the game's own settings
// (they are in the world), the journal, and what belongs to the game without being the
// simulation (the clock of real time played, the watch reports read).

import { t } from '../core/i18n.js';
import { VERSION } from '../core/version.js';
import { createWorld, step } from '../sim/world.js';
import { drainEvents } from '../sim/events.js';
import { setFrame, viewFrame } from '../render/camera.js';
import { snapshot, restore } from '../save/game.js';
import { saveSettings } from '../save/settings.js';
import { SaveError, readSave, readSaveText, soundJournal, soundMeta } from '../save/migrate.js';
import { CURRENT } from '../save/store.js';
import { carryFor, scenarioIds } from './campaign.js';
import { handleEvents } from './gameEvents.js';
import { addLogEntry, clearLog } from './panels.js';
import { resetAlerts } from './alerts.js';
import { createSignals } from './watchPanel.js';
import { createPlayClock, newGameId } from './summary.js';
import { lessonFor, startTutorial, stopTutorial } from './tutorial.js';

function scenarioById(app, id) {
  return app.data.scenarios.find((s) => s.id === id) || null;
}

/** Real time after which a game launched and still at its first minute counts as begun. */
export const BEGUN_AFTER_MS = 60000;

/**
 * A game is in hand: resumed, or launched and begun, and not over. Begun: its clock has
 * moved, or the player has spent a minute on it (orders prepared with the clock stopped at
 * the first minute are a game to keep too). The world the page shows behind the main menu
 * before anything is launched is not a game.
 */
export function gameInProgress(app) {
  const w = app.world;
  // (`dropped`: the little world of a lesson that was left or finished is nothing to come back to.)
  if (w.ended || app.crash || app.dropped) return false;
  if (app.resumed || w.t > 0) return true;
  return Boolean(app.launched) && Boolean(app.playClock) && app.playClock.totalMs >= BEGUN_AFTER_MS;
}

/**
 * Is this game written in the browser? A lesson of the tutorial is not: it is played in one
 * go, and a lesson resumed would come back without its instructor.
 */
function keptInBrowser(app) {
  return gameInProgress(app) && !app.tutorial;
}

/** Seconds of game between two automatic saves: a game day, or two hours in a battle of one day. */
export function autosavePeriodS(world) {
  return world.endS <= 36 * 3600 ? 2 * 3600 : 86400;
}

/** The number of the period the game clock is in: it changes at midnight, or on the even hours. */
export function autosaveSlot(world) {
  return Math.floor((world.startMs / 1000 + world.t) / autosavePeriodS(world));
}

/** What belongs to the game without being the simulation. */
function gameMeta(app) {
  return {
    playClock: app.playClock,
    gameId: app.gameId,
    signalsRead: [...app.signals.read],
    gameMs: app.world.startMs + app.world.t * 1000,
  };
}

/** The game as it is saved, in the browser or in a file. */
export function buildSave(app) {
  return { game: 'jeu-1940', madeBy: VERSION, savedAt: Date.now(), snap: snapshot(app.world), meta: gameMeta(app), journal: [...(app.logEntries || [])] };
}

/** A write that failed is shown until one succeeds (the top bar, and once in the journal). */
function noteWrite(app, result) {
  const failed = !result.ok;
  if (failed && !app.saveProblem) addLogEntry(app, t('save.errors.storage'), 'alert', app.world.t);
  if (failed !== Boolean(app.saveProblem)) {
    app.saveProblem = failed ? result.code || 'storage' : null;
    app.dirtyHud = true;
  }
  return result;
}

/** Keeps the game under way in the browser, at once. */
export function saveCurrent(app) {
  // After an error, or once the game is over, what was kept stays as it is.
  if (!keptInBrowser(app)) return { ok: false, code: 'nothing' };
  app.lastSaveT = app.world.t;
  app.lastSaveReal = performance.now();
  return noteWrite(app, app.store.writeCurrent(buildSave(app)));
}

/** An automatic save of the game as it is now (the last five are kept). */
export async function autosave(app) {
  if (!keptInBrowser(app)) return { ok: false, code: 'nothing' };
  return noteWrite(app, await app.store.add('auto', buildSave(app)));
}

/** A save the player asked for, kept until deleted. */
export async function manualSave(app) {
  // (Not a lesson of the tutorial either: its little scenario is not one a save can come back to.)
  if (app.crash || app.tutorial) return { ok: false, code: 'nothing' };
  return noteWrite(app, await app.store.add('manual', buildSave(app)));
}

/** Called every frame: the game under way every quarter of a game hour, the automatic save when its period turns. */
export function tickSaves(app, now) {
  const world = app.world;
  if (!keptInBrowser(app)) return;
  // A long game with all its reports is heavier to write: less often in real time.
  const gapMs = (app.store.current()?.chars || 0) > 400000 ? 20000 : 4000;
  if (world.t - (app.lastSaveT ?? 0) >= 900 && now - (app.lastSaveReal ?? 0) > gapMs) saveCurrent(app);
  const slot = autosaveSlot(world);
  if (app.autoSlot === null || app.autoSlot === undefined) app.autoSlot = slot;
  else if (slot !== app.autoSlot) {
    app.autoSlot = slot;
    autosave(app);
  }
}

/** The map as the scenario wants it at the start: its own view. */
function frameScenario(app) {
  const views = app.data.campaign.views;
  const map = app.world.scenario.map || {};
  const view = views[map.view] || views[map.zone] || views.atlantic;
  setFrame(app.camera, viewFrame(app.camera, view));
}

/** What a new or resumed game resets on the page. */
function freshPage(app) {
  resetAlerts(app);
  app.lastNavalAttack = null;
  app.crash = null;
  app.signals = createSignals();
  Object.assign(app, {
    selection: null, drawing: null, ruler: null, flash: null, mapNote: null, fx: [], paused: false, pausedByPage: false, speed: 60, accumulator: 0, unlocked: null,
  });
  // (A write that failed stays told, from one game to the next, until one succeeds.)
  clearLog(app);
  app.dirtyPanels = true;
  app.dirtyHud = true;
}

/** A new game: of `scenarioId`, or of the scenario in hand again. With `tutorial`, its lesson begins. */
export function newGame(app, scenarioId = null, { tutorial = false } = {}) {
  const { data } = app;
  let { settings } = app;
  if (scenarioId) {
    const sc = scenarioById(app, scenarioId);
    if (!sc) return false;
    data.scenario = sc;
    // (The scenario of a lesson is not « the last scenario played ».)
    if (!lessonFor(data.tutorial, sc.id)) {
      settings.scenario = sc.id;
      saveSettings(settings);
    }
  }
  // A lesson is played with its own settings, over Standard, whatever the player's are.
  const lesson = tutorial ? lessonFor(data.tutorial, data.scenario.id) : null;
  if (lesson) settings = { ...settings, ...data.presets.presets.standard, ...(lesson.settings || {}), preset: 'standard' };
  stopTutorial(app);
  app.playClock = createPlayClock();
  app.gameId = newGameId();
  app.resumed = false;
  app.launched = true;
  app.dropped = false;
  app.world = createWorld({
    scenario: data.scenario, rules: data.rules, settings, terrain: app.terrain, carry: carryFor(app.campaign, data.scenario.id, settings.carry),
    presets: data.presets,
  });
  freshPage(app);
  frameScenario(app);
  app.autoSlot = autosaveSlot(app.world);
  app.lastSaveT = 0;
  handleEvents(app, drainEvents(app.world));
  if (tutorial) startTutorial(app);
  return true;
}

/** Game seconds a save is played for, on a world of its own, before it is trusted. */
const TRIAL_S = 600;

/** A world of the save's scenario with the save put back on it. Throws a SaveError. */
function worldOf(app, saved) {
  const { data, settings } = app;
  const sc = scenarioById(app, saved.snap.scenario);
  if (!sc) throw new SaveError('unknownScenario', saved.snap.scenario);
  // Built as a new game of this scenario would be, with what the campaign carries over (its
  // own settings come back with it; a save of before 2.9 takes the player's).
  const carryMode = (saved.snap.settings && saved.snap.settings.carry) || settings.carry;
  const w = createWorld({
    scenario: sc, rules: data.rules, settings, terrain: app.terrain, carry: carryFor(app.campaign, sc.id, carryMode), presets: data.presets,
  });
  drainEvents(w);
  try {
    restore(w, saved.snap, (world, def) => app.addMobileRadar && app.addMobileRadar(world, def));
  } catch (err) {
    if (err instanceof SaveError) throw err;
    console.warn('save not restored', err);
    throw new SaveError('damaged', 'restore');
  }
  return w;
}

/**
 * Tries a save out before it replaces anything: put back on a world of its own and played
 * for ten game minutes. A file whose parts are each of the right kind but do not hold
 * together stops there, and not in the player's game. Throws a SaveError (damaged).
 */
export function tryOutSave(app, saved) {
  const probe = worldOf(app, saved);
  try {
    for (let i = 0; i < TRIAL_S && !probe.ended; i++) step(probe, 1);
  } catch (err) {
    console.warn('save refused at its trial', err);
    throw new SaveError('damaged', 'trial');
  }
}

/**
 * A saved game (read and checked: readSave) replaces the one in hand. Throws a SaveError when
 * it cannot be restored; the game in hand is then left as it was.
 */
export function resumeSave(app, saved) {
  const { data, settings } = app;
  // Everything is made ready first: nothing of the page changes before the save is whole.
  const w = worldOf(app, saved);
  const meta = soundMeta(saved.meta) || {};
  const journal = soundJournal(saved.journal);
  const playClock = createPlayClock(meta.playClock);
  // Restored: from here on the game in hand is this one.
  data.scenario = w.scenario;
  settings.scenario = w.scenario.id;
  saveSettings(settings);
  stopTutorial(app);
  app.world = w;
  app.resumed = true;
  app.launched = true;
  app.dropped = false;
  app.playClock = playClock;
  app.gameId = meta.gameId || newGameId();
  freshPage(app);
  for (const id of meta.signalsRead || []) app.signals.read.add(id);
  for (const entry of journal) addLogEntry(app, entry.text, entry.level, entry.t, { report: entry.report, replay: true });
  app.logEntries = journal;
  addLogEntry(app, t('log.gameResumed'), 'info', w.t);
  frameScenario(app);
  app.autoSlot = autosaveSlot(w);
  app.lastSaveT = w.t;
  app.lastSaveReal = performance.now();
  return true;
}

/** { ok } or { ok: false, code, detail }: what a failed loading says to the player. */
function failure(err) {
  if (err instanceof SaveError) return { ok: false, code: err.code, detail: err.detail };
  console.warn('save not loaded', err);
  return { ok: false, code: 'damaged', detail: 'restore' };
}

/**
 * A save of the browser read, checked and tried out, without touching the game in hand:
 * { ok, read } or { ok: false, code, detail }.
 */
export async function readEntry(app, id) {
  try {
    const read = readSave(await app.store.read(id), scenarioIds());
    tryOutSave(app, read);
    return { ok: true, read };
  } catch (err) {
    return failure(err);
  }
}

/** The same for the text of a file. */
export function readFileText(app, text) {
  try {
    const read = readSaveText(text, scenarioIds());
    tryOutSave(app, read);
    return { ok: true, read };
  } catch (err) {
    return failure(err);
  }
}

/**
 * The game read (readEntry, readFileText) replaces the one in hand and becomes the game under
 * way: { ok } or { ok: false, code, detail }. `keep`: false for the game under way itself,
 * which is already written.
 */
export function resumeRead(app, read, { keep = true } = {}) {
  try {
    resumeSave(app, read);
    if (keep) saveCurrent(app);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Loads a save of the browser by its id: { ok } or { ok: false, code, detail }. */
export async function loadEntry(app, id) {
  const r = await readEntry(app, id);
  return r.ok ? resumeRead(app, r.read, { keep: id !== CURRENT }) : r;
}

/** Loads a game from the text of a file: { ok } or { ok: false, code, detail }. */
export function importText(app, text) {
  const r = readFileText(app, text);
  return r.ok ? resumeRead(app, r.read) : r;
}

/** The sentence of a refusal (save.errors.<code>). */
export function saveErrorText(result) {
  const key = `save.errors.${result.code}`;
  // What is wrong with a damaged save, in plain words (save.details): a reason the game
  // knows, else the part of the save that is missing or of the wrong kind.
  let detail = result.detail || '';
  if (result.code === 'damaged' && detail) {
    const plain = `save.details.${detail}`;
    detail = t(plain) !== plain ? t(plain) : t('save.details.part', { part: detail });
  }
  const text = t(key, { detail });
  return text === key ? t('save.errors.damaged', { detail: result.code }) : text;
}

/**
 * The game as a .json file. Published on claude.ai, the page asks the viewer through the
 * downloads capability; elsewhere (the file on disk, a web server) a plain download.
 * Returns 'saved', 'declined' or 'failed'.
 */
export async function exportGame(app, extra = null) {
  const text = JSON.stringify({ ...buildSave(app), ...(extra || {}) });
  const d = new Date(app.world.startMs + app.world.t * 1000);
  const filename = `partie-${app.world.scenario.id}-${d.toISOString().slice(0, 13).replace(/[-T:]/g, '')}.json`;
  let downloads = null;
  try {
    if (window.claude && typeof window.claude.use === 'function') downloads = await window.claude.use('downloads');
  } catch {
    downloads = null;
  }
  if (downloads) {
    try {
      await downloads.save({ filename, data: text });
      return 'saved';
    } catch (err) {
      if (err && err.code === 'declined') return 'declined';
      console.warn('export', err);
      return 'failed';
    }
  }
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return 'saved';
  } catch (err) {
    console.warn('export', err);
    return 'failed';
  }
}
