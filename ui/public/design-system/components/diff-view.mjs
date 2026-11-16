// DiffView (docs/stillhet/components.md): one file's changes, read as code. Side by side where it fits (old left, new
// right), unified where it does not (under about 900px of its own width, by a container query: the page does nothing).
// Every line has its number; an added or a removed line is marked by a sign (+ or −) and a word for a screen reader, and
// by a tint under ink text, so it never rests on colour alone and the text keeps its contrast. A Segmented picks
// "Side by side" or "Unified" where both fit.
import { attrs, esc } from './html.mjs';
import { segmented } from './segmented.mjs';

const WORD = { '+': 'added', '-': 'removed' };
const SIGN = { '+': '+', '-': '−', ' ': '' };

/** Where a hunk starts, from its "@@ -36,6 +38,7 @@" head: [old, new]; [1, 1] when it does not say. */
export function hunkStart(at = '') {
  const m = /-(\d+)(?:,\d+)?\s+\+(\d+)/.exec(at);
  return m ? [+m[1], +m[2]] : [1, 1];
}

/** A hunk's lines with their numbers: { k, text, a (old number or ''), b (new number or '') }. */
export function numbered(hunk) {
  let [a, b] = hunk.from || hunkStart(hunk.at);
  return hunk.lines.map(([k, text]) => (k === '+' ? { k, text, a: '', b: b++ } : k === '-' ? { k, text, a: a++, b: '' } : { k: ' ', text, a: a++, b: b++ }));
}

/** The same lines as pairs for side by side: a removed line stands beside the added line that replaced it. */
export function paired(lines) {
  const rows = []; let dels = [], adds = [];
  const flush = () => { for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push([dels[i] || null, adds[i] || null]); dels = []; adds = []; };
  for (const l of lines) {
    if (l.k === '-') { if (adds.length) flush(); dels.push(l); } else if (l.k === '+') adds.push(l); else { flush(); rows.push([l, l]); }
  }
  flush();
  return rows;
}

/** A file's patch as hunks: each "@@" head starts one; the file's own header lines are left out. */
export function parsePatch(text = '') {
  const hunks = [];
  for (const line of String(text).split('\n')) {
    if (line.startsWith('@@')) { hunks.push({ at: line, lines: [] }); continue; }
    const h = hunks[hunks.length - 1]; if (!h || line.startsWith('\\')) continue;
    const k = line[0] === '+' || line[0] === '-' ? line[0] : ' ';
    h.lines.push([k, line.slice(1)]);
  }
  return hunks;
}

const sign = (k) => `<td class="dv-s">${k === ' ' ? '' : `<span aria-hidden="true">${SIGN[k]}</span><span class="sr-only">${WORD[k]}</span>`}</td>`;
const cls = (k) => (k === '+' ? ' class="dv-add"' : k === '-' ? ' class="dv-del"' : '');
const half = (l, side) => (l ? `<td class="dv-n${l.k === ' ' ? '' : l.k === '+' ? ' dv-add' : ' dv-del'}">${side === 'a' ? l.a : l.b}</td>${sign(l.k).replace('class="dv-s"', `class="dv-s${l.k === '+' ? ' dv-add' : l.k === '-' ? ' dv-del' : ''}"`)}<td class="dv-c${l.k === '+' ? ' dv-add' : l.k === '-' ? ' dv-del' : ''}">${esc(l.text)}</td>` : '<td class="dv-n dv-none"></td><td class="dv-s dv-none"></td><td class="dv-c dv-none"></td>');

/**
 * @param {object} o
 * @param {string} o.path                 the file
 * @param {{at?:string, from?:[number,number], lines:[string,string][]}[]} o.hunks   each line is [' ' | '+' | '-', text]
 * @param {'split'|'unified'} [o.mode]    what the reader picked; side by side by default. Narrow, it is always unified
 * @param {string} [o.hook]               the data-* name the Segmented reports in (data-diff-mode="unified")
 * @param {boolean} [o.seg]               false: no Segmented of its own (the second and later files of one view share the first's)
 * @param {string} [o.tools]              markup at the head's end (a Close, a Download)
 * @param {object} [o.attrs]
 */
export function diffView({ path, hunks = [], mode = 'split', hook = 'diff-mode', seg: own = true, tools = '', attrs: a = {} }) {
  const all = hunks.map((h) => ({ at: h.at || '', lines: numbered(h) }));
  const added = all.reduce((n, h) => n + h.lines.filter((l) => l.k === '+').length, 0), removed = all.reduce((n, h) => n + h.lines.filter((l) => l.k === '-').length, 0);
  const unified = all.map((h) => `${h.at ? `<tr class="dv-at"><td colspan="4">${esc(h.at)}</td></tr>` : ''}${h.lines.map((l) => `<tr${cls(l.k)}><td class="dv-n">${l.a}</td><td class="dv-n">${l.b}</td>${sign(l.k)}<td class="dv-c">${esc(l.text)}</td></tr>`).join('')}`).join('');
  const split = all.map((h) => `${h.at ? `<tr class="dv-at"><td colspan="6">${esc(h.at)}</td></tr>` : ''}${paired(h.lines).map(([l, r]) => `<tr>${half(l, 'a')}${half(r, 'b')}</tr>`).join('')}`).join('');
  const seg = segmented({ label: 'How the diff is laid out', hook, items: [{ id: 'split', label: 'Side by side', pressed: mode !== 'unified' }, { id: 'unified', label: 'Unified', pressed: mode === 'unified' }] });
  return `<section class="diff-view"${attrs({ 'data-mode': mode === 'unified' ? 'unified' : 'split', 'aria-label': `Changes in ${path}`, ...a })}><div class="dv-wrap"><header class="dv-head"><code class="dv-path"${attrs({ title: path })}>${esc(path)}</code><span class="ct"><span class="add">+${added}</span><span class="del">−${removed}</span></span>${own ? `<span class="dv-seg">${seg}</span>` : ''}${tools}</header>`
    + `<div class="dv-scroll" tabindex="0"${attrs({ 'aria-label': `${path}: ${added} added, ${removed} removed` })}><table class="dv-t dv-unified"><caption class="sr-only">Unified: old line number, new line number, change, code</caption><tbody>${unified}</tbody></table>`
    + `<table class="dv-t dv-split"><caption class="sr-only">Side by side: the old file on the left, the new file on the right</caption><colgroup><col class="dv-cn"><col class="dv-cs"><col><col class="dv-cn"><col class="dv-cs"><col></colgroup><tbody>${split}</tbody></table></div></div></section>`;
}
diffView.parsePatch = parsePatch;
