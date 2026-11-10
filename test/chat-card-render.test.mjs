import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeRunCard, runBodyFromCard, renderCardPost, renderMessageParts, cardTarget, scopeSelectOptions, SELECT_MAX_OPTIONS,
  NATIVE_RUN_EXCLUDES, NO_LINK_HINT, needsWorcaReason, chatMessageState } from '../src/core/chat/card-render.mjs';
import { runSourceOf } from '../src/core/ask/source-spec.mjs';
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
  for (const k of ['preset', 'shape', 'schedule']) assert.equal(isNativeRunCard({ ...RUN, [k]: {} }), false, k);
  assert.equal(isNativeRunCard({ ...RUN, source: {} }), false, 'a source without its ids');
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

// An issue-backed card exactly as validateRunSource + checkTask build it (src/core/ask/source-spec.mjs, proposal.mjs:441-449):
// no brief, the task's title as the card title, display fields on the source.
const SRC = { ...RUN, brief: '', title: 'Fix the login redirect', featureBranchDerived: true,
  source: { type: 'plugin', plugin: 'jira', sourceId: 'issues', taskId: 'PROJ-7', displayName: 'Jira issues', profile: 'cloud', profileVia: 'named',
    inputs: { board: 'WEB' }, title: 'Fix the login redirect', url: 'https://jira.example/browse/PROJ-7' } };

