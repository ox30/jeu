// The game loop: each frame owes some steps of simulation at the chosen speed, then shows
// what the player sees and hears of them. It never dies: an error pauses the game and says
// so (crash.js).

import { step } from '../sim/world.js';
import { drainEvents } from '../sim/events.js';
import { clampCentre, updateCamera } from '../render/camera.js';
import { drawScene } from '../render/scene.js';
import { INTERRUPTING, handleEvents } from './gameEvents.js';
import { tickSaves } from './game.js';
import { updateAlerts } from './alerts.js';
import { renderQuestion } from './questions.js';
import { updateTutorial } from './tutorial.js';
import { updateHud } from './hud.js';
import { renderPanels } from './panels.js';
import { updateSignalsChrome } from './watchPanel.js';
import { renderRosterPage } from './rosterPage.js';
import { reportCrash } from './crash.js';
import { tickPlayClock } from './summary.js';

const MAX_STEPS_PER_FRAME = 6000;

/** The steps of simulation this frame owes, at the chosen speed. */
function advance(app, dtReal) {
  const world = app.world;
  if (app.paused || world.ended || app.crash) return;
  app.accumulator += dtReal * app.speed;
  const wanted = Math.min(Math.floor(app.accumulator), MAX_STEPS_PER_FRAME);
  let done = 0;
  let interrupted = false;
  while (done < wanted) {
    const before = world.events.length;
    step(world, 1);
    done++;
    for (let i = before; i < world.events.length; i++) {
      if (INTERRUPTING.has(world.events[i].type)) interrupted = true;
    }
    if (interrupted) break;
  }
  app.accumulator -= done;
  if (interrupted || app.accumulator > 1) app.accumulator = Math.min(app.accumulator, 0.999);
}

/** What the player sees and hears of it. On the main menu the map is not drawn. */
function display(app, now, state) {
  const world = app.world;
  handleEvents(app, drainEvents(world));
  if (app.onMenu) return;
  updateAlerts(app);
  renderQuestion(app);
  updateTutorial(app);
  tickSaves(app, now);
  drawScene(app.ctx, app, app.paused ? 1 : Math.max(0, Math.min(1, app.accumulator)));
  updateHud(app, world.startMs + world.t * 1000);
  // The sheets follow an order at once; the game's own news, at most a few times a second.
  if (app.dirtyPanels || (app.panelsStale && now - state.lastPanels > 150) || now - state.lastPanels > 250) {
    renderPanels(app);
    updateSignalsChrome(app);
    if (app.el.dlgRoster.open) renderRosterPage(app);
    state.lastPanels = now;
    app.dirtyPanels = false;
    app.panelsStale = false;
  }
}

export function startLoop(app) {
  const state = { last: performance.now(), lastPanels: 0, displayFailures: 0 };
  function frame(now) {
    requestAnimationFrame(frame);
    const elapsedMs = now - state.last;
    const dtReal = Math.min(0.25, elapsedMs / 1000);
    state.last = now;
    if (app.crash && app.crash.fatal) return;
    // Stopped on an error, the game is paused whatever closed a page or a menu meanwhile.
    if (app.crash && !app.paused) {
      app.paused = true;
      app.dirtyHud = true;
    }
    // The clock of the game: real time, pauses included, until the scenario ends; not on the menu.
    if (!app.world.ended && !app.onMenu) tickPlayClock(app.playClock, elapsedMs, app.paused);
    try {
      updateCamera(app.camera, dtReal);
      clampCentre(app.camera, app.mapRenderer.coarse.box);
      advance(app, dtReal);
    } catch (err) {
      reportCrash(app, err, 'simulation');
    }
    try {
      display(app, now, state);
      state.displayFailures = 0;
    } catch (err) {
      state.displayFailures++;
      reportCrash(app, err, 'display', state.displayFailures >= 3);
    }
  }
  requestAnimationFrame(frame);
}
