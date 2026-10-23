// ui/public/memory-view.mjs
// Pure DOM renderers for the Memory view (agent-memory-design.md §10). Every function takes the
// target `document` via opts (defaults to the browser global) and returns DETACHED elements — no
// fetch, no listeners outside the returned tree (guardrails-view.mjs posture). app.js owns the
// endpoint calls and the mounting; node:test drives these via jsdom. Interactive elements carry a
// routing class (mem-new, mem-save, mem-cancel, mem-delete, mem-restore, mem-defrag; the Team view:
// mem-view, mem-team-switch, mem-team-sync, mem-team-seed, mem-team-dismiss, mem-team-undo,
// mem-team-compare, mem-team-remove; the project Overview's offer: mem-team-turn-on, mem-team-not-now; the seeding dialog: mem-seed-check, mem-seed-all, mem-seed-clash)
// plus data-name / data-id, so the controller wires ONE delegated listener per host. The namespace is
// `mem-*`: `mv-*` belongs to the Models page (models-view.mjs). Every string that came from disk
// (names, hooks, bodies, reasons) is a textContent / value — never innerHTML.
import { makeSwitch } from './switch.mjs';

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

// ── The Team view (team memory 1b): a project scope's notes as the team sees them ──────────────────────────────
/** The Team view's hash segment after `memory/`: never a note name — `~` is outside the name class, and
 *  encodeURIComponent leaves it as it is, so the route reads the same before and after the pills encode it. */
export const MEMORY_TEAM_SUB = '~team';

const TEAM_STATES = {
  local: ['Local only', 'grey'], held: ['Held', 'violet'], blocked: ['Blocked', 'red'], pending: ['Pending push', 'amber'],
  deleting: ['Removing from the team', 'amber'], shared: ['Shared', 'green'], team: ['Team only', 'blue'],
};
/** One label per state — a tracked copy is "Shared" like any shared note (one state, one label). */
export function teamStateBadge(state) {
  const [text, cls] = TEAM_STATES[state] || TEAM_STATES.local;
  return { text, cls };
}
const firstLine = (s) => String(s || '').trim().split('\n').find(Boolean) || '';
/** Local notes the team does not hold as they are: what "Share existing notes" offers. */
export const seedableCount = (status) => (status?.counts?.local || 0) + (status?.counts?.held || 0);

/** Notes | Team — the project Memory tab's two views (a `.seg` like the Team metrics tabs). `data-view` routes. */
export function renderMemoryViews(view, { doc = globalThis.document } = {}) {
  const seg = h(doc, 'div', 'seg seg-sm mem-views');
  seg.setAttribute('role', 'tablist');
  for (const [key, label] of [['notes', 'Notes'], ['team', 'Team']]) {
    const b = h(doc, 'button', `mem-view${view === key ? ' on' : ''}`, label);
    b.type = 'button'; b.dataset.view = key;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(view === key));
    seg.appendChild(b);
  }
  return seg;
}

/**
 * The Team view's head: the opt-in switch (`mem-team-switch`) and what it does; on, the branch, the last fetch and
 * push, every sync error with 1a's hint, the counts, and the seeding controls — the one-time offer (`mem-team-seed` /
 * `mem-team-dismiss`) until finished or dismissed, then a plain "Share existing notes…", and Undo of the last seeding
 * (`mem-team-undo`). `busy`: a request of the view is on its way — every control waits for it.
 */
