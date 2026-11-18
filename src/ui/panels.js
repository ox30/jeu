// Side panel: objectives, tote board (units, installations) and the operations journal; and
// beside it the panel of the selected unit or installation, in tabs (orders, route, state,
// card). Panels are rebuilt a few times per second, only when their content changes, so that
// buttons and inputs stay usable.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatDate, formatShortDate, formatTime } from '../core/time.js';
import { distance, unproject } from '../sim/geo.js';
import { gridRef } from '../sim/grid.js';
import { convoyRemainingKm, currentSpeed, fullKnots, shipThrottle } from '../sim/convoy.js';
import { huntHours, isSubmerged, reachKm } from '../sim/asw.js';
import { shipEndChoices } from '../sim/naval.js';
import { legTarget } from '../sim/navigation.js';
import { editableRoute, endChoices, planTrack } from '../sim/orders.js';
import { interceptChance } from '../sim/control.js';
import { activePoint, editingLegIndex, raidsInHand } from './actions.js';
import { formationById, formationOf, membersOf } from '../sim/formations.js';
import { unitCardHtml } from './pages.js';
import { altitudeSigmaFt, contactEstimate, visiblePlots } from '../sim/query.js';
import { aircraftSpec, feetOf, isFlying, squadronSpeed, throttle, typeKmh } from '../sim/squadron.js';
import { effectiveAlert, fatigueLevel, fatigueOn, pilotLossesOn, scrambleSeconds, strength } from '../sim/crews.js';
import { arrivalOf, rallyPoint, tripKm } from '../sim/rally.js';
import { overrideOf, plannedChanges } from '../sim/roster.js';
import { isDaylight } from '../sim/patrols.js';

const isDaylightSafe = (w) => isDaylight(w);
import { radarRangeFactor, siteStatus } from '../sim/sites.js';
import { drawProfile } from '../render/profile.js';
import { button, options, row, setHtml } from './html.js';
import { devRaids, isRaidActive, raidLine, uboatLine, uboatReturnText } from './dev.js';
import {
  convoyCargoRows, coverButtons, escortSheet, exitLines, homePortLine, huntLines, joinLines, renderLogistics, stockBlock, stockOrders, trainSheet,
} from './logisticsPanels.js';
import { isActive } from '../sim/raid.js';
import { altitudeControl, cmdButton, cmdGroup, kmhText, section, speedControl } from './commands.js';
import {
  escortStateText,
  altitudeText, countText, dateTimeText, durationText, endActionText, ftText, headingText, kmText, legEndInput, legText,
  objectiveText, positionText, reportText, siteEffectText, siteRepairText, siteStatusText, siteTitle,
} from './format.js';

const MAX_LOG = 300;

function isSel(app, kind, id) {
  return app.selection && app.selection.kind === kind && app.selection.id === id;
}

/**
 * Adds a line to the operations journal. Lines are grouped by day, newest first; when a new
 * day starts the previous one folds under its date (a click opens it again). `opts.report`
 * makes the line open that raid's report.
 */
export function addLogEntry(app, text, level = 'info', gameT = app.world.t, opts = {}) {
  // Kept for the saved game, so that a resumed game shows its journal again.
  if (!opts.replay) {
    app.logEntries = app.logEntries || [];
    app.logEntries.push({ text, level, t: gameT, report: opts.report || null });
    if (app.logEntries.length > MAX_LOG) app.logEntries.shift();
  }
  const ms = app.world.startMs + gameT * 1000;
  const time = formatTime(ms);
  const day = Math.floor(ms / 86400000);
  if (app.logDay !== day || !app.logGroup) {
    if (app.logGroup) app.logGroup.classList.add('collapsed');
    app.logDay = day;
    const group = document.createElement('li');
    group.className = 'log-group';
    const head = document.createElement('div');
    head.className = 'log-day';
    head.dataset.logToggle = '1';
    head.innerHTML = `<span class="fold">▾</span> ${escapeHtml(formatDate(ms, t('days'), t('months')))} <span class="count"></span>`;
    const list = document.createElement('ol');
    list.className = 'log-entries';
    group.append(head, list);
    app.el.log.prepend(group);
    app.logGroup = group;
    app.logList = list;
  }
  const li = document.createElement('li');
  li.className = `log-${level}`;
  li.innerHTML = `<time>${time}</time> ${escapeHtml(text)}`;
  if (opts.report) {
    li.dataset.report = opts.report;
    li.classList.add('has-report');
    li.title = t('reports.open');
  }
  app.logList.prepend(li);
  const count = app.logList.children.length;
  app.logGroup.querySelector('.count').textContent = t('panel.logCount', { n: count });
  app.logTotal = (app.logTotal || 0) + 1;
  while (app.logTotal > MAX_LOG) {
    const lastGroup = app.el.log.lastElementChild;
    const entries = lastGroup && lastGroup.querySelector('.log-entries');
    if (!entries || !entries.lastElementChild) {
      if (lastGroup) lastGroup.remove();
      break;
    }
    entries.lastElementChild.remove();
    app.logTotal--;
    if (!entries.children.length && lastGroup !== app.logGroup) lastGroup.remove();
  }
}

/** Clears the journal (new scenario). */
export function clearLog(app) {
  app.logEntries = [];
  app.el.log.innerHTML = '';
  app.logDay = null;
  app.logGroup = null;
  app.logList = null;
  app.logTotal = 0;
}

function renderObjectives(app) {
  const items = app.world.objectives.map((o) =>
    `<li class="${o.done ? 'done' : ''}${o.failed ? ' failed' : ''}"><span class="tick">${o.done ? '✓' : o.failed ? '✗' : '○'}</span>${escapeHtml(objectiveText(app.world, o))}</li>`);
  setHtml(app.el.objectives, items.join(''));
}

// ---- tote board ------------------------------------------------------------------

function convoyLabel(c) {
  return c.straggler ? t('units.straggler', { name: c.name.split('·')[0], n: c.strayIndex }) : c.name;
}

function convoyExtra(app, c) {
  const w = app.world;
  if (c.state === 'atSea' && c.route.length) {
    return t('tote.eta', { date: dateTimeText(w.startMs + (w.t + convoyRemainingKm(c) / currentSpeed(c)) * 1000) });
  }
  if (c.state === 'atSea') return t('tote.steering', { heading: headingText(c.heading) });
  return '';
}

function renderUnits(app) {
  const w = app.world;
  const parts = [];
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.convoys'))}</div>`);
  for (const c of w.convoys) {
    const cstate = c.state === 'arrived' && c.unloading ? 'unloading' : c.state;
    parts.push(`<div class="tote-row${isSel(app, 'convoy', c.id) ? ' sel' : ''}" data-action="select" data-kind="convoy" data-id="${escapeHtml(c.id)}">
      <span class="lamp convoy-${c.state}"></span><span class="name">${escapeHtml(convoyLabel(c))}</span>
      <span class="state">${escapeHtml(t(`states.convoy.${cstate}`))}</span>
      <span class="extra">${escapeHtml(convoyExtra(app, c))}</span></div>`);
  }
  const escortRow = (e, member = false) => {
    const with_ = e.state === 'escorting' ? w.convoys.find((c) => c.id === e.escorting) : null;
    return `<div class="tote-row${member ? ' member' : ''}${isSel(app, 'escort', e.id) ? ' sel' : ''}" data-action="select" data-kind="escort" data-id="${escapeHtml(e.id)}">
      <span class="lamp escort-${e.state}"></span><span class="name">${escapeHtml(e.short)}</span>
      <span class="state">${escapeHtml(escortStateText(w, e))}</span>
      <span class="extra">${escapeHtml(with_ ? t('tote.escortingShort', { convoy: with_.name }) : '')}</span></div>`;
  };
  const squadronRow = (s, member = false) => {
    const where = isFlying(s) ? altitudeText(s.alt) : w.byId.airfield.get(s.airfield).name;
    const level = fatigueOn(w) && s.state !== 'lost' ? fatigueLevel(w, s) : 'fresh';
    const tired = level !== 'fresh' ? ` <span class="fatigue-${level}" title="${escapeHtml(t('sheet.fatigue'))}">${escapeHtml(t(`sheet.fatigueLevels.${level}`))}</span>` : '';
    const stateText = s.state === 'ready' && fatigueOn(w) && s.alert !== 'available' ? t(`states.alert.${s.alert}`) : t(`states.squadron.${s.state}`);
    return `<div class="tote-row${member ? ' member' : ''}${isSel(app, 'squadron', s.id) ? ' sel' : ''}" data-action="select" data-kind="squadron" data-id="${escapeHtml(s.id)}">
      <span class="lamp sq-${s.state}${s.state === 'ready' ? ` alert-${s.alert}` : ''}"></span><span class="name">${escapeHtml(s.name)}</span>
      <span class="state">${escapeHtml(stateText)}</span>
      <span class="extra">${strength(w, s)}/${s.aircraftStart} · ${escapeHtml(where)}${tired}</span></div>`;
  };
  // A formation is one line, its members in small below it.
  const formationRows = (kind) => w.formations.filter((f) => f.kind === kind).map((f) => {
    const members = membersOf(w, f);
    const leader = members[0];
    if (!leader) return '';
    const air = kind === 'air';
    const total = members.reduce((n, u) => n + (air ? strength(w, u) : u.ships), 0);
    const where = air ? (isFlying(leader) ? altitudeText(leader.alt) : w.byId.airfield.get(leader.airfield).name) : '';
    const state = air ? (leader.holdForWing ? t('sheet.gathering') : t(`states.squadron.${leader.state}`)) : escortStateText(w, leader);
    const extra = air ? `${t('tote.wingExtra', { n: members.length, total })} · ${where}` : t('tote.groupExtra', { n: members.length, total });
    return `<div class="tote-row formation${isSel(app, 'formation', f.id) ? ' sel' : ''}" data-action="select" data-kind="formation" data-id="${escapeHtml(f.id)}">
      <span class="lamp ${air ? `sq-${leader.state}` : `escort-${leader.state}`}"></span><span class="name">${escapeHtml(f.name)}</span>
      <span class="state">${escapeHtml(state)}</span>
      <span class="extra">${escapeHtml(extra)}</span></div>${members.map((u) => (air ? squadronRow(u, true) : escortRow(u, true))).join('')}`;
  }).join('');
  if (w.escorts.length) {
    parts.push(`<div class="tote-group">${escapeHtml(t('tote.escorts'))}</div>`);
    parts.push(formationRows('naval'));
    for (const e of w.escorts) if (!e.formation) parts.push(escortRow(e));
  }
  const fighters = w.squadrons.filter((s) => s.role === 'fighter');
  const patrols = w.squadrons.filter((s) => s.role !== 'fighter');
  const groups = [[t('tote.squadrons'), fighters, true]];
  if (patrols.length) groups.push([t('tote.patrols'), patrols, false]);
  for (const [title, list, wings] of groups) {
    parts.push(`<div class="tote-group">${escapeHtml(title)}</div>`);
    if (wings) parts.push(formationRows('air'));
    for (const s of list) if (!s.formation) parts.push(squadronRow(s));
  }
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.raids'))}</div>`);
  let any = false;
  for (const contact of w.contacts.values()) {
    const est = contactEstimate(w, contact);
    if (!est) continue;
    any = true;
    const plots = visiblePlots(w, contact);
    const last = plots[plots.length - 1];
    const age = last ? Math.floor((w.t - last.t) / 60) : 0;
    parts.push(`<div class="tote-row${isSel(app, 'raid', contact.raidId) ? ' sel' : ''}" data-action="select" data-kind="raid" data-id="${escapeHtml(contact.raidId)}">
      <span class="lamp raid"></span><span class="name">${escapeHtml(contact.label)}</span>
      <span class="state">${escapeHtml(countText(est.count, est.approx))} · ${escapeHtml(ftText(est.altFt))}</span>
      <span class="extra">${escapeHtml(age < 1 ? t('tote.now') : t('tote.ago', { n: age }))}</span></div>`);
  }
  if (!any) parts.push(`<div class="tote-empty">${escapeHtml(t('tote.noRaid'))}</div>`);
  if (w.uboatPlots.length) {
    parts.push(`<div class="tote-group">${escapeHtml(t('tote.uboats'))}</div>`);
    for (const p of [...w.uboatPlots].sort((a, b) => b.t - a.t).slice(0, 6)) {
      const age = Math.floor((w.t - p.t) / 60);
      parts.push(`<div class="tote-row${isSel(app, 'uplot', p.id) ? ' sel' : ''}" data-action="select" data-kind="uplot" data-id="${escapeHtml(p.id)}">
        <span class="lamp uboat"></span><span class="name">${escapeHtml(t('tote.uplot'))}</span>
        <span class="state">${escapeHtml(t(`map.uSource.${p.source}`))} · ${escapeHtml(p.by)}</span>
        <span class="extra">${escapeHtml(age < 60 ? t('tote.ago', { n: age }) : t('tote.agoH', { n: Math.floor(age / 60) }))}</span></div>`);
    }
  }
  return parts.join('');
}

