// test/slack-chat-worker.test.mjs — the slack-chat example plugin's Socket
// Mode worker, in-process with injected fetchFn + a scripted FakeWebSocket:
// ack-before-process, own/bot/subtype filtering, disconnect->fresh-URL reopen,
// chat.postMessage error mapping (200 {ok:false} convention), validateConfig
// per-field errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlackWorker, validateConfig, renderToMrkdwn } from '../plugins/slack-chat/channel/worker.mjs';

const json = (obj, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => obj,
});

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.listeners = { message: [], close: [], error: [] };
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, cb) { this.listeners[type].push(cb); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.emit('close', {}); }
  emit(type, ev) { for (const cb of this.listeners[type].splice(0)) cb(ev); if (type === 'message') this.listeners.message = this.listeners.message; }
  // message listeners persist; close/error are once-style in the worker
  message(obj) { for (const cb of this.listeners.message) cb({ data: JSON.stringify(obj) }); }
}

function fakeCtx(config) {
  const events = { inbound: [], status: [], logs: [] };
  const ac = new AbortController();
  return {
    ctx: {
      apiVersion: 2, platform: 'slack', mock: false,
      config: { botToken: 'xoxb-1', appToken: 'xapp-1', ...config },
      state: { get: async () => null, set: async () => {} },
      log: (l, m) => events.logs.push(`${l}:${m}`),
      emitMessage: (m) => events.inbound.push(m),
      setStatus: (s, d) => events.status.push({ state: s, detail: d ?? null }),
      shutdownSignal: ac.signal,
    },
    events,
  };
}

const waitFor = async (fn, timeoutMs = 3000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
};

function routes(overrides = {}) {
  let opens = 0;
  return {
    opens: () => opens,
    fetchFn: async (url) => {
      if (url.endsWith('/auth.test')) return overrides.auth ?? json({ ok: true, user: 'worca', user_id: 'USELF' });
      if (url.endsWith('/apps.connections.open')) {
        opens++;
        return overrides.open ?? json({ ok: true, url: `wss://slack.test/socket/${opens}` });
      }
      if (url.endsWith('/chat.postMessage')) return (overrides.post ?? (() => json({ ok: true })))();
      throw new Error(`unexpected ${url}`);
    },
  };
}

