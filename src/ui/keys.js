// Keys read by their place on the keyboard, not by the character they type: on an AZERTY
// keyboard the row of digits types « & é " ' ( - » without Shift, and the speed keys must
// stay where the legend shows them. The numeric keypad works too.

/**
 * The speed asked by a key press: 0 for the first speed (key 1) and so on, or -1.
 * `count` is the number of speeds. With Ctrl, Alt or Meta the key belongs to the browser.
 */
export function speedIndexOfKey(e, count) {
  if (e.ctrlKey || e.altKey || e.metaKey) return -1;
  const typed = /^[1-9]$/.test(e.key || '') ? Number(e.key) : 0;
  const row = /^Digit([1-9])$/.exec(e.code || '');
  const pad = /^Numpad([1-9])$/.exec(e.code || '');
  // The row of digits by its place, whatever it types. The keypad only while it types digits:
  // with Num Lock off its keys are the arrows, and stay the arrows. Without a place (a
  // virtual keyboard): the character itself.
  const digit = row ? Number(row[1]) : pad ? (typed === Number(pad[1]) ? typed : 0) : typed;
  return digit >= 1 && digit <= count ? digit - 1 : -1;
}
