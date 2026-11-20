// Dialogs: settings, help, success and end of the scenario.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { objectiveText, realDurationText } from './format.js';
import { endSummaryKeys } from './summary.js';
import { checkDevPassword } from './dev.js';
import { markHelpSeen, saveSettings } from '../save/settings.js';
import { GAME_SETTING_KEYS, applyPreset, canSetGameSetting, matchingPreset, setGameSetting } from '../sim/gameSettings.js';
import { showPage } from './pages.js';
import { fighterCount } from '../sim/objectives.js';
import { presetStory } from '../sim/gameSettings.js';
import { ALERT_GROUPS, defaultAlertSpeed } from './alertRules.js';
import { setVolume } from './sound.js';

function select(name, value, choices, labelKey) {
  const options = choices.map((c) =>
    `<option value="${c}"${c === value ? ' selected' : ''}>${escapeHtml(t(`${labelKey}.${c}`))}</option>`).join('');
  return `<select name="${name}">${options}</select>`;
}

function checkbox(name, checked, label) {
  return `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
}

/** Speeds an alert can bring the game down to: the default, none, or one of the speeds. */
const ALERT_SPEED_CHOICES = ['', '0', '1', '10', '60', '600'];

function alertSpeedTable(app) {
  const s = app.settings;
  const row = (type) => {
    const names = t('settings.alertNames');
    const label = (names && typeof names === 'object' && names[type]) || t(`alerts.${type}.title`);
    const own = s.alertSpeeds && s.alertSpeeds[type] !== undefined && s.alertSpeeds[type] !== null ? String(s.alertSpeeds[type]) : '';
    const options = ALERT_SPEED_CHOICES.map((c) => {
      const text = c === '' ? t('settings.speedDefault', { speed: speedWord(defaultAlertSpeed(type)) }) : speedWord(Number(c));
      return `<option value="${c}"${c === own ? ' selected' : ''}>${escapeHtml(text)}</option>`;
    }).join('');
    return `<tr><td>${escapeHtml(label)}</td><td><select name="alertSpeed:${type}">${options}</select></td></tr>`;
  };
  return ALERT_GROUPS.map((g) => `<tr class="group"><th colspan="2">${escapeHtml(t(`settings.alertGroups.${g.id}`))}</th></tr>${Object.keys(g.speeds).map(row).join('')}`).join('');
}

function speedWord(v) {
  return v ? `×${formatNumber(v)}` : t('settings.speedNone');
}

const SETTINGS_TABS = ['game', 'time', 'map', 'sound', 'dev'];

/**
 * The settings page. `scope` says whose game settings it shows: 'game', those of the game
 * under way (changed by an order, kept with the game), or 'defaults', the player's own, which
 * the next games begin with. The display settings are the player's in both.
 */
export function openSettings(app, { scope = 'game' } = {}) {
  const dlg = app.el.dlgSettings;
  const inGame = scope === 'game';
  const mine = app.settings;
  // `s` gives every value of the page: the game's own for what belongs to it, the player's
  // for the rest.
  const s = inGame ? { ...mine, ...app.world.settings } : mine;
  const presets = app.data.presets;
  const presetChoices = [...Object.keys(presets.presets), 'custom'];
  const tab = SETTINGS_TABS.includes(app.settingsTab) ? app.settingsTab : 'game';
  const pane = (id, html) => `<section class="settings-pane" data-spane="${id}"${id === tab ? '' : ' hidden'}>${html}</section>`;
  dlg.innerHTML = `
    <form method="dialog" class="settings">
      <h2>${escapeHtml(t('settings.title'))}</h2>
      <nav class="settings-tabs" role="tablist">${SETTINGS_TABS.map((id) => `<button type="button" role="tab" data-stab="${id}" class="${id === tab ? 'active' : ''}">${escapeHtml(t(`settings.tabs.${id}`))}</button>`).join('')}</nav>
      ${pane('game', `
      <p class="hint settings-scope">${escapeHtml(t(inGame ? 'settings.scopeGame' : 'settings.scopeDefaults'))}</p>
      <label>${escapeHtml(t('settings.preset'))} ${select('preset', inGame ? app.world.settings.preset : matchingPreset(s, presets), presetChoices, 'settings.presets')}</label>
      <fieldset>
        <label>${escapeHtml(t('settings.detection'))} ${select('detection', s.detection, presets.choices.detection, 'settings.detectionChoices')}</label>
        ${checkbox('falseAlarms', s.falseAlarms, t('settings.falseAlarms'))}
        ${checkbox('pagesPause', s.pagesPause, t('settings.pagesPause'))}
        <label>${escapeHtml(t('settings.interceptAid'))} ${select('interceptAid', s.interceptAid, presets.choices.interceptAid, 'settings.interceptAidChoices')}</label>
        <label>${escapeHtml(t('settings.fuel'))} ${select('fuel', s.fuel, presets.choices.fuel, 'settings.fuelChoices')}</label>
        <label>${escapeHtml(t('settings.orders'))} ${select('orders', s.orders, presets.choices.orders, 'settings.ordersChoices')}</label>
        <label>${escapeHtml(t('settings.logistics'))} ${select('logistics', s.logistics, presets.choices.logistics, 'settings.logisticsChoices')}</label>
        <label>${escapeHtml(t('settings.fatigue'))} ${select('fatigue', s.fatigue, presets.choices.fatigue, 'settings.fatigueChoices')}</label>
        <label>${escapeHtml(t('settings.rosterHours'))} ${select('rosterHours', String(s.rosterHours || '24'), presets.choices.rosterHours, 'settings.rosterHoursChoices')}</label>
        <label>${escapeHtml(t('settings.carry'))} ${select('carry', s.carry || 'none', presets.choices.carry, 'settings.carryChoices')}</label>
        <label>${escapeHtml(t('settings.bdienst'))} ${select('bdienst', String(s.bdienst ?? '25'), presets.choices.bdienst, 'settings.bdienstChoices')}</label>
        <label>${escapeHtml(t('settings.seaComms'))} ${select('seaComms', s.seaComms || 'direct', presets.choices.seaComms, 'settings.seaCommsChoices')}</label>
        <p class="hint">${escapeHtml(t('settings.seaCommsHint'))}</p>
      </fieldset>`)}
      ${pane('time', `
      <fieldset>
        ${checkbox('slowOnAlert', s.slowOnAlert, t('settings.slowOnAlert'))}
        ${checkbox('confirmSpeed', s.confirmSpeed !== false, t('settings.confirmSpeed'))}
        ${checkbox('questions', s.questions !== false, t('settings.questions'))}
        <label>${escapeHtml(t('settings.watchStops'))} ${select('watchStops', s.watchStops || 'decision', presets.choices.watchStops, 'settings.watchStopsChoices')}</label>
        <p class="hint">${escapeHtml(t('settings.watchStopsHint'))}</p>
      </fieldset>
      <p class="hint">${escapeHtml(t('settings.alertSpeedsHint'))}</p>
      <table class="alert-speeds">${alertSpeedTable(app)}</table>`)}
      ${pane('map', `
      <fieldset>
        ${checkbox('altitudeStalks', s.altitudeStalks, t('settings.altitudeStalks'))}
        ${app.world.grid ? checkbox('grid', s.grid, t('settings.grid')) : ''}
        ${checkbox('nightShadow', s.nightShadow !== false, t('settings.nightShadow'))}
        ${checkbox('patrolZones', s.patrolZones !== false, t('settings.patrolZones'))}
        ${checkbox('autoZoom', s.autoZoom, t('settings.autoZoom'))}
        ${checkbox('lowRes', s.lowRes, t('settings.lowRes'))}
        <label>${escapeHtml(t('settings.sheetPos'))} ${select('sheetPos', s.sheetPos || 'right', presets.choices.sheetPos, 'settings.sheetPosChoices')}</label>
        <p class="hint">${escapeHtml(t('settings.sheetHint'))}</p>
        <label>${escapeHtml(t('settings.sheetHelp'))} ${select('sheetHelp', s.sheetHelp === 'shown' ? 'shown' : 'folded', presets.choices.sheetHelp, 'settings.sheetHelpChoices')}</label>
        <p class="hint">${escapeHtml(t('settings.sheetHelpHint'))}</p>
        <label>${escapeHtml(t('settings.viewZones'))} ${select('viewZones', s.viewZones || 'selected', presets.choices.viewZones, 'settings.viewZonesChoices')}</label>
        <p class="hint">${escapeHtml(t('settings.viewZonesHint'))}</p>
      </fieldset>`)}
      ${pane('sound', `
      <fieldset>
        ${checkbox('sound', s.sound, t('settings.sound'))}
        <label>${escapeHtml(t('settings.volume'))} <input type="range" name="volume" min="0" max="100" step="5" value="${Number(s.volume ?? 80)}"></label>
      </fieldset>`)}
      ${pane('dev', `
      <fieldset class="dev-settings">
        <label class="check"><input type="checkbox" data-dev="toggle"${app.dev ? ' checked' : ''}> ${escapeHtml(t('settings.devMode'))}</label>
        <div class="dev-password" hidden>
          <input type="password" data-dev="password" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t('settings.devPassword'))}" aria-label="${escapeHtml(t('settings.devPassword'))}">
          <button type="button" data-dev="ok">${escapeHtml(t('settings.devOk'))}</button>
          <button type="button" data-dev="cancel" class="secondary">${escapeHtml(t('settings.devCancel'))}</button>
          <span class="dev-error" role="alert" hidden></span>
        </div>
        <p class="hint">${escapeHtml(t('settings.devHint'))}</p>
      </fieldset>`)}
      <p class="hint">${escapeHtml(t('settings.note'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('settings.close'))}</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  devSettings(app, form);
  // The tabs: one pane at a time; the one last opened comes back next time.
  form.querySelector('.settings-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stab]');
    if (!b) return;
    app.settingsTab = b.dataset.stab;
    for (const x of form.querySelectorAll('[data-stab]')) x.classList.toggle('active', x === b);
    for (const p of form.querySelectorAll('[data-spane]')) p.hidden = p.dataset.spane !== b.dataset.stab;
  });
  // What belongs to the game: its preset and its settings. Fixed ones (the carry-over of the
  // campaign) cannot be changed once the game is under way.
  if (inGame) {
    for (const k of GAME_SETTING_KEYS) {
      const field = form.elements[k];
      if (field && !canSetGameSetting(app.world, k, field.type === 'checkbox' ? field.checked : field.value, presets)) field.disabled = true;
    }
  }
  form.addEventListener('change', (e) => {
    const field = e.target;
    if (field.dataset.dev) return; // developer mode: devSettings()
    const ofGame = field.name === 'preset' || GAME_SETTING_KEYS.includes(field.name);
    if (ofGame && inGame) {
      // The game under way: by an order, which the journal keeps.
      const value = field.type === 'checkbox' ? field.checked : field.value;
      if (field.name === 'preset') {
        if (value !== 'custom') applyPreset(app.world, value, presets);
      } else setGameSetting(app.world, field.name, value, presets);
      Object.assign(s, app.world.settings);
      app.save();
    } else {
      const own = mine;
      if (field.name.startsWith('alertSpeed:')) {
        const type = field.name.slice('alertSpeed:'.length);
        own.alertSpeeds = { ...(own.alertSpeeds || {}) };
        if (field.value === '') delete own.alertSpeeds[type];
        else own.alertSpeeds[type] = Number(field.value);
      } else if (field.name === 'preset') {
        if (field.value !== 'custom') Object.assign(own, presets.presets[field.value]);
      } else if (field.type === 'checkbox') {
        own[field.name] = field.checked;
      } else if (field.type === 'range') {
        own[field.name] = Number(field.value);
      } else {
        own[field.name] = field.value;
      }
      // (A choice made, kept from now on: settings.js, the default of 2.11.0.)
      if (field.name === 'sheetHelp') own.sheetHelpChosen = true;
      own.preset = matchingPreset(own, presets);
      saveSettings(own);
      if (!inGame) Object.assign(s, own);
      else for (const k of Object.keys(own)) if (!(k in app.world.settings)) s[k] = own[k];
    }
    if (field.name === 'volume') setVolume(app);
    if (field.name === 'lowRes' && app.resize) app.resize();
    if (field.name === 'sheetPos' && app.applySheet) app.applySheet();
    if (field.name === 'orders' || field.name === 'preset') {
      app.drawing = null;
      app.el.unitKeyed.__key = '';
    }
    // (The help of the sheet is written in it, or not: the sheet is drawn again.)
    if (field.name === 'sheetHelp') app.el.unitKeyed.__key = '';
    app.dirtyPanels = true;
    app.dirtyHud = true;
    openSettings.refresh(form, s, presets);
  });
  // The volume follows the slider while it moves.
  form.elements.volume.addEventListener('input', (e) => {
    mine.volume = Number(e.target.value);
    setVolume(app);
  });
  showPage(app, dlg);
}

