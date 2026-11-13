// ui/public/stillhet/live/task-live.mjs — the live kind's Tasks I/O (Stillhet Tasks, D4, D5, D13): the only owner of task
// fetches, the PR checks cache and every Tasks action. live-adapter.mjs starts it and sets window.RailTaskLive. The page
// (runs/run-page-model.js, run-page.js), the bar's list, the center and the chat TaskCard read from here; none of them
// writes before a route answers `ok`.
import { actionRunner, FLOW as CHAT_FLOW, openTab } from './chat-live.mjs';
import { taskPageOf, taskCardOf, newTaskBodyOf, patchFiles, docsOf, logLinesOf, actionsOf, groupOf, sessionRowsOf, agentRowsOf, usageRowsOf, commentsByPath } from './task-page.mjs';
import { ENGINES, ENGINE_NAMES } from '../../../../src/shared/engine-switch.mjs';

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
  'raise-cap': ['raise the cap', (a) => ['POST', '/api/resume', { pipelineId: a.pipelineId, costCapUsd: capOf(a.value) }]],
  retry: ['retry the task', (a) => (a.recoveryId
    ? ['POST', '/api/answer', { runId: a.runId, id: a.recoveryId, payload: { decision: 'retry' } }]
    : ['POST', '/api/resume', { pipelineId: a.pipelineId, ...(a.baseAck ? { baseAck: true } : { baseCheck: true }) }])],
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
  'switch-model': ['switch the model', (a) => ['POST', '/api/resume', { pipelineId: a.pipelineId, model: a.model }]],
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
  'Raise the cap': { act: 'raise-cap' }, Retry: { act: 'retry' }, 'Try again': { act: 'retry' }, 'Restart Build': { act: 'restart-build' },
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
});
const NEEDS_PR = new Set(['Merge PR', 'Merge', 'Fix checks', 'Re-run checks']);
// the page's own: a card has no TerminalPane to draw the shell in and no model list for Switch model…
const PAGE_ONLY = new Set(['Terminal', 'Switch model…']);
const FAILED_OR_STUCK = new Set(['failed', 'failed-kept', 'stopped', 'error', 'recovery', 'interrupted-dead']);
const BASE_PROMPT = new Set(['base-moved', 'base-missing']);

