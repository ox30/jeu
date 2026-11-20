// Side view of an interception, drawn in the squadron sheet: height (feet) against time
// (minutes from now). It shows the band where the nearest raid is believed to fly, the
// heights from which a fight is possible, and the squadron's climb. With an interception
// aid, it also shows when contact is possible and at what height the squadron will be.

import { formatNumber, t } from '../core/i18n.js';
import { FOOT_M } from '../sim/geo.js';
import { solveIntercept } from '../sim/intercept.js';
import { altitudeSigmaFt, nearestContact } from '../sim/query.js';
import { aircraftSpec, feetOf, isFlying, squadronSpeed } from '../sim/squadron.js';
import { airfieldDelayFactor } from '../sim/sites.js';
import { durationText, ftText } from '../ui/format.js';
import { FONTS } from './map.js';

const MAX_FT = 34000;

function verdictOf(world, dzFt) {
  const R = world.rules.squadron;
  const belowFt = R.engageBelowM / FOOT_M;
  const aboveFt = R.engageAboveM / FOOT_M;
  const advFt = R.heightAdvantageM / FOOT_M;
  if (dzFt < -belowFt) return 'low';
  if (dzFt > aboveFt) return 'high';
  if (dzFt >= advFt) return 'above';
  return 'level';
}

const VERDICT_COLORS = { above: '#2e6b3a', level: '#b07a12', low: '#a8322d', high: '#a8322d' };

/** Height of the squadron (feet) at `tS` seconds from now, if it keeps its orders. */
function heightAt(world, s, tS, delayS) {
  const type = aircraftSpec(world, s.type);
  const climbFtS = type.climbMpm / FOOT_M / 60;
  const descentFtS = world.rules.squadron.descentMpm / FOOT_M / 60;
  const startFt = isFlying(s) ? feetOf(s.alt) : 0;
  const targetFt = feetOf(s.targetAlt);
  if (tS <= delayS) return startFt;
  const dt = tS - delayS;
  if (targetFt >= startFt) return Math.min(targetFt, startFt + climbFtS * dt);
  return Math.max(targetFt, startFt - descentFtS * dt);
}

