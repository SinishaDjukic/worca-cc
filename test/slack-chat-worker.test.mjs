// test/slack-chat-worker.test.mjs — the slack-chat example plugin's Socket
// Mode worker, in-process with injected fetchFn + a scripted FakeWebSocket:
// ack-before-process, own/bot/subtype filtering, disconnect->fresh-URL reopen,
// chat.postMessage error mapping (200 {ok:false} convention), and freeform chat:
// Block Kit controls, interactive envelopes, modals, threads, edits, reactions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSlackWorker, renderToMrkdwn, renderActions, renderBlocks, renderModalView, fallbackModal, parseActionId,
  toBlockAction, toViewSubmission, splitChatId, reactionName,
} from '../plugins/slack-chat/channel/worker.mjs';
import { isValidIncoming, isValidInteraction, isValidFrame, isValidControls, isValidHistory } from '../src/core/chat/channel-protocol.mjs';
import { MARK } from '../src/core/chat/receipts.mjs';
import { SAY, stripBotMention } from '../src/core/chat/conversation-bridge.mjs';
import { checkRows } from './helpers/rows.mjs';

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
    meta: { platform: 'slack', messageId: '1.2', ts: '1.2', threadTs: null, team: 'T1', isGroup: true, mentionsBot: false, botId: 'USELF' },
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

  // A 1:1 DM (channel_type "im") is the only non-group chat; anything else counts as a group.
  sock.message({ type: 'events_api', envelope_id: 'env-2',
    payload: { event: { type: 'message', channel: 'C1', channel_type: 'im', user: 'U9', text: '/direct x', ts: '1.3' } } });
  assert.equal(events.inbound[1].meta.isGroup, false);
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
      return json({ ok: true, ts: '9.1' });
    },
  });
  const w = createSlackWorker(ctx, { fetchFn: r.fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async () => {} });

  const msg = { title: 'Run done', body: [{ kind: 'markdown', value: '**bold** [pr](https://x)' }], severity: 'success' };
  assert.equal(renderToMrkdwn(msg), '*Run done*\n*bold* <https://x|pr>');
  assert.deepEqual(await w.send('C1', msg), { ok: true, chunks: 1, messageIds: ['9.1'] });

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

test('start(): a transient auth.test failure throws (supervisor restarts); a definitive invalid_auth degrades without throwing', async () => {
  await checkRows([
    { name: 'start(): transient auth.test failure (5xx/429) throws so the supervisor restarts', run: async () => {
      const { ctx } = fakeCtx();
      const w = createSlackWorker(ctx, { fetchFn: async () => json({}, 503) });
      await assert.rejects(() => w.start(), (e) => /auth\.test failed: HTTP 503/.test(e.message) && e.kind === 'network');

      const { ctx: ctx429 } = fakeCtx();
      const w429 = createSlackWorker(ctx429, { fetchFn: async () => json({}, 429, { 'retry-after': '2' }) });
      await assert.rejects(() => w429.start(), (e) => /auth\.test failed: HTTP 429/.test(e.message) && e.kind === 'rate-limit');
    } },
    { name: 'start(): definitive invalid_auth still degrades without throwing', run: async () => {
      const { ctx, events } = fakeCtx();
      const w = createSlackWorker(ctx, { fetchFn: async () => json({ ok: false, error: 'invalid_auth' }) });
      const r = await w.start();
      assert.equal(r.identity, null);
      assert.equal(events.status.at(-1).state, 'disconnected');
      assert.match(events.status.at(-1).detail, /auth\.test failed: invalid_auth — check botToken/);
    } },
  ]);
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

// ── freeform chat: controls, interactions, threads, edits, reactions ──────────────────────────

const REF = 'AbCdEfGhIjKlMnOpQrStUvWx';
const REF2 = 'ZyXwVuTsRqPoNmLkJiHgFeDc';
const MODAL = { title: 'Request changes to this run', fields: [{ id: 'text', label: 'What should change?', style: 'paragraph', required: true, maxLength: 4000 }] };

/** A started worker over a recording Web API stub: `api[method](body)` answers one call (default {ok:true, ts}). */
async function slackWorker(config = {}, { state = {}, api = {}, files = null } = {}) {
  FakeWebSocket.instances = [];
  const calls = [];
  let n = 0;
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'slack.com') {
      calls.push({ method: 'file', url: String(url), auth: init.headers?.Authorization ?? null, redirect: init.redirect ?? null });
      if (!files) throw new Error(`unexpected ${url}`);
      return files(String(url), init);
    }
    const method = u.pathname.slice(u.pathname.lastIndexOf('/') + 1);
    const body = init.body ? JSON.parse(init.body) : (u.search ? Object.fromEntries(u.searchParams) : null);
    calls.push({ method, body });
    if (api[method]) return api[method](body);
    if (method === 'auth.test') return json({ ok: true, user: 'worca', user_id: 'UBOT', bot_id: 'BBOT', url: 'https://acme.slack.com/' });
    if (method === 'apps.connections.open') return json({ ok: true, url: 'wss://slack.test/socket' });
    return json({ ok: true, ts: `200.${++n}` });
  };
  const events = { inbound: [], status: [], logs: [], interactions: [] };
  const ctx = {
    apiVersion: 2, platform: 'slack', mock: false,
    config: { botToken: 'xoxb-1', appToken: 'xapp-1', ...config },
    state: { get: async (k) => (state[k] ?? null), set: async (k, v) => { state[k] = v; } },
    log: (l, m) => events.logs.push(`${l}:${m}`),
    emitMessage: (m) => events.inbound.push(m),
    emitInteraction: (e) => events.interactions.push(e),
    setStatus: (s, d) => events.status.push({ state: s, detail: d ?? null }),
    shutdownSignal: new AbortController().signal,
  };
  const sleeps = [];
  const w = createSlackWorker(ctx, { fetchFn, WebSocketImpl: FakeWebSocket, _sleep: async (ms) => { sleeps.push(ms); } });
  await w.start();
  const sock = await waitFor(() => FakeWebSocket.instances[0]);
  sock.message({ type: 'hello' });
  let envs = 0;
  const event = (ev) => { const id = `ev-${++envs}`; sock.message({ type: 'events_api', envelope_id: id, payload: { team_id: 'T1', event: ev } }); return id; };
  const interactive = (payload) => { const id = `in-${++envs}`; sock.message({ type: 'interactive', envelope_id: id, payload }); return id; };
  return { w, sock, calls, events, state, sleeps, ctx, event, interactive };
}

