// test/ask-chat-action-tools.test.mjs — worca Chat P2 Task 3: the MCP child's act-then-undo tools validate only (the
// parent applies), refuse what they can see on the run's row, and stay out of the Workflows chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { resumeBlocker, defaultSettingsRegistryDeps } from '../src/core/ask/chat-action-deps.mjs';
import { labelForTool } from '../src/core/ask/events.mjs';
import { ASK_SYSTEM_RULES } from '../src/core/ask/prompt.mjs';
import { checkRows } from './helpers/rows.mjs';

const NEW = ['list_settings', 'change_setting', 'pause_run', 'resume_run', 'propose_stop_run', 'send_direction', 'propose_pull_request'];
const branch = JSON.stringify({ feature: 'worca/fix-login', source: 'main' });
const row = (id, status, over = {}) => ({ id, status, project_key: 'shop-1a2b3c4d', target: 'project', title: `Run ${id}`, branch, archived_at: null, ...over });
const ROWS = {
  aaaa0001: row('aaaa0001', 'running'),
  aaaa0002: row('aaaa0002', 'paused'),
  aaaa0003: row('aaaa0003', 'interrupted'),
  aaaa0004: row('aaaa0004', 'paused'),
  aaaa0005: row('aaaa0005', 'done'),
  aaaa0006: row('aaaa0006', 'done'),
  aaaa0007: row('aaaa0007', 'done', { branch: null }),
  aaaa0008: row('aaaa0008', 'done', { target: 'workspace', branch: null }),
  aaaa0009: row('aaaa0009', 'paused', { archived_at: '2026-10-01T00:00:00Z' }),
  // Runs on their source branch: merged back (the work is on main), and refused (the work stays on its branch).
  aaaa0010: row('aaaa0010', 'done', { branch: JSON.stringify({ feature: 'worca-cc/h-10', source: 'main', sameAsSource: true, mergeBack: { merged: true } }) }),
  aaaa0011: row('aaaa0011', 'done', { branch: JSON.stringify({ feature: 'worca-cc/h-11', source: 'main', sameAsSource: true, mergeBack: { merged: false, kind: 'diverged' } }) }),
};
const LIVE = '0b9b6c1e-3c62-4e8b-9d6e-2f6f0f6a1c11';
const APPLIED = 'worca applies this right after this call: a receipt card in the chat confirms it, or a notice says why not — do not restate its values. Only your own turn\'s call is applied; a sub-agent\'s call is recorded as not applied.';

function tools({ pin = null, composer = false } = {}) {
  const seen = { check: [], list: [] };
  const chatActions = {
    settings: {
      list: async (o) => { seen.list.push(o); return { scope: o.scope, settings: [], excluded: [] }; },
      check: async (r) => {
        seen.check.push(r);
        return r.id === 'theme'
          ? { ok: true, def: { id: 'theme', scope: r.scope }, project: r.projectKey ? { key: r.projectKey } : null, value: r.value, before: { text: 'System (default)' }, after: { text: 'Dark' } }
          : { ok: false, error: `unknown setting "${r.id}"` };
      },
    },
    prState: (id) => (id === 'aaaa0005' ? { url: 'https://x/pull/9' } : null),
    resumeBlocker: (r) => (r.id === 'aaaa0004' ? 'the run reached its cost limit ($5.00) — ask the user to press Resume on the run card to confirm' : null),
    directionMaxChars: 50,
  };
  const t = createAskTools({ limits: ASK_LIMITS, lookupPipelineRow: (_k, id) => ROWS[id] || null, findPipelineRowById: (id) => ROWS[id] || null,
    ...(pin ? { pinnedScope: () => pin } : {}), ...(composer ? { askMode: 'composer', composer: {} } : {}), chatActions });
  return { t, seen };
}

