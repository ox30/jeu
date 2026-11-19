// The Effectifs page: every aerodrome on the left, its squadrons on the right (everything that
// flies tires: fighters, spotters and Coastal Command alike), each with its state now, its
// plan of the day (00:00 to 24:00, every day) or the plan for the coming hours (in hours H),
// its 24 hours ahead on a bar, and a copy of its plan to others.
// The orders go through the same buttons as the unit sheet (main.js answers them).

import { tutorialFlag } from './tutorial.js';
import { escapeHtml, t } from '../core/i18n.js';
import { fatigueLevel, fatigueOn } from '../sim/crews.js';
import { ALERTS, alertButtons, alertStatus, confirmBox, rosterBlock, timelineHtml } from './panels.js';
import { button, options } from './html.js';
import { showPage } from './pages.js';
import { toolOffered } from './offered.js';

/** The aerodromes of the page: those with a squadron, of any role, based or standing there. */
export function rosterFields(w) {
  return w.airfields.filter((f) => w.squadrons.some((s) => s.state !== 'lost' && (s.airfield === f.id || s.home === f.id)));
}

/** The squadrons of an aerodrome on the page: fighters, spotters and Coastal Command alike. */
export function rosterSquadrons(w, fieldId) {
  return w.squadrons.filter((s) => s.state !== 'lost' && (s.airfield === fieldId || s.home === fieldId));
}

/** « Fatigue 63 % · fatiguée », in the colour of its level: who needs the rest the plan gives. */
function fatigueHtml(w, s) {
  const level = fatigueLevel(w, s);
  return `<span class="fatigue-${level}">${escapeHtml(`${t('sheet.fatigue')} ${t('sheet.fatigueText', { n: Math.round(s.fatigue), level: t(`sheet.fatigueLevels.${level}`) })}`)}</span>`;
}

/** Opens the page on an aerodrome, or on the aerodrome of a squadron (which it then shows first). */
export function openRoster(app, { fieldId = null, squadronId = null } = {}) {
  if (!toolOffered(app, 'roster')) return; // not a tool of this scenario, or of a game without fatigue
  tutorialFlag(app, 'rosterOpened');
  const w = app.world;
  const s = squadronId ? w.squadrons.find((x) => x.id === squadronId) : null;
  const fields = rosterFields(w);
  const field = fieldId || (s ? s.home || s.airfield : null) || (app.rosterPage && app.rosterPage.fieldId) || (fields[0] && fields[0].id);
  app.rosterPage = { fieldId: field, squadronId: s ? s.id : null };
  const dlg = app.el.dlgRoster;
  dlg.innerHTML = `<form method="dialog" class="page roster-page">
    <h2>${escapeHtml(t('roster.title'))}</h2>
    <p class="hint">${escapeHtml(t('roster.intro', { n: Number(app.settings.rosterHours) || 24 }))}</p>
    ${fatigueOn(w) ? '' : `<p class="message warning">${escapeHtml(t('roster.noFatigue'))}</p>`}
    <div class="rp-columns"><div class="rp-col rp-fields"></div><div class="rp-col rp-squadrons"></div></div>
    <div class="dialog-buttons"><button value="close">${escapeHtml(t('reports.close'))}</button></div>
  </form>`;
  if (!dlg.__wired) {
    dlg.__wired = true;
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rp-field]');
      if (!b) return;
      app.rosterPage = { fieldId: b.dataset.rpField, squadronId: null };
      renderRosterPage(app, true);
    });
  }
  renderRosterPage(app, true);
  showPage(app, dlg);
  if (s) {
    const card = dlg.querySelector(`#rp-${CSS.escape(s.id)}`);
    if (card) card.scrollIntoView({ block: 'nearest' });
  }
}

