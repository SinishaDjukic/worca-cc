// ui/public/guardrails-view.mjs
// Pure DOM renderers for the Guardrails view. Every function takes the target
// `document` via opts (defaults to the browser global) and returns DETACHED
// elements — no fetch, no listeners outside the returned tree. app.js owns
// endpoint calls, the modal shell, and mounting; node:test drives these via jsdom.
// Interactive elements carry data-id / data-value / data-list + a routing class
// (grv-edit, grv-delete, grv-back, grv-save, grv-discard, gr-rm, gr-add-btn) so
// app.js wires ONE delegated listener on the list container.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// settings -> "2 deny · 1 paths · scrub on" (raw 5-key counts, NOT the Read/Edit expansion).
export function guardrailSummary(s) {
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  return `${n(s && s.deny)} deny · ${n(s && s.protectedPaths)} paths · scrub ${s && s.envScrub ? 'on' : 'off'}`;
}

function originBadge(doc, origin) {
  if (origin === 'builtin') return h(doc, 'span', 'badge waiting grv-origin', 'built-in');
  if (typeof origin === 'string' && origin.startsWith('plugin:')) return h(doc, 'span', 'badge violet grv-origin', origin);
  return h(doc, 'span', 'badge green grv-origin', 'user');
}

// renderGuardrailList(sets) -> <div.grv-list> of cards; built-ins get View + no Delete.
export function renderGuardrailList(sets, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'grv-list');
  for (const s of sets || []) {
    const card = h(doc, 'section', 'card grv-card');
    card.dataset.id = s.id;
    const body = h(doc, 'div', 'grv-body');
    const head = h(doc, 'div', 'grv-head');
    head.appendChild(h(doc, 'b', 'grv-name', s.name));
    head.appendChild(originBadge(doc, s.origin));
    body.appendChild(head);
    body.appendChild(h(doc, 'small', 'grv-summary hint', guardrailSummary(s.settings)));
    card.appendChild(body);
    if (s.origin !== 'builtin') {
      const del = h(doc, 'button', 'btn-ghost grv-delete', 'Delete');
      del.type = 'button';
      del.dataset.id = s.id;
      card.appendChild(del);
    }
    // Open affordance: a down-chevron on the card's right edge (mirrors the
    // history/workspace cards). Keeps the .grv-edit routing class so app.js's
    // one delegated listener still opens the editor. Built-ins read "View".
    const open = h(doc, 'button', 'grv-edit grv-open');
    open.type = 'button';
    open.dataset.id = s.id;
    open.title = s.origin === 'builtin' ? 'View' : 'Edit';
    open.setAttribute('aria-label', open.title);
    open.innerHTML = '<svg class="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    card.appendChild(open);
    root.appendChild(card);
  }
  if (!sets || !sets.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'No guardrail sets.'));
  }
  return root;
}

// Wizard Step 1: choose a starting point (Blank, a built-in, or a saved set).
// sources: [{id, name, origin}]. Returns detached DOM; app.js wires .grv-next/.grv-cancel.
export function renderStartStep(sources, { doc = globalThis.document, selectedId = '' } = {}) {
  const root = h(doc, 'div', 'grv-wizard grv-step1');
  root.appendChild(h(doc, 'p', 'hint', 'Choose a starting point'));
  const list = h(doc, 'div', 'grv-source-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Starting point');
  const addRow = (id, label, builtin) => {
    const row = h(doc, 'label', 'grv-source-row');
    const radio = h(doc, 'input', 'grv-source');
    radio.type = 'radio';
    radio.name = 'grv-source';
    radio.value = id;
    if (id === selectedId) radio.checked = true;
    row.appendChild(radio);
    row.appendChild(h(doc, 'span', 'grv-source-name', label));
    if (builtin) row.appendChild(h(doc, 'span', 'badge waiting', 'built-in'));
    list.appendChild(row);
  };
  addRow('', 'Blank (custom)', false);
  for (const s of sources || []) addRow(s.id, s.name, s.origin === 'builtin');
  root.appendChild(list);
  const actions = h(doc, 'div', 'actions grv-wizard-actions');
  const cancel = h(doc, 'button', 'btn btn-ghost btn-mini grv-cancel', 'Cancel');
  cancel.type = 'button';
  const next = h(doc, 'button', 'btn btn-primary btn-mini grv-next', 'Next →');
  next.type = 'button';
  actions.appendChild(cancel);
  actions.appendChild(next);
  root.appendChild(actions);
  return root;
}