test('the chat tools: served only with the chatActions bundle, last and in this order; never in the Workflows chat', async () => {
  const defs = tools().t.list();
  assert.deepEqual(defs.map((d) => d.name).slice(-NEW.length), NEW);
  for (const d of defs.filter((x) => NEW.includes(x.name))) {
    assert.ok(d.description.length > 20, d.name);
    assert.equal(d.inputSchema.type, 'object');
    assert.equal(d.inputSchema.additionalProperties, false);
  }
  for (const n of ['pause_run', 'resume_run', 'propose_stop_run', 'send_direction', 'propose_pull_request']) {   // review P2-3 (R9: {runId|pipelineId})
    const s = defs.find((d) => d.name === n).inputSchema;
    assert.ok(s.properties.runId && s.properties.pipelineId, `${n} takes runId or pipelineId`);
    assert.ok(!(s.required || []).includes('runId'), `${n}: runId is not required on its own`);
  }
  const bare = createAskTools({ limits: ASK_LIMITS }).list().map((d) => d.name);
  assert.ok(NEW.every((n) => !bare.includes(n)), 'a bundle-less list is unchanged');
  const comp = tools({ composer: true }).t;
  assert.ok(NEW.every((n) => !comp.list().some((d) => d.name === n)));
  await assert.rejects(comp.call('pause_run', { runId: 'aaaa0001' }), /not available in the Workflows chat/);
  await assert.rejects(createAskTools({ limits: ASK_LIMITS }).call('pause_run', { runId: 'aaaa0001' }), (e) => e instanceof AskToolError && /pause_run: unavailable/.test(e.message));
});

test('list_settings / change_setting: checked by the registry, the pinned project for scope project', async () => {
  await checkRows([
    { name: 'list_settings passes scope, project and query', run: async () => {
      const { t, seen } = tools({ pin: { projectKey: 'shop-1a2b3c4d' } });
      await t.call('list_settings', { query: 'sync' });
      await t.call('list_settings', { scope: 'project' });
      assert.deepEqual(seen.list, [{ scope: 'user', projectKey: null, query: 'sync' }, { scope: 'project', projectKey: 'shop-1a2b3c4d', query: '' }]);
      await assert.rejects(t.call('list_settings', { scope: 'team' }), /scope must be "user" or "project"/);
      await assert.rejects(tools().t.call('list_settings', { scope: 'project' }), /needs projectKey/);
    } },
    { name: 'change_setting returns what it asks for; a refusal comes back as ok:false', run: async () => {
      const { t, seen } = tools();
      assert.deepEqual(await t.call('change_setting', { id: 'theme', value: 'dark' }), {
        ok: true, requested: { kind: 'setting', id: 'theme', scope: 'user', value: 'dark' }, before: 'System (default)', after: 'Dark', note: APPLIED });
      assert.deepEqual(await t.call('change_setting', { id: 'bogus', value: 1 }), { ok: false, error: 'unknown setting "bogus"' });
      await assert.rejects(t.call('change_setting', { id: 'theme' }), /value is required/);
      await assert.rejects(t.call('change_setting', { value: 1 }), /id is required/);
      assert.equal(seen.check.length, 2);
    } },
    { name: 'change_setting scope project takes the pinned project', run: async () => {
      const { t, seen } = tools({ pin: { projectKey: 'shop-1a2b3c4d' } });
      const r = await t.call('change_setting', { id: 'theme', scope: 'project', value: 'dark' });
      assert.equal(seen.check[0].projectKey, 'shop-1a2b3c4d');
      assert.equal(r.requested.projectKey, 'shop-1a2b3c4d');
    } },
  ]);
});

