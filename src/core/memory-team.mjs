// src/core/memory-team.mjs
// Team memory, phases 1a and 1b (plans/team-memory-design.md; §4: the seeding, holds, Undo). An opted-in project's
// PROJECT-scope notes are shared through the `worca-memory` branch of the project's own repo, one file per note under
// `.worca-memory/notes/`. Layers, the more specific winning a name clash: local (memory-store.mjs) > team (here) > repo
// (phase 2). Global memory never leaves the machine. Off — the default — is exactly the behaviour before this module:
// nothing here fetches, mounts or pushes.
// The branch machinery (one-ref fetch, detached worktree, cross-process lock, push-with-retry, orphan commit, worca's
// own credential, hooks off) is metrics/sync.mjs's — reused, not copied. Every path is computed per call: ui/server.mjs
// imports this module, and its test files import the server before WORCA_HOME is set.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, mkdir, rm, rename, link, lstat, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { worcaHome, listProjects, getProjectByPath } from './projects.mjs';
import { gitState } from './git-available.mjs';
import { listRemotes } from './git-info.mjs';
import { PROJECT_KEY_RE } from './store.mjs';
import { memoryCaps, teamMemoryEnabled, teamMemoryLoad } from './settings.mjs';
import './settings-cascade.mjs';   // side effect: installs the project-layer reader teamMemoryEnabled and memoryCaps consult
import {
  memoryRoot, projectScope, scopeDir, listMemory, readMemory, writeMemory, removeMemory, setMemoryExtra, snapshotScope, isHeldSource,
  listSnapshots, SNAPSHOT_KEEP, parseMemoryFile, renderMemoryFile, repairMemoryFile, hashText, isValidMemoryName, flattenLine,
  TEAM_MARKER_KEY, MemoryError,
} from './memory-store.mjs';
import { withStoreLock } from './memory-sync.mjs';
import {
  runGit, orphanCommit, identityArgs, gitUserName, isNonFastForward, pushHint, MISSING_REMOTE_REF,
  withQueuedLock, fetchTeamBranch, ensureBranchWorktree, removeWorktreeDir, commitToTeamBranch,
} from './metrics/sync.mjs';
import { scanSecrets, describeFindings } from './secret-scan.mjs';
import { writeJsonAtomic } from './json-atomic.mjs';

export const TEAM_MEMORY_BRANCH = 'worca-memory';
export const TEAM_MEMORY_DIR = '.worca-memory';
export const TEAM_NOTES_REL = `${TEAM_MEMORY_DIR}/notes`;   // posix on purpose: also the git pathspec
const TEAM_REMOTE_REF = `refs/remotes/origin/${TEAM_MEMORY_BRANCH}`;
/** The frontmatter key of a tracked copy, `team: <contentHash at its last sync>` (memory-store keeps it in `extra`). */
export { TEAM_MARKER_KEY };
export const TEAM_FETCH_TTL_MS = 5 * 60_000;     // a run start or a chat turn refetches at most this often
export const TEAM_MOUNT_WAIT_MS = 15_000;        // the longest a run start waits for that fetch
export const TEAM_TICK_MS = 30 * 60_000;         // the server's background flush + refresh
const MAX_TEAM_FILE_BYTES = 256 * 1024;          // a hand-pushed giant never stalls a mount (the store's own hard cap is 32 KiB)
const MAX_TEAM_READ_FILES = 2000;                // team.json stays bounded whatever a branch holds: notes read per fetch…
const MAX_TEAM_READ_BYTES = 16 * 1024 * 1024;    // …and their bytes in all
const README_TEXT = `# ${TEAM_MEMORY_BRANCH}\n\nThis branch is written by Worca team memory. Each file under \`${TEAM_NOTES_REL}/\` is one note that an agent or a teammate saved for this repository. Worca shares only the notes of developers who switched team memory on for this project, after a secret check. Do not edit it by hand and do not merge it into other branches; a note's history is this branch's git history.\n`;
const PROTECTION_HINT = `exempt \`${TEAM_MEMORY_BRANCH}\` from branch protection in the repository rules — Worca pushes to it directly, without a pull request`;

export const teamMemoryEvents = new EventEmitter();
const emit = (projectKey, action, extra = {}) => teamMemoryEvents.emit('changed', { projectKey, action, ...extra });

// ── paths: <worcaHome>/team-memory/{projects/<key>/…, locks/<key>.lock, offers/<key>.json} ───
export function teamMemoryRoot() { return join(worcaHome(), 'team-memory'); }
const keyDir = (key) => join(teamMemoryRoot(), 'projects', key);
const snapshotFile = (key) => join(keyDir(key), 'team.json');
const syncFile = (key) => join(keyDir(key), 'sync.json');
const outboxDir = (key) => join(keyDir(key), 'outbox');
const inflightDir = (key) => join(keyDir(key), 'inflight');
const statusDir = (key) => join(keyDir(key), 'status');
const worktreeDir = (key) => join(keyDir(key), 'worktree');
// Beside, not inside, the project dir: discardTeamState removes that dir while it holds this lock.
const lockFile = (key) => join(teamMemoryRoot(), 'locks', `${key}.lock`);
// 1b: the seeding offer, once per project on this machine (Q&A seed-offer) — beside projects/, so a switch-off keeps it.
const offerFile = (key) => join(teamMemoryRoot(), 'offers', `${key}.json`);
// 1b: the last seeding, for its Undo — the decided notes' texts as they were, so Undo never depends on the 20-snapshot
// ring (every write takes one). Inside projects/<key>: a switch-off drops it with the records it would restore.
const seedFile = (key) => join(keyDir(key), 'seed.json');

const isKey = (key) => typeof key === 'string' && PROJECT_KEY_RE.test(key);
/** On for this project key — the settings cascade's project layer, `memory.team`. */
export function isTeamMemoryOn(projectKey) { return isKey(projectKey) && teamMemoryEnabled({ projectKey }); }
/** What a run or chat loads of this project: 'local' (off), 'both' or 'team' (team-memory-load-choice.md). */
export function teamMemoryLoadOf(projectKey) { return isKey(projectKey) ? teamMemoryLoad({ projectKey }) : 'local'; }

function teamError(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
/** A note name indexes an OWN key or nothing: `constructor`, `toString` and `__proto__` are valid note names, never a
 *  member the map inherits. The maps built here (readTeamNotes, readStatuses) have no prototype; a re-parsed team.json does. */
const byName = (map, name) => (map && Object.hasOwn(map, name) ? map[name] : null);
const firstLine = (s) => String(s || '').trim().split('\n').find(Boolean) || '';
async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }
async function jsonFiles(dir) {
  try { return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name); }
  catch { return []; }
}

// ── a note's team form ────────────────────────────────────────────────────────────────────────
/** A note's CONTENT identity across machines — what tracking compares and the gate checked. The local-only fields
 *  (`source`, `updated`, the marker, other extras) are not in it, so a re-stamp never reads as an edit. */
export function contentHash(meta, body) {
  return hashText(JSON.stringify([String(meta?.name || ''), String(meta?.description || ''), (meta?.paths || []).join(', '), String(body ?? '').replace(/\s+$/, '')]));
}
/** The file a note becomes on the branch: content fields + `updated`, + `author` at push time. Never `source` (a local
 *  run or chat id) and never this machine's extras (the marker among them). */
export function teamNoteText(meta, body, { author = null } = {}) {
  return renderMemoryFile({ name: meta.name, description: meta.description, paths: meta.paths, source: '', updated: meta.updated, extra: author ? { author } : {} }, body);
}
/** A client's text for a store write of note `name`, carrying THIS machine's tracked-copy marker (`marker`: the stored
 *  copy's, null for none) in place of whatever the text says — the marker is worca's state, never a client's (D10):
 *  the Memory page reloads a note right after its Save, before the push marks it, and a run's writable copy keeps the
 *  line it had at mount time. One exception (`ownPush`: whether this machine pushed the stored marker's version): a
 *  client holding an unedited synced version — its content IS its own marker — that a FOLLOW has replaced since keeps
 *  that marker. It never saw the teammate's version (the follow ran in another process: the page got no frame), so
 *  saved as it is it is no change and follows the team again, never a push over that version (D13). Going back to a
 *  version older than one this machine pushed is a real edit (an undo) and takes the stored marker. Unchanged text when
 *  it already carries the marker it keeps. */
export function withTeamMarker(text, marker, name, { ownPush = false } = {}) {
  const s = String(text ?? '');
  const { meta, body } = parseMemoryFile(s);
  const own = meta.extra[TEAM_MARKER_KEY] ?? null;
  const keep = marker && own && own !== marker && !ownPush && contentHash({ ...meta, name }, body) === own ? own : (marker ?? null);
  if (own === keep) return s;
  const extra = { ...meta.extra };
  if (keep) extra[TEAM_MARKER_KEY] = keep; else delete extra[TEAM_MARKER_KEY];
  return renderMemoryFile({ ...meta, name, extra }, body);
}
/** The text a store write of CLIENT text stores (the Memory page's PUT, a run's sync-back): withTeamMarker with the
 *  stored copy's marker. A global note, or a project that is off: the text as it is. Call it under the store lock. */
export async function teamClientText(scope, name, text) {
  if (scope?.kind !== 'project' || !isTeamMemoryOn(scope.projectKey) || !isValidMemoryName(name)) return text;
  const stored = await readMemory(memoryRoot(), scope, name).catch(() => null);
  const marker = stored?.meta.extra[TEAM_MARKER_KEY] || null;
  return withTeamMarker(text, marker, name, { ownPush: !!marker && readStatusNow(scope.projectKey, name)?.pushed === marker });
}
/** The gate over every field that leaves the machine; body lines are mapped onto the LOCAL file the user edits. Each
 *  field is checked as stored AND as teamNoteText renders it — the rendered line is what is pushed, and flattenLine
 *  turns a control character into a space (`DB_PASSWORD\x01=…` becomes `DB_PASSWORD =…`) — each rendered line mapped
 *  back to its field. */
export function noteFindings(meta, body, text = '') {
  const b = String(body ?? '');
  const head = typeof text === 'string' && text.endsWith(b) ? text.slice(0, text.length - b.length) : '';
  const shift = (head.match(/\n/g) || []).length;
  const field = (name, value) => scanSecrets(String(value ?? '')).map((f) => ({ ...f, field: name, line: null }));
  const fields = [
    ...field('name', meta?.name), ...field('description', meta?.description), ...field('paths', (meta?.paths || []).join(', ')),
    ...field('updated', meta?.updated),   // written verbatim (teamNoteText): a hand-edited store file decides it
  ];
  let rendered = [];
  try {
    const lines = teamNoteText(meta, '').split('\n');   // `---`, one line per field, `---`
    const end = lines.indexOf('---', 1);
    rendered = scanSecrets(lines.slice(1, end).join('\n')).map((f) => ({ ...f, field: /^(\w+):/.exec(lines[f.line] || '')?.[1] || 'name', line: null }));
  } catch { /* an invalid name renders nothing: the name check refuses the note before any push */ }
  const slot = (f) => `${f.field}\0${f.kind === 'secret' ? 'secret' : f.rule}`;
  const seen = new Set(fields.map(slot));
  return [
    ...fields, ...rendered.filter((f) => !seen.has(slot(f))),
    ...scanSecrets(b).map((f) => ({ ...f, field: 'body', line: f.line ? f.line + shift : null })),
  ];
}
function noteEntry(name, text, bytes = Buffer.byteLength(text, 'utf8')) {
  const { meta, body } = parseMemoryFile(text);
  return { text, hash: contentHash({ ...meta, name }, body), description: meta.description, paths: meta.paths, updated: meta.updated || null, author: meta.extra.author || null, bytes };
}

// ── per-note status, the outbox of intents, the snapshot, the sync record ────────────────────
const statusPath = (key, name) => join(statusDir(key), `${name}.json`);
async function readStatus(key, name) { const s = await readJson(statusPath(key, name)); return s && typeof s === 'object' ? s : null; }
/** The record as it is NOW, read synchronously right before a write that keeps some of its fields: no await sits between
 *  the read and the write, so a record another writer of this process wrote meanwhile (a push finishing, a verdict) is
 *  never overwritten with an older copy. */
function readJsonNow(p) { try { const s = JSON.parse(readFileSync(p, 'utf8')); return s && typeof s === 'object' ? s : null; } catch { return null; } }
function readStatusNow(key, name) { return readJsonNow(statusPath(key, name)); }
function writeStatus(key, name, s) { writeJsonAtomic(statusPath(key, name), s); }
async function removeStatus(key, name) { await rm(statusPath(key, name), { force: true }); }
/** A former team copy kept here as a plain local note, with the content it had then (queueNow: a re-save is no change).
 *  (A `removed` record is a tombstone: a teammate's deletion followed here — see reconcileTracked.) */
const keptRecord = (hash, at) => ({ state: 'kept', hash, sharedHash: null, reason: null, findings: null, error: null, at });
/** keptRecord for content `hash` that also keeps the note's other baseline `kept` (the content it had at opt-in, or
 *  the content a team delete removed) — a return to either is no change (isKeptHash). */
const baselineRecord = (hash, kept, at) => ({ ...keptRecord(hash, at), kept: kept && kept !== hash ? kept : null });
/** A note's baseline, content a write of which is no change: a `kept` record's, the content a team delete removes, or
 *  (1b) the note's text from before opt-in. Every record written over it that shares nothing carries it (`kept`):
 *  pending, blocked, deleting, held — and a follow's, an adoption's and a re-sync's `shared`, a tombstone, an untrack —
 *  until an edit of this machine is SHARED: an edit that never reached the team and is then undone is no change either
 *  (D1, D12, D13, E4). */
const keptHashOf = (s) => (s?.state === 'kept' ? s.hash : s?.kept) || null;
/** `h` is such a content for this record: keptHashOf's — or, on a copy kept after its team delete landed, also the content
 *  that delete removed from the team (`kept`) when the copy then held an edit that never reached it (a blocked one). */
const isKeptHash = (s, h) => !!h && (keptHashOf(s) === h || (s?.state === 'kept' && s.kept === h));
/** The team holds this machine's copy, as last synced (`sharedHash`). For a restore — whole-scope, so it changes notes
 *  the user never picked — only a version this machine PUSHED counts (`pushed`): a restore never reverts or removes a
 *  teammate's version for the team (refine cycle 8). */
const sharedFromHere = (s, { restore = false } = {}) => !!s?.sharedHash && (!restore || s.pushed === s.sharedHash);
async function readStatuses(key) {
  const out = Object.create(null);
  for (const f of await jsonFiles(statusDir(key))) {
    const name = f.slice(0, -'.json'.length);
    const s = isValidMemoryName(name) ? await readStatus(key, name) : null;
    if (s) out[name] = s;
  }
  return out;
}
/** An intent, never content: the push reads (and gates) the note as it is THEN — a later edit simply wins. */
function writeEntry(key, name, entry) { writeJsonAtomic(join(outboxDir(key), `${name}.json`), entry); }
async function removeEntry(key, name) { await rm(join(outboxDir(key), `${name}.json`), { force: true }); }
async function queuedNames(key) {
  const names = new Set();
  for (const d of [outboxDir(key), inflightDir(key)]) for (const f of await jsonFiles(d)) names.add(f.slice(0, -'.json'.length));
  return names;
}
export async function readTeamSnapshot(projectKey) {
  if (!isKey(projectKey)) return null;
  const s = await readJson(snapshotFile(projectKey));
  if (!s || s.schema !== 1 || !s.notes || typeof s.notes !== 'object' || Array.isArray(s.notes)) return null;
  // Only a fetch writes team.json, but a hand edit must not fail every reader (list, read, status, the mount): an entry
  // that is no note entry is left out — the next fetch writes it again.
  const notes = Object.create(null);
  for (const [name, n] of Object.entries(s.notes)) if (n && typeof n === 'object' && typeof n.text === 'string' && typeof n.hash === 'string') notes[name] = n;
  return { ...s, notes };
}
function writeSnapshot(key, snap) { writeJsonAtomic(snapshotFile(key), snap); }
async function readSyncState(key) { return (await readJson(syncFile(key))) || {}; }
async function writeSyncState(key, patch) { writeJsonAtomic(syncFile(key), { ...(await readSyncState(key)), ...patch }); }

