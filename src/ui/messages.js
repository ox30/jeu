// The words of the journal and of the watch reports: what each simulation event says to the
// player, and how loud (its level). The events are sorted by family, the same families as
// the watch reports of the sea (src/sim/watch.js): attacks and losses, U-boats, intelligence,
// escort groups, convoys, the air at sea; then what the sea does not have: the raids and the
// air battle, the squadrons' orders, the ground, and the game itself.
//
// A family is a table: event type → { level, shape }. `shape(world, e, p)` fills the
// parameters `p` of the sentence (a copy of the event) and may return:
//   - nothing: the sentence is `log.<type>` of fr.json;
//   - a string: another key of fr.json;
//   - null: the event is not told;
//   - { text, level }: the sentence itself.
// `p.suffix`, when set, is added after the sentence.

import { formatNumber, t } from '../core/i18n.js';
import { formatDate, formatShortDate, formatTime } from '../core/time.js';
import { FOOT_M } from '../sim/geo.js';
import {
  cargoText, countText, dateTimeText, ftText, headingText, objectiveText, placeText, positionText, reportText, resourceName,
  siteLongName, tonnesText,
} from './format.js';

const missing = (v) => v === null || v === undefined;

/** Is the squadron of this event a patrol (a spotter section, Coastal Command), not a fighter one? */
function isPatrolEvent(world, e) {
  const s = e.squadronId ? world.squadrons.find((x) => x.id === e.squadronId) : null;
  return Boolean(s && s.role !== 'fighter');
}

// ---- the sea: attacks and losses ------------------------------------------------------

const ATTACK = {
  uboatAttack: { level: 'alert', shape: (w, e) => (e.sunk ? undefined : 'log.uboatAttackMiss') },
  shipsSunk: { level: 'alert', shape: (w, e) => `log.shipsSunk.${e.cause}` },
  convoyLost: { level: 'alert' },
  // The losses of a bombed convoy are told by shipsSunk.
  convoyBombed: { level: 'alert', shape: (w, e) => (e.sunk ? null : 'log.convoyBombedNone') },
  condorAttack: { level: 'alert', shape: (w, e) => (e.sunk > 0 ? 'log.condorAttackHit' : undefined) },
};

// ---- the sea: U-boats seen, hunted, sunk ----------------------------------------------

// Why a hunt ended, when the U-boat was not sunk.
const HUNT_OVER = {
  stopped: 'log.escortHuntStopped', tooFar: 'log.escortHuntTooFar', damaged: 'log.escortHuntOverDamaged', lost: 'log.escortHuntOverLost',
  charges: 'log.escortHuntOverCharges',
};

const UBOAT = {
  uboatSighted: {
    level: 'warning',
    shape(w, e, p) {
      p.source = t(`map.uSource.${e.source}`);
      // Found under water by the ASDIC: it did not dive, it was down already.
      if (e.unitKind !== 'escort' || e.dived !== false || !e.depthM) return undefined;
      p.depth = e.depthM;
      p.course = headingText(e.course);
      return missing(e.course) ? 'log.uboatSightedDownNoCourse' : 'log.uboatSightedDown';
    },
  },
  asdicContact: {
    shape(w, e, p) {
      p.depth = e.depthM;
      p.course = headingText(e.course ?? 0);
      return missing(e.course) ? 'log.asdicContactNoCourse' : 'log.asdicContact';
    },
  },
  uboatContactLost: {
    shape(w, e, p) {
      p.time = formatTime(w.startMs + e.t * 1000);
    },
  },
  uboatSunk: { level: 'success', shape: (w, e) => (e.by ? 'log.uboatSunkBy' : undefined) },
  uboatDrivenOff: { level: 'success' },
  aircraftAttack: { level: 'warning' },
  escortEngaged: {
    level: 'alert',
    shape(w, e, p) {
      p.how = t(`log.engageHow.${e.how}`);
      return e.convoy ? undefined : 'log.escortEngagedAlone';
    },
  },
  depthChargePass: {
    level: 'warning',
    shape(w, e, p) {
      if (e.result === 'sunk') return null; // the sinking says it
      p.left = e.left ?? '';
      p.of = e.of ?? '';
      // A dry pass (the racks are empty) keeps the U-boat down and nothing more.
      return e.used === 0 && e.result === 'nothing' ? 'log.depthChargePass.dry' : `log.depthChargePass.${e.result}`;
    },
  },
  escortHunting: { shape: (w, e) => (e.convoy ? undefined : 'log.escortHuntingAlone') },
  escortHuntOver: {
    shape(w, e) {
      if (e.why === 'order') return null; // the order given says it
      const base = e.sank ? 'log.escortHuntOverSank' : HUNT_OVER[e.why] || 'log.escortHuntOver';
      return e.convoy || e.why === 'tooFar' ? base : `${base}Alone`;
    },
  },
};

