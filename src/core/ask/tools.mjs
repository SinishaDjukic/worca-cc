// src/core/ask/tools.mjs
// The worca MCP tools (ask-worca-design.md §6.4) — READ-ONLY BY CONTRACT.
// House rule, enforced by test/ask-tools.test.mjs scanning this file: no
// uppercase SQL write verbs anywhere in this module (use lowercase in prose),
// no import of the db module and no direct database handle of any kind. Every reader is injected through
// `deps` (tool-deps.mjs builds the real bundle). Handler failures are
// AskToolError → the MCP child returns them as isError:true text so the model
// can self-correct; they are never JSON-RPC errors. No imports at all: diff paths
// are repo-relative POSIX, so path handling here is plain string work.

export class AskToolError extends Error {
  constructor(message) { super(message); this.name = 'AskToolError'; }
}

const MEMBER_HEADER_RE = /^# ([a-z0-9][a-z0-9-]*-[0-9a-f]{8})$/;   // workspace patches = member patches joined as `# <projectKey>\n<patch>`
const DIFF_GIT = 'diff --git ';
const FROM_RE = /^(?:rename|copy) from /;   // extended-header line naming the SOURCE file of a rename/copy

// `\a \b \f \n \r \t \v` — every other escape (`\"`, `\\`) is the literal byte.
const C_ESCAPES = new Map([[0x61, 7], [0x62, 8], [0x66, 12], [0x6e, 10], [0x72, 13], [0x74, 9], [0x76, 11]]);

/** Undo git's C-quoting: `cl\303\251.pem` → `clé.pem`. Octal escapes are BYTES, so decode after reassembly. */
function unquoteDiffPath(s) {
  const src = String(s ?? '');
  if (!src.includes('\\')) return src;
  const buf = Buffer.from(src, 'utf8');
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x5c || i + 1 >= buf.length) { out[n++] = buf[i]; continue; }
    const next = buf[i + 1];
    if (next >= 0x30 && next <= 0x37) {
      let v = 0;
      for (let d = 0; d < 3 && i + 1 < buf.length && buf[i + 1] >= 0x30 && buf[i + 1] <= 0x37; d++) { v = v * 8 + (buf[i + 1] - 0x30); i += 1; }
      out[n++] = v & 0xff;
      continue;
    }
    out[n++] = C_ESCAPES.get(next) ?? next;
    i += 1;
  }
  return out.subarray(0, n).toString('utf8');
}

/** Strip the surrounding quotes of a C-quoted token, or null when it is not quoted. */
function unquoteToken(tok) {
  return tok.length > 1 && tok.startsWith('"') && tok.endsWith('"') ? tok.slice(1, -1) : null;
}

/**
 * The a-side of a `diff --git ` header (`a/<p>`, or `"a/<p>"` — git quotes each
 * side independently), or null when the token is not one. The prefix is required
 * here because an a-side that lost it (`diff.noprefix`) is indistinguishable from
 * a path, and a WRONG old path would drop a harmless file: the `--- ` label and
 * `rename from ` line below are the exact sources, this is the last resort.
 */
function aSidePath(tok) {
  const inner = unquoteToken(tok);
  const body = inner ?? tok;
  if (!body.startsWith('a/') || body.length === 2) return null;
  const path = body.slice(2);
  return inner === null ? path : unquoteDiffPath(path);
}

/**
 * The b-side path of a `diff --git ` header, or null when the line has no
 * UNAMBIGUOUS one. git's core.quotePath defaults to true, so a path with
 * non-ASCII, `"`, `\` or a control byte is emitted C-quoted, and EACH SIDE is
 * quoted independently (`diff --git a/README.md "b/ren\303\245med.md"` on a
 * rename) — a quoted b-side therefore always ENDS the line, which makes it
 * unambiguous. Unquoted, the header separates the two sides with a bare space, so
 * a path containing ` b/` makes it a GUESS: for `secrets/plan b/creds.json` both
 * the first and the last ` b/` land inside a side, and either guess yields a path
 * (`creds.json`) that no longer matches the secrets guardrail glob while the body
 * still ships.
 * So only two shapes are read here, and both are exact:
 *   - exactly one ` b/` — nothing else can be the separator;
 *   - `a/<p> b/<p>` (a non-rename), whose separator position is fixed by the
 *     lengths, so at most one index can satisfy it.
 * Anything else returns null: the section's own `+++ ` line (tab-terminated, hence
 * unambiguous) is preferred over this whole function anyway, and a section left
 * with no path is dropped by get_run_diff rather than emitted.
 * The a-side is read from the SAME two exact shapes, so a rename can be checked on
 * both sides — see splitUnifiedDiff's oldPath.
 * @returns {{path: string|null, oldPath: string|null}}
 */
