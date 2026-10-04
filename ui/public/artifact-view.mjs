// ui/public/artifact-view.mjs — typed viewers for per-step run artifacts.
//
// Markdown reuses ask-markdown.mjs's createMarkdownRenderer verbatim — the SAME
// sanitizer the Ask panel uses (marked + DOMPurify, one shared allowlist +
// post-pass), so there is exactly ONE security-sensitive markdown path to audit.
// `viewerKindFor` and `artifactsByNodeStep` are pure and node-testable; the
// renderers touch the DOM (textContent / replaceChildren, never innerHTML — so no
// escape helper lives here; app.js keeps its own escapeHtml for the rows it
// templates) and (for markdown) lazily load the vendor bundle through an
// injected `deps.loadMarkdown`, so a test harness can stub it the way
// window.__worcaTestHooks?.askMarkdown does.
import { createMarkdownRenderer } from './ask-markdown.mjs';
import { BINARY_KINDS, scanKindFor } from '../../src/shared/artifact-kinds.mjs';

/**
 * Pick a viewer for an artifact by kind + relPath. Pure.
 * @param {string} kind
 * @param {string} [relPath]
 * @returns {'markdown'|'diff'|'json'|'text'|'binary'}
 */
export function viewerKindFor(kind, relPath = '') {
  // The extension's FORMAT kind, by the SAME function the read route classifies
  // with (artifacts.mjs resolveIndexedArtifactForRow) — one parser, so a name the
  // route serves as text (`.env`, a leading-dot name) is never shown as binary
  // here, and vice versa.
  const fmt = scanKindFor(relPath);
  // A binary kind — or a binary EXTENSION under any kind (a run extra, a free-text
  // artifactKind) — never reaches a text viewer (D11); the read route answers 415.
  if (BINARY_KINDS.has(kind) || BINARY_KINDS.has(fmt)) return 'binary';
  // An explicit file extension is authoritative; the generic engine kind (plan/
  // review/result) is only a fallback for extensionless paths, so a 'result' that
  // is a .json renders as JSON rather than being forced through the diff viewer.
  if (fmt !== 'text') return fmt;
  if (kind === 'markdown' || kind === 'plan' || kind === 'review') return 'markdown';
  if (kind === 'json') return 'json';
  if (kind === 'diff' || kind === 'result') return 'diff';
  return 'text';
}

/** Rows rendered before the diff viewer stops and says how many it left out —
 *  the read cap is 2 MB, i.e. tens of thousands of lines, and one <span> per line
 *  in a single synchronous pass is what makes the page unresponsive. */
export const DIFF_MAX_ROWS = 5000;

/**
 * Group a run's artifacts by nodeId, then by the EXECUTION that wrote them — the
 * same unit the run folder is cut by (`steps/<node>-c<N>[-<slice>]/`), so a node
 * that looped keeps one bucket per cycle and a node that fanned out keeps one
 * bucket per slice instead of merging the slices under their shared cycle number.
 * `stepKey` (the executionId) is the bucket identity; a row that carries none (a
 * v1 artifact, or a legacy re-index) falls back to its cycle. Artifacts with no
 * node (nodeId == null) fall into the '__run__' bucket. Buckets come out ordered
 * by cycle, ties in arrival order. Pure.
 * @param {Array<{nodeId?:string|null, stepKey?:string|null, cycle?:number|null}>} [artifacts]
 * @returns {Map<string, Map<string, {stepKey:string|null, cycle:number|null, artifacts:Array}>>}
 *   nodeId -> bucketId -> {stepKey, cycle, artifacts}
 */
export function artifactsByNodeStep(artifacts = []) {
  const groups = new Map(); // nodeId -> Map(bucketId -> {stepKey, cycle, artifacts})
  for (const a of artifacts) {
    const node = a.nodeId ?? '__run__';
    const stepKey = a.stepKey ?? null;
    const cycle = a.cycle ?? null;
    const bucketId = stepKey ?? `c${cycle ?? 0}`;
    if (!groups.has(node)) groups.set(node, new Map());
    const byStep = groups.get(node);
    if (!byStep.has(bucketId)) byStep.set(bucketId, { stepKey, cycle, artifacts: [] });
    byStep.get(bucketId).artifacts.push(a);
  }
  // Cycle order, arrival order within a cycle: a loop reads 1 → 2 → 3 top to
  // bottom however the rows arrived, and a fan-out's slices keep emission order.
  for (const [node, byStep] of groups) {
    const sorted = [...byStep.entries()]
      .map((e, i) => ({ e, i }))
      .sort((x, y) => ((x.e[1].cycle ?? 0) - (y.e[1].cycle ?? 0)) || (x.i - y.i))
      .map(({ e }) => e);
    groups.set(node, new Map(sorted));
  }
  return groups;
}