test('run controls: refuse what the row shows, pass a live run id through, and only ask for the change', async () => {
  const { t } = tools();
  const call = (name, input) => t.call(name, input);
  await checkRows([
    { name: 'pause_run', run: async () => {
      assert.deepEqual(await call('pause_run', { runId: 'aaaa0001' }), { ok: true, requested: { kind: 'pause', runId: 'aaaa0001' }, note: APPLIED });
      assert.deepEqual(await call('pause_run', { runId: 'aaaa0002' }), { ok: false, error: 'the run is paused; only a running run can be paused' });
      assert.deepEqual((await call('pause_run', { runId: LIVE })).requested, { kind: 'pause', runId: LIVE });
      await assert.rejects(call('pause_run', { runId: 'zzzz9999' }), { message: 'pause_run: run not found' });
      await assert.rejects(call('pause_run', {}), { message: 'pause_run: runId (or pipelineId) is required' });
    } },
    { name: 'resume_run', run: async () => {
      assert.deepEqual((await call('resume_run', { runId: 'aaaa0002' })).requested, { kind: 'resume', runId: 'aaaa0002' });
      assert.equal((await call('resume_run', { runId: 'aaaa0003' })).ok, true, 'an interrupted run resumes');
      assert.deepEqual(await call('resume_run', { runId: 'aaaa0001' }), { ok: false, error: 'the run is running; only a paused or interrupted run can be resumed' });
      assert.deepEqual(await call('resume_run', { runId: 'aaaa0004' }), { ok: false, error: 'the run reached its cost limit ($5.00) — ask the user to press Resume on the run card to confirm' });
      assert.match((await call('resume_run', { runId: 'aaaa0009' })).error, /archived/);
    } },
    { name: 'propose_stop_run', run: async () => {
      assert.deepEqual((await call('propose_stop_run', { runId: 'aaaa0001' })).requested, { kind: 'stop', runId: 'aaaa0001' });
      assert.equal((await call('propose_stop_run', { runId: 'aaaa0002' })).ok, true, 'a paused run can be stopped');
      assert.deepEqual(await call('propose_stop_run', { runId: 'aaaa0003' }), { ok: false, error: 'an interrupted run cannot be stopped — it stays resumable' });
      assert.deepEqual(await call('propose_stop_run', { runId: 'aaaa0005' }), { ok: false, error: 'the run is already done' });
      assert.deepEqual(await call('propose_stop_run', { runId: 'aaaa0009' }), { ok: false, error: 'the run is archived' }, 'an archived paused run (impl review m3)');
    } },
    { name: 'send_direction', run: async () => {
      assert.deepEqual((await call('send_direction', { runId: 'aaaa0001', text: '  skip the docs ' })).requested, { kind: 'direction', runId: 'aaaa0001', text: 'skip the docs' });
      assert.equal((await call('send_direction', { runId: 'aaaa0002', text: 'later' })).ok, true, 'a paused run reads it on resume');
      assert.deepEqual((await call('send_direction', { pipelineId: 'aaaa0001', text: 'x' })).requested, { kind: 'direction', runId: 'aaaa0001', text: 'x' }, 'pipelineId works too');
      assert.deepEqual(await call('send_direction', { runId: 'aaaa0005', text: 'x' }), { ok: false, error: 'the run is done; a direction would never be read' });
      await assert.rejects(call('send_direction', { runId: 'aaaa0001', text: ' ' }), /text is required/);
      await assert.rejects(call('send_direction', { runId: 'aaaa0001', text: 'x'.repeat(51) }), /at most 50 characters/);
    } },
    { name: 'propose_pull_request', run: async () => {
      assert.deepEqual((await call('propose_pull_request', { runId: 'aaaa0006' })).requested, { kind: 'pull-request', runId: 'aaaa0006' });
      assert.deepEqual((await call('propose_pull_request', { pipelineId: 'aaaa0006' })).requested, { kind: 'pull-request', runId: 'aaaa0006' }, 'pipelineId works too');
      assert.deepEqual(await call('propose_pull_request', { runId: 'aaaa0005' }), { ok: false, error: 'the run already has a pull request: https://x/pull/9' });
      assert.deepEqual(await call('propose_pull_request', { runId: 'aaaa0001' }), { ok: false, error: 'the run is running; a pull request is for a finished run' });
      assert.deepEqual(await call('propose_pull_request', { runId: 'aaaa0007' }), { ok: false, error: 'the run has no feature branch' });
      assert.equal((await call('propose_pull_request', { runId: 'aaaa0008' })).ok, true, 'a workspace run keeps its branches per member');
      assert.deepEqual(await call('propose_pull_request', { runId: 'aaaa0010' }), { ok: false, error: 'the run\'s work is already on main: offer to push main instead of a pull request' });
      assert.equal((await call('propose_pull_request', { runId: 'aaaa0011' })).ok, true, 'not merged back: its own branch opens a PR');
    } },
  ]);
});

