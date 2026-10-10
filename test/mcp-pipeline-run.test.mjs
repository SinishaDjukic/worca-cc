// test/mcp-pipeline-run.test.mjs — MCP registry design §6: the registry layer in a pipeline run.
// Mock runs through the real dispatcher with custom runners (they receive the full _execCtx, the
// orchestrator-guardrails pattern), detached run roots, and a registry built through the real store
// API under a temp WORCA_HOME. No claude spawn anywhere.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { withEnv, withGw } from './helpers/with-env.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { readPolicyState } from '../src/core/policy/state.mjs';
import { writeGuardrailSet } from '../src/core/guardrail-store.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addManualServer, createSet, putMember, setProjectAssignment, putPolicyServer } from '../src/core/mcp/store.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID, MEMORY_DEFRAG_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { keepListNames } from '../src/core/mcp/keep-list.mjs';
import { bridgedModelInfo } from '../src/core/config.mjs';

useTempHome(after);   // detached run roots are the default

const PG_SECRET = 'pg-secret-value-1';
const SENTRY_SECRET = 'sntrys_token_value_2';

/** The catalog every test shares (a name is added once per WORCA_HOME): a stdio `pg`, an http
 *  `sentry` and the installed policy server `acme/platform/github`. DEF holds the stored
 *  definitions (putMember takes the server's definition). */
const DEF = {};
let catalogReady = null;
const ensureCatalog = () => (catalogReady ||= (async () => {
  DEF.pg = await addManualServer('pg', {
    type: 'stdio', command: 'node', args: ['/srv/pg.js'], env: { PGPASSWORD: { field: 'password' } },
    fields: [{ key: 'password', label: 'Password', secret: true, required: true }], description: 'Read-only replica',
  });
  DEF.sentry = await addManualServer('sentry', {
    type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { Authorization: { field: 'token', prefix: 'Bearer ' } },
    fields: [{ key: 'token', label: 'Sentry token', secret: true, required: true }], description: 'Sentry issues',
  });
  await putPolicyServer('acme/platform/github', { def: { type: 'http', url: 'https://gh.example.com/mcp', fields: [], description: 'GitHub' }, hash: 'h1' });
})());
const rand = () => Math.random().toString(36).slice(2, 7);

/** A project whose own Billing set holds `pg` and `sentry`, both with their secrets set. */
async function fixture() {
  await ensureCatalog();
  const dir = gitDir('mcp-run');
  const set = await createSet(`Billing ${rand()}`);
  await putMember(set.id, 'manual:pg', { enabled: true, values: {}, secrets: { password: PG_SECRET } }, { def: DEF.pg });
  await putMember(set.id, 'manual:sentry', { enabled: true, values: {}, secrets: { token: SENTRY_SECRET } }, { def: DEF.sentry });
  await setProjectAssignment(projectKey(dir), { sets: [set.id], includeGeneral: false });
  return { dir, set };
}

/** producer/verifier runners that record every ctx with its mcp.json text (the run root is
 *  torn down after the run); the first producer call can park the run, after emitting a
 *  system/init frame and an error result. */
