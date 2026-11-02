// test/folder-run.test.mjs — a run on a Folder project works on a copy and never runs git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, lstatSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { addProject, getProjectByPath, worcaHome } from '../src/core/projects.mjs';
import { workModeForStart } from '../src/core/project-kind.mjs';
import { gitState, gitAvailable, _testing as gitTesting } from '../src/core/git-available.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readStoreMeta, readPipelineForResume, listRunArtifacts, readPipeline } from '../src/core/artifacts.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import { spawnSync } from 'node:child_process';                      // the CLI row (Task 10)
import { fileURLToPath } from 'node:url';
import { _testing as gitInfoT } from '../src/core/git-info.mjs';
import { _testing as gitSyncT } from '../src/core/git-sync.mjs';

useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const plainFolder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-folder-run-')); dirs.push(dir);
  writeFileSync(join(dir, 'notes.txt'), 'hello\n'); mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs', 'a.md'), '# A\n');
  return dir;
};
// The harness seam plus both module runners (A-m4, as P3 Task 4): with git installed these are where a folder run
// could still spawn git. The WORCA_GIT=0 row below stays the killer (P0's gates catch every other caller).
const spyGit = (o) => {
  const calls = []; const real = o._git.bind(o);
  o._git = (a, x) => { calls.push(a); return real(a, x); };
  gitInfoT.setRunner((cmd, args, x) => { if (cmd === 'git') calls.push(['git-info', ...args]); return gitInfoT.defaultRun(cmd, args, x); });
  gitSyncT.setRunner((args, x) => { calls.push(['git-sync', ...args]); return gitSyncT.defaultRun(args, x); });
  return calls;
};
after(() => { gitInfoT.reset(); gitSyncT.reset(); });
const withoutGit = async (fn) => {
  process.env.WORCA_GIT = '0';
  try { await gitState({ fresh: true }); return await fn(); } finally { process.env.WORCA_GIT = '1'; gitTesting.reset(); }
};
const branchOf = (id) => JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(id).branch);
async function folderRun(dir) {
  if (!getProjectByPath(dir)) await addProject({ name: basename(dir), path: dir });
  const workMode = workModeForStart({ projectDir: dir }, { getProjectByPath, gitAvailable });
  const orch = createOrchestrator({ projectDir: dir, prompt: 'Add a feature', auto: true, claude: { mock: true }, workMode });
  const gitCalls = spyGit(orch);
  return { orch, gitCalls, workMode, res: await orch.run() };
}

