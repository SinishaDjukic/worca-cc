// ui/public/update-view.mjs
// Manual update, About card (issue #841). Pure models + one controller that resolves DOM by id on
// every call (sibling modules are evaluated once per jsdom test process: never cache a node here).
// Reasons where nobody here can update: the buttons stay visible but disabled, and no command is offered.
const SHARED_REASONS = new Set(['shared', 'agent', 'mock']);
export const manualCommand = (v) => `npm install -g @worca/app@${v} && worca ui restart`;
// The Release notes link in the modal is the static href in index.html (the existing CHANGELOG_URL value):
// no new link shape, and no src/core import into ui/public.

export function pickerRows({ versions = [], distTags = {}, channel = 'stable', showOlder = false }) {
  return versions.filter((v) => v.channel === channel)
    .filter((v) => showOlder || v.relation === 'current' || (v.relation === 'newer' && !(channel === 'rc' && v.belowLatest)))
    .map((v) => {
      let tag = null;
      if (v.relation === 'current') tag = { text: 'Current', state: 'quiet' };
      else if (channel === 'stable' && v.version === distTags.latest) tag = { text: 'Latest stable', state: 'latest' };
      else if (channel === 'rc' && v.version === distTags.rc) tag = { text: 'Newest RC', state: 'rc' };
      else if (v.relation === 'older' || v.belowLatest) tag = { text: 'Older', state: 'quiet' };
      return { ...v, disabled: v.relation === 'current', tag };
    });
}

export function defaultSelection({ versions = [], distTags = {}, channel = 'stable' }) {
  const tagged = channel === 'stable' ? distTags.latest : distTags.rc;
  const hit = versions.find((v) => v.version === tagged && v.channel === channel && v.relation === 'newer');
  if (hit) return hit.version;
  if (channel === 'rc') return versions.find((v) => v.channel === 'rc' && v.relation === 'newer' && !v.belowLatest)?.version ?? null;
  return null;
}

export function pickAction(row, info) {
  if (!row || row.disabled) return { label: 'Pick a version', disabled: true, tone: null, text: '', mode: null };
  const back = row.relation === 'older';
  const label = `${back ? 'Roll back to' : 'Update to'} ${row.version}`;
  let tone = 'info'; let text = 'Worca restarts to update. Running runs pause and continue after the restart.';
  if (row.channel === 'rc') { tone = 'warn'; text = 'Release candidates are previews of the next version. You can go back to stable from this picker.'; }
  if (back) { tone = 'warn'; text = 'Rolling back to an older version. Data saved by a newer Worca may not load in it.'; }
  if (!row.autoRestart) {
    tone = 'warn';
    text += ` Worca ${row.version} is older than ${info.autoRestartMin} and cannot start again by itself: it installs, then stays stopped until you run ${info.startCommand}.`;
  }
  if (!info.canUpdate) {
    if (SHARED_REASONS.has(info.reason)) return { label, disabled: true, tone: 'warn', text: info.message, mode: null };
    return { label: 'Show the command', disabled: false, tone: 'info', text: 'Worca cannot update itself here. This puts the command for this version on the card.', mode: 'command' };
  }
  return { label, disabled: false, tone, text, mode: 'confirm' };
}

export function updateRowModel({ vs, info, chosen = null }) {
  if (!vs || typeof vs.status !== 'string' || !info) return { hidden: true };
  if (vs.status === 'source') return { hidden: false, primary: null, choose: false, note: info.message || 'Run from a git checkout: update with git pull, then worca ui restart.', command: null };
  const latest = info.distTags?.latest || vs.latest || null;
  const offer = vs.status === 'outdated' && latest ? latest : null;
  if (!info.canUpdate) {
    if (SHARED_REASONS.has(info.reason)) {
      return { hidden: false, primary: offer ? { label: `Update to ${offer}`, version: offer, disabled: true } : null, choose: true, note: info.message, command: null };
    }
    const target = chosen || offer;
    // With no version to offer (up to date, nothing picked) the message must not end on "Update from a terminal:".
    const note = target ? info.message : String(info.message || '').replace(/\s*Update from a terminal:\s*$/, '');
    return { hidden: false, primary: null, choose: true, note, command: target ? manualCommand(target) : null, commandVersion: target || null };
  }
  let note = '';
  if (offer) note = 'Latest stable. Worca restarts; running runs pause and continue after the restart.';
  else if (vs.status === 'up-to-date') note = `You run the latest stable.${info.rcNewer && info.distTags?.rc ? ` A release candidate is out: ${info.distTags.rc}.` : ''}`;
  else if (vs.status === 'ahead') note = `You run ${vs.current}, newer than the latest stable (${latest}).`;
  return { hidden: false, primary: offer ? { label: `Update to ${offer}`, version: offer, disabled: false } : null, choose: true, note, command: null };
}

