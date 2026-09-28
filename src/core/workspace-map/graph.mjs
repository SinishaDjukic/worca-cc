// src/core/workspace-map/graph.mjs
// graphify enriches, never discovers (spec D14, D15). Pure Node — no python, no graphify CLI:
//   loadMemberGraph      one member's <checkout>/graphify-out/graph.json (+ its code root), or null
//   enclosingSymbol      the code node a cited line sits in (same file, nearest start ≤ line)
//   callersOf            up to N labels of nodes that `calls` it
//   enrichMap            edge.context {symbol, callers} per end + coverage.graph, FRESH graphs only
//   mergeWorkspaceGraph  a graphify-compatible cross-repo graph (graphify's own `<repo>::<id>`
//                        scheme) with one bridge link per map edge (one carrying state
//                        'rejected' is skipped) — full when small enough, else a 2-hop
//                        neighbourhood of the bridge ends, else none
// graphify writes source_file relative to the common directory of the files it extracted, not
// always the checkout root: lookups go through each graph's resolved root. Text copied out of a
// checkout passes redactSecrets (spec D21).
// Memory: member graphs are loaded ONE AT A TIME (never all at once); the merged output is
// streamed to disk in ~1 MiB chunks (nodes to the file, links to a side file appended at the end).

import { createReadStream } from 'node:fs';
import { lstat, open, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { hash64 } from '../../shared/workspace-map/ids.mjs';
import { LIMITS } from '../../shared/workspace-map/limits.mjs';
import { redactSecrets } from '../../shared/workspace-map/redact.mjs';
import { gitOutput, listMemberFiles, readAbsText } from './files.mjs';

const GRAPH_LOAD_MAX_BYTES = 256 * 1024 * 1024;
const STUB_ID = '__member__';
const WRITE_CHUNK = 1024 * 1024;
const CONFIDENCE_SCORE = Object.freeze({ exact: 1, verified: 0.9, heuristic: 0.6, inferred: 0.4 });
const CONFIDENCE_TAG = Object.freeze({ exact: 'EXTRACTED', verified: 'EXTRACTED', heuristic: 'INFERRED', inferred: 'AMBIGUOUS' });
const INDEX = new WeakMap();
const ROOTS = new Map(); // `${path}\0${size}\0${mtimeMs}` → graphRoot (one listing per member per process)
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const msg = (err) => redactSecrets(String((err && err.message) || err || 'unknown error')).slice(0, 300); // redact, then clip (D21)
const posix = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const FOLD = process.platform === 'win32' || process.platform === 'darwin';
const foldCase = (p) => (FOLD ? p.toLowerCase() : p);

/** graphify writes source_file relative to the common directory of the files it extracted (code
 *  and markdown) — the checkout root only when they sit in two or more top-level entries (all of
 *  them under src/ → "src/api.ts" is written "api.ts"; a root README.md keeps "src/api.ts").
 *  → the member-relative POSIX prefix ('' or e.g. 'src/') under
 *  which the most of the graph's files exist in the checkout. */
async function graphRoot(nodes, dir) {
  const files = [...new Set(nodes.map((n) => posix(n.source_file)).filter((f) => f && !f.startsWith('/') && !/^[A-Za-z]:/.test(f) && !f.split('/').includes('..')))].sort(byStr);
  if (!files.length) return '';
  try {
    if ((await stat(join(dir, ...files[0].split('/')))).isFile()) return '';
  } catch { /* not at the checkout root */ }
  const { files: listed } = await listMemberFiles(dir);
  const have = new Set(listed.map(foldCase));
  const score = (p) => files.reduce((n, f) => n + (have.has(foldCase(p + f)) ? 1 : 0), 0);
  let best = '';
  let bestScore = score('');
  for (const probe of files.slice(0, 5)) {
    for (const x of listed) {
      if (!foldCase(x).endsWith(foldCase(`/${probe}`))) continue;
      const p = x.slice(0, x.length - probe.length);
      const n = score(p);
      if (n > bestScore || (n === bestScore && p.length < best.length)) { best = p; bestScore = n; }
    }
  }
  return best;
}

async function cachedRoot(key, compute) {
  if (!ROOTS.has(key)) ROOTS.set(key, await compute());
  return ROOTS.get(key);
}

/** → { path, nodes, links, builtAtCommit, bytes, root } | null (absent, unreadable, not a graph,
 *  > maxBytes, a symlink, or a real path outside the member — P1's readAbsText containment).
 *  root: see graphRoot — enclosingSymbol strips it from member-relative paths. */
export async function loadMemberGraph(dir, { maxBytes = GRAPH_LOAD_MAX_BYTES } = {}) {
  const memberDir = String(dir ?? '');
  const path = join(memberDir, 'graphify-out', 'graph.json');
  let st;
  try { st = await lstat(path); } catch { return null; }
  if (!st.isFile() || st.size > maxBytes) return null;
  const text = await readAbsText(path, { maxBytes, root: memberDir });
  if (text === null) return null;
  try {
    const g = JSON.parse(text);
    if (!g || typeof g !== 'object' || !Array.isArray(g.nodes)) return null;
    const rawLinks = Array.isArray(g.links) ? g.links : Array.isArray(g.edges) ? g.edges : [];
    const nodes = g.nodes.filter((n) => n && (typeof n.id === 'string' || typeof n.id === 'number'));
    return {
      path,
      nodes,
      links: rawLinks.filter((l) => l && l.source != null && l.target != null),
      builtAtCommit: typeof g.built_at_commit === 'string' ? g.built_at_commit : null,
      bytes: st.size,
      root: await cachedRoot(`${path}\0${st.size}\0${st.mtimeMs}`, () => graphRoot(nodes, memberDir)),
    };
  } catch {
    return null;
  }
}

/** Lazily built lookups over one loaded graph (cached per graph object). */
function indexOf(graph) {
  let ix = INDEX.get(graph);
  if (ix) return ix;
  const links = Array.isArray(graph.links) ? graph.links : [];
  // graphify labels a method ".submit()"; its class owns it through a `method` link (class → method).
  const owner = new Map();
  const classes = new Set(); // sources of `method` / `inherits` links, targets of `inherits`
  for (const l of links) {
    if (l.relation === 'method' || l.relation === 'inherits') classes.add(String(l.source));
    if (l.relation === 'inherits') classes.add(String(l.target));
    if (l.relation !== 'method') continue;
    const [cls, fn] = [String(l.source), String(l.target)];
    if (!owner.has(fn) || byStr(cls, owner.get(fn)) < 0) owner.set(fn, cls);
  }
  const raw = new Map(graph.nodes.map((n) => [String(n.id), String(n.label ?? n.id)]));
  const labelOf = (id) => {
    const label = raw.get(id) ?? id;
    const cls = label.startsWith('.') && owner.has(id) ? raw.get(owner.get(id)) : null;
    return cls ? `${cls}${label}` : label;
  };
  const byFile = new Map();
  const labels = new Map();
  for (const n of graph.nodes) {
    const id = String(n.id);
    labels.set(id, labelOf(id));
    if (n.file_type !== undefined && n.file_type !== 'code') continue;
    const loc = /^L(\d+)/.exec(String(n.source_location ?? ''));
    const file = posix(n.source_file);
    if (!loc || !file) continue;
    const isFile = basename(file) === n.label;
    // graphify also emits variable / constant nodes (block-locals of callbacks included): only the
    // file node, callables (label "…)") and classes may enclose a line.
    if (!isFile && !String(n.label ?? '').endsWith(')') && !classes.has(id)) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ loc: Number(loc[1]), id, label: labelOf(id), isFile });
  }
  // Ascending start line; on a tie the file node sorts first so the symbol wins the scan.
  for (const list of byFile.values()) list.sort((a, b) => a.loc - b.loc || Number(b.isFile) - Number(a.isFile) || byStr(a.id, b.id));
  const folded = new Map([...byFile.keys()].map((f) => [foldCase(f), f]));
  const callers = new Map();
  for (const l of links) {
    if (l.relation !== 'calls') continue;
    const t = String(l.target);
    if (!callers.has(t)) callers.set(t, []);
    callers.get(t).push({ source: String(l.source), extracted: l.confidence === 'EXTRACTED' });
  }
  ix = { byFile, folded, labels, callers };
  INDEX.set(graph, ix);
  return ix;
}

