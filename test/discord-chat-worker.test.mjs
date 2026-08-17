// test/discord-chat-worker.test.mjs — the discord-chat example plugin:
// gateway state machine (hello->identify->ready, heartbeat ACK loss -> resume,
// RECONNECT/INVALID_SESSION, close-code mapping 4004/4014) with a scripted
// FakeWebSocket, plus the ported REST send path (429 retry_after, kind
// mapping) and validateConfig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordWorker, validateConfig, renderToMarkdown } from '../plugins/discord-chat/channel/worker.mjs';
import { createGatewayClient, INTENTS } from '../plugins/discord-chat/channel/gateway.mjs';

const json = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.handlers = { message: [], close: [], error: [] };
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, cb, opts) { this.handlers[type].push({ cb, once: !!opts?.once }); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code) { this.dispatch('close', { code: code ?? 1000 }); }
  dispatch(type, ev) {
    const hs = this.handlers[type];
    this.handlers[type] = hs.filter((h) => !h.once);
    for (const h of hs) h.cb(ev);
  }
  frame(obj) { this.dispatch('message', { data: JSON.stringify(obj) }); }
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

function gatewayFixtureWith(over = {}) {
  const seen = { messages: [], states: [], fatals: [], logs: [] };
  const client = createGatewayClient({
    token: 'tok',
    gatewayUrl: 'wss://gw.test',
    WebSocketImpl: FakeWebSocket,
    _sleep: async () => {},
    random: () => 0.5,
    log: (l, m) => seen.logs.push(`${l}:${m}`),
    onMessage: (m) => seen.messages.push(m),
    onState: (s, d) => seen.states.push({ s, d: d ?? null }),
    onFatal: (d, k) => seen.fatals.push({ d, k }),
    ...over,
  });
  return { client, seen };
}

function gatewayFixture() { return gatewayFixtureWith(); }

test('gateway: hello -> identify (intents 33281) -> READY connected; dispatch flows', async () => {
  FakeWebSocket.instances = [];
  const { client, seen } = gatewayFixture();
  client.start();
  const s = await waitFor(() => FakeWebSocket.instances[0]);
  s.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  const identify = await waitFor(() => s.sent.find((f) => f.op === 2));
  assert.equal(identify.d.token, 'tok');
  assert.equal(identify.d.intents, INTENTS);
  assert.equal(INTENTS, 33281);
  s.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess1', resume_gateway_url: 'wss://resume.test', user: { id: 'BOT1', username: 'worca' } } });
  await waitFor(() => seen.states.some((x) => x.s === 'connected'));
  assert.equal(client.identity(), 'worca');
  s.frame({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: { id: 'm1', channel_id: 'C1', content: '/status', author: { id: 'U1', username: 'sam' } } });
  assert.equal(seen.messages[0].content, '/status');
  client.stop();
});

test('gateway: RECONNECT resumes with session+seq against resume_gateway_url', async () => {
  FakeWebSocket.instances = [];
  const { client } = gatewayFixture();
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s1.frame({ op: 0, t: 'READY', s: 5, d: { session_id: 'sess1', resume_gateway_url: 'wss://resume.test', user: {} } });
  s1.frame({ op: 7 }); // RECONNECT -> close -> reconnect via resume url
  const s2 = await waitFor(() => FakeWebSocket.instances[1]);
  assert.match(s2.url, /^wss:\/\/resume\.test/);
  s2.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  const resume = await waitFor(() => s2.sent.find((f) => f.op === 6));
  assert.deepEqual(resume.d, { token: 'tok', session_id: 'sess1', seq: 5 });
  client.stop();
});

test('gateway: missed heartbeat ACK closes and resumes; heartbeat carries seq', async () => {
  FakeWebSocket.instances = [];
  const { client, seen } = gatewayFixture();
  client.start();
  const s = await waitFor(() => FakeWebSocket.instances[0]);
  s.frame({ op: 10, d: { heartbeat_interval: 30 } }); // fast beats
  s.frame({ op: 0, t: 'READY', s: 9, d: { session_id: 'x', resume_gateway_url: null, user: {} } });
  await waitFor(() => s.sent.some((f) => f.op === 1 && f.d === 9), 2000);
  // never ACK -> next beat detects the zombie and closes -> reconnect
  await waitFor(() => FakeWebSocket.instances.length >= 2, 2000);
  assert.ok(seen.logs.some((l) => /ACK missed/.test(l)));
  client.stop();
});

test('gateway: 4004 -> fatal auth; 4014 -> fatal plugin naming the intent toggle; no retry', async () => {
  for (const [code, kind, re] of [[4004, 'auth', /rejected the bot token/], [4014, 'plugin', /MESSAGE CONTENT INTENT/]]) {
    FakeWebSocket.instances = [];
    const { client, seen } = gatewayFixture();
    client.start();
    const s = await waitFor(() => FakeWebSocket.instances[0]);
    s.close(code);
    await waitFor(() => seen.fatals.length === 1);
    assert.equal(seen.fatals[0].k, kind);
    assert.match(seen.fatals[0].d, re);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(FakeWebSocket.instances.length, 1, 'no reconnect after a fatal close');
    client.stop();
  }
});

