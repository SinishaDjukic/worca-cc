// test/discord-chat-worker.test.mjs — the discord-chat example plugin:
// gateway state machine (hello->identify->ready, heartbeat ACK loss -> resume,
// RECONNECT/INVALID_SESSION, close-code mapping 4004/4014) with a scripted
// FakeWebSocket, plus the ported REST send path (429 retry_after, kind
// mapping) and validateConfig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiscordWorker, validateConfig, renderToMarkdown, renderComponents, parseCustomId, toInteraction } from '../plugins/discord-chat/channel/worker.mjs';
import { createGatewayClient, INTENTS } from '../plugins/discord-chat/channel/gateway.mjs';
import { checkRows } from './helpers/rows.mjs';

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

function workerCtx(config = {}, { state = {} } = {}) {
  const events = { inbound: [], status: [], logs: [], interactions: [] };
  const ac = new AbortController();
  return {
    ctx: {
      apiVersion: 2, platform: 'discord', mock: false,
      config: { botToken: 'tok', ...config },
      state: { get: async (k) => (state[k] ?? null), set: async (k, v) => { state[k] = v; } },
      log: (l, m) => events.logs.push(`${l}:${m}`),
      emitMessage: (m) => events.inbound.push(m),
      emitInteraction: (e) => events.interactions.push(e),
      setStatus: (s, d) => events.status.push({ state: s, detail: d ?? null }),
      shutdownSignal: ac.signal,
    },
    events,
    state,
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
  assert.deepEqual(events.inbound[0].meta, { platform: 'discord', messageId: 'm1', guildId: 'G1', username: 'sam', isGroup: true, mentionsBot: false, botId: 'BOT1' });
  s.frame({ op: 0, t: 'MESSAGE_CREATE', s: 3, d: { id: 'm6', channel_id: 'C1', content: '<@BOT1> hi', author: { id: 'U1', username: 'sam' }, guild_id: 'G1', mentions: [{ id: 'BOT1' }] } });
  assert.equal(events.inbound.at(-1).meta.mentionsBot, true);
  assert.equal(events.inbound.at(-1).meta.botId, 'BOT1');
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
      if (/^\d{3}$/.test(mode)) return json({ message: 'x' }, Number(mode));
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
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'plugin' && e.permanent === true && /invite the bot/.test(e.message));
  // Only a refusal that fails again is permanent: 404 and 400 are; an outage (5xx) and other statuses are not.
  mode = '404';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'plugin' && e.permanent === true);
  mode = '400';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'plugin' && e.permanent === true);
  for (const m of ['500', '502', '503', '504']) {
    mode = m;
    await assert.rejects(w.send('C1', msg), (e) => e.kind === 'network' && e.permanent !== true, `HTTP ${m}`);
  }
  mode = '409';
  await assert.rejects(w.send('C1', msg), (e) => e.kind === 'plugin' && e.permanent !== true);
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

