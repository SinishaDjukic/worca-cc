// test/ui-run-presets-form.test.mjs — run presets on the New run form (app.js boot, #712): the hand-made body the
// extract pins, a pick → prompt → start body with the run-only lane and 0 project-config writes, the source-branch
// switch, Start disabled on a broken item until Reset, the Simple-mode note, the late run-defaults race, the Save
// dialog's duplicate name.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await tick();
  }
}
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const PROJECTS = [{ name: 'web', key: 'web-11111111', path: '/a/web', exists: true }, { name: 'api', key: 'api-22222222', path: '/a/api', exists: true }];
// No members: the per-member branch pickers (and their branch fetches) stay out of these tests.
const WORKSPACES = [{ id: 'ws_1', name: 'Both', description: '', projectPaths: [], projectKeys: [], exists: [], createdAt: 'x', updatedAt: 'x' }];
const MODELS = [{ id: 'claude-opus-5-5', efforts: ['medium', 'high'], harnesses: ['claude'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'], harnesses: ['claude'] }];
const NODES4 = { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' }, n_refine: { model: 'claude-opus-5-5', effort: 'high' },
  n_impl: { model: 'claude-opus-5-5', effort: 'high' }, n_review: { model: 'claude-opus-5-5', effort: 'high' } };
const preset = (over = {}) => ({ id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'global', ref: null }, updatedAt: '2026-10-16T00:00:00Z',
  setup: { workflowId: 'wf_default', guardrailsId: 'normal', humanInLoop: false, overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } } } }, ...over });

async function boot({ presets = [], check = () => ({ broken: [] }), runDefaults = null, runReply = null, wsConfigDelayMs = 0, namesDelayMs = 0, activeWorkflowId = 'wf_default' } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/#new' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const calls = [];
  const posted = [];
  let checks = 0;
  let list = [...presets];   // a PUT or DELETE is seen by the next GET
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/run-defaults')) {
      const body = runDefaults ? runDefaults.body : { engine: { value: 'claude', source: 'default' }, steps: { claude: {} } };
      return new Promise((r) => setTimeout(() => r(ok(body)), runDefaults ? runDefaults.delayMs : 0));
    }
    if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: PROJECTS }));
    // namesDelayMs: the workspace list answers after the presets (a fresh page load).
    if (u.includes('/api/workspaces')) return new Promise((r) => setTimeout(() => r(ok({ workspaces: WORKSPACES })), namesDelayMs));
    // The real Default graph (its node ids are what a preset's overlay names); its stage metas come from the offline fallback.
    if (u.includes('/api/workflows/wf_default')) return Promise.resolve(ok(GRAPH_DEFAULT_WORKFLOW));
    if (u.endsWith('/api/workflows')) return Promise.resolve(ok({ workflows: [{ id: 'wf_default', name: 'Default', version: 2 }] }));
    if (u.includes('/api/workflows') || u.includes('/api/agents')) return Promise.resolve(ok({ error: 'offline' }, 404));
    if (u.includes('/api/guardrails')) return Promise.resolve(ok({ guardrails: [{ id: 'permissive', name: 'Permissive', settings: null }, { id: 'normal', name: 'Normal', settings: {} }] }));
    if (/\/api\/presets\/[^/]+\/check/.test(u)) { checks += 1; return Promise.resolve(ok(check(checks))); }
    const one = u.match(/\/api\/presets\/([^/?]+)$/);
    if (one && method === 'PUT') {
      const body = JSON.parse(opts.body);
      list = list.map((p) => (p.id === one[1] ? { ...p, ...body } : p));
      return Promise.resolve(ok({ preset: list.find((p) => p.id === one[1]) }));
    }
    if (one && method === 'DELETE') { list = list.filter((p) => p.id !== one[1]); return Promise.resolve(ok({ ok: true })); }
    if (u.includes('/api/presets') && method === 'GET') return Promise.resolve(ok({ presets: list }));
    if (u.includes('/api/presets') && method === 'POST') return Promise.resolve(ok({ preset: preset({ id: 'rp_bbbbbbbbbbbb', name: 'Saved' }) }, 201));
    if (u.endsWith('/api/run') && method === 'POST') {
      posted.push(JSON.parse(opts.body));
      return Promise.resolve(ok(runReply ? runReply(posted.length) : { runId: `run-${posted.length}` }));
    }
    if (u.includes('/api/config')) {
      const body = ok({ config: { steps: {}, customModels: [], activeWorkflowId }, models: MODELS, efforts: ['medium', 'high'] });
      // wsConfigDelayMs: the workspace target's config load (no projectDir) answers late, after the preset's own pickers.
      const delay = method === 'GET' && !u.includes('projectDir') ? wsConfigDelayMs : 0;
      return delay ? new Promise((r) => setTimeout(() => r(body), delay)) : Promise.resolve(body);
    }
    return Promise.resolve(ok({}));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runTarget', 'project');
  window.localStorage.setItem('worca-cc.lastProject', 'web');
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  const doc = window.document;
  await waitFor(() => doc.querySelector('#projectSelect').value === '/a/web');
  for (let i = 0; i < 10; i++) await tick();
  return { window, doc, calls, posted, checks: () => checks };
}
const configWrites = (calls) => calls.filter((c) => c.url.includes('/api/config') && (c.method === 'POST' || c.method === 'PATCH'));
// Applied and unmodified: the Preset button names the preset, the summary says it is for this run, no "Modified" chip.
const applied = (doc) => doc.getElementById('preset-btn').classList.contains('is-on') && doc.getElementById('preset-chip').hidden
  && /applies to this run only$/.test(doc.getElementById('preset-summary').textContent);
