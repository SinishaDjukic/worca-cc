// test/helpers/wsmap-graphs.mjs — a four-member workspace with hand-written graphify graphs
// for the wsmap P7 tests (mock runs never build graphs). a, b: FRESH graphs (built_at_commit =
// HEAD); s: a STALE graph; c: no graph. E1..E4 are map edges between them (E3 rejected).
import { join } from 'node:path';

import { edgeId } from '../../src/shared/workspace-map/ids.mjs';
import { makeRepos, git, writeFiles } from './wsmap-p1-repos.mjs';

const node = (id, label, file, loc, type = 'code') => ({ id, label, file_type: type, source_file: file, source_location: loc, community: 0, norm_label: label.toLowerCase() });
const link = (source, target, relation, confidence = 'EXTRACTED') => ({ source, target, relation, confidence, confidence_score: 1, source_file: '', source_location: null, weight: 1 });
const chain = Array.from({ length: 10 }, (_, i) => node(`f${i}`, `f${i}()`, 'src/far.ts', `L${i + 1}`));

/** a: client.ts (file L1, getInvoice() L3, a rationale node L4, checkout() L10), vm.ts
 *  viewModel.submit() (calls getInvoice, EXTRACTED), checkout() calls it too (INFERRED), and a
 *  10-node call chain f0 → f9 hanging off getInvoice(). 15 nodes. */
export const graphA = (built) => ({ directed: false, multigraph: false, graph: {}, hyperedges: [], built_at_commit: built,
  nodes: [node('src_client_ts', 'client.ts', 'src/client.ts', 'L1'), node('client_getinvoice', 'getInvoice()', 'src/client.ts', 'L3'),
    node('client_rationale', 'Fetches invoices.', 'src/client.ts', 'L4', 'rationale'), node('client_checkout', 'checkout()', 'src/client.ts', 'L10'),
    node('vm_submit', 'viewModel.submit()', 'src/vm.ts', 'L5'), ...chain],
  links: [link('src_client_ts', 'client_getinvoice', 'contains'), link('client_checkout', 'client_getinvoice', 'calls', 'INFERRED'),
    link('vm_submit', 'client_getinvoice', 'calls'), link('client_getinvoice', 'f0', 'calls'),
    ...chain.slice(1).map((n, i) => link(chain[i].id, n.id, 'calls'))] });
/** b: routes.ts (file L1, getInvoice() L2). 2 nodes. */
export const graphB = (built) => ({ directed: false, multigraph: false, graph: {}, hyperedges: [], built_at_commit: built,
  nodes: [node('src_routes_ts', 'routes.ts', 'src/routes.ts', 'L1'), node('routes_getinvoice', 'getInvoice()', 'src/routes.ts', 'L2')],
  links: [link('src_routes_ts', 'routes_getinvoice', 'contains')] });

export function edge(from, to, kind, norm, evFrom, evTo, over = {}) {
  return { id: edgeId(from, to, kind, norm), from, to, kind, norm, display: norm, label: null, detail: null,
    confidence: 'exact', sources: ['static'], evidence: { from: evFrom, to: evTo }, ...over };
}

export async function makeGraphWorkspace() {
  const ws = await makeRepos({ a: { 'src/client.ts': 'x\n' }, b: { 'src/routes.ts': 'x\n' }, c: { 'package.json': '{}\n' }, s: { 'src/x.ts': 'x\n' } });
  const dir = Object.fromEntries(ws.members.map((m) => [m.key, m.dir]));
  await writeFiles(dir.a, { 'graphify-out/graph.json': JSON.stringify(graphA(git(dir.a, 'rev-parse', 'HEAD'))) });
  await writeFiles(dir.b, { 'graphify-out/graph.json': JSON.stringify(graphB(git(dir.b, 'rev-parse', 'HEAD'))) });
  await writeFiles(dir.s, { 'graphify-out/graph.json': JSON.stringify({ ...graphB('deadbeef'), nodes: [node('x_main', 'main()', 'src/x.ts', 'L1')], links: [] }) });
  const E1 = edge('a', 'b', 'http', 'http:GET /invoices/{}', [{ file: 'src/client.ts', line: 4, match: 'x' }], [{ file: 'src/routes.ts', line: 3, match: 'x' }]);
  const E2 = edge('a', 'c', 'pkg', 'pkg:npm:c', [{ file: 'package.json', line: 2, match: 'x' }], []);
  const E3 = edge('a', 'b', 'topic', 'topic:t', [{ file: 'src/client.ts', line: 11, match: 'x' }], [], { state: 'rejected' });
  const E4 = edge('s', 'b', 'http', 'http:GET /x', [{ file: 'src/x.ts', line: 1, match: 'x' }], [{ file: 'src/routes.ts', line: 2, match: 'x' }], { confidence: 'inferred' });
  const mapOf = (edges = [E1, E2, E3, E4]) => ({ version: 1, workspace: { name: 'Shop' }, scannedAt: 't',
    members: ['a', 'b', 'c', 's'].map((key) => ({ key, name: key.toUpperCase(), coverage: { level: 'rich' } })),
    edges: structuredClone(edges), graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, errors: [] });
  return { ws, dir, members: ws.members.map(({ key, dir: d }) => ({ key, dir: d })), E1, E2, E3, E4, mapOf, out: (name) => join(ws.root, name) };
}
