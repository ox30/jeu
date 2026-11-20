// The unit sheet on the page: where it stands (right, left or bottom of the map), how wide or
// high, and the grip that resizes it. The map canvas follows the size of its table.

import { saveSettings } from '../save/settings.js';
import { setFrame, viewFrame } from '../render/camera.js';

/** Dragging the edge of the unit sheet makes it wider (or higher at the bottom); remembered. */
export function attachSheetGrip(app) {
  const grip = app.el.unitPanel.querySelector('[data-grip="sheet"]');
  if (!grip) return;
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const rect = app.el.unitPanel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const s = app.settings;
    const pos = s.sheetPos || 'right';
    const table = app.el.table.getBoundingClientRect();
    if (pos === 'bottom') s.sheetH = Math.max(180, Math.min(table.height * 0.8, drag.h - (e.clientY - drag.y)));
    else s.sheetW = Math.max(320, Math.min(Math.min(720, table.width * 0.7), drag.w + (pos === 'left' ? 1 : -1) * (e.clientX - drag.x)));
    app.applySheet();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    saveSettings(app.settings);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

/** Where the unit sheet stands (right, left or bottom of the map) and how wide or high. */
export function applySheet(app) {
  const { settings, el } = app;
  const pos = ['left', 'bottom'].includes(settings.sheetPos) ? settings.sheetPos : 'right';
  el.table.classList.toggle('sheet-left', pos === 'left');
  el.table.classList.toggle('sheet-bottom', pos === 'bottom');
  el.table.style.setProperty('--sheet-w', `${Math.round(settings.sheetW || 400)}px`);
  el.table.style.setProperty('--sheet-h', `${Math.round(settings.sheetH || 300)}px`);
}

/** The canvas takes the size of the table; the first time, the camera takes the widest view. */
export function resize(app) {
  const cam = app.camera;
  const rect = app.el.table.getBoundingClientRect();
  const first = cam.width === 800 && cam.height === 600 && !app.sized;
  // On a big screen the map can be drawn at one pixel per point (Réglages, Carte): faster.
  app.dpr = app.settings && app.settings.lowRes ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  cam.width = Math.max(100, rect.width);
  cam.height = Math.max(100, rect.height);
  app.canvas.width = Math.round(cam.width * app.dpr);
  app.canvas.height = Math.round(cam.height * app.dpr);
  if (first) {
    app.sized = true;
    const views = app.data.campaign.views;
    const map = app.world.scenario.map || {};
    setFrame(cam, viewFrame(cam, views[map.view] || views.atlantic));
    cam.minScale = viewFrame(cam, { lon: [-80, 32], lat: [24, 76] }, 0).scale;
  }
}
