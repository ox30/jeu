// The saved games kept in the browser. Three kinds:
//   - current: the game being played, written every few minutes and when the page is left
//     (at once, as plain text: it must be safe before the page goes);
//   - auto: a point to come back to, one a game day (every two game hours in a battle of
//     one day). The last five of the game being played are kept, and the newest of each of
//     the games played before it (five games at most): a game replaced by another stays there;
//   - manual: what the player saves from the menu, kept until he deletes it.
// Automatic and manual saves are packed (pack.js). An index lists them with what the menu
// shows (scenario, game date, time played) so that none has to be opened to be listed; each
// packed slot carries its own line of that list, so that an index lost is made again from the
// slots. Another page of the game may write to the same storage: the list is read again before
// every change. The storage may be closed or full: every write says whether it worked.

import { pack, unpack } from './pack.js';
import { SaveError } from './migrate.js';

const INDEX_KEY = 'jeu-1940.saves.v2';
const SLOT = 'jeu-1940.save.v2.';
const LEGACY_GAME = 'jeu-1940.game.v1';
const LEGACY_JOURNAL = 'jeu-1940.journal.v1';
export const CURRENT = 'current';
/** Automatic saves kept of the game being played. */
export const AUTO_KEPT = 5;
/** Games played before it whose newest automatic save is kept. */
export const OTHER_GAMES_KEPT = 5;

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** What the menu shows of a save, taken from the save itself. */
function describe(save, kind, id, chars, savedAt) {
  const meta = save.meta && typeof save.meta === 'object' ? save.meta : {};
  return {
    id,
    kind,
    gameId: typeof meta.gameId === 'string' ? meta.gameId : null,
    scenario: save.snap.scenario,
    t: save.snap.t,
    gameMs: Number.isFinite(meta.gameMs) ? meta.gameMs : null,
    playMs: meta.playClock && Number.isFinite(meta.playClock.totalMs) ? meta.playClock.totalMs : 0,
    preset: (save.snap.settings && save.snap.settings.preset) || meta.preset || null,
    ended: Boolean(save.snap.ended),
    outcome: save.snap.outcome || null,
    savedAt,
    chars,
  };
}

const soundEntry = (e) => Boolean(e) && typeof e === 'object' && typeof e.id === 'string' && typeof e.scenario === 'string';
const kindOfId = (id) => (id === CURRENT ? 'current' : id.startsWith('auto-') ? 'auto' : 'manual');

