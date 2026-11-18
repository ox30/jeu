// Smoke test in a headless Chrome: the development version and the single file dist/index.html
// start; the guided tutorial is played with the mouse and the keyboard; in every scenario each
// page and each kind of sheet is opened and the game runs a little. Any console error fails.
//   npm run smoke            (add --shots to keep screenshots in tools/smoke/out)
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ROOT, closeDialogs, fastForward, openGame, screenOf, serve, sleep } from './browser.mjs';

const SHOTS = process.argv.includes('--shots');
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
  await page.waitForFunction(() => !window.__game.camera.anim, null, { timeout: 5000 });
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

async function main() {
  const server = await serve();
  try {
    // The development version.
    const dev = await openGame(`${server.url}index.html`);
    note(await game(dev.page, () => document.getElementById('dlg-menu').open), 'development version: starts on the main menu');
    await shot(dev.page, 'menu');
    await tutorial(dev.page);
    for (const id of ['kanalkampf', 'adlertag', 'quinze-septembre', 'hiver-atlantique', 'm0-july-1940']) await scenario(dev.page, id, dev.errors);
    note(dev.errors.length === 0, 'development version: no console error', dev.errors.slice(0, 3).join(' | '));
    await dev.browser.close();

    // The single file, from the disk.
    const one = await openGame(pathToFileURL(`${ROOT}dist/index.html`).href);
    note(await game(one.page, () => document.getElementById('dlg-menu').open), 'dist/index.html from the disk: starts on the main menu');
    await scenario(one.page, 'adlertag', one.errors);
    await scenario(one.page, 'hiver-atlantique', one.errors);
    note(one.errors.length === 0, 'dist/index.html: no console error', one.errors.slice(0, 3).join(' | '));
    await one.browser.close();
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
