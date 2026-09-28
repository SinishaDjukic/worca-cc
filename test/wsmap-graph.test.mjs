// test/wsmap-graph.test.mjs — graphify read side: load, enclosing symbol, callers, edge
// enrichment from FRESH graphs only (wsmap P7). Mock runs never build graphs: all hand-written.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import { loadMemberGraph, enclosingSymbol, callersOf, enrichMap } from '../src/core/workspace-map/graph.mjs';
import { git, writeFiles } from './helpers/wsmap-p1-repos.mjs';
import { makeGraphWorkspace } from './helpers/wsmap-graphs.mjs';

const fx = await makeGraphWorkspace();
after(() => fx.ws.cleanup());
const { dir, members, E1, E4, mapOf } = fx;

test('loadMemberGraph: absent / garbage → null; graphify shape → nodes, links, commit, bytes', async () => {
  const tmp = join(fx.ws.root, 'scratch-member');
  assert.equal(await loadMemberGraph(tmp), null);
  await writeFiles(tmp, { 'graphify-out/graph.json': '{ not json' });
  assert.equal(await loadMemberGraph(tmp), null);
  await writeFiles(tmp, { 'graphify-out/graph.json': JSON.stringify({ nope: 1 }) });
  assert.equal(await loadMemberGraph(tmp), null);
  await writeFiles(tmp, { 'graphify-out/graph.json': JSON.stringify({ nodes: [{ id: 'n' }, { nope: 1 }], edges: [{ source: 'n', target: 'n' }, { source: 'n' }] }) });
  const legacy = await loadMemberGraph(tmp);
  assert.deepEqual([legacy.nodes.length, legacy.links.length, legacy.builtAtCommit], [1, 1, null], '"edges" read when "links" is absent; junk dropped');
  await writeFiles(tmp, { 'graphify-out/graph.json': JSON.stringify({ nodes: [{ id: 'big', label: 'x'.repeat(1200000) }], links: [] }) });
  assert.equal((await loadMemberGraph(tmp)).nodes.length, 1, 'a graph over the 1 MiB text-read default still loads (maxBytes reaches the read)');
  const g = await loadMemberGraph(dir.a);
  assert.equal(g.nodes.length, 15);
  assert.equal(g.builtAtCommit, git(dir.a, 'rev-parse', 'HEAD'));
  assert.equal(g.bytes, (await stat(join(dir.a, 'graphify-out', 'graph.json'))).size);
  assert.equal(g.path, join(dir.a, 'graphify-out', 'graph.json'));
  assert.equal(g.root, '', 'the fixture\'s paths are checkout-relative');
  assert.equal(await loadMemberGraph(dir.a, { maxBytes: 10 }), null, 'a graph over the load cap is not loaded (G11)');
});

test('loadMemberGraph: a symlinked graph.json or graphify-out/ is never read (killer: symlink)', async () => {
  const outside = join(fx.ws.root, 'outside-member');
  await writeFiles(outside, { 'graphify-out/graph.json': JSON.stringify({ nodes: [{ id: 'n' }], links: [] }) });
  assert.ok(await loadMemberGraph(outside), 'the real file loads');
  if (process.platform !== 'win32') {
    const viaFile = join(fx.ws.root, 'link-file');
    await mkdir(join(viaFile, 'graphify-out'), { recursive: true });
    await symlink(join(outside, 'graphify-out', 'graph.json'), join(viaFile, 'graphify-out', 'graph.json'));
    assert.equal(await loadMemberGraph(viaFile), null, 'a symlinked graph.json');
    const viaDir = join(fx.ws.root, 'link-dir');
    await mkdir(viaDir, { recursive: true });
    await symlink(join(outside, 'graphify-out'), join(viaDir, 'graphify-out'));
    assert.equal(await loadMemberGraph(viaDir), null, 'a symlinked graphify-out/ (its real path leaves the member)');
  }
});

