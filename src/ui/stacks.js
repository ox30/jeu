// Units whose marks overlap on the map (C9 of the audit). Squadrons flying together, the
// groups lying in one port, a convoy and the group that sails with it: where their marks
// stand on one another they become one mark with their number, and a click on it opens the
// sheet with one tab a unit. Kept free of the page: the scene, the pointer and the tests read it.

/** Marks nearer than this, in screen pixels, are one stack. */
export const STACK_PX = 24;

export function stackKey(kind, id) {
  return `${kind}:${id}`;
}

/** The unit a mark belongs to: its formation when it has one (a big wing is one unit), else itself. */
function unitOf(m) {
  return m.formation ? `formation:${m.formation}` : stackKey(m.kind, m.id);
}

/**
 * The stacks among the marks drawn: [{ family, x, y, members: [{ kind, id, label, x, y }], marks }].
 * `marks`: [{ family: 'air' | 'sea', kind, id, x, y, label, formation, leads, detail }], one
 * a mark (`detail`: what the unit's own plaque says and how its mark is drawn, for the
 * stack). The marks of one formation are one unit (`formation`: its id; `leads`: the mark of
 * its leader, which stands for it — a wing that gathers has a mark a squadron until they
 * fly in station). Marks of one family within `radius` of one another, directly or through a
 * neighbour, make a stack when they are two units or more: `members` has one entry a unit,
 * `marks` every mark the stack stands for ([{ key, unit }]).
 */
export function findStacks(marks, radius = STACK_PX) {
  // One mark a squadron, a group or a convoy: the first seen stands for it.
  const seen = new Set();
  const items = [];
  for (const m of marks) {
    const key = stackKey(m.kind, m.id);
    if (seen.has(key) || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    seen.add(key);
    items.push({ ...m, key, unit: unitOf(m) });
  }
  const group = items.map((_, i) => i);
  const root = (i) => {
    while (group[i] !== i) {
      group[i] = group[group[i]];
      i = group[i];
    }
    return i;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].family !== items[j].family) continue;
      if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) <= radius) group[root(j)] = root(i);
    }
  }
  const byRoot = new Map();
  items.forEach((item, i) => {
    const r = root(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(item);
  });
  const stacks = [];
  for (const group of byRoot.values()) {
    // One member a unit: the squadrons of a wing that gathers count for one, and its leader
    // stands for it. (Alone, they are no stack: a wing is not a pile of itself.)
    const units = new Map();
    for (const item of group) {
      const had = units.get(item.unit);
      if (!had || (item.leads && !had.leads)) units.set(item.unit, item);
    }
    if (units.size < 2) continue;
    const members = [...units.values()];
    stacks.push({
      family: members[0].family,
      x: members.reduce((n, m) => n + m.x, 0) / members.length,
      y: members.reduce((n, m) => n + m.y, 0) / members.length,
      members: members.map(({ kind, id, label, x, y, formation, detail }) => ({ kind, id, label, x, y, formation: formation || null, detail: detail || null })),
      marks: group.map(({ key, unit }) => ({ key, unit })),
    });
  }
  return stacks;
}

/** Every mark of a stack: [{ key, unit }] (a stack written by hand has one mark a member). */
function marksOf(stack) {
  return stack.marks || stack.members.map((m) => ({ key: stackKey(m.kind, m.id), unit: unitOf(m) }));
}

/** Each stacked mark to its stack: Map of "kind:id" → stack. */
export function indexStacks(stacks) {
  const map = new Map();
  for (const s of stacks) for (const m of marksOf(s)) map.set(m.key, s);
  return map;
}

/**
 * The member of the stack that is in hand, or null: the unit itself, the formation it leads,
 * or the formation of the squadron in hand (one member stands for the whole wing).
 */
export function activeMember(stack, selection) {
  if (!stack || !selection) return null;
  const direct = stack.members.find((m) => (m.kind === selection.kind && m.id === selection.id)
    || (selection.kind === 'formation' && m.formation === selection.id));
  if (direct) return direct;
  const mark = marksOf(stack).find((k) => k.key === stackKey(selection.kind, selection.id));
  return mark ? stack.members.find((m) => unitOf(m) === mark.unit) || null : null;
}

/** What selecting a member of a stack selects: its formation when it leads one, else itself. */
export function memberSelection(m) {
  return m.formation ? { kind: 'formation', id: m.formation } : { kind: m.kind, id: m.id };
}

/**
 * How a unit of a stack is drawn: 'active' (it is the one in hand: drawn as usual, in front),
 * 'faded' (another unit of its stack is in hand), 'hidden' (none is: the stack's own mark
 * stands for all), or null when the unit is in no stack.
 */
export function stackRole(stackOf, selection, kind, id) {
  const stack = stackOf ? stackOf.get(stackKey(kind, id)) : null;
  if (!stack) return null;
  const active = activeMember(stack, selection);
  if (!active) return 'hidden';
  if (active.kind === kind && active.id === id) return 'active';
  // Another mark of the unit in hand (a squadron of the wing that gathers): drawn with it.
  const mark = marksOf(stack).find((k) => k.key === stackKey(kind, id));
  return mark && mark.unit === unitOf(active) ? 'active' : 'faded';
}

/** The stack of what is in hand, or null. */
export function stackOfSelection(stackOf, selection) {
  if (!stackOf || !selection) return null;
  if (selection.kind !== 'formation') return stackOf.get(stackKey(selection.kind, selection.id)) || null;
  for (const stack of stackOf.values()) if (activeMember(stack, selection)) return stack;
  return null;
}

/**
 * The convoy a stack of ships is about: its only convoy, when every other unit is an escort
 * group. Such a stack keeps the convoy's own mark and plaque (its ships, its speed), with the
 * number and the names of the groups: a convoy with its escort is the commonest sight of
 * the sea, and it must not lose what it tells. Null for any other stack.
 */
export function stackConvoy(stack) {
  if (!stack || stack.family !== 'sea') return null;
  const convoys = stack.members.filter((m) => m.kind === 'convoy');
  return convoys.length === 1 && stack.members.every((m) => m.kind === 'convoy' || m.kind === 'escort') ? convoys[0] : null;
}

/** What a click on a stack selects: the unit already in hand if it is one of them, else the first. */
export function stackChoice(stack, selection) {
  return activeMember(stack, selection) || stack.members[0];
}
