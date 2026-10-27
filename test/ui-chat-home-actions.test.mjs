// test/ui-chat-home-actions.test.mjs — worca Chat P6: the home's quick actions. Seven intent tiles, one pinned
// workflow (Shaper by default, src/shared/home-pins.mjs) + More in the mockup's order, each gated like the page that
// owns its feature; a tile only arms the composer; Track a run and Explain a diff open a Live / Finished run picker
// whose pick prefills a run mention; switched-off features hide; the other pins sit in More under Pinned.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createQuickActions, moreItems, actionAvailable, runMention, TILE_INTENTS, TILE_ACTIONS, MORE_INTENTS, ACTION_LEVEL, DEFAULT_FLAGS, PICKER_MAX,
} from '../ui/public/chat/home-actions.mjs';
import { DEFAULT_HOME_PINS } from '../src/shared/home-pins.mjs';

const trackDom = useDomRelease(afterEach);

function setup({ runs = { live: [], finished: [] }, level = 'expert', savePins = async (list) => list } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const calls = [];
  const deps = {
    setIntent: (id, opts) => calls.push(['setIntent', id, opts || null]),
    prefill: (text) => calls.push(['prefill', text]),
    savePins: (list) => { calls.push(['savePins', list]); return savePins(list); },
    level: () => level,
    addProject: () => calls.push(['addProject']),
  };
  const actions = createQuickActions({ doc, deps, getRuns: () => runs });
  doc.body.appendChild(actions.el);
  return {
    doc, actions, calls,
    tile: (id) => doc.querySelector(`.chat-home-act[data-intent="${id}"]`),
    more: () => doc.querySelector('.chat-home-act[data-action="more"]'),
    menu: () => doc.querySelector('.wfv-menu'),
    items: () => [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')],
  };
}
const win = (s) => s.doc.defaultView;   // setup() returns no dom: build events from the document's window
const WF = [{ id: 'wf_default', name: 'Default' }, { id: 'wf_pay', name: 'Payroll close' }, { id: 'wf_post', name: 'Social post' }];
const pinTiles = (s) => [...s.doc.querySelectorAll('.chat-home-act[data-pin]')];

test('nine tiles by default — six intents, the Shaper pin, Add project and More — each naming its interface level', () => {
  const s = setup();
  const tiles = [...s.doc.querySelectorAll('.chat-home-act')];
  assert.deepEqual(tiles.map((b) => b.textContent), ['New run', 'Shaper', 'Build workflow', 'Schedule a run', 'Track a run',
    'Explain a diff', 'Write a script', 'Add project', 'More']);
  assert.deepEqual(tiles.map((b) => b.dataset.minLevel), ['simple', 'simple', 'simple', 'advanced', 'simple', 'advanced', 'simple', 'simple', 'simple']);
  assert.ok(tiles.every((b) => b.type === 'button' && b.querySelector('.chat-ic svg')));
  assert.ok(tiles.every((b) => b.classList.contains('btn') && b.classList.contains('btn-lg')), 'F-15: a tile wears the one button, large');
  assert.equal(s.actions.el.getAttribute('role'), 'group');
  assert.equal(s.actions.el.getAttribute('aria-label'), 'Quick actions');
  assert.equal(s.more().getAttribute('aria-haspopup'), 'menu');
  assert.deepEqual([...TILE_INTENTS], ['run', 'workflow', 'schedule', 'track', 'diff', 'script']);
  assert.deepEqual([...TILE_ACTIONS], ['project']);
  assert.equal(ACTION_LEVEL.project, 'simple');
  assert.equal('clone' in ACTION_LEVEL, false);
  assert.deepEqual([...MORE_INTENTS], ['away', 'metrics', 'model', 'workspace', 'remember', 'tasks']);
  assert.equal(ACTION_LEVEL.metrics, 'expert', 'Team metrics is gated like its page');
  assert.equal(ACTION_LEVEL.tasks, 'advanced', 'Find tasks is gated like the task source picker');
});

test('a tile only arms the composer: setIntent, focus on the composer, nothing sent, no menu; Add project opens the dialog instead', () => {
  const s = setup();
  s.tile('run').click();
  s.doc.querySelector('.chat-home-act[data-action="project"]').click();
  assert.deepEqual(s.calls, [['setIntent', 'run', null], ['addProject']]);
  assert.equal(s.menu(), null);
});

test('Track a run: the intent without stealing focus, then a Live picker whose pick prefills a run mention', () => {
  const runs = { live: [{ title: 'Fix upload', pipelineId: 'p1', project: 'worca-cc' }, { title: 'Offline banner', runId: 'r9', project: '' }], finished: [] };
  const s = setup({ runs });
  s.tile('track').click();
  assert.deepEqual(s.calls[0], ['setIntent', 'track', { focus: false }]);
  assert.equal(s.menu().getAttribute('aria-label'), 'Track a run');
  assert.equal(s.menu().querySelector('.wfv-menu-h').textContent, 'Live');
  assert.deepEqual(s.items().map((b) => b.querySelector('.wfv-menu-l').textContent), ['Fix upload', 'Offline banner']);
  assert.equal(s.items()[0].querySelector('.wfv-menu-hint').textContent, 'worca-cc');
  assert.equal(s.tile('track').getAttribute('aria-expanded'), 'true');
  s.items()[0].click();
  assert.deepEqual(s.calls.at(-1), ['prefill', '“Fix upload” (#p1)']);
  assert.equal(s.menu(), null, 'a pick closes the picker');
});

test('Explain a diff: a Finished picker; an empty list says so; the tile toggles its picker', () => {
  const s = setup();
  s.tile('diff').click();
  assert.equal(s.menu().querySelector('.wfv-menu-h').textContent, 'Finished');
  assert.deepEqual(s.items().map((b) => [b.textContent, b.disabled]), [['No finished runs', true]]);
  s.tile('diff').click();
  assert.equal(s.menu(), null, 'the second press closes it');
  const t = setup({ runs: { live: [], finished: [] } });
  t.tile('track').click();
  assert.deepEqual(t.items().map((b) => [b.textContent, b.disabled]), [['Nothing running', true]]);
  t.actions.closeMenu();
  assert.equal(t.menu(), null);
});

test('a picker lists at most PICKER_MAX runs', () => {
  const finished = Array.from({ length: 12 }, (_, i) => ({ title: `Run ${i}`, pipelineId: `p${i}` }));
  const s = setup({ runs: { live: [], finished } });
  s.tile('diff').click();
  assert.equal(s.items().length, PICKER_MAX);
  assert.equal(PICKER_MAX, 8);
  s.actions.closeMenu();
});

test('More lists only what the level and the feature switches allow', () => {
  assert.deepEqual(moreItems({ level: 'simple', flags: {} }), ['away']);
  assert.deepEqual(moreItems({ level: 'simple', flags: { tasks: true } }), ['away'], 'Find tasks is Advanced, like the task source picker');
  assert.deepEqual(moreItems({ level: 'advanced', flags: {} }), ['away', 'workspace', 'remember'], 'no plugin task source: no Find tasks');
  assert.deepEqual(moreItems({ level: 'advanced', flags: { tasks: true } }), ['away', 'workspace', 'remember', 'tasks']);
  assert.deepEqual(moreItems({ level: 'expert', flags: { tasks: true } }), ['away', 'metrics', 'model', 'workspace', 'remember', 'tasks']);
  const s = setup({ level: 'simple' });
  s.more().click();
  assert.equal(s.menu().getAttribute('aria-label'), 'More actions');
  assert.deepEqual(s.items().map((b) => b.textContent), ['Step away']);
  s.items()[0].click();
  assert.deepEqual(s.calls.slice(-2), [['setIntent', 'away', null], ['prefill', "I'm away now"]],
    'Step away arrives with its text: an empty composer never sends');
  const e = setup({ level: 'expert' });
  e.actions.setFlags({ tasks: true });
  e.more().click();
  assert.deepEqual(e.items().map((b) => b.textContent), ['Step away', 'Team metrics', 'Add a model', 'New workspace', 'Remember something', 'Find tasks']);
  e.more().click();
  assert.equal(e.menu(), null, 'More toggles');
});

test('switches: script tools off hides Write a script; Add project has no off switch; task sources default to unknown = off', () => {
  const s = setup();
  assert.equal(s.tile('script').hidden, false, 'DEFAULT_FLAGS: script tools on until told otherwise');
  s.actions.setFlags({ scripts: false });
  assert.equal(s.tile('script').hidden, true);
  s.actions.setFlags({ scripts: true });
  assert.equal(s.tile('script').hidden, false);
  assert.deepEqual({ ...DEFAULT_FLAGS }, { scripts: true, tasks: false });
  assert.equal(actionAvailable('project', { scripts: false, tasks: false }), true);
  assert.equal(actionAvailable('tasks', {}), false);
  assert.equal(actionAvailable('tasks', { tasks: true }), true);
  assert.equal(actionAvailable('script', {}), true);
});

test('default pin: Shaper is the 2nd tile (right after New run), with no badge, and arms the shape intent', () => {
  const s = setup();
  s.actions.setPins({ pins: DEFAULT_HOME_PINS, workflows: WF });
  const t = s.tile('shape');
  assert.equal(t.dataset.pin, 'wf_shape');
  assert.equal(t.dataset.minLevel, 'simple');
  assert.equal(t.querySelector('.chat-home-act-l').textContent, 'Shaper');
  assert.equal(t.querySelector('.chat-home-act-help'), null);
  assert.equal(t.querySelector('.chat-home-act-badge'), null, 'Shaper is no longer beta');
  assert.equal(s.tile('run').querySelector('.chat-home-act-badge'), null);
  assert.equal(t.previousElementSibling, s.tile('run'), 'pins sit right after New run (priority order)');
  t.click();
  assert.deepEqual(s.calls, [['setIntent', 'shape', null]]);
  s.actions.setFlags({ scripts: false, tasks: true });
  assert.ok(s.tile('shape'), 'a flag push keeps the Shaper pin');
  assert.equal(actionAvailable('shape', {}), true);
  assert.ok(!MORE_INTENTS.includes('shape'), 'a pin, never also a built-in More item');
});

test('a pinned workflow tile shows its name and icon and arms New run with that workflow — nothing sent', () => {
  const s = setup();
  s.actions.setPins({ pins: ['wf_pay'], workflows: WF });
  const [t] = pinTiles(s);
  assert.equal(t.dataset.pin, 'wf_pay');
  assert.equal(t.querySelector('.chat-home-act-l').textContent, 'Payroll close');
  assert.equal(t.title, 'Payroll close');
  assert.ok(t.classList.contains('is-pin'));
  assert.ok(t.querySelector('.chat-ic svg'));
  t.click();
  assert.deepEqual(s.calls, [['setIntent', 'run', { workflow: { id: 'wf_pay', name: 'Payroll close' } }]]);
  assert.equal(s.menu(), null);
});

test('one pin inline; the rest go into More under Pinned in pin order; a deleted pin never shows', () => {
  const s = setup();
  s.actions.setPins({ pins: ['wf_gone', 'wf_shape', 'wf_post', 'wf_pay'], workflows: WF });
  assert.deepEqual(pinTiles(s).map((b) => b.dataset.pin), ['wf_shape']);
  assert.equal(s.doc.querySelectorAll('.chat-home-act').length, 9, 'the row keeps today\'s width');
  s.more().click();
  const labels = [...s.doc.querySelectorAll('.wfv-menu [role="menuitem"], .wfv-menu-h')].map((n) => n.textContent);
  assert.deepEqual(labels.slice(-3), ['Pinned', 'Social post', 'Payroll close']);
  s.items().at(-1).click();
  assert.deepEqual(s.calls.at(-1), ['setIntent', 'run', { workflow: { id: 'wf_pay', name: 'Payroll close' } }]);
});

test('right-click (or Shift+F10) on a pinned tile opens Unpin; picking it saves the list without that pin', async () => {
  const s = setup();
  s.actions.setPins({ pins: ['wf_pay', 'wf_post'], workflows: WF });
  const [t] = pinTiles(s);
  t.dispatchEvent(new (win(s).MouseEvent)('contextmenu', { bubbles: true, cancelable: true }));
  assert.deepEqual(s.items().map((b) => b.textContent), ['Unpin']);
  s.items()[0].click();
  assert.deepEqual(pinTiles(s).map((b) => b.dataset.pin), ['wf_post'], 'the next pin moves in at once');
  assert.deepEqual(s.calls.at(-1), ['savePins', ['wf_post']]);
  assert.equal(s.doc.activeElement, pinTiles(s)[0], 'focus moves to the pin that took the slot, not to body');
  pinTiles(s)[0].dispatchEvent(new (win(s).KeyboardEvent)('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
  assert.deepEqual(s.items().map((b) => b.textContent), ['Unpin']);
  s.items()[0].click();
  assert.deepEqual(pinTiles(s), []);
  assert.equal(s.doc.activeElement, s.more(), 'no pin left: focus moves to More');
});

test('a flag change while a pin menu is open closes that menu and keeps the focus on the same pin', () => {
  const s = setup();
  s.actions.setPins({ pins: ['wf_pay'], workflows: WF });
  pinTiles(s)[0].dispatchEvent(new (win(s).MouseEvent)('contextmenu', { bubbles: true, cancelable: true }));
  assert.ok(s.menu());
  assert.equal(pinTiles(s)[0].getAttribute('aria-haspopup'), 'menu');
  s.actions.setFlags({ scripts: true });   // re-renders the pins: the old anchor is gone
  assert.equal(s.menu(), null);
  assert.equal(s.doc.activeElement, pinTiles(s)[0], 'the rebuilt wf_pay tile, not body');
  assert.equal(s.doc.activeElement.dataset.pin, 'wf_pay');
});

test('Shift+F10 followed by the contextmenu event the same key fires leaves one menu open', () => {
  const s = setup();
  s.actions.setPins({ pins: ['wf_pay'], workflows: WF });
  const t = pinTiles(s)[0];
  t.dispatchEvent(new (win(s).KeyboardEvent)('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
  t.dispatchEvent(new (win(s).MouseEvent)('contextmenu', { bubbles: true, cancelable: true }));
  assert.ok(s.menu(), 'the second event does not toggle the menu shut');
  assert.deepEqual(s.items().map((b) => b.textContent), ['Unpin']);
});

test('a failed save puts the unpinned tile back', async () => {
  const s = setup({ savePins: async () => null });
  s.actions.setPins({ pins: ['wf_pay'], workflows: WF });
  pinTiles(s)[0].dispatchEvent(new (win(s).MouseEvent)('contextmenu', { bubbles: true, cancelable: true }));
  s.items()[0].click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(pinTiles(s).map((b) => b.dataset.pin), ['wf_pay']);
});

test('runMention: the title in quotes and the run id when known', () => {
  assert.equal(runMention({ title: 'X', pipelineId: 'p1', runId: 'r1' }), '“X” (#p1)');
  assert.equal(runMention({ title: '', runId: 'r1' }), '“Run” (#r1)');
  assert.equal(runMention({ title: 'Y' }), '“Y”');
});

test('the picker tiles and More say they are collapsed before their first menu opens; a plain tile has no popup state', () => {
  const s = setup();
  assert.equal(s.tile('track').getAttribute('aria-expanded'), 'false');
  assert.equal(s.tile('diff').getAttribute('aria-expanded'), 'false');
  assert.equal(s.more().getAttribute('aria-expanded'), 'false');
  assert.equal(s.tile('run').hasAttribute('aria-expanded'), false);
});

test('an empty picker closes on Escape from its tile; closing a menu the focus is in hands the focus back to its tile', () => {
  const s = setup();
  s.tile('diff').click();
  assert.deepEqual(s.items().map((b) => b.disabled), [true], 'only the disabled "No finished runs" row: nothing in the menu takes the focus');
  const esc = new s.doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  s.tile('diff').dispatchEvent(esc);
  assert.equal(s.menu(), null, 'the row closes it');
  assert.equal(esc.defaultPrevented, true);
  assert.equal(s.tile('diff').getAttribute('aria-expanded'), 'false');
  const free = new s.doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  s.tile('diff').dispatchEvent(free);
  assert.equal(free.defaultPrevented, false, 'no menu open: Escape is left to the page');
  s.more().click();
  assert.equal(s.doc.activeElement, s.items()[0], 'the More menu took the focus');
  s.actions.closeMenu();                                            // what a scroll of the home does
  assert.equal(s.menu(), null);
  assert.equal(s.doc.activeElement, s.more(), 'back on its tile, never <body>');
});

test('only a workflow pin label shrinks: a badged pin keeps its name whole (web UI review 1)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /^\.chat-home-act-l\{flex:none;white-space:nowrap;\}$/m);
  const shrink = css.match(/^(\.chat-home-act\.is-pin[^{]*) \.chat-home-act-l\{[^}]*flex:0 1 auto;[^}]*\}$/m);
  assert.ok(shrink, 'the workflow pin label rule exists');
  assert.equal(shrink[1], '.chat-home-act.is-pin:not(:has(> .chat-home-act-badge))');
});

test('one row: a tile badge sits inline after its label at normal size and never truncates', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const rule = css.match(/^\.chat-home-act-badge\{([^}]*)\}/m)[1];
  assert.match(rule, /white-space:nowrap/);
  assert.match(rule, /font-size:var\(--fs-caption\)/);
  assert.doesNotMatch(rule, /grid-area/);
  assert.doesNotMatch(rule, /text-overflow|overflow:hidden|max-width/);
  assert.doesNotMatch(css, /\.chat-home-act:has\(> \.chat-home-act-badge\)\{display:grid/, 'one row: the badge sits inline after the label');
  assert.doesNotMatch(css, /\.chat-home-act-badge\{font-size:8\.5px/, 'no compact badge');
  assert.doesNotMatch(css, /@container chat-home \(max-width:960px\)/);
});

test('the tile keeps its height in the narrow container too', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const narrow = css.match(/^@container chat-home \(max-width:440px\)\{([^\n]*)\}$/m)[1];
  assert.doesNotMatch(narrow, /\.chat-home-act\{/, 'the tile keeps its height in the narrow container too');
});

// One row (priority+): jsdom has no layout, so each visible tile is given 100px and the row a fixed width.
function fakeLayout(s, rowWidth) {
  const visible = (b) => !b.hidden && !('overflow' in b.dataset);
  for (const b of s.doc.querySelectorAll('.chat-home-act')) Object.defineProperty(b, 'offsetParent', { configurable: true, get: () => (visible(b) ? s.doc.body : null) });
  Object.defineProperty(s.actions.el, 'clientWidth', { configurable: true, get: () => rowWidth });
  Object.defineProperty(s.actions.el, 'scrollWidth', { configurable: true, get: () => [...s.doc.querySelectorAll('.chat-home-act')].filter(visible).length * 100 });
}

test('one row: tiles that do not fit move into the top of More, from the end of the row; New run, the pin and More stay', () => {
  const s = setup();
  s.actions.setPins({ pins: DEFAULT_HOME_PINS, workflows: WF });
  fakeLayout(s, 700);                                 // 9 tiles × 100px in 700px: 2 have to go
  s.actions.fit();
  const hidden = [...s.doc.querySelectorAll('.chat-home-act[data-overflow]')].map((b) => b.dataset.intent || b.dataset.action);
  assert.deepEqual(hidden, ['script', 'project'], 'the tail goes first');
  assert.equal(s.tile('run').dataset.overflow, undefined);
  assert.equal(s.tile('shape').dataset.overflow, undefined, 'a pin never overflows');
  s.more().click();
  assert.deepEqual(s.items().slice(0, 2).map((i) => i.textContent), ['Write a script', 'Add project'], 'overflowed tiles lead More, in row order');
  s.items()[1].click();
  assert.deepEqual(s.calls.at(-1), ['addProject'], 'Add project from More opens the dialog, as its tile does');
});

test('one row: a wide row shows every tile, and a narrow (phone grid) home never hides any', () => {
  const s = setup();
  fakeLayout(s, 1200);
  s.actions.fit();
  assert.equal(s.doc.querySelectorAll('.chat-home-act[data-overflow]').length, 0);
  fakeLayout(s, 600);
  s.actions.fit();
  assert.equal(s.doc.querySelectorAll('.chat-home-act[data-overflow]').length, 0, 'the 2-column grid below 640px shows all');
});
