// src/core/policy/sync.mjs
// The worca-policy branch: discovery, the local worktree, enable / follow, publish, status
// (team-policy design §4, §9). Reuses the team-metrics git primitives (metrics/sync.mjs:
// runGit, projectSlug, orphanCommit, identityArgs, findLocalRepoBySlug, isNonFastForward)
// so a policy commit obeys the same hook-free, sign-free, identity rules as a metrics one.
//
// Unlike metrics, policy is few writers editing ONE file: there is no outbox, no flush loop,
// and the branch is expected to be PROTECTED (only maintainers push). Every read comes from
// the discovery cache in project_config.extra.teamPolicy — no git call ever sits on a run's
// path except the one bounded fetch a project with no cache at all pays.

import { EventEmitter } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { worcaHome, listProjects } from '../projects.mjs';
import { projectKey, canonicalProjectRoot } from '../store.mjs';
import { readTeamPolicyPrefs, writeTeamPolicyPrefs } from '../config.mjs';
import { readWorkspace, listWorkspaces } from '../workspaces.mjs';
import { withLock } from '../metrics/lock.mjs';
import {
  runGit, projectSlug, gitUserName, orphanCommit, identityArgs, findLocalRepoBySlug, isNonFastForward,
  slugDirName, DISCOVERY_TTL_MS, DISCOVERY_RETRY_MS,
} from '../metrics/sync.mjs';
import { normalizePolicyDoc, emptyPolicyDoc, serializePolicyDoc, POLICY_SCHEMA } from './registry.mjs';
import { capSummary, fieldCount, effectiveRows } from './effective.mjs';

export const POLICY_BRANCH = 'worca-policy';
export const POLICY_DIR = '.worca-policy';
export const POLICY_FILE = `${POLICY_DIR}/policy.json`;
export const REMOTE_REF = `refs/remotes/origin/${POLICY_BRANCH}`;
export const FETCH_REFSPEC = `+refs/heads/${POLICY_BRANCH}:${REMOTE_REF}`;
export const MAX_PUSH_ATTEMPTS = 5;
export const PROTECTION_HINT = `you may not have push rights to \`${POLICY_BRANCH}\` — copy the JSON and open a pull request against that branch, or ask a maintainer`;
export { DISCOVERY_TTL_MS };

const README_TEXT = `# worca-policy\n\nThis branch carries the team policy Worca reads for this repository (\`${POLICY_FILE}\`): cost caps, expected plugins, model and guardrail defaults. Edit it from Worca's Team policy page or by pull request. Protect this branch so only maintainers can push; every teammate's Worca reads it. To turn the policy off for the whole team, delete this branch: \`git push origin --delete ${POLICY_BRANCH}\`.\n`;

export const policyEvents = new EventEmitter();
const emit = (slug, action, extra = {}) => policyEvents.emit('changed', { slug, action, ...extra });

// ---- paths ------------------------------------------------------------------
export function policyRoot() { return join(worcaHome(), 'policy'); }
export function worktreePath(slug) { return join(policyRoot(), 'repos', slugDirName(slug)); }
function lockFile(slug) { return join(policyRoot(), 'locks', `${slugDirName(slug)}.lock`); }

function policyError(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
const firstLine = (s) => String(s || '').trim().split('\n').find(Boolean) || '';
const iso = (ms) => new Date(ms).toISOString();

// In-process serialization per slug, then the cross-process lock file (metrics/lock.mjs).
const _queues = new Map();
function withSlugLock(slug, fn) {
  const file = lockFile(slug);
  const prev = _queues.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => withLock(file, fn));
  const tail = run.catch(() => {});
  _queues.set(file, tail);
  tail.then(() => { if (_queues.get(file) === tail) _queues.delete(file); });
  return run;
}

// ---- git ----------------------------------------------------------------------
const LOCAL_REF_RACE = /cannot lock ref|incorrect old value provided|unable to update local ref|Unable to create '[^']*\.lock'/;

export async function fetchPolicyBranch(dir, { timeoutMs = 120_000 } = {}) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await runGit(dir, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', FETCH_REFSPEC], { timeoutMs });
    if (r.ok || !LOCAL_REF_RACE.test(r.stderr)) return r;
    await new Promise((res) => setTimeout(res, 50 + Math.floor(Math.random() * 200)));
  }
  return r;
}