/** A button click on a message inside the thread rooted at `threadTs` (null = a top-level message). */
const clickPayload = (actionId, { channel = 'C1', threadTs = '100.1', user = 'U1', trigger = 'trig-1', type = 'button', value, blocks } = {}) => ({
  type: 'block_actions', trigger_id: trigger, team: { id: 'T1' }, user: { id: user, username: 'ada' },
  channel: { id: channel }, container: { type: 'message', channel_id: channel, message_ts: '200.9', ...(threadTs ? { thread_ts: threadTs } : {}) },
  message: { ts: '200.9', ...(threadTs ? { thread_ts: threadTs } : {}), ...(blocks ? { blocks } : {}) },
  actions: [{ action_id: actionId, type, ...(value ? { selected_option: { value } } : {}) }],
});

const md = (value) => ({ title: null, severity: 'info', body: [{ kind: 'markdown', value }] });
const FF = { freeformChat: 'on', allowedChatIds: 'C1', chatMembers: 'U9=ada@example.com' };
const ROOT_TS = '1700000000.000100';
const MENTION_TS = '1700000000.000500';
const fileOf = (name, extra = {}) => ({ id: `F-${name}`, name, mimetype: 'text/markdown', size: 9, url_private: `https://files.slack.com/files-pri/T1-F1/${name}`, ...extra });
const ROOT = { ts: ROOT_TS, user: 'U7', text: 'the plan', user_profile: { display_name: 'alice' },
  files: [fileOf('plan.md'), fileOf('ext.pdf', { is_external: true, url_private: 'https://drive.example.com/x' })] };
const mentionIn = (thread, over = {}) => ({ type: 'app_mention', channel: 'C1', channel_type: 'channel', user: 'U9',
  text: '<@UBOT> what now?', ts: MENTION_TS, ...(thread ? { thread_ts: thread } : {}), ...over });

test('Block Kit: buttons, selects, links and modals render inside Slack\'s limits', () => {
  const controls = [
    { kind: 'select', ref: REF, placeholder: 'Scope: demo', options: [{ value: 'none', label: 'No project' }, { value: 'p:demo', label: 'demo', description: 'x'.repeat(90) }] },
    { kind: 'button', ref: REF2, label: 'Start run', style: 'success' },
    { kind: 'button', ref: 'Q'.repeat(20), label: 'Request changes', style: 'secondary', modal: MODAL },
    { kind: 'button', ref: 'D'.repeat(20), label: 'Stop', style: 'danger' },
    { kind: 'link', label: 'Open in worca', url: 'https://worca.example/#chat/t1' },
  ];
  assert.equal(isValidControls(controls), true, 'the fixture is a valid protocol control list');
  const actions = renderActions(controls);
  assert.equal(actions.type, 'actions');
  assert.deepEqual(actions.elements[0], { type: 'static_select', action_id: `w:${REF}`, placeholder: { type: 'plain_text', text: 'Scope: demo' },
    options: [{ text: { type: 'plain_text', text: 'No project' }, value: 'none' },
      { text: { type: 'plain_text', text: 'demo' }, value: 'p:demo', description: { type: 'plain_text', text: `${'x'.repeat(74)}…` } }] });
  assert.deepEqual(actions.elements[1], { type: 'button', text: { type: 'plain_text', text: 'Start run' }, action_id: `w:${REF2}`, style: 'primary' });
  assert.deepEqual(actions.elements[2], { type: 'button', text: { type: 'plain_text', text: 'Request changes' }, action_id: `w:m:${'Q'.repeat(20)}` }, 'secondary = no style; a modal button says so in its id');
  assert.equal(actions.elements[3].style, 'danger');
  assert.deepEqual(actions.elements[4], { type: 'button', text: { type: 'plain_text', text: 'Open in worca' }, url: 'https://worca.example/#chat/t1' }, 'a link executes nothing: no action id');
  assert.equal(renderActions([{ kind: 'button', ref: REF, label: 'L'.repeat(80), style: 'primary' }]).elements[0].text.text.length, 75);
  assert.equal(renderActions([]), null);
  assert.deepEqual(renderBlocks('*hi*', null), [{ type: 'section', text: { type: 'mrkdwn', text: '*hi*' } }]);
  assert.deepEqual(renderBlocks('*hi*', controls).map((b) => b.type), ['section', 'actions']);

  const view = renderModalView(REF, MODAL, 'C1:100.1');
  assert.deepEqual(view, { type: 'modal', callback_id: `w:${REF}`, private_metadata: '{"chatId":"C1:100.1"}',
    title: { type: 'plain_text', text: 'Request changes to this…' }, submit: { type: 'plain_text', text: 'Send' }, close: { type: 'plain_text', text: 'Cancel' },
    blocks: [{ type: 'input', block_id: 'text', optional: false, label: { type: 'plain_text', text: 'What should change?' },
      element: { type: 'plain_text_input', action_id: 'text', multiline: true, max_length: 3000 } }] });
  assert.equal(view.title.text.length, 24, 'Slack caps a modal title at 24 characters');
});

test('interaction parsing: our action ids only; selects carry the value; threads the bot opened map to their chat id; modal fields', () => {
  assert.deepEqual(parseActionId(`w:${REF}`), { ref: REF, opensModal: false });
  assert.deepEqual(parseActionId(`w:m:${REF}`), { ref: REF, opensModal: true });
  for (const bad of ['someone-else', 'w:short', `x:${REF}`, '', null]) assert.equal(parseActionId(bad), null, String(bad));
  const known = (channel, ts) => (ts === '100.1' ? `${channel}:${ts}` : channel);

  const click = toBlockAction(clickPayload(`w:${REF}`), 'trig-1', known);
  assert.deepEqual(click, { actionId: `w:${REF}`, opensModal: false, evt: { id: 'trig-1', chatId: 'C1:100.1', userId: 'U1', ref: REF, kind: 'button',
    meta: { platform: 'slack', team: 'T1', messageId: '200.9', username: 'ada' } } });
  assert.equal(isValidInteraction(click.evt), true);
  assert.equal(toBlockAction(clickPayload(`w:${REF}`, { threadTs: '555.5' }), 'trig-1', known).evt.chatId, 'C1', 'a thread the bot did not open stays the channel');
  assert.equal(toBlockAction(clickPayload(`w:${REF}`, { threadTs: null }), 'trig-1', known).evt.chatId, 'C1');
  const pick = toBlockAction(clickPayload(`w:${REF}`, { type: 'static_select', value: 'p:demo' }), 'trig-2', known);
  assert.deepEqual([pick.evt.kind, pick.evt.values], ['select', ['p:demo']]);
  assert.equal(toBlockAction(clickPayload(`w:${REF}`, { type: 'static_select' }), 'trig-2', known), null, 'a select with no value is nothing');
  assert.equal(toBlockAction(clickPayload('someone-else'), 'trig-3', known), null);
  assert.equal(toBlockAction(clickPayload(`w:m:${REF}`), 'trig-4', known).opensModal, true);
  assert.equal(toBlockAction({ ...clickPayload(`w:${REF}`), type: 'shortcut' }, 'trig-5', known), null);

  const submit = (callbackId, meta, values) => ({ type: 'view_submission', trigger_id: 'trig-9', team: { id: 'T1' }, user: { id: 'U1' },
    view: { callback_id: callbackId, private_metadata: meta, state: { values } } });
  const evt = toViewSubmission(submit(`w:${REF}`, '{"chatId":"C1:100.1"}', { text: { text: { type: 'plain_text_input', value: 'focus on tests' } } }), 'trig-9');
  assert.deepEqual(evt, { id: 'trig-9', chatId: 'C1:100.1', userId: 'U1', ref: REF, kind: 'modal', fields: { text: 'focus on tests' },
    meta: { platform: 'slack', team: 'T1', messageId: null, username: null } });
  assert.equal(isValidInteraction(evt), true);
  const proto = JSON.parse('{"text":{"__proto__":{"value":"x"},"Bad-Id":{"value":"y"},"text":{"value":null}}}');
  assert.deepEqual(toViewSubmission(submit(`w:${REF}`, '{"chatId":"C1"}', proto), 'trig-9').fields, { text: '' }, 'odd ids skipped; an empty optional input is ""');
  assert.equal(toViewSubmission(submit(`w:m:${REF}`, '{"chatId":"C1"}', {}), 'trig-9'), null, 'only the plain w: id is a submit');
  assert.equal(toViewSubmission(submit(`w:${REF}`, 'not json', {}), 'trig-9'), null, 'no chat, nothing to act on');
});

