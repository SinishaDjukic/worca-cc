// test/workflow-test-connectors.test.mjs — D35: a pretend try's stand-ins, the dialog's notes, what a try would have
// sent, the spawn flags and the script env; then a real pipeline run (mock engine, custom runners, the pattern of
// test/mcp-pipeline-run.test.mjs) in pretend and in real mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addManualServer, createSet, putMember, setProjectAssignment, recordTest } from '../src/core/mcp/store.mjs';
import { materializeForTest } from '../src/core/mcp/test.mjs';
import { viewContext } from '../src/core/mcp/views.mjs';
import { MOCK_CONNECTOR_PATH } from '../src/core/mcp/mock-connector.mjs';
import { runOpts, CLAUDE_AI_TOOLS } from '../src/core/phases.mjs';
import { buildClaudeArgs } from '../src/core/engines/claude.mjs';
import { envForShell } from '../src/core/graph/script-runner.mjs';
import {
  pretendServers, connectorNotes, humanizeTool, nounOf, sentCall, wouldHaveSent, noteSeenServers, seenClaudeAiServers,
  userScopeServerNames, CONNECTOR_CALLS_FILE, stepEngines, scriptSteps, fileServerOffLine, engineNoteLine, pretendCopies,
} from '../src/core/workflow-tests/connectors.mjs';

useTempHome(after);
const scratch = [];
after(async () => { await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))); });
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-wftconn-')); scratch.push(d); return d; };

test('pretendServers: a stand-in for each server with recorded tools, the rest switched off; no env, no secret', async () => {
  const dir = await tmp();
  const store = { tests: { 'set1|manual:slack': { ok: true, tools: [{ name: 'post_message' }], fingerprint: 'f' }, 'set1|manual:jira': { ok: true, tools: ['create_issue'] } } };
  const out = await pretendServers({
    servers: {
      slack_team: { type: 'http', url: 'https://mcp.slack.example/', headers: { Authorization: '${MCPSECRET_ABCD1234}' } },
      jira_team: { command: 'node', args: ['jira.js'], env: { TOKEN: '${MCPSECRET_0000AAAA}' } },
      files_srv: { command: 'files-mcp' },
    },
    copies: [{ name: 'slack_team', setId: 'set1', serverId: 'manual:slack', untested: false },
      { name: 'jira_team', setId: 'set1', serverId: 'manual:jira', untested: true }],
  }, { pipelineDir: dir, store });
  assert.deepEqual(out.pretend, ['slack_team']);
  assert.deepEqual(out.off.map((o) => o.name), ['files_srv', 'jira_team'], 'a file server and a stale Test have no tools Worca trusts');
  assert.deepEqual(out.off.map((o) => [o.name, o.reason, o.why]), [
    ['files_srv', 'file-server', "Worca can't pretend for servers from a project file."],
    ['jira_team', 'no-tools', 'Worca has no list of its tools; test it once in Connectors.'],
  ], 'a file server cannot be tested in Connectors, so it is not told to be');
  assert.deepEqual(Object.keys(out.servers), ['slack_team']);
  const def = out.servers.slack_team;
  assert.deepEqual([def.type, def.command, def.args[0], def.args[1], def.args[2], def.args[3], def.args[5], def.args[6]],
    ['stdio', process.execPath, MOCK_CONNECTOR_PATH, '--server', 'slack_team', '--tools', '--log', join(dir, CONNECTOR_CALLS_FILE)]);
  assert.equal(def.env, undefined);
  assert.doesNotMatch(JSON.stringify(out.servers), /MCPSECRET_/);
  assert.deepEqual(JSON.parse(await readFile(def.args[4], 'utf8')), [{ name: 'post_message' }]);
});

test('the dialog notes (board 30): pretend, switched off and why, script steps', () => {
  assert.deepEqual(connectorNotes({
    copies: [{ name: 'slack_team', untested: false }, { name: 'jira_team', untested: false }, { name: 'confluence_team', untested: true }],
    userScope: ['my-db'], claudeAi: ['claude.ai Google Drive'], scripts: ['Publish to wiki', 'Publish to wiki'],
  }), {
    pretend: ['jira_team', 'slack_team'],
    off: [{ name: 'Google Drive', reason: 'claude-ai' }, { name: 'confluence_team', reason: 'no-tools' }, { name: 'my-db', reason: 'own-settings' }],
    scripts: ['Publish to wiki'],
    quickScripts: [],
    engines: [],
  });
});

