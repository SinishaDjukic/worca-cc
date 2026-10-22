// test/ui-new-run-no-project.test.mjs — P3: New run's Target segment gains No project (every level).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ projects = [], workflows = [{ id: 'wf_default', name: 'Default' }], runsRoot = '', runsRootDisplay, posted, local, seen } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  if (local) for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  window.fetch = (url, opts) => {
    const u = String(url);
    if (seen) seen.push(u);
    if (u.endsWith('/api/projects')) return json({ projects, runsRoot, runsRootDisplay: runsRootDisplay ?? runsRoot });
    if (u.endsWith('/api/workflows')) return json({ workflows });
    if (u.includes('/api/workspaces')) return json({ workspaces: [] });
    if (u.includes('/api/branches')) return json({ branches: [], current: '' });
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') {
      if (posted) posted.push(JSON.parse(opts.body));
      return json({ runId: 'run-1', pipelineId: 'abcd1234' });
    }
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return window;
}

test('no projects yet: New run opens on No project, shows where it works, and posts { noProject: true } with no branch keys', async () => {
  const posted = [];
  const window = await boot({ projects: [], runsRoot: '/h/.worca-cc/runs', runsRootDisplay: '~/.worca-cc/runs', workflows: [{ id: 'wf_default', name: 'Default', needsRepo: true }], posted });
  const doc = window.document;
  doc.documentElement.dataset.level = 'simple';
  await new Promise((r) => setTimeout(r, 0));
  const seg = [...doc.querySelectorAll('#target-seg button[data-target]')];
  assert.deepEqual(seg.map((b) => b.textContent), ['No project', 'Project', 'Workspace']);
  assert.equal(doc.querySelector('#target-seg [data-target="none"]').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById('target-field').hasAttribute('data-min-level'), false, 'every level');
  assert.equal(doc.querySelector('#target-seg [data-target="workspace"]').dataset.minLevel, 'advanced');
  assert.equal(doc.getElementById('noProjectWorkDir').value, '~/.worca-cc/runs/<new run>/work', 'the canvas words, home-relative (S22)');
  assert.equal(doc.getElementById('target-project-pane').classList.contains('hidden'), true);
  assert.equal(doc.getElementById('run-form').dataset.workMode, 'none');
  assert.equal(doc.getElementById('needsRepoNote').hidden, false);
  assert.equal(doc.getElementById('needsRepoNote').textContent, 'Some steps expect a code repository.');
  assert.equal(window.localStorage.getItem('worca-cc.runTarget'), null, 'the automatic default is not remembered');
  doc.getElementById('prompt').value = 'Make a hello page';
  doc.getElementById('featureBranch').value = 'feat/x';
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].noProject, true);
  for (const k of ['projectDir', 'workspaceId', 'sourceBranch', 'featureBranch', 'sameAsSource', 'syncBeforeStart', 'scheduledFor']) assert.equal(k in posted[0], false, k);
  assert.equal(doc.querySelector('.field-error'), null, 'no "Select a project first (or add one)."');
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.location.hash, '#running/run-1');
  // Before its first frame, the new run's page already knows it is a run without a project: no git tab or words (U17).
  const tabs = [...doc.querySelectorAll('#run-detail .rd-tab')].map((b) => b.dataset.sec);
  for (const k of ['diff', 'actions']) assert.equal(tabs.includes(k), false, `${k} in ${tabs.join(',')}`);
  assert.doesNotMatch(doc.getElementById('run-detail').textContent, /worktree/i);
});

test('the New run subtitle names where it runs, not a project (NewRun board)', async () => {
  const window = await boot({ projects: [] });
  assert.equal(window.document.querySelector('[data-view="new"] .topbar .sub').textContent,
    'Pick where it runs, describe the task, and run · agents come tuned: open one only to change it');
});

test('with projects: Project stays the default; picking No project hides branches and the schedule caret; back again restores them', async () => {
  const window = await boot({ projects: [{ name: 'svc', path: '/a/svc', exists: true, vcs: 'git', key: 'svc-00000001' }], runsRoot: '/h/.worca-cc/runs' });
  const doc = window.document;
  assert.equal(doc.querySelector('#target-seg [data-target="project"]').getAttribute('aria-pressed'), 'true');
  doc.querySelector('#target-seg [data-target="none"]').click();
  assert.equal(doc.getElementById('run-form').dataset.workMode, 'none');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');   // jsdom here loads no stylesheet
  assert.match(css, /#run-form\[data-work-mode="none"\] #start-more\{display:none!important;\}/);
  assert.equal(window.localStorage.getItem('worca-cc.runTarget'), 'none');
  assert.equal(doc.querySelector('#memory-scope-seg [data-scope="project"]').hidden, true, 'Memory defragment: global memory only (U13)');
  assert.equal(doc.querySelector('#workflowSelect option[value="wf_memory_defrag"]'), null, 'this boot lists no defragment row');
  doc.querySelector('#target-seg [data-target="project"]').click();
  assert.equal(doc.getElementById('run-form').dataset.workMode, undefined);
  assert.equal(doc.querySelector('#memory-scope-seg [data-scope="project"]').hidden, false);
});

test('a stored No project target restores with the work folder text', async () => {
  const window = await boot({ projects: [{ name: 'svc', path: '/a/svc', exists: true, vcs: 'git', key: 'svc-00000001' }], runsRoot: '/h/.worca-cc/runs', runsRootDisplay: '~/.worca-cc/runs', local: { 'worca-cc.runTarget': 'none' } });
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  assert.equal(doc.querySelector('#target-seg [data-target="none"]').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById('noProjectWorkDir').value, '~/.worca-cc/runs/<new run>/work');
});

const SVC = { name: 'svc', path: '/a/svc', exists: true, vcs: 'git', key: 'svc-00000001' };
const ticks = async (window, n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => window.setTimeout(r, 0)); };
const pressed = (doc) => doc.querySelector('#target-seg button[aria-pressed="true"]')?.dataset.target;

