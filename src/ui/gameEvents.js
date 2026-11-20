// What the page does with the events of the simulation, after each frame: the journal, the
// sounds, the effects on the map, the alerts, and the pages some of them open (a watch report,
// an important event, the end of the game).

import { eventMessage } from './messages.js';
import { addLogEntry } from './panels.js';
import { addEffectsForEvent } from '../render/fx.js';
import { playBombs, playGuns, playRadio } from './sound.js';
import { alertForEvent, raiseAlert } from './alerts.js';
import { ALERT_TYPES } from './alertRules.js';
import { goView } from './actions.js';
import { viewOffered } from './offered.js';
import { openWatch, reportWritten } from './watchPanel.js';
import { questionAsked } from './questions.js';
import { tutorialEvent } from './tutorial.js';
import { openEnd, openEvent, openLessonOver, openSuccess } from './dialogs.js';
import { recordResult } from './campaign.js';
import { fighterEstablishmentShare } from '../sim/objectives.js';
import { CURRENT } from '../save/store.js';

/** Events at which the steps of a frame stop, so that the clock stops on the very second. */
export const INTERRUPTING = new Set([
  ...ALERT_TYPES, 'scenarioEnd', 'allObjectivesDone', 'convoyArrived', 'pilotAboard', 'uboatSighted', 'scenarioEvent', 'mruReady', 'question',
  'seaStop', // a relief or a night attack of the sea
]);
const RADIO = new Set(['tallyHo', 'missed', 'nothingSeen', 'bingo', 'outOfAmmo', 'divert', 'divertOut', 'legMissed', 'convoySighted', 'interceptOrdered', 'uboatSighted']);

export function handleEvents(app, events) {
  for (const e of events) {
    tutorialEvent(app, e);
    const msg = eventMessage(app.world, e);
    let report = (e.type === 'raidReport' || e.type === 'combatReport') && app.world.reports.has(e.raidId) ? e.raidId : null;
    // A depth-charge attack: its journal lines open its report.
    if ((e.type === 'escortEngaged' || e.type === 'depthChargePass') && e.report) report = e.report;
    const logId = msg ? addLogEntry(app, msg.text, msg.level, e.t, { report }) : null;
    addEffectsForEvent(app, e);
    if (RADIO.has(e.type) || (e.type === 'raidSighted' && e.kind === 'squadron')) playRadio(app);
    else if (e.type === 'combatRound') playGuns(app);
    else if (e.type === 'siteHit' || e.type === 'shipsSunk') playBombs(app);
    // Every event that needs the player raises an alert and slows the game (alertRules.js).
    const alert = alertForEvent(app, e, logId);
    if (e.type === 'uboatAttack' || e.type === 'convoyBombed' || e.type === 'escortEngaged') app.lastNavalAttack = e.t;
    if (e.type === 'raidDetected') {
      if (alert && app.settings.autoZoom && app.camera.scale < 0.6 && viewOffered(app, 'england')) goView(app, 'england');
    } else if (e.type === 'seaStop') {
      seaStop(app, e);
    } else if (e.type === 'watchReport') {
      app.signals.key = '';
      app.dirtyHud = true;
      reportWritten(app);
    } else if (e.type === 'question') {
      questionAsked(app);
    } else if (e.type === 'scenarioEvent' && e.important) {
      // (Not over the main menu: the journal keeps the event.)
      setTimeout(() => !app.onMenu && openEvent(app, e), 200);
    } else if (e.type === 'allObjectivesDone') {
      if (!app.world.ended) setTimeout(() => !app.onMenu && openSuccess(app), 400);
    } else if (e.type === 'scenarioEnd' && app.tutorial) {
      // The little scenario of a lesson ran out before its last step. It is no game of the
      // campaign, and the game kept in the browser is the player's own: nothing is recorded
      // and nothing is removed; the lesson is offered again, with its instructor.
      app.paused = true;
      app.dirtyHud = true;
      openLessonOver(app);
    } else if (e.type === 'scenarioEnd') {
      app.paused = true;
      app.dirtyHud = true;
      // The game is over: nothing left to continue (its automatic saves stay).
      app.store.remove(CURRENT);
      app.unlocked = recordResult(app.campaign, app.world, fighterEstablishmentShare(app.world));
      openEnd(app);
    }
  }
  if (events.length) app.panelsStale = true;
}

/**
 * The sea at the rhythm of the watches stops the game: a pause, never a slower speed, so
 * that « Reprendre » goes on at the speed of before. At a relief the report of the watch
 * opens with what waits for a decision; between two reliefs, the first attack on a convoy
 * in the night raises its alert.
 */
function seaStop(app, e) {
  if (app.world.ended) return;
  app.paused = true;
  app.pausedByPage = false; // a page closed after this must not set the game going again
  app.accumulator = 0;
  app.dirtyHud = true;
  app.dirtyPanels = true;
  if (e.reason === 'relief') {
    setTimeout(() => !app.onMenu && openWatch(app, e.reportId), 150);
    return;
  }
  // (The attack has just given a sure point: the convoy is where it is drawn.)
  const c = app.world.convoys.find((x) => x.id === e.convoyId);
  raiseAlert(app, {
    type: 'seaStop', t: app.world.t, level: 'danger', pause: true, decision: true, variant: e.sunk > 0 ? 'text' : 'missed',
    params: { convoy: e.convoy, n: e.sunk },
    focus: c ? { x: c.x, y: c.y, kind: 'convoy', id: c.id } : { x: e.x, y: e.y },
  });
}
