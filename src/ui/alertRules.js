// Which events call the player, in every scenario. A rule turns an event into an alert:
// its level (how far the game slows down), its texts and the place to show. The same alert
// is not repeated within its quiet time (a convoy attacked again during the same night).
// Any new event that needs the player should get a rule here.

import { distance, unproject } from '../sim/geo.js';
import { t } from '../core/i18n.js';
import { countText, ftText, placeText, positionText } from './format.js';

/** Highest speed left after an alert of each level ("slow down on alert" setting). */
export const ALERT_SPEED = { raid: 10, danger: 60, warning: 600 };

/**
 * The speed each alert brings the game down to, unless the player set another one in the
 * settings (0: it does not slow the game down). At sea, the player decides at ×1.
 */
export const ALERT_GROUPS = [
  { id: 'air', speeds: { raidDetected: 10, patrolBounced: 600 } },
  {
    id: 'sea',
    speeds: {
      uboatAttack: 1, convoyBombed: 1, escortEngaged: 1, uboatSighted: 1, convoySighted: 1, straggler: 1,
      convoyInEscortRange: 1, escortLowFuel: 1, escortDry: 1, escortChargesOut: 1, convoyStopped: 1, convoyWaiting: 1, condorSighted: 1, condorAttack: 1,
    },
  },
  { id: 'bases', speeds: { siteOut: 600, noFuel: 600, noAmmo: 600, lowFuel: 600, scheduleDelayed: 600 } },
];
const DEFAULT_SPEED = Object.assign({}, ...ALERT_GROUPS.map((g) => g.speeds));
// At the rhythm of the watches the events of the sea go to the watch report instead.
const SEA_TYPES = new Set(Object.keys(ALERT_GROUPS.find((g) => g.id === 'sea').speeds));

/** Speed an alert slows the game down to (0: none), from the settings or by default. */
export function alertSpeed(settings, type, level) {
  const own = settings && settings.alertSpeeds ? settings.alertSpeeds[type] : undefined;
  if (own !== undefined && own !== null && own !== '') return Number(own);
  return DEFAULT_SPEED[type] ?? ALERT_SPEED[level] ?? 600;
}

/** The default speed of an alert type. */
export function defaultAlertSpeed(type) {
  return DEFAULT_SPEED[type];
}
const RANK = { warning: 1, danger: 2, raid: 3 };

export function alertRank(level) {
  return RANK[level] || 0;
}

const H = 3600;
const CONTACT_KM = 250; // a U-boat contact this close to a convoy calls the player

function convoyAt(world, id, x, y) {
  const c = world.convoys.find((u) => u.id === id) || world.escorts.find((u) => u.id === id);
  return c ? { x: c.x, y: c.y, kind: c.kind, id: c.id } : { x, y };
}

function siteAt(world, key) {
  const s = world.sites.get(key);
  return s ? { x: s.x, y: s.y, kind: 'site', id: s.key } : null;
}

function airfieldAt(world, name) {
  const f = world.airfields.find((a) => a.name === name);
  return f ? { x: f.x, y: f.y, kind: 'site', id: `airfield:${f.id}` } : null;
}

function reasonText(reason) {
  const text = t(`log.delayReasons.${reason}`);
  return text === `log.delayReasons.${reason}` ? reason : text;
}