test('script steps: their names, and the ones the free quick check runs for real (no mock of their own; final review M2)', () => {
  const registry = { publish: { displayName: 'Publish to wiki' }, lint: { displayName: 'Markdown lint', mock: { summary: 'ok' } }, odd: { mock: 'yes' } };
  const graph = { nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_1', kind: 'script', key: 'publish', config: {} },
    { id: 'n_2', kind: 'script', key: 'lint' }, { id: 'n_3', kind: 'script', key: 'publish', config: { mock: { summary: 'card mock' } } },
    { id: 'n_4', kind: 'script', key: 'gone' }, { id: 'n_5', kind: 'script', key: 'odd' }, { id: 'n_a', kind: 'agent', key: 'planner' }] };
  assert.deepEqual(scriptSteps(graph, registry), {
    names: ['Publish to wiki', 'Markdown lint', 'Publish to wiki', 'gone', 'odd'],
    quick: ['Publish to wiki', 'gone', 'odd'],   // a mock that is not an object is not run as a mock (script-runner.mjs)
  });
  assert.deepEqual(scriptSteps(null, registry), { names: [], quick: [] });
  assert.deepEqual(connectorNotes({ scripts: ['Publish to wiki', 'Markdown lint'], quickScripts: ['Publish to wiki', 'Publish to wiki'] }).quickScripts,
    ['Publish to wiki']);
});

