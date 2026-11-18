// What the player can do, shared by the mouse, the keyboard and the side panel.

import { t } from '../core/i18n.js';
import { bearing, distance, simplifyPolyline } from '../sim/geo.js';
import { contactEstimate } from '../sim/query.js';
import {
  addLeg, clearPlan, departConvoy, setExitChannel, setShipBoost, setShipSpeedPct, setSpeedPct, editShipRoute, editableRoute, escortHome, joinConvoy, leaveConvoy, removeLeg, removeRoutePoint, returnToBase, routeCanExtend, routeConvoy, scramble, sendTrain, setAltitude, setCover, setEndAction, setMinStock, setOrbit, setPointAltitude, setRoute, setSpeed, setVector, updateLeg, interceptRaid, setAlert, setConvoySpeed, setEscortBehaviour, setZigzag, followSquadron, leaveFormation, planGroundRoute, huntPlot, setHuntHours,
} from '../sim/orders.js';
import { stopHunt } from '../sim/asw.js';
import { setShipEndAction } from '../sim/naval.js';
import { buyOffer, setPurchase } from '../sim/shipping.js';
import { feetOf, squadronSpeed } from '../sim/squadron.js';
import { currentSpeed, legSpeed, shipThrottle } from '../sim/convoy.js';
import { parseLegEnd } from '../sim/navigation.js';
import { deployMru } from '../sim/mru.js';
import { VIEWS, animateTo, toScreen, toWorld, viewFrame } from '../render/camera.js';
import {
  addMember, dissolveFormation, formationById, formationOf, interceptFormation, launchWaiting, leaderOf, membersOf, mergeFormations, newFormation,
  removeMember, scrambleFormation,
} from '../sim/formations.js';
import { authorize, setRoe } from '../sim/engagement.js';
import { breakOffRaid } from '../sim/combat.js';
import { isActive } from '../sim/raid.js';
import { addDaily, addOverride, copyDaily, endOverride, holdManual, overrideOf, removeRosterEntry, resumeRoster, startOverride } from '../sim/roster.js';
import {
  cancelSail, cancelTakeoff, cancelWing, scheduleSail, scheduleTakeoff, scheduleWing,
} from '../sim/timetable.js';
import {
  armRally, cancelRally, computeDepartures, newRally, setDeparture, setRallyAlt, setRallyMissing, setRallyPoint, setRallyRoute, setRallyTime,
  setRallyWhere,
} from '../sim/rally.js';
import { isFlying } from '../sim/squadron.js';
import { addLogEntry } from './panels.js';
import { formationDefaultName } from './format.js';

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
  if (kind === 'ucontact') return w.uboats.find((u) => u.id === id && u.seen);
  if (kind === 'formation') return formationById(w, id);
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

/** The formation selected, or null. */
export function selectedFormation(app) {
  const sel = app.selection;
  return sel && sel.kind === 'formation' ? formationById(app.world, sel.id) : null;
}

/** The unit the orders go to: the one selected, or the leader of the formation selected. */
export function selectedUnit(app) {
  const sel = app.selection;
  if (!sel) return null;
  if (sel.kind === 'formation') {
    const f = formationById(app.world, sel.id);
    return f ? leaderOf(app.world, f) : null;
  }
  if (sel.kind !== 'squadron' && sel.kind !== 'convoy' && sel.kind !== 'escort') return null;
  return findUnit(app, sel.kind, sel.id);
}

export function selectedSquadron(app) {
  const u = selectedUnit(app);
  return u && u.kind === 'squadron' ? u : null;
}

/** Selects a unit, or its formation when it has one. */
export function selectUnit(app, u) {
  const f = formationOf(app.world, u);
  if (f) select(app, 'formation', f.id);
  else select(app, u.kind, u.id);
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
  if (app.crash) {
    // Stopped on an error: a speed key does not set the clock going, the message comes back.
    togglePause(app);
    return;
  }
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
  // Stopped on an error (crash.js): the clock stays stopped, and the message comes back.
  if (app.crash) {
    app.paused = true;
    if (app.showCrash) app.showCrash();
    app.dirtyHud = true;
    return;
  }
  app.paused = !app.paused;
  app.accumulator = 0;
  app.dirtyHud = true;
}

