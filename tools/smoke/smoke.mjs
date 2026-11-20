// Smoke test in a headless Chrome: the development version and the single file dist/index.html
// start; the guided tutorial is played with the mouse and the keyboard; in every scenario each
// page and each kind of sheet is opened and the game runs a little. Any console error fails.
// Then the corrections that live in the page are tried one by one (stacked plaques, speed keys,
// end summary, campaign briefing, the guard of the frame loop).
//   npm run smoke            (add --shots to keep screenshots in tools/smoke/out;
//                             --only tutorial|scenarios|corrections|watches|menus|dist for one part)
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT, closeDialogs, fastForward, openGame, screenOf, serve, sleep } from './browser.mjs';

const SHOTS = process.argv.includes('--shots');
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const wanted = (part) => !ONLY || ONLY.split(',').includes(part);
const OUT = `${ROOT}tools/smoke/out`;
if (SHOTS) mkdirSync(OUT, { recursive: true });
const failures = [];
const note = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
};
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png` });
};
const game = (page, fn, arg) => page.evaluate(fn, arg);
/** Lets the page show what the game has just told it (briefings, events), then closes it. */
const settle = async (page) => {
  for (let i = 0; i < 3; i++) {
    await sleep(200);
    await closeDialogs(page);
  }
};

/** The step of the lesson under way: "lesson:step", or "none". */
const lessonStep = (page) => game(page, () => (window.__game.tutorial ? `${window.__game.tutorial.lesson}:${window.__game.tutorial.steps[window.__game.tutorial.index].id}` : 'none'));

/** Waits until the lesson is at this step (closing the pages that open on the way). */
async function untilStep(page, id, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await lessonStep(page)).endsWith(`:${id}`)) return true;
    await sleep(150);
  }
  return false;
}

async function coachNext(page) {
  await closeDialogs(page);
  await page.click('#coach [data-coach="next"]');
  await sleep(150);
}

/**
 * The four lessons of the tutorial, played from the menu to their last step (I10 of the audit;
 * the gate of the lot: « tutoriel joué de bout en bout »).
 */
async function tutorial(page) {
  await page.click('#menu [data-menu="training"]');
  await sleep(200);
  note(await game(page, () => document.querySelectorAll('#menu [data-lesson]').length === 4 && window.__game.menuPage === 'training'), 'tutorial: the training page lists the four lessons');
  await shot(page, 'lessons-menu');

  // The time a lesson takes (the document asks for three to five minutes): its texts read
  // attentively, as a first reading is (120 words a minute), what the script spends waiting
  // for the game, and a dozen seconds for each order the pupil has to find and give. The
  // second figure is the same lesson replayed by someone who reads fast (200 words a minute).
  const words = await game(page, async () => {
    const { t } = await import('./src/core/i18n.js');
    const out = {};
    for (const l of window.__game.data.tutorial.lessons) {
      out[l.id] = l.steps.reduce((n, s) => n + `${t(`tutorial.lessons.${l.id}.steps.${s.id}.title`)} ${t(`tutorial.lessons.${l.id}.steps.${s.id}.text`)}`.split(/\s+/).length, 0);
    }
    return out;
  });
  const ORDERS = { intercept: 2, supply: 3, escort: 2, alert: 3 };
  let began = Date.now();
  const length = (id, name) => {
    const played = (Date.now() - began) / 1000;
    const first = (words[id] / 120 * 60 + played + ORDERS[id] * 12) / 60;
    const again = (words[id] / 200 * 60 + played + ORDERS[id] * 5) / 60;
    note(first >= 3 && first <= 5 && again >= 1.5, `${name}: three to five minutes at a first reading`,
      `${words[id]} words, ${Math.round(played)} s of game and script, ${ORDERS[id]} orders: ${first.toFixed(1)} min at first, ${again.toFixed(1)} min replayed`);
    began = Date.now();
  };

  // ---- lesson 1: a raid lost as a demonstration, then one to win ----
  await page.click('#menu [data-lesson="intercept"]');
  await page.waitForSelector('#coach:not([hidden])');
  note(await game(page, () => window.__game.world.settings.fatigue === 'off' && window.__game.world.settings.interceptAid === 'track'), 'lesson 1: played with the settings of the lesson, not the player\'s');
  // (Review of 2.9: launched from the menu, the lesson ran while its first step said « le temps est arrêté ».)
  await sleep(1200);
  note(await game(page, () => window.__game.paused && window.__game.world.t === 0), 'lesson 1: launched from the menu, it waits on its first step, the clock stopped');
  await coachNext(page);
  // (Review of 2.10: a pupil who sent 111 Sqn up during the demonstration skipped the two
  // steps that teach it.) The instructor has the hand: the box says so, and an order asked
  // for by the key, by the button of the sheet or by a line does nothing.
  await game(page, async () => {
    const A = await import('./src/ui/actions.js');
    A.select(window.__game, 'squadron', '111');
  });
  await sleep(300);
  await page.keyboard.press('s');
  await sleep(150);
  await game(page, () => document.querySelector('#unit-panel [data-action="scramble"]')?.click());
  await sleep(150);
  const demo = await game(page, () => ({
    wait: document.querySelector('#coach .coach-wait')?.textContent, nudge: document.querySelector('#coach .coach-nudge')?.textContent || '',
    state: window.__game.world.squadrons.find((s) => s.id === '111').state,
  }));
  note(demo.wait === 'Regardez…' && demo.state === 'ready' && /instructeur a la main/.test(demo.nudge), 'lesson 1: during the demonstration the pupil looks: an order does nothing, and the box says why', JSON.stringify(demo));
  await game(page, async () => {
    const A = await import('./src/ui/actions.js');
    A.select(window.__game, null, null);
  });
  note(await untilStep(page, 'why'), 'lesson 1: the demonstration runs by itself to the bombs on Hawkinge');
  const why = await game(page, () => ({ text: document.querySelector('#coach p').textContent, paused: window.__game.paused, intercepted: window.__game.world.stats.raidsIntercepted }));
  note(why.paused && why.intercepted === 0 && /à \d\d:\d\d.*\d+ minutes plus tard.*à \d\d:\d\d, \d+ minutes après/.test(why.text), 'lesson 1: the raid of the demonstration is lost, and the summary tells its hours', why.text.slice(0, 90));
  await shot(page, 'lesson1-why');
  await coachNext(page);
  await untilStep(page, 'yourTurn');
  await coachNext(page);
  note(await untilStep(page, 'scramble', 60000), 'lesson 1: the second raid appears two minutes after the briefing');
  await game(page, () => {
    window.__game.paused = true;
  });
  await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
  await sleep(200);
  await closeDialogs(page);
  // The pupil: a drag from Croydon to the raid (both clear of the sheet: I8 of the audit).
  const from = await screenOf(page, 'airfield', 'croydon');
  const to = await screenOf(page, 'raid', 'd02');
  const onMap = (p) => game(page, ([x, y]) => document.elementFromPoint(x, y) === window.__game.canvas, p);
  note(Boolean(from && to) && (await onMap(from)) && (await onMap(to)), 'lesson 1: the aerodrome and the raid are in view, clear of the unit sheet');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  note(await game(page, () => window.__game.world.squadrons.find((s) => s.id === '111').state !== 'ready'), 'lesson 1: a drag from the aerodrome scrambles the squadron');
  note(await untilStep(page, 'altitude', 15000), 'lesson 1: the lesson goes on once the squadron is off the ground');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowUp');
  await shot(page, 'lesson1-scramble');
  // The pupil keeps the route on the raid as it comes on (a new line each minute of game).
  await game(page, async () => {
    const a = window.__game;
    const O = await import('./src/sim/orders.js');
    const Q = await import('./src/sim/query.js');
    const sq = a.world.squadrons.find((s) => s.id === '111');
    a.pupil = setInterval(() => {
      const c = a.world.contacts.get('d02');
      const est = c && !c.lost ? Q.contactEstimate(a.world, c) : null;
      if (est && sq.state === 'airborne') O.setRoute(a.world, sq, [[est.x, est.y, (est.altFt + 2000) * 0.3048]]);
    }, 300);
    a.speed = 60;
    a.paused = false;
  });
  const fought = await untilStep(page, 'reports', 150000);
  await game(page, () => clearInterval(window.__game.pupil));
  note(fought && await game(page, () => window.__game.world.stats.raidsIntercepted === 1), 'lesson 1: the pupil\'s raid is intercepted and the lesson reaches the reports');
  await settle(page);
  await page.click('#btn-reports');
  await sleep(300);
  note(await game(page, () => document.getElementById('dlg-reports').open && window.__game.world.reports.size === 2), 'lesson 1: the reports page opens on the two raids');
  await shot(page, 'lesson1-reports');
  await page.keyboard.press('Escape');
  note(await untilStep(page, 'end', 10000), 'lesson 1: opening the reports is enough to go on');
  await coachNext(page);
  await sleep(300);
  note(await game(page, () => window.__game.onMenu && window.__game.menuPage === 'training' && document.querySelectorAll('#menu .mm-step.won').length === 1),
    'lesson 1: played to its end, it is marked done and the list comes back');
  note(await game(page, () => !window.__game.store.current()), 'lesson 1: a lesson finished is no game to continue');
  length('intercept', 'lesson 1');

  // ---- lesson 2: a train and a minimum stock ----
  await page.click('#menu [data-lesson="supply"]');
  await page.waitForSelector('#coach:not([hidden])');
  await coachNext(page);
  await untilStep(page, 'base');
  await coachNext(page);
  await untilStep(page, 'train');
  await sleep(300);
  await closeDialogs(page);
  await shot(page, 'lesson2-train');
  await page.fill('#train-fuel', '20');
  await page.selectOption('#train-to', 'airfield:biggin_hill');
  await page.click('#unit-panel [data-action="send-train"]');
  note(await untilStep(page, 'minimum', 10000), 'lesson 2: a train sent to Biggin Hill moves the lesson on');
  await sleep(300);
  await page.fill('#min-stock-fuel', '30');
  await page.click('#unit-panel [data-action="set-min"]');
  note(await untilStep(page, 'wait', 10000), 'lesson 2: so does the minimum stock');
  await page.keyboard.press('4');
  await sleep(150);
  await game(page, () => {
    window.__game.paused = false;
  });
  note(await game(page, () => window.__game.speed === 600), 'lesson 2: key 4 sets ×600');
  note(await untilStep(page, 'end', 120000) && await game(page, () => window.__game.world.sites.get('airfield:biggin_hill').stocks.fuel >= 20), 'lesson 2: the fuel arrives at Biggin Hill');
  await coachNext(page);
  await sleep(300);
  length('supply', 'lesson 2');

  // ---- lesson 3: a watch report, a group sent, the depth charges ----
  await page.click('#menu [data-lesson="escort"]');
  await page.waitForSelector('#coach:not([hidden])');
  await coachNext(page);
  note(await untilStep(page, 'send', 90000), 'lesson 3: the relief of 8 o\'clock stops the game');
  await page.waitForSelector('#dlg-watch[open]', { timeout: 10000 }).catch(() => {});
  await shot(page, 'lesson3-report');
  const sent = await game(page, () => {
    const b = [...document.querySelectorAll('#dlg-watch button')].find((x) => /Envoyer/.test(x.textContent));
    if (b) b.click();
    return Boolean(b);
  });
  note(sent && await untilStep(page, 'orders', 15000), 'lesson 3: « Envoyer », in the watch report, sends the group');
  await closeDialogs(page);
  await sleep(300);
  await page.click('#unit-panel [data-action="escort-pattern"][data-pattern="light"]');
  note(await untilStep(page, 'sail', 10000), 'lesson 3: a standing order chosen moves the lesson on');
  for (let i = 0; i < 300 && !(await lessonStep(page)).endsWith(':end'); i++) {
    await closeDialogs(page);
    // (A relief or a night attack stops the game: the pupil sets it going again.)
    await game(page, () => {
      const a = window.__game;
      if (a.tutorial) {
        a.paused = false;
        a.speed = 3600;
      }
    });
    await sleep(250);
  }
  note((await lessonStep(page)).endsWith(':end') && await game(page, () => window.__game.world.escorts[0].state === 'escorting'), 'lesson 3: the group joins its convoy');
  await coachNext(page);
  await sleep(300);
  length('escort', 'lesson 3');

  // ---- lesson 4: alert states and fatigue ----
  await page.click('#menu [data-lesson="alert"]');
  await page.waitForSelector('#coach:not([hidden])');
  // (The lesson before is played without fatigue, and so without this button: the bar is redrawn with the next image.)
  await sleep(300);
  note(await game(page, () => !document.getElementById('btn-roster').hidden), 'lesson 4: with fatigue on, the Effectifs button is there');
  await coachNext(page);
  await untilStep(page, 'rest');
  await sleep(300);
  await closeDialogs(page);
  await page.click('#unit-panel [data-action="alert"][data-alert="rest"]');
  // (The confirmation shows as the press ends, not at the next quarter-second refresh.)
  const asked = await page.waitForSelector('#unit-panel [data-action="confirm-rest"]', { timeout: 120 }).then(() => true, () => false);
  note(asked, 'lesson 4: « Repos » asks for its confirmation at once');
  await page.click('#unit-panel [data-action="confirm-rest"]');
  note(await untilStep(page, 'ready', 10000), 'lesson 4: the tired squadron is stood down');
  await sleep(300);
  await page.click('#unit-panel [data-action="alert"][data-alert="min5"]');
  note(await untilStep(page, 'roster', 10000), 'lesson 4: the fresh squadron is recalled');
  await page.click('#btn-roster');
  await sleep(300);
  note(await game(page, () => document.getElementById('dlg-roster').open), 'lesson 4: the Effectifs page opens');
  await shot(page, 'lesson4-roster');
  await closeDialogs(page);
  await untilStep(page, 'night', 10000);
  await game(page, () => {
    window.__game.speed = 600;
    window.__game.paused = false;
  });
  note(await untilStep(page, 'end', 90000), 'lesson 4: a night at rest brings the fatigue down');
  await coachNext(page);
  await sleep(300);
  length('alert', 'lesson 4');
  note(await game(page, () => document.querySelectorAll('#menu .mm-step.won').length === 4), 'tutorial: the four lessons are played to their end and marked done');
  await page.click('#menu [data-menu="home"]');
  await sleep(150);
  note(await game(page, () => {
    const entries = [...document.querySelectorAll('#menu .mm-entry')].map((b) => b.dataset.menu);
    return entries.indexOf('training') > entries.indexOf('campaign');
  }), 'tutorial: once done, the training no longer stands before the campaign (C16)');

  // ---- a lesson replaces nothing: the game under way comes back after it ----
  await game(page, () => window.__game.restart('kanalkampf'));
  await settle(page);
  await game(page, () => {
    window.__game.stepWorld(3600);
    window.__game.paused = true;
  });
  await settle(page);
  const mark = await fingerprint(page);
  await game(page, () => window.__game.toMainMenu());
  await page.click('#menu [data-menu="training"]');
  await page.click('#menu [data-lesson="supply"]');
  note(!(await confirmAnswer(page, true)), 'tutorial: a lesson launched over a game under way asks nothing: it replaces nothing');
  await page.waitForSelector('#coach:not([hidden])');
  await coachNext(page);
  await untilStep(page, 'base');
  await game(page, () => {
    window.__game.paused = false;
    window.__game.speed = 600;
  });
  await sleep(1500);
  await game(page, () => {
    window.__game.paused = true;
  });
  const kept = await game(page, () => {
    const a = window.__game;
    const e = a.store.current();
    return { scenario: e && e.scenario, lessonT: a.world.t, inHand: a.world.scenario.id };
  });
  note(kept.scenario === 'kanalkampf' && kept.inHand === 'lecon-ravitailler' && kept.lessonT > 0, 'tutorial: a lesson is not written in the browser: the game under way stays the one kept', JSON.stringify(kept));
  // A new game launched from the menu during the lesson would replace that game: it asks,
  // as for any game under way, and « Annuler » changes nothing.
  await game(page, () => window.__game.toMainMenu());
  await page.click('#menu [data-menu="scenarios"]');
  await page.click('#menu [data-play="kanalkampf"]');
  await page.waitForFunction(() => document.getElementById('dlg-confirm').open, null, { timeout: 4000 }).catch(() => {});
  const question = await game(page, () => (document.getElementById('dlg-confirm').open ? document.getElementById('dlg-confirm').textContent.replace(/\s+/g, ' ') : ''));
  note(/Remplacer la partie en cours/.test(question) && /Kanalkampf/.test(question), 'tutorial: during a lesson, a new game asks before it replaces the game kept under way', question.slice(0, 90));
  await confirmAnswer(page, false);
  note(await game(page, () => window.__game.onMenu && window.__game.world.scenario.id === 'lecon-ravitailler' && window.__game.store.current().scenario === 'kanalkampf'),
    'tutorial: « Annuler » leaves the lesson in hand and the game kept');
  await page.click('#menu [data-menu="home"]');
  await sleep(150);
  await page.click('#menu [data-menu="continue"]');
  await page.waitForFunction(() => !window.__game.onMenu, null, { timeout: 8000 }).catch(() => {});
  note(await game(page, () => Boolean(window.__game.tutorial) && window.__game.world.scenario.id === 'lecon-ravitailler'), 'tutorial: « Continuer » goes back to the lesson while it is in hand');
  await closeDialogs(page);
  await page.click('#btn-menu');
  await sleep(200);
  note(await game(page, () => document.querySelector('#dlg-menu [data-gm="save"]').disabled && document.querySelector('#dlg-menu [data-gm="export"]').disabled
    && /ne s'enregistre pas/.test(document.getElementById('dlg-menu').textContent)), 'tutorial: « Sauvegarder » and « Exporter » are not offered during a lesson, and the menu says why');
  await page.keyboard.press('Escape');
  await sleep(200);
  // The little scenario of the lesson runs out before its last step (the pupil let the days
  // go by): no verdict of a battle, the game kept is not touched, and the lesson is offered
  // again with its instructor. (Review of 2.10: « Objectifs non atteints », then « Rejouer »
  // gave the lesson without its instructor — and the end removed the game kept.)
  await game(page, () => {
    const a = window.__game;
    a.paused = true;
    for (let i = 0; i < 40 * 86400 && !a.world.ended; i += 60) a.stepWorld(60);
  });
  await sleep(600);
  const over = await game(page, () => ({
    ended: window.__game.world.ended, open: document.getElementById('dlg-end').open, text: document.getElementById('dlg-end').textContent.replace(/\s+/g, ' ').trim(),
    kept: window.__game.store.current() && window.__game.store.current().scenario,
  }));
  note(over.ended && over.open && /La leçon s'arrête ici/.test(over.text) && !/Objectifs/.test(over.text) && over.kept === 'kanalkampf',
    'tutorial: a lesson whose scenario runs out says so, shows no verdict, and leaves the game kept', JSON.stringify(over).slice(0, 160));
  await shot(page, 'lesson-over');
  await page.click('#dlg-end [data-end="again"]');
  await page.waitForSelector('#coach:not([hidden])');
  await sleep(300);
  note(await game(page, () => Boolean(window.__game.tutorial) && window.__game.tutorial.index === 0 && window.__game.world.t === 0 && window.__game.world.scenario.id === 'lecon-ravitailler'
    && window.__game.store.current().scenario === 'kanalkampf'), 'tutorial: « Rejouer la leçon » gives it again from its first step, with its instructor');
  await page.click('#coach [data-coach="quit"]');
  await sleep(300);
  note(await game(page, () => window.__game.onMenu && window.__game.menuPage === 'training' && !window.__game.tutorial), 'tutorial: a lesson left goes back to the list of the lessons');
  await page.click('#menu [data-menu="home"]');
  await sleep(150);
  const line = await game(page, () => document.querySelector('#menu [data-menu="continue"]')?.textContent || '');
  note(/Kanalkampf/.test(line), 'tutorial: « Continuer » then names the game that was under way', line.slice(0, 70));
  await page.click('#menu [data-menu="continue"]');
  await page.waitForFunction(() => !window.__game.onMenu, null, { timeout: 8000 }).catch(() => {});
  await settle(page);
  note((await fingerprint(page)) === mark && await game(page, () => window.__game.paused), 'tutorial: and brings it back as it was, waiting for the player');
}

const PAGES = [['#btn-reports', 'dlg-reports'], ['#btn-formations', 'dlg-formations'], ['#btn-roster', 'dlg-roster'], ['#btn-cards', 'dlg-cards'],
  ['#btn-menu', 'dlg-menu'], ['#btn-help', 'dlg-help']];
const TABS = ['#tab-units', '#tab-sites', '#tab-logistics'];

/** One scenario: start it, open every page, a sheet of each kind, and let it run. */
/**
 * A click that a page opening at that very moment does not block (a question of the
 * controller, a report): the page is closed and the click tried again.
 */
async function press(page, target) {
  const locator = typeof target === 'string' ? page.locator(target).first() : target;
  for (let attempt = 0; ; attempt++) {
    try {
      await locator.click({ timeout: 2500 });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await closeDialogs(page);
      await sleep(150);
    }
  }
}

async function scenario(page, id, errors) {
  const before = errors.length;
  await game(page, (sid) => {
    const a = window.__game;
    a.campaign.unlockAll = true;
    a.restart(sid);
  }, id);
  await settle(page);
  // The « Signaux » tab of the journal belongs to the sea of the watches only.
  const watches = await game(page, () => Boolean(window.__game.world.watch));
  note((await page.isVisible('#log-tabs')) === watches, `${id}: the « Signaux » tab ${watches ? 'is there' : 'is hidden'}`);
  for (const [button, dialog] of PAGES) {
    if (!(await page.isVisible(button))) continue;
    await press(page, button);
    await sleep(120);
    const open = await game(page, (d) => document.getElementById(d).open, dialog);
    if (!open) note(false, `${id}: ${button} opens its page`);
    await closeDialogs(page);
  }
  await fastForward(page, 4 * 3600);
  await settle(page);
  // A sheet of each kind, from the status board.
  let sheets = 0;
  for (const tab of TABS) {
    if (!(await page.isVisible(tab))) continue; // no logistics tab without a railway
    await press(page, tab);
    await sleep(80);
    const kinds = await game(page, () => [...new Set([...document.querySelectorAll('#tote [data-action="select"]')].map((b) => b.dataset.kind))]);
    for (const kind of kinds) {
      await press(page, `#tote [data-action="select"][data-kind="${kind}"]`);
      await sleep(120);
      if (await page.isVisible('#unit-panel')) sheets++;
      const tabs = await page.locator('#unit-tabs button').count();
      for (let i = 0; i < tabs; i++) {
        const tab = page.locator('#unit-tabs button').nth(i);
        if (await tab.isVisible()) await press(page, tab);
        await sleep(40);
      }
    }
  }
  await press(page, '#tab-units');
  // The three views, with a sheet open, then a few seconds at ×600.
  for (const key of ['a', 'l', 'g']) {
    await page.keyboard.press(key);
    await sleep(350);
  }
  await game(page, () => {
    const a = window.__game;
    a.speed = 600;
    a.paused = false;
  });
  await sleep(1500);
  await game(page, () => {
    window.__game.paused = true;
  });
  await closeDialogs(page);
  await shot(page, `scenario-${id}`);
  const crashed = await game(page, () => Boolean(window.__game.crash));
  const fresh = errors.slice(before);
  note(sheets >= 3 && !crashed && fresh.length === 0, `${id}: pages, sheets and views`, crashed ? 'the game stopped on an error' : fresh.slice(0, 2).join(' | ') || `${sheets} sheets`);
}

