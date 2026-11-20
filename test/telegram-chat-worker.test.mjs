// test/telegram-chat-worker.test.mjs — the telegram-chat example plugin's
// worker, driven in-process with an injected fetchFn/_sleep and a fake channel
// ctx (github-source-connector precedent). Assertion matrix ported from the
// pre-1.0 telegram adapter tests: poll cycle (first poll timeout=0), 429
// retry_after, cursor persistence via state deltas + replay guard, /cmd@bot
// handling, edited_message skip, HTML rendering, send split + 429 ladder +
// error-kind mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTelegramWorker, renderToHtml, renderKeyboard, parseCallbackData, parseSurface, parseMessageKey,
  REACTION_FOR, CALLBACK_ACK_MS,
} from '../plugins/telegram-chat/channel/worker.mjs';
import { MARK } from '../src/core/chat/receipts.mjs';
import { splitText, withRetryLadder } from '../plugins/telegram-chat/lib/send-util.mjs';
import { toTelegramHtml, toSlackMrkdwn } from '../plugins/telegram-chat/lib/markdown.mjs';
import { checkRows } from './helpers/rows.mjs';
import { isValidIncoming } from '../src/core/chat/channel-protocol.mjs';
import { readFileSync } from 'node:fs';

const json = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
});

function fakeCtx(config = { botToken: 'bot-token-1234' }) {
  const state = new Map();
  const events = { inbound: [], status: [], logs: [], interactions: [] };
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
      emitInteraction: (e) => events.interactions.push(e),
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
    meta: { platform: 'telegram', messageId: '42:1', chatType: 'private', chatTitle: null, username: 'sam', isGroup: false, mentionsBot: true, botId: null },
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
      if (mode === '400') return json({ ok: false, description: 'Bad Request: chat not found' }, 400);
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
  mode = '400';   // a chat that is not found fails the same way again: the host must not retry it
  await assert.rejects(w.send('42', msg), (e) => e.permanent === true && e.kind === 'plugin' && /chat not found/.test(e.message));
});

test('splitText/withRetryLadder/HTML escapes: line preference, never over the limit, never splits a surrogate pair', async () => {
  await checkRows([
    { name: 'lib: splitText line preference; withRetryLadder exhausts to rate-limit; HTML escapes', run: () => {
      assert.deepEqual(splitText('short', 10), ['short']);
      const chunks = splitText(`${'x'.repeat(8)}\n${'y'.repeat(8)}`, 10);
      assert.deepEqual(chunks, ['x'.repeat(8) + '\n', 'y'.repeat(8)]);
      assert.match(renderToHtml({ title: null, body: [{ kind: 'link', value: 'PR', href: 'https://x?a=1&b=2' }], severity: 'info' }),
        /<a href="https:\/\/x\?a=1&amp;b=2">PR<\/a>/);
      return assert.rejects(
        withRetryLadder(async () => ({ retryAfterMs: 1 }), async () => {}),
        (err) => err.kind === 'rate-limit',
      );
    } },
    { name: 'splitText never emits a chunk longer than limit (newline-at-limit off-by-one)', run: () => {
      const s = 'a'.repeat(10) + '\n' + 'b'.repeat(9); // newline at index 10 === limit → today [11, 9]
      for (const c of splitText(s, 10)) assert.ok(c.length <= 10, `chunk ${c.length} > 10`);
    } },
    { name: 'splitText never splits a surrogate pair', run: () => {
      const s = 'x'.repeat(9) + '😀' + 'y'.repeat(9); // pair straddles limit 10
      for (const c of splitText(s, 10)) assert.ok(c.isWellFormed(), 'ill-formed chunk');
    } },
  ]);
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

test('$-replacement patterns survive markdown conversion at both restore sites', async () => {
  await checkRows([
    { name: 'code spans containing $-replacement patterns survive markdown conversion verbatim', run: () => {
      const out = toTelegramHtml('run `sed s/a/$&/` now');
      assert.match(out, /sed s\/a\/\$(&|&amp;)\//); // $& must not duplicate text or leak a \x00PH marker
      assert.ok(!/\x00/.test(out), 'no placeholder marker leaks');
      const out2 = toSlackMrkdwn("pattern `$'` and ```$`\n``` end");
      assert.ok(out2.includes("$'"), 'inline $-pattern survives');
    } },
    { name: 'bold content with $-patterns survives toSlackMrkdwn (second restore site)', run: () => {
      const out = toSlackMrkdwn('a **b$&c** d');
      assert.match(out, /\*b\$(&|&amp;)c\*/); // T6 escapes & → &amp; in Slack output; both spellings prove no $-interpretation
      assert.ok(!/\x01/.test(out), 'no bold marker leaks');
    } },
  ]);
});

test('cursor is scoped to the bot: a new bot id resets cursor and replay guard', async () => {
  const { ctx, state, events } = fakeCtx();
  state.set('cursor', 5001); state.set('lastUpdateId', 5000); state.set('botId', 111);
  const polls = [];
  const fetchFn = async (url) => {
    if (url.includes('/getMe')) return json({ ok: true, result: { id: 222, username: 'new_bot' } });
    polls.push(url);
    if (polls.length === 1) return json({ ok: true, result: [{ update_id: 300, message: { message_id: 1, chat: { id: 7 }, from: { id: 9 }, text: '/approve' } }] });
    return new Promise(() => {});
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {} });
  await w.start();
  await waitFor(() => events.inbound.length === 1);
  assert.match(polls[0], /offset=0&/);
  assert.equal(events.inbound[0].text, '/approve');
  await waitFor(() => state.get('botId') === 222 && state.get('cursor') === 301);
  await w.stop();
});

test('a cursor older than 7 days (idle at start, or ageing while running) is reset', async () => {
  await checkRows([
    { name: 'a cursor idle for more than 7 days is reset (Telegram re-randomises update ids)', run: async () => {
      const { ctx, state, events } = fakeCtx();
      const NOW = Date.parse('2026-09-30T00:00:00Z');
      state.set('cursor', 5001); state.set('lastUpdateId', 5000); state.set('botId', 1);
      state.set('cursorAt', NOW - 8 * 86400000);
      const polls = [];
      const fetchFn = async (url) => {
        if (url.includes('/getMe')) return json({ ok: true, result: { id: 1, username: 'b' } });
        polls.push(url);
        if (polls.length === 1) return json({ ok: true, result: [{ update_id: 12, message: { message_id: 1, chat: { id: 7 }, text: '/status' } }] });
        return new Promise(() => {});
      };
      const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {}, now: () => NOW });
      await w.start();
      await waitFor(() => events.inbound.length === 1);
      assert.match(polls[0], /offset=0&/);
      await w.stop();
    } },
    { name: 'a cursor that ages past 7 days while the worker runs is reset before the next poll', run: async () => {
      const { ctx, state, events } = fakeCtx();
      const NOW = Date.parse('2026-09-30T00:00:00Z');
      let clock = NOW;
      state.set('cursor', 5001); state.set('lastUpdateId', 5000); state.set('botId', 1);
      state.set('cursorAt', NOW - 3600000);
      const polls = [];
      const fetchFn = async (url) => {
        if (url.includes('/getMe')) return json({ ok: true, result: { id: 1, username: 'b' } });
        polls.push(url);
        if (polls.length === 1) {
          clock = NOW + 8 * 86400000; // a week of empty long polls passes
          return json({ ok: true, result: [] });
        }
        if (polls.length === 2) return json({ ok: true, result: [{ update_id: 12, message: { message_id: 1, chat: { id: 7 }, from: { id: 9 }, text: '/approve' } }] });
        return new Promise(() => {});
      };
      const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {}, now: () => clock });
      await w.start();
      await waitFor(() => events.inbound.length === 1);
      assert.match(polls[0], /offset=5001&/, 'a fresh cursor is kept at start');
      assert.match(polls[1], /offset=0&/, 'the aged cursor is reset inside the loop');
      assert.equal(events.inbound[0].text, '/approve');
      await waitFor(() => state.get('cursor') === 13 && state.get('lastUpdateId') === 12 && state.get('cursorAt') === clock);
      assert.equal(events.logs.filter((l) => /cursor reset/.test(l)).length, 1, 'the reset is logged once');
      await w.stop();
    } },
  ]);
});

