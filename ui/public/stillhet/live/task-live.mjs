// ui/public/stillhet/live/task-live.mjs — the live kind's Tasks I/O (Stillhet Tasks, D4, D5, D13): the only owner of task
// fetches, the PR checks cache and every Tasks action. live-adapter.mjs starts it and sets window.RailTaskLive. The page
// (runs/run-page-model.js, run-page.js), the bar's list, the center and the chat TaskCard read from here; none of them
// writes before a route answers `ok`.
import { actionRunner, FLOW as CHAT_FLOW, openTab, resumeBody } from './chat-live.mjs';
import { questionsOf, taskPageOf, taskCardOf, newTaskBodyOf, patchFiles, docsOf, logLinesOf, logStepsOf, actionsOf, groupOf, planOf, sessionRowsOf, agentRowsOf, usageRowsOf, commentsByPath } from './task-page.mjs';
import { ENGINES, ENGINE_NAMES, engineLabel } from '../../../../src/shared/engine-switch.mjs';

const str = (v) => (typeof v === 'string' ? v : '');
const enc = encodeURIComponent;
const lc = (v) => str(v).toLowerCase();
const arr = (v) => (Array.isArray(v) ? v : []);
export const CHECKS_FRESH_MS = 60_000;
export const CHECKS_IN_FLIGHT = 2;
const prNum = (url) => (/\/(\d+)\/?$/.exec(str(url)) || [])[1] || '';
/** The cap dialog's text as dollars: "$180", "1,200" or "180.5" → a number; anything else → NaN (refused before posting). */
export const capOf = (v) => { const t = String(v ?? '').replace(/[$,\s]/g, ''); return /^\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN; };

/** The ten Tasks actions (Step 7): id → [ACTION words, args → [method, url, body]]. `a` carries the task's scope. */
export const TASK_ACTIONS = Object.freeze({
  merge: [(a) => `merge #${a.prNumber || prNum(a.pr)}`, (a) => ['POST', '/api/pr/merge', prScope(a)]],
  'rerun-checks': ['run the checks again', (a) => ['POST', '/api/pr/rerun-checks', prScope(a)]],
  'fix-checks': ['start the checks fix', (a) => ['POST', '/api/pr/fix-checks', prScope(a)]],
  // every resume is classic's resumeBody (F-G-G2-03): baseCheck, then baseAck once you said Resume anyway
  'raise-cap': ['raise the cap', (a) => ['POST', '/api/resume', resumeBody(a.pipelineId, { baseAck: a.baseAck, costCapUsd: capOf(a.value) })]],
  resume: ['resume the task', (a) => ['POST', '/api/resume', resumeBody(a.pipelineId, { baseAck: a.baseAck, ...(a.ignoreCostCap ? { ignoreCostCap: true } : {}) })]],
  retry: ['retry the task', (a) => (a.recoveryId
    ? ['POST', '/api/answer', { runId: a.runId, id: a.recoveryId, payload: { decision: 'retry' } }]
    : ['POST', '/api/resume', resumeBody(a.pipelineId, { baseAck: a.baseAck })])],
  'restart-build': ['restart Build', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/restart-build`, {}]],
  'plan-approve': ['approve the plan', (a) => ['POST', `/api/runs/${enc(a.runId)}/answer`, { id: a.questionId, decision: 'approve' }]],
  'new-task': ['start the task', (a) => ['POST', '/api/run', a.body]],
  'pause-after-step': ['pause after this step', (a) => ['POST', '/api/pause', { runId: a.runId, afterStep: true }]],
  report: ['report this task', (a) => ['POST', `/api/pipelines/${enc(a.pipelineId)}/report-issue`, { reason: a.reason, expectation: str(a.value) }]],
  // the run page's own tools, on dev's run routes (the scope rides the query, as dev's run page sends it)
  checkout: ['check out the branch', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/checkout?${scopeQ(a)}`, {}]],
  apply: ['apply the kept work', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/apply-retained?${scopeQ(a)}`, {}]],
  discard: ['discard the kept work', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/discard-worktree?${scopeQ(a)}`, {}]],
  // the worktree's tools (dev's run Actions, ui/routes/runs/checkout-and-actions.mjs): a shell, a service, a built-in tool
  terminal: ['open a terminal in the worktree', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/terminal?${scopeQ(a)}`, memberOf(a)]],
  'service-start': [(a) => `start ${a.name || 'the service'}`, (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/actions/${enc(a.actionId)}/start?${scopeQ(a)}`, memberOf(a)]],
  'service-stop': [(a) => `stop ${a.name || 'the service'}`, (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/actions/${enc(a.actionId)}/stop?${scopeQ(a)}`, memberOf(a)]],
  builtin: [(a) => `open ${a.name || 'the tool'}`, (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/builtins/${enc(a.builtin)}?${scopeQ(a)}`, memberOf(a)]],
  // Save as preset is dev's run-page save (POST /api/pipelines/:id/preset): the run's own stored setup, under a name
  preset: ['save the preset', (a) => ['POST', `/api/pipelines/${enc(a.pipelineId)}/preset`, { name: str(a.value).trim(), scope: { kind: str(a.projectKey).startsWith('workspaces/') ? 'workspace' : 'project' } }]],
  // Switch model and Resume at… are dev's resume with a model and dev's timed resume (POST /api/schedules/resume)
  'switch-model': ['switch the model', (a) => ['POST', '/api/resume', resumeBody(a.pipelineId, { baseAck: a.baseAck, model: a.model })]],   // classic's resumeBody (F-cov23-08)
  'resume-at': ['schedule the resume', (a) => ['POST', '/api/schedules/resume', { pipelineId: a.pipelineId, scheduledFor: a.scheduledFor }]],
  // Publish branch (dev's `git push -u`), a task's away mode, a diff line's comment
  publish: ['publish the branch', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/publish`, { ...(a.projectKey ? { projectKey: a.projectKey } : { projectDir: a.projectDir }), ...(a.memberKey ? { memberKey: a.memberKey } : {}) }]],
  night: ['set Away mode on this task', (a) => ['POST', '/api/run/night', { runId: a.runId, mode: a.mode }]],
  labels: ['change the labels', (a) => ['PUT', `/api/runs/${enc(a.pipelineId)}/labels`, { labels: a.labels }]],
  tags: ['change the cost tags', (a) => ['PUT', `/api/runs/${enc(a.pipelineId)}/tags`, { tags: a.tags.map((t) => String(t).replace(/:\s*/, ':')) }]],
  comment: ['add the comment', (a) => ['POST', `${runUrl(a.projectKey, a.pipelineId)}/comments`, { ...(wsOf(a.projectKey) && a.member ? { project: a.member } : {}), path: a.path, side: a.side, line: a.line, body: str(a.value).trim() }]],
  // a workspace's stack: its members' services started in order, or stopped newest first (dev's run Actions)
  'stack-start': [(a) => `start ${a.name || 'the stack'}`, (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/stacks/${enc(a.stackId)}/start?${scopeQ(a)}`, {}]],
  // a group's Create PR (dev's Ship it): a user group's one PR or separate PRs, a feature's one PR or stacked PRs
  'ship-group': [(a) => (a.ship === 'one' ? 'create the PR' : 'create the PRs'), (a) => ['POST', a.groupKind === 'Feature' ? `/api/shape/features/${enc(a.groupId)}/ship` : `/api/run-groups/${enc(a.groupId)}/ship`, { mode: a.ship }]],
  'stack-stop': [(a) => `stop ${a.name || 'the stack'}`, (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/stacks/${enc(a.stackId)}/stop?${scopeQ(a)}`, {}]],
  // a review gate's two answers, as the classic gate card sends them (ui/public/shape/step-card.mjs renderGateCard); the
  // id is the pending gate's, read at act time (B1.6 D3)
  'gate-continue': ['accept the review as is', (a) => ['POST', '/api/answer', { runId: a.runId, id: a.gateId, payload: { decision: 'continue' } }]],
  'gate-another': ['run another cycle', (a) => ['POST', '/api/answer', { runId: a.runId, id: a.gateId, payload: { decision: 'another' } }]],
  // COV-3: classic's run extras. Restore of one task is History's per-run route, scoped as runActionQuery scopes it, with no
  // body; a direction goes straight to the run (classic's Pinpoint "Send to run"); Resume on ‹Engine› is the run banner's
  // and Resume ▾'s resume on the other engine, in classic's resumeBody
  restore: ['restore the task', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/restore?${a.qs}`, undefined]],
  'run-direction': ['send the direction', (a) => ['POST', `/api/runs/${enc(a.pipelineId)}/directions`, { text: a.text }]],
  'resume-engine': ['resume on the other engine', (a) => ['POST', '/api/resume', resumeBody(a.pipelineId, { baseAck: a.baseAck, engine: a.engine })]],
});
// a workspace task's store key is `workspaces/ID`: its saved run, log, diff and comments are dev's workspace routes
// (ui/routes/workspace-map/runs.mjs, run-comments.mjs); a project's are History's
const wsOf = (key) => (str(key).startsWith('workspaces/') ? str(key).slice('workspaces/'.length) : '');
const runUrl = (key, pid) => (wsOf(key) ? `/api/workspaces/${enc(wsOf(key))}/runs/${enc(pid)}` : `/api/history/${enc(key)}/${enc(pid)}`);
// the actions a workspace task takes for one member project: memberKey on the PR routes and publish, member on the shell
const MEMBER_ACTS = new Set(['merge', 'rerun-checks', 'fix-checks', 'publish', 'terminal']);
const memberOf = (a) => (str(a.projectKey).startsWith('workspaces/') && a.member ? { member: a.member } : {});
/** "15:30" → the next 15:30 from `now`, as ISO (today if it is still ahead, else tomorrow); '' for anything else. */
export function nextAt(value, now) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(str(value)); if (!m || +m[1] > 23 || +m[2] > 59) return '';
  const d = new Date(now); d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
