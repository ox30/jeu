// Draws one frame of the plotting table and records where the clickable things are.

import { formatNumber, t } from '../core/i18n.js';
import { clockColorIndex, formatTime } from '../core/time.js';
import { FOOT_M, distance, headingOf, project } from '../sim/geo.js';
import { columnLetter } from '../sim/grid.js';
import { solveIntercept } from '../sim/intercept.js';
import { editableRoute, navigationEnd, planTrack, routeCanExtend } from '../sim/orders.js';
import { contactEstimate, nearestContact, visiblePlots } from '../sim/query.js';
import { feetOf, isFlying, squadronSpeed } from '../sim/squadron.js';
import { currentSpeed } from '../sim/convoy.js';
import { radarRangeFactor, siteStatus } from '../sim/sites.js';
import { countText, dateTimeText, durationText, ftText, relFtText } from '../ui/format.js';
import { toScreen } from './camera.js';
import { drawEffects, drawMelee, stalkPx } from './fx.js';
import { FONTS, PALETTE, drawMap, labelVisible } from './map.js';
import {
  COLORS, aerodrome, anchor, balkenkreuz, damageMark, depot, factory, measurePlaque, patrolMark, pencilLine, plaque,
  plotArrow, radarMast, roundel, ship, train, uboatMark, warship,
} from './symbols.js';
import { isSubmerged, reachKm } from '../sim/asw.js';
import { isPatrol, sightKm } from '../sim/patrols.js';
import { fuelDays } from '../sim/logistics.js';
import { drawDevLayer } from './devLayer.js';
import { formationById } from '../sim/formations.js';
import { rallyPoint } from '../sim/rally.js';

const DEG = Math.PI / 180;

function lerp(a, b, k) {
  return a + (b - a) * k;
}

function unitScreen(cam, u, alpha) {
  return toScreen(cam, lerp(u.px, u.x, alpha), lerp(u.py, u.y, alpha));
}

function onScreen(cam, sx, sy, margin = 60) {
  return sx > -margin && sy > -margin && sx < cam.width + margin && sy < cam.height + margin;
}

function isSelected(app, kind, id) {
  return app.selection && app.selection.kind === kind && app.selection.id === id;
}

/** Formation of each squadron or escort group: id → { f, index } (0: the leader). */
function formationIndex(world, kind) {
  const map = new Map();
  for (const f of world.formations || []) {
    if (f.kind !== kind) continue;
    f.members.forEach((id, index) => map.set(id, { f, index }));
  }
  return map;
}

