// C9 of the audit, second part: marks that overlap become one stack; a click opens the sheet
// with a tab a unit; the unit in hand is drawn in front, the others fade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STACK_PX, activeMember, findStacks, indexStacks, memberSelection, stackChoice, stackConvoy, stackOfSelection, stackRole } from '../src/ui/stacks.js';
import { pickHit } from '../src/ui/hit.js';

const air = (id, x, y, kind = 'squadron') => ({ family: 'air', kind, id, x, y, label: `${id} Sqn` });
const sea = (id, x, y, kind = 'escort') => ({ family: 'sea', kind, id, x, y, label: id });

test('marks that overlap are one stack; marks apart stay alone', () => {
  const stacks = findStacks([air('601', 100, 100), air('615', 110, 104), air('43', 300, 100), air('32', 100 + STACK_PX + 1, 400)]);
  assert.equal(stacks.length, 1);
  assert.deepEqual(stacks[0].members.map((m) => m.id), ['601', '615']);
  assert.equal(stacks[0].family, 'air');
  assert.ok(Math.abs(stacks[0].x - 105) < 1e-9 && Math.abs(stacks[0].y - 102) < 1e-9, 'the mark stands in their middle');
});

test('a chain of neighbours is one stack; aircraft and ships never share one', () => {
  const chain = findStacks([air('a', 0, 0), air('b', 20, 0), air('c', 40, 0), air('d', 60, 0)]);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].members.length, 4);
  const mixed = findStacks([air('601', 50, 50), sea('eg1', 52, 50), sea('hx104', 50, 53, 'convoy')]);
  assert.equal(mixed.length, 1, 'the squadron overhead is not in the stack of the ships');
  assert.deepEqual(mixed[0].members.map((m) => `${m.kind}:${m.id}`), ['escort:eg1', 'convoy:hx104']);
});

test('the leader of a big wing stands for its wing: its tab selects the wing, and the wing in hand opens the stack', () => {
  const leader = { ...air('242', 10, 10), label: 'Big Wing', formation: 'f1' };
  assert.equal(findStacks([leader]).length, 0, 'a wing alone is no stack');
  const stacks = findStacks([leader, air('43', 16, 14)]);
  assert.equal(stacks.length, 1);
  const of = indexStacks(stacks);
  assert.deepEqual(memberSelection(stacks[0].members[0]), { kind: 'formation', id: 'f1' });
  assert.deepEqual(memberSelection(stacks[0].members[1]), { kind: 'squadron', id: '43' });
  const wing = { kind: 'formation', id: 'f1' };
  assert.equal(stackRole(of, wing, 'squadron', '242'), 'active', 'the wing in hand: its leader is in front');
  assert.equal(stackRole(of, wing, 'squadron', '43'), 'faded');
  assert.equal(stackOfSelection(of, wing), stacks[0]);
  assert.equal(stackOfSelection(of, { kind: 'formation', id: 'other' }), null);
  // The same mark seen twice in one image counts once.
  assert.equal(findStacks([leader, leader, air('43', 500, 500)]).length, 0);
});

test('the unit in hand is in front, the others fade; with none in hand the stack stands for all', () => {
  const stacks = findStacks([air('601', 0, 0), air('615', 5, 5), air('43', 500, 500)]);
  const of = indexStacks(stacks);
  assert.equal(stackRole(of, null, 'squadron', '601'), 'hidden');
  assert.equal(stackRole(of, { kind: 'raid', id: 'x' }, 'squadron', '615'), 'hidden', 'a raid in hand does not open the stack');
  assert.equal(stackRole(of, null, 'squadron', '43'), null, 'a unit alone is drawn as ever');
  const hand = { kind: 'squadron', id: '615' };
  assert.equal(stackRole(of, hand, 'squadron', '615'), 'active');
  assert.equal(stackRole(of, hand, 'squadron', '601'), 'faded');
  assert.equal(activeMember(stacks[0], hand).id, '615');
  assert.equal(stackOfSelection(of, hand), stacks[0]);
  assert.equal(stackOfSelection(of, { kind: 'squadron', id: '43' }), null);
});

test('a click on a stack takes the unit already in hand, else the first: never a neighbour by chance', () => {
  const [stack] = findStacks([sea('eg1', 0, 0), sea('eg2', 0, 0), sea('eg3', 0, 0)]);
  assert.equal(stackChoice(stack, null).id, 'eg1');
  assert.equal(stackChoice(stack, { kind: 'escort', id: 'eg3' }).id, 'eg3');
  assert.equal(stackChoice(stack, { kind: 'convoy', id: 'hx' }).id, 'eg1');
});

test('on the map the stack is one target; the unit in hand keeps the pointer over it', () => {
  // With no unit in hand: only the stack answers.
  const stackHit = { kind: 'stack', x: 100, y: 100, r: 16, priority: 0 };
  assert.equal(pickHit([stackHit], 104, 98, 6).kind, 'stack');
  // With one in hand: its own target comes first under the pointer, the stack behind it.
  const hand = { kind: 'squadron', id: '615', x: 103, y: 101, r: 14, priority: 0 };
  const hit = pickHit([{ ...stackHit, priority: 0.5 }, hand], 101, 100, 6, (h) => h.kind === 'squadron' && h.id === '615');
  assert.equal(hit.kind, 'squadron');
});