/** `git show origin/worca-policy:.worca-policy/policy.json`, normalised. Never throws. */
async function readRemotePolicy(dir) {
  const r = await runGit(dir, ['show', `${REMOTE_REF}:${POLICY_FILE}`], { timeoutMs: 10_000 });
  if (!r.ok) return { doc: null, warnings: [`${POLICY_FILE} is missing on the branch`], unknownSchema: false, delegateTo: null };
  let raw;
  try { raw = JSON.parse(r.stdout); } catch { return { doc: null, warnings: [`${POLICY_FILE} is not valid JSON`], unknownSchema: false, delegateTo: null }; }
  return normalizePolicyDoc(raw);
}

/** The policy hint for a push rejection: protection is EXPECTED here, so the hint is about rights, not exemption. */
export function pushHint(stderr) {
  return /protected|hook declined|pre-receive|GH006|GH013|rule violation|push declined|GL-HOOK|denied|permission/i.test(String(stderr || '')) ? PROTECTION_HINT : null;
}

// ---- discovery (§9) ---------------------------------------------------------------
/**
 * `git ls-remote --heads origin worca-policy`, cached in project_config.extra.teamPolicy.
 * Offline keeps the previous verdict and does not advance checkedAt. Same shape and race
 * rules as metrics discoverProject.
 */
export async function discoverPolicy(projectDir, { force = false, now = Date.now(), lsTimeoutMs = 20_000, fetchTimeoutMs = 120_000 } = {}) {
  const key = projectKey(projectDir);
  const prev = readTeamPolicyPrefs(key) || {};
  if (!force && prev.checkedAt && now - Date.parse(prev.checkedAt) < DISCOVERY_TTL_MS) return prev;
  if (!existsSync(projectDir)) return readTeamPolicyPrefs(key);
  const { slug, hasOrigin, remotesOk, originUrl } = await projectSlug(projectDir);
  const originDisplay = originUrl ? String(originUrl).replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]*@/, '').replace(/:(?!\d)/, '/').replace(/\.git$/, '') : null;
  if (!remotesOk) return prev.checkedAt ? prev : null;
  const write = (patch) => {
    const cur = readTeamPolicyPrefs(key);
    if (cur?.checkedAt && Date.parse(cur.checkedAt) > now) return cur;
    return writeTeamPolicyPrefs(key, patch);
  };
  if (!hasOrigin) {
    return write({ present: false, hasOrigin: false, slug, originDisplay: null, doc: null, docKnown: false, delegateTo: null, headSha: null, checkedAt: iso(now) });
  }
  const ls = await runGit(projectDir, ['ls-remote', '--heads', 'origin', `refs/heads/${POLICY_BRANCH}`], { timeoutMs: lsTimeoutMs });
  if (!ls.ok) return write({ hasOrigin: true, slug, originDisplay, lastDiscoveryError: firstLine(ls.stderr), lastDiscoveryAt: iso(now) });
  const sha = ls.stdout.trim().split(/\s+/)[0] || null;
  if (!sha) {
    const next = write({ present: false, hasOrigin: true, slug, originDisplay, headSha: null, doc: null, docKnown: false, delegateTo: null, warnings: [], unknownSchema: false, checkedAt: iso(now), lastDiscoveryError: null });
    if (prev.present) emit(slug, 'disabled');
    return next;
  }
  let { doc = null, docKnown = false, warnings = [], unknownSchema = false, delegateTo = null, headSha = null } = prev;
  if (sha !== prev.headSha || !prev.docKnown) {
    const f = await fetchPolicyBranch(projectDir, { timeoutMs: fetchTimeoutMs });
    if (!f.ok) {
      const next = write({ present: true, hasOrigin: true, slug, originDisplay, docKnown: !!prev.docKnown, lastDiscoveryError: firstLine(f.stderr), lastDiscoveryAt: iso(now) });
      if (!prev.present) emit(slug, 'discovered');
      return next;
    }
    const read = await readRemotePolicy(projectDir);
    doc = read.doc; warnings = read.warnings; unknownSchema = read.unknownSchema; delegateTo = read.delegateTo; docKnown = true; headSha = sha;
  }
  const next = write({ present: true, hasOrigin: true, slug, originDisplay, headSha, doc, docKnown, warnings, unknownSchema, delegateTo, checkedAt: iso(now), lastDiscoveryError: null });
  if (!prev.present) emit(slug, 'discovered');
  else if (prev.headSha !== sha) emit(slug, 'updated');
  return next;
}

/** Every registered project plus every workspace policy home. */
export async function discoverAllPolicies({ force = false } = {}) {
  const paths = new Set((await listProjects()).filter((p) => p.exists).map((p) => p.path));
  for (const w of await listWorkspaces()) if (w.policyProject) paths.add(w.policyProject);
  const out = [];
  for (const p of paths) {
    try { out.push({ path: p, prefs: await discoverPolicy(p, { force }) }); }
    catch (err) { out.push({ path: p, error: String(err?.message || err) }); }
  }
  return out;
}

