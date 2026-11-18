// The watch reports on the page: the « Signaux » tab of the journal (every report, by day
// then by watch, one folded line each, with filters and unread marks), the report itself
// (convoys, escort groups, air, intelligence, signals, what waits for a decision with the
// button that answers it), and the page opened when the game stops at a relief.

import { escapeHtml, t } from '../core/i18n.js';
import { formatDate, formatShortDate, formatTime } from '../core/time.js';
import { unproject } from '../sim/geo.js';
import { WATCH_S, clockHour, fullReport, isQuiet, pendingDecisions } from '../sim/watch.js';
import { shownPosition } from '../sim/comms.js';
import { centreOn, orderEscortHome, orderJoin, select, togglePause } from './actions.js';
import { eventMessage, positionText } from './format.js';
import { setHtml } from './html.js';
import { showPage } from './pages.js';

export const SIGNAL_FILTERS = ['all', 'decide', 'attacks', 'uboats'];

/** What the page remembers of the reports: the tab, the filter, what is unfolded, what was read. */
export function createSignals() {
  return { tab: 'journal', filter: 'all', unit: '', open: new Set(), read: new Set(), key: '' };
}

function convoyName(w, id) {
  const c = w.convoys.find((x) => x.id === id);
  return c ? c.name : id;
}

function escortShort(w, id) {
  const e = w.escorts.find((x) => x.id === id);
  return e ? e.short : id;
}

/** "0-4 h" for the watch that ended at `toS`. */
function watchHours(w, toS) {
  const to = clockHour(w, toS) || 24;
  return t('watch.hours', { from: Math.max(0, to - 4), to });
}

/** The day a watch belongs to (the one it began in): ms of its start. */
function watchStartMs(w, toS) {
  return w.startMs + Math.max(0, toS - WATCH_S) * 1000;
}

/** "HX 104 attaqué, 2 navires coulés ; 1 décision à prendre" */
export function headlineText(w, r) {
  const parts = (r.headline || []).map((h) => t(`watch.head.${h.key}`, {
    n: h.n ?? 0, convoy: h.convoyId ? convoyName(w, h.convoyId) : '', escort: h.escortId ? escortShort(w, h.escortId) : '',
  }));
  return parts.join(' ; ');
}

/** Does report `r` pass the filter of the page? */
export function passesFilter(r, filter, unit = '') {
  const notes = r.notes || [];
  if (unit) {
    const inRows = (r.convoys || []).some((c) => c.id === unit) || (r.escorts || []).some((e) => e.id === unit && (e.state !== 'inPort' || notes.some((n) => n.escortId === unit)));
    const inNotes = notes.some((n) => n.convoyId === unit || n.escortId === unit || n.byId === unit);
    if (!inRows && !inNotes) return false;
  }
  if (filter === 'decide') return Boolean(r.decisions && r.decisions.length);
  if (filter === 'attacks') return notes.some((n) => n.family === 'attack');
  if (filter === 'uboats') return notes.some((n) => n.family === 'uboat' || n.type === 'dfFix' || n.type === 'convoySighted');
  return true;
}

// ---- the report ---------------------------------------------------------------------------

