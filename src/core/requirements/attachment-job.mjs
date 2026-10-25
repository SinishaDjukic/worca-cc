// src/core/requirements/attachment-job.mjs
// A feature's files and a made brief's documents (plans/requirements-a8-design.md D3–D5, D9–D12): their bodies on disk,
// the one read per file through A1.1's callModel, the queue (MAX_READ_JOBS across every feature and brief), the spend,
// recovery after a restart, the boot sweep and the estimates. A read never throws out: a failure is the file's `failed`
// status, and a read the spending limit stops leaves it `unread-budget`.
// interview.mjs and this module import each other: neither uses the other's bindings at module top level.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
  REQ_ATT_ID_RE, REQ_ATTACH_LIMITS, ATTACHMENT_SYSTEM_PROMPT, buildReadPrompt, normalizeSummary, mockSummary, checkNewFiles, readRule,
} from './attachments.mjs';
import {
  mintAttachmentId, insertAttachment, getAttachment, listAttachments, updateAttachment, addAttachmentCost, deleteAttachmentRow,
  listReadingAttachments, recentReadCosts, appendTurn, addFeatureCost, getFeature, usableBrief,
} from './store.mjs';
import { callModel, interviewModel } from './interview.mjs';

export const MAX_READ_JOBS = 2;
export const READ_TIMEOUT_MS = 180_000;
export const READ_MAX_TURNS = 5;
const DEFAULTS = Object.freeze({
  runClaudeImpl: runClaude, listModels, listProjects, workspaceTarget, budget: () => budgetStatus(),
  onChange: () => {}, onBriefChange: () => {}, mockEnabled: () => mockEnabled({}), readTimeoutMs: READ_TIMEOUT_MS,
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
      try { await runRead(e); } catch (err) { console.error('requirements: a file job failed:', message(err)); }
      finally { running.delete(e.id); settle(e); pump(); }
    })();
  }
}
function settle(e) {
  notifyOwner(e.owner, e.d);
  release(ownerKey(e.owner));
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
 *  call) is discarded as UNCHECKED, its cost still on it. `extra` reaches the prompt (Task 5's question) and cannot
 *  override the file's framing. Throws with `costUsd` (callModel's) and `model` on it. */
async function readCall(e, row, extra = {}) {
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
    const prompt = buildReadPrompt({ ...extra, ...(await promptContext(e.owner, d)), file: row, text: inline ? text : null, dir, path });
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
      if (row.summaryEdited) patch.history = [{ at, by: null, reason: 'read', name: row.name, sha256: row.sha256, summary, edited: false, asks: [] },
        ...row.history].slice(0, REQ_ATTACH_LIMITS.history);
      else patch.summary = summary;
      updateAttachment(row.id, patch);
    }
    bookWrites(e, costUsd, model, 'read', row);
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
        writeFileSync(attachmentFile(p), p.data, { mode: FILE_MODE });   // the uploaded bytes, as they came (D15)
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
  release(ownerKey(owner));
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

/** The median cost of the last 10 finished reads of a kind, in cents; null without any (§5 `estimateUsd`). */
export function readEstimate(kind) {
  const c = recentReadCosts(kind, 10).filter(Number.isFinite).sort((a, b) => a - b);
  if (!c.length) return null;
  const m = c.length >> 1;
  return Math.round((c.length % 2 ? c[m] : (c[m - 1] + c[m]) / 2) * 100) / 100;
}
