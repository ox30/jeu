// Alerts: a banner over the map, a signal, and the game slowed down (setting). A raid, a
// convoy under attack or a base without fuel call the player the same way; the rules that
// decide which events do are in alertRules.js. A less urgent alert waits behind a more
// urgent one and shows when that one is closed.

import { t } from '../core/i18n.js';
import { contactEstimate } from '../sim/query.js';
import { centreOn, select } from './actions.js';
import { alertFor, alertRank, alertSpeed } from './alertRules.js';
import { playAlarm, playNotice } from './sound.js';

const SHOW_MS = 30000;
const QUEUE_MAX = 4;
const STALE_S = 6 * 3600; // an alert older than this (game time) no longer shows

/** An event from the simulation: raises its alert if it calls for one. */
export function alertForEvent(app, e) {
  const a = alertFor(app.world, e, app.alertMemory);
  if (a) raiseAlert(app, a);
  return a;
}

export function raiseAlert(app, a) {
  const max = alertSpeed(app.settings, a.type, a.level);
  if (app.settings.slowOnAlert && max > 0 && app.speed > max) {
    app.speed = max;
    app.dirtyHud = true;
  }
  if (a.level === 'warning') playNotice(app);
  else playAlarm(app);
  const box = app.alertBox;
  if (!box.current || alertRank(a.level) >= alertRank(box.current.level)) show(app, a);
  else {
    box.queue.push(a);
    if (box.queue.length > QUEUE_MAX) box.queue.shift();
    updateCount(app);
  }
}

function alertTitle(a) {
  return t(a.level === 'raid' ? 'alert.title' : `alerts.${a.type}.title`);
}

function alertText(a) {
  return t(a.level === 'raid' ? 'alert.text' : `alerts.${a.type}.${a.variant}`, a.params);
}

function show(app, a) {
  const el = app.el;
  const box = app.alertBox;
  box.current = a;
  el.alertTitle.textContent = alertTitle(a);
  el.alertText.textContent = alertText(a);
  el.alert.dataset.level = a.level;
  el.alertShow.hidden = !a.focus;
  el.alert.hidden = false;
  el.alert.classList.remove('flash');
  void el.alert.offsetWidth; // restart the animation
  el.alert.classList.add('flash');
  updateCount(app);
  clearTimeout(app.alertTimer);
  app.alertTimer = setTimeout(() => next(app), SHOW_MS);
}

function updateCount(app) {
  const n = app.alertBox.queue.length;
  app.el.alertMore.hidden = n === 0;
  app.el.alertMore.textContent = n ? t('alert.more', { n }) : '';
}

/** An alert that no longer applies: its raid has left the plot, or it is hours old. */
function isStale(app, a) {
  const w = app.world;
  if (a.level === 'raid') {
    const c = w.contacts.get(a.focus.raidId);
    return !c || c.lost;
  }
  return w.t - a.t > STALE_S;
}

/** Closes the alert shown and brings the next one waiting, if it still applies. */
function next(app) {
  const box = app.alertBox;
  box.current = null;
  while (box.queue.length) {
    const a = box.queue.shift();
    if (!isStale(app, a)) {
      show(app, a);
      return;
    }
  }
  app.el.alert.hidden = true;
  updateCount(app);
}

/** Every frame: the alert shown goes when it no longer applies (at high speed, quickly). */
export function updateAlerts(app) {
  const a = app.alertBox && app.alertBox.current;
  if (a && isStale(app, a)) next(app);
}

export function resetAlerts(app) {
  clearTimeout(app.alertTimer);
  app.alertBox = { current: null, queue: [] };
  app.alertMemory = new Map();
  if (app.el.alert) app.el.alert.hidden = true;
}

function showPlace(app, a) {
  const f = a.focus;
  if (!f) return;
  if (f.raidId) {
    const contact = app.world.contacts.get(f.raidId);
    const est = contact && contactEstimate(app.world, contact);
    if (est) centreOn(app, est.x, est.y, 1.5);
    select(app, 'raid', f.raidId);
    return;
  }
  if (f.x !== undefined) centreOn(app, f.x, f.y, 0.6);
  if (f.kind && f.id) select(app, f.kind, f.id);
}

export function initAlert(app) {
  const el = app.el;
  resetAlerts(app);
  el.alertClose.addEventListener('click', () => next(app));
  el.alertShow.addEventListener('click', () => {
    const a = app.alertBox.current;
    if (a) showPlace(app, a);
    next(app);
  });
}
