// experiments/messaging-bus/lib/replay-tree.mjs — E7's working tree (plan §4.11, the M2 fix).
// The tree is seeded from the REAL base blobs of a past run; the run's final diff is cut into its hunks,
// each armed tool call gets hunks in time order, and each hunk is applied BY POSITION (never searched for),
// so every gap is counted instead of silently papered over. The final text is checked against the
// final blob id without git (gitBlobId).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const ARMED_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const EXPAND_MAX = 20;

/** Lines with their own `\n` (the last one may lack it). */
const splitKeep = (text) => String(text).match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** `sha1("blob <bytes>\0" + text)`, the id `git hash-object` gives the same text. */
export function gitBlobId(text) {
  const body = Buffer.from(String(text), 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
}

/**
 * The replay's validity gate: the paths whose replayed text is NOT the run's final blob. `files` maps a
 * path to its fixture entry (`finalBlob` = an id prefix; null = deleted); `readText` gives the text now,
 * or null when the file is absent.
 */
export function checkFinal(paths, files, readText) {
  const mismatched = [];
  for (const p of paths) {
    const text = readText(p);
    const want = files.get(p)?.finalBlob ?? null;
    const ok = want === null ? text === null : gitBlobId(text ?? '').startsWith(want);
    if (!ok) mismatched.push(p);
  }
  return mismatched;
}

/** A unified diff → `[{ path, status, baseBlob, finalBlob, hunks:[{ oldStart, oldCount, lines }] }]`. */
export function parsePatch(text) {
  const files = [];
  let f = null;
  let h = null;
  for (const line of String(text).split('\n')) {
    let m;
    if ((m = /^diff --git a\/(.+) b\/(.+)$/.exec(line))) {
      f = { path: m[2], status: 'modified', baseBlob: null, finalBlob: null, hunks: [] };
      files.push(f);
      h = null;
    } else if (!f) continue;
    else if (!h && /^new file mode/.test(line)) f.status = 'created';
    else if (!h && /^deleted file mode/.test(line)) f.status = 'deleted';
    else if (!h && (m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line))) {
      f.baseBlob = /^0+$/.test(m[1]) ? null : m[1];
      f.finalBlob = /^0+$/.test(m[2]) ? null : m[2];
    } else if ((m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line))) {
      h = { oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), lines: [] };
      f.hunks.push(h);
    } else if (h && /^[ +\-\\]/.test(line)) h.lines.push(line);
  }
  return files;
}

/** Hunk lines → ops `{ op, text }` with each text's own newline (a `\` marker removes the previous one's). */
function opsOf(lines) {
  const ops = [];
  for (const l of lines) {
    if (l.startsWith('\\')) {
      const prev = ops.at(-1);
      if (prev) prev.text = prev.text.replace(/\n$/, '');
    } else ops.push({ op: l[0], text: `${l.slice(1)}\n` });
  }
  return ops;
}

/** Applies hunks at `oldStart + offset`; a hunk whose context / `-` lines do not match there is skipped and counted. */
export function applyCall(text, hunks, offset) {
  const lines = splitKeep(text);
  let off = offset;
  let unapplied = 0;
  for (const h of hunks ?? []) {
    const ops = opsOf(h.lines);
    const oldLines = ops.filter((o) => o.op !== '+').map((o) => o.text);
    const newLines = ops.filter((o) => o.op !== '-').map((o) => o.text);
    const idx = (h.oldCount > 0 ? h.oldStart - 1 : h.oldStart) + off;
    let match = idx >= 0 && idx + oldLines.length <= lines.length;
    for (let i = 0; match && i < oldLines.length; i++) if (lines[idx + i] !== oldLines[i]) match = false;
    if (!match) { unapplied += 1; continue; }
    // inserting after a last line that lacks its newline gives that line one
    if (oldLines.length === 0 && idx > 0 && idx === lines.length && !lines[idx - 1].endsWith('\n')) lines[idx - 1] += '\n';
    lines.splice(idx, oldLines.length, ...newLines);
    off += newLines.length - oldLines.length;
  }
  return { text: lines.join(''), offset: off, ok: unapplied === 0, unapplied };
}

