// test/ui-session-guard.test.mjs
// ui/public/session-guard.mjs: an expired identity-proxy sign-in (fetch turns
// into a cross-origin redirect -> TypeError) becomes one banner with a reload
// button; a server that is simply down never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installSessionGuard } from '../ui/public/session-guard.mjs';

function setup(handler, opts = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://worca-01.example.com/' });
  const win = dom.window;
  const calls = [];
  win.fetch = async (input, init) => { calls.push({ input: String(input), init }); return handler(String(input), init); };
  const guard = installSessionGuard({ win, doc: win.document, ...opts });
  return { win, doc: win.document, guard, calls };
}
const banner = (doc) => doc.querySelector('.session-expired');
const res = (status, type = 'basic') => ({ status, type, ok: status < 400 });

test('a failed same-origin fetch + an opaque-redirect probe shows the expired banner', async () => {
  const { win, doc, calls } = setup((url, init) => {
    if (url === '/api/health' && init?.redirect === 'manual') return res(0, 'opaqueredirect');
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(win.fetch('/api/projects'), TypeError, 'the caller still sees its error');
  await win.__worcaSessionGuard.check(); // settle the probe the failure started
  const bar = banner(doc);
  assert.ok(bar, 'banner shown');
  assert.equal(bar.getAttribute('role'), 'alert');
  assert.match(bar.textContent, /sign-in has expired/);
  assert.ok(calls.some((c) => c.input === '/api/health' && c.init.redirect === 'manual'));
});

test('server down (probe also fails) shows nothing', async () => {
  const { win, doc, guard } = setup(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(win.fetch('/api/projects'));
  await guard.check();
  assert.equal(banner(doc), null);
});

test('a plain healthy probe shows nothing', async () => {
  const { doc, guard } = setup(() => res(200));
  await guard.check();
  assert.equal(banner(doc), null);
});

test('a 401 from worca shows the "could not confirm" banner once', async () => {
  const { win, doc } = setup(() => res(401));
  const r = await win.fetch('/api/projects');
  assert.equal(r.status, 401, 'the response is passed through');
  await win.fetch('/api/runs');
  assert.equal(doc.querySelectorAll('.session-expired').length, 1);
  assert.match(banner(doc).textContent, /could not confirm/);
});

test('cross-origin failures and aborts are ignored', async () => {
  const { win, calls } = setup((url) => {
    if (url.startsWith('https://api.github.com')) throw new TypeError('x');
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  });
  await assert.rejects(win.fetch('https://api.github.com/x'));
  await assert.rejects(win.fetch('/api/projects'));
  assert.equal(calls.filter((c) => c.input === '/api/health').length, 0, 'no probe');
});

test('probes are throttled and the reload button reloads', async () => {
  let probes = 0;
  const { guard } = setup((url) => { if (url === '/api/health') probes += 1; return res(200); });
  await guard.check();
  await guard.check();
  assert.equal(probes, 1, 'second probe inside 10 s is skipped');

  let reloaded = false;
  const { win: w2, doc: d2 } = setup(() => res(401), { reload: () => { reloaded = true; } });
  await w2.fetch('/api/x');
  d2.querySelector('.se-reload').click();
  assert.equal(reloaded, true);
});

test('installing twice wraps fetch once', () => {
  const { win, guard } = setup(() => res(200));
  const f = win.fetch;
  assert.equal(installSessionGuard({ win, doc: win.document }), guard);
  assert.equal(win.fetch, f);
});
