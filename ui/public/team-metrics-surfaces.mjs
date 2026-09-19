// ui/public/team-metrics-surfaces.mjs
// Pure DOM renderers for the team-metrics switches outside the page (§4.11): Projects cell,
// Enable dialog body, metrics-home picker (wizard step + Change sheet), workspace card row.
// Like stats-view.mjs: no fetch, no listeners — app.js delegates events.

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DISABLE_HINT = 'Disable for the whole team: git push origin --delete worca-metrics';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const dayLabel = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${MO[d.getUTCMonth()]} ${d.getUTCDate()}` : ''; };
const dot = (doc, tone) => { const d = h(doc, 'span', `dot tm-dot ${tone}`); d.setAttribute('aria-hidden', 'true'); return d; };
const code = (doc, text) => h(doc, 'code', 'mono', text);
/** A project, workspace or home NAME inside prose: bold and mono, so it reads as a name, not a word. */
const ref = (doc, name) => h(doc, 'b', 'ref mono', name);
/** `text` with every occurrence of `name` rendered as a ref; plain text when the name is absent. */
function withRef(doc, text, name) {
  const frag = doc.createDocumentFragment();
  if (!name || !String(text).includes(name)) { frag.append(String(text)); return frag; }
  const parts = String(text).split(name);
  parts.forEach((part, i) => { if (i) frag.append(ref(doc, name)); if (part) frag.append(part); });
  return frag;
}
function btn(doc, cls, text) { const b = h(doc, 'button', `btn-ghost btn-mini ${cls}`, text); b.type = 'button'; return b; }

/** Classify a project status (from /api/team-metrics/scopes → projects[]) into a cell variant. */
export function projectTmState(s) {
  if (s.hasOrigin === false) return { kind: 'no-origin' };
  if (!s.enabled) return { kind: 'off' };
  if (s.delegateTo && s.delegateState === 'invalid') return { kind: 'delegate-invalid' };
  // Enabled, but the sink could not be resolved (e.g. CONFIG_UNKNOWN — the branch exists but has
  // never been fetched). Runs are being skipped, so the cell must not read plain "On".
  if (s.blocked) return { kind: 'blocked' };
  if (s.lastError && s.pending > 0) return { kind: 'rejected' }; // nothing pending → nothing to retry
  if (s.pending > 0) return { kind: 'pending' };
  if (s.delegateTo) return { kind: 'delegated' };
  return { kind: 'on' };
}

function recordSwitch(doc, s) {
  const label = h(doc, 'label', 'switch-row tm-record-row');
  const cb = h(doc, 'input', 'sw-input tm-record');
  cb.type = 'checkbox';
  cb.checked = s.record !== false;
  cb.dataset.key = s.key;
  // Personal, per-machine opt-out — worded as a share choice so it reads as
  // distinct from the team-level setup button of the Off state.
  cb.setAttribute('aria-label', `Include my runs for ${s.name}`);
  label.append(cb, h(doc, 'span', 'switch switch-sm'), h(doc, 'span', 'txt', 'Include my runs'));
  return label;
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/**
 * One project's team-metrics state in a few words: `short` is what a row chip and the project
 * page's stat card show ("on · 3 runs", "via acme/gateway", "push failed"), `detail` the sentence
 * behind it, `tone` the dot colour. The full cell (renderProjectTmCell) says the same at length.
 */
export function projectTmSummary(s) {
  const { kind } = projectTmState(s);
  const excluded = s.record === false;
  const runs = s.runs == null ? '' : `${s.runs} run${s.runs === 1 ? '' : 's'}`;
  const since = s.enabledAt ? `since ${dayLabel(s.enabledAt)}` : '';
  switch (kind) {
    case 'no-origin': return { kind, tone: 'muted', short: 'not available', detail: s.noGit ? 'not a git repository' : 'no origin remote' };
    case 'off': return { kind, tone: 'grey', short: 'off', detail: 'runs stay on this machine' };
    case 'delegate-invalid': return { kind, tone: 'red', short: 'delegate invalid', detail: `points at ${s.delegateTo} · runs are not being recorded` };
    case 'blocked': return { kind, tone: 'amber', short: 'on · not recording', detail: s.delegateCode === 'CONFIG_UNKNOWN' ? 'branch not read yet' : (s.delegateDetail || 'the metrics branch could not be resolved') };
    case 'rejected': return { kind, tone: 'red', short: 'push failed', detail: s.lastErrorCode === 'PUSH_REJECTED' && s.lastErrorHint ? 'branch protection' : String(s.lastError || '').trim().split('\n')[0] };
    case 'pending': return { kind, tone: 'amber', short: `on · ${s.pending} pending push`, detail: since };
    case 'delegated': return { kind, tone: excluded ? 'grey' : 'green', short: excluded ? `via ${s.delegateTo} · yours excluded` : `via ${s.delegateTo}`, ref: s.delegateTo, detail: [runs ? `${runs} recorded` : '', 'recorded in that project\'s branch'].filter(Boolean).join(' · ') };
    default: return { kind, tone: excluded ? 'grey' : 'green', short: excluded ? 'on · yours excluded' : (runs ? `on · ${runs}` : 'on'), detail: since };
  }
}

/**
 * The Projects-row chip: a dot, the word and the short state — no controls, no hints. Everything
 * it leaves out is on the project page's Team tab (renderProjectTmCell). Expert-level like the
 * page tab; the row itself is the only control.
 */
export function renderProjectTmChip(s, { doc = globalThis.document } = {}) {
  const chip = h(doc, 'span', 'pl-team-item pl-tm');
  chip.dataset.key = s.key;
  const sum = projectTmSummary(s);
  chip.dataset.kind = sum.kind;
  if (sum.tone !== 'muted') chip.append(dot(doc, sum.tone));
  const state = h(doc, 'span', `pl-team-state${sum.tone === 'muted' ? ' muted' : ''}`);
  state.append(withRef(doc, sum.short, sum.ref));
  chip.append(h(doc, 'span', 'pl-team-name', 'Metrics'), ' ', state);
  chip.title = `Team metrics: ${cap(sum.short)}${sum.detail ? ` · ${sum.detail}` : ''}`;
  return chip;
}

/**
 * The project page's team-metrics block (and, before this branch, the Projects-list cell): a
 * fixed two-row grid — the "Team metrics" title over a status line on the left, and ONE control
 * column on the right that spans both rows (see .tm-cell in style.css). The control never wraps
 * under the status. `heading: false` drops the title when a panel head already names it.
 */
export function renderProjectTmCell(s, { doc = globalThis.document, heading = true } = {}) {
  const cell = h(doc, 'div', 'tm-cell');
  cell.dataset.key = s.key;
  if (heading) cell.append(h(doc, 'span', 'tm-label', 'Team metrics'));
  const line = h(doc, 'div', 'tm-line');
  const status = h(doc, 'span', 'tm-status');
  const { kind } = projectTmState(s);
  const actions = h(doc, 'div', 'tm-actions');
  const runs = s.runs == null ? '' : ` · ${s.runs} run${s.runs === 1 ? '' : 's'}`;
  const excluded = s.record === false;   // personal opt-out (the "Include my runs" switch)
  switch (kind) {
    case 'no-origin':
      status.classList.add('muted');
      status.textContent = s.noGit ? 'Not available · not a git repository' : 'Not available · no origin remote';
      break;
    case 'off':
      // Team-level setup (creates the shared branch on origin): a button that names
      // the feature, never a switch — turning it off again is not a one-click action.
      status.classList.add('muted'); status.textContent = 'Off · runs stay on this machine';
      actions.append(btn(doc, 'tm-enable', 'Set up team metrics…'));
      break;
    case 'delegate-invalid':
      line.append(dot(doc, 'red'));
      // The resolver's code distinguishes chain / unknown from dangling; dangling keeps the mockup copy.
      status.append(`Delegate invalid · points at `, ref(doc, s.delegateTo),
        s.delegateCode === 'DELEGATE_CHAIN' ? ', which itself delegates (no chains)'
          : s.delegateCode === 'DELEGATE_UNKNOWN' ? ', which is not a project in Worca on this machine'
            : ', which no longer records');
      actions.append(btn(doc, 'tm-change', 'Change…'));
      break;
    case 'blocked':
      line.append(dot(doc, 'amber'));
      status.textContent = s.delegateCode === 'CONFIG_UNKNOWN'
        ? 'On · branch not read yet · runs are not being recorded'
        : `On · ${s.delegateDetail || 'the metrics branch could not be resolved'}`;
      break;
    case 'rejected': {
      line.append(dot(doc, 'red'));
      status.textContent = s.lastErrorCode === 'PUSH_REJECTED' && s.lastErrorHint ? 'Push rejected · branch protection' : 'Push failed';
      actions.append(btn(doc, 'tm-push', 'Retry'));
      break;
    }
    case 'pending':
      line.append(dot(doc, 'amber'));
      status.textContent = `On · since ${dayLabel(s.enabledAt)}`;
      break;
    case 'delegated':
      // "Include my runs" off is a personal opt-out: the branch stays on for the team, so
      // the status says so instead of a green "On" that would read as "my runs are in".
      line.append(dot(doc, excluded ? 'grey' : 'green'));
      // Kept short: the status shares ~220px with the switch (see .tm-status), so the
      // opted-out copy leads with what matters and drops the run count.
      if (excluded) status.append('On for the team · in ', ref(doc, s.delegateTo), ' · yours excluded');
      else status.append('On · recorded in ', ref(doc, s.delegateTo), runs);
      actions.append(recordSwitch(doc, s));
      break;
    default:
      line.append(dot(doc, excluded ? 'grey' : 'green'));
      status.textContent = excluded
        ? 'On for the team · yours excluded'
        : `On · since ${dayLabel(s.enabledAt)}${runs ? `${runs} recorded` : ''}`;   // "· 1 run recorded"
      actions.append(recordSwitch(doc, s));
  }
  // `enabled` alone is not enough: the fixture for the 'Not available · no origin remote' cell is
  // { enabled: true, hasOrigin: false }, and telling that user how to delete the team's branch is
  // both wrong and alarming. Only a cell that really points at a live branch gets the hint.
  if (s.enabled && s.hasOrigin !== false) status.title = DISABLE_HINT;
  line.append(status);
  if (kind === 'pending') {
    line.append(h(doc, 'span', 'badge amber', `${s.pending} pending push`));
    actions.append(btn(doc, 'tm-push', 'Push now'));
  }
  cell.append(line);
  if (kind === 'rejected') {
    const hint = h(doc, 'small', 'hint mono tm-hint');
    hint.append(String(s.lastError || '').trim().split('\n')[0]);
    if (s.lastErrorHint) hint.append(' · ', s.lastErrorHint);
    cell.append(hint);
  }
  if (kind === 'delegate-invalid') cell.append(h(doc, 'small', 'hint mono tm-hint', 'runs are not being recorded · pick a new target'));
  // This project is a workspace's metrics home: its switch also decides whether THIS
  // machine's runs of that workspace are recorded (docs/team-metrics.md, "Include my runs").
  if (s.enabled && Array.isArray(s.homeFor) && s.homeFor.length) {
    const names = s.homeFor.join(', ');
    const hint = h(doc, 'small', 'hint tm-hint tm-home-for');
    hint.append('Metrics home for ');
    s.homeFor.forEach((x, i) => { if (i) hint.append(', '); hint.append(ref(doc, x)); });
    hint.append(' · "Include my runs" covers its workspace runs too');
    hint.title = `Workspace runs of ${names} are written to this project's branch. Turning "Include my runs" off here also stops your workspace runs from being recorded.`;
    cell.append(hint);
  }
  if (actions.childNodes.length) cell.append(actions);
  return cell;
}

