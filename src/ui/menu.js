// The main menu: a full page, outside the map, where everything is launched and where the
// games are found again — Continuer, Campagne, Scénarios, Entraînement, Charger, Réglages,
// Aide. In a game, the ☰ button opens a short menu (Reprendre, Sauvegarder, Réglages de la
// partie, Aide, Recommencer, Menu principal). Leaving for the main menu saves the game;
// replacing a game under way, or starting it again after ten minutes of play, asks first.

import { escapeHtml, t } from '../core/i18n.js';
import { formatShortDate, formatTime, parseGameDate } from '../core/time.js';
import { VERSION } from '../core/version.js';
import { campaignChain, nextInChain, saveCampaign, scenarioIds, scenarioStatus, trainingId } from './campaign.js';
import { autosave, exportGame, gameInProgress, loadEntry, manualSave, newGame, readEntry, readFileText, resumeRead, saveCurrent, saveErrorText } from './game.js';
import { openEnd, openHelp, openSettings } from './dialogs.js';
import { dateTimeText, realDurationText } from './format.js';
import { CURRENT } from '../save/store.js';
import { saveSettings } from '../save/settings.js';
import { matchingPreset } from '../sim/gameSettings.js';

const TUTORIAL_KEY = 'jeu-1940.tutorial-done.v1';
const RESTART_ASKS_AFTER_MS = 10 * 60 * 1000;

export function tutorialDone() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialDone() {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // ignore
  }
}

const esc = escapeHtml;
const title = (id) => t(`scenarios.${id}.title`);

/** "10 – 24 juillet 1940", "15 septembre 1940", "10 janvier – 31 mars 1941". */
export function scenarioDatesText(sc) {
  const months = t('months');
  const a = new Date(parseGameDate(sc.start));
  const b = new Date(parseGameDate(sc.end));
  const year = (d) => d.getUTCFullYear();
  const day = (d) => d.getUTCDate();
  const month = (d) => months[d.getUTCMonth()];
  if (year(a) === year(b) && a.getUTCMonth() === b.getUTCMonth()) {
    return day(a) === day(b) ? t('menu.dates.day', { d: day(a), month: month(a), year: year(a) })
      : t('menu.dates.sameMonth', { a: day(a), b: day(b), month: month(a), year: year(a) });
  }
  return t('menu.dates.span', { a: day(a), ma: month(a), b: day(b), mb: month(b), year: year(b) });
}

