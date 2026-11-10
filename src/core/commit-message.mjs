// src/core/commit-message.mjs
// The commit a run makes for its work (#1143): at teardown (run-harness `_commitWork`) and again by Apply to
// branch (pipeline-delete `applyRetainedUnderLock`, through worktree `commitStagedWork`). Built WITHOUT a
// model call, from run data only: a short summary (the newest plan's goal, else a cached overview narrative,
// else the latest implementation review), the commit's own staged file stats, and a `Worca-Run: <id>` git
// trailer. The task prompt is never read: it can hold internal notes, pasted logs or attachment text, and
// this message rides the branch into a pull request.
import { join } from 'node:path';
import { readPipelineExtras, newestPlanPath } from './artifacts.mjs';
import { readRegularText } from './folder-copy.mjs';
import { OVERVIEW_FILE } from './results.mjs';
import { scanSecrets } from './secret-scan.mjs';

export const RUN_TRAILER = 'Worca-Run';
export const WRAP_WIDTH = 72;
export const SUMMARY_MAX = 600;
export const FILE_ROWS_MAX = 20;

const CONTROL = /[\x00-\x1f\x7f]/g;
// Best first. A heading must START with the word ("1. Goal and scope"): "Task 3: Overview page" and "Non-goals" do not.
const GOAL_HEADINGS = [/^(goals?|objectives?|purpose)\b/i, /^(summary|overview)\b/i, /^(problem|motivation)\b/i];
// What GitHub reads as "close this issue on merge": "fixes #8", "Closes: GH-8", "resolved acme/app#8".
const CLOSING_REF = /(\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+)((?:[\w.-]+\/[\w.-]+)?)(?:#|GH-)(\d+)\b/gi;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const oneLine = (v) => String(v ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const pathText = (v) => String(v ?? '').replace(CONTROL, '?');

/** Words of `text` re-flowed at `width` columns. A word longer than `width` (a URL) keeps a line of its own. */
export function wrapText(text, width = WRAP_WIDTH) {
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join('\n');
}

/**
 * The goal of a plan, as one line of text: the first block under the best heading that names the goal
 * (GOAL_HEADINGS), else the first prose paragraph. Front matter,
 * fenced code, tables, blockquotes, HTML and rules are skipped; a list joins its items with "; ".
 * '' when nothing qualifies.
 */
export function planGoal(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) return '';
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end > 0) i = end + 1;
  }
  const blocks = [];
  let heading = null;
  let cur = null;
  let fence = null;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (fence) { if (t.startsWith(fence)) fence = null; continue; }
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (f) { flush(); fence = f[1]; continue; }
    if (!t) { flush(); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(t);
    if (h) { flush(); heading = h[1]; continue; }
    if (/^(\||>|<)/.test(t) || /^([-*_])(\s*\1){2,}$/.test(t)) { flush(); continue; }
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(t);
    if (item) {
      if (cur?.kind !== 'list') { flush(); cur = { heading, kind: 'list', lines: [] }; }
      cur.lines.push(item[1]);
    } else if (cur?.kind === 'list') {
      cur.lines[cur.lines.length - 1] += ` ${t}`;
    } else {
      if (!cur) cur = { heading, kind: 'para', lines: [] };
      cur.lines.push(t);
    }
  }
  flush();
  const text = (b) => (b.kind === 'list' ? b.lines.join('; ') : b.lines.join(' '));
  const name = (b) => (b.heading || '').replace(/^[^\p{L}]+/u, '');
  for (const re of GOAL_HEADINGS) {
    const under = blocks.find((b) => re.test(name(b)));
    if (under) return text(under);
  }
  const para = blocks.find((b) => b.kind === 'para');
  return para ? text(para) : '';
}

/** `text` made safe and short for a commit body: links and bold markers dropped (`**` only: `__init__` and
 *  `2**3` are not bold), a reference after a closing keyword made inert so merging closes no issue, one line, at
 *  most SUMMARY_MAX characters (cut at a sentence end when one is past a third, else at a word, with "..."). Fails closed: ''
 *  when secret-scan.mjs finds anything in it (a credential, a broker token, an email address, an internal host,
 *  a home path), since the commit rides the branch into a pull request. A redactor is not used: the
 *  workspace-map one rewrites prose such as "Second pass: the fix" as "Second pass: *** fix". */
