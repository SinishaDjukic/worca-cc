// test/ui-run-rerun-form.test.mjs — Rerun in the app (docs/runs.md): ⋯ › Rerun on a saved run opens the New run form filled
// from the earlier run (a fetch spy sees GETs only), every field edits normally, no presetId rides along, a broken
// setting blocks Start until reset, a missing file is named without blocking it, and a plain New run afterwards carries
// no rerunOf. Booted through the History detail page, as a person reaches it. Heavy on purpose: it needs the real form.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { ROW, DETAIL, openDetail, click, settle, go, ok, fail, detailOn, historyFetch } from './helpers/history-detail-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: historyFetch() });
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

test('⋯ lists Rerun right after Save as preset on a saved run', async () => {
  const ctx = await bootRerun();
  const labels = openMenu(ctx).map(labelOf);
  assert.equal(labels[labels.indexOf('Save as preset') + 1], 'Rerun', labels.join(', '));
  assert.ok(labels.indexOf('Rerun') < labels.indexOf('Terminal'));
  assert.deepEqual(labels.slice(-2), ['Report this run', 'Archive']);
});

test('a paused run: Rerun is greyed with its visible hint and tooltip, and clicking it does nothing', async () => {
  const ctx = await bootRerun({ status: 'paused' });
  const item = openMenu(ctx).find((b) => labelOf(b) === 'Rerun');
  assert.equal(item.disabled, true);
  assert.equal(item.querySelector('.wfv-menu-hint').textContent, 'after it ends');
  assert.match(item.title, /Rerun is available once the run has ended\. Use Resume to continue it\./);
  click(ctx.window, item);
  await settle(ctx.window, 4);
  assert.deepEqual(ctx.box.gets, []);
  assert.notEqual(ctx.window.location.hash, '#new');
});

test('prefills the form from the earlier run, makes no POST, and attaches the files', async () => {
  const ctx = await bootRerun();
  await chooseRerun(ctx);
  const d = doc(ctx);
  assert.equal(d.querySelector('#prompt').value, 'Fix the log UX.');
  assert.equal(d.querySelector('#title').value, 'Log UX');
  assert.equal(d.querySelector('#projectSelect').value, '/tmp/proj');
  assert.equal(d.querySelector('#workflowSelect').value, 'wf_default');
  assert.equal(d.querySelector('#guardrailsSelect').value, 'normal');
  assert.equal(d.querySelector('#mock').checked, true);
  assert.equal(d.querySelector('#nightMode').checked, true);
  assert.match(d.querySelector('#extrasPills').textContent, /spec\.md/);
  assert.equal(d.querySelector('#extrasPills').hidden, false);
  assert.equal(d.querySelector('.agent-row[data-node-id="n_plan"] .step-model').value, 'claude-haiku-4-5', 'the earlier run\'s Planner pick shows');
  assert.equal(d.querySelector('#preset-btn').classList.contains('is-on'), false, 'no preset chip');
  assert.equal(d.querySelector('#rerun-notes').hidden, true);
  assert.deepEqual(ctx.box.posts, [], 'R-po-5/I1: opening the form creates nothing');
});

test('submit sends rerunOf and the run-only lane, never a presetId; an edited field goes through', async () => {
  const ctx = await bootRerun();
  await chooseRerun(ctx);
  const d = doc(ctx);
  d.querySelector('#prompt').value = 'Fix the log UX, then the docs.';
  d.querySelector('#mock').checked = false;
  const body = await submit(ctx);
  assert.equal(body.rerunOf, ID);
  assert.equal(body.presetId, undefined);
  assert.equal(body.prompt, 'Fix the log UX, then the docs.');
  assert.equal(body.mock, false);
  assert.equal(body.overlay.nodes.n_plan.model, 'claude-haiku-4-5');
  assert.deepEqual(body.extras.map((e) => e.name), ['spec.md']);
  assert.equal(Buffer.from(body.extras[0].dataBase64, 'base64').toString(), 'hello');
});

test('a source gone at Start keeps the form; the next Start is a plain run with the same picks', async () => {
  const ctx = await bootRerun();
  await chooseRerun(ctx);
  ctx.box.runReplies = [fail(400, { error: 'rerun-source-not-found', message: 'The run this was copied from is gone; start it as a new run.' })];
  const first = await submit(ctx);
  assert.equal(first.rerunOf, ID);
  assert.equal(ctx.window.location.hash, '#new', 'the refused start stays on the form');
  assert.match(doc(ctx).body.textContent, /Press Start again to start it as a new run/);
  const again = await submit(ctx);
  assert.equal(again.rerunOf, undefined, 'the link is dropped, nothing else');
  assert.equal(again.prompt, 'Fix the log UX.');
  assert.equal(again.overlay.nodes.n_plan.model, 'claude-haiku-4-5');
  assert.deepEqual(again.extras.map((e) => e.name), ['spec.md']);
});

