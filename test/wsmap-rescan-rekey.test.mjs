// test/wsmap-rescan-rekey.test.mjs — reviews survive an agent's rewording (D7, M14). The join marks
// every edge whose key an agent chose (`agentKeyed`); an `other` edge is keyed by its label; finalize
// moves an override whose edge id is gone onto the new edge ONLY on a unique match both ways of
// (from, to, kind, soft key) among agent-keyed edges (reviewed ones count), onto the one match that has no
// review of its own. Anything else stays where it was: never dropped, never applied to another edge.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { makeRepos } from './helpers/wsmap-p1-repos.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import identity from '../src/core/workspace-map/detectors/identity.mjs';
import npm from '../src/core/workspace-map/detectors/pkg-npm.mjs';
import { edgeId, entryId } from '../src/shared/workspace-map/ids.mjs';
import * as overrides from '../src/shared/workspace-map/overrides.mjs';
import { createWorkspace, readWorkspace, readWorkspaceMap, saveWorkspaceScanResult, setWorkspaceEdgeState } from '../src/core/workspaces.mjs';

const { emptyOverrides, setEdgeState, effectiveEdges } = overrides;
// Read through the namespace: before rekeyOverrides exists the file still loads and each case fails on its own.
const rekeyOverrides = (ov, map) => overrides.rekeyOverrides(ov, map);

useTempHome(after);
const repos = [];
after(() => Promise.all(repos.map((r) => r.cleanup())));
async function reposOf(spec) {
  const r = await makeRepos(spec);
  repos.push(r);
  return r;
}

// ── join: the agentKeyed mark on every rule, and `other` edges keyed by their label ──
const ws = await reposOf({
  api: { 'src/routes.ts': "router.get('/invoices/:id', h)\n" },
  lib: { 'src/reports.ex': 'get "/reports/:id", ReportController, :show\n' },
  ra: { 'src/a.ts': "fetch('/invoices/' + id)\nfetch('/reports/' + id)\n" },
  rb: { 'src/b.ts': "fetch('/v1/reports/' + id)\n" },
  rc: { 'src/c.ts': "fetch(REPORTS + '/reports/' + id)\nfetch(INVOICES + '/invoices/' + id)\n" },
  rd: { 'src/d.ts': "on('reports.ready')\non('orders.created')\n" },
  re: { 'src/e.ts': "exportNightly()\ngetInvoice(id)\nfetch('/invoices/' + id)\nlib.callback(cb)\n" },
  rs: { 'src/s.ts': "queue.connect('lib:9000')\napi.connect('api:8080')\nbucket.write('shared')\n" },
});
const dir = Object.fromEntries(ws.members.map((m) => [m.key, m.dir]));
const E = (member, kind, norm, display, sources) => ({ id: entryId(member, kind, norm), member, kind, norm, display, terms: [],
  evidence: [{ file: 'src/routes.ts', line: 1, match: 'x' }], sources });
const GET = E('api', 'http', 'http:GET /invoices/{}', 'GET /invoices/{id}', ['static']);
const TOPIC = E('api', 'topic', 'topic:orders.created', 'orders.created', ['static']);
const SGET = E('lib', 'http', 'http:GET /reports/{}', 'GET /reports/{id}', ['survey']);
const STOPIC = E('lib', 'topic', 'topic:reports.ready', 'reports.ready', ['survey']);
const C = (kind, key, norm, file, line, match, over = {}) => ({ kind, dir: 'consumes', key, norm, file, line, match, detail: null, label: null,
  target: null, source: 'static', sources: [over.source ?? 'static'], detector: 'x', confidence: 'exact', test: false, evidence: [{ file, line, match }],
  entry: null, toMember: null, ...over });
const member = (key) => ({ key, name: key, dir: dir[key], role: null, roleSource: null, aliases: [key], stack: ['node'],
  coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, detectors: {} }, graph: null, surveyStatus: 'skipped',
  unresolved: [], facts: { static: 1, llm: 0 }, candidatesTruncated: false });
