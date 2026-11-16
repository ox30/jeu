// Panel parts for logistics and ships: the Logistics tab of the tote board, stocks and
// standing orders in the sheets of ports, aerodromes and factories, train orders, escort
// groups and trains.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatTime } from '../core/time.js';
import { unproject } from '../sim/geo.js';
import { cargoShare } from '../sim/convoy.js';
import { fuelDays, inbound, trainHours } from '../sim/logistics.js';
import { escortStrength } from '../sim/naval.js';
import { capacityFactor, isOperational } from '../sim/sites.js';
import { button, options, row } from './html.js';
import { dateTimeText, positionText, resourceName, tonnesText } from './format.js';

function isSel(app, kind, id) {
  return app.selection && app.selection.kind === kind && app.selection.id === id;
}

function homeFieldIds(world) {
  return [...new Set(world.squadrons.map((s) => s.home))];
}

function stockLamp(level) {
  return `<span class="lamp stock-${level}"></span>`;
}

function fuelLevel(days) {
  if (days === null) return 'none';
  if (days < 1) return 'low';
  if (days < 2.5) return 'mid';
  return 'ok';
}

export function renderLogistics(app) {
  const w = app.world;
  if (!w.rail.enabled) return `<div class="tote-empty">${escapeHtml(t('logistics.none'))}</div>`;
  const parts = [];
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.ports'))}</div>`);
  for (const p of w.ports) {
    if (!(p.convoys || p.coastal)) continue;
    parts.push(`<div class="tote-row stock${isSel(app, 'site', p.key) ? ' sel' : ''}" data-action="select" data-kind="site" data-id="${escapeHtml(p.key)}">
      ${stockLamp(isOperational(w, p) ? 'ok' : 'low')}<span class="name">${escapeHtml(p.label || p.name)}</span>
      <span class="state">${escapeHtml(t('resources.fuelShort'))} ${formatNumber(Math.round(p.stocks.fuel))} · ${escapeHtml(t('resources.materielShort'))} ${formatNumber(Math.round(p.stocks.materiel))}</span>
      <span class="extra"></span></div>`);
  }
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.bases'))}</div>`);
  for (const id of homeFieldIds(w)) {
    const f = w.byId.airfield.get(id);
    const days = fuelDays(w, f);
    const coming = inbound(w, f.key, 'fuel');
    parts.push(`<div class="tote-row stock${isSel(app, 'site', f.key) ? ' sel' : ''}" data-action="select" data-kind="site" data-id="${escapeHtml(f.key)}">
      ${stockLamp(fuelLevel(days))}<span class="name">${escapeHtml(f.name)}</span>
      <span class="state">${escapeHtml(t('resources.fuelShort'))} ${formatNumber(Math.round(f.stocks.fuel))} t${coming ? ` (+${formatNumber(Math.round(coming))})` : ''}</span>
      <span class="extra">${days === null ? '' : escapeHtml(t('tote.days', { n: formatNumber(days, 1) }))}</span></div>`);
  }
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.factories'))}</div>`);
  for (const f of w.factories) {
    const rate = f.starved ? 0 : f.perDay * capacityFactor(w, f);
    parts.push(`<div class="tote-row stock${isSel(app, 'site', f.key) ? ' sel' : ''}" data-action="select" data-kind="site" data-id="${escapeHtml(f.key)}">
      ${stockLamp(rate <= 0 ? 'low' : rate < f.perDay ? 'mid' : 'ok')}<span class="name">${escapeHtml(f.name)}</span>
      <span class="state">${escapeHtml(t('resources.materielShort'))} ${formatNumber(Math.round(f.stocks.materiel))} t · ${escapeHtml(t('tote.ready', { n: Math.floor(f.stocks.aircraft) }))}</span>
      <span class="extra">${escapeHtml(t('tote.perDay', { n: formatNumber(rate, 1) }))}</span></div>`);
  }
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.trains'))}</div>`);
  if (!w.trains.length) parts.push(`<div class="tote-empty">${escapeHtml(t('tote.noTrain'))}</div>`);
  for (const tr of w.trains) {
    const to = w.sites.get(tr.to);
    parts.push(`<div class="tote-row stock${isSel(app, 'train', tr.id) ? ' sel' : ''}" data-action="select" data-kind="train" data-id="${escapeHtml(tr.id)}">
      <span class="lamp train-${tr.resource}"></span><span class="name">${escapeHtml(tr.id)}</span>
      <span class="state">${formatNumber(Math.round(tr.amount))} t ${escapeHtml(resourceName(tr.resource))} → ${escapeHtml(to.name)}</span>
      <span class="extra">${escapeHtml(t(`logistics.trainState.${tr.state}`))}</span></div>`);
  }
  return parts.join('');
}

