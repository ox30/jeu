// The guided lessons (I10 of the audit). Each lesson is played on its own small scenario and
// follows steps written in data/tutorial.json: a box on the map gives one step at a time and
// moves on by itself when the player has done what it asks. A step can also show something
// (the instructor gives an order of his own, late on purpose), set the speed of the game, or
// wait for a button. The player can leave a lesson at any moment.

import { escapeHtml, t } from '../core/i18n.js';
import { formatTime } from '../core/time.js';
import { FOOT_M, distance } from '../sim/geo.js';
import { releaseRaid, returnToBase, scramble } from '../sim/orders.js';
import { contactEstimate } from '../sim/query.js';
import { goView, select } from './actions.js';

const site = (app, key) => app.world.sites.get(key) || null;
const squadron = (app, id) => app.world.squadrons.find((s) => s.id === id) || null;

// The conditions a step can wait for (data/tutorial.json): each takes the app, its argument
// from the data, and the state of the lesson (events seen and counted, flags, marks).
const CONDITIONS = {
  convoyAtSea: (app) => app.world.convoys.some((c) => c.state === 'atSea' || c.state === 'arrived'),
  speedAtLeast: (app, n) => !app.paused && app.speed >= n,
  contacts: (app, n) => app.world.contacts.size >= n,
  fighterUp: (app) => app.world.squadrons.some((s) => s.role === 'fighter' && s.state !== 'ready' && s.state !== 'lost'),
  // One of these squadrons has left the ground since the step began.
  airborne: (app, ids) => ids.some((id) => {
    const s = squadron(app, id);
    return s && s.state !== 'ready' && s.state !== 'refuelling' && s.state !== 'lost';
  }),
  seen: (app, types, tu) => types.some((x) => tu.seen.has(x)),
  // { type, n }: this event has been seen at least n times since the lesson began.
  count: (app, { type, n }, tu) => (tu.counts[type] || 0) >= n,
  flag: (app, name, tu) => tu.flags.has(name) || Boolean(app[name]),
  // The table's estimate of a raid (never the raid itself) is within so many kilometres of an installation.
  contactNear: (app, { raid, site: key, km }) => {
    const contact = app.world.contacts.get(raid);
    const est = contact && !contact.lost ? contactEstimate(app.world, contact) : null;
    const s = site(app, key);
    return Boolean(est && s) && distance(est.x, est.y, s.x, s.y) <= km;
  },
  raidsIntercepted: (app, n) => app.world.stats.raidsIntercepted >= n,
  // The report of this raid has come in: the raid is over.
  raidReported: (app, id, tu) => tu.raids.has(id),
  // A train with fuel is on its way to this installation.
  trainTo: (app, key) => app.world.trains.some((tr) => tr.to === key && (tr.cargo.fuel || 0) > 0),
  minStock: (app, key) => {
    const s = site(app, key);
    return Boolean(s && s.minStock && s.minStock.fuel > 0);
  },
  stockAtLeast: (app, { site: key, fuel }) => {
    const s = site(app, key);
    return Boolean(s) && s.stocks.fuel >= fuel;
  },
  // An escort group has its convoy to meet, or is with it.
  joining: (app) => app.world.escorts.some((e) => e.joinTarget || e.escorting),
  escorting: (app) => app.world.escorts.some((e) => e.state === 'escorting'),
  alertIs: (app, { squadron: id, state }) => {
    const s = squadron(app, id);
    return Boolean(s) && s.alert === state;
  },
  fatigueBelow: (app, { squadron: id, n }) => {
    const s = squadron(app, id);
    return Boolean(s) && s.fatigue < n;
  },
  // So many game hours since the step began.
  hours: (app, n, tu) => app.world.t - tu.stepT >= n * 3600,
  any: (app, list, tu) => list.some((c) => holds(app, c, tu)),
  all: (app, list, tu) => list.every((c) => holds(app, c, tu)),
};

/** Is this condition of the data true now? ({ name: argument }, every name of it must hold.) */
export function holds(app, condition, tu) {
  if (!condition) return false;
  const state = tu instanceof Set ? { seen: tu, counts: {}, flags: new Set(), raids: new Set(), stepT: 0 } : tu;
  return Object.entries(condition).every(([name, arg]) => {
    const test = CONDITIONS[name];
    if (!test) throw new Error(`tutorial: unknown condition ${name}`);
    return test(app, arg, state);
  });
}

