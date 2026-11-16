// Builds dist/index.html: the whole game in one file (code, styles and data), which opens
// directly from the disk without a web server, or can be published as a single page.
//
//   cd tools && npm install && node build-page.mjs

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

function listJson(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJson(full));
    else if (name.endsWith('.json')) out.push(full);
  }
  return out;
}

const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

const data = {};
for (const file of listJson(join(root, 'data'))) {
  data[relative(root, file).split('\\').join('/')] = JSON.parse(readFileSync(file, 'utf8'));
}
const dataScript = `window.__GAME_DATA__=${JSON.stringify(data).replace(/</g, '\\u003c')};`;

const css = readFileSync(join(root, 'style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>${dataScript}</script>\n  <script>${js}</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`dist/index.html: ${(html.length / 1024).toFixed(0)} KiB`);
