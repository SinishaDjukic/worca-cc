// ui/public/memory-view.mjs
// Pure DOM renderers for the Memory view (agent-memory-design.md §10). Every function takes the
// target `document` via opts (defaults to the browser global) and returns DETACHED elements — no
// fetch, no listeners outside the returned tree (guardrails-view.mjs posture). app.js owns the
// endpoint calls and the mounting; node:test drives these via jsdom. Interactive elements carry a
// routing class (mem-new, mem-save, mem-cancel, mem-delete, mem-restore, mem-defrag) plus
// data-name / data-id, so the controller wires ONE delegated listener per host. The namespace is
// `mem-*`: `mv-*` belongs to Settings → Models (models-view.mjs). Every string that came from disk
// (names, hooks, bodies, reasons) is a textContent / value — never innerHTML.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The ONE name rule, shared by the editor's pre-check and the server's 400 text, so a user never
 *  sees two spellings of the same rule. The server (isValidMemoryName) stays the authority — this
 *  check is instant feedback, not a complete gate (it knows nothing about Win32 reserved stems). */
export const MEMORY_NAME_HELP = 'letters, digits, ".", "_" and "-" only, no extension, no leading or trailing dot';

/** The hash for a scope (and optionally one file): global lives under Settings, a project under its Projects row. */
export function memoryRoute(scopeKey, name = '') {
  const base = scopeKey === 'global' ? 'settings/memory' : `${scopeKey}/memory`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

const BADGES = { fresh: ['No memory yet', ''], ok: ['Healthy', 'green'], due: ['Defragment due', 'amber'], overdue: ['Defragment overdue', 'red'] };
export function healthBadge(level) {
  const [text, cls] = BADGES[level] || BADGES.fresh;
  return { text, cls };
}

/** `YYYY-MM-DD HH:MM` in LOCAL time (like fmtDate everywhere else in the app), or '' for anything
 *  unparsable — these dates are display-only. */
export function formatWhen(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const NO_HOST_HINT = 'Register a project on the Projects page to host the global defragment run.';

/**
 * The health card: badge + reasons + counters + the ONE Defragment control (spec §10). `host` is
 * `{ key, name } | null` — the project that would host a GLOBAL defragment run (a project scope
 * hosts its own, so `host` is ignored there); with no registered project the button is disabled
 * and the hint says so, in visible text as well as the title. While a run is live the button stays
 * ENABLED, reads "Defragmenting… open the run" and carries `data-run-id`: the controller routes to
 * `#running/<id>`.
 */
export function renderHealthCard(report, { doc = globalThis.document, host = null } = {}) {
  const health = report?.health || {};
  const isGlobal = String(report?.scope || 'global') === 'global';
  const card = h(doc, 'div', 'card mem-health');
  const head = h(doc, 'div', 'mem-health-head');
  const { text, cls } = healthBadge(health.level);
  head.appendChild(h(doc, 'span', `badge${cls ? ` ${cls}` : ''}`, text));
  head.appendChild(h(doc, 'span', 'mem-counters',
    `${plural(health.files || 0, 'file')} · ${health.bytes || 0} bytes · ${health.alwaysOnBytes || 0} bytes always loaded · ${plural(health.writesSinceDefrag || 0, 'write')} since the last defragment` +
    (health.lastDefragAt ? ` · last defragmented ${formatWhen(health.lastDefragAt)}` : '')));
  card.appendChild(head);
  if (Array.isArray(health.reasons) && health.reasons.length) {
    const ul = h(doc, 'ul', 'mem-reasons');
    for (const r of health.reasons) ul.appendChild(h(doc, 'li', '', String(r)));
    card.appendChild(ul);
  }
  const actions = h(doc, 'div', 'actions mem-actions');
  const runId = report?.defragRunId ? String(report.defragRunId) : '';
  const btn = h(doc, 'button', 'btn btn-primary btn-mini mem-defrag', runId ? 'Defragmenting… open the run' : 'Defragment');
  btn.type = 'button';
  if (runId) btn.dataset.runId = runId;
  else if (isGlobal && !host) { btn.disabled = true; btn.title = NO_HOST_HINT; }
  actions.appendChild(btn);
  card.appendChild(actions);
  if (isGlobal && !runId) {
    card.appendChild(h(doc, 'small', 'hint mem-host-hint',
      host ? `Runs on ${host.name || host.key} — pick another project on the New pipeline page.` : NO_HOST_HINT));
  }
  card.appendChild(h(doc, 'small', 'hint', 'A defragment run merges duplicate topics, splits overgrown files, drops stale rules and tightens hooks. It is an ordinary pipeline run; the previous files stay in History.'));
  return card;
}

/** The file list: a head with the New button, one row per file. The ROW is the control (click,
 *  Enter, Space) — no nested button, so `role="button"` holds no interactive descendant. */
export function renderFileList(files, { doc = globalThis.document, selected = '' } = {}) {
  const wrap = h(doc, 'div', 'mem-list');
  const head = h(doc, 'div', 'mem-list-head');
  head.appendChild(h(doc, 'span', 'mem-list-title', 'Files'));
  const add = h(doc, 'button', 'btn btn-ghost btn-mini mem-new', 'New file');
  add.type = 'button';
  head.appendChild(add);
  wrap.appendChild(head);
  const list = Array.isArray(files) ? files : [];
  if (!list.length) { wrap.appendChild(h(doc, 'div', 'hist-empty', 'No memory files yet — agents and Ask Worca add them, or click New file.')); return wrap; }
  for (const f of list) {
    const row = h(doc, 'div', `mem-row${f.name === selected ? ' on' : ''}`);
    row.dataset.name = f.name;
    row.setAttribute('role', 'button'); row.tabIndex = 0;
    const main = h(doc, 'div', 'mem-row-main');
    main.appendChild(h(doc, 'div', 'mem-row-name mono', `${f.name}.md`));
    main.appendChild(h(doc, 'div', 'mem-row-hook', f.description || '(no description)'));
    const meta = [formatWhen(f.updated), f.source || ''].filter(Boolean).join(' · ') + (f.hasFrontmatter === false ? ' · no frontmatter' : '');
    main.appendChild(h(doc, 'div', 'mem-row-meta', meta));
    row.appendChild(main);
    wrap.appendChild(row);
  }
  return wrap;
}

/** The editor: the whole file (frontmatter included) as text. A NEW file has an editable name and
 *  no Delete; `locked` (a live defragment run on this scope) disables Save and Delete — Cancel
 *  always closes. */
export function renderEditor(file, { doc = globalThis.document, isNew = false, msg = '', msgErr = false, locked = false } = {}) {
  const wrap = h(doc, 'div', 'mem-editor');
  const nameField = h(doc, 'div', 'field field-compact');
  nameField.appendChild(h(doc, 'label', '', 'Name'));
  const name = h(doc, 'input', 'input mono mem-name');
  name.type = 'text'; name.spellcheck = false; name.value = file?.name || '';
  name.readOnly = !isNew;
  name.placeholder = 'topic-name';
  nameField.appendChild(name);
  if (isNew) nameField.appendChild(h(doc, 'small', 'hint mem-name-help', MEMORY_NAME_HELP));
  wrap.appendChild(nameField);
  const textField = h(doc, 'div', 'field');
  textField.appendChild(h(doc, 'label', '', 'Markdown (frontmatter + body)'));
  const ta = h(doc, 'textarea', 'textarea mono mem-text');
  ta.rows = 16; ta.spellcheck = false;
  ta.value = file?.text || (isNew ? '---\nname: \ndescription: \n---\n' : '');
  textField.appendChild(ta);
  textField.appendChild(h(doc, 'small', 'hint', 'Keep name, description (one line: when the file matters — shown here and to Ask Worca) and optional paths (the file loads only when a matching file is read) in the frontmatter; worca stamps source and updated.'));
  wrap.appendChild(textField);
  const text = msg || (locked ? 'A defragment run is live on this scope — Save and Delete resume when it finishes.' : '');
  const status = h(doc, 'div', `hint mem-msg${msgErr ? ' err' : ''}`, text);
  status.setAttribute('role', 'status');
  wrap.appendChild(status);
  const actions = h(doc, 'div', 'actions mem-actions');
  if (!isNew) {
    const d = h(doc, 'button', 'btn btn-danger btn-mini mem-delete', 'Delete');
    d.type = 'button'; d.disabled = !!locked;
    actions.appendChild(d);
  }
  const cancel = h(doc, 'button', 'btn btn-ghost btn-mini mem-cancel', 'Cancel'); cancel.type = 'button';
  const save = h(doc, 'button', 'btn btn-primary btn-mini mem-save', 'Save'); save.type = 'button'; save.disabled = !!locked;
  actions.append(cancel, save);
  wrap.appendChild(actions);
  return wrap;
}

export function collectEditor(rootEl) {
  return { name: String(rootEl.querySelector('.mem-name')?.value || '').trim(), text: String(rootEl.querySelector('.mem-text')?.value ?? '') };
}

/** The snapshot ring, newest first, one Restore per row (disabled while a defragment run is live). */
export function renderMemoryHistory(snapshots, { doc = globalThis.document, locked = false } = {}) {
  const wrap = h(doc, 'div', 'mem-history');
  wrap.appendChild(h(doc, 'div', 'mem-list-title', 'History'));
  const list = Array.isArray(snapshots) ? [...snapshots].reverse() : [];
  if (!list.length) { wrap.appendChild(h(doc, 'div', 'hist-empty', 'No snapshots yet — every write takes one.')); return wrap; }
  for (const s of list) {
    const row = h(doc, 'div', 'mem-snap');
    row.dataset.id = s.id;
    row.appendChild(h(doc, 'span', 'mem-snap-id mono', s.id));
    row.appendChild(h(doc, 'span', 'mem-snap-count', plural((s.files || []).length, 'file')));
    const btn = h(doc, 'button', 'btn btn-ghost btn-mini mem-restore', 'Restore');
    btn.type = 'button'; btn.dataset.id = s.id; btn.disabled = !!locked;
    row.appendChild(btn);
    wrap.appendChild(row);
  }
  return wrap;
}