/** What the open unit sheet hides of the map, in pixels on each side (null: nothing). */
export function sheetInset(app) {
  if (!app.selection || typeof window === 'undefined' || window.innerWidth <= 820) return null;
  const el = app.el && app.el.unitPanel;
  if (!el || el.hidden) return null;
  const pos = app.settings.sheetPos || 'right';
  if (pos === 'bottom') return { bottom: el.offsetHeight || app.settings.sheetH || 300 };
  const w = el.offsetWidth || app.settings.sheetW || 400;
  return pos === 'left' ? { left: w } : { right: w };
}

/** The three views (keys A, L, G) are framed in the part of the map the sheet leaves free. */
export function goView(app, name) {
  animateTo(app.camera, viewFrame(app.camera, VIEWS[name], 30, sheetInset(app)));
}

/** Width of the map hidden by the unit panel (open when something is selected). */
function unitPanelWidth(app) {
  if (!app.selection || typeof window === 'undefined' || window.innerWidth <= 820) return 0;
  const el = app.el && app.el.unitPanel;
  const w = el && !el.hidden && el.offsetWidth ? el.offsetWidth : 400;
  // Sheet on the right: the visible map is to its left; on the left, to its right; at the bottom, no shift.
  const pos = app.settings.sheetPos || 'right';
  return pos === 'bottom' ? 0 : pos === 'left' ? -w : w;
}

/** Brings (x, y) to the middle of the part of the map that can be seen. */
export function centreOn(app, x, y, minScale = 0) {
  const cam = app.camera;
  const scale = Math.max(cam.scale, minScale);
  // A sheet at the bottom of the map: the point goes to the middle of the part above it.
  const el = app.el && app.el.unitPanel;
  const below = app.selection && (app.settings.sheetPos || 'right') === 'bottom' && el && !el.hidden ? el.offsetHeight : 0;
  animateTo(cam, { cx: x + unitPanelWidth(app) / 2 / scale, cy: y - below / 2 / scale, scale }, 0.6);
}

/** Where the chosen thing stands on the map (a squadron on the ground: its aerodrome), or null. */
function selectionPosition(app) {
  const sel = app.selection;
  if (!sel) return null;
  const w = app.world;
  if (sel.kind === 'raid') {
    const contact = w.contacts.get(sel.id);
    const est = contact ? contactEstimate(w, contact) : null;
    return est ? [est.x, est.y] : null;
  }
  const u = selectedUnit(app) || findUnit(app, sel.kind, sel.id);
  if (!u) return null;
  if (u.kind === 'squadron' && !isFlying(u)) {
    const f = w.byId.airfield.get(u.airfield);
    if (f) return [f.x, f.y];
  }
  return Number.isFinite(u.x) && Number.isFinite(u.y) ? [u.x, u.y] : null;
}

/**
 * Brings the chosen unit into view when the sheet that opens (or the edge of the map) would
 * hide it: a choice in the status board, or a click near the side where the sheet stands.
 */
export function revealSelection(app) {
  if (typeof window === 'undefined') return;
  const p = selectionPosition(app);
  if (!p) return;
  const cam = app.camera;
  const [sx, sy] = toScreen(cam, p[0], p[1]);
  const m = 30;
  let x0 = m;
  let x1 = cam.width - m;
  const y0 = m;
  let y1 = cam.height - m;
  if (window.innerWidth > 820) {
    const where = app.settings.sheetPos || 'right';
    const w = Math.min(app.settings.sheetW || 400, cam.width * 0.92);
    const h = Math.min(app.settings.sheetH || 300, cam.height * 0.8);
    if (where === 'right') x1 = cam.width - w - m;
    else if (where === 'left') x0 = w + m;
    else y1 = cam.height - h - m;
  }
  if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return;
  centreOn(app, p[0], p[1]);
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
  const f = formationOf(app.world, sq);
  const lead = f ? leaderOf(app.world, f) : sq;
  const input = document.getElementById('vector-input');
  const typed = input && input.value !== '' ? Number(input.value) : null;
  let order;
  if (lead.plan.length) order = {};
  else if (typed !== null && typed >= 0 && typed <= 360) order = { vector: typed % 360 };
  else if (!headingsMode(app)) {
    const heading = nearestContactHeading(app, lead.x, lead.y);
    order = heading === null ? { orbit: true } : { vector: heading };
  } else order = { orbit: true };
  if (f) {
    // A squadron of a big wing takes off with its wing.
    if (!scrambleFormation(app.world, f, order)) sheetMessage(app, t('unit.scrambleRefused'));
    select(app, 'formation', f.id);
    return;
  }
  scramble(app.world, sq, order);
  select(app, 'squadron', sq.id);
}

