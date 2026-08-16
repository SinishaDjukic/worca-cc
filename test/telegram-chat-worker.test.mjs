// test/telegram-chat-worker.test.mjs — the telegram-chat example plugin's
// worker, driven in-process with an injected fetchFn/_sleep and a fake channel
// ctx (github-source-connector precedent). Assertion matrix ported from the
// pre-1.0 telegram adapter tests: poll cycle (first poll timeout=0), 429
// retry_after, cursor persistence via state deltas + replay guard, /cmd@bot
// handling, edited_message skip, HTML rendering, send split + 429 ladder +
// error-kind mapping, validateConfig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelegramWorker, validateConfig, renderToHtml,
} from '../examples/plugins/telegram-chat/channel/worker.mjs';
import { splitText, withRetryLadder } from '../examples/plugins/telegram-chat/lib/send-util.mjs';
import { toTelegramHtml, toSlackMrkdwn } from '../examples/plugins/telegram-chat/lib/markdown.mjs';

const json = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
});

function fakeCtx(config = { botToken: 'bot-token-1234' }) {
  const state = new Map();
  const events = { inbound: [], status: [], logs: [] };
  const ac = new AbortController();
  return {
    ctx: {
      apiVersion: 2,
      platform: 'telegram',
      mock: false,
      config,
      state: {
        get: async (k) => (state.has(k) ? state.get(k) : null),
        set: async (k, v) => { state.set(k, v); },
      },
      log: (level, msg) => events.logs.push(`${level}:${msg}`),
      emitMessage: (m) => events.inbound.push(m),
      setStatus: (s, d) => events.status.push({ state: s, detail: d ?? null }),
      shutdownSignal: ac.signal,
    },
    state, events, abort: () => ac.abort(),
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

test('start: getMe identity; poll cycle emits normalized inbound + persists cursor', async () => {
  const { ctx, state, events } = fakeCtx();
  const polls = [];
  const fetchFn = async (url) => {
    if (url.includes('/getMe')) return json({ ok: true, result: { username: 'worca_bot' } });
    if (url.includes('/getUpdates')) {
      polls.push(url);
      if (polls.length === 1) {
        return json({ ok: true, result: [
          { update_id: 7, message: { message_id: 1, chat: { id: 42, type: 'private' }, from: { id: 9, username: 'sam' }, text: '/status' } },
          { update_id: 8, edited_message: { message_id: 1, chat: { id: 42 }, text: '/stop' } },
          { update_id: 9, message: { message_id: 2, chat: { id: -100, type: 'group', title: 'devs' }, from: { id: 9 }, text: '/status@other_bot' } },
          { update_id: 10, message: { message_id: 3, chat: { id: 42, type: 'private' }, from: { id: 9 }, text: '/pause@worca_bot now' } },
        ] });
      }
      return new Promise(() => {}); // second poll hangs (long poll)
    }
    throw new Error(`unexpected url ${url}`);
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {} });
  const info = await w.start();
  assert.equal(info.identity, '@worca_bot');

  await waitFor(() => events.inbound.length >= 2);
  assert.match(polls[0], /offset=0&timeout=0/, 'first poll is a drain (timeout=0)');
  assert.match(polls[1], /offset=11&timeout=25/, 'cursor advanced past the batch');

  assert.deepEqual(events.inbound[0], {
    chatId: '42', userId: '9', text: '/status',
    meta: { platform: 'telegram', messageId: 1, chatType: 'private', chatTitle: null, username: 'sam' },
  });
  assert.equal(events.inbound.length, 2, 'edited_message and /cmd@other_bot dropped');
  assert.equal(events.inbound[1].text, '/pause now', '@worca_bot suffix stripped');

  await waitFor(() => state.get('cursor') === 11);
  assert.equal(state.get('lastUpdateId'), 10);
  assert.ok(events.status.some((s) => s.state === 'connected'));
  await w.stop();
});

test('replay guard: updates at/below lastUpdateId are not re-emitted', async () => {
  const { ctx, state, events } = fakeCtx();
  state.set('cursor', 5);
  state.set('lastUpdateId', 7);
  let served = false;
  const fetchFn = async (url) => {
    if (url.includes('/getMe')) return json({ ok: true, result: { username: 'b' } });
    if (!served) {
      served = true;
      return json({ ok: true, result: [
        { update_id: 6, message: { message_id: 1, chat: { id: 1 }, text: 'old' } },
        { update_id: 7, message: { message_id: 2, chat: { id: 1 }, text: 'old2' } },
        { update_id: 8, message: { message_id: 3, chat: { id: 1 }, text: 'new' } },
      ] });
    }
    return new Promise(() => {});
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {} });
  await w.start();
  await waitFor(() => events.inbound.length >= 1);
  assert.equal(events.inbound.length, 1);
  assert.equal(events.inbound[0].text, 'new');
  await w.stop();
});

test('poll 429 honors retry_after; auth failure stops polling with a status', async () => {
  const { ctx, events } = fakeCtx();
  const sleeps = [];
  let call = 0;
  const fetchFn = async (url) => {
    if (url.includes('/getMe')) return json({ ok: true, result: { username: 'b' } });
    call++;
    if (call === 1) return json({ parameters: { retry_after: 7 } }, 429);
    return json({}, 401);
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async (ms) => { sleeps.push(ms); } });
  await w.start();
  await waitFor(() => events.status.some((s) => /auth failed/.test(s.detail || '')));
  assert.deepEqual(sleeps, [7000], '429 slept retry_after seconds');
  assert.equal(call, 2, 'poll loop exited after 401 (restart cannot help)');
  await w.stop();
});