// "What changes for you": shown before an update, so nobody restarts into a screen they did not
// expect. `changes` is the server's answer (GET /api/app/update/changes): the docs site's releases
// after the running version, up to the target. It is text from another host: shown as text only,
// and a release links out only to the changelog.
export const FAST_PACE_NOTE = 'Worca is developed at a fast pace. Screens, labels and where things sit can change between versions.';
export const CHANGES_UNAVAILABLE = 'The list of changes could not be loaded. Read the release notes before you update.';
export const CHANGES_OFF = 'Worca does not check for updates here, so the list of changes is not loaded. Read the release notes before you update.';
export const CHANGES_LOADING = 'Loading the list of changes…';
const CHANGELOG_PREFIX = 'https://docs.worca.dev/changelog/';
const CHANGES_MAX_LINES = 8;
const CHANGES_HEADING = 'What changes for you';

/** The box while the answer is on its way: the same parts the answer fills, so nothing moves when it lands. */
export function changesLoading() {
  return { note: FAST_PACE_NOTE, heading: CHANGES_HEADING, releases: [], message: CHANGES_LOADING };
}

// { note, heading, releases, message }: `message` is the one line inside the list box (could not load,
// not fetched here, the target is not in the list), null when the list says it all.
export function changesModel(changes) {
  const c = changes && typeof changes === 'object' ? changes : {};
  if (c.rollback === true) return { note: null, heading: null, releases: [], message: null };
  const heading = typeof c.from === 'string' && typeof c.to === 'string' ? `${CHANGES_HEADING} · ${c.from} → ${c.to}` : CHANGES_HEADING;
  const base = { note: FAST_PACE_NOTE, heading, releases: [], message: null };
  if (c.state === 'off') return { ...base, message: CHANGES_OFF };
  const rows = (c.state === 'ok' || c.state === 'none') && Array.isArray(c.releases) ? c.releases.filter((r) => r && typeof r.version === 'string') : null;
  // The docs site has no page for the target: it trails a release, or it is a release candidate (rarely
  // given one). Neither promises the page will come.
  const missing = c.targetListed === false && typeof c.to === 'string'
    ? (c.prerelease === true ? `Release candidates such as ${c.to} are not in this list. Read the release notes before you update.`
      : `${c.to} is not in this list. Read the release notes before you update.`)
    : null;
  if (!rows || (!rows.length && !missing)) return { ...base, message: CHANGES_UNAVAILABLE };
  return {
    ...base,
    message: missing,
    releases: rows.map((r) => {
      const lines = (Array.isArray(r.sections) ? r.sections : []).filter((x) => x && typeof x.title === 'string' && x.title)
        .map((x) => ({ kicker: typeof x.kicker === 'string' ? x.kicker : '', title: x.title }));
      return { version: r.version, date: typeof r.date === 'string' ? r.date : '',
        url: typeof r.url === 'string' && r.url.startsWith(CHANGELOG_PREFIX) ? r.url : null,
        lines: lines.slice(0, CHANGES_MAX_LINES), more: Math.max(0, lines.length - CHANGES_MAX_LINES) };
    }),
  };
}

/**
 * Fills the changes box from a changesModel, with components Worca already uses: the dialog's info
 * callout (.update-callout), the version picker's scroll box (.update-versions) holding divided rows
 * (.drow.drow-stack), the picker's date line (.update-vd), the About card's link (.about-link), and the
 * shared grey line (.hint) for the heading and the message row. The list box is always there while the
 * note is, with the message (loading, could not load, …) as its first row: in the confirm pane it has
 * one fixed height (about-update.css), so the buttons below do not move when the answer lands. Only
 * the parts that have something to say are added (.hint is display:block, which beats [hidden]).
 * data-part names the pieces for tests. Text nodes only; the box hides when there is nothing to say.
 */
