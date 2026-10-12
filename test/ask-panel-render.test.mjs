// test/ask-panel-render.test.mjs — persisted-thread rendering + scroll pinning
// (spec §10.5, §10.4). Threads load through the public path: threads popover →
// row click → switchThread → GET /api/ask/threads/:id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

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
  await ctx.tick();                                    // the first show loaded the History column (closed at 1024px; rows built)
  ctx.doc.querySelector('[data-chat-history] .ask-thread-pick').click();
  await ctx.tick();
  await ctx.tick();
  ctx.flush();
}

const userRow = (id, seq, text, blocks = []) => ({ id, threadId: TID, seq, role: 'user', text, blocks, status: null, reason: null, model: null, effort: null, usage: null, costUsd: null, durationMs: null, createdAt: 't' });
const asstRow = (id, seq, over = {}) => ({ id, threadId: TID, seq, role: 'assistant', text: 'the answer', blocks: [], status: 'done', reason: null, model: 'claude-opus-5-5', effort: 'high', usage: { input: 900, output: 1100, cacheRead: 0, cacheCreation: 0, ctx: 2000 }, costUsd: 0.14, durationMs: 6400, createdAt: 't', ...over });

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

test('ask-panel-render: user bubble + attachment pills, plain-fallback answer, activity head (dot, elapsed, meter; stopped keeps its label)', async () => {
  await checkRows([
    { name: 'ask-panel-render: user bubble + attachment pills, assistant answer plain fallback', run: async () => {
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
    } },
    { name: 'ask-panel-render: activity head — dot, elapsed, meter; stopped keeps its label', run: async () => {
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
    } },
  ]);
});

test('ask-panel-render: agent row — name · model · tokens · ≈$ · status, ctx fill (or cumulative tokens), "fill / window ctx" when known; expand survives update', async () => {
  await checkRows([
    { name: 'ask-panel-render: agent row carries name · model · tokens · ≈$ · status; expand survives update', run: async () => {
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
      // a FULL re-render (a reconnect resync reloads the thread into a fresh
      // model) keeps the expansion — st.expandedAgents is panel-level (§10.5)
      ctx.panel.onHello([]);
      await ctx.tick();
      await ctx.tick();
      ctx.flush();
      assert.ok(ctx.doc.querySelector('.ask-agent-log'), 'expanded state survives a re-render');
    } },
    { name: 'ask-panel-render: an agent block with ctx shows the fill; without ctx it falls back to the cumulative tokens', run: async () => {
      const withCtx = { kind: 'agent', id: 'toolu_1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 25321, ctx: 11645, usage: null, costUsd: 0.0017, estimated: true, status: 'done', durationMs: 2861, log: [] };
      const noCtx = { kind: 'agent', id: 'toolu_2', label: 'old agent', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, usage: null, costUsd: 0.001, estimated: true, status: 'done', durationMs: 100, log: [] };
      const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [withCtx, noCtx] })]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      const rows = [...ctx.doc.querySelectorAll('.ask-agent-row')];
      assert.match(rows[0].textContent, /11\.6k ctx/, 'ctx wins over the cumulative figure');
      assert.ok(!/25\.3k tok/.test(rows[0].textContent));
      assert.match(rows[1].textContent, /5\.3k tok/, 'a legacy block keeps the cumulative fallback');
    } },
    { name: 'ask-panel-render: an agent row with a known window shows "fill / window ctx", coloured, with a hover; the context popover\'s Agents list shows it too', run: async () => {
      const agent = { kind: 'agent', id: 'toolu_1', label: 'scan logs', type: 'general-purpose', model: 'claude-haiku-4-5-20251001', tokens: 160000, ctx: 160000, ctxWindow: 200000, usage: { input: 10, output: 69, cacheRead: 4564, cacheCreation: 678 }, costUsd: 0.0017, estimated: true, status: 'done', durationMs: 2861, log: [] };
      const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [agent] })]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      const fill = ctx.doc.querySelector('.ask-agent-row .ask-agent-tokens');
      assert.equal(fill.textContent, '160.0k / 200k ctx');
      assert.ok(fill.classList.contains('is-ctx-high'), '160k of a 167k trigger: red');
      assert.match(fill.getAttribute('title'), /^Compaction soon\. 80% of the 200k context window/);
      ctx.doc.querySelector('[data-ask-ctx-btn]').click();
      await ctx.tick();
      assert.match(ctx.doc.querySelector('.ask-ctx-agents .ask-runinfo-sub').textContent, /160\.0k \/ 200k ctx/);
    } },
  ]);
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

