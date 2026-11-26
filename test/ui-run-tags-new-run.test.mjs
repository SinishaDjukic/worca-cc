// test/ui-run-tags-new-run.test.mjs — the New run form's tests of test/ui-run-tags.test.mjs (#718, #923): the
// project's defaults prefill the tag field, ride the body and come back after a start, an Ask handoff's tags, and the
// tag dimensions' slots. They need the app LOADED with New run on a project target (web), which app.js reads from
// storage once, so they live in their own file, booted with it (test/helpers/shared-app-boot.mjs). The New run boot is
// test/ui-engine-default-prefill.test.mjs's.
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

test('New run: the project\'s defaults prefill the field, ride the body, and come back after a start', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/web' ? ['client:acme'] : []) });
  flagsOn(ctx.window);
  assert.deepEqual(formChips(ctx.doc), ['client:acme']);
  assert.equal(ctx.doc.getElementById('runTagsSaveDefault').hidden, false);
  const input = ctx.doc.querySelector('#runTagsField .tag-input-text');
  input.value = 'Team: Web';
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  input.value = 'client:';
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  assert.deepEqual((await submit(ctx)).tags, ['client:acme', 'team:web']);
  assert.deepEqual(formChips(ctx.doc), ['client:acme'], 'the next run starts from the defaults again');
  assert.equal(input.value, '', 'no leftover uncommitted text');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  ctx.doc.querySelector('#runTagsField .tag-x').click();
  assert.equal(Object.hasOwn(await submit(ctx), 'tags'), false, 'no chip: no tags key');
});

test('No dimensions configured: no slot UI beyond the free-form field', async () => {
  const ctx = await bootForm({ dims: () => ({ source: null, home: null, dims: [] }) });
  flagsOn(ctx.window);
  assert.equal(ctx.doc.getElementById('runTagDimsField').hidden, true);
  assert.equal(ctx.doc.querySelectorAll('.tag-dim-slot').length, 0);
  assert.doesNotMatch(ctx.doc.querySelector('#run-form').textContent, /Cost centre/);
});

test('the Tags label follows the policy: "(optional)" while it is off, "mandatory tags required" while it is on', async () => {
  const opt = (ctx) => ctx.doc.querySelector('.run-tags-field .opt').textContent;
  const cc = [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }];
  const none = await bootForm({ dims: () => ({ source: null, home: null, dims: [] }) });
  flagsOn(none.window);
  assert.equal(opt(none), '(optional)', 'no dimensions: optional');
  const off = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: false, dims: cc }) });
  flagsOn(off.window);
  assert.equal(opt(off), '(optional)', 'policy off: optional, even with a tag ticked Mandatory');
  const on = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, dims: cc }) });
  flagsOn(on.window);
  assert.equal(opt(on), '· mandatory cost tags required', 'policy on: the field says so');
  const onNoneTicked = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, dims: [{ ...cc[0], required: false }] }) });
  flagsOn(onNoneTicked.window);
  assert.equal(opt(onNoneTicked), '(optional)', 'policy on but no tag ticked Mandatory: still optional');
});

test('policy off: a run without a tag ticked Mandatory starts quietly — no warning, nothing blocked', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'policy', home: 'acme/web', enforce: false, dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  flagsOn(ctx.window);
  assert.equal(ctx.doc.getElementById('runTagDimsWarn').hidden, true, 'no "is required" warning under the field');
  const body = await submit(ctx);
  assert.equal(body.tags, undefined, 'the run is posted with no tags');
  for (const toast of ctx.doc.querySelectorAll('.toast')) {   // the run page opens, so no "Run started" toast (F-24)
    assert.doesNotMatch(toast.textContent, /Missing required tag/);
    assert.doesNotMatch(toast.className, /warn/);
  }
});

test('enforced: a pre-filled mandatory tag shows as a chosen value; Start is enabled and posts it', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, prefill: ['cc:4410'],
    dims: [{ key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true }] }) });
  flagsOn(ctx.window);
  const sel = ctx.doc.querySelector('.tag-dim-slot[data-key="cc"] select');
  assert.equal(sel.value, '4410');
  assert.equal(ctx.doc.getElementById('start-btn').disabled, false);
  const body = await submit(ctx);
  assert.deepEqual(body.tags, ['cc:4410']);
});

