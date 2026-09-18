// test/ask-panel-card.test.mjs — the Start-run card (spec §9, §10.5, D1-D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000001';

const PROJECT_CARD = {
  target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj',
  workspaceId: null, workspaceName: null, members: null,
  workflowId: 'wf_default', workflowName: 'Default', guardrailsId: 'normal',
  brief: 'Fix the login bug', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login', sourceBranchByKey: null,
  note: 'UI-only change on one module.', attachments: [],
};
const WS_CARD = {
  ...PROJECT_CARD, target: 'workspace', projectKey: null, projectName: null, projectDir: null,
  workspaceId: 'wks-team-00000001', workspaceName: 'team',
  members: [{ projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/repos/lib' }],
  featureBranch: 'worca/fix-login', sourceBranchByKey: null,
};

const WF_DEFAULT_TPL = { id: 'wf_default', name: 'Default', version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
          { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
          { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: { model: 'claude-opus-5', effort: 'high' } },
          { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
          { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
          { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
          { id: 'w3', from: { node: 'n_impl', port: 'diff' }, to: { node: 'n_rev', port: 'diff' } },
          { id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'revise' }, config: { maxCycles: 3 } },
          { id: 'w5', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };
// Ported metas (metaVersion 2), like the real /api/agents rows — the loop wire w4 is a
// loop only because the reviewer's `review` output is when:'blocking' (loops.mjs:90-91).
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', metaVersion: 2, fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: true,
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  { key: 'implementer', displayName: 'Implement', color: 'green', metaVersion: 2, fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'diff', type: 'diff', when: 'always' }] },
  { key: 'reviewer', displayName: 'Review', color: 'peach', metaVersion: 2, fanOut: false, asksQuestions: false,
    verdict: { filename: 'review-cycle{cycle}.json' },
    inputs: [{ id: 'diff', type: 'diff', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];
const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false },
];
// The real GET /api/config envelope: {config, models, steps, efforts, subagentModels} (ui/server.mjs:3044-3050).
function configBody() {
  return { config: { steps: {}, customModels: [], workflows: {} }, models: MODELS, steps: [], efforts: ['medium', 'high', 'xhigh', 'max'],
    subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'] };
}

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = url.split('?')[0];
    if (path === `/api/ask/threads/${TID}/attachments/att_00000001`) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('hello').buffer, json: async () => ({}) };
    if (path === `/api/ask/threads/${TID}/attachments/att_00000002`) return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, json: async () => ({}) };
    if (path.startsWith(`/api/ask/threads/${TID}/attachments/`)) return { ok: false, status: 404, json: async () => ({ error: 'attachment not found' }) };
    if (recorder.laneFail && path === '/api/agents') return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    if (path === '/api/workflows/wf_default' || path === '/api/workflows/wf_review') return { ok: true, status: 200, json: async () => ({ ...WF_DEFAULT_TPL, id: path.split('/').pop(), name: path.endsWith('wf_review') ? 'Review only' : 'Default' }) };
    if (path === '/api/agents') return { ok: true, status: 200, json: async () => ({ agents: AGENTS, mockWriterRoles: [] }) };
    if (path === '/api/config' && method === 'GET') {
      recorder.configGets = [...(recorder.configGets || []), url];
      return { ok: true, status: 200, json: async () => configBody() };
    }
    if (path === '/api/config' && (method === 'PATCH' || method === 'POST')) {
      recorder.configWrites = [...(recorder.configWrites || []), { method, body: JSON.parse(opts.body) }];
      recorder.order = [...(recorder.order || []), `config:${method}`];
      if (recorder.configResponse) return recorder.configResponse;
      return { ok: true, status: 200, json: async () => ({ config: configBody().config }) };
    }
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }, { name: 'other', path: '/repos/other', exists: false }] }) };
    if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) };
    if (url === '/api/guardrails') return { ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }, { id: 'strict', name: 'Strict' }] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) };
    if (url.startsWith('/api/branches')) {
      recorder.branchCalls = [...(recorder.branchCalls || []), url];
      return { ok: true, status: 200, json: async () => ({ branches: ['main', 'dev'] }) };
    }
    if (url === '/api/run' && method === 'POST') {
      recorder.order = [...(recorder.order || []), 'run'];
      recorder.runBodies = [...(recorder.runBodies || []), JSON.parse(opts.body)];
      if (recorder.runResponse) return recorder.runResponse;
      return { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) };
    }
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.dismissBodies = [...(recorder.dismissBodies || []), JSON.parse(opts.body)];
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'dismissed', card: PROJECT_CARD } }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [{ id: 'att_00000001', threadId: TID, messageId: null, name: 'notes.md', bytes: 5, kind: 'text', mime: null, createdAt: 't' }, { id: 'att_00000002', threadId: TID, messageId: null, name: 'shot.png', bytes: 3, kind: 'image', mime: 'image/png', createdAt: 't' }], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openWithCard(card, recorder = {}, overrides = {}) {
  const ctx = makePanel({ fetchHandler: apiHandler(recorder), ...overrides });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card } },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  await ctx.tick(); await ctx.tick(); // option lists load
  ctx.flush();
  return ctx;
}