export function createStore({ storage = defaultStorage(), now = () => Date.now() } = {}) {
  let index = { next: 1, entries: [] };

  /** The index as the storage has it, or null (none yet, lost, or unreadable). */
  function readIndex() {
    try {
      const raw = storage.getItem(INDEX_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.entries) && Number.isInteger(data.next)) return { next: data.next, entries: data.entries.filter(soundEntry) };
    } catch {
      // unreadable: made again from the slots
    }
    return null;
  }

  function writeIndex() {
    try {
      storage.setItem(INDEX_KEY, JSON.stringify(index));
      return true;
    } catch {
      return false;
    }
  }

  function dropSlot(id) {
    try {
      storage.removeItem(SLOT + id);
    } catch {
      // nothing to do: the storage is closed
    }
  }

  /** The line of the list a slot gives of itself, or null when the slot cannot be read. */
  function entryOfSlot(id) {
    try {
      const raw = storage.getItem(SLOT + id);
      const data = JSON.parse(raw);
      // A packed save carries its line; the game under way, plain, is described from itself.
      if (data && soundEntry(data.entry) && data.entry.id === id) return { ...data.entry, chars: raw.length };
      if (data && data.snap && typeof data.snap.scenario === 'string') {
        return describe(data, kindOfId(id), id, raw.length, Number.isFinite(data.savedAt) ? data.savedAt : now());
      }
    } catch {
      // not a save
    }
    return null;
  }

  /**
   * The list as the storage has it now: the index read again (another page may have saved
   * since), the entries whose slot is gone left out, the slots it does not list adopted with
   * the line they carry. Only a slot that cannot be read at all is cleared away.
   */
  function sync() {
    if (!storage) return;
    const stored = readIndex();
    let entries = stored ? stored.entries : [];
    let next = stored ? stored.next : 1;
    try {
      const ids = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(SLOT)) ids.push(k.slice(SLOT.length));
      }
      const present = new Set(ids);
      entries = entries.filter((e) => present.has(e.id));
      const listed = new Set(entries.map((e) => e.id));
      for (const id of ids) {
        if (listed.has(id)) continue;
        const entry = entryOfSlot(id);
        if (entry) entries.push(entry);
        else storage.removeItem(SLOT + id);
      }
    } catch {
      // a storage that closes half-way: what was read stays
    }
    // No number already used is given again, even after an index lost.
    for (const e of entries) {
      const m = /-(\d+)$/.exec(e.id);
      if (m) next = Math.max(next, Number(m[1]) + 1);
    }
    index = { next, entries };
  }

  function put(entry) {
    index.entries = index.entries.filter((e) => e.id !== entry.id);
    index.entries.push(entry);
  }

  const autos = () => index.entries.filter((e) => e.kind === 'auto');
  const newestFirst = (a, b) => b.savedAt - a.savedAt;

  /**
   * The automatic saves that have had their time, once `gameId` has just been saved: of that
   * game, those beyond the last five; of each other game, all but its newest; and the games
   * beyond the five saved last. (Saves without the mark of a game count as one game.)
   */
  function outdatedAutos(gameId) {
    const out = [];
    const mine = autos().filter((e) => e.gameId === gameId).sort(newestFirst);
    out.push(...mine.slice(AUTO_KEPT));
    const others = new Map();
    for (const e of autos().filter((x) => x.gameId !== gameId).sort(newestFirst)) {
      if (others.has(e.gameId)) out.push(e);
      else others.set(e.gameId, e);
    }
    out.push(...[...others.values()].slice(OTHER_GAMES_KEPT));
    return out;
  }

  /**
   * The automatic save that makes room when the storage is full: the oldest of the game being
   * saved while it has several, else the oldest of all.
   */
  function roomMaker(gameId) {
    const oldestFirst = (a, b) => a.savedAt - b.savedAt;
    const mine = autos().filter((e) => e.gameId === gameId).sort(oldestFirst);
    if (mine.length > 1) return mine[0];
    return autos().sort(oldestFirst)[0] || null;
  }

  const store = {
    get available() {
      return Boolean(storage);
    },

    /** Reads the list again from the storage (another page of the game may have saved). */
    refresh() {
      sync();
    },

    /** The saves, the newest first. */
    entries() {
      return [...index.entries].sort(newestFirst);
    },

    entry(id) {
      return index.entries.find((e) => e.id === id) || null;
    },

    /** The game being played when the page was last left, or null. */
    current() {
      return store.entry(CURRENT);
    },

    /** The game under way, written at once as plain text. { ok } or { ok: false, code: 'storage' }. */
    writeCurrent(save) {
      if (!storage) return { ok: false, code: 'storage' };
      try {
        const text = JSON.stringify(save);
        sync();
        storage.setItem(SLOT + CURRENT, text);
        put(describe(save, 'current', CURRENT, text.length, now()));
        return writeIndex() ? { ok: true, id: CURRENT } : { ok: false, code: 'storage' };
      } catch {
        return { ok: false, code: 'storage' };
      }
    },

    /**
     * A packed save: kind 'auto' or 'manual'. When the storage is full, one automatic save
     * makes room; if that is not enough it is put back, and the write says it failed: nothing
     * that was there is lost for a save that could not be made. { ok, id } or { ok: false, code }.
     */
    async add(kind, save) {
      if (!storage) return { ok: false, code: 'storage' };
      let packed;
      try {
        packed = await pack(JSON.stringify(save));
      } catch {
        return { ok: false, code: 'storage' };
      }
      const auto = kind === 'auto';
      let id;
      let entry;
      let text;
      try {
        sync();
        do id = `${auto ? 'auto' : 'man'}-${index.next++}`;
        while (storage.getItem(SLOT + id) !== null);
        entry = describe(save, auto ? 'auto' : 'manual', id, 0, now());
        text = JSON.stringify({ ...packed, entry });
        entry.chars = text.length;
      } catch {
        return { ok: false, code: 'storage' };
      }
      const tryWrite = () => {
        try {
          storage.setItem(SLOT + id, text);
          return true;
        } catch {
          return false;
        }
      };
      if (!tryWrite()) {
        const old = roomMaker(entry.gameId);
        let kept = null;
        try {
          kept = old ? storage.getItem(SLOT + old.id) : null;
        } catch {
          kept = null;
        }
        if (old) dropSlot(old.id);
        if (!old || !tryWrite()) {
          // Not enough: what made room goes back where it was.
          let back = false;
          if (old && kept !== null) {
            try {
              storage.setItem(SLOT + old.id, kept);
              back = true;
            } catch {
              back = false;
            }
          }
          if (old && !back) index.entries = index.entries.filter((e) => e.id !== old.id);
          writeIndex();
          return { ok: false, code: 'storage' };
        }
        index.entries = index.entries.filter((e) => e.id !== old.id);
      }
      put(entry);
      if (auto) {
        for (const old of outdatedAutos(entry.gameId)) {
          dropSlot(old.id);
          index.entries = index.entries.filter((e) => e.id !== old.id);
        }
      }
      if (!writeIndex()) {
        dropSlot(id);
        index.entries = index.entries.filter((e) => e.id !== id);
        return { ok: false, code: 'storage' };
      }
      return { ok: true, id };
    },

    /** The save itself, as it was written (to be checked and migrated by readSave). */
    async read(id) {
      let raw = null;
      try {
        raw = storage ? storage.getItem(SLOT + id) : null;
      } catch {
        raw = null;
      }
      if (raw === null) throw new SaveError('missing');
      try {
        const data = JSON.parse(raw);
        return data && data.enc ? JSON.parse(await unpack(data)) : data;
      } catch {
        throw new SaveError('damaged', 'unreadable');
      }
    },

    remove(id) {
      sync();
      dropSlot(id);
      index.entries = index.entries.filter((e) => e.id !== id);
      writeIndex();
    },

    /** Characters used by the saves, for the page that lists them. */
    used() {
      return index.entries.reduce((n, e) => n + (e.chars || 0), 0);
    },

    /**
     * A game left by version 2.8 or before (one slot and its journal) becomes the current
     * game of this version. Returns true when one was found.
     */
    adoptLegacy() {
      if (!storage) return false;
      let found = false;
      try {
        const raw = storage.getItem(LEGACY_GAME);
        if (raw && !store.current()) {
          const data = JSON.parse(raw);
          if (data && data.snap) {
            let journal = [];
            try {
              journal = JSON.parse(storage.getItem(LEGACY_JOURNAL) || '[]');
            } catch {
              journal = [];
            }
            const save = { game: 'jeu-1940', savedAt: data.savedAt || now(), snap: data.snap, meta: data.meta || null, journal: Array.isArray(journal) ? journal : [] };
            found = store.writeCurrent(save).ok;
          }
        }
        if (found || store.current()) {
          storage.removeItem(LEGACY_GAME);
          storage.removeItem(LEGACY_JOURNAL);
        }
      } catch {
        found = false;
      }
      return found;
    },
  };

  sync();
  return store;
}