/** The checkout to fetch and push from: the caller's, a registered project's, or the one the last fetch used. */
async function projectDirFor(key, explicit = null) {
  if (explicit) return explicit;
  const p = (await listProjects()).find((x) => x && x.key === key && x.exists !== false);
  if (p) return p.path;
  const s = await readSyncState(key);
  return typeof s.projectDir === 'string' && existsSync(s.projectDir) ? s.projectDir : null;
}

// ── the write path: queue → gate → outbox ─────────────────────────────────────────────────────
/**
 * Queue changed project notes for the team (§2.4). Every store writer of an opted-in project calls it with the NAMES it
 * changed; the store's current state decides what each one means. The secret gate runs here (and again at the push):
 * a hit records the note BLOCKED with its reason and nothing leaves the machine. `force` (an undo re-queued after its
 * push, 1b's seeding) shares a note even when it equals its last synced version or its baseline. `restore` (a
 * Memory-page restore, D13) forces only an OLDER tracked version the restore brought back; every other note it changed
 * is an ordinary change. Off ⇒ a no-op that touches no file.
 * @returns {Promise<{queued:string[], blocked:Array<{name:string, reason:string}>, skipped?:'disabled'}>}
 */
const _queueTails = new Map();
/** One call at a time per project in this process — queueTeamChanges AND deleteTeamNote: two quick writes of one note
 *  (two saves, a save and an Ask remember, a save and a team delete) must not interleave their reads and writes — an
 *  older verdict would overwrite or delete the newer intent. Nothing in a turn takes the store lock: the restore route
 *  queues while it holds that lock. */
function inTurn(projectKey, fn) {
  const prev = _queueTails.get(projectKey) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  _queueTails.set(projectKey, tail);
  tail.then(() => { if (_queueTails.get(projectKey) === tail) _queueTails.delete(projectKey); });
  return run;
}
export async function queueTeamChanges(projectKey, names, opts = {}) {
  if (!isTeamMemoryOn(projectKey)) return { queued: [], blocked: [], skipped: 'disabled' };
  return inTurn(projectKey, () => queueNow(projectKey, names, opts));
}
async function queueNow(projectKey, names, { force = false, restore = false, source = null, flush = true, now = new Date().toISOString() } = {}) {
  if (!isTeamMemoryOn(projectKey)) return { queued: [], blocked: [], skipped: 'disabled' };
  const scope = projectScope(projectKey);
  const out = { queued: [], blocked: [] };
  let snap;   // the team snapshot, read once per call and only when a held note is met (holdApplies)
  const holds = async (name) => holdApplies(snap === undefined ? (snap = await readTeamSnapshot(projectKey)) : snap, name);
  for (const name of new Set(Array.isArray(names) ? names : [])) {
    if (!isValidMemoryName(name)) continue;
    const local = await readMemory(memoryRoot(), scope, name).catch(() => null);
    const status = await readStatus(projectKey, name);
    // A TEAM delete (deleteTeamNote) queued or being pushed is the user's own removal from the team (D12). Only a clean
    // change shared on top of it supersedes it; a local deletion, a blocked edit or a re-save never cancels it.
    const queuedEntry = await readJson(join(outboxDir(projectKey), `${name}.json`));
    const pushingEntry = await readJson(join(inflightDir(projectKey), `${name}.json`));
    const queuedOp = queuedEntry?.op ?? null;
    const pushingOp = pushingEntry?.op ?? null;
    // A clean edit queued over a team delete supersedes it only once it is SHARED (D12): until then the delete rides
    // under it (`teamDelete`), and dropping that edit — a local deletion, a block, a revert — puts the delete back.
    const underDelete = !!queuedEntry?.teamDelete;
    const dropQueued = async () => {
      if (!underDelete) return removeEntry(projectKey, name);
      // Re-checked right before the (synchronous) write, like the intent below: it never outlives a switch-off.
      if (isTeamMemoryOn(projectKey)) writeEntry(projectKey, name, { op: 'delete', force: false, at: now, source: queuedEntry.source ?? source });
    };
    let hash = null;
    let forced = !!force;
    if (local) {
      const meta = { ...local.meta, name };
      hash = contentHash(meta, local.body);
      // A note a sandbox run wrote is HELD for review (memory-store isHeldSource): what ran in the sandbox is untrusted, so
      // it never reaches the team — not even forced — until a person approves it in Memory (Save re-stamps it `user`).
      if (isHeldSource(meta.source)) {
        if (queuedOp !== 'delete') await dropQueued();
        const reason = 'held for review: a sandbox run wrote it — approve it in Memory first';
        const prev = readStatusNow(projectKey, name);
        writeStatus(projectKey, name, { state: 'blocked', hash, sharedHash: prev?.sharedHash ?? null, kept: keptHashOf(prev), reason, findings: [], error: null, at: now });
        out.blocked.push({ name, reason });
        continue;
      }
      // A restore brings back the `team:` line a note had in its snapshot — also one from before a team delete or an
      // untrack. A note this machine no longer tracks (no `sharedHash`) is never re-marked that way: the next follow would
      // take the team's deletion as one to follow and remove the copy (D12). Under a tombstone (a teammate deleted it, a
      // follow removed it here) the line stays: the copy follows that deletion again, never re-shared as a new note (D3).
      // The restore route holds the store lock.
      if (restore && meta.extra[TEAM_MARKER_KEY] && !status?.sharedHash && status?.state !== 'removed'
        && await setMemoryExtra(memoryRoot(), scope, name, TEAM_MARKER_KEY, null, { expectHash: hashText(local.text) }).catch(() => false)) {
        meta.extra = { ...meta.extra };
        delete meta.extra[TEAM_MARKER_KEY];
      }
      // 1b (Q&A skip-conflict): a same-name clash the user skipped while seeding is HELD — no edit of it, mine or an
      // agent's, reaches the team until they pick keep mine (a forced share: `force`) or take team. The record follows
      // the content, so a deletion leaves the newest content as its baseline.
      if (!force && status?.state === 'held' && await holds(name)) {
        if (status.hash !== hash) writeStatus(projectKey, name, { ...(readStatusNow(projectKey, name) || status), hash, at: now });
        continue;
      }
      // A restore (D13) forces only an OLDER tracked version it brought back (its content equals its own marker, not what
      // this machine last synced) over a version THIS machine pushed (`pushed`): it undoes this machine's own shared
      // write, which the next follow would otherwise bring back. A restore is whole-scope: a teammate's version followed
      // here since the snapshot is never reverted for the team that way — the copy follows the team again (refine cycle
      // 8). Every other note it changed is an ordinary change: a restore that only undoes an edit that never reached the
      // team is no change — it never uploads a note that existed at opt-in, nor puts back a note this machine removed
      // from the team (D1, D12) — and a tracked copy back at its last synced version keeps following the team.
      if (restore && meta.extra[TEAM_MARKER_KEY] === hash && status?.sharedHash !== hash && sharedFromHere(status, { restore })) forced = true;
      // A re-save of the very content a team delete is removing changes nothing: the delete stays.
      if (!forced && (queuedOp === 'delete' || pushingOp === 'delete') && status?.hash === hash) continue;
      // A former team copy kept here as a plain local note (its team delete landed, or it was untracked — branch started
      // again, team version over this machine's cap): an unchanged re-save is no change; only a real edit shares it (§6, D13).
      if (!forced && status?.state === 'kept' && status.hash === hash) continue;
      // Back to that content after an edit that never reached the team (blocked, or its push failed): the edit is undone.
      // Its queued share goes, a team delete under it comes back, the record is the baseline again (D1, D12, D13).
      if (!forced && isKeptHash(status, hash) && meta.extra[TEAM_MARKER_KEY] !== hash) {
        if (queuedEntry?.force || pushingEntry?.force) continue;   // a restore's forced share on its way stays (D13)
        if (queuedOp !== 'delete') await dropQueued();
        const cur = readStatusNow(projectKey, name) || {};
        const deleting = underDelete || queuedOp === 'delete' || pushingOp === 'delete' || !!pushingEntry?.teamDelete;
        // A note with no marker is no tracked copy: the team holds no copy of it from here, so removing it here later is
        // no team delete (1b: my text from before a Take team, restored from History, over the team's version). Back at
        // one of a `kept` record's two baselines, the other one stays a baseline too.
        writeStatus(projectKey, name, deleting ? { ...cur, state: 'deleting', hash, kept: hash, reason: null, findings: null, error: null, at: now }
          : { ...baselineRecord(hash, cur.state === 'kept' && cur.hash !== hash ? cur.hash : null, now), sharedHash: meta.extra[TEAM_MARKER_KEY] ? cur.sharedHash ?? null : null });
        continue;
      }
      if (!forced && meta.extra[TEAM_MARKER_KEY] === hash) {
        // Unchanged since its last sync (a re-save, the team's own version arriving): pushing it could revert a
        // teammate's newer edit. An earlier verdict on this name is void.
        // A team delete, or a restore's forced share, on its way stays: a re-save never cancels either.
        if (queuedOp === 'delete' || pushingOp === 'delete' || queuedEntry?.force || pushingEntry?.force) continue;
        if (underDelete) {
          await dropQueued();
          writeStatus(projectKey, name, { ...(readStatusNow(projectKey, name) || {}), state: 'deleting', hash, sharedHash: null, reason: null, findings: null, error: null, at: now });
          continue;
        }
        await removeEntry(projectKey, name);
        // An edit that never reached the team, taken out again: its baseline stays (D1 — 1b: Take team's opt-in text).
        if (status && status.state !== 'shared') writeStatus(projectKey, name, { ...status, state: 'shared', hash, sharedHash: hash, kept: keptHashOf(status), reason: null, findings: null, error: null, at: now });
        continue;
      }
      // The host refused exactly this content (D5): never retried as it is — only an edit is pushed again.
      if (!forced && status?.state === 'blocked' && status.hash === hash && status.findings?.some((f) => f?.rule === 'remote')) continue;
      const findings = noteFindings(meta, local.body, local.text);
      if (findings.length) {
        // An earlier clean version waiting in the outbox must not reach the team now (a queued team delete still goes).
        if (queuedOp !== 'delete') await dropQueued();
        const reason = describeFindings(findings);
        const prev = readStatusNow(projectKey, name);
        writeStatus(projectKey, name, { state: 'blocked', hash, sharedHash: prev?.sharedHash ?? null, kept: keptHashOf(prev), reason, findings, error: null, at: now });
        out.blocked.push({ name, reason });
        continue;
      }
    } else if (!force && status?.state === 'held' && await holds(name)) {
      // A held clash deleted here: the hold ends, and the team's version stays — it loads here again as a team note. A
      // held note never changes the team, by an edit or by a deletion (1b). Both its last content and its opt-in
      // baseline stay no change: bringing either back (a restore, an Ask remember) uploads nothing.
      const held = readStatusNow(projectKey, name) || status;
      writeStatus(projectKey, name, baselineRecord(held.hash, held.kept, now));
      continue;
    } else if (queuedOp === 'delete') {
      continue;   // gone here too: the queued team delete goes as it is
    } else if (!underDelete && !existsSync(join(inflightDir(projectKey), `${name}.json`)) && !sharedFromHere(readStatusNow(projectKey, name), { restore })) {
      // Gone, and never shared from this machine: the team never had this copy (a queued first share is cancelled) —
      // or a restore removed a copy whose team version is a teammate's: that version stays on the team (and loads here
      // as a team note again). A first share IN FLIGHT may land: then the sync intent below lets the next flush delete
      // it (planOps decides). The claim is looked at BEFORE the record, both read now: a push that released its claim
      // has recorded what landed.
      await removeEntry(projectKey, name);
      // A baseline outlives the note (D1): a note that existed at opt-in (or a former team copy) deleted here and then
      // brought back unchanged — a restore, an Ask remember of the same text — is still no change (refine cycle 7).
      const base = keptHashOf(readStatusNow(projectKey, name));
      if (base) writeStatus(projectKey, name, keptRecord(base, now)); else if (status) await removeStatus(projectKey, name);
      continue;
    }
    // Re-checked after the reads above, right before the (synchronous) write: an intent never outlives a switch-off.
    if (!isTeamMemoryOn(projectKey)) { out.skipped = 'disabled'; break; }
    // Gone while a team delete is being pushed (or waits under an edit): queue the delete again.
    const teamDelete = underDelete || queuedOp === 'delete' || pushingOp === 'delete';
    writeEntry(projectKey, name, { op: !local && teamDelete ? 'delete' : 'sync', force: forced, at: now, source, ...(local && teamDelete ? { teamDelete: true } : {}) });
    const prev = readStatusNow(projectKey, name);
    writeStatus(projectKey, name, { state: local ? 'pending' : 'deleting', hash, sharedHash: prev?.sharedHash ?? null, kept: keptHashOf(prev), reason: null, findings: null, error: null, at: now });
    out.queued.push(name);
  }
  if (out.blocked.length) emit(projectKey, 'blocked', { names: out.blocked.map((b) => b.name) });
  if (out.queued.length && flush) scheduleTeamFlush(projectKey);
  return out;
}

/** `name` as `names` spell it: itself, else its case variant there (the store refuses case twins); null when neither. */
const spelledAs = (name, names) => (names.includes(name) ? name : names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? null);
/** Remove a note from the TEAM (API / CLI; phase 1b's Team tab). Gate-free like every deletion. A local copy on this
 *  machine stays, as a plain local note: its marker is dropped so it never "follows" this deletion. */
export async function deleteTeamNote(projectKey, name, { flush = true, now = new Date().toISOString() } = {}) {
  if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
  if (!isValidMemoryName(name)) throw teamError('ENAME', `invalid memory name ${JSON.stringify(name)}`);
  const scope = projectScope(projectKey);
  // In turn with queueTeamChanges: a queue call that read this note before the delete never writes its older verdict
  // over it. The intent first: from here every reconcile, in any process, leaves this note alone.
  await inTurn(projectKey, async () => {
    if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
    // A name typed in another case means the note as this machine spells it — else as the team does. The push removes
    // every case variant (D9): on a case-sensitive disk the local copy would keep its marker, and the next follow would
    // take this deletion as a teammate's and remove it (D12).
    name = spelledAs(name, (await listMemory(memoryRoot(), scope).catch(() => [])).map((e) => e.name))
      ?? spelledAs(name, Object.keys((await readTeamSnapshot(projectKey))?.notes || {})) ?? name;
    writeEntry(projectKey, name, { op: 'delete', force: false, at: now, source: 'user' });
    const local = await readMemory(memoryRoot(), scope, name).catch(() => null);
    // The local copy's content now: a later re-save of it never cancels this delete (queueTeamChanges).
    const hash = local ? contentHash({ ...local.meta, name }, local.body) : null;
    // The content it removes (`kept`): the team's version as this machine last synced it — a tracked copy's marker — so
    // taking out an edit that never reached the team (a blocked one) is no change either (D12); else the local copy.
    const kept = (local && local.meta.extra[TEAM_MARKER_KEY]) || hash;
    writeStatus(projectKey, name, { ...(readStatusNow(projectKey, name) || {}), state: 'deleting', hash, kept, sharedHash: null, reason: null, findings: null, error: null, at: now });
  });
  // The marker goes under the store lock, after the turn: the restore route queues while it holds that lock.
  await withStoreLock(memoryRoot(), async () => {
    const local = await readMemory(memoryRoot(), scope, name).catch(() => null);
    if (local?.meta.extra[TEAM_MARKER_KEY]) await setMemoryExtra(memoryRoot(), scope, name, TEAM_MARKER_KEY, null);
  });
  if (flush) scheduleTeamFlush(projectKey);
  return { queued: [name] };
}

