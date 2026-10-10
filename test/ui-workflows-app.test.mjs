// test/ui-workflows-app.test.mjs — the Workflows view's app.js integration.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const AGENTS = [
  { key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1, metaVersion: 2, fanOut: true, asksQuestions: true,
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  // `verdict` is required by V13 for any `when: blocking|clean` output — without
  // it every graph carrying this agent is permanently invalid and Save never enables.
  { key: 'reviewer', displayName: 'Review', domain: 'coding', color: 'blue', order: 4, metaVersion: 2, asksQuestions: true,
    verdict: { filename: 'review-cycle{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  { key: 'docsWriter', displayName: 'Docs Writer', description: 'Writes docs.', origin: 'user', domain: 'general', color: 'green', metaVersion: 2, inputs: [{ id: 'plan', type: 'md', required: true }], outputs: [{ id: 'docs', type: 'md', when: 'always', filename: 'docs.md' }] },
];
const SCRIPTS = [{ key: 'shell', metaVersion: 2, displayName: 'Shell', origin: 'builtin', runtime: 'shell', color: 'amber', order: 10, ports: 'config',
  verdict: { filename: 'shell-cycle{cycle}.json' },
  defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }] },
  params: [{ id: 'command', type: 'command', label: 'Command', required: true }] },
  { key: 'gitDiff', metaVersion: 2, displayName: 'Git diff', origin: 'builtin', runtime: 'node', color: 'teal', order: 20, file: 'gitDiff.mjs', inputs: [{ id: 'done', type: 'void', required: false }], outputs: [{ id: 'diff', type: 'md', when: 'always', filename: 'diff.md' }] }];
const V2_ROW = { id: 'wf_g', name: 'Graph one', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };
const V1_ROW = { id: 'wf_old', name: 'Legacy one', version: 1, domain: 'coding', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] };

const DEFAULT_ROW = { id: 'wf_default', name: 'Default', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };

const DOCS = AGENTS.find((a) => a.key === 'docsWriter');
const GITDIFF = SCRIPTS.find((s) => s.key === 'gitDiff');
const tick = async (n = 1) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
async function go(w, h) { w.location.hash = h; w.dispatchEvent(new w.Event('hashchange')); for (let i = 0; i < 6; i += 1) await tick(); }

