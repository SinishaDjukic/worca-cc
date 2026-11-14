// test/stillhet-workflow-live.test.mjs — the live Workflows I/O (Stillhet slice 7 D2): every request from WORKFLOW_ACTIONS,
// busy and network refusals, delete after the undo window, the skill export's plan before its apply, the script bench's
// frames, drafts across a refresh and stale or invalid drafts refused with nothing sent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startWorkflowLive, WORKFLOW_ACTIONS } from '../ui/public/stillhet/live/workflow-live.mjs';
import { WF_LISTS, wfTemplate } from './helpers/stillhet-workflows-host.mjs';

const ALL = [];   // every request of every rig: checked against the table at the end
after(() => {
  const known = Object.values(WORKFLOW_ACTIONS).map(([, f]) => f);
  for (const c of ALL) {
    const fits = known.some((f) => { try { const [m, u] = f(c.args || {}); return m === c.method && u.split('?')[0] === c.url.split('?')[0]; } catch { return false; } });
    assert.ok(fits || /^\/api\/(workflows\/[^/]+|agents\/[^/]+|scripts\/[^/]+|workflows\/[^/]+\/(json|export))$/.test(c.url), `${c.method} ${c.url} is not in WORKFLOW_ACTIONS`);
  }
});

function rig({ answer = () => null, lists = WF_LISTS } = {}) {
  const calls = [], toasts = [], gone = [], downloads = [], timers = [];
  let changes = 0;
  const fetch = async (url, o = {}) => {
    const method = o.method || 'GET', body = o.body ? JSON.parse(o.body) : undefined;
    calls.push({ method, url, body }); ALL.push({ method, url });
    const a = await answer(method, url, body);
    if (a === 'down') throw new TypeError('Failed to fetch');
    const one = method === 'GET' && /^\/api\/workflows\/[^/]+$/.test(url) && (lists['/api/workflows']?.workflows || []).find((w) => `/api/workflows/${w.id}` === url);   // Save's re-read (D9)
    const [status, data] = a || (method === 'GET' && lists[url] ? [200, structuredClone(lists[url])] : one ? [200, structuredClone(one)] : [200, { ok: true }]);
    return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
  };
  const live = startWorkflowLive({ fetch, toast: (t) => toasts.push(t), go: (h) => gone.push(h), on: () => { changes += 1; }, download: (u, n) => downloads.push([u, n]),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].fn = null; } });
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { live, calls, writes, toasts, gone, downloads, timers, changes: () => changes, fire: () => { for (const t of timers.splice(0)) t.fn?.(); } };
}
const ready = async (r) => { await r.live.load(); return r; };

test('load reads the five lists and maps them; status goes loading → ready', async () => {
  const r = rig();
  assert.equal(r.live.status(), 'loading');
  await r.live.load();
  assert.equal(r.live.status(), 'ready');
  assert.deepEqual(r.calls.map((c) => c.url).sort(), ['/api/agents', '/api/chat-home/pins', '/api/scripts', '/api/workflow-usage', '/api/workflows']);
  const d = r.live.data();
  assert.deepEqual(d.workflow.map((w) => w.id), WF_LISTS['/api/workflows'].workflows.map((w) => w.id));
  assert.equal(d.workflow.find((w) => w.id === 'wf_full').tasks, 2);
  assert.equal(d.workflow.find((w) => w.id === 'wf_mine').own, true);
  assert.ok(d.agent.some((a) => a.id === 'planner'));
  assert.deepEqual(d.script.map((s) => s.id), ['diffGate']);
});

test('a failed list read reads failed; a network failure answers "Worca is not answering"', async () => {
  const r = rig({ answer: (m, u) => (u === '/api/agents' ? [500, { error: 'boom' }] : null) });
  await r.live.load();
  assert.equal(r.live.status(), 'failed');
  const r2 = await ready(rig({ answer: (m) => (m !== 'GET' ? 'down' : null) }));
  const a = await r2.live.act('pin', { pins: ['wf_full'] });
  assert.deepEqual(a, { ok: false, status: 0, data: {}, error: 'Worca is not answering' });
});

