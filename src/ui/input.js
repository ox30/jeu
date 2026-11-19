// Mouse, touch and keyboard.
//  - drag from a unit (convoy, squadron in the air, aerodrome): draws its route; when the
//    orders are given by heading, the drag measures a heading from the unit instead;
//  - on the route of the selected unit: drag a point to move it, drag a "+" to add one,
//    drag the ring at the end to draw the route longer, double-click a point to remove it,
//    click a point then ↑ ↓ to give it an altitude;
//  - Shift + drag, anywhere and in every mode: the ruler (from the unit when it starts on one);
//    it stays on the map until the cross on its box, Escape or a new ruler;
//  - drag elsewhere: moves the map; wheel or pinch: zooms;
//  - click: selects (a squadron or a group of a formation selects its formation); a click on
//    the map itself keeps the selection, which the cross of the unit panel or Escape clears;
//  - ruler tool: measures a heading and a distance.

import { panBy, toWorld, zoomAt } from '../render/camera.js';
import {
  SPEEDS, activePoint, addRulerLeg, cancelSpeed, changeAltitude, changePointAltitude, confirmSpeed, deletePoint, extendRoute, findUnit,
  finishDrawing, orderMru, goView, headingsMode, insertPoint, movePoint, orderBreakOff, orderHome, orderOrbit, placeRallyPoint, raidsInHand, requestSpeed,
  scrambleSquadron, select,
  revealSelection, selectedFormation, selectedSquadron, selectedUnit, setActivePoint, orderBoost, togglePause,
} from './actions.js';
import { membersOf } from '../sim/formations.js';
import { answerShown } from './questions.js';
import { speedIndexOfKey } from './keys.js';
import { pickHit, unitsUnder } from './hit.js';
import { memberSelection, stackChoice } from './stacks.js';
import { closeDropChoice, dropTargets, openDropChoice } from './dropChoice.js';
import { isFlying } from '../sim/squadron.js';
import { openJournal } from './alerts.js';
import { openHelp } from './dialogs.js';

const UNIT_KINDS = new Set(['squadron', 'convoy', 'airfield', 'escort', 'rally']);
const HANDLE_KINDS = new Set(['routePoint', 'routeMid', 'routeExtend']);

/** World position a measurement starts from when the player drags from a unit. */
function unitOrigin(app, hit) {
  const u = hit.kind === 'rally' ? null : findUnit(app, hit.kind, hit.id);
  return u && Number.isFinite(u.x) ? [u.x, u.y] : toWorld(app.camera, hit.x, hit.y);
}

/** The squadron in hand (or the leader of the wing in hand) when it stands on this aerodrome. */
function inHandOnField(app, fieldId) {
  const s = selectedSquadron(app);
  return s && !isFlying(s) && s.airfield === fieldId ? s : null;
}

/**
 * Selection made by a drag from an aerodrome: its first ready squadron, or the aerodrome.
 * The squadron in hand stays in hand when it is on this aerodrome.
 */
function selectFromAirfield(app, fieldId) {
  if (inHandOnField(app, fieldId)) return;
  const sq = app.world.squadrons.find((s) => s.airfield === fieldId && s.state === 'ready');
  if (sq) select(app, 'squadron', sq.id);
  else select(app, 'airfield', fieldId);
}

/**
 * A click on a stack: the sheet opens with a tab a unit. The unit already in hand stays in
 * hand if it is one of them; otherwise the first of the stack, never a neighbour by chance.
 */
function openStack(app, hit) {
  const choice = memberSelection(stackChoice(hit, app.selection));
  select(app, choice.kind, choice.id);
}

/** What a click on a symbol selects: the formation of a squadron or a group in one. */
function selectClicked(app, hit) {
  if (hit.kind === 'stack') openStack(app, hit);
  else if (hit.formation) select(app, 'formation', hit.formation);
  else if (hit.kind === 'rally') select(app, 'formation', hit.id);
  else select(app, hit.kind, hit.id);
}

/** A plain click on a symbol: selected, and brought out from under the sheet that opens. */
function clickSelect(app, hit) {
  selectClicked(app, hit);
  revealSelection(app);
}

function selectHit(app, hit) {
  if (hit.kind === 'airfield') selectFromAirfield(app, hit.id);
  else selectClicked(app, hit);
}

/**
 * Does this target belong to what is in hand? The unit itself or its formation, always. For a
 * drag (`proxy`), the aerodrome too when the squadron in hand stands on it or when its own
 * sheet is open: on the map a squadron on the ground is its aerodrome, and the line drawn
 * from there is its route. A plain click does not take that short cut: clicking a squadron
 * that flies over the aerodrome selects that squadron.
 */