test('the automatic No project default gives way to the first project; a stored No project stays', async () => {
  const projects = [];
  let window = await boot({ projects, runsRoot: '/h/.worca-cc/runs' });
  await ticks(window);
  assert.equal(pressed(window.document), 'none');
  projects.push(SVC);
  window.location.hash = '#projects';            // the Projects page reloads the shared list (Add project lands there)
  await ticks(window);
  assert.equal(pressed(window.document), 'project', 'the first project replaces the automatic default');
  assert.equal(window.localStorage.getItem('worca-cc.runTarget'), null, 'still not remembered');

  const stored = [];
  window = await boot({ projects: stored, runsRoot: '/h/.worca-cc/runs', local: { 'worca-cc.runTarget': 'none' } });
  await ticks(window);
  stored.push(SVC);
  window.location.hash = '#projects';
  await ticks(window);
  assert.equal(pressed(window.document), 'none', 'the user\'s own choice is never changed');
});

test('the run guides never ring the hidden project select while No project is picked', async () => {
  const window = await boot({ projects: [SVC], local: { 'worca-cc.runTarget': 'none' } });
  await ticks(window);
  const ids = (step) => window.__np.gsHops(step, { passed: new Set() }).filter(Boolean).map((h) => h.id);
  assert.equal(ids('run').includes('project'), false);
  window.document.querySelector('#target-seg [data-target="project"]').click();
  assert.equal(ids('run').includes('project'), true, 'control: a Project target keeps the hop');
});

test('switching a picked project to No project reads nothing of that project', async () => {
  const seen = [];
  const window = await boot({ projects: [SVC], local: { 'worca-cc.lastProject': 'svc' }, seen });
  await ticks(window);
  const ofSvc = /projectDir=(%2F|\/)a(%2F|\/)svc/;
  assert.ok(seen.some((u) => ofSvc.test(u)), 'control: the picked project was read');
  const mark = seen.length;
  window.document.querySelector('#target-seg [data-target="none"]').click();
  await ticks(window);
  const after = seen.slice(mark);
  assert.equal(after.some((u) => ofSvc.test(u)), false, after.join('\n'));
});

test('Simple level keeps a stored Workspace target\'s own button on screen', async () => {
  const window = await boot({ projects: [SVC], local: { 'worca-cc.runTarget': 'workspace' } });
  await ticks(window);
  assert.equal(pressed(window.document), 'workspace');
  assert.equal(window.document.querySelector('#target-seg [data-target="workspace"]').dataset.levelKeep, '1');
});

test('"Open in New run" with No project keeps the handed-over workflow (the target switch\'s config reload lands first)', async () => {
  for (const workflowId of ['wf_review', 'wf_auto']) {
    const window = await boot({ projects: [SVC], workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review' }] });
    await ticks(window);
    window.__np.openNewPipeline({ target: 'none', workflowId, prompt: 'Make a hello page', title: 'Hello' });
    await ticks(window, 16);
    const doc = window.document;
    assert.equal(pressed(doc), 'none');
    assert.equal(doc.getElementById('workflowSelect').value, workflowId, workflowId);
    assert.equal(doc.getElementById('prompt').value, 'Make a hello page');
  }
});

test('"Open in New run" with No project turns a handed-over project memory scope into global', async () => {
  const posted = [];
  const window = await boot({ projects: [SVC], posted, workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_memory_defrag', name: 'Memory defragment' }] });
  await ticks(window);
  window.__np.openNewPipeline({ target: 'none', workflowId: 'wf_memory_defrag', prompt: 'Tidy memory', title: 'Tidy', memoryScope: 'project' });
  await ticks(window, 16);
  const doc = window.document;
  assert.equal(doc.getElementById('workflowSelect').value, 'wf_memory_defrag');
  assert.equal(doc.querySelector('#memory-scope-seg [data-scope="project"]').classList.contains('on'), false);
  assert.equal(doc.querySelector('#memory-scope-seg [data-scope="global"]').classList.contains('on'), true);
  doc.getElementById('run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await ticks(window);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].noProject, true);
  assert.equal(posted[0].memoryScope, 'global', 'never { noProject, memoryScope: "project" } (the server answers 400)');
});

test('Schedules › Schedule a run on a stored No project target switches New run to Project (L7)', async () => {
  const window = await boot({ projects: [SVC], local: { 'worca-cc.runTarget': 'none' } });
  await ticks(window);
  window.location.hash = '#new/schedule';
  await ticks(window);
  assert.equal(pressed(window.document), 'project');
  assert.equal(window.localStorage.getItem('worca-cc.runTarget'), 'none', 'the stored choice stays the user\'s');
});
