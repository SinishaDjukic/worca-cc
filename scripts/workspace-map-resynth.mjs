// scripts/workspace-map-resynth.mjs — the `workspaceMapResynth` card, stage 1 of wf_workspace_resynth
// (a partial re-scan after a member removal): the stored, already pruned map the run froze
// (run-harness _freezeStoredMap → stored-map.json, plus a copy of the stored merged graph) becomes
// workspace-map.json and the synthesis brief, exactly the outputs workspaceMapJoin writes — so synth,
// render and finalizeWorkspaceScan run unchanged. Unlike join it NEVER degrades to an empty map:
// finalize would save that over the stored one.
// Feasibility (a stored map of exactly this member set) is decided BEFORE this card runs — server
// afterMembersChanged (falls back to a full scan) and the harness freeze at start and at resume (ends
// the run, terminal). The checks below are a last-resort guard against a hand-edited run folder: a
// card error PAUSES the run (failure-policy node/'*'), it does not end it.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { synthBrief, STORED_MAP_FILE } from '../src/core/workspace-map/join.mjs';
import { outPath, readJsonInput, writeJson, writeText, workspaceOf, isObj, checkerFor } from './workspace-map-io.mjs';

const GRAPH_FILE = 'workspace-graph.json';   // the name join writes and finalize's adoptGraphFile adopts
const NO_GRAPH = { mode: 'none', file: null, nodes: 0, bridges: 0 };
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export default async function ({ outputs, ctx, log }) {
  const mapPath = outPath(outputs, 'map');
  const briefPath = outPath(outputs, 'brief');
  const dir = dirname(mapPath);
  const ws = workspaceOf(ctx);
  if (!ws) throw new Error('workspaceMapResynth: this run spans no workspace (ctx.workspace is null)');
  const stored = await readJsonInput({ path: join(dir, STORED_MAP_FILE) });
  const map = isObj(stored) && isObj(stored.map) && Array.isArray(stored.map.members) && Array.isArray(stored.map.edges) ? stored.map : null;
  if (!map) throw new Error(`workspaceMapResynth: no frozen stored map (${STORED_MAP_FILE} is missing or unreadable)`);
  const want = ws.members.map((m) => m.key).sort(byKey).join('\n');
  const have = map.members.map((m) => m && m.key).sort(byKey).join('\n');
  if (want !== have) throw new Error('workspaceMapResynth: the frozen map covers a different member set than this run');
  const graphOk = isObj(map.graph) && map.graph.file === GRAPH_FILE && existsSync(join(dir, GRAPH_FILE));
  const next = { ...map, graph: graphOk ? map.graph : { ...NO_GRAPH }, resynthesizedAt: new Date().toISOString() };
  // The overrides the run froze at start — the brief's pairs follow the edges a review left standing.
  // Read from ctx directly: workspaceOf() does not carry them.
  const overrides = ctx?.workspace?.overrides ?? null;
  await writeJson(mapPath, next);
  await writeText(briefPath, synthBrief(next, { mapPath, checkerCmd: checkerFor('synthesis', mapPath), overrides }));
  if (!graphOk && map.graph && map.graph.file) log('warn', 'the stored merged graph could not be carried over; the description drops its graph line until a full Re-scan');
  return { summary: `re-synthesis of the stored map: ${next.members.length} members, ${next.edges.length} edges` };
}