test('start() failure modes: 401 degrades without throwing; 503 /users/@me, 502 /gateway/bot and an exhausted session limit throw with the right kind', async () => {
  await checkRows([
    { name: 'start(): /gateway/bot 502 throws (supervisor retries)', run: async () => {
      const { ctx, events } = workerCtx();
      const fetchFn = async (url) => {
        if (url.endsWith('/users/@me')) return json({ id: '1', username: 'bot' });
        if (url.endsWith('/gateway/bot')) return json({}, 502);
        throw new Error(`unexpected ${url}`);
      };
      const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
      await assert.rejects(() => w.start(), (e) => /gateway\/bot failed: HTTP 502/.test(e.message) && e.kind === 'network');
      assert.equal(events.status.at(-1).state, 'disconnected');
    } },
    { name: 'start(): gateway session limit exhausted throws instead of dying silently', run: async () => {
      const { ctx } = workerCtx();
      const fetchFn = async (url) => {
        if (url.endsWith('/users/@me')) return json({ id: '1', username: 'bot' });
        if (url.endsWith('/gateway/bot')) return json({ url: 'wss://gw.test', session_start_limit: { remaining: 0, reset_after: 120000 } });
        throw new Error(`unexpected ${url}`);
      };
      const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
      await assert.rejects(() => w.start(), (e) => /session limit exhausted — resets in 2min/.test(e.message) && e.kind === 'rate-limit');
    } },
    { name: 'start(): 401 on /users/@me does NOT throw (definitive degrade)', run: async () => {
      const { ctx, events } = workerCtx();
      const w = createDiscordWorker(ctx, { fetchFn: async () => json({}, 401), WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
      const r = await w.start();
      assert.equal(r.identity, null);
      assert.equal(events.status.at(-1).state, 'disconnected');
      assert.match(events.status.at(-1).detail, /check botToken/);
    } },
    { name: 'start(): a non-401 /users/@me failure throws and is not relabelled "network error"', run: async () => {
      const { ctx, events } = workerCtx();
      const w = createDiscordWorker(ctx, { fetchFn: async () => json({}, 503), WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
      await assert.rejects(() => w.start(), /users\/@me failed: HTTP 503/);
      assert.ok(!/network error/.test(events.status.at(-1)?.detail || ''), 'HTTP failure must not be relabelled "network error"');
    } },
  ]);
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

test('gateway: the INVALID_SESSION delayed close hits only the socket that received it', async () => {
  // Two clients run concurrently, so the 1 s delayed-close timer is paid once.
  // Each records its own sockets (FakeWebSocket.instances is shared by both) and
  // stops in its own finally: a failing assert must not leave timers alive.
  const clientRun = async (body) => {
    const sockets = [];
    class OwnWS extends RecordingWS { constructor(url) { super(url); sockets.push(this); } }
    // random:()=>0 → the delayed close lands at exactly 1000ms.
    const { client } = gatewayFixtureWith({ WebSocketImpl: OwnWS, random: () => 0 });
    try { await body(client, sockets); } finally { await client.stop(); }
  };
  const replacement = clientRun(async (client, sockets) => {
    client.start();
    const s1 = await waitFor(() => sockets[0]);
    s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
    s1.frame({ op: 0, t: 'READY', s: 1, d: { session_id: 'sess', user: { username: 'bot' } } });
    s1.frame({ op: 9, d: true });          // INVALID_SESSION arms the delayed close on s1
    s1.close(4900);                        // client reconnects → s2
    const s2 = await waitFor(() => sockets[1]);
    await new Promise((r) => setTimeout(r, 1300)); // past the 1000ms timer
    assert.equal(s2.closedWith, undefined, 'stale timer must not kill the replacement');
  });
  const received = clientRun(async (client, sockets) => {
    client.start();
    const s1 = await waitFor(() => sockets[0]);
    s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
    s1.frame({ op: 9, d: true });
    await waitFor(() => s1.closedWith !== undefined);
    assert.equal(s1.closedWith, 4901);
  });
  // The rows await these in order; a run that fails before its row is reached
  // must not surface as an unhandled rejection.
  replacement.catch(() => {});
  received.catch(() => {});
  await checkRows([
    { name: 'gateway: INVALID_SESSION close timer never fires on a replacement socket', run: () => replacement },
    { name: 'gateway: INVALID_SESSION still closes the socket that received it', run: () => received },
  ]);
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

test('gateway: close 4007 (invalid seq) drops the session and re-IDENTIFIES', async () => {
  FakeWebSocket.instances = [];
  const { client } = gatewayFixture();
  client.start();
  const s1 = await waitFor(() => FakeWebSocket.instances[0]);
  s1.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  s1.frame({ op: 0, t: 'READY', s: 5, d: { session_id: 'sess1', resume_gateway_url: 'wss://resume.test', user: {} } });
  s1.close(4007);
  const s2 = await waitFor(() => FakeWebSocket.instances[1]);
  assert.match(s2.url, /^wss:\/\/gw\.test/, 'not the resume url');
  s2.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  await waitFor(() => s2.sent.find((f) => f.op === 2));
  assert.equal(s2.sent.find((f) => f.op === 6), undefined, 'no RESUME with a dead session');
  client.stop();
});

test('V20: the README never promises DMs while the gateway lacks the DIRECT_MESSAGES intent', async () => {
  const { readFile } = await import('node:fs/promises');
  const readme = await readFile(new URL('../plugins/discord-chat/README.md', import.meta.url), 'utf8');
  const DIRECT_MESSAGES = 1 << 12;
  assert.equal(INTENTS & DIRECT_MESSAGES, 0);
  assert.doesNotMatch(readme, /direct\s+message to the bot always works/);
  assert.match(readme, /DIRECT_MESSAGES intent/);
});

test('renderComponents: selects own a row, buttons 5 per row, links have url and no custom_id', () => {
  const ref = (n) => `ref${n}`.padEnd(24, 'x');
  const rows = renderComponents([
    ...Array.from({ length: 6 }, (_, n) => ({ kind: 'button', ref: ref(n), label: `B${n}`, style: 'primary' })),
    { kind: 'link', label: 'Open in worca', url: 'https://w.example/#chat/ask_0123abcd' },
    { kind: 'select', ref: ref(9), placeholder: 'Scope', options: [{ value: 'none', label: 'No project' }] },
  ]);
  assert.deepEqual(rows.map((r) => r.components.length), [5, 2, 1]);
  assert.equal(rows[0].components[0].custom_id, `w:${ref(0)}`);
  const modalRow = renderComponents([{ kind: 'button', ref: ref(1), label: 'Answer', style: 'primary',
    modal: { title: 'Answer', fields: [{ id: 'text', label: 'Answer', style: 'paragraph', required: true, maxLength: 2000 }] } }]);
  assert.equal(modalRow[0].components[0].custom_id, `w:m:${ref(1)}`, 'a modal button is marked in its own id');
  assert.deepEqual(parseCustomId(`w:m:${ref(1)}`), { ref: ref(1), opensModal: true });
  assert.deepEqual(parseCustomId(`w:${ref(1)}`), { ref: ref(1), opensModal: false });
  assert.equal(parseCustomId('w:short'), null);
  assert.equal(parseCustomId('other'), null);
  assert.deepEqual(rows[1].components[1], { type: 2, style: 5, label: 'Open in worca', url: 'https://w.example/#chat/ask_0123abcd' });
  assert.equal(rows[2].components[0].type, 3);
});

test('interactions: ack type 6 then emit; modal buttons ack with type 9 and emit only the submit; token never emitted', async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/users/@me')) return json({ id: 'BOT1', username: 'worca' });
    if (String(url).endsWith('/gateway/bot')) return json({ url: 'wss://gw.test', session_start_limit: { remaining: 100 } });
    if (String(url).includes('/channels/T1/messages')) return json({ id: 'M9' });
    return json({});
  };
  const { ctx, events } = workerCtx({});
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  await w.start();
  const s = await waitFor(() => FakeWebSocket.instances.at(-1));
  s.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  const REF = 'AbCdEfGhIjKlMnOpQrStUvWx';
  await w.send('T1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'q' }],
    controls: [{ kind: 'button', ref: REF, label: 'Answer', style: 'primary',
      modal: { title: 'Answer', fields: [{ id: 'text', label: 'Answer', style: 'paragraph', required: true, maxLength: 2000 }] } }] });
  s.frame({ op: 0, t: 'INTERACTION_CREATE', s: 3, d: { id: 'I1', token: 'SECRET-TOKEN', application_id: 'APP', type: 3,
    channel_id: 'T1', member: { user: { id: 'U1', username: 'sam' } }, data: { custom_id: `w:m:${REF}`, component_type: 2 } } });
  await waitFor(() => calls.find((c) => c.url.includes('/interactions/I1/')));
  assert.equal(calls.find((c) => c.url.includes('/interactions/I1/')).body.type, 9);
  assert.equal(events.interactions.length, 0, 'the modal open is not a host event');
  s.frame({ op: 0, t: 'INTERACTION_CREATE', s: 4, d: { id: 'I2', token: 'SECRET-TOKEN-2', application_id: 'APP', type: 5,
    channel_id: 'T1', member: { user: { id: 'U1' } }, data: { custom_id: `w:${REF}`, components: [{ type: 1, components: [{ type: 4, custom_id: 'text', value: 'focus on tests' }] }] } } });
  await waitFor(() => events.interactions.length === 1);
  assert.equal(calls.find((c) => c.url.includes('/interactions/I2/')).body.type, 6);
  assert.deepEqual(events.interactions[0], { id: 'I2', chatId: 'T1', userId: 'U1', ref: REF, kind: 'modal', fields: { text: 'focus on tests' },
    meta: { platform: 'discord', guildId: null, messageId: null, username: null } });
  assert.equal(JSON.stringify(events).includes('SECRET-TOKEN'), false);
  await w.replyInteraction('I2', 'Only the owner can act.');
  const follow = calls.find((c) => c.url.endsWith('/webhooks/APP/SECRET-TOKEN-2'));
  assert.deepEqual(follow.body, { content: 'Only the owner can act.', flags: 64, allowed_mentions: { parse: [] } });
  await assert.rejects(w.replyInteraction('nope', 'x'), /interaction expired/);
  s.frame({ op: 0, t: 'INTERACTION_CREATE', s: 5, d: { id: 'I3', token: 't', type: 3, channel_id: 'T1', member: { user: { id: 'U1' } }, data: { custom_id: 'someone-else', component_type: 2 } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.some((c) => c.url.includes('/interactions/I3/')), false, 'foreign custom_ids are not ours to answer');
  // Discord's Label (type 18) modal layout is read too.
  assert.deepEqual(toInteraction({ id: 'I9', type: 5, channel_id: 'T1', member: { user: { id: 'U1' } },
    data: { custom_id: `w:${REF}`, components: [{ type: 18, id: 1, component: { type: 4, custom_id: 'text', value: 'via label' } }] } }).fields, { text: 'via label' });
  await w.stop();
});

test('send options: thread from message, edit in place, ids returned; mention flag on inbound', async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/threads')) return json({ id: 'TH1' });
    if (String(url).includes('/messages')) return json({ id: init.method === 'PATCH' ? 'M1' : 'M2' });
    return json({});
  };
  const { ctx } = workerCtx({});
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  const msg = { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'hello' }] };
  assert.deepEqual(await w.send('C1', msg, { thread: { fromMessageId: 'U-MSG', name: 'worca chat' } }), { ok: true, chunks: 1, messageIds: ['M2'], threadId: 'TH1' });
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/C1/messages/U-MSG/threads');
  assert.equal(calls[1].url, 'https://discord.com/api/v10/channels/TH1/messages');
  assert.deepEqual(await w.send('TH1', msg, { edit: { messageId: 'M1' } }), { ok: true, messageIds: ['M1'] });
  assert.equal(calls[2].method, 'PATCH');
  assert.deepEqual(calls[2].body.components, []);
});

const startedWorker = async (config, opts = {}) => {
  FakeWebSocket.instances = [];
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/users/@me')) return json({ id: 'BOT1', username: 'worca' });
    if (String(url).endsWith('/gateway/bot')) return json({ url: 'wss://gw.test', session_start_limit: { remaining: 100 } });
    if (String(url).endsWith('/threads')) return json({ id: 'TH1' });
    if (String(url).includes('/messages')) return json({ id: 'M1' });
    return json({});
  };
  const wc = workerCtx(config, opts);
  const w = createDiscordWorker(wc.ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });
  await w.start();
  const s = await waitFor(() => FakeWebSocket.instances.at(-1));
  s.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  return { w, s, calls, ...wc };
};
const threadMsg = (s, id) => s.frame({ op: 0, t: 'MESSAGE_CREATE', s: 9, d: { id, channel_id: 'TH1', guild_id: 'G1',
  content: 'continue please', author: { id: 'U1', username: 'sam' }, mentions: [] } });

test('channelAllowlist: messages in a thread this worker created are admitted, also after a restart; others are not', async () => {
  const first = await startedWorker({ channelAllowlist: 'C1' });
  threadMsg(first.s, 'm-before');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(first.events.inbound.length, 0, 'unknown thread: still filtered');
  await first.w.send('C1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'hi' }] }, { thread: { fromMessageId: 'U-MSG', name: 'worca chat' } });
  assert.deepEqual(first.state.freeformThreads, ['TH1']);
  threadMsg(first.s, 'm-after');
  await waitFor(() => first.events.inbound.length === 1);
  assert.equal(first.events.inbound[0].chatId, 'TH1');
  await first.w.stop();
  // A new worker process with the persisted state (the host replays ctx.state in `hello`).
  const second = await startedWorker({ channelAllowlist: 'C1' }, { state: { freeformThreads: ['TH1'] } });
  threadMsg(second.s, 'm-restart');
  await waitFor(() => second.events.inbound.length === 1);
  second.s.frame({ op: 0, t: 'MESSAGE_CREATE', s: 10, d: { id: 'm-other', channel_id: 'TH-OTHER', guild_id: 'G1', content: 'x', author: { id: 'U1' }, mentions: [] } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(second.events.inbound.length, 1, 'a thread the bot did not create stays filtered');
  await second.w.stop();
});

test('a fresh worker (no memory of the post) still opens a modal for a w:m: button, titled from the button label', async () => {
  const { w, s, calls, events } = await startedWorker({});
  const REF = 'ZyXwVuTsRqPoNmLkJiHgFeDc';
  s.frame({ op: 0, t: 'INTERACTION_CREATE', s: 3, d: { id: 'I7', token: 'TOK7', application_id: 'APP', type: 3, channel_id: 'TH1',
    member: { user: { id: 'U1' } }, data: { custom_id: `w:m:${REF}`, component_type: 2 },
    message: { id: 'M5', components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Request changes', custom_id: `w:m:${REF}` }] }] } } });
  await waitFor(() => calls.find((c) => c.url.includes('/interactions/I7/')));
  const cb = calls.find((c) => c.url.includes('/interactions/I7/')).body;
  assert.equal(cb.type, 9);
  assert.equal(cb.data.custom_id, `w:${REF}`, 'the submit comes back on the plain id');
  assert.equal(cb.data.title, 'Request changes');
  assert.deepEqual(cb.data.components[0].components[0], { type: 4, custom_id: 'text', label: 'Your answer', style: 2, required: true, max_length: 2000 });
  assert.equal(events.interactions.length, 0);
  await w.stop();
});

test('interactions: a valid-shaped id without the w: prefix, a bot, or an off-list channel is never acked or emitted', async () => {
  const { w, s, calls, events } = await startedWorker({ channelAllowlist: 'C1' });
  const REF = 'AbCdEfGhIjKlMnOpQrStUvWx';
  const click = (id, over) => s.frame({ op: 0, t: 'INTERACTION_CREATE', s: 20, d: { id, token: 't', application_id: 'APP', type: 3,
    channel_id: 'C1', member: { user: { id: 'U1' } }, data: { custom_id: `w:${REF}`, component_type: 2 }, ...over } });
  click('F1', { data: { custom_id: REF, component_type: 2 } });
  click('F2', { member: { user: { id: 'B9', bot: true } } });
  click('F3', { channel_id: 'C9' });
  click('F4', { channel_id: 'TH9', channel: { id: 'TH9', parent_id: 'C1' } });
  await waitFor(() => events.interactions.length === 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.filter((c) => c.url.includes('/interactions/')).map((c) => c.url.split('/')[6]), ['F4']);
  assert.equal(events.interactions[0].id, 'F4');
  assert.equal(parseCustomId(REF), null, 'only our w: ids are ours');
  await w.stop();
});

test('replyInteraction refuses a token older than 14 minutes', async () => {
  const { w, s, events } = await startedWorker({});
  s.frame({ op: 0, t: 'INTERACTION_CREATE', s: 21, d: { id: 'I8', token: 'TOK8', application_id: 'APP', type: 3, channel_id: 'T1',
    member: { user: { id: 'U1' } }, data: { custom_id: 'w:AbCdEfGhIjKlMnOpQrStUvWx', component_type: 2 } } });
  await waitFor(() => events.interactions.length === 1);
  const realNow = Date.now;
  Date.now = () => realNow() + 14 * 60 * 1000 + 1;
  try { await assert.rejects(w.replyInteraction('I8', 'late'), /interaction expired/); } finally { Date.now = realNow; }
  await w.stop();
});

test('worker react: PUT/DELETE only the bot\'s own reaction, emoji encoded; 429 waits retry_after; 403/404/400 permanent; 5xx network', async () => {
  const { ctx } = workerCtx();
  const calls = [];
  let mode = 'ok';
  let limited = 0;
  const fetchFn = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body });
    if (mode === 'limit' && limited++ === 0) return json({ retry_after: 0.25 }, 429);
    if (mode === 'long') return json({ retry_after: 30 }, 429);
    if (/^\d{3}$/.test(mode)) return json({ message: 'x' }, Number(mode));
    return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
  };
  const sleeps = [];
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(await w.react('C1', 'M1', '⏹️', true), { ok: true });
  assert.equal(calls[0].url, `https://discord.com/api/v10/channels/C1/messages/M1/reactions/${encodeURIComponent('⏹️')}/@me`);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, undefined);
  await w.react('C1', 'M1', '⏳', false);
  assert.equal(calls[1].method, 'DELETE');
  assert.match(calls[1].url, /\/reactions\/[^/]+\/@me$/);
  mode = 'limit'; calls.length = 0;
  await w.react('C1', 'M1', '✅', true);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [250]);
  mode = 'long'; calls.length = 0;   // a long retry_after goes back to the host (its chain waits in order)
  await assert.rejects(w.react('C1', 'M1', '✅', true), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 30000 && e.permanent !== true);
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, [250], 'the worker did not sleep');
  mode = '403';
  await assert.rejects(w.react('C1', 'M1', '✅', true), (e) => e.kind === 'plugin' && e.permanent === true && /Add Reactions/.test(e.message));
  mode = '404';
  await assert.rejects(w.react('C1', 'M1', '✅', true), (e) => e.kind === 'plugin' && e.permanent === true);
  mode = '400';
  await assert.rejects(w.react('C1', 'M1', '✅', true), (e) => e.kind === 'plugin' && e.permanent === true);
  mode = '503';
  await assert.rejects(w.react('C1', 'M1', '✅', true), (e) => e.kind === 'network' && e.permanent !== true);
});

// ── chat context (0.4.0): replies, attachments, history ────────────────────────────────────────────────────────────
const { isValidIncoming, isValidHistory } = await import('../src/core/chat/channel-protocol.mjs');
const ctxWorker = async (route, config = {}, state = {}) => {
  FakeWebSocket.instances = [];
  const calls = [];
  const sleeps = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET' });
    if (u.endsWith('/users/@me')) return json({ id: 'BOT1', username: 'worca' });
    if (u.endsWith('/gateway/bot')) return json({ url: 'wss://gw.test', session_start_limit: { remaining: 100 } });
    return route(u, init) ?? json({});
  };
  const wc = workerCtx(config, { state });
  const w = createDiscordWorker(wc.ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async (ms) => { sleeps.push(ms); } });
  await w.start();
  const s = await waitFor(() => FakeWebSocket.instances.at(-1));
  s.frame({ op: 10, d: { heartbeat_interval: 100000 } });
  let seq = 10;
  const post = (d) => s.frame({ op: 0, t: 'MESSAGE_CREATE', s: ++seq, d: { guild_id: 'G1', channel_id: 'C1', author: { id: 'U1', username: 'sam' },
    mentions: [], timestamp: '2026-11-03T10:00:00.000000+00:00', ...d } });
  return { w, s, calls, sleeps, post, ...wc };
};
const ATT = { id: 'a1', filename: 'notes.md', size: 12, content_type: 'text/markdown; charset=utf-8',
  url: 'https://cdn.discordapp.com/attachments/C1/a1/notes.md?ex=1&is=2&hm=3', proxy_url: 'https://media.discordapp.net/attachments/C1/a1/notes.md' };