function radioCard(doc, { name, value, checked, title, body, disabled = false }) {
  const card = h(doc, 'label', `radio-card${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`);
  const input = h(doc, 'input');
  input.type = 'radio'; input.name = name; input.value = value; input.checked = !!checked; input.disabled = disabled;
  const text = h(doc, 'span', 'radio-card-text');
  text.append(h(doc, 'b', null, title));
  const p = h(doc, 'small', 'hint');
  for (const part of body) p.append(typeof part === 'string' ? part : code(doc, part.code));
  text.append(p);
  card.append(input, text);
  return card;
}

/** Enable dialog body (boards 5 + 6). mode: 'here' | 'delegate'. */
export function renderEnableDialogBody({ project, origin, candidates = [], mode = 'here', attribution = 'git-user', change = false }, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'tm-enable-body');
  const sub = h(doc, 'div', 'sub');
  sub.append('for ', h(doc, 'b', null, project.name), ' · origin ', code(doc, origin || '—'));
  root.append(sub);

  const where = h(doc, 'div', 'field');
  where.append(h(doc, 'label', null, 'Where to record'));
  // change:true is the "Change…" action on an invalid delegation marker. "Here" would POST
  // {mode:'here'} against a branch that already exists, which enable answers with 'joined' — the
  // dialog would close as if it had worked while the delegation stayed broken.
  where.append(radioCard(doc, { name: 'tm-where', value: 'here', checked: mode === 'here' && !change, disabled: change, title: 'Here, on this repository',
    body: ['Creates an orphan branch ', { code: 'worca-metrics' }, ' on origin holding only ', { code: '.worca-metrics/' }, '. Every finished run — done, failed or stopped — is pushed there as one file, by every teammate whose Worca sees the branch.'] }));
  const delegateCard = radioCard(doc, { name: 'tm-where', value: 'delegate', checked: mode === 'delegate', disabled: candidates.length === 0,
    title: 'In another project that already records',
    body: ["A tiny marker branch on this origin points teammates at the target. This project's single-project runs land on the target's branch, still labelled with this project."] });
  where.append(delegateCard);
  if (mode === 'delegate') {
    const sel = h(doc, 'select', 'select tm-delegate-target');
    sel.setAttribute('aria-label', 'Target project');
    for (const c of candidates) { const o = h(doc, 'option', null, c.label); o.value = c.slug; sel.append(o); }
    const wrap = h(doc, 'div', 'select-wrap tm-delegate-wrap');
    wrap.append(sel);
    delegateCard.append(wrap);
    delegateCard.append(h(doc, 'small', 'hint', "Only projects that record locally are listed. Attribution follows the target's policy (git user name)."));
  }
  if (change) where.append(h(doc, 'small', 'hint', 'This project already has a marker branch — pick a new target.'));
  if (!candidates.length) where.append(h(doc, 'small', 'hint', 'No project records locally yet — record here first, then point other projects at it.'));
  root.append(where);

  if (mode === 'here') {
    const attr = h(doc, 'div', 'field');
    attr.append(h(doc, 'label', null, 'Attribution'));
    attr.append(radioCard(doc, { name: 'tm-attribution', value: 'git-user', checked: attribution !== 'none', title: 'Record the git user name',
      body: ['Each record carries who ran it, so spend can be sliced per person. Visible to anyone with read access to the repository.'] }));
    attr.append(radioCard(doc, { name: 'tm-attribution', value: 'none', checked: attribution === 'none', title: 'No attribution',
      body: ['Records carry no person. Breakdowns by actor are unavailable for this project.'] }));
    attr.append(h(doc, 'small', 'hint', 'A team decision, made once. Changing it later means committing to the branch by hand.'));
    root.append(attr);
  }
  const warn = h(doc, 'div', 'hint tm-warn');
  warn.append('If your repository protects branches by wildcard, exempt ', code(doc, 'worca-metrics'), ' first — Worca pushes to it directly, without a pull request.');
  root.append(warn);
  return root;
}