test('enclosingSymbol: nearest code node starting at or before the line; rationale ignored; path forms folded', async () => {
  const g = await loadMemberGraph(dir.a);
  assert.deepEqual(enclosingSymbol(g, 'src/client.ts', 4), { id: 'client_getinvoice', label: 'getInvoice()' }, 'not the rationale node at L4');
  assert.deepEqual(enclosingSymbol(g, 'src/client.ts', 12), { id: 'client_checkout', label: 'checkout()' });
  assert.deepEqual(enclosingSymbol(g, 'src/client.ts', 1), { id: 'src_client_ts', label: 'client.ts' });
  assert.deepEqual(enclosingSymbol(g, 'src\\client.ts', 3), { id: 'client_getinvoice', label: 'getInvoice()' });
  const fold = process.platform === 'win32' || process.platform === 'darwin';
  assert.deepEqual(enclosingSymbol(g, 'SRC/Client.ts', 3), fold ? { id: 'client_getinvoice', label: 'getInvoice()' } : null, 'case folds on win32/darwin only');
  assert.equal(enclosingSymbol(g, 'src/nope.ts', 3), null);
  assert.equal(enclosingSymbol(g, 'src/client.ts', 0), null);
  assert.equal(enclosingSymbol(null, 'x', 1), null);
  const py = (id, label, loc) => ({ id, label, file_type: 'code', source_file: 'app.py', source_location: loc });
  const tie = { nodes: [py('app_py', 'app.py', 'L1'), py('app_load', 'load()', 'L1'), py('app_parse', 'parse()', 'L9')], links: [] };
  assert.deepEqual(enclosingSymbol(tie, 'app.py', 3), { id: 'app_load', label: 'load()' }, 'a symbol on the file node\'s own line wins (killer: G3 tie)');
  const js = (id, label, loc) => ({ id, label, file_type: 'code', source_file: 'server.js', source_location: loc });
  const vars = { nodes: [js('f', 'server.js', 'L1'), js('app', 'app', 'L3'), js('h', 'health()', 'L5'), js('entry', 'entry', 'L7'),
    { id: 'why', label: 'Answers liveness (no auth)', file_type: 'rationale', source_file: 'server.js', source_location: 'L8' }], links: [] };
  assert.deepEqual(enclosingSymbol(vars, 'server.js', 9), { id: 'h', label: 'health()' }, 'neither a variable node nor a rationale ending in ")" encloses a line (killer: variables)');
  const rooted = { root: 'src/', nodes: [{ id: 'load', label: 'load()', file_type: 'code', source_file: 'api.ts', source_location: 'L2' }], links: [] };
  assert.deepEqual(enclosingSymbol(rooted, 'src/api.ts', 3), { id: 'load', label: 'load()' });
  assert.equal(enclosingSymbol(rooted, 'lib/api.ts', 3), null, 'a path outside the graph root is not in the graph (killer: outside root)');
  const ts = (id, label, loc) => ({ id, label, file_type: 'code', source_file: 'm.ts', source_location: loc });
  const inh = { nodes: [ts('m', 'm.ts', 'L1'), ts('base', 'Base', 'L2'), ts('child', 'Child', 'L5')], links: [{ source: 'child', target: 'base', relation: 'inherits' }] };
  assert.deepEqual(enclosingSymbol(inh, 'm.ts', 3), { id: 'base', label: 'Base' }, 'the target of an inherits link is a class (killer: inherits)');
  assert.deepEqual(enclosingSymbol(inh, 'm.ts', 6), { id: 'child', label: 'Child' }, 'so is its source');
  const two = { nodes: [ts('b', 'Beta', 'L1'), ts('a', 'Alpha', 'L2'), ts('r', '.run()', 'L3')],
    links: [{ source: 'b', target: 'r', relation: 'method' }, { source: 'a', target: 'r', relation: 'method' }] };
  assert.deepEqual(enclosingSymbol(two, 'm.ts', 4), { id: 'r', label: 'Alpha.run()' }, 'the lowest class id names a method two classes claim (killer: G15 order)');
});

