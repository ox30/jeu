// Draws one frame of the plotting table and records where the clickable things are.

import { formatNumber, t } from '../core/i18n.js';
import { formatTime } from '../core/time.js';
import { FOOT_M, distance, headingOf } from '../sim/geo.js';
import { columnLetter } from '../sim/grid.js';
import { solveIntercept } from '../sim/intercept.js';
import { planTrack } from '../sim/orders.js';
import { contactEstimate, nearestContact, visiblePlots } from '../sim/query.js';
import { feetOf, isFlying, squadronSpeed } from '../sim/squadron.js';
import { currentSpeed } from '../sim/convoy.js';
import { radarRangeFactor, siteStatus } from '../sim/sites.js';
import { countText, dateTimeText, durationText, ftText, relFtText } from '../ui/format.js';
import { toScreen } from './camera.js';
import { drawEffects, drawMelee, stalkPx } from './fx.js';
import { FONTS, PALETTE, drawMap, labelVisible } from './map.js';
import {
  COLORS, aerodrome, anchor, balkenkreuz, damageMark, factory, measurePlaque, pencilLine, plaque, plotArrow, radarMast,
  roundel, ship, train, warship,
} from './symbols.js';
import { fuelDays } from '../sim/logistics.js';

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

function selectedUnit(app) {
  const sel = app.selection;
  if (!sel) return null;
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

function drawCoverage(ctx, cam, world) {
  const D = world.rules.detection;
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

const TRAIN_COLORS = { fuel: '#c47a1d', materiel: '#6a6a74' };

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
  for (const e of world.escorts) {
    const selected = isSelected(app, 'escort', e.id);
    const [sx, sy] = unitScreen(cam, e, alpha);
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
      box = placePlaque(ctx, app, sx + ox, sy + oy, [`${e.short} · ${e.ships}`], { accent: selected ? COLORS.select : '#4f6070', size: 10 }, 10);
    }
    app.hits.push({ kind: 'escort', id: e.id, x: sx + ox, y: sy + oy, r: 12, priority: 1, box });
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
    ship(ctx, sx - 4, sy + 2, c.heading, 8);
    ship(ctx, sx + 4, sy - 2, c.heading, 8);
    const kn = Math.round((currentSpeed(c) * 3600) / 1.852);
    const box = placePlaque(ctx, app, sx, sy, [`${c.name} · ${c.ships} · ${c.state === 'atSea' ? kn : c.speedKn} nd`], {
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

function drawContacts(ctx, cam, app, alpha) {
  const world = app.world;
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
      plotArrow(ctx, px, py, plotHeading(plots, i), COLORS.clock[p.color], 6);
      ctx.globalAlpha = 1;
    });
    const est = contactEstimate(world, contact);
    if (!est) continue;
    let sx;
    let sy;
    if (exact) {
      const raid = world.raids.find((r) => r.id === contact.raidId);
      [sx, sy] = unitScreen(cam, raid, alpha);
    } else {
      [sx, sy] = toScreen(cam, est.x, est.y);
    }
    const last = plots[plots.length - 1];
    const color = last ? COLORS.clock[last.color] : COLORS.clock[0];
    plotArrow(ctx, sx, sy, est.heading, color, 9);
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
    const lines = [`${contact.label}  ${countText(est.count, est.approx)}  ${ftText(est.altFt)}`];
    if (sq) {
      const sqAltM = isFlying(sq) ? sq.alt : sq.targetAlt;
      // Height of the selected squadron relative to the raid: + above it, − below it.
      lines.push({ text: `${sq.name} ${relFtText((sqAltM - est.altM) / FOOT_M)}`, color: heightColor(world, sqAltM - est.altM) });
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

/** Arcade aid: where and when the selected squadron can meet the nearest raid. */
function drawInterceptPoint(ctx, cam, app, alpha) {
  const world = app.world;
  if (world.settings.interceptAid !== 'point' || !app.selection || app.selection.kind !== 'squadron') return;
  const sq = world.squadrons.find((s) => s.id === app.selection.id);
  if (!sq || sq.state === 'lost' || sq.state === 'combat' || sq.state === 'refuelling' || sq.state === 'returning') return;
  const speed = squadronSpeed(world, sq);
  const target = nearestContact(world, sq.x, sq.y);
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
  plaque(ctx, bx + 10, by + 30, [t('map.intercept', {
    heading: String(Math.round(sol.heading) % 360).padStart(3, '0'),
    min: Math.max(1, Math.round((sol.time + delay) / 60)),
  })], { accent: COLORS.intercept, size: 10 });
}

// ---- squadrons ---------------------------------------------------------------------

function drawSquadrons(ctx, cam, app, alpha) {
  const world = app.world;
  const now = performance.now();
  const meleeDone = new Set();
  for (const sq of world.squadrons) {
    const selected = isSelected(app, 'squadron', sq.id);
    if (!isFlying(sq)) {
      // A plan prepared before take-off is drawn from the aerodrome.
      if (selected && sq.plan.length && (sq.state === 'ready' || sq.state === 'scrambling')) drawPlanTrack(ctx, cam, app, sq, true);
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
    roundel(ctx, sx + ox, top, 7);
    const climbing = sq.targetAlt - sq.alt > 30 ? ' ↑' : sq.alt - sq.targetAlt > 30 && sq.state !== 'combat' ? ' ↓' : '';
    const box = placePlaque(ctx, app, sx + ox, top, [`${sq.name} · ${sq.aircraft} · ${ftText(altFt)}${climbing}`], {
      accent: sq.state === 'combat' ? COLORS.rafRed : selected ? COLORS.select : null,
    }, 12);
    app.hits.push({ kind: 'squadron', id: sq.id, x: sx + ox, y: top, r: 14, priority: 0, box });
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
  return t('map.measureTime', {
    unit: u.name,
    speed: speedText,
    duration: durationText(seconds),
    time: seconds > 18 * 3600 ? dateTimeText(arrivalMs) : formatTime(arrivalMs),
  });
}

function drawOverlays(ctx, cam, app) {
  if (app.drawing && app.drawing.points.length > 1) {
    pencilLine(ctx, app.drawing.points, { color: 'rgba(30, 26, 20, 0.9)', width: 2.4 });
  }
  if (app.ruler) {
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
    plaque(ctx, bx + 12, by, lines, { accent: '#6b2d1f' });
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
  drawPlaces(ctx, cam, app);
  drawGauges(ctx, cam, app);
  drawGates(ctx, cam, app);
  drawTrains(ctx, cam, app, alpha);
  drawConvoys(ctx, cam, app, alpha);
  drawEscorts(ctx, cam, app, alpha);
  drawContacts(ctx, cam, app, alpha);
  drawInterceptPoint(ctx, cam, app, alpha);
  drawSquadrons(ctx, cam, app, alpha);
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
