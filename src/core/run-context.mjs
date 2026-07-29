// src/core/run-context.mjs
// Generation of the run root's context: memory (§5.4), skills (§5.6), MCP (§5.5).
//
// A detached run's cwd is NOT the user's project (§5.3), so none of the context the
// CLI would normally discover by walking up from a project dir is reachable. This
// module assembles all of it from the members' REAL directories — a git worktree
// materializes only committed blobs (E6), so the real dirs are the only source of
// truth for uncommitted memory, skills, and `.mcp.json` — and writes:
//
//   <runRoot>/CLAUDE.md    neutrality preamble + rosters + inlined memory   (§5.4)
//   <runRoot>/mcp.json     merged MCP config, passed via --mcp-config       (§5.5)
//   <runRoot>/.claude/skills/  workspace-mode skill mount                   (§5.6)
//   <worktree>/.claude/skills/ single-mode skill mount (E4: the skills walk
//                              stops at a git root, so a run-root mount would
//                              be invisible from a worktree cwd)
//
// It is PURE of CLI behavior: no spawn of `claude`, no DB, no orchestrator state.
// Everything mode- or environment-dependent (projectsRoot, homeDir, platform) is an
// explicit input, so the whole module is unit-testable and deterministic. Given the
// same inputs it produces byte-identical output — which is what makes the resume
// path's re-assembly idempotent self-healing rather than a second, different run
// context (§5.2).
//
// ENOENT is a DEFINED outcome everywhere (§8.20): a missing file contributes
// nothing silently (absence is normal); a missing member directory degrades that
// member to worktree-only context with a named warning; a broken skill entry warns
// and skips. Assembly never throws on a missing source.
//
// ABSENCE AND FAILURE ARE NOT THE SAME THING. Only ENOENT/ENOTDIR are silent. A
// source that EXISTS but cannot be read (EACCES, EIO, …) is named in `warnings` —
// §5.5 source 3 spells out a "read error" clause and §8.16 is warn-by-name — and
// only then degrades like an absent one. Conflating the two would let a single
// `chmod` remove a member's entire MCP or memory contribution with the run still
// reporting success. Every reader takes an optional `onError` sink (see fsWarner).

import { readFile, writeFile, readdir, stat, mkdir, rm, cp, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname, basename, isAbsolute, sep } from 'node:path';

import { contextMaxBytesPerFile, contextMaxBytesTotal, skillMount, defaultRoot } from './settings.mjs';
import { readRunManifest, updateRunManifest } from './run-manifest.mjs';
import { isValidSkillName } from './skills.mjs';

/**
 * The `--allowedTools` grant shape this build emits for merged MCP servers.
 *
 * NOT a live probe — the value is burned in from the **Phase-0 V1 outcome**
 * (`docs/run-root-verification.md` § "V1 — MCP grant shape · PASS, branch (a)";
 * argv-attested transcript `phase0/out/v1a-rerun.jsonl` + `phase0/out/cmds.txt`):
 * with `--permission-mode acceptEdits` and `--mcp-config`, the server WILDCARD
 * `--allowedTools 'Read,Bash,mcp__zz-mcp-cfga'` made `mcp__zz-mcp-cfga__echo`
 * callable, while the negative control (no grant) was denied. That is §4.1's
 * outcome-table branch **(a) works** ⇒ one `mcp__<server>` grant per merged server,
 * and R1(b)/R2-MCP hold UNQUALIFIED (no degradation warning, no matrix qualifier).
 *
 * Under `'per-tool'` or `'none'` the orchestrator emits an EMPTY grant array and
 * preflight warns; neither branch is in play on this CLI version.
 * @type {'server'|'per-tool'|'none'}
 */
export const MCP_GRANT_MODE = 'server';

/** §5.4: `@import` recursion is capped at 4 levels (also what terminates a cycle). */
export const MAX_IMPORT_DEPTH = 4;

const CLAUDE_MD_FILE = 'CLAUDE.md';
const MCP_FILE = 'mcp.json';
const NO_MEMORY_PLACEHOLDER = '*(no CLAUDE.md found in this project)*';
/** §8.7: a run-log warning above 40 KB, independent of the (raisable) hard cap. */
const CONTEXT_SOFT_WARN_BYTES = 40960;

// ── tiny fs / string helpers ────────────────────────────────────────────────

const enc = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
/** Thousands separators without ICU (small-icu builds must format identically). */
const fmtNum = (n) => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * ABSENCE is the only normal failure in this module (§8.20): a missing file
 * contributes nothing, silently. ENOTDIR belongs here too — it is what a path
 * component that is a file (a member dir pointed at a regular file) reports, i.e.
 * "not there" by another name.
 *
 * Everything else — EACCES, EIO, EISDIR, ELOOP, EMFILE — is a REAL read failure, and
 * §5.5 source 3 ("on any shape mismatch, **read error**, or V4 failure") plus §8.16's
 * warn-by-name policy require a signal. Swallowing them would let one `chmod` quietly
 * delete a member's whole MCP or memory contribution with the run still reporting
 * success. The source then degrades EXACTLY as an absent one (contributes nothing,
 * the run proceeds), so §8.20's never-throw posture is untouched.
 */
const isAbsent = (err) => err?.code === 'ENOENT' || err?.code === 'ENOTDIR';

/**
 * A de-duplicating fs-error sink over a `warnings` array: at most one line per
 * (path, code) per assembly, so a source read twice cannot warn twice.
 * @param {string[]} warnings
 * @returns {(p:string, err:object)=>void}
 */
function fsWarner(warnings) {
  const seen = new Set();
  return (p, err) => {
    const code = err?.code || 'unknown error';
    const key = `${p}|${code}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(
      `\`${p}\` exists but could not be read (${code}); it contributes nothing to this ` +
      'run\'s context — fix its permissions and re-run to include it.',
    );
  };
}

// Every reader below takes an OPTIONAL `onError(path, err)` sink. Omitting it keeps
// the old silent-degrade behavior, which is correct for the two SPECULATIVE probes
// (pathLikeArg's "is this arg a path?" test and auditAncestors' walk to `/`): there,
// a stat failure is a question we could not answer about a path that may not be a
// file at all, not the loss of a declared context source.
async function isDir(p, onError) {
  try { return (await stat(p)).isDirectory(); }
  catch (err) { if (!isAbsent(err)) onError?.(p, err); return false; }
}
async function exists(p, onError) {
  try { await stat(p); return true; }
  catch (err) { if (!isAbsent(err)) onError?.(p, err); return false; }
}
async function readTextMaybe(p, onError) {
  try { return await readFile(p, 'utf8'); }
  catch (err) { if (!isAbsent(err)) onError?.(p, err); return null; }
}
async function readBytesMaybe(p, onError) {
  try { return await readFile(p); }
  catch (err) { if (!isAbsent(err)) onError?.(p, err); return null; }
}
/** readdir with the same contract. Absent => []; a real error warns and yields []. */
async function readdirMaybe(p, onError) {
  try { return await readdir(p, { withFileTypes: true }); }
  catch (err) { if (!isAbsent(err)) onError?.(p, err); return []; }
}

/** Truncate to `cap` BYTES without ever splitting a UTF-8 sequence. */
function truncateBytes(text, cap) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  if (buf.length <= cap) return String(text ?? '');
  let end = Math.max(0, cap);
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;   // back off continuation bytes
  return buf.subarray(0, end).toString('utf8');
}

/** Deterministic slug for rename prefixes (`<memberSlug>-<name>`). */
function slug(s) {
  const out = String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'member';
}

/** Key-sorted JSON, so "byte-identical definition" is order-independent. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const byProjectKey = (a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0);

/** `git -C dir <args>` stdout, or null. Sync + fail-safe (mirrors store.mjs). */
function gitOut(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch {
    return null;
  }
}

