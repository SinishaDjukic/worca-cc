// ui/public/mcp-definition-form.mjs
// The manual MCP server definition form (spec §7.2): form state ↔ the §4.1 definition shape, and the
// form itself — Name (read-only in Edit), Type, Command + Arguments or URL + one Bearer token tick,
// Environment / Headers rows (key · value · per set · secret), `{name}` placeholders, the "Each set
// fills in" list and live checks through POST /api/mcp/servers/validate.
import { icon } from './icons.mjs';
import { makeSwitch } from './switch.mjs';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function button(doc, cls, label, data = {}) {
  const b = h(doc, 'button', cls, label);
  b.type = 'button';
  Object.assign(b.dataset, data);
  return b;
}
// One "Add …" button: the shared plus icon, never a typed "+" (docs/design-system.md › Button).
const addBtn = (doc, label, data) => { const b = button(doc, 'btn btn-sm', label, data); b.prepend(icon(doc, 'plus', 14)); return b; };

const PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;
// Mirrors QUERY_SECRET_RE in src/core/mcp-secrets.mjs (test/ui-mcp-definition-form.test.mjs pins the two).
const QUERY_SECRET_RE = /^(api[-_]?key|key|token|access[-_]?token|secret|password|auth|sig|signature)$/i;
const fieldKeyFor = (name) => {
  const k = String(name).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '');
  return (k || 'field').slice(0, 32);
};
/** A URL placeholder that is the value of a secret-named query parameter starts secret. */
export function placeholderStartsSecret(url, key) {
  const m = new RegExp(`[?&]([^=&#]+)=\\{${key}\\}`).exec(url);
  return !!m && QUERY_SECRET_RE.test(m[1]);
}
export const blankDefinitionForm = () => ({ name: '', type: 'stdio', command: '', args: '', url: '', bearer: false, rows: [], placeholders: {}, description: '' });