const REFMSG = { id: 'r1', channel_id: 'C1', content: 'the original', timestamp: '2026-11-03T09:58:00.123456+00:00',
  author: { id: 'U2', username: 'alice', global_name: 'Alice' }, attachments: [ATT] };
const MENTION = [{ id: 'BOT1' }];

test('worker chat context: a mention replying to a message carries it, its files and the mention\'s own files; no fetch when delivered', async () => {
  const { post, events, calls } = await ctxWorker(() => null);
  post({ id: 'm1', content: '<@BOT1> what does it say?', mentions: MENTION,
    attachments: [{ ...ATT, id: 'a2', filename: 'mine.png', content_type: 'image/png' }],
    message_reference: { type: 0, message_id: 'r1', channel_id: 'C1', guild_id: 'G1' }, referenced_message: REFMSG });
  const m = events.inbound.at(-1);
  assert.equal(isValidIncoming(m), true);
  assert.deepEqual(m.replyTo, { author: 'Alice', text: 'the original', at: '2026-11-03T09:58:00.123Z', link: 'https://discord.com/channels/G1/C1/r1',
    attachments: [{ name: 'notes.md', contentType: 'text/markdown; charset=utf-8', size: 12, url: ATT.url }] });
  assert.deepEqual(m.attachments, [{ name: 'mine.png', contentType: 'image/png', size: 12, url: ATT.url }]);
  assert.equal(m.meta.link, 'https://discord.com/channels/G1/C1/m1');
  assert.equal(calls.filter((c) => c.url.includes('/messages/')).length, 0, 'delivered on the event: no fetch');
});