/** True when `child` is `parent` or below it (both resolved, no realpath games). */
function isUnder(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

// ── §5.4 memory discovery ───────────────────────────────────────────────────

/**
 * The ordered memory sources of ONE directory (§5.4): `CLAUDE.md`,
 * `.claude/CLAUDE.md`, `.claude/rules/*.md` (lexicographic), `CLAUDE.local.md`.
 * ENOENT-tolerant per source AND per directory (§8.20) — a missing dir yields [].
 * A REAL error (EACCES on the dir or on a candidate) is reported through `onError`
 * and that source is skipped; discovery never throws.
 * @param {string} dir
 * @param {(p:string, err:object)=>void} [onError]
 * @returns {Promise<Array<{path:string, rel:string}>>}
 */
export async function discoverMemorySources(dir, onError) {
  if (!dir || !(await isDir(dir, onError))) return [];
  const out = [];
  const add = async (rel) => {
    const abs = join(dir, rel);
    try { if ((await stat(abs)).isFile()) out.push({ path: abs, rel }); }
    catch (err) { if (!isAbsent(err)) onError?.(abs, err); }
  };
  await add(CLAUDE_MD_FILE);
  await add(join('.claude', CLAUDE_MD_FILE));
  const rules = (await readdirMaybe(join(dir, '.claude', 'rules'), onError))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
  for (const name of rules) await add(join('.claude', 'rules', name));
  await add('CLAUDE.local.md');
  return out;
}

/**
 * §8.21: the COMMITTED project sub-agents of one checkout — the `.md` files in
 * `<dir>/.claude/agents`, sorted. `dir` is a member's WORKTREE, which materializes
 * committed blobs only (E6), so this is exactly the set that WOULD be discoverable
 * if that checkout were the cwd — and worca-cc never injects `.claude/agents` (only
 * skills, which live at the run root in workspace mode), so there are no false
 * positives. ENOENT-tolerant like every other reader here: a project with no agents
 * yields []. Pure read; never throws. Exported for testing.
 * @param {string} dir
 * @param {(p:string, err:object)=>void} [onError]
 * @returns {Promise<string[]>}
 */
export async function discoverProjectAgents(dir, onError) {
  if (!dir) return [];
  return (await readdirMaybe(join(dir, '.claude', 'agents'), onError))
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

/**
 * §8.19: the COMMITTED project settings of one checkout — the top-level keys of
 * `<dir>/.claude/settings.json`. `dir` is a member's WORKTREE (committed blobs only,
 * E6), which is exactly the file the CLI WOULD have loaded back when a workspace
 * node's cwd was the config-source member's checkout; under §5.3 the cwd is the run
 * root, which has no project settings file, so nothing in it applies to any node.
 *
 * Returns `null` when there is no such file — absence is normal and silent (§8.20) —
 * and `{keys:null}` when the file EXISTS but does not parse: we cannot prove an
 * unreadable-shaped file carries nothing, so the caller still warns. Never throws.
 * Exported for testing.
 * @param {string} dir
 * @param {(p:string, err:object)=>void} [onError]
 * @returns {Promise<{file:string, keys:string[]|null}|null>}
 */
export async function discoverProjectSettings(dir, onError) {
  if (!dir) return null;
  const file = join(dir, '.claude', 'settings.json');
  const body = await readTextMaybe(file, onError);
  if (body === null) return null;                       // absent, or unreadable + already named
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { file, keys: null };
    return { file, keys: Object.keys(parsed).sort() };
  } catch {
    return { file, keys: null };
  }
}

// ── §5.4 `@import` resolution ───────────────────────────────────────────────

// `@path` only counts at the start of a line or after whitespace, so `foo@bar`
// (an email, a scoped npm range) is never mistaken for an import. A FRESH regex per
// scan is mandatory: resolution recurses (inline -> walk -> resolveSegment), and a
// shared /g literal's mutable lastIndex would be reset by the nested call and spin
// the outer loop forever.
const importRe = () => /(^|\s)@([^\s`]+)/g;

/**
 * Resolve `@path` imports RECURSIVELY and inline their content (§5.4). Relative to
 * the containing file, `~` expanded against `homeDir`, capped at MAX_IMPORT_DEPTH
 * levels (which is also what terminates an import cycle), skipping fenced code
 * blocks and inline code spans. Worca CC resolving imports itself is what sidesteps
 * E7's VERIFIED negative (an import resolving outside the working dir is silently
 * dead headless) with no import rewriting at all.
 *
 * Unresolvable imports are LEFT AS LITERAL TEXT and reported, never dropped.
 * @param {string} text
 * @param {string} containingFile  absolute path the relative specs resolve against
 * @param {number} [depth]         current nesting level (0 for a top-level file)
 * @param {{homeDir?:string}} [opts]
 * @returns {Promise<{text:string, unresolved:string[]}>}
 */
export async function resolveImports(text, containingFile, depth = 0, { homeDir = '' } = {}) {
  const unresolved = [];

  const inline = async (spec, file, d) => {
    if (d >= MAX_IMPORT_DEPTH) {
      unresolved.push(`@${spec} not inlined: the @import depth cap of ${MAX_IMPORT_DEPTH} was reached`);
      return `@${spec}`;
    }
    const target = spec.startsWith('~')
      ? join(homeDir || '', spec.slice(1).replace(/^[/\\]/, ''))
      : isAbsolute(spec) ? spec : resolve(dirname(file), spec);
    // An import that is merely absent and one that exists-but-is-unreadable are
    // both left literal, but they are DIFFERENT operator problems, so the reported
    // reason says which (the sink appends the errno for the second case).
    let reason = '';
    const body = await readTextMaybe(target, (_p, err) => { reason = ` — ${err?.code || err?.message}`; });
    if (body === null) {
      unresolved.push(`@${spec} could not be resolved (looked at ${target})${reason}`);
      return `@${spec}`;
    }
    return walk(body, target, d + 1);
  };

  const resolveSegment = async (seg, file, d) => {
    if (!seg.includes('@')) return seg;
    let out = '';
    let last = 0;
    const re = importRe();
    let m;
    while ((m = re.exec(seg)) !== null) {
      out += seg.slice(last, m.index) + m[1];
      last = m.index + m[0].length;
      out += await inline(m[2], file, d);
    }
    return out + seg.slice(last);
  };

  const resolveLine = async (line, file, d) => {
    // Odd indices are inline code spans — never imports.
    const parts = String(line).split(/(`[^`]*`)/);
    for (let i = 0; i < parts.length; i += 2) parts[i] = await resolveSegment(parts[i], file, d);
    return parts.join('');
  };

  async function walk(body, file, d) {
    const lines = String(body ?? '').split('\n');
    const out = [];
    let fenced = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; out.push(line); continue; }
      out.push(fenced ? line : await resolveLine(line, file, d));
    }
    return out.join('\n');
  }

  return { text: await walk(text, containingFile, depth), unresolved };
}

// ── §5.6 skills assembly ────────────────────────────────────────────────────

/** Rewrite a SKILL.md frontmatter `name:` so it matches the mounted directory (V2). */
function rewriteSkillName(text, name) {
  const s = String(text ?? '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(s);
  if (!m) return null;                                   // no frontmatter: leave the file alone
  const body = m[1];
  const next = /^name:[ \t]*.*$/m.test(body)
    ? body.replace(/^name:[ \t]*.*$/m, `name: ${name}`)
    : `name: ${name}\n${body}`;
  return s.slice(0, m.index) + `---\n${next}\n---` + s.slice(m.index + m[0].length);
}

/** Top-level entry names tracked under `.claude/skills` in a checkout (§5.6 guard). */
function trackedSkillNames(worktreeDir) {
  if (!worktreeDir) return new Set();
  const out = gitOut(worktreeDir, ['ls-files', '--', join('.claude', 'skills')]);
  if (!out) return new Set();
  const prefix = `${join('.claude', 'skills')}/`;
  return new Set(
    out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith(prefix))
      .map((l) => l.slice(prefix.length).split('/')[0]).filter(Boolean),
  );
}

