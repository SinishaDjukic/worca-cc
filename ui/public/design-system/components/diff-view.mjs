// DiffView (docs/stillhet/components.md): one file's changes, read as code. Side by side where it fits (old left, new
// right), unified where it does not (under about 900px of its own width, by a container query: the page does nothing).
// Every line has its number; an added or a removed line is marked by a sign (+ or −) and a word for a screen reader, and
// by a tint under ink text, so it never rests on colour alone and the text keeps its contrast. A Segmented picks
// "Side by side" or "Unified" where both fit.
import { attrs, esc } from './html.mjs';
import { segmented } from './segmented.mjs';
import { button } from './button.mjs';
import { icon } from './icons.mjs';

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
 * @param {boolean} [o.find]             false: no Find field (it comes with the Segmented: one per view, searching every file shown with it)
 * @param {string} [o.tools]              markup at the head's end (a Close, a Download)
 * @param {object} [o.attrs]
 */
export function diffView({ path, hunks = [], mode = 'split', hook = 'diff-mode', seg: own = true, find = true, tools = '', attrs: a = {} }) {
  const all = hunks.map((h) => ({ at: h.at || '', lines: numbered(h) }));
  const added = all.reduce((n, h) => n + h.lines.filter((l) => l.k === '+').length, 0), removed = all.reduce((n, h) => n + h.lines.filter((l) => l.k === '-').length, 0);
  const unified = all.map((h) => `${h.at ? `<tr class="dv-at"><td colspan="4">${esc(h.at)}</td></tr>` : ''}${h.lines.map((l) => `<tr${cls(l.k)}><td class="dv-n">${l.a}</td><td class="dv-n">${l.b}</td>${sign(l.k)}<td class="dv-c">${esc(l.text)}</td></tr>`).join('')}`).join('');
  const split = all.map((h) => `${h.at ? `<tr class="dv-at"><td colspan="6">${esc(h.at)}</td></tr>` : ''}${paired(h.lines).map(([l, r]) => `<tr>${half(l, 'a')}${half(r, 'b')}</tr>`).join('')}`).join('');
  const seg = segmented({ label: 'How the diff is laid out', hook, items: [{ id: 'split', label: 'Side by side', pressed: mode !== 'unified' }, { id: 'unified', label: 'Unified', pressed: mode === 'unified' }] });
  return `<section class="diff-view"${attrs({ 'data-mode': mode === 'unified' ? 'unified' : 'split', 'aria-label': `Changes in ${path}`, ...a })}><div class="dv-wrap"><header class="dv-head"><code class="dv-path"${attrs({ title: path })}>${esc(path)}</code><span class="ct"><span class="add">+${added}</span><span class="del">−${removed}</span></span>${own && find ? diffFind() : ''}${own ? `<span class="dv-seg">${seg}</span>` : ''}${tools}</header>`
    + `<div class="dv-scroll" tabindex="0"${attrs({ 'aria-label': `${path}: ${added} added, ${removed} removed` })}><table class="dv-t dv-unified"><caption class="sr-only">Unified: old line number, new line number, change, code</caption><tbody>${unified}</tbody></table>`
    + `<table class="dv-t dv-split"><caption class="sr-only">Side by side: the old file on the left, the new file on the right</caption><colgroup><col class="dv-cn"><col class="dv-cs"><col><col class="dv-cn"><col class="dv-cs"><col></colgroup><tbody>${split}</tbody></table></div></div></section>`;
}

/** Find in the diff (thing.diff-find): a field in the diff's head, how many lines match and which one you are on, Previous and Next. */
export function diffFind() {
  return `<span class="dv-find" role="search"><input class="input dv-find-in" type="search" placeholder="Find in the diff" aria-label="Find text in the diff" data-dv-find autocomplete="off" spellcheck="false"><span class="dv-find-n" role="status" aria-live="polite"></span>${button({ label: 'Previous match', kind: 'quiet', iconOnly: true, icon: icon('chevron', 14), cls: 'dv-prev', attrs: { 'data-dv-step': '-1', disabled: true } })}${button({ label: 'Next match', kind: 'quiet', iconOnly: true, icon: icon('chevron', 14), attrs: { 'data-dv-step': '1', disabled: true } })}</span>`;
}

