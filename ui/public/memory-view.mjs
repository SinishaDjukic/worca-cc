// ui/public/memory-view.mjs
// Pure DOM renderers for the Memory view (agent-memory-design.md §10). Every function takes the
// target `document` via opts (defaults to the browser global) and returns DETACHED elements — no
// fetch, no listeners outside the returned tree (guardrails-view.mjs posture). app.js owns the
// endpoint calls and the mounting; node:test drives these via jsdom. Interactive elements carry a
// routing class (mem-new, mem-save, mem-cancel, mem-delete, mem-restore, mem-defrag) plus
// data-name / data-id, so the controller wires ONE delegated listener per host. The namespace is
// `mem-*`: `mv-*` belongs to the Models page (models-view.mjs). Every string that came from disk
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

/** The hash for a scope (and optionally one file): global lives under Settings, a project under its project page's Memory tab. */
export function memoryRoute(scopeKey, name = '') {
  const base = scopeKey === 'global' ? 'settings/memory' : `${scopeKey}/memory`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

const BADGES = { fresh: ['No memory yet', ''], ok: ['Healthy', 'green'], due: ['Defragment due', 'amber'], overdue: ['Defragment overdue', 'red'], failing: ['Writes failing', 'red'] };
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

// Plain words for a memory source (docs/design-system.md › Patterns: ids in a tooltip).
const SLUG_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+?)(?:-(\d{2}))?$/;

/** Where a write came from, as { kind: 'run'|'user'|'chat'|'other', ref }. `defrag:` is a run too. */
export function memorySource(src) {
  const m = /^(run|defrag|ask):(.+)$/.exec(String(src || ''));
  if (m) return m[1] === 'ask' ? { kind: 'chat', ref: m[2] } : { kind: 'run', ref: m[2] };
  return String(src || '') === 'user' ? { kind: 'user', ref: '' } : { kind: 'other', ref: '' };
}

/** A snapshot id `yyyymmdd-hhmmss-slug[-NN]` (memory-store stamps it in UTC) → { iso, source }. */
export function parseSnapshotId(id) {
  const m = SLUG_RE.exec(String(id || ''));
  if (!m) return { iso: '', source: { kind: 'other', ref: '' } };
  const [, y, mo, d, hh, mi, ss, slug] = m;
  const iso = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss)).toISOString();
  const s = /^(run|defrag|ask)-(.+)$/.exec(slug);
  const source = s ? (s[1] === 'ask' ? { kind: 'chat', ref: s[2] } : { kind: 'run', ref: s[2] })
    : slug === 'user' ? { kind: 'user', ref: '' } : { kind: 'other', ref: '' };
  return { iso, source };
}

const SOURCE_WORDS = { user: 'you', chat: 'a chat', other: 'Worca' };

/** The source as words: a run's title linked to the run, 'a run' when the title is unknown (a link
 *  only when the run's row is known), 'you' / 'a chat' / 'Worca' otherwise. */
export function sourceNode(source, { doc = globalThis.document, runInfo = () => null } = {}) {
  const wrap = h(doc, 'span', 'mem-src');
  if (source.kind !== 'run') { wrap.textContent = SOURCE_WORDS[source.kind]; return wrap; }
  wrap.dataset.runRef = source.ref;
  const info = runInfo(source.ref);
  if (!info) { wrap.textContent = 'a run'; return wrap; }
  const a = h(doc, 'a', 'mem-src-link', info.title || 'a run');
  a.href = info.href;
  if (!info.title) a.setAttribute('aria-label', 'Open this run');   // tells it apart from the plain "a run"
  wrap.appendChild(a);
  return wrap;
}

/** Swap every still-unresolved run reference under `root` for its name once the runs are known. */
export function patchRunRefs(root, runInfo, { doc = globalThis.document } = {}) {
  for (const el of root.querySelectorAll('[data-run-ref]')) {
    if (el.querySelector('a') || !runInfo(el.dataset.runRef)) continue;
    const next = sourceNode({ kind: 'run', ref: el.dataset.runRef }, { doc, runInfo });
    next.className = el.className;
    el.replaceWith(next);
  }
}

const NO_HOST_HINT = 'Register a project on the Projects page to host the global defragment run.';

/** Settings › Memory's defragment model as the host hint names it — ` with Opus 5.5 · high` — from
 *  the report's `defragModel` ({ model, effort, label, stale } | null). '' when unset, so the unset
 *  sentence stays byte-identical. A model that left the catalog says so without naming a fallback:
 *  the run then uses the node layers — the host project's own pick or the template's model — and the
 *  global report cannot know which (memory-defrag-model.mjs). */
