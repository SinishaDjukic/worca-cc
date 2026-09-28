// test/wsmap-order-overrides.test.mjs
// M15 (wsmap fix wave): "Suggested change order" and its cycles follow the EFFECTIVE edges — a rejected
// edge (or a confirmed one the scan no longer finds) orders nothing, a manual edge orders its provider
// first — on every render (D8 re-renders included); the synthesizer's order notes show only while that
// order is the one stored with the map, and a stored coordination note naming both members of a pair a
// review emptied is dropped. A re-scan builds its stored order and its synth brief from the overrides the
// run froze at start: the run harness reads them (null on a first scan), the script envelope's
// ctx.workspace carries them, the join card applies them and the render card renders with them.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { renderWorkspaceDescription, countLines } from '../src/shared/workspace-map/render.mjs';
import { changeOrder } from '../src/shared/workspace-map/order.mjs';
import { edgeId, entryId } from '../src/shared/workspace-map/ids.mjs';
import { normKey } from '../src/shared/workspace-map/keys.mjs';
import { emptyOverrides, setEdgeState, addManualEdge } from '../src/shared/workspace-map/overrides.mjs';
import { joinMap, synthBrief } from '../src/core/workspace-map/join.mjs';
import {
  createWorkspace, readWorkspace, saveWorkspaceScanResult, setWorkspaceEdgeState, addWorkspaceManualEdge,
  updateWorkspaceOverrides, readWorkspaceMap, checkNewWorkspace,
} from '../src/core/workspaces.mjs';
import { loadScriptRegistry, DEFAULT_SCRIPTS_DIR } from '../src/core/script-registry.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { effectiveScriptParams } from '../src/shared/graph/script-meta.mjs';
import { realAgentMetas } from './helpers/graph-ports.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);
// A card runs for real whatever the mock flag says; the scan below turns the mock on for its agents only.
delete process.env.WORCA_MOCK;
delete process.env.ORCH_MOCK;
const prevRunRoot = process.env.WORCA_RUN_ROOT;
beforeEach(() => { process.env.WORCA_RUN_ROOT = 'detached'; });
after(() => { if (prevRunRoot === undefined) delete process.env.WORCA_RUN_ROOT; else process.env.WORCA_RUN_ROOT = prevRunRoot; });
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));
const tmp = async (p = 'worca-cc-order-') => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };
const AT = '2026-09-27T10:00:00.000Z';

// ── the review's scenario: web uses billing; a spurious heuristic edge back makes a cycle ─────────────
const KEYS = ['billing', 'queue-lib', 'web', 'worker'];
const edge = (from, to, kind, norm, display, confidence = 'exact') => ({ id: edgeId(from, to, kind, norm), from, to, kind, norm, display,
  label: null, detail: null, confidence, sources: ['static'], evidence: { from: [], to: [] } });
const USES = edge('web', 'billing', 'http', 'http:GET /invoices/{}', 'GET /invoices/{id}');
const BACK = edge('billing', 'web', 'http', 'http:GET /health', 'GET /health', 'heuristic');
const member = (key) => ({ key, name: key, role: null, roleSource: null, aliases: [], stack: ['node'], coverage: { level: 'rich' } });
const shop = () => ({ version: 1, workspace: { name: 'Shop' }, members: KEYS.map(member), edges: [{ ...USES }, { ...BACK }],
  ...changeOrder(KEYS, [USES, BACK]), graph: { mode: 'none', file: null, nodes: 0, bridges: 0 } });
const NOTES = 'Ship billing and web together.';
const SYN = { version: 1, overview: 'A shop.', roles: {}, coordination: [], orderNotes: NOTES };
const render = (map, overrides = null, synthesis = SYN) => renderWorkspaceDescription({ name: 'Shop', map, synthesis, overrides, budget: 300 });
/** The "Suggested change order" lines. */
const orderOf = (text) => text.split('\n## Suggested change order\n\n')[1].split('\n\n')[0];
const rejectBack = () => setEdgeState(emptyOverrides(), BACK, 'rejected', AT);
const manual = (ov, from, to, kind, display) => addManualEdge(ov, { from, to, kind, display }, AT).overrides;

