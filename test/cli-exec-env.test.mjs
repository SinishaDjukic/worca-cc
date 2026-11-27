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
const run = async (argv, extra = {}) => {
  const out = []; const errs = [];
  const code = await cmdExecEnv(argv, { out: (s) => out.push(s), fail: (s) => errs.push(s), ...extra });
  return { code, out, errs };
};

test('help lists the verbs; an unknown verb is refused', async () => {
  const help = (await run([])).out[0];
  assert.match(help, /worca exec-env spec --project <key\|dir> \[--set <file\.json> \| --clear\] \[--json\]/);
  assert.match(help, /worca exec-env build --project <key\|dir>/);
  const r = await run(['bogus']);
  assert.equal(r.code, 1); assert.match(r.errs[0], /unknown exec-env command: bogus/);
});
test('list names local, e2b and docker', async () => {
  const r = await run(['list']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.map((l) => l.split(/\s+/)[0]), ['local', 'e2b', 'docker']);
});
test('spec shows nothing before a spec is set', async () => {
  const r = await run(['spec', '--project', KEY]);
  assert.equal(r.code, 0); assert.equal(r.out[0], 'no environment spec');
  assert.equal(JSON.parse((await run(['spec', '--project', KEY, '--json'])).out[0]), null);
});
test('spec --set stores the normalized spec; show prints it, as text and as JSON; a directory names the project too', async () => {
  writeFileSync(specFile, JSON.stringify({ tools: [{ name: 'node', version: '24.21.0' }], apt: ['libpq-dev'] }));
  let r = await run(['spec', '--project', KEY, '--set', specFile]);
  assert.equal(r.code, 0);
  assert.match(r.out.at(-1), /spec saved: 1 tools, 1 apt packages \(sha256:/);
  r = await run(['spec', '--project', repo]);
  assert.match(r.out[0], /node 24\.21\.0/); assert.match(r.out[0], /libpq-dev/);
  r = await run(['spec', '--project', KEY, '--json']);
  assert.equal(JSON.parse(r.out[0]).tools[0].name, 'node');
  assert.deepEqual(JSON.parse(r.out[0]), readProjectExecEnv(KEY).spec);
});
test('specs lists every project with a spec, with it (what `worca container build` reads inside the hardened box)', async () => {
  const r = await run(['specs', '--json']);
  assert.equal(r.code, 0);
  const list = JSON.parse(r.out[0]);
  assert.deepEqual(list.map((p) => [p.key, p.name]), [[KEY, 'cli-execenv']]);
  assert.deepEqual(list[0].spec, readProjectExecEnv(KEY).spec);
  assert.match((await run(['specs'])).out[0], /^cli-execenv\s+\S+\s+1 tools, 1 apt packages \(sha256:/);
});
test('status shows the stored spec (this shell\'s view when no server runs)', async () => {
  const r = await run(['status', '--project', repo], { call: async () => null });
  assert.equal(r.code, 0, 'a directory names the project too');
  assert.equal(JSON.parse(r.out.at(-1)).spec.tools[0].name, 'node');
});
test('spec --set with a bad file fails with the reason and keeps the stored spec', async () => {
  const before = readProjectExecEnv(KEY).spec;
  writeFileSync(specFile, JSON.stringify({ tools: [{ name: 'node', version: 'latest' }] }));
  let r = await run(['spec', '--project', KEY, '--set', specFile]);
  assert.equal(r.code, 1); assert.match(r.errs[0], /must be pinned/);
  writeFileSync(specFile, '{ not json');
  r = await run(['spec', '--project', KEY, '--set', specFile]);
  assert.equal(r.code, 1);
  r = await run(['spec', '--project', KEY, '--set', join(scratch, 'missing.json')]);
  assert.equal(r.code, 1);
  assert.deepEqual(readProjectExecEnv(KEY).spec, before);
});
test('status shows the running server\'s view (its E2B env decides the template); with no server, this shell\'s', async () => {
  const calls = [];
  const view = { projectKey: KEY, spec: null, backends: [{ name: 'e2b', elsewhere: null }] };
  const call = async (path, o = {}) => { calls.push([o.method || 'GET', path]); return { ok: true, status: 200, data: view }; };
  let r = await run(['status', '--project', KEY], { call });
  assert.equal(r.code, 0);
  assert.deepEqual(calls, [['GET', `/api/projects/${KEY}/exec-env`]]);
  assert.deepEqual(JSON.parse(r.out.at(-1)), view); assert.deepEqual(r.errs, []);
  for (const none of [async () => null, async () => ({ ok: false, status: 401, data: { error: 'sign in' } })]) {
    r = await run(['status', '--project', KEY], { call: none });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out.at(-1)).projectKey, KEY);
    assert.match(r.errs[0], /computed in this shell/);
  }
});
test('spec --clear removes it; --set with --clear, a missing --project and an unknown option are refused', async () => {
  let r = await run(['spec', '--project', KEY, '--clear']);
  assert.equal(r.code, 0); assert.equal(r.out[0], 'spec cleared');
  assert.equal(readProjectExecEnv(KEY).spec, null);
  r = await run(['spec', '--project', KEY, '--set', specFile, '--clear']);
  assert.equal(r.code, 2); assert.match(r.errs[0], /exclude each other/);
  r = await run(['spec']);
  assert.equal(r.code, 2); assert.match(r.errs[0], /--project <key\|dir> is required/);
  r = await run(['spec', '--project']);
  assert.equal(r.code, 2); assert.match(r.errs[0], /--project needs a value/);
  r = await run(['spec', '--project', KEY, '--bogus']);
  assert.equal(r.code, 2); assert.match(r.errs[0], /unknown option --bogus/);
});
test('spec on an unregistered directory is refused and writes nothing', async () => {
  const other = gitDir('cli-execenv-other');
  writeFileSync(specFile, JSON.stringify({ tools: [] }));
  const r = await run(['spec', '--project', other, '--set', specFile]);
  assert.equal(r.code, 1); assert.match(r.errs[0], /is not a registered project/);
  assert.equal(readProjectExecEnv(projectKey(other)).spec, null);
});
test('build never builds in the CLI process: with no server it fails and says why', async () => {
  const r = await run(['build', '--project', KEY], { call: async () => null });
  assert.equal(r.code, 1); assert.match(r.errs[0], /run only in the server process/);
});
test('build follows the server job log to the end', async () => {
  const calls = []; let polls = 0;
  const call = async (path, o = {}) => {
    calls.push([o.method || 'GET', path]);
    if (o.method === 'POST') return { ok: true, status: 202, data: { job: { id: 'envb_1', name: 'worca-agent-x', state: 'running' } } };
    polls += 1;
    return { ok: true, status: 200, data: polls === 1 ? { lines: ['step 1'], next: 1, job: { state: 'running' } } : { lines: ['built'], next: 2, job: { state: 'done' } } };
  };
  const r = await run(['build', '--project', KEY], { call, sleep: async () => {} });
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.slice(1), ['step 1', 'built']);
  assert.deepEqual(calls[0], ['POST', `/api/projects/${KEY}/exec-env/build`]);
  assert.equal(calls[2][1], '/api/exec-env/builds/envb_1?since=1');
});