/** "45 min à 1 h 30", "3 à 5 h": the estimated length of a game, from data/campaign.json. */
export function playLengthText(minutes) {
  const [lo, hi] = minutes;
  const part = (m) => (m < 60 ? t('menu.length.min', { n: m }) : m % 60 ? t('menu.length.hm', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') }) : t('menu.length.h', { h: m / 60 }));
  if (lo >= 60 && hi >= 60 && lo % 60 === 0 && hi % 60 === 0) return t('menu.length.hours', { a: lo / 60, b: hi / 60 });
  if (hi < 60) return t('menu.length.minutes', { a: lo, b: hi });
  return t('menu.length.range', { a: part(lo), b: part(hi) });
}

/** Asks a question in a small dialog: resolves true (the `yes` button) or false. */
export function confirmDialog(app, { heading, text, yes, no = null, danger = false, extra = null }) {
  const dlg = app.el.dlgConfirm;
  return new Promise((resolve) => {
    // `extra`: a third button ({ label, run }) that does something without answering; what
    // `run` returns is shown under the buttons.
    dlg.innerHTML = `
      <form method="dialog" class="confirm">
        <h2>${esc(heading)}</h2>
        <p>${esc(text)}</p>
        <div class="dialog-buttons">
          <button type="button" data-confirm="no" class="secondary">${esc(no || t('menu.cancel'))}</button>
          ${extra ? `<button type="button" data-confirm="extra" class="secondary">${esc(extra.label)}</button>` : ''}
          <button type="button" data-confirm="yes"${danger ? ' class="danger"' : ''}>${esc(yes)}</button>
        </div>
        <p class="message" data-confirm-message hidden></p>
      </form>`;
    const done = (answer) => {
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    dlg.querySelector('[data-confirm="yes"]').addEventListener('click', () => done(true));
    dlg.querySelector('[data-confirm="no"]').addEventListener('click', () => done(false));
    if (extra) {
      dlg.querySelector('[data-confirm="extra"]').addEventListener('click', async () => {
        const said = await extra.run();
        const msg = dlg.querySelector('[data-confirm-message]');
        if (msg && said) {
          msg.hidden = false;
          msg.textContent = said;
        }
      });
    }
    dlg.oncancel = (e) => {
      e.preventDefault();
      done(false);
    };
    dlg.onclose = () => resolve(false);
    dlg.showModal();
    dlg.querySelector('[data-confirm="no"]').focus();
  });
}

/** What the menu says of the game in hand, or of the one kept in the browser. */
function currentGame(app) {
  if (gameInProgress(app)) {
    const w = app.world;
    return { scenario: w.scenario.id, gameMs: w.startMs + w.t * 1000, playMs: app.playClock ? app.playClock.totalMs : 0, loaded: true };
  }
  const e = app.store.current();
  if (e && !e.ended && scenarioIds().includes(e.scenario)) return { scenario: e.scenario, gameMs: e.gameMs, playMs: e.playMs, loaded: false };
  return null;
}

function gameLine(g) {
  return t('menu.gameLine', {
    scenario: title(g.scenario), when: g.gameMs === null || g.gameMs === undefined ? '' : dateTimeText(g.gameMs), played: realDurationText(g.playMs || 0),
  });
}

/**
 * The game in hand is kept as an automatic save before something replaces it. When that
 * fails (a storage full or closed), the player is told and asked again, with the export of
 * the game at hand: the promise « elle sera gardée » is not one the game breaks in silence.
 * Resolves false when the player would rather not lose it.
 */
async function keepBeforeReplacing(app) {
  const g = currentGame(app);
  const r = await autosave(app);
  if (r.ok || r.code === 'nothing') return true;
  return confirmDialog(app, {
    heading: t('menu.notKept.heading'),
    text: t('menu.notKept.text', { game: g ? gameLine(g) : '' }),
    yes: t('menu.notKept.yes'),
    danger: true,
    extra: {
      label: t('save.export'),
      run: async () => {
        const result = await exportGame(app);
        return result === 'saved' ? t('menu.notKept.exported') : result === 'failed' ? t('save.exportError') : '';
      },
    },
  });
}

/**
 * Before a game under way is replaced (a new game, a save loaded, a file imported): asks,
 * and keeps the game replaced as an automatic save. Resolves false when the player says no.
 * (A lesson of the tutorial is left without a word: it is not a game that is kept.)
 */
async function mayReplace(app) {
  if (!gameInProgress(app) || app.tutorial) return true;
  const g = currentGame(app);
  const ok = await confirmDialog(app, {
    heading: t('menu.replace.heading'), text: t('menu.replace.text', { game: gameLine(g) }), yes: t('menu.replace.yes'),
  });
  if (!ok) return false;
  return keepBeforeReplacing(app);
}

/** Closes the main menu: the game in hand is on the page again. */
export function hideMainMenu(app) {
  if (app.onMenu) leaveMenu(app);
}

function leaveMenu(app) {
  app.onMenu = false;
  app.el.menu.hidden = true;
  document.body.classList.remove('on-menu');
  app.dirtyHud = true;
  app.dirtyPanels = true;
  if (app.resize) app.resize();
}

/** Starts a scenario from the menu (asking first when a game under way would be replaced). */
async function play(app, scenarioId, { tutorial = false } = {}) {
  if (!(await mayReplace(app))) return;
  // (The game begins as newGame leaves it: running, or stopped on the first step of a lesson.)
  newGame(app, scenarioId, { tutorial });
  leaveMenu(app);
}

/** Back to the game in hand, or to the one kept in the browser. */
async function continueGame(app) {
  const g = currentGame(app);
  if (!g) return;
  if (!g.loaded) {
    const r = await loadEntry(app, CURRENT);
    if (!r.ok) {
      showMainMenu(app, 'home', saveErrorText(r));
      return;
    }
    // A game that comes back from the browser waits for the player, like any game loaded.
    leaveMenu(app);
    app.paused = true;
    if (app.world.ended) openEnd(app);
    return;
  }
  leaveMenu(app);
  if (app.menuWasRunning) {
    app.paused = false;
    app.accumulator = 0;
  }
}

// ---- the pages of the menu ----------------------------------------------------------------

function homePage(app, message) {
  const g = currentGame(app);
  const learnt = tutorialDone();
  const chain = campaignChain();
  const won = chain.filter((id) => scenarioStatus(app.campaign, id) === 'won').length;
  const saves = app.store.entries().length;
  const entry = (id, label, text, main = false) =>
    `<button type="button" class="mm-entry${main ? ' mm-main' : ''}" data-menu="${id}"><b>${esc(label)}</b><small>${esc(text)}</small></button>`;
  const training = entry('training', t('menu.training'), t(learnt ? 'menu.trainingText' : 'menu.trainingFirst'), !learnt && !g);
  const entries = [
    g ? entry('continue', t('menu.continue'), gameLine(g), true) : '',
    // The training comes first until its lesson has been played to the end (C16).
    learnt ? '' : training,
    entry('campaign', t('menu.campaign'), t('menu.campaignText', { won, total: chain.length }), learnt && !g),
    entry('scenarios', t('menu.scenarios'), t('menu.scenariosText')),
    learnt ? training : '',
    entry('load', t('menu.load'), t(saves ? 'menu.loadText' : 'menu.loadNone', { n: saves })),
  ].join('');
  return `
    <div class="mm-list">${entries}</div>
    <div class="mm-row">
      <button type="button" data-menu="settings">${esc(t('menu.settings'))}</button>
      <button type="button" data-menu="help">${esc(t('menu.help'))}</button>
    </div>
    ${message ? `<p class="message">${esc(message)}</p>` : ''}
    ${storageWarning(app)}
    ${app.saveProblem && app.store.available ? '' : `<p class="hint mm-note">${esc(t(app.store.available ? 'menu.note' : 'menu.noStorage'))}</p>`}`;
}

/** A write that failed is told on the menu too, until one succeeds. */
function storageWarning(app) {
  return app.saveProblem && app.store.available ? `<p class="message" data-save-problem>${esc(t('save.errors.storage'))}</p>` : '';
}

/**
 * The preset the next game begins with, chosen where a game is launched. (A game under way
 * keeps its own: ☰, « Réglages de la partie ».)
 */
function presetChooser(app) {
  const presets = app.data.presets;
  const now = matchingPreset(app.settings, presets);
  const buttons = Object.keys(presets.presets).map((name) =>
    `<button type="button" data-preset="${esc(name)}" class="${name === now ? 'active' : ''}" aria-pressed="${name === now}">${esc(t(`settings.presets.${name}`))}</button>`).join('');
  return `
    <div class="mm-preset" role="group" aria-label="${esc(t('menu.preset'))}">
      <span>${esc(t('menu.preset'))}</span>${buttons}
      ${now === 'custom' ? `<span class="badge">${esc(t('settings.presets.custom'))}</span>` : ''}
    </div>
    <p class="hint mm-preset-text">${esc(t(`menu.presetText.${now}`))}</p>`;
}

function presetLine(result) {
  if (!result || !result.won || !result.preset) return '';
  const end = t(`settings.presets.${result.preset}`);
  if (!result.presetStart || result.presetStart === result.preset) return t('menu.wonIn', { preset: end });
  return t('menu.wonChanged', { start: t(`settings.presets.${result.presetStart}`), end });
}

function campaignPage(app) {
  const c = app.campaign;
  const rows = campaignChain().map((id, i) => {
    const sc = app.data.scenarios.find((s) => s.id === id);
    if (!sc) return '';
    const status = scenarioStatus(c, id);
    const locked = status === 'locked';
    const story = presetLine(c.results[id]);
    return `
      <li class="mm-step ${status}">
        <span class="mm-num">${i + 1}</span>
        <div class="mm-step-body">
          <b>${esc(title(id))}</b> <span class="badge ${status}">${esc(t(`campaign.${status}`))}</span>
          <p>${esc(scenarioDatesText(sc))} · ${esc(t(locked ? 'scenarios.locked' : `scenarios.${id}.stake`))}</p>
          ${story ? `<p class="hint">${esc(story)}</p>` : ''}
        </div>
        <button type="button" data-play="${esc(id)}"${locked ? ' disabled' : ''}>${esc(t(status === 'won' ? 'menu.replay' : 'scenarios.play'))}</button>
      </li>`;
  }).join('');
  return `
    <h2>${esc(t('campaign.title'))}</h2>
    <p class="hint">${esc(t('campaign.intro'))}</p>
    ${presetChooser(app)}
    <ol class="mm-chain">${rows}</ol>
    <label class="check"><input type="checkbox" data-unlock-all${c.unlockAll ? ' checked' : ''}> ${esc(t('campaign.unlockAll'))}</label>`;
}

function scenariosPage(app) {
  const cards = scenarioIds().map((id) => {
    const sc = app.data.scenarios.find((s) => s.id === id);
    if (!sc) return '';
    const status = scenarioStatus(app.campaign, id);
    const locked = status === 'locked';
    const card = app.data.campaign.cards[id];
    const training = id === trainingId();
    return `
      <li class="mm-card ${status}">
        <h3>${esc(title(id))} ${status === 'free' ? '' : `<span class="badge ${status}">${esc(t(`campaign.${status}`))}</span>`}</h3>
        <p class="mm-dates">${esc(scenarioDatesText(sc))}${card ? ` · ${esc(t('menu.length.label', { length: playLengthText(card.minutes) }))}` : ''}</p>
        <p class="mm-stake">${esc(t(`scenarios.${id}.stake`))}</p>
        <p class="mm-text">${esc(t(locked ? 'scenarios.locked' : `scenarios.${id}.text`))}</p>
        <div class="mm-card-buttons">
          ${training ? `<button type="button" data-play="${esc(id)}" data-tutorial="1">${esc(t('campaign.tutorial'))}</button>` : ''}
          <button type="button" data-play="${esc(id)}"${locked ? ' disabled' : ''}${training ? ' class="secondary"' : ''}>${esc(t(training ? 'menu.playFree' : 'scenarios.play'))}</button>
        </div>
      </li>`;
  }).join('');
  return `
    <h2>${esc(t('menu.scenarios'))}</h2>
    ${presetChooser(app)}
    <ul class="mm-cards">${cards}</ul>
    <label class="check"><input type="checkbox" data-unlock-all${app.campaign.unlockAll ? ' checked' : ''}> ${esc(t('campaign.unlockAll'))}</label>`;
}

function loadPage(app, message) {
  const entries = app.store.entries();
  const rows = entries.map((e) => {
    const when = e.gameMs === null || e.gameMs === undefined ? '' : dateTimeText(e.gameMs);
    const saved = new Date(e.savedAt);
    const savedText = t('menu.savedAt', { date: formatShortDate(e.savedAt - saved.getTimezoneOffset() * 60000, t('months')), time: formatTime(e.savedAt - saved.getTimezoneOffset() * 60000) });
    const known = scenarioIds().includes(e.scenario);
    return `
      <li class="mm-save ${e.kind}">
        <div class="mm-save-body">
          <b>${esc(known ? title(e.scenario) : e.scenario)}</b> <span class="badge ${e.kind}">${esc(t(`menu.kinds.${e.kind}`))}</span>${e.ended ? ` <span class="badge">${esc(t('menu.ended'))}</span>` : ''}
          <p>${esc(t('menu.saveLine', { when, played: realDurationText(e.playMs || 0), preset: e.preset ? t(`settings.presets.${e.preset}`) : t('menu.noPreset') }))}</p>
          <p class="hint">${esc(savedText)}</p>
        </div>
        <span class="mm-save-buttons">
          <button type="button" data-load="${esc(e.id)}"${known ? '' : ' disabled'}>${esc(t('menu.loadThis'))}</button>
          <button type="button" class="secondary" data-delete="${esc(e.id)}">${esc(t('menu.delete'))}</button>
        </span>
      </li>`;
  }).join('');
  return `
    <h2>${esc(t('menu.load'))}</h2>
    <p class="hint">${esc(t('menu.loadIntro'))}</p>
    ${entries.length ? `<ul class="mm-saves">${rows}</ul>` : `<p class="hint">${esc(t('menu.noSaves'))}</p>`}
    <div class="mm-row">
      <label class="file-button">${esc(t('save.import'))}<input type="file" accept=".json,application/json" data-import hidden></label>
    </div>
    ${app.store.available ? '' : `<p class="message">${esc(t('menu.noStorage'))}</p>`}
    ${storageWarning(app)}
    ${message ? `<p class="message">${esc(message)}</p>` : ''}`;
}

/** Shows the main menu (page: home, campaign, scenarios or load). The game is paused under it. */
export function showMainMenu(app, page = 'home', message = '') {
  const box = app.el.menu;
  if (!app.onMenu) {
    app.menuWasRunning = !app.paused && !app.world.ended && gameInProgress(app);
    app.paused = true;
    app.onMenu = true;
    document.body.classList.add('on-menu');
    app.dirtyHud = true;
  }
  app.menuPage = page;
  // (Another page of the game may have saved since this one last looked.)
  app.store.refresh();
  const body = page === 'campaign' ? campaignPage(app) : page === 'scenarios' ? scenariosPage(app) : page === 'load' ? loadPage(app, message) : homePage(app, message);
  box.innerHTML = `
    <div class="mm-page mm-${page}">
      <header class="mm-title">
        <h1>${esc(t('app.title'))}</h1>
        <p>${esc(t('app.subtitle'))}</p>
      </header>
      <div class="mm-body">
        ${page === 'home' ? '' : `<button type="button" class="link mm-back" data-menu="home">${esc(t('menu.back'))}</button>`}
        ${body}
      </div>
      <footer class="mm-foot">${esc(t('menu.version', { v: VERSION }))}</footer>
    </div>`;
  box.hidden = false;
  box.scrollTop = 0;
  const first = box.querySelector('.mm-main') || box.querySelector('button');
  if (first && !document.querySelector('dialog[open]')) first.focus({ preventScroll: true });
}

/** After a save was put in place of the game in hand: on to the game, which waits for the player. */
function loaded(app, r) {
  if (!r.ok) {
    showMainMenu(app, 'load', saveErrorText(r));
    return;
  }
  leaveMenu(app);
  app.paused = true;
  // A game that was over shows how it ended.
  if (app.world.ended) openEnd(app);
}

/** The clicks and changes of the main menu page (wired once). */
export function attachMenu(app) {
  const box = app.el.menu;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.menu === 'continue') await continueGame(app);
    else if (d.menu === 'training') await play(app, trainingId(), { tutorial: true });
    else if (d.menu === 'settings') openSettings(app, { scope: 'defaults' });
    else if (d.menu === 'help') openHelp(app);
    else if (d.menu) showMainMenu(app, d.menu);
    else if (d.preset) {
      // The player's settings for the games to come take the values of the preset.
      const values = app.data.presets.presets[d.preset];
      if (!values) return;
      Object.assign(app.settings, values, { preset: d.preset });
      saveSettings(app.settings);
      showMainMenu(app, app.menuPage);
    } else if (d.play) await play(app, d.play, { tutorial: Boolean(d.tutorial) });
    else if (d.load) {
      // Read and checked first: a save that cannot be loaded asks nothing and replaces nothing.
      const read = await readEntry(app, d.load);
      if (!read.ok) {
        showMainMenu(app, 'load', saveErrorText(read));
        return;
      }
      if (!(await mayReplace(app))) return;
      loaded(app, resumeRead(app, read.read, { keep: d.load !== CURRENT }));
    } else if (d.delete) {
      const entry = app.store.entry(d.delete);
      if (!entry) return;
      const ok = await confirmDialog(app, {
        heading: t('menu.deleteHeading'), text: t('menu.deleteText', { game: gameLine(entry) }), yes: t('menu.delete'), danger: true,
      });
      if (ok) {
        app.store.remove(d.delete);
        showMainMenu(app, 'load');
      }
    }
  });
  box.addEventListener('change', async (e) => {
    if (e.target.matches('[data-unlock-all]')) {
      app.campaign.unlockAll = e.target.checked;
      saveCampaign(app.campaign);
      showMainMenu(app, app.menuPage);
      return;
    }
    if (!e.target.matches('[data-import]')) return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    e.target.value = ''; // the same file can be chosen again
    const read = readFileText(app, text);
    if (!read.ok) {
      showMainMenu(app, 'load', saveErrorText(read));
      return;
    }
    if (!(await mayReplace(app))) return;
    loaded(app, resumeRead(app, read.read));
  });
  // Escape goes back: to the first page, or to the game in hand.
  window.addEventListener('keydown', (e) => {
    if (!app.onMenu || e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (app.menuPage !== 'home') showMainMenu(app, 'home');
    else if (gameInProgress(app)) continueGame(app);
  });
}

/** Leaves the game for the main menu: the game is saved first (a write that fails is told there). */
export function goToMainMenu(app) {
  saveCurrent(app);
  showMainMenu(app, 'home');
}

/** « Recommencer »: the same scenario from its start; asked first after ten minutes of play. */
export async function restartGame(app) {
  const played = app.playClock ? app.playClock.totalMs : 0;
  if (gameInProgress(app) && played >= RESTART_ASKS_AFTER_MS) {
    const ok = await confirmDialog(app, {
      heading: t('menu.restart.heading'), text: t('menu.restart.text', { played: realDurationText(played) }), yes: t('menu.restart.yes'), danger: true,
    });
    if (!ok) return false;
    if (!(await keepBeforeReplacing(app))) return false;
  }
  newGame(app);
  return true;
}

/** After the end of a game: the next scenario of the campaign, when there is one and it is open. */
export function nextScenarioFor(app) {
  const next = nextInChain(app.world.scenario.id);
  return next && scenarioStatus(app.campaign, next) !== 'locked' ? next : null;
}

/** The ☰ menu of a game: Reprendre, Sauvegarder, Réglages de la partie, Aide, Recommencer, Menu principal. */
export function openGameMenu(app) {
  const dlg = app.el.dlgMenu;
  if (!dlg.open) {
    app.menuWasRunning = !app.paused && !app.world.ended;
    app.paused = true;
    app.dirtyHud = true;
  }
  const w = app.world;
  dlg.innerHTML = `
    <form method="dialog" class="game-menu">
      <h2>${esc(title(w.scenario.id))}</h2>
      <p class="hint">${esc(t('menu.gameNow', { when: dateTimeText(w.startMs + w.t * 1000), played: realDurationText(app.playClock ? app.playClock.totalMs : 0) }))}</p>
      <div class="gm-buttons">
        <button type="button" class="mm-main" data-gm="resume">${esc(t('menu.resume'))}</button>
        <button type="button" data-gm="save"${w.ended ? ' disabled' : ''}>${esc(t('menu.save'))}</button>
        <button type="button" data-gm="export">${esc(t('save.export'))}</button>
        <button type="button" data-gm="settings">${esc(t('menu.gameSettings'))}</button>
        <button type="button" data-gm="help">${esc(t('menu.help'))}</button>
        <button type="button" data-gm="restart">${esc(t('menu.restartGame'))}</button>
        <button type="button" data-gm="main">${esc(t('menu.main'))}</button>
      </div>
      <p class="message" data-gm-message hidden></p>
    </form>`;
  const say = (text) => {
    const msg = dlg.querySelector('[data-gm-message]');
    msg.hidden = false;
    msg.textContent = text;
  };
  const close = (run) => {
    if (dlg.open) dlg.close();
    if (run && app.menuWasRunning) {
      app.paused = false;
      app.accumulator = 0;
    }
    app.dirtyHud = true;
  };
  dlg.querySelector('.gm-buttons').onclick = async (e) => {
    const b = e.target.closest('[data-gm]');
    if (!b || b.disabled) return;
    const what = b.dataset.gm;
    if (what === 'resume') close(true);
    else if (what === 'save') {
      const r = await manualSave(app);
      say(r.ok ? t('menu.saved', { when: dateTimeText(w.startMs + w.t * 1000) }) : saveErrorText(r));
    } else if (what === 'export') {
      const result = await exportGame(app);
      if (result === 'failed') say(t('save.exportError'));
    } else if (what === 'settings') openSettings(app, { scope: 'game' });
    else if (what === 'help') openHelp(app);
    else if (what === 'restart') {
      close(false);
      if (!(await restartGame(app))) openGameMenu(app);
    } else if (what === 'main') {
      close(false);
      goToMainMenu(app);
    }
  };
  // Escape carries on with the game, like « Reprendre ».
  dlg.oncancel = (e) => {
    e.preventDefault();
    close(true);
  };
  if (!dlg.open) dlg.showModal();
}
