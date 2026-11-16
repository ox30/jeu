// Short animations over the table: air fights, aircraft going down, raids missed, bombs on
// an installation. They run on real time, so that they stay visible at any game speed.
// Effects are created from simulation events by addEffectsForEvent().

import { FOOT_M } from '../sim/geo.js';
import { toScreen } from './camera.js';
import { FONTS } from './map.js';
import { COLORS } from './symbols.js';

const MAX_FX = 80;

/** Height in pixels of the stalk that carries a formation at `altFt`. */
export function stalkPx(app, altFt) {
  if (!app.settings.altitudeStalks || altFt <= 0) return 0;
  return Math.min(56, (altFt / 1000) * 1.6);
}

/** Screen position of a formation: its ground point raised by its stalk. */
export function raisedScreen(app, x, y, altFt) {
  const [sx, sy] = toScreen(app.camera, x, y);
  return [sx, sy - stalkPx(app, altFt), sy];
}

function push(app, fx) {
  app.fx.push({ t0: performance.now(), ...fx });
  if (app.fx.length > MAX_FX) app.fx.splice(0, app.fx.length - MAX_FX);
}

export function addEffectsForEvent(app, e) {
  const ft = (m) => m / FOOT_M;
  switch (e.type) {
    case 'tallyHo':
      push(app, { kind: 'ring', x: e.x, y: e.y, altFt: 0, raidId: e.raidId, dur: 1400, color: COLORS.rafRed });
      break;
    case 'combatRound': {
      const altFt = ft(e.alt);
      const items = [];
      if (e.bombersDown) items.push({ text: `−${e.bombersDown} ${e.bomberType}`, color: '#7c1f18', enemy: true, n: e.bombersDown });
      if (e.fightersDown) items.push({ text: `−${e.fightersDown} ${e.escortType}`, color: '#7c1f18', enemy: true, n: e.fightersDown });
      if (e.losses) items.push({ text: `−${e.losses} ${e.aircraftType}`, color: COLORS.rafBlue, enemy: false, n: e.losses });
      items.forEach((item, i) => {
        push(app, { kind: 'float', x: e.x, y: e.y, altFt, text: item.text, color: item.color, dy: i * 14, dur: 3200 });
        for (let k = 0; k < Math.min(item.n, 5); k++) {
          push(app, {
            kind: 'fall', x: e.x, y: e.y, altFt, enemy: item.enemy, dur: 2600 + Math.random() * 900,
            dx: (Math.random() - 0.5) * 34, delay: k * 220 + Math.random() * 200,
          });
        }
      });
      break;
    }
    case 'missed':
      push(app, {
        kind: 'miss', sx: e.sx, sy: e.sy, sAltFt: ft(e.salt), rx: e.rx, ry: e.ry, rAltFt: ft(e.ralt),
        km: e.km, dzFt: ft(e.dzM), dur: 14000,
      });
      break;
    case 'nothingSeen':
      push(app, { kind: 'nothing', x: e.x, y: e.y, altFt: 0, dur: 6000 });
      break;
    case 'siteHit':
      push(app, { kind: 'bombs', x: e.x, y: e.y, dur: 3500 });
      break;
    case 'raidRepelled':
      push(app, { kind: 'turn', x: e.x, y: e.y, dur: 4000 });
      break;
    default:
  }
}

