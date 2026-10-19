// test/ask-panel-render.test.mjs — persisted-thread rendering + scroll pinning
// (spec §10.5, §10.4). Threads load through the public path: threads popover →
// row click → switchThread → GET /api/ask/threads/:id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { applyLevel } from '../ui/public/ui-level.mjs';
import { registerFilesCard } from '../ui/public/chat/files-card.mjs';
import { _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { _resetFileRenderers } from '../ui/public/chat/file-renderers.mjs';

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

test('ask-panel-render: user bubble + attachment pills, plain-fallback answer, activity head (one dot-separated line; stopped keeps its label)', async () => {
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
    { name: 'ask-panel-render: activity head — one dot-separated line, the meter beside it; stopped keeps its label', run: async () => {
      const snap = snapBody([
        asstRow('askm_00000001', 1),
        asstRow('askm_00000002', 2, { status: 'stopped', reason: 'max_turns', durationMs: 72000, blocks: [{ kind: 'notice', text: 'Stopped: reached the 40-turn limit (Settings → Chat)' }] }),
      ]);
      const ctx = makePanel({ fetchHandler: handlerFor(snap) });
      await openThread(ctx);
      const heads = [...ctx.doc.querySelectorAll('.ask-activity-head')];
      assert.ok(!/Worked for/.test(heads[0].textContent), 'a clean turn is Done and its numbers');
      assert.equal(heads[0].querySelector('.ask-activity-label').textContent, 'Done');
      assert.equal(heads[0].firstElementChild.className, 'ask-activity-label', 'the word leads');
      // Done · elapsed · the turn-end context fill · cost: no cumulative token figure, no status dot, no spacer
      // pushing the meter to the far edge.
      assert.equal(heads[0].textContent, 'Done · 6.4s · 2.0k ctx · $0.14');
      assert.equal(heads[0].querySelector('.ask-dot, .ask-activity-spacer'), null);
      assert.equal(heads[0].tagName, 'DIV', 'no tool or agent rows: nothing to open, no button');
      assert.equal(heads[0].querySelector('.ask-activity-chev'), null, 'no chevron');
      assert.equal(heads[0].hasAttribute('aria-expanded'), false);
      assert.equal(heads[1].textContent, 'Stopped after 1m 12s · 2.0k ctx · $0.14', 'a stopped turn keeps only its own word');
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

const TOOLS = [
  { kind: 'tool', id: 'toolu_t1', name: 'mcp__worca__list_projects', input: {}, status: 'done', durationMs: 300 },
  { kind: 'tool', id: 'toolu_t2', name: 'mcp__worca__propose_run', input: { title: 'Show a Conflict Banner When Offline Sync Fails', workflowId: 'wf_default', prompt: 'p'.repeat(90) }, status: 'done', durationMs: 500 },
];
const AGENT = { kind: 'agent', id: 'toolu_a1', label: 'count runs', type: 'general-purpose', model: 'claude-haiku-4-5', tokens: 5321, costUsd: 0.0017, status: 'done', durationMs: 2861, log: [{ t: 0, text: '→ list_runs {}' }] };
const resync = async (ctx) => { ctx.panel.onHello([]); await ctx.tick(); await ctx.tick(); ctx.flush(); };

test('ask-panel-render: the activity is collapsed by default; its head is a button whose chevron opens the tool rows and the sub-agents, and the choice survives a repaint', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [...TOOLS, AGENT] }), asstRow('askm_00000002', 2)]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const acts = () => [...ctx.doc.querySelectorAll('.ask-activity')];
  const first = acts()[0];
  const head = first.querySelector('.ask-activity-head');
  const body = first.querySelector('.ask-activity-body');
  assert.equal(head.tagName, 'BUTTON');
  assert.equal(head.type, 'button');
  assert.equal(head.getAttribute('aria-expanded'), 'false', 'collapsed by default');
  const chev = head.querySelector('.ask-activity-chev');
  assert.equal(chev.textContent, '›');
  assert.equal(chev.getAttribute('aria-hidden'), 'true');
  assert.equal(head.textContent, 'Done · 6.4s · 2.0k ctx · $0.14›', 'the inline head, the chevron last');
  assert.equal(body.hidden, true, 'only the head shows');
  assert.equal(body.querySelectorAll('.ask-tool-row').length, 2, 'the body holds the tool rows…');
  assert.ok(body.querySelector('.ask-agents .ask-agent-row'), '…and the sub-agent section');
  head.click();
  assert.equal(head.getAttribute('aria-expanded'), 'true');
  assert.equal(body.hidden, false, 'the click opens it');
  await resync(ctx);                                   // a structural repaint rebuilds every message
  assert.notEqual(acts()[0], first, 'rebuilt');
  assert.equal(acts()[0].querySelector('.ask-activity-head').getAttribute('aria-expanded'), 'true', 'still open after a repaint');
  assert.equal(acts()[0].querySelector('.ask-activity-body').hidden, false);
  assert.equal(acts()[1].querySelector('.ask-activity-head').tagName, 'DIV', 'the plain turn stays a line with no chevron');
  acts()[0].querySelector('.ask-activity-head').click();
  assert.equal(acts()[0].querySelector('.ask-activity-body').hidden, true, 'a second click closes it');
  await resync(ctx);
  assert.equal(acts()[0].querySelector('.ask-activity-head').getAttribute('aria-expanded'), 'false', 'and it stays closed');
  assert.equal(acts()[0].querySelector('.ask-activity-body').hidden, true);
});

test('ask-panel-render: opening an activity body while the transcript is pinned to its end keeps the head where it was (the pin does not follow the click); closing it there re-pins', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [...TOOLS] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const t = ctx.doc.querySelector('.ask-transcript');
  const head = ctx.doc.querySelector('.ask-activity-head');
  const body = ctx.doc.querySelector('.ask-activity-body');
  const jump = ctx.doc.querySelector('.ask-jump');
  // A laid-out column: 1000px in a 200px scrollport, the head 850px down (50px below the top at the end); the open
  // body adds 219px below the head.
  Object.defineProperty(t, 'scrollHeight', { get: () => 1000 + (body.hidden ? 0 : 219), configurable: true });
  Object.defineProperty(t, 'clientHeight', { value: 200, configurable: true });
  head.getBoundingClientRect = () => ({ top: 850 - t.scrollTop, bottom: 868 - t.scrollTop, left: 0, right: 300, width: 300, height: 18 });
  t.scrollTop = 800;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  assert.equal(jump.hidden, true, 'at the end: pinned');
  head.click();
  ctx.flush();                                                  // every frame re-pins a pinned transcript…
  ctx.window.dispatchEvent(new ctx.window.Event('resize'));     // …and so does the column growing (onWinResize)
  assert.equal(body.hidden, false, 'opened');
  assert.equal(t.scrollTop, 800, 'the transcript did not snap to the new end');
  assert.equal(head.getBoundingClientRect().top, 50, 'the head stays under the pointer');
  assert.equal(jump.hidden, false, 'the end is below the fold now: the jump pill offers it');
  head.click();
  ctx.flush();
  assert.equal(body.hidden, true, 'closed');
  assert.equal(jump.hidden, true, 'back at the end: pinned again');
  t.scrollTop = 600;                                            // a turn landing grows the column: the pin follows it
  ctx.flush();
  assert.equal(t.scrollTop, 1000);
  // Scrolled up, a toggle that moves its own control (the browser anchoring on content below it) scrolls it back.
  t.scrollTop = 300;
  t.dispatchEvent(new ctx.window.Event('scroll'));
  head.getBoundingClientRect = () => ({ top: 850 + (body.hidden ? 0 : 30) - t.scrollTop, bottom: 0, left: 0, right: 300, width: 300, height: 18 });
  head.click();
  assert.equal(body.hidden, false);
  assert.equal(head.getBoundingClientRect().top, 550, 'the head is back where it was clicked');
  assert.equal(t.scrollTop, 330);
});

