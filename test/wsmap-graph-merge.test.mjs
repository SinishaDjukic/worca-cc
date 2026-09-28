// test/wsmap-graph-merge.test.mjs — the merged cross-repo graph: viability, bridges, stubs,
// neighbourhood, streaming, and the enrich hook through joinMap (wsmap P7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { loadMemberGraph, mergeWorkspaceGraph, workspaceGraphEnricher } from '../src/core/workspace-map/graph.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';
import { LIMITS } from '../src/shared/workspace-map/limits.mjs';
import { entryId } from '../src/shared/workspace-map/ids.mjs';
import { edge, makeGraphWorkspace } from './helpers/wsmap-graphs.mjs';
import { git, makeRepos, writeFiles } from './helpers/wsmap-p1-repos.mjs';

const fx = await makeGraphWorkspace();
after(() => fx.ws.cleanup());
const { dir, members, E1, E2, E4, mapOf, out } = fx;
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

test('full merge: graphify-compatible JSON, every link endpoint a node, one bridge per non-rejected edge (killer: bridges)', async () => {
  const map = mapOf();
  const r = await mergeWorkspaceGraph(map, { members, outPath: out('full.json') });
  assert.deepEqual(r, { mode: 'full', file: 'full.json', nodes: 20, bridges: 3 });
  assert.deepEqual(map.graph, r, 'map.graph is set');
  const doc = await readJson(out('full.json'));
  assert.deepEqual(Object.keys(doc), ['directed', 'multigraph', 'graph', 'nodes', 'links']);
  assert.deepEqual([doc.directed, doc.multigraph, doc.graph.mode, doc.graph.workspace], [false, false, 'full', 'Shop']);
  const ids = new Set(doc.nodes.map((n) => n.id));
  assert.equal(ids.size, doc.nodes.length, 'node ids unique');
  for (const l of doc.links) assert.ok(ids.has(l.source) && ids.has(l.target), `dangling link ${l.source} -> ${l.target}`);
  const bridges = doc.links.filter((l) => l.relation === 'cross_repo_uses');
  assert.equal(bridges.length, map.edges.filter((e) => e.state !== 'rejected').length);
  const idOf = (repo, label) => doc.nodes.find((x) => x.repo === repo && x.label === label)?.id;
  const b1 = bridges.find((l) => l.edge_id === E1.id);
  assert.deepEqual([b1.source, b1.target, b1.confidence, b1.kind], [idOf('a', 'getInvoice()'), idOf('b', 'getInvoice()'), 'EXTRACTED', 'http']);
  const b2 = bridges.find((l) => l.edge_id === E2.id);
  assert.deepEqual([b2.source, b2.target], ['a::__member__', 'c::__member__'], 'no symbol for the line / no graph → member stubs');
  assert.equal(bridges.find((l) => l.edge_id === E4.id).source, 's::__member__', 'stale graph → stub');
  assert.ok(!doc.nodes.some((n) => n.repo === 's' && n.local_id !== '__member__'), 'a stale graph is never merged');
  const n = doc.nodes.find((x) => x.id === idOf('a', 'getInvoice()'));
  assert.deepEqual([n.repo, n.label, n.source_file], ['a', 'getInvoice()', 'src/client.ts']);
  assert.match(n.id, /^a::[0-9a-f]{12}$/, 'merged ids are worca-made, never graphify\'s (killer: merged ids)');
  assert.equal(n.id, `a::${n.local_id}`);
  assert.equal(doc.nodes.find((x) => x.id === 'c::__member__').label, 'C');
});

test('viability switch at the thresholds: full at ≤ limits, neighbourhood above (killer: viability)', async () => {
  const nodes = 15 + 2;
  const bytes = (await stat(join(dir.a, 'graphify-out', 'graph.json'))).size + (await stat(join(dir.b, 'graphify-out', 'graph.json'))).size;
  const mode = (limits) => mergeWorkspaceGraph(mapOf(), { members, outPath: out('v.json'), limits: { ...LIMITS, ...limits } }).then((r) => r.mode);
  assert.equal(await mode({ GRAPH_FULL_MAX_NODES: nodes }), 'full', 'Σnodes equal to the limit is still full');
  assert.equal(await mode({ GRAPH_FULL_MAX_NODES: nodes - 1 }), 'neighborhood');
  assert.equal(await mode({ GRAPH_FULL_MAX_BYTES: bytes }), 'full');
  assert.equal(await mode({ GRAPH_FULL_MAX_BYTES: bytes - 1 }), 'neighborhood');
});

