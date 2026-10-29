// test/ask-panel-voice.test.mjs
// The composer's mic (docs/speech.md): click = dictation, long-press / caret menu
// = hands-free, state chip + aria-pressed, transcript → composer (+ auto-send),
// deferred send after a barge-in stop, frames forwarded to the controller, and
// voice off on close / New chat / thread switch / destroy. No mic without the dep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { makePanel, openChat } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

function fakeVoiceFactory() {
  const f = { hooks: null, calls: [], active: false, frames: [] };
  f.create = (hooks) => {
    f.hooks = hooks;
    return {
      start: async (mode) => { f.calls.push(['start', mode]); f.active = true; hooks.onState('listening', { mode }); },
      stop: async () => { f.calls.push(['stop']); f.active = false; hooks.onState('off', { mode: null }); },
      destroy: async () => { f.calls.push(['destroy']); },
      preload: async () => { f.calls.push(['preload']); },
      onFrame: (fr, live) => f.frames.push([fr.type, live]),
      fail: (m) => { f.calls.push(['fail', m]); f.active = false; hooks.onState('error', { mode: null, detail: m }); },
      active: () => f.active,
      mode: () => (f.active ? 'handsfree' : null),
      state: () => 'listening',
    };
  };
  return f;
}

test('voice entry points: mic click dictates (again = off); the caret menu offers dictation / Talk / hands-free; long-press starts hands-free', async () => {
  await checkRows([
    { name: 'click = dictation; transcript lands in the composer without sending', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, fetchCalls, panel } = makePanel({ deps: { createVoice: f.create } });
      panel.open();
      doc.querySelector('[data-ask-mic]').click();
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(f.calls[0], ['start', 'dictate']);
      assert.equal(doc.querySelector('[data-ask-mic]').getAttribute('aria-pressed'), 'true');
      assert.equal(doc.querySelector('.ask-voice-status').textContent, 'Listening…');
      doc.querySelector('.ask-input').value = 'draft';
      f.hooks.onTranscript('hello there', { autoSend: false });
      assert.equal(doc.querySelector('.ask-input').value, 'draft hello there');
      assert.equal(fetchCalls.some((c) => /\/messages$/.test(c.url)), false);
    } },
    { name: 'clicking the mic while voice is on turns it off', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, panel } = makePanel({ deps: { createVoice: f.create } });
      panel.open();
      doc.querySelector('[data-ask-mic]').click();
      await new Promise((r) => setTimeout(r, 0));
      doc.querySelector('[data-ask-mic]').click();
      assert.deepEqual(f.calls.at(-1), ['stop']);
      assert.equal(doc.querySelector('.ask-voice-status').hidden, true);
    } },
    { name: 'caret menu starts hands-free; auto-send posts the message', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, fetchCalls, panel, tick } = makePanel({
        deps: { createVoice: f.create },
        fetchHandler: (url) => (url === '/api/ask/threads'
          ? { ok: true, status: 201, json: async () => ({ thread: { id: 't1', title: null } }) }
          : /\/messages$/.test(url) ? { ok: true, status: 202, json: async () => ({ userMessageId: 'u1', assistantMessageId: 'm1' }) }
          : { ok: true, status: 200, json: async () => ({}) }),
      });
      panel.open();
      doc.querySelector('[data-ask-voice-caret]').click();
      doc.querySelector('.ask-voice-item[data-mode="handsfree"]').click();
      await tick();
      assert.deepEqual(f.calls[0], ['start', 'handsfree']);
      f.hooks.onTranscript('what failed?', { autoSend: true });
      await tick(); await tick();
      const sent = fetchCalls.find((c) => /\/messages$/.test(c.url));
      assert.equal(JSON.parse(sent.opts.body).text, 'what failed?');
    } },
    { name: 'long-press starts hands-free and the following click is swallowed', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, window, panel } = makePanel({ deps: { createVoice: f.create, voiceLongPressMs: 5 } });
      panel.open();
      const mic = doc.querySelector('[data-ask-mic]');
      mic.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 15));
      mic.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
      mic.click();
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(f.calls, [['start', 'handsfree']]);
    } },
    { name: 'caret menu offers "Talk, read the replies" (voice in, text out) between dictation and hands-free', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, panel, tick } = makePanel({ deps: { createVoice: f.create } });
      panel.open();
      doc.querySelector('[data-ask-voice-caret]').click();
      assert.deepEqual([...doc.querySelectorAll('.ask-voice-item')].map((i) => i.dataset.mode), ['dictate', 'talk', 'handsfree']);
      doc.querySelector('.ask-voice-item[data-mode="talk"]').click();
      await tick();
      assert.deepEqual(f.calls[0], ['start', 'talk']);
    } },
  ]);
});

// ---- a loaded thread (the openWith() rig of test/ask-panel-stream.test.mjs) ----
const TID = 'ask_00000001';
const TID2 = 'ask_00000002';
const MID = 'askm_00000001';
const THREAD_ROW = (id, title) => ({ id, title, updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false });

