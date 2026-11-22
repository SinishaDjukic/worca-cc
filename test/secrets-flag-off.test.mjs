// test/secrets-flag-off.test.mjs — with the secretVault flag off, nothing differs from no flag at all: same bytes,
// same modes, same stdout, no vault file, no OS-store call, no fake imported. Plus the harness's own positive control.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runFlagOffPair, snapshotTree, diffTrees } from './helpers/flag-off.mjs';
import { importClosure } from './helpers/import-closure.mjs';
import { ntHash } from '../src/core/ntlm.mjs';

const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5 }); });
const CHILD = 'test/fixtures/secrets/vault-child.mjs';

test('flag off: CLI help and the settings scenario are byte- and mode-identical, with no vault and no fake', () => {
  const r = runFlagOffPair({ steps: [{ args: ['src/cli/worca-cc.mjs', 'help'] }, { args: [CHILD, 'scenario'] }] });
  roots.push(r.root);
  for (const side of [r.baseline, r.flagOff]) for (const run of side.runs) assert.equal(run.status, 0, `${run.args.join(' ')}: ${run.stderr}`);
  assert.deepEqual(r.diff, []);
  assert.deepEqual(r.vaultFiles, []);
  assert.equal(r.fakeCalls, 0);
  assert.deepEqual(r.forbiddenHits, []);
  assert.deepEqual(r.flagOff.stdout, r.baseline.stdout);
  assert.equal(r.flagOff.stdout[1].trim(), 'vault: null');
  // The scenario wrote settings, so the comparison covered real file writes.
  assert.ok(r.baseline.tree.has('home/.worca-cc/settings.json'));
  // The recorder saw the child's modules.
  assert.ok(r.flagOff.imports.some((u) => u.includes('src/core/secrets/vault.mjs')));
});

test('harness self-check: a planted put that ignores the flag is reported everywhere', () => {
  const r = runFlagOffPair({ steps: [{ args: [CHILD, 'probe-store'] }] });
  roots.push(r.root);
  assert.ok(r.vaultFiles.some((p) => p.startsWith('flag-off/') && p.endsWith('/.worca-cc/worca-vault.enc')), JSON.stringify(r.vaultFiles));
  assert.ok(r.fakeCalls > 0);
  assert.ok(r.forbiddenHits.some((h) => h.module === 'test/helpers/os-store-fake.mjs'));
  assert.ok(r.diff.some((d) => d.kind === 'extra' && d.path.endsWith('worca-vault.enc')), JSON.stringify(r.diff));
  assert.notDeepEqual(r.flagOff.stdout, r.baseline.stdout);
});

test('diffTrees reports missing, extra, bytes and mode', () => {
  const a = new Map([['x', { sha256: '1', mode: 0o600 }], ['y', { sha256: '2', mode: 0o600 }], ['z', { sha256: '3', mode: 0o600 }]]);
  const b = new Map([['x', { sha256: '1', mode: 0o644 }], ['y', { sha256: '9', mode: 0o600 }], ['w', { sha256: null, mode: 0o700 }]]);
  assert.deepEqual(diffTrees(a, b), [{ path: 'w', kind: 'extra' }, { path: 'x', kind: 'mode' }, { path: 'y', kind: 'bytes' }, { path: 'z', kind: 'missing' }]);
  assert.deepEqual(diffTrees(a, a), []);
  assert.equal(snapshotTree(fileURLToPath(new URL('./fixtures/secrets', import.meta.url))).get('vault-child.mjs').mode === null, process.platform === 'win32');
});

test('static: neither the server nor the CLI imports the vault or the OS store', () => {
  for (const entry of ['ui/server.mjs', 'src/cli/worca-cc.mjs']) {
    const { modules } = importClosure(entry);
    assert.ok(modules.length > 10, entry);
    for (const m of ['src/core/secrets/vault.mjs', 'src/core/secrets/os-store.mjs']) assert.ok(!modules.includes(m), `${entry} reaches ${m}`);
  }
});

const FORBIDDEN = [
  '@napi-rs/keyring', 'src/core/secrets/os-store.mjs', 'src/core/secrets/vault.mjs', 'src/core/secrets/status.mjs',
  'src/core/secrets/keyring-backend.mjs', 'src/core/secrets/wsl-dpapi.mjs',
];

test('flag off: worca help and worca secrets status match a flag-absent run, with no store call and no secrets module', () => {
  const r = runFlagOffPair({
    steps: [{ args: ['src/cli/worca-cc.mjs', 'help'] }, { args: ['src/cli/worca-cc.mjs', 'secrets', 'status'] }],
    forbidModules: FORBIDDEN,
  });
  roots.push(r.root);
  for (const side of [r.baseline, r.flagOff]) for (const run of side.runs) assert.equal(run.status, 0, `${run.args.join(' ')}: ${run.stderr}`);
  assert.deepEqual(r.diff, []);
  assert.deepEqual(r.vaultFiles, []);
  assert.equal(r.fakeCalls, 0);
  assert.deepEqual(r.forbiddenHits, []);
  assert.deepEqual(r.flagOff.stdout, r.baseline.stdout);
  assert.equal(r.flagOff.stdout[1], 'Secrets vault: off (the secretVault flag is off)\n');
  assert.ok(r.flagOff.imports.some((u) => u.includes('src/cli/secrets.mjs')), 'the secrets command ran');
});