test('neighbourhood: bridge ends + GRAPH_HOOD_HOPS hops, capped per member; links only inside the kept set', async () => {
  const r = await mergeWorkspaceGraph(mapOf(), { members, outPath: out('hood.json'), limits: { ...LIMITS, GRAPH_FULL_MAX_NODES: 1 } });
  assert.equal(r.mode, 'neighborhood');
  const doc = await readJson(out('hood.json'));
  const local = doc.nodes.filter((n) => n.repo === 'a').map((n) => n.label);
  assert.ok(local.includes('getInvoice()') && local.includes('f0()') && local.includes('f1()'), local.join(','));
  assert.ok(!local.includes('f2()'), 'three hops from the bridge end');
  const ids = new Set(doc.nodes.map((n) => n.id));
  for (const l of doc.links) assert.ok(ids.has(l.source) && ids.has(l.target));
  const capped = await mergeWorkspaceGraph(mapOf(), { members, outPath: out('cap.json'), limits: { ...LIMITS, GRAPH_FULL_MAX_NODES: 1, GRAPH_HOOD_MAX_NODES_PER_MEMBER: 2 } });
  const capDoc = await readJson(out('cap.json'));
  assert.ok(capDoc.nodes.filter((n) => n.repo === 'a' && n.local_id !== '__member__').length <= 2);
  assert.equal(capped.bridges, 3);
});

test('none: no fresh graph, no edges, or an empty neighbourhood — and nothing is left on disk', async () => {
  const onlyStale = await mergeWorkspaceGraph(mapOf(), { members: members.filter((m) => m.key === 's' || m.key === 'c'), outPath: out('n1.json') });
  assert.deepEqual(onlyStale, { mode: 'none', file: null, nodes: 0, bridges: 0 });
  await assert.rejects(stat(out('n1.json')));
  assert.equal((await mergeWorkspaceGraph(mapOf([]), { members, outPath: out('n2.json') })).mode, 'none');
  const noSymbols = [edge('a', 'c', 'pkg', 'pkg:npm:c', [{ file: 'package.json', line: 1, match: 'x' }], [])];
  assert.equal((await mergeWorkspaceGraph(mapOf(noSymbols), { members, outPath: out('n3.json'), limits: { ...LIMITS, GRAPH_FULL_MAX_NODES: 1 } })).mode, 'none');
  await assert.rejects(stat(out('n3.json')));
  await assert.rejects(stat(out('n3.json.tmp')), 'the temp file is removed');
  await assert.rejects(stat(out('n3.json.links.tmp')), 'the links side file is removed');
});

test('mergeWorkspaceGraph loads member graphs one at a time, in key order (killer: memory bound)', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const loader = async (d) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push(members.find((m) => m.dir === d).key);
    await new Promise((r) => setImmediate(r));
    try { return await loadMemberGraph(d); } finally { active -= 1; }
  };
  await mergeWorkspaceGraph(mapOf(), { members: [...members].reverse(), outPath: out('seq.json'), loader });
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, ['a', 'b', 'c', 's', 'a', 'b'], 'sizing pass over all, emit pass over the fresh ones');
});

test('an unwritable output → mode none with an error, never a throw', async () => {
  const r = await mergeWorkspaceGraph(mapOf(), { members, outPath: join(fx.ws.root, 'no', 'such', 'dir', 'g.json') });
  assert.equal(r.mode, 'none');
  assert.match(r.error, /ENOENT/);
  const leaky = await mergeWorkspaceGraph(mapOf(), { members, outPath: join(fx.ws.root, 'no', 'password=hunter2x', 'g.json') });
  assert.ok(leaky.error.includes('password=***') && !leaky.error.includes('hunter2x'), `error text is redacted, then clipped (killer: redacted errors): ${leaky.error}`);
});

test('a failure inside the writer\'s own setup leaves no temp file (killer: writer cleanup)', async () => {
  const outPath = out('blocked.json');
  await mkdir(`${outPath}.links.tmp`); // the links side file cannot be opened
  const r = await mergeWorkspaceGraph(mapOf(), { members, outPath });
  assert.equal(r.mode, 'none');
  assert.match(r.error, /E[A-Z]+/);
  await assert.rejects(stat(`${outPath}.tmp`), 'the node temp file is removed');
  await assert.rejects(stat(outPath));
});

/** Two members built the way graphify writes them: p has all its code under src/, so graphify's
 *  source_file is relative to src/ ("api.ts"); q has code at the top level. */
