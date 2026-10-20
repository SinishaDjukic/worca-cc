// test/git-missing-sync-sites.test.mjs — the sync call sites and the three decided flips, on real repos built while
// git is on: each answer below is the one git would NOT give, so a leaked spawn fails the row.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo, gitDir } from './helpers/git-dir.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';
import { canonicalProjectRoot, projectKey, _resetCanonicalRootCache } from '../src/core/store.mjs';
import { isGitRepo, scanMemberProblems, createWorkspace } from '../src/core/workspaces.mjs';
import { mcpjsonApproval } from '../src/core/run-context.mjs';
import { localSettingsTracked, approveCommittedMcp } from '../src/core/mcpjson-approval.mjs';
import { writeCursorProjectFiles } from '../src/core/engines/cursor.mjs';
import { resolveBenchCwd } from '../src/core/script-bench.mjs';
import { initDir } from '../src/cli/container.mjs';

useTempHome(after);
afterEach(() => { cap.reset(); _resetCanonicalRootCache(); });
const tracked = templateRepo('p0-local', { files: { '.claude/settings.local.json': '{"enabledMcpjsonServers":["x"]}\n', '.mcp.json': '{"mcpServers":{"x":{"command":"node"}}}\n' } });
const repo = gitDir('p0-sync');
const sub = join(repo, 'sub'); mkdirSync(sub);

test('sync call sites while git is missing', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'canonicalProjectRoot falls to the realpath; projectKey is not pinned while git is missing', run: () => {
      assert.equal(canonicalProjectRoot(sub), realpathSync(sub));
      const offKey = projectKey(sub);
      gitArrives(); _resetCanonicalRootCache();
      assert.notEqual(projectKey(sub), offKey);
      assert.equal(projectKey(sub), projectKey(repo));
    } },
    { name: 'isGitRepo false; a scan only checks existence; an unregistered repo is refused as not registered', run: async () => {
      const other = gitDir('p0-sync2');
      withNoGit();
      assert.equal(isGitRepo(repo), false);
      assert.deepEqual(scanMemberProblems([repo]), []);
      await assert.rejects(createWorkspace({ name: 'W', projectPaths: [repo, other] }), { code: 'BAD_REQUEST', message: `member path is not a registered project: ${repo}` });
    } },
    { name: 'flip: a tracked .claude/settings.local.json counts as untracked — Approve allowed, approvals apply', run: async () => {
      const home = mkdtempSync(join(tmpdir(), 'worca-p0-home-'));
      gitArrives();
      assert.equal(localSettingsTracked(tracked), true, 'git on: tracked');
      assert.equal((await mcpjsonApproval(tracked, home, () => {}, { managed: [] }))('x'), 'unapproved');
      withNoGit();
      assert.equal(localSettingsTracked(tracked), false);
      assert.equal((await mcpjsonApproval(tracked, home, () => {}, { managed: [] }))('x'), 'approved');
    } },
    { name: 'flip: Cursor files and an Approve land with no info/exclude line; a bench dir has no checkpoint', run: async () => {
      const box = gitDir('p0-cursor');
      withNoGit();
      const exclude = join(box, '.git', 'info', 'exclude');
      const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
      writeCursorProjectFiles(box, { '.cursor/cli.json': '{}\n' });
      assert.equal(readFileSync(join(box, '.cursor', 'cli.json'), 'utf8'), '{}\n');
      writeFileSync(join(box, '.mcp.json'), '{"mcpServers":{"x":{"command":"node"}}}\n');
      await approveCommittedMcp(box, ['x']);
      assert.deepEqual(JSON.parse(readFileSync(join(box, '.claude', 'settings.local.json'), 'utf8')).enabledMcpjsonServers, ['x']);
      assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before);
      assert.equal((await resolveBenchCwd({ kind: 'dir', dir: box }, { dirs: {}, allowDirCwd: true })).checkpointRef, null);
    } },
    { name: 'container init: no git config read, the identity lines stay empty', run: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'worca-p0-box-'));
      const calls = [];
      await initDir(dir, { projects: dir, exec: (cmd, args) => { calls.push(cmd); return { status: 0, stdout: 'Ada\n' }; }, env: { HOME: dir } });
      assert.equal(calls.filter((c) => c === 'git').length, 0);
      assert.doesNotMatch(readFileSync(join(dir, '.env'), 'utf8'), /Ada/);
    } },
  ]);
});