test('enforced: nothing to pre-fill → Start disabled with "Add Cost centre to start" under the field; picking enables it', async () => {
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: true, prefill: [],
    dims: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] }) });
  flagsOn(ctx.window);
  const start = ctx.doc.getElementById('start-btn');
  const warn = ctx.doc.getElementById('runTagDimsWarn');
  assert.equal(start.disabled, true);
  assert.equal(start.title, 'Add Cost centre to start');
  assert.equal(warn.textContent, 'Add Cost centre to start');
  assert.equal(warn.hidden, false);
  const sel = ctx.doc.querySelector('.tag-dim-slot[data-key="cc"] select');
  sel.value = '4410'; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.equal(start.disabled, false);
  assert.equal(start.title, '');
  assert.equal(warn.hidden, true);
});

test('a 422 with fields.tags shows the reason under the tag field, not a card alert', async () => {
  const reason = 'Cost centre "9999" is not one of its values (4410)';
  const ctx = await bootForm({ dims: () => ({ source: 'settings', home: null, enforce: false, prefill: [], dims: [] }),
    runResponse: () => ({ status: 422, body: { error: reason, fields: { tags: reason } } }) });
  flagsOn(ctx.window);
  await submit(ctx);
  const warn = ctx.doc.getElementById('runTagDimsWarn');
  assert.equal(warn.textContent, reason);
  assert.equal(warn.hidden, false);
  assert.equal([...ctx.doc.querySelectorAll('.card-alert')].some((n) => n.textContent.includes(reason)), false, 'no card alert carries it');
  assert.equal(ctx.doc.getElementById('start-btn').disabled, false, 'the button is usable again');
});

test('A filled slot rides the body with the free-form tags; a default cc:4410 lands in the slot', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/web' ? ['cc:4410', 'client:acme'] : []), dims: () => ({ source: 'settings', home: null, dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] }) });
  flagsOn(ctx.window);
  const input = ctx.doc.querySelector('#runTagDimsField .tag-dim-input');
  assert.equal(input.value, '4410', 'the project default lands in its slot');
  assert.deepEqual(formChips(ctx.doc), ['client:acme'], 'not in the free-form field too');
  input.value = '4420'; input.dispatchEvent(new ctx.window.Event('input'));
  assert.deepEqual((await submit(ctx)).tags, ['cc:4420', 'client:acme']);
});

test('Save as project default keeps the value typed in a dimension slot', async () => {
  const ctx = await bootForm({ tagsFor: (dir) => (dir === '/a/web' ? ['client:acme'] : []), dims: () => ({ source: 'settings', home: null, dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] }) });
  flagsOn(ctx.window);
  const input = ctx.doc.querySelector('#runTagDimsField .tag-dim-input');
  input.value = '4420'; input.dispatchEvent(new ctx.window.Event('input'));
  ctx.doc.getElementById('runTagsSaveDefault').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(ctx.puts.at(-1)?.tags?.slice().sort(), ['cc:4420', 'client:acme']);
  await submit(ctx);
  assert.equal(ctx.doc.querySelector('#runTagDimsField .tag-dim-input').value, '4420', 'the saved default comes back in its slot');
  assert.deepEqual(formChips(ctx.doc), ['client:acme']);
});

test('A workspace run with no workspace picked shows no slots, even when a project configures dimensions', async () => {
  const ctx = await bootForm({ dims: (q) => (q.get('projectDir') ? { source: 'policy', home: 'acme/web', dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] } : { dims: [{ key: 'cc', label: 'Cost centre', values: [], required: true }] }) });
  flagsOn(ctx.window);
  assert.equal(ctx.doc.querySelectorAll('.tag-dim-slot').length, 1, 'the project target has its slot');
  ctx.doc.querySelector('#target-seg button[data-target="workspace"]').click();
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(ctx.doc.querySelectorAll('.tag-dim-slot').length, 0);
});

