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
  // #397: Auto declares itself; the browser's zone rides along for scheduled runs
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
      const calls = { messages: () => ({ ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) }) };
      const ctx = makePanel({ fetchHandler: apiHandler(calls) });
      ctx.panel.open();
      ctx.doc.querySelector('textarea.ask-input').value = 'try again later';
      ctx.doc.querySelector('[data-ask-send]').click();
      await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'turn in flight');
      assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'try again later', 'text preserved on failure');
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