function snapBody(id = TID, over = {}) {
  return {
    thread: { id, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} },
    messages: [{ id: 'askm_u0000001', threadId: id, seq: 1, role: 'user', text: 'hi', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' }],
    attachments: [], runLinks: [], inFlight: null, ...over,
  };
}

/** Snapshots per thread, the History list, and a scripted /messages answer. */
function handlerFor(ref) {
  return (url) => {
    if (/\/messages$/.test(url)) return ref.messages ? ref.messages(url) : { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' }) };
    if (/\/stop$/.test(url)) return { ok: true, status: 200, json: async () => ({}) };
    if (url.startsWith(`/api/ask/threads/${TID2}`)) return { ok: true, status: 200, json: async () => snapBody(TID2) };
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => ref.body };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => ({ threads: [THREAD_ROW(TID, 'T'), THREAD_ROW(TID2, 'U')] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openThread(ctx, index = 0) {
  await openChat(ctx, [TID, TID2][index]);
}

async function openWith(ref, overrides = {}) {
  const ctx = makePanel({ fetchHandler: handlerFor(ref), ...overrides });
  ctx.panel.open();
  await openThread(ctx, 0);
  return ctx;
}

async function startHandsFree(ctx) {
  ctx.doc.querySelector('[data-ask-voice-caret]').click();
  ctx.doc.querySelector('.ask-voice-item[data-mode="handsfree"]').click();
  await ctx.tick();
}

const posts = (ctx, re) => ctx.fetchCalls.filter((c) => re.test(c.url) && c.opts.method === 'POST');

test('barge-in stops the live turn; the transcript is sent once the turn ends', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  const [start, delta, done] = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000002', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
    { type: 'ask-delta', text: 'Hi. ' },
    { type: 'ask-done', text: 'Hi.', blocks: [], status: 'stopped', usage: null, costUsd: null, durationMs: 0 },
  ], { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(start);
  ctx.panel.pushServerFrame(delta);
  f.hooks.onBargeIn();
  await ctx.tick();
  assert.equal(posts(ctx, new RegExp(`/api/ask/threads/${TID}/stop$`)).length, 1);
  f.hooks.onTranscript('new question', { autoSend: true });
  await ctx.tick();
  assert.equal(posts(ctx, /\/messages$/).length, 0, 'nothing is sent while the stopped turn is still live');
  assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'the utterance waits in the queue');
  ctx.panel.pushServerFrame(done);
  await ctx.tick(); await ctx.tick();
  const sent = posts(ctx, /\/messages$/);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].opts.body).text, 'new question');
});

test('voice turns off on close, New chat and thread switch; destroy tears it down', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  ctx.panel.close();
  assert.deepEqual(f.calls.at(-1), ['stop']);

  ctx.panel.open();
  await startHandsFree(ctx);
  ctx.doc.querySelector('.chat-head [data-ask-new-btn]').click();
  assert.deepEqual(f.calls.at(-1), ['stop']);

  await openThread(ctx, 0);
  await startHandsFree(ctx);
  ctx.panel.onHello([]);                         // a reconnect re-loads the SAME thread
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(f.calls.at(-1), ['start', 'handsfree'], 'a resync of the same thread keeps voice on');
  await openThread(ctx, 1);
  assert.deepEqual(f.calls.at(-1), ['stop']);

  ctx.panel.destroy();
  assert.deepEqual(f.calls.at(-1), ['destroy']);
});

test('frames of the current thread reach the controller with the live text', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  for (const fr of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000002', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
    { type: 'ask-delta', text: 'Hi. ' },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(fr);
  ctx.panel.pushServerFrame({ type: 'ask-delta', text: 'other', threadId: TID2, messageId: 'askm_00000077', seq: 1 });
  assert.deepEqual(f.frames, [['ask-start', ''], ['ask-delta', 'Hi. ']]);
});

test('a transcript while a loaded thread has an un-adopted in-flight turn is deferred, not 409ed', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith({ body: snapBody(TID, { inFlight: { messageId: 'askm_00000000' } }) }, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  f.hooks.onTranscript('q', { autoSend: true });
  await ctx.tick();
  assert.equal(posts(ctx, /\/messages$/).length, 0);
  const [done] = stampFrames([{ type: 'ask-done', text: 'ok', blocks: [], status: 'done', usage: null, costUsd: null, durationMs: 0 }], { threadId: TID, messageId: 'askm_00000000' });
  ctx.panel.pushServerFrame(done);
  await ctx.tick(); await ctx.tick();
  const sent = posts(ctx, /\/messages$/);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].opts.body).text, 'q');
});

test('a failed hands-free send (thrown or rejected) turns voice off through the controller with the message shown, no unhandled rejection', async () => {
  await checkRows([
    { name: 'a sendMessage that throws (malformed 201 body) fails voice without an unhandled rejection', run: async () => {
      const unhandled = [];
      const onUnhandled = (e) => unhandled.push(e);
      process.on('unhandledRejection', onUnhandled);
      try {
        const f = fakeVoiceFactory();
        const { doc, panel, tick } = makePanel({
          deps: { createVoice: f.create },
          fetchHandler: (url) => (url === '/api/ask/threads'
            ? { ok: true, status: 201, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }
            : { ok: true, status: 200, json: async () => ({}) }),
        });
        panel.open();
        doc.querySelector('[data-ask-voice-caret]').click();
        doc.querySelector('.ask-voice-item[data-mode="handsfree"]').click();
        await tick();
        f.hooks.onTranscript('hello', { autoSend: true });
        await tick(); await tick(); await tick();
        assert.equal(f.calls.some((c) => c[0] === 'fail'), true);
        assert.deepEqual(unhandled, []);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    } },
    { name: 'a failed hands-free send reports through the controller (voice off, message shown)', run: async () => {
      const f = fakeVoiceFactory();
      const ref = { body: snapBody(), messages: () => ({ ok: false, status: 500, json: async () => ({}) }) };
      const ctx = await openWith(ref, { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('what failed?', { autoSend: true });
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.deepEqual(f.calls.at(-1), ['fail', 'request failed (500)']);
      const msg = ctx.doc.querySelector('.ask-composer-msg');
      assert.equal(msg.hidden, false);
      assert.equal(msg.textContent, 'request failed (500)');
      assert.equal(ctx.doc.querySelector('[data-ask-mic]').getAttribute('aria-pressed'), 'false');
    } },
  ]);
});
