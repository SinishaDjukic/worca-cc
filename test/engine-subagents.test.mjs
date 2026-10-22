// test/engine-subagents.test.mjs
// Decision 11 (plans/core-protection-layer-design.md §4.4): an engine's sub-agent tool stays only when the catalog
// proves its sub-agents keep the run's rules (a recorded denial from inside a sub-agent); otherwise the core switches
// it off on every spawn, and an engine that cannot switch it off is refused without --allow-unguarded-engine.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { _testing as executorTesting } from '../src/core/graph/executor.mjs';
import { runCodexProcess, CODEX_SUBAGENTS_OFF } from '../src/core/engines/codex.mjs';
import { subagentPolicy } from '../src/core/engines/index.mjs';
import { ENGINES, setCatalogForTest } from '../src/shared/engine-switch.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-subagents-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
afterEach(() => setCatalogForTest(null));

const orch = (claude = {}) => { const o = createOrchestrator({ projectDir: '/tmp/sub-proj', guardrailsId: 'permissive', claude: { mock: true, ...claude } }); o.resolved = { nodeCtx: {} }; return o; };
/** ENGINES with `engine`'s entry changed by `patch` (a shallow merge per field). */
const cloneWith = (engine, patch) => ({ ...ENGINES, [engine]: { ...ENGINES[engine], ...patch } });

test('the catalog decides: claude keeps its proven sub-agents; codex and copilot have theirs switched off', () => {
  assert.equal(subagentPolicy('claude'), 'allow');
  assert.equal(subagentPolicy('codex'), 'deny');
  assert.equal(subagentPolicy('copilot'), 'deny');
  assert.equal(subagentPolicy('cursor'), 'allow', 'no sub-agent tool to switch off');
});

test('codex pipeline denies multi_agent', POSIX, async () => {
  const o = orch({ engine: 'codex' });
  const lines = o._engineGate();
  assert.equal(o._subagentsOff, true, 'the gate switches the tool off for every spawn of the run');
  assert.ok(lines.includes("engine codex: its sub-agent tool (multi_agent) is off: its sub-agents are not proven to keep this run's rules"), lines.join('\n'));
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', usageDir: dir, subagentsOff: true, allowedTools: ['Read', 'Agent'] });
  const args = fake.args().join(' ');
  assert.ok(args.includes(CODEX_SUBAGENTS_OFF.join(' ')), args);
  assert.equal(args.includes('agents.worca_investigator'), false, 'no investigator role either');
});

test('proven inheritance keeps the tool', POSIX, async () => {
  const proofDir = tmp();
  mkdirSync(join(proofDir, 'codex'));
  writeFileSync(join(proofDir, 'codex', 'subagent.denial.jsonl'), '{}\n');
  setCatalogForTest(cloneWith('codex', { subagents: { tool: 'multi_agent', inheritsRules: 'yes', proof: 'codex/subagent.denial.jsonl' } }));
  assert.equal(subagentPolicy('codex', { proofDir }), 'allow');
  assert.equal(subagentPolicy('codex', { proofDir: tmp() }), 'deny', 'a proof that is not there proves nothing');
  const o = orch({ engine: 'codex' });
  o._engineGate();
  assert.equal(o._subagentsOff, false);
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', usageDir: dir, subagentsOff: o._subagentsOff });
  assert.equal(fake.args().join(' ').includes('multi_agent'), false);
});

