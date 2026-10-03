// test/claude-argv-snapshot.test.mjs
// THE spawn pin: what the `claude` binary actually receives, per shipped agent
// role and per option family. Every case drives the REAL production path, the
// graph executor (prepare -> runOpts -> runClaude -> runReal), or the Ask Worca
// and title builders, against a fake `claude` that records its argv, stdin and
// any staged files, and snapshots that record against
// test/fixtures/argv-snapshots/<case>.json.
//
// What is pinned: every flag, its order, every flag value (the --settings JSON,
// the tool lists, the host-guard preamble), stdin, staged files, and the env
// keys the runner adds or changes. What is NOT pinned byte for byte: the task
// prompt and the agent's system prompt. test/graph-prompt-parity.test.mjs owns
// those, so here they are replaced by <PROMPT> / <SYSTEM_PROMPT> only when they
// equal what their own builders produce; any other text stays literal and fails
// the snapshot.
//
// Regenerating (after a DELIBERATE argv change, review the diff):
//   UPDATE_ARGV_SNAPSHOTS=1 WORCA_HOME=$(mktemp -d) node --test test/claude-argv-snapshot.test.mjs
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { buildSystemPrompt, resolveAgentBody, RESUME_HEADER } from '../src/core/phases.mjs';
import {
  buildAgentPrompt, allocateOutputs, allocateVerdict, expandsOutputPort,
  runAgentExecution, runClarifierExecution,
} from '../src/core/graph/executor.mjs';
import { buildAskSpawnOptions } from '../src/core/ask/spawn.mjs';
import { STREAM_TIMEOUT_ENV_KEYS } from '../src/core/model-env.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { generateTitle } from '../src/core/title.mjs';
import { addGlobalModel, updateProvider } from '../src/core/settings.mjs';
import { stopBridge } from '../src/core/bridge/server.mjs';

const POSIX = process.platform === 'win32'
  ? { skip: 'the fake claude is a node script with a shebang (no .exe stand-in on Windows)' } : {};

useTempHome(after);

