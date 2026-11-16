// Raid alert: banner over the map and a short two-tone signal.

import { t } from '../core/i18n.js';
import { contactEstimate } from '../sim/query.js';
import { countText, ftText, placeText } from './format.js';
import { centreOn, select } from './actions.js';
import { playAlarm } from './sound.js';

export function showAlert(app, event) {
  const el = app.el;
  el.alertText.textContent = t('alert.text', {
    raid: event.raid,
    count: countText(event.count, event.approx),
    alt: ftText(event.altFt),
    where: placeText(event.location),
  });
  el.alert.hidden = false;
  el.alert.dataset.raid = event.raidId;
  el.alert.classList.remove('flash');
  void el.alert.offsetWidth; // restart the animation
  el.alert.classList.add('flash');
  clearTimeout(app.alertTimer);
  app.alertTimer = setTimeout(() => {
    el.alert.hidden = true;
  }, 30000);
  playAlarm(app);
}

export function initAlert(app) {
  const el = app.el;
  el.alertClose.addEventListener('click', () => {
    el.alert.hidden = true;
  });
  el.alertShow.addEventListener('click', () => {
    const raidId = el.alert.dataset.raid;
    const contact = app.world.contacts.get(raidId);
    const est = contact && contactEstimate(app.world, contact);
    if (est) centreOn(app, est.x, est.y, 1.5);
    select(app, 'raid', raidId);
    el.alert.hidden = true;
  });
}
