// The help of the sheets (2.11.0): a « ? » by section opens a bubble of four sentences at
// most, with a link to a rubric of the help; the help is masked by default, and the settings
// a player saved before keep a choice only when one was made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { data } from './helpers.js';
import { setDictionary, t } from '../src/core/i18n.js';
import { HELP_TOPICS, hasHelp, helpLink, helpText } from '../src/ui/helpTopics.js';
import { helpMark, helpInline, pageTitle, section, subTitle } from '../src/ui/commands.js';
import { HELP_TABS } from '../src/ui/dialogs.js';
import { defaultSettings, loadSettings } from '../src/save/settings.js';

setDictionary(data.fr);
const root = new URL('..', import.meta.url);

/** The sentences of a text: cut at a full stop, a question or an exclamation mark that ends one (a capital follows, or nothing). */
export function sentences(text) {
  return text.split(/[.!?](?=\s+[A-ZÀ-Ý«]|\s*$)/).map((x) => x.trim()).filter(Boolean);
}

/** Every setting a lead or a tail of a bubble depends on, with the values it can take. */
const VARIANTS = { orders: ['draw', 'headings'], interceptAid: ['auto', 'track', 'none'] };

test('every bubble has its text: two to four sentences, whatever the settings of the game', () => {
  const texts = t('sheetHelp');
  assert.deepEqual(Object.keys(texts).sort(), Object.keys(HELP_TOPICS).sort(), 'one text for each « ? », and no text without its « ? »');
  for (const [key, topic] of Object.entries(HELP_TOPICS)) {
    const settings = [{}];
    for (const pair of [topic.lead, topic.tail]) {
      if (!pair) continue;
      const before = settings.splice(0);
      for (const s of before) for (const v of VARIANTS[pair[1]]) settings.push({ ...s, [pair[1]]: v });
    }
    for (const s of settings) {
      const text = helpText(key, s, { wagons: 20, fuel: 5, materiel: 4, min: 10, n: 24 });
      const n = sentences(text).length;
      assert.ok(n >= 2 && n <= 4, `« ${key} » (${JSON.stringify(s)}): ${n} sentences — ${text}`);
      assert.ok(!/\{\w+\}/.test(text), `« ${key} »: a figure is missing in — ${text}`);
      assert.ok(text.length <= 700, `« ${key} »: ${text.length} signs`);
    }
    // A lead or a tail is there for every value of its setting.
    for (const pair of [topic.lead, topic.tail]) {
      if (!pair) continue;
      for (const v of VARIANTS[pair[1]]) {
        const own = t(`sheetHelpLead.${pair[0]}`);
        assert.ok(own[v] || own.default, `sheetHelpLead.${pair[0]} says nothing for ${pair[1]} = ${v}`);
      }
    }
  }
});

test('every bubble links to a tab of the help', () => {
  for (const key of Object.keys(HELP_TOPICS)) {
    const link = helpLink(key);
    assert.ok(HELP_TABS.includes(link.tab), `« ${key} » → ${link.tab}`);
    assert.ok(link.anchor && link.name, key);
  }
  assert.equal(helpLink('nothing'), null);
});

/** The arguments of each call of `name(` in a source text, cut at the commas of its own level. */
function calls(text, name) {
  const out = [];
  const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const args = [];
    let depth = 0;
    let quote = null;
    let from = m.index + m[0].length;
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        else if (quote === '`' && c === '$' && text[i + 1] === '{') {
          // (a template within a template: skipped to its closing brace)
          let d = 1;
          for (i += 2; i < text.length && d; i++) d += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
          i--;
        }
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (!depth) {
          args.push(text.slice(from, i));
          break;
        }
        depth--;
      } else if (c === ',' && !depth) {
        args.push(text.slice(from, i));
        from = i + 1;
      }
    }
    out.push(args);
  }
  return out;
}