test('legacy state without botId/cursorAt is kept, not reset', async () => {
  const { ctx, state } = fakeCtx();
  state.set('cursor', 40); state.set('lastUpdateId', 39);
  const polls = [];
  const fetchFn = async (url) => {
    if (url.includes('/getMe')) return json({ ok: true, result: { id: 1, username: 'b' } });
    polls.push(url);
    return new Promise(() => {});
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {} });
  await w.start();
  await waitFor(() => polls.length === 1);
  assert.match(polls[0], /offset=40&/);
  await waitFor(() => state.get('botId') === 1);
  await w.stop();
});

test('polls ask for message, channel_post and callback_query; a channel post command is emitted', async () => {
  const { ctx, events } = fakeCtx();
  const polls = [];
  const fetchFn = async (url) => {
    if (url.includes('/getMe')) return json({ ok: true, result: { id: 1, username: 'b' } });
    polls.push(url);
    if (polls.length === 1) return json({ ok: true, result: [{ update_id: 3, channel_post: { message_id: 4, chat: { id: -1009, type: 'channel', title: 'ops' }, text: '/approve *ab12' } }] });
    return new Promise(() => {});
  };
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async () => {} });
  await w.start();
  await waitFor(() => events.inbound.length === 1);
  assert.match(decodeURIComponent(polls[0]), /allowed_updates=\["message","channel_post","callback_query"\]/);
  assert.deepEqual(events.inbound[0], {
    chatId: '-1009', userId: '-1009', text: '/approve *ab12',
    meta: { platform: 'telegram', messageId: '-1009:4', chatType: 'channel', chatTitle: 'ops', username: null, isGroup: true, mentionsBot: false, botId: '1' },
  });
  await w.stop();
});

// ── interactive (v0.3): ids, keyboards, presses, typed answers, surfaces, edits, reactions ─────────────────────

const REF = 'AbCdEfGhIjKlMnOpQrStUvWx';
const REF2 = 'ZyXwVuTsRqPoNmLkJiHgFeDc';
const REF3 = 'QyXwVuTsRqPoNmLkJiHgFeDc';
const STALE = 'This control is no longer valid. Use the newest message.';

/** A Bot API fake: records every POST as {method, body}; `reply(method, body)` may return a response, else ok.
 *  sendMessage ids count up from 501; getUpdates hands out pushed updates and otherwise waits for the next push. */
function botApi(reply = () => undefined, { me = { id: 77, username: 'worca_bot' } } = {}) {
  const calls = [];
  const queue = [];
  let waiter = null;
  let nextId = 500;
  const fetchFn = async (url, init = {}) => {
    const method = String(url).split('?')[0].split('/').pop();
    if (method === 'getMe') return json({ ok: true, result: me });
    if (method === 'getUpdates') {
      if (queue.length) return json({ ok: true, result: queue.splice(0) });
      return new Promise((resolve) => { waiter = () => resolve(json({ ok: true, result: queue.splice(0) })); });
    }
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    const r = await reply(method, body);
    if (r) return r;
    if (method === 'sendMessage') return json({ ok: true, result: { message_id: ++nextId } });
    if (method === 'createForumTopic') return json({ ok: true, result: { message_thread_id: 31, name: body.name } });
    return json({ ok: true, result: true });
  };
  return {
    calls, fetchFn,
    push: (...updates) => { queue.push(...updates); const w = waiter; waiter = null; w?.(); },
    of: (method) => calls.filter((c) => c.method === method),
  };
}
const fakeTimers = () => {
  const timers = [];
  return { timers, setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; }, clearTimer: (t) => { t.cleared = true; } };
};
const md = (value) => ({ title: null, severity: 'info', body: [{ kind: 'markdown', value }] });

const SG = { id: -1001234, type: 'supergroup', title: 'devs' };
const ADA = { id: 111, first_name: 'Ada', username: 'ada' };
const BEN = { id: 222, first_name: 'Ben' };
const BOTU = { id: 77, is_bot: true, first_name: 'worca', username: 'worca_bot' };
const mention = (len = 10) => [{ type: 'mention', offset: 0, length: len }];
async function tgWorker(reply = () => undefined, { files = null } = {}) {
  const api = botApi(reply);
  const { ctx, events, abort } = fakeCtx();
  const sleeps = [];
  const fetchFn = (u, init) => (String(u).includes('/file/bot') ? files(String(u), init) : api.fetchFn(u, init));
  const w = createTelegramWorker(ctx, { fetchFn, _sleep: async (ms) => { sleeps.push(ms); } });
  await w.start();
  return { w, api, events, sleeps, stop: async () => { await w.stop(); abort(); } };
}

test('ids: surfaces and message keys name their chat; anything else is refused', () => {
  assert.deepEqual(parseSurface('42'), { chat: '42', topic: null, anchor: null });
  assert.deepEqual(parseSurface('-1009:t7'), { chat: '-1009', topic: 7, anchor: null });
  assert.deepEqual(parseSurface('-500:r505'), { chat: '-500', topic: null, anchor: 505 });
  for (const bad of ['', 'abc', '-500:x1', '-500:t', '1:2', null]) assert.equal(parseSurface(bad), null, String(bad));
  assert.deepEqual(parseMessageKey('-500:22'), { chat: '-500', id: 22 });
  assert.deepEqual(parseMessageKey('22', '-500:r505'), { chat: '-500', id: 22 }, 'a bare id takes its chat from the surface');
  for (const bad of ['', 'x', '-500:t7', '22']) assert.equal(parseMessageKey(bad), null, bad);
});

test('renderKeyboard: a select is a paged grid, buttons and links 2 per row, typed-answer buttons marked; callback_data ≤ 64 bytes', () => {
  const options = Array.from({ length: 11 }, (_, i) => ({ value: `p:proj-${i}`, label: `Project ${i}` }));
  const controls = [
    { kind: 'select', ref: REF, placeholder: 'Scope: No project', options },
    { kind: 'button', ref: REF2, label: 'New conversation', style: 'secondary' },
    { kind: 'button', ref: REF3, label: 'Answer', style: 'primary',
      modal: { title: 'Answer', fields: [{ id: 'text', label: 'Your answer', style: 'paragraph', required: true, maxLength: 2000 }] } },
    { kind: 'link', label: 'Open in worca', url: 'https://w.example/#chat/ask_1' },
  ];
  const rows = renderKeyboard(controls);
  assert.deepEqual(rows.map((r) => r.map((b) => b.text)), [
    ['Project 0', 'Project 1'], ['Project 2', 'Project 3'], ['Project 4', 'Project 5'], ['Project 6', 'Project 7'],
    ['More ▶'], ['New conversation', 'Answer'], ['Open in worca']]);
  assert.equal(rows[0][1].callback_data, `s:${REF}:1`);
  assert.equal(rows[4][0].callback_data, `p:${REF}:1`);
  assert.equal(rows[5][0].callback_data, `b:${REF2}`);
  assert.equal(rows[5][1].callback_data, `m:${REF3}`);
  assert.deepEqual(rows[6][0], { text: 'Open in worca', url: 'https://w.example/#chat/ask_1' });
  const page1 = renderKeyboard(controls, { pages: { [REF]: 1 } });
  assert.deepEqual(page1.slice(0, 3).map((r) => r.map((b) => b.text)), [['Project 8', 'Project 9'], ['Project 10'], ['◀ Back']]);
  assert.equal(page1[0][0].callback_data, `s:${REF}:8`);
  assert.deepEqual(renderKeyboard(controls, { pages: { [REF]: 9 } }), page1, 'an out-of-range page shows the last one');
  const long = 'L'.repeat(64);
  const aliased = renderKeyboard([{ kind: 'select', ref: long, options }, { kind: 'button', ref: long, label: 'x', style: 'primary' }],
    { alias: (r) => (r.length > 56 ? `~${'a'.repeat(20)}` : r) });
  for (const b of aliased.flat()) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  for (const b of rows.flat()) if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
  assert.deepEqual(renderKeyboard([]), []);
});