// ── the push: claim → plan (re-gate) → commitToTeamBranch → mark tracked ──────────────────────
/** Put a claim back into outbox/ — unless a newer intent is there: `link` refuses (EEXIST) to replace one, where a
 *  check-then-rename could overwrite an intent written between the check and the rename. */
async function restoreClaim(key, f) {
  const src = join(inflightDir(key), f);
  const dst = join(outboxDir(key), f);
  const code = await link(src, dst).then(() => null, (err) => err?.code || 'ERR');
  if (code === 'ENOENT' && !existsSync(src)) return;   // dropped meanwhile (a switch-off)
  if (code && code !== 'EEXIST') {
    // No hard links here (FAT/exFAT, some network or FUSE mounts: EPERM, ENOTSUP, EXDEV…): put it back by rename
    // unless a newer intent is there — never drop it. A claim that cannot move at all stays for the next flush.
    if (!existsSync(dst)) { await rename(src, dst).catch(() => {}); return; }
  }
  // A newer intent replaced this claim. A team delete the claim carried under its edit never landed (D12: only an edit
  // SHARED on top cancels it): the newer edit carries it on. Read and written with no await between them.
  if (readJsonNow(src)?.teamDelete) {
    const cur = readJsonNow(dst);
    if (cur && cur.op !== 'delete' && !cur.teamDelete) writeEntry(key, f.slice(0, -'.json'.length), { ...cur, teamDelete: true });
  }
  await rm(src, { force: true });
}
async function claimEntries(key) {
  await mkdir(outboxDir(key), { recursive: true });
  await mkdir(inflightDir(key), { recursive: true });
  // A claim left by a flush that died (killed CLI, crash) goes back first — unless a newer intent replaced it.
  for (const f of await jsonFiles(inflightDir(key))) await restoreClaim(key, f);
  const claimed = [];
  for (const f of await jsonFiles(outboxDir(key))) {
    const name = f.slice(0, -'.json'.length);
    if (!isValidMemoryName(name)) { await rm(join(outboxDir(key), f), { force: true }); continue; }
    // Claim by rename, THEN read: an intent written after this point lands in outbox/ again and waits for the next flush.
    try { await rename(join(outboxDir(key), f), join(inflightDir(key), f)); } catch { continue; }
    let entry = null;
    try { entry = JSON.parse(await readFile(join(inflightDir(key), f), 'utf8')); }
    catch (err) {
      // Unreadable right now (EMFILE, EBUSY…): never guess — a team delete read as a share puts the note back on the team.
      if (!(err instanceof SyntaxError)) { await restoreClaim(key, f); continue; }
    }
    claimed.push({ name, entry: entry && typeof entry === 'object' ? entry : { op: 'sync' } });
  }
  return claimed;
}
async function releaseClaims(key, claimed) {
  for (const { name } of claimed) await rm(join(inflightDir(key), `${name}.json`), { force: true });
}
async function failFlush(key, claimed, code, stderr, hint = null) {
  const on = isTeamMemoryOn(key);   // switched off during the push (D1): its claims are dropped, never put back
  for (const { name } of claimed) {
    const f = `${name}.json`;
    if (on) await restoreClaim(key, f); else await rm(join(inflightDir(key), f), { force: true });
    const st = readStatusNow(key, name);   // read right before the write: a verdict written meanwhile is kept
    if (st) writeStatus(key, name, { ...st, error: code });
  }
  await writeSyncState(key, { lastError: String(stderr || code).trim(), lastErrorCode: code, lastErrorAt: new Date().toISOString(), hint });
  emit(key, 'flush-failed', { code });
  return { ok: false, code, stderr: String(stderr || ''), hint, pushed: 0 };
}
async function planOps(key, claimed) {
  const scope = projectScope(key);
  const ops = [];
  for (const { name, entry } of claimed) {
    const status = await readStatus(key, name);
    const local = entry.op === 'delete' ? null : await readMemory(memoryRoot(), scope, name).catch(() => null);
    if (!local) {
      // Unreadable is not deleted (EMFILE, EBUSY…): the claim goes back and the next flush reads the note again.
      if (entry.op !== 'delete' && existsSync(join(scopeDir(memoryRoot(), scope), `${name}.md`))) { await restoreClaim(key, `${name}.json`); continue; }
      // `team`: a TEAM delete (deleteTeamNote, on its own or under an edit) — only its surviving local copy is kept (D12).
      if (entry.op === 'delete' || entry.teamDelete || status?.sharedHash) ops.push({ name, kind: 'delete', team: entry.op === 'delete' || !!entry.teamDelete });
      else if (status) {   // never shared: nothing to tell the team — only a baseline is kept (D1)
        const base = keptHashOf(readStatusNow(key, name));
        if (base) writeStatus(key, name, keptRecord(base, new Date().toISOString())); else await removeStatus(key, name);
      }
      continue;   // the claim is released with the rest
    }
    const meta = { ...local.meta, name };
    const hash = contentHash(meta, local.body);
    // Held at flush time too: a sandbox run may have rewritten a note after a person queued it (memory-store isHeldSource).
    // Before the revert checks, so neither `force` nor a kept hash lets it through.
    if (isHeldSource(meta.source)) {
      writeStatus(key, name, { state: 'blocked', hash, sharedHash: status?.sharedHash ?? null, kept: keptHashOf(status),
        reason: 'held for review: a sandbox run wrote it — approve it in Memory first', findings: [], error: null, at: new Date().toISOString() });
      emit(key, 'blocked', { names: [name] });
      if (entry.teamDelete) ops.push({ name, kind: 'delete', team: true });
      continue;
    }
    // Reverted to its synced version since the queue — a team delete under the edit still goes.
    if (!entry.force && meta.extra[TEAM_MARKER_KEY] === hash) { if (entry.teamDelete) ops.push({ name, kind: 'delete', team: true }); continue; }
    // Back to its kept content, the edit never shared (an undo after a failed push): no change — a team delete under it goes.
    if (!entry.force && isKeptHash(status, hash)) { if (entry.teamDelete) ops.push({ name, kind: 'delete', team: true }); continue; }
    const findings = noteFindings(meta, local.body, local.text);          // the gate again: the note may have changed since
    if (findings.length) {
      writeStatus(key, name, { state: 'blocked', hash, sharedHash: status?.sharedHash ?? null, kept: keptHashOf(status), reason: describeFindings(findings), findings, error: null, at: new Date().toISOString() });
      emit(key, 'blocked', { names: [name] });
      if (entry.teamDelete) ops.push({ name, kind: 'delete', team: true });   // the edit stays here; the team delete under it goes
      continue;
    }
    ops.push({ name, kind: 'upsert', meta, body: local.body, hash, readHash: hashText(local.text) });
  }
  return ops;
}
async function applyOps(dir, ops, author) {
  const notes = join(dir, ...TEAM_NOTES_REL.split('/'));
  // The branch is writable by anyone with push access: never write THROUGH a committed symlink (→ ~/.ssh).
  for (const p of [join(dir, TEAM_MEMORY_DIR), notes]) {
    const st = await lstat(p).catch(() => null);
    if (st && !st.isDirectory()) return { code: 'BRANCH_UNSAFE', stderr: `${p} on ${TEAM_MEMORY_BRANCH} is not a plain directory` };
  }
  await mkdir(notes, { recursive: true });
  // One file per note name, case-insensitively — the store's own rule (it refuses case twins). A case-insensitive
  // checkout (macOS, Windows) cannot hold `Deploy.md` beside `deploy.md`: writing one overwrites the other's file and
  // stages nothing, so the push fails, or marks a note shared that never landed. An op therefore replaces every case
  // variant of its name on the branch — last write wins, as for any edit. Deletions first: a case-only rename in one
  // flush (`deploy` removed, `Deploy` written) must not unlink the file it has just written.
  const ls = await runGit(dir, ['ls-files', '-z', '--', `${TEAM_NOTES_REL}/`]);
  if (!ls.ok) return { code: 'COMMIT_FAILED', stderr: ls.stderr };
  const onBranch = ls.stdout.split('\0').filter(Boolean);
  for (const op of [...ops].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'delete' ? -1 : 1))) {
    const file = join(notes, `${op.name}.md`);
    const rel = `${TEAM_NOTES_REL}/${op.name}.md`;
    for (const twin of onBranch.filter((p) => p !== rel && p.toLowerCase() === rel.toLowerCase())) {
      const t = await runGit(dir, ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', twin]);
      if (!t.ok) return { code: 'COMMIT_FAILED', stderr: t.stderr };
      await rm(join(dir, ...twin.split('/')), { force: true, recursive: true });
    }
    await rm(file, { force: true, recursive: true });   // a symlink is unlinked, never followed
    // -f: info/exclude (shared by every worktree) or a global excludes file must never drop a note silently. -r: a
    // directory hand-pushed at a note's path goes too — without it git refuses, and every later flush with it.
    const r = op.kind === 'delete'
      ? await runGit(dir, ['rm', '-r', '--cached', '--ignore-unmatch', '-q', '--', rel])
      : (await writeFile(file, teamNoteText(op.meta, op.body, { author }), 'utf8'), await runGit(dir, ['add', '-f', '--', rel]));
    if (!r.ok) return { code: 'COMMIT_FAILED', stderr: r.stderr };
  }
  return null;
}
async function verifyOps(dir, ops) {
  for (const op of ops) {
    const inHead = await runGit(dir, ['cat-file', '-e', `HEAD:${TEAM_NOTES_REL}/${op.name}.md`]);
    if ((op.kind === 'upsert') !== inHead.ok) return `${TEAM_MEMORY_BRANCH} does not hold the expected state of ${op.name}.md`;
  }
  return null;
}
/** The upserted notes a SECRET-SCANNING rejection names by path (GitHub push protection: "Push cannot contain secrets"
 *  … `path: <file>:<line>`; GitLab: "Secrets detected"). Any other rejection (branch protection) refuses the push. */
function hostRefusedNames(stderr, ops) {
  const upserts = new Set(ops.filter((o) => o.kind === 'upsert').map((o) => o.name));
  const out = new Set();
  if (!/secret/i.test(String(stderr || ''))) return out;
  const re = new RegExp(`${TEAM_NOTES_REL.replace(/[.]/g, '\\.')}/([A-Za-z0-9._-]+)\\.md\\b`, 'g');
  for (const m of String(stderr || '').matchAll(re)) if (upserts.has(m[1])) out.add(m[1]);
  return out;
}
/** A batch refused as a whole by a refusal that names no note: push it by halves until ONE op is refused on its own.
 *  Each narrowing needs the other half accepted, so a refusal of every push (branch protection) never pins a note: both
 *  halves refused stops it, and the batch fails as it is. At most about 2·log2(n) + 1 pushes; what landed is finished.
 *  @returns {Promise<{landed:object[], refused:string|null, failure:object|null}>} `refused`: an upsert to block (D5). */