/**
 * The developer mode box: ticking it asks the password (data/dev.json keeps its SHA-256);
 * unticking it switches the mode off at once.
 */
function devSettings(app, form) {
  const box = form.querySelector('[data-dev="toggle"]');
  const area = form.querySelector('.dev-password');
  const input = form.querySelector('[data-dev="password"]');
  const error = form.querySelector('.dev-error');
  const close = () => {
    area.hidden = true;
    error.hidden = true;
    input.value = '';
  };
  const fail = (key) => {
    error.textContent = t(key);
    error.hidden = false;
    input.select();
  };
  const check = async () => {
    const ok = await checkDevPassword(input.value, app.data.dev && app.data.dev.passwordSha256);
    if (ok === null) {
      fail('settings.devUnavailable');
      return;
    }
    if (!ok) {
      fail('settings.devWrong');
      return;
    }
    close();
    box.checked = true;
    app.setDev(true);
  };
  box.addEventListener('change', () => {
    if (!box.checked) {
      close();
      app.setDev(false);
      return;
    }
    if (app.dev) return;
    area.hidden = false;
    error.hidden = true;
    input.focus();
  });
  form.querySelector('[data-dev="ok"]').addEventListener('click', check);
  form.querySelector('[data-dev="cancel"]').addEventListener('click', () => {
    close();
    box.checked = false;
  });
  // Enter checks the password instead of closing the dialog.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      check();
    }
  });
}

