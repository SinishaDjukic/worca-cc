// src/core/workflow-versions.mjs
// Named workflow versions (plans/workflow-tests-plan.md Part 1): Save version, Use for new runs, what changed since
// the version in use, restore into the draft, and the Versions page's overview. Storage: workflow-revisions.mjs.
import { getDb, prepare, tx } from './db.mjs';
import { isSafeWorkflowId } from './workflows.mjs';
import { saveGraphWorkflow } from './workflow-share.mjs';
import {
  isVersionableRow, insertVersionTx, setLiveVersionTx, listRevisions, readRevision, readVersion, latestVersion,
} from './workflow-revisions.mjs';
import { workflowFingerprint } from './workflow-fingerprint.mjs';
import { workflowParts } from './workflow-parts.mjs';
import { diffGraphs } from '../shared/graph/diff-graphs.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { loadScriptRegistry } from './script-registry.mjs';

const NOTE_MAX = 200;
const coded = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const parse = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };

function versionableRow(workflowId) {
  if (!isSafeWorkflowId(workflowId)) throw coded(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  getDb();
  const row = prepare('SELECT id, name, version, domain, graph, origin, archived_at, live_version_no FROM workflows WHERE id = ?').get(workflowId);
  if (!row || row.archived_at) throw coded(`unknown workflow "${workflowId}"`, 'NOT_FOUND');
  if (!isVersionableRow(row)) throw coded(`"${row.name}" cannot have versions: it comes from a plugin or is not a graph`, 'NOT_VERSIONABLE');
  return row;
}

function registries(deps = {}) {
  const registry = deps.registry && typeof deps.registry === 'object' ? deps.registry : loadAgentRegistry();
  const scripts = deps.scripts && typeof deps.scripts === 'object' ? deps.scripts : loadScriptRegistry({ agentKeys: Object.keys(registry) });
  return { registry, scripts };
}
const labeler = ({ registry, scripts }) => (n) => {
  const meta = n && n.kind === 'agent' ? registry[n.key] : n && n.kind === 'script' ? scripts[n.key] : null;
  return (meta && meta.displayName) || (n && (n.key || n.kind)) || 'step';
};

/** Save version: keep the row as the next numbered version. The first version is also put in use (D2). */
export async function createVersion(workflowId, { note = null, by = null, deps = {} } = {}) {
  const row = versionableRow(workflowId);
  const graph = parse(row.graph, {});
  const regs = registries(deps);
  const parts = await workflowParts(graph, { ...deps, ...regs });
  const fingerprint = workflowFingerprint(graph, parts);
  const last = latestVersion(workflowId);
  if (last && last.fingerprint === fingerprint && last.name === row.name) {
    throw coded(`nothing changed since version ${last.versionNo}`, 'UNCHANGED', { versionNo: last.versionNo });
  }
  const clean = typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_MAX) : null;
  let versionNo = 0;
  let live = row.live_version_no ?? null;
  tx(() => {
    versionNo = insertVersionTx(row, { note: clean, by, parts, fingerprint });
    if (!live) { setLiveVersionTx(workflowId, versionNo); live = versionNo; }
  });
  return { versionNo, liveVersionNo: live };
}

/** Use for new runs. */
export function useVersion(workflowId, versionNo) {
  versionableRow(workflowId);
  const n = Number(versionNo);
  if (!Number.isInteger(n) || n < 1 || !readVersion(workflowId, n)) throw coded(`no version ${versionNo}`, 'NOT_FOUND');
  tx(() => { setLiveVersionTx(workflowId, n); });
  return { liveVersionNo: n };
}

/** What differs from saved version `ver` to the draft: the graph diff plus "<label>: changed in the Library" per part. */
function changesSince(ver, row, graph, parts, labelOf) {
  return changesBetween(ver, { name: row.name, graph, parts }, labelOf);
}
/** From `a` to `b` (each {name, graph, parts}): the graph diff plus "<label>: changed in the Library" for every agent or
 *  script both use whose content hash differs. */
function changesBetween(a, b, labelOf) {
  const changes = diffGraphs({ name: a.name, ...a.graph }, { name: b.name, ...b.graph }, { labelOf }).map((c) => c.text);
  const before = new Map((a.parts || []).map((p) => [`${p.kind}:${p.key}`, p.hash]));
  const partsChanged = (b.parts || []).filter((p) => before.has(`${p.kind}:${p.key}`) && before.get(`${p.kind}:${p.key}`) !== p.hash)
    .map((p) => ({ kind: p.kind, key: p.key }));
  for (const p of partsChanged) changes.push(`${labelOf(p)}: changed in the Library`);
  return { changes, partsChanged };
}