async function pick(ctx, id) {
  await waitFor(() => [...ctx.doc.querySelectorAll('#presetSelect option')].some((o) => o.value === id));
  const sel = ctx.doc.querySelector('#presetSelect');
  sel.value = id;
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => applied(ctx.doc));
  for (let i = 0; i < 5; i++) await tick();
}
async function submit(ctx) {
  ctx.doc.querySelector('#prompt').value = 'fix it';
  const n = ctx.posted.length;
  ctx.doc.querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => ctx.posted.length > n);
  for (let i = 0; i < 5; i++) await tick();
  return ctx.posted[ctx.posted.length - 1];
}

test('no preset: the hand-made body is pinned, with no presetId, overlay or humanInLoop', async () => {
  const ctx = await boot();
  const gr = ctx.doc.querySelector('#guardrailsSelect');
  gr.value = 'normal';
  gr.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  ctx.doc.querySelector('#mock').checked = true;
  const wf = ctx.doc.querySelector('#workflowSelect');
  wf.value = 'wf_default';
  wf.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 5; i++) await tick();
  const body = await submit(ctx);
  assert.deepEqual(body, { workflowId: 'wf_default', guardrailsId: 'normal', mock: true, projectDir: '/a/web', prompt: 'fix it' });
});

test('pick → prompt → start sends the run-only lane and writes no project config, even after a Planner model change', async () => {
  const ctx = await boot({ presets: [preset()] });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  const model = ctx.doc.querySelector('.agent-row[data-node-id="n_plan"] .step-model');
  assert.ok(model, 'the Planner row renders');
  assert.equal(model.value, 'claude-haiku-4-5', 'the row shows the preset\'s pick');
  assert.equal(ctx.doc.querySelector('#agentsReset').hidden, true, 'no Reset: it would delete the project\'s rows');
  model.value = 'claude-opus-5-5';
  model.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => /Modified/.test(ctx.doc.querySelector('#preset-chip').textContent));
  const body = await submit(ctx);
  assert.equal(ctx.posted.length, 1);
  assert.equal(body.presetId, 'rp_aaaaaaaaaaaa');
  assert.equal(body.humanInLoop, false);
  assert.equal(body.overlay.nodes.n_plan.model, 'claude-opus-5-5');
  // The overlay refuses a null toggle (fanOut/askQuestions must be true or false): an inherit is sent as the default.
  for (const pick of Object.values(body.overlay.nodes)) for (const v of Object.values(pick)) assert.notEqual(v, null);
  assert.equal(typeof body.overlay.nodes.n_plan.fanOut, 'boolean');
  assert.equal(body.guardrailsId, 'normal');
  assert.deepEqual(configWrites(ctx.calls), []);
});

