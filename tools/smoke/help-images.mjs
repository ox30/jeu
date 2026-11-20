// The three pictures of the help (data/help/images.json), taken on the test bench: the sheet
// of a squadron in flight, the Effectifs page, the sheet of an escort group at sea. Each is
// a small WebP, written into the JSON as a data URL.
//
//   node tools/smoke/help-images.mjs            writes data/help/images.json
//   node tools/smoke/help-images.mjs --check    only says what it would write
import { writeFileSync } from 'node:fs';
import { ROOT, closeDialogs, openGame, serve, sleep } from './browser.mjs';

const check = process.argv.includes('--check');
const WIDTH = 380; // a sheet stands in the text column of the help as wide as it is in the game
const PAGE_WIDTH = 620; // a page is shown smaller: it must still be read

const server = await serve();
const { browser, page, errors } = await openGame(`${server.url}index.html`, { width: 1440, height: 900 });
const game = (fn, arg) => page.evaluate(fn, arg);

async function start(scenario) {
  await game((id) => {
    const a = window.__game;
    a.campaign.unlockAll = true;
    a.restart(id);
    a.paused = true;
  }, scenario);
  await sleep(700);
  await closeDialogs(page);
}

/** A part of the page as a WebP data URL, `WIDTH` wide at most. */
async function picture(selector, { maxHeight = 520, width = WIDTH } = {}) {
  const box = await page.locator(selector).first().boundingBox();
  const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, maxHeight) };
  const png = (await page.screenshot({ clip })).toString('base64');
  return game(async ({ data, width }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const scale = Math.min(1, width / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.72);
  }, { data: png, width });
}

const images = {};

// 1. A squadron in flight: the command bar, the Commandes tab and its « ? ».
await start('kanalkampf');
await game(async () => {
  const a = window.__game;
  const actions = await import('./src/ui/actions.js');
  const s = a.world.squadrons.find((x) => x.role === 'fighter' && x.state === 'ready');
  a.unitTabs = { squadron: 'cmd' };
  actions.select(a, 'squadron', s.id);
  actions.scrambleSquadron(a, s);
  a.stepWorld(8 * 60);
  a.dirtyPanels = true;
});
await sleep(500);
images.sheet = await picture('#unit-panel', { maxHeight: 470 });

// 2. The Effectifs page: the aerodromes on the left, the squadrons and their rosters.
await closeDialogs(page);
await game(async () => {
  const a = window.__game;
  const actions = await import('./src/ui/actions.js');
  actions.select(a, null, null);
});
await page.click('#btn-roster');
await sleep(500);
images.roster = await picture('#dlg-roster', { maxHeight: 430, width: PAGE_WIDTH });
await closeDialogs(page);

// 3. An escort group at sea with a convoy to meet: communications, convoys, hunt, home.
await start('hiver-atlantique');
await game(async () => {
  const a = window.__game;
  const actions = await import('./src/ui/actions.js');
  a.stepWorld(6 * 3600);
  const e = a.world.escorts.find((x) => x.state === 'inPort');
  const c = a.world.convoys.find((x) => x.state === 'atSea');
  a.unitTabs = { escort: 'cmd' };
  actions.select(a, 'escort', e.id);
  a.dirtyPanels = true;
  window.__pick = { e: e.id, c: c && c.id };
});
await sleep(400);
await closeDialogs(page);
const join = await page.$('#unit-body [data-action="join"]');
if (join) await join.click();
await game(() => {
  const a = window.__game;
  a.stepWorld(30 * 3600);
  a.dirtyPanels = true;
});
await sleep(500);
await closeDialogs(page);
await sleep(200);
images.escort = await picture('#unit-panel', { maxHeight: 520 });

for (const [name, src] of Object.entries(images)) console.log(`${name}: ${src.length} characters`);
if (errors.length) console.log(`console errors:\n${errors.join('\n')}`);
if (!check) writeFileSync(`${ROOT}data/help/images.json`, `${JSON.stringify(images, null, 2)}\n`);
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