export function startTaskLive({ fetch, toast = () => {}, now = Date.now, open = openTab, runOf = () => ({}), rowOf = () => null,
  liveOf = () => null, listLoaded = () => true, listFailed = () => false, retryList = null, retryPrs = () => {}, chat = null, clipboard = null, origin = '', projectDirOf = () => '' } = {}) {
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
    return { id, runId: str(live?.runId) || (live ? id : ''), pipelineId: pipelineId || id, projectKey: str(s.projectKey) || str(live?.projectKey),
      projectDir: str(s.projectDir) || str(live?.projectDir), live };
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
    if (!r) { e.state = 'gone'; notify(id); return Promise.resolve(e); }
    const wasReady = e.state === 'ready';
    if (!wasReady) e.state = 'loading';
    // the in-flight read is recorded before anyone hears of it: a listener that opens the task again joins this read
    e.loading = (async () => {
      await null;
      const key = r.projectKey;
      const res = key ? await request('GET', runUrl(key, r.pipelineId)) : { ok: false, status: 404 };
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
    const st = str(d?.pr?.state).toUpperCase() || (url ? 'OPEN' : '');
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
    if (ended) for (const [id, e] of tasks) if (e.state === 'ready' && !e.loading && resolve(id)?.pipelineId === ended.pipelineId) openTask(id, { force: true });
  }

  // ---- the page's parts (D4): Changes, documents, Logs and the worktree's actions, read once the task is ready ----
  const parts = new Map();   // task id → { changes, docs, log, actions, setup }
  async function text(url) {
    let r; try { r = await fetch(url, { headers: { Accept: 'text/plain, application/x-ndjson, text/x-diff, application/json' } }); } catch (e) { return { ok: false, error: str(e?.message) || 'no connection' }; }
    let t = ''; try { t = await r.text(); } catch { t = ''; }
    return r.ok ? { ok: true, text: t } : { ok: false, status: r.status, error: (() => { try { return str(JSON.parse(t).error); } catch { return ''; } })() || `HTTP ${r.status}` };
  }
  function loadParts(id) {
    const r = resolve(id); if (!r) return;
    // what is shown stays until its re-read lands ok: a failed read only fills a part never read
    const p = { changes: null, docs: null, log: null, actions: null, setup: null, sessions: null, usage: null, comments: null, ...(parts.get(id) || {}) };
    parts.set(id, p);
    const land = (k, ok, v) => { if (parts.get(id) !== p) return; if (ok || p[k] == null) p[k] = v; notify(id); };
    const key = r.projectKey, pid = r.pipelineId;
    const running = r.live && r.runId && !/^(done|stopped|error|failed)$/.test(lc(r.live.status));
    (running ? request('GET', `/api/runs/${enc(r.runId)}/live-diff`).then((x) => ({ ok: x.ok, text: x.data?.patch, status: x.status }))
      : key ? text(`${runUrl(key, pid)}/diff`) : Promise.resolve({ ok: false, status: 404 }))
      .then((x) => land('changes', x.ok, patchFiles(x.ok ? x.text : '')));
    request('GET', `/api/runs/${enc(pid)}/artifacts`).then((x) => land('docs', x.ok, x.ok ? docsOf(x.data?.artifacts) : []));
    (key ? text(`${runUrl(key, pid)}/log`) : Promise.resolve({ ok: false })).then((x) => land('log', x.ok, x.ok ? logLinesOf(x.text) : []));
    if (key || r.projectDir) request('GET', `/api/runs/${enc(pid)}/actions?${scopeQ(r)}`).then((x) => land('actions', x.ok, x.ok ? actionsOf(x.data) : null));
    request('GET', `/api/pipelines/${enc(pid)}/setup`).then((x) => land('setup', x.ok, x.ok && x.data?.setup ? x.data.setup : null));
    if (key) request('GET', `${runUrl(key, pid)}/comments`).then((x) => land('comments', x.ok, x.ok ? commentsByPath(x.data) : {}));
    request('GET', `/api/runs/${enc(pid)}/sessions`).then((x) => land('sessions', x.ok, x.ok ? sessionRowsOf(x.data) : []));
    request('GET', `/api/runs/${enc(pid)}/telemetry`).then((x) => land('usage', x.ok, x.ok ? usageRowsOf(x.data) : []));   // 404 with Labs off, or none recorded
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
  function groupDetail(id) { const g = group(id.slice(6)); return g ? { id, case: 'feature', title: g.title, group: g } : { id, case: 'feature', title: 'Group' }; }

  /** One Tasks action (Step 7). `args`: the task id plus what the control gave ({ value, reason, baseAck, … }). → {ok, error?, data?} */
  async function act(id, args = {}) {
    const r = resolve(args.taskId || args.runId || args.pipelineId) || {};
    const input = args.taskId ? inputOf(args.taskId) : { row: {}, state: {} };
    const pq = input.state?.pendingQuestion || r.live?.pendingQuestion || null;
    const a = { ...r, ...args, runId: args.runId || r.runId, pipelineId: args.pipelineId || r.pipelineId, pr: args.pr || prOfTask(args.taskId || '') || input.row?.pr || '',
      ...(id === 'retry' && pq?.kind === 'recovery' ? { recoveryId: pq.id } : {}), questionId: args.questionId || pq?.id };
    if (id === 'raise-cap' && !(capOf(args.value) > 0)) return refuse(wordsOf(id, a), { ok: false, error: 'write the new cap in dollars, like $180', words: wordsOf(id, a) }, args.quiet);
    if (id === 'plan-approve' && chat?.act) return chat.act('plan-approve', { runId: a.runId, id: a.questionId, key: `plan-approve:${a.runId}` });
    if (id === 'plan-changes') {
      if (!str(args.value).trim()) return refuse('send your changes', { ok: false, error: 'write what to change first' }, args.quiet);
      return chat?.act ? chat.act('plan-changes', { runId: a.runId, id: a.questionId, feedback: str(args.value).trim(), key: `plan-changes:${a.runId}` })
        : refuse('send your changes', { ok: false, error: 'Chat is not running' }, args.quiet);
    }
    if (id === 'new-task' && !a.body) a.body = newTaskBodyOf({ ...input.state, projectDir: a.projectDir || input.state?.projectDir });
    if (id === 'comment' && !str(args.value).trim()) return refuse(wordsOf(id, a), { ok: false, error: 'write the comment first' }, args.quiet);
    if (id === 'night' && !a.runId) return refuse(wordsOf(id, a), { ok: false, error: 'the task is not running' }, args.quiet);
    if (id === 'preset' && !str(args.value).trim()) return refuse(wordsOf(id, a), { ok: false, error: 'name the preset first' }, args.quiet);
    if (id === 'switch-model' && !a.model) return refuse(wordsOf(id, a), { ok: false, error: 'pick a model first' }, args.quiet);
    if (id === 'resume-at') { a.scheduledFor = nextAt(args.value, now()); if (!a.scheduledFor) return refuse(wordsOf(id, a), { ok: false, error: 'write the time as HH:MM, like 15:30' }, args.quiet); }
    if (id === 'try-it') return tryIt(a, args);
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
      if (!res.ok && id === 'retry' && BASE_PROMPT.has(res.code)) return { ...res, prompt: 'base' };
      if (!res.ok) return refuse(words, { ...res, words }, args.quiet);
      // a resume answers the pipeline's new run id: it is the same task, so its old ids keep finding it
      if (res.data?.runId && a.pipelineId && (id === 'retry' || id === 'raise-cap' || id === 'switch-model')) alias.set(str(res.data.runId), a.pipelineId);
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
      if (id === 'tags' || id === 'labels') keepSaved(args.taskId || a.pipelineId, id, id === 'tags' ? a.tags : a.labels);
      if (/^(service-start|service-stop|stack-start|stack-stop|builtin|checkout|discard|apply)$/.test(id)) loadParts(args.taskId || a.pipelineId);
      if (id === 'checkout') {
        const m = (res.data?.members || []).find((x) => x.state === 'checked-out' && x.worktreeDir);
        return { ...res, say: m ? `Checked out ${str(m.branch)} at ${str(m.worktreeDir)}` : 'Checked out on this machine' };
      }
      if (/^(merge|rerun-checks|fix-checks)$/.test(id) && a.pipelineId) { invalidate(a.pipelineId); refreshChecks(args.taskId || a.pipelineId, { force: true }); }
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

  /** A run-state label on the page or the card: the Tasks actions, else Chat's FLOW (D13). */
  function flow(label, given = {}) {
    const f = TASK_FLOW[label];
    // Retry and Restart Build (D10, D19): a paused or interrupted task resumes its failed step; a stopped or errored one
    // restarts Build as a new round.
    if (label === 'Retry' || label === 'Restart Build' || label === 'Try again') {
      const st = lc(inputOf(given.taskId || given.pipelineId || '').state?.status);
      return act(/^(stopped|error|failed)$/.test(st) && label !== 'Try again' ? 'restart-build' : 'retry', given);
    }
    if (f?.act) return act(f.act, given);
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
    if (NEEDS_PR.has(label) && !a.pr) return false;
    if (NEEDS_PR.has(label) && (a.taskId || a.pipelineId) && wsOf(resolve(a.taskId || a.pipelineId)?.projectKey) && !memberKeyOf(a.taskId || a.pipelineId)) return false;   // a PR per project (the page's task or a chat card's run)
    if (label === 'Re-run checks') return !/bitbucket\.org/.test(str(a.pr));
    if (TASK_FLOW[label]?.cases) return TASK_FLOW[label].cases.includes(str(a.case));
    return !!TASK_FLOW[label] || (!!CHAT_FLOW[label] && (!CHAT_FLOW[label].needsPr || !!a.pr));
  }

  /** A list action (D17). `args.ids`: the rows' task ids; their pipeline ids and live run ids come from resolve. */
  async function list(id, args = {}) {
    const def = LIST_ACTIONS[id]; if (!def) return refuse(id, { ok: false, error: 'this action is unknown' });
    const rs = (args.ids || []).map((x) => resolve(x) || { pipelineId: x });
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
    parts: (id) => { const p = parts.get(id); return p ? { ...p, agents: agentRowsOf(inputOf(id).state?.steps) } : null; }, loadParts, wholeDiff, docText, download, models,
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
    state: (id) => (isGroup(id) ? (!groupList ? (groupFailed ? 'failed' : 'loading') : ({ null: 'loading', false: 'gone' })[String(group(id.slice(6)))] || 'ready') : !listLoaded() ? (listFailed() ? 'failed' : 'loading') : !resolve(id) ? 'gone' : tasks.get(id)?.state || 'loading'),
    detail: (id) => (isGroup(id) ? groupDetail(id) : taskPageOf(inputOf(id), { now: now() })),
    card: (id) => taskCardOf(inputOf(id)),
    input: inputOf, checks: checksOf, refreshChecks, frame, act, flow, canFlow,
    pending: (key) => runner.pending.has(key), keyOf: runner.keyOf,
    /** The list's first load failed (or was asked again): a task page waiting on it looks again. */
    listChanged: () => notify(null),
    onChange: (fn) => { fns.add(fn); return () => fns.delete(fn); },
    onChecks: (fn) => { checkFns.add(fn); return () => checkFns.delete(fn); },
  };
}
