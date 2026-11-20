// The help of the unit sheet (C8 of the audit, then the tidying of 2.11.0). A sheet shows
// what the unit does and its orders; what explains them stands behind a « ? » by section
// (helpBubble.js). With the setting « Aides des fiches : affichées », the text of each
// bubble shows under the title of its section instead.

/** Is the help of the sheets behind its « ? » (the default), and not written in the sheet? */
export function helpFolded(app) {
  return app.settings.sheetHelp !== 'shown';
}

/** After each drawing of the sheet: marks it, for the style of the help sentences. */
export function applySheetHelp(app, root) {
  root.classList.toggle('help-folded', helpFolded(app));
}
