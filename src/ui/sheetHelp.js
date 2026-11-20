// The help sentences of the unit sheet (C8 of the audit). They are shown by default; a display
// setting folds them, and then a « ? » beside each section shows those of that section on
// demand. Warnings (a group out of fuel, Congress and the dollars) are never folded: they are
// not help, they are news.

/** Are the help sentences folded away? */
export function helpFolded(app) {
  return app.settings.sheetHelp === 'folded';
}

/** The header a help sentence belongs to: the sub-title before it, else its section, else the tab. */
function headerOf(hint, root) {
  for (let node = hint.previousElementSibling; node; node = node.previousElementSibling) {
    if (node.classList.contains('sub')) return node;
  }
  const up = hint.parentElement;
  if (!up || up === root) return null;
  const sec = up.closest('details.sec');
  if (up.classList.contains('sec-body') || !sec || !root.contains(sec)) {
    if (sec && root.contains(sec) && up.classList.contains('sec-body')) return sec.querySelector('summary');
    return up === root ? null : headerOf(up, root);
  }
  return headerOf(up, root);
}

/** What names a header from one drawing of the sheet to the next. */
function keyOf(header) {
  if (!header) return 'top';
  const sec = header.closest('details.sec');
  return header.tagName === 'SUMMARY' && sec ? `sec:${sec.dataset.sec}` : `sub:${header.firstChild ? header.firstChild.textContent.trim() : ''}`;
}

/**
 * After each drawing of the sheet: folds the help sentences or not, gives each header that
 * has some its « ? », and shows the sentences of the sections the player opened. `label`:
 * the name of the « ? » button, for its tooltip.
 */
export function applySheetHelp(app, root, label) {
  const folded = helpFolded(app);
  root.classList.toggle('help-folded', folded);
  if (!folded) {
    for (const b of root.querySelectorAll('.hint-toggle')) b.remove();
    for (const top of root.querySelectorAll('.hint-top')) top.remove();
    return;
  }
  const open = app.hintsOpen || (app.hintsOpen = new Set());
  const headers = new Map(); // key → header element (null: the top of the tab)
  for (const hint of root.querySelectorAll('p.hint')) {
    if (hint.classList.contains('warn')) continue;
    const header = headerOf(hint, root);
    const key = keyOf(header);
    headers.set(key, header);
    hint.classList.toggle('show', open.has(key));
  }
  const wanted = new Set(headers.keys());
  for (const b of root.querySelectorAll('.hint-toggle')) if (!wanted.has(b.dataset.hintToggle) || !b.isConnected) b.remove();
  for (const [key, header] of headers) {
    let host = header;
    if (!host) {
      // Sentences that belong to no section: one « ? » at the top of the sheet's text.
      host = root.querySelector('.hint-top');
      if (!host) {
        host = document.createElement('div');
        host.className = 'hint-top';
        root.prepend(host);
      }
    }
    let b = host.querySelector(':scope > .hint-toggle');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'hint-toggle';
      b.textContent = '?';
      host.appendChild(b);
    }
    b.dataset.hintToggle = key;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(open.has(key)));
    b.classList.toggle('active', open.has(key));
  }
  if (!headers.has('top')) for (const top of root.querySelectorAll('.hint-top')) top.remove();
}

/** A click on a « ? »: the sentences of its section show, or fold again. Returns true when it was one. */
export function toggleSheetHelp(app, e) {
  const b = e.target.closest('.hint-toggle');
  if (!b) return false;
  e.preventDefault(); // (inside a <summary>: the section must not fold)
  e.stopPropagation();
  const open = app.hintsOpen || (app.hintsOpen = new Set());
  const key = b.dataset.hintToggle;
  if (open.has(key)) open.delete(key);
  else open.add(key);
  return true;
}
