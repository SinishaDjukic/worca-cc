import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeRunCard, runBodyFromCard, renderCardPost, renderMessageParts, cardTarget, scopeSelectOptions, SELECT_MAX_OPTIONS } from '../src/core/chat/card-render.mjs';
import { isValidMessage } from '../src/core/chat/channel-protocol.mjs';

const issued = [];
const issue = (action, cardId, state) => { issued.push({ action, cardId, state }); return `ref_${action}_${issued.length}`.padEnd(24, 'x'); };
const links = { thread: 'https://w.example/#chat/ask_0123abcd', run: (id) => `https://w.example/#running/${id}` };
// Card literals with the key set validateProposal returns (src/core/ask/proposal.mjs:304-315 targets, :565-590 card).
const TARGET_NULLS = { projectKey: null, projectName: null, projectDir: null, workspaceId: null, workspaceName: null, members: null };
// Unset fields are null, as validateProposal returns them; a real sameAsSource card still carries its derived featureBranch.
const RUN = { target: 'project', ...TARGET_NULLS, projectKey: 'demo-12345678', projectName: 'Demo', projectDir: '/p/demo',
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', memoryScope: null, brief: 'Fix the login bug',
  title: 'Login fix', sourceBranch: 'dev', featureBranch: 'fix/login', sourceBranchByKey: null, note: null, attachments: [] };
const NONE = { target: 'none', ...TARGET_NULLS, workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal',
  memoryScope: null, brief: 'Try a scratch idea', title: 'Scratch', sourceBranch: null, featureBranch: null,
  sourceBranchByKey: null, note: null, attachments: [] };
const SAME = { ...RUN, sameAsSource: true };
const WS = { target: 'workspace', ...TARGET_NULLS, workspaceId: 'ws_00c0ffee', workspaceName: 'Shop', members: [{ projectKey: 'demo-12345678' }],
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal', memoryScope: null, brief: 'Bump deps', title: 'Deps',
  sourceBranch: 'main', featureBranch: 'chore/deps', sourceBranchByKey: null, note: null, attachments: [] };
const opts = { projectDirOf: (k) => (k === 'demo-12345678' ? '/p/demo' : null), threadId: 'ask_0123abcd', cardId: 'card_00000001' };

test('matrix: plain run proposals of every target get Start; excluded fields fall back to Open in worca', () => {
  assert.equal(cardTarget(RUN), 'project');
  assert.equal(cardTarget(NONE), 'none', 'read from card.target, never a noProject key (review M1)');
  assert.equal(cardTarget({ projectKey: 'k' }), 'project', 'legacy card without target');
  assert.equal(cardTarget({ target: 'bogus', projectKey: 'k' }), null);
  for (const c of [RUN, NONE, SAME, WS]) assert.equal(isNativeRunCard(c), true, c.target);
  assert.equal(isNativeRunCard({ ...RUN, projectKey: null }), false, 'project target without its key');
  for (const k of ['preset', 'shape', 'schedule', 'source']) assert.equal(isNativeRunCard({ ...RUN, [k]: {} }), false, k);
  assert.equal(isNativeRunCard({ ...RUN, attachments: [{ id: 'a' }] }), false);
  assert.equal(isNativeRunCard({ type: 'metrics' }), false);
  for (const card of [RUN, NONE]) {
    const post = renderCardPost({ id: 'card_00000001', kind: 'card', state: 'proposed', card }, { issue, links });
    assert.deepEqual(post.controls.map((c) => c.label), ['Start run', 'Not now', 'Request changes', 'Open in worca'], card.target);
  }
  assert.match(renderCardPost({ id: 'card_00000001', kind: 'card', state: 'proposed', card: NONE }, { issue, links }).text, /No project/);
  assert.match(renderCardPost({ id: 'card_00000001', kind: 'card', state: 'proposed', card: SAME }, { issue, links }).text, /on dev/);
  const fallback = renderCardPost({ id: 'card_00000002', kind: 'card', state: 'proposed', card: { ...RUN, schedule: { when: '+2m' } } }, { issue, links });
  assert.deepEqual(fallback.controls.map((c) => c.kind), ['link']);
  assert.match(fallback.text, /needs worca/);
  for (const type of ['metrics', 'policy', 'script-approval', 'actions', 'workflow', 'clone', 'run-stop']) {
    const p = renderCardPost({ id: 'card_00000003', kind: 'card', state: 'proposed', card: { type } }, { issue, links });
    assert.equal(p.controls.every((c) => c.kind === 'link'), true, type);
    assert.match(p.text, /needs worca/, type);
  }
});

