// Entry point: loads the data, builds the world and runs the game loop.

import { loadJSON } from './core/data.js';
import { setDictionary, t, translatePage } from './core/i18n.js';
import { createTerrain } from './sim/terrain.js';
import { warmPortField } from './sim/searoute.js';
import { createWorld, step } from './sim/world.js';
import { drainEvents } from './sim/events.js';
import { createCamera, clampCentre, setFrame, toScreen, updateCamera, viewFrame, VIEWS } from './render/camera.js';
import { createMapRenderer } from './render/map.js';
import { drawScene } from './render/scene.js';
import { loadSettings, saveSettings } from './save/settings.js';
import { openRoster, renderRosterPage } from './ui/rosterPage.js';
import {
  activePoint, addRulerLeg, addTypedLeg, cancelConfirm, cancelEditLeg, centreOn, changeAltitude,
  changePointAltitude, clearPointAltitude, deletePoint, findUnit, goView, orderAdmiraltyRoute,
  orderAlertChecked, orderBoost, orderBreakOff, orderCancelSchedule, orderClearPlan, orderConvoySpeed,
  orderCover, orderDissolve, orderEndAction, orderEscortBehaviour, orderEscortHome, orderExitChannel,
  orderFormationAlert, orderHome, orderHuntHours, orderHuntPlot, orderHuntStop, orderIntercept, orderJoin,
  orderLaunchWaiting, orderLeave, orderLeaveFormationOf, orderMerge, orderMinStock, orderNewFormation,
  orderOffer, orderOrbit, orderPurchase, orderRally, orderRemoveLeg, orderRoe, orderRosterAdd,
  orderRosterCopy, orderRosterOverride, orderRosterRemove, orderRosterResume, orderSail, orderScheduleJoin,
  orderScheduleSail, orderScheduleTakeoff, orderScheduleWing, orderShipEnd, orderSpeedPct, orderTrain,
  orderVector, orderZigzag, revealSelection, scrambleSquadron, select, selectedUnit, startEditLeg, toggleBuster
} from './ui/actions.js';
import { formationById, leaderOf } from './sim/formations.js';
import { contactEstimate } from './sim/query.js';
import { openFormations } from './ui/formationsPage.js';
import { carryFor, loadCampaign, recordResult } from './ui/campaign.js';
import { attachTutorial, startTutorial, stopTutorial, tutorialEvent, updateTutorial } from './ui/tutorial.js';
import { fighterEstablishmentShare } from './sim/objectives.js';
import { alertForEvent, initAlert, resetAlerts, updateAlerts } from './ui/alerts.js';
import { initQuestions, questionAsked, renderQuestion } from './ui/questions.js';
import { ALERT_TYPES } from './ui/alertRules.js';
import { loadDev, saveDev } from './ui/dev.js';
import {
  openDesktopNotice, openEnd, openHelp, openMainMenu, openSettings, openSuccess,
} from './ui/dialogs.js';
import { playBombs, playGuns, playRadio, unlockAudio } from './ui/sound.js';
import { addEffectsForEvent } from './render/fx.js';
import { eventMessage } from './ui/format.js';
import { initHud, updateHud } from './ui/hud.js';
import { attachInput } from './ui/input.js';
import { addLogEntry, clearLog, renderPanels } from './ui/panels.js';
import { openCards, openReports } from './ui/pages.js';
import { clearBrowserSave, exportText, loadFromBrowser, parseExport, restore, saveToBrowser } from './save/game.js';
import { reportCrash } from './ui/crash.js';
import { createPlayClock, newGameId, tickPlayClock } from './ui/summary.js';
import { addMobileRadar } from './sim/mru.js';
import { openEvent } from './ui/dialogs.js';
import { setSpeed } from './sim/orders.js';
import { portChoices } from './sim/naval.js';

const MAX_STEPS_PER_FRAME = 6000;
// Events handled at once, without the rest of the frame's steps: every alert, and a few more.
const INTERRUPTING = new Set([
  ...ALERT_TYPES, 'scenarioEnd', 'allObjectivesDone', 'convoyArrived', 'pilotAboard', 'uboatSighted', 'scenarioEvent', 'mruReady', 'question',
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
    unitBar: $('unit-bar'),
    unitBody: $('unit-body'),
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
    question: $('question'),
    questionTitle: $('question-title'),
    questionText: $('question-text'),
    questionLeft: $('question-left'),
    questionMore: $('question-more'),
    questionYes: $('question-yes'),
    questionNo: $('question-no'),
    questionShow: $('question-show'),
    questionYesNo: $('question-yesno'),
    questionOptions: $('question-options'),
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
    dlgRoster: $('dlg-roster'),
    dlgMenu: $('dlg-menu'),
    btnRoster: $('btn-roster'),
    dlgEvent: $('dlg-event'),
    dlgCrash: $('dlg-crash'),
  };
}

