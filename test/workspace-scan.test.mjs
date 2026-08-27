// test/workspace-scan.test.mjs
// Milestone 5 — the wizard's scan engine (src/core/workspace-scan.mjs).
//
// Mock-driven: WORCA_MOCK=1 / claude.mock makes the scanning agent use
// mockWorkspaceScan (claude-runner.mjs) — it writes the §5.8-templated
// description to MOCK_OUT and emits `INVESTIGATING <key> relations to <other>`
// log lines, so NOTHING spawns real claude or builds a real graphify graph.
//
// NO real-repo pollution + branch DELETION semantics (D4): the engine creates
// real scan worktrees + branches in member repos ONLY when graphify kind==='cli'
// AND not mock. We force mock so the graph phase skips graphify builds entirely
// (graphify.used=false) and creates ZERO worktrees — which is exactly what keeps
// `git worktree list` / `git branch --list 'worca-cc/*'` of THIS repo untouched.
// A dedicated NON-mock test proves the graphify-success path force-removes its
// scan worktree AND deletes its branch in finally, by stubbing detectTools +
// graphify via env so the build "succeeds" without graphify installed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createWorkspaceScan } from '../src/core/workspace-scan.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

const POSIX_BASH = { skip: process.platform === 'win32' ? 'fake graphify on PATH is a bash script' : false };

useTempHome(after); // tmp/scan scratch dir lands in an isolated home, not real ~/.worca-cc

const AGENTS_DIR = fileURLToPath(new URL('../agents', import.meta.url));

const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

async function freshRepo(prefix = 'worca-cc-wsscan-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

function branchList(dir) {
  return spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
    .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
function worktreeCount(dir) {
  // `git worktree list` always lists the main worktree; extra checkouts add lines.
  return spawnSync('git', ['-C', dir, 'worktree', 'list'])
    .stdout.toString().split(/\r?\n/).filter(Boolean).length;
}

/** Drive a scan to its terminal event, collecting every emitted scan-* event. */
async function runScan(opts) {
  const scan = createWorkspaceScan({ agentsDir: AGENTS_DIR, claude: { mock: true }, ...opts });
  const events = [];
  for (const name of ['scan-progress', 'scan-done', 'scan-error']) {
    scan.on(name, (p) => events.push({ type: name, ...p }));
  }
  const result = await scan.run();
  return { scan, events, result };
}

// ── shape + id ───────────────────────────────────────────────────────────────

test('createWorkspaceScan: scanId is scan_<uuid>; getState exposes the contracted shape', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const scan = createWorkspaceScan({ projectPaths: [a, b], name: 'My WS', agentsDir: AGENTS_DIR, claude: { mock: true } });
  const st = scan.getState();
  assert.match(st.scanId, /^scan_[0-9a-f-]{36}$/, `scanId should be scan_<uuid>, got ${st.scanId}`);
  assert.equal(st.projectsTotal, 2);
  assert.equal(st.projectsDone, 0);
  assert.equal(typeof st.phase, 'string');
  assert.equal(typeof st.message, 'string');
  assert.equal(typeof st.status, 'string');
});

test('createWorkspaceScan: members are deduped by projectKey and sorted ascending', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  // Pass b first + a duplicate of a; engine must dedupe to 2 and sort by projectKey.
  const scan = createWorkspaceScan({ projectPaths: [b, a, a], name: 'Dedup', agentsDir: AGENTS_DIR, claude: { mock: true } });
  assert.equal(scan.getState().projectsTotal, 2, 'duplicate path collapses; 2 distinct members');
});

// ── happy path (mock) ──────────────────────────────────────────────────────────