function siteExtra(app, site) {
  const w = app.world;
  if (site.kind === 'airfield') {
    const names = w.squadrons.filter((s) => s.airfield === site.id && !isFlying(s) && s.state !== 'lost').map((s) => s.name);
    return names.join(', ');
  }
  if (site.kind === 'radar') return t('tote.rangeShort', { n: Math.round(radarRangeFactor(w, site) * 100) });
  if (site.kind === 'port') return site.naval ? t('sheet.navalBase') : site.convoys ? t('sheet.convoyPort') : '';
  return '';
}

function renderSites(app) {
  const w = app.world;
  const parts = [];
  if (w.mru && (w.mru.available > 0 || w.mru.pending.length || w.mobileRadars.length)) {
    parts.push(`<div class="tote-group">${escapeHtml(t('mru.title'))}</div>`);
    parts.push(`<div class="order-line mru-line"><span>${escapeHtml(t('mru.available', { n: w.mru.available }))}</span>${button('mru-deploy', app.tool === 'mru' ? t('mru.placing') : t('mru.deploy'), { disabled: w.mru.available <= 0, active: app.tool === 'mru' })}</div>`);
    for (const def of w.mru.pending) {
      parts.push(`<div class="tote-empty">${escapeHtml(t('mru.pending', { name: def.name, time: formatTime(w.startMs + def.readyAt * 1000) }))}</div>`);
    }
  }
  const groups = [['airfield', w.airfields], ['radar', w.radars], ['port', w.ports.filter((p) => !p.foreign)], ['factory', w.factories], ['depot', w.depots || []]];
  for (const [kind, list] of groups) {
    if (!list.length) continue;
    parts.push(`<div class="tote-group">${escapeHtml(t(`sheet.sitesGroup.${kind}`))}</div>`);
    // Damaged installations first, then by name.
    const sorted = [...list].sort((a, b) => b.damage - a.damage || (a.label || a.name).localeCompare(b.label || b.name));
    for (const site of sorted) {
      const status = siteStatus(w, site);
      parts.push(`<div class="tote-row site${isSel(app, 'site', site.key) ? ' sel' : ''}" data-action="select" data-kind="site" data-id="${escapeHtml(site.key)}">
        <span class="lamp site-${status}"></span><span class="name">${escapeHtml(site.label || site.name)}</span>
        <span class="state">${escapeHtml(siteStatusText(w, site))}</span>
        <span class="extra">${escapeHtml(siteExtra(app, site))}</span></div>`);
    }
  }
  return parts.join('');
}

/** Developer mode: the raids of the scenario and the U-boats, as they really are. */
function renderEnemies(app) {
  const w = app.world;
  const parts = [`<div class="tote-group">${escapeHtml(t('dev.raidsTitle'))}</div>`];
  const raids = devRaids(w).filter((r) => r.phase !== 'done').sort((a, b) => a.departure - b.departure);
  if (!devRaids(w).length) parts.push(`<div class="tote-empty">${escapeHtml(t('dev.noRaids'))}</div>`);
  for (const r of raids) {
    const active = isRaidActive(r);
    const when = r.phase === 'pending' ? ` · ${t('dev.at', { time: dateTimeText(w.startMs + r.departure * 1000) })}` : '';
    parts.push(`<div class="tote-row dev-row${active ? ' active' : ''}">
      <span class="name">${escapeHtml(raidLine(w, r) + when)}</span>
      ${active ? button('dev-show', t('dev.show'), { extra: ` data-x="${r.x}" data-y="${r.y}"` }) : ''}</div>`);
  }
  parts.push(`<div class="tote-group">${escapeHtml(t('dev.uboatsTitle'))}</div>`);
  if (!w.uboats.length) parts.push(`<div class="tote-empty">${escapeHtml(t('dev.noUboats'))}</div>`);
  for (const u of w.uboats) {
    const back = uboatReturnText(w, u);
    const atSea = u.state !== 'gone' && u.state !== 'sunk';
    parts.push(`<div class="tote-row dev-row${atSea ? ' active' : ''}">
      <span class="name">${escapeHtml(uboatLine(w, u) + (back ? ` · ${t('dev.back', { date: back })}` : ''))}</span>
      ${atSea ? button('dev-show', t('dev.show'), { extra: ` data-x="${u.x}" data-y="${u.y}"` }) : ''}</div>`);
  }
  return parts.join('');
}

function renderTote(app) {
  let tab = app.toteTab || 'units';
  if (tab === 'logistics' && !app.world.rail.enabled) tab = 'units';
  if (tab === 'enemies' && !app.dev) tab = 'units';
  app.el.tabUnits.classList.toggle('active', tab === 'units');
  app.el.tabSites.classList.toggle('active', tab === 'sites');
  app.el.tabLogistics.classList.toggle('active', tab === 'logistics');
  app.el.tabEnemies.classList.toggle('active', tab === 'enemies');
  app.el.tabEnemies.hidden = !app.dev;
  app.el.tabLogistics.hidden = !app.world.rail.enabled;
  const damaged = [...app.world.sites.values()].filter((s) => s.damage >= 1 && !s.foreign).length;
  const label = damaged ? `${t('panel.sites')} (${damaged})` : t('panel.sites');
  if (app.el.tabSites.textContent !== label) app.el.tabSites.textContent = label;
  const html = tab === 'sites' ? renderSites(app)
    : tab === 'logistics' ? renderLogistics(app)
      : tab === 'enemies' ? renderEnemies(app) : renderUnits(app);
  setHtml(app.el.tote, html);
}

// ---- legs -------------------------------------------------------------------------

function legProgress(app, u, leg) {
  const w = app.world;
  if (!u.legState || !leg.end) return t('legs.current');
  const end = leg.end;
  let left = null;
  if (end.kind === 'duration') left = durationText(end.s - (w.t - u.legState.startT));
  else if (end.kind === 'time') left = durationText(end.t - w.t);
  else {
    const target = legTarget(w, leg, u.kind === 'squadron' ? 'air' : 'sea');
    if (target) left = kmText(distance(u.x, u.y, target.x, target.y));
  }
  return left ? `${t('legs.current')}, ${t('legs.left', { d: left })}` : t('legs.current');
}

/** Controls of the route point picked on the map: its altitude, or removing it. */
function pointBlock(app, u) {
  const ap = activePoint(app);
  if (!ap || ap.u !== u) return '';
  const pts = editableRoute(u);
  const parts = [`<div class="point-block"><div class="sub">${escapeHtml(t('orders.point', { n: ap.index + 1, of: pts.length }))}</div>`];
  if (u.kind === 'squadron') {
    const altM = ap.point[2];
    parts.push(`<div class="order-line"><span>${escapeHtml(t('orders.pointAlt'))}</span>`,
      button('point-alt-down', '−', { id: u.id, kind: u.kind }),
      `<b class="alt-value">${escapeHtml(altM === null || altM === undefined ? t('orders.pointAltNone') : ftText(feetOf(altM)))}</b>`,
      button('point-alt-up', '+', { id: u.id, kind: u.kind }),
      altM === null || altM === undefined ? '' : button('point-alt-clear', t('orders.pointAltClear'), { id: u.id, kind: u.kind }),
      `</div>`);
  }
  parts.push(`<div class="order-line">${button('point-delete', t('orders.pointDelete'), { id: u.id, kind: u.kind })}</div>`,
    `<p class="hint">${escapeHtml(u.kind === 'squadron' ? t('orders.pointHintAir') : t('orders.pointHintSea'))}</p></div>`);
  return parts.join('');
}

/** Arcade: "Intercept H03 · 85 %" for the raids on the table, nearest first. */
function interceptBlock(app, s) {
  const w = app.world;
  if (s.kind !== 'squadron' || s.role !== 'fighter' || w.settings.interceptAid !== 'auto') return '';
  if (!(s.state === 'ready' || s.state === 'scrambling' || s.state === 'airborne')) return '';
  const list = [];
  for (const contact of w.contacts.values()) {
    const raid = w.raids.find((r) => r.id === contact.raidId);
    if (!raid || contact.lost || (raid.phase === 'outbound' && !raid.phantom)) continue;
    const chance = interceptChance(w, s, contact.raidId);
    if (!chance) continue;
    list.push({ contact, chance, d: Math.hypot(chance.x - s.x, chance.y - s.y) });
  }
  if (!list.length) return '';
  list.sort((a, b) => a.d - b.d);
  const guided = s.intercept ? s.intercept.raidId : null;
  const buttons = list.slice(0, 3).map(({ contact, chance }) => button('intercept',
    chance.p > 0 ? t('orders.intercept', { raid: contact.label, p: Math.round(chance.p * 100) }) : t('orders.interceptNone', { raid: contact.label }),
    { id: s.id, kind: 'squadron', disabled: chance.p <= 0, active: guided === contact.raidId, extra: ` data-raid="${escapeHtml(contact.raidId)}"` }));
  return `<div class="order-line intercepts">${buttons.join('')}</div><p class="hint">${escapeHtml(t('orders.interceptHint'))}</p>`;
}

/** The list of legs (or the route being followed) of a unit. */
function planList(app, u) {
  const w = app.world;
  const moving = u.kind === 'squadron' ? isFlying(u) : u.state === 'atSea';
  const parts = [`<div class="sub">${escapeHtml(t('orders.plan'))}</div>`];
  if (u.route && u.route.length && !u.plan.length) {
    parts.push(`<p class="hint">${escapeHtml(t('orders.followingRoute', { n: u.route.length, s: u.route.length > 1 ? 's' : '' }))}</p>`);
  } else if (!u.plan.length) {
    parts.push(`<p class="hint">${escapeHtml(moving ? t('orders.noLeg') : t('orders.noLegReady'))}</p>`);
  } else {
    const track = planTrack(w, u);
    const editing = editingLegIndex(app, u);
    parts.push('<ol class="legs">');
    u.plan.forEach((leg, i) => {
      const end = track[i + 1];
      const when = end && !end.open ? t('legs.eta', { time: formatTime(w.startMs + end.t * 1000) }) : '';
      const status = i === 0 && moving ? legProgress(app, u, leg) : when;
      const cls = [i === 0 && moving ? 'current' : '', i === editing ? 'editing' : ''].filter(Boolean).join(' ');
      parts.push(`<li${cls ? ` class="${cls}"` : ''}><span class="leg-text">${escapeHtml(legText(w, leg))}</span>
        <span class="leg-status">${escapeHtml(status)}</span>
        ${button('edit-leg', '✎', { id: u.id, kind: u.kind, extra: ` data-index="${i}" title="${escapeHtml(t('orders.editLeg'))}"`, cls: 'icon' })}
        ${button('remove-leg', '×', { id: u.id, kind: u.kind, extra: ` data-index="${i}" title="${escapeHtml(t('orders.removeLeg'))}"`, cls: 'icon' })}</li>`);
    });
    parts.push('</ol>');
  }
  return parts.join('');
}

/** A refused order or a typing mistake, shown for a few seconds. */
function messageBlock(app) {
  if (!app.sheetMessage || performance.now() >= app.sheetMessage.until) return '';
  return `<p class="message ${app.sheetMessage.level}">${escapeHtml(app.sheetMessage.text)}</p>`;
}

function legForm(app, u) {
  const sea = u.kind !== 'squadron';
  const editing = editingLegIndex(app, u);
  const leg = editing === null ? null : u.plan[editing];
  const value = (v) => (v === null || v === undefined || v === '' ? '' : ` value="${escapeHtml(String(v))}"`);
  return [
    `<div class="leg-form${leg ? ' editing' : ''}"><div class="sub">${escapeHtml(leg ? t('orders.editingLeg', { n: editing + 1 }) : t('orders.newLeg'))}</div>`,
    `<div class="order-line">`,
    `<label>${escapeHtml(t('orders.legHeading'))} <input type="number" min="0" max="360" step="1" id="leg-heading" inputmode="numeric"${value(leg && leg.heading)}></label>`,
    `<label class="grow">${escapeHtml(t('orders.legEnd'))} <input type="text" id="leg-end" autocomplete="off" spellcheck="false" placeholder="${sea ? '30 · 14:20 · 56N 12O' : '6 · 14:20 · J5'}"${value(leg && legEndInput(app.world, leg, sea))}></label>`,
    sea ? `<label>${escapeHtml(t('orders.legSpeed'))} <input type="number" min="1" max="${u.speedKn}" step="1" id="leg-speed" placeholder="${u.speedKn}"${value(leg && leg.speedKn)}></label>`
      : `<label>${escapeHtml(t('orders.legAlt'))} <input type="number" min="1000" max="32000" step="1000" id="leg-alt" placeholder="—"${value(leg && leg.altFt)}></label>`,
    button('add-leg', leg ? t('orders.applyLeg') : t('orders.addLeg'), { id: u.id, kind: u.kind }),
    leg ? button('cancel-edit-leg', t('orders.cancelEdit'), { id: u.id, kind: u.kind }) : '',
    `</div>`,
    `<p class="hint">${escapeHtml(sea ? t('orders.endHintSea') : t('orders.endHintAir'))}</p>`,
    `<div class="order-line">`,
    button('add-ruler-leg', t('orders.addMeasured'), { id: u.id, kind: u.kind }),
    button('clear-plan', t('orders.clearPlan'), { id: u.id, kind: u.kind }),
    `</div></div>`,
  ].join('');
}

