// ui/public/tag-input.mjs — the run-tag chip field (#718): chips with ×, a text input, native
// <datalist> suggestions (keys, then values already in use). Pure DOM; `doc` is injected for jsdom.
import { parseTag, formatTag, normaliseTags, MAX_TAGS } from '../../src/shared/run-tags.mjs';
import { missingRequired, keyFromLabel, tagProblems, tagsProblemText } from '../../src/shared/tag-dimensions.mjs';

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

/** A value control for one dimension (D15): a select of its values (blank first), else a text input. */
export function valueControl(doc, d, { blank = '', cls = 'tag-dim-input' } = {}) {
  if (d.values?.length) {
    const s = doc.createElement('select'); s.className = `input ${cls}`;
    for (const v of ['', ...d.values]) { const o = doc.createElement('option'); o.value = v; o.textContent = v || blank; s.append(o); }
    s.setAttribute('aria-label', d.label);
    return s;
  }
  const i = doc.createElement('input'); i.className = `input ${cls}`; i.spellcheck = false; i.setAttribute('aria-label', d.label);
  return i;
}

/**
 * One slot per configured tag dimension (New run): label, then a select of the allowed values or a text input.
 * get() → ['cc:4410', …] (filled, valid slots only); set(tags) fills slots from a tag list and clears
 * dirty; missing() → required dimensions left empty; dirty() → the user typed since the last set().
 * The caller decides: it warns, or gates Start when enforced.
 */
export function createDimensionSlots(doc, dims, { value = [] } = {}) {
  const el = doc.createElement('div'); el.className = 'tag-dims'; el.hidden = !dims.length;
  const inputs = new Map();
  const listeners = [];
  let touched = false;
  for (const d of dims) {
    const slot = doc.createElement('label'); slot.className = 'tag-dim-slot'; slot.dataset.key = d.key;
    const name = doc.createElement('span'); name.className = 'tag-dim-label'; name.textContent = d.label;
    slot.append(name);
    if (d.required) { const req = doc.createElement('span'); req.className = 'tag-dim-req'; req.textContent = 'required'; slot.append(req); }
    const input = valueControl(doc, d, { blank: 'Choose…' });
    const hint = doc.createElement('span'); hint.className = 'hint tag-dim-hint'; hint.setAttribute('aria-live', 'polite');
    const onEdit = () => {
      touched = true;
      const text = input.value.trim();
      const r = text ? parseTag(`${d.key}:${text}`) : null;
      if (r?.error) { input.setAttribute('aria-invalid', 'true'); hint.textContent = r.error; } else { input.removeAttribute('aria-invalid'); hint.textContent = ''; }
      listeners.forEach((fn) => fn());
    };
    input.addEventListener('input', onEdit); input.addEventListener('change', onEdit);
    slot.append(input, hint);
    el.append(slot);
    inputs.set(d.key, { input, hint });
  }
  const get = () => [...inputs].flatMap(([key, { input }]) => {
    const text = input.value.trim();
    const r = text ? parseTag(`${key}:${text}`) : null;
    return r && !r.error ? [formatTag(r.tag)] : [];
  });
  // A select given an off-list value stays blank, which reads as missing. set() fires no onChange.
  const set = (tags) => {
    touched = false;
    for (const { input, hint } of inputs.values()) { input.value = ''; input.removeAttribute('aria-invalid'); hint.textContent = ''; }
    for (const t of tags || []) { const r = parseTag(t); if (!r.error && inputs.has(r.tag.key)) inputs.get(r.tag.key).input.value = r.tag.value; }
  };
  set(value);
  return { el, get, set, dirty: () => touched, missing: () => missingRequired(dims, get()), onChange: (fn) => listeners.push(fn) };
}

/** Settings › Tags › Values: chips plus a text box; Enter, comma or blur adds; × removes. */
function createValueChips(doc, values, changed) {
  const el = doc.createElement('div'); el.className = 'tag-value-chips';
  const input = doc.createElement('input'); input.className = 'input tag-value-input'; input.placeholder = 'Any value'; input.setAttribute('aria-label', 'Values');
  // The card's dirty tracker (feedback.mjs trackDirty) snapshots only input/select/textarea values;
  // chips are spans. This hidden input mirrors the list so a values-only edit enables Save.
  const mirror = doc.createElement('input'); mirror.type = 'hidden'; mirror.className = 'tag-value-mirror';
  let list = [...values];
  const paint = () => {
    mirror.value = list.join('\n');
    el.replaceChildren(mirror, ...list.map((v) => {
      const chip = tagChip(doc, v);
      const x = doc.createElement('button'); x.type = 'button'; x.className = 'tag-x'; x.textContent = '×'; x.setAttribute('aria-label', `Remove ${v}`);
      x.addEventListener('click', () => { list = list.filter((y) => y !== v); paint(); changed(); });
      chip.append(x); return chip;
    }), input);
  };
  const commit = () => {
    const vs = input.value.split(',').map((s) => s.trim()).filter(Boolean);
    input.value = '';
    const fresh = vs.filter((v) => !list.includes(v));
    if (fresh.length) { list = [...list, ...fresh]; paint(); changed(); input.focus(); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } });
  input.addEventListener('blur', commit);
  paint();
  return { el, get: () => [...list], setDisabled: (on) => { input.disabled = on; el.querySelectorAll('.tag-x').forEach((b) => { b.disabled = on; }); } };
}