async function bisectRefusal(key, dir0, ops, opts) {
  const landed = [];
  let pending = ops, failure = null;
  while (isTeamMemoryOn(key)) {   // switched off meanwhile (D1): no new push goes out
    if (pending.length === 1) {   // pushed alone: a refusal of the combination (a size rule) is no refusal of this note
      const r = await pushOps(key, dir0, pending, opts);
      if (r.ok) { await finishFlush(key, pending, r.dir); landed.push(...pending); return { landed, refused: null, failure: null }; }
      const pinned = r.code === 'PUSH_REJECTED' && pending[0].kind === 'upsert' && landed.length > 0;
      return { landed, refused: pinned ? pending[0].name : null, failure: r };
    }
    const a = pending.slice(0, Math.ceil(pending.length / 2));
    const b = pending.slice(a.length);
    let next = null;
    for (const [mine, other] of [[a, b], [b, a]]) {
      const r = await pushOps(key, dir0, mine, opts);
      if (r.ok) { await finishFlush(key, mine, r.dir); landed.push(...mine); next = other; break; }
      failure = r;
      if (r.code !== 'PUSH_REJECTED') return { landed, refused: null, failure };
    }
    if (!next) return { landed, refused: null, failure };
    pending = next;
  }
  return { landed, refused: null, failure };
}
function commitMessage(ops) {
  const list = (xs) => (xs.length > 5 ? `${xs.slice(0, 5).join(', ')} +${xs.length - 5}` : xs.join(', '));
  const up = ops.filter((o) => o.kind === 'upsert').map((o) => o.name);
  const del = ops.filter((o) => o.kind === 'delete').map((o) => o.name);
  return `memory: ${[up.length ? `update ${list(up)}` : '', del.length ? `remove ${list(del)}` : ''].filter(Boolean).join('; ')}`;
}
/** Start the orphan branch (§2.2). A non-fast-forward reply means a teammate started it first: fine. */
async function createTeamBranch(projectDir) {
  let sha;
  try {
    sha = await orphanCommit(projectDir, { 'README.md': README_TEXT, [`${TEAM_MEMORY_DIR}/config.json`]: `${JSON.stringify({ schema: 1 }, null, 2)}\n` },
      `memory: start ${TEAM_MEMORY_BRANCH}`, 'git-user');
  } catch (err) { return { ok: false, code: err?.code || 'COMMIT_FAILED', stderr: String(err?.stderr || err?.message || err) }; }
  const push = await runGit(projectDir, ['push', '--no-verify', 'origin', `${sha}:refs/heads/${TEAM_MEMORY_BRANCH}`], { timeoutMs: 120_000 });
  if (push.ok || isNonFastForward(push.stderr)) return { ok: true, created: push.ok };
  return { ok: false, code: 'PUSH_REJECTED', stderr: push.stderr, hint: pushHint(push.stderr, PROTECTION_HINT) };
}
async function pushOps(key, projectDir, ops, { hooks, sleep, random }) {
  const author = (await gitUserName(projectDir)) || null;
  const identity = await identityArgs(projectDir, 'git-user');
  const attempt = async () => {
    let dir;
    try { dir = await ensureBranchWorktree(worktreeDir(key), projectDir, TEAM_MEMORY_BRANCH); }
    catch (err) {
      const stderr = String(err?.stderr || err?.message || err);
      return { ok: false, code: err?.code || 'WORKTREE_FAILED', stderr, missing: MISSING_REMOTE_REF.test(stderr) };
    }
    const r = await commitToTeamBranch({
      dir, projectDir, branch: TEAM_MEMORY_BRANCH, identity, hooks, sleep, random, message: commitMessage(ops),
      apply: (wt) => applyOps(wt, ops, author), verify: (wt) => verifyOps(wt, ops),
    });
    return { ...r, dir };
  };
  let r = await attempt();
  // Only a share starts the branch (D8): with no branch on origin a removal has nothing to remove. Starting it here
  // would bring back a branch the team just deleted, for nothing.
  if (!r.ok && r.missing && ops.every((o) => o.kind === 'delete')) return { ok: true, attempts: r.attempts || 1, pushed: false, missing: true, dir: null };
  if (!r.ok && r.missing) {
    // origin has no worca-memory branch — the first share ever, or a teammate deleted it: start it, then retry once.
    const made = await createTeamBranch(projectDir);
    if (!made.ok) return made;
    r = await attempt();
  }
  return r.ok || r.code !== 'PUSH_REJECTED' ? r : { ...r, hint: pushHint(r.stderr, PROTECTION_HINT) };
}
async function finishFlush(key, ops, dir) {
  const at = new Date().toISOString();
  const scope = projectScope(key);
  const changed = [];   // changed while they were pushed, and nothing queued that change
  await withStoreLock(memoryRoot(), async () => {
    for (const op of ops) {
      // An intent queued while this push ran (an edit, a removal, a team delete) and an edit BLOCKED meanwhile keep their
      // record and its reason: only what the team holds moves. The record is read after the intent, right before the write.
      const newer = await readJson(join(outboxDir(key), `${op.name}.json`));
      if (op.kind === 'delete') {
        const survivor = newer ? null : await readMemory(memoryRoot(), scope, op.name).catch(() => null);
        const st = readStatusNow(key, op.name);
        const keep = !!newer || st?.state === 'blocked';
        if (keep) writeStatus(key, op.name, { ...(st || {}), sharedHash: null });
        // A local copy that survives a team delete keeps the content it had (`kept`): a re-save of it is no change (D12) —
        // and so is a return to the content the delete removed, when the copy held an edit that never reached the team.
        // After a LOCAL deletion, a copy here is a note written again meanwhile (its queue call still to come): a new note,
        // shared like any — no record.
        else if (survivor && op.team) writeStatus(key, op.name, baselineRecord(contentHash({ ...survivor.meta, name: op.name }, survivor.body), st?.kept, at));
        // No copy left: a baseline outlives the note (D1) — 1b: Take team's opt-in text, brought back by a restore of the
        // seeding's snapshot or an Ask remember, is still no change.
        else if (!survivor && keptHashOf(st)) writeStatus(key, op.name, keptRecord(keptHashOf(st), at));
        else await removeStatus(key, op.name);
        // The team delete an edit carried has landed: that edit no longer brings one back (a teammate may reuse the name).
        const cur = newer?.teamDelete ? readJsonNow(join(outboxDir(key), `${op.name}.json`)) : null;
        if (cur?.teamDelete) writeEntry(key, op.name, { ...cur, teamDelete: false });
        // A local copy that survives a team delete is a plain local note, whatever re-marked it meanwhile (a follow or an
        // adoption in another process): reconcile must never take this deletion as one to follow (D12).
        await setMemoryExtra(memoryRoot(), scope, op.name, TEAM_MARKER_KEY, null).catch(() => false);
        continue;
      }
      const st = readStatusNow(key, op.name);
      const keep = !!newer || (st?.state === 'blocked' && st.hash !== op.hash);
      // The team holds this push now: a kept baseline is over (an undo of it is a real change) — except under a team delete
      // queued meanwhile: it removes exactly this push, so a return to it, an edit on top undone, is no change (D12).
      const underTeamDelete = newer?.op === 'delete' || !!newer?.teamDelete;
      // `pushed`: the team's version is this machine's own (a follow writes a record without it) — what a restore may
      // force back over, and what a client's older synced version undoes (withTeamMarker, queueNow's `restore`).
      writeStatus(key, op.name, keep ? { ...(st || {}), sharedHash: op.hash, pushed: op.hash, kept: underTeamDelete ? op.hash : null }
        : { ...(st || {}), state: 'shared', hash: op.hash, sharedHash: op.hash, pushed: op.hash, kept: null, reason: null, findings: null, error: null, at });
      // A TRACKED copy from now on — never under a team delete queued meanwhile (on its own or under a newer edit): that
      // one leaves the local copy a plain local note (D12).
      if (underTeamDelete) continue;
      if (await setMemoryExtra(memoryRoot(), scope, op.name, TEAM_MARKER_KEY, op.hash, { expectHash: op.readHash }).catch(() => false)) continue;
      // It changed while it was pushed (an edit queued or blocked meanwhile, an undo, a re-save, a defragment rewrite).
      // The team holds op.hash all the same: that is the version this copy last synced, so the marker says so on the note
      // as it is NOW (a CAS on this read). Its content then reads as an edit since that sync — local wins until it is
      // shared — and taking that edit out again matches the marker: no change, never the pushed text over a teammate's
      // newer version (D13). A stale older marker would read that undo as an edit and push it.
      const cur = await readMemory(memoryRoot(), scope, op.name).catch(() => null);
      if (cur) await setMemoryExtra(memoryRoot(), scope, op.name, TEAM_MARKER_KEY, op.hash, { expectHash: hashText(cur.text) }).catch(() => false);
      if (keep) continue;
      // No intent: nothing queued that change. An edit undone during the push does exactly that — it read as
      // "unchanged" against the marker this push has just made stale.
      if (cur && contentHash({ ...cur.meta, name: op.name }, cur.body) !== op.hash) changed.push({ name: op.name, pushed: op.hash, seen: st?.hash ?? null });
    }
  });
  // Shared after this push, forced past that stale marker — in turn with this process's other queue calls (re-gated
  // there). Only now: had the push failed, the team would still hold the synced version and nothing must go (D13).
  // Only a change a queue call SAW and settled (its record, before this push wrote it or since, holds that content — in
  // the turn, a queue call under way has written it): a write that queued nothing — a defragment run's result (D15), a
  // lost notification (§6) — stays a local edit.
  if (changed.length) {
    await inTurn(key, async () => {
      if (!isTeamMemoryOn(key)) return;
      const undone = [];
      for (const c of changed) {
        const cur = await readMemory(memoryRoot(), scope, c.name).catch(() => null);
        const h = cur ? contentHash({ ...cur.meta, name: c.name }, cur.body) : null;
        if (h && h !== c.pushed && (h === c.seen || readStatusNow(key, c.name)?.hash === h)) undone.push(c.name);
      }
      if (undone.length) await queueNow(key, undone, { force: true, source: 'team-memory' });
    }).catch(() => {});
  }
  // The worktree is at the pushed commit — or, for removals on a missing branch (no dir), the branch is still missing.
  const snapshot = dir ? await snapshotFromWorktree(dir, at, (await readTeamSnapshot(key))?.headSha)
    : { schema: 1, branch: TEAM_MEMORY_BRANCH, headSha: null, fetchedAt: at, missing: true, notes: {} };
  writeSnapshot(key, snapshot);
  await writeSyncState(key, { lastSyncAt: at, lastError: null, lastErrorCode: null, lastErrorAt: null, hint: null });
  emit(key, 'flushed', { count: ops.length });
  // The push fetched the branch: follow it now. A snapshot is never written unreconciled — a push restarts the fetch
  // TTL, so a machine that shares often would otherwise never follow a teammate's update (D3). The pushed notes are
  // still claimed (inflight/), so reconcile leaves them alone. Switched off during the push (D1): it landed, but
  // nothing of the team's is followed into the local store any more — as a refresh switched off during its fetch.
  if (isTeamMemoryOn(key)) await reconcileTracked(key, snapshot, { at });
}

/**
 * Push this project's queued notes (§2.4). Serialised per project across processes; never throws.
 * @returns {Promise<{ok:boolean, pushed:number, attempts?:number, skipped?:'disabled', code?:string, stderr?:string, hint?:string|null}>}
 */
export async function flushTeamMemory(projectKey, { projectDir = null, hooks = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random } = {}) {
  if (!isKey(projectKey)) return { ok: false, code: 'BAD_REQUEST', stderr: `invalid project key ${JSON.stringify(projectKey)}`, pushed: 0 };
  if (!isTeamMemoryOn(projectKey)) { await discardTeamState(projectKey, { projectDir }).catch(() => {}); return { ok: true, skipped: 'disabled', pushed: 0 }; }
  try {
    return await withQueuedLock(lockFile(projectKey), async () => {
      // Switched off while this flush waited for the lock (D1): the discard queued behind it drops the intents.
      if (!isTeamMemoryOn(projectKey)) return { ok: true, skipped: 'disabled', pushed: 0 };
      const claimed = await claimEntries(projectKey);
      if (!claimed.length) return { ok: true, pushed: 0 };
      const dir0 = await projectDirFor(projectKey, projectDir);
      if (!dir0) return failFlush(projectKey, claimed, 'NO_LOCAL_PROJECT', `no local checkout of ${projectKey} is known to Worca on this machine`);
      let ops = await planOps(projectKey, claimed);
      // A claim planOps settled without an op (blocked, reverted, a never-shared removal) is done whatever the push does:
      // a failed push must not put it back, where it would read as pending and hide a blocked note's reason.
      const pushing = new Set(ops.map((o) => o.name));
      await releaseClaims(projectKey, claimed.filter((c) => !pushing.has(c.name)));
      let inPush = claimed.filter((c) => pushing.has(c.name));
      if (!ops.length) return { ok: true, pushed: 0 };
      let r = await pushOps(projectKey, dir0, ops, { hooks, sleep, random });
      // The host refused named notes (GitHub push protection: "path: .worca-memory/notes/<name>.md:<line>"): they are
      // BLOCKED with that reason, never retried as they are, and the rest is pushed again — one note the gate missed
      // must not hold back every other note forever (D5: it reaches the team only after an edit).
      let refused = !r.ok && r.code === 'PUSH_REJECTED' ? hostRefusedNames(r.stderr, ops) : new Set();
      let landed = 0;
      // A refusal that names no note (another host's wording, a pre-receive hook, a size or path rule): found by halves.
      if (!r.ok && r.code === 'PUSH_REJECTED' && !refused.size && ops.length > 1) {
        const b = await bisectRefusal(projectKey, dir0, ops, { hooks, sleep, random });
        const done = new Set(b.landed.map((o) => o.name));
        await releaseClaims(projectKey, inPush.filter((c) => done.has(c.name)));
        inPush = inPush.filter((c) => !done.has(c.name));
        ops = ops.filter((o) => !done.has(o.name));
        landed = done.size;
        if (!ops.length) return { ok: true, pushed: landed };
        if (b.refused) refused = new Set([b.refused]); else if (b.failure) r = b.failure;
      }
      if (refused.size) {
        for (const op of ops.filter((o) => refused.has(o.name))) {
          if (await readJson(join(outboxDir(projectKey), `${op.name}.json`))) continue;   // a newer edit is queued: it decides
          const st = readStatusNow(projectKey, op.name);
          writeStatus(projectKey, op.name, { state: 'blocked', hash: op.hash, sharedHash: st?.sharedHash ?? null, kept: keptHashOf(st), reason: 'the remote refused it (secret scanning or a repository rule)',
            findings: [{ rule: 'remote', kind: 'remote', label: 'refused by the remote', field: 'body', line: null }], error: null, at: new Date().toISOString() });
        }
        emit(projectKey, 'blocked', { names: [...refused] });
        // A refused edit that carried a team delete stays here, blocked; the delete under it still goes (D12).
        const carried = new Set(inPush.filter((c) => refused.has(c.name) && c.entry?.teamDelete).map((c) => c.name));
        await releaseClaims(projectKey, inPush.filter((c) => refused.has(c.name) && !carried.has(c.name)));
        ops = [...ops.filter((o) => !refused.has(o.name)), ...[...carried].map((name) => ({ name, kind: 'delete', team: true }))];
        inPush = inPush.filter((c) => !refused.has(c.name) || carried.has(c.name));
        if (!ops.length) return failFlush(projectKey, [], r.code, r.stderr, null);
        // The retry is a new push: switched off meanwhile (D1), it never goes out — its claims are dropped.
        if (!isTeamMemoryOn(projectKey)) return failFlush(projectKey, inPush, r.code, r.stderr, null);
        r = await pushOps(projectKey, dir0, ops, { hooks, sleep, random });
      }
      if (!r.ok) return failFlush(projectKey, inPush, r.code, r.stderr, r.hint || null);
      await finishFlush(projectKey, ops, r.dir);
      await releaseClaims(projectKey, inPush);
      return { ok: true, pushed: landed + (r.missing || r.pushed === false ? 0 : ops.length), attempts: r.attempts };   // pushed:false — the branch already held it
    });
  } catch (err) {
    return { ok: false, code: err?.code || 'FLUSH_FAILED', stderr: String(err?.message || err), pushed: 0 };
  }
}

// Coalesced background pushes (after every queue; server start; the 30-min tick).
const _scheduled = new Map();
const _inflight = new Set();
export function scheduleTeamFlush(projectKey, opts = {}) {
  if (_scheduled.has(projectKey)) return _scheduled.get(projectKey);
  const p = new Promise((r) => setImmediate(r)).then(() => { _scheduled.delete(projectKey); return flushTeamMemory(projectKey, opts); });
  _scheduled.set(projectKey, p);
  _inflight.add(p);
  void p.catch(() => {}).finally(() => _inflight.delete(p));   // flushTeamMemory never rejects; keep it that way
  return p;
}
/** Await in-flight pushes (CLI before exit). Resolves after `timeoutMs` regardless. */
export async function drainTeamMemoryFlushes({ timeoutMs = 30_000 } = {}) {
  if (!_inflight.size) return;
  await Promise.race([Promise.allSettled([..._inflight]), new Promise((r) => setTimeout(r, timeoutMs).unref?.())]);
}

// ── the read path: fetch → snapshot → follow the team ─────────────────────────────────────────
/** Every note file of a worktree of the branch. Anyone with push access writes there: lstat (a committed symlink is
 *  never a directory or a file here), realpath containment, a size cap and the store's name rule. Case twins on the
 *  branch (`Deploy.md` beside `deploy.md`, pushed by hand) are skipped: a case-insensitive checkout holds one file under
 *  one spelling with the other's content. At most `maxFiles` notes and `maxBytes` in all are read (in name order). */
async function readTeamNotes(dir, { maxFiles = MAX_TEAM_READ_FILES, maxBytes = MAX_TEAM_READ_BYTES } = {}) {
  const notes = Object.create(null);   // a branch file `__proto__.md` is one more note, never this map's prototype
  const root = join(dir, ...TEAM_NOTES_REL.split('/'));
  for (const p of [join(dir, TEAM_MEMORY_DIR), root]) {
    const st = await lstat(p).catch(() => null);
    if (!st || !st.isDirectory()) return notes;
  }
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return notes;
  let ents = [];
  try { ents = await readdir(root, { withFileTypes: true }); } catch { return notes; }
  const twins = await caseTwinsOnBranch(dir);
  if (twins.size) console.warn(`[worca] team memory: ${TEAM_MEMORY_BRANCH} holds notes whose names differ only in case (${[...twins].sort().join(', ')}) — they are skipped until one of them is removed`);
  let count = 0, bytes = 0, capped = false;
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const name = e.name.slice(0, -3);
    if (!isValidMemoryName(name) || twins.has(name.toLowerCase())) continue;
    const p = join(root, e.name);
    const st = await lstat(p).catch(() => null);
    const real = st ? await realpath(p).catch(() => null) : null;
    if (!st || !st.isFile() || st.size > MAX_TEAM_FILE_BYTES || !real || !real.startsWith(rootReal + sep)) continue;
    if (count >= maxFiles || bytes + st.size > maxBytes) { capped = true; break; }
    const text = await readFile(p, 'utf8').catch(() => null);
    if (text !== null) { notes[name] = noteEntry(name, text, st.size); count++; bytes += st.size; }
  }
  if (capped) console.warn(`[worca] team memory: ${TEAM_MEMORY_BRANCH} holds more notes than this machine reads (${maxFiles} notes, ${Math.round(maxBytes / 1024 / 1024)} MiB) — the rest are skipped`);
  return notes;
}
/** The lower-cased note names the branch's HEAD holds under more than one spelling. Empty when git cannot tell. */
async function caseTwinsOnBranch(dir) {
  const ls = await runGit(dir, ['ls-files', '-z', '--', `${TEAM_NOTES_REL}/`]);
  const seen = new Set(), twins = new Set();
  if (!ls.ok) return twins;
  for (const p of ls.stdout.split('\0').filter(Boolean)) {
    const lower = p.slice(TEAM_NOTES_REL.length + 1).replace(/\.md$/, '').toLowerCase();
    if (seen.has(lower)) twins.add(lower); else seen.add(lower);
  }
  return twins;
}
/** Every note a commit on the branch REMOVED — what "a teammate deleted it" means (D3). A note that is merely absent was
 *  never deleted here: the branch was deleted and started again, or its history rewritten. null when git cannot tell. */
