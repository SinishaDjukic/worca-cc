// test/graph-session-notices.test.mjs — before Start run, the user reads how each session will run.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { sessionStartNotices, SESSION_SHARED_SELECTABLE } from '../src/shared/graph/sessions.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn, realAgentMetas } from './helpers/graph-ports.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_no-clarify'));
for (const id of ['n_refine', 'n_decompose']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
const labelOf = (id) => ({ n_refine: 'Refine Plan', n_decompose: 'Decompose' })[id];

// Deviation (correction 13): the master's shared row passed no `sharedReady`; One conversation has no runtime before
// Task 65 (the run-start gate runs such a session separate), so the default says so and the master's line needs it.
test('one line per session, per engine and gate', () => {
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf }), ['2 steps share one session (Refine Plan + Decompose).']);
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'cursor', verified: {}, labelOf }), ['Cursor has no sub-agents: Refine Plan and Decompose run as separate sessions.']);
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'claude', verified: { claude: false }, labelOf }), ['Sub-agents are not available on Claude yet: Refine Plan and Decompose run as separate sessions.']);
  const shared = { ...t, sessions: { s_aaaaaaaa: { mode: 'shared' } } };
  assert.deepEqual(sessionStartNotices(shared, realPortsFn(), { engine: 'cursor', verified: {}, labelOf, sharedReady: true }), ['Refine Plan and Decompose share one conversation.']);
  assert.deepEqual(sessionStartNotices(SEED_TEMPLATES[0], realPortsFn(), { engine: 'claude', labelOf }), []);
});

// ── v2: the Labs flag, One conversation before its runtime, three steps, a label-less card, the shipped gate ──
test('v2 — the flag off, One conversation not built yet, three steps, the shipped gate', () => {
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf, flagOn: false }),
    ['One session is off in Settings › Labs: Refine Plan and Decompose run as separate sessions.'], 'the flag off: every session runs separate (C14)');
  const shared = { ...t, sessions: { s_aaaaaaaa: { mode: 'shared' } } };
  assert.equal(SESSION_SHARED_SELECTABLE, false, 'Task 66 flips it with the runtime; this row then reads the shared line');
  assert.deepEqual(sessionStartNotices(shared, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf }),
    ['One conversation is not available yet: Refine Plan and Decompose run as separate sessions.']);
  const three = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_full'));
  for (const id of ['n_plan', 'n_refine', 'n_decompose']) three.nodes.find((x) => x.id === id).config.session = 's_bbbbbbbb';
  const lab = (id) => ({ n_plan: 'Plan', n_refine: 'Refine Plan', n_decompose: 'Decompose' })[id];
  assert.deepEqual(sessionStartNotices(three, realPortsFn(), { engine: 'cursor', labelOf: lab }), ['Cursor has no sub-agents: Plan, Refine Plan and Decompose run as separate sessions.'],
    'three names: "A, B and C"');
  assert.deepEqual(sessionStartNotices(three, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf: lab }), ['3 steps share one session (Plan + Refine Plan + Decompose).']);
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'claude', verified: { claude: true } }), ['2 steps share one session (n_refine + n_decompose).'], 'no label: the id');
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'claude', labelOf }), ['Sub-agents are not available on Claude yet: Refine Plan and Decompose run as separate sessions.'],
    'the shipped gate (Task 53 flips it, and this row with it)');
  assert.deepEqual(sessionStartNotices(t, realPortsFn(), { engine: 'gemini', labelOf }), ['Gemini CLI has no sub-agents: Refine Plan and Decompose run as separate sessions.']);
  assert.deepEqual(sessionStartNotices(null, realPortsFn(), { engine: 'claude' }), [], 'no template: nothing');
  assert.deepEqual(sessionStartNotices(shared, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf, flagOn: false, sharedReady: true }),
    ['One session is off in Settings › Labs: Refine Plan and Decompose run as separate sessions.'], 'the flag before the mode, as chooseSessionMode');
});