test('parseCallbackData: our four kinds only', () => {
  assert.deepEqual(parseCallbackData(`b:${REF}`), { kind: 'button', ref: REF });
  assert.deepEqual(parseCallbackData(`m:${REF}`), { kind: 'modal', ref: REF });
  assert.deepEqual(parseCallbackData(`s:${REF}:10`), { kind: 'select', ref: REF, index: 10 });
  assert.deepEqual(parseCallbackData(`p:~${'a'.repeat(20)}:1`), { kind: 'page', ref: `~${'a'.repeat(20)}`, page: 1 });
  for (const bad of ['', 'x', 'b:short', `s:${REF}`, `b:${REF}:1`, 'other_bot:payload', `q:${REF}`, 'b:~short']) {
    assert.equal(parseCallbackData(bad), null, bad);
  }
});

test('inbound: the bot\'s own mention is flagged and cut; a DM always addresses the bot; other bots dropped, anonymous admins kept', async () => {
  const api = botApi();
  const { ctx, events } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  await w.start();
  const g = { id: -500, type: 'group', title: 'devs' };
  api.push(
    { update_id: 1, message: { message_id: 10, chat: g, from: { id: 5 }, text: '@Worca_Bot what is up', entities: [{ type: 'mention', offset: 0, length: 10 }] } },
    { update_id: 2, message: { message_id: 11, chat: g, from: { id: 5 }, text: 'hey @other_bot', entities: [{ type: 'mention', offset: 4, length: 10 }] } },
    { update_id: 3, message: { message_id: 12, chat: g, from: { id: 5 }, text: 'ping Worca now', entities: [{ type: 'text_mention', offset: 5, length: 5, user: { id: 77 } }] } },
    { update_id: 4, message: { message_id: 13, chat: g, from: { id: 9, is_bot: true }, text: '@worca_bot loop', entities: [{ type: 'mention', offset: 0, length: 10 }] } },
    { update_id: 5, message: { message_id: 14, chat: g, from: { id: 1087968824, is_bot: true, username: 'GroupAnonymousBot' }, sender_chat: { id: -500 }, text: '/status' } },
    { update_id: 6, message: { message_id: 0, chat: g, from: { id: 5 }, text: 'scheduled, no id yet' } },
    { update_id: 7, message: { message_id: 3, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'hello' } },
  );
  await waitFor(() => events.inbound.length === 6);
  assert.deepEqual(events.inbound.map((m) => [m.chatId, m.text, m.meta.mentionsBot, m.meta.messageId]), [
    ['-500', 'what is up', true, '-500:10'],
    ['-500', 'hey @other_bot', false, '-500:11'],
    ['-500', 'ping  now', true, '-500:12'],
    ['-500', '/status', false, '-500:14'],
    ['-500', 'scheduled, no id yet', false, null],
    ['42', 'hello', true, '42:3'],
  ]);
  assert.equal(events.inbound[0].meta.botId, '77');
  await w.stop();
});

test('presses: emitted at once with the conversation chat; the host reply becomes the toast, else the deadline answers empty and a late reply is posted', async () => {
  const api = botApi();
  const { ctx, events } = fakeCtx();
  const t = fakeTimers();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer });
  await w.start();
  const sent = await w.send('42', { ...md('pick'), controls: [
    { kind: 'select', ref: REF, placeholder: 'Pick one', options: [{ value: 'main', label: 'main' }, { value: 'dev', label: 'dev' }] },
    { kind: 'button', ref: REF2, label: 'Stop', style: 'danger' }] });
  assert.deepEqual(sent, { ok: true, chunks: 1, messageIds: ['42:501'] });
  assert.match(api.of('sendMessage')[0].body.text, /<i>Pick one<\/i>$/);
  const msg = { message_id: 501, chat: { id: 42, type: 'private' } };
  api.push(
    { update_id: 1, callback_query: { id: 'CQ1', from: { id: 42, username: 'sam' }, message: msg, data: `s:${REF}:1` } },
    { update_id: 2, callback_query: { id: 'CQ2', from: { id: 42 }, message: msg, data: `b:${REF2}` } });
  await waitFor(() => events.interactions.length === 2);
  assert.deepEqual(events.interactions[0], { id: 'CQ1', chatId: '42', userId: '42', ref: REF, kind: 'select', values: ['dev'],
    meta: { platform: 'telegram', messageId: '42:501', username: 'sam' } });
  assert.deepEqual(events.interactions[1], { id: 'CQ2', chatId: '42', userId: '42', ref: REF2, kind: 'button',
    meta: { platform: 'telegram', messageId: '42:501', username: null } });
  assert.equal(api.of('answerCallbackQuery').length, 0, 'not answered before the host replies or the deadline');
  assert.deepEqual(t.timers.map((x) => x.ms), [CALLBACK_ACK_MS, CALLBACK_ACK_MS]);
  assert.deepEqual(await w.replyInteraction('CQ1', 'Done — the message will update shortly.'), { ok: true });
  assert.deepEqual(api.of('answerCallbackQuery')[0].body, { callback_query_id: 'CQ1', text: 'Done — the message will update shortly.' });
  assert.equal(t.timers[0].cleared, true);
  t.timers[1].fn();   // CQ2's deadline: answered without text
  await waitFor(() => api.of('answerCallbackQuery').length === 2);
  assert.deepEqual(api.of('answerCallbackQuery')[1].body, { callback_query_id: 'CQ2' });
  await w.replyInteraction('CQ2', 'Stopping the reply.');
  const late = api.of('sendMessage').at(-1).body;
  assert.equal(late.text, 'Stopping the reply.');
  assert.deepEqual(late.reply_parameters, { message_id: 501, allow_sending_without_reply: true });
  await assert.rejects(w.replyInteraction('nope', 'x'), /interaction expired/);
  await w.stop();
});

