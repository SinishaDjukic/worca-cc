// test/ask-people.test.mjs — Ask Worca and people (step 5): list_runs' startedBy filter
// ("me" only on a shared sign-in), list_people, get_run's human action timeline, the real
// readers over a temp DB, the MCP child's viewer wiring, and the rules text.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_SYSTEM_RULES, ASK_HOSTING_RULE, buildSystemPrompt } from '../src/core/ask/prompt.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-cc-askpeople-home-');

const ROWS = [
  { id: 'aaaaaaa1', title: 'One', projectKey: 'demo-00000001', status: 'done', startedAt: '2026-09-20T10:00:00Z', mtime: 3, startedBy: 'Ada@Example.com' },
  { id: 'aaaaaaa2', title: 'Two', projectKey: 'demo-00000001', status: 'done', startedAt: '2026-09-21T10:00:00Z', mtime: 2, startedBy: 'grace@example.com' },
  { id: 'aaaaaaa3', title: 'Three', projectKey: 'demo-00000001', status: 'done', startedAt: '2026-09-22T10:00:00Z', mtime: 1, startedBy: 'local' },
  { id: 'aaaaaaa4', title: 'Old', projectKey: 'demo-00000001', status: 'done', startedAt: '2026-01-01T10:00:00Z', mtime: 0 },
];
const ROW = { id: 'aaaaaaa1', project_key: 'demo-00000001', target: 'project', title: 'One', status: 'done', started_at: ROWS[0].startedAt, started_by: 'ada@example.com', branch: null };

function toolsWith(extra = {}) {
  return createAskTools({
    buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
    listAllPipelines: async () => ROWS,
    lookupPipelineRow: () => ROW,
    findPipelineRowById: (id) => (id === ROW.id ? ROW : null),
    totalsFor: () => ({ cost: 0.5, active: null }),
    readStoreMeta: () => ({ name: 'Demo' }),
    readDiffPatch: async () => null,
    hasDiffPatch: async () => false,
    redact: redactAskText,
    limits: ASK_LIMITS,
    ...extra,
  });
}

test('list_runs: rows carry startedBy; the filter is exact and case-insensitive', async () => {
  const t = toolsWith();
  const all = await t.call('list_runs', {});
  assert.deepEqual(all.map((r) => r.startedBy), ['Ada@Example.com', 'grace@example.com', 'local', null]);
  assert.deepEqual((await t.call('list_runs', { startedBy: 'ada@example.com' })).map((r) => r.id), ['aaaaaaa1']);
  assert.deepEqual((await t.call('list_runs', { startedBy: 'local (this machine)' })).map((r) => r.id), ['aaaaaaa3'], 'the list_people spelling works too');
  assert.deepEqual((await t.call('list_runs', { startedBy: 'ada' })).map((r) => r.id), [], 'no substring match: never guess a person');
});

test('list_runs "me": the signed-in person on a shared sign-in; refused otherwise', async () => {
  assert.deepEqual((await toolsWith({ viewer: 'grace@example.com' }).call('list_runs', { startedBy: 'me' })).map((r) => r.id), ['aaaaaaa2']);
  await assert.rejects(() => toolsWith().call('list_runs', { startedBy: 'ME' }), (e) => e instanceof AskToolError && /needs a per-person sign-in/.test(e.message));
});

test('list_people: one row per person, "local (this machine)", you flagged; scope passed through', async () => {
  const seen = [];
  const t = toolsWith({
    viewer: 'ADA@example.com',
    listPeople: async (scope) => { seen.push(scope); return [
      { name: 'ada@example.com', runs: 3, lastRunAt: '2026-09-22T10:00:00Z', totalCostUsd: 1.5 },
      { name: 'local', runs: 1, lastRunAt: '2026-09-01T10:00:00Z', totalCostUsd: null },
    ]; },
  });
  assert.deepEqual(await t.call('list_people', {}), [
    { name: 'ada@example.com', you: true, runs: 3, lastRunAt: '2026-09-22T10:00:00Z', totalCostUsd: 1.5 },
    { name: 'local (this machine)', runs: 1, lastRunAt: '2026-09-01T10:00:00Z', totalCostUsd: 0 },
  ]);
  await t.call('list_people', { projectKey: 'demo-00000001' });
  await t.call('list_people', { workspaceId: 'wks-team-0000abcd' });
  assert.deepEqual(seen, [{}, { projectKey: 'demo-00000001' }, { workspaceKey: 'wks-team-0000abcd' }]);
  await assert.rejects(() => t.call('list_people', { projectKey: 'a', workspaceId: 'b' }), AskToolError);
});

