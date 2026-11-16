// Side panel: objectives, tote board (units, installations), the sheet of the selected unit
// or installation with its orders and legs, and the operations journal. Panels are rebuilt
// a few times per second, only when their content changes, so that buttons and inputs stay
// usable.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatDate, formatTime } from '../core/time.js';
import { distance, unproject } from '../sim/geo.js';
import { gridRef } from '../sim/grid.js';
import { convoyRemainingKm, currentSpeed } from '../sim/convoy.js';
import { legTarget } from '../sim/navigation.js';
import { planTrack } from '../sim/orders.js';
import { altitudeSigmaFt, contactEstimate, visiblePlots } from '../sim/query.js';
import { feetOf, isFlying } from '../sim/squadron.js';
import { radarRangeFactor, siteStatus } from '../sim/sites.js';
import { drawProfile } from '../render/profile.js';
import { button, row, setHtml } from './html.js';
import {
  convoyCargoRows, coverButtons, escortSheet, renderLogistics, stockBlock, stockOrders, trainSheet,
} from './logisticsPanels.js';
import {
  altitudeText, countText, dateTimeText, durationText, ftText, headingText, kmText, legText, objectiveText,
  positionText, reportText, siteEffectText, siteRepairText, siteStatusText, siteTitle,
} from './format.js';

const MAX_LOG = 300;

function isSel(app, kind, id) {
  return app.selection && app.selection.kind === kind && app.selection.id === id;
}

export function addLogEntry(app, text, level = 'info', gameT = app.world.t) {
  const ms = app.world.startMs + gameT * 1000;
  const time = formatTime(ms);
  // Entries are grouped by day under a line with the date, kept above the newest entry.
  const day = Math.floor(ms / 86400000);
  if (app.logDay !== day || !app.logDaySep) {
    app.logDay = day;
    app.logDaySep = document.createElement('li');
    app.logDaySep.className = 'log-day';
    app.logDaySep.textContent = formatDate(ms, t('days'), t('months'));
  }
  const li = document.createElement('li');
  li.className = `log-${level}`;
  li.innerHTML = `<time>${time}</time> ${escapeHtml(text)}`;
  app.el.log.prepend(li);
  app.el.log.prepend(app.logDaySep);
  while (app.el.log.children.length > MAX_LOG) app.el.log.lastElementChild.remove();
}

function renderObjectives(app) {
  const items = app.world.objectives.map((o) =>
    `<li class="${o.done ? 'done' : ''}${o.failed ? ' failed' : ''}"><span class="tick">${o.done ? '✓' : o.failed ? '✗' : '○'}</span>${escapeHtml(objectiveText(app.world, o))}</li>`);
  setHtml(app.el.objectives, items.join(''));
}

// ---- tote board ------------------------------------------------------------------