test('a mock run on a Folder project: done on a copy, zero git calls, changes listed, the folder untouched, the copy kept', async () => {
  const dir = plainFolder();
  const { orch, gitCalls, workMode, res } = await folderRun(dir);
  assert.equal(workMode, 'folder'); assert.equal(res.status, 'done'); assert.deepEqual(gitCalls, []);
  assert.equal(existsSync(join(dir, '.git')), false);
  assert.equal(existsSync(join(dir, 'src', 'feature.mjs')), false, 'only Apply writes the folder');
  assert.equal(orch.getState().projectDir, dir, 'the run\'s projectDir is the real folder (P1b S18)');
  const pdir = orch.pipeline.dir;
  const changes = JSON.parse(readFileSync(join(pdir, 'changes.json'), 'utf8'));
  assert.deepEqual([changes.version, changes.root, changes.state], [1, dir, 'pending']);
  assert.deepEqual(changes.files.map((f) => [f.path, f.change]), [['src/feature.mjs', 'added'], ['test/feature.test.mjs', 'added']]);
  assert.deepEqual(changes.counts, { added: 2, modified: 0, deleted: 0 });
  assert.deepEqual(changes.exclude, ['.claude/rules/worca'], 'the injected mounts ride changes.json for Apply\'s re-scan (Task 9)');
  assert.match(readFileSync(join(pdir, 'changes.patch'), 'utf8'), /^diff --git a\/src\/feature\.mjs b\/src\/feature\.mjs\nnew file mode 100644\n--- \/dev\/null\n\+\+\+ b\/src\/feature\.mjs\n@@ -0,0 \+1,\d+ @@/);
  const results = JSON.parse(readFileSync(join(pdir, 'results.json'), 'utf8'));
  assert.deepEqual([results.summary.filesNew, results.summary.filesChanged, results.summary.filesDeleted], [2, 0, 0]);
  assert.equal(existsSync(join(pdir, 'diff-patch.patch')), false);
  const kinds = getDb().prepare("SELECT kind FROM artifacts WHERE pipeline_id = ? AND kind IN ('changes','changes-patch','diff-patch') ORDER BY kind").all(orch.state.id).map((r) => r.kind);
  assert.deepEqual(kinds, ['changes', 'changes-patch']);
  const br = branchOf(orch.state.id);
  assert.deepEqual([br.workMode, br.runRootMode, br.changes.state, br.feature, br.worktreeDir, br.branchKept], ['folder', 'detached', 'pending', undefined, undefined, undefined]);
  assert.deepEqual(br.changes.counts, { added: 2, modified: 0, deleted: 0 });
  assert.equal(orch.getState().workMode, 'folder');
  assert.ok((await listRunArtifacts(orch.state.id, { kind: 'plan' })).length > 0, 'the plan is indexed: planPath and _artifact share the stored key (S52)');
  assert.ok(existsSync(join(br.copyDir, 'src', 'feature.mjs')), 'the copy waits for Apply');
  assert.equal(existsSync(join(br.copyDir, '.claude', 'rules', 'worca')), false, 'worca\'s mounts leave with teardown');
  const manifest = JSON.parse(readFileSync(join(worcaHome(), 'runs', orch.state.id, 'run.json'), 'utf8'));
  assert.equal(manifest.workMode, 'folder');
  assert.deepEqual(manifest.members.map((m) => [m.copyDir, m.workMode, 'worktreeDir' in m]), [[br.copyDir, 'folder', false]]);
  assert.equal(manifest.retain.reason, 'folder-apply');
  assert.deepEqual(manifest.retain.members.map((m) => [m.copyDir, m.reason]), [[br.copyDir, 'folder-apply']]);
});

test('WORCA_GIT=0: the same run completes, spawns no git, is never paused', async () => {
  await withoutGit(async () => {
    assert.equal(gitAvailable(), false);
    const dir = plainFolder();
    const { gitCalls, workMode, res } = await folderRun(dir);
    assert.deepEqual([workMode, res.status], ['folder', 'done']); assert.deepEqual(gitCalls, []);
    assert.equal(existsSync(join(dir, '.git')), false);
  });
});