export function cleanSummary(text) {
  const s = String(text ?? '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(?<![\w*])\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || scanSecrets(s).length) return '';
  const inert = s.replace(CLOSING_REF, (_, keyword, repo, n) => `${keyword}${repo ? `${repo} ` : ''}issue ${n}`);
  if (inert.length <= SUMMARY_MAX) return inert;
  const cut = inert.slice(0, SUMMARY_MAX);
  const end = cut.lastIndexOf('. ');
  if (end >= SUMMARY_MAX / 3) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : SUMMARY_MAX)}...`;
}

/**
 * Parse `git diff --cached -M -z --name-status` and `… --numstat` output into the commit's file list.
 * A rename's numstat record is `a\td\t` followed by the old and new path as two NUL-separated fields.
 * @returns {{files:Array<{status:string, path:string, from?:string, added:number, removed:number, binary?:true}>,
 *           insertions:number, deletions:number}}
 */
export function parseStagedChanges(nameStatusZ, numstatZ) {
  const counts = new Map();
  const nt = String(numstatZ ?? '').split('\0');
  for (let i = 0; i < nt.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(nt[i]);
    if (!m) continue;
    let path = m[3];
    if (path === '') { path = nt[i + 2] ?? ''; i += 2; }
    const binary = m[1] === '-' || m[2] === '-';
    counts.set(path, { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary });
  }
  const files = [];
  const st = String(nameStatusZ ?? '').split('\0');
  for (let i = 0; i < st.length; i++) {
    if (!/^[A-Z]\d*$/.test(st[i])) continue;
    const status = st[i][0];
    let from = null;
    let path;
    if (status === 'R' || status === 'C') { from = st[i + 1]; path = st[i + 2]; i += 2; }
    else { path = st[i + 1]; i += 1; }
    if (!path) continue;
    const n = counts.get(path) || { added: 0, removed: 0, binary: false };
    files.push({ status, path, ...(from ? { from } : {}), added: n.added, removed: n.removed, ...(n.binary ? { binary: true } : {}) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    insertions: files.reduce((s, f) => s + f.added, 0),
    deletions: files.reduce((s, f) => s + f.removed, 0),
  };
}

/**
 * What the next commit holds: the index against HEAD. `runGit(args)` runs git in the checkout and resolves
 * `{ ok, stdout }` (the harness's `_git`, worktree's own runner). Never throws: null when git fails.
 */
export async function readStagedChanges(runGit) {
  try {
    const base = ['-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '--no-ext-diff', '-M', '-l0', '-z'];
    const ns = await runGit([...base, '--name-status']);
    if (!ns?.ok) return null;
    const num = await runGit([...base, '--numstat']);
    if (!num?.ok) return null;
    return parseStagedChanges(ns.stdout, num.stdout);
  } catch {
    return null;
  }
}

function fileRow(f) {
  const name = f.from ? `${pathText(f.from)} -> ${pathText(f.path)}` : pathText(f.path);
  const counts = f.binary ? 'binary' : [f.added ? `+${f.added}` : '', f.removed ? `-${f.removed}` : ''].filter(Boolean).join(' ');
  return `${oneLine(f.status)}  ${name}${counts ? ` (${counts})` : ''}`;
}

function changesBlock(changes) {
  const files = Array.isArray(changes?.files) ? changes.files : [];
  if (!files.length) return '';
  const ins = Number(changes.insertions) || 0;
  const del = Number(changes.deletions) || 0;
  const head = [`${plural(files.length, 'file')} changed`,
    ...(ins ? [`${plural(ins, 'insertion')}(+)`] : []),
    ...(del ? [`${plural(del, 'deletion')}(-)`] : [])].join(', ');
  const rows = files.slice(0, FILE_ROWS_MAX).map(fileRow);
  if (files.length > FILE_ROWS_MAX) rows.push(`... and ${plural(files.length - FILE_ROWS_MAX, 'more file')}`);
  return `${head}\n\n${rows.join('\n')}`;
}

/**
 * The run's commit message. Paragraphs, in order, each dropped when empty: `worca: <title>`, the summary
 * wrapped at 72 columns, the staged file stats, and the `Worca-Run: <id>` trailer (always last, so git's
 * trailer parser reads it). `prefix: false` drops the "worca: " in front of the title and `runTrailer: false`
 * drops the trailer (Settings › Runs › Commit message, settings.mjs commitMessageSettings).
 * @param {{title?:string, runId?:string|null, summary?:string, changes?:ReturnType<typeof parseStagedChanges>|null,
 *          prefix?:boolean, runTrailer?:boolean}} o
 */
export function buildRunCommitMessage({ title = '', runId = null, summary = '', changes = null, prefix = true, runTrailer = true } = {}) {
  const head = oneLine(title) || 'changes';
  const paras = [prefix ? `worca: ${head}` : head];
  const body = wrapText(summary);
  if (body) paras.push(body);
  const stats = changesBlock(changes);
  if (stats) paras.push(stats);
  const id = runTrailer ? oneLine(runId) : '';
  if (id) paras.push(`${RUN_TRAILER}: ${id}`);
  return paras.join('\n\n');
}

async function readText(path) {
  try { return await readRegularText(path); } catch { return null; }
}

function latestWorkReviewSummary(reviews) {
  for (const kind of ['impl', 'ws']) {
    const rows = (reviews || []).filter((r) => r.kind === kind && typeof r.summary === 'string' && r.summary.trim());
    if (rows.length) return rows.reduce((a, b) => (b.cycle > a.cycle ? b : a)).summary;
  }
  return '';
}

/**
 * The commit body's summary for one run, cleaned (cleanSummary): the newest plan's goal, else the cached
 * overview narrative (never generated here), else the latest implementation (or workspace) review summary.
 * A source cleanSummary rejects counts as absent: the next one is tried.
 * `storeRoot` is the store the plan index is relative to; `pipelineDir` the run folder. Never reads the task
 * prompt. Never throws: '' when there is nothing to say.
 */
export async function readCommitSummary({ pipelineId = null, pipelineDir = null, storeRoot = null } = {}) {
  try {
    if (pipelineId && storeRoot) {
      const plan = await newestPlanPath(pipelineId, storeRoot);
      const goal = plan ? cleanSummary(planGoal(await readText(plan))) : '';
      if (goal) return goal;
    }
    if (pipelineDir) {
      const raw = await readText(join(pipelineDir, OVERVIEW_FILE));
      let narrative = '';
      try { narrative = raw ? JSON.parse(raw)?.narrative : ''; } catch { narrative = ''; }
      const overview = typeof narrative === 'string' ? cleanSummary(narrative) : '';
      if (overview) return overview;
    }
    if (pipelineId) {
      const review = latestWorkReviewSummary(readPipelineExtras(pipelineId).reviews);
      if (review) return cleanSummary(review);
    }
  } catch { /* best effort: no summary */ }
  return '';
}