// ---- unit panel ----------------------------------------------------------------------
// The sheet of the selected unit opens in its own panel beside the map, in short tabs:
// Orders (what it does: take-off, readiness, standing orders), Navigation (how it gets there:
// heading, height, speed, route, legs), State, Card; a formation adds its Rendezvous and its
// Members, an aerodrome its duty roster. It stays on that unit until the cross or Escape; a
// click on another unit changes it.

function climbArrow(s) {
  const target = s.targetAlt;
  if (Math.abs(target - s.alt) < 30) return '';
  return target > s.alt ? ` ↑ ${ftText(feetOf(target))}` : ` ↓ ${ftText(feetOf(target))}`;
}

/** End of route (or of legs) of an escort group: stop, hold on, meet a convoy, hunt there, into a port. */
function shipEndLine(app, e) {
  // Going to meet a convoy, or into a port: the route already says how it ends. A convoy
  // keeps its course at the end of its legs (its route ends in a port).
  if (e.kind !== 'escort') return '';
  if (!(e.route.length || e.plan.length) || e.homeward || e.joinTarget || e.state === 'escorting') return '';
  const w = app.world;
  const list = shipEndChoices(w, e).map((a) => ({ value: a.id ? `${a.kind}:${a.id}` : a.kind, label: shipEndText(w, e, a) }));
  const a = e.endAction || { kind: 'stop' };
  const current = a.id ? `${a.kind}:${a.id}` : a.kind;
  return `<div class="order-line"><label class="grow">${escapeHtml(t('orders.endAction'))} <select id="ship-end-${escapeHtml(e.id)}" data-change="ship-end" data-id="${escapeHtml(e.id)}">${options(list, current)}</select></label></div>`;
}

function shipEndText(w, e, a) {
  if (a.kind === 'escort') return t('orders.shipEnd.escort', { convoy: w.convoys.find((c) => c.id === a.id)?.name || '' });
  if (a.kind === 'port') return t('orders.shipEnd.port', { port: w.byId.port.get(a.id)?.name || '' });
  if (a.kind === 'hunt') return t('orders.shipEnd.hunt', { n: huntHours(w, e) });
  return t(`orders.shipEnd.${a.kind}`);
}

function endActionLine(app, s) {
  if (s.state === 'lost' || !(s.route.length || s.plan.length)) return '';
  const w = app.world;
  const list = endChoices(w, s).map((a) => ({ value: a.id ? `${a.kind}:${a.id}` : a.kind, label: endActionText(w, a) }));
  const current = s.endAction.id ? `${s.endAction.kind}:${s.endAction.id}` : s.endAction.kind;
  return `<div class="order-line"><label class="grow">${escapeHtml(t('orders.endAction'))} <select id="end-action" data-change="end-action" data-id="${escapeHtml(s.id)}">${options(list, current)}</select></label></div>`;
}

/** Splits an old-style sheet text into its title (the <h3>) and the rest. */
function splitTitle(html) {
  const m = html.match(/^\s*<h3>([\s\S]*?)<\/h3>/);
  return m ? { title: m[1], body: html.slice(m[0].length) } : { title: '', body: html };
}

function tab(id, parts = {}) {
  return { id, pre: '', keyed: '', post: '', profile: false, ...parts };
}

/** "Member of Big Wing Duxford [See] [Leave]", or the button that starts a formation. */
function formationLine(app, u) {
  const w = app.world;
  const f = formationOf(w, u);
  if (f) {
    const leader = f.members[0] === u.id;
    return `<div class="formation-line"><p>${escapeHtml(t(leader ? 'unit.leaderOf' : 'unit.memberOf', { name: f.name }))}</p>
      <div class="order-line">${button('select', t('unit.showFormation'), { id: f.id, kind: 'formation' })}
      ${button('formation-remove', t('unit.leaveFormation'), { id: u.id, extra: ` data-formation="${escapeHtml(f.id)}"` })}</div>
      <p class="hint">${escapeHtml(t(u.kind === 'squadron' ? 'unit.memberHintAir' : 'unit.memberHintSea'))}</p></div>`;
  }
  if (u.state === 'lost' || (u.kind === 'squadron' && u.role !== 'fighter')) return '';
  return `<div class="order-line">${button('formation-new', t(u.kind === 'squadron' ? 'unit.newWing' : 'unit.newGroup'), { id: u.id, kind: u.kind })}</div>`;
}

// ---- the command bar and the Commandes tab ----
// The sheet's main orders as icons, always in view (take off, orbit, home, break off, standing
// orders, height, speed); under them one « Commandes » tab whose sections follow the unit's
// state (on the ground, in the air, in port, at sea) and fold as the player leaves them.

/** The boost of a type as a share of its cruising speed (Spitfire: 565 / 430 km/h → 131 %). */
function boostShare(type) {
  return Math.round((type.maxKmh / type.cruiseKmh) * 100);
}

/** Command bar of a squadron, or of the leader `s` of formation `f`. */
function airBar(app, s, f = null) {
  const w = app.world;
  if (s.state === 'lost') return '';
  const up = isFlying(s) || s.state === 'scrambling';
  const acts = [];
  if (!up) {
    if (f) {
      const ready = membersOf(w, f).filter((m) => m.state === 'ready').length;
      const planned = f.rally && f.rally.phase !== 'plan' && f.rally.phase !== 'gone';
      if (!planned) acts.push(cmdButton('scramble', 'takeoff', t('cmd.takeoff'), { id: s.id, title: t('unit.scrambleWing', { n: ready }), disabled: !ready }));
    } else {
      acts.push(cmdButton('scramble', 'takeoff', t('cmd.takeoff'), { id: s.id, title: t('orders.scrambleIn', { d: delayText(scrambleSeconds(w, s)) }), disabled: s.state !== 'ready' }));
    }
  } else {
    const can = s.state === 'airborne' || s.state === 'combat' || s.state === 'returning';
    acts.push(cmdButton('orbit', 'orbit', t('cmd.orbit'), { id: s.id, title: t('cmd.orbitTitle'), active: s.orbit && s.state === 'airborne', disabled: !can }));
    acts.push(cmdButton('home', 'home', t('cmd.home'), { id: s.id, title: t('cmd.homeTitle'), active: s.state === 'returning', disabled: !(s.state === 'airborne' || s.state === 'combat') }));
    for (const r of raidsInHand(app, s)) {
      const label = (w.contacts.get(r.id) || r).label;
      acts.push(cmdButton('break-off', 'breakOff', t('cmd.breakOff', { raid: label }), { id: s.id, title: t('cmd.breakOffTitle', { raid: label }), danger: true, extra: ` data-raid="${escapeHtml(r.id)}"` }));
    }
  }
  const roe = s.roe || 'attack';
  const roes = s.role === 'fighter' ? ['defend', 'attack', 'pursue'].map((r) => cmdButton('roe', r, t(`cmd.roe.${r}`), {
    id: f ? f.id : s.id, kind: f ? 'formation' : 'squadron', active: roe === r, title: `${t(`unit.roes.${r}`)} : ${t(`unit.roeHint.${r}`)}`, extra: ` data-roe="${r}"`,
  })).join('') : '';
  const th = throttle(s);
  const speed = speedControl(s, 'squadron', {
    min: w.rules.squadron.minSpeedPct, pct: th.pct, boostOn: th.max, boost: boostShare(aircraftSpec(w, s.type)), unitText: kmhText(squadronSpeed(w, s)),
  });
  return `<div class="cmd-bar">${cmdGroup(t('cmd.orders'), acts.join(''))}${roes ? cmdGroup(t('cmd.roeCaption'), roes, 'roe') : ''}${altitudeControl(s, 'squadron', ftText(feetOf(s.targetAlt)))}${speed}</div>`;
}

/** Command bar of an escort group (or of the leader of a support group). */
function seaBar(app, e) {
  const w = app.world;
  if (e.state === 'lost') return '';
  const acts = [];
  const atSea = ['atSea', 'waiting', 'escorting', 'hunting'].includes(e.state);
  if (e.state === 'inPort') acts.push(cmdButton('sail', 'sail', t('cmd.sail'), { id: e.id, kind: 'escort', title: t('orders.exitHint') }));
  if (atSea) acts.push(cmdButton('escort-home', 'port', t('cmd.port'), { id: e.id, kind: 'escort', title: t('cmd.portTitle') }));
  if (e.state === 'hunting') acts.push(cmdButton('hunt-stop', 'stop', t('cmd.huntStop'), { id: e.id, kind: 'escort', title: t('orders.huntStop'), danger: true }));
  const behaviour = e.behaviour === 'hunt' ? 'hunt' : 'stay';
  const beh = ['stay', 'hunt'].map((b) => cmdButton('escort-behaviour', b, t(`cmd.behaviour.${b}`), {
    id: e.id, kind: 'escort', active: behaviour === b, title: t(`orders.behaviours.${b}`), extra: ` data-behaviour="${b}"`,
  })).join('');
  const th = shipThrottle(w, e);
  const kn = Math.round((currentSpeed(e) * 3600) / 1.852);
  const speed = e.state === 'refit' ? '' : speedControl(e, 'escort', {
    min: w.rules.escortGroups.minSpeedPct, pct: th.pct, boostOn: th.boost, boost: Math.round(w.rules.escortGroups.boostSpeed * 100), unitText: t('cmd.knots', { n: kn }),
  });
  return `<div class="cmd-bar">${cmdGroup(t('cmd.orders'), acts.join(''))}${cmdGroup(t('cmd.uboats'), beh, 'roe')}${speed}</div>`;
}

/** Command bar of a convoy: sail, the Admiralty's route, zigzag, speed. */
function convoyBar(app, c) {
  const w = app.world;
  const canOrder = c.state === 'inPort' || c.state === 'waiting' || c.state === 'atSea';
  if (!canOrder) return '';
  const acts = [];
  if (c.state === 'inPort') acts.push(cmdButton('sail', 'sail', t('cmd.sailConvoy'), { id: c.id, kind: 'convoy', title: t('orders.sailHint'), disabled: !c.plan.length }));
  if (c.admiraltyRoute.length && !c.route.length) acts.push(cmdButton('admiralty', 'route', t('cmd.admiralty'), { id: c.id, kind: 'convoy', title: t('orders.admiralty') }));
  if (c.type !== 'coastal' && !c.straggler) {
    acts.push(cmdButton('zigzag', 'zigzag', t('cmd.zigzag'), { id: c.id, kind: 'convoy', active: c.zigzag, title: c.zigzag ? t('orders.zigzagOn') : t('orders.zigzagOff') }));
  }
  const th = shipThrottle(w, c);
  const kn = Math.round((currentSpeed(c) * 3600) / 1.852);
  const speed = c.type !== 'coastal' && !c.straggler ? speedControl(c, 'convoy', {
    min: w.rules.escortGroups.minSpeedPct, pct: th.pct, boostOn: th.boost, boost: Math.round((c.speedKn / fullKnots(w, c)) * 100), unitText: t('cmd.knotsConvoy', { n: kn, best: c.speedKn }),
  }) : '';
  return `<div class="cmd-bar">${cmdGroup(t('cmd.orders'), acts.join(''))}${speed}</div>`;
}

/** « Cap direct »: a heading to fly now. */
function vectorLine(app, s) {
  const up = isFlying(s) || s.state === 'scrambling';
  return `<div class="order-line"><label>${escapeHtml(t('orders.vector'))} <input type="number" min="0" max="359" step="1" id="vector-input" inputmode="numeric"></label>${button('vector', t('orders.applyVector'), { id: s.id, disabled: !up })}</div>`;
}