function diffGitPaths(line) {
  const rest = line.slice(DIFF_GIT.length);
  if (rest.endsWith('"')) {
    const q = rest.lastIndexOf(' "b/');
    if (q > 0) return { path: unquoteDiffPath(rest.slice(q + 4, -1)), oldPath: aSidePath(rest.slice(0, q)) };
  }
  const first = rest.indexOf(' b/');
  if (first <= 0) return { path: null, oldPath: null };
  if (rest.indexOf(' b/', first + 1) < 0) return { path: rest.slice(first + 3) || null, oldPath: aSidePath(rest.slice(0, first)) };
  const half = (rest.length - 1) / 2;                                  // `a/<p>` + ` b/` + `<p>`
  if (!Number.isInteger(half) || !rest.startsWith('a/')) return { path: null, oldPath: null };
  if (rest.slice(half, half + 3) !== ' b/' || rest.slice(2, half) !== rest.slice(half + 3)) return { path: null, oldPath: null };
  const p = rest.slice(half + 3) || null;
  return { path: p, oldPath: p };                                      // a non-rename: both sides are the same file
}

/**
 * The a-side of a header whose sides diffGitPaths could not separate, recovered
 * from a b-side the section's own `+++ ` line pinned down EXACTLY: the header then
 * has to end with ` b/<that path>`, so what precedes it IS the a-side. Turns
 * `a/a b/old.pem b/plain.txt` + `+++ b/plain.txt` into `a b/old.pem` — a rename out
 * of a protected file that the header alone reads as a guess.
 */
function headerOldFromNew(rest, newPath) {
  if (rest == null || !newPath) return null;
  const suffix = ` b/${newPath}`;
  return rest.length > suffix.length && rest.endsWith(suffix) ? aSidePath(rest.slice(0, -suffix.length)) : null;
}

/** The path of a `--- `/`+++ ` label line, or null. git tab-terminates a name that needs it, so cut at the first tab. */
function labelPath(line, prefix) {
  const tok = line.slice(4).split('\t')[0];
  const inner = unquoteToken(tok);
  const body = inner ?? tok;
  const path = body.startsWith(prefix) ? body.slice(2) : body;
  return inner === null ? path : unquoteDiffPath(path);
}

/** The source path of a `rename from `/`copy from ` line: a whole-line value, C-quoted when it needs to be, never prefixed. */
function fromPath(line) {
  const tok = line.slice(line.indexOf(' from ') + 6);
  const inner = unquoteToken(tok);
  return (inner === null ? tok : unquoteDiffPath(inner)) || null;
}

/**
 * Split a unified diff into per-file sections (pure), lossless: concatenating the
 * sections' text reproduces the input. Text before the first header, and a header
 * whose path cannot be read, are `path: null` sections — get_run_diff drops those
 * rather than emitting them, because a section with no path cannot be checked
 * against the protected-path filter.
 * `oldPath` is the section's SOURCE file. diffPatch passes `-M` (git-info.mjs:127),
 * so a rename+edit is ONE section: `path` is the new name — harmless for
 * `config/.env` → `config/env.sample` — while its `-`/context lines are the old
 * file's content, which get_run_diff has to filter on the old name. Sources, most
 * exact first: `rename from ` / `copy from `, the tab-terminated `--- ` label, then
 * the header's a-side. Extended header only: past the first `@@` both shapes are
 * ordinary body lines — and only inside a section a `diff --git ` line opened,
 * because a patch without one never splits, so its first label would name every
 * file that follows.
 */
