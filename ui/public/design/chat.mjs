// ui/public/design/chat.mjs — the Design chat (C-10, L5.11), in two halves. The thin client, with no DOM: the design's
// own Ask thread (ask_threads.mode = 'design') over the Ask panel's ask-model.mjs reducer, the send path with the
// design payload, the stop and card routes, the frames app.js fans out to it, the mid-build question state from C-5
// frames, and the receipt row's fixed copy. Modelled on workflows/chat-client.mjs. The dock (`createDesignChat`): the
// small chat in P4's `.dz-chat-slot`, with the Ask column's classes (the mockup's chat column), real ask cards, round
// receipts, pins and Build fast. Modelled on workflows/chat-dock.mjs. Nothing runs when this file loads.
import { createThreadModel } from '../ask-model.mjs';
import { chatEngineOf, engineOfEntry } from '../ask-engine.mjs';
import { fmtElapsed } from './stage-model.mjs';
import { icon } from '../icons.mjs';
import { makeSwitch } from '../switch.mjs';
import { buildChatQuestion, buildChatReceipt } from '../chat/question.mjs';
import { createDotOrbs, turnPhase } from '../dot-orb.mjs';
import { bytesToBase64, carriesFiles, checkAttachment, createPasteNamer, pastedFiles } from '../attach-files.mjs';
import { DESIGN_FAST_LABEL, DESIGN_PICTURES_DEFAULT } from '../../../src/shared/design-names.mjs';
import { createModelPills } from './model-pills.mjs';
import { createComposerSettings, createPicturesRow } from './composer-settings.mjs';
import { createBuildNarration, nameList } from './narration.mjs';
import { createPictureStrip, openPictureViewer, madeWords, failedWords } from './pictures.mjs';
import { currentLevel, levelShows } from '../ui-level.mjs';
import { renderAskForm } from '../ask/form-renderer.mjs';

const enc = encodeURIComponent;
const readJson = async (res) => { try { return await res.json(); } catch { return {}; } };
const postJson = (fetchFn, url, body) => fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
/** A question card's picks (`Map<qid, value>`, as buildChatQuestion hands them) as C-2 answers. */
const answersOf = (picks) => [...(picks instanceof Map ? picks : new Map())].map(([id, value]) => ({ id, value }));
/** What a pin sends (L5.2, Task 3's validator): P4's `label` and box stay in the dock. */
const trimPins = (pins) => (Array.isArray(pins) ? pins : [])
  .filter((p) => p && typeof p === 'object')
  .map((p) => ({ id: p.id, path: p.path, tag: p.tag, text: p.text, html: p.html }));

/**
 * The design's chat thread. The thread comes from the design row (no storage, no New chat): a thread that is gone
 * (404) or is not a design thread is dropped, and the next send asks the server for the design's thread again.
 * @param {{designId: string, threadId?: string|null, fetch: Function, sendWs?: Function, onChange?: Function}} o
 */