test('U3: an orphan Git project runs as a Folder run while git is missing; its .git is neither copied nor touched', async () => {
  const dir = plainFolder(); mkdirSync(join(dir, '.git')); writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await addProject({ name: 'orphan', path: dir });
  assert.equal(getProjectByPath(dir).vcs, 'git');
  await withoutGit(async () => {
    const { orch, gitCalls, workMode, res } = await folderRun(dir);
    assert.deepEqual([workMode, res.status], ['folder', 'done']); assert.deepEqual(gitCalls, []);
    assert.equal(existsSync(join(orch.getState().branch.copyDir, '.git')), false);
    assert.equal(readFileSync(join(dir, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/main\n');
  });
});

test('a run that changed nothing releases its copy at settle (discarded, counts 0) — P1b S7', async () => {
  const dir = plainFolder();
  const orch = ENGINES[0].create({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder',
    runners: { producer: async () => ({ status: 'ok' }), verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }) } });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(branchOf(orch.state.id).changes, { state: 'discarded', counts: { added: 0, modified: 0, deleted: 0 } });
  const b0 = branchOf(orch.state.id);
  assert.deepEqual([b0.worktreeRemoved, b0.branchKept], [undefined, undefined], 'the git teardown mirror never stamps a folder record');
  assert.equal(JSON.parse(readFileSync(join(orch.pipeline.dir, 'changes.json'), 'utf8')).state, 'discarded');
  assert.equal(existsSync(join(worcaHome(), 'runs', orch.state.id)), false);
});

// Hosted isolation: the pipeline dir is agent-writable, and later agents (the reviewer) read changes.patch.
test('a folder-manifest.json the agent forges mid-run never puts a file from outside the folder into changes.patch or changes.json', async () => {
  const canary = mkdtempSync(join(tmpdir(), 'worca-folder-canary-')); dirs.push(canary);
  writeFileSync(join(canary, 'canary.txt'), 'CANARY-TEXT\n');
  const forgeries = {
    root: (mf) => { mf.root = canary; mf.files['canary.txt'] = { ...mf.files['notes.txt'] }; },
    climb: (mf) => { mf.files[`../${basename(canary)}/canary.txt`] = { ...mf.files['notes.txt'] }; },
  };
  for (const [name, forge] of Object.entries(forgeries)) {
    const dir = plainFolder();
    let orch;
    orch = ENGINES[0].create({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder',
      runners: { producer: async () => {
        const mfPath = join(orch.pipeline.dir, 'folder-manifest.json');
        const mf = JSON.parse(readFileSync(mfPath, 'utf8')); forge(mf); writeFileSync(mfPath, JSON.stringify(mf));
        writeFileSync(join(orch.runCwd, 'notes.txt'), 'edited\n');
        return { status: 'ok' };
      }, verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }) } });
    assert.equal((await orch.run()).status, 'done', name);
    for (const f of ['changes.patch', 'changes.json']) {
      const p = join(orch.pipeline.dir, f);
      const text = existsSync(p) ? readFileSync(p, 'utf8') : '';
      assert.doesNotMatch(text, /CANARY-TEXT/, `${name}: ${f}`);
      assert.doesNotMatch(text, /\.\.\//, `${name}: ${f}`);
    }
    if (name === 'root') assert.equal(JSON.parse(readFileSync(join(orch.pipeline.dir, 'changes.json'), 'utf8')).root, dir, 'the root is the run\'s record');
  }
});

// Hosted isolation: `runs/` is group-writable, so the agent can rename its own cwd (the copy) or the `repos/` above it
// and link any folder in its place. Every containment check compared against the copy's realpath, which then IS the
// link's target. `cwd`: a link at repos/<key> (the scan's root lstat refuses it too); `repos`: a link at repos/ — the
// copy's path ends in a real folder, so only the trusted-root check refuses it. Swapped by the producer, the run pauses
// before the next node (its spawn files and cwd would be the link's); swapped by the last node (the verifier), the
// run-end scan and the teardown skip the copy.
test('POSIX: an agent that swaps its copy folder (or repos/) for a link never gets the link target\'s files into changes.patch, changes.json or a later node; the target is never written or emptied', { skip: process.platform === 'win32' }, async () => {
  const snap = (d) => readdirSync(d, { recursive: true }).map(String).sort()
    .map((r) => [r, lstatSync(join(d, r)).isFile() ? readFileSync(join(d, r), 'utf8') : null]);
  const plant = (d) => { mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'secret.txt'), 'CANARY-SECRET\n'); writeFileSync(join(d, 'notes.txt'), 'CANARY-SECRET\n'); };
  for (const when of ['producer', 'verifier']) for (const shape of ['cwd', 'repos']) {
    const label = `${when}/${shape}`;
    const canary = mkdtempSync(join(tmpdir(), 'worca-folder-canary-')); dirs.push(canary);
    const dir = plainFolder();
    const seen = [];
    let orch; let before = null;
    const swap = (ctx) => {
      const at = shape === 'cwd' ? orch.runCwd : dirname(orch.runCwd);
      plant(shape === 'cwd' ? canary : join(canary, basename(orch.runCwd)));
      before = snap(canary);
      renameSync(at, `${at}-moved`); symlinkSync(canary, at);
      // a memory write in the same execution: its sync refreshes the rules copy, which lives in the cwd
      mkdirSync(join(ctx.memoryMount, 'project'), { recursive: true });
      writeFileSync(join(ctx.memoryMount, 'project', `lesson-${when}-${shape}.md`), 'Run the suite first.\n');
    };
    orch = ENGINES[0].create({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder',
      runners: { producer: async (ctx) => {
        if (before) return { status: 'ok' };
        writeFileSync(join(orch.runCwd, 'notes.txt'), 'edited\n');
        if (when === 'producer') swap(ctx);
        return { status: 'ok' };
      }, verifier: async (ctx) => {
        const p = join(orch.pipeline.dir, 'changes.patch');
        seen.push(existsSync(p) ? readFileSync(p, 'utf8') : '');
        if (when === 'verifier' && !before) swap(ctx);
        return { status: 'ok', issues: [], review: { issues: [] }, summary: '' };
      } } });
    const res = await orch.run();
    assert.ok(before, `${label}: the swap happened`);
    if (when === 'producer') {
      assert.equal(res.status, 'paused', label);
      assert.deepEqual(seen, [], `${label}: no node starts on the link`);
      // a resume never re-attaches the link: no mount is assembled into it, no node runs there
      const r = await createOrchestratorFor({ projectDir: dir, auto: true, claude: { mock: true }, resume: readPipelineForResume(orch.state.id) });
      const out = await r.resume().catch((e) => ({ status: 'threw', error: e?.message }));
      assert.notEqual(out.status, 'done', `${label}: resume`);
      assert.deepEqual(seen, [], `${label}: no node starts on the link after a resume`);
    } else {
      assert.equal(res.status, 'done', label);
      assert.ok(seen.length > 0, `${label}: the verifier ran`);
      assert.equal(existsSync(join(worcaHome(), 'runs', orch.state.id)), false, `${label}: the run root goes, the link with it`);
    }
    for (const text of seen) assert.doesNotMatch(text, /CANARY-SECRET|secret\.txt/, `${label}: what the verifier read`);
    for (const f of ['changes.patch', 'changes.json']) {
      const p = join(orch.pipeline.dir, f);
      assert.doesNotMatch(existsSync(p) ? readFileSync(p, 'utf8') : '', /CANARY-SECRET|secret\.txt/, `${label}: ${f}`);
    }
    assert.deepEqual(snap(canary), before, `${label}: nothing is written into or removed from the link target`);
  }
});