export function defragModelPhrase(dm) {
  if (!dm || typeof dm.model !== 'string' || !dm.model) return '';
  if (dm.stale) return ` without the Settings › Memory model (${dm.model} is no longer in the catalog)`;
  return ` with ${dm.label || dm.model}${dm.effort ? ` · ${dm.effort}` : ''}`;
}

/** The defragment glyph: three rows of blocks, the lower ones fragmented. Pure SVG elements (no
 *  text node), so the button's textContent stays its label alone. */
function defragIcon(doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true');
  for (const [x, y, w] of [[3, 4, 18], [3, 10, 8], [13, 10, 8], [3, 16, 5], [10, 16, 11]]) {
    const r = doc.createElementNS(NS, 'rect');
    r.setAttribute('x', String(x)); r.setAttribute('y', String(y)); r.setAttribute('width', String(w)); r.setAttribute('height', '4'); r.setAttribute('rx', '1');
    svg.appendChild(r);
  }
  return svg;
}

/**
 * The health card: badge + reasons + counters + the ONE Defragment control (spec §10). `host` is
 * `{ key, name } | null` — the project that would host a GLOBAL defragment run (a project scope
 * hosts its own, so `host` is ignored there); with no registered project the button is disabled
 * and the hint says so, in visible text as well as the title. While a run is live the button stays
 * ENABLED, reads "Open run" (the counters line says it is defragmenting) and carries `data-run-id`: the controller routes to
 * `#running/<id>`. The global host hint also names Settings › Memory's defragment model when one is
 * set (`report.defragModel`, see defragModelPhrase).
 */
export function renderHealthCard(report, { doc = globalThis.document, host = null } = {}) {
  const health = report?.health || {};
  const isGlobal = String(report?.scope || 'global') === 'global';
  const card = h(doc, 'div', 'card mem-health');
  // Interface mode (docs/ui-levels.md): byte counters and Defragment are expert upkeep — until the
  // store needs it. An overdue or failing store is a problem the owner must see at any mode.
  card.dataset.minLevel = 'expert';
  if (health.level === 'overdue' || health.level === 'failing') card.dataset.levelKeep = '1';
  const head = h(doc, 'div', 'mem-health-head');
  const { text, cls } = healthBadge(health.level);
  head.appendChild(h(doc, 'span', `badge${cls ? ` ${cls}` : ''}`, text));
  head.appendChild(h(doc, 'span', 'mem-counters',
    `${plural(health.files || 0, 'file')} · ${health.bytes || 0} bytes · ${health.alwaysOnBytes || 0} bytes always loaded · ${plural(health.writesSinceDefrag || 0, 'write')} since the last defragment` +
    (health.lastDefragAt ? ` · last defragmented ${formatWhen(health.lastDefragAt)}` : '') +
    (health.failedWrites ? ` · ${plural(health.failedWrites, 'failed write')}` : '') +
    (report?.defragRunId ? ' · defragmenting now' : '')));
  // The ONE control sits at the head's right edge (margin-left:auto), styled like every other
  // secondary pill (btn) with the defragment glyph before its label.
  const runId = report?.defragRunId ? String(report.defragRunId) : '';
  const btn = h(doc, 'button', 'btn btn-sm mem-defrag');
  btn.type = 'button';
  btn.appendChild(defragIcon(doc));
  btn.appendChild(doc.createTextNode(runId ? 'Open run' : 'Defragment'));
  if (runId) btn.dataset.runId = runId;
  else if (isGlobal && !host) { btn.disabled = true; btn.title = NO_HOST_HINT; }
  head.appendChild(btn);
  card.appendChild(head);
  if (Array.isArray(health.reasons) && health.reasons.length) {
    const ul = h(doc, 'ul', 'mem-reasons');
    for (const r of health.reasons) ul.appendChild(h(doc, 'li', '', String(r)));
    card.appendChild(ul);
  }
  if (isGlobal && !runId) {
    card.appendChild(h(doc, 'small', 'hint mem-host-hint',
      host ? `Runs on ${host.name || host.key}${defragModelPhrase(report?.defragModel)}. Pick another project on the New run page.` : NO_HOST_HINT));
  }
  card.appendChild(h(doc, 'small', 'hint', 'A defragment run merges duplicate topics, splits overgrown files, drops stale rules and tightens hooks. It is an ordinary pipeline run; the previous files stay in History.'));
  return card;
}

/** The file list: a head with the New button, one row per file. The row's main block is the control
 *  (click, Enter, Space) and holds no interactive descendant; the meta line beside it may hold the
 *  source run's link (D6). */
