// Top bar: date and time, sector clock, time controls, views and tools.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatDate, formatTime } from '../core/time.js';
import { drawClock } from '../render/clock.js';
import { SPEEDS, cancelSpeed, confirmSpeed, goView, requestSpeed, togglePause } from './actions.js';
import { fatigueOn } from '../sim/crews.js';
import { unreadAlerts } from './alerts.js';

const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
// The pictograms of the tools (drawn with the pen of the map: one stroke, no fill).
const ICONS = {
  view: icon('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  ruler: icon('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  radar: icon('<path d="M4 20a16 16 0 0116-16"/><path d="M4 20a9 9 0 019-9"/><circle cx="5" cy="19" r="1.6"/>'),
  formations: icon('<path d="M12 3l2.5 5h-5z"/><path d="M5.5 13l2.5 5H3z"/><path d="M18.5 13l2.5 5h-5z"/>'),
  roster: icon('<circle cx="12" cy="12" r="9"/><path d="M12 6.5V12l3.5 2.5"/>'),
  reports: icon('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>'),
  cards: icon('<path d="M4 5h7a2 2 0 012 2v12a2 2 0 00-2-2H4z"/><path d="M20 5h-7a2 2 0 00-2 2v12a2 2 0 012-2h7z"/>'),
  journal: icon('<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  help: '<span class="tool-glyph" aria-hidden="true">?</span>',
  menu: '<span class="tool-glyph" aria-hidden="true">☰</span>',
};

/** The tools of the top bar: the element, its pictogram, its texts (hud.tools.<name>), its key. */
export const TOOLS = [
  { el: 'btnView', name: 'view', key: null },
  { el: 'btnRuler', name: 'ruler', key: 'R' },
  { el: 'btnRadar', name: 'radar', key: 'C' },
  { el: 'btnFormations', name: 'formations', key: null },
  { el: 'btnRoster', name: 'roster', key: null },
  { el: 'btnReports', name: 'reports', key: null },
  { el: 'btnCards', name: 'cards', key: null },
  { el: 'btnJournal', name: 'journal', key: 'J' },
  { el: 'btnHelp', name: 'help', key: '?' },
  { el: 'btnMenu', name: 'menu', key: null },
];

/** "Règle (R)": the name of a tool and its key, for its tooltip (a tablet has no hover: the word under the pictogram tells it). */
export function toolTip(tool) {
  const name = t(`hud.tools.${tool.name}.name`);
  return tool.key ? t('hud.toolKey', { name, key: tool.key }) : name;
}

function fillTools(el) {
  for (const tool of TOOLS) {
    const b = el[tool.el];
    b.innerHTML = `${ICONS[tool.name]}<span class="tool-label">${escapeHtml(t(`hud.tools.${tool.name}.word`))}</span>${tool.name === 'journal' ? '<span class="tool-count" id="journal-count" hidden></span>' : ''}`;
    b.title = toolTip(tool);
    b.setAttribute('aria-label', toolTip(tool));
  }
}

/** The views this scenario offers, in the small menu of the « Vue » button. */
function fillViews(app) {
  const el = app.el;
  const map = app.world.scenario.map || {};
  const views = app.data.campaign.views;
  const names = (map.views || Object.keys(views)).filter((name) => views[name]);
  const key = names.join(',');
  if (el.viewMenu.dataset.views === key) return;
  el.viewMenu.dataset.views = key;
  el.viewMenu.innerHTML = names.map((name) =>
    `<button type="button" role="menuitem" data-view="${escapeHtml(name)}">${escapeHtml(t(`hud.${name}`))}${views[name].key ? ` <kbd>${escapeHtml(views[name].key)}</kbd>` : ''}</button>`).join('');
  el.btnView.hidden = names.length === 0;
}

function closeViews(el) {
  el.viewMenu.hidden = true;
  el.btnView.setAttribute('aria-expanded', 'false');
}

export function initHud(app) {
  const el = app.el;
  fillTools(el);
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
  // One « Vue » button: a click opens the views of the scenario, a choice closes them.
  el.btnView.addEventListener('click', () => {
    const open = el.viewMenu.hidden;
    el.viewMenu.hidden = !open;
    el.btnView.setAttribute('aria-expanded', String(open));
  });
  el.viewMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    goView(app, b.dataset.view);
    closeViews(el);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!el.viewMenu.hidden && !e.target.closest('.hud-pop')) closeViews(el);
  });
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
  if (el.pause.dataset.paused !== String(app.paused)) {
    el.pause.dataset.paused = String(app.paused);
    el.pause.innerHTML = `<span class="tool-glyph" aria-hidden="true">${app.paused ? '▶' : '❚❚'}</span><span class="tool-label">${escapeHtml(t(app.paused ? 'hud.play' : 'hud.pause'))}</span>`;
    el.pause.title = t('hud.toolKey', { name: t(app.paused ? 'hud.play' : 'hud.pause'), key: t('hud.spaceKey') });
    el.pause.setAttribute('aria-label', el.pause.title);
  }
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
  fillViews(app);
  el.btnRuler.hidden = !offered(map.tools, 'ruler');
  el.btnRadar.hidden = !offered(map.tools, 'radarCover') || !app.world.radars.length;
  el.btnReports.hidden = !offered(map.tools, 'reports');
  el.btnFormations.hidden = !offered(map.tools, 'formations');
  // The duty rosters only matter when the pilots tire (I6 of the audit).
  el.btnRoster.hidden = !offered(map.tools, 'roster') || !fatigueOn(app.world);
  el.btnCards.hidden = !offered(map.tools, 'cards');
  // A save that failed stays told until one succeeds.
  el.saveProblem.hidden = !app.saveProblem;
  // The alerts that went to the journal without having been shown (alerts.js).
  const unread = unreadAlerts(app);
  const count = el.btnJournal.querySelector('.tool-count');
  if (count) {
    count.hidden = unread === 0;
    count.textContent = unread > 99 ? '99+' : String(unread);
  }
  const journal = TOOLS.find((x) => x.name === 'journal');
  el.btnJournal.title = unread ? t('hud.journalUnread', { name: toolTip(journal), n: unread }) : toolTip(journal);
  el.btnJournal.setAttribute('aria-label', el.btnJournal.title);
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