test('presses: foreign data and bot pressers are answered empty, an unknown option or alias answers stale, a page press edits only the keyboard', async () => {
  const api = botApi();
  const { ctx, events } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  await w.start();
  const options = Array.from({ length: 11 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));
  const controls = [{ kind: 'select', ref: REF, placeholder: 'Pick one', options }];
  await w.send('42', { ...md('pick'), controls });
  const msg = { message_id: 501, chat: { id: 42, type: 'private' } };
  const cq = (id, data, from = { id: 42 }) => ({ callback_query: { id, from, message: msg, data } });
  api.push(
    { update_id: 1, ...cq('A', 'other:payload') },
    { update_id: 2, ...cq('B', `s:${REF}:20`) },
    { update_id: 3, ...cq('C', `b:~${'z'.repeat(20)}`) },
    { update_id: 4, ...cq('D', `p:${REF}:1`) },
    { update_id: 5, ...cq('E', `b:${REF2}`, { id: 9, is_bot: true }) });
  await waitFor(() => api.of('answerCallbackQuery').length === 5);
  const answer = (id) => api.of('answerCallbackQuery').find((c) => c.body.callback_query_id === id).body;
  assert.deepEqual(answer('A'), { callback_query_id: 'A' });
  assert.deepEqual(answer('B'), { callback_query_id: 'B', text: STALE });
  assert.deepEqual(answer('C'), { callback_query_id: 'C', text: STALE });
  assert.deepEqual(answer('D'), { callback_query_id: 'D' });
  assert.deepEqual(answer('E'), { callback_query_id: 'E' });
  assert.deepEqual(api.of('editMessageReplyMarkup')[0].body,
    { chat_id: '42', message_id: 501, reply_markup: { inline_keyboard: renderKeyboard(controls, { pages: { [REF]: 1 } }) } });
  assert.equal(events.interactions.length, 0);
  await w.stop();
});

test('typed answers: the press is answered at once and a ForceReply prompt names the presser; only their reply to it is the answer', async (t) => {
  const api = botApi();
  const { ctx, events, state } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  t.after(() => w.stop());   // a failed assertion must not leave the poll loop holding the file open
  await w.start();
  const g = { id: -500, type: 'group', title: 'devs' };
  await w.send('-500', { ...md('**Proposed run**'), controls: [{ kind: 'button', ref: REF, label: 'Request changes', style: 'secondary',
    modal: { title: 'Request changes', fields: [{ id: 'text', label: 'What should change?', style: 'paragraph', required: true, maxLength: 2000 }] } }] });
  api.push({ update_id: 1, callback_query: { id: 'M1', from: { id: 5, first_name: 'Sam <&>' }, message: { message_id: 501, chat: g }, data: `m:${REF}` } });
  await waitFor(() => api.of('sendMessage').length === 2);
  const prompt = api.of('sendMessage')[1].body;
  assert.deepEqual(prompt.reply_markup, { force_reply: true, selective: true, input_field_placeholder: 'What should change?' });
  assert.match(prompt.text, /<a href="tg:\/\/user\?id=5">Sam &lt;&amp;&gt;<\/a>/, 'the presser\'s name is HTML-escaped');
  assert.deepEqual(prompt.reply_parameters, { message_id: 501, allow_sending_without_reply: true });
  assert.deepEqual(api.of('answerCallbackQuery')[0].body, { callback_query_id: 'M1' });
  await waitFor(() => (state.get('freeformPrompts') || []).some(([k]) => k === '-500:502'));   // survives a restart
  api.push(
    { update_id: 2, message: { message_id: 600, chat: g, from: { id: 6 }, reply_to_message: { message_id: 502 }, text: 'not me' } },
    { update_id: 3, message: { message_id: 601, chat: g, from: { id: 5 }, reply_to_message: { message_id: 502 }, text: '/status' } },
    { update_id: 4, message: { message_id: 602, chat: g, from: { id: 5, username: 'sam' }, reply_to_message: { message_id: 502 }, text: 'smaller scope' } });
  await waitFor(() => events.interactions.length === 1 && events.inbound.length === 2);
  assert.deepEqual(events.interactions[0], { id: 'r-500_602', chatId: '-500', userId: '5', ref: REF, kind: 'modal', fields: { text: 'smaller scope' },
    meta: { platform: 'telegram', messageId: '-500:602', username: 'sam' } });
  assert.deepEqual(events.inbound.map((m) => m.text), ['not me', '/status']);
  await w.replyInteraction('r-500_602', 'Sent your change request. The proposal stays open.');
  assert.deepEqual(api.of('sendMessage').at(-1).body.reply_parameters, { message_id: 602, allow_sending_without_reply: true });
  assert.equal(api.of('answerCallbackQuery').length, 1, 'a typed answer has no press to answer');
});

test('surfaces: a DM is its own conversation, a forum topic or a new topic, else a reply chain; later traffic maps to them, also after a restart', async () => {
  const api = botApi();
  const { ctx, events } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  await w.start();
  const forum = { id: -1009, type: 'supergroup', title: 'ops', is_forum: true };
  const g = { id: -500, type: 'group', title: 'devs' };
  const mention = (t) => ({ text: `@worca_bot ${t}`, entities: [{ type: 'mention', offset: 0, length: 10 }] });
  api.push(
    { update_id: 1, message: { message_id: 20, chat: forum, from: { id: 5 }, message_thread_id: 7, is_topic_message: true, ...mention('in a topic') } },
    { update_id: 2, message: { message_id: 21, chat: forum, from: { id: 5 }, ...mention('in general') } },
    { update_id: 3, message: { message_id: 22, chat: g, from: { id: 5 }, ...mention('in a group') } });
  await waitFor(() => events.inbound.length === 3);
  assert.deepEqual(events.inbound.map((m) => m.chatId), ['-1009', '-1009', '-500'], 'unbound: the plain chat id');
  const header = md('**worca chat**');
  const bodies = () => api.of('sendMessage').map((c) => c.body);
  assert.deepEqual(await w.send('42', header, { thread: { fromMessageId: '42:3', name: 'worca: hi' } }),
    { ok: true, chunks: 1, messageIds: ['42:501'], threadId: '42' });
  assert.deepEqual(bodies()[0].reply_parameters, { message_id: 3, allow_sending_without_reply: true });
  assert.deepEqual(await w.send('-1009', header, { thread: { fromMessageId: '-1009:20', name: 'worca: in a topic' } }),
    { ok: true, chunks: 1, messageIds: ['-1009:502'], threadId: '-1009:t7' });
  assert.equal(bodies()[1].message_thread_id, 7);
  assert.deepEqual(await w.send('-1009', header, { thread: { fromMessageId: '-1009:21', name: 'worca: in general' } }),
    { ok: true, chunks: 1, messageIds: ['-1009:503'], threadId: '-1009:t31' });
  assert.deepEqual(api.of('createForumTopic')[0].body, { chat_id: '-1009', name: 'worca: in general' });
  assert.equal(bodies()[2].message_thread_id, 31);
  assert.match(bodies()[3].text, /^Continuing in the topic <a href="https:\/\/t\.me\/c\/9\/31">worca: in general<\/a>\.$/);
  assert.equal(bodies()[3].reply_parameters.message_id, 21);
  assert.deepEqual(await w.send('-500', header, { thread: { fromMessageId: '-500:22', name: 'worca: in a group' } }),
    { ok: true, chunks: 1, messageIds: ['-500:505'], threadId: '-500:r505' });
  assert.equal(bodies()[4].reply_parameters.message_id, 22);
  await w.send('-1009:t7', header);                       // 506
  assert.equal(bodies()[5].message_thread_id, 7);
  await w.send('-500:r505', header);                      // 507, replies to the chain's newest message (the header)
  assert.equal(bodies()[6].reply_parameters.message_id, 505);
  api.push(
    { update_id: 4, message: { message_id: 30, chat: forum, from: { id: 5 }, message_thread_id: 7, is_topic_message: true, text: 'more' } },
    { update_id: 5, message: { message_id: 31, chat: forum, from: { id: 5 }, message_thread_id: 8, is_topic_message: true, text: 'other topic' } },
    { update_id: 6, message: { message_id: 32, chat: g, from: { id: 6 }, reply_to_message: { message_id: 507 }, text: 'reply to the bot' } },
    { update_id: 7, message: { message_id: 33, chat: g, from: { id: 5 }, reply_to_message: { message_id: 32 }, text: 'reply to a reply' } },
    { update_id: 8, message: { message_id: 34, chat: g, from: { id: 5 }, text: 'plain' } },
    { update_id: 9, callback_query: { id: 'CQ9', from: { id: 5 }, message: { message_id: 505, chat: g }, data: `b:${REF}` } },
    { update_id: 10, callback_query: { id: 'CQ10', from: { id: 5 }, message: { message_id: 502, chat: forum, message_thread_id: 7, is_topic_message: true }, data: `b:${REF}` } });
  await waitFor(() => events.inbound.length === 8 && events.interactions.length === 2);
  assert.deepEqual(events.inbound.slice(3).map((m) => m.chatId), ['-1009:t7', '-1009', '-500:r505', '-500:r505', '-500']);
  assert.deepEqual(events.interactions.map((e) => e.chatId), ['-500:r505', '-1009:t7']);
  await w.send('-500:r505', header);
  assert.equal(bodies().at(-1).reply_parameters.message_id, 33, 'the chain answers its newest message');
  await w.stop();
  // A restarted worker still knows the topics and chains (ctx.state), but not the starting mentions.
  const api2 = botApi();
  const w2 = createTelegramWorker(ctx, { fetchFn: api2.fetchFn, _sleep: async () => {} });
  await w2.start();
  api2.push(
    { update_id: 11, message: { message_id: 40, chat: forum, from: { id: 5 }, message_thread_id: 31, is_topic_message: true, text: 'still here' } },
    { update_id: 12, message: { message_id: 41, chat: g, from: { id: 5 }, reply_to_message: { message_id: 505 }, text: 'still chained' } });
  await waitFor(() => events.inbound.length === 10);
  assert.deepEqual(events.inbound.slice(8).map((m) => m.chatId), ['-1009:t31', '-500:r505']);
  await assert.rejects(w2.send('-500', header, { thread: { fromMessageId: '-500:22', name: 'x' } }),
    (e) => e.permanent === true && /mention the bot again/.test(e.message));
  await w2.stop();
});

