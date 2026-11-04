// ui/public/actions-view.mjs — Actions (issue #529): pure renderers + one live controller.
// Every renderer takes `doc` explicitly and returns detached DOM; no colour literals, no innerHTML with data.
import { copyButton, copyFromButton } from './copy-button.mjs';

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
  'no-branch': 'No branch', 'not-checked-out': 'Not checked out', 'checking-out': 'Checking out', 'setting-up': 'Setting up',
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

/** The spinner every in-flight state draws (actions-run.css: still, under reduced motion). */
function spinner(doc) { const s = h(doc, 'span', 'act-spin'); s.setAttribute('aria-hidden', 'true'); return s; }
/** A button whose press is in flight: a spinner and its "…ing" label, disabled until the server answers. */
function busyButton(b, label) {
  b.disabled = true;
  b.setAttribute('aria-busy', 'true');
  b.replaceChildren(spinner(b.ownerDocument), b.ownerDocument.createTextNode(label));
  return b;
}
/** A live status line under the row: a spinner, then what is happening now. */
function statusRow(doc, ...parts) {
  const p = h(doc, 'p', 'act-status');
  p.setAttribute('role', 'status');
  p.append(spinner(doc), ...parts);
  return p;
}
/** When the setup now running began: its instance's start, else the checkout's `running` stamp (the job has
 *  only just begun and has no instance yet). */
function setupSince(m, mine) {
  const inst = latest(mine.filter((s) => s.actionId === '__setup' && ACTIVE.has(s.status)));
  if (inst?.startedAt) return inst.startedAt;
  const at = m.checkout?.setup?.status === 'running' ? Date.parse(m.checkout.setup.at) : NaN;
  return Number.isFinite(at) ? at : null;
}
/** "Running setup: <cmd> · 12s · usually ~20s". The elapsed span carries its start, so the controller's
 *  one-second tick updates it in place (the log under it is never rebuilt for a tick). */
function setupStatus(doc, m, mine, estimateMs, now) {
  const parts = [m.setup ? 'Running setup: ' : 'Running setup'];
  if (m.setup) parts.push(h(doc, 'code', 'act-cmd', m.setup));
  const since = setupSince(m, mine);
  if (since != null) {
    const el = h(doc, 'span', 'act-elapsed', formatUptime(now - since));
    el.dataset.since = String(since);
    parts.push(' · ', el);
  }
  if (estimateMs) parts.push(` · usually ~${formatUptime(estimateMs)}`);
  return statusRow(doc, ...parts);
}

