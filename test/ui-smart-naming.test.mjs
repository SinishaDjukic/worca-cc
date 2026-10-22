// test/ui-smart-naming.test.mjs — Smart run naming on the New run form (flag smartRunNaming): flag off is inert;
// flag on: suggested / loading / edited / failed states, the type select, the Start markers, the manual trigger, prefill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { applyFlags } from '../ui/public/flags.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }];
const TASK = 'Login redirects back to /login after SSO on Safari';
const SUGGESTION = { source: 'model', title: 'Fix Safari SSO redirect loop', type: 'fix', slug: 'safari-sso-redirect-loop', branch: 'fix/safari-sso-redirect-loop',
  reason: 'the task reports broken behaviour', types: ['feat', 'fix'], pattern: '{type}/{slug}' };
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));

async function boot({ suggest = () => SUGGESTION, config = { trigger: 'debounce', pattern: '{type}/{slug}' }, on = true } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#new' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const runBodies = []; const calls = []; const held = { release: null };
  const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
  window.fetch = (url, opts = {}) => {
    const u = String(url); calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/naming/config')) return json(config);
    if (u.includes('/api/naming/suggest')) {
      const r = suggest(JSON.parse(opts.body));
      if (r && typeof r.then === 'function') return r.then((x) => ({ ok: true, status: 200, json: async () => x }));
      return json(r);
    }
    if (u.includes('/api/projects')) return json({ projects: PROJECTS });
    if (u.includes('/api/workspaces')) return json({ workspaces: [] });
    if (u.includes('/api/branches')) return json({ branches: ['main'], current: 'main', runs: [] });
    if (u.endsWith('/api/run') && opts.method === 'POST') { runBodies.push(JSON.parse(opts.body)); return json({ runId: 'r-1' }); }
    if (u.includes('/api/schedules')) return json({ schedules: [], tickets: [], counts: { scheduled: 0, missed: 0, recurring: 0, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 } });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.__np?.offSmartNaming?.();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(60);
  const doc = window.document;
  const projects = doc.getElementById('projectSelect');
  projects.value = '/a/svc-iam';
  projects.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick(60);
  if (on) applyFlags({ smartRunNaming: true }, doc);
  return { window, doc, runBodies, calls, held, naming: () => calls.filter((c) => c.url.includes('/api/naming/suggest')) };
}
const type = (ctx, el, v) => { el.value = v; el.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };
const $ = (ctx, id) => ctx.doc.getElementById(id);
const chips = (ctx) => ctx.doc.querySelectorAll('.sn-chip').length;
// The debounce is armed only once /api/naming/config resolves, so on a busy runner the call can go out after 1150ms:
// wait for it (and a tick for its answer) instead of trusting the fixed delay. `suggests: false` for the no-call cases.
async function typeTask(ctx, { suggests = true } = {}) {
  const before = ctx.naming().length;
  type(ctx, $(ctx, 'prompt'), TASK);
  await tick(1150);
  if (!suggests) return;
  for (const end = Date.now() + 5000; ctx.naming().length === before; await tick(10)) {
    if (Date.now() > end) throw new Error('no naming call within 6s of typing the task');
  }
  await tick(20);
}

test('flag off: typing a task never calls the model and shows no chip', async () => {
  const ctx = await boot({ on: false });
  type(ctx, $(ctx, 'prompt'), TASK);
  await tick(1200);
  assert.equal(ctx.calls.filter((c) => c.url.includes('/api/naming')).length, 0);
  assert.equal(chips(ctx), 0);
  assert.match($(ctx, 'titleHint').textContent, /Leave empty and Worca will propose one/);
});

test('flag off: the shell hides every naming control', () => {
  const html = renderIndexHtml(readFileSync(htmlPath, 'utf8'), 'system', 'simple', { smartRunNaming: false });
  assert.match(html, /<style id="flag-gates">[^<]*\[data-flag~="smartRunNaming"\]\{display:none/);
});

test('suggested: after the debounce both fields fill, chips and the reason show, Start is enabled', async () => {
  const ctx = await boot();
  await typeTask(ctx);
  assert.equal($(ctx, 'title').value, 'Fix Safari SSO redirect loop');
  assert.equal($(ctx, 'featureBranch').value, 'fix/safari-sso-redirect-loop');
  assert.equal(chips(ctx), 2);
  assert.match($(ctx, 'featureBranchHint').textContent, /fix because the task reports broken behaviour/);
  assert.equal($(ctx, 'branchTypeWrap').hidden, false);
  assert.equal($(ctx, 'start-btn').disabled, false);
  assert.equal(ctx.naming().length, 1);
});

test('type change renames the branch locally and keeps the chip', async () => {
  const ctx = await boot();
  await typeTask(ctx);
  const sel = $(ctx, 'branchType');
  assert.deepEqual([...sel.options].map((o) => o.value), ['feat', 'fix']);
  sel.value = 'feat';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal($(ctx, 'featureBranch').value, 'feat/safari-sso-redirect-loop');
  assert.equal(chips(ctx), 2);
  assert.equal(ctx.naming().length, 1, 'no second model call');
});

test('loading: shimmer shows, Start stays enabled', async () => {
  let release;
  const ctx = await boot({ suggest: () => new Promise((r) => { release = () => r(SUGGESTION); }) });
  await typeTask(ctx);
  assert.ok(ctx.doc.querySelector('.sn-adorn.sn-loading'));
  assert.equal($(ctx, 'start-btn').disabled, false);
  assert.match($(ctx, 'titleHint').textContent, /Start is never blocked/);
  release();
  await tick(20);
  assert.equal(ctx.doc.querySelector('.sn-adorn.sn-loading'), null);
  assert.equal($(ctx, 'title').value, 'Fix Safari SSO redirect loop');
});

test('edited: a typed branch is kept, no chip, a later suggestion does not overwrite it, retry replaces it', async () => {
  const ctx = await boot();
  type(ctx, $(ctx, 'featureBranch'), 'hotfix/sso-cookie');
  await typeTask(ctx);
  assert.equal($(ctx, 'featureBranch').value, 'hotfix/sso-cookie');
  assert.equal($(ctx, 'title').value, 'Fix Safari SSO redirect loop', 'the title was free, so it filled');
  assert.equal(ctx.doc.querySelectorAll('.sn-chip').length, 1, 'only the title chip');
  assert.match($(ctx, 'featureBranchHint').textContent, /Your name is kept/);
  $(ctx, 'branchSnRetry').click();
  await tick(20);
  assert.equal($(ctx, 'featureBranch').value, 'fix/safari-sso-redirect-loop');
});

test('failed: title stays empty, the branch shows today\'s name without a chip, Start sends featureBranchFallback until edited', async () => {
  const ctx = await boot({ suggest: () => ({ source: 'fallback', error: 'down', branchHint: 'worca-cc/safari-sso' }) });
  await typeTask(ctx);
  assert.equal($(ctx, 'title').value, '');
  assert.equal($(ctx, 'featureBranch').value, 'worca-cc/safari-sso');
  assert.equal(chips(ctx), 0);
  assert.ok($(ctx, 'featureBranchHint').classList.contains('warn'));
  assert.match($(ctx, 'featureBranchHint').textContent, /Could not suggest/);
  const projects = $(ctx, 'projectSelect');
  assert.ok(projects.value);
  $(ctx, 'start-btn').click();
  await tick(20);
  assert.equal(ctx.runBodies[0].featureBranchFallback, true);
  assert.equal('featureBranchSuggested' in ctx.runBodies[0], false);
  type(ctx, $(ctx, 'featureBranch'), 'worca-cc/safari-sso-mine');
  $(ctx, 'start-btn').click();
  await tick(20);
  assert.equal('featureBranchFallback' in (ctx.runBodies[1] || {}), false);
});

test('a still-suggested branch is marked on Start; a typed one is not', async () => {
  const ctx = await boot();
  await typeTask(ctx);
  $(ctx, 'start-btn').click();
  await tick(20);
  assert.equal(ctx.runBodies[0].featureBranch, 'fix/safari-sso-redirect-loop');
  assert.equal(ctx.runBodies[0].featureBranchSuggested, true);
  assert.equal(ctx.runBodies[0].title, 'Fix Safari SSO redirect loop');
});

test('manual trigger: no call until the retry button is pressed', async () => {
  const ctx = await boot({ config: { trigger: 'manual', pattern: '{type}/{slug}' } });
  await typeTask(ctx, { suggests: false });
  assert.equal(ctx.naming().length, 0);
  $(ctx, 'titleSnRetry').click();
  await tick(20);
  assert.equal(ctx.naming().length, 1);
  assert.equal($(ctx, 'title').value, 'Fix Safari SSO redirect loop');
});

test('a short task or "run on the source branch" asks nothing', async () => {
  const ctx = await boot();
  type(ctx, $(ctx, 'prompt'), 'Do it');
  await tick(1150);
  assert.equal(ctx.naming().length, 0);
  $(ctx, 'sameAsSource').checked = true;
  await typeTask(ctx, { suggests: false });
  assert.equal(ctx.naming().length, 0);
});

test('the clear button empties a suggestion and keeps it from coming back', async () => {
  const ctx = await boot();
  await typeTask(ctx);
  $(ctx, 'titleSnClear').click();
  assert.equal($(ctx, 'title').value, '');
  type(ctx, $(ctx, 'prompt'), `${TASK} again`);
  await tick(1150);
  assert.equal($(ctx, 'title').value, '', 'an emptied title is the person\'s choice');
});
