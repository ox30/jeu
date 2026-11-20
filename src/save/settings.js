// Player settings, kept in the browser's local storage. Storage may be unavailable
// (private mode, sandboxed page): the game then simply keeps the defaults.

const KEY = 'jeu-1940.settings.v1';
const HELP_KEY = 'jeu-1940.help-seen.v1';

export function defaultSettings(presets) {
  return { preset: presets.default, ...presets.presets[presets.default], ...presets.options };
}

export function loadSettings(presets) {
  const base = defaultSettings(presets);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      // A setting added since (the B-Dienst share, say) takes the value of the player's preset.
      const own = presets.presets[saved.preset];
      const added = own ? Object.fromEntries(Object.entries(own).filter(([k]) => !(k in saved))) : {};
      const settings = { ...base, ...added, ...saved };
      // 2.11.0: the help of the sheets stands behind its « ? » by default. Until then it was
      // shown, and the settings saved did not say whether the player had chosen so: without
      // the mark of a choice (written since, by the settings page) the new default applies.
      if (!saved.sheetHelpChosen) settings.sheetHelp = base.sheetHelp;
      return settings;
    }
  } catch {
    // ignore unreadable storage
  }
  return base;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

/** Name of the preset matching the game settings, or 'custom'. */
export function matchingPreset(settings, presets) {
  for (const [name, values] of Object.entries(presets.presets)) {
    if (Object.entries(values).every(([k, v]) => settings[k] === v)) return name;
  }
  return 'custom';
}

export function helpSeen() {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHelpSeen() {
  try {
    localStorage.setItem(HELP_KEY, '1');
  } catch {
    // ignore
  }
}