export function splitUnifiedDiff(text) {
  const sections = [];
  let projectKey = null;
  let cur = null;
  const start = (path, headerOld, headerRest, hasHeader) => {
    cur = { path, headerOld, headerRest, hasHeader, renameFrom: null, minusPath: null, projectKey, added: 0, removed: 0, lines: [], inHunks: false, fromPlus: false, fromMinus: false };
  };
  const flush = () => {
    if (cur && (cur.lines.length || cur.path)) {
      sections.push({ path: cur.path, oldPath: cur.renameFrom ?? cur.minusPath ?? cur.headerOld ?? headerOldFromNew(cur.headerRest, cur.path),
        projectKey: cur.projectKey, member: false, added: cur.added, removed: cur.removed, text: cur.lines.length ? `${cur.lines.join('\n')}\n` : '' });
    }
    cur = null;
  };
  const lines = String(text ?? '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    const member = MEMBER_HEADER_RE.exec(line);
    if (member) {
      // The member header is a section of ITS OWN: anything after it must earn a
      // section, so an unreadable body can never ride along inside the one part
      // of a workspace patch that is kept without a path.
      flush();
      projectKey = member[1];
      sections.push({ path: null, oldPath: null, projectKey, member: true, added: 0, removed: 0, text: `${line}\n` });
      continue;
    }
    // Split on the literal marker, never on a path shape: `diff.noprefix`,
    // `diff.mnemonicPrefix` and `diff.srcPrefix`/`dstPrefix` change or drop the
    // `a/` … `b/` prefixes, and patches persisted before diffPatch pinned them
    // cannot be regenerated. A header that starts no section swallows its file
    // into the previous one — its `+` lines miscounted, its body past the filter.
    if (line.startsWith(DIFF_GIT)) {
      flush();
      const p = diffGitPaths(line);
      start(p.path, p.oldPath, line.slice(DIFF_GIT.length), true);
      cur.lines.push(line);
      continue;
    }
    if (!cur) start(null, null, null, false);
    // Everything below is about the section's EXTENDED HEADER only: past the first
    // `@@`, `+++ `/`--- ` at the head of a line are ordinary body lines (a diff of a
    // diff, an added `++i;`, a removed YAML `---`), so they must not be read as
    // paths and must not be excluded from the counts.
    if (!cur.inHunks && line.startsWith('@@')) cur.inHunks = true;
    // …and they are read only inside a section a `diff --git ` line STARTED. Without
    // one nothing splits the run, so the first label would name every file that
    // follows: `--- /tmp/git-blob-1/aaa.txt` from a legacy external-diff patch, or
    // the inner patch of `diff.submodule=diff`, then ships the credential file after
    // it under `aaa.txt`. A section git never opened resolves no path, so it is
    // dropped whole — the harmless first file goes with it rather than carrying it.
    if (cur.hasHeader && !cur.inHunks && !cur.fromPlus && line.startsWith('+++ ')) {
      // The `+++ ` line WINS over the `diff --git ` header: git tab-terminates a
      // name that needs it, so this line is unambiguous where the header is a
      // guess (a path containing ` b/`). ui/public/diff-view.mjs:66-69,85 has the
      // same precedence.
      const p = labelPath(line, 'b/');
      if (p && p !== '/dev/null') { cur.path = p; cur.fromPlus = true; }
    }
    // The old side, same precedence for the same reason: `rename from ` is a
    // whole-line value, the `--- ` label is tab-terminated, the header is a guess.
    if (cur.hasHeader && !cur.inHunks && !cur.renameFrom && FROM_RE.test(line)) cur.renameFrom = fromPath(line);
    if (cur.hasHeader && !cur.inHunks && !cur.fromMinus && line.startsWith('--- ')) {
      const p = labelPath(line, 'a/');
      if (p && p !== '/dev/null') { cur.minusPath = p; cur.fromMinus = true; }
    }
    if (line.startsWith('+') && (cur.inHunks || !line.startsWith('+++'))) cur.added += 1;
    else if (line.startsWith('-') && (cur.inHunks || !line.startsWith('---'))) cur.removed += 1;
    cur.lines.push(line);
  }
  flush();
  return sections;
}

const RE_SPECIAL = new Set(['.', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
const globCache = new Map();
/** A guardrails.mjs pattern → anchored regex: a leading double-star + slash = any dirs, double-star = anything, one star = within one segment. */
function globRe(pattern) {
  let re = globCache.get(pattern);
  if (re) return re;
  let body = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c !== '*') { body += RE_SPECIAL.has(c) ? `\\${c}` : c; continue; }
    if (pattern[i + 1] !== '*') { body += '[^/]*'; continue; }
    if (pattern[i + 2] === '/') { body += '(?:.*/)?'; i += 2; } else { body += '.*'; i += 1; }
  }
  re = new RegExp(`^${body}$`);
  globCache.set(pattern, re);
  return re;
}