/** → { id, label } | null — the code node of `file` (member-relative; graph.root stripped) with
 *  the greatest start line ≤ line. */
export function enclosingSymbol(graph, file, line) {
  if (!graph || !Array.isArray(graph.nodes) || !Number.isInteger(line) || line < 1) return null;
  const ix = indexOf(graph);
  let f = posix(file);
  const root = typeof graph.root === 'string' ? graph.root : '';
  if (root) {
    if (!foldCase(f).startsWith(foldCase(root))) return null;
    f = f.slice(root.length);
  }
  const list = ix.byFile.get(f) || ix.byFile.get(ix.folded.get(foldCase(f)));
  if (!list) return null;
  let best = null;
  for (const n of list) {
    if (n.loc > line) break;
    best = n;
  }
  return best ? { id: best.id, label: best.label } : null;
}

/** → string[] labels of the nodes that call `nodeId` (relation 'calls', target = nodeId);
 *  EXTRACTED before INFERRED, then by label; unique; at most n. */
export function callersOf(graph, nodeId, n = LIMITS.CALLERS_PER_END) {
  if (!graph || !Array.isArray(graph.links)) return [];
  const ix = indexOf(graph);
  const list = (ix.callers.get(String(nodeId)) || [])
    .map((c) => ({ label: ix.labels.get(c.source) ?? c.source, extracted: c.extracted }))
    .sort((a, b) => Number(b.extracted) - Number(a.extracted) || byStr(a.label, b.label));
  return [...new Set(list.map((c) => c.label))].slice(0, Math.max(0, n));
}

