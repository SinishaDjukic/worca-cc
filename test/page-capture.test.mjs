// test/page-capture.test.mjs — the headless capture path (issue 1064 slice 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPageCapture, padClip, CaptureError, CAPTURE_LIMITS } from '../src/core/page-capture.mjs';
import { loadFindTools } from '../src/core/graph/media-preflight.mjs';

const noTimers = { setTimer: () => null, clearTimer: () => {} };
const VP = { width: 1, height: 1 };

test('padClip: padded, clamped to the viewport, null when nothing is left', () => {
  const vp = { width: 800, height: 600 };
  assert.deepEqual(padClip({ x: 10, y: 20, width: 100, height: 50 }, vp), { x: 6, y: 16, width: 108, height: 58 });
  assert.deepEqual(padClip({ x: 790, y: 590, width: 50, height: 50 }, vp), { x: 786, y: 586, width: 14, height: 14 });
  assert.equal(padClip({ x: 900, y: 10, width: 10, height: 10 }, vp), null);
  assert.equal(padClip({ x: NaN, y: 0, width: 1, height: 1 }, vp), null);
});

/**
 * A fake playwright browser: records the route rule's verdicts for `probe` URLs, emits `hops` (redirected requests,
 * which real playwright never routes) as context `request` events during goto, then "loads" the page.
 */
function fakeBrowser({ probe = [], hops = [], headers = {}, painted = true, text = 'Hello', boom = null } = {}) {
  const seen = { verdicts: [], closedCtx: 0 };
  const listeners = {};
  const page = {
    on() {}, setDefaultTimeout() {}, mainFrame: () => 'main',
    goto: async () => {
      for (const [url, top] of hops) listeners.request?.({ url: () => url, redirectedFrom: () => ({}), isNavigationRequest: () => top, frame: () => 'main' });
      listeners.request?.({ url: () => 'http://a/plain', redirectedFrom: () => null, isNavigationRequest: () => false, frame: () => 'main' });
      if (boom) throw new Error(boom);
      return { headers: () => headers, status: () => 200 };
    },
    waitForLoadState: async () => {}, waitForTimeout: async () => {}, title: async () => 'T',
    evaluate: async (fn, arg) => (fn.name === 'paintedInPage' ? painted : fn.name === 'textInPage' ? text.slice(0, arg) : { x: 0, y: 0, width: 10, height: 10 }),
    screenshot: async () => Buffer.from('png'),
  };
  const ctx = {
    on: (ev, fn) => { listeners[ev] = fn; },
    newPage: async () => page,
    route: async (_p, fn) => {
      for (const [url, top] of probe) {
        const req = { url: () => url, isNavigationRequest: () => top, frame: () => 'main' };
        await fn({ request: () => req, continue: () => seen.verdicts.push([url, true]), abort: () => seen.verdicts.push([url, false]) });
      }
    },
    routeWebSocket: async () => {}, close: async () => { seen.closedCtx += 1; },
  };
  return { seen, browser: { isConnected: () => true, newContext: async () => ctx, close: async () => {}, on() {} } };
}
const capOf = (f, extra = {}) => createPageCapture({ launch: async () => f.browser, ...noTimers, ...extra });

test('every request passes the allow rule; a proxy note page is answered as a note; one context per capture', async () => {
  const f = fakeBrowser({ probe: [['http://a/ok', true], ['http://a/no', false]] });
  const r = await capOf(f).capture({ url: 'http://a/ok', allow: async (u) => u.endsWith('/ok'), viewport: { width: 800, height: 600 }, shot: true, text: true });
  assert.deepEqual(f.seen.verdicts, [['http://a/ok', true], ['http://a/no', false]]);
  assert.deepEqual([r.text, r.truncated], ['Hello', false]);
  assert.equal(r.width, 800);
  assert.ok(Buffer.isBuffer(r.png));
  assert.equal(f.seen.closedCtx, 1);
  const n = fakeBrowser({ headers: { 'x-worca-preview-note': 'NOT_LISTENING' } });
  assert.equal((await capOf(n).capture({ url: 'x', allow: () => true, viewport: VP, shot: true })).note, 'NOT_LISTENING');
  const long = fakeBrowser({ text: 'Hello' });
  const t = await capOf(long, { limits: { ...CAPTURE_LIMITS, textChars: 3 } }).capture({ url: 'x', allow: () => true, viewport: VP, text: true });
  assert.deepEqual([t.text, t.truncated], ['Hel', true]);
});

