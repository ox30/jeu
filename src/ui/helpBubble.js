// The bubble of a « ? »: a few sentences of help in front of everything, beside the mark
// that opened it, with a link to the rubric of the help that says more. One at a time. It
// closes on a click elsewhere, on Escape, on its cross, or when the mark is clicked again.
//
// The marks are written by commands.js (helpMark) wherever a section, a sub-title, a page or
// a setting has help: a button with data-help="<key>" (helpTopics.js).

import { escapeHtml, t } from '../core/i18n.js';
import { helpLink, helpText } from './helpTopics.js';

let shown = null; // { key, index, el, mark, root, selection }

/** The marks of a key in a page (a dialog) or in the whole document, in the order they stand. */
const marksOf = (root, key) => [...root.querySelectorAll(`.help-mark[data-help="${key}"]`)];

/**
 * The mark of the bubble as the page has it now: a sheet is drawn again several times a
 * second, and the button that was clicked is replaced by another of the same place.
 */
function liveMark() {
  if (!shown) return null;
  if (shown.mark.isConnected) return shown.mark;
  return marksOf(shown.root, shown.key)[shown.index] || null;
}

const selectionKey = (app) => (app.selection ? `${app.selection.kind}:${app.selection.id}` : '');

/** Closes the bubble; `focus` gives the keyboard back to its mark. */
export function closeBubble(focus = false) {
  if (!shown) return;
  const live = liveMark();
  const { el } = shown;
  shown = null;
  el.remove();
  if (live) {
    live.setAttribute('aria-expanded', 'false');
    if (focus) live.focus();
  }
}

/** Puts the bubble under its mark (above when there is no room), inside the window. */
function place(el, mark) {
  const r = mark.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const margin = 8;
  const left = Math.max(margin, Math.min(window.innerWidth - w - margin, r.left + r.width / 2 - w / 2));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - margin) top = Math.max(margin, r.top - h - 6);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function show(app, mark) {
  const key = mark.dataset.help;
  let args = {};
  try {
    args = mark.dataset.helpArgs ? JSON.parse(mark.dataset.helpArgs) : {};
  } catch {
    args = {};
  }
  const text = helpText(key, app.world ? app.world.settings : null, args);
  if (!text) return;
  const link = helpLink(key);
  const el = document.createElement('div');
  el.id = 'help-bubble';
  el.className = 'help-bubble';
  el.dataset.key = key;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('help.mark'));
  el.tabIndex = -1;
  el.innerHTML = `<button type="button" class="help-bubble-close" data-help-close title="${escapeHtml(t('help.bubbleClose'))}" aria-label="${escapeHtml(t('help.bubbleClose'))}">×</button>
    <p>${escapeHtml(text)}</p>
    ${link ? `<button type="button" class="link" data-help-link="${escapeHtml(`${link.tab}:${link.anchor}`)}">${escapeHtml(t('help.more', { name: link.name }))}</button>` : ''}`;
  // In front of everything: inside the page that holds the mark when it is a dialog (the top
  // layer of the browser), else on the body.
  const page = mark.closest('dialog[open]');
  (page || document.body).appendChild(el);
  place(el, mark);
  mark.setAttribute('aria-expanded', 'true');
  const root = page || document;
  shown = { key, index: marksOf(root, key).indexOf(mark), el, mark, root, selection: selectionKey(app) };
  el.focus({ preventScroll: true });
}

/**
 * After each drawing of the panels: a bubble does not outlive the unit it spoke of, nor the
 * section its « ? » stood in; and the « ? » drawn anew is the one of the open bubble.
 */
export function bubbleFollows(app) {
  if (!shown) return;
  if (!shown.el.closest('dialog') && shown.selection !== selectionKey(app)) {
    closeBubble();
    return;
  }
  const mark = liveMark();
  if (!mark) {
    closeBubble();
    return;
  }
  if (mark !== shown.mark) {
    shown.mark = mark;
    mark.setAttribute('aria-expanded', 'true');
  }
}

/** Listens for the marks, wherever they are. `openHelp(app, tab, anchor)` opens the help. */
export function installHelpBubble(app, openHelp) {
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const mark = target.closest('.help-mark');
    if (mark) {
      e.preventDefault(); // (in a <summary>: the section must not fold)
      e.stopPropagation();
      // (The same « ? » closes its bubble; another one — even of the same help, as the two
      // « Stock minimum » of an aerodrome — opens its own.)
      const again = liveMark() === mark;
      closeBubble();
      if (!again) show(app, mark);
      return;
    }
    if (!shown) return;
    const link = target.closest('[data-help-link]');
    if (link && shown.el.contains(link)) {
      e.preventDefault();
      e.stopPropagation();
      const [tab, anchor] = link.dataset.helpLink.split(':');
      closeBubble();
      openHelp(app, tab, anchor);
      return;
    }
    if (target.closest('[data-help-close]') || !shown.el.contains(target)) {
      const inside = shown.el.contains(target);
      closeBubble(inside);
      if (inside) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !shown) return;
    // A page opened over the bubble (a report of the watch that comes by itself): the bubble
    // leaves, and Escape is the page's.
    const page = document.querySelector('dialog[open]');
    if (page && !page.contains(shown.el)) {
      closeBubble();
      return;
    }
    e.preventDefault(); // (Escape closes the bubble only: not the sheet, not the page under it)
    e.stopPropagation();
    closeBubble(true);
  }, true);
  // (A page that Escape would have closed with its bubble open: the bubble goes first.)
  document.addEventListener('cancel', (e) => {
    if (!shown || !(e.target instanceof Element) || !e.target.contains(shown.el)) return;
    e.preventDefault();
    closeBubble(true);
  }, true);
  window.addEventListener('resize', () => closeBubble());
  // The sheet scrolls: the bubble stays by its « ? », and leaves with it when it goes out of view.
  document.addEventListener('scroll', (e) => {
    if (!shown || (e.target instanceof Node && shown.el.contains(e.target))) return;
    const mark = liveMark();
    const box = e.target instanceof Element ? e.target.getBoundingClientRect() : null;
    const r = mark ? mark.getBoundingClientRect() : null;
    if (!r || (box && (r.bottom < box.top || r.top > box.bottom))) closeBubble();
    else place(shown.el, mark);
  }, true);
}
