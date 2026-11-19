// Top bar: date and time, sector clock, time controls, views and tools.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatDate, formatTime } from '../core/time.js';
import { drawClock } from '../render/clock.js';
import { SPEEDS, cancelSpeed, confirmSpeed, goView, requestSpeed, togglePause } from './actions.js';

export function initHud(app) {
  const el = app.el;
  el.speeds.innerHTML = SPEEDS.map((s, i) =>
    `<button type="button" data-speed="${i}" title="${i + 1}">×${formatNumber(s)}</button>`).join('');
  el.speeds.addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (b) requestSpeed(app, Number(b.dataset.speed));
  });
  el.speedConfirm.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm]');
    if (!b) return;
    if (b.dataset.confirm === 'yes') confirmSpeed(app);
    else cancelSpeed(app);
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
  el.devBadge.hidden = !app.dev;
  el.pause.textContent = app.paused ? t('hud.play') : t('hud.pause');
  el.pause.classList.toggle('active', app.paused);
  for (const b of el.speeds.querySelectorAll('[data-speed]')) {
    b.classList.toggle('active', !app.paused && SPEEDS[Number(b.dataset.speed)] === app.speed);
  }
  renderSpeedConfirm(app);
  el.btnRuler.classList.toggle('active', app.tool === 'ruler');
  el.btnRadar.classList.toggle('active', Boolean(app.settings.radarCover));
  // The views and the tools this scenario declares (its « map » block): the others are hidden.
  const map = app.world.scenario.map || {};
  const offered = (list, name) => !list || list.includes(name);
  el.btnAtlantic.hidden = !offered(map.views, 'atlantic');
  el.btnBritain.hidden = !offered(map.views, 'britain');
  el.btnEngland.hidden = !offered(map.views, 'england');
  el.btnRuler.hidden = !offered(map.tools, 'ruler');
  el.btnRadar.hidden = !offered(map.tools, 'radarCover') || !app.world.radars.length;
  el.btnReports.hidden = !offered(map.tools, 'reports');
  el.btnFormations.hidden = !offered(map.tools, 'formations');
  el.btnRoster.hidden = !offered(map.tools, 'roster');
  el.btnCards.hidden = !offered(map.tools, 'cards');
  // A save that failed stays told until one succeeds.
  el.saveProblem.hidden = !app.saveProblem;
}

/** The question asked before a high speed during an enemy action. */
function renderSpeedConfirm(app) {
  const el = app.el.speedConfirm;
  const q = app.speedConfirm;
  el.hidden = !q;
  if (!q) return;
  const speed = `×${formatNumber(SPEEDS[q.index])}`;
  const stay = app.paused ? t('speedConfirm.stayPaused') : t('speedConfirm.stay', { speed: `×${formatNumber(app.speed)}` });
  el.innerHTML = `<span>${escapeHtml(t(`speedConfirm.${q.action}`, { speed }))}</span>
    <button type="button" data-confirm="yes">${escapeHtml(t('speedConfirm.yes', { speed }))}</button>
    <button type="button" data-confirm="no">${escapeHtml(stay)}</button>`;
}