async function boot({ agentsFail = false, workflows = null, del = null } = {}) {
  const rows = workflows || [DEFAULT_ROW, V2_ROW, V1_ROW];
  const deletes = [];
  const importBodies = [];
  const requests = [];
  let agentList = AGENTS;
  let agentsDown = agentsFail;
  let agentFetches = 0;
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  let lastWs = null;
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; lastWs = this; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  const json = (v, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v });
  window.fetch = (u, init) => {
    const url = String(u);
    const method = (init && init.method) || 'GET';
    requests.push({ method, url, body: init && init.body });
    const path = url.split('?')[0];
    if (path.endsWith('/api/agents/docsWriter') && method === 'GET') return json({ meta: DOCS, markdown: '# Docs' });
    if (path.endsWith('/api/agents/docsWriter') && method === 'PUT') return json({ meta: DOCS, markdown: '# Docs', warnings: [], updatedVariants: [] });
    if (path.endsWith('/api/agents/docsWriter') && method === 'DELETE') return json({ ok: true });
    if (path.endsWith('/api/scripts/runtimes')) return json({ node: { ok: true }, shell: { ok: true }, python: { ok: true } });
    if (path.endsWith('/api/scripts/gitDiff/duplicate') && method === 'POST') return json({ meta: { ...GITDIFF, key: 'gitDiffCopy', origin: 'user' } }, 201);
    const sk = path.match(/\/api\/scripts\/([^/]+)(\/.*)?$/);
    if (sk && method === 'GET' && sk[1] !== 'bench') {
      const meta = SCRIPTS.find((x) => x.key === decodeURIComponent(sk[1]));
      if (!meta) return json({ error: 'not found' }, 404);
      if (sk[2] === '/cases') return json({ cases: [], userCases: [], casesWritable: true });
      return json({ meta, source: '// x\n', sourceWin32: '', sourcePath: '/x/' + meta.key, sourceTruncated: false, cases: [], userCases: [], casesWritable: true });
    }
    if (path.endsWith('/api/ask/models')) return json({ default: { model: 'claude-opus-5-5', effort: 'high' }, models: [] });
    if (path.endsWith('/api/ask/threads') && method === 'POST') return json({ thread: { id: 'ask_0000abcd', mode: 'composer', title: null } }, 201);
    if (/\/api\/ask\/threads\/[^/]+\/messages$/.test(path) && method === 'POST') return json({ userMessageId: 'askm_0000aaaa', assistantMessageId: 'askm_0000bbbb' }, 202);
    if (/\/api\/ask\/threads\/[^/]+\/cards\/[^/]+$/.test(path) && method === 'POST') return json({ block: {} });
    if (path.endsWith('/api/projects')) return json({ projects: [] });
    if (url.includes('/api/workflows/import-json')) {
      const body = JSON.parse(init.body);
      const src = body.workflow;
      const scriptNodes = (src.nodes || []).filter((n) => n.kind === 'script' && n.config && n.config.params && n.config.params.command)
        .map((n) => ({ nodeId: n.id, key: n.key, displayName: 'Shell', runtime: 'shell', params: { command: n.config.params.command } }));
      importBodies.push(body);
      if (body.dryRun) return json({ scriptNodes, warnings: [], requestedName: src.name });
      if (scriptNodes.length && body.acceptScripts !== true) return json({ error: 'this workflow runs commands on this machine', code: 'SCRIPTS_UNCONFIRMED', scriptNodes }, 409);
      const row = { ...src, id: `wf_${String(src.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, origin: null };
      rows.push(row);
      return json({ workflow: row, renamed: false, requestedName: src.name, warnings: [], scriptNodes }, 201);
    }
    if (init && init.method === 'DELETE') {
      deletes.push(url);
      if (del) return json(del.body, del.status);
      const id = decodeURIComponent(url.replace(/^.*\/api\/workflows\//, ''));
      const at = rows.findIndex((w) => w.id === id);
      if (at >= 0) rows.splice(at, 1);
      return json({ ok: true });
    }
    if (url.includes('/api/scripts')) return json({ scripts: SCRIPTS });
    if (url.includes('/api/agents')) {
      agentFetches += 1;
      return agentsDown ? Promise.reject(new Error('down')) : json({ agents: agentList });
    }
    if (url.includes('/api/workflows?archived=1')) return json({ workflows: [] });
    const one = url.match(/\/api\/workflows\/([^?]+)/);
    if (one) {
      const row = rows.find((w) => w.id === decodeURIComponent(one[1]));
      return row ? json(row) : json({ error: 'workflow not found' }, 404);
    }
    if (url.includes('/api/workflows')) return json({ workflows: rows });
    if (url.includes('/api/config')) return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
    return json({ projects: [], runs: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  lastWs?._l.open?.forEach((fn) => fn());
  for (let i = 0; i < 6; i += 1) await tick();
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  window.__deletes = deletes;
  window.__rows = rows;
  window.__importBodies = importBodies;
  window.__setAgents = (list) => { agentList = list; };
  window.__failAgents = (v) => { agentsDown = v; };
  window.__agentFetches = () => agentFetches;
  window.__resetAgentFetches = () => { agentFetches = 0; };
  return { window, requests, recv };
}

// -------------------------------------------------------------------- MAJ-16
// gvAgents/gvAgentsAll/gvPortsFn are written ONLY by gvLoadAgents(). An agent or script write
// marks them dirty: the OPEN view reloads at once (invalidateAgentCaches, the scripts-changed
// frame), any other page reloads on its next entry into #workflows — never on a clean re-entry.
// (Ported from ui-composer-app.test.mjs: the composer once kept a stale registry all session.)
const TESTER = { key: 'tester', displayName: 'Test', domain: 'coding', color: 'green', order: 9, metaVersion: 2,
  inputs: [{ id: 'done', type: 'md', required: true }],
  outputs: [{ id: 'report', type: 'md', when: 'always' }] };
const reenterView = async (win) => {
  win.location.hash = 'running'; win.dispatchEvent(new win.Event('hashchange'));
  await tick();
  win.location.hash = 'workflows'; win.dispatchEvent(new win.Event('hashchange'));
  await tick(8);
};

test('MAJ-16: an agent mutation made off the view refreshes the Library and portsFn on re-entry', async () => {
  const { window: win } = await boot();
  await go(win, 'workflows');
  const doc = win.document;
  assert.ok(doc.querySelector('#wfv-library .wfl-item[data-item="agent:planner"]'), 'precondition: planner in the Library');
  assert.equal(doc.querySelector('#wfv-library .wfl-item[data-item="agent:tester"]'), null, 'precondition: no tester yet');
  assert.ok(win.__gv().v.ports({ id: 'n1', kind: 'agent', key: 'planner' }).inputs.some((p) => p.id === 'revise'),
    'precondition: planner has a revise input');

  await go(win, 'runs');                          // OFF the view: on it, invalidateAgentCaches reloads at once
  // The registry gains an agent AND planner loses a port…
  const planner2 = { ...AGENTS[0], inputs: [{ id: 'task', type: 'md', required: true }] };
  win.__setAgents([planner2, AGENTS[1], TESTER]);
  // …and a real agent mutation runs, which is what invalidates the caches.
  const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await p;

  // Nothing changes until the view is re-entered (it is not the live view).
  await reenterView(win);
  assert.ok(doc.querySelector('#wfv-library .wfl-item[data-item="agent:tester"]'), 'the new agent is in the Library');
  assert.equal(win.__gv().v.ports({ id: 'n1', kind: 'agent', key: 'planner' }).inputs.some((p2) => p2.id === 'revise'),
    false, 'portsFn no longer reports the deleted port');
  assert.equal(doc.querySelectorAll('#wfv-canvas .gv-stage').length, 1, 'still mounted exactly once');
});

test('MAJ-16: re-entry refetches the registry only after an invalidation, and a failed reload retries on the next re-entry', async () => {
  const { window: win } = await boot();
  await go(win, 'workflows');
  const mutate = async () => {
    const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
    await tick();
    win.document.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await p;
  };
  await checkRows([
    { name: 'MAJ-16: a mutation while the view is open reloads at once; off the view it waits for the re-entry, once', run: async () => {
      win.__resetAgentFetches();
      await reenterView(win);
      assert.equal(win.__agentFetches(), 0, 'a clean re-entry refetches nothing');
      win.__resetAgentFetches();
      await mutate();                                   // ON the view: invalidateAgentCaches reloads now
      for (let i = 0; i < 4; i += 1) await tick();
      assert.ok(win.__agentFetches() > 0, 'the open view reloads at once');
      await go(win, 'runs');
      await mutate();                                   // OFF the view: only marks the registry dirty
      win.__resetAgentFetches();
      await go(win, 'workflows');
      assert.ok(win.__agentFetches() > 0, 'the invalidated view reloads on re-entry');
      win.__resetAgentFetches();
      await reenterView(win);
      assert.equal(win.__agentFetches(), 0, 'and not again on the next re-entry');
    } },
    { name: 'MAJ-16: a FAILED reload leaves the view dirty so the next re-entry retries', run: async () => {
      const doc = win.document;
      win.__setAgents([...AGENTS, TESTER]);
      await go(win, 'runs');
      await mutate();
      win.__failAgents(true);
      await go(win, 'workflows');
      assert.match(doc.querySelector('#wfv-library').textContent, /Couldn.t load agents/, 'the reload failed');
      win.__failAgents(false);
      await reenterView(win);
      assert.ok(doc.querySelector('#wfv-library .wfl-item[data-item="agent:tester"]'), 'the retry lands on the next re-entry');
    } },
  ]);
});

test('importing a workflow with script commands shows them first; Cancel and Close import nothing, Import sends acceptScripts', async () => {
  const { window: win } = await boot();
  await go(win, 'workflows');
  const doc = win.document;
  const tick = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const withShell = { ...V2_ROW, id: undefined, name: 'Shelly', nodes: [...V2_ROW.nodes, { id: 'n_sh', kind: 'script', key: 'shell', x: 500, y: 300, config: { params: { command: 'rm -rf build && npm test' } } }] };
  const n0 = win.__rows.length;
  const p1 = win.__gvImport(withShell);
  await tick();
  const modal = doc.getElementById('plugin-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'the dialog opened');
  assert.equal(doc.getElementById('plugin-modal-title').textContent, 'Import this workflow?');
  assert.match(modal.textContent, /These commands run on this machine with worca's privileges when the workflow runs\./);
  assert.match(modal.querySelector('.gv-import-script-h').textContent, /^Shell \(n_sh, shell\) · command$/);
  assert.equal(modal.querySelector('pre.gv-import-script-v').textContent, 'rm -rf build && npm test');
  assert.deepEqual([...modal.querySelectorAll('#plugin-modal-actions button')].map((b) => b.textContent), ['Cancel', 'Import']);
  modal.querySelector('#plugin-modal-actions button').click();
  assert.equal(await p1, false);
  assert.equal(win.__rows.length, n0, 'Cancel imported nothing');
  assert.equal(modal.classList.contains('hidden'), true);
  // The modal's own Close button settles the confirmation too (no promise left hanging).
  const pClose = win.__gvImport(withShell);
  await tick();
  doc.getElementById('plugin-modal-close').click();
  assert.equal(await pClose, false);
  assert.equal(win.__rows.length, n0);
  const p2 = win.__gvImport(withShell);
  await tick();
  [...doc.querySelectorAll('#plugin-modal-actions button')].find((b) => b.textContent === 'Import').click();
  assert.equal(await p2, true);
  assert.equal(win.__rows.length, n0 + 1);
  assert.equal(win.__importBodies.at(-1).acceptScripts, true, 'the confirmed import carries the confirmation');
  assert.match(lastToast(doc).title, /Imported "Shelly"/);
  const plain = win.__gvImport({ ...V2_ROW, id: undefined, name: 'Plain' });
  await tick();
  assert.equal(doc.getElementById('plugin-modal').classList.contains('hidden'), true, 'no scripts: no dialog');
  assert.equal(await plain, true);
  assert.equal('acceptScripts' in win.__importBodies.at(-1), false, 'a plain import confirms nothing');
});

test('MAJ-16: after a registry reload the OPEN canvas is re-validated against the new ports', async () => {
  const { window: win } = await boot();
  await go(win, 'workflows');
  const doc = win.document;
  win.__gv().c.loadTemplate({ id: 'wf_loop', name: 'Loop', version: 2, domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
      { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' } },
      { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] });
  await tick(); await tick();
  assert.equal(doc.getElementById('wfv-errors').hidden, true, 'precondition: the loop graph is clean');
  const planner2 = { ...AGENTS[0], inputs: [{ id: 'task', type: 'md', required: true }] };
  win.__setAgents([planner2, AGENTS[1], DOCS]);
  const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await p;
  for (let i = 0; i < 6; i += 1) await tick();
  assert.equal(doc.getElementById('wfv-errors').hidden, false, 'the wire into the deleted port is flagged after the reload');
  assert.equal(doc.getElementById('wfv-save').disabled, true, 'Save is disabled instead of 422ing later');
});

test('#workflows mounts once: Task + End on the canvas, body.view-workflows, Library open with three tabs', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  assert.ok(doc.body.classList.contains('view-workflows'));
  assert.equal(doc.querySelectorAll('#wfv-canvas .gv-world .node').length, 2);
  assert.deepEqual([...doc.querySelectorAll('#wfv-library [role="tab"]')].map((t) => t.dataset.tab), ['agents', 'scripts', 'workflows']);
  assert.equal(typeof w.__gv, 'function');
});

test('old addresses land in the view: #composer, #agents[/<key>/edit], #scripts/<key>[/test], #scripts/new/<rt>, #agent-create', async () => {
  const { window: w } = await boot();
  for (const [from, to] of [['composer', '#workflows'], ['agents', '#workflows/agents'], ['scripts/gitDiff', '#workflows/scripts/gitDiff'], ['agent-create', '#workflows/agents/new'],
    ['agents/docsWriter/edit', '#workflows/agents/docsWriter/edit'], ['scripts/new/node', '#workflows/scripts/new/node'], ['scripts/gitDiff/test', '#workflows/scripts/gitDiff/test']]) {
    await go(w, from);
    assert.equal(w.location.hash, to, from);
  }
});

test('#workflows/agents/new opens the agent wizard in the sheet; Cancel closes it back to #workflows', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/agents/new');
  const doc = w.document;
  assert.equal(doc.getElementById('wfv-sheet').hidden, false);
  assert.equal(doc.querySelector('.wfv-pane[data-pane="agent-new"]').hidden, false);
  assert.equal(doc.getElementById('wfv-sheet-title').textContent, 'New agent');
  doc.getElementById('agw-close').click();
  await tick(); await tick();
  assert.equal(w.location.hash, '#workflows');
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
});

test('#workflows/scripts/new mounts the Scripts controller in the sheet; its own navigation stays in the view', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/scripts/new');
  const doc = w.document;
  assert.equal(doc.querySelector('.wfv-pane[data-pane="script"]').hidden, false);
  assert.ok(doc.querySelector('#scripts-host .wz-step-1'));
  doc.querySelector('#scripts-host .wz-cancel').click();
  await tick(); await tick();
  assert.equal(w.location.hash, '#workflows/scripts');
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
});

test('Back returns to the page the user came from; leaving suspends the canvas keyboard', async () => {
  const { window: w } = await boot();
  await go(w, 'runs');
  await go(w, 'workflows');
  w.document.getElementById('wfv-back').click();
  await tick(); await tick();
  assert.equal(w.location.hash, '#runs');
  const c = w.__gv().c;
  const n = c.template().nodes[0];
  c.select({ kind: 'node', id: n.id });
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  assert.equal(c.template().nodes.length, 2, 'no graph edit from another view');
});

test('leaving the view closes an open save dialog: a modal left open in the hidden view would keep every other page inert', async () => {
  const { window: w } = await boot();
  await go(w, 'runs');
  await go(w, 'workflows');
  w.__gv().c.openSaveDialog();
  assert.ok(w.document.querySelector('#wfv-dialog-host dialog[open]'));
  await go(w, 'runs');                                                  // browser Back / a typed address: the Back button is inert under the modal
  assert.equal(w.document.querySelector('#wfv-dialog-host dialog[open]'), null);
});

test('#workflows/wf_default opens the built-in and normalises the hash to #workflows', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/wf_default');
  await tick(); await tick();
  assert.equal(w.location.hash, '#workflows');
  assert.equal(w.document.getElementById('wfv-name').value, 'Default');
});

test('#workflows/wfp_<plugin>_<slug> opens a plugin workflow', async () => {
  const PLUGIN_ROW = { ...DEFAULT_ROW, id: 'wfp_demo_quick', name: 'Quick', origin: 'plugin:demo' };
  const { window: w } = await boot({ workflows: [DEFAULT_ROW, PLUGIN_ROW] });
  await go(w, 'workflows/wfp_demo_quick');
  await tick(); await tick();
  assert.equal(w.location.hash, '#workflows');
  assert.equal(w.document.getElementById('wfv-name').value, 'Quick');
});

test('#workflows/<id> of no saved workflow: one error toast, the hash normalised, the canvas untouched', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const c = w.__gv().c;
  const before = JSON.stringify(c.template());
  await go(w, 'workflows/wf_gone');
  await tick(2);
  assert.equal(w.location.hash, '#workflows');
  const said = [...w.document.querySelectorAll('#toasts > .toast')].filter((t) => t.textContent.includes('wf_gone'));
  assert.equal(said.length, 1, 'said once');
  assert.equal(lastToast(w.document).tone, 'err');
  assert.match(lastToast(w.document).title, /^Could not open workflow "wf_gone"/);
  assert.equal(JSON.stringify(c.template()), before, 'the canvas is unchanged');
});

test('an in-view hop (a Library tab, back to the bare canvas) only routes: it fetches nothing', async () => {
  const { window: w, requests } = await boot();
  await go(w, 'workflows');
  const n0 = requests.length;
  await go(w, 'workflows/agents');
  await go(w, 'workflows/scripts');
  await go(w, 'workflows');
  assert.deepEqual(requests.slice(n0).filter((r) => /\/api\/(workflows|agents|scripts|config)\b/.test(r.url)).map((r) => `${r.method} ${r.url}`), []);
  assert.equal(w.__wfv.library().tab(), 'scripts', 'the hops still routed');
});

test('#workflows/<id> opens any id the server keeps; a head that is no id says so, never nothing', async () => {
  const LONG = `wf_${'a'.repeat(170)}`;              // a minted wf_<slug> has no length cap
  const rows = [DEFAULT_ROW, { ...V2_ROW, id: 'myflow', name: 'Mine' }, { ...V2_ROW, id: LONG, name: 'Long one' }];
  await checkRows([
    { name: 'an id with no wf_ prefix (kept from a POST /api/workflows body) opens', run: async () => {
      const { window: w } = await boot({ workflows: rows });
      await go(w, 'workflows/myflow');
      await tick(2);
      assert.equal(w.location.hash, '#workflows');
      assert.equal(w.document.getElementById('wfv-name').value, 'Mine');
    } },
    { name: 'a minted id past 160 characters opens', run: async () => {
      const { window: w } = await boot({ workflows: rows });
      await go(w, `workflows/${LONG}`);
      await tick(2);
      assert.equal(w.location.hash, '#workflows');
      assert.equal(w.document.getElementById('wfv-name').value, 'Long one');
    } },
    { name: 'a head that cannot be a workflow id: one error toast, the hash normalised, the canvas untouched', run: async () => {
      const { window: w } = await boot();
      await go(w, 'workflows');
      const c = w.__gv().c;
      const before = JSON.stringify(c.template());
      await go(w, 'workflows/no such!');
      await tick(2);
      assert.equal(w.location.hash, '#workflows');
      const said = [...w.document.querySelectorAll('#toasts > .toast')].filter((t) => t.textContent.includes('no%20such!'));
      assert.equal(said.length, 1, 'said once');
      assert.equal(lastToast(w.document).tone, 'err');
      assert.match(lastToast(w.document).title, /^Could not open "no%20such!"/);
      assert.equal(JSON.stringify(c.template()), before, 'the canvas is unchanged');
    } },
  ]);
});

test('#workflows/agents/<unknown key> (Back after a Delete, an old #agents/<key>): a toast, then the Library — no empty sheet over an inert view', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  await w.__wfv.routeWorkflows('agents/nobody');     // ONE route, as a browser's one hashchange makes (go() routes twice)
  await tick(4);
  assert.equal(w.location.hash, '#workflows/agents');
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'the sheet closed');
  for (const id of ['wfv-stage', 'wfv-library']) assert.equal(doc.getElementById(id).hasAttribute('inert'), false, `${id} back in reach`);
  assert.equal(w.__wfv.library().tab(), 'agents');
  assert.equal(lastToast(doc).tone, 'err');
  assert.match(lastToast(doc).title, /^No agent "nobody"/);
  assert.equal(doc.activeElement.id, 'wfv-lib-toggle', 'focus is never left on <body>');
  await go(w, 'agents/gone');                        // an old address lands the same way
  assert.equal(w.location.hash, '#workflows/agents');
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
  assert.match(lastToast(doc).title, /^No agent "gone"/);
});

test('#agent-create/<x> (an old address with a tail) opens the agent wizard, never an agent called "new"', async () => {
  const { window: w } = await boot();
  await go(w, 'agent-create/x');
  const doc = w.document;
  assert.equal(w.location.hash, '#workflows/agents/new/x');
  assert.equal(doc.querySelector('.wfv-pane[data-pane="agent-new"]').hidden, false);
  assert.equal(doc.getElementById('wfv-sheet-title').textContent, 'New agent');
});

test('Escape or × on an agent editor with unsaved changes asks first: Cancel keeps the sheet, the edit and the caret; Discard closes', async () => {
  const { window: w } = await boot();
  const doc = w.document;
  const esc = () => doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const asking = () => !doc.getElementById('confirm-modal').classList.contains('hidden');
  await go(w, 'workflows/agents/planner');            // a View sheet: nothing to lose, Escape closes at once
  doc.getElementById('wfv-sheet-close').focus();
  esc();
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'an untouched View sheet closes on Escape');
  await go(w, 'workflows/agents/docsWriter/edit');
  await tick(4);
  doc.querySelector('#agents-list .agent-f-desc').focus();
  esc();
  await tick(6);
  assert.equal(asking(), false);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'an untouched editor closes on Escape');
  await go(w, 'workflows/agents/docsWriter/edit');
  await tick(4);
  const field = doc.querySelector('#agents-list .agent-f-desc');
  field.focus();
  field.value = 'Writes better docs.';
  field.dispatchEvent(new w.Event('input', { bubbles: true }));
  esc();
  await tick(4);
  assert.equal(asking(), true, 'Escape asks first (the same Escape never answers the confirm it opened)');
  assert.equal(doc.getElementById('confirm-title').textContent, 'Discard changes');
  assert.match(doc.getElementById('confirm-message').textContent, /^This agent has unsaved changes\./);
  doc.getElementById('confirm-cancel').click();
  await tick(4);
  assert.equal(doc.getElementById('wfv-sheet').hidden, false, 'Cancel keeps the sheet');
  assert.equal(w.location.hash, '#workflows/agents/docsWriter/edit');
  assert.equal(doc.querySelector('#agents-list .agent-f-desc').value, 'Writes better docs.', '… and the edit');
  assert.equal(doc.activeElement, field, '… and the caret');
  field.value = 'Writes docs.';                      // typed back: now only the system prompt differs
  const md = doc.querySelector('#agents-list .agent-f-md');
  md.value += '\nAlways cite sources.';
  md.dispatchEvent(new w.Event('input', { bubbles: true }));
  md.focus();
  esc();
  await tick(4);
  assert.equal(asking(), true, 'an edited system prompt counts');
  doc.getElementById('confirm-cancel').click();
  await tick(4);
  md.value = md.value.replace('\nAlways cite sources.', '');   // back again: only the Fan-out box differs
  const fanOut = doc.querySelector('#agents-list .agent-f-fanout');
  fanOut.checked = !fanOut.checked;
  fanOut.dispatchEvent(new w.Event('change', { bubbles: true }));
  doc.getElementById('wfv-sheet-close').click();
  await tick(4);
  assert.equal(asking(), true, '× asks too');
  doc.getElementById('confirm-ok').click();
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'Discard closes the sheet');
  assert.equal(w.location.hash, '#workflows');
  await go(w, 'workflows/scripts/new/node');          // another sheet: the agent editor left behind is not its loss
  doc.getElementById('wfv-sheet-close').click();
  await tick(6);
  assert.equal(asking(), false);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'an untouched script sheet closes at once');
  await go(w, 'workflows/scripts/new/node');
  const name = doc.querySelector('#scripts-host [data-field="meta:displayName"]');
  name.value = 'Lint';
  name.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.getElementById('wfv-sheet-close').click();
  await tick(4);
  assert.match(doc.getElementById('confirm-message').textContent, /^This script has unsaved changes\./, 'a changed script asks, as before');
  doc.getElementById('confirm-ok').click();
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
  await go(w, 'workflows/agents/docsWriter/edit');
  await tick(4);
  const gone = doc.querySelector('#agents-list .agent-f-desc');
  gone.value = 'Thrown away.';
  gone.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.querySelector('#agents-list .agent-edit-cancel').click();     // the card editor's own Cancel is the discard
  doc.getElementById('wfv-sheet-close').focus();
  esc();
  await tick(6);
  assert.equal(asking(), false, 'a Cancelled editor holds nothing to lose');
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
});

test('the agent sheet leaves Escape to a code editor (its Tab-out) and to an open confirm; the form preview is not unsaved work', async () => {
  const { window: w } = await boot();
  const doc = w.document;
  const esc = () => doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const asking = () => !doc.getElementById('confirm-modal').classList.contains('hidden');
  const FORM = { version: 1, title: 'Pick', data: { type: 'object', properties: { summary: { type: 'string', maxLength: 400 } } },
    answer: { type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['yes', 'no'] }, note: { type: 'string', maxLength: 200 } } },
    layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'select', field: 'verdict', label: 'Verdict' }, { widget: 'text', field: 'note', label: 'Note' }],
    example: { summary: 'x' } };
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => (String(u).split('?')[0].endsWith('/api/agents/docsWriter') && !(init && init.method && init.method !== 'GET')
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ meta: { ...DOCS, asksQuestions: true, ask: { forms: { pick: FORM } } }, markdown: '# Docs' }) })
    : real(u, init));
  try {
    await go(w, 'workflows/agents/docsWriter/edit');
    await tick(4);
    const preview = [...doc.querySelectorAll('#agents-list .afm-preview input, #agents-list .afm-preview select, #agents-list .afm-preview textarea')];
    assert.ok(preview.length, 'precondition: the form preview draws controls');
    const tryIt = preview[preview.length - 1];
    tryIt.value = tryIt.tagName === 'SELECT' ? (tryIt.options[1] || tryIt.options[0]).value : 'trying the form';
    tryIt.dispatchEvent(new w.Event('input', { bubbles: true }));
    tryIt.dispatchEvent(new w.Event('change', { bubbles: true }));
    doc.getElementById('wfv-sheet-close').click();
    await tick(6);
    assert.equal(asking(), false, 'trying the preview changes nothing Save would write');
    assert.equal(doc.getElementById('wfv-sheet').hidden, true);
    await go(w, 'workflows/agents/docsWriter/edit');
    await tick(4);
    const ta = doc.querySelector('#agents-list .afm-editor textarea');
    ta.focus();
    ta.value = ta.value.replace('"Pick"', '"Pick one"');           // a changed form: Discard would lose it
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    esc();
    await tick(6);
    assert.equal(asking(), false, 'Escape in the code editor arms its Tab-out: no Discard question');
    assert.equal(doc.getElementById('wfv-sheet').hidden, false, '… and the sheet stays');
    const tab = new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    ta.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, false, 'the next Tab leaves the editor instead of indenting (no keyboard trap)');
    const desc = doc.querySelector('#agents-list .agent-f-desc');
    desc.focus();
    esc();
    await tick(4);
    assert.equal(asking(), true, 'from a plain field Escape still asks');
    desc.focus();                                                   // Tab left the confirm (it traps no focus) for the sheet
    esc();
    await tick(4);
    assert.equal(asking(), false, 'Escape answers the open confirm, never a second one stacked on it');
    assert.equal(doc.getElementById('wfv-sheet').hidden, false, 'Cancel: the sheet stays');
    assert.match(doc.querySelector('#agents-list .afm-editor textarea').value, /"Pick one"/, '… with the edit');
  } finally { globalThis.fetch = real; }
});

test('the agent wizard asks before Escape drops a running generation or its draft, and every step keeps the focus off <body>', async () => {
  const { window: w, requests, recv } = await boot();
  const doc = w.document;
  const esc = () => doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const asking = () => !doc.getElementById('confirm-modal').classList.contains('hidden');
  const step = () => [1, 2, 3].find((i) => !doc.getElementById(`agw-step-${i}`).classList.contains('hidden'));
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => (String(u).split('?')[0].endsWith('/api/agents/generate') && init && init.method === 'POST'
    ? (requests.push({ method: 'POST', url: String(u), body: init.body }), Promise.resolve({ ok: true, status: 202, json: async () => ({ genId: 'gen_1' }) }))
    : real(u, init));
  try {
    await go(w, 'workflows/agents/new');
    doc.getElementById('agw-name').value = 'Release Notes';
    doc.getElementById('agw-purpose').value = 'Writes release notes.';
    doc.getElementById('agw-purpose').dispatchEvent(new w.Event('input', { bubbles: true }));
    doc.getElementById('agw-start').focus();
    doc.getElementById('agw-start').click();
    await tick(4);
    assert.equal(step(), 2, 'generating');
    assert.equal(doc.activeElement.id, 'agw-abort', 'Generate hands the focus to Abort (the hidden step would drop it to <body>)');
    esc();
    await tick(4);
    assert.equal(asking(), true, 'Escape while it generates asks first');
    assert.match(doc.getElementById('confirm-message').textContent, /still being generated/);
    doc.getElementById('confirm-cancel').click();
    await tick(4);
    assert.equal(doc.getElementById('wfv-sheet').hidden, false, 'Cancel keeps the sheet');
    assert.equal(step(), 2, '… and the generation');
    assert.equal(requests.some((r) => r.url.includes('/api/agents/generate/stop')), false, 'nothing was stopped');
    assert.equal(doc.activeElement.id, 'agw-abort', '… and the focus');
    const done = () => recv({ type: 'agentgen-done', genId: 'gen_1', draft: { meta: { displayName: 'Release Notes', description: 'Writes release notes.',
      runnerType: 'producer', color: 'green', inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'notes', type: 'md' }] }, markdown: '# Notes' } });
    esc();
    await tick(4);
    done();                                            // the generation finishes under the open confirm
    await tick(2);
    assert.equal(step(), 3, 'the draft landed');
    assert.equal(doc.activeElement.id, 'confirm-ok', 'the confirm keeps the focus');
    doc.getElementById('confirm-cancel').click();
    await tick(4);
    assert.equal(doc.activeElement.id, 'wfv-sheet-close', 'Abort hid meanwhile: the sheet\'s Close, never <body>');
    doc.getElementById('agw-regen').focus();
    doc.getElementById('agw-regen').click();
    await tick(4);
    assert.equal(doc.activeElement.id, 'agw-abort', 'Regenerate hands the focus to Abort');
    done();
    await tick(2);
    assert.equal(step(), 3);
    assert.equal(doc.activeElement, doc.querySelector('#agw-step-3 .agent-f-name'), 'the review step takes the focus on its first field');
    esc();
    await tick(4);
    assert.equal(asking(), true, 'Escape on the generated draft asks first');
    assert.match(doc.getElementById('confirm-message').textContent, /not saved/);
    doc.getElementById('confirm-cancel').click();
    await tick(4);
    assert.equal(doc.getElementById('wfv-sheet').hidden, false, 'Cancel keeps the sheet');
    assert.equal(step(), 3);
    assert.equal(doc.querySelector('#agw-step-3 .agent-f-name').value, 'Release Notes', '… and the draft');
    assert.equal(doc.activeElement, doc.querySelector('#agw-step-3 .agent-f-name'), '… and the caret');
    esc();
    await tick(4);
    doc.getElementById('confirm-ok').click();
    await tick(6);
    assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'Discard closes the sheet');
    assert.equal(w.location.hash, '#workflows');
  } finally { globalThis.fetch = real; }
});

test('Save in the agent edit sheet lands on the saved agent: #workflows/agents/<key>, its card unfolded, the focus on its Edit — never <body>', async () => {
  const { window: w, requests } = await boot();
  const doc = w.document;
  await go(w, 'workflows/agents/docsWriter/edit');
  await tick(4);
  const desc = doc.querySelector('#agents-list .agent-f-desc');
  desc.focus();
  desc.value = 'Writes better docs.';
  desc.dispatchEvent(new w.Event('input', { bubbles: true }));
  const save = doc.querySelector('#agents-list .agent-edit-save');
  save.focus();
  save.click();
  await tick(8);
  assert.ok(requests.some((r) => r.method === 'PUT' && r.url.endsWith('/api/agents/docsWriter')), 'saved');
  assert.equal(w.location.hash, '#workflows/agents/docsWriter', 'the address names the agent, no longer its editor');
  const card = doc.querySelector('#agents-list .agent-card');
  assert.equal(card.querySelector('.agent-head').getAttribute('aria-expanded'), 'true', 'the saved agent is unfolded');
  assert.equal(doc.activeElement, card.querySelector('.agent-edit'), 'the focus is on its Edit');
  doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'Escape reaches the sheet again and closes it (nothing is unsaved)');
  assert.equal(w.location.hash, '#workflows');
});

test('a save that lands after its sheet closed leaves the address alone; a saved agent the reload lacks hands the focus to Close', async () => {
  const edit = async (w) => {
    await go(w, 'workflows/agents/docsWriter/edit');
    await tick(4);
    const desc = w.document.querySelector('#agents-list .agent-f-desc');
    desc.value = 'Writes better docs.';
    desc.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  await checkRows([
    { name: 'the sheet closed (Discard) while the PUT ran: the hash stays #workflows', run: async () => {
      const { window: w } = await boot();
      const doc = w.document;
      const real = globalThis.fetch;
      let release = null;
      globalThis.fetch = (u, init) => (init && init.method === 'PUT' ? new Promise((done) => { release = () => done(real(u, init)); }) : real(u, init));
      try {
        await edit(w);
        doc.querySelector('#agents-list .agent-edit-save').click();
        await tick(2);
        doc.getElementById('wfv-sheet-close').click();
        await tick(4);
        doc.getElementById('confirm-ok').click();
        await tick(6);
        assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'precondition: the sheet closed first');
        release();
        await tick(8);
        assert.equal(w.location.hash, '#workflows');
      } finally { globalThis.fetch = real; }
    } },
    { name: 'the reloaded list lacks the agent: the focus goes to the sheet\'s Close, never <body>', run: async () => {
      const { window: w } = await boot();
      await edit(w);
      w.__setAgents(AGENTS.filter((a) => a.key !== 'docsWriter'));
      w.document.querySelector('#agents-list .agent-edit-save').click();
      await tick(8);
      assert.equal(w.document.activeElement.id, 'wfv-sheet-close');
    } },
  ]);
});

test('Library Edit on a user agent opens the agent sheet with that one card in edit mode', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/agents/docsWriter/edit');
  await tick(); await tick();
  const doc = w.document;
  assert.equal(doc.querySelector('.wfv-pane[data-pane="agent"]').hidden, false);
  assert.deepEqual([...doc.querySelectorAll('#agents-list .agent-card')].map((c) => c.dataset.agentKey), ['docsWriter']);
  assert.equal(doc.querySelector('#agents-list .agent-edit-pane').hidden, false);
  assert.ok(doc.querySelector('#agents-list .agent-form .agent-f-md'), 'the full form, at any level');
});

test('a Library Delete on an agent confirms with the old text, deletes, toasts, and the Library drops the row', async () => {
  const { window: w, requests } = await boot();
  await go(w, 'workflows/agents');
  // The stub's registry never changes: from the DELETE on, answer it without the agent, as the server would.
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => real(u, init).then((r) => (/\/api\/agents(\?|$)/.test(String(u)) && requests.some((q) => q.method === 'DELETE')
    ? { ...r, json: async () => { const v = await r.json(); return { ...v, agents: v.agents.filter((a) => a.key !== 'docsWriter') }; } } : r));
  try {
    const lib = w.__wfv.library();
    lib.open('agents');
    w.document.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-main').click();
    [...w.document.querySelectorAll('.wfl-item[data-item="agent:docsWriter"] .wfl-actions button')].find((b) => b.textContent === 'Delete').click();
    await tick();
    assert.equal(w.document.getElementById('confirm-message').textContent,
      'Delete agent "Docs Writer"?\n\nThis removes its markdown + metadata pair. This cannot be undone.');
    w.document.getElementById('confirm-ok').click();
    await tick(4);
    assert.ok(requests.some((r) => r.method === 'DELETE' && r.url === '/api/agents/docsWriter'));
    assert.ok([...w.document.querySelectorAll('.toast')].some((t) => /Agent deleted\./.test(t.textContent)));
    assert.equal(w.document.querySelector('.wfl-item[data-item="agent:docsWriter"]'), null, 'the Library reloaded the registry');
  } finally { globalThis.fetch = real; }
});

test('a Library Duplicate on a script saves <key>Copy, toasts, and shows the new row open and washed', async () => {
  const { window: w, requests } = await boot();
  await go(w, 'workflows/scripts');
  // From the duplicate POST on, the registry lists the copy, as the server would.
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => real(u, init).then((r) => (/\/api\/scripts$/.test(String(u).split('?')[0]) && requests.some((q) => q.url.endsWith('/duplicate'))
    ? { ...r, json: async () => { const v = await r.json(); return { ...v, scripts: [...v.scripts, { ...v.scripts.find((s) => s.key === 'gitDiff'), key: 'gitDiffCopy', origin: 'user' }] }; } } : r));
  try {
    const lib = w.__wfv.library();
    w.document.querySelector('.wfl-item[data-item="script:gitDiff"] .wfl-main').click();
    [...w.document.querySelectorAll('.wfl-item[data-item="script:gitDiff"] .wfl-actions button')].find((b) => b.textContent === 'Duplicate').click();
    await tick(4);
    const post = requests.find((r) => r.url === '/api/scripts/gitDiff/duplicate');
    assert.deepEqual(JSON.parse(post.body), { newKey: 'gitDiffCopy' });
    assert.ok([...w.document.querySelectorAll('.toast')].some((t) => /Duplicated as "gitDiffCopy"\./.test(t.textContent)));
    assert.equal(lib.tab(), 'scripts');
    const row = w.document.querySelector('.wfl-item[data-item="script:gitDiffCopy"]');
    assert.ok(row && row.classList.contains('is-flash'), 'the new row, washed');
    assert.ok(row.querySelector('.wfl-detail'), '… and open');
  } finally { globalThis.fetch = real; }
});

test('drag-free add: a Library "+" spawns the agent on the canvas and selects it', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/agents');
  const c = w.__gv().c;
  const n0 = c.template().nodes.length;
  w.document.querySelector('.wfl-item[data-item="agent:planner"] .wfl-add').click();
  assert.equal(c.template().nodes.length, n0 + 1);
  assert.equal(c.template().nodes.at(-1).key, 'planner');
  assert.deepEqual(c.selection(), { kind: 'node', id: c.template().nodes.at(-1).id });
});

test('MAJ-17 (ported): a refused workflow delete toasts the server error and keeps the row; a successful one toasts and refreshes', async () => {
  await checkRows([
    { name: 'a refused delete keeps the row and says why', run: async () => {
      const { window: w } = await boot({ del: { status: 400, body: { error: 'the default workflow cannot be deleted' } } });
      await go(w, 'workflows');
      w.__wfv.library().open('workflows');
      w.document.querySelector('.wfl-wf[data-id="wf_g"] .wfl-del').click();
      await tick();
      w.document.getElementById('confirm-ok').click();
      await tick(); await tick();
      assert.deepEqual(lastToast(w.document), { tone: 'err', title: 'Not deleted', detail: 'the default workflow cannot be deleted', action: '' });
      assert.ok(w.document.querySelector('.wfl-wf[data-id="wf_g"]'), 'the row is still there');
    } },
    { name: 'a successful delete toasts and refreshes the Library', run: async () => {
      const { window: w } = await boot();
      await go(w, 'workflows');
      w.__wfv.library().open('workflows');
      w.document.querySelector('.wfl-wf[data-id="wf_g"] .wfl-del').click();
      await tick();
      assert.equal(w.document.getElementById('confirm-message').textContent, 'Delete "Graph one"?\n\nThis cannot be undone.', 'it asks first');
      w.document.getElementById('confirm-ok').click();
      await tick(); await tick();
      assert.deepEqual(lastToast(w.document), { tone: 'ok', title: 'Pipeline deleted: Graph one', detail: '', action: '' });
      assert.equal(w.document.querySelector('.wfl-wf[data-id="wf_g"]'), null, 'the deleted row is gone');
    } },
  ]);
});

test('an /api/agents failure shows Retry in the Library and disables Save; the canvas still renders', async () => {
  const { window: w } = await boot({ agentsFail: true });
  await go(w, 'workflows');
  const doc = w.document;
  assert.match(doc.querySelector('#wfv-library .wfl-list').textContent, /Couldn’t load agents/);
  assert.ok([...doc.querySelectorAll('#wfv-library .wfl-list button')].some((b) => b.textContent === 'Retry'), 'Retry button');
  assert.equal(doc.getElementById('wfv-save').disabled, true);
  assert.equal(doc.querySelectorAll('#wfv-canvas .gv-world .node').length, 2, 'the canvas still renders');
});

test('MAJ-6 (ported): a Library Open asks before discarding unsaved edits; Cancel keeps the canvas and its undo ring', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const c = w.__gv().c;
  c.spawn({ key: 'planner' });
  const n = c.template().nodes.length;
  const depth = c.undoDepth();
  w.__wfv.library().open('workflows');
  w.document.querySelector('.wfl-wf[data-id="wf_g"] .wfl-main').click();
  await tick(); await tick();
  assert.equal(w.document.getElementById('confirm-modal').classList.contains('hidden'), false, 'it asks first');
  w.document.getElementById('confirm-cancel').click();
  await tick(); await tick();
  assert.equal(c.template().nodes.length, n);
  assert.equal(c.undoDepth(), depth);
  assert.notEqual(c.template().id, 'wf_g');
});

test('closing the Library hands focus to its toggle, never <body>', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  doc.getElementById('wfl-close').focus();
  doc.getElementById('wfl-close').click();
  assert.equal(doc.getElementById('wfv-library').dataset.open, 'false');
  assert.equal(doc.activeElement.id, 'wfv-lib-toggle');
});

test('Duplicate on the agent sheet (View on a built-in) moves the sheet to the copy, open for editing', async () => {
  const { window: w } = await boot();
  const PLAN = AGENTS.find((a) => a.key === 'planner');
  const COPY = { ...PLAN, key: 'plannerCopy', displayName: 'Plan (copy)', origin: 'user' };
  const json = (v, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v });
  const real = globalThis.fetch;
  let copied = false;
  globalThis.fetch = (u, init) => {
    const p = String(u).split('?')[0];
    const method = (init && init.method) || 'GET';
    if (p.endsWith('/api/agents/planner') && method === 'GET') return json({ meta: PLAN, markdown: '# Plan' });
    if (p.endsWith('/api/agents/plannerCopy') && method === 'GET') return json({ meta: COPY, markdown: '# Plan' });
    if (p.endsWith('/api/agents') && method === 'POST') { copied = true; return json({ meta: COPY }, 201); }
    if (p.endsWith('/api/agents') && copied) return real(u, init).then((r) => r.json()).then((v) => json({ ...v, agents: [...v.agents, COPY] }));
    return real(u, init);
  };
  try {
    await go(w, 'workflows/agents/planner');
    const doc = w.document;
    doc.querySelector('#agents-list .agent-duplicate').click();
    await tick(8);
    assert.equal(w.location.hash, '#workflows/agents/plannerCopy/edit');
    assert.deepEqual([...doc.querySelectorAll('#agents-list .agent-card')].map((c) => c.dataset.agentKey), ['plannerCopy']);
    assert.equal(doc.querySelector('#agents-list .agent-edit-pane').hidden, false);
  } finally { globalThis.fetch = real; }
});

test('the sheet takes focus and the view behind it goes inert; Escape closes it and focus returns to the Library action', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/agents');
  const doc = w.document;
  const behind = ['wfv-stage', 'wfv-library'];
  const esc = () => doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  doc.querySelector('.wfl-item[data-item="agent:planner"] .wfl-main').click();
  const view = [...doc.querySelectorAll('.wfl-item[data-item="agent:planner"] .wfl-actions button')].find((b) => b.textContent === 'View');
  view.focus();
  view.click();
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, false);
  assert.equal(doc.activeElement.id, 'wfv-sheet-close', 'a card with no field: the Close button');
  for (const id of behind) assert.equal(doc.getElementById(id).hasAttribute('inert'), true, `${id} inert while the sheet is open`);
  esc();
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
  for (const id of behind) assert.equal(doc.getElementById(id).hasAttribute('inert'), false, `${id} back in reach`);
  assert.equal(doc.activeElement.dataset.focusKey, 'agent:planner:View');
  await go(w, 'workflows/agents/new');
  assert.ok(doc.getElementById('wfv-sheet').contains(doc.activeElement), 'the New agent sheet takes focus too');
  assert.equal(doc.activeElement.id, 'agw-name', '… on its first field once painted');
  // The script sheet: Escape in one of the controller's fields stays there; Escape on the sheet's Close leaves.
  await go(w, 'workflows/scripts/new/node');
  doc.querySelector('#scripts-host [data-field="meta:displayName"]').focus();
  esc();
  await tick(4);
  assert.equal(doc.getElementById('wfv-sheet').hidden, false, 'Escape inside a script field is the field\'s');
  doc.getElementById('wfv-sheet-close').focus();
  esc();
  await tick(6);
  assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'Escape on the sheet\'s own Close closes it');
  assert.equal(doc.activeElement.dataset.focusKey, 'agent:planner:View', 'the opener outlives a pane switch');
  doc.activeElement.blur();
  await go(w, 'workflows/agents/new');
  doc.getElementById('wfv-sheet-close').click();
  await tick(6);
  assert.equal(doc.activeElement.id, 'wfv-lib-toggle', 'no opener: the Library toggle, never <body>');
});

test('deleting the agent its sheet shows hands focus to the Library toggle, never <body>, even when the Library reloads after the sheet closed', async () => {
  const { window: w, requests } = await boot();
  await go(w, 'workflows/agents');
  const doc = w.document;
  // From the DELETE on, the registry answers without the agent, and LATE: a real round trip lands after the hashchange.
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => real(u, init).then((r) => (/\/api\/agents(\?|$)/.test(String(u)) && requests.some((q) => q.method === 'DELETE')
    ? new Promise((done) => setTimeout(() => done({ ...r, json: async () => { const v = await r.json(); return { ...v, agents: v.agents.filter((a) => a.key !== 'docsWriter') }; } }), 30)) : r));
  try {
    doc.querySelector('.wfl-item[data-item="agent:docsWriter"] .wfl-main').click();
    const edit = [...doc.querySelectorAll('.wfl-item[data-item="agent:docsWriter"] .wfl-actions button')].find((b) => b.textContent === 'Edit');
    edit.focus();
    edit.click();
    await tick(6);
    assert.equal(doc.getElementById('wfv-sheet').hidden, false, 'precondition: the sheet shows the agent');
    doc.querySelector('#agents-list .agent-delete').click();
    await tick();
    doc.getElementById('confirm-ok').click();
    await tick(6);
    assert.equal(w.location.hash, '#workflows/agents');
    assert.equal(doc.getElementById('wfv-sheet').hidden, true, 'the sheet closed');
    await new Promise((r) => setTimeout(r, 60));
    await tick(4);
    assert.equal(doc.querySelector('.wfl-item[data-item="agent:docsWriter"]'), null, 'precondition: the late reload dropped the row');
    assert.equal(doc.activeElement.id, 'wfv-lib-toggle');
  } finally { globalThis.fetch = real; }
});

test('a Library Delete on a user script confirms, deletes, toasts and drops the row; a refusal says why and keeps it', async () => {
  const MINE = { ...SCRIPTS.find((s) => s.key === 'gitDiff'), key: 'myScript', displayName: 'My script', origin: 'user' };
  // The registry lists the user script until its DELETE succeeds, as the server would.
  const withMine = (requests, status) => {
    const real = globalThis.fetch;
    globalThis.fetch = (u, init) => real(u, init).then((r) => (/\/api\/scripts$/.test(String(u).split('?')[0]) && (!init || !init.method || init.method === 'GET')
      ? { ...r, json: async () => { const v = await r.json(); const gone = status < 400 && requests.some((q) => q.method === 'DELETE'); return { ...v, scripts: gone ? v.scripts : [...v.scripts, MINE] }; } } : r));
    return () => { globalThis.fetch = real; };
  };
  const pressDelete = async (w) => {
    const row = w.document.querySelector('.wfl-item[data-item="script:myScript"]');
    if (!row.querySelector('.wfl-detail')) row.querySelector('.wfl-main').click();     // open the row's actions
    [...w.document.querySelectorAll('.wfl-item[data-item="script:myScript"] .wfl-actions button')].find((b) => b.textContent === 'Delete').click();
    await tick();
  };
  await checkRows([
    { name: 'Cancel deletes nothing; OK deletes, toasts and the Library reloads without it', run: async () => {
      const { window: w, requests } = await boot();
      const restore = withMine(requests, 200);
      try {
        await go(w, 'workflows/scripts');
        await pressDelete(w);
        assert.equal(w.document.getElementById('confirm-message').textContent, 'Delete “My script”?');
        w.document.getElementById('confirm-cancel').click();
        await tick(4);
        assert.equal(requests.some((r) => r.method === 'DELETE'), false, 'Cancel deletes nothing');
        await pressDelete(w);
        w.document.getElementById('confirm-ok').click();
        await tick(6);
        assert.ok(requests.some((r) => r.method === 'DELETE' && r.url === '/api/scripts/myScript'));
        assert.deepEqual(lastToast(w.document), { tone: 'ok', title: 'Deleted "myScript".', detail: '', action: '' });
        assert.equal(w.document.querySelector('.wfl-item[data-item="script:myScript"]'), null, 'the Library reloaded the registry');
      } finally { restore(); }
    } },
    { name: 'a 409 with the server reason: "Cannot delete script" with it, the row stays', run: async () => {
      const { window: w, requests } = await boot({ del: { status: 409, body: { error: 'Used by workflow "Graph one".' } } });
      const restore = withMine(requests, 409);
      try {
        await go(w, 'workflows/scripts');
        await pressDelete(w);
        w.document.getElementById('confirm-ok').click();
        await tick(6);
        assert.deepEqual(lastToast(w.document), { tone: 'err', title: 'Cannot delete script', detail: 'Used by workflow "Graph one".', action: '' });
        assert.ok(w.document.querySelector('.wfl-item[data-item="script:myScript"]'), 'the row stays');
      } finally { restore(); }
    } },
    { name: 'a 409 with no reason says the script is in use', run: async () => {
      const { window: w, requests } = await boot({ del: { status: 409, body: {} } });
      const restore = withMine(requests, 409);
      try {
        await go(w, 'workflows/scripts');
        await pressDelete(w);
        w.document.getElementById('confirm-ok').click();
        await tick(6);
        assert.deepEqual(lastToast(w.document), { tone: 'err', title: 'Cannot delete script', detail: 'This script is in use.', action: '' });
      } finally { restore(); }
    } },
  ]);
});

test('an archived workflow is deleted only after a confirm: it is permanent, and the list shows at every level', async () => {
  const { window: w, requests } = await boot();
  const ARCH = { ...V2_ROW, id: 'wf_arch', name: 'Old one' };
  const json = (v) => Promise.resolve({ ok: true, status: 200, json: async () => v });
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => (String(u).includes('/api/workflows?archived=1')
    ? json({ workflows: requests.some((q) => q.method === 'DELETE' && q.url.endsWith('/wf_arch')) ? [] : [ARCH] }) : real(u, init));
  try {
    await go(w, 'workflows');
    w.__wfv.library().open('workflows');
    const chip = () => w.document.querySelector('#wfv-library .wfl-archived .wfl-chip');
    chip().click();
    await tick();
    assert.equal(w.document.getElementById('confirm-modal').classList.contains('hidden'), false, 'it asks first');
    assert.equal(w.document.getElementById('confirm-message').textContent, 'Delete "Old one"?\n\nThis cannot be undone.');
    w.document.getElementById('confirm-cancel').click();
    await tick(4);
    assert.equal(requests.some((r) => r.method === 'DELETE'), false, 'Cancel deletes nothing');
    assert.ok(chip(), 'the row stays');
    chip().click();
    await tick();
    w.document.getElementById('confirm-ok').click();
    await tick(4);
    assert.ok(requests.some((r) => r.method === 'DELETE' && r.url === '/api/workflows/wf_arch'));
    assert.equal(chip(), null, 'the Library refreshed without it');
  } finally { globalThis.fetch = real; }
});

test('the top bars, the dock and the zoom bar are fenced: Delete, arrows and Space there never edit or pan the canvas', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const end = c.template().nodes.find((n) => n.kind === 'end');
  c.select({ kind: 'node', id: end.id });
  for (const id of ['wfv-zoom', 'wfv-add', 'wfv-save', 'wfv-wf-menu', 'wfv-lib-toggle', 'wfv-autolayout', 'wfv-back']) {
    const b = doc.getElementById(id);
    for (const key of ['Delete', 'Backspace', 'ArrowRight']) b.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const sp = new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    b.dispatchEvent(sp);
    assert.equal(sp.defaultPrevented, false, `Space on #${id} activates the button, not a canvas pan`);
    b.dispatchEvent(new w.KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  }
  const now = c.template().nodes.find((n) => n.id === end.id);
  assert.ok(now, 'Delete on a top-bar button left the selected End card');
  assert.equal(now.x, end.x, 'an arrow there never nudged it');
});

test('Enter / Space on an agent card\'s Edit, Duplicate or Delete activates that button — the card never folds', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows/agents/docsWriter');
  await tick(); await tick();
  const card = w.document.querySelector('#agents-list .agent-card[data-agent-key="docsWriter"]');
  const head = card.querySelector('.agent-head');
  const open0 = head.getAttribute('aria-expanded');
  for (const sel of ['.agent-edit', '.agent-duplicate', '.agent-delete']) {
    for (const key of ['Enter', ' ']) {
      const ev = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      card.querySelector(sel).dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, false, `${JSON.stringify(key)} on ${sel} keeps its native click`);
      assert.equal(head.getAttribute('aria-expanded'), open0, `${JSON.stringify(key)} on ${sel} folds nothing`);
    }
  }
  const own = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  head.dispatchEvent(own);
  assert.equal(own.defaultPrevented, true, 'Enter on the header itself still toggles it');
  assert.notEqual(head.getAttribute('aria-expanded'), open0);
});

