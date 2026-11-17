import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, makeKanalkampf, run } from './helpers.js';
import { knownOutcome } from '../src/sim/reports.js';
import { reportHtml } from '../src/ui/pages.js';
import { setDictionary } from '../src/core/i18n.js';
import { restore, snapshot } from '../src/save/game.js';

setDictionary(data.fr);

const H = 3600;

function targetWords(w, r) {
  const site = w.sites.get(r.target);
  return site ? [site.name, site.longName].filter(Boolean) : [];
}

test('a raid report tells what the RAF knows: no target before the bombs, no force before it is seen', () => {
  const w = makeKanalkampf();
  const events = run(w, 8 * H, (e) => e.type === 'raidDetected');
  const det = events.find((e) => e.type === 'raidDetected');
  assert.ok(det, 'a raid on the table');
  const r = w.raids.find((x) => x.id === det.raidId);
  const rep = w.reports.get(r.id);
  assert.equal(rep.seen, null);
  assert.equal(rep.estimate.count, det.count);
  const html = reportHtml({ world: w, dev: false }, rep);
  assert.match(html, /Premier plot/);
  assert.match(html, /pas encore vu/);
  if (r.bomberType) assert.ok(!html.includes(r.bomberType), 'no bomber type before it is seen');
  for (const word of targetWords(w, r)) assert.ok(!html.includes(word), `no target (${word}) before the bombs`);
  // Developer mode: one line apart tells the truth.
  const dev = reportHtml({ world: w, dev: true }, rep);
  assert.match(dev, /Mode développeur/);
  if (r.bomberType) assert.ok(dev.includes(r.bomberType));
  // Once one of our units sees it, the force goes into the report, with who saw it.
  run(w, 6 * H, (e) => (e.type === 'raidSighted' || e.type === 'tallyHo') && e.raidId === r.id);
  if (rep.seen) {
    const seen = reportHtml({ world: w, dev: false }, rep);
    assert.match(seen, /Vu par/);
    assert.ok(seen.includes(rep.seen.bomberType || rep.seen.escortType));
  }
  // Saved and loaded: what the RAF knows stays.
  const w2 = makeKanalkampf();
  restore(w2, JSON.parse(JSON.stringify(snapshot(w))));
  assert.deepEqual(w2.reports.get(r.id).estimate, rep.estimate);
  assert.deepEqual(w2.reports.get(r.id).seen, rep.seen);
});

test('how a raid ended, as the RAF sees it: never seen and no bombs cannot be told from a false echo', () => {
  assert.equal(knownOutcome({ closed: false, outcome: null, seen: null }), 'ongoing');
  assert.equal(knownOutcome({ closed: true, outcome: 'phantom', seen: null }), 'unseen');
  assert.equal(knownOutcome({ closed: true, outcome: 'gone', seen: null }), 'unseen');
  assert.equal(knownOutcome({ closed: true, outcome: 'gone', seen: { t: 0 } }), 'gone');
  assert.equal(knownOutcome({ closed: true, outcome: 'sweep', seen: null }), 'unseen');
  assert.equal(knownOutcome({ closed: true, outcome: 'sweep', seen: { t: 0 } }), 'sweep');
  assert.equal(knownOutcome({ closed: true, outcome: 'sweep', seen: null }, true), 'sweep', 'exact radar');
  assert.equal(knownOutcome({ closed: true, outcome: 'bombed', seen: null }), 'bombed');
  for (const o of ['destroyed', 'repelled', 'bombed', 'unopposed', 'gone', 'phantom', 'sweep', 'unseen', 'ongoing']) {
    assert.ok(data.fr.reports.outcome[o], o);
  }
});

test('every raid of a day: reports never show a target that was not bombed', () => {
  const w = makeKanalkampf();
  run(w, 14 * H);
  assert.ok(w.reports.size > 0);
  for (const rep of w.reports.values()) {
    const r = w.raids.find((x) => x.id === rep.raidId);
    const html = reportHtml({ world: w, dev: false }, rep);
    const bombed = new Set(rep.hits.map((h) => h.site));
    if (r && r.target && !bombed.has(r.target)) {
      for (const word of targetWords(w, r)) {
        // The name may still appear as the place that saw it or a site hit by bombs.
        const elsewhere = (rep.seen && rep.seen.by === word) || rep.hits.some((h) => h.siteName === word);
        if (!elsewhere) assert.ok(!html.includes(word), `${rep.label}: ${word}`);
      }
    }
    assert.ok(!html.includes('reports.'), `${rep.label}: every text in French`);
  }
});
