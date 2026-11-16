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
    if (saved && typeof saved === 'object') return { ...base, ...saved };
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