test('a chat agent draft opens the wizard at step 3 with the draft', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  await w.__wfv.openAgentDraft({ meta: { key: 'releaseNotes', displayName: 'Release Notes', description: 'Writes notes.', runnerType: 'producer',
    color: 'green', inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'notes', type: 'md' }] }, markdown: '---\nname: releaseNotes\n---\nWrite notes.' });
  await tick(); await tick(); await tick();
  assert.equal(w.location.hash, '#workflows/agents/new');
  const doc = w.document;
  assert.equal(doc.getElementById('agw-step-3').classList.contains('hidden'), false);
  assert.equal(doc.querySelector('#agw-step-3 .agent-f-name').value, 'Release Notes');
  // The draft stays on its chat card: an untouched review step closes at once; an edited one asks.
  const esc = () => doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const asking = () => !doc.getElementById('confirm-modal').classList.contains('hidden');
  doc.querySelector('#agw-step-3 .agent-f-name').focus();
  esc();
  await tick(6);
  assert.equal(asking(), false, 'an untouched chat draft is not lost: no question');
  assert.equal(doc.getElementById('wfv-sheet').hidden, true);
  await w.__wfv.openAgentDraft({ meta: { key: 'releaseNotes', displayName: 'Release Notes', description: 'Writes notes.', runnerType: 'producer',
    color: 'green', inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'notes', type: 'md' }] }, markdown: '---\nname: releaseNotes\n---\nWrite notes.' });
  await tick(6);
  const name = doc.querySelector('#agw-step-3 .agent-f-name');
  name.value = 'Release Notes Pro';
  name.dispatchEvent(new w.Event('input', { bubbles: true }));
  name.focus();
  esc();
  await tick(4);
  assert.equal(asking(), true, 'edits made in the review step ask first');
  assert.match(doc.getElementById('confirm-message').textContent, /^Your changes to this draft are not saved/);
  doc.getElementById('confirm-cancel').click();
  await tick(4);
  assert.equal(doc.getElementById('wfv-sheet').hidden, false);
  assert.equal(doc.querySelector('#agw-step-3 .agent-f-name').value, 'Release Notes Pro');
  // Regenerate turns it into a generated (paid) draft: untouched, closing loses it, so it asks again.
  const real = globalThis.fetch;
  globalThis.fetch = (u, init) => (String(u).split('?')[0].endsWith('/api/agents/generate') && init && init.method === 'POST'
    ? Promise.resolve({ ok: true, status: 202, json: async () => ({ genId: 'gen_9' }) }) : real(u, init));
  try {
    doc.getElementById('agw-regen').click();
    await tick(4);
    recv({ type: 'agentgen-done', genId: 'gen_9', draft: { meta: { displayName: 'Release Notes', description: 'Writes notes.', runnerType: 'producer', color: 'green',
      inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'notes', type: 'md' }] }, markdown: '# Notes' } });
    await tick(2);
    doc.querySelector('#agw-step-3 .agent-f-name').focus();
    esc();
    await tick(4);
    assert.equal(asking(), true, 'a regenerated draft is lost on close: it asks');
    assert.match(doc.getElementById('confirm-message').textContent, /^The generated agent is not saved yet/);
    doc.getElementById('confirm-ok').click();
    await tick(4);
  } finally { globalThis.fetch = real; }
});