test('a refusal that lands after another Rerun opened leaves the new form linked, and says what the server said', async () => {
  const ctx = await bootRerun();
  await chooseRerun(ctx);
  let answer;
  ctx.box.runReplies = [new Promise((r) => { answer = r; })];
  const first = await submit(ctx);
  assert.equal(first.rerunOf, ID);
  // While the start is in flight the person opens Rerun again: a new form, holding its own link.
  ctx.window.location.hash = `history/${ROW.projectKey}/${ID}`;
  await settle(ctx.window, 8);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  await chooseRerun(ctx);
  answer(fail(400, { error: 'rerun-source-not-found', message: 'The run this was copied from is gone; start it as a new run.' }));
  await settle(ctx.window, 8);
  assert.match(doc(ctx).body.textContent, /copied from is gone; start it as a new run/, 'the server\'s words, not the code');
  const again = await submit(ctx);
  assert.equal(again.rerunOf, ID, 'the form opened meanwhile keeps its link');
});

test('after leaving the form, a plain New run sends no rerunOf', async () => {
  const ctx = await bootRerun();
  await chooseRerun(ctx);
  ctx.window.location.hash = 'runs';
  await settle(ctx.window, 8);
  ctx.window.location.hash = 'new';
  await settle(ctx.window, 8);
  doc(ctx).querySelector('#prompt').value = 'something new';
  const body = await submit(ctx);
  assert.equal(body.rerunOf, undefined, 'I8');
  assert.equal(body.presetId, undefined);
  assert.equal(body.overlay, undefined);
});

test('a missing or unavailable file is named; Start stays enabled and the other files go along', async () => {
  const payload = { ...PAYLOAD(), extras: [{ name: 'spec.md', available: true }, { name: 'gone.md', available: false }, { name: 'lost.md', available: true }] };
  const ctx = await bootRerun({ payload, files: { 'spec.md': 'hello' } });   // lost.md answers 404
  await chooseRerun(ctx);
  const d = doc(ctx);
  const notes = d.querySelector('#rerun-notes');
  assert.equal(notes.hidden, false);
  assert.match(notes.textContent, /gone\.md, lost\.md/);
  assert.equal(d.querySelector('#start-btn').disabled, false);
  assert.deepEqual((await submit(ctx)).extras.map((e) => e.name), ['spec.md']);
});

test('a hostile file name reaches the page as text only', async () => {
  const name = '<img src=x onerror=alert(1)>.md';
  const ctx = await bootRerun({ payload: { ...PAYLOAD(), extras: [{ name, available: false }] } });
  await chooseRerun(ctx);
  const notes = doc(ctx).querySelector('#rerun-notes');
  assert.ok(notes.textContent.includes(name));
  assert.equal(notes.querySelector('img'), null);
});

test('an archived run whose files were never recorded says so; one with no recorded setup says defaults were used', async () => {
  const ctx = await bootRerun({ payload: { ...PAYLOAD(), setup: null, extras: [], extrasLost: true } });
  await chooseRerun(ctx);
  const text = doc(ctx).querySelector('#rerun-notes').textContent;
  assert.match(text, /removed when it was archived/);
  assert.match(text, /Settings of the earlier run were not recorded; defaults used\./);
  assert.equal(doc(ctx).querySelector('#prompt').value, 'Fix the log UX.');
});

test('a broken model blocks Start until Reset to default; the submitted overlay then lacks that node', async () => {
  const item = { item: 'model', ref: 'n_plan', message: 'Planner: model claude-haiku-4-5 is no longer in the catalog', reset: true };
  let reset = false;
  const payload = { ...PAYLOAD(), broken: [item] };
  const ctx = await bootRerun({ payload, check: () => ({ broken: reset ? [] : [item] }) });
  await chooseRerun(ctx);
  const d = doc(ctx);
  await waitFor(() => d.querySelectorAll('.preset-broken-row').length === 1);
  assert.match(d.querySelector('.preset-broken strong').textContent, /earlier run/);
  assert.equal(d.querySelector('#start-btn').disabled, true);
  assert.equal(d.querySelector('#start-btn').title, item.message);
  reset = true;
  d.querySelector('.preset-broken-row button').click();
  await waitFor(() => d.querySelectorAll('.preset-broken-row').length === 0);
  await waitFor(() => d.querySelector('#start-btn').disabled === false);
  const body = await submit(ctx);
  assert.equal(body.overlay?.nodes?.n_plan, undefined, 'R-po-6: the reset node is left for the project default');
  assert.equal(body.rerunOf, ID);
});

