// Entry point: loads the data, builds the page's state (the app), wires its parts, starts the
// loop and opens the main menu. What the game does lives in its modules: the life of a game
// and its saves (ui/game.js), the menus (ui/menu.js), the loop (ui/loop.js), the events
// (ui/gameEvents.js), the buttons of the panels (ui/panelActions.js).

import { loadJSON } from './core/data.js';
import { setDictionary, t, translatePage } from './core/i18n.js';
import { createTerrain } from './sim/terrain.js';
import { warmPortField } from './sim/searoute.js';
import { createWorld, step } from './sim/world.js';
import { drainEvents } from './sim/events.js';
import { formationById, leaderOf } from './sim/formations.js';
import { contactEstimate } from './sim/query.js';
import { addMobileRadar } from './sim/mru.js';
import { createCamera, toScreen } from './render/camera.js';
import { createMapRenderer } from './render/map.js';
import { loadSettings, saveSettings } from './save/settings.js';
import { createStore, CURRENT } from './save/store.js';
import { collectElements } from './ui/elements.js';
import { centreOn, select } from './ui/actions.js';
import { toolOffered } from './ui/offered.js';
import { carryFor, loadCampaign, scenarioIds, setCampaignData } from './ui/campaign.js';
import { exportGame, gameInProgress, loadEntry, newGame, saveCurrent, saveErrorText } from './ui/game.js';
import { handleEvents } from './ui/gameEvents.js';
import { attachMenu, goToMainMenu, hideMainMenu, markLessonDone, nextScenarioFor, openGameMenu, showMainMenu } from './ui/menu.js';
import { resolveScenario } from './core/scenarios.js';
import { startLoop } from './ui/loop.js';
import { attachPanels } from './ui/panelActions.js';
import { applySheet, attachSheetGrip, resize } from './ui/sheet.js';
import { attachTutorial } from './ui/tutorial.js';
import { attachDropChoice } from './ui/dropChoice.js';
import { initAlert, openJournal } from './ui/alerts.js';
import { createSignals, onWatchClick } from './ui/watchPanel.js';
import { initQuestions } from './ui/questions.js';
import { loadDev, saveDev } from './ui/dev.js';
import { openDesktopNotice, openHelp } from './ui/dialogs.js';
import { unlockAudio } from './ui/sound.js';
import { initHud } from './ui/hud.js';
import { attachInput } from './ui/input.js';
import { addLogEntry } from './ui/panels.js';
import { openCards, openReports } from './ui/pages.js';
import { openFormations } from './ui/formationsPage.js';
import { openRoster } from './ui/rosterPage.js';
import { openCrash } from './ui/crash.js';
import { createPlayClock, newGameId } from './ui/summary.js';

/** The data of the game: the lists of data/campaign.json say which scenarios to load. */
async function loadData() {
  const [fr, rules, presets, dev, helpImages, atlantic, channel, labels, campaign, tutorial] = await Promise.all([
    loadJSON('data/i18n/fr.json'),
    loadJSON('data/rules.json'),
    loadJSON('data/presets.json'),
    loadJSON('data/dev.json'),
    loadJSON('data/help/images.json').catch(() => ({})),
    loadJSON('data/maps/atlantic.json'),
    loadJSON('data/maps/channel.json'),
    loadJSON('data/maps/labels.json'),
    loadJSON('data/campaign.json'),
    loadJSON('data/tutorial.json'),
  ]);
  setCampaignData(campaign);
  // The scenarios of the menu, then those of the lessons (each written as one of the first
  // with changes: resolved on its base).
  const ids = [...new Set([...scenarioIds(), ...(tutorial.lessons || []).map((l) => l.scenario)])];
  const raw = await Promise.all(ids.map((id) => loadJSON(`data/scenarios/${id}.json`)));
  const scenarios = raw.map((def) => resolveScenario(def, (id) => raw.find((s) => s.id === id)));
  return { fr, rules, presets, dev, helpImages, atlantic, channel, labels, campaign, tutorial, scenarios };
}

