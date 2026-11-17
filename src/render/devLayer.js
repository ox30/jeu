// Developer mode: the enemy as it really is, drawn in magenta over the plotting table so
// that it cannot be taken for what the player knows. Raids show their target and force,
// U-boats their state, their torpedoes and the convoy they chase.

import { toScreen } from './camera.js';
import { FONTS } from './map.js';
import { devRaids, isRaidActive, raidLine, uboatLine } from '../ui/dev.js';

const DEV = '#c0178f';
const DEV_SOFT = 'rgba(192, 23, 143, 0.45)';

function lerp(a, b, k) {
  return a + (b - a) * k;
}

/**
 * A magenta label beside a symbol at (sx, sy): the first place around it that stays on the
 * map and does not cover a label already drawn; none left, it is left out (the list in the
 * "Enemies" tab still has it).
 */
function label(ctx, cam, placed, sx, sy, text, below = false) {
  ctx.font = `bold 11px ${FONTS.mono}`;
  const w = ctx.measureText(text).width + 8;
  const h = 16;
  const spots = below
    ? [[sx - w / 2, sy + 10], [sx + 10, sy - h / 2], [sx - w - 10, sy - h / 2], [sx - w / 2, sy - 10 - h]]
    : [[sx + 10, sy + 4], [sx + 10, sy - 4 - h], [sx - w - 10, sy + 4], [sx - w - 10, sy - 4 - h]];
  for (const [x0, y0] of spots) {
    const x = Math.max(4, Math.min(cam.width - w - 4, x0));
    const y = Math.max(4, Math.min(cam.height - h - 4, y0));
    if (placed.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y)) continue;
    placed.push({ x, y, w, h });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 245, 250, 0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = DEV;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = DEV;
    ctx.fillText(text, x + 4, y + h / 2 + 0.5);
    return;
  }
}

function dashedLine(ctx, ax, ay, bx, by, dash) {
  ctx.save();
  ctx.strokeStyle = DEV_SOFT;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

function drawRaids(ctx, cam, app, alpha, placed) {
  const w = app.world;
  for (const r of devRaids(w)) {
    if (!isRaidActive(r)) continue;
    const [sx, sy] = toScreen(cam, lerp(r.px, r.x, alpha), lerp(r.py, r.y, alpha));
    const back = r.phase === 'outbound';
    const [tx, ty] = toScreen(cam, back ? r.ox : r.tx, back ? r.oy : r.ty);
    dashedLine(ctx, sx, sy, tx, ty, back ? [2, 4] : [7, 5]);
    // A diamond, unlike any symbol of the game.
    ctx.fillStyle = DEV;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 7);
    ctx.lineTo(sx + 7, sy);
    ctx.lineTo(sx, sy + 7);
    ctx.lineTo(sx - 7, sy);
    ctx.closePath();
    ctx.fill();
    // Under the diamond: the player's own plot of the raid has its plaque on the right.
    label(ctx, cam, placed, sx, sy, raidLine(w, r), true);
  }
}

// Zoomed out over the ocean, a U-boat's label is its number and torpedoes only.
const FULL_LABEL_SCALE = 0.3;

function drawUboats(ctx, cam, app, placed) {
  const w = app.world;
  for (const u of w.uboats) {
    if (u.state === 'gone' || u.state === 'sunk') continue;
    const [sx, sy] = toScreen(cam, u.x, u.y);
    const target = u.target ? w.convoys.find((c) => c.id === u.target) : null;
    if (target && (u.state === 'shadow' || u.state === 'closing')) {
      const [cx, cy] = toScreen(cam, target.x, target.y);
      dashedLine(ctx, sx, sy, cx, cy, [5, 4]);
    } else if (u.state === 'patrol' && u.wx !== undefined) {
      const [wx, wy] = toScreen(cam, u.wx, u.wy);
      dashedLine(ctx, sx, sy, wx, wy, [2, 5]);
    }
    ctx.strokeStyle = DEV;
    ctx.fillStyle = 'rgba(255, 245, 250, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = DEV;
    ctx.font = `bold 10px ${FONTS.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('U', sx, sy + 0.5);
    const text = cam.scale >= FULL_LABEL_SCALE ? uboatLine(w, u, true) : `${u.id.toUpperCase()} · ${u.torpedoes} t`;
    label(ctx, cam, placed, sx, sy, text);
  }
}

export function drawDevLayer(ctx, cam, app, alpha) {
  if (!app.dev) return;
  const placed = [];
  drawRaids(ctx, cam, app, alpha, placed);
  drawUboats(ctx, cam, app, placed);
}