const KEYS = ['api', 'lib', 'ra', 'rb', 'rc', 'rd', 're', 'rs'];
const catalog = () => ({
  version: 1, workspace: { name: 'Marks' }, members: Object.fromEntries(KEYS.map((k) => [k, member(k)])),
  entries: [GET, TOPIC, SGET, STOPIC], aliasIndex: Object.fromEntries(KEYS.map((k) => [k, k])), ambiguousAliases: {},
  consumes: {
    ra: [C('http', 'GET /invoices/:id', 'http:GET /invoices/{}', 'src/a.ts', 1, "fetch('/invoices/'", { entry: GET.id, toMember: 'api' }),
      C('http', 'GET /reports/:id', 'http:GET /reports/{}', 'src/a.ts', 2, "fetch('/reports/'", { entry: SGET.id, toMember: 'lib' })],
    rb: [C('http', 'GET /v1/reports/:id', 'http:GET /v1/reports/{}', 'src/b.ts', 1, "fetch('/v1/reports/'")],
    re: [C('http', 'GET /invoices/:id', 'http:GET /invoices/{}', 'src/e.ts', 3, "fetch('/invoices/'", { entry: GET.id, toMember: 'api' })],
    rs: [C('service', 'lib:9000', 'service:lib', 'src/s.ts', 1, "queue.connect('lib:9000')", { source: 'survey', toMember: 'lib' }),
      C('service', 'api:8080', 'service:api', 'src/s.ts', 2, "api.connect('api:8080')", { toMember: 'api' }),
      C('other', 'writes to the shared bucket lib reads', 'other:writes to the shared bucket lib reads', 'src/s.ts', 3, "bucket.write('shared')",
        { source: 'survey', label: 'S3 bucket', toMember: 'lib' })],
  },
  candidates: { rd: [{ entry: STOPIC.id, file: 'src/d.ts', line: 1, match: 'reports.ready', via: 'literal' },
    { entry: TOPIC.id, file: 'src/d.ts', line: 2, match: 'orders.created', via: 'literal' }] },
  rejected: [], briefs: {}, errors: [],
});
const usage = (exportKey = 'nightly export of invoices', exportLabel = 'export job') => ({ version: 1, members: {
  ...Object.fromEntries(KEYS.map((k) => [k, { status: 'investigated', uses: [], rejected: [], other: [] }])),
  rc: { status: 'investigated', rejected: [], other: [], uses: [{ entry: SGET.id, file: 'src/c.ts', line: 1, match: "'/reports/'" },
    { entry: GET.id, file: 'src/c.ts', line: 2, match: "'/invoices/'" }] },
  rd: { status: 'failed', uses: [], rejected: [], other: [] },
  re: { status: 'investigated', uses: [], rejected: [], other: [
    { to: 'api', kind: 'other', key: exportKey, label: exportLabel, file: 'src/e.ts', line: 1, match: 'exportNightly()' },
    { to: 'api', kind: 'http', key: 'GET /invoices/{id}', label: 'invoice fetch', file: 'src/e.ts', line: 2, match: 'getInvoice(id)' },
    { to: 'lib', kind: 'http', key: 'the lib callback thing', label: 'callback', file: 'src/e.ts', line: 4, match: 'lib.callback(cb)' }] },
} });
const marks = (m) => Object.fromEntries(m.edges.map((e) => [`${e.from}>${e.to} ${e.norm}`, e.agentKeyed]));

test('join marks every edge whose key an agent chose, on every rule; a code-found key on either side of a merge wins (killer: agentKeyed)', async () => {
  const m = await joinMap({ catalog: catalog(), usage: usage() });
  assert.deepEqual(marks(m), {
    'ra>api http:GET /invoices/{}': false,        // (a) static consume, static entry
    'ra>lib http:GET /reports/{}': true,          // (a) static consume, survey-provided entry
    'rb>lib http:GET /reports/{}': true,          // (b) static fuzzy match into a survey-provided entry
    'rc>lib http:GET /reports/{}': true,          // (c) a verified use of a survey-provided entry
    'rc>api http:GET /invoices/{}': false,        // (c) a verified use of a static entry
    'rd>lib topic:reports.ready': true,           // (d) a failed member's candidate of a survey-provided entry
    'rd>api topic:orders.created': false,         // (d) a failed member's candidate of a static entry
    're>api other:export job': true,              // (e) a relation
    're>api http:GET /invoices/{}': false,        // (e) merged with a static (a) edge of the same id: code keys it
    're>lib other:callback': true,                // (e) a relation its kind cannot key: other, by its label
    'rs>lib service:lib': true,                   // a survey consume naming its target
    'rs>api service:api': false,                  // a static alias resolution
    'rs>lib other:s3 bucket': true,               // a survey consume of kind other, keyed by its label
  });
  for (const e of m.edges) assert.equal(e.id, edgeId(e.from, e.to, e.kind, e.norm));
});

