// test/ui-workflows-session-menu.test.mjs — the toolbar entry point, behind the Labs flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAGS, registryProblems } from '../src/shared/flags/registry.mjs';
import { SESSION_SUBAGENTS_VERIFIED } from '../src/shared/engine-switch.mjs';
import * as sessionsMod from '../src/shared/graph/sessions.mjs';   // a namespace: SESSION_SHARED_SELECTABLE lands in Step 3
import { bootShell, loopFixture } from './helpers/workflows-shell.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const rows = (doc) => [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')]
  .map((b) => [b.querySelector('.wfv-menu-l').textContent, b.getAttribute('aria-disabled') === 'true']);

test('the flag entry is well-formed, experimental and off by default', () => {
  const f = FLAGS.find((x) => x.key === 'sessionGroups');
  assert.ok(f);
  assert.equal(f.stage, 'experimental');
  assert.equal(f.default, false);
  assert.deepEqual(registryProblems(FLAGS, { today: '2026-10-28' }), []);
  assert.doesNotMatch(f.description, /^Run .* as sub-agents/, 'no promise of sub-agents while the gate may be off (spec §8)');
  assert.match(f.description, /otherwise as separate sessions/);
});

test('flag on: the One session button lists the legal next step, then member actions once joined', async () => {
  const s = await bootShell({ template: loopFixture(), flags: 'sessionGroups' });
  s.c.select({ kind: 'node', id: 'n_agent' });
  const b = s.doc.querySelector('[data-tb="session"]');
  assert.equal(b.dataset.flag, 'sessionGroups');
  assert.match(b.textContent, /One session/);
  click(b);
  assert.deepEqual(rows(s.doc), [['Plan', false]]);          // n_rev ("Plan"), side "next"
  click(s.doc.querySelector('.wfv-menu-item'));
  assert.ok(s.c.template().nodes.find((n) => n.id === 'n_rev').config.session);
  s.c.select({ kind: 'node', id: 'n_agent' });
  click(s.doc.querySelector('[data-tb="session"]'));
  assert.deepEqual(rows(s.doc).map((r) => r[0]), ['Select session', 'Leave session', 'Ungroup']);
});

test('flag off: no button (C14)', async () => {
  const s = await bootShell({ template: loopFixture(), flags: '' });
  s.c.select({ kind: 'node', id: 'n_agent' });
  assert.equal(s.doc.querySelector('[data-tb="session"]'), null);
});

// ── corrections: every branch the plan pins has its own case ──
const tick = () => new Promise((r) => setTimeout(r, 0));
const key = (doc, k, mods = {}) => doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }));
const tb = (s, k) => s.doc.querySelector(`[data-tb="${k}"]`);
/** n_task → n_a → n_b → n_c → n_end: three Plan steps in a chain. */
function chain() {
  const t = loopFixture();
  t.nodes = t.nodes.filter((n) => n.id === 'n_task' || n.id === 'n_end');
  for (const [id, x] of [['n_a', 400], ['n_b', 720], ['n_c', 1040]]) t.nodes.push({ id, kind: 'agent', key: 'planner', x, y: 80, config: {} });
  t.nodes.find((n) => n.id === 'n_end').x = 1360;
  t.wires = [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
    { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_b', port: 'task' } },
    { id: 'w3', from: { node: 'n_b', port: 'plan' }, to: { node: 'n_c', port: 'task' } },
    { id: 'w4', from: { node: 'n_c', port: 'plan' }, to: { node: 'n_end', port: 'result' } }];
  return t;
}

test('an illegal neighbour is listed disabled with its reason; a member\'s button says "Session i of n"', async () => {
  const t = chain();
  for (const id of ['n_b', 'n_c']) t.nodes.find((n) => n.id === id).config.session = 's_bbbbbbbb';
  const s = await bootShell({ template: t, flags: 'sessionGroups' });
  s.c.select({ kind: 'node', id: 'n_a' });
  click(tb(s, 'session'));
  assert.deepEqual(rows(s.doc), [['Plan', true]]);
  assert.equal(s.doc.querySelector('.wfv-menu-hint').textContent, 'in another session');
  s.c.select({ kind: 'node', id: 'n_c' });
  assert.match(tb(s, 'session').textContent, /Session 2 of 2/);
});

test('flag off: ⌘G creates nothing and stays the browser\'s; flag on: ⌘G with no legal next step opens the menu', async () => {
  const off = await bootShell({ template: loopFixture(), flags: '' });
  const press = (doc, mods) => { const e = new doc.defaultView.KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true, ...mods }); doc.dispatchEvent(e); return e.defaultPrevented; };
  off.c.select({ kind: 'node', id: 'n_agent' });
  assert.equal(press(off.doc, { metaKey: true }), false, 'flag off: ⌘G is the browser\'s Find next, exactly as before');
  assert.equal(press(off.doc, { metaKey: true, shiftKey: true }), false, 'and ⇧⌘G its Find previous');
  assert.equal(off.c.template().nodes.find((n) => n.id === 'n_agent').config.session, undefined);
  const s = await bootShell({ template: loopFixture(), flags: 'sessionGroups' });
  s.c.select({ kind: 'node', id: 'n_rev' });                     // its only neighbour is the previous step
  assert.equal(press(s.doc, { metaKey: true }), true, 'flag on: the canvas owns ⌘G');
  assert.deepEqual(rows(s.doc), [['Plan', false]]);
  assert.equal(s.doc.querySelector('.wfv-menu-hint').textContent, 'previous');
  assert.equal(s.c.template().nodes.find((n) => n.id === 'n_rev').config.session, undefined, 'the menu, not a join');
});