test('S52: opts.projectKey is the run\'s store key — members, state, the row, the store folder', async () => {
  const dir = plainFolder();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder', projectKey: 'site-0000abcd' });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual([orch.members[0].projectKey, orch.state.projectKey], ['site-0000abcd', 'site-0000abcd']);
  assert.equal(getDb().prepare('SELECT project_key FROM pipelines WHERE id = ?').get(orch.state.id).project_key, 'site-0000abcd');
  assert.ok(orch.pipeline.dir.startsWith(join(worcaHome(), 'store', 'site-0000abcd', 'pipelines')));
  assert.equal(readStoreMeta('site-0000abcd')?.path != null, true, 'store_meta is written under the stored key');
  assert.ok((await listRunArtifacts(orch.state.id, { kind: 'plan' })).length > 0, 'plans land and are indexed under the stored key (runCtx.storeKey), not projectKey(dir)');
  assert.equal((await readPipeline(dir, orch.state.id))?.state?.id, orch.state.id, 'readPipeline(dir, id) finds a run stored under its registered key (S52)');
});

test('S52: a Folder project whose parent became a git repo after registration keeps its own path in store_meta', async () => {
  const { execFileSync } = await import('node:child_process');
  const { realpathSync } = await import('node:fs');
  const { readPipelineStateById } = await import('../src/core/artifacts.mjs');
  const parent = mkdtempSync(join(tmpdir(), 'worca-folder-run-par-')); dirs.push(parent);
  const sub = join(parent, 'site'); mkdirSync(sub); writeFileSync(join(sub, 'notes.txt'), 'hello\n');
  await addProject({ name: `${basename(parent)}-site`, path: sub });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: parent });
  const key = getProjectByPath(sub).key;
  const orch = createOrchestrator({ projectDir: sub, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder', projectKey: key });
  assert.equal((await orch.run()).status, 'done');
  assert.equal(realpathSync(readStoreMeta(key).path), realpathSync(sub), 'never the enclosing repo');
  assert.equal(realpathSync(readPipelineStateById(orch.state.id).projectDir), realpathSync(sub), "the saved run's projectDir is the folder (P1b S18)");
});