const isStale = (prefs) => !prefs?.checkedAt || Date.now() - Date.parse(prefs.checkedAt) >= DISCOVERY_TTL_MS;

/**
 * discover: true         → rediscover when stale (page opens, statuses)
 *           false        → cache only
 *           'if-missing' → cache only unless there is no cache at all; then one bounded
 *                          discovery (10 s / 15 s). The run-start path (design §9: cache first).
 */
async function prefsFor(projectDir, { discover = true } = {}) {
  let prefs = readTeamPolicyPrefs(projectKey(projectDir));
  if (discover === 'if-missing') {
    const tried = prefs?.checkedAt || (prefs?.lastDiscoveryAt && Date.now() - Date.parse(prefs.lastDiscoveryAt) < DISCOVERY_RETRY_MS);
    if (!tried) prefs = await discoverPolicy(projectDir, { lsTimeoutMs: 10_000, fetchTimeoutMs: 15_000 }).catch(() => prefs);
    else if (isStale(prefs)) void discoverPolicy(projectDir).catch(() => {});   // background refresh for the NEXT run
  } else if (discover && isStale(prefs)) {
    prefs = await discoverPolicy(projectDir).catch(() => prefs);
  }
  return prefs;
}

/** A project carries a policy (present, read, not a marker). */
export const carriesPolicy = (prefs) => !!prefs?.present && !!prefs.docKnown && !prefs.delegateTo && !prefs.unknownSchema;

// ---- resolver (§6) ----------------------------------------------------------------
function invalid(code, detail) { return { ok: false, reason: 'delegate-invalid', code, detail }; }

/**
 * The policy that governs single-project runs on `projectDir`: its own, or the home it follows.
 * @returns {Promise<{ok:true, home:string, homeDir:string, sha:string|null, doc:object, delegated:boolean, from:string, warnings:string[], checkedAt:string|null}
 *                  | {ok:false, reason:'no-origin'|'not-enabled'|'unsupported'|'delegate-invalid', code?:string, detail?:string}>}
 */
export async function resolveProjectPolicy(projectDir, { discover = true } = {}) {
  const own = await prefsFor(projectDir, { discover });
  if (own?.hasOrigin === false) return { ok: false, reason: 'no-origin' };
  if (!own?.present) return { ok: false, reason: 'not-enabled' };
  if (!own.docKnown) return { ok: false, reason: 'not-enabled', code: 'DOC_UNKNOWN', detail: `the ${POLICY_BRANCH} branch exists but could not be fetched yet` };
  if (own.unknownSchema) return { ok: false, reason: 'unsupported', code: 'SCHEMA_UNKNOWN', detail: own.warnings?.[0] || 'the policy needs a newer Worca' };
  if (!own.delegateTo) {
    return { ok: true, home: own.slug, homeDir: projectDir, sha: own.headSha, doc: own.doc, delegated: false, from: own.slug, warnings: own.warnings || [], checkedAt: own.checkedAt ?? null };
  }
  if (own.delegateTo === own.slug) return invalid('DELEGATE_SELF', `${own.slug} follows itself`);
  const target = await findLocalRepoBySlug(own.delegateTo);
  if (!target) return invalid('DELEGATE_UNKNOWN', `follows ${own.delegateTo}, which is not a project in Worca on this machine`);
  const t = await prefsFor(target.path, { discover });
  if (!t?.present) return invalid('DELEGATE_DANGLING', `follows ${own.delegateTo}, which no longer carries a policy`);
  if (!t.docKnown) return invalid('DELEGATE_UNKNOWN_CONFIG', `follows ${own.delegateTo}, whose branch could not be fetched yet`);
  if (t.delegateTo) return invalid('DELEGATE_CHAIN', `follows ${own.delegateTo}, which itself follows ${t.delegateTo} (no chains)`);
  if (t.unknownSchema) return { ok: false, reason: 'unsupported', code: 'SCHEMA_UNKNOWN', detail: t.warnings?.[0] || 'the policy needs a newer Worca' };
  return { ok: true, home: t.slug, homeDir: target.path, sha: t.headSha, doc: t.doc, delegated: true, from: own.slug, warnings: t.warnings || [], checkedAt: t.checkedAt ?? null };
}

const samePath = (a, b) => {
  if (!a || !b) return false;
  if (resolve(a) === resolve(b)) return true;
  try { return canonicalProjectRoot(a) === canonicalProjectRoot(b); } catch { return false; }
};

