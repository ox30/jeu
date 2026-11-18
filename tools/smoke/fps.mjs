// Frame rate at the highest speed, in a headless Chrome: « Hiver dans l'Atlantique » played to
// day 40 (escorts sent to the convoys), then run at ×14 400 for a few seconds with and without a
// unit sheet open. The criterion: 60 images a second, no frame over 50 ms.
//   node tools/smoke/fps.mjs [--root <checkout>] [--seconds 8] [--json]
// --root measures another checkout of the game (an earlier version), for a before and after.
import { resolve } from 'node:path';
import { ROOT, openGame, serve, sleep } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const root = resolve(opt('root', ROOT));
const seconds = Number(opt('seconds', 8));

const server = await serve(root.endsWith('/') ? root : `${root}/`);
const { browser, page, errors } = await openGame(`${server.url}index.html`, { width: 1920, height: 1080 });

// The scenario, then forty days of game with one escort group sent to each convoy. The world is
// stepped through the simulation's own module: it works on every version of the game.
await page.evaluate(() => {
  const a = window.__game;
  a.campaign.unlockAll = true;
  a.restart('hiver-atlantique');
});
await sleep(1200);
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
const state = await page.evaluate(async () => {
  const sim = await import('/src/sim/world.js');
  const orders = await import('/src/sim/orders.js');
  const geo = await import('/src/sim/geo.js');
  const a = window.__game;
  const w = a.world;
  a.paused = true;
  for (let i = 0; i < 40 * 86400 && !w.ended; i++) {
    sim.step(w, 1);
    w.events.length = 0;
    if (w.t % 600 !== 0) continue;
    for (const convoy of w.convoys) {
      if (convoy.state !== 'atSea' || convoy.straggler) continue;
      if (w.escorts.some((e) => e.escorting === convoy.id || e.joinTarget === convoy.id)) continue;
      const free = w.escorts.find((e) => e.state === 'inPort');
      if (free && geo.distance(free.x, free.y, convoy.x, convoy.y) < 1800) orders.joinConvoy(w, free, convoy.id);
    }
  }
  a.dirtyPanels = true;
  a.dirtyHud = true;
  return {
    day: +(w.t / 86400).toFixed(1),
    convoysAtSea: w.convoys.filter((c) => c.state === 'atSea').length,
    uboats: w.uboats.filter((u) => u.state !== 'gone' && u.state !== 'sunk').length,
    plots: w.uboatPlots.length,
  };
});
await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
await sleep(500);

async function measure(label, speed) {
  const r = await page.evaluate(async ({ speed, seconds }) => {
    const a = window.__game;
    a.settings.slowOnAlert = false; // the speed is kept through the alerts: it is what is measured
    a.settings.confirmSpeed = false;
    a.speed = speed;
    a.paused = false;
    const frames = [];
    const t0 = a.world.t;
    let last = performance.now();
    const start = last;
    await new Promise((done) => {
      const tick = (now) => {
        frames.push(now - last);
        last = now;
        // Stops and questions would hold the clock: the measure keeps it running.
        if (a.paused && !a.world.ended) a.paused = false;
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    a.paused = true;
    frames.shift();
    frames.sort((x, y) => x - y);
    const sum = frames.reduce((x, y) => x + y, 0);
    return {
      frames: frames.length,
      fps: +(1000 * frames.length / sum).toFixed(1),
      medianMs: +frames[Math.floor(frames.length * 0.5)].toFixed(1),
      p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
      maxMs: +frames[frames.length - 1].toFixed(1),
      over50: frames.filter((x) => x > 50).length,
      realSpeed: Math.round((a.world.t - t0) / (sum / 1000)),
    };
  }, { speed, seconds });
  return { label, speed, ...r };
}

const results = [];
await page.keyboard.press('a'); // the Atlantic view
await sleep(1200);
results.push(await measure('Atlantic view, no sheet', 14400));
const escort = page.locator('#tote [data-action="select"][data-kind="escort"]').first();
if (await escort.count()) {
  await escort.click();
  await sleep(600);
  await page.keyboard.press('a');
  await sleep(1200);
  results.push(await measure('Atlantic view, escort sheet open', 14400));
}

await browser.close();
server.close();

if (args.includes('--json')) console.log(JSON.stringify({ root, state, results, errors }));
else {
  console.log(`Hiver dans l'Atlantique, day ${state.day}: ${state.convoysAtSea} convoys at sea, ${state.uboats} U-boats, ${state.plots} plots (${root})`);
  for (const r of results) {
    console.log(`${r.label.padEnd(34)} ×${r.speed}: ${r.fps} images/s · median ${r.medianMs} ms · p95 ${r.p95Ms} ms · longest ${r.maxMs} ms · frames over 50 ms: ${r.over50} of ${r.frames} · real speed ×${r.realSpeed}`);
  }
  if (errors.length) console.log(`console errors: ${errors.slice(0, 5).join(' | ')}`);
}
const bad = results.some((r) => r.fps < 55);
if (bad) process.exitCode = 1;
