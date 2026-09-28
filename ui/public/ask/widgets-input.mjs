// ui/public/ask/widgets-input.mjs
// The INPUT half of the ask widget catalog v1 (ask-forms design §6.1). Every
// entry is `(item, ctx) => Element`; `ctx` is the object form-renderer.mjs builds.
// Agent strings reach the DOM through textContent only. No fetch, no listener
// outside the returned tree, no colour literal.
import { h, icon, ICON_CHECK, ICON_UP, ICON_DOWN, fmtBytes, extOf, toneOf, own } from './dom.mjs';
import { resolvePath } from '../../../src/shared/forms/paths.mjs';

/** '', null and undefined are "no value". `false` and `0` are values. */
export const EMPTY = (v) => v === undefined || v === null || v === '';

/**
 * Label + optional agent `help` + control + the role=alert error slot.
 * `group: true` draws the label as a <div id="<id>-l"> instead of a <label for>,
 * for a choice set whose control is a role=group of buttons.
 */
export function fieldShell(item, ctx, control, { group = false, noLabel = false } = {}) {
  const { doc } = ctx;
  const s = ctx.schemaOf(item.field);
  const id = ctx.idFor(item.field);
  const wrap = h(doc, 'div', 'af-fld');
  wrap.dataset.field = item.field;
  if (!noLabel) {
    const label = h(doc, group ? 'div' : 'label', 'af-label', item.label || s.title || item.field);
    label.id = `${id}-l`;
    if (!group) label.setAttribute('for', id);
    if (ctx.isRequired(item.field)) {
      const star = h(doc, 'span', 'af-req', '*');
      star.setAttribute('aria-hidden', 'true');
      label.appendChild(star);
    }
    wrap.appendChild(label);
  }
  // `help` is AGENT content (the one prose the house rule allows here).
  const help = item.help || s.description;
  if (help) wrap.appendChild(h(doc, 'p', 'af-help', help));
  for (const node of Array.isArray(control) ? control : [control]) if (node) wrap.appendChild(node);
  wrap.appendChild(ctx.errSlot(item.field));
  return wrap;
}

/** Mark a control as required/disabled the same way everywhere. */
export function prepControl(node, item, ctx) {
  node.id = ctx.idFor(item.field);
  if (ctx.isRequired(item.field)) node.setAttribute('aria-required', 'true');
  if (ctx.readonly) node.disabled = true;
  return node;
}

/** The white tick a picked choice carries. Built fresh per call (one node, one place). */
function checkMark(ctx) {
  const m = h(ctx.doc, 'span', 'af-mark');
  const svg = icon(ctx.doc, ICON_CHECK, 12);
  svg.setAttribute('stroke-width', '3.4');
  m.appendChild(svg);
  return m;
}

/**
 * The option list for a choice widget:
 *  - `item.options = { from, value, label, description }` reads rows out of the
 *    ask DATA through the shared path language;
 *  - otherwise the schema's own `enum` (or `items.enum` for an array), relabelled
 *    by `item.labels` / `item.descriptions`.
 */
export function optionsFor(item, s, ctx) {
  if (item.options && item.options.from) {
    const rows = resolvePath(item.options.from, { data: ctx.data });
    const o = item.options;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      value: own(r, o.value || 'id'),
      label: String(own(r, o.label || 'label') ?? own(r, o.value || 'id') ?? ''),
      desc: o.description ? String(own(r, o.description) ?? '') : '',
    }));
  }
  const en = (s && s.enum) || (s && s.items && s.items.enum) || [];
  return en.map((v) => ({
    value: v,
    label: String(own(item.labels, v) ?? v),
    desc: String(own(item.descriptions, v) ?? ''),
  }));
}

/** One choice button: tick + label (+ description). `role` is 'button' or 'checkbox'. */
export function choiceButton(ctx, opt, { id, role = null, on = false }) {
  const b = h(ctx.doc, 'button', 'af-choice');
  b.type = 'button';
  b.id = id;
  if (role) { b.setAttribute('role', role); b.setAttribute('aria-checked', String(on)); }
  else b.setAttribute('aria-pressed', String(on));
  if (on) b.classList.add('on');
  b.disabled = ctx.readonly;
  const txt = h(ctx.doc, 'span', 'af-choice-txt', opt.label);
  if (opt.desc) txt.appendChild(h(ctx.doc, 'span', 'af-choice-desc', opt.desc));
  b.append(checkMark(ctx), txt);
  return b;
}

