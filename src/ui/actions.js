// What the player can do, shared by the mouse, the keyboard and the side panel.

import { t } from '../core/i18n.js';
import { bearing, distance, simplifyPolyline } from '../sim/geo.js';
import { contactEstimate } from '../sim/query.js';
import {
  addLeg, clearPlan, departConvoy, escortHome, joinConvoy, leaveConvoy, removeLeg, returnToBase, routeConvoy, scramble,
  sendTrain, setAltitude, setCover, setMinStock, setOrbit, setRoute, setSpeed, setVector,
} from '../sim/orders.js';
import { feetOf, squadronSpeed } from '../sim/squadron.js';
import { currentSpeed, legSpeed } from '../sim/convoy.js';
import { parseLegEnd } from '../sim/navigation.js';
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
  return null;
}

export function select(app, kind, id) {
  if (kind === 'airfield') {
    kind = 'site';
    id = `airfield:${id}`;
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

export function orderTrain(app, fromKey, toKey, resource) {
  app.lastTrainResource = resource;
  app.lastTrainTo = toKey;
  const result = sendTrain(app.world, fromKey, toKey, resource);
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

/** A leg typed in the sheet: heading, end (free text) and, for ships, a speed. */
export function addTypedLeg(app, u, headingText, endText, speedText = '') {
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
  const result = addLeg(app.world, u, { heading: heading % 360, end: parsed.end, speedKn });
  legError(app, result);
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
export function finishDrawing(app, hit, screenPoints) {
  const cam = app.camera;
  const world = app.world;
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
