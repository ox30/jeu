// Entry point: loads the data, builds the world and runs the game loop.

import { loadJSON } from './core/data.js';
import { setDictionary, t, translatePage } from './core/i18n.js';
import { createTerrain } from './sim/terrain.js';
import { createWorld, step } from './sim/world.js';
import { drainEvents } from './sim/events.js';
import { createCamera, clampCentre, setFrame, updateCamera, viewFrame, VIEWS } from './render/camera.js';
import { createMapRenderer } from './render/map.js';
import { drawScene } from './render/scene.js';
import { helpSeen, loadSettings, saveSettings } from './save/settings.js';
import {
  activePoint, addRulerLeg, addTypedLeg, cancelEditLeg, centreOn, changeAltitude, changePointAltitude, clearPointAltitude,
  deletePoint, findUnit, goView, orderAdmiraltyRoute, orderClearPlan, orderCover, orderEndAction, orderEscortHome,
  orderHome, orderJoin, orderLeave, orderMinStock, orderOrbit, orderRemoveLeg, orderSail, orderTrain, orderVector,
  orderAlert, orderConvoySpeed, orderEscortBehaviour, orderIntercept, orderOffer, orderPurchase,
  orderZigzag, scrambleSquadron, select, selectedUnit, startEditLeg, toggleBuster,
  orderDissolve, orderFormationAlert, orderLaunchWaiting, orderLeaveFormationOf, orderMerge, orderNewFormation,
} from './ui/actions.js';
import { formationById, leaderOf } from './sim/formations.js';
import { contactEstimate } from './sim/query.js';
import { openFormations } from './ui/formationsPage.js';
import { carryFor, loadCampaign, recordResult } from './ui/campaign.js';
import { attachTutorial, startTutorial, stopTutorial, tutorialEvent, updateTutorial } from './ui/tutorial.js';
import { fighterShare } from './sim/objectives.js';
import { alertForEvent, initAlert, resetAlerts, updateAlerts } from './ui/alerts.js';
import { ALERT_TYPES } from './ui/alertRules.js';
import { loadDev, saveDev } from './ui/dev.js';
import { openDesktopNotice, openEnd, openHelp, openScenarios, openSettings, openSuccess } from './ui/dialogs.js';
import { playBombs, playGuns, playRadio, unlockAudio } from './ui/sound.js';
import { addEffectsForEvent } from './render/fx.js';
import { eventMessage } from './ui/format.js';
import { initHud, updateHud } from './ui/hud.js';
import { attachInput } from './ui/input.js';
import { addLogEntry, clearLog, renderPanels } from './ui/panels.js';
import { openCards, openReports } from './ui/pages.js';
import { clearBrowserSave, exportText, loadFromBrowser, parseExport, restore, saveToBrowser } from './save/game.js';
import { addMobileRadar } from './sim/mru.js';
import { openEvent } from './ui/dialogs.js';
import { setSpeed } from './sim/orders.js';

const MAX_STEPS_PER_FRAME = 6000;
// Events handled at once, without the rest of the frame's steps: every alert, and a few more.
const INTERRUPTING = new Set([
  ...ALERT_TYPES, 'scenarioEnd', 'allObjectivesDone', 'convoyArrived', 'pilotAboard', 'uboatSighted', 'scenarioEvent', 'mruReady',
]);
const RADIO = new Set(['tallyHo', 'missed', 'nothingSeen', 'bingo', 'outOfAmmo', 'divert', 'divertOut', 'legMissed', 'convoySighted', 'interceptOrdered', 'uboatSighted']);
const SCENARIOS = ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique', 'm0-july-1940'];

const $ = (id) => document.getElementById(id);

