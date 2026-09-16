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
  cb.setAttribute('aria-label', `Record my runs for ${s.name}`);
  label.append(cb, h(doc, 'span', 'switch switch-sm'), h(doc, 'span', 'txt', 'Record my runs'));
  return label;
}

export function renderProjectTmCell(s, { doc = globalThis.document } = {}) {
  const cell = h(doc, 'div', 'tm-cell');
  cell.dataset.key = s.key;
  const line = h(doc, 'div', 'tm-line');
  const status = h(doc, 'span', 'tm-status');
  const { kind } = projectTmState(s);
  const actions = h(doc, 'div', 'tm-actions');
  const runs = s.runs == null ? '' : ` · ${s.runs} run${s.runs === 1 ? '' : 's'}`;
  switch (kind) {
    case 'no-origin':
      status.classList.add('muted'); status.textContent = 'Not available · no origin remote';
      break;
    case 'off':
      status.classList.add('muted'); status.textContent = 'Off';
      actions.append(btn(doc, 'tm-enable', 'Enable…'));
      break;
    case 'delegate-invalid':
      line.append(dot(doc, 'red'));
      // The resolver's code distinguishes chain / unknown from dangling; dangling keeps the mockup copy.
      status.append(`Delegate invalid · points at `, code(doc, s.delegateTo),
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
      line.append(dot(doc, 'green'));
      status.append('On · recorded in ', code(doc, s.delegateTo), runs);
      actions.append(recordSwitch(doc, s));
      break;
    default:
      line.append(dot(doc, 'green'));
      status.textContent = `On · since ${dayLabel(s.enabledAt)}${s.runs == null ? '' : ` · ${s.runs} runs recorded`}`;
      actions.append(recordSwitch(doc, s));
  }
  // `enabled` alone is not enough: the fixture for the 'Not available · no origin remote' cell is
  // { enabled: true, hasOrigin: false }, and telling that user how to delete the team's branch is
  // both wrong and alarming. Only a cell that really points at a live branch gets the hint.
  if (s.enabled && s.hasOrigin !== false) status.title = DISABLE_HINT;
  line.prepend(h(doc, 'span', 'tm-label', 'Team metrics')); // board 4: row label before the status
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
      status.append(dot(doc, 'green'), `Team metrics on · since ${dayLabel(m.enabledAt)}${m.workspaceRuns == null ? '' : ` · ${m.workspaceRuns} workspace runs already there`}`);
      row.append(label, status);
    } else if (m.enabled && m.delegateTo) {
      status.append(dot(doc, 'grey'), `Delegates to ${m.delegateTo} · cannot host metrics`);
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

/** Workspace card "Metrics home" row (board 8). `ws` = /api/team-metrics/scopes → workspaces[]. */
export function renderWsMetricsRow(ws, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ws-home-inner');
  const row = h(doc, 'div', 'ws-home-row');
  row.append(h(doc, 'span', 'tm-label', 'Metrics home')); // board 8 row labels
  const home = ws.home || { state: 'unset' };
  if (home.state === 'unset') {
    row.append(h(doc, 'span', 'muted', 'Not set · workspace runs are not recorded'), btn(doc, 'ws-home-change', 'Choose…'));
    root.append(row);
    return root;
  }
  if (home.state === 'ok') {
    row.append(dot(doc, 'green'), h(doc, 'span', 'mono', home.slug), ' ', code(doc, 'origin/worca-metrics'));
    if (home.runs != null) row.append(h(doc, 'span', 'badge', `${home.runs} runs`));
  } else {
    row.append(dot(doc, 'red'), h(doc, 'span', 'mono', home.slug), h(doc, 'span', 'badge red', home.detail || 'stale'),
      h(doc, 'small', 'hint mono', 'workspace runs are not being recorded'));
  }
  row.append(btn(doc, 'ws-home-change', 'Change…'));
  root.append(row);
  if (home.state === 'ok') {
    const c = ws.counts || {};
    const m = h(doc, 'div', 'ws-home-members');
    m.append(h(doc, 'span', 'tm-label', 'Members'));
    const text = h(doc, 'span', 'ws-home-members-text');
    text.append(`${c.recordsHere ?? 0} records here · `, h(doc, 'b', null, String(c.routed ?? 0)), ` routed to the home · ${c.notRecording ?? 0} not recording`);
    const why = (ws.members || []).filter((x) => x.state === 'not-recording' || x.state === 'records-elsewhere').map((x) => `${x.slug} ${x.reason === 'no origin remote' ? 'has no origin remote' : x.reason}`);
    const names = ws.notRecordingNames || why;
    if (names.length) text.append(' ', code(doc, `(${names.join('; ')})`));
    m.append(text, btn(doc, 'ws-route', 'Route all members here'));
    root.append(m, h(doc, 'div', 'ws-route-results'));
  }
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
