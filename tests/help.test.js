// The help in tabs and its pictures from the test bench: every tab has its rubrics, short and
// titled, each with its anchor; every « ? » bubble and every link of the help lead to a rubric
// that exists; every picture has its caption, and the tutorial steps their title and text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setDictionary } from '../src/core/i18n.js';
import { HELP_LINK, HELP_TABS, helpParagraph, helpRubrics } from '../src/ui/dialogs.js';
import { HELP_TOPICS, helpLink } from '../src/ui/helpTopics.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const fr = read('data/i18n/fr.json');
const images = read('data/help/images.json');
setDictionary(fr);

/** The tabs of the help written as rubrics (« Ce scénario » is a numbered list). */
const RUBRIC_TABS = HELP_TABS.filter((id) => id !== 'scenario');
const anchorsOf = (tab) => helpRubrics(tab).map((r) => r.id);

test('every help tab has a name, and its rubrics: a title, an anchor of its own, short paragraphs', () => {
  for (const id of HELP_TABS) assert.equal(typeof fr.help.tabs[id], 'string', `tab ${id}`);
  for (const id of RUBRIC_TABS) {
    const list = helpRubrics(id);
    assert.ok(list.length > 0, `help.rubrics.${id}`);
    assert.equal(new Set(list.map((r) => r.id)).size, list.length, `${id}: an anchor is used twice`);
    for (const r of list) {
      assert.match(r.id, /^[a-z][a-z-]*$/, `${id}: anchor « ${r.id} »`);
      assert.ok(typeof r.title === 'string' && r.title.length > 3 && r.title.length <= 48, `${id}.${r.id}: title`);
      assert.ok(Array.isArray(r.text) && r.text.length > 0 && r.text.length <= 6, `${id}.${r.id}: paragraphs`);
      for (const p of r.text) {
        assert.ok(typeof p === 'string' && p.length > 20, `${id}.${r.id}: ${p}`);
        // (The longest paragraph of the help of 2.10 had 1 332 signs.)
        assert.ok(p.length <= 560, `${id}.${r.id}: a paragraph of ${p.length} signs`);
      }
      if (r.image) assert.ok(images[r.image], `${id}.${r.id}: picture « ${r.image} »`);
    }
  }
  for (const [id, lines] of Object.entries(fr.help.scenario)) assert.ok(Array.isArray(lines) && lines.length, id);
  assert.ok(fr.help.steps.length && fr.help.stepsTraining.length);
  // The old shape is gone: one place for each text.
  for (const id of ['sheet', 'air', 'sea', 'time', 'games', 'keys']) assert.equal(fr.help[id], undefined, `help.${id}`);
});

test('the help has its rubrics on the gestures of the map and on reading a sheet', () => {
  const sheet = helpRubrics('sheet');
  const traces = sheet.find((r) => r.id === 'traces');
  const all = traces.text.join(' ');
  for (const word of ['Glissez', '« + »', 'anneau', 'Double-cliquez', 'Suppr', '↑ ↓', 'Échap']) assert.ok(all.includes(word), `« Tracés » says nothing of ${word}`);
  const map = sheet.find((r) => r.id === 'carte').text.join(' ');
  for (const word of ['déplacer', 'molette', 'pincement', 'double-clic', '+ et −', 'Maj + glisser']) assert.ok(map.includes(word), `« La carte » says nothing of ${word}`);
  const read = sheet.find((r) => r.id === 'lire').text.join(' ');
  for (const word of ['état', '« ? »', 'bulle', 'Aides des fiches']) assert.ok(read.includes(word), `« Lire une fiche » says nothing of ${word}`);
  // The keys: the report of the watch has its own (2.10.4), and the zoom.
  const keys = helpRubrics('keys').flatMap((r) => r.text).join(' ');
  for (const word of ['Q, rapport de quart', '+ et −, zoom', 'Espace, pause', 'Suppr']) assert.ok(keys.includes(word), `the keys: ${word}`);
});

