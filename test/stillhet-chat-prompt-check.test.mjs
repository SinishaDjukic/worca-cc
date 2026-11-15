// test/stillhet-chat-prompt-check.test.mjs — Stillhet's composer prompt check controller
// (ui/public/stillhet/chat/prompt-check.mjs): dev's grader and improve view behind one state, with no host. A bare JSDOM
// document for the improve view, fake timers and a fake fetch (test/helpers/prompt-check-chip-host.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createComposerCheck } from '../ui/public/stillhet/chat/prompt-check.mjs';
import { PROMPT_KINDS, KIND_LABELS } from '../src/shared/prompt-check/assessment.mjs';
import { PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { TASK, fakeTimers, fakeFetch, flush, reply } from './helpers/prompt-check-chip-host.mjs';

function setup(t, o = {}) {
  const w = new JSDOM('<!doctype html><body></body>');
  const timers = fakeTimers();
  const f = fakeFetch();
  const changes = [];
  let text = '';
  const field = { read: () => text, write: (v) => { text = v; }, focus() {} };
  const c = createComposerCheck({ doc: w.window.document, surface: { kind: 'chat', id: 'ask_1' }, forceTask: false, fetchImpl: f.fetchImpl, timers, field, project: 'proj', onChange: (s) => changes.push(s), ...o });
  t.after(() => { c.dispose(); w.window.close(); });
  const type = (v) => { text = v; c.input(v); };
  const graded = async (v = TASK, assessment = {}) => {
    type(v);
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    const call = f.grades.at(-1);
    call.reply(reply(call, assessment));
    await flush();
    return call;
  };
  return { c, timers, changes, type, graded, ...f };
}

test('the debounce: one /grade after 1500 ms of quiet, none before', async (t) => {
  const s = setup(t);
  s.type(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS - 1);
  assert.equal(s.grades.length, 0);
  s.timers.advance(1);
  assert.equal(s.grades.length, 1);
  assert.equal(s.grades[0].url, '/api/prompt-check/grade');
  assert.deepEqual(s.grades[0].body.surface, { kind: 'chat', id: 'ask_1' });
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 1);
});