function isSelectedHit(app, h, proxy) {
  const sel = app.selection;
  // Units only: a raid or an installation in hand must not hide the squadron flying over it.
  if (!sel || !UNIT_KINDS.has(h.kind)) return false;
  if (sel.kind === 'formation' && (h.formation === sel.id || (h.kind === 'rally' && h.id === sel.id))) return true;
  if (h.kind === sel.kind && h.id === sel.id) return true;
  if (!proxy || h.kind !== 'airfield') return false;
  return (sel.kind === 'site' && sel.id === `airfield:${h.id}`) || Boolean(inHandOnField(app, h.id));
}

/** What is under the pointer: for a drag that starts there (`proxy`), or for a plain click. */
function hitTest(app, x, y, pad, proxy = true) {
  return pickHit(app.hits, x, y, pad, (h) => isSelectedHit(app, h, proxy));
}

/** The view a key calls (A, L, G…: each view tells its key in data/campaign.json). */
function viewOfKey(app, key) {
  if (key.length !== 1) return null;
  const views = app.data.campaign.views;
  return Object.keys(views).find((name) => views[name].key && views[name].key.toLowerCase() === key.toLowerCase()) || null;
}

export function attachInput(app) {
  const canvas = app.canvas;
  const pointers = new Map();
  let gesture = null;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('pointerdown', (e) => {
    app.unlockAudio();
    if (app.dropChoice) closeDropChoice(app); // a choice left open: the line is given up
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      // Second finger: pinch zoom, and forget any line being drawn.
      app.drawing = null;
      app.routeDrag = null;
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if (pointers.size > 2) return;
    const pad = e.pointerType === 'touch' ? 14 : 6;
    const hit = hitTest(app, p[0], p[1], pad);
    if (hit && hit.kind === 'rulerClose') {
      // The cross on the ruler's box: the ruler goes, the ruler tool (if on) stays.
      app.ruler = null;
      gesture = null;
      return;
    }
    if (app.tool === 'rally') {
      // Placing a formation's rendezvous: a click on the map.
      const [wx, wy] = toWorld(app.camera, p[0], p[1]);
      placeRallyPoint(app, wx, wy);
      gesture = null;
      return;
    }
    if (app.tool === 'mru') {
      // Deploying a mobile radar: drag from its place toward the sea it must watch.
      const w = toWorld(app.camera, p[0], p[1]);
      app.ruler = { a: w, b: w, mru: true };
      gesture = { type: 'mru', start: p };
      return;
    }
    if (app.tool === 'ruler' || e.shiftKey) {
      // The ruler starts on the unit under the pointer, which is selected for its leg. Where
      // several units overlap it never changes the selection: it starts on the unit in hand
      // if that one is there, and on the map itself otherwise.
      let unitHit = hit && UNIT_KINDS.has(hit.kind) ? hit : null;
      if (unitHit && unitsUnder(app.hits, p[0], p[1], pad, UNIT_KINDS) > 1) {
        if (!isSelectedHit(app, unitHit, true)) unitHit = null;
      } else if (unitHit) {
        selectHit(app, unitHit);
      }
      const w = unitHit ? unitOrigin(app, unitHit) : toWorld(app.camera, p[0], p[1]);
      app.ruler = { a: w, b: w };
      gesture = { type: 'ruler' };
      return;
    }
    if (hit && HANDLE_KINDS.has(hit.kind)) {
      if (hit.kind === 'routeExtend') {
        gesture = { type: 'extend', hit, start: p, moved: false };
        app.drawing = { kind: 'extend', id: hit.id, points: [[hit.x, hit.y]] };
      } else {
        gesture = { type: 'edit', hit, start: p, moved: false };
      }
      return;
    }
    if (hit && hit.kind === 'stack') {
      // A stack with none of its units in hand: nothing is drawn from it (whose route would
      // it be?). A click opens its tabs; the drag then starts from the unit chosen.
      gesture = { type: 'stack', hit, start: p, moved: false };
      return;
    }
    // What the gesture selects if it turns out to be a plain click.
    const clickHit = hitTest(app, p[0], p[1], pad, false);
    if (hit && UNIT_KINDS.has(hit.kind)) {
      if (headingsMode(app)) {
        // Orders by heading: the drag lays the ruler from the unit.
        const a = unitOrigin(app, hit);
        gesture = { type: 'measure', hit, clickHit, start: p, moved: false, a };
        return;
      }
      gesture = { type: 'draw', hit, clickHit, start: p, moved: false };
      app.drawing = { kind: hit.kind, id: hit.id, points: [[hit.x, hit.y]] };
      return;
    }
    gesture = { type: 'pan', last: p, start: p, hit: clickHit, moved: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    if (!pointers.has(e.pointerId)) {
      const any = hitTest(app, p[0], p[1], 6);
      if (any && any.kind === 'rulerClose') {
        canvas.style.cursor = 'pointer';
        return;
      }
      const hit = app.tool ? null : any;
      canvas.style.cursor = app.tool === 'ruler' || app.tool === 'mru' || e.shiftKey ? 'crosshair'
        : hit && HANDLE_KINDS.has(hit.kind) ? (hit.kind === 'routePoint' ? 'move' : 'copy')
          : hit ? 'pointer' : 'grab';
      return;
    }
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    const far = (limit) => Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > limit;
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (gesture.dist > 0) zoomAt(app.camera, mid[0], mid[1], dist / gesture.dist);
      panBy(app.camera, mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
      gesture.dist = dist;
      gesture.mid = mid;
    } else if (gesture.type === 'draw' || gesture.type === 'extend') {
      const pts = app.drawing.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 5) pts.push(p);
      if (far(10)) gesture.moved = true;
    } else if (gesture.type === 'edit') {
      if (far(4)) gesture.moved = true;
      if (gesture.moved) {
        const h = gesture.hit;
        app.routeDrag = {
          kind: h.unitKind, id: h.id, index: h.index, mode: h.kind === 'routeMid' ? 'insert' : 'move', at: toWorld(app.camera, p[0], p[1]),
        };
      }
    } else if (gesture.type === 'pan') {
      panBy(app.camera, p[0] - gesture.last[0], p[1] - gesture.last[1]);
      gesture.last = p;
      if (far(5)) gesture.moved = true;
      canvas.style.cursor = 'grabbing';
    } else if (gesture.type === 'stack') {
      if (far(10)) gesture.moved = true;
    } else if (gesture.type === 'ruler' || gesture.type === 'mru') {
      app.ruler.b = toWorld(app.camera, p[0], p[1]);
    } else if (gesture.type === 'measure') {
      if (!gesture.moved && far(10)) {
        gesture.moved = true;
        selectHit(app, gesture.hit);
      }
      if (gesture.moved) app.ruler = { a: gesture.a, b: toWorld(app.camera, p[0], p[1]) };
    }
  });

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (pointers.size === 0) gesture = null;
      return;
    }
    const up = e.type === 'pointerup';
    if (gesture.type === 'draw') {
      if (gesture.moved && app.drawing && up) {
        const q = pos(e);
        const points = [...app.drawing.points, q];
        const endHit = hitTest(app, q[0], q[1], 8);
        // Several targets where the line ends: a small choice says which one it means.
        const targets = dropTargets(app, gesture.hit, q[0], q[1], e.pointerType === 'touch' ? 14 : 8);
        if (targets.length > 1) openDropChoice(app, gesture.hit, points, targets, q[0], q[1]);
        else finishDrawing(app, gesture.hit, points, endHit);
      } else if (!gesture.moved) {
        clickSelect(app, gesture.clickHit || gesture.hit);
      }
      app.drawing = null;
    } else if (gesture.type === 'extend') {
      const u = findUnit(app, gesture.hit.unitKind, gesture.hit.id);
      if (gesture.moved && app.drawing && up && u) extendRoute(app, u, [...app.drawing.points, pos(e)]);
      app.drawing = null;
    } else if (gesture.type === 'edit') {
      const h = gesture.hit;
      const u = findUnit(app, h.unitKind, h.id);
      if (u && up) {
        if (gesture.moved) {
          const [x, y] = toWorld(app.camera, ...pos(e));
          if (h.kind === 'routeMid') insertPoint(app, u, h.index, x, y);
          else movePoint(app, u, h.index, x, y);
        } else if (h.kind === 'routeMid') {
          insertPoint(app, u, h.index, h.wx, h.wy);
        } else {
          setActivePoint(app, u, h.index);
        }
      }
      app.routeDrag = null;
    } else if (gesture.type === 'stack') {
      if (!gesture.moved && up) clickSelect(app, gesture.hit);
    } else if (gesture.type === 'measure') {
      if (!gesture.moved) clickSelect(app, gesture.clickHit || gesture.hit);
    } else if (gesture.type === 'mru') {
      if (up && app.ruler && Math.hypot(pos(e)[0] - gesture.start[0], pos(e)[1] - gesture.start[1]) > 12) orderMru(app, app.ruler.a, app.ruler.b);
      app.ruler = null;
    } else if (gesture.type === 'pan' && !gesture.moved && up) {
      // A click on the map itself no longer clears the selection (the panel's cross does).
      if (gesture.hit) clickSelect(app, gesture.hit);
    }
    gesture = null;
    canvas.style.cursor = app.tool === 'ruler' ? 'crosshair' : 'grab';
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e);
    zoomAt(app.camera, p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const p = pos(e);
    const hit = hitTest(app, p[0], p[1], 6);
    if (hit && hit.kind === 'routePoint') {
      const u = findUnit(app, hit.unitKind, hit.id);
      if (u) deletePoint(app, u, hit.index);
      return;
    }
    if (hit && HANDLE_KINDS.has(hit.kind)) return;
    zoomAt(app.camera, p[0], p[1], e.shiftKey ? 0.5 : 2);
  });

  window.addEventListener('keydown', (e) => {
    app.unlockAudio();
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    const sq = selectedSquadron(app);
    const unit = selectedUnit(app);
    const point = activePoint(app);
    const key = e.key;
    // A high speed asked during an enemy action waits for Enter (yes) or Escape (no).
    if (app.speedConfirm && (key === 'Enter' || key === 'Escape')) {
      e.preventDefault();
      if (key === 'Enter') confirmSpeed(app);
      else cancelSpeed(app);
      return;
    }
    // A question from a squadron: Enter is yes, Escape is no.
    if (app.questionShown && (key === 'Enter' || key === 'Escape')) {
      e.preventDefault();
      answerShown(app, key === 'Enter');
      return;
    }
    const speedIndex = speedIndexOfKey(e, SPEEDS.length);
    if (key === ' ') {
      togglePause(app);
    } else if (speedIndex >= 0) {
      requestSpeed(app, speedIndex);
    } else if (viewOfKey(app, key)) {
      goView(app, viewOfKey(app, key));
    } else if (key === 'r' || key === 'R') {
      app.setTool(app.tool === 'ruler' ? null : 'ruler');
    } else if (key === 'c' || key === 'C') {
      app.toggleRadarCover();
    } else if (key === 'j' || key === 'J') {
      openJournal(app);
    } else if (key === '?') {
      openHelp(app);
    } else if (key === 'Escape' && app.dropChoice) {
      closeDropChoice(app);
    } else if (key === 'Escape') {
      app.drawing = null;
      app.ruler = null;
      app.routeDrag = null;
      app.setTool(null);
      if (point) setActivePoint(app, null, null);
      else select(app, null, null);
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && point && point.u.kind === 'squadron') {
      changePointAltitude(app, point.u, point.index, key === 'ArrowUp' ? 1000 : -1000);
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && sq) {
      changeAltitude(app, sq, key === 'ArrowUp' ? 1000 : -1000);
    } else if ((key === 'Delete' || key === 'Backspace') && point) {
      deletePoint(app, point.u, point.index);
    } else if (key === 'Enter' && unit && app.ruler) {
      addRulerLeg(app, unit);
    } else if ((key === 's' || key === 'S') && sq && (sq.state === 'ready'
      || (selectedFormation(app) && !(sq.state === 'scrambling' || sq.state === 'airborne' || sq.state === 'combat' || sq.state === 'returning')
        && membersOf(app.world, selectedFormation(app)).some((s) => s.state === 'ready')))) {
      scrambleSquadron(app, sq);
    } else if ((key === 'b' || key === 'B') && unit) {
      orderBoost(app, unit);
    } else if ((key === 'o' || key === 'O') && sq) {
      orderOrbit(app, sq);
    } else if ((key === 'p' || key === 'P') && sq) {
      orderHome(app, sq);
    } else if ((key === 'd' || key === 'D') && sq && raidsInHand(app, sq).length) {
      orderBreakOff(app, sq, raidsInHand(app, sq)[0].id);
    } else if (key === '+' || key === '=') {
      zoomAt(app.camera, app.camera.width / 2, app.camera.height / 2, 1.5);
    } else if (key === '-') {
      zoomAt(app.camera, app.camera.width / 2, app.camera.height / 2, 1 / 1.5);
    } else {
      return;
    }
    e.preventDefault();
  });
}