async function rootedPair(extraNodes = [], extraLinks = []) {
  const w = await makeRepos({ p: { 'src/api.ts': 'x\n', 'src/page.ts': 'x\n', 'package.json': '{}\n' }, q: { 'routes.ts': 'x\n', 'main.ts': 'x\n' } });
  const [p, q] = w.members;
  const n = (id, label, file, loc, type = 'code') => ({ id, label, file_type: type, source_file: file, source_location: loc, community: 0, norm_label: label.toLowerCase() });
  const doc = (d, nodes, links = []) => JSON.stringify({ directed: false, multigraph: false, graph: {}, nodes, links, hyperedges: [], built_at_commit: git(d, 'rev-parse', 'HEAD') });
  await writeFiles(p.dir, { 'graphify-out/graph.json': doc(p.dir, [n('api_ts', 'api.ts', 'api.ts', 'L1'), n('api_load', 'loadInvoice()', 'api.ts', 'L2'), n('page_ts', 'page.ts', 'page.ts', 'L1'), ...extraNodes], extraLinks) });
  await writeFiles(q.dir, { 'graphify-out/graph.json': doc(q.dir, [n('routes_ts', 'routes.ts', 'routes.ts', 'L1'), n('routes_get', 'getInvoice()', 'routes.ts', 'L2'), n('main_ts', 'main.ts', 'main.ts', 'L1')]) });
  // The consumer cites package.json first: its end resolves through the second item (so does the bridge's location).
  const e = edge('p', 'q', 'http', 'http:GET /invoices/{}', [{ file: 'package.json', line: 1, match: 'x' }, { file: 'src/api.ts', line: 3, match: 'x' }], [{ file: 'routes.ts', line: 2, match: 'x' }]);
  const map = { version: 1, workspace: { name: 'Shop' }, scannedAt: 't', members: [{ key: 'p', name: 'P', coverage: {} }, { key: 'q', name: 'Q', coverage: {} }],
    edges: [e], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, errors: [] };
  return { w, members: [p, q].map(({ key, dir: d }) => ({ key, dir: d })), map };
}

test('graphify paths relative to the common code dir still resolve: context and bridge ends (killer: graph root)', async () => {
  const imports = { source: 'page_ts', target: 'api_ts', relation: 'imports_from', confidence: 'EXTRACTED', source_file: 'page.ts', source_location: 'L1', weight: 1 };
  const { w, members: pq, map } = await rootedPair([], [imports]);
  try {
    const outPath = join(w.root, 'rooted.json');
    const next = await workspaceGraphEnricher({ members: pq, outPath })(map);
    assert.equal(next.edges[0].context.from.symbol, 'loadInvoice()');
    const doc = await readJson(outPath);
    const idOf = (repo, label) => doc.nodes.find((x) => x.repo === repo && x.label === label)?.id;
    const bridge = doc.links.find((l) => l.relation === 'cross_repo_uses');
    assert.deepEqual([bridge.source, bridge.target], [idOf('p', 'loadInvoice()'), idOf('q', 'getInvoice()')], 'no member stub when the symbol exists');
    assert.deepEqual([bridge.source_file, bridge.source_location], ['p/src/api.ts', 'L3'], 'the bridge cites the evidence item its end resolved through (killer: bridge location)');
    assert.equal(doc.nodes.find((x) => x.id === idOf('p', 'loadInvoice()')).source_file, 'src/api.ts', 'merged paths are member-relative (killer: merged source_file)');
    assert.equal(doc.links.find((l) => l.relation === 'imports_from').source_file, 'src/page.ts', 'so are copied links\' paths (killer: merged link paths)');
  } finally {
    await w.cleanup();
  }
});

test('the merged graph and the edge context carry no raw secret from node text (killer: D21 redaction)', async () => {
  const GHP = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'; // graphify slugs document text into ids
  const secretNodes = [{ id: 'api_why', label: 'Connect with password=hunter2', file_type: 'rationale', source_file: 'api.ts', source_location: 'L3' },
    { id: 'api_tok', label: 'withToken(token: abc123def)', file_type: 'code', source_file: 'api.ts', source_location: 'L3' },
    { id: 'api_boot', label: 'boot(password=hunter2x)', file_type: 'code', source_file: 'page.ts', source_location: 'L1' },
    { id: 'doc_x', label: 'Runbook', file_type: 'document', source_file: 'README.md', source_location: null, source_url: 'https://bot:s3cr3t@docs.example/x' },
    { id: `readme_token_${GHP}`, label: 'Token setup', file_type: 'document', source_file: 'README.md', source_location: null }];
  const bootCallsTok = { source: 'api_boot', target: 'api_tok', relation: 'calls', confidence: 'EXTRACTED' };
  const { w, members: pq, map } = await rootedPair(secretNodes, [bootCallsTok]);
  try {
    const outPath = join(w.root, 'secret.json');
    const next = await workspaceGraphEnricher({ members: pq, outPath })(map);
    const text = await readFile(outPath, 'utf8');
    for (const secret of ['hunter2', 's3cr3t', 'abc123def', GHP]) assert.ok(!text.includes(secret), `${secret} is redacted in the merged graph`);
    assert.ok(text.includes('Connect with password=***'), 'the rest of the text is kept');
    const sym = next.edges[0].context.from.symbol;
    assert.ok(sym.startsWith('withToken(') && !sym.includes('abc123def'), `edge context labels are redacted: ${sym}`);
    const callers = next.edges[0].context.from.callers;
    assert.ok(callers.length === 1 && !JSON.stringify(next.edges[0].context).includes('hunter2x'), `caller labels too: ${callers}`);
  } finally {
    await w.cleanup();
  }
});