test('a topic Telegram refuses to create is a permanent refusal naming the admin right', async () => {
  const api = botApi((method) => (method === 'createForumTopic'
    ? json({ ok: false, error_code: 400, description: 'Bad Request: not enough rights to create a topic' }, 400) : undefined));
  const { ctx, events } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  await w.start();
  api.push({ update_id: 1, message: { message_id: 21, chat: { id: -1009, type: 'supergroup', is_forum: true }, from: { id: 5 },
    text: '@worca_bot hi', entities: [{ type: 'mention', offset: 0, length: 10 }] } });
  await waitFor(() => events.inbound.length === 1);
  await assert.rejects(w.send('-1009', md('h'), { thread: { fromMessageId: '-1009:21', name: 'worca: hi' } }),
    (e) => e.permanent === true && e.kind === 'plugin' && /Manage topics/.test(e.message));
  assert.equal(api.of('sendMessage').length, 0);
  await w.stop();
});

test('edits: editMessageText with the keyboard; "not modified" is success; a deleted message is a permanent not-found; a refused URL button is dropped once', async () => {
  let mode = 'ok';
  const api = botApi((method, body) => {
    if (method === 'editMessageText' && mode === 'same') return json({ ok: false, description: 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message' }, 400);
    if (method === 'editMessageText' && mode === 'gone') return json({ ok: false, description: 'Bad Request: message to edit not found' }, 400);
    if (method === 'sendMessage' && (body.reply_markup?.inline_keyboard || []).flat().some((b) => b.url)) return json({ ok: false, description: 'Bad Request: BUTTON_URL_INVALID' }, 400);
    return undefined;
  });
  const { ctx } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  const msg = { ...md('Run started'), controls: [{ kind: 'button', ref: REF, label: 'Stop', style: 'danger' },
    { kind: 'link', label: 'Open in worca', url: 'http://localhost:4317/#chat/ask_1' }] };
  assert.deepEqual(await w.send('-500:r505', msg, { edit: { messageId: '-500:507' } }), { ok: true, messageIds: ['-500:507'] });
  const e = api.of('editMessageText')[0].body;
  assert.deepEqual([e.chat_id, e.message_id, e.parse_mode], ['-500', 507, 'HTML']);
  assert.deepEqual(e.reply_markup.inline_keyboard.flat().map((b) => b.text), ['Stop', 'Open in worca']);
  assert.deepEqual((await w.send('42', md('no buttons'), { edit: { messageId: '42:9' } })).messageIds, ['42:9']);
  assert.deepEqual(api.of('editMessageText')[1].body.reply_markup, { inline_keyboard: [] }, 'an edit without controls removes the keyboard');
  mode = 'same';
  assert.equal((await w.send('-500:r505', msg, { edit: { messageId: '-500:507' } })).ok, true);
  mode = 'gone';
  await assert.rejects(w.send('-500:r505', msg, { edit: { messageId: '-500:507' } }), (err) => err.permanent === true && /not found/.test(err.message));
  mode = 'ok';
  assert.equal((await w.send('-500', msg)).ok, true);
  assert.deepEqual(api.of('sendMessage').map((c) => c.body.reply_markup.inline_keyboard.flat().map((b) => b.text)), [['Stop', 'Open in worca'], ['Stop']]);
});

test('react: worca marks map to Telegram reactions; an add replaces, a stale remove keeps the newer mark; 429 waits or goes back; refusals permanent; 5xx transient', async () => {
  let mode = 'ok';
  const sleeps = [];
  const api = botApi((method) => {
    if (method !== 'setMessageReaction') return undefined;
    if (mode === '429') { mode = 'ok'; return json({ ok: false, parameters: { retry_after: 2 } }, 429); }
    if (mode === '429long') return json({ ok: false, parameters: { retry_after: 30 } }, 429);
    if (mode === 'invalid') return json({ ok: false, description: 'Bad Request: REACTION_INVALID' }, 400);
    if (mode === 'gone') return json({ ok: false, description: 'Bad Request: message to react not found' }, 400);
    if (mode === '502') return json({}, 502);
    return undefined;
  });
  const w = createTelegramWorker(fakeCtx().ctx, { fetchFn: api.fetchFn, _sleep: async (ms) => { sleeps.push(ms); } });
  const R = () => api.of('setMessageReaction').map((c) => c.body);
  assert.deepEqual(REACTION_FOR, { '⏳': '👀', '✅': '👌', '❌': '👎', '⏹': '🙈' });
  await w.react('-500:r505', '-500:22', MARK.work, true);
  assert.deepEqual(R()[0], { chat_id: '-500', message_id: 22, reaction: [{ type: 'emoji', emoji: '👀' }] });
  await w.react('-500:r505', '-500:22', MARK.work, false);
  await w.react('-500:r505', '-500:22', MARK.ok, true);
  assert.deepEqual(R().slice(1).map((b) => b.reaction), [[], [{ type: 'emoji', emoji: '👌' }]]);
  await w.react('-500', '-500:22', MARK.work, false);   // ⏳ was replaced by 👌 already: no call, 👌 stays
  assert.equal(R().length, 3);
  for (const [mark, shown] of [[MARK.fail, '👎'], [MARK.stop, '🙈'], ['⏹', '🙈']]) {
    await w.react('42', '42:9', mark, true);
    assert.equal(R().at(-1).reaction[0].emoji, shown);
  }
  mode = '429';
  await w.react('42', '42:9', MARK.work, true);
  assert.deepEqual(sleeps, [2000]);
  mode = '429long';
  await assert.rejects(w.react('42', '42:9', MARK.work, true), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 30000 && e.permanent !== true);
  assert.deepEqual(sleeps, [2000], 'a long 429 goes back to the host at once, never waited out inline');
  mode = 'invalid';
  await assert.rejects(w.react('42', '42:9', MARK.ok, true), (e) => e.permanent === true && /REACTION_INVALID/.test(e.message));
  mode = 'gone';
  await assert.rejects(w.react('42', '42:9', MARK.ok, true), (e) => e.permanent === true && /not found/.test(e.message));
  mode = '502';
  await assert.rejects(w.react('42', '42:9', MARK.ok, true), (e) => e.kind === 'network' && e.permanent !== true);
  await assert.rejects(w.react('42', 'nonsense', MARK.ok, true), (e) => e.permanent === true);
});

test('presses: a host reply longer than a toast answers the press empty and is posted whole', async (t) => {
  const api = botApi();
  const { ctx, events } = fakeCtx();
  const timers = fakeTimers();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  t.after(() => w.stop());
  await w.start();
  await w.send('42', { ...md('pick'), controls: [{ kind: 'button', ref: REF, label: 'Stop', style: 'danger' }] });
  api.push({ update_id: 1, callback_query: { id: 'CQ1', from: { id: 42 }, message: { message_id: 501, chat: { id: 42, type: 'private' } }, data: `b:${REF}` } });
  await waitFor(() => events.interactions.length === 1);
  const long = 'x'.repeat(201);
  assert.deepEqual(await w.replyInteraction('CQ1', long), { ok: true });
  assert.deepEqual(api.of('answerCallbackQuery').map((c) => c.body), [{ callback_query_id: 'CQ1' }]);
  const posted = api.of('sendMessage').at(-1).body;
  assert.equal(posted.text, long, 'all 201 characters are posted');
  assert.deepEqual(posted.reply_parameters, { message_id: 501, allow_sending_without_reply: true });
});

test('topics: a failed conversation start leaves an existing topic unbound, so it routes as the plain chat again', async (t) => {
  let fail = null;
  const api = botApi((method, body) => {
    if (method !== 'sendMessage' || body.message_thread_id !== 7 || !fail) return undefined;
    if (fail === '400') return json({ ok: false, description: 'Bad Request: TOPIC_CLOSED' }, 400);
    if (fail === '429') return json({ ok: false, parameters: { retry_after: 30 } }, 429);
    // Group flood control: one 20 s wait that would succeed after the host's 15 s send timeout gave up.
    if (fail === '429then') { fail = null; return json({ ok: false, parameters: { retry_after: 20 } }, 429); }
    if (fail === '429x5s') return json({ ok: false, parameters: { retry_after: 5 } }, 429);
    throw new Error('socket hang up');
  });
  const { ctx, events, state } = fakeCtx();
  const sleeps = [];
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async (ms) => { sleeps.push(ms); } });
  t.after(() => w.stop());
  await w.start();
  const forum = { id: -1009, type: 'supergroup', title: 'ops', is_forum: true };
  const inTopic = (id, extra) => ({ message_id: id, chat: forum, from: { id: 5 }, message_thread_id: 7, is_topic_message: true, ...extra });
  const mention = { text: '@worca_bot hi', entities: [{ type: 'mention', offset: 0, length: 10 }] };
  const bound = () => (state.get('freeformTopics') || []).some(([k]) => k === '-1009:t7');
  let update = 0;
  const receive = async (id, extra) => {
    const before = events.inbound.length;
    api.push({ update_id: ++update, message: inTopic(id, extra) });
    await waitFor(() => events.inbound.length === before + 1);
    return events.inbound.at(-1);
  };
  const start = (id) => w.send('-1009', md('h'), { thread: { fromMessageId: `-1009:${id}`, name: 'worca: hi' } });
  let id = 20;
  for (const [mode, check] of [['400', (e) => e.permanent === true && /TOPIC_CLOSED/.test(e.message)],
    ['429', (e) => e.kind === 'rate-limit'], ['network', (e) => e.kind === 'network'],
    ['429then', (e) => e.kind === 'rate-limit'], ['429x5s', (e) => e.kind === 'rate-limit']]) {
    fail = mode;
    sleeps.length = 0;
    await receive(id, mention);
    await assert.rejects(start(id), check, mode);
    // The host gives up on a send after 15 s (channel-host sendMessage): a start must fail before that, never succeed late.
    assert.ok(sleeps.reduce((a, b) => a + b, 0) < 15000, `${mode}: the start waited ${sleeps} ms in all, past the host's send timeout`);
    assert.ok(!bound(), `${mode}: the topic is not persisted as bound`);
    assert.equal((await receive(id + 1, { text: '/status' })).chatId, '-1009', `${mode}: a later message in the topic carries the plain chat id`);
    id += 2;
  }
  fail = null;   // a topic bound by a successful start stays bound, even when a second start in it fails
  await receive(40, mention);
  assert.equal((await receive(41, mention)).chatId, '-1009', 'both mentions arrive before the topic is bound');
  assert.equal((await start(40)).threadId, '-1009:t7');
  fail = '400';
  await assert.rejects(start(41), (e) => e.permanent === true);
  fail = null;
  assert.ok(bound(), 'a failed second start keeps the live conversation\'s topic bound');
  assert.equal((await receive(42, { text: 'more' })).chatId, '-1009:t7');
});