function selectedUnit(app) {
  const sel = app.selection;
  if (!sel) return null;
  if (sel.kind === 'formation') {
    const f = formationById(app.world, sel.id);
    if (!f) return null;
    const list = f.kind === 'air' ? app.world.squadrons : app.world.escorts;
    return list.find((u) => u.id === f.members[0]) || null;
  }
  if (sel.kind === 'squadron') return app.world.squadrons.find((s) => s.id === sel.id) || null;
  if (sel.kind === 'convoy') return app.world.convoys.find((c) => c.id === sel.id) || null;
  if (sel.kind === 'escort') return app.world.escorts.find((e) => e.id === sel.id) || null;
  return null;
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Draws a plaque next to a symbol at (x, y), on the first side where it does not cover
 * another plaque of this frame; a thin leader line joins it when it had to move away.
 */
function placePlaque(ctx, app, x, y, lines, opts = {}, r = 10) {
  const { w, h } = measurePlaque(ctx, lines, opts.size || 11);
  const right = x + r;
  const left = x - r - w;
  const candidates = [
    [right, y], [left, y], [right, y - h - 3], [right, y + h + 3], [left, y - h - 3], [left, y + h + 3],
    [right, y - 2 * h - 6], [right, y + 2 * h + 6], [left, y - 2 * h - 6], [left, y + 2 * h + 6],
  ];
  let pick = candidates[0];
  for (const c of candidates) {
    const rect = { x: c[0], y: c[1] - h / 2, w, h };
    if (!app.plaqueBoxes.some((b) => boxesOverlap(rect, b))) {
      pick = c;
      break;
    }
  }
  if (pick[1] !== y) {
    ctx.strokeStyle = 'rgba(43, 36, 26, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(pick[0] === right ? pick[0] : pick[0] + w, pick[1]);
    ctx.stroke();
  }
  const box = plaque(ctx, pick[0], pick[1], lines, opts);
  app.plaqueBoxes.push(box);
  return box;
}

// ---- grid and coverage -------------------------------------------------------------

function drawGrid(ctx, cam, grid) {
  if (!grid || cam.scale < 0.55) return;
  const [gx0, gy0] = toScreen(cam, grid.x0, grid.y0);
  const size = grid.size * cam.scale;
  const gx1 = gx0 + grid.cols * size;
  const gy1 = gy0 + grid.rows * size;
  if (gx1 < 0 || gy1 < 0 || gx0 > cam.width || gy0 > cam.height) return;
  const top = Math.max(0, gy0);
  const bottom = Math.min(cam.height, gy1);
  const left = Math.max(0, gx0);
  const right = Math.min(cam.width, gx1);
  ctx.strokeStyle = 'rgba(150, 62, 38, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= grid.cols; c++) {
    const x = Math.round(gx0 + c * size) + 0.5;
    if (x < 0 || x > cam.width) continue;
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let r = 0; r <= grid.rows; r++) {
    const y = Math.round(gy0 + r * size) + 0.5;
    if (y < 0 || y > cam.height) continue;
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(130, 52, 32, 0.75)';
  ctx.font = `bold 11px ${FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c < grid.cols; c++) {
    const x = gx0 + (c + 0.5) * size;
    if (x > 30 && x < cam.width - 50) ctx.fillText(columnLetter(c), x, top + 3);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < grid.rows; r++) {
    const y = gy0 + (r + 0.5) * size;
    if (y > 60 && y < cam.height - 40) ctx.fillText(String(r + 1), right - 4, y);
  }
  if (size > 110) {
    ctx.font = `10px ${FONTS.mono}`;
    ctx.fillStyle = 'rgba(130, 52, 32, 0.45)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let c = 0; c < grid.cols; c++) {
      const x = gx0 + c * size;
      if (x + size < 0 || x > cam.width) continue;
      for (let r = 0; r < grid.rows; r++) {
        const y = gy0 + r * size;
        if (y + size < 0 || y > cam.height) continue;
        ctx.fillText(`${columnLetter(c)}${r + 1}`, x + 4, y + 4);
      }
    }
  }
}

/** The sea watched by the Observer Corps from the coast, as a light band. */
function drawObserverZone(ctx, cam, world) {
  const D = world.rules.detection;
  const m = world.terrain.observerMask(D.observerCellKm, D.observerOffshoreKm);
  if (!m.canvas) {
    const canvas = document.createElement('canvas');
    canvas.width = m.cols;
    canvas.height = m.rows;
    const g = canvas.getContext('2d');
    const img = g.createImageData(m.cols, m.rows);
    for (let row = 0; row < m.rows; row++) {
      for (let col = 0; col < m.cols; col++) {
        if (m.data[row * m.cols + col] !== 1) continue;
        const i = ((m.rows - 1 - row) * m.cols + col) * 4;
        img.data[i] = 64;
        img.data[i + 1] = 92;
        img.data[i + 2] = 52;
        img.data[i + 3] = 70;
      }
    }
    g.putImageData(img, 0, 0);
    m.canvas = canvas;
  }
  const [x0, y0] = toScreen(cam, m.x0, m.y0 + m.rows * m.cellKm);
  const size = m.cellKm * cam.scale;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(m.canvas, x0, y0, m.cols * size, m.rows * size);
  ctx.restore();
}

function drawCoverage(ctx, cam, world) {
  const D = world.rules.detection;
  drawObserverZone(ctx, cam, world);
  const base = Math.min(D.radarMaxRangeKm, D.radarMinRangeKm + D.radarRangePerM * 4000);
  ctx.save();
  for (const s of world.radars) {
    const factor = radarRangeFactor(world, s);
    const [sx, sy] = toScreen(cam, s.x, s.y);
    const a0 = (s.azimuth - D.radarHalfArcDeg - 90) * DEG;
    const a1 = (s.azimuth + D.radarHalfArcDeg - 90) * DEG;
    const r = base * Math.max(factor, 0) * cam.scale;
    if (factor > 0) {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, r, a0, a1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(168, 50, 45, 0.045)';
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(168, 50, 45, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (factor < 1) {
      // What the station would see intact: the gap left by the damage.
      ctx.beginPath();
      ctx.arc(sx, sy, base * cam.scale, a0, a1);
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = 'rgba(120, 30, 25, 0.6)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

// ---- label placement: towns and installations are moved around their symbol ---------

function overlaps(r, list) {
  return list.some((b) => r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y);
}

const AROUND = (s, w, h) => [
  [s + 3, -h / 2], [-s - 3 - w, -h / 2], [s + 3, -h - 1], [s + 3, 1], [-w / 2, s + 2], [-w / 2, -s - 2 - h],
];

/**
 * Places a block of text lines around (x, y). `lines` are { text, font, color }.
 * Returns false when no free spot was found (and `force` is false).
 */
function placeText(ctx, occupied, x, y, lines, symbolRadius, force = false) {
  const lineH = 13;
  let w = 0;
  for (const l of lines) {
    ctx.font = l.font;
    w = Math.max(w, ctx.measureText(l.text).width);
  }
  w = Math.ceil(w) + 2;
  const h = lines.length * lineH;
  let rect = null;
  for (const [dx, dy] of AROUND(symbolRadius, w, h)) {
    const r = { x: x + dx, y: y + dy, w, h };
    if (!overlaps(r, occupied)) {
      rect = r;
      break;
    }
  }
  if (!rect) {
    if (!force) return false;
    rect = { x: x + symbolRadius + 3, y: y - h / 2, w, h };
  }
  occupied.push(rect);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, rect.x + 1, rect.y + lineH / 2 + i * lineH);
  });
  return true;
}

function siteColor(status, normal) {
  if (status === 'out') return COLORS.rafRed;
  if (status === 'damaged') return '#8a5a0b';
  return normal;
}

function drawPlaces(ctx, cam, app) {
  const world = app.world;
  const s = cam.scale;
  const now = performance.now();
  const occupied = [];
  const box = (x, y, r) => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
  const marks = [];

  // 1. Symbols first, so that no text is written over them.
  const radars = [];
  if (s > 0.9) {
    for (const r of world.radars) {
      const [sx, sy] = toScreen(cam, r.x, r.y);
      if (!onScreen(cam, sx, sy)) continue;
      radarMast(ctx, sx, sy);
      occupied.push(box(sx, sy, 7));
      radars.push({ r, sx, sy, status: siteStatus(world, r) });
      app.hits.push({ kind: 'site', id: r.key, x: sx, y: sy, r: 10, priority: 4 });
      marks.push([sx, sy, siteStatus(world, r), r.damage]);
    }
  }
  const ports = [];
  for (const p of world.ports) {
    if (p.naval && s <= 0.9) continue;
    const [sx, sy] = toScreen(cam, p.x, p.y);
    if (!onScreen(cam, sx, sy)) continue;
    const status = siteStatus(world, p);
    anchor(ctx, sx, sy, p.naval ? 6 : 7, siteColor(status, p.naval ? PALETTE.ink : COLORS.route));
    occupied.push(box(sx, sy, 7));
    ports.push({ p, sx, sy, status });
    if (!p.foreign) app.hits.push({ kind: 'site', id: p.key, x: sx, y: sy, r: 10, priority: 4 });
    marks.push([sx, sy, status, p.damage]);
  }
  const factories = [];
  if (s > 0.3) {
    for (const f of world.factories) {
      const [sx, sy] = toScreen(cam, f.x, f.y);
      if (!onScreen(cam, sx, sy)) continue;
      const status = siteStatus(world, f);
      factory(ctx, sx, sy, siteColor(status, PALETTE.ink));
      occupied.push(box(sx, sy, 8));
      factories.push({ f, sx, sy, status });
      app.hits.push({ kind: 'site', id: f.key, x: sx, y: sy, r: 10, priority: 4 });
      marks.push([sx, sy, status, f.damage]);
    }
    for (const d of world.depots || []) {
      const [sx, sy] = toScreen(cam, d.x, d.y);
      if (!onScreen(cam, sx, sy)) continue;
      const status = siteStatus(world, d);
      depot(ctx, sx, sy, siteColor(status, PALETTE.ink));
      occupied.push(box(sx, sy, 8));
      factories.push({ f: d, sx, sy, status });
      app.hits.push({ kind: 'site', id: d.key, x: sx, y: sy, r: 10, priority: 4 });
      marks.push([sx, sy, status, d.damage]);
    }
  }
  const grounded = new Map();
  for (const sq of world.squadrons) {
    if (isFlying(sq) || sq.state === 'lost') continue;
    if (!grounded.has(sq.airfield)) grounded.set(sq.airfield, []);
    grounded.get(sq.airfield).push(sq);
  }
  const fields = [];
  if (s > 0.45) {
    for (const f of world.airfields) {
      const [sx, sy] = toScreen(cam, f.x, f.y);
      if (!onScreen(cam, sx, sy)) continue;
      aerodrome(ctx, sx, sy, f.sector, isSelected(app, 'site', f.key));
      occupied.push(box(sx, sy, f.sector ? 9 : 6));
      const here = grounded.get(f.id) || [];
      app.hits.push({ kind: 'airfield', id: f.id, x: sx, y: sy, r: 14, priority: here.length ? 2 : 4 });
      const status = siteStatus(world, f);
      fields.push({ f, sx, sy, here, status });
      marks.push([sx, sy, status, f.damage]);
    }
  }

  // 2. Text, most important first. Aerodromes with squadrons always get their label.
  const towns = app.mapRenderer.labels.filter((l) => l.kind === 'city' && labelVisible(l, s));
  for (const l of towns.filter((town) => town.major)) {
    const [sx, sy] = toScreen(cam, l.x, l.y);
    if (!onScreen(cam, sx, sy)) continue;
    ctx.fillStyle = PALETTE.cityText;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
    placeText(ctx, occupied, sx, sy, [{ text: l.text, font: `bold 12px ${FONTS.serif}`, color: PALETTE.cityText }], 4, true);
  }
  fields.sort((a, b) => b.here.length - a.here.length || Number(b.f.sector) - Number(a.f.sector));
  for (const { f, sx, sy, here, status } of fields) {
    if (!here.length && s < 1.1 && status === 'intact') continue;
    const lines = [{ text: f.name, font: `${f.sector ? 'bold ' : ''}11px ${FONTS.serif}`, color: siteColor(status, PALETTE.ink) }];
    for (const sq of here) {
      const color = sq.state === 'ready' ? '#2e6b3a' : sq.state === 'scrambling' ? '#b07a12' : '#7a6f5d';
      const mark = sq.state === 'ready' ? '●' : sq.state === 'scrambling' ? '▲' : '○';
      lines.push({ text: `${mark} ${sq.name}`, font: `bold 11px ${FONTS.mono}`, color });
    }
    placeText(ctx, occupied, sx, sy, lines, f.sector ? 10 : 7, here.length > 0 || status !== 'intact');
  }
  for (const { p, sx, sy, status } of ports) {
    if (p.naval) {
      placeText(ctx, occupied, sx, sy, [{ text: p.name, font: `12px ${FONTS.serif}`, color: siteColor(status, PALETTE.ink) }], 7, status !== 'intact');
    } else {
      placeText(ctx, occupied, sx, sy, [{ text: p.label || p.name, font: `bold 12px ${FONTS.serif}`, color: siteColor(status, COLORS.route) }], 8, true);
    }
  }
  for (const { f, sx, sy, status } of factories) {
    placeText(ctx, occupied, sx, sy, [{ text: f.name, font: `italic 11px ${FONTS.serif}`, color: siteColor(status, PALETTE.ink) }], 8, true);
  }
  for (const l of towns.filter((town) => !town.major)) {
    const [sx, sy] = toScreen(cam, l.x, l.y);
    if (!onScreen(cam, sx, sy)) continue;
    const dot = box(sx, sy, 2);
    if (overlaps(dot, occupied)) continue;
    if (placeText(ctx, occupied, sx, sy, [{ text: l.text, font: `12px ${FONTS.serif}`, color: PALETTE.cityText }], 4)) {
      ctx.fillStyle = PALETTE.cityText;
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const { r, sx, sy, status } of radars) {
    if (s > 2.2 || status !== 'intact') {
      placeText(ctx, occupied, sx, sy, [{ text: r.name, font: `10px ${FONTS.serif}`, color: siteColor(status, COLORS.rafRed) }], 7, status !== 'intact');
    }
  }
  for (const [sx, sy, status, damage] of marks) damageMark(ctx, sx, sy, status, damage, now);
}

// ---- logistics: railway, trains, stock gauges -----------------------------------------

function drawRail(ctx, cam, app) {
  const L = app.world.rail;
  if (!L.enabled || cam.scale < 0.2) return;
  ctx.save();
  ctx.lineCap = 'butt';
  // Lighter on the air defence map, where the railway is only background.
  ctx.globalAlpha = cam.scale > 1.5 ? 0.4 : 1;
  for (const link of L.links) {
    const a = L.nodes.get(link.a);
    const b = L.nodes.get(link.b);
    const [ax, ay] = toScreen(cam, a.x, a.y);
    const [bx, by] = toScreen(cam, b.x, b.y);
    if (Math.max(ax, bx) < -20 || Math.min(ax, bx) > cam.width + 20 || Math.max(ay, by) < -20 || Math.min(ay, by) > cam.height + 20) continue;
    const main = link.trainsPerDay >= 6;
    ctx.strokeStyle = 'rgba(52, 46, 38, 0.55)';
    ctx.lineWidth = main ? 3.2 : 2.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(247, 240, 220, 0.85)';
    ctx.lineWidth = main ? 1.4 : 0.9;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (cam.scale > 0.3 && cam.scale < 3) {
    ctx.fillStyle = 'rgba(52, 46, 38, 0.7)';
    ctx.font = `italic 10px ${FONTS.serif}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const n of L.nodes.values()) {
      if (n.site) continue;
      const [sx, sy] = toScreen(cam, n.x, n.y);
      if (!onScreen(cam, sx, sy)) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

const TRAIN_COLORS = { fuel: '#c47a1d', materiel: '#6a6a74', ammo: '#7a4a2a', mixed: '#8a5f3a' };

function drawTrains(ctx, cam, app, alpha) {
  const world = app.world;
  if (!world.rail.enabled || cam.scale < 0.2) return;
  for (const tr of world.trains) {
    const [sx, sy] = unitScreen(cam, tr, alpha);
    if (!onScreen(cam, sx, sy)) continue;
    let angle = 0;
    if (tr.state === 'moving' || tr.state === 'waiting') {
      const a = world.rail.nodes.get(tr.path[tr.seg]);
      const b = world.rail.nodes.get(tr.path[Math.min(tr.seg + 1, tr.path.length - 1)]);
      angle = Math.atan2(-(b.y - a.y), b.x - a.x);
    }
    train(ctx, sx, sy, angle, TRAIN_COLORS[tr.resource]);
    if (isSelected(app, 'train', tr.id)) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
    app.hits.push({ kind: 'train', id: tr.id, x: sx, y: sy, r: 9, priority: 5 });
  }
}

/** Little bars next to the depots: fuel in orange, matériel in grey. */
function drawGauges(ctx, cam, app) {
  const world = app.world;
  if (!world.rail.enabled || cam.scale < 0.3 || cam.scale > 4) return;
  const bar = (x, y, k, color) => {
    const h = 16;
    ctx.fillStyle = 'rgba(247, 240, 220, 0.9)';
    ctx.fillRect(x, y - h / 2, 5, h);
    ctx.fillStyle = color;
    const fill = Math.max(0, Math.min(1, k)) * (h - 2);
    ctx.fillRect(x + 1, y + h / 2 - 1 - fill, 3, fill);
    ctx.strokeStyle = 'rgba(43, 36, 26, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - h / 2 + 0.5, 4, h - 1);
  };
  const homes = new Set(world.squadrons.map((sq) => sq.home));
  for (const site of world.sites.values()) {
    let bars = null;
    if (site.kind === 'airfield' && homes.has(site.id)) {
      const days = fuelDays(world, site) ?? 0;
      bars = [[days / 5, days < 1 ? COLORS.rafRed : days < 2.5 ? '#b07a12' : '#2e6b3a']];
    } else if (site.kind === 'port' && (site.convoys || site.coastal)) {
      bars = [[site.stocks.fuel / 400, TRAIN_COLORS.fuel], [site.stocks.materiel / 400, TRAIN_COLORS.materiel]];
    } else if (site.kind === 'factory') {
      bars = [[site.stocks.materiel / 120, TRAIN_COLORS.materiel]];
    }
    if (!bars) continue;
    const [sx, sy] = toScreen(cam, site.x, site.y);
    if (!onScreen(cam, sx, sy)) continue;
    bars.forEach(([k, color], i) => bar(sx - 20 - i * 7, sy, k, color));
  }
}

/**
 * U-boats seen on the table: the mark where it was seen, and two circles that grow with
 * the age of the plot: how far it may have gone on the surface (dashed) and under water.
 */
/** Mobile radars being installed: a mast and the time they will be ready. */
function drawPendingMru(ctx, cam, app) {
  const world = app.world;
  if (!world.mru || !world.mru.pending.length || cam.scale < 0.35) return;
  for (const def of world.mru.pending) {
    const [x, y] = project(def.lon, def.lat);
    const [sx, sy] = toScreen(cam, x, y);
    if (!onScreen(cam, sx, sy)) continue;
    ctx.save();
    ctx.globalAlpha = 0.6;
    radarMast(ctx, sx, sy);
    ctx.restore();
    ctx.font = `italic 11px ${FONTS.serif}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(107, 45, 31, 0.95)';
    ctx.fillText(t('mru.mapPending', { name: def.name, time: formatTime(world.startMs + def.readyAt * 1000) }), sx + 10, sy + 4);
  }
}

function drawUboatPlots(ctx, cam, app) {
  const world = app.world;
  const A = world.rules.asw;
  const life = A.plotLifetimeH * 3600;
  ctx.save();
  for (const p of world.uboatPlots) {
    const age = world.t - p.t;
    const [sx, sy] = toScreen(cam, p.x, p.y);
    const reach = reachKm(world, age);
    const rs = reach.surface * cam.scale;
    const rd = reach.submerged * cam.scale;
    if (sx + rs < 0 || sy + rs < 0 || sx - rs > cam.width || sy - rs > cam.height) continue;
    const selected = isSelected(app, 'uplot', p.id);
    ctx.globalAlpha = selected ? 1 : Math.max(0.35, 1 - age / life);
    if (rs > 4) {
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = 'rgba(120, 30, 25, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, rs, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (rd > 3) {
      ctx.setLineDash([2, 3]);
      ctx.fillStyle = 'rgba(120, 30, 25, 0.07)';
      ctx.strokeStyle = 'rgba(120, 30, 25, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx, sy, rd, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const color = COLORS.clock[clockColorIndex(world.startMs + p.t * 1000)];
    uboatMark(ctx, sx, sy, selected ? COLORS.select : color, p.submerged);
    ctx.font = `bold 10px ${FONTS.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = t('map.uplot', { time: formatTime(world.startMs + p.t * 1000), source: t(`map.uSource.${p.source}`) });
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(247, 240, 220, 0.9)';
    ctx.strokeText(label, sx + 12, sy - 8);
    ctx.fillStyle = 'rgba(120, 30, 25, 1)';
    ctx.fillText(label, sx + 12, sy - 8);
    app.hits.push({ kind: 'uplot', id: p.id, x: sx, y: sy, r: 11, priority: 3 });
  }
  ctx.restore();
}

/** U-boats in direct contact: drawn where they are, until the contact is lost. */
function drawUboatContacts(ctx, cam, app) {
  const world = app.world;
  const now = performance.now();
  for (const u of world.uboats) {
    if (!u.seen || u.state === 'sunk' || u.state === 'gone') continue;
    const [sx, sy] = toScreen(cam, u.x, u.y);
    if (!onScreen(cam, sx, sy)) continue;
    const selected = isSelected(app, 'ucontact', u.id);
    const under = isSubmerged(world, u);
    liveRing(ctx, sx, sy, now);
    uboatMark(ctx, sx, sy, selected ? COLORS.select : 'rgba(150, 28, 22, 1)', under);
    const label = t(under ? 'map.uContactUnder' : 'map.uContact', { how: t(`map.uSource.${u.seen.how}`), by: u.seen.by });
    const box = placePlaque(ctx, app, sx + 6, sy, [label], { accent: selected ? COLORS.select : '#7a1e18', size: 10 }, 12);
    app.hits.push({ kind: 'ucontact', id: u.id, x: sx, y: sy, r: 13, priority: 2, box });
  }
}

function drawDfZones(ctx, cam, app) {
  const world = app.world;
  if (!world.dfZones.length) return;
  const life = world.rules.uboats.dfLifetimeH * 3600;
  ctx.save();
  for (const z of world.dfZones) {
    const [sx, sy] = toScreen(cam, z.x, z.y);
    const r = z.r * cam.scale;
    if (sx + r < 0 || sy + r < 0 || sx - r > cam.width || sy - r > cam.height) continue;
    const fade = Math.max(0.25, 1 - (world.t - z.t) / life);
    ctx.globalAlpha = fade;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(r, 6), 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120, 30, 25, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -r * 2; d < r * 2; d += 7) {
      ctx.moveTo(sx + d - r, sy - r);
      ctx.lineTo(sx + d + r, sy + r);
    }
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(120, 30, 25, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(r, 6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120, 30, 25, 0.95)';
    ctx.font = `italic 11px ${FONTS.serif}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(t('map.df', { time: dateTimeText(world.startMs + z.t * 1000) }), sx, sy - Math.max(r, 6) - 2);
  }
  ctx.restore();
}

function drawEscorts(ctx, cam, app, alpha) {
  const world = app.world;
  const groups = formationIndex(world, 'naval');
  for (const e of world.escorts) {
    const m = groups.get(e.id) || null;
    const f = m ? m.f : null;
    const leader = f ? world.escorts.find((x) => x.id === f.members[0]) : null;
    const selected = isSelected(app, 'escort', e.id) || Boolean(f && m.index === 0 && isSelected(app, 'formation', f.id));
    const [sx, sy] = unitScreen(cam, e, alpha);
    // A group in station with its support group's leader: a small symbol, no plaque.
    const inPort = (x) => x.state === 'inPort' || x.state === 'refit';
    const tucked = m && m.index > 0 && leader && (
      (e.state === leader.state && (e.state === 'atSea' || e.state === 'escorting') && distance(e.x, e.y, leader.x, leader.y) < 2 * e.followSlot + 4)
      || (inPort(e) && inPort(leader) && e.portId === leader.portId));
    if (tucked) {
      if (!onScreen(cam, sx, sy)) continue;
      // In port the groups lie beside the quay, a little apart from the leader.
      const tx = sx + (inPort(e) ? 14 + 6 * m.index : 0);
      const ty = sy + (inPort(e) ? 18 : 0);
      warship(ctx, tx, ty, e.heading, 4.5);
      if (isSelected(app, 'escort', e.id)) {
        ctx.strokeStyle = COLORS.select;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tx, ty, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      app.hits.push({ kind: 'escort', id: e.id, formation: f.id, x: tx, y: ty, r: 8, priority: 1, box: null });
      continue;
    }
    if (e.state === 'atSea' || e.state === 'waiting') {
      if (e.route.length) {
        pencilLine(ctx, [[sx, sy], ...e.route.map(([x, y]) => toScreen(cam, x, y))], { color: 'rgba(79, 96, 112, 0.8)', width: 1.4, dash: [6, 5] });
      } else {
        drawPlanTrack(ctx, cam, app, e, selected);
      }
      if (e.joinTarget) {
        const c = world.convoys.find((x) => x.id === e.joinTarget);
        if (c) pencilLine(ctx, [[sx, sy], toScreen(cam, c.x, c.y)], { color: 'rgba(79, 96, 112, 0.6)', width: 1.2, dash: [2, 4], arrow: false });
      }
    }
    if (!onScreen(cam, sx, sy)) continue;
    const ox = e.state === 'inPort' || e.state === 'refit' ? 14 : 0;
    const oy = e.state === 'inPort' || e.state === 'refit' ? 12 : 0;
    warship(ctx, sx + ox - 3, sy + oy, e.heading, 6);
    warship(ctx, sx + ox + 3, sy + oy - 3, e.heading, 6);
    if (selected) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + ox, sy + oy, 12, 0, Math.PI * 2);
      ctx.stroke();
    }
    let box = null;
    if (e.state !== 'escorting' || selected) {
      let label = `${e.short} · ${e.ships}`;
      if (f && m.index === 0) {
        const ships = f.members.reduce((n, id) => n + (world.escorts.find((x) => x.id === id)?.ships || 0), 0);
        label = t('map.groupPlaque', { name: f.name, n: f.members.length, ships });
      } else if (f) {
        label = `${e.short} · ${e.ships} → ${f.name}`;
      }
      box = placePlaque(ctx, app, sx + ox, sy + oy, [label], { accent: selected ? COLORS.select : '#4f6070', size: 10 }, 10);
    }
    app.hits.push({ kind: 'escort', id: e.id, formation: f ? f.id : undefined, x: sx + ox, y: sy + oy, r: 12, priority: 1, box });
  }
}

// ---- navigation: entrances of the charted channels, planned tracks -------------------

function drawGates(ctx, cam, app) {
  const world = app.world;
  const sel = selectedUnit(app);
  if (app.settings.orders !== 'headings' && !(sel && (sel.kind === 'convoy' || sel.kind === 'escort'))) return;
  const r = Math.max(5, world.rules.navigation.pilotKm * cam.scale);
  ctx.save();
  for (const port of world.ports) {
    if (!port.approaches || !(port.convoys || port.coastal)) continue;
    for (const a of port.approaches) {
      const [sx, sy] = toScreen(cam, a.points[0][0], a.points[0][1]);
      if (!onScreen(cam, sx, sy, 200)) continue;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(47, 79, 111, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(47, 79, 111, 0.9)';
      ctx.font = `italic 11px ${FONTS.serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cam.scale > 0.35 ? t('map.gate', { name: a.name }) : t('map.gateShort'), sx + r + 4, sy);
    }
  }
  ctx.restore();
}

function drawPlanTrack(ctx, cam, app, u, selected) {
  if (!u.plan.length) return;
  const world = app.world;
  const track = planTrack(world, u);
  const pts = track.map((p) => toScreen(cam, p.x, p.y));
  const color = u.kind === 'squadron' ? 'rgba(44, 74, 124, 0.85)' : 'rgba(47, 79, 111, 0.85)';
  for (let i = 1; i < pts.length; i++) {
    pencilLine(ctx, [pts[i - 1], pts[i]], {
      color, width: selected ? 1.8 : 1.2, dash: track[i].open ? [2, 5] : [7, 4], arrow: i === pts.length - 1,
    });
  }
  if (!selected) return;
  ctx.font = `bold 10px ${FONTS.mono}`;
  ctx.textBaseline = 'middle';
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (track[i].open) continue;
    const label = `${i} · ${formatTime(world.startMs + track[i].t * 1000)}`;
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(247, 240, 220, 0.85)';
    ctx.strokeText(label, x + 6, y - 8);
    ctx.fillText(label, x + 6, y - 8);
  }
}

// ---- convoys -----------------------------------------------------------------------

/** Screen point at a fraction of the length of a polyline. */
function pointAlong(pts, fraction) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * fraction;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (left <= seg && seg > 0) {
      const k = left / seg;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

function drawConvoys(ctx, cam, app, alpha) {
  const world = app.world;
  for (const c of world.convoys) {
    if (c.state === 'lost') continue;
    const selected = isSelected(app, 'convoy', c.id);
    if (c.state === 'arrived' && !selected && !c.unloading) continue;
    const awaiting = c.state === 'inPort' || c.state === 'waiting';
    if (c.state === 'inPort' && !c.plan.length && c.admiraltyRoute.length && (selected || c.route.length === 0)) {
      const pts = c.admiraltyRoute.map(([x, y]) => toScreen(cam, x, y));
      pencilLine(ctx, pts, { color: 'rgba(47, 79, 111, 0.45)', width: 1.5, dash: [2, 5], arrow: true });
      const mid = pointAlong(pts, 0.42);
      ctx.font = `italic 11px ${FONTS.serif}`;
      ctx.fillStyle = 'rgba(47, 79, 111, 0.8)';
      ctx.textAlign = 'center';
      ctx.fillText(t('map.admiraltyRoute'), mid[0], mid[1] - 10);
    }
    const [sx, sy] = unitScreen(cam, c, alpha);
    if (c.state === 'atSea' && c.route.length) {
      const pts = [[sx, sy], ...c.route.map(([x, y]) => toScreen(cam, x, y))];
      pencilLine(ctx, pts, { color: COLORS.route, width: 1.6, dash: [8, 6], arrow: true });
    } else if (c.state !== 'arrived') {
      drawPlanTrack(ctx, cam, app, c, selected);
    }
    if (!onScreen(cam, sx, sy)) continue;
    if (awaiting) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
      ctx.strokeStyle = `rgba(184, 64, 44, ${0.35 + 0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 15 + 3 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (c.straggler) ship(ctx, sx, sy, c.heading, 8);
    else {
      ship(ctx, sx - 4, sy + 2, c.heading, 8);
      ship(ctx, sx + 4, sy - 2, c.heading, 8);
    }
    const kn = Math.round((currentSpeed(c) * 3600) / 1.852);
    const name = c.straggler ? t('units.straggler', { name: c.name.split('·')[0], n: c.strayIndex }) : c.name;
    const zz = c.zigzag ? ` · ${t('map.zigzag')}` : '';
    const box = placePlaque(ctx, app, sx, sy, [`${name} · ${c.ships} · ${c.state === 'atSea' ? kn : c.speedKn} nd${zz}`], {
      accent: selected ? COLORS.select : null,
    }, 14);
    app.hits.push({ kind: 'convoy', id: c.id, x: sx, y: sy, r: 16, priority: 1, box });
  }
}

// ---- raids -------------------------------------------------------------------------

function plotHeading(plots, i) {
  for (let k = i - 1; k >= 0; k--) {
    const d = distance(plots[k].x, plots[k].y, plots[i].x, plots[i].y);
    if (d > 1.5) return headingOf(plots[i].x - plots[k].x, plots[i].y - plots[k].y);
  }
  return null;
}

/** Colour of the height difference between a squadron and a raid (squadron minus raid). */
function heightColor(world, dzM) {
  const R = world.rules.squadron;
  if (dzM < -R.engageBelowM || dzM > R.engageAboveM) return '#e06a5a';
  if (dzM >= R.heightAdvantageM) return '#8fd18f';
  return '#e8c060';
}

function stalk(ctx, sx, sy, h, color) {
  if (h <= 0) return;
  ctx.fillStyle = 'rgba(40, 34, 26, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, sy - h);
  ctx.stroke();
}

/** A ring that breathes around an enemy followed live (direct contact). */
function liveRing(ctx, sx, sy, now) {
  const k = (Math.sin(now / 350) + 1) / 2;
  ctx.save();
  ctx.strokeStyle = `rgba(168, 30, 25, ${0.55 + 0.35 * k})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, 13 + 2 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** "18 Do 17 + 30 Bf 110", the force of a raid seen. */
function forceText(f) {
  if (!f) return '';
  const parts = [];
  if (f.bombers > 0) parts.push(`${f.bombers} ${f.bomberType}`);
  if (f.escort > 0) parts.push(`${f.escort} ${f.escortType}`);
  return parts.join(' + ');
}

function drawContacts(ctx, cam, app, alpha) {
  const world = app.world;
  const now = performance.now();
  const exact = world.settings.detection === 'exact';
  const lifetime = world.rules.detection.plotLifetimeS;
  const sel = selectedUnit(app);
  const sq = sel && sel.kind === 'squadron' && sel.state !== 'lost' ? sel : null;
  for (const contact of world.contacts.values()) {
    if (contact.lost) continue;
    const plots = visiblePlots(world, contact);
    // Older plots: small arrows in the colour of the sector clock when they were laid.
    plots.forEach((p, i) => {
      if (i === plots.length - 1 && !exact) return;
      const [px, py] = toScreen(cam, p.x, p.y);
      if (!onScreen(cam, px, py)) return;
      ctx.globalAlpha = Math.max(0.25, 1 - ((world.t - p.t) / lifetime) * 0.75);
      plotArrow(ctx, px, py, plotHeading(plots, i), COLORS.clock[p.color], 6, p.source === 'observers');
      ctx.globalAlpha = 1;
    });
    const est = contactEstimate(world, contact);
    if (!est) continue;
    let sx;
    let sy;
    if (exact || est.live) {
      // Exact detection, or direct contact: the raid itself, moving smoothly.
      const raid = world.raids.find((r) => r.id === contact.raidId);
      [sx, sy] = unitScreen(cam, raid, alpha);
    } else {
      [sx, sy] = toScreen(cam, est.x, est.y);
    }
    const last = plots[plots.length - 1];
    const color = last ? COLORS.clock[last.color] : COLORS.clock[0];
    if (est.live) liveRing(ctx, sx, sy, now);
    plotArrow(ctx, sx, sy, est.heading, color, 9, est.source === 'observers');
    const h = stalkPx(app, est.altFt);
    let cx = sx + 21;
    let cy = sy;
    if (h > 0) {
      stalk(ctx, sx, sy, h, 'rgba(29, 29, 29, 0.8)');
      cx = sx;
      cy = sy - h;
    }
    balkenkreuz(ctx, cx, cy, 6);
    const selected = isSelected(app, 'raid', contact.raidId);
    const tag = est.live ? ` · ${t('map.seenTag', { by: est.seen.by })}`
      : est.source === 'observers' ? ` · ${t('map.observersTag')}` : est.source === 'patrol' ? ` · ${t('map.patrolTag')}` : '';
    const strength = est.live ? forceText(est.force) : countText(est.count, est.approx);
    const lines = [`${contact.label}  ${strength}  ${ftText(est.altFt)}${tag}`];
    if (sq) {
      const sqAltM = isFlying(sq) ? sq.alt : sq.targetAlt;
      const wing = app.selection.kind === 'formation' ? formationById(world, app.selection.id) : null;
      // Height of the selected squadron (or wing) relative to the raid: + above it, − below it.
      lines.push({ text: `${wing ? wing.name : sq.name} ${relFtText((sqAltM - est.altM) / FOOT_M)}`, color: heightColor(world, sqAltM - est.altM) });
    }
    const box = placePlaque(ctx, app, cx, cy, lines, { dark: true, accent: selected ? COLORS.select : null }, 10);
    app.hits.push({ kind: 'raid', id: contact.raidId, x: sx, y: sy, r: 14, priority: 3, box });
    if (h > 0) app.hits.push({ kind: 'raid', id: contact.raidId, x: cx, y: cy, r: 10, priority: 3 });

    if (world.settings.interceptAid === 'track' && est.heading !== null) drawTrack(ctx, cam, est);
  }
}

function drawTrack(ctx, cam, est) {
  const [ax, ay] = toScreen(cam, est.x, est.y);
  const p5 = toScreen(cam, est.x + est.vx * 300, est.y + est.vy * 300);
  const p10 = toScreen(cam, est.x + est.vx * 600, est.y + est.vy * 600);
  pencilLine(ctx, [[ax, ay], p10], { color: 'rgba(120, 30, 25, 0.6)', width: 1.4, dash: [6, 5], arrow: false });
  ctx.fillStyle = 'rgba(120, 30, 25, 0.85)';
  ctx.font = `10px ${FONTS.mono}`;
  ctx.textAlign = 'left';
  for (const [p, label] of [[p5, t('map.track5')], [p10, t('map.track10')]]) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(label, p[0] + 5, p[1] - 5);
  }
}

/** Arcade aid: where and when the selected squadron can meet the nearest (or its guided) raid. */
function drawInterceptPoint(ctx, cam, app, alpha) {
  const world = app.world;
  const aid = world.settings.interceptAid;
  if (aid !== 'point' && aid !== 'auto') return;
  const sq = selectedUnit(app);
  if (!sq || sq.kind !== 'squadron') return;
  if (sq.state === 'lost' || sq.state === 'combat' || sq.state === 'refuelling' || sq.state === 'returning') return;
  const speed = squadronSpeed(world, sq);
  let target = null;
  if (sq.intercept) {
    const contact = world.contacts.get(sq.intercept.raidId);
    const est = contact ? contactEstimate(world, contact) : null;
    if (est) target = { est, contact };
  }
  if (!target) target = nearestContact(world, sq.x, sq.y);
  if (!target) return;
  const delay = sq.state === 'ready' ? world.rules.squadron.scrambleSeconds : sq.state === 'scrambling' ? sq.timer : 0;
  const { est } = target;
  const sol = solveIntercept(sq.x, sq.y, speed, est.x + est.vx * delay, est.y + est.vy * delay, est.vx, est.vy);
  const [ax, ay] = isFlying(sq) ? unitScreen(cam, sq, alpha) : toScreen(cam, sq.x, sq.y);
  if (!sol) return;
  const [bx, by] = toScreen(cam, sol.x, sol.y);
  pencilLine(ctx, [[ax, ay], [bx, by]], { color: COLORS.intercept, width: 1.6, dash: [5, 5], arrow: false });
  ctx.strokeStyle = COLORS.intercept;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx - 6, by - 6);
  ctx.lineTo(bx + 6, by + 6);
  ctx.moveTo(bx - 6, by + 6);
  ctx.lineTo(bx + 6, by - 6);
  ctx.stroke();
  const lines = [t('map.intercept', {
    heading: String(Math.round(sol.heading) % 360).padStart(3, '0'),
    min: Math.max(1, Math.round((sol.time + delay) / 60)),
  })];
  if (sq.intercept) lines.push(t('map.guided', { p: Math.round(sq.intercept.p * 100) }));
  plaque(ctx, bx + 10, by + 30, lines, { accent: COLORS.intercept, size: 10 });
}

// ---- rendezvous of formations ------------------------------------------------------

/** Where a member of a formation sets out from, for its line to the rendezvous. */
function memberStart(world, u) {
  if (u.kind === 'squadron' && !isFlying(u)) return world.byId.airfield.get(u.airfield);
  return u;
}

function drawRallies(ctx, cam, app) {
  const world = app.world;
  for (const f of world.formations || []) {
    const r = f.rally;
    const p = rallyPoint(f);
    if (!r || !p || r.phase === 'gone') continue;
    const [sx, sy] = toScreen(cam, p.x, p.y);
    const selected = isSelected(app, 'formation', f.id);
    const color = selected ? COLORS.select : 'rgba(44, 74, 124, 0.9)';
    if (selected) {
      // Each member's way to the point, and the route after it.
      for (const id of f.members) {
        const u = (f.kind === 'air' ? world.squadrons : world.escorts).find((x) => x.id === id);
        if (!u || u.state === 'lost') continue;
        const from = memberStart(world, u);
        if (distance(from.x, from.y, p.x, p.y) < 1) continue;
        pencilLine(ctx, [toScreen(cam, from.x, from.y), [sx, sy]], { color: 'rgba(44, 74, 124, 0.45)', width: 1.2, dash: [3, 4], arrow: false });
      }
      if (r.route.length) {
        pencilLine(ctx, [[sx, sy], ...r.route.map(([x, y]) => toScreen(cam, x, y))], { color: COLORS.pencil, width: 1.8 });
      }
    }
    if (!onScreen(cam, sx, sy)) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.moveTo(sx - 13, sy);
    ctx.lineTo(sx + 13, sy);
    ctx.moveTo(sx, sy - 13);
    ctx.lineTo(sx, sy + 13);
    ctx.stroke();
    const when = r.at !== null ? formatTime(world.startMs + r.at * 1000) : t('map.rallyAsap');
    const lines = [t(f.kind === 'air' ? 'map.rallyAir' : 'map.rallySea', { name: f.name, time: when, alt: ftText(feetOf(r.altM)) })];
    const box = placePlaque(ctx, app, sx, sy, lines, { accent: color, size: 10 }, 12);
    app.hits.push({ kind: 'rally', id: f.id, x: sx, y: sy, r: 12, priority: 1, box });
  }
}

// ---- squadrons ---------------------------------------------------------------------

function drawSquadrons(ctx, cam, app, alpha) {
  const world = app.world;
  const now = performance.now();
  const meleeDone = new Set();
  const wings = formationIndex(world, 'air');
  for (const sq of world.squadrons) {
    const m = wings.get(sq.id) || null;
    const f = m ? m.f : null;
    const selected = isSelected(app, 'squadron', sq.id) || Boolean(f && m.index === 0 && isSelected(app, 'formation', f.id));
    // A squadron in station in its big wing: a small roundel beside the leader, no plaque.
    if (m && m.index > 0 && sq.state === 'airborne' && sq.inFormation && sq.follow === f.members[0]) {
      const [sx, sy] = unitScreen(cam, sq, alpha);
      if (!onScreen(cam, sx, sy)) continue;
      const top = sy - stalkPx(app, feetOf(lerp(sq.palt ?? sq.alt, sq.alt, alpha)));
      roundel(ctx, sx, top, 4.5);
      if (isSelected(app, 'squadron', sq.id)) {
        ctx.strokeStyle = COLORS.select;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, top, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      app.hits.push({ kind: 'squadron', id: sq.id, formation: f.id, x: sx, y: top, r: 8, priority: 0, box: null });
      continue;
    }
    if (!isFlying(sq)) {
      // A take-off ordered for later: its route waits, dashed, from the aerodrome.
      if (sq.schedule && sq.state === 'ready' && sq.route.length && !sq.schedule.join) {
        const f = world.byId.airfield.get(sq.airfield);
        const [fx, fy] = toScreen(cam, f.x, f.y);
        const points = sq.route.map(([x, y]) => toScreen(cam, x, y));
        pencilLine(ctx, [[fx, fy], ...points], { color: 'rgba(44, 74, 124, 0.55)', width: 1.4, dash: [6, 5] });
        if (selected || cam.scale > 0.9) {
          // Labelled at the end of the first leg, clear of the aerodrome's own names.
          const [lx, ly] = points[0];
          ctx.font = `11px ${FONTS.mono}`;
          ctx.textAlign = lx >= fx ? 'left' : 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = '#2c4a7c';
          ctx.fillText(`${sq.name} ${formatTime(world.startMs + sq.schedule.at * 1000)}`, lx + (lx >= fx ? 6 : -6), ly - 4);
        }
      }
      // A plan prepared before take-off is drawn from the aerodrome, and so is a route.
      if (selected && sq.plan.length && (sq.state === 'ready' || sq.state === 'scrambling')) drawPlanTrack(ctx, cam, app, sq, true);
      if (sq.state === 'scrambling' && sq.route.length) {
        const f = world.byId.airfield.get(sq.airfield);
        pencilLine(ctx, [toScreen(cam, f.x, f.y), ...sq.route.map(([x, y]) => toScreen(cam, x, y))], { color: COLORS.pencil, width: 1.8 });
      }
      continue;
    }
    const [sx, sy] = unitScreen(cam, sq, alpha);
    const altFt = feetOf(lerp(sq.palt ?? sq.alt, sq.alt, alpha));
    if (sq.route.length && sq.state !== 'returning') {
      const pts = [[sx, sy], ...sq.route.map(([x, y]) => toScreen(cam, x, y))];
      pencilLine(ctx, pts, { color: COLORS.pencil, width: 1.8 });
    } else if (sq.plan.length && sq.state !== 'returning') {
      drawPlanTrack(ctx, cam, app, sq, selected);
    } else if (sq.state === 'airborne' && !sq.orbit && !sq.cover) {
      const len = 46;
      const h = (sq.vector ?? sq.heading) * DEG;
      pencilLine(ctx, [[sx, sy], [sx + Math.sin(h) * len, sy - Math.cos(h) * len]], {
        color: 'rgba(44, 74, 124, 0.7)', width: 1.4, dash: [4, 4],
      });
    } else if (sq.state === 'returning') {
      const f = world.byId.airfield.get(sq.airfield);
      const [fx, fy] = toScreen(cam, f.x, f.y);
      pencilLine(ctx, [[sx, sy], [fx, fy]], { color: 'rgba(90, 80, 60, 0.45)', width: 1.2, dash: [2, 4], arrow: false });
    }
    if (!onScreen(cam, sx, sy)) continue;
    const h = stalkPx(app, altFt);
    stalk(ctx, sx, sy, h, 'rgba(44, 74, 124, 0.85)');
    const top = sy - h;
    const ox = sq.state === 'combat' && h > 0 ? -14 : 0;
    if (sq.state === 'combat' && !meleeDone.has(sq.engagedRaid)) {
      meleeDone.add(sq.engagedRaid);
      drawMelee(ctx, sx, top, now, sq.id.length * 7);
    }
    if (selected) {
      ctx.strokeStyle = COLORS.select;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + ox, top, 13, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (isPatrol(sq)) {
      if (selected || sq.state === 'airborne') {
        // What the patrol can see from where it is.
        const r = sightKm(world, sq) * cam.scale;
        if (r > 8) {
          ctx.save();
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = selected ? 'rgba(44, 74, 124, 0.7)' : 'rgba(44, 74, 124, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      patrolMark(ctx, sx + ox, top, 7, sq.role === 'coastal');
    } else {
      roundel(ctx, sx + ox, top, 7);
    }
    const climbing = sq.targetAlt - sq.alt > 30 ? ' ↑' : sq.alt - sq.targetAlt > 30 && sq.state !== 'combat' ? ' ↓' : '';
    let lines = [`${sq.name} · ${sq.aircraft} · ${ftText(altFt)}${climbing}`];
    if (f && m.index === 0) {
      // The leader carries the wing's plaque: its name, squadrons and aircraft with it.
      const flying = f.members.map((id) => world.squadrons.find((x) => x.id === id)).filter((x) => x && (x === sq || (x.follow === sq.id && isFlying(x))));
      const aircraft = flying.reduce((n, x) => n + x.aircraft, 0);
      lines = [t('map.wingPlaque', { name: f.name, n: flying.length, aircraft, alt: `${ftText(altFt)}${climbing}` })];
      if (sq.holdForWing) lines.push(t('map.wingGathering', { n: flying.filter((x) => x === sq || x.inFormation).length, of: flying.length }));
    } else if (f) {
      lines = [`${sq.name} · ${sq.aircraft} · ${ftText(altFt)}${climbing} → ${f.name}`];
    }
    const box = placePlaque(ctx, app, sx + ox, top, lines, {
      accent: sq.state === 'combat' ? COLORS.rafRed : selected ? COLORS.select : null,
    }, 12);
    app.hits.push({ kind: 'squadron', id: sq.id, formation: f ? f.id : undefined, x: sx + ox, y: top, r: 14, priority: 0, box });
  }
}


// ---- route editing -----------------------------------------------------------------

/** End of the route of a squadron: a short note of what it does there. */
function endActionLabel(world, s) {
  const a = s.endAction || { kind: 'orbit' };
  if (a.kind === 'land') {
    const f = world.byId.airfield.get(a.id);
    return t('map.endLand', { airfield: f ? f.name : '' });
  }
  if (a.kind === 'cover') {
    const c = world.convoys.find((x) => x.id === a.id);
    return t('map.endCover', { convoy: c ? c.name : '' });
  }
  return t(`map.end.${a.kind}`);
}

/** Dashed bubbles around the aerodromes: a route that ends in one can end with a landing. */
function drawAirfieldBubbles(ctx, cam, app) {
  const world = app.world;
  const r = world.rules.squadron.landBubbleKm * cam.scale;
  if (r < 7) return;
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(44, 74, 124, 0.35)';
  for (const f of world.airfields) {
    const [sx, sy] = toScreen(cam, f.x, f.y);
    if (!onScreen(cam, sx, sy, r)) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Handles on the route of the selected unit (tracé mode): a square per point to move it,
 * a "+" in the middle of each leg to add one, a ring at the end to draw it longer. Points
 * of a squadron can carry an altitude.
 */
function drawRouteEditor(ctx, cam, app, alpha) {
  const world = app.world;
  const u = selectedUnit(app);
  if (!u) return;
  if (u.kind === 'squadron' && u.state !== 'lost') {
    const drawingFromAir = app.drawing && (app.drawing.kind === 'squadron' || app.drawing.kind === 'airfield');
    if (drawingFromAir || isFlying(u) || u.state === 'ready' || u.state === 'scrambling') drawAirfieldBubbles(ctx, cam, app);
    const end = navigationEnd(world, u);
    if (end && (u.route.length || u.plan.length)) {
      let [ex, ey] = toScreen(cam, end.x, end.y);
      ex += 9;
      ey += 13;
      if (u.route.length && app.settings.orders !== 'headings') {
        // Beside the ring that lengthens the route.
        const pts = u.route;
        const [lx, ly] = toScreen(cam, pts[pts.length - 1][0], pts[pts.length - 1][1]);
        const [px, py] = pts.length > 1 ? toScreen(cam, pts[pts.length - 2][0], pts[pts.length - 2][1]) : unitScreen(cam, u, alpha);
        const len = Math.hypot(lx - px, ly - py) || 1;
        ex = lx + ((lx - px) / len) * 20 + 10;
        ey = ly + ((ly - py) / len) * 20;
      }
      ctx.font = `italic 11px ${FONTS.serif}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(247, 240, 220, 0.9)';
      const label = endActionLabel(world, u);
      ctx.strokeText(label, ex, ey);
      ctx.fillStyle = 'rgba(44, 74, 124, 0.95)';
      ctx.fillText(label, ex, ey);
    }
  }
  if (app.settings.orders === 'headings') return;
  const pts = editableRoute(u);
  if (!pts) return;
  const [ux, uy] = unitScreen(cam, u, alpha);
  const drag = app.routeDrag && app.routeDrag.id === u.id && app.routeDrag.kind === u.kind ? app.routeDrag : null;
  const screen = pts.map((p) => toScreen(cam, p[0], p[1]));
  if (drag) {
    // Ghost of the route as it will be once the point is dropped.
    const ghost = screen.map((p) => [...p]);
    const at = toScreen(cam, drag.at[0], drag.at[1]);
    if (drag.mode === 'move') ghost[drag.index] = at;
    else ghost.splice(drag.index, 0, at);
    pencilLine(ctx, [[ux, uy], ...ghost], { color: 'rgba(168, 50, 45, 0.85)', width: 1.6, dash: [5, 4], arrow: false });
  }
  const active = app.activePoint && app.activePoint.id === u.id && app.activePoint.kind === u.kind ? app.activePoint.index : -1;
  // "+" in the middle of each leg, when it is long enough on the screen.
  let prev = [ux, uy];
  screen.forEach(([x, y], i) => {
    const mx = (prev[0] + x) / 2;
    const my = (prev[1] + y) / 2;
    if (Math.hypot(x - prev[0], y - prev[1]) > 46) {
      ctx.fillStyle = 'rgba(247, 240, 220, 0.95)';
      ctx.strokeStyle = 'rgba(44, 74, 124, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 3, my);
      ctx.lineTo(mx + 3, my);
      ctx.moveTo(mx, my - 3);
      ctx.lineTo(mx, my + 3);
      ctx.stroke();
      app.hits.push({ kind: 'routeMid', unitKind: u.kind, id: u.id, index: i, x: mx, y: my, wx: (pts[i][0] + (i ? pts[i - 1][0] : u.x)) / 2, wy: (pts[i][1] + (i ? pts[i - 1][1] : u.y)) / 2, r: 7, priority: -1 });
    }
    prev = [x, y];
  });
  // Squares on the points, with the altitude written on squadron points.
  let altBefore = u.kind === 'squadron' ? u.targetAlt : null;
  screen.forEach(([x, y], i) => {
    const on = i === active;
    ctx.fillStyle = on ? COLORS.select : 'rgba(247, 240, 220, 0.95)';
    ctx.strokeStyle = on ? 'rgba(30, 26, 20, 0.9)' : 'rgba(44, 74, 124, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.strokeRect(x - 4, y - 4, 8, 8);
    app.hits.push({ kind: 'routePoint', unitKind: u.kind, id: u.id, index: i, x, y, r: 8, priority: -2 });
    const altM = pts[i][2];
    if (u.kind === 'squadron' && altM !== null && altM !== undefined) {
      const arrow = i === 0 || altBefore === null ? '' : altM > altBefore + 1 ? '↑ ' : altM < altBefore - 1 ? '↓ ' : '';
      const label = `${arrow}${ftText(feetOf(altM))}`;
      ctx.font = `bold 10px ${FONTS.mono}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(247, 240, 220, 0.9)';
      ctx.strokeText(label, x + 8, y - 9);
      ctx.fillStyle = 'rgba(44, 74, 124, 1)';
      ctx.fillText(label, x + 8, y - 9);
      altBefore = altM;
    }
  });
  // Ring beyond the last point: drag from it to draw the route longer.
  if (routeCanExtend(u)) {
    const [lx, ly] = screen[screen.length - 1];
    const [px, py] = screen.length > 1 ? screen[screen.length - 2] : [ux, uy];
    const len = Math.hypot(lx - px, ly - py) || 1;
    const kx = lx + ((lx - px) / len) * 20;
    const ky = ly + ((ly - py) / len) * 20;
    ctx.strokeStyle = 'rgba(44, 74, 124, 0.9)';
    ctx.fillStyle = 'rgba(247, 240, 220, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(kx, ky, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(kx - 3.5, ky);
    ctx.lineTo(kx + 3.5, ky);
    ctx.moveTo(kx, ky - 3.5);
    ctx.lineTo(kx, ky + 3.5);
    ctx.stroke();
    app.hits.push({ kind: 'routeExtend', unitKind: u.kind, id: u.id, x: kx, y: ky, r: 8, priority: -1 });
  }
}

// ---- overlays ----------------------------------------------------------------------

function rulerTimeLine(app, km) {
  const u = selectedUnit(app);
  if (!u || u.state === 'lost' || u.state === 'arrived') return null;
  const world = app.world;
  let v;
  let speedText;
  if (u.kind === 'squadron') {
    v = squadronSpeed(world, u);
    speedText = t('units.kmh', { n: Math.round(v * 3600) });
  } else {
    v = currentSpeed(u);
    speedText = t('units.kn', { n: Math.round((v * 3600) / 1.852) });
  }
  if (v <= 0) return null;
  const seconds = km / v;
  const arrivalMs = world.startMs + (world.t + seconds) * 1000;
  const f = app.selection && app.selection.kind === 'formation' ? formationById(world, app.selection.id) : null;
  return t('map.measureTime', {
    unit: f ? f.name : u.name,
    speed: speedText,
    duration: durationText(seconds),
    time: seconds > 18 * 3600 ? dateTimeText(arrivalMs) : formatTime(arrivalMs),
  });
}

/** A small cross on the corner of the ruler's box: a click on it takes the ruler away. */
function rulerClose(ctx, app, box) {
  const size = 15;
  const x = box.x + box.w + 3;
  const y = box.y;
  ctx.fillStyle = COLORS.plaque;
  ctx.strokeStyle = '#6b2d1f';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, size, size);
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.lineTo(x + size - 4, y + size - 4);
  ctx.moveTo(x + size - 4, y + 4);
  ctx.lineTo(x + 4, y + size - 4);
  ctx.stroke();
  app.hits.push({ kind: 'rulerClose', x: x + size / 2, y: y + size / 2, r: size / 2, priority: -3, box: { x, y, w: size, h: size } });
}

function drawOverlays(ctx, cam, app) {
  if (app.drawing && app.drawing.points.length > 1) {
    pencilLine(ctx, app.drawing.points, { color: 'rgba(30, 26, 20, 0.9)', width: 2.4 });
  }
  if (app.ruler && app.ruler.mru) {
    // Preview of a mobile radar: its beam, facing the way the drag goes.
    const world = app.world;
    const D = world.rules.detection;
    const [ax, ay] = toScreen(cam, app.ruler.a[0], app.ruler.a[1]);
    const az = headingOf(app.ruler.b[0] - app.ruler.a[0], app.ruler.b[1] - app.ruler.a[1]);
    const r = Math.min(D.radarMaxRangeKm, D.radarMinRangeKm + D.radarRangePerM * 4000) * world.rules.mru.rangeFactor * cam.scale;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.arc(ax, ay, r, (az - D.radarHalfArcDeg - 90) * DEG, (az + D.radarHalfArcDeg - 90) * DEG);
    ctx.closePath();
    ctx.fillStyle = 'rgba(168, 50, 45, 0.08)';
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(168, 50, 45, 0.7)';
    ctx.stroke();
    ctx.restore();
    radarMast(ctx, ax, ay);
    plaque(ctx, ax + 12, ay - 14, [t('mru.preview', { az: String(Math.round(az) % 360).padStart(3, '0') })], { accent: '#6b2d1f', size: 10 });
  } else if (app.ruler) {
    const [ax, ay] = toScreen(cam, app.ruler.a[0], app.ruler.a[1]);
    const [bx, by] = toScreen(cam, app.ruler.b[0], app.ruler.b[1]);
    pencilLine(ctx, [[ax, ay], [bx, by]], { color: '#6b2d1f', width: 1.6, dash: [10, 4], arrow: true });
    const km = distance(app.ruler.a[0], app.ruler.a[1], app.ruler.b[0], app.ruler.b[1]);
    const heading = Math.round(headingOf(app.ruler.b[0] - app.ruler.a[0], app.ruler.b[1] - app.ruler.a[1])) % 360;
    const lines = [t('map.measure', {
      km: formatNumber(km, km < 20 ? 1 : 0),
      nm: formatNumber(km / 1.852, km < 20 ? 1 : 0),
      heading: String(heading).padStart(3, '0'),
    })];
    const timeLine = km > 0.2 ? rulerTimeLine(app, km) : null;
    if (timeLine) lines.push(timeLine);
    const box = plaque(ctx, bx + 12, by, lines, { accent: '#6b2d1f' });
    rulerClose(ctx, app, box);
  }
  if (app.flash && performance.now() < app.flash.until) {
    const [fx, fy] = toScreen(cam, app.flash.x, app.flash.y);
    ctx.strokeStyle = COLORS.rafRed;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fx, fy, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.rafRed;
    ctx.font = `bold 12px ${FONTS.serif}`;
    ctx.textAlign = 'left';
    ctx.fillText(t('map.landHere'), fx + 16, fy);
  }
}

function niceLength(target) {
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

function drawScaleBar(ctx, cam) {
  const km = niceLength(110 / cam.scale);
  const px = km * cam.scale;
  const x = 16;
  const y = cam.height - 30;
  ctx.fillStyle = 'rgba(244, 236, 214, 0.85)';
  ctx.fillRect(x - 6, y - 18, px + 12, 28);
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + px, y - 4);
  ctx.lineTo(x + px, y + 4);
  ctx.moveTo(x + px / 2, y - 3);
  ctx.lineTo(x + px / 2, y + 3);
  ctx.stroke();
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `11px ${FONTS.serif}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(t('map.scale', { n: formatNumber(km) }), x + px / 2, y - 5);
}

function drawNorth(ctx, cam) {
  const x = cam.width - 28;
  const y = 34;
  ctx.fillStyle = PALETTE.ink;
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x + 6, y + 6);
  ctx.lineTo(x, y + 2);
  ctx.lineTo(x - 6, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.font = `bold 12px ${FONTS.serif}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', x, y + 8);
}

const FX_LABELS = {
  miss: (fx) => {
    const km = formatNumber(Math.max(1, Math.round(fx.km)));
    const ft = Math.round(Math.abs(fx.dzFt) / 500) * 500;
    return ft >= 1000 ? t('map.missed', { km, ft: relFtText(fx.dzFt) }) : t('map.missedSame', { km });
  },
  get turn() {
    return t('map.turnBack');
  },
};

/** Symbols of the moving units, so that no plaque is laid over them. */
function symbolObstacles(app, alpha) {
  const cam = app.camera;
  const world = app.world;
  const boxes = [];
  const add = (x, y, r) => boxes.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
  for (const sq of world.squadrons) {
    if (!isFlying(sq)) continue;
    const [sx, sy] = unitScreen(cam, sq, alpha);
    const h = stalkPx(app, feetOf(lerp(sq.palt ?? sq.alt, sq.alt, alpha)));
    add(sx + (sq.state === 'combat' && h > 0 ? -14 : 0), sy - h, 9);
  }
  for (const contact of world.contacts.values()) {
    if (contact.lost) continue;
    const est = contactEstimate(world, contact);
    if (!est) continue;
    const [sx, sy] = toScreen(cam, est.x, est.y);
    const h = stalkPx(app, est.altFt);
    add(sx, sy, 7);
    add(h > 0 ? sx : sx + 21, sy - h, 8);
  }
  for (const c of world.convoys) {
    if (c.state === 'lost') continue;
    const [sx, sy] = unitScreen(cam, c, alpha);
    add(sx, sy, 9);
  }
  return boxes;
}

export function drawScene(ctx, app, alpha) {
  const cam = app.camera;
  const dpr = app.dpr;
  app.hits = [];
  app.plaqueBoxes = symbolObstacles(app, alpha);
  drawMap(ctx, cam, dpr, app.mapRenderer);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (app.settings.grid) drawGrid(ctx, cam, app.world.grid);
  if (app.settings.radarCover && cam.scale > 0.35) drawCoverage(ctx, cam, app.world);
  drawRail(ctx, cam, app);
  drawDfZones(ctx, cam, app);
  drawUboatPlots(ctx, cam, app);
  drawUboatContacts(ctx, cam, app);
  drawPlaces(ctx, cam, app);
  drawPendingMru(ctx, cam, app);
  drawGauges(ctx, cam, app);
  drawGates(ctx, cam, app);
  drawTrains(ctx, cam, app, alpha);
  drawConvoys(ctx, cam, app, alpha);
  drawEscorts(ctx, cam, app, alpha);
  drawRallies(ctx, cam, app);
  drawContacts(ctx, cam, app, alpha);
  drawInterceptPoint(ctx, cam, app, alpha);
  drawSquadrons(ctx, cam, app, alpha);
  drawDevLayer(ctx, cam, app, alpha);
  drawRouteEditor(ctx, cam, app, alpha);
  drawEffects(ctx, app, FX_LABELS);
  drawOverlays(ctx, cam, app);
  drawScaleBar(ctx, cam);
  drawNorth(ctx, cam);
  if (app.paused) {
    ctx.font = `bold 15px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const text = t('hud.paused');
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = 'rgba(43, 36, 26, 0.85)';
    ctx.fillRect(cam.width / 2 - w / 2, 10, w, 26);
    ctx.fillStyle = '#f2e9d2';
    ctx.fillText(text, cam.width / 2, 15);
  }
}