/** Candidate skill entries of one `<dir>/.claude/skills`, sorted, ENOENT-tolerant. */
async function skillCandidates(dir, onError) {
  return (await readdirMaybe(join(dir, '.claude', 'skills'), onError))
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, source: join(dir, '.claude', 'skills', name) }));
}

/**
 * Mount every skill entry into ONE target `.claude/skills` dir (§5.6).
 *
 * Entry order IS the collision-precedence order: (1) each member's real dir,
 * members sorted by projectKey; (2) `<projectsRoot>/.claude/skills` (skipped in the
 * home special case — E4 puts `~/.claude/skills` on the scan path regardless of
 * cwd); (3) `requiresSkills` resolutions whose source is `bundle` / `plugin:*`.
 * First occupant keeps the bare name; later occupants are renamed by SOURCE CLASS
 * (`<memberSlug>-`, `root-`, `worca-cc-`) with a deterministic numeric tiebreak, and
 * their SKILL.md frontmatter `name:` is rewritten to match (gated on V2, PASSED).
 * Dropping is forbidden — R2 requires the skills of ALL members.
 *
 * Delivery is a COPY by default (isolation: an agent edit lands in the disposable
 * tree, not the user's live checkout); `skillMount:'symlink'` is the opt-in
 * write-through variant (E12). A RENAMED entry always falls back to a copy even
 * under symlink mode, because the frontmatter rewrite would otherwise mutate the
 * user's real source file.
 *
 * @returns {Promise<{names:string[], records:Array<object>, renames:Record<string,string>,
 *                    roster:Array<object>, warnings:string[]}>}
 */
export async function assembleSkills({
  target, members = [], projectsRoot, resolutions, homeDir,
  mount = 'copy', trackedNames = new Set(), skipRoot = false,
}) {
  const warnings = [];
  const onError = fsWarner(warnings);        // ENOENT stays silent; a real error is named
  const names = [];
  const records = [];
  const renames = {};
  const roster = [];

  /** @type {Array<{name:string, source:string, cls:'member'|'root'|'worca-cc', prefix:string, origin:string}>} */
  const candidates = [];
  for (const m of [...members].sort(byProjectKey)) {
    for (const c of await skillCandidates(m.projectDir, onError)) {
      candidates.push({
        ...c, cls: 'member', prefix: `${slug(m.projectName || m.projectKey)}-`,
        origin: `${m.projectName || m.projectKey} (repos/${m.projectKey})`,
      });
    }
  }
  // Entry class 2 is skipped in the home special case: E4 puts `~/.claude/skills` on
  // the scan path regardless of cwd, so copying it would only duplicate names.
  const rootIsHome = skipRoot ||
    (!!projectsRoot && !!homeDir && resolve(projectsRoot) === resolve(homeDir));
  if (!rootIsHome && projectsRoot) {
    for (const c of await skillCandidates(projectsRoot, onError)) {
      candidates.push({ ...c, cls: 'root', prefix: 'root-', origin: `root layer \`${projectsRoot}\`` });
    }
  }
  for (const [name, r] of resolutionEntries(resolutions)) {
    // S2 (the manifest-rehydration half). On a resume these entries come off DISK
    // (`run.json.skillResolutions`) and `name` becomes a path segment in
    // `join(target, effective)` below — a corrupt or hand-edited manifest must not
    // turn the mount into a write-anywhere primitive. §8.20 posture: SKIP the entry
    // and NAME it; a throw here would make a paused run unresumable. The loud half
    // lives at the other choke point (validateSkills, skills.mjs), where the name
    // is still the author's to fix.
    if (!isValidSkillName(name)) {
      warnings.push(
        `skill resolution ${JSON.stringify(name)} was skipped: invalid skill name. A skill name ` +
        'becomes a directory under `.claude/skills/`, so it may contain only letters, digits, `.`, ' +
        '`_` and `-` — this entry (from `run.json`) was not mounted.',
      );
      continue;
    }
    const src = String(r?.source || '');
    if (src !== 'bundle' && !src.startsWith('plugin:')) continue;   // already on the scan path
    if (!r?.path) continue;
    candidates.push({ name, source: r.path, cls: 'worca-cc', prefix: 'worca-cc-', origin: `worca-cc ${src}` });
  }

  // Tracked names occupy the namespace: a rename may never land on one either.
  const taken = new Set(trackedNames);

  for (const cand of candidates) {
    if (trackedNames.has(cand.name)) {
      warnings.push(
        `skill \`${cand.name}\` is tracked in the checkout — keeping the project's own committed ` +
        `version and skipping the mount from \`${cand.source}\`.`,
      );
      continue;
    }
    let effective = cand.name;
    if (taken.has(effective)) {
      const base = `${cand.prefix}${cand.name}`;
      effective = base;
      for (let n = 2; taken.has(effective); n++) effective = `${base}-${n}`;
    }
    const renamed = effective !== cand.name;
    const dest = join(target, effective);
    // Symlink mode cannot carry a rename: the frontmatter rewrite would land in the
    // user's real source file. Renamed entries therefore stay copies.
    const asLink = mount === 'symlink' && !renamed;
    try {
      const st = await stat(cand.source);                 // follows symlinks: a dangling one throws
      if (!st.isDirectory()) continue;                    // not a skill entry; silently ignored
      await mkdir(target, { recursive: true });
      await rm(dest, { recursive: true, force: true });    // idempotent re-assembly (§5.2)
      if (asLink) await symlink(cand.source, dest);
      else await cp(cand.source, dest, { recursive: true, force: true, dereference: true });
    } catch (err) {
      warnings.push(`skill \`${cand.name}\` could not be mounted from \`${cand.source}\`: ${err?.message || err}`);
      continue;
    }
    if (renamed) {
      const file = join(dest, 'SKILL.md');
      const body = await readTextMaybe(file, onError);
      const next = body === null ? null : rewriteSkillName(body, effective);
      if (next !== null) await writeFile(file, next, 'utf8');
      renames[effective] = cand.name;
    }
    taken.add(effective);
    names.push(effective);
    records.push({
      path: join('.claude', 'skills', effective),
      source: cand.source,
      kind: 'skill',
      ...(asLink ? { mount: 'symlink' } : {}),
    });
    roster.push({ name: effective, origin: cand.origin, renamedFrom: renamed ? cand.name : null });
  }

  if (mount === 'symlink' && names.length) {
    warnings.push(
      'skillMount is set to `symlink`: mounted skills are WRITE-THROUGH, so an agent edit to a ' +
      "skill lands in your real directory and appears in no run diff. Set `skillMount: 'copy'` " +
      'to restore isolation.',
    );
  }
  return { names, records, renames, roster, warnings };
}