/** Members of a wing still on the ground take off to join it. */
export function orderLaunchWaiting(app, f) {
  launchWaiting(app.world, f);
  app.dirtyPanels = true;
}

/** Readiness of every squadron of the wing on the ground. */
export function orderFormationAlert(app, f, state) {
  for (const s of membersOf(app.world, f)) if (s.state === 'ready' || s.state === 'refuelling') setAlert(app.world, s, state);
  app.dirtyPanels = true;
}

export function orderNewFormation(app, u) {
  const kind = u.kind === 'squadron' ? 'air' : 'naval';
  const f = newFormation(app.world, kind, u.id, formationDefaultName(app.world, kind, u));
  if (f) select(app, 'formation', f.id);
  app.dirtyPanels = true;
  return f;
}

export function orderLeaveFormationOf(app, f, unitId) {
  removeMember(app.world, f, unitId);
  app.dirtyPanels = true;
}

export function orderDissolve(app, f) {
  const leader = leaderOf(app.world, f);
  dissolveFormation(app.world, f);
  if (leader) select(app, leader.kind, leader.id);
  app.dirtyPanels = true;
}

export function orderMerge(app, into, from) {
  mergeFormations(app.world, into, from);
  select(app, 'formation', into.id);
  app.dirtyPanels = true;
}

export function changeAltitude(app, sq, deltaFt) {
  setAltitude(app.world, sq, Math.round(feetOf(sq.targetAlt) / 1000) * 1000 + deltaFt);
  app.dirtyPanels = true;
}

export function toggleBuster(app, sq) {
  setSpeed(app.world, sq, sq.speedMode === 'max' ? 'cruise' : 'max');
  app.dirtyPanels = true;
}

/** Speed slider of a unit's command bar: a share of its « 100 % ». */
export function orderSpeedPct(app, u, pct) {
  if (u.kind === 'squadron') setSpeedPct(app.world, u, pct);
  else for (const x of u.kind === 'escort' ? groupsOf(app, u) : [u]) setShipSpeedPct(app.world, x, pct);
  app.dirtyPanels = true;
}

/** Boost button of the command bar: full speed for aircraft, best or sprint speed for ships. */
export function orderBoost(app, u) {
  if (u.kind === 'squadron') toggleBuster(app, u);
  else {
    const on = !shipThrottle(app.world, u).boost;
    for (const x of u.kind === 'escort' ? groupsOf(app, u) : [u]) setShipBoost(app.world, x, on);
  }
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
  const f = formationOf(app.world, sq);
  if (f) {
    // The whole wing goes home, each squadron to its own aerodrome.
    for (const s of membersOf(app.world, f)) if (s.state === 'airborne' || s.state === 'combat') returnToBase(app.world, s);
  } else returnToBase(app.world, sq);
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
  if (!result.ok && result.reason === 'dry') sheetMessage(app, t('orders.errors.dry'));
  app.dirtyPanels = true;
}

export function orderSail(app, convoy) {
  for (const c of convoy.kind === 'escort' ? groupsOf(app, convoy) : [convoy]) departConvoy(app.world, c);
  app.dirtyPanels = true;
}

/** How a group (its support group) goes out of port: the roads, or a channel. */
export function orderExitChannel(app, escort, name) {
  for (const e of groupsOf(app, escort)) setExitChannel(app.world, e, name || null);
  app.dirtyPanels = true;
}

/** The groups an order goes to: the support group of `escort`, or the group alone. */
function groupsOf(app, escort) {
  const f = formationOf(app.world, escort);
  return f ? membersOf(app.world, f) : [escort];
}

