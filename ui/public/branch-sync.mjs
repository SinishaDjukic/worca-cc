// ui/public/branch-sync.mjs
// Sync-before-run UI (#527): the status pill + Sync button + Auto-sync switch under the Source
// branch dropdown, the details dialog, the diverged/offline chooser, and the Projects chips.
// Models are pure (unit-tested without a DOM); the dialogs follow modal-guard.mjs
// (Escape and a real outside click close them; focus returns to the opener).
import { icon } from './icons.mjs';
import { guardModal } from './modal-guard.mjs';

const WORD = { diverged: 'diverged', dirty: 'dirty', behind: 'behind', offline: 'offline', local: 'not on the remote', ok: 'up to date' };
const TONE = { diverged: 'amber', dirty: 'amber', behind: 'blue', offline: 'grey', local: 'grey', ok: 'green' };
const RANK = { diverged: 4, dirty: 3, behind: 2, offline: 1, local: 0.5, ok: 0 };   // no ties: the workspace chip must not depend on member order

export function ago(isoStr, now = Date.now()) {
  const t = Date.parse(isoStr || '');
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
/** "3 min ago", or — with no fetch time — "never" only when nothing failed: a failed fetch can
 *  wipe FETCH_HEAD, and "never" would then deny a fetch that did happen. */
export function fetchedAgo(b, now = Date.now()) {
  if (Number.isFinite(Date.parse((b && b.fetchedAt) || ''))) return ago(b.fetchedAt, now);
  return b && (b.stale || b.fetchError) ? 'unknown (the last fetch failed)' : 'never';
}
const count = (n, shallow) => `${shallow ? 'at least ' : ''}${n}`;

/** The form's `state.sync`, one complete shape for every reset (a `members` write never hits undefined). */
export function freshSyncState(gen = 0) {
  return { block: null, autoSync: null /* null = follow the project default */, busy: false, members: {}, gen };
}

/** CSS.escape with a fallback for jsdom, which has no window.CSS. */
export function cssEscape(s) {
  s = String(s == null ? '' : s);
  const css = globalThis.CSS;
  return (css && css.escape) ? css.escape(s) : s.replace(/["\\\]]/g, '\\$&');
}

/** Twin of src/core/git-sync.mjs#isSafeBranchName (test/ui-branch-sync-model.test.mjs pins them
 *  together): a base the server refuses to sync. The UI paints it Unknown without asking. */
export function isSyncableBranchName(s) {
  if (typeof s !== 'string' || !s || s.length > 255) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(s) || /^[0-9a-f]{40}$/i.test(s)) return false;
  if (s.startsWith('-') || s.startsWith('/') || s.endsWith('/') || s.endsWith('.') || s.endsWith('.lock')) return false;
  if (s.includes('..') || s.includes('//')) return false;
  return s.split('/').every((c) => c && !c.startsWith('.') && !c.endsWith('.lock'));
}

/** The pill under Source branch. hidden:true → no remote: hide pill AND switch (edge case table). */
export function syncPillModel(sync, { autoSync = true } = {}) {
  if (!sync || !sync.remote) return { hidden: true };
  if (sync.stale || sync.fetchError) return { tone: 'grey', label: 'Offline', state: 'offline' };
  switch (sync.state) {
    case 'behind': return autoSync
      ? { tone: 'blue', label: `${count(sync.behind, sync.shallow)} behind`, state: 'behind' }
      : { tone: 'amber', label: `${count(sync.behind, sync.shallow)} behind`, state: 'behind-off' };
    case 'diverged': return { tone: 'amber', label: 'Diverged', state: 'diverged' };
    case 'remote-only': return { tone: 'blue', label: 'Remote only', state: 'remote-only' };
    case 'no-upstream': return { tone: 'grey', label: `Not on ${sync.remote}`, state: 'no-upstream' };
    case 'up-to-date': case 'ahead': return { tone: 'green', label: 'Up to date', state: 'up-to-date' };
    default: return { tone: 'grey', label: 'Unknown', state: 'unknown' };
  }
}

const nCommits = (k, adj, shallow) => `${count(k, shallow)} ${adj} commit${k === 1 ? '' : 's'}`;

/** One row of the New pipeline Branches table: what the run will get, in words, for one project
 *  or many (design v3). `origin` = "Use branches from Origin · latest" (sync before run).
 *  → { icon, tone, text, note, retry, blocked }. icon ∈ ok|behind|dirty|diverged|offline|blocked|local|none. */
export function runOutcomeModel(sync, { origin = true, base = '' } = {}) {
  const o = { icon: 'ok', tone: 'ok', text: 'Up to date', note: '', retry: false, blocked: false };
  if (sync === undefined) return { ...o, icon: 'none', tone: 'muted', text: 'Checking…' };
  if (!sync || !sync.remote) return { ...o, icon: 'local', tone: 'muted', text: 'No remote · uses your local copy' };
  const b = sync.base || base;
  const dirty = !!(sync.dirty && sync.checkedOutHere);
  if (sync.stale || sync.fetchError) {
    return origin
      ? { ...o, icon: 'offline', tone: 'ink', text: `Can’t reach ${sync.remote} · uses the last fetch, ${fetchedAgo(sync)}`, retry: true }
      : { ...o, icon: 'local', tone: 'muted', text: `Uses your local ${b}` };
  }
  switch (sync.state) {
    case 'behind':
      Object.assign(o, origin
        ? { icon: 'behind', tone: 'blue', text: `Gets ${nCommits(sync.behind, 'new', sync.shallow)} from ${sync.remote} first` }
        : { icon: 'behind', tone: 'amber', text: `Misses ${nCommits(sync.behind, 'newer', sync.shallow)} on ${sync.remote}` });
      break;
    case 'diverged': {
      const ahead = nCommits(sync.ahead || 0, 'unpushed');
      if (!origin) Object.assign(o, { icon: 'diverged', tone: 'amber', text: `Includes your ${ahead}`, note: `Misses ${nCommits(sync.behind || 0, 'newer', sync.shallow)} on ${sync.remote}` });
      else if (sync.settings && sync.settings.onDiverged === 'fail') Object.assign(o, { icon: 'blocked', tone: 'red', text: `Can’t start from ${sync.remote}`, note: `Its ${ahead} would be left out, and this project is set to stop. Push them, or use Local copy.`, blocked: true });
      else Object.assign(o, { icon: 'diverged', tone: 'amber', text: `Your ${ahead} ${(sync.ahead || 0) === 1 ? 'is' : 'are'} left out`, note: 'Want them in? Use Local copy.' });
      break;
    }
    case 'remote-only': Object.assign(o, { icon: 'ok', tone: 'muted', text: `Only on ${sync.remote} · starts from ${sync.remote}/${b}` }); break;
    case 'no-upstream': case 'missing': Object.assign(o, { icon: 'local', tone: 'ink', text: `Not on ${sync.remote} yet · uses your local copy` }); break;
    case 'up-to-date': case 'ahead': break;
    default: return { ...o, icon: 'none', tone: 'muted', text: 'Status unknown' };
  }
  // Dirty no longer hides behind: a row can state two facts joined by ·.
  if (dirty) {
    if (o.icon === 'ok') Object.assign(o, { icon: 'dirty', tone: 'ink', text: 'Uncommitted changes not included' });
    else o.note = o.note ? `${o.note} · Uncommitted changes not included` : 'Uncommitted changes not included';
  }
  return o;
}

/** An unborn repo (Use git, no commit yet): the no-remote bar's and the Branch card's hint. */
export const NO_COMMITS_HINT = 'No commits yet · the first run commits these files';

/** One row of the Workspaces list's project table (design board 1): what the repo is, and the one
 *  thing Worca can do about it. action ∈ sync|details|retry|null — Worca never merges or resets.
 *  `dirty` no longer hides `behind`: a dirty repo that is behind says both. */
export function listRowModel(b) {
  if (!b || !b.remote) return { icon: 'local', tone: 'muted', label: 'No remote', hint: '', action: null, state: 'none' };
  if (b.noCommits) return { icon: 'local', tone: 'ink', label: 'No commits yet', hint: 'The first run commits these files', action: null, state: 'local' };
  if (b.state === 'unknown') return { icon: 'none', tone: 'muted', label: 'Status unknown', hint: '', action: null, state: 'none' };
  const dirty = !!(b.dirty && b.checkedOutHere);
  const autoSync = !(b.settings && b.settings.beforeRun === false);
  if (b.stale) return { icon: 'offline', tone: 'ink', label: `Can’t reach ${b.remote}`, hint: `Last fetched ${fetchedAgo(b)}`, action: 'retry', state: 'offline' };
  if (b.state === 'diverged') {
    const next = b.settings && b.settings.onDiverged === 'fail' ? 'runs won’t start until it’s pushed'
      : b.settings && b.settings.onDiverged === 'origin' ? `runs start from ${b.remote}` : 'next run will ask';
    return { icon: 'diverged', tone: 'amber', label: 'Diverged', hint: `${b.ahead || 0} ahead, ${count(b.behind || 0, b.shallow)} behind · ${next}`, action: 'details', state: 'diverged' };
  }
  if (b.state === 'behind') {
    const n = `${count(b.behind, b.shallow)} commit${b.behind === 1 ? '' : 's'} behind`;
    if (dirty) return { icon: 'behind', tone: 'blue', label: n, hint: 'Uncommitted changes, so Sync can’t move it · runs use committed code', action: null, state: 'behind', dirty: true };
    return { icon: 'behind', tone: 'blue', label: n, hint: autoSync ? 'Runs sync it first anyway' : 'Runs start from your local copy', action: 'sync', state: 'behind' };
  }
  if (b.state === 'no-upstream' || b.state === 'missing') return { icon: 'local', tone: 'ink', label: `Not on ${b.remote} yet`, hint: dirty ? 'Uncommitted changes · runs use committed code' : '', action: null, state: 'local', dirty };
  if (dirty) return { icon: 'dirty', tone: 'ink', label: 'Uncommitted changes', hint: 'Runs use committed code only', action: null, state: 'dirty', dirty: true };
  return { icon: 'ok', tone: 'ok', label: 'Up to date', hint: '', action: null, state: 'ok' };
}

const BAR_TONE = { ok: 'ok', behind: 'blue', diverged: 'amber', dirty: 'peach' };
const BAR_ACTION = { sync: 'Sync', details: 'Review…', retry: 'Retry' };
const BAR_GROUP = { ok: 'ok', behind: 'behind', diverged: 'diverged', dirty: 'dirty', offline: 'offline', local: 'local' };
/** The Projects list's sync bar (branch | origin status | action, design 2026-10-01): listRowModel's
 *  facts in the list's own words. `tone` tints the pill and the bar (none = dashed, no remote);
 *  `vs` is the ref the branch is compared with — refs/remotes/<remote>/<base>, not the configured
 *  upstream — so it is left out where the branch is not on the remote; `group` is the header filter
 *  the row counts toward. `b === undefined` = no answer yet. */
export function projectBarModel(b) {
  const base = { hint: '', action: null, actionLabel: '', vs: '' };
  if (b === undefined) return { ...base, icon: 'spin', tone: 'grey', label: 'Checking…', state: 'checking', group: null };
  if (!b || !b.remote) return { ...base, icon: 'noRemote', tone: 'none', label: 'No git remote', hint: b && b.noCommits ? NO_COMMITS_HINT : 'Local folder · nothing to sync', state: 'none', group: 'local' };
  const m = listRowModel(b);
  const bar = { ...m, tone: BAR_TONE[m.state] || 'grey', actionLabel: BAR_ACTION[m.action] || '',
    vs: b.base && m.state !== 'local' ? `${b.remote}/${b.base}` : '', group: BAR_GROUP[m.state] || null };
  if (m.action === 'sync') bar.hint = b.settings && b.settings.beforeRun === false ? 'Auto-sync is off · runs start from your local copy' : 'Next run syncs it first';
  if (m.state === 'local' && !m.hint) bar.hint = 'Runs use your local copy';
  return bar;
}

/** The collapsed workspace header: one sentence with the counts, its tone, and who Sync all moves. */
export function wsRollupModel(rows) {
  const n = (s) => rows.filter((r) => r.state === s).length;
  const diverged = n('diverged'); const offline = n('offline'); const behind = n('behind');
  const dirty = rows.filter((r) => r.dirty || r.state === 'dirty').length;
  const ok = n('ok');
  const parts = [];
  if (diverged) parts.push(`${diverged} diverged`);
  if (offline) parts.push(`${offline} can’t reach origin`);
  if (behind) parts.push(`${behind} behind`);
  if (dirty) parts.push(`${dirty} with uncommitted changes`);
  const known = rows.filter((r) => r.state !== 'none').length;
  if (!parts.length) {
    return { text: known ? (known === rows.length ? `All ${rows.length} up to date` : `${ok} up to date`) : 'Checking…', tone: known ? 'ok' : 'muted' };
  }
  if (ok) parts.push(`${ok} up to date`);
  return { text: parts.join(' · '), tone: diverged ? 'amber' : behind ? 'blue' : 'muted' };
}

/** Projects/Workspaces chip — must match src/core/project-sync.mjs#chipState. */
export function chipState(b) {
  if (!b || !b.remote || b.state === 'unknown') return null;
  if (b.stale) return 'offline';
  if (b.state === 'diverged') return 'diverged';
  if (b.dirty && b.checkedOutHere) return 'dirty';
  if (b.state === 'behind') return 'behind';
  // remote-only = the branch IS on the remote, only the local copy is missing: no chip, never "not on the remote".
  if (b.state === 'remote-only') return null;
  if (b.state === 'no-upstream' || b.state === 'missing') return 'local';
  return 'ok';
}
export function projectChipModel(b) {
  const s = chipState(b);
  if (!s) return null;
  const word = s === 'behind' ? `${count(b.behind, b.shallow)} behind` : WORD[s];
  return { state: s, tone: TONE[s], text: `${b.base} · ${word}`, action: s === 'diverged' ? 'Review…' : 'Sync' };
}
export function worstChip(blocks) {
  const states = (blocks || []).map(chipState).filter(Boolean).sort((a, b) => RANK[b] - RANK[a]);
  return states[0] ? { state: states[0], tone: TONE[states[0]], text: WORD[states[0]] } : null;
}
/** Ask proposal card suffix: "remote only", "2 behind", "stale". */
export function sourceRefNote(ref) {
  if (!ref) return '';
  const bits = [];
  if (ref.remoteOnly) bits.push('remote only');
  if (ref.behind > 0) bits.push(`${ref.behind} behind`);
  if (ref.stale) bits.push('could not fetch: last known refs');
  return bits.length ? `from ${ref.ref} (${bits.join(', ')})` : '';
}

/** Copy for a fetch failure kind — never from stderr. */
export function fetchFailureCopy(kind, remote = 'origin') {
  return {
    auth: `Sign-in to ${remote} failed. Worca will start from the last fetch instead.`,
    network: `${remote} could not be reached. Worca will start from the last fetch instead.`,
    timeout: `${remote} did not answer in time. Worca will start from the last fetch instead.`,
  }[kind] || `Fetching ${remote} failed. Worca will start from the last fetch instead.`;
}

/** Why a Sync did not move the base (POST answer's sync.ff), or '' when it did / nothing to say.
 *  The issue's "dirty → fetch only" case: without this the pill just stays "3 behind". */
export function ffRefusalCopy(ff, base, remote = 'origin') {
  if (!ff || ff.ok) return '';
  return {
    dirty: `${base} has uncommitted changes, so it was not moved. Runs start from ${remote}/${base} in their own worktree.`,
    'in-use': `${base} is checked out in another worktree, so it was not moved. Runs start from ${remote}/${base}.`,
    diverged: `${base} has diverged from ${remote}/${base}. Nothing was moved.`,
  }[ff.kind] || `Could not update ${base}.`;
}

/** The run header's Sync button label from a member's sync record (plan D6, §6.5). Short and
 *  branch-free: the source branch already sits on the left of the same row (.rd-base). */
export function syncStageLabel(record) {
  if (!record) return 'Sync';
  const n = record.commits || 0;
  switch (record.result) {
    case 'fast-forwarded': return `Synced ${n} commit${n === 1 ? '' : 's'}`;
    case 'remote-start': return `From ${record.remote || 'origin'}`;
    case 'fetch-failed': return 'Used last fetch';
    case 'diverged': return 'Diverged';
    default: return 'Sync';
  }
}

/** The Sync button's tooltip: the long form of syncStageLabel plus what a click does. */
export function syncStageTitle(record, base = '') {
  const action = 'Show the Sync log';
  if (!record) return action;
  const remote = record.remote || 'origin';
  const n = record.commits || 0;
  switch (record.result) {
    case 'fast-forwarded': return `Synced ${n} commit${n === 1 ? '' : 's'} from ${remote}/${base}. ${action}`;
    case 'remote-start': return `Started from ${remote}/${base}: the local branch was left untouched. ${action}`;
    case 'fetch-failed': return `Could not fetch ${remote}: started from the last fetch. ${action}`;
    case 'diverged': return `${base} has diverged from ${remote}/${base}. ${action}`;
    default: return action;
  }
}

// ── DOM helpers ────────────────────────────────────────────────────────────
// Built with the global `document` (as schedule-sheet.mjs is). Untrusted text (branch names,
// commit subjects, authors) only ever goes through textContent.

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgIcon(paths, size = 17) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
  }
  return svg;
}
// The question bubble the Q&A surfaces share (app.js questionIcon), with the mark inside it.
const questionSvg = () => svgIcon(['M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6.5L8 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z',
  'M9.9 9.1a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.9-1.1 1.6', 'M12 14.9h.01']);