// ---- a line dropped where several targets overlap ----
test('every target under the end of a line is found, nearest first, each once', async () => {
  const { targetsUnder } = await import('../src/ui/hit.js');
  const hits = [
    { kind: 'raid', id: 'r1', x: 100, y: 100, r: 14, priority: 3 },
    { kind: 'raid', id: 'r1', x: 130, y: 90, r: 10, priority: 3 }, // its plaque
    { kind: 'raid', id: 'r2', x: 108, y: 104, r: 14, priority: 3 },
    { kind: 'squadron', id: '32', x: 101, y: 101, r: 14, priority: 0 },
    { kind: 'raid', id: 'r3', x: 400, y: 400, r: 14, priority: 3 },
  ];
  assert.deepEqual(targetsUnder(hits, 106, 103, 8, new Set(['raid'])), [{ kind: 'raid', id: 'r2' }, { kind: 'raid', id: 'r1' }]);
  assert.deepEqual(targetsUnder(hits, 400, 401, 8, new Set(['raid'])), [{ kind: 'raid', id: 'r3' }]);
  assert.deepEqual(targetsUnder(hits, 250, 250, 8, new Set(['raid'])), []);
});

test('a line from aircraft means a raid; from an escort group, a convoy to join or a marker to hunt', async () => {
  const { data, makeWorld, run } = await import('./helpers.js');
  const { setDictionary } = await import('../src/core/i18n.js');
  const { applyDropChoice, dropTargets, targetLabel } = await import('../src/ui/dropChoice.js');
  setDictionary(data.fr);
  const w = makeWorld('standard', { seaComms: 'direct' }, 'hiver-atlantique');
  run(w, 6 * 86400); // the second convoy of the winter has sailed
  const [group, other] = w.escorts;
  const convoys = w.convoys.filter((c) => c.state === 'atSea');
  assert.ok(convoys.length >= 2, `two convoys at sea (${convoys.length})`);
  const [c1, c2] = convoys;
  w.uboatPlots.push({ id: 'P9', uboatId: 'x', x: c1.x, y: c1.y, t: w.t - 1800, source: 'df' });
  const hits = [
    { kind: 'convoy', id: c1.id, x: 200, y: 200, r: 16, priority: 1 },
    { kind: 'convoy', id: c2.id, x: 206, y: 204, r: 16, priority: 1 },
    { kind: 'uplot', id: 'P9', x: 204, y: 196, r: 11, priority: 3 },
    { kind: 'raid', id: 'r1', x: 202, y: 202, r: 14, priority: 3 },
  ];
  const app = { world: w, hits, settings: w.settings, el: {}, selection: null };
  assert.deepEqual(dropTargets(app, { kind: 'squadron', id: w.squadrons[0].id }, 203, 201), [{ kind: 'raid', id: 'r1' }]);
  assert.deepEqual(dropTargets(app, { kind: 'convoy', id: c1.id }, 203, 201), [], 'a convoy has no target');
  const targets = dropTargets(app, { kind: 'escort', id: group.id }, 203, 201);
  assert.equal(targets.length, 3);
  assert.deepEqual(targets.map((x) => x.kind).sort(), ['convoy', 'convoy', 'uplot']);
  assert.equal(targetLabel(w, { kind: 'convoy', id: c1.id }), `Rejoindre ${c1.name}`);
  assert.match(targetLabel(w, { kind: 'uplot', id: 'P9' }), /^Chasser le repère de \d\d:\d\d$/);
  // The convoy a group already sails with is not offered to it.
  other.escorting = c2.id;
  assert.ok(!dropTargets(app, { kind: 'escort', id: other.id }, 203, 201).some((x) => x.id === c2.id));
  other.escorting = null;
  // The choice gives the order: this group joins this convoy.
  applyDropChoice(app, { hit: { kind: 'escort', id: group.id }, points: [[c1.x, c1.y]], targets }, { kind: 'convoy', id: c2.id });
  assert.equal(group.joinTarget, c2.id);
});