/** Fight in progress: flashes and short tracer strokes around the formations. */
export function drawMelee(ctx, sx, sy, now, seed) {
  const pulse = 0.5 + 0.5 * Math.sin(now / 140 + seed);
  ctx.strokeStyle = `rgba(168, 50, 45, ${0.35 + 0.45 * pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, 16 + 5 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  // Tracers: a few short strokes whose direction changes every 120 ms.
  const tick = Math.floor(now / 120);
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 6; i++) {
    const r = Math.sin((tick + i * 17 + seed) * 12.9898) * 43758.5453;
    const k = r - Math.floor(r);
    const a = k * Math.PI * 2;
    const d = 6 + k * 14;
    const x0 = sx + Math.cos(a) * d;
    const y0 = sy + Math.sin(a) * d;
    ctx.strokeStyle = i % 2 ? 'rgba(212, 160, 23, 0.9)' : 'rgba(250, 236, 200, 0.95)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(a + 1.7) * 7, y0 + Math.sin(a + 1.7) * 7);
    ctx.stroke();
  }
}

function drawFloat(ctx, app, fx, k) {
  const [sx, sy] = raisedScreen(app, fx.x, fx.y, fx.altFt);
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.font = `bold 12px ${FONTS.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = sy - 26 - fx.dy - k * 26;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(247, 240, 220, 0.9)';
  ctx.strokeText(fx.text, sx, y);
  ctx.fillStyle = fx.color;
  ctx.fillText(fx.text, sx, y);
  ctx.globalAlpha = 1;
}

function drawFall(ctx, app, fx, k) {
  const [sx, top, ground] = raisedScreen(app, fx.x, fx.y, fx.altFt);
  const x = sx + fx.dx * k;
  const y = top + (ground - top + 4) * k * k;
  ctx.strokeStyle = 'rgba(70, 64, 56, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx + fx.dx * Math.max(0, k - 0.25), top + (ground - top + 4) * Math.max(0, k - 0.25) ** 2);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.fillStyle = fx.enemy ? COLORS.enemy : COLORS.rafBlue;
  ctx.beginPath();
  ctx.arc(x, y, 2.4, 0, Math.PI * 2);
  ctx.fill();
  if (k > 0.92) {
    ctx.strokeStyle = 'rgba(168, 50, 45, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 3 + (k - 0.92) * 60, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawMiss(ctx, app, fx, k, label) {
  const [ax, ay] = raisedScreen(app, fx.sx, fx.sy, fx.sAltFt);
  const [bx, by] = raisedScreen(app, fx.rx, fx.ry, fx.rAltFt);
  ctx.globalAlpha = k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25);
  ctx.strokeStyle = '#8a5a0b';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  // Hollow marks where each formation was at the closest point.
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = COLORS.rafBlue;
  ctx.beginPath();
  ctx.arc(ax, ay, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = COLORS.enemy;
  ctx.strokeRect(bx - 4.5, by - 4.5, 9, 9);
  ctx.font = `bold 11px ${FONTS.mono}`;
  const w = ctx.measureText(label).width + 10;
  const mx0 = (ax + bx) / 2;
  const my0 = (ay + by) / 2;
  // The label goes where it covers no plaque.
  let mx = mx0;
  let my = my0;
  for (const [dx, dy] of [[0, 0], [0, 22], [0, -22], [-w - 16, 0], [0, 44], [0, -44]]) {
    const rect = { x: mx0 + 8 + dx, y: my0 - 9 + dy, w, h: 18 };
    const free = !(app.plaqueBoxes || []).some((b) => rect.x < b.x + b.w && rect.x + rect.w > b.x && rect.y < b.y + b.h && rect.y + rect.h > b.y);
    if (free) {
      mx = mx0 + dx;
      my = my0 + dy;
      break;
    }
  }
  if (app.plaqueBoxes) app.plaqueBoxes.push({ x: mx + 8, y: my - 9, w, h: 18 });
  ctx.fillStyle = 'rgba(247, 240, 220, 0.95)';
  ctx.fillRect(mx + 8, my - 9, w, 18);
  ctx.strokeStyle = '#8a5a0b';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 8.5, my - 8.5, w - 1, 17);
  ctx.fillStyle = '#6b4408';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, mx + 13, my);
  ctx.globalAlpha = 1;
}

function drawNothing(ctx, app, fx, k) {
  const [sx, sy] = toScreen(app.camera, fx.x, fx.y);
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.fillStyle = '#6b4408';
  ctx.font = `bold 16px ${FONTS.serif}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', sx, sy - 26 - k * 10);
  ctx.globalAlpha = 1;
}

function drawBombs(ctx, app, fx, k) {
  const [sx, sy] = toScreen(app.camera, fx.x, fx.y);
  for (let i = 0; i < 3; i++) {
    const kk = Math.max(0, Math.min(1, k * 1.6 - i * 0.25));
    if (kk <= 0 || kk >= 1) continue;
    ctx.strokeStyle = `rgba(168, 50, 45, ${0.8 * (1 - kk)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx + (i - 1) * 6, sy + (i % 2) * 4, 4 + kk * 26, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(80, 72, 62, ${0.4 * (1 - k)})`;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(sx + Math.sin(i * 2.1) * 10, sy - k * 22 - i * 3, 5 + k * 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRing(ctx, app, fx, k) {
  const [sx, sy] = toScreen(app.camera, fx.x, fx.y);
  ctx.strokeStyle = `rgba(168, 50, 45, ${1 - k})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(sx, sy - (fx.altFt ? stalkPx(app, fx.altFt) : 0), 10 + k * 30, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTurn(ctx, app, fx, k, label) {
  const [sx, sy] = toScreen(app.camera, fx.x, fx.y);
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.font = `bold 12px ${FONTS.serif}`;
  ctx.fillStyle = '#2e6b3a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, sx, sy + 24);
  ctx.globalAlpha = 1;
}

/** Draws and ages the effects. `labels` gives the texts that depend on the language. */
export function drawEffects(ctx, app, labels) {
  const now = performance.now();
  app.fx = app.fx.filter((fx) => now - fx.t0 - (fx.delay || 0) < fx.dur);
  for (const fx of app.fx) {
    const age = now - fx.t0 - (fx.delay || 0);
    if (age < 0) continue;
    const k = Math.min(1, age / fx.dur);
    switch (fx.kind) {
      case 'float': drawFloat(ctx, app, fx, k); break;
      case 'fall': drawFall(ctx, app, fx, k); break;
      case 'miss': drawMiss(ctx, app, fx, k, labels.miss(fx)); break;
      case 'nothing': drawNothing(ctx, app, fx, k); break;
      case 'bombs': drawBombs(ctx, app, fx, k); break;
      case 'ring': drawRing(ctx, app, fx, k); break;
      case 'turn': drawTurn(ctx, app, fx, k, labels.turn); break;
      default:
    }
  }
}
