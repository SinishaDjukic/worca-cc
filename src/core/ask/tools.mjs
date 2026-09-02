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
 * `header` is true when a `diff --git ` line opened the section.
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
        projectKey: cur.projectKey, member: false, header: cur.hasHeader, added: cur.added, removed: cur.removed, text: cur.lines.length ? `${cur.lines.join('\n')}\n` : '' });
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
      sections.push({ path: null, oldPath: null, projectKey, member: true, header: false, added: 0, removed: 0, text: `${line}\n` });
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
  b: (description) => ({ type: 'boolean', description }),
};

/**
 * @param {object} deps  see tool-deps.mjs#defaultToolDeps for the real bundle
 * @returns {{list: () => Array<{name:string, description:string, inputSchema:object}>, call: (name:string, input:any) => Promise<any>}}
 */
export function createAskTools(deps) {
  const L = deps.limits;

  // #397: the user-pinned scope of this conversation — {projectKey}|{workspaceId}|
  // null — re-read per call so a mid-conversation selector change is honoured.
  // Optional dep: an absent or failing reader means "nothing pinned", never an error.
  const pinnedScope = () => {
    try { return typeof deps.pinnedScope === 'function' ? (deps.pinnedScope() || null) : null; }
    catch { return null; }
  };

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
      description: 'Read one run: its metadata and the user\'s original prompt. Give projectKey or workspaceId when known; without them the user-pinned scope (when the chat has one) is tried first, then the id is searched everywhere.',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('run id (8 hex)'), projectKey: SCHEMA.s('scope to a project'), workspaceId: SCHEMA.s('scope to a workspace') }, ['id']) },
    { name: 'get_run_diff',
      description: 'Read the unified diff of a run, paged by byte offset (use nextOffset until truncated is false). Optional path = one file only. files[] lists every file with added/removed counts; credential files are omitted.',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('run id'), projectKey: SCHEMA.s('scope to a project'), workspaceId: SCHEMA.s('scope to a workspace'),
        path: SCHEMA.s('only this file path'), offset: SCHEMA.i('byte offset to start at', 0, Number.MAX_SAFE_INTEGER),
        maxBytes: SCHEMA.i('bytes per page (default 60000, max 200000)', 1, L.diffMaxBytes) }, ['id']) },
    { name: 'propose_run',
      description: 'Propose a pipeline run for the user to confirm — it never starts anything. Exactly one of projectKey / workspaceId; omitting both targets the scope the user pinned for this chat, when there is one. guardrailsId defaults to "normal"; "permissive" is not allowed. Returns {ok:true, card} or {ok:false, errors}.',
      inputSchema: SCHEMA.obj({ projectKey: SCHEMA.s('target project key'), workspaceId: SCHEMA.s('target workspace id'), workflowId: SCHEMA.s('workflow id (default wf_default)'),
        brief: SCHEMA.s('the full task description for the run (≤ 8000 chars)'), title: SCHEMA.s('short run title'), guardrailsId: SCHEMA.s('guardrail set id (default normal)'),
        sourceBranch: SCHEMA.s('branch to start from (default: current)'), featureBranch: SCHEMA.s('feature branch name'),
        sourceBranchByKey: { type: 'object', description: 'workspace only: per-member source branch overrides keyed by project key', additionalProperties: { type: 'string' } },
        commentIds: { type: 'array', items: { type: 'string' },
          description: 'diff comment ids (dc_…) this run is meant to address. They are stamped with the run id once the user confirms the card AND the run actually starts; nothing is resolved.' } }, ['brief']) },
    { name: 'read_attachment',
      description: 'Read an attachment of this conversation by id, paged by byte offset (default 32000 bytes per page).',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('attachment id'), offset: SCHEMA.i('byte offset', 0, Number.MAX_SAFE_INTEGER), maxBytes: SCHEMA.i('bytes per page', 1, L.attachmentReadMaxBytes) }, ['id']) },
    { name: 'list_diff_comments',
      description: 'List the internal review comments anchored to a run\'s diff lines, ordered by file then line then when they were written. status filters them (all | unresolved | resolved, default all); path narrows to one file. Every comment carries line_text — the snapshot of the line it was anchored to, taken when it was written, so it stays readable even though the source branch has moved on. When the patch is still readable, a few surrounding hunk lines come with each comment. Comments on credential files are never listed.',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('run id'), projectKey: SCHEMA.s('scope to a project'), workspaceId: SCHEMA.s('scope to a workspace'),
        status: SCHEMA.s('all | unresolved | resolved (default all)'), path: SCHEMA.s('only this file path') }, ['id']) },
    { name: 'add_diff_comment',
      description: 'Add an internal comment (authored by you) on one line of a run\'s diff. side is "old" for a removed line — give its OLD line number — and "new" for an added or context line. A workspace run also needs memberProjectKey, naming which member project the file belongs to; it is never guessed. The anchor is checked against the stored patch, so an unknown file, side or line is refused rather than saved wrong.',
      inputSchema: SCHEMA.obj({ id: SCHEMA.s('run id'), projectKey: SCHEMA.s('scope to a project'), workspaceId: SCHEMA.s('scope to a workspace'),
        memberProjectKey: SCHEMA.s('workspace runs: which member project owns this file (from get_run_diff files[].projectKey)'),
        path: SCHEMA.s('file path as it appears in the diff'), side: SCHEMA.s('"old" or "new"'),
        line: SCHEMA.i('line number on that side', 1, Number.MAX_SAFE_INTEGER),
        body: SCHEMA.s(`the comment text (max ${L.commentBodyMaxChars} chars)`) }, ['id', 'path', 'side', 'line', 'body']) },
    { name: 'resolve_diff_comment',
      description: 'Mark one diff comment resolved, or reopen it with resolved:false. Nothing is deleted, and resolving is never automatic — do it only when the user asks.',
      inputSchema: SCHEMA.obj({ commentId: SCHEMA.s('comment id (dc_…) from list_diff_comments'),
        resolved: SCHEMA.b('true to resolve (default), false to reopen') }, ['commentId']) },
    { name: 'delete_diff_comment',
      description: 'Permanently delete one diff comment YOU wrote (author "ask"). The user\'s own comments cannot be deleted here — they delete those from the Diff tab. There is no undo and no history — confirm with the user before deleting anything, and always before deleting several.',
      inputSchema: SCHEMA.obj({ commentId: SCHEMA.s('comment id (dc_…) from list_diff_comments') }, ['commentId']) },
    { name: 'open_worktree',
      description: 'Create a read-only DETACHED git worktree of a registered project at any branch/tag/commit (projectKey + ref), or of a run\'s feature branch (runId; workspace runs also need projectKey). Returns {worktreeId, path, ref, commit}. Capped per chat — reuse via list_worktrees, remove via remove_worktree when done.',
      inputSchema: SCHEMA.obj({ projectKey: SCHEMA.s('project key from list_projects'),
        ref: SCHEMA.s('branch, tag or commit to check out'),
        runId: SCHEMA.s('run id — checks out that run\'s feature branch') }) },
    { name: 'list_worktrees',
      description: 'List this chat\'s worktrees: worktreeId, project, current ref and commit, path on disk.',
      inputSchema: SCHEMA.obj({}) },
    { name: 'remove_worktree',
      description: 'Remove one of this chat\'s worktrees by id. Branches are never touched.',
      inputSchema: SCHEMA.obj({ worktreeId: SCHEMA.s('worktree id') }, ['worktreeId']) },
    { name: 'git',
      description: 'Run a read-only git command inside one of this chat\'s worktrees; args is an argv array, e.g. ["diff","origin/master...HEAD"]. Allowed: diff, log, show, status, blame, branch/tag (list forms), rev-parse, merge-base, grep, shortlog, describe, ls-files, ls-tree, checkout/switch (always detached), fetch (configured remotes only). To read a file, check out the ref and use blame/log -p on it — the git tool serves diffs/logs/history. push/pull/commit/config/cat-file are impossible. Output paged by offset like get_run_diff.',
      inputSchema: SCHEMA.obj({ worktreeId: SCHEMA.s('worktree id'),
        args: { type: 'array', items: { type: 'string' }, description: 'git argv, without the leading "git"' },
        offset: SCHEMA.i('byte offset to page from', 0, Number.MAX_SAFE_INTEGER),
        maxBytes: SCHEMA.i('bytes per page (default 60000, max 200000)', 1, L.gitOutputMaxBytes) }, ['worktreeId', 'args']) },
  ];

  const EMPTY_DIFF = () => ({ available: false, files: [], text: '', truncated: false, totalBytes: 0, nextOffset: 0 });

  async function resolveRow(input, tool) {
    const id = str(input.id);
    if (!id) throw new AskToolError(`${tool}: id is required`);
    const projectKey = str(input.projectKey);
    const workspaceId = str(input.workspaceId);
    if (projectKey && workspaceId) throw new AskToolError(`${tool}: give projectKey OR workspaceId, not both`);
    let row;
    if (projectKey) row = deps.lookupPipelineRow(projectKey, id);
    else if (workspaceId) row = deps.lookupPipelineRow(`workspaces/${workspaceId}`, id);
    else {
      // #397: an unscoped id tries the user-pinned scope first (disambiguation
      // when the same short id exists in two stores), then everywhere — never
      // fewer results than an unpinned chat.
      const pin = pinnedScope();
      row = (pin && pin.projectKey ? deps.lookupPipelineRow(pin.projectKey, id)
        : pin && pin.workspaceId ? deps.lookupPipelineRow(`workspaces/${pin.workspaceId}`, id)
          : null)
        || deps.findPipelineRowById(id);
    }
    if (!row) throw new AskToolError(`${tool}: run not found`);
    return row;
  }

  // The History store key of a pipelines row — the same mapping lookupPipelineRow
  // reverses. Comments are keyed the way History is.
  const storeKeyOf = (row) => ((row.target === 'workspace' || row.workspace_key)
    ? `workspaces/${row.workspace_key}` : row.project_key);

  /**
   * Return exactly what changed — never the whole run, never the patch. runId and
   * storeKey are here because the parent process turns a successful write into the
   * diff-comments-changed poke by reading them back out of the tool result
   * (events.mjs); they are useful to the model too, since they say which run a
   * comment belongs to.
   */
  const shapeComment = (c) => ({
    id: c.id, runId: c.pipelineId, storeKey: c.storeKey, path: c.path, projectKey: c.projectKey,
    side: c.side, line: c.line,
    lineText: deps.redact(c.lineText), body: deps.redact(c.body), author: c.author,
    resolved: c.resolved, resolvedAt: c.resolvedAt, sentRunId: c.sentRunId, createdAt: c.createdAt,
  });

  // Comment failures are model-actionable -> AskToolError text, never a crash.
  const asCommentError = (tool, err) => (err && err.name === 'DiffCommentError'
    ? new AskToolError(`${tool}: ${err.message}`) : err);

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

  // Worktree failures are model-actionable → AskToolError text, never a crash.
  const asToolError = (err) => (err && err.name === 'AskWorktreeError' ? new AskToolError(err.message) : err);

  // Output shapes differ by subcommand, so the filter is chosen by what git ACTUALLY
  // emitted, not by the subcommand name — running a path-list (grep/ls-*) or a
  // commit-list (log --oneline) through the unified-diff section filter would drop
  // ALL of it. Two sets:
  //   PATCH_CAPABLE — accept --no-ext-diff/--no-color and can emit a `diff --git`
  //     patch (diff, show <commit>, log -p). Output is section-filtered ONLY when a
  //     real diff header is present.
  //   LIST_SUBS — emit PATH LISTS (grep, ls-files, ls-tree). Output is line-filtered.
  // blame is neither: a protected FILE is rejected at input (protectedInArgs); a
  // non-protected file's annotated content is fine. cat-file is not in the allowlist.
  const PATCH_CAPABLE = new Set(['diff', 'show', 'log']);
  const LIST_SUBS = new Set(['grep', 'ls-files', 'ls-tree']);
  // Trusted -c prepended by US (never the model — validateGitArgs already blocks the
  // model's -c): neutralises a hostile repo's `.git/config` (or ~/.gitconfig, whose
  // HOME survives the scrub) `diff.external`/pager, and forces predictable path/colour
  // output the section parser depends on. --no-ext-diff/--no-color are the belt-braces.
  const GIT_HARDEN = ['-c', 'core.quotePath=false', '-c', 'diff.external=', '-c', 'color.ui=never', '-c', 'diff.submodule=short'];
  // Reject a command that NAMES a protected file BEFORE spawning: every non-flag
  // positional — a bare token (blame .env), the <path> half of <rev>:<path>
  // (show HEAD:.env), and anything after `--` (log -p -- .env). A ref like
  // `main...leak` has a non-protected basename, so it passes.
  //
  // EVERY colon suffix is a candidate, not just the first: the index form
  // `:0:.env` (stage 0 of .env) was checked as basename `0:.env`, matched nothing,
  // and `rev-parse :0:.env` handed the model the blob sha (review of PR #376).
  // Pathspec magic is stripped the same way (`:(top).env`, `:/.env`, `:!x`), and
  // `-L<start>,<end>:<file>` carries its file after the last colon of an OPTION
  // token, so attached `-L` values are scanned too.
  const protectedInArgs = (args) => {
    let afterSep = false;
    const candidates = (tok) => {
      const out = [tok];
      const magic = /^:(\([^)]*\)|[/!^]*)/.exec(tok);
      if (magic) out.push(tok.slice(magic[0].length));
      for (let i = tok.indexOf(':'); i !== -1; i = tok.indexOf(':', i + 1)) out.push(tok.slice(i + 1));
      return out.filter(Boolean);
    };
    for (const a of args.slice(1)) {
      if (a === '--') { afterSep = true; continue; }
      if (a.startsWith('-')) {
        if (/^-L./.test(a)) { for (const cand of candidates(a.slice(2))) if (isProtectedBasename(cand, deps.protectedPaths)) return cand; }
        continue;
      }
      for (const cand of (afterSep ? [a] : candidates(a))) if (isProtectedBasename(cand, deps.protectedPaths)) return cand;
    }
    return null;
  };
  // A bare object name carries no path, so no pattern can protect what it points
  // at: `diff <blob> <blob>` printed a protected file's body under sha labels and
  // `grep <pat> <blob>` printed it as `<sha>:line` (review of PR #376). Every
  // positional that git will resolve as an object is typed via `cat-file -t` (a
  // TRUSTED spawn — the model cannot call cat-file); a blob is refused everywhere,
  // a tree is refused for `show` (its listing is the raw read this tool does not
  // serve). Unknown names (patterns, paths, refs git will reject itself) pass.
  const OBJECT_TYPED_SUBS = new Set(['diff', 'show', 'log', 'grep', 'blame']);
  const refuseBlobPositionals = async (wtPath, args) => {
    if (!OBJECT_TYPED_SUBS.has(args[0])) return;
    const positionals = [];
    for (const a of args.slice(1)) {
      if (a === '--') break;
      if (a.startsWith('-')) continue;
      // `<rev>:<path>` forms are name-checked above; `a..b`/`a...b` ranges are split
      // so a blob smuggled into a range end is typed too.
      for (const part of a.split(/\.\.\.?/)) if (part && !part.includes(':')) positionals.push(part);
    }
    for (const p of positionals) {
      const r = await deps.worktrees.runGit(wtPath, ['cat-file', '-t', `${p}^{}`]);   // ^{} peels an annotated tag
      const type = r.ok ? r.stdout.trim() : '';
      if (type === 'blob') throw new AskToolError(`git: ${JSON.stringify(p)} is a raw blob — this tool serves diffs and history, not file contents; inspect the file through a commit`);
      if (type === 'tree' && args[0] === 'show') throw new AskToolError(`git: ${JSON.stringify(p)} is a tree — git show displays commits; use ls-tree for a listing`);
    }
  };
  const protectedLineFilter = (text) => text.split('\n')
    .filter((line) => !line || !line.split(/[-\s:=\u0000]+/).some((tok) => isProtectedBasename(tok, deps.protectedPaths)))
    .join('\n');

  // Does this path hit the protected floor? UNQUOTE FIRST: git C-quotes any name
  // holding '"', '\\', a tab or a control byte (and, in patches persisted before
  // core.quotePath=false was pinned, any non-ASCII name), and a stored path can
  // carry that literal — `"a/old\tsecret.pem"` does not match `*.pem`. Both the
  // prefixed and the stripped form are tested: a `--- `-derived path keeps its a/
  // or b/ prefix while a `rename from`-derived one does not, and stripping blindly
  // would weaken the slash-anchored `**/secrets/**` pattern.
  const guardedPath = (p) => {
    if (!p) return false;
    const s = String(p);
    const inner = unquoteToken(s);
    const real = inner === null ? s : unquoteDiffPath(inner);
    return isProtectedBasename(real, deps.protectedPaths)
      || isProtectedBasename(real.replace(/^[ab]\//, ''), deps.protectedPaths);
  };

  // The read filter shared by EVERY tool that echoes or mutates a comment by id
  // (D5: "the read is the authority"). BOTH rename sides: -M makes a rename+edit
  // one section under its NEW name, and old_path is persisted for exactly this
  // check — which must keep working once the patch itself is gone.
  const commentBlocked = (c) => !!c && (guardedPath(c.path) || guardedPath(c.oldPath));

  const diffPageCache = new Map();   // run id -> { stamp, files, byPath, filtered } (get_run_diff paging)

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
      const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const maxBytes = clampInt(input.maxBytes, 1, L.diffMaxBytes, L.diffDefaultBytes);
      // Paging re-entered here per page with a full read + section split + redact of
      // the WHOLE patch (a 5 MB diff at the default page = ~85 passes — review of
      // PR #376). The filtered body is memoised per run for the life of this
      // closure (one MCP child = one turn); the row's stamp guards a run that
      // finishes and writes its patch mid-turn.
      const stamp = `${row.id}|${row.updated_at ?? row.updatedAt ?? ''}|${row.mtime ?? ''}|${row.status ?? ''}`;
      const hit = diffPageCache.get(row.id);
      if (hit && hit.stamp === stamp) {
        const body = hit.byPath.get(str(input.path) || '') ?? hit.filtered(str(input.path));
        return { available: true, files: hit.files, ...sliceBytes(body, offset, maxBytes) };
      }
      const text = await deps.readDiffPatch(row);
      if (text == null) return EMPTY_DIFF();
      // Fail closed: a section whose path could not be read cannot be checked
      // against the guardrail patterns, so it is dropped rather than emitted
      // verbatim. Member headers carry no path by design and are what scopes the
      // sections after them, so they are the one path-less shape that is kept.
      // BOTH sides are checked: `-M` (git-info.mjs:127) makes a rename+edit one
      // section under its NEW name, so `config/.env` → `config/env.sample` would
      // otherwise ship the old file's credentials as `-`/context lines.
      const protectedSide = (p) => !!p && isProtectedBasename(p, deps.protectedPaths);
      const kept = splitUnifiedDiff(text).filter((s) => s.member || (!!s.path && !protectedSide(s.path) && !protectedSide(s.oldPath)))
        .map((s) => ({ ...s, text: deps.redact(s.text) }));
      const files = kept.filter((s) => s.path).map((s) => ({ path: s.path, added: s.added, removed: s.removed, ...(s.projectKey ? { projectKey: s.projectKey } : {}) }));
      const byPath = new Map();
      const filtered = (wantPath) => {
        const key = wantPath || '';
        if (!byPath.has(key)) byPath.set(key, kept.filter((s) => (wantPath ? s.path === wantPath : true)).map((s) => s.text).join(''));
        return byPath.get(key);
      };
      diffPageCache.set(row.id, { stamp, files, byPath, filtered });
      return { available: true, files, ...sliceBytes(filtered(str(input.path)), offset, maxBytes) };
    },
    async propose_run(input) {
      // #397: a proposal naming NO target defaults to the user-pinned scope. The
      // parent turn applies the same default before its authoritative
      // re-validation, so the card the user sees matches what the model got.
      let inp = input;
      if (!str(input.projectKey) && !str(input.workspaceId)) {
        const pin = pinnedScope();
        if (pin) inp = { ...input, ...pin };
      }
      const r = await deps.validateProposal(inp);
      // commentIds are a ONE-WAY hand-off: a comment cited here is stamped
      // "sent to #<runId>" the moment the user starts the run, and nothing ever
      // un-stamps it. Refuse ids from a different project/workspace than this
      // proposal targets. Unknown ids stay tolerated (the user may have deleted
      // one since); only a WRONG-target id is an error — and propose_run already
      // reports {ok:false, errors}, so the model can fix it itself.
      const cited = Array.isArray(input.commentIds) ? input.commentIds : [];
      if (r && r.ok && cited.length && deps.comments && typeof deps.comments.get === 'function') {
        const want = r.card.workspaceId ? `workspaces/${r.card.workspaceId}` : r.card.projectKey;
        const bad = want ? cited.filter((id) => {
          const c = typeof id === 'string' ? deps.comments.get(id) : null;
          return !!c && c.storeKey !== want;
        }) : [];
        if (bad.length) {
          return { ok: false, errors: [`these diff comments are not from ${want}: ${bad.join(', ')} — cite comments from a run of the project this proposal targets`] };
        }
      }
      return r;
    },
    async list_diff_comments(input) {
      const row = await resolveRow(input, 'list_diff_comments');
      const status = str(input.status) || 'all';
      if (!['all', 'unresolved', 'resolved'].includes(status)) {
        throw new AskToolError('list_diff_comments: status must be all, unresolved or resolved');
      }
      // Archived runs return null here (get_run_diff's posture); the comments still
      // list, they simply lose their surrounding context. line_text is always there,
      // which is exactly what it exists for.
      const patchText = row.archived_at ? null : await deps.readDiffPatch(row);
      const raw = deps.comments.list(storeKeyOf(row), row.id,
        { status, path: str(input.path) || null, patchText, keep: (c) => !commentBlocked(c) });
      // The READ is the authority, exactly as in get_run_diff: creation already
      // refuses protected anchors, but a preset can GROW afterwards, so re-evaluate
      // now and omit the whole comment rather than trim it. BOTH sides, because a
      // rename+edit is one section under its new name (old_path is persisted for
      // exactly this check, which must also work once the patch is gone).
      // Re-applied here even though `keep` was handed to the bundle above: the
      // filter is this module's guarantee, not the bundle's, and it costs nothing
      // on rows that are already gone.
      const comments = raw.filter((c) => !commentBlocked(c)).map((c) => ({
        ...shapeComment(c),
        // Every string the model sees is redacted: line_text and the context come
        // from the patch, and the BODY is user-authored text that can hold a pasted
        // secret just as easily. shapeComment already redacts the first two.
        ...(Array.isArray(c.context) && c.context.length ? { context: c.context.map((l) => deps.redact(l)) } : {}),
      }));
      return { runId: row.id, patchAvailable: patchText != null, comments };
    },
    async add_diff_comment(input) {
      const row = await resolveRow(input, 'add_diff_comment');
      if (row.archived_at) throw new AskToolError('add_diff_comment: this run is archived — its diff is gone');
      const patchText = await deps.readDiffPatch(row);
      if (!patchText) throw new AskToolError('add_diff_comment: this run has no stored diff — comments cannot be created on it');
      try {
        const comment = deps.comments.add({
          storeKey: storeKeyOf(row), pipelineId: row.id, patchText,
          project: str(input.memberProjectKey) || null,
          path: str(input.path), side: str(input.side), line: input.line, body: input.body,
        });
        return { comment: shapeComment(comment) };
      } catch (err) { throw asCommentError('add_diff_comment', err); }
    },
    async resolve_diff_comment(input) {
      const id = str(input.commentId);
      if (!id) throw new AskToolError('resolve_diff_comment: commentId is required');
      // The read filter applies to EVERY tool that echoes a comment, not just to
      // list_diff_comments (D5: "the read is the authority"). Without this check a
      // comment created before the preset grew is still echoable by id — with its
      // path and its line_text — which is exactly the leak list_diff_comments closes.
      // The id is not obtainable from list, so this is defence in depth, and it is
      // one line. Checked BEFORE the write, so a protected comment is not silently
      // mutated either. Both rename sides, same as list.
      const before = deps.comments.get(id);
      if (!before || commentBlocked(before)) throw new AskToolError('resolve_diff_comment: comment not found');
      // Explicit tri-state, not `input.resolved !== false`: mcp-stdio.mjs checks only
      // that `arguments` is an object — inputSchema is never enforced — so a model
      // sending "false", 0 or null would otherwise RESOLVE the comment. Every other
      // tool validates its own inputs the same way (git, open_worktree).
      if (input.resolved !== undefined && typeof input.resolved !== 'boolean') {
        throw new AskToolError('resolve_diff_comment: resolved must be true or false');
      }
      const comment = deps.comments.setResolved(id, input.resolved !== false);
      if (!comment) throw new AskToolError('resolve_diff_comment: comment not found');
      return { comment: shapeComment(comment) };
    },
    async delete_diff_comment(input) {
      const id = str(input.commentId);
      if (!id) throw new AskToolError('delete_diff_comment: commentId is required');
      // Read BEFORE removing: the parent process needs the run this touched to emit
      // the poke, and after the row is gone there is nothing to read.
      // Same read filter as resolve (D5): a comment the guard hides is not
      // destroyable by id either, and the refusal is word-for-word the not-found
      // one so the guard cannot become an existence oracle.
      const before = deps.comments.get(id);
      if (!before || commentBlocked(before)) throw new AskToolError('delete_diff_comment: comment not found');
      // This is the ONLY irreversible capability in the Ask surface — everything
      // else is propose-only or read-only — and the model reads untrusted text
      // (diffs, run prompts, attachments) whose ids are enumerable from
      // list_diff_comments. So it may retract its OWN notes and nothing else; the
      // user deletes theirs from the Diff tab, behind a confirm (app.js:11323).
      if (before.author !== 'ask') {
        throw new AskToolError('delete_diff_comment: only comments Ask wrote can be deleted — the user deletes their own from the Diff tab');
      }
      if (!deps.comments.remove(id)) throw new AskToolError('delete_diff_comment: comment not found');
      return { ok: true, commentId: id, comment: { runId: before.pipelineId, storeKey: before.storeKey } };
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
    async open_worktree(input) {
      try {
        const wt = await deps.worktrees.open({
          projectKey: str(input.projectKey) || undefined,
          ref: str(input.ref) || undefined,
          runId: str(input.runId) || undefined,
        });
        return { worktreeId: wt.worktreeId, path: wt.path, projectKey: wt.projectKey, ref: wt.ref, commit: wt.commit };
      } catch (err) { throw asToolError(err); }
    },
    async list_worktrees() {
      return { worktrees: deps.worktrees.list().map((w) => ({
        worktreeId: w.worktreeId, projectKey: w.projectKey, ref: w.ref, commit: w.commit,
        path: w.path, createdAt: w.createdAt })) };
    },
    async remove_worktree(input) {
      const id = str(input.worktreeId);
      if (!id) throw new AskToolError('remove_worktree: worktreeId is required');
      try { await deps.worktrees.remove(id); return { ok: true }; } catch (err) { throw asToolError(err); }
    },
    async git(input) {
      const id = str(input.worktreeId);
      const wt = id ? deps.worktrees.get(id) : null;
      if (!wt) throw new AskToolError('git: worktree not found — open_worktree first');
      const v = deps.worktrees.validateGitArgs(input.args);
      if (!v.ok) throw new AskToolError(`git: ${v.error}`);
      const bad = protectedInArgs(v.args);
      if (bad) throw new AskToolError(`git: ${JSON.stringify(bad)} is a protected path — check out the ref and inspect it another way`);
      // `show <rev>:<path>` is a raw file dump — the read this tool does not serve
      // (blame/log -p/diff show a file's content WITH its path on every line).
      if (v.args[0] === 'show' && v.args.slice(1).some((a) => !a.startsWith('-') && a.includes(':'))) {
        throw new AskToolError('git show displays commits — a raw blob or tree is not readable through this tool');
      }
      await refuseBlobPositionals(wt.path, v.args);
      if (v.fetch) {
        const remotes = await deps.worktrees.runGit(wt.path, ['remote']);
        const names = remotes.ok ? remotes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
        const target = v.args.slice(1).find((a) => !a.startsWith('-'));
        if (target && !names.includes(target)) throw new AskToolError(`git: unknown remote ${JSON.stringify(target)} (configured: ${names.join(', ') || 'none'})`);
        if (!target && !v.args.includes('--all') && !names.length) throw new AskToolError('git: no remotes configured in this repository');
      }
      // Prepend the trusted hardening -c; add --no-ext-diff/--no-color ONLY to the
      // patch-capable subs (ls-files/ls-tree/grep reject --no-ext-diff). `grep` also
      // gets a forced `-H` so every match line carries its path for the LINE filter
      // below — belt-and-braces, since git-allowlist.mjs already refuses the forms
      // that would beat it (`-h`/`--heading`/`-z`, which win as the later flag).
      const argv = [...GIT_HARDEN, v.args[0], ...(v.args[0] === 'grep' ? ['-H'] : []), ...v.args.slice(1),
        ...(PATCH_CAPABLE.has(v.args[0]) ? ['--no-ext-diff', '--no-color'] : [])];
      const r = await deps.worktrees.runGit(wt.path, argv, { maxBytes: L.gitCaptureMaxBytes });
      // Row follows checkout/switch AND fetch (§5): fetch re-reads HEAD + stamps updated_at.
      if (r.ok && (v.nav || v.fetch)) {
        const positional = v.nav ? (v.args.filter((a) => !a.startsWith('-'))[1] ?? wt.ref) : wt.ref;
        await deps.worktrees.noteNav(id, { ref: positional });
      }
      // `grep` (no match) and `diff --exit-code` use exit 1 as DATA, not an error.
      const emptyOk = r.code === 1 && !((r.stderr || '').trim()) && (v.args[0] === 'grep' || v.args[0] === 'diff');
      if (!r.ok && !emptyOk) throw new AskToolError(`git: ${deps.redact((r.stderr || '').trim() || `exited ${r.code}`)}`);
      let body = r.stdout;
      // A merge's COMBINED diff (`diff --cc` / `diff --combined`, from `log -p --cc`,
      // `--diff-merges=combined|cc|dense-combined`, or a hostile repo's
      // `log.diffMerges` config) is NOT unified-diff shaped: splitUnifiedDiff cannot
      // section it, so `hasPatch` misses it and the protected-path filter would ship
      // a merged .env verbatim. Detected on the OUTPUT, so a config-driven combined
      // diff is caught too. Refuse rather than filter — the model inspects a parent.
      if (/(^|\n)diff --(cc|combined) /.test(body)) {
        throw new AskToolError('git: combined merge diffs cannot be filtered here — inspect a single parent (e.g. `diff <merge>^1 <merge>`)');
      }
      const hasPatch = /(^|\n)diff --git /.test(body);
      // (A `show` that names a blob/tree, or a `<rev>:<path>`, was refused BEFORE
      // the spawn — see refuseBlobPositionals — so a patch-less `show` here is a
      // legitimate commit view: `-s`, `--stat`, `--name-only`, `--format=`.)
      if (hasPatch) {
        // Protected-path section filter over ANY patch output (diff, show <commit>,
        // log -p). A section whose header opened but whose path is protected on
        // either side is dropped. A header-LESS section (a commit-message preamble,
        // which with `--stat` also carries the diffstat) is kept but LINE-filtered,
        // so a protected filename never surfaces there either. A colour-escaped or
        // external-diff dump has no parseable header, so `hasPatch` is false and it
        // never reaches here.
        const protectedSide = (p) => !!p && isProtectedBasename(p, deps.protectedPaths);
        body = splitUnifiedDiff(body)
          .filter((s) => s.member || !s.header || (!!s.path && !protectedSide(s.path) && !protectedSide(s.oldPath)))
          .map((s) => (s.member || s.header ? s.text : protectedLineFilter(s.text))).join('');
      } else if (LIST_SUBS.has(v.args[0]) || PATCH_CAPABLE.has(v.args[0])) {
        // grep/ls-files/ls-tree emit PATH LISTS, not diffs — the section filter would
        // drop ALL output. So do the patch-LESS forms of diff/log/show (`--stat`,
        // `--name-only`), whose diffstat names protected files with no `diff --git`
        // header; get_run_diff omits those files entirely, so this matches it.
        // Splitting on `[\s:]` alone left `id_rsa-3-KEY` as ONE token matching no
        // pattern, so an EXACT-name protected file's neighbouring lines leaked
        // (`.env*` only escaped that by its prefix glob) — hence every delimiter.
        body = protectedLineFilter(body);
      }
      const offset = clampInt(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
      const maxBytes = clampInt(input.maxBytes, 1, L.gitOutputMaxBytes, L.diffDefaultBytes);
      if (r.truncated) body += `\n[output capped at ${L.gitCaptureMaxBytes} bytes — narrow the command (a path, a range, -n <count>)]\n`;
      return { command: ['git', ...v.args].join(' '), ...(r.truncated ? { capped: true } : {}), ...sliceBytes(deps.redact(body), offset, maxBytes) };
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