// ---- what the review of 2.10 found in the stacks ----
test('a convoy drawn as one mark with its escort is still a target of a dropped line', async () => {
  // (A stacked convoy registers no target of its own: `dropTargets` found nothing there,
  // and a line from another group, dropped on it and on a U-boat marker, opened no choice.)
  const { targetsUnder } = await import('../src/ui/hit.js');
  const stack = { kind: 'stack', family: 'sea', members: [{ kind: 'convoy', id: 'hx72' }, { kind: 'escort', id: 'eg1' }], x: 200, y: 200, r: 16, priority: 0, box: { x: 216, y: 190, w: 120, h: 30 } };
  const hits = [stack, { kind: 'uplot', id: 'P9', x: 204, y: 196, r: 11, priority: 3 }];
  const sea = new Set(['convoy', 'uplot']);
  assert.deepEqual(targetsUnder(hits, 203, 199, 8, sea).map((x) => `${x.kind}:${x.id}`).sort(), ['convoy:hx72', 'uplot:P9']);
  // On the plaque of the stack, away from the marker: the convoy alone.
  assert.deepEqual(targetsUnder(hits, 300, 205, 8, sea), [{ kind: 'convoy', id: 'hx72' }]);
  // The groups of the stack are no target of a line; a stack of squadrons holds no raid.
  assert.deepEqual(targetsUnder(hits, 203, 199, 8, new Set(['raid'])), []);
  // Seen both alone and in a stack, a target counts once.
  const twice = [stack, { kind: 'convoy', id: 'hx72', x: 201, y: 201, r: 16, priority: 1 }];
  assert.deepEqual(targetsUnder(twice, 203, 199, 8, sea), [{ kind: 'convoy', id: 'hx72' }]);
});

test('a convoy with its escort keeps its own mark and plaque; other stacks of ships do not', () => {
  const convoy = { family: 'sea', kind: 'convoy', id: 'hx72', x: 300, y: 300, label: 'HX 72', detail: { plaque: 'HX 72 · 34 navires · 9 nd', heading: 80, single: false } };
  const group = (id, dx = 0) => ({ family: 'sea', kind: 'escort', id, x: 300 + dx, y: 300, label: id.toUpperCase() });
  const [withEscort] = findStacks([convoy, group('eg1')]);
  assert.equal(stackConvoy(withEscort).id, 'hx72');
  assert.equal(stackConvoy(withEscort).detail.plaque, 'HX 72 · 34 navires · 9 nd', 'what the plaque of the convoy says goes with its mark');
  const [two] = findStacks([convoy, group('eg1'), group('eg2', 6)]);
  assert.equal(stackConvoy(two).id, 'hx72');
  // Two convoys crossing, or groups in one port: the naval mark with the names.
  const [crossing] = findStacks([convoy, { ...convoy, id: 'sc7', label: 'SC 7', x: 306 }, group('eg1')]);
  assert.equal(stackConvoy(crossing), null);
  const [port] = findStacks([group('eg1'), group('eg2', 5)]);
  assert.equal(stackConvoy(port), null);
  const [wings] = findStacks([{ family: 'air', kind: 'squadron', id: '601', x: 10, y: 10, label: '601' }, { family: 'air', kind: 'squadron', id: '615', x: 14, y: 10, label: '615' }]);
  assert.equal(stackConvoy(wings), null);
  assert.equal(stackConvoy(null), null);
});

test('the squadrons of a wing that gathers are one unit: no stack of itself, one tab among others', () => {
  // (Review of 2.10: a big wing on its way to its rendezvous showed as a stack of « itself
  // and its members », a tab a squadron, each leading back to the same wing.)
  const wing = (id, x, leads = false) => ({ family: 'air', kind: 'squadron', id, x, y: 100, label: 'Duxford Wing', formation: 'f1', leads });
  // Alone, however close: drawn as they always were.
  assert.deepEqual(findStacks([wing('310', 100), wing('242', 106, true), wing('19', 112)]), []);
  // With another squadron among them: two units, and the leader stands for the wing
  // whatever the order the marks were drawn in.
  const stacks = findStacks([wing('310', 100), wing('242', 106, true), air('43', 110, 104)]);
  assert.equal(stacks.length, 1);
  assert.deepEqual(stacks[0].members.map((m) => m.id), ['242', '43']);
  assert.deepEqual(memberSelection(stacks[0].members[0]), { kind: 'formation', id: 'f1' });
  assert.deepEqual(stacks[0].marks.map((k) => k.key).sort(), ['squadron:242', 'squadron:310', 'squadron:43']);
  const of = indexStacks(stacks);
  // Nothing in hand: the stack's mark stands for every mark, the follower's too.
  for (const id of ['242', '310', '43']) assert.equal(stackRole(of, null, 'squadron', id), 'hidden', id);
  // The wing in hand: its leader and its follower are drawn, the other squadron fades.
  const wingInHand = { kind: 'formation', id: 'f1' };
  assert.equal(stackRole(of, wingInHand, 'squadron', '242'), 'active');
  assert.equal(stackRole(of, wingInHand, 'squadron', '310'), 'active');
  assert.equal(stackRole(of, wingInHand, 'squadron', '43'), 'faded');
  // The other squadron in hand: the whole wing fades.
  const other = { kind: 'squadron', id: '43' };
  assert.equal(stackRole(of, other, 'squadron', '43'), 'active');
  assert.equal(stackRole(of, other, 'squadron', '242'), 'faded');
  assert.equal(stackRole(of, other, 'squadron', '310'), 'faded');
  // A follower taken in hand by itself (from the list of the members): its wing's tab is the active one.
  assert.equal(activeMember(stacks[0], { kind: 'squadron', id: '310' }).id, '242');
  assert.equal(stackOfSelection(of, wingInHand), stacks[0]);
});