test('interactive envelopes: acked before anything else, even while views.open hangs; a modal button opens the modal and emits only its submit', async () => {
  let release;
  const hanging = new Promise((r) => { release = r; });
  const { w, sock, calls, events, interactive } = await slackWorker({}, { api: { 'views.open': async () => { await hanging; return json({ ok: true }); } } });
  const order = [];
  const emit = events.interactions.push.bind(events.interactions);
  events.interactions.push = (e) => { order.push(['emit', sock.sent.length]); return emit(e); };
  await w.send('C1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'q' }],
    controls: [{ kind: 'button', ref: REF, label: 'Request changes', style: 'secondary', modal: MODAL }, { kind: 'button', ref: REF2, label: 'Not now', style: 'secondary' }] });

  const before = sock.sent.length;
  const id1 = interactive(clickPayload(`w:m:${REF}`, { threadTs: null, trigger: 'trig-open' }));
  assert.deepEqual(sock.sent[before], { envelope_id: id1 }, 'acked synchronously, before views.open answers');
  await waitFor(() => calls.some((c) => c.method === 'views.open'));
  const open = calls.find((c) => c.method === 'views.open').body;
  assert.equal(open.trigger_id, 'trig-open');
  assert.deepEqual([open.view.callback_id, open.view.title.text, open.view.private_metadata], [`w:${REF}`, MODAL.title.slice(0, 23) + '…', '{"chatId":"C1"}']);
  assert.equal(events.interactions.length, 0, 'opening a modal is not a host event');

  const id2 = interactive(clickPayload(`w:${REF2}`, { threadTs: null, trigger: 'trig-2' }));
  await waitFor(() => events.interactions.length === 1);
  assert.deepEqual(order[0], ['emit', sock.sent.findIndex((f) => f.envelope_id === id2) + 1], 'the ack went out before the emit');
  assert.equal(events.interactions[0].kind, 'button');

  interactive({ type: 'view_submission', trigger_id: 'trig-3', user: { id: 'U1' },
    view: { callback_id: `w:${REF}`, private_metadata: '{"chatId":"C1"}', state: { values: { text: { text: { value: 'shorter please' } } } } } });
  await waitFor(() => events.interactions.length === 2);
  assert.deepEqual([events.interactions[1].kind, events.interactions[1].fields], ['modal', { text: 'shorter please' }]);

  interactive(clickPayload('someone-else', { threadTs: null, trigger: 'trig-4' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events.interactions.length, 2, 'foreign action ids are acked and ignored');
  assert.equal(sock.sent.length, before + 4, 'every envelope was acked');
  release();
  await w.stop();
});

test('a fresh worker (no memory of the post) still opens a modal for a w:m: button, titled from the button label', async () => {
  const { w, calls, events, interactive } = await slackWorker();
  const blocks = [{ type: 'actions', elements: [{ type: 'button', action_id: `w:m:${REF}`, text: { type: 'plain_text', text: 'Answer' } }] }];
  interactive(clickPayload(`w:m:${REF}`, { threadTs: null, blocks }));
  await waitFor(() => calls.some((c) => c.method === 'views.open'));
  const { view } = calls.find((c) => c.method === 'views.open').body;
  assert.deepEqual([view.callback_id, view.title.text], [`w:${REF}`, 'Answer']);
  assert.deepEqual(view.blocks[0].element, { type: 'plain_text_input', action_id: 'text', multiline: true, max_length: 2000 });
  assert.deepEqual(fallbackModal({}, 'x').title, 'Answer');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events.interactions.length, 0, 'the click that opened the modal is not a host event');
  await w.stop();
});

