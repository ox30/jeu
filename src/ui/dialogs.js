// Dialogs: settings, help, success and end of the scenario.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { objectiveText } from './format.js';
import { checkDevPassword } from './dev.js';
import { markHelpSeen, matchingPreset, saveSettings } from '../save/settings.js';
import { showPage } from './pages.js';
import { CHAIN, TRAINING, saveCampaign, scenarioStatus } from './campaign.js';

function select(name, value, choices, labelKey) {
  const options = choices.map((c) =>
    `<option value="${c}"${c === value ? ' selected' : ''}>${escapeHtml(t(`${labelKey}.${c}`))}</option>`).join('');
  return `<select name="${name}">${options}</select>`;
}

function checkbox(name, checked, label) {
  return `<label class="check"><input type="checkbox" name="${name}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
}

export function openSettings(app) {
  const dlg = app.el.dlgSettings;
  const s = app.settings;
  const presets = app.data.presets;
  const presetChoices = [...Object.keys(presets.presets), 'custom'];
  dlg.innerHTML = `
    <form method="dialog" class="settings">
      <h2>${escapeHtml(t('settings.title'))}</h2>
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
        <label>${escapeHtml(t('settings.carry'))} ${select('carry', s.carry || 'none', presets.choices.carry, 'settings.carryChoices')}</label>
      </fieldset>
      <fieldset>
        ${checkbox('altitudeStalks', s.altitudeStalks, t('settings.altitudeStalks'))}
        ${checkbox('grid', s.grid, t('settings.grid'))}
        ${checkbox('autoZoom', s.autoZoom, t('settings.autoZoom'))}
        ${checkbox('slowOnAlert', s.slowOnAlert, t('settings.slowOnAlert'))}
        ${checkbox('confirmSpeed', s.confirmSpeed !== false, t('settings.confirmSpeed'))}
        ${checkbox('questions', s.questions !== false, t('settings.questions'))}
        ${checkbox('sound', s.sound, t('settings.sound'))}
      </fieldset>
      <fieldset class="dev-settings">
        <label class="check"><input type="checkbox" data-dev="toggle"${app.dev ? ' checked' : ''}> ${escapeHtml(t('settings.devMode'))}</label>
        <div class="dev-password" hidden>
          <input type="password" data-dev="password" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t('settings.devPassword'))}" aria-label="${escapeHtml(t('settings.devPassword'))}">
          <button type="button" data-dev="ok">${escapeHtml(t('settings.devOk'))}</button>
          <button type="button" data-dev="cancel" class="secondary">${escapeHtml(t('settings.devCancel'))}</button>
          <span class="dev-error" role="alert" hidden></span>
        </div>
        <p class="hint">${escapeHtml(t('settings.devHint'))}</p>
      </fieldset>
      <p class="hint">${escapeHtml(t('settings.note'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('settings.close'))}</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  devSettings(app, form);
  form.addEventListener('change', (e) => {
    const field = e.target;
    if (field.dataset.dev) return; // developer mode: devSettings()
    if (field.name === 'preset') {
      if (field.value !== 'custom') Object.assign(s, presets.presets[field.value]);
    } else if (field.type === 'checkbox') {
      s[field.name] = field.checked;
    } else {
      s[field.name] = field.value;
    }
    s.preset = matchingPreset(s, presets);
    saveSettings(s);
    if (field.name === 'orders' || field.name === 'preset') {
      app.drawing = null;
      app.el.unitKeyed.__key = '';
    }
    app.dirtyPanels = true;
    app.dirtyHud = true;
    openSettings.refresh(form, s, presets);
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
  form.elements.falseAlarms.checked = s.falseAlarms;
  form.elements.pagesPause.checked = s.pagesPause;
};

/** The steps of the help, for the scenario being played. */
function helpSteps(app) {
  const own = t(`help.scenario.${app.world.scenario.id}`);
  if (Array.isArray(own)) return [...own, t('help.alerts'), ...t('help.common')];
  return [...t(app.world.rail.enabled ? 'help.steps' : 'help.stepsTraining'), t('help.alerts')];
}

export function openHelp(app) {
  const dlg = app.el.dlgHelp;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('help.title'))}</h2>
      <ol>${helpSteps(app).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
      <p class="keys">${escapeHtml(t('help.keys'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('help.close'))}</button></div>
    </form>`;
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
  const air = w.raids.length > 0;
  const keys = air ? ['bombersDown', 'fightersDown', 'rafLost', 'groundLosses', 'raidsIntercepted', 'raidsRepelled', 'targetsHit'] : [];
  if (w.convoys.length) keys.push('convoysArrived');
  const lines = keys.map((k) => `<li>${escapeHtml(t(`end.${k}`, { n: st[k] }))}</li>`);
  if (w.rail.enabled) {
    lines.push(`<li>${escapeHtml(t('end.shipsSunk', { n: st.shipsSunk }))}</li>`);
    lines.push(`<li>${escapeHtml(t('end.uboatsSunk', { n: st.uboatsSunk }))}</li>`);
    lines.push(`<li>${escapeHtml(t('end.unloaded', { fuel: formatNumber(Math.round(st.unloaded.fuel)), materiel: formatNumber(Math.round(st.unloaded.materiel)) }))}</li>`);
    if (w.factories.length) lines.push(`<li>${escapeHtml(t('end.aircraftBuilt', { n: st.aircraftBuilt, m: st.aircraftDelivered }))}</li>`);
    if (air) lines.push(`<li>${escapeHtml(t('end.fuelUsed', { n: formatNumber(Math.round(st.fuelUsed)) }))}</li>`);
    if (w.depots.length) lines.push(`<li>${escapeHtml(t('end.ammoUsed', { n: formatNumber(Math.round(st.ammoUsed)) }))}</li>`);
  }
  if (w.currency) lines.push(`<li>${escapeHtml(t('end.dollars', { n: formatNumber(Math.round(w.currency.spent)), m: formatNumber(w.currency.start) }))}</li>`);
  if (w.settings.fatigue === 'losses') lines.push(`<li>${escapeHtml(t('end.pilotsKilled', { n: st.pilotsKilled }))}</li>`);
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
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('events.ok'))}</button></div>
    </form>`;
  showPage(app, dlg);
}