async function loadData() {
  const [fr, rules, presets, dev, helpImages, atlantic, channel, labels, ...scenarios] = await Promise.all([
    loadJSON('data/i18n/fr.json'),
    loadJSON('data/rules.json'),
    loadJSON('data/presets.json'),
    loadJSON('data/dev.json'),
    loadJSON('data/help/images.json').catch(() => ({})),
    loadJSON('data/maps/atlantic.json'),
    loadJSON('data/maps/channel.json'),
    loadJSON('data/maps/labels.json'),
    ...SCENARIOS.map((id) => loadJSON(`data/scenarios/${id}.json`)),
  ]);
  return { fr, rules, presets, dev, helpImages, atlantic, channel, labels, scenarios };
}

function scenarioById(data, id) {
  return data.scenarios.find((s) => s.id === id) || data.scenarios[0];
}

function handleEvents(app, events) {
  for (const e of events) {
    tutorialEvent(app, e);
    const msg = eventMessage(app.world, e);
    let report = (e.type === 'raidReport' || e.type === 'combatReport') && app.world.reports.has(e.raidId) ? e.raidId : null;
    // A depth-charge attack: its journal lines open its report.
    if ((e.type === 'escortEngaged' || e.type === 'depthChargePass') && e.report) report = e.report;
    if (msg) addLogEntry(app, msg.text, msg.level, e.t, { report });
    addEffectsForEvent(app, e);
    if (RADIO.has(e.type) || (e.type === 'raidSighted' && e.kind === 'squadron')) playRadio(app);
    else if (e.type === 'combatRound') playGuns(app);
    else if (e.type === 'siteHit' || e.type === 'shipsSunk') playBombs(app);
    // Every event that needs the player raises an alert and slows the game (alertRules.js).
    const alert = alertForEvent(app, e);
    if (e.type === 'uboatAttack' || e.type === 'convoyBombed' || e.type === 'escortEngaged') app.lastNavalAttack = e.t;
    if (e.type === 'raidDetected') {
      if (alert && app.settings.autoZoom && app.camera.scale < 0.6) goView(app, 'england');
    } else if (e.type === 'question') {
      questionAsked(app);
    } else if (e.type === 'scenarioEvent' && e.important) {
      setTimeout(() => openEvent(app, e), 200);
    } else if (e.type === 'allObjectivesDone') {
      if (!app.world.ended) setTimeout(() => openSuccess(app), 400);
    } else if (e.type === 'scenarioEnd') {
      app.paused = true;
      app.dirtyHud = true;
      clearBrowserSave();
      app.unlocked = recordResult(app.campaign, app.world, fighterEstablishmentShare(app.world));
      openEnd(app);
    }
  }
  if (events.length) app.panelsStale = true;
}

/** Dragging the edge of the unit sheet makes it wider (or higher at the bottom); remembered. */
function attachSheetGrip(app) {
  const grip = app.el.unitPanel.querySelector('[data-grip="sheet"]');
  if (!grip) return;
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const rect = app.el.unitPanel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = app.settings;
    const pos = s.sheetPos || 'right';
    const table = app.el.table.getBoundingClientRect();
    if (pos === 'bottom') s.sheetH = Math.max(180, Math.min(table.height * 0.8, drag.h - (e.clientY - drag.y)));
    else s.sheetW = Math.max(320, Math.min(Math.min(720, table.width * 0.7), drag.w + (pos === 'left' ? 1 : -1) * (e.clientX - drag.x)));
    app.applySheet();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    saveSettings(app.settings);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function inputValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : '';
}

/** The first time the player schedules anything, a reminder: anticipate the alert state. */
function firstSchedule(app) {
  if (!app.scheduleHintSeen) app.scheduleHintShown = true;
}

