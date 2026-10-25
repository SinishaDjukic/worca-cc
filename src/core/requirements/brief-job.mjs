// src/core/requirements/brief-job.mjs
// The product brief job (plans/requirements-a7-design.md D3, D5, D8, D9, D13–D16, §5): one deeper read-only look at
// the default branch of a project or of a workspace's members makes or refreshes the scope's brief. Here: the
// refusals (nothing is written and nothing is called before they pass), the one deadline over checkout and call,
// the spend, the merge that keeps the product owner's words, recovery after a restart, the estimate, and the cheap
// staleness check of the brief page. A job never throws out: a failure is recorded on the brief row and an earlier
// brief is kept.
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tx } from '../db.mjs';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { listModels } from '../config.mjs';
import { budgetStatus, recordRequirementsCostDelta } from '../cost-budget.mjs';
import { openRepoLook, openWorkspaceRepoLook, REPO_LOOK_MAX_MEMBERS } from '../auto/repo-look.mjs';
import { worcaHome, listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { readWorkspace } from '../workspaces.mjs';
import { defaultBranchRef, commitOf, isAncestor } from '../worktree.mjs';
import { commitsAhead, commitFilesSince } from '../git-info.mjs';
import { RequirementsError } from './spec.mjs';
import { RoundError } from './round.mjs';
import { REQUIREMENTS_READ_DENY_RULES } from '../ask/deny-rules.mjs';
import { callModel, interviewModel } from './interview.mjs';
import {
  getContext, getBrief, beginBrief, saveBriefResult, failBrief, addBriefCost, listMakingBriefs, recentBriefCosts, listAttachments,
} from './store.mjs';
import { renderDocumentsForPrompt } from './attachments.mjs';
import {
  BRIEF_SYSTEM_PROMPT, BRIEF_OUT_OF_STEPS, buildBriefPrompt, normalizeBrief, mergeBrief, mockBrief, touchedAreas,
} from './brief.mjs';

/** At most this many briefs are made at once (separate from the interview's MAX_JOBS), one per scope. */
export const MAX_BRIEF_JOBS = 2;
export const BRIEF_MAX_TURNS = 40;
/** Bounds checkout and call together (D3). */
export const BRIEF_TIMEOUT_MS = 600_000;
/** Bounds the git calls the brief page makes on load (D9). */
export const STALENESS_TIMEOUT_MS = 10_000;
// Each git call of a page load gets a little longer than the page's race, so a git timeout never reads as an
// answer ("the branch is gone") before the race has said "slow"; it only reaps the process.
const GIT_TIMEOUT_MS = STALENESS_TIMEOUT_MS + 2_000;
/** Bounds the default-branch probes of a Create / Refresh press: longer than a page load's, as a member read too
 *  late there is refused by name (a brief is never made from the rest without saying so). */
export const BRIEF_PRESS_PROBE_MS = 30_000;
/** How long a repository's staleness check is remembered (tools/verify-requirements-cdp.mjs waits it out). */
export const MEMO_MS = 30_000;
const FILES_MAX = 2000;   // commitFilesSince's default page

const DEFAULTS = Object.freeze({
  runClaudeImpl: runClaude, listModels, listProjects, workspaceTarget, readWorkspace,
  openLook: openRepoLook, openWorkspaceLook: openWorkspaceRepoLook, budget: () => budgetStatus(), onChange: () => {},
  defaultBranchRef,
  // Mock mode (WORCA_MOCK) as a dep, so a test can switch it for one job without touching the process's env.
  mockEnabled: () => mockEnabled({}),
});
const CHECKOUT_TIMEOUT = 'Worca could not check out the code in time. Try again.';
const MIN_CALL_MS = 1_000;   // less than this left after the checkout: the checkout took the time

const jobs = new Map();   // '<scopeType>:<scopeKey>' → the job's promise
const jobKey = (scopeType, scopeKey) => `${scopeType}:${scopeKey}`;
export const isBriefBusy = (scopeType, scopeKey) => jobs.has(jobKey(scopeType, scopeKey));
/** Resolves when the scope's running brief job (if any) has finished. */
export const briefSettled = (scopeType, scopeKey) => jobs.get(jobKey(scopeType, scopeKey)) || Promise.resolve();

const message = (err) => (err && err.message ? err.message : String(err));
const coded = (code, msg) => Object.assign(new Error(msg), { code });
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const byKey = (a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0);
const hasGit = (dir) => { try { return !!dir && existsSync(join(dir, '.git')); } catch { return false; } };
const scratchDir = () => { const d = join(worcaHome(), 'tmp', 'requirements'); mkdirSync(d, { recursive: true }); return d; };

/** `p`, or `fallback` once `ms` have passed. */
function within(p, ms, fallback) {
  let timer;
  const late = new Promise((res) => { timer = setTimeout(() => res(fallback), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

function notify(d, scopeType, scopeKey) {
  try { d.onChange(scopeType, scopeKey); } catch (e) { console.error('requirements: brief onChange failed:', message(e)); }
}

// ---------------------------------------------------------------- the model and the call: A1.1's (design §9)

/** The brief's model and effort (D5): the interview's, `interviewModel(d)` (A1.1 D2). */
export async function briefModel(d) {
  return interviewModel(d);
}

/** The brief's one model call (D5) through A1.1's call path: a look (replace mode, the hermetic flags, the
 *  look's tools REPO_LOOK_TOOLS) with the brief's own system prompt and turn cap. callModel does not fill the
 *  effort, so the interview's effort is passed here. A8 (D15): the look reads summaries of the product owner's documents,
 *  third-party material, so it carries Ask's deny rules (REQUIREMENTS_READ_DENY_RULES: the checkout under tmp/requirements
 *  stays readable). */
function briefCall(d, { cwd, prompt, model, effort, timeoutMs }) {
  return callModel(d, {
    kind: 'look', cwd, prompt, model, ...(effort ? { effort } : {}), timeoutMs,
    systemPrompt: BRIEF_SYSTEM_PROMPT, maxTurns: BRIEF_MAX_TURNS, permissionRules: { deny: [...REQUIREMENTS_READ_DENY_RULES] },
  });
}

// ---------------------------------------------------------------- target

const SLOW_BASE = Symbol('slow');

/** Each dir with the default branch the look reads (D8) → `{ dirs, slow }`. A dir without a default branch is left
 *  out; one whose git did not answer within `probeMs` is left out too and named in `slow` (cannot tell, which is not
 *  "no repository"). An abandoned defaultBranchRef may keep running its git calls in the background until their own
 *  timeout (a little longer than `probeMs`) reaps them; nothing reads their answer. */
async function withBase(list, d, probeMs) {
  const gitMs = probeMs + (GIT_TIMEOUT_MS - STALENESS_TIMEOUT_MS);
  const out = await Promise.all(list.map(async (x) => ({
    ...x, base: await within(Promise.resolve(d.defaultBranchRef(x.dir, { timeout: gitMs })).catch(() => null), probeMs, SLOW_BASE),
  })));
  return {
    dirs: out.filter((x) => x.base && x.base !== SLOW_BASE),
    slow: out.filter((x) => x.base === SLOW_BASE).map((x) => x.name || x.project),
  };
}

/** What a brief of the scope looks at. Project: `{ name, dirs, slow }`; workspace: `{ name, description, seed, dirs,
 *  leftOut, slow }` (D13: members in key order, the first REPO_LOOK_MAX_MEMBERS repositories; `leftOut` names the ones
 *  past them, `slow` the ones whose default branch could not be read within `probeMs`: STALENESS_TIMEOUT_MS for a
 *  page load, BRIEF_PRESS_PROBE_MS for a press). A project folder needs its own `.git` (a folder inside another
 *  repository is not looked at, as the checkout requires). */
export async function briefTarget(scopeType, scopeKey, deps = {}, { probeMs = STALENESS_TIMEOUT_MS } = {}) {
  const d = { ...DEFAULTS, ...deps };
  if (scopeType === 'project') {
    const p = (await d.listProjects()).find((x) => x && x.key === scopeKey);
    const name = (p && p.name) || scopeKey;
    const { dirs, slow } = p && p.exists && hasGit(p.path) ? await withBase([{ project: scopeKey, name, dir: p.path }], d, probeMs) : { dirs: [], slow: [] };
    return { name, dirs, slow };
  }
  const ws = await d.workspaceTarget(scopeKey);
  if (!ws) return { name: scopeKey, description: '', seed: null, dirs: [], leftOut: [], slow: [] };
  const repos = [...(ws.members || [])].filter((m) => m && m.projectKey).sort(byKey).filter((m) => hasGit(m.projectDir));
  const leftOut = repos.slice(REPO_LOOK_MAX_MEMBERS).map((m) => m.projectName || m.projectKey);
  const description = String(ws.description || '');
  let seed = null;
  if (description.trim()) {
    let row = null;
    try { row = await d.readWorkspace(scopeKey); } catch { row = null; }
    const scannedAt = row && row.descriptionOrigin === 'generated' && row.mapSummary ? row.mapSummary.scannedAt : null;
    seed = scannedAt ? { kind: 'workspace-map', scannedAt } : { kind: 'workspace-description' };
  }
  const { dirs, slow } = await withBase(repos.slice(0, REPO_LOOK_MAX_MEMBERS)
    .map((m) => ({ project: m.projectKey, name: m.projectName || m.projectKey, dir: m.projectDir })), d, probeMs);
  return { name: ws.name || scopeKey, description, seed, dirs, leftOut, slow };
}

// ---------------------------------------------------------------- the job

function assertBriefBudget(d) {
  const b = d.budget();
  if (b && b.blocked) {
    throw new RequirementsError('BUDGET', `The spending limit${b.totalLimitUsd != null ? ` of $${b.totalLimitUsd}` : ''} is reached for this period. Worca can make the brief when the limit resets or is raised.`);
  }
}

function failureOf(err) {
  if (err instanceof RoundError) {
    const m = message(err);
    return { code: 'BAD_REPLY', message: m === BRIEF_OUT_OF_STEPS ? m : `Worca's reply could not be read (${m}). Try again.` };
  }
  return { code: (err && typeof err.code === 'string' && err.code) || 'FAILED', message: message(err) };
}

/** The look's cost on the brief row and its ledger row, in one transaction: both or neither. */
function book(id, costUsd, model) {
  if (!(costUsd > 0)) return;
  try {
    tx(() => {
      addBriefCost(id, costUsd);
      recordRequirementsCostDelta({ briefId: id, amountUsd: costUsd, model: model || null });
    });
  } catch (e) { console.error('requirements: could not book a brief look:', message(e)); }
}

/** The checkout's own path and its real path (the Read tool may report either). */
function cwdsOf(cwd) {
  const out = [cwd];
  try { const real = realpathSync(cwd); if (real !== cwd) out.push(real); } catch { /* gone: the path as given */ }
  return out;
}

async function mockSources(target) {
  const out = [];
  for (const x of target.dirs) {
    out.push({ project: x.project, branch: x.base.branch, ref: x.base.ref, sha: await commitOf(x.dir, x.base.ref, { timeout: GIT_TIMEOUT_MS }) });
  }
  return out;
}

/** Starts the job and registers it under the scope's key before any of its code can settle it: the job's body
 *  begins after one await, so even a failure that throws synchronously (the scratch folder, a checkout that throws
 *  at once) runs its `finally` after the registration, and the `finally` removes only its own entry. */
function runJob(row, target, scopeType, scopeKey, by, d) {
  const key = jobKey(scopeType, scopeKey);
  let self = null;
  self = (async () => {
    await null;
    const deadline = Date.now() + BRIEF_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BRIEF_TIMEOUT_MS);
    let look = null;
    let model = null;
    let effort = null;
    let cost = 0;
    try {
      let fresh;
      let sources;
      if (d.mockEnabled()) {
        fresh = mockBrief(target.name);
        sources = await mockSources(target);
      } else {
        const scratch = scratchDir();
        if (scopeType === 'project') {
          const x = target.dirs[0];
          look = await d.openLook(x.dir, scratch, { signal: ctrl.signal, ref: x.base.ref });
        } else {
          look = await d.openWorkspaceLook(target.dirs.map((x) => ({ projectKey: x.project, projectName: x.name, projectDir: x.dir })), scratch,
            { signal: ctrl.signal, refs: Object.fromEntries(target.dirs.map((x) => [x.project, x.base.ref])) });
        }
        if (ctrl.signal.aborted) throw coded('TIMEOUT', CHECKOUT_TIMEOUT);
        if (!look) throw coded('NO_REPO', 'Worca could not check out the code. Try again.');
        ({ model, effort } = await briefModel(d));
        assertBriefBudget(d);   // again: the limit may have been reached since the press (a recorded failure now)
        const now = getBrief(scopeType, scopeKey);
        const members = look.members || null;
        const docs = listAttachments('brief', row.id);   // A8 D6: the brief's documents, the product owner's material
        const prompt = buildBriefPrompt({
          scopeName: target.name, notes: getContext(scopeType, scopeKey).body, workspaceDescription: target.description || '',
          current: now && now.madeAt ? now.sections : null, edited: (now && now.edited) || {}, members, cwd: look.cwd,
          documents: docs.length ? renderDocumentsForPrompt(docs) : '',
        });
        const timeoutMs = deadline - Date.now();
        if (timeoutMs < MIN_CALL_MS) throw coded('TIMEOUT', CHECKOUT_TIMEOUT);   // not "no reply within 0 seconds"
        let reply;
        try { reply = await briefCall(d, { cwd: look.cwd, prompt, model: model || undefined, effort, timeoutMs }); }
        catch (err) { cost = Number(err?.costUsd) || 0; throw err; }
        cost = Number(reply.costUsd) || 0;
        fresh = normalizeBrief(reply.text, { cwds: cwdsOf(look.cwd), members });   // while the checkout is still there
        sources = scopeType === 'project'
          ? [{ project: target.dirs[0].project, branch: target.dirs[0].base.branch, ref: target.dirs[0].base.ref, sha: look.commit || null }]
          : target.dirs.filter((x) => (members || []).includes(x.project))
            .map((x) => ({ project: x.project, branch: x.base.branch, ref: x.base.ref, sha: (look.commits && look.commits[x.project]) || null }));
      }
      // The row as it is now: the product owner may have edited it while the look ran (D6).
      const merged = mergeBrief(getBrief(scopeType, scopeKey), fresh);
      saveBriefResult(row.id, { sections: merged.sections, edited: merged.edited, sources, files: fresh.files, seed: target.seed || null, model }, { by });
    } catch (err) {
      try { failBrief(row.id, failureOf(err)); } catch (e) { console.error('requirements: could not record a failed brief:', message(e)); }
    } finally {
      clearTimeout(timer);
      book(row.id, cost, model);
      if (look) { try { await look.close(); } catch (e) { console.error('requirements: could not close a brief look:', message(e)); } }
      if (jobs.get(key) === self) jobs.delete(key);
      notify(d, scopeType, scopeKey);
    }
  })();
  jobs.set(key, self);
  return self;
}

/**
 * Create or refresh the scope's brief. Refuses (throws RequirementsError) before anything is written or called:
 * the switch off, no repository or default branch, already being made, MAX_BRIEF_JOBS running, the budget.
 * Resolves, once the job has started, to `{ brief, job, target }`: the row now `making`, the job's promise (which
 * never rejects; callers need not await it) and the briefTarget the refusals read (the route reuses it rather than
 * probing git again). The refusals need the target's git probes, hence the promise.
 */
export async function makeBrief(scopeType, scopeKey, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const where = scopeType === 'workspace' ? 'workspace' : 'project';
  const assertSwitchOn = () => {
    if (!getContext(scopeType, scopeKey).lookAtCode) {
      throw new RequirementsError('CONFLICT', `Looking at the code is off for this ${where}. Turn it on under Your notes for Worca.`);
    }
  };
  assertSwitchOn();   // before the git probes: no git runs with the switch off
  const target = await briefTarget(scopeType, scopeKey, d, { probeMs: BRIEF_PRESS_PROBE_MS });
  // From here to the job's start nothing awaits: two presses cannot both pass the checks below.
  assertSwitchOn();   // again: it may have been turned off while the target was read
  const slow = target.slow || [];
  // A workspace member still unread after the press's probe budget is refused by name: a brief made from the rest
  // would later say that member "joined after this brief".
  if (scopeType === 'workspace' && slow.length) throw new RequirementsError('CONFLICT', `Worca could not read ${joinAnd(slow)} in time. Try again.`);
  if (!target.dirs.length) {
    if (slow.length) throw new RequirementsError('CONFLICT', 'Worca could not read the repository in time. Try again.');
    throw new RequirementsError('CONFLICT', 'There is no repository to look at.');
  }
  if (isBriefBusy(scopeType, scopeKey)) throw new RequirementsError('BUSY', 'Worca is already making this brief.');
  if (jobs.size >= MAX_BRIEF_JOBS) throw new RequirementsError('BUSY', 'Worca is making other briefs; try again in a moment.');
  assertBriefBudget(d);
  const row = beginBrief(scopeType, scopeKey, { by });
  const job = runJob(row, target, scopeType, scopeKey, by, d);   // registers itself under the scope's key
  notify(d, scopeType, scopeKey);
  return { brief: row, job, target };
}

/** Boot sweep (D15): a brief left `making` by a restart, whose job is not running, gets INTERRUPTED. */
export function recoverBriefs() {
  let n = 0;
  for (const b of listMakingBriefs()) {
    if (isBriefBusy(b.scopeType, b.scopeKey)) continue;
    failBrief(b.id, { code: 'INTERRUPTED', message: 'The look at the code did not finish because Worca restarted. Try again.' });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------- estimate

/** What the next brief look likely costs (median of the last 10, in cents; null without any) and with which model. */
export async function briefEstimate(deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const costs = recentBriefCosts(10).filter((c) => Number.isFinite(c)).sort((a, b) => a - b);
  let costUsd = null;
  if (costs.length) {
    const m = costs.length >> 1;
    const median = costs.length % 2 ? costs[m] : (costs[m - 1] + costs[m]) / 2;
    costUsd = Math.round(median * 100) / 100;
  }
  const { model: id } = await briefModel(d);
  if (!id) return { costUsd, model: null };
  let label = id;
  try { const e = (await d.listModels(null)).find((x) => x && x.id === id); if (e && e.label) label = e.label; } catch { /* the id */ }
  return { costUsd, model: { id, label } };
}

// ---------------------------------------------------------------- staleness (D9)

const STALENESS_DEFAULTS = Object.freeze({
  listProjects, workspaceTarget,
  commitOf: (dir, ref) => commitOf(dir, ref, { timeout: GIT_TIMEOUT_MS }),
  isAncestor: (dir, a, b) => isAncestor(dir, a, b, { timeout: GIT_TIMEOUT_MS }),
  commitsAhead: (dir, a, b) => commitsAhead(dir, a, b, { timeout: GIT_TIMEOUT_MS }),
  commitFilesSince: (dir, a, b) => commitFilesSince(dir, a, b, { timeout: GIT_TIMEOUT_MS }),
});
// '<id>:<madeAt>' → { at, git }: only the git part (per source: the entry, its commits' files, partial). The areas
// are matched against the brief as it is on every call: the owner may edit or add areas without a new made_at.
const memo = new Map();
const SLOW = Object.freeze({ known: false, reason: 'slow' });

/** One source in its project's own checkout, no model. → `{ entry, commits, partial }`. */
async function checkSource(src, dir, d) {
  const ref = src.ref || `refs/heads/${src.branch}`;
  const base = { project: src.project, branch: src.branch || null, ref, sha: src.sha };
  const no = (reason) => ({ entry: { ...base, known: false, reason }, commits: [], partial: false });
  if (!dir || !existsSync(dir)) return no('missing');
  if (!(await d.commitOf(dir, ref))) return no('branch-gone');
  if (!(await d.isAncestor(dir, src.sha, ref))) return no('rewritten');
  const n = await d.commitsAhead(dir, src.sha, ref);
  if (n == null) return no('rewritten');
  const list = await d.commitFilesSince(dir, src.sha, ref);
  if (!list) return no('slow');
  const commits = Array.isArray(list.commits) ? list.commits : [];
  // partial: more commits than the file scan reads, or the scan came back full (it saw only the newest page)
  return { entry: { ...base, known: true, commits: n }, commits, partial: n > FILES_MAX || commits.length >= FILES_MAX };
}

/** The git part of a project brief's check: `{ results: [checkSource result] }`. */
async function gitProject(brief, src, d) {
  const p = (await d.listProjects()).find((x) => x && x.key === brief.scopeKey);
  return { results: [await checkSource(src, p && p.exists !== false ? p.path : null, d)] };
}

/** The git part of a workspace brief's check: the results of the members still in the workspace (a removed member
 *  is not counted at all), with their names, and the members added since the brief. */
async function gitWorkspace(brief, sources, d) {
  const ws = await d.workspaceTarget(brief.scopeKey);
  const members = [...((ws && ws.members) || [])].filter((m) => m && m.projectKey).sort(byKey);
  const byProject = new Map(members.map((m) => [m.projectKey, m]));
  const names = Object.fromEntries(members.map((m) => [m.projectKey, m.projectName || m.projectKey]));
  const results = await Promise.all(sources.filter((s) => byProject.has(s.project)).map((s) => checkSource(s, byProject.get(s.project).projectDir, d)));
  const covered = new Set((brief.sources || []).map((s) => s && s.project));
  const added = members.filter((m) => hasGit(m.projectDir)).slice(0, REPO_LOOK_MAX_MEMBERS)
    .filter((m) => !covered.has(m.projectKey)).map((m) => m.projectName || m.projectKey);
  return { results, names, added };
}

/** The staleness result from the git part and the brief's current areas (run on every call, memo or not). */
function staleness(brief, src, git) {
  const touched = (known) => touchedAreas(brief.sections, brief.edited, known.map((r) => ({ project: r.entry.project, commits: r.commits })));
  if (brief.scopeType !== 'workspace') {
    const r = git.results[0];
    if (!r.entry.known) return { known: false, reason: r.entry.reason, branch: src.branch || null, sha: src.sha };
    const t = touched([r]);
    return { known: true, commits: r.entry.commits, touching: t.touching, areas: t.areas, checked: t.checked, partial: r.partial, sources: [r.entry] };
  }
  const known = git.results.filter((r) => r.entry.known);
  const unknown = git.results.filter((r) => !r.entry.known).map((r) => git.names[r.entry.project] || r.entry.project);
  const entries = git.results.map((r) => r.entry);
  // every member the brief was made from has left the workspace (or the workspace is gone): nothing to check
  if (!git.results.length) return { known: false, reason: 'removed', unknown, added: git.added, sources: entries };
  if (!known.length) return { known: false, reason: (entries[0] && entries[0].reason) || 'missing', unknown, added: git.added, sources: entries };
  const t = touched(known);
  return {
    known: true, commits: known.reduce((n, r) => n + r.entry.commits, 0), touching: t.touching, areas: t.areas, checked: t.checked,
    partial: known.some((r) => r.partial), unknown, added: git.added, sources: entries,
  };
}

const isSlow = (git) => git.results.some((r) => r.entry.reason === 'slow');

/**
 * How far the code moved on since the brief (D9), or null when there is nothing to compare (never made, no
 * source with a sha). The whole check is raced against STALENESS_TIMEOUT_MS ("slow"). The git part is memoised 30 s
 * per brief and made_at (one that says "slow" anywhere is not kept); the areas are matched afresh on every call.
 */
export async function briefStaleness(brief, deps = {}) {
  if (!brief || !brief.madeAt) return null;
  const sources = (brief.sources || []).filter((s) => s && typeof s.sha === 'string' && s.sha && s.project);
  if (!sources.length) return null;
  const key = `${brief.id}:${brief.madeAt}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return staleness(brief, sources[0], hit.git);
  const d = { ...STALENESS_DEFAULTS, ...deps };
  const run = brief.scopeType === 'workspace' ? gitWorkspace(brief, sources, d) : gitProject(brief, sources[0], d);
  let git;
  try { git = await within(run, STALENESS_TIMEOUT_MS, SLOW); } catch { git = SLOW; }
  if (git === SLOW) return { ...SLOW };
  const now = Date.now();
  for (const [k, v] of memo) if (now - v.at >= MEMO_MS) memo.delete(k);
  if (isSlow(git)) memo.delete(key);
  else memo.set(key, { at: now, git });
  return staleness(brief, sources[0], git);
}