test('the session toolbar: label, How, Main agent, Effort, Ungroup, More; One conversation follows SESSION_SHARED_SELECTABLE and is not level-gated', async () => {
  const s = await bootShell({ template: loopFixture(), flags: 'sessionGroups' });
  const sid = s.c.sessions.join('n_agent', 'n_rev').sid;
  s.c.select({ kind: 'session', id: sid });
  const bar = s.doc.querySelector('.wfv-tb');
  assert.equal(bar.getAttribute('aria-label'), 'Session settings');
  assert.equal(bar.querySelector('.k').textContent, 'One session · 2 steps');
  assert.deepEqual([...bar.querySelectorAll('[data-tb]')].map((b) => b.dataset.tb), ['sessMode', 'sessModel', 'sessEffort', 'sessUngroup', 'more']);
  // Compare to the shipped gate, never pin it (gate-pins rule: Task 53 flips it); no sub-agents promised while it is shut.
  assert.match(tb(s, 'sessMode').textContent, SESSION_SUBAGENTS_VERIFIED.claude === true ? /How Sub-agents/ : /How Separate sessions/);
  click(tb(s, 'sessMode'));
  const shared = [...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.includes('One conversation'));
  assert.equal(shared.dataset.minLevel, undefined, 'nothing in the Workflows view is level-gated (docs/ui-levels.md)');
  assert.equal(shared.getAttribute('aria-disabled') === 'true', !sessionsMod.SESSION_SHARED_SELECTABLE, 'Task 66 flips SESSION_SHARED_SELECTABLE');
  assert.equal(shared.querySelector('.wfv-menu-hint')?.textContent ?? null, sessionsMod.SESSION_SHARED_SELECTABLE ? null : 'not available yet', 'the reason shows, not only in a title');
  s.c.sessions.setSetting(sid, 'hostEffort', 'max');
  const d0 = s.c.undoDepth();
  click(tb(s, 'sessModel'));
  click([...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.includes('Haiku 4.5')));
  assert.deepEqual(s.c.template().sessions, { [sid]: { hostModel: 'claude-haiku-4-5' } }, 'Haiku 4.5 has no max: the pick drops it');
  assert.equal(s.c.undoDepth(), d0 + 1, 'in the same commit');
  assert.match(tb(s, 'sessModel').textContent, /Main agent Haiku 4\.5/);
  click(tb(s, 'sessEffort'));
  assert.deepEqual(rows(s.doc).map((r) => r[0]), ['default', 'medium', 'high'], 'Haiku 4.5\'s efforts, not the whole catalog\'s');
  click([...s.doc.querySelectorAll('.wfv-menu-item')].find((b) => b.textContent.trim() === 'high'));
  assert.equal(s.c.template().sessions[sid].hostEffort, 'high');
  click(tb(s, 'sessUngroup'));
  assert.equal(s.c.template().nodes.find((n) => n.id === 'n_agent').config.session, undefined);
  assert.equal(s.c.template().sessions, undefined);
});