function collectElements() {
  return {
    canvas: $('map'),
    table: $('table'),
    clock: $('clock'),
    date: $('date'),
    time: $('time'),
    pause: $('btn-pause'),
    speeds: $('speeds'),
    btnAtlantic: $('btn-atlantic'),
    btnEngland: $('btn-england'),
    btnBritain: $('btn-britain'),
    btnScenario: $('btn-scenario'),
    coach: $('coach'),
    devBadge: $('dev-badge'),
    tabEnemies: $('tab-enemies'),
    subtitle: $('hud-subtitle'),
    btnReports: $('btn-reports'),
    btnCards: $('btn-cards'),
    btnFormations: $('btn-formations'),
    btnRuler: $('btn-ruler'),
    btnRadar: $('btn-radar'),
    btnSettings: $('btn-settings'),
    btnHelp: $('btn-help'),
    btnPanel: $('btn-panel'),
    panel: $('panel'),
    objectives: $('objectives'),
    tabUnits: $('tab-units'),
    tabSites: $('tab-sites'),
    tabLogistics: $('tab-logistics'),
    tote: $('tote'),
    panelHint: $('panel-hint'),
    unitPanel: $('unit-panel'),
    unitTitle: $('unit-title'),
    unitSummary: $('unit-summary'),
    unitTabs: $('unit-tabs'),
    unitMessage: $('unit-message'),
    unitPre: $('unit-pre'),
    unitProfile: $('unit-profile'),
    unitKeyed: $('unit-keyed'),
    unitPost: $('unit-post'),
    log: $('log'),
    logSection: $('log-section'),
    speedConfirm: $('speed-confirm'),
    alert: $('alert'),
    alertTitle: $('alert-title'),
    alertMore: $('alert-more'),
    alertText: $('alert-text'),
    alertShow: $('alert-show'),
    alertClose: $('alert-close'),
    loading: $('loading'),
    dlgSettings: $('dlg-settings'),
    dlgHelp: $('dlg-help'),
    dlgEnd: $('dlg-end'),
    dlgSuccess: $('dlg-success'),
    dlgDesktop: $('dlg-desktop'),
    dlgScenario: $('dlg-scenario'),
    dlgReports: $('dlg-reports'),
    dlgCards: $('dlg-cards'),
    dlgFormations: $('dlg-formations'),
    dlgEvent: $('dlg-event'),
  };
}

async function loadData() {
  const [fr, rules, presets, atlantic, channel, labels, ...scenarios] = await Promise.all([
    loadJSON('data/i18n/fr.json'),
    loadJSON('data/rules.json'),
    loadJSON('data/presets.json'),
    loadJSON('data/maps/atlantic.json'),
    loadJSON('data/maps/channel.json'),
    loadJSON('data/maps/labels.json'),
    ...SCENARIOS.map((id) => loadJSON(`data/scenarios/${id}.json`)),
  ]);
  return { fr, rules, presets, atlantic, channel, labels, scenarios };
}

function scenarioById(data, id) {
  return data.scenarios.find((s) => s.id === id) || data.scenarios[0];
}

function handleEvents(app, events) {
  for (const e of events) {
    tutorialEvent(app, e);
    const msg = eventMessage(app.world, e);
    const report = (e.type === 'raidReport' || e.type === 'combatReport') && app.world.reports.has(e.raidId) ? e.raidId : null;
    if (msg) addLogEntry(app, msg.text, msg.level, e.t, { report });
    addEffectsForEvent(app, e);
    if (RADIO.has(e.type) || (e.type === 'raidSighted' && e.kind === 'squadron')) playRadio(app);
    else if (e.type === 'combatRound') playGuns(app);
    else if (e.type === 'siteHit' || e.type === 'shipsSunk') playBombs(app);
    // Every event that needs the player raises an alert and slows the game (alertRules.js).
    const alert = alertForEvent(app, e);
    if (e.type === 'uboatAttack' || e.type === 'convoyBombed') app.lastNavalAttack = e.t;
    if (e.type === 'raidDetected') {
      if (alert && app.settings.autoZoom && app.camera.scale < 0.6) goView(app, 'england');
    } else if (e.type === 'scenarioEvent' && e.important) {
      setTimeout(() => openEvent(app, e), 200);
    } else if (e.type === 'allObjectivesDone') {
      if (!app.world.ended) setTimeout(() => openSuccess(app), 400);
    } else if (e.type === 'scenarioEnd') {
      app.paused = true;
      app.dirtyHud = true;
      clearBrowserSave();
      app.unlocked = recordResult(app.campaign, app.world, fighterShare(app.world));
      openEnd(app);
    }
  }
  if (events.length) app.dirtyPanels = true;
}

function inputValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : '';
}

function clearLegInputs() {
  for (const id of ['leg-heading', 'leg-end', 'leg-speed', 'leg-alt']) {
    const input = document.getElementById(id);
    if (input) input.value = '';
  }
}