/** The house `.seg` control, driven by aria-pressed + the `.on` class it styles on. */
export function segmented(ctx, opts, current, onPick, { tones = null, small = false, idBase = '', labelledBy = '' } = {}) {
  const box = h(ctx.doc, 'div', small ? 'seg af-seg-sm' : 'seg');
  box.setAttribute('role', 'group');
  if (labelledBy) box.setAttribute('aria-labelledby', labelledBy);
  opts.forEach((o, i) => {
    const b = h(ctx.doc, 'button', o.value === current ? 'on' : '', o.label);
    b.type = 'button';
    b.id = `${idBase}-${i}`;
    b.setAttribute('aria-pressed', String(o.value === current));
    const tone = toneOf(tones && tones[o.value]);
    if (tone) b.dataset.tone = tone;
    b.disabled = ctx.readonly;
    b.addEventListener('click', () => {
      for (const sib of box.children) { sib.setAttribute('aria-pressed', 'false'); sib.classList.remove('on'); }
      b.setAttribute('aria-pressed', 'true'); b.classList.add('on');
      onPick(o.value);
    });
    box.appendChild(b);
  });
  return box;
}

function textWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const input = ctx.doc.createElement('input');
  input.type = 'text';
  input.className = item.mono ? 'af-inp mono' : 'af-inp';
  if (item.placeholder) input.placeholder = String(item.placeholder);
  if (s.maxLength != null) input.maxLength = Number(s.maxLength);
  input.value = ctx.get(item.field) == null ? '' : String(ctx.get(item.field));
  prepControl(input, item, ctx);
  input.addEventListener('input', () => ctx.set(item.field, input.value));
  return fieldShell(item, ctx, input);
}

function textareaWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const ta = ctx.doc.createElement('textarea');
  ta.className = 'af-inp af-area';
  ta.rows = Number(item.rows) > 0 ? Number(item.rows) : 3;
  if (item.placeholder) ta.placeholder = String(item.placeholder);
  if (s.maxLength != null) ta.maxLength = Number(s.maxLength);
  ta.value = ctx.get(item.field) == null ? '' : String(ctx.get(item.field));
  prepControl(ta, item, ctx);
  ta.addEventListener('input', () => ctx.set(item.field, ta.value));
  return fieldShell(item, ctx, ta);
}

function numberWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const inp = ctx.doc.createElement('input');
  inp.type = 'number';
  inp.className = 'af-inp mono';
  if (s.minimum != null) inp.setAttribute('min', String(s.minimum));
  if (s.maximum != null) inp.setAttribute('max', String(s.maximum));
  inp.setAttribute('step', String(s.multipleOf != null ? s.multipleOf : (s.type === 'integer' ? 1 : 'any')));
  if (item.placeholder) inp.placeholder = String(item.placeholder);
  const cur = ctx.get(item.field);
  inp.value = cur == null ? '' : String(cur);
  prepControl(inp, item, ctx);
  inp.addEventListener('input', () => {
    const n = Number(inp.value);
    ctx.set(item.field, inp.value === '' || !Number.isFinite(n) ? '' : n);
  });
  const row = h(ctx.doc, 'div', 'af-num-row');
  row.appendChild(inp);
  if (item.unit) row.appendChild(h(ctx.doc, 'span', 'af-unit', item.unit));
  return fieldShell(item, ctx, row);
}

function sliderWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const unit = item.unit ? String(item.unit) : '';
  const min = s.minimum != null ? Number(s.minimum) : 0;
  const max = s.maximum != null ? Number(s.maximum) : 100;
  const cur = ctx.get(item.field);
  const val = cur == null ? min : Number(cur);
  // Same rule as the toggle: a required slider with no value posts the position it
  // shows (its minimum - what P1's auto mode answers); an optional one stays unanswered.
  if (!ctx.readonly && cur == null && ctx.isRequired(item.field)) ctx.values[item.field] = val;
  const out = h(ctx.doc, 'output', 'af-slider-val', `${val}${unit}`);
  const r = ctx.doc.createElement('input');
  r.type = 'range';
  r.setAttribute('min', String(min));
  r.setAttribute('max', String(max));
  r.setAttribute('step', String(s.multipleOf != null ? s.multipleOf : 1));
  r.value = String(val);
  prepControl(r, item, ctx);
  r.addEventListener('input', () => { out.textContent = `${r.value}${unit}`; ctx.set(item.field, Number(r.value)); });
  const row = h(ctx.doc, 'div', 'af-slider-row');
  row.append(r, out);
  const ends = h(ctx.doc, 'div', 'af-slider-ends');
  ends.append(h(ctx.doc, 'span', '', item.minLabel != null ? item.minLabel : `${min}${unit}`),
    h(ctx.doc, 'span', '', item.maxLabel != null ? item.maxLabel : `${max}${unit}`));
  return fieldShell(item, ctx, [row, ends]);
}

function toggleWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  // The switch's visible state IS its answer, exactly as P1's auto mode reads it
  // (answer.mjs `candidate`: a required boolean with no default is `false`): a
  // required toggle with no value starts as the "off" it shows, so an untouched
  // switch is never a `required` error on a control that plainly reads off. An
  // optional one stays unanswered until moved - auto mode omits it too.
  if (!ctx.readonly && ctx.get(item.field) == null && ctx.isRequired(item.field)) ctx.values[item.field] = false;
  const box = ctx.doc.createElement('input');
  box.type = 'checkbox';
  box.className = 'sw-input';                       // the existing switch skin
  box.checked = ctx.get(item.field) === true;
  prepControl(box, item, ctx);
  box.addEventListener('change', () => { ctx.values[item.field] = box.checked; ctx.set(item.field, box.checked); });
  const row = h(ctx.doc, 'label', 'af-switch-row');
  row.setAttribute('for', box.id);
  row.append(box, h(ctx.doc, 'span', 'switch'),
    h(ctx.doc, 'span', 'af-switch-txt', item.label || s.title || item.field));
  return fieldShell(item, ctx, row, { noLabel: true });
}

function dateWidget(item, ctx) {
  const inp = ctx.doc.createElement('input');
  inp.type = 'date';
  inp.className = 'af-inp af-date mono';
  const cur = ctx.get(item.field);
  inp.value = cur == null ? '' : String(cur);
  prepControl(inp, item, ctx);
  inp.addEventListener('input', () => ctx.set(item.field, inp.value));
  return fieldShell(item, ctx, inp);
}

function selectWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const id = ctx.idFor(item.field);

  // X5 / P1 C14 — today's clarify question, expressed as a form: suggestions + free
  // text. `suggest` is a LAYOUT key (`item.suggest`), never a schema keyword; the
  // field's schema is a plain { type: 'string' }, so no enum check ever runs.
  if (Array.isArray(item.suggest) && item.suggest.length) {
    const suggest = item.suggest;
    const list = h(ctx.doc, 'div', 'af-choices');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-labelledby', `${id}-l`);
    const free = ctx.doc.createElement('input');
    free.type = 'text';
    free.className = 'af-inp af-free';
    free.id = `${id}-free`;
    free.setAttribute('aria-labelledby', `${id}-l`);
    free.disabled = ctx.readonly;
    const release = () => { for (const b of list.children) { b.setAttribute('aria-pressed', 'false'); b.classList.remove('on'); } };
    suggest.forEach((v, i) => {
      const opt = { value: v, label: String(v), desc: '' };
      const b = choiceButton(ctx, opt, { id: `${id}-${i}`, on: ctx.get(item.field) === v });
      b.addEventListener('click', () => { release(); b.setAttribute('aria-pressed', 'true'); b.classList.add('on'); free.value = ''; ctx.set(item.field, v); });
      list.appendChild(b);
    });
    const cur = ctx.get(item.field);
    free.value = cur != null && !suggest.includes(cur) ? String(cur) : '';
    free.addEventListener('input', () => { release(); ctx.set(item.field, free.value); });
    return fieldShell(item, ctx, [list, free], { group: true });
  }

  const opts = optionsFor(item, s, ctx);
  const style = item.style || (opts.length <= 6 ? 'cards' : 'dropdown');

  if (style === 'segmented') {
    return fieldShell(item, ctx,
      segmented(ctx, opts, ctx.get(item.field), (v) => ctx.set(item.field, v),
        { tones: item.tones, idBase: id, labelledBy: `${id}-l` }),
      { group: true });
  }
  if (style === 'dropdown') {
    const sel = ctx.doc.createElement('select');
    sel.className = 'af-select';
    const blank = ctx.doc.createElement('option');
    blank.value = ''; blank.textContent = '';
    sel.appendChild(blank);
    for (const o of opts) {
      const op = ctx.doc.createElement('option');
      op.value = String(o.value); op.textContent = o.label;
      if (o.value === ctx.get(item.field)) op.selected = true;
      sel.appendChild(op);
    }
    prepControl(sel, item, ctx);
    // The TYPED option value (a numeric enum stays numeric), never the string the
    // <select> reports; index 0 is the blank option.
    sel.addEventListener('change', () => { const o = opts[sel.selectedIndex - 1]; ctx.set(item.field, o ? o.value : ''); });
    const wrap = h(ctx.doc, 'span', 'select-wrap');   // the house chevron
    wrap.appendChild(sel);
    return fieldShell(item, ctx, wrap);
  }

  const box = h(ctx.doc, 'div', 'af-choices');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', `${id}-l`);
  opts.forEach((o, i) => {
    const b = choiceButton(ctx, o, { id: `${id}-${i}`, on: o.value === ctx.get(item.field) });
    b.addEventListener('click', () => {
      for (const sib of box.children) { sib.setAttribute('aria-pressed', 'false'); sib.classList.remove('on'); }
      b.setAttribute('aria-pressed', 'true'); b.classList.add('on');
      ctx.set(item.field, o.value);
    });
    box.appendChild(b);
  });
  return fieldShell(item, ctx, box, { group: true });
}

function multiselectWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const id = ctx.idFor(item.field);
  const opts = optionsFor(item, s, ctx);
  const box = h(ctx.doc, 'div', item.style === 'chips' ? 'af-choices af-chips' : 'af-choices');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-labelledby', `${id}-l`);
  const picked = () => (Array.isArray(ctx.get(item.field)) ? ctx.get(item.field).slice() : []);
  opts.forEach((o, i) => {
    const b = choiceButton(ctx, o, { id: `${id}-${i}`, role: 'checkbox', on: picked().includes(o.value) });
    b.addEventListener('click', () => {
      const cur = picked();
      const at = cur.indexOf(o.value);
      if (at >= 0) cur.splice(at, 1); else cur.push(o.value);
      b.setAttribute('aria-checked', String(at < 0));
      b.classList.toggle('on', at < 0);
      ctx.values[item.field] = cur;
      ctx.set(item.field, cur);
    });
    box.appendChild(b);
  });
  return fieldShell(item, ctx, box, { group: true });
}

/** Rows a data-driven widget draws, through the shared path language. */
function rowsOf(item, ctx) {
  const rows = resolvePath(item.bind, { data: ctx.data });
  return Array.isArray(rows) ? rows.filter((r) => own(r, 'id') != null) : [];
}

/** The usable column descriptors of a `table` / `table-select` item: objects only
 *  (gate 1 admits `columns: [null]` shapes the cell painter must not trip on). */
export function colsOf(item) {
  return (Array.isArray(item.columns) ? item.columns : []).filter((c) => c && typeof c === 'object' && !Array.isArray(c));
}

/**
 * One table cell. `format: 'delta'` signs the number and tones it; `format: 'pill'`
 * draws a `.af-pill` carrying `data-tone` when the column's `tones` names one of the
 * closed families (dom.mjs TONES). Shared with the `table` display widget.
 */