/** Long branch names and paths keep both ends (the run id is at the end): "worca-cc/github-…-da7d143d". */
export function middleClip(text, max = 56) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) * 0.55);
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`;
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
/** A copy button (copy-button.mjs: the tick and "Copied", or the × and the reason). It copies by itself; the
 *  controller hears only of a miss, `onCopyFailed(what, text)`, and puts it in the card's notice with the text. */
function copyAct(doc, handlers, name, what, text, opts = {}) {
  const b = copyButton(doc, { name, ...opts });
  b.addEventListener('click', async () => { if (!(await copyFromButton(b, text))) handlers.onCopyFailed?.(what, text); });
  return b;
}
/** Branch and Folder as labelled rows: each mono string says what it is. */
function metaRows(doc, m, handlers) {
  const dl = h(doc, 'dl', 'act-meta');
  const row = (label, ...value) => { const dd = h(doc, 'dd'); dd.append(...value); dl.append(h(doc, 'dt', null, label), dd); };
  if (!m.branch) { row('Branch', h(doc, 'span', 'act-later', 'None: this run made no branch')); return dl; }
  const br = h(doc, 'code', 'act-branch', middleClip(m.branch)); br.title = m.branch;
  row('Branch', br, copyAct(doc, handlers, 'Copy branch name', 'branch name', m.branch, { cls: 'act-copy' }));
  const dir = m.checkout ? (m.checkout.worktreeDir || m.worktreeDir) : (m.heldBy || null);
  if (dir) {
    const p = h(doc, 'code', 'act-path', middleClip(dir, 64)); p.title = dir;
    const extra = m.checkout?.external ? [h(doc, 'span', 'badge act-linked', 'Your folder')]
      : !m.checkout && m.heldBy ? [h(doc, 'span', 'act-later', 'already has this branch')] : [];
    row('Folder', p, copyAct(doc, handlers, 'Copy folder path', 'folder path', dir, { cls: 'act-copy' }), ...extra);
  } else row('Folder', h(doc, 'span', 'act-later', 'Created when you check out'));
  return dl;
}

function memberCard(model, m, { doc, handlers, logs, queued, busy, now }) {
  const sec = h(doc, 'section', 'card act-card');
  sec.dataset.member = m.projectKey;
  const mine = instancesOf(model, m.projectKey);
  // `busy`: the presses still waiting for the server (controller keys `checkout:<pk>`, `discard:<pk>`, `start:<pk>:<id>`).
  const isBusy = (what) => !!busy?.has(`${what}:${m.projectKey}`);
  let state = memberViewState(m, mine);
  if (state === 'not-checked-out' && isBusy('checkout')) state = 'checking-out';
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
  const copyBtn = () => (m.copyCommand ? copyAct(doc, handlers, 'Copy command', 'command', m.copyCommand,
    { action: true, title: 'Copy the git commands that put this branch in your own clone' }) : null);
  const discardBtn = () => {
    const b = m.checkout?.external
      ? btn(doc, 'Unlink', 'btn act-discard', () => handlers.onUnlink?.(m.projectKey),
        'Stop using your folder for this run. Running services stop; the folder and its changes stay as they are.')
      : btn(doc, 'Discard', 'btn act-discard', () => handlers.onDiscard?.([m.projectKey]),
        'Delete the checkout folder. Running services stop, and uncommitted changes are saved as a patch first.');
    return isBusy('discard') ? busyButton(b, m.checkout?.external ? 'Unlinking…' : 'Discarding…') : b;
  };
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

  if (state === 'not-checked-out' || state === 'checking-out') {
    const checkingOut = state === 'checking-out';
    const row = h(doc, 'div', 'act-row');
    if (!model.workspace && m.heldBy) row.append(btn(doc, 'Use that folder', 'btn-primary', () => handlers.onUseExisting?.(m.projectKey),
      'Use the folder that already has this branch for this run. Worca never changes or deletes it.'));
    else if (!model.workspace) {
      const b = btn(doc, 'Check out', 'btn-primary', () => handlers.onCheckout?.([m.projectKey]),
        `Put this run's branch in a folder of its own${m.setup ? ', then run the setup command' : ''}`);
      row.append(checkingOut ? busyButton(b, 'Checking out…') : b);
    }
    const c = copyBtn(); if (c) row.append(c);
    // The other built-ins open the checkout folder, which Check out creates: a click asks first, then checks
    // out and opens (a workspace run checks out from its checklist, so there they wait for it).
    const opens = model.enabled ? (m.builtins || []).filter((b) => b.key !== 'copyCommand') : [];
    if (opens.length) {
      row.append(h(doc, 'span', 'act-sep'));
      for (const b of opens) {
        const o = btn(doc, b.label, null, () => handlers.onOpenBeforeCheckout?.(m.projectKey, b.key, b.label));
        if (model.workspace || checkingOut) { o.disabled = true; o.title = 'Available after Check out'; }
        else o.title = m.heldBy ? `${builtinTip(b.key, b.label, 'the folder that has this branch')} (asks first)` : `Check out first (asks), then: ${builtinTip(b.key, b.label).replace(/^./, (c) => c.toLowerCase())}`;
        row.append(o);
      }
    }
    if (row.childNodes.length) sec.append(row);
    if (checkingOut) sec.append(statusRow(doc, `Checking out ${middleClip(m.branch)}…`));
    // One note under the row: what waits for Check out, then what this machine lacks.
    const names = opens.map((b) => b.label).join(', ').replace(/, ([^,]*)$/, ' and $1');
    const waits = !opens.length ? '' : model.workspace ? `${names} open the checkout, so they work after Check out.`
      : m.heldBy ? `${names} open that folder.` : `${names} open the checkout, so they check out first.`;
    const lead = m.heldBy && !model.workspace
      ? 'This branch is already checked out in that folder, so Worca can use it instead of making a copy. Worca never deletes or changes your folder.'
      : `Check out takes ${estimateText(model.estimate?.lastSetupMs, !!m.setup)}.`;
    const note = appsNote(`${lead}${waits ? ` ${waits}` : ''}`);
    if (note) sec.append(note);
    return sec;
  }

  const setup = m.checkout.setup || {};
  const row = h(doc, 'div', 'act-row');
  if (state === 'setting-up') {
    // The estimate is the first member's project's last setup (the model carries only that one).
    const est = model.members?.[0]?.projectKey === m.projectKey ? model.estimate?.lastSetupMs : null;
    sec.append(setupStatus(doc, m, mine, est, now));
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
      const b = btn(doc, a.label, a.kind === 'service' ? 'btn-primary' : null, () => handlers.onStart?.(m.projectKey, a.id), actionTip(a));
      row.append(busy?.has(`start:${m.projectKey}:${a.id}`) ? busyButton(b, 'Starting…') : b);
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
    // Started but not ready yet (the ready check still waits): a spinner, never an uptime that reads as "up".
    if (s.status !== 'ready' && !s.readyError) {
      const w = h(doc, 'span', 'act-starting'); w.append(spinner(doc), doc.createTextNode('Starting…')); line.append(w);
    } else if (s.startedAt) line.append(h(doc, 'span', 'act-uptime', `up ${formatUptime(now - s.startedAt)}`));
    if (s.readyError) line.append(h(doc, 'span', 'hint act-ready-error', s.readyError));
    sec.append(line);
  }
  const task = latest(mine.filter((s) => s.kind === 'task' && s.actionId !== '__setup' && TERMINAL.has(s.status)));
  if (state === 'task-result' && task) {
    const ok = task.exitCode === 0;
    sec.append(h(doc, 'p', `act-exit ${ok ? 'ok' : 'fail'}`, `${labelOf(m, task)} ${task.status} (exit ${task.exitCode ?? '?'})`));
  }
  // While setup runs, and after it failed, the log shown is setup's own (an older action's never covers it).
  const setupState = state === 'setting-up' || state === 'setup-failed';
  const shown = (setupState && latest(mine.filter((s) => s.actionId === '__setup'))) || latest(mine);
  if (shown && logs) sec.append(renderLog(doc, shown.instanceId, logs.get(shown.instanceId)));
  return sec;
}