/** The names of the conditions the lessons may use (for the tests of the data). */
export const CONDITION_NAMES = Object.keys(CONDITIONS);

// The orders the instructor can give in a lesson: the orders of the game, nothing else.
const ORDERS = {
  // { scramble: squadron id, toSite: installation, altitudeFt }: take off toward an installation.
  scramble: (app, o) => {
    const s = squadron(app, o.scramble);
    const to = site(app, o.toSite);
    if (!s || !to) return false;
    return scramble(app.world, s, { route: [[to.x, to.y, (o.altitudeFt || 14000) * FOOT_M]] });
  },
  // { releaseRaid: raid id, inS }: a raid held back by the scenario leaves in so many seconds.
  releaseRaid: (app, o) => releaseRaid(app.world, o.releaseRaid, o.inS || 0),
  // { home: squadron id }
  home: (app, o) => {
    const s = squadron(app, o.home);
    return Boolean(s) && returnToBase(app.world, s);
  },
};

/** The names of the orders a lesson may script (for the tests of the data). */
export const ORDER_NAMES = Object.keys(ORDERS);

function perform(app, order) {
  const name = ORDER_NAMES.find((k) => k in order);
  if (!name) throw new Error(`tutorial: unknown order ${JSON.stringify(order)}`);
  return ORDERS[name](app, order);
}

/** The lesson of the data played on this scenario. */
export function lessonFor(tutorial, scenarioId) {
  return ((tutorial && tutorial.lessons) || []).find((l) => l.scenario === scenarioId) || null;
}

/** The lesson of this name. */
export function lessonById(tutorial, id) {
  return ((tutorial && tutorial.lessons) || []).find((l) => l.id === id) || null;
}

/** A sign from the interface that a lesson may wait for (a page opened, a button pressed). */
export function tutorialFlag(app, name) {
  if (app.tutorial) app.tutorial.flags.add(name);
}

function pause(app, paused) {
  app.paused = paused;
  app.pausedByPage = false;
  app.dirtyHud = true;
}

/** What a step does as it begins: pause or play, a speed, a view of the map, a unit in hand. */
function begin(app, step) {
  const tu = app.tutorial;
  tu.stepT = app.world.t;
  tu.did = new Set();
  if (step.speed) {
    app.speed = step.speed;
    app.dirtyHud = true;
  }
  if (step.pause) pause(app, true);
  if (step.play) pause(app, false);
  // The tab of the sheet the step speaks of ({ group of the sheet: tab }).
  if (step.unitTab) app.unitTabs = { ...(app.unitTabs || {}), ...step.unitTab };
  if (step.select) {
    const sel = step.select;
    app.dirtyPanels = true;
    if (sel.site) select(app, 'site', sel.site);
    else if (sel.id) select(app, sel.kind, sel.id);
    else {
      const list = sel.kind === 'convoy' ? app.world.convoys : sel.kind === 'escort' ? app.world.escorts : app.world.squadrons;
      const u = list[sel.index || 0];
      if (u) select(app, sel.kind, u.id);
    }
  }
  // The view is framed in the part of the map the sheet leaves free: it waits for the sheet of
  // the unit in hand to be drawn (updateTutorial), so that what the step speaks of is not under it.
  tu.view = step.view || null;
  frameView(app);
  script(app, step);
}

/** Goes to the view a step asked for, once the sheet of the selection is on the screen. */
function frameView(app) {
  const tu = app.tutorial;
  if (!tu || !tu.view) return;
  const el = app.el && app.el.unitPanel;
  if (app.selection && el && el.hidden) return;
  goView(app, tu.view);
  tu.view = null;
}

/** The orders of the instructor for this step: each once, when its moment comes. */
function script(app, step) {
  const tu = app.tutorial;
  (step.do || []).forEach((entry, i) => {
    if (tu.did.has(i) || (entry.when && !holds(app, entry.when, tu))) return;
    tu.did.add(i);
    if (entry.order) perform(app, entry.order);
    if (entry.mark) tu.marks[entry.mark] = app.world.t;
  });
}

