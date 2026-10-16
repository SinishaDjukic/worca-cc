import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPortFetch } from '../extension/src/content/port-fetch.mjs';
import { servePinpointPort, sanitizePinpointBody } from '../extension/src/pinpoint-proxy.mjs';
import { streamPinpoint } from '../ui/public/pinpoint.mjs';

function portPair(senderUrl = 'http://fixture.test/page.html') {
  const mk = () => ({ onMessage: { addListener(f) { this.f = f; } }, onDisconnect: { addListener(f) { this.g = f; } } });
  const a = mk(); const b = mk();
  a.postMessage = (x) => queueMicrotask(() => b.onMessage.f?.(structuredClone(x)));
  b.postMessage = (x) => queueMicrotask(() => a.onMessage.f?.(structuredClone(x)));
  a.disconnect = () => queueMicrotask(() => b.onDisconnect.g?.());
  b.disconnect = () => queueMicrotask(() => a.onDisconnect.g?.());
  b.sender = { url: senderUrl, frameId: 0, tab: { id: 7 } };
  return [a, b];
}
const ndjson = (lines) => new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });

test('explain streams end to end; the proxy forces surface=web and the sender host as source', async () => {
  let sent = null;
  const client = { call: async (path, o) => { sent = { path, body: o.body }; return ndjson([{ type: 'delta', text: 'Hello ' }, { type: 'delta', text: 'web' }, { type: 'done' }]); } };
  const fetchFn = createPortFetch(() => { const [a, b] = portPair(); servePinpointPort(b, { client, allowed: () => true }); return a; });
  let text = '';
  await streamPinpoint(fetchFn, { action: 'explain', quote: 'q', context: 'c', surface: 'chat', source: 'spoofed' }, { onDelta: (t) => { text += t; } });
  assert.equal(text, 'Hello web');
  assert.equal(sent.path, '/api/pinpoint');
  assert.equal(sent.body.surface, 'web');
  assert.equal(sent.body.source, 'fixture.test');
});
test('refused when the tab is not the active panel tab; refusals surface as errors', async () => {
  const client = { call: async () => new Response(JSON.stringify({ error: 'at most 4 Pinpoint answers may run at once' }), { status: 429 }) };
  const off = createPortFetch(() => { const [a, b] = portPair(); servePinpointPort(b, { client, allowed: () => false }); return a; });
  await assert.rejects(streamPinpoint(off, { action: 'explain', quote: 'q' }), /Open the Worca sidebar/);
  const busy = createPortFetch(() => { const [a, b] = portPair(); servePinpointPort(b, { client, allowed: () => true }); return a; });
  await assert.rejects(streamPinpoint(busy, { action: 'explain', quote: 'q' }), /at most 4/);
});
test('a service worker that dies mid-stream errors the answer instead of ending it (v6)', async () => {
  const fetchFn = createPortFetch(() => {
    const [a, b] = portPair();
    queueMicrotask(() => {
      b.postMessage({ type: 'head', ok: true });
      b.postMessage({ type: 'chunk', text: `${JSON.stringify({ type: 'delta', text: 'Hal' })}\n` });
      queueMicrotask(() => b.disconnect());   // no `end`
    });
    return a;
  });
  let text = '';
  await assert.rejects(streamPinpoint(fetchFn, { action: 'explain', quote: 'q' }, { onDelta: (t) => { text += t; } }), /not reachable/);
  assert.equal(text, 'Hal');
});
test('sanitize: only explain/alternatives, quote required, clipped', () => {
  assert.equal(sanitizePinpointBody({ action: 'disagree', quote: 'x' }, { source: 'a' }), null);
  assert.equal(sanitizePinpointBody({ action: 'explain', quote: ' ' }, { source: 'a' }), null);
  assert.equal(sanitizePinpointBody({ action: 'explain', quote: 'x'.repeat(5000) }, { source: 'a' }).quote.length, 4000);
});
