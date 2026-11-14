// ui/public/stillhet/live/task-page.mjs — the one place dev's run state becomes the task page and the chat TaskCard
// (Stillhet Tasks, D3). Pure: no DOM, no fetch, `now` passed in. Input, the same for the page and the card:
//   { row: the store's task (live-map.mjs taskOfLive / taskOfSaved), state: dev's run state (GET /api/history/:key/:id
//     `state`, patched by the live run's `state` frames), checks: the task's checks entry (task-live.mjs, GET /api/pr/checks),
//     group, plan, diff }.
// A field dev cannot fill is left out, so the part that draws it hides (D3).
import { prCaseOf, stageOfStep, STAGE_LABEL, failureItems, shortDetail } from './live-map.mjs';
import { currentPass } from '../../../../src/shared/shape/role-review.mjs';

export { stageOfStep };

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const lc = (v) => str(v).toLowerCase();

const FAILED_STEP = /^(error|failed)$/;
// a ledger row in flight reads `start` (dev's ledger never writes `running` there)
const STEP_STATE = { done: 'done', start: 'now', running: 'now', paused: 'paused', error: 'failed', failed: 'failed', stopped: 'stopped' };

// dev's bookend rows (run-harness: x:preflight:1, x:sync:1, x:done:1, no agent) are no work stage's step
const bookend = (s = {}) => !s.agentKey && (/^x:(preflight|sync|done):/.test(str(s.executionId) || str(s.key)) || /^(preflight|sync|done)$/.test(lc(s.nodeId)));
// a workflow's step on the page: an agent or a script (the Task input, End, gates and joins are no step), placed by its
// own progressStage, else by its key
const STEP_KINDS = /^(agent|script)$/;
const WORK_STAGE = /^(plan|build|review)$/;
const stageOfNode = (n) => (WORK_STAGE.test(str(n.progressStage)) ? n.progressStage : stageOfStep(n));
const rowState = (rows) => (rows.some((r) => STEP_STATE[lc(r.status)] === 'now') ? 'now' : STEP_STATE[lc(rows.at(-1)?.status)] || 'next');
/** dev's steps folded into the page's three work stages: [{ key, label, state: done|now|failed|paused|stopped|next, costUsd,
 *  activeMs, steps: [{ name, state }] }]. `nodes`: the workflow's graph nodes (state.stepper.graph.nodes): a stage's steps are
 *  its nodes, named by their labels and marked by their ledger rows; a stage none of them is in, and no step ran in, is left
 *  out (a Restart Build round's workflow has no planner). An empty list (Auto still deciding) keeps all three, and its steps
 *  are the ledger's own. */
export function stagesOf(steps = [], nodes = []) {
  const flow = arr(nodes).filter((n) => n && !bookend(n) && (!n.kind || STEP_KINDS.test(str(n.kind))));
  // a ledger row for a node of the graph that is no step (the Task input, End, a gate) is no stage's step either
  const notStep = new Set(arr(nodes).filter((n) => n && !flow.includes(n)).map((n) => str(n.id)));
  const work = arr(steps).filter((s) => s && !bookend(s) && !notStep.has(str(s.nodeId)));
  const byId = new Map(flow.map((n) => [str(n.id), n]));
  const stageOfRow = (s) => (byId.has(str(s.nodeId)) ? stageOfNode(byId.get(str(s.nodeId))) : stageOfStep(s));
  const has = flow.map(stageOfNode);
  return ['plan', 'build', 'review'].filter((key) => !has.length || has.includes(key) || work.some((s) => stageOfRow(s) === key)).map((key) => {
    const mine = work.filter((s) => stageOfRow(s) === key);
    const states = mine.map((s) => STEP_STATE[lc(s.status)] || 'next');
    const state = !mine.length ? 'next' : states.includes('failed') ? 'failed' : states.includes('now') ? 'now'
      : states.includes('paused') ? 'paused' : states.includes('stopped') ? 'stopped' : states.every((x) => x === 'done') ? 'done' : 'now';
    // the workflow's nodes in this stage, then any step the ledger ran that no node names, once per node or agent
    const own = flow.filter((n) => stageOfNode(n) === key).map((n) => ({ name: str(n.label) || str(n.key) || str(n.id), rows: mine.filter((s) => str(s.nodeId) === str(n.id)) }));
    const loose = new Map();
    for (const s of mine.filter((x) => !byId.has(str(x.nodeId)))) { const k = str(s.agentKey) || str(s.nodeId) || str(s.key); (loose.get(k) || loose.set(k, []).get(k)).push(s); }
    const list = own.concat([...loose].map(([name, rows]) => ({ name, rows })));
    return { key, label: STAGE_LABEL[key], state, costUsd: mine.reduce((a, s) => a + (num(s.costUsd) || 0), 0), activeMs: mine.reduce((a, s) => a + (num(s.activeMs) || 0), 0),
      steps: list.map((x) => ({ name: x.name, state: rowState(x.rows) })) };
  });
}

