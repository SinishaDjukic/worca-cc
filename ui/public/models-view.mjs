// ui/public/models-view.mjs
// Pure DOM renderers for the Models view (configurable-models-design.md §4.10).
// Mirrors guardrails-view.mjs: every function takes `doc` via opts (defaults to
// the browser global) and returns DETACHED elements — no fetch, no listeners
// outside the returned tree. app.js owns endpoint calls and mounting.
// Interactive elements carry data-id + a routing class (mv-edit, mv-delete,
// mv-promote, mv-save, mv-cancel, mv-env-add, mv-env-rm) so app.js wires ONE
// delegated listener on the list container.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** "medium · high" or "all efforts" (the full set carries no signal). */
export function effortsSummary(efforts, allEfforts) {
  const list = Array.isArray(efforts) ? efforts : [];
  if (!list.length || (allEfforts && list.length === allEfforts.length)) return 'all efforts';
  return list.join(' · ');
}

/** "2 env vars · routes via base URL" | "1 env var" | '' (none). */
export function envSummary(env) {
  const keys = Object.keys(env || {});
  if (!keys.length) return '';
  const n = `${keys.length} env var${keys.length === 1 ? '' : 's'}`;
  return keys.includes('ANTHROPIC_BASE_URL') ? `${n} · routes via base URL` : n;
}

/**
 * The Models view body: global entries (editable), the selected project's
 * legacy custom models (promotable), and the built-in catalog (read-only).
 * `globals` come MASKED from GET /api/models. `predefinedShadowedIds` marks
 * built-ins currently overridden by a global entry.
 */
export function renderModelsList({ globals = [], legacy = [], predefined = [], efforts = [], projectName = '' } = {}, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'mv-list');
  const predefLc = new Set(predefined.map((m) => m.id.toLowerCase()));

  const section = (title, hint) => {
    const s = h(doc, 'div', 'mv-section');
    s.appendChild(h(doc, 'h3', 'mv-section-title', title));
    if (hint) s.appendChild(h(doc, 'small', 'hint', hint));
    return s;
  };

  // ── Your models (global) ──
  const yours = section('Your models', 'Defined once, available in every project. An entry with a built-in id overrides that built-in.');
  if (!globals.length) {
    yours.appendChild(h(doc, 'div', 'hist-empty', 'No global models yet — Add model to define one.'));
  }
  for (const m of globals) {
    const card = h(doc, 'section', 'card mv-card');
    card.dataset.id = m.id;
    const body = h(doc, 'div', 'mv-body');
    const head = h(doc, 'div', 'mv-head');
    head.appendChild(h(doc, 'b', 'mv-name', m.label || m.id));
    if (predefLc.has(m.id.toLowerCase())) head.appendChild(h(doc, 'span', 'badge violet mv-shadow', 'overrides built-in'));
    if (m.costUnreliable) head.appendChild(h(doc, 'span', 'badge waiting mv-cost', 'cost not verified'));
    body.appendChild(head);
    const bits = [m.id, effortsSummary(m.efforts, efforts), envSummary(m.env)].filter(Boolean);
    body.appendChild(h(doc, 'small', 'mv-summary hint', bits.join(' — ')));
    card.appendChild(body);
    const del = h(doc, 'button', 'btn-ghost mv-delete', 'Delete');
    del.type = 'button'; del.dataset.id = m.id;
    card.appendChild(del);
    const edit = h(doc, 'button', 'btn-ghost mv-edit', 'Edit');
    edit.type = 'button'; edit.dataset.id = m.id;
    card.appendChild(edit);
    yours.appendChild(card);
  }
  root.appendChild(yours);

  // ── Legacy per-project models (promotable) ──
  if (legacy.length) {
    const leg = section(
      `Project models${projectName ? ` — ${projectName}` : ''} (legacy)`,
      'Defined only for this project. Promote to make them global; the id keeps working everywhere it is referenced.'
    );
    for (const m of legacy) {
      const card = h(doc, 'section', 'card mv-card mv-legacy');
      card.dataset.id = m.id;
      const body = h(doc, 'div', 'mv-body');
      const head = h(doc, 'div', 'mv-head');
      head.appendChild(h(doc, 'b', 'mv-name', m.label || m.id));
      head.appendChild(h(doc, 'span', 'badge waiting mv-origin', 'project (legacy)'));
      body.appendChild(head);
      body.appendChild(h(doc, 'small', 'mv-summary hint', m.id));
      card.appendChild(body);
      const promote = h(doc, 'button', 'btn-ghost mv-promote', 'Promote to global');
      promote.type = 'button'; promote.dataset.id = m.id;
      card.appendChild(promote);
      leg.appendChild(card);
    }
    root.appendChild(leg);
  }

  // ── Built-ins (read-only) ──
  const globalLc = new Set(globals.map((m) => m.id.toLowerCase()));
  const builtins = section('Built-in models', 'Shipped with worca. Add a model with the same id to override its label, efforts, or routing.');
  for (const m of predefined) {
    const row = h(doc, 'div', 'mv-builtin');
    row.dataset.id = m.id;
    row.appendChild(h(doc, 'b', 'mv-name', m.label));
    if (globalLc.has(m.id.toLowerCase())) row.appendChild(h(doc, 'span', 'badge violet mv-shadowed', 'overridden'));
    row.appendChild(h(doc, 'small', 'mv-summary hint', `${m.id} — ${effortsSummary(m.efforts, efforts)}`));
    builtins.appendChild(row);
  }
  root.appendChild(builtins);
  return root;
}