test('callersOf: relation calls with target = node; EXTRACTED before INFERRED; unique; capped; a method is named with its class', async () => {
  const g = await loadMemberGraph(dir.a);
  assert.deepEqual(callersOf(g, 'client_getinvoice'), ['viewModel.submit()', 'checkout()']);
  assert.deepEqual(callersOf(g, 'client_getinvoice', 1), ['viewModel.submit()']);
  assert.deepEqual(callersOf(g, 'nobody'), []);
  const dup = { nodes: [{ id: 't', label: 'getInvoice()' }, { id: 'c1', label: '.submit()' }, { id: 'c2', label: '.submit()' }],
    links: [{ source: 'c1', target: 't', relation: 'calls', confidence: 'EXTRACTED' }, { source: 'c2', target: 't', relation: 'calls', confidence: 'EXTRACTED' }] };
  assert.deepEqual(callersOf(dup, 't'), ['.submit()'], 'labels are unique (G4)');
  const cls = { nodes: [{ id: 'vm', label: 'ViewModel', file_type: 'code', source_file: 'vm.ts', source_location: 'L3' },
    { id: 'vm_submit', label: '.submit()', file_type: 'code', source_file: 'vm.ts', source_location: 'L4' },
    { id: 'load', label: 'load()', file_type: 'code', source_file: 'api.ts', source_location: 'L1' }],
  links: [{ source: 'vm', target: 'vm_submit', relation: 'method' }, { source: 'vm_submit', target: 'load', relation: 'calls', confidence: 'EXTRACTED' }] };
  assert.deepEqual(callersOf(cls, 'load'), ['ViewModel.submit()'], 'graphify labels a method ".submit()"; its class names it (killer: method label)');
  assert.deepEqual(enclosingSymbol(cls, 'vm.ts', 5), { id: 'vm_submit', label: 'ViewModel.submit()' });
  assert.deepEqual(enclosingSymbol(cls, 'vm.ts', 3), { id: 'vm', label: 'ViewModel' }, 'a class (it owns a method) still encloses its lines');
});

test('enrichMap: context on both ends from FRESH graphs only; a stale graph is never used (killer: stale graph)', async () => {
  const map = mapOf();
  const next = await enrichMap(map, { members });
  assert.deepEqual(next.edges.find((e) => e.id === E1.id).context, {
    from: { symbol: 'getInvoice()', callers: ['viewModel.submit()', 'checkout()'] }, to: { symbol: 'getInvoice()', callers: [] } });
  assert.deepEqual(next.edges.find((e) => e.id === E4.id).context, { to: { symbol: 'getInvoice()', callers: [] } }, 's is stale: no from context');
  const cov = Object.fromEntries(next.members.map((m) => [m.key, m.coverage.graph]));
  assert.deepEqual([cov.a.fresh, cov.a.used, cov.a.nodes, cov.s.fresh, cov.s.used, cov.c], [true, true, 15, false, false, null]);
  assert.equal(map.edges[0].context, undefined, 'the input map is not mutated');
  assert.equal(await enrichMap(null, { members }), null);
  const onlyPkg = await enrichMap(mapOf([fx.E2]), { members });
  assert.equal(onlyPkg.members.find((m) => m.key === 'a').coverage.graph.used, false, 'fresh but no edge end resolved → not used');
  const later = await enrichMap(mapOf([{ ...E1, evidence: { from: [{ file: 'package.json', line: 1, match: 'x' }, ...E1.evidence.from], to: E1.evidence.to } }]), { members });
  assert.equal(later.edges[0].context.from.symbol, 'getInvoice()', 'the first evidence item that sits in a symbol is used');
});

test('enrichMap loads member graphs one at a time, in key order (killer: memory bound)', async () => {
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
  await enrichMap(mapOf(), { members: [...members].reverse(), loader });
  assert.deepEqual([calls, maxActive], [['a', 'b', 'c', 's'], 1]);
});