test('ask-panel-render: a tool row is a dot, the tool name, its args (never cut at 60 chars; CSS clamps two lines) and the duration; the full text is its hover', async () => {
  const grep = { pattern: 'export function renderSpendCard|Spend in|Saved|Developer rate|budgetHumanRate', path: '/Users/someone/Develop/worca-cc/ui/public' };
  const preview = `{"file_path":"/Users/someone/.worca-cc/ask/ask_4e9a05/${'a'.repeat(300)}`;
  const blocks = [
    TOOLS[0],
    { kind: 'tool', id: 'toolu_t3', name: 'Grep', input: grep, status: 'done', durationMs: 40 },
    { kind: 'tool', id: 'toolu_t4', name: 'Read', input: { _truncated: true, preview }, status: 'running', durationMs: null },
    { kind: 'tool', id: 'toolu_t5', name: 'mcp__github__create_issue', input: { title: 'Bug' }, status: 'error', durationMs: 10 },
    { kind: 'tool', id: 'toolu_t6', name: 'mcp__worca__test_script', input: { key: 'runTests', code: 'x'.repeat(50) }, script: { key: 'runTests', status: 'blocking', exitCode: 1 }, status: 'done', durationMs: 2000 },
  ];
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  await openThread(ctx);
  const rows = [...ctx.doc.querySelectorAll('.ask-activity-body .ask-tool-row')];
  const cells = rows.map((r) => [r.querySelector('.ask-tool-name').textContent, r.querySelector('.ask-tool-args')?.textContent ?? null, r.querySelector('.ask-tool-note').textContent]);
  assert.deepEqual(cells, [
    ['list_projects', '{}', '0.3s'],                                 // mcp__worca__ stripped
    ['Grep', JSON.stringify(grep), '0.0s'],                          // a built-in as it is, its whole input
    ['Read', preview, '…'],                                          // a clipped input shows its preview
    ['github · create_issue', '{"title":"Bug"}', 'error'],           // a third-party MCP tool: server · tool
    ['test_script', 'runTests → blocking, exit 1', '2.0s'],          // a script tool: the key and outcome, not the program
  ]);
  assert.ok(JSON.stringify(grep).length > 60 && !cells[1][1].endsWith('…'), 'no 60-char cut');
  for (const [i, r] of rows.entries()) {
    assert.equal(r.dataset.minLevel, 'advanced');
    assert.ok(r.querySelector('.ask-tool-dot'), 'each row has its dot');
    assert.equal(r.querySelector('.ask-tool-op'), null, 'no fixed-width op cell');
    assert.equal(r.querySelector('.ask-tool-target').title, `${cells[i][0]} ${cells[i][1]}`, 'the full text on hover');
  }
  assert.ok(rows[2].querySelector('.ask-tool-dot').classList.contains('is-running'));
  assert.ok(rows[3].querySelector('.ask-tool-dot').classList.contains('is-error'));
  assert.ok(rows[3].querySelector('.ask-tool-name').classList.contains('ask-tool-mcp'));
  const css = (await import('node:fs')).readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const target = css.match(/\n\.ask-tool-target\{([^}]*)\}/)[1];
  for (const decl of ['display:-webkit-box', '-webkit-line-clamp:2', '-webkit-box-orient:vertical', 'overflow:hidden', 'white-space:normal', 'overflow-wrap:anywhere']) {
    assert.ok(target.includes(decl), `.ask-tool-target has ${decl}`);
  }
  assert.doesNotMatch(css, /\.ask-tool-op\b|\.ask-activity-spacer\b/, 'the old op cell and the head spacer are gone');
});