/**
 * The policy that governs runs of a workspace: its policy home's (a member that carries a
 * policy OR follows one — design §9 "follows the home the member follows").
 */
export async function resolveWorkspacePolicy(workspaceOrId, { discover = true } = {}) {
  const ws = typeof workspaceOrId === 'string' ? await readWorkspace(workspaceOrId) : workspaceOrId;
  if (!ws) return { ok: false, reason: 'not-enabled' };
  if (!ws.policyProject) return { ok: false, reason: 'no-home' };
  if (!ws.projectPaths.some((p) => samePath(p, ws.policyProject))) {
    return { ok: false, reason: 'home-stale', code: 'HOME_NOT_MEMBER', detail: 'the policy home is no longer a workspace member' };
  }
  const r = await resolveProjectPolicy(ws.policyProject, { discover });
  if (!r.ok) return { ok: false, reason: 'home-stale', code: r.code || r.reason.toUpperCase().replace(/-/g, '_'), detail: r.detail || `the policy home has no ${POLICY_BRANCH} branch` };
  return { ...r, workspace: ws };
}

// ---- worktree, enable / follow, publish (§9) --------------------------------------
async function removeWorktreeDir(dir, projectDir) {
  if (projectDir) await runGit(projectDir, ['worktree', 'remove', '--force', dir]);
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  if (projectDir) await runGit(projectDir, ['worktree', 'prune']);
}

/** git worktree of the project repo at policy/repos/<slug>, detached at origin/worca-policy. */
export async function ensureWorktree(slug, projectDir) {
  const dir = worktreePath(slug);
  if (existsSync(dir)) {
    const top = await runGit(dir, ['rev-parse', '--show-toplevel'], { timeoutMs: 10_000 });
    let healthy = false;
    try { healthy = top.ok && realpathSync.native(top.stdout.trim()) === realpathSync.native(dir); } catch { healthy = false; }
    if (healthy) return dir;
    await removeWorktreeDir(dir, projectDir);
  }
  await mkdir(dirname(dir), { recursive: true });
  const f = await fetchPolicyBranch(projectDir);
  if (!f.ok) throw policyError('FETCH_FAILED', firstLine(f.stderr) || 'git fetch failed', { stderr: f.stderr });
  let add = await runGit(projectDir, ['worktree', 'add', '--detach', '--force', dir, REMOTE_REF]);
  if (!add.ok) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
    await runGit(projectDir, ['worktree', 'prune']);
    add = await runGit(projectDir, ['worktree', 'add', '--detach', '--force', dir, REMOTE_REF]);
    if (!add.ok) throw policyError('WORKTREE_FAILED', firstLine(add.stderr), { stderr: add.stderr });
  }
  return dir;
}

/** @returns {Promise<{slug:string}>} the validated home to follow */
async function validateFollowTarget(delegateTo, ownSlug) {
  const want = String(delegateTo || '').toLowerCase();
  if (!want) throw policyError('BAD_REQUEST', 'delegateTo is required');
  if (want === ownSlug) throw policyError('DELEGATE_INVALID', 'a project cannot follow itself');
  const target = await findLocalRepoBySlug(want);
  if (!target) throw policyError('DELEGATE_INVALID', `${want} is not a project in Worca on this machine`);
  const t = (await discoverPolicy(target.path, { force: true }).catch(() => null)) || {};
  if (!t.present) throw policyError('DELEGATE_INVALID', `${want} carries no team policy`);
  if (!t.docKnown) throw policyError('FETCH_FAILED', `could not read the ${POLICY_BRANCH} branch of ${want}; try again`);
  if (t.delegateTo) throw policyError('DELEGATE_INVALID', `${want} follows ${t.delegateTo}; pick a project that carries a policy`);
  return { slug: want };
}

const stampNow = (now) => now.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** Equal documents up to the stamp (updatedAt / updatedBy): title, notes, fields, workspaceRuns, catalogs. */
function sameContent(a, b) {
  const strip = (d) => serializePolicyDoc({ ...d, updatedAt: null, updatedBy: null });
  return strip(a) === strip(b);
}

/**
 * POST /api/projects/:key/policy/enable (design §9, board 3).
 * mode 'here'   → create the orphan branch with README + an EMPTY policy; or join if it exists.
 * mode 'follow' → create a marker { delegateTo }; or join; with change:true rewrite an existing marker.
 * @returns {Promise<{action:'created'|'joined'|'changed', slug:string}>}
 */
