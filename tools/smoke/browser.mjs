// The game in a headless Chrome, for the smoke test and the frame-rate measurement: a small
// static server for the development version, the browser, and a few helpers. Needs Chrome
// (CHROME_PATH, or one of the usual places) and tools/node_modules (npm ci --prefix tools).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Serves the repository on a free local port. Returns { url, close }. */
export function serve(root = ROOT) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(root, path || 'index.html');
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }));
  });
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the game at `url` and waits until it has started. Console errors and page errors are
 * collected in `errors`.
 */
export async function openGame(url, { width = 1440, height = 900, storage = null } = {}) {
  const path = chromePath();
  if (!path) throw new Error('Chrome not found: set CHROME_PATH');
  const browser = await chromium.launch({ executablePath: path, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'fr-CH' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[page] ${e.message}`));
  if (storage) {
    await page.addInitScript((items) => {
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v);
    }, storage);
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__game && document.getElementById('loading').hidden, null, { timeout: 30000 });
  return { browser, context, page, errors };
}

/** Advances the game by `seconds` of game time by stepping the world of the page. */
export async function fastForward(page, seconds) {
  return page.evaluate((n) => {
    const a = window.__game;
    const wasPaused = a.paused;
    a.paused = true;
    for (let i = 0; i < n && !a.world.ended && !a.crash; i++) a.stepWorld(1);
    a.dirtyPanels = true;
    a.dirtyHud = true;
    a.paused = wasPaused;
    return a.world.t;
  }, seconds);
}

/** Closes every open dialog, as its own close button would. */
export async function closeDialogs(page) {
  return page.evaluate(() => {
    const ids = [];
    for (const d of document.querySelectorAll('dialog[open]')) {
      ids.push(d.id);
      d.close();
    }
    return ids;
  });
}

/** Where a unit or an installation is on the screen: [x, y] in page pixels, or null. */
export async function screenOf(page, kind, id) {
  return page.evaluate(({ kind, id }) => {
    const a = window.__game;
    const w = a.world;
    let u = null;
    if (kind === 'raid') u = a.estimateOf(id);
    else if (w.byId[kind]) u = w.byId[kind].get(id);
    else u = (w[`${kind}s`] || []).find((x) => x.id === id);
    if (!u) return null;
    const [sx, sy] = a.toScreen(u.x, u.y);
    const r = a.canvas.getBoundingClientRect();
    return [r.left + sx, r.top + sy];
  }, { kind, id });
}
