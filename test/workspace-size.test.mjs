// test/workspace-size.test.mjs
// Workspace size (D21–D23): the shared limits module, the 40-member create cap shared by
// createWorkspace and the scan launch, and the scan description budget that grows with the
// member count (300 -> 500 -> 800 lines), carried in the scan run's prompt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import {
  WORKSPACE_MAX_PROJECTS, WORKSPACE_BIG_OVER, WORKSPACE_VERY_BIG_OVER,
  workspaceSizeLevel, scanDescriptionBudget,
} from '../src/shared/workspace-size.mjs';
import { checkNewWorkspace, createWorkspace, listWorkspaces } from '../src/core/workspaces.mjs';
import { scanRunPrompt } from '../src/core/workspace-scan-run.mjs';

useTempHome(after);

// 41 throwaway repos: `git init` is all isGitRepo / canonicalProjectRoot need (no commit).
let root;
let repos = [];
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'worca-cc-wssize-'));
  repos = Array.from({ length: 41 }, (_, i) => join(root, `p${String(i).padStart(2, '0')}`));
  for (const dir of repos) spawnSync('git', ['init', '-q', dir]);
});
after(() => rm(root, { recursive: true, force: true }));

const names = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const tooMany = (e) => e.code === 'BAD_REQUEST' && /at most 40 member projects \(41 given\)/.test(e.message);

test('the limits: 40 members at most, warnings above 10 and above 20', () => {
  assert.equal(WORKSPACE_MAX_PROJECTS, 40);
  assert.equal(WORKSPACE_BIG_OVER, 10);
  assert.equal(WORKSPACE_VERY_BIG_OVER, 20);
  assert.deepEqual([0, 2, 10, 11, 20, 21, 40, 41].map((n) => workspaceSizeLevel(n)),
    ['ok', 'ok', 'ok', 'big', 'big', 'very-big', 'very-big', 'over']);
});

test('the description budget grows past 5 and past 20 members, then tops out', () => {
  assert.deepEqual([2, 5, 6, 20, 21, 40, 57].map((n) => scanDescriptionBudget(n)), [300, 300, 500, 500, 800, 800, 800]);
});

test('the scan prompt carries the budget for its member count', () => {
  assert.match(scanRunPrompt({ name: 'S', projectNames: names(5) }), /Length budget: up to ~300 lines \(5 member projects\)/);
  assert.match(scanRunPrompt({ name: 'M', projectNames: names(6) }), /Length budget: up to ~500 lines \(6 member projects\)/);
  assert.match(scanRunPrompt({ name: 'L', projectNames: names(21), rescan: true }), /Length budget: up to ~800 lines \(21 member projects\)/);
});

test('create cap: 40 members pass; 41 are refused by the scan launch AND by createWorkspace', async () => {
  assert.equal(checkNewWorkspace({ name: 'Forty', projectPaths: repos.slice(0, 40) }).projectPaths.length, 40);
  assert.throws(() => checkNewWorkspace({ name: 'Forty-one', projectPaths: repos }), tooMany);
  await assert.rejects(() => createWorkspace({ name: 'Forty-one', projectPaths: repos }), tooMany);
  assert.ok(!(await listWorkspaces()).some((w) => w.name === 'Forty-one'), 'nothing written');
});

test('the cap counts DISTINCT members: 41 paths naming 40 repos pass', () => {
  const ok = checkNewWorkspace({ name: 'Dup path', projectPaths: [...repos.slice(0, 40), repos[0]] });
  assert.equal(ok.projectPaths.length, 40);
});

test('the scanner body takes its budget from the prompt and covers every member in waves of up to 8', async () => {
  const body = await readFile(new URL('../agents/worca-cc-workspace-scanner.md', import.meta.url), 'utf8');
  assert.match(body, /`Length budget:` line/);
  assert.match(body, /waves of up to 8/);
  assert.doesNotMatch(body, /200–300/, 'the fixed 200–300 ceiling is gone');
});