test('topics: the pointer to a new topic escapes the thread name', async (t) => {
  const api = botApi();
  const { ctx, events } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  t.after(() => w.stop());
  await w.start();
  api.push({ update_id: 1, message: { message_id: 21, chat: { id: -1009, type: 'supergroup', is_forum: true }, from: { id: 5 },
    text: '@worca_bot hi', entities: [{ type: 'mention', offset: 0, length: 10 }] } });
  await waitFor(() => events.inbound.length === 1);
  await w.send('-1009', md('h'), { thread: { fromMessageId: '-1009:21', name: 'a <b> & c' } });
  assert.equal(api.of('sendMessage').at(-1).body.text, 'Continuing in the topic <a href="https://t.me/c/9/31">a &lt;b&gt; &amp; c</a>.');
});

test('inbound context: reply_to_message is quoted with its caption and document; a caption mention counts; topic starts and the bot\'s own messages inside a conversation are not quoted', async () => {
  const { api, events, stop } = await tgWorker();
  api.push({ update_id: 1, message: { message_id: 10, date: 1700000000, chat: SG, from: ADA, text: '@worca_bot summarise', entities: mention(),
    reply_to_message: { message_id: 9, date: 1699999999, chat: SG, from: BEN, caption: 'the plan',
      document: { file_id: 'doc-9', file_unique_id: 'u9', file_name: 'plan.md', mime_type: 'text/markdown', file_size: 19 } } } });
  const a = await waitFor(() => events.inbound[0]);
  assert.equal(a.text, 'summarise');
  assert.deepEqual([a.replyTo.author, a.replyTo.text, a.replyTo.at, a.replyTo.link], ['Ben', 'the plan', '2023-11-14T22:13:19.000Z', 'https://t.me/c/1234/9']);
  assert.deepEqual(a.replyTo.attachments.map(({ ref, ...x }) => x), [{ name: 'plan.md', contentType: 'text/markdown', size: 19 }]);
  assert.match(a.replyTo.attachments[0].ref, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(isValidIncoming(a), true);

  api.push({ update_id: 2, message: { message_id: 11, date: 1700000001, chat: SG, from: ADA, caption: '@worca_bot look', caption_entities: mention(),
    photo: [{ file_id: 'p-s', file_unique_id: 's', width: 90, height: 90, file_size: 1000 }, { file_id: 'p-l', file_unique_id: 'l', width: 1280, height: 1280, file_size: 50000 }] } });
  const b = await waitFor(() => events.inbound[1]);
  assert.deepEqual([b.text, b.meta.mentionsBot, b.meta.link], ['look', true, 'https://t.me/c/1234/11']);
  assert.deepEqual(b.attachments.map(({ ref, ...x }) => x), [{ name: 'photo-11.jpg', contentType: 'image/jpeg', size: 50000 }]);
  assert.equal(b.replyTo, undefined);

  const FORUM = { id: -1003000, type: 'supergroup', title: 'ops', is_forum: true };
  api.push({ update_id: 3, message: { message_id: 21, date: 1700000002, chat: FORUM, from: ADA, text: '@worca_bot hi', entities: mention(),
    message_thread_id: 20, is_topic_message: true, reply_to_message: { message_id: 20, date: 1700000000, chat: FORUM, from: ADA, forum_topic_created: { name: 'x' } } } });
  const DM = { id: 111, type: 'private', first_name: 'Ada' };
  api.push({ update_id: 4, message: { message_id: 31, date: 1700000003, chat: DM, from: ADA, text: 'yes', reply_to_message: { message_id: 30, date: 1700000000, chat: DM, from: BOTU, text: 'Which branch?' } } });
  api.push({ update_id: 5, message: { message_id: 32, date: 1700000004, chat: DM, from: ADA, text: 'and this', reply_to_message: { message_id: 29, date: 1700000000, chat: DM, from: ADA, text: 'my note' } } });
  api.push({ update_id: 6, message: { message_id: 12, date: 1700000005, chat: SG, from: ADA, text: '@worca_bot what is this', entities: mention(),
    reply_to_message: { message_id: 8, date: 1700000000, chat: SG, from: BOTU, text: 'Run 1234 failed' } } });
  await waitFor(() => events.inbound.length === 6);
  assert.equal(events.inbound[2].replyTo, undefined, 'a topic\'s own start is not a reply');
  assert.equal(events.inbound[3].replyTo, undefined, 'a reply to the bot inside the DM conversation answers it');
  assert.equal(events.inbound[4].replyTo.author, 'Ada');
  assert.equal(events.inbound[5].replyTo.author, 'worca (this bot)', 'a group start may quote the bot\'s notification');
  for (const m of events.inbound) assert.equal(isValidIncoming(m), true);
  await stop();
});

test('albums: messages sharing a media_group_id go out as ONE message (the caption as its text, every file); a later message of the chat sends a pending album first', async () => {
  const api = botApi();
  const { ctx, events, abort } = fakeCtx();
  const { timers, setTimer, clearTimer } = fakeTimers();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {}, setTimer, clearTimer });
  await w.start();
  try {
    const DM = { id: 111, type: 'private', first_name: 'Ada' };
    const photo = (id) => [{ file_id: `p-${id}`, file_unique_id: `u${id}`, width: 90, height: 90, file_size: 1000 + id }];
    api.push(
      { update_id: 1, message: { message_id: 40, date: 1700000000, chat: DM, from: ADA, media_group_id: 'g1', photo: photo(40) } },
      { update_id: 2, message: { message_id: 41, date: 1700000000, chat: DM, from: ADA, media_group_id: 'g1', caption: 'compare these', photo: photo(41) } },
      { update_id: 3, message: { message_id: 42, date: 1700000000, chat: DM, from: ADA, media_group_id: 'g1', photo: photo(42) } });
    await waitFor(() => timers.length === 3);
    assert.equal(events.inbound.length, 0, 'an album waits for its last message');
    assert.deepEqual(timers.map((t) => t.cleared), [true, true, false], 'each arrival restarts the wait');
    timers[2].fn();
    assert.equal(events.inbound.length, 1);
    const a = events.inbound[0];
    assert.deepEqual([a.chatId, a.text, a.meta.messageId], ['111', 'compare these', '111:41'], 'the captioned message leads');
    assert.deepEqual(a.attachments.map((x) => x.name), ['photo-40.jpg', 'photo-41.jpg', 'photo-42.jpg']);
    assert.equal(isValidIncoming(a), true);

    api.push(
      { update_id: 4, message: { message_id: 50, date: 1700000001, chat: DM, from: ADA, media_group_id: 'g2', photo: photo(50) } },
      { update_id: 5, message: { message_id: 51, date: 1700000001, chat: DM, from: ADA, media_group_id: 'g2', photo: photo(51) } },
      { update_id: 6, message: { message_id: 52, date: 1700000002, chat: DM, from: ADA, text: 'and why' } });
    await waitFor(() => events.inbound.length === 3);
    assert.deepEqual(events.inbound.slice(1).map((m) => [m.text, (m.attachments || []).length, m.meta.messageId]),
      [['', 2, '111:50'], ['and why', 0, '111:52']], 'no caption: the first message leads; the album goes out before the next message');
    assert.ok(timers.slice(3).every((t) => t.cleared), 'a sent album leaves no timer behind');
  } finally {
    await w.stop();
    abort();
  }
});

