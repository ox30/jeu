// Mouse, touch and keyboard.
//  - drag from a unit (convoy, squadron in the air, aerodrome): draws its route; when the
//    orders are given by heading, the drag measures a heading from the unit instead;
//  - drag elsewhere: moves the map; wheel or pinch: zooms;
//  - click: selects; ruler tool: measures a heading and a distance.

import { panBy, toWorld, zoomAt } from '../render/camera.js';
import {
  SPEEDS, addRulerLeg, changeAltitude, findUnit, finishDrawing, goView, headingsMode, orderHome, orderOrbit,
  scrambleSquadron, select, selectedSquadron, selectedUnit, setSpeedIndex, toggleBuster, togglePause,
} from './actions.js';

/** World position a measurement starts from when the player drags from a unit. */
function unitOrigin(app, hit) {
  const u = findUnit(app, hit.kind, hit.id);
  return u ? [u.x, u.y] : toWorld(app.camera, hit.x, hit.y);
}

/** Selection made by a drag from an aerodrome: its first ready squadron, or the aerodrome. */
function selectFromAirfield(app, fieldId) {
  const sq = app.world.squadrons.find((s) => s.airfield === fieldId && s.state === 'ready');
  if (sq) select(app, 'squadron', sq.id);
  else select(app, 'airfield', fieldId);
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
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if (pointers.size > 2) return;
    if (app.tool === 'ruler') {
      const w = toWorld(app.camera, p[0], p[1]);
      app.ruler = { a: w, b: w };
      gesture = { type: 'ruler' };
      return;
    }
    const hit = hitTest(app, p[0], p[1], e.pointerType === 'touch' ? 14 : 6);
    if (hit && (hit.kind === 'squadron' || hit.kind === 'convoy' || hit.kind === 'airfield' || hit.kind === 'escort')) {
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
      const hit = app.tool ? null : hitTest(app, p[0], p[1], 6);
      canvas.style.cursor = app.tool === 'ruler' ? 'crosshair' : hit ? 'pointer' : 'grab';
      return;
    }
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (gesture.dist > 0) zoomAt(app.camera, mid[0], mid[1], dist / gesture.dist);
      panBy(app.camera, mid[0] - gesture.mid[0], mid[1] - gesture.mid[1]);
      gesture.dist = dist;
      gesture.mid = mid;
    } else if (gesture.type === 'draw') {
      const pts = app.drawing.points;
      const last = pts[pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 5) pts.push(p);
      if (Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > 10) gesture.moved = true;
    } else if (gesture.type === 'pan') {
      panBy(app.camera, p[0] - gesture.last[0], p[1] - gesture.last[1]);
      gesture.last = p;
      if (Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > 5) gesture.moved = true;
      canvas.style.cursor = 'grabbing';
    } else if (gesture.type === 'ruler') {
      app.ruler.b = toWorld(app.camera, p[0], p[1]);
    } else if (gesture.type === 'measure') {
      if (!gesture.moved && Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) > 10) {
        gesture.moved = true;
        if (gesture.hit.kind === 'airfield') selectFromAirfield(app, gesture.hit.id);
        else select(app, gesture.hit.kind, gesture.hit.id);
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
    if (gesture.type === 'draw') {
      if (gesture.moved && app.drawing && e.type === 'pointerup') {
        const points = [...app.drawing.points, pos(e)];
        finishDrawing(app, gesture.hit, points);
      } else if (!gesture.moved) {
        select(app, gesture.hit.kind, gesture.hit.id);
      }
      app.drawing = null;
    } else if (gesture.type === 'measure') {
      if (!gesture.moved) select(app, gesture.hit.kind, gesture.hit.id);
    } else if (gesture.type === 'pan' && !gesture.moved && e.type === 'pointerup') {
      select(app, gesture.hit ? gesture.hit.kind : null, gesture.hit ? gesture.hit.id : null);
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
    zoomAt(app.camera, p[0], p[1], e.shiftKey ? 0.5 : 2);
  });

  window.addEventListener('keydown', (e) => {
    app.unlockAudio();
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    const sq = selectedSquadron(app);
    const unit = selectedUnit(app);
    const key = e.key;
    if (key === ' ') {
      togglePause(app);
    } else if (key >= '1' && key <= String(SPEEDS.length)) {
      setSpeedIndex(app, Number(key) - 1);
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
      app.setTool(null);
      select(app, null, null);
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && sq) {
      changeAltitude(app, sq, key === 'ArrowUp' ? 1000 : -1000);
    } else if (key === 'Enter' && unit && app.ruler) {
      addRulerLeg(app, unit);
    } else if ((key === 's' || key === 'S') && sq && sq.state === 'ready') {
      scrambleSquadron(app, sq);
    } else if ((key === 'b' || key === 'B') && sq) {
      toggleBuster(app, sq);
    } else if ((key === 'o' || key === 'O') && sq) {
      orderOrbit(app, sq);
    } else if ((key === 'p' || key === 'P') && sq) {
      orderHome(app, sq);
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
