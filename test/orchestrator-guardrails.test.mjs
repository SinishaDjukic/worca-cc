// test/orchestrator-guardrails.test.mjs
// Guardrails must flow config -> orchestrator -> phases.runOpts -> runClaude opts,
// on run() AND on resume(). Tested at the runOpts seam (pure) plus mock runs
// through the real dispatcher: a _nodeCtx spy (the spyNodeCtxs pattern,
// test/orchestrator-workspace.test.mjs:486-495) for run start, and the
// opts.runners seam (registry merge at orchestrator.mjs:246; runners receive the
// full _nodeCtx, orchestrator.mjs:2062-2065) for resume, with the pause/resume
// bootstrap copied from test/orchestrator-resume.test.mjs. No claude spawn
// anywhere; useTempHome isolates WORCA_HOME + the DB singleton.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { setGuardrails } from '../src/core/config.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-guard-'));
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

/** The stored policy every orchestrator test here enforces. */
const CUSTOM = {
  honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'],
  protectedPaths: ['.env*'], deny: [],
};

/** Capture every dispatched node's claudeOpts — the spyNodeCtxs seam
 *  (test/orchestrator-workspace.test.mjs:486-495), widened to the fields under test. */
function spyClaudeOpts(orch) {
  const seen = [];
  const orig = orch._nodeCtx.bind(orch);
  orch._nodeCtx = (node, pos) => {
    const ctx = orig(node, pos);
    seen.push({ key: node.key, claudeOpts: ctx.claudeOpts || {} });
    return ctx;
  };
  return seen;
}

test('runOpts maps claudeOpts guardrail fields into runClaude options', async () => {
  const { _runOptsForTests } = await import('../src/core/phases.mjs');
  const ctx = {
    projectDir: tmpdir(),
    claudeOpts: {
      permissionMode: 'acceptEdits',
      permissionRules: { deny: ['Read(.env*)'] },
      envScrub: true,
      envAllowlist: ['NPM_TOKEN'],
    },
  };
  const o = _runOptsForTests(ctx, { role: 'planner', prompt: 'p', systemPrompt: '', allowedTools: ['Read'] });
  assert.deepEqual(o.permissionRules, { deny: ['Read(.env*)'] });
  assert.equal(o.envScrub, true);
  assert.deepEqual(o.envAllowlist, ['NPM_TOKEN']);
});

test('runOpts with no guardrails in claudeOpts leaves the options absent (legacy parity)', async () => {
  const { _runOptsForTests } = await import('../src/core/phases.mjs');
  const o = _runOptsForTests({ projectDir: tmpdir(), claudeOpts: {} },
    { role: 'planner', prompt: 'p', systemPrompt: '', allowedTools: ['Read'] });
  assert.equal(o.permissionRules, undefined);
  assert.equal(o.envScrub, undefined);
  assert.equal(o.envAllowlist, undefined);
});

test('orchestrator resolves stored guardrails into claudeOpts at run start (every node) + audits run.json', async () => {
  const prevMode = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'detached'; // needed for the run.json half; the claudeOpts threading is mode-independent
  try {
    const dir = gitDir();
    await setGuardrails(dir, { level: 'custom', custom: { ...CUSTOM } });
    const orch = createOrchestrator({
      projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });
    const seen = spyClaudeOpts(orch);
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(seen.length >= 3, `several nodes ran: ${seen.map((s) => s.key).join(',')}`);
    for (const { key, claudeOpts: c } of seen) {
      // Task 1 expands protectedPaths to Read+Edit ONLY — the CLI never consults a
      // Write(path) deny rule and warns about it on every spawn, so it must NOT appear.
      assert.ok(c.permissionRules?.deny?.includes('Read(.env*)'), `${key}: Read leg present`);
      assert.ok(c.permissionRules?.deny?.includes('Edit(.env*)'), `${key}: Edit leg present`);
      assert.ok(!c.permissionRules?.deny?.includes('Write(.env*)'), `${key}: no Write leg`);
      assert.equal(c.envScrub, true, `${key}: envScrub threaded`);
      assert.deepEqual(c.envAllowlist, ['NPM_TOKEN'], `${key}: allowlist threaded`);
    }
    // Audit (spec bullet): the resolved effective policy rode run.json into the
    // pipeline dir (copyRunManifestTo at teardown, orchestrator.mjs:1452) — the
    // same durable read the §8.19 workspace test uses.
    const manifest = JSON.parse(await readFile(join(orch.getState().pipelineDir, 'run.json'), 'utf8'));
    assert.deepEqual(manifest.guardrails, { envScrub: true, denyCount: 2, protectedCount: 1 });
  } finally {
    if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prevMode;
  }
});

test('RESUME re-resolves guardrails (the v1 gap): a FRESH instance resumed still enforces policy', async () => {
  const dir = gitDir();
  await setGuardrails(dir, { level: 'custom', custom: { ...CUSTOM } });

  // Pause -> fresh-instance -> resume() bootstrap copied from
  // test/orchestrator-resume.test.mjs; the runners seam doubles as the spy since
  // runners receive the full _nodeCtx (orchestrator.mjs:2062-2065). Runs under the
  // ambient run-root mode on purpose — resume threading must hold in either mode.
  let hangOnce = true;
  let orchRef = null;
  const mkRunners = (captured) => ({
    producer: async (ctx) => {
      captured.push({ nodeId: ctx.nodeId, claudeOpts: ctx.claudeOpts || {} });
      if (hangOnce) {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async (ctx) => {
      captured.push({ nodeId: ctx.nodeId, claudeOpts: ctx.claudeOpts || {} });
      return { status: 'ok', issues: [], review: { issues: [] }, summary: '' };
    },
  });

  const run1 = [];
  const orch1 = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners(run1),
  });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  assert.equal(run1[0]?.claudeOpts.envScrub, true, 'pre-pause segment enforced (the run() path)');

  // Restart simulation: a brand-new orchestrator built ONLY from the DB row. Its
  // guardrail fields start null, so whatever the post-resume nodes carry can only
  // come from _resolveGuardrails() inside resume() — never leftover run() state.
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.row.status, 'paused');
  const run2 = [];
  const orch2 = createOrchestrator({
    projectDir: dir, auto: true, claude: { mock: true }, runners: mkRunners(run2), resume: saved,
  });
  orchRef = orch2;
  assert.equal((await orch2.resume()).status, 'done');

  assert.ok(run2.length >= 1, 'nodes ran after resume');
  const first = run2[0].claudeOpts;
  assert.ok(first.permissionRules != null, 'FIRST post-resume node carries permissionRules');
  assert.ok(first.permissionRules.deny.includes('Read(.env*)'));
  assert.equal(first.envScrub, true, 'FIRST post-resume node scrubs');
  assert.deepEqual(first.envAllowlist, ['NPM_TOKEN']);
});