export async function enableTeamPolicy(projectDir, { mode = 'here', delegateTo = null, change = false, title = '', now = new Date(), by = null } = {}) {
  if (mode !== 'here' && mode !== 'follow') throw policyError('BAD_REQUEST', 'mode must be "here" or "follow"');
  const { slug, hasOrigin } = await projectSlug(projectDir);
  if (!hasOrigin) throw policyError('NO_ORIGIN', 'this project has no origin remote — a team policy lives on origin, so there is nowhere to put it');
  const target = mode === 'follow' ? (await validateFollowTarget(delegateTo, slug)).slug : null;
  // The person who asked (identity.mjs) when known; else, as before, the checkout's git user.
  const user = (typeof by === 'string' && by.trim() && by !== 'local' ? by.trim() : null) ?? await gitUserName(projectDir);
  const doc = mode === 'follow'
    ? { schema: POLICY_SCHEMA, enabledAt: stampNow(now), enabledBy: user, delegateTo: target }
    : emptyPolicyDoc({ updatedBy: user, title: title || `${slug} team policy`, now });
  const body = mode === 'follow' ? JSON.stringify(doc, null, 2) + '\n' : serializePolicyDoc(doc);
  const result = await withSlugLock(slug, async () => {
    const ls = await runGit(projectDir, ['ls-remote', '--heads', 'origin', `refs/heads/${POLICY_BRANCH}`], { timeoutMs: 20_000 });
    if (!ls.ok) throw policyError('REMOTE_UNREACHABLE', firstLine(ls.stderr), { stderr: ls.stderr });
    if (ls.stdout.trim()) {
      if (change && mode === 'follow') return rewriteMarker(slug, projectDir, doc);
      await ensureWorktree(slug, projectDir);
      return { action: 'joined' };
    }
    const commit = await orphanCommit(projectDir, { 'README.md': README_TEXT, [POLICY_FILE]: body },
      mode === 'follow' ? `policy: follow ${target}` : 'policy: enable team policy', 'git-user');
    const push = await runGit(projectDir, ['push', '--no-verify', 'origin', `${commit}:refs/heads/${POLICY_BRANCH}`], { timeoutMs: 120_000 });
    if (!push.ok) {
      if (isNonFastForward(push.stderr)) { await ensureWorktree(slug, projectDir); return { action: 'joined' }; }
      throw policyError('PUSH_REJECTED', firstLine(push.stderr), { stderr: push.stderr, hint: pushHint(push.stderr) });
    }
    await ensureWorktree(slug, projectDir);
    return { action: 'created' };
  });
  await discoverPolicy(projectDir, { force: true }).catch(() => null);
  emit(slug, result.action);
  return { action: result.action, slug };
}

/** Rewrite the marker on an existing branch (the "Change…" action). */
async function rewriteMarker(slug, projectDir, doc) {
  const dir = await ensureWorktree(slug, projectDir);
  for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
    const f = await fetchPolicyBranch(dir);
    if (!f.ok) throw policyError('FETCH_FAILED', firstLine(f.stderr), { stderr: f.stderr });
    const reset = await runGit(dir, ['reset', '--hard', REMOTE_REF]);
    if (!reset.ok) throw policyError('WORKTREE_FAILED', firstLine(reset.stderr), { stderr: reset.stderr });
    const cur = await readFile(join(dir, POLICY_FILE), 'utf8').then(JSON.parse).catch(() => ({}));
    if (!cur.delegateTo) throw policyError('DELEGATE_INVALID', 'this project carries its own policy; its branch is not a marker');
    if (String(cur.delegateTo).toLowerCase() === doc.delegateTo) return { action: 'changed' };
    await writeFile(join(dir, POLICY_FILE), JSON.stringify({ ...cur, enabledAt: doc.enabledAt, enabledBy: doc.enabledBy, delegateTo: doc.delegateTo }, null, 2) + '\n');
    await runGit(dir, ['add', '-A', '-f', POLICY_DIR]);
    const c = await runGit(dir, [...(await identityArgs(projectDir, 'git-user')), 'commit', '-q', '--no-verify', '-m', `policy: follow ${doc.delegateTo}`]);
    if (!c.ok) throw policyError('COMMIT_FAILED', firstLine(c.stderr), { stderr: c.stderr });
    const push = await runGit(dir, ['push', '--no-verify', 'origin', `HEAD:refs/heads/${POLICY_BRANCH}`], { timeoutMs: 120_000 });
    if (push.ok) return { action: 'changed' };
    if (!isNonFastForward(push.stderr)) throw policyError('PUSH_REJECTED', firstLine(push.stderr), { stderr: push.stderr, hint: pushHint(push.stderr) });
  }
  throw policyError('PUSH_RETRIES_EXHAUSTED', `the ${POLICY_BRANCH} branch kept moving; try again`);
}

