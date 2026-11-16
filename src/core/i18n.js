// Translations. Every text shown to the player comes from data/i18n/<language>.json:
// t('log.airborne', { squadron: '32 Sqn' }) → "32 Sqn en l'air."

let dictionary = {};

export function setDictionary(dict) {
  dictionary = dict;
}

function lookup(key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionary);
}

export function t(key, params = {}) {
  const value = lookup(key);
  if (value === undefined) return key;
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
}

/** Fills elements carrying data-i18n (text), data-i18n-title and data-i18n-label. */
export function translatePage(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

/** Formats a number the French way (narrow no-break space for thousands). */
export function formatNumber(n, digits = 0) {
  return Number(n).toLocaleString('fr-CH', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