/** One part of the checks: a wait that times out fails that part by name, and the others go on. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    note(false, `${name}: stopped on an error`, String(err && err.message).split('\n')[0]);
  }
}

/** A drag on the map, as a player does it. */
async function drag(page, from, to, { shift = false } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 });
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await sleep(120);
}

/**
 * The corrections of M2.7 that live in the page: plaques one over the other (C9), speed keys
 * by their place (C4), the end summary and the clock (C2, N5), the campaign said in the
 * briefing (I1), no grid in the Atlantic (N8), and the guard of the frame loop (B1).
 */
async function corrections(page, errors) {
  const before = errors.length;
  let expected = errors.length;
  // ---- C9: two squadrons of the same aerodrome fly to the same point, one over the other.
  await step('stacked plaques', async () => {
    await game(page, () => {
      const a = window.__game;
      a.campaign.unlockAll = true;
      a.restart('quinze-septembre');
    });
    await settle(page);
    const ids = await page.evaluate(async () => {
      const orders = await import('./src/sim/orders.js');
      const a = window.__game;
      const w = a.world;
      a.paused = true;
      const byField = {};
      for (const s of w.squadrons) if (s.role === 'fighter' && s.state === 'ready') (byField[s.airfield] ||= []).push(s);
      const [s1, s2] = Object.values(byField).find((list) => list.length >= 2);
      const target = [s1.x + 30, s1.y + 10];
      orders.scramble(w, s1, { route: [target] });
      orders.scramble(w, s2, { route: [target] });
      for (let i = 0; i < 900; i++) a.stepWorld(1);
      a.selection = null;
      a.dirtyPanels = true;
      a.dirtyHud = true;
      return [s1.id, s2.id];
    });
    await page.keyboard.press('g');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
    await sleep(300);
    await closeDialogs(page);
    // Since the stacks (C9, M2.10) the two plaques are one mark with their number: the pile
    // is opened by a click, and the unit of the chosen tab is the one a gesture reaches.
    const stack = async () => page.evaluate((list) => {
      const a = window.__game;
      const r = a.canvas.getBoundingClientRect();
      const pile = a.stacks.find((x) => list.every((id) => x.members.some((m) => m.kind === 'squadron' && m.id === id)));
      const out = { pile: pile ? [r.left + pile.x, r.top + pile.y] : null, members: pile ? pile.members.length : 0 };
      for (const id of list) {
        const sq = a.world.squadrons.find((x) => x.id === id);
        out[id] = { route: JSON.stringify(sq.route), x: sq.x, y: sq.y };
      }
      out.selection = a.selection ? `${a.selection.kind}:${a.selection.id}` : null;
      out.ruler = a.ruler ? a.ruler.a : null;
      out.tabs = [...document.querySelectorAll('#unit-stack button')].map((b) => b.dataset.id);
      return out;
    }, ids);
    const still = async () => {
      await sleep(150);
      await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
      await sleep(150);
      return stack();
    };
    let st = await stack();
    const [first, second] = ids;
    note(Boolean(st.pile) && st.members === 2, 'stacked plaques: two squadrons that fly one over the other make one pile', `${st.members} member(s)`);
    if (st.pile) {
      // Nothing in hand: a drag from the pile gives no order to anyone.
      const untouched = [st[first].route, st[second].route];
      await drag(page, st.pile, [st.pile[0] - 140, st.pile[1] + 110]);
      st = await still();
      note(st.selection === null && st[first].route === untouched[0] && st[second].route === untouched[1], 'stacked plaques: a drag from a pile not opened gives no order', `selection ${st.selection}`);
      // A click opens it; the tab of the second squadron takes it in hand.
      await page.mouse.click(st.pile[0], st.pile[1]);
      st = await still();
      note(st.tabs.length === 2 && st.selection !== null, 'stacked plaques: a click opens the pile, one tab a squadron', st.tabs.join(' '));
      const take = async (id) => {
        await page.click(`#unit-stack button[data-id="${id}"]`);
        return still();
      };
      st = await take(second);
      await drag(page, st.pile, [st.pile[0] - 140, st.pile[1] + 110]);
      st = await still();
      note(st.selection === `squadron:${second}` && st[first].route === untouched[0] && st[second].route !== untouched[1],
        'stacked plaques: the drag goes to the squadron in hand', `selection ${st.selection}`);
      // The other one in hand: same pile, the other squadron answers.
      st = await take(first);
      const kept = st[second].route;
      await drag(page, st.pile, [st.pile[0] - 140, st.pile[1] - 110]);
      st = await still();
      note(st.selection === `squadron:${first}` && st[second].route === kept && st[first].route !== untouched[0],
        'stacked plaques: and to the other one once it is in hand', `selection ${st.selection}`);
      // The ruler from the pile keeps the selection and starts on the unit in hand.
      await drag(page, st.pile, [st.pile[0] + 120, st.pile[1] - 60], { shift: true });
      st = await stack();
      const onUnit = st.ruler && Math.hypot(st.ruler[0] - st[first].x, st.ruler[1] - st[first].y) < 0.01;
      note(st.selection === `squadron:${first}` && Boolean(onUnit), 'stacked plaques: the ruler keeps the selection and starts on the unit in hand', `selection ${st.selection}`);
      // With nothing in hand the ruler measures from the map and selects nobody.
      await page.keyboard.press('Escape');
      await game(page, () => {
        window.__game.selection = null;
        window.__game.dirtyPanels = true;
      });
      st = await still();
      if (st.pile) await drag(page, st.pile, [st.pile[0] + 120, st.pile[1] - 60], { shift: true });
      st = await stack();
      note(st.selection === null && Boolean(st.ruler), 'stacked plaques: with nothing in hand the ruler selects nobody', `selection ${st.selection}`);
      await shot(page, 'stacked-plaques');
      await page.keyboard.press('Escape');
    }
  });
  // ---- C9 again: a squadron on the ground is in hand, another one flies over its aerodrome.
  await step('over the aerodrome', async () => {
    await game(page, () => window.__game.restart('quinze-septembre'));
    await settle(page);
    const pair = await page.evaluate(async () => {
      const orders = await import('./src/sim/orders.js');
      const a = window.__game;
      const w = a.world;
      a.paused = true;
      const byField = {};
      for (const s of w.squadrons) if (s.role === 'fighter' && s.state === 'ready') (byField[s.airfield] ||= []).push(s);
      const [ground, flying] = Object.values(byField).find((list) => list.length >= 2);
      orders.scramble(w, flying, { route: [[flying.x + 0.4, flying.y + 0.3]] }); // it orbits over its own aerodrome
      for (let i = 0; i < 900; i++) a.stepWorld(1);
      a.dirtyPanels = true;
      a.dirtyHud = true;
      return { ground: ground.id, flying: flying.id, field: ground.airfield };
    });
    await page.keyboard.press('g');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
    await closeDialogs(page);
    const inHand = async (id) => {
      await page.evaluate(async (sid) => {
        const actions = await import('./src/ui/actions.js');
        actions.select(window.__game, 'squadron', sid);
        actions.revealSelection(window.__game);
      }, id);
      await sleep(200);
      await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
      await sleep(150);
    };
    const over = async () => page.evaluate((p) => {
      const a = window.__game;
      const r = a.canvas.getBoundingClientRect();
      const field = a.hits.find((h) => h.kind === 'airfield' && h.id === p.field);
      const sq = a.hits.find((h) => h.kind === 'squadron' && h.id === p.flying && h.box);
      const at = (h) => (h ? [r.left + h.x, r.top + h.y] : null);
      const ground = a.world.squadrons.find((s) => s.id === p.ground);
      const flying = a.world.squadrons.find((s) => s.id === p.flying);
      return {
        field: at(field), flying: at(sq), selection: a.selection ? `${a.selection.kind}:${a.selection.id}` : null,
        groundState: ground.state, flyingRoute: JSON.stringify(flying.route),
      };
    }, pair);
    await inHand(pair.ground);
    let o = await over();
    // The squadron's symbol stands at the top of its altitude stalk, just above the aerodrome:
    // half-way between the two, both are under the pointer.
    const between = (x) => [(x.field[0] + x.flying[0]) / 2, (x.field[1] + x.flying[1]) / 2];
    const close = o.field && o.flying && Math.hypot(o.field[0] - o.flying[0], o.field[1] - o.flying[1]) < 36;
    note(Boolean(close), 'over the aerodrome: a squadron flies over the aerodrome of the squadron in hand');
    if (close) {
      // A plain click there selects the squadron that flies: the aerodrome does not take the click.
      await page.mouse.click(...between(o));
      await sleep(200);
      await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
      o = await over();
      note(o.selection === `squadron:${pair.flying}`, 'over the aerodrome: a click selects the squadron that flies there', `selection ${o.selection}`);
      // With the squadron on the ground in hand again, a drag from the same place is its take-off.
      await inHand(pair.ground);
      o = await over();
      const kept = o.flyingRoute;
      const from = between(o);
      await drag(page, from, [from[0] - 150, from[1] + 90]);
      o = await over();
      note(o.groundState === 'scrambling' && o.flyingRoute === kept && o.selection === `squadron:${pair.ground}`,
        'over the aerodrome: a drag from the aerodrome scrambles the squadron in hand', `${o.groundState}, selection ${o.selection}`);
    }
  });
  // ---- C4: the speed keys by their place (an AZERTY keyboard types « é » on the key of 2).
  await step('speed keys', async () => {
    const speeds = await page.evaluate(() => {
      const a = window.__game;
      const press = (key, code) => window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
      a.paused = true;
      press('é', 'Digit2');
      const second = a.speed;
      press('&', 'Digit1');
      const firstSpeed = a.speed;
      press('3', 'Numpad3');
      return [firstSpeed, second, a.speed];
    });
    note(speeds[0] < speeds[1] && speeds[1] < speeds[2], 'speed keys: read by their place on the keyboard (AZERTY, keypad)', speeds.join(' < '));
    // The keypad with Num Lock off types arrows: the speed does not move.
    const arrows = await page.evaluate(() => {
      const a = window.__game;
      const before = a.speed;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'Numpad2', bubbles: true }));
      return a.speed === before;
    });
    note(arrows, 'speed keys: the keypad with Num Lock off keeps its arrows');
  });
  // ---- C2, N5: the day is played to its end; the summary speaks of the air battle and of the time.
  await step('end summary', async () => {
    await game(page, () => {
      const a = window.__game;
      a.paused = true;
      for (let i = 0; i < 90000 && !a.world.ended && !a.crash; i++) a.stepWorld(1);
      a.paused = false; // one frame sees the end of the scenario
    });
    await page.waitForSelector('#dlg-end[open]', { timeout: 20000 });
    const summary = await page.evaluate(() => document.getElementById('dlg-end').innerText);
    await shot(page, 'end-quinze-septembre');
    note(/Bombardiers abattus/.test(summary) && !/U-Boote|Navires marchands|Déchargé/.test(summary), 'end summary: 15 September lists the air battle, no ships nor U-boats');
    note(/Temps de jeu/.test(summary), 'end summary: the real time played is shown');
    await closeDialogs(page);
  });
  // ---- I1: the campaign in Réaliste, said in the briefing of 15 September.
  await step('campaign briefing', async () => {
    await game(page, () => {
      const a = window.__game;
      a.campaign.results = { kanalkampf: { won: true, fighterShare: 0.8, last: 'victory' }, adlertag: { won: true, fighterShare: 0.55, last: 'victory' } };
      a.settings.carry = 'full';
      a.restart('quinze-septembre');
    });
    await settle(page);
    await fastForward(page, 90);
    await game(page, () => {
      window.__game.paused = false;
    });
    await page.waitForSelector('#dlg-event[open]', { timeout: 20000 });
    const briefing = await page.evaluate(() => document.getElementById('dlg-event').innerText);
    const share = await page.evaluate(() => {
      const w = window.__game.world;
      const now = w.squadrons.filter((s) => s.role === 'fighter').reduce((n, s) => n + s.aircraft, 0);
      const asked = w.objectives.find((o) => o.type === 'enemyDown');
      const total = w.squadrons.filter((s) => s.role === 'fighter').reduce((n, s) => n + s.aircraftStart, 0);
      return { atStart: w.fightersAtStart, now, total, carry: w.carry && w.carry.fighterShare, down: asked.count, full: asked.full };
    });
    await shot(page, 'briefing-campaign');
    note(/Campagne/.test(briefing) && briefing.includes(String(share.atStart)) && share.carry === 0.6 && share.now <= share.atStart,
      'campaign: the losses carried over are said in the briefing', `${share.atStart} fighters at the start`);
    // (2.10.2: the aircraft to shoot down follow the fighters carried over, as the fighter objective does.)
    note(share.full === 32 && share.down === Math.round((32 * share.atStart) / share.total) && briefing.includes(`${share.down} au lieu de 32`),
      'campaign: the aircraft to shoot down follow the fighters carried over, and the briefing says so', `${share.down} instead of ${share.full}`);
    await closeDialogs(page);
    const panel = await game(page, () => document.getElementById('objectives').textContent);
    note(new RegExp(`Abattre au moins ${share.down} avions ennemis .* 32 à effectif complet`).test(panel), 'campaign: the objective shows the count of the campaign and the scenario\'s own', panel.slice(0, 120));
    await shot(page, 'objective-campaign');
    await game(page, () => {
      const a = window.__game;
      a.campaign.results = {};
      a.settings.carry = 'none';
    });
  });
  // ---- N8: no RAF grid in the Atlantic, and no setting for it there.
  await step('Atlantic without grid', async () => {
    await game(page, () => window.__game.restart('hiver-atlantique'));
    await settle(page);
    // The settings of the game: ☰, « Réglages de la partie ».
    await page.click('#btn-menu');
    await page.click('#dlg-menu [data-gm="settings"]');
    await sleep(150);
    const grid = await page.evaluate(() => ({ world: window.__game.world.grid, box: Boolean(document.querySelector('#dlg-settings [name="grid"]')) }));
    await closeDialogs(page);
    note(grid.world === null && !grid.box, 'Atlantic: no RAF grid on the map, no setting for it');
  });
  // ---- B1, Code 3: an error in the simulation pauses the game and says so; the game can be exported.
  await step('loop guard', async () => {
    expected = errors.length;
    await game(page, () => {
      const a = window.__game;
      Object.defineProperty(a.world, 'convoys', { get() { throw new Error('smoke test: a deliberate error'); }, configurable: true });
      a.paused = false;
    });
    await page.waitForSelector('#dlg-crash[open]', { timeout: 20000 });
    const crash = await page.evaluate(() => ({
      paused: window.__game.paused, where: window.__game.crash && window.__game.crash.where,
      text: document.getElementById('dlg-crash').innerText, buttons: document.querySelectorAll('#dlg-crash button').length,
    }));
    await shot(page, 'crash-guard');
    // The step or the frame fails first, whichever comes: both end in the same dialog.
    note(crash.paused && ['simulation', 'display'].includes(crash.where) && crash.buttons >= 2 && /deliberate error/.test(crash.text),
      'loop guard: an error pauses the game, shows a message and offers the export');
    // The message closed, the game does not pretend to run: Space brings the message back.
    await closeDialogs(page);
    await sleep(100);
    await page.keyboard.press('Space');
    await sleep(200);
    const after = await page.evaluate(() => ({ paused: window.__game.paused, open: document.getElementById('dlg-crash').open }));
    note(after.paused && after.open, 'loop guard: once the message is closed, resuming brings it back and the clock stays stopped');
    await closeDialogs(page);
    // The page lives on: a new game starts and runs.
    await game(page, () => window.__game.restart('m0-july-1940'));
    await settle(page);
    await fastForward(page, 600);
    const alive = await game(page, () => !window.__game.crash && window.__game.world.t >= 600);
    note(alive, 'loop guard: the page lives on, a new game starts and runs');
  });
  // The deliberate error was logged by the guard: it is not a failure of the page.
  const own = errors.slice(expected).filter((e) => !/deliberate error/.test(e));
  errors.length = expected;
  note(errors.slice(before).length === 0 && own.length === 0, 'corrections: no unexpected console error', [...errors.slice(before), ...own].slice(0, 2).join(' | '));
}