export function cellFor(ctx, col, row) {
  const v = own(row, col.key);
  const td = ctx.doc.createElement('td');
  if (col.align === 'right') td.classList.add('af-r');
  if (col.mono) td.classList.add('mono');
  if (col.format === 'delta') {
    const n = Number(v) || 0;
    td.classList.add(n > 0 ? 'af-up' : n < 0 ? 'af-down' : 'af-flat');
    td.textContent = `${n > 0 ? '+' : ''}${n}${col.unit || ''}`;
  } else if (col.format === 'pill') {
    const pill = h(ctx.doc, 'span', 'af-pill', String(v ?? ''));
    const tone = toneOf(col.tones && col.tones[v]);
    if (tone) pill.dataset.tone = tone;
    td.appendChild(pill);
  } else {
    td.textContent = v == null ? '—' : `${v}${col.unit || ''}`;
  }
  return td;
}

function rankWidget(item, ctx) {
  const rows = rowsOf(item, ctx);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const id = ctx.idFor(item.field);
  const titleKey = item.titleKey || 'title';
  const metaKey = item.metaKey || 'meta';
  const seeded = Array.isArray(ctx.get(item.field)) && ctx.get(item.field).length
    ? ctx.get(item.field).slice()
    : rows.map((r) => String(r.id));
  const order = seeded.filter((rid) => byId.has(String(rid))).map(String);
  ctx.values[item.field] = order.slice();          // D10: the data order IS the answer
  const ol = h(ctx.doc, 'ol', 'af-rank');
  ol.setAttribute('aria-labelledby', `${id}-l`);
  let dragId = null;

  const move = (from, to) => {
    if (ctx.readonly || to < 0 || to >= order.length || from === to) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    paint();
    ctx.set(item.field, order.slice());
    const focus = ol.children[to] && ol.children[to].querySelector(to > from ? '.af-rank-dn' : '.af-rank-up');
    if (focus && !focus.disabled) focus.focus();
  };

  function paint() {
    ol.textContent = '';
    order.forEach((rid, i) => {
      const r = byId.get(rid) || {};
      const name = String(own(r, titleKey) ?? rid);
      const meta = own(r, metaKey);
      const li = ctx.doc.createElement('li');
      if (!ctx.readonly) { li.draggable = true; li.dataset.afDrag = 'rank'; }
      li.appendChild(h(ctx.doc, 'span', 'af-rank-n', String(i + 1)));
      const txt = h(ctx.doc, 'span', 'af-rank-txt');
      txt.appendChild(h(ctx.doc, 'b', '', name));
      if (meta != null && meta !== '') txt.appendChild(h(ctx.doc, 'span', '', String(meta)));
      li.appendChild(txt);
      const btns = h(ctx.doc, 'span', 'af-rank-btns');
      const mk = (cls, glyph, label, to, off) => {
        const b = h(ctx.doc, 'button', `af-icon-btn ${cls}`);
        b.type = 'button';
        b.id = `${id}-${cls}-${rid}`;
        b.setAttribute('aria-label', label);
        b.disabled = ctx.readonly || off;
        b.appendChild(icon(ctx.doc, glyph, 14));
        b.addEventListener('click', () => move(i, to));
        return b;
      };
      btns.append(
        mk('af-rank-up', ICON_UP, `Move ${name} up`, i - 1, i === 0),
        mk('af-rank-dn', ICON_DOWN, `Move ${name} down`, i + 1, i === order.length - 1),
      );
      li.appendChild(btns);
      li.addEventListener('dragstart', (e) => {
        dragId = rid; li.classList.add('af-drag');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rid); }
      });
      li.addEventListener('dragend', () => li.classList.remove('af-drag'));
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('af-over'); });
      li.addEventListener('dragleave', () => li.classList.remove('af-over'));
      li.addEventListener('drop', (e) => {
        e.preventDefault(); li.classList.remove('af-over');
        const from = order.indexOf(dragId);
        if (from >= 0) move(from, i);
      });
      ol.appendChild(li);
    });
  }
  paint();
  return fieldShell(item, ctx, ol, { group: true });
}

function tableSelectWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const multi = s.type === 'array';
  const id = ctx.idFor(item.field);
  const rows = rowsOf(item, ctx);
  const cols = colsOf(item);
  const tbody = ctx.doc.createElement('tbody');
  const boxes = [];

  const sync = () => {
    const picked = [];
    rows.forEach((r, i) => {
      const on = boxes[i].checked;
      tbody.children[i].setAttribute('aria-selected', String(on));
      if (on) picked.push(String(r.id));
    });
    ctx.values[item.field] = multi ? picked : picked[0];
    ctx.set(item.field, multi ? picked : (picked[0] == null ? '' : picked[0]));
  };

  rows.forEach((r, i) => {
    const box = ctx.doc.createElement('input');
    box.type = multi ? 'checkbox' : 'radio';
    box.name = id;
    box.id = `${id}-${r.id}`;
    box.disabled = ctx.readonly;
    const cur = ctx.get(item.field);
    box.checked = multi ? (Array.isArray(cur) && cur.includes(String(r.id))) : cur === String(r.id);
    box.setAttribute('aria-label', String(own(r, (cols[0] || {}).key) ?? r.id));
    box.addEventListener('change', sync);
    boxes.push(box);
    const tr = h(ctx.doc, 'tr', 'af-pick');
    tr.setAttribute('aria-selected', String(box.checked));
    tr.addEventListener('click', (e) => {
      if (ctx.readonly || e.target === box) return;
      box.checked = multi ? !box.checked : true;
      if (!multi) for (const other of boxes) if (other !== box) other.checked = false;
      sync();
    });
    const pick = ctx.doc.createElement('td');
    pick.appendChild(box);
    tr.appendChild(pick);
    for (const c of cols) tr.appendChild(cellFor(ctx, c, r));
    tbody.appendChild(tr);
  });

  const table = h(ctx.doc, 'table', 'af-tbl');
  const thead = ctx.doc.createElement('thead');
  const hr = ctx.doc.createElement('tr');
  hr.appendChild(ctx.doc.createElement('th'));
  for (const c of cols) {
    const th = h(ctx.doc, 'th', c.align === 'right' ? 'af-r' : '', c.label || c.key);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.append(thead, tbody);
  const wrap = h(ctx.doc, 'div', 'af-tbl-wrap');
  wrap.appendChild(table);
  return fieldShell(item, ctx, wrap, { group: true });
}

function reviewListWidget(item, ctx) {
  const s = ctx.schemaOf(item.field);
  const vs = ((s.items || {}).properties || {}).verdict || {};
  const en = Array.isArray(vs.enum) ? vs.enum : [];
  const dflt = vs.default !== undefined ? vs.default : en[0];
  const id = ctx.idFor(item.field);
  const rows = rowsOf(item, ctx);
  const stored = new Map((Array.isArray(ctx.get(item.field)) ? ctx.get(item.field) : [])
    .map((e) => [String(e && e.id), e]));
  const state = rows.map((r) => {
    const prev = stored.get(String(r.id));
    const entry = { id: String(r.id), verdict: prev && prev.verdict != null ? prev.verdict : dflt };
    if (prev && prev.note) entry.note = prev.note;
    return entry;
  });
  ctx.values[item.field] = state.map((e) => ({ ...e }));
  const opts = en.map((v) => ({ value: v, label: String(own(item.labels, v) ?? v), desc: '' }));
  const box = h(ctx.doc, 'div', 'af-rv');

  rows.forEach((r, i) => {
    const note = ctx.doc.createElement('input');
    note.type = 'text';
    note.className = 'af-inp af-rv-note';
    note.id = `${id}-note-${r.id}`;
    note.setAttribute('aria-label', `Note for ${own(r, item.titleKey || 'title') ?? r.id}`);
    note.placeholder = item.notePlaceholder ? String(item.notePlaceholder) : '';
    note.value = state[i].note || '';
    note.hidden = state[i].verdict === dflt;
    note.disabled = ctx.readonly;
    note.addEventListener('input', () => {
      if (note.value) state[i].note = note.value; else delete state[i].note;
      ctx.set(item.field, state.map((e) => ({ ...e })));
    });
    const card = h(ctx.doc, 'div', 'af-rv-item');
    const tone0 = toneOf(item.tones && item.tones[state[i].verdict]);
    if (tone0) card.dataset.tone = tone0;
    const main = h(ctx.doc, 'div', 'af-rv-main');
    const body = own(r, item.bodyKey || 'body');
    const meta = own(r, item.metaKey || 'meta');
    main.appendChild(h(ctx.doc, 'div', 'af-rv-title', String(own(r, item.titleKey || 'title') ?? r.id)));
    if (body != null && body !== '') main.appendChild(h(ctx.doc, 'div', 'af-rv-body', String(body)));
    if (meta != null && meta !== '') main.appendChild(h(ctx.doc, 'div', 'af-rv-meta', String(meta)));
    const seg = segmented(ctx, opts, state[i].verdict, (v) => {
      state[i].verdict = v;
      note.hidden = v === dflt;
      if (v === dflt) { delete state[i].note; note.value = ''; }
      const tone = toneOf(item.tones && item.tones[v]);
      if (tone) card.dataset.tone = tone; else delete card.dataset.tone;
      ctx.set(item.field, state.map((e) => ({ ...e })));
    }, { tones: item.tones, small: true, idBase: `${id}-${r.id}` });
    const top = h(ctx.doc, 'div', 'af-rv-top');
    top.append(main, seg);
    card.append(top, note);
    box.appendChild(card);
  });
  return fieldShell(item, ctx, box, { group: true });
}

