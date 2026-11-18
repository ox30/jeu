// Random orders: every order the interface can give, given at random all through each
// scenario, with saves and restores. Nothing may throw, no position may become NaN, no stock
// may go negative, and a restored game must be the saved one.
// Here, 2 000 orders per scenario (FUZZ_ORDERS changes that), over its whole length except the
// Atlantic, played over its first 25 days to keep `npm test` short. `npm run fuzz` gives 10 000
// orders per scenario over the whole length of each: the criterion of the M2.7 gate, run at
// every push with the other checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMonkey } from '../tools/bot/monkey.mjs';
import { SCENARIOS } from '../tools/bot/game.mjs';

const ORDERS = Number(process.env.FUZZ_ORDERS || 2000);

for (const scenario of SCENARIOS) {
  test(`${ORDERS} random orders in ${scenario}: no crash, no impossible state`, () => {
    const sea = scenario === 'hiver-atlantique';
    const r = runMonkey({ scenario, preset: sea ? 'realistic' : 'standard', seed: 1, orders: ORDERS, days: sea ? 25 : null });
    assert.deepEqual(r.problems, []);
    assert.equal(r.orders, ORDERS, 'all the orders were given');
    assert.ok(r.restores > 0, 'the game was saved and restored on the way');
  });
}