const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const AGENTS_DIR = join(REPO, 'agents');
const SNAPSHOT_DIR = join(REPO, 'test', 'fixtures', 'argv-snapshots');
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);
const BUILTIN_KEYS = Object.keys(REGISTRY).sort();

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(async () => {
  await stopBridge();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const projectDir = tmp('worca-argv-proj-');
const pipelineDir = tmp('worca-argv-pipe-');
const shimDir = tmp('worca-argv-shim-');
const RECORD = join(shimDir, 'record.json');

// The fake claude: records what it was given, then answers like a finished run.
// Staged files (GH #380) are read here because runReal deletes them on exit.
const SHIM = join(shimDir, 'claude');
writeFileSync(SHIM, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
const files = {};
for (const flag of ['--append-system-prompt-file', '--settings']) {
  const i = args.indexOf(flag);
  if (i >= 0 && fs.existsSync(args[i + 1])) files[flag] = fs.readFileSync(args[i + 1], 'utf8');
}
fs.writeFileSync(${JSON.stringify(RECORD)}, JSON.stringify({ args, stdin, files, env: process.env }));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-argv' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0 }) + '\\n');
`, 'utf8');
chmodSync(SHIM, 0o755);

// Everything that steers the runner, plus every ambient key the runner may set
// itself (model routing env): cleared per case so envAdded is the same on every
// machine, whatever the developer's shell exports.
const ENV_KEYS = [
  'WORCA_MOCK', 'ORCH_MOCK', 'WORCA_SUBAGENT_HOOKS', 'WORCA_HOST_GUARD', 'WORCA_EFFORT_FLAG', 'WORCA_DEBUG_SPAWN', 'WORCA_AGENT_USER',
  'ENABLE_TOOL_SEARCH', ...STREAM_TIMEOUT_ENV_KEYS,   // API_TIMEOUT_MS & co. are set only when the shell has not (Claude Code exports one)
  ...Object.keys(process.env).filter((k) => k.startsWith('ANTHROPIC_') || k.startsWith('CLAUDE_')),
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function cleanEnv(over = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, over);
}
afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

// ── the graph ctx, assembled the way the orchestrator hands it to the executor ──

const nodeId = (key) => `n_${key}`;
const TPL = {
  id: 'wf_argv', name: 'Argv', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    ...BUILTIN_KEYS.map((key, i) => ({ id: nodeId(key), kind: 'agent', key, x: 200 + i * 40, y: 0, config: {} })),
  ],
  wires: [
    { id: 'w_t_clarify', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('clarify'), port: 'task' } },
    { id: 'w_t_planner', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('planner'), port: 'task' } },
    { id: 'w_t_scan', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('workspaceScanner'), port: 'task' } },
    { id: 'w_dec_impl', from: { node: nodeId('decomposer'), port: 'tasks' }, to: { node: nodeId('implementer'), port: 'task' } },
  ],
};

function frontmatterTools(key) {
  const text = readFileSync(join(AGENTS_DIR, REGISTRY[key].agentFile), 'utf8');
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  const line = m ? m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l)) : null;
  return line ? line.replace(/^tools\s*:/, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const ORDINAL = 2;
function ctxFor(key, { claudeOpts = {}, taskPrompt = 'BUILD THE THING', extra = {} } = {}) {
  const meta = REGISTRY[key];
  const node = {
    id: nodeId(key), kind: 'agent', key, x: 0, y: 0, config: {},
    fanOut: !!meta.fanOut, agentPrompt: `You are ${meta.displayName}.`, tools: frontmatterTools(key),
  };
  const ports = portsFn(node);
  let v = 0;
  const runCtx = {
    pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
    workspaceKey: null, duplicateKey: false, slice: null, planVersion: () => { v += 1; return v; },
  };
  const bindings = {};
  for (const port of (ports.inputs || []).filter((p) => p.id !== 'await' && p.required)) {
    bindings[port.id] = port.type === 'void'
      ? { seq: 1, type: 'void' }
      : { seq: 1, type: port.type, path: `/abs/${port.id}.${port.type === 'json' ? 'json' : 'md'}` };
  }
  const executionId = `x:${node.id}:${ORDINAL}`;
  return {
    node, nodeId: node.id, ports, meta, bindings,
    trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
    ordinal: ORDINAL, cycle: ORDINAL, executionId, runCtx, slice: null,
    outputs: allocateOutputs({ node, ports, executionId, ordinal: ORDINAL, runCtx }),
    verdict: allocateVerdict({ node, ports, ordinal: ORDINAL, runCtx }),
    expandsPort: expandsOutputPort(TPL, portsFn, node.id),
    projectDir, pipelineDir, taskPrompt, toolInstruction: 'TOOLS',
    checkpointRef: 'abc1234', extras: [], workspace: null, runRoot: null, template: TPL,
    priorAnswers: [], agentPrompts: {},
    claudeOpts: { bin: SHIM, mock: false, ...claudeOpts },
    ...extra,
  };
}

// ── capture + normalisation ──────────────────────────────────────────────────

function readRecord() {
  assert.ok(existsSync(RECORD), 'the fake claude was spawned');
  const rec = JSON.parse(readFileSync(RECORD, 'utf8'));
  rmSync(RECORD, { force: true });
  return rec;
}

/** Placeholders for everything that differs per machine or per run. Longest first. */
function scrubber(extra = []) {
  const subs = [
    ...extra,
    [process.execPath, '<NODE>'],
    [worcaHome(), '<WORCA_HOME>'],
    [pipelineDir, '<PIPELINE_DIR>'],
    [projectDir, '<PROJECT_DIR>'],
    [projectKey(projectDir), '<STORE_KEY>'],
    [shimDir, '<SHIM_DIR>'],
    [REPO, '<REPO>'],
    [`PID ${process.pid}`, 'PID <PID>'],
  ].filter(([from]) => from).sort((a, b) => b[0].length - a[0].length);
  return (s) => {
    let out = subs.reduce((acc, [from, to]) => acc.split(from).join(to), String(s));
    out = out.split(join(tmpdir(), 'worca-claude-')).join('<STAGE_DIR>-').replace(/<STAGE_DIR>-[A-Za-z0-9]+/g, '<STAGE_DIR>');
    out = out.replace(/:\/\/127\.0\.0\.1:\d+/g, '://127.0.0.1:<PORT>');
    return out;
  };
}

/** The env the runner ADDED or CHANGED relative to this process (never the ambient env). */
function envDelta(childEnv, scrub, secrets = []) {
  const out = {};
  for (const [k, v] of Object.entries(childEnv).sort(([a], [b]) => a.localeCompare(b))) {
    if (process.env[k] === v) continue;
    out[k] = secrets.includes(v) ? '<SECRET>' : v === String(process.pid) ? '<PID>' : scrub(v);
  }
  return out;
}

function snapshotOf(rec, { prompt, systemPrompt, secrets = [] }) {
  const replacements = [];
  if (systemPrompt) replacements.push([systemPrompt, '<SYSTEM_PROMPT>']);
  if (prompt) replacements.push([prompt, '<PROMPT>']);
  const scrub = scrubber(replacements);
  return {
    args: rec.args.map(scrub),
    stdin: scrub(rec.stdin),
    files: Object.fromEntries(Object.entries(rec.files).map(([k, v]) => [k, scrub(v)])),
    envAdded: envDelta(rec.env, scrub, secrets),
  };
}

function assertSnapshot(name, actual) {
  const file = join(SNAPSHOT_DIR, `${name}.json`);
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  // The run's own temp paths (every tmp() dir, the shim's included, and the stage dirs), not tmpdir() itself: where that
  // is /tmp, it is also a substring of the Ask deny rule Read(//**/.worca-cc/tmp/**), which is correct output.
  for (const leak of [...scratch, join(tmpdir(), 'worca-claude-'), `PID ${process.pid}`]) {
    assert.equal(text.includes(leak), false, `${name}: un-normalised value leaked: ${leak}`);
  }
  if (process.env.UPDATE_ARGV_SNAPSHOTS === '1') {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(file, text, 'utf8');
    return;
  }
  assert.ok(existsSync(file), `${name}: no snapshot yet; regenerate with UPDATE_ARGV_SNAPSHOTS=1 (see header)`);
  assert.equal(text, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'),
    `${name}: the claude argv changed. If deliberate, review the diff and regenerate with UPDATE_ARGV_SNAPSHOTS=1.`);
}

/** Run one graph node through the real executor and return its spawn record. */
async function spawnNode(key, opts = {}) {
  const ctx = ctxFor(key, opts);
  const run = REGISTRY[key].runnerType === 'clarifier' ? runClarifierExecution : runAgentExecution;
  try { await run(ctx); } catch { /* post-spawn reads may miss the files a real agent would write */ }
  const rec = readRecord();
  const systemPrompt = buildSystemPrompt(ctx.toolInstruction, resolveAgentBody(ctx, key), key, ctx.workspace, ctx.memoryBlock);
  return { rec, prompt: buildAgentPrompt(ctx), systemPrompt };
}

// ── the cases ────────────────────────────────────────────────────────────────

test('the pin covers exactly the 22 shipped builtins', () => {
  assert.deepEqual(BUILTIN_KEYS, [
    'clarify', 'deckAudit', 'deckBuilder', 'deckClarify', 'deckExport', 'deckNarrative', 'deckOutputs',
    'deckReviewer', 'deckSystem', 'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting',
    'memoryDefragmenter', 'planReviewer', 'planner', 'refiner', 'reviewer', 'workspaceReviewer', 'workspaceScanner',
    'workspaceSynthesizer', 'workspaceUsageMapper',
  ]);
});

for (const key of BUILTIN_KEYS) {
  test(`role ${key}: default spawn`, POSIX, async () => {
    cleanEnv();
    const { rec, prompt, systemPrompt } = await spawnNode(key);
    assertSnapshot(`role-${key}`, snapshotOf(rec, { prompt, systemPrompt }));
  });
}

test('implementer with every pipeline option set', POSIX, async () => {
  cleanEnv();
  const memoryMount = tmp('worca-argv-mem-');
  const { rec, prompt, systemPrompt } = await spawnNode('implementer', {
    claudeOpts: {
      model: 'opus', effort: 'high', permissionMode: 'acceptEdits',
      permissionRules: { deny: ['Bash(curl:*)', 'Read(~/.ssh/**)'], allow: ['Bash(npm test:*)'] },
      envScrub: true, envAllowlist: ['SSH_AUTH_SOCK'],
    },
    extra: {
      resumeSessionId: 'sess-resume-1',
      mcpConfigPath: '/abs/run/mcp.json', mcpServerGrants: ['mcp__worca', 'mcp__github'],
      memoryMount, memoryBlock: '## Worca memory\n\nRules live in .claude/rules/worca.',
    },
  });
  assert.ok(rec.args[1].startsWith(RESUME_HEADER), 'resume header precedes the prompt');
  const snap = snapshotOf(rec, { prompt, systemPrompt });
  const scrubMem = (s) => s.split(memoryMount).join('<MEMORY_MOUNT>');
  assertSnapshot('implementer-all-options', JSON.parse(scrubMem(JSON.stringify(snap))));
});

test('reviewer with sub-agent hook telemetry on', POSIX, async () => {
  cleanEnv({ WORCA_SUBAGENT_HOOKS: '1' });
  const { rec, prompt, systemPrompt } = await spawnNode('reviewer');
  assertSnapshot('reviewer-subagent-hooks', snapshotOf(rec, { prompt, systemPrompt }));
});

test('reviewer with the host guard off', POSIX, async () => {
  cleanEnv({ WORCA_HOST_GUARD: '0' });
  const { rec, prompt, systemPrompt } = await spawnNode('reviewer');
  assertSnapshot('reviewer-host-guard-off', snapshotOf(rec, { prompt, systemPrompt }));
});

test('planner over the inline argv limit is staged (prompt on stdin, files for the rest)', POSIX, async () => {
  cleanEnv();
  const { rec, prompt, systemPrompt } = await spawnNode('planner', { taskPrompt: `BUILD THE THING\n${'x'.repeat(30000)}` });
  assert.equal(rec.args.includes(prompt), false, 'the prompt is not inline');
  assertSnapshot('planner-staged', snapshotOf(rec, { prompt, systemPrompt }));
});

test('implementer on a translated (bridged) model', POSIX, async () => {
  cleanEnv();
  // The global model catalog lives under the OS home: sandbox it for this case.
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  const home = tmp('worca-argv-home-');
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    await updateProvider('openai', { apiKey: 'sk-argv-snapshot', baseUrl: 'http://127.0.0.1:9/v1' });
    await addGlobalModel({ id: 'argv-gpt', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x' } });
    const { rec, prompt, systemPrompt } = await spawnNode('implementer', { claudeOpts: { model: 'argv-gpt' } });
    const secret = rec.env.ANTHROPIC_AUTH_TOKEN;
    assert.ok(secret, 'the bridge secret rides the env');
    assertSnapshot('implementer-bridged-model', snapshotOf(rec, { prompt, systemPrompt, secrets: [secret] }));
  } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('Ask Worca turn spawn', POSIX, async () => {
  cleanEnv();
  const scratchDir = tmp('worca-argv-ask-');
  const opts = buildAskSpawnOptions({
    thread: { id: 'ask_0123abcd', sessionId: 'sess-ask-1' },
    turn: { prompt: 'How many runs failed today?', systemPrompt: 'ASK SYSTEM', model: 'sonnet', effort: 'medium' },
    limits: { maxTurns: 12, maxBudgetUsd: 0.5 },
    mcpConfigPath: join(scratchDir, 'mcp-msg1.json'),
    scratchDir,
    memoryDir: join(scratchDir, 'mem'),
  });
  await runClaude({ ...opts, bin: SHIM });
  const snap = snapshotOf(readRecord(), { prompt: opts.prompt, systemPrompt: opts.systemPrompt });
  assertSnapshot('ask-turn', JSON.parse(JSON.stringify(snap).split(scratchDir).join('<ASK_SCRATCH>')));
});

test('title generation spawn', POSIX, async () => {
  cleanEnv();
  await generateTitle('Add a README badge for the test status', { cwd: projectDir, bin: SHIM, mock: false });
  assertSnapshot('title', snapshotOf(readRecord(), {}));
});