test('a graded task shows its kind and grade; a stale reply is dropped', async (t) => {
  const s = setup(t);
  s.type(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const first = s.grades[0];
  s.type(`${TASK} It must also export the monthly totals for every team.`);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  first.reply(reply(first, { kind: 'bug' }));   // the older request: never applied
  await flush();
  assert.equal(s.c.state().visible, false);
  const second = s.grades.at(-1);
  second.reply({ ...reply(second), textHash: 'stale' });   // the right id for another text: dropped too
  await flush();
  assert.equal(s.c.state().visible, false);
  assert.equal(s.changes.length, 0);
  await s.graded(TASK, { kind: 'bug', grade: 'needs-detail' });
  assert.deepEqual(s.c.state(), { visible: true, kind: 'bug', grade: 'needs-detail', improve: 'hidden' });
});

test('an empty draft hides the chip at once', async (t) => {
  const s = setup(t);
  await s.graded();
  assert.equal(s.c.state().visible, true);
  s.type('');
  assert.deepEqual(s.c.state(), { visible: false, kind: null, grade: null, improve: 'hidden' });
});

test('a same-text skip keeps the state and calls no onChange', async (t) => {
  const s = setup(t);
  await s.graded();
  const n = s.changes.length;
  s.type(TASK);   // the same text: the grader skips it as same-text
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await flush();
  assert.equal(s.c.state().visible, true);
  assert.equal(s.changes.length, n);
});

test('choose re-grades at once and posts ids and kinds only', async (t) => {
  const s = setup(t);
  await s.graded();
  const before = s.grades.length;
  s.c.choose('bug');
  assert.equal(s.grades.length, before + 1, 'regrade: no debounce');
  assert.equal(s.grades.at(-1).body.kind, 'bug');
  assert.equal(s.c.state().kind, 'bug');
  assert.equal(s.c.state().grade, 'needs-detail', 'the grade badge stays while the pick checks again');
  await flush();
  assert.deepEqual(s.posts, [{ surface: 'chat', threadId: 'ask_1', proposedKind: 'implementation', chosenKind: 'bug' }]);
});

test('choosing back to the first kind clears a held correction', async (t) => {
  const s = setup(t, { surface: { kind: 'chat', id: 'new' } });
  await s.graded();
  s.c.choose('bug');
  assert.deepEqual(s.c.pendingCorrection(), { proposedKind: 'implementation', chosenKind: 'bug' });
  s.c.choose('implementation');
  assert.equal(s.c.pendingCorrection(), null);
  s.c.sent(TASK, { threadId: 'ask_9' });
  await flush();
  assert.deepEqual(s.posts, []);
});

test('a new chat holds its correction until sent with a thread id, then posts it once', async (t) => {
  const s = setup(t, { surface: { kind: 'shaper', id: 'new' }, forceTask: true });
  await s.graded();
  s.c.choose('plan');
  await flush();
  assert.deepEqual(s.posts, [], 'held: no thread yet');
  s.c.sent(TASK, { threadId: 'ask_9' });
  s.c.sent(TASK, { threadId: 'ask_9' });
  await flush();
  assert.deepEqual(s.posts, [{ surface: 'shaper', threadId: 'ask_9', proposedKind: 'implementation', chosenKind: 'plan' }]);
  assert.equal(s.c.state().visible, false);
});

test('a correction carried in as held is flushed by sent', async (t) => {
  const s = setup(t, { held: { proposedKind: 'idea', chosenKind: 'bug' } });
  assert.deepEqual(s.c.pendingCorrection(), { proposedKind: 'idea', chosenKind: 'bug' });
  s.c.sent(TASK, { threadId: 'ask_1' });
  await flush();
  assert.deepEqual(s.posts, [{ surface: 'chat', threadId: 'ask_1', proposedKind: 'idea', chosenKind: 'bug' }]);
});

test('dispose stops onChange: a late reply changes nothing', async (t) => {
  const s = setup(t);
  s.type(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const call = s.grades[0];
  s.c.dispose();
  call.reply?.(reply(call));
  await flush();
  assert.equal(s.changes.length, 0);
  assert.equal(s.c.state().visible, false);
});

test('a fetch rejection leaves the state unchanged', async (t) => {
  const failing = (url) => (url === '/api/prompt-check/grade' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ ok: true, json: async () => ({}) }));
  const s = setup(t);
  await s.graded();
  const st = s.c.state();
  const n = s.changes.length;
  const c2 = createComposerCheck({ doc: new JSDOM('').window.document, surface: { kind: 'chat', id: 'ask_2' }, fetchImpl: failing, timers: s.timers, field: { read: () => TASK, write() {} }, onChange: () => s.changes.push('x') });
  t.after(() => c2.dispose());
  c2.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await flush();
  assert.equal(c2.state().visible, false);
  assert.equal(s.changes.length, n);
  assert.deepEqual(s.c.state(), st);
});

test('kinds() lists the 7 prompt kinds with their labels', (t) => {
  const s = setup(t);
  assert.deepEqual(s.c.kinds(), PROMPT_KINDS.map((id) => ({ id, label: KIND_LABELS[id] })));
  assert.equal(s.c.kinds().length, 7);
});

test('Improve opens on needs-detail with the kind and the open decisions, and its state rides state()', async (t) => {
  const s = setup(t);
  await s.graded(TASK, { grade: 'needs-detail', openDecisions: ['Which format?'] });
  s.c.openImprove();
  const call = s.grades.at(-1);
  assert.equal(call.url, '/api/prompt-check/improve');
  assert.equal(call.body.kind, 'implementation');
  assert.deepEqual(call.body.openDecisions, ['Which format?']);
  assert.equal(call.body.projectKey, 'proj');
  assert.equal(s.c.state().improve, 'busy');
  assert.equal(s.changes.at(-1).improve, 'busy');
  assert.ok(s.c.improveEl.querySelector('[data-improve-act="busy"]'));
});
