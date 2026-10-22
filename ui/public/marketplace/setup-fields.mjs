// ui/public/marketplace/setup-fields.mjs — the shared Set up fields of the plugin sheet (marketplace P4, CONTRACT §3.6
// as amended by SM27): one section per task source, chat channel and model secrets. Secrets are never prefilled; a
// stored one shows "Set" + Replace and stays out of the collected values until replaced. Pure: no fetch, no state; DOM
// only through the `doc` handed in. The only listeners are More options and Replace, inside the returned tree.
import { icon } from '../icons.mjs';
import { fieldError } from '../feedback.mjs';
import { chip } from './kinds.mjs';

const LETTER = { source: 's', channel: 'c', modelSecrets: 'm' };
const MONO = /(?:ChatIds|Allowlist)$/;
const DOTS = '•'.repeat(10);
const part = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '-');
const base = (section) => `${LETTER[section.kind] ?? 's'}-${part(section.id)}`;
const fieldId = (section, key) => `mk-f-${base(section)}-${part(key)}`;

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function labelFor(doc, text, id, required) {
  const label = make(doc, 'label');
  label.htmlFor = id;
  label.append(doc.createTextNode(String(text)));
  if (required) label.append(make(doc, 'span', 'mk-req', 'Required'));
  return label;
}

function markRequired(control) {
  control.dataset.required = '1';
  control.setAttribute('aria-required', 'true');
}

/** Sources (named from `names`), channels, then model secrets; empty schemas and a broker-held key drop out. */
export function setupSections(config, { names = {} } = {}) {
  const out = [];
  for (const s of config?.sources ?? []) {
    if (s?.schema?.length) out.push({ ...s, kind: 'source', title: names[s.id] || s.id });
  }
  for (const c of config?.channels ?? []) {
    if (c?.schema?.length) out.push({ ...c, kind: 'channel', title: c.displayName || c.id });
  }
  const m = config?.models;
  if (m?.schema?.length && !m.broker) {
    // The server sends model secrets as optional, but plugin-setup-state counts every one as required (P5's Needs setup).
    out.push({ kind: 'modelSecrets', id: '', title: 'Model secrets', schema: m.schema.map((f) => ({ ...f, required: true })), values: m.values });
  }
  return out;
}

function unsetSecret(doc, f, id, { replaced = false } = {}) {
  const wrap = make(doc, 'div', 'mk-secret');
  const input = make(doc, 'input', 'input');
  input.type = 'password';
  input.id = id;
  input.setAttribute('autocomplete', 'off');
  input.dataset.key = f.key;
  input.value = '';
  if (replaced) input.dataset.set = '1';
  if (f.required) markRequired(input);
  wrap.append(icon(doc, 'key', 16), input);
  return wrap;
}

function storedSecret(doc, f, id, name) {
  const wrap = make(doc, 'div', 'mk-secret-set');
  const dots = make(doc, 'span', 'input mk-secret-dots', DOTS);
  dots.setAttribute('aria-hidden', 'true');
  const replace = make(doc, 'button', 'btn btn-sm btn-quiet mk-replace', 'Replace');
  replace.type = 'button';
  replace.id = id;
  replace.setAttribute('aria-label', `Replace ${name}`);
  replace.addEventListener('click', () => {
    const fresh = unsetSecret(doc, f, id, { replaced: true });
    wrap.replaceWith(fresh);
    fresh.querySelector('input').focus();
  });
  wrap.append(dots, chip(doc, 'ok', 'Set', { icon: 'check' }), replace);
  return wrap;
}

function control(doc, f, val, id, name) {
  if (f.type === 'select') {
    const wrap = make(doc, 'div', 'select-wrap');
    const sel = make(doc, 'select', 'select');
    sel.id = id;
    sel.dataset.key = f.key;
    for (const o of f.options ?? []) {
      const opt = make(doc, 'option', '', typeof o === 'object' ? String(o.label ?? o.value) : String(o));
      opt.value = typeof o === 'object' ? String(o.value) : String(o);
      sel.append(opt);
    }
    const v = typeof val === 'string' ? val : f.default != null ? String(f.default) : null;
    if (v != null) sel.value = v;   // no stored value (a first profile): the default, never the first option
    if (f.required) markRequired(sel);
    wrap.append(sel);
    return wrap;
  }
  if (f.secret) return val?.set === true ? storedSecret(doc, f, id, name) : unsetSecret(doc, f, id);
  const input = make(doc, 'input', MONO.test(f.key) ? 'input mk-mono' : 'input');
  input.type = 'text';
  input.id = id;
  input.dataset.key = f.key;
  input.value = typeof val === 'string' ? val : f.default != null ? String(f.default) : '';
  if (MONO.test(f.key)) input.setAttribute('spellcheck', 'false');
  if (f.required) markRequired(input);
  return input;
}

