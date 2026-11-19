// A line dropped where several targets overlap (C9 of the audit): raids one on another, a
// convoy and a U-boat marker… A small choice opens where the line ended, and the order goes
// to the target chosen. With one target, or none, the line is the route it always was.

import { escapeHtml, t } from '../core/i18n.js';
import { formatTime } from '../core/time.js';
import { finishDrawing, findUnit, orderHuntPlot, orderJoin } from './actions.js';
import { targetsUnder } from './hit.js';

const FROM_AIR = new Set(['raid']);
const FROM_SEA = new Set(['convoy', 'uplot']);

/** The targets a line drawn from `hit` could mean at (x, y): raids for aircraft, convoys and markers for an escort group. */
export function dropTargets(app, hit, x, y, pad = 8) {
  if (hit.kind === 'squadron' || hit.kind === 'airfield') return targetsUnder(app.hits, x, y, pad, FROM_AIR);
  if (hit.kind !== 'escort') return [];
  const group = findUnit(app, 'escort', hit.id);
  // (The convoy it sails with is no target: it is already there.)
  return targetsUnder(app.hits, x, y, pad, FROM_SEA).filter((x2) => !(x2.kind === 'convoy' && group && group.escorting === x2.id));
}

/** The words of one choice. */
export function targetLabel(world, target) {
  if (target.kind === 'raid') {
    const contact = world.contacts.get(target.id);
    return t('drop.raid', { raid: contact ? contact.label : target.id });
  }
  if (target.kind === 'convoy') {
    const c = world.convoys.find((x) => x.id === target.id);
    return t('drop.join', { convoy: c ? c.name : target.id });
  }
  const plot = world.uboatPlots.find((p) => p.id === target.id);
  return t('drop.hunt', { time: plot ? formatTime(world.startMs + plot.t * 1000) : '' });
}

export function closeDropChoice(app) {
  app.dropChoice = null;
  const el = app.el.dropChoice;
  if (el) el.hidden = true;
}

/** The order the choice gives. `target`: one of the targets, or null for the route alone. */
export function applyDropChoice(app, choice, target) {
  const { hit, points } = choice;
  if (!target) finishDrawing(app, hit, points, null);
  else if (target.kind === 'raid') finishDrawing(app, hit, points, { kind: 'raid', id: target.id });
  else {
    const group = findUnit(app, 'escort', hit.id);
    if (group && target.kind === 'convoy') orderJoin(app, group, target.id);
    else if (group) orderHuntPlot(app, group, target.id);
  }
  app.dirtyPanels = true;
}

/** Opens the choice at (x, y) on the map, for the line `points` drawn from `hit`. */
export function openDropChoice(app, hit, points, targets, x, y) {
  const el = app.el.dropChoice;
  app.dropChoice = { hit, points, targets };
  el.innerHTML = `
    <strong>${escapeHtml(t('drop.title'))}</strong>
    ${targets.map((target, i) => `<button type="button" role="menuitem" data-drop="${i}">${escapeHtml(targetLabel(app.world, target))}</button>`).join('')}
    <button type="button" role="menuitem" data-drop="route" class="secondary">${escapeHtml(t('drop.routeOnly'))}</button>
    <button type="button" data-drop="cancel" class="close" aria-label="${escapeHtml(t('drop.cancel'))}" title="${escapeHtml(t('drop.cancel'))}">×</button>`;
  el.hidden = false;
  // Beside the point, kept inside the map.
  const box = app.el.table.getBoundingClientRect();
  const w = el.offsetWidth || 220;
  const h = el.offsetHeight || 120;
  el.style.left = `${Math.max(6, Math.min(box.width - w - 6, x + 12))}px`;
  el.style.top = `${Math.max(6, Math.min(box.height - h - 6, y - 10))}px`;
}

export function attachDropChoice(app) {
  const el = app.el.dropChoice;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-drop]');
    const choice = app.dropChoice;
    if (!b || !choice) return;
    const which = b.dataset.drop;
    closeDropChoice(app);
    if (which === 'cancel') return;
    applyDropChoice(app, choice, which === 'route' ? null : choice.targets[Number(which)]);
  });
}
