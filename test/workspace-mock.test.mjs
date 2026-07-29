// test/workspace-mock.test.mjs
// M4 §6.7: the two new MOCK_ROLE arms in claude-runner's runMock.
//  - workspace-scan: writes a deterministic §5.8-template description to MOCK_OUT and
//    emits one `INVESTIGATING <key> relations to <other>` log line per project.
//  - workspace-reviewer: mirrors mockReviewer — blocking count DECREASES with cycle so
//    the review->implementer loop terminates; writes ONE merged review md + json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { runImplementer, workspaceWriteTargetsFor } from '../src/core/phases.mjs';
import { hasBlocking } from '../src/core/protocol.mjs';

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-ws-mock-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

function collect() {
  const events = [];
  return { events, onEvent: (e) => events.push(e) };
}

test('workspace-scan mock writes a template description + one INVESTIGATING line per project', async () => {
  const dir = await makeTmpDir();
  const out = join(dir, 'workspace-description.md');
  const { events, onEvent } = collect();
  const prompt = [
    '## Member projects to investigate',
    '- **iam** (`iam-1a2b3c4d`): investigate /wt/iam',
    '- **ui** (`ui-5e6f7a8b`): investigate /wt/ui',
    'MOCK_ROLE: workspace-scan',
    `MOCK_OUT: ${out}`,
    'MOCK_BASE: Demo WS',
  ].join('\n');
  const { text } = await runClaude({ cwd: dir, prompt, mock: true, onEvent });
  assert.match(text, /workspace description written/);

  const md = await readFile(out, 'utf8');
  assert.match(md, /# Workspace: Demo WS/);
  assert.match(md, /## Overview/);
  assert.match(md, /## Projects/);
  assert.match(md, /## Interconnections/);
  assert.match(md, /## Change-coordination notes/);
  assert.match(md, /## Suggested change order/);

  const investigating = events.filter((e) => /^INVESTIGATING /.test(e.text || ''));
  assert.equal(investigating.length, 2, 'one INVESTIGATING line per project');
  assert.ok(investigating.some((e) => /iam-1a2b3c4d/.test(e.text)));
  assert.ok(investigating.some((e) => /ui-5e6f7a8b/.test(e.text)));
  assert.ok(events.some((e) => /^SYNTHESIZING /.test(e.text || '')), 'emits a synthesize line');
});

test('workspace-scan mock degrades gracefully with no member lines', async () => {
  const dir = await makeTmpDir();
  const out = join(dir, 'desc.md');
  const { onEvent } = collect();
  const prompt = `MOCK_ROLE: workspace-scan\nMOCK_OUT: ${out}\nMOCK_BASE: Empty`;
  await runClaude({ cwd: dir, prompt, mock: true, onEvent });
  const md = await readFile(out, 'utf8');
  assert.match(md, /# Workspace: Empty/, 'still writes a valid description');
});

test('workspace-reviewer mock: blocking count decreases with cycle (loop terminates)', async () => {
  const dir = await makeTmpDir();
  const md1 = join(dir, 'ws1.md'); const j1 = join(dir, 'ws1.json');
  const md2 = join(dir, 'ws2.md'); const j2 = join(dir, 'ws2.json');

  await runClaude({
    cwd: dir, mock: true, onEvent: () => {},
    prompt: `MOCK_ROLE: workspace-reviewer\nMOCK_OUT: ${md1}\nMOCK_JSON: ${j1}\nMOCK_CYCLE: 1`,
  });
  await runClaude({
    cwd: dir, mock: true, onEvent: () => {},
    prompt: `MOCK_ROLE: workspace-reviewer\nMOCK_OUT: ${md2}\nMOCK_JSON: ${j2}\nMOCK_CYCLE: 2`,
  });

  const c1 = JSON.parse(await readFile(j1, 'utf8'));
  const c2 = JSON.parse(await readFile(j2, 'utf8'));
  assert.ok(hasBlocking(c1), 'cycle 1 blocks');
  assert.ok(!hasBlocking(c2), 'cycle 2 does not block -> loop terminates');
  const blocking1 = c1.issues.filter((i) => i.severity === 'critical' || i.severity === 'major').length;
  const blocking2 = c2.issues.filter((i) => i.severity === 'critical' || i.severity === 'major').length;
  assert.ok(blocking2 < blocking1, 'blocking count strictly decreases');

  // ONE merged review md, union of issues, projectKey-prefixed locations.
  const md = await readFile(md1, 'utf8');
  assert.match(md, /Workspace Implementation Review/);
  assert.match(md, /union/i);
  for (const i of c1.issues) {
    assert.match(i.location, /^[a-z0-9-]+:/i, `projectKey-prefixed location (${i.location})`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4 (§8.10) — mock write targets: runOpts -> runClaude -> runMock -> mockImplementer
// ═══════════════════════════════════════════════════════════════════════════════
// `ctx.workspace` is NOT threaded into the mock; the ONLY channel is the new
// `workspaceWriteTargets` option (absolute paths, straight off the bus channel). The
// `ctx.runRoot` gate is load-bearing: without it a LEGACY workspace mock run would
// start writing into every member worktree instead of only its cwd (the primary's
// worktree) — a behavior change on the path §10 promises is byte-identical.

const RUN_ROOT = '/mh/runs/pipe-1';
/** A workspace bus-channel value with two members whose worktrees are real temp dirs. */
async function twoMemberWorkspace() {
  const runRoot = await makeTmpDir();
  const wtA = join(runRoot, 'repos', 'a-1111');
  const wtB = join(runRoot, 'repos', 'b-2222');
  await mkdir(wtA, { recursive: true });
  await mkdir(wtB, { recursive: true });
  return {
    runRoot,
    wtA,
    wtB,
    workspace: {
      kind: 'metadata',
      workspaceDescription: '# Workspace: Mock\n',
      projects: [
        { projectKey: 'a-1111', projectName: 'a', worktreeDir: wtA, checkpointRef: 'sha-a' },
        { projectKey: 'b-2222', projectName: 'b', worktreeDir: wtB, checkpointRef: 'sha-b' },
      ],
    },
  };
}
const wroteFeature = (dir) => existsSync(join(dir, 'src', 'feature.mjs')) && existsSync(join(dir, 'test', 'feature.test.mjs'));

// ── the pure runOpts mapping (the ctx.runRoot gate) ──────────────────────────
test('workspaceWriteTargetsFor: populated ONLY when ctx.runRoot is set', () => {
  const ws = {
    projects: [
      { projectKey: 'a', worktreeDir: '/rr/repos/a' },
      { projectKey: 'b', worktreeDir: '/rr/repos/b' },
      { projectKey: 'c' },                                   // no worktree yet -> filtered
    ],
  };
  assert.deepEqual(workspaceWriteTargetsFor({ runRoot: RUN_ROOT, workspace: ws }),
    ['/rr/repos/a', '/rr/repos/b'], 'detached workspace: absolute member worktrees');
  assert.deepEqual(workspaceWriteTargetsFor({ runRoot: null, workspace: ws }), [],
    'LEGACY workspace: EMPTY (the mock keeps writing only to its cwd)');
  assert.deepEqual(workspaceWriteTargetsFor({ runRoot: RUN_ROOT }), [], 'detached single project');
  assert.deepEqual(workspaceWriteTargetsFor({}), []);
  assert.deepEqual(workspaceWriteTargetsFor(undefined), [], 'never throws');
});

// ── end to end through runOpts (runImplementer is the only mock write path) ──
test('detached workspace: the mock implementer writes into EVERY member repos/<key>, not the cwd', async () => {
  const { runRoot, wtA, wtB, workspace } = await twoMemberWorkspace();
  const pipelineDir = await makeTmpDir();
  const res = await runImplementer({
    projectDir: runRoot,               // cwd = the run root (orchestrator.runCwd)
    runRoot,                           // the detached gate
    workspace,
    pipelineDir,
    taskPrompt: 'add a feature',
    node: { key: 'implementer' },
    claudeOpts: { mock: true },
  }, { planPath: join(pipelineDir, 'plan.md'), mode: 'implement' });
  assert.match(res.summary, /\[mock\]/);
  assert.ok(wroteFeature(wtA), `member a got the mock edits: ${wtA}`);
  assert.ok(wroteFeature(wtB), `member b got the mock edits: ${wtB}`);
  assert.ok(!existsSync(join(runRoot, 'src')), 'nothing was written at the run root (no §8.11 stray)');
});

test('LEGACY workspace: the mock implementer writes ONLY to its cwd (no ctx.runRoot => no targets)', async () => {
  const { wtA, wtB, workspace } = await twoMemberWorkspace();
  const pipelineDir = await makeTmpDir();
  await runImplementer({
    projectDir: wtA,                   // legacy cwd = the PRIMARY member's worktree
    workspace,                         // …with the workspace channel present
    pipelineDir,
    taskPrompt: 'add a feature',
    node: { key: 'implementer' },
    claudeOpts: { mock: true },
  }, { planPath: join(pipelineDir, 'plan.md'), mode: 'implement' });
  assert.ok(wroteFeature(wtA), 'the cwd (primary worktree) got the edits, exactly as today');
  assert.ok(!existsSync(join(wtB, 'src')), 'the OTHER member stays untouched under legacy');
});

test('detached SINGLE project: no workspace => the mock falls back to the cwd', async () => {
  const cwd = await makeTmpDir();
  const pipelineDir = await makeTmpDir();
  await runImplementer({
    projectDir: cwd, runRoot: '/mh/runs/pipe-2', pipelineDir,
    taskPrompt: 'x', node: { key: 'implementer' }, claudeOpts: { mock: true },
  }, { planPath: join(pipelineDir, 'plan.md'), mode: 'implement' });
  assert.ok(wroteFeature(cwd), 'single mode is byte-identical: writes at cwd');
});