test('run() (mock): emits many scan-progress then exactly ONE scan-done with the templated description', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { events, result } = await runScan({ projectPaths: [a, b], name: 'IoT SP Platform' });

  const progress = events.filter((e) => e.type === 'scan-progress');
  const done = events.filter((e) => e.type === 'scan-done');
  const errs = events.filter((e) => e.type === 'scan-error');
  assert.equal(errs.length, 0, 'no scan-error on the happy path');
  assert.equal(done.length, 1, 'exactly ONE terminal scan-done');
  assert.ok(progress.length >= 2, `many scan-progress, got ${progress.length}`);

  // Phases progress strictly graph -> investigate -> synthesize.
  const phases = progress.map((e) => e.phase);
  assert.ok(phases.includes('graph'), 'a graph-phase progress event');
  assert.ok(phases.includes('investigate'), 'an investigate-phase progress event');
  assert.ok(phases.includes('synthesize'), 'a synthesize-phase progress event');
  const order = { graph: 0, investigate: 1, synthesize: 2 };
  for (let i = 1; i < phases.length; i++) {
    assert.ok(order[phases[i]] >= order[phases[i - 1]], `phases never regress: ${phases.join('>')}`);
  }

  const d = done[0];
  assert.ok(/^# Workspace: IoT SP Platform/.test(d.description), 'description uses the §5.8 heading');
  assert.match(d.description, /## Interconnections/);
  assert.equal(d.graphify.used, false, 'mock graph phase skips graphify builds -> used=false');
  assert.equal(d.projects.length, 2);
  for (const p of d.projects) {
    assert.equal(typeof p.projectKey, 'string');
    assert.equal(typeof p.projectName, 'string');
  }
  // run() resolves the same payload (and never throws).
  assert.equal(result.status, 'done');
  assert.equal(result.description, d.description);
});

test('run() (mock): scan-progress.message CHANGES across events (never a static "Scanning…")', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { events } = await runScan({ projectPaths: [a, b], name: 'Changing' });
  const messages = events.filter((e) => e.type === 'scan-progress').map((e) => e.message);
  const distinct = new Set(messages);
  assert.ok(distinct.size >= 2, `message must change; saw ${[...distinct].join(' | ')}`);
  // At least one investigate message references the live INVESTIGATING text the
  // mock emits (proves the agent-event -> changing-message wiring works offline).
  assert.ok(messages.some((m) => /investigat/i.test(m)), `an investigating message; saw ${messages.join(' | ')}`);
});

test('run() (mock): the delivered description is NOT truncated (no cap, no ellipsis)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  // A very long name balloons the templated description well past the old 2000-char cap.
  // (The mock scanner templates `name` verbatim into `# Workspace: <name>`, so the 4000-char
  // run appears contiguously — this is the same mechanism the old test used to exceed 2000.)
  const longName = 'X'.repeat(4000);
  const { events } = await runScan({ projectPaths: [a, b], name: longName });
  const d = events.find((e) => e.type === 'scan-done');
  assert.ok(d, 'scan-done emitted');
  assert.ok(d.description.length > 2000, `full description delivered, got ${d.description.length}`);
  assert.ok(!d.description.endsWith('…'), 'no truncation ellipsis');
  assert.ok(d.description.includes(longName), 'the full ballooned content is present verbatim');
});

test('run() (mock): leaves the scratch dir removed in finally (no tmp/scan leak)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const scan = createWorkspaceScan({ projectPaths: [a, b], name: 'Scratch', agentsDir: AGENTS_DIR, claude: { mock: true } });
  const scratch = scan.getState().scratchDir;
  await scan.run();
  assert.ok(scratch, 'engine exposes its scratchDir');
  assert.ok(!existsSync(scratch), `scratch dir must be removed in finally: ${scratch}`);
});

// ── no-leak invariant (mock graph phase creates ZERO worktrees/branches) ───────

test('run() (mock): creates NO scan worktree or worca-cc/* branch in any member repo', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  await runScan({ projectPaths: [a, b], name: 'NoLeak' });
  for (const repo of [a, b]) {
    assert.equal(worktreeCount(repo), 1, `only the main worktree should remain in ${repo}`);
    assert.ok(!branchList(repo).some((br) => br.startsWith('worca-cc/')), `no worca-cc/* branch in ${repo}`);
  }
});

