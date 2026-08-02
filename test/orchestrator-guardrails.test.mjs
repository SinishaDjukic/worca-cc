// test/orchestrator-guardrails.test.mjs
// PER-RUN guardrails: the run-selected guardrail set IS
// the run's policy — member project configs are NOT consulted. Flow:
// guardrailsId -> _resolveGuardrails (guardrail-store read) -> claudeOpts ->
// runClaude opts, on run() AND on resume() (Task 8 appends the resume tests).
// Tested at the runOpts seam (pure) plus mock runs through the real dispatcher
// with a _nodeCtx spy (the spyNodeCtxs pattern,
// test/orchestrator-workspace.test.mjs:486-495). No claude spawn anywhere;
// useTempHome isolates WORCA_HOME + the DB singleton.
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
import { writeGuardrailSet } from '../src/core/guardrail-store.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-guard-'));
  execSync('git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

/** The set settings every enforcement test here selects. */
const SET_SETTINGS = {
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

test('the SELECTED set is the run policy: guardrailsId resolves into claudeOpts on every node + audits run.json', async () => {
  const prevMode = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'detached'; // needed for the run.json half; the claudeOpts threading is mode-independent
  try {
    const dir = gitDir(); // NOTE: no per-project guardrails exist in this model — only the selection matters
    const set = await writeGuardrailSet({ name: 'Run Policy', settings: { ...SET_SETTINGS } });
    const orch = createOrchestrator({
      projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
      guardrailsId: set.id,
    });
    const seen = spyClaudeOpts(orch);
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    assert.ok(seen.length >= 3, `several nodes ran: ${seen.map((s) => s.key).join(',')}`);
    for (const { key, claudeOpts: c } of seen) {
      // protectedPaths expand to Read+Edit ONLY — the CLI never consults a
      // Write(path) deny rule and warns about it on every spawn.
      assert.ok(c.permissionRules?.deny?.includes('Read(.env*)'), `${key}: Read leg present`);
      assert.ok(c.permissionRules?.deny?.includes('Edit(.env*)'), `${key}: Edit leg present`);
      assert.ok(!c.permissionRules?.deny?.includes('Write(.env*)'), `${key}: no Write leg`);
      assert.equal(c.envScrub, true, `${key}: envScrub threaded`);
      assert.deepEqual(c.envAllowlist, ['NPM_TOKEN'],
        `${key}: the SET's allowlist IS the run allowlist (it is the policy — nothing to relax against)`);
    }
    // The honor map is UNIFORM from the run set (single member here -> [true]).
    assert.deepEqual([...orch.guardrailHonorByKey.values()], [true]);
    // Audit: the resolved policy + the SELECTION rode run.json into the pipeline
    // dir (copyRunManifestTo at teardown) — id, not a content snapshot.
    const manifest = JSON.parse(await readFile(join(orch.getState().pipelineDir, 'run.json'), 'utf8'));
    assert.deepEqual(manifest.guardrails,
      { envScrub: true, denyCount: 2, protectedCount: 1, guardrailsId: set.id });
  } finally {
    if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prevMode;
  }
});

test('honorByKey is UNIFORM from the run set: honorProjectSettings=false gates every member', async () => {
  const dir = gitDir();
  const set = await writeGuardrailSet({ name: 'No Lift', settings: { ...SET_SETTINGS, honorProjectSettings: false } });
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: set.id,
  });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual([...orch.guardrailHonorByKey.values()], [false],
    'every member maps to the set value — there is no per-member saved preference');
});

test('OMITTED guardrailsId and explicit "permissive" both spawn with NO guardrail fields (legacy parity)', async () => {
  for (const extra of [{}, { guardrailsId: 'permissive' }]) {
    const dir = gitDir();
    const orch = createOrchestrator({
      projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
      ...extra,
    });
    const seen = spyClaudeOpts(orch);
    assert.equal((await orch.run()).status, 'done');
    assert.ok(seen.length >= 3, 'several nodes ran');
    for (const { key, claudeOpts: c } of seen) {
      assert.equal(c.permissionRules, undefined, `${key}: no rules (${JSON.stringify(extra)})`);
      assert.equal(c.envScrub, undefined, `${key}: no scrub`);
      assert.equal(c.envAllowlist, undefined, `${key}: no allowlist`);
    }
  }
});

test('built-in ids resolve from the code table: guardrailsId "secure" enforces the Strict preset', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: 'secure',
  });
  const seen = spyClaudeOpts(orch);
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.length >= 3, 'several nodes ran');
  for (const { key, claudeOpts: c } of seen) {
    assert.ok(c.permissionRules?.deny?.includes('Bash(curl:*)'), `${key}: Strict deny applied`);
    assert.ok(c.permissionRules?.deny?.includes('Read(.env*)'), `${key}: Strict protected path applied`);
    assert.equal(c.envScrub, true, `${key}: Strict scrubs`);
  }
});

test('a LEGACY per-project guardrails blob in project_config is INERT: the run enforces only the selection', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = gitDir();
  // Seed the old per-project blob directly (Secure level in the removed model).
  // The per-run model never reads it — a default run stays Permissive.
  getDb().prepare(`
    INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra)
    VALUES (?, '{}', '[]', NULL, ?)
    ON CONFLICT(project_key) DO UPDATE SET extra = excluded.extra
  `).run(projectKey(dir), JSON.stringify({ guardrails: { level: 'secure' } }));
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const seen = spyClaudeOpts(orch);
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.length >= 3, 'several nodes ran');
  for (const { key, claudeOpts: c } of seen) {
    assert.equal(c.permissionRules, undefined, `${key}: legacy project blob ignored — the default run is Permissive`);
    assert.equal(c.envScrub, undefined, `${key}: no scrub from the legacy blob`);
  }
});

test('unknown guardrailsId at run time fails OPEN to Permissive with a loud warn (never an abort)', async () => {
  const dir = gitDir();
  // Programmatic callers can bypass the route's 400 — the orchestrator must
  // warn + proceed unguarded, not crash the run (house fail-open family).
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: 'gr_ghost',
  });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const seen = spyClaudeOpts(orch);
  assert.equal((await orch.run()).status, 'done', 'fail-open: the run still completes');
  assert.ok(
    logs.some((l) => l.source === 'guardrails' && l.level === 'warn' && l.text.includes('gr_ghost')),
    `dangling id named in the run log: ${JSON.stringify(logs.filter((l) => l.source === 'guardrails'))}`,
  );
  for (const { key, claudeOpts: c } of seen) {
    assert.equal(c.permissionRules, undefined, `${key}: ran with the empty policy (documented fail-open)`);
  }
});
