// ui/public/exec-env-spec-editor.mjs — the project's environment spec as a form (docs/environment-spec.md "On the
// project page"): Tools are rows of a mise tool name and a pinned version, Apt packages one line of names. Save PUTs
// { tools, apt }; Clear DELETEs. The server checks the spec (src/core/exec-env/env-spec.mjs) and its message shows
// inline under the form. Not here: base image, env vars, files, secrets (a spec never holds them).

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const button = (doc, cls, text) => { const b = el(doc, 'button', cls, text); b.type = 'button'; return b; };
const textInput = (doc, cls, value, placeholder, label) => {
  const i = el(doc, 'input', `input mono ${cls}`); i.type = 'text'; i.value = value ?? ''; i.placeholder = placeholder;
  i.setAttribute('aria-label', label); i.spellcheck = false; i.autocomplete = 'off';
  return i;
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
  const form = el(doc, 'div', 'exec-env-spec');
  form.append(el(doc, 'h4', null, 'Environment spec'),
    el(doc, 'p', 'hint', 'The tools every sandbox of this project starts with. Pin each version (24.21.0, not latest). After a change, Build makes a new environment.'));

  const list = el(doc, 'div', 'exec-env-spec-tools');
  const addRow = (t = {}) => {
    const r = el(doc, 'div', 'exec-env-spec-tool');
    const remove = button(doc, 'btn btn-sm btn-quiet exec-env-tool-remove', 'Remove');
    remove.setAttribute('aria-label', 'Remove this tool');
    remove.addEventListener('click', () => r.remove());
    r.append(textInput(doc, 'exec-env-tool-name', t.name, 'e.g. node or npm:prettier', 'Tool name'),
      textInput(doc, 'exec-env-tool-version', t.version, 'e.g. 24.21.0', 'Pinned version'), remove);
    list.append(r);
    return r;
  };
  for (const t of spec?.tools ?? []) addRow(t);
  const add = button(doc, 'btn btn-sm exec-env-tool-add', 'Add tool');
  add.addEventListener('click', () => addRow().querySelector('input').focus());
  form.append(el(doc, 'div', 'exec-env-spec-label', 'Tools (mise)'), list, add);

  const aptRow = el(doc, 'label', 'field exec-env-field-row');
  aptRow.append(el(doc, 'span', null, 'Apt packages'), textInput(doc, 'exec-env-apt', (spec?.apt ?? []).join(' '), 'e.g. libpq-dev graphviz', 'Apt packages'));
  form.append(aptRow);

  const msg = el(doc, 'p', 'field-err exec-env-spec-error'); msg.hidden = true; msg.setAttribute('role', 'alert');
  const actions = el(doc, 'div', 'exec-env-spec-actions');
  const save = button(doc, 'btn btn-primary btn-sm exec-env-spec-save', 'Save spec');
  const clear = button(doc, 'btn btn-sm btn-quiet exec-env-spec-clear', 'Clear spec');
  clear.hidden = !spec;
  actions.append(save, clear);
  const run = async (btn, fn) => {
    msg.hidden = true; msg.textContent = '';
    save.disabled = true; clear.disabled = true;
    try { await fn(); } catch (err) { msg.textContent = err?.message || String(err); msg.hidden = false; }
    finally { save.disabled = false; clear.disabled = false; }
  };
  save.addEventListener('click', () => void run(save, () => onSave(readSpecForm(form))));
  clear.addEventListener('click', () => void run(clear, () => onClear()));
  form.append(msg, actions);
  if (!spec) form.append(el(doc, 'p', 'hint exec-env-spec-missing', `No environment spec yet. The CLI sets one too: worca exec-env spec --project ${projectKey} --set spec.json`));
  return form;
}