async function deletedOnBranch(dir, prevHead = null) {
  // The branch rewritten under this machine (a force-push back to an older commit): the head it last saw is no ancestor
  // of HEAD. A deletion before their fork point says nothing about a copy synced after it (D3: "deleted by no one") —
  // only deletions after it count. No common history (the branch started again): the new history, as always.
  let range = 'HEAD';
  let forkUnknown = false;
  if (prevHead && !(await runGit(dir, ['merge-base', '--is-ancestor', prevHead, 'HEAD'])).ok) {
    // The head it last saw may be unknown here (the checkout cloned again, its objects pruned): then where the two
    // histories fork cannot be known, and no removal is proven — an absent copy is untracked and kept, never removed.
    const known = (await runGit(dir, ['cat-file', '-e', `${prevHead}^{commit}`])).ok;
    const base = known ? await runGit(dir, ['merge-base', prevHead, 'HEAD']) : null;
    if (base?.ok && base.stdout.trim()) range = `${base.stdout.trim()}..HEAD`;
    forkUnknown = !known;
  }
  // --no-renames: a note removed in the same commit that adds a similar one is still a deletion.
  const r = await runGit(dir, ['log', '--no-renames', '--diff-filter=D', '--name-only', '--format=', range, '--', `${TEAM_NOTES_REL}/`]);
  // A note still on the branch (added again later) is not deleted, even when this machine cannot read its file (a
  // teammate's version over the reader cap): only a name absent from HEAD after a removal is a deletion.
  const head = await runGit(dir, ['ls-files', '-z', '--', `${TEAM_NOTES_REL}/`]);
  if (!r.ok || !head.ok) return null;
  if (forkUnknown) return [];
  const present = new Set(head.stdout.split('\0').filter(Boolean));
  const names = new Set();
  for (const line of r.stdout.split('\n')) {
    const p = line.trim();
    if (!p.startsWith(`${TEAM_NOTES_REL}/`) || !p.endsWith('.md') || present.has(p)) continue;
    const name = p.slice(TEAM_NOTES_REL.length + 1, -3);
    if (isValidMemoryName(name)) names.add(name);
  }
  return [...names].sort();
}
async function snapshotFromWorktree(dir, at, prevHead = null) {
  const head = await runGit(dir, ['rev-parse', 'HEAD']);
  return { schema: 1, branch: TEAM_MEMORY_BRANCH, headSha: head.ok ? head.stdout.trim() : null, fetchedAt: at, missing: false,
    notes: await readTeamNotes(dir), deleted: await deletedOnBranch(dir, prevHead) };
}

/**
 * Fetch the branch (at most every `maxAgeMs`), rewrite the snapshot and follow the team (§2.5). Off ⇒ null, no git.
 * Offline keeps the last snapshot; a branch gone from origin yields `missing: true` and deletes nothing locally.
 * @returns {Promise<null|{snapshot:object|null, followed:string[], removed:string[], adopted:string[], untracked:string[], fetched:boolean, error?:string}>}
 *   `error`: why this call could not fetch (offline, a broken worktree, a busy lock) — the last snapshot serves.
 */
export async function refreshTeamLayer(projectKey, { projectDir = null, maxAgeMs = TEAM_FETCH_TTL_MS, now = Date.now() } = {}) {
  if (!isTeamMemoryOn(projectKey)) return null;
  const idle = (snapshot, extra = {}) => ({ snapshot, followed: [], removed: [], adopted: [], untracked: [], fetched: false, ...extra });
  const recent = (iso) => { const age = now - Date.parse(iso ?? ''); return Number.isFinite(age) && age >= 0 && age < maxAgeMs; };
  // Fresh enough: a snapshot fetched — or a fetch that FAILED (offline) — within the TTL. Offline, every run start, chat
  // turn and tick would otherwise fetch again, each holding the team lock up to 60 s while pushes wait behind it.
  const fresh = async () => {
    const snap = await readTeamSnapshot(projectKey);
    return (snap && recent(snap.fetchedAt)) || recent((await readSyncState(projectKey)).lastFetchErrorAt) ? idle(snap) : null;
  };
  const early = await fresh();
  if (early) return early;
  try {
    return await withQueuedLock(lockFile(projectKey), () => refreshLocked(projectKey, { projectDir, now, idle, fresh }));
  } catch (err) {   // a busy lock (LOCK_TIMEOUT) or a broken disk: the last snapshot keeps serving, the caller is told
    return idle(await readTeamSnapshot(projectKey), { error: err?.code || String(err?.message || err) });
  }
}
/** The fetch under the team lock: fetch → snapshot → follow (§2.5). Never throws for git trouble. */
async function refreshLocked(projectKey, { projectDir, now, idle, fresh }) {
  if (!isTeamMemoryOn(projectKey)) return null;   // switched off while this refresh waited (D1): no fetch, no follow
  const done = await fresh();   // a refresh queued behind another one: that one just fetched
  if (done) return done;
  const prev = await readTeamSnapshot(projectKey);
  const dir0 = await projectDirFor(projectKey, projectDir);
  if (!dir0) return idle(prev);
  const at = new Date(now).toISOString();
  const f = await fetchTeamBranch(dir0, TEAM_MEMORY_BRANCH, { timeoutMs: 60_000 });
  let snapshot;
  if (f.ok) {
    let dir;
    try { dir = await ensureBranchWorktree(worktreeDir(projectKey), dir0, TEAM_MEMORY_BRANCH); }
    catch (err) {   // never throw out of a refresh: the last snapshot keeps serving
      const error = firstLine(err?.stderr || err?.message) || 'worktree failed';
      await writeSyncState(projectKey, { projectDir: dir0, lastFetchError: error, lastFetchErrorAt: at });
      return idle(prev, { error });
    }
    const reset = await runGit(dir, ['reset', '--hard', TEAM_REMOTE_REF]);
    if (!reset.ok) { await removeWorktreeDir(dir, dir0); return idle(prev, { error: firstLine(reset.stderr) || 'git reset failed' }); }   // recreated on the next refresh
    await runGit(dir, ['clean', '-fdq']);
    snapshot = await snapshotFromWorktree(dir, at, prev?.headSha);
  } else if (MISSING_REMOTE_REF.test(f.stderr)) {
    snapshot = { schema: 1, branch: TEAM_MEMORY_BRANCH, headSha: null, fetchedAt: at, missing: true, notes: {} };
  } else {
    const error = firstLine(f.stderr) || 'git fetch failed';
    await writeSyncState(projectKey, { projectDir: dir0, lastFetchError: error, lastFetchErrorAt: at });
    return idle(prev, { error });   // offline: the last snapshot keeps serving, the caller is told why
  }
  if (!isTeamMemoryOn(projectKey)) return null;   // switched off during the fetch: nothing is kept or followed
  writeSnapshot(projectKey, snapshot);
  await writeSyncState(projectKey, { projectDir: dir0, lastFetchAt: at, lastFetchError: null, lastFetchErrorAt: null });
  return { snapshot, ...(await reconcileTracked(projectKey, snapshot, { at })), fetched: true };
}
/** refreshTeamLayer, but a run start waits at most `waitMs`; the fetch goes on and serves the next run. */
export async function refreshTeamLayerWithin(projectKey, { projectDir = null, waitMs = TEAM_MOUNT_WAIT_MS } = {}) {
  const p = refreshTeamLayer(projectKey, { projectDir });
  p.catch(() => {});   // after a timeout nobody awaits it: never an unhandled rejection
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r({ timedOut: true }), waitMs); timer.unref?.(); });
  try { return await Promise.race([p, late]); } finally { clearTimeout(timer); }
}
/** A chat turn never waits on the network: refresh in the background for the next turn. */
export function refreshTeamLayerSoon(projectKey) { if (isTeamMemoryOn(projectKey)) void refreshTeamLayer(projectKey).catch(() => {}); }

/**
 * Follow the team (decision D3) for every local note of the scope. Untouched: a note with a share on its way, an
 * edited tracked copy (local wins), anything when the branch is missing. A teammate's DELETION is a commit on the
 * branch that removed the note (`snapshot.deleted`): an unedited tracked copy goes with it. A tracked note that is
 * merely absent — the branch was deleted and started again, or rewritten — was never deleted by anyone: it stays here
 * as a plain local note (its marker is dropped; an edit shares it again). A plain note identical to the team's starts
 * tracking. Follow writes snapshot the scope once (the old text stays restorable) and are never queued.
 */
async function reconcileTracked(key, snapshot, { at = new Date().toISOString() } = {}) {
  const followed = [], removed = [], adopted = [], untracked = [];
  if (!snapshot || snapshot.missing) return { followed, removed, adopted, untracked };
  const root = memoryRoot();
  const scope = projectScope(key);
  const caps = memoryCaps({ projectKey: key });
  const deleted = Array.isArray(snapshot.deleted) ? new Set(snapshot.deleted) : null;   // null: git could not tell
  await withStoreLock(root, async () => {
    // Read under the store lock: a writer queues inside its own store lock (the restore route), so an intent that
    // exists is seen here and its note is never followed over.
    const queued = await queuedNames(key);
    let snapped = false;
    const snapshotOnce = async () => {
      if (snapped) return;
      snapped = true;
      // A busy team must not push this machine's OWN undo history out of the ring: at the cap, the oldest follow snapshot
      // goes first — before that follow its copies held team versions, which git history keeps (D3).
      const ring = await listSnapshots(root, scope);
      const oldTeam = ring.length >= SNAPSHOT_KEEP ? ring.find((s) => /-team(-\d+)?$/.test(s.id)) : null;
      if (oldTeam) await rm(oldTeam.dir, { recursive: true, force: true });
      await snapshotScope(root, scope, { source: 'team', now: at });
    };
    for (const e of await listMemory(root, scope)) {
      if (queued.has(e.name)) continue;
      const local = await readMemory(root, scope, e.name).catch(() => null);
      if (!local) continue;
      const meta = { ...local.meta, name: e.name };
      const hash = contentHash(meta, local.body);
      const marker = meta.extra[TEAM_MARKER_KEY] || null;
      const team = byName(snapshot.notes, e.name);
      // A follow's write or removal is a compare-and-swap on the note as read (the store checks it after the scope
      // snapshot, the slow part, right before the write): an edit another process landed meanwhile (a CLI run's
      // sync-back, the Ask MCP child) is an edit, never overwritten — ESTALE, skipped below.
      const expectHash = hashText(local.text);
      try {
        if (!marker) {
          if (team && team.hash === hash && await setMemoryExtra(root, scope, e.name, TEAM_MARKER_KEY, hash, { expectHash: e.hash })) {
            writeStatus(key, e.name, { state: 'shared', hash, sharedHash: hash, kept: keptHashOf(readStatusNow(key, e.name)), reason: null, findings: null, error: null, at });
            adopted.push(e.name);
          }
          continue;
        }
        // A tracked copy whose record is gone (switched off and on, removed and added again): the marker still says it
        // was shared from here, so its sharedHash comes back — a later local deletion must still reach the team (D12).
        const st = team ? await readStatus(key, e.name) : null;
        if (team && !st?.sharedHash) writeStatus(key, e.name, st ? { ...st, sharedHash: marker } : { state: 'shared', hash: marker, sharedHash: marker, reason: null, findings: null, error: null, at });
        if (hash !== marker || (team && team.hash === marker)) continue;   // edited here — or already in sync
        if (team) {
          const t = parseMemoryFile(team.text);
          const text = renderMemoryFile({ ...t.meta, name: e.name, extra: { ...t.meta.extra, [TEAM_MARKER_KEY]: team.hash } }, t.body);
          // Never clip a teammate's hook here: a clipped description would read as a local edit forever after.
          const hookMaxChars = Math.max(caps.hookMaxChars || 0, flattenLine(t.meta.description).trim().length);
          await writeMemory(root, scope, e.name, text, { source: 'team', now: at, caps: { ...caps, hookMaxChars }, snapshot: snapshotOnce, expectHash });
          // A teammate's version is no edit SHARED from here: the note's baseline (1b: Take team's opt-in text) stays (D1).
          writeStatus(key, e.name, { state: 'shared', hash: team.hash, sharedHash: team.hash, kept: keptHashOf(readStatusNow(key, e.name)), reason: null, findings: null, error: null, at });
          followed.push(e.name);
        } else if (deleted?.has(e.name)) {
          await removeMemory(root, scope, e.name, { source: 'team', now: at, snapshot: snapshotOnce, expectHash });
          // A tombstone (`removed`): a TEAMMATE deleted it, not this machine. A restore that brings the copy back (its
          // snapshot's `team:` line with it) keeps it tracked, so it follows that deletion again — never re-shared (D3).
          // The note's baseline stays (1b: Take team's opt-in text, restored from History, uploads nothing).
          writeStatus(key, e.name, { state: 'removed', hash, sharedHash: null, kept: keptHashOf(readStatusNow(key, e.name)), reason: null, findings: null, error: null, at });
          removed.push(e.name);
        } else if (deleted && await setMemoryExtra(root, scope, e.name, TEAM_MARKER_KEY, null, { expectHash: e.hash })) {
          writeStatus(key, e.name, baselineRecord(hash, keptHashOf(readStatusNow(key, e.name)), at));
          untracked.push(e.name);
        }
      } catch (err) {
        if (err?.code === 'ESTALE') continue;   // edited meanwhile: local wins, the next refresh sees the edit
        // A team version over this machine's per-file cap (a teammate's larger cap) can never be followed here: untrack
        // the copy so the next refresh does not try again — it stays as a plain local note, shadowing the team's.
        const tooBig = err?.code === 'ETOOBIG' && await setMemoryExtra(root, scope, e.name, TEAM_MARKER_KEY, null, { expectHash: e.hash }).catch(() => false);
        if (tooBig) writeStatus(key, e.name, baselineRecord(hash, keptHashOf(readStatusNow(key, e.name)), at));
        console.warn(`[worca] team memory: ${e.name}.md could not follow the team (${err?.code || err?.message || err}) — the local copy stays${tooBig ? ' as a plain local note' : ''}`);
      }
    }
  });
  if (followed.length || removed.length || untracked.length) emit(key, 'followed', { followed, removed, untracked });
  return { followed, removed, adopted, untracked };
}

// ── the mount: rules copy only ─────────────────────────────────────────────────────────────────
const rankTeam = (notes) => Object.keys(notes).sort((a, b) =>
  String(notes[b].updated || '').localeCompare(String(notes[a].updated || '')) || (a < b ? -1 : a > b ? 1 : 0));
/** The rules-copy folder of one mounted project dir: `team` on a single-project run (or chat), `team/<key>` per workspace member. */
export function teamMountRel(d) { return d.rel === 'project' ? 'team' : `team/${d.scope.projectKey}`; }
/** Pure: the team notes a run or chat LOADS, in load order — not shadowed by a local note of the same name
 *  (case-insensitive: the store refuses case twins), no bigger than the local per-file cap (a hand-pushed giant never
 *  fills an agent's context), newest `maxFiles` first. One rule for the mount and the status API's `mounted`. */
export function teamMountNames(notes, localNames, { maxFiles = 0, maxBytes = 0 } = {}) {
  const shadowed = new Set([...(localNames || [])].map((n) => String(n).toLowerCase()));
  return rankTeam(notes || {})
    .filter((n) => !shadowed.has(n.toLowerCase()) && !(maxBytes > 0 && notes[n].bytes > maxBytes))
    .slice(0, maxFiles > 0 ? maxFiles : undefined);
}
/** Pure: what a project whose team memory loads team notes only (`memory.team: "only"`) loads, over teamNoteStates
 *  rows. Its local notes that ARE team notes — `shared` (a tracked copy) and `pending` (on its way to the team: loads
 *  before its push lands) — and the team's other notes: never shadowed by a local note that does not load, still by a
 *  queued intent (a removal on its way), none over the local per-file cap. Newest `maxFiles` of them IN ALL.
 *  @returns {{local:Set<string>, team:Set<string>}} the local notes (into project/) and the team's (into team/) */
