// src/core/requirements/attachment-job.mjs
// A feature's files and a made brief's documents (plans/requirements-a8-design.md D3–D5, D9–D12): their bodies on disk,
// the one read per file through A1.1's callModel, the queue (MAX_READ_JOBS across every feature and brief), the spend,
// recovery after a restart, the boot sweep and the estimates. A read never throws out: a failure is the file's `failed`
// status, and a read the spending limit stops leaves it `unread-budget`. And what a start sends to its run (D14).
// interview.mjs and this module import each other: neither uses the other's bindings at module top level.
import { chmodSync, copyFileSync, createReadStream, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tx } from '../db.mjs';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { listModels } from '../config.mjs';
import { budgetStatus, recordRequirementsCostDelta } from '../cost-budget.mjs';
import { worcaHome, listProjects } from '../projects.mjs';
import { workspaceTarget } from '../ask/workflow-deps.mjs';
import { redactAskText } from '../ask/redact.mjs';
import { REQUIREMENTS_READ_DENY_RULES } from '../ask/deny-rules.mjs';
import { extensionForAttachment } from '../ask/attachment-kind.mjs';
import { guardDecisionsCover, toolCalls } from '../file-read-guard.mjs';
import { RequirementsError, clip } from './spec.mjs';
import { RoundError } from './round.mjs';
import {
  REQ_ATT_ID_RE, REQ_ATTACH_LIMITS, ATTACHMENT_SYSTEM_PROMPT, buildReadPrompt, buildAskPrompt, normalizeSummary, mockSummary, checkNewFiles,
  readRule, normalizeAnswer, mockAnswer, pushHistory, selectInlineAttachments, renderAttachmentsForPrompt, renderDocumentsForPrompt, sourceNames, hasText,
  mentions, displayName, uniqueName,
} from './attachments.mjs';
import {
  mintAttachmentId, insertAttachment, getAttachment, listAttachments, updateAttachment, addAttachmentCost, deleteAttachmentRow,
  listReadingAttachments, recentReadCosts, appendTurn, addFeatureCost, getFeature, usableBrief,
} from './store.mjs';
import { callModel, interviewModel, maybeFollowUpFiles } from './interview.mjs';

export const MAX_READ_JOBS = 2;
export const READ_TIMEOUT_MS = 180_000;
export const READ_MAX_TURNS = 5;
const DEFAULTS = Object.freeze({
  runClaudeImpl: runClaude, listModels, listProjects, workspaceTarget, budget: () => budgetStatus(),
  onChange: () => {}, onBriefChange: () => {}, mockEnabled: () => mockEnabled({}), readTimeoutMs: READ_TIMEOUT_MS,
  renameBody: renameSync, copyBody: copyFileSync,   // how a replaced body is put in place (a test makes them fail)
  writeBody: writeFileSync,                         // how an added file's body is written (a test makes it fail)
});
const READING = 'Worca is reading this file.';
// What a failed read stores (D5): product messages only; the raw error goes to the log, with the file's id.
const UNCHECKED = 'Worca stopped this read: it could not confirm the read stayed inside this file. Try again.';
const STORED_FILE = 'Worca could not open the stored file. Remove it and attach it again.';
const TRY_AGAIN = 'Worca could not read it. Try again.';
const FS_CODES = new Set(['ENOENT', 'EEXIST', 'EACCES', 'EBUSY', 'EPERM', 'EISDIR', 'ENOTDIR', 'EMFILE', 'ENFILE', 'ENOSPC', 'EROFS', 'ENAMETOOLONG']);
// Bodies, read folders and copies are the user's alone (POSIX modes; no effect on Windows).
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const message = (err) => (err && err.message ? err.message : String(err));
const iso = () => new Date().toISOString();

// ---------------------------------------------------------------- bodies (D9)

export const attachmentsDir = () => join(worcaHome(), 'requirements', 'att');
const readBase = () => { const d = join(worcaHome(), 'tmp', 'requirements'); mkdirSync(d, { recursive: true, mode: DIR_MODE }); return d; };

/** A body's path, from the store-minted id and the kind's extension only (never the file's name). */
export function attachmentFile(row) {
  if (!row || typeof row.id !== 'string' || !REQ_ATT_ID_RE.test(row.id)) throw new Error('attachmentFile: refusing an id the store never minted');
  return join(attachmentsDir(), `${row.id}${extensionForAttachment(row.kind, row.mime)}`);
}
function removeBody(row) {
  try { rmSync(attachmentFile(row), { force: true }); } catch (e) { console.error('requirements: could not remove a file body:', message(e)); }
}
export function removeOwnerBodies(rows) { for (const r of rows || []) removeBody(r); }

// ---------------------------------------------------------------- owners

const ownerKey = (o) => `${o.type}:${o.id}`;
function notifyOwner(owner, d) {
  try {
    if (owner.type === 'feature') d.onChange(owner.id);
    else if (owner.scopeType) d.onBriefChange(owner.scopeType, owner.scopeKey);
  } catch (e) { console.error('requirements: a file frame failed:', message(e)); }
}