/** What failed, as c17 draws it: { stage: 'Build', reason, items: ['✗ …'] }, or null. */
export function failureOf(state = {}) {
  const steps = arr(state.steps);
  const failed = steps.filter((s) => FAILED_STEP.test(lc(s.status))).at(-1);
  const s = lc(state.status);
  if (!failed && !FAILED_STEP.test(s) && !(s === 'paused' && /error|fail/.test(lc(state.pauseReason)))) return null;
  const text = str(failed?.error) || str(state.error) || str(state.pauseDetail);
  // a line break, or a ✗ mark: dev's core stores a paused run's error on one line (run-harness clipMiddle folds the whitespace)
  const lines = text.split(/\r?\n|\s+(?=✗)/).map((l) => l.trim()).filter(Boolean);
  // an error that starts with its first ✗ item has no reason line of its own: 'Failed', and that item stays an item
  const head = lines[0] && !lines[0].startsWith('✗') ? 1 : 0;
  const marked = failureItems(text), items = marked.length ? marked : lines.slice(head).map((l) => l.replace(/^[x×]\s*/, ''));
  return { stage: STAGE_LABEL[failed ? stageOfStep(failed) : 'build'], reason: head ? lines[0] : 'Failed', items: items.slice(0, 3).map((l) => `✗ ${l}`) };
}

const prOf = (row, state) => {
  const pr = state?.pr && typeof state.pr === 'object' ? state.pr : null;
  return { url: str(pr?.url) || str(row?.pr), state: str(pr?.state).toUpperCase() || (str(row?.pr) ? 'OPEN' : '') };
};
const prNumber = (url) => (/\/(?:pull|pullrequest|pull-requests)\/(\d+)/.exec(str(url)) || [])[1] || '';

/** The case both places show: an open PR's from its checks entry, else the store's (D5). */
function caseFor({ row = {}, state = {}, checks = null }) {
  const pr = prOf(row, state);
  const fromChecks = pr.url && pr.state === 'OPEN' && row.case !== 'merged' ? prCaseOf(checks) : null;
  return fromChecks || str(row.case) || 'working';
}

/** The PR's state mark (GitMark): branch only, open, checks pass or failing, conflicts, merged. */
function gitOf(c, pr, branch) {
  if (pr.state === 'MERGED' || c === 'merged') return 'merged';
  if (pr.url && pr.state === 'CLOSED') return 'closed';
  if (pr.url) return c === 'approved' ? 'pass' : c === 'failing' ? 'fail' : c === 'conflicts' ? 'conflict' : 'open';
  return branch ? 'branch' : '';
}

