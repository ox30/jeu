// Developer mode (a box in the settings, behind a password): shows what the enemy really
// does, to check the scenarios. It only reads the simulation: switching it on changes
// nothing in the game, and a game saved with it on replays the same.

import { formatNumber, t } from '../core/i18n.js';
import { FOOT_M } from '../sim/geo.js';
import { isSubmerged } from '../sim/asw.js';
import { dateTimeText } from './format.js';

const KEY = 'jeu-1940.dev.v1';

export function loadDev() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function saveDev(on) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}

/** The SHA-256 of a password, in hex; spaces around it and capitals do not count. */
export async function passwordHash(text) {
  const bytes = new TextEncoder().encode(String(text).trim().toLowerCase());
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the password opens developer mode (data/dev.json keeps its SHA-256, never the
 * password); null where the page cannot check it. A lock against switching it on by chance,
 * not a secret: the game's code can be read.
 */
export async function checkDevPassword(text, expected) {
  if (!globalThis.crypto || !globalThis.crypto.subtle || typeof TextEncoder === 'undefined') return null;
  if (!expected) return false;
  return (await passwordHash(text)) === String(expected).toLowerCase();
}

/** Raids the player could meet in this game (false alarms only when they are switched on). */
export function devRaids(world) {
  return world.raids.filter((r) => !r.phantom || world.settings.falseAlarms);
}

export function isRaidActive(r) {
  return r.phase === 'assembling' || r.phase === 'inbound' || r.phase === 'bombing' || r.phase === 'outbound';
}

export function raidTargetName(world, r) {
  if (!r.target) return t('dev.nowhere');
  const site = world.sites.get(r.target);
  if (site) return site.name;
  const [kind, id] = String(r.target).split(':');
  if (kind === 'convoy') {
    const c = world.convoys.find((u) => u.id === id);
    if (c) return c.name;
  }
  return r.target;
}

export function raidPhaseText(r) {
  if (r.phantom) return t('dev.phantom');
  if (r.destroyed) return t('dev.phase.destroyed');
  if (r.repelled && r.phase === 'outbound') return t('dev.phase.repelled');
  return t(`dev.phase.${r.phase}`);
}

/** "18 Do 17 + 30 Bf 109", or the plain count of a false echo. */
export function raidForce(r) {
  if (r.phantom) return t('dev.aircraft', { n: r.bombers });
  const parts = [];
  if (r.bombers > 0) parts.push(`${r.bombers} ${r.bomberType}`);
  if (r.escort > 0) parts.push(`${r.escort} ${r.escortType}`);
  return parts.join(' + ') || '0';
}

export function raidLine(world, r) {
  const alt = `${formatNumber(Math.round(r.alt / FOOT_M / 500) * 500)} ft`;
  return `${r.label} · ${raidForce(r)} · ${alt} · ${raidPhaseText(r)} → ${raidTargetName(world, r)}`;
}

export function uboatStateText(world, u) {
  const target = u.target ? world.convoys.find((c) => c.id === u.target) : null;
  return t(`dev.uboat.${u.state}`, { convoy: target ? target.name : '?' });
}

/** A U-boat in one line; `short` for the map (torpedoes as "4 t", depth only when under water). */
export function uboatLine(world, u, short = false) {
  const parts = [u.id.toUpperCase(), uboatStateText(world, u)];
  if (u.state !== 'gone' && u.state !== 'sunk') {
    const under = isSubmerged(world, u);
    parts.push(t(short ? 'dev.torpedoesShort' : 'dev.torpedoes', { n: u.torpedoes }));
    if (!short || under) parts.push(t(under ? 'dev.submerged' : 'dev.surfaced'));
  }
  return parts.join(' · ');
}

/** When a U-boat at its base sails again (long scenarios only), or null. */
export function uboatReturnText(world, u) {
  if (u.state !== 'gone' || !world.scenario.uboatRotation || u.goneAt === null) return null;
  const at = u.goneAt + world.rules.uboats.refitDays * 86400;
  return dateTimeText(world.startMs + at * 1000);
}