test('render: a rejected edge orders and cycles nothing; a manual edge orders its provider first; a missing one orders nothing', () => {
  const map = shop();
  assert.equal(orderOf(render(map)), '1. billing, queue-lib, web, worker (cycle: billing, web)', 'no override: the stored order');
  assert.equal(orderOf(render(map, rejectBack())), '1. billing, queue-lib, worker\n2. web');
  const both = manual(rejectBack(), 'worker', 'queue-lib', 'pkg', '@acme/queue-lib');
  assert.equal(orderOf(render(map, both)), '1. billing, queue-lib\n2. web, worker');
  // a confirmed edge this scan no longer finds would make worker <-> queue-lib a cycle if it counted
  const gone = setEdgeState(both, edge('queue-lib', 'worker', 'topic', 'topic:jobs', 'jobs'), 'confirmed', AT);
  assert.equal(orderOf(render(map, gone)), '1. billing, queue-lib\n2. web, worker');
});

test('render: the order notes show only while the effective order and cycles are the stored ones', () => {
  const map = shop();
  const shows = (ov) => render(map, ov).split('\n').includes(NOTES);
  assert.equal(shows(null), true, 'no override');
  assert.equal(shows(rejectBack()), false, 'the cycle the notes describe is gone');
  assert.equal(shows(setEdgeState(rejectBack(), BACK, null, AT)), true, 'cleared again: the stored order');
  assert.equal(shows(manual(emptyOverrides(), 'worker', 'queue-lib', 'pkg', '@acme/queue-lib')), false, 'a manual edge that moves a member');
  assert.equal(shows(manual(emptyOverrides(), 'web', 'billing', 'topic', 'orders')), true, 'a manual edge that changes no layer');
  // same layers, other cycles: two members stored with no edge between them, joined both ways by hand
  const pair = { version: 1, members: [member('a'), member('b')], edges: [], order: [['a', 'b']], cycles: [], graph: { mode: 'none' } };
  const loop = manual(manual(emptyOverrides(), 'a', 'b', 'other', 'shared bucket'), 'b', 'a', 'other', 'shared queue');
  const text = render(pair, loop);
  assert.equal(orderOf(text), '1. a, b (cycle: a, b)');
  assert.equal(text.split('\n').includes(NOTES), false, 'the order matches, the cycles do not');
});

// ── stored coordination notes that restate a relation a review emptied ───────────────────────────────
const W = 'web-11111111';
const B = 'billing-22222222';
const Q = 'queue-lib-33333333';
const K = 'worker-44444444';
const S = 'website-55555555';
const L = 'ledger-66666666';
const named = (key, name) => ({ ...member(key), name });
const WEB_BILLING = edge(W, B, 'http', 'http:GET /invoices/{}', 'GET /invoices/{id}');
const notesMap = () => ({ version: 1, workspace: { name: 'Shop' },
  members: [named(W, 'web'), named(B, 'billing'), named(Q, 'queue-lib'), named(K, 'worker'), named(S, 'website'), named(L, 'Ledger (EU)')],
  edges: [{ ...WEB_BILLING }, edge(K, Q, 'pkg', 'pkg:npm:@acme/queue-lib', '@acme/queue-lib'), edge(S, B, 'http', 'http:GET /banner', 'GET /banner'),
    edge(L, B, 'topic', 'topic:ledger.settled', 'ledger.settled')],
  order: [], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 } });
const withNotes = (coordination) => ({ version: 1, overview: 'A shop.', roles: {}, coordination, orderNotes: '' });
const notesOf = (map, overrides, coordination, budget = 300) => {
  const text = renderWorkspaceDescription({ name: 'Shop', map, synthesis: withNotes(coordination), overrides, budget });
  const at = text.indexOf('\n## Change-coordination notes\n\n');
  return at < 0 ? [] : text.slice(at).split('\n\n')[1].split('\n').map((l) => l.replace(/^- /, ''));
};

test('render: a stored coordination note naming both members of a pair a review emptied is dropped; every other note stays', () => {
  const NOTES = [
    'Web polls Billing health before checkout.',            // web + billing, labels in another case: dropped
    'web-11111111 calls billing on every order.',            // web by its key, billing by its label: dropped
    'The website and the web app both call billing.',       // web named at its second occurrence: dropped
    'Release queue-lib before worker.',                      // a live pair: kept
    'The website team owns the billing banner.',             // website is not web; website -> billing is live: kept
    'The web-app shell reads billing receipts.',             // web-app is not web: kept
    'The sub-web proxy fronts billing.',                     // sub-web is not web: kept
    'The web2 shell and the web_ui both read billing.',      // web2 and web_ui are not web: kept
    'Web renders the storefront.',                           // one member of the pair only: kept
    'Keep the staging database in sync.',                    // no member at all: kept
  ];
  assert.deepEqual(notesOf(notesMap(), null, NOTES), NOTES, 'no review: every note');
  const ov = setEdgeState(emptyOverrides(), WEB_BILLING, 'rejected', AT);
  assert.deepEqual(notesOf(notesMap(), ov, NOTES), NOTES.slice(3));
});

