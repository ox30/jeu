// Pages opened from the top bar over the map: the after-action reports of the raids. They
// are for reading back, not for acting: the side panel stays the place for orders.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { formatDate, formatTime } from '../core/time.js';
import { FOOT_M } from '../sim/geo.js';
import { reportTotals } from '../sim/reports.js';
import { aircraftSpec } from '../sim/squadron.js';
import { ftText } from './format.js';

/** Opens a dialog as a page; the game pauses while it is open when the setting asks. */
export function showPage(app, dlg) {
  if (app.settings.pagesPause && !app.paused && !app.world.ended && !dlg.open) {
    app.paused = true;
    app.pausedByPage = true;
    app.dirtyHud = true;
    dlg.addEventListener('close', () => {
      if (!app.pausedByPage) return;
      app.pausedByPage = false;
      app.paused = false;
      app.accumulator = 0;
      app.dirtyHud = true;
    }, { once: true });
  }
  if (!dlg.open) dlg.showModal();
}

function missText(m) {
  const km = formatNumber(Math.max(1, Math.round(m.km)));
  const ft = ftText(Math.round(Math.abs(m.dzM / FOOT_M) / 500) * 500);
  let text = t(`reports.miss.${m.problem}`, { km, ft });
  if (m.guided !== null && m.guided !== undefined) text += t('reports.missGuided', { p: Math.round(m.guided * 100) });
  return text;
}

function hitText(world, h) {
  if (h.kind === 'convoy') return t('reports.hitConvoy', { convoy: h.siteName, n: h.sunk });
  const site = world.sites.get(h.site);
  const name = site ? (site.longName || t(`sites.longName.${site.kind}`, { of: site.of || t('place.of', { place: site.name }) })) : h.siteName;
  return t('reports.hitSite', { site: name, severity: t(`severity.${h.severity}`), n: h.damage });
}

function targetName(world, rep) {
  if (!rep.target) return '';
  const [kind, id] = rep.target.split(':');
  if (kind === 'convoy') {
    const c = world.convoys.find((x) => x.id === id);
    return t('reports.targetConvoy', { convoy: c ? c.name : id });
  }
  const site = world.sites.get(rep.target);
  if (!site) return rep.target;
  return site.longName || t(`sites.longName.${site.kind}`, { of: site.of || t('place.of', { place: site.name }) });
}