test('socket lifecycle: hello -> connected; envelopes acked BEFORE processing; filters applied', async () => {
  FakeWebSocket.instances = [];
  const { ctx, events } = fakeCtx({ channelAllowlist: 'C1, C2' });
  const r = routes();
  const w = createSlackWorker(ctx, { fetchFn: r.fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  const info = await w.start();
  assert.equal(info.identity, '@worca');

  const sock = await waitFor(() => FakeWebSocket.instances[0]);
  sock.message({ type: 'hello' });
  await waitFor(() => events.status.some((s) => s.state === 'connected'));

  sock.message({
    type: 'events_api', envelope_id: 'env-1',
    payload: { team_id: 'T1', event: { type: 'message', channel: 'C1', user: 'U9', text: '/status', ts: '1.2' } },
  });
  assert.deepEqual(sock.sent[0], { envelope_id: 'env-1' }, 'ack sent');
  assert.deepEqual(events.inbound[0], {
    chatId: 'C1', userId: 'U9', text: '/status',
    meta: { platform: 'slack', ts: '1.2', threadTs: null, team: 'T1' },
  });

  // filtered: own message, bot message, subtype, non-allowlisted channel — all acked, none emitted
  for (const ev of [
    { type: 'message', channel: 'C1', user: 'USELF', text: 'me' },
    { type: 'message', channel: 'C1', bot_id: 'B1', user: 'U2', text: 'bot' },
    { type: 'message', channel: 'C1', user: 'U9', subtype: 'message_changed', text: 'edit' },
    { type: 'message', channel: 'C9', user: 'U9', text: 'off-list' },
  ]) {
    sock.message({ type: 'events_api', envelope_id: 'x', payload: { event: ev } });
  }
  assert.equal(events.inbound.length, 1);
  await w.stop();
});

test('disconnect frame -> reopen with a FRESH url; closes reconnect on a ladder', async () => {
  FakeWebSocket.instances = [];
  const { ctx, events } = fakeCtx();
  const r = routes();
  const sleeps = [];
  const w = createSlackWorker(ctx, { fetchFn: r.fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async (ms) => { sleeps.push(ms); } });
  await w.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.message({ type: 'hello' });
  s1.message({ type: 'disconnect', reason: 'refresh_requested' });
  const s2 = await waitFor(() => FakeWebSocket.instances[1]);
  assert.notEqual(s2.url, s1.url, 'fresh apps.connections.open url');
  assert.equal(r.opens(), 2);
  assert.ok(events.logs.some((l) => /refresh_requested/.test(l)));
  await w.stop();
});

test('bad app token stops reconnecting; bad bot token reported at start', async () => {
  FakeWebSocket.instances = [];
  const { ctx, events } = fakeCtx();
  const r = routes({ open: json({ ok: false, error: 'invalid_auth' }) });
  const w = createSlackWorker(ctx, { fetchFn: r.fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  await w.start();
  await waitFor(() => events.status.some((s) => /apps\.connections\.open failed: invalid_auth/.test(s.detail || '')));
  assert.equal(FakeWebSocket.instances.length, 0, 'no socket without a URL');
  await w.stop();

  const { ctx: ctx2, events: ev2 } = fakeCtx();
  const r2 = routes({ auth: json({ ok: false, error: 'invalid_auth' }) });
  const w2 = createSlackWorker(ctx2, { fetchFn: r2.fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  const info = await w2.start();
  assert.equal(info.identity, null);
  assert.ok(ev2.status.some((s) => /auth\.test failed.*botToken/.test(s.detail || '')));
  await w2.stop();
});

test('send: mrkdwn render + slack error mapping (ok:false convention, 429 ladder)', async () => {
  const { ctx } = fakeCtx();
  let mode = 'ok';
  const posts = [];
  const r = routes({
    post: () => {
      posts.push(1);
      if (mode === 'http429') return json({}, 429, { 'retry-after': '2' });
      if (mode === 'ratelimited') return json({ ok: false, error: 'ratelimited' });
      if (mode === 'invalid_auth') return json({ ok: false, error: 'invalid_auth' });
      if (mode === 'not_in_channel') return json({ ok: false, error: 'not_in_channel' });
      return json({ ok: true });
    },
  });
  const w = createSlackWorker(ctx, { fetchFn: r.fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });

  const msg = { title: 'Run done', body: [{ kind: 'markdown', value: '**bold** [pr](https://x)' }], severity: 'success' };
  assert.equal(renderToMrkdwn(msg), '*Run done*\n*bold* <https://x|pr>');
  assert.deepEqual(await w.send('C1', msg), { ok: true, chunks: 1 });

  mode = 'invalid_auth';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'auth');
  mode = 'not_in_channel';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'plugin' && /invite the bot/.test(e.message));
  mode = 'http429';
  posts.length = 0;
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'rate-limit');
  assert.equal(posts.length, 4, 'HTTP 429 walked the full ladder');
  mode = 'ratelimited';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'rate-limit', '200 ok:false ratelimited also ladders');
});

test('validateConfig: per-field errors pin the failing token', async () => {
  const both = await validateConfig({ botToken: 'xoxb', appToken: 'xapp' }, {
    fetchFn: async (url) => (url.endsWith('/auth.test')
      ? json({ ok: true, user: 'worca' })
      : json({ ok: false, error: 'invalid_auth' })),
  });
  assert.equal(both.ok, false);
  assert.deepEqual(both.errors.map((e) => e.field), ['appToken']);
  const ok = await validateConfig({ botToken: 'xoxb', appToken: 'xapp' }, {
    fetchFn: async (url) => (url.endsWith('/auth.test')
      ? json({ ok: true, user: 'worca' })
      : json({ ok: true, url: 'wss://x' })),
  });
  assert.deepEqual(ok, { ok: true, identity: '@worca' });
  const missing = await validateConfig({});
  assert.deepEqual(missing.errors.map((e) => e.field), ['botToken', 'appToken']);
});

test('start(): transient auth.test failure (5xx/429) throws so the supervisor restarts', async () => {
  const { ctx } = fakeCtx();
  const w = createSlackWorker(ctx, { fetchFn: async () => json({}, 503) });
  await assert.rejects(() => w.start(), (e) => /auth\.test failed: HTTP 503/.test(e.message) && e.kind === 'network');

  const { ctx: ctx429 } = fakeCtx();
  const w429 = createSlackWorker(ctx429, { fetchFn: async () => json({}, 429, { 'retry-after': '2' }) });
  await assert.rejects(() => w429.start(), (e) => /auth\.test failed: HTTP 429/.test(e.message) && e.kind === 'rate-limit');
});

test('start(): definitive invalid_auth still degrades without throwing', async () => {
  const { ctx, events } = fakeCtx();
  const w = createSlackWorker(ctx, { fetchFn: async () => json({ ok: false, error: 'invalid_auth' }) });
  const r = await w.start();
  assert.equal(r.identity, null);
  assert.equal(events.status.at(-1).state, 'disconnected');
  assert.match(events.status.at(-1).detail, /auth\.test failed: invalid_auth — check botToken/);
});

test('mrkdwn render escapes Slack control sequences in every segment kind', () => {
  const msg = { title: 'a <!channel> title', severity: 'info', body: [
    { kind: 'text', value: '<!here> & <void>' },
    { kind: 'bold', value: '<b>' },
    { kind: 'code', value: 'x < y' },
    { kind: 'code_block', value: 'a & b' },
    { kind: 'link', value: '<label>', href: 'https://x.test/?a=1&b=2' },
    { kind: 'markdown', value: 'plain <!channel> and `code <kept>`' },
  ]};
  const out = renderToMrkdwn(msg);
  assert.ok(!/<!channel>/.test(out), 'raw <!channel> must not survive');
  assert.match(out, /&lt;!here&gt; &amp; &lt;void&gt;/);
  assert.match(out, /\*&lt;b&gt;\*/);
  assert.match(out, /`x &lt; y`/);
  assert.match(out, /a &amp; b/);
  assert.match(out, /<https:\/\/x\.test\/\?a=1&amp;b=2\|&lt;label&gt;>/);
});
