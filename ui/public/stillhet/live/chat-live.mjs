// ui/public/stillhet/live/chat-live.mjs — the live chat's one owner of thread fetches, subscriptions and Chat actions (D5).
// live-adapter.mjs starts it and hands it the socket's `ask-*` frames; the page reads `window.RailChatLive`. A thread is
// read with dev's `GET /api/ask/threads/:id`, kept in dev's own reducer (src/shared/ask-model.mjs createThreadModel) and
// drawn through chat-turns.mjs. Every action posts dev's route and body (D9, D11): nothing is written before the server
// answers ok, and a refusal toasts once, `Could not ACTION: REASON`, and changes nothing.
import { createThreadModel } from '../../../../src/shared/ask-model.mjs';
import { turnsOf, planView, planPicks } from './chat-turns.mjs';
import { createTerminalLive } from './terminal-live.mjs';
import { projectKeyOf } from './live-map.mjs';

const enc = encodeURIComponent;
const T = (id) => `/api/ask/threads/${enc(id)}`;
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);

/** POST /api/pr's body for a run card's Create PR or Ship (ui/routes/history/pull-requests.mjs reads these keys). The
 *  route needs the run's scope: its store key, else its project folder. The task page's Create PR dialog adds its base
 *  branch and its Watch box. */
export function prBodyOf({ pipelineId, title, body, draft, watch, base, threadId, cardId, projectKey, projectDir } = {}) {
  return { id: str(pipelineId), title: str(title), ...(body ? { body: str(body) } : {}), ...(draft ? { draft: true } : {}), ...(watch ? { watch: true } : {}), ...(str(base) ? { baseBranch: str(base) } : {}), ...(threadId && cardId ? { askThreadId: threadId, askCardId: cardId } : {}), ...(str(projectKey) ? { projectKey } : str(projectDir) ? { projectDir } : {}) };
}
/** A run's changes as a patch: a folder run's copy diff (GET …/changes/patch, folder-only), else dev's recovery-patch
 *  (the retained work, else the run's diff) scoped as app.js runActionQuery scopes it. */
function patchUrl(a) {
  const id = enc(a.pipelineId || a.runId);
  if (a.folder) return `/api/runs/${id}/changes/patch`;
  const key = str(a.projectKey), qs = new URLSearchParams();
  if (key.startsWith('workspaces/')) qs.set('workspaceId', key.slice('workspaces/'.length));
  else if (key) qs.set('projectKey', key);
  else if (str(a.projectDir)) qs.set('projectDir', a.projectDir);
  return `/api/runs/${id}/recovery-patch${qs.size ? `?${qs}` : ''}`;
}

/** POST /api/run's body for a TaskProposal's Start: the proposal card as dev's ask-panel.mjs collectCardBody reads it,
 *  with the person's `picks` (target, project folder, workflow, engine, guardrails, title, branches) over the card's own values. */
export function startBodyOf(card = {}, picks = {}) {
  const c = card || {}, p = picks || {};
  const target = p.target || c.target || 'project';
  const body = { prompt: str(p.brief ?? c.brief), workflowId: str(p.workflowId || c.workflowId), guardrailsId: str(p.guardrailsId || c.guardrailsId), mock: false };
  const title = str(p.title || c.title).trim(); if (title) body.title = title;
  if (c.memoryScope && body.workflowId === 'wf_memory_defrag') body.memoryScope = c.memoryScope;
  if (Array.isArray(c.tags) && c.tags.length) body.tags = c.tags;
  if (p.engine || c.engine) body.engine = p.engine || c.engine;
  if (c.source) { delete body.prompt; body.source = { type: 'plugin', plugin: c.source.plugin, sourceId: c.source.sourceId, taskId: c.source.taskId, ...(c.source.profile ? { profile: c.source.profile } : {}), ...(c.source.inputs ? { inputs: c.source.inputs } : {}) }; }
  if (target === 'none') { body.noProject = true; return body; }
  if (p.sameAsSource ?? c.sameAsSource) body.sameAsSource = true;
  else if (p.featureBranch || c.featureBranch) body.featureBranch = p.featureBranch || c.featureBranch;
  if (target === 'workspace') {
    body.workspaceId = p.workspaceId || c.workspaceId;
    if (p.sourceBranch || c.sourceBranch) body.sourceBranch = p.sourceBranch || c.sourceBranch;
    if (c.sourceBranchByKey && Object.keys(c.sourceBranchByKey).length) body.sourceBranchByKey = c.sourceBranchByKey;
  } else {
    body.projectDir = p.projectDir || c.projectDir;
    if (p.sourceBranch || c.sourceBranch) body.sourceBranch = p.sourceBranch || c.sourceBranch;
  }
  return body;
}