test('render: a pair with a rejected and a live edge keeps its note; a rejected or stale edge with no live one left empties the pair', () => {
  const note = 'Ship billing and web together.';
  const kept = (ov) => render(shop(), ov, { ...SYN, coordination: [note] }).split('\n').includes(`- ${note}`);
  assert.equal(kept(rejectBack()), true, 'web -> billing is still live');
  assert.equal(kept(setEdgeState(rejectBack(), USES, 'rejected', AT)), false, 'both directions rejected');
  // A rejection whose edge the scan no longer has is a stale review: it empties its pair too.
  const ledger = 'Ledger (EU) settles with billing nightly.';
  const gone = edge(L, B, 'topic', 'topic:ledger.settled', 'ledger.settled');
  const map = notesMap();
  map.edges = map.edges.filter((e) => e.id !== gone.id);
  assert.deepEqual(notesOf(map, setEdgeState(emptyOverrides(), gone, 'rejected', AT), [ledger]), [], 'stale');
  assert.deepEqual(notesOf(map, setEdgeState(emptyOverrides(), gone, 'confirmed', AT), [ledger]), [ledger], 'a missing (confirmed) edge empties nothing');
});

test('render: the line budget still holds with notes dropped, at every level', () => {
  const NOTES = ['Web polls Billing health before checkout.', ...Array.from({ length: 19 }, (_, i) => `Release queue-lib before worker, step ${i}.`)];
  const ov = setEdgeState(emptyOverrides(), WEB_BILLING, 'rejected', AT);
  for (const budget of [60, 300]) {
    const text = renderWorkspaceDescription({ name: 'Shop', map: notesMap(), synthesis: withNotes(NOTES), overrides: ov, budget });
    assert.ok(countLines(text) <= budget, `budget ${budget}: ${countLines(text)} lines`);
    assert.equal(text.includes('Web polls Billing'), false, `budget ${budget}`);
    assert.ok(text.includes('Release queue-lib before worker, step 0.'), `budget ${budget}`);
  }
});

test('render: a 1 MiB member name in an emptied pair never makes it throw — no pattern is built from repo text', () => {
  const map = notesMap();
  map.members[0] = named(W, 'w'.repeat(1 << 20));
  const ov = setEdgeState(emptyOverrides(), WEB_BILLING, 'rejected', AT);
  const note = 'web-11111111 polls billing before checkout.';
  const t0 = performance.now();
  assert.deepEqual(notesOf(map, ov, [note, 'Keep the staging database in sync.']), ['Keep the staging database in sync.'], 'named by its key');
  assert.ok(performance.now() - t0 < 2000, `${Math.round(performance.now() - t0)} ms`);
});

