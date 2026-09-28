// src/core/workspace-map/join.mjs
// Stage 5 (spec §6.5): code does the matching bookkeeping (D1). Verifies the usage pass's
// citations (D4), turns consumes / uses / candidates / relations into edges with a confidence,
// merges duplicates by stable edge id, computes the change order, coverage and stats, and runs
// the optional graphify enrichment (P7). Candidates the usage pass REJECTED never become edges.
// Never throws.

import { LIMITS, MAP_VERSION } from '../../shared/workspace-map/limits.mjs';
import { CONFIDENCE, KINDS, KIND_LABELS, checkUsage, confidenceRank, storedCheckError } from '../../shared/workspace-map/schema.mjs';
import { cutQuery, normBody, normKey, pathSuffixMatch, topicMatches } from '../../shared/workspace-map/keys.mjs';
import { edgeId } from '../../shared/workspace-map/ids.mjs';
import { changeOrder } from '../../shared/workspace-map/order.mjs';
import { effectiveEdges, rekeyOverrides } from '../../shared/workspace-map/overrides.mjs';
import { redactSecrets } from '../../shared/workspace-map/redact.mjs';
import { QUOTED_TEXT_NOTE, quoteRole, roleQuoteLabel } from '../../shared/workspace-map/render.mjs';
import { createFileCache, verifyFact } from './verify.mjs';
import { isTestPath } from './files.mjs';
import { displayOf, one, routeIndex } from './catalog.mjs';

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Separates the parts of a pair key: no member key holds a NUL. */
const SEP = String.fromCharCode(0);
const msg = (err) => redactSecrets(String((err && err.message) || err || 'unknown error')).slice(0, 300);
const SOURCE_ORDER = Object.freeze(['static', 'candidate', 'usage', 'survey']);
const DISTINCTIVE = Object.freeze(['topic', 'pkg', 'service']);
const ERRORS_MAX = 50;
const ev = (x) => ({ file: x.file, line: x.line, match: x.match });
const txt = (v) => (typeof v === 'string' ? v : '');
/** A verified use / relation by place, then every field an edge copies (C31). */
const byPlace = (a, b) => byStr(txt(a.file), txt(b.file)) || (a.line - b.line || 0) || byStr(txt(a.entry ?? a.to), txt(b.entry ?? b.to))
  || byStr(txt(a.kind), txt(b.kind)) || byStr(txt(a.key), txt(b.key)) || byStr(txt(a.match), txt(b.match)) || byStr(txt(a.detail), txt(b.detail)) || byStr(txt(a.label), txt(b.label));
/** A member-relative POSIX path as the file layer lists it ('./src//a.ts' → 'src/a.ts'). */
const canon = (f) => String(f).split('/').filter((s) => s && s !== '.').join('/');
/** An edge is never more confident than the STATIC facts on either end: a `heuristic` consume or
 *  provide fact (a detector that guessed) caps it at 'heuristic'. */
const capAt = (confidence, ...factConfidences) =>
  (factConfidences.includes('heuristic') && confidenceRank(confidence) < confidenceRank('heuristic') ? 'heuristic' : confidence);

/** Rule (a): `exact` needs a STATIC fact on both ends (spec §5.7), and a survey observation of the same
 *  consume gives `verified` on its own — so merging it with a capped static fact never weakens the edge
 *  (C8). → { confidence, sources } */
function ruleA(c, e) {
  const provStatic = !Array.isArray(e.sources) || e.sources.includes('static');
  const viaStatic = c.source === 'static' ? capAt(provStatic ? 'exact' : 'verified', c.confidence, e.confidence) : null;
  const surveyed = c.source !== 'static' || (Array.isArray(c.sources) && c.sources.includes('survey'));
  const viaSurvey = surveyed ? capAt('verified', e.confidence) : null;
  const confidence = [viaStatic, viaSurvey].filter(Boolean).sort((a, b) => confidenceRank(a) - confidenceRank(b))[0];
  return { confidence, sources: [...(viaStatic ? ['static'] : []), ...(surveyed ? ['survey'] : [])] };
}

function iso(now) {
  try { return now().toISOString(); } catch { return new Date().toISOString(); }
}