export function collectStartStep(rootEl) {
  const sel = rootEl.querySelector('.grv-source:checked');
  return sel ? sel.value : '';
}

function listEditor(doc, cls, entries, placeholder, readOnly = false) {
  const wrap = h(doc, 'div');
  const list = h(doc, 'div', `gr-list ${cls}`);
  for (const v of entries || []) {
    const row = h(doc, 'div', 'gr-row');
    row.appendChild(h(doc, 'span', 'mono', v));
    if (!readOnly) {
      const rm = h(doc, 'button', 'gr-rm', '✕');
      rm.type = 'button';
      rm.dataset.value = v;
      rm.title = 'Remove';
      rm.setAttribute('aria-label', 'Remove');
      row.appendChild(rm);
    }
    list.appendChild(row);
  }
  if (!entries || !entries.length) list.appendChild(h(doc, 'div', 'gr-empty', 'none'));
  wrap.appendChild(list);
  if (readOnly) return wrap; // no add-row in read-only view
  const add = h(doc, 'div', 'path-row gr-add');
  add.dataset.list = cls;
  const input = h(doc, 'input', 'input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.spellcheck = false;
  add.appendChild(input);
  const btn = h(doc, 'button', 'btn btn-ghost btn-mini gr-add-btn', '+ add');
  btn.type = 'button';
  add.appendChild(btn);
  wrap.appendChild(add);
  return wrap;
}

function switchRow(doc, cls, on, label, readOnly = false) {
  const row = h(doc, 'div', 'switch-row');
  const sw = h(doc, 'div', `switch ${cls}${on ? ' on' : ''}${readOnly ? ' disabled' : ''}`);
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(!!on));
  if (readOnly) sw.setAttribute('aria-disabled', 'true');
  else sw.tabIndex = 0;
  row.appendChild(sw);
  row.appendChild(h(doc, 'span', 'txt', label));
  return row;
}

function field(doc, label, child) {
  const f = h(doc, 'div', 'field');
  f.appendChild(h(doc, 'label', null, label));
  f.appendChild(child);
  return f;
}

// renderGuardrailEditor(set, {mode}) -> detached editor card (wizard Step 2).
// mode: 'create' (Back-to-step-1 + "Create set") | 'edit' ("Save") | 'view'
// (read-only built-in + "Save as new set"). app.js owns state; mutations re-render.
export function renderGuardrailEditor(set, { doc = globalThis.document, mode = 'edit', dirty = false, msg = '', msgErr = false } = {}) {
  const s = set.settings || {};
  const readOnly = mode === 'view';
  const root = h(doc, 'section', 'card grv-editor');
  root.dataset.id = set.id || '';
  root.dataset.mode = mode;
  const head = h(doc, 'div', 'grv-head');
  if (mode === 'create') {
    const back = h(doc, 'button', 'btn btn-mini grv-back', '← Back');
    back.type = 'button';
    head.appendChild(back);
  }
  if (readOnly) {
    head.appendChild(h(doc, 'b', 'grv-name', set.name));
    head.appendChild(h(doc, 'span', 'badge waiting grv-origin', 'built-in'));
  } else {
    const name = h(doc, 'input', 'input grv-name-input');
    name.type = 'text';
    name.value = set.name || '';
    name.placeholder = 'Set name';
    name.spellcheck = false;
    head.appendChild(name);
  }
  root.appendChild(head);
  root.appendChild(switchRow(doc, 'gr-honor', s.honorProjectSettings, 'Honor project .claude/settings.json', readOnly));
  root.appendChild(switchRow(doc, 'gr-scrub', s.envScrub, 'Scrub environment on agent spawn', readOnly));
  root.appendChild(field(doc, 'Env allowlist (passed through when scrub is on)',
    listEditor(doc, 'gr-allow', s.envAllowlist, 'NPM_TOKEN', readOnly)));
  root.appendChild(field(doc, 'Protected paths (denies Read/Edit)',
    listEditor(doc, 'gr-paths', s.protectedPaths, '.env*   |   **/secrets/**', readOnly)));
  root.appendChild(field(doc, 'Deny rules (pairs: Bash(git push) + Bash(git push:*))',
    listEditor(doc, 'gr-deny', s.deny, 'Bash(curl:*)', readOnly)));
  const msgEl = h(doc, 'p', `hint grv-msg${msgErr ? ' err' : ''}`, msg || '');
  msgEl.setAttribute('role', 'status');
  msgEl.setAttribute('aria-live', 'polite');
  root.appendChild(msgEl);
  const actions = h(doc, 'div', 'actions grv-editor-actions');
  if (!readOnly) {
    const discard = h(doc, 'button', 'btn btn-ghost btn-mini grv-discard', 'Discard');
    discard.type = 'button';
    discard.disabled = !dirty;
    actions.appendChild(discard);
  }
  const save = h(doc, 'button', 'btn btn-primary btn-mini grv-save',
    mode === 'create' ? 'Create set' : (mode === 'view' ? 'Save as new set' : 'Save'));
  save.type = 'button';
  save.disabled = readOnly ? false : !dirty;
  actions.appendChild(save);
  root.appendChild(actions);
  return root;
}