test('get_run: `actions` lists who acted, redacted; absent when nobody did', async () => {
  const withActions = toolsWith({ readRunActions: async () => [
    { at: '2026-09-22T10:05:00Z', by: 'grace@example.com', what: 'Pipeline paused by grace@example.com.' },
    { at: '2026-09-22T10:09:00Z', by: 'ada via Slack', what: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 pasted' },
  ] });
  const r = await withActions.call('get_run', { id: 'aaaaaaa1' });
  assert.equal(r.startedBy, 'ada@example.com');
  assert.equal(r.actions.length, 2);
  assert.deepEqual(r.actions[0], { at: '2026-09-22T10:05:00Z', by: 'grace@example.com', what: 'Pipeline paused by grace@example.com.' });
  assert.ok(!r.actions[1].what.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'action text is redacted like every run text');
  assert.equal('actions' in await toolsWith({ readRunActions: async () => [] }).call('get_run', { id: 'aaaaaaa1' }), false);
});

test('the real readers: listPeople groups by person over pipelines, readRunActions keeps only human lines', async () => {
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const { listPeople, readRunActions, defaultToolDeps } = await import('../src/core/ask/tool-deps.mjs');
  const seed = (id, by, startedAt, cost, projectKey = 'demo-00000001') => {
    seedPipelineRow({ id, projectKey, startedAt, totalCostUsd: cost });
    getDb().prepare('UPDATE pipelines SET started_by = ? WHERE id = ?').run(by, id);
  };
  seed('bbbbbbb1', 'ada@example.com', '2026-09-20T10:00:00Z', 1);
  seed('bbbbbbb2', 'ADA@example.com', '2026-09-23T10:00:00Z', 2);
  seed('bbbbbbb3', 'grace@example.com', '2026-09-21T10:00:00Z', 0.5, 'other-00000002');
  seed('bbbbbbb4', null, '2026-09-24T10:00:00Z', 9);
  seed('bbbbbbb5', 'mallory@example.com', '2026-09-24T10:00:00Z', 9);
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-09-24T11:00:00Z' WHERE id = 'bbbbbbb5'").run();
  const all = listPeople();
  assert.deepEqual(all.map((p) => [p.name.toLowerCase(), p.runs, p.totalCostUsd]), [['ada@example.com', 2, 3], ['grace@example.com', 1, 0.5]],
    'case-insensitive per person; NULL and archived runs left out; most active first');
  assert.equal(all[0].lastRunAt, '2026-09-23T10:00:00Z');
  assert.deepEqual(listPeople({ projectKey: 'other-00000002' }).map((p) => p.name), ['grace@example.com']);

  const ins = getDb().prepare('INSERT INTO pipeline_events (pipeline_id, ts, text, actor) VALUES (?, ?, ?, ?)');
  ins.run('bbbbbbb1', '2026-09-20T10:01:00Z', 'Step **plan** started.', null);
  ins.run('bbbbbbb1', '2026-09-20T10:02:00Z', 'Pipeline **paused** by grace@example.com.', 'grace@example.com');
  ins.run('bbbbbbb1', '2026-09-20T10:03:00Z', 'Pipeline **resumed** (graph snapshot at seq 4).', 'local');
  assert.deepEqual(readRunActions({ id: 'bbbbbbb1' }), [
    { at: '2026-09-20T10:02:00Z', by: 'grace@example.com', what: 'Pipeline paused by grace@example.com.' },
    { at: '2026-09-20T10:03:00Z', by: 'local', what: 'Pipeline resumed (graph snapshot at seq 4).' },
  ]);
  assert.equal(defaultToolDeps({ threadId: null, viewer: 'ada@example.com' }).viewer, 'ada@example.com');
  assert.equal(defaultToolDeps({ threadId: null }).viewer, null, 'no shared sign-in: no "me"');
});

test('rule 19 (people) is in every prompt; rule 20 (hosting) only on a container or hosted worca', () => {
  const rule19 = ASK_SYSTEM_RULES.slice(ASK_SYSTEM_RULES.indexOf('\n19. '));
  assert.ok(rule19.startsWith('\n19. People:'));
  for (const t of ['startedBy', '`actions`', 'createdBy, updatedBy', 'Cloudflare Access', 'WORCA_IDENTITY_HEADER', 'WORCA_IDENTITY_NAME', '"local"',
    'list_people', '"me"', 'signed in: line', 'Never infer a person', 'attribution, not permissions']) {
    assert.ok(rule19.includes(t), `rule 19 states "${t}"`);
  }
  const rule1 = ASK_SYSTEM_RULES.slice(ASK_SYSTEM_RULES.indexOf('\n1. '), ASK_SYSTEM_RULES.indexOf('\n2. '));
  assert.ok(rule1.includes('list_runs, list_people, get_run'));
  assert.ok(buildSystemPrompt({ projects: [], workspaces: [], workflows: [] }).includes('\n19. People:'), 'a local install gets rule 19 too');
  assert.ok(ASK_HOSTING_RULE.startsWith('20. Where worca runs:'));
  for (const t of ['single (GH_TOKEN)', 'split (WORCA_GH_READ_TOKEN', 'app (a GitHub App', 'agents never get a GitHub credential', 'one credential per call',
    'worca-agent', 'CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY', 'WORCA_AGENT_ISOLATION=0', 'WORCA_CLONE_ALLOW', 'Cloudflare Access policy, never in worca',
    '"Adding people later"', '"Who started a run"', '"GitHub App"']) {
    assert.ok(ASK_HOSTING_RULE.includes(t), `rule 20 states "${t}"`);
  }
});