test('a preset saved with Run on the source branch turns it on, and on again after a start', async () => {
  const ctx = await boot({ presets: [preset({ setup: { workflowId: 'wf_default', sameAsSource: true } })] });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  assert.equal(ctx.doc.querySelector('#sameAsSource').checked, true);
  const body = await submit(ctx);
  assert.equal(body.sameAsSource, true);
  await waitFor(() => ctx.doc.querySelector('#sameAsSource').checked === true);
  assert.equal(ctx.doc.querySelector('#sameAsSource').checked, true);
});

test('a broken item disables Start and names it; Reset clears it once the check passes', async () => {
  const item = { item: 'model', ref: 'n_plan', message: 'Planner: model my-gateway-opus is no longer in the catalog', reset: true };
  // Broken until Reset, not "on the first check": a previous boot's debounced check can reach this boot's stub first.
  let reset = false;
  const ctx = await boot({ presets: [preset({ setup: { workflowId: 'wf_default', overlay: { nodes: { n_plan: { model: 'my-gateway-opus' } } } } })],
    check: () => ({ broken: reset ? [] : [item] }) });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  await waitFor(() => ctx.doc.querySelectorAll('.preset-broken-row').length === 1);
  const start = ctx.doc.querySelector('#start-btn');
  assert.equal(start.disabled, true);
  assert.equal(start.title, item.message);
  assert.equal(ctx.doc.querySelector('.preset-broken-row span').textContent, item.message);
  const before = ctx.checks();
  reset = true;
  ctx.doc.querySelector('.preset-broken-row button').click();
  await waitFor(() => ctx.checks() > before && ctx.doc.querySelectorAll('.preset-broken-row').length === 0);
  assert.equal(start.disabled, false);
});

test('Simple mode: the hidden-settings note names the preset\'s picks and Away mark, not agent overrides', async () => {
  // n_clarify holds only its toggles (the stored full picks name every agent node): it is not an agent pick.
  const nodes = { ...NODES4, n_clarify: { fanOut: false, askQuestions: true } };
  const ctx = await boot({ presets: [preset({ setup: { workflowId: 'wf_default', nightMode: true, overlay: { nodes } } })] });
  ctx.doc.documentElement.dataset.level = 'simple';
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  const note = ctx.doc.querySelector('#level-hidden-note');
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /4 agent picks/);
  assert.match(note.textContent, /Away mark/);
  assert.doesNotMatch(note.textContent, /agent override/);
});

test('a pinned preset survives the late run-defaults answer: its engine and tags stay', async () => {
  const pinned = preset({ scope: { kind: 'project', ref: 'api-22222222' }, setup: { workflowId: 'wf_default', engine: 'claude', tags: ['team:api'] } });
  const ctx = await boot({ presets: [pinned], runDefaults: { delayMs: 60, body: { engine: { value: 'codex', source: 'project' }, steps: { codex: {} }, tags: ['team:web'], projectKey: 'web-11111111' } } });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  assert.equal(ctx.doc.querySelector('#projectSelect').value, '/a/api', 'the pin switched the project');
  await new Promise((r) => setTimeout(r, 120));   // the late /api/run-defaults lands
  const body = await submit(ctx);
  assert.equal(body.engine, 'claude');
  assert.deepEqual(body.tags, ['team:api']);
  assert.equal(body.projectDir, '/a/api');
});