/** The route section: points, legs, the climb profile, a heading, the end of the route, a new leg. */
function routeSection(app, u) {
  const air = u.kind === 'squadron';
  const body = [
    pointBlock(app, u),
    planList(app, u),
    air ? '<div class="profile-slot"></div>' : '',
    air ? vectorLine(app, u) : '',
    air ? endActionLine(app, u) : shipEndLine(app, u),
    legForm(app, u),
  ].join('');
  return section(app, air ? 'route' : 'seaRoute', t('sec.route'), `<div class="orders">${body}</div>`);
}

/** Wrapped in the panel's orders look, or nothing. */
function ordersBox(...parts) {
  const html = parts.filter(Boolean).join('');
  return html ? `<div class="orders">${html}</div>` : '';
}

// ---- squadrons ----

function squadronStateText(app, s) {
  const w = app.world;
  const field = w.byId.airfield.get(s.airfield);
  let state = t(`states.squadron.${s.state}`);
  if (s.state === 'refuelling') state += ` · ${t('sheet.readyIn', { n: Math.ceil(s.timer / 60) })}`;
  if (s.state === 'scrambling') state += ` · ${t('sheet.takeoffIn', { n: Math.ceil(s.timer / 60) })}`;
  if (s.state === 'combat') {
    const raid = w.raids.find((r) => r.id === s.engagedRaid);
    if (raid) state += ` · ${t('sheet.inCombatWith', { raid: raid.label })}`;
  }
  if (s.holdForWing) state += ` · ${t('sheet.gathering')}`;
  else if (s.state === 'airborne' && s.orbit) state += ` · ${t('sheet.orbiting')}`;
  if (s.follow) {
    const leader = w.squadrons.find((o) => o.id === s.follow);
    if (leader) state += ` · ${t(s.inFormation ? 'sheet.inFormation' : 'sheet.joining', { name: leader.name })}`;
  }
  if (s.intercept) {
    const c = w.contacts.get(s.intercept.raidId);
    state += ` · ${t('sheet.guided', { raid: c ? c.label : '', p: Math.round(s.intercept.p * 100) })}`;
  }
  if (s.state === 'airborne' && s.cover) {
    const c = w.convoys.find((x) => x.id === s.cover);
    if (c) state += ` · ${t('sheet.covering', { convoy: c.name })}`;
  }
  if (s.state === 'returning') state += ` · ${t('sheet.returningTo', { name: field.name })}`;
  return state;
}

function squadronRows(app, s, state) {
  const w = app.world;
  const type = aircraftSpec(w, s.type);
  const field = w.byId.airfield.get(s.airfield);
  const home = w.byId.airfield.get(s.home);
  const fuel = w.settings.fuel === 'unlimited' ? t('sheet.unlimited') : t('sheet.minutes', { n: Math.max(0, Math.floor(s.fuel)) });
  const flying = isFlying(s);
  const grid = flying ? gridRef(w.grid, s.x, s.y) : null;
  return [
    s.role !== 'fighter' ? `<p class="hint">${escapeHtml(t(`sheet.roleHint.${s.role}`))}</p>` : '',
    row(t('sheet.state'), escapeHtml(state)),
    row(t('sheet.airfield'), escapeHtml(home.name + (field.id !== home.id ? ` → ${field.name}` : ''))),
    row(t('sheet.aircraft'), t('sheet.aircraftOf', { n: s.aircraft, total: s.aircraftStart })),
    pilotLossesOn(w) ? row(t('sheet.pilots'), escapeHtml(t('sheet.pilotsOf', { n: s.pilots, flyable: strength(w, s) }))) : '',
    fatigueOn(w) && s.state !== 'lost' ? row(t('sheet.fatigue'), `<span class="fatigue-${fatigueLevel(w, s)}">${escapeHtml(t('sheet.fatigueText', { n: Math.round(s.fatigue), level: t(`sheet.fatigueLevels.${fatigueLevel(w, s)}`) }))}</span>`) : '',
    flying ? row(t('sheet.altitude'), escapeHtml(altitudeText(s.alt) + climbArrow(s))) : '',
    row(t('sheet.targetAltitude'), escapeHtml(ftText(feetOf(s.targetAlt)))),
    flying ? row(t('sheet.heading'), headingText(s.heading)) : '',
    grid ? row(t('sheet.grid'), escapeHtml(grid)) : '',
    row(t('sheet.speed'), escapeHtml(throttle(s).max ? t('sheet.speedMax', { n: type.maxKmh })
      : t('sheet.speedPct', { p: throttle(s).pct, n: Math.round(typeKmh(type, throttle(s))) }))),
    row(t('sheet.fuel'), escapeHtml(fuel)),
    s.role === 'fighter' ? row(t('sheet.ammo'), escapeHtml(t('sheet.percent', { n: Math.round(s.ammo * 100) })))
      : row(t('sheet.sight'), escapeHtml(t('sheet.sightText', { n: Math.round(w.rules.patrols[s.type][isDaylightSafe(w) ? 'sightDayKm' : 'sightNightKm']) }))),
    s.lastReport ? `<p class="report-line">${escapeHtml(reportText(w, s.lastReport))}</p>` : '',
  ].join('');
}

/** Altitude, speed, vector, orbit, home: the flying orders of a squadron (or a wing's leader). */
// ---- shared blocks: time, standing orders, alert states, timetable ----

export const ALERTS = ['rest', 'thirty', 'available', 'cockpit'];
const DAY_MS = 86400000;

/** "09:30" today, "12 janv. 09:30" another day. */
function clockText(w, gameT) {
  const ms = w.startMs + gameT * 1000;
  const now = w.startMs + w.t * 1000;
  if (Math.floor(ms / DAY_MS) === Math.floor(now / DAY_MS)) return formatTime(ms);
  return dateTimeText(ms);
}

function hhmm(w, gameT) {
  return formatTime(w.startMs + gameT * 1000);
}

/**
 * An hour to type: a plain field ("05:30", "0530", "5h30", "5"), the same in every browser
 * and language (the browser's own clock field shows AM/PM in English and is awkward to type in).
 */
function timeInput(id, value = '') {
  return `<input type="text" inputmode="numeric" maxlength="5" placeholder="hh:mm" autocomplete="off" id="${escapeHtml(id)}" value="${escapeHtml(value)}" class="time-input">`;
}

/** Days to choose from for a sailing (ships plan days ahead). */
function daySelect(w, id, selected = 0) {
  const now = w.startMs + w.t * 1000;
  const list = [];
  for (let d = 0; d < 10; d++) {
    const ms = now + d * DAY_MS;
    list.push({ value: String(d), label: d === 0 ? t('orders.today') : d === 1 ? t('orders.tomorrow') : formatShortDate(ms, t('months')) });
  }
  return `<select id="${escapeHtml(id)}" class="day-select">${options(list, String(selected))}</select>`;
}

/** Which aid the rendezvous plans get: 'auto' (Arcade), 'eta' (Standard) or 'none' (Réaliste). */
function rallyAid(w) {
  if (w.settings.interceptAid === 'auto') return 'auto';
  if (w.settings.interceptAid === 'none') return 'none';
  return 'eta';
}

/** "Dans 5 min" for the time to the air from the alert state. */
function delayText(seconds) {
  return durationText(seconds);
}

export function confirmBox(app, kind, id, name) {
  const c = app.confirm;
  if (!c || c.id !== id) return '';
  return `<div class="confirm-box"><p>${escapeHtml(t('orders.restConfirm', { name }))}</p><div class="order-line">
    ${button('confirm-rest', t('orders.restYes'), { id, kind })}${button('confirm-cancel', t('orders.cancel'), { id, kind })}</div></div>`;
}

/** The four alert states for a squadron, or every squadron of a formation (`f`). */
export function alertButtons(app, u, kind, current) {
  return `<div class="order-line alert-line"><span>${escapeHtml(t('orders.alert'))}</span>${ALERTS.map((a) =>
    button('alert', t(`orders.alerts.${a}`), { id: u.id, kind, active: current === a, extra: ` data-alert="${a}"` })).join('')}</div>`;
}

/** What the alert state means now: the time to the air, or the recall under way. */
export function alertStatus(w, s) {
  if (s.alertManual) return t('orders.manualNow', { d: delayText(scrambleSeconds(w, s)) });
  if (s.alertAt !== null && s.alertAt !== undefined && w.t < s.alertAt) {
    return t('orders.recall', { state: t(`orders.alertNames.${s.alert}`), time: clockText(w, s.alertAt), air: clockText(w, w.t + scrambleSeconds(w, s)) });
  }
  return t('orders.alertNow', { d: delayText(scrambleSeconds(w, s)) });
}

