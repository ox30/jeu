// Keys read by their place on the keyboard, not by the character they type: on an AZERTY
// keyboard the row of digits types « & é " ' ( - » without Shift, and the speed keys must
// stay where the legend shows them. The numeric keypad works too.

/**
 * The speed asked by a key press: 0 for the first speed (key 1) and so on, or -1.
 * `count` is the number of speeds. With Ctrl, Alt or Meta the key belongs to the browser.
 */
export function speedIndexOfKey(e, count) {
  if (e.ctrlKey || e.altKey || e.metaKey) return -1;
  // « + » zooms the map, wherever the keyboard puts it: on a Swiss keyboard it is typed with
  // Shift on the key of the 1, and must not be taken for the first speed.
  if (e.key === '+') return -1;
  const typed = /^[1-9]$/.test(e.key || '') ? Number(e.key) : 0;
  const row = /^Digit([1-9])$/.exec(e.code || '');
  const pad = /^Numpad([1-9])$/.exec(e.code || '');
  // The row of digits by its place, whatever it types. The keypad only while it types digits:
  // with Num Lock off its keys are the arrows, and stay the arrows. Without a place (a
  // virtual keyboard): the character itself.
  const digit = row ? Number(row[1]) : pad ? (typed === Number(pad[1]) ? typed : 0) : typed;
  return digit >= 1 && digit <= count ? digit - 1 : -1;
}

// ---- Space on a button that has the keyboard (2.11.1) ----

// How the focus moved last: by the keyboard (Tab), or by a pointer. The browser has its own
// idea of it (:focus-visible), but turns to « keyboard » at the first key pressed after a
// click: a speed clicked with the mouse, then Space, must still pause the game.
const focus = { byKeyboard: false };

/** Watches, on the window, how the focus moves. */
export function watchFocus(target) {
  target.addEventListener('keydown', (e) => {
    // (Tab with Ctrl, Alt or Meta changes the tab or the window, not the focus in the page.)
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) focus.byKeyboard = true;
  }, true);
  target.addEventListener('pointerdown', () => {
    focus.byKeyboard = false;
  }, true);
}

/**
 * Space is the pause key of the game; on a button that has the keyboard it presses the
 * button, as it does everywhere else. « Has the keyboard »: it has the focus, and the focus
 * last moved by the keyboard (Tab), not by a click. A button the mouse has just clicked keeps
 * the focus too, and there Space is still the pause. The bubble of a « ? » opened from the
 * keyboard takes the focus: Space is its own there too, and does nothing.
 */
export function spacePressesControl(target, byKeyboard = focus.byKeyboard) {
  if (!byKeyboard || !target || typeof target.matches !== 'function') return false;
  return target.matches('button, summary, .help-bubble') && !target.disabled;
}

/**
 * A key held down repeats: Space held is one pause, not one at every repeat (seen at the
 * review of 2.11.1: a second and a half held let half a minute of the game go by).
 */
export function isHeldSpace(e) {
  return e.key === ' ' && Boolean(e.repeat);
}