/**
 * callIndex → `{ path, hunks, tool, contentless }` for every ARMED call (an edit tool on a path in `files`,
 * outside the fix cycle). Per path, in `t` order: the k-th call gets the k-th hunk, leftovers join the last
 * call, extra calls get none. A created path's single hunk is cut into one chunk per call; the first is a Write.
 */
export function assignHunks(fixture) {
  const byPath = new Map();
  const files = new Map((fixture.files ?? []).map((f) => [f.path, f]));
  const order = (fixture.calls ?? []).map((c, i) => [c, i]).sort((a, b) => a[0].t - b[0].t);
  for (const [c, i] of order) {
    if (!ARMED_TOOLS.has(c.tool) || c.phase === 'fix' || !c.path || !files.has(c.path)) continue;
    if (!byPath.has(c.path)) byPath.set(c.path, []);
    byPath.get(c.path).push([c, i]);
  }
  const out = new Map();
  for (const [path, calls] of byPath) {
    const f = files.get(path);
    if (f.status === 'created') {
      const all = f.hunks.flatMap((h) => h.lines);
      const plus = all.filter((l) => !l.startsWith('\\')).length;
      const size = Math.max(1, Math.ceil(plus / calls.length));
      const chunks = calls.map(() => []);
      let k = 0;
      let n = 0;
      for (const l of all) {
        if (l.startsWith('\\')) { chunks[Math.min(k, chunks.length - 1)].push(l); continue; }
        if (n === size && k < chunks.length - 1) { k += 1; n = 0; }
        chunks[k].push(l);
        n += 1;
      }
      calls.forEach(([c, i], j) => {
        const hunks = chunks[j].length ? [{ oldStart: 0, oldCount: 0, lines: chunks[j] }] : [];
        out.set(i, { path, hunks, tool: j === 0 ? 'Write' : c.tool, contentless: hunks.length === 0 });
      });
    } else {
      calls.forEach(([c, i], j) => {
        const last = j === calls.length - 1;
        const hunks = last ? f.hunks.slice(j) : f.hunks.slice(j, j + 1);
        out.set(i, { path, hunks, tool: c.tool, contentless: hunks.length === 0 });
      });
    }
  }
  return out;
}

const occurrences = (s, sub) => {
  if (!sub) return 0;
  let n = 0;
  for (let i = s.indexOf(sub); i >= 0; i = s.indexOf(sub, i + 1)) n++;
  return n;
};

/**
 * The tool_input a real call would have carried (file_path is the caller's). A Write carries the text; an Edit
 * carries the changed lines, widened by context until old_string occurs once in `before` (≤ 20 lines a side).
 */
export function toolInputFor(tool, before, after, stats) {
  if (tool !== 'Edit' && tool !== 'MultiEdit') return { content: after };
  const a = splitKeep(before);
  const b = splitKeep(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  let input = null;
  for (let e = 0; e <= EXPAND_MAX; e++) {
    const lo = Math.max(0, p - e);
    const tail = Math.min(s, e);
    const old = a.slice(lo, a.length - s + tail).join('');
    input = { old_string: old, new_string: b.slice(lo, b.length - s + tail).join('') };
    if (old && occurrences(before, old) === 1) return input;
  }
  if (stats) stats.nonUnique = (stats.nonUnique ?? 0) + 1;
  return input;
}

/** `git init` in `dir`, every modified file's base text written and committed (HEAD = the real pre-run tree). */
export function seedTree(dir, fixture, readBlob) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  const seeded = [];
  const baseMissing = [];
  for (const f of fixture.files ?? []) {
    if (f.status !== 'modified') continue;
    const text = f.baseBlob ? readBlob(f.baseBlob) : null;
    if (text === null || text === undefined) { baseMissing.push(f.path); continue; }
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), text);
    seeded.push(f.path);
  }
  git('add', '-A');
  git('-c', 'user.name=e7', '-c', 'user.email=e7@example.invalid', 'commit', '-q', '-m', 'base', '--allow-empty');
  return { seeded, baseMissing };
}