test('a chat script draft opens the script wizard at Build & test with the draft', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  await w.__wfv.openScriptDraft({ meta: { key: 'runLint', displayName: 'Run lint', runtime: 'shell', description: 'Lints.', inputs: [], outputs: [] },
    source: 'npm run lint', cases: [{ id: 'ok', name: 'passes', expect: { verdict: 'clean' } }] });
  await tick(6);
  assert.equal(w.location.hash, '#workflows/scripts/new/shell');
  const root = w.document.querySelector('#scripts-host .wz-step-2');
  assert.ok(root, 'step 2');
  assert.equal(root.querySelector('[data-field="meta:displayName"]').value, 'Run lint');
  assert.equal(root.querySelector('[data-field="script:source"]').value, 'npm run lint');
  assert.deepEqual(w.__scripts.ctl().pendingCases().map((c) => c.id), ['ok']);
});

test('a chat agent draft keeps its chat key through the review step, renamed or regenerated; a Generate from step 1 is a new agent', async () => {
  const { window: w, requests, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const DRAFT = { meta: { key: 'releaseNotes', displayName: 'Release Notes', description: 'Writes notes.', runnerType: 'producer',
    color: 'green', inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] }, markdown: '---\nname: releaseNotes\n---\nWrite notes.' };
  const GEN = { meta: { displayName: 'Release Notes', description: 'Writes notes.', runnerType: 'producer', color: 'green',
    inputs: [{ id: 'diff', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] }, markdown: '# Notes' };
  const real = globalThis.fetch;
  let gens = 0;
  globalThis.fetch = (u, init) => {
    const path = String(u).split('?')[0];
    const post = init && init.method === 'POST';
    if (post && path.endsWith('/api/agents/generate')) return Promise.resolve({ ok: true, status: 202, json: async () => ({ genId: `gen_${++gens}` }) });
    if (post && path.endsWith('/api/agents')) {
      requests.push({ method: 'POST', url: String(u), body: init.body });
      const meta = JSON.parse(init.body).meta;
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ meta: { ...meta, key: meta.key || 'derivedKey' } }) });
    }
    return real(u, init);
  };
  const saved = () => requests.filter((r) => r.method === 'POST' && r.url.split('?')[0].endsWith('/api/agents')).map((r) => JSON.parse(r.body).meta);
  const save = async () => { doc.getElementById('agw-save').click(); await tick(6); };
  try {
    // Renamed in the review step: the chat card's Save & add, its `then` ops and a build's draft list name it by its chat key.
    await w.__wfv.openAgentDraft(DRAFT);
    await tick(6);
    const name = doc.querySelector('#agw-step-3 .agent-f-name');
    name.value = 'Release Notes Pro';
    name.dispatchEvent(new w.Event('input', { bubbles: true }));
    await save();
    assert.deepEqual(saved().map((m) => [m.key, m.displayName]), [['releaseNotes', 'Release Notes Pro']], 'the chat key, the new name');
    // Regenerated on step 3: still the chat's draft.
    await w.__wfv.openAgentDraft(DRAFT);
    await tick(6);
    doc.getElementById('agw-regen').click();
    await tick(4);
    recv({ type: 'agentgen-done', genId: 'gen_1', draft: GEN });
    await tick(2);
    await save();
    assert.equal(saved()[1].key, 'releaseNotes', 'a Regenerate keeps the chat key');
    // Back to step 1 (an aborted Regenerate) and a Generate under another name: a new agent, its key follows its name.
    await w.__wfv.openAgentDraft(DRAFT);
    await tick(6);
    doc.getElementById('agw-regen').click();
    await tick(4);
    doc.getElementById('agw-abort').click();
    await tick(4);
    assert.equal(doc.getElementById('agw-step-1').classList.contains('hidden'), false, 'back on step 1');
    doc.getElementById('agw-name').value = 'Changelog Bot';
    doc.getElementById('agw-name').dispatchEvent(new w.Event('input', { bubbles: true }));
    doc.getElementById('agw-start').click();
    await tick(4);
    recv({ type: 'agentgen-done', genId: 'gen_3', draft: { ...GEN, meta: { ...GEN.meta, displayName: 'Changelog Bot' } } });
    await tick(2);
    await save();
    assert.equal(saved().length, 3);
    assert.equal(saved()[2].key, undefined, 'a Generate from step 1 derives the key from the name');
    assert.equal(saved()[2].displayName, 'Changelog Bot');
  } finally { globalThis.fetch = real; }
});

