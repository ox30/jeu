// What the player can do, shared by the mouse, the keyboard and the side panel.

import { t } from '../core/i18n.js';
import { bearing, distance, simplifyPolyline } from '../sim/geo.js';
import { contactEstimate } from '../sim/query.js';
import {
  addLeg, clearPlan, departConvoy, editShipRoute, editableRoute, escortHome, joinConvoy, leaveConvoy, removeLeg, removeRoutePoint, returnToBase, routeCanExtend, routeConvoy, scramble, sendTrain, setAltitude, setCover, setEndAction, setMinStock, setOrbit, setPointAltitude, setRoute, setSpeed, setVector, updateLeg, interceptRaid, setAlert, setConvoySpeed, setEscortBehaviour, setZigzag, followSquadron, leaveFormation,
} from '../sim/orders.js';
import { buyOffer, setPurchase } from '../sim/shipping.js';
import { feetOf, squadronSpeed } from '../sim/squadron.js';
import { currentSpeed, legSpeed } from '../sim/convoy.js';
import { parseLegEnd } from '../sim/navigation.js';
import { deployMru } from '../sim/mru.js';
import { VIEWS, animateTo, toWorld, viewFrame } from '../render/camera.js';
import { addLogEntry } from './panels.js';

export const SPEEDS = [1, 10, 60, 600, 3600, 14400];

export function findUnit(app, kind, id) {
  const w = app.world;
  if (kind === 'squadron') return w.squadrons.find((s) => s.id === id);
  if (kind === 'convoy') return w.convoys.find((c) => c.id === id);
  if (kind === 'raid') return w.raids.find((r) => r.id === id);
  if (kind === 'site') return w.sites.get(id);
  if (kind === 'airfield') return w.byId.airfield.get(id);
  if (kind === 'escort') return w.escorts.find((e) => e.id === id);
  if (kind === 'train') return w.trains.find((tr) => tr.id === id);
  if (kind === 'uplot') return w.uboatPlots.find((p) => p.id === id);
  return null;
}

export function select(app, kind, id) {
  if (kind === 'airfield') {
    kind = 'site';
    id = `airfield:${id}`;
  }
  const same = app.selection && kind && app.selection.kind === kind && app.selection.id === id;
  if (!same) {
    app.activePoint = null;
    app.editingLeg = null;
  }
  app.selection = kind ? { kind, id } : null;
  app.dirtyPanels = true;
}

export function selectedUnit(app) {
  const sel = app.selection;
  if (!sel || (sel.kind !== 'squadron' && sel.kind !== 'convoy' && sel.kind !== 'escort')) return null;
  return findUnit(app, sel.kind, sel.id);
}

export function selectedSquadron(app) {
  return app.selection && app.selection.kind === 'squadron' ? findUnit(app, 'squadron', app.selection.id) : null;
}

export function headingsMode(app) {
  return app.settings.orders === 'headings';
}

/** A short message shown in the unit sheet (refused orders, typing mistakes). */
export function sheetMessage(app, text, level = 'warning') {
  app.sheetMessage = { text, level, until: performance.now() + 6000 };
  app.dirtyPanels = true;
}

export function setSpeedIndex(app, index) {
  app.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, index))];
  app.paused = false;
  app.speedConfirm = null;
  app.dirtyHud = true;
}

/** Above these speeds, the player is asked first while the enemy is acting. */
export const SPEED_CHECK = { air: 60, naval: 600 };
const NAVAL_ACTION_S = 3 * 3600; // a convoy attacked within these 3 hours: the battle goes on

/**
 * What the enemy is doing that the player can see: 'air' (a raid on the plot, a combat),
 * 'naval' (a convoy attacked within the last hours) or null.
 */
export function enemyAction(app) {
  const w = app.world;
  for (const c of w.contacts.values()) if (!c.lost) return 'air';
  if (w.squadrons.some((s) => s.state === 'combat')) return 'air';
  if (app.lastNavalAttack !== null && app.lastNavalAttack !== undefined && w.t - app.lastNavalAttack < NAVAL_ACTION_S) return 'naval';
  return null;
}

/**
 * A speed asked for by the player (button or key). During an enemy action a high speed is
 * asked first, against a slip of the finger (×14 400 instead of ×10 during a raid).
 */