/**
 * Guardrail match for a diff section path (repo-relative, POSIX). Mirrors the CLI
 * semantics guardrails.mjs:16-18 documents: slash-LESS patterns (`*x*`, `*x`, `x*`,
 * `x`) match the basename at any depth; slash-containing ones match the whole path.
 * `~/…` and `//…` are absolute and can never name a file inside a run diff, so they
 * are skipped rather than silently mis-matched.
 */
export function isProtectedBasename(path, patterns = []) {
  const full = String(path ?? '').replace(/^\.\//, '');
  const base = full.slice(full.lastIndexOf('/') + 1);
  for (const p of patterns) {
    if (typeof p !== 'string' || !p || p.startsWith('~/') || p.startsWith('//')) continue;
    if (globRe(p).test(p.includes('/') ? full : base)) return true;
  }
  return false;
}

/** Byte-offset paging: cut at the last newline inside the window; never inside a UTF-8 sequence, never zero progress. */
export function sliceBytes(text, offset = 0, maxBytes = 60000) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  const totalBytes = buf.length;
  const start = Math.min(Math.max(0, Math.trunc(Number(offset) || 0)), totalBytes);
  let end = Math.min(start + Math.max(1, Math.trunc(Number(maxBytes) || 1)), totalBytes);
  if (end < totalBytes) {
    const nl = buf.lastIndexOf(0x0a, end - 1);
    if (nl >= start) end = nl + 1;
    else {
      while (end > start && (buf[end] & 0xc0) === 0x80) end -= 1;      // back off to a character boundary
      // A window narrower than the first character would back off all the way to
      // `start` and return nextOffset === offset, so the documented "page until
      // truncated is false" loop never terminated. Emit that whole character instead.
      if (end === start) { end = start + 1; while (end < totalBytes && (buf[end] & 0xc0) === 0x80) end += 1; }
    }
  }
  return { text: buf.subarray(start, end).toString('utf8'), nextOffset: end, truncated: end < totalBytes, totalBytes };
}

/** Absent / non-numeric → dflt; otherwise clamped into [min, max] (spec §6.9: limit ≤ 100, maxBytes ≤ 200 000). */
const clampInt = (v, min, max, dflt) => {
  if (v === null || v === undefined || v === '') return dflt;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
};
const parseJson = (v, fallback) => { if (v == null) return fallback; try { return JSON.parse(v); } catch { return fallback; } };
const str = (v) => (typeof v === 'string' ? v.trim() : '');

const SCHEMA = {
  obj: (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }),
  s: (description) => ({ type: 'string', description }),
  i: (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum }),
};

/**
 * @param {object} deps  see tool-deps.mjs#defaultToolDeps for the real bundle
 * @returns {{list: () => Array<{name:string, description:string, inputSchema:object}>, call: (name:string, input:any) => Promise<any>}}
 */