const shortSha = (sha) => (sha ? String(sha).slice(0, 7) : '');

/** Bind the static #sync-row markup (index.html). Returns the host for chaining. */
export function mountSyncRow(host, { onPill, onSync, onToggle } = {}) {
  const pill = host.querySelector('.sync-pill');
  const btn = host.querySelector('.sync-btn');
  const sw = host.querySelector('input[type="checkbox"]');
  if (pill && onPill) pill.addEventListener('click', (e) => onPill(e));
  if (btn && onSync) btn.addEventListener('click', (e) => { if (!btn.disabled) onSync(e); });
  if (sw && onToggle) sw.addEventListener('change', () => onToggle(sw.checked));
  return host;
}

/** Paint #sync-row from a SyncBlock: hidden without a remote, tone + label on the pill,
 *  busy on the Sync button, the switch's checked state. Returns the pill model. */
export function paintSyncRow(host, sync, { autoSync = true, busy = false } = {}) {
  const model = syncPillModel(sync, { autoSync });
  host.hidden = !!model.hidden;
  if (model.hidden) return model;
  const pill = host.querySelector('.sync-pill');
  if (pill) {
    pill.className = `sync-pill ${model.tone}`;
    const txt = pill.querySelector('.sync-pill-txt');
    if (txt) txt.textContent = model.label;
    pill.setAttribute('aria-label', `Sync status: ${model.label}. Show details`);
  }
  const btn = host.querySelector('.sync-btn');
  // Unknown = a base the server will not sync: a Sync would only be refused (400).
  if (btn) { btn.classList.toggle('busy', !!busy); btn.disabled = !!busy || model.state === 'unknown'; }
  const sw = host.querySelector('input[type="checkbox"]');
  if (sw) sw.checked = !!autoSync;
  return model;
}

