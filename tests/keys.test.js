// Speed keys by their place on the keyboard (C4 of the audit): AZERTY, QWERTZ, the keypad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHeldSpace, spacePressesControl, speedIndexOfKey, watchFocus } from '../src/ui/keys.js';

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
  // « + » zooms the map (2.11.0: the help says so). On a Swiss keyboard it is Shift and the
  // key of the 1: not the first speed.
  assert.equal(speedIndexOfKey(press('+', 'Digit1', { shiftKey: true }), 6), -1, 'Swiss « + »');
  assert.equal(speedIndexOfKey(press('+', 'Equal', { shiftKey: true }), 6), -1);
  assert.equal(speedIndexOfKey(press('+', 'NumpadAdd'), 6), -1);
  // The keypad with Num Lock off types arrows and keeps them: ↓ lowers the altitude asked.
  assert.equal(speedIndexOfKey(press('ArrowDown', 'Numpad2'), 6), -1);
  assert.equal(speedIndexOfKey(press('ArrowRight', 'Numpad6'), 6), -1);
  assert.equal(speedIndexOfKey(press('End', 'Numpad1'), 6), -1);
  assert.equal(speedIndexOfKey(press('Clear', 'Numpad5'), 6), -1);
  // A keyboard that gives no place (some virtual keyboards): the character decides.
  assert.equal(speedIndexOfKey(press('5', ''), 6), 4);
  assert.equal(speedIndexOfKey(press('&', ''), 6), -1);
});

// ---- 2.11.1: Space on a button that has the keyboard presses the button ----

/** An element as the key handler reads it. */
function element(tag, { disabled = false, cls = '' } = {}) {
  const is = { button: tag === 'BUTTON', summary: tag === 'SUMMARY', '.help-bubble': cls === 'help-bubble' };
  return { tagName: tag, disabled, matches: (selector) => selector.split(',').some((part) => is[part.trim()]) };
}

/** A window, as far as the focus is watched on it. */
function fakeWindow() {
  const listeners = {};
  return {
    addEventListener(type, fn, capture) {
      assert.equal(capture, true, 'seen before anything stops the event');
      listeners[type] = fn;
    },
    fire: (type, e = {}) => listeners[type](e),
  };
}

test('Space on a button reached with the keyboard is the button\'s, not the pause', () => {
  assert.equal(spacePressesControl(element('BUTTON'), true), true, 'any button: « Compris », « Décoller », a « ? »');
  assert.equal(spacePressesControl(element('SUMMARY'), true), true, 'the title of a folded section');
  // (Review of 2.11.1.) The bubble a « ? » opened takes the focus: a second Space is not the pause.
  assert.equal(spacePressesControl(element('DIV', { cls: 'help-bubble' }), true), true, 'the bubble opened from the keyboard');
  assert.equal(spacePressesControl(element('DIV', { cls: 'help-bubble' }), false), false, 'opened with the mouse: the pause');
  assert.equal(spacePressesControl(element('DIV'), true), false, 'any other block');
});

test('Space stays the pause everywhere else', () => {
  assert.equal(spacePressesControl(element('BUTTON'), false), false, 'a button the mouse has just clicked');
  assert.equal(spacePressesControl(element('BUTTON', { disabled: true }), true), false);
  assert.equal(spacePressesControl(element('BODY'), true), false, 'nothing has the keyboard');
  assert.equal(spacePressesControl(element('CANVAS'), true), false, 'the map');
  assert.equal(spacePressesControl(element('A'), true), false, 'Space does not follow a link');
  assert.equal(spacePressesControl(null, true), false);
  assert.equal(spacePressesControl({}, true), false, 'the window itself');
});

test('the focus is the keyboard\'s after Tab, the pointer\'s after a click', () => {
  const win = fakeWindow();
  const button = element('BUTTON');
  assert.equal(spacePressesControl(button), false, 'before any key: a page just opened');
  watchFocus(win);
  win.fire('keydown', { key: ' ' });
  assert.equal(spacePressesControl(button), false, 'a key that does not move the focus says nothing');
  win.fire('keydown', { key: 'Tab' });
  assert.equal(spacePressesControl(button), true);
  win.fire('keydown', { key: ' ' });
  assert.equal(spacePressesControl(button), true, 'pressed twice, it is still the button\'s');
  win.fire('pointerdown');
  assert.equal(spacePressesControl(button), false, '« ×3 » clicked, then Space: the pause');
  win.fire('keydown', { key: 'Tab' });
  assert.equal(spacePressesControl(button), true);
  // (Review of 2.11.1.) Tab with Ctrl, Alt or Meta belongs to the browser or the system.
  win.fire('pointerdown');
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) {
    win.fire('keydown', { key: 'Tab', [mod]: true });
    assert.equal(spacePressesControl(button), false, mod);
  }
  win.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(spacePressesControl(button), true, 'Shift + Tab goes backwards: the keyboard still');
  win.fire('pointerdown');
});

test('Space held down is one pause, not one at every repeat', () => {
  assert.equal(isHeldSpace({ key: ' ', repeat: false }), false, 'pressed: the pause');
  assert.equal(isHeldSpace({ key: ' ', repeat: true }), true, 'held: nothing more');
  assert.equal(isHeldSpace({ key: ' ' }), false);
  assert.equal(isHeldSpace({ key: 'ArrowUp', repeat: true }), false, 'the other keys repeat as before (the altitude)');
});