export function drawProfile(canvas, app, s) {
  const world = app.world;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 300;
  const H = canvas.clientHeight || 130;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f7f0dc';
  ctx.fillRect(0, 0, W, H);

  const left = 40;
  const right = W - 8;
  const top = 18;
  const bottom = H - 30;
  const R = world.rules.squadron;
  const field = world.byId.airfield.get(s.airfield);
  const delayS = s.state === 'ready'
    ? R.scrambleSeconds * airfieldDelayFactor(world, field)
    : s.state === 'scrambling' ? s.timer : 0;
  const targetFt = feetOf(s.targetAlt);
  const startFt = isFlying(s) ? feetOf(s.alt) : 0;
  const type = aircraftSpec(world, s.type);
  const climbS = delayS + (Math.abs(targetFt - startFt) / (targetFt >= startFt ? type.climbMpm : R.descentMpm)) * FOOT_M * 60;

  // Possible contact with the nearest raid (only with an interception aid).
  // (Coastal Command patrols the sea: the raids on the table are not its business.)
  const fights = s.role !== 'coastal';
  const near = fights ? nearestContact(world, s.x, s.y) : null;
  let contactS = null;
  const fighting = s.state === 'combat';
  if (near && !fighting && world.settings.interceptAid !== 'none' && s.state !== 'returning' && s.state !== 'refuelling') {
    const v = squadronSpeed(world, s);
    const est = near.est;
    const sol = solveIntercept(s.x, s.y, v, est.x + est.vx * delayS, est.y + est.vy * delayS, est.vx, est.vy);
    if (sol) contactS = delayS + sol.time;
  }
  const spanS = Math.min(45 * 60, Math.max(10 * 60, Math.max(climbS, contactS || 0) * 1.3));
  const X = (sec) => left + (sec / spanS) * (right - left);
  const Y = (ft) => bottom - (Math.max(0, Math.min(MAX_FT, ft)) / MAX_FT) * (bottom - top);

  // Height grid.
  ctx.font = `10px ${FONTS.mono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let ft = 0; ft <= 30000; ft += 5000) {
    ctx.strokeStyle = 'rgba(82, 70, 46, 0.18)';
    ctx.beginPath();
    ctx.moveTo(left, Math.round(Y(ft)) + 0.5);
    ctx.lineTo(right, Math.round(Y(ft)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(70, 58, 36, 0.8)';
    ctx.fillText(ft ? formatNumber(ft) : '0 ft', left - 4, Y(ft));
  }
  // Time ticks every 5 minutes.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let m = 0; m * 60 <= spanS; m += 5) {
    const x = X(m * 60);
    ctx.strokeStyle = 'rgba(82, 70, 46, 0.25)';
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, bottom);
    ctx.lineTo(Math.round(x) + 0.5, bottom + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(70, 58, 36, 0.8)';
    ctx.fillText(m === 0 ? t('profile.now') : `+${m}`, x, bottom + 5);
  }

  let caption = null;
  let captionColor = '#2b241a';
  if (near) {
    const raidFt = near.est.altFt;
    const sigma = altitudeSigmaFt(world, near.est);
    const belowFt = R.engageBelowM / FOOT_M;
    const aboveFt = R.engageAboveM / FOOT_M;
    // Heights from which a fight is possible: green above the raid, amber just below.
    ctx.fillStyle = 'rgba(46, 107, 58, 0.13)';
    ctx.fillRect(left, Y(raidFt + aboveFt), right - left, Y(raidFt + R.heightAdvantageM / FOOT_M) - Y(raidFt + aboveFt));
    ctx.fillStyle = 'rgba(176, 122, 18, 0.12)';
    ctx.fillRect(left, Y(raidFt + R.heightAdvantageM / FOOT_M), right - left, Y(raidFt - belowFt) - Y(raidFt + R.heightAdvantageM / FOOT_M));
    // The raid: its estimated height, with the uncertainty band.
    if (sigma) {
      ctx.fillStyle = 'rgba(29, 29, 29, 0.12)';
      ctx.fillRect(left, Y(raidFt + sigma), right - left, Y(raidFt - sigma) - Y(raidFt + sigma));
    }
    ctx.strokeStyle = '#1d1d1d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, Y(raidFt));
    ctx.lineTo(right, Y(raidFt));
    ctx.stroke();
    ctx.fillStyle = '#1d1d1d';
    ctx.font = `bold 10px ${FONTS.mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${t('profile.raid', { raid: near.contact.label })} · ${ftText(raidFt)}`, right - 2, Y(raidFt) - 2);

    if (contactS !== null) {
      const atFt = heightAt(world, s, contactS, delayS);
      const verdict = verdictOf(world, atFt - raidFt);
      captionColor = VERDICT_COLORS[verdict];
      caption = t('profile.contact', {
        d: durationText(contactS),
        verdict: t(`profile.verdict.${verdict}`, { ft: ftText(Math.round(Math.abs(atFt - raidFt) / 500) * 500) }),
      });
      ctx.strokeStyle = captionColor;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(X(contactS), top);
      ctx.lineTo(X(contactS), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = captionColor;
      ctx.beginPath();
      ctx.arc(X(contactS), Y(atFt), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The squadron's climb (flat until take-off), in RAF blue.
  ctx.strokeStyle = '#2c4a7c';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const sec = (spanS * i) / steps;
    const ft = heightAt(world, s, sec, delayS);
    if (i === 0) ctx.moveTo(X(sec), Y(ft));
    else ctx.lineTo(X(sec), Y(ft));
  }
  ctx.stroke();
  ctx.fillStyle = '#2c4a7c';
  ctx.beginPath();
  ctx.arc(X(0), Y(startFt), 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Caption: the climb, then the contact when known.
  ctx.font = `11px ${FONTS.serif}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#2b241a';
  const climbText = Math.abs(targetFt - startFt) < 100 && delayS === 0
    ? t('profile.level')
    : t('profile.climb', { ft: ftText(targetFt), d: durationText(climbS) });
  ctx.fillText(climbText, left, 2);
  const textY = H - 13;
  ctx.textBaseline = 'top';
  if (fighting) {
    const raid = world.raids.find((r) => r.id === s.engagedRaid);
    ctx.fillStyle = '#a8322d';
    ctx.font = `bold 11px ${FONTS.serif}`;
    ctx.fillText(t('profile.fighting', { raid: raid ? raid.label : '' }), 6, textY, W - 12);
  } else if (caption) {
    ctx.fillStyle = captionColor;
    ctx.font = `bold 11px ${FONTS.serif}`;
    ctx.fillText(caption, 6, textY, W - 12);
  } else if (!near && fights) {
    ctx.fillStyle = 'rgba(70, 58, 36, 0.8)';
    ctx.fillText(t('profile.noRaid'), 6, textY);
  }
  // The legend of the bands, when a raid is drawn: the heights a fight is possible from.
  if (near) {
    ctx.font = `10px ${FONTS.serif}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const legend = t('profile.window');
    const width = ctx.measureText(legend).width;
    ctx.fillStyle = 'rgba(46, 107, 58, 0.45)';
    ctx.fillRect(right - width - 26, 4, 9, 8);
    ctx.fillStyle = 'rgba(176, 122, 18, 0.45)';
    ctx.fillRect(right - width - 15, 4, 9, 8);
    ctx.fillStyle = 'rgba(70, 58, 36, 0.9)';
    ctx.fillText(legend, right, 2);
  }
}