/** Settings › Tags (D16, D17): one table row per tag — Tag (label, key small) · Values · Default · Mandatory · remove. */
export function createDimensionEditor(doc, { value = [] } = {}) {
  const el = doc.createElement('div'); el.className = 'tag-dim-editor';
  const table = doc.createElement('table'); table.className = 'tag-dim-table';
  const head = doc.createElement('thead');
  head.innerHTML = '<tr><th>Tag</th><th>Values</th><th>Default</th><th>Mandatory</th><th></th></tr>';
  const rows = doc.createElement('tbody'); rows.className = 'tag-dim-rows';
  table.append(head, rows);
  const add = doc.createElement('button'); add.type = 'button'; add.className = 'btn btn-ghost btn-mini tag-dim-add'; add.textContent = 'Add a tag';
  const changed = () => el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));   // marks the card dirty
  const td = (...kids) => { const c = doc.createElement('td'); c.append(...kids); return c; };
  const addRow = (d = { key: '', label: '', values: [], required: false }) => {
    const tr = doc.createElement('tr'); tr.className = 'tag-dim-row';
    const label = doc.createElement('input'); label.className = 'input tag-dim-label-input'; label.placeholder = 'Cost centre'; label.value = d.label; label.setAttribute('aria-label', 'Tag');
    const key = doc.createElement('input'); key.className = 'input tag-dim-key tag-dim-key-small'; key.placeholder = 'key'; key.value = d.key; key.setAttribute('aria-label', 'Key');
    let keyTouched = !!d.key;
    key.addEventListener('input', () => { keyTouched = true; });
    label.addEventListener('input', () => { if (!keyTouched) key.value = keyFromLabel(label.value); });
    const defCell = doc.createElement('td');
    let def = null;
    let values = null;
    const paintDefault = (keep) => {
      const list = values ? values.get() : (d.values || []);
      def = valueControl(doc, { label: 'Default', values: list }, { blank: 'None', cls: 'tag-dim-default' });
      def.value = !list.length || list.includes(keep) ? keep : '';
      def.addEventListener('change', changed); def.addEventListener('input', changed);
      defCell.replaceChildren(def);
    };
    values = createValueChips(doc, d.values || [], () => { paintDefault(def?.value || ''); changed(); });
    paintDefault(d.default || '');
    const req = doc.createElement('input'); req.type = 'checkbox'; req.className = 'tag-dim-required'; req.checked = !!d.required; req.setAttribute('aria-label', 'Mandatory');
    const rm = doc.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-ghost btn-mini tag-dim-remove'; rm.textContent = '×'; rm.setAttribute('aria-label', 'Remove tag');
    rm.addEventListener('click', () => { tr.remove(); changed(); });
    const tagCell = doc.createElement('div'); tagCell.className = 'tag-dim-tag'; tagCell.append(label, key);
    tr.append(td(tagCell), td(values.el), defCell, td(req), td(rm));
    tr.__dim = { values, def: () => def };
    rows.append(tr);
  };
  add.addEventListener('click', () => { addRow(); changed(); });
  const set = (list) => { rows.replaceChildren(); for (const d of list || []) addRow(d); };
  const get = () => [...rows.querySelectorAll('.tag-dim-row')].map((tr) => {
    const dflt = tr.__dim.def().value.trim();
    return {
      key: tr.querySelector('.tag-dim-key').value.trim(),
      label: tr.querySelector('.tag-dim-label-input').value.trim(),
      values: tr.__dim.values.get(),
      required: tr.querySelector('.tag-dim-required').checked,
      ...(dflt ? { default: dflt } : {}),
    };
  }).filter((d) => d.key || d.label);
  const setLocked = (on) => {
    for (const i of rows.querySelectorAll('input, select')) i.disabled = on;
    for (const tr of rows.querySelectorAll('.tag-dim-row')) tr.__dim.values.setDisabled(on);
    for (const b of rows.querySelectorAll('.tag-dim-remove')) b.hidden = on;
    add.hidden = on;
  };
  set(value);
  el.append(table, add);
  return { el, get, set, setLocked };
}

/**
 * Ask run card (D15): mounts the target's tag rules on a chip field. update(info) swaps in a target's
 * pre-fill (the card's own value wins a key; chips this line added and the person left alone are
 * replaced on a target change) and, when enforced, shows one inline picker per mandatory tag missing
 * or off its list. blocked() → reason or null.
 */
export function createTagRulesLine(doc, tagInput) {
  const el = doc.createElement('span'); el.className = 'tag-rule-pickers';
  const listeners = [];
  let dims = []; let enforce = false; let added = [];
  const keyOf = (t) => parseTag(t).tag?.key;
  const notify = () => listeners.forEach((fn) => fn());
  const paint = () => {
    el.replaceChildren();
    if (!enforce) return;
    const { missing, outside } = tagProblems(dims, tagInput.get());
    for (const d of [...missing, ...outside.map((o) => o.dim)]) {
      const pick = valueControl(doc, d, { blank: `${d.label}…`, cls: 'tag-rule-pick' });
      const commit = () => {
        const v = pick.value.trim(); if (!v) return;
        const r = parseTag(`${d.key}:${v}`); if (r.error) return;
        tagInput.set(normaliseTags([...tagInput.get(), formatTag(r.tag)]).tags, { dirty: true });
        paint(); notify();
      };
      pick.addEventListener('change', commit);
      if (pick.tagName === 'INPUT') pick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
      el.append(pick);
    }
  };
  const update = (info) => {
    const kept = tagInput.get().filter((t) => !added.includes(t));
    const own = new Set(kept.map(keyOf));
    added = (info?.prefill || []).filter((t) => !own.has(keyOf(t)));
    dims = Array.isArray(info?.dims) ? info.dims : [];
    enforce = info?.enforce === true;
    tagInput.set(normaliseTags([...kept, ...added]).tags);
    paint(); notify();
  };
  tagInput.onChange(() => { paint(); notify(); });
  return { el, update, blocked: () => (enforce ? tagsProblemText(dims, tagInput.get()) : null), onChange: (fn) => listeners.push(fn) };
}