/** Metrics-home picker (board 7 list; reused in the card's Change sheet). */
export function renderMetricsHomePicker(members, { selectedPath, doc = globalThis.document } = {}) {
  const list = h(doc, 'div', 'wiz-list tm-home-list');
  const recording = members.filter((m) => m.hasOrigin && m.recordsLocally);
  const selected = selectedPath !== undefined ? selectedPath : (recording.length === 1 ? recording[0].path : null);
  for (const m of members) {
    const row = h(doc, 'div', `wiz-row${m.hasOrigin ? '' : ' off'}`);
    row.dataset.path = m.path;
    row.dataset.key = m.key || '';
    const name = h(doc, 'span', 'wiz-row-name mono', m.slug);
    const status = h(doc, 'span', 'wiz-row-status');
    if (!m.hasOrigin) {
      status.textContent = 'No origin remote · cannot host metrics';
      row.append(name, status);
    } else if (m.recordsLocally) {
      const label = h(doc, 'label', 'wiz-row-pick');
      const r = h(doc, 'input');
      r.type = 'radio'; r.name = 'tm-home'; r.value = m.path; r.checked = selected === m.path;
      label.append(r, name);
      // Two lines in a fixed-width column so every row's status starts at the same x: the
      // sheet is 600px wide and the slug on the left must stay whole.
      const lines = h(doc, 'span', 'wiz-row-status-lines');
      lines.append(h(doc, 'span', 'wiz-row-status-main', `On · since ${dayLabel(m.enabledAt)}`));
      if (m.workspaceRuns != null) lines.append(h(doc, 'span', 'wiz-row-status-sub', `${m.workspaceRuns} workspace run${m.workspaceRuns === 1 ? '' : 's'} recorded`));
      status.append(dot(doc, 'green'), lines);
      row.append(label, status);
    } else if (m.enabled && m.delegateTo) {
      status.append(dot(doc, 'grey'), 'Delegates to ', ref(doc, m.delegateTo), ' · cannot host metrics');
      row.classList.add('off');
      row.append(name, status);
    } else {
      status.append(dot(doc, 'grey'), 'Not enabled');
      row.append(name, status, btn(doc, 'tm-enable-now', 'Enable now…'));
    }
    list.append(row);
  }
  return list;
}