function onPanelClick(app, e) {
  const reportLine = e.target.closest('[data-report]');
  if (reportLine) {
    openReports(app, reportLine.dataset.report);
    return;
  }
  const fold = e.target.closest('[data-log-toggle]');
  if (fold) {
    fold.parentElement.classList.toggle('collapsed');
    return;
  }
  const section = e.target.closest('[data-log-section]');
  if (section) {
    app.el.logSection.classList.toggle('collapsed');
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    app.toteTab = tab.dataset.tab;
    app.dirtyPanels = true;
    return;
  }
  const unitTab = e.target.closest('[data-unit-tab]');
  if (unitTab) {
    // The tab chosen stays open for every unit of the same kind.
    app.unitTabs = { ...(app.unitTabs || {}), [unitTab.dataset.group]: unitTab.dataset.unitTab };
    app.dirtyPanels = true;
    return;
  }
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const { action, id, kind } = b.dataset;
  const sq = app.world.squadrons.find((s) => s.id === id);
  const unit = kind ? findUnit(app, kind, id) : sq;
  switch (action) {
    case 'select':
      select(app, kind, id);
      break;
    case 'cards':
      openCards(app, b.dataset.type);
      break;
    case 'mru-deploy':
      app.setTool(app.tool === 'mru' ? null : 'mru');
      app.dirtyPanels = true;
      break;
    case 'scramble':
      if (sq) scrambleSquadron(app, sq);
      break;
    case 'alt-up':
      if (sq) changeAltitude(app, sq, 1000);
      break;
    case 'alt-down':
      if (sq) changeAltitude(app, sq, -1000);
      break;
    case 'speed-cruise':
      if (sq) setSpeed(app.world, sq, 'cruise');
      break;
    case 'speed-max':
      if (sq && sq.speedMode !== 'max') toggleBuster(app, sq);
      break;
    case 'vector': {
      const value = Number(inputValue('vector-input'));
      if (sq && inputValue('vector-input') !== '' && value >= 0 && value <= 360) orderVector(app, sq, value);
      break;
    }
    case 'orbit':
      if (sq) orderOrbit(app, sq);
      break;
    case 'home':
      if (sq) orderHome(app, sq);
      break;
    case 'add-leg':
      if (unit && addTypedLeg(app, unit, inputValue('leg-heading'), inputValue('leg-end'), inputValue('leg-speed'), inputValue('leg-alt'))) clearLegInputs();
      break;
    case 'edit-leg':
      if (unit) startEditLeg(app, unit, Number(b.dataset.index));
      break;
    case 'cancel-edit-leg':
      cancelEditLeg(app);
      break;
    case 'point-alt-up':
    case 'point-alt-down': {
      const ap = activePoint(app);
      if (ap) changePointAltitude(app, ap.u, ap.index, action === 'point-alt-up' ? 1000 : -1000);
      break;
    }
    case 'point-alt-clear': {
      const ap = activePoint(app);
      if (ap) clearPointAltitude(app, ap.u, ap.index);
      break;
    }
    case 'point-delete': {
      const ap = activePoint(app);
      if (ap) deletePoint(app, ap.u, ap.index);
      break;
    }
    case 'add-ruler-leg':
      if (unit) addRulerLeg(app, unit);
      break;
    case 'clear-plan':
      if (unit) orderClearPlan(app, unit);
      break;
    case 'remove-leg':
      if (unit) orderRemoveLeg(app, unit, Number(b.dataset.index));
      break;
    case 'sail':
      if (unit) orderSail(app, unit);
      break;
    case 'join':
      if (unit) orderJoin(app, unit, b.dataset.convoy);
      break;
    case 'leave':
      if (unit) orderLeave(app, unit);
      break;
    case 'escort-home':
      if (unit) orderEscortHome(app, unit);
      break;
    case 'cover':
      if (sq) orderCover(app, sq, b.dataset.convoy);
      break;
    case 'intercept':
      if (sq) orderIntercept(app, sq, b.dataset.raid);
      break;
    case 'alert':
      if (sq) orderAlert(app, sq, b.dataset.alert);
      break;
    case 'zigzag':
      if (unit) orderZigzag(app, unit);
      break;
    case 'escort-behaviour':
      if (unit) orderEscortBehaviour(app, unit, b.dataset.behaviour);
      break;
    case 'formation-new': {
      const f = unit ? orderNewFormation(app, unit) : null;
      if (f) openFormations(app, { focus: f.id });
      break;
    }
    case 'formation-manage':
      openFormations(app, { focus: id });
      break;
    case 'formation-launch':
    case 'formation-alert':
    case 'formation-dissolve':
    case 'formation-merge': {
      const f = formationById(app.world, id);
      if (!f) break;
      if (action === 'formation-launch') orderLaunchWaiting(app, f);
      else if (action === 'formation-alert') orderFormationAlert(app, f, b.dataset.alert);
      else if (action === 'formation-dissolve') orderDissolve(app, f);
      else {
        const from = formationById(app.world, b.dataset.from);
        if (from) orderMerge(app, f, from);
      }
      break;
    }
    case 'formation-remove': {
      const f = formationById(app.world, b.dataset.formation);
      if (f) orderLeaveFormationOf(app, f, id);
      break;
    }
    case 'centre-selection':
      centreSelection(app);
      break;
    case 'close-unit':
      select(app, null, null);
      break;
    case 'purchase':
      orderPurchase(app, Number(b.dataset.share));
      break;
    case 'offer':
      orderOffer(app, b.dataset.offer);
      break;
    case 'dev-show':
      centreOn(app, Number(b.dataset.x), Number(b.dataset.y), 0.6);
      break;
    case 'send-train': {
      const to = document.getElementById('train-to');
      const loads = {};
      for (const res of ['fuel', 'materiel', 'ammo']) {
        const v = Number(inputValue(`train-${res}`));
        if (v > 0) loads[res] = v;
      }
      if (to && to.value) orderTrain(app, id, to.value, loads);
      break;
    }
    case 'set-min': {
      const site = app.world.sites.get(id);
      if (site) orderMinStock(app, site, b.dataset.resource, inputValue(`min-stock-${b.dataset.resource}`));
      break;
    }
    case 'admiralty': {
      const convoy = app.world.convoys.find((c) => c.id === id);
      if (convoy) orderAdmiraltyRoute(app, convoy);
      break;
    }
    case 'centre': {
      if (kind === 'uplot') {
        const plot = app.world.uboatPlots.find((p) => p.id === id);
        if (plot) centreOn(app, plot.x, plot.y, 0.6);
      } else if (kind === 'raid') {
        const contact = app.world.contacts.get(id);
        const plots = contact ? contact.plots.filter((p) => p.visibleAt <= app.world.t) : [];
        const last = plots[plots.length - 1];
        if (last) centreOn(app, last.x, last.y, 1.5);
      } else if (unit) {
        centreOn(app, unit.x, unit.y, kind === 'convoy' ? 0 : 1.5);
      }
      break;
    }
    default:
      return;
  }
  app.dirtyPanels = true;
}