export function createDesignChatClient({ designId, threadId: initial = null, fetch: fetchFn, sendWs = () => {}, onChange = () => {} } = {}) {
  const post = (url, body) => postJson(fetchFn, url, body);
  let threadId = typeof initial === 'string' && initial ? initial : null;
  let model = null;
  let catalog = null;
  let sending = false;
  let awaiting = null;                           // the assistant message a 202 promised, until its first frame lands
  let gen = 0;                                   // a newer load or a drop wins over a slower load
  let resyncing = null;                          // the reload a seq gap started: later frames wait for it

  /** The thread is gone (deleted, or not a design thread): forget it; the next send recreates or recovers it. */
  function drop() {
    gen += 1;
    threadId = null;
    model = null;
    awaiting = null;
    onChange('structure');
  }

  async function load(id) {
    const my = ++gen;
    let res;
    try { res = await fetchFn(`/api/ask/threads/${enc(id)}`); } catch { return false; }
    if (my !== gen) return false;
    if (!res.ok) { if (res.status === 404) drop(); return false; }
    const snap = await readJson(res);
    if (my !== gen) return false;
    if (!snap.thread || snap.thread.mode !== 'design') { drop(); return false; }
    model = createThreadModel({ threadId: id });
    model.load(snap);
    awaiting = null;                             // the snapshot's inFlight speaks for any turn in progress
    if (snap.inFlight) sendWs({ type: 'subscribe', threadId: id });
    onChange('structure');
    return true;
  }

  async function defaultPick() {
    if (!catalog) {
      try { const r = await fetchFn('/api/ask/models'); catalog = r.ok ? await readJson(r) : null; } catch { catalog = null; }
    }
    // The server locks a chat to the engine of its first reply: a thread keeps its engine's default.
    const engine = model && model.thread() ? model.thread().engine : null;
    const own = engine && catalog && catalog.defaults ? catalog.defaults[engine] : null;
    const d = own || (catalog && catalog.default);
    return d && typeof d.model === 'string' && typeof d.effort === 'string' ? { model: d.model, effort: d.effort } : null;
  }

  /** The design's thread, loaded: the known one, else a new one (201), else the one another tab made (409). */
  async function ensureThread() {
    if (threadId && !model) {
      await load(threadId);
      if (threadId && !model) return 'This chat could not be loaded. Try again.';
    }
    if (threadId) return null;
    const r = await post('/api/ask/threads', { mode: 'design', designId });
    const body = await readJson(r);
    if (r.status === 201 && body.thread && typeof body.thread.id === 'string') {
      threadId = body.thread.id;
      model = createThreadModel({ threadId });
      model.load({ thread: body.thread, messages: [], attachments: [], runLinks: [], inFlight: null });
      return null;
    }
    if (r.status === 409 && typeof body.threadId === 'string' && body.threadId) {
      threadId = body.threadId;
      if (await load(threadId)) return null;
      return 'This chat could not be loaded. Try again.';
    }
    return body.error || `HTTP ${r.status}`;
  }

  return {
    threadId: () => threadId,
    model: () => model,
    // `awaiting` covers the gap between the 202 and the turn's first frame: a second Enter there would get a 409.
    busy: () => sending || Boolean(awaiting) || Boolean(model && model.live()),
    /** True once the thread loaded as a design thread; false with no thread, a gone one or one of another mode. */
    async open() {
      if (!threadId) return false;
      if (model) return true;
      return load(threadId);
    },
    /** The engine the next message runs on: the chat's lock once it has a reply, else the default pick's engine. */
    async engine() {
      if (threadId && !model) await load(threadId);
      const pick = await defaultPick();
      if (!pick) return null;
      const t = model && model.thread() ? model.thread() : null;
      const entry = catalog && Array.isArray(catalog.models) ? catalog.models.find((x) => x && x.id === pick.model) || null : null;
      return chatEngineOf(model ? model.messages() : [], pick.model, catalog, t && t.engine) || engineOfEntry(entry);
    },
    /** Every message says the design, an empty pin list included. `attachments`: the dock's pending files
     *  ({name, dataBase64, bytes, attKind, mime}); only name and base64 go up. */
    async send(text, { pins = [], attachments = [] } = {}) {
      if (sending) return { ok: false, error: 'A message is already on its way.' };
      sending = true;
      onChange('sending');
      try {
        const refused = await ensureThread();
        if (refused) return { ok: false, error: refused };
        const pick = await defaultPick();   // after the load: a thread keeps its own engine
        if (!pick) return { ok: false, error: 'No model is available for the chat.' };
        const tid = threadId;
        const m = model;
        const files = (Array.isArray(attachments) ? attachments : []).filter((f) => f && typeof f.name === 'string' && typeof f.dataBase64 === 'string');
        const r = await post(`/api/ask/threads/${enc(tid)}/messages`, { text, model: pick.model, effort: pick.effort,
          context: { view: 'design' }, design: { designId, pins: trimPins(pins) },
          ...(files.length ? { attachments: files.map((f) => ({ name: f.name, dataBase64: f.dataBase64 })) } : {}) });
        const body = await readJson(r);
        if (r.status !== 202) return { ok: false, error: body.error || `HTTP ${r.status}` };
        // A drop or reload while the POST was out: the message went to the thread it was sent to; its rows arrive
        // over the socket, never written into the model now showing.
        if (threadId !== tid || model !== m) return { ok: true };
        const echo = Array.isArray(body.attachments)
          ? body.attachments.map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind ?? 'text', mime: a.mime ?? null }))
          : files.map((f) => ({ name: f.name, bytes: f.bytes, attKind: f.attKind, mime: f.mime }));
        m.noteLocalUserMessage({ id: body.userMessageId, text, attachments: echo });
        awaiting = body.assistantMessageId || null;
        sendWs({ type: 'subscribe', threadId: tid });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Worca did not answer (${e && e.message ? e.message : e}).` };
      } finally {
        sending = false;
        onChange('structure');
      }
    },
    async stop() { if (threadId) { try { await post(`/api/ask/threads/${enc(threadId)}/stop`, {}); } catch { /* the turn ends anyway */ } } },
    /** A clarifying card's answers (Task 9's card route). A refusal throws the server's words, which the question card
     *  shows in its `.chat-rc-q-err`. */
    async answerCard(cardId, picks) {
      if (!threadId) throw new Error('Answer not sent');
      const r = await post(`/api/ask/threads/${enc(threadId)}/cards/${enc(cardId)}`, { answers: answersOf(picks) });
      const body = await readJson(r);
      if (!r.ok) throw new Error(body.error || 'Answer not sent');
      return body;
    },
    /** A `fields` card's values (`{fieldId: value}`). A refusal throws the server's words; one that names fields (422)
     *  carries them as `err.errors` for the form's own marks. */
    async answerForm(cardId, values) {
      if (!threadId) throw new Error('Answer not sent');
      const r = await post(`/api/ask/threads/${enc(threadId)}/cards/${enc(cardId)}`, { answers: values });
      const body = await readJson(r);
      if (!r.ok) {
        const err = new Error(body.error || 'Answer not sent');
        if (Array.isArray(body.errors)) err.errors = body.errors;
        throw err;
      }
      return body;
    },
    pushFrame(frame) {
      // Settings › Delete all chat history deletes design chats too (L5.3): drop the dead thread, or every next
      // message posts to it and fails. A shared clear names its threads.
      if (frame && frame.type === 'ask-history-cleared') {
        if (threadId && (!Array.isArray(frame.threadIds) || frame.threadIds.includes(threadId))) drop();
        return;
      }
      if (!model || !frame || frame.threadId !== threadId) return;
      const r = model.apply(frame);
      if (awaiting && frame.messageId === awaiting) awaiting = null;      // the turn is live: live() takes over busy()
      // Every frame after a gap gaps too, until the reload lands: ONE GET, not one per frame.
      if (r && r.gap) { if (!resyncing) resyncing = load(threadId).finally(() => { resyncing = null; }); return; }
      onChange('frame');
    },
    onHello() { if (threadId) void load(threadId); },
    resync() { return threadId ? load(threadId) : Promise.resolve(false); },
  };
}

// C-5 build statuses that end every open question: P2 answers 409 for a question of a paused build (routes.mjs), and
// Resume asks again through a frame or the snapshot.
const QUESTION_END = Object.freeze(['paused', 'done', 'stopped', 'error', 'interrupted']);
/** A C-5 question (`design-question`'s fields, or one of `design-snapshot.questions`) as an open entry of `buildId`. */
const openQuestion = (q, buildId) => ({ buildId, agentId: q.agentId, askId: q.askId, job: q.job, heading: q.heading, questions: q.questions, state: 'open' });

/**
 * The mid-build questions of one design, from C-5 frames only: `design-question` opens one, `design-snapshot` replaces
 * them all, an agent that moves on closes its open ones, and a build that ends or pauses clears them.
 * Entries are `{...question fields, buildId, state: 'open'|'answered'|'closed', picks?}`.
 */
export function createQuestionState({ designId } = {}) {
  let items = [];
  return {
    push(frame) {
      if (!frame || typeof frame !== 'object' || frame.designId !== designId) return;
      switch (frame.type) {
        case 'design-question':
          items = [...items.filter((q) => q.askId !== frame.askId), openQuestion(frame, frame.buildId)];
          break;
        case 'design-snapshot':
          items = (Array.isArray(frame.questions) ? frame.questions : [])
            .filter((q) => q && typeof q === 'object')
            .map((q) => openQuestion(q, frame.buildId));
          break;
        case 'design-agent':
          if (frame.status === 'waiting') break;
          items = items.map((q) => (q.state === 'open' && q.agentId === frame.agentId ? { ...q, state: 'closed' } : q));
          break;
        case 'design-build':
          if (QUESTION_END.includes(frame.status)) items = [];
          break;
        default:
          break;
      }
    },
    list: () => items.map((q) => ({ ...q })),
    /** The dock's verdict on an answer: `answered` keeps the picks the card shows; `closed` when the agent moved on. */
    mark(askId, state, picks) {
      items = items.map((q) => (q.askId === askId ? { ...q, state, ...(picks instanceof Map ? { picks } : {}) } : q));
    },
  };
}

/**
 * Answers a mid-build question (C-8 `POST /api/design/:id/builds/:bid/answer`). `closed` when the build no longer
 * waits on it (409); any other refusal throws the server's words for the card, the 409 `credential-missing` included
 * (P8: the person has not added their key yet, and the agent still waits).
 * @returns {Promise<'answered'|'closed'>}
 */
export async function answerBuildQuestion({ designId, fetch: fetchFn }, q, picks) {
  const r = await postJson(fetchFn, `/api/design/${enc(designId)}/builds/${enc(q.buildId)}/answer`, { askId: q.askId, answers: answersOf(picks) });
  if (r.ok) return 'answered';
  const body = await readJson(r);
  if (r.status === 409 && body?.code !== 'credential-missing') return 'closed';
  throw new Error(body?.error || 'Answer not sent');
}

const SEP = ' · ';
const costText = (card) => (card.costKnown && Number.isFinite(card.costUsd) ? `$${card.costUsd.toFixed(2)}` : 'cost unknown');
const agentsText = (n) => {
  const count = Number.isSafeInteger(n) && n > 0 ? n : 0;
  return `${count} agent${count === 1 ? '' : 's'}`;
};

/** A round receipt's row text (L5.17): the done line is the HUD's (`Built`/`Changed by N agents in T · $c`). */
export function roundRowText(card, state) {
  const head = `Round ${card.round}`;
  switch (state) {
    case 'running': return `${head}: building`;
    case 'paused': return `${head}: paused${SEP}${costText(card)}`;
    case 'done': return `${card.kind === 'change' ? 'Changed' : 'Built'} by ${agentsText(card.agents)} in ${fmtElapsed(card.elapsedMs)}${SEP}${costText(card)}`;
    case 'stopped': return `${head}: stopped${SEP}${costText(card)}`;
    case 'failed': return `${head}: failed`;
    case 'interrupted': return `${head}: interrupted by a restart`;
    default: return head;
  }
}

const BACK_FROM = Object.freeze(['done', 'stopped', 'failed', 'interrupted']);

/** Whether a round's receipt offers `Back to before this` (M2): a finished round with a version before it, and no
 *  build open on the design. */
export function canGoBack(block, { buildLive } = {}) {
  return !buildLive && BACK_FROM.includes(block?.state) && block.card?.baseVersion >= 1;
}

// ── The dock ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** At most six pins per message (L5.2): a seventh is refused in the dock and leaves the stage too. */
const MAX_PINS = 6;
// The build statuses with a round open, `paused` included (P4's LIVE_BUILD leaves it out): no going back meanwhile.
const BUILD_LIVE = Object.freeze(['planning', 'building', 'integrating', 'paused']);
const EMPTY_HINT = 'Describe what to build…';
const CHANGE_HINT = 'Ask for a change';
// M6: the crew Build fast allows, shown off too (board BuildCalm). P8: the server's caps (`GET /api/design/limits`,
// `limits`) once it has answered, else DESIGN_FAST_LABEL on and `up to 3` off.
const LIMITS_URL = '/api/design/limits';
const fastCap = (on, limits) => (limits ? `up to ${on ? limits.fast : limits.calm}` : (on ? DESIGN_FAST_LABEL : 'up to 3'));
/** The limits answer as `{fast, calm}` when both are whole numbers, else null. */
const limitsOf = (body) => (body && Number.isInteger(body.fast) && Number.isInteger(body.calm) ? { fast: body.fast, calm: body.calm } : null);
const answerLabel = (qs) => (qs.length > 1 ? 'Send answers' : 'Send answer');
/** A chip's words: P4's `pinLabel` (never sent), else the pin's id and tag. */
const pinText = (p) => (typeof p.label === 'string' && p.label ? p.label : `${p.id} · ${p.tag}`);
const activityLabel = (label) => { const l = String(label || 'Thinking'); return l.endsWith('…') ? l : `${l}…`; };
// The design tools whose result the thread already shows as a receipt row, a question card or a notice: the mockup's
// chat column draws no tool line for them (boards BuildCalm, Done, Change, Question). A failed call keeps its line.
const QUIET_TOOLS = Object.freeze(['start_design_build', 'change_design', 'design_questions']);
const shortTool = (b) => String(b.name || '').replace(/^mcp__worca__/, '');
/** The tool blocks a reply folds into its one steps row: every call but the design tools a receipt, a card or a notice
 *  already stands for (a failed one of those stays: it says why nothing happened). */
const stepBlocks = (blocks) => blocks.filter((b) => b.kind === 'tool' && (b.status === 'error' || !QUIET_TOOLS.includes(shortTool(b))));
const FILE_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'read_file', 'grep', 'glob']);
const WEB_TOOLS = Object.freeze(['WebSearch', 'WebFetch', 'web_search', 'web_fetch']);
const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
/**
 * What a reply's tool calls did, as one sentence (the folded row's words): `Looked at the design, 4 attachments and
 * 5 files`, `Looking at…` while one still runs, the failures counted after it. Its rounds' pictures are the last item
 * of the same list (`Looked at your projects, 3 files and made 1 picture`; past four the looked-at items fold, the
 * pictures stay), `Made 1 picture` with no tool, and the failed ones close the line (`· 1 picture failed`).
 * @param {object[]} tools the reply's step blocks
 * @param {{made?: number, failed?: number}} [pics] the finished asks of the reply's rounds
 */
export function stepsSentence(tools, { made = 0, failed = 0 } = {}) {
  const names = tools.map(shortTool);
  const n = (list) => names.filter((x) => list.includes(x)).length;
  const parts = [];
  if (names.includes('get_design')) parts.push('the design');
  if (names.includes('list_projects')) parts.push('your projects');
  const atts = n(['read_attachment']);
  if (atts) parts.push(plural(atts, 'an attachment', 'attachments'));
  const files = n(FILE_TOOLS);
  if (files) parts.push(plural(files, 'a file', 'files'));
  if (n(WEB_TOOLS)) parts.push('the web');
  const known = ['get_design', 'list_projects', 'read_attachment', ...FILE_TOOLS, ...WEB_TOOLS];
  const other = names.filter((x) => !known.includes(x)).length;
  if (other) parts.push(plural(other, parts.length ? 'one more thing' : 'one thing', parts.length ? 'more things' : 'things'));
  const running = tools.some((b) => (b.status || 'running') === 'running');
  const broke = tools.filter((b) => b.status === 'error').length;
  // nameList's fold, kept as items so the pictures join the same list with its one `and`.
  const looked = parts.length > 4 ? [...parts.slice(0, 4), `${parts.length - 4} more`] : parts;
  const items = made > 0 ? [...looked, madeWords(made)] : looked;
  const list = nameList(items, items.length);
  const lead = parts.length ? `${running ? 'Looking at' : 'Looked at'} ${list}` : list.replace(/^m/, 'M');
  return [lead, broke ? `${broke} failed` : '', failed > 0 ? failedWords(failed) : ''].filter(Boolean).join(SEP);
}
/** How many of a build's milestone lines the thread shows before `Show all`. */
const LINES_SHOWN = 4;
const errorOf = (body, fallback) => (body && typeof body.error === 'string' && body.error ? body.error : fallback);
const blocksOf = (msg) => (Array.isArray(msg.blocks) ? msg.blocks.filter((b) => b && typeof b === 'object') : []);
// The mockup's pin glyph (icons.mjs has none).
const PIN_PATH = 'M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z';

/**
 * The Design chat's dock in P4's `.dz-chat-slot` (`view.mjs` createChat seam): the thread (`.dsc-scroll.ask-transcript >
 * .dsc-thread.ask-transcript-col`) with the Plan list after the first user row, clarifying cards and round receipts in
 * the ask-card grammar, mid-build questions after the messages, and the composer (`.ask-composer > .ask-composer-box`)
 * with pin chips, attachments, Point, Build fast, Stop and Send. Every string reaches the DOM through `textContent`.
 * @param {{doc: Document, host: HTMLElement, design: object, fetch: Function, sendWs?: Function,
 *   renderMarkdown?: Function|null, confirm?: Function|null, setPick?: (on: boolean) => void,
 *   onRestored?: (r: {version: number, restoredFrom: number}) => void, planList?: {el: HTMLElement}|null,
 *   unpin?: (id: string, path: string) => void, initial?: {text: string, files: object[]}|null,
 *   pictures?: object|null}} o  `confirm` is app.js's
 *   confirmModal (absent = go ahead, a throw = no). `initial` is the Library's first message (P6 takeStart): once the
 *   thread has loaded it goes through the dock's own send, files included, so a refusal stays in the input with its note.
 *   `pictures` is the design's picture log (pictures.mjs `createPictureLog`; the view feeds it): a live round's
 *   pictures sit after the feed's lines, a finished or paused round's under its reply's step line.
 * @returns {{client: object, pushAskFrame: Function, pushDesignFrame: Function, addPin: Function, onHello: Function,
 *   repaint: Function, destroy: Function}}
 */
export function createDesignChat({ doc, host, design, fetch: fetchFn, sendWs = () => {}, renderMarkdown = null, confirm: confirmFn = null,
  setPick = () => {}, onRestored = () => {}, planList = null, unpin = () => {}, initial = null, onBusy = () => {}, pictures = null }) {
  const win = doc.defaultView || globalThis;
  const row0 = design && typeof design === 'object' ? design : {};
  const designId = typeof row0.id === 'string' ? row0.id : '';
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const iconBtn = (cls, label, name) => {
    const b = h('button', cls);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(doc, name, 16));
    return b;
  };
  const planEl = planList && planList.el && planList.el.nodeType === 1 ? planList.el : null;

  let destroyed = false;
  let pending = false;          // a send is on its way (the POST, and the files it waits for)
  let pins = [];                // the next message's pins, as P4 hands them over (label included)
  let pointing = false;
  let fast = row0.fast === true;
  let limits = null;            // the server's Build fast caps (P8), asked once per dock: null until they answer
  let buildLive = BUILD_LIVE.includes(row0.status);
  // The build the stage's round belongs to: `design.currentBuild` stays set after a round ends (store.mjs).
  let roundBuild = typeof row0.currentBuild === 'string' && row0.currentBuild ? row0.currentBuild : null;
  let pendingFiles = [];        // {name, bytes, dataBase64, attKind, mime}
  let adding = Promise.resolve();
  let queued = false;
  let queuedFull = false;
  let wasLive = false;
  let liveId = null;
  let liveAnswerEl = null;
  const sentPins = new Map();   // user message id -> the chip words it was sent with (no server field: this tab only)
  const cardEls = new Map();    // card id -> {sig, el}: a frame never swaps a tile under the pointer
  const replyEls = new Map();   // finished reply id -> {sig, el}: a repaint keeps its node, its markdown, a selection in it
  const askEls = new Map();     // mid-build askId -> {sig, el}
  const userAtts = new Map();   // user message id -> {sig, el}
  const restoring = new Set();  // round card ids whose restore is out
  const restoreErr = new Map(); // round card id -> the refusal shown in its row
  const questions = createQuestionState({ designId });
  const narration = createBuildNarration({ designId, kind: row0.kind });
  // A frame or a row that changes what the log shows repaints the thread (its tiles), whatever reached the dock.
  const unsubscribe = pictures ? pictures.subscribe(() => schedule()) : () => {};
  let viewer = null;            // the open picture viewer
  const openSteps = new Set();  // reply ids whose folded tool rows are open
  let allLines = false;         // the build's milestone lines: every one, or the last few
  let buildEl = null;
  let buildSig = '';
  let busyTold = null;
  const client = createDesignChatClient({ designId, threadId: row0.threadId, fetch: fetchFn, sendWs, onChange: (kind) => schedule(kind) });
  const orbs = createDotOrbs({ doc, win });

  const root = h('div', 'dsc-root');
  const scroller = h('div', 'dsc-scroll ask-transcript');
  const thread = h('div', 'dsc-thread ask-transcript-col');
  thread.setAttribute('role', 'log');
  // role=log implies polite, and a frame rebuilds the thread: `sr` says one line per finished reply or question.
  thread.setAttribute('aria-live', 'off');
  thread.setAttribute('aria-label', 'Design chat');
  scroller.append(thread);
  const sr = h('div', 'sr-only dsc-sr');
  sr.setAttribute('aria-live', 'polite');
  const liveEl = h('div', 'dsc-act');
  liveEl.hidden = true;
  const orb = orbs.create(16, 'dsc-orb');
  const liveLabelEl = h('span', 'dsc-act-l');
  liveEl.append(orb, liveLabelEl);
  const noteEl = h('p', 'dsc-note');
  noteEl.hidden = true;
  const pinRow = h('div', 'chat-composer-lead dsc-pins');
  pinRow.setAttribute('role', 'group');
  pinRow.setAttribute('aria-label', 'Pinned parts of the page');
  const fileRow = h('div', 'ask-chips dsc-files');
  fileRow.setAttribute('role', 'group');
  fileRow.setAttribute('aria-label', 'Attachments for the next message');
  fileRow.hidden = true;
  const input = h('textarea', 'dsc-input dz-input');
  input.rows = 1;
  input.placeholder = EMPTY_HINT;
  input.setAttribute('aria-label', 'Message the design chat');
  const attachBtn = iconBtn('btn btn-quiet btn-icon dsc-attach', 'Attach files', 'plus');
  const fileInput = h('input', 'dsc-file-input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.hidden = true;
  const pointBtn = iconBtn('btn btn-quiet btn-icon dsc-point', 'Point at the page', 'cursor');
  const sw = makeSwitch(doc, { label: 'Build fast', checked: fast, rowClass: 'dsc-fast dz-fast', inputClass: 'dsc-fast-input' });
  const capEl = h('span', 'dsc-fast-cap dz-fast-n');
  sw.row.append(capEl);
  const stopBtn = iconBtn('btn btn-icon ask-stop dsc-stop', 'Stop', 'stop-square');
  stopBtn.hidden = true;
  const sendBtn = iconBtn('btn btn-primary btn-icon ask-send dsc-send', 'Send', 'arrow-up');
  const row = h('div', 'ask-composer-row dsc-row');
  // Pictures under Build fast, read from the design row; the image service's state is asked for when the dock is made
  // and at each open of the gear. The popup opens upward, so a row that appears while it is open places it again.
  const pics = createPicturesRow({ doc, fetch: fetchFn, checked: typeof row0.pictures === 'boolean' ? row0.pictures : DESIGN_PICTURES_DEFAULT });
  const loadPics = () => pics.load().then((c) => { if (c) settings.reposition(); });
  // The models and Build fast sit in one popup behind a gear, so the row keeps to Attach, Point, the gear and Send.
  const settings = createComposerSettings({ doc, win, mode: 'up', onOpen: () => { void loadPics(); } });
  row.append(attachBtn, fileInput, pointBtn, settings.el, h('span', 'dz-spacer'), stopBtn, sendBtn);
  // The lead's and the builders' models, remembered on the design (PATCH): a change applies from the next round.
  const pills = createModelPills({ doc, win, fetch: fetchFn, mode: 'beside', parent: settings.panel, url: () => (designId ? `/api/design/${enc(designId)}/models` : null),
    save: async (role, pick) => {
      setNote('');
      try {
        const r = await fetchFn(`/api/design/${enc(designId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ models: { [role]: pick } }) });
        if (r.ok) return '';
        const error = errorOf(await readJson(r), `The model was not saved (HTTP ${r.status}).`);
        if (!destroyed) setNote(error);
        return error;
      } catch {
        if (!destroyed) setNote('The model was not saved.');
        return 'The model was not saved.';
      }
    } });
  settings.fill(pills.el, settings.divider(), sw.row, pics.el);
  const box = h('div', 'ask-composer-box');
  box.append(pinRow, fileRow, input, row);
  const composer = h('div', 'ask-composer dsc-composer');
  composer.append(liveEl, noteEl, box);
  const dropEl = h('div', 'dsc-drop');
  dropEl.setAttribute('aria-hidden', 'true');
  dropEl.hidden = true;
  dropEl.append(h('span', null, 'Drop files to attach'));
  root.append(scroller, composer, dropEl, sr);
  host.replaceChildren(root);

  // The thread follows its end only while the reader is at it: a build sends frames twice a second, and a repaint follows.
  let stick = true;
  scroller.addEventListener('scroll', () => { stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24; }, { passive: true });
  /** After a repaint, or when the composer changed height (a chip, a file, a longer draft, a note): a thread read at its
   *  end stays there (board Done); a reader scrolled up is left where they are. */
  function followEnd() { if (stick) scroller.scrollTop = scroller.scrollHeight; }

  /** Why something did not happen ('' clears it), said once through the live region. */
  function setNote(text) {
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
    if (text) sr.replaceChildren(h('div', null, text));
    followEnd();
  }
  function autosize() {
    input.style.height = '';
    if (input.value) {
      input.style.height = 'auto';
      const sh = input.scrollHeight;
      input.style.height = sh ? `${Math.min(160, sh)}px` : '';
    }
    sendBtn.setAttribute('aria-disabled', input.value.trim() && !pending && !client.busy() ? 'false' : 'true');
    followEnd();
  }

  // ── pins (C-6 `picked` plus P4's `label`) ───────────────────────────────────────────────────────────────────
  function pinIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const s = doc.createElementNS(NS, 'svg');
    const attrs = { viewBox: '0 0 24 24', width: '13', height: '13', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    const path = doc.createElementNS(NS, 'path');
    path.setAttribute('d', PIN_PATH);
    s.append(path);
    return s;
  }
  function chip(cls, words) {
    const el = h('span', `${cls} dz-pin-chip`);
    el.title = words;
    el.append(pinIcon(), h('span', null, words));
    return el;
  }
  function paintPins() {
    const at = [...pinRow.querySelectorAll('.dsc-pin-x')].indexOf(doc.activeElement);
    pinRow.replaceChildren(...pins.map((p) => {
      const words = pinText(p);
      const el = chip('dsc-pin', words);
      const x = h('button', 'dz-pin-x dsc-pin-x');
      x.type = 'button';
      x.title = 'Remove';
      x.setAttribute('aria-label', `Remove ${words}`);
      x.append(icon(doc, 'x', 12));
      x.addEventListener('click', () => removePin(p));
      el.append(x);
      return el;
    }));
    if (at >= 0) {
      const xs = [...pinRow.querySelectorAll('.dsc-pin-x')];
      (xs[Math.min(at, xs.length - 1)] || input).focus({ preventScroll: true });
    }
    followEnd();
  }
  /** A chip's × also takes its box off the stage. */
  function removePin(p) {
    pins = pins.filter((x) => x !== p);
    unpin(p.id, p.path);
    paintPins();
  }
  function paintPoint() { pointBtn.setAttribute('aria-pressed', String(pointing)); }
  pointBtn.addEventListener('click', () => {
    pointing = !pointing;
    paintPoint();
    setPick(pointing);
  });
  /** One click, one pin: a landed pick turns Point off. A seventh, refused, leaves the stage too; a pin already
   *  chipped (same id and path) is not added twice. */
  function addPin(p) {
    if (destroyed || !p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.path !== 'string') return;
    pointing = false;
    paintPoint();
    setPick(false);
    if (pins.some((x) => x.id === p.id && x.path === p.path)) return;
    if (pins.length >= MAX_PINS) {
      setNote(`At most ${MAX_PINS} pins`);
      unpin(p.id, p.path);
      return;
    }
    pins = [...pins, p];
    paintPins();
  }
  /** P4's stage starts a fresh round on a new build (stage-model.mjs freshRound: no pins, no pick): so does the dock. */
  function onBuildFrame(f) {
    if (typeof f.buildId !== 'string' || !f.buildId || typeof f.status !== 'string') return;
    buildLive = BUILD_LIVE.includes(f.status);
    if (f.buildId === roundBuild) return;
    roundBuild = f.buildId;
    if (pins.length) { pins = []; paintPins(); }
    if (pointing) { pointing = false; paintPoint(); }
  }
  /** A late joiner's (or a reconnect's) `design-snapshot` says the build's status (C-5 `build.status`): the receipt
   *  rows' Back follows it. Only the dock's own round: the stage takes only its own build's snapshot. */
  function onSnapshotFrame(f) {
    if (typeof f.buildId === 'string' && f.buildId === roundBuild && f.build && typeof f.build.status === 'string') {
      buildLive = BUILD_LIVE.includes(f.build.status);
    }
  }
  /** What a C-5 frame can change in the thread (M5): the mid-build questions (their cards, the `sr` line) and whether a
   *  build is open (each receipt row's Back). A new round's chips and Point repaint in onBuildFrame. */
  const frameShown = () => {
    const v = narration.view();
    return JSON.stringify([buildLive, questions.list().map((q) => [q.askId, q.state, q.buildId, q.heading, q.questions]),
      feedShown(v), liveDone(v)]);
  };
  /** The live round's tiles (a quiet one per picture in the making, else the last made one of its name). */
  const livePics = (v) => (v.live && pictures && Number.isSafeInteger(v.round) ? pictures.shown(v.round, { live: true }) : []);
  /** The build's milestone lines and live tiles the thread shows now: none while no build runs, or it has neither. */
  function feedShown(v = narration.view()) {
    const pics = livePics(v);
    return v.live && (v.lines.length || pics.length) ? [v.lines, pics.map((p) => [p.name, p.state, p.id])] : null;
  }
  /** The live round while it has finished asks: a round that pauses or ends moves them into its reply (a failed one
   *  too, which shows no tile), so a frame that only ends the round still repaints. Never the round alone: a round
   *  going live with nothing to show must not touch the thread (M5). */
  const liveDone = (v) => (pictures && v.live && Number.isSafeInteger(v.round) && pictures.ofRound(v.round).length ? v.round : null);
  /** A reply's round receipts, and the rounds they name (each once). */
  const roundCards = (msg) => blocksOf(msg).filter((b) => b.kind === 'card' && typeof b.id === 'string' && b.card && b.card.type === 'design-round');
  const roundNos = (msg) => [...new Set(roundCards(msg).map((b) => b.card.round).filter(Number.isSafeInteger))];
  /** A round that is not live now: its pictures sit under its reply's step line (a live one's are in the feed, a paused
   *  one is not live). */
  const settled = (r) => { const v = narration.view(); return !(v.live && v.round === r); };
  /** A reply's pictures: every finished ask of its settled rounds, and the tiles they show (the last made one per name). */
  const picsOf = (msg) => (pictures ? roundNos(msg).filter((r) => settled(r)).flatMap((r) => pictures.ofRound(r)) : []);
  const tilesOf = (msg) => (pictures ? roundNos(msg).filter((r) => settled(r)).flatMap((r) => pictures.shown(r, { live: false })) : []);

  // ── Build fast (L5.10): remembered on the design ─────────────────────────────────────────────────────────────
  function paintFast() {
    sw.input.checked = fast;
    capEl.textContent = fastCap(fast, limits);
  }
  sw.input.addEventListener('change', async () => {
    const want = sw.input.checked;
    fast = want;
    paintFast();
    setNote('');
    sw.input.disabled = true;
    let error = '';
    try {
      const r = await fetchFn(`/api/design/${enc(designId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fast: want }) });
      if (!r.ok) error = errorOf(await readJson(r), `Build fast was not saved (HTTP ${r.status}).`);
    } catch {
      error = 'Build fast was not saved.';
    }
    if (destroyed) return;
    sw.input.disabled = false;
    if (error) {
      fast = !want;
      paintFast();
      setNote(error);
    }
  });

  // ── Pictures (SPEC D7): remembered on the design, as Build fast. A round already running takes off at its next ask
  // (the build asks the switch before each one) and on from the next round (its picture desk opens as a round starts).
  pics.input.addEventListener('change', async () => {
    const want = pics.input.checked;
    setNote('');
    pics.input.disabled = true;
    let error = '';
    try {
      const r = await fetchFn(`/api/design/${enc(designId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pictures: want }) });
      if (!r.ok) error = errorOf(await readJson(r), `The Pictures switch was not saved (HTTP ${r.status}).`);
    } catch {
      error = 'The Pictures switch was not saved.';
    }
    if (destroyed) return;
    pics.input.disabled = false;
    if (error) {
      pics.input.checked = !want;
      setNote(error);
    }
  });

  // ── send ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (destroyed || !text || pending || client.busy()) return;
    pending = true;
    stick = true;                                       // the person's own message comes into view
    setNote('');
    schedule();
    await adding;                                       // a file still being read rides this message
    const files = pendingFiles.slice();
    const out = pins.slice();
    const r = await client.send(text, { pins: out, attachments: files });
    pending = false;
    if (destroyed) return;
    // Pins and files clear only once the message is in: a refused send keeps them for the retry.
    if (r && r.ok) {
      if (input.value.trim() === text) input.value = '';
      dropFiles(files);
      if (out.length) {
        // P4 keeps a pin's box until unpin or the next round, and a reply may start no round.
        pins = pins.filter((p) => !out.includes(p));
        for (const p of out) unpin(p.id, p.path);
        paintPins();
        const m = client.model();
        const sentRow = m ? [...m.messages()].reverse().find((x) => x && x.role === 'user' && x.text === text) : null;
        if (sentRow) sentPins.set(sentRow.id, out.map(pinText));
      }
    } else {
      setNote((r && r.error) || 'Not sent.');
    }
    schedule();
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void send(); }
  });
  sendBtn.addEventListener('click', () => { void send(); });
  stopBtn.addEventListener('click', () => { void client.stop(); });

  // ── attachments (Ask's types, caps and messages: attach-files.mjs) ─────────────────────────────────────────────
  const namePasted = createPasteNamer((parts, name, opts) => new win.File(parts, name, opts));
  let shownFiles = [];
  function renderFiles() {
    // A rebuild under a focused × keeps the keyboard on that file's ×, else the one now in its place, else the input.
    const at = [...fileRow.querySelectorAll('.ask-chip-x')].indexOf(doc.activeElement);
    const was = at >= 0 ? shownFiles[at] : null;
    fileRow.replaceChildren(...pendingFiles.map((f) => {
      const el = h('span', 'ask-chip');
      el.title = f.name;
      if (f.attKind === 'image' && f.dataBase64) {
        const img = h('img', 'ask-chip-thumb');
        img.alt = '';
        img.src = `data:${f.mime};base64,${f.dataBase64}`;
        el.append(img);
      }
      const x = h('button', 'ask-chip-x');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${f.name}`);
      x.append(icon(doc, 'x', 12));
      x.addEventListener('click', () => removeFile(f));
      el.append(h('span', 'ask-chip-name', f.name), x);
      return el;
    }));
    shownFiles = pendingFiles.slice();
    fileRow.hidden = !pendingFiles.length;
    attachBtn.title = pendingFiles.length ? `Attach files (${pendingFiles.length} attached)` : 'Attach files';
    if (at >= 0) {
      const xs = [...fileRow.querySelectorAll('.ask-chip-x')];
      const i = pendingFiles.indexOf(was);
      (xs[i >= 0 ? i : Math.min(at, xs.length - 1)] || input).focus({ preventScroll: true });
    }
    followEnd();
  }
  function removeFile(f) {
    const at = pendingFiles.indexOf(f);
    pendingFiles = pendingFiles.filter((p) => p !== f);
    renderFiles();
    const xs = [...fileRow.querySelectorAll('.ask-chip-x')];
    (xs[Math.min(at, xs.length - 1)] || input).focus({ preventScroll: true });
  }
  function dropFiles(sent) {
    if (!sent.length) return;
    pendingFiles = pendingFiles.filter((p) => !sent.includes(p));
    renderFiles();
  }
  /** The picker, a drop and a paste land here, one batch at a time: a batch reads its files before the next one checks
   *  the caps. The PDF refusal reads the chat's engine. */
  function addFiles(list) {
    const batch = [...(list || [])];
    if (!batch.length) return adding;
    adding = adding.then(() => addBatch(batch)).catch(() => {});
    return adding;
  }
  async function addBatch(batch) {
    setNote('');
    let engine = null;
    try { engine = await client.engine(); } catch { engine = null; }
    for (const f of batch) {
      const v = checkAttachment(f, { pending: pendingFiles, engine });
      if (!v.ok) { setNote(v.error); continue; }
      let dataBase64 = '';
      try { dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()), (s) => win.btoa(s)); }
      catch { setNote(`could not read ${v.name}`); continue; }
      pendingFiles = [...pendingFiles.filter((p) => p.name !== v.name), { name: v.name, bytes: f.size, dataBase64, attKind: v.attKind, mime: v.mime }];
    }
    if (!destroyed) renderFiles();
  }
  attachBtn.addEventListener('click', () => { fileInput.click(); });
  fileInput.addEventListener('change', () => { void addFiles(fileInput.files); fileInput.value = ''; });
  input.addEventListener('paste', (ev) => {
    const list = pastedFiles(ev.clipboardData);
    if (!list) return;                                  // a text paste goes ahead natively
    ev.preventDefault();
    void addFiles(namePasted(list));
  });
  // dragenter/dragleave fire on every child crossed: a depth counter decides when the files really left.
  let dragDepth = 0;
  const endDrag = () => { dragDepth = 0; dropEl.hidden = true; };
  root.addEventListener('dragenter', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    dragDepth += 1;
    dropEl.hidden = false;
  });
  root.addEventListener('dragover', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some engines */ }
  });
  root.addEventListener('dragleave', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropEl.hidden = true;
  });
  root.addEventListener('drop', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    endDrag();
    input.focus({ preventScroll: true });
    void addFiles(ev.dataTransfer.files);
  });
  root.addEventListener('dragend', endDrag);

  // ── round receipts: `Back to before this` (M2, L5.7) ────────────────────────────────────────────────────────
  async function restore(b) {
    const c = b.card;
    if (restoring.has(b.id) || !canGoBack(b, { buildLive })) return;
    // Marked before the question: a second press while it is open asks nothing and posts nothing, and the row's
    // Back waits disabled.
    restoring.add(b.id);
    schedule();
    let yes = true;
    if (typeof confirmFn === 'function') {
      try {
        yes = Boolean(await confirmFn({ title: 'Go back to before this round?', message: `The page returns to how it was before round ${c.round}.`,
          confirmLabel: 'Go back', cancelLabel: 'Stay' }));
      } catch { yes = false; }
    }
    if (destroyed) return;
    // A build that started while the question was open: no going back during a build.
    if (!yes || !canGoBack(b, { buildLive })) {
      restoring.delete(b.id);
      schedule();
      return;
    }
    restoreErr.delete(b.id);
    schedule();
    let error = '';
    let body = {};
    try {
      const r = await postJson(fetchFn, `/api/design/${enc(designId)}/versions/${enc(String(c.baseVersion))}/restore`, { round: c.round });
      body = await readJson(r);
      if (!r.ok) error = errorOf(body, `The page was not restored (HTTP ${r.status}).`);
    } catch {
      error = 'The page was not restored.';
    }
    restoring.delete(b.id);
    if (destroyed) return;
    if (error) restoreErr.set(b.id, error);
    else onRestored({ version: body.version, restoredFrom: body.restoredFrom });
    schedule();
  }
  function roundRow(b) {
    const el = h('div', 'dsc-round dz-reply dz-reply-meta');
    el.append(h('span', 'dsc-round-text', roundRowText(b.card, b.state)));
    if (canGoBack(b, { buildLive })) {
      const back = h('button', 'btn btn-sm btn-quiet dsc-back', 'Back to before this');
      back.type = 'button';
      back.disabled = restoring.has(b.id);
      back.addEventListener('click', () => { void restore(b); });
      el.append(back);
    }
    const err = h('span', 'dsc-round-err', restoreErr.get(b.id) || '');
    err.setAttribute('role', 'status');
    err.hidden = !restoreErr.has(b.id);
    el.append(err);
    return el;
  }

  // ── question cards: only buildChatQuestion and buildChatReceipt ──────────────────────────────────────────────
  /** A `fields` card (design_questions' second shape): the ask-forms renderer inside the ask-card grammar: the heading
   *  with its `?` disc, one white panel holding the components, the pill footer. Answered, it stays with what was
   *  given, read-only; closed unanswered, one line. */
  function formCard(b) {
    const c = b.card;
    if (b.state !== 'asking' && b.state !== 'answered') return buildChatReceipt(doc, 'Not answered');
    const answered = b.state === 'answered';
    const el = h('section', answered ? 'chat-rc-q chat-q dsc-form is-answered' : 'chat-rc-q chat-q dsc-form');
    const head = h('h3', 'chat-rc-q-head', typeof c.heading === 'string' ? c.heading : '');
    head.id = `chat-q-${b.id}-h`;
    el.setAttribute('aria-labelledby', head.id);
    const panel = h('div', 'qpanel');
    panel.dataset.kind = 'form';
    const body = h('div', 'qbody');
    const count = h('span', 'qanswered');
    const go = h('button', 'btn btn-primary', 'Send answers');
    go.type = 'button';
    go.dataset.qpanelSubmit = '';
    const err = h('div', 'chat-rc-q-err');
    err.setAttribute('role', 'status');
    err.hidden = true;
    let busy = false;
    const paintCount = () => {
      const p = form.progress();
      count.textContent = p.total ? `${p.done} of ${p.total} answered` : '';
      count.hidden = !p.total;
      go.disabled = busy;
    };
    const form = renderAskForm({ answerSchema: c.form.answerSchema, layout: c.form.layout, data: {}, files: [] }, {
      doc, readonly: answered, values: answered && c.answers && typeof c.answers === 'object' && !Array.isArray(c.answers) ? c.answers : null,
      onChange: () => paintCount(),
    });
    body.append(form.el);
    if (!answered) {
      const foot = h('div', 'qpanel-foot');
      foot.append(count, go);
      body.append(foot);
      go.addEventListener('click', async () => {
        if (busy) return;
        const out = form.collect();
        form.setErrors(out.errors);            // the marks always show the last verdict
        if (out.errors.length) return;
        busy = true;
        err.hidden = true;
        paintCount();
        try {
          await client.answerForm(b.id, out.values);   // the card stays busy: it waits for its answered state
        } catch (e) {
          busy = false;
          if (Array.isArray(e && e.errors)) form.setErrors(e.errors);
          err.textContent = (e && e.message) || 'Answer not sent';
          err.hidden = false;
          paintCount();
          go.focus();
        }
      });
      paintCount();
    }
    panel.append(body);
    const wrap = h('div', 'chat-rc-qbody');
    wrap.append(panel);
    el.append(head, wrap, err);
    el.__dispose = () => form.dispose();
    return el;
  }
  function clarifyCard(b) {
    const c = b.card;
    if (c.form && typeof c.form === 'object' && Array.isArray(c.form.layout)) return formCard(b);
    const qs = Array.isArray(c.questions) ? c.questions : [];
    const spec = { id: `chat-q-${b.id}`, heading: c.heading, questions: qs, submitLabel: () => answerLabel(qs) };
    if (b.state === 'asking') return buildChatQuestion(doc, { ...spec, onSubmit: (p) => client.answerCard(b.id, p) }).el;
    if (b.state === 'answered') {
      const answers = (Array.isArray(c.answers) ? c.answers : []).filter((a) => a && typeof a.id === 'string');
      return buildChatQuestion(doc, { ...spec, answered: new Map(answers.map((a) => [a.id, a.value])) }).el;
    }
    return buildChatReceipt(doc, 'Not answered');
  }
  function buildQuestion(q) {
    if (q.state === 'closed') return buildChatReceipt(doc, 'Closed: the agent moved on');
    const qs = Array.isArray(q.questions) ? q.questions : [];
    const spec = { id: `design-q-${q.askId}`, heading: q.heading, questions: qs, submitLabel: () => answerLabel(qs) };
    if (q.state === 'answered') return buildChatQuestion(doc, { ...spec, answered: q.picks instanceof Map ? q.picks : new Map() }).el;
    return buildChatQuestion(doc, { ...spec, onSubmit: async (p) => {
      questions.mark(q.askId, await answerBuildQuestion({ designId, fetch: fetchFn }, q, p), p);
      schedule();
    } }).el;
  }
  /** A card's element, reused while its signature holds (chat-dock.mjs): a frame never swaps a tile under the pointer. */
  function cached(map, key, sig, make, seen) {
    seen.add(key);
    const hit = map.get(key);
    if (hit && hit.sig === sig) return hit.el;
    const el = make();
    map.set(key, { sig, el });
    return el;
  }
  function prune(map, seen) {
    for (const k of [...map.keys()]) {
      if (seen.has(k)) continue;
      const gone = map.get(k).el;
      if (gone && typeof gone.__dispose === 'function') gone.__dispose();
      map.delete(k);
    }
  }
  // buildLive in the signature: a `building` frame must not reuse a row whose Back is still enabled. A reply holding the
  // row reads the same signature.
  const roundSig = (b) => JSON.stringify([b.state, b.card, buildLive, restoring.has(b.id), restoreErr.get(b.id) || '']);

  // ── render ─────────────────────────────────────────────────────────────────────────────────────────────────
  function toolLine(b) {
    const short = String(b.name || '').replace(/^mcp__worca__/, '');
    const i = b.input && typeof b.input === 'object' ? b.input : {};
    const target = [i.summary, i.name, i.title].find((v) => typeof v === 'string' && v) || '';
    const status = b.status === 'done' || b.status === 'error' ? b.status : 'running';
    const el = h('div', `dsc-tool dz-reply-meta is-${status}`, `${short.replace(/_/g, ' ')}${target ? ` ${target.slice(0, 80)}` : ''}`);
    el.dataset.minLevel = 'advanced';                    // what the chat ran, as Ask's tool rows (ask-panel.mjs)
    if (status === 'error' && typeof b.error === 'string' && b.error) el.title = b.error;
    return el;
  }
  /** One finished ask in an opened step line (board Failed): what it made and what it cost when known, or why it
   *  failed in the feed's words. */
  function picLine(p) {
    const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
    const words = p.state === 'made'
      ? `Made ${p.name}${SEP}${p.shape}${p.costUsd != null ? `${SEP}$${p.costUsd.toFixed(2)}` : ''}`
      : (reason ? `${p.name}: ${reason}` : `${p.name} failed.`);
    const el = h('div', `dsc-tool dsc-pic-line dz-reply-meta${p.state === 'made' ? '' : ' is-error'}`, words);
    el.dataset.minLevel = 'advanced';                    // as the tool lines beside it
    return el;
  }
  /** A reply's tool calls as ONE row: a sentence saying what they looked at, and the pictures its rounds made, closed
   *  until asked. Its rows show from Advanced on (as Ask's): a Simple dock gets the sentence alone, with nothing to
   *  open. Opened, the tool lines come first, then each finished ask in its round's order. */
  function stepsRow(msgId, tools, pics = []) {
    const canOpen = levelShows(currentLevel(doc), 'advanced');
    const open = canOpen && openSteps.has(msgId);
    const wrap = h('div', 'dsc-steps dz-reply-meta');
    const head = h(canOpen ? 'button' : 'div', 'dsc-steps-head');
    const made = pics.filter((p) => p.state === 'made').length;
    const failed = pics.filter((p) => p.state === 'failed').length;
    head.append(h('span', 'dsc-steps-text', stepsSentence(tools, { made, failed })));
    if (canOpen) {
      head.type = 'button';
      head.setAttribute('aria-expanded', String(open));
      const chev = h('span', 'dsc-steps-chev', '›');
      chev.setAttribute('aria-hidden', 'true');
      head.append(chev);
      head.addEventListener('click', () => {
        if (openSteps.has(msgId)) openSteps.delete(msgId); else openSteps.add(msgId);
        schedule();
      });
    }
    wrap.append(head);
    if (open) {
      const body = h('div', 'dsc-steps-body');
      for (const b of tools) body.append(toolLine(b));
      for (const p of pics) body.append(picLine(p));
      wrap.append(body);
    }
    return wrap;
  }
  /** The running build in sentences (narration.mjs): its milestones so far, the last few unless asked for all, then
   *  the round's pictures so far (boards BuildMaking, DeckDone). What it does right now is the composer's live line.
   *  Null when no build runs, or it has neither a line nor a picture to show. */
  function buildFeed() {
    const v = narration.view();
    const shown = feedShown(v);
    if (!shown) { buildEl = null; buildSig = ''; return null; }
    const sig = JSON.stringify([shown, allLines]);
    if (buildEl && sig === buildSig) return buildEl;
    const el = h('div', 'dsc-build dz-reply');
    const hiddenN = allLines ? 0 : Math.max(0, v.lines.length - LINES_SHOWN);
    if (v.lines.length > LINES_SHOWN) {
      const more = h('button', 'dsc-build-more', allLines ? 'Show fewer' : `Show all ${v.lines.length}`);
      more.type = 'button';
      more.addEventListener('click', () => { allLines = !allLines; schedule(); });
      el.append(more);
    }
    for (const l of v.lines.slice(hiddenN)) el.append(h('p', l.tone === 'fail' ? 'dsc-build-line is-fail' : 'dsc-build-line', l.text));
    const pics = livePics(v);
    if (pics.length) el.append(createPictureStrip({ doc, designId, pictures: pics, onOpen: openViewer }));
    buildEl = el;
    buildSig = sig;
    return el;
  }
  /** A made picture's viewer (one at a time). Its close hands the focus back to the tile, or to the tile painted in
   *  its place (found by its round and name, never by a selector built from the name), else to the input. */
  function openViewer(p, tile) {
    if (viewer) viewer.close({ restore: false });
    const key = `${p.round}|${p.name}`;
    const refocus = () => {
      for (const b of thread.querySelectorAll('button.dsc-pic')) {
        if (b.dataset.pic === key) { b.focus(); return; }
      }
      input.focus();
    };
    viewer = openPictureViewer({ doc, designId, picture: p, opener: tile, refocus });
  }
  function answer(text) {
    const div = h('div', 'dsc-text dz-reply');
    if (typeof renderMarkdown === 'function') renderMarkdown(text, div); else div.textContent = text;
    return div;
  }
  /** A sent message's attachments under its bubble (ask-panel's pills), reused while it shows the same files. */
  function userAttachments(msg) {
    const atts = blocksOf(msg).filter((b) => b.kind === 'attachment');
    if (!atts.length) return null;
    const tid = client.threadId();
    const sig = JSON.stringify([tid, atts.map((b) => [b.id || null, b.name, b.attKind || 'text'])]);
    const hit = userAtts.get(msg.id);
    if (hit && hit.sig === sig) return hit.el;
    const box2 = h('div', 'extras-pills ask-user-pills');
    for (const b of atts) {
      const name = typeof b.name === 'string' && b.name ? b.name : (b.attKind === 'image' ? '(image)' : '(attachment)');
      if (b.attKind === 'image' && b.id && tid) {
        const url = `/api/ask/threads/${enc(tid)}/attachments/${enc(b.id)}`;
        const link = h('a', 'ask-attachment-thumb-link');
        link.setAttribute('href', url);
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = name;
        const img = h('img', 'ask-attachment-thumb');
        img.alt = name;
        img.setAttribute('loading', 'lazy');
        img.setAttribute('src', url);
        link.append(img);
        box2.append(link);
      } else {
        const pill = h('span', 'extra-pill ask-attachment-pill');
        pill.title = name;
        pill.append(h('span', 'extra-pill-name', name));
        box2.append(pill);
      }
    }
    userAtts.set(msg.id, { sig, el: box2 });
    return box2;
  }
  /** A user row: the chips it was sent with above its bubble (board Change), then its attachments. */
  function userRow(msg) {
    const el = h('div', 'ask-msg dsc-user');
    const words = sentPins.get(msg.id);
    if (words && words.length) {
      const sent = h('div', 'dsc-sent-pins');
      for (const w of words) sent.append(chip('dsc-sent-pin', w));
      el.append(sent);
    }
    el.append(h('div', 'ask-user-bubble', typeof msg.text === 'string' ? msg.text : ''));
    const atts = userAttachments(msg);
    if (atts) el.append(atts);
    return el;
  }
  /** A reply's element. A finished one is reused while nothing it draws changed (M5): a repaint must not drop a reader's
   *  selection or a focused link, nor redo every reply's markdown. The live reply is drawn each time: render()'s
   *  text-only path writes into it. */
  function assistantRow(msg, live, seen, seenReplies) {
    if ((live && live.messageId === msg.id) || typeof msg.id !== 'string') return replyRow(msg, live, seen);
    const blocks = blocksOf(msg);
    const rounds = roundCards(msg);
    // Its fields and blocks, and each receipt row's own signature (its Back reads more than the block). With a picture
    // log, each round's pictures once it is no longer live: the reply draws again when its round ends or a row lands.
    const pics = pictures ? roundNos(msg).map((r) => [r, settled(r), settled(r) ? pictures.sig(r) : '']) : null;
    const sig = JSON.stringify([msg.role, msg.status, msg.text, msg.costUsd, msg.errorMessage, msg.reason, blocks, rounds.map(roundSig),
      openSteps.has(msg.id), currentLevel(doc), pics]);
    for (const b of blocks) if (b.kind === 'card' && typeof b.id === 'string') seen.add(b.id);   // a reused row keeps its cards
    return cached(replyEls, msg.id, sig, () => replyRow(msg, null, seen), seenReplies);
  }
  function replyRow(msg, live, seen) {
    const isLive = Boolean(live && live.messageId === msg.id);
    const wrap = h('div', 'ask-msg dsc-reply');
    const steps = stepBlocks(blocksOf(msg));
    const pics = picsOf(msg);
    let stepsPlaced = false;
    // The folded row, then its rounds' pictures as tiles (after its opened body).
    const placeSteps = () => {
      stepsPlaced = true;
      wrap.append(stepsRow(msg.id, steps, pics));
      const tiles = tilesOf(msg);
      if (tiles.length) wrap.append(createPictureStrip({ doc, designId, pictures: tiles, onOpen: openViewer }));
    };
    for (const b of blocksOf(msg)) {
      if (b.kind === 'tool') {
        // Every call of the reply sits in one folded row, where the first one happened.
        if (!stepsPlaced && steps.includes(b)) placeSteps();
      }
      else if (b.kind === 'notice' && typeof b.text === 'string' && b.text) wrap.append(h('p', 'dsc-notice dz-reply dz-reply-meta', b.text));
      else if (b.kind === 'card' && typeof b.id === 'string' && b.card && typeof b.card === 'object') {
        if (b.card.type === 'design-questions') {
          wrap.append(cached(cardEls, b.id, JSON.stringify([b.state, b.card]), () => clarifyCard(b), seen));
        } else if (b.card.type === 'design-round') {
          // A reply with pictures and no step of its own gets the row by itself, just before its first round.
          if (!stepsPlaced && !steps.length && pics.length) placeSteps();
          wrap.append(cached(cardEls, b.id, roundSig(b), () => roundRow(b), seen));
        }
      }
    }
    // A system row worca posted (the notice after Back to before this) is its blocks: its text only when it has no notice
    // (ask-panel's rule). The server stores the words twice, as text and as a notice block.
    if (msg.role === 'system') {
      if (!blocksOf(msg).some((b) => b.kind === 'notice') && typeof msg.text === 'string' && msg.text) {
        wrap.append(h('p', 'dsc-notice dz-reply dz-reply-meta', msg.text));
      }
      return wrap;
    }
    const text = isLive ? live.text : msg.text;
    if (text || isLive) {
      const a = answer(typeof text === 'string' ? text : '');
      if (isLive) { a.dataset.messageId = msg.id; liveAnswerEl = a; }
      wrap.append(a);
    }
    if (msg.status === 'error') wrap.append(h('p', 'dsc-err dz-reply', String(msg.errorMessage || msg.reason || 'The reply failed.')));
    // Chat spend shows on its messages (ask-model sets a row's cost at ask-done); an unknown cost shows none.
    if (Number.isFinite(msg.costUsd) && msg.costUsd > 0) wrap.append(h('span', 'dsc-cost dz-reply-meta', `$${msg.costUsd.toFixed(2)}`));
    return wrap;
  }
  function paintLive(label, on) {
    const text = on ? activityLabel(label) : '';
    if (liveLabelEl.textContent !== text) liveLabelEl.textContent = text;
    liveEl.hidden = !on;
  }
  /** The composer's live line and its orb: the chat's own turn first (`Reading the design…`), else the running build in
   *  one sentence (`3 agents are working on Hero, Pricing and Footer · 2 of 12 done…`), else nothing. Tells the stage
   *  whether the chat is at work, so an empty stage can say so. */
  function paintActivity(live, liveRow, waiting) {
    const phase = !live && !waiting ? narration.view().phase : '';
    paintLive(live ? live.label : phase || null, Boolean(live) || waiting || Boolean(phase));
    orbs.set(orb, live ? turnPhase(live, liveRow ? blocksOf(liveRow) : []) : waiting ? 'think' : phase ? 'tool' : 'rest');
    const busy = Boolean(live) || waiting;
    if (busy !== busyTold) { busyTold = busy; try { onBusy(busy); } catch { /* the stage's line is cosmetic */ } }
  }
  function paintChrome(live) {
    // Hiding the focused Send or Stop would drop the keyboard to <body>: hand it to the one taking its place.
    const a = doc.activeElement;
    if (live && a === sendBtn) { stopBtn.hidden = false; stopBtn.focus({ preventScroll: true }); }
    else if (!live && a === stopBtn) { sendBtn.hidden = false; sendBtn.focus({ preventScroll: true }); }
    stopBtn.hidden = !live;
    sendBtn.hidden = Boolean(live);
    const m = client.model();
    input.placeholder = m && m.messages().length ? CHANGE_HINT : EMPTY_HINT;
    autosize();
  }
  const announced = new Set();   // mid-build askIds already said
  function announce(msgs, finishedId) {
    const lines = [];
    const done = finishedId ? msgs.find((x) => x && x.id === finishedId) : null;
    if (done) lines.push(done.status === 'error' ? 'The reply failed.' : 'Reply finished.');
    for (const q of questions.list()) {
      if (q.state !== 'open' || announced.has(q.askId)) continue;
      announced.add(q.askId);
      lines.push(typeof q.heading === 'string' && q.heading ? q.heading : 'A build question');
    }
    if (lines.length) sr.replaceChildren(...lines.map((line) => h('div', null, line)));
  }
  /** The rows in order, moving only what is out of place: a reused row is never taken out and put back, so a selection
   *  or the focus inside it survives the repaint. */
  function placeKids(kids) {
    const keep = new Set(kids);
    for (const n of [...thread.childNodes]) if (!keep.has(n)) n.remove();
    let at = thread.firstChild;
    for (const k of kids) {
      if (k === at) { at = at.nextSibling; continue; }
      thread.insertBefore(k, at);
    }
  }
  /** `full` false = an Ask frame: when it changed only the streaming text, rewrite that node alone. Anything else
   *  rebuilds the thread, reusing each finished reply's element, each card's and the Plan list (P4 paints it through
   *  onPlan). */
  function render(full = true) {
    if (destroyed) return;
    const m = client.model();
    const d = m && typeof m.takeDirty === 'function' ? m.takeDirty() : null;
    const live = m ? m.live() : null;
    const finishedId = wasLive && !live ? liveId : null;
    wasLive = Boolean(live);
    liveId = live ? live.messageId : null;
    paintChrome(live);
    const msgs = m ? m.messages() : [];
    const textOnly = !full && d && !d.structure && !d.messages.size && !d.blocks.size && live
      && liveAnswerEl && liveAnswerEl.isConnected && liveAnswerEl.dataset.messageId === live.messageId;
    if (textOnly) {
      if (d.answer.size) { if (typeof renderMarkdown === 'function') renderMarkdown(live.text || '', liveAnswerEl); else liveAnswerEl.textContent = live.text || ''; }
      paintActivity(live, msgs.find((x) => x && x.id === live.messageId), false);
      followEnd();
      return;
    }
    liveAnswerEl = null;
    const focused = thread.contains(doc.activeElement) ? doc.activeElement : null;
    const seenCards = new Set();
    const seenAsks = new Set();
    const seenReplies = new Set();
    const kids = [];
    let planPlaced = !planEl;
    for (const msg of msgs) {
      if (!msg || typeof msg !== 'object') continue;
      if (msg.role === 'system' && blocksOf(msg).some((b) => b.kind === 'divider')) continue;
      if (msg.role === 'user') {
        if (blocksOf(msg).some((b) => b.synthetic)) continue;
        kids.push(userRow(msg));
        if (!planPlaced) { kids.push(planEl); planPlaced = true; }
        continue;
      }
      kids.push(assistantRow(msg, live, seenCards, seenReplies));
    }
    if (!planPlaced) kids.unshift(planEl);             // no user row (a chat recreated after Delete all): first
    for (const q of questions.list()) {
      kids.push(cached(askEls, q.askId, JSON.stringify([q.state, q.buildId, q.heading, q.questions]), () => buildQuestion(q), seenAsks));
    }
    prune(cardEls, seenCards);
    prune(askEls, seenAsks);
    prune(replyEls, seenReplies);
    const feed = buildFeed();
    if (feed) kids.push(feed);
    const waiting = !live && (pending || client.busy());
    placeKids(kids);
    const liveRow = live ? msgs.find((x) => x && x.id === live.messageId) : null;
    paintActivity(live, liveRow, waiting);
    if (focused && focused.isConnected) { if (doc.activeElement !== focused) focused.focus({ preventScroll: true }); }
    else if (focused) input.focus({ preventScroll: true });
    followEnd();
    announce(msgs, finishedId);
  }
  /** kind 'frame' (an Ask frame) may take render()'s text-only path; anything else repaints the thread. */
  function schedule(kind = 'structure') {
    if (destroyed) return;
    if (kind !== 'frame') queuedFull = true;
    if (queued) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; const full = queuedFull; queuedFull = false; render(full); });
  }

  paintPoint();
  paintFast();
  paintPins();
  render();
  void pills.load();
  void loadPics();
  (async () => {
    let body = null;
    try {
      const r = await fetchFn(LIMITS_URL);
      body = r.ok ? await readJson(r) : null;
    } catch {
      body = null;
    }
    const got = limitsOf(body);
    if (destroyed || !got) return;
    limits = got;
    paintFast();
  })();
  client.open().then(() => {
    if (destroyed || !initial || typeof initial.text !== 'string' || !initial.text.trim()) return;
    input.value = initial.text;
    const files = Array.isArray(initial.files) ? initial.files : [];
    pendingFiles = [...pendingFiles, ...files.filter((f) => f && typeof f.name === 'string' && typeof f.dataBase64 === 'string')];
    renderFiles();
    autosize();
    void send();
  }).catch(() => {});
  return {
    client,
    pushAskFrame(f) { if (!destroyed) client.pushFrame(f); },
    /** C-5 frames of this design: questions, the open build and a new round. Text-only `design-delta` frames change
     *  nothing here; the rest repaint only when they changed what the thread shows (M5). */
    pushDesignFrame(f) {
      if (destroyed || !f || typeof f !== 'object' || f.designId !== designId || f.type === 'design-delta') return;
      const was = frameShown();
      const phaseWas = narration.view().phase;
      questions.push(f);
      narration.push(f);
      if (f.type === 'design-build') onBuildFrame(f);
      else if (f.type === 'design-snapshot') onSnapshotFrame(f);
      // Most of a build's frames (design-agent, -file, -section, -plan, a design-build's stats) change nothing drawn here.
      if (frameShown() !== was) schedule();
      // What the build does right now changes with most agent frames: only the composer's line, never the thread.
      else if (narration.view().phase !== phaseWas) { const m = client.model(); if (!(m && m.live()) && !pending && !client.busy()) paintActivity(null, null, false); }
    },
    addPin,
    onHello() { if (!destroyed) client.onHello(); },
    /** app.js: marked finished loading, so every reply draws its markdown again. */
    repaint: () => { replyEls.clear(); schedule(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      // No focus goes into a dock being taken down.
      if (viewer) viewer.close({ restore: false });
      unsubscribe();
      orbs.destroy();
      pills.destroy();
      settings.destroy();
      root.remove();
    },
  };
}