// ---- the sea: intelligence --------------------------------------------------------------

const INTEL = {
  dfFix: {
    level: 'info',
    shape(w, e, p) {
      p.pos = positionText(e.lat, e.lon);
    },
  },
  convoySighted: { level: 'warning' },
  condorSighted: { level: 'warning' },
  // The U-boat command's own business: the player hears nothing of it.
  bduLine: { shape: () => null },
  bdienstRead: { shape: () => null },
};

// ---- the sea: escort groups and their signals -----------------------------------------

function signalShape(w, e, p) {
  p.what = t(`comms.orders.${e.order}`);
  return e.type === 'orderDelivered' && e.via === 'ship' ? 'log.orderDeliveredShip' : undefined;
}

const ESCORT = {
  escortJoined: { level: 'success' },
  escortLowFuel: { level: 'warning' },
  escortDry: { level: 'alert', shape: (w, e) => (e.convoy ? 'log.escortDryConvoy' : undefined) },
  escortChargesOut: { level: 'warning', shape: (w, e) => (e.convoy ? undefined : 'log.escortChargesOutAlone') },
  escortRadar: { level: 'success' },
  orderDelivered: { shape: signalShape },
  orderHandedBack: { level: 'warning', shape: signalShape },
  orderByLamp: { shape: signalShape },
  orderFailed: { level: 'warning', shape: signalShape },
};

// ---- the sea: convoys and cargo -------------------------------------------------------

const CONVOY = {
  convoyDeparted: {
    shape(w, e, p) {
      p.pct = Math.round(e.share * 100);
      p.fuel = formatNumber(e.fuel);
      p.materiel = formatNumber(e.materiel);
      if (e.lendLease) return 'log.convoyDepartedLendLease';
      // A scenario without a reserve of dollars (a lesson): nothing was paid, nothing is said of it.
      if (!w.currency) return 'log.convoyDepartedPlain';
      if (e.share <= 0) return 'log.convoyDepartedBallast';
      return e.share < 0.995 ? 'log.convoyDepartedShort' : undefined; // the reserve could not pay for all of it
    },
  },
  convoyRouted: {
    shape(w, e, p) {
      p.eta = dateTimeText(e.etaMs);
      return e.destination ? undefined : 'log.convoyRoutedOpen';
    },
  },
  convoyRouteRejected: { level: 'warning' },
  convoyStopped: { level: 'warning' },
  convoyArrived: { level: 'success', shape: (w, e) => (e.fuel || e.materiel ? 'log.convoyArrivedCargo' : undefined) },
  convoyUnloaded: { level: 'success' },
  straggler: {
    level: 'warning',
    shape(w, e, p) {
      p.kind = e.tanker ? t('log.stragglerTanker') : t('log.stragglerFreighter');
    },
  },
  offerBought: {
    shape(w, e, p) {
      p.offer = t(`offers.${e.offerId}`);
      p.date = formatShortDate(w.startMs + e.readyAt * 1000, t('months'));
    },
  },
  aircraftDelivered: { level: 'logistics' },
};

// ---- the raids and the air battle -----------------------------------------------------