// ── D8: a review change re-renders the stored description (workspaces.mjs renderFor) ──────────────────
async function freshRepo() {
  const dir = await tmp('worca-cc-order-repo-');
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# repo\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

test('D8: rejecting an edge and adding one re-render the stored description with the effective order', async () => {
  const ws = await createWorkspace({ name: 'Order WS', projectPaths: await Promise.all([freshRepo(), freshRepo(), freshRepo()]) });
  const [k0, k1, k2] = [...ws.projectKeys].sort();
  const uses = edge(k0, k1, 'http', 'http:GET /a', 'GET /a');
  const back = edge(k1, k0, 'http', 'http:GET /b', 'GET /b', 'heuristic');
  const map = { version: 1, workspace: { name: 'Order WS' }, members: [k0, k1, k2].map(member), edges: [uses, back],
    ...changeOrder([k0, k1, k2], [uses, back]), graph: { mode: 'none', file: null, nodes: 0, bridges: 0 } };
  await saveWorkspaceScanResult(ws.id, { map, synthesis: SYN });
  const desc = async () => (await readWorkspace(ws.id)).description;
  assert.equal(orderOf(await desc()), `1. ${k0}, ${k1}, ${k2} (cycle: ${k0}, ${k1})`);
  assert.ok((await desc()).split('\n').includes(NOTES));
  await setWorkspaceEdgeState(ws.id, back.id, 'rejected');
  assert.equal(orderOf(await desc()), `1. ${k1}, ${k2}\n2. ${k0}`);
  assert.equal((await desc()).split('\n').includes(NOTES), false);
  await addWorkspaceManualEdge(ws.id, { from: k1, to: k2, kind: 'pkg', display: '@acme/k2' });
  assert.equal(orderOf(await desc()), `1. ${k2}\n2. ${k1}\n3. ${k0}`);
});

test('run harness: only a scan reads the stored overrides; any other workspace run carries none', async () => {
  const ws = await createWorkspace({ name: 'Gate WS', projectPaths: await Promise.all([freshRepo(), freshRepo()]) });
  const [k0, k1] = [...ws.projectKeys].sort();
  const { overrides } = await updateWorkspaceOverrides(ws.id, setEdgeState(emptyOverrides(), edge(k0, k1, 'http', 'http:GET /a', 'GET /a'), 'rejected', AT));
  const read = (scan) => RunHarness.prototype._scanOverrides.call({ _isWorkspaceScan: () => scan, workspace: { id: ws.id } });
  assert.deepEqual(await read(true), overrides);
  assert.equal(await read(false), null);
});

test('run harness: a manual edge a person typed a credential into reaches the scan cards and their envelope artifacts redacted (D21)', async () => {
  const ws = await createWorkspace({ name: 'Cred WS', projectPaths: await Promise.all([freshRepo(), freshRepo()]) });
  const [k0, k1] = [...ws.projectKeys].sort();
  await updateWorkspaceOverrides(ws.id, addManualEdge(emptyOverrides(), { from: k0, to: k1, kind: 'db', display: 'postgres://admin:hunter2secret@db.internal:5432/app',
    detail: 'DB_PASSWORD=hunter3secret' }, AT).overrides);
  const read = await RunHarness.prototype._scanOverrides.call({ _isWorkspaceScan: () => true, workspace: { id: ws.id } });
  assert.equal(/hunter[23]secret/.test(JSON.stringify(read)), false, JSON.stringify(read));
  assert.deepEqual([read.manual[0].display, read.manual[0].detail], ['postgres://***@db.internal:5432/app', 'DB_PASSWORD=***'], 'the display and the detail');
  assert.equal((await readWorkspaceMap(ws.id)).overrides.manual[0].display, 'postgres://admin:hunter2secret@db.internal:5432/app', 'the stored doc keeps what was typed');
});

// ── the join: stored order and synth brief over the effective edges ──────────────────────────────────
const ENTRY = (m, norm, display) => ({ id: entryId(m, 'http', norm), member: m, kind: 'http', norm, display, terms: [],
  evidence: [{ file: 'src/routes.ts', line: 1, match: 'route' }], sources: ['static'] });
const INVOICES = ENTRY('billing', 'http:GET /invoices/{}', 'GET /invoices/{id}');
const HEALTH = ENTRY('web', 'http:GET /health', 'GET /health');
const consume = (e) => ({ kind: 'http', dir: 'consumes', key: e.display, norm: e.norm, file: 'src/a.ts', line: 1, match: 'fetch', detail: null,
  label: null, target: null, source: 'static', detector: 'x', confidence: 'exact', test: false, evidence: [{ file: 'src/a.ts', line: 1, match: 'fetch' }],
  entry: e.id, toMember: e.member });
const catalogFor = (dirOf) => ({ version: 1, workspace: { name: 'Shop' }, entries: [INVOICES, HEALTH],
  members: Object.fromEntries(KEYS.map((k) => [k, { key: k, name: k, dir: dirOf(k), role: null, roleSource: null, aliases: [k], stack: ['node'],
    coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, detectors: {} }, graph: null, surveyStatus: 'skipped', unresolved: [],
    facts: { static: 1, llm: 0 }, candidatesTruncated: false }])),
  consumes: { billing: [consume(HEALTH)], 'queue-lib': [], web: [consume(INVOICES)], worker: [] },
  candidates: Object.fromEntries(KEYS.map((k) => [k, []])), aliasIndex: Object.fromEntries(KEYS.map((k) => [k, k])), ambiguousAliases: {}, rejected: [],
  briefs: {}, errors: [] });
const USAGE = { version: 1, members: Object.fromEntries(KEYS.map((k) => [k, { status: 'investigated', uses: [], rejected: [], other: [] }])) };
const reviewed = () => manual(rejectBack(), 'worker', 'queue-lib', 'pkg', '@acme/queue-lib');
const briefLines = (map, overrides) => synthBrief(map, { mapPath: '/p/workspace-map.json', checkerCmd: 'CHK', overrides }).split('\n');

