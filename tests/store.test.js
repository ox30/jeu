// I7: the saves kept in the browser. The game under way, five automatic saves, the manual
// ones; packed; an index for the menu; a full or closed storage is told, never thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { AUTO_KEPT, CURRENT, OTHER_GAMES_KEPT, createStore } from '../src/save/store.js';
import { canCompress, pack, unpack } from '../src/save/pack.js';
import { SaveError, readSave } from '../src/save/migrate.js';
import { snapshot } from '../src/save/game.js';

/** A localStorage of the tests: in memory, with a size it refuses to pass (characters). */
function fakeStorage(quota = Infinity) {
  const map = new Map();
  const used = () => [...map.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const next = used() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + String(v).length;
      if (next > quota) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: (k) => { map.delete(k); },
    used,
    keys: () => [...map.keys()],
  };
}

function saveOf(w, gameId = 'g1', playMs = 60000) {
  return {
    game: 'jeu-1940', madeBy: 'test', savedAt: 1, snap: JSON.parse(JSON.stringify(snapshot(w))),
    meta: { gameId, playClock: { totalMs: playMs, pausedMs: 0 }, gameMs: w.startMs + w.t * 1000 },
    journal: [{ text: 'Début', level: 'info', t: 0, report: null }],
  };
}

test('a save is packed to a fraction of its size and comes back letter for letter', async () => {
  assert.ok(canCompress(), 'this Node has CompressionStream, as the browsers do');
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 3 * 86400);
  const text = JSON.stringify(saveOf(w));
  const packed = await pack(text);
  assert.equal(packed.enc, 'gzip');
  assert.ok(packed.data.length < text.length / 3, `${packed.data.length} characters for ${text.length}`);
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(packed.data), 'plain base64: safe in any storage');
  assert.equal(await unpack(packed), text);
  // Text with accents and signs outside ASCII survives too.
  const french = 'Ça s\'est passé à Élan-le-Désert — « 7,5 % » ✓ ☰';
  assert.equal(await unpack(await pack(french)), french);
  assert.equal(await unpack({ enc: 'raw', data: french }), french);
  await assert.rejects(() => unpack({ enc: 'zip', data: 'x' }));
  await assert.rejects(() => unpack({ enc: 'gzip', data: 'AAAA' }));
});

test('the game under way is kept at once, listed, and read back', async () => {
  const storage = fakeStorage();
  const store = createStore({ storage, now: () => 1000 });
  assert.equal(store.current(), null);
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 3600);
  const save = saveOf(w, 'g7', 125000);
  assert.deepEqual(store.writeCurrent(save), { ok: true, id: CURRENT });
  const e = store.current();
  assert.equal(e.kind, 'current');
  assert.equal(e.scenario, 'adlertag');
  assert.equal(e.t, 3600);
  assert.equal(e.gameId, 'g7');
  assert.equal(e.playMs, 125000);
  assert.equal(e.gameMs, w.startMs + 3600 * 1000);
  assert.equal(e.savedAt, 1000);
  const back = await store.read(CURRENT);
  assert.deepEqual(back, save);
  assert.equal(readSave(back).snap.t, 3600, 'and it is a sound game');
  // Another store on the same storage (the page reopened) sees it.
  const later = createStore({ storage });
  assert.equal(later.current().t, 3600);
});

test('automatic saves: the last five are kept, the oldest go', async () => {
  const storage = fakeStorage();
  let clock = 0;
  const store = createStore({ storage, now: () => ++clock });
  const w = makeWorld('standard', {}, 'adlertag');
  const ids = [];
  for (let day = 1; day <= 8; day++) {
    run(w, 600);
    const r = await store.add('auto', saveOf(w));
    assert.ok(r.ok);
    ids.push(r.id);
  }
  const autos = store.entries().filter((e) => e.kind === 'auto');
  assert.equal(autos.length, AUTO_KEPT);
  assert.equal(AUTO_KEPT, 5);
  assert.deepEqual(autos.map((e) => e.id), ids.slice(-5).reverse(), 'the newest first, the three oldest gone');
  assert.equal(autos[0].t, 8 * 600);
  // The slots of the saves dropped are gone from the storage too.
  assert.equal(storage.keys().filter((k) => k.includes('.save.v2.auto-')).length, 5);
  await assert.rejects(() => store.read(ids[0]), (err) => err instanceof SaveError && err.code === 'missing');
  // A manual save is not counted with them, and stays.
  const manual = await store.add('manual', saveOf(w));
  for (let i = 0; i < 6; i++) await store.add('auto', saveOf(w));
  assert.ok(store.entry(manual.id), 'the manual save is still there');
  assert.equal(store.entries().filter((e) => e.kind === 'auto').length, 5);
  assert.equal((await store.read(manual.id)).snap.t, w.t);
  store.remove(manual.id);
  assert.equal(store.entry(manual.id), null);
});

