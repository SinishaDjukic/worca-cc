// test/ui-composer-sessions.test.mjs — authoring a session on the canvas: one undo step per gesture, cards never deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from './helpers/composer-shell.mjs';
import { loopFixture } from './helpers/graph-view-fixture.mjs';
import { SESSION_ID_RE } from '../src/shared/graph/constants.mjs';

const key = (doc, k, mods = {}) => doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }));
const sidOf = (c, id) => c.template().nodes.find((n) => n.id === id).config.session;

test('join mints one id for both cards in one undo step; undo restores; ungroup keeps the cards', async () => {
  const { c } = await open({ template: loopFixture() });
  const depth = c.undoDepth();
  assert.equal(c.sessions.join('n_agent', 'n_rev').ok, true);
  const sid = sidOf(c, 'n_agent');
  assert.match(sid, SESSION_ID_RE);
  assert.equal(sidOf(c, 'n_rev'), sid);
  assert.equal(c.undoDepth(), depth + 1);
  c.undo();
  assert.equal(sidOf(c, 'n_agent'), undefined);
  c.redo();
  c.sessions.ungroup(sid);
  assert.equal(c.template().nodes.length, 4);
  assert.equal(sidOf(c, 'n_rev'), undefined);
});

test('⌘G joins the single next step; ⇧⌘G ungroups; Delete on a session ungroups, never deletes', async () => {
  const s = await open({ template: loopFixture() });
  const { c, doc } = s;
  doc.documentElement.dataset.flags = 'sessionGroups';            // ⌘G is a creation control: Task 24 gates it on the Labs flag
  c.select({ kind: 'node', id: 'n_agent' });
  key(doc, 'g', { metaKey: true });
  const sid = sidOf(c, 'n_agent');
  assert.match(sid, SESSION_ID_RE, '⌘G joined: without this the test passes with no code (undefined === undefined)');
  assert.equal(sidOf(c, 'n_rev'), sid);
  c.select({ kind: 'session', id: sid });
  key(doc, 'Delete');
  assert.equal(c.template().nodes.length, 4);
  assert.equal(sidOf(c, 'n_agent'), undefined);
  c.undo();
  key(doc, 'g', { metaKey: true, shiftKey: true });
  assert.equal(sidOf(c, 'n_agent'), undefined);
});

test('settings stay sparse and dirty compares them; an unchanged template keeps its saved hash', async () => {
  const { c } = await open({ template: loopFixture() });
  assert.equal(c.isDirty(), false);
  c.sessions.join('n_agent', 'n_rev');
  const sid = sidOf(c, 'n_agent');
  c.sessions.setSetting(sid, 'label', 'Build and review');
  assert.deepEqual(c.template().sessions, { [sid]: { label: 'Build and review' } });
  c.sessions.setSetting(sid, 'label', '');
  assert.equal(c.template().sessions, undefined);
});

test('deleting a member prunes a lone session; the error chip counts a V27 session issue', async () => {
  const { c } = await open({ template: loopFixture() });
  c.sessions.join('n_agent', 'n_rev');
  c.select({ kind: 'node', id: 'n_rev' });
  c.deleteSelection();
  assert.equal(sidOf(c, 'n_agent'), undefined);
});