/** Shared modal lifecycle: modal-guard's Escape and backdrop rules (`kind`), focus return to the opener. */
function openModal(modal, { opener, fallbackFocus, focusEl, onClose, kind = 'decision' }) {
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    modal.remove();
    const target = opener && opener.isConnected ? opener : (typeof fallbackFocus === 'function' ? fallbackFocus() : null);
    if (target && typeof target.focus === 'function') { try { target.focus(); } catch { /* gone */ } }
    onClose(result);
  }
  document.body.append(modal);
  guardModal(modal, { kind, close: () => close(null) }).opened();
  if (focusEl) focusEl.focus();
  return close;
}

const DIVERGED_WORDS = { ask: 'Ask me', origin: 'Start from origin', fail: "Don't run" };

/** The "This project" selects: '' = follow the instance default (named in the option). */
export function syncPrefsModel(view) {
  const own = (view && view.own) || {};
  const d = (view && view.defaults) || {};
  return {
    beforeRun: {
      value: typeof own.beforeRun === 'boolean' ? String(own.beforeRun) : '',
      options: [['', `Default (${d.beforeRun === false ? 'Off' : 'On'})`], ['true', 'On'], ['false', 'Off']],
    },
    onDiverged: {
      value: own.onDiverged in DIVERGED_WORDS ? own.onDiverged : '',
      options: [['', `Default (${DIVERGED_WORDS[d.onDiverged] || 'Ask me'})`], ...Object.entries(DIVERGED_WORDS)],
    },
  };
}
/** A select's value as the PUT body: '' resets the key to the instance default. */
export function syncPrefsPatch(field, value) {
  if (field === 'beforeRun') return { beforeRun: value === '' ? null : value === 'true' };
  return { onDiverged: value === '' ? null : value };
}