/** Form state → `{ name, def, errors }` in the §4.1 shape the server validates. */
export function compileDefinition(form) {
  const fields = [];
  const errors = [];
  // Edit: a field the stored definition declares with the same secret flag keeps what the form has no control
  // for — its label, `oauth`, and `required`/`default` unless its default was changed here (`own`).
  const meta = form.meta || {};
  const add = (f, own = (m) => ({ required: m.required, ...(m.default !== undefined ? { default: m.default } : {}) })) => {
    if (fields.some((x) => x.key === f.key)) return;
    const m = Object.hasOwn(meta, f.key) && !!meta[f.key].secret === !!f.secret ? meta[f.key] : null;
    fields.push(m ? { ...f, label: m.label, ...(f.secret && m.oauth ? { oauth: true } : {}), ...own(m) } : f);
  };
  const map = () => {
    const out = {};
    for (const r of form.rows) {
      const key = r.key.trim();
      if (!key) continue;
      if (!r.perSet && !r.secret) { out[key] = r.value; continue; }
      const fk = r.fieldKey || fieldKeyFor(key);
      // Two refs share a field only when the stored definition says so (its own key, same secret flag).
      const clash = fields.find((x) => x.key.toLowerCase() === fk.toLowerCase());
      if (clash && !(r.fieldKey && clash.key === fk && !!clash.secret === !!r.secret)) errors.push(`${key}: its field "${fk}" is already declared. Rename the row`);
      out[key] = { field: fk, ...(r.prefix ? { prefix: r.prefix } : {}), ...(r.suffix ? { suffix: r.suffix } : {}) };
      if (r.secret) add({ key: fk, label: key, secret: true, required: true });
      else {
        add({ key: fk, label: key, required: !r.value, ...(r.value ? { default: r.value } : {}) },
          (m) => ((m.default ?? '') === r.value ? { required: m.required, ...(m.default !== undefined ? { default: m.default } : {}) } : {}));
      }
    }
    return out;
  };
  const def = { type: form.type, fields, description: form.description.trim() };
  if (form.type === 'stdio') {
    def.command = form.command.trim();
    def.args = form.args.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const found = [...line.matchAll(PLACEHOLDER_RE)];
      if (!found.length) return line;
      if (found.length > 1) errors.push(`one {placeholder} per argument: ${line}`);
      const [whole, key] = found[0];
      add({ key, label: key, required: true });
      const ref = { field: key };
      if (found[0].index > 0) ref.prefix = line.slice(0, found[0].index);
      if (found[0].index + whole.length < line.length) ref.suffix = line.slice(found[0].index + whole.length);
      return ref;
    });
    def.env = map();
  } else {
    const url = form.url.trim();
    const parts = [];
    const placeholder = (ref) => {
      parts.push(ref);
      const secret = form.placeholders[ref.field]?.secret ?? placeholderStartsSecret(url, ref.field);
      add({ key: ref.field, label: ref.field, required: true, ...(secret ? { secret: true } : {}) });
    };
    let last = 0;
    // Edit: a stored url that starts with a field (the field supplies scheme and host) keeps that ref whole while
    // the text still starts with it — read afresh, its prefix would become text ahead of the field, and the
    // resolver percent-encodes every url field after the first.
    const lead = form.urlLead;
    const leadText = lead ? `${lead.prefix || ''}{${lead.field}}${lead.suffix || ''}` : '';
    if (lead && url.startsWith(leadText)) {
      placeholder({ field: lead.field, ...(lead.prefix ? { prefix: lead.prefix } : {}), ...(lead.suffix ? { suffix: lead.suffix } : {}) });
      last = leadText.length;
    }
    for (const m of url.matchAll(PLACEHOLDER_RE)) {
      if (m.index < last) continue;
      if (m.index > last) parts.push(url.slice(last, m.index));
      placeholder({ field: m[1] });
      last = m.index + m[0].length;
    }
    if (last < url.length) parts.push(url.slice(last));
    def.url = parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
    def.headers = map();
    if (form.bearer) {
      // The tick owns the token field and the Authorization header: a row or placeholder holding either is an error.
      if (fields.some((x) => x.key.toLowerCase() === 'token')) errors.push('Bearer token: its field "token" is already declared. Rename the row or the placeholder');
      if (Object.keys(def.headers).some((k) => k.toLowerCase() === 'authorization')) errors.push('Authorization: the Bearer token tick sets this header. Remove the row');
      def.headers.Authorization = { field: 'token', prefix: 'Bearer ' };
      add({ key: 'token', label: 'Bearer token', secret: true, oauth: true, required: true });
    }
  }
  // Edit: the stored fields keep their order; fields new here follow (a stable sort).
  const order = Object.keys(meta);
  const rank = (f) => (order.includes(f.key) ? order.indexOf(f.key) : order.length);
  fields.sort((a, b) => rank(a) - rank(b));
  return { name: form.name.trim(), def, errors };
}

/** A stored manual definition → form state (Edit definition). */
export function formFromDefinition(name, def) {
  const fields = new Map(def.fields.map((f) => [f.key, f]));
  const rows = [];
  let bearer = false;
  for (const [key, v] of Object.entries((def.type === 'stdio' ? def.env : def.headers) || {})) {
    if (typeof v === 'string') { rows.push({ key, value: v, perSet: false, secret: false }); continue; }
    const f = fields.get(v.field) || {};
    if (def.type !== 'stdio' && key === 'Authorization' && v.field === 'token' && v.prefix === 'Bearer ' && !v.suffix && f.oauth) { bearer = true; continue; }
    // A ref's prefix/suffix has no column: it rides on the row, so Save writes it back.
    rows.push({ key, value: f.default || '', perSet: true, secret: !!f.secret, fieldKey: v.field,
      ...(v.prefix ? { prefix: v.prefix } : {}), ...(v.suffix ? { suffix: v.suffix } : {}) });
  }
  const placeholders = {};
  let url = '';
  let urlLead;
  if (def.type !== 'stdio') {
    const parts = Array.isArray(def.url) ? def.url : [def.url];
    url = parts.map((p) => (typeof p === 'string' ? p : `${p.prefix || ''}{${p.field}}${p.suffix || ''}`)).join('');   // a ref's affixes are URL text
    for (const p of parts) if (p && typeof p === 'object') placeholders[p.field] = { secret: !!fields.get(p.field)?.secret };
    // A leading ref stays the url's first part on Save (compileDefinition), affixes and all.
    if (parts[0] && typeof parts[0] === 'object') urlLead = { field: parts[0].field, prefix: parts[0].prefix || '', suffix: parts[0].suffix || '' };
  }
  const arg = (a) => (typeof a === 'string' ? a : `${a.prefix || ''}{${a.field}}${a.suffix || ''}`);
  return { name, type: def.type, command: def.command || '', args: (def.args || []).map(arg).join('\n'), url, bearer, rows,
    placeholders, description: def.description || '', meta: Object.fromEntries(def.fields.map((f) => [f.key, f])), ...(urlLead ? { urlLead } : {}) };
}

