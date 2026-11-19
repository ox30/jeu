// Smoke test in a headless Chrome: the development version and the single file dist/index.html
// start; the guided tutorial is played with the mouse and the keyboard; in every scenario each
// page and each kind of sheet is opened and the game runs a little. Any console error fails.
// Then the corrections that live in the page are tried one by one (stacked plaques, speed keys,
// end summary, campaign briefing, the guard of the frame loop).
//   npm run smoke            (add --shots to keep screenshots in tools/smoke/out;
//                             --only tutorial|scenarios|corrections|watches|dist for one part)
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

/** The guided tutorial, as a new player meets it. */
async function tutorial(page) {
  await page.click('#dlg-menu [data-menu="training"]');
  await page.waitForSelector('#coach:not([hidden])');
  await page.click('#coach [data-coach="next"]');
  await sleep(300);
  await page.click('#unit-bar [data-action="admiralty"]');
  await sleep(300);
  await page.keyboard.press('Space');
  await page.keyboard.press('4');
  await sleep(200);
  note(await game(page, () => window.__game.speed === 600), 'tutorial: key 4 sets ×600');
  // Time goes by until the radar sees the first raid (the alert would stop a player there).
  await game(page, () => {
    const a = window.__game;
    for (let i = 0; i < 100000 && !a.world.contacts.size && !a.world.ended; i++) a.stepWorld(1);
  });
  await sleep(400);
  const raidId = await game(page, () => [...window.__game.world.contacts.keys()][0]);
  note(Boolean(raidId), 'tutorial: the radar reports a raid');
  await game(page, () => {
    window.__game.paused = true;
  });
  // The tutorial moves the map to England: wait until the camera has arrived.
  await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
  await sleep(150);
  const from = await screenOf(page, 'airfield', 'biggin_hill');
  const to = await screenOf(page, 'raid', raidId);
  // Both ends of the gesture must be on the map, not under the unit sheet (I8 of the audit).
  const onMap = (p) => game(page, ([x, y]) => document.elementFromPoint(x, y) === window.__game.canvas, p);
  note((await onMap(from)) && (await onMap(to)), 'tutorial: the aerodrome and the raid are in view, clear of the unit sheet');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  note(await game(page, () => window.__game.world.squadrons.some((s) => s.state !== 'ready')), 'tutorial: a drag from the aerodrome scrambles a squadron');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await shot(page, 'tutorial-scramble');
  let fought = false;
  for (let i = 0; i < 400 && !fought; i++) {
    await fastForward(page, 30);
    await sleep(40);
    if (await game(page, () => window.__game.world.questions.length > 0)) await page.keyboard.press('Enter');
    fought = await game(page, () => window.__game.world.reports.size > 0 && window.__game.tutorial && window.__game.tutorial.index >= 7);
  }
  note(fought, 'tutorial: the fight happens and the tutorial reaches the reports');
  await settle(page);
  await page.click('#btn-reports');
  await sleep(300);
  note(await game(page, () => document.getElementById('dlg-reports').open), 'tutorial: the reports page opens');
  await shot(page, 'tutorial-reports');
  await page.keyboard.press('Escape');
  await sleep(300);
  const last = await game(page, () => (window.__game.tutorial ? window.__game.tutorial.index : -1));
  note(last >= 8 || last === -1, 'tutorial: played to its last step', `step ${last}`);
}

const PAGES = [['#btn-reports', 'dlg-reports'], ['#btn-formations', 'dlg-formations'], ['#btn-roster', 'dlg-roster'], ['#btn-cards', 'dlg-cards'],
  ['#btn-scenario', 'dlg-menu'], ['#btn-settings', 'dlg-settings'], ['#btn-help', 'dlg-help']];
const TABS = ['#tab-units', '#tab-sites', '#tab-logistics'];