/** One section.card.act-card per member. A workspace run adds a member checklist and stack rows on top. */
export function renderActionsCard(model, { doc, handlers = {}, logs = null, queued = null, notice = null, busy = null, now = Date.now() } = {}) {
  const root = h(doc, 'div', 'act-view');
  if (notice) {
    // kind 'error' | 'ok' (and older 'err'): an error is a tinted alert box, a success a green status line.
    const err = notice.kind === 'error' || notice.kind === 'err';
    const p = h(doc, 'p', `act-notice ${err ? 'err' : notice.kind === 'ok' ? 'ok' : ''}`.trim());
    p.setAttribute('role', err ? 'alert' : 'status');
    root.append(appendWithPageLinks(doc, p, notice.text));
  }
  const members = model.members || [];
  if (model.workspace && model.finished !== false) {
    const open = members.filter((m) => m.branch && !m.checkout);
    if (open.length) {
      const list = h(doc, 'div', 'act-members');
      for (const m of open) {
        const lab = h(doc, 'label', 'act-member');
        const cb = h(doc, 'input'); cb.type = 'checkbox'; cb.checked = true; cb.value = m.projectKey;
        lab.append(cb, doc.createTextNode(` ${m.projectName || m.projectKey}`));
        list.append(lab);
      }
      const all = btn(doc, 'Check out selected', 'btn-primary', () => {
        handlers.onCheckout?.([...list.querySelectorAll('input[type="checkbox"]')].filter((x) => x.checked).map((x) => x.value));
      }, 'Put the ticked members\' branches in folders of their own');
      list.append(open.some((m) => busy?.has(`checkout:${m.projectKey}`)) ? busyButton(all, 'Checking out…') : all);
      root.append(list);
    }
    for (const st of model.stacks || []) {
      const cur = (model.stackStates || []).find((x) => x.stackId === st.id);
      const busy = cur && ['starting', 'running'].includes(cur.status);
      const line = h(doc, 'div', 'act-row act-stack');
      line.append(h(doc, 'span', 'act-label', st.label || st.id));
      if (cur) line.append(h(doc, 'span', 'badge act-state', cur.status));
      if (busy) line.append(btn(doc, 'Stop stack', 'btn-danger', () => handlers.onStack?.(st.id, 'stop'), 'Stop what this stack started, newest first'));
      else if (model.enabled) line.append(btn(doc, 'Start stack', 'btn-primary', () => handlers.onStack?.(st.id, 'start'), 'Start this stack\'s steps in order, each member checked out and set up first'));
      if (cur?.error) line.append(h(doc, 'span', 'hint act-exit fail', cur.error));
      root.append(line);
    }
  }
  for (const m of members) root.append(memberCard(model, m, { doc, handlers, logs, queued, busy, now }));
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
    row.append(h(doc, 'span', 'act-label', 'Try the result in a local checkout.'));
    if (model.finished !== false) row.append(btn(doc, 'Check out', 'btn-primary', () => handlers.onCheckout?.(), 'Put this run\'s branch in a folder of its own, to try it'));
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
  // busy: key → shown. A key is held from the press until its refresh is done, so a second press does nothing;
  // `shown` turns on when the request goes out (Discard's after its confirm), and only shown keys draw as busy.
  const st = { model: null, dead: false, lastSeq: new Map(), logs: new Map(), queued: new Set(), subscribed: new Set(), notice: null,
    busy: new Map(), ticker: null };
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
    const busy = new Set([...st.busy].filter(([, shown]) => shown).map(([k]) => k));
    host.replaceChildren(renderActionsCard(st.model, { doc, handlers, logs: st.logs, queued: st.queued, notice: st.notice, busy }));
    // Setup's elapsed time ticks in place once a second, and only while one is on screen.
    const ticking = !!host.querySelector('.act-elapsed');
    if (ticking && !st.ticker) st.ticker = setInterval(tickElapsed, 1000);
    else if (!ticking && st.ticker) { clearInterval(st.ticker); st.ticker = null; }
  }
  function tickElapsed() {
    for (const el of host.querySelectorAll('.act-elapsed')) el.textContent = formatUptime(Date.now() - Number(el.dataset.since));
  }
  /** Runs one press for `keys` (one per member, or per action). A press while any of them is held does nothing.
   *  `fn(show)` gets the hook that turns the busy look on; `showNow` turns it on at once. */
  async function busyWhile(keys, fn, { showNow = true } = {}) {
    if (!keys.length || keys.some((k) => st.busy.has(k))) return undefined;
    for (const k of keys) st.busy.set(k, showNow);
    if (showNow) render();
    const show = () => { for (const k of keys) if (st.busy.has(k)) st.busy.set(k, true); render(); };
    try { return await fn(show); } finally { for (const k of keys) st.busy.delete(k); render(); }
  }
  const memberKeys = (what, members) => (members || (st.model?.members || []).filter((m) => m.branch && !m.checkout).map((m) => m.projectKey))
    .map((pk) => `${what}:${pk}`);
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
    if (!r.ok && r.data?.code === 'BRANCH_CHECKED_OUT') { st.notice = null; await refresh(); return undefined; }   // the card offers that folder
    if (!r.ok) return fail(r);
    st.notice = null; await refresh(); return r;
  };
  // What a Discard / Unlink did, said in the card (the words the summary card's toast used).
  const released = (external, r) => ({ kind: 'ok', text: external ? 'Folder unlinked. The folder stays as it was.'
    : `Checkout discarded. ${(r.data?.patches || []).length ? 'Uncommitted changes were saved as a patch in the run\'s files.' : 'Nothing uncommitted needed saving.'}` });

  const handlers = {
    onCheckout: async (members) => busyWhile(memberKeys('checkout', members),
      async () => after(await api('POST', `${base}/checkout${q}`, members ? { members } : {}))),
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
    // Busy from the DELETE (after the confirm) until the refreshed card is up; held from the press, so a second
    // press while the confirm is open asks nothing.
    onUnlink: async (member) => busyWhile([`discard:${member}`], async (show) => {
      const m = (st.model?.members || []).find((x) => x.projectKey === member);
      const r = await releaseCheckout({ api: (...a) => { show(); return api(...a); }, url: `${base}/checkout${q}`, members: [member], external: true,
        dir: m?.checkout?.worktreeDir || 'the folder', confirm });
      if (r && (await after(r))?.ok) st.notice = released(true, r);
    }, { showNow: false }),
    onDiscard: async (members) => busyWhile(memberKeys('discard', members), async (show) => {
      const r = await releaseCheckout({ api: (...a) => { show(); return api(...a); }, url: `${base}/checkout${q}`, members, confirm });
      if (r && (await after(r))?.ok) st.notice = released(false, r);
    }, { showNow: false }),
    // Download patch: a read-only patch of the checkout's uncommitted changes. The page fetches and saves it.
    ...(downloadPatch ? { onDiff: async (member, btnEl) => {
      const m = (st.model?.members || []).find((x) => x.projectKey === member);
      const qs = new URLSearchParams(scopeQuery || '');
      if (member) qs.set('member', member);
      await downloadPatch({ url: `${base}/checkout/diff?${qs}`, branch: m?.branch || runId, btn: btnEl });
    } } : {}),
    onStart: async (member, actionId) => busyWhile([`start:${member}:${actionId}`], async () => {
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
      return undefined;
    }),
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
      // The card shows Checking out while the POST is out, as a Check out press does.
      const r = await busyWhile([`checkout:${member}`], async () => after(await api('POST', `${base}/checkout${q}`, { members: [member] })));
      if (r?.ok) await handlers.onBuiltin(member, key);
    },
    onSetupAgain: async (member) => {
      const r = await api('POST', `${base}/setup${q}`, { member });
      if (!r.ok) return fail(r);
      if (r.data?.instanceId) subscribe(r.data.instanceId);
      await refresh();
    },
    // A copy shows on its own button; only a miss reaches the notice, which outlasts the flash and holds the text.
    onCopyFailed: (what, text) => {
      st.notice = { text: `Could not copy the ${what}. Copy it from here: ${text}`, kind: 'error' };
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
        // An instance the last refresh did not list (setup, which starts after Check out answers): its lines replay.
        subscribe(msg.snapshot.instanceId);
        st.queued.delete(`${msg.snapshot.member}:${msg.snapshot.actionId}`);
      } else st.queued.delete(msg.instanceId.slice(prefix.length));
      if (typeof msg.error === 'string' && msg.error) st.notice = { text: msg.error, kind: 'error' };
      render();
    }
  }

  function destroy() { st.dead = true; if (st.ticker) clearInterval(st.ticker); st.ticker = null; host.replaceChildren(); }

  return { runId, refresh, onFrame, destroy };
}