test('freeform threads: a top-level mention starts one; replies in the bot\'s thread get its chat id, also after a restart; a mention in another thread is flagged; DMs start nothing', async () => {
  const first = await slackWorker({ channelAllowlist: 'C1' });
  first.event({ type: 'message', channel: 'C1', channel_type: 'channel', user: 'U1', text: '<@UBOT> plan the release', ts: '100.1' });
  first.event({ type: 'app_mention', channel: 'C1', user: 'U1', text: '<@UBOT> plan the release', ts: '100.1' });
  assert.equal(first.events.inbound.length, 1, 'the app_mention twin of a message is emitted once');
  const m = first.events.inbound[0];
  assert.deepEqual([m.chatId, m.meta.messageId, m.meta.mentionsBot, m.meta.botId], ['C1', '100.1', true, 'UBOT']);
  assert.equal(isValidIncoming(m), true);
  assert.equal(stripBotMention(m.text, m.meta.botId), 'plan the release', 'the host strips the Slack mention token');

  // The bridge posts the header with options.thread: Slack threads need no create call.
  const header = await first.w.send('C1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: '**worca chat**' }] },
    { thread: { fromMessageId: '100.1', name: 'worca: plan the release' } });
  assert.deepEqual(header, { ok: true, chunks: 1, messageIds: ['200.1'], threadId: 'C1:100.1' });
  assert.deepEqual(first.calls.at(-1), { method: 'chat.postMessage', body: { channel: 'C1', text: '*worca chat*', thread_ts: '100.1' } });
  assert.deepEqual(first.state.freeformThreads, ['C1:100.1']);
  assert.equal(isValidFrame({ type: 'send', id: 's1', chatId: 'C1', message: { title: null, severity: 'info', body: [] }, options: { thread: { fromMessageId: '100.1', name: 'x' } } }), true);

  first.event({ type: 'message', channel: 'C1', user: 'U1', text: 'and the changelog', ts: '100.2', thread_ts: '100.1' });
  first.event({ type: 'message', channel: 'C1', user: 'U1', text: 'and the changelog', ts: '100.2', thread_ts: '100.1' });
  assert.equal(first.events.inbound.length, 2, 'a redelivered event is emitted once');
  assert.deepEqual([first.events.inbound[1].chatId, first.events.inbound[1].meta.mentionsBot], ['C1:100.1', false]);
  await first.w.send('C1:100.1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'reply' }] });
  assert.deepEqual(first.calls.at(-1).body, { channel: 'C1', text: 'reply', thread_ts: '100.1' });
  first.event({ type: 'message', channel: 'C1', user: 'U1', subtype: 'message_changed', ts: '100.3', thread_ts: '100.1', text: 'edit' });
  assert.equal(first.events.inbound.length, 2, 'edits are ignored');
  await first.w.stop();

  // A new worker process with the persisted state (the host replays ctx.state in `hello`).
  const second = await slackWorker({ channelAllowlist: 'C2' }, { state: { freeformThreads: ['C1:100.1'] } });
  second.event({ type: 'message', channel: 'C1', user: 'U1', text: 'still here', ts: '100.4', thread_ts: '100.1' });
  assert.equal(second.events.inbound[0]?.chatId, 'C1:100.1', 'the bot\'s own thread passes the listen filter and keeps its chat id');
  second.event({ type: 'message', channel: 'C1', user: 'U1', text: 'off-list', ts: '100.5' });
  assert.equal(second.events.inbound.length, 1, 'the rest of an off-list channel stays filtered');
  second.event({ type: 'message', channel: 'C2', user: 'U1', text: '<@UBOT> hi', ts: '300.2', thread_ts: '300.1' });
  assert.deepEqual([second.events.inbound[1].chatId, second.events.inbound[1].meta.mentionsBot], ['C2', true], 'a mention inside a thread the bot did not open is flagged with the plain channel id (the start binds THAT thread)');
  second.event({ type: 'message', channel: 'C2', user: 'U1', channel_type: 'im', text: '<@UBOT> hi', ts: '300.3' });
  assert.equal(second.events.inbound[2].meta.mentionsBot, false, 'DMs are not supported for freeform chat');
  second.event({ type: 'message', channel: 'C2', user: 'U1', subtype: 'thread_broadcast', text: 'also to channel', ts: '300.4', thread_ts: '300.1' });
  assert.equal(second.events.inbound.length, 4, 'a reply also sent to the channel is still a message');
  await second.w.stop();
});

test('send: controls ride Block Kit on the last chunk; edits update in place and always replace the blocks; refusals are permanent, outages are not', async () => {
  let mode = 'ok';
  const { w, calls } = await slackWorker({}, { api: { 'chat.update': () => {
    if (mode === 'gone') return json({ ok: false, error: 'message_not_found' });
    if (mode === '503') return json({}, 503);
    if (mode === 'fatal') return json({ ok: false, error: 'fatal_error' });
    if (mode === 'blocks') return json({ ok: false, error: 'invalid_blocks' });
    if (mode === 'scope') return json({ ok: false, error: 'missing_scope', needed: 'chat:write' });
    return json({ ok: true, ts: '200.7' });
  } } });
  const controls = [{ kind: 'button', ref: REF, label: 'Start run', style: 'primary' }];
  const long = 'a'.repeat(3500);   // one plain message (4000), two with controls (3000)
  const r = await w.send('C1:100.1', { title: null, severity: 'info', body: [{ kind: 'text', value: long }], controls });
  assert.equal(r.chunks, 2, 'with controls, text is cut at a section\'s 3000 characters');
  const [p1, p2] = calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.body);
  assert.equal(p1.blocks, undefined);
  assert.deepEqual(p2.blocks.map((b) => b.type), ['section', 'actions']);
  assert.deepEqual([p1.text.length, p2.blocks[0].text.text], [3000, 'a'.repeat(500)]);
  assert.equal(p2.thread_ts, '100.1');

  assert.deepEqual(await w.send('C1:100.1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'answered' }] }, { edit: { messageId: '200.5' } }),
    { ok: true, messageIds: ['200.5'] });
  assert.deepEqual(calls.at(-1), { method: 'chat.update', body: { channel: 'C1', ts: '200.5', text: 'answered',
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'answered' } }] } }, 'no controls: the old buttons are replaced too');
  await w.send('C1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'h' }], controls }, { edit: { messageId: '200.6' } });
  assert.deepEqual(calls.at(-1).body.blocks.map((b) => b.type), ['section', 'actions']);

  const edit = () => w.send('C1', { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'x' }] }, { edit: { messageId: '200.5' } });
  mode = 'gone';
  await assert.rejects(edit(), (e) => e.kind === 'plugin' && e.permanent === true && /not found/.test(e.message), 'the bridge reposts a deleted message');
  mode = 'blocks';
  await assert.rejects(edit(), (e) => e.permanent === true);
  mode = 'scope';
  await assert.rejects(edit(), (e) => e.permanent === true && /chat:write/.test(e.message));
  mode = '503';
  await assert.rejects(edit(), (e) => e.kind === 'network' && e.permanent !== true);
  mode = 'fatal';
  await assert.rejects(edit(), (e) => e.kind === 'network' && e.permanent !== true);
  await w.stop();
});