test('the chat sends the OPEN canvas, and a canvas-edit card frame changes the canvas live with one undo step', async () => {
  const { window: w, recv, requests } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const input = doc.getElementById('wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const msg = requests.find((r) => /\/messages$/.test(r.url));
  const body = JSON.parse(msg.body);
  assert.equal(body.composer.docToken, c.docToken());
  assert.equal(body.composer.graph.nodes.length, 2);
  const depth = c.undoDepth();
  // ask-model.mjs drops a seq'd frame for a message it has not seen unless it is `ask-start` (or a turn is in
  // flight): open the turn first, exactly as test/ui-ask-workflow-card.test.mjs does.
  recv({ type: 'ask-start', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', userMessageId: 'askm_0000aaaa',
    model: 'claude-opus-5-5', effort: 'high', startedAt: 't', seq: 1 });
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: { kind: 'card', id: 'card_0000aaaa', state: 'proposed',
    card: { type: 'canvas-edit', sessionId: body.composer.sessionId, docToken: body.composer.docToken, summary: 'Add Plan',
      ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'planner', x: 385, y: 198 }], added: ['n_abcdefgh'], removed: [], todo: 1, warnings: [] } } });
  await tick(); await tick();
  assert.ok(c.template().nodes.some((n) => n.id === 'n_abcdefgh'));
  assert.equal(c.undoDepth(), depth + 1);
  assert.ok(requests.some((r) => /\/cards\/card_0000aaaa$/.test(r.url) && JSON.parse(r.body).state === 'applied'));
});

