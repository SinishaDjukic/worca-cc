// ui/public/stillhet/live/chat-turns.mjs — dev's thread into the prototype's turns (D1, Step 4's table): the messages and
// blocks of `GET /api/ask/threads/:id` (as src/shared/ask-model.mjs holds them) become the `t` kinds chat/conversation.js
// draws. Pure: no DOM, no fetch, no clock (`now` is passed in). Words come from dev's cards; a field the data cannot fill
// is left out, never invented. A card type this table does not know is a notice naming it.
import { runProgress } from '../../../../src/shared/run-progress.mjs';
import { routeLabel } from '../../../../src/shared/shape/route.mjs';
import { refsInText, refFromHref } from '../../../../src/shared/chip-refs.mjs';
import { roleSummaries, countsText, currentPass } from '../../../../src/shared/shape/role-review.mjs';
import { perspectiveByKey } from '../../../../src/shared/shape/perspectives.mjs';
import { fixAllFeedback, displayCoverage } from '../../../../src/shared/shape/plan-fix.mjs';

const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// an answer is text: escaped, its line breaks kept (dev's markdown renderer is a dev screen; Stillhet draws plain words)
const wordsHtml = (t) => esc(t).replace(/\r\n?|\n/g, '<br>');
// panel.answer-refs: the runs, chats and PRs dev's answer chips find in the words (src/shared/chip-refs.mjs): dev's text
// refs, and a link written out (Stillhet draws plain words, so a PR's URL is text). `parts` are words and refs in order.
const URL_RE = /https:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/g;
export function partsOf(text) {
  const found = [...refsInText(text)];
  for (const m of String(text).matchAll(URL_RE)) { const ref = refFromHref(m[0]); if (ref) found.push({ start: m.index, end: m.index + m[0].length, ref }); }
  found.sort((a, b) => a.start - b.start);
  const parts = []; let at = 0;
  for (const f of found) {
    if (f.start < at) continue;   // a ref inside a link already taken
    if (f.start > at) parts.push({ text: text.slice(at, f.start) });
    parts.push({ text: text.slice(f.start, f.end), ref: { kind: f.ref.kind, key: f.ref.key, id: str(f.ref.id), url: str(f.ref.url), label: str(f.ref.label) } });
    at = f.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts.some((x) => x.ref) ? parts : null;
}
const kb = (n) => (typeof n === 'number' && n >= 0 ? (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`) : '');
const STATE = { proposed: 'proposed', building: 'proposed', applied: 'applied', saved: 'applied', answered: 'applied', cloning: 'proposed', declined: 'declined', failed: 'declined', reverted: 'declined', dismissed: 'declined' };
const stateOf = (s) => STATE[s] || 'proposed';

// what a proposal changes: dev's own rows (`changes` / `rows`, label or field, before, after)
const own = (card) => arr(card.changes).concat(arr(card.rows)).map((r) => ({ name: str(r.label) || str(r.field), before: str(r.before ?? ''), after: str(r.after ?? '') })).filter((r) => r.name);
// D12 (a): a proposal dev sends with no rows of its own shows its own fields as rows, so no card is a bare title
const row = (name, after, before = '') => ({ name, before: str(before), after: str(after) });
const whenOf = (v) => (v && typeof v === 'object' ? [str(v.sentence), str(v.when)].filter(Boolean).join(' · ') : str(v));
const setWords = (o) => (o && typeof o === 'object' ? Object.entries(o).map(([k, v]) => row(k, typeof v === 'string' ? v : JSON.stringify(v))) : []);
const TYPE_ROWS = {
  'scope-switch': (c) => arr(c.candidates).map((x) => row(str(x?.name) || str(x?.projectKey), str(x?.displayPath) || str(x?.path))),
  schedule: (c) => [row('When', whenOf(c.after), whenOf(c.before))],
  away: (c) => [row('Away', str(c.after) || whenOf(c.set), str(c.before))],
  proxy: (c) => setWords(c.patch),
  web: (c) => [row('Host', str(c.host) || str(c.change?.host))],
  clone: (c) => [row('From', c.url), row('Branch', c.branch), row('Into', c.dir)],
  project: (c) => [row('Name', c.name), row('Folder', str(c.displayPath) || str(c.path))],
  workspace: (c) => [row('Members', arr(c.members).map((m) => (typeof m === 'string' ? m : str(m?.name) || str(m?.projectKey))).filter(Boolean).join(', ') || arr(c.added).join(', '))],
  // a workflow names its steps: its agents in the order they run (dev's manifest), or the nodes built in Chat
  workflow: (c) => [row('Steps', arr(c.manifest?.steps).flatMap((x) => arr(x?.nodes)).filter((n) => n && n.key).map((n) => str(n.label) || str(n.key)).join(', '))],
  'workflow-build': (c) => [row('Steps', arr(c.workflow?.nodes).map((n) => str(n?.label) || str(n?.key) || str(n?.id)).filter(Boolean).join(', '))],
  metrics: (c) => [row('Change', c.kind), row('Where', str(c.projectName) || str(c.workspaceName))],
  policy: (c) => [row('Change', c.kind), row('Where', str(c.projectName) || str(c.workspaceName))],
};
const rowsOf = (card) => { const l = own(card); return l.length ? l : (TYPE_ROWS[card.type]?.(card) || []).filter((r) => r.name && (r.after || r.before)); };
// The change kinds, in the prototype's words (chat/chats-model.js demo kinds)
const KIND = { 'scope-switch': 'Project', model: 'Model', schedule: 'Schedule', away: 'Away', proxy: 'Settings', web: 'Web access', clone: 'Project', project: 'Project', workspace: 'Workspace', actions: 'Settings', metrics: 'Settings', policy: 'Settings', workflow: 'Workflow', 'workflow-build': 'Workflow', receipt: 'Settings' };
const change = (b, ctx, o = {}) => ({ t: 'change', id: str(b.id), kind: KIND[b.card.type] || 'Settings', title: str(b.card.summary) || str(b.card.label) || str(b.card.name) || str(b.card.title) || KIND[b.card.type] || 'A change', why: str(b.card.note), rows: rowsOf(b.card), state: stateOf(b.state), card: str(b.id), cardType: str(b.card.type), ...o });
// a turn row with its verbs; `ids` are RailChatLive.act ids, one per action (conversation.js data-act)
// `bodies`: per action, what that action posts beyond the card's ids (a verb card's `{verb}`, dev's route-card choice)
const act = (b, text, actions, o = {}) => ({ t: 'act', id: str(b.id), mark: 'git', text, actions: actions.map((a) => [a[0], a[1], a[2]]), ids: actions.map((a) => a[3]), bodies: actions.map((a) => a[4] || null), card: str(b.id), cardType: str(b.card.type), args: { pipelineId: str(b.card.pipelineId), title: str(b.card.title), runId: str(b.card.runId) }, ...(stateOf(b.state) === 'proposed' ? {} : { done: b.state === 'applied' ? 'Done' : 'Not now' }), ...o });
// the run a card started or follows: through its link (D7) or the card's own ids
const runOf = (b, ctx) => {
  const link = arr(ctx.runLinks).find((l) => l && l.cardId === b.id);
  return str(link?.runId) || str(b.card.runId) || str(link?.pipelineId) || str(b.card.pipelineId);
};
const taskTurn = (b, ctx) => {
  // the store keeps a live run by its run id and an ended one by its pipeline id: either names the card's task; a resumed
  // run has a new run id, so the chat task's pipeline id (`pid`) names it too
  const link = arr(ctx.runLinks).find((l) => l && l.cardId === b.id), ids = [runOf(b, ctx), str(link?.runId), str(link?.pipelineId), str(b.card.pipelineId)].filter(Boolean);
  const run = ids[0] || '', t = arr(ctx.tasks).find((x) => x && ids.some((id) => x.run === id || x.id === id || x.pid === id));
  return { t: 'task', id: str(b.id), task: str(t?.id) || run };
};

/** Each dev card type's turn (Step 4's table). The keys are exactly src/shared/ask-card-types.mjs ASK_CARD_TYPES. */
export const CARD_TURN = Object.freeze({
  question: (b) => {
    const c = b.card, opts = arr(c.options), labels = opts.map((o) => str(o.label) || str(o.id));
    const picked = opts.findIndex((o) => o.id === c.choice);
    return { t: 'question', id: str(b.id), text: str(c.question), options: labels, optionIds: opts.map((o) => str(o.id)), ...(c.answer === 'text' ? { own: true } : {}), card: str(b.id),
      ...(b.state === 'answered' ? { answered: picked >= 0 ? labels[picked] : str(c.answerText) || str(c.text) || 'Answered' } : {}) };
  },
  progress: taskTurn,
  workflow: (b, ctx) => change(b, ctx, { graph: true }),
  'workflow-build': (b, ctx) => change(b, ctx, { graph: true }),
  // the words are dev's own cards' (ui/public/chat/action-cards.mjs, ui/public/shape/changes-card.mjs, route-card.mjs)
  'run-stop': (b) => act(b, `<b>Stop ${esc(str(b.card.title) || 'the task')}?</b> A stopped run can't be resumed. Its work so far stays on its branch.`, [['Stop run', 'danger', 'Stopped', 'card-apply'], [b.card.status === 'paused' ? 'Keep paused' : 'Keep running', 'quiet', 'Not now', 'card-later']]),
  // D4: an opened PR shows on its run's TaskCard alone (Ready to merge, its checks, Merge PR); with no TaskCard in the
  // thread it is one row naming its number, never the URL (one fact, one place)
  'pull-request': (b, ctx) => {
    const url = str(b.card.result?.url);
    if (url || b.state === 'applied') {
      const ids = [str(b.card.runId), str(b.card.pipelineId)].filter(Boolean);
      if (arr(ctx.tasks).some((x) => x && ids.some((id) => x.run === id || x.id === id || x.pid === id))) return null;
      const n = (/\/(?:pull|pullrequest|pull-requests)\/(\d+)/.exec(url) || [])[1];
      return act(b, `<b>${esc(str(b.card.title))}</b>`, [['Create PR', 'primary', 'PR opened', 'pr'], ['Not now', 'quiet', 'Not now', 'card-later']], { done: n ? `PR opened #${n}` : 'PR opened' });
    }
    return act(b, `<b>${esc(str(b.card.title))}</b>${b.card.branch ? ` ${esc(b.card.branch)}` : ''}`, [['Create PR', 'primary', 'PR opened', 'pr'], ['Not now', 'quiet', 'Not now', 'card-later']]);
  },
  // panel.ship-card: a feature's ship (dev's ship-card.mjs): its agreed requirements with their marks, one PR or stacked,
  // Create PR (POST /api/shape/features/:id/ship) and Not now (dev's `{verb: 'not-now'}`)
  ship: (b) => {
    const c = b.card, a = c.acceptance && arr(c.acceptance.agreed).length ? c.acceptance : null, marks = new Map(arr(a?.entries).map((e) => [e?.id, e]));
    const WORD = { met: 'Met', 'not-met': 'Not met', dropped: 'Dropped' };
    const reqs = a ? a.agreed.map((r) => { const e = marks.get(r.id), mark = WORD[e?.mark] ? e.mark : '', why = str(e?.target) || str(e?.reason); return { id: str(r.id), text: [str(r.id), str(r.text)].filter(Boolean).join(' · '), mark, v: mark ? `${WORD[mark]}${why ? `: ${why}` : ''}` : 'Mark it' }; }) : [];
    const n = Number(c.files) || 0, st = stateOf(b.state);
    return { t: 'ship', id: str(b.id), card: str(b.id), cardType: 'ship', featureId: str(c.featureId), title: str(c.title) || 'Ship the feature', files: n, how: c.suggested === 'stacked' ? 'as stacked PRs' : 'as one PR', reqs, state: st,
      ...(st === 'proposed' ? {} : { done: c.result?.prUrl ? `Shipped: ${str(c.result.prUrl)}` : b.state === 'applied' ? 'Shipped' : 'Not shipped yet' }) };
  },
  changes: (b) => { const l = b.card.landing || {}; return act(b, `<b>${esc(str(l.title) || 'Changes')}</b> ${esc(str(b.card.text))}`, [[str(l.start) || 'Start', 'primary', 'Started', 'card-verb', { verb: 'start' }], ['Not now', 'quiet', 'Not now', 'card-verb', { verb: 'not-now' }]]); },
  route: (b) => { const g = b.card.guess || {}, choice = ['add', 'own', 'save'].includes(g.choice) ? g.choice : 'own', ft = str(b.card.featureTitle);
    return act(b, `<b>Where does this go?</b> ${esc(str(b.card.text))}`, [[routeLabel(choice, ft), 'primary', 'Done', 'card-verb', choice === 'add' ? { verb: 'add', where: g.where === 'extra' || !b.card.hasNext ? 'extra' : 'next' } : { verb: choice }], ...['add', 'own', 'save'].filter((c) => c !== choice).map((c) => [routeLabel(c, ft), 'quiet', 'Done', 'card-verb', c === 'add' ? { verb: 'add', where: b.card.hasNext ? 'next' : 'extra' } : { verb: c }]), ['Not now', 'quiet', 'Not now', 'card-verb', { verb: 'not-now' }]]); },
  'scope-switch': (b, ctx) => change(b, ctx, { title: str(b.card.summary) || str(b.card.reason) || 'Switch the project' }),
  model: change, schedule: change, away: change, proxy: change, web: change, clone: change, project: change, workspace: change,
  actions: change, mcp: change, metrics: change, policy: change,
  receipt: (b, ctx) => change(b, ctx, { state: b.state === 'reverted' ? 'declined' : 'applied', revert: !!b.card.revertible && b.state !== 'reverted', rows: [{ name: str(b.card.label) || 'Setting', before: str(b.card.before ?? ''), after: str(b.card.after ?? '') }] }),
  'script-approval': (b) => act(b, `<b>${b.card.kind === 'run' ? 'Run' : 'Save'} ${esc(str(b.card.displayName) || 'the script')}?</b> ${esc(str(b.card.summary))}`, [[b.card.kind === 'run' ? 'Run it' : 'Save it', 'primary', 'Done', 'card-apply'], ['Not now', 'quiet', 'Not now', 'card-later']]),
  // D12 (b): dev keeps a command's end on its terminal block, not the card (GET …/commands/:blockId, ask-command frames):
  // `ctx.commandOf(blockId)` answers that view; ended, the command is done and offers no Stop
  command: (b, ctx) => {
    const v = typeof ctx.commandOf === 'function' ? ctx.commandOf(str(b.card.blockId)) : null;
    const exit = typeof b.card.exitCode === 'number' ? b.card.exitCode : typeof v?.exitCode === 'number' ? v.exitCode : null;
    const ended = exit != null || (!!v && !!str(v.status) && v.status !== 'running');
    return { t: 'cmd', id: str(b.id), cmd: str(b.card.command), sum: str(b.card.summary), dir: str(b.card.folder), block: str(b.card.blockId), session: str(b.card.sessionId),
      ...(ended ? { done: true, end: exit ? `exit ${exit}` : '', ...(exit ? { failed: true } : {}), ...(str(v?.tail) ? { out: str(v.tail) } : {}) } : {}) };
  },
  files: (b) => ({ t: 'filesgrid', id: str(b.id), label: str(b.card.title) || 'Files', files: arr(b.card.items).map((i) => ({ name: str(i.name), ...(i.kind === 'image' ? { image: true } : { meta: kb(i.bytes) }), att: str(i.attId) })) }),
});

/** A card block's turn. A card with no `type` is a run proposal (validateProposal): proposed, it is a TaskProposal; started,
 *  the TaskCard of the run it started; dismissed, a quiet note. */
export function cardTurn(b, ctx = {}) {
  const c = b?.card || {};
  if (!c.type) {
    if (b.state === 'started') return taskTurn(b, ctx);
    if (b.state === 'dismissed') return { t: 'notice', text: `Not started: ${str(c.title) || 'the task'}` };
    return { t: 'proposal', id: str(b.id), title: str(c.title) || 'A task', brief: str(c.brief), why: str(c.note), workflow: str(c.workflowName) || 'Default', project: str(c.projectName) || str(c.workspaceName) || 'No project', card: str(b.id), raw: c };
  }
  const f = CARD_TURN[c.type];
  // fail.no-raw: a card type this table does not know reads as its own title; its type id stays out of the words
  return f ? f(b, ctx) : { t: 'notice', text: str(c.title) || str(c.summary) || str(c.label) || 'Worca has something to show you here' };
}

/** One block's turn, or null for a block the person never sees (`where`, `chat-context`, an attachment row). Tool and agent
 *  activity are folded into the message's one ThinkingRow by turnsOf, not here. */
export function turnOfBlock(b, ctx = {}) {
  if (!b || typeof b !== 'object') return null;
  if (b.kind === 'card') return cardTurn(b, ctx);
  if (b.kind === 'notice' && !b.quiet) return { t: 'notice', text: str(b.text) };
  if (b.kind === 'divider') return { t: 'divider', text: str(b.text) };
  return null;
}

// D12 (c): commands one after another in one answer are the prototype's one `commands` turn (CommandGroup), as dev groups them
function groupCommands(out) {
  for (let k = 0; k < out.length; k++) {
    if (out[k].t !== 'cmd' || out[k + 1]?.t !== 'cmd') continue;
    let n = k; while (out[n + 1]?.t === 'cmd') n++;
    const list = out.slice(k, n + 1);
    const rows = list.map((c) => ({ summary: c.sum || c.cmd, cmd: c.cmd, state: c.done ? (c.failed ? 'fail' : 'ok') : 'run', end: c.done ? c.end || '' : '', dir: c.dir, out: c.out || '' }));
    out.splice(k, list.length, { t: 'commands', id: list[0].id, rows, dir: list[0].dir, session: list[0].session });
  }
}
const FAILED_TEXT = 'Worca could not answer this time.';
const secs = (ms) => Math.max(1, Math.round((Number(ms) || 0) / 1000));
// panel.turn-time: a turn's time is its message's own createdAt, never a made-up one (an echo has none until dev's row lands)
const atOf = (m) => { const t = Date.parse(str(m.createdAt)); return Number.isFinite(t) ? { at: t } : {}; };
function assistantTurns(m, ctx) {
  const out = [], blocks = arr(m.blocks), steps = blocks.filter((b) => b && (b.kind === 'tool' || b.kind === 'agent')).map((b) => str(b.label) || str(b.name)).filter(Boolean);
  if (steps.length && m.status !== 'streaming') out.push({ t: 'think', text: `Thought for ${secs(m.durationMs)}s`, steps });
  const text = str(m.text), cards = blocks.filter((b) => b && b.kind !== 'tool' && b.kind !== 'agent'), tail = [];
  // a card placed mid-answer (`textAt`) sits after the words before it; one without stands after the whole answer
  let from = 0, k = 0;
  const at = atOf(m);   // each words turn keyed by its message, so a row inserted above it never moves its time or its focus
  const words = (to) => { const w = text.slice(from, to).trim(); if (w) { const parts = m.status === 'streaming' ? null : partsOf(w); out.push({ t: 'words', html: wordsHtml(w), ...(parts ? { parts } : {}), ...at, key: `${str(m.id)}:${k++}` }); } from = to; };   // refs once the answer is done, as dev's chips
  for (const b of cards) {
    const turn = turnOfBlock(b, ctx);
    if (!Number.isInteger(b.textAt)) { if (turn) tail.push(turn); continue; }
    words(Math.min(Math.max(b.textAt, from), text.length));
    if (turn) out.push(turn);
  }
  words(text.length);
  out.push(...tail);
  groupCommands(out);
  if (m.status === 'streaming' && ctx.inFlight?.messageId === m.id) out.push({ t: 'working', at: Date.parse(str(m.createdAt)) || ctx.now || 0, ...(steps.length ? { steps } : {}) });
  if (m.status === 'error' || m.errorMessage) out.push({ t: 'failed', id: str(m.id), text: FAILED_TEXT, detail: str(m.errorMessage) || str(m.reason) || 'No reason was given' });
  return out;
}
function userTurn(m) {
  const blocks = arr(m.blocks), synthetic = blocks.find((b) => b && b.kind === 'notice' && b.synthetic);
  if (synthetic) return { t: 'notice', text: str(synthetic.text) };
  const files = blocks.filter((b) => b && b.kind === 'attachment').map((b) => str(b.name)).filter(Boolean);
  return { t: 'you', id: str(m.id), text: str(m.text), ...(files.length ? { files } : {}), ...atOf(m) };
}

/** Every turn of a thread, in order. `thread`: the GET answer's parts (`messages`, `runLinks`, `inFlight`); `ctx.tasks`: the
 *  chat's tasks (live-map.mjs chatOf), so a run card names its store task. */
export function turnsOf({ messages = [], runLinks = [], inFlight = null } = {}, { tasks = [], now = 0, runLinks: links, commandOf = null } = {}) {
  const ctx = { tasks, now, inFlight, runLinks: links || runLinks, commandOf };
  const out = [];
  for (const m of arr(messages)) {
    if (!m) continue;
    if (m.role === 'user') out.push(userTurn(m));
    else if (m.role === 'assistant') out.push(...assistantTurns(m, ctx));
    // dev writes a project switch as a system message with its divider block (ui/server.mjs switchThreadScope)
    else if (m.role === 'system') for (const b of arr(m.blocks)) if (b && b.kind === 'divider') out.push({ t: 'divider', text: str(b.text) });
  }
  return out;
}

/** A run card's TaskCard (the chat-task shape of chats-model.js) over the shared snapshot: one status line and
 *  `step: [n, m]`, n the current stage's place and m the run's stage count (src/shared/run-progress.mjs). The agents at
 *  work never become a ratio. */
const STAGE_INDEX = { plan: 0, build: 1, review: 2, ready: 3 };
/** A run's place among its stages from dev's own count (`runProgress` of its state, or a ready `stageProgress`):
 *  `{step: [n, m], stage, detail}`, or `{}` when the run has no stages yet. */
export function progressOf(p) {
  const stages = arr(p?.stages), cur = stages.findIndex((s) => s.state === 'current');
  if (!stages.length) return {};
  const n = cur >= 0 ? cur + 1 : stages.filter((s) => s.state === 'done').length;
  return { step: [Math.max(1, n), stages.length], stage: STAGE_INDEX[p.stage] ?? Math.max(0, n - 1), ...(str(p.text) ? { detail: str(p.text) } : {}) };
}
/** The progress of a run state as the socket's `state` frame carries it. */
export const progressOfState = (st) => (st && typeof st === 'object' ? progressOf(runProgress(st)) : {});
/** `card`: the task's TaskCard fields from task-live (task-page.mjs taskCardOf: branch, base, case, failure, PR facts), spread
 *  in so a state is built once (Tasks D3). */
export function taskOfRunCard(snap, card = {}) {
  if (!snap) return null;
  const p = snap.stageProgress || (snap.run ? runProgress(snap.run) : null), q = progressOf(p);
  const id = str(snap.runId) || str(snap.pipelineId);
  return { id, run: id, title: str(snap.title) || 'Untitled task', detail: str(p?.text), ...(q.step ? { step: q.step, stage: q.stage } : {}), ...card };
}

/** A Shaper plan approval (`pendingQuestion.kind === 'plan'`) as the live PlanCard draws it (panel.plan-folds): `roles` are
 *  dev's per-role verdicts (roleSummaries of `plan.roleReviews`; the perspectives' names only when there is no review),
 *  `coverage` its per-requirement rows (displayCoverage), `check` the review line's word, `fixAll` the revise feedback dev's
 *  Fix all sends ('' when nothing fails or the plan cannot be revised), and `decisions` the open choices: a criteria
 *  hold's decisions, else the last round's role conflicts, each with its options and Worca's pick. */
export function planView(q) {
  const p = (q && q.plan) || {};
  const sums = roleSummaries(p.roleReviews);
  const roles = sums.length ? sums.map((s) => ({ name: str(s.label), ok: !s.open, note: countsText(s.counts) }))
    : arr(p.perspectives).map((v) => (typeof v === 'string' ? { name: perspectiveByKey(v)?.label || v, ok: true, note: '' } : { name: str(v?.name) || str(v?.id), ok: v?.ok !== false, note: str(v?.note) }));
  const cov = p.coverage && Array.isArray(p.coverage.items) ? p.coverage : null;
  const coverage = cov ? displayCoverage(cov).items.map((it) => ({ name: str(it.label) || str(it.id), ok: !!it.pass, note: it.pass ? '' : str(it.detail) })) : [];
  const items = arr(p.check?.items), bad = items.filter((it) => it && !it.pass).length, uncovered = cov ? cov.items.filter((it) => it && !it.pass) : [];
  const check = p.check ? (bad ? `${bad} to fix` : 'shape check passed') : '';
  const fixAll = p.revisable && (bad || uncovered.length) ? fixAllFeedback(items, uncovered) : '';
  const recOf = (opts, rec) => Math.max(0, opts.findIndex((o) => o.value === rec));
  const decisions = Array.isArray(p.decisions)
    ? p.decisions.map((d) => { const opts = arr(d.options).map((o) => ({ value: str(o?.value), label: str(o?.label) || str(o?.value) })); return { id: str(d.id), kind: 'decision', question: str(d.plain) || str(d.text), options: opts.map((o) => o.label), values: opts.map((o) => o.value), rec: recOf(opts, d.recommended) }; })
    : arr(currentPass(p.roleReviews)?.rounds?.at(-1)?.conflicts).map((c) => { const opts = arr(c.options).map(str).filter(Boolean); return { id: str(c.id), kind: 'conflict', question: str(c.question), options: opts, values: opts, rec: 0 }; });
  return { roles, coverage, check, fixAll, decisions: decisions.filter((d) => d.id && d.options.length) };
}
/** The picks of a plan's open choices as dev's plan answer carries them: `{conflicts: [{id, choice}]}` and/or
 *  `{decisions: {id: value}}`; `picked[id]` is the chosen option's index, Worca's pick when unset. */
export function planPicks(view, picked = {}) {
  const out = {};
  for (const d of view.decisions) {
    const k = picked[d.id] ?? d.rec, v = d.values[k] ?? d.values[d.rec];
    if (d.kind === 'conflict') (out.conflicts ||= []).push({ id: d.id, choice: v });
    else (out.decisions ||= {})[d.id] = v;
  }
  return out;
}
