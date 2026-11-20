// What is under the pointer. The scene registers a target for everything that can be clicked
// (app.hits: a disc, sometimes the box of a plaque too, and a priority); this picks one.
// Kept free of the page: the tests read it.

/** Is the target under the pointer (within its disc and `pad`, or in the box of its plaque)? */
function under(h, x, y, pad) {
  const d = Math.hypot(h.x - x, h.y - y);
  const inBox = Boolean(h.box) && x >= h.box.x && x <= h.box.x + h.box.w && y >= h.box.y && y <= h.box.y + h.box.h;
  return d <= h.r + pad || inBox ? { d, inBox } : null;
}

/**
 * The target a click at (x, y) goes to, or null. The lowest priority wins, then the nearest
 * symbol (a pointer on a plaque but off its symbol counts as on the edge of the symbol).
 * A unit already selected always wins over the other units under the pointer (`isSelected`
 * tells which target belongs to the selection): where plaques overlap, a drag starts from the
 * unit in hand and not from its neighbour. The handles of its route still come first.
 */
export function pickHit(hits, x, y, pad, isSelected = null) {
  let best = null;
  for (const h of hits) {
    const at = under(h, x, y, pad);
    if (!at) continue;
    // Between the handles (negative priorities) and every unit (0 and more).
    const priority = isSelected && h.priority >= 0 && isSelected(h) ? -0.5 : h.priority;
    // In the box of a plaque counts as the edge of the disc; right on the symbol is nearer still.
    const score = priority * 1000 + (at.inBox ? Math.min(h.r, at.d) : at.d);
    if (!best || score < best.score) best = { ...h, score };
  }
  return best;
}

/**
 * How many different units are under the pointer, among the kinds given. The squadrons or
 * the groups of one formation count for one: a click on any of them selects the formation.
 */
export function unitsUnder(hits, x, y, pad, kinds) {
  const found = new Set();
  for (const h of hits) {
    if (!kinds.has(h.kind) || !under(h, x, y, pad)) continue;
    found.add(h.formation ? `formation:${h.formation}` : h.kind === 'rally' ? `formation:${h.id}` : `${h.kind}:${h.id}`);
  }
  return found.size;
}

/**
 * Every different target of the kinds given under the pointer, nearest first: where raids,
 * convoys or U-boat markers overlap, a line dropped there has to say which one it means.
 * The units of a stack count each for itself: a convoy drawn as one mark with its escort is
 * still a convoy to join.
 */
export function targetsUnder(hits, x, y, pad, kinds) {
  const found = new Map();
  const note = (kind, id, d) => {
    const key = `${kind}:${id}`;
    if (!found.has(key) || d < found.get(key).d) found.set(key, { kind, id, d });
  };
  for (const h of hits) {
    if (h.kind !== 'stack' && !kinds.has(h.kind)) continue;
    const at = under(h, x, y, pad);
    if (!at) continue;
    const d = at.inBox ? Math.min(h.r, at.d) : at.d;
    if (h.kind !== 'stack') note(h.kind, h.id, d);
    else for (const m of h.members) if (kinds.has(m.kind)) note(m.kind, m.id, d);
  }
  return [...found.values()].sort((a, b) => a.d - b.d).map(({ kind, id }) => ({ kind, id }));
}