test('a workspace-pinned preset keeps its workflow, guardrails and Human in the loop over the workspace config load', async () => {
  const pinned = preset({ scope: { kind: 'workspace', ref: 'ws_1' }, setup: { workflowId: 'wf_auto', guardrailsId: 'normal', humanInLoop: false } });
  const ctx = await boot({ presets: [pinned], wsConfigDelayMs: 80 });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  await new Promise((r) => setTimeout(r, 150));   // past the late workspace config load
  assert.equal(ctx.doc.querySelector('#workflowSelect').value, 'wf_auto');
  assert.equal(ctx.doc.querySelector('#guardrailsSelect').value, 'normal');
  assert.equal(ctx.doc.querySelector('#humanInLoop').checked, false, 'the switch shows what the body sends');
  const body = await submit(ctx);
  assert.equal(body.workspaceId, 'ws_1');
  assert.equal(body.workflowId, 'wf_auto');
  assert.equal(body.guardrailsId, 'normal');
  assert.equal(body.humanInLoop, false);
  assert.equal(body.presetId, 'rp_aaaaaaaaaaaa');
});

test('changing the project in preset mode puts the preset\'s workflow and guardrails back and checks again', async () => {
  const ctx = await boot({ presets: [preset({ setup: { workflowId: 'wf_auto', guardrailsId: 'normal', humanInLoop: false } })] });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  const before = ctx.checks();
  const proj = ctx.doc.querySelector('#projectSelect');
  proj.value = '/a/api';
  proj.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => ctx.checks() > before);
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(ctx.doc.querySelector('#workflowSelect').value, 'wf_auto', 'the project\'s activeWorkflowId did not win');
  assert.equal(ctx.doc.querySelector('#guardrailsSelect').value, 'normal');
  assert.ok(applied(ctx.doc), 'the setup is unchanged, so not modified');
  const check = ctx.calls.filter((c) => /\/api\/presets\/[^/]+\/check/.test(c.url)).at(-1);
  assert.equal(check.body.projectDir, '/a/api');
  const body = await submit(ctx);
  assert.equal(body.projectDir, '/a/api');
  assert.equal(body.workflowId, 'wf_auto');
  assert.equal(body.guardrailsId, 'normal');
});

test('after a fresh load the menu labels pinned presets with the project and workspace names, not their keys', async () => {
  const presets = [preset({ id: 'rp_pppppppppppp', name: 'P', scope: { kind: 'project', ref: 'api-22222222' } }),
    preset({ id: 'rp_wwwwwwwwwwww', name: 'W', scope: { kind: 'workspace', ref: 'ws_1' } })];
  const ctx = await boot({ presets, namesDelayMs: 40 });
  await waitFor(() => ctx.doc.querySelectorAll('#presetSelect optgroup').length === 2);
  await new Promise((r) => setTimeout(r, 80));
  const labels = [...ctx.doc.querySelectorAll('#presetSelect optgroup')].map((g) => g.label);
  assert.deepEqual(labels.sort(), ['Both', 'api']);
});

test('Settings › Presets after a fresh load names the pinned workspace, with no false Workspace gone badge', async () => {
  const presets = [preset({ id: 'rp_wwwwwwwwwwww', name: 'W', scope: { kind: 'workspace', ref: 'ws_1' } })];
  const ctx = await boot({ presets, namesDelayMs: 40 });
  ctx.window.location.hash = '#settings/presets';
  await waitFor(() => /Only workspace/.test(ctx.doc.querySelector('#presets-list').textContent));
  assert.match(ctx.doc.querySelector('#presets-list').textContent, /Only workspace Both/);
  assert.equal(ctx.doc.querySelector('#presets-list .preset-gone'), null);
  ctx.window.location.hash = '#new';
});

