// test/ui-chat-home-actions.test.mjs — worca Chat P6: the home's quick actions. Seven intent tiles + More in the
// mockup's order, each gated like the page that owns its feature; a tile only arms the composer; Track a run and
// Explain a diff open a Live / Finished run picker whose pick prefills a run mention; switched-off features hide.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createQuickActions, moreItems, actionAvailable, runMention, TILE_INTENTS, MORE_INTENTS, ACTION_LEVEL, DEFAULT_FLAGS, PICKER_MAX,
} from '../ui/public/chat/home-actions.mjs';

const trackDom = useDomRelease(afterEach);

function setup({ runs = { live: [], finished: [] }, level = 'expert' } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><body></body>'));
  const doc = dom.window.document;
  const calls = [];
  const deps = {
    setIntent: (id, opts) => calls.push(['setIntent', id, opts || null]),
    prefill: (text) => calls.push(['prefill', text]),
    level: () => level,
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

test('nine tiles in the mockup order — eight intents and More — each naming its interface level', () => {
  const s = setup();
  const tiles = [...s.doc.querySelectorAll('.chat-home-act')];
  assert.deepEqual(tiles.map((b) => b.textContent), ['New run',
    'Plan it with meAgree on what gets built before anything runs · ~3 minNew', 'Build workflow', 'Schedule a run', 'Track a run',
    'Explain a diff', 'Write a script', 'Clone a repo', 'More']);
  assert.deepEqual(tiles.map((b) => b.dataset.minLevel), ['simple', 'simple', 'simple', 'advanced', 'simple', 'advanced', 'simple', 'simple', 'simple']);
  assert.ok(tiles.every((b) => b.type === 'button' && b.querySelector('.chat-ic svg')));
  assert.equal(s.actions.el.getAttribute('role'), 'group');
  assert.equal(s.actions.el.getAttribute('aria-label'), 'Quick actions');
  assert.equal(s.more().getAttribute('aria-haspopup'), 'menu');
  assert.deepEqual([...TILE_INTENTS], ['run', 'shape', 'workflow', 'schedule', 'track', 'diff', 'script', 'clone']);
  assert.deepEqual([...MORE_INTENTS], ['away', 'metrics', 'model', 'workspace', 'remember', 'tasks']);
  assert.equal(ACTION_LEVEL.metrics, 'expert', 'Team metrics is gated like its page');
  assert.equal(ACTION_LEVEL.tasks, 'advanced', 'Find tasks is gated like the task source picker');
});

test('a tile only arms the composer: setIntent, focus on the composer, nothing sent, no menu', () => {
  const s = setup();
  s.tile('run').click();
  s.tile('clone').click();
  assert.deepEqual(s.calls, [['setIntent', 'run', null], ['setIntent', 'clone', null]]);
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

test('switches: script tools off hides Write a script; Clone has no off switch; task sources default to unknown = off', () => {
  const s = setup();
  assert.equal(s.tile('script').hidden, false, 'DEFAULT_FLAGS: script tools on until told otherwise');
  s.actions.setFlags({ scripts: false });
  assert.equal(s.tile('script').hidden, true);
  s.actions.setFlags({ scripts: true });
  assert.equal(s.tile('script').hidden, false);
  assert.deepEqual({ ...DEFAULT_FLAGS }, { scripts: true, tasks: false, shapeFirst: false });
  assert.equal(actionAvailable('clone', { scripts: false, tasks: false }), true);
  assert.equal(actionAvailable('tasks', {}), false);
  assert.equal(actionAvailable('tasks', { tasks: true }), true);
  assert.equal(actionAvailable('script', {}), true);
});

test('Plan it with me: hidden until the Shape it first flag is on, with its help line and New badge; re-pushed flags keep the others', () => {
  const s = setup();
  const t = s.tile('shape');
  assert.equal(t.hidden, true, 'DEFAULT_FLAGS: the gate is off until the hello says otherwise');
  assert.equal(t.dataset.minLevel, 'simple');
  assert.equal(t.querySelector('.chat-home-act-l').textContent, 'Plan it with me');
  assert.equal(t.querySelector('.chat-home-act-help').textContent, 'Agree on what gets built before anything runs · ~3 min');
  assert.equal(t.querySelector('.chat-home-act-badge').textContent, 'New');
  assert.equal(s.tile('run').querySelector('.chat-home-act-help'), null, 'only an intent with a help line gets one');
  assert.equal(s.tile('run').querySelector('.chat-home-act-badge'), null);
  s.actions.setFlags({ shapeFirst: false });
  assert.equal(t.hidden, true);
  const loaded = { scripts: false, tasks: true };
  s.actions.setFlags(loaded);
  assert.equal(t.hidden, true);
  const pushed = { ...loaded, shapeFirst: true };
  s.actions.setFlags(pushed);
  assert.equal(t.hidden, false);
  assert.equal(s.tile('script').hidden, true, 'scripts keeps its state when the flags are re-pushed with the spread');
  assert.equal(actionAvailable('tasks', pushed), true, 'tasks keeps its state');
  s.actions.setFlags({});
  assert.equal(t.hidden, true);
  assert.equal(actionAvailable('shape', {}), false);
  assert.equal(actionAvailable('shape', { shapeFirst: true }), true);
  t.click();
  assert.deepEqual(s.calls, [['setIntent', 'shape', null]], 'a tile only arms the composer');
  assert.ok(!MORE_INTENTS.includes('shape'), 'a tile, never also in More');
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
