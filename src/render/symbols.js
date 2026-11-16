// Map symbols, drawn in screen pixels: roundels, crosses, aerodromes, radar masts,
// ships, plot arrows and the little plaques that carry unit labels on the table.

import { FONTS } from './map.js';

const DEG = Math.PI / 180;

export const COLORS = {
  rafBlue: '#2c4a7c',
  rafRed: '#a8322d',
  rafYellow: '#d8b13c',
  white: '#f6f1e3',
  ink: '#2b241a',
  enemy: '#1d1d1d',
  plaque: '#f4ecd6',
  plaqueEnemy: '#2a2622',
  convoy: '#3d4e5c',
  route: '#2f4f6f',
  pencil: 'rgba(40, 36, 30, 0.85)',
  select: '#b8402c',
  intercept: '#1f5f8b',
  clock: ['#c0392b', '#d4a017', '#2f5d9e'], // red, yellow, blue: the sector clock colours
};

export function roundel(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r + 1.3, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.rafYellow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.rafBlue;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.64, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.white;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.rafRed;
  ctx.fill();
}

/** Straight black cross with white borders, as painted on German aircraft and vehicles. */
export function balkenkreuz(ctx, x, y, size) {
  const w = size * 0.42;
  const b = Math.max(1.2, size * 0.16);
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(x - size - b, y - w / 2 - b, 2 * (size + b), w + 2 * b);
  ctx.fillRect(x - w / 2 - b, y - size - b, w + 2 * b, 2 * (size + b));
  ctx.fillStyle = COLORS.enemy;
  ctx.fillRect(x - size, y - w / 2, 2 * size, w);
  ctx.fillRect(x - w / 2, y - size, w, 2 * size);
}

export function aerodrome(ctx, x, y, sector, highlight = false) {
  ctx.lineWidth = sector ? 1.8 : 1.2;
  ctx.strokeStyle = highlight ? COLORS.select : COLORS.ink;
  ctx.fillStyle = 'rgba(244, 236, 214, 0.9)';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (sector) {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x - 4, y);
  ctx.lineTo(x + 4, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.stroke();
}

export function radarMast(ctx, x, y) {
  ctx.strokeStyle = COLORS.rafRed;
  ctx.fillStyle = 'rgba(168, 50, 45, 0.15)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y - 7);
  ctx.lineTo(x - 5, y + 4);
  ctx.lineTo(x + 5, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 2);
  ctx.lineTo(x + 3, y - 2);
  ctx.stroke();
}

export function anchor(ctx, x, y, s = 6, color = COLORS.ink) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.8, s * 0.25, 0, Math.PI * 2);
  ctx.moveTo(x, y - s * 0.55);
  ctx.lineTo(x, y + s * 0.9);
  ctx.moveTo(x - s * 0.45, y - s * 0.25);
  ctx.lineTo(x + s * 0.45, y - s * 0.25);
  ctx.moveTo(x - s * 0.75, y + s * 0.2);
  ctx.quadraticCurveTo(x - s * 0.6, y + s * 0.95, x, y + s * 0.9);
  ctx.quadraticCurveTo(x + s * 0.6, y + s * 0.95, x + s * 0.75, y + s * 0.2);
  ctx.stroke();
}

export function ship(ctx, x, y, heading, size = 9, color = COLORS.convoy) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading * DEG);
  ctx.fillStyle = color;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.quadraticCurveTo(size * 0.45, -size * 0.3, size * 0.4, size * 0.8);
  ctx.lineTo(-size * 0.4, size * 0.8);
  ctx.quadraticCurveTo(-size * 0.45, -size * 0.3, 0, -size);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Plot arrow pointing along `heading` (or a dot when the heading is unknown). */
export function plotArrow(ctx, x, y, heading, color, size = 7) {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(20, 16, 10, 0.6)';
  ctx.lineWidth = 0.8;
  if (heading === null || heading === undefined) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading * DEG);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.6, size * 0.7);
  ctx.lineTo(0, size * 0.3);
  ctx.lineTo(-size * 0.6, size * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Size of a plaque before drawing it: { w, h }. */
export function measurePlaque(ctx, lines, size = 11) {
  ctx.font = `bold ${size}px ${FONTS.mono}`;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(typeof l === 'string' ? l : l.text).width))) + 8;
  const h = lines.length * (size + 2) + 6;
  return { w, h };
}

