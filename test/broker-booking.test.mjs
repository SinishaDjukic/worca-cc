// test/broker-booking.test.mjs — the broker's shared body budget and its booking, attacked (PR #854 review
// V6–V8, V12): a declared Content-Length that never arrives gives the budget back at a deadline; a client that
// stops reading a stream is booked in full, not $0; an over-cap JSON answer, a stream flag that is not `true`
// and a background Responses call cannot dodge the booking; a keyless slot is never priced.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { createUsageTap, priceUsage, requestWithUsage } from '../src/broker/usage.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';

const SECRET = 's'.repeat(48);
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

async function broker(extra = {}, { upstream, slots: extraSlots = [] } = {}) {
  const up = upstream || await startFakeUpstream({ validKeys: [GOOD_KEY, ''] });
  if (!upstream) closers.push(() => up.close());
  const { config } = readBrokerConfig({
    WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1',
    WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1', WORCA_BROKER_KEY_ANTHROPIC: GOOD_KEY,
  });
  const slots = mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: up.url }, ...extraSlots.map((s) => ({ ...s, upstream: up.url }))]);
  const b = await startBroker({ config: { ...config, port: 0, ...extra }, slots, log: () => {} });
  closers.push(() => b.close());
  const port = b.ports.private;
  const internal = async (method, path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  let seq = 0;
  const mint = async (slots = ['anthropic']) => {
    const spawnId = `sp-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
    const { token } = await internal('POST', '/internal/tokens', { billTo: 'local', slots, spawnId, kind: 'phase', issuer: 'srv-test' });
    return { token, spawnId };
  };
  const usage = async (spawnId) => (await internal('GET', `/internal/usage?spawnId=${spawnId}`)).rows;
  return { port, mint, usage };
}

const BODY = JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'x'.repeat(300) }] });
function rawPost(port, token, headers, path = '/p/anthropic/v1/messages') {
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path,
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${token}`, ...headers } });
  const response = new Promise((resolveP) => {
    req.on('response', (res) => { const p = []; res.on('data', (c) => p.push(c)); res.on('end', () => resolveP({ status: res.statusCode, text: Buffer.concat(p).toString() })); });
    req.on('error', () => resolveP({ status: 0, text: '' }));
  });
  return { req, response };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('V6: a declared body that never arrives gives the shared budget back at the body deadline', async () => {
  const { port, mint } = await broker({ inflightBodyBytes: 1000, bodyIdleMs: 300, bodyTotalMs: 5000 });
  const stalled = [];
  for (let i = 0; i < 2; i++) { const s = rawPost(port, (await mint()).token, { 'content-length': '480' }); s.req.flushHeaders(); stalled.push(s); }
  await wait(800);
  const victim = rawPost(port, (await mint()).token, { 'content-length': String(Buffer.byteLength(BODY)) });
  victim.req.end(BODY);
  assert.equal((await victim.response).status, 200, 'another token is served once the stalled bodies time out');
  for (const s of stalled) assert.equal((await s.response).status, 408);
});

test('V7: a client that stops reading a stream is booked in full once it counts as gone', async () => {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [], usage: { input_tokens: 100000, output_tokens: 1 } } });
      const pad = 'y'.repeat(16 << 10);
      for (let i = 0; i < 512; i++) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: pad } });   // 8 MiB
      ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50000 } });
      ev('message_stop', {});
      res.end();
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => { upstream.closeAllConnections?.(); upstream.close(r); }));
  const { port, mint, usage } = await broker({ clientDrainMs: 300 }, { upstream: { url: `http://127.0.0.1:${upstream.address().port}` } });
  const { token, spawnId } = await mint();
  const body = JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] });
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  sock.pause();   // reads nothing, never hangs up
  sock.write(`POST /p/anthropic/v1/messages HTTP/1.1\r\nhost: x\r\ncontent-type: application/json\r\nanthropic-version: 2023-06-01\r\nauthorization: Bearer ${token}\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  let rows = [];
  for (let i = 0; i < 50 && !rows.length; i++) { await wait(100); rows = await usage(spawnId); }
  sock.destroy();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].status, rows[0].inputTokens, rows[0].outputTokens], [200, 100000, 50000]);
  assert.ok(rows[0].usd > 0);
});

test('V8: an over-cap JSON answer still reports its usage; any truthy stream asks for usage; background is refused', () => {
  const pad = 'x'.repeat(5 << 20);
  const json = JSON.stringify({ id: 'c', model: 'gpt-4.1', choices: [{ message: { content: `${pad} "usage": {"prompt_tokens": 1}` } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 30_000 } });
  const tap = createUsageTap('openai', 'application/json');
  for (let i = 0; i < json.length; i += 65536) tap.write(Buffer.from(json.slice(i, i + 65536)));
  const u = tap.end();
  assert.deepEqual([u.model, u.inputTokens, u.outputTokens], ['gpt-4.1', 1_000_000, 30_000]);
  assert.ok(priceUsage(u) > 0);
  const big = JSON.stringify({ type: 'message', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: pad }], usage: { input_tokens: 7, output_tokens: 9 } });
  const at = createUsageTap('anthropic', 'application/json'); at.write(big);
  assert.deepEqual([at.end().inputTokens], [7]);

  const slot = { id: 'openai', protocol: 'openai', upstream: 'https://api.openai.com' };
  const sent = (o, path = '/v1/chat/completions') => JSON.parse(requestWithUsage(slot, path, Buffer.from(JSON.stringify(o))).toString());
  for (const stream of [true, 1, 'true']) assert.deepEqual(sent({ model: 'm', stream }).stream_options, { include_usage: true }, JSON.stringify(stream));
  for (const stream of [false, undefined]) assert.equal(sent({ model: 'm', stream }).stream_options, undefined);
  assert.throws(() => sent({ model: 'm', background: true }, '/v1/responses'), { code: 'E_BACKGROUND' });
  assert.deepEqual(sent({ model: 'm', background: false }, '/v1/responses'), { model: 'm', background: false });
});

test('V12: a slot that sends no key is keyless and never priced, whatever its credential says', async () => {
  const { port, mint, usage } = await broker({}, { slots: [{ id: 'lan', label: 'LAN models', protocol: 'anthropic', auth: 'none', credential: 'operator' }] });
  const { token, spawnId } = await mint(['lan']);
  const r = rawPost(port, token, { 'content-length': String(Buffer.byteLength(BODY)) }, '/p/lan/v1/messages');
  r.req.end(BODY);
  assert.equal((await r.response).status, 200);
  const rows = await usage(spawnId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].usd, 0);
});