export function requestSpeed(app, index) {
  const i = Math.max(0, Math.min(SPEEDS.length - 1, index));
  const speed = SPEEDS[i];
  const action = app.settings.confirmSpeed === false ? null : enemyAction(app);
  const faster = app.paused || speed > app.speed;
  if (action && faster && speed > SPEED_CHECK[action]) {
    app.speedConfirm = { index: i, action };
    app.dirtyHud = true;
    return false;
  }
  setSpeedIndex(app, i);
  return true;
}

export function confirmSpeed(app) {
  if (app.speedConfirm) setSpeedIndex(app, app.speedConfirm.index);
}

export function cancelSpeed(app) {
  app.speedConfirm = null;
  app.dirtyHud = true;
}

export function togglePause(app) {
  app.paused = !app.paused;
  app.accumulator = 0;
  app.dirtyHud = true;
}

export function goView(app, name) {
  animateTo(app.camera, viewFrame(app.camera, VIEWS[name]));
}

/** Centres the map on a unit, zooming in when the map is far out. */
export function centreOn(app, x, y, minScale = 0) {
  const cam = app.camera;
  animateTo(cam, { cx: x, cy: y, scale: Math.max(cam.scale, minScale) }, 0.6);
}

/** Speed of a unit in km/s, for the ruler and the legs. */
export function unitSpeed(app, u) {
  if (u.kind === 'squadron') return squadronSpeed(app.world, u);
  if (u.kind === 'convoy' || u.kind === 'escort') return u.plan.length ? legSpeed(u, u.plan[u.plan.length - 1]) : currentSpeed(u);
  return 0;
}

function nearestContactHeading(app, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const contact of app.world.contacts.values()) {
    const est = contactEstimate(app.world, contact);
    if (!est) continue;
    const d = Math.hypot(est.x - x, est.y - y);
    if (d < bestD) {
      bestD = d;
      best = est;
    }
  }
  return best ? bearing(x, y, best.x, best.y) : null;
}

/**
 * Scramble from the panel or the keyboard. With legs ready they are flown; otherwise the
 * heading typed in the sheet; otherwise (tracé mode) toward the nearest raid; otherwise a
 * patrol over the base.
 */
export function scrambleSquadron(app, sq) {
  const input = document.getElementById('vector-input');
  const typed = input && input.value !== '' ? Number(input.value) : null;
  let order;
  if (sq.plan.length) order = {};
  else if (typed !== null && typed >= 0 && typed <= 360) order = { vector: typed % 360 };
  else if (!headingsMode(app)) {
    const heading = nearestContactHeading(app, sq.x, sq.y);
    order = heading === null ? { orbit: true } : { vector: heading };
  } else order = { orbit: true };
  scramble(app.world, sq, order);
  select(app, 'squadron', sq.id);
}

export function changeAltitude(app, sq, deltaFt) {
  setAltitude(app.world, sq, Math.round(feetOf(sq.targetAlt) / 1000) * 1000 + deltaFt);
  app.dirtyPanels = true;
}

export function toggleBuster(app, sq) {
  setSpeed(app.world, sq, sq.speedMode === 'max' ? 'cruise' : 'max');
  app.dirtyPanels = true;
}

export function orderVector(app, sq, heading) {
  if (Number.isFinite(heading)) setVector(app.world, sq, heading);
  app.dirtyPanels = true;
}

export function orderOrbit(app, sq) {
  setOrbit(app.world, sq);
  app.dirtyPanels = true;
}

export function orderCover(app, sq, convoyId) {
  setCover(app.world, sq, convoyId);
  app.dirtyPanels = true;
}

/** Big wing: fly with another squadron. */
export function orderFollow(app, sq, leaderId) {
  if (!followSquadron(app.world, sq, leaderId)) sheetMessage(app, t('orders.followRefused'));
  app.dirtyPanels = true;
}

export function orderLeaveFormation(app, sq) {
  leaveFormation(app.world, sq);
  app.dirtyPanels = true;
}

/** Atlantic 1941: share of each convoy's cargo bought with dollars. */
export function orderPurchase(app, share) {
  setPurchase(app.world, share);
  app.dirtyPanels = true;
}

export function orderOffer(app, offerId) {
  if (!buyOffer(app.world, offerId)) sheetMessage(app, t('offers.refused'));
  app.dirtyPanels = true;
}