const BATTLE = {
  raidDetected: {
    level: 'alert',
    shape(w, e, p) {
      p.count = countText(e.count, e.approx);
      p.where = placeText(e.location);
      p.alt = ftText(e.altFt);
    },
  },
  observersTracking: {
    shape(w, e, p) {
      p.where = placeText(e.location);
    },
  },
  raidSighted: {
    shape(w, e, p) {
      const parts = [];
      if (e.bombers > 0) parts.push(`${e.bombers} ${e.bomberType}`);
      if (e.escort > 0) parts.push(`${e.escort} ${e.escortType}`);
      p.force = parts.join(' + ');
      p.alt = ftText(e.altFt);
    },
  },
  contactLost: { level: 'info' },
  tallyHo: { level: 'combat', shape: (w, e) => (e.above ? 'log.tallyHoAbove' : undefined) },
  combatRound: {
    level: 'combat',
    shape(w, e, p) {
      p.bombers = e.bombersDown;
      p.fighters = e.fightersDown;
      if (e.killed) p.suffix = t('log.pilotsKilled', { n: e.killed });
    },
  },
  combatReport: { level: 'report', shape: (w, e) => ({ text: reportText(w, e), level: 'report' }) },
  raidReport: {
    level: 'report',
    shape(w, e, p) {
      p.outcome = t(`reports.outcome.${e.outcome}`).toLowerCase();
    },
  },
  raidRepelled: { level: 'success' },
  raidDestroyed: { level: 'success' },
  missed: {
    level: 'warning',
    shape(w, e, p) {
      p.km = formatNumber(Math.max(1, Math.round(e.km)));
      p.dir = t('place.directions')[e.dir];
      p.ft = ftText(Math.round(Math.abs(e.dzM / FOOT_M) / 500) * 500);
      if (!missing(e.guided)) p.suffix = t('log.missedGuided', { p: Math.round(e.guided * 100) });
      return `log.missed.${e.problem}`;
    },
  },
  interceptOrdered: {
    shape(w, e, p) {
      p.p = Math.round(e.p * 100);
    },
  },
  interceptRefused: { level: 'warning' },
  interceptEnded: { level: 'warning', shape: (w, e) => `log.interceptEndedReasons.${e.reason}` },
  squadronLost: { level: 'alert' },
};

// ---- the squadrons and formations: orders, routes, states -----------------------------

function alertStateShape(w, e, p) {
  p.state = t(`orders.alertNames.${e.alert}`);
}

const SQUADRON = {
  scrambleRefused: {
    level: 'warning',
    shape(w, e, p) {
      if (e.state === 'airfieldOut') return 'log.scrambleRefusedOut';
      if (e.state === 'noPilots') return 'log.scrambleRefusedNoPilots';
      p.state = t(`states.squadron.${e.state}`).toLowerCase();
      return undefined;
    },
  },
  orderRefused: {
    level: 'warning',
    shape(w, e, p) {
      p.reason = t(`reasons.${e.reason}`);
    },
  },
  legDone: {
    shape(w, e, p) {
      p.next = headingText(e.next);
    },
  },
  legChanged: {
    shape(w, e, p) {
      p.index = e.index + 1;
      p.heading = headingText(e.heading);
    },
  },
  legMissed: { level: 'warning', shape: (w, e) => (e.target ? 'log.legMissedSquare' : undefined) },
  legRefused: { level: 'warning' },
  legsEnded: {
    shape(w, e, p) {
      p.heading = headingText(e.heading);
      return `log.legsEnded.${e.action}`;
    },
  },
  planEnded: {
    shape(w, e, p) {
      // A squadron's end of route, a group's end of legs (legsEnded) say what it does next.
      if (e.unitKind === 'squadron' || e.unitKind === 'escort') return null;
      p.heading = headingText(e.heading);
      return undefined;
    },
  },
  routeEnded: {
    shape(w, e, p) {
      p.action = t(`log.routeEndedActions.${e.action}`);
    },
  },
  bingo: { level: 'warning' },
  divert: { level: 'warning' },
  divertOut: { level: 'warning' },
  outOfAmmo: { level: 'warning' },
  lowFuel: { level: 'warning' },
  noFuel: { level: 'alert' },
  noAmmo: { level: 'warning' },
  fuelExhausted: { level: 'alert' },
  // A patrol does not fight: its sentence says how to rest it, not what it loses in combat,
  // and exhaustion is no alarm for it.
  squadronTired: { level: 'warning', shape: (w, e) => (isPatrolEvent(w, e) ? 'log.patrolTired' : undefined) },
  squadronExhausted: {
    level: 'alert',
    shape: (w, e, p) => (isPatrolEvent(w, e) ? { text: t('log.patrolExhausted', p), level: 'warning' } : undefined),
  },
  rosterApplied: { shape: alertStateShape },
  rosterResumed: { shape: alertStateShape },
  alertReached: { shape: alertStateShape },
  scheduledTakeoff: { shape: (w, e) => (e.late ? 'log.scheduledTakeoffLate' : undefined) },
  scheduleDelayed: {
    shape(w, e, p) {
      const reason = t(`log.delayReasons.${e.reason}`);
      p.reason = reason === `log.delayReasons.${e.reason}` ? e.reason : reason;
    },
  },
  formationCreated: { shape: (w, e) => (e.kind === 'air' ? 'log.formationCreatedAir' : 'log.formationCreatedNaval') },
  formationHomeward: { level: 'warning' },
  formationLeftBy: { shape: (w, e) => `log.formationLeftBy.${e.reason}` },
  formationScrambled: { shape: (w, e) => (e.n <= 1 ? 'log.formationScrambledAlone' : undefined) },
  rallyArmed: {
    shape(w, e, p) {
      p.time = missing(e.at) ? t('rally.asap').toLowerCase() : `${t('orders.at')} ${formatTime(w.startMs + e.at * 1000)}`;
    },
  },
  rallyDeparted: { shape: (w, e) => (e.late ? 'log.rallyDepartedLate' : undefined) },
  rallyDecided: { shape: () => null }, // the departure or the wait says it
};

