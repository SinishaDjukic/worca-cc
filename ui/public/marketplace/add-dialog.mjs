// ui/public/marketplace/add-dialog.mjs — the Add marketplace dialog (marketplace P7, boards 2.1–2.3, F9, F10; U3, U4/L1,
// L6): idle → the server's real progress → the result, the linked plugin folder, or an error that stays in the dialog.
// One controller, one P3 createDialog per opening (SM21); P2's job API: POST {url, progress:true} → 202, then
// marketplace-add-changed frames (onJob), with a 2 s poll as the fallback for a quiet socket.
import { createDialog } from './layers.mjs';
import { kindTile, glyphTile, pluginIconKind, kindCounts, addsSummary, secretsSummary, chip } from './kinds.mjs';
import { buildCatalog } from './catalog.mjs';
import { displayUrl, isLocalPath, marketplaceNotes, renderNotes, renderDisclosure } from './marketplaces-view.mjs';
import { renderNeedsGit } from '../plugins-view.mjs';
import { fieldError, clearFieldErrors } from '../feedback.mjs';
import { icon } from '../icons.mjs';

export const ADD_POLL_MS = 2000;   // the clone dialog's fallback interval (app.js pollCloneJob): a dropped socket never strands the dialog
export const PHASES = Object.freeze(['resolving', 'fetching', 'reading', 'checking']);
export function phaseLines(job) {
  const at = job.phase === 'saved' ? PHASES.length : Math.max(0, PHASES.indexOf(job.phase));
  const state = (i) => (i < at ? 'done' : i === at ? 'current' : 'pending');
  return [
    { state: state(0), text: 'Found', value: displayUrl(job.resolvedUrl || job.url) },
    { state: state(1), text: 'Fetched', value: job.sha ? String(job.sha).slice(0, 7) : '' },
    { state: state(2), text: 'Reading plugins…', value: '' },
    { state: state(3), text: 'Checking what each plugin asks for', value: '' },
  ];
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sha7 = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, 7) : '');
// How far a job has got: its phase, then an ended job past every phase. A frame that beat the 202 can be further on.
const reach = (job) => (!job ? -1 : job.state === 'done' || job.state === 'error' ? PHASES.length + 1
  : job.phase === 'saved' ? PHASES.length : Math.max(0, PHASES.indexOf(job.phase)));

/**
 * The Add marketplace dialog. open() answers undefined (LC-P3-23: renderNoMarketplaces leaves its form alone).
 * @returns {{ open({ url?, opener? }?): undefined, onJob(job): void, isOpen(): boolean, close(): void }}
 */