/** One env key/value editor row. Existing values arrive MASKED; leaving a
 *  masked value untouched means "keep" (the server drops masked echoes). */
function envRow(doc, key = '', value = '') {
  const row = h(doc, 'div', 'mv-env-row');
  const k = h(doc, 'input', 'input mv-env-key');
  k.type = 'text'; k.placeholder = 'ANTHROPIC_BASE_URL'; k.value = key;
  const v = h(doc, 'input', 'input mv-env-val');
  v.type = 'text'; v.placeholder = 'value, or ${VAR} to read your shell env'; v.value = value;
  if (value) v.dataset.original = value; // masked echo detection on collect
  const rm = h(doc, 'button', 'btn-ghost mv-env-rm', '✕');
  rm.type = 'button';
  row.appendChild(k); row.appendChild(v); row.appendChild(rm);
  return row;
}

/**
 * The add/edit form. `model` is a MASKED global entry, or null for create.
 * Returns detached DOM; app.js wires mv-save / mv-cancel / mv-env-add /
 * mv-env-rm and calls collectModelEditor on save.
 */
export function renderModelEditor(model, efforts, { doc = globalThis.document } = {}) {
  const editing = !!model;
  const root = h(doc, 'section', 'card mv-editor');
  root.dataset.mode = editing ? 'edit' : 'create';
  if (editing) {
    root.dataset.id = model.id;
    // The stored env keys, so collect can send null (= delete) for rows the
    // user removed — the write-only PATCH can't infer deletions otherwise.
    root.dataset.envKeys = Object.keys(model.env || {}).join('\n');
  }
  root.appendChild(h(doc, 'h3', 'mv-editor-title', editing ? `Edit ${model.label || model.id}` : 'Add model'));

  const grid = h(doc, 'div', 'mv-editor-grid');
  const field = (labelText, input, hint) => {
    const wrap = h(doc, 'label', 'mv-field');
    wrap.appendChild(h(doc, 'span', 'mv-field-label', labelText));
    wrap.appendChild(input);
    if (hint) wrap.appendChild(h(doc, 'small', 'hint', hint));
    return wrap;
  };

  const idInput = h(doc, 'input', 'input mv-id');
  idInput.type = 'text';
  idInput.placeholder = 'claude-opus-4-8, glm-4.7, a fine-tune id…';
  idInput.value = editing ? model.id : '';
  idInput.disabled = editing; // the id IS the reference — delete + re-add to rename
  grid.appendChild(field('Model id (passed to claude --model)', idInput,
    editing ? '' : 'Use a built-in id to override that built-in.'));

  const labelInput = h(doc, 'input', 'input mv-label');
  labelInput.type = 'text';
  labelInput.placeholder = 'Display name (defaults to the id)';
  labelInput.value = editing ? (model.label === model.id ? '' : model.label) : '';
  grid.appendChild(field('Label', labelInput));

  const effWrap = h(doc, 'div', 'mv-efforts');
  const selected = new Set(editing && Array.isArray(model.efforts) ? model.efforts : efforts);
  for (const e of efforts) {
    const lab = h(doc, 'label', 'mv-effort');
    const cb = h(doc, 'input', 'mv-effort-cb');
    cb.type = 'checkbox'; cb.value = e; cb.checked = selected.has(e);
    lab.appendChild(cb);
    lab.appendChild(h(doc, 'span', null, e));
    effWrap.appendChild(lab);
  }
  grid.appendChild(field('Supported efforts', effWrap, 'All checked = every effort (the default).'));

  const envWrap = h(doc, 'div', 'mv-env');
  const rows = editing && model.env ? Object.entries(model.env) : [];
  for (const [k, v] of rows) envWrap.appendChild(envRow(doc, k, v));
  const add = h(doc, 'button', 'btn-ghost mv-env-add', '+ env var');
  add.type = 'button';
  grid.appendChild(field('Routing env (merged into the claude spawn for this model)', envWrap,
    'e.g. ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN. Stored values show masked; leave masked to keep. WORCA_* and process keys are reserved.'));
  grid.appendChild(add);

  root.appendChild(grid);
  const msg = h(doc, 'p', 'form-msg mv-editor-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);

  const btns = h(doc, 'div', 'mv-editor-btns');
  const save = h(doc, 'button', 'btn-go mv-save', editing ? 'Save' : 'Add model');
  save.type = 'button';
  const cancel = h(doc, 'button', 'btn-ghost mv-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(save); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/** app.js exposes envRow creation to the delegated mv-env-add handler. */
export function makeEnvRow({ doc = globalThis.document } = {}) {
  return envRow(doc);
}

/**
 * Collect the editor into a request body. For EDIT mode the env is a write-only
 * PATCH: unchanged masked values are echoed (the server treats them as "keep"),
 * removed keys are sent as null. Returns { id, body } — id is null in create
 * mode (POST carries it in the body instead).
 */
export function collectModelEditor(rootEl) {
  const editing = rootEl.dataset.mode === 'edit';
  const id = editing ? rootEl.dataset.id : (rootEl.querySelector('.mv-id')?.value || '').trim();
  const label = (rootEl.querySelector('.mv-label')?.value || '').trim();
  const efforts = [...rootEl.querySelectorAll('.mv-effort-cb')].filter((c) => c.checked).map((c) => c.value);
  const allCount = rootEl.querySelectorAll('.mv-effort-cb').length;

  const env = {};
  const seen = new Set();
  for (const row of rootEl.querySelectorAll('.mv-env-row')) {
    const k = (row.querySelector('.mv-env-key')?.value || '').trim();
    const v = row.querySelector('.mv-env-val')?.value ?? '';
    if (!k) continue;
    seen.add(k);
    env[k] = v;
  }
  if (editing) {
    // Keys the stored entry had but the editor no longer shows -> delete (null).
    for (const k of (rootEl.dataset.envKeys || '').split('\n').filter(Boolean)) {
      if (!seen.has(k)) env[k] = null;
    }
  }

  const body = {
    ...(editing ? {} : { id }),
    label,
    // All boxes checked = the full set = store the default (empty).
    efforts: efforts.length === allCount ? [] : efforts,
    env,
  };
  return { id: editing ? id : null, body };
}

/** Human summary of what deleting `id` clears, for the confirmation prompt. */
export function deleteRefsSummary(id, refs) {
  if (refs && refs.predefinedShadow) {
    return `Remove the override of built-in "${id}"? The built-in entry comes back; nothing else changes.`;
  }
  const nodes = refs && Array.isArray(refs.nodes) ? refs.nodes.length : 0;
  const steps = refs && Array.isArray(refs.steps) ? refs.steps.length : 0;
  const projects = new Set([
    ...((refs && refs.nodes) || []).map((n) => n.projectKey),
    ...((refs && refs.steps) || []).map((s) => s.projectKey),
  ]).size;
  if (!nodes && !steps) return `Delete model "${id}"? No pipeline configuration references it.`;
  return `Delete model "${id}"? This also clears ${nodes} node selection${nodes === 1 ? '' : 's'} and ` +
    `${steps} role selection${steps === 1 ? '' : 's'} across ${projects} project${projects === 1 ? '' : 's'}.`;
}