test('worker chat context: a missing referenced_message is fetched once; a refused read still delivers the message; order holds', async () => {
  let mode = 'ok';
  const { post, events, calls } = await ctxWorker((u) => {
    if (u.endsWith('/channels/C1/messages/r1')) return mode === 'ok' ? json(REFMSG) : json({ message: 'x' }, Number(mode));
    return null;
  });
  post({ id: 'm1', content: '<@BOT1> and this?', mentions: MENTION, message_reference: { message_id: 'r1', channel_id: 'C1' } });
  post({ id: 'm2', content: 'chatter right after' });
  await waitFor(() => events.inbound.length === 2);
  assert.deepEqual(events.inbound.map((x) => x.meta.messageId), ['m1', 'm2'], 'the later message waits for the read');
  assert.equal(events.inbound[0].replyTo.author, 'Alice');
  assert.equal(calls.filter((c) => c.url.endsWith('/messages/r1')).length, 1);
  for (const status of ['403', '404', '429', '500']) {
    mode = status;
    post({ id: `x${status}`, content: '<@BOT1> again', mentions: MENTION, message_reference: { message_id: 'r1', channel_id: 'C1' } });
    const m = await waitFor(() => events.inbound.find((x) => x.meta.messageId === `x${status}`));
    assert.equal(m.replyTo, undefined, status);
    assert.equal(m.text, '<@BOT1> again');
  }
  assert.ok(events.logs.some((l) => /replied-to message not read: HTTP 403 \(the bot needs Read Message History\)/.test(l)));
});