// a workspace task's store key is `workspaces/ID`: dev's run routes take it as workspaceId (chat-live.mjs patchUrl)
/** classic's runActionQuery (app.js): a workspace row's id without its prefix, else its store key, else its folder; null
 *  when the task names none (its restore then goes through dev's bulk route, which finds a run by its id alone). */
function scopeQuery(r) {
  const qs = new URLSearchParams(), key = str(r.projectKey);
  if (key.startsWith('workspaces/')) qs.set('workspaceId', key.slice('workspaces/'.length));
  else if (key) qs.set('projectKey', key);
  else if (str(r.projectDir)) qs.set('projectDir', r.projectDir);
  else return null;
  return qs;
}
const scopeQ = (a) => (str(a.projectKey).startsWith('workspaces/') ? `workspaceId=${enc(a.projectKey.slice('workspaces/'.length))}`
  : a.projectKey ? `projectKey=${enc(a.projectKey)}` : `projectDir=${enc(a.projectDir)}`);
function prScope(a) { return { id: a.pipelineId, ...(a.projectKey ? { projectKey: a.projectKey } : { projectDir: a.projectDir }), ...(a.memberKey ? { memberKey: a.memberKey } : {}) }; }
const wordsOf = (id, a) => { const w = TASK_ACTIONS[id]?.[0]; return typeof w === 'function' ? w(a) : w || id; };

/** The bar's row menu and bulk bar (D17), on dev's routes: id → [words, args → [method, url, body]]. */
export const LIST_ACTIONS = Object.freeze({
  stop: ['stop the task', (a) => ['POST', '/api/stop', a.runId ? { runId: a.runId } : { pipelineId: a.pipelineId }]],
  archive: ['archive the tasks', (a) => ['POST', '/api/runs/bulk', { action: 'archive', targets: a.pipelineIds.map((pipelineId) => ({ pipelineId })) }]],
  // restore and delete go through dev's bulk route as its Runs list does: it finds each run by id, so an archived row the
  // store no longer holds restores without its project, and delete is dev's purge (DELETE /api/runs/:id only archives)
  restore: ['restore the task', (a) => ['POST', '/api/runs/bulk', { action: 'restore', targets: a.pipelineIds.map((pipelineId) => ({ pipelineId })) }]],
  delete: ['delete the task', (a) => ['POST', '/api/runs/bulk', { action: 'delete', targets: a.pipelineIds.map((pipelineId) => ({ pipelineId })) }]],
  label: ['label the task', (a) => ['PUT', `/api/runs/${enc(a.pipelineId)}/labels`, { labels: a.labels }]],
  'label-bulk': ['label the tasks', (a) => ['POST', '/api/runs/bulk/labels', { pipelineIds: a.pipelineIds, ...(a.add ? { add: a.add } : { remove: a.remove }) }]],
  'add-to-group': ['add them to the group', (a) => ['POST', `/api/run-groups/${enc(a.groupId)}/members`, { pipelineIds: a.pipelineIds }]],
  'new-group': ['make the group', (a) => ['POST', '/api/run-groups', { title: a.title, pipelineIds: a.pipelineIds }]],
  'leave-group': ['remove it from the group', (a) => ['DELETE', `/api/run-groups/members/${enc(a.pipelineId)}`]],
  'undo-group': ['undo that', (a) => ['POST', '/api/run-groups/undo', { token: a.token }]],
});

// The rest of the page's run-state labels, onto dev's routes (Step 7): the shared ones are Chat's FLOW.
const TASK_FLOW = Object.freeze({
  'Merge PR': { act: 'merge' }, Merge: { act: 'merge' }, 'Re-run checks': { act: 'rerun-checks' }, 'Fix checks': { act: 'fix-checks' },
  'Raise the cap': { act: 'raise-cap' },
  // F-G-G2-03: the page's resumes are the Tasks resume (baseCheck, and Resume anyway on a moved base); a card's stay Chat's
  Resume: { act: 'resume' }, 'Resume now': { act: 'resume' }, 'Continue without cap': { act: 'resume', args: { ignoreCostCap: true } },
  // F-G-G2-02: a live task's own questions, answered on dev's answer route as Chat answers them under its card
  'Send answer': { act: 'answer' }, 'Use the default answer': { act: 'answer', args: { defaults: true } }, Retry: { act: 'retry' }, 'Try again': { act: 'retry' }, 'Restart Build': { act: 'restart-build' },
  'Approve and build': { act: 'plan-approve' }, Approve: { act: 'plan-approve' }, 'Start a new task': { act: 'new-task' },
  'Pause after this step': { act: 'pause-after-step' }, 'Report this task': { act: 'report' }, Report: { act: 'report' },
  'Copy link': { copyLink: true },
  'Check out': { act: 'checkout' }, 'Apply to branch': { act: 'apply' },
  // Discard is dev's discard-worktree only where the design means the kept work; elsewhere it is not offered live
  Discard: { act: 'discard', cases: ['kept', 'failed-kept'] },
  // a plan waiting for approval: Ask for changes is slice 4's plan-changes (dev's answer with decision revise)
  'Ask for changes': { act: 'plan-changes', cases: ['plan'] },
  Terminal: { act: 'terminal' }, 'Save as preset': { act: 'preset' }, 'Switch model…': { act: 'switch-model' }, 'Resume at…': { act: 'resume-at' },
  'Try it': { act: 'try-it' }, 'Publish branch': { act: 'publish' }, 'Ship group': { act: 'ship-group' },
  // a task waiting at its review gate (B1.6): dev's answer API, on the gate case only
  'Accept as is': { act: 'gate-continue', cases: ['gate'] }, 'Run another cycle': { act: 'gate-another', cases: ['gate'] },
  // COV-3: Restore only on an archived task (canFlow reads its row); a direction to a live, unfinished run; Resume on ‹Engine›
  Restore: { act: 'restore' }, 'Send a direction': { act: 'run-direction' }, 'Resume on…': { act: 'resume-engine' },
});
const NEEDS_PR = new Set(['Merge PR', 'Merge', 'Fix checks', 'Re-run checks']);
// the page's own: a card has no TerminalPane to draw the shell in and no model list for Switch model…
// (COV-3: a card's Send a direction is its chat's own, and only the page lists the other engines)
const PAGE_ONLY = new Set(['Terminal', 'Switch model…', 'Send a direction', 'Resume on…']);
const FAILED_OR_STUCK = new Set(['failed', 'failed-kept', 'stopped', 'error', 'recovery', 'interrupted-dead']);
const BASE_PROMPT = new Set(['base-moved', 'base-missing']);
const RESUMES = new Set(['retry', 'resume', 'raise-cap', 'switch-model', 'resume-engine']);   // dev's resume: a moved base asks first
// what a live task may do before its run names its pipeline (B1.9 D3, D4): these post only the run id, or no pipeline id
const RUN_ID_ACTS = new Set(['pause-after-step', 'night', 'plan-approve', 'plan-changes', 'gate-continue', 'gate-another', 'new-task', 'answer']);
const RUN_ID_LABELS = new Set(['Pause', 'Pause now', 'Stop', 'Copy link']);
const STARTING = 'the task is still starting; try again in a moment';