test('task-source cards start from chat with the browser\'s source body (ask-panel.mjs collectCardBody)', () => {
  assert.deepEqual(NATIVE_RUN_EXCLUDES, ['preset', 'shape', 'schedule'], 'ask/prompt.mjs renderChatChannelSection names these: change both');
  assert.equal(isNativeRunCard(SRC), true);
  for (const bad of [{ ...SRC.source, type: 'url' }, { ...SRC.source, taskId: '' }, { ...SRC.source, plugin: 7 }, { ...SRC.source, inputs: [] }, { ...SRC.source, profile: 3 }, 'PROJ-7']) {
    assert.equal(isNativeRunCard({ ...SRC, source: bad }), false, JSON.stringify(bad));
  }
  const body = runBodyFromCard(SRC, opts);
  assert.equal('prompt' in body, false, 'source OR prompt, never both (POST /api/run)');
  assert.deepEqual(body.source, runSourceOf(SRC.source));
  assert.deepEqual(body, { workflowId: 'wf_default', guardrailsId: 'normal', title: 'Fix the login redirect', mock: false,
    askThreadId: 'ask_0123abcd', askCardId: 'card_00000001',
    source: { type: 'plugin', plugin: 'jira', sourceId: 'issues', taskId: 'PROJ-7', profile: 'cloud', inputs: { board: 'WEB' } },
    featureBranch: 'fix/login', featureBranchSuggested: true, projectDir: '/p/demo', sourceBranch: 'dev' });
  const bare = runBodyFromCard({ ...SRC, source: { type: 'plugin', plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-1', displayName: 'Mock Tasks' } }, opts);
  assert.deepEqual(bare.source, { type: 'plugin', plugin: 'mock-source', sourceId: 'mock', taskId: 'MOCK-1' }, 'no profile, no inputs: no keys');
  const post = renderCardPost({ id: 'card_00000009', kind: 'card', state: 'proposed', card: { ...SRC, sourceWarning: 'could not reach Jira issues just now (network)' } }, { issue, links });
  assert.deepEqual(post.controls.map((c) => c.label), ['Start run', 'Not now', 'Request changes', 'Open in worca']);
  assert.match(post.text, /^\*\*Proposed run\*\* — Fix the login redirect\n/);
  assert.match(post.text, /\nTask: Jira issues PROJ-7 · profile cloud · <https:\/\/jira\.example\/browse\/PROJ-7>/);
  // The model may title the card itself (proposal.mjs prefers inp.title): the person still sees the task's own title.
  const retitled = renderCardPost({ id: 'card_00000009', kind: 'card', state: 'proposed', card: { ...SRC, title: 'Login fix' } }, { issue, links });
  assert.match(retitled.text, /^\*\*Proposed run\*\* — Login fix\n/);
  assert.match(retitled.text, /\nTask: Jira issues PROJ-7 — Fix the login redirect · profile cloud · <https:/);
  assert.match(post.text, /_could not reach Jira issues just now \(network\)_/);
  assert.equal(isValidMessage({ title: null, severity: 'info', body: [{ kind: 'markdown', value: post.text }], controls: post.controls }), true);
  const odd = renderCardPost({ id: 'card_00000009', kind: 'card', state: 'proposed', card: { ...SRC, source: { ...SRC.source, url: 'javascript:alert(1)' } } }, { issue, links });
  assert.doesNotMatch(odd.text, /javascript:/, 'only an http(s) task link is shown');
});

test('a card chat cannot start says why; with no worca link it says how to reach worca', () => {
  const noLink = { thread: null, run: null };
  assert.equal(needsWorcaReason({ ...RUN, preset: { id: 'rp_1' } }), 'a run preset');
  assert.equal(needsWorcaReason({ ...RUN, schedule: { when: '+2m' }, attachments: [{ id: 'a' }] }), 'a schedule, attachments');
  assert.equal(needsWorcaReason({ ...RUN, shape: { perspectives: ['product'] } }), 'a planning shape');
  assert.equal(needsWorcaReason({ ...SRC, source: { type: 'url' } }), 'a task source chat cannot read');
  const linked = renderCardPost({ id: 'card_00000010', kind: 'card', state: 'proposed', card: { ...RUN, preset: { id: 'rp_1' } } }, { issue, links });
  assert.deepEqual(linked.controls.map((c) => c.label), ['Open in worca']);
  assert.match(linked.text, /needs worca to start: it uses a run preset, set there\. Nothing was started\._$/);
  assert.doesNotMatch(linked.text, /Open worca in a browser/, 'a link is there: no navigation hint');
  const bare = renderCardPost({ id: 'card_00000010', kind: 'card', state: 'proposed', card: { ...RUN, schedule: { when: '+2m' } } }, { issue, links: noLink });
  assert.deepEqual(bare.controls, []);
  assert.ok(bare.text.endsWith(`\n${NO_LINK_HINT}`), bare.text);
  assert.match(NO_LINK_HINT, /Open worca in a browser and pick this conversation under Chat/);
  assert.match(NO_LINK_HINT, /"Worca address for links"/, 'the discord-chat setting label');
  const other = renderCardPost({ id: 'card_00000011', kind: 'card', state: 'proposed', card: { type: 'metrics' } }, { issue, links: noLink });
  assert.match(other.text, /needs worca/);
  assert.ok(other.text.endsWith(NO_LINK_HINT));
  const otherLinked = renderCardPost({ id: 'card_00000011', kind: 'card', state: 'proposed', card: { type: 'metrics' } }, { issue, links });
  assert.doesNotMatch(otherLinked.text, /Open worca in a browser/);
});

const CMSG = { kind: 'chat-message', id: 'cmsg_0000abcd', direction: 'in', intent: 'question', text: 'line one\n# heading\n> nested\n@everyone [x](https://evil.example)',
  conversationId: 'cxm_0000abcd', hop: 1, maxHops: 6, replyTo: null, repliedWith: null,
  from: { kind: 'chat', chatId: 'ask_1234abcd', title: 'Other', scope: { kind: 'project', key: 'k', label: 'worca-cc' }, owner: 'local' },
  to: { chatId: 'ask_5678abcd', title: 'Mine' }, sentAt: 't' };
const runQ = (questions, over = {}) => ({ ...CMSG, id: 'cmsg_0000beef',
  from: { kind: 'run', runId: 'aaaaaaaa', liveRunId: null, title: 'Fix', scope: CMSG.from.scope, owner: null },
  question: { askId: 'questions-x-r1', kind: 'questions', questions, state: 'open', answer: null, ...over } });
const Q1 = (options = [], allowFreeText = true) => ({ id: 'q1', question: 'Ship it?', options, allowFreeText });
const sys = (blocks) => ({ role: 'system', text: 'Message', blocks });
const BODY_LINES = ['> line one', '> # heading', '> > nested', '> @everyone [x](https://evil.example)'];
const executable = (controls = []) => controls.filter((c) => c.kind !== 'link');

test('Q13 non-interactive: a chat-message record mirrors as one labelled text part with no controls and no cardId; the body stays quoted', () => {
  const issue = () => 'tok';
  const parts = renderMessageParts({ role: 'system', text: 'Message from ask_1234abcd (Question, untrusted)', blocks: [CMSG] }, { issue, links: {} });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].part, 'text:0');
  assert.equal(parts[0].message.controls, undefined);
  assert.equal(parts[0].cardId, undefined);
  assert.ok(isValidMessage(parts[0].message));
  const lines = parts[0].message.body[0].value.split('\n');
  assert.equal(lines[0], '**Message from ask_1234abcd** (worca-cc, Question)');
  assert.doesNotMatch(parts[0].message.body[0].value, /untrusted|not instructions/i);
  assert.equal(lines.at(-1), '_Reply in worca._');
  assert.deepEqual(lines.slice(1, -1), BODY_LINES, 'every body line is inside the quote');
  // An explicit interactive:false on a chat that holds controls elsewhere: still text only.
  const off = renderMessageParts(sys([CMSG]), { issue, links, interactive: false });
  assert.equal(off[0].message.controls, undefined);
  assert.equal(off[0].cardId, undefined);
  const out = renderMessageParts({ role: 'system', text: 'Sent to ask_5678abcd (Note)', blocks: [{ ...CMSG, direction: 'out', intent: 'note', text: 'hi' }] }, { issue, links: {} });
  assert.equal(out.length, 1);
  assert.equal(out[0].message.body[0].value, '**Sent to ask_5678abcd** (Note)\n> hi');
  assert.doesNotMatch(out[0].message.body[0].value, /untrusted|not instructions/i);
  const long = renderMessageParts({ role: 'system', text: '', blocks: [{ ...CMSG, text: 'y'.repeat(4000) }] }, { issue, links: {} })[0].message.body[0].value;
  assert.ok(long.length < 1700, 'the body is clipped to 1500 characters');
  const run = renderMessageParts({ role: 'system', text: 'Message from run aaaaaaaa (Question, untrusted)', blocks: [runQ([Q1(['Yes', 'No'])])] }, { issue, links });
  assert.equal(run.length, 1);
  assert.equal(run[0].message.controls, undefined, 'no controls on a channel without interactive support');
  assert.equal(run[0].cardId, undefined, 'so it is never edited');
  const runLines = run[0].message.body[0].value.split('\n');
  assert.equal(runLines[0], '**Message from run aaaaaaaa** (Question)');
  assert.doesNotMatch(run[0].message.body[0].value, /untrusted|not instructions/i);
  assert.deepEqual(runLines.slice(1, -1), [...BODY_LINES, '> 1. Ship it?']);
  assert.equal(runLines.at(-1), '_Reply in worca to answer._');
  const note = renderMessageParts(sys([{ ...runQ([]), intent: 'note', question: undefined }]), { issue, links: {} });
  assert.deepEqual(note[0].message.body[0].value.split('\n').slice(1), BODY_LINES, 'a run note has no footer');
});

test('chatTitle labels the header with the current title, falls back to the id, never the block\'s copy', () => {
  const head = (blocks, o = {}) => renderMessageParts(sys(blocks), { issue, links: {}, ...o })[0].message.body[0].value.split('\n')[0];
  const value = renderMessageParts(sys([CMSG]), { issue, links: {}, chatTitle: (id) => (id === 'ask_1234abcd' ? 'Release notes' : null) })[0].message.body[0].value;
  assert.equal(value.split('\n')[0], '**Message from Release notes** (worca-cc, Question)');
  assert.ok(!value.includes('Other'), "never the block's from.title");
  assert.ok(!value.includes('ask_1234abcd'));
  assert.equal(head([{ ...CMSG, direction: 'out', intent: 'note', text: 'hi' }], { chatTitle: () => 'Mine now' }), '**Sent to Mine now** (Note)');
  const ID = '**Message from ask_1234abcd** (worca-cc, Question)';
  assert.equal(head([CMSG], { chatTitle: () => '' }), ID, 'an empty title');
  assert.equal(head([CMSG], { chatTitle: () => null }), ID, 'no title');
  assert.equal(head([CMSG], { chatTitle: () => { throw new Error('boom'); } }), ID, 'a throw');
  assert.equal(head([CMSG]), ID, 'no chatTitle');
  assert.equal(head([CMSG], { chatTitle: () => '  \n ' }), ID, 'a blank title');
  assert.equal(head([CMSG], { chatTitle: () => 'a\nb' }), '**Message from a b** (worca-cc, Question)');
  assert.equal(head([CMSG], { chatTitle: () => 't'.repeat(200) }), `**Message from ${'t'.repeat(79)}…** (worca-cc, Question)`);
  const live = renderMessageParts(sys([CMSG]), { issue, links, interactive: true, chatTitle: () => 'Release notes' })[0];
  assert.equal(live.cardId, CMSG.id, 'the interactive path');
  assert.equal(live.message.body[0].value.split('\n')[0], '**Message from Release notes** (worca-cc, Question)');
  assert.equal(head([runQ([Q1(['Yes', 'No'])])], { chatTitle: () => 'Nope' }), '**Message from run aaaaaaaa** (Question)', 'a run keeps its id');
});

test('Q14 chatMessageState: run question states, open / replied / last for a chat message, null for an out copy and a run note', () => {
  assert.equal(chatMessageState(runQ([Q1()])), 'q:open');
  assert.equal(chatMessageState(runQ([Q1()], { state: 'answered' })), 'q:answered');
  assert.equal(chatMessageState(runQ([Q1()], { state: 'closed' })), 'q:closed');
  assert.equal(chatMessageState(CMSG), 'open');
  assert.equal(chatMessageState({ ...CMSG, repliedWith: 'cmsg_00000002' }), 'replied');
  assert.equal(chatMessageState({ ...CMSG, hop: 6 }), 'last');
  assert.equal(chatMessageState({ ...CMSG, direction: 'out' }), null);
  assert.equal(chatMessageState({ ...runQ([]), question: undefined }), null);
  assert.equal(chatMessageState(null), null);
});

test('Q15 interactive open chat message: one part text:0 carrying the cmsg id and state, a Reply button with a one-field modal', () => {
  const seen = [];
  const mint = (action, cardId, state) => { seen.push([action, cardId, state]); return `ref_${seen.length}`.padEnd(24, 'x'); };
  const parts = renderMessageParts(sys([CMSG]), { issue: mint, links, interactive: true });
  assert.equal(parts.length, 1);
  const [p] = parts;
  assert.equal(p.part, 'text:0', 'the name rows delivered before this slice carry');
  assert.equal(p.cardId, 'cmsg_0000abcd');
  assert.equal(p.state, 'open');
  assert.ok(isValidMessage(p.message));
  assert.deepEqual(p.message.controls.map((c) => c.label), ['Reply', 'Open in worca']);
  const reply = p.message.controls[0];
  assert.equal(reply.style, 'primary');
  assert.deepEqual(reply.modal, { title: 'Reply', fields: [{ id: 'text', label: 'Your reply', style: 'paragraph', required: true, maxLength: 2000 }] });
  assert.deepEqual(seen, [['cmsg:reply', 'cmsg_0000abcd', 'open']]);
  const lines = p.message.body[0].value.split('\n');
  assert.deepEqual(lines.slice(1, -1), BODY_LINES, '@everyone and # heading stay quoted');
  assert.equal(lines.at(-1), '_Reply with the button below, or in worca._');
});

test('Q16 interactive run question: a select for one question with options, Answer for one without, nothing for a larger round', () => {
  const mint = (action) => `${action.replace(':', '_')}`.padEnd(24, 'x');
  const one = (q, over) => renderMessageParts(sys([runQ(q, over)]), { issue: mint, links, interactive: true })[0];
  const sel = one([Q1(['Yes', 'No', 'Later'], false)]);
  assert.equal(sel.cardId, 'cmsg_0000beef');
  assert.equal(sel.state, 'q:open');
  assert.ok(isValidMessage(sel.message));
  assert.equal(sel.message.controls[0].kind, 'select');
  assert.equal(sel.message.controls[0].placeholder, 'Pick one');
  assert.deepEqual(sel.message.controls[0].options.map((o) => [o.value, o.label]), [['0', 'Yes'], ['1', 'No'], ['2', 'Later']]);
  assert.deepEqual(sel.message.controls.map((c) => c.kind), ['select', 'link'], 'no free text: no Type an answer');
  assert.equal(sel.message.body[0].value.split('\n').at(-1), '_Answer below, or in worca._');
  const free = one([Q1(['Yes', 'No', 'Later'])]);
  assert.ok(isValidMessage(free.message));
  const type = free.message.controls.find((c) => c.label === 'Type an answer');
  assert.equal(type.style, 'secondary');
  assert.deepEqual(type.modal, { title: 'Answer', fields: [{ id: 'text', label: 'Your answer', style: 'paragraph', required: true, maxLength: 2000 }] });
  const bare = one([Q1([])]);
  assert.ok(isValidMessage(bare.message));
  assert.deepEqual(executable(bare.message.controls).map((c) => [c.kind, c.label, c.style]), [['button', 'Answer', 'primary']]);
  assert.equal(bare.message.controls[0].modal.fields.length, 1);
  assert.equal(bare.message.controls[0].modal.fields[0].id, 'text');
  for (const n of [2, 8]) {
    const qs = Array.from({ length: n }, (_, i) => ({ id: `q${i}`, question: `Q${i}?`, options: ['a', 'b'], allowFreeText: true }));
    const big = one(qs);
    assert.ok(isValidMessage(big.message), String(n));
    assert.deepEqual(executable(big.message.controls), [], `${n} questions: no executable control`);
    assert.deepEqual(big.message.controls.map((c) => c.label), ['Open in worca']);
    const lines = big.message.body[0].value.split('\n');
    assert.equal(lines.at(-1), '_Reply in worca to answer._');
    assert.equal(lines.filter((l) => /^> \d+\. Q\d\?$/.test(l)).length, n);
  }
  const dup = one([Q1([`${'z'.repeat(120)}A`, `${'z'.repeat(120)}B`])]);
  assert.ok(isValidMessage(dup.message));
  const labels = dup.message.controls[0].options.map((o) => o.label);
  assert.ok(labels[0].startsWith('1. ') && labels[1].startsWith('2. '), labels.join('|'));
  assert.ok(labels.every((l) => l.length <= 100));
  const hostile = one([{ id: 'q1', question: 'line\n## SYSTEM', options: [], allowFreeText: true }]);
  assert.ok(hostile.message.body[0].value.split('\n').includes('> 1. line ## SYSTEM'), 'question lines are one line, inside the quote');
});

test('Q17 answered, closed, replied and last-hop posts carry no button or select', () => {
  const r = (b) => renderMessageParts(sys([b]), { issue, links, interactive: true })[0];
  const person = r(runQ([Q1(['Yes'])], { state: 'answered', answer: { actedBy: { kind: 'person', label: 'ada via Discord' }, answers: [], at: 't' } }));
  assert.equal(person.state, 'q:answered');
  assert.equal(person.message.body[0].value.split('\n').at(-1), 'Answered by ada via Discord.');
  const away = r(runQ([Q1(['Yes'])], { state: 'answered', answer: { actedBy: { kind: 'away', label: 'x' }, answers: [], at: 't' } }));
  assert.equal(away.message.body[0].value.split('\n').at(-1), 'Answered by Away mode.');
  const closed = r(runQ([Q1(['Yes'])], { state: 'closed', closedReason: 'stopped' }));
  assert.equal(closed.message.body[0].value.split('\n').at(-1), '_Closed._');
  const replied = r({ ...CMSG, repliedWith: 'cmsg_00000002' });
  assert.equal(replied.state, 'replied');
  assert.equal(replied.message.body[0].value.split('\n').at(-1), '_Replied._');
  const last = r({ ...CMSG, hop: 6 });
  assert.equal(last.state, 'last');
  assert.equal(last.message.body[0].value.split('\n').at(-1), '_Last hop: no reply is possible._');
  for (const p of [person, away, closed, replied, last]) {
    assert.deepEqual(executable(p.message.controls), [], p.state);
    assert.ok(isValidMessage(p.message), p.state);
  }
});

test('Q18 a person-written block names its writer in the header; two blocks in one row stay one static part', () => {
  const by = { ...CMSG, by: { kind: 'person', label: 'ada via Discord' } };
  for (const interactive of [true, false]) {
    const p = renderMessageParts(sys([by]), { issue, links, interactive })[0];
    assert.ok(p.message.body[0].value.split('\n')[0].endsWith(' · by ada via Discord'), String(interactive));
  }
  const hostile = renderMessageParts(sys([{ ...CMSG, by: { kind: 'person', label: 'x\n# boom' } }]), { issue, links, interactive: true })[0];
  assert.ok(hostile.message.body[0].value.split('\n')[0].endsWith(' · by x # boom'));
  for (const still of [{ ...CMSG, direction: 'out' }, { ...runQ([]), intent: 'note', question: undefined }]) {
    const p = renderMessageParts(sys([still]), { issue, links, interactive: true })[0];
    assert.equal(p.cardId, undefined, 'a post that never changes carries no cardId (null state), even on an interactive channel');
    assert.equal(p.message.controls, undefined);
  }
  const two = renderMessageParts(sys([CMSG, { ...CMSG, id: 'cmsg_0000abce' }]), { issue, links, interactive: true });
  assert.equal(two.length, 1);
  assert.equal(two[0].cardId, undefined);
  assert.equal(two[0].message.controls, undefined);
  assert.equal(two[0].message.body[0].value.split('\n\n').length, 2);
});