/** The first evidence item of `side` that sits in a code node → { sym, ev }, else null. */
function endSymbol(g, e, side) {
  for (const ev of Array.isArray(e?.evidence?.[side]) ? e.evidence[side] : []) {
    const sym = ev ? enclosingSymbol(g, ev.file, ev.line) : null;
    if (sym) return { sym, ev };
  }
  return null;
}

function sortedMembers(members) {
  return (Array.isArray(members) ? members : [])
    .filter((m) => m && typeof m.key === 'string' && typeof m.dir === 'string')
    .sort((a, b) => byStr(a.key, b.key));
}

async function isFresh(g, dir) {
  if (!g || !g.builtAtCommit) return false;
  const head = (await gitOutput(dir, ['rev-parse', 'HEAD']))?.trim();
  return !!head && head === g.builtAtCommit;
}

/** members: [{key, dir}] → a new map with edge.context {from?, to?: {symbol, callers}} and
 *  members[].coverage.graph = {nodes, bytes, fresh, used} (null when absent). A stale graph
 *  (built_at_commit ≠ HEAD) is never used. Loads one member graph at a time. */
export async function enrichMap(map, { members, loader = loadMemberGraph, limits = LIMITS } = {}) {
  if (!map || typeof map !== 'object' || !Array.isArray(map.edges)) return map;
  const out = {
    ...map,
    edges: map.edges.map((e) => ({ ...e })),
    members: (Array.isArray(map.members) ? map.members : []).map((m) => ({ ...m, coverage: { ...(m?.coverage || {}) } })),
  };
  const byKey = new Map(out.members.map((m) => [m.key, m]));
  for (const m of sortedMembers(members)) {
    const g = await loader(m.dir);
    const fresh = await isFresh(g, m.dir);
    let used = 0;
    if (fresh) {
      for (const e of out.edges) {
        for (const side of ['from', 'to']) {
          if (e[side] !== m.key) continue;
          const hit = endSymbol(g, e, side);
          if (!hit) continue;
          used += 1;
          e.context = { ...(e.context || {}), [side]: { symbol: redactSecrets(hit.sym.label),
            callers: callersOf(g, hit.sym.id, limits.CALLERS_PER_END).map((c) => redactSecrets(c)) } };
        }
      }
    }
    if (byKey.has(m.key)) byKey.get(m.key).coverage.graph = g ? { nodes: g.nodes.length, bytes: g.bytes, fresh, used: used > 0 } : null;
  }
  return out;
}