test('worker chat context: only a mention or a bot thread gets reply context; deleted, forwarded and cross-channel references are skipped', async () => {
  const { post, events, calls } = await ctxWorker(() => null);
  post({ id: 'c1', content: 'just chatting', message_reference: { message_id: 'r1' }, referenced_message: REFMSG });
  post({ id: 'c2', content: '<@BOT1> gone', mentions: MENTION, message_reference: { message_id: 'r9' }, referenced_message: null });
  post({ id: 'c3', content: '<@BOT1> fwd', mentions: MENTION, message_reference: { type: 1, message_id: 'r1', channel_id: 'C1' } });
  post({ id: 'c4', content: '<@BOT1> elsewhere', mentions: MENTION, message_reference: { message_id: 'r1', channel_id: 'C7' } });
  await waitFor(() => events.inbound.length === 4);
  assert.deepEqual(events.inbound.map((x) => 'replyTo' in x), [false, false, false, false]);
  assert.equal(calls.filter((c) => c.url.includes('/messages/r')).length, 0, 'nothing fetched');
  assert.deepEqual(events.inbound[0].meta, { platform: 'discord', messageId: 'c1', guildId: 'G1', username: 'sam', isGroup: true, mentionsBot: false, botId: 'BOT1' },
    'no files: the meta is exactly what it was');
});

