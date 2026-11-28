// test/ui-run-rerun-form-presets.test.mjs — the tests of test/ui-run-rerun-form.test.mjs where a run preset meets
// Rerun. They need the preset in the list app.js fetches once, when it loads (GET /api/presets), so they live in their
// own file, booted with it (test/helpers/shared-app-boot.mjs). Shared boot and fixtures: helpers/history-detail-boot.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { ROW, DETAIL, openDetail, click, settle, go, ok, fail, detailOn, historyFetch } from './helpers/history-detail-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

// The preset list is fetched when app.js loads, so its answer is the file's.
const PRESET = { id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'global', ref: null }, updatedAt: '2026-10-16T00:00:00Z', setup: { workflowId: 'wf_default', guardrailsId: 'normal', humanInLoop: false } };
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: historyFetch((url, opts) => (url.includes('/api/presets') && ((opts && opts.method) || 'GET') === 'GET' ? ok({ presets: [PRESET] }) : null)),
});
const bootDetail = detailOn(app).detail;

const ID = ROW.id;
const MODELS = [{ id: 'claude-opus-5-5', efforts: ['medium', 'high'], harnesses: ['claude'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'], harnesses: ['claude'] }];
const SETUP = { workflowId: 'wf_default', guardrailsId: 'normal', mock: true, nightMode: true, tags: ['client:acme'],
  overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } } } };
const PAYLOAD = () => ({
  prompt: 'Fix the log UX.', title: 'Log UX', target: { kind: 'project', ref: 'proj-alpha-abcd1234', projectDir: '/tmp/proj', workspaceId: null },
  setup: structuredClone(SETUP), broken: [], extras: [{ name: 'spec.md', available: true }], extrasLost: false,
});
const waitFor = async (pred, ms = 4000) => {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('waitFor timed out'); await new Promise((r) => setTimeout(r, 0)); }
};

/** The saved run's page with the Rerun arms. `box.payload` / `box.check` / `box.fileStatus` are mutable per test. */
async function bootRerun({ presets = [], payload = PAYLOAD(), status = 'done', check = () => ({ broken: [] }), files = { 'spec.md': 'hello' }, rerunReply = null } = {}) {
  const box = { payload, check, files, posts: [], gets: [], rerunReply };
  const ctx = await bootDetail({
    rows: [{ ...ROW, status }],
    detail: { ...DETAIL, state: { ...DETAIL.state, status, prompt: 'Fix the log UX.' } },
    arms: (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (url.endsWith(`/api/pipelines/${ID}/setup`)) return ok({ setup: SETUP });
      if (url.endsWith(`/api/pipelines/${ID}/rerun`)) { box.gets.push(url); return box.rerunReply || ok(box.payload); }
      if (url.endsWith(`/api/pipelines/${ID}/rerun/check`)) return ok(box.check(JSON.parse(opts.body)));
      const f = url.match(/\/artifact-raw\/extras\/([^?]+)\?download=1$/);
      if (f) {
        const name = decodeURIComponent(f[1]);
        return name in box.files ? Promise.resolve({ ok: true, status: 200, blob: async () => new ctx.window.Blob([box.files[name]]) }) : fail(404, { error: 'artifact not found' });
      }
      if (url.endsWith('/api/projects')) return ok({ projects: [{ name: 'proj', key: 'proj-alpha-abcd1234', path: '/tmp/proj', exists: true }] });
      if (url.includes('/api/workflows/wf_default')) return ok(GRAPH_DEFAULT_WORKFLOW);
      if (url.endsWith('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default', version: 2 }] });
      if (url.includes('/api/guardrails')) return ok({ guardrails: [{ id: 'permissive', name: 'Permissive', settings: null }, { id: 'normal', name: 'Normal', settings: {} }] });
      if (url.includes('/api/presets') && method === 'GET') return ok({ presets });
      if (url.includes('/api/config')) return ok({ config: { steps: {}, customModels: [], activeWorkflowId: 'wf_default' }, models: MODELS, efforts: ['medium', 'high'] });
      if (url.endsWith('/api/run') && method === 'POST') { box.posts.push(JSON.parse(opts.body)); return (ctx.box.runReplies || []).shift() || ok({ runId: `run-${box.posts.length}` }); }
      return null;
    },
  });
  ctx.box = Object.assign(ctx.box, box);
  globalThis.FileReader = ctx.window.FileReader;   // app.js reads attached files through the bare global
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  return ctx;
}
const doc = (ctx) => ctx.window.document;
const menuItems = (ctx) => [...doc(ctx).querySelectorAll('.wfv-menu .wfv-menu-item')];
const openMenu = (ctx) => { click(ctx.window, doc(ctx).querySelector('#hist-detail .hd-bar-more')); return menuItems(ctx); };
const labelOf = (b) => b.querySelector('.wfv-menu-l').textContent;
async function chooseRerun(ctx) {
  const item = openMenu(ctx).find((b) => labelOf(b) === 'Rerun');
  assert.ok(item, `Rerun is in ⋯: ${menuItems(ctx).map(labelOf)}`);
  click(ctx.window, item);
  await waitFor(() => ctx.window.location.hash === '#new');
  await waitFor(() => doc(ctx).querySelector('#title').value === 'Log UX');
  await settle(ctx.window, 12);
}
async function submit(ctx) {
  const n = ctx.box.posts.length;
  doc(ctx).querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => ctx.box.posts.length > n);
  await settle(ctx.window, 6);
  return ctx.box.posts[ctx.box.posts.length - 1];
}