export function createAskTools(deps) {
  const L = deps.limits;

  const defs = [
    { name: 'list_projects',
      description: 'List the registered projects (key, name, path) and workspaces (id, name, member project keys). Use the key / id in the other tools.',
      inputSchema: SCHEMA.obj({}) },
    { name: 'list_workflows',
      description: 'List the saved workflows with their ordered step groups (parallel agent nodes share a group) and feedback loops. Pick one by name, domain and steps.',
      inputSchema: SCHEMA.obj({}) },
    { name: 'list_runs',
      description: 'Find past runs, newest first. Optional filters: projectKey OR workspaceId, status (e.g. done, running, error, stopped), query (title substring). limit defaults to 20, max 100.',
      inputSchema: SCHEMA.obj({ projectKey: SCHEMA.s('project key from list_projects'), workspaceId: SCHEMA.s('workspace id from list_projects'),
        status: SCHEMA.s('run status to match'), limit: SCHEMA.i('max results (1-100)', 1, L.listRunsMaxLimit), query: SCHEMA.s('case-insensitive title substring') }) },
    { name: 'get_run',
      description: 'Read one run: its metadata and the user\'s original prompt. Give projectKey or workspaceId when known; without them the id is searched everywhere.',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('run id (8 hex)'), projectKey: SCHEMA.s('scope to a project'), workspaceId: SCHEMA.s('scope to a workspace') }, ['id']) },
    { name: 'get_run_diff',
      description: 'Read the unified diff of a run, paged by byte offset (use nextOffset until truncated is false). Optional path = one file only. files[] lists every file with added/removed counts; credential files are omitted.',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('run id'), projectKey: SCHEMA.s('scope to a project'), workspaceId: SCHEMA.s('scope to a workspace'),
        path: SCHEMA.s('only this file path'), offset: SCHEMA.i('byte offset to start at', 0, Number.MAX_SAFE_INTEGER),
        maxBytes: SCHEMA.i('bytes per page (default 60000, max 200000)', 1, L.diffMaxBytes) }, ['id']) },
    { name: 'propose_run',
      description: 'Propose a pipeline run for the user to confirm — it never starts anything. Exactly one of projectKey / workspaceId. guardrailsId defaults to "normal"; "permissive" is not allowed. Returns {ok:true, card} or {ok:false, errors}.',
      inputSchema: SCHEMA.obj({ projectKey: SCHEMA.s('target project key'), workspaceId: SCHEMA.s('target workspace id'), workflowId: SCHEMA.s('workflow id (default wf_default)'),
        brief: SCHEMA.s('the full task description for the run (≤ 8000 chars)'), title: SCHEMA.s('short run title'), guardrailsId: SCHEMA.s('guardrail set id (default normal)'),
        sourceBranch: SCHEMA.s('branch to start from (default: current)'), featureBranch: SCHEMA.s('feature branch name'),
        sourceBranchByKey: { type: 'object', description: 'workspace only: per-member source branch overrides keyed by project key', additionalProperties: { type: 'string' } } }, ['brief']) },
    { name: 'read_attachment',
      description: 'Read an attachment of this conversation by id, paged by byte offset (default 32000 bytes per page).',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('attachment id'), offset: SCHEMA.i('byte offset', 0, Number.MAX_SAFE_INTEGER), maxBytes: SCHEMA.i('bytes per page', 1, L.attachmentReadMaxBytes) }, ['id']) },
  ];

  const EMPTY_DIFF = () => ({ available: false, files: [], text: '', truncated: false, totalBytes: 0, nextOffset: 0 });

  async function resolveRow(input, tool) {
    const id = str(input.id);
    if (!id) throw new AskToolError(`${tool}: id is required`);
    const projectKey = str(input.projectKey);
    const workspaceId = str(input.workspaceId);
    if (projectKey && workspaceId) throw new AskToolError(`${tool}: give projectKey OR workspaceId, not both`);
    const row = projectKey
      ? deps.lookupPipelineRow(projectKey, id)
      : workspaceId
        ? deps.lookupPipelineRow(`workspaces/${workspaceId}`, id)
        : deps.findPipelineRowById(id);
    if (!row) throw new AskToolError(`${tool}: run not found`);
    return row;
  }

  function shapeRun(row) {
    const isWs = row.target === 'workspace' || !!row.workspace_key;
    const branch = parseJson(row.branch, null) || {};
    const wsMeta = isWs ? (parseJson(row.workspace_meta, null) || {}) : null;
    const meta = isWs ? null : deps.readStoreMeta(row.project_key);
    return {
      id: row.id,
      title: deps.redact(row.title ?? row.id),
      target: isWs ? 'workspace' : 'project',
      project: isWs ? null : { key: row.project_key, name: (meta && meta.name) || row.project_key },
      workspace: isWs ? { id: row.workspace_key, name: wsMeta.workspaceName ?? row.workspace_key,
        members: (Array.isArray(wsMeta.projects) ? wsMeta.projects : []).map((p) => p.projectName) } : null,
      status: row.status ?? null,
      phase: row.phase ?? null,
      startedAt: row.started_at ?? null,
      updatedAt: row.updated_at ?? null,
      branch: branch.feature ?? null,
      sourceBranch: branch.source ?? null,
      guardrailsId: row.guardrails_id ?? null,
      prompt: row.prompt == null ? null : deps.redact(row.prompt),     // run prompts are untrusted text (spec §6.3/§6.6)
      totalCostUsd: deps.totalsFor(row).cost,
      archived: !!row.archived_at,
    };
  }

  const handlers = {
    async list_projects() {
      const cat = await deps.buildCatalog();
      return { projects: cat.projects, workspaces: cat.workspaces };
    },
    async list_workflows() {
      return (await deps.buildCatalog()).workflows;
    },
    async list_runs(input) {
      const projectKey = str(input.projectKey);
      const workspaceId = str(input.workspaceId);
      if (projectKey && workspaceId) throw new AskToolError('list_runs: give projectKey OR workspaceId, not both');
      const wantKey = workspaceId ? `workspaces/${workspaceId}` : (projectKey || null);
      const status = str(input.status).toLowerCase();
      const query = str(input.query).toLowerCase();
      const limit = clampInt(input.limit, 1, L.listRunsMaxLimit, L.listRunsDefaultLimit);
      // Unkeyed: the newest runsScanLimit rows are enough. Keyed: scan everything — a
      // project's runs may all be older than the 200 globally newest (lite = one SQL
      // + one readdir per store key, no git).
      const rows = await deps.listAllPipelines({ lite: true, limit: wantKey ? -1 : L.runsScanLimit });
      const out = [];
      for (const e of rows) {
        if (wantKey && e.projectKey !== wantKey) continue;
        if (status && String(e.status ?? '').toLowerCase() !== status) continue;
        if (query && !String(e.title ?? '').toLowerCase().includes(query)) continue;
        const isWs = e.target === 'workspace' || String(e.projectKey).startsWith('workspaces/');
        out.push({
          id: e.id, title: deps.redact(e.title ?? e.id), target: isWs ? 'workspace' : 'project',
          ...(isWs
            ? { workspaceId: String(e.projectKey).slice('workspaces/'.length), workspaceName: e.workspaceName ?? null }
            : { projectKey: e.projectKey, projectName: e.projectName ?? null }),
          status: e.status ?? null, startedAt: e.startedAt ?? null,
          updatedAt: e.mtime ? new Date(e.mtime).toISOString() : null,
          branch: e.branch ?? null, sourceBranch: e.sourceBranch ?? null, guardrailsId: e.guardrailsId ?? null,
          totalCostUsd: e.totalCostUsd ?? null,
        });
        if (out.length >= limit) break;
      }
      return out;
    },
    async get_run(input) {
      const row = await resolveRow(input, 'get_run');
      const run = shapeRun(row);
      return { ...run, hasDiff: !run.archived && await deps.hasDiffPatch(row) };
    },
    async get_run_diff(input) {
      const row = await resolveRow(input, 'get_run_diff');
      if (row.archived_at) return EMPTY_DIFF();
      const text = await deps.readDiffPatch(row);
      if (text == null) return EMPTY_DIFF();
      const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const maxBytes = clampInt(input.maxBytes, 1, L.diffMaxBytes, L.diffDefaultBytes);
      // Fail closed: a section whose path could not be read cannot be checked
      // against the guardrail patterns, so it is dropped rather than emitted
      // verbatim. Member headers carry no path by design and are what scopes the
      // sections after them, so they are the one path-less shape that is kept.
      // BOTH sides are checked: `-M` (git-info.mjs:127) makes a rename+edit one
      // section under its NEW name, so `config/.env` → `config/env.sample` would
      // otherwise ship the old file's credentials as `-`/context lines.
      const protectedSide = (p) => !!p && isProtectedBasename(p, deps.protectedPaths);
      const kept = splitUnifiedDiff(text).filter((s) => s.member || (!!s.path && !protectedSide(s.path) && !protectedSide(s.oldPath)));
      const files = kept.filter((s) => s.path).map((s) => ({ path: s.path, added: s.added, removed: s.removed, ...(s.projectKey ? { projectKey: s.projectKey } : {}) }));
      const wantPath = str(input.path);
      const body = kept.filter((s) => (wantPath ? s.path === wantPath : true)).map((s) => deps.redact(s.text)).join('');
      return { available: true, files, ...sliceBytes(body, offset, maxBytes) };
    },
    async propose_run(input) {
      return deps.validateProposal(input);
    },
    async read_attachment(input) {
      const id = str(input.id);
      if (!id) throw new AskToolError('read_attachment: id is required');
      const a = deps.readAttachment(id);
      if (!a) throw new AskToolError('read_attachment: attachment not found');
      const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const maxBytes = clampInt(input.maxBytes, 1, L.attachmentReadMaxBytes, L.attachmentReadDefaultBytes);
      const { text, truncated, totalBytes, nextOffset } = sliceBytes(deps.redact(a.text), offset, maxBytes);
      return { name: a.name, text, truncated, totalBytes, nextOffset };
    },
  };

  return {
    list: () => defs.map((d) => ({ ...d })),
    async call(name, input) {
      const fn = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
      if (!fn) throw new AskToolError(`unknown tool: ${name}`);
      if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
        throw new AskToolError(`${name}: input must be an object`);
      }
      return fn(input ?? {});
    },
  };
}