test('a full storage is told, and the oldest automatic save makes room once', async () => {
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 600);
  const save = saveOf(w);
  const one = JSON.stringify(await pack(JSON.stringify(save))).length;
  // Room for two packed saves and the index, not three.
  const storage = fakeStorage(one * 2 + 1500);
  let clock = 0;
  const store = createStore({ storage, now: () => ++clock });
  const a = await store.add('auto', save);
  const b = await store.add('auto', save);
  assert.ok(a.ok && b.ok);
  const c = await store.add('auto', save);
  assert.ok(c.ok, 'the oldest automatic save was dropped to make room');
  assert.equal(store.entry(a.id), null);
  assert.ok(store.entry(b.id) && store.entry(c.id));
  // Manual saves are never dropped for room: when nothing can go, the write fails and says so.
  const tight = fakeStorage(one + 600);
  const s2 = createStore({ storage: tight, now: () => ++clock });
  const m1 = await s2.add('manual', save);
  assert.ok(m1.ok);
  const m2 = await s2.add('manual', save);
  assert.deepEqual(m2, { ok: false, code: 'storage' });
  assert.ok(s2.entry(m1.id), 'what was there is still there');
  assert.equal((await s2.read(m1.id)).snap.t, 600);
  // The game under way, as plain text, does not fit either: told, not thrown.
  assert.deepEqual(s2.writeCurrent(save), { ok: false, code: 'storage' });
});

test('no storage at all (private mode, a closed frame): every write says so', async () => {
  const store = createStore({ storage: null });
  assert.equal(store.available, false);
  const w = makeWorld('standard', {}, 'adlertag');
  assert.deepEqual(store.writeCurrent(saveOf(w)), { ok: false, code: 'storage' });
  assert.deepEqual(await store.add('manual', saveOf(w)), { ok: false, code: 'storage' });
  assert.deepEqual(store.entries(), []);
  await assert.rejects(() => store.read('current'), (err) => err.code === 'missing');
  // A storage that throws on every call behaves the same.
  const broken = { get length() { throw new Error('closed'); }, key() { throw new Error('closed'); }, getItem() { throw new Error('closed'); }, setItem() { throw new Error('closed'); }, removeItem() { throw new Error('closed'); } };
  const s2 = createStore({ storage: broken });
  assert.deepEqual(s2.writeCurrent(saveOf(w)), { ok: false, code: 'storage' });
  assert.deepEqual(await s2.add('auto', saveOf(w)), { ok: false, code: 'storage' });
});

test('a damaged slot or a lost index does not break the list', async () => {
  const storage = fakeStorage();
  const store = createStore({ storage, now: () => 5 });
  const w = makeWorld('standard', {}, 'adlertag');
  const r = await store.add('manual', saveOf(w));
  storage.setItem(`jeu-1940.save.v2.${r.id}`, '{"enc":"gzip","data":"not base64 at all !!"}');
  await assert.rejects(() => store.read(r.id), (err) => err instanceof SaveError && err.code === 'damaged');
  storage.setItem(`jeu-1940.save.v2.${r.id}`, 'half a file {');
  await assert.rejects(() => store.read(r.id), (err) => err.code === 'damaged');
  // The index lost: the stray slots are cleared, the list starts again empty.
  storage.setItem('jeu-1940.saves.v2', 'garbage');
  const again = createStore({ storage });
  assert.deepEqual(again.entries(), []);
  assert.equal(storage.keys().filter((k) => k.startsWith('jeu-1940.save.v2.')).length, 0);
  // An entry whose slot was removed by hand leaves the list.
  const s3 = createStore({ storage, now: () => 9 });
  const m = await s3.add('manual', saveOf(w));
  storage.removeItem(`jeu-1940.save.v2.${m.id}`);
  assert.equal(createStore({ storage }).entry(m.id), null);
});