test('fetchFile: getFile then the file URL; the largest photo within the cap; the token only in the download URL, never in an error; 20 MB and tooBig', async () => {
  const downloads = [];
  const inits = [];
  let dl = 'ok';
  const { w, api, events, stop } = await tgWorker((method, body) => {
    if (method !== 'getFile') return undefined;
    if (body.file_id === 'huge') return json({ ok: false, description: 'Bad Request: file is too big' }, 400);
    if (body.file_id === 'dotdot') return json({ ok: true, result: { file_id: 'dotdot', file_unique_id: 'u', file_path: 'documents/../../x.md' } });
    if (body.file_id === 'query') return json({ ok: true, result: { file_id: 'query', file_unique_id: 'u', file_path: 'documents/x.md?a=1' } });
    return json({ ok: true, result: { file_id: body.file_id, file_unique_id: 'u', file_path: `photos/${body.file_id}.jpg` } });
  }, { files: (u, init) => {
    downloads.push(u);
    inits.push(init);
    if (dl === 'boom') throw new TypeError('fetch failed');
    if (dl === '404') return new Response('', { status: 404 });
    if (dl === 'long') return new Response(Buffer.alloc(3000, 1), { status: 200 });
    return new Response(Buffer.from('JPEGDATA'), { status: 200 });
  } });
  api.push({ update_id: 1, message: { message_id: 11, date: 1700000001, chat: { id: 111, type: 'private', first_name: 'Ada' }, from: ADA, caption: 'pic',
    photo: [{ file_id: 'p-s', file_unique_id: 's', file_size: 1000 }, { file_id: 'p-l', file_unique_id: 'l', file_size: 50000 }],
  } });
  api.push({ update_id: 2, message: { message_id: 12, date: 1700000002, chat: { id: 111, type: 'private', first_name: 'Ada' }, from: ADA,
    document: { file_id: 'big', file_unique_id: 'b', file_name: 'video.bin', file_size: 30 * 1024 * 1024 } } });
  api.push({ update_id: 3, message: { message_id: 13, date: 1700000003, chat: { id: 111, type: 'private', first_name: 'Ada' }, from: ADA,
    document: { file_id: 'huge', file_unique_id: 'h', file_name: 'dump.bin' } } });
  for (const [n, fileId] of [[14, 'dotdot'], [15, 'query']]) {
    api.push({ update_id: n - 10, message: { message_id: n, date: 1700000000 + n, chat: { id: 111, type: 'private', first_name: 'Ada' }, from: ADA,
      document: { file_id: fileId, file_unique_id: fileId, file_name: `${fileId}.md`, file_size: 10 } } });
  }
  const ref = (await waitFor(() => events.inbound[0])).attachments[0].ref;
  assert.equal((await waitFor(() => events.inbound[1])).attachments[0].unavailable, 'over the 20 MB the Telegram Bot API lets a bot download');
  assert.equal(String((await w.fetchFile(ref, { maxBytes: 100000 })).data), 'JPEGDATA');
  assert.equal(api.of('getFile').at(-1).body.file_id, 'p-l');
  assert.equal(downloads.at(-1), 'https://api.telegram.org/file/botbot-token-1234/photos/p-l.jpg');
  await w.fetchFile(ref, { maxBytes: 2000 });
  assert.equal(api.of('getFile').at(-1).body.file_id, 'p-s', 'the largest size that fits the cap');
  const calls = api.of('getFile').length;
  await assert.rejects(w.fetchFile(ref, { maxBytes: 500 }), (e) => e.tooBig === true);
  assert.equal(api.of('getFile').length, calls, 'nothing fits: no request');
  for (const [m, re, permanent] of [['boom', /file download failed/, false], ['404', /not found/, true]]) {
    dl = m;
    await assert.rejects(w.fetchFile(ref, { maxBytes: 100000 }), (e) => re.test(e.message) && !e.message.includes('bot-token-1234') && (e.permanent === true) === permanent, m);
  }
  await assert.rejects(w.fetchFile('Z'.repeat(24), { maxBytes: 10 }), (e) => e.permanent === true && /expired/.test(e.message));
  const huge = (await waitFor(() => events.inbound[2])).attachments[0];
  assert.deepEqual([huge.size, typeof huge.ref], [0, 'string'], 'a document of unknown size is offered as a ref');
  await assert.rejects(w.fetchFile(huge.ref, { maxBytes: 100000 }), (e) => e.tooBig === true && e.permanent === true, 'getFile "file is too big" is tooBig');
  assert.ok(inits.length > 0 && inits.every((i) => i?.redirect === 'error'), 'the URL that holds the token is fetched with no redirects');
  dl = 'long';
  await assert.rejects(w.fetchFile(ref, { maxBytes: 2000 }), (e) => e.tooBig === true, 'a body over the cap is cut off, whatever size Telegram declared');
  dl = 'ok';
  const fetched = downloads.length;
  for (const k of [3, 4]) {
    const r = (await waitFor(() => events.inbound[k])).attachments[0].ref;
    await assert.rejects(w.fetchFile(r, { maxBytes: 100000 }), (e) => e.permanent === true && /no file path/.test(e.message), `inbound ${k}`);
  }
  assert.equal(downloads.length, fetched, 'a file path Telegram should never answer is not fetched');
  await stop();
});

