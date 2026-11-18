// The rules of the house, checked on the sources themselves: the simulation knows nothing of
// the interface, every text shown is in data/i18n/fr.json, and no rule lies unused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function listFiles(dir, pattern, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, pattern, out);
    else if (pattern.test(name)) out.push(full);
  }
  return out;
}

const sources = listFiles(join(root, 'src'), /\.js$/).map((file) => ({
  file,
  rel: relative(root, file).split('\\').join('/'),
  text: readFileSync(file, 'utf8'),
}));
const fr = JSON.parse(readFileSync(join(root, 'data/i18n/fr.json'), 'utf8'));
const rules = JSON.parse(readFileSync(join(root, 'data/rules.json'), 'utf8'));

/** The code without its comments, strings kept (a small scanner: enough for this code base). */
function withoutComments(text) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i = text.indexOf('*/', i + 2);
      i = i < 0 ? text.length : i + 2;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

function importsOf(source) {
  const found = [];
  for (const m of source.text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
    found.push(relative(root, resolve(dirname(source.file), m[1] || m[2])).split('\\').join('/'));
  }
  return found;
}

test('the simulation imports only itself and src/core; src/core imports nothing else', () => {
  const allowed = { sim: ['sim', 'core'], core: ['core'], save: ['save', 'sim', 'core'] };
  const wrong = [];
  for (const source of sources) {
    const layer = source.rel.split('/')[1];
    if (!allowed[layer]) continue;
    for (const target of importsOf(source)) {
      if (!allowed[layer].includes(target.split('/')[1])) wrong.push(`${source.rel} imports ${target}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the simulation does not touch the page: no document, window or localStorage in src/sim', () => {
  const wrong = [];
  for (const source of sources) {
    if (!source.rel.startsWith('src/sim/')) continue;
    const code = withoutComments(source.text);
    for (const word of ['document', 'window', 'localStorage', 'navigator']) {
      if (new RegExp(`(^|[^A-Za-z0-9_$.])${word}\\.`).test(code)) wrong.push(`${source.rel} uses ${word}`);
    }
  }
  assert.deepEqual(wrong, []);
});

// Two lines work on the French language itself and hold no text to show: the hour the player
// types ("à 14:30"), and the elision "de Aldergrove" → "d'Aldergrove".
const LANGUAGE_MECHANICS = [
  ['src/sim/navigation.js', '/^(?:à\\s*)?('],
  ['src/ui/format.js', '.replace(/\\b([dD])e ('],
];

test('no French text in the code: every text shown comes from data/i18n/fr.json', () => {
  const wrong = [];
  for (const source of sources) {
    const code = withoutComments(source.text);
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      if (!/[àâçéèêëîïôùûüœÀÂÇÉÈÊÎÔÙÛŒ«»]/.test(line)) return;
      if (LANGUAGE_MECHANICS.some(([file, part]) => file === source.rel && line.includes(part))) return;
      wrong.push(`${source.rel}: ${line.trim().slice(0, 80)} (line ${i + 1} of the code without comments)`);
    });
  }
  assert.deepEqual(wrong, []);
});

/** The string literals of a source (comments skipped; `${…}` and tags blanked). */
function stringsOf(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i = text.indexOf('*/', i + 2);
      i = i < 0 ? text.length : i + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let s = '';
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\') {
          s += text[j + 1];
          j += 2;
        } else s += text[j++];
      }
      out.push(s.replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]*>/g, ' '));
      i = j + 1;
    } else i++;
  }
  return out;
}

test('no sentence written in the code: three words in a row belong in fr.json', () => {
  const wrong = [];
  for (const source of sources) {
    for (const s of stringsOf(source.text)) {
      const classes = /^[a-z0-9-]+( [a-z0-9-]+)*$/.test(s.trim()); // "fm-chip active wide": style classes
      if (!classes && /[A-Za-zÀ-ÿ]{3,} [a-zà-ÿ]{2,} [a-zà-ÿ]{2,}/.test(s)) wrong.push(`${source.rel}: ${s.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('every text key the code names exists in fr.json, and so do the keys of the page', () => {
  const lookup = (key) => key.split('.').reduce((node, part) => (node === null || node === undefined ? undefined : node[part]), fr);
  const missing = [];
  for (const source of sources) {
    for (const m of source.text.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'\s*[,)]/g)) {
      if (lookup(m[1]) === undefined) missing.push(`${source.rel}: ${m[1]}`);
    }
  }
  const page = readFileSync(join(root, 'index.html'), 'utf8');
  for (const m of page.matchAll(/data-i18n(?:-title|-label)?="([^"]+)"/g)) {
    if (lookup(m[1]) === undefined) missing.push(`index.html: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('no dead rule: every key of data/rules.json is named somewhere in the code', () => {
  // Catalogues are read by the name of their entries (an aircraft type), notes are for the reader.
  const catalogues = new Set(['fighters', 'bombers', 'patrols']);
  const code = sources.map((s) => s.text).join('\n');
  const dead = [];
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const here = [...path, key];
      const isNote = key === 'note' || key.endsWith('Note');
      const inCatalogue = path.length === 1 && catalogues.has(path[0]);
      if (!isNote && !inCatalogue) {
        const named = new RegExp(`(^|[^A-Za-z0-9_$])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_$]|$)`).test(code);
        if (!named) dead.push(here.join('.'));
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) walk(value, here);
    }
  };
  walk(rules, []);
  assert.deepEqual(dead, []);
});

test('one value for one thing: the U-boat sheet reads the speeds of the simulation', () => {
  assert.equal(rules.ships.uboat.submergedKn, undefined, 'the submerged speed is in rules.asw only');
  assert.equal(rules.ships.uboat.surfaceKn, undefined);
  assert.equal(rules.ships.uboat.batteryNm, undefined);
  assert.ok(rules.asw.submergedKn > 0 && rules.asw.surfaceKn > rules.asw.submergedKn);
});

test('every aircraft type of the scenarios is described in the rules, with its note', () => {
  const wrong = [];
  for (const file of listFiles(join(root, 'data/scenarios'), /\.json$/)) {
    const scenario = JSON.parse(readFileSync(file, 'utf8'));
    for (const s of scenario.squadrons || []) {
      const known = rules.fighters[s.type] || rules.patrols[s.type];
      if (!known) wrong.push(`${scenario.id}: ${s.name} flies an unknown ${s.type}`);
      else if (!fr.cards.notes[s.type]) wrong.push(`${scenario.id}: no note for ${s.type}`);
    }
  }
  assert.deepEqual(wrong, []);
});