/** "This project": two selects that save on change through prefs.save (PUT .../sync/settings). */
function buildPrefsSection(prefs) {
  const field = (id, label, key) => {
    const sel = h('select', { id, class: 'select', 'data-pref': key, disabled: true });
    return { sel, node: h('div', { class: 'field' }, h('label', { for: id, text: label }), h('div', { class: 'select-wrap' }, sel)) };
  };
  const before = field('syncPrefBeforeRun', 'Sync before run', 'beforeRun');
  const diverged = field('syncPrefOnDiverged', 'If the source branch has diverged', 'onDiverged');
  const msg = h('small', { class: 'hint sync-prefs-msg' });
  const section = h('div', { class: 'sync-prefs' },
    h('h3', { class: 'sync-prefs-head', text: 'This project' }),
    h('div', { class: 'field-grid-2' }, before.node, diverged.node), msg);
  const setMsg = (text, kind) => { msg.textContent = text || ''; msg.className = `hint sync-prefs-msg${kind ? ` ${kind}` : ''}`; };
  const paint = (view) => {
    const m = syncPrefsModel(view);
    for (const [f, key] of [[before, 'beforeRun'], [diverged, 'onDiverged']]) {
      f.sel.replaceChildren(...m[key].options.map(([v, t]) => h('option', { value: v, text: t })));
      f.sel.value = m[key].value;
      f.sel.disabled = false;
    }
  };
  let saving = 0;
  for (const f of [before, diverged]) {
    f.sel.addEventListener('change', async () => {
      const mine = ++saving;
      setMsg('Saving…');
      try {
        const view = await prefs.save(syncPrefsPatch(f.sel.dataset.pref, f.sel.value));
        if (mine !== saving) return;
        if (view) paint(view);
        setMsg('Saved for this project.');
      } catch (err) {
        if (mine === saving) setMsg((err && err.message) || 'Could not save', 'err');
      }
    });
  }
  Promise.resolve().then(() => prefs.load()).then((view) => { if (view) paint(view); else setMsg('Could not load this project\'s settings', 'err'); },
    (err) => setMsg((err && err.message) || 'Could not load this project\'s settings', 'err'));
  return section;
}

