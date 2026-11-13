// test/update-eligibility.test.mjs
// Who may update Worca from the app (issue #841): shared installs, source builds, the `worca ui`
// supervisor, the npm global folder, mock mode and the dry run. No real npm: exec is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectDeployment } from '../src/core/deployment.mjs';
import { EventEmitter } from 'node:events';
import { isSharedInstall, updateEligibility, probeNpmGlobal, UPDATE_MESSAGES, ignoreClosedDesktopOutput } from '../src/core/update-eligibility.mjs';

const okNpm = { root: '/g/lib/node_modules', underRoot: true, writable: true, unwritable: [] };
const base = { deployment: 'local', env: {}, sourceBuild: false, supervised: true, npm: okNpm, mock: false };

test('shared: hosted, container (WORCA_CONTAINER / WORCA_DATA_DIR), WORCA_IDENTITY_HEADER → refused as shared', () => {
  const cases = [
    { deployment: detectDeployment({}, { remoteMode: true }), env: {} },
    { deployment: detectDeployment({ WORCA_CONTAINER: '1' }, { remoteMode: false }), env: {} },
    { deployment: detectDeployment({ WORCA_DATA_DIR: '/data' }, { remoteMode: false }), env: {} },
    { deployment: 'local', env: { WORCA_IDENTITY_HEADER: 'X-Forwarded-User' } },
  ];
  for (const c of cases) {
    assert.equal(isSharedInstall(c), true, JSON.stringify(c));
    const e = updateEligibility({ ...base, ...c });
    assert.deepEqual([e.canUpdate, e.reason, e.message], [false, 'shared', UPDATE_MESSAGES.shared]);
  }
});

test('WORCA_IDENTITY_NAME alone is a local operator, not shared; a blank identity header is not shared', () => {
  assert.equal(isSharedInstall({ deployment: 'local', env: { WORCA_IDENTITY_NAME: 'Ada' } }), false);
  assert.equal(isSharedInstall({ deployment: 'local', env: { WORCA_IDENTITY_HEADER: '  ' } }), false);
  assert.equal(updateEligibility({ ...base, env: { WORCA_IDENTITY_NAME: 'Ada' } }).canUpdate, true);
});

test('decision 5 reasons, in priority order', () => {
  assert.equal(updateEligibility({ ...base, sourceBuild: true }).reason, 'source');
  assert.equal(updateEligibility({ ...base, supervised: false }).reason, 'not-supervised');
  assert.equal(updateEligibility({ ...base, mock: true }).reason, 'mock');
  assert.equal(updateEligibility({ ...base, npm: null }).reason, 'npm-missing');
  assert.equal(updateEligibility({ ...base, npm: { ...okNpm, underRoot: false } }).reason, 'not-npm-global');
  const nw = updateEligibility({ ...base, npm: { ...okNpm, writable: false, unwritable: ['/g/lib/node_modules'] } });
  assert.equal(nw.reason, 'not-writable');
  assert.match(nw.message, /\/g\/lib\/node_modules/);
  assert.deepEqual(updateEligibility(base), { canUpdate: true, reason: null, message: '', dryRun: false });
});

test('dry run skips the npm checks but never the shared / source / supervisor checks', () => {
  const env = { WORCA_UPDATE_DRY_RUN: '1' };
  assert.equal(updateEligibility({ ...base, env, npm: null, mock: true }).canUpdate, true);
  assert.equal(updateEligibility({ ...base, env: { ...env, WORCA_IDENTITY_HEADER: 'x' } }).reason, 'shared');
  assert.equal(updateEligibility({ ...base, env, supervised: false }).reason, 'not-supervised');
});

test('probeNpmGlobal: under npm root -g and writable; pnpm/volta/npx path is not; read-only root is not writable', async (t) => {
  const g = mkdtempSync(join(tmpdir(), 'npmg-'));
  const root = join(g, 'lib', 'node_modules'); const pkg = join(root, '@worca', 'app'); const bin = join(g, 'bin');
  mkdirSync(pkg, { recursive: true }); mkdirSync(bin);
  const exec = async (cmd, args) => ({ stdout: args[0] === 'root' ? `${root}\n` : `${g}\n` });
  const p = await probeNpmGlobal({ packageRoot: pkg, exec, platform: 'linux' });
  assert.deepEqual([p.underRoot, p.writable], [true, true]);
  const other = await probeNpmGlobal({ packageRoot: join(g, '.volta', 'x'), exec, platform: 'linux' });
  assert.equal(other.underRoot, false);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    chmodSync(root, 0o555); t.after(() => chmodSync(root, 0o755));
    const ro = await probeNpmGlobal({ packageRoot: pkg, exec, platform: 'linux' });
    assert.equal(ro.writable, false);
  }
  const none = await probeNpmGlobal({ packageRoot: pkg, exec: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); }, platform: 'linux' });
  assert.equal(none.root, null);
});

test('WORCA_DESKTOP=1 refuses with reason desktop; unset/blank/0 changes nothing; precedence', () => {
  const desk = { WORCA_DESKTOP: '1' };
  assert.deepEqual(updateEligibility({ ...base, env: desk }), { canUpdate: false, reason: 'desktop', message: UPDATE_MESSAGES.desktop, dryRun: false });
  assert.match(UPDATE_MESSAGES.desktop, /desktop app.*newer build/);
  const fixtures = [
    {}, { sourceBuild: true }, { supervised: false }, { mock: true }, { npm: null },
    { npm: { ...okNpm, underRoot: false } }, { npm: { ...okNpm, writable: false, unwritable: ['/g'] } },
    { deployment: 'container' },
  ];
  for (const flag of [undefined, '', '0']) {
    for (const f of fixtures) {
      const env = flag === undefined ? {} : { WORCA_DESKTOP: flag };
      assert.deepEqual(updateEligibility({ ...base, ...f, env }), updateEligibility({ ...base, ...f, env: {} }), `${flag} ${JSON.stringify(f)}`);
    }
  }
  assert.deepEqual(updateEligibility(base), { canUpdate: true, reason: null, message: '', dryRun: false });
  assert.equal(updateEligibility({ ...base, deployment: 'container', env: desk }).reason, 'shared');
  assert.equal(updateEligibility({ ...base, sourceBuild: true, env: desk }).reason, 'source');
  assert.equal(updateEligibility({ ...base, supervised: false, env: desk }).reason, 'desktop');
  assert.equal(updateEligibility({ ...base, env: { ...desk, WORCA_UPDATE_DRY_RUN: '1' } }).reason, 'desktop', 'dry run never overrides desktop');
});

test('ignoreClosedDesktopOutput: desktop server swallows EPIPE / ERR_STREAM_DESTROYED on stdout and stderr; other errors still throw; web servers get no listener', () => {
  const streams = () => [new EventEmitter(), new EventEmitter()];
  const web = streams();
  assert.equal(ignoreClosedDesktopOutput({ env: {}, streams: web }), false);
  for (const s of web) assert.equal(s.listenerCount('error'), 0, 'web behaviour unchanged');
  const off = streams();
  assert.equal(ignoreClosedDesktopOutput({ env: { WORCA_DESKTOP: '0' }, streams: off }), false);
  for (const s of off) assert.equal(s.listenerCount('error'), 0);
  const desk = streams();
  assert.equal(ignoreClosedDesktopOutput({ env: { WORCA_DESKTOP: '1' }, streams: desk }), true);
  for (const s of desk) {
    assert.equal(s.listenerCount('error'), 1);
    s.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    s.emit('error', Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' }));
    assert.throws(() => s.emit('error', Object.assign(new Error('disk'), { code: 'EIO' })), /disk/);
  }
});
