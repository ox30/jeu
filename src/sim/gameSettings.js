// The settings of a game: the ones that change its rules (how raids are seen, fuel, fatigue,
// what the B-Dienst reads, the watches of the sea…). They are copied into the world when it is
// created, saved with it, and changed only by an order — so that the same seed and the same
// orders give the same game, whatever the player's own settings are at the time. The rest
// (sound, the look of the map, where the sheet stands) is display and stays with the player.

import { emit } from './events.js';
import { flushSignals } from './comms.js';

/** What belongs to the game, in the order of the settings page. */
export const GAME_SETTING_KEYS = [
  'detection', 'falseAlarms', 'pagesPause', 'interceptAid', 'fuel', 'orders', 'logistics', 'fatigue', 'carry', 'bdienst',
  'seaComms', 'watchStops', 'questions', 'rallyAid',
];

// Fixed when the game begins: what the campaign carried over cannot be undone half-way.
const FIXED = new Set(['carry']);

/**
 * The game's own copy of the settings it is created with ({ preset, …the keys above }). With
 * the table of the presets, the game is named as it will be all along: by the preset whose
 * values it has, what is fixed when it begins left aside (a player on Standard who carries
 * nothing over in the campaign begins a Standard game, not a « custom » one that an order
 * would then rename Standard).
 */
export function copyGameSettings(settings = {}, presets = null) {
  const out = { preset: settings.preset ?? 'custom' };
  for (const k of GAME_SETTING_KEYS) if (settings[k] !== undefined) out[k] = settings[k];
  if (presets && presets.presets) out.preset = matchingPreset(out, presets, FIXED);
  return out;
}

/**
 * Name of the preset whose values the settings all have, or 'custom'. `ignore`: keys left out
 * of the comparison (for a game under way, what was fixed when it began).
 */
export function matchingPreset(settings, presets, ignore = null) {
  if (!presets || !presets.presets) return 'custom';
  for (const [name, values] of Object.entries(presets.presets)) {
    if (Object.entries(values).every(([k, v]) => (ignore && ignore.has(k)) || settings[k] === v)) return name;
  }
  return 'custom';
}

/** May this setting be changed during the game, to this value? (`presets.choices` lists the values.) */
export function canSetGameSetting(world, key, value, presets = null) {
  if (!GAME_SETTING_KEYS.includes(key) || FIXED.has(key)) return false;
  const choices = presets && presets.choices ? presets.choices[key] : null;
  if (choices) return choices.includes(value);
  return ['boolean', 'string'].includes(typeof value);
}

/** What a change of setting has to put right in the world at once. */
function settle(world, key) {
  if (key !== 'seaComms') return;
  // Direct again: the orders waiting for the next relief are passed at once, and the ships are
  // followed where they are. (Back under silence, each ship at sea gets its sure point within
  // the minute, as at the start of a game.)
  if (world.settings.seaComms !== 'silence') {
    flushSignals(world);
    for (const u of [...world.convoys, ...world.escorts]) u.est = null;
  }
}

/**
 * Order: one setting of the game takes another value. The journal keeps it. Returns false
 * when nothing changes (unknown setting, value not allowed, or the same value).
 */
export function setGameSetting(world, key, value, presets = null) {
  if (!canSetGameSetting(world, key, value, presets)) return false;
  if (world.settings[key] === value) return false;
  const from = world.settings[key];
  world.settings[key] = value;
  world.settings.preset = matchingPreset(world.settings, presets, FIXED);
  settle(world, key);
  emit(world, 'settingChanged', { key, from: from ?? null, value, preset: world.settings.preset });
  return true;
}

/**
 * Order: the game goes on with another preset (all its values at once). The game remembers
 * the preset it began with: the end of the game and the campaign say « commencée en
 * Réaliste, terminée en Standard ».
 */
export function applyPreset(world, name, presets) {
  const values = presets && presets.presets ? presets.presets[name] : null;
  if (!values) return false;
  const from = world.settings.preset;
  let changed = false;
  for (const [k, v] of Object.entries(values)) {
    if (FIXED.has(k) || !GAME_SETTING_KEYS.includes(k) || world.settings[k] === v) continue;
    world.settings[k] = v;
    settle(world, k);
    changed = true;
  }
  world.settings.preset = matchingPreset(world.settings, presets, FIXED);
  if (!changed && from === world.settings.preset) return false;
  emit(world, 'presetChanged', { from, to: world.settings.preset });
  return true;
}

/** { start, end, changed }: the preset the game began with and the one it has now. */
export function presetStory(world) {
  const start = world.presetStart ?? world.settings.preset ?? 'custom';
  const end = world.settings.preset ?? 'custom';
  return { start, end, changed: start !== end };
}
