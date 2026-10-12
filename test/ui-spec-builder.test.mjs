// test/ui-spec-builder.test.mjs — the Spec Builder task source in the real shell (docs/spec-builder.md): with the
// flag off the source switch and a Markdown submit are byte-identical to today; with it on, the Beta button,
// the level gate, the one-page pane (idea, suggested roles, Draft spec = a pinned thread driven by frames) and
// "Use as task" (an ordinary Markdown run under Auto, a saved workflow left alone).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';
import { mockSpecMarkdown, MOCK_SPEC_QUESTIONS } from '../src/core/spec-builder/mock-spec.mjs';
import { SUGGEST_DEBOUNCE_MS } from '../ui/public/spec-builder.mjs';

const trackDom = useDomRelease(afterEach);
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const LEVEL_GATES = [...css.matchAll(/:root\[data-level="\w+"\] \[data-min-level="\w+"\]:not\(\[data-level-keep\]\)/g)].map((m) => m[0]);

/** Hidden by a flag gate (#flag-gates) or a level gate, on the element or an ancestor (as test/ui-flags.test.mjs). */
function gated(el) {
  const doc = el.ownerDocument;
  const flagSel = [...doc.getElementById('flag-gates').sheet.cssRules].map((r) => r.selectorText);
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (flagSel.some((s) => n.matches(s))) return true;
    if (LEVEL_GATES.some((s) => n.matches(s.replace(/^:root(\[[^\]]+\]) /, '')) && doc.documentElement.matches(`:root${s.match(/^:root(\[[^\]]+\])/)[1]}`))) return true;
  }
  return false;
}

const PROJECT = { key: 'app-0000abcd', name: 'app', path: '/repos/app', exists: true };
const THREAD = { id: 'ask_00000009', title: 'New', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };
const SPEC = mockSpecMarkdown();
const GROUND = [
  { path: 'src/app.mjs', found: true, isNew: false }, { path: 'src/store.mjs', found: true, isNew: false }, { path: 'test/app.test.mjs', found: true, isNew: false },
  { path: 'src/charts.mjs', found: false, isNew: true }, { path: 'test/charts.test.mjs', found: false, isNew: true },
];
const IDEA = 'Let people pin a chart from a question';
const MSG_ID = 'askm_00000001';
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

