// test/desktop-instance.test.mjs — how the desktop app finds the worca store and a server already running on it
// (desktop/src/instance.mjs). resolveStoreDir must equal worcaHome() (it cannot import it: node:sqlite in Electron main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { worcaHome } from '../src/core/projects.mjs';
import { resolveStoreDir, readUiInstanceFile, probeUrl, findRunningServer, setupSingleInstance, shouldStartHidden } from '../desktop/src/instance.mjs';

test('resolveStoreDir equals worcaHome(): WORCA_HOME set; settings root with WORCA_HOME unset; neither', () => {
  const keys = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const home = mkdtempSync(join(tmpdir(), 'desk-home-'));
  const store = mkdtempSync(join(tmpdir(), 'desk-store-'));
  const root = mkdtempSync(join(tmpdir(), 'desk-root-'));
  try {
    process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
    const fixtures = [
      () => { process.env.WORCA_HOME = store; },
      () => { delete process.env.WORCA_HOME; mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ root })); },
      () => { delete process.env.WORCA_HOME; rmSync(join(home, '.worca-cc'), { recursive: true, force: true }); },
    ];
    const got = [];
    for (const setup of fixtures) {
      setup();
      const mine = resolveStoreDir({ env: { ...process.env }, home: '/not-used', readFile: readFileSync });
      assert.equal(mine, worcaHome());
      got.push(mine);
    }
    assert.deepEqual(got, [join(store, '.worca-cc'), join(root, '.worca-cc'), join(home, '.worca-cc')]);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    for (const d of [home, store, root]) rmSync(d, { recursive: true, force: true });
  }
});