/** Undirected BFS from `seeds` up to `hops`; every seed is kept, expansion stops at `max`. */
function neighbourhood(graph, seeds, hops, max) {
  const adj = new Map();
  for (const l of graph.links) {
    const s = String(l.source);
    const t = String(l.target);
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s).push(t);
    adj.get(t).push(s);
  }
  const keep = new Set([...seeds].sort(byStr));
  let frontier = [...keep];
  for (let h = 0; h < hops && frontier.length && keep.size < max; h += 1) {
    const next = [];
    for (const id of frontier) {
      for (const nb of [...new Set(adj.get(id) || [])].sort(byStr)) {
        if (keep.has(nb)) continue;
        if (keep.size >= max) break;
        keep.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return keep;
}

/** graphify's source_file → member-relative POSIX (the graph root + graphify's path); null for an
 *  empty or absolute path (the caller keeps it as it is). */
function memberPath(root, f) {
  const sf = posix(f);
  return sf && !sf.startsWith('/') && !/^[A-Za-z]:/.test(sf) ? root + sf : null;
}

/** A member node as the merged graph carries it: a worca-made id `<key>::<lid>` (lid = 12 hex of
 *  hash64 — graphify's ids are slugs of checkout text) plus `repo` and `local_id`; `source_file`
 *  member-relative POSIX (so it matches the map's evidence); every string attribute through
 *  redactSecrets (spec D21 — rationale and document labels are free text from the checkout, and
 *  the merged graph leaves it). */
function mergedNode(n, key, lid, root) {
  const out = {};
  for (const [k, v] of Object.entries(n)) out[k] = typeof v === 'string' ? redactSecrets(v) : v;
  const sf = memberPath(root, n.source_file);
  if (sf !== null) out.source_file = redactSecrets(sf);
  return { ...out, id: `${key}::${lid}`, repo: key, local_id: lid };
}

/** Streams a node-link JSON document: nodes into the target's temp file, links into a side
 *  file (each buffered, written in ~1 MiB chunks), joined on close; then an atomic rename. */
async function graphWriter(outPath, meta) {
  const tmp = `${outPath}.tmp`;
  const tmpLinks = `${outPath}.links.tmp`;
  let fh = null;
  let lh = null;
  const abort = async () => {
    await lh?.close().catch(() => {});
    await fh?.close().catch(() => {});
    await rm(tmpLinks, { force: true }).catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
  };
  try {
    fh = await open(tmp, 'w');
    lh = await open(tmpLinks, 'w');
    await fh.write(`{"directed":false,"multigraph":false,"graph":${JSON.stringify(meta)},"nodes":[`);
  } catch (err) {
    await abort();
    throw err;
  }
  let nodes = 0;
  let links = 0;
  const buf = { n: [], nLen: 0, l: [], lLen: 0 };
  const flushNodes = async () => { if (buf.n.length) { const t = buf.n.join(''); buf.n = []; buf.nLen = 0; await fh.write(t); } };
  const flushLinks = async () => { if (buf.l.length) { const t = buf.l.join(''); buf.l = []; buf.lLen = 0; await lh.write(t); } };
  return {
    async node(n) {
      const t = (nodes ? ',' : '') + JSON.stringify(n);
      nodes += 1;
      buf.n.push(t);
      buf.nLen += t.length;
      if (buf.nLen >= WRITE_CHUNK) await flushNodes();
    },
    async link(l) {
      const t = (links ? ',' : '') + JSON.stringify(l);
      links += 1;
      buf.l.push(t);
      buf.lLen += t.length;
      if (buf.lLen >= WRITE_CHUNK) await flushLinks();
    },
    count: () => nodes,
    async close() {
      await flushNodes();
      await flushLinks();
      await lh.close();
      await fh.write('],"links":[');
      for await (const chunk of createReadStream(tmpLinks)) await fh.write(chunk);
      await fh.write(']}\n');
      await fh.close();
      await rm(tmpLinks, { force: true });
      await rename(tmp, outPath);
    },
    abort,
  };
}

/** → { mode: 'full'|'neighborhood'|'none', file, nodes, bridges } and sets map.graph to it.
 *  Full merge when Σnodes ≤ GRAPH_FULL_MAX_NODES and Σbytes ≤ GRAPH_FULL_MAX_BYTES (fresh
 *  graphs only); else the GRAPH_HOOD_HOPS neighbourhood of every bridge end, ≤
 *  GRAPH_HOOD_MAX_NODES_PER_MEMBER per member; none when no member has a fresh graph, there is
 *  no edge to bridge, or the neighbourhood is empty. One bridge link per non-rejected edge,
 *  from the consumer's enclosing symbol to the provider's (`<key>::__member__` stub when a
 *  member has no fresh graph or no symbol for the cited line). Never throws (error → none). */
export async function mergeWorkspaceGraph(map, { members, outPath, limits = LIMITS, loader = loadMemberGraph } = {}) {
  const none = { mode: 'none', file: null, nodes: 0, bridges: 0 };
  const done = (g) => {
    if (map && typeof map === 'object') map.graph = { mode: g.mode, file: g.file, nodes: g.nodes, bridges: g.bridges };
    return g;
  };
  let writer = null;
  try {
    const list = sortedMembers(members);
    const edges = (Array.isArray(map?.edges) ? map.edges : []).filter((e) => e && e.state !== 'rejected' && e.from && e.to && e.from !== e.to);
    if (!list.length || !edges.length || typeof outPath !== 'string' || !outPath) return done(none);
    // Pass 1 — sizing: which members have a FRESH graph, and how big is the sum.
    const sizes = new Map();
    for (const m of list) {
      const g = await loader(m.dir);
      if (await isFresh(g, m.dir)) sizes.set(m.key, { nodes: g.nodes.length, bytes: g.bytes });
    }
    if (!sizes.size) return done(none);
    const sum = (k) => [...sizes.values()].reduce((n, s) => n + s[k], 0);
    const full = sum('nodes') <= limits.GRAPH_FULL_MAX_NODES && sum('bytes') <= limits.GRAPH_FULL_MAX_BYTES;
    const mode = full ? 'full' : 'neighborhood';
    const names = new Map((Array.isArray(map.members) ? map.members : []).map((m) => [m.key, m.name || m.key]));
    writer = await graphWriter(outPath, { name: 'worca workspace graph', workspace: map.workspace?.name ?? '', mode,
      members: list.map((m) => m.key), scannedAt: map.scannedAt ?? null });
    // Pass 2 — emit: one member graph at a time; bridge ends resolved while it is loaded.
    const ends = new Map();
    for (const m of list) {
      if (!sizes.has(m.key)) continue;
      const g = await loader(m.dir);
      if (!g) continue;
      const root = g.root || '';
      const lids = new Map(); // graphify id → worca-made local id (hash64 of key|id), per member
      const lid = (id) => {
        if (!lids.has(id)) lids.set(id, hash64(`${m.key}|${id}`).slice(0, 12));
        return lids.get(id);
      };
      const seeds = new Set();
      for (const e of edges) {
        for (const side of ['from', 'to']) {
          if (e[side] !== m.key) continue;
          const hit = endSymbol(g, e, side);
          if (!hit) continue;
          seeds.add(hit.sym.id);
          if (!ends.has(e.id)) ends.set(e.id, {});
          ends.get(e.id)[side] = `${m.key}::${lid(hit.sym.id)}`;
          if (side === 'from') ends.get(e.id).fromEv = hit.ev;
        }
      }
      const keep = full ? null : neighbourhood(g, seeds, limits.GRAPH_HOOD_HOPS, limits.GRAPH_HOOD_MAX_NODES_PER_MEMBER);
      for (const n of g.nodes) {
        const id = String(n.id);
        if (keep && !keep.has(id)) continue;
        await writer.node(mergedNode(n, m.key, lid(id), root));
      }
      for (const l of g.links) {
        const s = String(l.source);
        const t = String(l.target);
        if (keep && (!keep.has(s) || !keep.has(t))) continue;
        const sf = memberPath(root, l.source_file);
        await writer.link({ ...l, ...(sf === null ? {} : { source_file: sf }), source: `${m.key}::${lid(s)}`, target: `${m.key}::${lid(t)}` });
      }
    }
    if (!writer.count()) {
      await writer.abort();
      writer = null;
      return done(none);
    }
    const stubs = new Set();
    const endOf = (e, side) => {
      const id = ends.get(e.id)?.[side];
      if (id) return id;
      stubs.add(e[side]);
      return `${e[side]}::${STUB_ID}`;
    };
    let bridges = 0;
    for (const e of edges) {
      const ev = ends.get(e.id)?.fromEv ?? e.evidence?.from?.[0];
      await writer.link({ source: endOf(e, 'from'), target: endOf(e, 'to'), relation: 'cross_repo_uses',
        confidence: CONFIDENCE_TAG[e.confidence] || 'INFERRED', confidence_score: CONFIDENCE_SCORE[e.confidence] ?? 0.5,
        source_file: ev ? `${e.from}/${ev.file}` : '', source_location: ev ? `L${ev.line}` : null, weight: 1,
        context: `${e.kind}: ${e.display ?? ''}`.trim(), kind: e.kind, edge_id: e.id, from_repo: e.from, to_repo: e.to });
      bridges += 1;
    }
    for (const key of [...stubs].sort(byStr)) {
      const label = names.get(key) || key;
      await writer.node({ id: `${key}::${STUB_ID}`, label, file_type: 'code', source_file: '', source_location: null,
        community: null, norm_label: String(label).toLowerCase(), repo: key, local_id: STUB_ID });
    }
    const nodes = writer.count();
    await writer.close();
    writer = null;
    return done({ mode, file: basename(outPath), nodes, bridges });
  } catch (err) {
    if (writer) await writer.abort().catch(() => {});
    return done({ ...none, error: msg(err) });
  }
}

/** The `enrich` hook scripts/workspace-map-join.mjs hands to joinMap: enrichMap, then
 *  mergeWorkspaceGraph into `outPath`; a merge error lands in map.errors, never a throw. */
export function workspaceGraphEnricher({ members, outPath, loader = loadMemberGraph, limits = LIMITS } = {}) {
  return async (map) => {
    const next = await enrichMap(map, { members, loader, limits });
    const g = await mergeWorkspaceGraph(next, { members, outPath, loader, limits });
    if (g.error) next.errors = [...(Array.isArray(next.errors) ? next.errors : []), `graph: ${g.error}`];
    return next;
  };
}