test('resumeBlocker: the child names what only the user can confirm (the parent re-checks it all)', () => {
  const r = { id: 'aaaa0002', total_cost_usd: 6 };
  assert.equal(resumeBlocker(r, { budget: () => ({ blocked: true, pipelineLimitUsd: null }), override: () => false }), 'the total cost limit is reached — no Resume gets past it until the user raises or clears it in Settings',
    'resumeRun refuses every resume past the total limit: never "press Resume"');
  assert.equal(resumeBlocker(r, { budget: () => ({ blocked: false, pipelineLimitUsd: 5 }), override: () => false }), 'the run reached its cost limit ($5.00) — ask the user to press Resume on the run card to confirm');
  assert.equal(resumeBlocker(r, { budget: () => ({ blocked: false, pipelineLimitUsd: 5 }), override: () => true }), null, 'an override is already set');
  assert.equal(resumeBlocker({ ...r, total_cost_usd: 1 }, { budget: () => ({ blocked: false, pipelineLimitUsd: 5 }), override: () => false }), null);
  assert.equal(resumeBlocker(r, { budget: () => { throw new Error('db'); }, override: () => false }), null, 'a failed read never blocks: the parent checks');
});

test('tool labels and the act-then-undo rules', () => {
  assert.equal(labelForTool('mcp__worca__pause_run'), 'Pausing a run');
  assert.equal(labelForTool('mcp__worca__change_setting', { id: 'theme' }), 'Changing theme');
  assert.equal(labelForTool('mcp__worca__propose_pull_request'), 'Preparing a pull request');
  assert.match(ASK_SYSTEM_RULES, /\n {3}- Act, then undo \(runs\):/);
  assert.match(ASK_SYSTEM_RULES, /\n {3}- Act, then undo \(settings\):/);
  assert.match(ASK_SYSTEM_RULES, /never claim it stopped/);
  assert.match(ASK_SYSTEM_RULES, /ONE setting per call/);
  assert.match(ASK_SYSTEM_RULES, /Never repeat a secret back/);
});

test('propose_pull_request refuses an archived run (mutation killer)', async () => {
  const { t } = tools();
  assert.deepEqual(await t.call('propose_pull_request', { runId: 'aaaa0009' }), { ok: false, error: 'the run is archived' });
});

test('the project ids the chat offers skip the user-only ones (a project override of them is always refused)', () => {
  const ids = defaultSettingsRegistryDeps().projectSettingIds(['planner']);
  assert.ok(ids.includes('models.claude.steps.planner') && ids.includes('askMaxTurns'));
  for (const id of ['askEngine', 'models.claude.ask', 'models.codex.workspaceScan', 'models.claude.utility.agentGen', 'models.claude.utility.naming']) assert.ok(!ids.includes(id), id);
});

test('resumeBlocker: a run AT its cost limit is blocked, like resumeRun\'s own >= check (refine cycle 2 mutation killer)', () => {
  assert.equal(resumeBlocker({ id: 'aaaa0002', total_cost_usd: 5 }, { budget: () => ({ blocked: false, pipelineLimitUsd: 5 }), override: () => false }), 'the run reached its cost limit ($5.00) — ask the user to press Resume on the run card to confirm');
});

test('resume_run\'s description never sends the user to press Resume past the total cost limit — no Resume gets past it (refine cycle 3 mutation killer)', () => {
  const d = tools().t.list().find((x) => x.name === 'resume_run').description;
  const askUser = d.slice(d.indexOf('say-so first'), d.indexOf('ask the user to press Resume'));
  assert.ok(askUser.length > 0, d);
  assert.doesNotMatch(askUser, /total cost limit/);
  assert.match(d, /total cost limit is reached no resume starts/);
});
