// test/ask-panel-composer.test.mjs — composer, attachments, send/stop
// (spec §10.6, §7.3 client mirror). jsdom has no DataTransfer — files are
// injected with defineProperty(input,'files') (probed working under jsdom 29).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { checkRows } from './helpers/rows.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function apiHandler(calls = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    }
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      if (calls.messages) return calls.messages(url, opts);
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) };
    }
    if (url === `/api/ask/threads/${TID}/stop` && method === 'POST') {
      calls.stopped = (calls.stopped || 0) + 1;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

function injectFiles(ctx, files) {
  const input = ctx.doc.querySelector('.ask-composer input[type="file"]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
}

const mkFile = (ctx, name, content) => new ctx.window.File([content], name, { type: 'text/plain' });

test('ask-panel-composer: attach → chip; send posts base64 attachments and the picker model', async () => {
  const bodies = [];
  const calls = {
    messages: (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) }; },
  };
  const ctx = makePanel({ fetchHandler: apiHandler(calls), getPageContext: () => ({ view: 'new' }) });
  ctx.panel.open();
  injectFiles(ctx, [mkFile(ctx, 'notes.md', 'hello world')]);
  await ctx.tick();
  await ctx.tick();
  const chip = ctx.doc.querySelector('.ask-chip');
  assert.ok(chip);
  assert.match(chip.textContent, /notes\.md/);
  ctx.doc.querySelector('textarea.ask-input').value = 'summarize the notes';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick();
  await ctx.tick();
  await ctx.tick();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].text, 'summarize the notes');
  assert.equal(bodies[0].model, 'claude-opus-5-5');
  assert.equal(bodies[0].effort, 'high');
  // P4: No project declares itself (no page target); the browser's zone rides along for scheduled runs
  assert.deepEqual(bodies[0].context, { view: 'new', pinned: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  assert.equal(bodies[0].attachments.length, 1);
  assert.equal(bodies[0].attachments[0].name, 'notes.md');
  assert.equal(bodies[0].attachments[0].dataBase64, Buffer.from('hello world').toString('base64'));
  // 202 aftermath: optimistic user row, cleared composer, header untouched, stored thread
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-msg-user').textContent, /summarize the notes/);
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, '');
  assert.equal(ctx.doc.querySelector('.ask-chip'), null, 'chips cleared after send');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'New chat',
    'no provisional title from the prompt — the header waits for the ask-title frame');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), TID);
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID });
});

test('ask-panel-composer: attachment chips — dedupe by name (newest wins), bad extension/oversize rejected inline, × removes, at most 8', async () => {
  await checkRows([
    { name: 'ask-panel-composer: dedupe by name — newest wins, one chip', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      ctx.panel.open();
      injectFiles(ctx, [mkFile(ctx, 'a.md', 'first')]);
      await ctx.tick(); await ctx.tick();
      injectFiles(ctx, [mkFile(ctx, 'a.md', 'second')]);
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 1);
    } },
    { name: 'ask-panel-composer: bad extension and oversize rejected inline; the × removes a chip', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      ctx.panel.open();
      injectFiles(ctx, [mkFile(ctx, 'evil.exe', 'x')]);
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-chip'), null);
      assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment type not allowed: evil\.exe/);
      injectFiles(ctx, [mkFile(ctx, 'big.md', 'x'.repeat(100 * 1024 * 1024 + 1))]);
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment over 104857600 bytes: big\.md/);
      injectFiles(ctx, [mkFile(ctx, 'ok.md', 'fine')]);
      await ctx.tick(); await ctx.tick();
      assert.ok(ctx.doc.querySelector('.ask-chip'));
      ctx.doc.querySelector('.ask-chip .ask-chip-x').click();
      assert.equal(ctx.doc.querySelector('.ask-chip'), null);
    } },
    { name: 'ask-panel-composer: at most 8 attachments', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      ctx.panel.open();
      injectFiles(ctx, Array.from({ length: 9 }, (_, i) => mkFile(ctx, `f${i}.md`, 'x')));
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 8);
      assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /at most 8 attachments per message/);
    } },
  ]);
});