function runners(seen, { pauseFirst = null, init = null, result = null } = {}) {
  let hang = !!pauseFirst;
  const record = (ctx) => seen.push({ ctx, file: ctx.mcpConfigPath ? readFileSync(ctx.mcpConfigPath, 'utf8') : null });
  return {
    producer: async (ctx) => {
      record(ctx);
      if (hang) {
        hang = false;
        if (init) ctx.onEvent({ type: 'system', raw: { type: 'system', subtype: 'init', model: 'm', mcp_servers: init } });
        if (result) ctx.onEvent({ type: 'result', raw: { type: 'result', is_error: true, result } });
        queueMicrotask(() => pauseFirst.orch.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async (ctx) => { record(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
}
const serversOf = (rec) => Object.keys(JSON.parse(rec.file).mcpServers).sort();

test('_resolveMcp: workspace scans and memory-defrag runs get no registry layer; _mcpModels unions every model the run may dispatch', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('mcp-skip'), claude: { mock: true, model: 'claude-opus-5-5' } });
  orch.workflowId = MEMORY_DEFRAG_WORKFLOW_ID;
  assert.equal(await orch._resolveMcp([]), null);
  orch.workflowId = WORKSPACE_SCAN_WORKFLOW_ID;
  orch.isWorkspace = true;
  assert.equal(await orch._resolveMcp([]), null);
  orch.state.stepper = { graph: { nodes: [{ id: 'a', model: 'gpt-5-codex' }, { id: 'b', config: { model: 'claude-sonnet-5' } }] } };
  orch.stepModels = { planner: { model: 'openrouter/qwen3' }, reviewer: { model: '' } };
  assert.deepEqual([...orch._mcpModels()].sort(), ['claude-opus-5-5', 'claude-sonnet-5', 'gpt-5-codex', 'openrouter/qwen3']);
});

test('a run gets its target\'s registry copies; a deny rule reaches them and counts in denyCount; nothing secret is persisted', async () => {
  const { dir, set } = await fixture();
  const gr = await writeGuardrailSet({ name: `Deny pg ${set.id}`, settings: { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: ['mcp__pg__query'] } });
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen), guardrailsId: gr.id });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(serversOf(seen[0]), [`pg_${set.slug}`, `sentry_${set.slug}`]);
  assert.deepEqual(orch.guardrailPermissionRules.deny, ['mcp__pg__query', `mcp__pg_${set.slug}__query`]);
  assert.equal('mcpOptOut' in orch._buildResumePoint(null), false, 'no opt-out (propose_run, chains, CLI): none rides the resume point');
  const manifest = await readRunManifest(join(orch.getState().pipelineDir));
  assert.equal(manifest.guardrails.denyCount, 2, 'the added rule is counted');
  const persisted = JSON.stringify(manifest) + JSON.stringify(readPipelineForResume(orch.state.id).row)
    + await readFile(join(orch.getState().pipelineDir, 'live-log.ndjson'), 'utf8');
  for (const s of [PG_SECRET, SENTRY_SECRET]) {
    assert.ok(!persisted.includes(s), 'no secret value in run.json, the row or the log');
    assert.ok(seen.every((r) => !r.file.includes(s)), 'mcp.json carries refs only');
  }
});