/** Accept the resolutions map as a Map (fresh run) or a plain object (from run.json). */
function resolutionEntries(resolutions) {
  if (resolutions instanceof Map) return [...resolutions.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (resolutions && typeof resolutions === 'object') {
    return Object.keys(resolutions).sort().map((k) => [k, resolutions[k]]);
  }
  return [];
}

// ── §5.5 MCP merge ──────────────────────────────────────────────────────────

/** Collapse `__` runs so `mcp__<server>__<tool>` can never mis-split (§5.5, §7.1). */
function normalizeServerName(raw) {
  const n = String(raw ?? '').replace(/__+/g, '_').replace(/^_+|_+$/g, '');
  return n || 'mcp-server';
}

/**
 * Read one `.mcp.json`-shaped file. Absence is SILENT (`{servers:null}` with neither
 * error set — a member with no config is normal). A real read failure surfaces as
 * `readError` and an unparseable body as `parseError`, so the caller can warn by name
 * for both instead of treating "unreadable" as "absent" (§5.5, §8.16).
 * @returns {Promise<{servers:object|null, parseError:string|null, readError:string|null}>}
 */
async function readMcpFile(file) {
  let readError = null;
  const text = await readTextMaybe(file, (_p, err) => { readError = err?.code || err?.message || 'read failed'; });
  if (text === null) return { servers: null, parseError: null, readError };
  let data;
  try { data = JSON.parse(text); }
  catch (err) { return { servers: null, parseError: err?.message || 'invalid JSON', readError: null }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { servers: null, parseError: 'not a JSON object', readError: null };
  }
  const raw = data.mcpServers ?? data;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { servers: null, parseError: null, readError: null };
  const servers = {};
  for (const [k, v] of Object.entries(raw)) if (v && typeof v === 'object' && !Array.isArray(v)) servers[k] = v;
  return { servers, parseError: null, readError: null };
}

/** Is `s` a path (to absolutize against `dir`) rather than a flag/subcommand/URL? */
async function pathLikeArg(s, dir) {
  if (typeof s !== 'string' || !s || s.startsWith('-')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return false;      // url
  if (isAbsolute(s)) return false;                                 // already absolute
  if (s.startsWith('./') || s.startsWith('../') || s.includes('/')) return true;
  // SPECULATIVE probe, so no error sink: `server.js` next to the config IS a path,
  // `serve` is a subcommand. A stat failure only means "assume not a path" — warning
  // about a string that may not be a filename at all would be pure noise.
  return exists(join(dir, s));
}

/**
 * Apply §5.5's transforms to ONE server definition, against its source dir.
 * Returns `{ def, warnings }`. `env` / `type` / `url` / `headers` pass through —
 * the CLI expands `${VAR}` / `${VAR:-default}` itself (E5).
 */
async function transformServer(name, raw, dir, platform) {
  const warnings = [];
  const sub = (v) => (typeof v === 'string' ? v.split('${CLAUDE_PROJECT_DIR}').join(dir) : v);
  const def = {};
  for (const [k, v] of Object.entries(raw)) {
    def[k] = Array.isArray(v)
      ? v.map(sub)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([ek, ev]) => [ek, sub(ev)]))
        : sub(v);
  }

  // Detect the "needs a project cwd" shape BEFORE absolutization erases it.
  const rawCommand = typeof raw.command === 'string' ? sub(raw.command) : null;
  const relCommand = !!rawCommand && !isAbsolute(rawCommand) && await pathLikeArg(rawCommand, dir);
  const declaredCwd = typeof def.cwd === 'string' && def.cwd ? resolve(dir, def.cwd) : null;
  const needsCwd = relCommand || !!declaredCwd;

  if (rawCommand && relCommand) def.command = resolve(dir, rawCommand);
  if (Array.isArray(def.args)) {
    const args = [];
    for (const a of def.args) args.push((await pathLikeArg(a, dir)) ? resolve(dir, a) : a);
    def.args = args;
  }
  if (declaredCwd) def.cwd = declaredCwd;

  if (needsCwd && typeof def.command === 'string') {
    if (platform === 'win32') {
      // /bin/sh does not exist on Windows, so the wrap is unavailable. Include the
      // server un-wrapped and name the remedy (§5.5 platform scope, §8.16).
      warnings.push(
        `server \`${name}\` declares a project cwd; the POSIX cd-wrap is unavailable on Windows, ` +
        'so it may fail to spawn — make its command path-independent or run worca under WSL.',
      );
    } else {
      // ARGV-SAFE: $1 is the dir, "$@" the original command + args. Every element
      // stays a distinct argv slot, so no path content (spaces, quotes) is ever
      // re-parsed by a shell.
      const original = [def.command, ...(Array.isArray(def.args) ? def.args : [])];
      def.command = '/bin/sh';
      def.args = ['-c', 'cd "$1" && shift && exec "$@"', 'worca-cc-cd-wrap', declaredCwd || dir, ...original];
    }
  }
  return { def, warnings };
}

/**
 * Merge every reachable MCP server into ONE config object (§5.5).
 *
 * Pinned global read order — which also fixes who is "first occupant" on a name
 * collision: for each member in sorted-projectKey order, that member's PROJECT
 * scope then its LOCAL scope; after all members, the ROOT layer once, LAST (so a
 * root server never silently claims a name a member also uses).
 *
 * @returns {Promise<{servers:Record<string,object>, renames:{mcpServers:Record<string,string>},
 *                    roster:Array<object>, nativeOnly:string[], warnings:string[]}>}
 *   `nativeOnly` are names whose generated definition was SKIPPED because the
 *   committed `.mcp.json` at cwd carries a byte-identical one; they are still
 *   effective in the session, so the caller must still grant them.
 */
