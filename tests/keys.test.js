// Speed keys by their place on the keyboard (C4 of the audit): AZERTY, QWERTZ, the keypad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedIndexOfKey } from '../src/ui/keys.js';

const press = (key, code, more = {}) => ({ key, code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...more });

test('the six speed keys answer on every keyboard layout', () => {
  // Swiss and English keyboards: the digit itself.
  assert.equal(speedIndexOfKey(press('1', 'Digit1'), 6), 0);
  assert.equal(speedIndexOfKey(press('6', 'Digit6'), 6), 5);
  // AZERTY: the same keys type other characters without Shift.
  const azerty = ['&', 'é', '"', "'", '(', '-'];
  azerty.forEach((char, i) => assert.equal(speedIndexOfKey(press(char, `Digit${i + 1}`), 6), i, `AZERTY ${char}`));
  // And with Shift they type the digit: same key, same speed.
  assert.equal(speedIndexOfKey(press('4', 'Digit4', { shiftKey: true }), 6), 3);
  // The numeric keypad.
  assert.equal(speedIndexOfKey(press('3', 'Numpad3'), 6), 2);
});

test('other keys are left alone', () => {
  assert.equal(speedIndexOfKey(press('7', 'Digit7'), 6), -1, 'no seventh speed');
  assert.equal(speedIndexOfKey(press('0', 'Digit0'), 6), -1);
  assert.equal(speedIndexOfKey(press('a', 'KeyQ'), 6), -1);
  assert.equal(speedIndexOfKey(press('1', 'Digit1', { ctrlKey: true }), 6), -1, 'Ctrl+1 belongs to the browser');
  assert.equal(speedIndexOfKey(press('2', 'Digit2', { metaKey: true }), 6), -1);
  // A keyboard that gives no place (some virtual keyboards): the character decides.
  assert.equal(speedIndexOfKey(press('5', ''), 6), 4);
  assert.equal(speedIndexOfKey(press('&', ''), 6), -1);
});
