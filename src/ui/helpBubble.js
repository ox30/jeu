// The bubble of a « ? »: a few sentences of help in front of everything, beside the mark
// that opened it, with a link to the rubric of the help that says more. One at a time. It
// closes on a click elsewhere, on Escape, on its cross, or when the mark is clicked again.
//
// The marks are written by commands.js (helpMark) wherever a section, a sub-title, a page or
// a setting has help: a button with data-help="<key>" (helpTopics.js).

import { escapeHtml, t } from '../core/i18n.js';
import { helpLink, helpText } from './helpTopics.js';

let shown = null; // { key, el, mark, selection }

const selectionKey = (app) => (app.selection ? `${app.selection.kind}:${app.selection.id}` : '');

/** The key of the bubble that is open, or null. */
export function openBubbleKey() {
  return shown ? shown.key : null;
}

/** Closes the bubble; `focus` gives the keyboard back to its mark. */
export function closeBubble(focus = false) {
  if (!shown) return;
  const { el, mark } = shown;
  shown = null;
  el.remove();
  const live = mark && mark.isConnected ? mark : document.querySelector(`.help-mark[data-help="${el.dataset.key}"]`);
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
  (mark.closest('dialog[open]') || document.body).appendChild(el);
  place(el, mark);
  mark.setAttribute('aria-expanded', 'true');
  shown = { key, el, mark, selection: selectionKey(app) };
  el.focus({ preventScroll: true });
}

/** After each drawing of the sheet: a bubble does not outlive the unit it spoke of. */
export function bubbleFollows(app) {
  if (shown && !shown.el.closest('dialog') && shown.selection !== selectionKey(app)) closeBubble();
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
      const again = shown && shown.key === mark.dataset.help;
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
    e.preventDefault(); // (Escape closes the bubble only: not the sheet, not the page under it)
    e.stopPropagation();
    closeBubble(true);
  }, true);
  // (A page that Escape would have closed with its bubble open: the bubble goes first.)
  document.addEventListener('cancel', (e) => {
    if (!shown) return;
    e.preventDefault();
    closeBubble(true);
  }, true);
  window.addEventListener('resize', () => closeBubble());
}