test('the dialog notes: a project-file server has its own reason; steps on another engine are named, Claude never', () => {
  const n = connectorNotes({ copies: [{ name: 'slack_team', untested: false }], fileServers: ['files_srv', 'slack_team'],
    engines: ['codex', 'claude', 'codex', 'goose'] });
  assert.deepEqual(n.off, [{ name: 'files_srv', reason: 'file-server' }], 'a registry copy of the same name is not a file server');
  assert.deepEqual(n.engines, ['Codex', 'Goose']);
  assert.equal(fileServerOffLine('files_srv'), "files_srv is switched off: Worca can't pretend for servers from a project file.");
  assert.equal(engineNoteLine('Codex'), "Steps on Codex can still use connectors from Codex's own settings. Pretend can't stop those.");
  // One engine per run (workflows.mjs resolveGraph `engine`): the agent steps run on the run's engine; scripts and flow
  // cards on none.
  const agentic = { nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_a', kind: 'agent' }, { id: 'n_s', kind: 'script' }] };
  assert.deepEqual(stepEngines(agentic, { runEngine: 'codex' }), ['codex']);
  assert.deepEqual(stepEngines(agentic, { runEngine: 'claude' }), ['claude']);
  assert.deepEqual(stepEngines({ nodes: [{ id: 'n_s', kind: 'script' }] }, { runEngine: 'codex' }), []);
  assert.deepEqual(stepEngines(agentic), ['claude'], 'no run.engine setting: Claude');
  assert.deepEqual(connectorNotes({ engines: stepEngines(agentic, { runEngine: 'claude' }) }).engines, []);
  // The engine is checked as a run checks it (selectRunEngine): one a try could not start on names no engine.
  assert.deepEqual(stepEngines(agentic, { runEngine: 'mock' }), ['claude']);
  assert.deepEqual(stepEngines(agentic, { runEngine: 'no-such-engine' }), ['claude']);
  // A project-file server of the same name as a ~/.claude.json one is listed once, as the file server.
  assert.deepEqual(connectorNotes({ fileServers: ['shared_db'], userScope: ['shared_db', 'my-db'] }).off,
    [{ name: 'shared_db', reason: 'file-server' }, { name: 'my-db', reason: 'own-settings' }]);
});

test('pretendCopies: the copies that get a stand-in, by the rule pretendServers uses, with no file written', () => {
  const tests = { 'set1|manual:slack': { ok: true, tools: [{ name: 'post_message' }] }, 'set1|manual:jira': { ok: true, tools: ['create_issue'] },
    'set1|manual:empty': { ok: true, tools: [] }, 'set1|manual:bad': { ok: false, tools: ['x'] } };
  const copies = [{ name: 'slack_team', setId: 'set1', serverId: 'manual:slack', untested: false },
    { name: 'jira_team', setId: 'set1', serverId: 'manual:jira', untested: true },
    { name: 'empty_team', setId: 'set1', serverId: 'manual:empty', untested: false },
    { name: 'bad_team', setId: 'set1', serverId: 'manual:bad', untested: false }];
  assert.deepEqual(pretendCopies(copies, tests).map((c) => c.name), ['slack_team']);
});

test('what a try would have sent: plain words, where to, the first 80 characters, reads apart', async () => {
  assert.deepEqual(['post_message', 'create_issue', 'list_channels', 'sendEmail', 'search', 'get_user_profile'].map(humanizeTool),
    ['post a message', 'create an issue', 'list channels', 'send an email', 'search', 'get user profile']);
  assert.deepEqual(['post_message', 'create_issue', 'search'].map(nounOf), ['message', 'issue', 'call']);
  const long = `Brief ready: Bulk invoice export\n${'x'.repeat(100)}`;
  const c = sentCall({ server: 'slack_team', tool: 'post_message', arguments: { channel: '#product', text: long } });
  assert.deepEqual([c.server, c.tool, c.toolId, c.noun, c.to, c.preview.length, c.preview.endsWith('…'), c.full], ['slack_team', 'post a message', 'post_message', 'message', '#product', 81, true, long]);
  const j = sentCall({ server: 'jira', tool: 'create_issue', arguments: { fields: { summary: 'x' } } });
  assert.deepEqual([j.to, j.preview, j.full], [null, '{"fields":{"summary":"x"}}', '{\n  "fields": {\n    "summary": "x"\n  }\n}']);
  const home = await tmp();
  const { id, dir } = await createPipeline(join(home, 'proj'), { prompt: 'p', title: 't', isTest: true });
  await writeFile(join(dir, CONNECTOR_CALLS_FILE), [
    JSON.stringify({ ts: 't', server: 'slack_team', tool: 'post_message', arguments: { text: 'Hi' }, readOnly: false }),
    JSON.stringify({ ts: 't', server: 'jira', tool: 'search_issues', arguments: { q: 'x' }, readOnly: true }),
    '{"torn',
  ].join('\n'));
  const w = await wouldHaveSent(id);
  assert.deepEqual(w.sent.map((s) => [s.server, s.tool, s.preview]), [['slack_team', 'post a message', 'Hi']]);
  assert.deepEqual(w.reads, [{ server: 'jira', n: 1 }]);
  assert.deepEqual(await wouldHaveSent('nope0000'), { sent: [], reads: [] });
});

test('claude.ai names seen at a run\'s start-up are remembered; ~/.claude.json servers are read', async () => {
  noteSeenServers([{ name: 'claude.ai Gmail', status: 'connected' }, { name: 'pg_billing', status: 'connected' }]);
  noteSeenServers([{ name: 'claude.ai Gmail' }]);
  assert.deepEqual(seenClaudeAiServers(), ['claude.ai Gmail']);
  const home = await tmp();
  await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { zeta: {}, alpha: {} } }));
  assert.deepEqual(userScopeServerNames(home), ['alpha', 'zeta']);
  assert.deepEqual(userScopeServerNames(join(home, 'none')), []);
});