function emptyMap(name, runId, now) {
  return { version: MAP_VERSION, workspace: { name: String(name ?? '') }, scannedAt: iso(now), runId: runId ?? null,
    members: [], edges: [], order: [], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 },
    stats: { edges: 0, byKind: {}, byConfidence: {}, candidates: 0, candidatesConfirmed: 0, factsRejected: 0, testFacts: 0 },
    errors: [] };
}

const httpParts = (norm) => {
  const body = normBody(norm);
  const i = body.indexOf(' ');
  return { method: body.slice(0, i), path: body.slice(i + 1) };
};

/** M14: an entry only the survey provided carries a norm an agent worded (a re-scan may word it anew). */
const surveyKeyed = (e) => Array.isArray(e.sources) && !e.sources.includes('static');
/** M14: an `other` edge is keyed by the label the Map tab shows, when it has one — never by the longer
 *  description an agent rewords from scan to scan. */
const labelNorm = (f) => (txt(f.label).trim() ? normKey('other', f.label) : null);

/** Collects edges keyed by id: the strongest confidence wins, sources and evidence union. `agentKeyed`
 *  (M14): an agent chose the norm, so a re-scan may give the same relation a new id — only when every
 *  rule that made the edge keyed it that way. */
function edgeSink(limits) {
  const edges = new Map();
  const unionEv = (a, b) => {
    const seen = new Set(a.map((x) => `${x.file}:${x.line}`));
    for (const x of b) {
      if (a.length >= limits.EVIDENCE_PER_SIDE) break;
      const k = `${x.file}:${x.line}`;
      if (!seen.has(k)) { seen.add(k); a.push(x); }
    }
    return a;
  };
  return {
    add(e) {
      if (!e.from || !e.to || e.from === e.to || !KINDS.includes(e.kind) || !e.norm) return;
      const id = edgeId(e.from, e.to, e.kind, e.norm);
      const next = { id, from: e.from, to: e.to, kind: e.kind, norm: e.norm, display: e.display || normBody(e.norm),
        label: e.label ?? null, detail: e.detail ?? null, confidence: e.confidence, sources: [...e.sources], agentKeyed: e.agentKeyed === true,
        evidence: { from: (e.evidenceFrom || []).slice(0, limits.EVIDENCE_PER_SIDE), to: (e.evidenceTo || []).slice(0, limits.EVIDENCE_PER_SIDE) } };
      const prev = edges.get(id);
      if (!prev) { edges.set(id, next); return; }
      const win = confidenceRank(next.confidence) < confidenceRank(prev.confidence) ? next : prev;
      const lose = win === next ? prev : next;
      edges.set(id, {
        ...win,
        detail: win.detail ?? lose.detail,
        label: win.label ?? lose.label,
        sources: SOURCE_ORDER.filter((s) => win.sources.includes(s) || lose.sources.includes(s)),
        agentKeyed: win.agentKeyed && lose.agentKeyed,
        evidence: { from: unionEv([...win.evidence.from], lose.evidence.from), to: unionEv([...win.evidence.to], lose.evidence.to) },
      });
    },
    list: () => [...edges.values()].sort((a, b) => byStr(a.from, b.from) || byStr(a.to, b.to) || byStr(a.kind, b.kind) || byStr(a.norm, b.norm)),
  };
}

/** M15: the edges a review leaves standing — `edges` with the workspace's overrides applied: first moved
 *  onto an edge an agent reworded this scan (rekeyOverrides, as finalize will), then merged
 *  (effectiveEdges). A rejected edge and a confirmed one the scan no longer finds are gone, a manual edge
 *  is in. An allowlist: any other state (stale, or a later one) never orders or briefs anything. */
const LIVE_STATES = Object.freeze(['auto', 'confirmed', 'manual']);
const liveEdges = (edges, overrides) => effectiveEdges({ edges }, rekeyOverrides(overrides, { edges })).filter((e) => LIVE_STATES.includes(e.state));

/** spec §6.5. usage may be null/garbage. enrich: optional async (map, {catalog}) => map (P7
 *  plugs graphify in; errors inside enrich are caught and recorded in map.errors). overrides (M15):
 *  the workspace's overrides a re-scan froze at run start (null on a first scan) — the stored change
 *  order and cycles follow the live edges, so they are the order the synth brief shows; map.edges
 *  keeps every scanned edge. Never throws. */