test('a copy whose changes could not be listed is kept, never removed with the run root', async () => {
  const dir = plainFolder();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder' });
  orch._refreshFolderChanges = async () => null;               // every scan fails (ENOSPC writing changes.json, an unreadable file)
  assert.equal((await orch.run()).status, 'done');
  const br = branchOf(orch.state.id);
  assert.ok(existsSync(join(br.copyDir, 'src', 'feature.mjs')), 'the agent\'s work survives teardown');
  assert.equal(JSON.parse(readFileSync(join(worcaHome(), 'runs', orch.state.id, 'run.json'), 'utf8')).retain.reason, 'folder-apply');
});

test('a Cursor run: an agent deleting the folder\'s own .cursor/mcp.json is a change (worca\'s absent config paths hide only what the folder never shipped)', async () => {
  const dir = plainFolder(); mkdirSync(join(dir, '.cursor'));
  writeFileSync(join(dir, '.cursor', 'mcp.json'), '{"mcpServers":{"mine":{"command":"x"}}}\n');
  let orch;
  orch = ENGINES[0].create({ projectDir: dir, prompt: 'x', auto: true, guardrailsId: 'permissive', claude: { mock: true, engine: 'cursor' }, workMode: 'folder',
    runners: { producer: async () => { rmSync(join(orch.runCwd, '.cursor', 'mcp.json'), { force: true }); return { status: 'ok' }; },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }) } });
  assert.equal((await orch.run()).status, 'done');
  const changes = JSON.parse(readFileSync(join(orch.pipeline.dir, 'changes.json'), 'utf8'));
  assert.deepEqual(changes.files.map((f) => [f.path, f.change]), [['.cursor/mcp.json', 'deleted']]);
  assert.ok(changes.exclude.includes('.cursor/cli.json') && !changes.exclude.includes('.cursor/mcp.json'), JSON.stringify(changes.exclude));
});

// test/folder-run.test.mjs — setup replay (new); createOrchestratorFor and readPipelineForResume come with Task 4's import block
test('a setup failure before the copy pauses; the resume replays the copy and never runs git', async () => {
  const dir = plainFolder();
  const first = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder' });
  first._setupFolderRunRoot = async () => { throw new Error('disk hiccup'); };
  assert.equal((await first.run()).status, 'paused');
  assert.equal(branchOf(first.state.id).workMode, 'folder', 'the mode is recorded before setup');
  // auto: true — a resume never restores `auto`, and a setup replay restarts the graph, so the mock clarifier would ask
  // and the test would never end (tools/test.mjs has no timeout).
  const r = await createOrchestratorFor({ projectDir: dir, auto: true, claude: { mock: true }, resume: readPipelineForResume(first.state.id) });
  const calls = spyGit(r);
  assert.equal((await r.resume()).status, 'done'); assert.deepEqual(calls, []);
  assert.equal(existsSync(join(dir, '.git')), false);
});

// test/folder-run.test.mjs — two rows (v4), appended. Each one is the only test of its wiring: the skill gate (removing
// the `shippedSkillNames` arm or the harness's `shippedFiles` spread left every other suite green, and with
// `skillMount: 'symlink'` the agent's edit then landed in the REAL folder) and `_execCtx`'s `workMode` (S30).
test('S31: a folder\'s own skill stays the folder\'s — never re-mounted over the copy; an edit to it is a change', async () => {
  const dir = plainFolder(); mkdirSync(join(dir, '.claude', 'skills', 'own'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'skills', 'own', 'SKILL.md'), '---\nname: own\n---\nmine\n');
  let orch;
  orch = ENGINES[0].create({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder',
    runners: { producer: async () => { writeFileSync(join(orch.runCwd, '.claude', 'skills', 'own', 'SKILL.md'), '---\nname: own\n---\nedited\n'); return { status: 'ok' }; },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }) } });
  assert.equal((await orch.run()).status, 'done');
  const changes = JSON.parse(readFileSync(join(orch.pipeline.dir, 'changes.json'), 'utf8'));
  assert.deepEqual(changes.files.map((f) => [f.path, f.change]), [['.claude/skills/own/SKILL.md', 'modified']]);
  assert.equal(readFileSync(join(dir, '.claude', 'skills', 'own', 'SKILL.md'), 'utf8'), '---\nname: own\n---\nmine\n', 'only Apply writes the folder');
});

