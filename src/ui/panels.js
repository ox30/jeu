// Side panel: objectives, tote board (units, installations), the sheet of the selected unit
// or installation with its orders and legs, and the operations journal. Panels are rebuilt
// a few times per second, only when their content changes, so that buttons and inputs stay
// usable.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatDate, formatTime } from '../core/time.js';
import { distance, unproject } from '../sim/geo.js';
import { gridRef } from '../sim/grid.js';
import { convoyRemainingKm, currentSpeed, orderedKnots } from '../sim/convoy.js';
import { reachKm } from '../sim/asw.js';
import { legTarget } from '../sim/navigation.js';
import { editableRoute, endChoices, planTrack } from '../sim/orders.js';
import { interceptChance } from '../sim/control.js';
import { nearestContact } from '../sim/query.js';
import { activePoint, editingLegIndex } from './actions.js';
import { altitudeSigmaFt, contactEstimate, visiblePlots } from '../sim/query.js';
import { aircraftSpec, feetOf, isFlying } from '../sim/squadron.js';
import { fatigueLevel, fatigueOn, pilotLossesOn, scrambleSeconds, strength } from '../sim/crews.js';
import { isDaylight } from '../sim/patrols.js';

const isDaylightSafe = (w) => isDaylight(w);
import { radarRangeFactor, siteStatus } from '../sim/sites.js';
import { drawProfile } from '../render/profile.js';
import { button, options, row, setHtml } from './html.js';
import {
  convoyCargoRows, coverButtons, escortSheet, renderLogistics, stockBlock, stockOrders, trainSheet,
} from './logisticsPanels.js';
import {
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
  if (w.escorts.length) {
    parts.push(`<div class="tote-group">${escapeHtml(t('tote.escorts'))}</div>`);
    for (const e of w.escorts) {
      const with_ = e.state === 'escorting' ? w.convoys.find((c) => c.id === e.escorting) : null;
      parts.push(`<div class="tote-row${isSel(app, 'escort', e.id) ? ' sel' : ''}" data-action="select" data-kind="escort" data-id="${escapeHtml(e.id)}">
        <span class="lamp escort-${e.state}"></span><span class="name">${escapeHtml(e.short)}</span>
        <span class="state">${escapeHtml(t(`states.escort.${e.state}`))}</span>
        <span class="extra">${escapeHtml(with_ ? t('tote.escortingShort', { convoy: with_.name }) : '')}</span></div>`);
    }
  }
  const fighters = w.squadrons.filter((s) => s.role === 'fighter');
  const patrols = w.squadrons.filter((s) => s.role !== 'fighter');
  const groups = [[t('tote.squadrons'), fighters]];
  if (patrols.length) groups.push([t('tote.patrols'), patrols]);
  for (const [title, list] of groups) {
  parts.push(`<div class="tote-group">${escapeHtml(title)}</div>`);
  for (const s of list) {
    const where = isFlying(s) ? altitudeText(s.alt) : w.byId.airfield.get(s.airfield).name;
    const level = fatigueOn(w) && s.state !== 'lost' ? fatigueLevel(w, s) : 'fresh';
    const tired = level !== 'fresh' ? ` <span class="fatigue-${level}" title="${escapeHtml(t('sheet.fatigue'))}">${escapeHtml(t(`sheet.fatigueLevels.${level}`))}</span>` : '';
    const stateText = s.state === 'ready' && fatigueOn(w) && s.alert !== 'available' ? t(`states.alert.${s.alert}`) : t(`states.squadron.${s.state}`);
    parts.push(`<div class="tote-row${isSel(app, 'squadron', s.id) ? ' sel' : ''}" data-action="select" data-kind="squadron" data-id="${escapeHtml(s.id)}">
      <span class="lamp sq-${s.state}${s.state === 'ready' ? ` alert-${s.alert}` : ''}"></span><span class="name">${escapeHtml(s.name)}</span>
      <span class="state">${escapeHtml(stateText)}</span>
      <span class="extra">${strength(w, s)}/${s.aircraftStart} · ${escapeHtml(where)}${tired}</span></div>`);
  }
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

function renderTote(app) {
  let tab = app.toteTab || 'units';
  if (tab === 'logistics' && !app.world.rail.enabled) tab = 'units';
  app.el.tabUnits.classList.toggle('active', tab === 'units');
  app.el.tabSites.classList.toggle('active', tab === 'sites');
  app.el.tabLogistics.classList.toggle('active', tab === 'logistics');
  app.el.tabLogistics.hidden = !app.world.rail.enabled;
  const damaged = [...app.world.sites.values()].filter((s) => s.damage >= 1 && !s.foreign).length;
  const label = damaged ? `${t('panel.sites')} (${damaged})` : t('panel.sites');
  if (app.el.tabSites.textContent !== label) app.el.tabSites.textContent = label;
  const html = tab === 'sites' ? renderSites(app) : tab === 'logistics' ? renderLogistics(app) : renderUnits(app);
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

function renderPlan(app, u) {
  const w = app.world;
  const moving = u.kind === 'squadron' ? isFlying(u) : u.state === 'atSea';
  const parts = [interceptBlock(app, u), pointBlock(app, u), `<div class="sub">${escapeHtml(t('orders.plan'))}</div>`];
  if (u.route && u.route.length && !u.plan.length) {
    parts.push(`<p class="hint">${escapeHtml(t('orders.followingRoute', { n: u.route.length }))}</p>`);
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
  if (app.sheetMessage && performance.now() < app.sheetMessage.until) {
    parts.push(`<p class="message ${app.sheetMessage.level}">${escapeHtml(app.sheetMessage.text)}</p>`);
  }
  return parts.join('');
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

// ---- sheets ------------------------------------------------------------------------

function climbArrow(s) {
  const target = s.targetAlt;
  if (Math.abs(target - s.alt) < 30) return '';
  return target > s.alt ? ` ↑ ${ftText(feetOf(target))}` : ` ↓ ${ftText(feetOf(target))}`;
}

/** Menu of what the squadron does at the end of its route or legs. */
function endActionLine(app, s) {
  if (s.state === 'lost' || !(s.route.length || s.plan.length)) return '';
  const w = app.world;
  const list = endChoices(w, s).map((a) => ({ value: a.id ? `${a.kind}:${a.id}` : a.kind, label: endActionText(w, a) }));
  const current = s.endAction.id ? `${s.endAction.kind}:${s.endAction.id}` : s.endAction.kind;
  return `<div class="order-line"><label class="grow">${escapeHtml(t('orders.endAction'))} <select id="end-action" data-change="end-action" data-id="${escapeHtml(s.id)}">${options(list, current)}</select></label></div>`;
}

function endKey(app, s) {
  if (!(s.route.length || s.plan.length)) return '';
  const choices = endChoices(app.world, s).map((a) => `${a.kind}${a.id || ''}`).join(',');
  return `${s.endAction.kind}${s.endAction.id || ''}|${choices}`;
}

/** Fighters that could lead a big wing for squadron `s`, nearest first. */
function wingLeaders(w, s) {
  return w.squadrons
    .filter((o) => o !== s && o.role === 'fighter' && !o.follow && (o.state === 'airborne' || o.state === 'scrambling'))
    .map((o) => ({ o, d: Math.hypot(o.x - s.x, o.y - s.y) }))
    .filter((x) => x.d < 80)
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((x) => x.o);
}

/** Big wing: join a leader in the air, or leave the formation. */
function formationBlock(app, s) {
  const w = app.world;
  if (s.role !== 'fighter' || !(s.state === 'airborne' || s.state === 'scrambling')) return '';
  if (s.follow) {
    return `<div class="order-line"><span>${escapeHtml(t('orders.formation'))}</span>${button('leave-formation', t('orders.leaveFormation'), { id: s.id })}</div>`;
  }
  const leaders = wingLeaders(w, s);
  if (!leaders.length) return '';
  const buttons = leaders.map((o) => button('follow', t('orders.followLeader', { name: o.name }), { id: s.id, extra: ` data-leader="${escapeHtml(o.id)}"` }));
  return `<div class="order-line"><span>${escapeHtml(t('orders.formation'))}</span>${buttons.join('')}</div><p class="hint">${escapeHtml(t('orders.formationHint'))}</p>`;
}

function squadronSheet(app, s) {
  const w = app.world;
  const type = aircraftSpec(w, s.type);
  const field = w.byId.airfield.get(s.airfield);
  const home = w.byId.airfield.get(s.home);
  let state = t(`states.squadron.${s.state}`);
  if (s.state === 'refuelling') state += ` · ${t('sheet.readyIn', { n: Math.ceil(s.timer / 60) })}`;
  if (s.state === 'scrambling') state += ` · ${t('sheet.takeoffIn', { n: Math.ceil(s.timer / 60) })}`;
  if (s.state === 'combat') {
    const raid = w.raids.find((r) => r.id === s.engagedRaid);
    if (raid) state += ` · ${t('sheet.inCombatWith', { raid: raid.label })}`;
  }
  if (s.state === 'airborne' && s.orbit) state += ` · ${t('sheet.orbiting')}`;
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
  const fuel = w.settings.fuel === 'unlimited' ? t('sheet.unlimited') : t('sheet.minutes', { n: Math.max(0, Math.floor(s.fuel)) });
  const flying = isFlying(s);
  const grid = flying ? gridRef(w.grid, s.x, s.y) : null;
  const info = [
    `<h3>${escapeHtml(s.name)} <small><button type="button" class="link" data-action="cards" data-type="${escapeHtml(s.type)}" title="${escapeHtml(t('cards.open'))}">${escapeHtml(s.typeName)} ⓘ</button></small></h3>`,
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
    row(t('sheet.speed'), escapeHtml(s.speedMode === 'max' ? t('sheet.speedMax', { n: type.maxKmh }) : t('sheet.speedCruise', { n: type.cruiseKmh }))),
    row(t('sheet.fuel'), escapeHtml(fuel)),
    s.role === 'fighter' ? row(t('sheet.ammo'), escapeHtml(t('sheet.percent', { n: Math.round(s.ammo * 100) }))) : row(t('sheet.sight'), escapeHtml(t('sheet.sightText', { n: Math.round(w.rules.patrols[s.type][isDaylightSafe(w) ? 'sightDayKm' : 'sightNightKm']) }))),
    s.lastReport ? `<p class="report-line">${escapeHtml(reportText(w, s.lastReport))}</p>` : '',
  ].join('');

  const airborneOrMoving = flying || s.state === 'scrambling';
  const headings = app.settings.orders === 'headings';
  const grounded = s.state === 'ready' || s.state === 'refuelling';
  const alertLine = fatigueOn(w) && grounded && s.role === 'fighter' ? [
    `<div class="order-line"><span>${escapeHtml(t('orders.alert'))}</span>`,
    ...['rest', 'available', 'cockpit'].map((a) => button('alert', t(`orders.alerts.${a}`), { id: s.id, kind: 'squadron', active: s.alert === a, extra: ` data-alert="${a}"` })),
    `</div><p class="hint">${escapeHtml(t('orders.alertHint', { n: scrambleSeconds(w, s) === null ? '—' : Math.round(scrambleSeconds(w, s) / 60) }))}</p>`,
  ].join('') : '';
  const orders = [
    `<div class="orders">`,
    button('scramble', t('orders.scramble'), { id: s.id, disabled: s.state !== 'ready' || scrambleSeconds(w, s) === null }),
    alertLine,
    `<div class="order-line"><span>${escapeHtml(t('orders.altitude'))}</span>`,
    button('alt-down', '−', { id: s.id }),
    `<b class="alt-value">${escapeHtml(ftText(feetOf(s.targetAlt)))}</b>`,
    button('alt-up', '+', { id: s.id }),
    `</div><div class="order-line">`,
    button('speed-cruise', t('orders.cruise'), { id: s.id, active: s.speedMode !== 'max' }),
    button('speed-max', t('orders.max'), { id: s.id, active: s.speedMode === 'max' }),
    `</div><div class="order-line"><label>${escapeHtml(t('orders.vector'))} <input type="number" min="0" max="359" step="1" id="vector-input" inputmode="numeric"></label>`,
    button('vector', t('orders.applyVector'), { id: s.id, disabled: !airborneOrMoving }),
    `</div><div class="order-line">`,
    button('orbit', t('orders.orbit'), { id: s.id, disabled: !(s.state === 'airborne' || s.state === 'combat' || s.state === 'returning') }),
    button('home', t('orders.home'), { id: s.id, disabled: !(s.state === 'airborne' || s.state === 'combat') }),
    `</div>`,
    coverButtons(app, s),
    formationBlock(app, s),
    endActionLine(app, s),
    s.state !== 'lost' ? legForm(app, s) : '',
    button('centre', t('orders.centre'), { id: s.id, kind: 'squadron' }),
    `<p class="hint">${escapeHtml(s.state === 'ready'
      ? (headings ? t('orders.scrambleHintHeadings') : t('orders.scrambleHint'))
      : (headings ? t('orders.headingsHint') : t('orders.drawHint')))}</p>`,
    `</div>`,
  ].join('');
  return {
    info,
    plan: s.state === 'lost' ? '' : renderPlan(app, s),
    orders,
    profile: s.state !== 'lost',
    key: `sq:${s.id}:${s.state}:${s.alert}:${s.speedMode}:${Math.round(feetOf(s.targetAlt))}:${app.settings.orders}:${s.cover}:${w.convoys.filter((c) => c.type === 'coastal' && c.state === 'atSea').length}:${endKey(app, s)}:${editingLegIndex(app, s)}:${s.follow}:${s.inFormation}:${s.role === 'fighter' ? wingLeaders(w, s).map((o) => o.id).join(',') : ''}`,
  };
}

function convoySheet(app, c) {
  const w = app.world;
  const dest = c.destination ? w.byId.port.get(c.destination).name : t('sheet.none');
  const [lon, lat] = unproject(c.x, c.y);
  const remaining = convoyRemainingKm(c);
  const speedKn = Math.round((currentSpeed(c) * 3600) / 1.852);
  const info = [
    `<h3>${escapeHtml(t('sheet.convoyTitle', { name: convoyLabel(c) }))}</h3>`,
    c.straggler ? `<p class="hint">${escapeHtml(t('sheet.stragglerHint'))}</p>` : '',
    row(t('sheet.state'), escapeHtml(t(`states.convoy.${c.state === 'arrived' && c.unloading ? 'unloading' : c.state}`))),
    c.tankers || c.freighters ? convoyCargoRows(app, c)
      : row(t('sheet.ships'), c.ships === c.shipsStart ? String(c.ships) : t('sheet.aircraftOf', { n: c.ships, total: c.shipsStart })),
    row(t('sheet.speed'), escapeHtml(speedKn < c.speedKn && c.state === 'atSea'
      ? t('sheet.speedKnLeg', { n: speedKn, max: c.speedKn })
      : t('sheet.speedKn', { n: c.speedKn }))),
    c.state === 'atSea' ? row(t('sheet.heading'), headingText(c.heading)) : '',
    row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
    row(t('sheet.destination'), escapeHtml(c.state === 'arrived' ? w.byId.port.get(c.portId).name : dest)),
    c.state === 'lost' ? '' : '',
    remaining !== null && c.state === 'atSea' ? row(t('sheet.remaining'), escapeHtml(kmText(remaining))) : '',
    remaining !== null && c.state === 'atSea' ? row(t('sheet.eta'), escapeHtml(dateTimeText(w.startMs + (w.t + remaining / currentSpeed(c)) * 1000))) : '',
  ].join('');
  const canOrder = c.state === 'inPort' || c.state === 'waiting' || c.state === 'atSea';
  const headings = app.settings.orders === 'headings';
  const speeds = [];
  for (let kn = c.speedKn; kn >= Math.max(4, c.speedKn - 4); kn--) speeds.push({ value: String(kn), label: kn === c.speedKn ? t('orders.speedBest', { n: kn }) : t('units.kn', { n: kn }) });
  const speedLine = canOrder && c.type !== 'coastal' && !c.straggler ? [
    `<div class="order-line"><label class="grow">${escapeHtml(t('orders.convoySpeed'))} <select id="convoy-speed" data-change="convoy-speed" data-id="${escapeHtml(c.id)}">${options(speeds, String(orderedKnots(c)))}</select></label>`,
    button('zigzag', c.zigzag ? t('orders.zigzagOn') : t('orders.zigzagOff'), { id: c.id, kind: 'convoy', active: c.zigzag }),
    `</div><p class="hint">${escapeHtml(t('orders.speedHint', { n: formatNumber(c.speedKn * w.rules.asw.stragglerFrom, 1) }))}</p>`,
  ].join('') : '';
  const orders = [
    `<div class="orders">`,
    c.state === 'inPort' ? button('sail', t('orders.sail'), { id: c.id, kind: 'convoy', disabled: !c.plan.length }) : '',
    speedLine,
    canOrder && c.admiraltyRoute.length && !c.route.length ? button('admiralty', t('orders.admiralty'), { id: c.id }) : '',
    canOrder ? legForm(app, c) : '',
    button('centre', t('orders.centre'), { id: c.id, kind: 'convoy' }),
    canOrder ? `<p class="hint">${escapeHtml(c.state === 'inPort' ? t('orders.sailHint') : headings ? t('orders.headingsHint') : t('orders.drawHint'))}</p>` : '',
    `</div>`,
  ].join('');
  return {
    info,
    plan: canOrder ? renderPlan(app, c) : '',
    orders,
    profile: false,
    key: `cv:${c.id}:${c.state}:${c.plan.length > 0}:${c.route.length > 0}:${app.settings.orders}:${app.world.rail.enabled}:${editingLegIndex(app, c)}:${c.orderedKn}:${c.zigzag}`,
  };
}

function raidSheet(app, raidId) {
  const w = app.world;
  const contact = w.contacts.get(raidId);
  const raid = w.raids.find((r) => r.id === raidId);
  if (!contact || !raid) return null;
  const est = contactEstimate(w, contact);
  const plots = visiblePlots(w, contact);
  const last = plots[plots.length - 1];
  const known = raid.intercepted || raid.engagedBy.size > 0 || w.settings.detection === 'exact';
  const composition = raid.phantom
    ? t('sheet.unknown')
    : known
      ? t('sheet.compositionText', { bombers: raid.bombers, bomberType: raid.bomberType, escort: raid.escort, escortType: raid.escortType })
      : t('sheet.unknown');
  const sigma = altitudeSigmaFt(w, est);
  const alt = est ? ftText(est.altFt) + (sigma ? ` ± ${formatNumber(Math.round(sigma / 500) * 500)}` : '') : '';
  const grid = est ? gridRef(w.grid, est.x, est.y) : null;
  const info = [
    `<h3>${escapeHtml(t('sheet.raidTitle', { label: contact.label }))}</h3>`,
    est ? row(t('sheet.estimate'), escapeHtml(`${countText(est.count, est.approx)} · ${alt}`)) : '',
    est && est.heading !== null ? row(t('sheet.heading'), headingText(est.heading)) : '',
    grid ? row(t('sheet.grid'), escapeHtml(grid)) : '',
    last ? row(t('sheet.source'), escapeHtml(t(`sheet.${last.source}`))) : '',
    last ? row(t('sheet.lastPlot'), escapeHtml(formatTime(w.startMs + last.t * 1000))) : '',
    row(t('sheet.composition'), escapeHtml(composition)),
    `<p class="hint">${escapeHtml(t('sheet.detectedAt', { time: formatTime(w.startMs + contact.firstSeen * 1000) }))}</p>`,
  ].join('');
  const orders = `<div class="orders">${button('centre', t('orders.centre'), { id: raidId, kind: 'raid' })}</div>`;
  return { info, plan: '', orders, profile: false, key: `rd:${raidId}` };
}

function uboatPlotSheet(app, id) {
  const w = app.world;
  const p = w.uboatPlots.find((x) => x.id === id);
  if (!p) return null;
  const [lon, lat] = unproject(p.x, p.y);
  const reach = reachKm(w, w.t - p.t);
  const info = [
    `<h3>${escapeHtml(t('sheet.uplotTitle'))}</h3>`,
    row(t('sheet.source'), escapeHtml(`${t(`map.uSource.${p.source}`)} · ${p.by}`)),
    row(t('sheet.lastPlot'), escapeHtml(formatTime(w.startMs + p.t * 1000))),
    row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
    row(t('sheet.reachSurface'), escapeHtml(kmText(reach.surface))),
    row(t('sheet.reachSubmerged'), escapeHtml(kmText(reach.submerged))),
    `<p class="hint">${escapeHtml(t('sheet.uplotHint'))}</p>`,
  ].join('');
  const orders = `<div class="orders">${button('centre', t('orders.centre'), { id, kind: 'uplot' })}</div>`;
  return { info, plan: '', orders, profile: false, key: `up:${id}` };
}

function attacksBlock(app, site) {
  const w = app.world;
  const lines = site.attacks.slice(-6).reverse().map((a) =>
    `<li>${escapeHtml(t('sheet.attackLine', { date: dateTimeText(w.startMs + a.t * 1000), raid: a.raid, n: a.damage }))}</li>`);
  return `<div class="sub">${escapeHtml(t('sheet.attacks'))}</div>${lines.length ? `<ul class="attacks">${lines.join('')}</ul>` : `<p class="hint">${escapeHtml(t('sheet.noAttack'))}</p>`}`;
}

function siteSheet(app, key) {
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
  if (site.kind === 'factory') sub = t('sheet.factoryType') + ' ' + site.aircraftType;
  if (site.kind === 'depot') sub = t('sheet.depotType');
  let keyExtra = '';
  if (site.kind === 'airfield') {
    sub = site.sector ? t('sheet.sector') : t('sheet.satellite');
    const here = w.squadrons.filter((s) => s.airfield === site.id && !isFlying(s) && s.state !== 'lost');
    extra = `<div class="sub">${escapeHtml(t('sheet.groundSquadrons'))}</div>${here.length
      ? here.map((s) => row(s.name, escapeHtml(t(`states.squadron.${s.state}`)))).join('')
      : `<p class="hint">${escapeHtml(t('sheet.noneHere'))}</p>`}`;
    orders = [
      `<div class="orders">`,
      ...here.map((s) => `<div class="order-line"><span>${escapeHtml(s.name)}</span>${button('scramble', t('orders.scramble'), { id: s.id, disabled: s.state !== 'ready' })}${button('select', t('sheet.select'), { id: s.id, kind: 'squadron' })}</div>`),
      button('centre', t('orders.centre'), { id: key, kind: 'site' }),
      here.length ? `<p class="hint">${escapeHtml(t('orders.scrambleHint'))}</p>` : '',
      `</div>`,
    ].join('');
    keyExtra = here.map((s) => s.state).join(',');
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
    orders = `<div class="orders">${button('centre', t('orders.centre'), { id: key, kind: 'site' })}</div>`;
  }
  const info = [
    `<h3>${escapeHtml(siteTitle(site))} <small>${escapeHtml(sub)}</small></h3>`,
    ...rows,
    stockBlock(app, site),
    extra,
    attacksBlock(app, site),
  ].join('');
  const logistics = stockOrders(app, site);
  if (logistics) orders = orders.replace('<div class="orders">', `<div class="orders">${logistics}`);
  return { info, plan: '', orders, profile: false, key: `st:${key}:${keyExtra}:${app.world.settings.logistics}` };
}

function renderSheet(app) {
  const sel = app.selection;
  const el = app.el;
  let sheet = null;
  let squadron = null;
  if (sel) {
    if (sel.kind === 'squadron') {
      squadron = app.world.squadrons.find((x) => x.id === sel.id);
      if (squadron) sheet = squadronSheet(app, squadron);
    } else if (sel.kind === 'convoy') {
      const c = app.world.convoys.find((x) => x.id === sel.id);
      if (c) sheet = convoySheet(app, c);
    } else if (sel.kind === 'raid') {
      sheet = raidSheet(app, sel.id);
    } else if (sel.kind === 'site') {
      sheet = siteSheet(app, sel.id);
    } else if (sel.kind === 'train') {
      sheet = trainSheet(app, sel.id);
    } else if (sel.kind === 'uplot') {
      sheet = uboatPlotSheet(app, sel.id);
    } else if (sel.kind === 'escort') {
      const e = app.world.escorts.find((x) => x.id === sel.id);
      if (e) {
        const es = escortSheet(app, e);
        sheet = {
          info: es.info,
          plan: es.planUnit ? renderPlan(app, es.planUnit) : '',
          orders: es.legForm ? es.orders.replace('<p class="hint">', `${legForm(app, e)}<p class="hint">`) : es.orders,
          profile: false,
          key: es.key,
        };
      }
    }
  }
  if (!sheet) {
    const hint = app.settings.orders === 'headings' ? t('panel.hintHeadings') : t('panel.hint');
    setHtml(el.sheetInfo, `<p class="hint">${escapeHtml(hint)}</p>`);
    setHtml(el.sheetPlan, '');
    setHtml(el.sheetOrders, '');
    el.sheetOrders.__key = '';
    el.sheetProfile.hidden = true;
    return;
  }
  setHtml(el.sheetInfo, sheet.info);
  setHtml(el.sheetPlan, sheet.plan);
  el.sheetProfile.hidden = !sheet.profile;
  if (sheet.profile && squadron) drawProfile(el.sheetProfile, app, squadron);
  // The orders block is rebuilt only when its buttons change, so that typing in its inputs
  // is not interrupted.
  if (el.sheetOrders.__key !== sheet.key) {
    setHtml(el.sheetOrders, sheet.orders);
    el.sheetOrders.__key = sheet.key;
  }
}

export function renderPanels(app) {
  renderObjectives(app);
  renderTote(app);
  renderSheet(app);
}