test('send: HTML render, 4096 split on line boundaries, ladder + kind mapping', async () => {
  const { ctx } = fakeCtx();
  const sent = [];
  let mode = 'ok';
  const fetchFn = async (url, opts) => {
    if (url.includes('/getMe')) return json({ ok: true, result: {} });
    if (url.includes('/sendMessage')) {
      const body = JSON.parse(opts.body);
      sent.push(body);
      if (mode === '429') return json({ parameters: { retry_after: 1 } }, 429);
      if (mode === '403') return json({}, 403);
      return json({ ok: true, result: {} });
    }
    return new Promise(() => {});
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {} });

  const msg = { title: 'Run <done>', body: [{ kind: 'markdown', value: '**bold** & `code`' }], severity: 'success' };
  const r = await w.send('42', msg);
  assert.equal(r.ok, true);
  assert.equal(sent[0].parse_mode, 'HTML');
  assert.equal(sent[0].chat_id, '42');
  assert.match(sent[0].text, /<b>Run &lt;done&gt;<\/b>/);
  assert.match(sent[0].text, /<b>bold<\/b> &amp; <code>code<\/code>/);

  sent.length = 0;
  const long = { title: null, body: [{ kind: 'text', value: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}` }], severity: 'info' };
  await w.send('42', long);
  assert.equal(sent.length, 2, 'split into two chunks');
  assert.ok(sent[0].text.length <= 4096 && sent[1].text.length <= 4096);

  mode = '429';
  await assert.rejects(w.send('42', msg), (err) => err.kind === 'rate-limit' && err.retryAfterMs === 1000);
  mode = '403';
  await assert.rejects(w.send('42', msg), (err) => err.kind === 'plugin' && /blocked|start/.test(err.message));
});

test('validateConfig: ok/identity, 401 pins botToken, network error reported', async () => {
  const ok = await validateConfig({ botToken: 't' }, { fetchFn: async () => json({ ok: true, result: { username: 'worca_bot' } }) });
  assert.deepEqual(ok, { ok: true, identity: '@worca_bot' });
  const bad = await validateConfig({ botToken: 't' }, { fetchFn: async () => json({}, 401) });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].field, 'botToken');
  const missing = await validateConfig({});
  assert.equal(missing.errors[0].message, 'botToken is required');
  const net = await validateConfig({ botToken: 't' }, { fetchFn: async () => { throw new Error('offline'); } });
  assert.match(net.errors[0].message, /network error: offline/);
});

test('lib: splitText line preference; withRetryLadder exhausts to rate-limit; HTML escapes', () => {
  assert.deepEqual(splitText('short', 10), ['short']);
  const chunks = splitText(`${'x'.repeat(8)}\n${'y'.repeat(8)}`, 10);
  assert.deepEqual(chunks, ['x'.repeat(8) + '\n', 'y'.repeat(8)]);
  assert.match(renderToHtml({ title: null, body: [{ kind: 'link', value: 'PR', href: 'https://x?a=1&b=2' }], severity: 'info' }),
    /<a href="https:\/\/x\?a=1&amp;b=2">PR<\/a>/);
  return assert.rejects(
    withRetryLadder(async () => ({ retryAfterMs: 1 }), async () => {}),
    (err) => err.kind === 'rate-limit',
  );
});

test('splitText never emits a chunk longer than limit (newline-at-limit off-by-one)', () => {
  const s = 'a'.repeat(10) + '\n' + 'b'.repeat(9); // newline at index 10 === limit → today [11, 9]
  for (const c of splitText(s, 10)) assert.ok(c.length <= 10, `chunk ${c.length} > 10`);
});

test('splitText never splits a surrogate pair', () => {
  const s = 'x'.repeat(9) + '😀' + 'y'.repeat(9); // pair straddles limit 10
  for (const c of splitText(s, 10)) assert.ok(c.isWellFormed(), 'ill-formed chunk');
});

test('send(): a "can\'t parse entities" 400 falls back to plain text instead of losing the message', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    if (!opts?.method) return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'b' } }) };
    const body = JSON.parse(opts.body);
    calls.push(body);
    if (body.parse_mode === 'HTML') return { ok: false, status: 400, json: async () => ({ description: "Bad Request: can't parse entities" }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const w = createTelegramWorker(fakeCtx().ctx, { fetchFn, _sleep: async () => {} });
  const r = await w.send('7', { title: null, body: [{ kind: 'code_block', value: 'x' }], severity: 'info' });
  assert.equal(r.ok, true);
  assert.equal(calls.at(-1).parse_mode, undefined, 'fallback resend is plain text');
});

test('code spans containing $-replacement patterns survive markdown conversion verbatim', () => {
  const out = toTelegramHtml('run `sed s/a/$&/` now');
  assert.match(out, /sed s\/a\/\$(&|&amp;)\//); // $& must not duplicate text or leak a \x00PH marker
  assert.ok(!/\x00/.test(out), 'no placeholder marker leaks');
  const out2 = toSlackMrkdwn("pattern `$'` and ```$`\n``` end");
  assert.ok(out2.includes("$'"), 'inline $-pattern survives');
});

test('bold content with $-patterns survives toSlackMrkdwn (second restore site)', () => {
  const out = toSlackMrkdwn('a **b$&c** d');
  assert.match(out, /\*b\$(&|&amp;)c\*/); // T6 escapes & → &amp; in Slack output; both spellings prove no $-interpretation
  assert.ok(!/\x01/.test(out), 'no bold marker leaks');
});