export async function mergeMcpConfigs({
  members = [], projectsRoot, homeDir, isWorkspace = false, platform = process.platform,
}) {
  const warnings = [];
  const onError = fsWarner(warnings);        // ENOENT stays silent; a real error is named
  const servers = {};
  const renames = {};
  const roster = [];
  const nativeOnly = [];
  /** base name -> [{ effective, hash }] so a redundant later copy is de-duped, not renamed. */
  const byBase = new Map();
  const taken = new Set();

  const sorted = [...members].sort(byProjectKey);

  // ── the pinned source list ────────────────────────────────────────────────
  /** @type {Array<{cls:'member'|'root', member?:object, dir:string, scope:'project'|'local'}>} */
  const sources = [];
  for (const m of sorted) {
    sources.push({ cls: 'member', member: m, dir: m.projectDir, scope: 'project' });
    sources.push({ cls: 'member', member: m, dir: m.projectDir, scope: 'local' });
  }
  if (projectsRoot) sources.push({ cls: 'root', dir: projectsRoot, scope: 'project' });

  // ── single-mode cross-scope map: what the WORKTREE's committed .mcp.json says ──
  // In single mode cwd is the worktree, so a committed `.mcp.json` materializes
  // there and is discovered natively (E6 makes that copy stale by design). V3(d)
  // recorded that the `--mcp-config` definition WINS (the native server's process
  // is never even spawned), so the generated entry is always the effective one.
  const committedByMember = new Map();
  if (!isWorkspace) {
    for (const m of sorted) {
      if (!m.worktreeDir) continue;
      const committedFile = join(m.worktreeDir, '.mcp.json');
      const { servers: cs, parseError, readError } = await readMcpFile(committedFile);
      // Without the committed side we cannot run the V3(d) comparison at all, so an
      // unreadable/unparseable one is named rather than silently treated as absent.
      if (readError) onError(committedFile, { code: readError });
      else if (parseError) warnings.push(`\`${committedFile}\` could not be parsed (${parseError}); the cross-scope duplicate check (V3(d)) was skipped for this member.`);
      if (!cs) continue;
      const map = new Map();
      for (const [k, v] of Object.entries(cs)) map.set(normalizeServerName(k), stableStringify(v));
      committedByMember.set(m.projectKey, map);
    }
  }

  let localStore;            // parsed ~/.claude.json, read once
  let localStoreError = null;

  for (const src of sources) {
    /** @type {Record<string, object>|null} */
    let raw = null;
    if (src.scope === 'project') {
      const file = join(src.dir, '.mcp.json');
      const { servers: s, parseError, readError } = await readMcpFile(file);
      if (readError) { onError(file, { code: readError }); continue; }
      if (parseError) {
        warnings.push(`\`${file}\` could not be parsed (${parseError}); its MCP servers are not delivered.`);
        continue;
      }
      raw = s;
    } else {
      // §5.5 source 3 (V4): local scope is the DEFAULT scope of `claude mcp add`, so
      // it is the most common per-project configuration and is never skipped
      // silently. V4 CORRECTION: `projects[<key>]` is keyed by the GIT ROOT
      // containing the path, not the path itself — the CLI's "[project: …]" line
      // reports cwd but the write lands under `git rev-parse --show-toplevel`. A
      // member pointed at a repo SUBDIRECTORY would otherwise harvest nothing,
      // silently, which is exactly what §5.5 forbids.
      const m = src.member;
      if (localStore === undefined) {
        // ABSENT means the CLI was never run here — normal, silent. EXISTS-BUT-
        // UNREADABLE is §5.5's explicit "read error" clause: it must warn by member,
        // because otherwise one `chmod` silently removes every user's local-scope
        // servers (the DEFAULT scope of `claude mcp add`) with the run still green.
        let readError = null;
        const text = await readTextMaybe(
          join(homeDir || '', '.claude.json'),
          (_p, err) => { readError = `read failed: ${err?.code || err?.message}`; },
        );
        if (text === null) { localStore = null; localStoreError = readError; }
        else {
          try {
            const parsed = JSON.parse(text);
            localStore = parsed && typeof parsed === 'object' ? parsed : null;
            if (!localStore) localStoreError = 'not a JSON object';
          } catch (err) { localStore = null; localStoreError = err?.message || 'invalid JSON'; }
        }
      }
      if (localStore === null) {
        if (localStoreError) warnings.push(localScopeWarning(m, homeDir, localStoreError));
        continue;
      }
      const projects = localStore.projects;
      if (!projects || typeof projects !== 'object' || Array.isArray(projects)) {
        warnings.push(localScopeWarning(m, homeDir, 'no `projects` object'));
        continue;
      }
      const key = gitOut(m.projectDir, ['rev-parse', '--show-toplevel']) || resolve(m.projectDir);
      const entry = projects[key] ?? projects[resolve(m.projectDir)];
      if (!entry || typeof entry !== 'object') continue;              // no local config: normal
      if (entry.mcpServers === undefined) continue;                   // normal
      if (!entry.mcpServers || typeof entry.mcpServers !== 'object' || Array.isArray(entry.mcpServers)) {
        warnings.push(localScopeWarning(m, homeDir, 'unexpected shape'));
        continue;
      }
      raw = {};
      for (const [k, v] of Object.entries(entry.mcpServers)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) raw[k] = v;
      }
    }
    if (!raw || !Object.keys(raw).length) continue;

    const originLabel = src.cls === 'root'
      ? `root layer \`${join(src.dir, '.mcp.json')}\``
      : `${src.member.projectName || src.member.projectKey} (${src.scope} scope)`;
    const prefix = src.cls === 'root' ? 'root-' : `${slug(src.member.projectName || src.member.projectKey)}-`;

    for (const rawName of Object.keys(raw).sort()) {
      const base = normalizeServerName(rawName);
      const { def, warnings: tw } = await transformServer(base, raw[rawName], src.dir, platform);
      for (const w of tw) warnings.push(w);
      const hash = stableStringify(def);

      // Cross-scope duplicate (single mode, member sources only) — V3(d).
      const committed = src.cls === 'member' ? committedByMember.get(src.member.projectKey) : null;
      if (committed && committed.has(base)) {
        if (committed.get(base) === stableStringify(raw[rawName])) {
          if (!nativeOnly.includes(base) && !taken.has(base)) {
            nativeOnly.push(base);
            taken.add(base);
            roster.push({
              name: base, origin: `${originLabel} — identical to the committed \`.mcp.json\` at cwd`,
              renamedFrom: null,
            });
          }
          continue;                                       // nothing to disambiguate
        }
        warnings.push(
          `server \`${base}\` is defined both in the committed \`.mcp.json\` and in your working ` +
          'copy; V3(d) recorded **config** scope as effective for this CLI version, so the ' +
          'generated definition is the one that runs.',
        );
      }

      // Byte-identical definition already delivered under this base name? de-dup.
      const seen = byBase.get(base) || [];
      if (seen.some((e) => e.hash === hash)) continue;

      let effective = base;
      if (taken.has(effective)) {
        const renameBase = normalizeServerName(`${prefix}${base}`);
        effective = renameBase;
        for (let n = 2; taken.has(effective); n++) effective = `${renameBase}-${n}`;
      }
      if (effective !== rawName) renames[effective] = rawName;        // incl. `__`-normalization
      servers[effective] = def;
      taken.add(effective);
      byBase.set(base, [...seen, { effective, hash }]);
      roster.push({ name: effective, origin: originLabel, renamedFrom: effective === base ? null : base });
    }
  }

  return { servers, renames: { mcpServers: renames }, roster, nativeOnly, warnings };
}

function localScopeWarning(member, homeDir, why) {
  return (
    `member \`${member.projectKey}\`: local-scope MCP servers could not be read from ` +
    `\`${join(homeDir || '~', '.claude.json')}\` (${why}); promote them to ` +
    `\`${join(member.projectDir, '.mcp.json')}\` to guarantee delivery.`
  );
}

// ── §8.6 ancestor audit ─────────────────────────────────────────────────────

/**
 * Every `CLAUDE.md` / `.claude/skills` between `<runRoot>`'s PARENT and `/` (§8.6).
 * The CLAUDE.md walk crosses git roots all the way up (E1 VERIFIED), so anything
 * found here loads into every node of the run. Worca CC never creates such a file
 * above a run root; this makes a pre-existing one visible instead of mysterious.
 * @returns {Promise<string[]>} warnings
 */
