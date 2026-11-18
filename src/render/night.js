// The night's shadow on the map (N2): the table darkens where the sun is down, with a
// gradient through twilight. It asks the same function as the simulation
// (src/sim/daylight.js): what the map shows is what the lookouts, the patrols and the
// U-boats live by.

import { DARK_LIMIT_DEG, DAY_LIMIT_DEG } from '../core/sun.js';
import { sunHeight } from '../sim/daylight.js';
import { toWorld } from './camera.js';

const CELL_PX = 32; // the sun's height is asked every 32 pixels...
const FINE_PX = 4; // ...and the shadow is painted in squares of 4 pixels, interpolated between
const PER_CELL = CELL_PX / FINE_PX;
const SHADE = [30, 40, 64]; // a cold ink, light enough for the pencil marks to stay readable
const MAX_ALPHA = 0.3;

/** How dark it is for a sun at `heightDeg`: 0 by day, 1 once civil twilight is over. */
export function shadowShare(heightDeg) {
  if (heightDeg > DAY_LIMIT_DEG) return 0;
  if (heightDeg <= DARK_LIMIT_DEG) return 1;
  return (DAY_LIMIT_DEG - heightDeg) / (DAY_LIMIT_DEG - DARK_LIMIT_DEG);
}

/**
 * The shadow over the visible map, sampled on a grid of `cellPx` pixels:
 * { cols, rows, share: Float32Array (row by row, from the top left), lit, dark }.
 * `lit`: no shadow anywhere; `dark`: full night everywhere.
 */
export function nightSamples(world, cam, cellPx = CELL_PX) {
  const cols = Math.ceil(cam.width / cellPx) + 1;
  const rows = Math.ceil(cam.height / cellPx) + 1;
  const share = new Float32Array(cols * rows);
  let lit = true;
  let dark = true;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [x, y] = toWorld(cam, i * cellPx, j * cellPx);
      const s = shadowShare(sunHeight(world, x, y));
      share[j * cols + i] = s;
      if (s > 0) lit = false;
      if (s < 1) dark = false;
    }
  }
  return { cols, rows, share, lit, dark };
}

/**
 * Paints the samples into `image` (ImageData of (cols - 1) × PER_CELL by (rows - 1) × PER_CELL
 * pixels), interpolating between them: each pixel is a square of FINE_PX pixels on the map.
 * Stretching a small image smoothly costs the browser far more than these few thousand sums.
 */
function paintShadow(image, n) {
  const px = image.data;
  const w = (n.cols - 1) * PER_CELL;
  const h = (n.rows - 1) * PER_CELL;
  const scale = MAX_ALPHA * 255;
  for (let v = 0; v < h; v++) {
    const fy = (v + 0.5) / PER_CELL;
    const j = Math.floor(fy);
    const ty = fy - j;
    const top = j * n.cols;
    const bottom = top + n.cols;
    for (let u = 0; u < w; u++) {
      const fx = (u + 0.5) / PER_CELL;
      const i = Math.floor(fx);
      const tx = fx - i;
      const a = n.share[top + i] * (1 - tx) + n.share[top + i + 1] * tx;
      const b = n.share[bottom + i] * (1 - tx) + n.share[bottom + i + 1] * tx;
      const k = (v * w + u) * 4;
      px[k] = SHADE[0];
      px[k + 1] = SHADE[1];
      px[k + 2] = SHADE[2];
      px[k + 3] = Math.round((a * (1 - ty) + b * ty) * scale);
    }
  }
}

/** Draws the shadow over the map just painted (the context is in CSS pixels). */
export function drawNight(ctx, cam, app) {
  const world = app.world;
  const minute = Math.floor(world.t / 60);
  if (!app.nightCache) app.nightCache = { key: '', canvas: null, image: null, lit: true, dark: false };
  const c = app.nightCache;
  const key = `${minute}|${cam.cx}|${cam.cy}|${cam.scale}|${cam.width}|${cam.height}`;
  if (c.key !== key) {
    c.key = key;
    const n = nightSamples(world, cam);
    c.lit = n.lit;
    c.dark = n.dark;
    if (!n.lit && !n.dark) {
      const w = (n.cols - 1) * PER_CELL;
      const h = (n.rows - 1) * PER_CELL;
      if (!c.canvas) c.canvas = document.createElement('canvas');
      if (c.canvas.width !== w || c.canvas.height !== h) {
        c.canvas.width = w;
        c.canvas.height = h;
        c.image = null;
      }
      const g = c.canvas.getContext('2d');
      if (!c.image) c.image = g.createImageData(w, h);
      paintShadow(c.image, n);
      g.putImageData(c.image, 0, 0);
    }
  }
  if (c.lit) return;
  ctx.save();
  if (c.dark) {
    ctx.fillStyle = `rgba(${SHADE[0]}, ${SHADE[1]}, ${SHADE[2]}, ${MAX_ALPHA})`;
    ctx.fillRect(0, 0, cam.width, cam.height);
  } else {
    ctx.beginPath();
    ctx.rect(0, 0, cam.width, cam.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = false; // already smooth: plain squares cost nothing to stretch
    ctx.drawImage(c.canvas, 0, 0, c.canvas.width * FINE_PX, c.canvas.height * FINE_PX);
  }
  ctx.restore();
}