function unitLink(kind, id, label) {
  return `<button type="button" class="link" data-watch="see" data-kind="${kind}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function convoyLine(w, c) {
  const [lon, lat] = unproject(c.x, c.y);
  const parts = [t(c.state === 'arrived' ? 'watch.convoyArrived' : c.state === 'waiting' ? 'watch.convoyWaiting' : c.est ? 'watch.convoyEstimated' : 'watch.convoyAtSea', {
    ships: c.ships, pos: positionText(lat, lon),
  })];
  if (c.attacks) parts.push(t(c.lost ? 'watch.convoyAttackedLost' : 'watch.convoyAttacked', { n: c.attacks, lost: c.lost }));
  if (c.state !== 'arrived') {
    if (c.escorts.length) parts.push(t('watch.convoyEscort', { groups: c.escorts.map((id) => escortShort(w, id)).join(', ') }));
    else if (c.joining.length) parts.push(t('watch.convoyJoining', { groups: c.joining.map((id) => escortShort(w, id)).join(', ') }));
    else parts.push(t('watch.convoyAlone'));
    if (c.escorts.length && c.joining.length) parts.push(t('watch.convoyJoining', { groups: c.joining.map((id) => escortShort(w, id)).join(', ') }));
  }
  if (c.stragglers) parts.push(t('watch.convoyStragglers', { n: c.stragglers }));
  if (c.markers) parts.push(t('watch.convoyMarkers', { n: c.markers }));
  return `<li class="${c.attacks ? 'hit' : ''}">${unitLink('convoy', c.id, convoyName(w, c.id))} : ${escapeHtml(parts.join(' ; '))}</li>`;
}

function escortOrderText(w, e) {
  const convoy = e.convoy ? convoyName(w, e.convoy) : '';
  const port = e.port ? (w.byId.port.get(e.port) || { name: e.port }).name : '';
  if (e.dry) return t('watch.order.dry', { port });
  if (e.state === 'inPort') return t('watch.order.inPort', { port });
  if (e.state === 'refit') return t('watch.order.refit', { port });
  if (e.state === 'escorting') return t('watch.order.escorting', { convoy });
  if (e.state === 'hunting') return t(convoy ? 'watch.order.hunting' : 'watch.order.huntingAlone', { convoy });
  if (e.state === 'waiting') return t('watch.order.waiting');
  if (e.homeward) return t('watch.order.homeward', { port });
  if (convoy) return t('watch.order.joining', { convoy });
  return t('watch.order.atSea');
}

function escortLine(w, e) {
  const parts = [
    escortOrderText(w, e),
    t('watch.escortFuel', { n: String(e.days).replace('.', ',') }),
    t('sheet.chargesGauge', { n: e.charges, max: e.max }),
    t(e.hunt ? 'watch.escortHunt' : 'watch.escortStay'),
    t(e.light ? 'watch.escortLight' : 'watch.escortFull'),
  ];
  if (e.radar) parts.push(t('sheet.radarFitted'));
  return `<li class="${e.charges <= 0 || e.dry ? 'hit' : ''}">${unitLink('escort', e.id, escortShort(w, e.id))} : ${escapeHtml(parts.join(' ; '))}</li>`;
}

function airText(r) {
  const a = r.air;
  if (!a.sorties && !a.sightings && !a.attacks && !a.lost) return t('watch.airNone');
  const parts = [t('watch.airSorties', { n: a.sorties })];
  if (a.sightings) parts.push(t('watch.airSightings', { n: a.sightings }));
  if (a.attacks) parts.push(t('watch.airAttacks', { n: a.attacks, sunk: a.sunk }));
  if (a.lost) parts.push(t('watch.airLost', { n: a.lost }));
  return parts.join(' ; ');
}

function intelText(w, r) {
  const i = r.intel;
  const parts = [];
  if (i.plots) parts.push(t('watch.intelPlots', { n: i.plots }));
  if (i.fixes) parts.push(t('watch.intelFixes', { n: i.fixes }));
  if (i.shadowed.length) parts.push(t('watch.intelShadowed', { convoys: i.shadowed.map((id) => convoyName(w, id)).join(', ') }));
  for (const c of i.condors) parts.push(t(c.attack ? (c.sunk ? 'watch.intelCondorHit' : 'watch.intelCondorMiss') : 'watch.intelCondor', { convoy: convoyName(w, c.convoyId), n: c.sunk || 0 }));
  return parts.length ? parts.join(' ; ') : t('watch.intelNone');
}

/** One decision: its sentence and the buttons that answer it (when it still waits). */
function decisionHtml(w, d, live) {
  const still = live.some((x) => x.key === d.key);
  const name = d.unitKind === 'convoy' ? convoyName(w, d.unitId) : escortShort(w, d.unitId);
  let text;
  const buttons = [];
  const see = `<button type="button" data-watch="see" data-kind="${d.unitKind}" data-id="${escapeHtml(d.unitId)}">${escapeHtml(t('watch.see'))}</button>`;
  if (d.kind === 'reach') {
    text = t('watch.decide.reach', { convoy: name, km: d.km });
    if (still) {
      for (const id of d.groups.slice(0, 3)) {
        const e = w.escorts.find((x) => x.id === id);
        if (!e || e.state !== 'inPort') continue;
        buttons.push(`<button type="button" data-watch="send" data-group="${escapeHtml(id)}" data-convoy="${escapeHtml(d.unitId)}">${escapeHtml(t('watch.send', { group: e.short, port: w.byId.port.get(e.portId).name }))}</button>`);
      }
    }
  } else if (d.kind === 'waiting') {
    text = t(d.unitKind === 'escort' ? 'watch.decide.waitingEscort' : 'watch.decide.waitingConvoy', { name });
    if (still && d.unitKind === 'escort') buttons.push(`<button type="button" data-watch="home" data-id="${escapeHtml(d.unitId)}">${escapeHtml(t('watch.home'))}</button>`);
  } else if (d.kind === 'charges') {
    text = t(d.convoyId ? 'watch.decide.charges' : 'watch.decide.chargesAlone', { name, convoy: d.convoyId ? convoyName(w, d.convoyId) : '' });
    if (still) buttons.push(`<button type="button" data-watch="home" data-id="${escapeHtml(d.unitId)}">${escapeHtml(t('watch.rearm'))}</button>`);
  } else {
    text = t('watch.decide.marker', { convoy: name, plots: d.plots, fixes: d.fixes, n: d.plots + d.fixes });
  }
  buttons.push(see);
  return `<li class="decision${still ? '' : ' settled'}"><span class="grow">${escapeHtml(text)}${still ? '' : ` <em>${escapeHtml(t('watch.settled'))}</em>`}</span><span class="decision-buttons">${buttons.join('')}</span></li>`;
}

/** The report of a watch, unfolded. `live`: the decisions that wait now (pendingDecisions). */
export function reportHtml(app, raw, live = null) {
  const w = app.world;
  const r = fullReport(w, raw);
  const pending = live || pendingDecisions(w);
  const signals = r.notes.map((n) => {
    const msg = eventMessage(w, n);
    return msg ? `<li class="log-${msg.level}"><time>${escapeHtml(formatTime(w.startMs + n.t * 1000))}</time> ${escapeHtml(msg.text)}</li>` : '';
  }).filter(Boolean);
  return [
    r.decisions.length ? `<h4 class="decide">${escapeHtml(t('watch.decideTitle'))}</h4><ul class="decisions">${r.decisions.map((d) => decisionHtml(w, d, pending)).join('')}</ul>
      <p class="hint">${escapeHtml(t('watch.decideHint'))}</p>` : '',
    `<h4>${escapeHtml(t('watch.convoys'))}</h4>`,
    r.convoys.length ? `<ul class="rows">${r.convoys.map((c) => convoyLine(w, c)).join('')}</ul>` : `<p class="hint">${escapeHtml(t('watch.convoysNone'))}</p>`,
    `<h4>${escapeHtml(t('watch.escorts'))}</h4><ul class="rows">${r.escorts.map((e) => escortLine(w, e)).join('')}</ul>`,
    `<h4>${escapeHtml(t('watch.air'))}</h4><p>${escapeHtml(airText(r))}</p>`,
    `<h4>${escapeHtml(t('watch.intel'))}</h4><p>${escapeHtml(intelText(w, r))}</p>`,
    `<h4>${escapeHtml(t('watch.signals'))}</h4>`,
    signals.length ? `<ol class="log watch-signals">${signals.join('')}</ol>` : `<p class="hint">${escapeHtml(t('watch.signalsNone'))}</p>`,
  ].join('');
}

/** "14 janv., 0-4 h" */
export function watchLabel(w, r) {
  return t('watch.label', { date: formatShortDate(watchStartMs(w, r.toS), t('months')), hours: watchHours(w, r.toS) });
}

// ---- the « Signaux » tab of the journal --------------------------------------------------

/** Not read yet? (A report with nothing to say needs no reading.) */
function isUnread(app, r) {
  return !app.signals.read.has(r.id) && !isQuiet(r);
}

/** Number of reports not read yet. */
export function unreadCount(app) {
  const W = app.world.watch;
  if (!W) return 0;
  let n = 0;
  for (const r of W.reports) if (isUnread(app, r)) n++;
  return n;
}

function filterBar(app) {
  const w = app.world;
  const s = app.signals;
  const buttons = SIGNAL_FILTERS.map((f) => `<button type="button" data-watch="filter" data-filter="${f}" class="${s.filter === f ? 'active' : ''}">${escapeHtml(t(`watch.filters.${f}`))}</button>`).join('');
  const units = [
    ...w.convoys.filter((c) => c.type === 'ocean' && !c.straggler).map((c) => ({ id: c.id, name: c.name })),
    ...w.escorts.map((e) => ({ id: e.id, name: e.short })),
  ];
  const options = [`<option value="">${escapeHtml(t('watch.filters.unit'))}</option>`, ...units.map((u) => `<option value="${escapeHtml(u.id)}"${s.unit === u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`)].join('');
  return `<div class="signal-filters">${buttons}<select data-watch-unit aria-label="${escapeHtml(t('watch.filters.unit'))}">${options}</select></div>`;
}

/** The tab: the reports by day (newest first), each watch on one line, unfolded on a click. */
export function renderSignals(app) {
  const w = app.world;
  const W = w.watch;
  if (!W) return;
  const s = app.signals;
  const key = `${W.reports.length}|${s.filter}|${s.unit}|${[...s.open].join(',')}|${s.read.size}|${w.t - (w.t % 600)}`;
  if (key === s.key) return;
  s.key = key;
  const live = pendingDecisions(w);
  const days = new Map();
  for (let i = W.reports.length - 1; i >= 0; i--) {
    const r = W.reports[i];
    if (!passesFilter(r, s.filter, s.unit)) continue;
    const ms = watchStartMs(w, r.toS);
    const day = Math.floor(ms / 86400000);
    if (!days.has(day)) days.set(day, { ms, lines: [] });
    const open = s.open.has(r.id);
    const unread = isUnread(app, r);
    const flags = `${unread ? ' unread' : ''}${r.stop ? ' stopped' : ''}${(r.notes || []).some((n) => n.family === 'attack') ? ' attack' : ''}`;
    days.get(day).lines.push(`<li class="watch-line${open ? ' open' : ''}${flags}" data-report-id="${escapeHtml(r.id)}">
      <div class="watch-head" data-watch="toggle"><span class="fold">▾</span><span class="when">${escapeHtml(watchHours(w, r.toS))}</span>: ${escapeHtml(headlineText(w, r))}</div>
      ${open ? `<div class="watch-body">${reportHtml(app, r, live)}</div>` : ''}</li>`);
  }
  const groups = [...days.values()].map((d) => `<li class="log-group"><div class="log-day">${escapeHtml(formatDate(d.ms, t('days'), t('months')))}</div><ol class="watch-lines">${d.lines.join('')}</ol></li>`);
  const unread = unreadCount(app);
  setHtml(app.el.signals, `${filterBar(app)}
    ${unread ? `<p class="signal-tools"><button type="button" class="link" data-watch="read-all">${escapeHtml(t('watch.readAll', { n: unread }))}</button></p>` : ''}
    ${groups.length ? `<ol class="log signals-list">${groups.join('')}</ol>` : `<p class="hint">${escapeHtml(t(W.reports.length ? 'watch.noneFiltered' : 'watch.none'))}</p>`}`);
}

/** Shows the tab chosen and the count of unread reports on the « Signaux » tab. */
export function updateSignalsChrome(app) {
  const el = app.el;
  const has = Boolean(app.world.watch);
  el.logTabs.hidden = !has;
  if (!has) app.signals.tab = 'journal';
  const tab = app.signals.tab;
  el.log.hidden = tab !== 'journal';
  el.signals.hidden = tab !== 'signals';
  for (const b of el.logTabs.querySelectorAll('[data-log-tab]')) b.classList.toggle('active', b.dataset.logTab === tab);
  const n = has ? unreadCount(app) : 0;
  el.signalsCount.hidden = n === 0;
  el.signalsCount.textContent = n ? String(n) : '';
  if (tab === 'signals') renderSignals(app);
}

/** Goes to a unit of a report: the map centres on it and its sheet opens. */
function seeUnit(app, kind, id) {
  const w = app.world;
  const u = kind === 'convoy' ? w.convoys.find((x) => x.id === id) : w.escorts.find((x) => x.id === id);
  if (!u) return;
  select(app, kind, id);
  const p = shownPosition(w, u);
  centreOn(app, p.x, p.y, 0.25);
  app.dirtyPanels = true;
}

/** A click in the tab or in the page of a report. Returns true when it was one of ours. */
export function onWatchClick(app, e) {
  const b = e.target.closest('[data-watch]');
  if (!b) return false;
  const s = app.signals;
  const w = app.world;
  const action = b.dataset.watch;
  const line = b.closest('[data-report-id]');
  if (action === 'toggle' && line) {
    const id = line.dataset.reportId;
    if (s.open.has(id)) s.open.delete(id);
    else s.open.add(id);
    s.read.add(id);
    // A click on the line also goes to what it is about: the first convoy attacked.
    const r = w.watch.reports.find((x) => x.id === id);
    const head = r && (r.headline || []).find((h) => h.convoyId || h.escortId);
    if (head && s.open.has(id)) seeUnit(app, head.convoyId ? 'convoy' : 'escort', head.convoyId || head.escortId);
  } else if (action === 'filter') {
    s.filter = b.dataset.filter;
  } else if (action === 'read-all') {
    for (const r of w.watch.reports) s.read.add(r.id);
  } else if (action === 'see') {
    seeUnit(app, b.dataset.kind, b.dataset.id);
    const dlg = b.closest('dialog');
    if (dlg) dlg.close();
  } else if (action === 'send') {
    const group = w.escorts.find((x) => x.id === b.dataset.group);
    if (group) orderJoin(app, group, b.dataset.convoy);
  } else if (action === 'home') {
    const group = w.escorts.find((x) => x.id === b.dataset.id);
    if (group) orderEscortHome(app, group);
  } else if (action === 'resume') {
    const dlg = b.closest('dialog');
    if (dlg) dlg.close();
    if (app.paused) togglePause(app);
  } else if (action === 'close') {
    const dlg = b.closest('dialog');
    if (dlg) dlg.close();
  } else {
    return false;
  }
  s.key = '';
  app.dirtyHud = true;
  app.dirtyPanels = true;
  refreshWatchPage(app);
  return true;
}

// ---- the page opened when the game stops at a relief --------------------------------------

function watchPageHtml(app, r) {
  const w = app.world;
  const hour = clockHour(w, r.toS);
  const why = r.stop === 'decision' ? t('watch.stopDecision', { n: (r.fresh || []).length }) : r.stop === 'fixed' ? t('watch.stopFixed') : '';
  return `<form method="dialog" class="page watch-page">
    <header class="page-head"><h2>${escapeHtml(t('watch.pageTitle', { hour, date: formatShortDate(w.startMs + r.toS * 1000, t('months')) }))}</h2>
      <span class="when">${escapeHtml(t('watch.pageSub', { label: watchLabel(w, r) }))}</span></header>
    ${why ? `<p class="watch-why">${escapeHtml(why)}</p>` : ''}
    <div class="watch-body">${reportHtml(app, r)}</div>
    <div class="dialog-buttons">
      <button type="button" class="secondary" data-watch="close">${escapeHtml(t('watch.close'))}</button>
      <button type="button" data-watch="resume">${escapeHtml(t('watch.resume'))}</button>
    </div></form>`;
}

/** Opens the page of a report (the last one by default) and marks it read. */
export function openWatch(app, reportId = null) {
  const W = app.world.watch;
  if (!W || !W.reports.length) return;
  const r = (reportId && W.reports.find((x) => x.id === reportId)) || W.reports[W.reports.length - 1];
  const dlg = app.el.dlgWatch;
  dlg.dataset.reportId = r.id;
  dlg.innerHTML = watchPageHtml(app, r);
  app.signals.read.add(r.id);
  app.signals.key = '';
  app.dirtyHud = true;
  showPage(app, dlg);
}

/** After an order given from the page: the decisions answered show as settled. */
function refreshWatchPage(app) {
  const dlg = app.el.dlgWatch;
  if (!dlg || !dlg.open) return;
  const r = app.world.watch.reports.find((x) => x.id === dlg.dataset.reportId);
  if (r) dlg.innerHTML = watchPageHtml(app, r);
}
