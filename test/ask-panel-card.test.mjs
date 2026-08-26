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
};
const WS_CARD = {
  ...PROJECT_CARD, target: 'workspace', projectKey: null, projectName: null, projectDir: null,
  workspaceId: 'wks-team-00000001', workspaceName: 'team',
  members: [{ projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/repos/lib' }],
  featureBranch: 'worca/fix-login', sourceBranchByKey: null,
};

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }, { name: 'other', path: '/repos/other', exists: false }] }) };
    if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) };
    if (url === '/api/guardrails') return { ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }, { id: 'strict', name: 'Strict' }] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) };
    if (url.startsWith('/api/branches')) {
      recorder.branchCalls = [...(recorder.branchCalls || []), url];
      return { ok: true, status: 200, json: async () => ({ branches: ['main', 'dev'] }) };
    }
    if (url === '/api/run' && method === 'POST') {
      recorder.runBodies = [...(recorder.runBodies || []), JSON.parse(opts.body)];
      if (recorder.runResponse) return recorder.runResponse;
      return { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) };
    }
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.dismissBodies = [...(recorder.dismissBodies || []), JSON.parse(opts.body)];
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'dismissed', card: PROJECT_CARD } }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openWithCard(card, recorder = {}) {
  const ctx = makePanel({ fetchHandler: apiHandler(recorder) });
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
  });
});