/**
 * Publish a document to a home's branch (the editor's "Publish to worca-policy", §11 board 5).
 * Validates strictly — the editor never sends a field the reader would drop, so any warning
 * is a caller bug and answers BAD_REQUEST with the list. A rejection is thrown VERBATIM.
 * @returns {Promise<{ok:true, slug:string, sha:string|null, doc:object}>}
 */
export async function publishPolicy(projectDir, rawDoc, { message = null, now = new Date(), by = null } = {}) {
  const prefs = (await discoverPolicy(projectDir, { force: true }).catch(() => null)) || readTeamPolicyPrefs(projectKey(projectDir)) || {};
  if (!prefs.present) throw policyError('NOT_HOME', `this project has no ${POLICY_BRANCH} branch`);
  if (!prefs.docKnown) throw policyError('FETCH_FAILED', `could not read the ${POLICY_BRANCH} branch; try again`);
  if (prefs.delegateTo) throw policyError('NOT_HOME', `this project follows ${prefs.delegateTo}; edit the policy there`);
  const { doc, warnings, unknownSchema } = normalizePolicyDoc(rawDoc);
  if (!doc || unknownSchema) throw policyError('BAD_REQUEST', warnings[0] || 'invalid policy document', { warnings });
  if (warnings.length) throw policyError('BAD_REQUEST', `the document has ${warnings.length} problem(s): ${warnings[0]}`, { warnings });
  const slug = prefs.slug;
  doc.updatedAt = stampNow(now);
  doc.updatedBy = (typeof by === 'string' && by.trim() && by !== 'local' ? by.trim() : null) ?? await gitUserName(projectDir);
  delete doc.delegateTo;
  const body = serializePolicyDoc(doc);
  const commitMsg = message && String(message).trim() ? `policy: ${String(message).trim().slice(0, 120)}` : 'policy: update team policy';
  const out = await withSlugLock(slug, async () => {
    const dir = await ensureWorktree(slug, projectDir);
    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
      const f = await fetchPolicyBranch(dir);
      if (!f.ok) throw policyError('FETCH_FAILED', firstLine(f.stderr), { stderr: f.stderr });
      const reset = await runGit(dir, ['reset', '--hard', REMOTE_REF]);
      if (!reset.ok) { await removeWorktreeDir(dir, projectDir); throw policyError('WORKTREE_FAILED', firstLine(reset.stderr), { stderr: reset.stderr }); }
      // Same content as the branch (everything but the stamp): nothing to publish. Compared on
      // the normalised shape, so a re-publish of what is already there never mints a commit.
      const current = await readFile(join(dir, POLICY_FILE), 'utf8').then((t) => normalizePolicyDoc(JSON.parse(t)).doc).catch(() => null);
      if (current && sameContent(current, doc)) {
        const head = await runGit(dir, ['rev-parse', 'HEAD']);
        return { sha: head.ok ? head.stdout.trim() : null, unchanged: true };
      }
      await mkdir(join(dir, POLICY_DIR), { recursive: true });
      await writeFile(join(dir, POLICY_FILE), body, 'utf8');
      if (!existsSync(join(dir, 'README.md'))) await writeFile(join(dir, 'README.md'), README_TEXT, 'utf8');
      await runGit(dir, ['add', '-A', '-f', POLICY_DIR, 'README.md']);
      const status = await runGit(dir, ['status', '--porcelain']);
      if (status.ok && !status.stdout.trim()) {
        const head = await runGit(dir, ['rev-parse', 'HEAD']);
        return { sha: head.ok ? head.stdout.trim() : null, unchanged: true };
      }
      const c = await runGit(dir, [...(await identityArgs(projectDir, 'git-user')), 'commit', '-q', '--no-verify', '-m', commitMsg]);
      if (!c.ok) throw policyError('COMMIT_FAILED', firstLine(c.stderr), { stderr: c.stderr });
      const push = await runGit(dir, ['push', '--no-verify', 'origin', `HEAD:refs/heads/${POLICY_BRANCH}`], { timeoutMs: 120_000 });
      if (push.ok) { const head = await runGit(dir, ['rev-parse', 'HEAD']); return { sha: head.ok ? head.stdout.trim() : null, unchanged: false }; }
      if (!isNonFastForward(push.stderr)) throw policyError('PUSH_REJECTED', firstLine(push.stderr), { stderr: push.stderr, hint: pushHint(push.stderr) });
    }
    throw policyError('PUSH_RETRIES_EXHAUSTED', `the ${POLICY_BRANCH} branch kept moving; try again`);
  });
  const fresh = await discoverPolicy(projectDir, { force: true }).catch(() => null);
  emit(slug, 'published', { unchanged: out.unchanged });
  return { ok: true, slug, sha: fresh?.headSha ?? out.sha, doc: fresh?.doc ?? doc, unchanged: out.unchanged };
}