test('join: a re-scan stores the order of the effective edges; its synth brief lists only the pairs a review left standing', async () => {
  const catalog = catalogFor((k) => `/nonexistent/${k}`);
  const plain = await joinMap({ catalog, usage: USAGE });
  assert.deepEqual([plain.order, plain.cycles], [[['billing', 'queue-lib', 'web', 'worker']], [['billing', 'web']]], 'no override: every scanned edge');
  const ov = setEdgeState(setEdgeState(reviewed(), edge('queue-lib', 'worker', 'topic', 'topic:jobs', 'jobs'), 'confirmed', AT), USES, 'confirmed', AT);
  const map = await joinMap({ catalog, usage: USAGE, overrides: ov });
  assert.deepEqual(map.edges.map((e) => e.id).sort(), plain.edges.map((e) => e.id).sort(), 'the map keeps every scanned edge');
  assert.deepEqual([map.order, map.cycles], [[['billing', 'queue-lib'], ['web', 'worker']], []]);
  const lines = briefLines(map, ov);
  assert.ok(lines.includes('Workspace "Shop": 4 member projects, 2 edges. Full map: `/p/workspace-map.json`.'), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('- web -> billing: ')));
  assert.ok(lines.includes('- worker -> queue-lib: build dep 1 (@acme/queue-lib) [manual 1]'), 'the manual edge, marked');
  assert.equal(lines.some((l) => l.startsWith('- billing -> web')), false, 'the rejected pair is gone');
  assert.equal(lines.some((l) => l.startsWith('- queue-lib -> worker')), false, 'a confirmed edge the scan lost is gone');
  assert.ok(lines.includes('1. billing, queue-lib') && lines.includes('2. web, worker'));
  const cycles = lines.slice(lines.indexOf('## Cycles') + 2);
  assert.equal(cycles[0], '- none');
  assert.ok(briefLines(plain, null).some((l) => l.startsWith('- billing -> web: ')), 'no override: every pair');
});

test('join: a rejection whose edge an agent reworded this scan is moved first (rekeyOverrides, as finalize does) — the edge neither orders nor briefs', async () => {
  const described = (text) => ({ kind: 'other', dir: 'consumes', key: text, norm: normKey('other', text), file: 'src/s3.ts', line: 1, match: 's3', detail: null,
    label: 'shared S3 bucket', target: 'queue-lib', source: 'survey', detector: 'survey', confidence: 'exact', test: false,
    evidence: [{ file: 'src/s3.ts', line: 1, match: 's3' }], entry: null, toMember: 'queue-lib' });
  const catalog = catalogFor((k) => `/nonexistent/${k}`);
  catalog.consumes.worker = [described('reads invoices through the shared S3 client')];
  const fresh = await joinMap({ catalog, usage: USAGE });
  const reworded = fresh.edges.find((e) => e.from === 'worker' && e.to === 'queue-lib');
  assert.ok(reworded && reworded.kind === 'other' && reworded.agentKeyed === true, JSON.stringify(fresh.edges));
  assert.deepEqual(fresh.order, [['billing', 'queue-lib', 'web'], ['worker']]);
  // The person rejected it on the previous scan, when its id hashed the agent's other wording.
  const oldId = edgeId('worker', 'queue-lib', 'other', normKey('other', 'reads invoices from the shared S3 client'));
  assert.notEqual(oldId, reworded.id);
  const frozen = setEdgeState(emptyOverrides(), { id: oldId, from: 'worker', to: 'queue-lib', kind: 'other', display: 'shared S3 bucket' }, 'rejected', AT);
  const map = await joinMap({ catalog, usage: USAGE, overrides: frozen });
  assert.deepEqual(map.order, [['billing', 'queue-lib', 'web', 'worker']], 'the moved rejection: worker no longer waits for queue-lib');
  const lines = briefLines(map, frozen);
  assert.equal(lines.some((l) => l.startsWith('- worker -> queue-lib')), false, 'the rejected relation, reworded, is not briefed');
  assert.ok(lines.includes('Workspace "Shop": 4 member projects, 2 edges. Full map: `/p/workspace-map.json`.'), lines.join('\n'));
});

test('synth brief: a stale review (a rejection whose edge is gone) never reaches the synthesizer', async () => {
  const map = await joinMap({ catalog: catalogFor((k) => `/nonexistent/${k}`), usage: USAGE });
  const gone = setEdgeState(emptyOverrides(), edge('queue-lib', 'billing', 'db', 'table:ledger', 'ledger'), 'rejected', AT);
  const lines = briefLines(map, gone);
  assert.equal(lines.some((l) => l.startsWith('- queue-lib -> billing')), false);
  assert.ok(lines.includes('Workspace "Shop": 4 member projects, 2 edges. Full map: `/p/workspace-map.json`.'), lines.join('\n'));
});

