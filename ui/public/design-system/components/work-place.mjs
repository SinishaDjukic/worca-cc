// Where a run's work goes (docs/rail/thing-page.md): one phrase in the metadata line that follows the run, never a badge.
// `workPhrase` says it in words, for a list or Chat; `workPlace` draws it for a thing's page. A branch is named once, and
// loses its middle, never its end.
import { esc, attrs } from './html.mjs';

/** A branch or path split at its fold: what may shorten, and the end that tells two apart. */
export function foldMiddle(t) {
  const k = Math.max(t.lastIndexOf('-'), t.lastIndexOf('/'));
  const cut = k > 0 && t.length - k <= 16 ? k : Math.max(0, t.length - 12);
  return [t.slice(0, cut), t.slice(cut)];
}

/**
 * The phrase as parts.
 * @param {object} p  { branch, base, pr, folder, onSource, hidden, merged, applied, finished }
 * @returns {{kind:'word'|'branch'|'copy'|'base'|'pr'|'folder', text:string}[]}
 */
export function workParts(p) {
  const w = (text) => ({ kind: 'word', text });
  const br = (text = p.branch) => ({ kind: 'branch', text });
  const base = { kind: 'base', text: p.base };
  const pr = { kind: 'pr', text: p.pr };
  if (p.folder) return [w(p.applied ? 'written into' : 'into'), { kind: 'folder', text: p.folder }];
  if (!p.branch) return [];
  if (p.onSource && p.hidden) return [br(p.hidden), w('not merged into'), { kind: 'copy', text: p.branch }];
  if (p.onSource && !p.finished) return [w('on'), br(), w('then to'), base];
  if (p.onSource || p.base === 'origin/main') return [br(), w('to'), base];
  return [...(p.pr && !p.merged ? [pr, w('merges')] : []), br(), w(p.merged ? 'merged into' : 'into'), base, ...(p.pr && p.merged ? [w('by'), pr] : [])];
}

/** The phrase in plain words: "#959 merges feat/x into dev". */
export const workPhrase = (p) => workParts(p).map((x) => x.text).join(' ');

const mid = (t) => { const [a, b] = foldMiddle(t); return `<code class="rc-mid" title="${esc(t)}"><span class="rc-mid-a">${esc(a)}</span><span class="rc-mid-b">${esc(b)}</span></code>`; };

/** The phrase for a thing's page: the branch copies itself on a click, the PR opens it. Empty when no work goes anywhere. */
export function workPlace(p) {
  const parts = workParts(p);
  if (!parts.length) return '';
  const branch = (t) => (p.copy ? `<button type="button" class="rc-branch"${attrs({ 'data-key': 'copy', 'data-say': `Copied ${t}`, title: 'Copy branch name', 'aria-label': `Copy branch name ${t}` })}>${mid(t)}</button>` : mid(t));
  const DRAW = {
    word: (t) => `<span class="rc-word-sm">${esc(t)}</span>`, branch, copy: mid, folder: mid,
    base: (t) => `<code class="rc-base">${esc(t)}</code>`,
    pr: (t) => `<a class="rc-pr" href="#"${attrs({ 'data-key': 'pr', 'data-say': `Opens ${t} on GitHub`, title: `Open ${t} on GitHub` })}>${esc(t)}</a>`,
  };
  return `<span class="rc-place">${parts.map((x) => DRAW[x.kind](x.text)).join('')}</span>`;
}
