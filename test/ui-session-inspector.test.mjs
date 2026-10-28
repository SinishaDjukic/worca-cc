// test/ui-session-inspector.test.mjs — the session panel says what runs where, and promises nothing the gate denies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSessionInspector } from '../ui/public/graph/inspector.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const spec = { sid: 's_aaaaaaaa', members: ['n_impl', 'n_review'], closure: ['n_impl', 'n_review'], flows: [], internalWires: [], entryWires: [], exitWires: [], crossingLoops: [],
  settings: { label: 'One session', mode: 'subagents', hostModel: null, hostEffort: null } };
const labels = { n_impl: 'Implementation', n_review: 'Review Implementation' };
const base = { template: { nodes: [], wires: [] }, labels, models: [], efforts: ['low', 'high'], doc };

test('gate open: Sub-agents is offered; fields carry data-field; the explainer never promises savings', () => {
  const el = renderSessionInspector(spec, { ...base, engine: 'claude', verified: { claude: true } });
  assert.equal(el.querySelector('[data-field="label"]').value, 'One session');
  assert.ok([...el.querySelectorAll('.seg button')].some((b) => b.textContent === 'Sub-agents'));
  assert.equal(el.querySelector('[data-field="hostModel"]').closest('[data-min-level]').dataset.minLevel, 'advanced');
  // "loop limits" is the explainer's own phrase; the ban is on savings and quota promises (X5).
  assert.doesNotMatch(el.textContent, /cache|cheaper|faster|cold start|usage limit|rate limit|subscription/i);
  assert.match(el.textContent, /worca still decides what runs next, so files, loop limits and reviews work as they do today\./);
  assert.deepEqual([...el.querySelectorAll('.ins-steps li .lbl')].map((x) => x.textContent), ['Implementation', 'Review Implementation']);
});

test('gate closed: no "Sub-agents" button, the honest line instead', () => {
  const el = renderSessionInspector(spec, { ...base, engine: 'claude', verified: { claude: false } });
  assert.equal([...el.querySelectorAll('.seg button')].some((b) => b.textContent === 'Sub-agents'), false);
  assert.match(el.textContent, /Separate sessions \(sub-agents not available yet\)/);
  assert.match(el.textContent, /Sub-agents are not available on Claude yet: these steps run as separate sessions\./);
});

test('One conversation is expert-only', () => {
  const el = renderSessionInspector(spec, { ...base, engine: 'claude', verified: { claude: true } });
  const shared = [...el.querySelectorAll('.seg button')].find((b) => b.textContent === 'One conversation');
  assert.equal(shared.dataset.minLevel, 'expert');
});

// ── the composer side: inspectorFor routes {kind:'session'}; data-field and data-sess-* map to composer.sessions ──
const { open } = await import('./helpers/composer-shell.mjs');
const { SESSION_SUBAGENTS_VERIFIED } = await import('../src/shared/engine-switch.mjs');
const { SESSION_SHARED_SELECTABLE } = await import('../src/shared/graph/sessions.mjs');
const { loopFixture } = await import('./helpers/graph-view-fixture.mjs');
const fire = (el, type) => el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
const clickEl = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const sidOf = (c, id) => c.template().nodes.find((n) => n.id === id).config.session;
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

test('composer: a selected session shows the panel; Name and Main agent fields commit through setSetting', async () => {
  const { c, el, doc } = await open({ template: loopFixture() });
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.select({ kind: 'session', id: sid });
  const body = el.insBody;
  assert.equal(body.querySelector('.ins-session').dataset.sessionId, sid);
  // The Labs flag is off here: separate sessions whatever the gate (C14), and the note names the flag, not the engine.
  assert.ok(body.querySelector('.ins-note[data-code="flag-off"]'));
  assert.equal(body.querySelector('.ins-note[data-code="gate-off"]'), null);
  assert.equal([...body.querySelectorAll('.seg button')].some((b) => b.textContent === 'Sub-agents'), false);
  doc.documentElement.dataset.flags = 'sessionGroups';
  c.paintInspector();
  // Flag on: the gate decides. Compare to the shipped constant, never pin it (gate-pins rule: Task 53 flips it).
  assert.equal(Boolean(body.querySelector('.ins-note[data-code="gate-off"]')), SESSION_SUBAGENTS_VERIFIED.claude !== true);
  const name = body.querySelector('[data-field="label"]');
  name.value = 'Build and review';
  fire(name, 'change');
  assert.deepEqual(c.template().sessions, { [sid]: { label: 'Build and review' } });
  const again = body.querySelector('[data-field="label"]');
  again.value = '  Build and review  ';
  fire(again, 'change');
  assert.equal(body.querySelector('[data-field="label"]').value, 'Build and review', 'a value that changes nothing is read back, as a node field is');
  const effort = body.querySelector('[data-field="hostEffort"]');
  effort.value = 'high';
  fire(effort, 'change');
  assert.deepEqual(c.template().sessions[sid], { label: 'Build and review', hostEffort: 'high' });
  clickEl(body.querySelector('[data-sess-mode="shared"]'));
  assert.equal(c.template().sessions[sid].mode, SESSION_SHARED_SELECTABLE ? 'shared' : undefined, 'Task 66 flips SESSION_SHARED_SELECTABLE');
});