test('Save as preset under a name the menu holds reopens with the duplicate message and sends nothing', async () => {
  const ctx = await boot({ presets: [preset()] });
  await waitFor(() => ctx.doc.querySelectorAll('#presetSelect option').length > 2);
  openPresetMenu(ctx.doc); menuItem(ctx.doc, 'Save as preset').click();
  await waitFor(() => !ctx.doc.querySelector('#confirm-modal').classList.contains('hidden'));
  const name = ctx.doc.querySelector('#confirm-f-name');
  name.value = 'quick FIX';
  name.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  ctx.doc.querySelector('#confirm-ok').click();
  await waitFor(() => /A preset with this name already exists/.test(ctx.doc.querySelector('#confirm-fields').textContent));
  assert.equal(ctx.doc.querySelector('#confirm-f-name').value, 'quick FIX', 'the typed name stays');
  ctx.doc.querySelector('#confirm-cancel').click();
  await tick();
  assert.equal(ctx.calls.filter((c) => c.url.includes('/api/presets') && c.method === 'POST').length, 0);
});

test('Save as preset names the workflow and says when it is the project\'s default (review G)', async () => {
  const ctx = await boot({ activeWorkflowId: 'wf_auto' });
  await waitFor(() => ctx.doc.querySelector('#workflowSelect').value === 'wf_auto');
  openPresetMenu(ctx.doc); menuItem(ctx.doc, 'Save as preset').click();
  await waitFor(() => !ctx.doc.querySelector('#confirm-modal').classList.contains('hidden'));
  assert.match(ctx.doc.querySelector('#confirm-fields').textContent, /Saved: Auto workflow \(this project's default\) · Claude, guardrails/);
  ctx.doc.querySelector('#confirm-cancel').click();
  await tick();
});

test('the Chat home lists the scoped presets and picking one opens New run with the form filled', async () => {
  const ctx = await boot({ presets: [preset(), preset({ id: 'rp_bbbbbbbbbbbb', name: 'Elsewhere', scope: { kind: 'project', ref: 'other-99999999' } })] });
  ctx.window.location.hash = '#chat/new';
  await waitFor(() => ctx.doc.querySelectorAll('.chat-home-preset').length > 0);
  assert.deepEqual([...ctx.doc.querySelectorAll('.chat-home-preset')].map((b) => b.textContent), ['Quick fix'], 'another project\'s pinned preset is not listed');
  ctx.doc.querySelector('.chat-home-preset').click();
  await waitFor(() => ctx.window.location.hash === '#new' && ctx.doc.getElementById('presetSelect').value === 'rp_aaaaaaaaaaaa');
  await waitFor(() => applied(ctx.doc));
  await waitFor(() => ctx.doc.querySelector('#guardrailsSelect').value === 'normal');
  await waitFor(() => ctx.doc.activeElement === ctx.doc.getElementById('prompt'));
  assert.equal(ctx.doc.getElementById('prompt').value, '');
});

test('Settings › Presets Use opens New run with the preset applied and the prompt focused', async () => {
  const ctx = await boot({ presets: [preset()] });
  ctx.window.location.hash = '#settings/presets';
  await waitFor(() => ctx.doc.querySelector('#presets-list [data-act="use"]'));
  ctx.doc.querySelector('#presets-list [data-act="use"]').click();
  await waitFor(() => ctx.window.location.hash === '#new' && ctx.doc.getElementById('presetSelect').value === 'rp_aaaaaaaaaaaa');
  await waitFor(() => ctx.doc.activeElement === ctx.doc.getElementById('prompt'));
});

const menuItem = (doc, label) => [...doc.querySelectorAll('.wfv-menu[role="menu"] [role^="menuitem"]')].find((b) => b.textContent.trim() === label);
const menuLabels = (doc) => [...doc.querySelectorAll('.wfv-menu[role="menu"] [role^="menuitem"], .wfv-menu[role="menu"] .wfv-menu-h')].map((b) => b.textContent.trim());
const openPresetMenu = (doc) => doc.getElementById('preset-btn').click();

test('Preset ▾: one quiet button with No preset; its menu lists the presets, Save as preset and (Advanced) Manage presets…', async () => {
  const ctx = await boot({ presets: [preset()] });
  ctx.doc.documentElement.dataset.level = 'simple';
  await waitFor(() => ctx.doc.querySelectorAll('#presetSelect option').length > 1);
  const btn = ctx.doc.getElementById('preset-btn');
  assert.equal(btn.textContent, 'Preset');
  assert.ok(btn.classList.contains('btn-quiet') && !btn.classList.contains('is-on'));
  assert.equal(ctx.doc.getElementById('preset-clear').hidden, true);
  assert.equal(ctx.doc.getElementById('preset-summary').hidden, true);
  openPresetMenu(ctx.doc);
  assert.equal(ctx.doc.querySelector('.wfv-menu[role="menu"]').getAttribute('aria-label'), 'Presets');
  assert.ok(ctx.doc.querySelector('.wfv-menu[role="menu"]').classList.contains('menu'), 'openMenu wears the shared .menu box');
  assert.ok(!menuLabels(ctx.doc).includes('Manage presets…'), 'Simple has no Manage presets…');
  assert.ok(menuLabels(ctx.doc).includes('Quick fix') && menuLabels(ctx.doc).at(-1) === 'Save as preset');
  openPresetMenu(ctx.doc);   // toggles it closed
  ctx.doc.documentElement.dataset.level = 'advanced';
  openPresetMenu(ctx.doc);
  assert.equal(menuLabels(ctx.doc).at(-1), 'Manage presets…');
});

test('Preset ▾ with a preset applied: the filled name, ✕ clears it, the menu ticks it and lists Rename… and Delete…', async () => {
  const ctx = await boot({ presets: [preset()] });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  const btn = ctx.doc.getElementById('preset-btn');
  assert.equal(btn.textContent, 'Quick fix');
  assert.equal(ctx.doc.getElementById('preset-clear').hidden, false);
  openPresetMenu(ctx.doc);
  assert.equal(menuItem(ctx.doc, 'Quick fix').getAttribute('aria-checked'), 'true');
  assert.ok(menuItem(ctx.doc, 'Rename…') && menuItem(ctx.doc, 'Delete…'));
  openPresetMenu(ctx.doc);
  ctx.doc.getElementById('preset-clear').click();
  assert.equal(ctx.doc.getElementById('presetSelect').value, '');
  assert.equal(btn.textContent, 'Preset');
  assert.equal(ctx.doc.getElementById('preset-clear').hidden, true);
  assert.equal(ctx.doc.activeElement, btn);
});

test('Rename… from the Preset menu: the Settings prompt, one PUT, the menu and button renamed, focus back on Preset', async () => {
  const ctx = await boot({ presets: [preset()] });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  openPresetMenu(ctx.doc);
  menuItem(ctx.doc, 'Rename…').click();
  await waitFor(() => !ctx.doc.querySelector('#confirm-modal').classList.contains('hidden'));
  assert.equal(ctx.doc.getElementById('confirm-title').textContent, 'Rename preset');
  const name = ctx.doc.querySelector('#confirm-f-name');
  name.value = 'Faster fix';
  name.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  ctx.doc.querySelector('#confirm-ok').click();
  await waitFor(() => [...ctx.doc.querySelectorAll('#presetSelect option')].some((o) => o.textContent === 'Faster fix'));
  assert.deepEqual(ctx.calls.filter((c) => c.method === 'PUT').map((c) => [c.url.replace(/^.*\/api/, '/api'), c.body]),
    [['/api/presets/rp_aaaaaaaaaaaa', { name: 'Faster fix' }]]);
  await waitFor(() => ctx.doc.activeElement === ctx.doc.getElementById('preset-btn'));
});

test('Delete… from the Preset menu: the danger confirm; Cancel sends nothing; Delete leaves preset mode', async () => {
  const ctx = await boot({ presets: [preset()] });
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  const btn = ctx.doc.getElementById('preset-btn');
  openPresetMenu(ctx.doc);
  menuItem(ctx.doc, 'Delete…').click();
  await waitFor(() => !ctx.doc.querySelector('#confirm-modal').classList.contains('hidden'));
  assert.match(ctx.doc.getElementById('confirm-message').textContent, /Delete the preset “Quick fix”\? Runs it started are not affected\./);
  ctx.doc.querySelector('#confirm-cancel').click();
  await waitFor(() => ctx.doc.activeElement === btn);
  assert.equal(ctx.calls.filter((c) => c.method === 'DELETE').length, 0);
  openPresetMenu(ctx.doc);
  menuItem(ctx.doc, 'Delete…').click();
  await waitFor(() => !ctx.doc.querySelector('#confirm-modal').classList.contains('hidden'));
  ctx.doc.querySelector('#confirm-ok').click();
  await waitFor(() => ctx.calls.filter((c) => c.method === 'DELETE').length === 1 && btn.textContent === 'Preset');
  await waitFor(() => ctx.doc.activeElement === btn);
  assert.equal(ctx.doc.getElementById('preset-clear').hidden, true);
  assert.equal(ctx.doc.getElementById('presetSelect').value, '');
  assert.ok(![...ctx.doc.querySelectorAll('#presetSelect option')].some((o) => o.value === 'rp_aaaaaaaaaaaa'));
});

test('Simple: no "Manage presets…", the broken scope hint names ⋯; switching to Advanced brings both back', async () => {
  const ctx = await boot({ presets: [preset()], check: () => ({ broken: [{ item: 'project', ref: 'gone-1', message: 'Project gone-1 is no longer registered in worca', reset: false }] }) });
  ctx.doc.documentElement.dataset.level = 'simple';
  ctx.doc.dispatchEvent(new ctx.window.CustomEvent('worca:level', { detail: { level: 'simple', previous: 'expert' } }));
  await pick(ctx, 'rp_aaaaaaaaaaaa');
  const opts = () => [...ctx.doc.querySelectorAll('#presetSelect option')].map((o) => o.value);
  assert.ok(!opts().includes('__manage__'));
  await waitFor(() => /from the Preset menu/.test(ctx.doc.getElementById('preset-broken').textContent));
  ctx.doc.documentElement.dataset.level = 'advanced';
  ctx.doc.dispatchEvent(new ctx.window.CustomEvent('worca:level', { detail: { level: 'advanced', previous: 'simple' } }));   // as ui-level.mjs dispatches it
  assert.ok(opts().includes('__manage__'));
  assert.match(ctx.doc.getElementById('preset-broken').textContent, /Edit the preset's scope in Settings › Presets/);
});

test('a picker option\'s tooltip and Settings › Presets name the workflow and engine, with no ids', async () => {
  const ctx = await boot({ presets: [preset({ setup: { workflowId: 'wf_auto', engine: 'codex' } })] });
  await waitFor(() => ctx.doc.querySelector('#presetSelect option[value="rp_aaaaaaaaaaaa"]'));
  assert.equal(ctx.doc.querySelector('#presetSelect option[value="rp_aaaaaaaaaaaa"]').title, 'Auto workflow · Codex');
  ctx.window.location.hash = '#settings/presets';
  await waitFor(() => ctx.doc.querySelector('#presets-list .preset-meta'));
  assert.match(ctx.doc.querySelector('#presets-list .preset-meta').textContent, /^Auto workflow · Codex · Updated/);
  ctx.window.location.hash = '#new';
});

test('Simple: a deep link to Settings › Presets shows the Advanced level banner', async () => {
  const ctx = await boot({ presets: [preset()] });
  ctx.doc.documentElement.dataset.level = 'simple';
  ctx.window.location.hash = '#settings/presets';
  await waitFor(() => ctx.doc.getElementById('level-banner').hidden === false);
  assert.equal(ctx.doc.getElementById('level-banner-text').textContent, 'Presets is part of Advanced mode, so it is not in your menu.');
  assert.equal(ctx.doc.getElementById('level-banner-pill').dataset.lv, 'advanced');
  ctx.window.location.hash = '#new';
});