async function laneOf(ctx) { await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush(); return ctx.doc.querySelector('.ask-rp-lane'); }

test('ask-panel-card: proposed project card renders the form; Start posts the exact §9.4 body', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  assert.ok(cardEl);
  assert.equal(cardEl.querySelector('.ask-card-brief').value, 'Fix the login bug');
  const guard = cardEl.querySelector('.ask-card-guardrails');
  assert.equal(guard.value, 'normal', 'default normal selected');
  assert.ok([...guard.options].some((o) => o.value === 'permissive'), 'Permissive IS offered on the card (user choice, §9.3)');
  const proj = cardEl.querySelector('.ask-card-project-select');
  assert.equal(proj.value, '/repos/proj');
  assert.match([...proj.options].find((o) => o.value === '/repos/other').textContent, /\(missing\)/);
  const src = cardEl.querySelector('.ask-card-source');
  assert.equal(src.options[0].value, '', 'current branch (auto) first');
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies.length, 1);
  assert.deepEqual(rec.runBodies[0], {
    projectDir: '/repos/proj', prompt: 'Fix the login bug', workflowId: 'wf_default', guardrailsId: 'normal',
    title: 'Fix login', featureBranch: 'worca/fix-login', mock: false, askThreadId: TID, askCardId: CARD_ID,
  });
});

test('ask-panel-card: edits flow into the Start body', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  cardEl.querySelector('.ask-card-workflow').value = 'wf_review';
  cardEl.querySelector('.ask-card-guardrails').value = 'strict';
  cardEl.querySelector('.ask-card-brief').value = 'Review it instead';
  cardEl.querySelector('.ask-card-feature').value = 'worca/review-1';
  cardEl.querySelector('.ask-card-source').value = 'dev';
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.runBodies[0], {
    projectDir: '/repos/proj', prompt: 'Review it instead', workflowId: 'wf_review', guardrailsId: 'strict',
    title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/review-1', mock: false, askThreadId: TID, askCardId: CARD_ID,
  });
  cardEl.querySelector('.ask-card-guardrails').value = 'permissive';
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies[1].guardrailsId, 'permissive', 'guardrailsId is ALWAYS sent — even permissive (spec §9.4; New Pipeline\'s omit-when-default convention must NOT leak in)');
});

test('ask-panel-card: switching the project reloads its branches', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const before = (rec.branchCalls || []).length;
  const proj = ctx.doc.querySelector('.ask-card-project-select');
  proj.value = '/repos/other';
  proj.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.branchCalls.length, before + 1);
  assert.match(rec.branchCalls.at(-1), /projectDir=%2Frepos%2Fother/);
});

test('ask-panel-card: workspace card — members, per-member sources, workspace body', async () => {
  const rec = {};
  const ctx = await openWithCard(WS_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  assert.match(cardEl.querySelector('.ask-card-members').textContent, /proj/);
  assert.match(cardEl.querySelector('.ask-card-members').textContent, /lib/);
  const memberInputs = [...cardEl.querySelectorAll('.ask-card-member-src')];
  assert.equal(memberInputs.length, 2);
  memberInputs[1].value = 'release';
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.runBodies[0], {
    workspaceId: 'wks-team-00000001', prompt: 'Fix the login bug', workflowId: 'wf_default', guardrailsId: 'normal',
    title: 'Fix login', featureBranch: 'worca/fix-login', sourceBranchByKey: { 'lib-00000002': 'release' },
    mock: false, askThreadId: TID, askCardId: CARD_ID,
  });
});

test('ask-panel-card: switching the target segment to workspace posts the workspace body', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  cardEl.querySelector('[data-ask-card-seg="workspace"]').click();
  await ctx.tick(); await ctx.tick();
  const ws = cardEl.querySelector('.ask-card-workspace-select');
  assert.ok(ws, 'workspace select appears');
  assert.equal(ws.value, 'wks-team-00000001');
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies[0].workspaceId, 'wks-team-00000001');
  assert.equal(rec.runBodies[0].projectDir, undefined);
});

test('ask-panel-card: a 403 renders in .ask-card-err and Start stays enabled', async () => {
  const rec = { runResponse: { ok: false, status: 403, json: async () => ({ error: 'total cost limit reached' }) } };
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(cardEl.querySelector('.ask-card-err').textContent, 'total cost limit reached');
  assert.equal(cardEl.querySelector('[data-ask-card-start]').disabled, false);
  assert.ok(cardEl.querySelector('.ask-card-brief'), 'still the editable form');
});

test('ask-panel-card: Not now posts the dismiss; the flip frame renders the stub', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  ctx.doc.querySelector('[data-ask-card-dismiss]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.dismissBodies, [{ state: 'dismissed' }]);
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'dismissed', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  const stub = ctx.doc.querySelector('.ask-card-stub');
  assert.ok(stub, 'one-line dismissed stub');
  assert.equal(ctx.doc.querySelector('.ask-card-brief'), null, 'form gone');
});