test('New run (#923): the field starts from the project\'s defaults, and a start does not carry its own tags into the next run', async () => {
  const dims = { dims: [{ key: 'client', label: 'Client', values: [], required: true }, { key: 'cc', label: 'Cost centre', values: [], required: false }],
    enforce: false, prefill: ['client:acme'], autofill: { tags: ['client:acme', 'team:ops'], from: 'defaults' } };
  const ctx = await bootForm({ tagsFor: () => ['team:ops'], dims: () => dims });
  flagsOn(ctx.window);
  const slot = (key) => ctx.doc.querySelector(`#runTagDimsField .tag-dim-slot[data-key="${key}"] .tag-dim-input`);
  assert.deepEqual(formChips(ctx.doc), ['team:ops']);
  assert.equal(slot('client').value, 'acme');
  const input = ctx.doc.querySelector('#runTagsField .tag-input-text');
  input.value = 'project:redesign';
  input.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  for (const [key, v] of [['client', 'initech'], ['cc', '4410']]) { slot(key).value = v; slot(key).dispatchEvent(new ctx.window.Event('input')); }
  assert.deepEqual((await submit(ctx)).tags, ['cc:4410', 'client:initech', 'project:redesign', 'team:ops']);
  assert.deepEqual(formChips(ctx.doc), ['team:ops'], 'the run just started is not copied: the defaults come back');
  assert.equal(slot('client').value, 'initech', 'a mandatory slot keeps the value just used');
  assert.equal(slot('cc').value, '', 'an optional slot is not copied');
});

test('New run: a value typed into a slot survives switching the project away and back (no auto-fill overwrites it)', async () => {
  const ctx = await bootForm({ dims: (q) => ({ dims: [{ key: 'client', label: 'Client', values: [], required: true }], enforce: false,
    prefill: q.get('projectDir') === '/a/web' ? ['client:acme'] : ['client:globex'], autofill: { tags: [], from: null } }) });
  flagsOn(ctx.window);
  const slot = () => ctx.doc.querySelector('#runTagDimsField .tag-dim-input');
  assert.equal(slot().value, 'acme');
  slot().value = 'initech'; slot().dispatchEvent(new ctx.window.Event('input'));
  const pick = async (i) => {
    const sel = ctx.doc.getElementById('projectSelect');
    sel.selectedIndex = i; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    for (let n = 0; n < 12; n++) await tick();
  };
  const web = ctx.doc.getElementById('projectSelect').selectedIndex;
  await pick([...ctx.doc.getElementById('projectSelect').options].findIndex((o) => o.textContent.includes('api')));
  assert.equal(slot().value, 'initech');
  await pick(web);
  assert.equal(slot().value, 'initech', 'the typed value is kept after the round trip');
});

test('New run: a cleared slot stays empty after a round trip, and an untouched pre-filled slot does not cross projects', async () => {
  const ctx = await bootForm({ dims: (q) => ({ dims: [{ key: 'client', label: 'Client', values: [], required: true }, { key: 'cc', label: 'Cost centre', values: [], required: false }],
    enforce: false, prefill: q.get('projectDir') === '/a/web' ? ['cc:4410', 'client:acme'] : ['client:globex'], autofill: { tags: [], from: null } }) });
  flagsOn(ctx.window);
  const slot = (key) => ctx.doc.querySelector(`#runTagDimsField .tag-dim-slot[data-key="${key}"] .tag-dim-input`);
  const pick = async (i) => {
    const sel = ctx.doc.getElementById('projectSelect');
    sel.selectedIndex = i; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    for (let n = 0; n < 12; n++) await tick();
  };
  const opts = () => [...ctx.doc.getElementById('projectSelect').options];
  const web = ctx.doc.getElementById('projectSelect').selectedIndex;
  const api = opts().findIndex((o) => o.textContent.includes('api'));
  assert.equal(slot('cc').value, '4410');
  slot('client').value = ''; slot('client').dispatchEvent(new ctx.window.Event('input'));
  await pick(api);
  assert.equal(slot('client').value, '', 'the cleared slot is not refilled by the next project');
  assert.equal(slot('cc').value, '', 'the untouched pre-filled cc does not cross into a project that has none');
  await pick(web);
  assert.equal(slot('client').value, '', 'the cleared slot is still empty after the round trip');
  assert.equal(slot('cc').value, '4410', 'the untouched slot takes this project\'s fill again');
});