export function renderTeamCard(status, { doc = globalThis.document, busy = false } = {}) {
  const on = !!status?.enabled;
  const card = h(doc, 'section', 'card mem-team-card');
  const head = h(doc, 'div', 'mem-team-head');
  head.appendChild(h(doc, 'b', '', 'Team memory'));
  const { row: toggle, input: cb } = makeSwitch(doc, { label: on ? 'On' : 'Off', ariaLabel: 'Share this project\'s notes with the team',
    checked: on, inputClass: 'mem-team-switch', rowClass: 'mem-team-toggle' });
  // Off and refused by the server's own check (D8: no git, a Folder project, no origin): the switch could never turn on.
  const blocked = !on && status?.canStart === false;
  cb.disabled = !!busy || blocked;
  head.appendChild(toggle);
  card.appendChild(head);
  card.appendChild(h(doc, 'small', blocked ? 'hint mem-team-cannot' : 'hint', on
    ? `Notes written or changed here are shared on the ${status.branch} branch of this repository after a secret check, and teammates' notes load into runs and chats. Your note wins over the team's of the same name, and changing it replaces the team's version.`
    : blocked ? teamStartRefusal(status.startError)
      : `${status?.available?.branchOnOrigin === true ? `${TEAM_AVAILABLE_TEXT}: its worca-memory branch is on origin. ` : ''}Share this project's notes with teammates on a worca-memory branch of its repository, after a secret check. The notes that exist now stay on this machine until you pick which to share.`));
  if (!on) return card;
  const r = status.remote || {};
  const where = r.exists === false ? 'not on origin yet — the first note shared starts it' : r.headSha ? `at ${String(r.headSha).slice(0, 7)}` : 'not fetched yet';
  const sync = h(doc, 'div', 'mem-team-sync-row');
  sync.appendChild(h(doc, 'span', 'mem-team-sync-text', [`Branch ${status.branch} ${where}`, r.fetchedAt ? `fetched ${formatWhen(r.fetchedAt)}` : '', r.lastSyncAt ? `last push ${formatWhen(r.lastSyncAt)}` : ''].filter(Boolean).join(' · ')));
  const syncBtn = h(doc, 'button', 'btn btn-sm btn-quiet mem-team-sync', 'Sync now');
  syncBtn.type = 'button'; syncBtn.disabled = !!busy;
  sync.appendChild(syncBtn);
  card.appendChild(sync);
  if (r.lastError) {
    const err = h(doc, 'div', 'mem-team-error');
    err.setAttribute('role', 'alert');
    err.appendChild(h(doc, 'div', '', `Last push failed${r.lastErrorAt ? ` (${formatWhen(r.lastErrorAt)})` : ''}: ${firstLine(r.lastError)}`));
    if (r.hint) err.appendChild(h(doc, 'div', 'mem-team-hint', `To fix: ${r.hint}`));
    card.appendChild(err);
  }
  if (r.lastFetchError) card.appendChild(h(doc, 'div', 'mem-team-warn', `Could not fetch the team's notes: ${firstLine(r.lastFetchError)} — the last fetched ones stay in use.`));
  const order = ['shared', 'pending', 'deleting', 'local', 'held', 'blocked', 'team'];
  const counts = order.filter((s) => status.counts?.[s]).map((s) => `${status.counts[s]} ${teamStateBadge(s).text.toLowerCase()}`);
  card.appendChild(h(doc, 'div', 'mem-team-counts', counts.join(' · ') || 'No notes yet.'));
  const seeding = h(doc, 'div', 'mem-team-seeding');
  const n = seedableCount(status);
  if (status.seed?.offer === 'pending' && n > 0) {
    const offer = h(doc, 'div', 'mem-team-offer');
    offer.appendChild(h(doc, 'span', '', `${plural(n, 'note')} on this machine ${n === 1 ? 'is' : 'are'} not shared. Pick the ones the team should have — each passes the secret check first.`));
    const go = h(doc, 'button', 'btn btn-primary btn-sm mem-team-seed', 'Review notes…'); go.type = 'button'; go.disabled = !!busy;
    const later = h(doc, 'button', 'btn btn-sm btn-quiet mem-team-dismiss', 'Not now'); later.type = 'button'; later.disabled = !!busy;
    offer.append(go, later);
    seeding.appendChild(offer);
  } else {
    const share = h(doc, 'button', 'btn btn-sm btn-quiet mem-team-seed', 'Share existing notes…');
    share.type = 'button'; share.disabled = n === 0 || !!busy;
    if (n === 0) share.title = 'Every note here is shared, on its way, or blocked.';
    seeding.appendChild(share);
  }
  const last = status.seed?.last;
  if (last) {
    const undo = h(doc, 'button', 'btn btn-sm btn-quiet mem-team-undo', 'Undo last seeding'); undo.type = 'button'; undo.disabled = !!busy;
    seeding.append(undo, h(doc, 'small', 'hint', `Seeded ${formatWhen(last.at)}: ${plural(last.shared, 'note')} shared, ${last.tookTeam} replaced by the team's version, ${last.held} held. Undo puts your notes back and pushes nothing.`));
  }
  card.appendChild(seeding);
  return card;
}

/** The text of the add-time offer (E10): origin already has the team branch and this project is off. */
export const TEAM_AVAILABLE_TEXT = 'Your team shares memory for this repository';
/**
 * The project Overview's one line while the offer stands (a project row's `teamMemoryOffer`): Turn on
 * (`mem-team-turn-on`, the normal switch) and Not now (`mem-team-not-now`, for good on this machine). The blue offer
 * row of the Team view, not a dialog. `busy`: a request of the line is on its way.
 */
