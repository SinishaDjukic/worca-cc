// test/terminal-context.test.mjs — where a run's terminal opens, and what env it starts with (#573).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { terminalTargets, terminalEnv, LIVE_WARNING } from '../src/core/terminal/context.mjs';
import { NO_PROJECT_KEY, noProjectWorkDir } from '../src/core/store.mjs';
import { createPipeline, newPipelineId, findPipelineRowById } from '../src/core/artifacts.mjs';
import { membersOfRow } from '../src/core/checkout.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'term-ctx-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const projectRow = (extra) => ({ id: 'r1', target: 'project', project_key: 'app-0000aaaa', status: 'running',
  branch: JSON.stringify({ feature: 'worca/f', worktreeDir: dir }), workspace_meta: null, ...extra });

test('a running run opens its live worktree, with the warning', () => {
  const t = terminalTargets(projectRow(), { isLive: () => true });
  assert.equal(t.live, true);
  assert.deepEqual(t.members.map((m) => [m.state, m.cwd, m.branch, m.warning]), [['worktree', dir, 'worca/f', LIVE_WARNING]]);
});

test('a paused run with a folder opens it without the warning; one without a folder is unavailable', () => {
  assert.equal(terminalTargets(projectRow({ status: 'paused' })).members[0].warning, undefined);
  const gone = terminalTargets(projectRow({ status: 'paused', branch: JSON.stringify({ feature: 'f', worktreeDir: join(dir, 'nope') }) }));
  assert.equal(gone.members[0].state, 'unavailable');
});

test('a finished run opens its checkout, or asks for one', () => {
  const kept = projectRow({ status: 'done', branch: JSON.stringify({ feature: 'f', worktreeDir: dir, checkout: { at: 't', by: 'x', policy: 'on-demand' } }) });
  assert.deepEqual(terminalTargets(kept).members.map((m) => [m.state, m.cwd]), [['checkout', dir]]);
  const none = projectRow({ status: 'done', branch: JSON.stringify({ feature: 'f' }) });
  assert.deepEqual(terminalTargets(none).members.map((m) => [m.state, m.cwd]), [['needs-checkout', null]]);
});

test('P3: a run without a project opens its live work/ and never asks for a checkout', () => {
  const work = noProjectWorkDir('abcd1234');
  mkdirSync(work, { recursive: true });
  const np = (extra) => ({ id: 'abcd1234', target: 'project', project_key: NO_PROJECT_KEY, status: 'running',
    branch: JSON.stringify({ workMode: 'none', runRootMode: 'detached' }), workspace_meta: null, ...extra });
  const row = (r) => r.members.map((m) => [m.state, m.cwd, m.projectName, m.warning]);
  assert.deepEqual(row(terminalTargets(np(), { isLive: () => true })), [['worktree', work, 'No project', undefined]], 'live: nothing is committed, so no warning');
  assert.deepEqual(row(terminalTargets(np({ status: 'paused' }))), [['worktree', work, 'No project', undefined]]);
  assert.deepEqual(row(terminalTargets(np({ status: 'done' }))), [['unavailable', null, 'No project', undefined]], 'finished: its files are in Artifacts, never needs-checkout');
  rmSync(work, { recursive: true, force: true });
  assert.equal(terminalTargets(np({ status: 'paused' })).members[0].state, 'unavailable');
});

test('P3: a no-project row\'s member never names the store\'s path (<worcaHome>/runs) as its project folder', async () => {
  const id = newPipelineId();
  await createPipeline(noProjectWorkDir(id), { prompt: 'x', id, projectKey: NO_PROJECT_KEY, workMode: 'none' });
  const [m] = membersOfRow(findPipelineRowById(id));
  assert.deepEqual([m.projectKey, m.projectName, m.projectDir], [NO_PROJECT_KEY, 'No project', null]);
});

test('a workspace run lists one target per member', () => {
  const row = { id: 'w1', target: 'workspace', project_key: null, status: 'running', branch: null,
    workspace_meta: JSON.stringify({ projects: [{ projectKey: 'api-0000bbbb', projectName: 'api', projectDir: '/p/api' }, { projectKey: 'web-0000cccc', projectName: 'web', projectDir: '/p/web' }],
      branches: { 'api-0000bbbb': { feature: 'f', worktreeDir: dir }, 'web-0000cccc': { feature: 'f', worktreeDir: join(dir, 'missing') } } }) };
  const t = terminalTargets(row, { isLive: () => true });
  assert.equal(t.workspace, true);
  assert.deepEqual(t.members.map((m) => [m.projectName, m.state]), [['api', 'worktree'], ['web', 'unavailable']]);
});

