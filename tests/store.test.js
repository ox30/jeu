// I7: the saves kept in the browser. The game under way, five automatic saves, the manual
// ones; packed; an index for the menu; a full or closed storage is told, never thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run } from './helpers.js';
import { AUTO_KEPT, CURRENT, createStore } from '../src/save/store.js';
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