export function renderTeamAvailableLine({ doc = globalThis.document, busy = false } = {}) {
  const line = h(doc, 'div', 'mem-team-offer mem-team-available');
  line.appendChild(h(doc, 'span', '', TEAM_AVAILABLE_TEXT));
  const on = h(doc, 'button', 'btn btn-primary btn-sm mem-team-turn-on', 'Turn on'); on.type = 'button'; on.disabled = !!busy;
  const later = h(doc, 'button', 'btn btn-sm btn-quiet mem-team-not-now', 'Not now'); later.type = 'button'; later.disabled = !!busy;
  line.append(on, later);
  return line;
}

/** Why the switch cannot turn on (teamMemoryStatus `startError`), in one line. */
function teamStartRefusal(err) {
  switch (err?.code) {
    case 'NO_GIT': return 'Team memory needs git on this machine: install git, then switch it on.';
    case 'FOLDER_PROJECT': return 'Team memory needs a git project: this is a Folder project.';
    case 'NO_ORIGIN': return 'Team memory needs an origin remote: the team\'s notes live on a branch there. Add one, then switch it on.';
    default: return firstLine(err?.message) || 'Team memory cannot be switched on for this project.';
  }
}
function teamButton(doc, cls, label, name, busy) {
  const b = h(doc, 'button', `btn btn-sm btn-quiet ${cls}`, label);
  b.type = 'button'; b.dataset.name = name; b.disabled = !!busy;
  return b;
}
function teamRowDetail(n) {
  const by = [n.author ? `by ${n.author}` : '', n.updated ? formatWhen(n.updated) : ''].filter(Boolean).join(', ');
  switch (n.state) {
    case 'local': return n.shadows ? 'The team has a different note of this name — yours is the one loaded here until you compare them.' : 'On this machine only.';
    case 'held': return 'Differs from the team\'s version and held: none of its changes are shared until you keep yours or take the team\'s.';
    case 'blocked': return `Not shared: ${n.reason || 'the secret check flagged it'}. Edit the note so the check passes; it is shared then.`;
    case 'pending': return n.error ? `Waiting to be pushed — the last push failed (${firstLine(n.error)}).` : 'Waiting to be pushed.';
    case 'deleting': return `Being removed from the team${n.error ? ` — the last push failed (${firstLine(n.error)})` : ''}.${n.local ? ' Your local copy stays here.' : ''}`;
    case 'shared':
      if (n.behind && !n.team) return 'No longer on the team: the next sync removes this copy if a teammate deleted the note, or keeps it as a local note.';
      return n.behind ? 'The team has a newer version: it replaces this copy at the next sync.' : `On the team${by ? ` (${by})` : ''}; your copy follows the team's changes.`;
    case 'team': return `A teammate's note${by ? ` (${by})` : ''}${n.mounted ? '' : ' — not loaded into runs: over the team note cap or this machine\'s size cap, or a note here spells the name in another case'}.`;
    default: return '';
  }
}
/** One row per note (teamMemoryStatus `notes`): its state, why it is blocked, a push error, and its actions — Compare
 *  (`mem-team-compare`) on a held note or a local note the team has a version of; Remove from team (`mem-team-remove`)
 *  on a note the team holds. Rows are not `.mem-row`: those are the Notes view's. `busy`: as renderTeamCard's. */
export function renderTeamNotes(status, { doc = globalThis.document, busy = false } = {}) {
  const wrap = h(doc, 'div', 'mem-team-list');
  wrap.appendChild(h(doc, 'div', 'mem-list-title', 'Notes'));
  const notes = Array.isArray(status?.notes) ? status.notes : [];
  if (!notes.length) { wrap.appendChild(h(doc, 'div', 'hist-empty', 'No notes yet — on this machine or on the team.')); return wrap; }
  for (const n of notes) {
    const row = h(doc, 'div', 'mem-team-row');
    row.dataset.name = n.name; row.dataset.state = n.state;
    const main = h(doc, 'div', 'mem-team-main');
    const title = h(doc, 'div', 'mem-team-title');
    const { text, cls } = teamStateBadge(n.state);
    title.append(h(doc, 'span', 'mono', `${n.name}.md`), h(doc, 'span', `badge ${cls}`, text));
    main.appendChild(title);
    const detail = teamRowDetail(n);
    if (detail) main.appendChild(h(doc, 'div', 'mem-team-detail', detail));
    if (n.state === 'blocked' && Array.isArray(n.findings) && n.findings.length) {
      const ul = h(doc, 'ul', 'mem-team-findings');
      for (const f of n.findings) ul.appendChild(h(doc, 'li', '', `${f.label || f.rule}${f.line ? ` — line ${f.line}` : f.field && f.field !== 'body' ? ` — in the ${f.field}` : ''}`));
      main.appendChild(ul);
    }
    row.appendChild(main);
    const actions = h(doc, 'div', 'mem-team-actions');
    if (n.state === 'held' || (n.state === 'local' && n.shadows)) actions.appendChild(teamButton(doc, 'mem-team-compare', 'Compare…', n.name, busy));
    if (n.team && (n.state === 'shared' || n.state === 'team')) actions.appendChild(teamButton(doc, 'mem-team-remove', 'Remove from team', n.name, busy));
    row.appendChild(actions);
    wrap.appendChild(row);
  }
  return wrap;
}