test('a header drag moves every member by the same snapped offset as ONE undo entry', async () => {
  const s = await open({ template: loopFixture() });
  const { c, win } = s;
  c.sessions.join('n_agent', 'n_rev');
  const sid = sidOf(c, 'n_agent');
  c.view.setTransform({ x: 0, y: 0, z: 1 });                       // world === client coordinates (RECT at 0,0)
  const r = c.view.sessionRects().get(sid);
  const x0 = c.template().nodes.find((n) => n.id === 'n_agent').x;
  const xr = c.template().nodes.find((n) => n.id === 'n_rev').x;
  const depth = c.undoDepth();
  const pev = (type, o) => new win.PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, button: 0, ...o });
  c.view.stage.dispatchEvent(pev('pointerdown', { clientX: r.x + 30, clientY: r.y + 10 }));
  assert.equal(c.gesture().type, 'session');
  c.view.stage.dispatchEvent(pev('pointermove', { clientX: r.x + 74, clientY: r.y + 10 }));
  s.flush();
  c.view.stage.dispatchEvent(pev('pointerup', { clientX: r.x + 74, clientY: r.y + 10 }));
  s.flush();
  assert.equal(c.template().nodes.find((n) => n.id === 'n_agent').x, x0 + 44, '44 = 4 snaps of 11');
  assert.equal(c.template().nodes.find((n) => n.id === 'n_rev').x, xr + 44);
  assert.equal(c.undoDepth(), depth + 1);
});

// ── corrections: every pinned branch has its own case ──
const tick = () => new Promise((r) => setTimeout(r, 0));
/** n_task → n_a → n_b → n_c → n_end, three plain steps in a chain. */
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

test('dirty compares the settings map; undo restores it; a loaded grouped row is clean (C21)', async () => {
  const t = loopFixture();
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  t.sessions = { s_aaaaaaaa: { label: 'Build' } };
  const { c } = await open({ template: t });
  assert.equal(c.isDirty(), false);
  assert.deepEqual(c.template().sessions, { s_aaaaaaaa: { label: 'Build' } }, 'loadTemplate keeps the map');
  c.sessions.setSetting('s_aaaaaaaa', 'label', 'Review');
  assert.equal(c.isDirty(), true, 'a settings-only edit is an edit');
  const depth = c.undoDepth();
  c.sessions.setSetting('s_aaaaaaaa', 'label', 'Review');
  assert.equal(c.undoDepth(), depth, 'an unchanged value commits nothing');
  c.undo();
  assert.deepEqual(c.template().sessions, { s_aaaaaaaa: { label: 'Build' } });
  assert.equal(c.isDirty(), false);
  c.sessions.setSetting('s_aaaaaaaa', 'mode', 'subagents');
  assert.deepEqual(c.template().sessions, { s_aaaaaaaa: { label: 'Build' } }, 'the default mode is never written');
  c.sessions.setSetting('s_aaaaaaaa', 'hostModel', 'claude-haiku-5-5');
  c.sessions.setSetting('s_aaaaaaaa', 'label', 'One session');
  assert.deepEqual(c.template().sessions, { s_aaaaaaaa: { hostModel: 'claude-haiku-5-5' } }, 'the default label deletes the key');
  assert.equal(c.sessions.setSetting('s_aaaaaaaa', 'colour', 'x').ok, false);
  assert.equal(c.sessions.setSetting('s_zzzzzzzz', 'label', 'x').ok, false, 'no such session');
});

test('a refused join commits nothing and says why; leave and prune; ⌘G with no legal next step asks the shell', async () => {
  const { c, doc } = await open({ template: chain() });
  doc.documentElement.dataset.flags = 'sessionGroups';
  const depth = c.undoDepth();
  const r = c.sessions.join('n_a', 'n_c');
  assert.deepEqual(r, { ok: false, reason: "planner and planner aren't wired together" });   // the shell loads no agent metas
  assert.equal(c.undoDepth(), depth);
  c.sessions.join('n_a', 'n_b');
  const sid = sidOf(c, 'n_a');
  assert.equal(c.sessions.join('n_b', 'n_c').sid, sid, 'a member\'s session grows');
  assert.equal(sidOf(c, 'n_c'), sid);
  c.sessions.leave('n_c');
  assert.equal(sidOf(c, 'n_c'), undefined);
  c.sessions.leave('n_b');
  assert.equal(sidOf(c, 'n_a'), undefined, 'a lone member is pruned');
  let asked = null;
  c.hooks.onSessionMenu = (id) => { asked = id; };
  c.select({ kind: 'node', id: 'n_c' });
  key(doc, 'g', { ctrlKey: true });
  assert.equal(asked, 'n_c', 'n_c has no next step: the menu opens instead');
  assert.equal(sidOf(c, 'n_c'), undefined);
});

