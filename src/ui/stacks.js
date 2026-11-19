// Units whose marks overlap on the map (C9 of the audit). Squadrons flying together, the
// groups lying in one port, a convoy and the group that sails with it: where their marks
// stand on one another they become one mark with their number, and a click on it opens the
// sheet with one tab a unit. Kept free of the page: the scene, the pointer and the tests read it.

/** Marks nearer than this, in screen pixels, are one stack. */
export const STACK_PX = 24;

export function stackKey(kind, id) {
  return `${kind}:${id}`;
}

/**
 * The stacks among the marks drawn: [{ family, x, y, members: [{ kind, id, label, x, y }] }].
 * `marks`: [{ family: 'air' | 'sea', kind, id, x, y, label, formation }], one a unit. The
 * leader of a big wing or of a support group stands for its formation (`formation`: its id;
 * the squadrons in station with it have no mark of their own). Marks of one family within
 * `radius` of one another, directly or through a neighbour, make a stack of two or more.
 */
export function findStacks(marks, radius = STACK_PX) {
  // One mark a unit: the first seen stands for it.
  const seen = new Set();
  const items = [];
  for (const m of marks) {
    const key = stackKey(m.kind, m.id);
    if (seen.has(key) || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    seen.add(key);
    items.push({ ...m, key });
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
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    stacks.push({
      family: members[0].family,
      x: members.reduce((n, m) => n + m.x, 0) / members.length,
      y: members.reduce((n, m) => n + m.y, 0) / members.length,
      members: members.map(({ kind, id, label, x, y, formation }) => ({ kind, id, label, x, y, formation: formation || null })),
    });
  }
  return stacks;
}

/** Each stacked unit to its stack: Map of "kind:id" → stack. */
export function indexStacks(stacks) {
  const map = new Map();
  for (const s of stacks) for (const m of s.members) map.set(stackKey(m.kind, m.id), s);
  return map;
}

/** The member of the stack that is in hand (the unit itself, or the formation it leads), or null. */
export function activeMember(stack, selection) {
  if (!stack || !selection) return null;
  return stack.members.find((m) => (m.kind === selection.kind && m.id === selection.id)
    || (selection.kind === 'formation' && m.formation === selection.id)) || null;
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
  return active.kind === kind && active.id === id ? 'active' : 'faded';
}

/** The stack of what is in hand, or null. */
export function stackOfSelection(stackOf, selection) {
  if (!stackOf || !selection) return null;
  if (selection.kind !== 'formation') return stackOf.get(stackKey(selection.kind, selection.id)) || null;
  for (const stack of stackOf.values()) if (activeMember(stack, selection)) return stack;
  return null;
}

/** What a click on a stack selects: the unit already in hand if it is one of them, else the first. */
export function stackChoice(stack, selection) {
  return activeMember(stack, selection) || stack.members[0];
}