export function teamOnlyLoad({ rows = [], snapshot = null, queued = [], maxFiles = 0, maxBytes = 0 }) {
  const team = snapshot && !snapshot.missing ? snapshot.notes || {} : {};
  const local = rows.filter((r) => r.local && (r.state === 'shared' || r.state === 'pending'));
  const shadowed = new Set([...local.map((r) => r.name), ...queued].map((n) => String(n).toLowerCase()));
  const picks = [
    ...local.map((r) => ({ name: r.name, updated: r.updated, local: true })),
    ...Object.keys(team).filter((n) => !shadowed.has(n.toLowerCase()) && !(maxBytes > 0 && team[n].bytes > maxBytes))
      .map((n) => ({ name: n, updated: team[n].updated, local: false })),
  ].sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, maxFiles > 0 ? maxFiles : undefined);
  return { local: new Set(picks.filter((p) => p.local).map((p) => p.name)), team: new Set(picks.filter((p) => !p.local).map((p) => p.name)) };
}
/** A hold (1b: a same-name clash the user skipped while seeding) lasts while the team holds a note of that name,
 *  case-insensitively — and while this machine cannot tell (no snapshot yet: the next fetch decides). The team's note
 *  gone (a teammate deleted it, the branch is gone): a plain local note again. Pure. */
export function holdApplies(snapshot, name) {
  if (!snapshot) return true;
  if (snapshot.missing) return false;
  const lower = String(name).toLowerCase();
  return Object.keys(snapshot.notes || {}).some((n) => n.toLowerCase() === lower);
}
/** The team's note for local name `name`: that name, else its case variant (one file per name, D9). Pure. */
function teamNoteFor(snapshot, name) {
  const notes = snapshot && !snapshot.missing ? snapshot.notes || {} : {};
  const tName = Object.hasOwn(notes, name) ? name : Object.keys(notes).find((n) => n.toLowerCase() === name.toLowerCase());
  return tName ? { ...notes[tName], name: tName } : null;
}
/** The team notes one project LOADS (teamMountNames over the last snapshot). No fetch here. */
export async function teamMountNotes(projectKey) {
  const snap = await readTeamSnapshot(projectKey);
  if (!snap || snap.missing) return [];
  // A queued intent shadows the team's copy like a local note does: a note this machine is removing from the team (an
  // agent emptied it, a forget) must not load back as a team note while that push is on its way.
  const local = [...(await listMemory(memoryRoot(), projectScope(projectKey))).map((e) => e.name), ...(await queuedNames(projectKey))];
  const caps = memoryCaps({ projectKey });
  return teamMountNames(snap.notes, local, { maxFiles: caps.teamMaxFiles, maxBytes: caps.hardBytesPerFile })
    .map((name) => ({ name, text: snap.notes[name].text }));
}
/** Make `dir` hold exactly `notes` (*.md): per-file atomic writes, other *.md removed, sub-directories and another
 *  writer's in-flight temp files untouched. A file that cannot be written keeps its previous copy. */
export async function writeTeamDir(dir, notes, { dirMode, fileMode } = {}) {
  await mkdir(dir, { recursive: true, mode: dirMode });
  const keep = new Set();
  for (const n of notes) {
    const target = join(dir, `${n.name}.md`);
    keep.add(`${n.name}.md`);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    try { await writeFile(tmp, n.text, { encoding: 'utf8', mode: fileMode }); await rename(tmp, target); }
    catch { await rm(tmp, { force: true }).catch(() => {}); }
  }
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isFile() || keep.has(e.name) || /\.md\.tmp-\d+-\d+$/.test(e.name)) continue;
    await rm(join(dir, e.name), { force: true });
  }
}
/**
 * What one project LOADS (team-memory-load-choice.md): `local` (off: its local notes) · `both` (its local notes, and the
 * team notes teamMountNames picks) · `team` (teamOnlyLoad: `localNames` limits its local notes). No fetch here.
 * @returns {Promise<{load:'local'|'both'|'team', localNames:Set<string>|null, team:Array<{name:string,text:string}>}>}
 *   `localNames` null = every local note
 */
export async function memoryLoadPlan(projectKey) {
  const load = teamMemoryLoadOf(projectKey);
  if (load === 'local') return { load, localNames: null, team: [] };
  if (load === 'both') return { load, localNames: null, team: await teamMountNotes(projectKey) };
  const caps = memoryCaps({ projectKey });
  const { snapshot, rows, queued } = await noteRows(projectKey, caps);
  const sets = teamOnlyLoad({ rows, snapshot, queued: [...queued.keys()], maxFiles: caps.teamMaxFiles, maxBytes: caps.hardBytesPerFile });
  return { load, localNames: sets.local, team: [...sets.team].map((name) => ({ name, text: snapshot.notes[name].text })) };
}
/** The project dirs of `dirs` that load only some of their local notes, given `only` (mountMemory's filter); the other
 *  dirs as they are. `plans`: Map(projectKey → memoryLoadPlan). */
export function loadFilteredDirs(dirs, plans) {
  return (dirs || []).map((d) => {
    const names = d.scope?.kind === 'project' ? plans?.get(d.scope.projectKey)?.localNames : null;
    return names ? { ...d, only: names } : d;
  });
}
/** memoryLoadPlan for every project dir of `dirs`: Map(projectKey → plan). A project whose plan fails loads as `both`
 *  would without a team folder — its local notes — and the failure is warned. */
export async function memoryLoadPlans(dirs) {
  const plans = new Map();
  for (const d of dirs || []) {
    if (d.scope?.kind !== 'project' || plans.has(d.scope.projectKey)) continue;
    const key = d.scope.projectKey;
    try { plans.set(key, await memoryLoadPlan(key)); }
    catch (err) { console.warn(`[worca] team memory: ${key}: what to load could not be read (${err?.code || err?.message || err}) — its local notes load`); }
  }
  return plans;
}
/**
 * Write the team folder(s) of a READ-ONLY rules copy (decision D2) for every opted-in project dir in `dirs`; a project
 * that is off gets its folder emptied if one exists. Called after refreshTeamLayer; never fetches. `plans`
 * (memoryLoadPlans, the ones the local copies were mounted with) — read here when not given.
 * @returns {Promise<Array<{key:string, rel:string, count:number, load:string}>>} one entry per opted-in project
 */
export async function mountTeamLayer({ rules, dirs, plans = null, modes = {} }) {
  const out = [];
  for (const d of dirs || []) {
    if (d.scope?.kind !== 'project') continue;
    const key = d.scope.projectKey;
    const rel = teamMountRel(d);
    const target = join(rules, ...rel.split('/'));
    // One workspace member that cannot be mounted (a disk error) never costs the next one its team notes.
    try {
      const plan = plans?.get(key) ?? (plans ? null : await memoryLoadPlan(key));
      if (!plan || plan.load === 'local') { if (existsSync(target)) await writeTeamDir(target, [], modes); continue; }
      const notes = plan.team;
      await writeTeamDir(target, notes, modes);
      out.push({ key, rel, count: notes.length, load: plan.load });
    } catch (err) {
      console.warn(`[worca] team memory: ${key}: team notes not mounted (${err?.code || err?.message || err})`);
    }
  }
  return out;
}

/** syncBack's result → Map(projectKey → names) over the PROJECT dirs only: a global note never becomes a team change. */
export function teamChangesFromSync(res, dirs) {
  const keyOf = new Map((dirs || []).filter((d) => d.scope?.kind === 'project').map((d) => [d.rel, d.scope.projectKey]));
  const out = new Map();
  for (const r of [...(res?.added || []), ...(res?.modified || []), ...(res?.deleted || [])]) {
    const key = keyOf.get(r.scope);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r.name);
  }
  return out;
}
/** Names whose file appeared, changed or disappeared between two listMemory() results (a restore's diff). */
export function changedNoteNames(before, after) {
  const was = new Map((before || []).map((e) => [e.name, e.hash]));
  const now = new Map((after || []).map((e) => [e.name, e.hash]));
  return [...new Set([...was.keys(), ...now.keys()])].filter((n) => was.get(n) !== now.get(n)).sort();
}

// ── Ask: read-only views ──────────────────────────────────────────────────────────────────────
/** The team notes of a project for list_memory; null when the project is off. */
export async function teamListing(projectKey) {
  if (!isTeamMemoryOn(projectKey)) return null;
  const snap = await readTeamSnapshot(projectKey);
  if (!snap || snap.missing) return [];
  // Team notes only: a local note that does not load shadows nothing (memoryLoadPlan).
  const loaded = teamMemoryLoadOf(projectKey) === 'team' ? (await memoryLoadPlan(projectKey)).localNames : null;
  const local = new Set((loaded ? [...loaded] : (await listMemory(memoryRoot(), projectScope(projectKey))).map((e) => e.name)).map((n) => n.toLowerCase()));
  const queued = new Set([...(await queuedNames(projectKey))].map((n) => n.toLowerCase()));
  // A note this machine is removing from the team (queued, no local copy; any case — a push removes every case variant,
  // D9) is no team note any more: the same rule as the mount.
  return Object.keys(snap.notes).sort().filter((name) => local.has(name.toLowerCase()) || !queued.has(name.toLowerCase())).map((name) => {
    const n = snap.notes[name];
    return { name, description: n.description, paths: n.paths, updated: n.updated, author: n.author, shadowed: local.has(name.toLowerCase()) };
  });
}
/** One team note for read_memory / remember / forget: {name, meta, body, author} or null. Case-insensitive, like the mount
 *  and shadowing (one file per name, D9): `name` is the team's spelling, which a write must keep. */
export async function readTeamNote(projectKey, name) {
  if (!isTeamMemoryOn(projectKey) || !isValidMemoryName(name)) return null;
  const n = teamNoteFor(await readTeamSnapshot(projectKey), name);
  if (!n || [...(await queuedNames(projectKey))].some((q) => q.toLowerCase() === name.toLowerCase())) return null;   // being removed from the team by this machine (any case: D9)
  const { meta, body } = parseMemoryFile(n.text);
  return { name: n.name, meta: { ...meta, name: n.name }, body, author: n.author };
}

// ── status for the API / CLI / phase 1b ────────────────────────────────────────────────────────
/** Pure: one row per name across the local store, the records, the queue and the snapshot (§2.6). */
export function teamNoteStates({ local = [], statuses = {}, queued = new Set(), snapshot = null, maxFiles = 0, maxBytes = 0, load = 'both' }) {
  const team = snapshot && !snapshot.missing ? snapshot.notes || {} : {};
  const localBy = new Map(local.map((l) => [l.name, l]));
  // `queued`: the queued names, or a Map name → the intent's op (a team delete stays `deleting` under a blocked edit).
  const queuedNames = queued instanceof Map ? [...queued.keys()] : [...queued];
  const mounted = new Set(teamMountNames(team, [...local.map((l) => l.name), ...queuedNames], { maxFiles, maxBytes }));
  const teamLower = new Set(Object.keys(team).map((n) => n.toLowerCase()));   // shadowing is case-insensitive (teamMountNames)
  const names = [...new Set([...localBy.keys(), ...Object.keys(team), ...Object.keys(statuses), ...queuedNames])].sort();
  const rows = [];
  for (const name of names) {
    const l = localBy.get(name) || null;
    const t = byName(team, name);
    const s = byName(statuses, name);
    const row = { name, local: !!l, team: !!t, mounted: mounted.has(name), updated: l?.updated || t?.updated || null, author: t?.author || null };
    if (queued.has(name)) rows.push({ ...row, state: l && s?.state !== 'deleting' && !(queued instanceof Map && queued.get(name) === 'delete') ? 'pending' : 'deleting', error: s?.error || null });
    else if (l && s?.state === 'blocked' && s.hash === l.hash) rows.push({ ...row, state: 'blocked', reason: s.reason || '', findings: s.findings || [] });
    // 1b: a held clash — the team holds a different note of this name and no change of it is shared until resolved.
    else if (l && s?.state === 'held' && holdApplies(snapshot, name)) rows.push({ ...row, state: 'held' });
    else if (l && l.marker && l.marker === l.hash) rows.push({ ...row, state: 'shared', behind: t ? t.hash !== l.hash : !!snapshot && !snapshot.missing });
    else if (l) rows.push({ ...row, state: 'local', shadows: teamLower.has(name.toLowerCase()) });
    else if (t) rows.push({ ...row, state: 'team' });
  }
  // Team notes only: `mounted` says whether THIS row's copy loads — a local row's local copy (a held or plain local note
  // does not, the team's version of its name may), a teammate's row the team's.
  if (load === 'team') {
    const sets = teamOnlyLoad({ rows, snapshot, queued: queuedNames, maxFiles, maxBytes });
    for (const r of rows) r.mounted = r.local ? sets.local.has(r.name) : sets.team.has(r.name);
  }
  return rows;
}
/** This machine's notes of a project as the team layer compares them: name → {text, meta, body, hash, marker, updated}. */
async function readLocalNotes(projectKey) {
  const scope = projectScope(projectKey);
  const out = new Map();
  for (const e of await listMemory(memoryRoot(), scope)) {
    const f = await readMemory(memoryRoot(), scope, e.name).catch(() => null);
    if (f) out.set(e.name, { ...f, hash: contentHash({ ...f.meta, name: e.name }, f.body), marker: f.meta.extra[TEAM_MARKER_KEY] || null, updated: f.meta.updated || null });
  }
  return out;
}
/** name → the op of its newest intent: a claim being pushed, then the outbox (written after it). */
async function readQueuedOps(projectKey) {
  const queued = new Map();
  for (const d of [inflightDir(projectKey), outboxDir(projectKey)]) for (const f of await jsonFiles(d)) queued.set(f.slice(0, -'.json'.length), (await readJson(join(d, f)))?.op || 'sync');
  return queued;
}
/** teamNoteStates over what is on disk now: the status API, the seeding's preview and its compare-and-swap. */
async function noteRows(projectKey, caps) {
  const local = await readLocalNotes(projectKey);
  const snapshot = await readTeamSnapshot(projectKey);
  const queued = await readQueuedOps(projectKey);
  const rows = teamNoteStates({
    local: [...local].map(([name, f]) => ({ name, hash: f.hash, marker: f.marker, updated: f.updated })),
    statuses: await readStatuses(projectKey), queued, snapshot,
    maxFiles: caps.teamMaxFiles, maxBytes: caps.hardBytesPerFile, load: teamMemoryLoadOf(projectKey),
  });
  return { local, snapshot, rows, queued };
}
/** 'pending' until a seeding is finished ('done') or the offer dismissed ('dismissed'). */
export async function readSeedOffer(projectKey) {
  const s = isKey(projectKey) ? await readJson(offerFile(projectKey)) : null;
  return s?.state === 'done' || s?.state === 'dismissed' ? s.state : 'pending';
}
const writeSeedOffer = (key, state, at) => writeJsonAtomic(offerFile(key), { schema: 1, state, at });
async function readSeedJournal(key) {
  const j = await readJson(seedFile(key));
  return j && j.schema === 1 && j.decisions && typeof j.decisions === 'object' && !Array.isArray(j.decisions) ? j : null;
}
/** The last seeding as the Team view names it (its Undo is offered while this is not null). */
async function lastSeed(projectKey) {
  const j = await readSeedJournal(projectKey);
  if (!j) return null;
  const count = (action) => Object.values(j.decisions).filter((d) => d?.action === action).length;
  return { at: j.at || null, snapshotId: j.snapshotId || null, shared: count('share'), tookTeam: count('take-team'), held: count('skip') };
}
export async function teamMemoryStatus(projectKey) {
  const caps = memoryCaps(isKey(projectKey) ? { projectKey } : null);
  const enabled = isTeamMemoryOn(projectKey);
  const base = { projectKey, enabled, load: teamMemoryLoadOf(projectKey), branch: TEAM_MEMORY_BRANCH, caps: { localMaxFiles: caps.maxFilesPerScope, teamMaxFiles: caps.teamMaxFiles }, available: teamMemoryAvailability(projectKey) };
  const seed = { offer: await readSeedOffer(projectKey), last: enabled ? await lastSeed(projectKey) : null };
  if (!enabled) {
    // Whether the switch would turn on, and why not (D8) — null when no checkout of the project is known here.
    const dir = await projectDirFor(projectKey);
    const err = dir ? await teamMemoryStartError(dir) : null;
    return { ...base, remote: null, counts: {}, notes: [], seed, canStart: dir ? !err : null, startError: err ? { code: err.code, message: err.message } : null };
  }
  const { snapshot, rows: notes } = await noteRows(projectKey, caps);
  const sync = await readSyncState(projectKey);
  const counts = {};
  for (const n of notes) counts[n.state] = (counts[n.state] || 0) + 1;
  return {
    ...base, counts, notes, seed,
    remote: {
      exists: snapshot ? !snapshot.missing : null, headSha: snapshot?.headSha ?? null, fetchedAt: snapshot?.fetchedAt ?? null,
      lastSyncAt: sync.lastSyncAt ?? null, lastError: sync.lastError ?? null, lastErrorCode: sync.lastErrorCode ?? null,
      lastErrorAt: sync.lastErrorAt ?? null, hint: sync.hint ?? null, lastFetchError: sync.lastFetchError ?? null,
    },
  };
}
/** "Not now" on the offer: closed for good (the Team view's button stays). */
export async function dismissSeedOffer(projectKey, { now = new Date().toISOString() } = {}) {
  if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
  if ((await readSeedOffer(projectKey)) === 'pending') writeSeedOffer(projectKey, 'dismissed', now);
  emit(projectKey, 'seed-dismissed');
  return { offer: await readSeedOffer(projectKey) };
}