function galleryPicker(item, ctx) {
  const rows = rowsOf(item, ctx);
  const id = ctx.idFor(item.field || 'gallery');
  const capKey = item.captionKey || 'caption';
  const fileKey = item.fileKey || 'file';
  const pick = Boolean(item.field);
  const grid = h(ctx.doc, 'div', 'af-gal');

  for (const r of rows) {
    // X16: a ROW widget knows its file column from its own declared `fileKey`, so it
    // needs no fileRefs lookup — the scalar widgets are the ones that had to guess.
    const rel = own(r, fileKey);
    const entry = ctx.fileFor(rel);
    const url = entry ? ctx.fileUrl(entry.index) : null;      // X14: either may be absent
    const caption = String(own(r, capKey) ?? r.id);
    const kids = [];
    if (url) {
      const img = ctx.doc.createElement('img');        // SVG included: <img> only
      img.setAttribute('src', url);
      img.setAttribute('alt', caption);
      img.setAttribute('loading', 'lazy');
      kids.push(img);
    } else {
      // No snapshot for this row: the pinned neutral tile, never a broken <img>.
      const tile = h(ctx.doc, 'span', 'af-nofile af-gal-nofile');
      tile.append(h(ctx.doc, 'span', 'af-file-badge', extOf(rel)),
        h(ctx.doc, 'span', 'af-file-name', String(rel ?? '')));
      kids.push(tile);
    }
    kids.push(h(ctx.doc, 'span', 'af-gal-cap', caption));
    if (entry) kids.push(h(ctx.doc, 'span', 'af-gal-sub', `${entry.name} · ${fmtBytes(entry.bytes)}`));
    let card;
    if (pick) {
      card = h(ctx.doc, 'button', 'af-gal-card');
      card.type = 'button';
      card.id = `${id}-${r.id}`;
      card.disabled = ctx.readonly;
      card.setAttribute('aria-pressed', String(ctx.get(item.field) === String(r.id)));
      card.addEventListener('click', () => {
        for (const sib of grid.children) sib.setAttribute('aria-pressed', 'false');
        card.setAttribute('aria-pressed', 'true');
        ctx.set(item.field, String(r.id));
      });
    } else {
      card = h(ctx.doc, 'div', 'af-gal-card');
    }
    for (const k of kids) card.appendChild(k);
    grid.appendChild(card);
  }
  return pick ? fieldShell(item, ctx, grid, { group: true }) : grid;
}

export { galleryPicker };

export const INPUT_WIDGETS_TABLE = Object.freeze({
  text: textWidget,
  textarea: textareaWidget,
  number: numberWidget,
  slider: sliderWidget,
  toggle: toggleWidget,
  date: dateWidget,
  select: selectWidget,
  multiselect: multiselectWidget,
  rank: rankWidget,
  'table-select': tableSelectWidget,
  'review-list': reviewListWidget,
  gallery: galleryPicker,
});