test('ask-panel-composer: accepted kinds — png (thumbnail chip), pdf, .html/.htm as text; the binary cap is 100 MB; the file input advertises them', async () => {
  await checkRows([
    { name: 'ask-panel-composer (#398): png accepted with a thumbnail chip, pdf accepted, binary cap is 100 MB', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      ctx.panel.open();
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      injectFiles(ctx, [new ctx.window.File([pngBytes], 'shot.png', { type: 'image/png' })]);
      await ctx.tick(); await ctx.tick();
      const chip = ctx.doc.querySelector('.ask-chip');
      assert.ok(chip, 'a png is accepted by the composer');
      assert.match(chip.textContent, /shot\.png/);
      const thumb = chip.querySelector('img.ask-chip-thumb');
      assert.ok(thumb, 'image chips carry a thumbnail');
      assert.ok(thumb.src.startsWith('data:image/png;base64,'), 'thumbnail is a data URI of the bytes just read');
      injectFiles(ctx, [new ctx.window.File(['%PDF-1.7 fake'], 'spec.pdf', { type: 'application/pdf' })]);
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 2, 'pdf accepted too');
      assert.equal(ctx.doc.querySelectorAll('.ask-chip img.ask-chip-thumb').length, 1, 'no thumbnail on a pdf chip');
      injectFiles(ctx, [new ctx.window.File([new Uint8Array(100 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })]);
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment over 104857600 bytes: big\.png/);
      // the file input advertises the binary types
      const accept = ctx.doc.querySelector('.ask-composer input[type="file"]').accept;
      for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']) assert.ok(accept.includes(e), `accept carries ${e}`);
    } },
    { name: 'ask-panel-composer: .html and .htm are accepted as text attachments; the file input advertises them', run: async () => {
      const bodies = [];
      const calls = {
        messages: (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) }; },
      };
      const ctx = makePanel({ fetchHandler: apiHandler(calls) });
      ctx.panel.open();
      injectFiles(ctx, [new ctx.window.File(['<p>hi</p>'], 'page.html', { type: 'text/html' }), new ctx.window.File(['<p>old</p>'], 'OLD.HTM', { type: 'text/html' })]);
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 2, 'both HTML files become chips');
      assert.equal(ctx.doc.querySelectorAll('.ask-chip img.ask-chip-thumb').length, 0, 'no thumbnail: HTML is a text kind');
      const accept = ctx.doc.querySelector('.ask-composer input[type="file"]').accept.split(',');
      for (const e of ['.html', '.htm']) assert.ok(accept.includes(e), `accept carries ${e}`);
      ctx.doc.querySelector('textarea.ask-input').value = 'read it';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.deepEqual(bodies[0].attachments.map((a) => [a.name, a.dataBase64]),
        [['page.html', Buffer.from('<p>hi</p>').toString('base64')], ['OLD.HTM', Buffer.from('<p>old</p>').toString('base64')]]);
    } },
  ]);
});

test('ask-panel-composer: Enter sends, Shift+Enter does not', async () => {
  const bodies = [];
  const calls = { messages: (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) }; } };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.value = 'hello';
  const shift = key(ctx.window, input, 'Enter', { shiftKey: true });
  assert.equal(shift.defaultPrevented, false, 'Shift+Enter keeps the native newline');
  assert.equal(bodies.length, 0);
  const plain = key(ctx.window, input, 'Enter');
  assert.equal(plain.defaultPrevented, true);
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(bodies.length, 1);
});

test('ask-panel-composer: a 409 or 413 body renders verbatim and the composer keeps the text', async () => {
  await checkRows([
    { name: 'ask-panel-composer: a 409 body renders verbatim and the composer keeps the text', run: async () => {
      const calls = { messages: () => ({ ok: false, status: 409, json: async () => ({ error: 'thread is being deleted' }) }) };
      const ctx = makePanel({ fetchHandler: apiHandler(calls) });
      ctx.panel.open();
      ctx.doc.querySelector('textarea.ask-input').value = 'try again later';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'thread is being deleted');
      assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'try again later', 'text preserved on failure');
    } },
    { name: 'ask-panel-composer: a 409 "turn in flight" (another turn won the chat) queues the message instead', run: async () => {
      const calls = { messages: () => ({ ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) }) };
      const ctx = makePanel({ fetchHandler: apiHandler(calls) });
      ctx.panel.open();
      ctx.doc.querySelector('textarea.ask-input').value = 'try again later';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-composer-msg').hidden, true, 'no error line');
      assert.equal(ctx.doc.querySelector('textarea.ask-input').value, '');
      assert.deepEqual([...ctx.doc.querySelectorAll('[data-ask-queue-item] .ask-queue-text')].map((b) => b.textContent), ['try again later']);
    } },
    { name: 'ask-panel-composer: a 413 body renders verbatim', run: async () => {
      const calls = { messages: () => ({ ok: false, status: 413, json: async () => ({ error: 'attachments over 104857600 bytes per message' }) }) };
      const ctx = makePanel({ fetchHandler: apiHandler(calls) });
      ctx.panel.open();
      ctx.doc.querySelector('textarea.ask-input').value = 'big send';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'attachments over 104857600 bytes per message');
    } },
  ]);
});

