// The height of ten unit sheets, measured in the single file dist/index.html (headless Chrome,
// 1440 × 900, the Standard preset): the gate of the tidying of the help sentences (2.11.0).
// For each sheet: the height of the scrolling part that shows, and the height of what it
// holds (the bottom of its last visible element, from its top). A screenshot of each.
//
//   node tools/smoke/sheets.mjs --name before        → tools/smoke/out/sheets-before/
//   node tools/smoke/sheets.mjs --name after --gate  → fails when a sheet is over its target
//
// The targets are those of the plan (« aide rangée »): none may be over by more than 10 px.

import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openGame, closeDialogs, sleep } from './browser.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
};
const NAME = arg('name', 'now');
const GATE = Boolean(arg('gate', false));
const HELP = arg('help', null); // « shown » or « folded »: forces the setting « Aides des fiches »
const OUT = `${ROOT}tools/smoke/out/sheets-${NAME}/`;
const SLACK = 10;

// The big wing of the measure: made on the Formations page around 242 Sqn alone, as the plan
// measured it (one departure line in its Rassemblement tab).
const WING = (arg('wing', '242') + '').split(',');

/**
 * The ten sheets of the plan. `hours`: game time before the unit is taken in hand; `pick`
 * runs in the page and returns { kind, id } (it may give an order first); `then`: more hours
 * after the order; `tab`: the tab of the sheet. `was`: the height measured in 2.10.5;
 * `target`: the height of the plan with the help tidied away.
 */
const SHEETS = [
  { name: 'escort-at-sea', label: "Groupe d'escorte en mer (Atlantique)", scenario: 'hiver-atlantique', hours: 6, then: 30, was: 972, target: 629,
    pick: (a) => {
      const c = a.world.convoys.find((x) => x.state === 'atSea');
      const e = a.world.escorts.find((x) => x.state === 'inPort' && !x.formation);
      return { kind: 'escort', id: e.id, join: c.id };
    } },
  { name: 'escort-in-port', label: "Groupe d'escorte au port (Atlantique)", scenario: 'hiver-atlantique', hours: 0, was: 923, target: 535,
    pick: (a) => ({ kind: 'escort', id: a.world.escorts.find((x) => x.state === 'inPort' && !x.formation).id }) },
  { name: 'squadron-on-ground', label: 'Escadrille au sol (Kanalkampf)', scenario: 'kanalkampf', hours: 0, was: 753, target: 681,
    pick: (a) => ({ kind: 'squadron', id: a.world.squadrons.find((s) => s.role === 'fighter' && s.state === 'ready').id }) },
  { name: 'wing-commands', label: 'Big wing, onglet Commandes', scenario: 'quinze-septembre', hours: 0, was: 692, target: 645, tab: 'cmd', wing: WING,
    pick: (a) => ({ kind: 'formation', id: a.world.formations.find((f) => f.kind === 'air').id }) },
  { name: 'patrol-on-ground', label: 'Patrouille Whitley au sol (Atlantique)', scenario: 'hiver-atlantique', hours: 0, was: 683, target: 611,
    pick: (a) => ({ kind: 'squadron', id: a.world.squadrons.find((s) => /Whitley/i.test(`${s.type} ${s.aircraft || ''}`) || s.id === '502').id }) },
  { name: 'convoy-high-seas', label: 'Convoi en haute mer (Atlantique)', scenario: 'hiver-atlantique', hours: 6, was: 528, target: 369,
    pick: (a) => ({ kind: 'convoy', id: a.world.convoys.find((x) => x.state === 'atSea').id }) },
  { name: 'convoy-hx55', label: 'Convoi HX 55 en mer (Kanalkampf)', scenario: 'kanalkampf', hours: 0, was: 433, target: 253,
    pick: (a) => ({ kind: 'convoy', id: a.world.convoys.find((x) => /HX 55/.test(x.name)).id }) },
  { name: 'coastal-in-port', label: 'Convoi côtier au port (Kanalkampf)', scenario: 'kanalkampf', hours: 0, was: 412, target: 330,
    pick: (a) => ({ kind: 'convoy', id: a.world.convoys.find((x) => x.type === 'coastal').id }) },
  { name: 'wing-rally', label: 'Big wing, onglet Rassemblement', scenario: 'quinze-septembre', hours: 0, was: 270, target: 182, tab: 'rally', wing: WING,
    pick: (a) => ({ kind: 'formation', id: a.world.formations.find((f) => f.kind === 'air').id }) },
  { name: 'airfield-orders', label: 'Biggin Hill, onglet Ordres', scenario: 'kanalkampf', hours: 0, was: 294, target: 174, tab: 'orders',
    pick: () => ({ kind: 'site', id: 'airfield:biggin_hill' }) },
];

mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await openGame(pathToFileURL(`${ROOT}dist/index.html`).href, { width: 1440, height: 900 });
const only = arg('only', null);
const rows = [];
for (const s of SHEETS) {
  if (only && !String(only).split(',').includes(s.name)) continue;
  await page.evaluate(([id, help]) => {
    const a = window.__game;
    a.campaign.unlockAll = true;
    if (help) a.settings.sheetHelp = help;
    a.selection = null;
    a.restart(id);
  }, [s.scenario, HELP === true ? null : HELP]);
  await sleep(700);
  await closeDialogs(page);
  const steps = async (hours) => {
    for (let h = 0; h < hours; h++) {
      await page.evaluate(() => {
        const a = window.__game;
        a.paused = true;
        for (let i = 0; i < 60; i++) a.stepWorld(60);
      });
    }
    await sleep(150);
    await closeDialogs(page);
  };
  await page.evaluate(() => { window.__game.paused = true; });
  await steps(s.hours);
  if (s.wing) {
    await page.click('#btn-formations');
    await sleep(300);
    for (const id of s.wing) {
      await page.click(`#dlg-formations [data-fm="add"][data-id="${id}"]`);
      await sleep(150);
    }
    await page.evaluate(() => document.getElementById('dlg-formations').close());
    await sleep(200);
  }
  const sel = await page.evaluate(`(${s.pick})(window.__game)`);
  const take = async () => {
    await page.evaluate(([x, tab]) => {
      const a = window.__game;
      a.unitTabs = {};
      a.selection = { kind: x.kind, id: x.id };
      a.dirtyPanels = true;
      a.wantTab = tab || null;
    }, [sel, s.tab || null]);
    await sleep(350);
    if (s.tab) {
      await page.evaluate((tab) => {
        const b = document.querySelector(`#unit-tabs [data-unit-tab="${tab}"]`);
        if (b) b.click();
      }, s.tab);
      await sleep(350);
    }
  };
  await take();
  if (sel.join) {
    // The order of the sheet: « Rejoindre <convoy> », then the hours of its passage.
    const done = await page.evaluate((cid) => {
      const b = document.querySelector(`#unit-panel [data-action="join"][data-convoy="${cid}"], #unit-panel [data-convoy="${cid}"]`);
      if (b) b.click();
      return Boolean(b);
    }, sel.join);
    if (!done) console.log(`  (${s.name}: no button to join ${sel.join})`);
    await sleep(300);
    await steps(s.then || 0);
    await page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); window.__game.alert = null; });
    await take();
  }
  const m = await page.evaluate(() => {
    const body = document.getElementById('unit-body');
    body.scrollTop = 0;
    const top = body.getBoundingClientRect().top;
    let bottom = 0;
    for (const el of body.querySelectorAll('*')) {
      if (!el.offsetParent || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.width > 0) bottom = Math.max(bottom, r.bottom - top);
    }
    const a = window.__game;
    const tab = document.querySelector('#unit-tabs .active');
    return {
      visible: body.clientHeight, content: Math.round(bottom), title: document.getElementById('unit-title').textContent,
      tab: tab ? tab.textContent : '', help: a.settings.sheetHelp, hints: body.querySelectorAll('p.hint').length,
      shownHints: [...body.querySelectorAll('p.hint')].filter((x) => x.offsetParent).length, marks: body.querySelectorAll('.hint-toggle, .help-mark').length,
    };
  });
  await page.screenshot({ path: `${OUT}${s.name}.png` });
  rows.push({ ...m, name: s.name, label: s.label, was: s.was, target: s.target });
}
await browser.close();
writeFileSync(`${OUT}heights.json`, `${JSON.stringify(rows, null, 2)}\n`);
let over = 0;
console.log(`sheet                  | title                     | tab           | visible | content | 2.10.5 | target | over`);
for (const r of rows) {
  const d = r.content - r.target;
  if (d > SLACK) over++;
  console.log(`${r.name.padEnd(22)} | ${r.title.slice(0, 25).padEnd(25)} | ${r.tab.slice(0, 13).padEnd(13)} | ${String(r.visible).padStart(7)} | ${String(r.content).padStart(7)} | ${String(r.was).padStart(6)} | ${String(r.target).padStart(6)} | ${d > 0 ? `+${d}` : d}${d > SLACK ? '  <<' : ''}  (${r.shownHints}/${r.hints} help lines shown, ${r.marks} « ? »)`);
}
if (errors.length) console.log(`console errors: ${errors.slice(0, 3).join(' | ')}`);
if (GATE && (over || errors.length)) {
  console.log(`GATE: ${over} sheet(s) more than ${SLACK} px over the target`);
  process.exit(1);
}