/** The checks list and the approvals, as c18 draws them: ['✓ All 12 checks pass', 'Approved by Maya']. */
function checksWhy(checks) {
  if (!checks || typeof checks !== 'object') return [];
  const c = checks.checks || {};
  const out = [];
  const total = num(c.total) || 0, failed = num(c.failed) || 0, pending = num(c.pending) || 0;
  if (total && !failed && !pending) out.push(`✓ ${total === 1 ? 'The check passes' : `All ${total} checks pass`}`);
  else if (failed) out.push(`✗ ${failed} of ${total} checks failing`);
  else if (pending) out.push(`… ${pending} of ${total} checks running`);
  const approved = arr(checks.reviews).filter((r) => r && r.state === 'APPROVED').map((r) => str(r.by)).filter(Boolean);
  if (approved.length) out.push(`Approved by ${approved.join(', ')}`);
  return out;
}

/** The chat TaskCard's fields (c17, c18): { case, branch?, base?, detail?, why?, git?, watch?, prUrl?, failedChecks? }. */
export function taskCardOf(input = {}) {
  const { row = {}, state = {}, checks = null } = input;
  const c = caseFor(input);
  const pr = prOf(row, state);
  const branch = str(state.branch?.feature);
  const base = str(checks?.base) || str(state.branch?.source);
  const fail = failureOf(state);
  const why = fail ? fail.items : /^(approved|failing|conflicts|checks)$/.test(c) ? checksWhy(checks) : [];
  // R-arch-3: the card's failure line is the one Pulse and the bell draw (live-map.mjs shortDetail)
  const failed = fail ? arr(state.steps).filter((s) => FAILED_STEP.test(lc(s?.status))).at(-1) : null;
  const detail = fail ? shortDetail({ status: 'failed', error: str(failed?.error) || str(state.error) || str(state.pauseDetail), step: failed || null }) : '';
  const git = gitOf(c, pr, branch);
  const w = checks?.watch;
  const watch = w && typeof w === 'object' ? (w.status === 'fixing' || w.status === 'starting' ? 'fix' : w.watching ? 'idle' : '') : '';
  const failedChecks = num(checks?.checks?.failed);
  return { case: c, ...(branch ? { branch } : {}), ...(base && branch ? { base } : {}), ...(detail ? { detail } : {}),
    ...(why.length ? { why } : {}), ...(git ? { git } : {}), ...(watch ? { watch } : {}), ...(pr.url ? { prUrl: pr.url } : {}), ...(failedChecks ? { failedChecks } : {}) };
}