test('ask-panel-render: below the level its rows need, the head has no chevron (a Simple user never gets a toggle that opens nothing); a mode change repaints it', async () => {
  const snap = snapBody([asstRow('askm_00000001', 1, { blocks: [...TOOLS] }), asstRow('askm_00000002', 2, { blocks: [AGENT] })]);
  const ctx = makePanel({ fetchHandler: handlerFor(snap) });
  applyLevel('simple', ctx.doc);
  await openThread(ctx);
  const heads = () => [...ctx.doc.querySelectorAll('.ask-activity-head')].map((h) => [h.tagName, !!h.querySelector('.ask-activity-chev')]);
  const bodies = () => [...ctx.doc.querySelectorAll('.ask-activity-body')].map((b) => b.hidden);
  assert.deepEqual(heads(), [['DIV', false], ['DIV', false]], 'Simple: tool rows (Advanced) and sub-agents (Expert) are hidden, so no toggle');
  applyLevel('advanced', ctx.doc);
  assert.deepEqual(heads(), [['BUTTON', true], ['DIV', false]], 'Advanced: the tool rows open; the sub-agents alone still do not');
  applyLevel('expert', ctx.doc);
  assert.deepEqual(heads(), [['BUTTON', true], ['BUTTON', true]]);
  ctx.doc.querySelectorAll('.ask-activity-head')[1].click();
  assert.deepEqual(bodies(), [true, false]);
  applyLevel('advanced', ctx.doc);
  assert.deepEqual(heads(), [['BUTTON', true], ['DIV', false]]);
  assert.deepEqual(bodies(), [true, true], 'an open body whose rows the mode hides closes with its toggle');
  applyLevel('expert', ctx.doc);
  assert.deepEqual(bodies(), [true, false], 'and comes back open');
  const act = ctx.doc.querySelector('.ask-activity');
  ctx.panel.destroy();
  applyLevel('simple', ctx.doc);
  assert.equal(act.querySelector('.ask-activity-head').tagName, 'BUTTON', 'destroy unbinds the mode listener: nothing repaints a dead panel');
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

test('ask-panel-render: a finished answer turns its refs into chips with one POST; code stays code; a run chip follows the run store', async () => {
  const realLoad = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
  const listeners = new Set();
  let live = null;
  const runStore = { get: () => null, byPipeline: (pid) => (pid === '1a2b3c4d' ? live : null), subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const text = 'Merged https://github.com/SinishaDjukic/worca-cc/pull/777 in [the run](#history/worca-cc-ace1a602/1a2b3c4d); `owner/repo#5` stays code.';
  const snap = snapBody([userRow('askm_00000001', 1, 'see owner/repo#6'), asstRow('askm_00000002', 2, { text })]);
  const answers = {
    'gh:SinishaDjukic/worca-cc#777': { ok: true, kind: 'pr', title: 'fix(promo-kit): startApp.stop()', state: 'merged' },
    'run:1a2b3c4d': { ok: true, kind: 'run', id: '1a2b3c4d', runId: null, title: 'Chips plan', status: 'running', home: 'worca-cc-ace1a602' },
  };
  const posts = [];
  const thread = handlerFor(snap);
  const ctx = makePanel({ loadMarkdown: realLoad, deps: { runStore }, fetchHandler: (url, opts) => {
    if (url !== '/api/ask/refs/resolve') return thread(url, opts);
    const refs = JSON.parse(opts.body).refs;
    posts.push(refs);
    return { ok: true, status: 200, json: async () => ({ refs: Object.fromEntries(refs.map((k) => [k, answers[k] || { ok: false }])) }) };
  } });
  await openThread(ctx);
  await ctx.tick();                       // renderer.ensure() resolves: the answers re-render as markdown
  ctx.flush();
  await ctx.tick();                       // the batched POSTs answer
  const answer = ctx.doc.querySelector('.ask-msg-assistant .ask-answer');
  const [pr, run] = answer.querySelectorAll('a.ask-ref-chip');
  assert.deepEqual(posts.map((p) => p.sort()), [['run:1a2b3c4d'], ['gh:SinishaDjukic/worca-cc#777']], 'worca refs and forge refs: one request each');
  assert.equal(pr.getAttribute('href'), 'https://github.com/SinishaDjukic/worca-cc/pull/777');
  assert.deepEqual([...pr.querySelectorAll('.ask-ref-label, .ask-ref-title, .ask-ref-pill')].map((n) => n.textContent),
    ['SinishaDjukic/worca-cc#777', 'fix(promo-kit): startApp.stop()', 'Merged']);
  assert.equal(run.getAttribute('href'), '#history/worca-cc-ace1a602/1a2b3c4d');
  assert.equal(run.querySelector('.ask-ref-pill').textContent, 'Running');
  assert.equal(answer.querySelector('code').textContent, 'owner/repo#5', 'inline code is never a chip');
  assert.equal(ctx.doc.querySelector('.ask-msg-user').querySelectorAll('.ask-ref-chip').length, 0, 'user messages stay plain text');
  live = { source: 'live', runId: 'run-uuid', pipelineId: '1a2b3c4d', status: 'done', title: 'Chips plan', active: [], terminal: true };
  for (const fn of listeners) fn('run-uuid', 'done');
  await ctx.tick();
  assert.equal(answer.querySelector('a.ask-ref-chip-run .ask-ref-pill').textContent, 'Done', 'the run store repaints the pill');
  ctx.flush();
  await ctx.tick();
  assert.equal(posts.length, 2, 'a structural repaint inside the TTL asks nothing again');
  ctx.panel.close();
  live = { ...live, status: 'failed' };
  for (const fn of listeners) fn('run-uuid', 'state');
  await ctx.tick();
  assert.equal(answer.querySelector('a.ask-ref-chip-run .ask-ref-pill').textContent, 'Done', 'a hidden Chat page repaints no chip');
  ctx.panel.open();
  await ctx.tick();
  assert.equal(answer.querySelector('a.ask-ref-chip-run .ask-ref-pill').textContent, 'Failed', 'the next show catches up');
  ctx.panel.destroy();
  assert.equal(listeners.size, 0, 'destroy drops the run store subscription');
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

test('ask-panel-render: a stored files card replays on thread open, inline, and a tile click calls chatDeps.openFiles', async () => {
  registerFilesCard();
  try {
    const item = { attId: 'att_00000001', name: 'home.png', kind: 'image', mime: 'image/png', bytes: 2048 };
    const snap = snapBody([
      userRow('askm_u0000001', 1, 'screenshot it'),
      asstRow('askm_00000001', 2, { text: 'Here it is.\n\nLooks right.', blocks: [{ kind: 'card', id: 'card_00000001', state: 'shown', textAt: 'Here it is.'.length, card: { type: 'files', title: 'home.png', items: [item] } }] }),
    ]);
    const opened = [];
    const ctx = makePanel({ fetchHandler: handlerFor(snap), deps: { chatDeps: { openFiles: (o) => opened.push(o) } } });
    await openThread(ctx);
    const card = ctx.doc.querySelector('.ask-msg-assistant .ask-filescard');
    assert.ok(card, 'the files card replays');
    const msg = ctx.doc.querySelector('.ask-msg-assistant');
    const order = [...msg.children].filter((c) => !c.hidden && (c.classList.contains('ask-answer') || c.classList.contains('ask-filescard')))
      .map((c) => (c.classList.contains('ask-filescard') ? 'card' : c.textContent.trim()));
    assert.deepEqual(order, ['Here it is.', 'card', 'Looks right.'], 'inside the answer where it was shown (textAt)');
    assert.equal(card.querySelectorAll('img').length, 1);
    card.querySelector('.ask-filescard-thumb').click();
    assert.equal(opened.length, 1);
    assert.equal(opened[0].threadId, TID);
    assert.equal(opened[0].index, 0);
  } finally {
    _resetChatExtensions();
    _resetFileRenderers();
  }
});