test('ask-panel-composer: streaming swaps send→stop; stop POSTs; done swaps back', async () => {
  const calls = {};
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'hello';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const bare = [{ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' }];
  for (const f of stampFrames(bare, { threadId: TID, messageId: MID })) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('[data-ask-send]').hidden, true);
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, false);
  ctx.doc.querySelector('[data-ask-stop]').click();
  await ctx.tick();
  assert.equal(calls.stopped, 1, 'stop POSTed');
  const doneBare = [{ type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'stopped', reason: 'user', threadTotals: { costUsd: 0, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0 } }];
  ctx.panel.pushServerFrame({ ...doneBare[0], threadId: TID, messageId: MID, seq: 2 });
  ctx.flush();
  assert.equal(ctx.doc.querySelector('[data-ask-send]').hidden, false);
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, true);
});

test('ask-panel-composer: the user echo replaces the optimistic row (no duplicate) and its 202 attachment ids give the thumbnail without blocking a new upload', async () => {
  await checkRows([
    { name: 'ask-panel-composer: the user echo replaces the optimistic row (no duplicate)', run: async () => {
      const ctx = makePanel({ fetchHandler: apiHandler() });
      ctx.panel.open();
      ctx.doc.querySelector('textarea.ask-input').value = 'echo me';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      ctx.flush();
      assert.equal(ctx.doc.querySelectorAll('.ask-msg-user').length, 1);
      ctx.panel.pushServerFrame({ type: 'ask-message', threadId: TID, message: { id: 'askm_u0000001', threadId: TID, seq: 1, role: 'user', text: 'echo me', blocks: [], status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' } });
      ctx.flush();
      assert.equal(ctx.doc.querySelectorAll('.ask-msg-user').length, 1, 'upsert by id, not append');
    } },
    { name: 'ask-panel-composer (#398): the 202 attachment rows give the echo its ids — thumbnail now, and earlier uploads never block a new one', run: async () => {
    // #398: the sender's own tab must show the thumbnail right away — the 202 body
    // carries the store-minted id, and no later frame re-sends the row.
      const calls = {
        messages: () => ({ ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID,
          attachments: [{ id: 'att_00000001', name: 'shot.png', bytes: 24 * 1024 * 1024, kind: 'image', mime: 'image/png' }] }) }),
      };
      const ctx = makePanel({ fetchHandler: apiHandler(calls) });
      ctx.panel.open();
      injectFiles(ctx, [new ctx.window.File(['not really a png'], 'shot.png', { type: 'image/png' })]);
      await ctx.tick(); await ctx.tick();
      ctx.doc.querySelector('textarea.ask-input').value = 'look at this';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      ctx.flush();
      const img = ctx.doc.querySelector('.ask-msg-user img.ask-attachment-thumb');
      assert.ok(img, 'the echo renders the thumbnail without waiting for a broadcast or reload');
      assert.ok(img.src.endsWith(`/api/ask/threads/${TID}/attachments/att_00000001`));
      // the cap is per message, not per thread: the 24 MB already sent does not
      // count against the next message's files
      injectFiles(ctx, [new ctx.window.File(['still not a png'], 'more.png', { type: 'image/png' })]);
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 1, 'the new file is accepted');
    } },
  ]);
});

// ---- the queue (messages sent while a reply runs), ArrowUp history ------------------------------------------------
const START = (uid = 'askm_u0000001') => ({ type: 'ask-start', userMessageId: uid, model: 'm', effort: 'high', startedAt: 't' });
const DONE = (status = 'done') => ({ type: 'ask-done', text: 'ok', blocks: [], usage: null, costUsd: 0, durationMs: 5, model: 'm', status, threadTotals: {} });