export function startTaskLive({ fetch, toast = () => {}, now = Date.now, open = openTab, runOf = () => ({}), rowOf = () => null,
  liveOf = () => null, flag = () => false, listLoaded = () => true, listFailed = () => false, retryList = null, retryPrs = () => {}, prLookup = () => ({ token: 0, ended: false }), chat = null, clipboard = null, origin = '', projectDirOf = () => '' } = {}) {
  const fns = new Set(), checkFns = new Set();   // checkFns: told only when a checks entry lands (the store's rows read it)
  const notify = (id) => { for (const fn of fns) { try { fn(id); } catch (e) { console.error(e); } } };
  const runner = actionRunner({ fetch, toast, notify });
  const { request, refuse } = runner;
  const tasks = new Map();     // id → { state, detail, loading }
  const checks = new Map();    // pipelineId → { at, data, loading }
  const queue = []; let inFlight = 0;
  // A resume runs the pipeline under a new run id and drops the old one: a page or card still holding either run id
  // keeps finding its task through the pipeline id it last resolved to.
  const alias = new Map();   // run id → pipeline id
  const keptLabels = new Map();   // task id → the labels dev saved, until the store's row reads them too
  // COV-3 #11: an id no source holds is asked of dev's run links once (classic's bounceUnknownRun): null while asked, then
  // its pipeline id, or '' when dev knows no saved run for it
  const linked = new Map();
  const linkRetry = new Set();   // ids whose lookup failed without a definitive answer (a network failure, a 5xx)

  /** The task's ids and scope, by its run id or its pipeline id (D1). null when neither the runs nor the store know it. */
  function resolve(id) {
    const r = resolveOne(id);
    if (r) { if (r.pipelineId && r.pipelineId !== id) alias.set(id, r.pipelineId); return r; }
    const p = alias.get(id);
    const via = p && p !== id ? resolveOne(p) : null;
    return via ? { ...via, id } : null;
  }
  function resolveOne(id) {
    if (!id) return null;
    const live = liveOf(id) || null, s = runOf(id) || {}, row = rowOf(id);
    const pipelineId = str(live?.pipelineId) || str(s.pipelineId) || (live ? '' : str(row?.id) || '');
    if (!live && !row) return null;   // neither the runs nor the store hold it (runOf answers any id with itself)
    // pidKnown (B1.9 D1): a live run's pipeline id is real only once its frames name it; until then `pipelineId` is its run id
    // and no request may carry it
    return { id, runId: str(live?.runId) || (live ? id : ''), pipelineId: pipelineId || id, projectKey: str(s.projectKey) || str(live?.projectKey),
      projectDir: str(s.projectDir) || str(live?.projectDir), live, pidKnown: !live || !!str(live.pipelineId) };
  }
  /** A workspace task's member projects (its saved run's `projects`): [{ key, name, folder, branch }]; [] for a project's task.
   *  `branch`: the project made a feature branch (its `branches[KEY].feature`, src/core/workspace-prs.mjs workspaceMembers). */
  function membersOf(id) {
    const r = resolve(id); if (!r || !wsOf(r.projectKey)) return [];
    const d = tasks.get(id)?.detail, st = arr(d?.projects).length ? d : r.live?.state;   // not inputOf: it reads the checks
    const branches = st?.branches && typeof st.branches === 'object' ? st.branches : {};
    return arr(st?.projects).filter((p) => p && str(p.projectKey))
      .map((p) => ({ key: str(p.projectKey), name: str(p.projectName) || str(p.projectKey), folder: p.workMode === 'folder', branch: p.workMode !== 'folder' && !!str(branches[p.projectKey]?.feature) }));
  }
  /** The member a workspace task's PR is on: its only member with a feature branch; '' when several have one (each its own PR) or none. */
  function memberKeyOf(id) { const g = membersOf(id).filter((m) => m.branch); return g.length === 1 ? g[0].key : ''; }
  const entry = (id) => { if (!tasks.has(id)) tasks.set(id, { state: 'loading', detail: null, loading: null }); return tasks.get(id); };

  /** Load a task page (§3): loading until the store's first load answered and the detail is in; gone when neither the runs
   *  nor the store hold it, or History answers 404 for a task no run holds; failed on a 5xx or a network failure. */
  function openTask(id, { force = false } = {}) {
    const e = entry(id);
    if (force) retryPrs();   // Try again: a PR lookup that failed is asked again, so an open PR never reads Create PR
    if (e.loading) return e.loading;
    if (e.state === 'ready' && !force) { refreshChecks(id, { force: true }); return Promise.resolve(e); }
    // still waiting on the list: says so only on a change (a listener that routes again must not loop)
    // the list's first load failed: the page reads failed (state()); its Try again reads the list again (D15)
    if (!listLoaded() && listFailed() && force && retryList) {
      e.loading = (async () => { const p = retryList(); notify(id); try { await p; } catch { /* the list's own look says it failed */ } e.loading = null; notify(id); return e; })();
      return e.loading;
    }
    if (!listLoaded()) { if (e.state !== 'loading') { e.state = 'loading'; notify(id); } return Promise.resolve(e); }
    const r = resolve(id);
    if (!r && force && linkRetry.delete(id)) linked.delete(id);   // Try again asks a lookup that failed once more
    if (!r && !linked.has(id)) {   // an old #run link: the saved task its run became, else gone (one lookup per id)
      linked.set(id, null);
      e.state = 'loading';
      e.loading = request('GET', `/api/run-links/${enc(id)}`).then((x) => {
        const pid = x.ok ? str(x.data?.pipelineId) : '';
        if (!x.ok && x.status !== 404) linkRetry.add(id);   // only a 200 or a 404 is definitive
        linked.set(id, pid); e.loading = null;
        if (pid && pid !== id) alias.set(id, pid);
        return openTask(id);
      });
      return e.loading;
    }
    if (!r) { e.state = linkRetry.has(id) ? 'failed' : 'gone'; notify(id); return Promise.resolve(e); }   // a lookup that could not answer offers Try again
    const wasReady = e.state === 'ready';
    if (!wasReady) e.state = 'loading';
    if (r.live && !r.pidKnown) e.pidless = true;   // no history read until the run names its pipeline (B1.9 D2): learned() opens it again
    // the in-flight read is recorded before anyone hears of it: a listener that opens the task again joins this read
    e.loading = (async () => {
      await null;
      const key = r.projectKey;
      const res = key && r.pidKnown ? await request('GET', runUrl(key, r.pipelineId)) : { ok: false, status: 404 };
      if (res.ok) { e.detail = res.data?.state || null; e.state = 'ready'; }
      // a page already drawn keeps what it read: a failed re-read changes nothing and says so once (R-arch-8)
      else if (wasReady && res.status !== 404) { e.loading = null; refuse('read the task again', res); return { state: 'failed', error: res.error }; }
      else if (r.live) { e.detail = null; e.state = 'ready'; }                    // a live run with no history row draws from its frames
      else if (res.status === 404) e.state = 'gone';
      else e.state = 'failed';
      e.loading = null;
      notify(id);
      if (e.state === 'ready') { refreshChecks(id, { force: true }); loadParts(id); }
      return e;
    })();
    if (!wasReady) notify(id);
    return e.loading;
  }

  // ---- the checks cache (D5): one entry per pipeline, fresh 60 s, at most 2 reads in flight ----
  function pump() {
    while (inFlight < CHECKS_IN_FLIGHT && queue.length) {
      const job = queue.shift(); inFlight++;
      job().finally(() => { inFlight--; pump(); });
    }
  }
  // `hint` ({ pr, projectKey, projectDir }): a saved row the store has not drawn yet (the snapshot that is building it)
  function refreshChecks(id, { force = false, hint = null } = {}) {
    const r = resolve(id) || (hint && (hint.projectKey || hint.projectDir) ? { id, pipelineId: id, projectKey: str(hint.projectKey), projectDir: str(hint.projectDir) } : null);
    const pr = prOfTask(id) || (hint ? str(hint.pr) : '');
    if (!r || !pr) return Promise.resolve(null);
    if (wsOf(r.projectKey) && !memberKeyOf(id)) return Promise.resolve(null);   // a workspace's PR is read per member: one only
    const c = checks.get(r.pipelineId) || {};
    if (c.loading) return c.loading;
    if (!force && c.at && now() - c.at < CHECKS_FRESH_MS) return Promise.resolve(c.data);
    const gen = c.gen || 0;   // an invalidation bumps it: a reply asked for before then writes nothing
    const p = new Promise((done) => {
      queue.push(async () => {
        const mk = wsOf(r.projectKey) ? memberKeyOf(id) : '';
        const q = (r.projectKey ? `projectKey=${enc(r.projectKey)}` : `projectDir=${enc(r.projectDir)}`) + (mk ? `&memberKey=${enc(mk)}` : '');
        const res = await request('GET', `/api/pr/checks?id=${enc(r.pipelineId)}&${q}`);
        const cur = checks.get(r.pipelineId) || {};
        if ((cur.gen || 0) !== gen) { done(null); return; }   // stale: a newer read owns the entry
        checks.set(r.pipelineId, res.ok ? { at: now(), data: res.data, gen } : { at: now(), data: cur.data || null, gen });
        notify(id); if (res.ok) for (const fn of checkFns) { try { fn(r.pipelineId); } catch (e) { console.error(e); } }
        done(res.ok ? res.data : null);
      });
      pump();
    });
    checks.set(r.pipelineId, { ...c, gen, loading: p });
    return p;
  }
  const invalidate = (pipelineId) => { const c = checks.get(pipelineId); if (c) checks.set(pipelineId, { data: c.data, at: 0, gen: (c.gen || 0) + 1 }); };
  function prOfTask(id) {
    const d = tasks.get(id)?.detail, row = rowOf(id);
    const url = str(d?.pr?.url) || str(row?.pr);
    // F-G-G1-01: only a PR known to be open has checks to read (dev answers 400 for one merged or closed); unknown is not open
    const st = str(d?.pr?.state).toUpperCase() || str(runOf(id)?.prState).toUpperCase();
    return url && st === 'OPEN' ? url : '';
  }
  /** The checks entry for a task, read by the row, the center card, the chat TaskCard and the page alike (D5). */
  function checksOf(id, hint = null) {
    const r = resolve(id); const pid = r ? r.pipelineId : hint ? id : '';
    if (!pid) return null;
    const c = checks.get(pid);
    if (!c || (!c.loading && (!c.at || now() - c.at >= CHECKS_FRESH_MS))) refreshChecks(id, { hint });
    return c?.data || null;
  }

  /** The one input the page and the card read (D3). */
  function inputOf(id) {
    const r = resolve(id);
    let row = rowOf(id) || (r && ((r.runId && rowOf(r.runId)) || rowOf(r.pipelineId))) || { id }; const live = liveOf(id);
    const kl = keptLabels.get(id);
    if (kl) { if (arr(row.labels).join('\n') === kl.join('\n')) keptLabels.delete(id); else row = { ...row, labels: kl }; }
    const saved = tasks.get(id)?.detail || {};
    // a live frame's empty fields (a branch, a cost or steps not sent yet) never hide what dev saved
    // (nor does a frame's 0 hide a time or cost dev saved: a round's frames can read $0 after it ended)
    const fresh = live?.state ? Object.fromEntries(Object.entries(live.state).filter(([k, v]) => v != null && !(Array.isArray(v) && !v.length) && !(v === 0 && saved[k] > 0))) : {};
    const state = live ? { ...saved, ...fresh, pendingQuestion: live.pendingQuestion ?? saved.pendingQuestion, status: live.status || saved.status } : saved;
    return { row, state, checks: checksOf(id) };
  }

  /** A frame that changes a task's PR or ends a round drops its checks entry (D5). */
  function frame(f = {}) {
    if (f.type === 'pr-watch-changed' && f.pipelineId) { invalidate(f.pipelineId); notify(''); }
    if ((f.type === 'done' || f.type === 'error') && (f.pipelineId || f.id)) invalidate(f.pipelineId || f.id);
    // a run that ended: a page drawn from its frames reads its saved run and parts again (Changes, time, cost, its stages)
    const ended = (f.type === 'done' || f.type === 'error') && f.runId ? resolve(f.runId) : null;
    // a round that ended may have saved a plan: Restart Build's answer is read again (F-a4-11)
    if (f.type === 'done' || f.type === 'error') for (const p of [f.pipelineId, f.id, ended?.pipelineId]) if (p) plans.delete(p);
    if (ended) for (const [id, e] of tasks) if (e.state === 'ready' && !e.loading && resolve(id)?.pipelineId === ended.pipelineId) openTask(id, { force: true });
    // a deleted or superseded run: its page and parts are not kept (the adapter drops it from the store too)
    if (f.type === 'pipelines-changed' && Array.isArray(f.removedRunIds)) for (const id of f.removedRunIds) { tasks.delete(id); parts.delete(id); notify(id); }
  }

  // ---- the page's parts (D4): Changes, documents, Logs and the worktree's actions, read once the task is ready ----
  const parts = new Map();   // task id → { changes, docs, log, actions, setup }
  // pipelineId → whether it saved a plan (planOf: true, false, null unknown) or 'reading': Restart Build's NO_PLAN, up front (F-a4-11)
  const plans = new Map();
  /** One artifacts read lands: its plan answer (a known answer outlives a failed re-read). */
  // a round that ends drops its answer (frame), and a read started before that lands on nothing: the next ask reads again
  const planLands = (pid, x) => { if (!plans.has(pid)) return; if (x.ok) plans.set(pid, planOf(x.data)); else if (typeof plans.get(pid) !== 'boolean') plans.set(pid, null); };
  async function text(url) {
    let r; try { r = await fetch(url, { headers: { Accept: 'text/plain, application/x-ndjson, text/x-diff, application/json' } }); } catch (e) { return { ok: false, error: str(e?.message) || 'no connection' }; }
    let t = ''; try { t = await r.text(); } catch { t = ''; }
    return r.ok ? { ok: true, text: t } : { ok: false, status: r.status, error: (() => { try { return str(JSON.parse(t).error); } catch { return ''; } })() || `HTTP ${r.status}` };
  }
  function loadParts(id) {
    const r = resolve(id); if (!r) return;
    const pidless = r.live && !r.pidKnown, e = tasks.get(id);
    if (e) e.pidless = pidless;   // what learned() reads: this read had no pipeline id
    // what is shown stays until its re-read lands ok: a failed read only fills a part never read
    const p = { changes: null, docs: null, log: null, actions: null, setup: null, sessions: null, usage: null, comments: null, ...(parts.get(id) || {}) };
    parts.set(id, p);
    const land = (k, ok, v) => { if (parts.get(id) !== p) return; if (ok || p[k] == null) p[k] = v; notify(id); };
    const key = r.projectKey, pid = r.pipelineId;
    // a round that ended reads its saved diff (a Restart Build round's live patch is empty once it ends); a live or paused one
    // reads its live patch, and the saved diff only when that read fails: a round with no saved diff yet would log a 404
    const running = r.live && r.runId && !/^(done|stopped|error|failed|interrupted)$/.test(lc(r.live.status));
    const saved = () => (key && !pidless ? text(`${runUrl(key, pid)}/diff`) : Promise.resolve({ ok: false, status: 404 }));
    (running ? request('GET', `/api/runs/${enc(r.runId)}/live-diff`).then((x) => (!x.ok && key ? saved() : { ok: x.ok, text: x.data?.patch, status: x.status }))
      : saved())
      .then((x) => land('changes', x.ok, patchFiles(x.ok ? x.text : '')));
    // before the run names its pipeline, every other part is keyed by an id that is not one yet (F-a1-09): not read, null
    if (pidless) return;
    if (typeof plans.get(pid) !== 'boolean') plans.set(pid, 'reading');
    request('GET', `/api/runs/${enc(pid)}/artifacts`).then((x) => { planLands(pid, x); land('docs', x.ok, x.ok ? docsOf(x.data?.artifacts) : []); });
    (key ? text(`${runUrl(key, pid)}/log`) : Promise.resolve({ ok: false })).then((x) => land('log', x.ok, x.ok ? logLinesOf(x.text) : []));
    if (key || r.projectDir) request('GET', `/api/runs/${enc(pid)}/actions?${scopeQ(r)}`).then((x) => land('actions', x.ok, x.ok ? actionsOf(x.data) : null));
    request('GET', `/api/pipelines/${enc(pid)}/setup`).then((x) => land('setup', x.ok, x.ok && x.data?.setup ? x.data.setup : null));
    if (key) request('GET', `${runUrl(key, pid)}/comments`).then((x) => land('comments', x.ok, x.ok ? commentsByPath(x.data) : {}));
    request('GET', `/api/runs/${enc(pid)}/sessions`).then((x) => land('sessions', x.ok, x.ok ? sessionRowsOf(x.data) : []));
    if (flag('runTelemetry')) request('GET', `/api/runs/${enc(pid)}/telemetry`).then((x) => land('usage', x.ok, x.ok ? usageRowsOf(x.data) : []));   // dev's Labs flag: off, the route is a 404
    else land('usage', true, []);
  }
  // the log with its steps named (logStepsOf), kept per log read until the state's nodes or steps change: a read does not rebuild it
  const logNamed = new WeakMap();   // log lines → { nodes, steps, out }
  function namedLog(log, state) {
    if (!Array.isArray(log)) return log;
    const nodes = state?.stepper?.graph?.nodes, steps = state?.steps, c = logNamed.get(log);
    if (c && c.nodes === nodes && c.steps === steps) return c.out;
    const out = logStepsOf(log, state); logNamed.set(log, { nodes, steps, out }); return out;
  }
  /** A session's transcript: dev's raw trace (GET /api/runs/:id/sessions/:sid/trace), in a new tab. */
  function transcript(id, sid) {
    const r = resolve(id) || {};
    return open(`/api/runs/${enc(r.pipelineId || id)}/sessions/${enc(sid)}/trace`) !== null ? { ok: true } : refuse('open the transcript', { ok: false, error: 'the browser blocked the new tab' });
  }
  /** One file's whole diff, from the patch the page already read. */
  const wholeDiff = (id, path) => parts.get(id)?.changes?.full?.[path] || '';
  /** A document's text (GET /api/runs/:id/artifact?rel=). → {ok, text} */
  async function docText(id, rel) {
    const r = resolve(id) || {};
    const res = await request('GET', `/api/runs/${enc(r.pipelineId || id)}/artifact?rel=${enc(rel)}`);
    if (!res.ok) return refuse('open the document', res);
    return { ok: true, text: str(res.data?.text) };
  }
  /** A document's download: dev's raw artifact with ?download=1, in a new tab (the browser saves it). */
  function download(id, rel) {
    const r = resolve(id) || {};
    const u = `/api/runs/${enc(r.pipelineId || id)}/artifact-raw/${str(rel).split('/').map(enc).join('/')}?download=1`;
    return open(u) !== null ? { ok: true } : refuse('download the document', { ok: false, error: 'the browser blocked the new tab' });
  }
  /** Switch model's choices: dev's models for this run's engine (Chat's catalog, GET /api/ask/models). */
  async function models(id) {
    const res = chat?.catalog ? await chat.catalog('models') : { ok: false };
    if (!res?.ok) return [];
    const engine = lc(inputOf(id).state?.engine) || 'claude';
    return arr(res.data?.models).filter((m) => (lc(m.engine) || 'claude') === engine).map((m) => ({ id: str(m.id), label: str(m.label) || str(m.id) }));
  }

  // ---- run groups (GET /api/run-groups): a group's page is #run/group:GID ----
  // groupFailed: the last GET /api/run-groups failed and no list is held; the page reads 'failed' until open() asks again
  let groupList = null, groupLoading = null, groupFailed = false;
  const combines = new Map();   // user group id → '' (One PR is open) | why not | null while dev checks (GET …/combine)
  const followed = new Map();   // a feature id → its newest id after a re-plan ('' when none), null while asked
  function loadGroups(force = false) {
    if (groupLoading) return groupLoading;
    if (groupList && !force) return Promise.resolve(groupList);
    if (force) combines.clear();
    groupFailed = false;
    groupLoading = request('GET', '/api/run-groups').then((x) => { groupLoading = null; if (x.ok) groupList = arr(x.data?.groups); else if (!groupList) groupFailed = true; notify(''); return groupList; });
    return groupLoading;
  }
  /** A group's page facts, each member's case read from the store as its row shows it. null until read; false when gone.
   *  A re-planned feature's old id carries on as its newest one (dev's GET /api/shape/features/:id, as its #feature/ID does). */
  function group(gid) {
    if (!groupList) { if (!groupFailed) loadGroups(); return null; }
    const g = groupList.find((x) => str(x.id) === gid);
    if (g) return { ...groupOf(g, rowOf), ...(g.kind === 'user' ? { combine: combineOf(gid) } : {}) };
    const f = followed.get(gid);
    if (f === undefined) {
      followed.set(gid, null);
      request('GET', `/api/shape/features/${enc(gid)}`).then((x) => { followed.set(gid, x.ok && str(x.data?.id) && str(x.data.id) !== gid ? str(x.data.id) : ''); notify(''); });
      return null;
    }
    return f === null ? null : f ? group(f) : false;
  }
  /** Whether a user group's tasks combine into one PR: '' when they do, else dev's reason; null while it checks. */
  function combineOf(gid) {
    if (combines.has(gid)) return combines.get(gid);
    combines.set(gid, null);
    request('GET', `/api/run-groups/${enc(gid)}/combine`).then((x) => { combines.set(gid, x.ok ? str(x.data?.oneOff) : `Could not check whether the tasks combine: ${x.error || 'no answer'}`); notify(''); });
    return null;
  }

  const isGroup = (id) => str(id).startsWith('group:');
  function liveRunning(id) {
    const r = resolve(id);
    return !!(r?.live && r.pidKnown && /^(running|starting)$/.test(lc(r.live.status)) && !r.live.pendingQuestion);
  }
  function groupDetail(id) { const g = group(id.slice(6)); return g ? { id, case: 'feature', title: g.title, group: g } : { id, case: 'feature', title: 'Group' }; }

  /** One Tasks action (Step 7). `args`: the task id plus what the control gave ({ value, reason, baseAck, … }). → {ok, error?, data?} */
  async function act(id, args = {}) {
    const r = resolve(args.taskId || args.runId || args.pipelineId) || {};
    const input = args.taskId ? inputOf(args.taskId) : { row: {}, state: {} };
    const pq = input.state?.pendingQuestion || r.live?.pendingQuestion || null;
    const a = { ...r, ...args, runId: args.runId || r.runId, pipelineId: args.pipelineId || r.pipelineId, pr: args.pr || prOfTask(args.taskId || '') || input.row?.pr || '',
      ...(id === 'retry' && pq?.kind === 'recovery' ? { recoveryId: pq.id } : {}), questionId: args.questionId || pq?.id };
    if (r.live && !r.pidKnown && !RUN_ID_ACTS.has(id) && !(id === 'retry' && a.recoveryId)) return refuse(wordsOf(id, a), { ok: false, error: STARTING }, args.quiet);
    if (id === 'raise-cap' && !(capOf(args.value) > 0)) return refuse(wordsOf(id, a), { ok: false, error: 'write the new cap in dollars, like $180', words: wordsOf(id, a) }, args.quiet);
    if (id === 'plan-approve' && chat?.act) return chat.act('plan-approve', { runId: a.runId, id: a.questionId, key: `plan-approve:${a.runId}` });
    if (id === 'plan-changes') {
      if (!str(args.value).trim()) return refuse('send your changes', { ok: false, error: 'write what to change first' }, args.quiet);
      return chat?.act ? chat.act('plan-changes', { runId: a.runId, id: a.questionId, feedback: str(args.value).trim(), key: `plan-changes:${a.runId}` })
        : refuse('send your changes', { ok: false, error: 'Chat is not running' }, args.quiet);
    }
    // F-G-G2-02: one answer per question, yours (`choices`, by question) or Worca's pick, all in one POST /api/answer (Chat's run-answer)
    if (id === 'answer') {
      const q = questionsOf({ status: input.state?.status || r.live?.status, pendingQuestion: pq }), words = "answer the task's question";
      if (!q) return refuse(words, { ok: false, error: 'the question is no longer waiting for you' }, args.quiet);
      if (!a.runId) return refuse(words, { ok: false, error: 'the task is not running' }, args.quiet);
      if (!chat?.act) return refuse(words, { ok: false, error: 'Chat is not running' }, args.quiet);
      const own = arr(args.choices);
      const answers = q.questions.map((x, k) => ({ id: x.id, choice: (!args.defaults && str(own[k]).trim()) || x.options[x.pick] || 'auto' }));
      return chat.act('run-answer', { runId: a.runId, id: q.id, payload: { answers }, key: `run-answer:${a.runId}`, quiet: args.quiet });
    }
    if (id === 'new-task' && !a.body) a.body = newTaskBodyOf({ ...input.state, projectDir: a.projectDir || input.state?.projectDir });
    if (id === 'comment' && !str(args.value).trim()) return refuse(wordsOf(id, a), { ok: false, error: 'write the comment first' }, args.quiet);
    if (id === 'night' && !a.runId) return refuse(wordsOf(id, a), { ok: false, error: 'the task is not running' }, args.quiet);
    if (id === 'preset' && !str(args.value).trim()) return refuse(wordsOf(id, a), { ok: false, error: 'name the preset first' }, args.quiet);
    if (id === 'switch-model' && !a.model) return refuse(wordsOf(id, a), { ok: false, error: 'pick a model first' }, args.quiet);
    if (id === 'resume-engine' && !str(a.engine)) return refuse(wordsOf(id, a), { ok: false, error: 'pick an engine first' }, args.quiet);
    if (id === 'run-direction' && !str(args.text).trim()) return refuse(wordsOf(id, a), { ok: false, error: 'say what it should take into account first' }, args.quiet);
    if (id === 'restore') { const qs = scopeQuery(a); if (!qs) return list('restore', { ids: [args.taskId || a.pipelineId] }); a.qs = qs.toString(); }
    if (id === 'resume-at') { a.scheduledFor = nextAt(args.value, now()); if (!a.scheduledFor) return refuse(wordsOf(id, a), { ok: false, error: 'write the time as HH:MM, like 15:30' }, args.quiet); }
    if (id === 'try-it') return tryIt(a, args);
    // dev answers 200 even to a gate that is gone (run-harness answer only warns): post only to the one pending now (D3)
    if (id === 'gate-continue' || id === 'gate-another') {
      if (pq?.kind !== 'gate' || !str(pq.id)) return refuse(wordsOf(id, a), { ok: false, error: 'the review is no longer waiting for you' }, args.quiet);
      if (!a.runId) return refuse(wordsOf(id, a), { ok: false, error: 'the task is not running' }, args.quiet);
      a.gateId = pq.id;
    }
    if (MEMBER_ACTS.has(id) && wsOf(a.projectKey)) {
      const tid = args.taskId || a.pipelineId;
      if (!tasks.get(tid)?.detail) await openTask(tid);   // a group's member: its projects are on its saved run
      if (id === 'terminal') { const ms = membersOf(tid); if (!a.member && ms.length === 1) a.member = ms[0].key; }
      else if (id === 'publish' && !a.memberKey) return publishEach(tid, a, args);
      else if (!a.memberKey) {
        a.memberKey = memberKeyOf(tid);
        if (!a.memberKey) return refuse(wordsOf(id, a), { ok: false, error: 'this task has a PR in each of its projects' }, args.quiet);
      }
    }
    if (id === 'report' && !a.reason) a.reason = FAILED_OR_STUCK.has(input.row?.case) || /^(error|stopped|failed)$/.test(lc(input.state?.status)) ? 'failed-or-stuck' : 'something-else';
    const def = TASK_ACTIONS[id];
    const words = wordsOf(id, a);
    if (!def) return refuse(words, { ok: false, error: 'this action is unknown' }, args.quiet);
    return runner.run(runner.keyOf(id, { key: args.key || (id === 'ship-group' ? `ship-group:${a.groupId}` : undefined), pipelineId: a.pipelineId }), words, async () => {   // a group's ship is pending per group
      const [method, url, body] = def[1](a);
      const res = await request(method, url, body);
      // Retry on a moved base is a prompt, not a refusal (D10): the strip asks, Resume anyway posts baseAck.
      if (!res.ok && RESUMES.has(id) && BASE_PROMPT.has(res.code)) return { ...res, prompt: 'base' };
      if (!res.ok) return refuse(words, { ...res, words }, args.quiet);
      // a resume answers the pipeline's new run id: it is the same task, so its old ids keep finding it
      if (res.data?.runId && a.pipelineId && RESUMES.has(id)) alias.set(str(res.data.runId), a.pipelineId);
      if (id === 'report' && res.data && res.data.ok === false) {
        const u = str(res.data.issue?.url);
        if (u && open(u) !== null) return { ok: true, data: res.data, say: 'Opened the issue form on GitHub' };
        return refuse(words, { ok: false, error: str(res.data.error) || 'GitHub did not take the report' }, args.quiet);
      }
      if (id === 'ship-group') { loadGroups(true); const n = arr(res.data?.prs).length; return { ...res, say: n > 1 ? `Created ${n} PRs` : 'Created the PR' }; }
      if (id === 'terminal') return { ...res, say: 'Opened a terminal in the worktree', session: str(res.data?.session?.id) };
      if (id === 'publish') return { ...res, say: res.data?.upToDate ? `Already on ${str(res.data.remote)}` : `Published ${str(res.data?.branch)} to ${str(res.data?.remote)}` };
      if (id === 'comment') { loadParts(args.taskId || a.pipelineId); return { ...res, say: 'Comment added; the review sees it' }; }
      if (id === 'switch-model') return { ...res, say: `Resumed on ${str(args.modelLabel) || a.model}` };
      if (id === 'resume-at') return { ...res, say: `Resumes at ${str(args.value).trim()}` };
      if (id === 'resume-engine') return { ...res, say: `Resumed on ${engineLabel(a.engine)}` };
      if (id === 'tags' || id === 'labels') keepSaved(args.taskId || a.pipelineId, id, id === 'tags' ? a.tags : a.labels);
      if (/^(service-start|service-stop|stack-start|stack-stop|builtin|checkout|discard|apply)$/.test(id)) loadParts(args.taskId || a.pipelineId);
      if (id === 'checkout') {
        const m = (res.data?.members || []).find((x) => x.state === 'checked-out' && x.worktreeDir);
        return { ...res, say: m ? `Checked out ${str(m.branch)} at ${str(m.worktreeDir)}` : 'Checked out on this machine' };
      }
      // a merged PR has no checks to read again: its entry only goes; the others read their checks again
      if (/^(merge|rerun-checks|fix-checks)$/.test(id) && a.pipelineId) { invalidate(a.pipelineId); if (id !== 'merge') refreshChecks(args.taskId || a.pipelineId, { force: true }); }
      if (id === 'merge' && res.data?.next && res.data.next.retargeted === false) {
        return { ...res, say: `Merged #${a.prNumber || prNum(a.pr)} into ${str(input.checks?.base) || str(input.state?.branch?.source) || 'its base'}; #${prNum(res.data.next.url)} still targets its old base: ${str(res.data.next.error)}` };
      }
      return res;
    }, { quiet: args.quiet, scope: args.taskId || '' });
  }

  /** A saved tag or label change lands on the task's read detail, so the next redraw keeps it (dev's PUT answered ok). */
  function keepSaved(id, what, list) {
    const e = tasks.get(id);
    if (e?.detail) e.detail = { ...e.detail, [what]: what === 'tags' ? arr(list).map((t) => String(t).replace(/:\s*/, ':')) : arr(list) };
    if (what === 'labels') keptLabels.set(id, arr(list).slice());   // the store's row catches up on its next read
  }
  /** Publish on a workspace task: each member's feature branch, one after the other (dev publishes per member), under one
   *  pending key. A refusal names the project, and the ones already published. */
  async function publishEach(tid, a, args) {
    const words = wordsOf('publish', a);
    const ms = membersOf(tid).filter((m) => m.branch);
    if (!ms.length) return refuse(words, { ok: false, error: 'no project of this task has a branch' }, args.quiet);
    return runner.run(`publish:${a.pipelineId}`, words, async () => {
      let last = null; const done = [];
      for (const m of ms) {
        last = await act('publish', { ...args, quiet: true, memberKey: m.key, key: `publish:${a.pipelineId}:${m.key}` });
        if (!last.ok) return refuse(words, { ...last, error: `${m.name}: ${last.error}${done.length ? `; ${done.join(', ')} ${done.length === 1 ? 'was' : 'were'} published` : ''}` }, args.quiet);
        done.push(m.name);
      }
      return ms.length === 1 ? last : { ok: true, say: `Published ${ms.length} branches` };
    }, { quiet: args.quiet, scope: tid });
  }

  /** Try it (dev's run head, app.js tryItFlow): check the branch out on this machine, then start its first service. */
  async function tryIt(a, args) {
    const svc = parts.get(args.taskId || a.pipelineId)?.actions?.services?.[0];   // read first: a checkout reads the parts again
    const co = await act('checkout', { ...args, quiet: args.quiet });
    if (!co.ok) return co;
    if (!svc) return { ...co, say: co.say || 'Checked out on this machine' };
    const st = await act('service-start', { ...args, actionId: svc.id, name: svc.name, member: svc.member });
    return st.ok ? { ...st, say: `Checked out and started ${svc.name}` } : st;
  }

  /** The adapter's word that a run's frames named its pipeline (B1.9 D5, D6): a task opened by that run id before then reads
   *  its saved run and parts again, with the real id, and its page redraws. Idempotent: a second call finds nothing pidless. */
  function learned(runId, pipelineId) {
    if (!runId || !pipelineId) return;
    if (runId !== pipelineId) alias.set(runId, pipelineId);
    for (const [id, e] of tasks) {
      if (!e.pidless || (id !== runId && resolve(id)?.runId !== runId)) continue;
      if (e.loading) {
        // the read in flight reads its parts after this: it re-opens only if those were still read without the pipeline id
        e.loading.then(() => { if (e.pidless) { e.pidless = false; openTask(id, { force: true }); } notify(id); });
        continue;
      }
      e.pidless = false;
      if (e.state === 'ready') openTask(id, { force: true });
      notify(id);
    }
  }

  /** A run-state label on the page or the card: the Tasks actions, else Chat's FLOW (D13). */
  function flow(label, given = {}) {
    const f = TASK_FLOW[label];
    // Retry and Restart Build (D10, D19): a paused or interrupted task resumes its failed step; a stopped or errored one
    // restarts Build as a new round.
    if (label === 'Retry' || label === 'Restart Build' || label === 'Try again') {
      const st = lc(inputOf(given.taskId || given.pipelineId || '').state?.status);
      return act(/^(stopped|error|failed)$/.test(st) && label !== 'Try again' ? 'restart-build' : 'retry', given);
    }
    if (f?.act) return act(f.act, { ...given, ...(f.args || {}) });
    if (f?.copyLink) {
      const link = `${origin || globalThis.location?.origin || ''}/#run/${given.taskId || given.pipelineId || ''}`;
      return runner.run(`copy-link:${given.taskId}`, 'copy the link', async () => {
        try { await (clipboard || globalThis.navigator?.clipboard).writeText(link); return { ok: true }; }
        catch (e) { return refuse('copy the link', { ok: false, error: str(e?.message) || 'the browser said no' }); }
      });
    }
    if (chat?.flow && CHAT_FLOW[label]) {
      const r = resolve(given.taskId || given.runId || given.pipelineId) || {};
      return chat.flow(label, { runId: r.runId || r.pipelineId, pipelineId: r.pipelineId, ...given });
    }
    return Promise.resolve(refuse(lc(label), { ok: false, error: 'the task page does not offer it' }));
  }
  /** Whether the page or a card offers `label` live: an action with a route, and Re-run checks only off Bitbucket. */
  function canFlow(label, a = {}) {
    if (PAGE_ONLY.has(label) && !a.page) return false;
    // a live task whose pipeline is not named yet offers only what posts its run id (B1.9 D4: no control that only refuses)
    const r = (a.taskId || a.pipelineId) ? resolve(a.taskId || a.pipelineId) : null;
    if (r?.live && !r.pidKnown && !RUN_ID_LABELS.has(label) && !RUN_ID_ACTS.has(TASK_FLOW[label]?.act)) return false;
    if (NEEDS_PR.has(label) && !a.pr) return false;
    if (NEEDS_PR.has(label) && (a.taskId || a.pipelineId) && wsOf(resolve(a.taskId || a.pipelineId)?.projectKey) && !memberKeyOf(a.taskId || a.pipelineId)) return false;   // a PR per project (the page's task or a chat card's run)
    // COV-3: Restore is an archived task's; a direction goes only to a live run that can still read it (dev refuses done,
    // error and stopped: DIRECTIONS_CLOSED)
    if (label === 'Restore') return !!rowOf(a.taskId || a.pipelineId)?.archived;
    if (label === 'Send a direction') { const lr = resolve(a.taskId || a.pipelineId)?.live; return !!lr && !/^(done|error|stopped|failed)$/.test(lc(lr.status)); }
    if (label === 'Re-run checks') return !/bitbucket\.org/.test(str(a.pr));
    if (TASK_FLOW[label]?.cases) return TASK_FLOW[label].cases.includes(str(a.case));
    if (TASK_FLOW[label]?.act === 'answer') return !!questionsOf(inputOf(a.taskId || a.pipelineId).state);   // only a question the page can draw
    return !!TASK_FLOW[label] || (!!CHAT_FLOW[label] && (!CHAT_FLOW[label].needsPr || !!a.pr));
  }

  /** Why Restart Build would be refused, when the page can already see it (F-a4-11): a workspace task, or a task that saved
   *  no plan. '' when it is offered, or not known yet: a read lands and tells the page or card (notify). Never posts. */
  function restartOff(id) {
    const r = resolve(id); if (!r) return '';
    if (wsOf(r.projectKey)) return 'Not offered for a workspace task yet';
    const input = inputOf(id);   // a card's task never opened has no saved status yet: its store row's case says it ended
    if (!/^(stopped|error|failed)$/.test(lc(input.state?.status) || lc(input.row?.case))) return '';
    if (r.live && !r.pidKnown) return '';   // no pipeline id to read by yet (F-a1-09)
    const pid = r.pipelineId, p = plans.get(pid);
    if (p === false) return 'Needs a plan: this task saved none to build from';
    if (p === undefined) {
      plans.set(pid, 'reading');
      request('GET', `/api/runs/${enc(pid)}/artifacts`).then((x) => { planLands(pid, x); notify(id); });
    }
    return '';
  }

  /** A list action (D17). `args.ids`: the rows' task ids; their pipeline ids and live run ids come from resolve. */
  async function list(id, args = {}) {
    const def = LIST_ACTIONS[id]; if (!def) return refuse(id, { ok: false, error: 'this action is unknown' });
    // an Undo right after an archive: the run left the runs and its archived row is not read yet, so its pipeline id is the alias
    const rs = (args.ids || []).map((x) => resolve(x) || { pipelineId: alias.get(x) || x });
    const a = { ...args, pipelineIds: rs.map((r) => r.pipelineId), pipelineId: rs[0]?.pipelineId, runId: rs[0]?.live ? rs[0].runId : '' };
    return runner.run(`list:${id}:${a.pipelineIds.join(',')}`, def[0], async () => {
      const [method, url, body] = def[1](a);
      let res = await request(method, url, body);
      // a bulk answer that did nothing (no row done, no schedule cancelled) is a refusal, never a success
      if (res.ok && Array.isArray(res.data?.done) && !res.data.done.length && !arr(res.data.cancelled).length) res = { ok: false, status: 200, error: str(arr(res.data.skipped)[0]?.reason) || 'nothing changed' };
      if (!res.ok) return refuse(def[0], res);
      // a deleted or archived task is no longer a page: its entry goes, so an open page reads it again (gone)
      if (id === 'delete' || id === 'archive') for (const x of [...(args.ids || []), ...a.pipelineIds]) { if (tasks.delete(x)) notify(x); }
      return res;
    });
  }

  /** New task's base picker: the project's own branches, as dev's New run reads them (GET /api/branches). null when unread. */
  async function branches(projectDir) {
    if (!projectDir) return null;
    const res = await request('GET', `/api/branches?projectDir=${enc(projectDir)}`);
    return res.ok && Array.isArray(res.data?.branches) ? res.data.branches.map(str).filter(Boolean) : null;
  }

  return {
    list, projectDirOf, branches, transcript,
    // the page's parts, with its agents read from the task's own steps
    parts: (id) => { const p = parts.get(id); if (!p) return null; const st = inputOf(id).state; return { ...p, agents: agentRowsOf(st?.steps), log: namedLog(p.log, st) }; }, loadParts, wholeDiff, docText, download, models,
    group, loadGroups, members: membersOf,
    /** Move to group…'s choices: dev's own groups (features take no hand-added task: dev answers IN_GROUP). */
    groups: () => { if (!groupList && !groupFailed) loadGroups(); return (groupList || []).filter((g) => g.kind === 'user').map((g) => groupOf(g)); },
    /** dev's run engines (src/shared/engine-switch.mjs), for New task's Agent picker. */
    engines: () => ENGINE_NAMES.map((id) => ({ id, label: ENGINES[id].label })),   // a project's real folder by its key or name (the store keeps only its display path)
        // a task neither the runs nor the store hold any more (deleted, or its row left the store) is gone, whatever was read
    resolve,
    // a group's page (#run/group:GID) is read from dev's run groups; a task's from its history and frames
    open: (id, o) => (isGroup(id) ? loadGroups(!!o?.force) : openTask(id, o)),
    // side-effect free for a group until its list is read: open() loads it, so a failed load is not asked again on every paint
    state: (id) => (isGroup(id) ? (!groupList ? (groupFailed ? 'failed' : 'loading') : ({ null: 'loading', false: 'gone' })[String(group(id.slice(6)))] || 'ready') : !listLoaded() ? (listFailed() ? 'failed' : 'loading') : !resolve(id) ? (linked.get(id) === null ? 'loading' : linkRetry.has(id) ? 'failed' : 'gone') : tasks.get(id)?.state || 'loading'),
    // liveRunning (B1.9 D7): a running task whose pipeline is known is not over, even before its steps arrive (F-a4-03)
    detail: (id) => (isGroup(id) ? groupDetail(id) : { ...taskPageOf(inputOf(id), { now: now() }), liveRunning: liveRunning(id), restartOff: restartOff(id) }),
    card: (id) => taskCardOf(inputOf(id)),
    input: inputOf, checks: checksOf, refreshChecks, frame, act, flow, canFlow, restartOff, learned,
    pending: (key) => runner.pending.has(key), keyOf: runner.keyOf,
    /** The list's first load failed (or was asked again): a task page waiting on it looks again. */
    listChanged: () => notify(null),
    /** The adapter's PR lookup (D7): its token, and whether it ended (its `done` frame, or a refused POST). */
    prLookup,
    onChange: (fn) => { fns.add(fn); return () => fns.delete(fn); },
    onChecks: (fn) => { checkFns.add(fn); return () => checkFns.delete(fn); },
  };
}