/** Rows shown before "Show N more" — a 50-project workspace must not become a 50-row card. */
export const WS_MEMBERS_COLLAPSED = 6;
// Home first, then members that need attention, then the ones already routed; stable otherwise.
const MEMBER_RANK = { home: 0, 'not-recording': 1, 'records-elsewhere': 1, routed: 2 };
const sortMembers = (members) => members.map((x, i) => [x, i]).sort((a, b) => ((MEMBER_RANK[a[0].state] ?? 1) - (MEMBER_RANK[b[0].state] ?? 1)) || (a[1] - b[1])).map(([x]) => x);
const needsAttention = (x) => x.state !== 'home' && x.state !== 'routed';
// Routing only touches members with no worca-metrics branch: one that already records on its
// own branch, delegates elsewhere or has no origin is skipped, so the button would do nothing.
const routable = (x) => x.state === 'not-recording' && x.reason !== 'no origin remote';

const SVG = 'http://www.w3.org/2000/svg';
/** The Team metrics sidebar icon, inline: marks the metrics home without labelling the project "home". */
export function tmIcon(doc) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'tm-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.9'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ['M4 19h16', 'M6 15l4-5 4 3 4-6']) { const path = doc.createElementNS(SVG, 'path'); path.setAttribute('d', d); svg.append(path); }
  for (const [cx, cy] of [[6, 15], [10, 10], [14, 13], [18, 7]]) { const c = doc.createElementNS(SVG, 'circle'); c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', '1.2'); svg.append(c); }
  return svg;
}
const HOME_TITLE = 'Metrics home: workspace runs are recorded on this project\'s worca-metrics branch';
/** The icon with its tooltip on a wrapper (an SVG <title> would leak into textContent). */
function homeMark(doc) {
  const m = h(doc, 'span', 'tm-home-mark');
  m.title = HOME_TITLE; m.setAttribute('role', 'img'); m.setAttribute('aria-label', 'Metrics home');
  m.append(tmIcon(doc));
  return m;
}

