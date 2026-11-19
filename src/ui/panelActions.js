// What the buttons and fields of the panels do: the side panel, the unit sheet and the roster
// page all answer through the same tables — one entry a `data-action` (a click), one a
// `data-change` (a field changed). Each entry takes the app and what the control names:
// { b: the control, id, kind, sq: the squadron of that id, unit: the unit of that kind and id }.

import {
  activePoint, addRulerLeg, addTypedLeg, cancelConfirm, cancelEditLeg, centreOn, changeAltitude,
  changePointAltitude, clearPointAltitude, deletePoint, findUnit, orderAdmiraltyRoute,
  orderAlertChecked, orderAskPosition, orderBoost, orderBreakOff, orderCancelSchedule, orderClearPlan, orderCommsCancel, orderCommsCarry,
  orderCover, orderDissolve, orderEndAction, orderEscortBehaviour, orderEscortHome, orderEscortPattern, orderExitChannel,
  orderHome, orderHuntPlot, orderHuntStop, orderIntercept, orderJoin,
  orderLaunchWaiting, orderLeave, orderLeaveFormationOf, orderMerge, orderMinStock, orderNewFormation,
  orderOffer, orderOrbit, orderRally, orderRemoveLeg, orderRoe, orderRosterAdd,
  orderRosterCopy, orderRosterOverride, orderRosterRemove, orderRosterResume, orderSail, orderScheduleJoin,
  orderScheduleSail, orderScheduleTakeoff, orderScheduleWing, orderShipEnd, orderSpeedPct, orderTrain,
  orderVector, orderZigzag, revealSelection, scrambleSquadron, select, selectedUnit, startEditLeg,
} from './actions.js';
import { formationById } from '../sim/formations.js';
import { contactEstimate } from '../sim/query.js';
import { openFormations } from './formationsPage.js';
import { openRoster } from './rosterPage.js';
import { openCards, openReports } from './pages.js';
import { onWatchClick } from './watchPanel.js';
import { toggleSheetHelp } from './sheetHelp.js';
import { handsOff, nudgeCoach, tutorialFlag } from './tutorial.js';

function inputValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : '';
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