test('the global Ask pill is hidden in the Workflows view; the dock has no attach control', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  assert.ok(w.document.body.classList.contains('view-workflows'));
  assert.equal(w.document.querySelector('#wfc input[type="file"]'), null);
});

test('the inline Undo follows the canvas: ⌘Z on the chat edit disables it at once', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const input = doc.getElementById('wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const block = { kind: 'card', id: 'card_0000aaaa', state: 'proposed', card: { type: 'canvas-edit', sessionId: w.__wfv.session, docToken: c.docToken(),
    summary: 'Add Plan', ops: [{ op: 'add_node', id: 'n_abcdefgh', kind: 'agent', key: 'planner', x: 385, y: 198 }] } };
  recv({ type: 'ask-start', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', userMessageId: 'askm_0000aaaa',
    model: 'claude-opus-5-5', effort: 'high', startedAt: 't', seq: 1 });
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block });
  await tick(); await tick();
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, block: { ...block, state: 'applied' } });   // the server's flip
  await tick(); await tick();
  const undo = () => [...doc.querySelectorAll('#wfc [data-card-id="card_0000aaaa"] button')].find((b) => b.textContent === 'Undo');
  assert.equal(undo().disabled, false);
  c.undo();                                  // ⌘Z: Task/End and the open id are unchanged, so the Library signature holds
  await tick(); await tick();
  assert.equal(undo().disabled, true, 'afterRender repainted the dock before its Library early return');
});

