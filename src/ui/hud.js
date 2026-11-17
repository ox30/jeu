// Top bar: date and time, sector clock, time controls, views and tools.

import { formatNumber, t } from '../core/i18n.js';
import { formatDate, formatTime } from '../core/time.js';
import { drawClock } from '../render/clock.js';
import { SPEEDS, goView, setSpeedIndex, togglePause } from './actions.js';

export function initHud(app) {
  const el = app.el;
  el.speeds.innerHTML = SPEEDS.map((s, i) =>
    `<button type="button" data-speed="${i}" title="${i + 1}">×${formatNumber(s)}</button>`).join('');
  el.speeds.addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (b) setSpeedIndex(app, Number(b.dataset.speed));
  });
  el.pause.addEventListener('click', () => togglePause(app));
  el.btnAtlantic.addEventListener('click', () => goView(app, 'atlantic'));
  el.btnEngland.addEventListener('click', () => goView(app, 'england'));
  el.btnBritain.addEventListener('click', () => goView(app, 'britain'));
  el.btnRuler.addEventListener('click', () => app.setTool(app.tool === 'ruler' ? null : 'ruler'));
  el.btnRadar.addEventListener('click', () => app.toggleRadarCover());
  el.btnPanel.addEventListener('click', () => el.panel.classList.toggle('open'));
}

export function updateHud(app, ms) {
  const el = app.el;
  drawClock(el.clock, ms);
  const date = formatDate(ms, t('days'), t('months'));
  if (el.date.textContent !== date) el.date.textContent = date;
  const time = formatTime(ms);
  if (el.time.textContent !== time) el.time.textContent = time;
  if (!app.dirtyHud) return;
  app.dirtyHud = false;
  const subtitle = t(`scenarios.${app.world.scenario.id}.title`);
  if (el.subtitle && el.subtitle.textContent !== subtitle) {
    el.subtitle.textContent = subtitle;
    document.title = `${t('app.title')} · ${subtitle}`;
  }
  el.pause.textContent = app.paused ? t('hud.play') : t('hud.pause');
  el.pause.classList.toggle('active', app.paused);
  for (const b of el.speeds.querySelectorAll('[data-speed]')) {
    b.classList.toggle('active', !app.paused && SPEEDS[Number(b.dataset.speed)] === app.speed);
  }
  el.btnRuler.classList.toggle('active', app.tool === 'ruler');
  el.btnRadar.classList.toggle('active', Boolean(app.settings.radarCover));
}
