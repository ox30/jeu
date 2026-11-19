// A scenario can be written as another one with changes: "base" names the scenario it starts
// from, and each of its own keys replaces the key of the base (whole: a list is not merged).
// The lessons of the tutorial are written this way, on the maps of the battles.

/** The scenario as the game plays it: its base (if any) with its own keys over it. `find(id)` gives a scenario of the data. */
export function resolveScenario(def, find, depth = 0) {
  if (!def || !def.base) return def;
  if (depth > 4) throw new Error(`scenario ${def.id}: bases in a circle`);
  const base = resolveScenario(find(def.base), find, depth + 1);
  if (!base) throw new Error(`scenario ${def.id}: unknown base ${def.base}`);
  const own = { ...def };
  delete own.base;
  return { ...structuredClone(base), ...own };
}
