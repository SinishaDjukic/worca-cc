// test/ask-panel-card-picks.test.mjs — the run card's per-run agent lane against per-PROJECT settings (this harness keys
// GET /api/config by its projectDir and can fail one project's load; test/ask-panel-card.test.mjs's cannot): Open in
// New run with "Save as project defaults", dropping a workspace pick, policy warnings that follow the picks, the footer,
// the marker's role, a picked row with another control edited, and the forced workspace fan-out in the summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { PROPOSAL_ERRORS } from '../src/core/ask/proposal.mjs';
import { modelFacts } from '../src/core/model-tiers.mjs';

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
};
const WF_TPL = { id: 'wf_default', name: 'Default', version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
          { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
          { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: { model: 'claude-opus-5-5', effort: 'high' } },
          { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
          { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
          { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
          { id: 'w3', from: { node: 'n_impl', port: 'diff' }, to: { node: 'n_rev', port: 'diff' } },
          { id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'revise' }, config: { maxCycles: 3 } },
          { id: 'w5', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };
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
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false },
];
const GPT = { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] };

// Per-project config: rec.cfg[projectDir || ''] = { steps, workflows }; rec.failDirs = [dirs whose /api/config fails].
function apiHandler(rec = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    const [path, query = ''] = url.split('?');
    const dir = new URLSearchParams(query).get('projectDir') || '';
    if (path === '/api/workflows/wf_default' || path === '/api/workflows/wf_review') return { ok: true, status: 200, json: async () => ({ ...WF_TPL, id: path.split('/').pop(), name: path.endsWith('wf_review') ? 'Review only' : 'Default' }) };
    if (path === '/api/agents') return { ok: true, status: 200, json: async () => ({ agents: rec.agents || AGENTS, mockWriterRoles: [] }) };
    if (path === '/api/config' && method === 'GET') {
      rec.configGets = [...(rec.configGets || []), url];
      if ((rec.failDirs || []).includes(dir)) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      const c = (rec.cfg || {})[dir] || {};
      return { ok: true, status: 200, json: async () => ({ config: { steps: c.steps || {}, customModels: [], workflows: c.workflows || {} }, models: [...MODELS, ...(rec.extraModels || [])], steps: [], efforts: ['medium', 'high', 'xhigh', 'max'], subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'] }) };
    }
    if (path === '/api/config' && (method === 'PATCH' || method === 'POST')) {
      const body = JSON.parse(opts.body);
      rec.configWrites = [...(rec.configWrites || []), { method, body }];
      rec.order = [...(rec.order || []), `config:${method}`];
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (path === '/api/run-defaults') return { ok: true, status: 200, json: async () => ({ engine: { value: rec.runEngine || 'claude', source: 'default' } }) };
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }, { name: 'proj2', path: '/repos/proj2', exists: true }] }) };
    if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) };
    if (url === '/api/guardrails') return { ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'normal', name: 'Normal' }] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) };
    if (url.startsWith('/api/branches')) return { ok: true, status: 200, json: async () => ({ branches: ['main'] }) };
    if (url === '/api/run' && method === 'POST') {
      rec.order = [...(rec.order || []), 'run'];
      rec.runBodies = [...(rec.runBodies || []), JSON.parse(opts.body)];
      return { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}
async function openWithCard(card, rec = {}, overrides = {}) {
  const ctx = makePanel({ fetchHandler: apiHandler(rec), ...overrides });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: CARD_ID, state: 'proposed', card } },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  await ctx.tick(); await ctx.tick();
  ctx.flush();
  return ctx;
}
async function laneOf(ctx) { for (let i = 0; i < 4; i++) await ctx.tick(); ctx.flush(); return ctx.doc.querySelector('.ask-rp-lane'); }
const tileOf = (lane, id) => lane.querySelector(`.ask-rp-tile[data-node-id="${id}"]`);
const change = (ctx, el, v) => { if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); };
const start = async (ctx, n = 8) => { ctx.doc.querySelector('[data-ask-card-start]').click(); for (let i = 0; i < n; i++) await ctx.tick(); };
const saveOn = (ctx) => change(ctx, ctx.doc.querySelector('.ask-rp-lane [data-ctl="saveDefaults"]'), true);