export async function joinMap({ catalog, usage, runId = null, now = () => new Date(), enrich = null, limits = LIMITS, overrides = null } = {}) {
  const map = emptyMap(catalog?.workspace?.name, runId, now);
  try {
    const cat = catalog && typeof catalog === 'object' ? catalog : {};
    const members = Object.values(cat.members && typeof cat.members === 'object' ? cat.members : {})
      .filter((m) => m && typeof m.key === 'string' && typeof m.dir === 'string').sort((a, b) => byStr(a.key, b.key));
    if (!members.length) { map.errors.push('catalog: no members'); return map; }
    for (const e of Array.isArray(cat.errors) ? cat.errors : []) if (map.errors.length < ERRORS_MAX) map.errors.push(redactSecrets(String(e)).slice(0, 300));
    const keys = members.map((m) => m.key);
    const dirOf = new Map(members.map((m) => [m.key, m.dir]));
    const entries = (Array.isArray(cat.entries) ? cat.entries : []).filter((e) => e && typeof e.id === 'string' && dirOf.has(e.member));
    const entryById = new Map(entries.map((e) => [e.id, e]));
    // A null item in a corrupt catalog.json never costs the whole map its edges.
    const listOf = (o, k) => (o && typeof o === 'object' && Object.hasOwn(o, k) && Array.isArray(o[k]) ? o[k].filter((x) => x && typeof x === 'object') : []);
    const consumes = (k) => listOf(cat.consumes, k);
    const candidates = (k) => listOf(cat.candidates, k);
    const rejectedBy = new Map(keys.map((k) => [k, (Array.isArray(cat.rejected) ? cat.rejected : []).filter((r) => r?.member === k).length]));
    let factsRejected = Array.isArray(cat.rejected) ? cat.rejected.length : 0;
    let testFacts = 0;

    // Step 1: the usage pass, checked then verified line by line.
    const usageDoc = usage && typeof usage === 'object' ? usage : null;
    if (!usageDoc) map.errors.push('usage: missing or not a JSON object');
    const checked = checkUsage(usageDoc, { memberKeys: keys, entryIds: new Set(entryById.keys()) });
    // Persisted (map_json): never the agent-written value a message echoes, and redacted (D21).
    if (usageDoc) for (const e of checked.errors) if (map.errors.length < ERRORS_MAX) map.errors.push(`usage ${storedCheckError(e)}`);
    const cache = createFileCache();
    const status = new Map();
    const uses = new Map();
    const others = new Map();
    const rejectedCands = new Map();
    // M9: a schema file extract judged a client's copy (the usage brief lists it as unresolved) is no evidence of a
    // use: a use or relation citing it is rejected, like a survey fact (catalog step 1). Paths compare case-folded.
    const copiesBy = new Map(members.map((m) => [m.key, new Set((Array.isArray(m.unresolved) ? m.unresolved : [])
      .filter((x) => x && x.kind === 'graphql' && x.reason === 'client copy of a GraphQL schema' && typeof x.file === 'string').map((x) => x.file.toLowerCase()))]));
    const cited = (k, v) => v.ok && copiesBy.get(k).has(v.fact.file.toLowerCase());
    for (const k of keys) {
      const u = Object.hasOwn(checked.value.members, k) ? checked.value.members[k] : null;
      status.set(k, u ? u.status : 'failed');
      rejectedCands.set(k, new Set((u?.rejected || []).map((r) => `${r.entry}|${canon(r.file)}|${r.line}`)));
      const ok = [];
      for (const x of u?.uses || []) {
        if (entryById.get(x.entry).member === k) continue;
        const v = await verifyFact(dirOf.get(k), x, { cache });
        // §5.1: a use cited from test code never makes an edge; it is counted (only a verified citation has a file).
        if (v.ok && isTestPath(v.fact.file)) { testFacts += 1; continue; }
        // D21: a use of an HTTP entry cites no query, as a static call does not.
        if (v.ok && entryById.get(x.entry).kind === 'http') v.fact.match = cutQuery(v.fact.match);
        if (v.ok && !cited(k, v)) ok.push(v.fact);
        else { factsRejected += 1; rejectedBy.set(k, rejectedBy.get(k) + 1); }
      }
      // C31: the agent's order never picks an edge's detail, label or evidence order — place does.
      uses.set(k, ok.sort(byPlace));
      const rel = [];
      for (const x of u?.other || []) {
        const v = await verifyFact(dirOf.get(k), x, { cache });
        if (v.ok && isTestPath(v.fact.file)) { testFacts += 1; continue; }
        // D21: an HTTP relation keyed by a full URL keeps no query in its key (the edge's display) or its citation.
        if (v.ok && v.fact.kind === 'http') { v.fact.key = cutQuery(v.fact.key); v.fact.match = cutQuery(v.fact.match); }
        if (v.ok && !cited(k, v)) rel.push(v.fact);
        else { factsRejected += 1; rejectedBy.set(k, rejectedBy.get(k) + 1); }
      }
      others.set(k, rel.sort(byPlace));
    }

    // Step 2: edges, strongest rule first.
    const sink = edgeSink(limits);
    const httpEntries = entries.filter((e) => e.kind === 'http').map((e) => ({ e, parts: httpParts(e.norm) }));
    // Rule (b) compares a consume only with the routes pathSuffixMatch can accept (routeIndex: never
    // consumes × routes, even when every route shares a `/api/v1` prefix).
    const nearHttp = routeIndex(httpEntries, (h) => h.parts.path);
    const topicEntries = entries.filter((e) => e.kind === 'topic');
    // …and a topic consume without a wildcard segment only with the topic of its exact name (topicMatches is
    // equality then); a pattern only with the topics that hold its most selective literal segment at the same
    // index before any `#` / `>` — of the same segment count when it has neither (topicMatches needs both), so
    // `acme.<x>.*` never compares with every `acme.` topic.
    const segsOf = (t) => t.split(/[.:]/);
    const topicAt = new Map();
    const topicIs = new Map();
    const put = (map, k, x) => { if (!map.has(k)) map.set(k, []); map.get(k).push(x); };
    for (const x of topicEntries) {
      const body = normBody(x.norm);
      const s = segsOf(body);
      put(topicIs, body, x);
      put(topicAt, `n${s.length}`, x);
      s.forEach((seg, j) => { put(topicAt, `a${j}|${seg}`, x); put(topicAt, `l${s.length}|${j}|${seg}`, x); });
    }
    const nearTopic = (pattern) => {
      const p = segsOf(pattern);
      const open = p.findIndex((s) => s === '#' || s === '>');
      if (open < 0 && !p.includes('*')) return topicIs.get(pattern) || [];
      let best = open < 0 ? topicAt.get(`n${p.length}`) || [] : topicEntries;
      for (let j = 0; j < (open < 0 ? p.length : open); j += 1) {
        if (p[j] === '*') continue;
        const list = topicAt.get(open < 0 ? `l${p.length}|${j}|${p[j]}` : `a${j}|${p[j]}`) || [];
        if (list.length < best.length) best = list;
      }
      return best;
    };
    for (const k of keys) {
      const ownNorms = new Set(entries.filter((e) => e.member === k).map((e) => e.norm));
      // C22 modulo a `*` method: `request('/api/users/' + id)` (method unknown) meets the member's own GET route.
      const ownPaths = new Map();
      for (const e of entries) if (e.member === k && e.kind === 'http') { const p = httpParts(e.norm); if (!ownPaths.has(p.path)) ownPaths.set(p.path, []); ownPaths.get(p.path).push(p.method); }
      const ownRoute = (a) => { const ms = ownPaths.get(a.path); return !!ms && (a.method === '*' || ms.includes('*') || ms.includes(a.method)); };
      for (const c of consumes(k)) {
        if (c.test) { testFacts += 1; continue; }
        const fromEv = Array.isArray(c.evidence) && c.evidence.length ? c.evidence : [ev(c)];
        const staticSrc = c.source === 'static';
        const e = c.entry ? entryById.get(c.entry) : null;
        if (e && e.member !== k) {
          // (a) exact norm (static) — or a survey consume the catalog resolved (verified).
          sink.add({ from: k, to: e.member, kind: e.kind, norm: e.norm, display: e.display, detail: c.detail,
            ...ruleA(c, e), agentKeyed: surveyKeyed(e), evidenceFrom: fromEv, evidenceTo: e.evidence });
          continue;
        }
        // (b) static fuzzy: path suffix / topic glob, only when it lands in ONE member, or in the member the
        //     host names (then exact, like the alias resolution below: more evidence never weakens an edge).
        //     Never for a norm this member provides itself (C22, a `*` method included), for a third-party call
        //     (X2: the catalog marked a call to an unclaimed public host `external`), nor for a call to the
        //     member's own host (`self`, C28). An http call whose host names a member lands only there (C28).
        if (staticSrc && (c.kind === 'http' || c.kind === 'topic') && !ownNorms.has(c.norm) && !c.external && !c.self
          && !(c.kind === 'http' && ownRoute(httpParts(c.norm)))) {
          const a = c.kind === 'http' ? httpParts(c.norm) : null;
          const hits = c.kind === 'http'
            ? nearHttp(a.path).filter(({ e: x, parts: b }) => x.member !== k && (a.method === '*' || b.method === '*' || a.method === b.method)
              && pathSuffixMatch(a.path, b.path)).map(({ e: x }) => x)
            : nearTopic(normBody(c.norm)).filter((x) => x.member !== k && topicMatches(normBody(c.norm), normBody(x.norm)));
          const owners = [...new Set(hits.map((x) => x.member))];
          const owner = c.kind === 'http' && c.hostNamed ? (owners.includes(c.toMember) ? c.toMember : null)
            : owners.length === 1 ? owners[0] : c.toMember && owners.includes(c.toMember) ? c.toMember : null;
          if (owner) {
            for (const x of hits.filter((h) => h.member === owner)) {
              sink.add({ from: k, to: owner, kind: x.kind, norm: x.norm, display: x.display, detail: c.detail,
                confidence: owner === c.toMember ? capAt('exact', c.confidence, x.confidence) : 'heuristic',
                sources: ['static'], agentKeyed: surveyKeyed(x), evidenceFrom: fromEv, evidenceTo: x.evidence });
            }
            continue;
          }
        }
        if (c.toMember && c.toMember !== k && dirOf.has(c.toMember)) {
          // static alias resolution (exact) or a survey consume naming its target (inferred; the agent worded its key).
          sink.add({ from: k, to: c.toMember, kind: c.kind, norm: (c.kind === 'other' && labelNorm(c)) || c.norm, display: displayOf(c.kind, c.key, c.label), label: c.label ?? null,
            detail: c.detail, confidence: staticSrc ? capAt('exact', c.confidence) : 'inferred', sources: [staticSrc ? 'static' : 'survey'], agentKeyed: !staticSrc,
            evidenceFrom: fromEv, evidenceTo: [] });
        }
      }
      // (c) usage uses — verified.
      const candAt = new Set(candidates(k).map((c) => `${c.entry}|${c.file}|${c.line}`));
      for (const u of uses.get(k)) {
        const e = entryById.get(u.entry);
        sink.add({ from: k, to: e.member, kind: e.kind, norm: e.norm, display: e.display, detail: u.detail ?? null, confidence: capAt('verified', e.confidence),
          sources: candAt.has(`${u.entry}|${u.file}|${u.line}`) ? ['candidate', 'usage'] : ['usage'], agentKeyed: surveyKeyed(e), evidenceFrom: [ev(u)], evidenceTo: e.evidence });
      }
      // (d) distinctive candidates stand in ONLY when the usage pass failed for this member —
      //     and a candidate it rejected never becomes an edge.
      if (status.get(k) === 'failed') {
        for (const c of candidates(k)) {
          const e = entryById.get(c.entry);
          if (!e || e.member === k || !DISTINCTIVE.includes(e.kind)) continue;
          if (e.kind === 'pkg' && c.via !== 'import') continue; // a bare package-name literal ('config') is not distinctive
          if (rejectedCands.get(k).has(`${c.entry}|${c.file}|${c.line}`)) continue;
          sink.add({ from: k, to: e.member, kind: e.kind, norm: e.norm, display: e.display, confidence: 'heuristic',
            sources: ['candidate'], agentKeyed: surveyKeyed(e), evidenceFrom: [ev(c)], evidenceTo: e.evidence });
        }
      }
      // (e) relations to named members outside the catalog — inferred.
      for (const o of others.get(k)) {
        const keyed = normKey(o.kind, o.key);
        const kind = keyed ? o.kind : 'other';
        sink.add({ from: k, to: o.to, kind, norm: (kind === 'other' && labelNorm(o)) || keyed || normKey('other', o.key), display: displayOf(kind, o.key, o.label),
          label: o.label ?? null, detail: o.detail ?? null, confidence: 'inferred', sources: ['usage'], agentKeyed: true, evidenceFrom: [ev(o)], evidenceTo: [] });
      }
    }
    map.edges = sink.list();

    // Step 3: change order. Step 5: members + coverage, stats.
    const { order, cycles } = changeOrder(keys, liveEdges(map.edges, overrides));
    map.order = order;
    map.cycles = cycles;
    map.members = members.map((m) => ({
      key: m.key, name: m.name || m.key, role: m.role ?? null, roleSource: m.role ? (m.roleSource === 'survey' ? 'survey' : 'static') : null,
      // M1: the file a static role was copied from — 'readme' | 'manifest', else null (render.mjs roleQuoteLabel).
      roleFrom: m.role && m.roleSource !== 'survey' && (m.roleFrom === 'readme' || m.roleFrom === 'manifest') ? m.roleFrom : null,
      aliases: Array.isArray(m.aliases) ? m.aliases : [], stack: Array.isArray(m.stack) ? m.stack : [],
      coverage: {
        level: m.coverage?.level ?? 'none', files: m.coverage?.files ?? 0, scannedFiles: m.coverage?.scannedFiles ?? 0,
        truncated: !!m.coverage?.truncated, factsStatic: m.facts?.static ?? 0, factsLlm: m.facts?.llm ?? 0,
        unresolved: Array.isArray(m.unresolved) ? m.unresolved.length : 0, rejected: rejectedBy.get(m.key),
        surveyed: m.surveyStatus ?? 'skipped', usageStatus: status.get(m.key),
        graph: m.graph ? { nodes: m.graph.nodes ?? null, fresh: !!m.graph.fresh } : null,
      },
    }));
    const byKind = {};
    const byConfidence = {};
    for (const e of map.edges) {
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      byConfidence[e.confidence] = (byConfidence[e.confidence] || 0) + 1;
    }
    let candTotal = 0;
    let confirmed = 0;
    for (const k of keys) {
      const usedAt = new Set(uses.get(k).map((u) => `${u.entry}|${u.file}|${u.line}`));
      for (const c of candidates(k)) {
        candTotal += 1;
        if (usedAt.has(`${c.entry}|${c.file}|${c.line}`)) confirmed += 1;
      }
    }
    map.stats = { edges: map.edges.length, byKind, byConfidence, candidates: candTotal, candidatesConfirmed: confirmed, factsRejected, testFacts };
  } catch (err) {
    map.errors.push(`join: ${msg(err)}`);
  }
  // Step 4: graphify enrichment (P7) — optional, isolated.
  if (typeof enrich === 'function') {
    try {
      const next = await enrich(map, { catalog });
      if (next && typeof next === 'object' && Array.isArray(next.edges)) return next;
    } catch (err) {
      map.errors.push(`enrich: ${msg(err)}`);
    }
  }
  return map;
}

