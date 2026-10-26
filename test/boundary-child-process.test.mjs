// test/boundary-child-process.test.mjs
// src/core/spawn.mjs owns child processes (plans/core-protection-layer-design.md §4.1): it is the one module that
// imports node:child_process, apart from a frozen ratchet of git and host-tool callers that may only shrink. No engine
// adapter builds an env from worca's own; workspace-map git never walks above the member it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gitOutput } from '../src/core/workspace-map/files.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /from ['"](node:)?child_process['"]|import\(['"](node:)?child_process['"]\)/;

/** The callers still allowed their own node:child_process import. It only shrinks: each entry moves behind its
 *  owner-to-be (git-guard: git calls; spawn: everything else), and a stale entry fails the test below. */
const RATCHET = Object.freeze([
  'src/core/worktree.mjs',                       // git-guard
  'src/core/git-lock.mjs',                       // git-guard
  'src/core/git-guard.mjs',                      // git-guard (the git env owner itself, #854)
  'src/core/git-available.mjs',                  // git-guard
  'src/core/in-base.mjs',                        // git-guard
  'src/core/run-harness.mjs',                    // git-guard
  'src/core/git-info.mjs',                       // git-guard
  'src/core/git-sync.mjs',                       // git-guard
  'src/core/workspace-import.mjs',               // git-guard
  'src/core/workspaces.mjs',                     // git-guard
  'src/core/store.mjs',                          // git-guard
  'src/core/mcpjson-approval.mjs',               // git-guard
  'src/core/script-bench.mjs',                   // git-guard
  'src/core/run-context.mjs',                    // git-guard
  'src/core/checkout.mjs',                       // git-guard
  'src/core/project-create.mjs',                 // git-guard
  'src/core/clone-project.mjs',                  // git-guard
  'src/core/metrics/sync.mjs',                   // git-guard
  'src/core/metrics/prs.mjs',                    // spawn (gh)
  'src/core/skills-registry/import.mjs',         // git-guard
  'src/core/terminal/worktrees.mjs',             // git-guard
  'src/core/exec-env/git-transfer.mjs',          // git-guard
  'src/core/exec-env/e2b-fake.mjs',              // spawn (a test stand-in for E2B)
  'src/core/agent-user.mjs',                     // spawn
  'src/core/mcp/launch.mjs',                     // spawn
  'src/core/mcp/test.mjs',                       // spawn
  'src/core/keep-awake.mjs',                     // spawn
  'src/core/folder-dialog.mjs',                  // spawn
  'src/core/graph/python-probe.mjs',             // spawn
  'src/core/plugin-repo.mjs',                    // git-guard
  'src/core/plugin-inventory.mjs',               // git-guard
  'src/core/marketplace-publish.mjs',            // git-guard
  'src/core/proxy-credentials.mjs',              // spawn (the OS keychain tool)
  'src/core/ui-update.mjs',                      // spawn (npm)
  'src/core/update-eligibility.mjs',             // spawn (npm)
  'src/cli/extension.mjs',                       // spawn
  'src/cli/container.mjs',                       // spawn
  'src/cli/container-mounts.mjs',                // git-guard
  'src/cli/worca-cc.mjs',                        // spawn
  'ui/server.mjs',                               // spawn
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.mjs')) out.push(p);
  }
  return out;
}
const importers = () => new Set([...walk(join(ROOT, 'src')), join(ROOT, 'ui', 'server.mjs')]
  .filter((f) => IMPORT_RE.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f).split('\\').join('/')));

test('only spawn.mjs and the ratchet import child_process', () => {
  const extra = [...importers()].filter((f) => f !== 'src/core/spawn.mjs' && !RATCHET.includes(f)).sort();
  assert.deepEqual(extra, [], 'start the process through src/core/spawn.mjs (childEnv, superviseSpawn, execCheck, runCapture, spawnChild)');
});

test('the ratchet only shrinks', () => {
  const now = importers();
  const stale = RATCHET.filter((f) => !now.has(f));
  assert.deepEqual(stale, [], 'these no longer import child_process: take them off RATCHET');
});

test('no raw env in engines', () => {
  const dir = join(ROOT, 'src', 'core', 'engines');
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const pat of ['buildSpawnEnv(', '...process.env', 'env: process.env', 'composeSpawnEnv(']) if (src.includes(pat)) bad.push(`${f}: ${pat}`);
  }
  assert.deepEqual(bad, []);
});

test('scripts, the terminal, actions, plugin children and worca\'s own git build their env and signal groups through the owner', () => {
  const files = ['src/core/graph/script-runner.mjs', 'src/core/terminal/context.mjs', 'src/core/terminal/pty.mjs', 'src/core/actions/spawn.mjs',
    'src/core/plugin-shim.mjs', 'src/core/workspace-map/files.mjs', 'src/core/workspace-map/detectors/git-submodules.mjs',
    'src/core/engines/cursor.mjs'];
  const bans = [/\.\.\.process\.env\b/, /stripHostCredentials\(/, /GIT_CEILING_DIRECTORIES:\s*dirname/, /process\.kill\(-/];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const re of bans) if (re.test(src)) bad.push(`${f}: ${re.source}`);
  }
  assert.deepEqual(bad, [], 'childEnv({ kind }) builds the env; signalProcessGroup signals the group (src/core/spawn.mjs)');
});

test('workspace-map git has a ceiling', { skip: process.platform === 'win32' }, async () => {
  const repo = mkdtempSync(join(tmpdir(), 'worca-ceil-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const nested = join(repo, 'member');
    mkdirSync(nested);
    assert.equal(await gitOutput(nested, ['rev-parse', '--show-toplevel']), null, 'a non-repo member never borrows the repo around it');
    assert.ok((await gitOutput(repo, ['rev-parse', '--show-toplevel']))?.trim(), 'the repo itself still answers');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