export function orderHome(app, sq) {
  returnToBase(app.world, sq);
  app.dirtyPanels = true;
}

export function orderAdmiraltyRoute(app, convoy) {
  const route = convoy.admiraltyRoute;
  // From a convoy at sea, the route starts at the nearest point ahead.
  let from = 1;
  if (convoy.state !== 'inPort') {
    let best = Infinity;
    route.forEach(([x, y], i) => {
      const d = distance(convoy.x, convoy.y, x, y);
      if (d < best) {
        best = d;
        from = Math.min(route.length - 1, i + 1);
      }
    });
  }
  const result = routeConvoy(app.world, convoy, route.slice(from));
  if (!result.ok && result.at) app.flash = { x: result.at[0], y: result.at[1], until: performance.now() + 2500 };
  app.dirtyPanels = true;
}

export function orderSail(app, convoy) {
  departConvoy(app.world, convoy);
  app.dirtyPanels = true;
}

export function orderJoin(app, escort, convoyId) {
  joinConvoy(app.world, escort, convoyId);
  app.dirtyPanels = true;
}

export function orderLeave(app, escort) {
  leaveConvoy(app.world, escort);
  app.dirtyPanels = true;
}

export function orderEscortHome(app, escort) {
  escortHome(app.world, escort);
  app.dirtyPanels = true;
}

/** A train with the tonnes typed in the sheet ({ fuel: t, materiel: t }). */
export function orderTrain(app, fromKey, toKey, loads) {
  app.lastTrainLoads = { ...loads };
  app.lastTrainTo = toKey;
  const result = sendTrain(app.world, fromKey, toKey, loads);
  if (!result.ok) sheetMessage(app, t(`logistics.errors.${result.reason}`));
  app.dirtyPanels = true;
  return result.ok;
}

export function orderMinStock(app, site, resource, text) {
  const value = text === '' ? null : Number(text);
  setMinStock(app.world, site, resource, value);
  app.dirtyPanels = true;
}

function legError(app, result) {
  if (result.ok) return;
  if (result.at) app.flash = { x: result.at[0], y: result.at[1], until: performance.now() + 2500 };
  sheetMessage(app, t(`orders.errors.${result.reason || result.error}`));
}

/** The leg being changed in the sheet of this unit, or null. */
export function editingLegIndex(app, u) {
  const e = app.editingLeg;
  if (!e || !u || e.kind !== u.kind || e.id !== u.id || e.index >= u.plan.length) return null;
  return e.index;
}

export function startEditLeg(app, u, index) {
  app.editingLeg = index >= 0 && index < u.plan.length ? { kind: u.kind, id: u.id, index } : null;
  app.dirtyPanels = true;
}

export function cancelEditLeg(app) {
  app.editingLeg = null;
  app.dirtyPanels = true;
}

/**
 * A leg typed in the sheet: heading, end (free text), for ships a speed, for squadrons an
 * altitude. When a leg is being changed, it replaces that leg.
 */
export function addTypedLeg(app, u, headingText, endText, speedText = '', altText = '') {
  const heading = Number(String(headingText).replace(',', '.'));
  if (headingText === '' || !Number.isFinite(heading) || heading < 0 || heading > 360) {
    sheetMessage(app, t('orders.errors.heading'));
    return false;
  }
  const parsed = parseLegEnd(endText, {
    grid: app.world.grid,
    defaultUnit: u.kind === 'squadron' ? 'min' : 'h',
  });
  if (!parsed.ok) {
    sheetMessage(app, t(`orders.errors.${parsed.error}`));
    return false;
  }
  const speedKn = speedText !== '' && Number(speedText) > 0 ? Number(speedText) : null;
  const altFt = altText !== '' && Number(altText) > 0 ? Number(altText) : null;
  const leg = { heading: heading % 360, end: parsed.end, speedKn, altFt };
  const editing = editingLegIndex(app, u);
  const result = editing === null ? addLeg(app.world, u, leg) : updateLeg(app.world, u, editing, leg);
  legError(app, result);
  if (result.ok) app.editingLeg = null;
  app.dirtyPanels = true;
  return result.ok;
}

