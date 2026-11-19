// What a scenario offers on its map (the « map » block of its data): the views of the top
// bar and the tools. The top bar, the keys and the links of the sheets all ask here, so that
// a tool or a view a scenario does not declare cannot be reached another way.

import { fatigueOn } from '../sim/crews.js';

function mapOf(app) {
  return (app.world && app.world.scenario && app.world.scenario.map) || {};
}

/** Is this view (atlantic, britain, england) one of the scenario's? */
export function viewOffered(app, name) {
  const views = mapOf(app).views;
  return !views || views.includes(name);
}

/** Is this tool (ruler, radarCover, reports, formations, roster, cards) one of the scenario's? */
export function toolOffered(app, name) {
  const tools = mapOf(app).tools;
  if (tools && !tools.includes(name)) return false;
  // The radar cover has nothing to show without a radar.
  if (name === 'radarCover') return app.world.radars.length > 0;
  // The duty rosters only matter when the crews tire (I6 of the audit), and where there is a
  // squadron to put on them: fighters, spotters and Coastal Command alike (everything that
  // flies tires, so everything that flies has its alert state and its plan).
  if (name === 'roster') return fatigueOn(app.world) && app.world.squadrons.length > 0;
  return true;
}