test('cannot deny means refuse', () => {
  // Cursor's adapter cannot switch a sub-agent tool off: give its catalog entry one it does not prove.
  setCatalogForTest(cloneWith('cursor', { subagents: { tool: 'background_agent', inheritsRules: 'unverified', proof: null } }));
  assert.equal(subagentPolicy('cursor'), 'refuse');
  assert.throws(() => orch({ engine: 'cursor' })._engineGate(), /engine cursor: this engine's sub-agents \(its background_agent tool\) are not proven to keep the run's rules, and it cannot switch that tool off — pass --allow-unguarded-engine/);
  const allowed = orch({ engine: 'cursor', allowUnguardedEngine: true });
  const lines = allowed._engineGate();
  assert.ok(lines.some((l) => /its sub-agents \(background_agent\) may not keep this run's rules and cannot be switched off/.test(l)), lines.join('\n'));
});

test('a claude run whose sub-agents are not proven loses its Agent tool', () => {
  setCatalogForTest(cloneWith('claude', { subagents: { tool: 'Agent', inheritsRules: 'unverified', proof: null } }));
  const o = orch();
  o._engineGate();
  assert.equal(o._subagentsOff, true);
});

// ── Decision 11 end to end: Orchestrator → executor → phases.runOpts → runClaude → the REAL adapter → argv ─────────

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-engine.mjs');

/**
 * One run through the real Orchestrator. The run is a mock run (nothing else spawns), but its FIRST agent spawn
 * also goes, with the options the executor built through phases.runOpts, through runClaude's engine dispatch to the
 * real adapter against test/fixtures/fake-engine.mjs; the run is stopped there. Returns the argv that fake recorded.
 */
async function firstSpawnArgv(engine) {
  const dir = tmp();
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  const out = join(dir, 'rec.json');
  let first = null;
  executorTesting.runClaude = async (opts) => {
    if (!first) {
      first = opts;
      const prev = { FAKE_OUT: process.env.FAKE_OUT, FAKE_STREAM: process.env.FAKE_STREAM };
      Object.assign(process.env, { FAKE_OUT: out, FAKE_STREAM: join(HERE, 'fixtures', 'engines', engine, 'stream.jsonl') });
      try {
        await runClaude({ ...opts, mock: false, bin: FAKE, envAllowlist: [...(opts.envAllowlist || []), 'FAKE_OUT', 'FAKE_STREAM'], onEvent: () => {} });
      } finally {
        for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    }
    o.stop();   // one spawn is all this needs
    return runClaude(opts);
  };
  const o = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, branch: { source: 'main' }, guardrailsId: 'permissive', claude: { mock: true, engine } });
  try {
    assert.equal((await o.run()).status, 'stopped');
  } finally { executorTesting.runClaude = null; }
  assert.ok(first?.allowedTools?.includes('Agent'), 'the node grants its sub-agent tool: taking it away is the run gate\'s doing');
  return JSON.parse(readFileSync(out, 'utf8')).argv;
}
const argAfter = (argv, flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const hasRun = (argv, seq) => argv.some((_, i) => seq.every((s, j) => argv[i + j] === s));

test('decision 11 end to end, codex: a run\'s spawn disables multi_agent and gets no investigator role; proven sub-agents keep both', POSIX, async () => {
  const off = await firstSpawnArgv('codex');
  assert.ok(hasRun(off, CODEX_SUBAGENTS_OFF), `the spawn disables multi_agent: ${off.filter((a) => a.startsWith('--disable') || a.includes('multi_agent')).join(' ')}`);
  assert.equal(off.some((a) => a.includes('worca_investigator')), false, 'no investigator role either');
  setCatalogForTest(cloneWith('codex', { subagents: { tool: 'multi_agent', inheritsRules: 'yes', proof: 'codex/subagent.denial.jsonl' } }));
  const on = await firstSpawnArgv('codex');
  assert.equal(on.includes('multi_agent'), false, 'proven: the tool stays');
  assert.ok(on.some((a) => a.includes('agents.worca_investigator')), 'proven: the fan-out keeps its investigator role');
});

test('decision 11 end to end, copilot: a run\'s spawn excludes task; proven sub-agents keep it', POSIX, async () => {
  const excluded = (argv) => (argv.find((a) => a.startsWith('--excluded-tools=')) || '').slice('--excluded-tools='.length).split(',');
  const off = excluded(await firstSpawnArgv('copilot'));
  assert.ok(off.includes('task'), `--excluded-tools=${off.join(',')}`);
  setCatalogForTest(cloneWith('copilot', { subagents: { tool: 'task', inheritsRules: 'yes', proof: 'copilot/subagent.denial.jsonl' } }));
  assert.equal(excluded(await firstSpawnArgv('copilot')).includes('task'), false, 'proven: the node keeps the task tool it was granted');
});

test('decision 11 end to end, claude: unproven sub-agents put Agent and Task in --disallowedTools; the real catalog keeps them', POSIX, async () => {
  setCatalogForTest(cloneWith('claude', { subagents: { tool: 'Agent', inheritsRules: 'unverified', proof: null } }));
  const off = await firstSpawnArgv('claude');
  const denied = (argAfter(off, '--disallowedTools') || '').split(',');
  assert.ok(denied.includes('Agent') && denied.includes('Task'), `--disallowedTools ${denied.join(',')}`);
  setCatalogForTest(null);
  const on = await firstSpawnArgv('claude');
  assert.equal((argAfter(on, '--disallowedTools') || '').split(',').includes('Agent'), false, 'claude\'s recorded proof keeps its Agent tool');
});
