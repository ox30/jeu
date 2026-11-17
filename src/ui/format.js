// Turns simulation data and events into the words shown to the player.

import { formatNumber, t } from '../core/i18n.js';
import { formatDate, formatShortDate, formatTime } from '../core/time.js';
import { FOOT_M } from '../sim/geo.js';
import { siteRules, siteStatus } from '../sim/sites.js';
import { cargoShare } from '../sim/convoy.js';
import { basesInService, enemyDown, fighterShare, radarsInService, shipLosses, tonnesDelivered } from '../sim/objectives.js';

/** "30+" for an estimated count (rounded down to 5), the exact number otherwise. */
export function countText(n, approx) {
  if (!approx) return String(n);
  return `${n >= 10 ? Math.floor(n / 5) * 5 : n}+`;
}

export function dateTimeText(ms) {
  return t('common.dateAt', { date: formatShortDate(ms, t('months')), time: formatTime(ms) });
}

export function gameTimeText(world, gameT) {
  return formatTime(world.startMs + gameT * 1000);
}

/** "18 000 ft" (rounded to 100 ft). */
export function ftText(ft) {
  return t('units.ft', { n: formatNumber(Math.round(ft / 100) * 100) });
}

export function altitudeText(altM) {
  return ftText(altM / FOOT_M);
}

/** "+7 000 ft" / "−3 000 ft" (rounded to 500 ft). */
export function relFtText(dFt) {
  const n = Math.round(Math.abs(dFt) / 500) * 500;
  return t('units.ftRel', { sign: n === 0 ? '±' : dFt > 0 ? '+' : '−', n: formatNumber(n) });
}

/** "6 min", "1 h 30", "30 h", "2 j 4 h". */
export function durationText(seconds) {
  const total = Math.max(0, Math.round(seconds / 60));
  if (total < 60) return t('units.min', { n: Math.max(total, seconds > 0 ? 1 : 0) });
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d >= 2) return t('units.dhmin', { d, h });
  const hours = d * 24 + h;
  if (!m || hours >= 10) return t('units.h', { h: hours });
  return t('units.hmin', { h: hours, m: String(m).padStart(2, '0') });
}

function dm(value) {
  const v = Math.abs(value);
  let deg = Math.floor(v);
  let min = Math.round((v - deg) * 60);
  if (min === 60) {
    deg += 1;
    min = 0;
  }
  return `${deg}°${String(min).padStart(2, '0')}′`;
}

/** "56°30′ N 12°00′ O". */
export function positionText(lat, lon) {
  return `${dm(lat)} ${lat < 0 ? 'S' : 'N'} ${dm(lon)} ${lon < 0 ? 'O' : 'E'}`;
}

export function placeText(loc) {
  if (!loc) return t('place.unknown');
  if (!loc.place) return loc.grid ? t('place.gridOnly', { grid: loc.grid }) : t('place.unknown');
  const of = loc.of || t('place.of', { place: loc.place });
  const where = loc.km ? t('place.near', { km: loc.km, dir: t('place.directions')[loc.dir], of }) : t('place.over', { of });
  return loc.grid ? t('place.grid', { where, grid: loc.grid }) : where;
}

export function headingText(h) {
  return `${String(Math.round(h) % 360).padStart(3, '0')}°`;
}

export function kmText(km) {
  return t('units.km', { n: formatNumber(km, km < 10 ? 1 : 0) });
}

/** "Cap 170° pendant 6 min", "Cap 155° jusqu'en J5", … */
export function legText(world, leg) {
  const heading = headingText(leg.heading);
  const end = leg.end;
  let text;
  if (!end) text = t('legs.open', { heading });
  else if (end.kind === 'duration') text = t('legs.duration', { heading, d: durationText(end.s) });
  else if (end.kind === 'time') text = t('legs.time', { heading, time: dateTimeText(world.startMs + end.t * 1000) });
  else if (end.kind === 'square') text = t('legs.square', { heading, ref: end.ref });
  else text = t('legs.position', { heading, pos: positionText(end.lat, end.lon) });
  if (leg.speedKn) text += t('legs.speed', { n: leg.speedKn });
  if (leg.altFt) text += t('legs.alt', { alt: ftText(leg.altFt) });
  return text;
}