/** The owner's row, or NOT_FOUND (an id of another owner reads as missing). */
export function ownAttachment(owner, id) {
  const row = typeof id === 'string' && REQ_ATT_ID_RE.test(id) ? getAttachment(id) : null;
  if (!row || row.ownerType !== owner.type || row.ownerId !== Number(owner.id)) throw new RequirementsError('NOT_FOUND', 'file not found');
  return row;
}

// ---------------------------------------------------------------- the queue (D5)

const queue = [];          // waiting jobs, in order: { id, name, owner, kind: 'read' | 'ask', question?, by, d }
const running = new Map(); // attachment id → its running job (one per file), with `ctrl` and `cancelled`
const waiters = new Map(); // owner key → readsSettled resolvers

const pendingFor = (key) => queue.some((e) => ownerKey(e.owner) === key) || [...running.values()].some((e) => ownerKey(e.owner) === key);
export const isReading = (id) => queue.some((e) => e.id === id && e.kind === 'read') || running.get(id)?.kind === 'read';
export const isAsking = (id) => queue.some((e) => e.id === id && e.kind === 'ask') || running.get(id)?.kind === 'ask';
/** The question of the file's ask in progress (running, else queued), or null: the page's Asking… line (board 21). */
export function askingQuestion(id) {
  const r = running.get(id);
  if (r && r.kind === 'ask') return r.question;
  const q = queue.find((e) => e.id === id && e.kind === 'ask');
  return q ? q.question : null;
}
/** Whether the owner has a read or ask queued or running (readsSettled waits for none). */
export const filesPending = (owner) => pendingFor(ownerKey(owner));

/** Resolves once the owner has no read or ask queued or running. */
export function readsSettled(owner) {
  const key = ownerKey(owner);
  if (!pendingFor(key)) return Promise.resolve();
  return new Promise((resolve) => { waiters.set(key, [...(waiters.get(key) || []), resolve]); });
}
function release(key) {
  if (pendingFor(key)) return false;
  for (const resolve of waiters.get(key) || []) resolve();
  waiters.delete(key);
  return true;
}

function enqueue(e) { queue.push(e); pump(); }
function pump() {
  while (running.size < MAX_READ_JOBS) {
    const i = queue.findIndex((e) => !running.has(e.id));
    if (i < 0) return;
    const [e] = queue.splice(i, 1);
    e.ctrl = new AbortController();
    running.set(e.id, e);
    void (async () => {
      try { await (e.kind === 'ask' ? runAsk(e) : runRead(e)); } catch (err) { console.error('requirements: a file job failed:', message(err)); }
      finally { running.delete(e.id); settle(e); pump(); }
    })();
  }
}
function settle(e) {
  notifyOwner(e.owner, e.d);
  // D8: the feature has nothing left to read or answer: files added after its interview finished may get their follow-up
  // round (maybeFollowUpFiles is idempotent and never throws, so a read and an ask ending in either order both reach it)
  if (release(ownerKey(e.owner)) && e.owner.type === 'feature') maybeFollowUpFiles(e.owner.id, e.d);
}

/** Drops the queued jobs of these files and stops their running ones (a removed file, a deleted brief, D10). */
export function stopJobs(ids) {
  const set = new Set(ids);
  for (let i = queue.length - 1; i >= 0; i -= 1) if (set.has(queue[i].id)) queue.splice(i, 1);
  for (const id of set) { const j = running.get(id); if (j) { j.cancelled = true; j.ctrl.abort(); } }
}

// ---------------------------------------------------------------- spend (D5)

/** A read's or ask's writes, inside the caller's transaction: a feature file gets its `file` turn (no thread line, §3),
 *  its cost on the feature, the file and the ledger; a document books under the brief (feature_seq 0), never on
 *  req_briefs.cost_usd. */
function bookWrites(e, costUsd, model, action, row) {
  if (e.owner.type === 'feature') {
    const turnId = appendTurn(e.owner.id, { kind: 'file', payload: { action, id: e.id, name: row ? row.name : e.name },
      model: model || null, costUsd: costUsd > 0 ? costUsd : null }, { by: e.by });
    if (!(costUsd > 0)) return;
    addFeatureCost(e.owner.id, costUsd);
    if (row) addAttachmentCost(row.id, costUsd);
    recordRequirementsCostDelta({ featureSeq: e.owner.id, turnId, attachmentId: e.id, amountUsd: costUsd, model: model || null });
    return;
  }
  if (!(costUsd > 0)) return;
  if (row) addAttachmentCost(row.id, costUsd);
  recordRequirementsCostDelta({ briefId: e.owner.id, attachmentId: e.id, amountUsd: costUsd, model: model || null });
}

// ---------------------------------------------------------------- the call (D3)

async function promptContext(owner, d) {
  if (owner.type === 'feature') {
    const f = getFeature(owner.id);
    return { feature: { title: f ? f.title : '', description: f ? f.description : '' } };
  }
  let name = owner.scopeKey || '';
  try {
    if (owner.scopeType === 'project') name = ((await d.listProjects()).find((p) => p && p.key === owner.scopeKey) || {}).name || name;
    else { const ws = await d.workspaceTarget(owner.scopeKey); if (ws && ws.name) name = ws.name; }
  } catch { /* the key */ }
  return { scopeName: name };
}