test('a game replaced by another keeps its last automatic save while the new one is played', async () => {
  // (Review of 2.9: the five kept were the five last of all games, so that a game replaced
  // « and kept among the automatic saves » was gone after a few days of the next one.)
  const storage = fakeStorage();
  let clock = 0;
  const store = createStore({ storage, now: () => ++clock });
  const w = makeWorld('standard', {}, 'kanalkampf');
  for (let day = 1; day <= 3; day++) {
    run(w, 86400);
    assert.ok((await store.add('auto', saveOf(w, 'kanal'))).ok);
  }
  const lastOfKanal = w.t;
  const w2 = makeWorld('standard', {}, 'quinze-septembre');
  for (let i = 0; i < AUTO_KEPT + 3; i++) {
    run(w2, 7200);
    assert.ok((await store.add('auto', saveOf(w2, 'sept'))).ok);
  }
  const autos = store.entries().filter((e) => e.kind === 'auto');
  assert.equal(autos.filter((e) => e.gameId === 'sept').length, AUTO_KEPT, 'the last five of the game being played');
  const kept = autos.filter((e) => e.gameId === 'kanal');
  assert.equal(kept.length, 1, 'and the newest of the game before it');
  assert.equal(kept[0].t, lastOfKanal);
  assert.equal((await store.read(kept[0].id)).snap.scenario, 'kanalkampf');
  // Back in the first game: it is the one whose five are kept now, the other keeps its newest.
  for (let i = 0; i < AUTO_KEPT; i++) {
    run(w, 86400);
    await store.add('auto', saveOf(w, 'kanal'));
  }
  const after = store.entries().filter((e) => e.kind === 'auto');
  assert.equal(after.filter((e) => e.gameId === 'kanal').length, AUTO_KEPT);
  assert.equal(after.filter((e) => e.gameId === 'sept').length, 1);
  assert.equal(after.find((e) => e.gameId === 'sept').t, w2.t);
  // The games before are not kept for ever: the five saved last.
  for (let g = 0; g < OTHER_GAMES_KEPT + 3; g++) await store.add('auto', saveOf(w2, `game-${g}`));
  const games = new Set(store.entries().filter((e) => e.kind === 'auto').map((e) => e.gameId));
  assert.equal(games.size, OTHER_GAMES_KEPT + 1, 'the game saved last and the five before it');
  assert.ok(!games.has('kanal') && !games.has('sept') && games.has(`game-${OTHER_GAMES_KEPT + 2}`));
  // Nothing is left in the storage that the list does not show.
  assert.equal(storage.keys().filter((k) => k.startsWith('jeu-1940.save.v2.')).length, store.entries().length);
});

test('a save that fails on a full storage loses nothing of what was there', async () => {
  // (Review of 2.9: each failed save dropped the oldest automatic save to make room, and did
  // not put it back when there was still no room.)
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 600);
  const save = saveOf(w);
  const one = JSON.stringify({ ...(await pack(JSON.stringify(save))), entry: { id: 'auto-1' } }).length;
  // Room for three small packed saves and the index.
  const storage = fakeStorage(one * 3 + 2400);
  let clock = 0;
  const store = createStore({ storage, now: () => ++clock });
  const a = await store.add('auto', save);
  const b = await store.add('auto', save);
  const m = await store.add('manual', save);
  assert.ok(a.ok && b.ok && m.ok);
  // A game ten times as long does not fit, even with an automatic save dropped.
  const long = saveOf(w);
  long.journal = Array.from({ length: 4000 }, (_, i) => ({ text: `Ligne ${i} ${Math.sin(i)} ${Math.cos(i * 7)}`, level: 'info', t: i, report: null }));
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(await store.add('auto', long), { ok: false, code: 'storage' });
    assert.deepEqual(await store.add('manual', long), { ok: false, code: 'storage' });
  }
  assert.deepEqual(store.entries().map((e) => e.id).sort(), [a.id, b.id, m.id].sort(), 'the three saves are still listed');
  for (const id of [a.id, b.id, m.id]) assert.equal((await store.read(id)).snap.t, 600, `${id} can still be read`);
  // And a page opened afterwards finds them too.
  assert.equal(createStore({ storage }).entries().length, 3);
});

