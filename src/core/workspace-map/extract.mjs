// src/core/workspace-map/extract.mjs
// Stage 1 (spec §6.1): static boundary facts per member. A bounded pool of members; every
// detector wrapped in try/catch and timed; a per-member soft budget; the origin-remote alias;
// coverage level + needs (spec §5.3) that decide what the survey agent investigates; and the
// graphify graph's presence and freshness. Never throws: a crash yields failedExtract(), where
// every member is 'none' and the survey investigates everything (D2).

import { lstat, open, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { LIMITS, MAP_VERSION } from '../../shared/workspace-map/limits.mjs';
import { DIRS, KINDS, NEEDS } from '../../shared/workspace-map/schema.mjs';
import { normKey, remoteSlug } from '../../shared/workspace-map/keys.mjs';
import { redactLines, redactSecrets } from '../../shared/workspace-map/redact.mjs';
import { mapWithCap } from '../fanout.mjs';
import { gitOutput, isTestPath, listMemberFiles, readText } from './files.mjs';
import { DETECTORS } from './detectors/index.mjs';
import { aliasTier } from './alias-tiers.mjs';

const GRAPH_PARSE_MAX_BYTES = 16 * 1024 * 1024;
const GRAPH_TAIL_BYTES = 65536;
const UNRESOLVED_MAX = 200;
const BRIEF_FACTS_MAX = 20;
const KEY_MAX = 300; // like an LLM fact's key (schema.mjs): a longer static key is unkeyable
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** An error message can quote the text a parser choked on: redacted like every other string. */
const msg = (err) => redactSecrets(String((err && err.message) || err || 'unknown error')).slice(0, 300);
const str = (v, max) => (typeof v === 'string' && v.trim() ? redactSecrets(v.trim()).slice(0, max) : null);
const relOk = (f) => typeof f === 'string' && f.length > 0 && !f.startsWith('/') && !/^[A-Za-z]:/.test(f)
  && !f.includes('\\') && !f.split('/').includes('..');

/** 1-based numbers of the lines strictly inside a multi-line PEM block (the lines redactLines blanks).
 *  Only computed for a file that holds '-----BEGIN'. */
function pemBodyLines(text) {
  const lines = text.split(/\r?\n/);
  const out = new Set();
  redactLines(lines).forEach((l, i) => { if (l === '***' && lines[i] !== '***') out.add(i + 1); });
  return out;
}

function iso(now) {
  try { return now().toISOString(); } catch { return new Date().toISOString(); }
}

function cleanMembers(members) {
  const seen = new Set();
  return (Array.isArray(members) ? members : [])
    .filter((m) => m && typeof m.key === 'string' && m.key && typeof m.dir === 'string' && m.dir && !seen.has(m.key) && seen.add(m.key))
    .map((m) => ({ key: m.key, name: typeof m.name === 'string' && m.name ? m.name : m.key, dir: m.dir,
      projectDir: typeof m.projectDir === 'string' && m.projectDir ? m.projectDir : m.dir }))
    .sort((a, b) => byStr(a.key, b.key));
}

function failedMember(m, error) {
  return {
    key: m.key, name: m.name, dir: m.dir, stack: [], stackKnown: false, role: null, roleSource: null,
    aliases: [], provides: [], consumes: [], unresolved: [],
    coverage: { level: 'none', files: 0, scannedFiles: 0, truncated: false, detectors: {} },
    needs: ['role', 'aliases', 'provides', 'consumes'], graph: null, errors: [error],
  };
}

/** The doc written when extraction crashed: every member level 'none', needs = all four, errors = [message]. */
export function failedExtract({ name, members, error, now = () => new Date() } = {}) {
  const e = msg(error);
  const out = { version: MAP_VERSION, workspace: { name: String(name ?? '') }, createdAt: iso(now), members: {} };
  for (const m of cleanMembers(members)) out.members[m.key] = failedMember(m, e);
  return out;
}

/** Folds one DetectResult into the member accumulator. Malformed items are dropped. A fact or an
 *  unresolved item that cites a line INSIDE a multi-line PEM block keeps no text of that line: its
 *  match / detail / raw become '***' (redactSecrets cannot recognise a bare base64 body line). */
function merge(acc, r, d, m, limits, st) {
  for (const f of Array.isArray(r.facts) ? r.facts : []) {
    if (!f || !KINDS.includes(f.kind) || !DIRS.includes(f.dir) || typeof f.key !== 'string' || !relOk(f.file)
      || !Number.isInteger(f.line) || f.line < 1 || typeof f.match !== 'string' || !f.match.trim()) continue;
    const key = redactSecrets(f.key.trim());
    const norm = key.length <= KEY_MAX ? normKey(f.kind, key) : null;
    if (!norm) {
      if (acc.unresolved.length < UNRESOLVED_MAX) acc.unresolved.push({ kind: f.kind, raw: key.slice(0, 200), file: f.file, line: f.line, reason: 'unkeyable' });
      continue;
    }
    const id = `${f.dir}|${norm}|${f.file}|${f.line}`;
    if (acc.factIds.has(id)) continue;
    if (acc.facts.length >= limits.MAX_FACTS_PER_MEMBER) { acc.capped = true; continue; }
    acc.factIds.add(id);
    const inPem = acc.pemBody.get(f.file)?.has(f.line) === true;
    const detail = str(f.detail, limits.DETAIL_MAX);
    acc.facts.push({
      kind: f.kind, dir: f.dir, key, norm, file: f.file, line: f.line,
      match: inPem ? '***' : redactSecrets(f.match).slice(0, limits.MATCH_MAX), detail: inPem && detail ? '***' : detail,
      label: f.kind === 'other' ? str(f.label, limits.LABEL_MAX) : null,
      target: f.dir === 'consumes' ? str(f.target, 200) : null,
      source: 'static', detector: d.id, confidence: f.confidence === 'heuristic' ? 'heuristic' : 'exact',
      test: isTestPath(f.file),
    });
    st.facts += 1;
  }
  for (const a of Array.isArray(r.aliases) ? r.aliases : []) {
    const value = typeof a?.value === 'string' ? redactSecrets(a.value.trim()).toLowerCase() : '';
    if (!value || value.length > 100 || /\s/.test(value)) continue;
    acc.aliases.push({ value, source: String(a.source || d.id), member: typeof a.member === 'string' && a.member ? a.member : m.key });
  }
  for (const u of Array.isArray(r.unresolved) ? r.unresolved : []) {
    if (!u || !KINDS.includes(u.kind) || typeof u.raw !== 'string' || !relOk(u.file) || !Number.isInteger(u.line)) continue;
    if (acc.unresolved.length >= UNRESOLVED_MAX) break;
    const raw = acc.pemBody.get(u.file)?.has(u.line) === true ? '***' : redactSecrets(u.raw).slice(0, 200);
    // A reason may quote a parser message: redacted like every other string (then clipped).
    acc.unresolved.push({ kind: u.kind, raw, file: u.file, line: u.line, reason: redactSecrets(String(u.reason || 'dynamic')).slice(0, 100) });
  }
  for (const s of Array.isArray(r.stack) ? r.stack : []) if (typeof s === 'string' && s) acc.stack.add(s);
  if (r.role && typeof r.role.text === 'string' && r.role.text.trim()) {
    const text = redactSecrets(r.role.text.replace(/\s+/g, ' ').trim()).slice(0, limits.ROLE_MAX);
    if (r.role.source === 'readme') acc.readmeRole ??= text;
    else acc.manifestRole ??= text;
  }
}

async function extractMember(m, members, detectors, limits) {
  const deadline = Date.now() + limits.MEMBER_BUDGET_MS;
  const errors = [];
  const exists = await stat(m.dir).then((s) => s.isDirectory(), () => false);
  if (!exists) return { ...failedMember(m, 'checkout unreadable'), foreign: [] };
  const listing = await listMemberFiles(m.dir, { maxFiles: limits.MAX_FILES_PER_MEMBER });
  // The member's real root, resolved once: readText's containment check needs it for every file.
  const realRoot = await realpath(m.dir).catch(() => null);
  const acc = { facts: [], factIds: new Set(), aliases: [], unresolved: [], stack: new Set(), readmeRole: null, manifestRole: null, capped: false,
    pemBody: new Map() };
  const stats = new Map(detectors.map((d) => [d.id, { facts: 0, ms: 0, error: null }]));
  const ctxs = new Map(detectors.map((d) => [d.id, { member: m, members, files: listing.files, state: {} }]));
  const fail = (d, err) => { const s = stats.get(d.id); if (!s.error) s.error = msg(err); };
  const run = (d, fn) => {
    const t0 = performance.now();
    try {
      const r = fn();
      if (r && typeof r.then === 'function') {
        r.then(null, () => {}); // an async detector's rejection must never go unhandled
        throw new Error('detector returned a promise (detectors are synchronous)');
      }
      if (r && typeof r === 'object') merge(acc, r, d, m, limits, stats.get(d.id));
    } catch (err) {
      fail(d, err);
    }
    stats.get(d.id).ms += performance.now() - t0;
  };
  let truncated = listing.truncated;
  let scanned = 0;
  for (const rel of listing.files) {
    const claimers = detectors.filter((d) => {
      try { return d.claims(rel) === true; } catch (err) { fail(d, err); return false; }
    });
    if (!claimers.length) continue;
    if (Date.now() > deadline) { truncated = true; errors.push('member budget exhausted'); break; }
    const text = await readText(m.dir, rel, { maxBytes: limits.MAX_FILE_BYTES, realRoot });
    if (text === null) continue;
    scanned += 1;
    if (text.includes('-----BEGIN')) acc.pemBody.set(rel, pemBodyLines(text));
    for (const d of claimers) run(d, () => d.detect({ rel, text }, ctxs.get(d.id)));
  }
  for (const d of detectors) if (typeof d.finish === 'function') run(d, () => d.finish(ctxs.get(d.id)));
  if (acc.capped) { truncated = true; errors.push(`fact cap of ${limits.MAX_FACTS_PER_MEMBER} reached`); }
  const slug = remoteSlug(redactSecrets((await gitOutput(m.dir, ['remote', 'get-url', 'origin'])) ?? ''));
  if (slug) {
    acc.aliases.push({ value: slug, source: 'git-remote', member: m.key });
    acc.aliases.push({ value: slug.split('/').pop(), source: 'git-remote', member: m.key });
  }
  const stack = [...acc.stack].sort(byStr);
  const role = acc.readmeRole ?? acc.manifestRole;
  const detectorsOut = {};
  for (const [id, s] of stats) detectorsOut[id] = { facts: s.facts, ms: Math.round(s.ms), error: s.error };
  return {
    key: m.key, name: m.name, dir: m.dir, stack, stackKnown: stack.length > 0,
    role, roleSource: acc.readmeRole ? 'readme' : acc.manifestRole ? 'manifest' : null,
    aliases: acc.aliases.filter((a) => a.member === m.key).map(({ value, source }) => ({ value, source })),
    foreign: acc.aliases.filter((a) => a.member !== m.key),
    provides: acc.facts.filter((f) => f.dir === 'provides'),
    consumes: acc.facts.filter((f) => f.dir === 'consumes'),
    unresolved: acc.unresolved,
    coverage: { level: 'none', files: listing.files.length, scannedFiles: scanned, truncated, detectors: detectorsOut },
    needs: [], graph: null, errors,
  };
}

/** Spec §5.3: the deterministic coverage level and the survey's needs. */
function classify(x) {
  const nonTest = [...x.provides, ...x.consumes].filter((f) => !f.test).length;
  const detectorError = Object.values(x.coverage.detectors).some((s) => s.error);
  const failed = x.errors.includes('checkout unreadable') || !!x.failed;
  let level = 'partial';
  if (failed || x.coverage.scannedFiles === 0 || (!x.stackKnown && nonTest === 0)) level = 'none';
  else if (x.stackKnown && nonTest >= 3 && x.unresolved.length <= 2 && !detectorError && !x.coverage.truncated) level = 'rich';
  const needs = level === 'none' ? ['role', 'aliases', 'provides', 'consumes']
    : level === 'rich' ? []
      : NEEDS.filter((n) => n === 'provides' || n === 'consumes' || (n === 'role' && !x.role) || (n === 'unresolved' && x.unresolved.length > 0));
  return { level, needs };
}

/** {path, bytes, nodes, fresh} of <dir>/graphify-out/graph.json, or null when absent. `fresh` =
 *  built_at_commit === HEAD. Big graphs are not parsed here (only their tail is read). */
async function probeGraph(dir, head) {
  const path = join(dir, 'graphify-out', 'graph.json');
  let st;
  // lstat (C10): a symlinked graph.json is never followed out of the member.
  try { st = await lstat(path); } catch { return null; }
  if (!st.isFile()) return null;
  // C10: lstat checks the last component only — a symlinked graphify-out/ directory is refused here.
  const [top, real] = await Promise.all([realpath(dir), realpath(path)]).catch(() => [null, null]);
  const back = top && real ? relative(top, real) : '';
  if (!back || back === '..' || back.startsWith(`..${sep}`) || isAbsolute(back)) return null;
  let built = null;
  let nodes = null;
  try {
    if (st.size <= GRAPH_PARSE_MAX_BYTES) {
      const g = JSON.parse(await readFile(path, 'utf8'));
      nodes = Array.isArray(g?.nodes) ? g.nodes.length : null;
      built = typeof g?.built_at_commit === 'string' ? g.built_at_commit : null;
    } else {
      const fh = await open(path, 'r');
      try {
        const len = Math.min(GRAPH_TAIL_BYTES, st.size);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, st.size - len);
        built = /"built_at_commit"\s*:\s*"([0-9a-fA-F]{7,64})"/.exec(buf.toString('utf8'))?.[1] ?? null;
      } finally {
        await fh.close();
      }
    }
  } catch { /* unreadable graph: present, not fresh */ }
  return { path, bytes: st.size, nodes, fresh: !!built && !!head && built === head };
}