/** D15: a Read-form call's result counts only when the file-read guard decided every tool call its stream shows
 *  (`guardDecisionsCover` over the normalized events callModel captured). Fail closed: no decision log at all, or a
 *  reply that took more than one turn while the stream shows no tool call, cannot be checked, so it does not count. */
function guardCovered(r) {
  if (!Array.isArray(r.readGuardDecisions)) return false;
  const events = Array.isArray(r.events) ? r.events : [];
  const results = events.filter((x) => x && x.type === 'result');
  if (!results.length) return false;   // a stream without its result was not seen whole
  const turns = results.filter((x) => Number.isFinite(x.numTurns)).map((x) => x.numTurns);
  if (Math.max(0, ...turns) > 1 && toolCalls(events).length === 0) return false;
  return guardDecisionsCover(events, r.readGuardDecisions);
}
/** An inline read has no tools: a tool call on its stream means the call did not run as Worca built it. */
const inlineClean = (r) => toolCalls(Array.isArray(r.events) ? r.events : []).length === 0;
const unchecked = (costUsd) => Object.assign(new Error(UNCHECKED), { code: 'UNCHECKED', costUsd });

/** One read-only call on the file: inline (a text of at most 24 KB, redacted, no tools at all) or opened with Read from a
 *  fresh private folder that holds only its copy (a text file's copy is its redacted text), removed when the call ends,
 *  whatever happens. A result that cannot be checked (a Read-form one the guard did not cover, an inline one with a tool
 *  call) is discarded as UNCHECKED, its cost still on it. With a `question` it is an ask (D12): the same call, its prompt
 *  carrying the row's current summary and the question. Throws with `costUsd` (callModel's) and `model` on it. */
async function readCall(e, row, { question = null } = {}) {
  const d = e.d;
  const im = await interviewModel(d);
  const model = im.model || null;
  const inline = row.kind === 'text' && row.bytes <= REQ_ATTACH_LIMITS.inlineBytes;
  let dir = null;
  try {
    const text = row.kind === 'text' ? redactAskText(readFileSync(attachmentFile(row), 'utf8')) : null;
    let path = null;
    if (!inline) {
      dir = join(readBase(), `att-read-${randomBytes(4).toString('hex')}`);
      mkdirSync(dir, { mode: DIR_MODE });
      path = join(dir, `${row.id}${extensionForAttachment(row.kind, row.mime)}`);
      if (text != null) writeFileSync(path, text, { encoding: 'utf8', mode: FILE_MODE });
      else { copyFileSync(attachmentFile(row), path); chmodSync(path, FILE_MODE); }
    }
    const framing = { ...(await promptContext(e.owner, d)), file: row, text: inline ? text : null, dir, path };
    const prompt = question != null ? buildAskPrompt({ ...framing, summary: row.summary, question }) : buildReadPrompt(framing);
    // D3, D15: every read carries Ask's deny rules; a Read-form read also the file-read guard, which lets Read open the
    // copy and nothing else (the allow rule is intent: the engine reads unmatched paths).
    const deny = { deny: [...REQUIREMENTS_READ_DENY_RULES] };
    const call = inline ? { kind: 'round', cwd: readBase(), prompt, tools: [], permissionRules: deny }
      : { kind: 'look', cwd: dir, prompt, tools: ['Read'], allowedTools: [readRule(path)], maxTurns: READ_MAX_TURNS, permissionRules: deny, readGuard: path };
    const r = await callModel(d, { ...call, model: model || undefined, ...(im.effort ? { effort: im.effort } : {}),
      systemPrompt: ATTACHMENT_SYSTEM_PROMPT, timeoutMs: d.readTimeoutMs, signal: e.ctrl.signal });
    const costUsd = Number(r.costUsd) || 0;
    if (inline ? !inlineClean(r) : !guardCovered(r)) throw unchecked(costUsd);
    return { text: r.text, costUsd, model };
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { model });
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch (x) { console.error('requirements: could not remove a read folder:', message(x)); } }
  }
}

/** What a failed read stores: Worca's own codes and messages only (UNCHECKED, TIMEOUT, BAD_REPLY with the reply check's
 *  reason); anything else is FAILED with a product message, an fs error naming the stored file. Never raw error text. */
function failureOf(err) {
  if (err instanceof RoundError) return { code: 'BAD_REPLY', message: `Worca's reply could not be read (${message(err)}).` };
  if (err && err.code === 'UNCHECKED') return { code: 'UNCHECKED', message: UNCHECKED };
  if (err && err.code === 'TIMEOUT') return { code: 'TIMEOUT', message: message(err) };   // callModel's own words
  const fs = !!err && (typeof err.syscall === 'string' || FS_CODES.has(err.code));
  return { code: 'FAILED', message: fs ? STORED_FILE : TRY_AGAIN };
}