test('static: the server, the CLI and the status route reach no secrets module and no keyring', () => {
  for (const entry of ['ui/server.mjs', 'src/cli/worca-cc.mjs', 'ui/routes/settings/secrets.mjs']) {
    const { modules, bare } = importClosure(entry);
    for (const m of FORBIDDEN.slice(1)) assert.ok(!modules.includes(m), `${entry} reaches ${m}`);
    assert.ok(!bare.some((b) => b.startsWith('@napi-rs/keyring')), `${entry} imports the keyring`);
  }
  assert.ok(importClosure('ui/server.mjs').modules.includes('ui/routes/settings/secrets.mjs'));
});

test('flag off: saving provider keys, model keys and env credentials matches a flag-absent run', () => {
  const r = runFlagOffPair({
    steps: [{ args: ['test/fixtures/secrets/settings-child.mjs', 'save-settings-keys', '--value', 'sk-flag-off-1234'] }],
    forbidModules: ['src/core/secrets/settings-vault.mjs', 'src/core/secrets/vault.mjs'],
  });
  roots.push(r.root);
  for (const side of [r.baseline, r.flagOff]) for (const run of side.runs) assert.equal(run.status, 0, `${run.args.join(' ')}: ${run.stderr}`);
  assert.deepEqual(r.diff, []);
  assert.equal(r.fakeCalls, 0);
  assert.deepEqual(r.forbiddenHits, []);
  assert.deepEqual(r.vaultFiles, []);
  assert.deepEqual(r.flagOff.stdout, r.baseline.stdout);
  // Positive control: the settings were really written as literal values, and the resolver was loaded.
  assert.ok(r.baseline.tree.has('home/.worca-cc/settings.json'));
  assert.ok(r.flagOff.imports.some((u) => u.includes('src/core/secrets/settings-resolver.mjs')));
});

test('flag off: MCP, plugin and proxy saves and deletes match a flag-absent run', () => {
  const VALUE = 'sk-store-flag-off-5678';
  const r = runFlagOffPair({
    steps: [{ args: ['test/fixtures/secrets/settings-child.mjs', 'save-and-delete-store-secrets', '--value', VALUE] }],
    forbidModules: ['src/core/secrets/store-vault.mjs', 'src/core/secrets/settings-vault.mjs', 'src/core/secrets/vault.mjs',
      'src/core/secrets/os-store.mjs', 'src/core/secrets/keyring-backend.mjs'],
  });
  roots.push(r.root);
  for (const side of [r.baseline, r.flagOff]) for (const run of side.runs) assert.equal(run.status, 0, `${run.args.join(' ')}: ${run.stderr}`);
  assert.deepEqual(r.diff, []);
  assert.deepEqual(r.vaultFiles, []);
  assert.equal(r.fakeCalls, 0);
  assert.deepEqual(r.forbiddenHits, []);
  assert.deepEqual(r.flagOff.stdout, r.baseline.stdout);
  // Positive control: one surviving secret file per store, each holding the plain value (the hex NT hash for the proxy),
  // so the byte comparison covered a record of every store.
  const file = (suffix) => {
    const rel = [...r.baseline.tree.keys()].find((p) => p.endsWith(suffix));
    assert.ok(rel, `${suffix} in ${[...r.baseline.tree.keys()].join(', ')}`);
    return readFileSync(`${r.baseline.dir}/${rel}`, 'utf8');
  };
  assert.ok(file('/mcp/secrets.json').includes(VALUE));
  assert.ok(file('/plugins/vault-a/data/secrets.json').includes(VALUE));
  assert.ok(file('/proxy-login.json').includes(ntHash(VALUE).toString('hex')));
  assert.ok(![...r.baseline.tree.keys()].some((p) => p.includes('/plugins/vault-b')), 'plugin B was purged');
});

test('flag off: seeding literals, the migrate child and worca models list match a flag-absent run, with no migration module', () => {
  const MIGRATION = ['src/core/secrets/migrate.mjs', 'src/core/secrets/crash-point.mjs'];
  const r = runFlagOffPair({
    steps: [{ args: ['test/fixtures/secrets/settings-child.mjs', 'seed-literals'] }, { args: ['test/fixtures/secrets/settings-child.mjs', 'migrate'] },
      { args: ['src/cli/worca-cc.mjs', 'models', 'list'] }],
    forbidModules: [...FORBIDDEN, ...MIGRATION],
  });
  roots.push(r.root);
  for (const side of [r.baseline, r.flagOff]) for (const run of side.runs) assert.equal(run.status, 0, `${run.args.join(' ')}: ${run.stderr}`);
  // `models list` opens the run database: SQLite's WAL and shared-memory files carry random per-connection salts, so
  // their bytes differ between any two runs, flag or not. Every other file must match.
  assert.deepEqual(r.diff.filter((d) => !/\/worca-cc\.db-(wal|shm)$/.test(d.path)), []);
  assert.deepEqual(r.vaultFiles, []);
  assert.equal(r.fakeCalls, 0);
  assert.deepEqual(r.forbiddenHits, []);
  assert.deepEqual(r.flagOff.stdout, r.baseline.stdout);
  assert.equal(r.flagOff.stdout[1].trim(), '{"state":"off"}');
  for (const m of MIGRATION) assert.ok(!r.flagOff.imports.some((u) => u.includes(m)), `${m} was loaded`);
  // Positive control: the literals were really seeded, and they are still literal values.
  const settings = readFileSync(`${r.flagOff.dir}/home/.worca-cc/settings.json`, 'utf8');
  assert.ok(settings.includes('cnry7d3f') && !settings.includes('worca:vault:'));
});