/** The state of the page, and the few things its parts ask of each other through it. */
function createApp(el, data, settings, terrain) {
  const campaign = loadCampaign();
  data.scenario = data.scenarios.find((s) => s.id === settings.scenario) || data.scenarios[0];
  const world = createWorld({
    scenario: data.scenario, rules: data.rules, settings, terrain, carry: carryFor(campaign, data.scenario.id, settings.carry),
  });
  const app = {
    el,
    data,
    settings,
    terrain,
    campaign,
    store: createStore(),
    dev: loadDev(),
    world,
    canvas: el.canvas,
    ctx: el.canvas.getContext('2d'),
    dpr: 1,
    camera: createCamera(),
    mapRenderer: createMapRenderer(terrain, data.labels.labels),
    speed: 60,
    paused: false,
    accumulator: 0,
    selection: null,
    tool: null,
    drawing: null,
    ruler: null,
    flash: null,
    hits: [],
    fx: [],
    toteTab: 'units',
    sheetMessage: null,
    audio: null,
    dirtyPanels: true,
    dirtyHud: true,
    onMenu: false,
    signals: createSignals(), // the watch reports: tab, filters, what was read (watchPanel.js)
    playClock: createPlayClock(), // real time spent on this game (summary.js)
    gameId: newGameId(), // tells this game from another one of the same scenario (its saves)
  };
  app.unlockAudio = () => unlockAudio(app);
  app.showCrash = () => openCrash(app);
  app.addMobileRadar = addMobileRadar;
  app.resize = () => resize(app);
  app.applySheet = () => applySheet(app);
  /** Selects a formation and brings its leader into view (from the formations page). */
  app.selectFormation = (id) => {
    const f = formationById(app.world, id);
    if (!f) return;
    select(app, 'formation', id);
    const leader = leaderOf(app.world, f);
    if (leader) centreOn(app, leader.x, leader.y, f.kind === 'air' ? 1.5 : 0.6);
  };
  app.setTool = (tool) => {
    if (tool === 'ruler' && !toolOffered(app, 'ruler')) return; // not a tool of this scenario
    app.tool = tool;
    if (!tool) app.ruler = null;
    app.canvas.style.cursor = tool === 'ruler' || tool === 'rally' ? 'crosshair' : 'grab';
    app.dirtyHud = true;
    app.dirtyPanels = true;
  };
  app.toggleRadarCover = () => {
    if (!toolOffered(app, 'radarCover')) return;
    settings.radarCover = !settings.radarCover;
    saveSettings(settings);
    app.dirtyHud = true;
  };
  // Developer mode: the real enemy positions on the map, and an "Enemies" tab. Switched on
  // from the settings, with the password (dialogs.js).
  app.setDev = (on) => {
    if (app.dev === on) return;
    app.dev = on;
    saveDev(app.dev);
    if (!app.dev && app.toteTab === 'enemies') app.toteTab = 'units';
    addLogEntry(app, t(app.dev ? 'dev.on' : 'dev.off'), 'info', app.world.t);
    app.dirtyPanels = true;
    app.dirtyHud = true;
  };
  // The life of the game, for the pages that are not the menu (the end of a game, a crash).
  app.save = () => saveCurrent(app).ok;
  app.exportGame = (extra = null) => exportGame(app, extra);
  app.restart = (scenarioId = null, options = {}) => {
    const ok = newGame(app, scenarioId, options);
    if (ok) hideMainMenu(app); // a game asked for is played now
    return ok;
  };
  // A lesson played to its end is remembered; ended or left, its little world is dropped and
  // the list of the lessons comes back. (A lesson is never written in the browser: the game
  // the player had under way is still there, and « Continuer » brings it back.)
  const leaveLesson = () => {
    app.world.ended = true; // nothing left to continue
    app.launched = false;
    showMainMenu(app, 'training');
  };
  app.onTutorialDone = (lesson) => {
    markLessonDone(lesson);
    leaveLesson();
  };
  app.onTutorialQuit = leaveLesson;
  app.nextScenario = () => nextScenarioFor(app);
  app.toMainMenu = () => goToMainMenu(app);
  app.reloadCurrent = () => loadEntry(app, CURRENT);
  app.gameInProgress = () => gameInProgress(app);
  try {
    app.scheduleHintSeen = localStorage.getItem('jeu-1940.scheduleHint.v1') === '1';
  } catch {
    app.scheduleHintSeen = false;
  }
  return app;
}