/**
 * The details dialog behind the pill / a chip's Review…. Resolves null when closed.
 * `onSync()` returns the new SyncBlock (or nothing: then the current block stays painted).
 * `prefs` = { load(): Promise<view>, save(patch): Promise<view> } adds the "This project" section,
 * where view = GET /api/projects/:key/sync/settings ({ own, defaults, settings }); save throws an
 * Error whose message is shown under the selects.
 */
export function openSyncDialog({ title = 'Sync status', subtitle = '', sync, autoSync = true, opener = null, onSync = null, fallbackFocus = null, prefs = null } = {}) {
  return new Promise((resolve) => {
    let cur = sync || {};
    let refusal = '';
    let busy = false;

    const xBtn = h('button', { type: 'button', class: 'btn btn-quiet btn-icon sync-x', 'aria-label': 'Close' }, icon(document, 'x', 16));
    const pill = h('span', { class: 'sync-pill grey' }, h('span', { class: 'sdot', 'aria-hidden': 'true' }), h('span', { class: 'sync-pill-txt' }));
    const kv = h('dl', { class: 'sync-kv' });
    const commitsHead = h('h3', { class: 'sync-commits-head', text: 'Incoming commits' });
    const commits = h('ol', { class: 'sync-commits' });
    const note = h('div', { class: 'sync-note', hidden: true });
    const closeBtn = h('button', { type: 'button', class: 'btn', text: 'Close' });
    const syncBtn = h('button', { type: 'button', class: 'btn btn-primary sync-go', text: 'Sync' });
    const prefsSection = prefs ? buildPrefsSection(prefs) : null;
    const card = h('div', { class: 'card sync-card' },
      h('div', { class: 'card-head' }, h('h2', { id: 'sync-dlg-title', text: title }), xBtn),
      subtitle ? h('div', { class: 'sync-sub', text: subtitle }) : null,
      pill, kv, commitsHead, commits, note, prefsSection,
      h('div', { class: 'confirm-actions' }, closeBtn, syncBtn));
    const modal = h('div', { class: 'viewer-modal confirm-modal sync-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sync-dlg-title' }, card);

    function paint() {
      const model = syncPillModel(cur, { autoSync });
      pill.hidden = !!model.hidden;
      if (!model.hidden) { pill.className = `sync-pill ${model.tone}`; pill.querySelector('.sync-pill-txt').textContent = model.label; }
      const base = cur.base || '';
      const remote = cur.remote || 'origin';
      const tip = (t) => (t && t.sha ? `${shortSha(t.sha)} · ${ago(t.at)}` : '—');
      const fetched = Date.parse(cur.fetchedAt || '');
      const rows = [
        ['Local base', tip(cur.local)],
        [`${remote}/${base}`, tip(cur.remoteTip)],
        ['Behind / ahead', `${cur.behind || 0} behind · ${cur.ahead || 0} ahead`],
        ['Last fetched', Number.isFinite(fetched) ? `${ago(cur.fetchedAt)} (${new Date(fetched).toLocaleString()})` : fetchedAgo(cur)],
        ['Remote', cur.remoteLabel || remote],
        ['Working tree', cur.dirty ? `${cur.dirtyCount || 0} changed` : 'Clean'],
        ['Auto-sync', autoSync ? 'On: updates before the run' : 'Off: starts from the local commit'],
      ];
      kv.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
      const list = Array.isArray(cur.incoming) ? cur.incoming : [];
      commitsHead.hidden = !list.length; commits.hidden = !list.length;
      commits.replaceChildren(...list.map((c) => h('li', {},
        h('code', { text: shortSha(c.sha) }), h('span', { text: c.subject || '' }), h('span', { text: ago(c.at) }))));
      const offline = cur.stale || cur.fetchError;
      const text = refusal || (offline ? fetchFailureCopy(cur.fetchError && cur.fetchError.kind, remote) : '');
      note.hidden = !text; note.textContent = text;
      syncBtn.textContent = offline ? 'Retry' : 'Sync';
      syncBtn.hidden = !cur.remote;
      syncBtn.classList.toggle('busy', busy); syncBtn.disabled = busy;
    }

    // Read-only status: its two selects save on change, so nothing is ever pending.
    const close = openModal(modal, { opener, fallbackFocus, focusEl: xBtn, onClose: resolve, kind: 'viewer' });
    xBtn.addEventListener('click', () => close(null));
    closeBtn.addEventListener('click', () => close(null));
    syncBtn.addEventListener('click', async () => {
      if (busy || !onSync) return;
      busy = true; paint();
      try {
        const next = await onSync();
        if (next) {
          cur = next;
          refusal = ffRefusalCopy(next.ff, next.base || cur.base, next.remote || 'origin');
        }
      } catch { /* the host reports; the dialog keeps its block */ }
      busy = false;
      if (modal.isConnected) paint();
    });
    paint();
  });
}

