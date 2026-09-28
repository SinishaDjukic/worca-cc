// src/core/workspace-map/catalog.mjs
// Stage 3 (spec §6.3): everything the workspace PROVIDES, as one catalog of stable entries.
// Verifies the survey's facts (D4), merges them with the static ones, builds the alias index
// (the strongest claim of an alias names its member; a tie there leaves it unused), resolves static
// consumes by exact norm or host alias, runs the language-agnostic candidate scan (D13), and writes one
// bounded usage brief per member for the closed usage lookup (§6.4). Never throws.

import { realpath } from 'node:fs/promises';

import { LIMITS, MAP_VERSION } from '../../shared/workspace-map/limits.mjs';
import { KIND_LABELS, checkSurvey, storedCheckError } from '../../shared/workspace-map/schema.mjs';
import { cutQuery, envStems, hostAlias, hostName, httpTerm, normBody, normKey, normPath, pathSuffixMatch } from '../../shared/workspace-map/keys.mjs';
import { entryId } from '../../shared/workspace-map/ids.mjs';
import { redactSecrets } from '../../shared/workspace-map/redact.mjs';
import { mapWithCap } from '../fanout.mjs';
import { blankGraphql, sdlFields } from './detectors/api-graphql.mjs';
import { isTestPath, listMemberFiles, readText } from './files.mjs';
import { createFileCache, verifyFact } from './verify.mjs';
import { extractLiterals } from './lexer.mjs';
import { aliasTier, GUESS_SOURCES } from './alias-tiers.mjs';

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const msg = (err) => redactSecrets(String((err && err.message) || err || 'unknown error')).slice(0, 300);
const SOURCE_ORDER = Object.freeze(['static', 'survey', 'usage', 'candidate']);
const SKIP_SCAN_RE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|packages\.lock\.json|gradle\.lockfile)$|\.(min\.[a-z]+|map|svg|lock)$/i;
/** Files the `normal` guardrail preset protects (basename, any depth: `.env*`, `*.pem`, `*.key`,
 *  `id_rsa`, `id_ed25519`, `*.p12`, `*.pfx`): an agent under it cannot Read them, so a candidate
 *  there could never be confirmed. (P3's config-env still reads `.env*` statically.) Kept equal to
 *  src/core/guardrails.mjs by a parity test; this module never imports it (C14). */
const PROTECTED_RE = /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|pfx)|id_rsa|id_ed25519)$/i;
/** X6: a host names a member through its first DNS label only when it is internal-shaped — one
 *  label (`billing`), or a name under an internal suffix (`billing.internal`,
 *  `billing.default.svc.cluster.local`). A public dotted host (`api.stripe.com`) names a member
 *  only through an alias equal to the whole host. */
const INTERNAL_SUFFIXES = Object.freeze(['.internal', '.local', '.localhost', '.lan', '.svc', '.cluster.local', '.consul', '.docker', '.home.arpa']);
const internalHost = (host) => !host.includes('.') || INTERNAL_SUFFIXES.some((s) => host.endsWith(s));
/** true for a public dotted host that no alias names in full (`api.stripe.com`) — never a config key or a
 *  property path a target may be (`invoices.url`, `this.baseUrl`, `process.env.BILLING_URL`): written
 *  without a scheme, a DNS name holds no upper-case letter or `_` and does not end in a URL-ish token. */