/** The first time the player schedules anything, a reminder: anticipate the alert state. */
function firstSchedule(app) {
  if (!app.scheduleHintSeen) app.scheduleHintShown = true;
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

const rally = (kind, extra = () => ({})) => (app, c) => {
  if (c.unit) orderRally(app, c.unit, { kind, ...extra(c) });
};

/** One entry a `data-action`. */
export const PANEL_ACTIONS = {
  // ---- selection, pages, the map ----
  select: (app, { kind, id }) => {
    select(app, kind, id);
    revealSelection(app);
  },
  'close-unit': (app) => select(app, null, null),
  'centre-selection': (app) => centreSelection(app),
  'dev-show': (app, { b }) => centreOn(app, Number(b.dataset.x), Number(b.dataset.y), 0.6),
  cards: (app, { b }) => openCards(app, b.dataset.type),
  'mru-deploy': (app) => app.setTool(app.tool === 'mru' ? null : 'mru'),

  // ---- squadrons in the air ----
  scramble: (app, { sq }) => sq && scrambleSquadron(app, sq),
  'alt-up': (app, { sq }) => sq && changeAltitude(app, sq, 1000),
  'alt-down': (app, { sq }) => sq && changeAltitude(app, sq, -1000),
  boost: (app, { unit }) => unit && orderBoost(app, unit),
  vector: (app, { sq }) => {
    const value = Number(inputValue('vector-input'));
    if (sq && inputValue('vector-input') !== '' && value >= 0 && value <= 360) orderVector(app, sq, value);
  },
  orbit: (app, { sq }) => sq && orderOrbit(app, sq),
  home: (app, { sq }) => sq && orderHome(app, sq),
  cover: (app, { sq, b }) => sq && orderCover(app, sq, b.dataset.convoy),
  'break-off': (app, { sq, b }) => sq && orderBreakOff(app, sq, b.dataset.raid),
  intercept: (app, { sq, b }) => sq && orderIntercept(app, sq, b.dataset.raid),
  roe: (app, { unit, b }) => unit && orderRoe(app, unit, b.dataset.roe),

  // ---- routes and legs ----
  'add-leg': (app, { unit }) => {
    if (unit && addTypedLeg(app, unit, inputValue('leg-heading'), inputValue('leg-end'), inputValue('leg-speed'), inputValue('leg-alt'))) clearLegInputs();
  },
  'edit-leg': (app, { unit, b }) => unit && startEditLeg(app, unit, Number(b.dataset.index)),
  'cancel-edit-leg': (app) => cancelEditLeg(app),
  'point-alt-up': (app) => {
    const ap = activePoint(app);
    if (ap) changePointAltitude(app, ap.u, ap.index, 1000);
  },
  'point-alt-down': (app) => {
    const ap = activePoint(app);
    if (ap) changePointAltitude(app, ap.u, ap.index, -1000);
  },
  'point-alt-clear': (app) => {
    const ap = activePoint(app);
    if (ap) clearPointAltitude(app, ap.u, ap.index);
  },
  'point-delete': (app) => {
    const ap = activePoint(app);
    if (ap) deletePoint(app, ap.u, ap.index);
  },
  'add-ruler-leg': (app, { unit }) => unit && addRulerLeg(app, unit),
  'clear-plan': (app, { unit }) => unit && orderClearPlan(app, unit),
  'remove-leg': (app, { unit, b }) => unit && orderRemoveLeg(app, unit, Number(b.dataset.index)),

  // ---- ships ----
  sail: (app, { unit }) => unit && orderSail(app, unit),
  join: (app, { unit, b }) => unit && orderJoin(app, unit, b.dataset.convoy),
  leave: (app, { unit }) => unit && orderLeave(app, unit),
  'escort-home': (app, { unit, id, b }) => {
    if (unit) orderEscortHome(app, unit, b.dataset.port || inputValue(`home-port-${id}`));
  },
  'hunt-stop': (app, { unit }) => unit && orderHuntStop(app, unit),
  'hunt-plot': (app, { unit, b }) => unit && orderHuntPlot(app, unit, b.dataset.plot),
  zigzag: (app, { unit }) => unit && orderZigzag(app, unit),
  'escort-behaviour': (app, { unit, b }) => unit && orderEscortBehaviour(app, unit, b.dataset.behaviour),
  'escort-pattern': (app, { unit, b }) => unit && orderEscortPattern(app, unit, b.dataset.pattern),
  'comms-cancel': (app, { b }) => orderCommsCancel(app, b.dataset.signal),
  'comms-carry': (app, { b }) => orderCommsCarry(app, b.dataset.signal, b.dataset.group),
  'comms-position': (app, { unit }) => unit && orderAskPosition(app, unit),
  admiralty: (app, { id }) => {
    const convoy = app.world.convoys.find((c) => c.id === id);
    if (convoy) orderAdmiraltyRoute(app, convoy);
  },

  // ---- readiness, roster, timetable ----
  'open-roster': (app, { id, b }) => openRoster(app, { squadronId: id || null, fieldId: b.dataset.field || null }),
  alert: (app, { unit, b }) => unit && orderAlertChecked(app, unit, b.dataset.alert),
  'confirm-rest': (app, { unit }) => unit && orderAlertChecked(app, unit, 'rest'),
  'confirm-cancel': (app) => cancelConfirm(app),
  'roster-resume': (app, { unit }) => unit && orderRosterResume(app, unit),
  'roster-copy': (app, { sq, id }) => sq && orderRosterCopy(app, sq, inputValue(`rp-copy-${id}`)),
  'roster-add': (app, { unit, id }) => {
    firstSchedule(app);
    if (!unit) return;
    // An hour of the day in the daily plan, hours after H0 in the plan for the coming hours.
    const field = document.getElementById(`roster-offset-${id}`) || document.getElementById(`roster-time-${id}`);
    if (field && orderRosterAdd(app, unit, inputValue(`roster-alert-${id}`), field.value)) field.value = ''; // ready for the next change
  },
  'roster-remove': (app, { unit, b }) => unit && orderRosterRemove(app, unit, b.dataset.entry),
  'schedule-takeoff': (app, { unit, id }) => {
    firstSchedule(app);
    if (unit) orderScheduleTakeoff(app, unit, inputValue(`sched-time-${id}`), inputChecked(`sched-daily-${id}`));
  },
  'schedule-wing': (app, { unit, id }) => {
    firstSchedule(app);
    if (unit) orderScheduleWing(app, unit, inputValue(`sched-time-${id}`), inputChecked(`sched-daily-${id}`));
  },
  'schedule-join': (app, { unit, id }) => {
    firstSchedule(app);
    if (unit && unit.kind === 'squadron') orderScheduleJoin(app, unit, inputValue(`join-formation-${id}`), inputValue(`join-time-${id}`));
    else if (unit) orderScheduleJoin(app, unit, inputValue(`group-formation-${id}`), inputValue(`group-time-${id}`), Number(inputValue(`group-day-${id}`) || 0));
  },
  'schedule-sail': (app, { unit, id }) => {
    firstSchedule(app);
    if (unit) orderScheduleSail(app, unit, Number(inputValue(`sail-day-${id}`) || 0), inputValue(`sail-time-${id}`));
  },
  'schedule-cancel': (app, { unit }) => unit && orderCancelSchedule(app, unit),
  'hint-seen': (app) => {
    app.scheduleHintSeen = true;
    app.scheduleHintShown = false;
    try {
      localStorage.setItem('jeu-1940.scheduleHint.v1', '1');
    } catch {
      // ignore
    }
  },

  // ---- the rendezvous of a formation ----
  'rally-where': rally('where', ({ b }) => ({ where: b.dataset.where })),
  'rally-place': rally('place'),
  'rally-alt-up': rally('alt', () => ({ deltaFt: 1000 })),
  'rally-alt-down': rally('alt', () => ({ deltaFt: -1000 })),
  'rally-asap': rally('time', () => ({ text: 'asap' })),
  'rally-time': rally('time', ({ id }) => {
    const day = inputValue(`rally-day-${id}`);
    return { text: inputValue(`rally-time-${id}`), dayOffset: day === '' ? null : Number(day) };
  }),
  'rally-missing': rally('missing', ({ b, id }) => ({ missing: b.dataset.missing, waitMin: Number(inputValue(`rally-wait-${id}`)) || null })),
  'rally-arm': (app, c) => {
    firstSchedule(app);
    if (c.unit) orderRally(app, c.unit, { kind: 'arm' });
  },
  'rally-compute': rally('compute'),
  'rally-cancel': rally('cancel'),
  'rally-route-clear': rally('routeClear'),

  // ---- formations ----
  'formation-new': (app, { unit }) => {
    const f = unit ? orderNewFormation(app, unit) : null;
    if (f) openFormations(app, { focus: f.id });
  },
  'formation-manage': (app, { id }) => openFormations(app, { focus: id }),
  'formation-launch': (app, { id }) => {
    const f = formationById(app.world, id);
    if (f) orderLaunchWaiting(app, f);
  },
  'formation-dissolve': (app, { id }) => {
    const f = formationById(app.world, id);
    if (f) orderDissolve(app, f);
  },
  'formation-merge': (app, { id, b }) => {
    const f = formationById(app.world, id);
    const from = f ? formationById(app.world, b.dataset.from) : null;
    if (from) orderMerge(app, f, from);
  },
  'formation-remove': (app, { id, b }) => {
    const f = formationById(app.world, b.dataset.formation);
    if (f) orderLeaveFormationOf(app, f, id);
  },

  // ---- the ground and the purchases ----
  offer: (app, { b }) => orderOffer(app, b.dataset.offer),
  'send-train': (app, { id }) => {
    const to = document.getElementById('train-to');
    const loads = {};
    for (const res of ['fuel', 'materiel', 'ammo']) {
      const v = Number(inputValue(`train-${res}`));
      if (v > 0) loads[res] = v;
    }
    if (to && to.value) orderTrain(app, id, to.value, loads);
  },
  'set-min': (app, { id, b }) => {
    const site = app.world.sites.get(id);
    if (site) orderMinStock(app, site, b.dataset.resource, inputValue(`min-stock-${b.dataset.resource}`));
  },
};

/** One entry a `data-change`: a field of a sheet that changed. */
export const PANEL_CHANGES = {
  'end-action': (app, { sq, target }) => sq && orderEndAction(app, sq, target.value),
  'rally-dep': (app, { id, target }) => {
    const f = formationById(app.world, id);
    const day = inputValue(`rally-dep-day-${target.dataset.unit}`);
    if (f) orderRally(app, f, { kind: 'departure', unitId: target.dataset.unit, text: target.value, dayOffset: day === '' ? null : Number(day) });
  },
  'ship-end': (app, { id, target }) => {
    const e = app.world.escorts.find((x) => x.id === id);
    if (e) orderShipEnd(app, e, target.value);
  },
  'speed-pct': (app, { id, kind, target }) => {
    const u = findUnit(app, kind, id);
    if (u) orderSpeedPct(app, u, Number(target.value));
  },
  'exit-channel': (app, { id, target }) => {
    const e = app.world.escorts.find((x) => x.id === id);
    if (e) orderExitChannel(app, e, target.value);
  },
  'roster-override': (app, { sq, target }) => sq && orderRosterOverride(app, sq, target.checked),
  'rally-wait': (app, { id, target }) => {
    const f = formationById(app.world, id);
    if (f && f.rally) orderRally(app, f, { kind: 'missing', missing: f.rally.missing, waitMin: Number(target.value) });
  },
};

/** What a click on the journal, the tabs or the folds does before any `data-action`. */
function chromeClick(app, e) {
  if (toggleSheetHelp(app, e)) {
    app.dirtyPanels = true;
    return true;
  }
  if (onWatchClick(app, e)) return true;
  const logTab = e.target.closest('[data-log-tab]');
  if (logTab) {
    app.signals.tab = logTab.dataset.logTab;
    app.signals.key = '';
    app.el.logSection.classList.remove('collapsed');
    app.dirtyHud = true;
    return true;
  }
  const reportLine = e.target.closest('[data-report]');
  if (reportLine) {
    openReports(app, reportLine.dataset.report);
    return true;
  }
  const fold = e.target.closest('[data-log-toggle]');
  if (fold) {
    fold.parentElement.classList.toggle('collapsed');
    return true;
  }
  if (e.target.closest('[data-log-section]')) {
    app.el.logSection.classList.toggle('collapsed');
    return true;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    app.toteTab = tab.dataset.tab;
    app.dirtyPanels = true;
    return true;
  }
  const unitTab = e.target.closest('[data-unit-tab]');
  if (unitTab) {
    // The tab chosen stays open for every unit of the same kind.
    app.unitTabs = { ...(app.unitTabs || {}), [unitTab.dataset.group]: unitTab.dataset.unitTab };
    app.dirtyPanels = true;
    return true;
  }
  return false;
}

// What a sheet lets one do without giving an order: allowed while the instructor of a lesson
// has the hand.
const LOOKING = new Set(['select', 'close-unit', 'centre-selection', 'dev-show', 'cards', 'open-roster', 'hint-seen']);

export function onPanelClick(app, e) {
  if (chromeClick(app, e)) return;
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const { action, id, kind } = b.dataset;
  const run = PANEL_ACTIONS[action];
  if (!run) return;
  if (handsOff(app) && !LOOKING.has(action)) {
    nudgeCoach(app);
    return;
  }
  const sq = app.world.squadrons.find((s) => s.id === id);
  run(app, { b, action, id, kind, sq, unit: kind ? findUnit(app, kind, id) : sq });
  tutorialFlag(app, `action:${action}`); // a lesson may wait for this button
  app.dirtyPanels = true;
}

export function onPanelChange(app, e) {
  const target = e.target.closest('[data-change]');
  if (!target) return;
  if (handsOff(app)) {
    nudgeCoach(app);
    app.dirtyPanels = true;
    return;
  }
  const run = PANEL_CHANGES[target.dataset.change];
  if (run) {
    const { id, kind } = target.dataset;
    run(app, { target, id, kind, sq: app.world.squadrons.find((s) => s.id === id) });
  }
  app.dirtyPanels = true;
}

export function onPanelKeydown(app, e) {
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

/** The side panel, the unit sheet and the roster page answer the same buttons. */
export function attachPanels(app) {
  const { el } = app;
  el.panel.addEventListener('change', (e) => {
    const unit = e.target.closest('[data-watch-unit]');
    if (!unit) return;
    app.signals.unit = unit.value;
    app.signals.key = '';
    app.dirtyHud = true;
  });
  for (const box of [el.panel, el.unitPanel, el.dlgRoster]) {
    box.addEventListener('click', (e) => onPanelClick(app, e));
    box.addEventListener('change', (e) => onPanelChange(app, e));
    box.addEventListener('keydown', (e) => onPanelKeydown(app, e));
  }
}