/** members: Member[] (sorted by key). Pool of EXTRACT_POOL members; per-detector try/catch +
 *  timing; per-member MEMBER_BUDGET_MS soft budget (stop reading files → truncated). Adds the
 *  origin-remote alias via `git -C <dir> remote get-url origin`. Computes coverage level + needs
 *  (spec §5.3) and graph presence ({path, bytes, nodes, fresh} from <dir>/graphify-out/graph.json;
 *  fresh = built_at_commit === `git rev-parse HEAD`; null when absent). Never throws. */
export async function extractWorkspace({ name, members, detectors = DETECTORS, limits = LIMITS, now = () => new Date() } = {}) {
  const list = cleanMembers(members);
  try {
    const dets = (Array.isArray(detectors) ? detectors : []).filter((d) => d && typeof d.id === 'string' && typeof d.claims === 'function' && typeof d.detect === 'function');
    const results = await mapWithCap(list, limits.EXTRACT_POOL, (m) =>
      extractMember(m, list, dets, limits).catch((err) => ({ ...failedMember(m, msg(err)), failed: true, foreign: [] })));
    const byKey = new Map(results.map((x) => [x.key, x]));
    for (const x of results) {
      for (const a of x.foreign || []) byKey.get(a.member)?.aliases.push({ value: a.value, source: a.source });
    }
    const out = { version: MAP_VERSION, workspace: { name: String(name ?? '') }, createdAt: iso(now), members: {} };
    for (const x of results) {
      // One alias per value, its strongest source kept (alias-tiers.mjs): the checkout's own name `billing` never
      // reaches the catalog tagged `go.mod` because go.mod was read before identity's finish ran.
      // A member's own default deploy name (`deploy-self`) survives as `selfGuess` when another of its claims of the value
      // is kept (a package name, a remote, a scope tail read first): the catalog's tie with a peer's deploy name reads it.
      const best = new Map();
      const selfGuessed = new Set();
      for (const a of x.aliases) {
        if (a.source === 'deploy-self') selfGuessed.add(a.value);
        if (!best.has(a.value) || aliasTier(a.source) < aliasTier(best.get(a.value).source)) best.set(a.value, a);
      }
      x.aliases = [...best.values()].map((a) => (selfGuessed.has(a.value) && a.source !== 'deploy-self' ? { ...a, selfGuess: true } : a))
        .sort((a, b) => byStr(a.value, b.value));
      const { level, needs } = classify(x);
      x.coverage.level = level;
      x.needs = needs;
      const head = (await gitOutput(x.dir, ['rev-parse', 'HEAD']))?.trim() || null;
      x.graph = await probeGraph(x.dir, head);
      delete x.foreign;
      delete x.failed;
      out.members[x.key] = x;
    }
    return out;
  } catch (err) {
    return failedExtract({ name, members: list, error: err, now });
  }
}

