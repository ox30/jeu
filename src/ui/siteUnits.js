// The units standing in an installation (asked after play-testing 2.10: « le port et les
// étiquettes d'unités »). An aerodrome holds its squadrons on the ground; a port, the escort
// groups lying there and the convoys at its quays. The sheet of such an installation, and of
// any unit standing in it, carries the tabs of the stacks (stacks.js): one for the
// installation, then one a unit. Kept free of the page: the panel and the tests read it.

import { formationById, formationOf, membersOf } from '../sim/formations.js';
import { isFlying } from '../sim/squadron.js';

/** The kinds of installation that hold units. */
export const HOLDING = ['airfield', 'port'];

const IN_PORT = new Set(['inPort', 'refit']);

/** The key of the installation a unit stands in ("airfield:<id>", "port:<id>"), or null. */
export function siteKeyOf(world, u) {
  if (!u) return null;
  // On the ground, the crews called to their aircraft included: not in the air yet.
  if (u.kind === 'squadron') return !isFlying(u) && u.state !== 'lost' && u.airfield ? `airfield:${u.airfield}` : null;
  // At its quay or refitting; and still alongside while it raises steam (an hour to cast off).
  if (u.kind === 'escort') return u.portId && (IN_PORT.has(u.state) || (u.underwayAt && world.t < u.underwayAt)) ? `port:${u.portId}` : null;
  // A convoy waiting for the order to sail, or unloading at the quays.
  if (u.kind === 'convoy') return u.portId && (u.state === 'inPort' || (u.state === 'arrived' && u.unloading)) ? `port:${u.portId}` : null;
  return null;
}

/** The installation of this key when it holds units and has a sheet (a foreign port has none). */
function holdingSite(world, key) {
  const site = key ? world.sites.get(key) : null;
  return site && HOLDING.includes(site.kind) && !site.foreign ? site : null;
}

/**
 * The units standing in an installation, in the order of the scenario: [{ kind, id, label,
 * formation }], shaped like the members of a stack. The escort groups of one support group
 * are one unit (its name, `formation`: its id): a click on any of them selects the group.
 * Squadrons stay one tab each, in a wing or not: a wing gathers from several aerodromes.
 */
export function unitsIn(world, site) {
  if (!site || !HOLDING.includes(site.kind)) return [];
  if (site.kind === 'airfield') {
    return world.squadrons.filter((s) => siteKeyOf(world, s) === site.key).map((s) => ({ kind: 'squadron', id: s.id, label: s.name, formation: null }));
  }
  const units = [];
  const groups = new Set();
  for (const e of world.escorts) {
    if (siteKeyOf(world, e) !== site.key) continue;
    const f = formationOf(world, e);
    if (!f) units.push({ kind: 'escort', id: e.id, label: e.short || e.name, formation: null });
    else if (!groups.has(f.id)) {
      groups.add(f.id);
      units.push({ kind: 'escort', id: e.id, label: f.name, formation: f.id });
    }
  }
  for (const c of world.convoys) if (siteKeyOf(world, c) === site.key) units.push({ kind: 'convoy', id: c.id, label: c.name, formation: null });
  return units;
}

function unitOfSelection(world, sel) {
  if (sel.kind === 'squadron') return world.squadrons.find((x) => x.id === sel.id) || null;
  if (sel.kind === 'escort') return world.escorts.find((x) => x.id === sel.id) || null;
  if (sel.kind === 'convoy') return world.convoys.find((x) => x.id === sel.id) || null;
  return null;
}

/** The installation the selection is, or stands in; null when it is elsewhere. */
export function siteOfSelection(world, sel) {
  if (!sel) return null;
  if (sel.kind === 'site') return holdingSite(world, sel.id);
  if (sel.kind === 'formation') {
    // A support group lying in a port (its first group found there); a wing has no one place.
    const f = formationById(world, sel.id);
    const inPort = f && f.kind === 'naval' ? membersOf(world, f).find((m) => siteKeyOf(world, m)) : null;
    return inPort ? holdingSite(world, siteKeyOf(world, inPort)) : null;
  }
  return holdingSite(world, siteKeyOf(world, unitOfSelection(world, sel)));
}

/** What a tab selects: the installation, the support group of an escort group, or the unit. */
export function tabSelection(tab) {
  if (tab.site) return { kind: 'site', id: tab.id };
  return tab.formation ? { kind: 'formation', id: tab.formation } : { kind: tab.kind, id: tab.id };
}

function isActive(world, tab, sel) {
  const to = tabSelection(tab);
  if (to.kind === sel.kind && to.id === sel.id) return true;
  // An escort group in hand whose support group has the tab.
  const u = tab.formation ? unitOfSelection(world, sel) : null;
  return Boolean(u && u.formation === tab.formation);
}

/**
 * The tabs of the sheet when the selection is an installation that holds units, or a unit
 * standing in one: { site, tabs: [{ kind, id, label, formation, site, active }] }, the
 * installation first. Null when there is nothing to choose between (an empty aerodrome, a
 * unit in the air or at sea). `stack`: the stack of the selection on the map, if any; its
 * units that stand elsewhere (a convoy passing off the port) keep their tab after the others.
 */
export function siteTabs(world, sel, stack = null) {
  const site = siteOfSelection(world, sel);
  if (!site) return null;
  const units = unitsIn(world, site);
  if (!units.length) return null;
  const tabs = [{ kind: 'site', id: site.key, label: site.name, formation: null, site: true }, ...units.map((u) => ({ ...u, site: false }))];
  const key = (x) => (x.formation ? `formation:${x.formation}` : `${x.kind}:${x.id}`);
  const listed = new Set(tabs.map(key));
  for (const m of stack ? stack.members : []) {
    if (listed.has(key(m))) continue;
    listed.add(key(m));
    tabs.push({ kind: m.kind, id: m.id, label: m.label, formation: m.formation || null, site: false });
  }
  for (const tab of tabs) tab.active = isActive(world, tab, sel);
  return { site, tabs };
}