test('deviations: from the run policy\'s Team set, persisted even after an earlier persist, re-appended after a resume with the policy\'s own codes kept; resume re-resolves minus the stored opt-out', async () => {
  const { dir, set } = await fixture();
  // github is installed (a consented copy was never taken: needs consent ⇒ off); linear is not.
  const required = [{ name: 'github', type: 'http', url: 'https://gh.example.com/mcp' }, { name: 'linear', type: 'http', url: 'https://mcp.linear.app' }];
  const policy = (persisted, own = []) => async function () {
    this.policyRun = { home: 'acme/platform', homeDir: dir, sha: 'abc1234', fields: { 'mcp.required': { kind: 'soft', value: required } }, deviations: [...own], unattended: true };
    this._policyPersisted = persisted;             // true: as if an Auto classifier spawn persisted first
    this._policyWarned = new Set();
  };
  const run1 = [];
  const box = {};
  const slug = set.slug;
  const failed = `sentry_${slug}: failed to connect (token, URL or command) — run Test in Connectors › ${set.name}`;
  const named = `an MCP tool name is too long for this model — Test the servers in ${set.name} (sentry_${slug})`;
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, mcpOptOut: [`${set.id}|manual:pg`], runners: runners(run1, {
    pauseFirst: box, init: [{ name: `sentry_${slug}`, status: 'failed' }],
    result: 'API Error: 400 {"message":"tools.3.custom.name: String should have at most 128 characters"}',
  }) });
  box.orch = orch1;
  orch1._resolvePolicy = policy(true);
  assert.equal((await orch1.run()).status, 'paused');
  const m1 = await readRunManifest(orch1.runRoot);   // no wait on the chain here: the pause drains it
  assert.deepEqual(m1.mcpStatus, { [`sentry_${slug}`]: 'failed' });
  assert.ok(m1.warnings.includes(named), 'the 400 names the untested copy and its set');
  assert.ok((await readFile(join(orch1.getState().pipelineDir, 'live-log.ndjson'), 'utf8')).includes(failed), 'the warning reached the run log before it closed');
  // An agent still streaming after the pause: its init writes nothing (the pause closed the chain).
  orch1._onAgentEvent('planner', { type: 'system', raw: { type: 'system', subtype: 'init', model: 'm', mcp_servers: [{ name: `sentry_${slug}`, status: 'disabled' }] } });
  await orch1._mcpTail;
  assert.deepEqual((await readRunManifest(orch1.runRoot)).mcpStatus, { [`sentry_${slug}`]: 'failed' }, 'a late init after the pause writes nothing');
  assert.deepEqual(serversOf(run1[0]), [`sentry_${slug}`], 'the opted-out membership does not start');
  assert.deepEqual(readPolicyState(orch1.state.id).deviations, ['mcp-off:github', 'mcp-missing:linear'], 'persisted as a patch');
  const saved = readPipelineForResume(orch1.state.id);
  assert.deepEqual(JSON.parse(saved.row.resume_point).mcpOptOut, [`${set.id}|manual:pg`], 'the opt-out rides the resume point');

  // While paused: a new member joins the set; resume picks it up, the opt-out still holds.
  const docs = await addManualServer('docs', { type: 'http', url: 'https://docs.example.com/mcp', fields: [], description: 'Docs' });
  await putMember(set.id, 'manual:docs', { enabled: true, values: {} }, { def: docs });
  const run2 = [];
  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: runners(run2), resume: saved });
  orch2._resolvePolicy = policy(false, ['guardrails-minimum']);   // a saved workflow: nothing persisted before the assembly
  const logs = [];
  orch2.on('log', (l) => logs.push(l));
  assert.equal((await orch2.resume()).status, 'done');
  assert.deepEqual(serversOf(run2[0]), [`docs_${slug}`, `sentry_${slug}`]);
  assert.deepEqual(orch2.mcpOptOut, [`${set.id}|manual:pg`]);
  assert.deepEqual(orch2.policyRun.deviations, ['guardrails-minimum', 'mcp-off:github', 'mcp-missing:linear'], 're-appended after _resolvePolicy reset the list');
  assert.deepEqual(readPolicyState(orch2.state.id).deviations, ['mcp-off:github', 'mcp-missing:linear', 'guardrails-minimum'],
    'the first persist after the resume keeps the policy\'s own codes');
  assert.ok(logs.some((l) => l.text === 'off-policy: Required MCP server github is off.'));
  assert.ok(logs.some((l) => l.text === 'off-policy: Required MCP server linear is not installed.'));
  const w2 = (await readRunManifest(orch2.getState().pipelineDir)).warnings;
  assert.ok(w2.includes(failed), 're-recorded after the resume re-assembly rewrote the warnings');
  assert.equal(w2.filter((w) => w === named).length, 1, 'the tool-name warning is put back, once');
  assert.equal(orch2._mcpNameWarned, true, 'and the resumed run does not warn it again');
});

test('_resolveMcp over a workspace: each member brings its own sets; the Team set is the workspace policy\'s (ws:<id>)', async () => {
  await ensureCatalog();
  const [a, b] = [gitDir('mcp-ws-a'), gitDir('mcp-ws-b')];
  const set = await createSet(`Shop ${rand()}`);
  await putMember(set.id, 'manual:sentry', { enabled: true, values: {}, secrets: { token: SENTRY_SECRET } }, { def: DEF.sentry });
  await setProjectAssignment(projectKey(a), { sets: [], includeGeneral: false });
  await setProjectAssignment(projectKey(b), { sets: [set.id], includeGeneral: false });
  const orch = createOrchestrator({
    workspace: { id: 'wks-mcp-00000001', key: 'wks-mcp-00000001', name: 'mcp', projects: [a, b].map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: basename(d) })) },
    claude: { mock: true },
  });
  orch.policyRun = { home: 'acme/platform', fields: { 'mcp.required': { kind: 'soft', value: [{ name: 'github', type: 'http', url: 'https://gh.example.com/mcp' }] } }, deviations: [] };
  const { result } = await orch._resolveMcp([]);
  assert.deepEqual(result.copies.map((c) => [c.name, c.projects]), [[`sentry_${set.slug}`, [projectKey(b)]]]);
  assert.ok(result.skipped.some((s) => s.serverId === 'policy:acme/platform/github' && s.reason === 'needs-consent'));
});

test('legacy runs never assemble: no registry layer reaches a dispatch', async () => {
  const { dir } = await fixture();
  const seen = [];
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen) });
    assert.equal((await orch.run()).status, 'done');
    assert.equal(orch.mcpLayer, null);
    assert.ok(seen.length && seen.every((r) => !r.file && r.ctx.mcpEnv === undefined));
  } finally { delete process.env.WORCA_RUN_ROOT; }
});