test('an other edge is keyed by its folded label: an agent rewording the relation under the same label keeps the edge id (killer: label norm)', async () => {
  const first = await joinMap({ catalog: catalog(), usage: usage('nightly export of invoices', 'export job') });
  const again = await joinMap({ catalog: catalog(), usage: usage('exports every invoice to the warehouse at night', '  Export   JOB ') });
  const id = edgeId('re', 'api', 'other', 'other:export job');
  assert.ok(first.edges.some((e) => e.id === id));
  assert.ok(again.edges.some((e) => e.id === id), 'same label, reworded key: same id');
  assert.equal(again.edges.find((e) => e.id === id).display, 'Export   JOB', 'the display is still the label as written');
  const noLabel = await joinMap({ catalog: catalog(), usage: usage('nightly export of invoices', null) });
  assert.ok(noLabel.edges.some((e) => e.id === edgeId('re', 'api', 'other', 'other:nightly export of invoices')), 'no label: the folded key');
});

// ── rekeyOverrides: unique, bijective matches only ──
const X = (from, to, kind, norm, display, agentKeyed = true) => ({ id: edgeId(from, to, kind, norm), from, to, kind, norm, display, label: null,
  detail: null, confidence: 'inferred', sources: ['usage'], agentKeyed, evidence: { from: [], to: [] } });
const T1 = '2026-09-26T08:00:00.000Z';
const GET_USER = X('web', 'users', 'http', 'http:GET /users/{}', 'GET /users/{id}');
const ANY_USER = X('web', 'users', 'http', 'http:* /users/{}', '/users/:id');

test('an override whose agent-keyed edge was reworded moves to the new edge: state and time kept, snapshot updated, input untouched', () => {
  const ov = setEdgeState(emptyOverrides(), GET_USER, 'confirmed', T1);
  const out = rekeyOverrides(ov, { edges: [ANY_USER] });
  assert.deepEqual(out.edges, { [ANY_USER.id]: { state: 'confirmed', from: 'web', to: 'users', kind: 'http', display: '/users/:id', at: T1 } });
  assert.deepEqual(Object.keys(ov.edges), [GET_USER.id], 'the input doc is never mutated');
  assert.equal(effectiveEdges({ edges: [ANY_USER] }, out)[0].state, 'confirmed');
  const bucket = X('web', 'users', 'other', 'other:shared s3 bucket', 'Shared  S3 bucket');
  const rej = setEdgeState(emptyOverrides(), X('web', 'users', 'other', 'other:web writes uploads users reads', 'shared s3 BUCKET'), 'rejected', T1);
  assert.deepEqual(Object.values(rekeyOverrides(rej, { edges: [bucket] }).edges), [
    { state: 'rejected', from: 'web', to: 'users', kind: 'other', display: 'Shared  S3 bucket', at: T1 }], 'other: the folded label matches');
});

test('no unique match both ways: the orphan stays where it was and no other edge takes its verdict (killer: bijective, agent-keyed only)', () => {
  const ov = setEdgeState(emptyOverrides(), GET_USER, 'rejected', T1);
  const same = (map, why) => assert.equal(rekeyOverrides(ov, map), ov, why);
  same({ edges: [X('web', 'users', 'http', 'http:* /users/{}', '/users/:id', false)] }, 'a code-keyed (static) edge is never a target');
  same({ edges: [ANY_USER, X('web', 'users', 'http', 'http:POST /users/{}', 'POST /users/{id}')] }, 'two candidates for one orphan');
  same({ edges: [X('web', 'users', 'http', 'http:DELETE /users/{}', 'DELETE /users/:id')] }, 'a different method is a different operation');
  same({ edges: [X('web', 'billing', 'http', 'http:* /users/{}', '/users/:id'), X('web', 'users', 'grpc', 'grpc:users.Users/Get', 'users.Users/Get')] },
    'another member or kind');
  for (const id of ['x_not-an-id', 'm_0123456789ab']) same({ edges: [{ ...ANY_USER, id }] }, `only a scanned edge id (x_ + 12 hex) takes an override: ${id}`);
  same({ edges: [] }, 'nothing to match');
  same(null, 'no map');
  const junk = [null, 7, 'x', { id: {} }, { ...ANY_USER, display: JSON.parse('{"toString":null}') }, { ...ANY_USER, from: 7 }];
  same({ edges: junk }, 'a corrupt map_json never throws and never takes an override');
  assert.equal(rekeyOverrides('garbage', { edges: [ANY_USER] }), 'garbage');
  const blank = setEdgeState(emptyOverrides(), { ...GET_USER, display: '' }, 'rejected', T1);
  assert.equal(rekeyOverrides(blank, { edges: [{ ...ANY_USER, display: ' ' }] }), blank, 'an empty display matches nothing');
  // An edge effectiveEdges would not show (a corrupt map_json row) is not the override's edge: the override is an orphan.
  const corrupt = { ...GET_USER, from: null };
  assert.deepEqual(Object.keys(rekeyOverrides(ov, { edges: [corrupt, ANY_USER] }).edges), [ANY_USER.id]);
  const taken = setEdgeState(ov, ANY_USER, 'confirmed', T1);
  assert.equal(rekeyOverrides(taken, { edges: [ANY_USER] }), taken, 'a candidate that carries its own override is never a target');
  const twoOrphans = setEdgeState(ov, X('web', 'users', 'http', 'http:PUT /users/{}', 'PUT /users/{id}'), 'confirmed', T1);
  assert.equal(rekeyOverrides(twoOrphans, { edges: [ANY_USER] }), twoOrphans, 'two orphans for one candidate: neither moves');
  // A method-less rejection whose edge is gone, beside a reviewed GET and a new POST of the same path: two candidates.
  const sibling = setEdgeState(setEdgeState(emptyOverrides(), ANY_USER, 'rejected', T1), GET_USER, 'confirmed', T1);
  const POST_USER = X('web', 'users', 'http', 'http:POST /users/{}', 'POST /users/{id}');
  assert.equal(rekeyOverrides(sibling, { edges: [GET_USER, POST_USER] }), sibling, 'a reviewed edge of the same soft key counts: the rejection never lands on its unreviewed sibling');
});