test('replyInteraction: an ephemeral note to the clicker in the right thread; unknown or older than 14 minutes is refused', async () => {
  const { w, calls, events, interactive } = await slackWorker({ channelAllowlist: 'C2' }, { state: { freeformThreads: ['C1:100.1'] } });
  interactive(clickPayload(`w:${REF}`, { threadTs: null, trigger: 'trig-6' }));
  interactive(clickPayload(`w:${REF}`, { trigger: 'trig-7' }));
  await waitFor(() => events.interactions.length === 1);
  assert.equal(events.interactions[0].id, 'trig-7', 'a click outside the listen filter is dropped; the bot\'s own thread passes');
  const submit = (trigger, chatId) => interactive({ type: 'view_submission', trigger_id: trigger, user: { id: 'U1' },
    view: { callback_id: `w:${REF}`, private_metadata: JSON.stringify({ chatId }), state: { values: { text: { text: { value: 'x' } } } } } });
  submit('trig-8', 'C1');
  submit('trig-9', 'C1:100.1');
  await waitFor(() => events.interactions.length === 2);
  assert.deepEqual(events.interactions.map((e) => e.id), ['trig-7', 'trig-9'], 'a modal submit passes the same listen filter');
  assert.equal(events.interactions[0].chatId, 'C1:100.1');
  assert.deepEqual(await w.replyInteraction('trig-7', 'Only <@U1> can act on this conversation.'), { ok: true });
  assert.deepEqual(calls.at(-1), { method: 'chat.postEphemeral', body: { channel: 'C1', user: 'U1', text: 'Only <@U1> can act on this conversation.', thread_ts: '100.1' } });
  assert.deepEqual(await w.replyInteraction('trig-9', 'x'), { ok: true }, 'a modal submit is answered privately too');
  assert.deepEqual(calls.at(-1), { method: 'chat.postEphemeral', body: { channel: 'C1', user: 'U1', text: 'x', thread_ts: '100.1' } });
  await assert.rejects(w.replyInteraction('nope', 'x'), /interaction expired/);
  const realNow = Date.now;
  Date.now = () => realNow() + 15 * 60 * 1000;
  try { await assert.rejects(w.replyInteraction('trig-7', 'late'), /interaction expired/); }
  finally { Date.now = realNow; }
  await w.stop();
});

test('react: the bot\'s own Slack emoji by name; short 429 waits, a long Retry-After goes back to the host; missing scope and deleted messages are permanent; 5xx is not', async () => {
  let mode = 'ok';
  let limited = 0;
  const answer = () => {
    if (mode === 'limit' && limited++ === 0) return json({}, 429, { 'retry-after': '1' });
    if (mode === 'long') return json({}, 429, { 'retry-after': '30' });
    if (mode === 'already') return json({ ok: false, error: 'already_reacted' });
    if (mode === 'none') return json({ ok: false, error: 'no_reaction' });
    if (mode === 'scope') return json({ ok: false, error: 'missing_scope', needed: 'reactions:write' });
    if (mode === 'gone') return json({ ok: false, error: 'message_not_found' });
    if (mode === '502') return json({}, 502);
    return json({ ok: true });
  };
  const { w, calls, sleeps } = await slackWorker({}, { api: { 'reactions.add': answer, 'reactions.remove': answer } });
  const reacts = () => calls.filter((c) => c.method.startsWith('reactions.'));
  assert.deepEqual([MARK.work, MARK.ok, MARK.fail, MARK.stop, String.fromCodePoint(0x23f9)].map(reactionName),
    ['hourglass_flowing_sand', 'white_check_mark', 'x', 'black_square_for_stop', 'black_square_for_stop']);
  assert.equal(reactionName(String.fromCodePoint(0x1f44d)), null);

  assert.deepEqual(await w.react('C1:100.1', '100.2', MARK.work, true), { ok: true });
  assert.deepEqual(reacts()[0], { method: 'reactions.add', body: { channel: 'C1', timestamp: '100.2', name: 'hourglass_flowing_sand' } });
  await w.react('C1', '100.1', MARK.work, false);
  assert.deepEqual(reacts()[1], { method: 'reactions.remove', body: { channel: 'C1', timestamp: '100.1', name: 'hourglass_flowing_sand' } });
  assert.equal(isValidFrame({ type: 'react', id: 'x1', chatId: 'C0123456789:1730000000.123456', messageId: '1730000000.123456', emoji: MARK.stop, on: true }), true);

  mode = 'already';
  assert.deepEqual(await w.react('C1', '100.1', MARK.ok, true), { ok: true }, 'already there counts as done');
  mode = 'none';
  assert.deepEqual(await w.react('C1', '100.1', MARK.work, false), { ok: true }, 'already gone counts as done');
  mode = 'limit';
  calls.length = 0;
  await w.react('C1', '100.1', MARK.ok, true);
  assert.equal(reacts().length, 2);
  assert.deepEqual(sleeps, [1000]);
  mode = 'long';
  calls.length = 0;
  await assert.rejects(w.react('C1', '100.1', MARK.ok, true), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 30000 && e.permanent !== true);
  assert.equal(reacts().length, 1);
  assert.deepEqual(sleeps, [1000], 'the worker did not sit out a long wait');
  mode = 'scope';
  await assert.rejects(w.react('C1', '100.1', MARK.ok, true), (e) => e.kind === 'plugin' && e.permanent === true && /reactions:write/.test(e.message));
  mode = 'gone';
  await assert.rejects(w.react('C1', '100.1', MARK.ok, true), (e) => e.kind === 'plugin' && e.permanent === true);
  mode = '502';
  await assert.rejects(w.react('C1', '100.1', MARK.ok, true), (e) => e.kind === 'network' && e.permanent !== true);
  calls.length = 0;
  await assert.rejects(w.react('C1', '100.1', String.fromCodePoint(0x1f44d), true), (e) => e.permanent === true);
  assert.equal(reacts().length, 0, 'an unknown emoji is refused without a call');
  await w.stop();
});

test('splitChatId: a plain channel or a channel plus thread ts', () => {
  assert.deepEqual(splitChatId('C1'), { channel: 'C1', threadTs: null });
  assert.deepEqual(splitChatId('C1:100.1'), { channel: 'C1', threadTs: '100.1' });
});