function field(doc, section, f) {
  const id = fieldId(section, f.key);
  const name = f.label || f.key;
  const row = make(doc, 'div', 'field');
  row.dataset.field = f.key;
  row.append(labelFor(doc, name, id, f.required), control(doc, f, (section.values ?? {})[f.key], id, name));
  if (f.help) row.append(make(doc, 'small', 'hint', f.help));
  return row;
}

function profileRow(doc, section) {
  const id = `mk-p-${base(section)}`;
  const row = make(doc, 'div', 'field');
  const roster = Array.isArray(section.profiles) ? section.profiles : [];
  if (section.profile != null && roster.length) {
    row.append(labelFor(doc, 'Profile', id, false));
    const wrap = make(doc, 'div', 'select-wrap');
    const sel = make(doc, 'select', 'select mk-profile-sel');
    sel.id = id;
    sel.dataset.sourceId = section.id;
    for (const p of roster) {
      const opt = make(doc, 'option', '', p.label ? `${p.label} (${p.id})` : String(p.id));
      opt.value = String(p.id);
      sel.append(opt);
    }
    sel.value = String(section.profile);
    wrap.append(sel);
    row.append(wrap);
    return row;
  }
  row.append(labelFor(doc, 'Profile', id, true));
  const input = make(doc, 'input', 'input mk-profile-id');
  input.type = 'text';
  input.id = id;
  input.placeholder = 'work';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-required', 'true');
  row.append(input);
  return row;
}

function setOpen(button, body, open) {
  body.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

/** One section.mk-setup: heading, the profile row of a multi-profile source, the fields, then More options. */
export function renderSetupFields(doc, section, { mode = 'install' } = {}) {
  const root = make(doc, 'section', 'mk-setup');
  root.dataset.kind = section.kind;
  if (section.kind === 'source') {
    root.dataset.sourceId = section.id;
    if (section.profile) root.dataset.profile = section.profile;
  } else if (section.kind === 'channel') {
    root.dataset.channelId = section.id;
  } else if (section.kind === 'modelSecrets') {
    root.dataset.target = 'modelSecrets';
  }
  const manage = mode === 'manage';
  const text = section.kind === 'modelSecrets' ? 'Model secrets' : manage ? section.title : `Set up ${section.title}`;
  root.append(make(doc, manage ? 'h4' : 'h3', manage ? 'subsection-title mk-setup-h' : 'section-title mk-setup-h', text));
  if (section.kind === 'source' && section.multiProfile) root.append(profileRow(doc, section));
  const schema = Array.isArray(section.schema) ? section.schema : [];
  for (const f of schema.filter((x) => x.advanced !== true)) root.append(field(doc, section, f));
  const advanced = schema.filter((x) => x.advanced === true);
  if (advanced.length) {
    const bodyId = `mk-more-${base(section)}`;
    const more = make(doc, 'button', 'btn btn-quiet mk-disc');
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', bodyId);
    more.append(icon(doc, 'chevron', 16), doc.createTextNode('More options'), make(doc, 'span', 'mk-count', String(advanced.length)));
    const body = make(doc, 'div', 'mk-disc-body');
    body.id = bodyId;
    body.hidden = true;
    for (const f of advanced) body.append(field(doc, section, f));
    more.addEventListener('click', () => setOpen(more, body, body.hidden));
    root.append(more, body);
  }
  return root;
}

/** The PUT body of one section, as collectConfigForm builds it, except that an empty secret field is never sent: an
 *  untouched stored secret stays, and an optional one left empty is not stored as '' (read back as { set: true }). */
export function collectSetupFields(el) {
  const values = {};
  for (const c of el.querySelectorAll('[data-key]')) {
    if (c.type === 'password' && c.value === '') continue;
    values[c.dataset.key] = c.value;
  }
  const d = el.dataset;
  if (d.kind === 'modelSecrets') return { target: d.target || 'modelSecrets', values };
  if (d.kind === 'channel') return { channelId: d.channelId, values };
  const out = { sourceId: d.sourceId || '', values };
  const id = el.querySelector('.mk-profile-id');
  if (id) { out.profile = id.value.trim(); out.newProfile = true; } else if (d.profile) out.profile = d.profile;
  return out;
}

/** "Enter a value." under each empty required control (a stored secret left as is is not missing), the first focused;
 *  a folded one is unfolded first. Returns the count. */
export function flagMissing(el) {
  const missing = [...el.querySelectorAll('[data-required="1"], .mk-profile-id')]
    .filter((c) => c.dataset.set !== '1' && String(c.value ?? '').trim() === '');
  for (const c of missing) {
    const body = c.closest('.mk-disc-body');
    const more = body && el.querySelector(`.mk-disc[aria-controls="${body.id}"]`);
    if (body?.hidden && more) setOpen(more, body, true);
  }
  missing.forEach((c, i) => fieldError(c, 'Enter a value.', { focus: i === 0 }));
  return missing.length;
}
