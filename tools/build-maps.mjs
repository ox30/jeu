// Builds the map data used by the game from Natural Earth land polygons (public domain),
// distributed by the world-atlas package.
//
//   cd tools && npm install && node build-maps.mjs
//
// Output (in ../data/maps):
//   atlantic.json  1:50m land, North Atlantic and Western Europe, for the strategic view
//   channel.json   1:10m land, British Isles, Channel and nearby coasts, for the tactical view
//
// Each ring is clipped to a lon/lat box, projected to the game plane (km), simplified and
// stored as delta-encoded integers (unit 0.1 km). Segments that lie on the clipping box are
// listed in "cuts" so that they are filled but never drawn as coastline.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { feature } from 'topojson-client';
import { project, LAT0, LON0 } from '../src/sim/geo.js';

const UNIT = 0.1; // km per integer step
const EDGE_LEFT = 1, EDGE_RIGHT = 2, EDGE_BOTTOM = 4, EDGE_TOP = 8;

function loadLand(file) {
  const topo = JSON.parse(readFileSync(new URL(`./node_modules/world-atlas/${file}`, import.meta.url)));
  const geo = feature(topo, topo.objects.land);
  const geometries = geo.type === 'FeatureCollection' ? geo.features.map((f) => f.geometry) : [geo.geometry];
  const rings = [];
  for (const g of geometries) {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      // world-atlas rings are "stitched": a segment may jump from +179° to -179°. Make the
      // longitudes continuous, then keep the copies shifted by ±360° so that every part of
      // the ring can fall inside the clipping box.
      const unwrapped = [];
      let prev = null;
      for (const [lon, lat] of ring) {
        let l = lon;
        if (prev !== null) {
          let d = lon - (((prev + 180) % 360 + 360) % 360 - 180);
          if (d > 180) d -= 360;
          if (d < -180) d += 360;
          l = prev + d;
        }
        unwrapped.push([l, lat]);
        prev = l;
      }
      const winding = unwrapped[unwrapped.length - 1][0] - unwrapped[0][0];
      if (Math.abs(winding) > 180) continue; // circles a pole (Antarctica): never in our area
      for (const shift of [-360, 0, 360]) rings.push(unwrapped.map(([lon, lat]) => [lon + shift, lat]));
    }
  }
  return rings;
}

// Sutherland–Hodgman clipping of one ring against one box edge, tracking which points lie on
// the box edges (bit mask) so that cut segments can be recognised later.
function clipEdge(points, inside, intersect, bit) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const prev = points[(i + points.length - 1) % points.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push({ ...intersect(prev, cur), mask: (prev.mask & cur.mask) | bit });
      out.push(cur);
    } else if (prevIn) {
      out.push({ ...intersect(prev, cur), mask: (prev.mask & cur.mask) | bit });
    }
  }
  return out;
}

function clipRing(ring, [lonMin, latMin, lonMax, latMax]) {
  let pts = ring.map(([lon, lat]) => ({ lon, lat, mask: 0 }));
  if (pts.length > 1 && pts[0].lon === pts[pts.length - 1].lon && pts[0].lat === pts[pts.length - 1].lat) pts.pop();
  const atLon = (lon) => (a, b) => {
    const t = (lon - a.lon) / (b.lon - a.lon);
    return { lon, lat: a.lat + t * (b.lat - a.lat) };
  };
  const atLat = (lat) => (a, b) => {
    const t = (lat - a.lat) / (b.lat - a.lat);
    return { lon: a.lon + t * (b.lon - a.lon), lat };
  };
  pts = clipEdge(pts, (p) => p.lon >= lonMin, atLon(lonMin), EDGE_LEFT);
  if (pts.length) pts = clipEdge(pts, (p) => p.lon <= lonMax, atLon(lonMax), EDGE_RIGHT);
  if (pts.length) pts = clipEdge(pts, (p) => p.lat >= latMin, atLat(latMin), EDGE_BOTTOM);
  if (pts.length) pts = clipEdge(pts, (p) => p.lat <= latMax, atLat(latMax), EDGE_TOP);
  return pts;
}

