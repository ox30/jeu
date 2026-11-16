// The simulation never touches the page: it records what happened as events, and the
// interface reads them after each frame (journal, alerts, sounds).

export function emit(world, type, data = {}) {
  world.events.push({ type, t: world.t, ...data });
}

/** Returns and clears the pending events. */
export function drainEvents(world) {
  const list = world.events;
  world.events = [];
  return list;
}
