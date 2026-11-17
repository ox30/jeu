// The formations page: two columns, like choosing the columns of a table. On the left the
// units that can be put in a formation, on the right the formation being edited: its name,
// its leader (★) and its members in order. A big wing for the fighters, a support group for
// the escort groups; there is no limit on the size. Every change applies at once.

import { escapeHtml, t } from '../core/i18n.js';
import {
  addMember, dissolveFormation, formationById, formationOf, joinProblem, membersOf, moveMember, newFormation, removeMember,
  renameFormation, setLeader,
} from '../sim/formations.js';
import { isFlying } from '../sim/squadron.js';
import { altitudeText } from './format.js';
import { showPage } from './pages.js';

function unitsOfKind(world, kind) {
  return kind === 'air' ? world.squadrons.filter((s) => s.role === 'fighter') : world.escorts;
}

function placeText(world, u) {
  if (u.kind === 'squadron') {
    if (isFlying(u)) return altitudeText(u.alt);
    const field = world.byId.airfield.get(u.airfield);
    return field ? field.name : '';
  }
  if (u.state === 'inPort' || u.state === 'refit') return world.byId.port.get(u.portId)?.name || '';
  return t('formations.atSea');
}

function stateText(u) {
  return u.kind === 'squadron' ? t(`states.squadron.${u.state}`) : t(`states.escort.${u.state}`);
}

function countText(u) {
  return u.kind === 'squadron' ? t('formations.aircraft', { n: u.aircraft }) : t('formations.ships', { n: u.ships });
}

/** Units shown on the left, by the filter chosen. */
function available(app, editing) {
  const st = app.formationsPage;
  const w = app.world;
  return unitsOfKind(w, st.kind).filter((u) => {
    if (editing && editing.members.includes(u.id)) return false;
    if (u.state === 'lost') return false;
    if (st.filter === 'air') return u.kind === 'squadron' ? isFlying(u) || u.state === 'scrambling' : u.state !== 'inPort' && u.state !== 'refit';
    if (st.filter === 'ground') return u.kind === 'squadron' ? !isFlying(u) && u.state !== 'scrambling' : u.state === 'inPort' || u.state === 'refit';
    if (st.filter.startsWith('base:')) return u.kind === 'squadron' ? u.airfield === st.filter.slice(5) : u.portId === st.filter.slice(5);
    return true;
  });
}