/** Steps the game an hour at a time (the page reads the events as they come) until `done()` in the page is true. */
async function playUntil(page, done, maxHours) {
  for (let h = 0; h < maxHours; h++) {
    const ok = await page.evaluate((src) => {
      const a = window.__game;
      const test = new Function('a', `return (${src})(a);`);
      a.paused = true;
      for (let i = 0; i < 3600 && !a.world.ended && !test(a); i++) a.stepWorld(1);
      a.dirtyPanels = true;
      a.dirtyHud = true;
      return Boolean(test(a));
    }, done.toString());
    await sleep(25);
    if (ok) return true;
  }
  return false;
}

/**
 * The sea of M2.8 in the page: a relief that stops the game with its report and the button
 * that answers, « Reprendre » at the speed of before, the « Signaux » tab, radio silence (an
 * estimated convoy, an order by radio), the depth-charge gauge, and the pause of the first
 * attack in the night.
 */
async function watches(page, errors) {
  const before = errors.length;
  await game(page, () => {
    const a = window.__game;
    a.campaign.unlockAll = true;
    a.restart('hiver-atlantique');
  });
  await settle(page);
  await game(page, () => {
    window.__game.speed = 600;
  });
  await step('relief stop', async () => {
    const stopped = await playUntil(page, (a) => a.world.events.some((e) => e.type === 'seaStop' && e.reason === 'relief'), 12 * 24);
    note(stopped, 'watches: a relief stops the game for a decision');
    await page.waitForFunction(() => document.getElementById('dlg-watch').open, null, { timeout: 15000 });
    await game(page, () => {
      for (const d of document.querySelectorAll('dialog[open]')) if (d.id !== 'dlg-watch') d.close();
    });
    await sleep(200);
    const s = await game(page, () => ({ paused: window.__game.paused, speed: window.__game.speed, sends: document.querySelectorAll('#dlg-watch [data-watch="send"]').length }));
    note(s.paused && s.speed === 600, 'watches: the stop is a pause, the speed is left alone', JSON.stringify(s));
    note(s.sends >= 1, 'watches: the report offers the button that answers the decision');
    await shot(page, 'watch-relief');
    // (2.10.4) Closed without an answer, to look at the map first: the « Quart » button of the
    // top bar, with the number of decisions that wait, opens the very same page again.
    const pageOf = () => game(page, () => {
      const d = document.getElementById('dlg-watch');
      const b = document.getElementById('btn-watch');
      return {
        open: d.open, title: d.querySelector('h2')?.textContent || '', sends: d.querySelectorAll('[data-watch="send"]').length, size: d.innerHTML.length,
        button: Boolean(b.offsetParent), count: document.getElementById('watch-count').hidden ? '' : document.getElementById('watch-count').textContent, tip: b.title,
      };
    });
    const first = await pageOf();
    await page.click('#dlg-watch [data-watch="close"]');
    await sleep(700);
    const closed = await pageOf();
    note(!closed.open && closed.button && Number(closed.count) >= 1 && /Rapport de quart.*\(Q\).*décision/.test(closed.tip),
      'watches: the page closed without an answer, the « Quart » button counts what waits', JSON.stringify({ count: closed.count, tip: closed.tip }));
    await shot(page, 'watch-closed');
    await page.click('#btn-watch');
    await sleep(300);
    const again = await pageOf();
    note(again.open && again.title === first.title && again.sends === first.sends && again.size === first.size, 'watches: … and opens the same page again, with its buttons', JSON.stringify([first.title, again.title, again.sends]));
    await page.click('#dlg-watch [data-watch="close"]');
    await sleep(200);
    await page.keyboard.press('q');
    await sleep(300);
    note((await pageOf()).open, 'watches: … as its key does (Q)');
    // With the button, the top bar still holds on one line at 1 024 px.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 1024, height: 700 });
    await sleep(300);
    const narrow = await game(page, () => {
      const hud = document.getElementById('hud');
      return { height: hud.offsetHeight, overflow: hud.scrollWidth > hud.clientWidth + 1, tools: [...hud.querySelectorAll('button.tool')].filter((x) => x.offsetParent).length };
    });
    note(narrow.height <= 60 && !narrow.overflow && narrow.tools === 11, 'watches: the top bar with « Quart » holds on one line at 1 024 px', JSON.stringify(narrow));
    await page.setViewportSize(size);
    await sleep(300);
    await page.click('#dlg-watch [data-watch="send"]');
    await sleep(200);
    const sent = await game(page, () => ({
      joining: window.__game.world.escorts.filter((e) => e.joinTarget).length, settled: document.querySelectorAll('#dlg-watch .decision.settled').length,
    }));
    note(sent.joining === 1 && sent.settled === 1, 'watches: « Envoyer » sends a group and the decision is settled', JSON.stringify(sent));
    await page.click('#dlg-watch [data-watch="resume"]');
    await sleep(200);
    const r = await game(page, () => ({ paused: window.__game.paused, speed: window.__game.speed, open: document.getElementById('dlg-watch').open }));
    note(!r.paused && r.speed === 600 && !r.open, 'watches: « Reprendre » goes on at the speed of before', JSON.stringify(r));
  });
  await step('signals tab', async () => {
    await playUntil(page, () => false, 36);
    await closeDialogs(page);
    await page.click('[data-log-tab="signals"]');
    await sleep(400);
    const lines = await game(page, () => document.querySelectorAll('#signals .watch-line').length);
    note(lines >= 6, 'watches: the « Signaux » tab lists the reports', `${lines} lines`);
    // (2.10.4) From the tab: the last report, or the one of a line, as the page of the relief.
    const tab = await game(page, () => ({
      last: document.querySelector('#signals [data-watch="last"]')?.textContent || '', opens: document.querySelectorAll('#signals .watch-line [data-watch="page"]').length,
      third: document.querySelectorAll('#signals .watch-line')[2]?.dataset.reportId || '',
    }));
    note(/Rouvrir le rapport de la relève de \d+ h/.test(tab.last) && tab.opens === lines, 'watches: the tab offers the last report again, and « Ouvrir » on every line', JSON.stringify(tab));
    await page.click('#signals [data-watch="last"]');
    await sleep(300);
    const lastOpen = await game(page, () => ({ open: document.getElementById('dlg-watch').open, id: document.getElementById('dlg-watch').dataset.reportId, newest: window.__game.world.watch.reports.at(-1).id }));
    note(lastOpen.open && lastOpen.id === lastOpen.newest, 'watches: … the last report opens as the page', JSON.stringify(lastOpen));
    await page.click('#dlg-watch [data-watch="close"]');
    await sleep(200);
    await page.click('#signals .watch-line:nth-child(1) [data-watch="page"]');
    await sleep(300);
    const lineOpen = await game(page, () => ({ open: document.getElementById('dlg-watch').open, unfolded: document.querySelectorAll('#signals .watch-line.open').length }));
    note(lineOpen.open && lineOpen.unfolded === 0, 'watches: … and a line opens its own, without unfolding', JSON.stringify(lineOpen));
    await shot(page, 'watch-reopened');
    await page.click('#dlg-watch [data-watch="close"]');
    await sleep(200);
    await game(page, () => {
      window.__game.paused = true; // (the pages set the game going again when they close: not here)
    });
    await page.click('#signals .watch-line .watch-head');
    await sleep(300);
    note(await game(page, () => document.querySelectorAll('#signals .watch-line.open .watch-body h4').length >= 4), 'watches: a click unfolds a report');
    await page.click('#signals [data-filter="decide"]');
    await sleep(300);
    const filtered = await game(page, () => document.querySelectorAll('#signals .watch-line').length);
    note(filtered >= 1 && filtered < lines, 'watches: the filter « À décider » keeps the reports with a decision', `${filtered} of ${lines}`);
    await shot(page, 'watch-signals');
    await page.click('[data-log-tab="journal"]');
  });
  await step('radio silence', async () => {
    const id = await game(page, async () => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      const c = a.world.convoys.find((x) => x.state === 'atSea' && x.est);
      if (!c) return null;
      actions.select(a, 'convoy', c.id);
      actions.revealSelection(a);
      a.dirtyPanels = true;
      return c.id;
    });
    note(Boolean(id), 'radio silence: a convoy on the high seas is an estimate');
    await sleep(700);
    await page.click('[data-unit-tab="state"]');
    await sleep(200);
    note(await game(page, () => /Position estimée/.test(document.getElementById('unit-body').textContent) && /Dernier point/.test(document.getElementById('unit-body').textContent)),
      'radio silence: the sheet gives the estimated position and the last sure point');
    await page.click('[data-unit-tab="cmd"]');
    await sleep(200);
    await page.click('#unit-bar [data-action="zigzag"]');
    await sleep(300);
    const sent = await game(page, (cid) => {
      const a = window.__game;
      const c = a.world.convoys.find((x) => x.id === cid);
      return { zigzag: c.zigzag, pending: a.world.signals.filter((s) => s.unitId === cid).map((s) => `${s.name}:${s.via}`), text: document.getElementById('unit-body').textContent };
    }, id);
    note(!sent.zigzag && sent.pending.includes('zigzag:radio') && /par radio/.test(sent.text), 'radio silence: an order goes by radio at the next relief, and the sheet says so', JSON.stringify(sent.pending));
    await shot(page, 'radio-silence');
    // (2.10.4) A line drawn for it waits for the relief too: it stays on the map as the route
    // worked on (its points, the ring at its end), and a second line is drawn on from there.
    const table = () => game(page, (cid) => {
      const a = window.__game;
      const r = a.canvas.getBoundingClientRect();
      const at = (h) => (h ? [Math.round(r.left + h.x), Math.round(r.top + h.y)] : null);
      const route = a.world.signals.find((s) => s.unitId === cid && s.name === 'route');
      return {
        mark: at(a.hits.find((h) => h.kind === 'convoy' && h.id === cid)), ring: at(a.hits.find((h) => h.kind === 'routeExtend' && h.id === cid)),
        handles: a.hits.filter((h) => h.kind === 'routePoint' && h.id === cid).length, waiting: route ? route.args[0].length : 0, signal: route ? route.id : '',
        own: a.world.convoys.find((x) => x.id === cid).route.length,
        hint: document.querySelector('#unit-body .state-line.awaited')?.textContent || '',
        legs: [...document.querySelectorAll('#unit-body ol.legs li')].map((li) => `${li.className}|${li.textContent.replace(/\s+/g, ' ').trim()}`),
        pending: a.world.signals.filter((s) => s.unitId === cid).map((s) => s.name),
      };
    }, id);
    // The mark of the convoy in the open part of the map; the line goes back toward mid-ocean.
    const aim = await game(page, async (cid) => {
      const a = window.__game;
      const cam = await import('./src/render/camera.js');
      const G = await import('./src/sim/geo.js');
      const h = a.hits.find((x) => x.kind === 'convoy' && x.id === cid);
      if (h) cam.panBy(a.camera, 330 - h.x, 420 - h.y);
      await new Promise((res) => setTimeout(res, 400));
      const m = a.hits.find((x) => x.kind === 'convoy' && x.id === cid);
      const [tx, ty] = cam.toScreen(a.camera, ...G.project(-32, 49));
      const d = Math.hypot(tx - m.x, ty - m.y) || 1;
      return [(tx - m.x) / d, (ty - m.y) / d];
    }, id);
    const drawFrom = async (from, far) => {
      const [ux, uy] = aim;
      await page.mouse.move(from[0], from[1]);
      await page.mouse.down();
      await page.mouse.move(from[0] + ux * far * 0.5 - uy * 14, from[1] + uy * far * 0.5 + ux * 14, { steps: 6 });
      await page.mouse.move(from[0] + ux * far, from[1] + uy * far, { steps: 6 });
      await page.mouse.up();
      await sleep(450);
    };
    const before = await table();
    // The first line as the drag from the mark gives it (a handle of its present route may
    // lie under the mark: the mouse is kept for the ring, which is what is new).
    await game(page, async ([cid, ux, uy]) => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      const h = a.hits.find((x) => x.kind === 'convoy' && x.id === cid);
      actions.finishDrawing(a, h, [[h.x, h.y], [h.x + ux * 40 - uy * 14, h.y + uy * 40 + ux * 14], [h.x + ux * 80, h.y + uy * 80]]);
      await new Promise((res) => setTimeout(res, 450));
    }, [id, ...aim]);
    const drawn = await table();
    note(drawn.waiting >= 1 && drawn.own === before.own && drawn.handles === drawn.waiting && Boolean(drawn.ring) && /en attente.*relève de \d+ h/.test(drawn.hint),
      'radio silence: a line drawn waits for the relief and stays on the table, with its points and the ring at its end', JSON.stringify({ ...drawn, legs: null }));
    if (drawn.ring) await drawFrom(drawn.ring, 70);
    const longer = await table();
    note(longer.waiting > drawn.waiting && longer.pending.filter((x) => x === 'route').length === 1 && longer.own === before.own,
      'radio silence: a second line is drawn on from its end, and one order waits', JSON.stringify({ waiting: longer.waiting, pending: longer.pending }));
    await shot(page, 'radio-line-waiting');
    // Taken back before it leaves (the convoy keeps its route for the rest of this game).
    await page.click(`#unit-body [data-action="comms-cancel"][data-signal="${longer.signal}"]`);
    await sleep(350);
    const back = await table();
    note(back.waiting === 0 && back.handles === before.handles && !back.hint, 'radio silence: « Annuler » takes the line back, the route of the ship is the one worked on again', JSON.stringify({ ...back, legs: null }));
    // Legs typed: listed as on their way until they are sent.
    await page.fill('#leg-heading', '250');
    await page.fill('#leg-end', '6');
    await page.click('#unit-body [data-action="add-leg"]');
    await sleep(400);
    const legs = await table();
    note(legs.legs.length === 1 && /^awaited\|Cap 250° pendant 6 h à transmettre/.test(legs.legs[0]) && legs.pending.includes('addLeg') && /^En ocre : transmis à la relève de \d+ h\.$/.test(legs.hint),
      'radio silence: a leg typed is listed as on its way', JSON.stringify(legs.legs));
    await shot(page, 'radio-legs-waiting');
    const legSignal = await game(page, (cid) => window.__game.world.signals.find((s) => s.unitId === cid && s.name === 'addLeg').id, id);
    await page.click(`#unit-body [data-action="comms-cancel"][data-signal="${legSignal}"]`);
    await sleep(300);
    note((await table()).legs.length === 0, 'radio silence: … and taken back, it leaves the list');
    const done = await playUntil(page, (a) => a.world.signals.length === 0, 5);
    note(done && await game(page, (cid) => window.__game.world.convoys.find((x) => x.id === cid).zigzag, id), 'radio silence: the order takes effect at the relief');
  });
  await step('depth charges', async () => {
    await game(page, async () => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      // A group that is not refitting: in refit the sheet has no orders against the U-boats.
      const group = a.world.escorts.find((e) => e.state !== 'refit') || a.world.escorts[0];
      // The sheet on its first tab, the orders (an earlier part may have left it on « Fiche »).
      a.unitTabs = {};
      actions.select(a, 'escort', group.id);
      a.dirtyPanels = true;
    });
    // (The sheet is redrawn on the next image: waited for, not guessed with a pause.)
    const shown = await page.waitForFunction(() => /Grenades \d+\/\d+/.test(document.getElementById('unit-summary').textContent)
      && document.querySelectorAll('[data-action="escort-pattern"]').length === 2, null, { timeout: 5000 }).then(() => true, () => false);
    note(shown || await game(page, () => /Grenades \d+\/\d+/.test(document.getElementById('unit-summary').textContent)), 'depth charges: the gauge is on the group\'s sheet');
    const seen = await game(page, () => {
      const a = window.__game;
      const e = a.world.escorts.find((x) => x.id === a.selection?.id);
      return `${document.querySelectorAll('[data-action="escort-pattern"]').length} buttons, group ${e ? `${e.id} ${e.state}` : 'none'}, tab ${document.querySelector('#unit-tabs .active')?.dataset.unitTab}`;
    });
    note(shown, 'depth charges: « Plein » and « Économe »', shown ? '' : seen);
  });
  await step('first attack of the night', async () => {
    await closeDialogs(page);
    const hit = await playUntil(page, (a) => a.world.events.some((e) => e.type === 'seaStop' && e.reason === 'attack'), 40 * 24);
    note(hit, 'watches: the first attack on a convoy in the night stops the game');
    await sleep(500);
    await game(page, () => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    const s = await game(page, () => ({ paused: window.__game.paused, alert: !document.getElementById('alert').hidden, title: document.getElementById('alert-title').textContent }));
    note(s.paused && s.alert && /attaqué/.test(s.title), 'watches: the attack raises its alert, in pause', JSON.stringify(s));
    await shot(page, 'watch-attack');
  });
  await convoyEnds(page);
  note(errors.length === before, 'watches: no console error', errors.slice(before, before + 2).join(' | '));
}