test('a project that is gone leaves the target empty and the card says so, with no reset', async () => {
  const gone = { item: 'project', ref: 'proj-alpha-abcd1234', message: 'Project proj-alpha-abcd1234 is no longer registered in worca', reset: false };
  const ctx = await bootRerun({ payload: { ...PAYLOAD(), target: { kind: 'project', ref: gone.ref, projectDir: null, workspaceId: null }, broken: [gone] } });
  await chooseRerun(ctx);
  const d = doc(ctx);
  assert.equal(d.querySelector('#projectSelect').value, '');
  assert.equal(d.querySelectorAll('.preset-broken-row button').length, 0);
  assert.match(d.querySelector('.preset-broken-row').textContent, /no longer registered/);
  assert.match(d.querySelector('.preset-broken-row .muted').textContent, /Pick another project/);
  assert.equal(d.querySelector('#start-btn').disabled, true);
});

test('a No-project run reopens on No project with no block, and a start keeps the link', async () => {
  const ctx = await bootRerun({ payload: { ...PAYLOAD(), setup: null, extras: [], target: { kind: 'none', ref: null, projectDir: null, workspaceId: null } } });
  await chooseRerun(ctx);
  const d = doc(ctx);
  assert.equal(d.querySelector('#target-seg [data-target="none"], [data-target="none"]').getAttribute('aria-pressed'), 'true');
  assert.equal(d.querySelectorAll('.preset-broken-row').length, 0);
  assert.equal(d.querySelector('#start-btn').disabled, false);
  const body = await submit(ctx);
  assert.equal(body.noProject, true);
  assert.equal(body.rerunOf, ID);
});

test('no recorded setup on a gone project: picking a project checks the target again and unblocks Start', async () => {
  const gone = { item: 'project', ref: 'proj-alpha-abcd1234', message: 'Project proj-alpha-abcd1234 is no longer registered in worca', reset: false };
  const checks = [];
  const ctx = await bootRerun({
    payload: { ...PAYLOAD(), setup: null, target: { kind: 'project', ref: gone.ref, projectDir: null, workspaceId: null }, broken: [gone] },
    check: (b) => { checks.push(b); return { broken: b.projectDir || b.noProject ? [] : [gone] }; },
  });
  await chooseRerun(ctx);
  const d = doc(ctx);
  assert.equal(d.querySelector('#start-btn').disabled, true);
  d.querySelector('#projectSelect').selectedIndex = 1;
  d.querySelector('#projectSelect').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => d.querySelector('#start-btn').disabled === false);
  assert.deepEqual(checks.at(-1), { projectDir: '/tmp/proj', targetOnly: true }, 'no recorded picks: only the target is judged');
  assert.equal(d.querySelector('#workflowSelect').value, 'wf_default');
  d.querySelector('#projectSelect').selectedIndex = 0;
  d.querySelector('#projectSelect').dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await waitFor(() => d.querySelector('#start-btn').disabled === true);
  click(ctx.window, d.querySelector('[data-target="none"]'));
  await waitFor(() => d.querySelector('#start-btn').disabled === false);
  assert.deepEqual(checks.at(-1), { noProject: true, targetOnly: true }, 'the No project target is judged with no project');
});

test('leaving the form while the rerun prefill loads holds no rerun: a later New run is not linked', async () => {
  const ctx = await bootRerun();
  const item = openMenu(ctx).find((b) => labelOf(b) === 'Rerun');
  click(ctx.window, item);
  await waitFor(() => ctx.window.location.hash === '#new');
  ctx.window.location.hash = 'runs';   // before the prefill has settled
  await settle(ctx.window, 16);
  ctx.window.location.hash = 'new';
  await settle(ctx.window, 8);
  doc(ctx).querySelector('#prompt').value = 'something else';
  const body = await submit(ctx);
  assert.equal(body.rerunOf, undefined);
  assert.equal(body.overlay, undefined);
});

test('when the earlier run cannot be loaded, a toast says so and nothing navigates', async () => {
  const ctx = await bootRerun({ rerunReply: fail(409, { error: 'run-not-ended', message: 'Rerun is available once the run has ended.' }) });
  const item = openMenu(ctx).find((b) => labelOf(b) === 'Rerun');
  click(ctx.window, item);
  await waitFor(() => doc(ctx).querySelector('#toasts .toast'));
  assert.match(doc(ctx).querySelector('#toasts .toast').textContent, /Couldn't load the earlier run/);
  assert.notEqual(ctx.window.location.hash, '#new');
});