test('worker chat context: in its own thread a Reply to worca\'s message carries no reply (it answers a question card); a reply to a person still does', async () => {
  const BOTMSG = { id: 'b1', channel_id: 'TH1', content: 'Which branch?', timestamp: '2026-11-03T09:59:00.000000+00:00',
    author: { id: 'BOT1', username: 'worca', bot: true }, attachments: [ATT] };
  const { post, events, calls } = await ctxWorker((u) => (u.endsWith('/channels/TH1/messages/b1') ? json(BOTMSG) : null), {}, { freeformThreads: ['TH1'] });
  post({ id: 't1', channel_id: 'TH1', content: 'dev', message_reference: { type: 0, message_id: 'b1', channel_id: 'TH1' }, referenced_message: BOTMSG });
  post({ id: 't2', channel_id: 'TH1', content: 'dev', message_reference: { message_id: 'b1', channel_id: 'TH1' } });
  post({ id: 't3', channel_id: 'TH1', content: 'see this', message_reference: { message_id: 'r1', channel_id: 'TH1' },
    referenced_message: { ...REFMSG, channel_id: 'TH1' } });
  post({ id: 't4', content: '<@BOT1> about that', mentions: MENTION, message_reference: { message_id: 'b0', channel_id: 'C1' },
    referenced_message: { ...BOTMSG, id: 'b0', channel_id: 'C1' } });
  await waitFor(() => events.inbound.length === 4);
  const by = (id) => events.inbound.find((x) => x.meta.messageId === id);
  assert.equal('replyTo' in by('t1'), false, 'a Reply to worca\'s own message in its thread: already in the conversation');
  assert.equal('replyTo' in by('t2'), false, 'the same when the event came without the message and it was read');
  assert.equal(by('t3').replyTo?.author, 'Alice', 'a reply to a person in the thread keeps its context');
  assert.equal(by('t4').replyTo?.text, 'Which branch?', 'a start mention replying to worca\'s message keeps it');
  assert.equal(calls.filter((c) => c.url.endsWith('/messages/b1')).length, 1);
});

