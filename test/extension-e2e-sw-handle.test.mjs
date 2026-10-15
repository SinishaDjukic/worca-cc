// test/extension-e2e-sw-handle.test.mjs — the E2E `sw` fixture's worker resolution (e2e/extension/sw-handle.mjs), on
// fake Playwright contexts: it must pick the extension's own worker, wait until its chrome.* APIs are bound, and
// re-resolve the live worker when Chrome restarts it mid-test (CI flake: chrome.storage undefined in theme.spec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionWorker, extensionWorkerHandle } from '../e2e/extension/sw-handle.mjs';

const EXT = 'chrome-extension://abcdefghijklmnop/background.js';
const READY = { chrome: { storage: { local: {} } }, test: {} };
const CLOSED = 'worker.evaluate: Target page, context or browser has been closed';

/** A fake Playwright Worker: evaluate runs `fn` with this worker's chrome / __worcaTest installed as globals. */
function fakeWorker(url, env = READY) {
  const w = {
    url: () => url, env, closed: false, calls: 0,
    async evaluate(fn, arg) {
      w.calls += 1;
      if (w.closed) throw new Error(CLOSED);
      const had = { chrome: 'chrome' in globalThis, test: '__worcaTest' in globalThis };
      const saved = { chrome: globalThis.chrome, test: globalThis.__worcaTest };
      if (w.env.chrome === undefined) delete globalThis.chrome; else globalThis.chrome = w.env.chrome;
      if (w.env.test === undefined) delete globalThis.__worcaTest; else globalThis.__worcaTest = w.env.test;
      try { return await fn(arg); } finally {
        if (had.chrome) globalThis.chrome = saved.chrome; else delete globalThis.chrome;
        if (had.test) globalThis.__worcaTest = saved.test; else delete globalThis.__worcaTest;
      }
    },
  };
  return w;
}

/** A fake BrowserContext: serviceWorkers() lists `workers`; waitForEvent hands out `later` in order, filtered. */
function fakeContext(workers = [], later = []) {
  const ctx = {
    workers, waits: [],
    serviceWorkers: () => ctx.workers.slice(),
    async waitForEvent(name, { predicate, timeout } = {}) {
      ctx.waits.push({ name, timeout });
      while (later.length) {
        const w = later.shift();
        ctx.workers.push(w);
        if (!predicate || predicate(w)) return w;
      }
      await new Promise((r) => setTimeout(r, Math.min(timeout ?? 20, 20)));
      throw new Error(`Timeout ${timeout}ms exceeded while waiting for event "${name}"`);
    },
  };
  return ctx;
}

test('picks the chrome-extension:// worker, not the first worker in the context', async () => {
  const other = fakeWorker('https://example.test/sw.js', { chrome: {}, test: undefined });
  const ext = fakeWorker(EXT);
  assert.equal(await extensionWorker(fakeContext([other, ext])), ext);
  assert.equal(other.calls, 0);
});

test('waits for the extension worker with a predicate that skips other workers', async () => {
  const ctx = fakeContext([], [fakeWorker('https://example.test/sw.js'), fakeWorker(EXT)]);
  const w = await extensionWorker(ctx, { timeout: 2000, interval: 5 });
  assert.equal(w.url(), EXT);
  assert.equal(ctx.waits[0].name, 'serviceworker');
});

test('polls until chrome.storage.local and the test hooks are bound in the worker', async () => {
  const ext = fakeWorker(EXT, { chrome: {}, test: undefined });   // chrome exists, chrome.storage does not yet
  let polls = 0;
  const evaluate = ext.evaluate;
  ext.evaluate = async (fn, arg) => { if (++polls === 3) ext.env = READY; return evaluate(fn, arg); };
  assert.equal(await extensionWorker(fakeContext([ext]), { timeout: 2000, interval: 5 }), ext);
  assert.ok(polls >= 3);
});

test('a worker that never becomes ready fails with a clear error naming chrome.storage', async () => {
  const ext = fakeWorker(EXT, { chrome: {}, test: {} });
  await assert.rejects(extensionWorker(fakeContext([ext]), { timeout: 60, interval: 5 }),
    /extension service worker not ready in 60 ms.*chrome-extension:\/\/abcdefghijklmnop.*chrome\.storage\.local/s);
});

test('no extension worker at all fails with a clear error', async () => {
  await assert.rejects(extensionWorker(fakeContext([fakeWorker('https://example.test/sw.js')]), { timeout: 60, interval: 5 }),
    /extension service worker not ready in 60 ms.*no chrome-extension:\/\/ service worker/s);
});

test('the handle evaluates in the live worker and exposes its url', async () => {
  const ctx = fakeContext([fakeWorker(EXT)]);
  const sw = await extensionWorkerHandle(ctx, { interval: 5 });
  assert.equal(sw.url(), EXT);
  assert.equal(await sw.evaluate((n) => typeof chrome.storage.local === 'object' && n + 1, 41), 42);
});

test('a worker restarted mid-test: the handle re-resolves and evaluates in the new worker', async () => {
  const first = fakeWorker(EXT);
  const ctx = fakeContext([first]);
  const sw = await extensionWorkerHandle(ctx, { timeout: 2000, interval: 5 });
  first.closed = true;                               // Chrome stopped it; Playwright drops it from the list a bit later
  setTimeout(() => { ctx.workers = [fakeWorker(EXT)]; }, 20);
  const seen = await sw.evaluate(() => globalThis.__worcaTest);
  assert.equal(seen, READY.test);
  assert.notEqual(ctx.workers[0], first);
});

test('a closed-target error during the call is retried in the new worker', async () => {
  const first = fakeWorker(EXT);
  const second = fakeWorker(EXT);
  const ctx = fakeContext([first]);
  const sw = await extensionWorkerHandle(ctx, { timeout: 2000, interval: 5 });
  let ran = 0;
  const evaluate = first.evaluate;
  first.evaluate = async (fn, arg) => {
    if (fn.length === 1) { first.closed = true; ctx.workers = [second]; throw new Error(CLOSED); }   // the caller's fn, not the probe
    return evaluate(fn, arg);
  };
  assert.equal(await sw.evaluate((x) => { ran += 1; return x * 2; }, 21), 42);
  assert.equal(ran, 1);
});

test('any other evaluate error is thrown as is, without a retry', async () => {
  const ctx = fakeContext([fakeWorker(EXT)]);
  const sw = await extensionWorkerHandle(ctx, { interval: 5 });
  let ran = 0;
  await assert.rejects(sw.evaluate(() => { ran += 1; throw new TypeError('boom'); }), /boom/);
  assert.equal(ran, 1);
});
