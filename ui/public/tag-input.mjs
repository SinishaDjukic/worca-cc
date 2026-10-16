// ui/public/tag-input.mjs — the run-tag chip field (#718): chips with ×, a text input, native
// <datalist> suggestions (keys, then values already in use). Pure DOM; `doc` is injected for jsdom.
import { parseTag, formatTag, normaliseTags, MAX_TAGS } from '../../src/shared/run-tags.mjs';

/** The autocomplete vocabulary (GET /api/tags), shared by the New run form, run page and Ask card. */
export const fetchTagVocabulary = () => fetch('/api/tags').then((r) => (r.ok ? r.json() : { keys: [], values: {} }));

/** A read-only chip. */
export function tagChip(doc, tag) {
  const s = doc.createElement('span');
  s.className = 'tag-chip';
  s.textContent = tag;
  return s;
}

/** Suggestions for the typed text: `cli` → ['client:'], `client:a` → ['client:acme']. */
export function suggestionsFor(text, vocab, limit = 8) {
  const t = String(text || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trimStart();
  const i = t.indexOf(':');
  if (i < 0) {
    const pre = t.trim();
    return (vocab?.keys || []).filter((k) => k.key.startsWith(pre))
      .flatMap((k) => [...(k.valued ? [`${k.key}:`] : []), ...(k.plain ? [k.key] : [])]).slice(0, limit);
  }
  const key = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim();
  return ((vocab?.values || {})[key] || []).map((x) => x.value).filter((x) => x.startsWith(v))
    .slice(0, limit).map((x) => `${key}:${x}`);
}

let seq = 0;
/**
 * @param {Document} doc
 * @param {{ value?: string[], suggest?: () => Promise<object>, placeholder?: string }} [o]
 * @returns {{ el: HTMLElement, get: () => string[], set: (tags: string[], o?: { dirty?: boolean }) => void, onChange: (fn: Function) => void, dirty: () => boolean }}
 */
export function createTagInput(doc, { value = [], suggest = null, placeholder = 'client:acme, team:web…' } = {}) {
  const el = doc.createElement('div'); el.className = 'tag-input';
  const chips = doc.createElement('span'); chips.className = 'tag-input-chips';
  const input = doc.createElement('input'); input.className = 'input tag-input-text'; input.placeholder = placeholder;
  input.setAttribute('aria-label', 'Tags'); input.spellcheck = false;
  const list = doc.createElement('datalist'); list.id = `tag-input-list-${++seq}`; input.setAttribute('list', list.id);
  const hint = doc.createElement('span'); hint.className = 'hint tag-input-hint'; hint.setAttribute('aria-live', 'polite');
  el.append(chips, input, list, hint);
  let tags = normaliseTags(value).tags; let vocab = null; let edited = false; const subs = [];
  const emit = () => subs.forEach((fn) => fn(tags.slice()));
  const paint = () => {
    chips.replaceChildren(...tags.map((t) => {
      const c = tagChip(doc, t);
      const x = doc.createElement('button'); x.type = 'button'; x.className = 'tag-x'; x.textContent = '×';
      x.setAttribute('aria-label', `Remove ${t}`);
      x.addEventListener('click', () => { tags = tags.filter((y) => y !== t); edited = true; paint(); emit(); });
      c.appendChild(x); return c;
    }));
  };
  const refreshList = () => list.replaceChildren(...suggestionsFor(input.value, vocab).map((s) => {
    const o = doc.createElement('option'); o.value = s; return o;
  }));
  const commit = () => {
    const raw = input.value.trim();
    if (!raw) return false;
    const r = parseTag(raw);
    if (r.error) { input.setAttribute('aria-invalid', 'true'); hint.textContent = r.error; return true; }
    const next = normaliseTags([...tags, formatTag(r.tag)]);
    if (next.errors.length) { hint.textContent = `At most ${MAX_TAGS} tags per run`; return true; }
    tags = next.tags; edited = true; input.value = ''; input.removeAttribute('aria-invalid'); hint.textContent = '';
    paint(); emit(); return true;
  };
  input.addEventListener('keydown', (e) => {
    // Enter always stays in the field (it must not submit the form); Tab commits only valid text,
    // so an invalid entry never traps keyboard focus.
    if (e.key === 'Enter') { if (input.value.trim()) commit(); e.preventDefault(); }
    else if (e.key === 'Tab' && input.value.trim() && !parseTag(input.value.trim()).error) { commit(); e.preventDefault(); }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags = tags.slice(0, -1); edited = true; paint(); emit(); }
  });
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); hint.textContent = ''; refreshList(); });
  input.addEventListener('focus', async () => {
    if (!vocab && suggest) { try { vocab = await suggest(); } catch { vocab = { keys: [], values: {} }; } refreshList(); }
  });
  paint();
  return {
    el,
    get: () => tags.slice(),
    // A programmatic fill. `dirty: true` (an Ask card prefill) protects it from the project defaults
    // that loadRunDefaults applies after the prefill switches the project. `clearText: true` (the reset
    // after a start) also drops any uncommitted text and its error.
    set: (next, { dirty = false, clearText = false } = {}) => {
      tags = normaliseTags(next).tags; edited = dirty; paint();
      if (clearText) { input.value = ''; input.removeAttribute('aria-invalid'); hint.textContent = ''; }
    },
    onChange: (fn) => subs.push(fn),
    dirty: () => edited,
  };
}
