// scripts/workspace-map-join.mjs — the `workspaceMapJoin` card (wsmap spec §6.5), stage 5 of
// wf_workspace_scan: verify the usage evidence, join consumers to providers into edges, compute the
// change order -> workspace-map.json, and write the synthesis brief. A missing or unreadable
// catalog.json joins as an empty catalog; a missing or unreadable usage.json leaves static and
// candidate edges only (joinMap). A run that spans no workspace (ctx.workspace null) writes the empty
// map and says why. The card fails only when it cannot write its outputs at all.
import { joinMap, synthBrief } from '../src/core/workspace-map/join.mjs';
import { outPath, readJsonInput, writeJson, writeText, workspaceOf, isObj, checkerFor, briefHead } from './workspace-map-io.mjs';
import { dirname, join } from 'node:path';
import { workspaceGraphEnricher } from '../src/core/workspace-map/graph.mjs';

/** The empty catalog (the shape P1's catalog.mjs builds) a missing or unreadable catalog.json joins as. */
const emptyCatalog = (name) => ({
  // 'consumes' quoted: the v1 tripwire bans the bare sidecar token (index: every P2 file).
  version: 1, workspace: { name }, members: {}, entries: [], aliasIndex: {}, ambiguousAliases: {}, 'consumes': {}, candidates: {},
  rejected: [], briefs: {}, errors: [],
});

export default async function ({ inputs, outputs, ctx, log }) {
  const mapPath = outPath(outputs, 'map');
  const briefPath = outPath(outputs, 'brief');
  const checker = checkerFor('synthesis', mapPath);
  const runId = typeof ctx?.runId === 'string' && ctx.runId ? ctx.runId : null;
  const ws = workspaceOf(ctx);
  /** The empty map + a synthesis brief that still carries its first lines. */
  const degrade = async (why, level = 'warn') => {
    log(level, why);
    await writeJson(mapPath, {
      version: 1, workspace: { name: ws?.name || 'Workspace' }, scannedAt: new Date().toISOString(), runId,
      members: [], edges: [], order: [], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 },
      stats: { edges: 0, byKind: {}, byConfidence: {}, candidates: 0, candidatesConfirmed: 0, factsRejected: 0, testFacts: 0 },
      errors: [why],
    });
    await writeText(briefPath, `${briefHead('Workspace synthesis brief', 'map', mapPath, checker)}\nThe map could not be built: ${why}\n`);
    return { summary: `join degraded — ${why}` };
  };
  if (!ws) return degrade('this run spans no workspace (ctx.workspace is null)');
  try {
    const notes = [];
    let catalog = await readJsonInput(inputs?.catalog);
    if (!isObj(catalog)) {
      notes.push('catalog.json is missing or unreadable');
      catalog = emptyCatalog(ws.name || 'Workspace');
    }
    const usage = await readJsonInput(inputs?.usage);
    if (usage === null) notes.push('usage.json is missing or unreadable (static and candidate edges only)');
    for (const note of notes) log('warn', note);
    // P7: graphify enrichment + the merged cross-repo graph, written next to the map (the pipeline
    // dir). Mock runs never build member graphs, so there it is a no-op (graph.mode 'none').
    const enrich = workspaceGraphEnricher({
      members: ws.members.map((m) => ({ key: m.key, dir: m.dir })),
      outPath: join(dirname(mapPath), 'workspace-graph.json'),
    });
    // M15: the overrides the run froze at start (ctx.workspace.overrides — absent on a first scan): the
    // stored change order and the synth brief follow the edges a review left standing.
    const overrides = ctx?.workspace?.overrides ?? null;
    const map = await joinMap({ catalog, usage, runId, enrich, overrides });
    await writeJson(mapPath, map);
    await writeText(briefPath, synthBrief(map, { mapPath, checkerCmd: checker, overrides }));
    const members = Array.isArray(map?.members) ? map.members.length : 0;
    const edges = Array.isArray(map?.edges) ? map.edges.length : 0;
    return { summary: `map: ${members} members, ${edges} edges${notes.length ? ` — ${notes.join('; ')}` : ''}` };
  } catch (err) {
    return degrade(`workspaceMapJoin failed: ${err?.message || err}`, 'error');
  }
}
