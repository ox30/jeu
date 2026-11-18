// Entity factories. Each subsystem declares, once, the fields it keeps on a kind of entity
// (an installation today; squadrons and ships will follow): whoever creates an entity, at the
// start of a game or in the middle of one, completes it with completeEntity(). A late comer
// (a mobile radar set up on the third day) then has every field the others have.

const declared = new Map();

/**
 * Declares the fields a subsystem keeps on entities of `kind`. `init(entity, world)` sets
 * them to their starting values; it must not depend on the other subsystems' fields.
 */
export function declareFields(kind, init) {
  if (!declared.has(kind)) declared.set(kind, []);
  declared.get(kind).push(init);
}

/** Gives a new entity every declared field of its kind. Returns the entity. */
export function completeEntity(kind, entity, world) {
  for (const init of declared.get(kind) || []) init(entity, world);
  return entity;
}