// ---- sheets of installations --------------------------------------------------------

function inboundBlock(app, site) {
  const w = app.world;
  const trains = w.trains.filter((tr) => tr.to === site.key);
  if (!trains.length) return '';
  const R = w.rules.logistics;
  const lines = trains.map((tr) => {
    const leftKm = tr.links.slice(tr.seg).reduce((n, l) => n + l.km, 0) - (tr.state === 'moving' ? tr.km : 0);
    const etaS = w.t + (tr.state === 'loading' ? tr.timer : 0) + (leftKm / R.trainKmh + (tr.state === 'unloading' ? 0 : R.unloadHours)) * 3600
      + (tr.state === 'unloading' ? tr.timer : 0);
    return `<li>${escapeHtml(t('logistics.inboundLine', {
      amount: formatNumber(Math.round(tr.amount)),
      resource: resourceName(tr.resource),
      when: t('logistics.eta', { time: dateTimeText(w.startMs + etaS * 1000) }),
    }))}</li>`;
  });
  return `<div class="sub">${escapeHtml(t('logistics.inbound'))}</div><ul class="attacks">${lines.join('')}</ul>`;
}

/** Stock rows and expected trains for a port, an aerodrome or a factory. */
export function stockBlock(app, site) {
  const w = app.world;
  if (!w.rail.enabled) return '';
  const rows = [`<div class="sub">${escapeHtml(t('logistics.stocks'))}</div>`];
  if (site.kind === 'airfield') {
    const days = fuelDays(w, site);
    rows.push(row(t('logistics.fuel'), escapeHtml(days === null
      ? tonnesText(site.stocks.fuel)
      : t('logistics.fuelDays', { t: formatNumber(Math.round(site.stocks.fuel)), d: formatNumber(days, 1) }))));
  } else if (site.kind === 'port') {
    rows.push(row(t('logistics.fuel'), escapeHtml(tonnesText(site.stocks.fuel))));
    rows.push(row(t('logistics.materiel'), escapeHtml(tonnesText(site.stocks.materiel))));
    for (const c of w.convoys) {
      if (c.state === 'arrived' && c.unloading && c.portId === site.id) {
        rows.push(`<p class="hint">${escapeHtml(t('logistics.unloading', { convoy: c.name, n: formatNumber(Math.round(c.cargo.fuel + c.cargo.materiel)) }))}</p>`);
      }
    }
  } else if (site.kind === 'factory') {
    rows.push(row(t('logistics.materiel'), escapeHtml(tonnesText(site.stocks.materiel))));
    rows.push(row(t('logistics.aircraft'), String(Math.floor(site.stocks.aircraft))));
    const rate = site.perDay * capacityFactor(w, site);
    rows.push(row(t('logistics.production'), escapeHtml(site.starved || rate <= 0
      ? t('logistics.productionStopped')
      : t('logistics.productionRate', { n: formatNumber(rate, 1), type: site.aircraftType }))));
    rows.push(`<p class="hint">${escapeHtml(t('logistics.perAircraft', { n: site.materielPerAircraft }))}</p>`);
  }
  rows.push(inboundBlock(app, site));
  return rows.join('');
}

function trainForm(app, site) {
  const w = app.world;
  const R = w.rules.logistics;
  const targets = [];
  for (const id of homeFieldIds(w)) {
    const f = w.byId.airfield.get(id);
    targets.push({ value: f.key, label: `${f.name} (${t('sites.kinds.airfield').toLowerCase()})` });
  }
  for (const f of w.factories) targets.push({ value: f.key, label: `${f.name} (${t('sites.kinds.factory').toLowerCase()})` });
  for (const p of w.ports) if ((p.convoys || p.coastal) && p.key !== site.key) targets.push({ value: p.key, label: `${p.label || p.name} (${t('sites.kinds.port').toLowerCase()})` });
  const resources = [{ value: 'fuel', label: resourceName('fuel') }, { value: 'materiel', label: resourceName('materiel') }];
  return [
    `<div class="leg-form"><div class="sub">${escapeHtml(t('logistics.sendTrain'))}</div>`,
    `<div class="order-line"><label>${escapeHtml(t('logistics.resource'))} <select id="train-resource">${options(resources, app.lastTrainResource || 'fuel')}</select></label></div>`,
    `<div class="order-line"><label class="grow">${escapeHtml(t('logistics.to'))} <select id="train-to">${options(targets, app.lastTrainTo || null)}</select></label>`,
    button('send-train', t('logistics.send'), { id: site.key, kind: 'site' }),
    `</div>`,
    `<p class="hint">${escapeHtml(t('logistics.trainHint', { fuel: R.trainTonnes.fuel, materiel: R.trainTonnes.materiel }))}</p>`,
    `</div>`,
  ].join('');
}