/**
 * (2.10.5) The end of a convoy's route, in its sheet and on the map: what the convoy does by
 * itself is the choice shown, and every port that takes it is offered by each of its
 * channels; by radio the choice waits for the relief; told at once, the way it will take is
 * drawn after the end of its line, and taken there. The coastal convoy of Kanalkampf has its
 * own port, and its lines that stop off Dover are accepted.
 */
async function convoyEnds(page) {
  /** The sheet of a convoy on its orders: its list « En fin de tracé », and what is said under it. */
  const sheet = async (id) => {
    await game(page, async (cid) => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      a.unitTabs = {};
      actions.select(a, 'convoy', cid);
      a.dirtyPanels = true;
    }, id);
    await sleep(450);
    return game(page, async (cid) => {
      const a = window.__game;
      const E = await import('./src/ui/convoyEnd.js');
      const c = a.world.convoys.find((x) => x.id === cid);
      const sel = document.getElementById(`convoy-end-${cid}`);
      const way = E.endPreview(a.world, c);
      const port = way && way.action.kind === 'port' ? a.world.byId.port.get(way.action.id) : null;
      const last = way && way.points ? way.points[way.points.length - 1] : null;
      return {
        label: sel ? sel.closest('label').firstChild.textContent.trim() : '', value: sel ? sel.value : null,
        options: sel ? [...sel.options].map((o) => o.textContent) : [],
        hints: [...document.querySelectorAll('#unit-body .hint, #unit-body .state-line')].map((x) => `${x.classList.contains('awaited') ? 'awaited|' : ''}${x.textContent}`),
        end: c.endAction ? E.endValue(c.endAction) : '', destination: c.destination || '', state: c.state, route: c.route.length, locked: c.routeLocked || 0,
        pending: a.world.signals.filter((s) => s.unitId === cid).map((s) => `${s.name}:${s.via}`),
        way: way ? { action: E.endValue(way.action), waiting: way.waiting, points: way.points ? way.points.length : 0, toPort: Boolean(port && last && Math.hypot(last[0] - port.x, last[1] - port.y) < 1) } : null,
      };
    }, id);
  };
  /** The map on (lon, lat) at `scale` px a km, in the part the sheet leaves open. */
  const view = async (lon, lat, scale) => {
    await game(page, async ([lo, la, s]) => {
      const a = window.__game;
      const G = await import('./src/sim/geo.js');
      const actions = await import('./src/ui/actions.js');
      a.camera.scale = s;
      actions.centreOn(a, ...G.project(lo, la), s);
    }, [lon, lat, scale]);
    await sleep(900);
  };
  const SOUTH = 'port:liverpool:Canal Saint-Georges';

  await step('convoy end by radio', async () => {
    await closeDialogs(page);
    await game(page, () => {
      const a = window.__game;
      a.paused = true;
      if (a.alert) a.alert = null;
    });
    // A convoy on the high seas, on a route of its own that goes into port (the Admiralty's).
    const id = await game(page, async () => {
      const a = window.__game;
      const C = await import('./src/sim/comms.js');
      const c = a.world.convoys.find((x) => x.state === 'atSea' && !x.straggler && x.destination && x.route.length > (x.routeLocked || 0)
        && C.orderChannel(a.world, x) === 'radio' && !a.world.signals.some((s) => s.unitId === x.id));
      return c ? c.id : null;
    });
    note(Boolean(id), 'convoy end: a convoy on the high seas, bound for a port');
    if (!id) return;
    const own = await sheet(id);
    note(own.label === 'En fin de tracé' && /^port:(liverpool|clyde):/.test(own.value) && own.end === '' && own.hints.some((h) => /^Sans autre ordre, le convoi entre de lui-même dans ce port\.$/.test(h)),
      'convoy end: on the route the Admiralty gave it, the list shows the port and the channel it takes by itself', JSON.stringify({ value: own.value, end: own.end }));
    note(['S\'arrêter et attendre', 'Garder le cap', 'Entrer à Liverpool par : Nord de l\'Irlande', 'Entrer à Liverpool par : Canal Saint-Georges', 'Entrer à la Clyde par : Nord de l\'Irlande',
      'Reprendre la route de l\'Amirauté'].every((x) => own.options.includes(x)) && own.options.length === 6, 'convoy end: every port that takes the convoy is offered by each of its channels', own.options.join(' | '));
    const other = own.value === SOUTH ? 'port:clyde:Nord de l\'Irlande' : SOUTH;
    await page.selectOption(`#convoy-end-${id}`, other);
    await sleep(450);
    const told = await sheet(id);
    note(told.pending.includes('endAction:radio') && told.end === '' && told.destination === own.destination && told.value === other
      && told.hints.some((h) => /^awaited\|En attente : « Entrer à .* », transmis par radio à la relève de \d+ h/.test(h)),
      'convoy end: by radio the choice waits for the relief, the list shows it and the convoy knows nothing yet', JSON.stringify({ pending: told.pending, value: told.value, end: told.end }));
    note(Boolean(told.way) && told.way.waiting && told.way.action === other && told.way.toPort,
      'convoy end: the map draws, in the colour of an order on its way, the way from the end of its line to the port chosen', JSON.stringify(told.way));
    await view(-10, 54, 0.55);
    await shot(page, 'convoy-end-radio');
    const passed = await playUntil(page, (a) => !a.world.signals.some((s) => s.name === 'endAction'), 5);
    await game(page, () => {
      const a = window.__game;
      a.paused = true;
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    const got = await sheet(id);
    note(passed && got.end === other && got.destination === '' && got.locked === 0 && got.value === other && !got.hints.some((h) => /^awaited/.test(h)),
      'convoy end: at the relief the convoy is told; its line no longer goes into the first port by itself, and ends as chosen', JSON.stringify({ end: got.end, destination: got.destination, locked: got.locked }));
  });

  await step('convoy end carried out', async () => {
    // A game where orders reach the ships at once, six days on: a convoy in mid-ocean.
    const kept = await game(page, () => {
      const a = window.__game;
      const before = a.settings.seaComms;
      a.settings.seaComms = 'direct';
      a.restart('hiver-atlantique');
      return before;
    });
    await settle(page);
    const id = await game(page, () => {
      const a = window.__game;
      a.paused = true;
      for (let i = 0; i < 4000 && !a.world.convoys.some((c) => c.state === 'atSea'); i++) a.stepWorld(60);
      for (let i = 0; i < 6 * 24 * 60; i++) a.stepWorld(60);
      const c = a.world.convoys.find((x) => x.state === 'atSea' && x.type === 'ocean' && !x.straggler);
      return c ? c.id : null;
    });
    await settle(page);
    note(Boolean(id), 'convoy end: a convoy at sea, six days on');
    if (!id) return;
    // A line of two points to the open sea, some 200 km on, as the drawing sends it.
    const routed = await game(page, async (cid) => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      const G = await import('./src/sim/geo.js');
      const c = a.world.convoys.find((x) => x.id === cid);
      const [lon, lat] = G.unproject(c.x, c.y);
      const sent = actions.shipOrder(a, c, 'route', [G.project(lon + 1.5, lat - 0.2), G.project(lon + 3, lat - 0.5)]);
      return { ok: sent.ok, via: sent.via, destination: c.destination || '', lon: Math.round(lon), lat: Math.round(lat) };
    }, id);
    const open = await sheet(id);
    note(routed.ok && routed.via === 'direct' && open.value === 'stop' && open.destination === '' && !open.way && !open.hints.some((h) => /Sans autre ordre/.test(h)),
      'convoy end: a line that ends in the open sea ends in a stop, told nothing', JSON.stringify({ routed, value: open.value }));
    await page.selectOption(`#convoy-end-${id}`, SOUTH);
    await sleep(450);
    const told = await sheet(id);
    note(told.end === SOUTH && told.value === SOUTH && told.destination === '' && told.route === 2,
      'convoy end: « Entrer à Liverpool par : Canal Saint-Georges » is taken at once, and the line is left as drawn', JSON.stringify({ end: told.end, route: told.route }));
    note(Boolean(told.way) && !told.way.waiting && told.way.toPort && told.way.points >= 9,
      'convoy end: the map draws the way from the end of the line to the entrance of that channel and up it', JSON.stringify(told.way));
    await view((routed.lon - 7) / 2, 52, 0.22);
    await shot(page, 'convoy-end-chosen');
    const done = await playUntil(page, (a) => a.world.events.some((e) => e.type === 'convoyEndAction'), 30);
    await game(page, () => {
      const a = window.__game;
      a.paused = true;
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    const after = await sheet(id);
    const said = await game(page, () => [...document.querySelectorAll('#log li')].some((li) => /fin de sa route, il fait route vers Liverpool par l'entrée du chenal \(Canal Saint-Georges\)/.test(li.textContent)));
    note(done && after.destination === 'liverpool' && after.end === '' && after.state === 'atSea' && said,
      'convoy end: at the end of its line the convoy makes for the entrance of the channel chosen, and the journal says so', JSON.stringify({ destination: after.destination, state: after.state, said }));
    await view((routed.lon - 7) / 2, 52, 0.22);
    await shot(page, 'convoy-end-done');
    await game(page, (v) => {
      window.__game.settings.seaComms = v;
    }, kept);
  });

  await step('convoy end of the coastal convoy', async () => {
    await game(page, () => {
      window.__game.restart('kanalkampf');
    });
    await settle(page);
    await game(page, () => {
      window.__game.paused = true;
    });
    const id = await game(page, () => (window.__game.world.convoys.find((c) => c.type === 'coastal') || {}).id || null);
    note(Boolean(id), 'convoy end: Kanalkampf has its coastal convoy');
    if (!id) return;
    const inPort = await sheet(id);
    note(inPort.value === null, 'convoy end: at anchor with nothing prepared, there is no end to choose');
    // Out of the Thames and round the North Foreland, to stop off Dover: a line the game
    // refused until 2.10.4 (it sent it straight to Spithead, across Kent).
    const routed = await game(page, async (cid) => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      const c = a.world.convoys.find((x) => x.id === cid);
      const sent = actions.shipOrder(a, c, 'route', c.admiraltyRoute.slice(1, 5).map(([x, y]) => [x, y]));
      return { ok: sent.ok, state: c.state, route: c.route.length, destination: c.destination || '' };
    }, id);
    note(routed.ok && routed.state === 'atSea' && routed.route === 4 && routed.destination === '', 'convoy end: a line of the coastal convoy that stops off Dover is accepted as drawn', JSON.stringify(routed));
    const open = await sheet(id);
    note(open.options.join(' | ') === 'S\'arrêter et attendre | Garder le cap | Entrer à Southampton par : Spithead | Reprendre la route de l\'Amirauté' && open.value === 'stop',
      'convoy end: the coastal convoy is offered its own port, Southampton by Spithead, and no ocean port', open.options.join(' | '));
    await page.selectOption(`#convoy-end-${id}`, 'port:southampton:Spithead');
    await sleep(450);
    const told = await sheet(id);
    note(told.end === 'port:southampton:Spithead' && Boolean(told.way) && told.way.toPort && told.way.points >= 7,
      'convoy end: the way to Southampton is drawn round the land, by sea', JSON.stringify(told.way));
    await view(0.2, 50.95, 2.3);
    await shot(page, 'convoy-end-coastal');
    const done = await playUntil(page, (a) => a.world.events.some((e) => e.type === 'convoyEndAction' || e.type === 'convoyRouteRejected'), 14);
    const after = await sheet(id);
    note(done && after.destination === 'southampton' && after.end === '', 'convoy end: off Dover the coastal convoy makes for Spithead and Southampton', JSON.stringify({ destination: after.destination, state: after.state }));
  });
}

/** Answers the confirmation dialog when it is open (yes or no); returns whether it was. */
async function confirmAnswer(page, yes) {
  await sleep(150);
  const open = await game(page, () => document.getElementById('dlg-confirm').open);
  if (open) await page.click(`#dlg-confirm [data-confirm="${yes ? 'yes' : 'no'}"]`);
  await sleep(150);
  return open;
}

/** What tells one state of a game from another: scenario, clock, dice, a count of its units. */
const fingerprint = (page) => game(page, () => {
  const w = window.__game.world;
  return JSON.stringify([w.scenario.id, w.t, w.rng.state, w.squadrons.length, w.convoys.map((c) => [c.id, Math.round(c.x), c.ships]), w.settings.preset]);
});

/**
 * M2.9, the gate: every scenario is launched, saved and loaded again from the menu. And the
 * rest of the lot that lives in the page: Continuer, the confirmations, the settings of the
 * game, the automatic saves, a save refused, a storage that fails, the end of a game.
 */
async function menus(page, errors) {
  const before = errors.length;
  const ids = await game(page, () => window.__game.data.campaign.scenarios.concat(window.__game.data.campaign.training));
  await step('menu: every scenario from the menu', async () => {
    await game(page, () => {
      const a = window.__game;
      a.campaign.unlockAll = true;
      a.toMainMenu();
    });
    for (const id of ids) {
      // Launched from the page of the scenarios.
      await game(page, () => window.__game.toMainMenu());
      await page.click('#menu [data-menu="scenarios"]');
      await page.click(`#menu .mm-card [data-play="${id}"]:not([data-tutorial])`);
      await confirmAnswer(page, true);
      await sleep(500);
      await settle(page);
      const started = await game(page, (sid) => !window.__game.onMenu && window.__game.world.scenario.id === sid && window.__game.world.t < 900, id);
      note(started, `${id}: launched from the menu`);
      // Played a little (then paused: what is compared must not move), and saved from the ☰ menu.
      await game(page, () => {
        window.__game.stepWorld(3 * 3600 + 17);
        window.__game.paused = true;
      });
      await settle(page);
      // (Closing the page of a watch report sets the game going again: paused once more.)
      await game(page, () => { window.__game.paused = true; });
      const mark = await fingerprint(page);
      await page.click('#btn-menu');
      await page.click('#dlg-menu [data-gm="save"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-menu [data-gm-message]').hidden, null, { timeout: 8000 });
      const said = await game(page, () => document.querySelector('#dlg-menu [data-gm-message]').textContent);
      note(/sauvegardée/.test(said), `${id}: saved from the ☰ menu`, said.slice(0, 60));
      // Back to the main menu (the game is kept), the game goes on elsewhere, then the save is loaded.
      await page.click('#dlg-menu [data-gm="main"]');
      await sleep(200);
      const onMenu = await game(page, () => window.__game.onMenu && /Continuer/.test(document.querySelector('#menu .mm-entry').textContent));
      note(onMenu, `${id}: « Menu principal » shows the menu, with « Continuer »`);
      await page.click('#menu [data-menu="continue"]');
      await sleep(200);
      await game(page, () => {
        window.__game.stepWorld(2 * 3600);
        window.__game.paused = true;
      });
      await settle(page);
      note((await fingerprint(page)) !== mark, `${id}: the game went on after the save`);
      await game(page, () => window.__game.toMainMenu());
      await page.click('#menu [data-menu="load"]');
      await page.click('#menu .mm-save.manual [data-load]');
      note(await confirmAnswer(page, true), `${id}: loading over a game under way asks first`);
      await page.waitForFunction(() => !window.__game.onMenu, null, { timeout: 8000 });
      await settle(page);
      const loaded = await fingerprint(page);
      note(loaded === mark, `${id}: the save loaded is the game as it was saved`, loaded === mark ? '' : `${loaded.slice(0, 90)} ≠ ${mark.slice(0, 90)}`);
      // The save is deleted (asked first), so that the next scenario finds its own.
      await game(page, () => window.__game.toMainMenu());
      await page.click('#menu [data-menu="load"]');
      await page.click('#menu .mm-save.manual [data-delete]');
      note(await confirmAnswer(page, true), `${id}: deleting a save asks first`);
      await sleep(150);
      note(await game(page, () => document.querySelectorAll('#menu .mm-save.manual').length === 0), `${id}: the save is deleted`);
    }
    await shot(page, 'menu-load');
  });
  await step('menu: the preset is chosen where a game is launched', async () => {
    await game(page, () => window.__game.toMainMenu());
    await page.click('#menu [data-menu="scenarios"]');
    await page.click('#menu [data-preset="realistic"]');
    await sleep(150);
    note(await game(page, () => document.querySelector('#menu [data-preset="realistic"]').classList.contains('active') && window.__game.settings.preset === 'realistic'),
      'menu: « Réaliste » chosen on the page of the scenarios becomes the preset of the games to come');
    await page.click('#menu .mm-card [data-play="quinze-septembre"]');
    await confirmAnswer(page, true);
    await sleep(500);
    await settle(page);
    const begun = await game(page, () => {
      const w = window.__game.world;
      return { preset: w.settings.preset, start: w.presetStart, detection: w.settings.detection, scenario: w.scenario.id };
    });
    note(begun.scenario === 'quinze-septembre' && begun.preset === 'realistic' && begun.start === 'realistic' && begun.detection === 'delayed',
      'menu: the game launched begins in Réaliste', JSON.stringify(begun));
    // Back to Standard for what follows: the game under way keeps its own preset.
    await game(page, () => window.__game.toMainMenu());
    await page.click('#menu [data-menu="campaign"]');
    await page.click('#menu [data-preset="standard"]');
    await sleep(150);
    note(await game(page, () => window.__game.settings.preset === 'standard' && window.__game.world.settings.preset === 'realistic'),
      'menu: changing the preset of the games to come leaves the game under way as it is');
    await shot(page, 'menu-campaign');
  });
  await step('menu: Continuer after the page is closed', async () => {
    await game(page, () => window.__game.restart('adlertag'));
    await settle(page);
    await game(page, () => {
      window.__game.stepWorld(5 * 3600);
      window.__game.paused = true;
    });
    await settle(page);
    const mark = await fingerprint(page);
    await page.reload();
    await page.waitForFunction(() => window.__game && window.__game.onMenu, null, { timeout: 20000 });
    const line = await game(page, () => document.querySelector('#menu [data-menu="continue"]')?.textContent || '');
    note(/Adlertag/.test(line) && /de jeu/.test(line), 'menu: « Continuer » names the game left (scenario, game date, time played)', line.slice(0, 90));
    await shot(page, 'menu-continue');
    await page.click('#menu [data-menu="continue"]');
    await sleep(300);
    await settle(page);
    note((await fingerprint(page)) === mark, 'menu: the game left is resumed as it was');
  });
  await step('menu: confirmations', async () => {
    // A new game over a game under way: asked; « Annuler » keeps the game.
    await game(page, () => { window.__game.paused = true; });
    await settle(page);
    const mark = await fingerprint(page);
    await game(page, () => window.__game.toMainMenu());
    await page.click('#menu [data-menu="campaign"]');
    await page.click('#menu [data-play="kanalkampf"]');
    note(await confirmAnswer(page, false), 'menu: a new game over a game under way asks first');
    note(await game(page, () => window.__game.onMenu) && (await fingerprint(page)) === mark, 'menu: « Annuler » keeps the game under way');
    await page.click('#menu [data-menu="home"]');
    await page.click('#menu [data-menu="continue"]');
    await sleep(200);
    // Recommencer: at once in the first ten minutes, asked after.
    await page.click('#btn-menu');
    await page.click('#dlg-menu [data-gm="restart"]');
    await sleep(300);
    const early = await game(page, () => document.getElementById('dlg-confirm').open);
    note(!early && await game(page, () => window.__game.world.t < 60), 'menu: « Recommencer » restarts at once in the first ten minutes');
    await settle(page);
    await game(page, () => {
      const a = window.__game;
      a.stepWorld(3600);
      a.paused = true;
      a.playClock.totalMs = 11 * 60 * 1000;
    });
    await settle(page);
    await page.click('#btn-menu');
    await page.click('#dlg-menu [data-gm="restart"]');
    note(await confirmAnswer(page, false), 'menu: « Recommencer » asks first after ten minutes of play');
    note(await game(page, () => window.__game.world.t >= 3600), 'menu: « Annuler » keeps the game');
    await closeDialogs(page);
  });
  await step('menu: the settings of the game', async () => {
    await game(page, () => window.__game.restart('adlertag'));
    await settle(page);
    await page.click('#btn-menu');
    await page.click('#dlg-menu [data-gm="settings"]');
    await sleep(200);
    const scope = await game(page, () => document.querySelector('#dlg-settings .settings-scope')?.textContent || '');
    note(/partie en cours/.test(scope), 'settings: opened from a game, they are those of the game');
    const mine = await game(page, () => window.__game.settings.preset);
    await page.selectOption('#dlg-settings select[name="preset"]', 'realistic');
    await sleep(150);
    const after = await game(page, () => {
      const a = window.__game;
      return { world: a.world.settings.preset, start: a.world.presetStart, mine: a.settings.preset, detection: a.world.settings.detection, log: document.getElementById('log').textContent };
    });
    note(after.world === 'realistic' && after.detection === 'delayed', 'settings: the preset of the game changes by an order', JSON.stringify([after.world, after.detection]));
    note(after.mine === mine, 'settings: the player\'s own settings are left alone', `${mine} → ${after.mine}`);
    await closeDialogs(page);
    await sleep(400);
    note(/Préréglage de la partie changé/.test(await game(page, () => document.getElementById('log').textContent)), 'settings: the journal notes the change');
    // Saved with the game: it comes back after the page is closed.
    await page.reload();
    await page.waitForFunction(() => window.__game && window.__game.onMenu, null, { timeout: 20000 });
    await page.click('#menu [data-menu="continue"]');
    await sleep(300);
    const back = await game(page, () => [window.__game.world.settings.preset, window.__game.world.presetStart]);
    note(back[0] === 'realistic' && back[1] !== 'realistic', 'settings: saved with the game, with the preset it began with', back.join(', '));
    await settle(page);
  });
  await step('menu: automatic saves', async () => {
    await game(page, () => window.__game.restart('kanalkampf'));
    await settle(page);
    // Seven game days: one automatic save a day, the last five kept.
    for (let day = 0; day < 7; day++) {
      await game(page, () => window.__game.stepWorld(86400));
      await closeDialogs(page);
      await sleep(350);
    }
    // (Of this game: the games played before it in this test keep their newest one each.)
    const autos = await game(page, () => window.__game.store.entries().filter((e) => e.kind === 'auto' && e.gameId === window.__game.gameId).map((e) => Math.floor(e.t / 86400)));
    note(autos.length === 5, 'saves: the last five automatic saves of the game are kept', autos.join(' '));
    note(new Set(autos).size === autos.length, 'saves: one a game day');
    const others = await game(page, () => window.__game.store.entries().filter((e) => e.kind === 'auto' && e.gameId !== window.__game.gameId).map((e) => e.gameId));
    note(others.length >= 1 && others.length <= 5 && new Set(others).size === others.length, 'saves: and the newest of each game played before it, five games at most', `${others.length}`);
    // A battle of one day: every two game hours.
    await game(page, () => window.__game.restart('quinze-septembre'));
    await settle(page);
    const n0 = await game(page, () => window.__game.store.entries().filter((e) => e.kind === 'auto' && e.scenario === 'quinze-septembre').length);
    for (let h = 0; h < 5; h++) {
      await game(page, () => window.__game.stepWorld(3600));
      await closeDialogs(page);
      await sleep(350);
    }
    const n1 = await game(page, () => window.__game.store.entries().filter((e) => e.kind === 'auto' && e.scenario === 'quinze-septembre').length);
    note(n1 - n0 >= 2 && n1 - n0 <= 3, 'saves: every two game hours in a battle of one day', `${n1 - n0} in five hours`);
  });
  await step('menu: a file refused, a storage that fails', async () => {
    await game(page, () => { window.__game.paused = true; });
    await settle(page);
    await game(page, () => window.__game.toMainMenu());
    await page.click('#menu [data-menu="load"]');
    const mark = await fingerprint(page);
    const savesNow = () => game(page, () => window.__game.store.entries().map((e) => e.id).sort().join(' '));
    const kept = await savesNow();
    let asked = 0;
    const refuse = async (text, label, expected) => {
      await page.setInputFiles('#menu [data-import]', { name: 'partie.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      if (await confirmAnswer(page, true)) asked++;
      await sleep(250);
      const said = await game(page, () => document.querySelector('#menu .message:last-of-type')?.textContent || '');
      note(expected.test(said) && (await fingerprint(page)) === mark, label, said.slice(0, 70));
    };
    await refuse('ceci n\'est pas une partie', 'saves: a file that is not a game is refused, with its reason', /n'est pas une partie/);
    await refuse(JSON.stringify({ game: 'jeu-1940', snap: { version: 99 } }), 'saves: a game of a later version is refused', /version plus récente/);
    const broken = await game(page, () => {
      const a = window.__game;
      const snap = JSON.parse(JSON.stringify({ ...a.world, rules: null, terrain: null, scenario: a.world.scenario.id, byId: null, sites: [], rail: null, grid: null }, (k, v) => (v instanceof Map || v instanceof Set || typeof v === 'function' ? undefined : v)));
      return JSON.stringify({ game: 'jeu-1940', snap: { version: 2, scenario: snap.scenario, t: 10, rng: 1, squadrons: 'none' } });
    });
    await refuse(broken, 'saves: a damaged game is refused, and the game in hand is untouched', /abîmée/);
    // A real save with one line of its journal and one of its parts spoilt (review of 2.9: the
    // first replaced the game in hand while saying it had not; the second loaded, then stopped).
    const spoilt = await game(page, async () => {
      const { buildSave } = await import('./src/ui/game.js');
      const save = JSON.parse(JSON.stringify(buildSave(window.__game)));
      const journal = { ...save, journal: [null, ...save.journal] };
      const part = { ...save, snap: { ...save.snap, formations: null } };
      return { journal: JSON.stringify(journal), part: JSON.stringify(part), lines: save.journal.length };
    });
    await refuse(spoilt.part, 'saves: a save with a part of the wrong kind is refused, naming the part', /abîmée \(la partie « formations »/);
    note(asked === 0, 'saves: a file refused asks nothing first (« Remplacer ? » comes after the file is checked)', `${asked} question(s)`);
    note((await savesNow()) === kept, 'saves: and leaves the saves as they were (no automatic save for a file refused)');
    // The journal with a line that is nothing: the line is left out, the game loads whole.
    await page.setInputFiles('#menu [data-import]', { name: 'partie.json', mimeType: 'application/json', buffer: Buffer.from(spoilt.journal) });
    note(await confirmAnswer(page, true), 'saves: a file that can be loaded asks before it replaces the game in hand');
    await page.waitForFunction(() => !window.__game.onMenu, null, { timeout: 8000 }).catch(() => {});
    note((await fingerprint(page)) === mark && await game(page, (n) => window.__game.logEntries.length === n + 1 && window.__game.paused, spoilt.lines),
      'saves: a journal with a spoilt line loads without it, and the game waits for the player');
    await game(page, () => window.__game.toMainMenu());
    await page.click('#menu [data-menu="load"]');
    // A file exported by the game itself loads.
    await page.click('#menu [data-menu="home"]');
    await page.click('#menu [data-menu="continue"]');
    await sleep(200);
    await game(page, () => { window.__game.paused = true; });
    const exported = await game(page, async () => {
      const a = window.__game;
      const { buildSave } = await import('./src/ui/game.js').catch(() => ({}));
      return buildSave ? JSON.stringify(buildSave(a)) : null;
    });
    if (exported) {
      const now = await fingerprint(page);
      await game(page, () => window.__game.stepWorld(1800));
      await settle(page);
      await game(page, () => window.__game.toMainMenu());
      await page.click('#menu [data-menu="load"]');
      await page.setInputFiles('#menu [data-import]', { name: 'partie.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
      await confirmAnswer(page, true);
      await page.waitForFunction(() => !window.__game.onMenu, null, { timeout: 8000 });
      note((await fingerprint(page)) === now, 'saves: a file exported by the game is loaded as it was');
    }
    // The storage refuses to write: the top bar says so, until a write succeeds.
    await settle(page);
    await game(page, () => {
      const a = window.__game;
      window.__setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
      a.stepWorld(60);
      a.save();
      a.dirtyHud = true;
    });
    await sleep(400);
    note(await page.isVisible('#save-problem'), 'saves: a failed save is shown in the top bar');
    note(/enregistrement a échoué/i.test(await game(page, () => document.getElementById('log').textContent)), 'saves: and told in the journal');
    await game(page, () => {
      Storage.prototype.setItem = window.__setItem;
      window.__game.stepWorld(60);
      window.__game.save();
      window.__game.dirtyHud = true;
    });
    await sleep(400);
    note(!(await page.isVisible('#save-problem')), 'saves: the warning goes when a save succeeds');
    // On the main menu too; and a game that could not be kept is not replaced in silence
    // (review of 2.9: « elle sera gardée parmi les sauvegardes automatiques », then nothing).
    await game(page, () => {
      Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
      window.__game.stepWorld(60);
      window.__game.paused = true;
    });
    await settle(page);
    const held = await fingerprint(page);
    await game(page, () => window.__game.toMainMenu());
    await sleep(200);
    note(await page.isVisible('#menu [data-save-problem]'), 'saves: a failed save is told on the main menu');
    note(!(await page.isVisible('#menu .mm-note')), 'saves: and the menu no longer says the game is kept in the browser');
    await shot(page, 'menu-storage-full');
    await page.click('#menu [data-menu="scenarios"]');
    await page.click('#menu [data-play="kanalkampf"]');
    note(await confirmAnswer(page, true), 'saves: replacing the game asks first');
    await page.waitForFunction(() => document.getElementById('dlg-confirm').open, null, { timeout: 5000 }).catch(() => {});
    const second = await game(page, () => (document.getElementById('dlg-confirm').open ? document.getElementById('dlg-confirm').textContent : ''));
    note(/n'a pas pu être gardée/.test(second) && /Exporter/.test(second) && /Remplacer quand même/.test(second),
      'saves: a game that could not be kept says so before it is replaced, with the export at hand', second.replace(/\s+/g, ' ').slice(0, 90));
    await shot(page, 'not-kept');
    await confirmAnswer(page, false);
    note((await fingerprint(page)) === held && await game(page, () => window.__game.onMenu), 'saves: « Annuler » keeps the game in hand');
    await game(page, () => {
      Storage.prototype.setItem = window.__setItem;
      window.__game.save();
    });
    await page.click('#menu [data-menu="home"]');
    await sleep(150);
    note(!(await page.isVisible('#menu [data-save-problem]')), 'saves: the warning leaves the menu once a save succeeds');
    await page.click('#menu [data-menu="continue"]');
    await sleep(200);
  });
  await step('menu: the keys of the game do nothing under the main menu', async () => {
    // (Review of 2.9: key 3 on the menu set the game going behind it, to its end if left there.)
    await game(page, () => { window.__game.paused = true; });
    await settle(page);
    await game(page, () => window.__game.toMainMenu());
    const state = () => game(page, () => {
      const a = window.__game;
      return { t: a.world.t, paused: a.paused, onMenu: a.onMenu, tool: a.tool || null, cover: Boolean(a.settings.radarCover), scale: Math.round(a.camera.scale * 1000), speed: a.speed };
    });
    const s0 = await state();
    for (const key of ['3', '6', 'r', 'c', 'a', 'l', 'g', '+']) await page.keyboard.press(key);
    await sleep(1500);
    const s1 = await state();
    note(JSON.stringify(s1) === JSON.stringify(s0), 'menu: speed, ruler, radar cover, views and zoom keys change nothing under the menu', `${JSON.stringify(s0)} → ${JSON.stringify(s1)}`);
    // Space on « Continuer » (it has the focus) is the button's own key: back to the game, still stopped.
    await page.focus('#menu [data-menu="continue"]');
    await page.keyboard.press('Space');
    await sleep(400);
    const s2 = await state();
    note(!s2.onMenu && s2.paused && s2.t === s0.t, 'menu: Space on « Continuer » goes back to the game, and does not start its clock', JSON.stringify(s2));
  });
  await step('menu: the end of a game', async () => {
    await game(page, () => {
      const a = window.__game;
      a.campaign.unlockAll = false;
      a.campaign.results = {};
      a.restart('kanalkampf');
    });
    await settle(page);
    // The game is won by decree (the end screen is what is looked at), then ended.
    await game(page, () => {
      const a = window.__game;
      const w = a.world;
      for (const o of w.objectives) o.done = true;
      w.t = w.endS - 120;
      a.stepWorld(200);
    });
    await sleep(700);
    const end = await game(page, () => {
      const dlg = document.getElementById('dlg-end');
      return { open: dlg.open, buttons: [...dlg.querySelectorAll('[data-end]')].map((b) => b.dataset.end), text: dlg.textContent };
    });
    note(end.open && end.buttons.includes('replay') && end.buttons.includes('menu'), 'end: Rejouer and Menu principal', end.buttons.join(' '));
    note(/Victoire|réussi/i.test(end.text), 'end: the game decreed won ends in a victory', end.text.replace(/\s+/g, ' ').slice(0, 80));
    note(end.buttons.includes('next') && /Adlertag/.test(end.text), 'end: « Scénario suivant » after a victory of the campaign');
    note(/Préréglage/.test(end.text) || /commencée en/.test(end.text), 'end: the preset of the game is told');
    await shot(page, 'end');
    // A game that is over, exported then imported: it shows how it ended, not a silent map.
    const over = await game(page, async () => {
      const { buildSave } = await import('./src/ui/game.js');
      return JSON.stringify(buildSave(window.__game));
    });
    await page.click('#dlg-end [data-end="menu"]');
    await sleep(300);
    await page.click('#menu [data-menu="load"]');
    await page.setInputFiles('#menu [data-import]', { name: 'finie.json', mimeType: 'application/json', buffer: Buffer.from(over) });
    await page.waitForFunction(() => !window.__game.onMenu, null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    const again = await game(page, () => {
      const dlg = document.getElementById('dlg-end');
      return { open: dlg.open, ended: window.__game.world.ended, text: dlg.textContent, buttons: [...dlg.querySelectorAll('[data-end]')].map((b) => b.dataset.end) };
    });
    note(again.open && again.ended && /Victoire|réussi/i.test(again.text), 'end: a finished game imported shows its end screen');
    note(again.buttons.includes('next'), 'end: with « Scénario suivant » still at hand', again.buttons.join(' '));
    await page.click('#dlg-end [data-end="next"]');
    await sleep(500);
    note(await game(page, () => window.__game.world.scenario.id === 'adlertag' && !window.__game.onMenu), 'end: the next scenario of the campaign is launched');
    await settle(page);
    note(await game(page, () => window.__game.store.current() === null || window.__game.store.current().scenario !== 'kanalkampf'), 'end: a game that is over is no longer « Continuer »');
  });
  note(errors.length === before, 'menu: no console error', errors.slice(before, before + 2).join(' | '));
}

/**
 * M2.10, the interface in the page: the top bar on one line (C7), the alerts that are not lost
 * (C6), the help of the sheets folded (C8), the stacks and their tabs (C9), the Effectifs
 * button only where the pilots tire (I6), and alert states for everything that flies (2.10.2).
 */
async function interfaceChecks(page, errors) {
  const before = errors.length;
  const start = async (id, settings = null) => {
    await game(page, ([s, own]) => {
      const a = window.__game;
      a.campaign.unlockAll = true;
      if (own) Object.assign(a.settings, own);
      a.restart(s);
    }, [id, settings]);
    await settle(page);
    await game(page, () => {
      window.__game.paused = true;
    });
    await settle(page);
  };
  await step('interface: the top bar (C7)', async () => {
    await page.setViewportSize({ width: 1024, height: 700 });
    for (const id of ['quinze-septembre', 'hiver-atlantique']) {
      await start(id);
      const m = await game(page, () => {
        const hud = document.getElementById('hud');
        const shown = [...hud.querySelectorAll('button')].filter((b) => b.offsetParent);
        const tops = shown.map((b) => b.getBoundingClientRect());
        return {
          height: hud.offsetHeight, buttons: shown.length, overflow: hud.scrollWidth > hud.clientWidth + 1,
          spread: Math.round(Math.max(...tops.map((r) => r.bottom)) - Math.min(...tops.map((r) => r.top))),
          right: Math.round(Math.max(...tops.map((r) => r.right))),
        };
      });
      note(m.height <= 60 && m.spread <= 60 && !m.overflow && m.right <= 1024, `${id}: the top bar holds on one line at 1 024 px`, JSON.stringify(m));
      // … with the word under each pictogram (review of 2.10: hidden under 1 250 px, where a
      // tablet has no bubble to name them), and with the sign of a save that failed.
      const worst = await game(page, async () => {
        const a = window.__game;
        const was = a.saveProblem;
        a.saveProblem = true;
        a.dirtyHud = true;
        await new Promise((r) => setTimeout(r, 250));
        const hud = document.getElementById('hud');
        const out = {
          height: hud.offsetHeight, overflow: hud.scrollWidth > hud.clientWidth + 1,
          labels: [...hud.querySelectorAll('.tool-label')].filter((x) => x.offsetParent && x.getBoundingClientRect().height > 0).length,
          tools: [...hud.querySelectorAll('button.tool')].filter((x) => x.offsetParent).length,
          sign: document.getElementById('save-problem').getBoundingClientRect().width,
        };
        a.saveProblem = was;
        a.dirtyHud = true;
        return out;
      });
      note(worst.height <= 60 && !worst.overflow && worst.labels >= worst.tools && worst.sign > 0 && worst.sign < 50,
        `${id}: … with a word under each pictogram and the sign « non enregistré »`, JSON.stringify(worst));
      await shot(page, `bar-1024-${id}`);
    }
    // In the Atlantic: one « Vue » button, with the views of the scenario and their keys.
    const tips = await game(page, () => ['btn-ruler', 'btn-view', 'btn-journal', 'btn-help', 'btn-menu'].map((id) => document.getElementById(id).title));
    note(tips[0] === 'Règle (R)' && /Vue/.test(tips[1]) && /\(J\)/.test(tips[2]) && /\(\?\)/.test(tips[3]), 'top bar: each tool tells its name and its key', tips.join(' | '));
    note(await game(page, () => !document.getElementById('btn-atlantic') && !document.getElementById('btn-settings')), 'top bar: the three view buttons and Réglages are gone from it');
    await page.click('#btn-view');
    await sleep(150);
    const views = await game(page, () => ({ open: !document.getElementById('view-menu').hidden, names: [...document.querySelectorAll('#view-menu [data-view]')].map((b) => b.dataset.view) }));
    note(views.open && views.names.join(',') === 'atlantic,britain', 'top bar: « Vue » lists the views of the scenario', views.names.join(','));
    await shot(page, 'bar-view-menu');
    // Escape closes the list first (review of 2.10: it stayed open).
    await page.keyboard.press('Escape');
    await sleep(100);
    note(await game(page, () => document.getElementById('view-menu').hidden), 'top bar: Escape closes the list of the views');
    await page.click('#btn-view');
    await sleep(150);
    const scale0 = await game(page, () => window.__game.camera.scale);
    await page.click('#view-menu [data-view="britain"]');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 8000 });
    note(await game(page, (s) => document.getElementById('view-menu').hidden && window.__game.camera.scale > s * 1.5, scale0), 'top bar: a view chosen frames the map and closes the menu');
    // A view the scenario does not offer has no key either (England, in the Atlantic).
    const cam = () => game(page, () => [Math.round(window.__game.camera.cx), Math.round(window.__game.camera.cy), Math.round(window.__game.camera.scale * 1000)].join(','));
    const here = await cam();
    await page.keyboard.press('g');
    await sleep(700);
    note((await cam()) === here, 'top bar: the key of a view the scenario does not offer does nothing');
    await page.keyboard.press('a');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 8000 });
    note((await cam()) !== here, 'top bar: the key of a view it offers goes there');
    await page.keyboard.press('?');
    await sleep(250);
    note(await game(page, () => document.getElementById('dlg-help').open), 'top bar: « ? » opens the help');
    await closeDialogs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(200);
    note(await game(page, () => [...document.querySelectorAll('#hud .tool-label')].some((x) => x.offsetParent && x.textContent.trim().length > 2)), 'top bar: with room, a short word stands under each pictogram');
    await shot(page, 'bar-1440');
  });
  await step('interface: Effectifs only where the pilots tire (I6)', async () => {
    await start('adlertag', { fatigue: 'off' });
    const off = await game(page, async () => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      a.unitTabs = { squadron: 'cmd' };
      actions.select(a, 'squadron', a.world.squadrons.find((s) => s.role === 'fighter').id);
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 300));
      return { button: document.getElementById('btn-roster').hidden, link: Boolean(document.querySelector('#unit-panel [data-action="open-roster"]')), fatigue: a.world.settings.fatigue };
    });
    note(off.fatigue === 'off' && off.button && !off.link, 'without fatigue: no Effectifs button, no link to the plans in the sheet', JSON.stringify(off));
    await start('adlertag', { fatigue: 'on' });
    const on = await game(page, async () => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      a.unitTabs = { squadron: 'cmd' };
      actions.select(a, 'squadron', a.world.squadrons.find((s) => s.role === 'fighter').id);
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 300));
      return { button: document.getElementById('btn-roster').hidden, link: Boolean(document.querySelector('#unit-panel [data-action="open-roster"]')) };
    });
    note(!on.button && on.link, 'with fatigue: the Effectifs button and the link are there', JSON.stringify(on));
  });
  await step('interface: alert states and plans for everything that flies (2.10.2)', async () => {
    // Play-testing 2.10 in the Atlantic: the patrols came back tired and could not be rested,
    // the alert states and the Effectifs page being the fighters' only (and the page hidden
    // there since the review of 2.10, for want of a fighter squadron to show).
    await start('hiver-atlantique', { fatigue: 'on' });
    await sleep(300);
    const sea = await game(page, async () => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      const s = a.world.squadrons.find((x) => x.role === 'coastal');
      s.fatigue = 72;
      a.unitTabs = { squadron: 'cmd' };
      actions.select(a, 'squadron', s.id);
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 300));
      return {
        id: s.id, button: document.getElementById('btn-roster').hidden, fatigue: a.world.settings.fatigue,
        fighters: a.world.squadrons.filter((x) => x.role === 'fighter').length,
        alerts: document.querySelectorAll('#unit-panel [data-action="alert"]').length,
        link: Boolean(document.querySelector('#unit-panel [data-action="open-roster"]')),
        summary: document.getElementById('unit-summary').textContent,
      };
    });
    note(sea.fatigue === 'on' && sea.fighters === 0 && !sea.button, 'the Atlantic (patrols only): the Effectifs button is there', JSON.stringify(sea));
    note(sea.alerts === 4 && sea.link, 'a Coastal Command squadron on the ground has its four alert states and the link to the plans', JSON.stringify(sea));
    note(/fatiguée \(72 %\)/.test(sea.summary), 'a tired patrol says so under its name', sea.summary);
    await shot(page, 'patrol-alert');
    await page.click('#unit-panel [data-action="alert"][data-alert="rest"]');
    const asked = await page.waitForSelector('#unit-panel [data-action="confirm-rest"]', { timeout: 2000 }).then(() => true, () => false);
    if (asked) await page.click('#unit-panel [data-action="confirm-rest"]');
    await sleep(300);
    const rested = await game(page, (id) => {
      const s = window.__game.world.squadrons.find((x) => x.id === id);
      return { alert: s.alert, manual: s.alertManual, hint: document.querySelector('#unit-panel .state-line') ? document.getElementById('unit-panel').textContent : '' };
    }, sea.id);
    note(asked && rested.alert === 'rest' && rested.manual, '« Repos », confirmed, puts the patrol at rest', JSON.stringify({ asked, alert: rested.alert, manual: rested.manual }));
    note(/Retour au planning/.test(rested.hint), 'a state set by hand offers « Retour au planning »');
    await page.click('#btn-roster');
    await sleep(300);
    const plans = await game(page, (id) => {
      const d = document.getElementById('dlg-roster');
      const card = d.querySelector(`#rp-${CSS.escape(id)}`);
      return {
        open: d.open, fields: d.querySelectorAll('[data-rp-field]').length, squadrons: d.querySelectorAll('.rp-squadrons .roster-squadron').length,
        head: card ? card.querySelector('.roster-head').textContent : '', buttons: card ? card.querySelectorAll('[data-action="alert"]').length : 0,
        plan: card ? Boolean(card.querySelector('[id^="roster-alert-"]')) : false,
      };
    }, sea.id);
    note(plans.open && plans.fields >= 1 && plans.squadrons >= 1, 'the Effectifs page opens on the patrols and their aerodromes', JSON.stringify(plans));
    note(/Fatigue 72 % · fatiguée/.test(plans.head) && plans.buttons === 4 && plans.plan, 'each patrol has its type, its fatigue, its alert states and its plan to fill', JSON.stringify(plans));
    await shot(page, 'patrol-roster');
    await closeDialogs(page);
    // Over Britain the spotter section and Coastal Command stand on the page beside the fighters.
    await start('adlertag', { fatigue: 'on' });
    await page.click('#btn-roster');
    await sleep(300);
    const mixed = await game(page, async () => {
      const a = window.__game;
      const roster = await import('./src/ui/rosterPage.js');
      const roles = new Set(roster.rosterFields(a.world).flatMap((f) => roster.rosterSquadrons(a.world, f.id)).map((s) => s.role));
      return { roles: [...roles].sort().join(','), fields: document.querySelectorAll('#dlg-roster [data-rp-field]').length, n: roster.rosterFields(a.world).length };
    });
    note(mixed.roles === 'coastal,fighter,watch' && mixed.fields === mixed.n, 'Adlertag: the page lists the fighters, the spotter section and Coastal Command', JSON.stringify(mixed));
    await closeDialogs(page);
  });
  await step('interface: alerts that are not lost (C6)', async () => {
    await start('hiver-atlantique', { fatigue: 'on' });
    // Seven convoys fall behind at once (the rule that spaces the alerts keeps a real game from
    // doing so often: the queue itself is tested in tests/alertqueue.test.js; here, the page).
    await game(page, async () => {
      const a = window.__game;
      const { raiseAlert } = await import('./src/ui/alerts.js');
      const { addLogEntry } = await import('./src/ui/panels.js');
      for (let n = 1; n <= 7; n++) {
        const logId = addLogEntry(a, `HX ${100 + n} : deux traînards.`, 'warning', a.world.t);
        raiseAlert(a, { type: 'straggler', t: a.world.t, level: 'warning', variant: 'text', params: { convoy: `HX ${100 + n}`, n: 2 }, focus: null, decision: true, logId });
      }
      a.dirtyHud = true;
    });
    await sleep(400);
    await closeDialogs(page);
    const st = await game(page, () => {
      const a = window.__game;
      const box = a.alertBox;
      const count = document.querySelector('#btn-journal .tool-count');
      return {
        current: box.current && { type: box.current.type, decision: Boolean(box.current.decision) }, queue: box.queue.length, unread: box.unread.length,
        badge: count && !count.hidden ? count.textContent : '', kind: !document.getElementById('alert-kind').hidden, timer: a.alertTimer === null,
        title: document.getElementById('btn-journal').title,
      };
    });
    note(st.queue === 4 && st.unread === 2 && st.badge === '2', 'alerts: beyond four waiting, none is thrown away: the Journal button counts those not read', JSON.stringify(st));
    note(/non lue/.test(st.title), 'alerts: and its bubble says so', st.title);
    if (st.current && st.current.decision) note(st.kind && st.timer, 'alerts: one that asks for an order is marked « À décider » and does not go by itself');
    await shot(page, 'alerts-unread');
    await page.click('#btn-journal');
    await sleep(300);
    const read = await game(page, () => ({
      unread: window.__game.alertBox.unread.length, marked: document.querySelectorAll('#log li.unread').length,
      badge: !document.querySelector('#btn-journal .tool-count').hidden,
    }));
    note(read.unread === 0 && read.marked === 2 && !read.badge, 'alerts: the Journal button opens the journal on them, marked, and the counter goes', JSON.stringify(read));
    await shot(page, 'alerts-journal');
    // A raid alert stays while no squadron is sent, and goes when one is.
    await start('quinze-septembre', { fatigue: 'on' });
    await game(page, () => {
      const a = window.__game;
      for (let i = 0; i < 40000 && !a.world.contacts.size; i++) a.stepWorld(1);
    });
    await sleep(500);
    await closeDialogs(page);
    const raid = await game(page, () => {
      const a = window.__game;
      const c = a.alertBox.current;
      return c ? { type: c.type, decision: c.decision, raidId: c.focus && c.focus.raidId, shown: !document.getElementById('alert').hidden, kind: !document.getElementById('alert-kind').hidden, timer: a.alertTimer } : null;
    });
    note(raid && raid.type === 'raidDetected' && raid.decision && raid.shown && raid.kind && raid.timer === null, 'alerts: a raid seen asks for an order: it stays, marked « À décider »', JSON.stringify(raid));
    if (raid && raid.raidId) {
      const gone = await game(page, async (raidId) => {
        const a = window.__game;
        const O = await import('./src/sim/orders.js');
        const Q = await import('./src/sim/query.js');
        const sq = a.world.squadrons.find((s) => s.role === 'fighter' && s.state === 'ready');
        const est = Q.contactEstimate(a.world, a.world.contacts.get(raidId));
        O.scramble(a.world, sq, { route: [[est.x, est.y, 5000]], raidId });
        if (!sq.intercept) sq.attackRaid = raidId;
        await new Promise((r) => setTimeout(r, 400));
        const c = a.alertBox.current;
        return !c || !c.focus || c.focus.raidId !== raidId;
      }, raid.raidId);
      note(gone, 'alerts: once a squadron is sent against it, the alert closes by itself');
    }
  });
  // (C8, then 2.11.0) The help of a sheet stands behind a « ? » in the title of each section:
  // a bubble in front of everything, with a link to the rubric of the help. The setting
  // « Aides des fiches : affichées » writes the text of each bubble under its title.
  await step('interface: the help of the sheets (C8)', async () => {
    await start('hiver-atlantique');
    const open = async () => {
      await game(page, async () => {
        const a = window.__game;
        const actions = await import('./src/ui/actions.js');
        a.unitTabs = { escort: 'cmd' };
        actions.select(a, 'escort', a.world.escorts[0].id);
        a.dirtyPanels = true;
      });
      await sleep(400);
    };
    const read = () => game(page, () => {
      const body = document.getElementById('unit-body');
      const bubble = document.getElementById('help-bubble');
      const r = bubble ? bubble.getBoundingClientRect() : null;
      const front = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      const pane = document.querySelector('#dlg-help .help-pane:not([hidden])');
      return {
        setting: window.__game.settings.sheetHelp,
        help: [...body.querySelectorAll('p.hint')].filter((p) => p.offsetParent).length,
        inline: [...body.querySelectorAll('p.hint.help-inline')].filter((p) => p.offsetParent).length,
        sections: [...body.querySelectorAll('details.sec')].map((d) => `${d.dataset.sec}:${d.querySelectorAll(':scope > summary .help-mark').length}:${d.querySelectorAll('.sec-body .help-mark').length}`),
        open: [...body.querySelectorAll('details.sec')].filter((d) => d.open).length,
        bubble: bubble ? { key: bubble.dataset.key, text: bubble.querySelector('p').textContent, link: bubble.querySelector('[data-help-link]')?.dataset.helpLink || '', front: Boolean(front && bubble.contains(front)), inWindow: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight } : null,
        sheet: !document.getElementById('unit-panel').hidden,
        helpTab: document.getElementById('dlg-help').open ? document.querySelector('#dlg-help [data-htab].active')?.dataset.htab : null,
        target: pane ? pane.querySelector('.help-target')?.dataset.anchor || '' : '',
      };
    });
    await open();
    const dflt = await read();
    note(dflt.setting === 'folded' && dflt.help === 0, 'sheet help: masked by default, no help sentence in the sheet', JSON.stringify({ setting: dflt.setting, help: dflt.help }));
    note(dflt.sections.length >= 4 && dflt.sections.filter((x) => /:1:0$/.test(x)).length >= 4 && dflt.sections.every((x) => /:[01]:0$/.test(x)),
      'sheet help: each section that has help shows one « ? », in its title', dflt.sections.join(' '));
    await page.click('#unit-body details.sec[data-sec="port"] > summary .help-mark');
    await sleep(300);
    const one = await read();
    note(one.bubble && one.bubble.key === 'port' && /^Choisir une sortie en fait la première étape du groupe/.test(one.bubble.text) && one.bubble.front && one.bubble.inWindow && one.open === dflt.open,
      'sheet help: a « ? » opens a bubble in front of the sheet, and its section does not fold', JSON.stringify(one.bubble));
    const sentences = one.bubble ? one.bubble.text.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length : 99;
    note(sentences >= 2 && sentences <= 4, 'sheet help: a bubble says it in two to four sentences', String(sentences));
    await shot(page, 'help-bubble');
    await page.keyboard.press('Escape');
    await sleep(250);
    const closed = await read();
    note(!closed.bubble && closed.sheet, 'sheet help: Escape closes the bubble, and only the bubble');
    await page.click('#unit-body details.sec[data-sec="uboats"] > summary .help-mark');
    await sleep(250);
    await page.mouse.click(200, 400);
    await sleep(250);
    note(!(await read()).bubble, 'sheet help: a click elsewhere closes the bubble');
    await game(page, () => {
      window.__game.paused = true;
    });
    await page.click('#unit-body details.sec[data-sec="uboats"] > summary .help-mark');
    await sleep(250);
    const link = (await read()).bubble;
    await page.click('#help-bubble [data-help-link]');
    await sleep(400);
    const help = await read();
    note(link && link.link === 'sea:chasse' && help.helpTab === 'sea' && !help.bubble, 'sheet help: the link of a bubble opens the help on the tab of its rubric', JSON.stringify({ link: link && link.link, tab: help.helpTab, target: help.target }));
    await closeDialogs(page);
    await game(page, () => {
      window.__game.settings.sheetHelp = 'shown';
      window.__game.el.unitKeyed.__key = '';
      window.__game.dirtyPanels = true;
    });
    await sleep(400);
    const shown = await read();
    note(shown.inline >= 4 && shown.sections.filter((x) => /:1:0$/.test(x)).length >= 4, 'sheet help: « affichées », the text of each bubble stands under the title of its section', JSON.stringify({ inline: shown.inline, help: shown.help }));
    await shot(page, 'help-shown');
    await game(page, () => {
      window.__game.settings.sheetHelp = 'folded';
      window.__game.el.unitKeyed.__key = '';
      window.__game.dirtyPanels = true;
    });
  });
  // (2.11.0) What a unit does or will do is a state line, in its own style: with the help of
  // the sheets folded away, none of them goes with it.
  await step('interface: state lines stay with the help folded', async () => {
    const lines = () => game(page, () => ({
      state: [...document.querySelectorAll('#unit-body .state-line')].filter((p) => p.offsetParent).map((p) => p.textContent.trim()),
      help: [...document.querySelectorAll('#unit-body p.hint')].filter((p) => p.offsetParent).length,
    }));
    const take = async (kind, id, tab = 'cmd') => {
      await game(page, async ([k, i, tb]) => {
        const a = window.__game;
        const actions = await import('./src/ui/actions.js');
        a.unitTabs = { [k]: tb };
        actions.select(a, k, i);
        a.dirtyPanels = true;
      }, [kind, id, tab]);
      await sleep(400);
    };
    // A squadron on the ground: how soon it is in the air.
    await start('kanalkampf', { sheetHelp: 'folded' });
    await take('squadron', '32');
    const ground = await lines();
    note(ground.state.some((x) => /^En l'air .+ après l'ordre de décoller\.$/.test(x)) && ground.help === 0,
      'state lines: « En l\'air 5 min après l\'ordre de décoller » stays when the help is folded', JSON.stringify(ground));
    // Sent against a raid, then called off: « Désengagée de H… ».
    const raidId = await game(page, async () => {
      const a = window.__game;
      const O = await import('./src/sim/orders.js');
      const Q = await import('./src/sim/query.js');
      for (let i = 0; i < 40000 && !a.world.contacts.size; i++) a.stepWorld(1);
      const contact = [...a.world.contacts.values()][0];
      if (!contact) return null;
      const sq = a.world.squadrons.find((s) => s.id === '32');
      const est = Q.contactEstimate(a.world, contact);
      O.scramble(a.world, sq, { route: [[est.x, est.y, 5000]], raidId: contact.raidId });
      if (!sq.intercept) sq.attackRaid = contact.raidId;
      for (let i = 0; i < 900 && sq.state !== 'airborne'; i++) a.stepWorld(1);
      a.dirtyPanels = true;
      return contact.raidId;
    });
    await settle(page);
    await game(page, () => {
      const a = window.__game;
      a.paused = true;
      if (a.alertBox) a.alertBox.current = null;
    });
    await take('squadron', '32');
    const off = await page.$(`#unit-bar [data-action="break-off"][data-raid="${raidId}"]`);
    note(Boolean(raidId && off), 'state lines: a squadron sent against a raid can be called off it');
    if (off) {
      await off.click();
      await sleep(400);
      const called = await lines();
      note(called.state.some((x) => /^Désengagée de \S+\.$/.test(x)) && called.help === 0, 'state lines: « Désengagée de … » stays when the help is folded', JSON.stringify(called));
    }
    // Radio silence: a line on its way to a convoy on the high seas.
    await start('hiver-atlantique', { sheetHelp: 'folded' });
    const id = await game(page, async () => {
      const a = window.__game;
      const C = await import('./src/sim/comms.js');
      const actions = await import('./src/ui/actions.js');
      for (let i = 0; i < 6000 && !a.world.convoys.some((c) => c.state === 'atSea' && C.orderChannel(a.world, c) === 'radio'); i++) a.stepWorld(60);
      const c = a.world.convoys.find((x) => x.state === 'atSea' && C.orderChannel(a.world, x) === 'radio');
      if (!c) return null;
      const at = C.shownPosition(a.world, c);
      actions.shipOrder(a, c, 'route', [[at.x + 60, at.y + 20], [at.x + 140, at.y + 20]]);
      return c.id;
    });
    await settle(page);
    await game(page, () => {
      window.__game.paused = true;
    });
    note(Boolean(id), 'state lines: a convoy on the high seas under radio silence');
    if (id) {
      await take('convoy', id);
      const sea = await lines();
      note(sea.state.some((x) => /^Tracé de 2 points en attente : il part par radio à la relève de \d+ h\.$/.test(x))
        && sea.state.some((x) => /^Jusque-là, il suit son tracé actuel/.test(x)) && sea.help === 0,
      'state lines: a line that waits for the relief, and what the ship does meanwhile, stay when the help is folded', JSON.stringify(sea));
      await shot(page, 'state-lines-folded');
    }
    await game(page, () => {
      window.__game.settings.sheetHelp = 'folded';
    });
  });
  await step('interface: stacks and tabs (C9)', async () => {
    await start('hiver-atlantique', { seaComms: 'direct' });
    await page.keyboard.press('l');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 8000 });
    await sleep(400);
    await closeDialogs(page);
    const stacks = await game(page, () => {
      const r = window.__game.canvas.getBoundingClientRect();
      return window.__game.stacks.map((s) => ({ family: s.family, x: r.left + s.x, y: r.top + s.y, members: s.members.map((m) => `${m.kind}:${m.id}`) }));
    });
    const s0 = stacks.find((s) => s.family === 'sea' && s.members.length >= 2);
    note(Boolean(s0), 'stacks: two groups in the same port make a stack', JSON.stringify(stacks.map((s) => s.members)));
    if (!s0) return;
    await shot(page, 'stack');
    const state = () => game(page, () => JSON.stringify([window.__game.selection, window.__game.world.escorts.map((e) => e.route.length)]));
    const before0 = await state();
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    await page.mouse.move(s0.x - 150, s0.y - 60, { steps: 8 });
    await page.mouse.up();
    await sleep(250);
    note((await state()) === before0, 'stacks: a drag from a stack not yet opened gives no order');
    // (Review of 2.10: it did nothing, silently.) A word by the stack says what to do.
    const said = await game(page, () => (window.__game.mapNote ? window.__game.mapNote.text : ''));
    note(/unités ici : cliquez pour choisir/.test(said), 'stacks: … and a word on the map says to choose a unit first', said);
    await shot(page, 'stack-note');
    await page.mouse.click(s0.x, s0.y);
    await sleep(500);
    const tabs = () => game(page, () => ({
      sel: window.__game.selection, hidden: document.getElementById('unit-stack').hidden,
      tabs: [...document.querySelectorAll('#unit-stack button')].map((b) => `${b.textContent.trim()}${b.classList.contains('active') ? '*' : ''}`),
      site: [...document.querySelectorAll('#unit-stack button.site')].map((b) => b.dataset.id),
    }));
    const first = await tabs();
    // (Since 2.10.2 the port the groups lie in has the first tab: the units stand in it.)
    note(!first.hidden && first.tabs.length === s0.members.length + 1 && first.site.length === 1 && first.sel && first.sel.kind === 'escort' && /\*/.test(first.tabs[1]),
      'stacks: a click opens the stack as tabs, the first unit in hand, after the tab of their port', JSON.stringify(first));
    await shot(page, 'stack-tabs');
    await page.click('#unit-stack button:nth-child(3)');
    await sleep(400);
    const second = await tabs();
    note(second.sel && first.sel && second.sel.id !== first.sel.id && /\*/.test(second.tabs[2]), 'stacks: a tab takes the other unit of the stack in hand', JSON.stringify(second));
    // The drag now goes to the unit in hand, and to it alone.
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    await page.mouse.move(s0.x - 160, s0.y - 40, { steps: 10 });
    await page.mouse.up();
    await sleep(400);
    const routed = await game(page, () => window.__game.world.escorts.filter((e) => e.route.length > 0 || e.state === 'sailing' || e.plan.length > 0).map((e) => e.id));
    note(routed.length === 1 && second.sel && routed[0] === second.sel.id, 'stacks: a drag from the open stack routes the unit in hand, and no other', routed.join(' '));
    // A convoy and its escort (review of 2.10: every escorted convoy had become a « 2 » with
    // two names, its ships and its speed gone; and it was no longer a target of a line).
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const sea = await game(page, async () => {
      const a = window.__game;
      const O = await import('./src/sim/orders.js');
      a.paused = true;
      let c = null;
      for (let i = 0; i < 12 * 86400 && !c; i += 600) {
        a.stepWorld(600);
        c = a.world.convoys.find((x) => x.state === 'atSea' && !x.straggler) || null;
      }
      if (!c) return null;
      // A group joins it as soon as one can reach it (too far out, a group turns back).
      let g = null;
      for (let i = 0; i < 20 * 86400 && !g && c.state === 'atSea'; i += 3600) {
        a.stepWorld(3600);
        g = a.world.escorts.find((e) => e.state === 'escorting' && e.escorting === c.id) || null;
        if (!g && !a.world.escorts.some((e) => e.joinTarget === c.id)) {
          const free = a.world.escorts.find((e) => e.state === 'inPort' && !e.dry);
          if (free) O.joinConvoy(a.world, free, c.id);
        }
      }
      if (!g) return { state: 'none', convoy: c.id, members: [], own: false, plaque: '', box: null, targets: [] };
      const other = a.world.escorts.find((e) => e !== g);
      const D = await import('./src/ui/dropChoice.js');
      a.selection = null;
      a.camera.anim = null;
      a.camera.cx = c.x;
      a.camera.cy = c.y;
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 400));
      const S = await import('./src/ui/stacks.js');
      const stack = a.stacks.find((s) => s.members.some((m) => m.kind === 'convoy' && m.id === c.id));
      const hit = a.hits.find((h) => h.kind === 'stack' && h.members.some((m) => m.kind === 'convoy' && m.id === c.id));
      return {
        state: g.state, convoy: c.id, members: stack ? stack.members.map((m) => `${m.kind}:${m.id}`) : [],
        own: stack ? Boolean(S.stackConvoy(stack)) : false, plaque: stack && S.stackConvoy(stack) ? S.stackConvoy(stack).detail.plaque : '',
        box: hit ? hit.box : null,
        targets: hit ? D.dropTargets(a, { kind: 'escort', id: other.id }, hit.x, hit.y).map((x) => `${x.kind}:${x.id}`) : [],
      };
    });
    note(Boolean(sea) && sea.state === 'escorting' && sea.members.length === 2 && sea.own && /· \d+ · \d+ nd/.test(sea.plaque) && Boolean(sea.box),
      'stacks: a convoy with its escort keeps the convoy\'s mark and plaque (ships, knots), with the number', JSON.stringify(sea).slice(0, 220));
    note(Boolean(sea) && sea.targets.includes(`convoy:${sea.convoy}`), 'stacks: … and it is still a target for the line of another group', sea ? sea.targets.join(' ') : '');
    await settle(page);
    await shot(page, 'stack-convoy');
  });
  await step('interface: the tabs of an installation that holds units (2.10.2)', async () => {
    // Asked after play-testing 2.10: the tabs of the stacks, on the sheet of an aerodrome or
    // of a port, « le port et les étiquettes d'unités ».
    const tabs = () => game(page, () => ({
      sel: window.__game.selection, hidden: document.getElementById('unit-stack').hidden,
      tabs: [...document.querySelectorAll('#unit-stack button')].map((b) => `${b.textContent.trim()}${b.classList.contains('active') ? '*' : ''}`),
      site: [...document.querySelectorAll('#unit-stack button.site')].map((b) => b.dataset.id),
      title: document.getElementById('unit-title').textContent.trim(), body: document.getElementById('unit-body').textContent,
    }));
    const pick = (kind, id) => game(page, async ([k, i]) => {
      const actions = await import('./src/ui/actions.js');
      actions.select(window.__game, k, i);
      await new Promise((r) => setTimeout(r, 350));
    }, [kind, id]);
    // A port and the groups lying there.
    await start('hiver-atlantique', { seaComms: 'direct' });
    await page.keyboard.press('l');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 8000 });
    await sleep(300);
    await closeDialogs(page);
    await pick('site', 'port:liverpool');
    const port = await tabs();
    note(!port.hidden && port.tabs.join('|') === 'Liverpool*|EG 1|EG 3' && port.site[0] === 'port:liverpool', 'installation tabs: a port in hand has its tab, then one a group lying there', JSON.stringify(port.tabs));
    note(/Navires au port/.test(port.body) && /EG 1/.test(port.body), 'installation tabs: the sheet of the port lists the ships lying there');
    await shot(page, 'site-tabs-port');
    await page.click('#unit-stack button[data-id="eg3"]');
    await sleep(350);
    const group = await tabs();
    note(group.sel && group.sel.kind === 'escort' && group.sel.id === 'eg3' && group.tabs.join('|') === 'Liverpool|EG 1|EG 3*', 'installation tabs: a tab takes the group in hand, the tabs stay', JSON.stringify(group.tabs));
    await shot(page, 'site-tabs-group');
    await page.click('#unit-stack button.site');
    await sleep(350);
    const back = await tabs();
    note(back.sel && back.sel.kind === 'site' && back.sel.id === 'port:liverpool' && /^Liverpool\*/.test(back.tabs[0]), 'installation tabs: the tab of the port brings its sheet back', JSON.stringify(back.sel));
    // An aerodrome and its squadrons on the ground, by a click on the map.
    await start('adlertag', { fatigue: 'on' });
    const field = await game(page, () => {
      const a = window.__game;
      const r = a.canvas.getBoundingClientRect();
      const here = (id) => a.world.squadrons.filter((s) => s.airfield === id && s.state === 'ready');
      // The aerodrome with two squadrons whose mark stands farthest from any other.
      const all = a.hits.filter((h) => h.kind === 'airfield' && here(h.id).length >= 2 && h.x > 40 && h.y > 80 && h.x < r.width - 480 && h.y < r.height - 40);
      const alone = (h) => Math.min(...a.hits.filter((o) => o !== h).map((o) => Math.hypot(o.x - h.x, o.y - h.y)));
      all.sort((p, q) => alone(q) - alone(p));
      const h = all[0];
      return h ? { id: h.id, x: r.left + h.x, y: r.top + h.y, name: a.world.byId.airfield.get(h.id).name, squadrons: here(h.id).map((s) => ({ id: s.id, name: s.name })) } : null;
    });
    note(Boolean(field), 'installation tabs: an aerodrome with two squadrons stands on the map', JSON.stringify(field));
    if (!field) return;
    await page.mouse.click(field.x, field.y);
    await sleep(400);
    const ground = await tabs();
    note(ground.sel && ground.sel.id === `airfield:${field.id}` && ground.tabs.join('|') === [`${field.name}*`, ...field.squadrons.map((s) => s.name)].join('|'),
      'installation tabs: a click on an aerodrome opens its sheet with a tab a squadron on the ground', JSON.stringify(ground.tabs));
    await shot(page, 'site-tabs-airfield');
    const sq = field.squadrons[1];
    await page.click(`#unit-stack button[data-id="${sq.id}"]`);
    await sleep(350);
    const inHand = await tabs();
    note(inHand.sel && inHand.sel.kind === 'squadron' && inHand.sel.id === sq.id && inHand.tabs.includes(`${sq.name}*`) && inHand.tabs[0] === field.name && inHand.title.startsWith(sq.name),
      'installation tabs: the tab of a squadron opens its sheet, the aerodrome one tab away', JSON.stringify(inHand.tabs));
    await shot(page, 'site-tabs-squadron');
    // In the air it has left the aerodrome: its tabs go, and the aerodrome no longer lists it.
    const gone = await game(page, async (id) => {
      const a = window.__game;
      const O = await import('./src/sim/orders.js');
      const s = a.world.squadrons.find((x) => x.id === id);
      O.scramble(a.world, s, { orbit: true });
      for (let i = 0; i < 30 && s.state !== 'airborne'; i++) a.stepWorld(60);
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 400));
      return s.state;
    }, sq.id);
    const up = await tabs();
    note(gone === 'airborne' && up.sel && up.sel.id === sq.id && !up.tabs.some((x) => x.startsWith(field.name)), 'installation tabs: once in the air, the squadron is no longer a tab of the aerodrome', JSON.stringify({ gone, tabs: up.tabs }));
    await pick('site', `airfield:${field.id}`);
    const left = await tabs();
    note(!left.tabs.some((x) => x.startsWith(sq.name)), 'installation tabs: … and the aerodrome no longer lists it', JSON.stringify(left.tabs));
  });
  await step('interface: the way out of port is a step, a sailing leaves at its hour (2.10.3)', async () => {
    // Reported after play-testing 2.10.2: scheduled sailings of escort groups that did not
    // leave at their hour, and the exit given to a group (a channel, or the roads) wanted as
    // a step like a traced one — taken away, extended, with an action at its end.
    await start('hiver-atlantique', { seaComms: 'direct' });
    await page.keyboard.press('l');
    await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 8000 });
    await sleep(300);
    await closeDialogs(page);
    const hand = (id) => game(page, async (i) => {
      const a = window.__game;
      const actions = await import('./src/ui/actions.js');
      a.unitTabs = { escort: 'cmd' };
      actions.select(a, 'escort', i);
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 400));
    }, id);
    const read = (id) => game(page, (i) => {
      const a = window.__game;
      const e = a.world.escorts.find((x) => x.id === i);
      const r = a.canvas.getBoundingClientRect();
      const ring = a.hits.find((h) => h.kind === 'routeExtend' && h.id === i);
      const end = document.getElementById(`ship-end-${i}`);
      return {
        state: e.state, route: e.route.length, head: e.routeHead, exit: e.exitChannel, planned: e.exitPlanned, end: e.endAction ? e.endAction.kind : null,
        schedule: e.schedule ? e.schedule.at : null, delayed: Boolean(e.schedule && e.schedule.delayed),
        rows: [...document.querySelectorAll('#unit-keyed ul.legs.steps li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
        crosses: [...document.querySelectorAll('#unit-keyed ul.legs.steps button')].map((b) => b.dataset.action),
        select: document.getElementById(`exit-channel-${i}`)?.value ?? null,
        options: [...(document.getElementById(`exit-channel-${i}`)?.options || [])].map((o) => o.value),
        endLabel: end ? end.closest('label').firstChild.textContent.trim() : null,
        ring: ring ? [r.left + ring.x, r.top + ring.y] : null,
      };
    }, id);
    const show = () => game(page, () => {
      // (The sheet scrolled to its route section, for the screenshots.)
      const list = document.querySelector('#unit-keyed ul.legs.steps') || document.querySelector('#unit-keyed [id^="exit-channel-"]');
      if (list) list.scrollIntoView({ block: 'center' });
    });
    await hand('eg1');
    const none = await read('eg1');
    note(none.state === 'inPort' && none.route === 0 && none.select === '' && none.options.join('|') === "|roads|Nord de l'Irlande|Canal Saint-Georges" && none.rows.length === 0,
      'exit step: a group in port has no exit yet; its sheet offers none, the roads and the channels of its port', JSON.stringify({ ...none, ring: null }));
    // 1. A channel: the head of a route that waits in port, listed and drawn.
    await page.selectOption('#exit-channel-eg1', "Nord de l'Irlande");
    await sleep(400);
    // The far end of the channel, brought to the open part of the map.
    await game(page, async () => {
      const a = window.__game;
      const cam = await import('./src/render/camera.js');
      cam.zoomAt(a.camera, 300, 400, 0.62);
      await new Promise((r) => setTimeout(r, 300));
      const ring = a.hits.find((h) => h.kind === 'routeExtend' && h.id === 'eg1');
      if (ring) cam.panBy(a.camera, 430 - ring.x, 330 - ring.y);
      await new Promise((r) => setTimeout(r, 400));
    });
    await show();
    const channel = await read('eg1');
    note(channel.state === 'inPort' && channel.planned && channel.exit === "Nord de l'Irlande" && channel.head > 2 && channel.route === channel.head,
      'exit step: a channel chosen is the head of a route, and the group stays in port', JSON.stringify({ ...channel, rows: null }));
    note(channel.rows.length === 1 && /^Par le chenal : Nord de l.Irlande \d+ km/.test(channel.rows[0]) && channel.crosses.join('|') === 'exit-remove' && channel.endLabel === 'Au bout de la sortie',
      'exit step: … listed under « Route et étapes » with its length, a cross, and what the group does at its end', JSON.stringify([channel.rows, channel.crosses, channel.endLabel]));
    note(Boolean(channel.ring) && channel.ring[0] > 40 && channel.ring[0] < 700, 'exit step: … and drawn on the map, a ring at its end to carry it further', JSON.stringify(channel.ring));
    await shot(page, 'exit-step-channel');
    if (!channel.ring) return;
    // 2. Carried further by a line drawn from the ring, still in port.
    const [rx, ry] = channel.ring;
    await page.mouse.move(rx, ry);
    await page.mouse.down();
    await page.mouse.move(rx - 70, ry + 10, { steps: 6 });
    await page.mouse.move(rx - 160, ry + 50, { steps: 8 });
    await page.mouse.up();
    await sleep(450);
    await show();
    const longer = await read('eg1');
    note(longer.state === 'inPort' && longer.head === channel.head && longer.route > longer.head && longer.rows.length === 2 && /^Puis le tracé : \d+ points? \d+ km/.test(longer.rows[1])
      && longer.crosses.join('|') === 'exit-remove|line-remove' && longer.endLabel === 'En fin de tracé',
    'exit step: a line drawn from the ring follows the step, and waits in port with it', JSON.stringify({ ...longer, ring: null }));
    // 3. An action at the end.
    await page.selectOption('#ship-end-eg1', 'hold');
    await sleep(350);
    const held = await read('eg1');
    note(held.end === 'hold' && held.route === longer.route && held.state === 'inPort', 'exit step: the action at the end is chosen in port, the plan stays', JSON.stringify({ end: held.end, route: held.route }));
    await show();
    await shot(page, 'exit-step-extended');
    // 4. The line taken away, the step stays; another exit; the step taken away.
    await page.click('#unit-keyed [data-action="line-remove"]');
    await sleep(350);
    const cut = await read('eg1');
    note(cut.route === channel.head && cut.head === channel.head && cut.rows.length === 1 && cut.end === 'hold' && cut.endLabel === 'Au bout de la sortie' && cut.state === 'inPort',
      'exit step: the cross of the line takes the line away and leaves the step, with its action', JSON.stringify({ ...cut, ring: null }));
    await page.selectOption('#exit-channel-eg1', 'roads');
    await sleep(350);
    await show();
    const roads = await read('eg1');
    note(roads.planned && roads.exit === null && roads.select === 'roads' && roads.head > 0 && roads.head < channel.head && roads.route === roads.head && /^En rade, au large du port/.test(roads.rows[0] || ''),
      'exit step: the roads are a step too (the group clears the port and waits there)', JSON.stringify({ ...roads, ring: null }));
    await shot(page, 'exit-step-roads');
    await page.click('#unit-keyed [data-action="exit-remove"]');
    await sleep(350);
    const bare = await read('eg1');
    note(!bare.planned && bare.exit === null && bare.route === 0 && bare.rows.length === 0 && bare.select === '' && bare.state === 'inPort',
      'exit step: the cross of the step takes it away: no exit, no route', JSON.stringify({ ...bare, ring: null }));
    // 5. Sailings at 08:00: one group with a step and an action, another with nothing prepared.
    await page.selectOption('#exit-channel-eg1', 'Canal Saint-Georges');
    await sleep(300);
    await page.selectOption('#ship-end-eg1', 'hold');
    await sleep(300);
    const schedule = async (id) => {
      await hand(id);
      await page.fill(`#sail-time-${id}`, '08:00');
      await page.click(`#unit-keyed [data-action="schedule-sail"][data-id="${id}"]`);
      await sleep(350);
      await closeDialogs(page);
      await sleep(200);
    };
    await schedule('eg1');
    await schedule('eg3');
    await hand('eg1');
    await show();
    const planned = [await read('eg1'), await read('eg3')];
    note(planned.every((p) => p.schedule === 7200 && p.state === 'inPort') && planned[0].route === planned[0].head && planned[0].head > 2 && planned[1].route === 0,
      'scheduled sailing: 08:00 is taken for a group with a step and for a group with nothing prepared', JSON.stringify(planned.map((p) => [p.schedule, p.state, p.route])));
    await shot(page, 'exit-step-scheduled');
    const sailed = await game(page, async () => {
      const a = window.__game;
      const groups = ['eg1', 'eg3'].map((id) => a.world.escorts.find((e) => e.id === id));
      const left = [null, null];
      const waited = [false, false];
      for (let i = 0; i < 200 && left.some((x) => x === null); i++) {
        a.stepWorld(60);
        groups.forEach((e, k) => {
          if (e.schedule && e.schedule.delayed) waited[k] = true;
          if (left[k] === null && e.state !== 'inPort') left[k] = a.world.t;
        });
      }
      // Three hours on: out of the harbour, and under way.
      const port = a.world.byId.port.get(groups[1].portId);
      for (let i = 0; i < 180; i++) a.stepWorld(60);
      a.dirtyPanels = true;
      await new Promise((r) => setTimeout(r, 500));
      return {
        left, waited, states: groups.map((e) => e.state), schedules: groups.map((e) => e.schedule),
        away: groups.map((e) => Math.round(Math.hypot(e.x - port.x, e.y - port.y))),
        log: [...document.querySelectorAll('#log-list li, #journal li, .log-entry')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()).filter((x) => /groupe d.escorte/.test(x)).slice(0, 8),
      };
    });
    note(sailed.left.every((x) => x !== null && x >= 7200 && x <= 7260) && !sailed.waited.some(Boolean) && sailed.schedules.every((x) => x === null),
      'scheduled sailing: both groups leave at 08:00, neither order is left waiting', JSON.stringify(sailed));
    note(sailed.states[0] === 'atSea' && sailed.away[0] > 40, 'scheduled sailing: three hours later the first is well down its channel', JSON.stringify(sailed.away));
    note(sailed.states[1] === 'waiting' && sailed.away[1] >= 2 && sailed.away[1] <= 10, 'scheduled sailing: … and the one with nothing prepared waits in the roads for its orders', JSON.stringify([sailed.states[1], sailed.away[1]]));
    await settle(page);
    await hand('eg1');
    await show();
    const atSea = await read('eg1');
    note(atSea.rows.length === 1 && /^Par le chenal : Canal Saint-Georges \d+ km/.test(atSea.rows[0]) && atSea.crosses.length === 0 && atSea.end === 'hold',
      'exit step: under way the step is still listed, without its cross, with the action kept', JSON.stringify({ ...atSea, ring: null }));
    await shot(page, 'exit-step-sailed');
  });
  await step('interface: at sea and at high speed, the zone of a patrol rather than the aircraft (idea B)', async () => {
    await start('hiver-atlantique', { seaComms: 'direct' });
    const sea = await game(page, async () => {
      const a = window.__game;
      const O = await import('./src/sim/orders.js');
      a.paused = true;
      // A convoy within reach of the patrols of Northern Ireland, then one of them over it.
      let c = null;
      for (let i = 0; i < 30 * 86400 && !c; i += 3600) {
        a.stepWorld(3600);
        c = a.world.convoys.find((x) => x.state === 'atSea' && !x.straggler && Math.hypot(x.x - a.world.byId.airfield.get('aldergrove').x, x.y - a.world.byId.airfield.get('aldergrove').y) < 700) || null;
      }
      const sq = a.world.squadrons.find((s) => s.role === 'coastal' && s.state === 'ready' && s.airfield === 'aldergrove');
      if (!c || !sq) return null;
      O.scramble(a.world, sq, { orbit: true });
      for (let i = 0; i < 15 * 60 && sq.state !== 'airborne'; i += 60) a.stepWorld(60);
      const ordered = O.setCover(a.world, sq, c.id);
      for (let i = 0; i < 300 * 60 && Math.hypot(sq.x - c.x, sq.y - c.y) > 12 && sq.state === 'airborne'; i += 60) a.stepWorld(60);
      a.selection = null;
      a.camera.anim = null;
      a.camera.cx = c.x;
      a.camera.cy = c.y;
      a.camera.scale = 1.4;
      a.speed = 3600;
      a.dirtyHud = true;
      return { ordered, convoy: c.id, squadron: sq.id, state: sq.state, cover: sq.cover };
    });
    note(Boolean(sea) && sea.ordered && sea.state === 'airborne' && sea.cover === sea.convoy, 'patrol zone: a patrol of Coastal Command is over a convoy', JSON.stringify(sea));
    if (!sea) return;
    await settle(page);
    const seen = (id) => game(page, ([convoyId, squadronId]) => {
      const a = window.__game;
      const zone = (a.patrolZones || []).find((z) => z.id === squadronId) || null;
      const hit = a.hits.find((h) => h.kind === 'squadron' && h.id === squadronId) || null;
      const pile = a.hits.find((h) => h.kind === 'stack' && h.members.some((m) => m.kind === 'convoy' && m.id === convoyId)) || a.hits.find((h) => h.kind === 'convoy' && h.id === convoyId) || null;
      const sq = a.world.squadrons.find((s) => s.id === squadronId);
      const [ax, ay] = a.toScreen(sq.x, sq.y);
      return {
        zone: zone ? { kind: zone.kind, r: Math.round(zone.r), sees: zone.sees } : null,
        toConvoy: hit && pile ? Math.round(Math.hypot(hit.x - pile.x, hit.y - pile.y)) : null,
        toAircraft: hit ? Math.round(Math.hypot(hit.x - ax, hit.y - ay)) : null,
        speed: a.speed,
      };
    }, id);
    const fast = await seen([sea.convoy, sea.squadron]);
    note(Boolean(fast.zone) && fast.zone.kind === 'cover' && fast.zone.r >= 20 && fast.toConvoy !== null && fast.toConvoy <= 30,
      'patrol zone: at ×3 600 it is drawn as its zone, its mark standing by the convoy', JSON.stringify(fast));
    await shot(page, 'patrol-zone');
    // Slow enough to follow the aircraft: the aircraft itself, as before.
    await game(page, () => {
      window.__game.speed = 60;
    });
    await sleep(300);
    const slow = await seen([sea.convoy, sea.squadron]);
    note(slow.zone === null && slow.toAircraft !== null && slow.toAircraft <= 40, 'patrol zone: at ×60 the aircraft itself is drawn, as before', JSON.stringify(slow));
    await shot(page, 'patrol-aircraft');
    // The unit in hand keeps its aircraft and its route, whatever the speed; the setting turns the zones off.
    await game(page, async (id) => {
      const a = window.__game;
      a.speed = 3600;
      const A = await import('./src/ui/actions.js');
      A.select(a, 'squadron', id);
    }, sea.squadron);
    await sleep(300);
    const inHand = await seen([sea.convoy, sea.squadron]);
    note(inHand.zone === null && inHand.toAircraft !== null && inHand.toAircraft <= 40, 'patrol zone: the patrol in hand keeps its aircraft', JSON.stringify(inHand));
    await game(page, async () => {
      const a = window.__game;
      const A = await import('./src/ui/actions.js');
      A.select(a, null, null);
      a.settings.patrolZones = false;
    });
    await sleep(300);
    const off = await seen([sea.convoy, sea.squadron]);
    note(off.zone === null, 'patrol zone: the setting « Patrouilles en mer » turns it off', JSON.stringify(off));
    await game(page, () => {
      window.__game.settings.patrolZones = true;
    });
  });
  note(errors.length === before, 'interface: no console error', errors.slice(before, before + 2).join(' | '));
}