function convoyExtra(app, c) {
  const w = app.world;
  if (c.state === 'atSea' && c.route.length) {
    return t('tote.eta', { date: dateTimeText(w.startMs + (w.t + convoyRemainingKm(c) / c.speed) * 1000) });
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
      <span class="lamp convoy-${c.state}"></span><span class="name">${escapeHtml(c.name)}</span>
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
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.squadrons'))}</div>`);
  for (const s of w.squadrons) {
    const where = isFlying(s) ? altitudeText(s.alt) : w.byId.airfield.get(s.airfield).name;
    parts.push(`<div class="tote-row${isSel(app, 'squadron', s.id) ? ' sel' : ''}" data-action="select" data-kind="squadron" data-id="${escapeHtml(s.id)}">
      <span class="lamp sq-${s.state}"></span><span class="name">${escapeHtml(s.name)}</span>
      <span class="state">${escapeHtml(t(`states.squadron.${s.state}`))}</span>
      <span class="extra">${s.aircraft}/${s.aircraftStart} · ${escapeHtml(where)}</span></div>`);
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
  const groups = [['airfield', w.airfields], ['radar', w.radars], ['port', w.ports.filter((p) => !p.foreign)], ['factory', w.factories]];
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

function renderPlan(app, u) {
  const w = app.world;
  const moving = u.kind === 'squadron' ? isFlying(u) : u.state === 'atSea';
  const parts = [`<div class="sub">${escapeHtml(t('orders.plan'))}</div>`];
  if (!u.plan.length) {
    parts.push(`<p class="hint">${escapeHtml(moving ? t('orders.noLeg') : t('orders.noLegReady'))}</p>`);
  } else {
    const track = planTrack(w, u);
    parts.push('<ol class="legs">');
    u.plan.forEach((leg, i) => {
      const end = track[i + 1];
      const when = end && !end.open ? t('legs.eta', { time: formatTime(w.startMs + end.t * 1000) }) : '';
      const status = i === 0 && moving ? legProgress(app, u, leg) : when;
      parts.push(`<li${i === 0 && moving ? ' class="current"' : ''}><span class="leg-text">${escapeHtml(legText(w, leg))}</span>
        <span class="leg-status">${escapeHtml(status)}</span>
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
  return [
    `<div class="leg-form"><div class="sub">${escapeHtml(t('orders.newLeg'))}</div>`,
    `<div class="order-line">`,
    `<label>${escapeHtml(t('orders.legHeading'))} <input type="number" min="0" max="360" step="1" id="leg-heading" inputmode="numeric"></label>`,
    `<label class="grow">${escapeHtml(t('orders.legEnd'))} <input type="text" id="leg-end" autocomplete="off" spellcheck="false" placeholder="${sea ? '30 · 14:20 · 56N 12O' : '6 · 14:20 · J5'}"></label>`,
    sea ? `<label>${escapeHtml(t('orders.legSpeed'))} <input type="number" min="1" max="${u.speedKn}" step="1" id="leg-speed" placeholder="${u.speedKn}"></label>` : '',
    button('add-leg', t('orders.addLeg'), { id: u.id, kind: u.kind }),
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

function squadronSheet(app, s) {
  const w = app.world;
  const type = w.rules.fighters[s.type];
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
  if (s.state === 'airborne' && s.cover) {
    const c = w.convoys.find((x) => x.id === s.cover);
    if (c) state += ` · ${t('sheet.covering', { convoy: c.name })}`;
  }
  if (s.state === 'returning') state += ` · ${t('sheet.returningTo', { name: field.name })}`;
  const fuel = w.settings.fuel === 'unlimited' ? t('sheet.unlimited') : t('sheet.minutes', { n: Math.max(0, Math.floor(s.fuel)) });
  const flying = isFlying(s);
  const grid = flying ? gridRef(w.grid, s.x, s.y) : null;
  const info = [
    `<h3>${escapeHtml(s.name)} <small>${escapeHtml(s.typeName)}</small></h3>`,
    row(t('sheet.state'), escapeHtml(state)),
    row(t('sheet.airfield'), escapeHtml(home.name + (field.id !== home.id ? ` → ${field.name}` : ''))),
    row(t('sheet.aircraft'), t('sheet.aircraftOf', { n: s.aircraft, total: s.aircraftStart })),
    flying ? row(t('sheet.altitude'), escapeHtml(altitudeText(s.alt) + climbArrow(s))) : '',
    row(t('sheet.targetAltitude'), escapeHtml(ftText(feetOf(s.targetAlt)))),
    flying ? row(t('sheet.heading'), headingText(s.heading)) : '',
    grid ? row(t('sheet.grid'), escapeHtml(grid)) : '',
    row(t('sheet.speed'), escapeHtml(s.speedMode === 'max' ? t('sheet.speedMax', { n: type.maxKmh }) : t('sheet.speedCruise', { n: type.cruiseKmh }))),
    row(t('sheet.fuel'), escapeHtml(fuel)),
    row(t('sheet.ammo'), escapeHtml(t('sheet.percent', { n: Math.round(s.ammo * 100) }))),
    s.lastReport ? `<p class="report-line">${escapeHtml(reportText(w, s.lastReport))}</p>` : '',
  ].join('');

  const airborneOrMoving = flying || s.state === 'scrambling';
  const headings = app.settings.orders === 'headings';
  const orders = [
    `<div class="orders">`,
    button('scramble', t('orders.scramble'), { id: s.id, disabled: s.state !== 'ready' }),
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
    key: `sq:${s.id}:${s.state}:${s.speedMode}:${Math.round(feetOf(s.targetAlt))}:${app.settings.orders}:${s.cover}:${w.convoys.filter((c) => c.type === 'coastal' && c.state === 'atSea').length}`,
  };
}

function convoySheet(app, c) {
  const w = app.world;
  const dest = c.destination ? w.byId.port.get(c.destination).name : t('sheet.none');
  const [lon, lat] = unproject(c.x, c.y);
  const remaining = convoyRemainingKm(c);
  const speedKn = Math.round((currentSpeed(c) * 3600) / 1.852);
  const info = [
    `<h3>${escapeHtml(t('sheet.convoyTitle', { name: c.name }))}</h3>`,
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
    remaining !== null && c.state === 'atSea' ? row(t('sheet.eta'), escapeHtml(dateTimeText(w.startMs + (w.t + remaining / c.speed) * 1000))) : '',
  ].join('');
  const canOrder = c.state === 'inPort' || c.state === 'waiting' || c.state === 'atSea';
  const headings = app.settings.orders === 'headings';
  const orders = [
    `<div class="orders">`,
    c.state === 'inPort' ? button('sail', t('orders.sail'), { id: c.id, kind: 'convoy', disabled: !c.plan.length }) : '',
    canOrder && c.admiraltyRoute.length && !c.route.length ? button('admiralty', t('orders.admiralty'), { id: c.id }) : '',
    canOrder ? legForm(app, c) : '',
    button('centre', t('orders.centre'), { id: c.id, kind: 'convoy' }),
    canOrder ? `<p class="hint">${escapeHtml(c.state === 'inPort' ? t('orders.sailHint') : headings ? t('orders.headingsHint') : t('orders.drawHint'))}</p>` : '',
    `</div>`,
  ].join('');
  return {
    info,
    plan: canOrder && !c.route.length ? renderPlan(app, c) : '',
    orders,
    profile: false,
    key: `cv:${c.id}:${c.state}:${c.plan.length > 0}:${c.route.length > 0}:${app.settings.orders}:${app.world.rail.enabled}`,
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