// Keeps the form in step after a preset change.
openSettings.refresh = (form, s, presets) => {
  form.elements.preset.value = s.preset && [...form.elements.preset.options].some((o) => o.value === s.preset) ? s.preset : matchingPreset(s, presets);
  form.elements.detection.value = s.detection;
  form.elements.interceptAid.value = s.interceptAid;
  form.elements.fuel.value = s.fuel;
  form.elements.orders.value = s.orders;
  form.elements.logistics.value = s.logistics;
  form.elements.fatigue.value = s.fatigue;
  form.elements.carry.value = s.carry || 'none';
  form.elements.bdienst.value = String(s.bdienst ?? '25');
  form.elements.falseAlarms.checked = s.falseAlarms;
  form.elements.pagesPause.checked = s.pagesPause;
  form.elements.seaComms.value = s.seaComms || 'direct';
};

/** The steps of the help, for the scenario being played. */
function helpSteps(app) {
  const own = t(`help.scenario.${app.world.scenario.id}`);
  if (Array.isArray(own)) return own;
  return t(app.world.rail.enabled ? 'help.steps' : 'help.stepsTraining');
}

export const HELP_TABS = ['scenario', 'sheet', 'air', 'sea', 'time', 'games', 'keys'];

/** A picture from the test bench, beside the text it illustrates (data/help/images.json). */
function helpImage(app, name) {
  const src = app.data.helpImages && app.data.helpImages[name];
  return src ? `<figure class="help-image"><img src="${src}" alt="${escapeHtml(t(`help.images.${name}`))}"><figcaption>${escapeHtml(t(`help.images.${name}`))}</figcaption></figure>` : '';
}