// Imports here (ESM hoists them): every line above stays byte-identical for P5's edits of this file.
import { execFileSync } from 'node:child_process';
import { runGraphifyUpdate } from '../src/core/preflight.mjs';
import gitSubmodules from '../src/core/workspace-map/detectors/git-submodules.mjs';

test('sync call sites while git is missing: the graphify sentinel and a submodule origin', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'graphify: a repo that commits graphify-out/ still gets the ignore sentinel while git is missing (git never asked)', run: async () => {
      const g = templateRepo('p0-graph', { files: { 'graphify-out/graph.json': '{}\n' } });
      const sentinel = join(g, 'graphify-out', '.gitignore');
      const noCwd = join(g, 'no-such-cwd');          // graphify itself never starts: its spawn fails on the missing cwd
      gitArrives();
      await runGraphifyUpdate({ dir: g, cwd: noCwd, timeoutMs: 5000 });
      assert.equal(existsSync(sentinel), false, 'git on: the repo commits its graph');
      withNoGit();
      await runGraphifyUpdate({ dir: g, cwd: noCwd, timeoutMs: 5000 });
      assert.equal(readFileSync(sentinel, 'utf8'), '*\n');
    } },
    { name: 'workspace map: a relative submodule URL stays unresolved while git is missing (origin never read)', run: () => {
      const box = gitDir('p0-subm');
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/web.git'], { cwd: box });
      const finish = () => {
        const ctx = { state: {}, member: { dir: box } };
        gitSubmodules.detect({ rel: '.gitmodules', text: '[submodule "billing"]\n\tpath = billing\n\turl = ../billing.git\n' }, ctx);
        return gitSubmodules.finish(ctx);
      };
      gitArrives();
      assert.deepEqual(finish().facts.map((f) => f.target), ['github.com/acme/billing'], 'git on: resolved through origin');
      withNoGit();
      const off = finish();
      assert.deepEqual([off.facts.length, off.unresolved.map((u) => u.reason)], [0, ['relative submodule url without origin']]);
    } },
  ]);
});

import { rmSync } from 'node:fs';
import { mergeMcpConfigs } from '../src/core/run-context.mjs';

test('sync call sites while git is missing: MCP local scope', async (t) => {
  withNoGit(t);
  const made = [];
  t.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
  await checkRows([
    { name: 'a member in a repo sub-folder finds no ~/.claude.json entry keyed by the repo top while git is missing (rev-parse never runs)', run: async () => {
      const home = mkdtempSync(join(tmpdir(), 'worca-p0-mcphome-')); made.push(home);
      const root = mkdtempSync(join(tmpdir(), 'worca-p0-mcproot-')); made.push(root);
      // git's own spelling of the top (/private/var on macOS, C:/ on Windows): the key run-context looks up with git on.
      const top = execFileSync('git', ['-C', sub, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
      writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [top]: { mcpServers: { local1: { command: 'node', args: ['/abs/local.js'] } } } } }));
      const merge = async () => Object.keys((await mergeMcpConfigs({ members: [{ projectKey: 'k1', projectName: 'P', projectDir: sub, worktreeDir: null }],
        projectsRoot: root, homeDir: home, isWorkspace: true, platform: 'darwin' })).servers);
      gitArrives();
      assert.deepEqual(await merge(), ['local1'], 'git on: keyed by the repo top');
      withNoGit();
      assert.deepEqual(await merge(), []);
    } },
  ]);
});
