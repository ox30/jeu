// Game calendar. Game dates are handled as UTC timestamps that carry the local time of the
// scenario, so that no browser time zone ever shifts them.

/** "1940-07-10T13:05" → timestamp in ms. */
export function parseGameDate(text) {
  const [date, time = '00:00'] = text.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, 0);
}

/** Timestamp of the current game time. */
export function worldTimeMs(world) {
  return world.startMs + world.t * 1000;
}

const pad = (n) => String(n).padStart(2, '0');

export function formatTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatTimeSeconds(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** "mercredi 10 juillet 1940" with day and month names from the language file. */
export function formatDate(ms, days, months) {
  const d = new Date(ms);
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "10 juillet" */
export function formatShortDate(ms, months) {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/**
 * Colour of the sector clock for a time: the dial is split into 5-minute segments coloured
 * red, yellow, blue in turn. Returns 0 (red), 1 (yellow) or 2 (blue).
 */
export function clockColorIndex(ms) {
  return Math.floor(new Date(ms).getUTCMinutes() / 5) % 3;
}

/** Splits a duration in seconds into { days, hours, minutes } (rounded to the minute). */
export function splitDuration(seconds) {
  const total = Math.max(0, Math.round(seconds / 60));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}
