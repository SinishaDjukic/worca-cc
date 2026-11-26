// test/cli-exec-env.test.mjs — `worca exec-env spec` (src/cli/exec-env.mjs): the spec is stored in this process,
// unregistered directories are refused.
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
const run = async (argv) => {
  const out = []; const errs = [];
  const code = await cmdExecEnv(argv, { out: (s) => out.push(s), fail: (s) => errs.push(s) });
  return { code, out, errs };
};

test('help lists the spec verb; an unknown verb is refused', async () => {
  assert.match((await run([])).out[0], /worca exec-env spec --project <key\|dir>/);
  const r = await run(['build']);
  assert.equal(r.code, 1); assert.match(r.errs[0], /unknown exec-env command: build/);
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