test('worker history(): oldest first, other bots skipped, worca kept, system rows dropped; only a seen, allowed server channel', async () => {
  const page = [   // Discord answers newest first
    { id: 'h4', type: 0, channel_id: 'C1', content: 'newest', timestamp: '2026-11-03T09:59:00Z', author: { id: 'U3', username: 'bob' } },
    { id: 'h3', type: 0, channel_id: 'C1', content: 'beep', timestamp: '2026-11-03T09:58:00Z', author: { id: 'B9', username: 'otherbot', bot: true } },
    { id: 'h2', type: 19, channel_id: 'C1', content: 'my answer', timestamp: '2026-11-03T09:57:00Z', author: { id: 'BOT1', username: 'worca', bot: true } },
    { id: 'h1', type: 7, channel_id: 'C1', content: '', timestamp: '2026-11-03T09:56:00Z', author: { id: 'U4', username: 'newcomer' } },
    { id: 'h0', type: 0, channel_id: 'C1', content: 'oldest', timestamp: '2026-11-03T09:55:00Z', author: { id: 'U2', username: 'alice', global_name: 'Alice' }, member: { nick: 'Ally' }, attachments: [ATT] },
  ];
  let mode = 'ok';
  let limited = 0;
  const { w, post, calls, sleeps } = await ctxWorker((u) => {
    if (!u.includes('/messages?')) return null;
    if (mode === 'limit' && limited++ === 0) return json({ retry_after: 0.5 }, 429);
    if (mode === 'long') return json({ retry_after: 30 }, 429);
    if (mode === 'huge') return json(Array.from({ length: 50 }, (_, i) => ({ ...page[0], id: `z${i}`, content: 'x'.repeat(4000),
      attachments: Array.from({ length: 10 }, () => ({ ...ATT, url: `https://cdn.discordapp.com/${'a'.repeat(2000)}` })) })));
    if (/^\d{3}$/.test(mode)) return json({ message: 'x' }, Number(mode));
    return json(page);
  }, { channelAllowlist: 'C1,D1' });
  await assert.rejects(w.history('C1', 'm1', 20), (e) => e.permanent === true && /allowed server channel/.test(e.message), 'no server message seen there yet');
  post({ id: 'm1', content: 'hello' });
  post({ id: 'd1', channel_id: 'D1', guild_id: null, content: 'a dm' });
  const list = await w.history('C1', 'm1', 20);
  assert.equal(calls.at(-1).url, 'https://discord.com/api/v10/channels/C1/messages?before=m1&limit=20');
  assert.deepEqual(list.map((q) => [q.author, q.text]), [['Ally', 'oldest'], ['worca (this bot)', 'my answer'], ['bob', 'newest']]);
  assert.equal(isValidHistory(list), true);
  assert.equal(list[0].link, 'https://discord.com/channels/G1/C1/h0');
  assert.deepEqual(list[0].attachments, [{ name: 'notes.md', contentType: 'text/markdown; charset=utf-8', size: 12, url: ATT.url }]);
  await w.history('C1', 'm1', 500);
  assert.match(calls.at(-1).url, /limit=50$/);
  await assert.rejects(w.history('D1', 'd1', 5), (e) => e.permanent === true, 'never a DM');
  await assert.rejects(w.history('C9', 'm1', 5), (e) => e.permanent === true, 'never an unrelated channel');
  mode = 'limit';
  assert.equal((await w.history('C1', 'm1', 5)).length, 3);
  assert.deepEqual(sleeps, [500]);
  mode = 'long';
  await assert.rejects(w.history('C1', 'm1', 5), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 30000 && e.permanent !== true);
  mode = '403';
  await assert.rejects(w.history('C1', 'm1', 5), (e) => e.kind === 'plugin' && e.permanent === true && /Read Message History/.test(e.message));
  mode = '404';
  await assert.rejects(w.history('C1', 'm1', 5), (e) => e.permanent === true);
  mode = '503';
  await assert.rejects(w.history('C1', 'm1', 5), (e) => e.kind === 'network' && e.permanent !== true);
  mode = 'huge';
  const big = await w.history('C1', 'm1', 50);
  assert.ok(big.length > 0 && big.length < 50, 'trimmed under the frame budget');
  assert.equal(big.at(-1).link, 'https://discord.com/channels/G1/C1/z0', 'the newest messages stay');
  assert.ok(Buffer.byteLength(JSON.stringify(big)) <= 900 * 1024);
});

