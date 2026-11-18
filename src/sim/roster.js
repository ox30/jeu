// The duty roster of a squadron: its alert state planned for every day, by the hour only
// (00:00 to 24:00, the same every day, so no dates to set). To change only the coming hours
// (a mission planned, a hard day ahead), the player opens a plan for the next 24 hours (the
// length is a setting), counted from its start H0: H0 to H+6 at rest, H+6 to H+9 on alert,
// and so on. It starts empty, replaces the daily plan meanwhile, and once it is over the
// daily plan takes over again.
// Changes happen at their hour, checked once a minute; between them the player may still
// change the state by hand. Without fatigue (Arcade) there are no alert states, and no roster.

import { emit } from './events.js';
import { ALERT_STATES, changeAlert, fatigueOn } from './crews.js';

const DAY = 86400;

export const emptyRoster = () => ({ daily: [], override: null });

/** Seconds since midnight on the game clock at game time `t`. */
export function timeOfDay(world, t = world.t) {
  const s = Math.floor(world.startMs / 1000) + t;
  return ((s % DAY) + DAY) % DAY;
}

/** The next game time after `t` (strictly) at which the clock shows `tod`. */
export function nextAt(world, tod, t = world.t) {
  let at = t + ((((tod - timeOfDay(world, t)) % DAY) + DAY) % DAY);
  if (at <= t) at += DAY;
  return at;
}

function newId(world) {
  const id = `R${world.nextTimetableId}`;
  world.nextTimetableId++;
  return id;
}

function rosterOf(s) {
  if (!s.roster || Array.isArray(s.roster)) s.roster = emptyRoster();
  return s.roster;
}

/** The plan for the coming hours, if one is running. */
export function overrideOf(world, s) {
  const o = s.roster && s.roster.override;
  return o && o.until > world.t ? o : null;
}

/** Adds (or replaces) a change of the daily plan at `tod` seconds after midnight. */
export function addDaily(world, s, tod, alert) {
  if (!ALERT_STATES.includes(alert) || !Number.isFinite(tod)) return null;
  const r = rosterOf(s);
  const at = ((Math.round(tod) % DAY) + DAY) % DAY;
  const entry = { id: newId(world), tod: at, alert };
  r.daily = [...r.daily.filter((e) => e.tod !== at), entry].sort((a, b) => a.tod - b.tod);
  return entry;
}

/** Opens a plan for the next `hours`, empty, instead of the daily one. */
export function startOverride(world, s, hours = 24) {
  const r = rosterOf(s);
  if (overrideOf(world, s)) return r.override;
  r.override = { from: world.t, until: world.t + Math.max(1, hours) * 3600, entries: [] };
  return r.override;
}

/**
 * Ends the plan for the coming hours: the daily plan takes over at once, with the state it
 * gives for this hour.
 */
export function endOverride(world, s) {
  const r = rosterOf(s);
  if (!r.override) return false;
  r.override = null;
  const state = dailyStateAt(world, s, world.t);
  if (state) apply(world, s, state, true);
  return true;
}

/**
 * Adds a change to the plan for the coming hours, `offset` seconds after its start (H0). A
 * change whose hour has already come (H+0 just after ticking the box) is made at once.
 */
export function addOverride(world, s, offset, alert) {
  if (!ALERT_STATES.includes(alert) || !Number.isFinite(offset) || offset < 0) return null;
  const o = overrideOf(world, s);
  if (!o) return null;
  const at = o.from + Math.round(offset / 60) * 60;
  if (at >= o.until) return null; // after the end of the plan
  const entry = { id: newId(world), at, alert };
  o.entries = [...o.entries.filter((e) => e.at !== at), entry].sort((a, b) => a.at - b.at);
  const current = o.entries.filter((e) => e.at <= world.t).pop();
  if (current === entry) apply(world, s, alert);
  return entry;
}

/** Removes a change, from the daily plan or from the plan for the coming hours. */
export function removeRosterEntry(world, s, id) {
  const r = rosterOf(s);
  const before = r.daily.length + (r.override ? r.override.entries.length : 0);
  r.daily = r.daily.filter((e) => e.id !== id);
  if (r.override) r.override.entries = r.override.entries.filter((e) => e.id !== id);
  return r.daily.length + (r.override ? r.override.entries.length : 0) < before;
}

