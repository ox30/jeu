// Seeded pseudo-random generator (mulberry32): the same seed replays the same game.

export function createRandom(seed = 1) {
  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    gauss() {
      let u = 0;
      while (u === 0) u = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    binomial(n, p) {
      let k = 0;
      for (let i = 0; i < n; i++) if (next() < p) k++;
      return k;
    },
    get state() {
      return state;
    },
  };
}