test('manifest, README and the shared refusal text are ready for Slack freeform chat', () => {
  const man = JSON.parse(readFileSync(new URL('../plugins/slack-chat/worca-cc-plugin.json', import.meta.url), 'utf8'));
  assert.equal(man.version, '0.4.0');
  const ch = man.chatChannels[0];
  assert.deepEqual(ch.capabilities, { inbound: true, outbound: true, interactive: true, liveStatus: true });
  assert.equal('attachmentHosts' in ch, false);
  const field = (k) => ch.configSchema.find((f) => f.key === k);
  assert.deepEqual([field('freeformChat').default, field('freeformChat').options], ['off', ['off', 'on']]);
  assert.match(field('chatMembers').help, /slackMemberId=worca identity/);
  assert.equal(field('worcaUrl').label, 'Worca address for links (optional)');
  for (const k of ['freeformChat', 'chatMembers', 'worcaUrl', 'historyOnStart']) assert.equal(field(k).advanced, undefined, `${k} is not advanced`);
  const h = field('historyOnStart');
  assert.deepEqual([h.type, h.default, h.options], ['select', 'off', ['off', '5', '10', '20', '50']]);
  assert.match(h.help, /thread's earlier replies/);
  assert.match(h.help, /never in direct messages/);
  const readme = readFileSync(new URL('../plugins/slack-chat/README.md', import.meta.url), 'utf8');
  for (const s of ['reactions:write', 'chat:write', 'app_mentions:read', 'channels:history', 'groups:history', 'files:read', 'Interactivity', 'no Request URL']) {
    assert.ok(readme.includes(s), `README names ${s}`);
  }
  assert.match(readme, /direct messages are not supported/i);
  assert.match(readme, /no typing indicator/i);
  assert.doesNotMatch(SAY.notMember, /Discord/, 'Slack users never read Discord wording');
  assert.match(SAY.notMember, /not set up for worca chat/);
});

test('chat context: a start mention inside a thread the bot did not open quotes the root with its files, binds THAT thread; strangers and bound threads cost no read', async () => {
  const { w, calls, events, event, state } = await slackWorker(FF, { api: { 'conversations.replies': () => json({ ok: true, messages: [ROOT] }) } });
  event(mentionIn(ROOT_TS));
  const m = await waitFor(() => events.inbound[0]);
  assert.equal(m.chatId, 'C1');
  assert.equal(m.meta.mentionsBot, true);
  assert.deepEqual(calls.filter((c) => c.method === 'conversations.replies').map((c) => c.body), [{ channel: 'C1', ts: ROOT_TS, limit: '1', inclusive: 'true' }]);
  assert.deepEqual([m.replyTo.author, m.replyTo.text, m.replyTo.at, m.replyTo.link],
    ['alice', 'the plan', '2023-11-14T22:13:20.000Z', 'https://acme.slack.com/archives/C1/p1700000000000100']);
  assert.match(m.replyTo.attachments[0].ref, /^[A-Za-z0-9_-]{24}$/);
  assert.deepEqual(m.replyTo.attachments.map(({ ref, ...a }) => a), [
    { name: 'plan.md', contentType: 'text/markdown', size: 9 },
    { name: 'ext.pdf', contentType: 'text/markdown', size: 9, unavailable: 'an external file link (not stored in Slack)' },
  ]);
  assert.equal(isValidIncoming(m), true);
  assert.ok(!JSON.stringify(m).includes('files.slack.com'), 'no file URL leaves the worker');

  const head = await w.send('C1', md('worca chat'), { thread: { fromMessageId: MENTION_TS, name: 'worca chat' } });
  assert.equal(head.threadId, `C1:${ROOT_TS}`, 'the existing thread is bound, not a thread off the mention');
  assert.equal(calls.at(-1).body.thread_ts, ROOT_TS);
  assert.ok(state.freeformThreads.includes(`C1:${ROOT_TS}`));

  const reads = () => calls.filter((c) => c.method === 'conversations.replies').length;
  event(mentionIn(ROOT_TS, { ts: '1700000000.000600', text: '<@UBOT> and this?' }));      // in the now-bound thread
  const bound = await waitFor(() => events.inbound[1]);
  assert.equal(bound.chatId, `C1:${ROOT_TS}`);
  assert.equal(bound.replyTo, undefined, 'the root is the conversation\'s own start');
  event(mentionIn('1700000000.000700', { ts: '1700000000.000800', user: 'U8' }));          // not a member
  event(mentionIn('1700000000.000900', { ts: '1700000000.001000', channel: 'C2' }));       // not an allowed channel
  await waitFor(() => events.inbound.length === 4);
  assert.equal(reads(), 1, 'no read for a stranger or an unlisted channel');
  assert.ok(events.inbound.slice(2).every((x) => x.replyTo === undefined));
});

test('send(options.thread): a start that throws forgets the binding, so the thread routes as the channel again; its 429 waits share one budget', async () => {
  let mode = 'refuse';
  const { w, events, event, state, sleeps } = await slackWorker(FF, { api: {
    'conversations.replies': () => json({ ok: true, messages: [ROOT] }),
    'chat.postMessage': () => (mode === 'refuse' ? json({ ok: false, error: 'channel_not_found' }) : mode === 'limit' ? json({}, 429, { 'retry-after': '5' }) : json({ ok: true, ts: '200.9' })),
  } });
  event(mentionIn(ROOT_TS));
  await waitFor(() => events.inbound[0]);
  await assert.rejects(w.send('C1', md('worca chat'), { thread: { fromMessageId: MENTION_TS, name: 'x' } }), (e) => e.permanent === true);
  assert.ok(!(state.freeformThreads || []).includes(`C1:${ROOT_TS}`));
  mode = 'limit';
  await assert.rejects(w.send('C1', md('worca chat'), { thread: { fromMessageId: MENTION_TS, name: 'x' } }), (e) => e.kind === 'rate-limit');
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 10000, `one budget for the whole start (${sleeps})`);
  assert.ok(!(state.freeformThreads || []).includes(`C1:${ROOT_TS}`));
  event(mentionIn(ROOT_TS, { ts: '1700000000.000600', text: 'later' }));
  assert.equal((await waitFor(() => events.inbound[1])).chatId, 'C1', 'no dead composite chat id');
  mode = 'ok';
  await w.send('C1', md('worca chat'), { thread: { fromMessageId: '1700000000.001100', name: 'x' } });
  mode = 'refuse';
  await assert.rejects(w.send('C1', md('worca chat'), { thread: { fromMessageId: '1700000000.001100', name: 'x' } }), (e) => e.permanent === true);
  assert.ok(state.freeformThreads.includes('C1:1700000000.001100'), 'a failed re-send never unbinds a thread that was already bound');
});