test('every « ? » the pages write names a bubble that exists, and every bubble has its « ? »', () => {
  const used = new Map();
  const files = readdirSync(new URL('src/ui/', root)).filter((f) => f.endsWith('.js') && f !== 'commands.js' && f !== 'helpTopics.js');
  // Where each helper takes the key of its bubble.
  const where = { section: 5, subTitle: 2, helpMark: 0, helpInline: 1, pageTitle: 2, named: 1 };
  for (const file of files) {
    const text = readFileSync(new URL(`src/ui/${file}`, root), 'utf8');
    for (const [name, index] of Object.entries(where)) {
      for (const args of calls(text, name)) {
        if (args.length <= index) continue;
        // (A word a test compares with — `u.kind === 'convoy'` — is not a key.)
        const keys = [...args[index].replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
        if (name !== 'section' || args[index].trim() !== 'null') assert.ok(keys.length, `${file}: ${name}(…) with a key that cannot be read: ${args[index].trim()}`);
        for (const k of keys) {
          assert.ok(hasHelp(k), `${file}: no bubble named « ${k} »`);
          used.set(k, file);
        }
      }
    }
  }
  assert.ok(used.size >= 30, `the « ? » were found (${used.size})`);
  for (const key of Object.keys(HELP_TOPICS)) assert.ok(used.has(key), `the bubble « ${key} » has no « ? » anywhere`);
});

test('the « ? » of a section stands in its title; « affichées » writes its text under it', () => {
  const app = { settings: { sheetHelp: 'folded' }, world: { settings: { orders: 'draw' } } };
  const folded = section(app, 'ground', 'Au sol', '<p>ordres</p>', true, 'ground');
  assert.match(folded, /<summary>Au sol<button type="button" class="help-mark" data-help="ground"[^>]*>\?<\/button><\/summary>/);
  assert.ok(!folded.includes('help-inline'));
  assert.equal(section(app, 'ground', 'Au sol', '', true, 'ground'), '', 'no section, no « ? »');
  assert.ok(!section(app, 'home', 'Retour', '<p>x</p>').includes('help-mark'), 'a section without help has no « ? »');
  assert.equal(helpMark('nothing'), '');
  app.settings.sheetHelp = 'shown';
  const shown = section(app, 'ground', 'Au sol', '<p>ordres</p>', true, 'ground');
  assert.match(shown, /<div class="sec-body"><p class="hint help-inline">Le délai d&#39;un état d&#39;alerte/);
  assert.ok(shown.includes('help-mark'), 'the « ? » stays, for the link to the help');
  assert.match(subTitle(app, 'Envoyer un train', 'train', { wagons: 20, fuel: 5, materiel: 4, min: 10 }), /^<div class="sub">Envoyer un train<button[^>]*data-help="train" data-help-args="[^"]*"[^>]*>\?<\/button><\/div><p class="hint help-inline">Un train compte au plus 20 wagons/);
  assert.equal(helpInline({ settings: { sheetHelp: 'folded' }, world: app.world }, 'train'), '');
  // A page: the « ? » in its title; no world in hand on the main menu, and no harm.
  assert.match(pageTitle({ settings: { sheetHelp: 'folded' } }, 'Charger', 'load'), /^<h2>Charger<button[^>]*data-help="load"[^>]*>\?<\/button><\/h2>$/);
  assert.match(pageTitle({ settings: { sheetHelp: 'shown' } }, 'Charger', 'load'), /<\/h2><p class="hint help-inline">La partie en cours/);
  assert.equal(pageTitle(app, 'Rapports'), '<h2>Rapports</h2>');
  // The first sentence of a route's bubble follows the way orders are given.
  assert.match(helpText('routeAir', { orders: 'draw' }), /^Glissez depuis l'unité pour tracer sa route/);
  assert.match(helpText('routeAir', { orders: 'headings' }), /^En ordres par caps/);
});

test('the sheets write no help sentence of their own any more', () => {
  // (2.11.0, lot 3.) What a sheet says is a state, an order or an alert; help is a « ? »
  // bubble, a tooltip or the help. The only help paragraph is the text of a bubble, written
  // under its title when the player asked for « Aides des fiches : affichées ».
  for (const file of ['panels.js', 'logisticsPanels.js', 'rosterPage.js', 'formationsPage.js', 'watchPanel.js', 'pages.js']) {
    const text = readFileSync(new URL(`src/ui/${file}`, root), 'utf8');
    const hints = [...text.matchAll(/class="hint[^"]*"[^`]*?t\(`?'?([\w.${}]+)/g)].map((m) => m[1]);
    assert.deepEqual(hints, [], `${file}: a help paragraph is still written`);
  }
});

test('every tooltip of the tidied sheets is used, in one line', () => {
  const ui = readdirSync(new URL('src/ui/', root)).filter((f) => f.endsWith('.js')).map((f) => readFileSync(new URL(`src/ui/${f}`, root), 'utf8')).join('\n');
  const flat = (node, path) => (typeof node === 'string' ? [[path, node]] : Object.entries(node).flatMap(([k, v]) => flat(v, `${path}.${k}`)));
  for (const [key, text] of flat(t('tips'), 'tips')) {
    const parent = key.slice(0, key.lastIndexOf('.'));
    assert.ok(ui.includes(`'${key}'`) || ui.includes(`\`${parent}.\${`), `${key} is read nowhere`);
    assert.ok(text.length <= 200, `${key}: ${text.length} signs — a tooltip is one line`);
    assert.ok(sentences(text).length <= 2, `${key}: ${text}`);
  }
});

test('the help is masked by default; settings saved before 2.11.0 keep a choice only when one was made', () => {
  assert.equal(defaultSettings(data.presets).sheetHelp, 'folded');
  assert.deepEqual(data.presets.choices.sheetHelp, ['folded', 'shown']);
  const store = new Map();
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  try {
    const KEY = 'jeu-1940.settings.v1';
    assert.equal(loadSettings(data.presets).sheetHelp, 'folded', 'nothing saved');
    // Saved by 2.10: the default of then, written with all the rest. No choice was made.
    store.set(KEY, JSON.stringify({ ...defaultSettings(data.presets), sheetHelp: 'shown', sheetPos: 'left' }));
    const old = loadSettings(data.presets);
    assert.equal(old.sheetHelp, 'folded', 'the new default');
    assert.equal(old.sheetPos, 'left', 'the rest is kept');
    // Chosen since, on the settings page: kept.
    store.set(KEY, JSON.stringify({ ...defaultSettings(data.presets), sheetHelp: 'shown', sheetHelpChosen: true }));
    assert.equal(loadSettings(data.presets).sheetHelp, 'shown');
    store.set(KEY, JSON.stringify({ ...defaultSettings(data.presets), sheetHelp: 'folded', sheetHelpChosen: true }));
    assert.equal(loadSettings(data.presets).sheetHelp, 'folded');
  } finally {
    globalThis.localStorage = real;
  }
});
