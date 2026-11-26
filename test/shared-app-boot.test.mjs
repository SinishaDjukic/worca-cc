// test/shared-app-boot.test.mjs — the contract of test/helpers/shared-app-boot.mjs, against the real app: one boot of
// ui/public/app.js per test file, a reset before each test that leaves nothing of the previous one, and the refusals.
// Each test passes alone; the "leaves state behind" / "starts clean" pair also pins the beforeEach reset when the
// file runs whole.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { releaseDom } from './helpers/jsdom-release.mjs';
import { applyFlags, currentFlags } from '../ui/public/flags.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';

// Records every interval of this process, wrapped before the helper wraps the same global, so a test can tell the
// app's import-time 1 s tick from one a test started.
const timers = { phase: 'boot', made: [] };
const nativeSetInterval = globalThis.setInterval;
globalThis.setInterval = function (fn, ms, ...rest) {
  const record = { ms, phase: timers.phase, fired: 0 };
  timers.made.push(record);
  return nativeSetInterval.call(this, function (...args) { record.fired++; return fn.apply(this, args); }, ms, ...rest);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reply = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const DEFAULT_BODY = { projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] };
const PROJECTS = { projects: [{ name: 'shared', path: '/tmp/shared', exists: true }] };
const MEDIA = { matches: false, media: 'stub', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
let setupWindow = null;

const app = useSharedApp({ before, beforeEach, after }, {
  url: 'http://localhost:4399/',
  local: { 'shared-boot.local': 'file' },
  session: { 'shared-boot.session': 'file' },
  hooks: { fileHook: 1 },
  flags: { flagsDemo: true },
  level: 'advanced',
  innerWidth: 1234,
  matchMedia: () => MEDIA,
  setup: (window) => { setupWindow = window; },
  resetHash: 'runs',
  fetchHandler: (url) => {
    if (url.endsWith('/api/projects')) return reply(PROJECTS);
    if (url.endsWith('/api/file-only')) return reply({ from: 'file' });
    return undefined;
  },
});

// Registered after the helper's before(), so it sees the app as the boot left it.
let booted = null;
before(() => {
  timers.phase = 'booted';
  booted = { window: app.window, calls: app.calls, bootUrls: app.calls.map((c) => c.url), flags: currentFlags(app.document) };
});

const live = (runId) => ({
  runId, title: runId, projectDir: '/tmp/shared', status: 'running', kind: 'run', startedAt: '10:00:00', pendingQuestion: null,
});
const row = (runId) => app.document.querySelector(`#runs-list .runs-row[data-run-id="${runId}"]`);
const add = (tag, attrs = {}, parent = app.document.body) => {
  const el = app.document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.append(el);
  return el;
};
const urls = () => app.calls.map((c) => c.url);

// ── one boot per file ───────────────────────────────────────────────────────
test('the app is booted once: one window, one calls array and one app.js import for the whole file', async () => {
  assert.equal(app.window, booted.window);
  assert.equal(app.document, booted.window.document);
  assert.equal(app.calls, booted.calls, 'the same array for the whole file');
  assert.equal(app.importCount(), 1);
  assert.equal(await app.fresh(), app, 'fresh() returns the same app object');
  assert.equal(await app.fresh({ level: 'simple' }), app);
  assert.equal(app.window, booted.window, 'a reset never builds a new window');
  assert.equal(app.calls, booted.calls);
  assert.equal(app.importCount(), 1, 'a reset never imports app.js again');
});

test('load-time options reach the boot: url, setup, innerWidth, matchMedia and the file fetch handler', () => {
  assert.equal(app.window.location.origin, 'http://localhost:4399');
  assert.equal(setupWindow, app.window, 'setup(window) ran on the shared window');
  assert.equal(app.window.innerWidth, 1234);
  assert.equal(app.window.matchMedia('(max-width: 1px)'), MEDIA);
  assert.ok(booted.bootUrls.some((u) => u.endsWith('/api/projects')), `the boot fetches are recorded: ${booted.bootUrls}`);
  assert.ok(app.wsBox.ws, 'the one fake socket');
});

test('calls records url and opts; the default fetch answers 200 with an empty app', async () => {
  const res = await app.window.fetch('/api/nothing-answers-this');
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), DEFAULT_BODY);
  await globalThis.fetch('/api/with-opts', { method: 'POST' });
  assert.deepEqual(app.calls.find((c) => c.url === '/api/nothing-answers-this').opts, {});
  assert.equal(app.calls.find((c) => c.url === '/api/with-opts').opts.method, 'POST');
});