// The inverse of renderGuardrailEditor: read the live DOM back into {name, settings}.
export function collectGuardrailEditor(rootEl) {
  const nameInput = rootEl.querySelector('.grv-name-input');
  const nameEl = rootEl.querySelector('.grv-name');
  const listVals = (cls) =>
    [...rootEl.querySelectorAll(`.gr-list.${cls} .gr-row .mono`)].map((n) => n.textContent);
  return {
    name: nameInput ? nameInput.value.trim() : ((nameEl && nameEl.textContent) || ''),
    settings: {
      honorProjectSettings: !!(rootEl.querySelector('.gr-honor') || {}).classList?.contains('on'),
      envScrub: !!(rootEl.querySelector('.gr-scrub') || {}).classList?.contains('on'),
      envAllowlist: listVals('gr-allow'),
      protectedPaths: listVals('gr-paths'),
      deny: listVals('gr-deny'),
    },
  };
}

// "Create guardrails" dialog body: name + start-from (hidden for the built-in
// save-as-new flow, which supplies its own settings).
export function renderCreateDialog(sources, { doc = globalThis.document, hideFrom = false } = {}) {
  const root = h(doc, 'div', 'grv-create');
  const name = h(doc, 'input', 'input grv-create-name');
  name.type = 'text';
  name.placeholder = 'e.g. Org policy';
  name.spellcheck = false;
  root.appendChild(field(doc, 'Name', name));
  if (!hideFrom) {
    const wrap = h(doc, 'div', 'select-wrap');
    const sel = h(doc, 'select', 'select grv-create-from');
    const blank = h(doc, 'option', null, 'Blank (permissive)');
    blank.value = '';
    sel.appendChild(blank);
    for (const s of sources || []) {
      const o = h(doc, 'option', null, s.name);
      o.value = s.id;
      sel.appendChild(o);
    }
    wrap.appendChild(sel);
    root.appendChild(field(doc, 'Start from', wrap));
  }
  root.appendChild(h(doc, 'small', 'hint grv-create-msg', ''));
  return root;
}

export function collectCreateDialog(rootEl) {
  const from = rootEl.querySelector('.grv-create-from');
  return {
    name: ((rootEl.querySelector('.grv-create-name') || {}).value || '').trim(),
    from: from ? (from.value || '') : '',
  };
}

// 409 body: who still pins the set ([{id, referencedBy: string[]}] flattened —
// referencedBy entries are "pipeline <id>" resume-point pins).
export function renderGuardrailReferences409(references, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'grv-refs409');
  root.appendChild(h(doc, 'p', 'hint err', 'Cannot delete: still referenced by'));
  const list = h(doc, 'div', 'gr-list');
  for (const r of references || []) {
    for (const by of (r && Array.isArray(r.referencedBy)) ? r.referencedBy : []) {
      const row = h(doc, 'div', 'gr-row');
      row.appendChild(h(doc, 'span', 'mono', by));
      list.appendChild(row);
    }
  }
  root.appendChild(list);
  return root;
}