async function runRead(e) {
  await null;
  const row = getAttachment(e.id);
  if (!row || row.status !== 'reading') return;
  const d = e.d;
  let cost = 0;
  let model = null;
  try {
    const b = d.budget();
    if (b && b.blocked) { updateAttachment(row.id, { status: 'unread-budget' }); return; }   // D5: not an error; nothing spent
    if (d.mockEnabled()) {
      const ms = Number(process.env.WORCA_MOCK_READ_MS) || 0;   // the browser proof sees "Reading N files…" (D17)
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      finishRead(e, { summary: mockSummary(row.name), costUsd: 0, model: null });
      return;
    }
    const r = await readCall(e, row);
    cost = r.costUsd;
    model = r.model;
    if (e.cancelled) { tx(() => bookWrites(e, cost, model, 'read', null)); return; }
    finishRead(e, { summary: normalizeSummary(r.text), costUsd: cost, model });
  } catch (err) {
    cost = cost || Number(err?.costUsd) || 0;
    model = model || err?.model || null;
    const now = getAttachment(e.id);
    const failure = failureOf(err);
    if (failure.code === 'FAILED') console.error(`requirements: reading file ${e.id} failed:`, message(err));
    tx(() => {
      if (now && !e.cancelled) updateAttachment(now.id, { status: 'failed', error: { ...failure, at: iso() } });
      bookWrites(e, cost, model, 'read', e.cancelled ? null : now);
    });
  }
}

/** D4: a read writes the summary, unless the product owner's text stands: then its summary goes to the history. */
function finishRead(e, { summary, costUsd, model }) {
  const row = getAttachment(e.id);
  const at = iso();
  tx(() => {
    if (row) {
      const patch = { status: 'done', error: null, readCostUsd: costUsd > 0 ? costUsd : null, readModel: model, readAt: at };
      if (row.summaryEdited) patch.history = pushHistory(row.history, { at, by: null, reason: 'read', name: row.name, sha256: row.sha256, summary, edited: false, asks: [] });
      else patch.summary = summary;
      updateAttachment(row.id, patch);
    }
    bookWrites(e, costUsd, model, 'read', row);
  });
}

// ---------------------------------------------------------------- the ask (D12)

async function runAsk(e) {
  await null;
  const row = getAttachment(e.id);
  if (!row) return;
  const d = e.d;
  let cost = 0;
  let model = null;
  try {
    const b = d.budget();   // again before the call (D12): a limit reached since the press fails the ask, nothing spent
    if (b && b.blocked) { failAsk(e, { code: 'BUDGET', message: budgetMessage(b) }, 0, null, { book: false }); return; }   // like a read: no turn
    if (d.mockEnabled()) {
      const ms = Number(process.env.WORCA_MOCK_READ_MS) || 0;   // the browser proof sees "Asking…" too (D17)
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      if (e.cancelled) return;
      finishAsk(e, { answer: mockAnswer(e.question), costUsd: 0, model: null });
      return;
    }
    const r = await readCall(e, row, { question: e.question });
    cost = r.costUsd;
    model = r.model;
    if (e.cancelled) { tx(() => bookWrites(e, cost, model, 'asked', null)); return; }
    finishAsk(e, { answer: normalizeAnswer(r.text), costUsd: cost, model });
  } catch (err) {
    const failure = failureOf(err);
    if (failure.code === 'FAILED') console.error(`requirements: asking about file ${e.id} failed:`, message(err));
    failAsk(e, failure, cost || Number(err?.costUsd) || 0, model || err?.model || null);
  }
}

// The row's `error` is a failed read's (no `job`) or the last failed ask's (`job: 'ask'`). An ask touches only its own:
// a failed read's error stays until the file is read again.
const askError = (row) => !row.error || row.error.job === 'ask';

function failAsk(e, failure, costUsd, model, { book = true } = {}) {
  tx(() => {
    const now = e.cancelled ? null : getAttachment(e.id);
    if (now && askError(now)) updateAttachment(now.id, { error: { ...failure, at: iso(), job: 'ask', question: e.question } });
    if (book) bookWrites(e, costUsd, model, 'asked', now);
  });
}

/** The answer under the summary, labelled with its question, apart from the summary (`asks`), so a read never overwrites it. */
function finishAsk(e, { answer, costUsd, model }) {
  tx(() => {
    const row = getAttachment(e.id);
    if (row) {
      updateAttachment(row.id, { ...(row.error && askError(row) ? { error: null } : {}),
        asks: [...row.asks, { question: e.question, answer, by: e.by, at: iso(), costUsd }] });
    }
    bookWrites(e, costUsd, model, 'asked', row);
  });
}

// ---------------------------------------------------------------- the product owner's actions

/** Stores new files (each body first, then its row and, for a feature, its `added` turn) and queues their reads.
 *  `files` are validateAttachmentUploads' files: `{ name, kind, mime, data, bytes, sha256 }`. */
