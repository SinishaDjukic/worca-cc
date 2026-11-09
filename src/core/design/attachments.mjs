// src/core/design/attachments.mjs
// A design chat's uploads reach its builds as files (P5 Task 7): each round copies them into the source folder's
// `assets/att/`, under names that cannot leave that folder or collide on any disk (lower-cased slugs, Windows device
// stems prefixed). Store order is creation order and the set only grows, so a file keeps its name from round to round,
// unless a folder stands at it, or a file there cannot be removed: that name is taken, and the file gets the next free
// one (a folder an agent planted there must not fail every later round). `assets/att` is listed once per copy, each
// entry known by its device and inode (or counted as unknown when it cannot be looked at), so however many stand there,
// each costs about one look, under whatever name the disk finds it (`Brief.md` under `brief.md` on a case-insensitive
// disk, `brief\u200C.md` there on HFS+).

import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { attachmentPath, listAttachments } from '../ask/store.mjs';
import { WINDOWS_RESERVED } from './ids.mjs';

const STEM_MAX = 60;
const POSIX = process.platform !== 'win32';
/** Linux copies through the open `assets/att` folder (`/proc/self/fd/<fd>/<name>`, as claimExtrasDir reads): a swap
 *  of any level after it was opened cannot redirect a copy. */
const VIA_FD = process.platform === 'linux';
const EXT_RE = /\.([A-Za-z0-9]{1,8})$/;
const EDGES_RE = /^[.\-_ ]+|[.\-_ ]+$/g;
/** Names tried for one upload past the entries listed first: only an agent making folders at the next names while the
 *  copy runs reaches it, and the copy then fails instead of chasing it forever. */
const NAME_TRIES = 64;
/** Per `taken` set, the next number to try for each `<stem>/<ext>`: every lower one is taken, and the set only grows. */
const NEXT = new WeakMap();

/** An entry's identity on its disk, the same under every name the disk finds it by (case, Unicode normalisation, the
 *  code points HFS+ ignores): its device and inode; null when the stats carry none. */
const idOf = (st) => (st?.dev == null || st?.ino == null ? null : `${st.dev}:${st.ino}`);
/** listAttDir's count of the listed entries it could not identify: an lstat that failed (on HFS+ a name of ~749 bytes
 *  of ignorables puts `<att>/<name>` past macOS's 1024-byte path limit, ENAMETOOLONG, while the disk finds that entry
 *  under a short name) or stats without a device and inode. Never an identity (`<dev>:<ino>`). */
const UNKNOWN = 'unknown';

/** `work/assets/att`, relative to the source folder; prompts name it with forward slashes on every OS. */
const ATT_PARTS = ['assets', 'att'];

/**
 * A file name for `name` that stays inside its folder and differs from every name in `taken`, which it joins.
 * Basename after `/` and `\`; a 1-8 letter-or-digit extension, lower-cased; a stem of printable ASCII `a-z 0-9 . _ -`
 * (anything else becomes `-`), trimmed of `. - _ space` at both ends, cut to 60 and trimmed again, `file` when nothing
 * is left and `file-<stem>` when the stem up to its first dot is a Windows device name (`con.tar.gz` too); a taken name
 * gets `-2`, `-3`, ... before its extension.
 * @param {string} name the name the person uploaded
 * @param {Set<string>} taken names already handed out in this folder
 * @returns {string}
 */
export function safeAttachmentName(name, taken) {
  const base = String(name ?? '').split(/[\\/]/).pop();
  const m = EXT_RE.exec(base);
  const ext = m ? `.${m[1].toLowerCase()}` : '';
  const ascii = [...(m ? base.slice(0, m.index) : base).normalize('NFKD')]
    .filter((c) => c >= ' ' && c <= '~').join('').toLowerCase();
  let stem = ascii.replace(/[^a-z0-9._-]+/g, '-').replace(EDGES_RE, '').slice(0, STEM_MAX).replace(EDGES_RE, '') || 'file';
  if (WINDOWS_RESERVED.test(stem.split('.')[0])) stem = `file-${stem}`;
  let out = `${stem}${ext}`;
  if (taken.has(out)) {
    if (!NEXT.has(taken)) NEXT.set(taken, new Map());
    const next = NEXT.get(taken);
    const key = `${stem}/${ext}`;
    let n = next.get(key) ?? 2;
    while (taken.has(`${stem}-${n}${ext}`)) n += 1;
    out = `${stem}-${n}${ext}`;
    next.set(key, n + 1);
  }
  taken.add(out);
  return out;
}

/** Makes `assets/att` one level at a time and throws at a level that is a link, before anything is made through it:
 *  a link would carry the copies out of the source folder. */
async function ensureAttDir(workDir, io) {
  let dir = workDir;
  for (const [i, part] of ATT_PARTS.entries()) {
    dir = join(dir, part);
    await io.mkdir(dir, { recursive: true });
    if ((await io.lstat(dir)).isSymbolicLink()) throw new Error(`${ATT_PARTS.slice(0, i + 1).join('/')} is a link`);
  }
  return dir;
}

const replaced = () => Object.assign(new Error('assets/att was replaced while the uploads were copied'), { code: 'ELOOP' });

/** `assets/att` made (ensureAttDir) and held: its stats, and the folder copies go into, on Linux the open folder
 *  itself (`fh`, O_DIRECTORY|O_NOFOLLOW, the same device and inode). The caller closes `fh`. */
async function openAttDir(workDir, io) {
  const dir = await ensureAttDir(workDir, io);
  const st = await io.lstat(dir);
  if (!VIA_FD) return { st, base: dir, fh: null };
  const fh = await io.open(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const now = await fh.stat();
    if (now.dev !== st.dev || now.ino !== st.ino) throw replaced();
  } catch (err) {
    await fh.close();
    throw err;
  }
  return { st, base: `/proc/self/fd/${fh.fd}`, fh };
}