function workerCtx(config = {}) {
  const events = { inbound: [], status: [], logs: [] };
  const ac = new AbortController();
  return {
    ctx: {
      apiVersion: 2, platform: 'discord', mock: false,
      config: { botToken: 'tok', ...config },
      state: { get: async () => null, set: async () => {} },
      log: (l, m) => events.logs.push(`${l}:${m}`),
      emitMessage: (m) => events.inbound.push(m),
      setStatus: (s, d) => events.status.push({ state: s, detail: d ?? null }),
      shutdownSignal: ac.signal,
    },
    events,
  };
}

test('worker: identity via /users/@me; bot/self/off-list messages filtered; empty-content hint', async () => {
  FakeWebSocket.instances = [];
  const { ctx, events } = workerCtx({ channelAllowlist: 'C1' });
  const fetchFn = async (url) => {
    if (url.endsWith('/users/@me')) return json({ id: 'BOT1', username: 'worca' });
    if (url.endsWith('/gateway/bot')) return json({ url: 'wss://gw.test', session_start_limit: { remaining: 100 } });
    throw new Error(`unexpected ${url}`);
  };
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  const info = await w.start();
  assert.equal(info.identity, '@worca');
  const s = await waitFor(() => FakeWebSocket.instances[0]);
  s.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'x', user: { id: 'BOT1' } } });
  for (const m of [
    { id: 'm1', channel_id: 'C1', content: '/status', author: { id: 'U1', username: 'sam' }, guild_id: 'G1' },
    { id: 'm2', channel_id: 'C1', content: 'from bot', author: { id: 'B9', bot: true } },
    { id: 'm3', channel_id: 'C1', content: 'self', author: { id: 'BOT1' } },
    { id: 'm4', channel_id: 'C9', content: 'off-list', author: { id: 'U1' } },
    { id: 'm5', channel_id: 'C1', content: '', author: { id: 'U1' } },
  ]) s.frame({ op: 0, t: 'MESSAGE_CREATE', s: 2, d: m });
  assert.deepEqual(events.inbound.map((m) => m.text), ['/status', '']);
  assert.deepEqual(events.inbound[0].meta, { platform: 'discord', messageId: 'm1', guildId: 'G1', username: 'sam' });
  assert.ok(events.logs.some((l) => /MESSAGE CONTENT INTENT/.test(l)), 'empty-content hint logged once');
  await w.stop();
});

test('worker send: markdown render, 2000 split, 429 retry_after, kind mapping', async () => {
  const { ctx } = workerCtx();
  let mode = 'ok';
  const posts = [];
  const fetchFn = async (url, opts) => {
    if (url.includes('/channels/')) {
      posts.push(JSON.parse(opts.body));
      if (mode === '429') return json({ retry_after: 0.5 }, 429);
      if (mode === '403') return json({ message: 'Missing Access' }, 403);
      return json({ id: 'sent' });
    }
    throw new Error(`unexpected ${url}`);
  };
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  const msg = { title: 'Run done', body: [{ kind: 'markdown', value: '**bold**' }], severity: 'success' };
  assert.equal(renderToMarkdown(msg), '**Run done**\n**bold**');
  await w.send('C1', msg);
  assert.equal(posts[0].content, '**Run done**\n**bold**');

  posts.length = 0;
  await w.send('C1', { title: null, body: [{ kind: 'text', value: `${'a'.repeat(1900)}\n${'b'.repeat(1900)}` }], severity: 'info' });
  assert.equal(posts.length, 2, '2000-char split');

  mode = '429';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'rate-limit');
  mode = '403';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'plugin' && /invite the bot/.test(e.message));
});

test('validateConfig: ok, 401 pins botToken, gateway failure reported', async () => {
  const ok = await validateConfig({ botToken: 't' }, {
    fetchFn: async (url) => (url.endsWith('/users/@me') ? json({ username: 'worca' }) : json({ url: 'wss://x' })),
  });
  assert.deepEqual(ok, { ok: true, identity: '@worca' });
  const bad = await validateConfig({ botToken: 't' }, { fetchFn: async () => json({}, 401) });
  assert.equal(bad.errors[0].field, 'botToken');
  const gw = await validateConfig({ botToken: 't' }, {
    fetchFn: async (url) => (url.endsWith('/users/@me') ? json({ username: 'worca' }) : json({}, 500)),
  });
  assert.match(gw.errors[0].message, /gateway\/bot failed: HTTP 500/);
});

test('start(): /gateway/bot 502 throws (supervisor retries)', async () => {
  const { ctx, events } = workerCtx();
  const fetchFn = async (url) => {
    if (url.endsWith('/users/@me')) return json({ id: '1', username: 'bot' });
    if (url.endsWith('/gateway/bot')) return json({}, 502);
    throw new Error(`unexpected ${url}`);
  };
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  await assert.rejects(() => w.start(), (e) => /gateway\/bot failed: HTTP 502/.test(e.message) && e.kind === 'network');
  assert.equal(events.status.at(-1).state, 'disconnected');
});