test('the capability path that drops --mcp-config drops the registry layer too', { skip: process.platform === 'win32' && 'POSIX shell stub' }, async () => {
  const bin = join(mkdtempSync(join(tmpdir(), 'worca-cc-mcp-cap-')), 'claude');
  writeFileSync(bin, '#!/bin/sh\necho "2.1.100 (Claude Code)"\n', { mode: 0o755 });
  const orch = createOrchestrator({ projectDir: gitDir('mcp-cap'), claude: { bin } });
  orch.runRoot = mkdtempSync(join(tmpdir(), 'worca-cc-mcp-cap-rr-'));
  orch.mcpConfigPath = join(orch.runRoot, 'mcp.json');
  orch.mcpServerGrants = ['mcp__pg_billing'];
  orch.mcpLayer = { env: { MCPSECRET_9FFCEB29: PG_SECRET }, redact: [PG_SECRET], disallowed: [], allowlist: ['PATH'], copies: [] };
  await orch._recordCapabilities();
  assert.equal(orch.mcpConfigPath, null);
  assert.equal(orch.mcpLayer, null);
});

test('_resolveMcp: a translated model anywhere in the run sets the 64 limit, so untested copies are skipped `untested`', async () => {
  const { dir } = await fixture();
  await withGw(async () => {
    const orch = createOrchestrator({ projectDir: dir, claude: { mock: true, model: 'claude-opus-5-5' } });
    assert.deepEqual((await orch._resolveMcp([])).result.skipped.map((s) => s.reason), [], 'first-party only: 128, untested copies start');
    orch.stepModels = { reviewer: { model: 'gw-gpt' } };
    const { result } = await orch._resolveMcp([]);
    assert.deepEqual(result.copies, []);
    assert.deepEqual(result.skipped.map((s) => s.reason), ['untested', 'untested']);
  });
});

test('agent isolation: the agent user\'s ~/.claude.json is not worca\'s, so its names are not taken', async () => {
  const { dir, set } = await fixture();
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-mcp-iso-'));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { [`pg_${set.slug}`]: { command: 'x' } } }));
  const firstServers = (vars) => withEnv(vars, async () => {
    const seen = [];
    const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen) });
    assert.equal((await orch.run()).status, 'done');
    return serversOf(seen[0]);
  });
  assert.deepEqual(await firstServers({ HOME: home }), [`pg_${set.slug}_w`, `sentry_${set.slug}`], 'worca\'s own user-scope name is taken');
  assert.deepEqual(await firstServers({ HOME: home, WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/home/worca-agent' }),
    [`pg_${set.slug}`, `sentry_${set.slug}`], 'under isolation no user-scope names are added');
});

// ── env threading (§6.1 Env, §5.5.1) ─────────────────────────────────────────

const RO = { role: 'planner', prompt: 'p', systemPrompt: '', allowedTools: ['Read'] };

test('runOpts: no registry layer ⇒ spawnEnv / redactValues / disallowedTools stay absent (byte-identical spawn)', () => {
  const o = runOpts({ projectDir: tmpdir(), claudeOpts: {}, mcpEnv: {}, mcpRedact: [], mcpDisallowed: [] }, RO);
  assert.equal(o.spawnEnv, undefined);
  assert.equal(o.redactValues, undefined);
  assert.equal(o.disallowedTools, undefined);
});

test('runOpts: the registry env joins the fan-out env; redaction values and withheld tools ride along', () => {
  const ctx = {
    projectDir: tmpdir(), claudeOpts: {}, node: { fanOut: true },
    mcpEnv: { MCPSECRET_9FFCEB29: PG_SECRET }, mcpRedact: [PG_SECRET], mcpDisallowed: ['mcp__pg_billing__a_very_long_tool'],
  };
  const o = runOpts(ctx, RO);
  assert.equal(o.spawnEnv.MCPSECRET_9FFCEB29, PG_SECRET);
  assert.ok(o.spawnEnv.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY, 'the fan-out cap is kept');
  assert.deepEqual(o.redactValues, [PG_SECRET]);
  assert.deepEqual(o.disallowedTools, ['mcp__pg_billing__a_very_long_tool']);
});

