// test/ask-panel-composer.test.mjs — composer, attachments, send/stop
// (spec §10.6, §7.3 client mirror). jsdom has no DataTransfer — files are
// injected with defineProperty(input,'files') (probed working under jsdom 29).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel, key } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

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
  assert.equal(bodies[0].model, 'claude-opus-5');
  assert.equal(bodies[0].effort, 'high');
  assert.deepEqual(bodies[0].context, { view: 'new', pinned: false }); // #397: Auto declares itself
  assert.equal(bodies[0].attachments.length, 1);
  assert.equal(bodies[0].attachments[0].name, 'notes.md');
  assert.equal(bodies[0].attachments[0].dataBase64, Buffer.from('hello world').toString('base64'));
  // 202 aftermath: optimistic user row, cleared composer, local title, stored thread
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-msg-user').textContent, /summarize the notes/);
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, '');
  assert.equal(ctx.doc.querySelector('.ask-chip'), null, 'chips cleared after send');
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'summarize the notes');
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), TID);
  assert.deepEqual(ctx.wsSends.at(-1), { type: 'subscribe', threadId: TID });
});

test('ask-panel-composer: dedupe by name — newest wins, one chip', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  injectFiles(ctx, [mkFile(ctx, 'a.md', 'first')]);
  await ctx.tick(); await ctx.tick();
  injectFiles(ctx, [mkFile(ctx, 'a.md', 'second')]);
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 1);
});

test('ask-panel-composer: bad extension and oversize rejected inline; the × removes a chip', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  injectFiles(ctx, [mkFile(ctx, 'evil.exe', 'x')]);
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-chip'), null);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment type not allowed: evil\.exe/);
  injectFiles(ctx, [mkFile(ctx, 'big.md', 'x'.repeat(524_289))]);
  await ctx.tick(); await ctx.tick();
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment over 524288 bytes: big\.md/);
  injectFiles(ctx, [mkFile(ctx, 'ok.md', 'fine')]);
  await ctx.tick(); await ctx.tick();
  assert.ok(ctx.doc.querySelector('.ask-chip'));
  ctx.doc.querySelector('.ask-chip .ask-chip-x').click();
  assert.equal(ctx.doc.querySelector('.ask-chip'), null);
});

test('ask-panel-composer (#398): png accepted with a thumbnail chip, pdf accepted, binary cap is 5 MB', async () => {
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
  injectFiles(ctx, [new ctx.window.File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })]);
  await ctx.tick(); await ctx.tick();
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment over 5242880 bytes: big\.png/);
  // the file input advertises the binary types
  const accept = ctx.doc.querySelector('.ask-composer input[type="file"]').accept;
  for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf']) assert.ok(accept.includes(e), `accept carries ${e}`);
});

test('ask-panel-composer: at most 8 attachments', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  injectFiles(ctx, Array.from({ length: 9 }, (_, i) => mkFile(ctx, `f${i}.md`, 'x')));
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelectorAll('.ask-chip').length, 8);
  assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /at most 8 attachments per message/);
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

test('ask-panel-composer: a 409 body renders verbatim and the composer keeps the text', async () => {
  const calls = { messages: () => ({ ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) }) };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'try again later';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'turn in flight');
  assert.equal(ctx.doc.querySelector('textarea.ask-input').value, 'try again later', 'text preserved on failure');
});

test('ask-panel-composer: a 413 body renders verbatim', async () => {
  const calls = { messages: () => ({ ok: false, status: 413, json: async () => ({ error: 'attachment budget for this thread exceeded' }) }) };
  const ctx = makePanel({ fetchHandler: apiHandler(calls) });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'big send';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'attachment budget for this thread exceeded');
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

test('ask-panel-composer: the user echo replaces the optimistic row (no duplicate)', async () => {
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
});

// #398: the sender's own tab must show the thumbnail right away — the 202 body
// carries the store-minted id, and no later frame re-sends the row.
test('ask-panel-composer (#398): the 202 attachment rows give the echo its ids — thumbnail now, and the thread budget counts them', async () => {
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
  // the ledger learned the 24 MB the server reported: a further 2 MB is refused
  // in the composer, before any base64 upload is paid
  injectFiles(ctx, [new ctx.window.File([new Uint8Array(2 * 1024 * 1024)], 'more.png', { type: 'image/png' })]);
  await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-composer-msg').textContent, 'attachment budget for this thread exceeded');
  assert.equal(ctx.doc.querySelector('.ask-chip'), null, 'no chip for the refused file');
});

test('ask-panel-composer: the meter shows context fill — 0 ctx on a fresh panel, the live ctx while streaming, the thread ctx after done', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  assert.equal(ctx.doc.querySelector('.ask-meter-tokens').textContent, '0 ctx', 'fresh panel: no session, no fill');
  ctx.doc.querySelector('textarea.ask-input').value = 'meter me';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.doc.querySelector('.ask-meter-cost').textContent, '', 'no cost rendered before a result');
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-usage', usage: { input: 12, output: 300, cacheRead: 60900, cacheCreation: 0, ctx: 61212 }, costUsd: null },
    { type: 'ask-done', text: 'ok', blocks: [], usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0, ctx: 68400 }, costUsd: 0.14, durationMs: 5, model: 'm', status: 'done', threadTotals: { costUsd: 0.25, input: 9000, output: 10600, cacheRead: 0, cacheCreation: 0, ctx: 68400, turns: 2, agents: 6 } },
  ], { threadId: TID, messageId: MID });
  ctx.panel.pushServerFrame(frames[0]);
  ctx.panel.pushServerFrame(frames[1]);
  ctx.flush();
  assert.match(ctx.doc.querySelector('.ask-meter-tokens').textContent, /61\.2k ctx/, 'live: the streaming call\'s fill');
  ctx.panel.pushServerFrame(frames[2]);
  ctx.flush();
  const meter = ctx.doc.querySelector('[data-ask-meter]');
  assert.match(meter.textContent, /68\.4k ctx/);
  assert.ok(!/tok/.test(meter.textContent), 'cumulative token count is gone');
  assert.match(meter.textContent, /\$0\.25/);
  assert.match(ctx.doc.querySelector('[data-ask-agents-btn]').textContent, /6 agents/);
});

test('ask-panel-composer: a legacy thread (totals without ctx) hides the fill but keeps the cost', async () => {
  const ctx = makePanel({ fetchHandler: apiHandler() });
  ctx.panel.open();
  ctx.doc.querySelector('textarea.ask-input').value = 'meter me';
  ctx.doc.querySelector('[data-ask-send]').click();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-done', text: 'ok', blocks: [], usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0 }, costUsd: 0.14, durationMs: 5, model: 'm', status: 'done', threadTotals: { costUsd: 0.25, input: 9000, output: 10600, cacheRead: 0, cacheCreation: 0, turns: 2, agents: 6 } },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  assert.equal(ctx.doc.querySelector('.ask-meter-tokens').textContent, '', 'no fabricated 0 ctx on a thread that has turns');
  assert.match(ctx.doc.querySelector('[data-ask-meter]').textContent, /\$0\.25/);
});