/** Render escaped plaintext into a <pre>. */
export function renderText(text, mount) {
  const pre = mount.ownerDocument.createElement('pre');
  pre.className = 'artifact-text';
  pre.textContent = String(text ?? '');
  mount.replaceChildren(pre);
  return pre;
}

/** Pretty-print JSON (falls back to plaintext when it does not parse). */
export function renderJson(text, mount) {
  let pretty = String(text ?? '');
  try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch { /* keep raw text */ }
  const pre = mount.ownerDocument.createElement('pre');
  pre.className = 'artifact-json';
  pre.textContent = pretty;
  mount.replaceChildren(pre);
  return pre;
}

/** Render a unified diff, colouring +/-/@@ lines. */
export function renderDiff(text, mount, { maxRows = DIFF_MAX_ROWS } = {}) {
  const doc = mount.ownerDocument;
  const pre = doc.createElement('pre');
  pre.className = 'artifact-diff';
  const lines = String(text ?? '').split('\n');
  // Position-aware headers, the way diff-view.mjs parses them: `--- `/`+++ ` are
  // file headers only OUTSIDE a hunk; inside one they are removed/added CONTENT
  // (deleting a SQL comment `-- note` yields the line `--- note`; adding
  // `++ counter` right after it yields `+++ counter` — a pair that LOOKS like a
  // header, which is why no lookahead is used). Every file section of the
  // patches this app writes (git-info.mjs diffPatch: `git diff`) opens with a
  // `diff ` line, which is what closes the hunk. A bare `+++`/`---` with no
  // space is content everywhere ('---flag' from '--flag').
  let inHunk = false;
  const shown = Math.min(lines.length, maxRows);
  for (let i = 0; i < shown; i++) {
    const line = lines[i];
    const row = doc.createElement('span');
    let cls = '';
    if (line.startsWith('diff ') || line.startsWith('index ')) { cls = ' meta'; inHunk = false; }
    else if (line.startsWith('@@')) { cls = ' hunk'; inHunk = true; }
    else if (!inHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) cls = ' meta';
    else if (line.startsWith('+')) cls = ' add';
    else if (line.startsWith('-')) cls = ' del';
    row.className = `artifact-diff-line${cls}`;
    row.textContent = `${line}\n`;
    pre.appendChild(row);
  }
  if (lines.length > shown) {
    const more = doc.createElement('span');
    more.className = 'artifact-diff-line meta artifact-diff-more';
    more.textContent = `… ${lines.length - shown} more lines not shown\n`;
    pre.appendChild(more);
  }
  mount.replaceChildren(pre);
  return pre;
}

/**
 * Render markdown through ask-markdown.mjs's createMarkdownRenderer — the SAME
 * marked + DOMPurify sanitizer, allowlist and post-pass the Ask panel uses, so
 * untrusted artifact content has no separate security path. `deps.loadMarkdown`
 * returns { marked, createDOMPurify } (the seam app.js wires to
 * window.__worcaTestHooks?.askMarkdown). Falls back to escaped plaintext when the
 * bundle is unavailable or parsing/sanitizing fails.
 */
export async function renderMarkdown(text, mount, deps = {}) {
  const doc = mount.ownerDocument;
  const load = deps.loadMarkdown;
  if (typeof load !== 'function') return renderText(text, mount);
  const renderer = createMarkdownRenderer({ doc, load });
  if (!(await renderer.ensure())) return renderText(text, mount);
  const out = renderer.render(text);
  if (out.kind !== 'md') return renderText(text, mount);
  const box = doc.createElement('div');
  box.className = 'artifact-markdown';
  box.appendChild(out.frag);
  mount.replaceChildren(box);
  return box;
}

/**
 * Render one artifact into `mount`, dispatching on viewerKindFor.
 * @param {{kind:string, relPath:string, text:string}} artifact
 * @param {Element} mount
 * @param {{loadMarkdown?:Function}} [deps]
 */
export async function renderArtifact({ kind, relPath, text }, mount, deps = {}) {
  const view = viewerKindFor(kind, relPath);
  if (view === 'binary') return renderText('Binary file — not viewable', mount);
  if (view === 'markdown') return renderMarkdown(text, mount, deps);
  if (view === 'diff') return renderDiff(text, mount);
  if (view === 'json') return renderJson(text, mount);
  return renderText(text, mount);
}