// ---- statuses (§11) --------------------------------------------------------------------
/** Status for the Projects cell, the scope list and the Settings readout. */
export async function projectPolicyStatus(p, { discover = false } = {}) {
  const prefs = await prefsFor(p.path, { discover }) || {};
  const status = {
    key: p.key, name: p.name, path: p.path, exists: p.exists,
    slug: prefs.slug ?? null, hasOrigin: prefs.hasOrigin ?? null, present: !!prefs.present, docKnown: !!prefs.docKnown,
    unknownSchema: !!prefs.unknownSchema, warnings: prefs.warnings || [],
    delegateTo: prefs.delegateTo ?? null, delegateState: null, delegateCode: null, delegateDetail: null, blocked: null,
    home: null, homeKey: null, sha: null, title: null, updatedAt: null, updatedBy: null, fieldCount: 0, caps: null, workspaceCaps: null,
    origin: prefs.originDisplay ?? null, checkedAt: prefs.checkedAt ?? null, lastDiscoveryError: prefs.lastDiscoveryError ?? null,
    carries: carriesPolicy(prefs),
  };
  if (status.hasOrigin == null && p.exists) {
    try { const { hasOrigin, slug } = await projectSlug(p.path); status.hasOrigin = hasOrigin; if (status.slug == null) status.slug = slug; } catch { /* leave null */ }
  }
  if (!status.present || !p.exists) return status;
  const r = await resolveProjectPolicy(p.path, { discover });
  if (!r.ok) {
    status.delegateState = r.reason === 'delegate-invalid' ? 'invalid' : null;
    status.delegateDetail = r.detail ?? null; status.delegateCode = r.code ?? null;
    status.blocked = r.code || r.reason;
    return status;
  }
  if (r.delegated) status.delegateState = 'ok';
  status.home = r.home; status.sha = r.sha; status.title = r.doc?.title || null; status.updatedAt = r.doc?.updatedAt || null; status.updatedBy = r.doc?.updatedBy || null;
  status.fieldCount = fieldCount(r.doc); status.caps = capSummary(r.doc); status.workspaceCaps = capSummary(r.doc, { workspaceRun: true });
  status.warnings = r.warnings || [];
  try { const hk = (await listProjects()).find((x) => samePath(x.path, r.homeDir)); status.homeKey = hk ? hk.key : null; } catch { /* optional */ }
  return status;
}

/** Workspace card status (board 6): the home, where each member's policy comes from. */
export async function workspacePolicyStatus(ws, { discover = false } = {}) {
  const members = [];
  let homeR = null;
  let home = { state: 'unset', path: null, slug: null, follows: null, detail: null, code: null };
  if (ws.policyProject) {
    const r = await resolveWorkspacePolicy(ws, { discover });
    homeR = r.ok ? r : null;
    home = r.ok
      ? { state: 'ok', path: ws.policyProject, slug: r.home, follows: r.delegated ? r.from : null, detail: null, code: null, sha: r.sha, title: r.doc?.title || null, updatedAt: r.doc?.updatedAt || null, workspaceCaps: capSummary(r.doc, { workspaceRun: true }), workspaceFields: Object.keys(r.doc?.workspaceRuns || {}).length,
        // What the workspaceRuns block CHANGES for workspace runs, by name (board 6): never the fall-through values.
        workspaceRuns: effectiveRows({ doc: r.doc, workspaceRun: true }).filter((x) => x.team?.fromWorkspaceRuns).map((x) => ({ key: x.key, label: x.label, display: x.team.display })) }
      : { state: 'stale', path: ws.policyProject, slug: null, follows: null, detail: r.detail || 'the policy home is stale', code: r.code || null };
  }
  for (const path of ws.projectPaths) {
    const prefs = await prefsFor(path, { discover }) || {};
    const isHome = !!ws.policyProject && samePath(path, ws.policyProject);
    let state; let policyFrom = null;
    if (isHome) { state = 'home'; policyFrom = homeR?.home ?? prefs.slug ?? null; }
    else if (prefs.hasOrigin === false) state = 'no-origin';
    else if (!prefs.present) state = 'none';
    else if (prefs.delegateTo) { state = homeR && prefs.delegateTo === homeR.home ? 'follows-home' : 'follows-other'; policyFrom = prefs.delegateTo; }
    else { state = homeR && prefs.slug === homeR.home ? 'is-home' : 'own'; policyFrom = prefs.slug; }
    members.push({ path, slug: prefs.slug ?? basename(path), state, policyFrom });
  }
  return { id: ws.id, name: ws.name, projectPaths: ws.projectPaths, home, members,
    counts: { onHome: members.filter((m) => m.state === 'home' || m.state === 'follows-home' || m.state === 'is-home').length, none: members.filter((m) => m.state === 'none' || m.state === 'no-origin').length } };
}