/** The state the daily plan gives at game time `t` (the last change before that hour), or null. */
export function dailyStateAt(world, s, t) {
  const daily = (s.roster && s.roster.daily) || [];
  if (!daily.length) return null;
  const tod = timeOfDay(world, t);
  let state = daily[daily.length - 1].alert; // the evening's state runs past midnight
  for (const e of daily) if (e.tod <= tod) state = e.alert;
  return state;
}

/**
 * The changes planned between now and `end`, in order: those of the plan for the coming
 * hours while it runs, the daily plan's state when it takes over again, then the daily ones.
 */
export function plannedChanges(world, s, end) {
  const r = s.roster;
  if (!r || Array.isArray(r) || s.alertManual) return [];
  const out = [];
  const o = overrideOf(world, s);
  const from = o ? o.until : world.t;
  if (o) {
    for (const e of o.entries) if (e.at > world.t && e.at <= end) out.push({ at: e.at, alert: e.alert, override: true });
    if (o.until <= end) {
      const state = dailyStateAt(world, s, o.until);
      if (state) out.push({ at: o.until, alert: state, resumed: true });
    }
  }
  for (const e of r.daily) {
    for (let at = nextAt(world, e.tod, from); at <= end; at += DAY) {
      if (at > from) out.push({ at, alert: e.alert });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function apply(world, s, alert, resumed = false) {
  if ((s.alert || 'min5') === alert) return;
  changeAlert(world, s, alert);
  emit(world, resumed ? 'rosterResumed' : 'rosterApplied', { squadron: s.name, squadronId: s.id, alert });
}

/** True if the clock passed `tod` in (prev, t]. */
function crossed(world, tod, prev, t) {
  const a = timeOfDay(world, prev);
  const b = timeOfDay(world, t);
  return a < b ? tod > a && tod <= b : tod > a || tod <= b;
}

/** Once a minute: the changes whose hour has come. */
export function applyRoster(world, s) {
  const r = s.roster;
  if (!r || Array.isArray(r) || !fatigueOn(world) || s.state === 'lost') return;
  const t = world.t;
  const prev = t - 60;
  const o = r.override;
  // A state set by hand holds until the player hands back to the plan (« Retour au planning »).
  if (s.alertManual) {
    if (o && o.until <= t) r.override = null;
    return;
  }
  if (o && o.until <= t) {
    // The plan for the coming hours is over: back to the daily plan.
    r.override = null;
    const state = dailyStateAt(world, s, t);
    if (state) apply(world, s, state, true);
    return;
  }
  if (o) {
    for (const e of o.entries) if (e.at > prev && e.at <= t) apply(world, s, e.alert);
    return; // the daily plan waits until it is over
  }
  for (const e of r.daily) if (crossed(world, e.tod, prev, t)) apply(world, s, e.alert);
}

/**
 * A roster from before (M2.3: a list of changes at dates, some every day): the daily ones
 * become the daily plan, the others are dropped.
 */
export function normalizeRoster(world, s) {
  if (s.roster && !Array.isArray(s.roster)) {
    if (!Array.isArray(s.roster.daily)) s.roster.daily = [];
    if (s.roster.override === undefined) s.roster.override = null;
    return;
  }
  const old = Array.isArray(s.roster) ? s.roster : [];
  s.roster = emptyRoster();
  for (const e of old) if (e.daily && ALERT_STATES.includes(e.alert)) addDaily(world, s, timeOfDay(world, e.at), e.alert);
}

/** The state the plan calls for now: the plan for the coming hours, or the daily plan. */
export function plannedStateNow(world, s) {
  const r = s.roster;
  if (!r || Array.isArray(r)) return null;
  const o = overrideOf(world, s);
  if (o) {
    let state = null;
    for (const e of o.entries) if (e.at <= world.t) state = e.alert;
    return state || dailyStateAt(world, s, o.from);
  }
  return dailyStateAt(world, s, world.t);
}

/** The player sets a state by hand: it holds until « Retour au planning ». */
export function holdManual(world, s) {
  s.alertManual = true;
}

/** « Retour au planning »: the plan takes over again, with the state it calls for now. */
export function resumeRoster(world, s) {
  s.alertManual = false;
  const state = plannedStateNow(world, s);
  if (state) apply(world, s, state, true);
  return state;
}

/** Copies the daily plan of `from` to `to` (each change a new entry); the plan for the coming hours stays. */
export function copyDaily(world, from, to) {
  if (from === to) return false;
  const r = to.roster && !Array.isArray(to.roster) ? to.roster : (to.roster = { daily: [], override: null });
  r.daily = [];
  for (const e of from.roster.daily) addDaily(world, to, e.tod, e.alert);
  return true;
}