test('ask-panel-card: the started flip renders the run link read-only', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'started', runId: 'run-uuid-1', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  const link = ctx.doc.querySelector('.ask-card a[href="#running/run-uuid-1"]');
  assert.ok(link, 'links to the running view');
  assert.equal(ctx.doc.querySelector('.ask-card-brief'), null, 'no editable fields after start');
});

test('ask-panel-card: a proposed re-emit never clobbers local edits', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  const brief = ctx.doc.querySelector('.ask-card-brief');
  brief.value = 'my local edit';
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-card-brief').value, 'my local edit');
});

test('ask-panel-card: Open in New Pipeline hands over the CURRENT values', async () => {
  const handoffs = [];
  const rec = {};
  const ctx = makePanel({ fetchHandler: apiHandler(rec), openNewPipeline: (p) => handoffs.push(p) });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  for (const f of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card: PROJECT_CARD } },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  await ctx.tick(); await ctx.tick();
  ctx.flush();
  ctx.doc.querySelector('.ask-card-brief').value = 'edited brief';
  ctx.doc.querySelector('[data-ask-card-open-np]').click();
  assert.equal(handoffs.length, 1);
  assert.deepEqual(handoffs[0], {
    target: 'project', projectDir: '/repos/proj', workflowId: 'wf_default', guardrailsId: 'normal',
    prompt: 'edited brief', title: 'Fix login', sourceBranch: '', featureBranch: 'worca/fix-login',
    memoryScope: null,
  });
});

// Agent memory (§7.3 / B17): a Memory defragment proposal carries the scope it restructures. Both
// exits of the card must keep it — Start sends it in the run body, Open in New Pipeline hands it to
// the picker, which would otherwise default to `global` and restructure the wrong scope.
const MEM_WORKFLOWS = [{ id: 'wf_default', name: 'Default' }, { id: 'wf_memory_defrag', name: 'Memory defragment' }];
const MEM_CARD = { ...PROJECT_CARD, workflowId: 'wf_memory_defrag', workflowName: 'Memory defragment',
  memoryScope: 'project', brief: 'Defragment the memory of project proj.', title: 'Memory defragment: proj' };
function memHandler(rec) {
  const base = apiHandler(rec);
  return (url, opts) => {
    const path = String(url).split('?')[0];
    if (path === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: MEM_WORKFLOWS }) };
    if (path === '/api/workflows/wf_memory_defrag') return { ok: true, status: 200, json: async () => ({ ...WF_DEFAULT_TPL, id: 'wf_memory_defrag', name: 'Memory defragment' }) };
    return base(url, opts);
  };
}

test('ask-panel-card: a Memory defragment proposal sends memoryScope with Start', async () => {
  const rec = {};
  const ctx = await openWithCard(MEM_CARD, rec, { fetchHandler: memHandler(rec) });
  assert.equal(ctx.doc.querySelector('.ask-card-workflow').value, 'wf_memory_defrag');
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.equal(rec.runBodies.length, 1);
  assert.equal(rec.runBodies[0].workflowId, 'wf_memory_defrag');
  assert.equal(rec.runBodies[0].memoryScope, 'project');
});

test('ask-panel-card: a Memory defragment proposal hands memoryScope to New Pipeline', async () => {
  const rec = {};
  const handed = [];
  const ctx = await openWithCard(MEM_CARD, rec, { fetchHandler: memHandler(rec), openNewPipeline: (p) => handed.push(p) });
  ctx.doc.querySelector('[data-ask-card-open-np]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.equal(handed.length, 1);
  assert.equal(handed[0].workflowId, 'wf_memory_defrag');
  assert.equal(handed[0].memoryScope, 'project');
});

test('ask-panel-card v2: head shows kicker, editable title and the note; the title edit posts as title', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const card = ctx.doc.querySelector('.ask-card.ask-rp');
  assert.ok(card, 'v2 root class');
  assert.equal(card.querySelector('.ask-rp-kicker').textContent, 'Run proposal');
  assert.equal(card.querySelector('.ask-rp-why').textContent, 'UI-only change on one module.');
  const title = card.querySelector('.ask-rp-title input');
  assert.equal(title.value, 'Fix login');
  title.value = '  Fix login properly ';
  card.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies[0].title, 'Fix login properly');
});

test('ask-panel-card v2: no note → no why line; guardrails carries its plain-words description', async () => {
  const ctx = await openWithCard({ ...PROJECT_CARD, note: null });
  const card = ctx.doc.querySelector('.ask-card.ask-rp');
  assert.equal(card.querySelector('.ask-rp-why'), null);
  assert.equal(card.querySelector('.ask-rp-wfdesc[data-for="guardrails"]').textContent, 'Applies to every agent in this run');
  assert.ok(card.querySelector('.ask-rp-wfdesc[data-for="workflow"]'), 'the workflow description line exists — its text is painted by the lane loader (a later task), whose test pins it');
});

