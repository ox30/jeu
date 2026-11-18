// The guard of the frame loop. An error in the simulation or in the display used to stop the
// clock without a word (the mobile-radar crash of 2.6.1); now the game pauses, says what
// happened and offers to export the game or to go back to the last automatic save.

import { escapeHtml, t } from '../core/i18n.js';
import { formatTime } from '../core/time.js';
import { loadFromBrowser } from '../save/game.js';

/**
 * Called by the frame loop when a step or a frame throws. Pauses the game, keeps the last
 * good save as it is (app.save refuses while app.crash is set) and opens the dialog.
 * `fatal`: the display itself keeps failing, so the loop draws nothing more.
 */
export function reportCrash(app, err, where, fatal = false) {
  console.error(err);
  app.paused = true;
  app.dirtyHud = true;
  if (app.crash) {
    // Not the first error: the first one is the cause and stays on record (a broken world
    // often breaks the display too). The display may still give up for good.
    if (fatal) app.crash.fatal = true;
    return;
  }
  app.crash = {
    where,
    fatal,
    message: String((err && err.message) || err),
    stack: String((err && err.stack) || ''),
    t: app.world ? app.world.t : 0,
  };
  openCrash(app);
}

export function openCrash(app) {
  const dlg = app.el.dlgCrash;
  const c = app.crash;
  if (!c) return;
  const when = app.world ? formatTime(app.world.startMs + c.t * 1000) : '';
  const place = (c.stack.split('\n')[1] || '').trim().replace(/^at\s+/, '');
  // The save offered is one of this very game: a game just begun may still have the save of
  // the game before it in the browser.
  const ownSave = () => {
    const s = loadFromBrowser();
    return s && s.meta && s.meta.gameId === app.gameId ? s : null;
  };
  const saved = ownSave();
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapeHtml(t('crash.title'))}</h2>
      <p>${escapeHtml(t('crash.text'))} ${escapeHtml(t(saved ? 'crash.textSaved' : 'crash.textNoSave'))}</p>
      <p class="crash-detail">${escapeHtml(t(`crash.where.${c.where}`, { time: when }))}<br><code>${escapeHtml(c.message)}</code>${place ? `<br><code>${escapeHtml(place)}</code>` : ''}</p>
      <p class="dialog-note" data-crash="note"></p>
      <div class="dialog-buttons">
        <button type="button" data-crash="export">${escapeHtml(t('crash.export'))}</button>
        <button type="button" data-crash="resume"${saved ? '' : ' disabled'}>${escapeHtml(t('crash.resume'))}</button>
        <button value="close">${escapeHtml(t('crash.close'))}</button>
      </div>
    </form>`;
  const note = dlg.querySelector('[data-crash="note"]');
  dlg.querySelector('[data-crash="export"]').addEventListener('click', async () => {
    try {
      const result = await app.exportGame({ crash: { where: c.where, message: c.message, stack: c.stack, t: c.t } });
      note.textContent = t(result === 'saved' ? 'crash.exported' : 'crash.exportFailed');
    } catch {
      note.textContent = t('crash.exportFailed');
    }
  });
  dlg.querySelector('[data-crash="resume"]').addEventListener('click', () => {
    const again = ownSave();
    if (!again) return;
    try {
      app.crash = null;
      app.resume(again);
      app.paused = true;
      dlg.close();
    } catch (err) {
      note.textContent = t('crash.resumeFailed', { message: err.message });
    }
  });
  if (!dlg.open) dlg.showModal();
}