export function orderJoin(app, escort, convoyId) {
  const groups = groupsOf(app, escort);
  if (groups.some((e) => e.dry)) sheetMessage(app, t('orders.errors.dry'));
  for (const e of groups) joinConvoy(app.world, e, convoyId);
  app.dirtyPanels = true;
}

export function orderLeave(app, escort) {
  for (const e of groupsOf(app, escort)) leaveConvoy(app.world, e);
  app.dirtyPanels = true;
}

/** Back to the port chosen (or the nearest by sea), a hunt ended on the way. */
export function orderEscortHome(app, escort, portId = null) {
  for (const e of groupsOf(app, escort)) escortHome(app.world, e, portId || null);
  app.dirtyPanels = true;
}

/** The hunt stops: back to the convoy, or waiting for orders. */
export function orderHuntStop(app, escort) {
  for (const e of groupsOf(app, escort)) stopHunt(app.world, e);
  app.dirtyPanels = true;
}

/** Off to hunt a fresh U-boat plot, for the hours set. */
export function orderHuntPlot(app, escort, plotId) {
  const groups = groupsOf(app, escort);
  if (groups.some((e) => e.dry)) sheetMessage(app, t('orders.errors.dry'));
  for (const e of groups) huntPlot(app.world, e, plotId);
  app.dirtyPanels = true;
}

/** How long the group's hunts last; a hunt under way is timed again from now. */
export function orderHuntHours(app, escort, hours) {
  for (const e of groupsOf(app, escort)) setHuntHours(app.world, e, Number(hours));
  app.dirtyPanels = true;
}

