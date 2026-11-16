// ui/public/stillhet/live/chat-live.mjs — the live chat's one owner of thread fetches, subscriptions and Chat actions (D5).
// live-adapter.mjs starts it and hands it the socket's `ask-*` frames; the page reads `window.RailChatLive`. A thread is
// read with dev's `GET /api/ask/threads/:id`, kept in dev's own reducer (src/shared/ask-model.mjs createThreadModel) and
// drawn through chat-turns.mjs. Every action posts dev's route and body (D9, D11): nothing is written before the server
// answers ok, and a refusal toasts once, `Could not ACTION: REASON`, and changes nothing.
import { createThreadModel } from '../../../../src/shared/ask-model.mjs';
import { turnsOf, planView, planPicks, runWithTurn, partsOf } from './chat-turns.mjs';
import { createTerminalLive } from './terminal-live.mjs';
import { projectKeyOf, workspaceIdOf } from './live-map.mjs';
import { perspectivesWith, chipsHiddenFor, DEFAULT_PERSPECTIVES } from '../../../../src/shared/shape/perspectives.mjs';
import { ATTACH_MAX_MESSAGE_BYTES, bytesToBase64 } from '../../../../src/shared/attach-bytes.mjs';

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

/** The TaskProposal's "reviewed by" picker (flag proposedPerspectives): dev's perspectives with Compliance, in list order,
 *  Product locked on, Project fit offered only once picked (dev's chips.mjs chipsHiddenFor). `picked`: keys or nothing. */
export function perspectiveChoices(picked) {
  const all = perspectivesWith({ compliance: true }), keys = all.map((p) => p.key);
  const on = new Set(['product', ...(Array.isArray(picked) && picked.length ? picked : DEFAULT_PERSPECTIVES).filter((k) => keys.includes(k))]);
  const hidden = chipsHiddenFor([...on]);
  return { picked: keys.filter((k) => on.has(k)), items: all.filter((p) => !hidden.includes(p.key)).map((p) => ({ key: p.key, label: p.label, help: p.locked ? 'Always reviews' : p.help, locked: !!p.locked })) };
}

/** POST /api/run's body for a TaskProposal's Start: the proposal card as dev's ask-panel.mjs collectCardBody reads it,
 *  with the person's `picks` (target, project folder, workflow, engine, guardrails, title, branches) over the card's own values.
 *  `picks.perspectives`: the "reviewed by" set (flag proposedPerspectives), sent as dev's run card sends it (`perspectives`).
 *  COV-2: `picks.tags` (the project's saved tags, used when the card has none), `picks.syncPolicy` and `picks.allowUnguardedEngine`. */