/** Redraws the page while it is open (the game runs on: states and bars change). */
export function renderRosterPage(app, force = false) {
  const dlg = app.el.dlgRoster;
  if (!dlg || !dlg.open && !force) return;
  const st = app.rosterPage;
  if (!st) return;
  const w = app.world;
  const fields = rosterFields(w);
  const left = dlg.querySelector('.rp-fields');
  const right = dlg.querySelector('.rp-squadrons');
  if (!left || !right) return;
  const fieldHtml = `<h3>${escapeHtml(t('roster.fields'))}</h3><ul class="rp-list">${fields.map((f) => {
    const list = rosterSquadrons(w, f.id);
    const ready = list.filter((s) => s.state === 'ready').length;
    return `<li><button type="button" class="rp-field${f.id === st.fieldId ? ' active' : ''}" data-rp-field="${escapeHtml(f.id)}"><b>${escapeHtml(f.name)}</b>
      <small>${escapeHtml(t('roster.fieldLine', { n: list.length, ready }))}</small></button></li>`;
  }).join('')}</ul>`;
  if (left.__html !== fieldHtml) {
    left.innerHTML = fieldHtml;
    left.__html = fieldHtml;
  }
  const here = rosterSquadrons(w, st.fieldId);
  const legend = ALERTS.map((a) => `<span class="legend"><span class="seg alert-${a}"></span>${escapeHtml(t(`orders.alertNames.${a}`))}</span>`).join('');
  const others = w.squadrons.filter((s) => s.state !== 'lost');
  const blocks = here.map((s) => {
    const grounded = s.state === 'ready' || s.state === 'refuelling';
    const copyList = [{ value: 'field', label: t('roster.copyField') }, ...others.filter((o) => o !== s).map((o) => ({ value: o.id, label: o.name }))];
    return `<section class="roster-squadron orders${s.id === st.squadronId ? ' focus' : ''}" id="rp-${escapeHtml(s.id)}">
      <div class="roster-head"><span class="rp-name"><b>${escapeHtml(s.name)}</b> <small>${escapeHtml(s.typeName)}</small></span> <span>${escapeHtml(t(`states.squadron.${s.state}`))} · ${fatigueHtml(w, s)}</span></div>
      ${timelineHtml(w, s)}
      ${grounded ? `${alertButtons(app, s, 'squadron', s.alert || 'min5')}${confirmBox(app, 'squadron', s.id, s.name)}` : ''}
      <p class="hint">${escapeHtml(alertStatus(w, s))}</p>
      ${s.alertManual ? `<div class="order-line">${button('roster-resume', t('orders.rosterResume'), { id: s.id, kind: 'squadron' })}</div>` : ''}
      ${rosterBlock(app, s, { title: true })}
      ${s.roster && s.roster.daily && s.roster.daily.length ? `<div class="order-line"><span>${escapeHtml(t('roster.copy'))}</span><select id="rp-copy-${escapeHtml(s.id)}">${options(copyList, 'field')}</select>${button('roster-copy', t('roster.copyGo'), { id: s.id, kind: 'squadron' })}</div>` : ''}
    </section>`;
  }).join('');
  const html = `<div class="legend-line">${legend}</div>${blocks || `<p class="hint">${escapeHtml(t('roster.none'))}</p>`}`;
  setKeyedPage(right, html, `${st.fieldId}`);
}

/** Like the unit sheet: what the player is typing or choosing survives a redraw. */
function setKeyedPage(el, html, key) {
  if (el.__html === html && el.__key === key) return;
  const active = document.activeElement;
  if (el.__key === key && active && el.contains(active) && (active.tagName === 'SELECT' || active.tagName === 'INPUT')) return;
  const kept = new Map();
  if (el.__key === key) for (const x of el.querySelectorAll('input[id], select[id]')) kept.set(x.id, x.type === 'checkbox' ? x.checked : x.value);
  el.innerHTML = html;
  el.__html = html;
  el.__key = key;
  for (const [id, v] of kept) {
    const x = el.querySelector(`#${CSS.escape(id)}`);
    if (!x) continue;
    if (x.type === 'checkbox') x.checked = v;
    else if (x.tagName === 'SELECT' && [...x.options].some((o) => o.value === v)) x.value = v;
    else if (x.tagName === 'INPUT' && x.type !== 'checkbox' && v !== x.defaultValue && v !== '') x.value = v;
  }
}