export function paintChanges(doc, host, m) {
  if (!host) return;
  const el = (tag, cls, part, text) => {
    const n = doc.createElement(tag); if (cls) n.className = cls; n.dataset.part = part; if (text != null) n.textContent = text; return n;
  };
  const parts = [];
  if (m.note) { const note = el('p', 'update-callout', 'note', m.note); note.dataset.tone = 'info'; parts.push(note); }
  if (m.heading) parts.push(el('p', 'hint', 'head', m.heading));
  const list = el('div', 'update-versions drows', 'list');
  list.tabIndex = 0; list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Changes per release');
  if (m.message) { const row = el('div', 'drow', 'message'); row.append(el('p', 'hint', 'off', m.message)); list.append(row); }
  for (const r of m.releases) {
    const row = el('section', 'drow drow-stack', 'release');
    const top = el('div', null, 'top');
    const v = el(r.url ? 'a' : 'span', r.url ? 'about-link' : 'update-vn', 'version', r.version);
    if (r.url) { v.href = r.url; v.target = '_blank'; v.rel = 'noopener noreferrer'; }
    top.append(v);
    const day = r.date ? new Date(`${r.date}T00:00:00`) : null;
    if (day && !Number.isNaN(day.getTime())) top.append(el('span', 'update-vd', 'date', day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })));
    row.append(top);
    for (const l of r.lines) row.append(el('div', null, 'line', l.kicker ? `${l.kicker} · ${l.title}` : l.title));
    if (r.more) row.append(el('div', 'about-note', 'line', `and ${r.more} more`));
    list.append(row);
  }
  if (m.note) parts.push(list);
  host.replaceChildren(...parts);
  host.hidden = !m.note;
}

/** Polls /api/health until a different server boot answers (startedAt changed). */
export async function waitForServer({ fetchImpl, bootStartedAt, sleep, now = Date.now, intervalMs = 1500, timeoutMs = 10 * 60_000 }) {
  const end = now() + timeoutMs;
  while (now() < end) {
    await sleep(intervalMs);
    try {
      const r = await fetchImpl('/api/health', { cache: 'no-store' });
      if (r.ok) { const h = await r.json(); if (h.startedAt && h.startedAt !== bootStartedAt) return { back: true, version: h.version || null }; }
    } catch { /* down: keep polling */ }
  }
  return { back: false };
}