/**
 * Small plaque with one or more lines of text, anchored at (x, y) on its left-middle edge.
 * A line is a string, or { text, color } for a line in its own colour.
 * Returns its box { x, y, w, h } in screen pixels.
 */
export function plaque(ctx, x, y, lines, { dark = false, accent = null, size = 11 } = {}) {
  ctx.font = `bold ${size}px ${FONTS.mono}`;
  const pad = 4;
  const lineH = size + 2;
  const items = lines.map((l) => (typeof l === 'string' ? { text: l, color: null } : l));
  const w = Math.ceil(Math.max(...items.map((l) => ctx.measureText(l.text).width))) + pad * 2;
  const h = items.length * lineH + pad * 2 - 2;
  const top = y - h / 2;
  ctx.fillStyle = dark ? COLORS.plaqueEnemy : COLORS.plaque;
  ctx.strokeStyle = accent || (dark ? '#000' : COLORS.ink);
  ctx.lineWidth = accent ? 2 : 1;
  ctx.fillRect(x, top, w, h);
  ctx.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  items.forEach((line, i) => {
    ctx.fillStyle = line.color || (dark ? '#f2e9d2' : COLORS.ink);
    ctx.fillText(line.text, x + pad, top + pad + i * lineH);
  });
  return { x, y: top, w, h };
}

/** Marks on a bombed installation: smoke while damaged, a red cross when out of service. */
export function damageMark(ctx, x, y, status, damage, now) {
  if (status === 'intact') return;
  const puffs = Math.min(4, 1 + Math.floor(damage / 25));
  for (let i = 0; i < puffs; i++) {
    const k = ((now / 2600 + i / puffs) % 1);
    ctx.fillStyle = `rgba(70, 64, 56, ${0.35 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(x + 5 + Math.sin(i * 1.9 + k * 2) * 3, y - 8 - k * 16, 3 + k * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (status === 'out') {
    ctx.strokeStyle = COLORS.rafRed;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 8);
    ctx.lineTo(x + 8, y + 8);
    ctx.moveTo(x - 8, y + 8);
    ctx.lineTo(x + 8, y - 8);
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(176, 122, 18, 0.9)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** Pencil-like polyline in screen coordinates, with an arrow head at the end. */
export function pencilLine(ctx, points, { color = COLORS.pencil, width = 2, dash = null, arrow = true } = {}) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!arrow) return;
  const [ax, ay] = points[points.length - 2];
  const [bx, by] = points[points.length - 1];
  const angle = Math.atan2(by - ay, bx - ax);
  const s = 4 + width * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - s * Math.cos(angle - 0.4), by - s * Math.sin(angle - 0.4));
  ctx.lineTo(bx - s * Math.cos(angle + 0.4), by - s * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

/** Factory: a building with a saw-tooth roof. */
export function factory(ctx, x, y, color = COLORS.ink) {
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(244, 236, 214, 0.95)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 5);
  ctx.lineTo(x - 7, y - 2);
  ctx.lineTo(x - 3.5, y - 6);
  ctx.lineTo(x - 3.5, y - 2);
  ctx.lineTo(x, y - 6);
  ctx.lineTo(x, y - 2);
  ctx.lineTo(x + 3.5, y - 6);
  ctx.lineTo(x + 3.5, y - 2);
  ctx.lineTo(x + 7, y - 2);
  ctx.lineTo(x + 7, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Small goods train, coloured by its load. */
export function train(ctx, x, y, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 1;
  ctx.fillRect(-7, -3, 14, 6);
  ctx.strokeRect(-7, -3, 14, 6);
  ctx.beginPath();
  ctx.moveTo(-2.3, -3);
  ctx.lineTo(-2.3, 3);
  ctx.moveTo(2.3, -3);
  ctx.lineTo(2.3, 3);
  ctx.stroke();
  ctx.restore();
}

/** Warship: a narrow hull, in the colour of the Royal Navy. */
export function warship(ctx, x, y, heading, size = 7) {
  ship(ctx, x, y, heading, size, '#4f6070');
}
