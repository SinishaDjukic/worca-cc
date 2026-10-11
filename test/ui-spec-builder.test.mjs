// test/ui-spec-builder.test.mjs — the Spec Builder task source in the real shell (docs/spec-builder.md): with the
// flag off the source switch and a Markdown submit are byte-identical to today; with it on, the Beta button,
// the level gate, the wizard (goal, roles, estimate), Generate (a pinned Ask thread) and "Use this spec"
// (an ordinary Markdown run under Auto, a saved workflow left alone).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';
import { estimateSpec } from '../src/core/spec-builder/estimate.mjs';

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

const PROJECT = { name: 'app', path: '/repos/app', exists: true };
const THREAD = { id: 'ask_00000009', title: 'New', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };
const SPEC = '---\nworca:\n  kind: feature\n  size: medium\n  roles: [product]\n  generatedBy: spec-builder@1\n---\n# Dark mode\n\n## 1. Problem and goal\n\nx\n';
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
  window.fetch = (u, opts = {}) => {
    const url = String(u);
    const path = url.split('?')[0];
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === 'POST' || method === 'PATCH') posts.push({ path, body });
    if (path.endsWith('/api/run') && method === 'POST') return json({ runId: 'run-1' });
    if (path.endsWith('/api/spec-builder/estimate')) return json({ estimate: estimateSpec(body.frontMatter) });
    if (path.endsWith('/api/spec-builder/areas')) return json({ areas: ['src/a.js'] });
    if (path.endsWith('/api/spec-builder/prompt')) return json({ text: '[worca spec-builder] Write a spec', projectKey: 'app-0000abcd', projectName: 'app' });
    if (path === '/api/ask/threads' && method === 'POST') return json({ thread: THREAD }, 201);
    if (path.endsWith('/messages') && method === 'POST') return json({ ok: true }, 202);
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
  return { window, doc, posts, frame, submit, lastRun, q: (s) => doc.querySelector(s) };
}

async function markdownRun(ctx, md) {
  ctx.q('#source-seg button[data-src="markdown"]').click();
  ctx.q('#promptMarkdown').value = md;
  await ctx.submit();
  return ctx.lastRun();
}