export function addAttachments(owner, files, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const planned = checkNewFiles(owner.type, listAttachments(owner.type, owner.id), files).map((f) => ({ ...f, id: mintAttachmentId() }));
  mkdirSync(attachmentsDir(), { recursive: true, mode: DIR_MODE });
  const rows = [];
  try {
    for (const p of planned) {
      let row;
      try {
        d.writeBody(attachmentFile(p), p.data, { mode: FILE_MODE });   // the uploaded bytes, as they came (D15)
        row = tx(() => {
          const r = insertAttachment({ id: p.id, ownerType: owner.type, ownerId: owner.id, name: p.name, kind: p.kind, mime: p.mime,
            bytes: p.bytes, sha256: p.sha256 }, { by });
          if (owner.type === 'feature') appendTurn(owner.id, { kind: 'file', payload: { action: 'added', id: p.id, name: p.name } }, { by });
          return r;
        });
      } catch (err) { removeBody(p); throw err; }
      rows.push(row);
      // Queued as soon as its row is stored, so a later file's failure leaves no row `reading` with no read behind it.
      enqueue({ id: row.id, name: row.name, owner, kind: 'read', by, d });
    }
  } finally {
    if (rows.length) notifyOwner(owner, d);
  }
  return rows;
}

/** Removes a file: its read stops, the row goes (with a feature's `removed` turn), then the body. */
export function removeAttachment(owner, id, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const row = ownAttachment(owner, id);
  stopJobs([row.id]);
  tx(() => {
    deleteAttachmentRow(row.id);
    if (owner.type === 'feature') appendTurn(owner.id, { kind: 'file', payload: { action: 'removed', id: row.id, name: row.name } }, { by });
  });
  removeBody(row);
  if (release(ownerKey(owner)) && owner.type === 'feature') maybeFollowUpFiles(owner.id, d);   // D8, as settle
  notifyOwner(owner, d);
  return row;
}

/** The product owner's "What Worca took from it" (D4): ground truth, at most 1500 characters, marked edited. */
export function editSummary(owner, id, summary, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const row = ownAttachment(owner, id);
  if (row.status === 'reading' || isReading(row.id)) throw new RequirementsError('CONFLICT', READING);
  const text = clip(summary, REQ_ATTACH_LIMITS.summary);
  if (!text) throw new RequirementsError('BAD_REQUEST', 'What Worca took from it cannot be empty.');
  const out = tx(() => {
    if (owner.type === 'feature') appendTurn(owner.id, { kind: 'file', payload: { action: 'edited', id: row.id, name: row.name } }, { by });
    return updateAttachment(row.id, { summary: text, summaryEdited: true }, { by });
  });
  notifyOwner(owner, d);
  return out;
}

/** Send with the run (a feature file) / Send with every run (a document) (D1). */
export function setSend(owner, id, on, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const row = ownAttachment(owner, id);
  const out = updateAttachment(row.id, { sendWithRun: !!on }, { by });
  notifyOwner(owner, d);
  return out;
}

const ASKING = 'Worca is already answering a question about this file.';
// A replace whose new body could not be put in place: the row (code STORE_FAILED) describes a version that has no body on
// disk, so only Replace mends it; a download of such a row finds no body and answers 404 (D10's route).
const STORE_FAILED = 'Worca could not store the new version. Replace it again.';
const READ_FIRST = 'Read it again first: Worca could not read this file.';
const storeFailed = (row) => row.status === 'failed' && row.error?.code === 'STORE_FAILED';
const budgetMessage = (b) => `The spending limit${b && b.totalLimitUsd != null ? ` of $${b.totalLimitUsd}` : ''} is reached for this period. Worca can read the file when the limit resets or is raised.`;
/** One job per file: no replace, ask or read again while the file is read or a question about it is answered. */
function notIdle(row) {
  if (row.status === 'reading' || isReading(row.id)) throw new RequirementsError('CONFLICT', READING);
  if (isAsking(row.id)) throw new RequirementsError('CONFLICT', ASKING);
}

/** Read again, and Try again (D11): the current text goes to the history first (D4) and an edited mark is cleared; the
 *  answers stay. */
export function readAgain(owner, id, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const row = ownAttachment(owner, id);
  notIdle(row);
  if (storeFailed(row)) throw new RequirementsError('CONFLICT', STORE_FAILED);
  const patch = { status: 'reading', error: null };
  if (row.summary) {
    patch.history = pushHistory(row.history, { at: iso(), by, reason: 'read-again', name: row.name, sha256: row.sha256, summary: row.summary,
      edited: row.summaryEdited, asks: [] });
  }
  if (row.summaryEdited) patch.summaryEdited = false;
  const out = updateAttachment(row.id, patch, { by });
  enqueue({ id: row.id, name: row.name, owner, kind: 'read', by, d });
  notifyOwner(owner, d);
  return out;
}

