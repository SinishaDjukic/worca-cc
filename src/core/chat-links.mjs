// src/core/chat-links.mjs — the file side of chat links (issue 1064 §1–§2). A chat's ROOT is a folder (the run's
// worktree or checkout, else the chat's own folder) or, for a run whose folder is gone, its branch. Here: which paths an
// answer names exist there (resolve), the strict check open_tab makes (target), and the Files tab's reads of a branch
// root (list, read, openRaw). Refused, always: anything leaving the root (absolute, `..`, a link out of a folder, any
// link in a branch), .git, credential files (show_files' credentialReason) and worca's own files.
import { spawn } from 'node:child_process';
import { open, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanRel, statInFolder, ToolFolderError, TOOL_FOLDER_LIMITS } from './tool-folder.mjs';
import { listMemberFiles } from './workspace-map/files.mjs';
import { runGitCapture, ASK_GIT_ENV } from './worktree.mjs';
import { guardedGitEnv } from './git-guard.mjs';
import { gitAvailable } from './git-available.mjs';
import { credentialReason } from './ask/show-files.mjs';
import { normalizeLinkPath, LINE_MAX } from '../shared/file-refs.mjs';

export const CHAT_LINK_LIMITS = Object.freeze({
  scanBytes: 2 * 1024 * 1024,       // a file up to this size has its lines counted (bigger: no clamp, no line check)
  listMax: 50_000,                  // files listed for a bare-name search; a longer list never links a bare name
  listTreeBytes: 16 * 1024 * 1024,
  cacheMs: 30_000,
  blobMax: 25 * 1024 * 1024,        // = ARTIFACT_RAW_MAX_BYTES: a branch file above it is a download fallback (413)
  gitTimeoutMs: 20_000,
  resolveConcurrency: 8,            // paths of one resolve request checked at once (each may read scanBytes or spawn git)
});
const SHA_RE = /^[0-9a-f]{40,64}$/;
const WORCA_OWN = ['.claude/rules/worca', '.claude/skills/readiness-rubric'];   // run mounts worca writes into a checkout
// Credential files show_files' rule misses outside the home folder: Claude's own token and local settings (an env
// block can hold keys), basic-auth files, cloud service-account keys.
const LINK_SECRET_RE = /(^|\/)(\.claude\/\.credentials\.json|\.claude\/settings\.local\.json|\.htpasswd|[^/]*service[-_]?account[^/]*\.json)$/;

export class ChatLinkError extends Error {
  constructor(code, message) { super(message); this.name = 'ChatLinkError'; this.code = code; }
}

/** Why a root-relative POSIX path is never opened from a chat, or null. */
export function linkRefusal(rel) {
  const low = String(rel || '').toLowerCase();
  if (WORCA_OWN.some((p) => low === p || low.startsWith(`${p}/`))) return "worca's own files are not opened from a chat";
  if (LINK_SECRET_RE.test(low)) return 'looks like a credential file';
  return credentialReason(low);
}

const countLines = (buf) => {
  if (!buf.length) return 0;
  let n = 0;
  for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, i + 1)) n += 1;
  return buf[buf.length - 1] === 10 ? n : n + 1;
};
const isBinary = (buf) => buf.subarray(0, TOOL_FOLDER_LIMITS.sniffBytes).includes(0);

/** `items` through `fn`, at most `limit` at a time, results in order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next; next += 1; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

/** The first `max` bytes of a blob (`git cat-file blob <sha>`, stopped once enough came). Never throws a raw error.
 *  A raw spawn (listed in test/git-raw-spawn-lint.test.mjs) because runGitCapture decodes stdout as text and a binary
 *  blob must reach the raw route byte-exact. The env is git-guard's (security G2), like worktree.mjs git(); `cat-file
 *  blob` runs no textconv, filter or hook. */
async function readBlobHead(repoDir, sha, max, timeoutMs) {
  const gone = () => new ChatLinkError('NOT_FOUND', 'That file cannot be read from the branch.');
  if (!gitAvailable() || !SHA_RE.test(sha)) throw gone();
  let env;
  try { env = await guardedGitEnv(repoDir, { timeout: timeoutMs, env: { ...process.env, ...ASK_GIT_ENV } }); }
  catch { throw gone(); }
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', 'blob', sha], { cwd: repoDir, env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks = [];
    let n = 0;
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(Buffer.concat(chunks, n));
    };
    const timer = setTimeout(() => { child.kill(); finish(gone()); }, timeoutMs);
    child.stdout.on('data', (c) => {
      const room = max - n;
      if (room <= 0) return;
      const b = c.subarray(0, room);
      chunks.push(b);
      n += b.length;
      if (n >= max) { child.kill(); finish(null); }
    });
    child.on('error', () => finish(gone()));
    child.on('close', (code) => finish(code === 0 || n >= max ? null : gone()));
  });
}