/** The heading and length measured with the ruler become a leg "heading for a duration". */
export function addRulerLeg(app, u) {
  const r = app.ruler;
  if (!r || distance(r.a[0], r.a[1], r.b[0], r.b[1]) < 0.2) {
    sheetMessage(app, t('orders.errors.noRuler'));
    return false;
  }
  const km = distance(r.a[0], r.a[1], r.b[0], r.b[1]);
  const v = unitSpeed(app, u);
  const step = u.kind === 'squadron' ? 10 : 60;
  const s = Math.max(step, Math.round(km / v / step) * step);
  const result = addLeg(app.world, u, { heading: bearing(r.a[0], r.a[1], r.b[0], r.b[1]), end: { kind: 'duration', s } });
  legError(app, result);
  if (result.ok) app.ruler = null;
  app.dirtyPanels = true;
  return result.ok;
}

export function orderRemoveLeg(app, u, index) {
  removeLeg(app.world, u, index);
  app.dirtyPanels = true;
}

export function orderClearPlan(app, u) {
  clearPlan(app.world, u);
  app.dirtyPanels = true;
}

/** A line drawn on the map from a unit becomes its route. */
export function finishDrawing(app, hit, screenPoints, endHit = null) {
  const cam = app.camera;
  const world = app.world;
  // Arcade: a line drawn from a squadron (or its aerodrome) onto a raid asks the controller
  // to guide it there.
  if (endHit && endHit.kind === 'raid' && world.settings.interceptAid === 'auto' && (hit.kind === 'squadron' || hit.kind === 'airfield')) {
    let sq = hit.kind === 'squadron' ? findUnit(app, 'squadron', hit.id) : null;
    if (hit.kind === 'airfield') {
      const selected = selectedSquadron(app);
      sq = (selected && selected.airfield === hit.id && selected.state === 'ready' ? selected : null)
        || world.squadrons.find((s) => s.airfield === hit.id && s.state === 'ready');
    }
    if (sq) {
      orderIntercept(app, sq, endHit.id);
      return;
    }
  }
  const simplified = simplifyPolyline(screenPoints, 3);
  const points = simplified.slice(1).map(([sx, sy]) => toWorld(cam, sx, sy));
  if (!points.length) return;

  if (hit.kind === 'squadron') {
    const sq = findUnit(app, 'squadron', hit.id);
    if (sq && setRoute(world, sq, points)) select(app, 'squadron', sq.id);
  } else if (hit.kind === 'airfield') {
    // The selected squadron if it is on this field, otherwise the first one ready, otherwise
    // one already taking off (it simply gets the new route).
    const field = findUnit(app, 'airfield', hit.id);
    const here = world.squadrons.filter((s) => s.airfield === field.id && (s.state === 'ready' || s.state === 'scrambling'));
    const selected = selectedSquadron(app);
    const sq = (selected && here.includes(selected) ? selected : null)
      || here.find((s) => s.state === 'ready')
      || here.find((s) => s.state === 'scrambling');
    if (!sq) {
      addLogEntry(app, t('log.noReadySquadron', { airfield: field.name }), 'warning');
      return;
    }
    if (sq.state === 'ready') scramble(world, sq, { route: points });
    else setRoute(world, sq, points);
    select(app, 'squadron', sq.id);
  } else if (hit.kind === 'convoy' || hit.kind === 'escort') {
    const ship = findUnit(app, hit.kind, hit.id);
    const result = routeConvoy(world, ship, points);
    if (!result.ok && result.at) app.flash = { x: result.at[0], y: result.at[1], until: performance.now() + 2500 };
    select(app, hit.kind, ship.id);
  }
  app.dirtyPanels = true;
}

// ---- route editing -----------------------------------------------------------------

/** The point of the selected unit's route picked with the mouse: { u, index, point } or null. */
export function activePoint(app) {
  const a = app.activePoint;
  const u = selectedUnit(app);
  if (!a || !u || a.kind !== u.kind || a.id !== u.id) return null;
  const pts = editableRoute(u);
  if (!pts || a.index >= pts.length) return null;
  return { u, index: a.index, point: pts[a.index] };
}

export function setActivePoint(app, u, index) {
  app.activePoint = u && index !== null ? { kind: u.kind, id: u.id, index } : null;
  app.dirtyPanels = true;
}

