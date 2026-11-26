// ui/public/exec-env-spec-editor.mjs — the project's environment spec as a form (docs/environment-spec.md "On the
// project page"): Tools are rows of a mise tool name and a pinned version, Apt packages one line of names. Save PUTs
// { tools, apt }; Clear DELETEs. The server checks the spec (src/core/exec-env/env-spec.mjs) and its message shows
// inline above the form's actions (.field-error). Not here: base image, env vars, files, secrets (a spec never holds
// them). Divided rows (`.drow.drow-wide`, docs/design-system.md) inside the exec card's backend block style; the tool
// rows reuse the Actions env rows (`.ac-env-row`); both actions are secondary (the card's own Save is its primary).
import { feedbackIcon } from './feedback.mjs';

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (doc, cls, text) => { const b = el(doc, 'button', cls, text); b.type = 'button'; return b; };
const textInput = (doc, cls, value, placeholder, label) => {
  const i = el(doc, 'input', `input mono ${cls}`); i.type = 'text'; i.value = value ?? ''; i.placeholder = placeholder;
  i.setAttribute('aria-label', label); i.spellcheck = false; i.autocomplete = 'off';
  return i;
};
/** A wide divided row: label and help on top, the control at full width under them. */
const wideRow = (doc, label, help, control) => {
  const r = el(doc, 'div', 'drow drow-wide');
  r.append(el(doc, 'span', 'drow-label', label), el(doc, 'small', 'hint drow-help', help));
  const c = el(doc, 'div', 'drow-control exec-env-spec-control'); c.append(...[control].flat());
  r.append(c);
  return r;
};

/** The spec the form holds: rows with both fields empty are skipped, a half-filled row is sent (the server names it). */
export function readSpecForm(form) {
  const tools = [...form.querySelectorAll('.exec-env-spec-tool')].map((r) => ({
    name: r.querySelector('.exec-env-tool-name').value.trim(), version: r.querySelector('.exec-env-tool-version').value.trim() }))
    .filter((t) => t.name || t.version);
  const apt = form.querySelector('.exec-env-apt').value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return { tools, apt };
}

/**
 * @param {Document} doc
 * @param {{spec: {tools: {name: string, version: string}[], apt: string[]}|null, projectKey: string,
 *   onSave: (spec: object) => Promise<void>, onClear: () => Promise<void>}} o  each throws Error(message) on refusal
 * @returns {HTMLElement}
 */
export function renderSpecEditor(doc, { spec, projectKey, onSave, onClear }) {
  const form = el(doc, 'div', 'exec-env-backend exec-env-spec');
  form.append(el(doc, 'h4', null, 'Environment spec'),
    el(doc, 'p', 'hint', 'The tools every sandbox of this project starts with. After a change, Build makes a new environment.'));

  const list = el(doc, 'div', 'exec-env-spec-tools');
  const addRow = (t = {}) => {
    const r = el(doc, 'div', 'ac-env-row exec-env-spec-tool');
    const remove = button(doc, 'btn btn-sm exec-env-tool-remove', 'Remove');
    remove.setAttribute('aria-label', 'Remove this tool');
    remove.addEventListener('click', () => r.remove());
    r.append(textInput(doc, 'ac-env-name exec-env-tool-name', t.name, 'node or npm:prettier', 'Tool name'),
      textInput(doc, 'ac-env-value exec-env-tool-version', t.version, '24.21.0', 'Pinned version'), remove);
    list.append(r);
    return r;
  };
  for (const t of spec?.tools ?? []) addRow(t);
  const add = button(doc, 'btn btn-sm exec-env-tool-add', 'Add tool');
  add.addEventListener('click', () => addRow().querySelector('input').focus());
  const apt = textInput(doc, 'exec-env-apt', (spec?.apt ?? []).join(' '), 'libpq-dev graphviz', 'Apt packages');
  const rows = el(doc, 'div', 'drows');
  rows.append(wideRow(doc, 'Tools', 'A mise tool and its pinned version, such as node 24.21.0. Never latest.', [list, add]),
    wideRow(doc, 'Apt packages', 'Package names, separated by spaces.', apt));
  form.append(rows);

  const msg = el(doc, 'div', 'field-error exec-env-spec-error'); msg.hidden = true; msg.setAttribute('role', 'alert');
  const msgText = el(doc, 'span', 'fe-text');
  msg.append(feedbackIcon(doc, 'err', 'fe-ic'), msgText);
  const actions = el(doc, 'div', 'add-project-actions');
  const clear = button(doc, 'btn btn-sm btn-quiet exec-env-spec-clear', 'Clear spec');
  const save = button(doc, 'btn btn-sm exec-env-spec-save', 'Save spec');
  clear.hidden = !spec;
  actions.append(clear, save);
  const run = async (fn) => {
    msg.hidden = true; msgText.textContent = '';
    save.disabled = true; clear.disabled = true;
    try { await fn(); } catch (err) { msgText.textContent = err?.message || String(err); msg.hidden = false; }
    finally { save.disabled = false; clear.disabled = false; }
  };
  save.addEventListener('click', () => void run(() => onSave(readSpecForm(form))));
  clear.addEventListener('click', () => void run(() => onClear()));
  form.append(msg, actions);
  if (!spec) {
    // The command in <code>; the project key (an id) only in its tooltip.
    const full = `worca exec-env spec --project ${projectKey} --set spec.json`;
    const hint = el(doc, 'p', 'hint exec-env-spec-missing');
    const code = el(doc, 'code', null, 'worca exec-env spec --set spec.json'); code.title = full;
    hint.append(doc.createTextNode('No spec yet. The CLI can set one too: '), code, doc.createTextNode('.'));
    hint.dataset.command = full;
    form.append(hint);
  }
  return form;
}
