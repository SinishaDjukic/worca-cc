// src/core/requirements/attachment-fetch.mjs
// A picked tracker attachment arrives as an A8 file (plans/requirements-a61-design.md D9, D10, D15–D17). Its row waits as `downloading`
// (fetch_json says where from) until this queue — MAX_DOWNLOAD_JOBS across every feature, apart from A8's read queue — has the
// connector stream the body to `dest`, a fixed name in a fresh private folder. Worca trusts nothing there until its own checks pass;
// then the bytes it checked are written into A8's store under the row's id and the file joins A8's read queue. A failure marks only
// that file, and every failure marks it: a row is never left `downloading` without a job.
// attachment-job.mjs and this module import each other: neither uses the other's bindings at module top level.
import { chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { worcaHome } from '../projects.mjs';
import { callSource as shimCallSource } from '../plugin-shim.mjs';
import { validateAttachmentUploads } from '../attachment-upload.mjs';
import { classifyExtension } from '../ask/attachment-kind.mjs';
import { RequirementsError } from './spec.mjs';
import { REQ_ATTACH_LIMITS, displayName, uniqueName } from './attachments.mjs';
import { mintAttachmentId, insertAttachment, getAttachment, listAttachments, updateAttachment, appendTurn, listDownloadingAttachments } from './store.mjs';
import { attachmentsDir, attachmentFile, enqueueRead, settleOwner } from './attachment-job.mjs';

/** D17: one download (25 MB over a slow link); the op's answer is a few fields, the body is on disk. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const MAX_DOWNLOAD_JOBS = 2;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const L = REQ_ATTACH_LIMITS;
const iso = () => new Date().toISOString();
/** What the log may keep of a failure (export.mjs's firstLine, copied: importing export.mjs here would join its import cycle). */
const firstLine = (err) => String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200);
const ownerKey = (o) => `${o.type}:${o.id}`;
const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i).toLowerCase() : ''; };
const callOf = (d) => (d && typeof d.callSource === 'function' ? d.callSource : shimCallSource);
const trackerOf = (row) => (row && row.fetch && row.fetch.tracker) || 'the tracker';
/** How the checked body goes into A8's store (a test makes it fail). 'w': a leftover of this row's own earlier attempt is replaced. */
const FETCH_DEFAULTS = Object.freeze({ writeBody: (target, body) => writeFileSync(target, body, { mode: FILE_MODE }) });

/** D10: a picked attachment's row before its body exists, inside the caller's transaction: named (unique within the owner), typed
 *  by its extension and sized as the tracker says; `sha256` holds `pending:<id>` (unique) until the body's real hash replaces it. */
export function insertDownloadRow(owner, { conn, tracker, key, id, name, bytes, from = null } = {}, { by = null } = {}) {
  const shown = uniqueName(displayName(name), listAttachments(owner.type, owner.id).map((r) => r.name));
  const cls = classifyExtension(extOf(shown));
  if (!cls) throw new RequirementsError('BAD_REQUEST', `${shown} was not added: Worca reads text, images and PDF.`);
  const size = Math.max(0, Number(bytes) || 0);
  const rowId = mintAttachmentId();
  const row = insertAttachment({ id: rowId, ownerType: owner.type, ownerId: owner.id, name: shown, kind: cls.kind, mime: cls.mime, bytes: size,
    sha256: `pending:${rowId}`, status: 'downloading',
    fetch: { plugin: conn.plugin, sourceId: conn.sourceId, profile: conn.profile || null, tracker, key, id: String(id), name: String(name), bytes: size } }, { by });
  if (owner.type === 'feature') appendTurn(owner.id, { kind: 'file', payload: { action: 'added', id: rowId, name: shown, ...(from ? { from } : {}) } }, { by });
  return row;
}

// ---------------------------------------------------------------- the queue (D10, D17)

const queue = [];          // waiting downloads, in order: { id, owner, by, d }
const running = new Map(); // attachment id → its running download (`cancelled` once its row is removed)
export const isDownloading = (id) => queue.some((e) => e.id === id) || running.has(id);
/** Whether an owner ('feature:<seq>') has a download queued or running (A8's readsSettled waits for these too). */
export const downloadsPending = (key) => queue.some((e) => ownerKey(e.owner) === key) || [...running.values()].some((e) => ownerKey(e.owner) === key);