/** A panel with one sent message and its turn streaming. `posted` collects every /messages body. */
async function streamingPanel({ messages } = {}) {
  const posted = [];
  let n = 0;
  const calls = {
    messages: messages || ((url, opts) => {
      posted.push(JSON.parse(opts.body));
      n += 1;
      return { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${n}`, assistantMessageId: `askm_0000000${n}` }) };
    }),
  };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  const input = ctx.doc.querySelector('textarea.ask-input');
  input.value = 'first';
  key(ctx.window, input, 'Enter');
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  let seq = 0;
  const push = (bare, mid = MID) => { seq += 1; ctx.panel.pushServerFrame({ ...bare, threadId: TID, messageId: mid, seq }); ctx.flush(); };
  push(START());
  return { ctx, input, posted, push, calls };
}
const typeAndEnter = async (ctx, input, text) => {
  input.value = text;
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  key(ctx.window, input, 'Enter');
  await ctx.tick(); await ctx.tick();
  ctx.flush();
};
const cards = (ctx) => [...ctx.doc.querySelectorAll('[data-ask-queue-item]')];
const settle = async (ctx) => { await ctx.tick(); await ctx.tick(); await ctx.tick(); ctx.flush(); };

test('ask-panel-composer: queue — sends during a reply are queued (max 3), shown oldest nearest the input; Send disabled when full', async () => {
  const { ctx, input, posted } = await streamingPanel();
  assert.equal(posted.length, 1);
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  await typeAndEnter(ctx, input, 'fourth');
  assert.equal(posted.length, 1, 'nothing POSTed while the reply runs');
  assert.equal(input.value, '', 'a queued message leaves the input');
  const texts = cards(ctx).map((c) => c.querySelector('.ask-queue-text').textContent);
  assert.deepEqual(texts, ['fourth', 'third', 'second'], 'newest on top, oldest last (nearest the input)');
  assert.match(cards(ctx)[2].querySelector('.ask-queue-text').getAttribute('aria-label'), /Queued message 1 of 3, sends next/);
  const send = ctx.doc.querySelector('[data-ask-send]');
  assert.equal(send.disabled, true);
  assert.match(ctx.doc.querySelector('.ask-queue-note').textContent, /Queue full/);
  await typeAndEnter(ctx, input, 'fifth');
  assert.equal(cards(ctx).length, 3, 'the cap holds');
  assert.equal(input.value, 'fifth', 'a refused draft stays in the input');
  assert.match(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, /Queue full/);
});

test('ask-panel-composer: queue — a clean ask-done sends the oldest item, then the next on the next done', async () => {
  const { ctx, input, posted, push } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  push(DONE());
  await settle(ctx);
  assert.deepEqual(posted.map((b) => b.text), ['first', 'second']);
  assert.deepEqual(cards(ctx).map((c) => c.querySelector('.ask-queue-text').textContent), ['third']);
  push(START('askm_u0000002'), 'askm_00000002');
  push(DONE(), 'askm_00000002');
  await settle(ctx);
  assert.deepEqual(posted.map((b) => b.text), ['first', 'second', 'third']);
  assert.equal(cards(ctx).length, 0);
  assert.equal(ctx.doc.querySelector('[data-ask-queue]').hidden, true);
});

test('ask-panel-composer: queue — ask-error and a Stop-button stop pause it; Resume queue sends', async () => {
  for (const ending of ['error', 'stop']) {
    const { ctx, input, posted, push } = await streamingPanel();
    await typeAndEnter(ctx, input, 'second');
    if (ending === 'error') push({ type: 'ask-error', message: 'boom' });
    else { ctx.doc.querySelector('[data-ask-stop]').click(); await ctx.tick(); push({ ...DONE('stopped'), reason: 'user' }); }
    await settle(ctx);
    assert.equal(posted.length, 1, `${ending}: no auto-send`);
    const resume = ctx.doc.querySelector('[data-ask-queue-resume]');
    assert.equal(resume.hidden, false);
    assert.match(ctx.doc.querySelector('.ask-queue-note').textContent, /paused/i);
    resume.click();
    await settle(ctx);
    assert.deepEqual(posted.map((b) => b.text), ['first', 'second']);
  }
});

test('ask-panel-composer: queue — × removes an item; clicking its text edits it in place', async () => {
  const { ctx, input, posted, push } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  cards(ctx).find((c) => c.textContent.includes('second')).querySelector('.ask-queue-x').click();
  assert.deepEqual(cards(ctx).map((c) => c.querySelector('.ask-queue-text').textContent), ['third']);
  cards(ctx)[0].querySelector('.ask-queue-text').click();
  assert.equal(ctx.doc.activeElement, cards(ctx)[0].querySelector('textarea.ask-queue-edit'), 'the text turns into a field');
  assert.equal(input.value, '', 'the composer is left alone');
  key(ctx.window, ctx.doc.activeElement, 'Escape');
  cards(ctx)[0].querySelector('.ask-queue-x').click();
  assert.equal(cards(ctx).length, 0);
  assert.equal(ctx.doc.activeElement, input, 'the last card gone: focus goes to the input');
  push(DONE());
  await ctx.tick(); await ctx.tick();
  assert.equal(posted.length, 1, 'an emptied queue sends nothing');
});

const editField = (ctx) => ctx.doc.querySelector('textarea.ask-queue-edit');
const pen = (card) => card.querySelector('.ask-queue-pen');
const typeInto = (ctx, ta, text) => { ta.value = text; ta.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };

test('ask-panel-composer: queue edit — the pencil edits in place; Enter saves and the item keeps its place, files and quote', async () => {
  const { ctx, input, posted, push } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  injectFiles(ctx, [mkFile(ctx, 'notes.md', 'hello world')]);
  await ctx.tick(); await ctx.tick();
  ctx.panel.setQuote({ text: 'the quoted line' });
  await typeAndEnter(ctx, input, 'third');
  await typeAndEnter(ctx, input, 'fourth');
  const card = cards(ctx)[1];                                                   // 'third', in the middle
  assert.equal(pen(card).getAttribute('aria-label'), 'Edit queued message 2');
  pen(card).click();
  const ta = editField(ctx);
  assert.ok(card.contains(ta) && card.classList.contains('is-editing'));
  assert.equal(ta.value, 'third');
  assert.equal(ctx.doc.activeElement, ta);
  assert.equal(ta.getAttribute('aria-label'), 'Edit queued message 2');
  assert.equal(pen(card).getAttribute('aria-label'), 'Save queued message 2', 'the pencil becomes Save');
  typeInto(ctx, ta, 'third, reworded');
  assert.equal(key(ctx.window, ta, 'Enter', { shiftKey: true }).defaultPrevented, false, 'Shift+Enter is a new line');
  key(ctx.window, ta, 'Enter');
  assert.equal(editField(ctx), null);
  assert.deepEqual(cards(ctx).map((c) => c.querySelector('.ask-queue-text').textContent), ['fourth', 'third, reworded', 'second']);
  assert.equal(cards(ctx)[1], card, 'the same card, same place');
  assert.equal(card.querySelector('.ask-queue-meta').textContent, '1 file · quote');
  assert.equal(ctx.doc.activeElement, card.querySelector('.ask-queue-text'), 'focus back on the card text');
  assert.equal(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'Queued message updated');
  push(DONE());
  await settle(ctx);
  push(START('askm_u0000002'), 'askm_00000002');
  push(DONE(), 'askm_00000002');
  await settle(ctx);
  assert.deepEqual(posted.map((b) => b.text), ['first', 'second', '> the quoted line\n\nthird, reworded']);
  assert.equal(posted[2].attachments[0].name, 'notes.md');
});

test('ask-panel-composer: queue edit — the Save button saves; Escape and an unchanged blur cancel', async () => {
  const { ctx, input } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  const [card] = cards(ctx);
  pen(card).click();
  typeInto(ctx, editField(ctx), 'changed');
  key(ctx.window, editField(ctx), 'Escape');
  assert.equal(editField(ctx), null);
  assert.equal(card.querySelector('.ask-queue-text').textContent, 'second', 'Escape keeps the old text');
  assert.equal(ctx.doc.activeElement, card.querySelector('.ask-queue-text'));
  pen(card).click();
  editField(ctx).blur();
  assert.equal(editField(ctx), null, 'blur without a change closes the field');
  assert.equal(card.querySelector('.ask-queue-text').textContent, 'second');
  pen(card).click();
  typeInto(ctx, editField(ctx), 'via the button');
  pen(card).click();
  assert.equal(editField(ctx), null);
  assert.equal(card.querySelector('.ask-queue-text').textContent, 'via the button');
  assert.equal(pen(card).getAttribute('aria-label'), 'Edit queued message 1');
});

test('ask-panel-composer: queue edit — saving empty text removes the item like ×', async () => {
  const { ctx, input } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  pen(cards(ctx)[0]).click();                                                   // 'third'
  typeInto(ctx, editField(ctx), '   ');
  key(ctx.window, editField(ctx), 'Enter');
  assert.deepEqual(cards(ctx).map((c) => c.querySelector('.ask-queue-text').textContent), ['second']);
  assert.equal(ctx.doc.activeElement, cards(ctx)[0].querySelector('.ask-queue-text'), 'focus moves to the neighbour card');
  assert.equal(ctx.doc.querySelector('.sr-only[aria-live="polite"]').textContent, 'Removed from the queue');
});

test('ask-panel-composer: queue edit — the first item does not drain while edited; saving sends it once idle', async () => {
  const { ctx, input, posted, push } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  pen(cards(ctx)[1]).click();                                                   // 'second', the next to send
  push(DONE());
  await settle(ctx);
  assert.equal(posted.length, 1, 'the edited item waits');
  assert.equal(cards(ctx).length, 2);
  typeInto(ctx, editField(ctx), 'second, edited');
  key(ctx.window, editField(ctx), 'Enter');
  await settle(ctx);
  assert.deepEqual(posted.map((b) => b.text), ['first', 'second, edited'], 'the save drains it');
  assert.deepEqual(cards(ctx).map((c) => c.querySelector('.ask-queue-text').textContent), ['third']);
});

test('ask-panel-composer: queue edit — the item being sent cannot be edited; a focused card that is sent hands focus to the input', async () => {
  let release = null;
  const posted = [];
  let n = 0;
  const messages = (url, opts) => {
    posted.push(JSON.parse(opts.body));
    n += 1;
    const id = n;
    const reply = { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${id}`, assistantMessageId: `askm_0000000${id}` }) };
    if (id === 2) return new Promise((r) => { release = () => r(reply); });
    return reply;
  };
  const { ctx, input, push } = await streamingPanel({ messages });
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  await typeAndEnter(ctx, input, 'fourth');
  cards(ctx)[1].querySelector('.ask-queue-x').click();                         // 'third' goes: focus to a neighbour
  const second = cards(ctx)[1];
  assert.equal(ctx.doc.activeElement, second.querySelector('.ask-queue-text'));
  push(DONE());                                                                 // drains 'second': its POST hangs
  await settle(ctx);
  assert.ok(second.classList.contains('is-sending'));
  assert.equal(pen(second).disabled, true, 'no edit while sending');
  assert.equal(second.querySelector('.ask-queue-text').disabled, true);
  pen(second).click(); second.querySelector('.ask-queue-text').click();
  assert.equal(editField(ctx), null);
  assert.equal(ctx.doc.activeElement, input, 'a focused card that turns to sending hands focus to the input');
  release();
  await settle(ctx);
  assert.equal(cards(ctx).length, 1);
  assert.notEqual(ctx.doc.activeElement, ctx.doc.body, 'the sent card took no focus with it');
  assert.equal(ctx.doc.activeElement, input);
});