export async function auditAncestors(runRoot) {
  const warnings = [];
  if (!runRoot) return warnings;
  let dir = dirname(resolve(runRoot));
  const seen = new Set();
  while (dir && !seen.has(dir)) {
    seen.add(dir);
    const md = join(dir, CLAUDE_MD_FILE);
    if (await exists(md)) {
      warnings.push(`ancestor memory found at \`${md}\` — it loads into every node of this run (§8.6).`);
    }
    const sk = join(dir, '.claude', 'skills');
    if (await isDir(sk)) {
      warnings.push(`ancestor skills found at \`${sk}\` — they are visible to this run (§8.6).`);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return warnings;
}

// ── §5.4 the generated document ─────────────────────────────────────────────

/**
 * Compose `<runRoot>/CLAUDE.md` (§5.4) from already-capped sources plus the run
 * rosters, applying the TOTAL byte budget. When that budget binds, the roster and
 * preamble are trimmed BEFORE any project memory — instructions are never
 * sacrificed to metadata (§5.4 (ii) / §8.7).
 *
 * Deterministic: no timestamps in the body; the pipelineId in the title is the only
 * run-specific token.
 * @returns {{text:string, warnings:string[]}}
 */
export function generateClaudeMd({
  pipelineId, projectsRoot, members = [], graphInstructions,
  rootSections = [], memberSections = new Map(),
  skills = [], servers = [], projectAgents, maxBytesTotal = Infinity,
}) {
  const warnings = [];
  const gi = (key) => (graphInstructions instanceof Map ? graphInstructions.get(key) : graphInstructions?.[key]) || '';
  // §8.21 carriers: `projectKey -> [agent file names]`, empty on single-project and
  // legacy runs (nothing is lost there), so their generated docs are unchanged.
  const agentsOf = (key) => {
    const v = projectAgents instanceof Map ? projectAgents.get(key) : projectAgents?.[key];
    return Array.isArray(v) ? v : [];
  };
  const agentCarriers = [...members].sort(byProjectKey).filter((m) => agentsOf(m.projectKey).length);

  const meta = [];
  meta.push(`# Worca CC run ${pipelineId}`, '');
  meta.push(
    'You are working in a **worca-cc run root**. All code edits happen inside ' +
    '`repos/<projectKey>`, one git checkout per project below; the run root holds run ' +
    "metadata only. This file is generated per run from those projects' real " +
    'directories — do not edit it.',
    '',
  );
  meta.push('## Run layout', '');
  meta.push('- `repos/<projectKey>/` — one git worktree per project in this run. **All code edits happen here.**');
  meta.push('- `CLAUDE.md` (this file) — the generated context for the run.');
  meta.push('- `mcp.json` — the merged MCP server config passed to this session.');
  meta.push('- `run.json` — the run manifest (members, mounts, byte budget, warnings).');
  meta.push('');
  meta.push('## Projects in this run', '');
  if (!members.length) meta.push('*(none)*', '');
  for (const m of [...members].sort(byProjectKey)) {
    meta.push(`- \`repos/${m.projectKey}\` — **${m.projectName || m.projectKey}**`);
    meta.push(`  - real directory: \`${m.projectDir}\``);
    if (m.branch) meta.push(`  - branch: \`${m.branch}\``);
    if (m.checkpointRef) meta.push(`  - checkpoint: \`${m.checkpointRef}\``);
    const instruction = gi(m.projectKey).trim();
    if (instruction) meta.push(`  - graph: ${instruction.split('\n').join('\n    ')}`);
    const agents = agentsOf(m.projectKey);
    if (agents.length) meta.push(`  - project sub-agents NOT discoverable this run: ${agents.join(', ')}`);
  }
  meta.push('');
  // §8.21: the same loss, stated once as a labeled note beside the roster, so the model
  // never tries a `subagent_type` that cannot resolve. Absent entirely when no member
  // carries committed agents.
  if (agentCarriers.length) {
    meta.push('## Project sub-agents NOT in force', '');
    meta.push(
      'Your cwd is this run root, so **no member project\'s `.claude/agents` is discoverable ' +
      'by name** — a `subagent_type` naming one would fail to resolve:',
      '',
    );
    for (const m of agentCarriers) {
      meta.push(`- **${m.projectName || m.projectKey}** (\`repos/${m.projectKey}\`): ${agentsOf(m.projectKey).join(', ')}`);
    }
    meta.push('');
    meta.push('Your personal `~/.claude/agents` still work (inherited environment); for anything ' +
      'else use `"general-purpose"` (or `"Explore"` for pure code search).', '');
  }
  meta.push('## Skills mounted for this run', '');
  if (!skills.length) meta.push('*(none)*');
  for (const s of skills) {
    meta.push(`- \`${s.name}\` — from ${s.origin}${s.renamedFrom ? ` (renamed from \`${s.renamedFrom}\`)` : ''}`);
  }
  meta.push('');
  meta.push('## MCP servers merged for this run', '');
  meta.push(
    'MCP tools are deferred behind tool search in headless mode: search for ' +
    '`mcp__<server>__<tool>` before calling it.',
    '',
  );
  if (!servers.length) meta.push('*(none)*');
  for (const s of servers) {
    meta.push(`- \`${s.name}\` — from ${s.origin}${s.renamedFrom ? ` (renamed from \`${s.renamedFrom}\`)` : ''}`);
  }
  const metaText = `${meta.join('\n')}\n`;
  const minimalMeta =
    `# Worca CC run ${pipelineId}\n\n` +
    'All code edits happen inside `repos/<projectKey>`; the run root holds run metadata only.\n';

  // ── memory block ────────────────────────────────────────────────────────
  const mem = [];
  if (rootSections.length) {
    mem.push(`## Root instructions (${projectsRoot})`, '');
    for (const s of rootSections) mem.push(`### ${s.rel}`, '', s.text.replace(/\s+$/, ''), '');
  }
  for (const m of [...members].sort(byProjectKey)) {
    mem.push(`## Project: ${m.projectName || m.projectKey} — repos/${m.projectKey}`, '');
    const sections = memberSections.get(m.projectKey) || [];
    if (!sections.length) mem.push(NO_MEMORY_PLACEHOLDER, '');
    for (const s of sections) mem.push(`### ${s.rel}`, '', s.text.replace(/\s+$/, ''), '');
  }
  let memText = mem.length ? `${mem.join('\n')}\n` : '';

  // ── total budget ────────────────────────────────────────────────────────
  let head = metaText;
  const cap = Number.isFinite(maxBytesTotal) ? maxBytesTotal : Infinity;
  if (enc(head) + enc(memText) > cap) {
    warnings.push(
      `generated run context is ${fmtNum(enc(head) + enc(memText))} bytes, above the ` +
      `${fmtNum(cap)}-byte contextMaxBytesTotal budget; the run roster/preamble was trimmed ` +
      'before any project memory — raise contextMaxBytesTotal to keep the roster whole.',
    );
    const metaBudget = Math.max(0, cap - enc(memText));
    head = enc(minimalMeta) <= metaBudget ? minimalMeta : truncateBytes(minimalMeta, metaBudget);
    if (enc(memText) > cap) {
      const marker = `\n*[worca: context truncated at ${fmtNum(cap)} bytes — raise contextMaxBytesTotal]*\n`;
      head = '';
      memText = truncateBytes(memText, Math.max(0, cap - enc(marker))) + marker;
    }
  }
  const text = head && memText ? `${head}\n${memText}` : head || memText;
  return { text, warnings };
}

// ── the public entry point ──────────────────────────────────────────────────

/**
 * Assemble the whole run context at `<runRoot>` (§5.2 step 7 order: skills →
 * mcp.json → CLAUDE.md → run.json).
 *
 * @param {object} a
 * @param {string} a.runRoot                     `<worcaHome>/runs/<pipelineId>`
 * @param {Array<{projectKey:string, projectName:string, projectDir:string, worktreeDir:string}>} a.members
 *        `projectDir` is the REAL dir (E6: only it carries uncommitted context).
 * @param {string} a.projectsRoot                §5.1 root context layer
 * @param {boolean} a.isWorkspace
 * @param {Map<string,object>|object} a.requiredSkillResolutions
 *        From validateSkills() — MAY BE EMPTY, which is every shipped workflow
 *        today (`grep requiresSkills agents/` → zero hits). On resume this arrives
 *        as the plain object persisted in `run.json.skillResolutions`.
 * @param {Map<string,string>|object} a.graphInstructions   per-member graph instruction
 * @param {string} a.homeDir
 * @param {string} [a.platform]                  injectable for the win32 branch
 * @returns {Promise<object>} the run-context record (also persisted into run.json)
 */
export async function assembleRunContext({
  runRoot, members = [], projectsRoot, isWorkspace = false,
  requiredSkillResolutions, graphInstructions, homeDir, platform = process.platform,
}) {
  const warnings = [];
  // ENOENT/ENOTDIR stay silent (absence is normal, §8.20); every OTHER fs error on a
  // declared context source is named here, once per (path, code), and the source
  // degrades exactly as an absent one.
  const onError = fsWarner(warnings);
  const pipelineId = basename(resolve(runRoot));
  // Each cap is read ONCE per assembly: a malformed persisted value warns on every
  // read, so a per-source read would print the same warning N times (Phase 2 note).
  const maxBytesPerFile = contextMaxBytesPerFile();
  const maxBytesTotal = contextMaxBytesTotal();
  const mount = skillMount();

  const sorted = [...members].sort(byProjectKey);
  await mkdir(runRoot, { recursive: true });

  // §8.20: a nonexistent projectsRoot (reachable through the unvalidated env tier,
  // §5.1) contributes nothing and warns ONCE — not once per read.
  const rootUsable = !!projectsRoot && (await isDir(projectsRoot, onError));
  if (projectsRoot && !rootUsable) {
    warnings.push(
      `projects root \`${projectsRoot}\` does not exist or could not be read — the root ` +
      'context layer (memory, skills, MCP) contributes nothing to this run.',
    );
  }
  // The home special case: `<projectsRoot>/.claude/*` IS user scope, which loads
  // natively from the inherited environment regardless of cwd (E11) and is
  // therefore never inlined or copied (§5.4, §5.6).
  const rootIsHome = !!projectsRoot &&
    (resolve(projectsRoot) === resolve(homeDir || '') || resolve(projectsRoot) === resolve(defaultRoot()));

  // §8.20: a member real dir deleted or moved (typically while the run sat paused)
  // degrades that member to worktree-only context with a named warning, never a throw.
  const memberOk = new Map();
  for (const m of sorted) {
    const ok = await isDir(m.projectDir, onError);
    memberOk.set(m.projectKey, ok);
    if (!ok) {
      warnings.push(
        `member \`${m.projectKey}\` real directory \`${m.projectDir}\` is missing or unreadable — ` +
        'degrading to worktree-only context for it (its committed blobs still exist in ' +
        `repos/${m.projectKey}).`,
      );
    }
  }
  const liveMembers = sorted.filter((m) => memberOk.get(m.projectKey));

  // §5.1: registration is deliberately UNCONSTRAINED — a project or workspace member
  // may live anywhere, and today's freedom is preserved. That is only honest if the
  // consequence is NAMED, so a member whose real dir is not under `projectsRoot` is
  // WARNED about here, per member, and the run proceeds untouched (never a failure).
  // Derived at assembly like §8.19/§8.21, so it is resume-idempotent and rides
  // `run.json.warnings` + the run log with no extra manifest state.
  //
  // Gated on `rootUsable`: when the root itself is missing the whole layer is already
  // reported as contributing nothing (above), and NO member can be under a path that
  // does not exist — one line per member would repeat that single fact N times.
  // `isUnder` counts equality as inside, so a member sitting exactly AT projectsRoot
  // (and every member under a home-as-projectsRoot, the default) never warns.
  if (rootUsable) {
    for (const m of sorted) {
      if (!m.projectDir || isUnder(m.projectDir, projectsRoot)) continue;
      warnings.push(
        `member \`${m.projectName || m.projectKey}\` at \`${m.projectDir}\` is not under the ` +
        `projects root \`${projectsRoot}\` — registration is deliberately unconstrained (§5.1), so ` +
        'this run proceeds and the root context layer is still injected; point `projectsRoot` at an ' +
        'ancestor of your projects if you expected that layer to cover this member natively.',
      );
    }
  }

  // The set THIS run root already recorded, so a re-assembly (resume, §5.2) whose
  // inputs shrank does not leave an orphaned mount behind: an entry we no longer
  // record is no longer pathspec-excluded, so in single mode `git add -A` would
  // commit it into the user's deliverable branch.
  const previousRecords = (await readRunManifest(runRoot))?.injectedPaths || {};

  // ── 1) skills (§5.6) ─────────────────────────────────────────────────────
  const injectedPaths = {};
  let skillMountDir = null;
  let skillsOut = { names: [], records: [], renames: {}, roster: [], warnings: [] };
  const primary = sorted[0] || null;
  if (isWorkspace) {
    skillMountDir = join(runRoot, '.claude', 'skills');
    skillsOut = await assembleSkills({
      target: skillMountDir, members: liveMembers, projectsRoot: rootUsable ? projectsRoot : null,
      resolutions: requiredSkillResolutions, homeDir, mount, skipRoot: rootIsHome,
    });
    if (skillsOut.records.length) injectedPaths.runRoot = skillsOut.records;
  } else if (primary?.worktreeDir) {
    // E4/P3b: the skills ancestor walk stops at a git repository root, so a run-root
    // mount would be invisible to a process whose cwd is the worktree.
    skillMountDir = join(primary.worktreeDir, '.claude', 'skills');
    skillsOut = await assembleSkills({
      target: skillMountDir, members: liveMembers, projectsRoot: rootUsable ? projectsRoot : null,
      resolutions: requiredSkillResolutions, homeDir, mount, skipRoot: rootIsHome,
      trackedNames: trackedSkillNames(primary.worktreeDir),
    });
    if (skillsOut.records.length) injectedPaths[primary.projectKey] = skillsOut.records;
  } else if (primary) {
    warnings.push(
      `member \`${primary.projectKey}\` has no checkout registered, so no skill mount was created ` +
      'for this run; only committed and user-scope skills are visible.',
    );
  }
  for (const w of skillsOut.warnings) warnings.push(w);

  // Prune orphans from the PREVIOUS record set (skill mounts only — `link` and
  // `claudeMdSection` entries are owned elsewhere and must survive a re-assembly).
  const scope = isWorkspace ? 'runRoot' : primary?.projectKey;
  const baseDir = isWorkspace ? runRoot : primary?.worktreeDir;
  if (scope && baseDir && Array.isArray(previousRecords[scope])) {
    const keep = new Set(skillsOut.records.map((r) => r.path));
    for (const old of previousRecords[scope]) {
      if (old?.kind !== 'skill' || !old.path || keep.has(old.path)) continue;
      try { await rm(join(baseDir, old.path), { recursive: true, force: true }); } catch { /* best-effort */ }
      warnings.push(`stale skill mount \`${old.path}\` removed: its source \`${old.source}\` is gone.`);
    }
  }

  // ── 2) mcp.json (§5.5) ───────────────────────────────────────────────────
  const mcp = await mergeMcpConfigs({
    members: liveMembers, projectsRoot: rootUsable ? projectsRoot : null, homeDir, isWorkspace, platform,
  });
  for (const w of mcp.warnings) warnings.push(w);
  const written = Object.keys(mcp.servers).sort();
  let mcpConfigPath = null;
  if (written.length) {
    mcpConfigPath = join(runRoot, MCP_FILE);
    const body = `${JSON.stringify({ mcpServers: Object.fromEntries(written.map((k) => [k, mcp.servers[k]])) }, null, 2)}\n`;
    // JSON-validated BEFORE the spawn: E8's silent-ignore hazard means an invalid
    // file would be discarded with no error in `-p` mode, so a parse failure here
    // must be loud rather than shipped.
    try { JSON.parse(body); } catch (err) {
      throw new Error(`generated ${MCP_FILE} is not valid JSON: ${err?.message || err}`);
    }
    await writeFile(mcpConfigPath, body, 'utf8');
  } else {
    await rm(join(runRoot, MCP_FILE), { force: true });        // idempotent re-assembly
  }
  const mcpServerNames = [...written, ...mcp.nativeOnly].sort();

  // ── 3) CLAUDE.md (§5.4) ──────────────────────────────────────────────────
  const bySource = {};
  const load = async (src, memberKey, worktreeDir) => {
    const rawBytes = await readBytesMaybe(src.path, onError);
    if (rawBytes === null) return null;      // absent => silent; unreadable => named above
    // De-duplication (single mode only): the committed copy at cwd loads natively
    // (E1/P1), so inlining a byte-identical real copy would double-load it.
    if (!isWorkspace && worktreeDir) {
      const twin = await readBytesMaybe(join(worktreeDir, src.rel), onError);
      if (twin && twin.equals(rawBytes)) return null;
    }
    const { text: resolved, unresolved } = await resolveImports(
      rawBytes.toString('utf8'), src.path, 0, { homeDir },
    );
    for (const u of unresolved) warnings.push(`\`${src.path}\`: ${u}`);
    let body = resolved;
    if (enc(body) > maxBytesPerFile) {
      const original = enc(body);
      body = truncateBytes(body, maxBytesPerFile);
      bySource[src.path] = enc(body);
      warnings.push(
        `\`${src.path}\`${memberKey ? ` (member \`${memberKey}\`)` : ''} truncated: ` +
        `${fmtNum(original)} → ${fmtNum(maxBytesPerFile)} bytes; raise contextMaxBytesPerFile to keep it whole`,
      );
      body += `\n\n*[worca: truncated at ${fmtNum(maxBytesPerFile)} bytes — raise contextMaxBytesPerFile]*`;
    } else {
      bySource[src.path] = enc(body);
    }
    return { rel: src.rel, path: src.path, text: body };
  };

  const rootSections = [];
  if (rootUsable) {
    // Root skip (§5.4): the plain `<projectsRoot>/CLAUDE.md` and `CLAUDE.local.md`
    // already load natively on the upward walk when the run root is a descendant
    // (E1 verified exactly these two filenames), so inlining them would
    // double-load. `.claude/CLAUDE.md` / `.claude/rules/*` were never probed on the
    // walk and are still inlined — unless projectsRoot IS the home, where they are
    // user scope and always native (E11).
    const runRootUnderRoot = isUnder(runRoot, projectsRoot);
    for (const src of await discoverMemorySources(projectsRoot, onError)) {
      const plain = src.rel === CLAUDE_MD_FILE || src.rel === 'CLAUDE.local.md';
      if (plain && runRootUnderRoot) continue;
      if (!plain && rootIsHome) continue;
      if (plain && rootIsHome) continue;
      const section = await load(src, null, null);
      if (section) rootSections.push(section);
    }
  }
  const memberSections = new Map();
  for (const m of sorted) {
    const list = [];
    if (memberOk.get(m.projectKey)) {
      for (const src of await discoverMemorySources(m.projectDir, onError)) {
        const section = await load(src, m.projectKey, m.worktreeDir);
        if (section) list.push(section);
      }
    }
    memberSections.set(m.projectKey, list);
  }

  // §8.21 — the fourth named loss, derived HERE so the roster note and the warning
  // come from ONE source and a resume re-assembly reproduces both idempotently with no
  // extra manifest state. Read off each member's worktree (committed blobs, E6) and
  // gated on isWorkspace: single mode's cwd IS a checkout, so its agents are
  // discoverable and nothing is lost (§5.7). Assembly runs on detached runs only, so
  // legacy — which never assembles — is untouched.
  // §8.19 — the project-settings loss, derived at the same place and gated the same
  // way as §8.21 below. Today a workspace node's cwd is the config-source member's
  // worktree, so THAT member's committed `.claude/settings.json` (hooks, permission
  // rules, statusline) applies to every node; under §5.3 the cwd is `<runRoot>`, which
  // has no project settings file, so NO member's apply. The decision is to accept the
  // loss and warn by name rather than paper over it with an unmergeable `--settings`
  // (E8's silent-ignore hazard would replace a visible loss with an invisible one).
  // A file that parses to an EMPTY object carries nothing, so nothing is lost and
  // nothing is said; one that does not parse still warns — we cannot prove it is empty.
  if (isWorkspace) {
    for (const m of sorted) {
      const s = await discoverProjectSettings(m.worktreeDir, onError);
      if (!s || (Array.isArray(s.keys) && s.keys.length === 0)) continue;
      const carries = s.keys
        ? `keys: ${s.keys.join(', ')}`
        : 'its contents could not be parsed, so what it carries is unknown';
      warnings.push(
        `project hooks/permissions from \`${m.projectName || m.projectKey}\` do not apply on ` +
        'workspace runs (cwd is the run root); move anything essential into an agent\'s frontmatter ' +
        '`tools:` or a `requiresSkills` skill. Not in force this run: `.claude/settings.json` ' +
        `(${carries}).`,
      );
    }
  }

  const projectAgents = new Map();
  if (isWorkspace) {
    for (const m of sorted) {
      const names = await discoverProjectAgents(m.worktreeDir, onError);
      if (!names.length) continue;
      projectAgents.set(m.projectKey, names);
      warnings.push(
        `project sub-agents from \`${m.projectName || m.projectKey}\` are not discoverable on ` +
        `workspace runs (cwd is the run root); personal \`~/.claude/agents\` still work. ` +
        `Not available by name this run: ${names.join(', ')}.`,
      );
    }
  }

  const doc = generateClaudeMd({
    pipelineId, projectsRoot, members: sorted, graphInstructions,
    rootSections, memberSections,
    skills: skillsOut.roster, servers: mcp.roster,
    projectAgents,
    maxBytesTotal,
  });
  for (const w of doc.warnings) warnings.push(w);
  const claudeMdPath = join(runRoot, CLAUDE_MD_FILE);
  await writeFile(claudeMdPath, doc.text, 'utf8');
  const total = enc(doc.text);
  if (total > CONTEXT_SOFT_WARN_BYTES) {
    warnings.push(
      `generated run context is ${fmtNum(total)} bytes; every byte loads at launch in every node ` +
      '(§8.7) — consider trimming project memory.',
    );
  }

  // §8.6: anything above the run root loads into every node too.
  for (const w of await auditAncestors(runRoot)) warnings.push(w);

  // ── 4) run.json (§5.2) ───────────────────────────────────────────────────
  const renames = { skills: skillsOut.renames, mcpServers: mcp.renames.mcpServers };
  // `total` is the FINAL document size — the same number contextMaxBytesTotal caps,
  // and what renderContextAudit reports. `bySource` is each source's inlined size
  // AFTER its per-file cap but BEFORE the total-budget trim, so the two can differ
  // when the budget bound (that case always carries its own warning).
  const bytes = { total, bySource };
  // S2: the same filter the mount applies — a corrupt entry is also dropped from the
  // manifest, so the corruption does not survive into the NEXT resume's rehydration.
  const skillResolutions = Object.fromEntries(
    resolutionEntries(requiredSkillResolutions).filter(([name]) => isValidSkillName(name)),
  );
  const rc = {
    claudeMdPath,
    mcpConfigPath,
    mcpServerNames,
    skillMountDir,
    injectedSkillNames: skillsOut.names,
    injectedPaths,
    renames,
    warnings,
    bytes,
    memberCount: sorted.length,
  };
  await updateRunManifest(runRoot, {
    injectedPaths,
    skillResolutions,
    renames,
    bytes,
    warnings,
    capabilities: { mcpGrants: MCP_GRANT_MODE },
    mcpConfigPath,
    mcpServerNames,
    injectedSkillNames: skillsOut.names,
    skillMountDir,
  });
  return rc;
}

/**
 * ONE markdown audit line for appendAudit — member / source / mount / server /
 * warning counts, e.g. "Context: 2 members, 7 memory sources inlined (41,208
 * bytes), 5 skills mounted (1 renamed), 3 MCP servers merged (1 renamed), 2
 * warnings." The rename parenthetical is omitted when nothing was renamed.
 * @param {object} rc  the assembleRunContext() result
 * @returns {string}
 */
export function renderContextAudit(rc) {
  const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
  const keys = (o) => Object.keys(o || {}).length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const ren = (n) => (n ? ` (${n} renamed)` : '');
  return (
    `Context: ${plural(count(rc?.memberCount), 'member')}, ` +
    `${plural(keys(rc?.bytes?.bySource), 'memory source')} inlined (${fmtNum(rc?.bytes?.total)} bytes), ` +
    `${plural(count(rc?.injectedSkillNames), 'skill')} mounted${ren(keys(rc?.renames?.skills))}, ` +
    `${plural(count(rc?.mcpServerNames), 'MCP server')} merged${ren(keys(rc?.renames?.mcpServers))}, ` +
    `${plural(count(rc?.warnings), 'warning')}.`
  );
}