test('ask-panel-card v2: the lane renders one two-line tile per agent with effective values', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const lane = await laneOf(ctx);
  assert.ok(rec.configGets.some((u) => u.includes('projectDir=%2Frepos%2Fproj')), 'config fetched for the card\'s project');
  const tiles = [...lane.querySelectorAll('.ask-rp-tile')];
  assert.deepEqual(tiles.map((t) => t.dataset.nodeId), ['n_plan', 'n_impl', 'n_rev']);
  assert.deepEqual(tiles.map((t) => t.querySelector('.ask-rp-name b').textContent), ['Plan', 'Implement', 'Review']);
  assert.equal(tiles[0].querySelector('.ask-rp-name small').textContent, 'step 1 · workflow default', 'caption counts lane position, not the task card');
  const impl = tiles[1];
  assert.equal(impl.querySelector('.ask-rp-model').value, 'claude-opus-5');
  assert.equal(impl.querySelector('.ask-rp-eff button.on').textContent, 'high');
  assert.equal(impl.querySelector('.ask-rp-tile-l2 [data-ctl="fanOut"]').checked, true, 'registry fanOut default');
  assert.equal(impl.querySelector('.ask-rp-tile-l2 [data-ctl="questions"]').checked, false);
  assert.equal(tiles[2].querySelector('[data-ctl="questions"]'), null, 'no questions capability → no switch');
  assert.ok(tiles[0].querySelector('.ask-rp-eff').classList.contains('unset'), 'no model → inherits workflow');
  assert.equal(ctx.doc.querySelector('.ask-rp-summary').textContent, '3 agents · inherit ×2 · Opus 5 ×1 · 1 fan-out');
  assert.equal(ctx.doc.querySelector('.ask-rp-wfdesc[data-for="workflow"]').textContent, '3 agents · 1 loop · Review → Implement, max 3 cycles');
});

test('ask-panel-card v2: editing tints the tile, updates the sub-line and summary; Reset returns to the proposal', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  const lane = await laneOf(ctx);
  const plan = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"]');
  const sel = plan.querySelector('.ask-rp-model');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  const plan2 = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"]');
  assert.ok(plan2.classList.contains('mod'));
  assert.equal(plan2.querySelector('.ask-rp-eff button.on').textContent, 'high', 'model change picks the second effort the model offers');
  assert.equal(plan2.querySelector('.ask-rp-eff button[disabled]').textContent, 'xhigh', 'efforts the model lacks are disabled');
  assert.match(lane.querySelector('.ask-rp-sec-sub').textContent, /you changed 1 agent · 1 override/);
  assert.match(lane.querySelector('.ask-rp-agents-foot').textContent, /Edits become this project's defaults for Default/);
  assert.equal(ctx.doc.querySelector('.ask-rp-summary').textContent, '3 agents · Haiku 4.5 ×1 · Opus 5 ×1 · inherit ×1 · 1 fan-out');
  lane.querySelector('.ask-rp-mini').click();
  assert.ok(!lane.querySelector('.ask-rp-tile[data-node-id="n_plan"]').classList.contains('mod'));
  assert.equal(lane.querySelector('.ask-rp-mini').hidden, true);
});

test('ask-panel-card v2: workspace target → lane read-only from the built-in catalog (D6)', async () => {
  const rec = {};
  const ctx = await openWithCard(WS_CARD, rec);
  const lane = await laneOf(ctx);
  assert.ok(rec.configGets.some((u) => u === '/api/config'), 'no projectDir for a workspace');
  const controls = [...lane.querySelectorAll('select,input,button.ask-rp-effbtn')];
  assert.ok(controls.length > 5, 'the tiles rendered');
  for (const c of controls) assert.equal(c.disabled, true);
  assert.match(lane.querySelector('.ask-rp-agents-foot').textContent, /per project/);
});

test('ask-panel-card v2: a failed lane fetch says so and leaves Start usable', async () => {
  const rec = { laneFail: true };
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const lane = await laneOf(ctx);
  assert.equal(lane.querySelector('.ask-rp-lane-msg').textContent, 'Could not load agent settings.');
  ctx.doc.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies.length, 1);
});

test('ask-panel-card v2: Start writes every edited row (pruned) BEFORE /api/run — per-role for wf_default, per-node otherwise', async () => {
  const rec = {};
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const lane = await laneOf(ctx);
  const planSel = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"] .ask-rp-model');
  planSel.value = 'claude-haiku-4-5';
  planSel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  const implFan = lane.querySelector('.ask-rp-tile[data-node-id="n_impl"] [data-ctl="fanOut"]');
  implFan.checked = false;
  implFan.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.deepEqual(rec.order, ['config:POST', 'config:POST', 'run'], 'wf_default rows persist per ROLE, all before the run');
  assert.deepEqual(rec.configWrites[0].body, { projectDir: '/repos/proj', step: 'planner', model: 'claude-haiku-4-5', effort: 'high', fanOut: null, askQuestions: null, subagentModel: '' });
  assert.deepEqual(rec.configWrites[1].body, { projectDir: '/repos/proj', step: 'implementer', model: '', effort: '', fanOut: false, askQuestions: null, subagentModel: '' });
});