/** Where the text is in a line, without regard to case: [[start, end], …]. Empty text finds nothing. */
export function findSpans(line, text) {
  const out = [], hay = String(line).toLowerCase(), needle = String(text).toLowerCase();
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push([i, i + needle.length]);
  return out;
}

const scopes = new WeakSet();
/**
 * Makes every Find field of a diff work: as you type, each match in the code is marked, the count says "3 of 12", Enter
 * and Next go to the next match and Shift+Enter and Previous to the one before (round the end), Escape clears the
 * field. It searches the layout on screen (side by side or unified) in every file of the view (.diff-files), or in its
 * own file. A redraw that keeps the field keeps the search: the marks are drawn again.
 */
export function watchDiffFind(doc) {
  if (scopes.has(doc)) return;
  scopes.add(doc);
  const scopeOf = (el) => el.closest('.diff-files') || el.closest('.diff-view');
  const state = new WeakMap();   // the field → { hits, at }
  const shown = (t) => doc.defaultView.getComputedStyle(t).display !== 'none';   // side by side or unified: only one of a file's two tables is drawn
  const cells = (scope) => [...scope.querySelectorAll('.dv-t')].filter(shown).flatMap((t) => [...t.querySelectorAll('.dv-c')]);
  const clear = (scope) => { for (const m of scope.querySelectorAll('mark.dv-hit')) { const t = doc.createTextNode(m.textContent); m.replaceWith(t); t.parentNode.normalize(); } };
  const say = (input) => {
    const st = state.get(input) || { hits: [], at: -1 }, n = input.parentElement.querySelector('.dv-find-n');
    if (n) n.textContent = !input.value ? '' : st.hits.length ? `${st.at + 1} of ${st.hits.length}` : 'No match';
    for (const b of input.parentElement.querySelectorAll('[data-dv-step]')) b.disabled = st.hits.length < 2;
  };
  const show = (input, move) => {
    const st = state.get(input); if (!st || !st.hits.length) { say(input); return; }
    st.hits[st.at]?.classList.remove('is-now');
    st.at = (st.at + move + st.hits.length) % st.hits.length;
    const hit = st.hits[st.at]; hit.classList.add('is-now'); hit.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    say(input);
  };
  const run = (input) => {
    const scope = scopeOf(input); if (!scope) return;
    clear(scope);
    const hits = [], text = input.value;
    if (text) for (const c of cells(scope)) {
      const line = c.textContent, spans = findSpans(line, text); if (!spans.length) continue;
      const frag = doc.createDocumentFragment(); let from = 0;
      for (const [a, b] of spans) { frag.append(line.slice(from, a)); const m = doc.createElement('mark'); m.className = 'dv-hit'; m.textContent = line.slice(a, b); frag.append(m); hits.push(m); from = b; }
      frag.append(line.slice(from)); c.replaceChildren(frag);
    }
    state.set(input, { hits, at: -1 });
    if (hits.length) show(input, 1); else say(input);
  };
  doc.addEventListener('input', (e) => { if (e.target.matches?.('[data-dv-find]')) run(e.target); });
  doc.addEventListener('keydown', (e) => {
    const input = e.target.matches?.('[data-dv-find]') ? e.target : null; if (!input) return;
    if (e.key === 'Enter') { e.preventDefault(); show(input, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; run(input); }
  }, true);
  doc.addEventListener('click', (e) => {
    const step = e.target.closest?.('[data-dv-step]');
    if (step) { const input = step.parentElement.querySelector('[data-dv-find]'); if (input) show(input, +step.dataset.dvStep); return; }
    // the layout changed (Side by side, Unified): the marks belong to the table that shows now
    if (e.target.closest?.('.dv-seg')) { const view = e.target.closest('.diff-files') || e.target.closest('.diff-view'); const input = view?.querySelector('[data-dv-find]'); if (input?.value) (doc.defaultView?.setTimeout || setTimeout)(() => { const again = (view.isConnected ? view : doc).querySelector('[data-dv-find]'); if (again) { if (!again.value) again.value = input.value; run(again); } }, 0); }
  });
}
diffView.parsePatch = parsePatch;