test('history(): a thread start reads the thread\'s earlier replies, a top-level start the channel; oldest first; other bots skipped, worca kept; never a DM; 429 and scopes', async () => {
  const replies = [ROOT,
    { ts: '1700000000.000200', user: 'U7', text: 'first', user_profile: { real_name: 'Alice A' } },
    { ts: '1700000000.000300', user: 'B9', bot_id: 'B9', text: 'beep' },
    { ts: '1700000000.000400', user: 'UBOT', bot_id: 'BBOT', text: 'my answer' },
    { ts: '1700000000.000450', subtype: 'channel_join', user: 'U5', text: 'joined' }];
  const channel = [{ ts: '1700000000.002000', user: 'U3', text: 'newest' }, { ts: '1700000000.001500', user: 'U2', text: 'oldest', files: [fileOf('a.md')] }];
  let mode = 'ok';
  let limited = 0;
  const answer = (rows) => () => {
    if (mode === 'limit' && limited++ === 0) return json({}, 429, { 'retry-after': '1' });
    if (mode === 'long') return json({}, 429, { 'retry-after': '30' });
    if (mode === 'scope') return json({ ok: false, error: 'missing_scope', needed: 'channels:history' });
    return json({ ok: true, messages: rows, has_more: false });
  };
  const { w, calls, event, events, sleeps } = await slackWorker({ ...FF, allowedChatIds: 'C1,D1' }, { api: { 'conversations.replies': answer(replies), 'conversations.history': answer(channel) } });
  await assert.rejects(w.history('C1', MENTION_TS, 5), (e) => e.permanent === true, 'no message seen in C1 yet');
  event(mentionIn(ROOT_TS));
  await waitFor(() => events.inbound[0]);
  const t = await w.history('C1', MENTION_TS, 5);
  assert.deepEqual(calls.at(-1), { method: 'conversations.replies', body: { channel: 'C1', ts: ROOT_TS, latest: MENTION_TS, inclusive: 'false', limit: '200' } });
  assert.deepEqual(t.map((q) => [q.author, q.text]), [['Alice A', 'first'], ['worca (this bot)', 'my answer']], 'root, other bots and joins left out');
  assert.equal(isValidHistory(t), true);
  assert.deepEqual((await w.history('C1', MENTION_TS, 1)).map((q) => q.text), ['my answer'], 'the newest `limit` kept');
  event({ type: 'app_mention', channel: 'C1', channel_type: 'channel', user: 'U9', text: '<@UBOT> top', ts: '1700000000.003000' });
  await waitFor(() => events.inbound[1]);
  const c = await w.history('C1', '1700000000.003000', 5);
  assert.deepEqual(calls.at(-1), { method: 'conversations.history', body: { channel: 'C1', latest: '1700000000.003000', inclusive: 'false', limit: '5' } });
  assert.deepEqual(c.map((q) => q.text), ['oldest', 'newest'], 'Slack answers newest first');
  assert.match(c[0].attachments[0].ref, /^[A-Za-z0-9_-]{24}$/);
  event({ type: 'message', channel: 'D1', channel_type: 'im', user: 'U9', text: 'hi', ts: '1700000000.004000' });
  await waitFor(() => events.inbound[2]);
  await assert.rejects(w.history('D1', '1700000000.004000', 5), (e) => e.permanent === true && /never in direct messages/.test(e.message));
  mode = 'limit';
  assert.equal((await w.history('C1', '1700000000.003000', 5)).length, 2);
  assert.deepEqual(sleeps.slice(-1), [1000]);
  mode = 'long';
  await assert.rejects(w.history('C1', '1700000000.003000', 5), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 30000 && e.permanent !== true);
  assert.ok(!sleeps.includes(30000), 'the worker did not sit out a long wait');
  mode = 'scope';
  await assert.rejects(w.history('C1', '1700000000.003000', 5), (e) => e.permanent === true && /channels:history/.test(e.message));
});

test('fetchFile: the bot token goes only to Slack\'s file host, with no redirects; sign-in page, 403 and expired refs are permanent; over the cap is tooBig; no token in any error', async () => {
  let mode = 'ok';
  const { w, calls, event, events } = await slackWorker({}, { files: () => {
    if (mode === 'html') return new Response('<html>sign in</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (mode === '403') return new Response('', { status: 403 });
    if (mode === 'boom') throw new TypeError('fetch failed');
    return new Response('# plan ok\n', { status: 200, headers: { 'content-type': 'text/markdown' } });
  } });
  event({ type: 'message', subtype: 'file_share', channel: 'C1', channel_type: 'channel', user: 'U9', text: 'see file', ts: '1700000000.000100',
    files: [fileOf('plan.md'), fileOf('evil.md', { url_private: 'https://evil.example.com/plan.md' })] });
  const m = await waitFor(() => events.inbound[0]);
  assert.equal(m.meta.link, 'https://acme.slack.com/archives/C1/p1700000000000100');
  const [ok, evil] = m.attachments;
  assert.equal(evil.unavailable, 'Slack does not offer this file for download here');
  const got = await w.fetchFile(ok.ref, { maxBytes: 100, signal: AbortSignal.timeout(2000) });
  assert.equal(String(got.data), '# plan ok\n');
  assert.deepEqual(calls.filter((c) => c.method === 'file'), [{ method: 'file', url: 'https://files.slack.com/files-pri/T1-F1/plan.md', auth: 'Bearer xoxb-1', redirect: 'error' }]);
  await assert.rejects(w.fetchFile(ok.ref, { maxBytes: 3, signal: AbortSignal.timeout(2000) }), (e) => e.tooBig === true);
  for (const [m2, re] of [['html', /files:read/], ['403', /files:read/], ['boom', /download failed/]]) {
    mode = m2;
    await assert.rejects(w.fetchFile(ok.ref, { maxBytes: 100, signal: AbortSignal.timeout(2000) }),
      (e) => re.test(e.message) && !e.message.includes('xoxb-1') && !e.message.includes('files.slack.com') && (m2 === 'boom' ? e.permanent !== true : e.permanent === true), m2);
  }
  await assert.rejects(w.fetchFile('Z'.repeat(24), { maxBytes: 100 }), (e) => e.permanent === true && /expired/.test(e.message));
});

test('live status: a status edit spends one bounded 429 budget, then throws back; a deleted status message is permanent; typing sends nothing', async () => {
  let mode = 'limit';
  const { w, calls, sleeps } = await slackWorker({}, { api: { 'chat.update': () => (mode === 'limit' ? json({}, 429, { 'retry-after': '5' }) : json({ ok: false, error: 'message_not_found' })) } });
  await assert.rejects(w.send('C1:1.1', md('⏳ Working on it… · 5 s'), { edit: { messageId: '200.1' } }), (e) => e.kind === 'rate-limit' && Number.isFinite(e.retryAfterMs));
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 10000, `the waits of one edit stay under the host's 15 s send RPC (${sleeps})`);
  mode = 'gone';
  await assert.rejects(w.send('C1:1.1', md('⏹️ Interrupted'), { edit: { messageId: '200.1' } }), (e) => e.permanent === true);
  const before = calls.length;
  assert.deepEqual(await w.typing('C1:1.1', true), { ok: true });
  assert.deepEqual(await w.typing('C1:1.1', false), { ok: true });
  assert.equal(calls.length, before, 'Slack has no bot typing indicator in channels: no request');
});

