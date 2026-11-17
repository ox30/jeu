// Questions put to the player by the squadrons (engagement.js): leave to engage, to pursue a
// raid going home, to carry on beyond mid-Channel. A banner over the map with Yes (Enter) and
// No (Escape); the game drops to ×1 when one is put and stays there after the answer, so that
// the next moments are not missed. Without an answer within a minute of game time, it is no.

import { t } from '../core/i18n.js';
import { answerQuestion, questionUnitNames } from '../sim/engagement.js';
import { centreOn, select } from './actions.js';
import { playAlarm } from './sound.js';

function shown(app) {
  const w = app.world;
  return w.questions && w.questions.length ? w.questions[0] : null;
}

function listText(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('question.and')} ${names[names.length - 1]}`;
}

/** A question has just been put: the game slows to ×1, a signal sounds. */
export function questionAsked(app) {
  if (app.speed > 1) {
    app.speed = 1;
    app.accumulator = 0;
    app.dirtyHud = true;
  }
  playAlarm(app);
  renderQuestion(app);
}

/** Draws the first open question (or hides the banner); called every frame. */
export function renderQuestion(app) {
  const el = app.el;
  const q = shown(app);
  if (!q) {
    if (!el.question.hidden) {
      el.question.hidden = true;
      el.table.classList.remove('has-question');
    }
    app.questionShown = null;
    return;
  }
  const w = app.world;
  const left = Math.max(0, Math.ceil(q.expires - w.t));
  const units = listText(questionUnitNames(w, q));
  const key = `${q.id}|${units}|${left}|${w.questions.length}`;
  if (el.question.__key === key && !el.question.hidden) return;
  el.question.__key = key;
  app.questionShown = q.id;
  el.questionTitle.textContent = t(`question.title.${q.kind}`);
  el.questionText.textContent = t(`question.text.${q.kind}`, { raid: q.raid, units, missing: q.missing || '' });
  // A rendezvous question has its own choices; the plan's one is answered with Enter.
  el.questionYesNo.hidden = Boolean(q.options);
  el.questionOptions.hidden = !q.options;
  if (q.options) {
    el.questionOptions.innerHTML = q.options.map((o) => `<button type="button" data-option="${o}"${o === q.dflt ? ' class="default"' : ''}>${t(`question.options.${o}`)}${o === q.dflt ? ` ${t('question.default')}` : ''}</button>`).join('');
  }
  el.questionLeft.textContent = t('question.left', { n: left });
  const more = w.questions.length - 1;
  el.questionMore.hidden = more <= 0;
  el.questionMore.textContent = more > 0 ? t('question.more', { n: more }) : '';
  el.question.dataset.kind = q.kind;
  if (el.question.hidden) {
    el.question.hidden = false;
    el.table.classList.add('has-question');
  }
}

/**
 * The answer to the question shown: Yes / No (Enter / Escape), or for a rendezvous one of its
 * choices (Enter: the plan's own, Escape: go without the latecomers).
 */
export function answerShown(app, yes) {
  const q = shown(app);
  if (!q) return false;
  let answer = yes;
  if (q.options && typeof yes === 'boolean') answer = yes ? q.dflt : 'go';
  answerQuestion(app.world, q.id, answer);
  app.dirtyPanels = true;
  renderQuestion(app);
  return true;
}

function showPlace(app) {
  const q = shown(app);
  if (!q) return;
  const r = q.raidId ? app.world.raids.find((x) => x.id === q.raidId) : null;
  centreOn(app, r ? r.x : q.x, r ? r.y : q.y, 1.5);
  if (q.kind === 'rally') select(app, 'formation', q.formationId);
}

export function initQuestions(app) {
  const el = app.el;
  el.questionYes.addEventListener('click', () => answerShown(app, true));
  el.questionNo.addEventListener('click', () => answerShown(app, false));
  el.questionShow.addEventListener('click', () => showPlace(app));
  el.questionOptions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-option]');
    if (b) answerShown(app, b.dataset.option);
  });
}
