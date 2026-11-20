// Small helpers to build the panel's HTML.

import { escapeHtml } from '../core/i18n.js';

/** Replaces the content of an element only when it changed (keeps clicks and focus). */
export function setHtml(el, html) {
  if (el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}

export function row(label, value) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><b>${value}</b></div>`;
}

export function button(action, label, { id = '', kind = '', disabled = false, active = false, extra = '', cls = '' } = {}) {
  const classes = [active ? 'active' : '', cls].filter(Boolean).join(' ');
  return `<button type="button" data-action="${action}" data-id="${escapeHtml(id)}" data-kind="${kind}"${disabled ? ' disabled' : ''}${classes ? ` class="${classes}"` : ''}${extra}>${escapeHtml(label)}</button>`;
}

/** A tooltip, as the attribute of a tag: one line that says it all about a button or a field. */
export function tip(text) {
  return text ? ` title="${escapeHtml(text)}"` : '';
}

export function options(list, selected = null) {
  return list.map(({ value, label }) =>
    `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}
