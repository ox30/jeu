// Dialogs: settings, help, success and end of the scenario.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { dateTimeText, objectiveText, realDurationText } from './format.js';
import { endSummaryKeys } from './summary.js';
import { checkDevPassword } from './dev.js';
import { markHelpSeen, matchingPreset, saveSettings } from '../save/settings.js';
import { showPage } from './pages.js';
import { fighterCount } from '../sim/objectives.js';
import { CHAIN, TRAINING, saveCampaign, scenarioStatus } from './campaign.js';
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

export function openSettings(app) {
  const dlg = app.el.dlgSettings;
  const s = app.settings;
  const presets = app.data.presets;
  const presetChoices = [...Object.keys(presets.presets), 'custom'];
  const tab = SETTINGS_TABS.includes(app.settingsTab) ? app.settingsTab : 'game';
  const pane = (id, html) => `<section class="settings-pane" data-spane="${id}"${id === tab ? '' : ' hidden'}>${html}</section>`;
  dlg.innerHTML = `
    <form method="dialog" class="settings">
      <h2>${escapeHtml(t('settings.title'))}</h2>
      <nav class="settings-tabs" role="tablist">${SETTINGS_TABS.map((id) => `<button type="button" role="tab" data-stab="${id}" class="${id === tab ? 'active' : ''}">${escapeHtml(t(`settings.tabs.${id}`))}</button>`).join('')}</nav>
      ${pane('game', `
      <label>${escapeHtml(t('settings.preset'))} ${select('preset', matchingPreset(s, presets), presetChoices, 'settings.presets')}</label>
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
      </fieldset>`)}
      ${pane('time', `
      <fieldset>
        ${checkbox('slowOnAlert', s.slowOnAlert, t('settings.slowOnAlert'))}
        ${checkbox('confirmSpeed', s.confirmSpeed !== false, t('settings.confirmSpeed'))}
        ${checkbox('questions', s.questions !== false, t('settings.questions'))}
      </fieldset>
      <p class="hint">${escapeHtml(t('settings.alertSpeedsHint'))}</p>
      <table class="alert-speeds">${alertSpeedTable(app)}</table>`)}
      ${pane('map', `
      <fieldset>
        ${checkbox('altitudeStalks', s.altitudeStalks, t('settings.altitudeStalks'))}
        ${app.world.grid ? checkbox('grid', s.grid, t('settings.grid')) : ''}
        ${checkbox('autoZoom', s.autoZoom, t('settings.autoZoom'))}
        ${checkbox('lowRes', s.lowRes, t('settings.lowRes'))}
        <label>${escapeHtml(t('settings.sheetPos'))} ${select('sheetPos', s.sheetPos || 'right', presets.choices.sheetPos, 'settings.sheetPosChoices')}</label>
        <p class="hint">${escapeHtml(t('settings.sheetHint'))}</p>
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
  form.addEventListener('change', (e) => {
    const field = e.target;
    if (field.dataset.dev) return; // developer mode: devSettings()
    if (field.name.startsWith('alertSpeed:')) {
      const type = field.name.slice('alertSpeed:'.length);
      s.alertSpeeds = { ...(s.alertSpeeds || {}) };
      if (field.value === '') delete s.alertSpeeds[type];
      else s.alertSpeeds[type] = Number(field.value);
    } else if (field.name === 'preset') {
      if (field.value !== 'custom') Object.assign(s, presets.presets[field.value]);
    } else if (field.type === 'checkbox') {
      s[field.name] = field.checked;
    } else if (field.type === 'range') {
      s[field.name] = Number(field.value);
    } else {
      s[field.name] = field.value;
    }
    s.preset = matchingPreset(s, presets);
    saveSettings(s);
    if (field.name === 'volume') setVolume(app);
    if (field.name === 'lowRes' && app.resize) app.resize();
    if (field.name === 'sheetPos' && app.applySheet) app.applySheet();
    if (field.name === 'orders' || field.name === 'preset') {
      app.drawing = null;
      app.el.unitKeyed.__key = '';
    }
    app.dirtyPanels = true;
    app.dirtyHud = true;
    openSettings.refresh(form, s, presets);
  });
  // The volume follows the slider while it moves.
  form.elements.volume.addEventListener('input', (e) => {
    s.volume = Number(e.target.value);
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
  form.elements.preset.value = matchingPreset(s, presets);
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
};

/** The steps of the help, for the scenario being played. */
function helpSteps(app) {
  const own = t(`help.scenario.${app.world.scenario.id}`);
  if (Array.isArray(own)) return own;
  return t(app.world.rail.enabled ? 'help.steps' : 'help.stepsTraining');
}

const HELP_TABS = ['scenario', 'sheet', 'air', 'sea', 'time', 'keys'];

/** A picture from the test bench, beside the text it illustrates (data/help/images.json). */
function helpImage(app, name) {
  const src = app.data.helpImages && app.data.helpImages[name];
  return src ? `<figure class="help-image"><img src="${src}" alt="${escapeHtml(t(`help.images.${name}`))}"><figcaption>${escapeHtml(t(`help.images.${name}`))}</figcaption></figure>` : '';
}

/** The help, in tabs: this scenario, the sheet, the air, the sea, time and alerts, the keys. */
export function openHelp(app) {
  const dlg = app.el.dlgHelp;
  const tab = HELP_TABS.includes(app.helpTab) ? app.helpTab : 'scenario';
  const list = (items) => `<ol>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`;
  const bodies = {
    scenario: list(helpSteps(app)),
    sheet: `${helpImage(app, 'sheet')}${list(t('help.sheet'))}`,
    air: `${list(t('help.air'))}${helpImage(app, 'roster')}`,
    sea: `${helpImage(app, 'escort')}${list(t('help.sea'))}`,
    time: list(t('help.time')),
    keys: `<p class="keys">${escapeHtml(t('help.keys'))}</p>`,
  };
  dlg.innerHTML = `
    <form method="dialog" class="help-page">
      <h2>${escapeHtml(t('help.title'))}</h2>
      <nav class="settings-tabs" role="tablist">${HELP_TABS.map((id) => `<button type="button" role="tab" data-htab="${id}" class="${id === tab ? 'active' : ''}">${escapeHtml(t(`help.tabs.${id}`))}</button>`).join('')}</nav>
      ${HELP_TABS.map((id) => `<section class="help-pane" data-hpane="${id}"${id === tab ? '' : ' hidden'}>${bodies[id]}</section>`).join('')}
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
      <div class="dialog-buttons">
        <button value="replay" type="button" data-replay>${escapeHtml(t('end.replay'))}</button>
        <button value="close">${escapeHtml(t('end.close'))}</button>
      </div>
    </form>`;
  dlg.querySelector('[data-replay]').addEventListener('click', () => {
    dlg.close();
    app.restart();
  });
  dlg.showModal();
}

/** Choice of scenario: starting one restarts the game. */
export function openScenarios(app) {
  const dlg = app.el.dlgScenario;
  const c = app.campaign;
  const item = (sc) => {
    const status = scenarioStatus(c, sc.id);
    const locked = status === 'locked';
    const badge = status === 'free' ? t('campaign.training') : t(`campaign.${status}`);
    const tutorial = sc.id === TRAINING ? `<button type="button" data-tutorial="${escapeHtml(sc.id)}">${escapeHtml(t('campaign.tutorial'))}</button>` : '';
    return `
    <li class="${sc.id === app.world.scenario.id ? 'current' : ''} ${status}">
      <b>${escapeHtml(t(`scenarios.${sc.id}.title`))}</b> <span class="badge ${status}">${escapeHtml(badge)}</span>
      <p>${escapeHtml(t(locked ? 'scenarios.locked' : `scenarios.${sc.id}.text`))}</p>
      <div class="scenario-buttons">
        <button type="button" data-scenario="${escapeHtml(sc.id)}"${locked ? ' disabled' : ''}>${escapeHtml(t('scenarios.play'))}</button>
        ${tutorial}
      </div>
    </li>`;
  };
  const chain = CHAIN.map((id) => app.data.scenarios.find((sc) => sc.id === id)).filter(Boolean);
  const others = app.data.scenarios.filter((sc) => !CHAIN.includes(sc.id));
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('settings.scenarioTitle'))}</h2>
      <h3>${escapeHtml(t('campaign.title'))}</h3>
      <p class="hint">${escapeHtml(t('campaign.intro'))}</p>
      <ul class="scenarios">${chain.map(item).join('')}</ul>
      <label class="check"><input type="checkbox" data-unlock-all${c.unlockAll ? ' checked' : ''}> ${escapeHtml(t('campaign.unlockAll'))}</label>
      <ul class="scenarios">${others.map(item).join('')}</ul>
      <p class="hint">${escapeHtml(t('settings.scenarioNote'))}</p>
      <h3>${escapeHtml(t('save.title'))}</h3>
      <p class="hint">${escapeHtml(t('save.text'))}</p>
      <div class="save-buttons">
        <button type="button" data-export>${escapeHtml(t('save.export'))}</button>
        <label class="file-button">${escapeHtml(t('save.import'))}<input type="file" accept=".json,application/json" data-import hidden></label>
        <button type="button" data-restart>${escapeHtml(t('save.restart'))}</button>
      </div>
      <p class="message" data-save-message hidden></p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('settings.close'))}</button></div>
    </form>`;
  dlg.querySelector('[data-export]').addEventListener('click', async () => {
    const result = await app.exportGame();
    if (result === 'failed') {
      const msg = dlg.querySelector('[data-save-message]');
      msg.hidden = false;
      msg.textContent = t('save.exportError');
    }
  });
  dlg.querySelector('[data-restart]').addEventListener('click', () => {
    dlg.close();
    app.restart();
  });
  dlg.querySelector('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const msg = dlg.querySelector('[data-save-message]');
    try {
      app.importGame(await file.text());
      dlg.close();
    } catch (err) {
      msg.hidden = false;
      msg.textContent = t('save.importError');
      console.warn(err);
    }
  });
  for (const b of dlg.querySelectorAll('[data-scenario]')) {
    b.addEventListener('click', () => {
      dlg.close();
      app.restart(b.dataset.scenario);
    });
  }
  for (const b of dlg.querySelectorAll('[data-tutorial]')) {
    b.addEventListener('click', () => {
      dlg.close();
      app.restart(b.dataset.tutorial, { tutorial: true });
    });
  }
  dlg.querySelector('[data-unlock-all]').addEventListener('change', (e) => {
    c.unlockAll = e.target.checked;
    saveCampaign(c);
    openScenarios(app); // rebuilt in place
  });
  showPage(app, dlg);
}

/**
 * The main menu: carry on with the game in progress, the campaign (its scenarios), the
 * training with its tutorial, a game saved in a file, the settings, the help. The game stands
 * still while it is open; « Continuer » sets it going again as it was.
 */
export function openMainMenu(app) {
  const dlg = app.el.dlgMenu;
  const w = app.world;
  if (!dlg.open) {
    app.menuWasRunning = !app.paused && !w.ended;
    app.paused = true;
    app.dirtyHud = true;
  }
  const inGame = !w.ended && (w.t > 0 || app.resumed);
  const when = dateTimeText(w.startMs + w.t * 1000);
  dlg.innerHTML = `
    <form method="dialog" class="main-menu">
      <div class="mm-title"><h1>${escapeHtml(t('app.title'))}</h1><p>${escapeHtml(t('app.subtitle'))}</p></div>
      <div class="mm-buttons">
        ${inGame ? `<button type="button" class="mm-main" data-menu="continue">${escapeHtml(t('menu.continue'))}<small>${escapeHtml(t('menu.continueText', { scenario: t(`scenarios.${w.scenario.id}.title`), when }))}</small></button>` : ''}
        <button type="button"${inGame ? '' : ' class="mm-main"'} data-menu="campaign">${escapeHtml(t('menu.campaign'))}<small>${escapeHtml(t('menu.campaignText'))}</small></button>
        <button type="button" data-menu="training">${escapeHtml(t('menu.training'))}<small>${escapeHtml(t('menu.trainingText'))}</small></button>
        <label class="mm-file">${escapeHtml(t('menu.load'))}<small>${escapeHtml(t('menu.loadText'))}</small><input type="file" accept=".json,application/json" data-menu-file hidden></label>
        <div class="mm-row">
          <button type="button" data-menu="settings">${escapeHtml(t('menu.settings'))}</button>
          <button type="button" data-menu="help">${escapeHtml(t('menu.help'))}</button>
        </div>
      </div>
      <p class="message" data-menu-message hidden></p>
      <p class="hint mm-note">${escapeHtml(t('menu.note'))}</p>
    </form>`;
  const close = (run) => {
    dlg.close();
    if (run && app.menuWasRunning) {
      app.paused = false;
      app.accumulator = 0;
    }
    app.dirtyHud = true;
  };
  dlg.querySelector('[data-menu-file]').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      app.importGame(await file.text());
      close(false);
    } catch (err) {
      const msg = dlg.querySelector('[data-menu-message]');
      msg.hidden = false;
      msg.textContent = t('save.importError');
      console.warn(err);
    }
  });
  dlg.querySelector('.mm-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const what = b.dataset.menu;
    if (what === 'continue') close(true);
    else if (what === 'campaign') {
      close(false);
      openScenarios(app);
    } else if (what === 'training') {
      close(false);
      app.restart(TRAINING, { tutorial: true });
    } else if (what === 'settings') openSettings(app);
    else if (what === 'help') openHelp(app);
  });
  // Escape carries on with the game, like « Continuer ».
  dlg.oncancel = (e) => {
    e.preventDefault();
    if (inGame) close(true);
  };
  if (!dlg.open) dlg.showModal();
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
  const { establishment } = fighterCount(world);
  return `<p class="dialog-note">${escapeHtml(t('events.carry', {
    from: t(`scenarios.${world.carry.from}.title`),
    share: Math.round(world.carry.fighterShare * 100),
    n: world.fightersAtStart,
    total: establishment,
  }))}</p>`;
}