/**
 * The draft compared with the version in use (`draft`, null when the workflow has no version in use) and with the
 * latest version (`sinceLatest`, what Save version compares against; null when the workflow has no version yet).
 */
export async function versionStatus(workflowId, { deps = {} } = {}) {
  const row = versionableRow(workflowId);
  const latest = latestVersion(workflowId);
  const live = row.live_version_no ? readVersion(workflowId, row.live_version_no) : null;
  const latestVersionNo = latest ? latest.versionNo : null;
  if (!live && !latest) return { liveVersionNo: null, latestVersionNo, draft: null, sinceLatest: null };
  const regs = registries(deps);
  const labelOf = labeler(regs);
  const graph = parse(row.graph, {});
  const parts = await workflowParts(graph, { ...deps, ...regs });
  const sinceLatest = latest ? { versionNo: latest.versionNo, changes: changesSince(latest, row, graph, parts, labelOf).changes } : null;
  if (!live) return { liveVersionNo: null, latestVersionNo, draft: null, sinceLatest };
  const { changes, partsChanged } = changesSince(live, row, graph, parts, labelOf);
  const changed = workflowFingerprint(graph, parts) !== live.fingerprint || row.name !== live.name;
  return { liveVersionNo: live.versionNo, latestVersionNo, draft: { changed, changes, partsChanged, sinceLatest }, sinceLatest };
}

/** Restore into draft (D4): through the validating save; a state that no longer fits is refused (INVALID_GRAPH). */
export async function restoreRevision(workflowId, revisionId, { by = null, agentsDir } = {}) {
  const row = versionableRow(workflowId);
  const rev = readRevision(workflowId, Number(revisionId));
  if (!rev) throw coded(`no saved state ${revisionId} for "${row.name}"`, 'NOT_FOUND');
  const g = rev.graph || {};
  const body = {
    id: workflowId, version: 2, name: rev.name, ...(rev.domain ? { domain: rev.domain } : {}),
    nodes: Array.isArray(g.nodes) ? g.nodes : [], wires: Array.isArray(g.wires) ? g.wires : [],
    ...(g.canvas ? { canvas: g.canvas } : {}), ...(g.codeGraph === false ? { codeGraph: false } : {}),
  };
  return saveGraphWorkflow(body, { agentsDir, revision: { source: 'restore', by } });
}

function runCounts(workflowId) {
  getDb();
  const rows = prepare(`SELECT json_extract(stepper, '$.workflowVersion.no') AS no, COUNT(*) AS n FROM pipelines
    WHERE json_extract(stepper, '$.template.id') = ? GROUP BY no`).all(workflowId);
  return new Map(rows.filter((r) => r.no !== null).map((r) => [Number(r.no), Number(r.n)]));
}

/** Everything the Versions page shows, in one read. */
export async function versionsOverview(workflowId, { deps = {} } = {}) {
  const row = versionableRow(workflowId);
  const status = await versionStatus(workflowId, { deps });
  const labelOf = labeler(registries(deps));
  const all = listRevisions(workflowId);
  const named = all.filter((r) => r.versionNo !== null).sort((a, b) => b.versionNo - a.versionNo);
  const counts = runCounts(workflowId);
  const inUse = status.liveVersionNo ? readVersion(workflowId, status.liveVersionNo) : null;
  const versions = named.map((v, i) => {
    const prev = named[i + 1] ? readVersion(workflowId, named[i + 1].versionNo) : null;
    const cur = readVersion(workflowId, v.versionNo);
    const changes = prev
      ? diffGraphs({ name: prev.name, ...prev.graph }, { name: cur.name, ...cur.graph }, { labelOf }).map((c) => c.text)
      : ['First version'];
    // What changes for new runs if this version is put in use (the Use dialog); `changes` is against the previous one.
    const changesFromInUse = !inUse ? null : v.versionNo === inUse.versionNo ? [] : changesBetween(inUse, cur, labelOf).changes;
    return { id: v.id, versionNo: v.versionNo, note: v.note, by: v.by, createdAt: v.createdAt,
      inUse: v.versionNo === status.liveVersionNo, runs: counts.get(v.versionNo) || 0, changes, changesFromInUse };
  });
  const history = all.filter((r) => r.versionNo === null).map((r) => ({ id: r.id, source: r.source, by: r.by, createdAt: r.createdAt, name: r.name }));
  return { workflowId, name: row.name, liveVersionNo: status.liveVersionNo, draft: status.draft, sinceLatest: status.sinceLatest, versions, history };
}