function reportCard(app, rep) {
  const w = app.world;
  const ms = (s) => w.startMs + s * 1000;
  const from = formatTime(ms(rep.detectedT ?? rep.startT));
  const to = rep.closed ? formatTime(ms(rep.endT)) : t('reports.ongoing');
  const totals = reportTotals(rep);
  const lines = [];
  if (rep.phantom) {
    lines.push(`<p>${escapeHtml(t('reports.phantomText'))}</p>`);
  } else {
    lines.push(`<p class="comp">${escapeHtml(t('reports.composition', {
      bombers: rep.bombersStart, bomberType: rep.bomberType, escort: rep.escortStart, escortType: rep.escortType,
    }))} ${escapeHtml(t('reports.target', { target: targetName(w, rep) }))}</p>`);
    const hits = rep.hits.map((h) => hitText(w, h));
    if (rep.groundLosses) hits.push(t('reports.groundLosses', { n: rep.groundLosses }));
    lines.push(`<p class="target">${escapeHtml(hits.length ? hits.join(' ') : t('reports.noHit'))}</p>`);
  }
  if (rep.squadrons.length) {
    const rows = rep.squadrons.map((s) => {
      const spec = aircraftSpec(w, s.type);
      const type = spec ? spec.name : s.type;
      let result;
      if (s.fights) result = s.above ? t('reports.engagedAbove') : t('reports.engaged');
      else result = s.missed.length ? missText(s.missed[s.missed.length - 1]) : t('reports.noContact');
      if (s.fights && s.missed.length) result += ` · ${missText(s.missed[0])}`;
      const down = s.fights ? t('reports.downCell', { b: s.bombersDown, f: s.fightersDown }) : '—';
      return `<tr class="${s.fights ? 'fought' : 'missed'}"><td><b>${escapeHtml(s.name)}</b> <small>${escapeHtml(type)}</small></td><td>${escapeHtml(result)}</td><td class="n">${escapeHtml(down)}</td><td class="n">${s.fights ? s.losses : '—'}</td></tr>`;
    });
    lines.push(`<table class="fights"><thead><tr><th>${escapeHtml(t('reports.squadron'))}</th><th>${escapeHtml(t('reports.result'))}</th><th class="n">${escapeHtml(t('reports.down'))}</th><th class="n">${escapeHtml(t('reports.losses'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
  } else if (!rep.phantom) {
    lines.push(`<p class="hint">${escapeHtml(t('reports.noSquadron'))}</p>`);
  }
  if (!rep.phantom) {
    lines.push(`<p class="totals">${escapeHtml(t('reports.totals', { down: totals.down, b: totals.bombers, f: totals.fighters, lost: totals.lost }))}</p>`);
  }
  const outcome = rep.closed ? rep.outcome : 'ongoing';
  return `<article class="report outcome-${outcome}" id="report-${escapeHtml(rep.raidId)}">
    <header><b>${escapeHtml(t('reports.raid', { label: rep.label }))}</b> <span class="when">${escapeHtml(from)} – ${escapeHtml(to)}</span>
    <span class="tag">${escapeHtml(t(`reports.outcome.${outcome}`))}</span></header>
    ${lines.join('')}
  </article>`;
}

/** The raid reports, by day, newest first; `focus` scrolls to one raid. */
export function openReports(app, focus = null) {
  const dlg = app.el.dlgReports;
  app.reportsOpened = true;
  const w = app.world;
  const reports = [...w.reports.values()].sort((a, b) => (b.detectedT ?? b.startT) - (a.detectedT ?? a.startT));
  const byDay = new Map();
  for (const rep of reports) {
    const ms = w.startMs + (rep.detectedT ?? rep.startT) * 1000;
    const day = Math.floor(ms / 86400000);
    if (!byDay.has(day)) byDay.set(day, { ms, list: [] });
    byDay.get(day).list.push(rep);
  }
  const sections = [...byDay.values()].map(({ ms, list }) => {
    const totals = list.reduce((acc, rep) => {
      const x = reportTotals(rep);
      acc.down += x.down;
      acc.lost += x.lost;
      return acc;
    }, { down: 0, lost: 0 });
    return `<section class="report-day"><h3>${escapeHtml(formatDate(ms, t('days'), t('months')))} <small>${escapeHtml(t('reports.dayTotals', { n: list.length, down: totals.down, lost: totals.lost }))}</small></h3>
      ${list.map((rep) => reportCard(app, rep)).join('')}</section>`;
  });
  dlg.innerHTML = `
    <form method="dialog" class="page reports-page">
      <h2>${escapeHtml(t('reports.title'))}</h2>
      ${sections.length ? sections.join('') : `<p class="hint">${escapeHtml(t('reports.none'))}</p>`}
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('reports.close'))}</button></div>
    </form>`;
  showPage(app, dlg);
  if (focus) {
    const card = dlg.querySelector(`#report-${CSS.escape(focus)}`);
    if (card) {
      card.classList.add('focus');
      card.scrollIntoView({ block: 'center' });
    }
  }
}

// ---- technical cards ----------------------------------------------------------------