const NODES = {
  n_plan: { model: 'claude-opus-5-5', effort: 'high', reason: 'judgement' },
  n_impl: { model: 'claude-haiku-4-5', effort: 'medium', reason: 'small' },
  n_rev: { model: 'claude-opus-5-5', effort: '', reason: 'review' },
};

test('K1 Open in New run with "Save as project defaults" on waits for a loading lane, then saves the picks', async () => {
  const rec = {};
  const handed = [];
  const asked = [];
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: NODES }, rec, { openNewPipeline: (p) => handed.push(p), confirm: async (o) => { asked.push(o); return true; } });
  await laneOf(ctx);
  saveOn(ctx);
  change(ctx, ctx.doc.querySelector('.ask-card-engine'), 'claude');   // a reload starts
  ctx.doc.querySelector('[data-ask-card-open-np]').click();
  for (let i = 0; i < 12; i++) await ctx.tick();
  assert.equal(handed.length, 1);
  assert.deepEqual((rec.configWrites || []).map((w) => Object.keys(w.body.nodes || {})[0]), ['n_plan', 'n_impl', 'n_rev'], 'the picks were saved before the hand-over');
});

test('K1b Open in New run with "Save as project defaults" on but a lane that could not load asks first (nothing can be saved)', async () => {
  const rec = { failDirs: ['/repos/proj2'] };
  const handed = [];
  const asked = [];
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: NODES }, rec, { openNewPipeline: (p) => handed.push(p), confirm: async (o) => { asked.push(o); return false; } });
  await laneOf(ctx);
  saveOn(ctx);
  change(ctx, ctx.doc.querySelector('.ask-card-project-select'), '/repos/proj2');
  await laneOf(ctx);
  ctx.doc.querySelector('[data-ask-card-open-np]').click();
  for (let i = 0; i < 10; i++) await ctx.tick();
  assert.equal(asked.length, 1, 'the picks would stay behind: ask');
  assert.doesNotMatch(asked[0].message, /turn on "Save as project defaults"/, 'it is on already');
  assert.equal(handed.length, 0);
  assert.equal(rec.configWrites, undefined);
});

test('K2 workspace: a pick equal to the built-in row has "Use default" and is then left out of the overlay', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...WS_CARD, workflowId: 'wf_review', nodes: { n_impl: { model: 'claude-opus-5-5', effort: 'high', reason: 'wide' } } }, rec);
  let lane = await laneOf(ctx);
  const back = tileOf(lane, 'n_impl').querySelector('.ask-rp-row-reset');
  assert.ok(back, 'the pick can be dropped for this row');
  back.click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(tileOf(lane, 'n_impl').querySelector('.ask-rp-prop'), null);
  assert.equal(tileOf(lane, 'n_impl').querySelector('.ask-rp-m').textContent, 'default');
  assert.equal(lane.querySelector('.ask-rp-mini').hidden, false, 'Reset to proposal brings it back');
  await start(ctx);
  assert.equal('overlay' in rec.runBodies[0], false, 'the agent runs on the primary member\'s own setting');
  lane.querySelector('.ask-rp-mini').click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.ok(tileOf(lane, 'n_impl').querySelector('.ask-rp-prop'));
});

test('K3 a policy warning goes once no lane row runs the model it names; another project drops the proposal\'s policy word', async () => {
  const w = "The reviewer's model claude-haiku-4-5 is not in the allowed list (claude-opus-5-5). The run proceeds and is recorded as off-policy.";
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: { n_plan: NODES.n_plan, n_rev: { model: 'claude-haiku-4-5', effort: 'medium' } }, warnings: [w] }, {});
  let lane = await laneOf(ctx);
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 1);
  tileOf(lane, 'n_rev').querySelector('.ask-rp-row-reset').click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0, 'no agent runs Haiku 4.5 any more');
  lane.querySelector('.ask-rp-mini').click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 1);
  change(ctx, ctx.doc.querySelector('.ask-card-project-select'), '/repos/proj2');
  lane = await laneOf(ctx);
  assert.ok(lane.querySelector('.ask-rp-prop'), 'the picks ride over the other project');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0, 'the warning was the proposed project\'s team policy');
});