test('ask-panel-composer: queue — a repaint keeps the cards it already shows (only a new card plays the entry animation)', async () => {
  const { ctx, input, push } = await streamingPanel();
  await typeAndEnter(ctx, input, 'second');
  const [second] = cards(ctx);
  assert.ok(second.classList.contains('is-entering'), 'a new card enters');
  second.dispatchEvent(new ctx.window.Event('animationend'));
  assert.equal(second.classList.contains('is-entering'), false, 'the entry class leaves once played');
  await typeAndEnter(ctx, input, 'third');
  await typeAndEnter(ctx, input, 'fourth');
  let now = cards(ctx);
  assert.equal(now[2], second, 'enqueueing keeps the existing card element');
  assert.equal(second.classList.contains('is-entering'), false, 'a kept card does not replay the entry animation');
  assert.ok(now[0].classList.contains('is-entering'));
  const third = now[1];
  third.querySelector('.ask-queue-x').click();                                  // remove the middle one
  now = cards(ctx);
  assert.equal(now.length, 2);
  assert.equal(now[1], second, 'removing a card keeps the others');
  assert.equal(ctx.doc.activeElement, now[1].querySelector('.ask-queue-text'), 'focus moves to a neighbour card');
  push(DONE());                                                                 // drain: the oldest shows as sending
  assert.equal(cards(ctx)[1], second);
  assert.ok(second.classList.contains('is-sending'), 'the same card flips to sending');
  assert.equal(second.querySelector('.ask-queue-x').disabled, true);
  await settle(ctx);
  assert.equal(cards(ctx).length, 1);
  assert.match(cards(ctx)[0].querySelector('.ask-queue-text').getAttribute('aria-label'), /Queued message 1 of 1, sends next: fourth/);
});