// ── a team already sharing (decision E10) ──────────────────────────────────────────────────────────────────
// Adding a project never fetches the branch and leaves the switch off, so a check right after the add asks `origin`
// whether it has one: "Your team shares memory for this repository" with Turn on / Not now. It only ever offers —
// switching on stays the person's act, through the normal switch. Beside offers/: a switch-off or an unregister
// keeps it, so Not now holds for good on this machine and a project added again is not asked twice.
const availableFile = (key) => join(teamMemoryRoot(), 'available', `${key}.json`);
export const TEAM_DETECT_TIMEOUT_MS = 10_000;
function readAvailable(key) {
  try { const j = JSON.parse(readFileSync(availableFile(key), 'utf8')); return j && j.schema === 1 ? j : null; } catch { return null; }
}
const writeAvailable = (key, fields) => writeJsonAtomic(availableFile(key), { schema: 1, branchOnOrigin: null, checkedAt: null, state: 'pending', ...readAvailable(key), ...fields });
/** What the add-time check found (synchronous: the project list reads it per row). `branchOnOrigin` null: never
 *  checked, or the check could not reach origin. `state`: pending | dismissed (Not now) | accepted (switched on once).
 *  `offer`: the line shows — the branch is there, the project is off, and the offer was neither dismissed nor taken. */
export function teamMemoryAvailability(projectKey) {
  const a = isKey(projectKey) ? readAvailable(projectKey) : null;
  const branchOnOrigin = typeof a?.branchOnOrigin === 'boolean' ? a.branchOnOrigin : null;
  const state = a?.state === 'dismissed' || a?.state === 'accepted' ? a.state : 'pending';
  return { branchOnOrigin, checkedAt: a?.checkedAt || null, state, offer: branchOnOrigin === true && state === 'pending' && !isTeamMemoryOn(projectKey) };
}
/** After a project is registered (Add, Clone, the bulk import, `worca add`): does `origin` have the team branch? One
 *  `git ls-remote --heads` with worca's own credential and hooks off (runGit), bounded by `timeoutMs`. Skipped where
 *  the switch could not turn on (no git, a Folder project, no origin). Never throws: an unreachable origin keeps the
 *  last verdict. @returns {Promise<boolean|null>} null when skipped or failed */
export async function detectTeamMemory(projectDir, { timeoutMs = TEAM_DETECT_TIMEOUT_MS, now = new Date().toISOString() } = {}) {
  try {
    const p = projectDir ? getProjectByPath(projectDir) : null;
    if (!p || !isKey(p.key) || await teamMemoryStartError(p.path)) return null;
    const r = await runGit(p.path, ['ls-remote', '--heads', 'origin', TEAM_MEMORY_BRANCH], { timeoutMs });
    if (!r.ok) return null;
    const found = r.stdout.split('\n').some((l) => l.trim().split(/\s+/)[1] === `refs/heads/${TEAM_MEMORY_BRANCH}`);
    writeAvailable(p.key, { branchOnOrigin: found, checkedAt: now });
    emit(p.key, 'available', { branchOnOrigin: found });
    return found;
  } catch { return null; }
}
/** Not now on the line: never shown again on this machine. */
export function dismissTeamMemoryOffer(projectKey) {
  if (!isKey(projectKey)) throw teamError('EBADREQ', 'invalid project key');
  writeAvailable(projectKey, { state: 'dismissed' });
  emit(projectKey, 'available-dismissed');
  return teamMemoryAvailability(projectKey);
}

// ── the switch ─────────────────────────────────────────────────────────────────────────────────
/** Why the switch cannot turn on for this checkout, or null (decision D8). Team memory fetches, checks out and pushes
 *  with git only — it has no HTTPS transport — so it needs git on this machine, a git project (a `.git`, and not
 *  registered as a Folder project) and an `origin` that `git remote` lists. Not projectSlug: since the git-free P6 it
 *  answers from `.git/config` or a typed team repo when git is missing, which is no remote team memory can reach.
 *  @returns {Promise<Error|null>} code NO_GIT | FOLDER_PROJECT | NO_ORIGIN, status 400 */
export async function teamMemoryStartError(projectDir) {
  if (!(await gitState()).available) return teamError('NO_GIT', 'team memory needs git on this machine: the team layer is fetched and pushed with git (install git, then switch it on)', { status: 400 });
  if (!projectDir || !existsSync(join(projectDir, '.git')) || getProjectByPath(projectDir)?.vcs === 'none') {
    return teamError('FOLDER_PROJECT', 'team memory needs a git project: this is a Folder project, and the team layer lives on a worca-memory branch of its repository', { status: 400 });
  }
  const { remotes } = await listRemotes(projectDir);
  if (!remotes.some((r) => r.name === 'origin')) return teamError('NO_ORIGIN', 'team memory needs an `origin` remote: the team layer lives on its worca-memory branch', { status: 400 });
  return null;
}
/** Refuse the switch (decision D8). @throws {Error} code NO_GIT | FOLDER_PROJECT | NO_ORIGIN, status 400 */
export async function assertTeamMemoryCanStart(projectDir) {
  const err = await teamMemoryStartError(projectDir);
  if (err) throw err;
}
/** Switching on shares only NEW and CHANGED notes (decision D1): right BEFORE the switch is written, every note that
 *  exists gets a `kept` record of its content, so a later Save without an edit (the Memory page's Save, an Ask remember
 *  of the same text) is no change — only a real edit shares it. That includes a tracked copy edited while the project
 *  was off (its marker no longer matches it, refine cycle 6); an UNEDITED tracked copy keeps its marker and follows the
 *  team (D3). Already on, it records nothing. 1b's seeding (`force`) goes past it. Called through switchTeamMemoryOn.
 *  @returns {Promise<number>} the notes recorded */
export async function recordExistingNotes(projectKey) {
  if (!isKey(projectKey) || isTeamMemoryOn(projectKey)) return 0;
  const scope = projectScope(projectKey);
  const at = new Date().toISOString();
  const { hookMaxChars } = memoryCaps({ projectKey });
  let n = 0;
  for (const e of await listMemory(memoryRoot(), scope)) {
    const f = await readMemory(memoryRoot(), scope, e.name).catch(() => null);
    if (!f) continue;
    const hash = contentHash({ ...f.meta, name: e.name }, f.body);
    // Unedited since its sync: it follows the team (D3). Its marker says it was shared from here, so its record says so
    // at once — a local deletion before the first fetch lands (offline) must still reach the team (D12).
    if (f.meta.extra[TEAM_MARKER_KEY] === hash) { writeStatus(projectKey, e.name, { state: 'shared', hash, sharedHash: hash, reason: null, findings: null, error: null, at }); continue; }
    // The content as a Save without an edit stores it (writeMemory's repair): a hand-dropped note gains its frontmatter
    // and a derived hook — but a hook it leaves as it is is never clipped, however long — and that form is what the
    // queue sees.
    const fixed = parseMemoryFile(repairMemoryFile(f.text, { name: e.name, source: 'user', now: at, hookMaxChars: Math.max(hookMaxChars ?? 0, flattenLine(f.meta.description).trim().length) }).text);
    writeStatus(projectKey, e.name, keptRecord(contentHash({ ...fixed.meta, name: e.name }, fixed.body), at));
    n++;
  }
  return n;
}
/** Switch team memory on (API, CLI): refuse a project without `origin` (D8), then record what exists and write the
 *  switch — `writeSwitch`, synchronous — UNDER the team lock. A switch-off's discard holds that lock from its "still
 *  off?" check to its last rm, so neither an off-then-on in quick succession nor the server tick's discard can delete
 *  the new baseline (D1, refine cycle 6). While off no writer queues, so nothing else races the baseline. */
export async function switchTeamMemoryOn(projectKey, projectDir, writeSwitch) {
  await assertTeamMemoryCanStart(projectDir);
  await withQueuedLock(lockFile(projectKey), async () => { await recordExistingNotes(projectKey); writeSwitch(); });
  // The add-time offer is taken (E10): a later switch-off is a choice, never answered by the line again.
  if (readAvailable(projectKey)) { writeAvailable(projectKey, { state: 'accepted' }); emit(projectKey, 'available'); }
}
/** After `memory.team` changed (API, CLI): on ⇒ fetch now; off ⇒ drop everything this machine holds for the team. */
export async function teamMemorySettingChanged(projectKey, projectDir = null) {
  if (isTeamMemoryOn(projectKey)) return refreshTeamLayer(projectKey, { projectDir, maxAgeMs: 0 });
  await discardTeamState(projectKey, { projectDir });
  return null;
}
/** Off (D1): the queue, the records, the snapshot and the worktree go — nothing queued earlier can be pushed later.
 *  The markers in local notes stay (harmless; they matter again only if the project is switched back on). */
export async function discardTeamState(projectKey, { projectDir = null } = {}) {
  if (!isKey(projectKey) || !existsSync(keyDir(projectKey))) return false;
  // The queue goes NOW, before any wait (D1): a lock held by a long push, or a lock timeout, must not keep it alive
  // until the project is switched on again. Writers re-check the switch before every intent, so none lands after this;
  // a push already under way still lands.
  if (!isTeamMemoryOn(projectKey)) {
    // A running push's claims go too: if it fails it has nothing to put back (failFlush drops them when off).
    await rm(outboxDir(projectKey), { recursive: true, force: true });
    await rm(inflightDir(projectKey), { recursive: true, force: true });
  }
  try {
    return await withQueuedLock(lockFile(projectKey), async () => {
      if (isTeamMemoryOn(projectKey)) return false;   // switched on again while this waited: its new queue stays
      const wt = worktreeDir(projectKey);
      // A checkout that still exists: sync.json may name a linked worktree a CLI run started from, deleted since.
      if (existsSync(wt)) await removeWorktreeDir(wt, (projectDir && existsSync(projectDir) ? projectDir : null) || await projectDirFor(projectKey));
      await rm(keyDir(projectKey), { recursive: true, force: true, maxRetries: 3 });
      emit(projectKey, 'discarded');
      return true;
    });
  } catch {
    return false;   // the lock stayed busy (LOCK_TIMEOUT): the queue is already gone; the tick or the next flush tidies the rest
  }
}

/** UI server: on start and every TEAM_TICK_MS, push what is queued and refresh every opted-in project; a project that
 *  is off (or gone) keeps no local team state. Returns a stop function. */