/** One scenario: start it, open every page, a sheet of each kind, and let it run. */
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
    await page.click(button);
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
    await page.click(tab);
    await sleep(80);
    const kinds = await game(page, () => [...new Set([...document.querySelectorAll('#tote [data-action="select"]')].map((b) => b.dataset.kind))]);
    for (const kind of kinds) {
      await page.click(`#tote [data-action="select"][data-kind="${kind}"]`);
      await sleep(120);
      if (await page.isVisible('#unit-panel')) sheets++;
      const tabs = await page.locator('#unit-tabs button').count();
      for (let i = 0; i < tabs; i++) {
        const tab = page.locator('#unit-tabs button').nth(i);
        if (await tab.isVisible()) await tab.click();
        await sleep(40);
      }
    }
  }
  await page.click('#tab-units');
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
    const stack = async () => page.evaluate((list) => {
      const a = window.__game;
      const r = a.canvas.getBoundingClientRect();
      const out = {};
      for (const id of list) {
        const h = a.hits.find((x) => x.kind === 'squadron' && x.id === id && x.box);
        const s = a.world.squadrons.find((x) => x.id === id);
        out[id] = h ? {
          symbol: [r.left + h.x, r.top + h.y], plaque: [r.left + h.box.x + h.box.w / 2, r.top + h.box.y + h.box.h / 2],
          route: JSON.stringify(s.route), x: s.x, y: s.y,
        } : null;
      }
      out.selection = a.selection ? `${a.selection.kind}:${a.selection.id}` : null;
      out.ruler = a.ruler ? a.ruler.a : null;
      return out;
    }, ids);
    let st = await stack();
    const [first, second] = ids;
    const together = st[first] && st[second] && Math.hypot(st[first].symbol[0] - st[second].symbol[0], st[first].symbol[1] - st[second].symbol[1]) < 6;
    note(Boolean(together), 'stacked plaques: two squadrons fly one over the other');
    if (together) {
      // A click on a plaque takes its squadron in hand; the sheet opens and the map may move
      // aside for it, so the places are read again once the camera is still.
      const take = async (id) => {
        const now = await stack();
        await page.mouse.click(now[id].plaque[0], now[id].plaque[1]);
        await sleep(150);
        await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 15000 });
        await sleep(150);
        return stack();
      };
      // The second one in hand: the drag from the pile is its route.
      st = await take(second);
      let symbol = st[first].symbol;
      const untouched = st[first].route;
      await drag(page, symbol, [symbol[0] - 140, symbol[1] + 110]);
      st = await stack();
      note(st.selection === `squadron:${second}` && st[first].route === untouched && st[second].route !== untouched,
        'stacked plaques: the drag goes to the squadron in hand', `selection ${st.selection}`);
      // The other one in hand: same pile, the other squadron answers.
      st = await take(first);
      symbol = st[first].symbol;
      const kept = st[second].route;
      await drag(page, symbol, [symbol[0] - 140, symbol[1] - 110]);
      st = await stack();
      note(st.selection === `squadron:${first}` && st[second].route === kept && st[first].route !== untouched,
        'stacked plaques: and to the other one once it is in hand', `selection ${st.selection}`);
      // The ruler from the pile keeps the selection and starts on the unit in hand.
      symbol = st[first].symbol;
      await drag(page, symbol, [symbol[0] + 120, symbol[1] - 60], { shift: true });
      st = await stack();
      const onUnit = st.ruler && Math.hypot(st.ruler[0] - st[first].x, st.ruler[1] - st[first].y) < 0.01;
      note(st.selection === `squadron:${first}` && Boolean(onUnit), 'stacked plaques: the ruler keeps the selection and starts on the unit in hand', `selection ${st.selection}`);
      // With nothing in hand the ruler measures from the map and selects nobody.
      await page.keyboard.press('Escape');
      await game(page, () => {
        window.__game.selection = null;
        window.__game.dirtyPanels = true;
      });
      await sleep(120);
      symbol = (await stack())[first].symbol;
      await drag(page, symbol, [symbol[0] + 120, symbol[1] - 60], { shift: true });
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
      return { atStart: w.fightersAtStart, now, carry: w.carry && w.carry.fighterShare };
    });
    await shot(page, 'briefing-campaign');
    note(/Campagne/.test(briefing) && briefing.includes(String(share.atStart)) && share.carry === 0.6 && share.now <= share.atStart,
      'campaign: the losses carried over are said in the briefing', `${share.atStart} fighters at the start`);
    await closeDialogs(page);
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
    await page.click('#btn-settings');
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
  note(errors.length === before, 'watches: no console error', errors.slice(before, before + 2).join(' | '));
}

async function main() {
  const server = await serve();
  try {
    // The development version.
    const dev = await openGame(`${server.url}index.html`);
    note(await game(dev.page, () => document.getElementById('dlg-menu').open), 'development version: starts on the main menu');
    await shot(dev.page, 'menu');
    if (wanted('tutorial')) await step('tutorial', () => tutorial(dev.page));
    if (wanted('scenarios')) {
      for (const id of ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique', 'm0-july-1940']) await step(id, () => scenario(dev.page, id, dev.errors));
    }
    if (wanted('corrections')) await corrections(dev.page, dev.errors);
    if (wanted('watches')) await watches(dev.page, dev.errors);
    note(dev.errors.length === 0, 'development version: no console error', dev.errors.slice(0, 3).join(' | '));
    await dev.browser.close();

    // The single file, from the disk.
    if (wanted('dist')) {
      const one = await openGame(pathToFileURL(`${ROOT}dist/index.html`).href);
      note(await game(one.page, () => document.getElementById('dlg-menu').open), 'dist/index.html from the disk: starts on the main menu');
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
