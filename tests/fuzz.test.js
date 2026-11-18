// Random orders: every order the interface can give, given at random all through each
// scenario, with saves and restores. Nothing may throw, no position may become NaN, no stock
// may go negative, and a restored game must be the saved one.
// Here, 2 000 orders per scenario spread over its whole length (FUZZ_ORDERS changes that);
// `npm run fuzz` gives 10 000 per scenario, the criterion of the M2.7 gate, and runs at every
// push with the other checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMonkey } from '../tools/bot/monkey.mjs';
import { SCENARIOS } from '../tools/bot/game.mjs';

const ORDERS = Number(process.env.FUZZ_ORDERS || 2000);

for (const scenario of SCENARIOS) {
  test(`${ORDERS} random orders in ${scenario}: no crash, no impossible state`, () => {
    const r = runMonkey({ scenario, preset: scenario === 'hiver-atlantique' ? 'realistic' : 'standard', seed: 1, orders: ORDERS });
    assert.deepEqual(r.problems, []);
    assert.equal(r.orders, ORDERS, 'all the orders were given');
    assert.ok(r.restores > 0, 'the game was saved and restored on the way');
  });
}
