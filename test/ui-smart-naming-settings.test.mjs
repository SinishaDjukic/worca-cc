// test/ui-smart-naming-settings.test.mjs — Settings › Runs › Smart run naming (Labs): the card sits after Away mode, the master
// switch is the flag, the pattern preview is live, Save and Use defaults post to /api/settings, a server error shows on the
// card, the last type cannot be switched off, the rows are muted while the flag is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { applyFlags } from '../ui/public/flags.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));
const STORED = { suggestTitle: true, suggestBranch: true, pattern: '{type}/{slug}', types: ['feat', 'fix', 'chore', 'docs', 'refactor', 'test'], trigger: 'debounce', addRunId: false };
const MODELS = [{ id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: ['low', 'high'], engine: 'claude' }];

async function boot({ postStatus = 200, postBody = null } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#settings' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const posts = []; const flagCalls = [];
  const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
  window.fetch = (url, opts = {}) => {
    const u = String(url); const method = opts.method || 'GET';
    if (u.endsWith('/api/settings') && method === 'POST') {
      posts.push(JSON.parse(opts.body));
      return postStatus === 200 ? json(postBody || { smartNaming: STORED }) : json({ error: 'pattern must contain {slug}', field: 'smartNaming' }, postStatus);
    }
    if (u.endsWith('/api/settings')) return json({ root: '/r', default: '/r', smartNaming: STORED, flags: {} });
    if (u.includes('/api/flags')) { flagCalls.push([method, opts.body ? JSON.parse(opts.body) : null]); return json({ flags: [{ key: 'smartRunNaming', on: false, locked: false }] }); }
    if (u.includes('/api/naming/config')) return json({ ...STORED, picked: { model: 'claude-haiku-5-5', effort: 'low', source: 'auto' }, estimatedUsd: 0.00005 });
    if (u.includes('/api/config')) return json({ config: { steps: {}, customModels: [] }, models: MODELS, efforts: [] });
    if (u.includes('/api/projects')) return json({ projects: [] });
    if (u.includes('/api/workspaces')) return json({ workspaces: [] });
    if (u.includes('/api/schedules')) return json({ schedules: [], tickets: [], counts: { scheduled: 0, missed: 0, recurring: 0, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 } });
    return json({});
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.__np?.offSmartNamingSwitch?.();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(120);
  return { window, doc: window.document, posts, flagCalls };
}
const $ = (ctx, id) => ctx.doc.getElementById(id);
const input = (ctx, el, v) => { el.value = v; el.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };

test('the card follows Away mode and shows the stored values', async () => {
  const ctx = await boot();
  const card = $(ctx, 'smart-naming-settings-card');
  assert.equal($(ctx, 'night-settings-card').nextElementSibling, card);
  assert.equal($(ctx, 'smartNamingPattern').value, '{type}/{slug}');
  assert.equal($(ctx, 'smartNamingTitle').checked, true);
  assert.equal($(ctx, 'smartNamingRunId').checked, false);
  assert.equal($(ctx, 'smartNamingTrigger').value, 'debounce');
  assert.deepEqual([...ctx.doc.querySelectorAll('#smartNamingTypes [aria-pressed="true"]')].map((b) => b.textContent), STORED.types);
});

test('the Model row has no picker: it links to Models › Helper jobs (Expert only) and names the resolved model and cost', async () => {
  const ctx = await boot();
  assert.equal($(ctx, 'smartNamingModel'), null, 'the model is a helper job now');
  const link = ctx.doc.querySelector('#smartNamingModelRow a[href="#models"]');
  assert.equal(link.textContent, 'Models › Helper jobs › Run naming');
  assert.ok(link.closest('#smartNamingModelRow [data-min-level="expert"]'), 'the Engines card is Expert-only, so is the link');
  assert.equal($(ctx, 'smartNamingCost').textContent, 'Shown in Statistics as Naming, never billed to the run.');
  applyFlags({ smartRunNaming: true }, ctx.doc);
  await tick(40);
  assert.match($(ctx, 'smartNamingCost').textContent, /^claude-haiku-5-5 \(cheapest ready\)\. About 300 tokens in, 30 out: ≈ \$0\.00005 per suggestion\. /);
  applyFlags({ smartRunNaming: false }, ctx.doc);
});

test('the rows are muted while the flag is off and live when it is on', async () => {
  const ctx = await boot();
  assert.equal($(ctx, 'smartNamingPatternRow').getAttribute('aria-disabled'), 'true');
  applyFlags({ smartRunNaming: true }, ctx.doc);
  assert.equal($(ctx, 'smartNamingPatternRow').getAttribute('aria-disabled'), 'false');
  assert.equal($(ctx, 'smartNamingMasterRow').hasAttribute('aria-disabled'), false);
});

test('the master switch is bound to the flag', async () => {
  const ctx = await boot();
  await tick(20);
  $(ctx, 'smartNamingSwitch').click();
  await tick(20);
  assert.ok(ctx.flagCalls.some(([m, b]) => m === 'PATCH' && b && b.smartRunNaming === true));
});

test('the live preview uses the pattern; an unusable pattern says why', async () => {
  const ctx = await boot();
  input(ctx, $(ctx, 'smartNamingPattern'), '{type}/{ticket}-{slug}');
  assert.equal($(ctx, 'smartNamingPreview').textContent, 'Preview: fix/proj-123-safari-sso-redirect-loop');
  input(ctx, $(ctx, 'smartNamingPattern'), '{type}/x');
  assert.match($(ctx, 'smartNamingPreview').textContent, /Not usable: pattern must contain \{slug\}/);
});

test('Save posts the whole block; Use defaults posts null', async () => {
  const ctx = await boot();
  input(ctx, $(ctx, 'smartNamingPattern'), '{type}/x-{slug}');
  await tick(5);
  $(ctx, 'smartNamingSave').click();
  await tick(40);
  assert.deepEqual(ctx.posts[0].smartNaming, { ...STORED, pattern: '{type}/x-{slug}' });
  $(ctx, 'smartNamingReset').click();
  await tick(40);
  assert.deepEqual(ctx.posts[1], { smartNaming: null });
});

test('a server refusal shows on the card', async () => {
  const ctx = await boot({ postStatus: 400 });
  input(ctx, $(ctx, 'smartNamingPattern'), '{type}/x');
  await tick(5);
  $(ctx, 'smartNamingSave').click();
  await tick(40);
  assert.match($(ctx, 'smart-naming-settings-card').textContent, /pattern must contain \{slug\}/);
});

test('types: the last one cannot be switched off; a custom type is added once and validated', async () => {
  const ctx = await boot();
  const chipOf = (t) => [...ctx.doc.querySelectorAll('#smartNamingTypes .filter-chip')].find((b) => b.textContent === t);
  for (const t of ['feat', 'chore', 'docs', 'refactor', 'test']) chipOf(t).click();
  assert.equal(ctx.doc.querySelectorAll('#smartNamingTypes [aria-pressed="true"]').length, 1);
  chipOf('fix').click();
  assert.equal(ctx.doc.querySelectorAll('#smartNamingTypes [aria-pressed="true"]').length, 1, 'fix stays on');
  assert.match($(ctx, 'smartNamingMsg').textContent, /At least one type/);
  chipOf('Add type').click();
  const add = ctx.doc.querySelector('#smartNamingTypes input');
  add.value = 'Bad Type'; add.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.match($(ctx, 'smartNamingMsg').textContent, /short lowercase word/);
  add.value = 'perf'; add.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(chipOf('perf').getAttribute('aria-pressed'), 'true');
  assert.equal($(ctx, 'smartNamingTypesValue').value, 'fix,perf');
});