const publicHost = (value, aliasIndex) => {
  const h = hostName(value);
  if (!h || internalHost(h) || aliasIndex[h]) return false;
  return value.includes('://') || (!/[A-Z_]/.test(value.split(/[/?#]/)[0]) && !envStems(value).length);
};

/** The aliasIndex key a host-shaped value names (X6), or null. */
function hostKey(value, aliasIndex) {
  const host = hostName(value);
  if (!host) return null;
  if (aliasIndex[host]) return host;
  if (!internalHost(host)) return null;
  const a = hostAlias(value);
  return a && aliasIndex[a] ? a : null;
}

/** true when the candidate scan never reads `rel`: test code, lockfiles and minified / map / svg
 *  files (C11), and every file the `normal` guardrail preset protects. */
export function isScanSkipped(rel) {
  return typeof rel !== 'string' || !rel || isTestPath(rel) || SKIP_SCAN_RE.test(rel) || PROTECTED_RE.test(rel);
}
const BUILD_FILE_RE = /(^|\/)(pom\.xml|[^/]*\.gradle(\.kts)?)$/;
const SQL_RE = /\b(select|insert\s+into|update|delete\s+from|from|join|into|create\s+table|alter\s+table)\b/i;
const ORM_RE = /(@Table\s*\(|@Entity\s*\(|__tablename__|db_table|tableName|\.table\s*\(|TableName\s*\(|@@map\s*\()/;
/** X16: a `<name>/…` literal names package <name> only on an import-shaped line — JS/TS
 *  `import … from '…'`, `export … from '…'`, `import '…'`, `import('…')`, `require('…')`; Python
 *  `import …` / `from … import …`; Go `import "…"` / `import x "…"` and every line of a Go
 *  `import ( … )` block. Anywhere else (`[Route("api/[controller]")]`, a URL, a file path) a
 *  package term matches only a literal EQUAL to the package name (and, in a build file, a Maven
 *  `group:artifact[:version]` coordinate) — and that exact match is `via: 'import'` only on an
 *  import-shaped line, else `'literal'`. Bounded runs only, no two adjacent runs overlapping: a
 *  minified line can be a MiB long. */
const IMPORT_LINE_RE = /^\s{0,64}(?:from\s{1,16}[\w.]{1,256}\s{1,16})?import\s|(?:\bfrom|\brequire\s{0,16}\(|\bimport\(?)\s{0,16}['"`]/;
const GO_IMPORT_BLOCK_RE = /^\s{0,64}import\s{0,16}\([^)]*$/;

/** Per file: whether line n (1-based) is import-shaped (X16). Lazy and memoised — only a literal
 *  whose `<name>/` prefix is a package term ever asks. */
function importLineTest(rel, lines) {
  let block = null;
  const memo = new Map();
  return (n) => {
    if (!memo.has(n)) {
      if (block === null) {
        block = new Set();
        if (/\.go$/i.test(rel)) {
          let open = false;
          lines.forEach((l, i) => {
            if (open) {
              if (/^\s*\)/.test(l)) open = false;
              else block.add(i + 1);
            } else if (GO_IMPORT_BLOCK_RE.test(l)) open = true;
          });
        }
      }
      memo.set(n, block.has(n) || IMPORT_LINE_RE.test(lines[n - 1] || ''));
    }
    return memo.get(n);
  };
}
const TERMS_PER_MEMBER_IN_BRIEF = 8;
/** Kinds whose host names the provider (C28); a topic's or a db's host is a broker. */
const HOST_ADDRESSED = Object.freeze(['http', 'grpc', 'graphql', 'service']);
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object';
/** One brief line per value (C30): a repo- or agent-written string (a survey role, a file or directory
 *  name, a parser message) never adds a line to a usage or synthesis brief. */
export const one = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[\r\n\v\f\x85\p{Zl}\p{Zp}]+/gu, ' ');

/** The member-relative brief path `usage-brief.md` lists for a member (pipeline-dir relative). */
export function usageBriefPath(key) {
  return `usage-briefs/${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}

/** Display text of a fact or entry: the key as written (package name without its ecosystem). */
export function displayOf(kind, key, label = null) {
  if (kind === 'other' && typeof label === 'string' && label.trim()) return label.trim().slice(0, 120);
  let d = String(key ?? '').replace(/\s+/g, ' ').trim();
  if (kind === 'pkg') d = d.slice(d.indexOf(':') + 1);
  return d.slice(0, 120);
}

/** Search terms of a provided entry (spec §6.3 step 4). */
export function termsOf(kind, norm) {
  const body = normBody(norm);
  switch (kind) {
    case 'pkg': return [body.slice(body.indexOf(':') + 1)].filter(Boolean);
    case 'http': {
      const t = httpTerm(body.slice(body.indexOf(' ') + 1));
      return t ? [t] : [];
    }
    case 'topic': return body.length >= 3 && !/[*#>]/.test(body) ? [body] : [];
    case 'service': return body ? [body] : [];
    case 'grpc': {
      const svc = body.split('/')[0];
      const short = svc.split('.').pop();
      return [...new Set([svc, short])].filter((t) => t.length >= 3);
    }
    case 'db': {
      if (!norm.startsWith('table:')) return [];
      const last = body.split('.').pop();
      return [...new Set([body, last])].filter((t) => t.length >= 4);
    }
    default: return [];
  }
}

function emptyCatalog(name) {
  return { version: MAP_VERSION, workspace: { name: String(name ?? '') }, members: {}, entries: [],
    aliasIndex: Object.create(null), ambiguousAliases: {}, consumes: {}, candidates: {}, rejected: [], briefs: {}, errors: [] };
}

function extractMembers(extract) {
  const ms = extract && typeof extract === 'object' && extract.members && typeof extract.members === 'object' ? extract.members : {};
  return Object.values(ms)
    .filter((m) => m && typeof m.key === 'string' && m.key && typeof m.dir === 'string' && m.dir)
    .sort((a, b) => byStr(a.key, b.key));
}

const evidenceOf = (f) => ({ file: f.file, line: f.line, match: f.match });
/** What a rejected LLM fact keeps: never its match, detail or target (they may hold a secret the
 *  verifier never saw on a real line). */
const rejectedFact = (f) => ({ kind: f.kind, key: (f.kind === 'http' ? cutQuery(redactSecrets(String(f.key ?? ''))) : redactSecrets(String(f.key ?? ''))).slice(0, 200), file: redactSecrets(String(f.file ?? '')).slice(0, 300), line: f.line });

/** Spec §6.3 step 2: one fact per (dir, norm), non-test static evidence first, ≤ 3 evidence. A
 *  third-party call (`external`, X2) never merges with an internal call of the same norm, and calls of
 *  one norm whose hosts name two different members (`named`, C28) stay two facts. */
function dedupe(facts, limits) {
  const groups = new Map();
  for (const f of facts) {
    const k = `${f.dir}|${f.norm}|${f.external ? 'external' : ''}|${f.named || ''}|${f.guess || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const rank = (f) => (f.test ? 2 : 0) + (f.source === 'static' ? 0 : 1);
  // Input order never picks the representative (the survey's order is the agent's): rank, then place.
  const str = (v) => (typeof v === 'string' ? v : '');
  const order = (a, b) => rank(a) - rank(b) || byStr(a.file, b.file) || a.line - b.line || byStr(String(a.key), String(b.key)) || byStr(String(a.match), String(b.match))
    || byStr(str(a.detail), str(b.detail)) || byStr(str(a.target), str(b.target)) || byStr(str(a.label), str(b.label));
  return [...groups.values()].map((list) => {
    const sorted = [...list].sort(order);
    const p = sorted[0];
    const seen = new Set();
    const evidence = [];
    for (const f of sorted) {
      const id = `${f.file}:${f.line}`;
      if (seen.has(id) || evidence.length >= limits.EVIDENCE_PER_SIDE) continue;
      seen.add(id);
      evidence.push(evidenceOf(f));
    }
    return {
      ...p,
      detail: p.detail ?? sorted.find((f) => f.detail)?.detail ?? null,
      target: p.target ?? sorted.find((f) => f.target)?.target ?? null,
      // One exact static observation makes the merged fact exact (join caps an edge at its fact's
      // confidence).
      confidence: sorted.some((f) => f.source === 'static' && !f.test && f.confidence === 'exact') ? 'exact' : p.confidence ?? null,
      sources: SOURCE_ORDER.filter((s) => sorted.some((f) => f.source === s)),
      test: sorted.every((f) => f.test),
      evidence,
    };
  }).sort((a, b) => byStr(a.dir, b.dir) || byStr(a.kind, b.kind) || byStr(a.norm, b.norm) || byStr(a.external ? 'x' : '', b.external ? 'x' : '')
    || byStr(a.named || '', b.named || '') || byStr(a.guess || '', b.guess || '') || byStr(a.file, b.file) || a.line - b.line);
}

function containsRun(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const looksHost = (v) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v) || /^[\w-]+:\d+(\/\S*)?$/.test(v);

/** The routes `pathSuffixMatch(path, route)` can accept, from an index of `items` built once: each route
 *  segment keyed by (route length L, distance from the END d, segment), `{}` a key of its own. A route of
 *  length L ≤ the path's matches only if, at every distance d < L where the path holds a static segment,
 *  its own is that segment or `{}` — so the routes under ONE such (L, d) are a complete answer, and the
 *  smallest of the first 8 is taken. Shared prefixes (`/api/v1/…` on every route) never widen it.
 *  → near(path) → items (each at most once) */
export function routeIndex(items, pathOf) {
  const at = new Map();
  const lengths = new Set();
  for (const it of items) {
    const segs = String(pathOf(it) ?? '').split('/').filter(Boolean);
    if (!segs.length) continue;
    lengths.add(segs.length);
    segs.forEach((s, j) => { const k = `${segs.length}|${segs.length - 1 - j}|${s}`; if (!at.has(k)) at.set(k, []); at.get(k).push(it); });
  }
  const lens = [...lengths].sort((a, b) => a - b);
  return (path) => {
    const c = String(path ?? '').split('/').filter(Boolean);
    const out = [];
    for (const L of lens) {
      if (L > c.length) break;
      let best = null;
      for (let d = 0, tried = 0; d < L && tried < 8; d += 1) {
        const s = c[c.length - 1 - d];
        if (s === '{}') continue;
        tried += 1;
        const same = at.get(`${L}|${d}|${s}`) || [];
        const any = at.get(`${L}|${d}|{}`) || [];
        if (!best || same.length + any.length < best[0].length + best[1].length) best = [same, any];
      }
      if (best) for (const list of best) for (const x of list) out.push(x);
    }
    return out;
  };
}

/** Term lookup structures over the OTHER members' entries (minus those already resolved). HTTP
 *  entries are indexed twice so a literal is compared only with the few that could match: by
 *  `routeIndex` (pathSuffixMatch aligns ends), and each term's last segment (containsRun). */
function buildIndex(entries) {
  const idx = { exact: new Map(), maven: new Map(), service: new Map(), table: new Map(), http: [], httpNear: null, httpTerm: new Map(), size: 0 };
  const put = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const add = (map, term, e) => { put(map, term, e); idx.size += 1; };
  for (const e of entries) {
    for (const t of e.terms) {
      if (e.kind === 'pkg' && e.norm.startsWith('pkg:maven:')) add(idx.maven, t, e);
      else if (e.kind === 'pkg' || e.kind === 'topic' || e.kind === 'grpc') add(idx.exact, t, e);
      else if (e.kind === 'service') add(idx.service, t, e);
      else if (e.kind === 'db') add(idx.table, t.toLowerCase(), e);
      else if (e.kind === 'http') {
        const body = normBody(e.norm);
        const path = body.slice(body.indexOf(' ') + 1);
        const h = { e, path, term: t.split('/').filter(Boolean), i: idx.http.length };
        idx.http.push(h);
        idx.size += 1;
        if (h.term.length) put(idx.httpTerm, h.term[h.term.length - 1], h);
      }
    }
  }
  idx.httpNear = routeIndex(idx.http, (h) => h.path);
  return idx;
}

/** Every (entry, via) one literal hits. `isImportLine(n)` → whether line n is import-shaped (X16). */
function matchLiteral(lit, idx, rel, lineText, isImportLine) {
  const v = lit.value;
  const hits = [];
  for (const e of idx.exact.get(v) || []) hits.push({ e, via: e.kind === 'pkg' && isImportLine(lit.line) ? 'import' : 'literal' });
  if (v.includes('/') && !v.includes(' ')) {
    // `@acme/billing/client` → `@acme/billing`, `api/sub` → `api` — only where the line imports it (X16).
    const pre = [];
    for (let i = v.indexOf('/'); i > 0; i = v.indexOf('/', i + 1)) {
      for (const e of idx.exact.get(v.slice(0, i)) || []) if (e.kind === 'pkg') pre.push(e);
    }
    if (pre.length && isImportLine(lit.line)) for (const e of pre) hits.push({ e, via: 'import' });
  }
  if (idx.maven.size && BUILD_FILE_RE.test(rel)) {
    const ga = v.split(':').slice(0, 2).join(':');
    for (const e of idx.maven.get(ga) || []) hits.push({ e, via: 'import' });
  }
  if (idx.http.length && v.includes('/')) {
    const p = normPath(v);
    if (p && p !== '/') {
      const segs = p.split('/').filter(Boolean);
      // Only the routes pathSuffixMatch can accept (routeIndex) and those a term's last segment names:
      // a placeholder-only literal ('%s/%s') is never one. C28: a literal whose internal host names a
      // member is a path candidate only for that member's routes — none when it names the scanned member.
      const near = new Set(idx.httpNear(p));
      for (const s of segs) if (s !== '{}') for (const h of idx.httpTerm.get(s) || []) near.add(h);
      const hk = looksHost(v) ? hostKey(v, idx.aliasIndex) : null;
      const to = hk ? idx.aliasIndex[hk] : null;
      for (const h of [...near].sort((a, b) => a.i - b.i)) {
        if (to && h.e.member !== to) continue;
        if (pathSuffixMatch(p, h.path) || (h.term.length && containsRun(segs, h.term))) hits.push({ e: h.e, via: 'path' });
      }
    }
  }
  if (idx.service.size && looksHost(v)) {
    // X6 / C17: an internal-shaped host names a service by its first label; a public dotted host only
    // through an alias equal to the whole host, and then only that member's services.
    const host = hostName(v);
    const named = host && !internalHost(host) ? idx.aliasIndex[host] ?? null : null;
    const a = host && (internalHost(host) || named) ? hostAlias(v) : null;
    for (const e of (a && idx.service.get(a)) || []) if (!named || e.member === named) hits.push({ e, via: 'host' });
  }
  if (idx.table.size) {
    if (SQL_RE.test(v)) {
      for (const tok of new Set(v.toLowerCase().match(/[\w.$]+/g) || [])) for (const e of idx.table.get(tok) || []) hits.push({ e, via: 'sql' });
    } else if (ORM_RE.test(lineText)) {
      for (const e of idx.table.get(v.toLowerCase()) || []) hits.push({ e, via: 'sql' });
    }
  }
  return hits;
}

async function scanMember(m, entries, resolved, limits, aliasIndex) {
  // Never another member's entry for a norm this member provides itself (its own `name = "core"`
  // is about itself, not about another member's `core`).
  const own = new Set(entries.filter((e) => e.member === m.key).map((e) => e.norm));
  const others = entries.filter((e) => e.member !== m.key && e.terms.length && !resolved.has(e.id) && !own.has(e.norm));
  const idx = buildIndex(others);
  idx.aliasIndex = aliasIndex;
  if (!idx.size) return { list: [], truncated: false };
  const deadline = Date.now() + limits.MEMBER_BUDGET_MS;
  const listing = await listMemberFiles(m.dir, { maxFiles: limits.MAX_FILES_PER_MEMBER });
  // The member's real root, resolved once: readText's containment check needs it for every file.
  const realRoot = await realpath(m.dir).catch(() => null);
  const list = [];
  const perEntry = new Map();
  const seen = new Set();
  let truncated = listing.truncated;
  for (const rel of listing.files) {
    if (isScanSkipped(rel)) continue;
    if (list.length >= limits.MAX_CANDIDATES_PER_MEMBER || Date.now() > deadline) { truncated = true; break; }
    const text = await readText(m.dir, rel, { maxBytes: limits.MAX_FILE_BYTES, realRoot });
    if (text === null) continue;
    const lits = extractLiterals(text);
    if (!lits.length) continue;
    const lines = text.split(/\r?\n/);
    const isImportLine = importLineTest(rel, lines);
    for (const lit of lits) {
      for (const { e, via } of matchLiteral(lit, idx, rel, lines[lit.line - 1] || '', isImportLine)) {
        const id = `${e.id}|${rel}|${lit.line}`;
        if (seen.has(id)) continue;
        const n = perEntry.get(e.id) || 0;
        if (n >= limits.MAX_CANDIDATES_PER_ENTRY) continue;
        if (list.length >= limits.MAX_CANDIDATES_PER_MEMBER) { truncated = true; break; }
        seen.add(id);
        perEntry.set(e.id, n + 1);
        // A cut inside a kept URL ('…&redirect_auth=http') redacts unlike the whole line: shorten it until it
        // is its own redaction, so the usage agent's citation of it verifies (C2).
        let match = lit.raw.slice(0, limits.MATCH_MAX);
        // A query parameter of any name may carry a credential and no match needs one: cut before the query and a '#'
        // fragment (keys.mjs cutQuery) — never inside a placeholder, never before Ruby's '#{' interpolation.
        match = cutQuery(match);
        while (match.length < lit.raw.length && match.length > 1 && redactSecrets(match) !== match) match = match.slice(0, -1);
        list.push({ entry: e.id, file: rel, line: lit.line, match, via });
      }
    }
  }
  return { list, truncated };
}

/** spec §6.3 steps 1–6. survey may be null/garbage (→ treated as empty, gap members
 *  surveyStatus 'failed'). Verifies survey facts with verifyFact (member dir from extract).
 *  Never throws. */
export async function buildCatalog({ extract, survey, limits = LIMITS } = {}) {
  const out = emptyCatalog(extract?.workspace?.name);
  try {
    const members = extractMembers(extract);
    if (!members.length) { out.errors.push('extract: no members'); return out; }
    const keys = members.map((m) => m.key);
    const surveyDoc = survey && typeof survey === 'object' ? survey : null;
    if (!surveyDoc) out.errors.push('survey: missing or not a JSON object');
    const checked = checkSurvey(surveyDoc, { memberKeys: keys });
    // A member key is data: `constructor` or `toString` never reads Object.prototype.
    const surveyOf = (k) => (Object.hasOwn(checked.value.members, k) ? checked.value.members[k] : null);
    if (surveyDoc) {
      for (const e of checked.errors) {
        const m = /^members\.([^.[:]+)/.exec(e);
        // Persisted: the path's member key redacted, the echoed agent value dropped (D21).
        out.rejected.push({ member: m ? redactSecrets(m[1]).slice(0, 100) : null, source: 'survey', reason: storedCheckError(e), fact: null });
      }
    }
    const cache = createFileCache();
    const observed = new Map();
    const counts = new Map();
    for (const m of members) {
      const statics = [...(Array.isArray(m.provides) ? m.provides : []), ...(Array.isArray(m.consumes) ? m.consumes : [])]
        .filter((f) => f && typeof f.norm === 'string' && typeof f.file === 'string');
      const llm = [];
      const sv = surveyOf(m.key);
      // M9: a GraphQL schema file extract judged a client's copy of its server's schema is neither this member's
      // API nor its operations: a survey fact citing it would give every root field a second owner again. Paths
      // compare case-folded: a macOS or Windows checkout verifies the file in any letter case.
      const copies = new Set((Array.isArray(m.unresolved) ? m.unresolved : [])
        .filter((u) => u && u.kind === 'graphql' && u.reason === 'client copy of a GraphQL schema' && typeof u.file === 'string')
        .map((u) => u.file.toLowerCase()));
      for (const dir of ['provides', 'consumes']) {
        for (const f of sv ? sv[dir] : []) {
          const v = await verifyFact(m.dir, f, { cache });
          if (!v.ok) { out.rejected.push({ member: m.key, source: 'survey', reason: v.reason, fact: rejectedFact(f) }); continue; }
          const x = v.fact;
          // An agent may key an HTTP call by the full URL it read: neither its key nor its citation keeps the query (D21).
          if (x.kind === 'http') { x.key = cutQuery(x.key); x.match = cutQuery(x.match); }
          const norm = normKey(x.kind, x.key);
          if (!norm) { out.rejected.push({ member: m.key, source: 'survey', reason: 'unkeyable', fact: rejectedFact(x) }); continue; }
          if (x.kind === 'graphql' && copies.has(x.file.toLowerCase())) { out.rejected.push({ member: m.key, source: 'survey', reason: 'client copy of a GraphQL schema', fact: rejectedFact(x) }); continue; }
          llm.push({ kind: x.kind, dir, key: x.key, norm, file: x.file, line: x.line, match: x.match,
            detail: x.detail ?? null, label: x.kind === 'other' ? x.label ?? null : null,
            target: dir === 'consumes' ? x.target ?? null : null,
            source: 'survey', detector: null, confidence: null, test: isTestPath(x.file) });
        }
      }
      counts.set(m.key, { static: statics.length, llm: llm.length });
      observed.set(m.key, [...statics, ...llm]);
    }
    // Step 3: aliases, each claim with its tier (alias-tiers.mjs): a member's key and name are identity claims
    // (0), a detector alias takes its source's tier, a survey alias is the weakest (3) and counts only for a
    // member whose needs list aliases. The claimants of an alias's strongest tier own it: one → aliasIndex,
    // two or more → ambiguousAliases (unused). A guess (`GUESS_SOURCES`: a member's own default name for a workload or
    // a stub, an npm scope tail, a survey alias) never settles a collision with a manifest-tier name either way: the two
    // tie, as at 15486564, so neither a client library's package name nor the guess takes a host the service answers to.
    // A member's own deploy name by default (`deploy-self`: a monorepo's per-service build or a workload whose image does
    // not name it) ties with another member's deploy name too, as at 15486564: a peer's `api: build: .` never takes the
    // host a monorepo's own `api` answers to, so the monorepo's calls to it stay its own.
    const claims = new Map();
    const guessed = new Map(); // alias → the members that claim it by a guess
    const selfGuessed = new Map(); // alias → the members that claim it by a `deploy-self` guess
    const MANIFEST_TIER = aliasTier('package.json');
    const DEPLOY_TIER = aliasTier('compose');
    const claim = (alias, key, tier, source = null) => {
      const a = typeof alias === 'string' ? alias.trim().toLowerCase() : '';
      if (!a || a.length > 100 || /\s/.test(a) || a === '__proto__') return;
      if (!claims.has(a)) claims.set(a, new Map());
      const byKey = claims.get(a);
      if (!byKey.has(key) || tier < byKey.get(key)) byKey.set(key, tier);
      if (GUESS_SOURCES.includes(source)) { if (!guessed.has(a)) guessed.set(a, new Set()); guessed.get(a).add(key); }
      if (source === 'deploy-self') { if (!selfGuessed.has(a)) selfGuessed.set(a, new Set()); selfGuessed.get(a).add(key); }
    };
    for (const m of members) {
      claim(m.key, m.key, 0);
      claim(m.name, m.key, 0);
      for (const a of Array.isArray(m.aliases) ? m.aliases : []) {
        claim(a?.value, m.key, aliasTier(a?.source), a?.source);
        // …and the member's own deploy guess of that value, which extract's one-source-per-value dedupe folded into it
        if (a?.selfGuess === true) claim(a.value, m.key, aliasTier('deploy-self'), 'deploy-self');
      }
      if (Array.isArray(m.needs) && m.needs.includes('aliases')) for (const a of surveyOf(m.key)?.aliases || []) claim(redactSecrets(a), m.key, aliasTier('survey'), 'survey');
    }
    const aliasesOf = new Map(keys.map((k) => [k, []]));
    for (const [a, byKey] of [...claims.entries()].sort((x, y) => byStr(x[0], y[0]))) {
      const top = Math.min(...byKey.values());
      const owners = [...byKey].filter(([k, t]) => t === top || (top === MANIFEST_TIER && guessed.get(a)?.has(k)) || (top === DEPLOY_TIER && selfGuessed.get(a)?.has(k))).map(([k]) => k).sort(byStr);
      for (const k of owners) aliasesOf.get(k).push(a);
      if (owners.length === 1) out.aliasIndex[a] = owners[0];
      else out.ambiguousAliases[a] = owners;
    }
    // Step 2, after the aliases (X2 and C28 read them): one fact per (dir, norm, external, named).
    // A target may be a host[:port], a member key, a repo slug, an env / config key or a variable
    // name (P3/P4): tried as an alias, then as a config key (envStems), then as a host (X6).
    /** A consume's host-shaped hints, strongest first: its target, the URL in an http key, a service key. */
    const hintValues = (c) => {
      const vals = [];
      if (c.target) vals.push(c.target);
      if (c.kind === 'http') { const u = /[a-z][a-z0-9+.-]{0,31}:\/\/\S+/i.exec(c.key); if (u) vals.push(u[0]); }
      if (c.kind === 'service') vals.push(c.key);
      return vals.map((v) => String(v).trim());
    };
    const hintOf = (c, self = null) => {
      for (const s of hintValues(c)) {
        const direct = s.toLowerCase();
        if (out.aliasIndex[direct]) return direct;
        // `BILLING_API_URL`, `services.billing.url`, `Billing:Url`: a config key naming the service. A stem
        // naming the consumer itself (`ADMIN_API_URL` in admin: the API it calls) is never read as its own host.
        for (const stem of envStems(s)) if (out.aliasIndex[stem] && out.aliasIndex[stem] !== self) return stem;
        // A hint that names nobody never hides the next one (a target such as BASE_URL must not
        // hide the host in the key).
        const h = hostKey(s, out.aliasIndex);
        if (h) return h;
      }
      return null;
    };
    // X2 (C25): a consume, static or survey, whose own hints name no member but a public dotted host
    // (C17: `api.github.com`) is a third-party call. It is decided per observation, BEFORE the merge: a
    // merged fact takes the first target it finds, so the GitHub call would lend its host to an internal
    // call of the same path and take that call's edge away. The same call re-reported without its host
    // (same norm, file and line: a survey key `GET /users/{name}`) is third-party too.
    const merged = new Map();
    for (const m of members) {
      const facts = observed.get(m.key);
      const at = (f) => `${f.norm}|${f.file}:${f.line}`;
      // A topic's or a db's host is a broker (C28), never a third party: only host-addressed calls are external.
      const hinted = (f) => (f.dir === 'consumes' && HOST_ADDRESSED.includes(f.kind) ? hintOf(f, m.key) : null);
      // C28 takes the member a host names only from an observation that did not guess it: a `heuristic` fact's
      // target (a same-file variable, a config key with no usable host) only breaks ties, in step 5.
      const namedOf = (f) => { const h = f.confidence !== 'heuristic' ? hinted(f) : null; return h ? out.aliasIndex[h] : ''; };
      const thirdParty = new Set(facts.filter((f) => f.dir === 'consumes' && HOST_ADDRESSED.includes(f.kind) && !hinted(f)
        && hintValues(f).some((v) => publicHost(v, out.aliasIndex))).map(at));
      // C28: calls of one norm to two members' hosts stay two consumes (a gateway's `POST /graphql` to billing
      // and to orders, a BFF's `GET /health` to every service); a host-less re-report of a line (same norm,
      // file and line) goes with that line's host — with none when the line names two.
      const namedAt = new Map();
      for (const f of facts) { const n = namedOf(f); if (n) namedAt.set(at(f), namedAt.has(at(f)) && namedAt.get(at(f)) !== n ? '' : n); }
      // …and a guessed host (a heuristic observation's) keeps its calls apart too: it never lends its guess to an
      // exact host-less call of the same norm (C8), and two guessed upstreams stay two consumes.
      const guessOf = (f) => { const h = f.confidence === 'heuristic' ? hinted(f) : null; return h ? out.aliasIndex[h] : ''; };
      // A host-less re-report of a guessed line (the survey's key without a host) is that same call: it keeps the guess.
      const guessAt = new Map();
      for (const f of facts) { const n = guessOf(f); if (n) guessAt.set(at(f), guessAt.has(at(f)) && guessAt.get(at(f)) !== n ? '' : n); }
      merged.set(m.key, dedupe(facts.map((f) => {
        if (f.dir !== 'consumes') return f;
        const named = namedOf(f) || namedAt.get(at(f)) || '';
        const g = { ...f, named, guess: named ? '' : guessOf(f) || (hinted(f) ? '' : guessAt.get(at(f)) || '') };
        return thirdParty.has(at(f)) && !hinted(f) ? { ...g, external: true } : g;
      }), limits));
    }
    // Step 4: entries (provides only, non-test).
    for (const m of members) {
      for (const f of merged.get(m.key).filter((x) => x.dir === 'provides' && !x.test)) {
        out.entries.push({ id: entryId(m.key, f.kind, f.norm), member: m.key, kind: f.kind, norm: f.norm,
          display: displayOf(f.kind, f.key, f.label), terms: termsOf(f.kind, f.norm), evidence: f.evidence, sources: f.sources,
          confidence: f.confidence ?? null });
      }
    }
    out.entries.sort((a, b) => byStr(a.member, b.member) || byStr(a.kind, b.kind) || byStr(a.norm, b.norm));
    const byNorm = new Map();
    for (const e of out.entries) {
      if (!byNorm.has(e.norm)) byNorm.set(e.norm, []);
      byNorm.get(e.norm).push(e);
    }
    // Step 5: resolve consumes by exact norm (one other member) and by host / alias.
    // A consume of a norm the member itself provides is internal: it never resolves to another member —
    // unless its host names that other member (C28).
    const ownNorms = new Map(members.map((m) => [m.key, new Set(out.entries.filter((e) => e.member === m.key).map((e) => e.norm))]));
    // M9: a client copy that describes a schema no other member serves (fewer than half of its root fields: an outside
    // API's — GitHub, Shopify, a SaaS) still keeps the member's own operations on its fields internal, as its provides
    // did at 15486564: they never join a member that happens to serve `Query.node` or `Query.viewer` too.
    const outsideCopy = new Map();
    for (const m of members) {
      const norms = new Set();
      for (const u of Array.isArray(m.unresolved) ? m.unresolved : []) {
        if (!u || u.kind !== 'graphql' || u.reason !== 'client copy of a GraphQL schema' || typeof u.file !== 'string') continue;
        const text = await readText(m.dir, u.file, { maxBytes: limits.MAX_FILE_BYTES }).catch(() => null);
        if (typeof text !== 'string') continue;
        let keys = [];
        try { keys = [...new Set(sdlFields(blankGraphql(text)).map((x) => normKey('graphql', x.key)).filter(Boolean))]; } catch { continue; }
        const served = keys.filter((n) => (byNorm.get(n) || []).some((e) => e.member !== m.key)).length;
        if (served * 2 < keys.length) for (const n of keys) norms.add(n);
      }
      outsideCopy.set(m.key, norms);
    }
    for (const m of members) {
      out.consumes[m.key] = merged.get(m.key).filter((x) => x.dir === 'consumes').map(({ named: hostNamed, guess, ...c }) => {
        // X2: a third-party call (step 2) never joins a member that happens to serve the same path — here,
        // nor by join's fuzzy rule (b). It stays for the candidate scan and the usage pass.
        if (c.external) return { ...c, entry: null, toMember: null };
        // C28: the host of an http / grpc / graphql / service call names its provider — a norm another member
        // serves never overrides it, and a call to the member's own host joins nobody (`self`). The member is
        // the one step 2 decided per observation: the merged fact may carry another observation's key and
        // target. A topic or db host is a broker, not the publisher: those still resolve by norm first.
        const strict = HOST_ADDRESSED.includes(c.kind) && !!hostNamed;
        // Anything else (a topic or db broker, a guessed target, no host at all) uses its hint to break ties only.
        const hint = strict ? null : hintOf(c, m.key);
        const named = strict ? hostNamed : hint ? out.aliasIndex[hint] : null;
        if (strict && named === m.key) return { ...c, entry: null, toMember: null, self: true };
        // an http path with no literal segment (`GET /`, `GET /{}`) names no route: only a host naming a member joins it —
        // an outside host (`http://legacy-crm:8080/` + id) or a Feign service id never lands it on whichever member serves `GET /{}`
        const httpPath = /^http:\S+ (\S+)$/.exec(c.norm)?.[1];
        if (!strict && httpPath && !httpPath.split('/').some((s) => s && s !== '{}')) return { ...c, entry: null, toMember: null };
        // C22, after C28: a host naming ANOTHER member names the provider even for a norm this member serves
        // itself (a gateway that serves /graphql forwards it to billing's /graphql).
        if (ownNorms.get(m.key).has(c.norm) && !strict) return { ...c, entry: null, toMember: null };
        if (c.kind === 'graphql' && !strict && outsideCopy.get(m.key).has(c.norm)) return { ...c, entry: null, toMember: null };
        // X6: a service keyed from a public dotted host (`api.stripe.com` → service:api) never meets a
        // provider through that first-label norm.
        const hits = c.kind === 'service' && publicHost(c.key, out.aliasIndex) ? [] : (byNorm.get(c.norm) || []).filter((e) => e.member !== m.key);
        const owners = [...new Set(hits.map((e) => e.member))];
        const viaAlias = named && named !== m.key ? named : null;
        let entry = null;
        let toMember = null;
        if (strict) { entry = hits.find((e) => e.member === viaAlias)?.id ?? null; toMember = viaAlias; }
        else if (owners.length === 1) { entry = hits[0].id; toMember = owners[0]; }
        else if (owners.length > 1 && viaAlias && owners.includes(viaAlias)) { entry = hits.find((e) => e.member === viaAlias).id; toMember = viaAlias; }
        else if (viaAlias) toMember = viaAlias;
        // `hostNamed`: join's rule (b) lands this call only in the member its host names (C28).
        return strict ? { ...c, entry, toMember, hostNamed: true } : { ...c, entry, toMember };
      });
    }
    // Step 6: the candidate scan (bounded pool, per-member budget and caps).
    const scans = await mapWithCap(members, limits.EXTRACT_POOL, (m) => {
      const resolved = new Set(out.consumes[m.key].filter((c) => c.entry && !c.test).map((c) => c.entry));
      return scanMember(m, out.entries, resolved, limits, out.aliasIndex).catch((err) => ({ list: [], truncated: true, error: msg(err) }));
    });
    members.forEach((m, i) => {
      out.candidates[m.key] = scans[i].list;
      if (scans[i].error) out.errors.push(`candidates ${m.key}: ${scans[i].error}`);
      const sv = surveyOf(m.key);
      const needs = Array.isArray(m.needs) ? m.needs : [];
      out.members[m.key] = {
        key: m.key, name: typeof m.name === 'string' ? m.name : m.key, dir: m.dir,
        role: m.role || (sv?.role ? redactSecrets(sv.role) : null),
        roleSource: m.role ? 'static' : sv?.role ? 'survey' : null,
        // M1: the file a static role was copied from (extract's roleSource: 'readme' | 'manifest' | null).
        roleFrom: m.roleSource ?? null,
        aliases: aliasesOf.get(m.key),
        stack: Array.isArray(m.stack) ? m.stack : [],
        coverage: m.coverage && typeof m.coverage === 'object' ? m.coverage : { level: 'none', files: 0, scannedFiles: 0, truncated: false, detectors: {} },
        graph: m.graph ?? null,
        surveyStatus: sv ? sv.status : needs.length ? 'failed' : 'skipped',
        unresolved: Array.isArray(m.unresolved) ? m.unresolved : [],
        facts: counts.get(m.key),
        candidatesTruncated: scans[i].truncated,
      };
    });
  } catch (err) {
    out.errors.push(`catalog: ${msg(err)}`);
  }
  return out;
}

const utf8Len = (s) => Buffer.byteLength(s, 'utf8');

/** Appends `items` as lines while they fit `room` bytes; a final "(+N more …)" line otherwise. */
function fitLines(items, room, moreText) {
  const out = [];
  let used = 0;
  for (let i = 0; i < items.length; i += 1) {
    const len = utf8Len(items[i]) + 1;
    if (used + len > room - 120) {
      out.push(`- (+${items.length - i} more ${moreText})`);
      return { lines: out, used: used + 120 };
    }
    out.push(items[i]);
    used += len;
  }
  return { lines: out, used };
}

/** spec §6.3 step 7. usage-brief.md FIRST LINES exactly:
 *    # Workspace usage brief
 *    <!-- worca:catalog=<abs catalog.json> -->
 *    <!-- worca:check=<checker command line> -->
 *  then one line per member: `- <key> (<name>): usage-briefs/<key>.md` (paths relative to the
 *  pipeline dir, which is where usage-brief.md lives). Each per-member brief ≤ BRIEF_MAX_BYTES.
 *  → { index: string, files: { [key]: string } } */
export function usageBriefs(catalog, { catalogPath, checkerCmd, limits = LIMITS } = {}) {
  const cat = catalog && typeof catalog === 'object' ? catalog : emptyCatalog('');
  const members = Object.values(cat.members || {}).filter((m) => m && typeof m.key === 'string').sort((a, b) => byStr(a.key, b.key));
  const entries = arr(cat.entries).filter(isObj);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const candTotal = members.reduce((n, m) => n + arr(cat.candidates?.[m.key]).length, 0);
  const index = ['# Workspace usage brief', `<!-- worca:catalog=${catalogPath} -->`, `<!-- worca:check=${checkerCmd} -->`, '',
    `Workspace "${one(cat.workspace?.name)}": ${members.length} member projects, ${entries.length} catalog entries, ${candTotal} candidates. Catalog: \`${catalogPath}\`.`, '',
    '## Member briefs (one investigator per member)', '',
    ...members.map((m) => `- ${one(m.key)} (${one(m.name)}): ${usageBriefPath(m.key)}`), '',
    '## Output rules', '',
    '- Write ONE JSON file: `{ "version": 1, "members": { "<key>": { "status": "investigated|failed", "uses": [Use], "rejected": [Rejection], "other": [Relation] } } }` with every member key above. A member whose investigator could not finish is `"status": "failed"`.',
    '- Use = `{ "entry", "file", "line", "match", "detail"? }`; Rejection = `{ "entry", "file", "line", "reason" }`; Relation = `{ "to", "kind", "key", "label"?, "file", "line", "match", "detail"? }`.',
    '- entry = a catalog entry id exactly as written; to = another member key; file = relative to that member\'s checkout with `/` separators; line = 1-based; match = a literal substring of that line (≤ 200 chars).',
    `- Validate before finishing: \`${checkerCmd}\` — replace <OUT> with the path of your usage.json; fix every reported line and re-run until it prints OK.`,
  ].join('\n') + '\n';
  const files = {};
  for (const m of members) {
    const kindCounts = (key) => {
      const c = new Map();
      for (const e of entries) if (e.member === key) c.set(e.kind, (c.get(e.kind) || 0) + 1);
      return [...c].map(([k, n]) => `${(Object.hasOwn(KIND_LABELS, k) && KIND_LABELS[k]) || k} ${n}`).join(', ') || 'nothing catalogued';
    };
    const head = [`# Usage brief: ${one(m.key)} (${one(m.name)})`, '',
      `Checkout: \`${one(m.dir)}\`. Catalog: \`${catalogPath}\` (look up any entry id in \`entries\`).`, '',
      '## Task', '',
      '1. Confirm or reject every candidate below by reading the cited line in the checkout.',
      '2. Find further uses of the other members\' entries: dynamic URLs, base-URL constants, generated clients, config. Never cite test code (`test/`, `*.test.*`, `spec/`, fixtures): worca drops it.',
      '3. Report relations to named members that the catalog does not list (`other`, with evidence from this checkout). Never cite test code here either.', ''];
    const tail = [`## Output for ${one(m.key)}`, '',
      `\`"${one(m.key)}": { "status": "investigated", "uses": [...], "rejected": [...], "other": [...] }\` — see usage-brief.md for the entry shapes.`];
    const others = members.filter((o) => o.key !== m.key).map((o) => {
      const terms = [...new Set(entries.filter((e) => e.member === o.key).flatMap((e) => e.terms))].slice(0, TERMS_PER_MEMBER_IN_BRIEF);
      return `- ${o.key} (${o.name}): aliases ${arr(o.aliases).join(', ') || '(none)'} · provides ${kindCounts(o.key)}${terms.length ? ` · terms ${terms.map((t) => `\`${t}\``).join(', ')}` : ''}`;
    });
    const cands = arr(cat.candidates?.[m.key]).filter(isObj).map((c) => {
      const e = entryById.get(c.entry);
      return `- \`${c.entry}\` → ${e?.member ?? '?'} ${(Object.hasOwn(KIND_LABELS, e?.kind ?? '') && KIND_LABELS[e.kind]) || e?.kind || '?'} \`${e?.display ?? ''}\` at ${c.file}:${c.line} \`${c.match}\` (${c.via})`;
    });
    const unresolved = arr(m.unresolved).filter(isObj).map((u) => `- ${u.kind} \`${u.raw}\` — ${u.file}:${u.line} (${u.reason})`);
    const done = arr(cat.consumes?.[m.key]).filter((c) => isObj(c) && c.entry && !c.test).map((c) => {
      const e = entryById.get(c.entry);
      return `- \`${c.entry}\` → ${e?.member ?? c.toMember} ${(Object.hasOwn(KIND_LABELS, c.kind ?? '') && KIND_LABELS[c.kind]) || c.kind} \`${e?.display ?? c.key}\` at ${c.file}:${c.line}`;
    });
    let room = limits.BRIEF_MAX_BYTES - utf8Len(head.join('\n')) - utf8Len(tail.join('\n')) - 200;
    const body = [];
    for (const [title, items, more] of [
      [`## Candidates (${cands.length})`, cands, 'candidates in catalog.json → candidates'],
      [`## Other members (${others.length})`, others, 'members in catalog.json → members'],
      [`## Unresolved consumes (${unresolved.length})`, unresolved, 'unresolved items'],
      [`## Already resolved statically (${done.length}, no action)`, done, 'resolved consumes'],
    ]) {
      if (!items.length) continue;
      const titleLen = utf8Len(title) + 2;
      if (room - titleLen < 200) break;
      const fit = fitLines(items.map(one), room - titleLen, more);
      body.push(title, '', ...fit.lines, '');
      room -= titleLen + fit.used;
    }
    files[m.key] = [...head, ...body, ...tail].join('\n') + '\n';
  }
  return { index, files };
}