export function queueDownloads(owner, ids, { by = null } = {}, deps = {}) {
  for (const id of ids || []) if (!isDownloading(id)) queue.push({ id, owner, by, d: deps });
  pump();
}
/** A removed file (D10): a queued download goes; a running one's result is thrown away when it ends. */
export function cancelDownload(id) {
  for (let i = queue.length - 1; i >= 0; i -= 1) if (queue[i].id === id) queue.splice(i, 1);
  const r = running.get(id);
  if (r) r.cancelled = true;
}
/** Try again on a failed download (D10): the row waits again and is queued. */
export function redownload(owner, row, { by = null } = {}, deps = {}) {
  const out = updateAttachment(row.id, { status: 'downloading', error: null }, { by });
  queueDownloads(owner, [row.id], { by }, deps);
  return out;
}
function pump() {
  while (running.size < MAX_DOWNLOAD_JOBS && queue.length) {
    const e = queue.shift();
    running.set(e.id, e);
    void runDownload(e).catch((err) => console.error(`requirements: downloading file ${e.id} failed:`, firstLine(err)))
      .finally(() => { running.delete(e.id); settleOwner(e.owner, e.d); pump(); });
  }
}

// ---------------------------------------------------------------- the folder and the checks (D9, D15)

export const fetchBase = () => join(worcaHome(), 'tmp', 'requirements');
/** A fresh single-use folder for one download (0700, as A8's att-read-* copies) and the fixed name the connector writes. */
export function makeFetchFolder(base = fetchBase()) {
  mkdirSync(base, { recursive: true, mode: DIR_MODE });
  const dir = join(base, `att-get-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { mode: DIR_MODE });
  try { chmodSync(dir, DIR_MODE); } catch { /* no POSIX modes on Windows */ }
  return { dir, dest: join(dir, 'body.part') };
}

// POSIX: open never follows a link at dest. Windows has no O_NOFOLLOW: the lstat before and the fstat after (same inode, same
// size) tell a swapped file apart there.
const OPEN_FLAGS = fsConstants.O_RDONLY | (process.platform !== 'win32' && typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0);

/** D9: `dest` is still the file the host named inside the folder it created: no link, a regular file, not empty, at most the cap,
 *  the size the connector answered. Opened once and read through that descriptor (plan review S7), so the connector cannot swap
 *  the file between the check and the read; the bytes come back with the answer and are the only ones Worca uses. */
export function checkFetched(dir, dest, answer, maxBytes = L.fileBytes) {
  if (dirname(dest) !== dir || basename(dest) !== 'body.part') return { ok: false, why: 'path' };
  let pre;
  try { pre = lstatSync(dest); } catch { return { ok: false, why: 'missing' }; }
  if (pre.isSymbolicLink() || !pre.isFile()) return { ok: false, why: 'not-a-file' };
  try { if (dirname(realpathSync(dest)) !== realpathSync(dir)) return { ok: false, why: 'path' }; } catch { return { ok: false, why: 'missing' }; }
  let fd;
  try { fd = openSync(dest, OPEN_FLAGS); } catch (err) { return { ok: false, why: err && err.code === 'ELOOP' ? 'not-a-file' : 'missing' }; }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.ino !== pre.ino || st.size !== pre.size) return { ok: false, why: 'not-a-file' };   // swapped after the lstat
    if (st.size === 0) return { ok: false, why: 'empty' };
    if (st.size > maxBytes) return { ok: false, why: 'too-large' };
    if (Number(answer && answer.bytes) !== st.size) return { ok: false, why: 'size' };
    const body = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = readSync(fd, body, off, st.size - off, off); if (n <= 0) break; off += n; }
    if (off !== st.size) return { ok: false, why: 'size' };
    return { ok: true, size: st.size, body };
  } finally { closeSync(fd); }
}

// A8's upload rules (validateAttachmentUploads) on the downloaded body, with codes for messages; each code's tail for "Worca could not use this file: …"
const VALIDATE = Object.freeze({ maxFiles: 1, maxBytesPerFile: L.fileBytes, maxBytesPerBinaryFile: L.fileBytes, maxBytesTotal: L.fileBytes,
  notAllowed: () => 'type', messages: { tooBig: () => 'size', totalTooBig: () => 'size', empty: () => 'content', mismatch: () => 'content',
    notUtf8: () => 'content', nul: () => 'content' } });
const CHECK_TAIL = Object.freeze({ type: 'Worca reads text, images and PDF', size: 'it is over 25 MB', content: 'its content does not match its type' });
// Per-file download reasons: fixed phrases, never the plugin's text (design D16, adjusted for the build)
const REASON = Object.freeze({ timeout: 'it did not answer within 2 minutes', auth: 'the API token was refused', network: 'the network connection failed',
  'rate-limit': 'it asked Worca to slow down' });

/** The file's failure (D10, D16): DOWNLOAD (Try again) or REFUSED (none); a removed file is left alone. */
function fail(row, code, reason, by) {
  if (!getAttachment(row.id)) return;
  const msg = code === 'REFUSED' ? `Worca could not use this file: ${reason}.` : `Worca could not get this file from ${trackerOf(row)}: ${reason}.`;
  updateAttachment(row.id, { status: 'failed', error: { code, message: msg, reason, job: 'download', at: iso() } }, { by });
}

async function runDownload(e) {
  await null;
  const row = getAttachment(e.id);
  if (!row || row.status !== 'downloading' || !row.fetch) return;
  const f = row.fetch;
  const d = { ...FETCH_DEFAULTS, ...(e.d || {}) };
  let dir = null;
  let target = null;   // a body this download wrote into A8's store, until the row owns it (then null)
  try {
    const folder = makeFetchFolder();   // inside the try (M1): a folder that cannot be made fails the file
    dir = folder.dir;
    let r;
    try {
      r = await callOf(d)({ plugin: f.plugin, sourceId: f.sourceId, profile: f.profile || undefined, op: 'downloadAttachment',
        args: { key: f.key, id: f.id, maxBytes: L.fileBytes, dest: folder.dest }, timeoutMs: d.downloadTimeoutMs || DOWNLOAD_TIMEOUT_MS });
    } catch (err) {
      console.error(`requirements: the download of file ${row.id} from ${f.key} failed (${(err && err.kind) || 'plugin'}):`, firstLine(err));
      if (!e.cancelled) fail(row, 'DOWNLOAD', REASON[err && err.kind] || 'it answered with an error', e.by);
      return;
    }
    if (e.cancelled || !getAttachment(row.id)) return;   // removed meanwhile: the result is thrown away (the folder goes below)
    if (r && r.gone) { fail(row, 'DOWNLOAD', r.forbidden ? 'this connection may not see it' : `it is no longer on ${f.key}`, e.by); return; }
    if (r && r.tooLarge) { fail(row, 'REFUSED', 'it is over 25 MB', e.by); return; }
    const c = checkFetched(dir, folder.dest, r);
    if (!c.ok) {
      const unsent = c.why === 'missing' || c.why === 'empty';
      fail(row, unsent ? 'DOWNLOAD' : 'REFUSED', unsent ? `${trackerOf(row)} did not send it` : c.why === 'too-large' ? 'it is over 25 MB'
        : `it is not the file ${trackerOf(row)} described`, e.by);
      return;
    }
    // A8's upload rules on the bytes checkFetched read. Synchronous (base64 out and back, up to 25 MB): acceptable at two downloads at
    // a time, the same cost as an upload of that size (plan review, Minor 9).
    const v = validateAttachmentUploads([{ name: row.name, dataBase64: c.body.toString('base64') }], VALIDATE);
    if (!v.ok) { fail(row, 'REFUSED', CHECK_TAIL[v.error] || CHECK_TAIL.content, e.by); return; }
    const file = v.files[0];
    const twin = listAttachments(row.ownerType, row.ownerId).find((x) => x.id !== row.id && x.sha256 === file.sha256);
    if (twin) { fail(row, 'REFUSED', `it is already attached as ${twin.name}`, e.by); return; }
    mkdirSync(attachmentsDir(), { recursive: true, mode: DIR_MODE });
    target = attachmentFile({ id: row.id, kind: file.kind, mime: file.mime });
    d.writeBody(target, c.body);   // the checked bytes; never a rename of dest, which could have changed after the check (S7)
    try { chmodSync(target, FILE_MODE); } catch { /* no POSIX modes on Windows */ }
    if (e.cancelled || !getAttachment(row.id)) return;   // removed meanwhile: the body goes below
    try {
      updateAttachment(row.id, { kind: file.kind, mime: file.mime, bytes: file.bytes, sha256: file.sha256, status: 'reading', error: null }, { by: e.by });
    } catch (err) {   // a twin stored in the same moment (the per-owner hash index)
      console.error(`requirements: storing downloaded file ${row.id} failed:`, firstLine(err));
      fail(row, 'REFUSED', 'it is already attached', e.by);
      return;   // the body goes below
    }
    enqueueRead(e.owner, row.id, row.name, e.by, d);   // then exactly an A8 file (D9)
    target = null;   // the row owns its body now
  } catch (err) {
    // M1: anything else (the folder, A8's store folder, the write, the validator, the read queue) fails the file with Try again
    console.error(`requirements: storing downloaded file ${row.id} failed:`, firstLine(err));
    if (!e.cancelled) fail(row, 'DOWNLOAD', 'Worca could not store it', e.by);
  } finally {
    if (target) { try { rmSync(target, { force: true }); } catch (x) { console.error('requirements: could not remove a stored body:', firstLine(x)); } }
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch (x) { console.error('requirements: could not remove a download folder:', firstLine(x)); } }
  }
}

/** D10: a row left `downloading` by a restart (its download not queued or running) fails with INTERRUPTED; Try again fetches it. */
export function recoverDownloads() {
  let n = 0;
  for (const r of listDownloadingAttachments()) {
    if (isDownloading(r.id)) continue;
    updateAttachment(r.id, { status: 'failed', error: { code: 'INTERRUPTED', message: `Worca restarted before it got this file from ${trackerOf(r)}.`,
      job: 'download', at: iso() } });
    n += 1;
  }
  return n;
}