const RULES = {
  raidDetected: (w, e) => ({
    level: 'raid',
    key: `raid:${e.raidId}`,
    params: { raid: e.raid, count: countText(e.count, e.approx), alt: ftText(e.altFt), where: placeText(e.location) },
    focus: { raidId: e.raidId },
  }),
  uboatAttack: (w, e) => ({
    level: 'danger',
    key: `attack:${e.convoyId}`,
    quiet: 6 * H,
    params: { convoy: e.convoy, n: e.sunk },
    variant: e.sunk > 0 ? 'text' : 'missed',
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  convoyBombed: (w, e) => ({
    level: 'danger',
    key: `bombed:${e.convoyId}`,
    quiet: 2 * H,
    params: { convoy: e.convoy, raid: e.raid, n: e.sunk },
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  // A Condor over a convoy: its position goes to the U-boats; it may bomb.
  condorSighted: (w, e) => ({
    level: 'warning',
    key: `condor:${e.convoyId}`,
    quiet: 12 * H,
    params: { convoy: e.convoy },
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  condorAttack: (w, e) => ({
    level: 'danger',
    key: `condorBomb:${e.convoyId}`,
    quiet: 2 * H,
    params: { convoy: e.convoy, n: e.sunk },
    variant: e.sunk > 0 ? 'text' : 'missed',
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  convoySighted: (w, e) => ({
    level: 'warning',
    key: `sighted:${e.convoyId}`,
    quiet: 12 * H,
    params: { convoy: e.convoy },
    focus: convoyAt(w, e.convoyId),
  }),
  // A U-boat seen by one of our aircraft or escort groups, wherever it is. A group that
  // attacks it at once calls the player with « Escorte au combat » instead.
  uboatSighted: (w, e) => {
    if (e.attack) return null;
    let best = null;
    for (const c of w.convoys) {
      if (c.state !== 'atSea') continue;
      const d = distance(c.x, c.y, e.x, e.y);
      if (d <= CONTACT_KM && (!best || d < best.d)) best = { c, d };
    }
    const [lon, lat] = unproject(e.x, e.y);
    return {
      level: 'warning',
      key: `sighted:${e.uboatId}`,
      quiet: H,
      params: {
        by: e.by, how: t(`map.uSource.${e.source}`), where: positionText(lat, lon),
        convoy: best ? best.c.name : '', km: best ? Math.round(best.d) : 0,
      },
      variant: best ? 'near' : 'text',
      focus: { x: e.x, y: e.y, kind: e.plotId ? 'uplot' : null, id: e.plotId },
    };
  },
  straggler: (w, e) => ({
    level: 'warning',
    key: `straggler:${e.convoyId}`,
    quiet: 6 * H,
    params: { convoy: e.convoy, n: e.n },
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  convoyInEscortRange: (w, e) => ({
    level: 'warning',
    key: `range:${e.convoyId}`,
    params: { convoy: e.convoy, n: e.free },
    variant: e.free > 0 ? 'text' : 'none',
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  escortLowFuel: (w, e) => ({
    level: 'warning',
    key: `escortFuel:${e.escortId}:${Math.floor(w.t / (12 * H))}`,
    params: { escort: e.escort, convoy: e.convoy },
    variant: e.convoy ? 'text' : 'alone',
    focus: e.convoyId ? convoyAt(w, e.convoyId, e.x, e.y) : convoyAt(w, e.escortId, e.x, e.y),
  }),
  // Racks empty: the group can only keep a U-boat down. It stays with its convoy unless told to go.
  escortChargesOut: (w, e) => ({
    level: 'warning',
    key: `chargesOut:${e.escortId}`,
    params: { escort: e.escort, convoy: e.convoy },
    variant: e.convoy ? 'text' : 'alone',
    focus: convoyAt(w, e.escortId, e.x, e.y),
  }),
  escortDry: (w, e) => ({
    level: 'danger',
    key: `escortDry:${e.escortId}`,
    params: { escort: e.escort, convoy: e.convoy, port: e.port, kn: e.kn },
    variant: e.convoy ? 'text' : 'alone',
    focus: convoyAt(w, e.escortId, e.x, e.y),
  }),
  convoyStopped: (w, e) => ({
    level: 'warning',
    key: `stopped:${e.convoyId}`,
    quiet: H,
    params: { convoy: e.convoy },
    focus: convoyAt(w, e.convoyId, e.x, e.y),
  }),
  convoyWaiting: (w, e) => (w.t < 120 ? null : {
    level: 'warning',
    key: `waiting:${e.convoyId}`,
    quiet: H,
    params: { convoy: e.convoy },
    focus: convoyAt(w, e.convoyId),
  }),
  siteOut: (w, e) => ({
    level: 'warning',
    key: `siteOut:${e.site}`,
    quiet: H,
    params: { site: e.siteName },
    focus: siteAt(w, e.site),
  }),
  noFuel: (w, e) => ({
    level: 'warning',
    key: `noFuel:${e.airfield}`,
    quiet: 6 * H,
    params: { airfield: e.airfield, squadron: e.squadron },
    focus: airfieldAt(w, e.airfield),
  }),
  noAmmo: (w, e) => ({
    level: 'warning',
    key: `noAmmo:${e.airfield}`,
    quiet: 6 * H,
    params: { airfield: e.airfield, squadron: e.squadron, n: e.n },
    focus: airfieldAt(w, e.airfield),
  }),
  lowFuel: (w, e) => ({
    level: 'warning',
    key: `lowFuel:${e.airfieldId}`,
    quiet: 12 * H,
    params: { airfield: e.airfield },
    focus: airfieldAt(w, e.airfield),
  }),
  escortEngaged: (w, e) => ({
    level: 'danger',
    key: `engaged:${e.escortId}`,
    quiet: H / 2,
    params: { escort: e.escort, convoy: e.convoy },
    variant: e.convoy ? 'text' : 'alone',
    focus: { x: e.x, y: e.y, kind: 'escort', id: e.escortId },
  }),
  scheduleDelayed: (w, e) => {
    const reason = e.reason;
    return {
      level: 'warning',
      key: `delayed:${e.unitId}`,
      quiet: H,
      params: { unit: e.unit, reason: reasonText(reason) },
      focus: { x: e.x, y: e.y, kind: e.unitKind === 'formation' ? 'formation' : e.unitKind, id: e.unitId },
    };
  },
  patrolBounced: (w, e) => ({
    level: 'warning',
    key: `bounced:${e.squadronId}`,
    quiet: H,
    params: { squadron: e.squadron, raid: e.raid, n: e.left },
    focus: { x: e.x, y: e.y, kind: 'squadron', id: e.squadronId },
  }),
};

/**
 * The alerts that ask for an order (C6 of the audit): they stay on the screen until the order
 * is given or the player closes them. The others are information: they fade by themselves.
 */
export const DECISION_ALERTS = new Set([
  'raidDetected', 'convoyInEscortRange', 'escortLowFuel', 'escortDry', 'escortChargesOut', 'convoyStopped', 'convoyWaiting',
  'straggler', 'noFuel', 'noAmmo', 'lowFuel', 'seaStop',
]);

const inPortOrHomeward = (e) => !e || e.homeward || e.state === 'inPort' || e.state === 'refit';
const fieldOf = (w, a) => (a.focus && a.focus.kind === 'site' ? w.sites.get(a.focus.id) : null);

// What answers a decision: the order it asked for has been given (or no longer can be).
const ANSWERED = {
  raidDetected: (w, a) => w.squadrons.some((s) => s.state !== 'ready' && s.state !== 'lost'
    && ((s.intercept && s.intercept.raidId === a.focus.raidId) || s.attackRaid === a.focus.raidId || s.engagedRaid === a.focus.raidId)),
  convoyInEscortRange: (w, a) => {
    const c = w.convoys.find((x) => x.id === a.focus.id);
    return !c || c.state !== 'atSea' || w.escorts.some((e) => e.joinTarget === c.id || e.escorting === c.id);
  },
  escortLowFuel: (w, a) => inPortOrHomeward(w.escorts.find((e) => e.id === a.unitId)),
  escortDry: (w, a) => {
    const e = w.escorts.find((x) => x.id === a.unitId);
    return !e || e.state === 'inPort' || e.state === 'refit';
  },
  escortChargesOut: (w, a) => {
    const e = w.escorts.find((x) => x.id === a.unitId);
    return inPortOrHomeward(e) || e.charges > 0;
  },
  convoyStopped: (w, a) => {
    const c = w.convoys.find((x) => x.id === a.focus.id);
    return !c || c.state !== 'atSea' || c.route.length > 0 || c.plan.length > 0;
  },
  convoyWaiting: (w, a) => {
    const c = w.convoys.find((x) => x.id === a.focus.id);
    return !c || c.state !== 'waiting';
  },
  noFuel: (w, a) => {
    const f = fieldOf(w, a);
    return Boolean(f) && f.stocks.fuel >= 1;
  },
  lowFuel: (w, a) => {
    const f = fieldOf(w, a);
    return Boolean(f) && w.trains.some((tr) => tr.to === f.key && tr.cargo && tr.cargo.fuel > 0);
  },
};

/** Has the order this alert asked for been given? (An information is never « answered ».) */
export function alertAnswered(world, a) {
  const check = a.decision ? ANSWERED[a.type] : null;
  return Boolean(check && check(world, a));
}

/**
 * The alert an event calls for, or null. `memory` (a Map) remembers when each alert was
 * last given, in game seconds, so that the same one stays quiet for a while.
 */
export function alertFor(world, e, memory) {
  const rule = RULES[e.type];
  if (!rule) return null;
  if (world.watch && SEA_TYPES.has(e.type)) return null; // the watch report tells it
  const a = rule(world, e);
  if (!a) return null;
  const last = memory.get(a.key);
  if (last !== undefined && (!a.quiet || world.t - last < a.quiet)) return null;
  memory.set(a.key, world.t);
  return { type: e.type, t: world.t, variant: 'text', decision: DECISION_ALERTS.has(e.type), unitId: e.escortId || e.convoyId || null, ...a };
}

/** The event types that call the player (for the documentation and the tests). */
export const ALERT_TYPES = Object.keys(RULES);