test('live status: a reply longer than one section edits the status message with the first chunk and posts the rest in the thread, controls on the last', async () => {
  const { w, calls } = await slackWorker();
  const long = 'a'.repeat(3000) + 'b'.repeat(3000) + 'c'.repeat(1000);
  const controls = [{ kind: 'button', ref: REF, label: 'Start run', style: 'primary' }];
  const r = await w.send('C1:100.1', { title: null, severity: 'info', body: [{ kind: 'text', value: long }], controls }, { edit: { messageId: '200.5' } });
  const update = calls.filter((c) => c.method === 'chat.update');
  const posts = calls.filter((c) => c.method === 'chat.postMessage').map((c) => c.body);
  assert.equal(update.length, 1);
  assert.deepEqual(update[0].body.blocks.map((b) => b.type), ['section'], 'the controls do not ride the first of several chunks');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => [p.channel, p.thread_ts]), [['C1', '100.1'], ['C1', '100.1']]);
  assert.equal(posts[0].blocks, undefined);
  assert.deepEqual(posts[1].blocks.map((b) => b.type), ['section', 'actions']);
  assert.equal(update[0].body.text + posts.map((p) => p.text).join(''), long, 'nothing of the reply is lost');
  assert.equal(r.messageIds.length, 3);
  assert.equal(r.messageIds[0], '200.5');
  await w.stop();
});

test('chat context guards: an app_mention twin without channel_type still lets history read; a top-level mention or freeform off reads no root; a pending root read holds later channel messages in order', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { w, calls, events, event, ctx } = await slackWorker(FF, { api: {
    'conversations.replies': async () => { await gate; return json({ ok: true, messages: [ROOT] }); },
    'conversations.history': () => json({ ok: true, messages: [{ ts: '1700000000.000050', user: 'U2', text: 'before' }] }),
  } });
  const reads = () => calls.filter((c) => c.method === 'conversations.replies').length;
  // Slack's app_mention event carries no channel_type, and it can arrive before its message twin.
  event({ type: 'app_mention', channel: 'C1', user: 'U9', text: '<@UBOT> top', ts: '1700000000.000060' });
  event({ type: 'message', channel: 'C1', channel_type: 'channel', user: 'U9', text: '<@UBOT> top', ts: '1700000000.000060' });
  await waitFor(() => events.inbound[0]);
  assert.equal(events.inbound.length, 1, 'the twin is emitted once');
  assert.equal(events.inbound[0].meta.mentionsBot, true);
  assert.equal(reads(), 0, 'a top-level mention reads no thread root');
  assert.deepEqual((await w.history('C1', '1700000000.000060', 5)).map((q) => q.text), ['before'], 'the twin that carried channel_type still counts');
  event(mentionIn(ROOT_TS));                                                                     // its root read hangs
  event({ type: 'message', channel: 'C1', channel_type: 'channel', user: 'U5', text: 'next', ts: '1700000000.000700' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(events.inbound.length, 1, 'a later message in the channel waits for the pending read');
  release();
  await waitFor(() => events.inbound.length === 3);
  assert.deepEqual(events.inbound.slice(1).map((m) => m.text), ['<@UBOT> what now?', 'next']);
  assert.equal(events.inbound[1].replyTo.text, 'the plan');
  ctx.config.freeformChat = 'off';
  event(mentionIn('1700000000.000800', { ts: '1700000000.000900' }));
  await waitFor(() => events.inbound.length === 4);
  assert.equal(reads(), 1, 'freeform off: no read');
});

test('files: plan-hidden, check_file_info, tombstoned, odd-port and userinfo URLs never get a ref; at most 10 per message; a file 429 goes back with its wait', async () => {
  let mode = 'ok';
  const { w, events, event } = await slackWorker({}, { files: () => (mode === '429' ? new Response('', { status: 429, headers: { 'retry-after': '7' } }) : new Response('x', { status: 200 })) });
  event({ type: 'message', subtype: 'file_share', channel: 'C1', channel_type: 'channel', user: 'U9', text: 'files', ts: '1700000000.000100', files: [
    fileOf('ok.md'), fileOf('ci.md', { file_access: 'check_file_info' }), fileOf('old.md', { mode: 'hidden_by_limit' }), fileOf('gone.md', { mode: 'tombstone' }),
    fileOf('port.md', { url_private: 'https://files.slack.com:8443/files-pri/T1-F1/port.md' }),
    fileOf('cred.md', { url_private: 'https://u:p@files.slack.com/files-pri/T1-F1/cred.md' }),
  ] });
  const m = await waitFor(() => events.inbound[0]);
  const no = 'Slack does not offer this file for download here';
  assert.deepEqual(m.attachments.map((a) => [a.name, a.ref ? 'ref' : a.unavailable]), [
    ['ok.md', 'ref'], ['ci.md', no], ['old.md', 'hidden by the Slack plan\'s message history limit'], ['port.md', no], ['cred.md', no]]);
  event({ type: 'message', subtype: 'file_share', channel: 'C1', channel_type: 'channel', user: 'U9', text: 'many', ts: '1700000000.000200',
    files: Array.from({ length: 12 }, (_, i) => fileOf(`f${i}.md`)) });
  assert.equal((await waitFor(() => events.inbound[1])).attachments.length, 10);
  assert.equal(isValidIncoming(events.inbound[1]), true);
  mode = '429';
  await assert.rejects(w.fetchFile(m.attachments[0].ref, { maxBytes: 100 }), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 7000 && e.permanent !== true);
});

test('history(): a long answer drops its oldest messages to stay under the 1 MiB frame', async () => {
  const big = Array.from({ length: 50 }, (_, i) => ({ ts: `1700000000.${String(1000 + i).padStart(6, '0')}`, user: 'U2', text: '中'.repeat(4000),
    files: Array.from({ length: 10 }, (_, k) => fileOf(`${'中'.repeat(240)}${k}.md`)) })).reverse();   // Slack answers newest first
  const { w, events, event } = await slackWorker(FF, { api: { 'conversations.history': () => json({ ok: true, messages: big }) } });
  event({ type: 'message', channel: 'C1', channel_type: 'channel', user: 'U9', text: 'hi', ts: '1700000000.009000' });
  await waitFor(() => events.inbound[0]);
  const h = await w.history('C1', '1700000000.009000', 50);
  assert.ok(h.length > 0 && h.length < 50, `trimmed to ${h.length}`);
  assert.ok(Buffer.byteLength(JSON.stringify(h), 'utf8') <= 900 * 1024);
  assert.match(h.at(-1).link, /p1700000000001049$/, 'the newest is kept');
  assert.equal(isValidHistory(h), true);
});

test('history(): a channel outside the listen filter is never read, even when a bound thread in it passes the filter', async () => {
  const { w, events, event } = await slackWorker({ ...FF, channelAllowlist: 'C2' }, { state: { freeformThreads: ['C1:100.1'] } });
  event({ type: 'message', channel: 'C1', channel_type: 'channel', user: 'U9', text: 'in the bound thread', ts: '100.2', thread_ts: '100.1' });
  await waitFor(() => events.inbound[0]);
  await assert.rejects(w.history('C1', '100.2', 5), (e) => e.permanent === true);
});
