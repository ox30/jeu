// C5: a U-boat attacks at its own hour in the night, hardly ever by day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld } from './helpers.js';
import { step } from '../src/sim/world.js';
import { drainEvents } from '../src/sim/events.js';
import { isNight } from '../src/sim/daylight.js';
import { headingVector } from '../src/sim/geo.js';

/**
 * A winter game in which one U-boat (`boats` of them) is kept astern of a convoy with all its
 * torpedoes, for `days`: every attack with the hour of the clock, and day or night there.
 */
function attacksOver(seed, days, { boats = 1, straggler = false } = {}) {
  const w = makeWorld('standard', {}, 'hiver-atlantique');
  for (let i = 0; i < seed * 7; i++) w.rng.next(); // another draw of the dice for each trial
  const attacks = [];
  let c = null;
  const pack = [];
  for (let s = 0; s < days * 86400; s++) {
    step(w, 1);
    if (!c || c.state !== 'atSea' || c.ships < 20) {
      c = w.convoys.find((x) => x.state === 'atSea' && x.type !== 'coastal' && !x.straggler && x.ships >= 25);
      if (!c) continue;
    }
    if (pack.length < boats) {
      const free = w.uboats.find((u) => !pack.includes(u) && u.state !== 'sunk');
      if (free) pack.push(free);
    }
    if (w.t % 60 === 0) {
      c.straggler = straggler; // the same convoy, counted as a ship alone
      const [hx, hy] = headingVector(c.heading);
      for (const u of pack) {
        Object.assign(u, {
          state: 'shadow', target: c.id, x: c.x - hx * 14, y: c.y - hy * 14, px: c.x - hx * 14, py: c.y - hy * 14, torpedoes: 10, submergedUntil: 0, way: null,
        });
      }
      c.ships = Math.max(c.ships, 25); // the convoy lasts the whole trial
      // The other boats stay at their base: the attacks counted are the pack's.
      for (const u of w.uboats) if (!pack.includes(u)) Object.assign(u, { state: 'gone', goneAt: w.t, target: null });
    }
    for (const e of drainEvents(w)) {
      if (e.type !== 'uboatAttack' || e.convoyId !== c.id) continue;
      const clock = new Date(w.startMs + w.t * 1000);
      attacks.push({ t: w.t, hour: clock.getUTCHours(), minute: clock.getUTCMinutes(), night: isNight(w, c.x, c.y) });
    }
  }
  return attacks;
}

test('U-boat attacks come at any hour of the night, not on the stroke of fixed hours', () => {
  const attacks = attacksOver(1, 25);
  const night = attacks.filter((a) => a.night);
  assert.ok(night.length >= 40, `${night.length} night attacks in 25 days`);
  const hours = new Set(night.map((a) => a.hour));
  assert.ok(hours.size >= 10, `attacks in ${hours.size} different hours of the clock`);
  // Before, every attack fell on the minute night began or an exact four hours later.
  const minutes = new Set(night.map((a) => a.minute));
  assert.ok(minutes.size >= 20, `${minutes.size} different minutes`);
  // The same boat never attacks twice within four hours.
  for (let i = 1; i < attacks.length; i++) assert.ok(attacks[i].t - attacks[i - 1].t >= 4 * 3600, 'four hours between two attacks');
});

test('two boats of a pack do not attack at the same minute', () => {
  const attacks = attacksOver(2, 12, { boats: 2 });
  assert.ok(attacks.length >= 30);
  const sameMinute = attacks.filter((a, i) => i > 0 && a.t === attacks[i - 1].t).length;
  assert.ok(sameMinute <= 1, `${sameMinute} attacks at the very minute of another`);
});

test('by day a convoy is hardly ever attacked; a ship alone is, now and then', () => {
  const convoy = attacksOver(3, 40);
  const day = convoy.filter((a) => !a.night).length;
  assert.ok(day <= convoy.length * 0.08, `${day} day attacks out of ${convoy.length} on a convoy`);
  const alone = attacksOver(3, 40, { straggler: true });
  const dayAlone = alone.filter((a) => !a.night).length;
  assert.ok(dayAlone >= 8 && dayAlone > day * 3, `${dayAlone} day attacks on a ship alone, ${day} on a convoy`);
  assert.ok(dayAlone < alone.length * 0.5, 'the night stays the hour of the U-boats');
});