test('two pages of the game on the same storage do not overwrite each other', async () => {
  // (Review of 2.9: each page numbered its saves from its own memory.)
  const storage = fakeStorage();
  let clock = 0;
  const pageA = createStore({ storage, now: () => ++clock });
  const pageB = createStore({ storage, now: () => ++clock }); // opened before A saves
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 600);
  const first = await pageA.add('manual', saveOf(w, 'a'));
  run(w, 600);
  const second = await pageB.add('manual', saveOf(w, 'b'));
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.id, second.id);
  assert.equal((await pageB.read(first.id)).snap.t, 600, 'the save of the first page is still there');
  assert.equal((await pageA.read(second.id)).snap.t, 1200);
  // Each page lists both once it looks again (the menu does, each time it is shown).
  pageA.refresh();
  assert.deepEqual(pageA.entries().map((e) => e.id).sort(), [first.id, second.id].sort());
  // A save deleted in one page does not come back from the other's memory.
  pageA.remove(first.id);
  await pageB.add('auto', saveOf(w, 'b'));
  assert.equal(createStore({ storage }).entry(first.id), null);
  assert.ok(createStore({ storage }).entry(second.id));
});

test('an index lost is made again from the saves themselves', async () => {
  // (Review of 2.9: an unreadable index made the game clear every save away.)
  const storage = fakeStorage();
  let clock = 100;
  const store = createStore({ storage, now: () => ++clock });
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  run(w, 3600);
  const auto = await store.add('auto', saveOf(w, 'g', 120000));
  const manual = await store.add('manual', saveOf(w, 'g', 120000));
  assert.ok(store.writeCurrent(saveOf(w, 'g', 120000)).ok);
  const before = store.entries().map((e) => ({ ...e }));
  for (const lost of ['garbage', '{"next":3,"entries":', null]) {
    if (lost === null) storage.removeItem('jeu-1940.saves.v2');
    else storage.setItem('jeu-1940.saves.v2', lost);
    const again = createStore({ storage, now: () => ++clock });
    assert.equal(again.entries().length, 3, `index ${lost}: the three saves are listed again`);
    for (const was of before) {
      const e = again.entry(was.id);
      assert.ok(e, `${was.id} is back`);
      for (const k of ['kind', 'gameId', 'scenario', 't', 'gameMs', 'playMs', 'preset', 'ended']) assert.deepEqual(e[k], was[k], `${was.id}: ${k}`);
    }
    assert.equal((await again.read(auto.id)).snap.t, 3600);
    // The numbers already given are not given again.
    const next = await again.add('manual', saveOf(w, 'g'));
    assert.ok(next.ok && ![auto.id, manual.id].includes(next.id));
    again.remove(next.id);
  }
  // Only what cannot be read at all is cleared away.
  storage.setItem('jeu-1940.save.v2.man-99', 'half a file {');
  storage.setItem('jeu-1940.saves.v2', 'garbage');
  const last = createStore({ storage });
  assert.equal(last.entries().length, 3);
  assert.equal(storage.getItem('jeu-1940.save.v2.man-99'), null);
});

test('the game left by version 2.8 becomes the game under way of this version', async () => {
  const storage = fakeStorage();
  const w = makeWorld('standard', {}, 'adlertag');
  run(w, 1800);
  const snap = JSON.parse(JSON.stringify(snapshot(w)));
  storage.setItem('jeu-1940.game.v1', JSON.stringify({ savedAt: 77, snap, meta: { gameId: 'old', playClock: { totalMs: 5000, pausedMs: 0 } } }));
  storage.setItem('jeu-1940.journal.v1', JSON.stringify([{ text: 'Avant', level: 'info', t: 10 }]));
  const store = createStore({ storage, now: () => 100 });
  assert.equal(store.adoptLegacy(), true);
  assert.equal(storage.getItem('jeu-1940.game.v1'), null, 'the old slot is gone');
  assert.equal(storage.getItem('jeu-1940.journal.v1'), null);
  const cur = store.current();
  assert.equal(cur.scenario, 'adlertag');
  assert.equal(cur.gameId, 'old');
  const save = await store.read(CURRENT);
  assert.equal(save.journal[0].text, 'Avant');
  assert.equal(save.snap.t, 1800);
  assert.equal(store.adoptLegacy(), false, 'nothing left to adopt');
});