test('a chat draft saved through Edit… is not POSTed again: Apply finds its key in the library and opens the build', async () => {
  const { window: w, recv, requests } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const input = doc.getElementById('wfc-input');
  input.value = 'Build a docs pass';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(); await tick(); await tick();
  const at = { sessionId: w.__wfv.session, docToken: c.docToken() };
  const draft = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'agent-draft', ...at,
    draft: { key: 'docsWriter', meta: { displayName: 'Docs Writer' }, markdown: '# Docs' }, then: null } };
  const build = { kind: 'card', id: 'card_0000eeee', state: 'proposed', card: { type: 'workflow-build', ...at, name: 'Docs pass',
    counts: { agents: 1, scripts: 0, loops: 0 }, workflow: { nodes: [{ id: 'n_docs0001', kind: 'agent', key: 'docsWriter', x: 300, y: 200 }], wires: [] },
    drafts: ['docsWriter'], loops: [] } };
  recv({ type: 'ask-start', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', userMessageId: 'askm_0000aaaa',
    model: 'claude-opus-5-5', effort: 'high', startedAt: 't', seq: 1 });
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: draft });
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, block: build });
  await tick(); await tick();
  [...doc.querySelectorAll('#wfc button')].find((b) => b.textContent === 'Apply to canvas').click();
  for (let i = 0; i < 6; i += 1) await tick();
  assert.equal(requests.filter((r) => r.method === 'POST' && /\/api\/agents$/.test(r.url)).length, 0, 'docsWriter is in the library: a POST would be a 409');
  assert.ok(requests.some((r) => /\/cards\/card_0000dddd$/.test(r.url) && JSON.parse(r.body).state === 'saved'));
  assert.ok(c.template().nodes.some((n) => n.key === 'docsWriter'), 'the build opened');
});

test('the dock is wired to the stage, the "+" and the bottom-right bars', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  Object.defineProperty(doc.getElementById('wfv-stage'), 'clientWidth', { configurable: true, value: 956 });
  Object.defineProperty(doc.getElementById('wfv-add'), 'offsetWidth', { configurable: true, value: 40 });
  const rect = (left, width) => () => ({ left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0 });
  doc.getElementById('wfv-br').getBoundingClientRect = rect(752, 200);
  doc.getElementById('wfc').getBoundingClientRect = rect(220, 580);
  w.dispatchEvent(new w.Event('resize'));
  assert.equal(doc.querySelector('#wfc .wfc-shell').style.getPropertyValue('--wfc-avail'), '884px');
  assert.equal(doc.getElementById('wfv-br').classList.contains('is-up'), true);
});

test('a chat edit waits while the user types in the Params popover: the field keeps its text and focus, then the edit lands once it blurs', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const input = doc.getElementById('wfc-input');
  input.value = 'Add Plan';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(4);
  assert.equal(c.applyOps([{ op: 'add_node', id: 'n_shell001', kind: 'script', key: 'shell', x: 400, y: 420 }], 'add shell').ok, true);
  c.select({ kind: 'node', id: 'n_shell001' });
  await tick(2);
  doc.querySelector('[data-tb="params"]').click();
  await tick(2);
  const ta = doc.querySelector('.wfv-pop [data-field="param:command"]');
  ta.focus();
  ta.value = 'npm run lint -- --fix';
  ta.dispatchEvent(new w.Event('input', { bubbles: true }));
  recv({ type: 'ask-start', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', userMessageId: 'askm_0000aaaa',
    model: 'claude-opus-5-5', effort: 'high', startedAt: 't', seq: 1 });
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: { kind: 'card', id: 'card_0000aaaa', state: 'proposed',
    card: { type: 'canvas-edit', sessionId: w.__wfv.session, docToken: c.docToken(), summary: 'Add Plan',
      ops: [{ op: 'add_node', id: 'n_plan0001', kind: 'agent', key: 'planner', x: 700, y: 198 }], added: [], removed: [], todo: 0, warnings: [] } } });
  await tick(4);
  assert.equal(doc.querySelector('.wfv-pop [data-field="param:command"]'), ta, 'the popover was not repainted');
  assert.equal(ta.value, 'npm run lint -- --fix');
  assert.equal(doc.activeElement, ta);
  assert.equal(c.template().nodes.some((n) => n.id === 'n_plan0001'), false, 'not under the typing');
  doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  await tick(2);
  assert.ok(c.template().nodes.some((n) => n.id === 'n_shell001'), 'a Backspace in the field never deletes the card');
  ta.blur();                                          // a textarea commits on blur: the focus has gone when `change` fires
  ta.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  await tick(3);
  assert.equal(c.template().nodes.find((n) => n.id === 'n_shell001').config.params.command, 'npm run lint -- --fix');
  assert.ok(c.template().nodes.some((n) => n.id === 'n_plan0001'), 'the edit landed with no new frame');
});

test('a tool frame mid-turn keeps a card that did not change: the System prompt stays open, the same Save button keeps focus; a state change re-renders it', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const input = doc.getElementById('wfc-input');
  input.value = 'Create an agent that writes release notes';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(4);
  recv({ type: 'ask-start', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', userMessageId: 'askm_0000aaaa',
    model: 'claude-opus-5-5', effort: 'high', startedAt: 't', seq: 1 });
  const draft = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'agent-draft', sessionId: w.__wfv.session, docToken: c.docToken(),
    draft: { key: 'releaseNotes', meta: { displayName: 'Release Notes', runnerType: 'producer', inputs: [{ id: 'plan', type: 'md' }], outputs: [] }, markdown: '# Release notes' }, then: null } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: draft });
  await tick(3);
  const sel = '#wfc [data-card-id="card_0000dddd"]';
  const det = doc.querySelector(`${sel} details`);
  det.open = true;
  const save = [...doc.querySelectorAll(`${sel} button`)].find((b) => b.textContent === 'Save agent');
  save.focus();
  recv({ type: 'ask-block', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3,
    block: { kind: 'tool', id: 'toolu_01', name: 'mcp__worca__get_canvas', input: {}, status: 'running' } });
  await tick(3);
  assert.ok(doc.querySelector('#wfc .wfc-tool'), 'the frame did rebuild the thread');
  assert.equal(doc.querySelector(`${sel} details`), det);
  assert.equal(det.open, true);
  assert.equal([...doc.querySelectorAll(`${sel} button`)].find((b) => b.textContent === 'Save agent'), save, 'a click straddling the frame lands');
  assert.equal(doc.activeElement, save);
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 4, block: { ...draft, state: 'declined' } });
  await tick(3);
  assert.notEqual(doc.querySelector(sel), det.closest('[data-card-id]'), 'a new state is a new element');
  assert.match(doc.querySelector(sel).textContent, /Declined — Release Notes/);
});

const chatSend = async (w, text) => {
  const input = w.document.getElementById('wfc-input');
  input.value = text;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await tick(4);
};
const chatStart = (recv) => recv({ type: 'ask-start', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', userMessageId: 'askm_0000aaaa', model: 'claude-opus-5-5', effort: 'high', startedAt: 't', seq: 1 });

test('a card button in flight is aria-disabled, never `disabled` (Chrome would drop its focus to <body>)', async () => {
  const { window: w, recv, requests } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  await chatSend(w, 'Create an agent');
  chatStart(recv);
  const draft = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'agent-draft', sessionId: w.__wfv.session, docToken: c.docToken(),
    draft: { key: 'docsWriter', meta: { displayName: 'Docs Writer', runnerType: 'producer', inputs: [], outputs: [] }, markdown: '# x' }, then: null } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: draft });
  await tick(4);
  const save = [...doc.querySelectorAll('#wfc [data-card-id="card_0000dddd"] button')].find((b) => b.textContent === 'Save agent');
  save.focus();
  save.click();
  assert.equal(save.disabled, false, 'the in-flight button keeps its focus');
  assert.equal(save.getAttribute('aria-disabled'), 'true');
  save.click();                                       // a second press while in flight is ignored
  await tick(8);
  assert.equal(requests.filter((r) => r.method === 'POST' && /\/cards\/card_0000dddd$/.test(r.url)).length, 1, 'one save, not two');
  assert.equal(save.getAttribute('aria-disabled'), null, 'it re-enables itself when the call settles');
  save.click();
  await tick(8);
  assert.equal(requests.filter((r) => r.method === 'POST' && /\/cards\/card_0000dddd$/.test(r.url)).length, 2, 'a settled button takes the next press');
});

test('after a keyboard Undo on a chat edit the focus stays on the card, so Backspace leaves the selected card alone', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  assert.equal(c.applyOps([{ op: 'add_node', id: 'n_shell001', kind: 'script', key: 'shell', x: 400, y: 420 }], 'add shell').ok, true);
  await chatSend(w, 'Add Plan');
  chatStart(recv);
  const blk = { kind: 'card', id: 'card_0000aaaa', state: 'proposed', card: { type: 'canvas-edit', sessionId: w.__wfv.session, docToken: c.docToken(), summary: 'Add Plan',
    ops: [{ op: 'add_node', id: 'n_plan0001', kind: 'agent', key: 'planner', x: 700, y: 198 }], added: [], removed: [], todo: 0, warnings: [] } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: blk });
  await tick(6);
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, block: { ...blk, state: 'applied' } });
  await tick(6);
  c.select({ kind: 'node', id: 'n_shell001' });
  await tick(3);
  const sel = '#wfc [data-card-id="card_0000aaaa"]';
  const undo = [...doc.querySelectorAll(`${sel} button`)].find((b) => b.textContent === 'Undo');
  undo.focus();
  undo.click();                                       // Enter on the focused button
  await tick(6);
  assert.equal(undo.isConnected, false, 'precondition: the Undo rebuilt its card');
  assert.ok(doc.querySelector(sel).contains(doc.activeElement), `the focus is on the rebuilt card, not ${doc.activeElement.tagName}`);
  doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  await tick(3);
  assert.ok(c.template().nodes.some((n) => n.id === 'n_shell001'), 'Backspace never reached the canvas');
});