/**
 * The help, in tabs: this scenario, the sheet, the air, the sea, time and alerts, games and
 * settings, the keys. `wantTab` and `anchor`: the tab and the rubric to open on (the link of
 * a « ? » bubble); else the tab last read.
 */
export function openHelp(app, wantTab = null, anchor = null) {
  const dlg = app.el.dlgHelp;
  // From the main menu with no game in hand there is no « this scenario » to speak of: the
  // help opens on the games and their settings.
  const noGame = Boolean(app.onMenu) && !(app.gameInProgress && app.gameInProgress());
  const tabs = noGame ? HELP_TABS.filter((id) => id !== 'scenario') : HELP_TABS;
  if (wantTab && tabs.includes(wantTab)) app.helpTab = wantTab;
  const tab = tabs.includes(app.helpTab) ? app.helpTab : noGame ? 'games' : 'scenario';
  const list = (items) => `<ol>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`;
  const bodies = {
    scenario: list(helpSteps(app)),
    sheet: `${helpImage(app, 'sheet')}${list(t('help.sheet'))}`,
    air: `${list(t('help.air'))}${helpImage(app, 'roster')}`,
    sea: `${helpImage(app, 'escort')}${list(t('help.sea'))}`,
    time: list(t('help.time')),
    games: list(t('help.games')),
    keys: `<p class="keys">${escapeHtml(t('help.keys'))}</p>`,
  };
  dlg.innerHTML = `
    <form method="dialog" class="help-page">
      <h2>${escapeHtml(t('help.title'))}</h2>
      <nav class="settings-tabs" role="tablist">${tabs.map((id) => `<button type="button" role="tab" data-htab="${id}" class="${id === tab ? 'active' : ''}">${escapeHtml(t(`help.tabs.${id}`))}</button>`).join('')}</nav>
      ${tabs.map((id) => `<section class="help-pane" data-hpane="${id}"${id === tab ? '' : ' hidden'}>${bodies[id]}</section>`).join('')}
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('help.close'))}</button></div>
    </form>`;
  dlg.querySelector('.settings-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-htab]');
    if (!b) return;
    app.helpTab = b.dataset.htab;
    for (const x of dlg.querySelectorAll('[data-htab]')) x.classList.toggle('active', x === b);
    for (const p of dlg.querySelectorAll('[data-hpane]')) p.hidden = p.dataset.hpane !== b.dataset.htab;
  });
  dlg.addEventListener('close', markHelpSeen, { once: true });
  showPage(app, dlg);
  // The rubric asked for: in view, and marked for a moment.
  const target = anchor ? dlg.querySelector(`[data-hpane="${tab}"] [data-anchor="${anchor}"]`) : null;
  if (target) {
    target.classList.add('help-target');
    target.scrollIntoView({ block: 'start' });
  }
}