// Also: pipelines give registry servers 2 minutes to start, so every dispatch with the
// config gets MCP_TIMEOUT 120000, and worca's own MCP_TIMEOUT wins. The scrub guardrail
// only sets claudeOpts.envAllowlist, so it leaves spawnEnv.MCP_TIMEOUT alone.
test('every dispatch whose mcp.json carries a ${MCPSECRET_…} ref gets its env and MCP_TIMEOUT 120000 (worca\'s own wins); a scrubbed spawn with a stdio copy keeps the launcher keep-list', async () => {
  const { dir, set } = await fixture();
  const gr = await writeGuardrailSet({ name: `Scrub ${set.id}`, settings: { honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'], protectedPaths: [], deny: [] } });
  const seen = [];
  await withEnv({ MCP_TIMEOUT: undefined }, async () => {   // a worca spawn may set it
    const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen), guardrailsId: gr.id });
    assert.equal((await orch.run()).status, 'done');
  });
  const withConfig = seen.filter((r) => r.file);
  assert.ok(withConfig.length >= 2, 'several dispatches carried the config');
  for (const { ctx, file } of withConfig) {
    const refs = [...file.matchAll(/\$\{(MCPSECRET_[0-9A-F]{8})\}/g)].map((m) => m[1]);
    assert.equal(refs.length, 2, 'pg and sentry each carry one ref');
    const o = runOpts(ctx, RO);
    for (const r of refs) assert.ok(o.spawnEnv?.[r], `${r} reaches the spawn env`);
    assert.deepEqual([...o.redactValues].sort(), [PG_SECRET, SENTRY_SECRET].sort());
    assert.deepEqual(ctx.claudeOpts.envAllowlist, ['NPM_TOKEN', ...keepListNames()]);
    assert.equal(runOpts(ctx, RO).spawnEnv.MCP_TIMEOUT, '120000');
  }

  const httpOnly = [];
  const orch2 = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(httpOnly), guardrailsId: gr.id, mcpOptOut: [`${set.id}|manual:pg`] });
  assert.equal((await orch2.run()).status, 'done');
  assert.deepEqual(httpOnly[0].ctx.claudeOpts.envAllowlist, ['NPM_TOKEN'], 'no stdio copy ⇒ the set\'s own allowlist');

  await withEnv({ MCP_TIMEOUT: '300000' }, async () => {
    const { result } = await createOrchestrator({ projectDir: dir, claude: { mock: true } })._resolveMcp([]);
    assert.equal(result.env.MCP_TIMEOUT, '300000');
  });
});

test('runOpts: a bridged model keeps its own withheld tools beside the registry ones', () => withGw(() => {
  const excl = bridgedModelInfo('gw-gpt').excludeTools;
  assert.ok(excl?.length, 'the bridge withholds tools for this model');
  const o = runOpts({ projectDir: tmpdir(), claudeOpts: { model: 'gw-gpt' }, mcpDisallowed: ['mcp__pg_billing__x'] }, RO);
  assert.deepEqual(o.disallowedTools, [...excl, 'mcp__pg_billing__x']);
}));

// ── connection problems at spawn time (§10) ─────────────────────────────────────

const init = (servers) => ({ type: 'system', raw: { type: 'system', subtype: 'init', model: 'm', mcp_servers: servers } });