/** Ask about this file (D12): one question per file at a time, at most 20 answers, the budget checked at the press. */
export function askAttachment(owner, id, question, { by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const row = ownAttachment(owner, id);
  const q = typeof question === 'string' ? question.trim().replace(/\s+/g, ' ') : '';
  if (!q || q.length > REQ_ATTACH_LIMITS.question) throw new RequirementsError('BAD_REQUEST', `the question must be 1 to ${REQ_ATTACH_LIMITS.question} characters`);
  notIdle(row);
  if (storeFailed(row)) throw new RequirementsError('CONFLICT', STORE_FAILED);
  if (row.status === 'failed' && !(row.error && row.error.job === 'ask')) throw new RequirementsError('CONFLICT', READ_FIRST);
  if (row.asks.length >= REQ_ATTACH_LIMITS.asks) throw new RequirementsError('CONFLICT', `This file has ${REQ_ATTACH_LIMITS.asks} answers already.`);
  let b;
  try { b = d.budget(); } catch (err) {
    // A budget that cannot be read is a failed ask, never a raw error: nothing is queued or spent.
    console.error(`requirements: the budget check for an ask about file ${row.id} failed:`, message(err));
    const out = updateAttachment(row.id, { error: { code: 'FAILED', message: TRY_AGAIN, at: iso(), job: 'ask', question: q } }, { by });
    notifyOwner(owner, d);
    return out;
  }
  if (b && b.blocked) throw new RequirementsError('BUDGET', budgetMessage(b));
  enqueue({ id: row.id, name: row.name, owner, kind: 'ask', question: q, by, d });
  notifyOwner(owner, d);
  return row;
}

/** The new body into place after its row committed: a rename, else once more as a copy (Windows refuses a rename onto a
 *  file another reader holds open for a moment); else the file is failed, so the page offers Replace again. The temp
 *  file goes on every path. */
function storeBody(temp, target, id, d) {
  try { d.renameBody(temp, target); return true; } catch { /* once more as a copy */ }
  try {
    d.copyBody(temp, target);
    return true;
  } catch (err) {
    console.error(`requirements: could not store the new version of file ${id}:`, message(err));
  } finally {
    try { rmSync(temp, { force: true }); } catch (x) { console.error('requirements: could not remove a temp body:', message(x)); }
  }
  // Whatever stands at the target (the old body under the same extension, or a part of the copy) is not this version.
  try { rmSync(target, { force: true }); } catch (x) { console.error(`requirements: could not remove the stale body of file ${id}:`, message(x)); }
  try { updateAttachment(id, { status: 'failed', error: { code: 'STORE_FAILED', message: STORE_FAILED, at: iso() } }); } catch (x) {
    console.error('requirements: could not mark a replaced file failed:', message(x));
  }
  return false;
}

/** Replace with a newer version (D11): a new body under the same id; the switch stays; the answers move to the old
 *  version's history entry; the summary is written again unless `keepSummary` keeps the product owner's text (the new
 *  read's then goes to the history, D4); the file is read again. */
export function replaceAttachment(owner, id, upload, { keepSummary = false, by = null } = {}, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const row = ownAttachment(owner, id);
  notIdle(row);
  if (upload && upload.sha256 === row.sha256 && !storeFailed(row)) throw new RequirementsError('CONFLICT', `This is the same version as ${row.name}.`);
  const [next] = checkNewFiles(owner.type, listAttachments(owner.type, owner.id).filter((r) => r.id !== row.id), [upload]);
  const keep = !!keepSummary && row.summaryEdited;
  const history = pushHistory(row.history, { at: iso(), by, reason: 'replaced', name: row.name, sha256: row.sha256,
    summary: row.summary, edited: row.summaryEdited, asks: row.asks });
  const oldFile = attachmentFile(row);
  const newFile = attachmentFile({ id: row.id, kind: next.kind, mime: next.mime });
  // The new body goes to a temp file first and replaces the live one only after the row commits: a failed transaction
  // leaves the old body and row as they were, and a download in flight never reads a half-written body (D9, D10).
  mkdirSync(attachmentsDir(), { recursive: true, mode: DIR_MODE });
  const temp = `${newFile}.tmp-${randomBytes(4).toString('hex')}`;
  let out;
  try {
    writeFileSync(temp, next.data, { mode: FILE_MODE });
    out = tx(() => updateAttachment(row.id, { name: next.name, kind: next.kind, mime: next.mime, bytes: next.bytes, sha256: next.sha256,
        status: 'reading', error: null, summary: keep ? row.summary : '', summaryEdited: keep, asks: [], history,
        readCostUsd: null, readModel: null, readAt: null }, { by }));
  } catch (err) {
    try { rmSync(temp, { force: true }); } catch (x) { console.error('requirements: could not remove a temp body:', message(x)); }
    throw err;
  }
  const stored = storeBody(temp, newFile, row.id, d);
  if (newFile !== oldFile) { try { rmSync(oldFile, { force: true }); } catch (x) { console.error('requirements: could not remove an old body:', message(x)); } }
  if (stored) {
    // The thread's "replaced" line only for a version that is in place; the replace stands even if the line cannot be written.
    if (owner.type === 'feature') {
      try { appendTurn(owner.id, { kind: 'file', payload: { action: 'replaced', id: row.id, name: next.name, before: row.name } }, { by }); } catch (x) {
        console.error(`requirements: could not record the replace of file ${row.id}:`, message(x));
      }
    }
    enqueue({ id: row.id, name: next.name, owner, kind: 'read', by, d });
  }
  notifyOwner(owner, d);
  return stored ? out : getAttachment(row.id);
}

/** D5: when the budget allows, the feature's files and its scope's documents a limit stopped are read again. The budget
 *  is read only when such a file is waiting, so a round without one makes no extra budget call. */
export function queueUnread(seq, deps = {}) {
  const d = { ...DEFAULTS, ...deps };
  const f = getFeature(seq);
  if (!f) return 0;
  const brief = usableBrief(f.scopeType, f.scopeKey);
  const groups = [[{ type: 'feature', id: f.seq }, listAttachments('feature', f.seq)]];
  if (brief) groups.push([{ type: 'brief', id: brief.id, scopeType: brief.scopeType, scopeKey: brief.scopeKey }, listAttachments('brief', brief.id)]);
  const waiting = groups.flatMap(([owner, rows]) => rows.filter((r) => r.status === 'unread-budget' && !isReading(r.id)).map((r) => [owner, r]));
  if (!waiting.length) return 0;
  const b = d.budget();
  if (b && b.blocked) return 0;
  for (const [owner, r] of waiting) {
    updateAttachment(r.id, { status: 'reading' });
    enqueue({ id: r.id, name: r.name, owner, kind: 'read', by: null, d });
  }
  return waiting.length;
}

// ---------------------------------------------------------------- the run hand-off (D14)

/** D14: what a start sends: the feature's files with Send with the run on, then the documents of the scope's made brief
 *  with Send with every run on, each with its body's path. `bytes` and `stored` (the row describes a body on disk: not a
 *  replace whose new version could not be stored) are for unsendableRunFile. */
export function runFiles(f) {
  const brief = usableBrief(f.scopeType, f.scopeKey);
  const pick = (rows, from) => rows.filter((r) => r.sendWithRun).map((r) => ({ id: r.id, name: r.name, sha256: r.sha256, from,
    path: attachmentFile(r), bytes: r.bytes, stored: !storeFailed(r) }));
  return [...pick(listAttachments('feature', f.seq), 'feature'), ...(brief ? pick(listAttachments('brief', brief.id), 'brief') : [])];
}

/** D14: the first of runFiles' list that cannot go with the run, else null: a version Worca could not store, or a body
 *  that is missing or not the row's size. A file whose read failed, or that the budget stopped, still goes (D1). The
 *  staging then checks every copy against its sha256. */
export function unsendableRunFile(list) {
  return (list || []).find((x) => {
    if (!x.stored) return true;
    try { const st = statSync(x.path); return !st.isFile() || st.size !== x.bytes; } catch { return true; }
  }) || null;
}

const sha256OfFile = (path) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(path).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
});