test('a preset applied earlier is cleared by Rerun (no presetId), and a changed workflow drops the overlay', async () => {
  const ctx = await bootRerun({ presets: [PRESET] });
  go(ctx.window, 'new');
  await waitFor(() => [...doc(ctx).querySelectorAll('#presetSelect option')].some((o) => o.value === PRESET.id));
  const sel = doc(ctx).querySelector('#presetSelect');
  sel.value = PRESET.id;
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => doc(ctx).querySelector('#preset-btn').classList.contains('is-on'));
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  await chooseRerun(ctx);
  const d = doc(ctx);
  assert.equal(d.querySelector('#preset-btn').classList.contains('is-on'), false, 'the earlier pick is gone');
  const wf = d.querySelector('#workflowSelect');
  wf.appendChild(Object.assign(d.createElement('option'), { value: 'wf_other', textContent: 'Other' }));
  wf.value = 'wf_other';
  wf.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle(ctx.window, 8);
  const body = await submit(ctx);
  assert.equal(body.presetId, undefined);
  assert.equal(body.overlay, undefined, 'R-po-3: the overlay names the old workflow\'s nodes');
  assert.equal(body.rerunOf, ID);
});

test('a preset picked on the rerun form replaces the earlier picks for good: No preset does not bring them back', async () => {
  const ctx = await bootRerun({ presets: [PRESET] });
  await chooseRerun(ctx);
  const d = doc(ctx);
  const sel = d.querySelector('#presetSelect');
  await waitFor(() => [...sel.options].some((o) => o.value === PRESET.id));
  sel.value = PRESET.id;
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => d.querySelector('#preset-btn').classList.contains('is-on'));
  await settle(ctx.window, 8);
  sel.value = '';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => !d.querySelector('#preset-btn').classList.contains('is-on'));
  await settle(ctx.window, 8);
  const body = await submit(ctx);
  assert.equal(body.presetId, undefined);
  assert.equal(body.overlay, undefined, 'the earlier run\'s Planner pick is gone');
  assert.equal(body.rerunOf, ID, 'the link stays');
});

test('after a preset and then No preset, a target change judges the target alone: the old run\'s gone set no longer blocks Start', async () => {
  const goneSet = { item: 'guardrails', ref: 'normal', message: 'Guardrail set normal no longer exists', reset: true };
  const checks = [];
  const ctx = await bootRerun({ presets: [PRESET], check: (b) => { checks.push(b); return { broken: b.targetOnly ? [] : [goneSet] }; } });
  await chooseRerun(ctx);
  const d = doc(ctx);
  d.querySelector('#mock').checked = false;   // an edit before the preset: the hold was modified
  d.querySelector('#mock').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  const sel = d.querySelector('#presetSelect');
  await waitFor(() => [...sel.options].some((o) => o.value === PRESET.id));
  sel.value = PRESET.id;
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => d.querySelector('#preset-btn').classList.contains('is-on'));
  await settle(ctx.window, 8);
  sel.value = '';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => !d.querySelector('#preset-btn').classList.contains('is-on'));
  await settle(ctx.window, 8);
  const n = checks.length;
  click(ctx.window, d.querySelector('[data-target="none"]'));
  await waitFor(() => checks.length > n);
  await settle(ctx.window, 8);
  assert.equal(checks.at(-1).targetOnly, true);
  assert.equal(d.querySelector('#start-btn').disabled, false, 'no broken item from picks the form no longer holds');
  assert.doesNotMatch(d.querySelector('#preset-broken').textContent, /no longer exists/);
});