test('the rematch trap: a lost bucket rejection never suppresses the unrelated admin CLI relation of the same pair and kind', async () => {
  const r = await reposOf({ web: { 'src/a.ts': "const bucket = s3.bucket('shared-uploads')\nexec('users-admin reindex')\n" }, users: { 'src/r.ts': 'x\n' } });
  const d = Object.fromEntries(r.members.map((m) => [m.key, m.dir]));
  const mem = (key) => ({ key, name: key, dir: d[key], role: null, aliases: [key], stack: ['node'], coverage: { level: 'rich' }, facts: { static: 1, llm: 0 } });
  const cat = { version: 1, workspace: { name: 'W' }, members: { web: mem('web'), users: mem('users') }, entries: [], aliasIndex: {}, ambiguousAliases: {},
    consumes: {}, candidates: {}, rejected: [], briefs: {}, errors: [] };
  const scan = (other) => joinMap({ catalog: cat, usage: { version: 1, members: { web: { status: 'investigated', uses: [], rejected: [], other },
    users: { status: 'investigated', uses: [], rejected: [], other: [] } } } });
  const bucket = (key) => ({ to: 'users', kind: 'other', key, label: 'S3 bucket', file: 'src/a.ts', line: 1, match: "s3.bucket('shared-uploads')" });
  const cli = { to: 'users', kind: 'other', key: 'runs the users admin CLI to reindex', label: 'admin CLI', file: 'src/a.ts', line: 2, match: "exec('users-admin reindex')" };
  const m1 = await scan([bucket('web writes uploads to a shared S3 bucket that users reads')]);
  const ov = setEdgeState(emptyOverrides(), m1.edges[0], 'rejected', T1);
  const m2 = await scan([bucket('shared S3 bucket for uploads, read by users'), cli]);
  assert.equal(rekeyOverrides(ov, m2), ov, 'reworded under the same label: the id did not change, nothing to move');
  assert.deepEqual(effectiveEdges(m2, ov).map((e) => `${e.display} ${e.state}`), ['S3 bucket rejected', 'admin CLI auto']);
  const m3 = await scan([cli]);
  const out = rekeyOverrides(ov, m3);
  assert.equal(out, ov, 'the bucket relation is gone: the rejection stays orphaned');
  assert.equal(effectiveEdges(m3, out).find((e) => e.display === 'admin CLI').state, 'auto', 'admin CLI is never suppressed');
});