test('ask-panel-card v2: a saved workflow persists per NODE via PATCH', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', workflowName: 'Review only' }, rec);
  const lane = await laneOf(ctx);
  const b = [...lane.querySelectorAll('.ask-rp-tile[data-node-id="n_impl"] .ask-rp-effbtn')].find((x) => x.textContent === 'max');
  b.click();
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.deepEqual(rec.order, ['config:PATCH', 'run']);
  assert.deepEqual(rec.configWrites[0].body, { projectDir: '/repos/proj', workflowId: 'wf_review', nodes: { n_impl: { model: 'claude-opus-5', effort: 'max', fanOut: null, askQuestions: null, subagentModel: '' } } });
});

test('ask-panel-card v2: a failed config write shows inline and the run is NOT started', async () => {
  const rec = { configResponse: { ok: false, status: 400, json: async () => ({ error: 'model "claude-haiku-4-5" does not support effort "max"' }) } };
  const ctx = await openWithCard(PROJECT_CARD, rec);
  const lane = await laneOf(ctx);
  const sel = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"] .ask-rp-model');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.equal(rec.runBodies, undefined);
  assert.equal(ctx.doc.querySelector('.ask-card-err').textContent, 'could not save Plan: model "claude-haiku-4-5" does not support effort "max"');
  assert.equal(ctx.doc.querySelector('[data-ask-card-start]').disabled, false);
});

test('ask-panel-card v2: Open in New Pipeline saves the edits too, then hands over', async () => {
  const rec = {};
  const handed = [];
  const ctx = await openWithCard(PROJECT_CARD, rec, { openNewPipeline: (p) => handed.push(p) });
  const lane = await laneOf(ctx);
  const sel = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"] .ask-rp-model');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  ctx.doc.querySelector('[data-ask-card-open-np]').click();
  assert.equal(handed.length, 0, 'the save comes first');
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.deepEqual(rec.order, ['config:POST']);
  assert.equal(handed.length, 1);
  assert.equal(handed[0].title, 'Fix login');
  // After a successful save the lane re-reads the persisted config (local.reloadLane): the pending edit is gone,
  // the tile no longer reads "edited". (The harness's config GET is static, so the tile shows the proposal again.)
  assert.ok(!lane.querySelector('.ask-rp-tile[data-node-id="n_plan"]').classList.contains('mod'), 'no pending edit survives the save');
  assert.equal(lane.querySelector('.ask-rp-mini').hidden, true);
});

test('ask-panel-card v2: brief autosizes with a live count; pills come from card.attachments and are removable', async () => {
  const ctx = await openWithCard({ ...PROJECT_CARD, attachments: [{ id: 'att_00000001', name: 'notes.md', bytes: 5, kind: 'text' }] });
  const card = ctx.doc.querySelector('.ask-rp');
  assert.equal(card.querySelector('.ask-rp-count').textContent, '17 chars');
  const pills = card.querySelectorAll('.ask-rp-pill');
  assert.equal(pills.length, 1);
  assert.equal(pills[0].textContent.replace('×', '').trim(), '@notes.md');
  pills[0].querySelector('button').click();
  assert.equal(card.querySelectorAll('.ask-rp-pill').length, 0);
  assert.equal(card.querySelector('.ask-card-brief').value, 'Fix the login bug', 'removing a pill leaves the text (D9)');
});

test('ask-panel-card v2: Start posts pills as extras (base64), no extras key without pills', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...PROJECT_CARD, attachments: [{ id: 'att_00000001', name: 'notes.md', bytes: 5, kind: 'text' }, { id: 'att_00000002', name: 'shot.png', bytes: 3, kind: 'image' }] }, rec);
  await laneOf(ctx);
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.deepEqual(rec.runBodies[0].extras, [{ name: 'notes.md', dataBase64: 'aGVsbG8=' }, { name: 'shot.png', dataBase64: 'AQID' }]);
  const rec2 = {};
  const ctx2 = await openWithCard(PROJECT_CARD, rec2);
  await laneOf(ctx2);
  ctx2.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx2.tick();
  assert.ok(!('extras' in rec2.runBodies[0]));
});

test('ask-panel-card v2: @ opens the attachment popover; picking inserts @name and adds the pill', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  const card = ctx.doc.querySelector('.ask-rp');
  const brief = card.querySelector('.ask-card-brief');
  brief.value = 'See @';
  brief.setSelectionRange(5, 5);
  brief.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  const pop = ctx.doc.querySelector('.ask-pop-at');
  assert.ok(pop, 'popover opened');
  assert.equal(ctx.doc.activeElement, brief, 'the picker never steals the caret (openPopover focuses its first item; the brief takes focus back)');
  const items = [...pop.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
  assert.deepEqual(items, ['notes.md', 'shot.png']);
  brief.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(ctx.doc.activeElement, pop.querySelector('[role="menuitem"]'), 'ArrowDown enters the list (then the popover\'s own arrow/Enter/Escape handling applies)');
  pop.querySelector('[role="menuitem"]').click();
  assert.equal(brief.value, 'See @notes.md');
  assert.equal(card.querySelectorAll('.ask-rp-pill').length, 1);
  assert.equal(ctx.doc.querySelector('.ask-pop-at'), null, 'closed after the pick');
  assert.equal(ctx.doc.activeElement, brief, 'focus returns to the brief after the pick');
  brief.value = 'See @notes.md @';
  brief.setSelectionRange(15, 15);
  brief.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.deepEqual([...ctx.doc.querySelectorAll('.ask-pop-at [role="menuitem"]')].map((i) => i.textContent), ['shot.png'], 'already-pilled files are not offered');
  brief.value = 'See @notes.md @s';
  brief.setSelectionRange(16, 16);
  brief.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(ctx.doc.querySelector('.ask-pop-at'), null, 'typing past the @ closes the picker (it never filters)');
});

