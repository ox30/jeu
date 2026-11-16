// Camera over the world plane: centre (km), scale (pixels per km), smooth animated moves.

import { project } from '../sim/geo.js';

export const VIEWS = {
  atlantic: { lon: [-67, 13], lat: [38.5, 64] },
  england: { lon: [-3.9, 3.0], lat: [49.45, 52.75] },
  britain: { lon: [-6.8, 2.4], lat: [49.9, 56.4] },
};

export function createCamera() {
  return { cx: 0, cy: 0, scale: 0.2, width: 800, height: 600, anim: null, minScale: 0.05, maxScale: 14 };
}

export function toScreen(cam, x, y) {
  return [cam.width / 2 + (x - cam.cx) * cam.scale, cam.height / 2 - (y - cam.cy) * cam.scale];
}

export function toWorld(cam, sx, sy) {
  return [cam.cx + (sx - cam.width / 2) / cam.scale, cam.cy - (sy - cam.height / 2) / cam.scale];
}

/** World box [x0, y0, x1, y1] currently visible. */
export function visibleBox(cam) {
  const [x0, y1] = toWorld(cam, 0, 0);
  const [x1, y0] = toWorld(cam, cam.width, cam.height);
  return [x0, y0, x1, y1];
}

/** Centre and scale that fit a lon/lat view in the screen, leaving `margin` pixels. */
export function viewFrame(cam, view, margin = 30) {
  const [x0, y0] = project(view.lon[0], view.lat[0]);
  const [x1, y1] = project(view.lon[1], view.lat[1]);
  const scale = Math.min((cam.width - 2 * margin) / (x1 - x0), (cam.height - 2 * margin) / (y1 - y0));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: clampScale(cam, scale) };
}

function clampScale(cam, s) {
  return Math.max(cam.minScale, Math.min(cam.maxScale, s));
}

export function setFrame(cam, frame) {
  cam.anim = null;
  cam.cx = frame.cx;
  cam.cy = frame.cy;
  cam.scale = frame.scale;
}

export function animateTo(cam, frame, duration = 0.9) {
  cam.anim = { from: { cx: cam.cx, cy: cam.cy, scale: cam.scale }, to: frame, t: 0, duration };
}

/** Zooms by `factor` keeping the world point under the screen point (sx, sy) in place. */
export function zoomAt(cam, sx, sy, factor) {
  cam.anim = null;
  const [wx, wy] = toWorld(cam, sx, sy);
  cam.scale = clampScale(cam, cam.scale * factor);
  const [wx2, wy2] = toWorld(cam, sx, sy);
  cam.cx += wx - wx2;
  cam.cy += wy - wy2;
}

export function panBy(cam, dxPixels, dyPixels) {
  cam.anim = null;
  cam.cx -= dxPixels / cam.scale;
  cam.cy += dyPixels / cam.scale;
}

/** Keeps the centre inside the world box. */
export function clampCentre(cam, box) {
  cam.cx = Math.max(box[0], Math.min(box[2], cam.cx));
  cam.cy = Math.max(box[1], Math.min(box[3], cam.cy));
}

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export function updateCamera(cam, dt) {
  const a = cam.anim;
  if (!a) return;
  a.t += dt;
  const k = ease(Math.min(1, a.t / a.duration));
  // Zoom on a log scale, and move the centre so that the motion looks steady on screen.
  const ls = Math.log(a.from.scale) + (Math.log(a.to.scale) - Math.log(a.from.scale)) * k;
  cam.scale = Math.exp(ls);
  cam.cx = a.from.cx + (a.to.cx - a.from.cx) * k;
  cam.cy = a.from.cy + (a.to.cy - a.from.cy) * k;
  if (a.t >= a.duration) cam.anim = null;
}