/** The end of a leg written back as the player would type it (to change the leg). */
export function legEndInput(world, leg, sea) {
  const end = leg.end;
  if (!end) return '';
  if (end.kind === 'duration') {
    if (sea) return end.s % 3600 === 0 ? String(end.s / 3600) : `${Math.round(end.s / 60)} min`;
    return end.s % 60 === 0 ? String(end.s / 60) : `${formatNumber(end.s / 60, 1)}`;
  }
  if (end.kind === 'time') {
    const d = new Date(world.startMs + end.t * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (end.kind === 'square') return end.ref;
  const lat = `${Math.abs(end.lat).toFixed(2).replace(/\.?0+$/, '')}${end.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(end.lon).toFixed(2).replace(/\.?0+$/, '')}${end.lon >= 0 ? 'E' : 'O'}`;
  return `${lat} ${lon}`;
}

/** Name of an end action for the menu of the sheet. */
export function endActionText(world, a) {
  if (a.kind === 'land') return t('orders.endLand', { airfield: world.byId.airfield.get(a.id)?.name || '' });
  if (a.kind === 'cover') return t('orders.endCover', { convoy: world.convoys.find((c) => c.id === a.id)?.name || '' });
  return t(`orders.end.${a.kind}`);
}

// ---- installations ----------------------------------------------------------------

export function siteLongName(site) {
  if (site.longName) return site.longName;
  return t(`sites.longName.${site.kind}`, { of: site.of || t('place.of', { place: site.name }) });
}

export function siteTitle(site) {
  // "Aérodrome de Aldergrove" → "Aérodrome d'Aldergrove".
  return t(`sheet.${site.kind}Title`, { name: site.name }).replace(/\b([dD])e ([AEIOUYÉÈÊaeiouyéèê])/g, "$1'$2");
}

export function siteStatusText(world, site) {
  const status = siteStatus(world, site);
  return t(`sites.statusDamage.${status}`, { n: Math.round(site.damage) });
}

/** Effect of the damage on the installation, or null when intact. */
export function siteEffectText(world, site) {
  const status = siteStatus(world, site);
  if (status === 'intact') return null;
  const out = status === 'out';
  switch (site.kind) {
    case 'airfield':
      return out ? t('sites.effects.airfieldOut') : t('sites.effects.airfieldDamaged', { f: formatNumber(1 + site.damage / 50, 1) });
    case 'radar':
      return out ? t('sites.effects.radarOut') : t('sites.effects.radarDamaged', { n: Math.round((1 - site.damage / 120) * 100) });
    case 'port':
      if (site.naval) return out ? t('sites.effects.navalOut') : t('sites.effects.navalDamaged');
      return out ? t('sites.effects.portOut') : t('sites.effects.portDamaged');
    default:
      return out ? t('sites.effects.factoryOut') : t('sites.effects.factoryDamaged');
  }
}

/** When the installation will be back in service, and fully repaired. */
export function siteRepairText(world, site) {
  if (site.damage <= 0) return null;
  const R = siteRules(world, site);
  const parts = [];
  if (site.damage >= R.outAt) parts.push(t('sites.repairIn', { d: durationText(((site.damage - R.outAt + 0.5) / R.repairPerHour) * 3600) }));
  parts.push(t('sites.repairedIn', { d: durationText((site.damage / R.repairPerHour) * 3600) }));
  return parts.join(' · ');
}

export function tonnesText(n) {
  return t('logistics.tonnes', { n: formatNumber(Math.round(n)) });
}

export function resourceName(res) {
  return t(`resources.${res}`);
}

/** "50 t de carburant et 60 t de matériel" */
export function cargoText(cargo) {
  const parts = Object.entries(cargo || {}).filter(([, n]) => n >= 0.5)
    .map(([res, n]) => t('logistics.cargoPart', { n: formatNumber(Math.round(n)), resource: resourceName(res) }));
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} ${t('logistics.and')} ${parts[parts.length - 1]}`;
}

export function objectiveText(world, o) {
  const c = o.convoy ? world.convoys.find((convoy) => convoy.id === o.convoy) : null;
  switch (o.type) {
    case 'convoyArrived':
      return t('objectives.convoyArrived', { convoy: c ? c.name : o.convoy });
    case 'raidsIntercepted':
      return t('objectives.raidsIntercepted', { count: o.count });
    case 'convoyDelivered': {
      const share = Math.round(cargoShare(c, world) * 100);
      const state = c.state === 'lost'
        ? t('objectives.stateLost')
        : c.state === 'arrived' ? t('objectives.stateDelivered', { n: share }) : t('objectives.stateAfloat', { n: share });
      const key = c.type === 'coastal' ? 'objectives.convoyDeliveredCoastal' : 'objectives.convoyDelivered';
      return t(key, { convoy: c.name, share: Math.round(o.share * 100), state });
    }
    case 'basesOperational':
      return t('objectives.basesOperational', { min: o.min, total: o.airfields.length, n: basesInService(world, o) });
    case 'fighterStrength':
      return t('objectives.fighterStrength', { share: Math.round(o.share * 100), n: Math.round(fighterShare(world) * 100) });
    case 'radarsOperational':
      return t('objectives.radarsOperational', { min: o.min, total: o.radars.length, n: radarsInService(world, o) });
    case 'enemyDown':
      return t('objectives.enemyDown', { count: o.count, n: enemyDown(world) });
    case 'siteDamageBelow': {
      const site = world.sites.get(o.site);
      return t('objectives.siteDamageBelow', { site: site ? site.longName || site.name : o.site, max: o.max, n: site ? Math.round(site.damage) : 0 });
    }
    case 'tonnageDelivered': {
      const d = tonnesDelivered(world);
      return t('objectives.tonnageDelivered', {
        fuel: formatNumber(o.fuel || 0), materiel: formatNumber(o.materiel || 0), nf: formatNumber(Math.round(d.fuel)), nm: formatNumber(Math.round(d.materiel)),
      });
    }
    case 'shipLossesBelow': {
      const l = shipLosses(world);
      return t('objectives.shipLossesBelow', { share: Math.round(o.share * 100), n: Math.round(l.share * 1000) / 10, sunk: l.sunk, sailed: l.sailed });
    }
    default:
      return t(`objectives.${o.type}`, o);
  }
}

// ---- journal --------------------------------------------------------------------

const LEVELS = {
  raidDetected: 'alert',
  siteHit: 'alert',
  siteOut: 'alert',
  groundLosses: 'alert',
  squadronLost: 'alert',
  fuelExhausted: 'alert',
  convoyRouteRejected: 'warning',
  convoyStopped: 'warning',
  scrambleRefused: 'warning',
  orderRefused: 'warning',
  legMissed: 'warning',
  legRefused: 'warning',
  bingo: 'warning',
  divert: 'warning',
  divertOut: 'warning',
  outOfAmmo: 'warning',
  missed: 'warning',
  interceptRefused: 'warning',
  interceptEnded: 'warning',
  contactLost: 'info',
  formationHomeward: 'warning',
  tallyHo: 'combat',
  combatRound: 'combat',
  combatReport: 'report',
  raidReport: 'report',
  raidRepelled: 'success',
  raidDestroyed: 'success',
  convoyArrived: 'success',
  siteRestored: 'success',
  objectiveDone: 'success',
  allObjectivesDone: 'success',
  objectiveFailed: 'alert',
  lowFuel: 'warning',
  noFuel: 'alert',
  noAmmo: 'warning',
  squadronTired: 'warning',
  squadronExhausted: 'alert',
  stocksLost: 'warning',
  shipsSunk: 'alert',
  convoyLost: 'alert',
  convoyBombed: 'alert',
  uboatAttack: 'alert',
  uboatSunk: 'success',
  uboatSighted: 'warning',
  scenarioEvent: 'alert',
  mruReady: 'success',
  straggler: 'warning',
  uboatDrivenOff: 'success',
  convoySighted: 'warning',
  dfFix: 'info',
  escortLowFuel: 'warning',
  escortJoined: 'success',
  convoyUnloaded: 'success',
  trainArrived: 'logistics',
  trainDispatched: 'logistics',
  ferrySent: 'logistics',
  aircraftDelivered: 'logistics',
};

function typeName(world, type) {
  return type || '';
}

export function reportText(world, e) {
  const claims = [];
  if (e.bombersDown) claims.push(`${e.bombersDown} ${typeName(world, e.bomberType)}`);
  if (e.fightersDown) claims.push(`${e.fightersDown} ${typeName(world, e.escortType)}`);
  return t('log.combatReport', {
    squadron: e.squadron,
    raid: e.raid,
    from: gameTimeText(world, e.startT),
    to: gameTimeText(world, e.endT),
    height: e.above ? t('log.report.above') : t('log.report.level'),
    claims: claims.length ? t('log.report.claims', { list: claims.join(t('common.and')) }) : t('log.report.noClaims'),
    losses: e.losses ? t('log.report.losses', { n: e.losses, type: typeName(world, e.aircraftType) }) : t('log.report.noLosses'),
    outcome: t(`log.report.outcome.${e.outcome}`),
  });
}

/** { text, level } for a simulation event, or null when it is not shown in the journal. */
// Told once for the whole formation (it takes off, it has gathered): not squadron by squadron.
const WING_QUIET = new Set(['scrambleOrdered', 'airborne', 'formationJoined']);

export function eventMessage(world, e) {
  if (WING_QUIET.has(e.type) && e.squadronId && world.squadrons.some((s) => s.id === e.squadronId && s.formation)) return null;
  const p = { ...e };
  let key = `log.${e.type}`;
  let suffix = '';
  switch (e.type) {
    case 'scenarioStart':
      if (e.scenario === 'kanalkampf') key = 'log.scenarioStartK';
      else if (!e.convoy) key = 'log.scenarioStartNoConvoy';
      else if (!e.port) key = 'log.scenarioStartAtSea';
      break;
    case 'trainDispatched':
      if (e.auto) key = 'log.trainDispatchedAuto';
      p.what = cargoText(e.cargo);
      p.eta = dateTimeText(e.etaMs);
      break;
    case 'trainArrived':
      p.what = cargoText(e.cargo);
      break;
    case 'stocksLost': {
      const parts = [];
      if (e.fuel) parts.push(`${tonnesText(e.fuel)} ${resourceName('fuel')}`);
      if (e.materiel) parts.push(`${tonnesText(e.materiel)} ${resourceName('materiel')}`);
      if (e.aircraft) parts.push(`${e.aircraft} ${resourceName('aircraft')}`);
      p.what = parts.join(', ');
      break;
    }
    case 'convoyArrived':
      if (e.fuel || e.materiel) key = 'log.convoyArrivedCargo';
      break;
    case 'shipsSunk':
      key = `log.shipsSunk.${e.cause}`;
      break;
    case 'convoyBombed':
      if (!e.sunk) key = 'log.convoyBombedNone';
      else return null; // the losses are told by shipsSunk
      break;
    case 'uboatAttack':
      if (!e.sunk) key = 'log.uboatAttackMiss';
      break;
    case 'dfFix':
      p.pos = positionText(e.lat, e.lon);
      break;
    case 'objectiveFailed':
      p.objective = objectiveText(world, world.objectives[e.index]);
      break;
    case 'convoyRouted':
      if (!e.destination) key = 'log.convoyRoutedOpen';
      p.eta = dateTimeText(e.etaMs);
      break;
    case 'raidDetected':
      p.count = countText(e.count, e.approx);
      p.where = placeText(e.location);
      p.alt = ftText(e.altFt);
      break;
    case 'observersTracking':
      p.where = placeText(e.location);
      break;
    case 'tallyHo':
      if (e.above) key = 'log.tallyHoAbove';
      break;
    case 'combatReport':
      return { text: reportText(world, e), level: 'report' };
    case 'missed':
      key = `log.missed.${e.problem}`;
      p.km = formatNumber(Math.max(1, Math.round(e.km)));
      p.dir = t('place.directions')[e.dir];
      p.ft = ftText(Math.round(Math.abs(e.dzM / FOOT_M) / 500) * 500);
      if (e.guided !== null && e.guided !== undefined) suffix = t('log.missedGuided', { p: Math.round(e.guided * 100) });
      break;
    case 'uboatSunk':
      if (e.by) key = 'log.uboatSunkBy';
      break;
    case 'uboatSighted':
      p.source = t(`map.uSource.${e.source}`);
      break;
    case 'raidSighted': {
      const parts = [];
      if (e.bombers > 0) parts.push(`${e.bombers} ${e.bomberType}`);
      if (e.escort > 0) parts.push(`${e.escort} ${e.escortType}`);
      p.force = parts.join(' + ');
      p.alt = ftText(e.altFt);
      break;
    }
    case 'uboatContactLost':
      p.time = formatTime(world.startMs + e.t * 1000);
      break;
    case 'escortHuntOver':
      if (e.sank) key = 'log.escortHuntOverSank';
      break;
    case 'straggler':
      p.kind = e.tanker ? t('log.stragglerTanker') : t('log.stragglerFreighter');
      break;
    case 'scenarioEvent':
      // An important event opens a page with its text: the journal keeps the title.
      key = `events.${e.scenario}.${e.key}.${e.important ? 'title' : 'text'}`;
      break;
    case 'convoyDeparted':
      if (e.lendLease) key = 'log.convoyDepartedLendLease';
      else if (e.share <= 0) key = 'log.convoyDepartedBallast';
      p.fuel = formatNumber(e.fuel);
      p.materiel = formatNumber(e.materiel);
      break;
    case 'offerBought':
      p.offer = t(`offers.${e.offerId}`);
      p.date = formatShortDate(world.startMs + e.readyAt * 1000, t('months'));
      break;
    case 'mruOrdered':
    case 'mruReady':
      p.time = dateTimeText(world.startMs + (e.readyAt ?? e.t) * 1000);
      break;
    case 'raidReport':
      p.outcome = t(`reports.outcome.${e.outcome}`).toLowerCase();
      break;
    case 'interceptOrdered':
      p.p = Math.round(e.p * 100);
      break;
    case 'interceptEnded':
      key = `log.interceptEndedReasons.${e.reason}`;
      break;
    case 'scrambleRefused':
      if (e.state === 'airfieldOut') key = 'log.scrambleRefusedOut';
      else if (e.state === 'resting') key = 'log.scrambleRefusedResting';
      else if (e.state === 'noPilots') key = 'log.scrambleRefusedNoPilots';
      else p.state = t(`states.squadron.${e.state}`).toLowerCase();
      break;
    case 'combatRound':
      p.bombers = e.bombersDown;
      p.fighters = e.fightersDown;
      if (e.killed) suffix = t('log.pilotsKilled', { n: e.killed });
      break;
    case 'orderRefused':
      p.reason = t(`reasons.${e.reason}`);
      break;
    case 'siteHit': {
      const site = world.sites.get(e.site);
      p.target = site ? siteLongName(site) : e.siteName;
      p.severity = t(`severity.${e.severity}`);
      break;
    }
    case 'siteOut':
    case 'siteRestored': {
      const site = world.sites.get(e.site);
      const name = site ? siteLongName(site) : e.siteName;
      p.target = name.charAt(0).toUpperCase() + name.slice(1);
      break;
    }
    case 'legDone':
      p.next = headingText(e.next);
      break;
    case 'formationCreated':
      key = e.kind === 'air' ? 'log.formationCreatedAir' : 'log.formationCreatedNaval';
      break;
    case 'formationLeftBy':
      key = `log.formationLeftBy.${e.reason}`;
      break;
    case 'formationScrambled':
      if (e.n <= 1) key = 'log.formationScrambledAlone';
      break;
    case 'legMissed':
      if (e.target) key = 'log.legMissedSquare';
      break;
    case 'planEnded':
      if (e.unitKind === 'squadron') return null; // the end of the route says what it does next
      p.heading = headingText(e.heading);
      break;
    case 'routeEnded':
      p.action = t(`log.routeEndedActions.${e.action}`);
      break;
    case 'legChanged':
      p.index = e.index + 1;
      p.heading = headingText(e.heading);
      break;
    case 'objectiveDone':
      p.objective = objectiveText(world, world.objectives[e.index]);
      break;
    case 'scenarioEnd':
      p.date = formatDate(world.startMs + e.t * 1000, t('days'), t('months'));
      if (e.reason === 'fuel') key = 'log.scenarioEndFuel';
      else if (e.reason === 'fighters') key = 'log.scenarioEndFighters';
      else if (e.reason === 'shipping') key = 'log.scenarioEndShipping';
      else if (world.scenario.defeat) key = e.outcome === 'victory' ? 'log.scenarioEndVictory' : 'log.scenarioEndDefeat';
      break;
    default:
  }
  if (e.unitKind === 'escort' && t(`${key}Escort`) !== `${key}Escort`) key = `${key}Escort`;
  const text = t(key, p);
  if (text === key || !text) return null;
  return { text: text + suffix, level: LEVELS[e.type] || 'info' };
}