// Douglas–Peucker on a closed ring; points on the clipping box are always kept.
function simplifyRing(pts, tolerance) {
  const n = pts.length;
  if (n < 4) return pts;
  const keep = new Uint8Array(n);
  let anchors = [];
  for (let i = 0; i < n; i++) if (pts[i].mask) { keep[i] = 1; anchors.push(i); }
  if (anchors.length === 0) {
    // No forced point: anchor on the first point and the point farthest from it.
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
      if (d > best) { best = d; far = i; }
    }
    anchors = [0, far];
    keep[0] = keep[far] = 1;
  }
  const dp = (from, to) => { // indices on the circular ring, from → to going forward
    const span = (to - from + n) % n || n;
    const stack = [[0, span]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      const A = pts[(from + a) % n], B = pts[(from + b) % n];
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      let maxD = 0, idx = -1;
      for (let k = a + 1; k < b; k++) {
        const P = pts[(from + k) % n];
        const d = len === 0 ? Math.hypot(P.x - A.x, P.y - A.y)
          : Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y)) / len;
        if (d > maxD) { maxD = d; idx = k; }
      }
      if (maxD > tolerance && idx > 0) {
        keep[(from + idx) % n] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
  };
  for (let i = 0; i < anchors.length; i++) dp(anchors[i], anchors[(i + 1) % anchors.length]);
  return pts.filter((_, i) => keep[i]);
}

function ringArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x * pts[i].y - pts[i].x * pts[j].y);
  return Math.abs(s) / 2;
}

function build({ file, clip, tolerance, minArea, out, source }) {
  const rings = loadLand(file);
  const encoded = [];
  const cuts = {};
  let pointCount = 0;
  for (const ring of rings) {
    let pts = clipRing(ring, clip);
    if (pts.length < 3) continue;
    for (const p of pts) [p.x, p.y] = project(p.lon, p.lat);
    pts = simplifyRing(pts, tolerance);
    // Quantise and drop repeated points.
    const q = [];
    for (const p of pts) {
      const qx = Math.round(p.x / UNIT), qy = Math.round(p.y / UNIT);
      const last = q[q.length - 1];
      if (last && last.qx === qx && last.qy === qy) { last.mask |= p.mask; continue; }
      q.push({ qx, qy, mask: p.mask, x: qx * UNIT, y: qy * UNIT });
    }
    if (q.length > 2 && q[0].qx === q[q.length - 1].qx && q[0].qy === q[q.length - 1].qy) q.pop();
    if (q.length < 3 || ringArea(q) < minArea) continue;
    const flat = [];
    let px = 0, py = 0;
    for (const p of q) { flat.push(p.qx - px, p.qy - py); px = p.qx; py = p.qy; }
    const ringCuts = [];
    for (let i = 0; i < q.length; i++) if (q[i].mask & q[(i + 1) % q.length].mask) ringCuts.push(i);
    if (ringCuts.length) cuts[encoded.length] = ringCuts;
    encoded.push(flat);
    pointCount += q.length;
  }
  const [x0, y0] = project(clip[0], clip[1]);
  const [x1, y1] = project(clip[2], clip[3]);
  const data = {
    source,
    projection: { lat0: LAT0, lon0: LON0 },
    unit: UNIT,
    clip,
    box: [x0, y0, x1, y1].map((v) => Math.round(v * 10) / 10),
    rings: encoded,
    cuts,
  };
  mkdirSync(new URL('../data/maps/', import.meta.url), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(new URL(`../data/maps/${out}`, import.meta.url), json);
  console.log(`${out}: ${encoded.length} rings, ${pointCount} points, ${(json.length / 1024).toFixed(0)} KiB`);
}

build({
  file: 'land-50m.json',
  clip: [-80, 24, 32, 76],
  tolerance: 2.0,
  minArea: 40,
  out: 'atlantic.json',
  source: 'Natural Earth 1:50m land, via world-atlas 2.0 (public domain)',
});

build({
  file: 'land-10m.json',
  clip: [-12, 46, 10, 60.5],
  tolerance: 0.15,
  minArea: 0.4,
  out: 'channel.json',
  source: 'Natural Earth 1:10m land, via world-atlas 2.0 (public domain)',
});