test('ask-panel-composer: queue — the input keeps a fixed accessible name while a suggestion fills the placeholder', async () => {
  const { input } = await streamingPanel();
  assert.equal(input.getAttribute('aria-label'), 'Message Chat');
});

test('ask-panel-composer: queue — an item drained while the reply already finished before the POST answered still drains the next', async () => {
  let release = null;
  const posted = [];
  let n = 0;
  const messages = (url, opts) => {
    posted.push(JSON.parse(opts.body));
    n += 1;
    const id = n;
    const reply = { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${id}`, assistantMessageId: `askm_0000000${id}` }) };
    if (id === 2) return new Promise((r) => { release = () => r(reply); });
    return reply;
  };
  const { ctx, input, push } = await streamingPanel({ messages });
  await typeAndEnter(ctx, input, 'second');
  await typeAndEnter(ctx, input, 'third');
  push(DONE());                                                                 // drains 'second': its POST hangs
  await settle(ctx);
  assert.equal(posted.length, 2);
  push(START('askm_u0000002'), 'askm_00000002');                                 // its turn runs and ends first
  push(DONE(), 'askm_00000002');
  release();
  await settle(ctx); await settle(ctx);
  assert.deepEqual(posted.map((b) => b.text), ['first', 'second', 'third'], 'the finish seen mid-drain sends the next');
});

test('ask-panel-composer: queue — an item snapshots its attachments and quote; the card shows the file count', async () => {
  const { ctx, input, posted, push } = await streamingPanel();
  injectFiles(ctx, [mkFile(ctx, 'notes.md', 'hello world')]);
  await ctx.tick(); await ctx.tick();
  ctx.panel.setQuote({ text: 'the quoted line' });
  await typeAndEnter(ctx, input, 'about this');
  const [card] = cards(ctx);
  assert.equal(card.querySelector('.ask-queue-meta').textContent, '1 file · quote');
  assert.equal(ctx.doc.querySelector('.ask-chip'), null, 'the composer chips moved into the queued item');
  push(DONE());
  await settle(ctx);
  const body = posted[1];
  assert.equal(body.attachments.length, 1);
  assert.equal(body.attachments[0].name, 'notes.md');
  assert.equal(body.attachments[0].dataBase64, Buffer.from('hello world').toString('base64'));
  assert.match(body.text, /^> the quoted line\n\nabout this$/);
});

test('ask-panel-composer: queue — a 409 "turn in flight" on a drained send keeps the item first for the next done', async () => {
  const posted = [];
  let n = 0;
  const messages = (url, opts) => {
    n += 1;
    if (n === 2) return { ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) };
    posted.push(JSON.parse(opts.body));
    return { ok: true, status: 202, json: async () => ({ userMessageId: `askm_u000000${n}`, assistantMessageId: `askm_0000000${n}` }) };
  };
  const { ctx, input, push } = await streamingPanel({ messages });
  await typeAndEnter(ctx, input, 'second');
  push(DONE());
  await settle(ctx);
  assert.equal(cards(ctx).length, 1, 'the 409 kept the item');
  assert.equal(ctx.doc.querySelector('[data-ask-queue-resume]').hidden, true, 'not paused: it waits for the next finish');
  // The event turn that won the race streams and finishes in this chat.
  push(START('askm_uevent01'), 'askm_event001');
  push(DONE(), 'askm_event001');
  await settle(ctx);
  assert.deepEqual(posted.map((b) => b.text), ['first', 'second']);
  assert.equal(cards(ctx).length, 0);
});

test('ask-panel-composer: Send shows next to Stop only while the input has text during a reply', async () => {
  const { ctx, input } = await streamingPanel();
  const send = ctx.doc.querySelector('[data-ask-send]');
  assert.equal(send.hidden, true);
  input.value = 'x';
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(send.hidden, false);
  assert.equal(send.getAttribute('aria-label'), 'Add to queue');
  assert.equal(ctx.doc.querySelector('[data-ask-stop]').hidden, false);
});

/** A panel whose chat already holds three sent messages: each send's 202 adds the local user row; each turn finishes. */
async function panelWithHistory() {
  const { ctx, input, push } = await streamingPanel();           // 'first' sent, its turn streaming
  push(DONE());
  await ctx.tick();
  let i = 1;
  for (const t of ['two', 'three']) {
    i += 1;
    await typeAndEnter(ctx, input, t);
    await ctx.tick();
    push(START(`askm_u000000${i}`), `askm_0000000${i}`);
    push(DONE(), `askm_0000000${i}`);
    await ctx.tick();
  }
  return { ctx, input };
}

test('ask-panel-composer: ArrowUp walks back through this chat\'s sent messages, ArrowDown forward, then the draft returns; Escape restores the draft', async () => {
  const { ctx, input } = await panelWithHistory();               // sent: 'first', 'two', 'three'
  input.value = 'draft'; input.selectionStart = input.selectionEnd = 0;                // caret at the very start
  let e = key(ctx.window, input, 'ArrowUp');
  assert.equal(e.defaultPrevented, true);
  assert.equal(input.value, 'three');
  key(ctx.window, input, 'ArrowUp'); assert.equal(input.value, 'two');
  key(ctx.window, input, 'ArrowUp'); assert.equal(input.value, 'first');
  key(ctx.window, input, 'ArrowUp'); assert.equal(input.value, 'first', 'stays on the oldest');
  key(ctx.window, input, 'ArrowDown'); assert.equal(input.value, 'two');
  key(ctx.window, input, 'ArrowDown'); key(ctx.window, input, 'ArrowDown');
  assert.equal(input.value, 'draft', 'past the newest: the draft');
  input.selectionStart = input.selectionEnd = 0;                                       // (a native ArrowUp puts it there)
  key(ctx.window, input, 'ArrowUp'); key(ctx.window, input, 'ArrowUp');
  e = key(ctx.window, input, 'Escape');
  assert.equal(e.defaultPrevented, true);
  assert.equal(input.value, 'draft');
  input.value = ''; input.selectionStart = input.selectionEnd = 0;
  key(ctx.window, input, 'ArrowUp');
  assert.equal(input.value, 'three', 'an empty input recalls too');
});

test('ask-panel-composer: arrows are not hijacked mid multi-line text, nor ArrowDown when not walking history', async () => {
  const { ctx, input } = await panelWithHistory();
  input.value = 'line one\nline two'; input.selectionStart = input.selectionEnd = 14;   // caret on line two
  assert.equal(key(ctx.window, input, 'ArrowUp').defaultPrevented, false);
  assert.equal(input.value, 'line one\nline two');
  input.selectionStart = input.selectionEnd = 3;                                      // first line
  assert.equal(key(ctx.window, input, 'ArrowDown').defaultPrevented, false, 'ArrowDown never starts a walk');
  assert.equal(key(ctx.window, input, 'ArrowUp', { shiftKey: true }).defaultPrevented, false, 'Shift+ArrowUp selects');
  assert.equal(key(ctx.window, input, 'Escape').defaultPrevented, false, 'Escape outside a walk is untouched');
});

test('ask-panel-composer: ArrowUp in a draft with no typed newline moves the caret (it may wrap), unless the caret is at the start', async () => {
  const { ctx, input } = await panelWithHistory();
  const long = 'a long single paragraph that wraps over several visual lines in the narrow dock '.repeat(3).trim();
  for (const at of [40, long.length]) {                                                // mid-paragraph, and the end
    input.value = long; input.selectionStart = input.selectionEnd = at;
    assert.equal(key(ctx.window, input, 'ArrowUp').defaultPrevented, false, `caret at ${at}: native caret move`);
    assert.equal(input.value, long, `caret at ${at}: the draft is untouched`);
  }
  input.selectionStart = 0; input.selectionEnd = 5;                                    // a selection from the start
  assert.equal(key(ctx.window, input, 'ArrowUp').defaultPrevented, false);
  input.selectionStart = input.selectionEnd = 0;
  assert.equal(key(ctx.window, input, 'ArrowUp').defaultPrevented, true, 'at the start: the walk begins');
  assert.equal(input.value, 'three');
  key(ctx.window, input, 'Escape');
  assert.equal(input.value, long, 'Escape brings the draft back');
});
