// test/ui-composer-app.test.mjs — the composer's app.js integration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realRegistryIndex } from './helpers/graph-ports.mjs';

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
];
const V2_ROW = { id: 'wf_g', name: 'Graph one', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };
const V1_ROW = { id: 'wf_old', name: 'Legacy one', version: 1, domain: 'coding', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] };

const DEFAULT_ROW = { id: 'wf_default', name: 'Default', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };

async function boot({ agentsFail = false, archived = [], workflows = null, del = null } = {}) {
  const rows = workflows || [V2_ROW, V1_ROW];
  const deletes = [];
  let agentList = AGENTS;
  let agentsDown = agentsFail;
  let agentFetches = 0;
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const json = (v, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v });
  window.fetch = (u, init) => {
    const url = String(u);
    // POST /api/workflows/import-json — the Import… path: mint a row, echo the
    // share contract ({workflow, renamed, requestedName, warnings}).
    if (url.includes('/api/workflows/import-json')) {
      const src = JSON.parse(init.body).workflow;
      const row = { ...src, id: `wf_${String(src.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, origin: null };
      rows.push(row);
      return json({ workflow: row, renamed: false, requestedName: src.name, warnings: [] }, 201);
    }
    if (init && init.method === 'DELETE') {
      deletes.push(url);
      if (del) return json(del.body, del.status);
      // A successful DELETE removes the row, so the list refresh is OBSERVABLE:
      // a fix that forgets gvRefreshSaved() leaves the deleted row on screen.
      const id = decodeURIComponent(url.replace(/^.*\/api\/workflows\//, ''));
      const at = rows.findIndex((w) => w.id === id);
      if (at >= 0) rows.splice(at, 1);
      return json({ ok: true });
    }
    if (url.includes('/api/agents')) {
      agentFetches += 1;
      return agentsDown ? Promise.reject(new Error('down')) : json({ agents: agentList });
    }
    if (url.includes('/api/workflows?archived=1')) return json({ workflows: archived });
    // GET /api/workflows/<id> — the saved list's Open path reads the full row.
    const one = url.match(/\/api\/workflows\/([^?]+)/);
    if (one) return json(rows.find((w) => w.id === decodeURIComponent(one[1])) || null, one ? 200 : 404);
    if (url.includes('/api/workflows')) return json({ workflows: rows });
    if (url.includes('/api/config')) return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
    return json({ projects: [], runs: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  window.location.hash = 'composer';
  window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  window.__deletes = deletes;
  window.__setAgents = (list) => { agentList = list; };
  window.__failAgents = (v) => { agentsDown = v; };
  window.__agentFetches = () => agentFetches;
  window.__resetAgentFetches = () => { agentFetches = 0; };
  return window;
}

test('entering the composer mounts once, preloads Task+End and lists saved rows', async () => {
  const win = await boot();
  const doc = win.document;
  assert.ok(doc.querySelector('#gv-canvas .gv-stage'), 'stage mounted');
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1);
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, 2, 'new canvas preloads Task + End');
  assert.equal(doc.querySelector('.gv-empty'), null, 'no empty-state overlay on the canvas');
  assert.ok(doc.querySelector('#gv-palette .ap[data-key="planner"]'), 'palette rendered from /api/agents');
  const rows = [...doc.querySelectorAll('#gv-saved-list .pl-item')];
  assert.equal(rows.length, 2);
  assert.ok(rows[0].querySelector('svg'), 'v2 row carries a thumbnail');
  assert.equal(rows[1].querySelector('.pl-legacy').textContent, 'legacy · runnable until the graph cut-over');
  assert.ok(rows[0].querySelector('.pl-row.pl-openable'), 'a v2 row IS the Open action');
  assert.equal(rows[1].querySelector('.pl-row.pl-openable'), null, 'a v1 row cannot be opened in the v2 composer');
  assert.equal(doc.querySelector('#gv-saved-list .pl-meta'), null, 'the domain lives in the tab, not the row');
  // re-entry re-fits without re-mounting
  win.location.hash = 'running'; win.dispatchEvent(new win.Event('hashchange'));
  win.location.hash = 'composer'; win.dispatchEvent(new win.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1, 'mounted once');
});

test('an /api/agents failure shows Retry and disables Save; the graph still renders', async () => {
  const win = await boot({ agentsFail: true });
  const doc = win.document;
  assert.match(doc.querySelector('#gv-palette').textContent, /Couldn’t load agents|Couldn't load agents/);
  assert.ok(doc.querySelector('#gv-palette .gv-retry'), 'Retry button');
  assert.equal(doc.querySelector('#gv-save').disabled, true);
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, 2, 'the canvas still renders');
});

test('the Archived footer appears only when the endpoint returns rows', async () => {
  const win = await boot();
  assert.equal(win.document.querySelector('#gv-archived').hidden, true);
  const win2 = await boot({ archived: [{ id: 'wf_dead', name: 'Old', version: 1, archivedAt: '2026-08-26' }] });
  const foot = win2.document.querySelector('#gv-archived');
  assert.equal(foot.hidden, false);
  assert.match(foot.textContent, /Archived \(1\)/);
});

test('leaving the composer calls composerExit: no document listener survives', async () => {
  const win = await boot();
  const doc = win.document;
  win.location.hash = 'running';
  win.dispatchEvent(new win.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));
  const before = doc.querySelectorAll('#gv-canvas .node').length;
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  assert.equal(doc.querySelectorAll('#gv-canvas .node').length, before, 'Backspace elsewhere never edits the graph');
});

test('v2 workflows produce topo-ordered node rows and loop-wire cycle rows', async () => {
  const win = await boot();
  const np = win.__np;
  const tpl = {
    id: 'wf_g2', name: 'G', version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { model: 'sonnet' } },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
      { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' }, config: { maxCycles: 2 } },
      { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
  const reg = { planner: { displayName: 'Plan', color: 'violet', fanOut: true, asksQuestions: true },
    reviewer: { displayName: 'Review', color: 'blue', asksQuestions: true } };
  const rows = np.buildNodeConfigRows(tpl, reg, { nodes: { n_rev: { effort: 'high' } }, wires: {} });
  assert.deepEqual(rows.map((r) => r.nodeId), ['n_plan', 'n_rev'], 'agent nodes only, topo order, loop wire ignored');
  assert.equal(rows[0].label, 'Plan');
  assert.equal(rows[1].effort, 'high', 'per-project override wins');
  assert.equal(rows[1].model, 'sonnet', 'template node.config is layer 2');
  assert.deepEqual(rows[1].override, { effort: 'high' });
  const fbs = np.buildFeedbackRows(tpl, reg, { nodes: {}, wires: { w3: { maxCycles: 5 } } });
  assert.equal(fbs.length, 1, 'one row per LOOP wire');
  assert.equal(fbs[0].fbId, 'w3');
  assert.equal(fbs[0].maxCycles, 5, 'run-config overlay wins over wire.config');
  assert.equal(fbs[0].label, 'Plan ← Review');
  const fbs2 = np.buildFeedbackRows(tpl, reg, { nodes: {}, wires: {} });
  assert.equal(fbs2[0].maxCycles, 2, 'falls back to wire.config.maxCycles');
});

test('a v1 workflow still produces v1 rows (no regression)', async () => {
  const win = await boot();
  const np = win.__np;
  const rows = np.buildNodeConfigRows(V1_ROW, { planner: { displayName: 'Plan' } }, { nodes: {} });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nodeId, 's0_0');
  assert.deepEqual(np.buildFeedbackRows(V1_ROW, {}, { feedbacks: {} }), []);
});

// Export…: every v2 saved row (incl. the built-in) carries ONE Export… button that
// opens the dialog; a v1 row does not. The dialog asks for the format first (JSON
// file / Claude Code skill / Worca plugin) and shows only that format's fields.
// (The plan/apply/download fetches are covered by the API suites.)
test('Export… opens the format dialog for a v2 row, not a v1 row', async () => {
  const win = await boot({ workflows: [DEFAULT_ROW, V2_ROW, V1_ROW] });
  const doc = win.document;
  const rowById = (id) => [...doc.querySelectorAll('#gv-saved-list .pl-item')].find((r) => r.dataset.id === id);
  const hidden = (id) => doc.getElementById(id).classList.contains('hidden');

  // v2 rows (built-in + user) get the button; the v1 row does not. No other row action
  // except delete: Open is the row itself, JSON moved into the dialog.
  assert.equal(rowById('wf_default').querySelector('.pl-export').textContent, 'Export…', 'built-in default is exportable');
  assert.ok(rowById('wf_g').querySelector('.pl-export'), 'a v2 workflow is exportable');
  assert.equal(rowById('wf_old').querySelector('.pl-export'), null, 'a v1 workflow is not exportable');
  assert.equal(rowById('wf_g').querySelectorAll('button, a').length, 2, 'Export… + delete only');
  // Export… is the LAST element of every row (delete sits before it), so it lines
  // up on the same right edge whether or not the row has a delete.
  assert.ok(rowById('wf_g').querySelector('.pl-row').lastElementChild.classList.contains('pl-export'));
  assert.ok(rowById('wf_default').querySelector('.pl-row').lastElementChild.classList.contains('pl-export'));

  const modal = doc.getElementById('export-modal');
  assert.ok(modal.classList.contains('hidden'), 'modal starts hidden');

  rowById('wf_g').querySelector('.pl-export').dispatchEvent(new win.Event('click'));
  assert.equal(modal.classList.contains('hidden'), false, 'clicking Export… opens the dialog');
  assert.match(doc.getElementById('export-subtitle').textContent, /Graph one/);
  // Default format: JSON — Download enabled, no Plan, no skill/plugin fields.
  assert.ok(doc.querySelector('#export-format .seg-btn[data-format="json"]').classList.contains('on'));
  assert.equal(doc.getElementById('export-apply-btn').textContent, 'Download');
  assert.equal(doc.getElementById('export-apply-btn').disabled, false);
  assert.ok(hidden('export-plan-btn') && hidden('export-slug-field') && hidden('export-dest-field') && hidden('export-plugin-field'));
  // Skill: location + slug + agents; Apply waits for a Plan.
  doc.querySelector('#export-format .seg-btn[data-format="skill"]').dispatchEvent(new win.Event('click'));
  assert.equal(doc.getElementById('export-apply-btn').textContent, 'Apply');
  assert.equal(doc.getElementById('export-apply-btn').disabled, true);
  assert.ok(!hidden('export-plan-btn') && !hidden('export-slug-field') && !hidden('export-dest-field') && hidden('export-plugin-field'));
  assert.ok(hidden('export-folder-field'), 'global location needs no folder');
  assert.equal(doc.getElementById('export-slug-preview').textContent, 'Command: /graph-one', 'slug preview from the name');
  doc.querySelector('#export-dest .seg-btn[data-dest="project"]').dispatchEvent(new win.Event('click'));
  assert.ok(!hidden('export-folder-field'), 'project location asks for the folder');
  // Plugin: folder + plugin fields, no skill fields.
  doc.querySelector('#export-format .seg-btn[data-format="plugin"]').dispatchEvent(new win.Event('click'));
  assert.ok(!hidden('export-folder-field') && !hidden('export-plugin-field') && hidden('export-slug-field') && hidden('export-dest-field'));
  assert.equal(doc.getElementById('export-folder-label').textContent, 'Plugin folder');

  doc.getElementById('export-cancel').dispatchEvent(new win.Event('click'));
  assert.equal(modal.classList.contains('hidden'), true, 'Cancel closes the dialog');
});

// One tab per domain; the row no longer shows its domain; Import… selects the
// imported row's tab and pins a NEW pill on it for the page session.
const GENERAL_ROW = { id: 'wf_gen', name: 'General one', version: 2, domain: 'general',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };

test('the saved list is tabbed by domain, and Import… lands on the imported row\'s tab with a NEW pill', async () => {
  const win = await boot({ workflows: [DEFAULT_ROW, V2_ROW, GENERAL_ROW] });
  const doc = win.document;
  const tabs = () => [...doc.querySelectorAll('#gv-saved-tabs .gv-saved-tab')];
  const listed = () => [...doc.querySelectorAll('#gv-saved-list .pl-item')].map((r) => r.dataset.id);
  assert.deepEqual(tabs().map((t) => t.dataset.domain), ['coding', 'general'], 'alphabetical domain tabs');
  assert.deepEqual(tabs().map((t) => t.querySelector('.gv-saved-tab-badge').textContent), ['2', '1']);
  assert.ok(tabs()[0].classList.contains('active'), 'first tab selected by default');
  assert.deepEqual(listed(), ['wf_default', 'wf_g'], 'only the selected domain is listed');
  assert.equal(doc.getElementById('gv-saved-count').textContent, '· 3', 'the header count is the whole library');
  tabs()[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(listed(), ['wf_gen']);
  assert.ok(tabs()[1].classList.contains('active'));
  assert.equal(doc.getElementById('gv-import-btn').textContent, 'Import…');

  // Import a coding pipeline while the general tab is selected.
  const input = doc.getElementById('gv-import-file');
  const file = { name: 'shared.json', text: async () => JSON.stringify({ ...V2_ROW, id: undefined, name: 'Shared In' }) };
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new win.Event('change'));
  await tick(8);
  assert.ok(tabs()[0].classList.contains('active'), 'the imported row\'s domain tab is selected');
  assert.deepEqual(listed(), ['wf_default', 'wf_g', 'wf_shared-in']);
  const pill = doc.querySelector('#gv-saved-list .pl-item[data-id="wf_shared-in"] .pl-new');
  assert.ok(pill && pill.textContent === 'NEW', 'the imported row carries a NEW pill');
  assert.equal(doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-new'), null, 'only the imported one');
  assert.equal(doc.getElementById('gv-saved-msg').textContent, 'Imported "Shared In".');
  assert.deepEqual(tabs().map((t) => t.querySelector('.gv-saved-tab-badge').textContent), ['3', '1']);
});

// MAJ-21: a flow card inside a loop must be named by the SHARED FLOW_LABEL table
// (the same one the run monitor's manifest uses), never by its raw node id.
test('the loop caption names an OR flow card "OR", never its raw n_or id', async () => {
  const win = await boot();
  const full = SEED_TEMPLATES.find((t) => t.id === 'wf_full');
  const rows = win.__np.buildFeedbackRows(full, realRegistryIndex(), {});
  assert.deepEqual(rows.map((r) => r.label), [
    'Refine Plan \u21ba (self loop)',
    'OR \u2190 Review Implementation',
    'OR \u2190 Manual web UI testing',
  ]);
  assert.equal(rows.some((r) => /n_/.test(r.label)), false, 'no raw node id reaches the caption');
});

// --------------------------------------------------------------------- MAJ-6
// The two user paths that replace the canvas and wipe the undo ring must ask
// first. app.js installs composer.hooks.confirmDiscard from its own
// confirmModal, so the assertion is on the REAL #confirm-modal overlay.
const modalUp = (doc) => !doc.getElementById('confirm-modal').classList.contains('hidden');

test('MAJ-6: the saved list\'s Open asks before discarding unsaved edits', async () => {
  const win = await boot();
  const doc = win.document;
  const c = win.__gv().c;
  c.spawn({ key: 'planner' });
  const nodes = c.template().nodes.length;
  const depth = c.undoDepth();
  assert.equal(c.isDirty(), true, 'precondition: dirty');
  doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-row')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(modalUp(doc), true, 'the confirm modal is up');
  assert.equal(doc.getElementById('confirm-title').textContent, 'Discard unsaved changes?');
  assert.equal(doc.getElementById('confirm-ok').textContent, 'Discard');
  doc.getElementById('confirm-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.template().nodes.length, nodes, 'Cancel keeps the canvas');
  assert.equal(c.undoDepth(), depth, 'Cancel keeps the undo ring');
  assert.equal(c.isDirty(), true);
  // …and Confirm goes through.
  doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-row')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.template().id, 'wf_g', 'Discard loads the row');
  assert.equal(c.undoDepth(), 0);
});

test('MAJ-6: the New-canvas header button asks too, and a clean canvas never does', async () => {
  const win = await boot();
  const doc = win.document;
  const c = win.__gv().c;
  doc.getElementById('gv-new').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(modalUp(doc), false, 'a clean canvas is never guarded');
  c.spawn({ key: 'planner' });
  const nodes = c.template().nodes.length;
  doc.getElementById('gv-new').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(modalUp(doc), true, 'a dirty canvas asks');
  doc.getElementById('confirm-cancel').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.template().nodes.length, nodes, 'Cancel keeps the work');
});

// -------------------------------------------------------------------- MAJ-17
// gvApi.deleteWorkflow used to return {ok} only, and both call sites threw it
// away: a 400/404/500 left the row in place with NO message. The built-in
// Default additionally rendered an × whose DELETE always answers 400.
const tick = async (n = 4) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

test('MAJ-17: a refused delete surfaces the server error and leaves the list alone', async () => {
  const win = await boot({ del: { status: 400, body: { error: 'the default workflow cannot be deleted' } } });
  const doc = win.document;
  const before = doc.querySelectorAll('#gv-saved-list .pl-item').length;
  doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-del')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  const msg = doc.getElementById('gv-saved-msg');
  assert.equal(msg.textContent, 'the default workflow cannot be deleted', 'the server string, verbatim');
  assert.equal(msg.className, 'form-msg err');
  assert.equal(doc.querySelectorAll('#gv-saved-list .pl-item').length, before, 'the row is still there');
});

test('MAJ-17: a successful delete clears the message and refreshes', async () => {
  const win = await boot();
  const doc = win.document;
  doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-del')
    .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(doc.getElementById('gv-saved-msg').textContent, '');
  assert.equal(win.__deletes.length, 1);
  assert.equal(doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"]'), null,
    'the list is refreshed: the deleted row is gone');
});

test('MAJ-17: the built-in Default row opens but has no delete', async () => {
  const win = await boot({ workflows: [DEFAULT_ROW, V2_ROW, V1_ROW] });
  const doc = win.document;
  const def = doc.querySelector('#gv-saved-list .pl-item[data-id="wf_default"]');
  assert.ok(def, 'the built-in is listed');
  assert.ok(def.querySelector('.pl-row.pl-openable'), 'opening stays — the built-in is editable as a copy');
  assert.equal(def.querySelector('.pl-del'), null, 'no delete on a row DELETE can never accept');
  const del = doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-del');
  assert.ok(del, 'every other v2 row keeps its delete');
  assert.ok(del.querySelector('svg'), 'icon-only: the shared bin glyph');
  assert.equal(del.textContent.trim(), '', 'no text label');
  assert.equal(del.getAttribute('aria-label'), 'Delete "Graph one"');
});

test('the row\'s own actions do not open it, and Enter/Space on the row does', async () => {
  const win = await boot({ workflows: [DEFAULT_ROW, V2_ROW] });
  const doc = win.document;
  const c = win.__gv().c;
  const row = doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-row');
  assert.equal(row.getAttribute('role'), 'button');
  assert.equal(row.tabIndex, 0);
  // Clicking Export… (a button inside the row) must not ALSO open the row.
  row.querySelector('.pl-export').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.notEqual(c.template().id, 'wf_g', 'Export… did not open the row');
  assert.equal(doc.getElementById('export-modal').classList.contains('hidden'), false, 'it opened the dialog');
  doc.getElementById('export-cancel').dispatchEvent(new win.Event('click'));
  // Keyboard: Enter on the focused row opens it (the canvas is clean, so no guard).
  row.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick();
  assert.equal(c.template().id, 'wf_g', 'Enter opens the row');
});

test('MAJ-17: the archived chip surfaces its refusal too', async () => {
  const win = await boot({ archived: [{ id: 'wf_dead', name: 'Old', version: 1, archivedAt: '2026-08-26' }],
    del: { status: 404, body: { error: 'workflow not found' } } });
  const doc = win.document;
  doc.querySelector('#gv-archived .pl-chip').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(doc.getElementById('gv-saved-msg').textContent, 'workflow not found');
  assert.equal(doc.querySelectorAll('#gv-archived .pl-chip').length, 1, 'the chip is still there');
});

// --------------------------------------------------------------------- MAJ-4
// A plugin-owned row is replaced wholesale by the next `worca plugin update`,
// so the saved list has to SAY so before the user starts editing it.
const PLUGIN_WF = { id: 'wfp_demo-plug_flow', name: 'demo-plug example flow', version: 2, domain: 'coding',
  origin: 'plugin:demo-plug',
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }], wires: [] };

test('MAJ-4: a plugin-origin row carries a plugin:<name> badge; a user row does not', async () => {
  const win = await boot({ workflows: [PLUGIN_WF, V2_ROW] });
  const doc = win.document;
  const badge = doc.querySelector('#gv-saved-list .pl-item[data-id="wfp_demo-plug_flow"] .pl-origin');
  assert.ok(badge, 'the plugin row is badged');
  assert.equal(badge.textContent, 'plugin:demo-plug');
  assert.equal(badge.title, 'Provided by plugin "demo-plug" — replaced on plugin update');
  assert.equal(doc.querySelector('#gv-saved-list .pl-item[data-id="wf_g"] .pl-origin'), null,
    'a user-created row is not badged');
});

// -------------------------------------------------------------------- MAJ-16
// gvAgents/gvAgentsAll/gvPortsFn are written ONLY by gvLoadAgents(), which
// initComposer() skips on re-entry — so an agent created or re-ported in the
// Agents view stayed missing/stale in the Composer for the whole page session
// (dev had `_composerPaletteDirty`; the rebuild dropped it).
const TESTER = { key: 'tester', displayName: 'Test', domain: 'coding', color: 'green', order: 9, metaVersion: 2,
  inputs: [{ id: 'done', type: 'md', required: true }],
  outputs: [{ id: 'report', type: 'md', when: 'always' }] };
const reenterComposer = async (win) => {
  win.location.hash = 'running'; win.dispatchEvent(new win.Event('hashchange'));
  await tick();
  win.location.hash = 'composer'; win.dispatchEvent(new win.Event('hashchange'));
  await tick(8);
};

test('MAJ-16: an agent mutation refreshes the composer palette and portsFn on re-entry', async () => {
  const win = await boot();
  const doc = win.document;
  assert.ok(doc.querySelector('#gv-palette .ap[data-key="planner"]'), 'precondition: planner in the palette');
  assert.equal(doc.querySelector('#gv-palette .ap[data-key="tester"]'), null, 'precondition: no tester yet');
  assert.ok(win.__gv().v.ports({ id: 'n1', kind: 'agent', key: 'planner' }).inputs.some((p) => p.id === 'revise'),
    'precondition: planner has a revise input');

  // The registry gains an agent AND planner loses a port…
  const planner2 = { ...AGENTS[0], inputs: [{ id: 'task', type: 'md', required: true }] };
  win.__setAgents([planner2, AGENTS[1], TESTER]);
  // …and a real agent mutation runs, which is what invalidates the caches.
  const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await p;

  // Nothing changes until the composer is re-entered (it is not the live view).
  await reenterComposer(win);
  assert.ok(doc.querySelector('#gv-palette .ap[data-key="tester"]'), 'the new agent is in the palette');
  assert.equal(win.__gv().v.ports({ id: 'n1', kind: 'agent', key: 'planner' }).inputs.some((p2) => p2.id === 'revise'),
    false, 'portsFn no longer reports the deleted port');
  assert.equal(doc.querySelectorAll('#gv-canvas .gv-stage').length, 1, 'still mounted exactly once');
});

test('MAJ-16: a re-entry with no agent mutation does NOT refetch the registry', async () => {
  const win = await boot();
  win.__resetAgentFetches();
  await reenterComposer(win);
  assert.equal(win.__agentFetches(), 0, 'the palette is only refetched when something invalidated it');
  // …and one mutation costs exactly one reload, not one per re-entry.
  const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
  await tick();
  win.document.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await p;
  win.__resetAgentFetches();
  await reenterComposer(win);
  const afterFirst = win.__agentFetches();
  assert.ok(afterFirst > 0, 'the invalidated composer reloads once');
  win.__resetAgentFetches();
  await reenterComposer(win);
  assert.equal(win.__agentFetches(), 0, 'and not again on the next re-entry');
});

test('MAJ-16: a FAILED reload leaves the composer dirty so the next re-entry retries', async () => {
  const win = await boot();
  const doc = win.document;
  win.__setAgents([...AGENTS, TESTER]);
  const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await p;
  win.__failAgents(true);
  await reenterComposer(win);
  assert.match(doc.querySelector('#gv-palette').textContent, /Couldn.t load agents/, 'the reload failed');
  win.__failAgents(false);
  await reenterComposer(win);
  assert.ok(doc.querySelector('#gv-palette .ap[data-key="tester"]'), 'the retry lands on the next re-entry');
});

test('MAJ-16: after a registry reload the OPEN canvas is re-validated against the new ports', async () => {
  const win = await boot();
  const doc = win.document;
  win.__gv().c.loadTemplate({ id: 'wf_loop', name: 'Loop', version: 2, domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
      { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' } },
      { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] });
  await tick();
  assert.equal(doc.getElementById('gv-errors').hidden, true, 'precondition: the loop graph is clean');
  const planner2 = { ...AGENTS[0], inputs: [{ id: 'task', type: 'md', required: true }] };   // `revise` deleted in the Agents view
  win.__setAgents([planner2, AGENTS[1]]);
  const p = win.__agents.deleteAgentCard(null, { key: 'gone', displayName: 'Gone' });
  await tick();
  doc.getElementById('confirm-ok').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await p;
  await reenterComposer(win);
  assert.equal(doc.getElementById('gv-errors').hidden, false, 'the wire into the deleted port is flagged after the reload');
  assert.equal(doc.getElementById('gv-save').disabled, true, 'Save is disabled instead of 422ing later');
});