test('typing: sendChatAction now and every 4 s (topics carry their thread); a 429 pauses beats until retry_after; refusals stop it', async () => {
  let mode = 'ok';
  const api = botApi((method) => {
    if (method !== 'sendChatAction') return undefined;
    if (mode === 'limit') { mode = 'ok'; return json({ ok: false, parameters: { retry_after: 9 } }, 429); }
    if (mode === '403') return json({ ok: false, description: 'Forbidden: bot was kicked' }, 403);
    return undefined;
  });
  const { ctx, events } = fakeCtx();
  let t = 1_000_000;
  const timers = new Map();
  let nextT = 0;
  const _timers = { setInterval: (fn, ms) => { const id = ++nextT; timers.set(id, { fn, ms }); return id; }, clearInterval: (id) => { timers.delete(id); } };
  const beat = async (ms) => { t += ms; for (const { fn } of [...timers.values()]) fn(); await new Promise((r) => setTimeout(r, 5)); };
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {}, now: () => t, _timers });
  assert.deepEqual(await w.typing('-1003000:t20', true), { ok: true });
  assert.deepEqual(api.of('sendChatAction').map((c) => c.body), [{ chat_id: '-1003000', action: 'typing', message_thread_id: 20 }]);
  assert.deepEqual([...timers.values()].map((x) => x.ms), [4000]);
  await beat(4000);
  assert.equal(api.of('sendChatAction').length, 2);
  mode = 'limit';
  await beat(4000);                                   // 429 retry_after 9 s
  await beat(4000); await beat(4000);
  assert.equal(api.of('sendChatAction').length, 3, 'no request while retry_after runs');
  await beat(4000);
  assert.equal(api.of('sendChatAction').length, 4);
  assert.deepEqual(await w.typing('-1003000:t20', false), { ok: true });
  assert.equal(timers.size, 0);
  mode = '403';
  await assert.rejects(w.typing('-500', true), (e) => e.permanent === true);
  assert.equal(timers.size, 0, 'a refused start starts no refresh');
  mode = 'ok';
  await w.typing('-500', true);
  await beat(31 * 60 * 1000);
  assert.equal(timers.size, 0, 'it ends on its own after 30 min');
  await w.typing('-501', true);
  await w.stop();
  assert.equal(timers.size, 0, 'stop() clears every refresh');
  await assert.rejects(w.typing('not a chat', true), (e) => e.permanent === true);
  void events;
});

test('live status: a status edit spends one 10 s budget of 429 waits, then throws back with retryAfterMs', async () => {
  const api = botApi((method) => (method === 'editMessageText' ? json({ ok: false, parameters: { retry_after: 5 } }, 429) : undefined));
  const { ctx } = fakeCtx();
  const sleeps = [];
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async (ms) => { sleeps.push(ms); } });
  await assert.rejects(w.send('-500:r505', md('⏳ Working on it… · 5 s'), { edit: { messageId: '-500:507' } }), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 5000);
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 10000, `under the host's 15 s send RPC (${sleeps})`);
});

test('live status: a reply longer than one message edits the status message with the first chunk and posts the rest on the same surface, keyboard on the last', async () => {
  const api = botApi();
  const { ctx } = fakeCtx();
  const w = createTelegramWorker(ctx, { fetchFn: api.fetchFn, _sleep: async () => {} });
  const long = 'a'.repeat(4096) + 'b'.repeat(4096) + 'c'.repeat(500);
  const r = await w.send('-500:t12', { title: null, severity: 'info', body: [{ kind: 'text', value: long }],
    controls: [{ kind: 'button', ref: REF, label: 'Stop', style: 'danger' }] }, { edit: { messageId: '-500:507' } });
  const edits = api.of('editMessageText').map((c) => c.body);
  const posts = api.of('sendMessage').map((c) => c.body);
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].reply_markup, { inline_keyboard: [] }, 'the keyboard does not ride the first of several chunks');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => [p.chat_id, p.message_thread_id]), [['-500', 12], ['-500', 12]], 'the rest goes to the same topic');
  assert.equal(posts[0].reply_markup, undefined);
  assert.deepEqual(posts[1].reply_markup.inline_keyboard.flat().map((b) => b.text), ['Stop']);
  assert.equal(edits[0].text + posts.map((p) => p.text).join(''), long, 'nothing of the reply is lost');
  assert.deepEqual(r.messageIds, ['-500:507', '-500:501', '-500:502']);
});

test('telegram-chat 0.4.0 manifest: live status; no history setting and no attachment hosts (files ride as worker refs)', () => {
  const m = JSON.parse(readFileSync(new URL('../plugins/telegram-chat/worca-cc-plugin.json', import.meta.url), 'utf8'));
  assert.equal(m.version, '0.4.0');
  const ch = m.chatChannels[0];
  assert.deepEqual(ch.capabilities, { inbound: true, outbound: true, interactive: true, liveStatus: true });
  assert.equal(ch.configSchema.some((f) => f.key === 'historyOnStart'), false);
  assert.equal('attachmentHosts' in ch, false);
  assert.match(ch.configSchema.find((f) => f.key === 'freeformChat').help, /no channel history/);
});