test('a merged graph larger than one write chunk stays valid: every node and link written once (killer: chunked flush)', async () => {
  const big = [{ id: 'big_doc', label: 'x'.repeat(1100000), file_type: 'document', source_file: 'README.md', source_location: null }];
  const many = Array.from({ length: 9000 }, (_, i) => ({ source: 'api_load', target: 'page_ts', relation: 'calls', confidence: 'EXTRACTED', source_file: 'page.ts', source_location: `L${i + 1}`, weight: 1 }));
  const { w, members: pq, map } = await rootedPair(big, many);
  try {
    const outPath = join(w.root, 'chunked.json');
    const r = await mergeWorkspaceGraph(map, { members: pq, outPath });
    const doc = await readJson(outPath);
    assert.equal(doc.nodes.length, r.nodes);
    assert.equal(new Set(doc.nodes.map((n) => n.id)).size, doc.nodes.length, 'no node written twice');
    assert.equal(doc.links.filter((l) => l.relation === 'calls').length, 9000, 'no link lost or written twice');
  } finally {
    await w.cleanup();
  }
});

test('workspaceGraphEnricher through joinMap: context, coverage, map.graph and the file (the join hook)', async () => {
  const ENTRY = entryId('b', 'http', 'http:GET /invoices/{}');
  const member = (key) => ({ key, name: key, dir: dir[key], role: null, aliases: [key], stack: ['node'], surveyStatus: 'skipped', unresolved: [],
    coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, detectors: {} }, graph: null, facts: { static: 1, llm: 0 } });
  const catalog = { version: 1, workspace: { name: 'Shop' }, members: { a: member('a'), b: member('b') },
    entries: [{ id: ENTRY, member: 'b', kind: 'http', norm: 'http:GET /invoices/{}', display: 'GET /invoices/{id}', terms: ['/invoices'],
      evidence: [{ file: 'src/routes.ts', line: 2, match: 'x' }], sources: ['static'] }],
    consumes: { a: [{ kind: 'http', dir: 'consumes', key: 'GET /invoices/:id', norm: 'http:GET /invoices/{}', file: 'src/client.ts', line: 3, match: 'x',
      source: 'static', test: false, evidence: [{ file: 'src/client.ts', line: 3, match: 'x' }], entry: ENTRY, toMember: 'b' }], b: [] },
    candidates: { a: [], b: [] }, aliasIndex: {}, ambiguousAliases: {}, rejected: [], errors: [] };
  const pick = members.filter((m) => m.key === 'a' || m.key === 'b');
  const map = await joinMap({ catalog, usage: { version: 1, members: {} }, enrich: workspaceGraphEnricher({ members: pick, outPath: out('workspace-graph.json') }) });
  assert.deepEqual(map.graph, { mode: 'full', file: 'workspace-graph.json', nodes: 17, bridges: 1 });
  assert.equal(map.edges[0].context.from.symbol, 'getInvoice()');
  assert.equal(map.members.find((m) => m.key === 'a').coverage.graph.used, true);
  const doc = await readJson(out('workspace-graph.json'));
  assert.equal(doc.links.filter((l) => l.relation === 'cross_repo_uses').length, 1);
  const broken = await workspaceGraphEnricher({ members: pick, outPath: join(fx.ws.root, 'no', 'password=hunter2x', 'g.json') })({ ...map, errors: [] });
  assert.equal(broken.graph.mode, 'none');
  assert.match(broken.errors.at(-1), /^graph: .*ENOENT/);
  assert.ok(!broken.errors.some((x) => x.includes('hunter2x')), 'map.errors never carries a raw secret');
});