async function main() {
  const server = await serve();
  try {
    // The development version.
    const dev = await openGame(`${server.url}index.html`);
    note(await game(dev.page, () => window.__game.onMenu && !document.getElementById('menu').hidden), 'development version: starts on the main menu');
    await shot(dev.page, 'menu');
    if (wanted('tutorial')) await step('tutorial', () => tutorial(dev.page));
    if (wanted('scenarios')) {
      for (const id of ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique', 'm0-july-1940']) await step(id, () => scenario(dev.page, id, dev.errors));
    }
    if (wanted('corrections')) await corrections(dev.page, dev.errors);
    if (wanted('watches')) await watches(dev.page, dev.errors);
    if (wanted('menus')) await menus(dev.page, dev.errors);
    if (wanted('interface')) await interfaceChecks(dev.page, dev.errors);
    note(dev.errors.length === 0, 'development version: no console error', dev.errors.slice(0, 3).join(' | '));
    await dev.browser.close();

    // The single file, from the disk.
    if (wanted('dist')) {
      const one = await openGame(pathToFileURL(`${ROOT}dist/index.html`).href);
      note(await game(one.page, () => window.__game.onMenu && !document.getElementById('menu').hidden), 'dist/index.html from the disk: starts on the main menu');
      await step('dist adlertag', () => scenario(one.page, 'adlertag', one.errors));
      await step('dist hiver-atlantique', () => scenario(one.page, 'hiver-atlantique', one.errors));
      note(one.errors.length === 0, 'dist/index.html: no console error', one.errors.slice(0, 3).join(' | '));
      await one.browser.close();
    }
  } finally {
    server.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nsmoke test passed');
  }
}

await main();