function filterOptions(app) {
  const st = app.formationsPage;
  const w = app.world;
  const list = [['all', t('formations.filterAll')], ['air', t(st.kind === 'air' ? 'formations.filterAir' : 'formations.filterSea')],
    ['ground', t(st.kind === 'air' ? 'formations.filterGround' : 'formations.filterPort')]];
  const bases = new Map();
  for (const u of unitsOfKind(w, st.kind)) {
    if (u.kind === 'squadron') {
      const f = w.byId.airfield.get(u.airfield);
      if (f) bases.set(f.id, f.name);
    } else {
      const p = w.byId.port.get(u.portId);
      if (p) bases.set(p.id, p.name);
    }
  }
  for (const [id, name] of bases) list.push([`base:${id}`, name]);
  return list.map(([v, label]) => `<option value="${escapeHtml(v)}"${v === st.filter ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function render(app) {
  const dlg = app.el.dlgFormations;
  const st = app.formationsPage;
  const w = app.world;
  const kinds = [];
  if (w.squadrons.some((s) => s.role === 'fighter')) kinds.push('air');
  if (w.escorts.length) kinds.push('naval');
  if (!kinds.includes(st.kind)) st.kind = kinds[0] || 'air';
  let editing = st.formationId ? formationById(w, st.formationId) : null;
  if (editing && editing.kind !== st.kind) editing = null;
  if (!editing) st.formationId = null;
  const list = w.formations.filter((f) => f.kind === st.kind);

  const kindTabs = kinds.length > 1
    ? `<div class="fm-kinds">${kinds.map((k) => `<button type="button" data-fm="kind" data-kind="${k}" class="${k === st.kind ? 'active' : ''}">${escapeHtml(t(`formations.kind.${k}`))}</button>`).join('')}</div>`
    : '';
  const chips = [
    ...list.map((f) => `<button type="button" class="fm-chip${editing === f ? ' active' : ''}" data-fm="pick" data-id="${escapeHtml(f.id)}">${escapeHtml(f.name)} <small>${membersOf(w, f).length}</small></button>`),
    `<button type="button" class="fm-chip new${editing ? '' : ' active'}" data-fm="new">${escapeHtml(t(`formations.new.${st.kind}`))}</button>`,
  ].join('');

  const left = available(app, editing).map((u) => {
    const problem = joinProblem(w, st.kind, u);
    const other = formationOf(w, u);
    const note = problem ? t(`formations.problem.${problem}`) : other ? t('formations.inOther', { name: other.name }) : '';
    return `<li class="fm-row${problem ? ' off' : ''}">
      <span class="fm-name">${escapeHtml(u.name)}</span>
      <span class="fm-meta">${escapeHtml(u.kind === 'squadron' ? u.typeName : u.short)} · ${escapeHtml(stateText(u))} · ${escapeHtml(placeText(w, u))} · ${escapeHtml(countText(u))}${note ? ` · <em>${escapeHtml(note)}</em>` : ''}</span>
      <button type="button" data-fm="add" data-id="${escapeHtml(u.id)}" title="${escapeHtml(t('formations.add'))}"${problem ? ' disabled' : ''}>→</button></li>`;
  }).join('') || `<li class="fm-empty">${escapeHtml(t('formations.noneLeft'))}</li>`;

  let right;
  if (editing) {
    const members = membersOf(w, editing);
    const total = members.reduce((n, u) => n + (u.kind === 'squadron' ? u.aircraft : u.ships), 0);
    right = `
      <label class="fm-label">${escapeHtml(t('formations.name'))} <input type="text" data-fm-name maxlength="40" value="${escapeHtml(editing.name)}"></label>
      <p class="hint">${escapeHtml(t(`formations.total.${editing.kind}`, { n: members.length, total }))}</p>
      <ol class="fm-members">${members.map((u, i) => `<li class="fm-row${i === 0 ? ' leader' : ''}">
        <button type="button" class="fm-star" data-fm="lead" data-id="${escapeHtml(u.id)}" title="${escapeHtml(i === 0 ? t('formations.isLeader') : t('formations.makeLeader'))}">${i === 0 ? '★' : '☆'}</button>
        <span class="fm-name">${escapeHtml(u.name)}</span>
        <span class="fm-meta">${escapeHtml(stateText(u))} · ${escapeHtml(placeText(w, u))} · ${escapeHtml(countText(u))}</span>
        <span class="fm-move">
          <button type="button" data-fm="up" data-id="${escapeHtml(u.id)}" title="${escapeHtml(t('formations.up'))}"${i <= 1 ? ' disabled' : ''}>↑</button>
          <button type="button" data-fm="down" data-id="${escapeHtml(u.id)}" title="${escapeHtml(t('formations.down'))}"${i === 0 || i === members.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" data-fm="remove" data-id="${escapeHtml(u.id)}" title="${escapeHtml(t('formations.remove'))}">←</button>
        </span></li>`).join('')}</ol>
      ${members.length < 2 ? `<p class="hint">${escapeHtml(t('formations.addMore'))}</p>` : ''}
      <div class="fm-actions">
        <button type="button" data-fm="show" data-id="${escapeHtml(editing.id)}">${escapeHtml(t('formations.show'))}</button>
        <button type="button" class="danger" data-fm="dissolve" data-id="${escapeHtml(editing.id)}">${escapeHtml(t('formations.dissolve'))}</button>
      </div>`;
  } else {
    right = `<p class="hint">${escapeHtml(t(`formations.startHint.${st.kind}`))}</p>`;
  }

  dlg.innerHTML = `
    <form method="dialog" class="page formations-page">
      <h2>${escapeHtml(t('formations.title'))}</h2>
      <p class="hint">${escapeHtml(t(`formations.intro.${st.kind}`))}</p>
      ${kindTabs}
      <div class="fm-chips">${chips}</div>
      <div class="fm-columns">
        <section class="fm-col">
          <h3>${escapeHtml(t('formations.available'))}
            <select data-fm-filter>${filterOptions(app)}</select></h3>
          <ul class="fm-list">${left}</ul>
        </section>
        <section class="fm-col">
          <h3>${escapeHtml(editing ? t('formations.members') : t(`formations.new.${st.kind}`))}</h3>
          ${right}
        </section>
      </div>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('reports.close'))}</button></div>
    </form>`;
}

function onClick(app, e) {
  const b = e.target.closest('[data-fm]');
  if (!b || b.disabled) return;
  e.preventDefault();
  const st = app.formationsPage;
  const w = app.world;
  const f = st.formationId ? formationById(w, st.formationId) : null;
  const id = b.dataset.id;
  switch (b.dataset.fm) {
    case 'kind':
      st.kind = b.dataset.kind;
      st.formationId = null;
      st.filter = 'all';
      break;
    case 'pick':
      st.formationId = id;
      break;
    case 'new':
      st.formationId = null;
      break;
    case 'add':
      if (f) addMember(w, f, id);
      else {
        const created = newFormation(w, st.kind, id);
        if (created) st.formationId = created.id;
      }
      break;
    case 'remove':
      if (f) removeMember(w, f, id);
      break;
    case 'lead':
      if (f) setLeader(w, f, id);
      break;
    case 'up':
      if (f) moveMember(w, f, id, -1);
      break;
    case 'down':
      if (f) moveMember(w, f, id, 1);
      break;
    case 'dissolve':
      if (f) dissolveFormation(w, f);
      st.formationId = null;
      break;
    case 'show':
      app.el.dlgFormations.close();
      app.selectFormation(id);
      return;
    default:
      return;
  }
  app.dirtyPanels = true;
  render(app);
}

/** Opens the page, on a formation (`focus`) or on a new one of `kind`. */
export function openFormations(app, { focus = null, kind = null } = {}) {
  const w = app.world;
  const f = focus ? formationById(w, focus) : null;
  app.formationsPage = {
    kind: f ? f.kind : kind || (app.formationsPage && app.formationsPage.kind) || 'air',
    formationId: f ? f.id : null,
    filter: 'all',
  };
  const dlg = app.el.dlgFormations;
  render(app);
  if (!dlg.__wired) {
    dlg.__wired = true;
    dlg.addEventListener('click', (e) => onClick(app, e));
    // Enter in the name field renames; it must not close the page.
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-fm-name]')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    dlg.addEventListener('change', (e) => {
      const st = app.formationsPage;
      if (e.target.matches('[data-fm-filter]')) {
        st.filter = e.target.value;
        render(app);
      } else if (e.target.matches('[data-fm-name]')) {
        const f = formationById(app.world, st.formationId);
        if (f && renameFormation(app.world, f, e.target.value)) {
          app.dirtyPanels = true;
          render(app);
        }
      }
    });
  }
  showPage(app, dlg);
}