/** The buttons of the top bar and the pages they open. */
function wireTopBar(app) {
  const { el } = app;
  el.dlgWatch.addEventListener('click', (e) => onWatchClick(app, e));
  // The sections of the Commandes tab stay open or folded as the player leaves them.
  el.unitPanel.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.dataset || !d.dataset.sec) return;
    app.settings.sections = { ...(app.settings.sections || {}), [d.dataset.sec]: d.open };
    saveSettings(app.settings);
  }, true);
  el.btnMenu.addEventListener('click', () => openGameMenu(app));
  el.saveProblem.addEventListener('click', () => openGameMenu(app));
  el.btnReports.addEventListener('click', () => openReports(app));
  el.btnCards.addEventListener('click', () => openCards(app));
  el.btnFormations.addEventListener('click', () => openFormations(app));
  el.btnRoster.addEventListener('click', () => openRoster(app));
  el.btnHelp.addEventListener('click', () => openHelp(app));
  el.btnJournal.addEventListener('click', () => openJournal(app));
}

async function start() {
  const el = collectElements();
  const data = await loadData();
  setDictionary(data.fr);
  translatePage(document);
  document.title = `${t('app.title')} · ${t('app.subtitle')}`;

  const settings = loadSettings(data.presets);
  const terrain = createTerrain(data.atlantic, data.channel);
  const app = createApp(el, data, settings, terrain);
  // The ports' distance fields (a tenth of a second each), worked out in quiet moments rather
  // than on the first look at « Rentrer au port ».
  setInterval(() => {
    if (!document.hidden) warmPortField(app.world);
  }, 700);

  resize(app);
  new ResizeObserver(() => resize(app)).observe(el.table);
  initHud(app);
  initAlert(app);
  initQuestions(app);
  attachInput(app);
  attachTutorial(app);
  attachPanels(app);
  attachSheetGrip(app);
  attachMenu(app);
  attachDropChoice(app);
  wireTopBar(app);
  applySheet(app);

  handleEvents(app, drainEvents(app.world));
  // The game left in the browser goes on where it was (one left by version 2.8 is taken over).
  app.store.adoptLegacy();
  let message = '';
  const kept = app.store.current();
  if (kept && !kept.ended && scenarioIds().includes(kept.scenario)) {
    const r = await loadEntry(app, CURRENT);
    if (!r.ok) message = saveErrorText(r);
    else app.paused = true;
  }
  app.lastSaveT = app.world.t;
  app.lastSaveReal = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrent(app);
  });
  window.addEventListener('pagehide', () => saveCurrent(app));
  el.loading.hidden = true;
  const smallScreen = window.innerWidth < 900 || (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
  showMainMenu(app, 'home', message);
  if (smallScreen) openDesktopNotice(app);

  // For the smoke test (tools/smoke) and for a look from the console: the same helpers in the
  // development version and in the single file.
  app.stepWorld = (n = 1) => {
    for (let i = 0; i < n && !app.world.ended; i++) step(app.world, 1);
  };
  app.toScreen = (x, y) => toScreen(app.camera, x, y);
  app.estimateOf = (raidId) => {
    const contact = app.world.contacts.get(raidId);
    return contact ? contactEstimate(app.world, contact) : null;
  };
  window.__game = app;

  startLoop(app);
}

start().catch((err) => {
  console.error(err);
  const box = document.getElementById('loading');
  if (box) {
    box.hidden = false;
    box.classList.add('error');
    box.textContent = t('app.error', { message: err.message });
  }
});