test('synth brief: a manual edge a person typed a credential into reaches the synthesizer redacted, as the description shows it (D21)', () => {
  const map = { version: 1, workspace: { name: 'W' }, members: [member('a'), member('b')], edges: [], order: [['a', 'b']], cycles: [] };
  const ov = manual(emptyOverrides(), 'a', 'b', 'db', 'postgres://admin:hunter2secret@db.internal:5432/app');
  const brief = synthBrief(map, { mapPath: '/m.json', checkerCmd: 'CHK', overrides: ov });
  assert.equal(brief.includes('hunter2secret'), false, brief);
  assert.ok(brief.split('\n').some((l) => l.startsWith('- a -> b: shared DB 1 (postgres://***@db.internal:5432/app) [manual 1]')), brief);
});

// ── the join card: the envelope's ctx.workspace.overrides reach joinMap and synthBrief ────────────────
const REG = loadScriptRegistry({ scriptsDir: DEFAULT_SCRIPTS_DIR, userScriptsDir: null, includePlugins: false, agentKeys: realAgentMetas().map((m) => m.key) });
const tok = (type, path) => ({ seq: 1, type, path });
function joinCtx(pipelineDir, workspace, signal) {
  const meta = REG.workspaceMapJoin;
  const outputs = Object.fromEntries(meta.outputs.map((p) => [p.id, { path: join(pipelineDir, p.filename), store: 'run' }]));
  const bindings = { catalog: tok('json', join(pipelineDir, 'catalog.json')), usage: tok('json', join(pipelineDir, 'usage.json')) };
  return {
    node: { id: 'n_join', kind: 'script', key: 'workspaceMapJoin' }, executionId: 'x:n_join:1', ordinal: 1, pipelineDir, pipelineId: 'run-1',
    projectDir: pipelineDir, runCtx: { pipelineDir, projectDir: pipelineDir, baseName: 'scan' }, runRoot: null, repos: [], checkpointRef: null,
    workspace, ports: { inputs: meta.inputs, outputs: meta.outputs }, outputs, verdict: null, bindings, trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
    script: { meta, runtime: meta.runtime, file: meta.scriptPath, command: null, params: effectiveScriptParams(meta, {}), timeoutMs: meta.timeoutMs, mock: null },
    claudeOpts: {}, signal, onEvent: () => {},
  };
}

test('the join card applies the overrides its envelope carries; without them it keeps every scanned edge', async (t) => {
  for (const [overrides, order, rejectedPair] of [[reviewed(), [['billing', 'queue-lib'], ['web', 'worker']], false], [null, [['billing', 'queue-lib', 'web', 'worker']], true]]) {
    const pipelineDir = await tmp('worca-cc-order-pipe-');
    await writeFile(join(pipelineDir, 'catalog.json'), JSON.stringify(catalogFor((k) => join(pipelineDir, k))));
    await writeFile(join(pipelineDir, 'usage.json'), JSON.stringify(USAGE));
    for (const k of KEYS) await mkdir(join(pipelineDir, k));
    const channel = { kind: 'metadata', workspaceDescription: '', workspaceId: 'wks-shop-00000000', workspaceName: 'Shop', overrides,
      projects: KEYS.map((k) => ({ projectKey: k, projectName: k, projectDir: join(pipelineDir, k), worktreeDir: join(pipelineDir, k), checkpointRef: null, graphInstruction: '' })) };
    const ctx = joinCtx(pipelineDir, channel, t.signal);
    await runScriptExecution(ctx);
    const map = JSON.parse(await readFile(ctx.outputs.map.path, 'utf8'));
    assert.deepEqual(map.order, order, JSON.stringify(overrides));
    const brief = (await readFile(ctx.outputs.brief.path, 'utf8')).split('\n');
    assert.equal(brief.some((l) => l.startsWith('- billing -> web: ')), rejectedPair);
  }
});

// ── the render card: the run folder's description applies the same overrides ─────────────────────────
function renderCtx(pipelineDir, workspace, signal) {
  const meta = REG.workspaceMapRender;
  const outputs = Object.fromEntries(meta.outputs.map((p) => [p.id, { path: join(pipelineDir, p.filename), store: 'run' }]));
  const bindings = { map: tok('json', join(pipelineDir, 'workspace-map.json')), synthesis: tok('json', join(pipelineDir, 'synthesis.json')) };
  return {
    node: { id: 'n_render', kind: 'script', key: 'workspaceMapRender' }, executionId: 'x:n_render:1', ordinal: 1, pipelineDir, pipelineId: 'run-1',
    projectDir: pipelineDir, runCtx: { pipelineDir, projectDir: pipelineDir, baseName: 'scan' }, runRoot: null, repos: [], checkpointRef: null,
    workspace, ports: { inputs: meta.inputs, outputs: meta.outputs }, outputs, verdict: null, bindings, trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
    script: { meta, runtime: meta.runtime, file: meta.scriptPath, command: null, params: effectiveScriptParams(meta, {}), timeoutMs: meta.timeoutMs, mock: null },
    claudeOpts: {}, signal, onEvent: () => {},
  };
}

