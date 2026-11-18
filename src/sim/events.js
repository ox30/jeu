// The simulation never touches the page: it records what happened as events, and the
// interface reads them after each frame (journal, alerts, sounds).

// Subsystems of the simulation that must see every event as it happens, whoever emits it —
// a step of the world or an order given between two steps (the watch reports of the sea).
const listeners = [];

/** Registers `fn(world, event)`, called for every event of every world as it is emitted. */
export function onEmit(fn) {
  if (!listeners.includes(fn)) listeners.push(fn);
}

export function emit(world, type, data = {}) {
  const e = { type, t: world.t, ...data };
  world.events.push(e);
  for (const fn of listeners) fn(world, e);
}

/** Returns and clears the pending events. */
export function drainEvents(world) {
  const list = world.events;
  world.events = [];
  return list;
}