/** "05:30" for a time of day in seconds. */
function todText(tod) {
  const m = Math.floor(tod / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** " (demain)" for a game time on the next day of the game clock, nothing for today. */
function dayWord(w, gameT) {
  const day = (x) => Math.floor((w.startMs + x * 1000) / DAY_MS);
  const n = day(gameT) - day(w.t);
  if (n <= 0) return '';
  return n === 1 ? ` (${t('orders.tomorrow')})` : ` (${t('orders.inDays', { n })})`;
}

/**
 * The duty roster of a squadron: its daily plan (hours only, every day), or, box ticked, the
 * plan for the coming hours that replaces it meanwhile; and the form to add a change.
 */
export function rosterBlock(app, s, { title = true } = {}) {
  const w = app.world;
  const r = s.roster && !Array.isArray(s.roster) ? s.roster : { daily: [], override: null };
  const o = overrideOf(w, s);
  const hours = o ? Math.round((o.until - o.from) / 3600) : Number(app.settings.rosterHours) || 24;
  const item = (id, when, alert) => `<li><span>${escapeHtml(when)} · ${escapeHtml(t(`orders.alertNames.${alert}`))}</span>
    ${button('roster-remove', '×', { id: s.id, kind: 'squadron', cls: 'icon', extra: ` data-entry="${escapeHtml(id)}" title="${escapeHtml(t('orders.remove'))}"` })}</li>`;
  const list = ALERTS.map((a) => ({ value: a, label: t(`orders.alertNames.${a}`) }));
  const parts = [title ? `<div class="sub">${escapeHtml(t('orders.roster'))}</div>` : ''];
  parts.push(`<label class="check roster-mode"><input type="checkbox" id="roster-override-${escapeHtml(s.id)}" data-change="roster-override" data-id="${escapeHtml(s.id)}"${o ? ' checked' : ''}> ${escapeHtml(t('orders.rosterOverride', { n: hours }))}</label>`);
  const stateSelect = `<select id="roster-alert-${escapeHtml(s.id)}">${options(list, 'available')}</select>`;
  if (o) {
    // From H0, the moment the box was ticked: H0 to H+6 at rest, H+6 to H+9 on alert...
    const mark = (at) => (at === o.from ? 'H0' : `H+${hoursText((at - o.from) / 3600)}`);
    const segs = [];
    let from = o.from;
    let entry = null;
    for (const e of o.entries) {
      if (e.at > from) segs.push({ from, to: e.at, entry });
      from = e.at;
      entry = e;
    }
    segs.push({ from, to: o.until, entry });
    const lines = segs.map((g) => {
      const what = g.entry ? t(`orders.alertNames.${g.entry.alert}`) : t('orders.rosterUnchanged');
      const clock = `${hhmm(w, g.from)}-${hhmm(w, g.to)}`;
      const remove = g.entry ? button('roster-remove', '×', { id: s.id, kind: 'squadron', cls: 'icon', extra: ` data-entry="${escapeHtml(g.entry.id)}" title="${escapeHtml(t('orders.remove'))}"` }) : '';
      return `<li class="${g.to <= w.t ? 'past' : ''}"><span>${escapeHtml(`${mark(g.from)} – ${mark(g.to)} · ${what}`)} <small>${escapeHtml(clock)}</small></span>${remove}</li>`;
    });
    parts.push(`<p class="hint">${escapeHtml(t('orders.rosterOverrideUntil', { start: `${hhmm(w, o.from)}${dayWord(w, o.from)}`, n: hours, time: `${hhmm(w, o.until)}${dayWord(w, o.until)}` }))}</p>`);
    parts.push(`<ul class="roster-list override">${lines.join('')}</ul>`);
    if (r.daily.length) {
      const plan = r.daily.map((e) => `${todText(e.tod)} ${t(`orders.alertShort.${e.alert}`)}`).join(' · ');
      parts.push(`<p class="hint">${escapeHtml(t('orders.rosterDailyAfter', { plan }))}</p>`);
    }
    parts.push(
      `<div class="order-line roster-form"><span class="at">${escapeHtml(t('orders.fromH'))}</span>`,
      `<input type="text" id="roster-offset-${escapeHtml(s.id)}" class="offset-input" inputmode="decimal" placeholder="6" autocomplete="off">`,
      `<span class="at">h</span>${stateSelect}`,
      button('roster-add', t('orders.add'), { id: s.id, kind: 'squadron' }),
      '</div>',
    );
  } else {
    const daily = r.daily.map((e) => item(e.id, todText(e.tod), e.alert));
    parts.push(daily.length ? `<ul class="roster-list">${daily.join('')}</ul>` : `<p class="hint">${escapeHtml(t('orders.rosterNone'))}</p>`);
    parts.push(
      `<div class="order-line roster-form">${stateSelect}`,
      `<span class="at">${escapeHtml(t('orders.at'))}</span>${timeInput(`roster-time-${s.id}`)}`,
      button('roster-add', t('orders.add'), { id: s.id, kind: 'squadron' }),
      '</div>',
    );
  }
  return parts.join('');
}

/** "6", "6:30" for a number of hours. */
function hoursText(h) {
  const m = Math.round(h * 60);
  return m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : String(m / 60);
}

/** Alert state of one squadron: buttons, what it means now, rest confirmation, roster. */
function alertBlock(app, s) {
  const w = app.world;
  // On the ground only: the state now (it holds until « Retour au planning »); the plan has its page.
  if (!fatigueOn(w) || s.role !== 'fighter' || (s.state !== 'ready' && s.state !== 'refuelling')) return '';
  return [
    alertButtons(app, s, 'squadron', s.alert || 'available'),
    `<p class="hint">${escapeHtml(alertStatus(w, s))}</p>`,
    confirmBox(app, 'squadron', s.id, s.name),
    rosterLinks(app, s),
  ].join('');
}

/** « Retour au planning » when the state was set by hand, and the page of the plans. */
export function rosterLinks(app, s, field = null) {
  return `<div class="order-line">${s && s.alertManual ? button('roster-resume', t('orders.rosterResume'), { id: s.id, kind: 'squadron' }) : ''}${button('open-roster', t('orders.openRoster'), {
    id: s ? s.id : '', kind: 'squadron', extra: field ? ` data-field="${escapeHtml(field)}"` : '',
  })}</div>`;
}

/** The first time the player schedules something: a word on the alert states. */
function scheduleHint(app) {
  if (app.scheduleHintSeen || !app.scheduleHintShown) return '';
  return `<div class="first-hint"><p>${escapeHtml(t('orders.scheduleHint'))}</p>${button('hint-seen', t('orders.understood'))}</div>`;
}

/** Take-off now, or at a time; or at a time to join a formation. */
function takeoffBlock(app, s, withButton = true) {
  const w = app.world;
  if (s.state === 'lost') return '';
  const grounded = s.state === 'ready' || s.state === 'refuelling';
  const parts = [];
  if (grounded && withButton) {
    parts.push(button('scramble', t('orders.scrambleIn', { d: delayText(scrambleSeconds(w, s)) }), { id: s.id, disabled: s.state !== 'ready' }));
  }
  if (s.schedule) {
    const f = s.schedule.join ? formationById(w, s.schedule.join) : null;
    const text = f
      ? t('orders.scheduledJoin', { time: clockText(w, s.schedule.at), formation: f.name })
      : t(s.schedule.daily ? 'orders.scheduledDaily' : 'orders.scheduled', { time: clockText(w, s.schedule.at) });
    parts.push(`<div class="order-line scheduled"><span class="grow">${escapeHtml(text)}${s.schedule.delayed ? ` · ${escapeHtml(t('orders.waiting'))}` : ''}</span>
      ${s.schedule.rally ? '' : button('schedule-cancel', t('orders.cancel'), { id: s.id, kind: 'squadron' })}</div>`);
    if (!f) parts.push(`<p class="hint">${escapeHtml(t('orders.scheduledRouteHint'))}</p>`);
  } else if (grounded) {
    parts.push(scheduleHint(app));
    parts.push(`<div class="order-line"><span>${escapeHtml(t('orders.scheduleAt'))}</span>${timeInput(`sched-time-${s.id}`)}
      <label class="check"><input type="checkbox" id="sched-daily-${escapeHtml(s.id)}"> ${escapeHtml(t('orders.daily'))}</label>
      ${button('schedule-takeoff', t('orders.schedule'), { id: s.id, kind: 'squadron' })}</div>`);
    const wings = (w.formations || []).filter((f) => f.kind === 'air' && !f.members.includes(s.id));
    if (wings.length && s.role === 'fighter') {
      parts.push(`<div class="order-line"><span>${escapeHtml(t('orders.joinWing'))}</span>
        <select id="join-formation-${escapeHtml(s.id)}">${options(wings.map((f) => ({ value: f.id, label: f.name })))}</select>
        <span class="at">${escapeHtml(t('orders.at'))}</span>${timeInput(`join-time-${s.id}`)}
        ${button('schedule-join', t('orders.schedule'), { id: s.id, kind: 'squadron' })}</div>`);
    }
  }
  return parts.join('');
}

/** Raids the player called this unit off: it leaves them alone until sent back. */
function letGoLine(app, s) {
  const w = app.world;
  const f = formationOf(w, s);
  const list = f ? membersOf(w, f) : [s];
  const labels = new Set();
  for (const m of list) {
    for (const id of m.letGo || []) {
      const r = w.raids.find((x) => x.id === id);
      if (r && isActive(r)) labels.add((w.contacts.get(id) || r).label);
    }
  }
  if (!labels.size) return '';
  return `<p class="hint">${escapeHtml(t(labels.size > 1 ? 'orders.letGoMany' : 'orders.letGo', { raids: [...labels].join(', ') }))}</p>`;
}

// ---- squadrons ----

function squadronPanel(app, s) {
  const w = app.world;
  const state = squadronStateText(app, s);
  const headings = app.settings.orders === 'headings';
  const member = formationOf(w, s);
  const grounded = s.state === 'ready' || s.state === 'refuelling';
  const up = isFlying(s) || s.state === 'scrambling';
  let cmd;
  if (s.state === 'lost') cmd = '';
  else if (member) {
    // In a formation: its orders are the formation's; its readiness and its own departure stay.
    cmd = ordersBox(s.schedule ? takeoffBlock(app, s) : '', alertBlock(app, s), formationLine(app, s));
  } else {
    cmd = [
      grounded || s.schedule ? section(app, 'ground', t('sec.ground'), ordersBox(takeoffBlock(app, s, false), alertBlock(app, s))) : '',
      routeSection(app, s),
      section(app, 'mission', t('sec.mission'), ordersBox(up ? coverButtons(app, s) : '', interceptBlock(app, s), letGoLine(app, s))),
      section(app, 'formation', t('sec.formation'), ordersBox(formationLine(app, s)), !up),
      `<p class="hint">${escapeHtml(grounded
        ? (headings ? t('orders.scrambleHintHeadings') : t('orders.scrambleHint'))
        : (headings ? t('orders.headingsHint') : t('orders.drawHint')))}</p>`,
    ].join('');
  }
  const where = isFlying(s) ? ftText(feetOf(s.alt)) + climbArrow(s) : w.byId.airfield.get(s.airfield).name;
  const tabs = [
    tab('cmd', { keyed: cmd, key: editingLegIndex(app, s), profile: !member && s.state !== 'lost' }),
    tab('state', { pre: squadronRows(app, s, state), profile: Boolean(member) && isFlying(s) }),
    tab('card', { keyed: unitCardHtml(w, s) }),
  ].filter(Boolean);
  return {
    group: 'squadron',
    title: `${escapeHtml(s.name)} <small><button type="button" class="link" data-action="cards" data-type="${escapeHtml(s.type)}" title="${escapeHtml(t('cards.open'))}">${escapeHtml(s.typeName)} ⓘ</button></small>`,
    summary: escapeHtml(`${state} · ${t('unit.aircraftShort', { n: s.aircraft, total: s.aircraftStart })} · ${where}`),
    bar: member ? '' : airBar(app, s),
    tabs,
    profileUnit: s,
  };
}

function sailBlock(app, c) {
  const w = app.world;
  if (c.state !== 'inPort' && c.state !== 'refit') return '';
  if (c.schedule && !c.schedule.join) {
    return `<div class="order-line scheduled"><span class="grow">${escapeHtml(t('orders.sailScheduled', { time: clockText(w, c.schedule.at) }))}${c.schedule.delayed ? ` · ${escapeHtml(t('orders.waiting'))}` : ''}</span>
      ${button('schedule-cancel', t('orders.cancel'), { id: c.id, kind: c.kind })}</div>
      <p class="hint">${escapeHtml(t('orders.sailScheduledHint'))}</p>`;
  }
  if (c.schedule && c.schedule.join) {
    const f = formationById(w, c.schedule.join);
    return `<p class="hint">${escapeHtml(t('orders.sailJoin', { time: clockText(w, c.schedule.at), formation: f ? f.name : '' }))}</p>`;
  }
  return [
    scheduleHint(app),
    `<div class="order-line"><span>${escapeHtml(t('orders.sailAt'))}</span>${daySelect(w, `sail-day-${c.id}`)}${timeInput(`sail-time-${c.id}`)}`,
    button('schedule-sail', t('orders.schedule'), { id: c.id, kind: c.kind }),
    `</div>`,
  ].join('');
}

function convoyPanel(app, c) {
  const w = app.world;
  const dest = c.destination ? w.byId.port.get(c.destination).name : t('sheet.none');
  const [lon, lat] = unproject(c.x, c.y);
  const remaining = convoyRemainingKm(c);
  const speedKn = Math.round((currentSpeed(c) * 3600) / 1.852);
  const stateText = t(`states.convoy.${c.state === 'arrived' && c.unloading ? 'unloading' : c.state}`);
  const rows = [
    c.straggler ? `<p class="hint">${escapeHtml(t('sheet.stragglerHint'))}</p>` : '',
    row(t('sheet.state'), escapeHtml(stateText)),
    c.tankers || c.freighters ? convoyCargoRows(app, c)
      : row(t('sheet.ships'), c.ships === c.shipsStart ? String(c.ships) : t('sheet.aircraftOf', { n: c.ships, total: c.shipsStart })),
    row(t('sheet.speed'), escapeHtml(speedKn < c.speedKn && c.state === 'atSea'
      ? t('sheet.speedKnLeg', { n: speedKn, max: c.speedKn })
      : t('sheet.speedKn', { n: c.speedKn }))),
    c.state === 'atSea' ? row(t('sheet.heading'), headingText(c.heading)) : '',
    row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
    row(t('sheet.destination'), escapeHtml(c.state === 'arrived' ? w.byId.port.get(c.portId).name : dest)),
    remaining !== null && c.state === 'atSea' ? row(t('sheet.remaining'), escapeHtml(kmText(remaining))) : '',
    remaining !== null && c.state === 'atSea' ? row(t('sheet.eta'), escapeHtml(dateTimeText(w.startMs + (w.t + remaining / currentSpeed(c)) * 1000))) : '',
  ].join('');
  const canOrder = c.state === 'inPort' || c.state === 'waiting' || c.state === 'atSea';
  const headings = app.settings.orders === 'headings';
  const cmd = canOrder ? [
    c.state === 'inPort' || c.state === 'refit' ? section(app, 'convoyPort', t('sec.port'), ordersBox(sailBlock(app, c),
      `<p class="hint">${escapeHtml(t('orders.sailHint'))}</p>`)) : '',
    routeSection(app, c),
    c.type !== 'coastal' && !c.straggler ? `<p class="hint">${escapeHtml(t('orders.speedHint', { n: formatNumber(c.speedKn * w.rules.asw.stragglerFrom, 1) }))}</p>` : '',
    c.state !== 'inPort' ? `<p class="hint">${escapeHtml(headings ? t('orders.headingsHint') : t('orders.drawHint'))}</p>` : '',
  ].join('') : '';
  const tabs = [
    canOrder ? tab('cmd', { keyed: cmd, key: editingLegIndex(app, c) }) : null,
    tab('state', { pre: rows }),
    tab('card', { keyed: unitCardHtml(w, c) }),
  ].filter(Boolean);
  return {
    group: 'convoy',
    title: escapeHtml(t('sheet.convoyTitle', { name: convoyLabel(c) })),
    summary: escapeHtml(`${stateText} · ${t('unit.shipsShort', { n: c.ships })}${c.state === 'atSea' ? ` · ${t('units.kn', { n: speedKn })}` : ''}`),
    bar: convoyBar(app, c),
    tabs,
  };
}

/** An escort group joins a support group, sailing at a day and time of its own. */
function joinGroupBlock(app, e) {
  const w = app.world;
  if (e.state === 'lost' || formationOf(w, e)) return '';
  const groups = (w.formations || []).filter((f) => f.kind === 'naval');
  if (!groups.length) return '';
  return `<div class="order-line"><span>${escapeHtml(t('orders.joinGroup'))}</span>
    <select id="group-formation-${escapeHtml(e.id)}">${options(groups.map((f) => ({ value: f.id, label: f.name })))}</select>
    ${daySelect(w, `group-day-${e.id}`)}${timeInput(`group-time-${e.id}`)}
    ${button('schedule-join', t('orders.schedule'), { id: e.id, kind: 'escort' })}</div>`;
}

function escortPanel(app, e) {
  const w = app.world;
  const es = escortSheet(app, e);
  const { title, body } = splitTitle(es.info);
  const member = formationOf(w, e);
  const atSea = ['atSea', 'waiting', 'escorting', 'hunting'].includes(e.state);
  let cmd;
  if (member) cmd = ordersBox(e.schedule ? sailBlock(app, e) : '', formationLine(app, e));
  else if (e.dry && atSea) {
    // Out of fuel: into port at a crawl; only the port can still be chosen.
    cmd = [
      `<p class="hint warn">${escapeHtml(t('orders.dryHint', { kn: e.dryKn }))}</p>`,
      section(app, 'home', t('sec.home'), ordersBox(homePortLine(app, e))),
    ].join('');
  } else {
    cmd = [
      e.state === 'inPort' || e.state === 'refit' ? section(app, 'port', t('sec.port'), ordersBox(e.state === 'inPort' ? exitLines(app, e, { sail: false }) : '', sailBlock(app, e))) : '',
      section(app, 'convoys', t('sec.convoys'), ordersBox(joinLines(app, e))),
      e.state === 'refit' ? '' : section(app, 'uboats', t('sec.uboats'), ordersBox(huntLines(app, e, { behaviour: false }))),
      atSea ? section(app, 'home', t('sec.home'), ordersBox(homePortLine(app, e))) : '',
      es.planUnit ? routeSection(app, e) : '',
      section(app, 'group', t('sec.group'), ordersBox(joinGroupBlock(app, e), formationLine(app, e)), false),
    ].join('');
  }
  const tabs = [
    tab('cmd', { keyed: cmd, key: editingLegIndex(app, e) }),
    tab('state', { pre: body }),
    tab('card', { keyed: unitCardHtml(w, e) }),
  ].filter(Boolean);
  return {
    group: 'escort',
    title,
    summary: escapeHtml(`${escortStateText(w, e)} · ${t('unit.shipsShort', { n: e.ships })} · ${t('sheet.enduranceDays', { n: formatNumber(Math.max(0, e.endurance) / 86400, 1) })}`),
    bar: member ? '' : seaBar(app, e),
    tabs,
  };
}

// ---- formations ----

function formationStateText(app, f, leader) {
  const w = app.world;
  const r = f.rally;
  if (r && r.phase !== 'plan' && r.phase !== 'gone') return t(`rally.phase.${r.phase}`);
  if (f.kind === 'air') {
    let text = t(`states.squadron.${leader.state}`);
    if (leader.holdForWing) {
      const flying = membersOf(w, f).slice(1).filter((s) => s.follow === leader.id && (isFlying(s) || s.state === 'scrambling'));
      text += ` · ${t('unit.gathering', { n: flying.filter((s) => s.inFormation).length + 1, of: flying.length + 1 })}`;
    } else if (leader.intercept) {
      const c = w.contacts.get(leader.intercept.raidId);
      text += ` · ${t('sheet.guided', { raid: c ? c.label : '', p: Math.round(leader.intercept.p * 100) })}`;
    }
    return text;
  }
  let text = escortStateText(w, leader);
  const convoyId = leader.escorting || leader.joinTarget;
  const c = convoyId ? w.convoys.find((x) => x.id === convoyId) : null;
  if (c) text += ` · ${c.name}`;
  return text;
}

function memberRows(app, f) {
  const w = app.world;
  const members = membersOf(w, f);
  const leader = members[0];
  const rows = members.map((u, i) => {
    let state;
    let extra;
    if (f.kind === 'air') {
      state = t(`states.squadron.${u.state}`);
      if (i > 0 && u.follow === leader.id) state += ` · ${t(u.inFormation ? 'unit.inStation' : 'unit.joiningShort')}`;
      if (u.lateFor) state += ` · ${t('rally.late')}`;
      const fuel = w.settings.fuel === 'unlimited' ? '' : ` · ${t('sheet.minutes', { n: Math.max(0, Math.floor(u.fuel)) })}`;
      const level = fatigueOn(w) && u.state !== 'lost' ? fatigueLevel(w, u) : 'fresh';
      extra = `${t('unit.aircraftShort', { n: u.aircraft, total: u.aircraftStart })} · ${t('unit.ammoShort', { n: Math.round(u.ammo * 100) })}${fuel}${level !== 'fresh' ? ` · ${t(`sheet.fatigueLevels.${level}`)}` : ''}`;
    } else {
      state = escortStateText(w, u);
      extra = `${t('unit.shipsShort', { n: u.ships })} · ${t('sheet.enduranceDays', { n: formatNumber(Math.max(0, u.endurance) / 86400, 1) })}`;
    }
    const kind = f.kind === 'air' ? 'squadron' : 'escort';
    return `<li class="member${i === 0 ? ' leader' : ''}"><span class="member-name">${i === 0 ? '★ ' : ''}${escapeHtml(u.name)}</span>
      <span class="member-state">${escapeHtml(state)}</span><span class="member-extra">${escapeHtml(extra)}</span>
      <span class="member-buttons">${button('select', t('unit.see'), { id: u.id, kind })}${button('formation-remove', t('unit.remove'), { id: u.id, extra: ` data-formation="${escapeHtml(f.id)}"` })}</span></li>`;
  });
  const others = w.formations.filter((x) => x !== f && x.kind === f.kind);
  const merge = others.length ? `<div class="orders"><div class="sub">${escapeHtml(t('unit.mergeTitle'))}</div><div class="order-line">${others.map((x) =>
    button('formation-merge', t('unit.mergeWith', { name: x.name }), { id: f.id, extra: ` data-from="${escapeHtml(x.id)}"` })).join('')}</div>
    <p class="hint">${escapeHtml(t('unit.mergeHint'))}</p></div>` : '';
  return `<ol class="members">${rows.join('')}</ol>${merge}`;
}

/** Where a member starts from, for the departures table. */
function baseName(w, u) {
  if (u.kind === 'squadron') return isFlying(u) ? t('rally.inAir') : w.byId.airfield.get(u.airfield).name;
  if (u.state === 'inPort' || u.state === 'refit') return w.byId.port.get(u.portId).name;
  return t('formations.atSea');
}

/** The rendezvous tab of a formation: where, when, the departures, if someone is missing. */
function rallyTab(app, f) {
  const w = app.world;
  const r = f.rally;
  const air = f.kind === 'air';
  const aid = rallyAid(w);
  const members = membersOf(w, f);
  const id = f.id;
  const kind = 'formation';
  if (r && r.phase !== 'plan') {
    // The plan under way: where each member is.
    const p = rallyPoint(f);
    const rows = members.map((u) => {
      let status;
      if (u.schedule && u.schedule.rally) status = t('rally.status.planned', { time: clockText(w, u.schedule.at) });
      else if (u.lateFor) status = t('rally.status.late');
      else if (p && distance(u.x, u.y, p.x, p.y) <= (air ? 8 : 12) && (air ? isFlying(u) : u.state !== 'inPort')) status = t('rally.status.there');
      else if (u.state === 'scrambling') status = t('rally.status.takingOff');
      else if (air ? isFlying(u) : u.state === 'atSea') status = t('rally.status.onWay');
      else status = t(`states.${air ? 'squadron' : 'escort'}.${u.state}`);
      return `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(status)}</td></tr>`;
    });
    const when = r.at !== null ? clockText(w, r.at) : r.rvT ? t('rally.asapAround', { time: aid === 'none' ? '—' : clockText(w, r.rvT) }) : t('rally.asap');
    return `<div class="orders">${scheduleHint(app)}
      <p class="rally-status">${escapeHtml(t(`rally.phase.${r.phase}`))} · ${escapeHtml(p ? t('rally.atPoint', { time: when }) : t('rally.overLeader'))}</p>
      <table class="rally-table"><tbody>${rows.join('')}</tbody></table>
      <div class="order-line">${button('rally-cancel', t('rally.cancel'), { id, kind })}</div></div>`;
  }
  const where = r ? r.where : 'leader';
  const p = r && r.where === 'point' && r.x !== null ? r : null;
  const parts = [`<div class="orders">`, scheduleHint(app)];
  parts.push(`<div class="sub">${escapeHtml(t('rally.where'))}</div><div class="order-line">
    ${button('rally-where', t('rally.overLeaderBtn'), { id, kind, active: where === 'leader', extra: ' data-where="leader"' })}
    ${button('rally-where', t('rally.atPointBtn'), { id, kind, active: where === 'point', extra: ' data-where="point"' })}</div>`);
  if (where === 'point') {
    const [lon, lat] = p ? unproject(p.x, p.y) : [null, null];
    parts.push(`<div class="order-line"><span class="grow">${escapeHtml(p ? positionText(lat, lon) : t('rally.noPoint'))}</span>
      ${button('rally-place', app.tool === 'rally' && app.rallyFor === id ? t('rally.placing') : t('rally.place'), { id, kind, active: app.tool === 'rally' && app.rallyFor === id })}</div>`);
    if (air) {
      parts.push(`<div class="order-line"><span>${escapeHtml(t('orders.altitude'))}</span>${button('rally-alt-down', '−', { id, kind })}
        <b class="alt-value">${escapeHtml(ftText(feetOf(r.altM)))}</b>${button('rally-alt-up', '+', { id, kind })}</div>`);
    }
    parts.push(`<p class="hint">${escapeHtml(t('rally.routeHint', { n: r && r.route ? r.route.length : 0 }))}</p>`);
    if (r && r.route.length) parts.push(`<div class="order-line">${button('rally-route-clear', t('rally.routeClear'), { id, kind })}</div>`);
    // When: as early as possible, or at a time.
    parts.push(`<div class="sub">${escapeHtml(t('rally.when'))}</div><div class="order-line">
      ${button('rally-asap', t('rally.asap'), { id, kind, active: !r || r.at === null })}
      ${air ? '' : daySelect(w, `rally-day-${id}`)}${timeInput(`rally-time-${id}`, r && r.at !== null ? hhmm(w, r.at) : '')}
      ${button('rally-time', t('rally.setTime'), { id, kind, active: Boolean(r && r.at !== null) })}</div>`);
    if (r && r.at !== null) parts.push(`<p class="hint">${escapeHtml(t('rally.timeSet', { time: clockText(w, r.at) }))}</p>`);
    // Someone missing at the time: wait, slow down, go.
    const missing = r ? r.missing : 'wait';
    parts.push(`<div class="sub">${escapeHtml(t('rally.missingTitle'))}</div><div class="order-line">
      ${button('rally-missing', t('rally.missing.wait'), { id, kind, active: missing === 'wait', extra: ' data-missing="wait"' })}
      <label class="small">${escapeHtml(t('rally.upTo'))} <input type="number" min="1" max="${air ? 60 : 2880}" id="rally-wait-${escapeHtml(id)}" data-change="rally-wait" data-id="${escapeHtml(id)}" value="${r ? r.waitMin : air ? 10 : 360}"> ${escapeHtml(t('units.minShort'))}</label>
      ${button('rally-missing', t('rally.missing.slow'), { id, kind, active: missing === 'slow', extra: ' data-missing="slow"' })}
      ${button('rally-missing', t('rally.missing.go'), { id, kind, active: missing === 'go', extra: ' data-missing="go"' })}</div>
      <p class="hint">${escapeHtml(t(air ? 'rally.missingHintAir' : 'rally.missingHintSea'))}</p>`);
  } else {
    parts.push(`<p class="hint">${escapeHtml(t(air ? 'rally.leaderHint' : 'rally.leaderHintSea'))}</p>`);
  }
  // The departures: the time each member's order is given.
  const rows = members.map((u, i) => {
    const km = tripKm(w, f, u);
    const dep = r && r.departures[u.id] !== undefined ? hhmm(w, r.departures[u.id]) : '';
    const arrival = aid !== 'none' && r ? arrivalOf(w, f, u) : null;
    return `<tr><td>${i === 0 ? '★ ' : ''}${escapeHtml(u.name)}<br><small>${escapeHtml(baseName(w, u))}${km !== null && i + (where === 'point' ? 1 : 0) > 0 ? ` · ${escapeHtml(kmText(km))}` : ''}</small></td>
      <td>${aid === 'auto' ? escapeHtml(dep || '—') : `${air ? '' : daySelect(w, `rally-dep-day-${u.id}`)}<input type="text" inputmode="numeric" maxlength="5" placeholder="hh:mm" autocomplete="off" class="time-input" id="rally-dep-${escapeHtml(id)}-${escapeHtml(u.id)}" data-change="rally-dep" data-id="${escapeHtml(id)}" data-unit="${escapeHtml(u.id)}" value="${escapeHtml(dep)}">`}</td>
      <td>${arrival !== null ? escapeHtml(t('rally.arrival', { time: clockText(w, arrival) })) : ''}</td></tr>`;
  });
  parts.push(`<div class="sub">${escapeHtml(t(aid === 'auto' ? 'rally.departuresAuto' : 'rally.departures'))}</div>
    <table class="rally-table"><tbody>${rows.join('')}</tbody></table>
    <p class="hint">${escapeHtml(t(`rally.aid.${aid}`))}</p>
    <div class="order-line">${aid === 'auto' ? button('rally-compute', t('rally.compute'), { id, kind }) : ''}
    ${button('rally-arm', t('rally.arm'), { id, kind, disabled: where === 'point' && !p })}</div>`);
  parts.push(`</div>`);
  return parts.join('');
}

function formationPanel(app, f) {
  const w = app.world;
  const members = membersOf(w, f);
  const leader = members[0];
  if (!leader) return null;
  const air = f.kind === 'air';
  const total = members.reduce((n, u) => n + (air ? u.aircraft : u.ships), 0);
  const manage = `<div class="order-line">${button('formation-manage', t('unit.manage'), { id: f.id })}${button('formation-dissolve', t('unit.dissolve'), { id: f.id })}</div>`;
  const headings = app.settings.orders === 'headings';
  const planned = f.rally && f.rally.phase !== 'plan' && f.rally.phase !== 'gone';
  let cmd;
  if (air) {
    const waiting = members.slice(1).filter((s) => s.state === 'ready' && !s.schedule).length;
    const up = isFlying(leader) || leader.state === 'scrambling';
    const grounded = members.filter((s) => s.state === 'ready' || s.state === 'refuelling');
    const common = grounded.length && grounded.every((s) => s.alert === grounded[0].alert) ? grounded[0].alert : null;
    let takeoff = '';
    if (planned) takeoff = `<p class="hint">${escapeHtml(t('rally.underWay'))}</p>`;
    else if (!up) {
      if (f.schedule) {
        takeoff = `<div class="order-line scheduled"><span class="grow">${escapeHtml(t(f.schedule.daily ? 'orders.scheduledDaily' : 'orders.scheduled', { time: clockText(w, f.schedule.at) }))}${f.schedule.delayed ? ` · ${escapeHtml(t('orders.waiting'))}` : ''}</span>
          ${button('schedule-cancel', t('orders.cancel'), { id: f.id, kind: 'formation' })}</div>`;
      } else {
        takeoff = `${scheduleHint(app)}<div class="order-line"><span>${escapeHtml(t('orders.scheduleAt'))}</span>${timeInput(`sched-time-${f.id}`)}
          <label class="check"><input type="checkbox" id="sched-daily-${escapeHtml(f.id)}"> ${escapeHtml(t('orders.daily'))}</label>
          ${button('schedule-wing', t('orders.schedule'), { id: f.id, kind: 'formation' })}</div>`;
      }
    } else if (waiting) takeoff = button('formation-launch', t('unit.launchWaiting', { n: waiting }), { id: f.id });
    const alerts = fatigueOn(w) && grounded.length ? `${alertButtons(app, f, 'formation', common)}${confirmBox(app, 'formation', f.id, f.name)}
        <p class="hint">${escapeHtml(alertStatus(w, grounded.reduce((a, b) => (scrambleSeconds(w, b) > scrambleSeconds(w, a) ? b : a))))}</p>` : '';
    cmd = [
      takeoff || alerts ? section(app, 'ground', t('sec.ground'), ordersBox(takeoff, alerts)) : '',
      leader.state === 'lost' ? '' : routeSection(app, leader),
      section(app, 'mission', t('sec.mission'), ordersBox(up ? coverButtons(app, leader) : '', interceptBlock(app, leader), letGoLine(app, leader))),
      section(app, 'manage', t('sec.manage'), ordersBox(manage), false),
      `<p class="hint">${escapeHtml(t(up ? (headings ? 'unit.wingHintAirHeadings' : 'unit.wingHintAir') : (headings ? 'unit.wingHintGroundHeadings' : 'unit.wingHintGround')))}</p>`,
    ].join('');
  } else {
    const canMove = leader.state === 'inPort' || leader.state === 'atSea' || leader.state === 'waiting' || leader.state === 'hunting';
    const atSea = members.some((e) => ['atSea', 'waiting', 'escorting', 'hunting'].includes(e.state));
    cmd = [
      planned ? `<p class="hint">${escapeHtml(t('rally.underWay'))}</p>` : '',
      !planned && leader.state === 'inPort' ? section(app, 'port', t('sec.port'), ordersBox(exitLines(app, leader, { sail: false }), sailBlock(app, leader))) : '',
      section(app, 'convoys', t('sec.convoys'), ordersBox(joinLines(app, leader))),
      section(app, 'uboats', t('sec.uboats'), ordersBox(huntLines(app, leader, { behaviour: false }))),
      atSea ? section(app, 'home', t('sec.home'), ordersBox(homePortLine(app, leader))) : '',
      canMove ? routeSection(app, leader) : '',
      section(app, 'manage', t('sec.manage'), ordersBox(manage, `<p class="hint">${escapeHtml(t('unit.groupHint'))}</p>`), false),
    ].join('');
  }
  return {
    group: 'formation',
    title: `${escapeHtml(f.name)} <small>${escapeHtml(t(`unit.kind.${f.kind}`))}</small>`,
    summary: escapeHtml(t(air ? 'unit.wingSummary' : 'unit.groupSummary', { n: members.length, total, state: formationStateText(app, f, leader) })),
    bar: air ? airBar(app, leader, f) : seaBar(app, leader),
    tabs: [
      tab('cmd', { keyed: cmd, key: editingLegIndex(app, leader), profile: air }),
      tab('rally', { keyed: rallyTab(app, f), key: `${f.rally ? f.rally.where : 'leader'}:${f.rally ? f.rally.phase : 'plan'}` }),
      tab('members', { pre: memberRows(app, f) }),
    ].filter(Boolean),
    profileUnit: air ? leader : null,
  };
}

// ---- duty roster of an aerodrome ----

/**
 * Alert states of a squadron over the next `hours`, from its roster and the recall rule
 * (flights left aside): [{ from, to, state, recall }].
 */
function alertSegments(w, s, hours = 24) {
  const delay = (a) => w.rules.crews.alert[a || 'available'].scrambleS;
  const end = w.t + hours * 3600;
  let eff = effectiveAlert(w, s);
  let target = s.alert || 'available';
  let readyAt = s.alertAt !== null && s.alertAt !== undefined && s.alertAt > w.t ? s.alertAt : null;
  const changes = plannedChanges(w, s, end);
  const segs = [];
  let from = w.t;
  const push = (to) => {
    if (to > from) segs.push({ from, to, state: eff, recall: readyAt !== null });
    from = to;
  };
  let i = 0;
  while (from < end) {
    const next = changes[i] ? changes[i].at : Infinity;
    if (readyAt !== null && readyAt <= next && readyAt < end) {
      push(readyAt);
      eff = target;
      readyAt = null;
      continue;
    }
    if (next >= end) {
      push(end);
      break;
    }
    push(next);
    const c = changes[i++];
    const now = (readyAt !== null ? readyAt - c.at : 0) + delay(target);
    if (delay(c.alert) >= now) {
      eff = c.alert;
      target = c.alert;
      readyAt = null;
    } else {
      target = c.alert;
      readyAt = c.at + (now - delay(c.alert));
    }
  }
  return segs;
}

export function timelineHtml(w, s) {
  const segs = alertSegments(w, s);
  const total = 24 * 3600;
  const bars = segs.map((g) => `<span class="seg alert-${g.state}${g.recall ? ' recall' : ''}" style="width:${((g.to - g.from) / total * 100).toFixed(2)}%" title="${escapeHtml(`${hhmm(w, g.from)}-${hhmm(w, g.to)} · ${t(`orders.alertNames.${g.state}`)}${g.recall ? ` · ${t('orders.recalling')}` : ''}`)}"></span>`);
  const ticks = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24 * 100).toFixed(2)}%">${escapeHtml(hhmm(w, w.t + h * 3600))}</span>`);
  // Under the bar, how long the plan for the coming hours runs.
  const o = overrideOf(w, s);
  const span = o ? `<div class="timeline-override" style="width:${(Math.min(1, (o.until - w.t) / total) * 100).toFixed(2)}%" title="${escapeHtml(t('orders.rosterOverrideUntil', { start: hhmm(w, o.from), n: Math.round((o.until - o.from) / 3600), time: hhmm(w, o.until) }))}"></div>` : '';
  return `<div class="timeline">${bars.join('')}</div>${span}<div class="timeline-ticks">${ticks.join('')}</div>`;
}