export function openSuccess(app) {
  const dlg = app.el.dlgSuccess;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('success.title'))}</h2>
      <p>${escapeHtml(t('success.text'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('success.close'))}</button></div>
    </form>`;
  showPage(app, dlg);
}

export function openEnd(app) {
  const dlg = app.el.dlgEnd;
  const w = app.world;
  const st = w.stats;
  const story = presetStory(w);
  const next = app.nextScenario ? app.nextScenario() : null;
  // The figures of each line; the lines themselves follow the scenario (summary.js).
  const figures = {
    unloaded: { fuel: formatNumber(Math.round(st.unloaded.fuel)), materiel: formatNumber(Math.round(st.unloaded.materiel)) },
    aircraftBuilt: { n: st.aircraftBuilt, m: st.aircraftDelivered },
    fuelUsed: { n: formatNumber(Math.round(st.fuelUsed)) },
    ammoUsed: { n: formatNumber(Math.round(st.ammoUsed)) },
    dollars: w.currency ? { n: formatNumber(Math.round(w.currency.spent)), m: formatNumber(w.currency.start) } : {},
  };
  const lines = endSummaryKeys(w).map((k) => `<li>${escapeHtml(t(`end.${k}`, figures[k] || { n: st[k] }))}</li>`);
  // The real time spent on this game, pauses included.
  const clock = app.playClock;
  const played = clock && clock.totalMs >= 1000
    ? `<p class="end-clock">${escapeHtml(t('end.played', { total: realDurationText(clock.totalMs), paused: realDurationText(clock.pausedMs) }))}</p>` : '';
  let verdict;
  if (w.defeatReason === 'fuel') verdict = t('end.defeatFuel');
  else if (w.defeatReason === 'fighters') verdict = t('end.defeatFighters');
  else if (w.defeatReason === 'shipping') verdict = t('end.defeatShipping');
  else if (w.scenario.defeat) verdict = w.outcome === 'victory' ? t('end.victory') : t('end.defeat');
  else verdict = w.allDone ? t('end.success') : t('end.failure');
  const objectives = w.objectives.map((o) =>
    `<li class="${o.done ? 'done' : 'failed'}">${o.done ? '✓' : '✗'} ${escapeHtml(objectiveText(w, o))}</li>`).join('');
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('end.title'))}</h2>
      <p class="verdict ${w.outcome === 'victory' || (!w.scenario.defeat && w.allDone) ? 'won' : 'lost'}"><b>${escapeHtml(verdict)}</b></p>
      ${app.unlocked ? `<p class="unlocked">${escapeHtml(t('campaign.unlocked', { title: t(`scenarios.${app.unlocked}.title`) }))}</p>` : ''}
      ${objectives ? `<h3>${escapeHtml(t('end.objectives'))}</h3><ul class="end-objectives">${objectives}</ul>` : ''}
      <ul>${lines.join('')}</ul>
      ${played}
      <p class="end-preset">${escapeHtml(story.changed
    ? t('menu.presetChanged', { start: t(`settings.presets.${story.start}`), end: t(`settings.presets.${story.end}`) })
    : t('menu.presetStory', { preset: t(`settings.presets.${story.end}`) }))}</p>
      <div class="dialog-buttons">
        <button type="button" data-end="replay">${escapeHtml(t('end.replay'))}</button>
        ${next ? `<button type="button" data-end="next">${escapeHtml(t('menu.next', { title: t(`scenarios.${next}.title`) }))}</button>` : ''}
        <button type="button" data-end="menu">${escapeHtml(t('menu.main'))}</button>
        <button value="close" class="secondary">${escapeHtml(t('end.close'))}</button>
      </div>
    </form>`;
  // Rejouer, the next scenario of the campaign when a victory has opened it, or the main menu.
  dlg.querySelector('.dialog-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-end]');
    if (!b) return;
    dlg.close();
    if (b.dataset.end === 'replay') app.restart();
    else if (b.dataset.end === 'next') app.restart(next);
    else app.toMainMenu();
  });
  dlg.showModal();
}

