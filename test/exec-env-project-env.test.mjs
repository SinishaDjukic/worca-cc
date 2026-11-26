// test/exec-env-project-env.test.mjs — a project's environment spec: the schema and hash, and the record in Worca's DB.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { normalizeEnvSpec, envSpecHash, EnvSpecError, ENV_SPEC_VERSION } from '../src/core/exec-env/env-spec.mjs';
import { readProjectExecEnv, updateProjectExecEnv } from '../src/core/config.mjs';
import { setProjectEnvSpec, clearProjectEnvSpec } from '../src/core/exec-env/project-env.mjs';

useTempHome(after, 'worca-envspec-home-');
let n = 0; const key = () => `proj-${(0x10000000 + ++n).toString(16)}`;

test('spec: canonical order and hash; the same tools hash the same', () => {
  const a = normalizeEnvSpec({ tools: [{ name: 'pipx:black', version: '26.10.1' }, { name: 'node', version: '24.21.0' }], apt: ['zlib1g-dev', 'libpq-dev', 'libpq-dev'] });
  assert.deepEqual(a.tools.map((t) => t.name), ['node', 'pipx:black']);
  assert.deepEqual(a.apt, ['libpq-dev', 'zlib1g-dev']);
  assert.equal(a.version, ENV_SPEC_VERSION);
  assert.match(a.hash, /^sha256:[0-9a-f]{64}$/);
  const b = normalizeEnvSpec({ apt: ['zlib1g-dev', 'libpq-dev'], tools: [{ version: '24.21.0', name: 'node' }, { name: 'pipx:black', version: '26.10.1' }], hash: 'stale', updatedAt: 'x' });
  assert.equal(b.hash, a.hash);
  assert.notEqual(normalizeEnvSpec({ tools: [{ name: 'node', version: '24.22.0' }] }).hash, normalizeEnvSpec({ tools: [{ name: 'node', version: '24.21.0' }] }).hash);
  assert.equal(envSpecHash({}), normalizeEnvSpec({}).hash);
});

test('spec: tools only — no secrets, files, env, unpinned or shell-unsafe values', () => {
  for (const [input, re] of [
    [{ env: { TOKEN: 'x' } }, /unknown key "env"/],
    [{ tools: [{ name: 'node', version: 'latest' }] }, /must be pinned/],
    [{ tools: [{ name: 'node' }] }, /must be pinned/],
    [{ tools: [{ name: 'node; rm -rf /', version: '1' }] }, /not a mise tool name/],
    [{ tools: [{ name: 'node', version: '1', url: 'x' }] }, /unknown key "url"/],
    [{ tools: [{ name: 'node', version: '1' }, { name: 'node', version: '2' }] }, /listed twice/],
    [{ apt: ['libpq-dev && curl x'] }, /not a Debian package name/],
    [{ version: 2 }, /version must be 1/],
    [{ tools: 'node' }, /tools must be an array/],
    [{ apt: 'curl' }, /apt must be an array/],
    [[], /JSON object/],
    [null, /JSON object/],
  ]) assert.throws(() => normalizeEnvSpec(input), (e) => e instanceof EnvSpecError && e.code === 'EXEC_ENV_SPEC_INVALID' && re.test(e.message), JSON.stringify(input));
});

test('spec: mise names such as npm:, pipx: and github: pass', () => {
  const s = normalizeEnvSpec({ tools: [{ name: 'npm:prettier', version: '3.9.10' }, { name: 'github:cli/cli', version: '2.60.0' }] });
  assert.deepEqual(s.tools.map((t) => t.name), ['github:cli/cli', 'npm:prettier']);
});

test('record: the spec lives in Worca DB under the project, in the execEnvProject record; clear removes it', () => {
  const k = key();
  assert.deepEqual(readProjectExecEnv(k), { config: {}, spec: null, builds: {} });
  const spec = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.21.0' }], apt: ['libpq-dev'] }, { now: new Date('2026-11-26T10:00:00Z') });
  assert.equal(spec.updatedAt, '2026-11-26T10:00:00.000Z');
  assert.deepEqual(readProjectExecEnv(k).spec, spec);
  const again = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.22.0' }] });
  assert.notEqual(again.hash, spec.hash);
  assert.equal(readProjectExecEnv(k).spec.hash, again.hash);
  clearProjectEnvSpec(k);
  assert.equal(readProjectExecEnv(k).spec, null);
});

test('record: a bad spec is refused and leaves the stored one alone; other projects are untouched', () => {
  const k = key(); const other = key();
  const spec = setProjectEnvSpec(k, { tools: [{ name: 'node', version: '24.21.0' }] });
  setProjectEnvSpec(other, { apt: ['curl'] });
  assert.throws(() => setProjectEnvSpec(k, { tools: [{ name: 'node', version: 'latest' }] }), EnvSpecError);
  assert.equal(readProjectExecEnv(k).spec.hash, spec.hash);
  assert.deepEqual(readProjectExecEnv(other).spec.apt, ['curl']);
});

test('record: the spec shares its record with fields later releases add, and keeps them', () => {
  const k = key();
  updateProjectExecEnv(k, (rec) => { rec.config.e2b = { template: 'mine' }; rec.builds.e2b = { name: 'x' }; });
  const spec = setProjectEnvSpec(k, {});
  assert.deepEqual(readProjectExecEnv(k), { config: { e2b: { template: 'mine' } }, spec, builds: { e2b: { name: 'x' } } });
  clearProjectEnvSpec(k);
  assert.deepEqual(readProjectExecEnv(k), { config: { e2b: { template: 'mine' } }, spec: null, builds: { e2b: { name: 'x' } } });
});

test('record: an invalid project key is refused loudly', () => {
  assert.throws(() => readProjectExecEnv('not a key'));
  assert.throws(() => setProjectEnvSpec('not a key', {}));
});
