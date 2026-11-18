// The saved games kept in the browser. Three kinds:
//   - current: the game being played, written every few minutes and when the page is left
//     (at once, as plain text: it must be safe before the page goes);
//   - auto: a point to come back to, one a game day (every two game hours in a battle of
//     one day), the last five kept;
//   - manual: what the player saves from the menu, kept until he deletes it.
// Automatic and manual saves are packed (pack.js). An index lists them with what the menu
// shows (scenario, game date, time played) so that none has to be opened to be listed.
// The storage may be closed or full: every write says whether it worked.

import { pack, unpack } from './pack.js';
import { SaveError } from './migrate.js';

const INDEX_KEY = 'jeu-1940.saves.v2';
const SLOT = 'jeu-1940.save.v2.';
const LEGACY_GAME = 'jeu-1940.game.v1';
const LEGACY_JOURNAL = 'jeu-1940.journal.v1';
export const CURRENT = 'current';
export const AUTO_KEPT = 5;

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** What the menu shows of a save, taken from the save itself. */
function describe(save, kind, id, chars, savedAt) {
  const meta = save.meta || {};
  return {
    id,
    kind,
    gameId: meta.gameId || null,
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

export function createStore({ storage = defaultStorage(), now = () => Date.now() } = {}) {
  let index = { next: 1, entries: [] };

  function loadIndex() {
    try {
      const raw = storage ? storage.getItem(INDEX_KEY) : null;
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.entries) && Number.isInteger(data.next)) {
        index = { next: data.next, entries: data.entries.filter((e) => e && typeof e.id === 'string' && typeof e.scenario === 'string') };
      }
    } catch {
      index = { next: 1, entries: [] };
    }
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

  /** Slots the index does not know (an index lost, a write cut short) are cleared away. */
  function sweep() {
    try {
      const known = new Set(index.entries.map((e) => SLOT + e.id));
      const stray = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(SLOT) && !known.has(k)) stray.push(k);
      }
      for (const k of stray) storage.removeItem(k);
      // And entries whose slot is gone.
      index.entries = index.entries.filter((e) => storage.getItem(SLOT + e.id) !== null);
    } catch {
      // ignore
    }
  }

  function put(entry) {
    index.entries = index.entries.filter((e) => e.id !== entry.id);
    index.entries.push(entry);
  }

  function oldestAuto(except = null) {
    return index.entries.filter((e) => e.kind === 'auto' && e.id !== except).sort((a, b) => a.savedAt - b.savedAt)[0] || null;
  }

  const store = {
    get available() {
      return Boolean(storage);
    },

    /** The saves, the newest first. */
    entries() {
      return [...index.entries].sort((a, b) => b.savedAt - a.savedAt);
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
        storage.setItem(SLOT + CURRENT, text);
        put(describe(save, 'current', CURRENT, text.length, now()));
        return writeIndex() ? { ok: true, id: CURRENT } : { ok: false, code: 'storage' };
      } catch {
        return { ok: false, code: 'storage' };
      }
    },

    /**
     * A packed save: kind 'auto' (the last five are kept) or 'manual'. When the storage is
     * full, the oldest automatic save makes room once. { ok, id } or { ok: false, code }.
     */
    async add(kind, save) {
      if (!storage) return { ok: false, code: 'storage' };
      let text;
      try {
        text = JSON.stringify(await pack(JSON.stringify(save)));
      } catch {
        return { ok: false, code: 'storage' };
      }
      const id = `${kind === 'auto' ? 'auto' : 'man'}-${index.next++}`;
      const tryWrite = () => {
        try {
          storage.setItem(SLOT + id, text);
          return true;
        } catch {
          return false;
        }
      };
      if (!tryWrite()) {
        const old = oldestAuto();
        if (old) store.remove(old.id);
        if (!old || !tryWrite()) {
          writeIndex();
          return { ok: false, code: 'storage' };
        }
      }
      put(describe(save, kind === 'auto' ? 'auto' : 'manual', id, text.length, now()));
      if (kind === 'auto') {
        while (index.entries.filter((e) => e.kind === 'auto').length > AUTO_KEPT) {
          const old = oldestAuto(id);
          if (!old) break;
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

  if (storage) {
    loadIndex();
    sweep();
  }
  return store;
}