test('start(): gateway session limit exhausted throws instead of dying silently', async () => {
  const { ctx } = workerCtx();
  const fetchFn = async (url) => {
    if (url.endsWith('/users/@me')) return json({ id: '1', username: 'bot' });
    if (url.endsWith('/gateway/bot')) return json({ url: 'wss://gw.test', session_start_limit: { remaining: 0, reset_after: 120000 } });
    throw new Error(`unexpected ${url}`);
  };
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  await assert.rejects(() => w.start(), (e) => /session limit exhausted — resets in 2min/.test(e.message) && e.kind === 'rate-limit');
});

test('start(): 401 on /users/@me does NOT throw (definitive degrade)', async () => {
  const { ctx, events } = workerCtx();
  const w = createDiscordWorker(ctx, { fetchFn: async () => json({}, 401), WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  const r = await w.start();
  assert.equal(r.identity, null);
  assert.equal(events.status.at(-1).state, 'disconnected');
  assert.match(events.status.at(-1).detail, /check botToken/);
});

test('send(): every message body disables mention parsing', async () => {
  const bodies = [];
  const w = createDiscordWorker(workerCtx().ctx, {
    fetchFn: async (url, opts) => { if (opts?.method === 'POST') bodies.push(JSON.parse(opts.body)); return json({}); },
    WebSocketImpl: FakeWebSocket,
    _sleep: async () => {},
  });
  await w.send('123', { title: null, body: [{ kind: 'text', value: 'hi @everyone <@42>' }], severity: 'info' });
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].allowed_mentions, { parse: [] });
});

test('start(): a non-401 /users/@me failure throws and is not relabelled "network error"', async () => {
  const { ctx, events } = workerCtx();
  const w = createDiscordWorker(ctx, { fetchFn: async () => json({}, 503), WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  await assert.rejects(() => w.start(), /users\/@me failed: HTTP 503/);
  assert.ok(!/network error/.test(events.status.at(-1)?.detail || ''), 'HTTP failure must not be relabelled "network error"');
});

// Gateway timer hygiene: the INVALID_SESSION delayed close must stay bound to
// the socket that received the frame, and the steady heartbeat interval must
// chain after the jittered first beat instead of racing it. REAL timers here —
// mock timers deadlock against the promise-driven connect loop.
class RecordingWS extends FakeWebSocket {
  close(code) { this.closedWith = code ?? 1000; super.close(code); }
}
class BeatWS extends FakeWebSocket {
  constructor(url) { super(url); this.beats = []; }
  send(data) {
    super.send(data);
    const f = JSON.parse(data);
    if (f.op === 1) { this.beats.push(Date.now()); this.frame({ op: 11 }); } // auto-ACK
  }
}

test('gateway: INVALID_SESSION close timer never fires on a replacement socket', async (t) => {
  FakeWebSocket.instances = [];
  // random:()=>0 → the delayed close lands at exactly 1000ms.
  const { client } = gatewayFixtureWith({ WebSocketImpl: RecordingWS, random: () => 0 });
  t.after(() => client.stop()); // a failing assert must not leave timers alive
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s1.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess', user: { username: 'bot' } } });
  s1.frame({ op: 9, d: true });          // INVALID_SESSION arms the delayed close on s1
  s1.close(4900);                        // client reconnects → s2
  const s2 = await waitFor(() => FakeWebSocket.instances[1]);
  await new Promise((r) => setTimeout(r, 1300)); // past the 1000ms timer
  assert.equal(s2.closedWith, undefined, 'stale timer must not kill the replacement');
  await client.stop();
});

test('gateway: INVALID_SESSION still closes the socket that received it', async (t) => {
  FakeWebSocket.instances = [];
  const { client } = gatewayFixtureWith({ WebSocketImpl: RecordingWS, random: () => 0 });
  t.after(() => client.stop());
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s1.frame({ op: 9, d: true });
  await waitFor(() => s1.closedWith !== undefined);
  assert.equal(s1.closedWith, 4901);
  await client.stop();
});

test('gateway: heartbeat interval starts AFTER the jittered first beat, not in parallel', async (t) => {
  FakeWebSocket.instances = [];
  const { client } = gatewayFixtureWith({ WebSocketImpl: BeatWS, random: () => 0.5 });
  t.after(() => client.stop());
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100 } });
  await waitFor(() => s1.beats.length >= 4, 2000);
  const gaps = s1.beats.slice(1).map((t, i) => t - s1.beats[i]);
  for (const g of gaps) assert.ok(g >= 85, `beat gap ${g}ms < 85ms — the interval raced the jittered first beat (gaps: ${gaps})`);
  assert.equal(FakeWebSocket.instances.length, 1, 'no spurious ackPending self-kill / reconnect');
  await client.stop();
});