test('the error chip counts a session issue and shows it by selecting the session', async () => {
  const { c, el } = await open({ template: chain() });
  c.sessions.join('n_a', 'n_b');
  c.sessions.join('n_b', 'n_c');
  const sid = sidOf(c, 'n_a');
  c.sessions.leave('n_b');                                    // n_a and n_c stay: not wired together (V27)
  await tick();
  assert.deepEqual(c.report().errors.map((e) => [e.code, e.sessionId]), [['V27', sid]]);
  assert.equal(el.errors.textContent, '1 error');
  el.errors.dispatchEvent(new el.errors.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(c.selection(), { kind: 'session', id: sid });
});

test('Delete on a session toasts, keeps the cards and selects the first step; nudge and anchor work on a session', async () => {
  const { c, doc } = await open({ template: loopFixture() });
  doc.documentElement.dataset.flags = 'sessionGroups';            // the ⇧⌘G below: Task 24 gates the shortcuts on the flag
  const toasts = [];
  c.hooks.onToast = (t) => toasts.push(t);
  c.sessions.join('n_agent', 'n_rev');
  const sid = sidOf(c, 'n_agent');
  c.select({ kind: 'session', id: sid });
  c.view.setTransform({ x: 0, y: 0, z: 1 });                       // world === client coordinates (RECT at 0,0)
  const r = c.view.sessionRects().get(sid);
  assert.deepEqual(c.selectionAnchor(), { x: r.x + r.w / 2, y: r.y + r.h, top: r.y, kind: 'session' }, 'under the tray\'s bottom centre');
  const ys = ['n_agent', 'n_rev'].map((id) => c.template().nodes.find((n) => n.id === id).y);
  const depth = c.undoDepth();
  key(doc, 'ArrowDown');
  assert.deepEqual(['n_agent', 'n_rev'].map((id) => c.template().nodes.find((n) => n.id === id).y), ys.map((y) => y + 11));
  assert.equal(c.undoDepth(), depth + 1, 'one commit for the whole session');
  key(doc, 'Backspace');
  assert.deepEqual(toasts, ['Session removed. The steps stay.']);
  assert.deepEqual(c.selection(), { kind: 'node', id: 'n_agent' });
  assert.equal(c.template().nodes.length, 4);
  c.undo();
  key(doc, 'g', { metaKey: true, shiftKey: true });
  assert.equal(sidOf(c, 'n_agent'), undefined, '⇧⌘G on a member ungroups its session');
});

test('a cancelled header drag rewinds every member and commits nothing', async () => {
  const s = await open({ template: loopFixture() });
  const { c, win } = s;
  c.sessions.join('n_agent', 'n_rev');
  c.view.setTransform({ x: 0, y: 0, z: 1 });
  const r = c.view.sessionRects().get(sidOf(c, 'n_agent'));
  const x0 = c.template().nodes.find((n) => n.id === 'n_rev').x;
  const depth = c.undoDepth();
  const pev = (type, o) => new win.PointerEvent(type, { pointerId: 1, bubbles: true, cancelable: true, button: 0, ...o });
  c.view.stage.dispatchEvent(pev('pointerdown', { clientX: r.x + 30, clientY: r.head.y + 10 }));
  assert.deepEqual(c.selection(), { kind: 'session', id: sidOf(c, 'n_agent') });
  c.view.stage.dispatchEvent(pev('pointermove', { clientX: r.x + 96, clientY: r.head.y + 10 }));
  s.flush();
  assert.equal(c.template().nodes.find((n) => n.id === 'n_rev').x, x0 + 66);
  c.view.stage.dispatchEvent(pev('pointercancel', {}));
  assert.equal(c.template().nodes.find((n) => n.id === 'n_rev').x, x0);
  assert.equal(c.undoDepth(), depth);
  assert.equal(c.gesture(), null);
});

test('the header strip is a button: a press focuses it; Enter or Space on it selects its session', async () => {
  const s = await open({ template: loopFixture() });
  const { c, doc, win } = s;
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.view.setTransform({ x: 0, y: 0, z: 1 });
  const r = c.view.sessionRects().get(sid);
  const at = { pointerId: 4, bubbles: true, cancelable: true, button: 0, clientX: r.x + 30, clientY: r.head.y + 10 };
  c.view.stage.dispatchEvent(new win.PointerEvent('pointerdown', at));
  c.view.stage.dispatchEvent(new win.PointerEvent('pointerup', at));
  const head = c.view.stage.querySelector(`.gv-sess-head[data-session-id="${sid}"]`);
  assert.equal(doc.activeElement, head, 'Delete, ⇧⌘G and the arrows reach the canvas, not a Library row');
  for (const k of ['Enter', ' ']) {
    c.select(null);
    head.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    assert.deepEqual(c.selection(), { kind: 'session', id: sid }, `${JSON.stringify(k)} selects the session`);
  }
  assert.equal(c.view.stage.classList.contains('space'), false, 'Space on the strip is not the hand-pan key');
});

test('a press below the strip pans; chat ops and a chat draft carry the settings map', async () => {
  const s = await open({ template: loopFixture() });
  const { c, win } = s;
  c.sessions.join('n_agent', 'n_rev');
  const sid = sidOf(c, 'n_agent');
  c.view.setTransform({ x: 0, y: 0, z: 1 });
  const r = c.view.sessionRects().get(sid);
  c.view.stage.dispatchEvent(new win.PointerEvent('pointerdown', { pointerId: 2, bubbles: true, cancelable: true, button: 0, clientX: r.x + 4, clientY: r.head.y + r.head.h + 2 }));
  assert.equal(c.gesture().type, 'pan', 'the tray body pans, as today');
  c.view.stage.dispatchEvent(new win.PointerEvent('pointerup', { pointerId: 2, bubbles: true, cancelable: true, button: 0, clientX: r.x + 4, clientY: r.head.y + r.head.h + 2 }));
  c.sessions.setSetting(sid, 'label', 'Build');
  const res = c.applyOps([{ op: 'move_node', node: 'n_task', x: 66, y: 143 }]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(c.template().sessions, { [sid]: { label: 'Build' } });
  const t = loopFixture();
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = 's_bbbbbbbb';
  c.loadDraft({ name: 'x', nodes: t.nodes, wires: t.wires, sessions: { s_bbbbbbbb: { label: 'Drafted' } } });
  assert.deepEqual(c.template().sessions, { s_bbbbbbbb: { label: 'Drafted' } });
});

test('split keeps the longest consecutive run and drops the rest in one commit', async () => {
  const t = chain();
  t.nodes.push({ id: 'n_d', kind: 'agent', key: 'planner', x: 1360, y: 80, config: {} });
  t.nodes.find((n) => n.id === 'n_end').x = 1680;
  t.wires = t.wires.filter((w) => w.id !== 'w4').concat([
    { id: 'w4', from: { node: 'n_c', port: 'plan' }, to: { node: 'n_d', port: 'task' } },
    { id: 'w5', from: { node: 'n_d', port: 'plan' }, to: { node: 'n_end', port: 'result' } }]);
  for (const id of ['n_a', 'n_b', 'n_d']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';   // n_c runs between: V27
  const { c } = await open({ template: t });
  const depth = c.undoDepth();
  assert.deepEqual(c.sessions.split('s_aaaaaaaa'), { ok: true, kept: ['n_a', 'n_b'] });
  assert.equal(c.undoDepth(), depth + 1);
  assert.deepEqual(['n_a', 'n_b', 'n_d'].map((id) => sidOf(c, id)), ['s_aaaaaaaa', 's_aaaaaaaa', undefined]);
  c.undo();
  for (const id of ['n_a', 'n_b']) delete c.template().nodes.find((n) => n.id === id).config.session;
  c.template().nodes.find((n) => n.id === 'n_c').config.session = 's_aaaaaaaa';   // {n_c, n_d} vs nothing else: one run
  assert.deepEqual(c.sessions.split('s_aaaaaaaa').kept, ['n_c', 'n_d']);
});

test('no toast hook: the injected notify says it', async () => {
  const seen = [];
  const { c, doc } = await open({ template: loopFixture(), notify: (o) => seen.push(o) });
  c.sessions.join('n_agent', 'n_rev');
  c.select({ kind: 'session', id: sidOf(c, 'n_agent') });
  key(doc, 'Delete');
  assert.deepEqual(seen, [{ tone: 'info', title: 'Session removed. The steps stay.' }]);
  assert.equal(sidOf(c, 'n_agent'), undefined);
});

test('split prefers the earliest first step between two equally long runs', async () => {
  // Two branches, n_a → n_d and n_b → n_c: {n_a, n_d} and {n_b, n_c} are the only legal pairs.
  const t = loopFixture();
  t.nodes = t.nodes.filter((n) => n.id === 'n_task' || n.id === 'n_end');
  for (const [id, x, y] of [['n_a', 400, 80], ['n_b', 400, 400], ['n_c', 720, 400], ['n_d', 720, 80]]) t.nodes.push({ id, kind: 'agent', key: 'planner', x, y, config: { session: 's_aaaaaaaa' } });
  t.nodes.find((n) => n.id === 'n_end').x = 1040;
  t.wires = [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b', port: 'task' } },
    { id: 'w3', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_d', port: 'task' } },
    { id: 'w4', from: { node: 'n_b', port: 'plan' }, to: { node: 'n_c', port: 'task' } },
    { id: 'w5', from: { node: 'n_d', port: 'plan' }, to: { node: 'n_end', port: 'result' } }];
  const { c } = await open({ template: t });
  const order = c.sessions.byId('s_aaaaaaaa').members;
  const r = c.sessions.split('s_aaaaaaaa');
  assert.equal(r.ok, true);
  assert.deepEqual(r.kept, [order[0], ...order.slice(1).filter((id) => ({ n_a: 'n_d', n_d: 'n_a', n_b: 'n_c', n_c: 'n_b' })[order[0]] === id)],
    `the pair holding the first step (${order.join(', ')})`);
});

test('a chat op that removes a member drops the pruned settings too; a dissolving leave clears the session selection', async () => {
  const { c } = await open({ template: loopFixture() });
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.sessions.setSetting(sid, 'label', 'Build');
  const res = c.applyOps([{ op: 'remove_node', node: 'n_rev' }]);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(sidOf(c, 'n_agent'), undefined);
  assert.equal(c.template().sessions, undefined, 'canvas-ops pruned the map; the composer keeps its result');
  c.undo();
  c.select({ kind: 'session', id: sid });
  c.sessions.leave('n_rev');
  assert.equal(c.selection(), null, 'the session is gone, so is its selection');
});

test('the error chip counts a session warning (a lone member, V26)', async () => {
  const t = loopFixture();
  t.nodes.find((n) => n.id === 'n_agent').config.session = 's_aaaaaaaa';
  const { c, el } = await open({ template: t });
  assert.deepEqual(c.report().errors, []);
  assert.deepEqual(c.report().warnings.map((w) => [w.code, w.sessionId]), [['V26', 's_aaaaaaaa']]);
  assert.equal(el.errors.textContent, '1 warning');
  assert.equal(el.errors.hidden, false);
});

test('a vanished session selection clears on undo and on a chat op; undo drops a map it created', async () => {
  const { c } = await open({ template: loopFixture() });
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.select({ kind: 'session', id: sid });
  c.undo();
  assert.equal(c.selection(), null, 'restore clears a session that is gone');
  c.redo();
  c.sessions.setSetting(sid, 'label', 'Build');
  c.undo();
  assert.equal(c.template().sessions, undefined, 'restore deletes a map the snapshot lacks');
  c.select({ kind: 'session', id: sid });
  assert.equal(c.applyOps([{ op: 'remove_node', node: 'n_rev' }]).ok, true);
  assert.equal(c.selection(), null, 'applyOps clears it too');
});

test('split with no legal pair ungroups in one commit; a split or join that changes nothing commits nothing', async () => {
  const t = chain();
  for (const id of ['n_a', 'n_c']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  const { c } = await open({ template: t });
  let depth = c.undoDepth();
  assert.deepEqual(c.sessions.split('s_aaaaaaaa'), { ok: true });
  assert.deepEqual(['n_a', 'n_c'].map((id) => sidOf(c, id)), [undefined, undefined]);
  assert.equal(c.undoDepth(), depth + 1);
  const sid = c.sessions.join('n_a', 'n_b').sid;
  depth = c.undoDepth();
  assert.deepEqual(c.sessions.split(sid), { ok: true, kept: ['n_a', 'n_b'] });
  assert.deepEqual(c.sessions.join('n_b', 'n_a'), { ok: true, sid });
  assert.equal(c.undoDepth(), depth, 'nothing to undo');
});

test('a warning-only chip and a header pip select the session', async () => {
  const t = loopFixture();
  t.nodes.find((n) => n.id === 'n_agent').config.session = 's_aaaaaaaa';     // V26, a lone member: a warning
  const { c, el, win } = await open({ template: t });
  el.errors.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(c.selection(), { kind: 'session', id: 's_aaaaaaaa' });
  c.select(null);
  c.view.stage.querySelector('.gv-sess-head .nwarn[data-session-id="s_aaaaaaaa"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(c.selection(), { kind: 'session', id: 's_aaaaaaaa' });
});

test('Delete on a focused strip hands the focus to the first step; a held Delete deletes nothing; Space after a press pans', async () => {
  const s = await open({ template: loopFixture() });
  const { c, doc, win } = s;
  const sid = c.sessions.join('n_agent', 'n_rev').sid;
  c.view.setTransform({ x: 0, y: 0, z: 1 });
  const r = c.view.sessionRects().get(sid);
  const at = { pointerId: 5, bubbles: true, cancelable: true, button: 0, clientX: r.x + 30, clientY: r.head.y + 10 };
  c.view.stage.dispatchEvent(new win.PointerEvent('pointerdown', at));
  c.view.stage.dispatchEvent(new win.PointerEvent('pointerup', at));
  const head = c.view.stage.querySelector(`.gv-sess-head[data-session-id="${sid}"]`);
  head.dispatchEvent(new win.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  assert.equal(c.view.stage.classList.contains('space'), true, 'the session is already selected: Space is the pan key');
  doc.dispatchEvent(new win.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  head.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  assert.equal(sidOf(c, 'n_agent'), undefined);
  assert.equal(doc.activeElement, c.view.nodeEl('n_agent'), 'never <body>');
  doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, repeat: true }));
  assert.equal(c.template().nodes.length, 4, 'a repeat of the held key keeps the card');
});

test('a held ⌘G joins one step, not one per key repeat', async () => {
  const { c, doc } = await open({ template: chain() });
  doc.documentElement.dataset.flags = 'sessionGroups';
  c.select({ kind: 'node', id: 'n_a' });
  key(doc, 'g', { metaKey: true });
  key(doc, 'g', { metaKey: true, repeat: true });                 // the member's next step is n_c: a repeat must not take it
  assert.match(sidOf(c, 'n_a'), SESSION_ID_RE);
  assert.equal(sidOf(c, 'n_b'), sidOf(c, 'n_a'));
  assert.equal(sidOf(c, 'n_c'), undefined, 'the repeat joined nothing');
});