test('spawn flags: a pretend try loads only its mcp.json and withholds claude.ai tools; others are unchanged', () => {
  const base = { projectDir: '/p', claudeOpts: {} };
  const pretend = runOpts({ ...base, mcpStrict: true }, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(pretend.strictMcpConfig, true);
  assert.deepEqual(pretend.disallowedTools, [CLAUDE_AI_TOOLS]);
  assert.equal(CLAUDE_AI_TOOLS, 'mcp__claude_ai_*');
  const normal = runOpts(base, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(normal.strictMcpConfig, undefined);
  assert.equal(normal.disallowedTools, undefined);
  const args = buildClaudeArgs({ prompt: 'p', systemPrompt: 's', permissionMode: 'acceptEdits', strictMcpConfig: true, disallowedTools: pretend.disallowedTools });
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'mcp__claude_ai_*');
});

test('a script step learns it runs in a test, and never inherits that from the server', () => {
  const env = envForShell({ ctx: { test: { connectors: 'pretend' } } }, { PATH: '/usr/bin' });
  assert.deepEqual([env.WORCA_TEST, env.WORCA_TEST_CONNECTORS], ['1', 'pretend']);
  const plain = envForShell({ ctx: {} }, { PATH: '/usr/bin', WORCA_TEST: '1', WORCA_TEST_CONNECTORS: 'real' });
  assert.deepEqual([plain.WORCA_TEST, plain.WORCA_TEST_CONNECTORS], [undefined, undefined]);
});

// ── A real pipeline run (mock engine): the registry layer of test/mcp-pipeline-run.test.mjs ──
const PG_SECRET = 'pg-secret-value-1';
const SENTRY_SECRET = 'sntrys_token_value_2';
const rand = () => Math.random().toString(36).slice(2, 7);
let defs = null;
async function fixture() {
  defs ||= {
    pg: await addManualServer('pg', {
      type: 'stdio', command: 'node', args: ['/srv/pg.js'], env: { PGPASSWORD: { field: 'password' } },
      fields: [{ key: 'password', label: 'Password', secret: true, required: true }], description: 'Read-only replica',
    }),
    sentry: await addManualServer('sentry', {
      type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' } },
      fields: [{ key: 'token', label: 'Sentry token', secret: true, required: true }], description: 'Sentry issues',
    }),
  };
  const dir = gitDir('wft-conn');
  const set = await createSet(`Billing ${rand()}`);
  await putMember(set.id, 'manual:pg', { enabled: true, values: {}, secrets: { password: PG_SECRET } }, { def: defs.pg });
  await putMember(set.id, 'manual:sentry', { enabled: true, values: {}, secrets: { token: SENTRY_SECRET } }, { def: defs.sentry });
  await setProjectAssignment(projectKey(dir), { sets: [set.id], includeGeneral: false });
  // pg passed a Test (its tools are recorded); sentry never did.
  const m = materializeForTest(await viewContext(), set.id, 'manual:pg');
  await recordTest(set.id, 'manual:pg', { at: new Date().toISOString(), ok: true, error: null, fingerprint: m.fingerprint,
    tools: [{ name: 'query', description: 'Run a read-only query', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
  return { dir, set };
}
const runners = (seen) => {
  const record = (ctx) => seen.push({ ctx, file: ctx.mcpConfigPath ? readFileSync(ctx.mcpConfigPath, 'utf8') : null });
  return {
    producer: async (ctx) => { record(ctx); return { status: 'ok', summary: 'ok' }; },
    verifier: async (ctx) => { record(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
};

test('a pretend try: only stand-ins in mcp.json, no secret anywhere in the spawn, strict config, the switched-off copy named', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  const pg = `pg_${set.slug}`;
  const r = runners(seen);
  const producer = r.producer;
  let orch = null;
  // The CLI's init lists only the stand-in. The mock engine sends no mcpServers, so the event is built here, while the
  // run is live (the run's MCP chain closes when it ends).
  r.producer = async (ctx) => {
    orch._onSessionEvent('producer', { init: true, mcpServers: [{ name: pg, status: 'connected' }] }, {});
    await orch._mcpTail;
    return producer(ctx);
  };
  orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: r,
    workflowTest: true, testConnectors: 'pretend' });
  assert.equal((await orch.run()).status, 'done');
  const pipelineDir = orch.getState().pipelineDir;
  const servers = JSON.parse(seen[0].file).mcpServers;
  assert.deepEqual(Object.keys(servers), [pg], 'sentry has no recorded tools: switched off');
  assert.deepEqual([servers[pg].command, servers[pg].args[0], servers[pg].args[2], servers[pg].args[6]],
    [process.execPath, MOCK_CONNECTOR_PATH, pg, join(pipelineDir, CONNECTOR_CALLS_FILE)]);
  assert.equal('env' in servers[pg], false);
  assert.deepEqual(JSON.parse(readFileSync(servers[pg].args[4], 'utf8')).map((t) => t.name), ['query']);
  for (const s of [PG_SECRET, SENTRY_SECRET]) assert.ok(!seen[0].file.includes(s), 'no secret in mcp.json');
  assert.doesNotMatch(seen[0].file, /MCPSECRET_/);
  assert.deepEqual(seen[0].ctx.mcpEnv, {}, 'no secret env reaches the spawn');
  assert.deepEqual([seen[0].ctx.testConnectors, seen[0].ctx.mcpStrict], ['pretend', true]);
  const o = runOpts(seen[0].ctx, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(o.strictMcpConfig, true);
  assert.ok(o.disallowedTools.includes('mcp__claude_ai_*'));
  assert.ok(!JSON.stringify(o.spawnEnv || {}).includes(PG_SECRET));
  assert.ok((await readRunManifest(pipelineDir)).warnings.some((w) => w.includes(`sentry_${set.slug}`) && w.includes('switched off')));
  // The layer the run watches is what it loaded: the stand-in, not the switched-off copy or the real server.
  assert.deepEqual(orch.mcpLayer.copies.map((c) => c.name), [pg]);
  assert.deepEqual(Object.keys(orch.mcpLayer.servers), [pg]);
  assert.equal(orch.mcpLayer.servers[pg].command, process.execPath);
  // An engine that attaches stdio servers only judges the stand-in, never sentry's http server it never starts.
  const engine = orch.claude.engine;
  orch.claude.engine = 'codex';
  try { assert.equal(orch._engineMcpRefusal(orch.mcpLayer), null); } finally { orch.claude.engine = engine; }
  // After that init, the switched-off copy is not "blocked by managed MCP policy"; only the stand-in has a status.
  const m = await readRunManifest(pipelineDir);
  assert.deepEqual((m.warnings || []).filter((w) => w.includes('blocked by managed MCP policy')), []);
  assert.deepEqual(m.mcpStatus, { [pg]: 'connected' });
});

test('a real try is a normal run: the real servers, no strict config', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen),
    workflowTest: true, testConnectors: 'real' });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(Object.keys(JSON.parse(seen[0].file).mcpServers).sort(), [`pg_${set.slug}`, `sentry_${set.slug}`]);
  assert.deepEqual([seen[0].ctx.testConnectors, seen[0].ctx.mcpStrict], ['real', false]);
  assert.equal(runOpts(seen[0].ctx, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] }).strictMcpConfig, undefined);
});

