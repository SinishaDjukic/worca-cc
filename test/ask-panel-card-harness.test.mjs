// test/ask-panel-card-harness.test.mjs — the run card's agent and role rows pick a model WITH its harness (spec
// 2026-11-26 "The surfaces"): each row's model is the columns picker's trigger, a pinned pick draws its harness and
// rides the overlay and the save with `engine`, and the card's Default harness keeps the pinned rows and asks for the
// consent a step's harness needs. The rig is test/ask-panel-card-picks.test.mjs's.
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
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];

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
    // Chat runs: source branch: Current (checked out), today's path (no branch needed).
    if (path === '/api/run-defaults') return { ok: true, status: 200, json: async () => ({ engine: { value: rec.runEngine || 'claude', source: 'default' }, chatSourceBranch: { mode: 'current', source: 'default', needs: [] } }) };
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }, { name: 'proj2', path: '/repos/proj2', exists: true }] }) };
    if (url === '/api/workflows') return { ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) };
    if (url === '/api/guardrails') return { ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'normal', name: 'Normal' }] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) };
    if (url.startsWith('/api/branches')) return { ok: true, status: 200, json: async () => ({ branches: ['main'] }) };
    if (url === '/api/run' && method === 'POST') {
      rec.order = [...(rec.order || []), 'run'];
      rec.runBodies = [...(rec.runBodies || []), JSON.parse(opts.body)];
      if (rec.runReplies && rec.runReplies.length) {
        const [status, body] = rec.runReplies.shift();
        return { ok: status < 400, status, json: async () => body };
      }
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

const REVIEW = { ...PROJECT_CARD, workflowId: 'wf_review', workflowName: 'Review only' };
const pinned = () => ({ cfg: { '/repos/proj': { workflows: { wf_review: { nodes: { n_plan: { model: 'gpt-5.5', effort: 'low', engine: 'codex' } }, feedbacks: {} } } } } });
const trigger = (lane, id) => tileOf(lane, id).querySelector('button.ask-rp-model');
const pop = (ctx) => ctx.doc.querySelector('.mdl-cols-pop');
const opt = (ctx, col, key) => [...pop(ctx).querySelectorAll(`[data-col="${col}"] [role="option"]`)].find((b) => b.dataset.key === key);
const lane$ = (ctx) => ctx.doc.querySelector('.ask-rp-lane');

test('a row\'s model is the picker\'s trigger: inherit, the model alone when soft, the harness and the model when pinned; the row\'s harness decides its efforts and Sub-agents', async () => {
  const ctx = await openWithCard(REVIEW, pinned());
  const lane = await laneOf(ctx);
  const [plan, impl, rev] = ['n_plan', 'n_impl', 'n_rev'].map((id) => trigger(lane, id));
  assert.deepEqual([rev.className, rev.value, rev.querySelector('.mdl-pick-text').textContent], ['mdl-pick ask-rp-model inherit', '', 'inherit']);
  assert.deepEqual([impl.value, impl.dataset.engine, impl.querySelector('.mdl-pick-text').textContent, impl.querySelector('.mdl-mark')], ['claude-opus-5-5', '', 'Opus 5.5', null]);
  assert.deepEqual([plan.value, plan.dataset.engine, plan.querySelector('.mdl-mark.sm img').getAttribute('alt'), plan.getAttribute('aria-label'), plan.getAttribute('aria-haspopup')],
    ['gpt-5.5', 'codex', 'OpenAI Codex', 'Model for Plan: GPT-5.5, on OpenAI Codex', 'dialog']);
  assert.deepEqual([...tileOf(lane, 'n_plan').querySelectorAll('.ask-rp-effbtn')].map((b) => [b.textContent, b.classList.contains('on')]), [['minimal', false], ['low', true], ['medium', false], ['high', false]]);
  assert.deepEqual([tileOf(lane, 'n_plan').querySelector('.ask-rp-subagent'), !!tileOf(lane, 'n_impl').querySelector('.ask-rp-subagent')], [null, true]);
});
test('a pick from the panel names its harness, the focus lands on the row\'s new trigger, and Start sends the engine; an untouched row sends none', async () => {
  const rec = pinned();
  const ctx = await openWithCard(REVIEW, rec);
  await laneOf(ctx);
  trigger(lane$(ctx), 'n_rev').click();
  assert.equal(pop(ctx).querySelector('.mdl-cols-hint').textContent, 'workflow default');
  opt(ctx, 'harness', 'codex').click(); opt(ctx, 'model', 'gpt-5.5').click();
  const now = trigger(lane$(ctx), 'n_rev');
  assert.deepEqual([pop(ctx), ctx.doc.activeElement === now, now.value, now.dataset.engine], [null, true, 'gpt-5.5', 'codex']);
  await start(ctx);
  assert.deepEqual(rec.runBodies[0].overlay, { nodes: { n_rev: { model: 'gpt-5.5', effort: 'low', engine: 'codex' } } });
});
test('Save as project defaults sends each pick with its harness; a pinned pick saved for another tunable keeps it', async () => {
  const rec = pinned();
  const ctx = await openWithCard(REVIEW, rec);
  await laneOf(ctx);
  saveOn(ctx);
  trigger(lane$(ctx), 'n_rev').click(); opt(ctx, 'harness', 'codex').click(); opt(ctx, 'model', 'gpt-5.5').click();
  change(ctx, tileOf(lane$(ctx), 'n_plan').querySelector('[data-ctl="questions"]'), false);
  await start(ctx);
  const nodes = Object.assign({}, ...rec.configWrites.map((w) => w.body.nodes));
  assert.deepEqual([nodes.n_plan.model, nodes.n_plan.effort, nodes.n_plan.engine], ['gpt-5.5', 'low', 'codex']);
  assert.deepEqual([nodes.n_rev.model, nodes.n_rev.effort, nodes.n_rev.engine], ['gpt-5.5', 'low', 'codex']);
});
test('a lane redrawn under an open picker closes it and puts the focus on the same row\'s new trigger', async () => {
  const ctx = await openWithCard(REVIEW, pinned());
  await laneOf(ctx);
  trigger(lane$(ctx), 'n_plan').click();
  assert.ok(pop(ctx).contains(ctx.doc.activeElement));
  change(ctx, lane$(ctx).querySelector('[data-ctl="saveDefaults"]'), true);   // renderLane, the picker still open
  await ctx.tick();
  const now = trigger(lane$(ctx), 'n_plan');
  assert.deepEqual([pop(ctx), ctx.doc.activeElement === now, now.getAttribute('aria-expanded')], [null, true, 'false']);
});
test('Add model under a harness with no models opens Add model on that harness', async () => {
  const added = [];
  const ctx = await openWithCard(REVIEW, pinned(), { deps: { openAddModel: (e) => added.push(e) } });
  await laneOf(ctx);
  trigger(lane$(ctx), 'n_rev').click(); opt(ctx, 'harness', 'cursor').click();
  pop(ctx).querySelector('.mdl-cols-add').click();
  assert.deepEqual([added, pop(ctx)], [['cursor'], null]);
});

const press = async (ctx, name) => { [...ctx.doc.querySelectorAll('.req-dlg button')].find((b) => b.textContent === name).click(); for (let i = 0; i < 8; i++) await ctx.tick(); };

test('Default harness: its label and hint; a change keeps every pinned row and drops the other edits', async () => {
  const rec = pinned();
  const ctx = await openWithCard(REVIEW, rec);
  await laneOf(ctx);
  const sel = ctx.doc.querySelector('.ask-card-engine');
  assert.deepEqual([sel.getAttribute('aria-label'), sel.closest('.ask-rp-field').querySelector('.ask-rp-label').textContent], ['Default harness', 'Default harness · Steps set to inherit run here']);
  trigger(lane$(ctx), 'n_rev').click(); opt(ctx, 'model', 'claude-haiku-4-5').click();   // pinned to Claude Code
  change(ctx, trigger(lane$(ctx), 'n_impl'), 'claude-fable-5-1');                       // a soft edit
  change(ctx, sel, 'codex');
  const lane = await laneOf(ctx);
  assert.deepEqual([trigger(lane, 'n_rev').value, trigger(lane, 'n_rev').dataset.engine], ['claude-haiku-4-5', 'claude']);
  assert.deepEqual([trigger(lane, 'n_plan').value, trigger(lane, 'n_plan').dataset.engine], ['gpt-5.5', 'codex']);
  assert.equal(trigger(lane, 'n_impl').value, '', 'the soft edit went with the reload; the workflow\'s Claude pick is not on Codex');
  await start(ctx);
  assert.equal(rec.runBodies[0].engine, 'codex');
  assert.deepEqual(rec.runBodies[0].overlay, { nodes: { n_rev: { model: 'claude-haiku-4-5', effort: 'high', engine: 'claude' } } });
});
test('a start refused for a step\'s harness asks once; Allow unguarded resends the last body sent, with the consent', async () => {
  const running = { error: 'A feature already has a run.', code: 'RUN_IN_PROGRESS' };
  const refusal = { error: 'Plan runs on OpenAI Codex, which cannot enforce the Normal rules.', code: 'engine-refused', overridable: true, engines: ['codex'] };
  const rec = { ...pinned(), runReplies: [[409, running], [409, refusal]] };
  const ctx = await openWithCard(REVIEW, rec);
  await laneOf(ctx);
  await start(ctx);
  await press(ctx, 'Run again');
  const dlg = ctx.doc.querySelector('.req-dlg[role="dialog"]');
  assert.deepEqual([dlg.getAttribute('aria-label'), dlg.querySelector('h3').textContent, dlg.querySelector('p.hint').textContent], ['Start without some guardrails?', 'Start without some guardrails?', refusal.error]);
  await press(ctx, 'Allow unguarded');
  assert.deepEqual(rec.runBodies.slice(1), [{ ...rec.runBodies[0], confirmAttachedRunning: true }, { ...rec.runBodies[0], confirmAttachedRunning: true, allowUnguardedEngine: true }]);
});
test('a card moved to Normal on a harness that cannot hold it asks the same way', async () => {
  const moved = { error: 'this run would start on the Normal guardrail set, which codex cannot enforce — start it from New run and pick a guardrail set', code: 'GUARDRAILS_CARD_ENGINE' };
  const rec = { ...pinned(), runReplies: [[409, moved]] };
  const ctx = await openWithCard(REVIEW, rec);
  await laneOf(ctx);
  await start(ctx);
  await press(ctx, 'Allow unguarded');
  assert.deepEqual(rec.runBodies[1], { ...rec.runBodies[0], allowUnguardedEngine: true });
});
test('Cancel at the ask sends nothing more; a refusal the consent cannot lift reads as the server says', async () => {
  const rec = { ...pinned(), runReplies: [[409, { error: 'x', code: 'engine-refused', overridable: true }]] };
  const ctx = await openWithCard(REVIEW, rec);
  await laneOf(ctx); await start(ctx);
  await press(ctx, 'Cancel');
  assert.deepEqual([rec.runBodies.length, ctx.doc.querySelector('.ask-card-err').textContent], [1, 'Start cancelled.']);
  const hard = { ...pinned(), runReplies: [[409, { error: 'codex is off while the credential broker is on', code: 'engine-refused', overridable: false }]] };
  const c2 = await openWithCard(REVIEW, hard);
  await laneOf(c2); await start(c2);
  assert.deepEqual([c2.doc.querySelector('.req-dlg'), c2.doc.querySelector('.ask-card-err').textContent], [null, 'codex is off while the credential broker is on']);
});
test('two Default harness changes before the first reload lands still keep the pinned rows', async () => {
  const ctx = await openWithCard(REVIEW, pinned());
  await laneOf(ctx);
  const sel = ctx.doc.querySelector('.ask-card-engine');
  trigger(lane$(ctx), 'n_rev').click(); opt(ctx, 'model', 'claude-haiku-4-5').click();   // pinned to Claude Code
  change(ctx, sel, 'codex');
  change(ctx, sel, 'cursor');                                                           // no tick: the first reload is still loading
  const lane = await laneOf(ctx);
  assert.deepEqual([trigger(lane, 'n_rev').value, trigger(lane, 'n_rev').dataset.engine], ['claude-haiku-4-5', 'claude']);
  assert.deepEqual([trigger(lane, 'n_plan').value, trigger(lane, 'n_plan').dataset.engine], ['gpt-5.5', 'codex']);
});

// Chat's picks are soft (spec "The surfaces"): laid over a project row pinned to a harness, they run on the run's.
const summary$ = (ctx) => ctx.doc.querySelector('.ask-rp-summary').textContent;
test('a Chat pick laid over a row pinned to another harness runs soft: no engine rides with it, and it counts as Chat\'s pick', async () => {
  const rec = pinned();
  const ctx = await openWithCard({ ...REVIEW, nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high', reason: 'deep plan' } } }, rec);
  const lane = await laneOf(ctx);
  assert.deepEqual([trigger(lane, 'n_plan').value, trigger(lane, 'n_plan').dataset.engine], ['claude-opus-5-5', '']);
  assert.match(summary$(ctx), / · 1 picked by Chat$/);
  await start(ctx);
  assert.deepEqual(rec.runBodies[0].overlay, { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } });
});
test('the same model re-picked on a harness is no longer Chat\'s pick, and rides pinned', async () => {
  const rec = pinned();
  const ctx = await openWithCard({ ...REVIEW, nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' } } }, rec);
  await laneOf(ctx);
  trigger(lane$(ctx), 'n_plan').click(); opt(ctx, 'harness', 'claude').click(); opt(ctx, 'model', 'claude-opus-5-5').click();
  assert.deepEqual([trigger(lane$(ctx), 'n_plan').value, trigger(lane$(ctx), 'n_plan').dataset.engine], ['claude-opus-5-5', 'claude']);
  assert.doesNotMatch(summary$(ctx), /picked by Chat/);
  await start(ctx);
  assert.deepEqual(rec.runBodies[0].overlay, { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high', engine: 'claude' } } });
});
test('a soft Chat pick of the very model a row pins still rides, without the harness', async () => {
  const rec = { ...pinned(), runEngine: 'codex' };
  const ctx = await openWithCard({ ...REVIEW, nodes: { n_plan: { model: 'gpt-5.5', effort: 'low' } } }, rec);
  const lane = await laneOf(ctx);
  assert.deepEqual([trigger(lane, 'n_plan').value, trigger(lane, 'n_plan').dataset.engine], ['gpt-5.5', '']);
  await start(ctx);
  assert.deepEqual(rec.runBodies[0].overlay, { nodes: { n_plan: { model: 'gpt-5.5', effort: 'low' } } });
});
