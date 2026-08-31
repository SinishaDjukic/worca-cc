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
import { ENGINES } from './helpers/engines.mjs';
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

/** Capture every dispatched execution's claudeOpts — the spyNodeCtxs seam
 *  (test/orchestrator-workspace.test.mjs:486-495), widened to the fields under
 *  test. The per-engine ctx builder is the engine's own (v1 _nodeCtx, graph
 *  _execCtx), so the body lives in test/helpers/engines.mjs. */
function spyClaudeOpts(orch, engine) {
  const seen = [];
  engine.spyCtx(orch, seen);
  return seen;
}

for (const engine of ENGINES) {
test(`[${engine.id}] runOpts maps claudeOpts guardrail fields into runClaude options`, async () => {
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

test(`[${engine.id}] runOpts with no guardrails in claudeOpts leaves the options absent (legacy parity)`, async () => {
  const { _runOptsForTests } = await import('../src/core/phases.mjs');
  const o = _runOptsForTests({ projectDir: tmpdir(), claudeOpts: {} },
    { role: 'planner', prompt: 'p', systemPrompt: '', allowedTools: ['Read'] });
  assert.equal(o.permissionRules, undefined);
  assert.equal(o.envScrub, undefined);
  assert.equal(o.envAllowlist, undefined);
});

test(`[${engine.id}] the SELECTED set is the run policy: guardrailsId resolves into claudeOpts on every node + audits run.json`, async () => {
  const prevMode = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = 'detached'; // needed for the run.json half; the claudeOpts threading is mode-independent
  try {
    const dir = gitDir(); // NOTE: no per-project guardrails exist in this model — only the selection matters
    const set = await writeGuardrailSet({ name: 'Run Policy', settings: { ...SET_SETTINGS } });
    const orch = engine.create({
      projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
      guardrailsId: set.id,
    });
    const seen = spyClaudeOpts(orch, engine);
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

test(`[${engine.id}] honorByKey is UNIFORM from the run set: honorProjectSettings=false gates every member`, async () => {
  const dir = gitDir();
  const set = await writeGuardrailSet({ name: 'No Lift', settings: { ...SET_SETTINGS, honorProjectSettings: false } });
  const orch = engine.create({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: set.id,
  });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual([...orch.guardrailHonorByKey.values()], [false],
    'every member maps to the set value — there is no per-member saved preference');
});

test(`[${engine.id}] OMITTED guardrailsId and explicit "permissive" both spawn with NO guardrail fields (legacy parity)`, async () => {
  for (const extra of [{}, { guardrailsId: 'permissive' }]) {
    const dir = gitDir();
    const orch = engine.create({
      projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
      ...extra,
    });
    const seen = spyClaudeOpts(orch, engine);
    assert.equal((await orch.run()).status, 'done');
    assert.ok(seen.length >= 3, 'several nodes ran');
    for (const { key, claudeOpts: c } of seen) {
      assert.equal(c.permissionRules, undefined, `${key}: no rules (${JSON.stringify(extra)})`);
      assert.equal(c.envScrub, undefined, `${key}: no scrub`);
      assert.equal(c.envAllowlist, undefined, `${key}: no allowlist`);
    }
  }
});

test(`[${engine.id}] built-in ids resolve from the code table: guardrailsId "secure" enforces the Strict preset`, async () => {
  const dir = gitDir();
  const orch = engine.create({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: 'secure',
  });
  const seen = spyClaudeOpts(orch, engine);
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.length >= 3, 'several nodes ran');
  for (const { key, claudeOpts: c } of seen) {
    assert.ok(c.permissionRules?.deny?.includes('Bash(curl:*)'), `${key}: Strict deny applied`);
    assert.ok(c.permissionRules?.deny?.includes('Read(.env*)'), `${key}: Strict protected path applied`);
    assert.equal(c.envScrub, true, `${key}: Strict scrubs`);
  }
});

test(`[${engine.id}] a LEGACY per-project guardrails blob in project_config is INERT: the run enforces only the selection`, async () => {
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
  const orch = engine.create({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  const seen = spyClaudeOpts(orch, engine);
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.length >= 3, 'several nodes ran');
  for (const { key, claudeOpts: c } of seen) {
    assert.equal(c.permissionRules, undefined, `${key}: legacy project blob ignored — the default run is Permissive`);
    assert.equal(c.envScrub, undefined, `${key}: no scrub from the legacy blob`);
  }
});

test(`[${engine.id}] unknown guardrailsId at run time fails OPEN to Permissive with a loud warn (never an abort)`, async () => {
  const dir = gitDir();
  // Programmatic callers can bypass the route's 400 — the orchestrator must
  // warn + proceed unguarded, not crash the run (house fail-open family).
  const orch = engine.create({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: 'gr_ghost',
  });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const seen = spyClaudeOpts(orch, engine);
  assert.equal((await orch.run()).status, 'done', 'fail-open: the run still completes');
  assert.ok(
    logs.some((l) => l.source === 'guardrails' && l.level === 'warn' && l.text.includes('gr_ghost')),
    `dangling id named in the run log: ${JSON.stringify(logs.filter((l) => l.source === 'guardrails'))}`,
  );
  for (const { key, claudeOpts: c } of seen) {
    assert.equal(c.permissionRules, undefined, `${key}: ran with the empty policy (documented fail-open)`);
  }
});

test(`[${engine.id}] RESUME re-reads the selected set BY ID (latest definition), rehydrated from resume_point`, async () => {
  const dir = gitDir();
  const set = await writeGuardrailSet({
    name: 'Overlay',
    settings: { honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'], protectedPaths: [], deny: [] },
  });

  // Pause -> fresh-instance -> resume() bootstrap (from test/orchestrator-resume.test.mjs);
  // the runners seam doubles as the spy since runners receive the full _nodeCtx.
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
  const orch1 = engine.create({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners(run1),
    guardrailsId: set.id,
  });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  assert.equal(run1[0]?.claudeOpts.envScrub, true, 'pre-pause segment enforced the selection');

  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.row.status, 'paused');
  assert.equal(saved.row.guardrails_id, set.id, 'selection persisted in the pipelines column');
  assert.equal(JSON.parse(saved.row.resume_point).guardrailsId, set.id, 'and in the resume point');

  // Edit the set while paused — resume must enforce the LATEST definition (re-resolve by id).
  await writeGuardrailSet({ id: set.id, name: 'Overlay', settings: { ...set.settings, deny: ['Bash(nc:*)'] } });

  const run2 = [];
  const orch2 = engine.create({
    projectDir: dir, auto: true, claude: { mock: true }, runners: mkRunners(run2), resume: saved,
  });
  orchRef = orch2;
  assert.equal((await orch2.resume()).status, 'done');
  assert.ok(run2.length >= 1, 'nodes ran after resume');
  const first = run2[0].claudeOpts;
  assert.equal(first.envScrub, true, 'FRESH instance re-resolved the selection from resume_point');
  assert.ok(first.permissionRules?.deny?.includes('Bash(nc:*)'), 'post-pause nodes carry the EDITED set');
});

test(`[${engine.id}] a set deleted while paused: RESUME warns and proceeds Permissive (fail-open, loud)`, async () => {
  const { prepare, tx } = await import('../src/core/db.mjs');
  const dir = gitDir();
  const set = await writeGuardrailSet({ name: 'Doomed', settings: { ...SET_SETTINGS } });

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
  const orch1 = engine.create({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners(run1),
    guardrailsId: set.id,
  });
  orchRef = orch1;
  assert.equal((await orch1.run()).status, 'paused');
  const saved = readPipelineForResume(orch1.state.id);

  // Out-of-band row delete: deleteGuardrailSet would 409 on the resume-point pin,
  // so this simulates DB surgery / a divergent-checkout store.
  tx(() => { prepare('DELETE FROM guardrail_sets WHERE id = ?').run(set.id); });

  const run2 = [];
  const orch2 = engine.create({
    projectDir: dir, auto: true, claude: { mock: true }, runners: mkRunners(run2), resume: saved,
  });
  orchRef = orch2;
  const logs = [];
  orch2.on('log', (l) => logs.push(l));
  assert.equal((await orch2.resume()).status, 'done', 'fail-open: resume still completes');
  assert.ok(
    logs.some((l) => l.source === 'guardrails' && l.level === 'warn' && l.text.includes(set.id)),
    `deleted set named in the run log: ${JSON.stringify(logs.filter((l) => l.source === 'guardrails'))}`,
  );
  assert.ok(run2.length >= 1, 'nodes ran after resume');
  for (const { claudeOpts: c } of run2) {
    assert.equal(c.permissionRules, undefined, 'post-resume nodes run with the empty policy (documented fail-open)');
    assert.equal(c.envScrub, undefined, 'no scrub');
  }
});

test(`[${engine.id}] guardrailsId surfaces on every persistence read: column, History list entry, detail state; default runs record "permissive"`, async () => {
  const { listAllPipelines, readPipelineByKey } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = gitDir();
  const set = await writeGuardrailSet({
    name: 'Persist Me',
    settings: { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: [], deny: ['Bash(wget:*)'] },
  });
  const orch = engine.create({
    projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, branch: { source: 'main' },
    guardrailsId: set.id,
  });
  assert.equal((await orch.run()).status, 'done');
  const saved = readPipelineForResume(orch.state.id);
  assert.equal(saved.row.guardrails_id, set.id, 'column written at creation (INSERT-only) and never nulled by later persists');
  const entry = (await listAllPipelines()).find((e) => e.id === orch.state.id);
  assert.equal(entry.guardrailsId, set.id, 'History list entry exposes it');
  const detail = await readPipelineByKey(projectKey(dir), orch.state.id);
  assert.equal(detail.state.guardrailsId, set.id, 'detail state (rowToState) exposes it');

  // A run with NO selection records the concrete default — an honest
  // "this run ran unguarded (Permissive)" record, not NULL.
  const orch2 = engine.create({
    projectDir: dir, prompt: 'y', auto: true, claude: { mock: true }, branch: { source: 'main' },
  });
  assert.equal((await orch2.run()).status, 'done');
  assert.equal(readPipelineForResume(orch2.state.id).row.guardrails_id, 'permissive');
});
}