test('after a keyboard "Save agent" the focus stays on the saved card, so an arrow never nudges the selected card', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  assert.equal(c.applyOps([{ op: 'add_node', id: 'n_shell001', kind: 'script', key: 'shell', x: 400, y: 420 }], 'add shell').ok, true);
  c.select({ kind: 'node', id: 'n_shell001' });
  await chatSend(w, 'Create an agent');
  chatStart(recv);
  const draft = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'agent-draft', sessionId: w.__wfv.session, docToken: c.docToken(),
    draft: { key: 'docsWriter', meta: { displayName: 'Docs Writer', runnerType: 'producer', inputs: [{ id: 'plan', type: 'md' }], outputs: [] }, markdown: '# x' }, then: null } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: draft });
  await tick(4);
  const sel = '#wfc [data-card-id="card_0000dddd"]';
  const save = [...doc.querySelectorAll(`${sel} button`)].find((b) => b.textContent === 'Save agent');
  save.focus();
  save.click();
  await tick(8);
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, block: { ...draft, state: 'saved' } });
  await tick(6);
  assert.equal(save.isConnected, false, 'precondition: the saved card is a new element');
  assert.ok(doc.querySelector(sel).contains(doc.activeElement), `the focus is on the saved card, not ${doc.activeElement.tagName}`);
  const before = JSON.stringify(c.template().nodes.find((n) => n.id === 'n_shell001'));
  doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await tick(3);
  assert.equal(JSON.stringify(c.template().nodes.find((n) => n.id === 'n_shell001')), before);
});

test('an own edit after a chat edit stands the reused card\'s inline Undo down (sig carries undoLive)', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  await chatSend(w, 'Add Plan');
  chatStart(recv);
  const blk = { kind: 'card', id: 'card_0000aaaa', state: 'proposed', card: { type: 'canvas-edit', sessionId: w.__wfv.session, docToken: c.docToken(), summary: 'Add Plan',
    ops: [{ op: 'add_node', id: 'n_plan0001', kind: 'agent', key: 'planner', x: 700, y: 198 }], added: [], removed: [], todo: 0, warnings: [] } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: blk });
  await tick(6);
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, block: { ...blk, state: 'applied' } });
  await tick(6);
  const undo = () => [...doc.querySelectorAll('#wfc [data-card-id="card_0000aaaa"] button')].find((b) => b.textContent === 'Undo');
  assert.equal(undo().disabled, false, 'precondition: the chat step is the canvas\'s last step');
  assert.equal(c.applyOps([{ op: 'add_node', id: 'n_shell001', kind: 'script', key: 'shell', x: 400, y: 420 }], 'add shell').ok, true);   // the user's own edit
  await tick(6);
  assert.equal(undo().disabled, true, 'an enabled Undo here would do nothing when clicked (undoLive is false)');
});

test('another workflow opened drops a draft card\'s "Save & add to canvas" (sig carries onDoc)', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  await chatSend(w, 'Create an agent');
  chatStart(recv);
  const draft = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'agent-draft', sessionId: w.__wfv.session, docToken: c.docToken(),
    draft: { key: 'notesWriter', meta: { displayName: 'Notes Writer', runnerType: 'producer', inputs: [], outputs: [] }, markdown: '# x' },
    then: { ops: [{ op: 'add_node', id: 'n_note0001', kind: 'agent', key: 'notesWriter', x: 500, y: 200 }] } } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: draft });
  await tick(6);
  const has = () => [...doc.querySelectorAll('#wfc [data-card-id="card_0000dddd"] button')].some((b) => b.textContent === 'Save & add to canvas');
  assert.equal(has(), true, 'precondition');
  await go(w, 'workflows/wf_g');                      // another saved workflow (a clean canvas: no discard prompt)
  await tick(6);
  assert.notEqual(c.docToken(), draft.card.docToken);
  assert.equal(has(), false, 'the card was made for the other document');
});

test('New chat over an unsaved chat draft asks in the app\'s confirm modal; Cancel keeps the chat and hands the focus back to New chat', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  await chatSend(w, 'Create an agent');
  chatStart(recv);
  const draft = { kind: 'card', id: 'card_0000dddd', state: 'proposed', card: { type: 'agent-draft', sessionId: w.__wfv.session, docToken: c.docToken(),
    draft: { key: 'notesWriter', meta: { displayName: 'Notes Writer', runnerType: 'producer', inputs: [], outputs: [] }, markdown: '# x' }, then: null } };
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: draft });
  recv({ type: 'ask-done', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, text: 'Drafted.', blocks: [draft] });
  await tick(6);
  const nb = doc.getElementById('wfc-new');
  const modal = doc.getElementById('confirm-modal');
  nb.focus();
  nb.click();
  await tick(2);
  assert.equal(modal.classList.contains('hidden'), false, 'it asks first');
  assert.equal(doc.getElementById('confirm-message').textContent,
    'This chat holds 1 unsaved draft (Notes Writer). Start a new chat and leave it? This chat cannot be reopened.');
  doc.getElementById('confirm-cancel').click();
  await tick(2);
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(doc.activeElement, nb, `the focus is on New chat, not ${doc.activeElement.tagName}`);
  assert.equal(w.__wfv.chat().client.threadId(), 'ask_0000abcd', 'Cancel keeps the chat');
  assert.ok(doc.querySelector('#wfc [data-card-id="card_0000dddd"]'), '…and its draft');
  nb.click();
  await tick(2);
  doc.getElementById('confirm-ok').click();
  await tick(2);
  assert.equal(w.__wfv.chat().client.threadId(), null, 'confirmed: a new chat');
  assert.equal(doc.querySelector('#wfc [data-card-id]'), null);
});

test('review M1: after a zoom-menu pick, a toolbar toggle or the Library End "+", Delete never reaches the canvas', async () => {
  const { window: w } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const delOnFocus = () => doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  const end = c.template().nodes.find((n) => n.kind === 'end');
  c.select({ kind: 'node', id: end.id });
  const zoom = doc.getElementById('wfv-zoom');
  zoom.focus();
  zoom.click();
  doc.querySelector('.wfv-menu-item').click();
  assert.equal(doc.activeElement, zoom, 'the zoom trigger');
  delOnFocus();
  assert.ok(c.template().nodes.some((n) => n.id === end.id), 'a zoom pick then Delete: End stays');
  // Delete End, then place it again from the Library's Flow group.
  c.select({ kind: 'node', id: end.id });
  c.deleteSelection();                                    // the user's own delete (applyOps refuses a batch losing End)
  assert.equal(c.template().nodes.some((n) => n.kind === 'end'), false);
  await tick(2);
  w.__wfv.library().open('agents');
  const add = doc.querySelector('#wfv-library .wfl-item[data-item="flow:end"] .wfl-add');
  add.focus();
  add.click();
  await tick(2);
  const again = c.template().nodes.find((n) => n.kind === 'end');
  assert.ok(again, 'the "+" placed a new End');
  assert.notEqual(doc.activeElement, doc.body, `the focus is on ${doc.activeElement.tagName}, never <body>`);
  delOnFocus();
  assert.ok(c.template().nodes.some((n) => n.id === again.id), 'the Library "+" then Delete: the new End stays');
});

test('review m4: a failed runtimes probe is not cached — the next registry load asks again; an ok answer is kept', async () => {
  const { window: w, requests, recv } = await boot();
  const real = globalThis.fetch;
  let probes = 0;
  globalThis.fetch = (u, init) => {
    if (String(u).split('?')[0].endsWith('/api/scripts/runtimes')) {
      probes += 1;
      requests.push({ method: 'GET', url: String(u) });
      if (probes === 1) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    }
    return real(u, init);
  };
  try {
    await go(w, 'workflows');
    assert.equal(probes, 1, 'the entry probed once and failed');
    recv({ type: 'scripts-changed' });                    // the open view reloads the registry
    await tick(6);
    assert.equal(probes, 2, 'a failure is asked again');
    recv({ type: 'scripts-changed' });
    await tick(6);
    assert.equal(probes, 2, 'an ok answer is kept for the page');
  } finally { globalThis.fetch = real; }
});

test('review m3: a chat-saved draft is highlighted once its Library row exists (the registry reloaded first)', async () => {
  const { window: w, recv } = await boot();
  await go(w, 'workflows');
  const doc = w.document;
  const c = w.__gv().c;
  const NOTES = { key: 'notesWriter', displayName: 'Notes Writer', origin: 'user', domain: 'general', color: 'green', metaVersion: 2, runnerType: 'producer',
    inputs: [{ id: 'plan', type: 'md', required: true }], outputs: [{ id: 'notes', type: 'md', when: 'always', filename: 'notes.md' }] };
  const LINT = { key: 'lintAll', displayName: 'Lint all', origin: 'user', runtime: 'shell', metaVersion: 2, inputs: [], outputs: [] };
  let posted = { agent: false, script: false };
  const real = globalThis.fetch;
  const json = (v, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v });
  globalThis.fetch = (u, init) => {
    const p = String(u).split('?')[0];
    const method = (init && init.method) || 'GET';
    if (p.endsWith('/api/agents') && method === 'POST') { posted.agent = true; w.__setAgents([...AGENTS, NOTES]); return json({ meta: NOTES }, 201); }
    if (p.endsWith('/api/scripts') && method === 'POST') { posted.script = true; return json({ meta: LINT }, 201); }
    if (p.endsWith('/api/scripts') && method === 'GET' && posted.script) return json({ scripts: [...SCRIPTS, LINT] });
    return real(u, init);
  };
  const lib = w.__wfv.library();
  const orig = lib.highlight;
  const seen = [];
  lib.highlight = (kind, key) => { orig(kind, key); seen.push([kind, key, !!doc.querySelector(`#wfv-library .wfl-item[data-item="${kind}:${key}"]`)]); };
  try {
    await chatSend(w, 'Create an agent and a script');
    chatStart(recv);
    const at = { sessionId: w.__wfv.session, docToken: c.docToken() };
    recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 2, block: { kind: 'card', id: 'card_0000dddd', state: 'proposed',
      card: { type: 'agent-draft', ...at, draft: { key: 'notesWriter', meta: NOTES, markdown: '# Notes' }, then: null } } });
    recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'askm_0000bbbb', seq: 3, block: { kind: 'card', id: 'card_0000eeee', state: 'proposed',
      card: { type: 'script-draft', ...at, draft: { key: 'lintAll', meta: LINT, source: 'npm run lint', cases: [] }, then: null } } });
    await tick(4);
    [...doc.querySelectorAll('#wfc [data-card-id="card_0000dddd"] button')].find((b) => b.textContent === 'Save agent').click();
    await tick(10);
    [...doc.querySelectorAll('#wfc [data-card-id="card_0000eeee"] button')].find((b) => b.textContent === 'Save script').click();
    await tick(10);
    assert.deepEqual(seen, [['agent', 'notesWriter', true], ['script', 'lintAll', true]], 'each row existed when it was highlighted');
  } finally { globalThis.fetch = real; lib.highlight = orig; }
});