// ---- the ground: sites, stocks, trains --------------------------------------------------

function siteNameShape(w, e, p) {
  const site = w.sites.get(e.site);
  const name = site ? siteLongName(site) : e.siteName;
  p.target = name.charAt(0).toUpperCase() + name.slice(1);
}

function mruShape(w, e, p) {
  p.time = dateTimeText(w.startMs + (e.readyAt ?? e.t) * 1000);
}

const GROUND = {
  siteHit: {
    level: 'alert',
    shape(w, e, p) {
      const site = w.sites.get(e.site);
      p.target = site ? siteLongName(site) : e.siteName;
      p.severity = t(`severity.${e.severity}`);
    },
  },
  siteOut: { level: 'alert', shape: siteNameShape },
  siteRestored: { level: 'success', shape: siteNameShape },
  groundLosses: { level: 'alert' },
  stocksLost: {
    level: 'warning',
    shape(w, e, p) {
      const parts = [];
      if (e.fuel) parts.push(`${tonnesText(e.fuel)} ${resourceName('fuel')}`);
      if (e.materiel) parts.push(`${tonnesText(e.materiel)} ${resourceName('materiel')}`);
      if (e.aircraft) parts.push(`${e.aircraft} ${resourceName('aircraft')}`);
      p.what = parts.join(', ');
    },
  },
  trainDispatched: {
    level: 'logistics',
    shape(w, e, p) {
      p.what = cargoText(e.cargo);
      p.eta = dateTimeText(e.etaMs);
      return e.auto ? 'log.trainDispatchedAuto' : undefined;
    },
  },
  trainArrived: {
    level: 'logistics',
    shape(w, e, p) {
      p.what = cargoText(e.cargo);
    },
  },
  ferrySent: { level: 'logistics' },
  mruOrdered: { shape: mruShape },
  mruReady: { level: 'success', shape: mruShape },
};

// ---- the game: scenario, objectives, questions ------------------------------------------

function objectiveShape(w, e, p) {
  p.objective = objectiveText(w, w.objectives[e.index]);
}

function questionShape(w, e) {
  return `log.${e.type}.${e.kind}`;
}