// ── the reset between tests ─────────────────────────────────────────────────
const leftover = { ticks: 0, interval: false };

test('reset between tests: this test leaves state behind', async () => {
  app.window.localStorage.setItem('shared-boot.left', '1');
  app.window.localStorage.setItem('shared-boot.local', 'changed');
  app.window.sessionStorage.setItem('shared-boot.left', '1');
  app.window.sessionStorage.setItem('shared-boot.session', 'changed');
  add('dialog', { open: '', id: 'left-dialog' });
  add('div', { class: 'wfv-menu' });
  add('div', { class: 'toast ok' }, app.document.querySelector('#toasts'));
  add('div', { class: 'card-alert' });
  app.go('projects');
  applyFlags({ flagsDemo: false, commandSummaries: true }, app.document);
  applyLevel('simple', app.document);
  app.window.__worcaTestHooks = { leftHook: true };
  await app.window.fetch('/api/left-over');
  const hijack = () => reply({ hijacked: true });
  globalThis.fetch = hijack;
  app.window.fetch = hijack;
  leftover.interval = true;
  setInterval(() => { leftover.ticks++; }, 5);
  await sleep(30);
  assert.ok(leftover.ticks > 0, 'the interval runs inside its own test');
});

test('reset between tests: the next test starts clean', async () => {
  assert.deepEqual(app.calls, [], 'calls is emptied');
  assert.equal(app.window.localStorage.getItem('shared-boot.left'), null);
  assert.equal(app.window.localStorage.getItem('shared-boot.local'), 'file', 'the file seed is back');
  assert.equal(app.window.sessionStorage.getItem('shared-boot.left'), null);
  assert.equal(app.window.sessionStorage.getItem('shared-boot.session'), 'file');
  assert.equal(app.document.querySelectorAll('dialog[open]').length, 0);
  assert.equal(app.document.querySelectorAll('body > .wfv-menu').length, 0);
  assert.equal(app.document.querySelectorAll('#toasts > .toast').length, 0);
  assert.equal(app.document.querySelectorAll('.card-alert').length, 0);
  assert.ok(app.document.querySelector('#toasts'), 'the toast host stays');
  assert.ok(app.document.querySelector('#runs-list'), 'the Runs list host stays');
  assert.ok(app.document.querySelector('#run-detail'), 'the run page host stays');
  assert.equal(app.window.location.hash, '#runs', 'lands on resetHash');
  assert.deepEqual(currentFlags(app.document), booted.flags, 'the boot flags');
  assert.equal(currentFlags(app.document).flagsDemo, true);
  assert.equal(app.document.documentElement.dataset.level, 'advanced');
  assert.deepEqual({ ...app.window.__worcaTestHooks }, { fileHook: 1 });
  await globalThis.fetch('/api/after-hijack-global');
  await app.window.fetch('/api/after-hijack-window');
  assert.ok(urls().includes('/api/after-hijack-global'), 'globalThis.fetch records again');
  assert.ok(urls().includes('/api/after-hijack-window'), 'window.fetch records again');
  const ticks = leftover.ticks;
  await sleep(40);
  assert.equal(leftover.ticks, ticks, 'the previous test\'s interval no longer fires');
});

test('a reset clears intervals started after the boot and keeps the app\'s own 1 s tick', async () => {
  const atImport = timers.made.filter((r) => r.phase === 'boot' && r.ms === 1000);
  const fired = () => atImport.reduce((n, r) => n + r.fired, 0);
  assert.ok(atImport.length > 0, 'app.js starts its 1 s tick at import');
  let ticks = 0;
  setInterval(() => { ticks++; }, 5);
  await sleep(30);
  assert.ok(ticks > 0);
  await app.fresh();
  const seen = ticks;
  await app.fresh();
  const appTicks = fired();
  await sleep(1200);
  assert.equal(ticks, seen, 'the test interval is cleared');
  assert.ok(fired() > appTicks, 'the import-time tick still fires after resets');
});

