// The sector clock of an RAF operations room: the dial is divided into 5-minute segments
// coloured red, yellow and blue. Each plot laid on the table takes the colour of the current
// segment, so the controller can tell its age at a glance.

import { COLORS } from './symbols.js';
import { FONTS } from './map.js';

export function drawClock(canvas, ms) {
  const dpr = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 64;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const r = size / 2 - 1.5;

  ctx.fillStyle = '#f4ecd6';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  // Coloured triangles between the 5-minute marks.
  for (let i = 0; i < 12; i++) {
    const a0 = ((i * 30 - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * 30 - 90) * Math.PI) / 180;
    ctx.fillStyle = COLORS.clock[i % 3];
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a0) * r, c + Math.sin(a0) * r);
    ctx.lineTo(c + Math.cos(a1) * r, c + Math.sin(a1) * r);
    ctx.lineTo(c + Math.cos((a0 + a1) / 2) * r * 0.72, c + Math.sin((a0 + a1) / 2) * r * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = '#2b241a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#2b241a';
  ctx.font = `bold ${Math.round(size * 0.14)}px ${FONTS.serif}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('12', c, c - r * 0.5);

  const d = new Date(ms);
  const minutes = d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const hours = (d.getUTCHours() % 12) + minutes / 60;
  const hand = (angleDeg, length, width) => {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * length, c + Math.sin(a) * length);
    ctx.stroke();
  };
  ctx.strokeStyle = '#2b241a';
  hand(hours * 30, r * 0.45, 2.6);
  hand(minutes * 6, r * 0.7, 1.6);
  ctx.beginPath();
  ctx.arc(c, c, 2.2, 0, Math.PI * 2);
  ctx.fill();
}