// sleep uses the WINDOW's timers, never Node's global setTimeout: under jsdom, closing the window
// (useDomRelease) clears them, so the overlay's poll loop dies with the test instead of keeping
// `node --test` alive for the 10-minute poll window.
export function createUpdateUi({ doc, fetchImpl, copyFromButton, report = () => {}, reload = () => doc.defaultView.location.reload(),
  sleep = (ms) => new Promise((r) => doc.defaultView.setTimeout(r, ms)), guardModal = null }) {
  const $ = (id) => doc.getElementById(id);
  let vs = null; let info = null; let chosen = null;
  let pick = { channel: 'stable', showOlder: false, selected: null, versions: [], distTags: {} };
  let infoSeq = 0; let confirmSeq = 0;
  let cardChanges = { version: null };   // the About card's box, for installs that show the command

  async function refresh() {
    const mine = ++infoSeq;
    let next = null;
    try { const r = await fetchImpl('/api/app/update'); if (r.ok) next = await r.json(); } catch { /* offline */ }
    if (mine === infoSeq) { info = next; paint(); }
    return info;
  }
  function setVersionStatus(next) { vs = next; paint(); }

  function paint() {
    const m = updateRowModel({ vs, info, chosen });
    const row = $('aboutUpdateRow'); if (!row) return;
    row.hidden = !!m.hidden;
    if (m.hidden) return;
    const go = $('aboutUpdateGo');
    go.hidden = !m.primary;
    if (m.primary) { go.textContent = m.primary.label; go.disabled = m.primary.disabled; go.dataset.version = m.primary.version; }
    $('aboutUpdateChoose').hidden = !m.choose;
    $('aboutUpdateChoose').classList.toggle('btn-primary', false);
    $('aboutUpdateNote').textContent = m.note || '';
    $('aboutUpdateNote').hidden = !m.note;
    $('aboutUpdateCmdRow').hidden = !m.command;
    $('aboutUpdateCmd').textContent = m.command || '';
    paintCardChanges(m.command ? (chosen || m.commandVersion) : null);
    paintResult(info?.lastResult || null);
  }

  async function fetchJson(url) {
    try { const r = await fetchImpl(url); if (r.ok) return await r.json(); } catch { /* shown as unknown */ }
    return null;
  }
  const fetchPreview = (version) => fetchJson(`/api/app/update/preview?version=${encodeURIComponent(version)}`);
  const fetchChanges = (version) => fetchJson(`/api/app/update/changes?version=${encodeURIComponent(version)}`);

  // Where Worca cannot update itself there is no confirm pane, only the command: the note and the
  // list sit under it. One read per version, not one per repaint.
  function paintCardChanges(version) {
    const host = $('aboutUpdateChanges'); if (!host) return;
    if (!version) { cardChanges = { version: null }; host.hidden = true; host.replaceChildren(); return; }
    if (cardChanges.version === version) return;      // painted or on its way: a repaint keeps the list (scroll, focus)
    cardChanges = { version };
    paintChanges(doc, host, changesLoading());
    fetchChanges(version).then((c) => {
      if (cardChanges.version === version) paintChanges(doc, $('aboutUpdateChanges'), changesModel(c));
    });
  }

  function paintResult(r) {
    const failed = $('aboutUpdateFailed'); const back = $('aboutUpdateBack');
    failed.hidden = !(r && r.state === 'failed');
    back.hidden = !(r && r.state === 'installed');
    if (r?.state === 'failed') {
      $('aboutUpdateFailedTitle').textContent = `The update to ${r.to} failed. Still on ${r.from}.`;
      // Some reasons are full sentences ('…before it finished.'): never print '..'.
      $('aboutUpdateFailedReason').textContent = `${String(r.reason || 'npm failed').replace(/\.+$/, '')}.${r.resumed != null ? ` Worca started again on ${r.from}${r.resumed ? ` and resumed ${r.resumed} run${r.resumed === 1 ? '' : 's'}` : ''}.` : ''}`;
      $('aboutUpdateFailedCmd').textContent = manualCommand(r.to);
      $('aboutUpdateOutput').textContent = r.output || '';
      $('aboutUpdateOutputWrap').hidden = !r.output;
    }
    if (r?.state === 'installed') {
      $('aboutUpdateBackText').textContent = `Worca ${r.to} is running.${r.resumed ? ` ${r.resumed} run${r.resumed === 1 ? '' : 's'} resumed.` : ''}`;
    }
  }

  async function openPicker() {
    const modal = $('update-modal');
    showPane('pick');
    $('updateVersionList').replaceChildren();
    $('updatePickNote').textContent = 'Loading versions from the npm registry…';
    $('updatePickNote').hidden = false;
    modal.classList.remove('hidden');
    guardModal?.(modal, { kind: 'decision', close: closeModal });
    let j = null;
    try { const r = await fetchImpl('/api/app/update/versions'); j = await r.json(); if (!r.ok) throw new Error(j?.error || 'failed'); } catch {
      $('updatePickNote').textContent = j?.error || 'Could not load the version list from npm. Try again in a moment.';
      return;
    }
    pick = { channel: 'stable', showOlder: false, versions: j.versions || [], distTags: j.distTags || {}, selected: null };
    pick.selected = defaultSelection(pick);
    $('updatePickSub').textContent = `You run ${j.current}. Versions come from the npm registry.`;
    $('updateShowOlder').checked = false;
    renderPicker();
  }

  function renderPicker() {
    for (const b of doc.querySelectorAll('#update-modal .seg button')) b.setAttribute('aria-pressed', String(b.dataset.channel === pick.channel));
    const list = $('updateVersionList');
    const rows = pickerRows(pick);
    list.replaceChildren(...rows.map((r) => {
      const lab = doc.createElement('label');
      lab.className = `update-ver${r.version === pick.selected ? ' sel' : ''}${r.disabled ? ' dis' : ''}`;
      const inp = doc.createElement('input');
      inp.type = 'radio'; inp.name = 'update-version'; inp.value = r.version; inp.checked = r.version === pick.selected; inp.disabled = r.disabled;
      inp.addEventListener('change', () => { pick.selected = r.version; renderPicker(); });
      const txt = doc.createElement('span');
      const vn = doc.createElement('span'); vn.className = 'update-vn'; vn.textContent = r.version;
      const vd = doc.createElement('span'); vd.className = 'update-vd';
      vd.textContent = r.publishedAt ? `Published ${new Date(r.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
      txt.append(vn, vd);
      const tag = doc.createElement('span');
      if (r.tag) { tag.className = 'about-update'; tag.dataset.state = r.tag.state; tag.textContent = r.tag.text; }
      lab.append(inp, txt, tag);
      return lab;
    }));
    if (!rows.length) list.textContent = pick.channel === 'rc' ? 'No release candidate is newer than the latest stable.' : 'No newer stable version.';
    const row = pick.versions.find((v) => v.version === pick.selected) || null;
    const a = pickAction(row, info || { canUpdate: false, reason: 'shared', message: '' });
    const go = $('updatePickGo');
    go.textContent = a.label; go.disabled = a.disabled; go.dataset.mode = a.mode || '';
    const note = $('updatePickNote');
    note.textContent = a.text; note.dataset.tone = a.tone || ''; note.hidden = !a.text;
  }

  async function goFromPicker() {
    const mode = $('updatePickGo').dataset.mode;
    if (mode === 'command') { chosen = pick.selected; closeModal(); paint(); return; }
    if (mode === 'confirm') await showConfirm(pick.selected);
  }

  async function showConfirm(version) {
    const modal = $('update-modal');
    if (modal.classList.contains('hidden')) { modal.classList.remove('hidden'); guardModal?.(modal, { kind: 'decision', close: closeModal }); }
    showPane('confirm');
    $('updateConfirmTitle').textContent = `${version && pick.versions.find((v) => v.version === version)?.relation === 'older' ? 'Roll back' : 'Update'} to ${version} and restart Worca?`;
    $('updateConfirmGo').dataset.version = version;
    $('updateConfirmGo').disabled = true;
    // Laid out at once at its final size (a rollback shows none), so the answer moves nothing.
    const box = $('updateConfirmChanges');
    if (box) { if (pick.versions.find((v) => v.version === version)?.relation === 'older') { box.hidden = true; box.replaceChildren(); } else paintChanges(doc, box, changesLoading()); }
    const mine = ++confirmSeq;
    // Its own request, never awaited here: the button below must not wait for the docs site.
    fetchChanges(version).then((c) => { if (mine === confirmSeq) paintChanges(doc, $('updateConfirmChanges'), changesModel(c)); });
    const p = await fetchPreview(version);
    if (mine !== confirmSeq) return;            // a later pick's answers own the pane
    const auto = p ? p.autoRestart : true;
    $('updateConfirmMsg').textContent = auto
      ? `Worca stops, installs @worca/app@${version} and starts again. This page reconnects by itself.`
      : `Worca stops and installs @worca/app@${version}. It is older than 1.14.0, so it cannot start again by itself.`;
    $('updateConfirmGo').textContent = auto ? 'Update & restart' : 'Install and stop';
    const runs = p?.runs || [];
    const after = p && p.autoResume === false ? 'resume them from the run page after the restart (auto-resume is off)' : 'continue after the restart';
    $('updateConfirmRuns').textContent = runs.length
      ? `${runs.length} running run${runs.length === 1 ? '' : 's'} pause${runs.length === 1 ? 's' : ''} now; ${after}: ${runs.map((r) => r.title).join(' · ')}`
      : 'No runs are active.';
    const sched = p?.scheduled || [];
    $('updateConfirmSched').hidden = !sched.length;
    $('updateConfirmSched').textContent = sched.length
      ? `${sched.length} scheduled start${sched.length === 1 ? '' : 's'} (${sched.map((t) => new Date(t.runAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })).join(', ')}) wait${sched.length === 1 ? 's' : ''} until Worca is back.` : '';
    $('updateConfirmManual').hidden = auto;
    $('updateConfirmStartCmd').textContent = p?.startCommand || info?.startCommand || 'worca ui';
    $('updateConfirmGo').disabled = !p;
    $('updateConfirmGo').focus();
  }

  async function runUpdate(version) {
    const win = doc.defaultView;
    if (win.self !== win.top) { report('Open Worca in its own tab to update it.', 'err'); return; }   // never from a frame
    let bootStartedAt = null;
    try { bootStartedAt = (await (await fetchImpl('/api/health')).json()).startedAt || null; } catch { /* keep null */ }
    let r; let j = null;
    try {
      r = await fetchImpl('/api/app/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) });
      j = await r.json().catch(() => null);
    } catch { report('Could not reach Worca. Nothing was changed.', 'err'); return; }
    if (r.status !== 202) { report(j?.error || 'Worca refused the update.', 'err'); return; }
    closeModal();
    showOverlay(j);
    const res = await waitForServer({ fetchImpl, bootStartedAt, sleep, timeoutMs: j.autoRestart ? 10 * 60_000 : 60 * 60_000 });
    if (res.back) reload();
    else $('updateOverlayStep').textContent = `Worca has not come back. Check the terminal running worca ui, or start it with ${j.startCommand}.`;
  }

  function showOverlay(j) {
    const ov = $('update-overlay');
    $('updateOverlayTitle').textContent = `Updating Worca to ${j.target}`;
    $('updateOverlayStep').textContent = `Installing @worca/app@${j.target}… Worca is offline until it finishes.`;
    $('updateOverlayManual').hidden = j.autoRestart;
    $('updateOverlayStartCmd').textContent = j.startCommand;
    doc.body.classList.add('worca-updating');      // the conn banner would only repeat "can't reach the server"
    // Never registered with modal-guard, on purpose: Escape and a backdrop click leave it up, since there
    // is nothing to go back to while the server is down.
    ov.classList.remove('hidden');
  }

  function showPane(name) {
    for (const p of doc.querySelectorAll('#update-modal [data-pane]')) p.hidden = p.dataset.pane !== name;
    // The dialog's name follows the visible pane's heading (the other pane's h2 is hidden).
    $('update-modal').setAttribute('aria-labelledby', name === 'confirm' ? 'updateConfirmTitle' : 'updatePickTitle');
  }
  function closeModal() { $('update-modal')?.classList.add('hidden'); }

  async function copyFrom(id, btn) {
    if (!(await copyFromButton(btn, $(id).textContent))) report('Could not copy the command: select it and copy it by hand.', 'err');
  }

  function wire() {
    $('aboutUpdateGo')?.addEventListener('click', (e) => { const v = e.currentTarget.dataset.version; pick.selected = v; showConfirm(v); });
    $('aboutUpdateChoose')?.addEventListener('click', () => openPicker());
    $('aboutUpdateCopy')?.addEventListener('click', (e) => copyFrom('aboutUpdateCmd', e.currentTarget));
    $('aboutUpdateFailedCopy')?.addEventListener('click', (e) => copyFrom('aboutUpdateFailedCmd', e.currentTarget));
    $('aboutUpdateDismiss')?.addEventListener('click', async () => { try { await fetchImpl('/api/app/update/dismiss', { method: 'POST' }); } catch { /* ignore */ } refresh(); });
    for (const b of doc.querySelectorAll('#update-modal .seg button')) {
      b.addEventListener('click', () => { pick.channel = b.dataset.channel; pick.selected = defaultSelection(pick); renderPicker(); });
    }
    $('updateShowOlder')?.addEventListener('change', (e) => {
      pick.showOlder = e.target.checked;
      if (!pick.showOlder && !pickerRows(pick).some((r) => r.version === pick.selected)) pick.selected = defaultSelection(pick);
      renderPicker();
    });
    $('updatePickGo')?.addEventListener('click', () => goFromPicker());
    $('updatePickCancel')?.addEventListener('click', closeModal);
    $('updateConfirmBack')?.addEventListener('click', closeModal);
    $('updateConfirmGo')?.addEventListener('click', (e) => runUpdate(e.currentTarget.dataset.version));
    $('updateOverlayCopy')?.addEventListener('click', (e) => copyFrom('updateOverlayStartCmd', e.currentTarget));
    $('updateConfirmCopy')?.addEventListener('click', (e) => copyFrom('updateConfirmStartCmd', e.currentTarget));
  }
  return { wire, refresh, setVersionStatus, paint };
}