/** Mine | Team side by side; a line the other side lacks is marked `mem-cmp-diff`. No diff library — a line set. */
export function renderClashCompare(note, { doc = globalThis.document } = {}) {
  const box = h(doc, 'div', 'mem-cmp');
  const col = (cls, title, text, other) => {
    const c = h(doc, 'div', `mem-cmp-col ${cls}`);
    c.appendChild(h(doc, 'div', 'mem-cmp-title', title));
    const pre = h(doc, 'pre', 'mem-cmp-text mono');
    const theirs = new Set(String(other || '').split('\n'));
    for (const line of String(text || '').replace(/\n$/, '').split('\n')) pre.appendChild(h(doc, 'span', `mem-cmp-line${theirs.has(line) ? '' : ' mem-cmp-diff'}`, `${line}\n`));
    c.appendChild(pre);
    return c;
  };
  const t = note?.team || {};
  const by = [t.author ? `by ${t.author}` : '', t.updated ? formatWhen(t.updated) : ''].filter(Boolean).join(', ');
  box.append(col('mem-cmp-mine', `Mine — ${note.name}.md`, note.text, t.text), col('mem-cmp-team', `Team — ${t.name || note.name}.md${by ? ` (${by})` : ''}`, t.text, note.text));
  return box;
}

const CLASH_CHOICES = [['share', 'Keep mine'], ['take-team', 'Take team'], ['skip', 'Skip — hold it']];
/**
 * The seeding dialog's body: a checklist of the notes that pass the secret check (none ticked — nothing is uploaded
 * unless picked), every same-name clash side by side with Keep mine / Take team / Skip (Skip by default: never
 * overwrite silently; a skipped clash is held), the notes the check blocks with their reason (they stay here), and
 * the ones the team already holds as they are. Inputs carry data-name / data-hash / data-team-hash.
 */
