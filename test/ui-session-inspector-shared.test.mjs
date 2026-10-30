// test/ui-session-inspector-shared.test.mjs — "One conversation" is honest about what it changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSessionInspector } from '../ui/public/graph/inspector.mjs';
import { sessionNotes, SESSION_SHARED_SELECTABLE } from '../src/shared/graph/sessions.mjs';
import { SESSION_SHARED_RUNTIME } from '../src/core/session-host.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const spec = { sid: 's_aaaaaaaa', members: ['n_impl', 'n_review'], closure: ['n_impl', 'n_review'], flows: [], internalWires: [], entryWires: [], exitWires: [], crossingLoops: [],
  settings: { label: 'One session', mode: 'shared', hostModel: null, hostEffort: null } };
const members = [{ nodeId: 'n_impl', label: 'Implementation', sideEffect: 'code', runnerType: 'producer' }, { nodeId: 'n_review', label: 'Review', runnerType: 'verifier' }];

test('the review-independence warning and the shared hint', () => {
  const n = sessionNotes(spec, { engine: 'claude', verified: { claude: true }, members, labelOf: (id) => ({ n_impl: 'Implementation', n_review: 'Review' })[id] });
  assert.deepEqual(n.find((x) => x.code === 'shared-not-independent'), { level: 'warn', code: 'shared-not-independent',
    text: "In one conversation Review sees Implementation's reasoning, so the review is not independent." });
  const el = renderSessionInspector(spec, { template: { nodes: [], wires: [] }, labels: {}, models: [], efforts: [], engine: 'claude', verified: { claude: true }, doc });
  assert.match(el.textContent, /Every step is a turn of one conversation: each step sees the earlier steps' work\./);
  assert.equal([...el.querySelectorAll('.seg button')].find((b) => b.textContent === 'One conversation').getAttribute('aria-pressed'), 'true');
});

// ── v2: when the note fires and when it does not; the segment is selectable; the hint follows what really runs ──
const S = (ids, mode = 'shared', extra = {}) => ({ ...spec, members: ids, closure: ids, settings: { ...spec.settings, mode, ...extra } });
const codes = (sp, ms) => sessionNotes(sp, { engine: 'claude', verified: { claude: true }, members: ms }).map((x) => x.code);
const texts = (sp, ms) => sessionNotes(sp, { engine: 'claude', verified: { claude: true }, members: ms }).filter((x) => x.code === 'shared-not-independent').map((x) => x.text);

test('v2 — only a verifier after a code step, only in one conversation; the code step nearest before it is named; one note per verifier', () => {
  assert.deepEqual(codes(S(['n_impl', 'n_review'], 'subagents'), members).includes('shared-not-independent'), false, 'sub-agents start fresh');
  assert.deepEqual(codes(S(['n_review', 'n_impl']), members), [], 'a reviewer before the code step reviews nothing of it');
  const prod = [{ nodeId: 'n_impl', label: 'Implementation', sideEffect: 'code', runnerType: 'producer' }, { nodeId: 'n_doc', label: 'Docs', runnerType: 'producer' }];
  assert.deepEqual(codes(S(['n_impl', 'n_doc']), prod), [], 'a producer after the code step is no review');
  const mem = [{ nodeId: 'n_mem', label: 'Memory', sideEffect: 'memory', runnerType: 'producer' }, { nodeId: 'n_review', label: 'Review', runnerType: 'verifier' }];
  assert.deepEqual(codes(S(['n_mem', 'n_review']), mem), [], 'only a `code` side effect');
  const three = [{ nodeId: 'n_a', label: 'Backend', sideEffect: 'code' }, { nodeId: 'n_b', label: 'Frontend', sideEffect: 'code' }, { nodeId: 'n_r', label: 'Review', runnerType: 'verifier' },
    { nodeId: 'n_q', label: 'QA', runnerType: 'verifier' }];
  assert.deepEqual(texts(S(['n_a', 'n_b', 'n_r', 'n_q']), three), [
    "In one conversation Review sees Frontend's reasoning, so the review is not independent.",
    "In one conversation QA sees Frontend's reasoning, so the review is not independent."]);
  // A label from labelOf when the member facts carry none; the note after the step notes and before shared-ignores.
  const bare = [{ nodeId: 'n_impl', sideEffect: 'code' }, { nodeId: 'n_review', runnerType: 'verifier', asks: true }];
  const n = sessionNotes(S(['n_impl', 'n_review'], 'shared', { hostModel: 'claude-haiku-4-5' }), { engine: 'claude', members: bare, labelOf: (id) => id.toUpperCase() });
  assert.deepEqual(n.map((x) => x.code), ['asks', 'shared-not-independent', 'shared-ignores']);
  assert.equal(n[1].text, "In one conversation N_REVIEW sees N_IMPL's reasoning, so the review is not independent.");
  assert.deepEqual(codes(S(['n_impl', 'n_review']), [{ nodeId: 'n_impl', sideEffect: 'code' }, { nodeId: 'n_review', runnerType: 'Verifier' }]), [], 'exact values');
});

test('v2 — One conversation is selectable (Expert in the inspector), and the hint says what runs', () => {
  assert.equal(SESSION_SHARED_SELECTABLE, true, 'Task 66 turned it on with Task 65\'s runtime');
  assert.equal(SESSION_SHARED_SELECTABLE, SESSION_SHARED_RUNTIME, 'the Composer and the run-start notice offer it exactly when the run-start gate runs it')
  const base = { template: { nodes: [], wires: [] }, labels: {}, models: [], efforts: [], engine: 'claude', verified: { claude: true }, doc };
  const el = renderSessionInspector(spec, base);
  const shared = [...el.querySelectorAll('.seg button')].find((b) => b.textContent === 'One conversation');
  assert.deepEqual([shared.disabled, shared.hasAttribute('title'), shared.dataset.minLevel], [false, false, 'expert']);
  const hints = (sp, o = {}) => [...renderSessionInspector(sp, { ...base, ...o }).querySelectorAll('small.ins-hint')].map((x) => x.textContent);
  assert.equal(hints(spec)[0], 'Every step is a turn of one conversation: each step sees the earlier steps\' work. Steps keep their own model and tools.');
  assert.equal(hints(spec, { canAdd: false })[0], 'Each step runs in its own session, one after another.', 'the Labs flag off: the steps run separate (C14)');
  assert.equal(hints(spec, { verified: { claude: false } })[0], hints(spec)[0], 'one conversation needs no sub-agent gate');
  assert.match(hints(S(['n_impl', 'n_review'], 'subagents'))[0], /^Each step runs as its own sub-agent/);
  assert.equal(hints(S(['n_impl', 'n_review'], 'subagents'), { verified: { claude: false } })[0], 'Each step runs in its own session, one after another.');
  assert.ok(!hints(spec).some((t) => /small model/.test(t)), 'no main agent to size');
  const notes = [...renderSessionInspector(spec, { ...base, members }).querySelectorAll('.ins-note')];
  assert.deepEqual(notes.map((x) => [x.dataset.code, x.className]), [['shared-not-independent', 'ins-note is-warn']]);
});

// ── v3: with sub-agents gated off (the shipped gate), the panel still says what a One conversation session runs as ──
const segOf = (el) => [...el.querySelectorAll('.ins-sess-mode .seg button')].map((b) => [b.textContent, b.dataset.sessMode, b.getAttribute('aria-pressed'), b.title]);
const harnessOf = (el) => el.querySelector('.ins-sess-harness .ins-hint').textContent;
const panel = (sp, o = {}) => renderSessionInspector(sp, { template: { nodes: [], wires: [] }, labels: {}, models: [], efforts: [], engine: 'claude', doc, ...o });

test('v3 — One conversation with sub-agents gated off: no "Separate sessions" line beside it, the way back, every engine', () => {
  const el = panel(spec, { verified: { claude: false } });
  assert.equal(el.querySelector('.ins-sess-mode .ins-resolved'), null, 'never "Separate sessions (…)" beside the pressed One conversation');
  assert.deepEqual(segOf(el), [['Separate sessions', 'subagents', 'false', 'sub-agents not available yet'], ['One conversation', 'shared', 'true', '']],
    'the default mode is the way back, named for what it runs as here (the toolbar\'s How menu does the same)');
  assert.equal(harnessOf(el), 'Every engine runs these steps as one conversation.');
  // The Labs flag off: the steps run separate, and nobody reads anyone's reasoning.
  const off = panel(spec, { verified: { claude: false }, canAdd: false, members });
  assert.deepEqual(segOf(off)[0], ['Separate sessions', 'subagents', 'false', 'off in Settings › Labs']);
  assert.equal(harnessOf(off), 'Every engine runs these steps as separate sessions.');
  assert.deepEqual([...off.querySelectorAll('.ins-note')].map((x) => x.dataset.code), ['flag-off']);
  // The gate open: Sub-agents is the other choice; the hint for One conversation stays.
  const live = panel(spec, { verified: { claude: true } });
  assert.deepEqual(segOf(live), [['Sub-agents', 'subagents', 'false', ''], ['One conversation', 'shared', 'true', '']]);
  assert.equal(live.querySelector('.ins-sess-mode .ins-resolved'), null);
  assert.equal(harnessOf(live), 'Every engine runs these steps as one conversation.');
  // A sub-agents session is as it was: the line, One conversation to pick, the gate's engines.
  const sub = panel(S(['n_impl', 'n_review'], 'subagents'), { verified: { claude: false } });
  assert.equal(sub.querySelector('.ins-sess-mode .ins-resolved').textContent, 'Separate sessions (sub-agents not available yet)');
  assert.deepEqual(segOf(sub), [['One conversation', 'shared', 'false', '']]);
  assert.equal(harnessOf(sub), 'Every engine runs these steps as separate sessions.');
  assert.equal(harnessOf(panel(S(['n_impl', 'n_review'], 'subagents'), { verified: { claude: true } })), 'Sub-agents on Claude; every other engine runs these steps as separate sessions.');
});

// ── v4: the flag-off panel and the blurb say nothing a One conversation session does not do ──
test('v4 — with the Labs flag off no step waits in a session; in one conversation the blurb promises no independent review', () => {
  const asking = [members[0], { ...members[1], asks: true }];
  const off = panel(spec, { verified: { claude: false }, canAdd: false, members: asking });
  assert.deepEqual([...off.querySelectorAll('.ins-note')].map((x) => x.dataset.code), ['flag-off'], 'the steps run separate: no session waits for answers');
  const on = panel(spec, { verified: { claude: false }, members: asking });
  assert.deepEqual([...on.querySelectorAll('.ins-note')].map((x) => x.dataset.code), ['asks', 'shared-not-independent']);
  const blurb = (el) => el.querySelector('.ins-blurb').textContent;
  assert.equal(blurb(on), 'worca still decides what runs next, so files and loop limits work as they do today.');
  assert.equal(blurb(off), 'worca still decides what runs next, so files, loop limits and reviews work as they do today.', 'separate sessions: reviews are as they were');
  assert.equal(blurb(panel(S(['n_impl', 'n_review'], 'subagents'), { verified: { claude: true }, members: asking })), blurb(off));
});
