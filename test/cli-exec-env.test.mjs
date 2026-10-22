// test/cli-exec-env.test.mjs — `worca exec-env` (src/cli/exec-env.mjs): the spec is stored in this process, a build
// never runs here (it asks the running server over HTTP and follows its log), unregistered dirs are refused.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { cmdExecEnv } from '../src/cli/exec-env.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readProjectExecEnv } from '../src/core/config.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cli-execenv-')); after(() => rmSync(scratch, { recursive: true, force: true }));
const specFile = join(scratch, 'spec.json');
const repo = gitDir('cli-execenv');
const KEY = projectKey(repo);
before(async () => { await addProject({ name: 'cli-execenv', path: repo }); });

test('list names local and e2b', async () => {
  const out = [];
  assert.equal(await cmdExecEnv(['list'], { out: (s) => out.push(s), fail: () => {} }), 0);
  assert.deepEqual(out.map((l) => l.split(/\s+/)[0]), ['local', 'e2b']);
});
test('spec --set stores the normalized spec; status shows it; a bad file fails with the reason', async () => {
  const out = []; const errs = [];
  const io = { out: (s) => out.push(s), fail: (s) => errs.push(s) };
  writeFileSync(specFile, JSON.stringify({ tools: [{ name: 'node', version: '24.21.0' }] }));
  assert.equal(await cmdExecEnv(['spec', '--project', KEY, '--set', specFile], io), 0);
  assert.match(out.at(-1), /spec saved: 1 tools, 0 apt packages \(sha256:/);
  assert.equal(await cmdExecEnv(['status', '--project', repo], io), 0, 'a directory names the project too');
  assert.equal(JSON.parse(out.at(-1)).spec.tools[0].name, 'node');
  writeFileSync(specFile, JSON.stringify({ tools: [{ name: 'node', version: 'latest' }] }));
  assert.equal(await cmdExecEnv(['spec', '--project', KEY, '--set', specFile], io), 1);
  assert.match(errs.at(-1), /must be pinned/);
});
test('status shows the running server\'s view (its E2B env decides the template); with no server, this shell\'s', async () => {
  const out = []; const errs = []; const calls = [];
  const io = { out: (s) => out.push(s), fail: (s) => errs.push(s) };
  const view = { projectKey: KEY, spec: null, backends: [{ name: 'e2b', elsewhere: null }] };
  const call = async (path, o = {}) => { calls.push([o.method || 'GET', path]); return { ok: true, status: 200, data: view }; };
  assert.equal(await cmdExecEnv(['status', '--project', KEY], { ...io, call }), 0);
  assert.deepEqual(calls, [['GET', `/api/projects/${KEY}/exec-env`]]);
  assert.deepEqual(JSON.parse(out.at(-1)), view); assert.deepEqual(errs, []);
  for (const none of [async () => null, async () => ({ ok: false, status: 401, data: { error: 'sign in' } })]) {
    errs.length = 0;
    assert.equal(await cmdExecEnv(['status', '--project', KEY], { ...io, call: none }), 0);
    assert.equal(JSON.parse(out.at(-1)).projectKey, KEY);
    assert.match(errs[0], /computed in this shell/);
  }
});
test('spec on an unregistered directory is refused and writes nothing', async () => {
  const other = gitDir('cli-execenv-other');
  const errs = [];
  writeFileSync(specFile, JSON.stringify({ tools: [] }));
  assert.equal(await cmdExecEnv(['spec', '--project', other, '--set', specFile], { out: () => {}, fail: (s) => errs.push(s) }), 1);
  assert.match(errs[0], /is not a registered project/);
  assert.equal(readProjectExecEnv(projectKey(other)).spec, null);
});
test('build never builds in the CLI process: with no server it fails and says why', async () => {
  const errs = [];
  const code = await cmdExecEnv(['build', '--project', KEY], { out: () => {}, fail: (s) => errs.push(s), call: async () => null });
  assert.equal(code, 1); assert.match(errs[0], /run only in the server process/);
});
test('build follows the server job log to the end', async () => {
  const calls = []; let polls = 0;
  const call = async (path, o = {}) => {
    calls.push([o.method || 'GET', path]);
    if (o.method === 'POST') return { ok: true, status: 202, data: { job: { id: 'envb_1', name: 'worca-agent-x', state: 'running' } } };
    polls += 1;
    return { ok: true, status: 200, data: polls === 1 ? { lines: ['step 1'], next: 1, job: { state: 'running' } } : { lines: ['built'], next: 2, job: { state: 'done' } } };
  };
  const out = [];
  assert.equal(await cmdExecEnv(['build', '--project', KEY], { out: (s) => out.push(s), fail: () => {}, call, sleep: async () => {} }), 0);
  assert.deepEqual(out.slice(1), ['step 1', 'built']);
  assert.deepEqual(calls[0], ['POST', `/api/projects/${KEY}/exec-env/build`]);
  assert.equal(calls[2][1], '/api/exec-env/builds/envb_1?since=1');
});