test('runBodyFromCard mirrors collectCardBody for an untouched card: project, No project, sameAsSource, workspace', () => {
  assert.deepEqual(runBodyFromCard({ ...RUN, engine: 'codex', featureBranchDerived: true,
    nodes: { n_plan: { model: 'opus', effort: 'high' }, n_bad: { effort: 'x' } } }, opts),
  { prompt: 'Fix the login bug', workflowId: 'wf_default', guardrailsId: 'normal', title: 'Login fix', mock: false,
    askThreadId: 'ask_0123abcd', askCardId: 'card_00000001', engine: 'codex', overlay: { nodes: { n_plan: { model: 'opus', effort: 'high' } } },
    featureBranch: 'fix/login', featureBranchSuggested: true, projectDir: '/p/demo', sourceBranch: 'dev' });
  // review M1: a No-project card (target 'none', ids null) sends noProject and nothing about branches or targets.
  assert.deepEqual(runBodyFromCard(NONE, { ...opts, projectDirOf: () => null }),
    { prompt: 'Try a scratch idea', workflowId: 'wf_default', guardrailsId: 'normal', title: 'Scratch', mock: false,
      askThreadId: 'ask_0123abcd', askCardId: 'card_00000001', noProject: true });
  // review M1: the source-branch card keeps sameAsSource and sends no featureBranch.
  const same = runBodyFromCard({ ...SAME, featureBranch: 'ignored/when-same' }, opts);
  assert.equal(same.sameAsSource, true);
  assert.equal('featureBranch' in same, false);
  assert.equal('featureBranchSuggested' in same, false);
  assert.equal(same.sourceBranch, 'dev');
  assert.equal(same.projectDir, '/p/demo');
  assert.deepEqual(runBodyFromCard(WS, opts), { prompt: 'Bump deps', workflowId: 'wf_default', guardrailsId: 'normal', title: 'Deps', mock: false,
    askThreadId: 'ask_0123abcd', askCardId: 'card_00000001', featureBranch: 'chore/deps', workspaceId: 'ws_00c0ffee', sourceBranch: 'main' });
  const wsSame = runBodyFromCard({ ...WS, featureBranch: undefined, sameAsSource: true }, opts);
  assert.equal(wsSame.sameAsSource, true);
  assert.equal(wsSame.workspaceId, 'ws_00c0ffee');
  const noWf = runBodyFromCard({ ...RUN, workflowId: undefined, nodes: { n_plan: { model: 'opus', effort: 'high' } } }, opts);
  assert.equal(noWf.workflowId, 'wf_default');
  assert.equal('overlay' in noWf, false, 'picks proposed for no workflow are not applied to the default (ask-panel parity)');
  assert.equal(runBodyFromCard(RUN, { ...opts, projectDirOf: () => null }), null);
});

