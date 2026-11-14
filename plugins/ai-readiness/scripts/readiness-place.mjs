// plugins/ai-readiness/scripts/readiness-place.mjs — the Place Claude files step. Claude Code refuses an
// unattended agent's writes under .claude/, so Generate stages Claude files in the run folder
// (<pipeline dir>/readiness-claude/, per member key on a workspace run) and this plain script copies
// the ones card B approved into the checkout. Only skills/ and rules/ are ever placed: settings,
// hooks, commands and agents can grant permissions or run code in later sessions.
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { memberDir } from './readiness-probe.mjs';

export const STAGE_DIR = 'readiness-claude';
export const LIMITS = Object.freeze({ files: 64, fileBytes: 256 * 1024, totalBytes: 1024 * 1024 });
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Why a path under .claude/ (forward slashes) may not be placed, or null when it may. */
export function placeProblem(rel) {
  const parts = String(rel).split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return 'not a plain relative path';
  if (parts[0] === 'skills') {
    if (parts.length < 3) return 'a skill file must sit in skills/<name>/';
    if (parts[1] === 'readiness-rubric') return 'the readiness-rubric skill name is reserved by worca';
    if (!NAME.test(parts[1]) || parts[1].length > 64) return 'a skill folder name must be lowercase words joined by hyphens, at most 64 characters';
    return null;
  }
  if (parts[0] === 'rules') {
    if (parts[1] === 'worca') return 'rules/worca/ is reserved by worca';
    if (!rel.endsWith('.md')) return 'a rule must be a .md file';
    return null;
  }
  return 'only skills/ and rules/ may be placed under .claude/';
}

/** The approved .claude/ paths from the plan's files (string ids or rows), with a member prefix removed. */
export function approvedSet(plan, prefix = '') {
  const ids = (Array.isArray(plan?.files) ? plan.files : []).map((f) => (typeof f === 'string' ? f : f?.id)).filter((s) => typeof s === 'string');
  const out = new Set();
  for (const id of ids) {
    if (prefix && !id.startsWith(prefix)) continue;
    if (!prefix && /^[^/]+\/\.claude\//.test(id) && !id.startsWith('.claude/')) continue; // another member's id
    const rest = prefix ? id.slice(prefix.length) : id;
    if (rest.startsWith('.claude/')) out.add(rest); // a folder id (ending in /) approves everything under it
  }
  return out;
}

function isApproved(rel, approved) {
  if (approved.has(`.claude/${rel}`)) return true;
  for (const a of approved) if (a.endsWith('/') && `.claude/${rel}`.startsWith(a)) return true;
  const m = /^skills\/([^/]+)\//.exec(rel);
  return !!m && approved.has(`.claude/skills/${m[1]}/SKILL.md`);
}

/** Every staged entry under `dir`, relative with forward slashes; symlinks are reported, never followed. */
function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(join(dir, base)).sort()) {
    const rel = base ? `${base}/${name}` : name;
    const st = lstatSync(join(dir, rel));
    if (st.isSymbolicLink()) out.push({ rel, symlink: true });
    else if (st.isDirectory()) out.push(...walk(dir, rel));
    else if (st.isFile()) out.push({ rel, size: st.size });
  }
  return out;
}

/** The first symlink on the destination path (the .claude folder, each folder, and the file itself), or null.
    A missing part ends the walk: nothing below it can exist yet. */
function symlinkOnPath(repoDir, rel) {
  let cur = repoDir;
  for (const part of ['.claude', ...rel.split('/')]) {
    cur = join(cur, part);
    let st;
    try { st = lstatSync(cur); } catch (e) { if (e.code === 'ENOENT') return null; if (e.code === 'ENOTDIR') return { notDir: true }; throw e; }
    if (st.isSymbolicLink()) return cur;
  }
  return null;
}

/** The paths worca mounted into one checkout for this run (run.json injectedPaths), relative to it.
    A workspace run records its skills under the run root, so only a member's own scope counts there;
    a single-repo run has one scope besides the run root. */