test('§10: init statuses become one warning per copy and status, kept in run.json.mcpStatus; concurrent inits lose no key', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('mcp-init'), claude: { mock: true } });
  orch.runRoot = mkdtempSync(join(tmpdir(), 'worca-cc-mcp-init-'));
  orch.mcpLayer = { env: {}, redact: [], disallowed: [], allowlist: [], copies: [
    { name: 'sentry_billing', setName: 'Billing', untested: false },
    { name: 'pg_billing', setName: 'Billing', untested: true },
    { name: 'jira', setName: 'General', untested: true },
  ] };
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  orch._onAgentEvent('planner', { type: 'system', raw: { type: 'system', subtype: 'init', model: 'm' } });   // no mcp_servers: says nothing
  orch._onAgentEvent('planner', init([{ name: 'sentry_billing', status: 'failed' }, { name: 'pg_billing', status: 'pending' }, { name: 'jira', status: 'connected' }]));
  orch._onAgentEvent('reviewer', init([{ name: 'sentry_billing', status: 'pending' }, { name: 'pg_billing', status: 'needs-auth' }, { name: 'jira', status: 'connected' }]));
  orch._onAgentEvent('planner', init([{ name: 'sentry_billing', status: 'failed' }, { name: 'pg_billing', status: 'disabled' }]));
  orch._onAgentEvent('reviewer', init([{ name: 'sentry_billing', status: 'connected' }, { name: 'pg_billing', status: 'disabled' }]));
  orch._onAgentEvent('planner', init([{ name: 'sentry_billing', status: 'failed' }, { name: 'pg_billing', status: 'disabled' }]));
  await orch._mcpTail;
  const m = await readRunManifest(orch.runRoot);
  assert.deepEqual(m.mcpStatus, { sentry_billing: 'failed', pg_billing: 'disabled', jira: 'absent' });
  assert.deepEqual(m.warnings, [
    'sentry_billing: failed to connect (token, URL or command) — run Test in Connectors › Billing',
    'pg_billing: failed to connect (token, URL or command) — run Test in Connectors › Billing',
    'pg_billing: disabled by your Claude Code settings (set Billing)',
    'jira: blocked by managed MCP policy (set General)',
  ], 'a repeated (or flapping) sentry failure is not warned twice; pending is not a warning');
  assert.ok(logs.some((l) => l.level === 'debug' && l.text === 'pg_billing: MCP server still starting (pending)'));

  // A long error text of near misses costs the server process nothing (the check runs on every error result).
  const t0 = Date.now();
  orch._onAgentEvent('planner', { type: 'result', raw: { type: 'result', is_error: true, result: `${'tools.1 name '.repeat(1000)}at most` } });
  assert.ok(Date.now() - t0 < 1000, `the tool-name check took ${Date.now() - t0} ms`);
  // A result error on an over-long tool name: one warning, naming the untested copies and their sets.
  const bad = { type: 'result', raw: { type: 'result', is_error: true, result: 'API Error: 400 {"message":"tools.12.custom.name: String should have at most 128 characters"}' } };
  orch._onAgentEvent('planner', bad);
  orch._onAgentEvent('reviewer', bad);
  await orch._mcpTail;
  assert.deepEqual((await readRunManifest(orch.runRoot)).warnings.slice(4), [
    'an MCP tool name is too long for this model — Test the servers in Billing, General (pg_billing, jira)',
  ]);

  // §5.5.3: a run warning is redacted with the layer's secret values.
  orch.mcpLayer.redact = [SENTRY_SECRET];
  await orch._recordRunWarning(`sentry_billing: upstream said ${SENTRY_SECRET}`);
  assert.equal((await readRunManifest(orch.runRoot)).warnings.at(-1), 'sentry_billing: upstream said [redacted]');
});

test('§10: a run.json write still queued on the MCP chain when the run ends lands in the durable run.json; a later one is dropped', async () => {
  const { dir } = await fixture();
  const base = runners([]);
  let orch = null;
  // The queued write is held until the run's teardown reads the chain's tail to drain it: it is
  // still on the chain when the run ends, and a teardown that copied run.json without draining
  // would leave it out (never a timer: a short one can land before the end and prove nothing).
  let release;
  const drained = new Promise((r) => { release = r; });
  const late = {
    ...base,
    verifier: async (ctx) => {
      orch._mcpChain(() => drained.then(() => orch._recordRunWarning('late MCP line')));
      return base.verifier(ctx);
    },
  };
  orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: late });
  const teardown = orch._teardownRunRoot.bind(orch);
  let tearingDown = false;
  orch._teardownRunRoot = (...a) => { tearingDown = true; return teardown(...a); };
  let tail = orch._mcpTail;
  Object.defineProperty(orch, '_mcpTail', {
    configurable: true, enumerable: true,
    get: () => { if (tearingDown) release(); return tail; },
    set: (v) => { tail = v; },
  });
  assert.equal((await orch.run()).status, 'done');
  assert.ok((await readRunManifest(orch.getState().pipelineDir)).warnings.includes('late MCP line'), 'teardown waited for the chain');
  // A late init (a sibling still streaming after the run ended): the closed chain writes nothing.
  orch._onAgentEvent('planner', init([{ name: orch.mcpLayer.copies[0].name, status: 'failed' }]));
  await orch._mcpTail;
  assert.equal(existsSync(orch.runRoot), false, 'the removed run root is never recreated');
});