export function startTeamMemoryBackground({ log = (m) => console.warn(m) } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const p of (await listProjects()).filter((x) => x && x.exists !== false)) {
        if (!isTeamMemoryOn(p.key)) continue;
        try {
          if ((await queuedNames(p.key)).size) await scheduleTeamFlush(p.key, { projectDir: p.path });
          await refreshTeamLayer(p.key, { projectDir: p.path });
        } catch (err) { log(`[worca-ui] team memory ${p.name || p.key}: ${err?.message || err}`); }
      }
      let keys = [];
      try { keys = (await readdir(join(teamMemoryRoot(), 'projects'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* none yet */ }
      for (const key of keys) if (isKey(key) && !isTeamMemoryOn(key)) await discardTeamState(key).catch(() => {});
    } catch (err) { log(`[worca-ui] team memory: ${err?.message || err}`); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), TEAM_TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ── seeding existing notes, holds, Compare and Undo (phase 1b) ─────────────────────────────────────────────────
const SEED_ACTIONS = new Set(['share', 'take-team', 'skip']);
const HASH_RE = /^[0-9a-f]{40}$/;
/** A user's decisions, checked before anything is read: `share` (on a clash: keep mine), `take-team`, `skip` (a clash, held). */
function seedDecisions(input) {
  if (!Array.isArray(input) || !input.length) throw teamError('EBADREQ', 'decisions must be a non-empty array of {name, action, hash, teamHash}');
  if (input.length > 1000) throw teamError('EBADREQ', 'at most 1000 decisions');
  const seen = new Set();
  return input.map((d) => {
    const name = typeof d?.name === 'string' ? d.name : '';
    if (!isValidMemoryName(name)) throw teamError('EBADREQ', `invalid memory name ${JSON.stringify(name)}`);
    if (!SEED_ACTIONS.has(d.action)) throw teamError('EBADREQ', `${name}: action must be share, take-team or skip`);
    if (typeof d.hash !== 'string' || !HASH_RE.test(d.hash)) throw teamError('EBADREQ', `${name}: hash (the note as reviewed) is required`);
    const teamHash = d.teamHash ?? null;
    if (teamHash !== null && (typeof teamHash !== 'string' || !HASH_RE.test(teamHash))) throw teamError('EBADREQ', `${name}: teamHash must be a hash or null`);
    if (seen.has(name.toLowerCase())) throw teamError('EBADREQ', `${name}: listed twice`);
    seen.add(name.toLowerCase());
    return { name, action: d.action, hash: d.hash, teamHash };
  });
}
/** The team's version as a local tracked copy: the follow's form (reconcileTracked), its marker = its hash. */
function teamCopyText(t) {
  const tm = parseMemoryFile(t.text);
  return renderMemoryFile({ ...tm.meta, name: t.name, extra: { ...tm.meta.extra, [TEAM_MARKER_KEY]: t.hash } }, tm.body);
}

/**
 * What a seeding can do (1b), against the branch as it is now — a fetch first; offline, the last snapshot (`fetchError`
 * says why). Every note of this machine the team does not hold as it is: `local` rows, `held` clashes and `blocked`
 * notes with their reason, each with the gate's verdict (a dry run: nothing is recorded) and, where the team holds a
 * note of that name (case-insensitively), the team's version beside it. `name`: one note (the Team view's Compare).
 */
export async function previewTeamSeed(projectKey, { projectDir = null, name = null } = {}) {
  if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
  const refresh = await refreshTeamLayer(projectKey, { projectDir, maxAgeMs: 0 });
  const caps = memoryCaps({ projectKey });
  const { local, snapshot, rows } = await noteRows(projectKey, caps);
  const notes = [];
  for (const row of rows) {
    if (!['local', 'held', 'blocked'].includes(row.state) || (name !== null && row.name !== name)) continue;
    const f = local.get(row.name);
    if (!f) continue;
    const findings = row.state === 'blocked' ? row.findings : noteFindings({ ...f.meta, name: row.name }, f.body, f.text);
    const t = teamNoteFor(snapshot, row.name);
    notes.push({
      name: row.name, state: row.state, hash: f.hash, description: f.meta.description || '',
      // A recorded verdict (state `blocked`: an edit the gate blocked, the host's refusal) is blocked whatever its findings
      // say: it is listed with its reason and is never a decision — the commit's compare-and-swap refuses it (E3).
      blocked: findings.length || row.state === 'blocked' ? { reason: row.reason || describeFindings(findings), findings } : null,
      ...(t ? { text: f.text } : {}),   // the side-by-side only: a checklist row needs no body
      team: t ? {
        name: t.name, hash: t.hash, text: t.text, author: t.author || null, updated: t.updated || null, bytes: t.bytes,
        same: t.hash === f.hash, tooBig: !!caps.hardBytesPerFile && t.bytes > caps.hardBytesPerFile,
      } : null,
    });
  }
  return {
    projectKey, fetchedAt: snapshot?.fetchedAt ?? null, fetchError: refresh?.error ?? null,
    branchExists: snapshot ? !snapshot.missing : null, offer: await readSeedOffer(projectKey), notes,
  };
}

const staleError = (names) => teamError('STALE', 'Some notes changed since you reviewed them — review them again.', { names });
/** Seeding (`journal`) and Compare share ONE apply: compare-and-swap on what the user reviewed, then take-team writes,
 *  holds and ONE forced queue call — under the team lock, then the store lock, then the queue turn (the restore route's
 *  store lock → turn order; nothing awaits the team lock inside the store lock). Inside the turn: queueNow, never
 *  queueTeamChanges (a turn inside a turn waits for itself). */
async function applyTeamDecisions(projectKey, list, { journal, source, now }) {
  const root = memoryRoot();
  const scope = projectScope(projectKey);
  return withQueuedLock(lockFile(projectKey), () => withStoreLock(root, () => inTurn(projectKey, async () => {
    if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
    const caps = memoryCaps({ projectKey });
    const { local, snapshot, rows } = await noteRows(projectKey, caps);
    const byRow = new Map(rows.map((r) => [r.name, r]));
    const plan = list.map((d) => ({ ...d, row: byRow.get(d.name), f: local.get(d.name), t: teamNoteFor(snapshot, d.name) }));
    // What was reviewed must still hold — the note, the team's version of its name, and a `local` or `held` row: never a
    // pending, blocked (the host's refusal included) or shared note, which `force` would push past (D5, D13).
    const stale = plan.filter((p) => !p.row || !['local', 'held'].includes(p.row.state) || !p.f || p.f.hash !== p.hash
      || (p.t?.hash ?? null) !== p.teamHash).map((p) => p.name);
    if (stale.length) throw staleError(stale);
    for (const p of plan) {
      // The note's baseline (its content at opt-in): neither Take team nor Skip shares anything, so it stays no change —
      // and Undo gives it back (D1).
      p.kept = keptHashOf(readStatusNow(projectKey, p.name));
      if (p.action !== 'share' && !p.t) throw teamError('EBADREQ', `${p.name}: the team holds no note of that name`);
      if (p.action !== 'take-team') continue;
      p.text = teamCopyText(p.t);
      // Never clip a teammate's hook here: a clipped description would read as a local edit forever (the follow's rule).
      p.caps = { ...caps, hookMaxChars: Math.max(caps.hookMaxChars || 0, flattenLine(parseMemoryFile(p.t.text).meta.description).trim().length) };
      const bytes = Buffer.byteLength(repairMemoryFile(p.text, { name: p.t.name, source: 'team', now, hookMaxChars: p.caps.hookMaxChars }).text, 'utf8');
      if (caps.hardBytesPerFile && bytes > caps.hardBytesPerFile) throw new MemoryError('ETOOBIG', `memory: the team's "${p.t.name}" is ${bytes} bytes, over this machine's ${caps.hardBytesPerFile}-byte cap`);
    }
    // The scope as it was, in History (task: snapshotScope first). Never a `-team` id: a follow prunes those first.
    const snapshotId = journal || plan.some((p) => p.action === 'take-team')
      ? await snapshotScope(root, scope, { source: journal ? 'seed' : 'user', now }) : null;
    // Right before the writes, after the (slow) snapshot: every note Take team replaces must still be what was read
    // above. The store lock is per process: an edit another process landed meanwhile (a CLI run's sync-back, the Ask MCP
    // child) may be in no snapshot, and is never overwritten (reconcileTracked's `unchanged`).
    const moved = [];
    for (const p of plan.filter((x) => x.action === 'take-team')) {
      if ((await readMemory(root, scope, p.name).catch(() => null))?.text !== p.f.text) moved.push(p.name);
    }
    if (moved.length) throw staleError(moved);
    if (journal) {
      writeJsonAtomic(seedFile(projectKey), { schema: 1, at: now, snapshotId, decisions: Object.fromEntries(plan.map((p) => [p.name, {
        action: p.action, hash: p.hash, teamName: p.t?.name ?? null, teamHash: p.teamHash, kept: p.kept, before: p.action === 'skip' ? null : p.f.text,
      }])) });
    }
    const tookTeam = [];
    for (const p of plan.filter((x) => x.action === 'take-team')) {
      // A case variant: the store refuses case twins, so mine goes first and the team's spelling is written. Mine keeps
      // its baselines (a baseline outlives the note, D1): on a case-sensitive disk its record is a file of its own, and a
      // History restore that brings my spelling back must upload nothing.
      if (p.t.name !== p.name) { await removeMemory(root, scope, p.name, { source: 'team', now, snapshot: false }); writeStatus(projectKey, p.name, baselineRecord(p.hash, p.kept, now)); }
      await writeMemory(root, scope, p.t.name, p.text, { source: 'team', now, caps: p.caps, snapshot: false });
      // A follow's record: no `pushed` — the team's version is a teammate's, not this machine's push.
      writeStatus(projectKey, p.t.name, { state: 'shared', hash: p.t.hash, sharedHash: p.t.hash, kept: p.kept, reason: null, findings: null, error: null, at: now });
      tookTeam.push(p.t.name);
    }
    const held = [];
    for (const p of plan.filter((x) => x.action === 'skip')) {
      const prev = readStatusNow(projectKey, p.name);
      writeStatus(projectKey, p.name, { state: 'held', hash: p.hash, sharedHash: prev?.sharedHash ?? null, kept: p.kept, reason: null, findings: null, error: null, at: now });
      held.push(p.name);
    }
    // ONE call: the next flush claims every intent and pushes them in one commit. `force` goes past the opt-in baseline
    // and a hold — never past the gate (a hit is BLOCKED and reported).
    const shares = plan.filter((x) => x.action === 'share').map((x) => x.name);
    const q = shares.length ? await queueNow(projectKey, shares, { force: true, source, flush: false, now }) : { queued: [], blocked: [] };
    // Switched off meanwhile (queueNow skipped the shares): nothing was seeded, the offer stays.
    if (journal && !q.skipped) writeSeedOffer(projectKey, 'done', now);
    return { snapshotId, shared: q.queued, blocked: q.blocked, tookTeam, held };
  })));
}
/** The fresh fetch a commit runs first (E3). A share is checked against the branch as it is NOW: when that fetch fails
 *  (offline, a busy lock, a broken worktree) the compare-and-swap would run on an old snapshot, and a forced share could
 *  replace a teammate's version nobody reviewed. Only that fetch is checked: a share whose PUSH then fails is retried
 *  later with no new check — 1a's last write wins. Take team and Skip change only this machine: they go ahead on the
 *  last snapshot. */
async function refreshBeforeCommit(projectKey, list, projectDir) {
  const refresh = await refreshTeamLayer(projectKey, { projectDir, maxAgeMs: 0 });
  if (refresh?.error && list.some((d) => d.action === 'share')) {
    throw teamError('FETCH_FAILED', `Could not reach the team branch to check it before sharing (${firstLine(refresh.error)}) — try again.`);
  }
}

/**
 * Share existing notes (1b seeding) — the user's decisions from a preview, applied only when every note is still as
 * reviewed (else STALE, nothing written). The scope is snapshotted first and the decided notes' texts journaled for
 * Undo; the shares go out as ONE commit, each through the gate. Nothing that was not decided here moves.
 * @returns {Promise<{snapshotId:string|null, shared:string[], blocked:Array<{name:string, reason:string}>, tookTeam:string[], held:string[], flush:object|null}>}
 */
export async function seedTeamMemory(projectKey, decisions, { projectDir = null, now = new Date().toISOString() } = {}) {
  if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
  const list = seedDecisions(decisions);
  // Checked against the branch as it is now: a teammate's version pushed since the review is STALE, never overwritten
  // unseen by a keep-mine.
  await refreshBeforeCommit(projectKey, list, projectDir);
  const r = await applyTeamDecisions(projectKey, list, { journal: true, source: 'seed', now });
  emit(projectKey, 'seeded', { shared: r.shared, tookTeam: r.tookTeam, held: r.held });
  const flush = r.shared.length ? await flushTeamMemory(projectKey, { projectDir }) : null;
  return { ...r, flush };
}

/** The Team view's Compare on one clash (a held note, or a local note the team has a version of): `share` (keep mine)
 *  or `take-team`. No journal and no offer change: it is not a seeding. */
export async function resolveTeamClash(projectKey, input, { projectDir = null, now = new Date().toISOString() } = {}) {
  if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
  const [d] = seedDecisions([input]);
  if (d.action === 'skip') throw teamError('EBADREQ', `${d.name}: action must be share or take-team`);
  if (d.teamHash === null) throw teamError('EBADREQ', `${d.name}: teamHash is required — Compare resolves a clash with the team's version`);
  await refreshBeforeCommit(projectKey, [d], projectDir);
  const r = await applyTeamDecisions(projectKey, [d], { journal: false, source: 'user', now });
  emit(projectKey, 'resolved', { name: d.name, action: d.action });
  const flush = r.shared.length ? await flushTeamMemory(projectKey, { projectDir }) : null;
  return { ...r, flush };
}

/**
 * Undo the last seeding (Q&A seed-undo: my notes only, push nothing). A share it queued that has not landed is
 * cancelled; every note it shared or replaced with the team's version gets its text from before the seeding back
 * unless it still has it (a landed share as it was stays a tracked copy — 1a tracks every local note identical to the
 * team's anyway); every note it held is released. A note put back or released is a plain local note whose content is
 * its baselines (its content, and the one it had at opt-in): a re-save uploads nothing, a real edit is shared (1a). What
 * the seeding pushed stays on the team and nothing is queued. The scope is snapshotted first, so the undo itself can be
 * restored from History.
 * @returns {Promise<{restored:string[], released:string[], cancelled:string[], failed:Array<{name:string, error:string}>}>}
 */
export async function undoTeamSeed(projectKey, { now = new Date().toISOString() } = {}) {
  if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
  const root = memoryRoot();
  const scope = projectScope(projectKey);
  const out = { restored: [], released: [], cancelled: [], failed: [] };
  let settle = false;   // a note put back with another writer's intent still queued: the next flush drops it (at its baseline)
  await withQueuedLock(lockFile(projectKey), () => withStoreLock(root, () => inTurn(projectKey, async () => {
    if (!isTeamMemoryOn(projectKey)) throw teamError('DISABLED', 'team memory is off for this project');
    const journal = await readSeedJournal(projectKey);
    if (!journal) throw teamError('ENOSEED', 'there is no seeding to undo');
    const caps = memoryCaps({ projectKey });
    const hashOf = (name, text) => { const { meta, body } = parseMemoryFile(text); return contentHash({ ...meta, name }, body); };
    const intent = (name) => existsSync(join(outboxDir(projectKey), `${name}.json`)) || existsSync(join(inflightDir(projectKey), `${name}.json`));
    const textOf = async (name) => (await readMemory(root, scope, name).catch(() => null))?.text ?? null;
    const puts = [];   // the notes to put back, each with the text it had when read here
    for (const [name, d] of Object.entries(journal.decisions)) {
      if (!isValidMemoryName(name) || !d || typeof d !== 'object' || d.done) continue;   // done: an earlier Undo settled it
      const cur = await readMemory(root, scope, name).catch(() => null);
      if (d.action === 'skip') {
        const st = readStatusNow(projectKey, name);
        if (st?.state === 'held') { writeStatus(projectKey, name, baselineRecord(cur ? hashOf(name, cur.text) : st.hash, st.kept, now)); out.released.push(name); }
        continue;
      }
      if (typeof d.before !== 'string') continue;
      const kept = typeof d.kept === 'string' && HASH_RE.test(d.kept) ? d.kept : null;   // the opt-in baseline, as seeded
      // A share the seeding queued that has not landed (its push failed, or is still to come): cancelled. Held team lock:
      // no flush runs, so an inflight claim is a dead flush's and goes too.
      let cancelled = false;
      for (const dir of [outboxDir(projectKey), inflightDir(projectKey)]) {
        const p = join(dir, `${name}.json`);
        const e = await readJson(p);
        if (e?.source === 'seed' && e.op === 'sync') { await rm(p, { force: true }); cancelled = true; }
      }
      if (cancelled) out.cancelled.push(name);
      const before = hashOf(name, d.before);
      const tName = d.action === 'take-team' && typeof d.teamName === 'string' && d.teamName !== name && isValidMemoryName(d.teamName) ? d.teamName : null;
      const renamed = !!tName && (await listMemory(root, scope)).some((e) => e.name === tName);
      if (cur && !renamed && hashOf(name, cur.text) === before) {
        if (cancelled) writeStatus(projectKey, name, baselineRecord(before, kept, now));   // it never landed: a plain local note again
        continue;
      }
      puts.push({ name, before: d.before, kept, tName: renamed ? tName : null, seen: renamed ? await textOf(tName) : cur?.text ?? null });
    }
    // The scope as it is now goes to History first, so the undo itself can be restored. Then every note must still be
    // what was read above: the store lock is per process, and an edit another process landed meanwhile (a CLI run's
    // sync-back, the Ask MCP child) may be in no snapshot — it is never overwritten; Undo again puts that note back.
    const snapErr = puts.length ? await snapshotScope(root, scope, { source: 'seed-undo', now }).then(() => null, (err) => err) : null;
    for (const p of puts) {
      try {
        if (snapErr) throw snapErr;
        if (await textOf(p.tName || p.name) !== p.seen) throw new Error('it changed while Undo ran — Undo again to put it back');
        if (p.tName && await removeMemory(root, scope, p.tName, { source: 'user', now, snapshot: false })) await removeStatus(projectKey, p.tName);
        const w = await writeMemory(root, scope, p.name, p.before, { source: 'user', now, caps, snapshot: false });
        writeStatus(projectKey, p.name, baselineRecord(hashOf(p.name, w.text), p.kept, now));
        if (intent(p.name)) settle = true;
        out.restored.push(p.name);
      } catch (err) { out.failed.push({ name: p.name, error: String(err?.message || err).replace(/^memory: /, '') }); }
    }
    // After a failure (a scope that filled meanwhile, a smaller cap, a note changed meanwhile) the journal stays, every
    // other decision marked done: Undo again retries only the notes that failed — a note already put back is the user's
    // again, never reverted twice — and the Team view still names the seeding as it was.
    const failed = new Set(out.failed.map((f) => f.name));
    if (!failed.size) await rm(seedFile(projectKey), { force: true });
    else writeJsonAtomic(seedFile(projectKey), { ...journal, decisions: Object.fromEntries(Object.entries(journal.decisions)
      .map(([name, d]) => [name, failed.has(name) || !d || typeof d !== 'object' ? d : { ...d, done: true }])) });
  })));
  emit(projectKey, 'seed-undone', out);
  if (settle) scheduleTeamFlush(projectKey);
  return out;
}

export const _testing = {
  reset() { _scheduled.clear(); },
  paths: (key) => ({ dir: keyDir(key), outbox: outboxDir(key), inflight: inflightDir(key), status: statusDir(key), snapshot: snapshotFile(key), worktree: worktreeDir(key), lock: lockFile(key), offer: offerFile(key), available: availableFile(key), seedJournal: seedFile(key) }),
  // What a push from here leaves (`pushed`), or — `followed` — what a follow of a teammate's version leaves.
  markShared: (key, name, hash, { followed = false } = {}) => writeStatus(key, name, { state: 'shared', hash, sharedHash: hash, ...(followed ? {} : { pushed: hash }), reason: null, findings: null, error: null, at: new Date().toISOString() }),
  queuedNames, writeSnapshot, reconcileTracked, readTeamNotes, noteEntry,
};