/** One brief line per value: a repo-written string (a package name with an escaped `\n`, a file name
 *  holding a newline, a parser message) never adds a line — nor a fake `## Output rules` section. */
const one = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').replace(/[\r\n\v\f\x85\p{Zl}\p{Zp}]+/gu, ' ');
const factLine = (f) => `  - ${one(f.dir)} ${one(f.kind)} \`${one(f.key)}\` — ${one(f.file)}:${one(f.line)}${f.test ? ' (test)' : ''}`;

/** survey-brief.md (spec §6.2). FIRST LINES are machine-read by the mock and must be exactly:
 *    # Workspace survey brief
 *    <!-- worca:extract=<abs extract.json> -->
 *    <!-- worca:check=<checker command line> -->
 *  then: members needing investigation (key, name, dir, needs, compact known facts ≤ 20 per
 *  member, unresolved), members skipped, the other members' names + aliases, the LlmFact rules.
 *  The output path of survey.json is NOT in the brief (the agent's Ports block gives it). */
export function surveyBrief(extractDoc, { extractPath, checkerCmd } = {}) {
  const members = Object.values(extractDoc?.members && typeof extractDoc.members === 'object' ? extractDoc.members : {})
    .filter((m) => m && typeof m.key === 'string').sort((a, b) => byStr(a.key, b.key));
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => v !== null && typeof v === 'object';
  const todo = members.filter((m) => Array.isArray(m.needs) && m.needs.length);
  const skip = members.filter((m) => !Array.isArray(m.needs) || !m.needs.length);
  const L = ['# Workspace survey brief', `<!-- worca:extract=${extractPath} -->`, `<!-- worca:check=${checkerCmd} -->`, ''];
  L.push(`Workspace "${one(extractDoc?.workspace?.name)}": ${members.length} member projects. Full static facts: \`${extractPath}\`.`, '');
  L.push(`## Members to investigate (${todo.length})`, '');
  if (!todo.length) L.push('- none', '');
  for (const m of todo) {
    const facts = [...arr(m.provides), ...arr(m.consumes)].filter(isObj).sort((a, b) => Number(a.test) - Number(b.test));
    L.push(`### ${one(m.key)} — ${one(m.name)}`, '');
    L.push(`- Checkout: \`${one(m.dir)}\``);
    L.push(`- Needs: ${m.needs.join(', ')}`);
    L.push(`- Coverage: ${m.coverage?.level ?? 'none'}; stack: ${arr(m.stack).join(', ') || 'not recognised'}; ${facts.length} static facts; ${arr(m.unresolved).length} unresolved`);
    if (m.role) L.push(`- Known role: ${one(m.role)}`);
    if (facts.length) {
      L.push(`- Known facts${facts.length > BRIEF_FACTS_MAX ? ` (first ${BRIEF_FACTS_MAX} of ${facts.length})` : ''}:`);
      for (const f of facts.slice(0, BRIEF_FACTS_MAX)) L.push(factLine(f));
    }
    if (arr(m.unresolved).filter(isObj).length) {
      L.push('- Unresolved (key them if you can):');
      for (const u of arr(m.unresolved).filter(isObj).slice(0, BRIEF_FACTS_MAX)) L.push(`  - ${one(u.kind)} \`${one(u.raw)}\` — ${one(u.file)}:${one(u.line)} (${one(u.reason)})`);
    }
    L.push('');
  }
  L.push(`## Members already mapped (${skip.length})`, '');
  L.push(...(skip.length ? skip.map((m) => `- ${one(m.key)} (${one(m.name)}): write status "skipped"`) : ['- none']), '');
  L.push('## All members and their aliases', '');
  for (const m of members) L.push(`- ${one(m.key)} (${one(m.name)}): ${arr(m.aliases).map((a) => a?.value).join(', ') || '(no aliases)'}`);
  L.push('', '## Output rules', '');
  L.push('- Write ONE JSON file: `{ "version": 1, "members": { "<key>": { "status": "investigated|failed|skipped", "role": "…", "aliases": ["…"], "provides": [Fact], "consumes": [Fact], "notes": "…" } } }` with every member key above.');
  L.push('- Fact = `{ "kind", "key", "file", "line", "match", "detail"?, "label"?, "target"? }`; kind is one of http, grpc, graphql, topic, pkg, db, service, other.');
  L.push('- key forms: http `GET /users/:id`; pkg `npm:@acme/auth` (npm, pypi, maven group:artifact, go, cargo, nuget, gem, composer); topic `orders.created`; db `table:invoices` or `db:shop`; service the host or alias (`billing:8080`); grpc `package.Service/Method`; graphql `Query.field` or `op:Name`; other: short text plus `label`.');
  L.push('- file = path relative to that member\'s checkout, `/` separators, never `..`; line = 1-based; match = a literal substring of that line (≤ 200 chars). A fact without real evidence is dropped.');
  L.push('- target (consumes only) = the host, alias or member the consumer points at, when the code names it.');
  L.push('- role = one line (≤ 160 chars): what the project is for.');
  L.push('- aliases (only for a member whose Needs lists aliases) = the names OTHER members use to reach this member: its service name, hostname or package name. Never the name of a service it deploys, runs or calls.');
  L.push(`- Validate before finishing: \`${checkerCmd}\` — replace <OUT> with the path of your survey.json; fix every reported line and re-run until it prints OK.`);
  return L.join('\n') + '\n';
}