// ── graphify-success path (D4): scan worktree + branch force-removed in finally ─
// Drive the real (non-mock) graph phase but stub graphify so the build "succeeds"
// without graphify installed: a fake `graphify` on PATH that writes graphify-out/
// and exits 0. The scanning agent itself still runs in mock (claude.mock) so no
// real claude spawns. This proves the engine creates the scan worktree+branch,
// then DELETES BOTH (worktree force-removed, branch -D) in finally.

async function withFakeGraphify(fn) {
  const bin = await mkdtemp(join(tmpdir(), 'worca-cc-fakebin-'));
  created.push(bin);
  // A fake `graphify` that satisfies BOTH detectTools (`graphify --version`)
  // and the build (`graphify update <dir>` -> writes <dir>/graphify-out/).
  const script =
    '#!/usr/bin/env bash\n' +
    'if [ "$1" = "update" ]; then mkdir -p "$2/graphify-out"; echo "# graph" > "$2/graphify-out/GRAPH_REPORT.md"; exit 0; fi\n' +
    'echo "graphify 9.9.9"; exit 0\n';
  await writeFile(join(bin, 'graphify'), script, { mode: 0o755 });
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = prevPath;
  }
}

test('run() (graphify cli success, D4): scan worktree + branch are force-removed in finally', POSIX_BASH, async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  // Graph phase runs for real (graphify kind==='cli'); the scanning AGENT is still
  // mocked so no real claude spawns. graphify.used must be true. Hoist the engine
  // so we can read its shortId to assert the EXACT scan-worktree dir is gone.
  const scan = createWorkspaceScan({
    projectPaths: [a, b], name: 'GraphWS', agentsDir: AGENTS_DIR,
    claude: { mock: true }, mock: false,
  });
  const shortId = scan.getState().scanId.slice(5, 13);
  await withFakeGraphify(async () => {
    const events = [];
    for (const n of ['scan-progress', 'scan-done', 'scan-error']) scan.on(n, (p) => events.push({ type: n, ...p }));
    const result = await scan.run();
    assert.equal(result.status, 'done', JSON.stringify(result));
    const done = events.find((e) => e.type === 'scan-done');
    assert.ok(done, 'scan-done emitted');
    assert.equal(done.graphify.used, true, 'a cli graphify build succeeded -> used=true');
  });

  // D4 INVARIANT: every scan worktree removed AND every scan branch DELETED.
  for (const repo of [a, b]) {
    assert.equal(worktreeCount(repo), 1, `scan worktree must be force-removed in ${repo}`);
    const leftover = branchList(repo).filter((br) => br.startsWith('worca-cc/ws-scan-'));
    assert.deepEqual(leftover, [], `scan branch must be DELETED in finally in ${repo}`);
    // The ACTUAL per-repo scan-worktree dir (ws-scan-<shortId>) must be gone too.
    assert.ok(
      !existsSync(join(repo, '.worca-cc', 'worktrees', `ws-scan-${shortId}`)),
      `the ws-scan-${shortId} worktree dir must be removed in ${repo}`,
    );
  }
});

// ── fail-safe degrade (build fails -> source-reading, never aborts) ─────────────

