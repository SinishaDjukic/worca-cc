// test/memory-team-available.test.mjs — team memory E10: after a project is added, whether its origin already has a
// worca-memory branch (one ls-remote through runGit), stored beside the seeding offer; the offer it raises, Not now,
// and the switch taking it. Never a switch-on of its own.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useGitSandbox, makeOrigin, cloneAs, git } from './helpers/metrics-git.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { addProject, removeProject } from '../src/core/projects.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { _testing as metricsTesting } from '../src/core/metrics/sync.mjs';
import {
  detectTeamMemory, teamMemoryAvailability, dismissTeamMemoryOffer, switchTeamMemoryOn, teamMemoryStatus, isTeamMemoryOn,
  TEAM_MEMORY_BRANCH, _testing,
} from '../src/core/memory-team.mjs';

const skip = process.platform === 'win32' ? 'sh not portable to win32' : false;
const root = mkdtempSync(join(tmpdir(), 'worca-team-avail-'));
useGitSandbox(before, after);
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { metricsTesting.reset(); });

const NOW = '2026-10-24T10:00:00.000Z';
const add = async (name, path) => (await addProject({ name, path })).find((p) => p.name === name);
/** A bare origin whose worca-memory branch a teammate already pushed. */
function sharedOrigin(name) {
  const bare = makeOrigin(root, name);
  const tm = cloneAs(root, 'teammate', bare, name);
  git(tm, 'checkout', '-q', '--orphan', TEAM_MEMORY_BRANCH);
  git(tm, 'commit', '-q', '--allow-empty', '-m', 'team memory');
  git(tm, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
  return bare;
}

test('a real origin WITH the branch: detected, stored, and offered while the project is off', { skip }, async () => {
  const bare = sharedOrigin('shared');
  const p = await add('shared', cloneAs(root, 'me', bare, 'shared'));
  assert.equal(teamMemoryAvailability(p.key).branchOnOrigin, null, 'adding alone checks nothing');
  assert.equal(await detectTeamMemory(p.path, { now: NOW }), true);
  assert.deepEqual(teamMemoryAvailability(p.key), { branchOnOrigin: true, checkedAt: NOW, state: 'pending', offer: true });
  assert.equal(isTeamMemoryOn(p.key), false, 'the check never switches it on');
  const st = await teamMemoryStatus(p.key);
  assert.equal(st.enabled, false);
  assert.equal(st.available.offer, true);
  // Beside offers/, outside projects/<key>: the switch-off's discard and an unregister keep it.
  assert.ok(existsSync(_testing.paths(p.key).available));
  assert.ok(!_testing.paths(p.key).available.startsWith(_testing.paths(p.key).dir));
});

test('a real origin WITHOUT the branch: false, no offer', { skip }, async () => {
  const bare = makeOrigin(root, 'lonely');
  const p = await add('lonely', cloneAs(root, 'me', bare, 'lonely'));
  assert.equal(await detectTeamMemory(p.path), false);
  assert.equal(teamMemoryAvailability(p.key).branchOnOrigin, false);
  assert.equal(teamMemoryAvailability(p.key).offer, false);
});

test('no check for a Folder project, without git, or without origin — no git call at all', { skip }, async (t) => {
  const calls = [];
  metricsTesting.setGit(async (cwd, args) => { calls.push(args[0]); return { ok: true, code: 0, stdout: `abc\trefs/heads/${TEAM_MEMORY_BRANCH}\n`, stderr: '' }; });
  const folderDir = join(root, 'folder-only'); mkdirSync(folderDir, { recursive: true });
  const folder = await add('folder-only', folderDir);
  assert.equal(folder.vcs, 'none');
  assert.equal(await detectTeamMemory(folder.path), null);
  const noOriginDir = join(root, 'no-origin'); mkdirSync(noOriginDir, { recursive: true });
  git(noOriginDir, 'init', '-q', '-b', 'main');
  const noOrigin = await add('no-origin', noOriginDir);
  assert.equal(await detectTeamMemory(noOrigin.path), null);
  const bare = sharedOrigin('nogit');
  const withOrigin = await add('nogit', cloneAs(root, 'me', bare, 'nogit'));
  withNoGit(t);
  assert.equal(await detectTeamMemory(withOrigin.path), null);
  assert.deepEqual(calls, [], 'no ls-remote ran');
  for (const p of [folder, noOrigin, withOrigin]) assert.equal(existsSync(_testing.paths(p.key).available), false, 'nothing stored');
  assert.equal(await detectTeamMemory(join(root, 'not-registered')), null);
});

test('a failing or slow remote: null, never a throw, and the last verdict stays', { skip }, async () => {
  const bare = sharedOrigin('flaky');
  const p = await add('flaky', cloneAs(root, 'me', bare, 'flaky'));
  assert.equal(await detectTeamMemory(p.path, { now: NOW }), true);
  metricsTesting.setGit(async () => ({ ok: false, code: 128, stdout: '', stderr: 'fatal: could not read from remote repository' }));
  assert.equal(await detectTeamMemory(p.path), null);
  metricsTesting.setGit(async () => { throw new Error('spawn failed'); });
  assert.equal(await detectTeamMemory(p.path), null);
  assert.deepEqual(teamMemoryAvailability(p.key), { branchOnOrigin: true, checkedAt: NOW, state: 'pending', offer: true });
  // Slow: the timeout reaches git (runGit kills it), here the fake answers like a SIGKILLed command.
  let seen = null;
  metricsTesting.setGit(async (_cwd, args, opts) => { seen = { args, timeoutMs: opts?.timeoutMs }; return { ok: false, code: -1, stdout: '', stderr: 'killed' }; });
  assert.equal(await detectTeamMemory(p.path), null);
  assert.deepEqual(seen, { args: ['ls-remote', '--heads', 'origin', TEAM_MEMORY_BRANCH], timeoutMs: 10_000 });
  // An origin that is gone: the real git fails, quickly.
  git(p.path, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
  metricsTesting.reset();
  assert.equal(await detectTeamMemory(p.path), null);
});

test('Not now persists — a re-check and a re-add keep it', { skip }, async () => {
  const bare = sharedOrigin('later');
  const dir = cloneAs(root, 'me', bare, 'later');
  const p = await add('later', dir);
  await detectTeamMemory(p.path);
  assert.deepEqual(dismissTeamMemoryOffer(p.key), { branchOnOrigin: true, checkedAt: teamMemoryAvailability(p.key).checkedAt, state: 'dismissed', offer: false });
  await detectTeamMemory(p.path);
  assert.equal(teamMemoryAvailability(p.key).state, 'dismissed');
  await removeProject('later', { pruneWaitMs: 50 });
  const again = await add('later', dir);
  assert.equal(again.key, p.key);
  await detectTeamMemory(again.path);
  assert.equal(teamMemoryAvailability(again.key).offer, false, 'for good on this machine');
  assert.throws(() => dismissTeamMemoryOffer('../x'), /invalid project key/);
});

test('the offer is hidden while on, and the normal switch takes it for good', { skip }, async () => {
  const bare = sharedOrigin('takeit');
  const p = await add('takeit', cloneAs(root, 'me', bare, 'takeit'));
  await detectTeamMemory(p.path);
  assert.equal(teamMemoryAvailability(p.key).offer, true);
  await switchTeamMemoryOn(p.key, p.path, () => writeProjectSettings({ projectDir: p.path }, { 'memory.team': true }));
  assert.equal(isTeamMemoryOn(p.key), true);
  assert.deepEqual([teamMemoryAvailability(p.key).state, teamMemoryAvailability(p.key).offer], ['accepted', false]);
  writeProjectSettings({ projectDir: p.path }, { 'memory.team': null });
  assert.equal(teamMemoryAvailability(p.key).offer, false, 'switched off later: a choice, never offered again');
  assert.equal(JSON.parse(readFileSync(_testing.paths(p.key).available, 'utf8')).branchOnOrigin, true);
});

test('on by a hand-written setting (no switch call): the line is hidden too', { skip }, async () => {
  const bare = sharedOrigin('byhand');
  const p = await add('byhand', cloneAs(root, 'me', bare, 'byhand'));
  await detectTeamMemory(p.path);
  writeProjectSettings({ projectDir: p.path }, { 'memory.team': true });
  assert.equal(teamMemoryAvailability(p.key).offer, false);
  assert.equal((await teamMemoryStatus(p.key)).available.offer, false);
});
