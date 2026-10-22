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
  createTelegramWorker, renderToHtml,
} from '../plugins/telegram-chat/channel/worker.mjs';
import { splitText, withRetryLadder } from '../plugins/telegram-chat/lib/send-util.mjs';
import { toTelegramHtml, toSlackMrkdwn } from '../plugins/telegram-chat/lib/markdown.mjs';
import { checkRows } from './helpers/rows.mjs';

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
    meta: { platform: 'telegram', messageId: 1, chatType: 'private', chatTitle: null, username: 'sam', isGroup: false },
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

test('polls ask for message + channel_post; a channel post command is emitted', async () => {
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
  assert.match(decodeURIComponent(polls[0]), /allowed_updates=\["message","channel_post"\]/);
  assert.deepEqual(events.inbound[0], {
    chatId: '-1009', userId: '-1009', text: '/approve *ab12',
    meta: { platform: 'telegram', messageId: 4, chatType: 'channel', chatTitle: 'ops', username: null, isGroup: true },
  });
  await w.stop();
});
