// ui/public/actions-view.mjs — Actions (issue #529): pure renderers + one live controller.
// Every renderer takes `doc` explicitly and returns detached DOM; no colour literals, no innerHTML with data.
export const TERMINAL = new Set(['exited', 'failed', 'stopped']);
const ACTIVE = new Set(['starting', 'running', 'ready']);
const LOG_TAIL = 400;
function h(doc, tag, cls, text) { const el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }

// In-app pages an Actions message names. appendWithPageLinks keeps the message's words and turns each
// page name into a link to it; `extra` adds [label, href] pairs for this message (a project's own tab).
const PAGE_LINKS = [['Settings › Runs › Actions', '#settings/runs/actions']];
export function appendWithPageLinks(doc, el, text, extra = []) {
  const links = [...extra, ...PAGE_LINKS];
  let rest = String(text ?? '');
  while (rest) {
    const hit = links.map(([label, href]) => ({ label, href, i: rest.indexOf(label) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0];
    if (!hit) { el.append(rest); break; }
    if (hit.i) el.append(rest.slice(0, hit.i));
    const a = h(doc, 'a', 'act-page-link', hit.label);
    a.href = hit.href;
    el.append(a);
    rest = rest.slice(hit.i + hit.label.length);
  }
  return el;
}
/** The project's own Actions tab, where its setup and actions are edited. */
export const projectActionsHref = (key) => `#projects/${encodeURIComponent(key)}/actions`;
// `tip`: what the button does, on hover (every command on the Actions surfaces says it).
const btn = (doc, label, cls, onClick, tip) => { const b = h(doc, 'button', `btn ${cls ? `${cls} ` : ''}btn-sm`, label); b.type = 'button'; if (tip) b.title = tip; if (onClick) b.addEventListener('click', onClick); return b; };
/** Hover text of a built-in: what it opens, and where. */
const builtinTip = (key, label, where = 'the checkout') => (key === 'editor' ? `Open ${where} in ${label}`
  : key === 'terminal' ? `Open ${label} in ${where}` : key === 'fileManager' ? `Show ${where} in ${label}` : label);
const actionTip = (a) => (a.kind === 'service' ? `Start ${a.label}. It keeps running; its log and Open link show below.` : `Run ${a.label} to the end. Its exit code and log show below.`);
const portOf = (s) => Object.values(s.ports || {})[0];
/** "Run :4417", or just "Run" for a service without a port variable (never "Run :undefined"). Used by the
 *  pill, the sidebar's Running actions rows and the "Running :4417" History badge alike. */
export const withPort = (text, s) => (portOf(s) != null ? `${text} :${portOf(s)}` : text);

export function formatUptime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function estimateText(ms, hasSetup) {
  if (ms) return `about ${ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`}`;
  return hasSetup ? 'usually under a minute' : 'a few seconds';
}

/** D24: the renderer re-checks every link, whatever the server stored. */
export function isSafeHref(u) {
  if (typeof u !== 'string') return false;
  try { const p = new URL(u.trim()); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
}
/** An open link: http(s) only, new tab, no opener. Returns null for anything else. */
export function openLink(doc, url, text) {
  if (!isSafeHref(url)) return null;
  const a = h(doc, 'a', 'act-open', text || url);
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  return a;
}

export function memberViewState(m, instances) {
  if (!m.branch) return 'no-branch';
  if (!m.checkout) return 'not-checked-out';
  const mine = instances.filter((s) => s.member === m.projectKey);
  const setup = m.checkout.setup?.status;
  // D25: `pending` alone means "not run yet" (a kept checkout waits for its first action), not "running now".
  if (setup === 'running' || m.setupQueued || mine.some((s) => s.actionId === '__setup' && ACTIVE.has(s.status))) return 'setting-up';
  if (setup === 'failed' || setup === 'interrupted') return 'setup-failed';
  if (mine.some((s) => s.kind === 'service' && ACTIVE.has(s.status))) return 'running';
  if (mine.some((s) => s.kind === 'task' && s.actionId !== '__setup')) return 'task-result';
  return 'ready';
}

export function renderRunPill(instances, { doc, onClick } = {}) {
  const s = instances.find((x) => x.kind === 'service' && ACTIVE.has(x.status));
  if (!s) return null;
  const b = h(doc, 'button', 'pill-run green act-pill', null); b.type = 'button';
  b.append(h(doc, 'span', 'pdot'), doc.createTextNode(withPort(s.label, s)));
  if (onClick) b.addEventListener('click', () => onClick(s));
  return b;
}

const STATE_TEXT = {
  'no-branch': 'No branch', 'not-checked-out': 'Not checked out', 'setting-up': 'Setting up',
  'setup-failed': 'Setup failed', ready: 'Checked out', running: 'Running', 'task-result': 'Checked out',
};
const POLICY_TEXT = { 'on-success': 'on success', 'until-pr': 'until PR' };
const instancesOf = (model, pk) => (model.instances || []).filter((s) => s.member === pk);
const activeService = (list, actionId) => list.find((s) => s.kind === 'service' && ACTIVE.has(s.status) && (actionId == null || s.actionId === actionId));
const latest = (list) => list.reduce((a, s) => (!a || (s.startedAt || 0) >= (a.startedAt || 0) ? s : a), null);
const labelOf = (m, s) => s.label || m?.actions?.find((a) => a.id === s.actionId)?.label || s.actionId;

/** The log tail of one instance as a `<pre class="act-log">`; action-line frames append to it in place. */
function renderLog(doc, instanceId, lines) {
  const pre = h(doc, 'pre', 'act-log');
  pre.dataset.instanceId = instanceId;
  for (const l of lines || []) pre.append(logLine(doc, l));
  return pre;
}
function logLine(doc, l) { return h(doc, 'span', l.stream === 'out' ? null : l.stream, `${l.text}\n`); }

/** Long branch names and paths keep both ends (the run id is at the end): "worca-cc/github-…-da7d143d". */
export function middleClip(text, max = 56) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.55);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`;
}
/** A member the run changed: the only ones the tab offers. `affected: null` means its facts could not
 *  be decided (a legacy run, or one still going) — treat that as changed and offer it, rather than
 *  silently hiding work. Keep in step with the `offered` predicate in ui/server.mjs's actions route. */
export const isChangedMember = (m) => m.affected !== false && (m.state !== 'no-branch' || m.workMode === 'folder');

/** Ticked when the table first opens: every changed member not already sitting in a folder of your
 *  own, up to five. Past five, one click would start a long setup by accident. */
export const DEFAULT_PICK_LIMIT = 5;
export const defaultPicks = (rows) => new Set(
  rows.filter((m) => !m.heldBy && m.workMode !== 'folder').slice(0, DEFAULT_PICK_LIMIT).map((m) => m.projectKey));

/** A count the table shows; `—` when that evidence carries no such number (the live-git path). */
const count = (n) => (n == null ? '—' : String(n));
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
/** Checked-out rows collapse to one line once the table is this long (except ones needing attention). */
const COLLAPSE_ROWS_AT = 10;

/** The chip a changed row shows, as [text, className, spinner?]. Reuses memberViewState as-is. */
function rowChip(m, state) {
  if (m.workMode === 'folder') return ['On a copy', 'badge act-state'];
  if (state === 'not-checked-out') return m.heldBy ? ['In your folder', 'badge act-kept'] : ['Not checked out', 'badge act-state'];
  if (state === 'setting-up') return ['Setting up', 'badge act-busy', true];
  if (state === 'setup-failed') return ['Setup failed', 'badge amber'];
  return [STATE_TEXT[state], state === 'running' ? 'badge act-running' : 'badge act-kept'];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The stop square every Stop control draws (11px, filled with the current colour). */
function stopGlyph(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['width', '11'], ['height', '11'], ['viewBox', '0 0 24 24'], ['fill', 'currentColor'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  const sq = doc.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of [['x', '5'], ['y', '5'], ['width', '14'], ['height', '14'], ['rx', '2.5']]) sq.setAttribute(k, v);
  svg.append(sq);
  return svg;
}
/** A running service's button: a stop square and its own name (■ Start worca), not "Stop Start worca".
 *  Screen readers and the tooltip still say what it does. */
function stopButton(doc, label, onClick) {
  const b = btn(doc, '', 'btn-danger act-stop-btn', onClick, `Stop ${label} and free its port`);
  b.setAttribute('aria-label', `Stop ${label}`);
  b.append(stopGlyph(doc), h(doc, 'span', null, label));
  return b;
}
function copyIconButton(doc, label, onClick) {
  const b = h(doc, 'button', 'btn btn-sm btn-quiet btn-icon act-copy');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of [['width', '14'], ['height', '14'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  const rect = doc.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of [['x', '9'], ['y', '9'], ['width', '12'], ['height', '12'], ['rx', '2.5']]) rect.setAttribute(k, v);
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5');
  svg.append(rect, path);
  b.append(svg);
  b.addEventListener('click', onClick);
  return b;
}
/** Branch and Folder as labelled rows: each mono string says what it is. */
function metaRows(doc, m, handlers) {
  const dl = h(doc, 'dl', 'act-meta');
  const row = (label, ...value) => { const dd = h(doc, 'dd'); dd.append(...value); dl.append(h(doc, 'dt', null, label), dd); };
  if (!m.branch) { row('Branch', h(doc, 'span', 'act-later', 'None: this run made no branch')); return dl; }
  const br = h(doc, 'code', 'act-branch', middleClip(m.branch)); br.title = m.branch;
  row('Branch', br, copyIconButton(doc, 'Copy branch name', () => handlers.onCopy?.(m.branch)));
  const dir = m.checkout ? (m.checkout.worktreeDir || m.worktreeDir) : (m.heldBy || null);
  if (dir) {
    const p = h(doc, 'code', 'act-path', middleClip(dir, 64)); p.title = dir;
    const extra = m.checkout?.external ? [h(doc, 'span', 'badge act-linked', 'Your folder')]
      : !m.checkout && m.heldBy ? [h(doc, 'span', 'act-later', 'already has this branch')] : [];
    row('Folder', p, copyIconButton(doc, 'Copy folder path', () => handlers.onCopy?.(dir)), ...extra);
  } else row('Folder', h(doc, 'span', 'act-later', 'Created when you check out'));
  return dl;
}

/** One section.card.act-card for a SINGLE-PROJECT run's member. A workspace member is a row of the
 *  checkout table (renderCheckoutTable / checkedOutRow), never a card. */
function memberCard(model, m, { doc, handlers, logs, queued }) {
  const sec = h(doc, 'section', 'card act-card');
  sec.dataset.member = m.projectKey;
  const mine = instancesOf(model, m.projectKey);
  const state = memberViewState(m, mine);
  sec.dataset.state = state;
  // Name and state on top (the badge keeps one place, top right), then Branch and Folder as labelled rows.
  const head = h(doc, 'div', 'act-head');
  head.append(h(doc, 'h3', 'act-name', m.projectName || m.projectKey), h(doc, 'span', 'badge act-state', STATE_TEXT[state]));
  sec.append(head, metaRows(doc, m, handlers));

  if (state === 'no-branch') return sec;
  if (model.finished === false) {
    sec.append(h(doc, 'p', 'hint', 'Check out is available once the run has finished.'));
    return sec;
  }
  if (!model.enabled) sec.append(h(doc, 'p', 'hint', 'Actions are turned off on this hosted deployment. Check out and Copy command still work.'));
  const copyBtn = () => (m.copyCommand ? btn(doc, 'Copy command', null, () => handlers.onCopy?.(m.copyCommand),
    'Copy the git commands that put this branch in your own clone') : null);
  const discardBtn = () => (m.checkout?.external
    ? btn(doc, 'Unlink', 'btn act-discard', () => handlers.onUnlink?.(m.projectKey),
      'Stop using your folder for this run. Running services stop; the folder and its changes stay as they are.')
    : btn(doc, 'Discard', 'btn act-discard', () => handlers.onDiscard?.([m.projectKey]),
      'Delete the checkout folder. Running services stop, and uncommitted changes are saved as a patch first.'));
  const diffBtn = () => btn(doc, 'Download patch', 'btn act-diff', (e) => handlers.onDiff?.(m.projectKey, e.currentTarget),
    'Download a patch of the folder\'s uncommitted changes. Read-only: nothing in the folder is staged or changed.');
  // The note under the row names the apps a click opens and where they are changed (Settings › Runs › Actions).
  // An app that is not there is simply not mentioned: no nagging on every run (the Settings card says it).
  // `lead` comes first in the same note (before Check out: what waits for it, which already names the buttons).
  const appsNote = (lead = '') => {
    const picks = model.enabled ? (m.builtins || []).filter((b) => b.key === 'editor' || b.key === 'terminal') : [];
    const apps = picks.map((b) => b.label);
    const set = !apps.length ? ''
      : lead ? `Change the ${picks.map((b) => b.key).join(' and ')} in Settings › Runs › Actions.`
        : `Opens in ${apps.join(' and ')}. Change ${apps.length > 1 ? 'them' : 'it'} in Settings › Runs › Actions.`;
    if (!lead && !set) return null;
    // The link lands on the card itself: showSettingsTab scrolls to it and focuses its first field.
    return appendWithPageLinks(doc, h(doc, 'p', 'hint act-apps'), [lead, set].filter(Boolean).join(' '));
  };

  if (state === 'not-checked-out') {
    const row = h(doc, 'div', 'act-row');
    // Only the single-project card reaches here (a workspace member is a table row now).
    const changedHere = isChangedMember(m);
    if (!changedHere) sec.append(h(doc, 'p', 'hint', 'No changes in this project.'));
    else if (m.heldBy) row.append(btn(doc, 'Use that folder', 'btn-primary', () => handlers.onUseExisting?.(m.projectKey),
      'Use the folder that already has this branch for this run. Worca never changes or deletes it.'));
    else row.append(btn(doc, 'Check out', 'btn-primary', () => handlers.onCheckout?.([m.projectKey]),
      `Put this run's branch in a folder of its own${m.setup ? ', then run the setup command' : ''}`));
    const c = copyBtn(); if (c) row.append(c);
    // The other built-ins open the checkout folder, which Check out creates: a click asks first, then checks
    // out and opens. With nothing to check out there is no folder to open and the server answers
    // NOT_AFFECTED, which the client turns into a quiet refresh — the click would confirm a dialog and then
    // do nothing at all. So an unchanged project offers Copy command and nothing else.
    const opens = model.enabled && changedHere ? (m.builtins || []).filter((b) => b.key !== 'copyCommand') : [];
    if (opens.length) {
      row.append(h(doc, 'span', 'act-sep'));
      for (const b of opens) {
        const o = btn(doc, b.label, null, () => handlers.onOpenBeforeCheckout?.(m.projectKey, b.key, b.label));
        o.title = m.heldBy ? `${builtinTip(b.key, b.label, 'the folder that has this branch')} (asks first)` : `Check out first (asks), then: ${builtinTip(b.key, b.label).replace(/^./, (c) => c.toLowerCase())}`;
        row.append(o);
      }
    }
    if (row.childNodes.length) sec.append(row);
    // Nothing to check out: no estimate for a checkout that will not happen, and no note about apps opening
    // a folder that will never exist. "No changes in this project." above is the whole story.
    if (!changedHere) return sec;
    // One note under the row: what waits for Check out, then what this machine lacks.
    const names = opens.map((b) => b.label).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const waits = !opens.length ? '' : m.heldBy ? `${names} open that folder.` : `${names} open the checkout, so they check out first.`;
    const lead = m.heldBy
      ? 'This branch is already checked out in that folder, so Worca can use it instead of making a copy. Worca never deletes or changes your folder.'
      : `Check out takes ${estimateText(model.estimate?.lastSetupMs, !!m.setup)}.`;
    const note = appsNote(`${lead}${waits ? ` ${waits}` : ''}`);
    if (note) sec.append(note);
    return sec;
  }

  const setup = m.checkout.setup || {};
  const row = h(doc, 'div', 'act-row');
  if (state === 'setting-up') {
    sec.append(h(doc, 'p', 'hint', m.setup ? `Running setup: ${m.setup}` : 'Running setup'));
  } else if (state === 'setup-failed') {
    const why = setup.status === 'interrupted' ? 'Setup was interrupted.' : `Setup failed${setup.exitCode != null ? ` (exit ${setup.exitCode})` : ''}.`;
    sec.append(h(doc, 'p', 'hint act-exit fail', why));
    if (model.enabled) row.append(btn(doc, 'Run setup again', 'btn-primary', () => handlers.onSetupAgain?.(m.projectKey),
      m.setup ? `Run the setup command again: ${m.setup}` : 'Run the setup command again'));
  } else if (model.enabled) {
    for (const a of m.actions || []) {
      const live = a.kind === 'service' ? activeService(mine, a.id) : null;
      if (live) { row.append(stopButton(doc, a.label, () => handlers.onStop?.(m.projectKey, a.id))); continue; }
      if (queued?.has(`${m.projectKey}:${a.id}`)) { const b = btn(doc, 'Starts after setup', null, null, `${a.label} starts when the setup command finishes`); b.disabled = true; row.append(b); continue; }
      row.append(btn(doc, a.label, a.kind === 'service' ? 'btn-primary' : null, () => handlers.onStart?.(m.projectKey, a.id), actionTip(a)));
    }
    // Setup was skipped (a linked folder of yours, or actions off when checked out): it never runs by itself
    // there, so this is the way to run it. Only when the project has a setup command: otherwise nothing would run.
    if (setup.status === 'skipped' && m.setup) row.append(btn(doc, 'Run setup', null, () => handlers.onSetupAgain?.(m.projectKey),
      `Run the project's setup command here: ${m.setup}`));
  }
  if (model.enabled && state !== 'setting-up' && state !== 'setup-failed' && (m.builtins || []).length) {
    if (row.childNodes.length) row.append(h(doc, 'span', 'act-sep'));
    for (const b of m.builtins) {
      if (b.key === 'copyCommand') { const c = copyBtn(); if (c) row.append(c); continue; }
      row.append(btn(doc, b.label, null, () => handlers.onBuiltin?.(m.projectKey, b.key), builtinTip(b.key, b.label, m.checkout?.external ? 'your folder' : 'the checkout')));
    }
  } else { const c = copyBtn(); if (c) row.append(c); }
  if (handlers.onDiff) row.append(diffBtn());
  row.append(discardBtn());
  sec.append(row);
  // The notes under the row sit together as one block (not paragraphs with their own margins).
  const notes = h(doc, 'div', 'act-notes');
  // Where the project's actions are edited, with or without any (instructional text: no project name in it).
  if (model.enabled && state !== 'setting-up' && state !== 'setup-failed') {
    const tab = "the project's Actions tab";
    const none = !(m.actions || []).length;
    notes.append(appendWithPageLinks(doc, h(doc, 'p', `hint ${none ? 'act-none' : 'act-edit'}`),
      none ? `This project has no actions yet. Add a Run or Test command on ${tab}.` : `Add or change actions on ${tab}.`,
      [[tab, projectActionsHref(m.projectKey)]]));
  }
  if (state !== 'setting-up' && state !== 'setup-failed') { const apps = appsNote(); if (apps) notes.append(apps); }
  if (state === 'ready' && setup.status === 'pending') notes.append(h(doc, 'p', 'hint', 'Setup runs before the first action.'));
  if (notes.childNodes.length) sec.append(notes);

  for (const s of mine.filter((x) => x.kind === 'service' && ACTIVE.has(x.status))) {
    const line = h(doc, 'div', 'act-row act-service');
    line.append(h(doc, 'span', 'act-label', withPort(labelOf(m, s), s)));
    const link = openLink(doc, s.url, portOf(s) != null ? `Open :${portOf(s)}` : 'Open');
    if (link) line.append(link);
    if (s.startedAt) line.append(h(doc, 'span', 'act-uptime', `up ${formatUptime(Date.now() - s.startedAt)}`));
    if (s.readyError) line.append(h(doc, 'span', 'hint act-ready-error', s.readyError));
    sec.append(line);
  }
  const task = latest(mine.filter((s) => s.kind === 'task' && s.actionId !== '__setup' && TERMINAL.has(s.status)));
  if (state === 'task-result' && task) {
    const ok = task.exitCode === 0;
    sec.append(h(doc, 'p', `act-exit ${ok ? 'ok' : 'fail'}`, `${labelOf(m, task)} ${task.status} (exit ${task.exitCode ?? '?'})`));
  }
  const shown = latest(mine);
  if (shown && logs) sec.append(renderLog(doc, shown.instanceId, logs.get(shown.instanceId)));
  return sec;
}

/** The changed members that are not checked out yet, as one table. Returns null when there are none. */
function renderCheckoutTable(model, rows, { doc, handlers, pickable, picked, onPick }) {
  if (!rows.length) return null;
  const live = model.finished !== false;
  // More than one row the footer button could act on: `pickable`, the same list the footer uses, so a
  // checkbox the button would ignore can never render.
  const multi = pickable.length > 1;
  const canPick = new Set(pickable.map((m) => m.projectKey));
  const wrap = h(doc, 'div', 'table-wrap');
  const t = h(doc, 'table', 'table act-table');
  const thead = h(doc, 'thead');
  const hr = h(doc, 'tr');
  // One changed member needs no checkbox column and no select-all: the footer button names it.
  if (multi) {
    const th = h(doc, 'th', 'act-c-cb');
    const all = h(doc, 'input', 'act-cb');
    all.type = 'checkbox';
    all.setAttribute('aria-label', 'Select all changed projects');
    const n = pickable.filter((m) => picked.has(m.projectKey)).length;
    all.checked = n > 0 && n === pickable.length;
    all.indeterminate = n > 0 && n < pickable.length;
    all.disabled = !live || !pickable.length;
    all.addEventListener('change', () => {
      const next = new Set(picked);
      for (const m of pickable) { if (all.checked) next.add(m.projectKey); else next.delete(m.projectKey); }
      onPick(next);
    });
    th.append(all);
    hr.append(th);
  }
  hr.append(h(doc, 'th', null, 'Project'), h(doc, 'th', null, 'Branch'),
    h(doc, 'th', 'num', 'Files'), h(doc, 'th', 'num', 'Lines'), h(doc, 'th', 'act-c-end', 'State'));
  thead.append(hr);
  const tb = h(doc, 'tbody');
  for (const m of rows) {
    const tr = h(doc, 'tr');
    tr.dataset.member = m.projectKey;
    if (picked.has(m.projectKey)) tr.className = 'act-picked';
    if (multi) {
      const td = h(doc, 'td', 'act-c-cb');
      // A Folder member works on a copy and a held branch is offered as the folder it already sits in:
      // neither is something this button can check out, so neither gets a checkbox.
      if (canPick.has(m.projectKey)) {
        const cb = h(doc, 'input', 'act-cb');
        cb.type = 'checkbox';
        cb.checked = picked.has(m.projectKey);
        cb.disabled = !live;
        cb.setAttribute('aria-label', `Check out ${m.projectName || m.projectKey}`);
        cb.addEventListener('change', () => {
          const next = new Set(picked);
          if (cb.checked) next.add(m.projectKey); else next.delete(m.projectKey);
          onPick(next);
        });
        td.append(cb);
      }
      tr.append(td);
    }
    const name = h(doc, 'td', 'table-main', m.projectName || m.projectKey);
    name.dataset.label = 'Project';
    const brTd = h(doc, 'td');
    brTd.dataset.label = 'Branch';
    if (m.branch) {
      const br = h(doc, 'code', 'act-branch', middleClip(m.branch, 44));
      br.title = m.branch;
      brTd.append(br, copyIconButton(doc, `Copy branch name of ${m.projectName || m.projectKey}`, () => handlers.onCopy?.(m.branch)));
    } else brTd.append(h(doc, 'span', 'act-later', 'no branch'));
    const files = h(doc, 'td', 'num', count(m.files));
    files.dataset.label = 'Files';
    const lines = h(doc, 'td', 'num');
    lines.dataset.label = 'Lines';
    if (m.added == null && m.removed == null) lines.append('—');
    else lines.append(h(doc, 'span', 'diff-add', `+${m.added | 0}`), ' ', h(doc, 'span', 'diff-del', `−${m.removed | 0}`));
    const stTd = h(doc, 'td', 'act-c-end');
    stTd.dataset.label = 'State';
    const [text, cls, spin] = rowChip(m, 'not-checked-out');
    const chip = h(doc, 'span', cls);
    if (spin) { const s = h(doc, 'span', 'act-spin'); s.setAttribute('aria-hidden', 'true'); chip.append(s); }
    chip.append(text);
    stTd.append(chip);
    // The branch already sits in a folder of yours: that row offers the folder instead of a checkout.
    if (live && m.heldBy && m.workMode !== 'folder') {
      stTd.append(btn(doc, 'Use that folder', 'btn-quiet', () => handlers.onUseExisting?.(m.projectKey),
        'Use the folder that already has this branch for this run. Worca never changes or deletes it.'));
    }
    tr.append(name, brTd, files, lines, stTd);
    tb.append(tr);
  }
  t.append(thead, tb);
  wrap.append(t);
  return wrap;
}

/** A member that IS checked out (whether or not the run changed it): the row grows its folder, its actions
 *  and the open-in buttons. `collapsible` (a long card) hides all that behind a Show button unless the row
 *  needs attention (a service running, setup failed), in which case it stays open and has no button. */
function checkedOutRow(model, m, state, { doc, handlers, logs, queued, collapsible = false, expanded = false, onToggle = null }) {
  const mine = instancesOf(model, m.projectKey);
  const needsEye = state === 'running' || state === 'setup-failed';
  const open = !collapsible || needsEye || expanded;
  const r = h(doc, 'div', 'act-wt-row');
  r.dataset.member = m.projectKey;
  r.dataset.state = state;
  const top = h(doc, 'div', 'act-wt-top');
  top.append(h(doc, 'span', 'act-wt-name', m.projectName || m.projectKey));
  if (m.added != null || m.removed != null) {
    const lines = h(doc, 'span', 'act-wt-lines');
    lines.append(h(doc, 'span', 'diff-add', `+${m.added | 0}`), ' ', h(doc, 'span', 'diff-del', `−${m.removed | 0}`));
    top.append(lines);
  }
  const dir = m.checkout?.worktreeDir || m.worktreeDir;
  if (dir) {
    const meta = h(doc, 'div', 'act-wt-meta');
    const p = h(doc, 'code', 'act-path', middleClip(dir, 64));
    p.title = dir;
    meta.append(p, copyIconButton(doc, `Copy folder path of ${m.projectName || m.projectKey}`, () => handlers.onCopy?.(dir)));
    if (m.checkout?.external) meta.append(h(doc, 'span', 'badge act-linked', 'Your folder'));
    top.append(meta);
  }
  const [text, cls, spin] = rowChip(m, state);
  const chip = h(doc, 'span', `${cls} act-wt-chip`);
  if (spin) { const s = h(doc, 'span', 'act-spin'); s.setAttribute('aria-hidden', 'true'); chip.append(s); }
  // A running service names its port right in the chip ("Running :4417").
  const svc = mine.find((s) => s.kind === 'service' && ACTIVE.has(s.status));
  chip.append(state === 'running' && svc ? withPort('Running', svc) : text);
  top.append(chip);
  // The way back in: without it a collapsed row's folder, Download patch, Discard and open-in buttons would
  // have no home at all on this tab.
  if (collapsible && !needsEye) {
    const t = btn(doc, open ? 'Hide' : 'Show', 'btn-quiet act-wt-toggle', () => onToggle?.(m.projectKey),
      open ? `Hide the folder and actions of ${m.projectName || m.projectKey}` : `Show the folder and actions of ${m.projectName || m.projectKey}`);
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
    top.append(t);
  }
  r.append(top);
  if (!open) return r;

  const acts = h(doc, 'div', 'act-wt-acts');
  if (state === 'setting-up') {
    r.append(h(doc, 'p', 'hint', m.setup ? `Running setup: ${m.setup}` : 'Running setup'));
  } else if (state === 'setup-failed') {
    const s = m.checkout.setup || {};
    r.append(h(doc, 'p', 'hint act-exit fail', s.status === 'interrupted' ? 'Setup was interrupted.'
      : `Setup failed${s.exitCode != null ? ` (exit ${s.exitCode})` : ''}.`));
    if (model.enabled) acts.append(btn(doc, 'Run setup again', 'btn-primary', () => handlers.onSetupAgain?.(m.projectKey),
      m.setup ? `Run the setup command again: ${m.setup}` : 'Run the setup command again'));
  } else if (model.enabled) {
    for (const a of m.actions || []) {
      const liveSvc = a.kind === 'service' ? activeService(mine, a.id) : null;
      if (liveSvc) { acts.append(stopButton(doc, a.label, () => handlers.onStop?.(m.projectKey, a.id))); continue; }
      if (queued?.has(`${m.projectKey}:${a.id}`)) {
        const b = btn(doc, 'Starts after setup', null, null, `${a.label} starts when the setup command finishes`);
        b.disabled = true; acts.append(b); continue;
      }
      acts.append(btn(doc, a.label, a.kind === 'service' ? 'btn-primary' : null, () => handlers.onStart?.(m.projectKey, a.id), actionTip(a)));
    }
    if ((m.checkout.setup || {}).status === 'skipped' && m.setup) {
      acts.append(btn(doc, 'Run setup', null, () => handlers.onSetupAgain?.(m.projectKey), `Run the project's setup command here: ${m.setup}`));
    }
  }
  // Editor / Terminal / Finder appear ONLY here, on a row that is actually checked out.
  if (model.enabled && state !== 'setting-up' && state !== 'setup-failed') {
    const opens = (m.builtins || []).filter((b) => b.key !== 'copyCommand');
    if (opens.length) {
      if (acts.childNodes.length) acts.append(h(doc, 'span', 'act-sep'));
      for (const b of opens) acts.append(btn(doc, b.label, null, () => handlers.onBuiltin?.(m.projectKey, b.key),
        builtinTip(b.key, b.label, m.checkout?.external ? 'your folder' : 'the checkout')));
    }
  }
  // Rarely used, and never the loudest button on the row (quiet, and last).
  if (handlers.onDiff) acts.append(btn(doc, 'Download patch', 'btn-quiet act-diff', (e) => handlers.onDiff?.(m.projectKey, e.currentTarget),
    'Download a patch of the folder\'s uncommitted changes. Read-only: nothing in the folder is staged or changed.'));
  acts.append(m.checkout?.external
    ? btn(doc, 'Unlink', 'btn-quiet act-discard', () => handlers.onUnlink?.(m.projectKey),
      'Stop using your folder for this run. Running services stop; the folder and its changes stay as they are.')
    : btn(doc, 'Discard', 'btn-quiet act-discard', () => handlers.onDiscard?.([m.projectKey]),
      'Delete the checkout folder. Running services stop, and uncommitted changes are saved as a patch first.'));
  r.append(acts);

  for (const s of mine.filter((x) => x.kind === 'service' && ACTIVE.has(x.status))) {
    const line = h(doc, 'div', 'act-wt-svc');
    const link = openLink(doc, s.url, portOf(s) != null ? `Open :${portOf(s)}` : 'Open');
    if (link) line.append(link);
    if (s.startedAt) line.append(h(doc, 'span', 'act-uptime', `up ${formatUptime(Date.now() - s.startedAt)}`));
    if (s.readyError) line.append(h(doc, 'span', 'hint act-ready-error', s.readyError));
    if (line.childNodes.length) r.append(line);
  }
  const shown = latest(mine);
  if (shown && logs) r.append(renderLog(doc, shown.instanceId, logs.get(shown.instanceId)));
  return r;
}

/** Everything the run did not change, as one collapsed line. Nothing inside it is clickable. */
function renderUnchangedFold(doc, members) {
  // A member holding a checkout keeps its own row above — it has a folder to open and discard — so it is
  // never also listed here under "Nothing to check out".
  const rest = members.filter((m) => !isChangedMember(m) && !m.checkout);
  if (!rest.length) return null;
  const named = rest.filter((m) => m.state !== 'no-branch');
  const noBranch = rest.length - named.length;
  const d = h(doc, 'details', 'act-fold');
  const s = h(doc, 'summary', null, `${plural(rest.length, 'project')} had no changes`);
  const body = h(doc, 'div', 'act-fold-body');
  const names = h(doc, 'div', 'act-fold-names');
  for (const m of named) names.append(h(doc, 'span', null, m.projectName || m.projectKey));
  if (noBranch) names.append(h(doc, 'span', null, `+${noBranch} with no branch`));
  body.append(names, h(doc, 'p', 'hint', 'Nothing to check out. Their branches have no commits and are left as they are.'));
  d.append(s, body);
  return d;
}

/** One footer line: the button that counts the selection, Copy git commands, and the one place the
 *  setup estimate, where apps open and the Settings link are said. */
function renderCheckoutFoot(model, rows, { doc, handlers, pickable, picked }) {
  const foot = h(doc, 'div', 'act-co-foot');
  if (model.finished === false) {
    foot.append(h(doc, 'p', 'hint', 'Check out is available once the run has finished.'));
    return foot;
  }
  // No pickable row (every one is a Folder member, or sits in a folder of yours) means there is no plain
  // checkout to make: the rows carry "Use that folder" instead, and a button here could only be refused.
  if (pickable.length) {
    const chosen = pickable.filter((m) => picked.has(m.projectKey)).map((m) => m.projectKey);
    // A single pickable row has no checkbox, so the button names it and posts it. With more, it posts
    // exactly what is ticked — never a key the person unticked.
    const only = pickable.length === 1 ? pickable[0] : null;
    const label = only ? `Check out ${only.projectName || only.projectKey}`
      : chosen.length === 0 ? 'Check out' : `Check out ${plural(chosen.length, 'project')}`;
    const go = btn(doc, label, 'btn-primary',
      () => handlers.onCheckout?.(chosen.length ? chosen : only ? [only.projectKey] : []),
      'Put the chosen branches in folders of their own, then run each project\'s setup command');
    go.disabled = !only && chosen.length === 0;
    foot.append(go);
  }
  if (rows.length) {
    const copyable = rows.filter((m) => m.copyCommand);
    if (copyable.length) {
      foot.append(btn(doc, 'Copy git commands', null, () => handlers.onCopy?.(copyable.map((m) => m.copyCommand).join('\n\n')),
        'Copy the git commands that put these branches in your own clones'));
    }
  }
  // Said once for the whole card, not once per project.
  const picks = model.enabled ? (rows[0]?.builtins || model.members?.[0]?.builtins || []).filter((b) => b.key === 'editor' || b.key === 'terminal') : [];
  const apps = picks.map((b) => b.label);
  const parts = [];
  if (rows.length) parts.push(`Check out takes ${estimateText(model.estimate?.lastSetupMs, rows.some((m) => m.setup))} each.`);
  if (apps.length) parts.push(`Opens in ${apps.join(' and ')}. Change ${apps.length > 1 ? 'them' : 'it'} in Settings › Runs › Actions.`);
  if (parts.length) foot.append(appendWithPageLinks(doc, h(doc, 'p', 'hint act-apps'), parts.join(' ')));
  return foot;
}

/** The Actions tab body. A workspace run gets ONE checkout card: a table of the members the run
 *  changed, expanded rows for the ones checked out, its stacks, and one collapsed line for the rest.
 *  A single-project run keeps its own card (memberCard). */
export function renderActionsCard(model, { doc, handlers = {}, logs = null, queued = null, notice = null, picked = null, onPick = null,
  expanded = null, onExpand = null } = {}) {
  const root = h(doc, 'div', 'act-view');
  if (notice) {
    // kind 'error' | 'ok' (and older 'err'): an error is a tinted alert box, a success a green status line.
    const err = notice.kind === 'error' || notice.kind === 'err';
    const p = h(doc, 'p', `act-notice ${err ? 'err' : notice.kind === 'ok' ? 'ok' : ''}`.trim());
    p.setAttribute('role', err ? 'alert' : 'status');
    root.append(appendWithPageLinks(doc, p, notice.text));
  }
  const members = model.members || [];
  if (!model.workspace) {
    for (const m of members) root.append(memberCard(model, m, { doc, handlers, logs, queued }));
    return root;
  }

  const changed = members.filter(isChangedMember);
  const pending = changed.filter((m) => !m.checkout);
  // Every member that HAS a checkout keeps its row, changed or not: an unchanged one can still be checked
  // out (Ship It's "Try it first" posts `{}`, which checks out all of them, and a stack step checks its own
  // member out), and the folder path, Discard / Unlink, Download patch and the open-in buttons live nowhere
  // else. What is OFFERED is gated on `affected`; what EXISTS is not.
  const out = members.filter((m) => m.checkout);
  // One list behind the checkbox column, the select-all and the footer button, so they cannot disagree about
  // what "check out" would act on: a Folder member works on a copy, and a held branch is offered as "Use that
  // folder" (a plain checkout of it is refused BRANCH_CHECKED_OUT), so neither is pickable.
  const pickable = pending.filter((m) => m.workMode !== 'folder' && !m.heldBy);
  const picks = picked || defaultPicks(pending);
  const opened = expanded || new Set();
  const card = h(doc, 'section', 'card act-co');
  const head = h(doc, 'div', 'act-co-head');
  head.append(h(doc, 'h3', 'act-co-title', 'Check out the changes'));
  if (changed.length || out.length) {
    const t = model.totals || {};
    const bits = [`${changed.length} of ${plural(t.members ?? members.length, 'project')} changed`];
    if (t.files != null) bits.push(plural(t.files, 'file'));
    if (t.added != null || t.removed != null) bits.push(`+${t.added | 0} −${t.removed | 0}`);
    if (out.length) bits.push(`${out.length} checked out`);
    head.append(h(doc, 'p', 'act-co-sub', bits.join(' · ')));
  }
  card.append(head);

  if (!changed.length && !out.length) {
    const e = h(doc, 'div', 'act-co-empty');
    e.append(h(doc, 'p', null, 'No project changed in this run.'),
      h(doc, 'p', 'hint', `None of the ${plural(members.length, 'project')} has commits on its branch, so there is nothing to check out.`));
    card.append(e);
  } else {
    const table = renderCheckoutTable(model, pending, { doc, handlers, pickable, picked: picks, onPick: onPick || (() => {}) });
    if (table) card.append(table);
    if (out.length) {
      const wt = h(doc, 'div', 'act-wt');
      // Counted over the rows the card really has, not over `changed`: a run that changed two members can
      // still have a dozen checkouts (one `{}` post checks out every member), which is the long page this
      // collapse exists for.
      const collapsible = pending.length + out.length >= COLLAPSE_ROWS_AT;
      for (const m of out) {
        wt.append(checkedOutRow(model, m, memberViewState(m, model.instances || []), { doc, handlers, logs, queued,
          collapsible, expanded: opened.has(m.projectKey), onToggle: onExpand }));
      }
      card.append(wt);
    }
    card.append(renderCheckoutFoot(model, pending, { doc, handlers, pickable, picked: picks }));
  }

  // Stacks can reference members the run did not change; they still start — stack start checks such a member
  // out itself (resolveStep in ui/server.mjs calls the core, which the route's 409 guard never sees), so the
  // row says so instead of hiding them.
  const unchangedKeys = new Set(members.filter((m) => !isChangedMember(m)).map((m) => m.projectKey));
  for (const st of model.stacks || []) {
    const cur = (model.stackStates || []).find((x) => x.stackId === st.id);
    const busy = cur && ['starting', 'running'].includes(cur.status);
    const line = h(doc, 'div', 'act-row act-stack');
    line.append(h(doc, 'span', 'act-label', st.label || st.id));
    if (cur) line.append(h(doc, 'span', 'badge act-state', cur.status));
    if (busy) line.append(btn(doc, 'Stop stack', 'btn-danger', () => handlers.onStack?.(st.id, 'stop'), 'Stop what this stack started, newest first'));
    else if (model.enabled && model.finished !== false) line.append(btn(doc, 'Start stack', 'btn-primary', () => handlers.onStack?.(st.id, 'start'), 'Start this stack\'s steps in order, each member checked out and set up first'));
    const uses = new Set((st.steps || []).map((x) => x.member).filter((k) => unchangedKeys.has(k)));
    if (uses.size) line.append(h(doc, 'span', 'hint act-stack-uses', `also uses ${plural(uses.size, 'unchanged project')}`));
    if (cur?.error) line.append(h(doc, 'span', 'hint act-exit fail', cur.error));
    card.append(line);
  }

  const fold = renderUnchangedFold(doc, members);
  if (fold) card.append(fold);
  root.append(card);
  return root;
}

/** Overview strip: the state, one primary affordance (Check out, or open link + Stop) and "Open tab ›". */
export function renderOverviewStrip(model, { doc, handlers = {} } = {}) {
  if (!model) return null;
  const members = (model.members || []).filter((m) => m.branch);
  if (!members.length) return null;
  const row = h(doc, 'div', 'act-row act-strip-row');
  const live = (model.instances || []).find((s) => s.kind === 'service' && ACTIVE.has(s.status));
  if (live) {
    row.append(h(doc, 'span', 'badge act-running', withPort('Running', live)));
    const link = openLink(doc, live.url, portOf(live) != null ? `Open :${portOf(live)}` : 'Open');
    if (link) row.append(link);
    row.append(btn(doc, 'Stop', 'btn-danger', () => handlers.onStop?.(live.member, live.actionId), `Stop ${live.label || 'the service'} and free its port`));
  } else if (members.some((m) => m.checkout)) {
    row.append(h(doc, 'span', 'badge act-kept', 'Checked out'));
  } else {
    const changed = members.filter(isChangedMember);
    row.append(h(doc, 'span', 'act-label', 'Try the result in a local checkout.'));
    if (model.finished !== false && changed.length) {
      // Opens the Actions tab rather than checking out on the spot: the tab is where you choose which
      // projects, and on a workspace run "Check out" used to mean all of them.
      row.append(btn(doc, `Check out ${plural(changed.length, 'changed project')}`, 'btn-primary',
        () => handlers.onOpenTab?.(), 'Open the run\'s Actions tab and choose what to check out'));
    }
  }
  row.append(btn(doc, 'Open tab ›', null, () => handlers.onOpenTab?.(), 'Open the run\'s Actions tab'));
  return row;
}

/** What the Create PR dialog's "Try it first" shows: 'checkout' (the footer button), 'strip' (the branch is checked
 *  out: Open :port, actions, Stop) or null (no branch, or the run is not finished). */
export function shipItTryState(model) {
  if (!model || model.finished === false) return null;
  const m = (model.members || []).find((x) => x.branch);
  if (!m) return null;
  return m.checkout ? 'strip' : 'checkout';
}

/** The Create PR dialog's "Try it first" strip once the branch is checked out: Open :port / actions / Editor / Stop.
 *  Never blocks the dialog. */
export function renderShipItStrip(model, { doc, handlers = {} } = {}) {
  if (shipItTryState(model) !== 'strip') return null;
  const m = model.members.find((x) => x.branch);
  const row = h(doc, 'div', 'act-row act-shipit');
  row.append(h(doc, 'span', 'act-label', 'Try it first'));
  const mine = instancesOf(model, m.projectKey);
  const live = activeService(mine);
  if (live) {
    const link = openLink(doc, live.url, portOf(live) != null ? `Open :${portOf(live)}` : 'Open');
    if (link) row.append(link);
  }
  if (model.enabled) {
    for (const a of m.actions || []) {
      if (a.kind === 'service' && activeService(mine, a.id)) continue;
      row.append(btn(doc, a.label, null, () => handlers.onStart?.(m.projectKey, a.id), actionTip(a)));
    }
    const editor = (m.builtins || []).find((b) => b.key === 'editor');
    if (editor) row.append(btn(doc, editor.label, null, () => handlers.onBuiltin?.(m.projectKey, 'editor'), builtinTip('editor', editor.label)));
  }
  if (live) row.append(btn(doc, 'Stop', 'btn-danger', () => handlers.onStop?.(live.member, live.actionId), `Stop ${live.label || 'the service'} and free its port`));
  return row;
}

/** The sidebar's Running actions: one row per running service — a green dot, "<run title> · <label :port>"
 *  (a button opening the run's Actions tab while the run still has a saved row) and a square Stop. No header: the
 *  rows are the list. The uptime rides the row's title. `menu: true` marks the buttons as menu items, for the
 *  rail's flyout. Returns null when nothing runs. */
export function renderRunningActionRows(services, { doc, titleOf = (s) => s.runId, onStop, onOpen, menu = false, now = Date.now() } = {}) {
  const list = (services || []).filter((s) => ACTIVE.has(s.status));
  if (!list.length) return null;
  const box = h(doc, 'div', 'act-rows');
  for (const s of list) {
    const row = h(doc, 'div', 'act-srow');
    row.dataset.instanceId = s.instanceId;
    const text = `${titleOf(s)} · ${withPort(s.label, s)}`;
    row.title = s.startedAt ? `${text} · up ${formatUptime(now - s.startedAt)}` : text;
    const openable = !!onOpen && s.histKey !== null;
    const name = h(doc, openable ? 'button' : 'span', 'act-srow-name', text);
    if (openable) { name.type = 'button'; name.addEventListener('click', () => onOpen(s)); }
    const tip = `Stop ${s.label || 'this service'} and free its port`;
    const stop = h(doc, 'button', 'act-stop');
    stop.type = 'button';
    stop.title = tip;
    stop.setAttribute('aria-label', tip);
    stop.append(stopGlyph(doc));
    stop.addEventListener('click', () => onStop?.(s));
    if (menu) {
      row.setAttribute('role', 'none');
      if (openable) name.setAttribute('role', 'menuitem');
      stop.setAttribute('role', 'menuitem');
    }
    row.append(h(doc, 'span', 'pdot'), name, stop);
    box.append(row);
  }
  return box;
}

/** History card badges: `Running :4417`, `N checked out` and `Kept · <policy>`, as `{text, cls}`. */
export function historyActionBadges(p, running) {
  const out = [];
  const live = (running || []).find((s) => s.runId === p.id && s.kind === 'service' && ACTIVE.has(s.status));
  if (live) out.push({ text: withPort('Running', live), cls: 'badge act-running' });
  const members = p.checkout?.members || [];
  if (members.length) {
    out.push({ text: members.length === 1 ? 'Checked out' : `${members.length} checked out`, cls: 'badge act-kept' });
    const policy = members.map((x) => x.policy).find((x) => POLICY_TEXT[x]);
    if (policy) out.push({ text: `Kept · ${POLICY_TEXT[policy]}`, cls: 'badge act-kept' });
  }
  return out;
}

/**
 * Discard (Worca's own checkout) or Unlink (a linked folder): the Actions tab's confirm copy and DELETE,
 * shared with the summary card's Simple checkout row (app.js) so both say and do exactly the same. A Discard whose
 * snapshot fails asks again before forcing. Resolves the last `api` answer, or null when the person cancelled.
 */
export async function releaseCheckout({ api, url, members, external = false, dir = '', confirm }) {
  if (external) {
    if (!(await confirm({ title: 'Stop using this folder?', message: ['Running services stop first. ', { strong: dir || 'the folder' }, ' stays exactly as it is.'], confirmLabel: 'Unlink' }))) return null;
    return api('DELETE', url, { members });
  }
  if (!(await confirm({ title: 'Discard the checkout?', message: 'Running services stop first. Uncommitted changes are saved as a patch in the run\'s files.', danger: true, confirmLabel: 'Discard' }))) return null;
  let r = await api('DELETE', url, { members });
  if (!r.ok && r.data?.code === 'SNAPSHOT_FAILED') {
    if (!(await confirm({ title: 'Saving the uncommitted changes failed', message: 'Discard anyway? Uncommitted changes in the checkout will be lost.', danger: true, confirmLabel: 'Discard anyway' }))) return null;
    r = await api('DELETE', url, { members, force: true });
  }
  return r;
}

/** The live Actions tab: fetches the run model, renders the card, follows action-* frames. */
export function createActionsController({ runId, scopeQuery, api, ws, host, doc, confirm, navigate, onModel, downloadPatch }) {
  const st = { model: null, dead: false, lastSeq: new Map(), logs: new Map(), queued: new Set(), subscribed: new Set(), notice: null,
    picked: null, expanded: new Set() };
  const base = `/api/runs/${encodeURIComponent(runId)}`;
  const q = scopeQuery ? `?${scopeQuery}` : '';
  const prefix = `act:${runId}:`;
  const instanceIdOf = (member, actionId) => `${prefix}${member}:${actionId}`;

  function subscribe(instanceId) {
    if (st.subscribed.has(instanceId)) return;
    st.subscribed.add(instanceId);
    ws?.send({ type: 'subscribe', instanceId });
  }
  function render() {
    if (st.dead || !st.model) return;
    const pending = (st.model.members || []).filter((m) => isChangedMember(m) && !m.checkout);
    if (st.picked === null) st.picked = defaultPicks(pending);
    // Drop keys that left the table (checked out, or no longer offered) so the count never over-reports.
    for (const k of [...st.picked]) if (!pending.some((m) => m.projectKey === k)) st.picked.delete(k);
    host.replaceChildren(renderActionsCard(st.model, { doc, handlers, logs: st.logs, queued: st.queued, notice: st.notice,
      picked: st.picked, onPick: (next) => { st.picked = next; render(); },
      // A row the person opened by hand stays open across the re-render every action triggers.
      expanded: st.expanded,
      onExpand: (k) => { if (st.expanded.has(k)) st.expanded.delete(k); else st.expanded.add(k); render(); } }));
  }
  function fail(r) { st.notice = { text: r.data?.error || `Request failed (${r.status})`, kind: 'error' }; render(); }
  function upsert(snap) {
    if (!st.model || !snap?.instanceId) return;
    const list = st.model.instances || (st.model.instances = []);
    const i = list.findIndex((s) => s.instanceId === snap.instanceId);
    if (i >= 0) list[i] = snap; else list.push(snap);
  }

  async function refresh() {
    if (st.dead) return;
    const r = await api('GET', `${base}/actions${q}`);
    if (st.dead) return;
    if (!r.ok) { if (!st.model) host.replaceChildren(h(doc, 'p', 'hint act-hint', r.data?.error || 'Could not load actions.')); return; }
    st.model = r.data;
    for (const s of st.model.instances || []) subscribe(s.instanceId);
    // A queued start waits only while its member's setup can still finish; with setup settled and no
    // instance for it, the start was refused (failed setup, no free port, bad cwd), so drop the wait.
    for (const key of [...st.queued]) {
      const m = (st.model.members || []).find((x) => key.startsWith(`${x.projectKey}:`));
      const waiting = m && (m.setupQueued || m.checkout?.setup?.status === 'running');
      if (!waiting && !(st.model.instances || []).some((s) => ACTIVE.has(s.status) && `${s.member}:${s.actionId}` === key)) st.queued.delete(key);
    }
    onModel?.(st.model);
    render();
  }
  const after = async (r) => {
    // Both mean "your page is out of date": refresh and let the card show the truth, with no red error.
    if (!r.ok && (r.data?.code === 'BRANCH_CHECKED_OUT' || r.data?.code === 'NOT_AFFECTED')) { st.notice = null; await refresh(); return undefined; }
    if (!r.ok) return fail(r);
    st.notice = null; await refresh(); return r;
  };
  // What a Discard / Unlink did, said in the card (the words the summary card's toast used).
  const released = (external, r) => ({ kind: 'ok', text: external ? 'Folder unlinked. The folder stays as it was.'
    : `Checkout discarded. ${(r.data?.patches || []).length ? 'Uncommitted changes were saved as a patch in the run\'s files.' : 'Nothing uncommitted needed saving.'}` });

  const handlers = {
    onCheckout: async (members) => after(await api('POST', `${base}/checkout${q}`, members ? { members } : {})),
    // The branch is already checked out in another folder (the person's clone): link it as the checkout.
    onUseExisting: async (member, { then = null } = {}) => {
      const m = (st.model?.members || []).find((x) => x.projectKey === member);
      const ok = await confirm({ title: then ? `Open ${then.label} in your folder?` : 'Use the folder that has this branch?',
        message: ['Worca will use ', { strong: m?.heldBy || 'that folder' }, ' for this run: ',
          then ? `${then.label} opens there, and so do` : 'Terminal, Finder and', ' the project\'s actions. It is your folder, so Worca never deletes or changes it, and setup does not run there by itself. Unlink stops using it.'],
        confirmLabel: then ? `Use it and open ${then.label}` : 'Use this folder' });
      if (!ok) return;
      const r = await after(await api('POST', `${base}/checkout${q}`, { members: [member], useExisting: true }));
      if (r?.ok && then) await handlers.onBuiltin(member, then.key);
    },
    onUnlink: async (member) => {
      const m = (st.model?.members || []).find((x) => x.projectKey === member);
      const r = await releaseCheckout({ api, url: `${base}/checkout${q}`, members: [member], external: true,
        dir: m?.checkout?.worktreeDir || 'the folder', confirm });
      if (r && (await after(r))?.ok) { st.notice = released(true, r); render(); }
    },
    onDiscard: async (members) => {
      const r = await releaseCheckout({ api, url: `${base}/checkout${q}`, members, confirm });
      if (r && (await after(r))?.ok) { st.notice = released(false, r); render(); }
    },
    // Download patch: a read-only patch of the checkout's uncommitted changes. The page fetches and saves it.
    ...(downloadPatch ? { onDiff: async (member, btnEl) => {
      const m = (st.model?.members || []).find((x) => x.projectKey === member);
      const qs = new URLSearchParams(scopeQuery || '');
      if (member) qs.set('member', member);
      await downloadPatch({ url: `${base}/checkout/diff?${qs}`, branch: m?.branch || runId, btn: btnEl });
    } } : {}),
    onStart: async (member, actionId) => {
      const r = await api('POST', `${base}/actions/${encodeURIComponent(actionId)}/start${q}`, { member });
      if (!r.ok) return fail(r);
      st.notice = null;
      if (r.status === 202) {
        st.queued.add(`${member}:${actionId}`);
        subscribe(r.data?.instanceId || instanceIdOf(member, actionId));
      } else {
        upsert(r.data);
        if (r.data?.instanceId) subscribe(r.data.instanceId);
      }
      render();
    },
    onStop: async (member, actionId) => after(await api('POST', `${base}/actions/${encodeURIComponent(actionId)}/stop${q}`, { member })),
    onBuiltin: async (member, key) => { const r = await api('POST', `${base}/builtins/${encodeURIComponent(key)}${q}`, { member }); if (!r.ok) fail(r); },
    // Terminal / Finder / Editor before Check out: they open the checkout folder, so ask, check out, then open.
    onOpenBeforeCheckout: async (member, key, label) => {
      const m = (st.model?.members || []).find((x) => x.projectKey === member);
      if (m?.heldBy) return handlers.onUseExisting(member, { then: { key, label } });
      // Parts, not one string: the branch and the setup command are bold in the dialog (confirmModal).
      const ok = await confirm({ title: `Check out to open ${label}?`,
        message: [`${label} opens the run's checkout, which doesn't exist yet. Worca checks out `,
          m?.branch ? { strong: m.branch } : "the run's branch", ` first (a few seconds), then opens ${label}.`,
          ...(m?.setup ? [' Then the setup command runs: ', { strong: m.setup }] : [])],
        confirmLabel: `Check out and open` });
      if (!ok) return;
      const r = await after(await api('POST', `${base}/checkout${q}`, { members: [member] }));
      if (r?.ok) await handlers.onBuiltin(member, key);
    },
    onSetupAgain: async (member) => {
      const r = await api('POST', `${base}/setup${q}`, { member });
      if (!r.ok) return fail(r);
      if (r.data?.instanceId) subscribe(r.data.instanceId);
      await refresh();
    },
    onCopy: async (text) => {
      try { await doc.defaultView?.navigator?.clipboard?.writeText(text); st.notice = { text: 'Copied', kind: 'ok' }; }
      catch { st.notice = { text: 'Copy failed; select the text by hand.', kind: 'error' }; }
      render();
    },
    onStack: async (stackId, op) => after(await api('POST', `${base}/stacks/${encodeURIComponent(stackId)}/${op === 'stop' ? 'stop' : 'start'}${q}`, {})),
  };

  function onFrame(msg) {
    if (st.dead || !msg || typeof msg.instanceId !== 'string' || !msg.instanceId.startsWith(prefix)) return;
    if (Number.isInteger(msg.seq)) {
      if (msg.seq <= (st.lastSeq.get(msg.instanceId) ?? -Infinity)) return;
      st.lastSeq.set(msg.instanceId, msg.seq);
    }
    if (msg.type === 'action-line') {
      const line = { stream: msg.stream || 'out', text: String(msg.text ?? '') };
      const tail = st.logs.get(msg.instanceId) || [];
      tail.push(line);
      if (tail.length > LOG_TAIL) tail.splice(0, tail.length - LOG_TAIL);
      st.logs.set(msg.instanceId, tail);
      const pre = [...host.querySelectorAll('pre.act-log')].find((x) => x.dataset.instanceId === msg.instanceId);
      if (pre) {
        pre.append(logLine(doc, line));
        while (pre.childNodes.length > LOG_TAIL) pre.firstChild.remove();
      }
      return;
    }
    if (msg.type === 'action-status') {
      if (msg.snapshot) {
        upsert(msg.snapshot);
        st.queued.delete(`${msg.snapshot.member}:${msg.snapshot.actionId}`);
      } else st.queued.delete(msg.instanceId.slice(prefix.length));
      if (typeof msg.error === 'string' && msg.error) st.notice = { text: msg.error, kind: 'error' };
      render();
    }
  }

  function destroy() { st.dead = true; host.replaceChildren(); }

  return { runId, refresh, onFrame, destroy };
}
