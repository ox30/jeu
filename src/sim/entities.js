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

/**
 * Gives an entity that already lives (one restored from a save made by an earlier version)
 * the declared fields it lacks, and touches none of those it has. Returns the entity.
 */
export function fillMissingFields(kind, entity, world) {
  const model = completeEntity(kind, { ...entity }, world);
  for (const [key, value] of Object.entries(model)) if (entity[key] === undefined) entity[key] = value;
  return entity;
}

/** The names of the fields declared for a kind, as a new entity gets them (for the tests). */
export function declaredFields(kind, world, seed = {}) {
  const before = new Set(Object.keys(seed));
  return Object.keys(completeEntity(kind, { ...seed }, world)).filter((key) => !before.has(key));
}