test('terminalEnv: run vars, action ports, stripped secrets, pipes extras', () => {
  const env = terminalEnv({
    base: { PATH: '/bin', GH_TOKEN: 'secret', WORCA_HOME: '/h', HOME: '/u', PORT: '4317' }, sessionId: 't-1', mode: 'pipes',
    runId: 'r1', member: 'api-0000bbbb', projectKey: 'api-0000bbbb', branch: 'worca/f', cwd: dir, workspace: true,
    actionSnaps: [{ member: 'api-0000bbbb', actionId: 'dev-server', ports: { PORT: 4401 }, url: 'http://127.0.0.1:4401/' }],
    shellEnv: { BASH_SILENCE_DEPRECATION_WARNING: '1' },
  });
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.WORCA_HOME, undefined);
  assert.equal(env.PORT, undefined, 'worca\'s own port is not passed on');
  assert.equal(env.HOME, '/u');
  assert.equal(env.TERM, 'dumb');
  assert.equal(env.PAGER, 'cat');
  assert.equal(env.WORCA_RUN_ID, 'r1');
  assert.equal(env.WORCA_BRANCH, 'worca/f');
  assert.equal(env.WORCA_TERMINAL_SESSION, 't-1');
  assert.equal(env.WORCA_PORT_API_0000BBBB_DEV_SERVER_PORT, '4401');
  assert.equal(env.WORCA_URL_API_0000BBBB_DEV_SERVER, 'http://127.0.0.1:4401/');
  assert.equal(env.BASH_SILENCE_DEPRECATION_WARNING, '1');
  const single = terminalEnv({ base: {}, sessionId: 't-2', mode: 'pty', cwd: dir, actionSnaps: [{ member: 'x', actionId: 'web', ports: { PORT: 4402 } }] });
  assert.equal(single.WORCA_PORT_WEB_PORT, '4402');
  assert.equal(single.TERM, 'xterm-256color');
  assert.equal(single.PAGER, undefined);
});

test('terminalEnv agent: no pager, no git prompt, no user rc, even under a pty', () => {
  const env = terminalEnv({ base: { PATH: '/bin' }, sessionId: 't-1', mode: 'pty', cwd: '/w', agent: true });
  assert.equal(env.PAGER, 'cat'); assert.equal(env.GIT_PAGER, 'cat');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0'); assert.equal(env.WORCA_TERMINAL_NORC, '1');
  const person = terminalEnv({ base: { PATH: '/bin' }, sessionId: 't-2', mode: 'pty', cwd: '/w' });
  assert.equal(person.PAGER, undefined); assert.equal(person.WORCA_TERMINAL_NORC, undefined);
});

test('P3: a no-project run\'s terminal git never walks up from work/ into a repository that holds worcaHome', () => {
  const cwd = noProjectWorkDir('abcd1234');
  for (const [mode, agent] of [['pty', false], ['pipes', false], ['pipes', true]]) {
    const env = terminalEnv({ base: { PATH: '/bin' }, sessionId: 't-1', mode, agent, runId: 'abcd1234', member: NO_PROJECT_KEY, projectKey: NO_PROJECT_KEY, cwd });
    assert.equal(env.GIT_CEILING_DIRECTORIES, join(cwd, '..'), `${mode}${agent ? ' (Ask)' : ''}`);
  }
  assert.equal(terminalEnv({ base: { PATH: '/bin', GIT_CEILING_DIRECTORIES: '/mnt/slow' }, sessionId: 't-1', mode: 'pty', projectKey: NO_PROJECT_KEY, cwd }).GIT_CEILING_DIRECTORIES,
    [join(cwd, '..'), '/mnt/slow'].join(delimiter), 'the host\'s own ceiling is kept');
  assert.equal('GIT_CEILING_DIRECTORIES' in terminalEnv({ base: { PATH: '/bin' }, sessionId: 't-2', mode: 'pty', projectKey: 'app-0000aaaa', cwd: dir }), false, 'a project\'s terminal is unchanged');
});