test('ask-panel-render: error rows show the red line (fallback text); a ~0 s error turn says Stopped, not "Stopped after"', async () => {
  await checkRows([
    { name: 'ask-panel-render: error rows show the red line with a fallback text', run: async () => {
      const snap = snapBody([
        asstRow('askm_00000001', 1, { status: 'error', text: 'partial', errorMessage: undefined, blocks: [] }),
      ]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      assert.match(ctx.doc.querySelector('.ask-error-line').textContent, /This turn ended with an error\./);
    } },
    { name: 'ask-panel-render: an error turn with no (or a ~0 s) duration says Stopped, not a dangling "Stopped after"', run: async () => {
      for (const durationMs of [null, 0, 20]) {
        const snap = snapBody([
          asstRow('askm_00000001', 1, { status: 'error', text: '', blocks: [], durationMs, errorMessage: 'claude exited with code 1: boom' }),
        ]);
        const ctx = makePanel({ fetchHandler: handlerFor(snap) });
        await openThread(ctx);
        assert.equal(ctx.doc.querySelector('.ask-activity-label').textContent, 'Stopped', `durationMs ${durationMs}`);
        assert.equal(ctx.doc.querySelector('.ask-activity-elapsed').textContent, '');
      }
    } },
  ]);
});

test('ask-panel-render: in-app links — a notice href and the signed-out Claude error\'s Sign in… link', async () => {
  await checkRows([
    { name: 'ask-panel-render: a signed-out Claude error shows one line whose Sign in… link opens Connect Claude Code', run: async () => {
      const snap = snapBody([
        asstRow('askm_00000001', 1, { status: 'error', text: '', blocks: [], errorMessage: 'claude exited with code 1: Not logged in · Please run /login', errorCode: 'claude-signed-out' }),
      ]);
      let opened = 0;
      const ctx = makePanel({ fetchHandler: handlerFor(snap), deps: { openClaudeSetup: () => { opened += 1; } } });
      await openThread(ctx);
      const line = ctx.doc.querySelector('.ask-error-line');
      assert.equal(line.textContent, "Claude Code isn't signed in. Sign in…");
      line.querySelector('a').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(opened, 1);
    } },
    { name: 'ask-panel-render: notice with href renders an in-app link', run: async () => {
      const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [{ kind: 'notice', text: 'Run started — "Fix login"', href: '#running/abc-123' }] })]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      const a = ctx.doc.querySelector('.ask-notice a');
      assert.equal(a.getAttribute('href'), '#running/abc-123');
    } },
  ]);
});

test('ask-panel-render: a classified notice renders the human line (raw detail expert-only) and survives a reload', async () => {
  await checkRows([
    { name: 'ask-panel-render: a classified notice renders the human line, raw detail expert-only', run: async () => {
      const detail = 'claude exited with code 1: [claude-code:unrecognized_model] {"model":"claude-opus-5-5","query_source":"sdk"}';
      const snap = snapBody([
        asstRow('askm_00000001', 1, {
          status: 'error',
          text: 'partial',
          errorMessage: undefined,
          blocks: [{
            kind: 'notice',
            text: "This model isn't available in your environment — try another model.",
            errorClass: 'model',
            detail,
          }],
        }),
      ]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      // No raw red line: the classified notice IS the explanation.
      assert.equal(ctx.doc.querySelector('.ask-error-line'), null);
      const notice = ctx.doc.querySelector('.ask-notice');
      assert.ok(notice, 'the classified notice renders');
      const det = notice.querySelector('details.ask-error-details');
      assert.equal(det.dataset.minLevel, 'expert', 'the raw detail is gated to expert');
      assert.match(det.querySelector('.ask-error-detail-text').textContent, /unrecognized_model/);
      assert.equal(notice.querySelector('.ask-error-action'), null, 'no inline action hijacks the notice');
    } },
    { name: 'ask-panel-render: a classified notice survives a reload untouched (persisted block)', run: async () => {
      const snap = snapBody([
        asstRow('askm_00000001', 1, {
          status: 'error',
          blocks: [{ kind: 'notice', text: 'The endpoint was unreachable — check your connection and retry.', errorClass: 'network', detail: 'connection reset' }],
        }),
      ]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      // openThread already IS the reload path (GET → load(snapshot) → render), so
      // this asserts the re-derived render from the persisted block alone.
      assert.ok(ctx.doc.querySelector('.ask-notice'));
      assert.equal(ctx.doc.querySelector('.ask-error-action'), null);
      assert.equal(ctx.doc.querySelector('.ask-error-line'), null);
    } },
  ]);
});

test('ask-panel-render: scroll pinning drives the jump pill, reopening re-pins, destroy unbinds resize', async () => {
  await checkRows([
    { name: 'ask-panel-render: scroll pinning with instrumented accessors + jump pill', run: async () => {
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
    } },
    { name: 'ask-panel-render: reopening the sheet re-pins', run: async () => {
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
    } },
    { name: 'ask-panel-render: destroy unbinds the window resize listener', run: async () => {
      const snap = snapBody([asstRow('askm_00000001', 1)]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      const removed = [];
      const orig = ctx.window.removeEventListener;
      ctx.window.removeEventListener = function (type, fn, opts) { removed.push(type); return orig.call(this, type, fn, opts); };
      ctx.panel.destroy();
      assert.ok(removed.includes('resize'), 'destroy() unbinds the window resize listener');
      assert.doesNotThrow(() => ctx.window.dispatchEvent(new ctx.window.Event('resize')), 'nothing runs after destroy');
    } },
  ]);
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