/** The definition form bound to `form` (mutated in place). `root.check()` validates now → boolean. */
export function createDefinitionForm(doc, api, form, { edit }) {
  const root = h(doc, 'div', 'mcp-def');
  let timer = null;
  const set = (k, v) => { form[k] = v; changed(); };
  const derived = h(doc, 'div', 'mcp-def-fills');
  const errorsEl = h(doc, 'ul', 'mcp-def-errors hint err');
  function fills() {
    const { def } = compileDefinition(form);
    derived.replaceChildren(h(doc, 'span', 'label', 'Each set fills in'));
    if (!def.fields.length) derived.appendChild(h(doc, 'small', 'hint', 'nothing. Every set runs it as is'));
    const fromArgs = new Set((def.args || []).filter((a) => typeof a === 'object').map((a) => a.field));
    const inUrl = new Set([].concat(def.url || []).filter((p) => p && typeof p === 'object').map((p) => p.field));
    for (const f of def.fields) {
      const row = h(doc, 'div', 'mcp-def-fill mono');
      const bits = [f.key];
      if (fromArgs.has(f.key)) bits.push('from arguments · cannot be secret');
      else if (f.secret) bits.push(f.oauth ? 'secret · OAuth' : 'secret');
      else if (f.default !== undefined) bits.push(`default ${f.default}`);
      row.appendChild(doc.createTextNode(bits.join(' · ')));
      if (inUrl.has(f.key)) {
        row.appendChild(makeSwitch(doc, { label: 'Secret', checked: !!f.secret, data: { placeholder: f.key } }).row);
      }
      derived.appendChild(row);
    }
  }
  function changed() {
    fills();
    if (timer) clearTimeout(timer);
    timer = setTimeout(validate, 250);
  }
  async function validate() {
    const { name, def, errors } = compileDefinition(form);
    const r = await api('POST', `/api/mcp/servers/validate${edit ? '?edit=1' : ''}`, { name, ...def });
    const all = [...errors, ...((r.data && r.data.errors) || (r.ok ? [] : [r.data?.error || `HTTP ${r.status}`]))];
    if (!name) all.unshift('a name is required');
    errorsEl.replaceChildren(...all.map((e) => h(doc, 'li', '', e)));
    return all.length === 0;
  }
  function input(label, key, { mono = true, readOnly = false, hint = '', area = false } = {}) {
    const wrap = h(doc, 'div', 'field');
    const lab = h(doc, 'label', '', label);
    const inp = h(doc, area ? 'textarea' : 'input', `${area ? 'textarea' : 'input'}${mono ? ' mono' : ''}`);
    if (area) inp.rows = 3; else inp.type = 'text';
    inp.value = form[key];
    inp.readOnly = readOnly;
    inp.dataset.def = key;
    inp.setAttribute('aria-label', label);
    wrap.append(lab, inp);
    if (hint) wrap.appendChild(h(doc, 'small', 'hint', hint));
    return wrap;
  }
  function paint() {
    const seg = h(doc, 'div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Type');
    for (const t of ['stdio', 'http', 'sse']) {
      const b = button(doc, form.type === t ? 'on' : '', t, { defType: t });
      b.setAttribute('aria-pressed', String(form.type === t));
      seg.appendChild(b);
    }
    const typeField = h(doc, 'div', 'field');
    typeField.append(h(doc, 'span', 'label', 'Type'), seg);
    const parts = [input('Name', 'name', { readOnly: edit, hint: edit ? 'to rename, add a new server' : '' }), typeField];
    if (form.type === 'stdio') {
      parts.push(input('Command', 'command'), input('Arguments', 'args', { area: true, hint: 'one per line · {name} declares a field each set fills in' }));
    } else {
      parts.push(input('URL', 'url', { hint: '{name} in the path or query declares a field each set fills in' }));
      parts.push(makeSwitch(doc, { label: 'Bearer token', checked: form.bearer, data: { bearer: '1' } }).row);
    }
    const rows = h(doc, 'div', 'field mcp-def-rows');
    rows.appendChild(h(doc, 'span', 'label', form.type === 'stdio' ? 'Environment' : 'Headers'));
    form.rows.forEach((r, i) => {
      const row = h(doc, 'div', 'mcp-def-row');
      const k = h(doc, 'input', 'input mono');
      Object.assign(k, { type: 'text', value: r.key });
      k.dataset.row = i; k.dataset.col = 'key';
      k.setAttribute('aria-label', 'Name');
      const v = h(doc, 'input', 'input mono');
      Object.assign(v, { type: 'text', value: r.secret ? '' : r.value, disabled: r.secret, placeholder: r.secret ? 'filled in each set' : 'value or default' });
      v.dataset.row = i; v.dataset.col = 'value';
      v.setAttribute('aria-label', 'Value');
      row.append(k, v);
      for (const [col, label] of [['perSet', 'Per set'], ['secret', 'Secret']]) {
        const sw = makeSwitch(doc, { label, checked: col === 'perSet' ? (r.perSet || r.secret) : r.secret, data: { row: String(i), col } });
        sw.input.disabled = col === 'perSet' && r.secret;
        row.appendChild(sw.row);
      }
      const rm = button(doc, 'btn btn-sm btn-quiet btn-icon', null, { removeRow: String(i) });
      rm.setAttribute('aria-label', 'Remove this row');
      rm.append(icon(doc, 'x', 14));
      row.appendChild(rm);
      rows.appendChild(row);
    });
    rows.appendChild(addBtn(doc, form.type === 'stdio' ? 'Add variable' : 'Add header', { addRow: '1' }));
    parts.push(rows, derived, input('Description', 'description', { mono: false }), errorsEl);
    root.replaceChildren(...parts);
    changed();
  }
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.def) set(t.dataset.def, t.value);
    else if (t.dataset.row !== undefined && (t.dataset.col === 'key' || t.dataset.col === 'value')) { form.rows[Number(t.dataset.row)][t.dataset.col] = t.value; changed(); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.bearer) { form.bearer = t.checked; paint(); }
    else if (t.dataset.placeholder) { form.placeholders[t.dataset.placeholder] = { secret: t.checked }; changed(); }
    else if (t.dataset.col === 'perSet' || t.dataset.col === 'secret') { form.rows[Number(t.dataset.row)][t.dataset.col] = t.checked; paint(); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b) return;
    if (b.dataset.defType) { form.type = b.dataset.defType; paint(); }
    else if (b.dataset.addRow) { form.rows.push({ key: '', value: '', perSet: false, secret: false }); paint(); }
    else if (b.dataset.removeRow !== undefined) { form.rows.splice(Number(b.dataset.removeRow), 1); paint(); }
  });
  paint();
  root.check = () => { if (timer) clearTimeout(timer); return validate(); };
  return root;
}