const GAME = {
  scenarioStart: {
    shape(w, e) {
      if (e.scenario === 'kanalkampf') return 'log.scenarioStartK';
      if (!e.convoy) return 'log.scenarioStartNoConvoy';
      return e.port ? undefined : 'log.scenarioStartAtSea';
    },
  },
  // An important event opens a page with its text: the journal keeps the title.
  scenarioEvent: { level: 'alert', shape: (w, e) => `events.${e.scenario}.${e.key}.${e.important ? 'title' : 'text'}` },
  scenarioEnd: {
    shape(w, e, p) {
      p.date = formatDate(w.startMs + e.t * 1000, t('days'), t('months'));
      if (e.reason === 'fuel') return 'log.scenarioEndFuel';
      if (e.reason === 'fighters') return 'log.scenarioEndFighters';
      if (e.reason === 'shipping') return 'log.scenarioEndShipping';
      if (w.scenario.defeat) return e.outcome === 'victory' ? 'log.scenarioEndVictory' : 'log.scenarioEndDefeat';
      return undefined;
    },
  },
  // Campaign: the fighters the battle starts with and, when one is asked, the count of enemy
  // aircraft that follows them.
  carryApplied: {
    shape(w, e, p) {
      if (e.down) p.suffix = ` ${t('log.carryDown', { count: e.down, full: e.downFull })}`;
    },
  },
  objectiveDone: { level: 'success', shape: objectiveShape },
  allObjectivesDone: { level: 'success' },
  objectiveFailed: { level: 'alert', shape: objectiveShape },
  // The settings of the game changed on the way (an order of the settings page).
  settingChanged: {
    shape(w, e, p) {
      p.name = t(`settings.${e.key}`);
      const choice = t(`settings.${e.key}Choices.${e.value}`);
      p.value = typeof e.value === 'boolean' ? t(e.value ? 'common.yes' : 'common.no') : choice === `settings.${e.key}Choices.${e.value}` ? String(e.value) : choice;
    },
  },
  presetChanged: {
    shape(w, e, p) {
      p.from = t(`settings.presets.${e.from}`);
      p.to = t(`settings.presets.${e.to}`);
    },
  },
  question: { shape: () => null }, // the banner asks; the answer goes into the journal
  questionYes: { shape: questionShape },
  questionNo: { shape: questionShape },
  questionExpired: { shape: questionShape },
};

/** The families, in the order of a watch report, then those of the air battle and the game. */
export const FAMILIES = {
  attack: ATTACK, uboat: UBOAT, intel: INTEL, escort: ESCORT, convoy: CONVOY, battle: BATTLE, squadron: SQUADRON, ground: GROUND, game: GAME,
};

const BY_TYPE = new Map();
for (const [family, table] of Object.entries(FAMILIES)) {
  for (const [type, entry] of Object.entries(table)) BY_TYPE.set(type, { family, level: entry.level || 'info', shape: entry.shape || null });
}

/** The family of an event type ('attack', 'uboat'… 'game'), or null for one with no entry. */
export function messageFamily(type) {
  return BY_TYPE.get(type)?.family ?? null;
}

// Told once for the whole formation (it takes off, it has gathered): not squadron by squadron.
const WING_QUIET = new Set(['scrambleOrdered', 'airborne', 'formationJoined']);

/** { text, level } for a simulation event, or null when it is not shown in the journal. */
export function eventMessage(world, e) {
  if (WING_QUIET.has(e.type) && e.squadronId && world.squadrons.some((s) => s.id === e.squadronId && s.formation)) return null;
  const entry = BY_TYPE.get(e.type);
  const p = { ...e };
  let key = `log.${e.type}`;
  if (entry && entry.shape) {
    const shaped = entry.shape(world, e, p);
    if (shaped === null) return null;
    if (typeof shaped === 'object') return shaped;
    if (typeof shaped === 'string') key = shaped;
  }
  // An escort group has its own words for what ships of all kinds do.
  if (e.unitKind === 'escort' && t(`${key}Escort`) !== `${key}Escort`) key = `${key}Escort`;
  const text = t(key, p);
  if (text === key || !text) return null;
  return { text: text + (p.suffix || ''), level: entry ? entry.level : 'info' };
}
