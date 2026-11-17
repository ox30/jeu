// The map itself: sea, land, coastline, graticule, place names, paper texture.
// Land is stored as Path2D objects in world coordinates (km) and drawn through a canvas
// transform, so the geometry is built once and never recomputed.

import { project, unproject } from '../sim/geo.js';
import { toScreen, visibleBox } from './camera.js';

export const PALETTE = {
  sea: '#c7d5cf',
  land: '#eee4c9',
  coast: '#4b402d',
  coastHalo: 'rgba(52, 96, 116, 0.18)',
  grid: 'rgba(82, 70, 46, 0.2)',
  gridText: 'rgba(70, 58, 36, 0.75)',
  seaText: '#4a6a72',
  regionText: 'rgba(96, 78, 48, 0.85)',
  cityText: '#3a3020',
  ink: '#2b241a',
};

export const FONTS = {
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", Courier, monospace',
};

/** Above this scale (pixels per km) the detailed 1:10m coast replaces the 1:50m one. */
const DETAIL_SCALE = 0.75;

function buildPaths(map) {
  const fill = new Path2D();
  const coast = new Path2D();
  for (const ring of map.rings) {
    const p = ring.pts;
    const n = p.length / 2;
    fill.moveTo(p[0], p[1]);
    for (let i = 1; i < n; i++) fill.lineTo(p[2 * i], p[2 * i + 1]);
    fill.closePath();
    const cuts = ring.cuts ? new Set(ring.cuts) : null;
    let open = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (cuts && cuts.has(i)) {
        open = false;
        continue;
      }
      if (!open) {
        coast.moveTo(p[2 * i], p[2 * i + 1]);
        open = true;
      }
      coast.lineTo(p[2 * j], p[2 * j + 1]);
    }
  }
  return { fill, coast, box: map.box };
}

function makePaperTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 200 + rand() * 55;
    img.data[4 * i] = v;
    img.data[4 * i + 1] = v * 0.96;
    img.data[4 * i + 2] = v * 0.88;
    img.data[4 * i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createMapRenderer(terrain, labels) {
  return {
    coarse: buildPaths(terrain.coarse),
    fine: buildPaths(terrain.fine),
    labels: labels.map((l) => {
      const [x, y] = project(l.lon, l.lat);
      return { ...l, x, y };
    }),
    texture: makePaperTexture(),
    pattern: null,
  };
}

function worldTransform(ctx, cam, dpr) {
  ctx.setTransform(dpr * cam.scale, 0, 0, -dpr * cam.scale, dpr * (cam.width / 2 - cam.cx * cam.scale), dpr * (cam.height / 2 + cam.cy * cam.scale));
}

function drawLand(ctx, cam, layer, haloPx) {
  const s = cam.scale;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PALETTE.coastHalo;
  ctx.lineWidth = haloPx / s;
  ctx.stroke(layer.coast);
  ctx.fillStyle = PALETTE.land;
  ctx.fill(layer.fill, 'evenodd');
  ctx.strokeStyle = PALETTE.coast;
  ctx.lineWidth = 1.1 / s;
  ctx.stroke(layer.coast);
}

/**
 * The base map (sea, land, graticule, names, paper grain) changes only when the view does: it
 * is painted once into a canvas of its own and copied on every frame until the camera moves.
 */
export function drawMap(ctx, cam, dpr, mr) {
  const width = Math.max(1, Math.round(cam.width * dpr));
  const height = Math.max(1, Math.round(cam.height * dpr));
  const key = `${cam.cx}|${cam.cy}|${cam.scale}|${cam.width}|${cam.height}|${dpr}`;
  if (typeof document === 'undefined') {
    paintMap(ctx, cam, dpr, mr);
    return;
  }
  if (!mr.cache) mr.cache = { canvas: document.createElement('canvas'), key: '' };
  const c = mr.cache;
  if (c.key !== key) {
    if (c.canvas.width !== width || c.canvas.height !== height) {
      c.canvas.width = width;
      c.canvas.height = height;
    }
    paintMap(c.canvas.getContext('2d'), cam, dpr, mr);
    c.key = key;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(c.canvas, 0, 0);
}

function paintMap(ctx, cam, dpr, mr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PALETTE.sea;
  ctx.fillRect(0, 0, cam.width, cam.height);

  ctx.save();
  worldTransform(ctx, cam, dpr);
  drawLand(ctx, cam, mr.coarse, 7);
  if (cam.scale >= DETAIL_SCALE) {
    // Repaint the detailed area with the 1:10m coast, slightly inside its box so that the
    // box edges never show.
    const b = mr.fine.box;
    const inset = 3 / cam.scale;
    ctx.beginPath();
    ctx.rect(b[0] + inset, b[1] + inset, b[2] - b[0] - 2 * inset, b[3] - b[1] - 2 * inset);
    ctx.clip();
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    drawLand(ctx, cam, mr.fine, 9);
  }
  ctx.restore();

  drawGraticule(ctx, cam, dpr);
  drawLabels(ctx, cam, dpr, mr);

  // Paper grain over everything drawn so far.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!mr.pattern) mr.pattern = ctx.createPattern(mr.texture, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = mr.pattern;
  ctx.fillRect(0, 0, cam.width, cam.height);
  ctx.restore();
}

function gridStep(scale) {
  if (scale < 0.3) return 10;
  if (scale < 0.9) return 5;
  if (scale < 3.5) return 1;
  return 0.5;
}

function formatLon(lon) {
  const v = Math.abs(lon);
  const text = Number.isInteger(v) ? `${v}°` : `${Math.floor(v)}°30′`;
  return lon === 0 ? '0°' : `${text} ${lon < 0 ? 'O' : 'E'}`;
}

function formatLat(lat) {
  const v = Math.abs(lat);
  const text = Number.isInteger(v) ? `${v}°` : `${Math.floor(v)}°30′`;
  return `${text} ${lat < 0 ? 'S' : 'N'}`;
}

function drawGraticule(ctx, cam, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const [x0, y0, x1, y1] = visibleBox(cam);
  const [lon0, lat0] = unproject(x0, y0);
  const [lon1, lat1] = unproject(x1, y1);
  const stepDeg = gridStep(cam.scale);
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = PALETTE.gridText;
  ctx.font = `11px ${FONTS.serif}`;
  ctx.beginPath();
  const lons = [];
  for (let lon = Math.ceil(lon0 / stepDeg) * stepDeg; lon <= lon1; lon += stepDeg) {
    const [sx] = toScreen(cam, project(lon, 0)[0], 0);
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, cam.height);
    lons.push([lon, sx]);
  }
  const lats = [];
  for (let lat = Math.ceil(lat0 / stepDeg) * stepDeg; lat <= lat1; lat += stepDeg) {
    const [, sy] = toScreen(cam, 0, project(0, lat)[1]);
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(cam.width, Math.round(sy) + 0.5);
    lats.push([lat, sy]);
  }
  ctx.stroke();
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  for (const [lon, sx] of lons) ctx.fillText(formatLon(Math.round(lon * 2) / 2), sx + 3, cam.height - 4);
  ctx.textBaseline = 'top';
  for (const [lat, sy] of lats) ctx.fillText(formatLat(Math.round(lat * 2) / 2), 4, sy + 2);
}

function spaced(text, spacing) {
  return spacing ? text.split('').join(' ') : text;
}

function drawLabels(ctx, cam, dpr, mr) {
  // Seas and regions only: towns are placed with the other symbols, avoiding overlaps.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of mr.labels) {
    if (l.kind === 'city') continue;
    if (!labelVisible(l, cam.scale)) continue;
    const [sx, sy] = toScreen(cam, l.x, l.y);
    if (sx < -200 || sy < -50 || sx > cam.width + 200 || sy > cam.height + 50) continue;
    if (l.kind === 'sea') {
      ctx.font = `italic ${cam.scale < 0.5 ? 13 : 15}px ${FONTS.serif}`;
      ctx.fillStyle = PALETTE.seaText;
    } else {
      ctx.font = `${cam.scale < 0.5 ? 11 : 13}px ${FONTS.serif}`;
      ctx.fillStyle = PALETTE.regionText;
    }
    ctx.fillText(spaced(l.text, true), sx, sy);
  }
}

export function labelVisible(l, scale) {
  if (l.minScale !== undefined && scale < l.minScale) return false;
  if (l.maxScale !== undefined && scale > l.maxScale) return false;
  return true;
}