export function createAddMarketplaceDialog({ doc, win, deps, page, focusMarketplace,
  timers = { set: (fn, ms) => win.setInterval(fn, ms), clear: (h) => win.clearInterval(h) } }) {
  let ui = null;        // the open dialog's parts
  let session = null;   // { jobId, url, early, shown } of the add this dialog shows; null once it closed
  let poll = null;

  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text) => { const b = make('button', cls, text); b.type = 'button'; return b; };
  const sep = () => { const s = make('span', null, '·'); s.setAttribute('aria-hidden', 'true'); return s; };
  const stopPoll = () => { if (poll != null) { timers.clear(poll); poll = null; } };
  // SM70: leaving #marketplace closes the dialog without asking — the user left (install-sheet.mjs onHash).
  win.addEventListener('hashchange', () => {
    if (ui && !String(win.location?.hash ?? '').startsWith('#marketplace')) ui.dlg.close();
  });

  function build() {
    const d = createDialog({ doc, win, width: 'lg', kind: 'form', onClose: () => {
      if (ui?.dlg !== d) return;
      stopPoll();
      session = null;
      ui = null;
      // The opener can leave with a render while the dialog is up (the first add replaces the empty state's form; a
      // tab switch rebuilds the header): focusBack then finds no twin and keeps the focus put here, never <body>.
      (doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt') || doc.querySelector('#mk-root a.mk-tab[aria-current="page"]'))?.focus();
    } });
    d.panel.dataset.kind = 'add-marketplace';
    d.panel.setAttribute('aria-labelledby', 'mk-add-title');
    const title = make('h2', 'section-title', 'Add marketplace');
    title.id = 'mk-add-title';
    const close = button('btn btn-quiet btn-icon mk-dlg-close');
    close.setAttribute('aria-label', 'Close');
    close.append(icon(doc, 'x', 16));
    close.addEventListener('click', () => d.close());
    const field = make('div', 'field mk-add-field');
    const label = make('label', null, 'Repository or folder');
    label.htmlFor = 'mk-add-url';
    const input = make('input', 'input');
    input.id = 'mk-add-url';
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'owner/repo, GitHub URL or folder';
    input.dataset.autofocus = '';
    field.append(label, input);
    const git = make('div', 'mk-add-git');
    const progress = make('ol', 'mk-progress');
    progress.setAttribute('aria-label', 'Progress');
    progress.setAttribute('aria-live', 'polite');
    const secondary = button('btn btn-quiet mk-add-secondary');
    const primary = button('btn btn-primary mk-add-primary');
    const u = { dlg: d, title, tile: kindTile(doc, 'mkt', { size: 'md' }), field, input, git, progress, secondary, primary,
      view: 'idle', kind: 'form', onPrimary: null, onSecondary: null };
    d.replace({ head: [u.tile, title, close], body: [field, git], foot: [secondary, primary] });
    input.addEventListener('input', () => { if (u.view !== 'adding') paintIdle(u); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || primary.disabled) return;
      e.preventDefault();
      primary.click();
    });
    primary.addEventListener('click', () => { if (!primary.disabled) u.onPrimary?.(); });
    secondary.addEventListener('click', () => u.onSecondary?.());
    return u;
  }

  // ── painting ──────────────────────────────────────────────────────────────────────────────────────────────────
  // No aria-busy on the panel: assistive tech may hold back a busy region's changes, and the progress list inside it is
  // the live region that announces each phase. The busy primary carries aria-busy.
  function frame(u, view, { kind, title = 'Add marketplace', ok = false }) {
    u.view = view;
    u.dlg.panel.dataset.state = view === 'exists' ? 'error' : view;
    if (u.kind !== kind) { u.kind = kind; u.dlg.setKind(kind); }   // only on a change: opened() takes a new clean baseline
    u.title.textContent = title;
    const want = ok ? 'mk-t-ok' : 'mk-t-mkt';
    if (!u.tile.classList.contains(want)) {
      const tile = ok ? glyphTile(doc, 'check', 'n', { size: 'md' }) : kindTile(doc, 'mkt', { size: 'md' });
      if (ok) tile.classList.replace('mk-t-n', 'mk-t-ok');
      u.tile.replaceWith(tile);
      u.tile = tile;
    }
  }

  // The field, the Needs git slot and at most one more region; the field is never moved while it stays (focus).
  function formBody(u, extra = null) {
    const b = u.dlg.body;
    if (u.field.parentNode !== b) b.replaceChildren(u.field, u.git);
    for (const n of [...b.children]) if (n !== u.field && n !== u.git && n !== extra) n.remove();
    if (extra && extra.parentNode !== b) b.append(extra);
  }

  function foot(u, secondary, content, { disabled = false, busy = false } = {}) {
    if (secondary == null) u.secondary.remove();
    else {
      u.secondary.textContent = secondary;
      if (u.secondary.parentNode !== u.dlg.foot) u.dlg.foot.prepend(u.secondary);
    }
    u.primary.replaceChildren(...content);
    u.primary.disabled = !!disabled;
    u.primary.classList.toggle('is-busy', !!busy);
    if (busy) { u.primary.dataset.fbState = 'busy'; u.primary.setAttribute('aria-busy', 'true'); }
    else { delete u.primary.dataset.fbState; u.primary.removeAttribute('aria-busy'); }
  }

  const cancel = (u) => () => u.dlg.close();

  function paintIdle(u) {
    u.input.readOnly = false;
    u.git.replaceChildren();
    formBody(u);   // first: frame()'s setKind takes the guard's clean baseline, which must hold the field (Add another)
    frame(u, 'idle', { kind: 'form' });
    foot(u, 'Cancel', ['Add'], { disabled: !u.input.value.trim() });
    u.onSecondary = cancel(u);
    u.onPrimary = () => { const url = u.input.value.trim(); if (url) void submit(url); };
  }

  // Frames that change no line (one `checking` per plugin, a poll answer the socket already gave) leave the live region
  // alone: a rebuild would make screen readers re-read it and restart the spinner.
  function paintLines(u, job) {
    const lines = phaseLines(job);
    const sig = JSON.stringify(lines.map((l) => [l.state, l.text, l.value]));
    if (u.linesSig === sig) return;
    u.linesSig = sig;
    u.progress.replaceChildren(...lines.map((l) => {
      const li = make('li', 'mk-phase');
      li.dataset.state = l.state;
      if (l.state === 'done') li.append(icon(doc, 'check', 14));
      else {
        const mark = make('span', l.state === 'current' ? 'mk-phase-spin' : 'mk-phase-dot');
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark);
        if (l.state === 'current') li.setAttribute('aria-current', 'step');
      }
      li.append(doc.createTextNode(l.text));
      if (l.value) li.append(doc.createTextNode(' '), make('span', 'mk-mono', l.value));
      return li;
    }));
  }

  function paintAdding(u, job) {
    frame(u, 'adding', { kind: 'decision' });
    u.input.readOnly = true;
    u.git.replaceChildren();
    paintLines(u, job);
    formBody(u, u.progress);
    const spin = make('span', 'btn-spin');
    spin.setAttribute('aria-hidden', 'true');
    foot(u, 'Cancel', [spin, 'Adding…'], { disabled: true, busy: true });
    u.onSecondary = cancel(u);
    u.onPrimary = null;
  }

  // Error views: the field is editable again and takes focus (EXISTS focuses "Open it").
  function paintExists(u, existing) {
    frame(u, 'exists', { kind: 'form' });
    u.input.readOnly = false;
    u.git.replaceChildren();
    const msg = make('div', 'mk-wash mk-add-msg');
    msg.setAttribute('role', 'alert');   // the focus lands on "Open it": without this the reason is never read out
    const text = make('span', 'mk-wash-text', 'Already added as ');
    text.append(make('b', null, existing.name || existing.id));
    msg.append(icon(doc, 'check', 16), text);
    const known = (page.state?.marketplaces || []).find((m) => m?.id === existing.id);
    if (known?.builtin) msg.append(chip(doc, 'built', 'Built-in'));
    formBody(u, msg);
    foot(u, 'Cancel', ['Open it', icon(doc, 'chevron', 14)]);
    u.onSecondary = cancel(u);
    u.onPrimary = () => {
      u.dlg.close();
      focusMarketplace(existing.id);
      // A page that never read it (its socket was down when another tab or the CLI added it) reads again: the card
      // takes the focus when that paint lands.
      if (!known) void page.load({ background: true });
    };
    u.primary.focus();
  }

  function paintBad(u, text, detail = null) {
    frame(u, 'error', { kind: 'form' });
    u.input.readOnly = false;
    u.git.replaceChildren();
    const msg = make('div', 'mk-wash mk-wash-bad mk-add-msg');
    msg.setAttribute('role', 'alert');
    const body = make('div', 'mk-add-msg-body');
    const line = make('span', 'mk-wash-text');
    line.append(...[].concat(text));   // a string, or strings and nodes ("Can’t reach " + the url in mono)
    body.append(line);
    if (detail) body.append(make('span', 'mk-mono mk-add-msg-detail', detail));
    msg.append(icon(doc, 'alert', 16), body);
    formBody(u, msg);
    foot(u, 'Cancel', [icon(doc, 'refresh', 14), 'Try again']);
    u.onSecondary = cancel(u);
    u.onPrimary = () => { const url = u.input.value.trim(); if (url) void submit(url); };
    u.input.focus();
  }

  function paintGitMissing(u) {
    paintIdle(u);
    u.git.replaceChildren(renderNeedsGit(doc));
    u.input.focus();
  }

  function pluginRow(kindIcon, name, version) {
    const li = make('li', 'mk-list-row mk-prow');
    li.dataset.name = name;
    const main = make('div', 'mk-row-main mk-prow-main');
    main.append(make('span', 'mk-row-title mk-prow-name', name), make('span', 'mk-meta mk-ver mk-prow-ver', String(version ?? '')));
    li.append(kindTile(doc, kindIcon, { size: 'sm' }), main);
    return { li, main };
  }

  function paintResult(u, m) {
    const name = m.name || m.id;
    frame(u, 'result', { kind: 'decision', title: `Added ${name}`, ok: true });
    const items = buildCatalog([m], page.state?.plugins);
    const n = items.length;
    const meta = make('div', 'mk-add-meta');
    meta.append(icon(doc, isLocalPath(m.url) ? 'folder' : 'git', 14), make('span', 'mk-mono mk-add-path', displayUrl(m.url)));
    const sha = sha7(m.lastSync?.sha);
    if (sha) meta.append(make('span', 'mk-mono', `@ ${sha}`));
    meta.append(sep(), make('span', null, plural(n, 'plugin')));
    const parts = [meta];
    if (n) {
      const ul = make('ul', 'mk-list mk-plist');
      ul.setAttribute('aria-label', 'Plugins in this marketplace');
      for (const item of items) {
        const { li, main } = pluginRow(item.iconKind, item.name, item.entry?.version ?? item.version ?? '');
        const adds = addsSummary(item.counts);
        if (adds) main.append(chip(doc, 'n', adds));
        const secrets = secretsSummary(item.secrets);
        if (secrets) main.append(chip(doc, 'n', secrets, { icon: 'key' }));
        const k = Array.isArray(item.entry?.notes) ? item.entry.notes.length : 0;
        if (k) main.append(chip(doc, 'warn', plural(k, 'note'), { icon: 'alert' }));
        if (item.installed) li.append(chip(doc, 'ok', 'Installed', { icon: 'check' }));
        else {
          const install = button('btn btn-sm mk-prow-install', 'Install');
          install.setAttribute('aria-label', `Install ${item.name}`);
          install.addEventListener('click', () => {
            u.dlg.close();
            // A read that landed while the result was up (another tab installed it) wins: act on the page's own item.
            page.act('openPlugin', (page.state?.catalog || []).find((i) => i?.key === item.key) || item);
          });
          li.append(install);
        }
        ul.append(li);
      }
      parts.push(ul);
    }
    const notes = marketplaceNotes(m);
    if (notes.length) {
      const body = renderNotes(doc, notes, 'mk-add-notes');
      parts.push(renderDisclosure(doc, notes.length === 1 ? '1 note from the manifest' : `${notes.length} notes from the manifest`, body), body);
    }
    u.dlg.body.replaceChildren(...parts);
    foot(u, 'Add another', [n >= 2 ? `Browse these ${n} plugins` : n === 1 ? 'Browse 1 plugin' : 'Done']);
    u.onSecondary = () => {
      u.input.value = '';
      clearFieldErrors(u.field);
      paintIdle(u);
      u.input.focus();
    };
    u.onPrimary = () => { u.dlg.close(); if (n) page.act('browse', { from: m.id }); };
    u.primary.focus();
  }

  function paintLinked(u, plugin) {
    const row = (page.state?.plugins || []).find((p) => p?.name === plugin.name);
    const counts = kindCounts(row || {});
    frame(u, 'linked', { kind: 'decision', title: `Added ${plugin.name}`, ok: true });
    const meta = make('div', 'mk-add-meta');
    meta.append(icon(doc, 'folder', 14), make('span', 'mk-mono mk-add-path', String(plugin.dir ?? '')));
    const ul = make('ul', 'mk-list mk-plist');
    const { li, main } = pluginRow(pluginIconKind(counts), plugin.name, row?.version ?? '');
    main.append(chip(doc, 'n', 'linked', { icon: 'link' }));
    const adds = addsSummary(counts);
    if (adds) main.append(chip(doc, 'n', adds));
    ul.append(li);
    u.dlg.body.replaceChildren(meta, ul);
    foot(u, null, ['Done']);
    u.onSecondary = null;
    u.onPrimary = () => u.dlg.close();
    u.primary.focus();
  }

  // ── the add ───────────────────────────────────────────────────────────────────────────────────────────────────
  async function pollOnce(s) {
    if (session !== s || !s.jobId || s.polling) return;
    s.polling = true;
    let r;
    try { r = await deps.api('GET', `/api/marketplaces/jobs/${encodeURIComponent(s.jobId)}`); } finally { s.polling = false; }
    if (session !== s || !s.jobId || !ui) return;
    if (r?.ok && r.data?.job) onJob(r.data.job);
    else if (r?.status === 404) { s.jobId = null; stopPoll(); paintBad(ui, r.data?.error || 'add failed'); }
  }

  async function submit(url) {
    if (!ui) return;
    // early: frames that land before the 202, the furthest per job id; shown: the job the progress lines show.
    const s = { jobId: null, url, early: new Map(), shown: null };
    session = s;
    stopPoll();
    clearFieldErrors(ui.field);
    paintAdding(ui, { url, phase: 'resolving' });
    ui.secondary.focus();
    const r = await deps.api('POST', '/api/marketplaces', { url, progress: true });
    if (session !== s || !ui) return;
    const early = s.early;
    s.early = null;
    const data = r?.data || {};
    if (r?.status === 202 && data.jobId) {
      s.jobId = data.jobId;
      // The server broadcasts as the job moves, and those frames can be handled before this answer is: start from the
      // furthest of them and the 202's own snapshot, so "Fetched" is current at once and a job that already ended ends.
      const seen = early.get(data.jobId);
      const first = reach(seen) > reach(data.job) ? seen : data.job;
      if (first) onJob(first);
      if (session === s && s.jobId) poll = timers.set(() => pollOnce(s), ADD_POLL_MS);
    } else if (r?.ok && data.linked) {
      await page.load();
      if (session === s && ui) paintLinked(ui, data.plugin || {});
    } else if (r?.ok && data.marketplace) {
      await page.load();
      if (session === s && ui) paintResult(ui, data.marketplace);
    } else if (r?.status === 409 && data.code === 'EXISTS' && data.existing?.id) paintExists(ui, data.existing);
    else if (r?.status === 409 && data.code === 'GIT_MISSING') paintGitMissing(ui);
    else if (r?.status === 400) { paintIdle(ui); fieldError(ui.input, data.error || 'add failed'); }
    else paintBad(ui, data.error || 'add failed');
  }

  function onJob(job) {
    const s = session;
    if (!s || !ui || !job) return;
    if (!s.jobId) {   // the POST has not answered yet: keep the furthest frame per job, the 202 picks its own
      if (s.early && job.id && reach(job) > reach(s.early.get(job.id))) s.early.set(job.id, job);
      return;
    }
    if (job.id !== s.jobId) return;
    if (job.state !== 'done' && job.state !== 'error') {
      // Running. A poll answer that lost the race with the socket is older than the lines: it never moves them back.
      if (ui.view === 'adding' && reach(job) >= reach(s.shown)) { s.shown = job; paintLines(ui, job); }
      return;
    }
    s.jobId = null;   // the job ended: later frames for it (socket and poll both) change nothing
    stopPoll();
    if (job.state === 'done') {
      void page.load().then(() => {
        if (session !== s || !ui) return;
        if (job.marketplace) paintResult(ui, job.marketplace);
        else paintBad(ui, 'add failed');   // a done job without its marketplace never leaves the dialog on Adding…
      });
    } else if (job.code === 'EXISTS' && job.existing?.id) paintExists(ui, job.existing);
    else if (job.code === 'GIT_MISSING') paintGitMissing(ui);
    else if (job.code === 'UNREACHABLE' || job.code === 'SYNC_FAILED') paintBad(ui, ['Can’t reach ', make('span', 'mk-mono', displayUrl(job.resolvedUrl || job.url))], job.error || null);
    else paintBad(ui, job.error || 'add failed');
  }

  function open({ url = '', opener = null } = {}) {
    if (ui) ui.dlg.close();
    const u = build();
    ui = u;
    u.input.value = String(url ?? '');
    paintIdle(u);
    u.dlg.open(opener || doc.activeElement);
    const first = u.input.value.trim();
    if (first) void submit(first);
    return undefined;
  }

  return {
    open,
    onJob,
    isOpen: () => !!ui && ui.dlg.isOpen(),
    close: () => { ui?.dlg.close(); },
  };
}