/** What a group does at the end of its route ("escort:hx55", "port:clyde", "hunt"...). */
export function orderShipEnd(app, escort, value) {
  const [kind, id] = String(value).split(':');
  for (const e of groupsOf(app, escort)) setShipEndAction(app.world, e, { kind, id: id || null });
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
  // A line drawn from a squadron or a group of a formation is the formation's.
  if ((hit.kind === 'squadron' || hit.kind === 'escort') && hit.formation) {
    const f = formationById(world, hit.formation);
    const leader = f ? leaderOf(world, f) : null;
    if (leader) hit = { ...hit, id: leader.id };
  }
  const simplified = simplifyPolyline(screenPoints, 3);
  const points = simplified.slice(1).map(([sx, sy]) => toWorld(cam, sx, sy));
  if (!points.length) return;
  // From the point of a rendezvous: the route the formation follows from there.
  if (hit.kind === 'rally') {
    const f = formationById(world, hit.id);
    if (f) {
      setRallyRoute(world, f, points);
      select(app, 'formation', f.id);
    }
    app.dirtyPanels = true;
    return;
  }
  // A line that ends on a raid is leave to attack it, whatever the standing order.
  const onRaid = endHit && endHit.kind === 'raid' ? world.raids.find((r) => r.id === endHit.id) : null;

  if (hit.kind === 'squadron') {
    const sq = findUnit(app, 'squadron', hit.id);
    const f = sq ? formationOf(world, sq) : null;
    if (sq && f && sq.state === 'ready') {
      // A wing on the ground takes off along the line.
      scrambleFormation(world, f, { route: points });
      select(app, 'formation', f.id);
    } else if (sq && setRoute(world, sq, points)) {
      if (onRaid) clearFor(app, sq, onRaid);
      selectUnit(app, sq);
    }
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
    const f = formationOf(world, sq);
    if (sq.schedule && !sq.schedule.join && sq.state === 'ready') {
      // A take-off ordered for later: the line is its route, it waits on the ground.
      planGroundRoute(world, sq, points);
      select(app, 'squadron', sq.id);
    } else if (f) {
      // A squadron of a big wing goes with its wing: the line is the wing's route.
      const leader = leaderOf(world, f);
      if (leader && leader.schedule && leader.state === 'ready') {
        planGroundRoute(world, leader, points);
      } else if (leader && (isFlying(leader) || leader.state === 'scrambling')) {
        setRoute(world, leader, points);
        launchWaiting(world, f);
      } else {
        scrambleFormation(world, f, { route: points });
      }
      if (onRaid) for (const m of membersOf(world, f)) authorize(m, onRaid.id);
      select(app, 'formation', f.id);
    } else {
      if (sq.state === 'ready') scramble(world, sq, { route: points });
      else setRoute(world, sq, points);
      if (onRaid) clearFor(app, sq, onRaid);
      select(app, 'squadron', sq.id);
    }
  } else if (hit.kind === 'convoy' || hit.kind === 'escort') {
    const ship = findUnit(app, hit.kind, hit.id);
    const result = routeConvoy(world, ship, points);
    if (!result.ok && result.at) app.flash = { x: result.at[0], y: result.at[1], until: performance.now() + 2500 };
    selectUnit(app, ship);
    if (!result.ok && result.reason === 'dry') sheetMessage(app, t('orders.errors.dry'));
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
  const f = formationOf(app.world, sq);
  const p = f ? interceptFormation(app.world, f, raidId) : interceptRaid(app.world, sq, raidId);
  if (p === null) sheetMessage(app, t('orders.errors.intercept'));
  if (f) select(app, 'formation', f.id);
  else select(app, 'squadron', sq.id);
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
  for (const g of groupsOf(app, e)) setEscortBehaviour(app.world, g, behaviour);
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

// ---- standing orders, timetable, rendezvous -----------------------------------------------

/** "HH:MM" typed by the player → game seconds: that time today, or tomorrow once past. */
/** Hours and minutes of a typed hour: "05:30", "5h30", "5.30", "0530", "530", "5". */
export function parseClock(text) {
  const str = String(text || '').trim();
  let m = /^(\d{1,2})(?:[:h.](\d{2}))?h?$/i.exec(str);
  if (!m) {
    const d = /^(\d{1,2})(\d{2})$/.exec(str);
    if (!d) return null;
    m = d;
  }
  const hh = Number(m[1]);
  const mm = m[2] === undefined ? 0 : Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

export function clockToT(app, text, dayOffset = null) {
  const clock = parseClock(text);
  if (!clock) return null;
  const { hh, mm } = clock;
  const w = app.world;
  const dayMs = 86400000;
  const nowMs = w.startMs + w.t * 1000;
  const midnight = Math.floor(nowMs / dayMs) * dayMs;
  let ms = midnight + (hh * 60 + mm) * 60000;
  if (dayOffset !== null) ms += dayOffset * dayMs;
  else if (ms < nowMs - 30000) ms += dayMs;
  return Math.round((ms - w.startMs) / 1000);
}

/** Leave to attack a raid (a line drawn onto it): for the squadron and its formation. */
function clearFor(app, sq, r) {
  for (const s of wingOf(app, sq)) {
    if (!s) continue;
    authorize(s, r.id);
  }
  if (!sq.follow) sq.attackRaid = r.id;
}

/** Squadrons an order on `u` goes to: the members of its formation, or `u` alone. */
function wingOf(app, u) {
  if (u && u.members) return membersOf(app.world, u);
  const f = u ? formationOf(app.world, u) : null;
  return f ? membersOf(app.world, f) : [u];
}

/** « Désengager H05 »: the unit (its whole wing) breaks off and leaves that raid alone. */
export function orderBreakOff(app, u, raidId) {
  const list = wingOf(app, u).filter((s) => s && s.kind === 'squadron');
  if (!breakOffRaid(app.world, list, raidId).length) sheetMessage(app, t('orders.breakOffNone'));
  app.dirtyPanels = true;
}

/** The raids a unit (or its wing) fights, chases or is guided onto, latest order first. */
export function raidsInHand(app, u) {
  const w = app.world;
  const ids = [];
  for (const s of wingOf(app, u)) {
    if (!s || s.kind !== 'squadron') continue;
    for (const id of [s.engagedRaid, s.attackRaid, s.intercept && s.intercept.raidId]) if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => w.raids.find((r) => r.id === id)).filter((r) => r && isActive(r));
}

/** Standing order on meeting the enemy, for a squadron or every squadron of its formation. */
export function orderRoe(app, u, roe) {
  for (const s of wingOf(app, u)) if (s && s.kind === 'squadron') setRoe(app.world, s, roe);
  app.dirtyPanels = true;
}

/**
 * Alert state for a squadron (or the squadrons of a formation on the ground). Standing down
 * to rest asks first: it takes two hours to get the pilots back.
 */
export function orderAlertChecked(app, u, state) {
  const list = wingOf(app, u).filter((s) => s && s.kind === 'squadron');
  if (state === 'rest' && !(app.confirm && app.confirm.action === 'alert' && app.confirm.id === u.id)) {
    app.confirm = { action: 'alert', id: u.id, kind: u.members ? 'formation' : 'squadron', alert: 'rest' };
    app.dirtyPanels = true;
    return false;
  }
  app.confirm = null;
  for (const s of list) {
    setAlert(app.world, s, state);
    holdManual(app.world, s);
  }
  app.dirtyPanels = true;
  return true;
}

/** « Retour au planning »: the plan takes over again for the squadron (or its wing). */
export function orderRosterResume(app, u) {
  for (const s of wingOf(app, u)) if (s && s.kind === 'squadron') resumeRoster(app.world, s);
  app.dirtyPanels = true;
}

/** Copies a squadron's daily plan to another squadron, or to every other one of its aerodrome. */
export function orderRosterCopy(app, s, target) {
  const w = app.world;
  const field = s.home || s.airfield;
  const to = target === 'field'
    ? w.squadrons.filter((x) => x !== s && x.role === 'fighter' && x.state !== 'lost' && (x.home || x.airfield) === field)
    : w.squadrons.filter((x) => x.id === target && x !== s);
  for (const x of to) copyDaily(w, s, x);
  sheetMessage(app, t('roster.copied', { n: to.length }), 'info');
  app.dirtyPanels = true;
}

export function cancelConfirm(app) {
  app.confirm = null;
  app.dirtyPanels = true;
}

/** Seconds after midnight for a typed hour ("05:30", "5h30"), or null. */
export function clockToTod(text) {
  const clock = parseClock(text);
  return clock ? (clock.hh * 60 + clock.mm) * 60 : null;
}

/** Seconds for a typed number of hours after H0 ("6", "6.5", "6:30", "H+6"), or null. */
export function offsetToS(text) {
  const m = /^\s*(?:h\s*)?\+?\s*(\d{1,3})(?:[.,](\d+)|[:h](\d{2}))?\s*h?\s*$/i.exec(String(text || ''));
  if (!m) return null;
  let hours = Number(m[1]);
  if (m[2] !== undefined) hours += Number(`0.${m[2]}`);
  if (m[3] !== undefined) {
    if (Number(m[3]) > 59) return null;
    hours += Number(m[3]) / 60;
  }
  return Math.round(hours * 60) * 60;
}

/**
 * A change in the duty roster: in the daily plan at an hour of the day ("05:30"), or, while a
 * plan for the coming hours runs, so many hours after its start ("6" for H+6).
 */
export function orderRosterAdd(app, s, alert, text) {
  const w = app.world;
  const override = Boolean(overrideOf(w, s));
  const when = override ? offsetToS(text) : clockToTod(text);
  if (when === null) {
    sheetMessage(app, t(override ? 'orders.errors.offset' : 'orders.errors.clock'));
    return false;
  }
  const entry = override ? addOverride(w, s, when, alert) : addDaily(w, s, when, alert);
  if (!entry) {
    sheetMessage(app, t('orders.errors.rosterAfter'));
    return false;
  }
  app.dirtyPanels = true;
  return true;
}

export function orderRosterRemove(app, s, entryId) {
  removeRosterEntry(app.world, s, entryId);
  app.dirtyPanels = true;
}

/** Ticked: a plan for the coming hours only, empty, instead of the daily one; unticked: back to it. */
export function orderRosterOverride(app, s, on) {
  if (on) startOverride(app.world, s, Number(app.settings.rosterHours) || 24);
  else endOverride(app.world, s);
  app.dirtyPanels = true;
}

export function orderScheduleTakeoff(app, s, text, daily) {
  const at = clockToT(app, text);
  if (at === null) {
    sheetMessage(app, t('orders.errors.clock'));
    return false;
  }
  scheduleTakeoff(app.world, s, at, { daily });
  app.dirtyPanels = true;
  return true;
}

/** A squadron (or an escort group) to join a formation, leaving at a time of its own. */
export function orderScheduleJoin(app, u, formationId, text, dayOffset = null) {
  const at = clockToT(app, text, dayOffset);
  const f = formationById(app.world, formationId);
  if (at === null || !f) {
    sheetMessage(app, t('orders.errors.clock'));
    return false;
  }
  if (!f.members.includes(u.id)) {
    // The time first, so that it is not sent off at once (formations.js).
    if (u.kind === 'squadron') scheduleTakeoff(app.world, u, at, { join: f.id });
    else u.schedule = { id: `J${u.id}`, at, join: f.id, delayed: false };
    if (!addMember(app.world, f, u.id)) {
      u.schedule = null;
      sheetMessage(app, t('formations.refused'));
      return false;
    }
  } else if (u.kind === 'squadron') scheduleTakeoff(app.world, u, at, { join: f.id });
  else u.schedule = { id: `J${u.id}`, at, join: f.id, delayed: false };
  app.dirtyPanels = true;
  return true;
}

export function orderCancelSchedule(app, u) {
  if (u.members) cancelWing(app.world, u);
  else if (u.kind === 'squadron') cancelTakeoff(app.world, u);
  else cancelSail(app.world, u);
  app.dirtyPanels = true;
}

export function orderScheduleWing(app, f, text, daily) {
  const at = clockToT(app, text);
  if (at === null) {
    sheetMessage(app, t('orders.errors.clock'));
    return false;
  }
  scheduleWing(app.world, f, at, { daily });
  app.dirtyPanels = true;
  return true;
}

export function orderScheduleSail(app, c, dayOffset, text) {
  const at = clockToT(app, text, dayOffset);
  if (at === null || at < app.world.t - 60) {
    sheetMessage(app, t('orders.errors.clock'));
    return false;
  }
  scheduleSail(app.world, c, at);
  app.dirtyPanels = true;
  return true;
}

// Rendezvous plans (rally.js): edits while the plan is not under way.

export function orderRally(app, f, change) {
  const w = app.world;
  if (!f.rally) newRally(w, f);
  switch (change.kind) {
    case 'where':
      setRallyWhere(w, f, change.where);
      if (change.where === 'point' && f.rally.x === null) {
        app.rallyFor = f.id;
        app.setTool('rally');
      }
      break;
    case 'place':
      app.rallyFor = f.id;
      app.setTool(app.tool === 'rally' ? null : 'rally');
      break;
    case 'alt':
      setRallyAlt(w, f, f.rally.altM + change.deltaFt * 0.3048);
      break;
    case 'time': {
      if (change.text === 'asap') setRallyTime(w, f, null);
      else {
        const at = clockToT(app, change.text, change.dayOffset ?? null);
        if (at === null) sheetMessage(app, t('orders.errors.clock'));
        else setRallyTime(w, f, at);
      }
      break;
    }
    case 'missing':
      setRallyMissing(w, f, change.missing, change.waitMin ?? null);
      break;
    case 'departure': {
      const at = change.text ? clockToT(app, change.text, change.dayOffset ?? null) : null;
      if (change.text && at === null) sheetMessage(app, t('orders.errors.clock'));
      else setDeparture(w, f, change.unitId, at);
      break;
    }
    case 'compute':
      computeDepartures(w, f);
      break;
    case 'routeClear':
      f.rally.route = [];
      break;
    case 'arm':
      if (!armRally(w, f)) sheetMessage(app, t('rally.errors.arm'));
      break;
    case 'cancel':
      cancelRally(w, f);
      break;
    default:
  }
  app.dirtyPanels = true;
}

/** The point of the rendezvous placed with a click on the map (tool "rally"). */
export function placeRallyPoint(app, x, y) {
  const f = formationById(app.world, app.rallyFor);
  if (f) {
    if (!f.rally) newRally(app.world, f);
    setRallyPoint(app.world, f, x, y);
  }
  app.setTool(null);
  app.dirtyPanels = true;
}