function inputChecked(id) {
  const input = document.getElementById(id);
  return Boolean(input && input.checked);
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
      revealSelection(app);
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
    case 'boost':
      if (unit) orderBoost(app, unit);
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
      if (unit) orderEscortHome(app, unit, b.dataset.port || inputValue(`home-port-${id}`));
      app.portPick = null;
      break;
    case 'port-pick':
      // The sea routes to every port are worked out now, once, not on every refresh.
      if (unit) app.portPick = { id: unit.id, t: app.world.t, list: portChoices(app.world, unit) };
      app.dirtyPanels = true;
      break;
    case 'port-pick-close':
      app.portPick = null;
      app.dirtyPanels = true;
      break;
    case 'hunt-stop':
      if (unit) orderHuntStop(app, unit);
      break;
    case 'hunt-plot':
      if (unit) orderHuntPlot(app, unit, b.dataset.plot);
      break;
    case 'cover':
      if (sq) orderCover(app, sq, b.dataset.convoy);
      break;
    case 'break-off':
      if (sq) orderBreakOff(app, sq, b.dataset.raid);
      break;
    case 'open-roster':
      openRoster(app, { squadronId: id || null, fieldId: b.dataset.field || null });
      break;
    case 'roster-resume':
      if (unit) orderRosterResume(app, unit);
      break;
    case 'roster-copy':
      if (sq) orderRosterCopy(app, sq, inputValue(`rp-copy-${id}`));
      break;
    case 'intercept':
      if (sq) orderIntercept(app, sq, b.dataset.raid);
      break;
    case 'alert':
      if (unit) orderAlertChecked(app, unit, b.dataset.alert);
      break;
    case 'confirm-rest':
      if (unit) orderAlertChecked(app, unit, 'rest');
      break;
    case 'confirm-cancel':
      cancelConfirm(app);
      break;
    case 'roe':
      if (unit) orderRoe(app, unit, b.dataset.roe);
      break;
    case 'roster-add':
      firstSchedule(app);
      if (unit) {
        // An hour of the day in the daily plan, hours after H0 in the plan for the coming hours.
        const field = document.getElementById(`roster-offset-${id}`) || document.getElementById(`roster-time-${id}`);
        if (field && orderRosterAdd(app, unit, inputValue(`roster-alert-${id}`), field.value)) field.value = ''; // ready for the next change
      }
      break;
    case 'roster-remove':
      if (unit) orderRosterRemove(app, unit, b.dataset.entry);
      break;
    case 'schedule-takeoff':
      firstSchedule(app);
      if (unit) orderScheduleTakeoff(app, unit, inputValue(`sched-time-${id}`), inputChecked(`sched-daily-${id}`));
      break;
    case 'schedule-wing':
      firstSchedule(app);
      if (unit) orderScheduleWing(app, unit, inputValue(`sched-time-${id}`), inputChecked(`sched-daily-${id}`));
      break;
    case 'schedule-join':
      firstSchedule(app);
      if (unit && unit.kind === 'squadron') orderScheduleJoin(app, unit, inputValue(`join-formation-${id}`), inputValue(`join-time-${id}`));
      else if (unit) orderScheduleJoin(app, unit, inputValue(`group-formation-${id}`), inputValue(`group-time-${id}`), Number(inputValue(`group-day-${id}`) || 0));
      break;
    case 'schedule-sail':
      firstSchedule(app);
      if (unit) orderScheduleSail(app, unit, Number(inputValue(`sail-day-${id}`) || 0), inputValue(`sail-time-${id}`));
      break;
    case 'schedule-cancel':
      if (unit) orderCancelSchedule(app, unit);
      break;
    case 'hint-seen':
      app.scheduleHintSeen = true;
      app.scheduleHintShown = false;
      try {
        localStorage.setItem('jeu-1940.scheduleHint.v1', '1');
      } catch {
        // ignore
      }
      break;
    case 'rally-where':
      if (unit) orderRally(app, unit, { kind: 'where', where: b.dataset.where });
      break;
    case 'rally-place':
      if (unit) orderRally(app, unit, { kind: 'place' });
      break;
    case 'rally-alt-up':
    case 'rally-alt-down':
      if (unit) orderRally(app, unit, { kind: 'alt', deltaFt: action === 'rally-alt-up' ? 1000 : -1000 });
      break;
    case 'rally-asap':
      if (unit) orderRally(app, unit, { kind: 'time', text: 'asap' });
      break;
    case 'rally-time': {
      const day = inputValue(`rally-day-${id}`);
      if (unit) orderRally(app, unit, { kind: 'time', text: inputValue(`rally-time-${id}`), dayOffset: day === '' ? null : Number(day) });
      break;
    }
    case 'rally-missing':
      if (unit) orderRally(app, unit, { kind: 'missing', missing: b.dataset.missing, waitMin: Number(inputValue(`rally-wait-${id}`)) || null });
      break;
    case 'rally-arm':
      firstSchedule(app);
    // falls through
    case 'rally-compute':
    case 'rally-cancel':
    case 'rally-route-clear':
      if (unit) orderRally(app, unit, { kind: { 'rally-compute': 'compute', 'rally-arm': 'arm', 'rally-cancel': 'cancel', 'rally-route-clear': 'routeClear' }[action] });
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
  } else if (target.dataset.change === 'rally-dep') {
    const f = formationById(app.world, target.dataset.id);
    const day = inputValue(`rally-dep-day-${target.dataset.unit}`);
    if (f) orderRally(app, f, { kind: 'departure', unitId: target.dataset.unit, text: target.value, dayOffset: day === '' ? null : Number(day) });
  } else if (target.dataset.change === 'hunt-hours') {
    const e = app.world.escorts.find((x) => x.id === target.dataset.id);
    if (e) orderHuntHours(app, e, target.value);
  } else if (target.dataset.change === 'ship-end') {
    const e = app.world.escorts.find((x) => x.id === target.dataset.id);
    if (e) orderShipEnd(app, e, target.value);
  } else if (target.dataset.change === 'speed-pct') {
    const u = findUnit(app, target.dataset.kind, target.dataset.id);
    if (u) orderSpeedPct(app, u, Number(target.value));
  } else if (target.dataset.change === 'exit-channel') {
    const e = app.world.escorts.find((x) => x.id === target.dataset.id);
    if (e) orderExitChannel(app, e, target.value);
  } else if (target.dataset.change === 'roster-override') {
    const sq = app.world.squadrons.find((s) => s.id === target.dataset.id);
    if (sq) orderRosterOverride(app, sq, target.checked);
  } else if (target.dataset.change === 'rally-wait') {
    const f = formationById(app.world, target.dataset.id);
    if (f && f.rally) orderRally(app, f, { kind: 'missing', missing: f.rally.missing, waitMin: Number(target.value) });
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
  // On a big screen the map can be drawn at one pixel per point (Réglages, Carte): faster.
  app.dpr = app.settings && app.settings.lowRes ? 1 : Math.min(window.devicePixelRatio || 1, 2);
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
    playClock: createPlayClock(), // real time spent on this game (summary.js)
    gameId: newGameId(), // tells this game from another one of the same scenario (its saves)
  };
  app.unlockAudio = () => unlockAudio(app);
  // The ports' distance fields (a tenth of a second each), worked out in quiet moments rather
  // than on the first look at « Rentrer au port ».
  setInterval(() => {
    if (!document.hidden) warmPortField(app.world);
  }, 700);
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
    app.canvas.style.cursor = tool === 'ruler' || tool === 'rally' ? 'crosshair' : 'grab';
    app.dirtyHud = true;
    app.dirtyPanels = true;
  };
  try {
    app.scheduleHintSeen = localStorage.getItem('jeu-1940.scheduleHint.v1') === '1';
  } catch {
    app.scheduleHintSeen = false;
  }
  app.toggleRadarCover = () => {
    settings.radarCover = !settings.radarCover;
    saveSettings(settings);
    app.dirtyHud = true;
  };

  /** Keeps the game (and its journal) in the browser. */
  app.save = () => {
    // After an error the last good save is kept as it is.
    if (app.world.ended || app.crash) return false;
    app.lastSaveT = app.world.t;
    app.lastSaveReal = performance.now();
    const ok = saveToBrowser(app.world, { playClock: app.playClock, gameId: app.gameId });
    try {
      localStorage.setItem('jeu-1940.journal.v1', JSON.stringify(app.logEntries || []));
    } catch {
      // ignore
    }
    return ok;
  };

  /** A saved game (from the browser or a file) replaces the current one. */
  app.resume = (saved) => {
    if (el.dlgMenu.open) el.dlgMenu.close();
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
    app.crash = null;
    app.resumed = true;
    app.playClock = createPlayClock(saved.meta && saved.meta.playClock);
    app.gameId = (saved.meta && saved.meta.gameId) || newGameId();
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
  app.exportGame = async (extra = null) => {
    const text = exportText(app.world, { meta: { playClock: app.playClock, gameId: app.gameId }, ...(extra || {}) });
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
    app.resume({ snap: parsed.snap, journal: [], meta: parsed.meta || null });
    app.save();
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

  app.restart = (scenarioId = null, { tutorial = false } = {}) => {
    if (el.dlgMenu.open) el.dlgMenu.close();
    if (scenarioId) {
      data.scenario = scenarioById(data, scenarioId);
      settings.scenario = data.scenario.id;
      saveSettings(settings);
    }
    stopTutorial(app);
    resetAlerts(app);
    app.lastNavalAttack = null;
    app.crash = null;
    app.playClock = createPlayClock();
    app.gameId = newGameId();
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
  initQuestions(app);
  attachInput(app);
  attachTutorial(app);
  // The side panel and the unit panel beside it answer the same buttons.
  for (const box of [el.panel, el.unitPanel, el.dlgRoster]) {
    box.addEventListener('click', (e) => onPanelClick(app, e));
    box.addEventListener('change', (e) => onPanelChange(app, e));
    box.addEventListener('keydown', (e) => onPanelKeydown(app, e));
  }
  // The sections of the Commandes tab stay open or folded as the player leaves them.
  el.unitPanel.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.dataset || !d.dataset.sec) return;
    settings.sections = { ...(settings.sections || {}), [d.dataset.sec]: d.open };
    saveSettings(settings);
  }, true);
  attachSheetGrip(app);
  el.btnSettings.addEventListener('click', () => openSettings(app));
  el.btnScenario.addEventListener('click', () => openMainMenu(app));
  el.btnReports.addEventListener('click', () => openReports(app));
  el.btnCards.addEventListener('click', () => openCards(app));
  el.btnFormations.addEventListener('click', () => openFormations(app));
  el.btnRoster.addEventListener('click', () => openRoster(app));
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
      app.resume({ snap: saved.snap, journal, meta: saved.meta || null });
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
  else openMainMenu(app);

  // Exposed for automated tests and debugging from the browser console.
  app.resize = () => resize(app);
  /** Where the unit sheet stands (right, left or bottom of the map) and how wide or high. */
  app.applySheet = () => {
    const pos = ['left', 'bottom'].includes(settings.sheetPos) ? settings.sheetPos : 'right';
    el.table.classList.toggle('sheet-left', pos === 'left');
    el.table.classList.toggle('sheet-bottom', pos === 'bottom');
    el.table.style.setProperty('--sheet-w', `${Math.round(settings.sheetW || 400)}px`);
    el.table.style.setProperty('--sheet-h', `${Math.round(settings.sheetH || 300)}px`);
  };
  app.applySheet();
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

  let last = performance.now();
  let lastPanels = 0;
  let displayFailures = 0;

  /** The steps of simulation this frame owes, at the chosen speed. */
  function advance(dtReal) {
    const world = app.world;
    if (app.paused || world.ended || app.crash) return;
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

  /** What the player sees and hears of it. */
  function display(now) {
    const world = app.world;
    handleEvents(app, drainEvents(world));
    updateAlerts(app);
    renderQuestion(app);
    updateTutorial(app);
    if (!world.ended && world.t - (app.lastSaveT ?? 0) >= 900 && now - (app.lastSaveReal ?? 0) > 4000) app.save();
    drawScene(app.ctx, app, app.paused ? 1 : Math.max(0, Math.min(1, app.accumulator)));
    updateHud(app, world.startMs + world.t * 1000);
    // The sheets follow an order at once; the game's own news, at most a few times a second.
    if (app.dirtyPanels || (app.panelsStale && now - lastPanels > 150) || now - lastPanels > 250) {
      renderPanels(app);
      if (el.dlgRoster.open) renderRosterPage(app);
      lastPanels = now;
      app.dirtyPanels = false;
      app.panelsStale = false;
    }
  }

  // The loop never dies: an error pauses the game and says so (crash.js). A display that
  // fails three frames running is left alone, with the dialog open.
  function frame(now) {
    requestAnimationFrame(frame);
    const elapsedMs = now - last;
    const dtReal = Math.min(0.25, elapsedMs / 1000);
    last = now;
    if (app.crash && app.crash.fatal) return;
    // The clock of the game: real time, pauses included, until the scenario ends.
    if (!app.world.ended) tickPlayClock(app.playClock, elapsedMs, app.paused);
    try {
      updateCamera(app.camera, dtReal);
      clampCentre(app.camera, app.mapRenderer.coarse.box);
      advance(dtReal);
    } catch (err) {
      reportCrash(app, err, 'simulation');
    }
    try {
      display(now);
      displayFailures = 0;
    } catch (err) {
      displayFailures++;
      reportCrash(app, err, 'display', displayFailures >= 3);
    }
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
