// src/core/ask/file-reader.mjs
// The file reader behind Worca's read-only file tools for Codex chats (file-deps.mjs): read_file, grep, glob. Every
// path is resolved (symlinks followed with realpath), must sit under the given roots, and must pass the deny rules a
// Claude chat hands the CLI (deny-rules.mjs). The walkers never follow a symlink.
// Kept apart from file-deps.mjs so that each grep worker (grep-worker.mjs) loads only this and its small imports,
// not the Worca home's database and settings modules, which roughly doubled a worker's start.
import { realpathSync, statSync, fstatSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { join, isAbsolute, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { ASK_DENY_RULES, askPathDenied, globMatcher, toPosix } from './deny-rules.mjs';
import { redactAskText } from './redact.mjs';

export class AskFileError extends Error { constructor(message) { super(message); this.name = 'AskFileError'; } }

export const ASK_FILE_LIMITS = Object.freeze({
  readDefaultLines: 400, readMaxLines: 2000, readMaxBytes: 4 * 1024 * 1024, lineMaxChars: 2000,
  grepMaxMatches: 200, grepMaxFiles: 5000, grepFileMaxBytes: 1024 * 1024, grepTimeoutMs: 10_000, globMaxResults: 1000, walkMaxEntries: 20_000, patternMaxChars: 500,
});

function readHead(path, max) {
  const fd = openSync(path, 'r');
  try {
    const want = Math.min(max, fstatSync(fd).size);   // a small file never costs the whole cap
    const buf = Buffer.alloc(want);
    const n = want ? readSync(fd, buf, 0, want, 0) : 0;
    return buf.subarray(0, n);
  } finally { closeSync(fd); }
}
const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

export function createAskFileReader({ roots = [], home = homedir(), rules = ASK_DENY_RULES, limits = ASK_FILE_LIMITS, redact = redactAskText, signal = null } = {}) {
  const real = (p) => { try { return realpathSync(p); } catch { return null; } };
  const rootReals = () => roots.map(real).filter(Boolean);
  const inside = (p, r) => p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
  const denied = (p) => askPathDenied(p, { rules, home });
  function check(raw, tool) {
    const want = typeof raw === 'string' ? raw.trim() : '';
    if (!want) throw new AskFileError(`${tool}: path is required`);
    if (!isAbsolute(want)) throw new AskFileError(`${tool}: path must be absolute — use the path list_worktrees or open_worktree returned`);
    const abs = resolve(want);
    const rp = real(abs);
    if (!rp) throw new AskFileError(`${tool}: ${abs} does not exist`);
    if (!rootReals().some((r) => inside(rp, r))) throw new AskFileError(`${tool}: ${abs} is outside this chat's worktrees, attachments and memory`);
    const rule = denied(abs) || denied(rp);
    if (rule) throw new AskFileError(`${tool}: ${abs} is protected (${rule})`);
    return rp;
  }
  function defaultBase(tool) {
    const wt = real(roots[0] || '');
    if (!wt) throw new AskFileError(`${tool}: this chat has no worktree yet — call open_worktree first, or pass a path`);
    return wt;
  }
  // Depth-first, sorted, never through a symlink, pruning denied folders (a trailing /** rule matches the folder itself).
  // Every entry visited counts against limits.walkMaxEntries, matched or not, so a pattern that matches nothing in a
  // huge tree stops too; `seen.capped` then says the walk did not finish.
  function* walk(base, seen = { n: 0, capped: false }) {
    const st = statSync(base);
    if (st.isFile()) { yield base; return; }
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      if ((seen.n += entries.length) > limits.walkMaxEntries) { seen.capped = true; return; }
      entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
      const files = [];
      for (const e of entries) {
        if (e.isSymbolicLink() || e.name === '.git') continue;
        const p = join(dir, e.name);
        if (denied(p)) continue;
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) files.unshift(p);
      }
      yield* files;
    }
  }
  function readText(p, max) {
    let buf;
    try { buf = readHead(p, max); } catch { return null; }
    return isBinary(buf) ? null : buf.toString('utf8');
  }
  function readFile({ path, offset, limit } = {}) {
    const p = check(path, 'read_file');
    const st = statSync(p);
    if (st.isDirectory()) throw new AskFileError(`read_file: ${path} is a folder — use glob to list it`);
    // A FIFO or device inside a root would block the open (or never end): only a regular file is read.
    if (!st.isFile()) throw new AskFileError(`read_file: ${path} is not a regular file`);
    const text = readText(p, limits.readMaxBytes);
    if (text === null) throw new AskFileError(`read_file: ${path} is a binary file`);
    const lines = text.replace(/\n$/, '').split('\n');
    const start = Math.max(1, Number.isInteger(offset) ? offset : 1);
    const count = Math.min(limits.readMaxLines, Math.max(1, Number.isInteger(limit) ? limit : limits.readDefaultLines));
    const slice = lines.slice(start - 1, start - 1 + count);
    const end = start - 1 + slice.length;
    const body = slice.map((l, i) => `${String(start + i).padStart(6)}\t${l.length > limits.lineMaxChars ? `${l.slice(0, limits.lineMaxChars)}…` : l}`).join('\n');
    const cut = st.size > limits.readMaxBytes;
    return { path: p, offset: start, lines: slice.length, totalLines: lines.length, nextOffset: end < lines.length ? end + 1 : null, text: redact(body),
      ...(cut ? { truncated: true, note: `the file is ${st.size} bytes; only its first ${limits.readMaxBytes} bytes were read (its last line may be cut)` } : {}) };
  }
  function regexOf(pattern, tool) {
    const pat = typeof pattern === 'string' ? pattern : '';
    if (!pat) throw new AskFileError(`${tool}: pattern is required`);
    if (pat.length > limits.patternMaxChars) throw new AskFileError(`${tool}: pattern is longer than ${limits.patternMaxChars} characters`);
    return pat;
  }
  function globFilter(base, pattern) {
    if (isAbsolute(pattern)) throw new AskFileError('glob: pattern is relative to path — pass the folder as path');
    const re = globMatcher(`${toPosix(base).replace(/\/+$/, '')}/${toPosix(pattern)}`);
    return (p) => re.test(toPosix(p));
  }
  // The search itself, unredacted: grep-worker.mjs runs it off the caller's thread (see grep below).
  function grepRaw({ pattern, path, glob } = {}) {
    let re;
    try { re = new RegExp(regexOf(pattern, 'grep')); } catch (err) { if (err instanceof AskFileError) throw err; throw new AskFileError(`grep: invalid regular expression: ${err.message}`); }
    const base = path ? check(path, 'grep') : defaultBase('grep');
    const keep = glob ? globFilter(statSync(base).isFile() ? join(base, '..') : base, String(glob)) : null;
    const matches = [];
    let files = 0;
    let truncated = false;
    const seen = { n: 0, capped: false };
    for (const f of walk(base, seen)) {
      if (keep && !keep(f)) continue;
      if (++files > limits.grepMaxFiles) { truncated = true; break; }
      const text = readText(f, limits.grepFileMaxBytes);
      if (text === null) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!re.test(lines[i])) continue;
        matches.push({ path: f, line: i + 1, text: lines[i].slice(0, limits.lineMaxChars) });
        if (matches.length >= limits.grepMaxMatches) { truncated = true; break; }
      }
      if (truncated) break;
    }
    return { matches, truncated: truncated || seen.capped };
  }
  // The pattern is the model's own regular expression, and V8's engine backtracks: `(a+)+$` can spin for hours on one
  // line. In relay mode these tools run inside the worca server (ui/server.mjs askAgentRelay), so the search runs in a
  // worker thread that is terminated after limits.grepTimeoutMs — a bad pattern costs that turn's call, never the server.
  function grep(input = {}) {
    return new Promise((done, fail) => {
      if (signal && signal.aborted) { fail(new AskFileError('grep: the turn ended')); return; }
      const worker = new Worker(new URL('./grep-worker.mjs', import.meta.url), { workerData: { roots, home, rules, limits, input } });
      let settled = false;
      const onAbort = () => finish(fail, new AskFileError('grep: the turn ended'));   // a stopped turn stops its search
      const finish = (fn, v) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); worker.terminate().catch(() => {}); fn(v);
      };
      const timer = setTimeout(() => finish(fail, new AskFileError(`grep: the search ran longer than ${Math.round(limits.grepTimeoutMs / 1000)} s and was stopped — use a simpler pattern, or narrow path or glob`)), limits.grepTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.once('message', (m) => {
        if (m && m.error) finish(fail, m.error.name === 'AskFileError' ? new AskFileError(m.error.message) : new Error(m.error.message));
        else finish(done, { matches: m.matches.map((x) => ({ ...x, text: redact(x.text) })), truncated: m.truncated });
      });
      worker.once('error', (err) => finish(fail, err));
      worker.once('exit', (code) => finish(fail, new Error(`grep: the search worker exited (${code})`)));
    });
  }
  function glob({ pattern, path } = {}) {
    const pat = regexOf(typeof pattern === 'string' ? pattern.trim() : '', 'glob');
    const base = path ? check(path, 'glob') : defaultBase('glob');
    const keep = globFilter(base, pat);
    const paths = [];
    let truncated = false;
    const seen = { n: 0, capped: false };
    for (const f of walk(base, seen)) {
      if (!keep(f)) continue;
      paths.push(f);
      if (paths.length >= limits.globMaxResults) { truncated = true; break; }
    }
    return { paths, truncated: truncated || seen.capped };
  }
  return { readFile, grep, grepRaw, glob };
}