export function renderSeedReview(preview, { doc = globalThis.document } = {}) {
  const wrap = h(doc, 'div', 'mem-seed');
  const notes = Array.isArray(preview?.notes) ? preview.notes : [];
  wrap.appendChild(h(doc, 'small', `hint mem-seed-fetch${preview?.fetchError ? ' warn' : ''}`, preview?.fetchError
    ? `Could not reach the team branch (${firstLine(preview.fetchError)}) — compared with the copy fetched ${formatWhen(preview.fetchedAt) || 'earlier'}.`
    : `Compared with the team branch as fetched ${formatWhen(preview?.fetchedAt) || 'just now'}.`));
  // A note recorded BLOCKED (an edit the check blocked, the host's refusal) stays here whatever the team holds: listed
  // with its reason, never a decision — the commit refuses one. A note the check would block only now is a clash still
  // (Take team and Skip apply to it).
  const decidable = notes.filter((n) => n.state !== 'blocked');
  const ready = decidable.filter((n) => !n.blocked && !n.team);
  const clashes = decidable.filter((n) => n.team && !n.team.same);
  const blocked = notes.filter((n) => n.state === 'blocked' || (n.blocked && !n.team));
  const same = decidable.filter((n) => n.team && n.team.same);
  if (!ready.length && !clashes.length) wrap.appendChild(h(doc, 'div', 'hist-empty', 'Nothing to share: every note here is shared, on its way, or blocked.'));
  if (ready.length) {
    const sec = h(doc, 'section', 'mem-seed-sec mem-seed-ready');
    const head = h(doc, 'label', 'mem-seed-head');
    const all = h(doc, 'input', 'mem-seed-all'); all.type = 'checkbox';
    all.addEventListener('change', () => { for (const c of sec.querySelectorAll('.mem-seed-check')) c.checked = all.checked; });
    head.append(all, h(doc, 'b', '', `Share with the team (${ready.length})`));
    sec.appendChild(head);
    for (const n of ready) {
      const row = h(doc, 'label', 'mem-seed-pick');
      const cb = h(doc, 'input', 'mem-seed-check'); cb.type = 'checkbox'; cb.dataset.name = n.name; cb.dataset.hash = n.hash;
      row.append(cb, h(doc, 'span', 'mono', `${n.name}.md`), h(doc, 'span', 'mem-seed-desc', n.description || '(no description)'));
      sec.appendChild(row);
    }
    wrap.appendChild(sec);
  }
  if (clashes.length) {
    const sec = h(doc, 'section', 'mem-seed-sec mem-seed-clashes');
    sec.append(h(doc, 'b', '', `Same name on the team (${clashes.length})`),
      h(doc, 'small', 'hint', 'Keep mine replaces the team\'s version; Take team replaces yours here. A skipped note is held: none of its changes are shared until you pick one.'));
    clashes.forEach((n, i) => {
      const box = h(doc, 'div', 'mem-seed-clash');
      box.dataset.name = n.name; box.dataset.hash = n.hash; box.dataset.teamHash = n.team.hash;
      box.append(h(doc, 'div', 'mem-seed-clash-title mono', `${n.name}.md${n.state === 'held' ? ' — held' : ''}`), renderClashCompare(n, { doc }));
      const choices = h(doc, 'div', 'mem-seed-choices');
      for (const [value, label] of CLASH_CHOICES) {
        const l = h(doc, 'label', 'mem-seed-choice');
        const r = h(doc, 'input', ''); r.type = 'radio'; r.name = `mem-seed-${i}`; r.value = value; r.checked = value === 'skip';
        if (value === 'share' && n.blocked) { r.disabled = true; l.title = `The secret check blocks your version: ${n.blocked.reason}`; }
        if (value === 'take-team' && n.team.tooBig) { r.disabled = true; l.title = 'The team\'s version is over this machine\'s per-file cap.'; }
        l.append(r, doc.createTextNode(` ${label}`));
        choices.appendChild(l);
      }
      if (n.blocked) choices.appendChild(h(doc, 'small', 'hint', `Your version is blocked: ${n.blocked.reason}`));
      box.appendChild(choices);
      sec.appendChild(box);
    });
    wrap.appendChild(sec);
  }
  if (blocked.length) {
    const sec = h(doc, 'section', 'mem-seed-sec mem-seed-blocked');
    sec.appendChild(h(doc, 'b', '', `Blocked by the secret check — they stay on this machine (${blocked.length})`));
    for (const n of blocked) {
      const row = h(doc, 'div', 'mem-seed-pick');
      row.append(h(doc, 'span', 'mono', `${n.name}.md`), h(doc, 'span', 'mem-seed-desc', n.blocked?.reason || 'the secret check flagged it'));
      sec.appendChild(row);
    }
    wrap.appendChild(sec);
  }
  if (same.length) wrap.appendChild(h(doc, 'small', 'hint mem-seed-same', `Already on the team as they are: ${same.map((n) => `${n.name}.md`).join(', ')} — tracked at the next sync.`));
  wrap.appendChild(h(doc, 'small', 'hint', 'Worca snapshots this project\'s memory first. Undo seeding puts your notes back and pushes nothing; what it shared stays on the team.'));
  return wrap;
}

/** The decisions a seeding dialog holds: every ticked note (`share`) and every clash's choice. */
export function collectSeedDecisions(root) {
  const out = [];
  for (const cb of root.querySelectorAll('.mem-seed-check')) if (cb.checked) out.push({ name: cb.dataset.name, action: 'share', hash: cb.dataset.hash, teamHash: null });
  for (const box of root.querySelectorAll('.mem-seed-clash')) {
    const picked = box.querySelector('input[type="radio"]:checked');
    out.push({ name: box.dataset.name, action: picked ? picked.value : 'skip', hash: box.dataset.hash, teamHash: box.dataset.teamHash || null });
  }
  return out;
}
/** The toast after a seeding: what moved. A share counts as shared once the returned status shows it on the team; until
 *  then it waits to be pushed (its push failed, or another push carries it) — or the remote refused it (blocked). */
export function seedSummary(r) {
  const parts = [];
  const state = new Map((r?.status?.notes || []).map((n) => [n.name, n.state]));
  const shares = r?.shared || [];
  const on = shares.filter((n) => state.get(n) === 'shared').length;
  const refused = shares.filter((n) => state.get(n) === 'blocked').length;
  const blocked = (r?.blocked?.length || 0) + refused;
  if (on) parts.push(`${plural(on, 'note')} shared`);
  if (shares.length - on - refused) parts.push(`${plural(shares.length - on - refused, 'note')} waiting to be pushed`);
  if (r?.tookTeam?.length) parts.push(`${r.tookTeam.length} replaced by the team's version`);
  if (r?.held?.length) parts.push(`${r.held.length} held`);
  if (blocked) parts.push(`${blocked} blocked by the secret check`);
  return parts.join(' · ') || 'Nothing changed';
}