async function boot({ flag = false, level = 'advanced', workflow = 'wf_default' } = {}) {
  const shell = renderIndexHtml(html, 'system', level, { specBuilder: flag });
  const { window } = trackDom(new JSDOM(shell, { url: 'http://localhost:4317/#new' }));
  window.Element.prototype.scrollIntoView = function () {};
  let ws = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; ws = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  const posts = [];
  const log = [];
  window.fetch = (u, opts = {}) => {
    const url = String(u);
    const path = url.split('?')[0];
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    log.push(`${method} ${path}`);
    if (method === 'POST' || method === 'PATCH') posts.push({ path, body });
    if (path.endsWith('/api/run') && method === 'POST') return json({ runId: 'run-1' });
    if (path.endsWith('/api/spec-builder/suggest')) return json({ roles: ['product', 'architect', 'qa', 'ux'], kind: 'feature', size: 'medium', reasons: {}, source: 'ai' });
    if (path.endsWith('/api/spec-builder/prompt')) return json({ text: '[worca spec-builder] Write a spec', title: 'Spec: Charts from a question', projectKey: 'app-0000abcd', projectName: 'app' });
    if (path.endsWith('/api/ask/models')) return json({ default: { model: 'm', effort: 'low' } });
    if (path === '/api/ask/threads' && method === 'POST') return json({ thread: THREAD }, 201);
    if (path.endsWith('/messages') && method === 'POST') return json({ userMessageId: 'askm_u0000001', assistantMessageId: MSG_ID }, 202);
    if (path === `/api/ask/threads/${THREAD.id}` && method === 'GET') return json({ thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null });
    if (path.endsWith('/api/flags')) return json({ flags: [{ key: 'specBuilder', title: 'Spec Builder', description: 'D', stage: 'beta', on: flag, source: 'default', locked: false, docs: null, docsUrl: null, requires: [] }] });
    if (path.endsWith('/api/sources')) return json({ sources: [] });
    if (path.endsWith('/api/config')) return json({ config: { steps: {}, customModels: [], activeWorkflowId: workflow }, models: [], efforts: [] });
    if (path.endsWith('/api/workflows')) return json({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_a', name: 'A', version: 2 }] });
    if (path.endsWith('/api/branches')) return json({ branches: ['main'], current: 'main' });
    if (url.includes('/api/projects')) return json({ projects: [PROJECT] });
    return json({ pipelines: 0, projects: 0, workspaces: 0, threads: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.lastProject', 'app');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await settle(1);
  ws._l.open?.forEach((fn) => fn());
  await settle();
  const doc = window.document;
  const frame = (msg) => (ws._l.message || []).forEach((fn) => fn({ data: JSON.stringify(msg) }));
  const submit = async () => { doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { cancelable: true })); await settle(); };
  const lastRun = () => posts.filter((p) => p.path.endsWith('/api/run')).at(-1)?.body;
  return { window, doc, posts, log, frame, submit, lastRun, q: (s) => doc.querySelector(s) };
}

async function markdownRun(ctx, md) {
  ctx.q('#source-seg button[data-src="markdown"]').click();
  ctx.q('#promptMarkdown').value = md;
  await ctx.submit();
  return ctx.lastRun();
}

/** Type the idea, then fire the debounced suggestion by hand: only the pane's own timer is captured. */
async function typeIdea(ctx, text = IDEA) {
  ctx.q('#source-seg button[data-spec-builder]').click();
  await settle();
  const real = globalThis.setTimeout;
  const fired = [];
  globalThis.setTimeout = (cb, ms, ...a) => (ms === SUGGEST_DEBOUNCE_MS ? (fired.push(cb), 0) : real(cb, ms, ...a));
  try {
    const idea = ctx.q('[data-sb-idea]');
    idea.value = text;
    idea.dispatchEvent(new ctx.window.Event('input'));
  } finally { globalThis.setTimeout = real; }
  for (const cb of fired) await cb();
  await settle();
}

const frames = (ctx, bare) => { for (const f of stampFrames(bare, { threadId: THREAD.id, messageId: MSG_ID })) ctx.frame(f); };
const cardBlock = (id, card) => ({ kind: 'card', id, state: 'proposed', card });
const specCard = { type: 'spec', markdown: SPEC, path: 'plans/charts-design.md', grounding: GROUND, projectKey: 'app-0000abcd', projectName: 'app', projectDir: '/repos/app' };
const questionsCard = { type: 'spec-questions', questions: MOCK_SPEC_QUESTIONS, projectKey: 'app-0000abcd', projectName: 'app', projectDir: '/repos/app' };
const START = { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'low', startedAt: 't' };

/** The turn ends with `card`: ask-start, the card frame, then an ask-done carrying the turn's blocks (as the server does). */
async function finishTurn(ctx, id, card) {
  const block = cardBlock(id, card);
  frames(ctx, [START, { type: 'ask-card', block }, { type: 'ask-done', text: '', status: 'done', blocks: [block] }]);
  await settle(10);
}

test('flag off: no button, a byte-identical source switch and the same Markdown submit body', async () => {
  const off = await boot({ flag: false });
  const raw = new JSDOM(html).window.document.querySelector('#source-seg').outerHTML;
  await checkRows([
    { name: 'no Spec Builder button; #source-seg is the raw shell\'s', run: () => {
      assert.equal(off.q('#source-seg [data-spec-builder]'), null);
      assert.equal(off.q('#source-seg').outerHTML, raw);
    } },
  ]);
  const bodyOff = await markdownRun(off, SPEC);
  const on = await boot({ flag: true });
  const bodyOn = await markdownRun(on, SPEC);
  assert.ok(bodyOff, JSON.stringify(off.posts.map((p) => p.path)));
  assert.equal(bodyOff.promptMarkdown, SPEC.trim());
  assert.deepEqual(bodyOn, bodyOff);
});

test('flag on: the button after Markdown carries a Beta tag inside it, level-gated at Simple', async () => {
  const adv = await boot({ flag: true, level: 'advanced' });
  const b = adv.q('#source-seg button[data-spec-builder]');
  assert.equal(b.previousElementSibling.dataset.src, 'markdown');
  assert.equal(b.querySelector('span.flag-chip.flag-chip-beta')?.textContent, 'Beta');
  assert.equal(adv.q('#source-seg a.flag-chip'), null);
  assert.ok(!gated(b));
  const simple = await boot({ flag: true, level: 'simple' });
  const sb = simple.q('#source-seg button[data-spec-builder]');
  assert.ok(sb.closest('#source-field[data-min-level="advanced"]'));
  assert.ok(gated(sb));
});

test('the pane through the shell: idea, suggested roles, Draft spec, live activity, the questions card', async () => {
  const ctx = await boot({ flag: true });
  await typeIdea(ctx);
  await checkRows([
    { name: 'the suggestion shows its chips', run: () => {
      assert.ok(ctx.q('[data-sb-suggested]'));
      assert.ok(ctx.q('[data-sb-role="ux"]'));
    } },
    { name: 'Draft spec: the prompt, the thread, then a pinned message for the project', run: async () => {
      ctx.q('[data-sb-draft]').click(); await settle(10);
      const i = ctx.log.indexOf('POST /api/spec-builder/prompt');
      const j = ctx.log.indexOf('POST /api/ask/threads');
      const k = ctx.log.indexOf(`POST /api/ask/threads/${THREAD.id}/messages`);
      assert.ok(i >= 0 && j > i && k > j, ctx.log.join('\n'));
      const prompt = ctx.posts.find((p) => p.path.endsWith('/api/spec-builder/prompt'));
      assert.equal(prompt.body.projectDir, '/repos/app');
      assert.equal(prompt.body.idea, IDEA);
      assert.match(ctx.posts.find((p) => p.path === '/api/ask/threads').body.title, /^Spec: /);
      const msg = ctx.posts.find((p) => p.path.endsWith('/messages'));
      assert.equal(msg.body.text, '[worca spec-builder] Write a spec');
      assert.equal(msg.body.context.pinned, true);
      assert.equal(msg.body.context.projectKey, 'app-0000abcd');
      assert.ok(ctx.q('[data-sb-progress]'));
    } },
    { name: 'a Read tool frame becomes the activity line', run: async () => {
      frames(ctx, [START, { type: 'ask-block', block: { kind: 'tool', id: 't1', name: 'Read', input: { file_path: '/repos/app/src/store.mjs' }, status: 'running' } }]);
      await settle();
      assert.equal(ctx.q('[data-sb-activity]').textContent, 'Reading src/store.mjs…');
    } },
    { name: 'a questions card ends the turn: the question renders', run: async () => {
      const block = cardBlock('card_00000002', questionsCard);
      for (const f of stampFrames([{ type: 'ask-card', block }, { type: 'ask-done', text: '', status: 'done', blocks: [block] }], { threadId: THREAD.id, messageId: MSG_ID, seqStart: 3 })) ctx.frame(f);
      await settle(10);
      assert.ok(ctx.q('[data-sb-question="chart-storage"]'));
    } },
    { name: 'the same project again keeps the live thread: no re-fetch, the question stays', run: async () => {
      const gets = () => ctx.log.filter((l) => l === `GET /api/ask/threads/${THREAD.id}`).length;
      const before = gets();
      const sel = ctx.q('#projectSelect');
      sel.dispatchEvent(new ctx.window.Event('change'));
      await settle(10);
      assert.equal(gets(), before);
      assert.ok(ctx.q('[data-sb-question="chart-storage"]'));
    } },
  ]);
});

test('Use as task: a passing spec card becomes an ordinary Markdown run under Auto, focused on Start', async () => {
  const ctx = await boot({ flag: true });
  assert.equal(ctx.q('#workflowSelect').value, 'wf_default');
  await typeIdea(ctx);
  ctx.q('[data-sb-draft]').click(); await settle(10);
  await finishTurn(ctx, 'card_00000002', specCard);
  assert.equal(ctx.q('[data-sb-shape]').getAttribute('data-sb-shape'), 'ok');
  ctx.q('[data-sb-use]').click();
  await settle(12);
  assert.equal(ctx.q('#promptMarkdown').value, SPEC);
  assert.ok(ctx.q('#source-seg button[data-src="markdown"]').classList.contains('on'));
  assert.ok(!ctx.q('#source-seg button[data-spec-builder]').classList.contains('on'));
  assert.equal(ctx.q('#workflowSelect').value, 'wf_auto');
  assert.equal(ctx.doc.activeElement, ctx.q('#start-btn'));
  await ctx.submit();
  const fromSpec = ctx.lastRun();
  const byHand = await boot({ flag: true, workflow: 'wf_auto' });
  assert.deepEqual(await markdownRun(byHand, SPEC), fromSpec);
});

test('Use as task leaves a saved workflow alone', async () => {
  const ctx = await boot({ flag: true, workflow: 'wf_a' });
  assert.equal(ctx.q('#workflowSelect').value, 'wf_a');
  await typeIdea(ctx);
  ctx.q('[data-sb-draft]').click(); await settle(10);
  await finishTurn(ctx, 'card_00000002', specCard);
  ctx.q('[data-sb-use]').click();
  await settle(12);
  assert.equal(ctx.q('#promptMarkdown').value, SPEC);
  assert.equal(ctx.q('#workflowSelect').value, 'wf_a');
});

test('a Start while the Spec Builder is the source runs nothing and says what to do', async () => {
  const ctx = await boot({ flag: true });
  ctx.q('#source-seg button[data-spec-builder]').click(); await settle();
  await ctx.submit();
  assert.equal(ctx.posts.filter((p) => p.path.endsWith('/api/run')).length, 0);
  assert.match(ctx.q('#plugin-source-pane').parentElement.textContent, /Draft the spec, then press "Use as task"\./);
});