/** The "Effectifs" tab of an aerodrome: its squadrons' readiness, now and over 24 hours. */
function rosterTab(app, site) {
  const w = app.world;
  const here = w.squadrons.filter((s) => s.role === 'fighter' && s.state !== 'lost' && (s.airfield === site.id || s.home === site.id));
  if (!here.length) return null;
  const blocks = here.map((s) => `<div class="roster-squadron">
    <div class="roster-head"><b>${escapeHtml(s.name)}</b> <span>${escapeHtml(t(`states.squadron.${s.state}`))} · ${escapeHtml(t(`orders.alertNames.${s.alert || 'available'}`))}${s.alertManual ? ` · ${escapeHtml(t('orders.manual'))}` : ''}</span></div>
    ${timelineHtml(w, s)}</div>`);
  const legend = ALERTS.map((a) => `<span class="legend"><span class="seg alert-${a}"></span>${escapeHtml(t(`orders.alertNames.${a}`))}</span>`).join('');
  return `<div class="orders roster-tab">${rosterLinks(app, null, site.id)}<div class="legend-line">${legend}</div>${blocks.join('')}</div>`;
}

// ---- contacts, plots, installations, trains ----

function raidSheet(app, raidId) {
  const w = app.world;
  const contact = w.contacts.get(raidId);
  const raid = w.raids.find((r) => r.id === raidId);
  if (!contact || !raid) return null;
  const est = contactEstimate(w, contact);
  const plots = visiblePlots(w, contact);
  const last = plots[plots.length - 1];
  const known = raid.intercepted || raid.engagedBy.size > 0 || w.settings.detection === 'exact' || Boolean(est && est.live);
  const composition = raid.phantom
    ? t('sheet.unknown')
    : known
      ? t('sheet.compositionText', { bombers: raid.bombers, bomberType: raid.bomberType, escort: raid.escort, escortType: raid.escortType })
      : t('sheet.unknown');
  const sigma = altitudeSigmaFt(w, est);
  const alt = est ? ftText(est.altFt) + (sigma ? ` ± ${formatNumber(Math.round(sigma / 500) * 500)}` : '') : '';
  const grid = est ? gridRef(w.grid, est.x, est.y) : null;
  const body = [
    est ? row(t('sheet.estimate'), escapeHtml(`${countText(est.count, est.approx)} · ${alt}`)) : '',
    est && est.heading !== null ? row(t('sheet.heading'), headingText(est.heading)) : '',
    grid ? row(t('sheet.grid'), escapeHtml(grid)) : '',
    est && est.live ? row(t('sheet.source'), escapeHtml(t('sheet.visualBy', { by: est.seen.by, time: formatTime(w.startMs + est.seen.since * 1000) })))
      : last ? row(t('sheet.source'), escapeHtml(t(`sheet.${last.source}`))) : '',
    last ? row(t('sheet.lastPlot'), escapeHtml(formatTime(w.startMs + last.t * 1000))) : '',
    row(t('sheet.composition'), escapeHtml(composition)),
    `<p class="hint">${escapeHtml(t('sheet.detectedAt', { time: formatTime(w.startMs + contact.firstSeen * 1000) }))}</p>`,
  ].join('');
  return {
    group: 'raid',
    title: escapeHtml(t('sheet.raidTitle', { label: contact.label })),
    summary: est ? escapeHtml(`${countText(est.count, est.approx)} · ${alt}${est.live ? ` · ${t('map.seenTag', { by: est.seen.by })}` : ''}`) : '',
    tabs: [tab('state', { pre: body })],
  };
}