/**
 * Header summary (collapsed card): "3 projects · ⌇ acme/gateway · 12 workspace runs · 2 not recording".
 * Answers what people scan for — how big, where runs go, is anything wrong — on one line.
 */
export function renderWsSummary(ws, { doc = globalThis.document, pending = false } = {}) {
  let frag = doc.createDocumentFragment();
  const n = (ws.projectPaths || ws.members || []).length;
  frag.append(`${n} project${n === 1 ? '' : 's'}`);
  // Everything after the count is team-metrics state: expert detail (docs/ui-levels.md), so it rides
  // one tagged span the stylesheet can drop. `frag` is re-pointed so the appends below land in it.
  const out = frag;
  const tm = h(doc, 'span', 'ws-sum-tm');
  tm.dataset.minLevel = 'expert';
  out.append(tm);
  frag = tm;
  // The scopes call is still out: say so instead of "no metrics home", which reads as final.
  if (pending) { frag.append(' · ', h(doc, 'span', 'ws-sum-pending', 'checking metrics…')); return out; }
  const home = ws.home || { state: 'unset' };
  if (home.state === 'unset') {
    frag.append(' · ', h(doc, 'span', 'muted', 'no metrics home'));
  } else {
    frag.append(' · ', homeMark(doc), ref(doc, home.slug));
    if (home.state !== 'ok') frag.append(' · ', h(doc, 'span', 'ws-sum-bad', home.detail || 'stale'));
    else if (home.runs != null) frag.append(` · ${home.runs} workspace run${home.runs === 1 ? '' : 's'}`); // project-level runs live elsewhere
  }
  const silent = (ws.members || []).filter((x) => x.state !== 'home' && !x.recordsOn).length;
  if (silent) frag.append(' · ', h(doc, 'span', 'ws-sum-warn', `${silent} not recording`));
  return out;
}