/** D14: what a start answers for a switched-on file whose stored body Worca cannot open (or that is not its version). */
export const cannotGoWithRun = (name) => `${name} cannot go with the run: Worca could not open the stored file. Replace it, or leave it out of the run.`;

/** D14: a staged copy's file name, from the display name: safe on Windows (`: * ? " < > |` become `_`, trailing dots
 *  and spaces go, a device name such as CON gets a leading `_`). Only the copy is named so; the start row keeps the
 *  display name. */
export function stagedName(name) {
  let s = displayName(name).replace(/[:*?"<>|]/g, '_').replace(/[. ]+$/, '');
  if (!s) s = 'file';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(s)) s = `_${s}`;
  return s;
}

/** Whether the row a staged copy came from still stands as the start chose it (same id, same sha256): then a copy that
 *  failed or does not match is the stored body's fault, not a change made during the start. */
function rowAsChosen(f) {
  if (!f.id || !f.sha256) return false;
  try { const row = getAttachment(f.id); return !!row && row.sha256 === f.sha256; } catch { return false; }
}

/** D14: a start's files copied into the run's extras folder (writeExtras' orchestrator-extras-<runId>, which
 *  createPipeline copies into <pipeline>/extras by base name), each under its stagedName; a name already used in that
 *  run gets " (2)", so no file overwrites another. An entry's `sha256`, when given, is checked against its copy, so the
 *  run gets exactly the version the start chose. `start(paths, { drop })` runs the start (`drop` removes the folder, for
 *  the caller to call once the run has its own copy); a refused start (not 2xx) or a throw removes the folder again, so
 *  nothing is left in the temp dir. A copy that fails or does not match answers 409 naming the file, never its path, and
 *  the start never runs: "changed while the run started" when its row was removed or replaced meanwhile (a brief
 *  document's routes do not wait for a start), else cannotGoWithRun (the stored body itself is damaged). */
export async function withStagedRunFiles(runId, list, start, { base = tmpdir() } = {}) {
  const dir = join(base, `orchestrator-extras-${runId}`);
  const drop = () => rm(dir, { recursive: true, force: true }).catch((e) => console.error(`requirements: could not remove the staged files of run ${runId}:`, message(e)));
  try { await mkdir(dir, { recursive: true, mode: DIR_MODE }); } catch (err) {
    console.error(`requirements: could not stage the files of run ${runId}:`, message(err));
    await drop();
    return { status: 500, body: { error: 'Worca could not finish that. Try again.' } };
  }
  const taken = [];
  const paths = [];
  for (const f of list) {
    const name = uniqueName(stagedName(f.name), taken);   // unique after the mapping: "notes.md." and "notes.md" differ
    taken.push(name);
    const dest = join(dir, name);
    try {
      await copyFile(f.path, dest);   // async: up to 10 × 25 MB plus documents, off the request's thread
      if (f.sha256 && (await sha256OfFile(dest)) !== f.sha256) throw new Error('the copy is not the version the start chose');
    } catch (err) {
      console.error(`requirements: a file of run ${runId} could not be staged:`, message(err));
      await drop();
      const shown = displayName(f.name);
      return { status: 409, body: { error: rowAsChosen(f) ? cannotGoWithRun(shown)
        : `${shown} could not be sent with the run: it changed while the run started. Try again.` } };
    }
    paths.push(dest);
  }
  let out;
  try { out = await start(paths, { drop }); } catch (err) { await drop(); throw err; }
  const status = Number(out && out.status);
  if (!(status >= 200 && status <= 299)) await drop();
  return out;
}

// ---------------------------------------------------------------- the prompts (D6)

/** What a round's prompt carries of the files (D6): the feature's <attachments> text (null without files), the scope's
 *  documents for <product_brief> ('' without any), the names a reply may give as a source, and the rows. `carried` (D8):
 *  the ids of the files whose text the prompt carried (a summary it shows, or their full text). */
export function promptFiles(f) {
  const rows = listAttachments('feature', f.seq);
  const brief = usableBrief(f.scopeType, f.scopeKey);
  const docs = brief ? listAttachments('brief', brief.id) : [];
  const texts = selectInlineAttachments(rows, (r) => { try { return redactAskText(readFileSync(attachmentFile(r), 'utf8')); } catch { return null; } });
  return { rows, docs, attachments: rows.length ? renderAttachmentsForPrompt(rows, { texts }) : null,
    documents: docs.length ? renderDocumentsForPrompt(docs) : '', sources: sourceNames(rows, docs),
    carried: rows.filter((r) => hasText(r) || texts.has(r.id)).map((r) => r.id) };   // the same test the render uses
}

// ---------------------------------------------------------------- boot, estimates

/** D5: a file left `reading` by a restart, whose read is not queued or running, fails with INTERRUPTED (Try again). */
export function recoverAttachmentReads() {
  let n = 0;
  for (const r of listReadingAttachments()) {
    if (isReading(r.id)) continue;
    updateAttachment(r.id, { status: 'failed', error: { code: 'INTERRUPTED', message: 'Worca restarted before it finished reading this file.', at: iso() } });
    n += 1;
  }
  return n;
}

/** D5: read folders a restart left behind, older than an hour. */
export function sweepReadFolders(base = join(worcaHome(), 'tmp', 'requirements'), { olderThanMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  const out = { removed: [], failed: [] };
  let names = [];
  try { names = readdirSync(base); } catch { return out; }
  for (const n of names) {
    if (!/^att-read-[0-9a-f]{8}$/.test(n)) continue;
    const p = join(base, n);
    try {
      if (now - statSync(p).mtimeMs < olderThanMs) continue;
      rmSync(p, { recursive: true, force: true });
      out.removed.push(p);
    } catch { out.failed.push(p); }
  }
  return out;
}

/** D9: temp bodies a crash left between a replace's write and its rename, older than an hour. */
export function sweepTempBodies(dir = attachmentsDir(), { olderThanMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  const out = { removed: [], failed: [] };
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (!/^ratt_[0-9a-f]{12}\.[a-z0-9]+\.tmp-[0-9a-f]{8}$/.test(n)) continue;
    const p = join(dir, n);
    try {
      if (now - statSync(p).mtimeMs < olderThanMs) continue;
      rmSync(p, { force: true });
      out.removed.push(p);
    } catch { out.failed.push(p); }
  }
  return out;
}

/** The median cost of the last 10 finished reads of a kind, in cents; null without any (§5 `estimateUsd`). */
export function readEstimate(kind) {
  const c = recentReadCosts(kind, 10).filter(Number.isFinite).sort((a, b) => a - b);
  if (!c.length) return null;
  const m = c.length >> 1;
  return Math.round((c.length % 2 ? c[m] : (c[m - 1] + c[m]) / 2) * 100) / 100;
}

/** The three kinds' estimates, read once per view (§5 `estimateUsd`; the list's `readEstimates`). */
export const readEstimates = () => ({ text: readEstimate('text'), image: readEstimate('image'), binary: readEstimate('binary') });

/** A file as the page shows it (§5): a feature file carries `sendWithRun`, a document `sendWithEveryRun`. `estimates` is
 *  readEstimates() read once by the caller (else each file reads its kind's). */
export function fileView(row, { spec = null, href, doc = false, estimates = null } = {}) {
  return {
    id: row.id, name: row.name, kind: row.kind, mime: row.mime, bytes: row.bytes, status: row.status, error: row.error,
    summary: row.summary, summaryEdited: row.summaryEdited, asks: row.asks, history: row.history,
    [doc ? 'sendWithEveryRun' : 'sendWithRun']: row.sendWithRun, costUsd: row.costUsd, readAt: row.readAt, readModel: row.readModel,
    estimateUsd: estimates ? (estimates[row.kind] ?? null) : readEstimate(row.kind), mentions: spec ? mentions(spec, row.name) : [], href,
    asking: askingQuestion(row.id),
  };
}