export function renderFileList(files, { doc = globalThis.document, selected = '', runInfo = () => null } = {}) {
  const wrap = h(doc, 'div', 'card mem-list');
  const head = h(doc, 'div', 'mem-list-head');
  head.appendChild(h(doc, 'span', 'mem-list-title', 'Files'));
  const add = h(doc, 'button', 'btn btn-sm mem-new', 'New file');
  add.type = 'button';
  head.appendChild(add);
  wrap.appendChild(head);
  const list = Array.isArray(files) ? files : [];
  if (!list.length) { wrap.appendChild(h(doc, 'div', 'hist-empty', 'No memory files yet. Agents and Chat add them, or click New file.')); return wrap; }
  for (const f of list) {
    const row = h(doc, 'div', `mem-row${f.name === selected ? ' on' : ''}`);
    row.dataset.name = f.name;
    const main = h(doc, 'div', 'mem-row-main row-btn');
    main.setAttribute('role', 'button'); main.tabIndex = 0;
    main.setAttribute('aria-label', `Open ${f.name}.md`);
    main.appendChild(h(doc, 'div', 'mem-row-name mono', `${f.name}.md`));
    main.appendChild(h(doc, 'div', 'mem-row-hook', f.description || '(no description)'));
    row.appendChild(main);
    const meta = h(doc, 'div', 'mem-row-meta');
    const when = formatWhen(f.updated);
    if (when) meta.append(when);
    if (f.source) {
      meta.title = f.source;
      meta.append(when ? ' · ' : '', sourceNode(memorySource(f.source), { doc, runInfo }));
    }
    if (f.hasFrontmatter === false) meta.append(' · no frontmatter');
    row.appendChild(meta);
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
  textField.appendChild(h(doc, 'small', 'hint', 'Keep name, description (one line on when the file matters, shown here and to Chat) and optional paths (the file loads only when a matching file is read) in the frontmatter; worca stamps source and updated.'));
  wrap.appendChild(textField);
  const text = msg || (locked ? 'A defragment run is live on this scope. Save and Delete resume when it finishes.' : '');
  const status = h(doc, 'div', `hint mem-msg${msgErr ? ' err' : ''}`, text);
  status.setAttribute('role', 'status');
  wrap.appendChild(status);
  const actions = h(doc, 'div', 'actions mem-actions');
  if (!isNew) {
    const d = h(doc, 'button', 'btn btn-danger btn-sm mem-delete', 'Delete');
    d.type = 'button'; d.disabled = !!locked;
    actions.appendChild(d);
  }
  const cancel = h(doc, 'button', 'btn btn-sm mem-cancel', 'Cancel'); cancel.type = 'button';
  const save = h(doc, 'button', 'btn btn-primary btn-sm mem-save', 'Save'); save.type = 'button'; save.disabled = !!locked;
  actions.append(cancel, save);
  wrap.appendChild(actions);
  return wrap;
}

export function collectEditor(rootEl) {
  return { name: String(rootEl.querySelector('.mem-name')?.value || '').trim(), text: String(rootEl.querySelector('.mem-text')?.value ?? '') };
}

/** The snapshot ring, newest first, one Restore per row (disabled while a defragment run is live). */
export function renderMemoryHistory(snapshots, { doc = globalThis.document, locked = false, runInfo = () => null } = {}) {
  const wrap = h(doc, 'div', 'card mem-history');
  wrap.dataset.minLevel = 'expert';             // snapshot restore: expert (docs/ui-levels.md)
  wrap.appendChild(h(doc, 'div', 'mem-list-title', 'History'));
  const list = Array.isArray(snapshots) ? [...snapshots].reverse() : [];
  if (!list.length) { wrap.appendChild(h(doc, 'div', 'hist-empty', 'No snapshots yet. Every write takes one.')); return wrap; }
  for (const s of list) {
    const row = h(doc, 'div', 'mem-snap');
    row.dataset.id = s.id;
    row.title = s.id;
    const { iso, source } = parseSnapshotId(s.id);
    row.appendChild(h(doc, 'span', 'mem-snap-when', formatWhen(iso)));
    if (iso) {   // an unparsable id names nothing: the row shows only its count
      row.appendChild(h(doc, 'span', 'mem-snap-sep', ' · '));
      const src = sourceNode(source, { doc, runInfo });
      src.className = 'mem-snap-src';
      row.appendChild(src);
    }
    row.appendChild(h(doc, 'span', 'mem-snap-count', plural((s.files || []).length, 'file')));
    const btn = h(doc, 'button', 'btn btn-sm mem-restore', 'Restore');
    btn.type = 'button'; btn.dataset.id = s.id; btn.disabled = !!locked;
    row.appendChild(btn);
    wrap.appendChild(row);
  }
  return wrap;
}