/** One table cell: what this member's metrics branch is, or that there is none. */
function branchCell(doc, x, home) {
  const td = h(doc, 'td', 'ws-col-branch');
  if (!x.recordsOn) { td.append(h(doc, 'span', 'muted', x.reason === 'no origin remote' ? 'no origin remote' : 'not set')); return td; }
  if (x.recordsOn.toLowerCase() === (x.slug || '').toLowerCase()) td.append(code(doc, 'origin/worca-metrics'));
  else td.append(code(doc, 'worca-metrics'), ' on ', code(doc, x.recordsOn));
  return td;
}
/** "Workspace runs" column: the count on the home row, "–" everywhere else. */
function runsCell(doc, x, home) {
  const td = h(doc, 'td', 'ws-col-runs');
  if (x.state === 'home' && home.runs != null) td.textContent = String(home.runs);
  else td.append(h(doc, 'span', 'muted', '–'));
  return td;
}
/** ✓ / ✗ glyph for a metrics line. */
function mark(doc, tone) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `ws-mark ${tone}`); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.4'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  for (const d of (tone === 'bad' ? ['M6 6l12 12', 'M18 6L6 18'] : ['M5 12.5l4.5 4.5L19 7'])) { const path = doc.createElementNS(SVG, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
const metricLine = (doc, tone, text) => { const l = h(doc, 'span', `ws-metric ${tone}`); l.append(mark(doc, tone), text); return l; };
/**
 * "Metrics status": which metrics this project has — "–" (no branch), "Project metrics",
 * "Workspace metrics", or both with workspace first. Routing is a consolidation detail (the
 * branch column says where), not a status.
 */
