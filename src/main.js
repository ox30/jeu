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
  addRulerLeg, addTypedLeg, centreOn, changeAltitude, findUnit, goView, orderAdmiraltyRoute, orderClearPlan, orderCover,
  orderEscortHome, orderHome, orderJoin, orderLeave, orderMinStock, orderOrbit, orderRemoveLeg, orderSail, orderTrain,
  orderVector, scrambleSquadron, select, toggleBuster,
} from './ui/actions.js';
import { initAlert, showAlert } from './ui/alerts.js';
import { openDesktopNotice, openEnd, openHelp, openScenarios, openSettings, openSuccess } from './ui/dialogs.js';
import { playBombs, playGuns, playRadio, unlockAudio } from './ui/sound.js';
import { addEffectsForEvent } from './render/fx.js';
import { eventMessage } from './ui/format.js';
import { initHud, updateHud } from './ui/hud.js';
import { attachInput } from './ui/input.js';
import { addLogEntry, renderPanels } from './ui/panels.js';
import { setSpeed } from './sim/orders.js';

const MAX_STEPS_PER_FRAME = 6000;
const INTERRUPTING = new Set([
  'raidDetected', 'scenarioEnd', 'allObjectivesDone', 'convoyArrived', 'convoyStopped', 'siteOut', 'uboatAttack',
  'convoySighted', 'noFuel', 'pilotAboard',
]);
const RADIO = new Set(['tallyHo', 'missed', 'nothingSeen', 'bingo', 'outOfAmmo', 'divert', 'divertOut', 'legMissed', 'convoySighted']);
const SCENARIOS = ['kanalkampf', 'm0-july-1940'];

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
    sheetInfo: $('sheet-info'),
    sheetProfile: $('sheet-profile'),
    sheetPlan: $('sheet-plan'),
    sheetOrders: $('sheet-orders'),
    log: $('log'),
    alert: $('alert'),
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
    const msg = eventMessage(app.world, e);
    if (msg) addLogEntry(app, msg.text, msg.level, e.t);
    addEffectsForEvent(app, e);
    if (RADIO.has(e.type)) playRadio(app);
    else if (e.type === 'combatRound') playGuns(app);
    else if (e.type === 'siteHit' || e.type === 'shipsSunk') playBombs(app);
    if (e.type === 'raidDetected') {
      showAlert(app, e);
      if (app.settings.slowOnAlert && app.speed > 10) {
        app.speed = 10;
        app.dirtyHud = true;
      }
      if (app.settings.autoZoom && app.camera.scale < 0.6) goView(app, 'england');
    } else if (e.type === 'allObjectivesDone') {
      if (!app.world.ended) setTimeout(() => openSuccess(app), 400);
    } else if (e.type === 'scenarioEnd') {
      app.paused = true;
      app.dirtyHud = true;
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
  for (const id of ['leg-heading', 'leg-end', 'leg-speed']) {
    const input = document.getElementById(id);
    if (input) input.value = '';
  }
}

function onPanelClick(app, e) {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    app.toteTab = tab.dataset.tab;
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
      if (unit && addTypedLeg(app, unit, inputValue('leg-heading'), inputValue('leg-end'), inputValue('leg-speed'))) clearLegInputs();
      break;
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
    case 'send-train': {
      const to = document.getElementById('train-to');
      const res = document.getElementById('train-resource');
      if (to && res && to.value) orderTrain(app, id, to.value, res.value);
      break;
    }
    case 'set-min': {
      const site = app.world.sites.get(id);
      if (site) orderMinStock(app, site, b.dataset.resource, inputValue('min-stock'));
      break;
    }
    case 'admiralty': {
      const convoy = app.world.convoys.find((c) => c.id === id);
      if (convoy) orderAdmiraltyRoute(app, convoy);
      break;
    }
    case 'centre': {
      if (kind === 'raid') {
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
  data.scenario = scenarioById(data, settings.scenario);
  const world = createWorld({ scenario: data.scenario, rules: data.rules, settings, terrain });

  const app = {
    el,
    data,
    settings,
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

  app.restart = (scenarioId = null) => {
    if (scenarioId) {
      data.scenario = scenarioById(data, scenarioId);
      settings.scenario = data.scenario.id;
      saveSettings(settings);
    }
    app.world = createWorld({ scenario: data.scenario, rules: data.rules, settings, terrain });
    Object.assign(app, { selection: null, drawing: null, ruler: null, flash: null, fx: [], paused: false, speed: 60, accumulator: 0 });
    el.log.innerHTML = '';
    app.logDay = null;
    app.logDaySep = null;
    el.alert.hidden = true;
    setFrame(app.camera, viewFrame(app.camera, VIEWS.atlantic));
    handleEvents(app, drainEvents(app.world));
    app.dirtyPanels = true;
    app.dirtyHud = true;
  };

  resize(app);
  new ResizeObserver(() => resize(app)).observe(el.table);

  initHud(app);
  initAlert(app);
  attachInput(app);
  el.panel.addEventListener('click', (e) => onPanelClick(app, e));
  el.panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const sel = app.selection;
    const unit = sel && (sel.kind === 'squadron' || sel.kind === 'convoy') ? findUnit(app, sel.kind, sel.id) : null;
    if (!unit) return;
    if (e.target.id === 'vector-input' && unit.kind === 'squadron' && e.target.value !== '') {
      orderVector(app, unit, Number(e.target.value));
    } else if (['leg-heading', 'leg-end', 'leg-speed'].includes(e.target.id)) {
      e.preventDefault();
      if (addTypedLeg(app, unit, inputValue('leg-heading'), inputValue('leg-end'), inputValue('leg-speed'))) {
        clearLegInputs();
        document.getElementById('leg-heading')?.focus();
      }
    }
  });
  el.btnSettings.addEventListener('click', () => openSettings(app));
  el.btnScenario.addEventListener('click', () => openScenarios(app));
  el.btnHelp.addEventListener('click', () => openHelp(app));

  handleEvents(app, drainEvents(app.world));
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
