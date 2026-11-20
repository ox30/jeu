// Land and sea, from the map files built by tools/build-maps.mjs.

import { distance, polylineLength, project } from './geo.js';

/** Decodes a map file (delta-encoded integer rings) into rings of km coordinates. */
export function decodeMap(data) {
  const rings = data.rings.map((encoded, index) => {
    const pts = new Float64Array(encoded.length);
    let x = 0;
    let y = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < encoded.length; k += 2) {
      x += encoded[k];
      y += encoded[k + 1];
      const px = x * data.unit;
      const py = y * data.unit;
      pts[k] = px;
      pts[k + 1] = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return { pts, box: [minX, minY, maxX, maxY], cuts: data.cuts[index] || null };
  });
  return { rings, box: data.box, clip: data.clip, source: data.source };
}

/** Even-odd point-in-polygon test over a set of rings (holes are handled by parity). */
export function pointInRings(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    const b = ring.box;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    const p = ring.pts;
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[2 * i], yi = p[2 * i + 1];
      const xj = p[2 * j], yj = p[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const CLASS_KM = 5; // size of the cells of the land-or-sea raster

export function createTerrain(coarseData, fineData) {
  const coarse = decodeMap(coarseData);
  const fine = decodeMap(fineData);
  const fb = fine.box;
  const inFine = (x, y) => x >= fb[0] && x <= fb[2] && y >= fb[1] && y <= fb[3];

  /** Land or sea at a point, from the coastlines themselves. */
  function isLandExact(x, y) {
    return inFine(x, y) ? pointInRings(fine.rings, x, y) : pointInRings(coarse.rings, x, y);
  }

  // The map cut into cells of 5 km, each one all sea (0), all land (1) or crossed by a
  // coastline (2). Built on the first question; the ocean and the inland then answer at once,
  // and only the cells of the coast go back to the coastlines. The answers are the same.
  let classes = null;
  function classGrid() {
    const cb = coarse.box;
    const S = CLASS_KM;
    const c0 = Math.floor(cb[0] / S);
    const r0 = Math.floor(cb[1] / S);
    const cols = Math.ceil(cb[2] / S) - c0;
    const rows = Math.ceil(cb[3] / S) - r0;
    const data = new Uint8Array(cols * rows);
    const mark = (c, r, v) => {
      if (c >= 0 && r >= 0 && c < cols && r < rows) data[r * cols + c] = v;
    };
    // Land where the centre of the cell is on land (a scanline fill of the rings that count
    // there: the detailed coastlines inside their box, the coarse ones elsewhere).
    const fill = (rings, y, row, keep) => {
      const xs = [];
      for (const ring of rings) {
        if (y < ring.box[1] || y > ring.box[3]) continue;
        const p = ring.pts;
        const n = p.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const yi = p[2 * i + 1];
          const yj = p[2 * j + 1];
          if ((yi > y) !== (yj > y)) xs.push(p[2 * i] + ((p[2 * j] - p[2 * i]) * (y - yi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] / S - 0.5) - c0);
        const to = Math.min(cols - 1, Math.floor(xs[k + 1] / S - 0.5) - c0);
        for (let c = from; c <= to; c++) if (keep((c0 + c + 0.5) * S)) data[row * cols + c] = 1;
      }
    };
    const inFineX = (x) => x >= fb[0] && x <= fb[2];
    for (let row = 0; row < rows; row++) {
      const y = (r0 + row + 0.5) * S;
      const fineRow = y >= fb[1] && y <= fb[3];
      fill(coarse.rings, y, row, (x) => !fineRow || !inFineX(x));
      if (fineRow) fill(fine.rings, y, row, inFineX);
    }
    // Every cell a coastline passes through (a walk along each segment, cell by cell).
    const walk = (ax, ay, bx, by) => {
      let c = Math.floor(ax / S) - c0;
      let r = Math.floor(ay / S) - r0;
      const ec = Math.floor(bx / S) - c0;
      const er = Math.floor(by / S) - r0;
      const dx = bx - ax;
      const dy = by - ay;
      const sc = dx > 0 ? 1 : -1;
      const sr = dy > 0 ? 1 : -1;
      let tx = dx !== 0 ? ((c0 + c + (dx > 0 ? 1 : 0)) * S - ax) / dx : Infinity;
      let ty = dy !== 0 ? ((r0 + r + (dy > 0 ? 1 : 0)) * S - ay) / dy : Infinity;
      const ux = dx !== 0 ? S / Math.abs(dx) : Infinity;
      const uy = dy !== 0 ? S / Math.abs(dy) : Infinity;
      mark(c, r, 2);
      for (let guard = 0; (c !== ec || r !== er) && guard < 100000; guard++) {
        if (tx < ty) {
          c += sc;
          tx += ux;
        } else if (ty < tx) {
          r += sr;
          ty += uy;
        } else {
          // Right through a corner: the two cells beside it are touched too.
          mark(c + sc, r, 2);
          mark(c, r + sr, 2);
          c += sc;
          r += sr;
          tx += ux;
          ty += uy;
        }
        mark(c, r, 2);
      }
    };
    for (const set of [coarse.rings, fine.rings]) {
      for (const ring of set) {
        const p = ring.pts;
        const n = p.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) walk(p[2 * j], p[2 * j + 1], p[2 * i], p[2 * i + 1]);
      }
    }
    // The edge of the detailed map: the coastline changes there.
    walk(fb[0], fb[1], fb[2], fb[1]);
    walk(fb[2], fb[1], fb[2], fb[3]);
    walk(fb[2], fb[3], fb[0], fb[3]);
    walk(fb[0], fb[3], fb[0], fb[1]);
    classes = { c0, r0, cols, rows, data };
    return classes;
  }

  function isLand(x, y) {
    const g = classes || classGrid();
    const c = Math.floor(x / CLASS_KM) - g.c0;
    const r = Math.floor(y / CLASS_KM) - g.r0;
    if (c >= 0 && r >= 0 && c < g.cols && r < g.rows) {
      const kind = g.data[r * g.cols + c];
      if (kind !== 2) return kind === 1;
    }
    return isLandExact(x, y);
  }

  // Great Britain is the detailed ring that contains London.
  const [lx, ly] = project(-0.128, 51.507);
  const britain = fine.rings.find((ring) => pointInRings([ring], lx, ly)) || null;

  function isOverBritain(x, y) {
    return britain !== null && pointInRings([britain], x, y);
  }

  // The land the Observer Corps watched: Great Britain and the islands close to it (Wight,
  // Sheppey...), not Ireland nor the Channel Islands.
  let britishRings = null;
  function getBritishRings(nearKm = 40) {
    if (britishRings) return britishRings;
    if (!britain) return (britishRings = []);
    const p = britain.pts;
    const gb = britain.box;
    britishRings = fine.rings.filter((ring) => {
      if (ring === britain) return true;
      const b = ring.box;
      const cx = (b[0] + b[2]) / 2;
      const cy = (b[1] + b[3]) / 2;
      if (cx < gb[0] - nearKm || cx > gb[2] + nearKm || cy < gb[1] - nearKm || cy > gb[3] + nearKm) return false;
      for (let k = 0; k < p.length; k += 2) if (Math.hypot(p[k] - cx, p[k + 1] - cy) < nearKm) return true;
      return false;
    });
    return britishRings;
  }

  /**
   * Grid of what the Observer Corps can see: 2 on British land, 1 at sea within
   * `offshoreKm` of it, 0 elsewhere. Built once per setting.
   */
  const masks = new Map();
  function observerMask(cellKm, offshoreKm) {
    const key = `${cellKm}:${offshoreKm}`;
    if (masks.has(key)) return masks.get(key);
    const rings = getBritishRings();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) {
      x0 = Math.min(x0, r.box[0]);
      y0 = Math.min(y0, r.box[1]);
      x1 = Math.max(x1, r.box[2]);
      y1 = Math.max(y1, r.box[3]);
    }
    const pad = offshoreKm + 2 * cellKm;
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    const cols = Math.max(1, Math.ceil((x1 - x0) / cellKm));
    const rows = Math.max(1, Math.ceil((y1 - y0) / cellKm));
    const land = new Uint8Array(cols * rows);
    // Scanline fill, even-odd over all the rings.
    for (let row = 0; row < rows; row++) {
      const y = y0 + (row + 0.5) * cellKm;
      const xs = [];
      for (const ring of rings) {
        if (y < ring.box[1] || y > ring.box[3]) continue;
        const p = ring.pts;
        const n = p.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const yi = p[2 * i + 1];
          const yj = p[2 * j + 1];
          if ((yi > y) !== (yj > y)) xs.push(p[2 * i] + ((p[2 * j] - p[2 * i]) * (y - yi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cellKm - 0.5));
        const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - x0) / cellKm - 0.5));
        for (let c = c0; c <= c1; c++) land[row * cols + c] = 2;
      }
    }
    // The posts on the coast see some way out to sea.
    const data = land.slice();
    const rc = offshoreKm / cellKm;
    const r = Math.ceil(rc);
    const disc = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= rc * rc) disc.push(dy * cols + dx, dx, dy);
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        if (land[i] !== 2) continue;
        if (land[i - 1] && land[i + 1] && land[i - cols] && land[i + cols]) continue;
        for (let k = 0; k < disc.length; k += 3) {
          const cc = col + disc[k + 1];
          const rr = row + disc[k + 2];
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = i + disc[k];
          if (data[j] === 0) data[j] = 1;
        }
      }
    }
    const mask = { x0, y0, cellKm, cols, rows, data };
    masks.set(key, mask);
    return mask;
  }

  function isObserved(x, y, cellKm, offshoreKm) {
    const m = observerMask(cellKm, offshoreKm);
    const c = Math.floor((x - m.x0) / m.cellKm);
    const r = Math.floor((y - m.y0) / m.cellKm);
    if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return false;
    return m.data[r * m.cols + c] > 0;
  }

  /**
   * First land point met along a route [[x, y], ...], or null. The first `skipStartKm` and
   * the last `skipEndKm` are ignored (leaving and entering a harbour).
   */
  function findLandOnRoute(points, skipStartKm = 0, skipEndKm = 0, stepKm = 3) {
    const total = polylineLength(points);
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const len = distance(ax, ay, bx, by);
      // Samples every stepKm of the plane (the coastline's own scale), counted in real km.
      const steps = Math.max(1, Math.ceil(Math.max(len, Math.hypot(bx - ax, by - ay)) / stepKm));
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const along = travelled + f * len;
        if (along < skipStartKm || along > total - skipEndKm) continue;
        const x = ax + (bx - ax) * f;
        const y = ay + (by - ay) * f;
        if (isLand(x, y)) return [x, y];
      }
      travelled += len;
    }
    return null;
  }

  classGrid(); // now, at loading time, rather than in the middle of a game
  return { coarse, fine, isLand, isLandExact, isOverBritain, getBritishRings, observerMask, isObserved, findLandOnRoute };
}