function minStockForm(app, site, resource) {
  const w = app.world;
  const auto = w.settings.logistics === 'auto';
  const value = site.minStock[resource];
  return [
    `<div class="leg-form"><div class="sub">${escapeHtml(t('logistics.minStock'))} (${escapeHtml(resourceName(resource))})</div>`,
    `<div class="order-line"><label>${escapeHtml(t('logistics.minStock'))} <input type="number" min="0" step="10" id="min-stock" value="${value === null ? '' : value}" placeholder="${auto ? w.rules.logistics.autoMinimum[site.kind] : '—'}"> t</label>`,
    button('set-min', t('logistics.apply'), { id: site.key, kind: 'site', extra: ` data-resource="${resource}"` }),
    `</div>`,
    `<p class="hint">${escapeHtml(t('logistics.minHint'))}${auto ? ` ${escapeHtml(t('logistics.minAuto', { n: w.rules.logistics.autoMinimum[site.kind] }))}` : ''}</p>`,
    `</div>`,
  ].join('');
}

/** Orders block of an installation's sheet (logistics part). */
export function stockOrders(app, site) {
  const w = app.world;
  if (!w.rail.enabled) return '';
  if (site.kind === 'port' && (site.convoys || site.coastal)) return trainForm(app, site);
  if (site.kind === 'airfield' && homeFieldIds(w).includes(site.id)) return minStockForm(app, site, 'fuel');
  if (site.kind === 'factory') return minStockForm(app, site, 'materiel');
  return '';
}

// ---- convoys, escort groups, trains -------------------------------------------------

export function convoyCargoRows(app, c) {
  const w = app.world;
  const rows = [];
  if (c.tankers || c.freighters) {
    rows.push(row(t('sheet.ships'), escapeHtml(c.ships === c.shipsStart
      ? t('sheet.shipsText', { n: c.ships, tankers: c.tankers, freighters: c.freighters })
      : t('sheet.shipsLeft', { n: c.ships, total: c.shipsStart, tankers: c.tankers, freighters: c.freighters }))));
    rows.push(row(t('sheet.cargo'), escapeHtml(t('sheet.cargoText', {
      fuel: formatNumber(Math.round(c.cargo.fuel)),
      materiel: formatNumber(Math.round(c.cargo.materiel)),
    }))));
    rows.push(row(t('sheet.cargoAfloat'), escapeHtml(`${Math.round(cargoShare(c) * 100)} %`)));
  }
  if (w.escorts.length && c.type !== 'coastal') {
    const groups = w.escorts.filter((e) => e.state === 'escorting' && e.escorting === c.id);
    rows.push(row(t('sheet.escort'), escapeHtml(groups.length
      ? groups.map((e) => t('sheet.escortText', { name: e.short, n: e.ships })).join(', ')
      : t('sheet.escortNone'))));
  }
  return rows.join('');
}

