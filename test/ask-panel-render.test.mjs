// test/ask-panel-render.test.mjs — persisted-thread rendering + scroll pinning
// (spec §10.5, §10.4). Threads load through the public path: threads popover →
// row click → switchThread → GET /api/ask/threads/:id.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';

const TID = 'ask_00000001';

function listBody(over = {}) {
  return { threads: [{ id: TID, title: 'My thread', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false, ...over }] };
}

function snapBody(messages, over = {}) {
  return {
    thread: { id: TID, title: 'My thread', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: { costUsd: 0.5, input: 100, output: 200, cacheRead: 0, cacheCreation: 0, turns: 2, agents: 1 } },
    messages,
    attachments: [],
    runLinks: [],
    inFlight: null,
    ...over,
  };
}

function handlerFor(snapshot) {
  return (url) => {
    if (url.startsWith(`/api/ask/threads/${TID}`)) return { ok: true, status: 200, json: async () => snapshot };
    if (url.startsWith('/api/ask/threads')) return { ok: true, status: 200, json: async () => listBody() };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openThread(ctx) {
  ctx.panel.open();
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
}

const userRow = (id, seq, text, blocks = []) => ({ id, threadId: TID, seq, role: 'user', text, blocks, status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const asstRow = (id, seq, over = {}) => ({ id, threadId: TID, seq, role: 'assistant', text: 'the answer', blocks: [], status: 'done', reason: null, model: 'claude-opus-5', effort: 'high', usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0, ctx: 2000 }, costUsd: 0.14, durationMs: 6400, createdAt: 't', ...over });

test('ask-panel-render (#398): an image attachment block renders as a thumbnail served by the download route; pdf stays a pill', async () => {
  const snap = snapBody([
    userRow('askm_u0000001', 1, 'see the screenshot', [
      { kind: 'attachment', id: 'att_00000001', name: 'shot.png', bytes: 2048, attKind: 'image', mime: 'image/png' },
      { kind: 'attachment', id: 'att_00000002', name: 'spec.pdf', bytes: 4096, attKind: 'binary', mime: 'application/pdf' },
    ]),
    asstRow('askm_00000001', 2),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const user = ctx.doc.querySelector('.ask-msg-user');
  const img = user.querySelector('img.ask-attachment-thumb');
  assert.ok(img, 'image block renders an <img>');
  assert.ok(img.src.endsWith(`/api/ask/threads/${TID}/attachments/att_00000001`), 'thumbnail src is the download route');
  const link = user.querySelector('a.ask-attachment-thumb-link');
  assert.equal(link.target, '_blank', 'thumbnail opens full-size in a new tab');
  const pill = user.querySelector('.extra-pill');
  assert.ok(pill && /spec\.pdf/.test(pill.textContent), 'pdf keeps the name pill');
});

test('ask-panel-render: user bubble + attachment pills, assistant answer plain fallback', async () => {
  const snap = snapBody([
    userRow('askm_u0000001', 1, 'what changed in run 4e1f?', [{ kind: 'attachment', id: 'att_00000001', name: 'notes.md', bytes: 41000 }]),
    asstRow('askm_00000001', 2),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const user = ctx.doc.querySelector('.ask-msg-user');
  assert.ok(user);
  assert.match(user.textContent, /what changed in run 4e1f\?/);
  const pill = user.querySelector('.extra-pill');
  assert.ok(pill, 'attachment renders as an extra-pill');
  assert.match(pill.textContent, /notes\.md/);
  // documentary fence — cannot fail unless the builder grows the feature
  assert.equal(pill.querySelector('.extra-pill-x'), null, 'no × on transcript pills');
  const answer = ctx.doc.querySelector('.ask-answer');
  assert.match(answer.textContent, /the answer/);
  assert.equal(ctx.doc.querySelector('.ask-title').textContent, 'My thread', 'header shows the thread title');
});

test('ask-panel-render: activity head — dot, elapsed, meter; stopped keeps its label', async () => {
  const snap = snapBody([
    asstRow('askm_00000001', 1),
    asstRow('askm_00000002', 2, { status: 'stopped', reason: 'max_turns', durationMs: 72000, blocks: [{ kind: 'notice', text: 'Stopped: reached the 40-turn limit (Settings → Ask Worca)' }] }),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const heads = [...ctx.doc.querySelectorAll('.ask-activity-head')];
  assert.ok(!/Worked for/.test(heads[0].textContent), 'a clean turn is Done, a grey dot and its numbers');
  assert.equal(heads[0].querySelector('.ask-activity-label').textContent, 'Done');
  assert.equal(heads[0].firstElementChild.className, 'ask-activity-label', 'the word leads, the dot follows');
  assert.match(heads[0].textContent, /6\.4s/);
  assert.match(heads[0].textContent, /2\.0k ctx/, 'the turn meter shows the turn-end context fill');
  assert.ok(!/tok/.test(heads[0].textContent), 'no cumulative token figure');
  assert.match(heads[0].textContent, /\$0\.14/);
  assert.ok(heads[0].querySelector('.ask-dot-done'));
  assert.match(heads[1].textContent, /Stopped after/);
  assert.ok(!/Done/.test(heads[1].textContent), 'a stopped turn keeps only its own word');
  assert.match(heads[1].textContent, /1m 12s/);
  assert.match(ctx.doc.querySelectorAll('.ask-notice')[0].textContent, /Stopped: reached the 40-turn limit/);
});

test('ask-panel-render: tool rows — op, target with input preview, note', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, {
    blocks: [
      { kind: 'tool', id: 't1', name: 'mcp__worca__list_runs', input: { limit: 20 }, status: 'done', durationMs: 800 },
      { kind: 'tool', id: 't2', name: 'mcp__worca__get_run_diff', input: { _truncated: true, preview: '{"id":"4e1f2a9b"…' }, status: 'error', durationMs: 120, error: 'boom' },
    ],
  })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const rows = [...ctx.doc.querySelectorAll('.ask-tool-row')];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.ask-tool-op').textContent, 'list');
  assert.match(rows[0].querySelector('.ask-tool-target').textContent, /runs/);
  assert.match(rows[0].querySelector('.ask-tool-target').textContent, /"limit":20/);
  assert.equal(rows[0].querySelector('.ask-tool-note').textContent, '0.8s');
  assert.equal(rows[1].querySelector('.ask-tool-op').textContent, 'get');
  assert.match(rows[1].querySelector('.ask-tool-target').textContent, /run diff/);
  assert.match(rows[1].querySelector('.ask-tool-target').textContent, /4e1f2a9b/, 'the preview string renders verbatim');
  assert.equal(rows[1].querySelector('.ask-tool-note').textContent, 'error');
});

test('ask-panel-render: agent row carries name · model · tokens · ≈$ · status; expand survives update', async () => {
  const agent = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: { input: 10, output: 69, cacheRead: 4564, cacheCreation: 678 }, costUsd: 0.0017, estimated: true, status: 'done', durationMs: 2861, log: [{ t: 0, text: '→ list_runs {}' }, { t: 61000, text: '← ok 0.0s' }] };
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [agent] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const row = ctx.doc.querySelector('.ask-agent-row');
  assert.match(row.textContent, /count runs/);
  assert.match(row.textContent, /claude-haiku-4-5/);
  assert.match(row.textContent, /5\.3k tok/);
  assert.match(row.textContent, /≈\$0\.00/);
  assert.match(row.textContent, /done/);
  assert.equal(ctx.doc.querySelector('.ask-agent-log'), null, 'collapsed by default');
  row.click();
  const log = ctx.doc.querySelector('.ask-agent-log');
  assert.ok(log, 'expanded on click');
  assert.match(log.textContent, /00:00/);
  assert.match(log.textContent, /01:01/);
  assert.match(log.textContent, /→ list_runs \{\}/);
  // a FULL re-render (re-selecting the thread rebuilds the transcript from a
  // fresh model) keeps the expansion — st.expandedAgents is panel-level (§10.5)
  ctx.doc.querySelector('[data-ask-threads-btn]').click();
  await ctx.tick();
  ctx.doc.querySelector('.ask-pop [role="menuitem"]').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
  assert.ok(ctx.doc.querySelector('.ask-agent-log'), 'expanded state survives a re-render');
});

test('ask-panel-render: markdown answers render once the real pins load; code highlighted', async () => {
  const realLoad = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
  const hljsLoader = { forLanguage: async (lang) => (lang === 'javascript' ? { lang, highlight: (t) => t.replace('const', '<span class="hljs-keyword">const</span>') } : null) };
  const snap = snapBody([asstRow('askm_00000001', 1, { text: '**bold** and\n\n```js\nconst a = 1;\n```' })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap), loadMarkdown: realLoad, hljsLoader });
  await openThread(ctx);
  await ctx.tick(); // renderer.ensure() resolves
  ctx.flush();
  await ctx.tick(); // highlight() resolves
  const answer = ctx.doc.querySelector('.ask-answer');
  assert.ok(answer.querySelector('strong'), 'markdown rendered');
  assert.ok(answer.classList.contains('ask-md'));
  assert.ok(answer.querySelector('code .hljs-keyword'), 'terminal answers get highlighted');
});

test('ask-panel-render: error rows show the red line with a fallback text', async () => {
  const snap = snapBody([
    asstRow('askm_00000001', 1, { status: 'error', text: 'partial', errorMessage: undefined, blocks: [] }),
  ]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  assert.match(ctx.doc.querySelector('.ask-error-line').textContent, /This turn ended with an error\./);
});

test('ask-panel-render: notice with href renders an in-app link', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [{ kind: 'notice', text: 'Run started — "Fix login"', href: '#running/abc-123' }] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const a = ctx.doc.querySelector('.ask-notice a');
  assert.equal(a.getAttribute('href'), '#running/abc-123');
});

test('ask-panel-render: scroll pinning with instrumented accessors + jump pill', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1)]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const t = ctx.doc.querySelector('.ask-transcript');
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  t.scrollTop = 100; // far from the bottom
  t.dispatchEvent(new ctx.window.Event('scroll'));
  const jump = ctx.doc.querySelector('.ask-jump');
  assert.equal(jump.hidden, false, 'unpinned shows the jump pill');
  jump.click();
  ctx.flush();
  assert.equal(t.scrollTop, 1000, 'jump scrolls to the bottom');
  assert.equal(jump.hidden, true);
  // near the bottom counts as pinned (threshold 24)
  t.scrollTop = 790;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(jump.hidden, true);
});

test('ask-panel-render: reopening the sheet re-pins', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1)]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const t = ctx.doc.querySelector('.ask-transcript');
  Object.defineProperty(t, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  t.scrollTop = 0;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(ctx.doc.querySelector('.ask-jump').hidden, false);
  ctx.panel.close();
  ctx.panel.open();
  ctx.flush();
  assert.equal(t.scrollTop, 1000, 're-pinned on open');
});