test('worker typing: POST /typing now, refreshed every 8 s until stopped; a 429 skips beats until retry_after; refusals stop it', async () => {
  const { ctx, events } = workerCtx();
  const calls = [];
  let mode = 'ok';
  const fetchFn = async (url, opts) => {
    calls.push({ url, method: opts.method });
    if (mode === 'limit') { mode = 'ok'; return json({ retry_after: 20 }, 429); }
    if (/^\d{3}$/.test(mode)) return json({ message: 'x' }, Number(mode));
    return { ok: true, status: 204, json: async () => { throw new Error('no body'); } };
  };
  let t = 1_000_000;
  const timers = new Map();
  let nextId = 0;
  const _timers = { setInterval: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; }, clearInterval: (id) => { timers.delete(id); } };
  const beat = async (ms) => { t += ms; for (const { fn } of [...timers.values()]) fn(); await new Promise((r) => setTimeout(r, 5)); };
  const w = createDiscordWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {}, _timers, _now: () => t });
  assert.deepEqual(await w.typing('C1', true), { ok: true });
  assert.deepEqual(calls, [{ url: 'https://discord.com/api/v10/channels/C1/typing', method: 'POST' }]);
  assert.deepEqual([...timers.values()].map((x) => x.ms), [8000], 'one refresh every 8 s');
  await beat(8000);
  assert.equal(calls.length, 2);
  mode = 'limit';
  await beat(8000);                                          // 429 retry_after 20 s
  assert.equal(calls.length, 3);
  await beat(8000); await beat(8000);                        // 16 s later: still inside retry_after
  assert.equal(calls.length, 3, 'no request while retry_after runs');
  await beat(8000);                                          // 24 s after the 429
  assert.equal(calls.length, 4);
  mode = '503';                                              // a 5xx skips one beat; typing goes on
  await beat(8000);
  assert.equal(calls.length, 5);
  mode = 'ok';
  await beat(8000);
  assert.equal(calls.length, 6, 'the next beat tries again after a 5xx');
  assert.deepEqual(await w.typing('C1', true), { ok: true }, 'a second start restarts it');
  assert.equal(timers.size, 1, 'one refresh per chat');
  assert.deepEqual(await w.typing('C1', false), { ok: true });
  assert.equal(timers.size, 0);
  const n = calls.length;
  await beat(8000);
  assert.equal(calls.length, n, 'stopped: no more requests');
  // A stop that never comes: the refresh ends on its own after 30 min.
  await w.typing('C2', true);
  await beat(31 * 60 * 1000);
  assert.equal(timers.size, 0);
  // Refusals: no access is permanent and starts no refresh; a refusal on a later beat stops it (logged only).
  mode = '403';
  await assert.rejects(w.typing('C3', true), (e) => e.kind === 'plugin' && e.permanent === true);
  assert.equal(timers.size, 0);
  mode = 'ok';
  await w.typing('C4', true);
  mode = '404';
  await beat(8000);
  assert.equal(timers.size, 0, 'a deleted thread stops the refresh');
  assert.ok(events.logs.some((m) => /typing stopped/.test(m)));
  mode = 'ok';
  await w.typing('C5', true);
  await w.stop();
  assert.equal(timers.size, 0, 'stop() clears every refresh');
  await assert.rejects(w.typing('bad id/../x', true), (e) => e.permanent === true);
});

test('discord-chat 0.5.0 manifest: live status declared on the interactive channel', () => {
  const m = JSON.parse(readFileSync(new URL('../plugins/discord-chat/worca-cc-plugin.json', import.meta.url), 'utf8'));
  assert.equal(m.version, '0.5.0');
  assert.deepEqual(m.chatChannels[0].capabilities, { inbound: true, outbound: true, interactive: true, liveStatus: true });
});

test('discord-chat manifest: the history setting (off by default, not advanced) and the CDN hosts', () => {
  const m = JSON.parse(readFileSync(new URL('../plugins/discord-chat/worca-cc-plugin.json', import.meta.url), 'utf8'));
  const ch = m.chatChannels[0];
  assert.deepEqual(ch.attachmentHosts, ['cdn.discordapp.com', 'media.discordapp.net']);
  const f = ch.configSchema.find((x) => x.key === 'historyOnStart');
  assert.deepEqual([f.type, f.label, f.default, f.options, f.advanced ?? false], ['select', 'Read recent history when a conversation starts', 'off', ['off', '5', '10', '20', '50'], false]);
});