test('ask-panel-card v2: the @ picker flips above the brief when the sheet would chop it', async () => {
  const ctx = await openWithCard(PROJECT_CARD);
  const card = ctx.doc.querySelector('.ask-rp');
  const sheet = ctx.doc.querySelector('[data-ask-sheet]');
  const brief = card.querySelector('.ask-card-brief');
  // jsdom lays nothing out, so the geometry is stated: a 669px sheet with the brief low in it
  // (bottom 620) and a 300px panel — under the brief the panel would end at 926, outside the
  // sheet, and .ask-sheet is overflow:hidden.
  sheet.getBoundingClientRect = () => ({ top: 0, bottom: 669, left: 0, right: 821, width: 821, height: 669 });
  Object.defineProperty(sheet, 'clientHeight', { configurable: true, value: 669 });
  brief.getBoundingClientRect = () => ({ top: 560, bottom: 620, left: 24, right: 700, width: 676, height: 60 });
  Object.defineProperty(ctx.window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return this.classList && this.classList.contains('ask-pop-at') ? 300 : 0; },
  });
  brief.value = 'See @';
  brief.setSelectionRange(5, 5);
  brief.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  const pop = ctx.doc.querySelector('.ask-pop-at');
  assert.ok(pop, 'popover opened');
  assert.equal(pop.style.top, '254px', 'flipped above the brief (chipPickerTop), not 612px under it');
  assert.ok(Number.parseFloat(pop.style.top) + 300 <= 669, 'the panel ends inside the sheet');
});

test('ask-panel-card v2: the "Where it runs" sub-line catches up with the branch list', async () => {
  const ctx = await openWithCard({ ...PROJECT_CARD, sourceBranch: 'dev' });
  const card = ctx.doc.querySelector('.ask-rp');
  await ctx.tick(); await ctx.tick();
  assert.equal(card.querySelector('.ask-card-source').value, 'dev', 'the proposed branch is selected once /api/branches lands');
  assert.equal(card.querySelector('.ask-rp-sec .ask-rp-sec-sub').textContent, 'proj · branch dev · feature worca/fix-login',
    'the sub-line re-reads the select after the async fill (never stays on "branch current")');
});

test('ask-panel-card v2: Start freezes the target inputs while it awaits (the saved config and the run body can never disagree)', async () => {
  const rec = {};
  let release = null;
  const held = new Promise((r) => { release = r; });
  const base = apiHandler(rec);
  const ctx = await openWithCard({ ...PROJECT_CARD, attachments: [{ id: 'att_00000001', name: 'notes.md', bytes: 5, kind: 'text' }] }, rec, {
    fetchHandler: (url, opts) => (url.includes('/attachments/att_00000001') ? held.then(() => base(url, opts)) : base(url, opts)),
  });
  await laneOf(ctx);
  const wf = ctx.doc.querySelector('.ask-card-workflow');
  const proj = ctx.doc.querySelector('.ask-card-project-select');
  const segWs = ctx.doc.querySelector('[data-ask-card-seg="workspace"]');
  ctx.doc.querySelector('[data-ask-card-start]').click();
  await ctx.tick();
  assert.deepEqual([wf.disabled, proj.disabled, segWs.disabled], [true, true, true], 'workflow, project and the target segment are frozen for the awaits');
  release();
  for (let i = 0; i < 8; i++) await ctx.tick();
  assert.deepEqual([wf.disabled, proj.disabled, segWs.disabled], [false, false, false], 'released when Start finishes');
  assert.equal(rec.runBodies.length, 1);
  assert.equal(ctx.doc.querySelector('[data-ask-card-start]').disabled, false);
});

test('ask-panel-card v2: Open in New Pipeline disables itself for its async path (a second click cannot hand over twice)', async () => {
  const rec = {};
  const handed = [];
  const ctx = await openWithCard(PROJECT_CARD, rec, { openNewPipeline: (p) => handed.push(p) });
  const lane = await laneOf(ctx);
  const sel = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"] .ask-rp-model');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  const openNp = ctx.doc.querySelector('[data-ask-card-open-np]');
  openNp.click();
  assert.equal(openNp.disabled, true, 'disabled for the extras fetch + the save round');
  openNp.click();
  for (let i = 0; i < 8; i++) await ctx.tick();
  assert.equal(handed.length, 1, 'one handover');
  assert.equal(rec.configWrites.length, 1, 'one save round');
  assert.equal(openNp.disabled, false, 'released when the handover lands');
});

