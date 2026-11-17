// The command bar of a unit's sheet: its main orders as icons, always in view whatever the
// tab (take off, orbit, home, break off, standing orders, height, speed), and the sections of
// its « Commandes » tab, which the player opens or folds (remembered in the settings).

import { escapeHtml, formatNumber, t } from '../core/i18n.js';

const S = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;

/** Line icons drawn for the game (24 × 24, the colour of the text). */
export const ICONS = {
  takeoff: S('<path d="M3 20h18"/><path d="M5 15l13-7 2.5 1.5-12 8z"/><path d="M14 10.5l-4-5.5h-2l2.5 7"/>'),
  orbit: S('<path d="M19 12a7 7 0 1 1-2.6-5.4"/><path d="M17.5 3.5v3.6h-3.6"/>'),
  home: S('<path d="M3 11.5l9-7 9 7"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5.5h4V20"/>'),
  breakOff: S('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>'),
  defend: S('<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8-7.5 9.5-4.3-1.5-7.5-4.8-7.5-9.5V6z"/>'),
  attack: S('<path d="M5 4l11 11"/><path d="M19 4L8 15"/><path d="M5 17l2 2M3.5 19.5l3-3M19 17l-2 2M20.5 19.5l-3-3"/>'),
  pursue: S('<path d="M4 6l6 6-6 6"/><path d="M11 6l6 6-6 6"/><path d="M18 5v14"/>'),
  boost: S('<path d="M13.5 2.5L5 13.5h6.5l-1 8 8.5-11h-6.5z"/>'),
  up: S('<path d="M12 19V6"/><path d="M6.5 11.5L12 6l5.5 5.5"/>'),
  down: S('<path d="M12 5v13"/><path d="M6.5 12.5L12 18l5.5-5.5"/>'),
  sail: S('<circle cx="12" cy="5" r="2"/><path d="M12 7v13"/><path d="M8.5 10.5h7"/><path d="M5 13.5a7 7 0 0 0 14 0"/>'),
  port: S('<path d="M3 20h18"/><path d="M6 20v-6h12v6"/><path d="M9 14V8h6v6"/><path d="M12 8V4"/>'),
  stay: S('<circle cx="12" cy="7" r="2.5"/><circle cx="6.5" cy="16" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/><path d="M10.5 9l-2.5 4.5M13.5 9l2.5 4.5M9 16h6"/>'),
  hunt: S('<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>'),
  stop: S('<rect x="6.5" y="6.5" width="11" height="11" rx="1"/>'),
  zigzag: S('<path d="M8 3l8 4.5-8 4.5 8 4.5-8 4.5"/>'),
  route: S('<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  wing: S('<path d="M12 4l2 4h-4z"/><path d="M6 12l2 4H4z"/><path d="M18 12l2 4h-4z"/><path d="M12 8v2M8 14l2-2M16 14l-2-2"/>'),
};

/** A square button with its icon and a short word under it; the full text in its tooltip. */
export function cmdButton(action, icon, word, { id = '', kind = '', title = '', active = false, disabled = false, extra = '', danger = false } = {}) {
  const cls = ['cmd', active ? 'active' : '', danger ? 'danger' : ''].filter(Boolean).join(' ');
  const tip = title || word;
  return `<button type="button" class="${cls}" data-action="${action}" data-id="${escapeHtml(id)}" data-kind="${kind}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"${disabled ? ' disabled' : ''}${extra}>${ICONS[icon] || ''}<span>${escapeHtml(word)}</span></button>`;
}

/** A group of command buttons under a small caption. */
export function cmdGroup(caption, html, cls = '') {
  if (!html) return '';
  return `<div class="cmd-group${cls ? ` ${cls}` : ''}"><div class="cmd-caption">${escapeHtml(caption)}</div><div class="cmd-row">${html}</div></div>`;
}

/**
 * Speed: a slider from `min` to 100 % and a boost button. `boost`: the boost's speed as a share
 * of the 100 % (e.g. 131), or null when the unit has none.
 */
export function speedControl(u, kind, { min, pct, boostOn, boost, unitText }) {
  const id = `speed-${u.id}`;
  return `<div class="cmd-group speed"><div class="cmd-caption">${escapeHtml(t('cmd.speed'))}</div>
    <div class="cmd-row"><input type="range" id="${escapeHtml(id)}" min="${min}" max="100" step="5" value="${boostOn ? 100 : pct}" data-change="speed-pct" data-id="${escapeHtml(u.id)}" data-kind="${kind}"${boostOn ? ' class="off"' : ''} aria-label="${escapeHtml(t('cmd.speed'))}">
    <b class="speed-value">${escapeHtml(boostOn ? t('cmd.boostOn', { p: boost }) : `${pct} %`)}</b>
    ${boost ? `<button type="button" class="cmd small${boostOn ? ' active' : ''}" data-action="boost" data-id="${escapeHtml(u.id)}" data-kind="${kind}" title="${escapeHtml(t('cmd.boostTitle', { p: boost }))}">${ICONS.boost}<span>${escapeHtml(t('cmd.boost', { p: boost }))}</span></button>` : ''}</div>
    ${unitText ? `<div class="speed-text">${escapeHtml(unitText)}</div>` : ''}</div>`;
}

/** Height: − 15 000 ft + */
export function altitudeControl(u, kind, text) {
  return `<div class="cmd-group alt"><div class="cmd-caption">${escapeHtml(t('cmd.altitude'))}</div><div class="cmd-row">
    <button type="button" class="cmd small" data-action="alt-down" data-id="${escapeHtml(u.id)}" data-kind="${kind}" title="${escapeHtml(t('cmd.altDown'))}">${ICONS.down}</button>
    <b class="alt-value">${escapeHtml(text)}</b>
    <button type="button" class="cmd small" data-action="alt-up" data-id="${escapeHtml(u.id)}" data-kind="${kind}" title="${escapeHtml(t('cmd.altUp'))}">${ICONS.up}</button></div></div>`;
}

/** Whether a section of the Commandes tab is open (the player's choice, or its default). */
export function sectionOpen(app, id, dflt = true) {
  const mine = app.settings.sections && app.settings.sections[id];
  return mine === undefined ? dflt : Boolean(mine);
}

/** A section of the Commandes tab, folded or open as the player left it. */
export function section(app, id, title, body, dflt = true) {
  if (!body) return '';
  return `<details class="sec" data-sec="${id}"${sectionOpen(app, id, dflt) ? ' open' : ''}><summary>${escapeHtml(title)}</summary><div class="sec-body">${body}</div></details>`;
}

/** km/h of a speed in km/s, rounded for reading. */
export function kmhText(kms) {
  return t('cmd.kmh', { n: formatNumber(Math.round(kms * 3600 / 5) * 5) });
}