test('ask-panel-render: a 404 thread clears the stored id and renders nothing', async () => {
  const ctx = makePanel({
    fetchHandler: (url) => (url.startsWith(`/api/ask/threads/${TID}`)
      ? { ok: false, status: 404, json: async () => ({ error: 'thread not found' }) }
      : { ok: true, status: 200, json: async () => listBody() }),
  });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  await openThread(ctx);
  assert.equal(ctx.doc.querySelector('.ask-msg-user'), null);
  assert.equal(ctx.storage.getItem('worca-cc.ask.thread'), null, 'stored id dropped on 404');
});

test('ask-panel-render: an agent block with ctx shows the fill; without ctx it falls back to the cumulative tokens', async () => {
  const withCtx = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 25321, ctx: 11645, usage: null, costUsd: 0.0017, estimated: true, status: 'done', durationMs: 2861, log: [] };
  const noCtx = { kind: 'agent', id: 'toolu_2', label: 'old agent', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: null, costUsd: 0.001, estimated: true, status: 'done', durationMs: 100, log: [] };
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [withCtx, noCtx] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const rows = [...ctx.doc.querySelectorAll('.ask-agent-row')];
  assert.match(rows[0].textContent, /11\.6k ctx/, 'ctx wins over the cumulative figure');
  assert.ok(!/25\.3k tok/.test(rows[0].textContent));
  assert.match(rows[1].textContent, /5\.3k tok/, 'a legacy block keeps the cumulative fallback');
});