test('each WORKFLOW_ACTIONS write sends its method, URL and body', async () => {
  const r = await ready(rig());
  const cases = [
    ['pin', { pins: ['wf_full'] }, ['PUT', '/api/chat-home/pins', { pins: ['wf_full'] }]],
    ['copy-workflow', { tpl: { ...wfTemplate('wf_mine'), id: 'wf_mine' }, name: 'Mine copy' }, ['POST', '/api/workflows']],
    ['save-workflow', { tpl: wfTemplate('wf_mine') }, ['POST', '/api/workflows', wfTemplate('wf_mine')]],
    ['save-agent', { key: 'sec', meta: { key: 'sec' }, markdown: 'x' }, ['PUT', '/api/agents/sec', { meta: { key: 'sec' }, markdown: 'x' }]],
    ['import-check', { workflow: { a: 1 } }, ['POST', '/api/workflows/import-json', { workflow: { a: 1 }, dryRun: true }]],
    ['export-plugin', { id: 'wf_mine', pluginDir: '/tmp/p' }, ['POST', '/api/workflows/wf_mine/export', { destination: 'plugin', pluginDir: '/tmp/p' }]],
  ];
  for (const [id, args, want] of cases) {
    const n = r.calls.length;
    await r.live.act(id, args);
    const c = r.calls[n];
    assert.equal(c.method, want[0], id); assert.equal(c.url, want[1], id);
    if (want[2]) assert.deepEqual(c.body, want[2], id);
  }
  const copy = r.calls.find((c) => c.body?.name === 'Mine copy');
  assert.equal(copy.body.id, undefined, 'Use as a template posts with no id');
});

test('a double press answers busy and sends one request', async () => {
  const r = await ready(rig());
  const a = r.live.act('pin', { pins: ['a'] }), b = await r.live.act('pin', { pins: ['b'] });
  assert.deepEqual(b, { ok: false, status: 0, data: {}, error: 'busy' });
  await a;
  assert.equal(r.writes().length, 1);
});

test('deferDelete sends DELETE only after the window, and none on undo', async () => {
  const r = await ready(rig());
  const u = r.live.deferDelete('workflow', 'wf_mine', 5000);
  assert.equal(r.writes().length, 0);
  assert.equal(r.timers[0].ms, 5000);
  u.undo(); r.fire();
  assert.equal(r.writes().length, 0, 'undo sends nothing');
  r.live.deferDelete('workflow', 'wf_mine', 5000); r.fire();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(r.writes().map((c) => [c.method, c.url]), [['DELETE', '/api/workflows/wf_mine']]);
});

test('deferDelete hides the thing at once and through a refresh; a second delete sends nothing more; undo brings it back', async () => {
  const r = await ready(rig());
  const ids = () => r.live.data().workflow.map((w) => w.id);
  const u = r.live.deferDelete('workflow', 'wf_mine', 5000);
  assert.ok(!ids().includes('wf_mine'), 'gone at once');
  await r.live.refresh('workflows');
  assert.ok(!ids().includes('wf_mine'), 'a refresh in the window keeps it gone');
  assert.equal(r.live.deferDelete('workflow', 'wf_mine', 5000), u, 'the same handle');
  assert.equal(r.timers.length, 1, 'one timer');
  u.undo();
  assert.ok(ids().includes('wf_mine'), 'undo brings it back');
  r.fire(); await new Promise((res) => setImmediate(res));
  assert.equal(r.writes().length, 0);
  r.live.deferDelete('workflow', 'wf_mine', 5000); r.live.deferDelete('workflow', 'wf_mine', 5000);
  r.fire(); await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(r.writes().map((c) => c.method), ['DELETE'], 'exactly one DELETE');
});

test('undo after the window fired answers false and keeps the thing hidden while its DELETE runs', async () => {
  let release;
  const r = await ready(rig({ answer: (m) => (m === 'DELETE' ? new Promise((res) => { release = () => res([200, { ok: true }]); }) : null) }));
  const ids = () => r.live.data().workflow.map((w) => w.id);
  const u = r.live.deferDelete('workflow', 'wf_mine', 5000);
  assert.equal(u.undo !== undefined, true);
  r.fire(); await new Promise((res) => setImmediate(res));
  assert.equal(u.undo(), false, 'too late: the DELETE is on its way');
  assert.ok(!ids().includes('wf_mine'), 'not brought back while the DELETE runs');
  release(); await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(r.writes().map((c) => c.method), ['DELETE']);
  const v = r.live.deferDelete('workflow', 'wf_mine', 5000);
  assert.equal(v.undo(), true, 'an undo inside the window answers true');
});