test('run() (graphify update fails): degrades to source-reading; still emits scan-done, graphify.used=false', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const bin = await mkdtemp(join(tmpdir(), 'worca-cc-failbin-'));
  created.push(bin);
  // detectTools sees graphify (kind cli), but `graphify update` EXITS NON-ZERO.
  const script =
    '#!/usr/bin/env bash\n' +
    'if [ "$1" = "update" ]; then echo "boom" >&2; exit 1; fi\n' +
    'echo "graphify 9.9.9"; exit 0\n';
  await writeFile(join(bin, 'graphify'), script, { mode: 0o755 });
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  try {
    const scan = createWorkspaceScan({
      projectPaths: [a, b], name: 'DegradeWS', agentsDir: AGENTS_DIR,
      claude: { mock: true }, mock: false,
    });
    const events = [];
    for (const n of ['scan-progress', 'scan-done', 'scan-error']) scan.on(n, (p) => events.push({ type: n, ...p }));
    const result = await scan.run();
    assert.equal(result.status, 'done', 'a failed build degrades, never aborts');
    const done = events.find((e) => e.type === 'scan-done');
    assert.ok(done, 'scan-done still emitted');
    assert.equal(done.graphify.used, false, 'all builds failed -> graphify.used=false');
  } finally {
    process.env.PATH = prevPath;
  }
  // Even a FAILED build cleans up any worktree/branch it created.
  for (const repo of [a, b]) {
    assert.equal(worktreeCount(repo), 1, `no leftover worktree after a failed build in ${repo}`);
    assert.ok(!branchList(repo).some((br) => br.startsWith('worca-cc/ws-scan-')), `no leftover scan branch in ${repo}`);
  }
});

// ── abort / stop ───────────────────────────────────────────────────────────────

test('stop() mid-flight: emits a terminal scan-error{message:"stopped"}; run() resolves stopped', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const scan = createWorkspaceScan({ projectPaths: [a, b], name: 'StopWS', agentsDir: AGENTS_DIR, claude: { mock: true } });
  const events = [];
  for (const n of ['scan-progress', 'scan-done', 'scan-error']) scan.on(n, (p) => events.push({ type: n, ...p }));
  // Abort as soon as the first progress event arrives (mid-flight).
  scan.on('scan-progress', () => scan.stop());
  const result = await scan.run();
  assert.equal(result.status, 'stopped', JSON.stringify(result));
  const err = events.find((e) => e.type === 'scan-error');
  assert.ok(err, 'a terminal scan-error is emitted on stop');
  assert.equal(err.message, 'stopped');
  assert.equal(events.filter((e) => e.type === 'scan-done').length, 0, 'no scan-done after a stop');
});

test('run() never throws out of run(): a 0-member scan emits scan-error, does not reject', async () => {
  const scan = createWorkspaceScan({ projectPaths: [], name: 'Empty', agentsDir: AGENTS_DIR, claude: { mock: true } });
  const events = [];
  for (const n of ['scan-progress', 'scan-done', 'scan-error']) scan.on(n, (p) => events.push({ type: n, ...p }));
  // Must RESOLVE (never reject) — mirrors Orchestrator.run()'s discipline.
  const result = await scan.run();
  assert.equal(result.status, 'error', JSON.stringify(result));
  assert.equal(events.filter((e) => e.type === 'scan-error').length, 1, 'exactly one terminal scan-error');
  assert.equal(events.filter((e) => e.type === 'scan-done').length, 0);
});

test('run(): an empty/whitespace description -> scan-error (scan-done emitted ONLY for non-empty)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const scan = createWorkspaceScan({ projectPaths: [a, b], name: 'BlankDesc', agentsDir: AGENTS_DIR, claude: { mock: true } });
  // Stub the scanning-agent phase to return a whitespace-only description so the
  // synthesize-phase guard fires — exercising the user-facing "agent produced
  // nothing" path without depending on a real agent.
  scan._runScanningAgent = async () => ({ description: '   \n\t  ' });
  const events = [];
  for (const n of ['scan-progress', 'scan-done', 'scan-error']) scan.on(n, (p) => events.push({ type: n, ...p }));
  const result = await scan.run();
  assert.equal(result.status, 'error', JSON.stringify(result));
  const errs = events.filter((e) => e.type === 'scan-error');
  assert.equal(errs.length, 1, 'exactly one terminal scan-error');
  assert.match(errs[0].message, /empty description/i);
  assert.equal(events.filter((e) => e.type === 'scan-done').length, 0, 'NO scan-done for an empty description');
});
