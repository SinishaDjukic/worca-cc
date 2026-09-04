// ui/public/artifact-view.mjs — typed viewers for per-step run artifacts.
//
// Markdown reuses ask-markdown.mjs's createMarkdownRenderer verbatim — the SAME
// sanitizer the Ask panel uses (marked + DOMPurify, one shared allowlist +
// post-pass), so there is exactly ONE security-sensitive markdown path to audit.
// `escapeHtml`, `viewerKindFor` and `artifactsByNodeCycle` are pure and
// node-testable; the renderers touch the DOM and (for markdown) lazily load the
// vendor bundle through an injected `deps.loadMarkdown`, so a test harness can
// stub it the way window.__worcaTestHooks?.askMarkdown does.
import { createMarkdownRenderer } from './ask-markdown.mjs';

/** Escape the five HTML metacharacters. Pure. */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Pick a viewer for an artifact by kind + relPath. Pure.
 * @param {string} kind
 * @param {string} [relPath]
 * @returns {'markdown'|'diff'|'json'|'text'}
 */
export function viewerKindFor(kind, relPath = '') {
  const ext = (String(relPath).split('.').pop() || '').toLowerCase();
  // An explicit file extension is authoritative; the generic kind (plan/review/
  // result) is only a fallback for extensionless paths, so a 'result' that is a
  // .json renders as JSON rather than being forced through the diff viewer.
  if (ext === 'md') return 'markdown';
  if (ext === 'diff' || ext === 'patch') return 'diff';
  if (ext === 'json') return 'json';
  if (kind === 'plan' || kind === 'review') return 'markdown';
  if (kind === 'result') return 'diff';
  return 'text';
}

/**
 * Group a run's artifacts by nodeId then cycle for the per-node UI. Legacy
 * artifacts (nodeId == null) fall into the '__run__' bucket. Pure.
 * @param {Array<{nodeId?:string|null, cycle?:number|null}>} [artifacts]
 * @returns {Map<string, Map<number, Array>>} nodeId -> cycle -> artifacts[]
 */
export function artifactsByNodeCycle(artifacts = []) {
  const groups = new Map(); // nodeId -> Map(cycle -> [])
  for (const a of artifacts) {
    const node = a.nodeId ?? '__run__';
    const cyc = a.cycle ?? 0;
    if (!groups.has(node)) groups.set(node, new Map());
    const byCyc = groups.get(node);
    if (!byCyc.has(cyc)) byCyc.set(cyc, []);
    byCyc.get(cyc).push(a);
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
export function renderDiff(text, mount) {
  const doc = mount.ownerDocument;
  const pre = doc.createElement('pre');
  pre.className = 'artifact-diff';
  for (const line of String(text ?? '').split('\n')) {
    const row = doc.createElement('span');
    // File headers are the space-terminated '+++ '/'--- ' forms (plus diff/index);
    // a bare '+++'/'---' with no space is real added/removed CONTENT (e.g. deleting
    // '--flag' yields the line '---flag'), so classify meta FIRST, then +/-.
    row.className = 'artifact-diff-line'
      + (line.startsWith('+++ ') || line.startsWith('--- ')
        || line.startsWith('diff ') || line.startsWith('index ') ? ' meta'
        : line.startsWith('+') ? ' add'
          : line.startsWith('-') ? ' del'
            : line.startsWith('@@') ? ' hunk' : '');
    row.textContent = `${line}\n`;
    pre.appendChild(row);
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
  if (view === 'markdown') return renderMarkdown(text, mount, deps);
  if (view === 'diff') return renderDiff(text, mount);
  if (view === 'json') return renderJson(text, mount);
  return renderText(text, mount);
}
