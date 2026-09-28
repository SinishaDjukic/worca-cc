// test/helpers/wsmap-stored.mjs
// A hand-built workspace map (spec §5.7) + synthesis (§5.8) for the storage / API / finalize
// tests: `from` uses `to` over three kinds, each edge with a display that appears nowhere
// else, so a test can tell from the description alone whether an edge was rendered.
import { edgeId } from '../../src/shared/workspace-map/ids.mjs';

export const DISPLAYS = Object.freeze({
  http: 'GET /zz-invoices/{id}',
  topic: 'zz.orders.created',
  pkg: '@zz/shared-auth',
});

/**
 * @param {{keys:string[], names?:string[], name?:string, runId?:string, drop?:string[], graph?:object}} opts
 *   keys: two member keys (keys[0] uses keys[1]); drop: kinds to leave out (a re-scan that lost an edge)
 * @returns {{map:object, synthesis:object, ids:{http:string, topic:string, pkg:string}}}
 */
export function sampleMap({ keys, names = keys, name = 'Shop', runId = 'run00001', drop = [], graph = null }) {
  const [from, to] = keys;
  const specs = [
    { kind: 'http', norm: 'http:GET /zz-invoices/{}', display: DISPLAYS.http, confidence: 'exact', sources: ['static'] },
    { kind: 'topic', norm: 'topic:zz.orders.created', display: DISPLAYS.topic, confidence: 'verified', sources: ['usage'] },
    { kind: 'pkg', norm: 'pkg:npm:@zz/shared-auth', display: DISPLAYS.pkg, confidence: 'exact', sources: ['static'] },
  ];
  const ids = Object.fromEntries(specs.map((s) => [s.kind, edgeId(from, to, s.kind, s.norm)]));
  const edges = specs.filter((s) => !drop.includes(s.kind)).map((s) => ({
    id: ids[s.kind], from, to, kind: s.kind, norm: s.norm, display: s.display, label: null, detail: '',
    confidence: s.confidence, sources: s.sources,
    evidence: { from: [{ file: 'src/client.js', line: 3, match: s.display }], to: [{ file: 'src/server.js', line: 7, match: s.display }] },
  }));
  const member = (key, i) => ({
    key, name: names[i], role: `Role of ${names[i]}`, roleSource: 'static', aliases: [], stack: ['node'],
    coverage: { level: 'rich', files: 3, scannedFiles: 3, truncated: false, factsStatic: 3, factsLlm: 0,
      unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null },
  });
  const byKind = {};
  for (const e of edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const map = {
    version: 1, workspace: { name }, scannedAt: '2026-09-25T00:00:00.000Z', runId,
    members: keys.map(member),
    edges,
    order: [[to], [from]],
    cycles: [],
    graph: graph || { mode: 'none', file: null, nodes: 0, bridges: 0 },
    stats: { edges: edges.length, byKind, byConfidence: {}, candidates: 0, candidatesConfirmed: 0, factsRejected: 0 },
    errors: [],
  };
  const synthesis = { version: 1, overview: 'Two services share invoices.', roles: {}, coordination: [], orderNotes: '' };
  return { map, synthesis, ids };
}