function uboatPlotSheet(app, id) {
  const w = app.world;
  const p = w.uboatPlots.find((x) => x.id === id);
  if (!p) return null;
  const [lon, lat] = unproject(p.x, p.y);
  const reach = reachKm(w, w.t - p.t);
  const body = [
    row(t('sheet.source'), escapeHtml(`${t(`map.uSource.${p.source}`)} · ${p.by}`)),
    row(t('sheet.lastPlot'), escapeHtml(formatTime(w.startMs + p.t * 1000))),
    row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
    row(t('sheet.reachSurface'), escapeHtml(kmText(reach.surface))),
    row(t('sheet.reachSubmerged'), escapeHtml(kmText(reach.submerged))),
    `<p class="hint">${escapeHtml(t('sheet.uplotHint'))}</p>`,
  ].join('');
  return { group: 'uplot', title: escapeHtml(t('sheet.uplotTitle')), summary: escapeHtml(t(`map.uSource.${p.source}`)), tabs: [tab('state', { pre: body })] };
}

/** A U-boat in direct contact: what the player's unit sees of it. */
function uboatContactSheet(app, id) {
  const w = app.world;
  const u = w.uboats.find((x) => x.id === id);
  if (!u || !u.seen || u.state === 'sunk' || u.state === 'gone') return null;
  const [lon, lat] = unproject(u.x, u.y);
  const under = isSubmerged(w, u);
  const how = t('sheet.ucontactBy', { how: t(`map.uSource.${u.seen.how}`), by: u.seen.by });
  const body = [
    row(t('sheet.source'), escapeHtml(how)),
    row(t('sheet.ucontactSince'), escapeHtml(formatTime(w.startMs + u.seen.since * 1000))),
    row(t('sheet.depth'), escapeHtml(t(under ? 'sheet.submerged' : 'sheet.surfaced'))),
    row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
    `<p class="hint">${escapeHtml(t('sheet.ucontactHint'))}</p>`,
  ].join('');
  return { group: 'ucontact', title: escapeHtml(t('sheet.ucontactTitle')), summary: escapeHtml(how), tabs: [tab('state', { pre: body })] };
}

