// test/discord-chat-worker.test.mjs — the discord-chat example plugin:
// gateway state machine (hello->identify->ready, heartbeat ACK loss -> resume,
// RECONNECT/INVALID_SESSION, close-code mapping 4004/4014) with a scripted
// FakeWebSocket, plus the ported REST send path (429 retry_after, kind
// mapping) and validateConfig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