async function openWizard(ctx, goal = 'Add dark mode') {
  ctx.q('#source-seg button[data-spec-builder]').click();
  await settle();
  const g = ctx.q('[data-sb-goal]');
  g.value = goal;
  g.dispatchEvent(new ctx.window.Event('input'));
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

test('flag on: the Beta button after Markdown, never gated at Advanced, level-gated at Simple', async () => {
  const adv = await boot({ flag: true, level: 'advanced' });
  const b = adv.q('#source-seg button[data-spec-builder]');
  assert.equal(b.previousElementSibling.dataset.src, 'markdown');
  const chip = b.nextElementSibling;
  assert.ok(chip.matches('a.flag-chip.flag-chip-beta'));
  assert.equal(chip.textContent, 'Beta');
  assert.ok(!gated(b));
  const simple = await boot({ flag: true, level: 'simple' });
  const sb = simple.q('#source-seg button[data-spec-builder]');
  assert.ok(sb.closest('#source-field[data-min-level="advanced"]'));
  assert.ok(gated(sb));
});

test('the wizard: empty goal, roles, the estimate, Generate', async () => {
  const ctx = await boot({ flag: true });
  ctx.q('#source-seg button[data-spec-builder]').click();
  await settle();
  await checkRows([
    { name: 'an empty goal stays on step 1 with the inline error', run: async () => {
      ctx.q('[data-sb-next]').click();
      await settle();
      assert.equal(ctx.q('[data-sb-error]').textContent, 'Describe the goal in one line.');
      assert.ok(ctx.q('[data-sb-goal]'), 'still on What');
    } },
    { name: 'Product is locked on; QA toggles', run: async () => {
      const g = ctx.q('[data-sb-goal]');
      g.value = 'Add dark mode'; g.dispatchEvent(new ctx.window.Event('input'));
      ctx.q('[data-sb-next]').click(); await settle();
      const product = ctx.q('[data-sb-role="product"]');
      assert.ok(product.disabled);
      assert.equal(product.getAttribute('aria-pressed'), 'true');
      ctx.q('[data-sb-role="qa"]').click();
      assert.equal(ctx.q('[data-sb-role="qa"]').getAttribute('aria-pressed'), 'true');
      ctx.q('[data-sb-role="qa"]').click();
      assert.equal(ctx.q('[data-sb-role="qa"]').getAttribute('aria-pressed'), 'false');
    } },
    { name: 'UX adds the web stages to the estimate', run: async () => {
      ctx.q('[data-sb-role="ux"]').click();
      ctx.q('[data-sb-next]').click(); await settle();
      ctx.q('[data-sb-next]').click(); await settle();
      const phases = [...ctx.doc.querySelectorAll('[data-sb-stage]')].map((e) => e.dataset.sbStage);
      assert.ok(phases.includes('manualTestsChecklist') && phases.includes('manualWebUiTesting'), phases.join());
    } },
    { name: 'Security adds Refine, and the posted front-matter carries risky', run: async () => {
      ctx.q('.sb-nav .btn-ghost').click(); await settle();        // Back to Scope
      ctx.q('.sb-nav .btn-ghost').click(); await settle();        // Back to Roles
      ctx.q('[data-sb-role="ux"]').click();
      ctx.q('[data-sb-role="security"]').click();
      ctx.q('[data-sb-next]').click(); await settle();
      ctx.q('[data-sb-next]').click(); await settle();
      assert.ok(ctx.q('[data-sb-stage="refiner"]'));
      const est = ctx.posts.filter((p) => p.path.endsWith('/api/spec-builder/estimate')).at(-1);
      assert.deepEqual(est.body.frontMatter.signals, ['risky']);
    } },
    { name: 'Generate: the prompt for the project, then a pinned Ask thread; the pane says drafting', run: async () => {
      ctx.q('[data-sb-generate]').click(); await settle(10);
      const prompt = ctx.posts.find((p) => p.path.endsWith('/api/spec-builder/prompt'));
      assert.equal(prompt.body.projectDir, '/repos/app');
      const i = ctx.posts.findIndex((p) => p.path === '/api/ask/threads');
      assert.ok(i > ctx.posts.indexOf(prompt));
      const msg = ctx.posts.find((p) => p.path === `/api/ask/threads/${THREAD.id}/messages`);
      assert.equal(msg.body.text, '[worca spec-builder] Write a spec');
      assert.equal(msg.body.context.pinned, true);
      assert.equal(msg.body.context.projectKey, 'app-0000abcd');
      assert.match(ctx.q('#plugin-source-pane').textContent, /Drafting in Ask Worca/);
    } },
    { name: 'a Start while the wizard is the source runs nothing', run: async () => {
      ctx.q('#source-seg button[data-spec-builder]').click(); await settle();
      const before = ctx.posts.filter((p) => p.path.endsWith('/api/run')).length;
      await ctx.submit();
      assert.equal(ctx.posts.filter((p) => p.path.endsWith('/api/run')).length, before);
    } },
  ]);
});

/** Generate, then the spec card arrives on the thread and its "Use this spec" is clicked. */
async function useSpec(ctx) {
  await openWizard(ctx);
  for (let i = 0; i < 3; i++) { ctx.q('[data-sb-next]').click(); await settle(); }
  ctx.q('[data-sb-generate]').click(); await settle(10);
  const card = { type: 'spec', title: 'Dark mode', summary: 'Spec: Dark mode', markdown: SPEC, path: null, frontMatter: {}, estimate: null,
    projectKey: 'app-0000abcd', projectName: 'app', projectDir: '/repos/app' };
  for (const f of stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block: { kind: 'card', id: 'card_00000002', state: 'proposed', card } },
  ], { threadId: THREAD.id, messageId: 'askm_00000001' })) ctx.frame(f);
  await settle(10);
  const use = await waitFor(() => ctx.q('[data-ask-spec-use]'), 'the spec card');
  use.click();
  await settle(12);
}
async function waitFor(fn, what) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > 3000) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('Use this spec: an ordinary Markdown run under Auto, focused on Start', async () => {
  const ctx = await boot({ flag: true });
  assert.equal(ctx.q('#workflowSelect').value, 'wf_default');
  await useSpec(ctx);
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

test('Use this spec leaves a saved workflow alone', async () => {
  const ctx = await boot({ flag: true, workflow: 'wf_a' });
  assert.equal(ctx.q('#workflowSelect').value, 'wf_a');
  await useSpec(ctx);
  assert.equal(ctx.q('#promptMarkdown').value, SPEC);
  assert.equal(ctx.q('#workflowSelect').value, 'wf_a');
});