function attacksBlock(app, site) {
  const w = app.world;
  const lines = site.attacks.slice(-6).reverse().map((a) =>
    `<li>${escapeHtml(t('sheet.attackLine', { date: dateTimeText(w.startMs + a.t * 1000), raid: a.raid, n: a.damage }))}</li>`);
  return `<div class="sub">${escapeHtml(t('sheet.attacks'))}</div>${lines.length ? `<ul class="attacks">${lines.join('')}</ul>` : `<p class="hint">${escapeHtml(t('sheet.noAttack'))}</p>`}`;
}

function sitePanel(app, key) {
  const w = app.world;
  const site = w.sites.get(key);
  if (!site) return null;
  const status = siteStatus(w, site);
  const effect = siteEffectText(w, site);
  const repair = siteRepairText(w, site);
  const rows = [
    row(t('sheet.state'), `<span class="status-${status}">${escapeHtml(siteStatusText(w, site))}</span>`),
    effect ? row(t('sheet.effect'), escapeHtml(effect)) : '',
    repair ? row(t('sheet.repair'), escapeHtml(repair)) : '',
  ];
  let sub = t(`sites.kinds.${site.kind}`);
  let extra = '';
  let orders = '';
  if (site.kind === 'factory') sub = `${t('sheet.factoryType')} ${site.aircraftType}`;
  if (site.kind === 'depot') sub = t('sheet.depotType');
  if (site.kind === 'airfield') {
    sub = site.sector ? t('sheet.sector') : t('sheet.satellite');
    const here = w.squadrons.filter((s) => s.airfield === site.id && !isFlying(s) && s.state !== 'lost');
    extra = `<div class="sub">${escapeHtml(t('sheet.groundSquadrons'))}</div>${here.length
      ? here.map((s) => row(s.name, escapeHtml(t(`states.squadron.${s.state}`)))).join('')
      : `<p class="hint">${escapeHtml(t('sheet.noneHere'))}</p>`}`;
    orders = here.map((s) => `<div class="order-line"><span>${escapeHtml(s.name)}</span>${button('scramble', t('orders.scramble'), { id: s.id, disabled: s.state !== 'ready' })}${button('select', t('sheet.select'), { id: s.id, kind: 'squadron' })}</div>`).join('')
      + (here.length ? `<p class="hint">${escapeHtml(t('orders.scrambleHint'))}</p>` : '');
  } else {
    if (site.kind === 'radar') {
      rows.push(row(t('sheet.range'), escapeHtml(t('sheet.rangeNow', { n: Math.round(radarRangeFactor(w, site) * 100) }))));
      const half = w.rules.detection.radarHalfArcDeg;
      rows.push(row(t('sheet.arc'), escapeHtml(t('sheet.arcText', {
        from: String((site.azimuth - half + 360) % 360).padStart(3, '0'),
        to: String((site.azimuth + half) % 360).padStart(3, '0'),
      }))));
    }
    if (site.kind === 'port') sub = site.naval ? t('sheet.navalBase') : site.convoys ? t('sheet.convoyPort') : sub;
  }
  const logistics = stockOrders(app, site);
  const allOrders = (logistics || '') + orders;
  const state = [...rows, stockBlock(app, site), extra, attacksBlock(app, site)].join('');
  const roster = site.kind === 'airfield' && fatigueOn(w) ? rosterTab(app, site) : null;
  return {
    group: 'site',
    title: `${escapeHtml(siteTitle(site))} <small>${escapeHtml(sub)}</small>`,
    summary: escapeHtml(siteStatusText(w, site)),
    tabs: [
      tab('state', { pre: state }),
      allOrders ? tab('orders', { keyed: `<div class="orders">${allOrders}</div>` }) : null,
      roster ? tab('roster', { keyed: roster }) : null,
    ].filter(Boolean),
  };
}

function trainPanel(app, id) {
  const sheet = trainSheet(app, id);
  if (!sheet) return null;
  const { title, body } = splitTitle(sheet.info);
  return { group: 'train', title, summary: '', tabs: [tab('state', { pre: body })] };
}

/** The panel of what is selected, or null. */
function buildPanel(app, sel) {
  const w = app.world;
  switch (sel.kind) {
    case 'squadron': {
      const s = w.squadrons.find((x) => x.id === sel.id);
      return s ? squadronPanel(app, s) : null;
    }
    case 'convoy': {
      const c = w.convoys.find((x) => x.id === sel.id);
      return c ? convoyPanel(app, c) : null;
    }
    case 'escort': {
      const e = w.escorts.find((x) => x.id === sel.id);
      return e ? escortPanel(app, e) : null;
    }
    case 'formation': {
      const f = formationById(w, sel.id);
      return f ? formationPanel(app, f) : null;
    }
    case 'raid': return raidSheet(app, sel.id);
    case 'site': return sitePanel(app, sel.id);
    case 'train': return trainPanel(app, sel.id);
    case 'uplot': return uboatPlotSheet(app, sel.id);
    case 'ucontact': return uboatContactSheet(app, sel.id);
    default: return null;
  }
}

/**
 * Like setHtml, for the blocks with inputs: what the player has typed and where the cursor
 * is survive a rebuild (a button becoming available, a value changing). A new unit, tab or
 * leg being edited (`key`) starts from the values of the page.
 */
// The keyed part being pressed (mouse or finger down on one of its buttons): it is not
// redrawn until the press ends, or the click would land on a button that no longer exists.
let pressedKeyed = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    pressedKeyed = e.target && e.target.closest ? e.target.closest('[data-keyed]') : null;
  }, true);
  const release = () => setTimeout(() => {
    pressedKeyed = null;
  }, 0);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
}

/** Fields whose value cannot be kept across a redraw while they are being used. */
function busyField(x) {
  if (!x) return false;
  if (x.tagName === 'SELECT') return true; // its list would close and its choice be lost
  return x.tagName === 'INPUT' && ['time', 'date', 'number'].includes(x.type); // half-typed values read as empty
}

function setKeyed(el, html, key) {
  if (el.__html === html && el.__key === key) return;
  const sameKey = el.__key === key;
  el.dataset.keyed = '1';
  if (sameKey && (pressedKeyed === el || (busyField(document.activeElement) && el.contains(document.activeElement)))) {
    return; // redrawn on a later frame, once the player is done
  }
  const typed = new Map();
  let focus = null;
  if (sameKey) {
    for (const input of el.querySelectorAll('input[id]')) {
      if (input.type === 'checkbox' || input.type === 'radio') {
        if (input.checked !== input.defaultChecked) typed.set(input.id, input.checked);
      } else if (input.value !== input.defaultValue) typed.set(input.id, input.value);
    }
    for (const select of el.querySelectorAll('select[id]')) {
      const chosen = [...select.options].find((o) => o.defaultSelected) || select.options[0];
      if (chosen && select.value !== chosen.value) typed.set(select.id, select.value);
    }
    const active = document.activeElement;
    if (active && el.contains(active) && active.id) {
      let range = null;
      try {
        range = [active.selectionStart, active.selectionEnd];
      } catch {
        range = null;
      }
      focus = { id: active.id, range };
    }
  }
  el.innerHTML = html;
  el.__html = html;
  el.__key = key;
  for (const [id, value] of typed) {
    const field = el.querySelector(`#${CSS.escape(id)}`);
    if (!field) continue;
    if (typeof value === 'boolean') field.checked = value;
    else if (field.tagName !== 'SELECT' || [...field.options].some((o) => o.value === value)) field.value = value;
  }
  if (focus) {
    const again = el.querySelector(`#${CSS.escape(focus.id)}`);
    if (again) {
      again.focus();
      try {
        if (focus.range && focus.range[0] !== null) again.setSelectionRange(focus.range[0], focus.range[1]);
      } catch {
        // number inputs have no selection
      }
    }
  }
}

function renderUnitPanel(app) {
  const el = app.el;
  const sel = app.selection;
  const panel = sel ? buildPanel(app, sel) : null;
  if (!panel) {
    // Nothing selected, or what was selected is gone (a plot expired, a contact lost).
    if (sel) app.selection = null;
    el.unitPanel.hidden = true;
    el.table.classList.remove('with-unit');
    return;
  }
  el.unitPanel.hidden = false;
  el.table.classList.add('with-unit');
  setHtml(el.unitTitle, panel.title);
  setHtml(el.unitSummary, panel.summary);
  app.unitTabs = app.unitTabs || {};
  let active = app.unitTabs[panel.group] || panel.tabs[0].id;
  if (!panel.tabs.some((x) => x.id === active)) active = panel.tabs[0].id;
  setHtml(el.unitTabs, panel.tabs.length > 1 ? panel.tabs.map((x) =>
    `<button type="button" role="tab" data-unit-tab="${x.id}" data-group="${panel.group}" class="${x.id === active ? 'active' : ''}">${escapeHtml(t(`unit.tabs.${x.id}`))}</button>`).join('') : '');
  el.unitTabs.hidden = panel.tabs.length < 2;
  const current = panel.tabs.find((x) => x.id === active);
  setKeyed(el.unitBar, panel.bar || '', `${sel.kind}:${sel.id}:bar`);
  el.unitBar.hidden = !panel.bar;
  setHtml(el.unitMessage, messageBlock(app));
  setHtml(el.unitPre, current.pre);
  setKeyed(el.unitKeyed, current.keyed, `${sel.kind}:${sel.id}:${active}:${current.key ?? ''}`);
  setHtml(el.unitPost, current.post);
  // The climb profile goes into the route section when there is one, else under the tab's text.
  const profile = current.profile && panel.profileUnit;
  const slot = profile ? el.unitKeyed.querySelector('.profile-slot') : null;
  const home = slot || el.unitBody;
  if (el.unitProfile.parentNode !== home) {
    if (slot) slot.appendChild(el.unitProfile);
    else el.unitBody.insertBefore(el.unitProfile, el.unitKeyed);
  }
  el.unitProfile.hidden = !profile;
  if (profile) drawProfile(el.unitProfile, app, panel.profileUnit);
}

export function renderPanels(app) {
  renderObjectives(app);
  renderTote(app);
  renderUnitPanel(app);
  // With nothing selected, a word on how to open a sheet.
  const hint = app.el.panelHint;
  if (hint) {
    hint.hidden = Boolean(app.selection);
    const text = app.settings.orders === 'headings' ? t('panel.hintHeadings') : t('panel.hint');
    if (hint.textContent !== text) hint.textContent = text;
  }
}