test('the early engine gates judge a pretend try by its stand-ins: codex is not refused for an http copy it never starts; a real try still is', async () => {
  const { dir, set } = await fixture();
  const sentry = `sentry_${set.slug}`;
  // Permissive (as dev's engine-gate tests since G13): a new install's Normal set has rules codex cannot enforce, which
  // would refuse both tries before their MCP layer is judged.
  const make = (testConnectors) => createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, guardrailsId: 'permissive', claude: { mock: true, engine: 'codex' },
    workflowTest: true, testConnectors });
  // Real: sentry's http copy is attached, and codex attaches stdio servers only.
  await assert.rejects(() => make('real')._engineMcpGate(), new RegExp(`codex attaches stdio servers only: ${sentry}$`));
  const refused = await make('real').engineStartRefusal();
  assert.ok(refused && refused.error.includes(sentry), JSON.stringify(refused));
  // Pretend: sentry has no recorded tools, so it gets no stand-in; pg's stand-in is stdio.
  await make('pretend')._engineMcpGate();
  assert.equal(await make('pretend').engineStartRefusal(), null);
});

test('connectorNotes: a Real test lists no pretend names; a pretend test still does', () => {
  const copies = [{ name: 'slack_team', untested: false }, { name: 'jira_team', untested: false }];
  assert.deepEqual(connectorNotes({ copies, mode: 'pretend' }).pretend, ['jira_team', 'slack_team']);
  assert.deepEqual(connectorNotes({ copies }).pretend, ['jira_team', 'slack_team']);
  assert.deepEqual(connectorNotes({ copies, mode: 'real' }).pretend, []);
});
