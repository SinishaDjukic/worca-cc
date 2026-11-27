// test/ui-run-tags-ask-handoff.test.mjs — the New run test of test/ui-run-tags.test.mjs where an Ask handoff's tags
// survive the project defaults that load after it. Those tags hold the field (it counts as edited until a run starts),
// so the test has an app of its own, booted as test/ui-run-tags-new-run.test.mjs boots it.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { applyFlags } from '../ui/public/flags.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const PROJECTS = [{ name: 'web', path: '/a/web', exists: true }, { name: 'api', path: '/a/api', exists: true }];
const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));
const flagsOn = (window) => applyFlags({ runLabels: true }, window.document);

// The answers New run reads, per test (bootForm sets them); the file's fetch reads them at the boot and after.
let form = { tagsFor: () => [], dims: null, runResponse: null, posted: [], puts: [] };
function answer(url, opts = {}) {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.includes('/tags/defaults') && method === 'PUT') { form.puts.push(JSON.parse(opts.body)); return Promise.resolve(ok(JSON.parse(opts.body))); }
  if (u.includes('/api/run-defaults')) {
    const dir = new URL(u, 'http://x').searchParams.get('projectDir') || '';
    return Promise.resolve(ok({ engine: { value: 'claude', source: 'default' }, steps: { claude: {}, codex: {} },
      projectKey: dir ? `${dir.split('/').pop()}-00000001` : null, tags: form.tagsFor(dir) }));
  }
  if (form.dims && u.includes('/api/tag-dimensions')) return Promise.resolve(ok(form.dims(new URL(u, 'http://x').searchParams)));
  if (u.includes('/api/tags')) return Promise.resolve(ok({ keys: [], values: {} }));
  if (u.includes('/api/projects')) return Promise.resolve(ok({ projects: PROJECTS }));
  if (u.includes('/api/workspaces')) return Promise.resolve(ok({ workspaces: [] }));
  if (u.includes('/api/branches')) return Promise.resolve(ok({ branches: ['dev'], current: 'dev' }));
  if (u.endsWith('/api/run') && method === 'POST') {
    form.posted.push(JSON.parse(opts.body));
    if (form.runResponse) { const { status, body } = form.runResponse(form.posted.length); return Promise.resolve(ok(body, status)); }
    return Promise.resolve(ok({ runId: `r${form.posted.length}` }));
  }
  return Promise.resolve(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
}
const app = useSharedApp({ before, beforeEach, after }, {
  local: { 'worca-cc.runTarget': 'project', 'worca-cc.lastProject': 'web' },
  fetchHandler: answer,
});

// New run on project web with the test's answers: the target and the project picked again, so the form reads the
// project's defaults and dimensions from them.
async function bootForm({ tagsFor = () => [], dims = null, runResponse = null } = {}) {
  form = { tagsFor, dims, runResponse, posted: [], puts: [] };
  await app.fresh();
  const doc = app.document;
  doc.querySelector('#target-seg button[data-target="project"]').click();
  for (let i = 0; i < 8; i++) await tick();
  const sel = doc.getElementById('projectSelect');
  sel.selectedIndex = [...sel.options].findIndex((o) => o.value === '/a/web');
  sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 8; i++) await tick();
  return { window: app.window, doc, posted: form.posted, puts: form.puts };
}
const formChips = (doc) => [...doc.querySelectorAll('#runTagsField .tag-chip')].map((c) => c.firstChild.textContent);
async function submit(ctx) {
  ctx.doc.querySelector('#prompt').value = 'do work';
  const n = ctx.posted.length;
  ctx.doc.querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && ctx.posted.length === n; i++) await tick();
  for (let i = 0; i < 6; i++) await tick();
  return ctx.posted.at(-1);
}

test('New run: an Ask handoff\'s tags survive the project defaults that load after it', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/api' ? ['team:web'] : []) });
  flagsOn(ctx.window);
  ctx.window.__np.openNewPipeline({ target: 'project', projectDir: '/a/api', workflowId: 'wf_default', guardrailsId: 'normal',
    prompt: 'x', title: 'X', featureBranch: '', tags: ['client:acme'] });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  for (let i = 0; i < 12; i++) await tick();
  assert.deepEqual(formChips(ctx.doc), ['client:acme']);
});
