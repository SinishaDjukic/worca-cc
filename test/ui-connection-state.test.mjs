// test/ui-connection-state.test.mjs — runs redesign §5a.2: one "server unreachable" state and its one banner.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createConnection, paintConnectionBanner, OFFLINE_TEXT } from '../ui/public/connection-state.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);

function clock() {
  const timers = new Map(); let id = 0;
  return { set: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clear: (i) => timers.delete(i),
    fire() { for (const [i, t] of [...timers]) { timers.delete(i); t.fn(); } }, size: () => timers.size };
}

test('down only after the delay; a quick reconnect never reports down', () => {
  const c = clock(); const seen = [];
  const conn = createConnection({ delayMs: 3000, setTimer: c.set, clearTimer: c.clear, onChange: (d) => seen.push(d) });
  conn.lost(); conn.back();
  assert.equal(c.size(), 0); assert.deepEqual(seen, []); assert.equal(conn.isDown(), false);
  conn.lost(); conn.lost(); c.fire();
  assert.deepEqual(seen, [true]); assert.equal(conn.isDown(), true);
  conn.back(); conn.back();
  assert.deepEqual(seen, [true, false]);
});

test('the banner: role=status, the text, Retry now; hidden while the session-expired alert shows', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body><div id="b" hidden></div></body>')).window.document;
  const host = doc.getElementById('b'); let retried = 0;
  paintConnectionBanner(host, true, { onRetry: () => retried++ });
  assert.equal(host.hidden, false);
  assert.equal(host.getAttribute('role'), 'status');
  assert.equal(host.querySelector('.conn-banner-text').textContent, OFFLINE_TEXT);
  host.querySelector('button.conn-retry').click();
  assert.equal(retried, 1);
  assert.match(host.querySelector('button').className, /\bbtn\b.*\bbtn-sm\b.*\bbtn-secondary\b/);
  paintConnectionBanner(host, false);
  assert.equal(host.hidden, true);
  doc.body.append(Object.assign(doc.createElement('div'), { className: 'session-expired' }));
  paintConnectionBanner(host, true);
  assert.equal(host.hidden, true, 'the sign-in alert tells the real cause');
});