test('composer: a member\'s row selects its session or leaves it', async () => {
  const { c, el } = await open({ template: loopFixture() });
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.select({ kind: 'node', id: 'n_rev' });
  assert.equal(el.insBody.querySelector('.ins-member-t').textContent, 'In One session · step 2 of 2');
  clickEl(el.insBody.querySelector('[data-sess-select]'));
  assert.deepEqual(c.selection(), { kind: 'session', id: sid });
  c.select({ kind: 'node', id: 'n_rev' });
  clickEl(el.insBody.querySelector('.ins-member [data-sess-leave]'));
  assert.equal(sidOf(c, 'n_agent'), undefined, 'two steps less one: the session dissolves');
  assert.equal(el.insBody.querySelector('.ins-member'), null);
});

test('composer: + Add joins the offered step (flag on only); × leaves; Split and Ungroup act', async () => {
  const s = await open({ template: chain() });
  const { c, el, doc } = s;
  const sid = c.sessions.join('n_a', 'n_b').sid;
  c.select({ kind: 'session', id: sid });
  assert.equal(el.insBody.querySelector('[data-sess-add]'), null, 'the Labs flag is off: no creation control');
  doc.documentElement.dataset.flags = 'sessionGroups';
  c.paintInspector();
  const add = el.insBody.querySelector('[data-sess-add]');
  assert.equal(add.textContent, 'Add planner · next');
  clickEl(add);
  assert.equal(sidOf(c, 'n_c'), sid);
  clickEl(el.insBody.querySelector('.ins-step[data-step-id="n_b"] [data-sess-leave]'));
  assert.equal(sidOf(c, 'n_b'), undefined);
  await new Promise((r) => setTimeout(r, 0));                   // V27: n_a and n_c are not wired together
  // No manual repaint: the validation pass repaints a session panel, so Split appears by itself (correction 53).
  clickEl(el.insBody.querySelector('[data-sess-act="split"]'));
  assert.equal(sidOf(c, 'n_a'), undefined, 'no consecutive pair: Split ungroups');
  const sid2 = c.sessions.join('n_a', 'n_b').sid;
  c.select({ kind: 'session', id: sid2 });
  assert.equal(el.insBody.querySelector('[data-sess-act="split"]'), null, 'no V27: no Split');
  clickEl(el.insBody.querySelector('[data-sess-act="ungroup"]'));
  assert.equal(sidOf(c, 'n_a'), undefined);
  assert.deepEqual(c.selection(), { kind: 'node', id: 'n_a' });
});

test('composer, the gate open (Task 53): Sub-agents only while the Labs flag is on; off, the panel names the flag', async () => {
  const { c, el, doc } = await open({ template: loopFixture(), sessionVerified: { claude: true } });
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.select({ kind: 'session', id: sid });
  const seg = () => [...el.insBody.querySelectorAll('.seg button')].map((b) => b.textContent);
  assert.equal(seg().includes('Sub-agents'), false);
  assert.match(el.insBody.textContent, /Separate sessions \(off in Settings › Labs\)/);
  assert.ok(el.insBody.querySelector('.ins-note[data-code="flag-off"]'));
  doc.documentElement.dataset.flags = 'sessionGroups';
  c.paintInspector();
  assert.equal(seg().includes('Sub-agents'), true);
  assert.equal(el.insBody.querySelector('.ins-note[data-code="flag-off"]'), null);
  assert.equal(el.insBody.querySelector('.ins-note[data-code="gate-off"]'), null);
});

test('Name keeps to the label limit; the main agent\'s efforts follow its model; shared mode has no main-agent hint', async () => {
  const { SESSION_LABEL_MAX } = await import('../src/shared/graph/constants.mjs');
  const el = renderSessionInspector({ ...spec, settings: { ...spec.settings, hostModel: 'm_small', hostEffort: 'max' } },
    { ...base, models: [{ id: 'm_small', label: 'Small', efforts: ['low'] }], verified: { claude: true } });
  assert.equal(el.querySelector('[data-field="label"]').maxLength, SESSION_LABEL_MAX);
  assert.deepEqual([...el.querySelector('[data-field="hostEffort"]').options].map((o) => o.value), ['', 'low', 'max'], 'a saved value the model lacks stays visible');
  // One conversation has no main agent (Task 66 makes the mode reachable): the small-model hint is for sub-agents only.
  const sh = renderSessionInspector({ ...spec, settings: { ...spec.settings, mode: 'shared' } }, { ...base, verified: { claude: true } });
  assert.doesNotMatch(sh.textContent, /A small model is enough/);
});

test('composer: Select session in the popover hands the focus to the strip, never <body>', async () => {
  const { bootShell, loopFixture: shellFixture } = await import('./helpers/workflows-shell.mjs');
  const s = await bootShell({ template: shellFixture(), flags: 'sessionGroups' });
  const sid = s.c.sessions.join('n_agent', 'n_rev').sid;
  s.c.select({ kind: 'node', id: 'n_rev' });
  clickEl(s.doc.querySelector('[data-tb="more"]'));               // the inspector popover (shell.mjs openPopover)
  const pick = s.doc.querySelector('.wfv-pop [data-sess-select]');
  pick.focus();
  clickEl(pick);
  assert.deepEqual(s.c.selection(), { kind: 'session', id: sid });
  assert.equal(s.doc.querySelector('.wfv-pop'), null, 'the new selection closed the popover, and the button with it');
  assert.equal(s.doc.activeElement, s.c.view.stage.querySelector(`.gv-sess-head[data-session-id="${sid}"]`), 'a Delete now reaches the strip');
});