test('S30: a folder run\'s node ctx carries workMode — its prompts get the no-git note, its spawns noGit', async () => {
  const dir = plainFolder(); const seen = [];
  const { taskHeader, runOpts } = await import('../src/core/phases.mjs');
  const orch = ENGINES[0].create({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, workMode: 'folder',
    runners: { producer: async (ctx) => {
      seen.push([ctx.workMode, taskHeader(ctx, 'T').includes('Never run git here'), runOpts(ctx, { role: 'implementer', prompt: 'p', systemPrompt: 's', allowedTools: [] }).noGit]);
      return { status: 'ok' };
    }, verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }) } });
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.length > 0);
  for (const s of seen) assert.deepEqual(s, ['folder', true, true]);
});

test('CLI: worca run on a registered Folder project runs on a copy (no .git, the folder untouched)', () => {
  const dir = plainFolder();
  const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
  const env = { ...process.env, WORCA_MOCK: '1' };
  assert.equal(spawnSync(process.execPath, [CLI, 'add', 'clisite', '--path', dir], { env, encoding: 'utf8' }).status, 0);
  const r = spawnSync(process.execPath, [CLI, '--project', dir, '--prompt', 'x', '--mock', '--yes'], { env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([existsSync(join(dir, '.git')), existsSync(join(dir, 'src', 'feature.mjs'))], [false, false]);
});

test('CLI: worca run on a registered Git project keeps projectKey(dir), never its stored key (S68)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-folder-run-git-')); dirs.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), '# x\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  getDb().prepare("INSERT INTO projects (key, name, path, created_at, vcs) VALUES ('cligit-0000abcd', 'cligit', ?, ?, 'git')").run(dir, new Date().toISOString());
  const seen = new Set(getDb().prepare('SELECT id FROM pipelines').all().map((p) => p.id));
  const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [CLI, '--project', dir, '--prompt', 'x', '--mock', '--yes'],
    { env: { ...process.env, WORCA_MOCK: '1' }, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, r.stderr);
  const rows = getDb().prepare('SELECT id, project_key, branch FROM pipelines').all().filter((p) => !seen.has(p.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_key, projectKey(dir));
  assert.equal('workMode' in (JSON.parse(rows[0].branch || 'null') || {}), false, 'a git run\'s branch record carries no workMode');
  assert.equal(existsSync(join(worcaHome(), 'store', 'cligit-0000abcd')), false, 'nothing lands under the stored key');
});

test('CLI: worca run refuses a Folder project over the limit, a run after the previous run\'s branch, and a gone folder', () => {
  const dir = plainFolder();                                       // notes.txt + docs/a.md: 2 files
  const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
  const run = (args, extra = {}) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, WORCA_MOCK: '1', ...extra }, encoding: 'utf8', timeout: 120_000 });
  assert.equal(run(['add', 'clilimits', '--path', dir]).status, 0);
  const big = run(['--project', dir, '--prompt', 'x', '--mock', '--yes'], { WORCA_FOLDER_MAX_FILES: '1' });
  assert.deepEqual([big.status, big.stderr.trim()], [2, 'worca: clilimits has 2 files. The limit is 1.']);
  const chain = run(['--project', dir, '--prompt', 'x', '--mock', '--yes', '--after', 'abcdef12', '--source-from-previous']);
  assert.deepEqual([chain.status, chain.stderr.trim()], [2, "worca: a Folder project run cannot start from the previous run's branch"]);
  rmSync(dir, { recursive: true, force: true });
  const gone = run(['--project', dir, '--prompt', 'x', '--mock', '--yes']);
  assert.deepEqual([gone.status, gone.stderr.trim(), existsSync(dir)], [2, `worca: The folder is missing: ${dir}`, false]);
});
