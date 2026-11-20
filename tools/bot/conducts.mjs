// The ways of playing (« conduites ») the automatic player knows, by scenario, and the
// matrix of games played for a measurement. Each lot is measured before and after on the
// same matrix, ten seeds a line.

const AIR = {
  rien: { idle: true }, // no order at all
  simple: { perRaid: 2, scale: true }, // two squadrons a raid, more against a big one
  // Carefully: sweeps left alone, rest at night — and on 15 September, as its briefing asks,
  // everything in mass (the battle of one day is won by committing: the mirror of Adlertag).
  // On that day « soigne » and « masse » are therefore the same games: the tables show one
  // line of it, and « prudent » beside it.
  soigne: {
    perRaid: 2,
    scale: true,
    ignoreHigh: true,
    nightRest: true,
    byScenario: { 'quinze-septembre': { perRaid: 6, scale: false, ignoreHigh: false, answers: { engage: true, pursue: true, beyond: true } } },
  },
  // The care of the week-long battles kept on 15 September too (two a raid, sweeps left
  // alone): what « soigne » was on that day until 2.9, measured to show what it costs there.
  prudent: { perRaid: 2, scale: true, ignoreHigh: true, nightRest: true },
  'sans-chasse': { perRaid: 0 }, // convoys and trains only: the fighters stay on the ground
  'sans-ravitaillement': { perRaid: 2, scale: true, minStocks: false }, // no order to the trains
  '1-par-raid': { perRaid: 1 },
  '2-par-raid': { perRaid: 2 },
  '3-par-raid': { perRaid: 3 },
  '4-par-raid': { perRaid: 4 },
  '6-par-raid': { perRaid: 6 },
  // In mass, and after them: six squadrons a raid, pursuit allowed beyond mid-Channel.
  masse: { perRaid: 6, answers: { engage: true, pursue: true, beyond: true } },
  // The campaign played simply, then 15 September in mass (a conduct can differ by battle).
  'masse-le-15': {
    perRaid: 2,
    scale: true,
    byScenario: { 'quinze-septembre': { perRaid: 6, scale: false, answers: { engage: true, pursue: true, beyond: true } } },
  },
};

const SEA = {
  rien: { idle: true }, // the convoys sail alone
  simple: {}, // one escort group a convoy, with the game's own defaults
  rester: { behaviour: 'stay' },
  chasser: { behaviour: 'hunt' },
  'rester-econome': { behaviour: 'stay', pattern: 'light' },
  'chasser-econome': { behaviour: 'hunt', pattern: 'light' },
  soigne: { behaviour: 'hunt', air: 'cover', rearm: true },
  'deux-avions': { buy: [{ id: 'hudson', day: 0 }, { id: 'catalina', day: 0 }] },
};

export const CONDUCTS = {
  'm0-july-1940': AIR,
  kanalkampf: AIR,
  adlertag: AIR,
  'quinze-septembre': AIR,
  'hiver-atlantique': SEA,
};

export const SEA_SCENARIOS = ['hiver-atlantique'];

/** The lines of a full measurement: [scenario, preset, conduct]. */
export const MATRIX = [
  ['kanalkampf', 'standard', 'rien'],
  ['kanalkampf', 'standard', 'simple'],
  ['kanalkampf', 'standard', 'sans-chasse'],
  ['kanalkampf', 'realistic', 'simple'],
  ['kanalkampf', 'realistic', 'soigne'],
  ['adlertag', 'standard', 'rien'],
  ['adlertag', 'standard', 'simple'],
  ['adlertag', 'standard', 'sans-ravitaillement'],
  ['adlertag', 'standard', '1-par-raid'],
  ['adlertag', 'standard', '2-par-raid'],
  ['adlertag', 'standard', '4-par-raid'],
  ['adlertag', 'realistic', 'simple'],
  ['adlertag', 'realistic', 'soigne'],
  ['quinze-septembre', 'standard', 'rien'],
  ['quinze-septembre', 'standard', 'simple'],
  ['quinze-septembre', 'standard', '2-par-raid'],
  ['quinze-septembre', 'standard', '4-par-raid'],
  ['quinze-septembre', 'realistic', 'simple'],
  ['quinze-septembre', 'realistic', 'soigne'], // in mass on that day (the same games as « masse »)
  ['quinze-septembre', 'realistic', 'prudent'],
  ['hiver-atlantique', 'standard', 'rien'],
  ['hiver-atlantique', 'standard', 'simple'],
  ['hiver-atlantique', 'standard', 'rester'],
  ['hiver-atlantique', 'standard', 'chasser'],
  ['hiver-atlantique', 'standard', 'chasser-econome'],
  ['hiver-atlantique', 'standard', 'soigne'],
  ['hiver-atlantique', 'standard', 'deux-avions'],
  ['hiver-atlantique', 'realistic', 'rester'],
  ['hiver-atlantique', 'realistic', 'chasser'],
  ['hiver-atlantique', 'realistic', 'soigne'],
  // The three air battles one after the other, with what the campaign carries over.
  ['campagne', 'standard', 'simple'],
  ['campagne', 'realistic', 'simple'],
  ['campagne', 'realistic', 'soigne'],
  ['campagne', 'realistic', 'masse-le-15'],
];