test('a reset puts the boot globals back', async (t) => {
  const other = new JSDOM('<!doctype html><body></body>', { url: 'http://elsewhere.test/' });
  t.after(() => releaseDom(other));
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'navigator']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? other.window : other.window[k], configurable: true, writable: true });
  }
  await app.fresh();
  assert.equal(globalThis.window, app.window);
  assert.equal(globalThis.document, app.document);
  assert.equal(globalThis.location, app.window.location);
  assert.equal(globalThis.localStorage, app.window.localStorage);
  assert.equal(globalThis.WebSocket, app.window.WebSocket);
  assert.equal(globalThis.navigator, app.window.navigator);
});

test('the reset flushes queued work before it clears overlays and empties calls', async () => {
  let ran = false;
  setTimeout(() => {
    ran = true;
    add('dialog', { open: '' });
    add('div', { class: 'wfv-menu' });
    app.window.fetch('/api/queued-late');
  }, 0);
  await app.fresh();
  assert.equal(ran, true, 'the queued work ran inside fresh()');
  assert.equal(app.document.querySelectorAll('dialog[open]').length, 0);
  assert.equal(app.document.querySelectorAll('body > .wfv-menu').length, 0);
  assert.deepEqual(app.calls, []);
});

test('fresh() applies per-test storage, hooks, flags, level and hash; the next reset drops them', async () => {
  await app.fresh({
    local: { 'shared-boot.local': 'mine', 'shared-boot.extra': 'l' },
    session: { 'shared-boot.extra': 's' },
    hooks: { testHook: 2 },
    flags: { commandSummaries: true },
    level: 'simple',
    hash: 'projects',
  });
  assert.equal(app.window.localStorage.getItem('shared-boot.local'), 'mine', 'the test seed is applied over the file seed');
  assert.equal(app.window.localStorage.getItem('shared-boot.extra'), 'l');
  assert.equal(app.window.sessionStorage.getItem('shared-boot.extra'), 's');
  assert.equal(app.window.sessionStorage.getItem('shared-boot.session'), 'file');
  assert.deepEqual({ ...app.window.__worcaTestHooks }, { fileHook: 1, testHook: 2 });
  assert.equal(currentFlags(app.document).commandSummaries, true);
  assert.equal(currentFlags(app.document).flagsDemo, true, 'the boot flags stay under the test\'s own');
  assert.equal(app.document.documentElement.dataset.level, 'simple');
  assert.equal(app.window.location.hash, '#projects');
  assert.deepEqual(app.calls, [], 'the reset\'s own requests are not the test\'s');

  await app.fresh();
  assert.equal(app.window.localStorage.getItem('shared-boot.local'), 'file');
  assert.equal(app.window.localStorage.getItem('shared-boot.extra'), null);
  assert.equal(app.window.sessionStorage.getItem('shared-boot.extra'), null);
  assert.deepEqual({ ...app.window.__worcaTestHooks }, { fileHook: 1 });
  assert.deepEqual(currentFlags(app.document), booted.flags);
  assert.equal(app.document.documentElement.dataset.level, 'advanced');
  assert.equal(app.window.location.hash, '#runs');
});

const testHandler = { urls: [] };

test('a per-test fetch handler answers in its own test, and the file handler answers the rest', async () => {
  await app.fresh({
    fetchHandler: (url) => {
      testHandler.urls.push(url);
      return url.endsWith('/api/mine') ? reply({ from: 'test' }) : undefined;
    },
  });
  assert.deepEqual(testHandler.urls, [], 'it does not see the reset\'s own requests');
  assert.deepEqual(await (await app.window.fetch('/api/mine')).json(), { from: 'test' });
  assert.deepEqual(await (await globalThis.fetch('/api/file-only')).json(), { from: 'file' });
  assert.deepEqual(await (await app.window.fetch('/api/neither')).json(), DEFAULT_BODY);
});

test('a per-test fetch handler is gone in the next test', async () => {
  const seen = testHandler.urls.length;
  assert.deepEqual(await (await app.window.fetch('/api/mine')).json(), DEFAULT_BODY);
  assert.deepEqual(await (await app.window.fetch('/api/file-only')).json(), { from: 'file' });
  assert.equal(testHandler.urls.length, seen);
});

// ── server frames ───────────────────────────────────────────────────────────
test('a frame sent after a reset reaches the app, by recv() and by dispatch()', async () => {
  await app.fresh();
  const first = app.uid();
  app.recv({ type: 'hello', runs: [live(first)] });
  app.go('runs');
  await app.settle();
  assert.ok(row(first), 'recv: the run shows on #runs');
  const second = app.uid();
  app.dispatch({ type: 'hello', runs: [live(first), live(second)] });
  await app.settle();
  assert.ok(row(second), 'dispatch: the run shows on #runs');
});