/** synth-brief.md FIRST LINES exactly:
 *    # Workspace synthesis brief
 *    <!-- worca:map=<abs workspace-map.json> -->
 *    <!-- worca:check=<checker command line> -->
 *  then members (key, name, role or "(missing)"), pair summaries, order, cycles, coverage gaps.
 *  overrides (M15): the pairs and the edge count are the live edges (liveEdges) — what the description
 *  will list; the order and cycles are map.order / map.cycles, which joinMap computed over the same.
 *  ≤ SYNTH_BRIEF_MAX_BYTES. */
export function synthBrief(map, { mapPath, checkerCmd, limits = LIMITS, overrides = null } = {}) {
  const m = map && typeof map === 'object' ? map : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => v !== null && typeof v === 'object';
  const members = arr(m.members).filter(isObj);
  const edges = liveEdges(arr(m.edges), overrides);
  // M1: a role copied from the member's own files is quoted with its source, as in the description.
  const quoted = (x) => (one(x.role) && roleQuoteLabel(x) ? quoteRole(roleQuoteLabel(x), one(x.role)) : null);
  const head = ['# Workspace synthesis brief', `<!-- worca:map=${mapPath} -->`, `<!-- worca:check=${checkerCmd} -->`, '',
    `Workspace "${one(m.workspace?.name)}": ${members.length} member projects, ${edges.length} edges. Full map: \`${mapPath}\`.`, '',
    `## Members (${members.length})`, '', ...(members.some(quoted) ? [QUOTED_TEXT_NOTE, ''] : []),
    ...members.map((x) => `- ${one(x.key)} (${one(x.name)}): ${quoted(x) || one(x.role) || '(missing)'} — stack ${arr(x.stack).join(', ') || 'unknown'}; coverage ${x.coverage?.level ?? 'none'}`), ''];
  const pairs = new Map();
  for (const e of edges) {
    const k = `${e.from}${SEP}${e.to}`;
    if (!pairs.has(k)) pairs.set(k, { from: e.from, to: e.to, edges: [] });
    pairs.get(k).edges.push(e);
  }
  const pairLines = [...pairs.values()].map((p) => {
    const kinds = new Map();
    // D21: a manual edge's display is a person's text, stored as typed (the description redacts it on render).
    for (const e of p.edges) { if (!kinds.has(e.kind)) kinds.set(e.kind, []); kinds.get(e.kind).push(e.state === 'manual' ? redactSecrets(txt(e.display)) : e.display); }
    const parts = [...kinds].map(([k, ds]) => `${(Object.hasOwn(KIND_LABELS, k) && KIND_LABELS[k]) || k} ${ds.length} (${ds.slice(0, 3).join(', ')}${ds.length > 3 ? ', …' : ''})`);
    const conf = [...CONFIDENCE.map((c) => [c, p.edges.filter((e) => e.confidence === c).length]), ['manual', p.edges.filter((e) => e.state === 'manual').length]]
      .filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(', ');
    return one(`- ${p.from} -> ${p.to}: ${parts.join('; ')} [${conf}]`);
  });
  const gaps = members.filter((x) => x.coverage?.level === 'none' || x.coverage?.usageStatus === 'failed' || x.coverage?.surveyed === 'failed')
    .map((x) => `- ${one(x.key)}: coverage ${x.coverage?.level ?? 'none'}; survey ${x.coverage?.surveyed ?? '?'}; usage ${x.coverage?.usageStatus ?? '?'}`);
  const tail = ['', `## Change order (providers first)`, '', ...arr(m.order).filter(Array.isArray).map((l, i) => one(`${i + 1}. ${l.join(', ')}`)), '',
    '## Cycles', '', ...(arr(m.cycles).filter(Array.isArray).length ? arr(m.cycles).filter(Array.isArray).map((c) => one(`- ${c.join(', ')}`)) : ['- none']), '',
    '## Coverage gaps', '', ...(gaps.length ? gaps : ['- none']), '',
    '## Output rules', '',
    '- Write ONE JSON file: `{ "version": 1, "overview": "2-4 sentences", "roles": { "<key>": "one line" }, "coordination": ["…"], "orderNotes": "…" }`.',
    '- roles: only for members marked (missing) above, ≤ 160 chars each. coordination: ≤ 20 notes, each grounded in the pairs above.',
    `- Validate before finishing: \`${checkerCmd}\` — replace <OUT> with the path of your synthesis.json; fix and re-run until it prints OK.`];
  const budget = limits.SYNTH_BRIEF_MAX_BYTES - Buffer.byteLength(head.join('\n') + tail.join('\n'), 'utf8') - 200;
  const body = [`## Pairs (${pairLines.length})`, ''];
  let used = 0;
  for (let i = 0; i < pairLines.length; i += 1) {
    const len = Buffer.byteLength(pairLines[i], 'utf8') + 1;
    if (used + len > budget) { body.push(`- (+${pairLines.length - i} more pairs in the map)`); break; }
    body.push(pairLines[i]);
    used += len;
  }
  return [...head, ...body, ...tail].join('\n') + '\n';
}