function statusCell(doc, x, home) {
  const td = h(doc, 'td', 'ws-col-status');
  if (x.state === 'home') {
    if (home.state === 'ok') td.append(metricLine(doc, 'ok', 'Workspace metrics'), metricLine(doc, 'ok', 'Project metrics'));
    else td.append(metricLine(doc, 'bad', `Workspace metrics · ${home.detail || 'stale'}`));
  } else if (x.recordsOn) td.append(metricLine(doc, 'ok', 'Project metrics'));
  else td.append(h(doc, 'span', 'muted', '–'));
  return td;
}

/**
 * Workspace card body (board 8, reworked): ONE projects table — project, metrics branch, status —
 * with the metrics home marked by the Team metrics icon, plus the actions that act on it.
 * `ws` = /api/team-metrics/scopes → workspaces[].
 */
/**
 * The card's metrics block while /scopes is still out: the same head and table, one row per
 * member path with shimmer bars where the branch, runs and status will land. Replaced by
 * renderWsMetricsRow as soon as the statuses arrive (or by the plain summary when the workspace
 * has none). Decorative: the card carries aria-busy for assistive tech.
 */
export function renderWsMetricsPending(ws, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ws-home-inner is-pending');
  root.setAttribute('aria-hidden', 'true');
  const paths = ws.projectPaths || [];
  const head = h(doc, 'div', 'ws-tbl-head');
  head.append(h(doc, 'span', 'tm-label', 'Projects'), h(doc, 'span', 'badge', String(paths.length)));
  root.append(head);
  const table = h(doc, 'table', 'ws-projects-tbl');
  const thead = h(doc, 'thead'); const hr = h(doc, 'tr');
  // Project → status (is it recording?) → branch (where) → runs (a number, on the right edge).
  hr.append(h(doc, 'th', null, 'Project'), h(doc, 'th', null, 'Metrics status'), h(doc, 'th', null, 'Metrics branch'), h(doc, 'th', 'ws-col-runs', 'Workspace runs'));
  thead.append(hr); table.append(thead);
  const tbody = h(doc, 'tbody');
  paths.slice(0, WS_MEMBERS_COLLAPSED).forEach((path) => {
    const tr = h(doc, 'tr', 'ws-member is-pending');
    tr.dataset.path = path;
    const name = h(doc, 'td', 'ws-col-project');
    name.append(h(doc, 'span', 'mono ws-member-slug', String(path).split(/[\\/]/).filter(Boolean).pop() || path));
    const cell = (cls, w) => { const td = h(doc, 'td', cls); td.append(h(doc, 'span', `skel ${w}`)); return td; };
    tr.append(name, cell('ws-col-status', 'w60'), cell('ws-col-branch', 'w70'), cell('ws-col-runs', 'w25'));
    tbody.append(tr);
  });
  table.append(tbody);
  root.append(table);
  return root;
}