test('every redirect hop passes the allow rule too: one it refuses refuses the whole capture', async () => {
  const opts = { url: 'http://a/ok', allow: async (u) => u.startsWith('http://a/'), viewport: VP, shot: true };
  await assert.rejects(capOf(fakeBrowser({ hops: [['http://127.0.0.1:4317/api/settings', true]] })).capture(opts), { code: 'REFUSED' });
  await assert.rejects(capOf(fakeBrowser({ hops: [['http://192.168.1.4/x.png', false]] })).capture(opts), { code: 'REFUSED' }, 'a subresource hop too');
  await assert.rejects(capOf(fakeBrowser({ hops: [['http://127.0.0.1:4317/api/x', true]], boom: 'net::ERR_ABORTED' })).capture(opts), { code: 'REFUSED' }, 'even when the load then fails');
  assert.ok(Buffer.isBuffer((await capOf(fakeBrowser({ hops: [['http://a/next', true]] })).capture(opts)).png), 'an allowed hop');
  await assert.rejects(capOf(fakeBrowser({ hops: [['http://a/x', true]] })).capture({ ...opts, allow: () => { throw new Error('rule broke'); } }), { code: 'REFUSED' }, 'a throwing rule refuses');
});

test('a load failure, no Chrome, a full queue and a closed capture are CaptureErrors', async () => {
  await assert.rejects(capOf(fakeBrowser({ boom: 'net::ERR_CONNECTION_REFUSED' })).capture({ url: 'x', allow: () => true, viewport: VP }), { code: 'LOAD_FAILED' });
  const none = createPageCapture({ launch: async () => { throw new CaptureError('no chrome', 'NO_CHROME'); }, ...noTimers });
  await assert.rejects(none.capture({ url: 'x', allow: () => true, viewport: VP }), { code: 'NO_CHROME' });
  let release;
  const slow = createPageCapture({ launch: () => new Promise((r) => { release = () => r(fakeBrowser().browser); }), limits: { ...CAPTURE_LIMITS, queue: 1 }, ...noTimers });
  const first = slow.capture({ url: 'x', allow: () => true, viewport: VP });
  await assert.rejects(slow.capture({ url: 'x', allow: () => true, viewport: VP }), { code: 'BUSY' });
  release(); await first;
  await slow.close();
  await assert.rejects(slow.capture({ url: 'x', allow: () => true, viewport: VP }), { code: 'CLOSED' });
});

const chrome = (await loadFindTools()).findChrome({ env: process.env });
test('real Chrome: a local page is captured, its text and console error read, a blocked request never leaves, a refused redirect hop refuses the capture', { skip: !chrome, timeout: 90_000 }, async () => {
  let blockedHit = false;
  const blocked = http.createServer((q, s) => { blockedHit = true; s.end('x'); });
  await new Promise((r) => blocked.listen(0, '127.0.0.1', r));
  const bport = blocked.address().port;
  const site = http.createServer((q, s) => {
    if (q.url === '/r') { s.writeHead(302, { location: `http://127.0.0.1:${bport}/secret` }); s.end(); return; }
    s.writeHead(200, { 'content-type': 'text/html' });
    s.end(`<h1>Hi there</h1><script>console.error('boom');fetch('http://127.0.0.1:${bport}/x').catch(()=>{})</script>`);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const allow = (u) => u.startsWith(`${origin}/`);
  const cap = createPageCapture();
  try {
    const r = await cap.capture({ url: `${origin}/`, allow, viewport: { width: 640, height: 400 }, shot: true, text: true });
    assert.equal(r.note, null);
    assert.equal(r.painted, true);
    assert.match(r.text, /Hi there/);
    assert.ok(r.console.some((l) => /boom/.test(l)));
    assert.equal(r.png.subarray(1, 4).toString(), 'PNG');
    assert.equal(blockedHit, false, 'the rule kept the page off another loopback port');
    // playwright routes only the first URL of a redirect chain: the hop check is what refuses this one
    await assert.rejects(cap.capture({ url: `${origin}/r`, allow, viewport: { width: 640, height: 400 }, shot: true, text: true }), { code: 'REFUSED' });
  } finally { await cap.close(); site.close(); blocked.close(); }
});