test('K4 the lane footer never says "Everything at the workflow default" over the project\'s own overrides', async () => {
  const rec = { cfg: { '/repos/proj': { workflows: { wf_review: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } } } } } };
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: { n_plan: NODES.n_plan } }, rec);
  const lane = await laneOf(ctx);
  assert.match(lane.querySelector('.ask-rp-sec-sub').textContent, /1 override of the workflow defaults/);
  assert.equal(lane.querySelector('.ask-rp-foot-text').textContent, "Runs on this project's agent settings");
});

test('K5 the Chat marker carries a role that allows its aria-label (a generic span may not be named)', async () => {
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: NODES }, {});
  const lane = await laneOf(ctx);
  const mark = tileOf(lane, 'n_plan').querySelector('.ask-rp-prop');
  assert.equal(mark.getAttribute('role'), 'note');
  assert.equal(mark.getAttribute('aria-label'), mark.title);
});

test('K6 another control edited on a picked row keeps the Chat marker (the model is still the pick)', async () => {
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: NODES }, {});
  let lane = await laneOf(ctx);
  change(ctx, tileOf(lane, 'n_plan').querySelector('[data-ctl="fanOut"]'), true);
  lane = ctx.doc.querySelector('.ask-rp-lane');
  const plan = tileOf(lane, 'n_plan');
  assert.ok(plan.querySelector('.ask-rp-prop'), 'the reason is still on the row');
  assert.match(plan.querySelector('.ask-rp-name small').textContent, /^Chat · step 1 · project: inherit · edited$/);
  assert.ok(plan.classList.contains('mod'));
  assert.match(ctx.doc.querySelector('.ask-rp-summary').textContent, / · 3 picked by Chat$/);
});

test('K7 the summary counts the fan-out a workspace run forces', async () => {
  const agents = AGENTS.map((a) => (a.key === 'planner' ? { ...a, workspaceFanOut: true } : a));
  const ctx = await openWithCard({ ...WS_CARD, workflowId: 'wf_review' }, { agents });
  await laneOf(ctx);
  assert.match(ctx.doc.querySelector('.ask-rp-summary').textContent, / · 2 fan-out$/);
});

test('K8 a policy warning goes once no pick or edit carries its model — an agent on the project\'s own setting is not this card\'s pick', async () => {
  const w = "The planner's model claude-haiku-4-5 is not in the allowed list (claude-opus-5-5). The run proceeds and is recorded as off-policy.";
  const rec = { cfg: { '/repos/proj': { workflows: { wf_review: { nodes: { n_impl: { model: 'claude-haiku-4-5', effort: 'medium' } } } } } } };
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } }, warnings: [w] }, rec);
  let lane = await laneOf(ctx);
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 1);
  tileOf(lane, 'n_plan').querySelector('.ask-rp-row-reset').click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0, 'the planner is back on the project\'s setting; Implement runs Haiku from the project, which this run neither sends nor records');
  await start(ctx);
  assert.equal('overlay' in rec.runBodies[0], false);
});

test('K9 a Start whose lane could not load sends the picks as proposed — so the lane stays on screen at every mode', async () => {
  const rec = { extraModels: [GPT], runEngine: 'codex' };
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: NODES }, rec);
  let lane = await laneOf(ctx);
  assert.equal(lane.dataset.levelKeep, undefined, 'healed away on Codex: Expert-only');
  rec.failDirs = ['/repos/proj'];
  change(ctx, ctx.doc.querySelector('.ask-card-engine'), 'claude');
  lane = await laneOf(ctx);
  assert.equal(lane.querySelector('.ask-rp-lane-msg').textContent, 'Could not load agent settings.');
  assert.equal(lane.dataset.levelKeep, '1', 'the picks ride this Start: never hidden at Simple or Advanced');
  await start(ctx);
  assert.ok(rec.runBodies[0].overlay, 'proposalOverlay rides');
});