export function renderWsMetricsRow(ws, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ws-home-inner');
  const home = ws.home || { state: 'unset' };
  const members = sortMembers(ws.members || []);

  const head = h(doc, 'div', 'ws-tbl-head');
  head.append(h(doc, 'span', 'tm-label', 'Projects'), h(doc, 'span', 'badge', String(members.length)));
  const collapsed = members.length > WS_MEMBERS_COLLAPSED;
  if (collapsed) {
    // The hidden rows still count: say what they add up to.
    const routed = members.filter((x) => x.state === 'routed').length;
    head.append(h(doc, 'span', 'ws-members-summary', `${routed} routed · ${members.filter(needsAttention).length} not routed`));
  }
  const actions = h(doc, 'span', 'ws-tbl-actions');
  if (home.state !== 'unset' && members.some(routable)) actions.append(btn(doc, 'ws-route', 'Route all to metrics home'));
  actions.append(btn(doc, 'ws-home-change', home.state === 'unset' ? 'Choose metrics home…' : 'Change metrics home…'));
  head.append(actions);
  root.append(head);

  const table = h(doc, 'table', 'ws-projects-tbl');
  const thead = h(doc, 'thead'); const hr = h(doc, 'tr');
  // Project → status (is it recording?) → branch (where) → runs (a number, on the right edge).
  hr.append(h(doc, 'th', null, 'Project'), h(doc, 'th', null, 'Metrics status'), h(doc, 'th', null, 'Metrics branch'), h(doc, 'th', 'ws-col-runs', 'Workspace runs'));
  thead.append(hr); table.append(thead);
  const tbody = h(doc, 'tbody');
  members.forEach((x, i) => {
    const tr = h(doc, 'tr', `ws-member ${x.state}`);
    tr.dataset.path = x.path || '';
    if (collapsed && i >= WS_MEMBERS_COLLAPSED) tr.hidden = true;
    // No icon in this column: every project name starts at the same x. The home is told by
    // its status ("Records workspace runs") and by the icon in the card's header summary.
    const name = h(doc, 'td', 'ws-col-project');
    name.append(h(doc, 'span', 'mono ws-member-slug', x.slug));
    tr.append(name, statusCell(doc, x, home), branchCell(doc, x, home), runsCell(doc, x, home));
    tbody.append(tr);
  });
  table.append(tbody);
  root.append(table);
  if (collapsed) {
    const rest = members.length - WS_MEMBERS_COLLAPSED;
    const more = btn(doc, 'ws-members-more', `Show ${rest} more`);
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', (e) => {
      e.stopPropagation(); // the card header toggles the card on click
      const open = more.getAttribute('aria-expanded') !== 'true';
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Show less' : `Show ${rest} more`;
      [...tbody.children].forEach((tr, i) => { if (i >= WS_MEMBERS_COLLAPSED) tr.hidden = !open; });
    });
    root.append(more);
  }

  // Only the cases that need a sentence: no home, a stale home, or the home's "Include my runs" off.
  if (home.state === 'unset') {
    root.append(h(doc, 'small', 'hint ws-home-hint', 'Workspace runs are not recorded until a metrics home is chosen. The home is a per-machine choice; the Team metrics page reads every recording member.'));
  } else if (home.state !== 'ok') {
    const you = h(doc, 'small', 'hint ws-home-hint warn');
    you.append(dot(doc, 'red'), ` Workspace runs are not being recorded: ${home.detail || 'the metrics home is stale'}.`);
    root.append(you);
  } else if (home.record === false) {
    const you = h(doc, 'small', 'hint ws-home-hint warn');
    you.append(dot(doc, 'amber'), ' Your workspace runs are not recorded: "Include my runs" is off on ', ref(doc, home.slug), '.');
    root.append(you);
  }
  root.append(h(doc, 'div', 'ws-route-results'));
  return root;
}

export function renderRouteResults({ results = [] }, { doc = globalThis.document } = {}) {
  const ul = h(doc, 'ul', 'tm-route-list');
  for (const r of results) {
    const li = h(doc, 'li', r.result);
    li.append(h(doc, 'span', 'mono', r.slug), ` · ${r.result}${r.reason ? ` · ${r.reason}` : ''}${r.error ? ` · ${r.error}` : ''}`);
    if (r.stderr) li.append(h(doc, 'pre', 'hint mono tm-stderr', r.stderr.trim()));
    if (r.hint) li.append(h(doc, 'small', 'hint', r.hint));
    ul.append(li);
  }
  return ul;
}