test('ask-panel-card v2: extras over 5 MB refuse inline BEFORE any config write; an unreadable attachment refuses inline', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...PROJECT_CARD, attachments: [{ id: 'att_00000001', name: 'big.md', bytes: 6 * 1024 * 1024, kind: 'text' }] }, rec);
  const lane = await laneOf(ctx);
  const sel = lane.querySelector('.ask-rp-tile[data-node-id="n_plan"] .ask-rp-model');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  ctx.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-card-err').textContent, 'attachments exceed 5 MB — remove one');
  assert.equal(rec.runBodies, undefined);
  assert.equal(rec.configWrites, undefined, 'the extras check runs first, so a refusal persists nothing');
  const rec2 = {};
  const ctx2 = await openWithCard({ ...PROJECT_CARD, attachments: [{ id: 'att_deadbeef', name: 'gone.md', bytes: 1, kind: 'text' }] }, rec2);
  await laneOf(ctx2);
  ctx2.doc.querySelector('[data-ask-card-start]').click();
  for (let i = 0; i < 6; i++) await ctx2.tick();
  assert.equal(ctx2.doc.querySelector('.ask-card-err').textContent, 'could not read attachment gone.md');
  assert.equal(rec2.runBodies, undefined);
  assert.equal(ctx2.doc.querySelector('[data-ask-card-start]').disabled, false);
});

test('workflow card: openComposer receives the workflowId; dropping the card (new thread) disposes the graph mount', async () => {
  const opened = [];
  const ctx = makePanel({ fetchHandler: apiHandler({}), resizeObserver: true, deps: { openComposer: (id) => opened.push(id) } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const { proposalFor } = await import('./helpers/auto-proposal-fixture.mjs');
  const card = { type: 'workflow', mode: 'task', projectKey: 'p', projectName: 'p', note: '', thenRun: false, shape: {}, summary: '', adopted: false, ...proposalFor() };
  for (const f of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: 'card_0000ab02', state: 'saved', workflowId: 'wf_x', card } },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush(); await ctx.tick(); ctx.flush();
  ctx.doc.querySelector('[data-ask-wf-open]').click();
  assert.deepEqual(opened, ['wf_x']);
  const graphObservers = ctx.resizeObservers.filter((o) => o.targets.some((t) => t.classList && t.classList.contains('ask-wfcard-graph')));
  assert.equal(graphObservers.length, 1, 'mountStaticGraph observed the graph host');
  ctx.doc.querySelector('[data-ask-new-btn]').click();
  ctx.flush();
  assert.ok(graphObservers[0].disconnected, 'newThread pruned the card and destroyed the mount');
});

// ---- Scheduled runs (docs/scheduled-runs.md "Ask Worca") ----
const ONCE = { kind: 'once', runAt: '2026-09-19T00:00:00.000Z', when: 'Sat Sep 19, 02:00', timeZone: 'Europe/Berlin' };
const REPEAT = {
  kind: 'repeat', rule: { freq: 'weekly', interval: 1, time: '02:00', tz: 'Europe/Berlin', weekdays: ['mo', 'tu', 'we', 'th', 'fr'], anchor: '2026-09-18', end: { type: 'never' } },
  sentence: 'Every weekday at 02:00', next: [{ at: '2026-09-21T00:00:00.000Z', when: 'Mon Sep 21, 02:00' }], overlap: 'skip', maxFailures: 3, timeZone: 'Europe/Berlin',
};

test('ask-panel-card: a proposal Ask Worca scheduled makes Schedule the primary action; Start now is the alternative', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...PROJECT_CARD, schedule: ONCE }, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  const line = cardEl.querySelector('[data-ask-card-sched-proposed]');
  assert.ok(line, 'the schedule line');
  assert.equal(line.querySelector('.badge').textContent, 'Scheduled');
  assert.match(line.querySelector('.ask-card-sched-text').textContent, /^Starts [A-Z][a-z]{2} Sep 1[89], \d{2}:00$/);
  assert.ok(line.querySelector('[data-ask-card-sched-change]'), 'Change… opens the sheet');
  const go = cardEl.querySelector('[data-ask-card-start]');
  assert.equal(go.textContent, 'Schedule');
  assert.equal(cardEl.querySelector('[data-ask-card-schedule]'), null, 'no second Schedule… button');
  assert.equal(cardEl.querySelector('[data-ask-card-start-now]').dataset.minLevel, undefined, 'the answer is never gated (ui-levels rule 4)');
  go.click();
  await ctx.tick(); await ctx.tick();
  assert.equal(rec.runBodies.at(-1).scheduledFor, ONCE.runAt);
  cardEl.querySelector('[data-ask-card-start-now]').click();
  await ctx.tick(); await ctx.tick();
  assert.equal('scheduledFor' in rec.runBodies.at(-1), false, 'Start now starts now');
});