/** The map centred on what is selected (the ⌖ button of the unit panel). */
function centreSelection(app) {
  const sel = app.selection;
  if (!sel) return;
  const w = app.world;
  if (sel.kind === 'raid') {
    const contact = w.contacts.get(sel.id);
    const est = contact ? contactEstimate(w, contact) : null;
    if (est) centreOn(app, est.x, est.y, 1.5);
    return;
  }
  const u = selectedUnit(app) || findUnit(app, sel.kind, sel.id);
  if (!u || !Number.isFinite(u.x)) return;
  centreOn(app, u.x, u.y, u.kind === 'convoy' || u.kind === 'escort' || sel.kind === 'uplot' ? 0.6 : 1.5);
}

function onPanelChange(app, e) {
  const target = e.target.closest('[data-change]');
  if (!target) return;
  if (target.dataset.change === 'end-action') {
    const sq = app.world.squadrons.find((s) => s.id === target.dataset.id);
    if (sq) orderEndAction(app, sq, target.value);
  } else if (target.dataset.change === 'convoy-speed') {
    const c = app.world.convoys.find((x) => x.id === target.dataset.id);
    if (c) orderConvoySpeed(app, c, Number(target.value));
  }
  app.dirtyPanels = true;
}

function onPanelKeydown(app, e) {
  if (e.key !== 'Enter') return;
  const unit = selectedUnit(app);
  if (!unit) return;
  if (e.target.id === 'vector-input' && unit.kind === 'squadron' && e.target.value !== '') {
    orderVector(app, unit, Number(e.target.value));
  } else if (['leg-heading', 'leg-end', 'leg-speed', 'leg-alt'].includes(e.target.id)) {
    e.preventDefault();
    if (addTypedLeg(app, unit, inputValue('leg-heading'), inputValue('leg-end'), inputValue('leg-speed'), inputValue('leg-alt'))) {
      clearLegInputs();
      document.getElementById('leg-heading')?.focus();
    }
  }
}