// Each route action (Step 7): its words in `Could not …`, and its request from the action's args.
export const ACTIONS = Object.freeze({
  stop: ['stop the reply', (a) => ['POST', `${T(a.threadId)}/stop`]],
  answer: ['answer the question', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, a.text != null ? { text: a.text } : { choice: a.choice }]],
  'run-answer': ["answer the task's question", (a) => ['POST', '/api/answer', { runId: a.runId, id: a.id, payload: a.payload }]],
  // a plan's open choices ride its answer (`picks`: chat-turns.mjs planPicks), as dev's plan card sends them
  'plan-approve': ['approve the plan', (a) => ['POST', `/api/runs/${enc(a.runId)}/answer`, { id: a.id, decision: 'approve', ...(a.picks || {}) }]],
  'plan-changes': ['send your changes', (a) => ['POST', `/api/runs/${enc(a.runId)}/answer`, { id: a.id, decision: 'revise', feedback: a.feedback, ...(a.picks || {}) }]],
  'plan-fix': ['fix the plan', (a) => ['POST', `/api/runs/${enc(a.runId)}/answer`, { id: a.id, decision: 'revise', feedback: a.feedback, source: 'check', ...(a.picks || {}) }]],
  'plan-stop': ['stop the plan', (a) => ['POST', `/api/runs/${enc(a.runId)}/answer`, { id: a.id, decision: 'stop' }]],
  'plan-read': ['read the plan', (a) => ['GET', `/api/runs/${enc(a.runId)}/plan`]],
  'plan-save': ['save the plan', (a) => ['POST', `/api/runs/${enc(a.runId)}/plan/save`, a.overwrite ? { overwrite: true } : {}]],
  start: ['start the task', (a) => ['POST', '/api/run', { ...startBodyOf(a.card, a.picks), askThreadId: a.threadId, askCardId: a.cardId }]],
  'card-apply': ['apply the change', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: 'applied', ...(a.scope ? { scope: a.scope } : {}) }]],
  'card-later': ['set the proposal aside', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: a.run ? 'dismissed' : 'declined' }]],
  'card-revert': ['undo the change', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: 'reverted' }]],
  'card-verb': ['answer the card', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { ...(a.body || {}) }]],
  'card-offer': ['run the script', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { choice: a.choice }]],
  'task-pause': ['pause the task', (a) => ['POST', '/api/pause', { runId: a.runId }]],
  'task-resume': ['resume the task', (a) => ['POST', '/api/resume', { pipelineId: a.pipelineId || a.runId, ...(a.ignoreCostCap ? { ignoreCostCap: true } : {}) }]],
  'task-archive': ['archive the task', (a) => ['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: a.pipelineId || a.runId }] }]],
  'chat-label': ['label the chat', (a) => ['PUT', `${T(a.threadId)}/labels`, { labels: a.labels }]],
  'task-label': ['label the task', (a) => ['PUT', `/api/runs/${enc(a.pipelineId || a.runId)}/labels`, { labels: a.labels }]],
  'task-watch-state': ['read the PR watch', (a) => ['GET', `/api/pr/watch?id=${enc(a.pipelineId || a.runId)}`]],
  'task-watch': ['watch the PR', (a) => ['POST', '/api/pr/watch', { watch: !!a.watch, id: a.pipelineId || a.runId }]],
  'task-terminal': ['open a terminal in the worktree', (a) => ['POST', `/api/runs/${enc(a.pipelineId || a.runId)}/resolve-terminal`, {}]],
  'task-stop': ['stop the task', (a) => ['POST', '/api/stop', { runId: a.runId }]],
  changes: ['send your changes', (a) => ['POST', `${T(a.threadId)}/changes`, { pipelineId: a.pipelineId, text: a.text }]],
  direction: ['send the direction', (a) => ['POST', `${T(a.threadId)}/directions`, { runId: a.runId, text: a.text }]],
  pr: ['create the PR', (a) => ['POST', '/api/pr', prBodyOf(a)]],
  ship: ['create the PR', (a) => ['POST', `/api/shape/features/${enc(a.featureId)}/ship`, { mode: a.mode === 'stacked' ? 'stacked' : 'one' }]],
  'ship-mark': ['mark the requirement', (a) => ['PUT', `/api/shape/features/${enc(a.featureId)}/acceptance`, { entries: [a.entry] }]],
  'file-reveal': ['show it in its folder', (a) => ['POST', `${T(a.threadId)}/attachments/${enc(a.attId)}/reveal`]],
  folder: ['open the folder picker', () => ['POST', '/api/fs/pick-folder']],
  worktree: ['remove the worktree', (a) => ['DELETE', `${T(a.threadId)}/worktrees/${enc(a.worktreeId)}`]],
  'mcp-off': ['switch the sets', (a) => ['PATCH', T(a.threadId), { mcpOff: a.mcpOff }]],
  'mcp-preview': ['load the sets', (a) => ['POST', '/api/ask/mcp-preview', { ...(a.threadId ? { threadId: a.threadId } : {}), ...(a.model ? { model: a.model } : {}), ...(a.mcpOff ? { mcpOff: a.mcpOff } : {}) }]],
  'cmd-stop': ['stop the command', (a) => ['POST', `/api/terminal/sessions/${enc(a.sessionId)}/stop`]],
  terminal: ['open the terminal', (a) => ['GET', `/api/terminal/sessions/${enc(a.sessionId)}`]],
  rename: ['rename the chat', (a) => ['PATCH', T(a.threadId), { title: a.title }]],
  pin: ['pin the chat', (a) => ['PATCH', T(a.threadId), { pinned: !!a.on }]],
  archive: ['archive the chat', (a) => ['PATCH', T(a.threadId), { archived: !!a.on }]],
  delete: ['delete the chat', (a) => ['DELETE', T(a.threadId)]],
  'group-new': ['add the chat to the group', (a) => ['POST', '/api/ask/groups', { name: a.name, nameSource: 'user', threadIds: a.threadIds }]],
  'group-add': ['add the chat to the group', (a) => ['POST', `/api/ask/groups/${enc(a.groupId)}/threads`, { threadIds: a.threadIds }]],
  'group-move': ['move the chat', (a) => ['POST', `/api/ask/groups/${enc(a.groupId)}/threads`, { threadIds: a.threadIds }]],
  'group-leave': ['take the chat out of its group', (a) => ['DELETE', `/api/ask/groups/${enc(a.groupId)}/threads/${enc(a.threadId)}`]],
  'group-rename': ['rename the group', (a) => ['PATCH', `/api/ask/groups/${enc(a.groupId)}`, { name: a.name, nameSource: 'user' }]],
  'group-archive': ['archive the group', (a) => ['POST', `/api/ask/groups/${enc(a.groupId)}/archive`, { archived: a.on !== false }]],
  'group-delete': ['delete the group', (a) => ['DELETE', `/api/ask/groups/${enc(a.groupId)}${a.deleteChats ? '?deleteChats=true' : ''}`]],
  'group-undo': ['undo', (a) => ['POST', '/api/ask/groups/undo', { token: a.token }]],
  scope: ['switch the project', (a) => ['PATCH', T(a.threadId), { scope: a.scope }]],
  model: ['switch the model', (a) => ['PATCH', T(a.threadId), { model: a.model, effort: a.effort }]],
  engine: ['switch the engine', (a) => ['POST', `${T(a.threadId)}/engine`, { engine: a.engine, model: a.model, effort: a.effort, ...(Number.isInteger(a.dropTurns) ? { dropTurns: a.dropTurns } : {}) }]],
  pins: ['pin the starter', (a) => ['PUT', '/api/chat-home/pins', { pins: a.pins }]],
});
const SEND_WORDS = 'send your message';
// Read ids whose answer is a file or a page: opened in a new tab on dev's own GET (D11), never fetched and dropped
export const OPENS = Object.freeze({
  artifact: ['open the file', (a) => `/api/runs/${enc(a.pipelineId)}/artifact-raw/${String(a.name || '').split('/').map(enc).join('/')}${a.download ? '?download=1' : ''}`],
  file: ['open the file', (a) => `${T(a.threadId)}/attachments/${enc(a.attId)}`],
  diff: ['open the changes', patchUrl],
  url: ['open the PR', (a) => (/^https:\/\//.test(str(a.url)) ? a.url : '')],
  patch: ['download the patch', patchUrl],
});
export const COPY_WORDS = 'copy', ATTACH_WORDS = 'attach the file';

/** A new tab on dev's GET. `noopener` would make window.open answer null even when the tab opened, so the opener is cut
 *  by hand and null stays the one sign that the browser blocked it. */
export function openTab(u) {
  const w = globalThis.open?.(u, '_blank') ?? null;
  if (w) { try { w.opener = null; } catch { /* a cross-origin tab already has none */ } }
  return w;
}

/** D13: the one action path Chat and Tasks share. `request` answers `{ok, data}` or `{ok:false, status?, error, code?}`
 *  (a network failure too); `refuse(words, res)` says `Could not WORDS: REASON` once, unless the caller says it itself
 *  (`quiet`); `keyOf` names a control while it is pending; `run(key, words, fn)` refuses a second press and holds the
 *  key until `fn` settles. Nothing is written by the runner: callers write only after `ok`. */
export function actionRunner({ fetch, toast = () => {}, notify = () => {} } = {}) {
  const pending = new Set();
  async function request(method, url, body) {
    let r;
    try { r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch (e) { return { ok: false, error: str(e?.message) || 'no connection' }; }
    let data = null; try { data = await r.json(); } catch { data = null; }
    return r.ok ? { ok: true, data } : { ok: false, status: r.status, error: str(data?.error) || `HTTP ${r.status}`, ...(data?.code ? { code: data.code, data } : {}) };
  }
  const refuse = (words, res, quiet = false) => { if (!quiet) toast(`Could not ${words}: ${res.error}`); return res; };
  const keyOf = (id, args = {}) => args.key || `${id}:${args.cardId || args.threadId || args.runId || args.pipelineId || args.sessionId || 'new'}`;
  async function run(key, words, fn, { quiet = false, scope = '' } = {}) {
    if (pending.has(key)) return refuse(words, { ok: false, error: 'it is already on its way' }, quiet);
    pending.add(key); notify(scope);
    try { return await fn(); } finally { pending.delete(key); notify(scope); }
  }
  return { request, refuse, keyOf, run, pending };
}

/** `doc`-free: the page's toast and clock come in. `send(msg)` writes a socket message; `tasksOf(threadId)` is the chat's
 *  tasks (live-map.mjs chatOf), so a run card names its store task. */
export function startChatLive({ fetch, send = () => {}, toast = () => {}, now = Date.now, tasksOf = () => [], clipboard = null, open: openUrl = openTab, go = () => {}, progressOf = () => ({}), askOf = () => null } = {}) {
  const threads = new Map(), fns = new Set();
  const term = createTerminalLive({ fetch, send, now });   // D14: a command's TerminalPane
  let spare = '';   // D10: a new chat whose first message was refused and whose cleanup DELETE failed; the retry reuses it
  const notify = (id) => { for (const fn of fns) { try { fn(id); } catch (e) { console.error(e); } } };
  const entry = (id) => { if (!threads.has(id)) threads.set(id, { state: '', model: null, buffer: [], loading: null, reloading: false, hidden: new Set() }); return threads.get(id); };

  // D13: the pending keys, the request and the refusal are the shared runner's (Tasks uses the same one)
  // a bulk action says one sentence for all its calls (chats-column.js): `quiet` is that call's own, never shared
  const runner = actionRunner({ fetch, toast, notify: (id) => notify(id) });
  const { request, refuse, keyOf, pending } = runner;

  // `stale`: a reconnect starts a newer read while one is out; each read carries its generation and only the newest one
  // writes the model, the state and `reloading`, and drains the buffer
  function open(id, { force = false, stale = false } = {}) {
    if (!id) return Promise.resolve();
    const e = entry(id);
    if (e.loading && !stale) return e.loading;
    if (e.state === 'ready' && !force && !stale) return Promise.resolve();
    if (e.state !== 'ready') { e.state = 'loading'; notify(id); }
    e.reloading = true;   // a forced re-read keeps the turns on screen; its frames wait for the new model, as on a first open
    const gen = (e.gen = (e.gen || 0) + 1);
    send({ type: 'subscribe', threadId: id });
    const p = (async () => {
      const r = await fetch(T(id), { headers: { Accept: 'application/json' } }).catch(() => null);
      let snap = null;
      if (r && r.ok) { try { snap = await r.json(); } catch { snap = null; } }
      if (e.gen !== gen) return e.loading;   // a newer read owns the thread now
      e.loading = null; e.reloading = false;
      if (!snap || typeof snap !== 'object') {
        // a re-read of an open conversation that fails keeps what is shown; its waiting frames are applied as they came
        // 404, or 400 for an id dev can never hold ('invalid thread id'): the chat is gone, and Try again could never work
        const gone = !!r && (r.status === 404 || r.status === 400);
        if (e.model && e.state === 'ready' && !gone) { const q = e.buffer; e.buffer = []; for (const f of q) e.model.apply(f); notify(id); return; }
        e.state = gone ? 'gone' : 'failed'; e.buffer = []; notify(id); return;
      }
      e.model = createThreadModel({ threadId: id });
      e.model.load(snap);
      // frames that came while the thread was read: applied once, in seq order (the reducer drops what the GET already had)
      const q = e.buffer.map((f, i) => [f, i]).sort((a, b) => ((a[0].seq ?? 0) - (b[0].seq ?? 0)) || a[1] - b[1]).map(([f]) => f);
      e.buffer = [];
      e.state = 'ready';
      for (const f of q) e.model.apply(f);
      notify(id);
    })();
    e.loading = p;
    return p;
  }
  /** A socket frame (live-adapter.mjs passes every `ask-*` one). A frame for an open thread is reduced; one that comes
   *  while the thread is read waits for it; a seq gap reads the thread again. */
  function frame(f) {
    if (typeof f?.type === 'string' && f.type.startsWith('term-')) { term.frame(f); return; }
    const id = str(f?.threadId), e = id && threads.get(id);
    if (!e) return;
    if (e.state === 'loading' || e.reloading) { e.buffer.push(f); return; }
    if (e.state !== 'ready' || !e.model) return;
    const r = e.model.apply(f);
    if (r?.gap) { open(id, { force: true }); return; }
    if (!r?.dropped) notify(id);
  }
  // the lists a Chat control picks from, read once from dev's own GET routes (the person's choices come from these, never
  // from the demo's): a failed read is not kept, so the next look asks again
  const CATALOG = { groups: '/api/run-groups', guardrails: '/api/guardrails', models: '/api/ask/models', workflows: '/api/workflows', pins: '/api/chat-home/pins', projects: '/api/projects', labels: '/api/ask/labels' };
  const lists = new Map();
  function catalog(name, { fresh = false } = {}) {
    if (fresh) lists.delete(name);
    if (!lists.has(name)) lists.set(name, request('GET', CATALOG[name]).then((r) => { if (!r.ok) lists.delete(name); else notify(''); return r; }));
    return lists.get(name);
  }
  // panel.answer-refs: dev's POST /api/ask/refs/resolve, at most REFS_MAX keys a call; an answer is kept for the page's
  // life, a failed call reads as unconfirmed (plain words). `ref(key, threadId)` answers what is known now and asks for the rest.
  const refs = new Map(), asking = new Map();
  let flushing = null;
  function flushRefs() {
    flushing = null;
    const keys = [...asking.keys()].slice(0, 50), ids = new Set(keys.map((k) => asking.get(k)));
    for (const k of keys) asking.delete(k);
    request('POST', '/api/ask/refs/resolve', { refs: keys }).then((r) => {
      for (const k of keys) refs.set(k, r.ok && r.data?.refs?.[k]?.ok ? r.data.refs[k] : { ok: false });
      for (const id of ids) notify(id);
      if (asking.size && !flushing) flushing = Promise.resolve().then(flushRefs);
    });
  }
  function ref(key, threadId = '') {
    if (refs.has(key)) return refs.get(key);
    if (!asking.has(key)) { refs.set(key, null); asking.set(key, threadId); if (!flushing) flushing = Promise.resolve().then(flushRefs); }
    return null;
  }
  // A feature's total cost and elapsed time (its run-group from GET /api/run-groups: `cost.usd`; the time from its first
  // run's start to its last one's end, or now while one runs). null until the groups are read, or for a run in no feature.
  let groups = null;
  function feature(runId, threadId = '', { fresh = false } = {}) {
    if (fresh || (!groups && !lists.has('groups'))) catalog('groups', { fresh }).then((r) => { if (r.ok) { groups = arr(r.data?.groups); notify(threadId); } });
    const pid = api.runOf?.(runId)?.pipelineId || runId;
    const g = (groups || []).find((x) => x && x.kind === 'feature' && [...arr(x.members).map((m) => m?.pipelineId), x.planning?.pipelineId].includes(pid));
    if (!g) return null;
    const spans = [...arr(g.members).map((m) => m?.pipelineId), g.planning?.pipelineId].filter(Boolean).map((id) => api.runOf?.(id) || {}).filter((s) => s.startedAt);
    const from = Math.min(...spans.map((s) => Date.parse(s.startedAt))), to = Math.max(...spans.map((s) => (s.endAt ? Number(s.endAt) || Date.parse(s.endAt) : now())));
    return { title: str(g.title), usd: typeof g.cost?.usd === 'number' ? g.cost.usd : null, ms: Number.isFinite(from) && Number.isFinite(to) && to >= from ? to - from : null, runs: arr(g.members).length };
  }
  const linksOf = (m) => [...m.runLinks().entries()].map(([runId, l]) => ({ runId, ...l }));
  function turns(id) {
    const e = threads.get(id);
    if (!e || e.state !== 'ready') return [];
    const messages = e.model.messages().filter((m) => !e.hidden.has(m.id));
    return turnsOf({ messages, runLinks: linksOf(e.model), inFlight: e.model.inFlight() }, { tasks: tasksOf(id), now: now() });
  }

  // D10: a send on Chat home makes the thread first; a refused message deletes it again, and a failed delete keeps it
  async function sendMessage(a) {
    let id = a.threadId, made = '';
    if (!id) {
      if (spare) id = spare;
      else {
        const c = await request('POST', '/api/ask/threads', {});
        if (!c.ok) return refuse(SEND_WORDS, c, a.quiet);
        id = made = str(c.data?.thread?.id);
      }
    }
    // a new chat is subscribed before its first message goes, so no frame of the reply is missed; they wait in its buffer
    const fresh = !a.threadId && threads.get(id)?.state !== 'ready';
    if (fresh) { const e = entry(id); e.reloading = true; e.buffer = []; send({ type: 'subscribe', threadId: id }); }
    // the project chosen on Chat home is the new chat's scope, set before its first message (dev's PATCH {scope})
    const scoped = id !== a.threadId && a.scope ? await request('PATCH', T(id), { scope: a.scope }) : { ok: true };
    // dev's route needs a model and its effort on every message: a send that names none (Try again, Follow, the dock)
    // runs on the chat's own, else on dev's default for the chat's engine (GET /api/ask/models)
    let model = a.model, effort = a.effort;
    if (!model) {
      const th = threads.get(id)?.model?.thread?.() || null;
      if (th?.model) { model = th.model; effort = effort || th.effort; }
      else { const cat = await catalog('models'); const d = cat.ok ? (th?.engine && cat.data?.defaults?.[th.engine]) || cat.data?.default : null; model = d?.model || ''; effort = effort || d?.effort || ''; }
    }
    const body = { text: a.text, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(a.mcpOff ? { mcpOff: a.mcpOff } : {}), ...(a.attachments?.length ? { attachments: a.attachments } : {}), ...(a.context ? { context: a.context } : {}) };
    const res = scoped.ok ? await request('POST', `${T(id)}/messages`, body) : scoped;
    if (!res.ok) {
      if (fresh) threads.delete(id);
      if (made || id === spare) { const d = await request('DELETE', T(id)); spare = d.ok ? '' : id; }
      return refuse(SEND_WORDS, res, a.quiet);
    }
    if (id === spare) spare = '';
    const e = entry(id);
    if (fresh) {   // a new chat lands ready with its YouTurn: no loading flash; the frames that came meanwhile follow it
      e.model = createThreadModel({ threadId: id });
      e.model.load({ thread: { id }, messages: [], attachments: [], runLinks: [], inFlight: null });
      e.state = 'ready'; e.reloading = false;
    }
    e.model?.noteLocalUserMessage?.({ id: res.data?.userMessageId, text: a.text, attachments: [] });
    if (fresh) { const q = e.buffer; e.buffer = []; for (const f of q.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0))) e.model.apply(f); }
    notify(id);
    return { ok: true, data: { ...(res.data || {}), threadId: id } };
  }
  // Try again on a failed reply: the failed turn and the words it answered are hidden, and those words are sent once more
  async function retry(a) {
    const e = threads.get(a.threadId); if (!e?.model) return refuse(SEND_WORDS, { ok: false, error: 'this chat is not open' });
    const rows = e.model.messages(), k = rows.findIndex((m) => m.id === a.messageId);
    const asked = k > 0 ? [...rows.slice(0, k)].reverse().find((m) => m.role === 'user') : null;
    if (!asked) return refuse(SEND_WORDS, { ok: false, error: 'there is nothing to send again' });
    const res = await sendMessage({ threadId: a.threadId, text: asked.text });
    if (res.ok) { e.hidden.add(a.messageId); e.hidden.add(asked.id); notify(a.threadId); }
    return res;
  }

  // keyOf (the runner's): the key a control is pending under, its own or the action and the card or chat it acts on.
  /** One Chat action (Step 7): a Promise of `{ok, error?, data?}`. `args.key` names the control while it is pending. */
  async function act(id, args = {}) {
    const key = keyOf(id, args), q = !!args.quiet;
    if (pending.has(key)) return refuse(id === 'send' ? SEND_WORDS : ACTIONS[id]?.[0] || id, { ok: false, error: 'it is already on its way' }, q);
    pending.add(key); notify(args.threadId || '');
    try {
      if (id === 'send') return await sendMessage(args);
      if (id === 'retry') return await retry(args);
      if (id === 'copy') { try { await (clipboard || globalThis.navigator?.clipboard).writeText(str(args.text)); return { ok: true }; } catch (e) { return refuse(COPY_WORDS, { ok: false, error: str(e?.message) || 'the browser said no' }, q); } }
      if (OPENS[id]) {   // a file or a page: dev's GET in a new tab; a blocked tab is the refusal
        const u = OPENS[id][1](args);
        if (!u) return refuse(OPENS[id][0], { ok: false, error: 'it has no web address' }, q);
        const w = openUrl(u);
        return w === null ? refuse(OPENS[id][0], { ok: false, error: 'the browser blocked the new tab' }, q) : { ok: true };
      }
      if (id === 'apply') {   // dev's folder-changes.mjs: read the plan, then apply it (the route reads only memberKey)
        const qs = args.memberKey ? `?memberKey=${enc(args.memberKey)}` : '';
        const plan = await request('GET', `/api/runs/${enc(args.pipelineId)}/apply-plan${qs}`);
        if (!plan.ok) return refuse('apply the files', plan, q);
        const res = await request('POST', `/api/runs/${enc(args.pipelineId)}/apply${qs}`);
        return res.ok ? { ...res, plan: plan.data } : refuse('apply the files', res, q);
      }
      const a = ACTIONS[id];
      if (!a) return refuse(id, { ok: false, error: 'this action is unknown' }, q);
      const [method, url, body] = a[1](args);
      let res = await request(method, url, body);
      // POST /api/runs/bulk answers 200 with its refusals in `skipped`: none done is a refusal
      if (res.ok && Array.isArray(res.data?.skipped) && res.data.skipped.length && !(res.data.done || []).length) res = { ok: false, status: 200, error: str(res.data.skipped[0]?.reason) || 'it was skipped' };
      if (!res.ok) return refuse(a[0], res, q);
      if (args.threadId && threads.get(args.threadId)?.state === 'ready' && url.startsWith(T(args.threadId))) open(args.threadId, { force: true });
      return res;
    } finally { pending.delete(key); notify(args.threadId || ''); }
  }
  /** D12: a run-state action on a chat TaskCard, by its label (FLOW). `a`: {runId, pipelineId, threadId, pr, labels, value}. */
  function flow(label, given = {}) {
    const f = FLOW[label];
    // the run's scope (Create PR, View changes): the store's run by its pipeline id, under what the card gave
    const s = api.runOf?.(given.pipelineId || given.runId) || {};
    const a = { ...(s.projectKey ? { projectKey: s.projectKey } : {}), ...(s.projectDir ? { projectDir: s.projectDir } : {}), ...(s.folder ? { folder: true } : {}), ...given };
    if (!f) return Promise.resolve(refuse(String(label).toLowerCase(), { ok: false, error: 'a chat card does not offer it' }));
    if (f.act) return act(f.act, { ...a, ...(f.args || {}), ...(f.act === 'task-label' ? { labels: [...new Set([...(a.labels || []), str(a.value).toLowerCase()])].filter(Boolean) } : {}) });
    if (f.open) return act(f.open, a);
    if (f.url) { if (!a.pr) return Promise.resolve(refuse(f.words, { ok: false, error: 'the task has no PR' })); return Promise.resolve(openUrl(a.pr) === null ? refuse(f.words, { ok: false, error: 'the browser blocked the new tab' }) : { ok: true }); }
    if (f.copy) { if (!a.pr) return Promise.resolve(refuse(COPY_WORDS, { ok: false, error: 'the task has no PR' })); return act('copy', { text: a.pr, key: `copy:${a.runId}` }); }
    if (f.go) { go(f.go); return Promise.resolve({ ok: true }); }
    return Promise.resolve({ ok: true });
  }

  const api = {
    open, frame, turns, act, prBodyOf, startBodyOf, ref, feature,
    // Settings › Chat › Delete all chats (dev's app.js deleteAskHistory): the counts read fresh right before its confirm
    // (GET /api/ask/history), then dev's DELETE /api/ask/threads. Not an act() id: no card or chat control can reach it.
    chatHistory: async () => { const r = await request('GET', '/api/ask/history'); return r.ok ? r : refuse('read the chat history', r); },
    deleteAllChats: async () => { const r = await request('DELETE', '/api/ask/threads'); return r.ok ? r : refuse('delete the chats', r); },
    plan: (runId) => { const q = askOf(runId); return q && q.kind === 'plan' ? planView(q) : null; },
    planPicks,
    terminal: (sessionId) => term.openSession(sessionId),
    state: (id) => threads.get(id)?.state || '',
    model: (id) => threads.get(id)?.model || null,
    pending: (key) => pending.has(key),
    onChange: (fn) => { fns.add(fn); return () => fns.delete(fn); },
    // a dropped socket came back: the open threads are read again
    reconnect: () => { for (const [id, e] of threads) if (e.state === 'ready' || e.state === 'loading') open(id, { force: true, stale: true }); },
    // D12: the run-state flow's actions on a chat TaskCard (run-state.mjs's `would` carried out); `canFlow` says which
    // labels a chat card offers, so a card never shows one it cannot do
    catalog, progress: (runId) => progressOf(runId) || {},
    ask: (runId) => askOf(runId) || null,   // the run's pending question (a Shaper plan approval is `kind: 'plan'`)
    worktrees: (id) => threads.get(id)?.model?.worktrees?.() || [],   // dev's chat worktrees (snapshot + ask-worktrees)
    thread: (id) => threads.get(id)?.model?.thread?.() || null,
    projectKey: (id) => projectKeyOf(threads.get(id)?.model?.thread?.() || {}),   // the project the chat works in
    flow, canFlow: (label, a = {}) => !!FLOW[label] && (!FLOW[label].needsPr || !!a.pr),
    keyOf,
  };
  return api;
}
// The run-state flow's labels a chat TaskCard reaches (run-state.mjs FLOW for the live cases, live-map.mjs caseOf, plus
// runFlow's and the card's own ⋯), each onto dev's real target (plans/rail/stillhet-wiring.md run-state rows). A label
// that is not here is not offered on a live card.
export const FLOW = Object.freeze({
  Pause: { act: 'task-pause' }, 'Pause now': { act: 'task-pause' },
  Resume: { act: 'task-resume' }, 'Resume now': { act: 'task-resume' },
  'Continue without cap': { act: 'task-resume', args: { ignoreCostCap: true } },
  Stop: { act: 'task-stop' },
  Archive: { act: 'task-archive' },
  'Label…': { act: 'task-label' },
  'Create PR': { act: 'pr' }, 'Create PR again': { act: 'pr' }, 'Create PR instead': { act: 'pr' },
  'Save to plans/': { act: 'plan-save' },
  'Resolve in a terminal': { act: 'task-terminal' },
  'Download patch': { open: 'patch' }, 'View changes': { open: 'diff' },
  'View PR': { url: true, needsPr: true, words: 'open the PR' },
  'Copy PR link': { copy: true, needsPr: true },
  'Open Settings': { go: 'settings/runs' }, 'Open budget settings': { go: 'settings/runs' },
  'Open Team policy': { go: 'settings/team' },
});