test('resolveStoreDir: blank WORCA_HOME and a corrupt or blank settings root fall through; USERPROFILE, then home', () => {
  const files = { '/h/.worca-cc/settings.json': '{bad' };
  const readFile = (p) => { if (p in files) return files[p]; throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
  assert.equal(resolveStoreDir({ env: { HOME: '/h', WORCA_HOME: '  ' }, home: '/x', readFile }), join('/h', '.worca-cc'));
  files['/h/.worca-cc/settings.json'] = JSON.stringify({ root: '   ' });
  assert.equal(resolveStoreDir({ env: { HOME: '/h' }, home: '/x', readFile }), join('/h', '.worca-cc'));
  assert.equal(resolveStoreDir({ env: { USERPROFILE: '/u' }, home: '/x', readFile }), join('/u', '.worca-cc'));
  assert.equal(resolveStoreDir({ env: {}, home: '/x', readFile }), join('/x', '.worca-cc'));
});

test('readUiInstanceFile: missing, corrupt, bad port or pid → null; a good file → its fields', () => {
  const files = {};
  const readFile = (p) => { if (p in files) return files[p]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  const f = join('/s', 'ui.json');
  assert.equal(readUiInstanceFile('/s', { readFile }), null);
  files[f] = '{not json';
  assert.equal(readUiInstanceFile('/s', { readFile }), null);
  files[f] = JSON.stringify({ pid: 5, host: '127.0.0.1', port: 'x', token: 't' });
  assert.equal(readUiInstanceFile('/s', { readFile }), null);
  files[f] = JSON.stringify({ pid: 5.5, host: '127.0.0.1', port: 4317, token: 't' });
  assert.equal(readUiInstanceFile('/s', { readFile }), null);
  files[f] = JSON.stringify({ pid: 5, host: '127.0.0.1', port: 4317, token: 't', version: '1' });
  assert.deepEqual(readUiInstanceFile('/s', { readFile }), { pid: 5, host: '127.0.0.1', port: 4317, token: 't' });
});

test('probeUrl: wildcard or empty host → 127.0.0.1; ::1 / localhost → localhost; other hosts kept (IPv6 bracketed)', () => {
  for (const h of ['0.0.0.0', '::', '', undefined]) assert.equal(probeUrl(h, 4317), 'http://127.0.0.1:4317');
  assert.equal(probeUrl('::1', 9), 'http://localhost:9');
  assert.equal(probeUrl('localhost', 9), 'http://localhost:9');
  assert.equal(probeUrl('127.0.0.1', 9), 'http://127.0.0.1:9');
  assert.equal(probeUrl('fe80::1', 9), 'http://[fe80::1]:9');
});

function rig({ file = null, health = {} } = {}) {
  const st = { file, probes: [], reads: 0, sleeps: 0 };
  const readFile = () => { st.reads++; if (st.file === null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return JSON.stringify(st.file); };
  const probe = async (url) => { st.probes.push(url); return health[url] ?? null; };
  const sleep = async () => { st.sleeps++; if (st.onSleep) st.onSleep(st.sleeps); };
  return { st, readFile, probe, sleep };
}
const worca = (pid) => ({ name: '@worca/app', version: '1', pid, port: 4317 });

test('findRunningServer: ui.json + health with the same pid → reused, owned false', async () => {
  const { st, readFile, probe, sleep } = rig({ file: { pid: 7, host: '0.0.0.0', port: 5000, token: 't' }, health: { 'http://127.0.0.1:5000': worca(7) } });
  assert.deepEqual(await findRunningServer({ storeDir: '/s', probe, readFile, sleep }), { url: 'http://127.0.0.1:5000', port: 5000, pid: 7, owned: false });
  assert.deepEqual(st.probes, ['http://127.0.0.1:5000']);
});

test('findRunningServer: file pid ≠ health pid → falls to the 4317 probe', async () => {
  const { st, readFile, probe, sleep } = rig({ file: { pid: 7, host: '127.0.0.1', port: 5000, token: 't' }, health: { 'http://127.0.0.1:5000': worca(8) } });
  assert.equal(await findRunningServer({ storeDir: '/s', probe, readFile, sleep, raceWaitMs: 1000 }), null);
  assert.deepEqual(st.probes, ['http://127.0.0.1:5000', 'http://127.0.0.1:4317']);
});

test('findRunningServer: a worca on 4317 whose ui.json appears on the 2nd poll → reused (the write race)', async () => {
  const { st, readFile, probe, sleep } = rig({ health: { 'http://127.0.0.1:4317': worca(9) } });
  st.onSleep = (n) => { if (n === 2) st.file = { pid: 9, host: '127.0.0.1', port: 4317, token: 't' }; };
  assert.deepEqual(await findRunningServer({ storeDir: '/s', probe, readFile, sleep, raceWaitMs: 3000 }), { url: 'http://127.0.0.1:4317', port: 4317, pid: 9, owned: false });
  assert.equal(st.sleeps, 2);
});

test('findRunningServer: a worca on 4317 with no ui.json within raceWaitMs → null (another store)', async () => {
  const { st, readFile, probe, sleep } = rig({ health: { 'http://127.0.0.1:4317': worca(9) } });
  assert.equal(await findRunningServer({ storeDir: '/s', probe, readFile, sleep, raceWaitMs: 1000 }), null);
  assert.equal(st.sleeps, 4, 'polled every 250 ms for 1 s');
});

test('findRunningServer: nothing listening → null, no waiting', async () => {
  const { st, readFile, probe, sleep } = rig();
  assert.equal(await findRunningServer({ storeDir: '/s', probe, readFile, sleep }), null);
  assert.equal(st.sleeps, 0);
});

test('setupSingleInstance: lock refused → quit and false; granted → second-instance handler and true', () => {
  const app = new EventEmitter();
  let quits = 0;
  app.quit = () => { quits++; };
  app.requestSingleInstanceLock = () => false;
  assert.equal(setupSingleInstance(app, { onSecondInstance: () => {} }), false);
  assert.equal(quits, 1);
  assert.equal(app.listenerCount('second-instance'), 0);
  app.requestSingleInstanceLock = () => true;
  let shown = 0;
  assert.equal(setupSingleInstance(app, { onSecondInstance: () => { shown++; } }), true);
  app.emit('second-instance');
  assert.equal(shown, 1);
  assert.equal(quits, 1);
});

test('shouldStartHidden: darwin wasOpenedAtLogin, win32 --hidden, linux never', () => {
  assert.equal(shouldStartHidden({ platform: 'darwin', argv: [], loginItem: { wasOpenedAtLogin: true } }), true);
  assert.equal(shouldStartHidden({ platform: 'darwin', argv: ['--hidden'], loginItem: { wasOpenedAtLogin: false } }), false);
  assert.equal(shouldStartHidden({ platform: 'darwin', argv: [], loginItem: undefined }), false);
  assert.equal(shouldStartHidden({ platform: 'win32', argv: ['Worca.exe', '--hidden'] }), true);
  assert.equal(shouldStartHidden({ platform: 'win32', argv: ['Worca.exe'] }), false);
  assert.equal(shouldStartHidden({ platform: 'linux', argv: ['--hidden'], loginItem: { wasOpenedAtLogin: true } }), false);
});
