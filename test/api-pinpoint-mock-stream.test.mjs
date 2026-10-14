// test/api-pinpoint-mock-stream.test.mjs — the mock Explain answer streams in several deltas (a MOCK_SLOW quote: 300 ms apart).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { mockSlowMs } from '../src/core/engines/mock.mjs';

useTempHome(after);
let srv, port;
before(async () => {
  process.env.HOME = process.env.WORCA_HOME; process.env.USERPROFILE = process.env.WORCA_HOME; process.env.WORCA_MOCK = '1';
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); delete process.env.WORCA_MOCK; });

async function lines(quote, extra = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/api/pinpoint`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'explain', quote, surface: 'chat', ...extra }) });
  assert.equal(res.status, 200);
  const out = []; const t0 = Date.now(); let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) out.push({ at: Date.now() - t0, ...JSON.parse(l) }); }
  }
  return out;
}

test('mock explain: several deltas that join to the full mock text, then done', async () => {
  const out = await lines('rate limits');
  const deltas = out.filter((l) => l.type === 'delta');
  assert.ok(deltas.length >= 3, `deltas: ${deltas.length}`);
  assert.match(deltas.map((d) => d.text).join(''), /^This is a mock explanation: with WORCA_MOCK set no model is called\./);
  assert.equal(out.at(-1).type, 'done');
});

test('the web surface is named in the mock answer; chat is unchanged (v7)', async () => {
  const web = (await lines('rate limits', { surface: 'web' })).filter((l) => l.type === 'delta').map((d) => d.text).join('');
  assert.match(web, /^\(mock · web surface\) This is a mock explanation/);
  const chat = (await lines('rate limits')).filter((l) => l.type === 'delta').map((d) => d.text).join('');
  assert.doesNotMatch(chat, /web surface/);
});

test('a MOCK_SLOW quote spaces the deltas ~300 ms apart', async () => {
  const deltas = (await lines('MOCK_SLOW rate limits')).filter((l) => l.type === 'delta');
  assert.ok(deltas.at(-1).at - deltas[0].at >= 250 * (deltas.length - 1) * 0.8);
});

test('WORCA_MOCK_SLOW_MS sets the slow pace; junk falls back to 300', () => {
  const prev = process.env.WORCA_MOCK_SLOW_MS;
  try {
    delete process.env.WORCA_MOCK_SLOW_MS; assert.equal(mockSlowMs(), 300);
    process.env.WORCA_MOCK_SLOW_MS = '900'; assert.equal(mockSlowMs(), 900);
    process.env.WORCA_MOCK_SLOW_MS = 'x'; assert.equal(mockSlowMs(), 300);
    process.env.WORCA_MOCK_SLOW_MS = '10'; assert.equal(mockSlowMs(), 300);
  } finally { if (prev === undefined) delete process.env.WORCA_MOCK_SLOW_MS; else process.env.WORCA_MOCK_SLOW_MS = prev; }
});