test('two quick pins keep both: the second starts from the list the first wrote', async () => {
  let stored = ['wf_shape'];   // the server keeps what each PUT wrote
  const r = await ready(rig({ answer: (m, u, body) => (u !== '/api/chat-home/pins' ? null : m === 'PUT' ? (stored = body.pins, [200, { pins: stored }]) : [200, { pins: [...stored] }]) }));
  const [a, b] = await Promise.all([r.live.pin('wf_mine', true), r.live.pin('wf_full', true)]);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(r.writes().map((c) => c.body.pins), [['wf_shape', 'wf_mine'], ['wf_shape', 'wf_mine', 'wf_full']]);
  assert.deepEqual(stored, ['wf_shape', 'wf_mine', 'wf_full']);
});

test('the skill export: a plan with conflicts sends no apply; a clean plan is applied without dryRun', async () => {
  const conflicted = await ready(rig({ answer: (m, u, b) => (u.endsWith('/export') && b.dryRun ? [200, { created: [], conflicts: [{ path: 'SKILL.md', reason: 'changed' }] }] : null) }));
  const a = await conflicted.live.exportAs('wf_mine', 'a Claude Code skill');
  assert.equal(a.ok, false); assert.match(a.text, /^Could not export Mine: /);
  assert.equal(conflicted.writes().length, 1);
  const clean = await ready(rig({ answer: (m, u, b) => (u.endsWith('/export') ? [200, b.dryRun ? { created: ['a'], conflicts: [] } : { written: ['a'] }] : null) }));
  const ok = await clean.live.exportAs('wf_mine', 'a Claude Code skill');
  assert.equal(ok.ok, true);
  assert.deepEqual(clean.writes().map((c) => c.body), [{ destination: 'global', dryRun: true }, { destination: 'global' }]);
});

test('the JSON export downloads GET /api/workflows/:id/json; a plugin export without a folder is dev\'s refusal', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u.endsWith('/export') && !b.pluginDir ? [400, { error: 'pluginDir is required for a plugin export' }] : null) }));
  await r.live.exportAs('wf_full', 'a JSON file');
  assert.deepEqual(r.downloads, [['/api/workflows/wf_full/json', 'full.json']]);
  const p = await r.live.exportAs('wf_full', 'a Worca plugin', { pluginDir: '' });
  assert.equal(p.text, 'Could not export Full: pluginDir is required for a plugin export');
});

test('runCases resolves from the matching scriptbench-done frame, even one that came before the POST answer; other benchIds are ignored', async () => {
  let r;
  r = await ready(rig({ answer: (m, u) => (u === '/api/scripts/bench' ? (r.live.frame({ type: 'scriptbench-done', benchId: 'b1', result: { cases: [], passed: 2, failed: 0, unchecked: 0 } }), [200, { benchId: 'b1' }]) : null) }));
  r.live.frame({ type: 'scriptbench-done', benchId: 'other', result: { passed: 0, failed: 2 } });
  const a = await r.live.runCases('diffGate');
  assert.deepEqual(a, { ok: true, text: 'Diff gate: 2 of 2 cases passed' });
  assert.deepEqual(r.writes()[0].body, { key: 'diffGate', caseId: null, all: true, draft: null, params: {}, ports: null, inputs: {}, cwd: { kind: 'scratch' }, timeoutMs: null });
});

test('runCases: 1 failing of 2, a scriptbench-error frame, and a second press while it runs', async () => {
  const r = await ready(rig({ answer: (m, u) => (u === '/api/scripts/bench' ? [200, { benchId: `b${r.writes().length}` }] : null) }));
  const p = r.live.runCases('diffGate');
  assert.deepEqual(await r.live.runCases('diffGate'), { ok: false, text: 'busy' });
  await new Promise((res) => setImmediate(res));
  r.live.frame({ type: 'scriptbench-done', benchId: 'b1', result: { passed: 1, failed: 1, unchecked: 0 } });
  r.live.frame({ type: 'scriptbench-done', benchId: 'b1', result: { passed: 2, failed: 0, unchecked: 0 } });
  assert.deepEqual(await p, { ok: true, text: 'Diff gate: 1 of 2 cases passed' });
  const q = r.live.runCases('diffGate');
  await new Promise((res) => setImmediate(res));
  r.live.frame({ type: 'scriptbench-error', benchId: 'b2', message: 'script "diffGate" has no saved cases' });
  assert.deepEqual(await q, { ok: false, text: 'Could not run the saved cases of Diff gate: script "diffGate" has no saved cases' });
  assert.equal(r.writes().length, 2);
});