test('flag off: a saved session keeps its toolbar, and it says separate sessions whatever the gate (C14)', async () => {
  const t = loopFixture();
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  const s = await bootShell({ template: t, flags: '' });
  s.c.select({ kind: 'session', id: 's_aaaaaaaa' });
  assert.match(tb(s, 'sessMode').textContent, /How Separate sessions/);
  click(tb(s, 'sessMode'));
  assert.deepEqual(rows(s.doc).map((r) => r[0]), ['Separate sessions', 'One conversation']);
  assert.equal(s.doc.querySelector('.wfv-menu-hint').textContent, 'off in Settings › Labs', 'the flag is the reason, not the engine');
});

test('Split shows while V27 fires, and keeps the longest consecutive run', async () => {
  const s = await bootShell({ template: chain(), flags: 'sessionGroups' });
  s.c.sessions.join('n_a', 'n_b');
  const sid = s.c.sessions.join('n_b', 'n_c').sid;
  s.c.select({ kind: 'session', id: sid });
  assert.equal(tb(s, 'sessSplit'), null, 'consecutive: no Split');
  s.c.sessions.leave('n_b');                                     // n_a and n_c are no longer wired together
  await tick();
  assert.equal(tb(s, 'sessSplit').getAttribute('aria-label'), null, 'its visible word is its name (WCAG 2.5.3); the title explains');
  click(tb(s, 'sessSplit'));
  assert.deepEqual(['n_a', 'n_b', 'n_c'].map((id) => s.c.template().nodes.find((n) => n.id === id).config.session), [undefined, undefined, undefined],
    'no consecutive pair is left: Split ungroups');
});

test('the view reads the Labs flag per render when the host passes no sessionsOn', async () => {
  const { boot, portsFn, AGENTS: A } = await import('./helpers/graph-view-fixture.mjs');
  const { createGraphView } = await import('../ui/public/graph/view.mjs');
  const { doc, host } = boot();
  const view = createGraphView(host, { doc, mode: 'edit', portsFn, agents: A, sessionVerified: { claude: true } });
  const t = loopFixture();
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  view.render(t, {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions');
  doc.documentElement.dataset.flags = 'sessionGroups';
  view.render(t, {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude · 2 sub-agents');
  // A Labs flip shows on the next render; a drag frame in between keeps the words and the chips in step.
  delete doc.documentElement.dataset.flags;
  view.moveNodes(['n_task']);
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude · 2 sub-agents');
  assert.ok(view.nodeEl('n_agent').querySelector('.nsess'));
  view.render(t, {});
  assert.equal(host.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions');
  assert.equal(view.nodeEl('n_agent').querySelector('.nsess'), null);
});

test('the gate open (Task 53): the Composer says sub-agents only while the Labs flag is on (C14)', async () => {
  const grouped = () => {
    const t = loopFixture();
    for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
    return t;
  };
  const on = await bootShell({ template: grouped(), flags: 'sessionGroups', sessionVerified: { claude: true } });
  assert.equal(on.c.view.stage.querySelector('.gv-sess-head .st').textContent, 'One session · Claude · 2 sub-agents');
  on.c.select({ kind: 'session', id: 's_aaaaaaaa' });
  assert.match(tb(on, 'sessMode').textContent, /How Sub-agents/);
  const off = await bootShell({ template: grouped(), flags: '', sessionVerified: { claude: true } });
  assert.equal(off.c.view.stage.querySelector('.gv-sess-head .st').textContent, 'One session · Claude: separate sessions');
  off.c.select({ kind: 'session', id: 's_aaaaaaaa' });
  assert.match(tb(off, 'sessMode').textContent, /How Separate sessions/);
  click(tb(off, 'sessMode'));
  assert.equal(off.doc.querySelector('.wfv-menu-hint').textContent, 'off in Settings › Labs');
});

test('Ungroup in the session toolbar hands the focus to the first step\'s card, never <body>', async () => {
  const s = await bootShell({ template: loopFixture(), flags: 'sessionGroups' });
  const sid = s.c.sessions.join('n_agent', 'n_rev').sid;
  s.c.select({ kind: 'session', id: sid });
  tb(s, 'sessUngroup').focus();
  click(tb(s, 'sessUngroup'));
  assert.deepEqual(s.c.selection(), { kind: 'node', id: 'n_agent' });
  assert.equal(s.doc.activeElement, s.c.view.nodeEl('n_agent'), 'a Delete now would not reach the canvas from <body>');
});