/** Gives the unit its edited route; ships are checked against the coast. */
function applyRouteEdit(app, u, points) {
  let ok;
  if (u.kind === 'squadron') ok = setRoute(app.world, u, points);
  else {
    const result = editShipRoute(app.world, u, points);
    if (!result.ok && result.at) app.flash = { x: result.at[0], y: result.at[1], until: performance.now() + 2500 };
    ok = result.ok;
  }
  app.dirtyPanels = true;
  return ok;
}

function routeCopy(u) {
  return (editableRoute(u) || []).map((p) => [p[0], p[1], p[2] ?? null]);
}

export function movePoint(app, u, index, x, y) {
  const pts = routeCopy(u);
  if (index < 0 || index >= pts.length) return false;
  pts[index][0] = x;
  pts[index][1] = y;
  return applyRouteEdit(app, u, pts);
}

export function insertPoint(app, u, index, x, y) {
  const pts = routeCopy(u);
  if (index < 0 || index > pts.length) return false;
  pts.splice(index, 0, [x, y, null]);
  const ok = applyRouteEdit(app, u, pts);
  if (ok) setActivePoint(app, u, index);
  return ok;
}

export function deletePoint(app, u, index) {
  if (u.kind === 'squadron') {
    removeRoutePoint(app.world, u, index);
  } else {
    const pts = routeCopy(u);
    if (index < 0 || index >= pts.length) return false;
    if (pts.length === 1 && !u.destination) {
      sheetMessage(app, t('orders.errors.lastPoint'));
      return false;
    }
    pts.splice(index, 1);
    if (!applyRouteEdit(app, u, pts)) return false;
  }
  setActivePoint(app, null, null);
  return true;
}

/** A line drawn from the end of a route lengthens it. */
export function extendRoute(app, u, screenPoints) {
  if (!routeCanExtend(u)) return false;
  const simplified = simplifyPolyline(screenPoints, 3);
  const added = simplified.slice(1).map(([sx, sy]) => [...toWorld(app.camera, sx, sy), null]);
  if (!added.length) return false;
  return applyRouteEdit(app, u, [...routeCopy(u), ...added]);
}

/** Altitude written on a point of a squadron's route, by steps of 1 000 ft. */
export function changePointAltitude(app, u, index, deltaFt) {
  const pts = editableRoute(u);
  if (!pts || !pts[index] || u.kind !== 'squadron') return;
  const current = pts[index][2] ?? u.targetAlt;
  setPointAltitude(app.world, u, index, Math.round(feetOf(current) / 1000) * 1000 + deltaFt);
  app.dirtyPanels = true;
}

export function clearPointAltitude(app, u, index) {
  setPointAltitude(app.world, u, index, null);
  app.dirtyPanels = true;
}

/** End of the route chosen in the sheet: "orbit", "hold", "home", "cover:cw", "land:tangmere". */
export function orderEndAction(app, sq, value) {
  const [kind, id] = String(value).split(':');
  setEndAction(app.world, sq, { kind, id: id || undefined });
  app.dirtyPanels = true;
}

/** Arcade: the controller guides the squadron onto the raid. */
export function orderIntercept(app, sq, raidId) {
  const p = interceptRaid(app.world, sq, raidId);
  if (p === null) sheetMessage(app, t('orders.errors.intercept'));
  select(app, 'squadron', sq.id);
  app.dirtyPanels = true;
  return p !== null;
}

export function orderAlert(app, sq, state) {
  setAlert(app.world, sq, state);
  app.dirtyPanels = true;
}

export function orderConvoySpeed(app, c, kn) {
  setConvoySpeed(app.world, c, kn >= c.speedKn ? null : kn);
  app.dirtyPanels = true;
}

export function orderZigzag(app, c) {
  setZigzag(app.world, c, !c.zigzag);
  app.dirtyPanels = true;
}

export function orderEscortBehaviour(app, e, behaviour) {
  setEscortBehaviour(app.world, e, behaviour);
  app.dirtyPanels = true;
}

/** A mobile radar placed by a drag: from where it stands toward what it must watch. */
export function orderMru(app, a, b) {
  const result = deployMru(app.world, a[0], a[1], bearing(a[0], a[1], b[0], b[1]));
  if (!result.ok) {
    addLogEntry(app, t(`mru.errors.${result.reason}`), 'warning');
    app.flash = { x: a[0], y: a[1], until: performance.now() + 2500 };
  }
  app.setTool(null);
  app.dirtyPanels = true;
  return result.ok;
}
