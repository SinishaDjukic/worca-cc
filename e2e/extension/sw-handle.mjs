// e2e/extension/sw-handle.mjs — the `sw` fixture's handle on the extension's MV3 service worker. CI once evaluated
// configure() in a worker where `chrome.storage` was undefined (theme.spec, run 38584679601): the old fixture took the
// FIRST worker in the context, did not wait for the extension APIs to be bound in it, and kept that handle for the
// whole test while Chrome may stop and restart the worker. This handle picks the chrome-extension:// worker, waits
// until chrome.storage.local and the test build's __worcaTest exist in it, and re-resolves the live worker before
// every evaluate. Free of Playwright imports, so test/extension-e2e-sw-handle.test.mjs covers it on fakes.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isExtensionWorker = (w) => w.url().startsWith('chrome-extension://');
const ready = () => typeof chrome !== 'undefined' && !!chrome.storage?.local && !!globalThis.__worcaTest;
const CLOSED = /Target (page, context or browser )?(has been )?closed|Worker (has been )?closed|Execution context was destroyed/i;

/** The context's extension service worker once its chrome.* APIs are bound; throws after `timeout` ms with the reason. */
export async function extensionWorker(context, { timeout = 15_000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  let why = 'no chrome-extension:// service worker';
  while (Date.now() < deadline) {
    const w = context.serviceWorkers().find(isExtensionWorker);
    if (!w) {
      try { await context.waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: Math.max(1, deadline - Date.now()) }); } catch { /* deadline */ }
      continue;
    }
    try {
      if (await w.evaluate(ready)) return w;
      why = `${w.url()}: chrome.storage.local / __worcaTest not bound yet`;
    } catch (e) { why = `${w.url()}: ${e.message}`; }   // stopped between list and evaluate: look again
    await sleep(interval);
  }
  throw new Error(`extension service worker not ready in ${timeout} ms (${why})`);
}

/** A Worker-like `{ url(), evaluate(fn, arg) }` that runs every evaluate in the live, ready extension worker. A call
 *  that dies with the worker (closed target) is retried in its successor; any other error is the caller's. */
export async function extensionWorkerHandle(context, opts = {}) {
  let current = await extensionWorker(context, opts);
  return {
    url: () => current.url(),
    async evaluate(fn, arg) {
      for (let attempt = 1; ; attempt += 1) {
        current = await extensionWorker(context, opts);
        try { return await current.evaluate(fn, arg); }
        catch (e) { if (attempt >= 3 || !CLOSED.test(e.message)) throw e; }
      }
    },
  };
}