export function startTutorial(app) {
  const lesson = lessonFor(app.data.tutorial, app.world.scenario.id);
  if (!lesson) return;
  app.tutorial = {
    index: 0, lesson: lesson.id, steps: lesson.steps,
    seen: new Set(), counts: {}, seenAt: {}, flags: new Set(), raids: new Set(), marks: {}, stepT: app.world.t, did: new Set(),
  };
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

/**
 * What the text of a step is filled with: hours of the lesson ({ name: { event } } the first
 * time an event was seen, { name: { mark } } the moment the instructor gave an order) and the
 * minutes between two of them ({ name: [from, to] }).
 */
export function stepParams(app, step) {
  const tu = app.tutorial;
  const at = {};
  const params = {};
  for (const [name, src] of Object.entries(step.times || {})) {
    const time = src.event ? tu.seenAt[src.event] : tu.marks[src.mark];
    at[name] = time;
    params[name] = time === undefined ? '…' : formatTime(app.world.startMs + time * 1000);
  }
  for (const [name, [from, to]] of Object.entries(step.gaps || {})) {
    params[name] = at[from] === undefined || at[to] === undefined ? '…' : String(Math.max(0, Math.round((at[to] - at[from]) / 60)));
  }
  return params;
}

function render(app) {
  const tu = app.tutorial;
  const step = tu.steps[tu.index];
  const base = `tutorial.lessons.${tu.lesson}`;
  const next = step.manual
    ? `<button type="button" data-coach="next">${escapeHtml(t(step.last ? 'tutorial.finish' : 'tutorial.next'))}</button>`
    : `<span class="coach-wait">${escapeHtml(t('tutorial.waiting'))}</span>`;
  app.el.coach.innerHTML = `
    <div class="coach-head"><b>${escapeHtml(t(`${base}.steps.${step.id}.title`))}</b><small>${escapeHtml(t('tutorial.step', { lesson: t(`${base}.name`), n: tu.index + 1, total: tu.steps.length }))}</small></div>
    <p>${escapeHtml(t(`${base}.steps.${step.id}.text`, stepParams(app, step)))}</p>
    <div class="coach-buttons">${step.last ? '' : `<button type="button" class="link" data-coach="quit">${escapeHtml(t('tutorial.quit'))}</button>`}${next}</div>`;
}

/** Events seen since the lesson began (some steps wait for one, or tell when it happened). */
export function tutorialEvent(app, e) {
  const tu = app.tutorial;
  if (!tu) return;
  tu.seen.add(e.type);
  tu.counts[e.type] = (tu.counts[e.type] || 0) + 1;
  if (tu.seenAt[e.type] === undefined) tu.seenAt[e.type] = e.t ?? app.world.t;
  if (e.type === 'raidReport' && e.raidId) tu.raids.add(e.raidId);
}

/** Called every frame: the instructor's orders, the speed a step holds, and the next step when this one is done. */
export function updateTutorial(app) {
  const tu = app.tutorial;
  if (!tu) return;
  const steps = tu.steps;
  let moved = false;
  frameView(app);
  for (let guard = 0; guard < steps.length; guard++) {
    const step = steps[tu.index];
    script(app, step);
    // A step that shows something keeps its speed whatever the alerts do.
    if (step.keepSpeed && step.speed && !app.paused && app.speed !== step.speed && !app.speedConfirm) {
      app.speed = step.speed;
      app.dirtyHud = true;
    }
    if (!step.done || !holds(app, step.done, tu) || tu.index >= steps.length - 1) break;
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
      // Left before its end: the lesson is dropped, and the list of the lessons comes back.
      stopTutorial(app);
      if (app.onTutorialQuit) app.onTutorialQuit();
      return;
    }
    const step = app.tutorial.steps[app.tutorial.index];
    if (step.last) {
      // Played to the end: remembered, and back to the list of the lessons.
      const lesson = app.tutorial.lesson;
      stopTutorial(app);
      if (app.onTutorialDone) app.onTutorialDone(lesson);
    } else enter(app, app.tutorial.index + 1);
  });
}