test('every « ? » bubble links to a rubric that exists, by its title', () => {
  for (const key of Object.keys(HELP_TOPICS)) {
    const link = helpLink(key);
    assert.ok(anchorsOf(link.tab).includes(link.anchor), `« ${key} » → ${link.tab}:${link.anchor}`);
    assert.equal(link.name, helpRubrics(link.tab).find((r) => r.id === link.anchor).title, key);
  }
});

test('every link written in the help leads to a rubric that exists', () => {
  const texts = [...RUBRIC_TABS.flatMap((id) => helpRubrics(id).flatMap((r) => r.text)), ...fr.help.steps, ...fr.help.stepsTraining, ...Object.values(fr.help.scenario).flat()];
  let links = 0;
  for (const text of texts) {
    for (const m of text.matchAll(HELP_LINK)) {
      links++;
      assert.ok(anchorsOf(m[1]).includes(m[2]), `[[${m[1]}:${m[2]}]] in « ${text.slice(0, 60)}… »`);
      assert.equal(m[3], helpRubrics(m[1]).find((r) => r.id === m[2]).title, `the words of a link are the title of its rubric: ${m[0]}`);
    }
    // Nothing left of a link badly written.
    assert.ok(!/\[\[|\]\]/.test(text.replace(HELP_LINK, '')), text);
  }
  assert.ok(links >= 8, `links found: ${links}`);
  assert.equal(helpParagraph('Voir [[sea:silence|Silence radio]] & <b>.'), 'Voir <button type="button" class="link" data-hlink="sea:silence">Silence radio</button> &amp; &lt;b&gt;.');
});

test('a lesson has its own « Ce scénario », not the text of the battle its map comes from', () => {
  const tutorial = read('data/tutorial.json');
  for (const lesson of tutorial.lessons) {
    const own = fr.help.scenario[lesson.scenario];
    assert.ok(Array.isArray(own) && own.length >= 2, `help.scenario.${lesson.scenario}`);
    assert.ok(own[0].startsWith('Leçon « '), `${lesson.scenario}: ${own[0]}`);
  }
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

test('every step of every lesson has a title and a text, and every lesson its name and summary', () => {
  const tutorial = JSON.parse(readFileSync(new URL('../data/tutorial.json', import.meta.url), 'utf8'));
  // Four lessons since 2.10 (I10): intercept, supply, escort, alert states and fatigue; a
  // fifth, short, since 2.11.0, right after the first: draw a route and correct it.
  assert.deepEqual(tutorial.lessons.map((l) => l.id), ['intercept', 'route', 'supply', 'escort', 'alert']);
  // Their names are numbered in that order, and the scenarios they are played on too.
  tutorial.lessons.forEach((l, i) => {
    assert.ok(fr.tutorial.lessons[l.id].name.startsWith(`Leçon ${i + 1} · `), fr.tutorial.lessons[l.id].name);
    assert.ok(fr.scenarios[l.scenario].title.startsWith(`Leçon ${i + 1} : `), fr.scenarios[l.scenario].title);
    assert.ok(read(`data/scenarios/${l.scenario}.json`).title.startsWith(`Leçon ${i + 1} : `), l.scenario);
  });
  // No text counts four lessons any more.
  for (const key of ['trainingText', 'trainingFirst', 'trainingIntro']) assert.ok(/cinq leçons/i.test(fr.menu[key]), fr.menu[key]);
  assert.ok(!/quatre (leçons|gestes)/i.test(JSON.stringify(fr)), 'a text still counts four');
  for (const lesson of tutorial.lessons) {
    const texts = fr.tutorial.lessons[lesson.id];
    assert.ok(texts && texts.name.length > 5 && texts.summary.length > 20, lesson.id);
    for (const step of lesson.steps) {
      assert.equal(typeof texts.steps[step.id].title, 'string', `${lesson.id}.${step.id}`);
      assert.ok(texts.steps[step.id].text.length > 20, `${lesson.id}.${step.id}`);
    }
    // No text left over from a step that is gone.
    assert.deepEqual(Object.keys(texts.steps).sort(), lesson.steps.map((s) => s.id).sort(), lesson.id);
  }
});