function resize(app) {
  const cam = app.camera;
  const rect = app.el.table.getBoundingClientRect();
  const first = cam.width === 800 && cam.height === 600 && !app.sized;
  app.dpr = Math.min(window.devicePixelRatio || 1, 2);
  cam.width = Math.max(100, rect.width);
  cam.height = Math.max(100, rect.height);
  app.canvas.width = Math.round(cam.width * app.dpr);
  app.canvas.height = Math.round(cam.height * app.dpr);
  if (first) {
    app.sized = true;
    setFrame(cam, viewFrame(cam, VIEWS.atlantic));
    cam.minScale = viewFrame(cam, { lon: [-80, 32], lat: [24, 76] }, 0).scale;
  }
}

async function start() {
  const el = collectElements();
  const data = await loadData();
  setDictionary(data.fr);
  translatePage(document);
  document.title = `${t('app.title')} · ${t('app.subtitle')}`;

  const settings = loadSettings(data.presets);
  const terrain = createTerrain(data.atlantic, data.channel);
  const campaign = loadCampaign();
  data.scenario = scenarioById(data, settings.scenario);
  const newWorld = (scenario) => createWorld({
    scenario, rules: data.rules, settings, terrain, carry: carryFor(campaign, scenario.id, settings.carry),
  });
  const world = newWorld(data.scenario);

  const app = {
    el,
    data,
    settings,
    campaign,
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
  };
  app.unlockAudio = () => unlockAudio(app);
  /** Selects a formation and brings its leader into view (from the formations page). */
  app.selectFormation = (id) => {
    const f = formationById(app.world, id);
    if (!f) return;
    select(app, 'formation', id);
    const leader = leaderOf(app.world, f);
    if (leader) centreOn(app, leader.x, leader.y, f.kind === 'air' ? 1.5 : 0.6);
  };
  app.addMobileRadar = addMobileRadar;
  app.setTool = (tool) => {
    app.tool = tool;
    if (!tool) app.ruler = null;
    app.canvas.style.cursor = tool === 'ruler' ? 'crosshair' : 'grab';
    app.dirtyHud = true;
  };
  app.toggleRadarCover = () => {
    settings.radarCover = !settings.radarCover;
    saveSettings(settings);
    app.dirtyHud = true;
  };

  /** Keeps the game (and its journal) in the browser. */
  app.save = () => {
    if (app.world.ended) return false;
    app.lastSaveT = app.world.t;
    app.lastSaveReal = performance.now();
    const ok = saveToBrowser(app.world);
    try {
      localStorage.setItem('jeu-1940.journal.v1', JSON.stringify(app.logEntries || []));
    } catch {
      // ignore
    }
    return ok;
  };

  /** A saved game (from the browser or a file) replaces the current one. */
  app.resume = (saved) => {
    const sc = scenarioById(data, saved.snap.scenario);
    if (!sc || sc.id !== saved.snap.scenario) throw new Error('save: unknown scenario');
    data.scenario = sc;
    settings.scenario = sc.id;
    saveSettings(settings);
    stopTutorial(app);
    const w = createWorld({ scenario: sc, rules: data.rules, settings, terrain });
    drainEvents(w);
    restore(w, saved.snap, (world, def) => app.addMobileRadar && app.addMobileRadar(world, def));
    app.world = w;
    Object.assign(app, { selection: null, drawing: null, ruler: null, flash: null, fx: [], paused: false, pausedByPage: false, speed: 60, accumulator: 0 });
    clearLog(app);
    for (const entry of saved.journal || []) addLogEntry(app, entry.text, entry.level, entry.t, { report: entry.report, replay: true });
    app.logEntries = [...(saved.journal || [])];
    addLogEntry(app, t('log.gameResumed'), 'info', w.t);
    resetAlerts(app);
    app.lastNavalAttack = null;
    app.lastSaveT = w.t;
    app.dirtyPanels = true;
    app.dirtyHud = true;
  };

  /**
   * The game as a .json file. Published on claude.ai, the page asks the viewer through the
   * downloads capability; elsewhere (the file on disk, a web server) a plain download.
   */
  app.exportGame = async () => {
    const text = exportText(app.world);
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
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return 'saved';
  };

  app.importGame = (text) => {
    const parsed = parseExport(text);
    app.resume({ snap: parsed.snap, journal: [] });
    app.save();
  };

  // Developer mode: the real enemy positions on the map, and an "Enemies" tab.
  app.toggleDev = () => {
    app.dev = !app.dev;
    saveDev(app.dev);
    if (!app.dev && app.toteTab === 'enemies') app.toteTab = 'units';
    addLogEntry(app, t(app.dev ? 'dev.on' : 'dev.off'), 'info', app.world.t);
    app.dirtyPanels = true;
    app.dirtyHud = true;
  };

  app.restart = (scenarioId = null, { tutorial = false } = {}) => {
    if (scenarioId) {
      data.scenario = scenarioById(data, scenarioId);
      settings.scenario = data.scenario.id;
      saveSettings(settings);
    }
    stopTutorial(app);
    resetAlerts(app);
    app.lastNavalAttack = null;
    app.world = newWorld(data.scenario);
    // A page closed after this must not set the new game going.
    Object.assign(app, { selection: null, drawing: null, ruler: null, flash: null, fx: [], paused: false, pausedByPage: false, speed: 60, accumulator: 0, unlocked: null });
    clearLog(app);
    setFrame(app.camera, viewFrame(app.camera, VIEWS.atlantic));
    handleEvents(app, drainEvents(app.world));
    if (tutorial) startTutorial(app);
    app.dirtyPanels = true;
    app.dirtyHud = true;
  };

  resize(app);
  new ResizeObserver(() => resize(app)).observe(el.table);

  initHud(app);
  initAlert(app);
  attachInput(app);
  attachTutorial(app);
  // The side panel and the unit panel beside it answer the same buttons.
  for (const box of [el.panel, el.unitPanel]) {
    box.addEventListener('click', (e) => onPanelClick(app, e));
    box.addEventListener('change', (e) => onPanelChange(app, e));
    box.addEventListener('keydown', (e) => onPanelKeydown(app, e));
  }
  el.btnSettings.addEventListener('click', () => openSettings(app));
  el.btnScenario.addEventListener('click', () => openScenarios(app));
  el.btnReports.addEventListener('click', () => openReports(app));
  el.btnCards.addEventListener('click', () => openCards(app));
  el.btnFormations.addEventListener('click', () => openFormations(app));
  el.btnHelp.addEventListener('click', () => openHelp(app));

  handleEvents(app, drainEvents(app.world));
  // A game left in the browser goes on where it was.
  const saved = loadFromBrowser();
  if (saved && !saved.snap.ended && SCENARIOS.includes(saved.snap.scenario)) {
    try {
      let journal = [];
      try {
        journal = JSON.parse(localStorage.getItem('jeu-1940.journal.v1') || '[]');
      } catch {
        journal = [];
      }
      app.resume({ snap: saved.snap, journal });
    } catch (err) {
      console.warn('saved game not restored', err);
      clearBrowserSave();
    }
  }
  app.lastSaveT = app.world.t;
  app.lastSaveReal = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.save();
  });
  window.addEventListener('pagehide', () => app.save());
  el.loading.hidden = true;
  const smallScreen = window.innerWidth < 900 || (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches);
  if (smallScreen) openDesktopNotice(app);
  else if (!helpSeen()) openHelp(app);

  // Exposed for automated tests and debugging from the browser console.
  window.__game = app;

  let last = performance.now();
  let lastPanels = 0;
  function frame(now) {
    const dtReal = Math.min(0.25, (now - last) / 1000);
    last = now;
    updateCamera(app.camera, dtReal);
    clampCentre(app.camera, app.mapRenderer.coarse.box);

    const world = app.world;
    if (!app.paused && !world.ended) {
      app.accumulator += dtReal * app.speed;
      const wanted = Math.min(Math.floor(app.accumulator), MAX_STEPS_PER_FRAME);
      let done = 0;
      let interrupted = false;
      while (done < wanted) {
        const before = world.events.length;
        step(world, 1);
        done++;
        for (let i = before; i < world.events.length; i++) {
          if (INTERRUPTING.has(world.events[i].type)) interrupted = true;
        }
        if (interrupted) break;
      }
      app.accumulator -= done;
      if (interrupted || app.accumulator > 1) app.accumulator = Math.min(app.accumulator, 0.999);
    }

    handleEvents(app, drainEvents(world));
    updateAlerts(app);
    updateTutorial(app);
    if (!world.ended && world.t - (app.lastSaveT ?? 0) >= 900 && now - (app.lastSaveReal ?? 0) > 4000) app.save();
    drawScene(app.ctx, app, app.paused ? 1 : Math.max(0, Math.min(1, app.accumulator)));
    updateHud(app, world.startMs + world.t * 1000);
    if (app.dirtyPanels || now - lastPanels > 250) {
      renderPanels(app);
      lastPanels = now;
      app.dirtyPanels = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
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
