// test/ask-panel-voice.test.mjs
// The composer's mic (docs/speech.md): click = dictation, long-press / caret menu
// = hands-free, state in the input's placeholder + live region + aria-pressed, transcript → composer (+ auto-send),
// deferred send after a barge-in stop, frames forwarded to the controller, and
// voice off on close / New chat / thread switch / destroy. No mic without the dep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { makePanel, openChat, key } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { createVoiceController } from '../ui/public/ask-voice.mjs';

function fakeVoiceFactory() {
  // `speaks` = null follows the mode (hands-free speaks); true/false overrides it (TTS off, still loading).
  const f = { hooks: null, calls: [], active: false, frames: [], spoken: [], modeNow: null, speaks: null, noted: [] };
  f.create = (hooks) => {
    f.hooks = hooks;
    return {
      start: async (mode) => { f.calls.push(['start', mode]); f.active = true; f.modeNow = mode; hooks.onState('listening', { mode }); },
      stop: async () => { f.calls.push(['stop']); f.active = false; hooks.onState('off', { mode: null }); },
      destroy: async () => { f.calls.push(['destroy']); },
      preload: async () => { f.calls.push(['preload']); },
      onFrame: (fr, live, spoken) => { f.frames.push([fr.type, live]); f.spoken.push([fr.type, spoken]); },
      fail: (m) => { f.calls.push(['fail', m]); f.active = false; hooks.onState('error', { mode: null, detail: m }); },
      active: () => f.active,
      mode: () => (f.active ? f.modeNow : null),
      state: () => 'listening',
      speaks: () => (f.speaks === null ? f.active && f.modeNow === 'handsfree' : f.speaks),
      noteSent: (info) => { f.noted.push(info); },
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
      assert.equal(doc.querySelector('.ask-input').placeholder, 'Listening…');
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
      assert.equal(doc.querySelector('.ask-input').placeholder, 'Ask about any run, agent, or project…');
    } },
    { name: 'no status element; the mic says what a click does; every state reaches the live region', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, panel } = makePanel({ deps: { createVoice: f.create } });
      panel.open();
      const mic = doc.querySelector('[data-ask-mic]');
      const live = doc.querySelector('.sr-only[aria-live="polite"]');
      assert.equal(doc.querySelector('.ask-voice-status'), null);
      assert.deepEqual([mic.dataset.tip, mic.getAttribute('aria-label'), mic.hasAttribute('title')], ['Dictate once · hold for hands-free', 'Voice input', false]);
      assert.deepEqual([doc.querySelector('[data-ask-voice-caret]').dataset.tip, mic.nextElementSibling.matches('[data-ask-voice-caret]')], ['Voice options', true]);
      mic.click();
      await new Promise((r) => setTimeout(r, 0));
      f.hooks.onState('transcribing', { mode: 'dictate' });
      assert.deepEqual([doc.querySelector('.ask-input').placeholder, mic.dataset.tip, live.textContent], ['Transcribing…', 'Stop listening', 'Transcribing…']);
      f.hooks.onState('loading', { mode: 'dictate', detail: 'Downloading speech model… 4 MB' });
      live.textContent = '';
      f.hooks.onState('loading', { mode: 'dictate', detail: 'Downloading speech model… 5 MB' });
      assert.deepEqual([doc.querySelector('.ask-input').placeholder, live.textContent], ['Downloading speech model… 5 MB', ''], 'progress is shown, announced once');
      f.hooks.onState('off', {});
      assert.equal(mic.dataset.tip, 'Dictate once · hold for hands-free');
      live.textContent = '';
      f.hooks.onState('listening', { mode: 'dictate' });
      assert.equal(live.textContent, 'Listening…', 'a new start is announced again: off counts as a state');
      f.hooks.onState('off', {});
      live.textContent = '';
      f.hooks.onState('listening', { mode: 'dictate' });
      assert.equal(live.textContent, 'Listening…', 'listening → off → listening announces twice: off is recorded too');
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

test('a voice error puts the placeholder back at rest, shows the detail under the input; a remembered hands-free mode gets no hold hint', async () => {
  await checkRows([
    { name: 'an error: the placeholder is the resting text, the detail shows in the composer message, the live region says Voice error', run: async () => {
      const f = fakeVoiceFactory();
      const { doc, panel } = makePanel({ deps: { createVoice: f.create } });
      panel.open();
      const input = doc.querySelector('.ask-input');
      const rest = input.placeholder;
      doc.querySelector('[data-ask-mic]').click();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(input.placeholder, 'Listening…');
      f.hooks.onState('error', { mode: null, detail: 'Microphone permission was denied' });
      const msg = doc.querySelector('.ask-composer-msg');
      assert.deepEqual([input.placeholder, msg.hidden, msg.textContent], [rest, false, 'Microphone permission was denied']);
      assert.equal(doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'Voice error');
      assert.equal(doc.querySelector('[data-ask-mic]').getAttribute('aria-pressed'), 'false');
    } },
    { name: 'the remembered mode is hands-free: the mic tip names it with no "hold for hands-free", at rest and after a stop', run: async () => {
      const f = fakeVoiceFactory();
      const { storage } = makePanel();
      storage.setItem('worca-cc.ask.voiceMode', 'handsfree');
      const { doc, panel } = makePanel({ storage, deps: { createVoice: f.create } });
      panel.open();
      const mic = doc.querySelector('[data-ask-mic]');
      assert.equal(mic.dataset.tip, 'Hands-free conversation');
      mic.click();
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual([f.calls[0], mic.dataset.tip], [['start', 'handsfree'], 'Stop listening']);
      mic.click();
      assert.equal(mic.dataset.tip, 'Hands-free conversation');
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

test('voice over a suggestion: the state owns the placeholder, Tab takes nothing; voice off brings the suggestion back', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
  // A finished turn, then its suggestion (test/ask-panel-stream.test.mjs finishedTurn() + suggest()).
  for (const fr of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-done', text: 'Here is the diff summary.', blocks: [], usage: null, costUsd: 0, durationMs: 1, model: 'm', status: 'done' },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(fr);
  ctx.flush();
  ctx.panel.pushServerFrame({ type: 'ask-suggestion', threadId: TID, messageId: MID, text: 'Open a PR' });
  ctx.flush();
  const input = ctx.doc.querySelector('.ask-input');
  assert.equal(input.placeholder, 'Open a PR', 'the suggestion shows before voice starts');
  ctx.doc.querySelector('[data-ask-mic]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(input.placeholder, 'Listening…');
  assert.deepEqual([input.classList.contains('is-suggesting'), input.hasAttribute('aria-describedby')], [false, false]);
  key(ctx.window, input, 'Tab');
  assert.equal(input.value, '', 'Tab does not accept a suggestion the person cannot see');
  f.hooks.onState('off', {});
  assert.equal(input.placeholder, 'Open a PR');
});

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

test('a voice merge stops the turn the panel has not seen start yet, and sends the merged text straight after the stopped turn (P1–P3)', async () => {
  await checkRows([
    { name: 'P1: onBargeIn while the send POST is out: the stop is POSTed right after the 202', run: async () => {
      const f = fakeVoiceFactory();
      let answer;
      const ref = { body: snapBody(), messages: () => new Promise((r) => { answer = () => r({ ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' }) }); }) };
      const ctx = await openWith(ref, { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('Show me the runs', { autoSend: true });
      await ctx.tick();
      assert.equal(posts(ctx, /\/messages$/).length, 1);
      f.hooks.onBargeIn();
      await ctx.tick();
      assert.equal(posts(ctx, /\/stop$/).length, 0, 'no turn to stop until the server took the message');
      answer();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      const order = ctx.fetchCalls.filter((c) => c.opts.method === 'POST' && /\/(messages|stop)$/.test(c.url)).map((c) => c.url.replace(/^.*\//, ''));
      assert.deepEqual(order, ['messages', 'stop']);
      f.hooks.onTranscript('again', { autoSend: true });       // the flag is spent: the next send stops nothing
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(posts(ctx, /\/stop$/).length, 1);
    } },
    { name: 'P2: onBargeIn with a loaded, un-adopted in-flight turn (inFlight, not live) POSTs stop', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith({ body: snapBody(TID, { inFlight: { messageId: 'askm_00000000' } }) }, { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onBargeIn();
      await ctx.tick();
      assert.equal(posts(ctx, new RegExp(`/api/ask/threads/${TID}/stop$`)).length, 1);
    } },
    { name: 'P3: a merged transcript sent after the stopped turn ended goes straight to /messages (no queue)', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      const [start, done] = stampFrames([
        { type: 'ask-start', userMessageId: 'askm_u0000002', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
        { type: 'ask-done', text: '', blocks: [], status: 'stopped', usage: null, costUsd: null, durationMs: 0 },
      ], { threadId: TID, messageId: MID });
      ctx.panel.pushServerFrame(start);
      f.hooks.onBargeIn();
      ctx.panel.pushServerFrame(done);
      await ctx.tick();
      f.hooks.onTranscript('Show me the runs and the failed ones.', { autoSend: true });
      await ctx.tick(); await ctx.tick();
      const sent = posts(ctx, /\/messages$/);
      assert.equal(sent.length, 1);
      assert.equal(JSON.parse(sent[0].opts.body).text, 'Show me the runs and the failed ones.');
      assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 0);
    } },
    { name: 'P4: the merged text sent inside the stopped turn\'s ask-done while the queue drains a typed message waits in the queue (voice stays on)', run: async () => {
      const f = fakeVoiceFactory();
      const merged = 'Show me the runs and the failed ones.';
      const create = (hooks) => {
        const v = f.create(hooks);
        // like createVoiceController: the pending merge is sent synchronously inside onFrame(ask-done)
        v.onFrame = (fr) => { if (fr.type === 'ask-done' && fr.messageId === MID) hooks.onTranscript(merged, { autoSend: true }); };
        return v;
      };
      const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: create } });
      await startHandsFree(ctx);
      const [start, done] = stampFrames([
        { type: 'ask-start', userMessageId: 'askm_u0000002', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
        { type: 'ask-done', text: '', blocks: [], status: 'stopped', usage: null, costUsd: null, durationMs: 0 },
      ], { threadId: TID, messageId: MID });
      ctx.panel.pushServerFrame(start);
      ctx.doc.querySelector('.ask-input').value = 'typed question';
      ctx.doc.querySelector('.ask-input').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await ctx.tick();
      assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1);
      f.hooks.onBargeIn();                                  // the controller's stopForMerge
      ctx.panel.pushServerFrame(done);
      for (let i = 0; i < 8; i++) await ctx.tick();
      assert.equal(f.calls.some((c) => c[0] === 'fail'), false, 'voice is not failed');
      assert.deepEqual(posts(ctx, /\/messages$/).map((c) => JSON.parse(c.opts.body).text), ['typed question']);
      assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'the merged words wait behind it');
      assert.equal(ctx.doc.querySelector('.ask-input').value, '');
      const [start2, done2] = stampFrames([
        { type: 'ask-start', userMessageId: 'askm_u0000009', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:01.000Z' },
        { type: 'ask-done', text: 'ok', blocks: [], status: 'done', usage: null, costUsd: null, durationMs: 0 },
      ], { threadId: TID, messageId: 'askm_00000009' });
      ctx.panel.pushServerFrame(start2);
      ctx.panel.pushServerFrame(done2);
      for (let i = 0; i < 8; i++) await ctx.tick();
      assert.deepEqual(posts(ctx, /\/messages$/).map((c) => JSON.parse(c.opts.body).text), ['typed question', merged]);
    } },
  ]);
});

test('hands-free voice: only a send while hands-free really speaks carries handsFree:true; every other send has no key', async () => {
  const sentBody = async (mode, { speaks = null } = {}) => {
    const f = fakeVoiceFactory();
    f.speaks = speaks;
    const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
    if (mode) {
      ctx.doc.querySelector('[data-ask-voice-caret]').click();
      ctx.doc.querySelector(`.ask-voice-item[data-mode="${mode}"]`).click();
      await ctx.tick();
      assert.deepEqual(f.calls[0], ['start', mode]);
    } else {
      ctx.doc.querySelector('[data-ask-mic]').click();         // create the controller, then turn it off again
      await ctx.tick();
      ctx.doc.querySelector('[data-ask-mic]').click();
      assert.equal(f.active, false);
    }
    f.hooks.onTranscript('what failed?', { autoSend: true });
    await ctx.tick(); await ctx.tick();
    const sent = posts(ctx, /\/messages$/);
    assert.equal(sent.length, 1, `${mode}: one send`);
    return JSON.parse(sent[0].opts.body);
  };
  await checkRows([
    { name: 'hands-free with a speaking voice: handsFree is true', run: async () => {
      const body = await sentBody('handsfree');
      assert.equal(body.handsFree, true);
      assert.equal(body.text, 'what failed?');
    } },
    { name: 'talk mode: no handsFree key', run: async () => { assert.equal('handsFree' in await sentBody('talk'), false); } },
    { name: 'dictation: no handsFree key', run: async () => { assert.equal('handsFree' in await sentBody('dictate'), false); } },
    { name: 'hands-free with speaks() false (TTS off or loading): no handsFree key', run: async () => {
      assert.equal('handsFree' in await sentBody('handsfree', { speaks: false }), false);
    } },
    { name: 'talk mode even with a controller that says it speaks: no handsFree key', run: async () => {
      assert.equal('handsFree' in await sentBody('talk', { speaks: true }), false);
    } },
    { name: 'voice off: no handsFree key', run: async () => { assert.equal('handsFree' in await sentBody(null), false); } },
  ]);
});

test('frames of the current thread reach the controller with the model\'s live spoken text', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith({ body: snapBody() }, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  for (const fr of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000002', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
    { type: 'ask-spoken', text: 'Two runs ' },
    { type: 'ask-spoken', text: 'failed.' },
    { type: 'ask-delta', text: 'Full.' },
  ], { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(fr);
  assert.deepEqual(f.spoken, [['ask-start', ''], ['ask-spoken', 'Two runs '], ['ask-spoken', 'Two runs failed.'], ['ask-delta', 'Two runs failed.']]);
  assert.deepEqual(f.frames.at(-1), ['ask-delta', 'Full.']);
});

// ---- a voice merge replaces the fragment turn (docs/speech.md) ----
/** /messages answers: the first send is askm_u0000009, later ones askm_u000000a… ; `answers[i]` overrides call i. */
function mergeRef(answers = {}) {
  let n = 0;
  return {
    body: snapBody(),
    messages: () => {
      const i = n++;
      if (answers[i]) return answers[i]();
      const hex = (9 + i).toString(16);
      return { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${hex}`, assistantMessageId: `askm_000000${hex.padStart(2, '0')}`.slice(0, 13) }) };
    },
  };
}
const bodies = (ctx) => posts(ctx, /\/messages$/).map((c) => JSON.parse(c.opts.body));
const turnFrames = (userMessageId, messageId, status = 'done') => stampFrames([
  { type: 'ask-start', userMessageId, model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
  { type: 'ask-delta', text: 'I know many things. ' },
  { type: 'ask-done', text: 'I know many things.', blocks: [], status, usage: null, costUsd: null, durationMs: 0 },
], { threadId: TID, messageId });
const ticks = async (ctx, n = 4) => { for (let i = 0; i < n; i++) { await ctx.tick(); ctx.flush(); } };

test('merged sends carry handsFree and supersedes (ended, pending, queued)', async () => {
  const MERGED = 'Do you know how to bake bread?';
  await checkRows([
    { name: 'ended: the reply finished, the merged words are sent with supersedes', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('Do you know how', { autoSend: true });
      await ticks(ctx);
      for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
      await ticks(ctx);
      f.hooks.onTranscript(MERGED, { autoSend: true, supersede: true });
      await ticks(ctx);
      const b = bodies(ctx);
      assert.equal(b.length, 2);
      assert.equal('supersedes' in b[0], false, 'a plain voice send has no supersedes');
      assert.deepEqual([b[1].text, b[1].handsFree, b[1].supersedes], [MERGED, true, 'askm_u0000009']);
    } },
    { name: 'pending: after the stopped turn ended', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('Do you know how', { autoSend: true });
      await ticks(ctx);
      const [start, delta, done] = turnFrames('askm_u0000009', 'askm_00000009', 'stopped');
      ctx.panel.pushServerFrame(start);
      ctx.panel.pushServerFrame(delta);
      f.hooks.onBargeIn();
      await ticks(ctx);
      ctx.panel.pushServerFrame(done);
      f.hooks.onTranscript(MERGED, { autoSend: true, supersede: true });
      await ticks(ctx);
      const b = bodies(ctx);
      assert.deepEqual([b.at(-1).text, b.at(-1).handsFree, b.at(-1).supersedes], [MERGED, true, 'askm_u0000009']);
    } },
    { name: 'queued: merged words that wait in the queue keep supersedes until they drain', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('Do you know how', { autoSend: true });
      await ticks(ctx);
      const [start, delta, done] = turnFrames('askm_u0000009', 'askm_00000009', 'stopped');
      ctx.panel.pushServerFrame(start);
      ctx.panel.pushServerFrame(delta);
      f.hooks.onBargeIn();                                  // the controller's stopForMerge
      f.hooks.onTranscript(MERGED, { autoSend: true, supersede: true });
      await ticks(ctx);
      assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'queued behind the running turn');
      assert.equal(bodies(ctx).length, 1);
      ctx.panel.pushServerFrame(done);
      await ticks(ctx, 8);
      const b = bodies(ctx);
      assert.equal(b.length, 2);
      assert.deepEqual([b[1].text, b[1].handsFree, b[1].supersedes], [MERGED, true, 'askm_u0000009']);
    } },
  ]);
});

test('merge hides the superseded turn: both bubbles leave on the 202, and a resync keeps them hidden', async () => {
  const f = fakeVoiceFactory();
  const ref = mergeRef({ 1: () => ({ ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u000000a', assistantMessageId: 'askm_0000000a', superseded: ['askm_u0000009', 'askm_00000009'] }) }) });
  const ctx = await openWith(ref, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  f.hooks.onTranscript('Do you know how', { autoSend: true });
  await ticks(ctx);
  for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
  await ticks(ctx);
  const texts = () => [...ctx.doc.querySelectorAll('.ask-msg')].map((e) => e.textContent);
  assert.ok(texts().some((t) => t.includes('Do you know how')), 'the fragment shows first');
  assert.ok(texts().some((t) => t.includes('I know many things.')));
  f.hooks.onTranscript('Do you know how to bake bread?', { autoSend: true, supersede: true });
  await ticks(ctx);
  assert.ok(!texts().some((t) => t.includes('I know many things.')), 'the reply bubble is gone');
  assert.ok(!texts().some((t) => /Do you know how$/.test(t.trim())), 'the fragment bubble is gone');
  assert.ok(texts().some((t) => t.includes('Do you know how to bake bread?')), 'the merged bubble remains');
  const row = (id, seq, role, text, supersededBy = null) => ({ id, threadId: TID, seq, role, text, blocks: [], status: role === 'assistant' ? 'done' : null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't', supersededBy });
  ref.body = snapBody(TID, { messages: [
    row('askm_u0000001', 1, 'user', 'hi'),
    row('askm_u0000009', 2, 'user', 'Do you know how', 'askm_u000000a'),
    row('askm_00000009', 3, 'assistant', 'I know many things.', 'askm_u000000a'),
    row('askm_u000000a', 4, 'user', 'Do you know how to bake bread?'),
  ] });
  ctx.panel.onHello([]);
  await ticks(ctx, 8);
  assert.ok(!texts().some((t) => t.includes('I know many things.')), 'still hidden after a reload');
  assert.ok(texts().some((t) => t.includes('Do you know how to bake bread?')));
});

test('supersede refused: one resend without supersedes, both turns stay, no composer error', async () => {
  const f = fakeVoiceFactory();
  const ref = mergeRef({ 1: () => ({ ok: false, status: 409, json: async () => ({ error: 'the earlier message cannot be replaced: its reply changed something or is waiting on a card', code: 'supersede-refused' }) }) });
  const ctx = await openWith(ref, { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  f.hooks.onTranscript('Do you know how', { autoSend: true });
  await ticks(ctx);
  for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
  await ticks(ctx);
  f.hooks.onTranscript('Do you know how to bake bread?', { autoSend: true, supersede: true });
  await ticks(ctx, 6);
  const b = bodies(ctx);
  assert.equal(b.length, 3);
  assert.equal(b[1].supersedes, 'askm_u0000009');
  assert.equal('supersedes' in b[2], false, 'the resend has no supersedes');
  assert.deepEqual({ ...b[1], supersedes: undefined }, { ...b[2], supersedes: undefined }, 'otherwise the same payload');
  assert.equal(ctx.doc.querySelector('.ask-composer-msg').hidden, true, 'no error shown');
  assert.equal(f.calls.some((c) => c[0] === 'fail'), false);
  assert.ok([...ctx.doc.querySelectorAll('.ask-msg')].some((e) => e.textContent.includes('I know many things.')), 'the earlier turn stays');
});

test('a newer message in the chat (another tab): the merge is a plain send', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  f.hooks.onTranscript('Do you know how', { autoSend: true });
  await ticks(ctx);
  for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
  ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: 'askm_u0000077', threadId: TID, seq: 9, role: 'user', text: 'from the other tab', blocks: [], status: null, createdAt: 't' } });
  await ticks(ctx);
  f.hooks.onTranscript('Do you know how to bake bread?', { autoSend: true, supersede: true });
  await ticks(ctx);
  const b = bodies(ctx);
  assert.equal(b.length, 2);
  assert.equal('supersedes' in b[1], false);
});

test('a fragment sent with a quote: the merge is a plain send (its quote is never hidden)', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  ctx.panel.setQuote({ text: 'the quoted line' });
  f.hooks.onTranscript('look at this and', { autoSend: true });
  await ticks(ctx);
  for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
  await ticks(ctx);
  f.hooks.onTranscript('look at this and tell me why', { autoSend: true, supersede: true });
  await ticks(ctx);
  const b = bodies(ctx);
  assert.equal(b.length, 2);
  assert.match(b[0].text, /^> the quoted line/, 'the fragment carried the quote');
  assert.equal('supersedes' in b[1], false);
});

test('typed text in the composer: the merge is a plain send', async () => {
  const f = fakeVoiceFactory();
  const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
  await startHandsFree(ctx);
  f.hooks.onTranscript('Do you know how', { autoSend: true });
  await ticks(ctx);
  for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
  await ticks(ctx);
  ctx.doc.querySelector('.ask-input').value = 'and also';
  f.hooks.onTranscript('Do you know how to bake bread?', { autoSend: true, supersede: true });
  await ticks(ctx);
  const b = bodies(ctx);
  assert.equal(b.length, 2);
  assert.equal(b[1].text, 'and also Do you know how to bake bread?');
  assert.equal('supersedes' in b[1], false);
});

// ---- the panel tells the controller which server turn answers a voice send (noteSent after the 202) ----
const NOTED_9 = { sendId: 'v1', userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' };

test('a voice send is bound to its server turn after the 202 (PV1-PV5)', async () => {
  await checkRows([
    { name: 'PV1: a hands-free voice send posts, then noteSent once with the 202\'s ids', run: async () => {
      const f = fakeVoiceFactory();
      let answer;
      const ref = { body: snapBody(), messages: () => new Promise((r) => { answer = () => r({ ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', assistantMessageId: 'askm_00000009' }) }); }) };
      const ctx = await openWith(ref, { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('what failed?', { autoSend: true }, { sendId: 'v1' });
      await ticks(ctx);
      assert.equal(posts(ctx, /\/messages$/).length, 1);
      assert.deepEqual(f.noted, [], 'nothing before the 202');
      answer();
      await ticks(ctx);
      assert.deepEqual(f.noted, [NOTED_9]);
    } },
    { name: 'PV2: a voice send queued behind a running turn is noted once, with the drained POST\'s ids', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      const [start, delta, done] = turnFrames('askm_u0000002', MID);
      ctx.panel.pushServerFrame(start);
      ctx.panel.pushServerFrame(delta);
      f.hooks.onTranscript('what failed?', { autoSend: true }, { sendId: 'v1' });
      await ticks(ctx);
      assert.equal(ctx.doc.querySelectorAll('[data-ask-queue-item]').length, 1, 'queued');
      assert.deepEqual(f.noted, []);
      ctx.panel.pushServerFrame(done);
      await ticks(ctx, 8);
      assert.equal(bodies(ctx).length, 1);
      assert.deepEqual(f.noted, [NOTED_9]);
    } },
    { name: 'PV3: a supersede-refused 409, then the plain resend\'s 202: noted once, with the resend\'s ids', run: async () => {
      const f = fakeVoiceFactory();
      const ref = mergeRef({ 1: () => ({ ok: false, status: 409, json: async () => ({ error: 'the earlier message cannot be replaced', code: 'supersede-refused' }) }) });
      const ctx = await openWith(ref, { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      f.hooks.onTranscript('Do you know how', { autoSend: true }, { sendId: 'v1' });
      await ticks(ctx);
      for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
      await ticks(ctx);
      f.hooks.onTranscript('Do you know how to bake bread?', { autoSend: true, supersede: true }, { sendId: 'v2' });
      await ticks(ctx, 6);
      assert.equal(bodies(ctx).length, 3);
      assert.deepEqual(f.noted, [NOTED_9, { sendId: 'v2', userMessageId: 'askm_u000000b', assistantMessageId: 'askm_0000000b' }]);
    } },
    { name: 'PV4: a typed send and a dictated-then-typed send: noteSent is never called', run: async () => {
      const f = fakeVoiceFactory();
      const ctx = await openWith(mergeRef(), { deps: { createVoice: f.create } });
      await startHandsFree(ctx);
      ctx.doc.querySelector('.ask-input').value = 'typed question';
      ctx.doc.querySelector('.ask-input').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await ticks(ctx);
      for (const fr of turnFrames('askm_u0000009', 'askm_00000009')) ctx.panel.pushServerFrame(fr);
      await ticks(ctx);
      ctx.doc.querySelector('[data-ask-voice-caret]').click();
      ctx.doc.querySelector('.ask-voice-item[data-mode="dictate"]').click();
      await ticks(ctx);
      f.hooks.onTranscript('dictated words', { autoSend: false });
      ctx.doc.querySelector('.ask-input').dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await ticks(ctx);
      assert.deepEqual(bodies(ctx).map((b) => b.text), ['typed question', 'dictated words']);
      assert.deepEqual(f.noted, []);
    } },
    { name: 'PV5: a voice send answered 500, and one answered 409 turn in flight (queued): not noted', run: async () => {
      for (const answer of [
        { ok: false, status: 500, json: async () => ({}) },
        { ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) },
      ]) {
        const f = fakeVoiceFactory();
        const ctx = await openWith({ body: snapBody(), messages: () => answer }, { deps: { createVoice: f.create } });
        await startHandsFree(ctx);
        f.hooks.onTranscript('what failed?', { autoSend: true }, { sendId: 'v1' });
        await ticks(ctx);
        assert.equal(posts(ctx, /\/messages$/).length, 1, `${answer.status}: posted`);
        assert.deepEqual(f.noted, [], `${answer.status}: not noted`);
      }
    } },
  ]);
});

/**
 * The REAL controller behind the panel. The panel passes only its four hooks; the wrapper adds a controller-side
 * window (jsdom's fails voiceSupport), its own /api/speech (the default browser engines), a fake VAD, a player that
 * records what it plays, and browser engines that transcribe and speak (sentence i renders as i+1 samples).
 */
function realVoiceRig() {
  const rig = { vad: null, played: [], current: null, spoken: [] };
  const lib = { MicVAD: { new: async (o) => { rig.vad = o; return { start: async () => {}, pause: async () => {}, destroy: async () => {}, setOptions: () => {} }; } } };
  const playAudio = (blob) => {
    let done;
    const ended = new Promise((r) => { done = r; });
    rig.current = { end: () => done('ended') };
    rig.played.push(blob.text);
    return { ended, stop: () => done('stopped') };
  };
  class FakeBlob {
    constructor(parts) {
      const p = parts[0];
      this.text = rig.spoken[new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(40, true) / 2 - 1];
    }
  }
  const win = {
    isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } }, AudioContext: function () {}, Blob: FakeBlob,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout,
  };
  const fetch = async (url) => (url === '/api/speech'
    ? { ok: true, json: async () => ({ stt: { engine: 'browser' }, tts: { engine: 'browser' } }) }
    : { ok: false, status: 404, json: async () => ({}) });
  const browserSpeech = () => ({
    load: async () => {}, release() {},
    transcribe: async () => 'what failed?',
    speak: async (text) => { rig.spoken.push(text); return { audio: new Float32Array(rig.spoken.length), rate: 16000 }; },
  });
  rig.create = (hooks) => createVoiceController({ ...hooks, win, fetch, loadVad: async () => lib, playAudio, browserSpeech, ackPhrases: [] });
  return rig;
}

test('PV6: in the real panel, a hands-free utterance is sent with handsFree, its own turn is spoken, and the chip listens again', async () => {
  const rig = realVoiceRig();
  const ctx = await openWith(mergeRef(), { deps: { createVoice: rig.create } });
  await startHandsFree(ctx);
  await ticks(ctx, 6);
  const chip = ctx.doc.querySelector('.ask-voice-status');
  assert.equal(chip.textContent, 'Listening…');
  rig.vad.onSpeechEnd(new Float32Array(1600));
  await ticks(ctx, 6);
  const b = bodies(ctx);
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].text, b[0].handsFree], ['what failed?', true]);
  // Another turn in the chat (an event, another tab) after the 202: never spoken as this send's answer.
  for (const fr of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u00000e1', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:00.000Z' },
    { type: 'ask-spoken', text: 'Event news. ' },
    { type: 'ask-done', text: 'Event news.', blocks: [], status: 'done', usage: null, costUsd: null, durationMs: 0 },
  ], { threadId: TID, messageId: 'askm_000000e1' })) ctx.panel.pushServerFrame(fr);
  await ticks(ctx, 6);
  assert.deepEqual(rig.played, []);
  for (const fr of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000009', model: 'm', effort: 'high', startedAt: '2026-09-29T00:00:01.000Z' },
    { type: 'ask-spoken', text: 'Two runs failed. ' },
    { type: 'ask-done', text: 'Two runs failed, both reviews.', blocks: [], status: 'done', usage: null, costUsd: null, durationMs: 0 },
  ], { threadId: TID, messageId: 'askm_00000009' })) ctx.panel.pushServerFrame(fr);
  await ticks(ctx, 6);
  assert.deepEqual(rig.played, ['Two runs failed.']);
  rig.current.end();
  await ticks(ctx, 6);
  assert.equal(chip.textContent, 'Listening…');
});