test('runCases: no bench id is refused at once; a lost terminal frame answers at the deadline or on a reconnect, and the script runs again', async () => {
  let id = null;
  const r = await ready(rig({ answer: (m, u) => (u === '/api/scripts/bench' ? [200, id ? { benchId: id } : {}] : null) }));
  assert.deepEqual(await r.live.runCases('diffGate'), { ok: false, text: 'Could not run the saved cases of Diff gate: no bench id' });
  id = 'b1';
  const p = r.live.runCases('diffGate');
  await new Promise((res) => setImmediate(res));
  assert.equal(r.timers.at(-1).ms, 600000 * 2 + 30000, 'every case\'s timeout and a margin');
  r.fire();
  assert.deepEqual(await p, { ok: false, text: 'Could not run the saved cases of Diff gate: no answer from Worca' });
  id = 'b2';
  const q = r.live.runCases('diffGate');
  await new Promise((res) => setImmediate(res));
  r.live.reconnect();
  assert.deepEqual(await q, { ok: false, text: 'Could not run the saved cases of Diff gate: no answer from Worca' });
  id = 'b3';
  const s = r.live.runCases('diffGate');
  await new Promise((res) => setImmediate(res));
  r.live.frame({ type: 'scriptbench-done', benchId: 'b3', result: { passed: 2, failed: 0, unchecked: 0 } });
  assert.equal((await s).ok, true, 'not busy after a lost frame');
});

test('a refresh keeps the drafts; a workflows-changed frame reads the list again', async () => {
  const r = await ready(rig());
  const x = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  x.draft = { title: 'Mine', steps: structuredClone(x.steps), loops: [], changes: 1 };
  x.draft.steps[0][2] = 'Haiku 5.5';
  const n = r.calls.length;
  r.live.frame({ type: 'workflows-changed', action: 'saved' });
  await new Promise((res) => setTimeout(res, 10));
  assert.ok(r.calls.slice(n).some((c) => c.url === '/api/workflows'));
  const y = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  assert.notEqual(y, x);
  assert.equal(y.draft.steps[0][2], 'Haiku 5.5');
});

test('save: a stale base or a client-invalid draft sends zero requests, answers Could not save and keeps the draft; a good one POSTs once', async () => {
  let wires = null;
  const lists = structuredClone(WF_LISTS);
  const r = await ready(rig({ answer: (m, u) => (m === 'GET' && u === '/api/workflows' && wires ? [200, { workflows: lists['/api/workflows'].workflows.map((w) => (w.id === 'wf_mine' ? { ...w, wires } : w)) }] : null), lists }));
  let x = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  x.draft = { title: 'Mine', steps: structuredClone(x.steps), loops: structuredClone(x.loops), changes: 1 };
  x.draft.steps[0][2] = 'Haiku 5.5';
  wires = structuredClone(x.tpl.wires); wires.at(-1).id = 'w_changed';
  await r.live.refresh('workflows');
  const n = r.calls.length;
  const a = await r.live.save('workflow', 'wf_mine');
  assert.equal(a.ok, false);
  assert.equal(a.text, 'Could not save Mine: it changed since you started; discard the draft or save a copy');
  assert.equal(r.calls.length, n);
  assert.ok(r.live.data().workflow.find((w) => w.id === 'wf_mine').draft, 'the draft stays');

  const r2 = await ready(rig());
  x = r2.live.data().workflow.find((w) => w.id === 'wf_mine');
  x.draft = { title: 'Mine', steps: structuredClone(x.steps.slice(1)), loops: structuredClone(x.loops), changes: 1 };   // Clarify removed: the task's words would go into Plan's answers (md into json)
  const m = r2.calls.length;
  const b = await r2.live.save('workflow', 'wf_mine');
  assert.equal(b.ok, false); assert.match(b.text, /^Could not save Mine: /);
  assert.equal(r2.calls.length, m);
  assert.ok(x.draft);

  const r3 = await ready(rig());
  x = r3.live.data().workflow.find((w) => w.id === 'wf_mine');
  x.draft = { title: 'Mine', steps: structuredClone(x.steps), loops: structuredClone(x.loops), changes: 1 };
  x.draft.steps[1][2] = 'Haiku 5.5';   // Plan
  const ok = await r3.live.save('workflow', 'wf_mine');
  assert.equal(ok.ok, true, ok.text);
  assert.equal(r3.writes().length, 1);
  assert.equal(r3.writes()[0].body.id, 'wf_mine');
  assert.equal(r3.writes()[0].body.nodes.find((nn) => nn.id === 'n_plan').config.model, 'claude-haiku-5-5');
});