export function mountedPaths(ctx, scope = null) {
  let manifest = {};
  for (const dir of [ctx?.runRoot, ctx?.pipelineDir]) {
    if (!dir) continue;
    try { manifest = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')); break; } catch { /* try the next folder */ }
  }
  const out = [];
  for (const [key, entries] of Object.entries(manifest?.injectedPaths || {})) {
    if (scope ? key !== scope : key === 'runRoot') continue;
    for (const e of Array.isArray(entries) ? entries : []) if (e && typeof e.path === 'string') out.push(e.path.replace(/\/+$/, ''));
  }
  return out;
}

function ignoredByGit(repoDir, rel) {
  return spawnSync('git', ['check-ignore', '-q', '--', `.claude/${rel}`], { cwd: repoDir }).status === 0;
}

export function placeClaudeFiles({ stageDir, repoDir, approved, injected = [] }) {
  const placed = [];
  const skipped = [];
  let root;
  try { root = lstatSync(stageDir); } catch (e) { if (e.code === 'ENOENT') return { placed, skipped }; throw e; }
  if (root.isSymbolicLink()) return { placed, skipped: [{ path: '.claude/', reason: 'the staged folder is a symlink' }] };
  let total = 0;
  for (const e of walk(stageDir)) {
    const path = `.claude/${e.rel}`;
    const problem = e.symlink ? 'a symlink is never placed' : placeProblem(e.rel);
    if (problem) { skipped.push({ path, reason: problem }); continue; }
    if (!isApproved(e.rel, approved)) { skipped.push({ path, reason: 'not approved on the plan card' }); continue; }
    if (e.size > LIMITS.fileBytes) { skipped.push({ path, reason: `larger than ${LIMITS.fileBytes} bytes` }); continue; }
    if (placed.length >= LIMITS.files) { skipped.push({ path, reason: `more than ${LIMITS.files} files` }); continue; }
    if (total + e.size > LIMITS.totalBytes) { skipped.push({ path, reason: `over ${LIMITS.totalBytes} bytes in total` }); continue; }
    if (injected.some((m) => path === m || path.startsWith(`${m}/`))) { skipped.push({ path, reason: 'worca mounts a skill with that name for this run; it would not be committed' }); continue; }
    const link = symlinkOnPath(repoDir, e.rel);
    if (link?.notDir) { skipped.push({ path, reason: 'a folder on the way is not a folder' }); continue; }
    if (link) { skipped.push({ path, reason: 'a folder on the way is a symlink' }); continue; }
    const dest = join(repoDir, '.claude', e.rel);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(stageDir, e.rel)));
    } catch (err) { skipped.push({ path, reason: `could not be written: ${err.code || err.message}` }); continue; }
    total += e.size;
    placed.push({ path, ignored: ignoredByGit(repoDir, e.rel) });
  }
  return { placed, skipped };
}

function readJson(p) {
  if (!p || !existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')); // an unreadable plan is a real failure: the node pauses
}

const line = (r) => `${r.placed.length} placed, ${r.skipped.length} skipped`
  + (r.placed.some((p) => p.ignored) ? `; ${r.placed.filter((p) => p.ignored).length} ignored by .gitignore and will not be committed` : '');

export default async function run({ inputs, outputs, ctx, log }) {
  const plan = readJson(inputs?.plan?.path) || {};
  const root = join(ctx.pipelineDir, STAGE_DIR);
  let result;
  let summary;
  const members = Array.isArray(ctx.workspace?.members) ? ctx.workspace.members : null;
  if (members) {
    const known = new Set(members.map((m) => m.key));
    result = { members: {} };
    for (const m of members) {
      result.members[m.key] = placeClaudeFiles({ stageDir: join(root, m.key), repoDir: memberDir(ctx, m.key), approved: approvedSet(plan, `${m.key}/`), injected: mountedPaths(ctx, m.key) });
    }
    if (existsSync(root)) {
      for (const k of readdirSync(root).sort()) if (!known.has(k)) result.members[k] = { placed: [], skipped: [{ path: `${k}/`, reason: 'not a member of this run' }] };
    }
    summary = Object.entries(result.members).map(([k, r]) => `${k}: ${line(r)}`).join('; ');
  } else {
    result = placeClaudeFiles({ stageDir: root, repoDir: ctx.cwd, approved: approvedSet(plan), injected: mountedPaths(ctx) });
    summary = line(result);
  }
  for (const r of members ? Object.values(result.members) : [result]) {
    for (const s of r.skipped) log('warn', `Not placed: ${s.path} (${s.reason})`);
    for (const p of r.placed) if (p.ignored) log('warn', `${p.path} is ignored by .gitignore and will not be committed`);
  }
  if (outputs?.placed?.path) writeFileSync(outputs.placed.path, JSON.stringify(result, null, 2));
  return { summary: `Claude files: ${summary || '0 placed, 0 skipped'}` };
}