// ── v2: the New pipeline form renders them under the Engine dropdown ──
const trackDom = useDomRelease(afterEach);
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj-notes';
const WF = { ...structuredClone(t), id: 'wf_s', name: 'Sessions' };
const WF2 = { ...structuredClone(t), id: 'wf_s2', name: 'Sessions too' };

async function boot({ hold = null, holdId = WF.id } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4321/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; this._listeners = {}; } send() {} close() {} addEventListener(k, fn) { (this._listeners[k] ||= []).push(fn); } };
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  const agents = realAgentMetas();
  window.fetch = (u) => {
    const url = String(u);
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    for (const w of [WF, WF2]) {
      if (url.includes(`/api/workflows/${w.id}/defaults`)) return ok({ workflow: w, defaults: {} });
      if (url.endsWith(`/api/workflows/${w.id}`)) return hold && holdId === w.id ? hold.then(() => ok(w)) : ok(w);
    }
    if (url.includes('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: WF.id, name: WF.name }, { id: WF2.id, name: WF2.name }] });
    if (url.includes('/api/agents')) return ok({ agents });
    if (url.includes('/api/scripts')) return ok({ scripts: [] });
    return ok({ config: { steps: {}, customModels: [], workflows: {} }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'HTMLInputElement', 'HTMLSelectElement']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, doc: window.document };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(pred, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('waitFor timed out'); await tick(); }
}
const notes = (doc) => [...doc.querySelectorAll('#engine-session-notes .rs-session-note')].map((n) => n.textContent);
const pickSel = (doc, id, v) => { const s = doc.getElementById(id); s.value = v; s.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); };

test('v2 — the New pipeline form: one notice per session under the engine; the engine, the Mock switch and the Labs flag repaint it', async () => {
  const { doc } = await boot();
  const box = doc.getElementById('engine-session-notes');
  assert.equal(box.dataset.minLevel, 'advanced', 'A level, beside the Engine dropdown');
  assert.equal(box.hidden, true, 'nothing before a workflow with a session');
  pickSel(doc, 'projectSelect', PROJECT);
  await tick();
  pickSel(doc, 'workflowSelect', WF.id);
  await waitFor(() => !box.hidden);
  assert.deepEqual(notes(doc), ['One session is off in Settings › Labs: Refine Plan and Decompose run as separate sessions.'], 'the Labs flag ships off');
  applyFlags({ sessionGroups: true }, doc);
  assert.deepEqual(notes(doc), ['Sub-agents are not available on Claude yet: Refine Plan and Decompose run as separate sessions.'], 'the shipped gate');
  doc.getElementById('mock-switch').click();
  assert.deepEqual(notes(doc), ['2 steps share one session (Refine Plan + Decompose).'], 'a mock run counts as verified (C13)');
  pickSel(doc, 'engineSelect', 'cursor');
  await waitFor(() => /Cursor/.test(notes(doc)[0] || ''));
  assert.deepEqual(notes(doc), ['Cursor has no sub-agents: Refine Plan and Decompose run as separate sessions.']);
  assert.equal(box.querySelector('.warn, .amber'), null, 'information, never amber');
  assert.equal(box.dataset.levelKeep, '1', 'Simple keeps a non-Claude engine on screen, and so its notice');
  pickSel(doc, 'engineSelect', 'claude');
  await waitFor(() => /share one session/.test(notes(doc)[0] || ''));
  assert.equal(box.dataset.levelKeep, undefined);
  pickSel(doc, 'workflowSelect', 'wf_auto');
  assert.equal(box.hidden, true, 'Auto picks its workflow per run: no notice');
  pickSel(doc, 'workflowSelect', 'wf_default');
  await waitFor(() => box.hidden);
  assert.deepEqual(notes(doc), [], 'a workflow without a session: no line');
});

test('v3 — a slow fetch for a workflow picked before Auto never paints its notice over Auto', async () => {
  let release = null;
  const hold = new Promise((r) => { release = r; });
  const { doc } = await boot({ hold });
  applyFlags({ sessionGroups: true }, doc);
  const box = doc.getElementById('engine-session-notes');
  pickSel(doc, 'projectSelect', PROJECT);
  await tick();
  pickSel(doc, 'workflowSelect', WF.id);   // its workflow fetch is held
  await tick();
  pickSel(doc, 'workflowSelect', 'wf_auto');
  release();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(doc.getElementById('workflowSelect').value, 'wf_auto');
  assert.equal(box.hidden, true, 'the stale workflow\'s notice is not painted');
  assert.deepEqual(notes(doc), []);
});

test('v4 — a newly picked workflow\'s notice waits for its own fetch: the last one\'s is gone at once, and stays gone on a repaint', async () => {
  let release = null;
  const hold = new Promise((r) => { release = r; });
  const { doc } = await boot({ hold, holdId: WF2.id });
  applyFlags({ sessionGroups: true }, doc);
  const box = doc.getElementById('engine-session-notes');
  pickSel(doc, 'projectSelect', PROJECT);
  await tick();
  pickSel(doc, 'workflowSelect', WF.id);
  await waitFor(() => !box.hidden);
  pickSel(doc, 'workflowSelect', WF2.id);   // its workflow fetch is held
  assert.equal(box.hidden, true, 'the old workflow\'s notice does not stand in for the new one');
  doc.getElementById('mock-switch').click();   // a repaint while the fetch is out
  assert.deepEqual([box.hidden, notes(doc)], [true, []], 'a repaint keeps it empty');
  release();
  await waitFor(() => !box.hidden);
  assert.deepEqual(notes(doc), ['2 steps share one session (Refine Plan + Decompose).'], 'the new workflow\'s own notice, with the Mock switch on');
  doc.getElementById('mock-switch').click();
  assert.deepEqual(notes(doc), ['Sub-agents are not available on Claude yet: Refine Plan and Decompose run as separate sessions.'], 'the same workflow repaints in place');
});

// ── v4: D2 — a member that fans out runs its ×N tasks (or role reviews) outside the session ──
test('v4 — a member that fans out: the line that shares the session says its ×N tasks or role reviews run outside it', () => {
  const full = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_full'));
  for (const id of ['n_impl', 'n_review']) full.nodes.find((x) => x.id === id).config.session = 's_cccccccc';
  const lab = (id) => ({ n_impl: 'Implementation', n_review: 'Review' })[id];
  assert.deepEqual(sessionStartNotices(full, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf: lab }),
    ['2 steps share one session (Implementation + Review). Implementation\'s ×N tasks run outside the session.']);
  assert.deepEqual(sessionStartNotices(full, realPortsFn(), { engine: 'cursor', labelOf: lab }),
    ['Cursor has no sub-agents: Implementation and Review run as separate sessions.'], 'a line that runs them apart needs no note');
  full.nodes.find((x) => x.id === 'n_review').config.roleReview = true;
  assert.deepEqual(sessionStartNotices({ ...full, sessions: { s_cccccccc: { mode: 'shared' } } }, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf: lab, sharedReady: true }),
    ['Implementation and Review share one conversation. Implementation\'s ×N tasks run outside the session. Review\'s role reviews run outside the session.']);
  const unwired = structuredClone(full);
  unwired.wires = unwired.wires.filter((w) => !(w.to.node === 'n_impl' && w.to.port === 'task'));
  unwired.nodes.find((x) => x.id === 'n_review').config.roleReview = false;
  assert.deepEqual(sessionStartNotices(unwired, realPortsFn(), { engine: 'claude', verified: { claude: true }, labelOf: lab }),
    ['2 steps share one session (Implementation + Review).'], 'an unwired ×N input fans nothing out');
});