test('K10 a warning stays gone while laneOverlay errors: the fallback counts only rows whose edit carries a model', async () => {
  const w = "The planner's model claude-haiku-4-5 is not in the allowed list (claude-opus-5-5). The run proceeds and is recorded as off-policy.";
  // The project runs Implement on Haiku and Review on Opus (Review has no workflow default: "inherit" over it errors).
  const rec = { cfg: { '/repos/proj': { workflows: { wf_review: { nodes: { n_impl: { model: 'claude-haiku-4-5', effort: 'medium' }, n_rev: { model: 'claude-opus-5-5', effort: 'high' } } } } } } };
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' }, n_rev: { model: 'claude-fable-5-1', effort: 'high' } }, warnings: [w] }, rec);
  let lane = await laneOf(ctx);
  tileOf(lane, 'n_plan').querySelector('.ask-rp-row-reset').click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  change(ctx, tileOf(lane, 'n_impl').querySelector('[data-ctl="fanOut"]'), false);   // a fan-out edit: Implement still runs the project's Haiku
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0);
  change(ctx, tileOf(lane, 'n_rev').querySelector('.ask-rp-model'), '');      // laneOverlay errors from here on
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0, 'no pick or model edit carries Haiku');
  [...tileOf(lane, 'n_impl').querySelectorAll('.ask-rp-effbtn')].find((b) => b.textContent === 'high').click();   // an effort edit sends its model too
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 1, "an effort edit carries its row's model (laneOverlay sends the pair)");
  tileOf(lane, 'n_impl').querySelector('.ask-rp-row-reset').click();
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0);
  change(ctx, tileOf(lane, 'n_plan').querySelector('.ask-rp-model'), 'claude-haiku-4-5');   // a model edit does
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 1);
});

test('K11 a lane that could not load with no picks for its workflow is Expert-only again (nothing on it applies at Start)', async () => {
  const rec = {};
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: NODES }, rec);
  let lane = await laneOf(ctx);
  assert.equal(lane.dataset.levelKeep, '1');
  rec.failDirs = ['/repos/proj'];
  change(ctx, ctx.doc.querySelector('.ask-card-workflow'), 'wf_default');
  lane = await laneOf(ctx);
  assert.equal(lane.querySelector('.ask-rp-lane-msg').textContent, 'Could not load agent settings.');
  assert.equal(lane.dataset.levelKeep, undefined);
  change(ctx, ctx.doc.querySelector('.ask-card-workflow'), 'wf_review');      // back: the picks ride as proposed again
  lane = await laneOf(ctx);
  assert.equal(lane.dataset.levelKeep, '1');
  await start(ctx);
  assert.ok(rec.runBodies[0].overlay);
});

test('K12 a lane that could not load names the picks its Start sends (the rows that would show them are gone)', async () => {
  const rec = { failDirs: ['/repos/proj'] };
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: { n_impl: { model: 'claude-haiku-4-5', effort: 'medium', reason: 'x' }, n_rev: { model: 'claude-opus-5-5', effort: '', subagentModel: 'sonnet', reason: 'y' } } }, rec);
  const lane = await laneOf(ctx);
  assert.deepEqual([...lane.querySelectorAll('.ask-rp-lane-msg')].map((m) => m.textContent), ['Could not load agent settings.',
    "Start runs Chat's picks as proposed (checked again at Start): n_impl → claude-haiku-4-5 · medium, n_rev → claude-opus-5-5 · sub-agents sonnet"]);
  assert.equal(lane.dataset.levelKeep, '1');
  await start(ctx);
  assert.deepEqual(rec.runBodies[0].overlay, { nodes: { n_impl: { model: 'claude-haiku-4-5', effort: 'medium' }, n_rev: { model: 'claude-opus-5-5', effort: '', subagentModel: 'sonnet' } } });
});

test('K13 the premium-pick warning (proposal.mjs) names its model id: it shows while a row runs Fable and goes once none does', async () => {
  const [fable] = modelFacts([{ id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['high'], harnesses: ['claude'] }]);
  const w = PROPOSAL_ERRORS.premiumPick('planner', fable);
  const ctx = await openWithCard({ ...PROJECT_CARD, workflowId: 'wf_review', nodes: { ...NODES, n_plan: { model: 'claude-fable-5-1', effort: 'high', reason: 'the user asked for Fable' } }, warnings: [w] }, {});
  let lane = await laneOf(ctx);
  assert.deepEqual([...lane.querySelectorAll('.ask-rp-lane-warn')].map((e) => e.textContent), [w]);
  change(ctx, tileOf(lane, 'n_plan').querySelector('.ask-rp-model'), 'claude-opus-5-5');
  lane = ctx.doc.querySelector('.ask-rp-lane');
  assert.equal(lane.querySelectorAll('.ask-rp-lane-warn').length, 0, 'no agent runs Fable any more');
});
