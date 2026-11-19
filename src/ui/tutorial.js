// Guided tutorial on the training scenario: a small box on the map gives one step at a
// time and moves on by itself when the player has done what it asks (route a convoy,
// speed up time, scramble a squadron...). A step with a button can also be passed by hand.
// The player can leave the tutorial at any moment.

import { escapeHtml, t } from '../core/i18n.js';
import { goView, select } from './actions.js';

// The conditions a step can wait for (data/tutorial.json): each takes the app, its argument
// from the data, and the events seen since the lesson began.
const CONDITIONS = {
  convoyAtSea: (app) => app.world.convoys.some((c) => c.state === 'atSea' || c.state === 'arrived'),
  speedAtLeast: (app, n) => !app.paused && app.speed >= n,
  contacts: (app, n) => app.world.contacts.size >= n,
  fighterUp: (app) => app.world.squadrons.some((s) => s.role === 'fighter' && s.state !== 'ready' && s.state !== 'lost'),
  seen: (app, types, seen) => types.some((x) => seen.has(x)),
  flag: (app, name) => Boolean(app[name]),
  any: (app, list, seen) => list.some((c) => holds(app, c, seen)),
  all: (app, list, seen) => list.every((c) => holds(app, c, seen)),
};

/** Is this condition of the data true now? ({ name: argument }, every name of it must hold.) */
export function holds(app, condition, seen) {
  if (!condition) return false;
  return Object.entries(condition).every(([name, arg]) => {
    const test = CONDITIONS[name];
    if (!test) throw new Error(`tutorial: unknown condition ${name}`);
    return test(app, arg, seen);
  });
}

/** The names of the conditions the lessons may use (for the tests of the data). */
export const CONDITION_NAMES = Object.keys(CONDITIONS);

/** The lesson of the data played on this scenario (the first one, when several are). */
export function lessonFor(tutorial, scenarioId) {
  return ((tutorial && tutorial.lessons) || []).find((l) => l.scenario === scenarioId) || null;
}

function stepsOf(app) {
  return app.tutorial ? app.tutorial.steps : [];
}

/** What a step does as it begins: pause, a view of the map, a unit in hand. */
function begin(app, step) {
  if (step.pause) pause(app);
  if (step.view) goView(app, step.view);
  if (step.select) {
    const list = step.select.kind === 'convoy' ? app.world.convoys : step.select.kind === 'escort' ? app.world.escorts : app.world.squadrons;
    const u = list[step.select.index || 0];
    if (u) select(app, step.select.kind, u.id);
  }
}

function pause(app) {
  app.paused = true;
  app.dirtyHud = true;
}

export function startTutorial(app) {
  const lesson = lessonFor(app.data.tutorial, app.world.scenario.id);
  if (!lesson) return;
  app.tutorial = { index: 0, seen: new Set(), lesson: lesson.id, steps: lesson.steps };
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
  begin(app, tu.steps[index]);
  render(app);
}

function render(app) {
  const tu = app.tutorial;
  const step = tu.steps[tu.index];
  const base = `tutorial.${step.id}`;
  const next = step.manual
    ? `<button type="button" data-coach="next">${escapeHtml(t(step.last ? 'tutorial.finish' : 'tutorial.next'))}</button>`
    : `<span class="coach-wait">${escapeHtml(t('tutorial.waiting'))}</span>`;
  app.el.coach.innerHTML = `
    <div class="coach-head"><b>${escapeHtml(t(`${base}.title`))}</b><small>${escapeHtml(t('tutorial.step', { n: tu.index + 1, total: tu.steps.length }))}</small></div>
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
  const steps = stepsOf(app);
  for (let guard = 0; guard < steps.length; guard++) {
    const step = steps[tu.index];
    if (!step.done || !holds(app, step.done, tu.seen) || tu.index >= steps.length - 1) break;
    tu.index++;
    begin(app, steps[tu.index]);
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
    const step = app.tutorial.steps[app.tutorial.index];
    if (step.last) {
      // Played to the end: remembered, so that the menu stops putting the training first.
      if (app.onTutorialDone) app.onTutorialDone(app.tutorial.lesson);
      stopTutorial(app);
    }
    else enter(app, app.tutorial.index + 1);
  });
}
