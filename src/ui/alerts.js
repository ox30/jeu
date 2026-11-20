// Alerts: a banner over the map, a signal, and the game slowed down (setting). A raid, a
// convoy under attack or a base without fuel call the player the same way; the rules that
// decide which events do are in alertRules.js. A less urgent alert waits behind a more
// urgent one and shows when that one is closed.
//
// An alert that asks for an order stays until the order is given or the player closes it; an
// information fades after half a minute. Up to four alerts wait behind the one shown: beyond
// that none is thrown away — the oldest goes to the journal as « not read », and the counter
// of the Journal button says how many there are and opens the journal on them.

import { t } from '../core/i18n.js';
import { contactEstimate } from '../sim/query.js';
import { centreOn, select } from './actions.js';
import { alertAnswered, alertFor, alertRank, alertSpeed } from './alertRules.js';
import { playAlarm, playNotice } from './sound.js';

const SHOW_MS = 30000;
const QUEUE_MAX = 4;
const READ_MS = 1500; // on the banner at least that long, an alert has been read
const STALE_S = 6 * 3600; // an alert older than this (game time) no longer shows

/** An event from the simulation: raises its alert if it calls for one. `logId`: its line in the journal. */
export function alertForEvent(app, e, logId = null) {
  const a = alertFor(app.world, e, app.alertMemory);
  if (a) raiseAlert(app, { ...a, logId });
  return a;
}

/** An alert that will not be shown goes to the journal as not read (never thrown away). */
function toJournal(app, a) {
  app.alertBox.unread.push({ logId: a.logId ?? null, t: a.t });
  app.dirtyHud = true;
}

/**
 * Waits behind the alert shown. `first`: an alert that has just left the banner for a more
 * urgent one, and comes back next. Beyond four waiting, the oldest raised goes to the journal
 * as not read (not the one that was on the screen a moment ago).
 */
function enqueue(app, a, first = false) {
  const box = app.alertBox;
  if (first) box.queue.unshift(a);
  else box.queue.push(a);
  while (box.queue.length > QUEUE_MAX) {
    const pick = (list) => list.reduce((best, x) => (best === null || x.seq < best.seq ? x : best), null);
    const unread = pick(box.queue.filter((x) => !x.seen));
    // (All of them read already: the oldest leaves without being counted.)
    const out = unread || pick(box.queue);
    box.queue.splice(box.queue.indexOf(out), 1);
    if (unread) toJournal(app, out);
  }
  updateCount(app);
}

export function raiseAlert(app, a) {
  // An alert that pauses the game (a stop of the watches) leaves its speed alone.
  const max = a.pause ? 0 : alertSpeed(app.settings, a.type, a.level);
  if (app.settings.slowOnAlert && max > 0 && app.speed > max) {
    app.speed = max;
    app.dirtyHud = true;
  }
  if (a.level === 'warning') playNotice(app);
  else playAlarm(app);
  const box = app.alertBox;
  if (a.seq === undefined) a.seq = box.seq = (box.seq || 0) + 1; // the order they were raised in
  const shown = box.current;
  if (!shown) show(app, a);
  else if (alertRank(a.level) >= alertRank(shown.level)) {
    // It takes the banner. The one it replaces has been read if it stayed long enough to be.
    // A decision still waits for its order: it comes back next. An information that was
    // read is done with; one chased at once waits its turn like any other.
    shown.seen = performance.now() - shown.shownMs >= READ_MS;
    if (shown.decision) enqueue(app, shown, true);
    else if (!shown.seen) enqueue(app, shown);
    show(app, a);
  } else enqueue(app, a);
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
  a.shownMs = performance.now();
  // A raid: the fighters on the ground as the banner shows. One of them ordered up is an answer.
  if (a.level === 'raid') a.readyThen = app.world.squadrons.filter((s) => s.role === 'fighter' && s.state === 'ready').map((s) => s.id);
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
  el.alert.dataset.decision = a.decision ? '1' : '0';
  el.alertKind.hidden = !a.decision;
  // A decision waits for its order; an information goes by itself.
  app.alertTimer = a.decision ? null : setTimeout(() => next(app), SHOW_MS);
}

function updateCount(app) {
  const n = app.alertBox.queue.length;
  app.el.alertMore.hidden = n === 0;
  app.el.alertMore.textContent = n ? t('alert.more', { n }) : '';
}

/**
 * An alert that no longer applies: its raid has left the plot, has dropped its bombs or has
 * been turned back; an information hours old. A decision does not age: it waits for its order.
 */
function isStale(app, a) {
  const w = app.world;
  if (a.level === 'raid') {
    const c = w.contacts.get(a.focus.raidId);
    if (!c || c.lost) return true;
    const report = w.reports.get(a.focus.raidId);
    return Boolean(report && (report.outcome || report.hits.length));
  }
  return !a.decision && w.t - a.t > STALE_S;
}

/** Closes the alert shown and brings the next one waiting, if it still applies. */
function next(app) {
  const box = app.alertBox;
  if (box.current) box.current.seen = true; // closed by the player, by its order, or after its time
  box.current = null;
  clearTimeout(app.alertTimer);
  while (box.queue.length) {
    const a = box.queue.shift();
    if (alertAnswered(app.world, a)) continue; // its order was given meanwhile
    if (isStale(app, a)) {
      // Too late to show: never seen, it is at least counted in the journal.
      if (!a.seen) toJournal(app, a);
      continue;
    }
    show(app, a);
    return;
  }
  app.el.alert.hidden = true;
  updateCount(app);
}

/**
 * Every frame: the alert shown goes when it no longer applies (at high speed, quickly), or
 * when the order it asked for has been given.
 */
export function updateAlerts(app) {
  const a = app.alertBox && app.alertBox.current;
  if (a && (isStale(app, a) || alertAnswered(app.world, a))) next(app);
}

export function resetAlerts(app) {
  clearTimeout(app.alertTimer);
  app.alertBox = { current: null, queue: [], unread: [], seq: 0 };
  app.alertMemory = new Map();
  if (app.el.alert) app.el.alert.hidden = true;
  app.dirtyHud = true;
}

/** Alerts that went to the journal without having been shown. */
export function unreadAlerts(app) {
  return app.alertBox ? app.alertBox.unread.length : 0;
}

/**
 * The Journal button: the journal comes forward (the side panel on a small screen, its
 * section unfolded, on its own tab), on the lines of the alerts not read, which are marked.
 */
export function openJournal(app) {
  const el = app.el;
  const box = app.alertBox;
  el.panel.classList.add('open');
  el.logSection.classList.remove('collapsed');
  if (app.signals) app.signals.tab = 'journal';
  for (const li of el.log.querySelectorAll('li.unread')) li.classList.remove('unread');
  let first = null;
  for (const u of box.unread) {
    const li = u.logId ? el.log.querySelector(`li[data-log-id="${u.logId}"]`) : null;
    if (!li) continue;
    li.classList.add('unread');
    const group = li.closest('.log-group');
    if (group) group.classList.remove('collapsed');
    if (!first) first = li;
  }
  box.unread = [];
  app.dirtyHud = true;
  // (The newest lines are on top: with nothing to point at, the journal is shown from there.)
  const target = first || el.log.firstElementChild;
  if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
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
    // « Voir » goes to the place. A decision stays until its order (or ×); an information has been read.
    if (!a || !a.decision) next(app);
  });
}