test('ask-panel-card: a repeating proposal posts repeat; a plain card keeps its Advanced "Schedule…"', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...PROJECT_CARD, schedule: REPEAT }, rec);
  const cardEl = ctx.doc.querySelector('.ask-card');
  assert.equal(cardEl.querySelector('[data-ask-card-sched-proposed] .badge').textContent, 'Repeats');
  assert.match(cardEl.querySelector('.ask-card-sched-text').textContent, /^Every weekday at 02:00 · first run /);
  cardEl.querySelector('[data-ask-card-start]').click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.runBodies.at(-1).repeat, { rule: REPEAT.rule, overlap: 'skip', maxFailures: 3 });
  const plain = await openWithCard(PROJECT_CARD);
  assert.equal(plain.doc.querySelector('[data-ask-card-schedule]').dataset.minLevel, 'advanced');
  assert.equal(plain.doc.querySelector('[data-ask-card-start]').textContent, 'Start run');
});

test('ask-panel-card: a card that became a repeating schedule follows the series (Run now / Delete schedule)', async () => {
  const calls = [];
  const rec = {};
  const base = apiHandler(rec);
  const ctx = await openWithCard(PROJECT_CARD, rec, { fetchHandler: (url, opts) => {
    if (url.startsWith('/api/schedules/')) { calls.push([(opts.method || 'GET').toUpperCase(), url]); return { ok: true, status: 200, json: async () => ({ runId: 'r', status: 'fired' }) }; }
    return base(url, opts);
  } });
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'scheduled', scheduleId: 'sch_0000abcd', sentence: 'Every weekday at 02:00', scheduledFor: '2026-09-21T00:00:00.000Z', card: PROJECT_CARD }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  const el = ctx.doc.querySelector('[data-ask-card-scheduled]');
  assert.ok(el);
  assert.equal(el.querySelector('.badge').textContent, 'Repeats');
  assert.match(el.querySelector('.ask-card-sched-text').textContent, /^Fix login — Every weekday at 02:00 · next /);
  const [runNow, del] = [...el.querySelectorAll('button')];
  assert.equal(del.textContent, 'Delete schedule');
  runNow.click();
  await ctx.tick();
  assert.deepEqual(calls[0], ['POST', '/api/schedules/sch_0000abcd/run-now']);
});

test('schedule card: before / after, Decline and the action\'s own Apply post the card verbs; applied shows the result', async () => {
  const rec = { cardPosts: [] };
  const base = apiHandler(rec);
  const ctx = await openWithCard(PROJECT_CARD, rec, { fetchHandler: (url, opts) => {
    const m = /^\/api\/ask\/threads\/[^/]+\/cards\/(card_[0-9a-f]{8})$/.exec(url);
    if (m && (opts.method || '').toUpperCase() === 'POST' && m[1] !== CARD_ID) { rec.cardPosts.push([m[1], JSON.parse(opts.body)]); return { ok: true, status: 200, json: async () => ({}) }; }
    return base(url, opts);
  } });
  const card = { type: 'schedule', action: 'move', id: 'u-1', itemKind: 'once', title: 'Upgrade deps', targetName: 'shop', status: 'scheduled', scheduleId: null,
    note: 'you asked for later', summary: 'Move "Upgrade deps" from Sat Sep 19, 02:00 to Sat Sep 19, 06:00',
    before: { when: 'Sat Sep 19, 02:00', at: '2026-09-19T00:00:00.000Z' }, after: { when: 'Sat Sep 19, 06:00', at: '2026-09-19T04:00:00.000Z' }, patch: { scheduledFor: '2026-09-19T04:00:00.000Z' } };
  const SC_ID = 'card_00000008';
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: SC_ID, state: 'proposed', card }, threadId: TID, messageId: MID, seq: 3 });
  ctx.flush();
  const el = ctx.doc.querySelector('[data-ask-scard="proposed"]');
  assert.ok(el);
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Proposed schedule change');
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Change time');
  assert.deepEqual([...el.querySelectorAll('.ask-scard-k')].map((x) => x.textContent), ['From', 'To']);
  assert.equal(el.querySelector('[data-ask-sc-apply]').textContent, 'Move');
  el.querySelector('[data-ask-sc-apply]').click();
  await ctx.tick();
  assert.deepEqual(rec.cardPosts.at(-1), [SC_ID, { state: 'applied' }]);
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: SC_ID, state: 'applied', card: { ...card, result: { ok: true, detail: 'now at Sat Sep 19, 06:00' } } }, threadId: TID, messageId: MID, seq: 4 });
  ctx.flush();
  const done = ctx.doc.querySelector('[data-ask-scard="applied"]');
  assert.equal(done.querySelector('.ask-mcard-detail').textContent, 'now at Sat Sep 19, 06:00');
  assert.ok(done.querySelector('a[href="#schedules"]'));
  const del = { ...card, action: 'delete', itemKind: 'recurring', summary: 'Delete the schedule "Nightly"' };
  ctx.panel.pushServerFrame({ type: 'ask-card', block: { kind: 'card', id: 'card_00000009', state: 'proposed', card: del }, threadId: TID, messageId: MID, seq: 5 });
  ctx.flush();
  const apply = ctx.doc.querySelector('[data-ask-scard="proposed"] [data-ask-sc-apply]');
  assert.equal(apply.textContent, 'Delete');
  assert.ok(apply.classList.contains('is-danger'), 'a removal reads as one');
});