test('save re-reads the server: a change made elsewhere since the list was read refuses with nothing POSTed', async () => {
  const r = await ready(rig({ answer: (m, u) => (m === 'GET' && u === '/api/workflows/wf_mine' ? [200, { ...wfTemplate('wf_mine'), name: 'Mine (changed in another tab)' }] : null) }));
  const x = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  x.draft = { title: 'Mine', steps: structuredClone(x.steps), loops: structuredClone(x.loops), changes: 1 };
  x.draft.steps[1][2] = 'Haiku 5.5';
  const a = await r.live.save('workflow', 'wf_mine');
  assert.equal(a.text, 'Could not save Mine: it changed since you started; discard the draft or save a copy');
  assert.equal(r.writes().length, 0);
});

test('save: a draft made from the template before a refresh (the canvas opened on it) is stale on the new one', async () => {
  const lists = structuredClone(WF_LISTS);
  const r = await ready(rig({ lists }));
  const old = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  const opened = structuredClone(old);   // the canvas's copy, no draft yet
  lists['/api/workflows'].workflows.find((w) => w.id === 'wf_mine').wires.at(-1).id = 'w_chat';   // a chat applied a change
  await r.live.refresh('workflows');
  const now = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  now.draft = { title: 'Mine', steps: structuredClone(opened.steps), loops: structuredClone(opened.loops), changes: 1, base: opened.tpl };
  now.draft.steps[1][2] = 'Haiku 5.5';
  const a = await r.live.save('workflow', 'wf_mine');
  assert.equal(a.ok, false); assert.match(a.text, /changed since you started/);
  assert.equal(r.writes().length, 0);
});

test('save: a second press while it saves answers with no words; a refresh during the save does not bring the draft back', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const r = await ready(rig({ answer: (m, u) => (m === 'POST' && u === '/api/workflows' ? gate.then(() => [200, { workflow: { id: 'wf_mine', name: 'Mine' } }]) : null) }));
  const x = r.live.data().workflow.find((w) => w.id === 'wf_mine');
  x.draft = { title: 'Mine', steps: structuredClone(x.steps), loops: structuredClone(x.loops), changes: 1 };
  x.draft.steps[1][2] = 'Haiku 5.5';
  const p = r.live.save('workflow', 'wf_mine');
  assert.deepEqual(await r.live.save('workflow', 'wf_mine'), { ok: false, text: '' });
  await new Promise((res) => setTimeout(res, 10));
  await r.live.refresh('workflows');   // lands while the POST is out
  release();
  assert.equal((await p).ok, true);
  assert.equal(r.live.data().workflow.find((w) => w.id === 'wf_mine').draft, undefined);
  assert.equal(r.live.drafts.size, 0);
});

test('the import: a non-JSON file is refused before any request; scripts ask first, and No sends no real import', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u === '/api/workflows/import-json' && b.dryRun ? [200, { scriptNodes: [{ key: 'diffGate' }], warnings: [] }] : null) }));
  const file = (name, text) => ({ name, text: async () => text });
  const n = r.calls.length;
  const bad = await r.live.importFile(file('notes.txt', 'hello'));
  assert.equal(bad.ok, false); assert.match(bad.text, /^Could not import notes\.txt: /);
  assert.equal(r.calls.length, n);
  let asked = 0;
  const no = await r.live.importFile(file('Release checklist.json', JSON.stringify(wfTemplate('wf_mine'))), { confirm: async (k) => { asked = k; return false; } });
  assert.equal(asked, 1); assert.equal(no.ok, false);
  assert.deepEqual(r.writes().map((c) => c.body.dryRun), [true]);
  await r.live.importFile(file('Release checklist.json', JSON.stringify(wfTemplate('wf_mine'))), { confirm: async () => true });
  assert.deepEqual(r.writes().at(-1).body.acceptScripts, true);
});

test('an import answers with the new id and its name; a rename says so', async () => {
  const r = await ready(rig({ answer: (m, u, b) => (u === '/api/workflows/import-json' ? [b.dryRun ? 200 : 201, b.dryRun ? { scriptNodes: [] } : { workflow: { id: 'wf_release_checklist_2', name: 'Release checklist (2)' }, renamed: true }] : null) }));
  const a = await r.live.importFile({ name: 'x.json', text: async () => JSON.stringify(wfTemplate('wf_mine')) });
  assert.deepEqual(a, { ok: true, text: 'Imported as Release checklist (2)', id: 'wf_release_checklist_2' });
  assert.deepEqual(r.gone, ['workflows/workflow:wf_release_checklist_2']);
});
