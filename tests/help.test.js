// The help in tabs and its pictures from the test bench: every tab has its text, every picture
// its caption, and the tutorial steps their title and text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const fr = read('data/i18n/fr.json');
const images = read('data/help/images.json');

test('every help tab has a name and some text', () => {
  for (const id of ['scenario', 'sheet', 'air', 'sea', 'time', 'keys']) {
    assert.equal(typeof fr.help.tabs[id], 'string', `tab ${id}`);
  }
  for (const id of ['sheet', 'air', 'sea', 'time']) {
    assert.ok(Array.isArray(fr.help[id]) && fr.help[id].length > 0, `help.${id}`);
    for (const line of fr.help[id]) assert.ok(typeof line === 'string' && line.length > 20, `help.${id}: ${line}`);
  }
  for (const [id, lines] of Object.entries(fr.help.scenario)) assert.ok(Array.isArray(lines) && lines.length, id);
  assert.ok(fr.help.steps.length && fr.help.stepsTraining.length);
});

test('the help pictures are small images with a caption', () => {
  for (const [name, src] of Object.entries(images)) {
    assert.match(src, /^data:image\/webp;base64,/, name);
    assert.ok(src.length < 60000, `${name}: ${src.length} characters`);
    assert.equal(typeof fr.help.images[name], 'string', `caption of ${name}`);
  }
});

test('the help speaks of the sheet as it is now (no old tabs)', () => {
  const all = JSON.stringify(fr.help) + JSON.stringify(fr.tutorial);
  for (const old of ['onglet Navigation', 'onglet Ordres', 'onglet Route', 'menu « Scénario »']) {
    assert.ok(!all.includes(old), old);
  }
});

test('every tutorial step has a title and a text', () => {
  for (const id of ['welcome', 'convoy', 'time', 'radar', 'scramble', 'altitude', 'combat', 'reports', 'end']) {
    assert.equal(typeof fr.tutorial[id].title, 'string', id);
    assert.ok(fr.tutorial[id].text.length > 20, id);
  }
});