/**
 * The "ask once" card for a 409 from POST /api/run (sync-diverged / sync-fetch-failed).
 * Resolves 'origin' | 'last-fetch' | null (Cancel, Escape, scrim).
 */
export function chooseSyncRefusal(data = {}) {
  return new Promise((resolve) => {
    const members = Array.isArray(data.members) ? data.members : [];
    const first = members[0] || {};
    const remote = first.remote || 'origin';
    const base = first.base || '';
    const options = Array.isArray(data.options) ? data.options : ['cancel'];
    const diverged = data.code === 'sync-diverged';
    const many = members.length > 1;

    const body = h('div', { class: 'qbody' });
    let head; let goBtn = null; let choice = null;
    if (diverged) {
      head = `${base} has diverged from ${remote}/${base}`;
      for (const m of members) {
        const line = `${m.base} has diverged from ${m.remote || remote}/${m.base} (${m.ahead || 0} ahead, ${m.behind || 0} behind).`;
        body.append(h('p', { class: 'qtext', text: many ? `${m.projectName || m.projectKey}: ${line}` : line }));
      }
      if (options.includes('origin')) {
        goBtn = h('button', { type: 'button', class: 'btn btn-primary', text: `Start from ${remote}/${base}` });
        choice = 'origin';
        body.append(h('small', { class: 'hint', text: 'Recommended: your shared folder stays untouched.' }));
      } else {
        body.append(h('small', { class: 'hint', text: 'This project\'s sync setting does not allow starting from the remote.' }));
      }
    } else {
      head = `Could not reach ${remote}`;
      for (const m of members.length ? members : [{ remote, fetchKind: data.fetchKind }]) {
        const line = fetchFailureCopy(m.fetchKind || data.fetchKind, m.remote || remote);
        body.append(h('p', { class: 'qtext', text: many ? `${m.projectName || m.projectKey}: ${line}` : line }));
      }
      if (options.includes('last-fetch')) {
        goBtn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Start anyway' });
        choice = 'last-fetch';
      }
    }
    const cancelBtn = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
    const panel = h('div', { class: 'qpanel' },
      h('div', { class: 'qpanel-head' }, questionSvg(), h('b', { id: 'sync-refusal-title', text: head })),
      body,
      h('div', { class: 'qpanel-foot' }, cancelBtn, goBtn));
    const modal = h('div', { class: 'viewer-modal confirm-modal sync-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sync-refusal-title' },
      h('div', { class: 'card' }, panel));
    const close = openModal(modal, { opener: document.activeElement, focusEl: goBtn || cancelBtn, onClose: resolve });
    cancelBtn.addEventListener('click', () => close(null));
    if (goBtn) goBtn.addEventListener('click', () => close(choice));
  });
}
