// src/core/design/attachments.mjs
// A design chat's uploads reach its builds as files (P5 Task 7): each round copies them into the source folder's
// `assets/att/`, under names that cannot leave that folder or collide on any disk (lower-cased slugs, Windows device
// stems prefixed). Store order is creation order and the set only grows, so a file keeps its name from round to round.

import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { attachmentPath, listAttachments } from '../ask/store.mjs';
import { WINDOWS_RESERVED } from './ids.mjs';

const STEM_MAX = 60;
const EXT_RE = /\.([A-Za-z0-9]{1,8})$/;
const EDGES_RE = /^[.\-_ ]+|[.\-_ ]+$/g;

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
  for (let n = 2; taken.has(out); n += 1) out = `${stem}-${n}${ext}`;
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

/**
 * Copy the thread's uploads (attachments with a message; show_files copies have none) into `<workDir>/assets/att/`.
 * An attachment whose body is gone is skipped. A link already at a target name is replaced, never followed.
 * @param {{ threadId: string, workDir: string, io?: { mkdir: Function, lstat: Function, rm: Function, copyFile: Function } }} opts
 * @returns {Promise<string[]>} the names written, in store order
 */
export async function copyThreadAttachments({ threadId, workDir, io = { mkdir, lstat, rm, copyFile } } = {}) {
  const taken = new Set();
  const names = [];
  let dir = null;
  for (const a of listAttachments(threadId)) {
    if (a.messageId == null) continue;
    const from = attachmentPath(threadId, a.id);
    if (!from) continue;
    dir ??= await ensureAttDir(workDir, io);
    const name = safeAttachmentName(a.name, taken);
    const to = join(dir, name);
    if ((await io.lstat(to).catch(() => null))?.isSymbolicLink()) await io.rm(to, { force: true });
    await io.copyFile(from, to);
    names.push(name);
  }
  return names;
}