/**
 * The scenario of a lesson has ended before the lesson did (its hours ran out, or the little
 * battle was lost): no verdict and no objectives, which are not the pupil's business here —
 * the lesson again with its instructor, or the list of the lessons.
 */
export function openLessonOver(app) {
  const dlg = app.el.dlgEnd;
  const name = app.tutorial ? t(`tutorial.lessons.${app.tutorial.lesson}.name`) : '';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('tutorial.over.title'))}</h2>
      <p>${escapeHtml(t('tutorial.over.text', { lesson: name }))}</p>
      <div class="dialog-buttons">
        <button type="button" data-end="again">${escapeHtml(t('tutorial.over.again'))}</button>
        <button type="button" data-end="quit" class="secondary">${escapeHtml(t('tutorial.quit'))}</button>
      </div>
    </form>`;
  dlg.querySelector('.dialog-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-end]');
    if (!b) return;
    dlg.close();
    if (b.dataset.end === 'again') app.restart(null, { tutorial: true });
    else app.onTutorialQuit();
  });
  // (Escape leaves the dialog: the lesson is then left, as its ended world cannot go on.)
  dlg.oncancel = () => setTimeout(() => app.tutorial && app.world.ended && app.onTutorialQuit(), 0);
  dlg.showModal();
}

/** Shown once on a small or touch-only screen: the game is made for a computer. */
export function openDesktopNotice(app) {
  const dlg = app.el.dlgDesktop;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('desktop.title'))}</h2>
      <p>${escapeHtml(t('desktop.text'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('desktop.continue'))}</button></div>
    </form>`;
  dlg.showModal();
}

/** A dated event of the scenario worth stopping for (Adlertag, London, Lend-Lease...). */
export function openEvent(app, e) {
  const dlg = app.el.dlgEvent;
  const base = `events.${e.scenario}.${e.key}`;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t(`${base}.title`))}</h2>
      <p>${escapeHtml(t(`${base}.text`))}</p>
      ${e.key === 'intro' ? carryNote(app.world) : ''}
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('events.ok'))}</button></div>
    </form>`;
  showPage(app, dlg);
}

/** Campaign: what the battle before cost, said in the briefing of this one. */
function carryNote(world) {
  if (!world.carry) return '';
  // The share really present: the carry is applied squadron by squadron, and rounded there.
  const n = world.carry.aircraft ?? world.fightersAtStart;
  const total = world.carry.establishment ?? fighterCount(world).establishment;
  const asked = world.objectives.find((o) => o.type === 'enemyDown' && o.full);
  return `<p class="dialog-note">${escapeHtml(t('events.carry', {
    from: t(`scenarios.${world.carry.from}.title`),
    share: total ? Math.round((100 * n) / total) : 100,
    n,
    total,
  }))}${asked ? ` ${escapeHtml(t('log.carryDown', { count: asked.count, full: asked.full }))}` : ''}</p>`;
}