export function escortSheet(app, e) {
  const w = app.world;
  const [lon, lat] = unproject(e.x, e.y);
  let state = t(`states.escort.${e.state}`);
  if (e.state === 'escorting') {
    const c = w.convoys.find((x) => x.id === e.escorting);
    if (c) state += ` · ${c.name}`;
  }
  if (e.state === 'atSea' && e.joinTarget) {
    const c = w.convoys.find((x) => x.id === e.joinTarget);
    if (c) state += ` · ${t('sheet.joining', { convoy: c.name })}`;
  }
  if (e.state === 'refit') state += ` · ${t('sheet.readyIn', { n: Math.ceil(e.timer / 60) })}`;
  const info = [
    `<h3>${escapeHtml(e.name)} <small>${escapeHtml(e.short)}</small></h3>`,
    row(t('sheet.state'), escapeHtml(state)),
    row(t('sheet.composition2'), escapeHtml(e.composition)),
    row(t('sheet.speed'), escapeHtml(t('sheet.speedKn', { n: e.speedKn }))),
    row(t('sheet.endurance'), escapeHtml(t('sheet.enduranceDays', { n: formatNumber(Math.max(0, e.endurance) / 86400, 1) }))),
    e.state === 'inPort' || e.state === 'refit'
      ? row(t('sheet.airfield'), escapeHtml(w.byId.port.get(e.portId).name))
      : row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
  ].join('');
  const canMove = e.state === 'inPort' || e.state === 'atSea' || e.state === 'waiting';
  const aid = w.settings.interceptAid !== 'none';
  const joinable = w.convoys.filter((c) => c.state === 'atSea' && c.type !== 'coastal');
  const orders = [
    `<div class="orders">`,
    e.state === 'inPort' ? button('sail', t('orders.escortSail'), { id: e.id, kind: 'escort', disabled: !e.plan.length && !e.route.length }) : '',
    aid && canMove ? `<div class="order-line">${joinable.map((c) => button('join', t('orders.join', { convoy: c.name }), { id: e.id, kind: 'escort', extra: ` data-convoy="${escapeHtml(c.id)}"` })).join('')}</div>` : '',
    e.state === 'escorting' ? button('leave', t('orders.leave'), { id: e.id, kind: 'escort' }) : '',
    e.state === 'atSea' || e.state === 'escorting' || e.state === 'waiting' ? button('escort-home', t('orders.homePort'), { id: e.id, kind: 'escort' }) : '',
    `<p class="hint">${escapeHtml(t('orders.joinHint'))}</p>`,
    `</div>`,
  ].join('');
  return {
    info,
    planUnit: canMove && !e.route.length ? e : null,
    orders,
    legForm: canMove,
    key: `eg:${e.id}:${e.state}:${e.plan.length > 0}:${e.route.length > 0}:${joinable.map((c) => c.id).join(',')}:${app.settings.orders}:${aid}`,
  };
}

export function trainSheet(app, id) {
  const w = app.world;
  const tr = w.trains.find((x) => x.id === id);
  if (!tr) return null;
  const from = w.sites.get(tr.from);
  const to = w.sites.get(tr.to);
  const R = w.rules.logistics;
  const leftKm = tr.links.slice(tr.seg).reduce((n, l) => n + l.km, 0) - (tr.state === 'moving' ? tr.km : 0);
  const etaS = w.t + (tr.state === 'loading' || tr.state === 'unloading' ? tr.timer : 0) + (leftKm / R.trainKmh + (tr.state === 'unloading' ? 0 : R.unloadHours)) * 3600;
  const info = [
    `<h3>${escapeHtml(t('logistics.trainTitle', { id: tr.id }))}</h3>`,
    `<p>${escapeHtml(t('logistics.trainLine', { amount: formatNumber(Math.round(tr.amount)), resource: resourceName(tr.resource), from: from.name, to: to.name }))}</p>`,
    row(t('sheet.state'), escapeHtml(t(`logistics.trainState.${tr.state}`))),
    row(t('sheet.eta'), escapeHtml(dateTimeText(w.startMs + etaS * 1000))),
  ].join('');
  return { info, plan: '', orders: '', profile: false, key: `tr:${id}` };
}

/** "Cover the convoy" buttons for a squadron, for coastal convoys at sea. */
export function coverButtons(app, s) {
  const w = app.world;
  if (!(s.state === 'airborne' || s.state === 'combat' || s.state === 'returning')) return '';
  const list = w.convoys.filter((c) => c.type === 'coastal' && c.state === 'atSea');
  if (!list.length) return '';
  return `<div class="order-line">${list.map((c) => button('cover', t('orders.cover', { convoy: c.name }), { id: s.id, kind: 'squadron', active: s.cover === c.id, extra: ` data-convoy="${escapeHtml(c.id)}"` })).join('')}</div><p class="hint">${escapeHtml(t('orders.coverHint'))}</p>`;
}

export function trainEtaText(app, fromKey, toKey) {
  const w = app.world;
  const h = trainHours(w, fromKey, toKey);
  if (h === null) return null;
  return t('logistics.eta', { time: formatTime(w.startMs + (w.t + h * 3600) * 1000) });
}

export { escortStrength };