/** Before every copy: each level of `assets/att` is still a real folder, and `att` the one opened (`st`). work/ is
 *  agent-writable, so a level swapped for a link after openAttDir throws `ELOOP` instead of sending the upload there. */
async function attStill(workDir, st, io) {
  let dir = workDir;
  let now = null;
  for (const part of ATT_PARTS) {
    dir = join(dir, part);
    now = await io.lstat(dir);
    if (!now.isDirectory()) throw replaced();
  }
  if (now.dev !== st.dev || now.ino !== st.ino) throw replaced();
}

/** Gives the copy at `file` to the agent's group (P8, L8.13): 0660, because an upload's folder can be private and
 *  copyFile keeps its mode. `assets/att` is agent-writable, so the file is opened without following a link
 *  (O_NOFOLLOW) or waiting on a FIFO (O_NONBLOCK) planted under the name meanwhile, and anything but a regular file is
 *  refused. POSIX only: Windows has neither the flag nor the mode bits. */
async function groupUsable(file, io) {
  const fh = await io.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await fh.stat()).isFile()) throw Object.assign(new Error('an attachment copy is not a regular file'), { code: 'EINVAL' });
    await fh.chmod(0o660);
  } finally {
    await fh.close();
  }
}

/**
 * The entries of the held `assets/att` (`base`) when the copy began: each folder's name joins `taken`, and every entry
 * is counted by its identity (idOf, one look each), so freeName knows one found under another name; one that cannot be
 * identified is counted under UNKNOWN.
 * @returns {Promise<Map<string, number>>} how many listed entries carry each identity
 */
async function listAttDir(base, taken, io) {
  const listed = new Map();
  for (const e of await (io.readdir ?? readdir)(base, { withFileTypes: true })) {
    if (e.isDirectory()) taken.add(e.name);
    const id = idOf(await io.lstat(join(base, e.name)).catch(() => null)) ?? UNKNOWN;
    listed.set(id, (listed.get(id) ?? 0) + 1);
  }
  return listed;
}

/**
 * The name the upload `a` lands under in the held `assets/att` (`base`), its place cleared: a folder there makes the
 * name taken, and so does a file that cannot be removed (`EPERM`, `EACCES`: an immutable file); anything else there is
 * removed, never followed. A taken name whose entry was listed (listAttDir, by identity: whatever name the disk finds it
 * under) costs no try, once per listed entry, and so does one whose identity was not listed while a listed entry could
 * not be identified (UNKNOWN), once per such entry; past NAME_TRIES other taken names it throws, naming the last.
 */
async function freeName(a, base, taken, listed, io) {
  for (let tries = 0; ;) {
    const name = safeAttachmentName(a.name, taken);
    const to = join(base, name);
    const there = await io.lstat(to).catch(() => null);
    if (!there) return name;
    if (!there.isDirectory()) {
      try {
        await io.rm(to, { force: true });
        return name;
      } catch (err) {
        if (err?.code !== 'EPERM' && err?.code !== 'EACCES') throw err;
      }
    }
    const id = idOf(there);
    const credit = listed.get(id) > 0 ? id : !listed.has(id) && listed.get(UNKNOWN) > 0 ? UNKNOWN : null;
    if (credit !== null) {
      listed.set(credit, listed.get(credit) - 1);
      continue;
    }
    tries += 1;
    if (tries >= NAME_TRIES) {
      throw Object.assign(new Error(`assets/att/${name} and the ${NAME_TRIES - 1} names before it are taken while the uploads are copied`), { code: 'EEXIST' });
    }
  }
}

/**
 * Copy the thread's uploads (attachments with a message; show_files copies have none) into `<workDir>/assets/att/`.
 * An attachment whose body is gone is skipped. Every folder in `assets/att` is a taken name, listed once up front with
 * every entry's identity (listAttDir: a case-insensitive disk finds `Brief.md` under `brief.md`, HFS+ `brief\u200C.md`,
 * so only what is made meanwhile counts to NAME_TRIES), and so is one found at a target name later or a file there that
 * cannot be removed (freeName: `safeAttachmentName` gives the next); whatever else stands there is removed, never
 * followed, and each copy makes a new file (`COPYFILE_EXCL`): a
 * link or folder planted at the name meanwhile fails it (`EEXIST`), never written through. Each copy goes into the
 * `assets/att` checked first (`attStill`; on Linux through its open folder). On POSIX each copy is then made group
 * read-write (`groupUsable`), which throws on a link or a non-file put there meanwhile.
 * @param {{ threadId: string, workDir: string,
 *   io?: { mkdir: Function, lstat: Function, rm: Function, copyFile: Function, open: Function, readdir?: Function } }} opts
 * @returns {Promise<string[]>} the names written, in store order
 */
export async function copyThreadAttachments({ threadId, workDir, io = { mkdir, lstat, rm, copyFile, open, readdir } } = {}) {
  const taken = new Set();
  const names = [];
  let att = null;
  let listed = null;
  try {
    for (const a of listAttachments(threadId)) {
      if (a.messageId == null) continue;
      const from = attachmentPath(threadId, a.id);
      if (!from) continue;
      if (!att) {
        att = await openAttDir(workDir, io);
        listed = await listAttDir(att.base, taken, io);
      }
      await attStill(workDir, att.st, io);
      const name = await freeName(a, att.base, taken, listed, io);
      const to = join(att.base, name);
      await io.copyFile(from, to, constants.COPYFILE_EXCL);
      if (POSIX) await groupUsable(to, io);
      names.push(name);
    }
  } finally {
    await att?.fh?.close();
  }
  return names;
}
