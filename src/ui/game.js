// The life of a game on the page: a new game of a scenario, a saved game resumed, and the
// saves — the game under way (written every few minutes and when the page is left), the
// automatic saves (one a game day, every two game hours in a battle of one day), the manual
// ones, the file exported or imported. A save holds the simulation, the game's own settings
// (they are in the world), the journal, and what belongs to the game without being the
// simulation (the clock of real time played, the watch reports read).

import { t } from '../core/i18n.js';
import { VERSION } from '../core/version.js';
import { createWorld } from '../sim/world.js';
import { drainEvents } from '../sim/events.js';
import { setFrame, viewFrame } from '../render/camera.js';
import { snapshot, restore } from '../save/game.js';
import { saveSettings } from '../save/settings.js';
import { SaveError, readSave, readSaveText } from '../save/migrate.js';
import { CURRENT } from '../save/store.js';
import { carryFor, scenarioIds } from './campaign.js';
import { handleEvents } from './gameEvents.js';
import { addLogEntry, clearLog } from './panels.js';
import { resetAlerts } from './alerts.js';
import { createSignals } from './watchPanel.js';
import { createPlayClock, newGameId } from './summary.js';
import { startTutorial, stopTutorial } from './tutorial.js';

function scenarioById(app, id) {
  return app.data.scenarios.find((s) => s.id === id) || null;
}

/** A game is in hand: begun or resumed, and not over. */
export function gameInProgress(app) {
  const w = app.world;
  return !w.ended && !app.crash && (w.t > 0 || Boolean(app.resumed));
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
    tutorial: Boolean(app.tutorial),
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
  if (app.world.ended || app.crash || !gameInProgress(app)) return { ok: false, code: 'nothing' };
  app.lastSaveT = app.world.t;
  app.lastSaveReal = performance.now();
  return noteWrite(app, app.store.writeCurrent(buildSave(app)));
}

/** An automatic save of the game as it is now (the last five are kept). */
export async function autosave(app) {
  if (app.world.ended || app.crash || !gameInProgress(app)) return { ok: false, code: 'nothing' };
  return noteWrite(app, await app.store.add('auto', buildSave(app)));
}

/** A save the player asked for, kept until deleted. */
export async function manualSave(app) {
  if (app.crash) return { ok: false, code: 'nothing' };
  return noteWrite(app, await app.store.add('manual', buildSave(app)));
}

/** Called every frame: the game under way every quarter of a game hour, the automatic save when its period turns. */
export function tickSaves(app, now) {
  const world = app.world;
  if (world.ended || app.crash || !gameInProgress(app)) return;
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
    selection: null, drawing: null, ruler: null, flash: null, fx: [], paused: false, pausedByPage: false, speed: 60, accumulator: 0, unlocked: null,
    saveProblem: null,
  });
  clearLog(app);
  app.dirtyPanels = true;
  app.dirtyHud = true;
}

/** A new game: of `scenarioId`, or of the scenario in hand again. With `tutorial`, its lesson begins. */
export function newGame(app, scenarioId = null, { tutorial = false } = {}) {
  const { data, settings } = app;
  if (scenarioId) {
    const sc = scenarioById(app, scenarioId);
    if (!sc) return false;
    data.scenario = sc;
    settings.scenario = sc.id;
    saveSettings(settings);
  }
  stopTutorial(app);
  app.playClock = createPlayClock();
  app.gameId = newGameId();
  app.resumed = false;
  app.world = createWorld({
    scenario: data.scenario, rules: data.rules, settings, terrain: app.terrain, carry: carryFor(app.campaign, data.scenario.id, settings.carry),
  });
  freshPage(app);
  frameScenario(app);
  app.autoSlot = autosaveSlot(app.world);
  app.lastSaveT = 0;
  handleEvents(app, drainEvents(app.world));
  if (tutorial) startTutorial(app);
  return true;
}

/**
 * A saved game (read and checked: readSave) replaces the one in hand. Throws a SaveError when
 * it cannot be restored; the game in hand is then left as it was.
 */
export function resumeSave(app, saved) {
  const { data, settings } = app;
  const sc = scenarioById(app, saved.snap.scenario);
  if (!sc) throw new SaveError('unknownScenario', saved.snap.scenario);
  // Built as a new game of this scenario would be, with what the campaign carries over (its
  // own settings come back with it; a save of before 2.9 takes the player's).
  const carryMode = (saved.snap.settings && saved.snap.settings.carry) || settings.carry;
  const w = createWorld({ scenario: sc, rules: data.rules, settings, terrain: app.terrain, carry: carryFor(app.campaign, sc.id, carryMode) });
  drainEvents(w);
  restore(w, saved.snap, (world, def) => app.addMobileRadar && app.addMobileRadar(world, def));
  // Restored: from here on the game in hand is this one.
  data.scenario = sc;
  settings.scenario = sc.id;
  saveSettings(settings);
  stopTutorial(app);
  app.world = w;
  app.resumed = true;
  const meta = saved.meta || {};
  app.playClock = createPlayClock(meta.playClock);
  app.gameId = meta.gameId || newGameId();
  freshPage(app);
  for (const id of meta.signalsRead || []) app.signals.read.add(id);
  for (const entry of saved.journal || []) addLogEntry(app, entry.text, entry.level, entry.t, { report: entry.report, replay: true });
  app.logEntries = [...(saved.journal || [])];
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
  return { ok: false, code: 'damaged', detail: String((err && err.message) || err).slice(0, 80) };
}

/** Loads a save of the browser by its id: { ok } or { ok: false, code, detail }. */
export async function loadEntry(app, id) {
  try {
    const read = readSave(await app.store.read(id), scenarioIds());
    resumeSave(app, read);
    // The game loaded becomes the game under way.
    if (id !== CURRENT) saveCurrent(app);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Loads a game from the text of a file: { ok } or { ok: false, code, detail }. */
export function importText(app, text) {
  try {
    resumeSave(app, readSaveText(text, scenarioIds()));
    saveCurrent(app);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** The sentence of a refusal (save.errors.<code>). */
export function saveErrorText(result) {
  const key = `save.errors.${result.code}`;
  const text = t(key, { detail: result.detail || '' });
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