test('scopeSelectOptions: No project first, projects then workspaces by name, capped at 25 with a hidden count', () => {
  const small = scopeSelectOptions({ projects: [{ key: 'b-1', name: 'Beta' }, { key: 'a-1', name: 'Alpha' }], workspaces: [{ id: 'ws_1', name: 'Shop' }] });
  assert.deepEqual(small.options.map((o) => o.value), ['none', 'p:a-1', 'p:b-1', 'w:ws_1']);
  assert.equal(small.hidden, 0);
  const projects = Array.from({ length: 30 }, (_, i) => ({ key: `p${String(i).padStart(2, '0')}`, name: `P${String(i).padStart(2, '0')}` }));
  const big = scopeSelectOptions({ projects, workspaces: [{ id: 'ws_1', name: 'Shop' }] });
  assert.equal(big.options.length, SELECT_MAX_OPTIONS);
  assert.equal(SELECT_MAX_OPTIONS, 25);
  assert.equal(big.options[0].value, 'none');
  assert.equal(big.hidden, 31 - 24);
  const long = scopeSelectOptions({ projects: [{ key: 'k'.repeat(120), name: 'Long' }, { key: 'a-1', name: 'Alpha' }] });
  assert.deepEqual(long.options.map((o) => o.value), ['none', 'p:a-1']);
  assert.equal(long.hidden, 1, 'a key too long for a select value is counted, never sent');
});

test('question + scope cards become selects / modal buttons; answered cards carry no controls', () => {
  const q = renderCardPost({ id: 'card_00000004', kind: 'card', state: 'proposed', card: { type: 'question', answer: 'choice', question: 'Which?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] } }, { issue, links });
  assert.equal(q.controls[0].kind, 'select');
  assert.deepEqual(q.controls[0].options.map((o) => o.value), ['a', 'b']);
  const t = renderCardPost({ id: 'card_00000005', kind: 'card', state: 'proposed', card: { type: 'question', answer: 'text', question: 'Why?' } }, { issue, links });
  assert.equal(t.controls[0].modal.fields[0].id, 'text');
  const s = renderCardPost({ id: 'card_00000006', kind: 'card', state: 'proposed', card: { type: 'scope-switch', candidates: [{ projectKey: 'demo-12345678', name: 'Demo' }], reason: 'login screen' } }, { issue, links });
  assert.deepEqual(s.controls[0].options.map((o) => o.value), ['demo-12345678', 'none']);
  // A candidate whose key is over the 100-character option-value limit would make the whole message invalid: it is left out.
  const long = renderCardPost({ id: 'card_00000008', kind: 'card', state: 'proposed', card: { type: 'scope-switch', candidates: [{ projectKey: 'k'.repeat(101), name: 'Long' }, 'demo-12345678'] } }, { issue, links });
  assert.deepEqual(long.controls[0].options.map((o) => o.value), ['demo-12345678', 'none']);
  const done = renderCardPost({ id: 'card_00000004', kind: 'card', state: 'answered', card: { type: 'question', answer: 'choice', question: 'Which?', options: [{ id: 'a', label: 'A' }], choice: 'a' } }, { issue, links });
  assert.deepEqual(done.controls, []);
  assert.match(done.text, /Answered: A/);
});

test('message parts: text then one part per card; every message is protocol-valid', () => {
  const parts = renderMessageParts({ role: 'assistant', status: 'done', text: 'Here is a plan.', blocks: [
    { kind: 'tool', name: 'x' }, { kind: 'card', id: 'card_00000007', state: 'proposed', card: RUN }] }, { issue, links });
  assert.deepEqual(parts.map((p) => p.part), ['text:0', 'card:card_00000007']);
  for (const p of parts) assert.equal(isValidMessage(p.message), true);
  assert.deepEqual(renderMessageParts({ role: 'user', text: 'from discord', blocks: [] }, { issue, links }), []);
  assert.match(renderMessageParts({ role: 'user', text: 'typed in worca', blocks: [] }, { issue, links, fromWorca: true })[0].message.body[0].value, /^\*\(from worca\)\*/);
  assert.equal(renderMessageParts({ role: 'assistant', status: 'stopped', text: '', blocks: [] }, { issue, links })[0].message.body[0].value, '_Stopped before any reply._');
  assert.match(renderMessageParts({ role: 'assistant', status: 'stopped', text: 'Half an answer', blocks: [] }, { issue, links })[0].message.body[0].value, /^Half an answer\n\n_Stopped\._$/);
});
