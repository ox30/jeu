// Dialogs: settings, help, success and end of the scenario.

import { escapeHtml, formatNumber, t } from '../core/i18n.js';
import { objectiveText } from './format.js';
import { markHelpSeen, matchingPreset, saveSettings } from '../save/settings.js';

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
        <label>${escapeHtml(t('settings.interceptAid'))} ${select('interceptAid', s.interceptAid, presets.choices.interceptAid, 'settings.interceptAidChoices')}</label>
        <label>${escapeHtml(t('settings.fuel'))} ${select('fuel', s.fuel, presets.choices.fuel, 'settings.fuelChoices')}</label>
        <label>${escapeHtml(t('settings.orders'))} ${select('orders', s.orders, presets.choices.orders, 'settings.ordersChoices')}</label>
        <label>${escapeHtml(t('settings.logistics'))} ${select('logistics', s.logistics, presets.choices.logistics, 'settings.logisticsChoices')}</label>
      </fieldset>
      <fieldset>
        ${checkbox('altitudeStalks', s.altitudeStalks, t('settings.altitudeStalks'))}
        ${checkbox('grid', s.grid, t('settings.grid'))}
        ${checkbox('autoZoom', s.autoZoom, t('settings.autoZoom'))}
        ${checkbox('slowOnAlert', s.slowOnAlert, t('settings.slowOnAlert'))}
        ${checkbox('sound', s.sound, t('settings.sound'))}
      </fieldset>
      <p class="hint">${escapeHtml(t('settings.note'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('settings.close'))}</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('change', (e) => {
    const field = e.target;
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
      app.el.sheetOrders.__key = '';
    }
    app.dirtyPanels = true;
    app.dirtyHud = true;
    openSettings.refresh(form, s, presets);
  });
  dlg.showModal();
}

// Keeps the form in step after a preset change.
openSettings.refresh = (form, s, presets) => {
  form.elements.preset.value = matchingPreset(s, presets);
  form.elements.detection.value = s.detection;
  form.elements.interceptAid.value = s.interceptAid;
  form.elements.fuel.value = s.fuel;
  form.elements.orders.value = s.orders;
  form.elements.logistics.value = s.logistics;
  form.elements.falseAlarms.checked = s.falseAlarms;
};

export function openHelp(app) {
  const dlg = app.el.dlgHelp;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('help.title'))}</h2>
      <ol>${t(app.world.rail.enabled ? 'help.steps' : 'help.stepsTraining').map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
      <p class="keys">${escapeHtml(t('help.keys'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('help.close'))}</button></div>
    </form>`;
  dlg.addEventListener('close', markHelpSeen, { once: true });
  dlg.showModal();
}

export function openSuccess(app) {
  const dlg = app.el.dlgSuccess;
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('success.title'))}</h2>
      <p>${escapeHtml(t('success.text'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('success.close'))}</button></div>
    </form>`;
  dlg.showModal();
}

export function openEnd(app) {
  const dlg = app.el.dlgEnd;
  const w = app.world;
  const st = w.stats;
  const keys = ['bombersDown', 'fightersDown', 'rafLost', 'groundLosses', 'raidsIntercepted', 'raidsRepelled', 'targetsHit', 'convoysArrived'];
  const lines = keys.map((k) => `<li>${escapeHtml(t(`end.${k}`, { n: st[k] }))}</li>`);
  if (w.rail.enabled) {
    lines.push(`<li>${escapeHtml(t('end.shipsSunk', { n: st.shipsSunk }))}</li>`);
    lines.push(`<li>${escapeHtml(t('end.uboatsSunk', { n: st.uboatsSunk }))}</li>`);
    lines.push(`<li>${escapeHtml(t('end.unloaded', { fuel: formatNumber(Math.round(st.unloaded.fuel)), materiel: formatNumber(Math.round(st.unloaded.materiel)) }))}</li>`);
    lines.push(`<li>${escapeHtml(t('end.aircraftBuilt', { n: st.aircraftBuilt, m: st.aircraftDelivered }))}</li>`);
    lines.push(`<li>${escapeHtml(t('end.fuelUsed', { n: formatNumber(Math.round(st.fuelUsed)) }))}</li>`);
  }
  let verdict;
  if (w.defeatReason === 'fuel') verdict = t('end.defeatFuel');
  else if (w.defeatReason === 'fighters') verdict = t('end.defeatFighters');
  else if (w.scenario.defeat) verdict = w.outcome === 'victory' ? t('end.victory') : t('end.defeat');
  else verdict = w.allDone ? t('end.success') : t('end.failure');
  const objectives = w.objectives.map((o) =>
    `<li class="${o.done ? 'done' : 'failed'}">${o.done ? '✓' : '✗'} ${escapeHtml(objectiveText(w, o))}</li>`).join('');
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('end.title'))}</h2>
      <p class="verdict ${w.outcome === 'victory' || (!w.scenario.defeat && w.allDone) ? 'won' : 'lost'}"><b>${escapeHtml(verdict)}</b></p>
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
  const items = app.data.scenarios.map((sc) => `
    <li class="${sc.id === app.world.scenario.id ? 'current' : ''}">
      <b>${escapeHtml(t(`scenarios.${sc.id}.title`))}</b>
      <p>${escapeHtml(t(`scenarios.${sc.id}.text`))}</p>
      <button type="button" data-scenario="${escapeHtml(sc.id)}">${escapeHtml(t('scenarios.play'))}</button>
    </li>`).join('');
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('settings.scenarioTitle'))}</h2>
      <ul class="scenarios">${items}</ul>
      <p class="hint">${escapeHtml(t('settings.scenarioNote'))}</p>
      <div class="dialog-buttons"><button value="close">${escapeHtml(t('settings.close'))}</button></div>
    </form>`;
  for (const b of dlg.querySelectorAll('[data-scenario]')) {
    b.addEventListener('click', () => {
      dlg.close();
      app.restart(b.dataset.scenario);
    });
  }
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
