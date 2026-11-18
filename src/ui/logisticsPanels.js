// Panel parts for logistics and ships: the Logistics tab of the tote board, stocks and
// standing orders in the sheets of ports, aerodromes and factories, train orders, escort
// groups and trains.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatTime } from '../core/time.js';
import { distance, unproject } from '../sim/geo.js';
import { cargoShare } from '../sim/convoy.js';
import { RESOURCES, fuelDays, fullTrain, inbound, trainHours } from '../sim/logistics.js';
import { escortStrength, portChoices } from '../sim/naval.js';
import { canHunt } from '../sim/asw.js';
import { capacityFactor, isOperational } from '../sim/sites.js';
import { lineCost, offerArrival, offerCost, offerInCargo, offers, tonnageForecast } from '../sim/shipping.js';
import { button, options, row } from './html.js';
import { cargoText, dateTimeText, escortStateText, positionText, resourceName, shortDateText, tonnesText } from './format.js';

function isSel(app, kind, id) {
  return app.selection && app.selection.kind === kind && app.selection.id === id;
}

function homeFieldIds(world) {
  return [...new Set(world.squadrons.map((s) => s.home))];
}

/** "C 50 · M 60" */
function cargoShort(cargo) {
  return Object.entries(cargo).map(([res, n]) => `${t(`resources.${res}Short`)} ${formatNumber(Math.round(n))}`).join(' · ') + ' t';
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

/** One line of the tonnage forecast: "Carburant : 1 200 t déchargées + 640 t en mer + 4 100 t achetables = 5 940 t (objectif 6 800 t)". */
function forecastLine(label, f) {
  const n = (v) => formatNumber(Math.round(v));
  return `<li class="${f.total + 0.5 < f.target ? 'short' : 'ok'}"><b>${escapeHtml(label)}</b> ${escapeHtml(t('offers.forecastLine', {
    unloaded: n(f.unloaded), atSea: n(f.atSea), buyable: n(f.buyable), total: n(f.total), target: n(f.target),
  }))}</li>`;
}

/**
 * Atlantic 1941: the dollar reserve, what it still buys against the objective, the next
 * sailings, and the aircraft to order with what each costs in cargo.
 */
function currencyBlock(app) {
  const w = app.world;
  const cur = w.currency;
  if (!cur) return '';
  const lend = Boolean(w.flags.lendLease);
  const n = (v) => formatNumber(Math.round(v));
  const parts = [`<div class="tote-group">${escapeHtml(t('offers.title'))}</div><div class="currency">`];
  parts.push(`<p>${escapeHtml(t('offers.stock', { n: n(cur.stock), m: formatNumber(cur.start) }))}</p>`);
  parts.push(`<p class="hint">${escapeHtml(t(lend ? 'offers.lendLease' : 'offers.intro'))}</p>`);
  if (!lend) parts.push(`<p class="hint warn">${escapeHtml(t('offers.congress'))}</p>`);
  const forecast = tonnageForecast(w);
  parts.push(`<div class="sub">${escapeHtml(t('offers.forecast'))}</div><ul class="forecast">
    ${forecastLine(t('offers.fuel'), forecast.fuel)}${forecastLine(t('offers.materiel'), forecast.materiel)}</ul>
    <p class="hint">${escapeHtml(t(lend ? 'offers.forecastHintLend' : 'offers.forecastHint'))}</p>`);
  const next = w.shipping.lines
    .filter((l) => l.sent < l.count)
    .map((l) => ({ name: `${l.prefix} ${l.firstNumber + l.sent}`, at: l.nextS, cost: lend ? 0 : Math.min(lineCost(w, l), cur.stock), full: lineCost(w, l) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, 3);
  if (next.length) {
    parts.push(`<div class="sub">${escapeHtml(t('offers.next'))}</div><ul class="next-sailings">`);
    for (const x of next) {
      const key = lend ? 'offers.nextLineFree' : x.cost + 0.5 < x.full ? 'offers.nextLineShort' : 'offers.nextLine';
      parts.push(`<li>${escapeHtml(t(key, { convoy: x.name, date: dateTimeText(w.startMs + x.at * 1000), cost: n(x.cost), share: Math.round((x.full > 0 ? x.cost / x.full : 0) * 100) }))}</li>`);
    }
    parts.push('</ul>');
  }
  parts.push(`<div class="sub">${escapeHtml(t('offers.aircraft'))}</div>`);
  for (const o of offers(w)) {
    const bought = cur.bought.includes(o.id);
    const c = offerCost(w, o);
    const cargo = offerInCargo(w, o);
    const price = lend ? t('offers.priceFree') : t('offers.price', { cost: formatNumber(c), fuel: n(cargo.fuel), materiel: n(cargo.materiel) });
    const delivery = bought ? t('offers.ordered') : t('offers.delivery', { days: o.days, date: shortDateText(w.startMs + offerArrival(w, o) * 1000) });
    parts.push(`<div class="order-line offer"><span class="grow"><b>${escapeHtml(t(`offers.${o.id}`))}</b><br><small>${escapeHtml(price)}<br>${escapeHtml(delivery)}</small></span>
      ${button('offer', bought ? t('offers.bought') : lend ? t('offers.buyFree') : t('offers.buy', { cost: formatNumber(c) }), { disabled: bought || cur.stock < c, extra: ` data-offer="${escapeHtml(o.id)}"` })}</div>`);
  }
  parts.push('</div>');
  return parts.join('');
}

export function renderLogistics(app) {
  const w = app.world;
  if (!w.rail.enabled) return `<div class="tote-empty">${escapeHtml(t('logistics.none'))}</div>`;
  const parts = [currencyBlock(app)];
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
      <span class="state">${escapeHtml(t('resources.fuelShort'))} ${formatNumber(Math.round(f.stocks.fuel))} t${coming ? ` (+${formatNumber(Math.round(coming))})` : ''}${w.depots.length ? ` · ${escapeHtml(t('resources.ammoShort'))} ${formatNumber(Math.round(f.stocks.ammo))}` : ''}</span>
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
  if (w.depots.length) {
    parts.push(`<div class="tote-group">${escapeHtml(t('tote.depots'))}</div>`);
    for (const d of w.depots) {
      parts.push(`<div class="tote-row stock${isSel(app, 'site', d.key) ? ' sel' : ''}" data-action="select" data-kind="site" data-id="${escapeHtml(d.key)}">
        ${stockLamp(isOperational(w, d) ? 'ok' : 'low')}<span class="name">${escapeHtml(d.name)}</span>
        <span class="state">${escapeHtml(t('resources.ammoShort'))} ${formatNumber(Math.round(d.stocks.ammo))} t</span>
        <span class="extra">${escapeHtml(t('tote.perDay', { n: formatNumber(d.perDay * capacityFactor(w, d), 1) }))}</span></div>`);
    }
  }
  parts.push(`<div class="tote-group">${escapeHtml(t('tote.trains'))}</div>`);
  if (!w.trains.length) parts.push(`<div class="tote-empty">${escapeHtml(t('tote.noTrain'))}</div>`);
  for (const tr of w.trains) {
    const to = w.sites.get(tr.to);
    parts.push(`<div class="tote-row stock${isSel(app, 'train', tr.id) ? ' sel' : ''}" data-action="select" data-kind="train" data-id="${escapeHtml(tr.id)}">
      <span class="lamp train-${tr.resource}"></span><span class="name">${escapeHtml(tr.id)}</span>
      <span class="state">${escapeHtml(cargoShort(tr.cargo))} → ${escapeHtml(to.name)}</span>
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
      what: cargoText(tr.cargo),
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
    if (w.depots.length) rows.push(row(t('logistics.ammo'), escapeHtml(tonnesText(site.stocks.ammo))));
  } else if (site.kind === 'depot') {
    rows.push(row(t('logistics.ammo'), escapeHtml(tonnesText(site.stocks.ammo))));
    rows.push(row(t('logistics.production'), escapeHtml(t('logistics.ammoRate', { n: formatNumber(site.perDay * capacityFactor(w, site), 1) }))));
  } else if (site.kind === 'port') {
    rows.push(row(t('logistics.fuel'), escapeHtml(tonnesText(site.stocks.fuel))));
    rows.push(row(t('logistics.materiel'), escapeHtml(tonnesText(site.stocks.materiel))));
    if (site.stocks.ammo >= 1) rows.push(row(t('logistics.ammo'), escapeHtml(tonnesText(site.stocks.ammo))));
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
    if (f.key !== site.key) targets.push({ value: f.key, label: `${f.name} (${t('sites.kinds.airfield').toLowerCase()})` });
  }
  for (const f of w.factories) if (f.key !== site.key) targets.push({ value: f.key, label: `${f.name} (${t('sites.kinds.factory').toLowerCase()})` });
  for (const p of w.ports) if ((p.convoys || p.coastal) && p.key !== site.key) targets.push({ value: p.key, label: `${p.label || p.name} (${t('sites.kinds.port').toLowerCase()})` });
  const carried = site.kind === 'depot' ? ['ammo']
    : RESOURCES.filter((res) => res in site.stocks && (site.stocks[res] >= 1 || res === 'fuel' || res === 'materiel'));
  const last = app.lastTrainLoads || {};
  const inputs = carried.map((res) => {
    const max = Math.min(fullTrain(w, res), Math.floor(site.stocks[res] || 0));
    const value = last[res] !== undefined ? Math.min(last[res], max) : '';
    return `<label>${escapeHtml(t(`logistics.${res}`))} <input type="number" min="0" max="${fullTrain(w, res)}" step="${R.wagonTonnes[res]}" id="train-${res}" placeholder="0"${value !== '' ? ` value="${value}"` : ''}> t</label>`;
  });
  return [
    `<div class="leg-form"><div class="sub">${escapeHtml(t('logistics.sendTrain'))}</div>`,
    `<div class="order-line">${inputs.join('')}</div>`,
    `<div class="order-line"><label class="grow">${escapeHtml(t('logistics.to'))} <select id="train-to">${options(targets, app.lastTrainTo || null)}</select></label>`,
    button('send-train', t('logistics.send'), { id: site.key, kind: 'site' }),
    `</div>`,
    `<p class="hint">${escapeHtml(t('logistics.trainHint', { wagons: R.trainWagons, fuel: R.wagonTonnes.fuel, materiel: R.wagonTonnes.materiel, min: R.trainMinTonnes }))}</p>`,
    `</div>`,
  ].join('');
}

function minStockForm(app, site, resource) {
  const w = app.world;
  const auto = w.settings.logistics === 'auto';
  const value = site.minStock[resource];
  return [
    `<div class="leg-form"><div class="sub">${escapeHtml(t('logistics.minStock'))} (${escapeHtml(resourceName(resource))})</div>`,
    `<div class="order-line"><label>${escapeHtml(t('logistics.minStock'))} <input type="number" min="0" step="${resource === 'ammo' ? 2 : 10}" id="min-stock-${resource}" value="${value === null ? '' : value}" placeholder="${auto ? autoMin(w, site, resource) : '—'}"> t</label>`,
    button('set-min', t('logistics.apply'), { id: site.key, kind: 'site', extra: ` data-resource="${resource}"` }),
    `</div>`,
    `<p class="hint">${escapeHtml(t('logistics.minHint'))}${auto ? ` ${escapeHtml(t('logistics.minAuto', { n: autoMin(w, site, resource) }))}` : ''}</p>`,
    `</div>`,
  ].join('');
}

function autoMin(w, site, resource) {
  const A = w.rules.logistics.autoMinimum;
  if (site.kind === 'airfield') return resource === 'ammo' ? A.airfieldAmmo : A.airfield;
  return A[site.kind];
}

/** Orders block of an installation's sheet (logistics part). */
export function stockOrders(app, site) {
  const w = app.world;
  if (!w.rail.enabled) return '';
  if (site.kind === 'port' && (site.convoys || site.coastal)) return trainForm(app, site);
  if (site.kind === 'depot') return trainForm(app, site);
  if (site.kind === 'airfield' && homeFieldIds(w).includes(site.id)) {
    return minStockForm(app, site, 'fuel') + (w.depots.length ? minStockForm(app, site, 'ammo') : '');
  }
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
    rows.push(row(t('sheet.cargoAfloat'), escapeHtml(`${Math.round(cargoShare(c, w) * 100)} %`)));
  }
  if (w.escorts.length && c.type !== 'coastal') {
    const groups = w.escorts.filter((e) => e.state === 'escorting' && e.escorting === c.id);
    rows.push(row(t('sheet.escort'), escapeHtml(groups.length
      ? groups.map((e) => t('sheet.escortText', { name: e.short, n: e.ships })).join(', ')
      : t('sheet.escortNone'))));
  }
  return rows.join('');
}

/** Fresh U-boat plots within reach of a group at sea (2 hours, 80 km), newest first. */
function freshPlots(w, e) {
  const atSea = ['atSea', 'waiting', 'escorting', 'hunting'].includes(e.state);
  return atSea ? w.uboatPlots
    .filter((p) => w.t - p.t < 2 * 3600 && distance(p.x, p.y, e.x, e.y) < 80)
    .sort((a, b) => b.t - a.t)
    .slice(0, 3) : [];
}

/** « Rester » or « Chasser » as two buttons (the command bar shows them as icons). */
export function behaviourButtons(e) {
  return `${button('escort-behaviour', t('orders.behaviours.stay'), { id: e.id, kind: 'escort', active: e.behaviour !== 'hunt', extra: ' data-behaviour="stay"' })}${button('escort-behaviour', t('orders.behaviours.hunt'), { id: e.id, kind: 'escort', active: e.behaviour === 'hunt', extra: ' data-behaviour="hunt"' })}`;
}

/** "Grenades 96/160" (the same words on the sheet, in the unit bar and in the watch reports). */
export function chargesText(e) {
  return t('sheet.chargesGauge', { n: e.charges, max: e.chargesMax });
}

/** « Plein » or « Économe »: how the group spends its depth charges. */
export function patternButtons(e) {
  return ['full', 'light'].map((x) => button('escort-pattern', t(`orders.patterns.${x}`), {
    id: e.id, kind: 'escort', active: (e.pattern || 'full') === x, extra: ` data-pattern="${x}" title="${escapeHtml(t(`orders.patternTitles.${x}`))}"`,
  })).join('');
}

/**
 * Facing the U-boats: the depth charges left and how to spend them, the hunt under way with
 * « Interrompre la chasse », the fresh plots to hunt now. With `behaviour`, the Rester /
 * Chasser buttons too.
 */
export function huntLines(app, e, { behaviour = true } = {}) {
  const w = app.world;
  const fresh = freshPlots(w, e);
  const hunting = e.state === 'hunting';
  const spare = canHunt(w, e);
  const state = e.charges <= 0 ? 'orders.chargesEmpty' : spare ? 'orders.chargesSpare' : 'orders.chargesReserve';
  return [
    behaviour ? `<div class="order-line">${behaviourButtons(e)}</div>` : '',
    `<p class="hint">${escapeHtml(t('orders.behaviourHint'))}</p>`,
    `<div class="order-line"><span class="grow${e.charges <= 0 ? ' warn' : ''}">${escapeHtml(chargesText(e))} · ${escapeHtml(t(state))}</span>${patternButtons(e)}</div>`,
    `<p class="hint">${escapeHtml(t('orders.patternHint'))}</p>`,
    hunting ? `<div class="order-line hunting"><span class="grow">${escapeHtml(huntText(w, e))}</span>${button('hunt-stop', t('orders.huntStop'), { id: e.id, kind: 'escort' })}</div>` : '',
    fresh.length ? `<div class="order-line">${fresh.map((p) => button('hunt-plot', t('orders.huntPlot', {
      time: formatTime(w.startMs + p.t * 1000), km: Math.round(distance(p.x, p.y, e.x, e.y)),
    }), { id: e.id, kind: 'escort', disabled: !spare, extra: ` data-plot="${escapeHtml(p.id)}"${spare ? '' : ` title="${escapeHtml(t('orders.errors.chargesReserve'))}"`}` })).join('')}</div>` : '',
  ].join('');
}

/**
 * The ports of « Rentrer au port », worked out at most every second and a half of real time:
 * at high speed the sheet is redrawn several times a second while the group moves fast.
 */
const PORTS_SHOWN = new WeakMap();
function shownPorts(app, e) {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const memo = PORTS_SHOWN.get(e);
  if (memo && memo.world === app.world && now - memo.at < 1500) return memo.ports;
  const ports = portChoices(app.world, e);
  PORTS_SHOWN.set(e, { at: now, ports, world: app.world });
  return ports;
}

/** « Rentrer au port » with the port: nearest by sea first, distance and hours. */
export function homePortLine(app, e) {
  const atSea = ['atSea', 'waiting', 'escorting', 'hunting'].includes(e.state);
  const ports = atSea ? shownPorts(app, e) : [];
  if (!ports.length) return '';
  return `<div class="order-line"><span>${escapeHtml(t('orders.homePort'))}</span><select id="home-port-${escapeHtml(e.id)}">${options(ports.map((x) => ({
    value: x.port.id, label: t('orders.portChoice', { port: x.port.name, km: Math.round(x.km), h: formatNumber(x.hours, x.hours < 10 ? 1 : 0) }),
  })), ports[0].port.id)}</select>${button('escort-home', t('orders.go'), { id: e.id, kind: 'escort' })}</div>`;
}

/** Face aux U-Boote and Rentrer au port, one under the other (for a group or a support group). */
export function huntAndPortLines(app, e) {
  return `<div class="sub">${escapeHtml(t('orders.behaviour'))}</div>${huntLines(app, e)}${homePortLine(app, e)}`;
}

/** Convoys at sea the group can meet, as buttons; « Quitter le convoi » when it is with one. */
export function joinLines(app, e) {
  const w = app.world;
  const canMove = e.state === 'inPort' || e.state === 'atSea' || e.state === 'waiting' || e.state === 'hunting';
  const aid = w.settings.interceptAid !== 'none';
  const joinable = w.convoys.filter((c) => c.state === 'atSea' && c.type !== 'coastal' && c.id !== e.escorting);
  const convoyName = (c) => (c.straggler ? t('units.straggler', { name: c.name.split('·')[0], n: c.strayIndex }) : c.name);
  return [
    aid && (canMove || e.state === 'escorting') && joinable.length
      ? `<div class="order-line">${joinable.map((c) => button('join', t('orders.join', { convoy: convoyName(c) }), { id: e.id, kind: 'escort', extra: ` data-convoy="${escapeHtml(c.id)}"` })).join('')}</div>` : '',
    e.state === 'escorting' ? `<div class="order-line">${button('leave', t('orders.leave'), { id: e.id, kind: 'escort' })}</div>` : '',
    `<p class="hint">${escapeHtml(t('orders.joinHint'))}</p>`,
  ].join('');
}

/** In port: the way out (roads or a channel); `sail`: the « Appareiller » button with it. */
export function exitLines(app, e, { sail = true } = {}) {
  const w = app.world;
  const port = w.byId.port.get(e.portId);
  const channels = (port && port.approaches) || [];
  const list = [{ value: '', label: t('orders.exitRoads') }, ...channels.map((a) => ({ value: a.name, label: t('orders.exitChannel', { name: a.name }) }))];
  return `<div class="order-line">${sail ? button('sail', t('orders.escortSail'), { id: e.id, kind: 'escort' }) : ''}
    ${channels.length ? `<label class="small">${escapeHtml(t('orders.exitBy'))} <select id="exit-channel-${escapeHtml(e.id)}" data-change="exit-channel" data-id="${escapeHtml(e.id)}">${options(list, e.exitChannel || '')}</select></label>` : ''}</div>
    <p class="hint">${escapeHtml(t('orders.exitHint'))}</p>`;
}

export function escortSheet(app, e) {
  const w = app.world;
  const [lon, lat] = unproject(e.x, e.y);
  let state = escortStateText(w, e);
  if (e.state === 'escorting') {
    const c = w.convoys.find((x) => x.id === e.escorting);
    if (c) state += ` · ${c.name}`;
  }
  if (e.state === 'atSea' && e.joinTarget) {
    const c = w.convoys.find((x) => x.id === e.joinTarget);
    if (c) state += ` · ${t('sheet.joining', { convoy: c.name })}`;
  }
  if (e.state === 'refit') state += ` · ${t('sheet.readyIn', { n: Math.ceil(e.timer / 60) })}`;
  if (e.state === 'hunting') state += ` · ${t(e.engage ? 'sheet.huntingHeld' : 'sheet.huntingUntil', { time: formatTime(w.startMs + e.huntUntil * 1000) })}`;
  const info = [
    `<h3>${escapeHtml(e.name)} <small>${escapeHtml(e.short)}</small></h3>`,
    row(t('sheet.state'), escapeHtml(state)),
    row(t('sheet.composition2'), escapeHtml(e.radar ? `${e.composition} · ${t('sheet.radarFitted')}` : e.composition)),
    row(t('sheet.speed'), escapeHtml(t('sheet.speedKn', { n: e.speedKn }))),
    row(t('sheet.endurance'), escapeHtml(t('sheet.enduranceDays', { n: formatNumber(Math.max(0, e.endurance) / 86400, 1) }))),
    row(t('sheet.charges'), escapeHtml(`${e.charges}/${e.chargesMax} · ${t(`orders.patterns.${e.pattern || 'full'}`)}`)),
    e.state === 'inPort' || e.state === 'refit'
      ? row(t('sheet.airfield'), escapeHtml(w.byId.port.get(e.portId).name))
      : row(t('sheet.position'), escapeHtml(positionText(lat, lon))),
  ].join('');
  const canMove = e.state === 'inPort' || e.state === 'atSea' || e.state === 'waiting' || e.state === 'hunting';
  const aid = w.settings.interceptAid !== 'none';
  const joinable = w.convoys.filter((c) => c.state === 'atSea' && c.type !== 'coastal' && c.id !== e.escorting);
  const orders = [
    `<div class="orders">`,
    e.state === 'inPort' ? exitLines(app, e) : '',
    joinLines(app, e),
    huntAndPortLines(app, e),
    `</div>`,
  ].join('');
  return {
    info,
    planUnit: canMove ? e : null,
    orders,
    legForm: canMove,
    key: `eg:${e.id}:${e.state}:${e.plan.length > 0}:${e.route.length > 0}:${joinable.map((c) => c.id).join(',')}:${app.settings.orders}:${aid}:${app.editingLeg ? app.editingLeg.index : ''}:${e.behaviour}:${e.pattern}:${e.charges}`,
  };
}

/** "En chasse : attaque un U-Boot (passe 2)", or the search and the hour it ends. */
function huntText(w, e) {
  const until = formatTime(w.startMs + e.huntUntil * 1000);
  if (e.engage) {
    const rep = w.navalReports.find((r) => r.id === e.engage.reportId);
    const n = (rep ? rep.passes.length : 0) + 1;
    return e.huntStay ? t('orders.huntCounterEngaged', { time: until, n }) : t('orders.huntEngaged', { n });
  }
  return t(e.huntStay ? 'orders.huntCounter' : 'orders.huntSearching', { time: until });
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
    `<p>${escapeHtml(t('logistics.trainLine', { what: cargoText(tr.cargo), from: from.name, to: to.name }))}</p>`,
    row(t('logistics.wagons'), escapeHtml(t('logistics.wagonsOf', { n: tr.wagons, max: R.trainWagons }))),
    row(t('sheet.state'), escapeHtml(t(`logistics.trainState.${tr.state}`))),
    row(t('sheet.eta'), escapeHtml(dateTimeText(w.startMs + etaS * 1000))),
  ].join('');
  return { info, plan: '', orders: '', profile: false, key: `tr:${id}` };
}

/** "Cover the convoy" buttons for a squadron, for coastal convoys at sea. */
export function coverButtons(app, s) {
  const w = app.world;
  if (!(s.state === 'airborne' || s.state === 'combat' || s.state === 'returning')) return '';
  if (s.role === 'watch') return '';
  // Fighters cover the coastal convoys; Coastal Command covers any convoy at sea.
  const list = w.convoys.filter((c) => c.state === 'atSea' && (s.role === 'coastal' || c.type === 'coastal'));
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