test('the render card renders with the overrides its envelope carries: the run folder\'s description keeps the stored order and its notes', async (t) => {
  // The map as a re-scan stores it (M15): its order over the edges a review left standing (billing -> web rejected).
  const map = { ...shop(), ...changeOrder(KEYS, [USES]) };
  for (const [overrides, order, notes] of [
    [rejectBack(), '1. billing, queue-lib, worker\n2. web', true],
    [null, '1. billing, queue-lib, web, worker (cycle: billing, web)', false],
  ]) {
    const pipelineDir = await tmp('worca-cc-order-render-');
    await writeFile(join(pipelineDir, 'workspace-map.json'), JSON.stringify(map));
    await writeFile(join(pipelineDir, 'synthesis.json'), JSON.stringify(SYN));
    for (const k of KEYS) await mkdir(join(pipelineDir, k));
    const channel = { kind: 'metadata', workspaceDescription: '', workspaceId: 'wks-shop-00000000', workspaceName: 'Shop', overrides,
      projects: KEYS.map((k) => ({ projectKey: k, projectName: k, projectDir: join(pipelineDir, k), worktreeDir: join(pipelineDir, k), checkpointRef: null, graphInstruction: '' })) };
    const ctx = renderCtx(pipelineDir, channel, t.signal);
    await runScriptExecution(ctx);
    const text = (await readFile(ctx.outputs.workspace.path, 'utf8')).trimEnd();
    assert.equal(orderOf(text), order, JSON.stringify(overrides));
    assert.equal(text.split('\n').includes(NOTES), notes, 'the order notes show only beside the order they describe');
  }
});

test('the render card moves the frozen overrides as the join did: a rejection whose edge an agent reworded stays rejected in the run folder\'s description', async (t) => {
  const described = (text) => ({ kind: 'other', dir: 'consumes', key: text, norm: normKey('other', text), file: 'src/s3.ts', line: 1, match: 's3', detail: null,
    label: 'shared S3 bucket', target: 'queue-lib', source: 'survey', detector: 'survey', confidence: 'exact', test: false,
    evidence: [{ file: 'src/s3.ts', line: 1, match: 's3' }], entry: null, toMember: 'queue-lib' });
  const pipelineDir = await tmp('worca-cc-order-rekey-');
  const catalog = catalogFor((k) => join(pipelineDir, k));
  catalog.consumes.worker = [described('reads invoices through the shared S3 client')];
  // The person rejected it on the previous scan, when its id hashed the agent's other wording.
  const oldId = edgeId('worker', 'queue-lib', 'other', normKey('other', 'reads invoices from the shared S3 client'));
  const frozen = setEdgeState(emptyOverrides(), { id: oldId, from: 'worker', to: 'queue-lib', kind: 'other', display: 'shared S3 bucket' }, 'rejected', AT);
  const map = await joinMap({ catalog, usage: USAGE, overrides: frozen });
  assert.deepEqual(map.order, [['billing', 'queue-lib', 'web', 'worker']], 'the join moved the rejection');
  await writeFile(join(pipelineDir, 'workspace-map.json'), JSON.stringify(map));
  await writeFile(join(pipelineDir, 'synthesis.json'), JSON.stringify(SYN));
  for (const k of KEYS) await mkdir(join(pipelineDir, k));
  const channel = { kind: 'metadata', workspaceDescription: '', workspaceId: 'wks-shop-00000000', workspaceName: 'Shop', overrides: frozen,
    projects: KEYS.map((k) => ({ projectKey: k, projectName: k, projectDir: join(pipelineDir, k), worktreeDir: join(pipelineDir, k), checkpointRef: null, graphInstruction: '' })) };
  const ctx = renderCtx(pipelineDir, channel, t.signal);
  await runScriptExecution(ctx);
  const text = (await readFile(ctx.outputs.workspace.path, 'utf8')).trimEnd();
  assert.equal(orderOf(text), '1. billing, queue-lib, web, worker (cycle: billing, web)', 'the stored order');
  assert.equal(text.split('\n').includes(NOTES), true, 'the order notes beside it');
  assert.equal(text.includes('worker -> queue-lib'), false, 'the rejected relation, reworded, is not listed');
});

