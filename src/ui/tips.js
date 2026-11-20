// The tips of a first time (2.11.0): five at most, each shown once, in a small card at the
// corner of the map — never in front of a sheet, never during a lesson. A tip comes when its
// occasion does (the first sheet of a unit that moves, the first point chosen on a route, the
// first escort group in port, the first ship under radio silence, the first departure
// scheduled), stays until « Compris », and the browser remembers it. « Revoir les astuces »,
// in the settings, shows them again.

import { escapeHtml, t } from '../core/i18n.js';
import { isSilent, orderChannel } from '../sim/comms.js';
import { activePoint, selectedUnit } from './actions.js';

const KEY = 'jeu-1940.tips.v1';
/** (Until 2.10 the only tip, on a scheduled departure, had a key of its own.) */
const OLD_SCHEDULE_KEY = 'jeu-1940.scheduleHint.v1';
/** Nothing new for a while after « Compris »: one tip at a time, and not one upon the other. */
const QUIET_MS = 20000;

/** The unit a tip speaks of: the one in hand, or the leader of the formation in hand. */
const unitInHand = (app) => selectedUnit(app);

const AT_SEA = new Set(['atSea', 'waiting', 'escorting', 'hunting']);

/**
 * The tips, first the one that takes the card when several occasions meet. `when`: its
 * occasion; `link`: the rubric of the help that says more; `text`: which of its texts fits.
 */
export const TIPS = {
  // Asked for by an order (panelActions.js): something was scheduled.
  schedule: { link: ['air', 'programmer'], when: (app) => app.tips.asked.has('schedule') },
  point: {
    link: ['sheet', 'traces'],
    when: (app) => Boolean(activePoint(app)),
    text: (app) => (activePoint(app).u.kind === 'squadron' ? 'text' : 'textSea'),
  },
  silence: {
    link: ['sea', 'silence'],
    when: (app) => {
      const u = unitInHand(app);
      return Boolean(u) && (u.kind === 'convoy' || u.kind === 'escort') && AT_SEA.has(u.state) && isSilent(app.world) && orderChannel(app.world, u) === 'radio';
    },
  },
  exit: {
    link: ['sea', 'appareiller'],
    when: (app) => {
      const u = unitInHand(app);
      const port = u && u.kind === 'escort' && u.state === 'inPort' ? app.world.byId.port.get(u.portId) : null;
      return Boolean(port && port.approaches && port.approaches.length);
    },
  },
  sheet: {
    link: ['sheet', 'traces'],
    when: (app) => {
      const u = unitInHand(app);
      return Boolean(u) && (u.kind === 'squadron' || u.kind === 'convoy' || u.kind === 'escort') && u.state !== 'lost';
    },
    text: (app) => (app.world.settings.orders === 'headings' ? 'textHeadings' : 'text'),
  },
};

export const TIP_NAMES = Object.keys(TIPS);

/** The tips this browser has already shown, as it remembers them. */
export function loadTips(storage = globalThis.localStorage) {
  const seen = new Set();
  try {
    const kept = JSON.parse(storage.getItem(KEY) || '[]');
    if (Array.isArray(kept)) for (const id of kept) seen.add(String(id));
    if (storage.getItem(OLD_SCHEDULE_KEY) === '1') seen.add('schedule');
  } catch {
    // no storage: the tips are shown once in this visit
  }
  return { seen, shown: null, text: 'text', asked: new Set(), quietUntil: 0 };
}

function save(app, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify([...app.tips.seen]));
  } catch {
    // ignore
  }
}

/**
 * The word of the right panel on how to open a sheet (« Cliquez sur une unité… »): only until
 * a first sheet has been opened in this browser. It is no tip of the card: kept with them.
 */
export function panelHintDue(app) {
  return Boolean(app.tips) && !app.tips.seen.has('panel');
}

/** A sheet is open by the player's hand (a lesson opens its own): the word has done its work. */
export function sheetOpened(app) {
  if (!app.tips || app.tutorial || app.onMenu || app.tips.seen.has('panel')) return;
  app.tips.seen.add('panel');
  save(app);
}

/** An occasion that an order makes, not a state of the game: « schedule ». */
export function tipOccasion(app, id) {
  if (app.tips && !app.tips.seen.has(id)) app.tips.asked.add(id);
}

/** May the card show a tip now? Not on the menu, and never during a lesson. */
function allowed(app) {
  return !app.onMenu && !app.tutorial;
}

/** The tip whose occasion is here, the first of the list; null when there is none to show. */
export function tipDue(app) {
  if (!allowed(app)) return null;
  return TIP_NAMES.find((id) => !app.tips.seen.has(id) && TIPS[id].when(app)) || null;
}

function render(app) {
  const el = app.el.tip;
  if (!el) return;
  const id = allowed(app) ? app.tips.shown : null;
  const key = id ? `${id}:${app.tips.text}` : '';
  if (el.dataset.tip === key && el.hidden === !id) return;
  el.dataset.tip = key;
  el.hidden = !id;
  if (!id) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<b>${escapeHtml(t(`firstTips.${id}.title`))}</b>
    <p>${escapeHtml(t(`firstTips.${id}.${app.tips.text}`))}</p>
    <div class="tip-buttons"><button type="button" class="link" data-tip="more">${escapeHtml(t('firstTips.more'))}</button>
    <button type="button" data-tip="seen">${escapeHtml(t('firstTips.understood'))}</button></div>`;
}

/** Called with every image: a tip takes the card when its occasion comes and the card is free. */
export function updateTips(app, now = performance.now()) {
  const tips = app.tips;
  if (!tips) return;
  // A lesson begins, or the menu comes: the tip on the screen leaves, not counted as seen; it
  // will come back with its occasion.
  if (!allowed(app)) tips.shown = null;
  if (!tips.shown && now >= tips.quietUntil) {
    const id = tipDue(app);
    if (id) {
      tips.shown = id;
      tips.text = TIPS[id].text ? TIPS[id].text(app) : 'text';
    }
  }
  render(app);
}

/** « Compris »: this tip is not shown again. */
export function dismissTip(app, now = performance.now()) {
  const tips = app.tips;
  if (!tips.shown) return;
  tips.seen.add(tips.shown);
  tips.asked.delete(tips.shown);
  tips.shown = null;
  tips.quietUntil = now + QUIET_MS;
  save(app);
  render(app);
}

/** « Revoir les astuces » (settings): each comes back at its next occasion. */
export function resetTips(app) {
  app.tips.seen.clear();
  app.tips.shown = null;
  app.tips.quietUntil = 0;
  save(app);
  try {
    localStorage.removeItem(OLD_SCHEDULE_KEY);
  } catch {
    // ignore
  }
  render(app);
}

export function attachTips(app, openHelp) {
  app.tips = loadTips();
  if (!app.el.tip) return;
  app.el.tip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tip]');
    if (!b || !app.tips.shown) return;
    if (b.dataset.tip === 'seen') dismissTip(app);
    else openHelp(app, ...TIPS[app.tips.shown].link);
  });
}