export function startBodyOf(card = {}, picks = {}) {
  const c = card || {}, p = picks || {};
  const target = p.target || c.target || 'project';
  const body = { prompt: str(p.brief ?? c.brief), workflowId: str(p.workflowId || c.workflowId), guardrailsId: str(p.guardrailsId || c.guardrailsId), mock: false };
  const title = str(p.title || c.title).trim(); if (title) body.title = title;
  if (c.memoryScope && body.workflowId === 'wf_memory_defrag') body.memoryScope = c.memoryScope;
  if (Array.isArray(c.tags) && c.tags.length) body.tags = c.tags;
  else if (Array.isArray(p.tags) && p.tags.length) body.tags = [...p.tags];   // COV-2: the project's saved tags, when the card names none
  if (p.engine || c.engine) body.engine = p.engine || c.engine;
  // COV-2: a resend after a refusal is the same body plus one key: the base's sync policy, or the engine consent (never for Claude)
  if (p.syncPolicy === 'origin' || p.syncPolicy === 'last-fetch') body.syncPolicy = p.syncPolicy;
  if (p.allowUnguardedEngine === true && (body.engine || 'claude') !== 'claude') body.allowUnguardedEngine = true;
  if (Array.isArray(p.perspectives) && p.perspectives.length) body.perspectives = [...p.perspectives];
  if (Array.isArray(p.extras) && p.extras.length) body.extras = p.extras;   // COV-3 #6: the proposal's files, as classic's run card sends its pills
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
  'card-apply': ['apply the change', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: /^workflow(-build)?$/.test(a.cardType || '') ? 'saved' : 'applied', ...(a.scope ? { scope: a.scope } : {}) }]],   // dev saves a workflow card (thread-cards.mjs), it applies the rest
  'card-later': ['set the proposal aside', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: a.run ? 'dismissed' : 'declined' }]],
  'card-revert': ['undo the change', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: 'reverted' }]],
  'card-verb': ['answer the card', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { ...(a.body || {}) }]],
  'card-offer': ['run the script', (a) => ['POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { choice: a.choice }]],
  'task-pause': ['pause the task', (a) => ['POST', '/api/pause', { runId: a.runId }]],
  'task-resume': ['resume the task', (a) => ['POST', '/api/resume', resumeBody(a.pipelineId || a.runId, { baseAck: a.baseAck, ...(a.ignoreCostCap ? { ignoreCostCap: true } : {}) })]],
  'task-archive': ['archive the task', (a) => ['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: a.pipelineId || a.runId }] }]],
  'chat-label': ['label the chat', (a) => ['PUT', `${T(a.threadId)}/labels`, { labels: a.labels }]],
  'task-label': ['label the task', (a) => ['PUT', `/api/runs/${enc(a.pipelineId || a.runId)}/labels`, { labels: a.labels }]],
  'task-watch-state': ['read the PR watch', (a) => ['GET', `/api/pr/watch?id=${enc(a.pipelineId || a.runId)}`]],
  'task-watch': ['watch the PR', (a) => ['POST', '/api/pr/watch', { watch: !!a.watch, id: a.pipelineId || a.runId }]],
  'task-terminal': ['open a terminal in the worktree', (a) => ['POST', `/api/runs/${enc(a.pipelineId || a.runId)}/resolve-terminal`, {}]],
  // classic's stopRun (app.js): a live run by its runId, with its pipeline id when paused; no live run: its pipeline id
  'task-stop': ['stop the task', (a) => ['POST', '/api/stop', { ...(a.runId ? { runId: a.runId } : {}), ...(a.pipelineId && (a.paused || !a.runId) ? { pipelineId: a.pipelineId } : {}) }]],
  changes: ['send your changes', (a) => ['POST', `${T(a.threadId)}/changes`, { pipelineId: a.pipelineId, text: a.text }]],
  direction: ['send the direction', (a) => ['POST', `${T(a.threadId)}/directions`, { runId: a.runId, text: a.text }]],
  pr: ['create the PR', (a) => ['POST', '/api/pr', prBodyOf(a)]],
  ship: ['create the PR', (a) => ['POST', `/api/shape/features/${enc(a.featureId)}/ship`, { mode: a.mode === 'stacked' ? 'stacked' : 'one' }]],
  'ship-mark': ['mark the requirement', (a) => ['PUT', `/api/shape/features/${enc(a.featureId)}/acceptance`, { entries: [a.entry] }]],
  'file-reveal': ['show it in its folder', (a) => ['POST', `${T(a.threadId)}/attachments/${enc(a.attId)}/reveal`, {}]],   // classic's revealFile posts {}
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
/** F-a2-01: how many messages may wait for a reply (classic ask-panel.mjs QUEUE_MAX). */
export const QUEUE_MAX = 3;
const ENDS = new Set(['ask-done', 'ask-error']);
// Read ids whose answer is a file or a page: opened in a new tab on dev's own GET (D11), never fetched and dropped
export const OPENS = Object.freeze({
  artifact: ['open the file', (a) => `/api/runs/${enc(a.pipelineId)}/artifact-raw/${String(a.name || '').split('/').map(enc).join('/')}${a.download ? '?download=1' : ''}`],
  file: ['open the file', (a) => `${T(a.threadId)}/attachments/${enc(a.attId)}`],
  diff: ['open the changes', patchUrl],
  url: ['open the PR', (a) => (/^https:\/\//.test(str(a.url)) ? a.url : '')],
  patch: ['download the patch', patchUrl],
  // COV-3 #2: a live run's pending question's file, by its index, as classic's askFileUrl addresses it (never by its path)
  'ask-file': ['open the question’s file', (a) => `/api/runs/${enc(a.runId)}/ask-files/${enc(a.askId)}/${enc(a.index)}`],
});
export const COPY_WORDS = 'copy', ATTACH_WORDS = 'attach the file';

/** A new tab on dev's GET. `noopener` would make window.open answer null even when the tab opened, so the opener is cut
 *  by hand and null stays the one sign that the browser blocked it. */
export function openTab(u) {
  const w = globalThis.open?.(u, '_blank') ?? null;
  if (w) { try { w.opener = null; } catch { /* a cross-origin tab already has none */ } }
  return w;
}

/** COV-3 #8: a file saved, not shown: an `<a href download=NAME>` clicked, as classic's FilesCard Download is. false when
 *  there is no page to click it in. */
export function saveLink(url, name) {
  const d = globalThis.document;
  if (!d?.createElement || !d.body) return false;
  const a = d.createElement('a');
  a.href = url; a.download = str(name); a.rel = 'noopener';
  d.body.appendChild(a); a.click(); a.remove();
  return true;
}

/** Every POST /api/resume body Chat and Tasks send, as classic's resumeBody (app.js): dev checks the base first (baseCheck),
 *  and the resend after "Resume anyway" acknowledges the move (baseAck). `extra`: the resume's own keys (ignoreCostCap,
 *  costCapUsd, model, engine). F-G-G2-03. */
export const resumeBody = (pipelineId, { baseAck = false, ...extra } = {}) => ({ pipelineId, baseCheck: true, ...(baseAck ? { baseAck: true } : {}), ...extra });

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
export function startChatLive({ fetch, send = () => {}, afterPr = () => {}, toast = () => {}, now = Date.now, tasksOf = () => [], clipboard = null, open: openUrl = openTab, go = () => {}, progressOf = () => ({}), askOf = () => null, save = saveLink } = {}) {
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
        if (e.model && e.state === 'ready' && !gone) { const q = e.buffer; e.buffer = []; const end = applyAll(e, q); notify(id); settle(id, end || 'load'); return; }
        e.state = gone ? 'gone' : 'failed'; e.buffer = []; notify(id); return;
      }
      e.model = createThreadModel({ threadId: id });
      e.model.load(snap);
      // frames that came while the thread was read: applied once, in seq order (the reducer drops what the GET already had)
      const q = e.buffer.map((f, i) => [f, i]).sort((a, b) => ((a[0].seq ?? 0) - (b[0].seq ?? 0)) || a[1] - b[1]).map(([f]) => f);
      e.buffer = [];
      e.state = 'ready';
      const end = applyAll(e, q);
      notify(id);
      checkRunWith(id);
      settle(id, end || 'load');
    })();
    e.loading = p;
    return p;
  }
  // frames applied in order; the last turn end among them that the model took (the queue settles on it)
  function applyAll(e, q) {
    let end = null;
    for (const f of q) { const r = e.model.apply(f); if (!r?.dropped && !r?.gap && ENDS.has(f?.type)) end = f; }
    return end;
  }
  /** A socket frame (live-adapter.mjs passes every `ask-*` one). A frame for an open thread is reduced; one that comes
   *  while the thread is read waits for it; a seq gap reads the thread again. */
  function frame(f) {
    if (typeof f?.type === 'string' && f.type.startsWith('term-')) { term.frame(f); return; }
    const id = str(f?.threadId), e = id && threads.get(id);
    if (f?.type === 'ask-command' && str(f.command?.blockId)) { cmds.set(f.command.blockId, f.command); if (e) notify(id); }
    if (!e) return;
    if (e.state === 'loading' || e.reloading) { e.buffer.push(f); return; }
    if (e.state !== 'ready' || !e.model) return;
    const r = e.model.apply(f);
    if (r?.gap) { open(id, { force: true }); return; }
    if (!r?.dropped) { notify(id); checkRunWith(id); if (ENDS.has(f.type)) settle(id, f); }
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
  // D12 (b): a command's end lives on dev's terminal block, not its card: read once (GET …/commands/:blockId), then kept
  // by its ask-command frames; unknown until read, so it draws as dev stored it
  const cmds = new Map();
  function commandOf(threadId, blockId) {
    if (!blockId) return null;
    if (!cmds.has(blockId)) {
      cmds.set(blockId, null);
      // dev answers the block's view itself (src/core/ask/commands.mjs commandView; its `command` is the command line);
      // a refused read is not kept, so the next paint asks again
      request('GET', `${T(threadId)}/commands/${enc(blockId)}`).then((r) => {
        const v = r.ok && r.data && typeof r.data === 'object' ? r.data : r.status === 404 ? { status: 'gone', exitCode: null } /* no block: its shell is gone, so it is not running */ : null;
        if (!v) { if (cmds.get(blockId) === null) cmds.delete(blockId); return; }
        if (!cmds.get(blockId)) { cmds.set(blockId, v); notify(threadId); }
      });
    }
    return cmds.get(blockId);
  }
  function turns(id) {
    const e = threads.get(id);
    if (!e || e.state !== 'ready') return [];
    const rw = e.runWith, messages = e.model.messages().filter((m) => !e.hidden.has(m.id));
    const out = turnsOf({ messages, runLinks: linksOf(e.model), inFlight: e.model.inFlight() }, { tasks: tasksOf(id), now: now(), commandOf: (b) => commandOf(id, b) });
    if (!rw) return out;
    // D5: while Run with waits, its workflow card stays the one Run with card (saved meanwhile) and the run proposal the
    // event turn made is folded into it, so the chat shows one card and it is started once
    const folded = new Set(proposalsFor(e, rw).map((b) => b.id)), wb = cardsOf(e).find((b) => b.id === rw.cardId);
    return out.filter((x) => !(x.t === 'proposal' && folded.has(x.id))).map((x) => (wb && x.id === rw.cardId && x.t === 'change' ? runWithTurn(wb, 'proposed') : x));
  }

  // Run with (D4, D5): a one-stage workflow Worca proposed only to run a task. Dev saves the card and its event turn
  // proposes the run (thread-cards.mjs, prompt rule 12); that proposal is started linked, once, and never drawn twice.
  // The event turn is the save reply's own message (`turn.assistantMessageId`), else, for a turn dev queued behind the one
  // running (`turn.deferred`), the first assistant message that was not in the chat when the save went out.
  const cardsOf = (e) => (e?.model ? e.model.messages().flatMap((m) => arr(m.blocks)).filter((b) => b && b.kind === 'card') : []);
  function eventMsg(e, rw) {
    const ms = e?.model ? e.model.messages() : [];
    if (!rw.msgId) rw.msgId = str(ms.find((m) => m.role === 'assistant' && !rw.before.has(m.id))?.id);
    return rw.msgId ? ms.find((m) => m.id === rw.msgId) || null : null;
  }
  const proposalsFor = (e, rw) => arr(eventMsg(e, rw)?.blocks).filter((b) => b && b.kind === 'card' && b.state === 'proposed' && !b.card?.type && b.card?.workflowId === rw.workflowId);
  // started for the person only when it runs what they saw on the Run with card: the card's own target, and nothing the
  // model chose on top (its guardrails, engine, source or branches); otherwise it stays an ordinary proposal with Start
  const asSaved = (c, rw) => str(c.projectKey) === rw.projectKey && str(c.workspaceId) === rw.workspaceId && (rw.projectKey || rw.workspaceId)
    && (!c.guardrailsId || c.guardrailsId === 'normal') && !c.engine && !c.source && !c.featureBranch && !c.sourceBranch && !c.sameAsSource
    && !(c.sourceBranchByKey && Object.keys(c.sourceBranchByKey).length);
  const RUN_WORDS = 'start the task';
  async function runWith(a, q) {
    const e = threads.get(a.threadId);
    const wc = cardsOf(e).find((b) => b.id === a.cardId)?.card || {};
    const name = str(wc.name) || 'A workflow';
    // what the chat held before the save: a later assistant message is the deferred event turn
    const before = new Set((e?.model ? e.model.messages() : []).map((m) => m.id));
    const was = e?.model?.inFlight()?.messageId; if (was) before.add(was);
    const res = await request('POST', `${T(a.threadId)}/cards/${enc(a.cardId)}`, { state: 'saved' });
    if (!res.ok) return refuse('save the workflow', res, q);
    const workflowId = str(res.data?.block?.workflowId);
    if (!workflowId) return refuse('save the workflow', { ok: false, error: 'the workflow was not saved' }, q);
    const turn = res.data?.turn;
    if (!turn || turn.error || (!str(turn.assistantMessageId) && turn.deferred !== true)) {   // the save stands: the card reads its saved row
      open(a.threadId, { force: true });
      return refuse(RUN_WORDS, { ok: false, error: `Worca saved ${name} but could not propose its task${turn?.error ? `: ${str(turn.error)}` : ''}` }, q);
    }
    if (e) e.runWith = { cardId: a.cardId, workflowId, name, projectKey: str(wc.projectKey), workspaceId: str(wc.workspaceId), msgId: str(turn.assistantMessageId), before, startedCardId: '' };
    return { ok: true, data: { waiting: true, workflowId } };
  }
  function checkRunWith(id) {
    const e = threads.get(id), rw = e?.runWith;
    if (!rw || rw.startedCardId || e.state !== 'ready' || !e.model) return;
    const m = eventMsg(e, rw);
    if (!m) return;   // the event turn has not begun
    const match = proposalsFor(e, rw)[0];
    if (match && !asSaved(match.card, rw)) { e.runWith = null; notify(id); return; }
    if (match) {
      rw.startedCardId = match.id;
      act('start', { threadId: id, cardId: match.id, card: match.card, picks: {} }).then(async (r) => {
        if (r.ok) await open(id, { force: true });   // the proposal reads started before the wait lets it show
        if (e.runWith === rw) { e.runWith = null; notify(id); }
      });
      return;
    }
    if (e.model.inFlight()?.messageId === m.id) return;   // the event turn still runs
    e.runWith = null; notify(id);
    refuse(RUN_WORDS, { ok: false, error: `Worca saved ${rw.name} but did not propose its task` });
  }

  // F-a2-01 (D1): what the composer sent while a reply runs, per chat, kept here so no redraw or second mount loses it.
  // An item leaves only after its POST answers ok; at most one queue POST is out per chat (`draining`); a paused queue
  // sends nothing until Send now; nothing is sent in a chat no mount shows.
  const queues = new Map(), viewers = new Map();
  let qSeq = 0;
  const qOf = (id) => { if (!queues.has(id)) queues.set(id, { items: [], paused: '', why: '', draining: false, ended: null, recheck: false }); return queues.get(id); };   // recheck: true after a send's 409, 'drain' after a drained item's
  const isBusy = (id) => !!threads.get(id)?.model?.inFlight?.() || !!queues.get(id)?.draining;
  const viewed = (id) => [...viewers.values()].some((v) => v.id === id && v.shown());   // a mount on a page that is left, or a closed side panel, shows nothing
  const IN_FLIGHT = (res) => res.status === 409 && res.error === 'turn in flight';
  function enqueue(id, a) {
    const q = qOf(id);
    // the composer's own words for a full queue (form.composer-queue), not the generic `Could not …` refusal (F-gb235-01)
    if (q.items.length >= QUEUE_MAX) { const error = `${QUEUE_MAX} messages wait for this reply`; if (!a.quiet) toast(`Queue full: ${error}`); return { ok: false, code: 'QUEUE_FULL', error }; }
    q.items.push({ key: `q${++qSeq}`, text: a.text, attachments: a.attachments, model: a.model, effort: a.effort, context: a.context });
    notify(id);
    return { ok: true, queued: true, data: { threadId: id, position: q.items.length } };
  }
  // a turn ended (`f`: its ask-done or ask-error) or the thread was read again ('load'): send the next, pause, or wait
  function settle(id, f) {
    const q = queues.get(id);
    if (!q || !q.items.length) return;
    if (q.draining) { if (f !== 'load') q.ended = f; return; }
    if (f === 'load') {
      if (isBusy(id)) return;
      if (q.recheck === 'drain') { q.recheck = false; q.paused = 'refused'; q.why = 'turn in flight'; notify(id); return; }   // dev refused a drained item yet runs no turn: Send now, never a loop
      if (!q.recheck) {   // the end was missed (classic loadThread): a stop or a failure pauses with its reason; a clean end in a chat on screen sends the next
        const last = [...(threads.get(id)?.model?.messages?.() || [])].reverse().find((m) => m.role === 'assistant');
        if (!q.paused) q.paused = last?.status === 'error' ? 'failed' : last?.status === 'stopped' ? 'stopped' : viewed(id) ? '' : 'away';
        if (!q.paused) drain(id);
        notify(id); return;
      }
    }
    q.recheck = false;
    if (f !== 'load' && f.type === 'ask-error') q.paused = 'failed';
    else if (f !== 'load' && f.status && f.status !== 'done') q.paused = 'stopped';
    else if (!q.paused) { if (!viewed(id)) q.paused = 'away'; else drain(id); }
    notify(id);
  }
  // the oldest item, posted once; never through act(), so the composer's pending send key does not block it
  async function drain(id) {
    const q = queues.get(id);
    if (!q || q.draining || q.paused || !q.items.length || threads.get(id)?.model?.inFlight?.()) return { ok: true };
    const it = q.items[0];
    q.draining = true; notify(id);
    const res = await sendMessage({ threadId: id, text: it.text, attachments: it.attachments, model: it.model, effort: it.effort, context: it.context, quiet: true });
    q.draining = false;
    const ended = q.ended; q.ended = null;
    if (res.ok) {
      q.items = q.items.filter((x) => x.key !== it.key);
      if (ended) settle(id, ended);
    } else if (IN_FLIGHT(res)) { q.recheck = 'drain'; open(id, { force: true }); }   // kept first, unpaused: the next end sends it
    else { q.paused = 'refused'; q.why = res.error; }
    notify(id);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  // D10: a send on Chat home makes the thread first; a refused message deletes it again, and a failed delete keeps it
  async function sendMessage(a) {
    const queueing = a.queue === true && !!a.threadId;
    if (queueing && isBusy(a.threadId)) return enqueue(a.threadId, a);   // F-a2-01: while a reply runs, it waits
    let id = a.threadId, made = '', created = null;
    if (!id) {
      if (spare) id = spare;
      else {
        const c = await request('POST', '/api/ask/threads', {});
        if (!c.ok) return refuse(SEND_WORDS, c, a.quiet);
        id = made = str(c.data?.thread?.id);
        created = c.data?.thread;
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
    // F-a2-01 (D7): dev's turn runs and we had not seen it: the message waits, and the thread is read to learn the turn
    if (!res.ok && queueing && IN_FLIGHT(res) && threads.get(id)?.state === 'ready') {
      const r = enqueue(id, a);
      if (r.ok) { qOf(id).recheck = true; open(id, { force: true }); }
      return r;
    }
    if (!res.ok) {
      if (fresh) threads.delete(id);
      if (made || id === spare) { const d = await request('DELETE', T(id)); spare = d.ok ? '' : id; }
      return refuse(SEND_WORDS, res, a.quiet);
    }
    if (id === spare) spare = '';
    const e = entry(id);
    if (fresh) {   // a new chat lands ready with its YouTurn: no loading flash; the frames that came meanwhile follow it
      e.model = createThreadModel({ threadId: id });
      // D9: the thread dev answered (its PATCH {scope}, else its create), so the chat's project is known with no GET
      const th = [scoped.data?.thread, created].find((x) => x && typeof x === 'object' && x.id === id) || { id };
      // F-a1-01: the new chat starts on the model and effort its first message went out with, not dev's null
      e.model.load({ thread: { ...th, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }, messages: [], attachments: [], runLinks: [], inFlight: null });
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

  // COV-3 #6: the files a TaskProposal's Start carries, read as classic's collectCardExtras reads them: over the message cap,
  // or any read that fails, and nothing is posted
  async function extrasOf(threadId, files) {
    const max = ATTACH_MAX_MESSAGE_BYTES;
    if (files.reduce((n, f) => n + (Number(f.bytes) || 0), 0) > max) return { error: `attachments exceed ${max / (1024 * 1024)} MB: remove one` };
    const extras = [];
    for (const f of files) {
      let res = null, buf = null;
      try { res = await fetch(`${T(threadId)}/attachments/${enc(f.att)}`); } catch { res = null; }
      if (!res || !res.ok || typeof res.arrayBuffer !== 'function') return { error: `could not read attachment ${str(f.name)}` };
      try { buf = await res.arrayBuffer(); } catch { return { error: `could not read attachment ${str(f.name)}` }; }
      extras.push({ name: str(f.name), dataBase64: bytesToBase64(new Uint8Array(buf)) });
    }
    return { extras };
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
      if (id === 'start' && arr(args.files).length) {   // the files are read first: Start posts all of them or nothing
        const x = await extrasOf(args.threadId, arr(args.files).slice());
        if (x.error) return refuse(ACTIONS.start[0], { ok: false, error: x.error }, q);
        args = { ...args, picks: { ...(args.picks || {}), extras: x.extras } };
      }
      if (id === 'run-with') {   // the save; the start waits for the event turn's proposal (checkRunWith)
        const res = await runWith(args, q);
        if (res.ok) open(args.threadId, { force: true });
        return res;
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
      // F-G-G2-03: a card's resume on a moved base is a prompt, not a refusal: the card asks Resume anyway, which resends with baseAck
      if (!res.ok && id === 'task-resume' && /^base-(moved|missing)$/.test(str(res.code))) return { ...res, prompt: 'base' };
      if (!res.ok) return refuse(a[0], res, q);
      if (id === 'pr') afterPr();   // a PR now exists: the task's card reads it without a reload (dev's history skeleton has no PRs)
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

  let revealAsk = null;
  const api = {
    open, frame, turns, act, prBodyOf, startBodyOf, perspectiveChoices, ref, feature,
    partsOf,   // panel.answer-refs: words and refs of a text, for Prose's chips (conversation.js is a classic script)
    // Settings › Chat › Delete all chats (dev's app.js deleteAskHistory): the counts read fresh right before its confirm
    // (GET /api/ask/history), then dev's DELETE /api/ask/threads. Not an act() id: no card or chat control can reach it.
    chatHistory: async () => { const r = await request('GET', '/api/ask/history'); return r.ok ? r : refuse('read the chat history', r); },
    deleteAllChats: async () => { const r = await request('DELETE', '/api/ask/threads'); return r.ok ? r : refuse('delete the chats', r); },
    /** COV-3 #8: a FilesCard's Download, saved under its name (not a tab, which shows only pictures, PDFs and text). */
    download: ({ threadId, attId, name } = {}) => Promise.resolve(save(OPENS.file[1]({ threadId, attId }), name) ? { ok: true } : refuse(`download ${str(name) || 'the file'}`, { ok: false, error: 'the browser blocked the download' })),
    /** COV-3 #9: whether this server can show a file in its folder ({label}: Finder, Explorer…), asked once (GET /api/ask/reveal). */
    revealInfo: () => (revealAsk ??= request('GET', '/api/ask/reveal').then((r) => (r.ok && r.data?.available && str(r.data.label) ? { label: r.data.label } : null))),
    plan: (runId) => { const q = askOf(runId); return q && q.kind === 'plan' ? planView(q) : null; },
    planPicks,
    terminal: (sessionId) => term.openSession(sessionId),
    state: (id) => threads.get(id)?.state || '',
    model: (id) => threads.get(id)?.model || null,
    runWith: (id) => { const rw = threads.get(id)?.runWith; return rw ? { cardId: rw.cardId, workflowId: rw.workflowId } : null; },
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
    workspaceId: (id) => workspaceIdOf(threads.get(id)?.model?.thread?.() || {}),   // else the workspace it works in (F-G-G4-03)
    flow, canFlow: (label, a = {}) => !!FLOW[label] && (!FLOW[label].needsPr || !!a.pr),
    keyOf,
    // F-a2-01: the composer's queue (a copy), Remove, Send now, and which chat each mount shows
    queue: (id) => { const q = queues.get(id); return { items: (q?.items || []).map((x) => ({ key: x.key, text: x.text })), max: QUEUE_MAX, paused: q?.paused || '', why: q?.why || '', draining: !!q?.draining }; },
    dropQueued: (id, key) => {
      const q = queues.get(id), k = q ? q.items.findIndex((x) => x.key === key) : -1;
      if (k < 0) return false;
      if (k === 0 && q.draining) return 'sending';   // its POST is out: it can no longer be taken back
      q.items.splice(k, 1);
      if (!q.items.length) { q.paused = ''; q.why = ''; }
      notify(id);
      return true;
    },
    sendQueued: (id) => {
      const q = queues.get(id);
      if (!q) return Promise.resolve({ ok: true });
      q.paused = ''; q.why = ''; notify(id);
      return isBusy(id) ? Promise.resolve({ ok: true }) : drain(id);   // busy: the next clean end sends it
    },
    look: (viewer, id, shown = () => true) => { if (id) viewers.set(viewer, { id, shown }); else viewers.delete(viewer); },
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