// ── the run harness: a re-scan freezes the stored overrides at start; a first scan has none ──────────
const LIB_PKG = `${JSON.stringify({ name: '@wsmap/lib', version: '1.0.0' }, null, 2)}\n`;
const APP_PKG = `${JSON.stringify({ name: '@wsmap/app', version: '1.0.0', dependencies: { '@wsmap/lib': '^1.0.0' } }, null, 2)}\n`;
async function pkgRepo(label, files) {
  const dir = await tmp(`worca-cc-order-${label}-`);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  for (const [rel, text] of Object.entries(files)) await writeFile(join(dir, rel), text);
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
function scanOpts(ws) {
  const projects = ws.projectPaths.map((d) => ({ projectDir: d, projectKey: projectKey(d), projectName: basename(d), branch: { source: 'main' } }))
    .sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  return { workspace: { id: ws.id, key: ws.id, name: ws.name, description: '', projects }, branch: { source: 'main' }, workflowId: WORKSPACE_SCAN_WORKFLOW_ID,
    prompt: `Scan the interconnections of the workspace "${ws.name}".`, auto: true, claude: { mock: true } };
}
async function runScan(t, opts) {
  const orch = createOrchestrator(opts);
  const stop = () => orch.stop();
  t.signal.addEventListener('abort', stop, { once: true });
  try { assert.equal((await orch.run()).status, 'done'); } finally { t.signal.removeEventListener('abort', stop); }
  const dir = orch.getState().pipelineDir;
  const envelope = JSON.parse(await readFile(join(dir, 'scripts', 'n_join-c1.envelope.json'), 'utf8'));
  const map = JSON.parse(await readFile(join(dir, 'workspace-map.json'), 'utf8'));
  return { envelope, map, brief: await readFile(join(dir, 'synth-brief.md'), 'utf8') };
}

test('run harness: a re-scan hands the join the overrides stored at run start (read again on resume); a first scan hands none', async (t) => {
  const app = await pkgRepo('app', { 'package.json': APP_PKG });
  const lib = await pkgRepo('lib', { 'package.json': LIB_PKG });
  const [appKey, libKey] = [projectKey(app), projectKey(lib)];
  const first = await runScan(t, scanOpts(checkNewWorkspace({ name: 'Order Scan', projectPaths: [app, lib] })));
  assert.equal(first.envelope.ctx.workspace.overrides, undefined, 'a first scan: no workspace, no overrides');
  const dep = first.map.edges.find((e) => e.from === appKey && e.to === libKey && e.kind === 'pkg');
  assert.ok(dep, JSON.stringify(first.map.edges));
  assert.deepEqual(first.map.order, [[libKey], [appKey]]);
  const ws = await readWorkspace(first.envelope.ctx.workspace.id);
  assert.ok(ws, 'the first scan saved the workspace');
  await updateWorkspaceOverrides(ws.id, setEdgeState(emptyOverrides(), dep, 'rejected', AT));
  const stored = (await readWorkspaceMap(ws.id)).overrides;
  const rescan = await runScan(t, scanOpts(ws));
  assert.deepEqual(rescan.envelope.ctx.workspace.overrides, stored, 'the overrides stored when the re-scan started');
  assert.deepEqual(rescan.map.order, [[appKey, libKey].sort()], 'the rejected dependency orders nothing');
  assert.equal(rescan.brief.includes(`- ${appKey} -> ${libKey}`), false, 'the synth brief leaves the rejected pair out');

  // A re-scan paused before its join reads them again when it resumes: a change made while it was parked counts.
  await updateWorkspaceOverrides(ws.id, emptyOverrides());
  const orch = createOrchestrator(scanOpts(ws));
  const onExec = (p) => { if (p.nodeId === 'n_scan' && p.status === 'start') { orch.off('exec', onExec); orch.pause(); } };
  orch.on('exec', onExec);
  assert.equal((await orch.run()).status, 'paused');
  const parked = await updateWorkspaceOverrides(ws.id, setEdgeState(emptyOverrides(), dep, 'rejected', AT));
  const saved = readPipelineForResume(orch.state.id);
  const meta = JSON.parse(saved.row.workspace_meta);
  const resumed = await createOrchestratorFor({ projectDir: meta.projects[0].projectDir, claude: { mock: true }, auto: true, resume: saved,
    workspace: { id: meta.workspaceId, key: saved.row.workspace_key, name: meta.workspaceName, description: '', projects: meta.projects } });
  assert.equal((await resumed.resume()).status, 'done');
  const dir = resumed.getState().pipelineDir;
  const envelope = JSON.parse(await readFile(join(dir, 'scripts', 'n_join-c1.envelope.json'), 'utf8'));
  assert.deepEqual(envelope.ctx.workspace.overrides, parked.overrides, 'the overrides stored when the run resumed');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'workspace-map.json'), 'utf8')).order, [[appKey, libKey].sort()], 'the rejection made while parked counts');
});
