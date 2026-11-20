// The « ? » of the game: one by section of a sheet, by sub-title that needs one, by page and
// by setting. Each opens a bubble: a text of four sentences at most (data/i18n/fr.json,
// sheetHelp.<key>) and a link to the rubric of the help that says more, [tab, anchor].
//
// `lead`: a first sentence that depends on a setting of the game, [group, setting]: the
// text sheetHelpLead.<group>.<value of the setting>. `tail`: the same, at the end.

import { t } from '../core/i18n.js';

export const HELP_TOPICS = {
  // ---- the sheet of a unit ----
  ground: { tab: 'air', anchor: 'alerte' },
  groundPlain: { tab: 'air', anchor: 'programmer' },
  routeAir: { tab: 'sheet', anchor: 'traces', lead: ['route', 'orders'] },
  routeWing: { tab: 'air', anchor: 'formations', lead: ['route', 'orders'] },
  routeEscort: { tab: 'sea', anchor: 'appareiller', lead: ['route', 'orders'] },
  routeGroup: { tab: 'air', anchor: 'formations', lead: ['route', 'orders'] },
  routeConvoy: { tab: 'sea', anchor: 'fin-de-route', lead: ['route', 'orders'] },
  mission: { tab: 'air', anchor: 'attitude' },
  formation: { tab: 'air', anchor: 'formations' },
  group: { tab: 'air', anchor: 'formations' },
  manageAir: { tab: 'air', anchor: 'formations' },
  manageSea: { tab: 'air', anchor: 'formations' },
  convoyPort: { tab: 'sea', anchor: 'appareiller' },
  port: { tab: 'sea', anchor: 'appareiller' },
  comms: { tab: 'sea', anchor: 'silence' },
  convoys: { tab: 'sea', anchor: 'rejoindre' },
  uboats: { tab: 'sea', anchor: 'chasse' },
  rallyAir: { tab: 'air', anchor: 'rassemblement', tail: ['rally', 'interceptAid'] },
  rallySea: { tab: 'air', anchor: 'rassemblement', tail: ['rally', 'interceptAid'] },
  // ---- an installation ----
  minStock: { tab: 'air', anchor: 'trains' },
  train: { tab: 'air', anchor: 'trains' },
};

/** Is there a bubble of that name? */
export function hasHelp(key) {
  return Object.prototype.hasOwnProperty.call(HELP_TOPICS, key);
}

/**
 * The text of a bubble, for the settings of the game in hand (`settings`: those of the
 * world; none from the main menu). `args`: the figures some texts quote.
 */
export function helpText(key, settings = null, args = {}) {
  const topic = HELP_TOPICS[key];
  if (!topic) return '';
  const part = (pair) => {
    if (!pair) return '';
    const [group, setting] = pair;
    const own = t(`sheetHelpLead.${group}`);
    const value = settings && settings[setting];
    return own && typeof own === 'object' ? own[value] || own.default || '' : '';
  };
  return [part(topic.lead), t(`sheetHelp.${key}`, args), part(topic.tail)].filter(Boolean).join(' ');
}

/** The rubric of the help a bubble links to: { tab, anchor, name } (the title of the rubric, else of its tab). */
export function helpLink(key) {
  const topic = HELP_TOPICS[key];
  if (!topic) return null;
  const rubrics = t(`help.rubrics.${topic.tab}`);
  const rubric = Array.isArray(rubrics) ? rubrics.find((r) => r.id === topic.anchor) : null;
  return { tab: topic.tab, anchor: topic.anchor, name: rubric ? rubric.title : t(`help.tabs.${topic.tab}`) };
}