test('a reset takes the previous test\'s live runs off screen', async () => {
  const id = app.uid();
  app.recv({ type: 'hello', runs: [live(id)] });
  app.go('runs');
  await app.settle();
  assert.ok(row(id), 'the run is on screen before the reset');
  await app.fresh();
  assert.equal(app.window.location.hash, '#runs');
  assert.equal(row(id), null, 'and gone after it');
});

test('go() sets the hash and dispatches hashchange', async () => {
  let changes = 0;
  const count = () => { changes++; };
  app.window.addEventListener('hashchange', count);
  try {
    app.go('projects');
    assert.equal(app.window.location.hash, '#projects');
    assert.ok(changes >= 1, 'dispatched at once');
    await app.settle();
  } finally { app.window.removeEventListener('hashchange', count); }
});

test('uid() is unique within the file', () => {
  const plain = Array.from({ length: 100 }, () => app.uid());
  assert.equal(new Set(plain).size, 100);
  for (const id of plain) assert.match(id, /^r\d+$/);
  const p = app.uid('p');
  assert.match(p, /^p\d+$/);
  assert.notEqual(app.uid('p'), p);
});

// ── refusals ────────────────────────────────────────────────────────────────
test('fresh() refuses a load-time key, naming it', async () => {
  for (const key of ['url', 'html', 'setup', 'matchMedia', 'innerWidth', 'resetHash']) {
    await assert.rejects(app.fresh({ [key]: 'x' }),
      { message: `useSharedApp: ${key} is read when app.js loads; pass it to useSharedApp(…) instead` }, key);
  }
});

test('fresh() refuses an unknown option, naming it', async () => {
  await assert.rejects(app.fresh({ foo: 1 }), { message: 'useSharedApp: unknown fresh() option foo' });
  await assert.rejects(app.fresh({ level: 'simple', bar: 1 }), { message: 'useSharedApp: unknown fresh() option bar' });
});

test('a second useSharedApp in one file throws', () => {
  assert.throws(() => useSharedApp({ before, beforeEach, after }),
    { message: 'useSharedApp: one shared app per test file' });
});

// ── child runs: what only a whole file can show ─────────────────────────────
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const url = (rel) => JSON.stringify(pathToFileURL(join(ROOT, rel)).href);

function runFixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-shared-boot-'));
  try {
    const file = join(dir, 'fixture.test.mjs');
    writeFileSync(file, [
      "import { test, before, beforeEach, after } from 'node:test';",
      "import assert from 'node:assert/strict';",
      `import { useSharedApp } from ${url('test/helpers/shared-app-boot.mjs')};`,
      body,
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'test.mjs'), file],
      { encoding: 'utf8', timeout: 90_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: undefined } });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

test('child run: a file that boots only through useSharedApp passes with one import', () => {
  const r = runFixture(`
const app = useSharedApp({ before, beforeEach, after });
test('one', () => { assert.equal(app.importCount(), 1); });
test('two', () => { assert.equal(app.importCount(), 1); });`);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ℹ pass 2\b/);
});

test('child run: fresh() before the boot rejects', () => {
  const r = runFixture(`
const app = useSharedApp({ before, beforeEach, after });
await assert.rejects(app.fresh(), { message: 'useSharedApp: the app is not booted yet' });
test('boots afterwards', () => { assert.equal(app.importCount(), 1); });`);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ℹ pass 1\b/);
});

test('child run: a second app.js import fails the file', () => {
  const r = runFixture(`
const app = useSharedApp({ before, beforeEach, after });
test('imports app.js again', async () => {
  await import(${url('ui/public/app.js')} + '?second');
  assert.equal(app.importCount(), 2);
});`);
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /useSharedApp: app\.js was imported 2 times in this file; expected 1/);
});

test('child run: a boot through another helper (bootApp) is counted and fails the file', () => {
  const r = runFixture(`
import { bootApp } from ${url('test/helpers/run-page-boot.mjs')};
const app = useSharedApp({ before, beforeEach, after });
test('boots a second app', async () => { await bootApp(); });`);
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /useSharedApp: app\.js was imported 2 times in this file; expected 1/);
});