/** `git ls-tree -z --long` records: [{ mode, type, sha, size, path }]. */
function parseTree(stdout) {
  const out = [];
  for (const rec of String(stdout || '').split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, sha, size] = rec.slice(0, tab).trim().split(/\s+/);
    out.push({ mode, type, sha, size: size === '-' ? null : Number(size), path: rec.slice(tab + 1) });
  }
  return out;
}
const byName = (a, z) => a.localeCompare(z, undefined, { sensitivity: 'base', numeric: true });
const isGitName = (name) => String(name).toLowerCase() === '.git';

/** `trace(event)` (tests only): 'start' / 'end' around each path a resolve checks — pins the concurrency cap. */
export function createChatLinks({ now = () => Date.now(), limits = CHAT_LINK_LIMITS, trace = null } = {}) {
  const lists = new Map();   // root key → { at, promise: { files, truncated } }

  async function git(root, args, maxBytes) {
    const r = await runGitCapture(root.repoDir, args, { maxBytes, timeoutMs: limits.gitTimeoutMs });
    if (!r.ok && !r.truncated) throw new ChatLinkError('NOT_FOUND', "That is not in the run's branch.");
    return r;
  }

  /** What `rel` is in a branch root: { path, type, size, sha } — a link (120000) is refused, a submodule is not there. */
  async function statBranch(root, rel) {
    if (!rel) return { path: '', type: 'dir', size: 0, sha: null };
    const r = await git(root, ['ls-tree', '-z', '--long', root.ref, '--', rel], 256 * 1024);
    const hit = parseTree(r.stdout).find((e) => e.path === rel);
    if (!hit) throw new ChatLinkError('NOT_FOUND', `${rel} is not in the run's branch.`);
    if (hit.mode === '120000') throw new ChatLinkError('REFUSED', `${rel} is a link: links are not followed in a branch.`);
    if (hit.type === 'tree') return { path: rel, type: 'dir', size: 0, sha: hit.sha };
    if (hit.type === 'blob') return { path: rel, type: 'file', size: hit.size ?? 0, sha: hit.sha };
    return { path: rel, type: 'other', size: 0, sha: null };
  }

  /** { path, type, size, lines|null, binary } for a confirmed, allowed path of `root`. Throws ChatLinkError. */
  async function statRel(root, relIn) {
    let rel;
    try { rel = cleanRel(relIn); } catch { throw new ChatLinkError('REFUSED', 'That path is not inside this project.'); }
    if (!rel) throw new ChatLinkError('BAD_PATH', 'Give a path inside the project.');
    if (linkRefusal(rel)) throw new ChatLinkError('REFUSED', `${rel}: ${linkRefusal(rel)}`);
    if (root.kind === 'branch') {
      const s = await statBranch(root, rel);
      if (s.type !== 'file' || s.size > limits.scanBytes) return { ...s, lines: null, binary: false };
      const buf = await readBlobHead(root.repoDir, s.sha, limits.scanBytes + 1, limits.gitTimeoutMs);
      const binary = isBinary(buf);
      return { ...s, binary, lines: binary ? null : countLines(buf) };
    }
    let s;
    try { s = await statInFolder(root.dir, rel); }
    catch (e) {
      if (e instanceof ToolFolderError && e.code === 'BAD_PATH') throw new ChatLinkError('REFUSED', 'That link leads outside this project.');
      throw new ChatLinkError('NOT_FOUND', `${rel} is not there.`);
    }
    if (linkRefusal(s.realRel)) throw new ChatLinkError('REFUSED', `${rel}: ${linkRefusal(s.realRel)}`);
    if (s.type !== 'file' || s.size > limits.scanBytes) return { path: s.path, type: s.type, size: s.size, lines: null, binary: false };
    const fh = await open(s.real, 'r');
    try {
      const buf = Buffer.alloc(s.size);
      const { bytesRead } = await fh.read(buf, 0, s.size, 0);
      const got = buf.subarray(0, bytesRead);
      const binary = isBinary(got);
      return { path: s.path, type: 'file', size: s.size, binary, lines: binary ? null : countLines(got) };
    } finally { await fh.close().catch(() => {}); }
  }

  /** Every file of the root (posix paths), cached for cacheMs: git ls-files in a folder, ls-tree -r in a branch. */
  function fileList(root) {
    const key = root.kind === 'branch' ? `b:${root.repoDir}:${root.ref}` : `d:${root.dir}`;
    const hit = lists.get(key);
    if (hit && now() - hit.at < limits.cacheMs) return hit.promise;
    const promise = (async () => {
      if (root.kind === 'branch') {
        const r = await runGitCapture(root.repoDir, ['ls-tree', '-r', '-z', '--name-only', root.ref], { maxBytes: limits.listTreeBytes, timeoutMs: limits.gitTimeoutMs });
        if (!r.ok && !r.truncated) return { files: [], truncated: true };
        const files = String(r.stdout).split('\0').filter(Boolean);
        return { files, truncated: !!r.truncated || files.length > limits.listMax };
      }
      const r = await listMemberFiles(root.dir, { maxFiles: limits.listMax });
      return { files: r.files || [], truncated: !!r.truncated };
    })().catch(() => ({ files: [], truncated: true }));
    lists.set(key, { at: now(), promise });
    if (lists.size > 64) lists.delete(lists.keys().next().value);
    return promise;
  }

  /** The one file named `name` in the root, or null (none, several, or a list too long to tell). */
  async function findBare(root, name) {
    const { files, truncated } = await fileList(root);
    if (truncated) return null;
    let hit = null;
    for (const f of files) {
      if (f === name || f.endsWith(`/${name}`)) { if (hit) return null; hit = f; }
    }
    return hit;
  }

  return {
    linkRefusal,
    /** Browser candidates → { [raw]: { ok:true, path, type, lines?, member? } | { ok:false } }. Never throws. */
    async resolve(roots, raws) {
      const out = {};
      await mapLimit(raws, limits.resolveConcurrency ?? CHAT_LINK_LIMITS.resolveConcurrency, async (raw) => {
        out[raw] = { ok: false };
        const n = normalizeLinkPath(raw);
        if (!n) return;
        trace?.('start');
        try {
          const bare = !n.dir && !n.path.includes('/');
          for (const root of roots) {
            try {
              const rel = bare ? await findBare(root, n.path) : n.path;
              if (!rel) continue;
              const s = await statRel(root, rel);
              if (s.type === 'other' || (n.dir && s.type !== 'dir')) continue;
              out[raw] = { ok: true, path: s.path, type: s.type, ...(s.lines != null ? { lines: s.lines } : {}),
                ...(root.member ? { member: root.member } : {}) };
              return;
            } catch { /* not in this root, or refused: plain text */ }
          }
        } finally { trace?.('end'); }
      });
      return out;
    },
    /** open_tab's check: { path, type, line?, endLine?, root, member? }, or a ChatLinkError the assistant reads. */
    async target(roots, input = {}) {
      const n = normalizeLinkPath(input.path);
      if (!n) throw new ChatLinkError('BAD_PATH', 'path must be a path from the project\'s top folder, like src/app.js: never absolute, never with ..');
      const line = input.line ?? null;
      const endLine = input.endLine ?? null;
      if (line != null && !(Number.isInteger(line) && line >= 1 && line <= LINE_MAX)) throw new ChatLinkError('BAD_LINE', 'line must be a whole number from 1');
      if (endLine != null && (line == null || !Number.isInteger(endLine) || endLine < line || endLine > LINE_MAX)) {
        throw new ChatLinkError('BAD_LINE', 'endLine needs a line and must not come before it');
      }
      for (const root of roots) {
        let s = null;
        try { s = await statRel(root, n.path); }
        catch (e) {
          if (e.code !== 'NOT_FOUND') throw e;
          if (!n.dir && !n.path.includes('/')) {
            const rel = await findBare(root, n.path);
            if (rel) s = await statRel(root, rel);
          }
        }
        if (!s || s.type === 'other' || (n.dir && s.type !== 'dir')) continue;
        if (line != null && s.type === 'dir') throw new ChatLinkError('BAD_LINE', `${s.path} is a folder: a line needs a file`);
        if (line != null && s.binary) throw new ChatLinkError('BAD_LINE', `${s.path} is not a text file: it has no lines`);
        if (line != null && s.lines != null && (line > s.lines || (endLine ?? 0) > s.lines)) {
          throw new ChatLinkError('BAD_LINE', `${s.path} has ${s.lines} line${s.lines === 1 ? '' : 's'}`);
        }
        return { path: s.path, type: s.type, ...(line != null ? { line } : {}), ...(endLine != null ? { endLine } : {}),
          root: root.root || null, ...(root.member ? { member: root.member } : {}) };
      }
      throw new ChatLinkError('NOT_FOUND', `${n.path} is not in ${roots[0]?.label || "this chat's project"}`);
    },
    /** The Files tab's folder listing of a branch root, in listFolder()'s shape. */
    async list(root, relIn = '') {
      const rel = cleanRel(relIn);
      if (rel) {
        const s = await statBranch(root, rel);
        if (s.type !== 'dir') throw new ToolFolderError('NOT_A_FOLDER', 'That is a file, not a folder.');
      }
      const r = await git(root, ['ls-tree', '-z', '--long', root.ref, ...(rel ? ['--', `${rel}/`] : [])], 8 * 1024 * 1024);
      const all = parseTree(r.stdout).map((e) => ({ ...e, name: e.path.slice(rel ? rel.length + 1 : 0) }))
        .filter((e) => e.name && !e.name.includes('/') && !isGitName(e.name))
        .sort((a, z) => ((a.type === 'tree') === (z.type === 'tree') ? byName(a.name, z.name) : a.type === 'tree' ? -1 : 1));
      const entries = all.slice(0, TOOL_FOLDER_LIMITS.maxEntries).map((e) => (e.mode === '120000' ? { name: e.name, type: 'link', target: null }
        : e.type === 'tree' ? { name: e.name, type: 'dir' } : e.type === 'blob' ? { name: e.name, type: 'file', size: e.size } : { name: e.name, type: 'other' }));
      return { path: rel, entries, truncated: !!r.truncated || all.length > TOOL_FOLDER_LIMITS.maxEntries };
    },
    /** One branch file as text, in readFolderFile()'s shape. */
    async read(root, relIn) {
      const rel = cleanRel(relIn);
      if (!rel) throw new ToolFolderError('NOT_A_FILE', 'Pick a file.');
      if (linkRefusal(rel)) throw new ChatLinkError('REFUSED', `${rel}: ${linkRefusal(rel)}`);   // a branch root is chat-link surface: D5 always
      const s = await statBranch(root, rel);
      if (s.type !== 'file') throw new ToolFolderError('NOT_A_FILE', 'That is not a file.');
      const bytes = await readBlobHead(root.repoDir, s.sha, Math.min(s.size, TOOL_FOLDER_LIMITS.maxFileBytes), limits.gitTimeoutMs);
      const binary = isBinary(bytes);
      const text = binary ? '' : new TextDecoder('utf-8').decode(bytes, { stream: s.size > bytes.length });
      return { path: rel, size: s.size, shown: bytes.length, truncated: s.size > bytes.length, binary, text };
    },
    /** One branch file as an open handle for sendRawFile: { fh, cleanup } (cleanup removes the private temp copy;
     *  POSIX removes it at once, the open handle keeps the bytes). TOO_LARGE above blobMax. */
    async openRaw(root, relIn) {
      const rel = cleanRel(relIn);
      if (!rel) throw new ToolFolderError('NOT_A_FILE', 'Pick a file.');
      if (linkRefusal(rel)) throw new ChatLinkError('REFUSED', `${rel}: ${linkRefusal(rel)}`);
      const s = await statBranch(root, rel);
      if (s.type !== 'file') throw new ToolFolderError('NOT_A_FILE', 'That is not a file.');
      if (s.size > limits.blobMax) throw new ChatLinkError('TOO_LARGE', 'This file is too large to show from the branch.');
      const buf = await readBlobHead(root.repoDir, s.sha, s.size, limits.gitTimeoutMs);
      const dir = await mkdtemp(join(tmpdir(), 'worca-blob-'));
      const cleanup = () => { rm(dir, { recursive: true, force: true }).catch(() => {}); };
      let fh;
      try {
        const file = join(dir, 'blob');
        await writeFile(file, buf, { mode: 0o600 });
        fh = await open(file, 'r');
      } catch (e) { cleanup(); throw e; }
      // Windows cannot remove an open file: remove the copy once the handle closes (sendRawFile closes it).
      if (process.platform !== 'win32') cleanup(); else fh.once('close', cleanup);
      return { fh, cleanup };
    },
  };
}
