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
  selectedFormation, selectedSquadron, selectedUnit, setActivePoint, toggleBuster, togglePause,
} from './actions.js';
import { membersOf } from '../sim/formations.js';
import { answerShown } from './questions.js';

const UNIT_KINDS = new Set(['squadron', 'convoy', 'airfield', 'escort', 'rally']);
const HANDLE_KINDS = new Set(['routePoint', 'routeMid', 'routeExtend']);

/** World position a measurement starts from when the player drags from a unit. */
function unitOrigin(app, hit) {
  const u = hit.kind === 'rally' ? null : findUnit(app, hit.kind, hit.id);
  return u && Number.isFinite(u.x) ? [u.x, u.y] : toWorld(app.camera, hit.x, hit.y);
}

/** Selection made by a drag from an aerodrome: its first ready squadron, or the aerodrome. */
function selectFromAirfield(app, fieldId) {
  const sq = app.world.squadrons.find((s) => s.airfield === fieldId && s.state === 'ready');
  if (sq) select(app, 'squadron', sq.id);
  else select(app, 'airfield', fieldId);
}

/** What a click on a symbol selects: the formation of a squadron or a group in one. */
function selectClicked(app, hit) {
  if (hit.formation) select(app, 'formation', hit.formation);
  else if (hit.kind === 'rally') select(app, 'formation', hit.id);
  else select(app, hit.kind, hit.id);
}

function selectHit(app, hit) {
  if (hit.kind === 'airfield') selectFromAirfield(app, hit.id);
  else selectClicked(app, hit);
}

function hitTest(app, x, y, pad) {
  let best = null;
  for (const h of app.hits) {
    const d = Math.hypot(h.x - x, h.y - y);
    const inBox = h.box && x >= h.box.x && x <= h.box.x + h.box.w && y >= h.box.y && y <= h.box.y + h.box.h;
    if (d > h.r + pad && !inBox) continue;
    const score = h.priority * 1000 + (inBox ? h.r : d);
    if (!best || score < best.score) best = { ...h, score };
  }
  return best;
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
      // The ruler starts on the unit under the pointer, which is selected for its leg.
      const unitHit = hit && UNIT_KINDS.has(hit.kind) ? hit : null;
      const w = unitHit ? unitOrigin(app, unitHit) : toWorld(app.camera, p[0], p[1]);
      if (unitHit) selectHit(app, unitHit);
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
    if (hit && UNIT_KINDS.has(hit.kind)) {
      if (headingsMode(app)) {
        // Orders by heading: the drag lays the ruler from the unit.
        const a = unitOrigin(app, hit);
        gesture = { type: 'measure', hit, start: p, moved: false, a };
        return;
      }
      gesture = { type: 'draw', hit, start: p, moved: false };
      app.drawing = { kind: hit.kind, id: hit.id, points: [[hit.x, hit.y]] };
      return;
    }
    gesture = { type: 'pan', last: p, start: p, hit, moved: false };
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
        finishDrawing(app, gesture.hit, points, endHit);
      } else if (!gesture.moved) {
        selectClicked(app, gesture.hit);
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
    } else if (gesture.type === 'measure') {
      if (!gesture.moved) selectClicked(app, gesture.hit);
    } else if (gesture.type === 'mru') {
      if (up && app.ruler && Math.hypot(pos(e)[0] - gesture.start[0], pos(e)[1] - gesture.start[1]) > 12) orderMru(app, app.ruler.a, app.ruler.b);
      app.ruler = null;
    } else if (gesture.type === 'pan' && !gesture.moved && up) {
      // A click on the map itself no longer clears the selection (the panel's cross does).
      if (gesture.hit) selectClicked(app, gesture.hit);
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
    if (key === ' ') {
      togglePause(app);
    } else if (key >= '1' && key <= String(SPEEDS.length)) {
      requestSpeed(app, Number(key) - 1);
    } else if (key === 'a' || key === 'A') {
      goView(app, 'atlantic');
    } else if (key === 'g' || key === 'G') {
      goView(app, 'england');
    } else if (key === 'l' || key === 'L') {
      goView(app, 'britain');
    } else if (key === 'r' || key === 'R') {
      app.setTool(app.tool === 'ruler' ? null : 'ruler');
    } else if (key === 'c' || key === 'C') {
      app.toggleRadarCover();
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
    } else if ((key === 'b' || key === 'B') && sq) {
      toggleBuster(app, sq);
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