function cardRows(rows) {
  return `<table class="card-table">${rows.filter(Boolean).map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`).join('')}</table>`;
}

function strengthWord(v) {
  if (v >= 1.1) return t('cards.word.strong');
  if (v >= 0.97) return t('cards.word.good');
  if (v >= 0.85) return t('cards.word.fair');
  return t('cards.word.weak');
}

function fighterCard(key, f, patrol = false) {
  const rows = [
    [t('cards.cruise'), t('units.kmh', { n: f.cruiseKmh })],
    [t('cards.max'), t('units.kmh', { n: f.maxKmh })],
    [t('cards.climb'), t('cards.climbText', { ft: formatNumber(Math.round(f.climbMpm / 0.3048 / 50) * 50) })],
    f.ceilingFt ? [t('cards.ceiling'), ftText(f.ceilingFt)] : null,
    [t('cards.endurance'), t('cards.minutes', { n: f.enduranceMin })],
    f.armament ? [t('cards.armament'), f.armament] : null,
    f.crew ? [t('cards.crew'), f.crew] : null,
  ];
  if (!patrol) {
    rows.push([t('cards.vsBombers'), strengthWord(f.vsBombers)]);
    rows.push([t('cards.vsFighters'), strengthWord(f.vsFighters)]);
  } else {
    rows.push([t('cards.sight'), t('cards.sightText', { day: f.sightDayKm, night: f.sightNightKm })]);
    if (f.uboatSightKm) rows.push([t('cards.uboatSight'), t('cards.km', { n: f.uboatSightKm })]);
  }
  return `<article class="card" id="card-${escapeHtml(key.replace(/\s+/g, '-'))}"><h4>${escapeHtml(f.name)}</h4>
    <p class="hint">${escapeHtml(t(`cards.notes.${key}`))}</p>${cardRows(rows)}</article>`;
}

function bomberCard(key, b) {
  return `<article class="card"><h4>${escapeHtml(b.name)}</h4><p class="hint">${escapeHtml(t(`cards.notes.${key}`))}</p>${cardRows([
    [t('cards.cruise'), t('units.kmh', { n: b.cruiseKmh })],
    [t('cards.max'), t('units.kmh', { n: b.maxKmh })],
    [t('cards.ceiling'), ftText(b.ceilingFt)],
    [t('cards.bombs'), t('cards.kg', { n: formatNumber(b.bombKg) })],
    [t('cards.crew'), b.crew],
    [t('cards.vulnerability'), b.vulnerability > 1.1 ? t('cards.word.vulnerable') : b.vulnerability < 0.9 ? t('cards.word.tough') : t('cards.word.average')],
  ])}</article>`;
}

function escortCard(key, e) {
  return `<article class="card"><h4>${escapeHtml(e.name)}</h4><p class="hint">${escapeHtml(t(`cards.notes.${key}`))}</p>${cardRows([
    [t('cards.max'), t('units.kmh', { n: e.maxKmh })],
    [t('cards.ceiling'), ftText(e.ceilingFt)],
    [t('cards.range'), t('cards.km', { n: formatNumber(e.rangeKm) })],
    [t('cards.armament'), e.armament],
    [t('cards.crew'), e.crew],
    [t('cards.threat'), e.threat > 1.1 ? t('cards.word.dangerous') : t('cards.word.average')],
  ])}</article>`;
}

function shipCards(world) {
  const S = world.rules.ships;
  const A = world.rules.asw;
  return [
    `<article class="card"><h4>${escapeHtml(S.convoy.name)}</h4><p class="hint">${escapeHtml(t('cards.notes.convoy'))}</p>${cardRows([
      [t('cards.speedSea'), t('cards.knots', { n: S.convoy.speedKn })],
      [t('cards.stragglers'), t('cards.stragglersText', { p: Math.round(A.stragglerFrom * 100) })],
      [t('cards.zigzag'), t('cards.zigzagText', { p: Math.round((1 - A.zigzagSpeed) * 100), h: Math.round((1 - A.zigzagHit) * 100) })],
    ])}</article>`,
    `<article class="card"><h4>${escapeHtml(S.escort.name)}</h4><p class="hint">${escapeHtml(t('cards.notes.escort'))}</p>${cardRows([
      [t('cards.speedSea'), t('cards.knots', { n: S.escort.speedKn })],
      [t('cards.asdic'), t('cards.km', { n: A.asdicKm })],
      [t('cards.lookouts'), t('cards.lookoutsText', { day: A.lookoutDayKm, night: A.lookoutNightKm })],
    ])}</article>`,
    `<article class="card"><h4>${escapeHtml(S.uboat.name)}</h4><p class="hint">${escapeHtml(t('cards.notes.uboat'))}</p>${cardRows([
      [t('cards.surface'), t('cards.knots', { n: S.uboat.surfaceKn })],
      [t('cards.submerged'), t('cards.knots', { n: S.uboat.submergedKn })],
      [t('cards.battery'), t('cards.batteryText', { n: S.uboat.batteryNm })],
      [t('cards.torpedoes'), S.uboat.torpedoes],
      [t('cards.crew'), S.uboat.crew],
    ])}</article>`,
  ].join('');
}

/** Cards of the aircraft and ships, with the numbers the game uses. */
export function openCards(app, focus = null) {
  const dlg = app.el.dlgCards;
  const R = app.world.rules;
  const section = (title, html) => `<section class="card-section"><h3>${escapeHtml(title)}</h3><div class="cards">${html}</div></section>`;
  dlg.innerHTML = `
    <form method="dialog" class="page cards-page">
      <h2>${escapeHtml(t('cards.title'))}</h2>
      <p class="hint">${escapeHtml(t('cards.intro'))}</p>
      ${section(t('cards.fighters'), Object.entries(R.fighters).map(([k, f]) => fighterCard(k, f)).join(''))}
      ${section(t('cards.patrols'), Object.entries(R.patrols).map(([k, f]) => fighterCard(k, f, true)).join(''))}
      ${section(t('cards.bombers'), Object.entries(R.bombers).map(([k, b]) => bomberCard(k, b)).join(''))}
      ${section(t('cards.escorts'), Object.entries(R.escorts).map(([k, e]) => escortCard(k, e)).join(''))}
      ${section(t('cards.sea'), shipCards(app.world))}
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('reports.close'))}</button></div>
    </form>`;
  showPage(app, dlg);
  if (focus) {
    const card = dlg.querySelector(`#card-${CSS.escape(focus.replace(/\s+/g, '-'))}`);
    if (card) {
      card.classList.add('focus');
      card.scrollIntoView({ block: 'center' });
    }
  }
}