/** The ONE member whose policy resolves, or the home every resolving member shares; else null. */
export async function autoPolicyHome(ws) {
  const seen = new Map();   // home slug → { carrier, first }: a member that CARRIES the policy beats one that follows it
  for (const path of ws.projectPaths || []) {
    const r = await resolveProjectPolicy(path, { discover: false }).catch(() => null);
    if (!r?.ok) continue;
    const cur = seen.get(r.home) || { carrier: null, first: path };
    if (!r.delegated && !cur.carrier) cur.carrier = path;
    seen.set(r.home, cur);
  }
  if (seen.size !== 1) return null;
  const [{ carrier, first }] = seen.values();
  return carrier || first;
}

/** "Route all members to the policy home": one marker push per member without a branch. */
export async function routeWorkspaceMembersPolicy(workspaceId) {
  const r = await resolveWorkspacePolicy(workspaceId);
  if (!r.ok) throw policyError('NOT_ENABLED', r.detail || 'this workspace has no valid policy home');
  const results = [];
  for (const path of r.workspace.projectPaths) {
    if (samePath(path, r.workspace.policyProject)) continue;
    const prefs = (await discoverPolicy(path, { force: true }).catch(() => null)) || {};
    const slug = prefs.slug ?? basename(path);
    if (prefs.hasOrigin === false) { results.push({ path, slug, result: 'skipped', reason: 'no origin remote' }); continue; }
    if (prefs.present) { results.push({ path, slug, result: 'skipped', reason: prefs.delegateTo ? `already follows ${prefs.delegateTo}` : 'already carries its own policy' }); continue; }
    try { await enableTeamPolicy(path, { mode: 'follow', delegateTo: r.home }); results.push({ path, slug, result: 'routed' }); }
    catch (err) { results.push({ path, slug, result: 'failed', code: err.code || 'ERROR', error: err.message, stderr: err.stderr || null, hint: err.hint || null }); }
  }
  return { home: r.home, results };
}

/** Scope list + statuses in one call (Team policy page, Projects cells, workspace cards, Settings readout). */
export async function listPolicyScopes({ discover = false } = {}) {
  const projects = [];
  for (const p of await listProjects()) projects.push(await projectPolicyStatus(p, { discover }));
  const workspaces = [];
  for (const w of await listWorkspaces()) workspaces.push(await workspacePolicyStatus(w, { discover }));
  const homes = new Map();
  for (const s of projects) if (s.home && !homes.has(s.home)) homes.set(s.home, { slug: s.home, key: s.homeKey, title: s.title, caps: s.caps, workspaceCaps: s.workspaceCaps, usedBy: [] });
  for (const s of projects) if (s.home) homes.get(s.home).usedBy.push(s.slug);
  const scopes = {
    projects: projects.filter((s) => s.present && !s.blocked && !s.unknownSchema)
      .map((s) => ({ id: `project:${s.key}`, label: s.slug, name: s.name, home: s.home, follows: s.delegateState === 'ok' ? s.home : null })),
    workspaces: workspaces.filter((w) => w.home.state === 'ok')
      .map((w) => ({ id: `workspace:${w.id}`, label: w.name, home: w.home.slug })),
  };
  return { projects, workspaces, scopes, homes: [...homes.values()], anyEnabled: scopes.projects.length + scopes.workspaces.length > 0 };
}

/** UI server: discovery on start, then hourly (half-TTL interval, like metrics). Returns a stop function. */
export function startTeamPolicyBackground({ log = (m) => console.warn(m), onTick = null } = {}) {
  const tick = async (force) => {
    try { await discoverAllPolicies({ force }); } catch (err) { log(`[worca-ui] team policy discovery: ${err?.message || err}`); }
    if (onTick) { try { await onTick(); } catch (err) { log(`[worca-ui] team policy tick: ${err?.message || err}`); } }
  };
  tick(true);
  const timer = setInterval(() => tick(false), DISCOVERY_TTL_MS / 2);
  timer.unref?.();
  return () => clearInterval(timer);
}

export const _testing = { reset() { _queues.clear(); } };
