// Guided tutorial on the training scenario: a small box on the map gives one step at a
// time and moves on by itself when the player has done what it asks (route a convoy,
// speed up time, scramble a squadron...). A step with a button can also be passed by hand.
// The player can leave the tutorial at any moment.

import { escapeHtml, t } from '../core/i18n.js';
import { goView, select } from './actions.js';

const STEPS = [
  { id: 'welcome', manual: true, enter: (app) => pause(app) },
  {
    id: 'convoy',
    enter: (app) => {
      goView(app, 'atlantic');
      const c = app.world.convoys[0];
      if (c) select(app, 'convoy', c.id);
    },
    done: (app) => app.world.convoys.some((c) => c.state === 'atSea' || c.state === 'arrived'),
  },
  { id: 'time', done: (app) => (!app.paused && app.speed >= 600) || app.world.contacts.size > 0 },
  { id: 'radar', done: (app) => app.world.contacts.size > 0 },
  {
    id: 'scramble',
    enter: (app) => goView(app, 'england'),
    done: (app) => app.world.squadrons.some((s) => s.role === 'fighter' && s.state !== 'ready' && s.state !== 'lost'),
  },
  { id: 'altitude', done: (app, seen) => seen.has('tallyHo') || seen.has('combatRound') },
  { id: 'combat', done: (app, seen) => seen.has('raidReport') },
  { id: 'reports', manual: true, done: (app) => Boolean(app.reportsOpened) },
  { id: 'end', manual: true, last: true },
];

function pause(app) {
  app.paused = true;
  app.dirtyHud = true;
}

export function startTutorial(app) {
  app.tutorial = { index: 0, seen: new Set() };
  app.reportsOpened = false;
  app.el.coach.hidden = false;
  enter(app, 0);
}

export function stopTutorial(app) {
  app.tutorial = null;
  if (app.el.coach) {
    app.el.coach.hidden = true;
    app.el.coach.innerHTML = '';
  }
}

function enter(app, index) {
  const tu = app.tutorial;
  tu.index = index;
  const step = STEPS[index];
  if (step.enter) step.enter(app);
  render(app);
}

function render(app) {
  const tu = app.tutorial;
  const step = STEPS[tu.index];
  const base = `tutorial.${step.id}`;
  const next = step.manual
    ? `<button type="button" data-coach="next">${escapeHtml(t(step.last ? 'tutorial.finish' : 'tutorial.next'))}</button>`
    : `<span class="coach-wait">${escapeHtml(t('tutorial.waiting'))}</span>`;
  app.el.coach.innerHTML = `
    <div class="coach-head"><b>${escapeHtml(t(`${base}.title`))}</b><small>${escapeHtml(t('tutorial.step', { n: tu.index + 1, total: STEPS.length }))}</small></div>
    <p>${escapeHtml(t(`${base}.text`))}</p>
    <div class="coach-buttons">${step.last ? '' : `<button type="button" class="link" data-coach="quit">${escapeHtml(t('tutorial.quit'))}</button>`}${next}</div>`;
}

/** Events seen since the tutorial began (some steps wait for one). */
export function tutorialEvent(app, e) {
  if (app.tutorial) app.tutorial.seen.add(e.type);
}

/** Called every frame: moves on when the current step is done (several at once if need be). */
export function updateTutorial(app) {
  const tu = app.tutorial;
  if (!tu) return;
  let moved = false;
  for (let guard = 0; guard < STEPS.length; guard++) {
    const step = STEPS[tu.index];
    if (!step.done || !step.done(app, tu.seen) || tu.index >= STEPS.length - 1) break;
    tu.index++;
    const nextStep = STEPS[tu.index];
    if (nextStep.enter) nextStep.enter(app);
    moved = true;
  }
  if (moved) render(app);
}

export function attachTutorial(app) {
  app.el.coach.addEventListener('click', (e) => {
    const b = e.target.closest('[data-coach]');
    if (!b || !app.tutorial) return;
    if (b.dataset.coach === 'quit') {
      stopTutorial(app);
      return;
    }
    const step = STEPS[app.tutorial.index];
    if (step.last) stopTutorial(app);
    else enter(app, app.tutorial.index + 1);
  });
}