// ── finalize: the move happens in saveWorkspaceScanResult, inside its transaction, before the re-render ──
test('finalize: a rejected edge into a survey-found route stays rejected after the survey rewords the route; an ambiguous re-scan moves nothing (killer: finalize re-key)', async () => {
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  const r = await reposOf({
    legacy: { 'lib/router.ex': 'get "/reports/:id", ReportController, :show\npatch "/reports/:id", ReportController, :update\nput "/reports/:id", ReportController, :replace\n' },
    shared: { 'package.json': json({ name: '@acme/shared' }) },
    web: { 'package.json': json({ name: '@acme/web', dependencies: { '@acme/shared': '1.0.0' } }),
      'src/a.ts': 'const r = await fetch(`${LEGACY}/reports/${rid}`)\nawait fetch(`${LEGACY}/reports/${rid}`, { method: "PATCH" })\n' },
  });
  const w = await createWorkspace({ name: 'Rekey WS', projectPaths: r.members.map((m) => m.dir) });
  const members = w.projectPaths.map((p, i) => ({ key: w.projectKeys[i], name: basename(p), dir: p }));
  const keyOf = (name) => members.find((m) => m.name === name).key;
  const scan = async (provides) => {
    const extract = await extractWorkspace({ name: w.name, members, detectors: [identity, npm] });
    const survey = { version: 1, members: { [keyOf('legacy')]: { status: 'investigated', role: 'Legacy reports', aliases: [], consumes: [],
      provides: provides.map(([key, line, match]) => ({ kind: 'http', key, file: 'lib/router.ex', line, match })) } } };
    const catalog = await buildCatalog({ extract, survey });
    const routes = catalog.entries.filter((e) => e.member === keyOf('legacy'));
    const uses = routes.map((e, i) => ({ entry: e.id, file: 'src/a.ts', line: i + 1, match: '/reports/${rid}' }));
    return joinMap({ catalog, usage: { version: 1, members: Object.fromEntries(members.map((m) => [m.key,
      { status: 'investigated', uses: m.name === 'web' ? uses : [], rejected: [], other: [] }])) } });
  };
  const httpOf = (m) => m.edges.filter((e) => e.kind === 'http');
  const m1 = await scan([['GET /reports/{id}', 1, 'get "/reports/:id"']]);
  await saveWorkspaceScanResult(w.id, { map: m1 });
  const [e1] = httpOf(m1);
  const pkg = m1.edges.find((e) => e.kind === 'pkg');
  assert.deepEqual([e1.agentKeyed, pkg.agentKeyed], [true, false], 'precondition: the route came from the survey, the package from code');
  const rejectedAt = (await setWorkspaceEdgeState(w.id, e1.id, 'rejected')).overrides.edges[e1.id].at;
  await setWorkspaceEdgeState(w.id, pkg.id, 'confirmed');

  const m2 = await scan([['/reports/:id', 1, 'get "/reports/:id"']]);
  const [e2] = httpOf(m2);
  assert.notEqual(e2.id, e1.id, 'precondition: the reworded key is a new edge id');
  const saved = await saveWorkspaceScanResult(w.id, { map: m2 });
  assert.equal(saved.mapSummary.rejected, 1, 'the returned workspace counts the moved override');
  const after2 = await readWorkspaceMap(w.id);
  assert.deepEqual(after2.overrides.edges[e2.id], { state: 'rejected', from: e1.from, to: e1.to, kind: 'http', display: '/reports/:id', at: rejectedAt });
  assert.ok(!(e1.id in after2.overrides.edges), 'moved, not copied');
  assert.equal(after2.overrides.edges[pkg.id].state, 'confirmed', 'a code-keyed edge keeps its own override');
  assert.equal(effectiveEdges(after2.map, after2.overrides).find((e) => e.id === e2.id).state, 'rejected');
  const text = (await readWorkspace(w.id)).description;
  assert.ok(!text.includes('/reports/:id') && !text.includes('/reports/{id}'), 'the description applies the moved rejection');
  assert.ok(text.includes('(confirmed)'));

  // Two routes of that path now: which one the rejection meant is unknowable, so it moves nowhere.
  const m3 = await scan([['PATCH /reports/{id}', 2, 'patch "/reports/:id"'], ['PUT /reports/{id}', 3, 'put "/reports/:id"']]);
  assert.equal(httpOf(m3).length, 2);
  await saveWorkspaceScanResult(w.id, { map: m3 });
  const after3 = await readWorkspaceMap(w.id);
  assert.deepEqual(Object.keys(after3.overrides.edges).sort(), [e2.id, pkg.id].sort(), 'the rejection stays under its old id: never dropped, never applied');
  for (const e of httpOf(m3)) assert.equal(effectiveEdges(after3.map, after3.overrides).find((x) => x.id === e.id).state, 'auto');
  const text3 = (await readWorkspace(w.id)).description;
  assert.ok(text3.includes('PATCH /reports/{id}') && text3.includes('PUT /reports/{id}'), 'neither new route is suppressed');
});