// the head's reason line says only what its word does not (§3, each fact once): no bare state word, and a cost cap's
// numbers are the Cost figure's ("$0.80 of $0.50"), never repeated in the sentence
const STATE_WORDS = /^(starting|working|pausing|paused|stopped|failed|finished|worca was stopped)$/i;
const CAP_REASON = { cost_pipeline: 'Reached this task\u2019s cost cap', cost_total: 'Reached the total cost limit' };
const STOPPED = 'Stopped by you · the branch and changes stay';
function reasonOf(row = {}, state = {}) {
  const why = CAP_REASON[str(state.pauseReason) || str(row.pauseReason)];
  if (why && /^(paused|capped)$/i.test(str(state.status) || str(row.case))) return why;
  // a stopped task says what stays, as the design's stopped case does
  if (/^(stopped|aborted)$/.test(lc(state.status)) || row.case === 'stopped') return STOPPED;
  if (row.case === 'plan') return '';   // the design's plan case says it all with Needs approval and its waiting step
  const d = str(row.detail);
  // a failing PR's row word (live-map.mjs prLine) is the why list's '✗ 2 of 5 checks failing', said once there
  return STATE_WORDS.test(d.trim()) || /cost limit reached \(/.test(d) || /^(\d+ checks? failing|checks failing)$/i.test(d.trim()) ? '' : d;
}

// D10: the plan's findings are the run's own: its role reviews (dev's state, or the plan question's current pass), its
// plan shape check and its concern; none of them, no finding. Shaped as the page's role and issue rows.
const FIXED = /^(fixed|resolved|withdrawn)$/;
function reviewOf(state = {}) {
  const q = state.pendingQuestion && typeof state.pendingQuestion === 'object' ? state.pendingQuestion : null;
  const p = q?.plan && typeof q.plan === 'object' ? q.plan : {};
  const last = currentPass(state.roleReviews || p.roleReviews)?.rounds?.at(-1);
  const roles = arr(last?.roles).filter((r) => r && !r.skipped).map((r) => {
    const findings = arr(r.findings).filter((f) => f && !FIXED.test(lc(f.status))).map((f) => str(f.title) || str(f.id)).filter(Boolean);
    return { role: str(r.label) || str(r.key), n: findings.length, t: findings.length ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` : 'Passed · no findings', findings };
  });
  const issues = arr((p.check || state.plan?.check)?.items).filter((it) => it && !it.pass).map((it) => ({ sev: 'To fix', t: str(it.label) || str(it.id), at: str(it.detail) }));
  const concern = q?.concern || state.concern;
  const said = typeof concern === 'string' ? concern : str(concern?.text) || str(concern?.title) || str(concern?.summary);
  if (said) issues.push({ sev: 'Concern', t: said, at: '' });
  return { roles, issues };
}
// the PR's checks as counts (dev gives no check names): Checks reads "2 failed" or "3 of 3 passed"
const checksOf = (checks) => { const c = checks?.checks; return c && typeof c === 'object' && num(c.total) ? { total: num(c.total), failed: num(c.failed) || 0, pending: num(c.pending) || 0 } : null; };

const ENDED = /^(done|complete|completed|stopped|aborted|error|failed)$/;
/** The task page's live view (D3): the instance facts run-page-model.js view() draws over the prototype's case. */
export function taskPageOf(input = {}, { now = 0 } = {}) {
  const { row = {}, state = {} } = input;
  const card = taskCardOf(input);
  const pr = prOf(row, state);
  const cost = num(state.totalCostUsd) ?? num(row.cost);
  const ms = num(state.totalActiveMs);
  // the cap the task is held to: its own, a project's, or Settings' (History's capUsd), so Raise the cap starts from it
  const cap = num(state.costCapUsd) ?? num(state.pipelineCapUsd) ?? num(state.capUsd);
  const failedChecks = num(input.checks?.checks?.failed);
  const started = Date.parse(str(state.startedAt));
  // c17 on the page: a bold head and one row per failure; the page's head then says nothing of it (each fact once)
  const fail = failureOf(state);
  const failure = fail ? { head: card.detail, rows: fail.items.map((l) => l.replace(/^✗\s*/, '')) } : null;
  return {
    id: str(row.id) || str(state.id),
    case: card.case,
    title: str(row.title) || str(state.title) || 'Untitled task',
    branch: card.branch || '',
    base: card.base || '',
    pr: pr.url ? `#${prNumber(pr.url)}` : '',
    prUrl: pr.url,
    detail: failure ? '' : card.detail || reasonOf(row, state),
    failure,
    review: reviewOf(state),
    checks: checksOf(input.checks),
    why: card.why || [],
    git: card.git || '',
    cost,
    cap,
    mins: ms != null ? Math.round(ms / 60000) : null,
    startedAgo: Number.isFinite(started) && now ? Math.max(0, Math.round((now - started) / 60000)) : null,
    startedAt: Number.isFinite(started) ? new Date(started).toISOString() : '',
    project: str(row.project) || str(state.projectName),
    labels: arr(row.labels).length ? arr(row.labels).filter((l) => typeof l === 'string') : arr(state.labels).map((l) => (typeof l === 'string' ? l : str(l?.name))).filter(Boolean),
    // a cost tag as the page writes it, `key: value` (dev stores `key:value`, src/shared/run-tags.mjs)
    tags: arr(state.tags).map((t) => (typeof t === 'string' ? t.replace(/:\s*/, ': ') : t && t.key ? (t.value ? `${t.key}: ${t.value}` : str(t.key)) : '')).filter(Boolean),
    prompt: str(state.prompt),
    // a task that ended with no ledger and no graph (dev kept no steps): no work stage, never three "Not yet" ones
    stages: ENDED.test(lc(state.status)) && !arr(state.steps).some((s) => s && !bookend(s)) && !arr(state.stepper?.graph?.nodes).length ? [] : stagesOf(state.steps, state.stepper?.graph?.nodes),
    ...(failedChecks ? { failedChecks } : {}),
    pauseAfterStep: state.pauseAfterStep === true,
  };
}

/** Start a new task from this one (D12a): the keys POST /api/run (startRunHandler) reads, copied from the saved run. */
export const NEW_TASK_KEYS = ['projectDir', 'workspaceId', 'prompt', 'source', 'workflowId', 'guardrailsId', 'engine', 'labels', 'tags'];
export function newTaskBodyOf(state = {}) {
  const body = {};
  if (str(state.workspaceId)) body.workspaceId = state.workspaceId;
  else if (str(state.projectDir)) body.projectDir = state.projectDir;
  if (state.source && typeof state.source === 'object' && state.source.type && state.source.type !== 'prompt') body.source = state.source;
  else if (str(state.prompt)) body.prompt = state.prompt;
  const wf = str(state.workflowId) || str(state.stepper?.template?.id);
  if (wf) body.workflowId = wf;
  if (str(state.guardrailsId)) body.guardrailsId = state.guardrailsId;
  const engine = str(state.engine) || str(state.runEngine);
  if (engine && engine !== 'claude') body.engine = engine;
  const labels = arr(state.labels).map((l) => (typeof l === 'string' ? l : str(l?.name))).filter(Boolean);
  if (labels.length) body.labels = labels;
  if (arr(state.tags).length) body.tags = state.tags;
  return body;
}

// ---- the page's parts on dev's data (D4): Changes, documents, Logs, the worktree's actions, a group ----
export const DIFF_PREVIEW = 40;   // lines of a file's diff the page shows before "Open the whole diff"
const ST = (block) => (/^new file mode/m.test(block) ? 'A' : /^deleted file mode/m.test(block) ? 'D' : /^rename from/m.test(block) ? 'R' : 'M');
/** dev's unified diff (GET …/diff, or live-diff's `patch`) → { files: [[path, added, removed]], fileMeta: {path: {st}},
 *  hunks: {path: {at, lines: [[k, text]], more}}, full: {path: text} }. A workspace's file is keyed `MEMBER/path`; its fileMeta
 *  carries the member and the path dev knows it by. */
export function patchFiles(text) {
  const out = { files: [], fileMeta: {}, hunks: {}, full: {} };
  // a workspace's patch names each member project on a `# KEY` line before its files (src/core/diff-anchor.mjs patchMembers)
  let member = '';
  for (const b of str(text).split(/^(?=diff --git )/m)) {
    const head = b.startsWith('diff --git ') ? /^diff --git a\/(.+?) b\/(.+)$/m.exec(b) : null;
    const own = member;
    for (const l of b.split('\n')) if (/^# \S/.test(l)) member = l.slice(2).trim();
    if (!head) continue;
    const path = head[2], key = own ? `${own}/${path}` : path;   // a workspace's two projects can change the same path
    const body = b.slice(b.search(/^@@/m) >= 0 ? b.search(/^@@/m) : b.length);
    const lines = body.split('\n').filter((l, i, all) => !(i === all.length - 1 && l === ''));
    // each row: [kind, text, side, line] — the side and line number dev's diff comments anchor to (src/core/diff-anchor.mjs)
    const rows = []; let o = 0, n = 0;
    for (const l of lines) {
      const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l);
      if (h) { o = +h[1]; n = +h[2]; continue; }
      if (l.startsWith('\\') || /^# \S/.test(l)) continue;
      const k = l[0] === '+' || l[0] === '-' ? l[0] : ' ';
      rows.push(k === '-' ? [k, l.slice(1), 'old', o++] : k === '+' ? [k, l.slice(1), 'new', n++] : [k, l.slice(1), 'new', (o++, n++)]);
    }
    const add = rows.filter(([k]) => k === '+').length, del = rows.filter(([k]) => k === '-').length;
    out.files.push([key, add, del]);
    out.fileMeta[key] = { st: ST(b), ...(own ? { member: own, path } : {}) };
    out.hunks[key] = { at: (/^@@.*$/m.exec(body) || [''])[0], lines: rows.slice(0, DIFF_PREVIEW), more: rows.length > DIFF_PREVIEW };
    out.full[key] = b.split('\n').filter((l) => !/^# \S/.test(l)).join('\n');   // the next project's `# KEY` line is not this file's
  }
  return out;
}
const DOC = /\.(md|markdown|txt)$/i;
/** dev's run artifacts (GET /api/runs/:id/artifacts) → the documents its steps wrote: [[name, step, relPath]]. */
export function docsOf(artifacts) {
  return arr(artifacts).filter((a) => a && DOC.test(str(a.relPath))).map((a) => [str(a.relPath).split('/').pop(), str(a.stepKey) || str(a.nodeId) || str(a.kind), str(a.relPath)]);
}
export const SYNC_STEP = 'Sync';
/** dev's run log (NDJSON, GET /api/history/:key/:id/log) → the page's log lines; the base sync's lines are the Sync step. */
export function logLinesOf(text) {
  const out = [];
  for (const l of str(text).split('\n')) {
    if (!l.trim()) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (!e || typeof e !== 'object') continue;
    const step = e.executionId === 'x:sync:1' || e.nodeId === 'sync' ? SYNC_STEP : str(e.nodeId) || str(e.source) || 'worca';
    const t = /T(\d\d:\d\d:\d\d)/.exec(str(e.ts));
    out.push({ t: t ? t[1] : '', step, from: str(e.source) || 'worca', lvl: str(e.level) || 'info', cycle: String(num(e.cycle) || 1), session: str(e.session), sum: str(e.desc) || str(e.text), raw: str(e.text) });
  }
  return out;
}
/** dev's worktree actions (GET /api/runs/:id/actions) → { services: [{key, id, name, port, running, url, member}], builtins: [{key, id, label, member}],
 *  stacks: [{id, name, steps, status, step, error}], checkedOut, enabled }. A service's and a built-in tool's `key` is its member and its id. A service's port is the one its running instance holds. */
export function actionsOf(data) {
  if (!data || typeof data !== 'object') return null;
  const inst = arr(data.instances);
  const services = [], builtins = [];
  const many = arr(data.members).length > 1;   // a workspace's services and tools say whose they are
  for (const m of arr(data.members)) {
    for (const a of arr(m.actions)) {
      const i = inst.find((x) => x && x.actionId === a.id && (!x.member || x.member === m.projectKey) && /^(starting|running|ready)$/.test(str(x.status)));
      const port = i ? Object.values(i.ports || {})[0] : null;
      services.push({ key: `${str(m.projectKey)}/${str(a.id)}`, id: str(a.id), name: (many ? `${str(m.projectName) || str(m.projectKey)} · ` : '') + (str(a.label) || str(a.id)), port: port ?? '', running: !!i, url: str(i?.url) || str(a.openUrl), member: str(m.projectKey) });
    }
    for (const b of arr(m.builtins)) builtins.push({ key: `${str(m.projectKey)}/${str(b.key)}`, id: str(b.key), label: (many ? `${str(m.projectName) || str(m.projectKey)} · ` : '') + str(b.label), member: str(m.projectKey) });
  }
  // a workspace's stacks: its members' services started together, in order (dev's GET …/actions `stacks`, `stackStates`)
  const states = arr(data.stackStates);
  const stacks = arr(data.stacks).filter((x) => x && str(x.id)).map((x) => {
    const st = states.find((y) => y && y.stackId === x.id) || null;
    return { id: str(x.id), name: str(x.label) || str(x.id), steps: arr(x.steps).length, status: str(st?.status), step: num(st?.step) ?? 0, error: str(st?.error) };
  });
  return { services, builtins, stacks, enabled: data.enabled !== false, checkedOut: arr(data.members).some((m) => m.state === 'checked-out') };
}
/** A run group (GET /api/run-groups) → the group page's facts: { id, title, kind, members: [{pipelineId, title, case, pr, prUrl}], cost }. */
export function groupOf(g, rowOf = () => null) {
  if (!g || typeof g !== 'object') return null;
  const members = arr(g.members).slice().sort((a, b) => (num(a.position) ?? 0) - (num(b.position) ?? 0)).map((m) => {
    const prUrl = str(m.pr?.url) || str(m.pr);
    const row = rowOf(str(m.pipelineId)) || {};
    return { pipelineId: str(m.pipelineId), title: str(m.title) || str(row.title) || 'Untitled task', case: str(row.case) || 'working', pr: prUrl ? `#${prNumber(prUrl)}` : '', prUrl, cost: num(row.cost) ?? 0 };
  });
  return { id: str(g.id), title: str(g.title) || 'Untitled group', kind: g.kind === 'feature' ? 'Feature' : 'Group', members, cost: num(g.cost?.usd) ?? 0 };
}
const kfmt = (n) => (n == null ? '—' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const usd = (n) => (n == null ? '—' : `$${n.toFixed(2)}`);
/** dev's sessions (GET /api/runs/:id/sessions) → the Sessions table's rows: [{ name, id, sid, turns, in, out, cache, cost }]. */
export function sessionRowsOf(data) {
  return arr(data?.sessions).map((x) => ({ name: str(x.label) || str(x.sid), id: str(x.hostSessionId) || str(x.sid), sid: str(x.sid), turns: String(num(x.turns) ?? 0), in: '—', out: '—', cache: '—', cost: usd(num(x.costUsd)) }));
}
/** dev's steps (the run state's ledger) → the Agents table's rows. */
export function agentRowsOf(steps) {
  return arr(steps).filter((x) => x && (x.agentKey || x.nodeId)).map((x) => ({ name: str(x.agentKey) || str(x.nodeId), type: str(x.agentKey) || str(x.kind) || 'agent', model: str(x.model) || '—',
    cycle: String(num(x.cycle) ?? num(x.ordinal) ?? 1), skills: '—', graph: '—', tokens: '—' }));
}
/** dev's run telemetry (GET /api/runs/:id/telemetry, Labs) → the Step usage table's rows. */
export function usageRowsOf(data) {
  return Object.values(data?.steps || {}).map((x) => ({ name: str(x.key), model: str(x.model) || '—', cache: pct(num(x.cacheShare)), calls: String(num(x.calls) ?? 0),
    retries: '—', compact: '—', errors: '—', time: num(x.toolMs) != null ? `${Math.round(x.toolMs / 1000)}s` : '—', peak: num(x.peak) != null && num(x.window) ? pct(x.peak / x.window) : kfmt(num(x.peak)) }));
}
/** dev's diff comments (GET /api/history/:key/:id/comments) → the Changes part's threads by path (a workspace's `MEMBER/path`, as patchFiles keys it): { path: [{ who, line, t }] }. */
export function commentsByPath(data) {
  const out = {};
  for (const c of arr(data?.comments)) { if (!c || !str(c.path) || c.parentId) continue; (out[str(c.projectKey) ? `${c.projectKey}/${c.path}` : c.path] ||= []).push({ who: str(c.authorName) || (c.author === 'user' ? 'You' : str(c.author) || 'Worca'), line: str(c.lineText), t: str(c.body) }); }
  return out;
}
