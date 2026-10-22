// ui/public/marketplace/installed.mjs — The Installed tab (board 3.1): one delegated click listener and one change
// listener on the tab panel; every row action names its plugin in data-name.
import { withButton } from '../feedback.mjs';
import { kindCounts, pluginIconKind } from './kinds.mjs';
import { createDialog, LAYER_CLOSED } from './layers.mjs';
import { dialogOpen } from '../modal-guard.mjs';
import { updatesChip } from './page.mjs';
import { needsReview } from '../../../src/shared/plugin-access.mjs';
import { updatable, goesAway, removeChanges, usedByRow, usedByNote, leftoverIconKind, policyItems } from './installed-model.mjs';
import { renderInstalledHeader, renderInstalledTab } from './installed-view.mjs';
import { renderRemoveDialog, renderBlockedDialog, renderPurgeDialog } from './remove-view.mjs';

const enc = encodeURIComponent;

export function createInstalledTab({ doc, win, page, deps }) {
  const rowOf = (name) => (page.state.plugins || []).find((p) => p.name === name) || null;
  const fail = (title) => deps.notify({ tone: 'err', title });
  const changed = async () => { deps.invalidateAgentCaches?.(); await page.load(); };
  const preview = (name) => deps.api('POST', `/api/plugins/${enc(name)}/update`, {});
  const gitMissing = (r) => !r.ok && r.data?.code === 'GIT_MISSING';
  // A preview can take seconds (a git fetch): a sheet or dialog opened meanwhile is never taken over (typed settings, a
  // review that is applying) — the person moved on, and the row still offers the update.
  const review = (name, ...o) => { if (!dialogOpen(doc)) page.act('openUpdateReview', [name], ...o); };
  // A monorepo marketplace moves candidateSha to the repository tip while the plugin folder has no commits: no commits
  // and no diffstat is up to date too.
  const upToDate = (p) => !!p.candidateSha && (p.candidateSha === p.pinnedSha || (Array.isArray(p.commits) && !p.commits.length && !String(p.diffstat ?? '').trim()));

  const iconOf = (row) => pluginIconKind(kindCounts(row || {}));
  let dlg = null;   // the open dialog, if any
  let cur = null;   // { name, opener, onRemoved } of the open dialog
  let opening = 0;  // the latest Remove / Purge asked for: a slower earlier one never replaces its dialog
  function paint(kind, parts) {
    dlg.panel.dataset.kind = kind;
    dlg.replace({ head: parts.head, body: parts.body, foot: parts.foot });   // P3 layers: replaces each region
  }
  function openDialog(kind, parts, context) {
    // P3 closes an open createDialog dialog first; its own focus fallback looks for the opener's class + data-name.
    const d = createDialog({ doc, win, width: 'md', onClose: () => {
      if (dlg === d) { dlg = null; cur = null; }
      // A render held under the dialog lands on LAYER_CLOSED and can take the opener's row away: then the tab takes focus.
      doc.addEventListener(LAYER_CLOSED, refocus, { once: true });
    } });
    d.panel.addEventListener('click', onDialogClick);
    dlg = d;
    cur = context;
    paint(kind, parts);
    d.open(context.opener);
  }
  // Focus never falls to <body>: a removed row's controls are gone after the reload, so the Installed tab takes it.
  const refocus = () => { const a = doc.activeElement; if (!a || a === doc.body) doc.querySelector('.mk-tab[data-tab="installed"]')?.focus(); };
  const blockedParts = (name, refs) => renderBlockedDialog(doc, { name, iconKind: iconOf(rowOf(name)), rows: refs.map(usedByRow), note: usedByNote(refs) });
  const showError = (d, msg) => { const e = d.body.querySelector('.mk-dlg-err'); e.textContent = msg; e.hidden = false; };
  // P3's setBusy holds Escape and the scrim and disables every .mk-dlg-close in the panel (SM40's Close is ours, P3 holds
  // it); the foot's Cancel is held here, so nothing closes the dialog while its request is out.
  const busy = (d, on) => {
    d.setBusy(on);
    const cancel = d.foot.querySelector('[data-dlg="cancel"]');
    if (cancel) cancel.disabled = !!on;
  };
  const refsOf = async (name) => { const r = await deps.api('GET', `/api/plugins/${enc(name)}/references`); return r.ok ? r.data.references || [] : []; };

  async function openRemove(name, { opener = null, onRemoved = null } = {}) {
    const row = rowOf(name);
    if (!row) return;
    const ticket = ++opening;
    const [det, refs] = await Promise.all([deps.api('GET', `/api/plugins/${enc(name)}`), refsOf(name)]);
    if (ticket !== opening) return;   // a later Remove or Purge was asked for meanwhile
    const inventory = det.ok ? det.data.inventory || null : null;
    const context = { name, opener, onRemoved };
    if (refs.length) openDialog('blocked', blockedParts(name, refs), context);
    else openDialog('remove', renderRemoveDialog(doc, { name, iconKind: iconOf(row), goesAway: goesAway(inventory, row), changes: removeChanges(row, inventory) }), context);
  }
  async function confirmRemove(btn) {
    const d = dlg;
    const { name, onRemoved } = cur;
    const purge = !!d.body.querySelector('.mk-purge-box')?.checked;
    await withButton(btn, async () => {
      busy(d, true);
      const r = await deps.api('DELETE', `/api/plugins/${enc(name)}${purge ? '?purge=1' : ''}`);
      // A 409 re-reads what still uses the plugin before the dialog lets go: Escape must not drop the answer.
      const refs = !r.ok && r.status === 409 ? await refsOf(name) : [];
      busy(d, false);
      if (r.ok) {
        d.close();
        deps.notify({ tone: 'ok', title: `Removed ${name}.` });
        await changed();
        onRemoved?.();
        refocus();   // the reload took the opener's row away
        return { ok: true };
      }
      if (refs.length && dlg === d) {
        paint('blocked', blockedParts(name, refs));
        d.head.querySelector('.mk-dlg-close')?.focus();   // the focused Remove left with the old foot
        return { ok: false };
      }
      showError(d, String(r.data?.error || 'Remove failed').split('\n')[0]);
      return { ok: false };
    }, { busy: 'Removing…', done: 'Removed' });
  }
  function openPurge(name, opener) {
    opening += 1;
    openDialog('purge', renderPurgeDialog(doc, { name, iconKind: leftoverIconKind(page.state.catalog, name) }), { name, opener, onRemoved: null });
  }
  async function confirmPurge(btn) {
    const d = dlg;
    const { name } = cur;
    await withButton(btn, async () => {
      busy(d, true);
      const r = await deps.api('DELETE', `/api/plugins/${enc(name)}/data`);
      busy(d, false);
      if (!r.ok) { showError(d, r.data?.error || 'Purge failed'); return { ok: false }; }
      d.close();
      deps.notify({ tone: 'ok', title: `Purged leftover data for ${name}.` });
      await page.load();
      refocus();
      return { ok: true };
    }, { busy: 'Purging…', done: 'Purged' });
  }
  function onDialogClick(e) {
    const b = e.target instanceof win.Element ? e.target.closest('[data-dlg]') : null;
    if (!b || b.disabled || !dlg) return undefined;
    switch (b.dataset.dlg) {
      case 'close': case 'cancel': case 'open': return dlg.close();   // 'open' is a link: its navigation goes on
      case 'remove': return confirmRemove(b);
      case 'purge': return confirmPurge(b);
      default: return undefined;
    }
  }

  // L7: apply at once only when the authoritative preview asks for nothing new; everything else is the review sheet's.
  async function updateOne(name, { opener = null } = {}) {
    return withButton(opener, async () => {
      const pre = await preview(name);
      if (gitMissing(pre)) { review(name, { opener }); return { ok: false }; }
      if (!pre.ok) { fail(pre.data?.error || 'Update failed'); return { ok: false }; }
      const p = pre.data.preview || pre.data;
      if (upToDate(p)) { deps.notify({ tone: 'ok', title: `${name} is up to date.` }); return { ok: false }; }
      // A diff with no commits to list is a rollback (the pin is ahead of the tip) or a history the preview could not
      // read: never applied at once, the review sheet decides. So does new access (L7).
      if (!(Array.isArray(p.commits) && p.commits.length) || needsReview(p.access || [])) { review(name, { opener }); return { ok: false }; }
      const r = await deps.api('POST', `/api/plugins/${enc(name)}/update`, { confirm: true, candidateSha: p.candidateSha });
      if (!r.ok && r.data?.code === 'STALE_PREVIEW') { review(name, { opener }); return { ok: false }; }
      if (!r.ok) { fail(r.data?.error || 'Update failed'); return { ok: false }; }
      deps.notify({ tone: 'ok', title: `Updated ${name}.` });
      await changed();
      return { ok: true };
    }, { busy: 'Updating…', done: 'Updated' });
  }

  async function checkForUpdate(name) {
    const pre = await preview(name);
    if (!pre.ok && !gitMissing(pre)) return fail(pre.data?.error || 'Update check failed');
    const p = pre.ok ? (pre.data.preview || pre.data) : null;
    if (p && upToDate(p)) return deps.notify({ tone: 'ok', title: `${name} is up to date.` });
    return review(name);
  }

  async function setEnabled(input) {
    const name = input.dataset.name;
    const on = input.checked;
    const hadFocus = doc.activeElement === input;
    input.disabled = true;
    const r = await deps.api('POST', `/api/plugins/${enc(name)}/enable`, { enabled: on });
    input.disabled = false;
    if (hadFocus && input.isConnected) input.focus();   // a browser drops focus from a disabled control (as withButton)
    if (!r.ok) { input.checked = !on; return fail(r.data?.error || 'toggle failed'); }
    return changed();
  }

  function openRowMenu(btn) {
    const name = btn.dataset.name;
    const row = rowOf(name);
    if (!row) return;
    const items = [];
    if (kindCounts(row).mcpServers > 0) items.push({ label: 'Open in Connectors', icon: 'plug', onSelect: () => deps.navigate('#connectors/servers') });
    items.push({ label: 'Check health', icon: 'pulse', onSelect: () => page.act('checkHealth', name) });
    if (!row.linked) items.push({ label: 'Check for update', icon: 'refresh', onSelect: () => checkForUpdate(name) });
    items.push({ sep: true }, { label: 'Remove…', icon: 'trash', danger: true, onSelect: () => openRemove(name, { opener: btn }) });
    deps.openMenu({ doc, anchor: btn, items, align: 'end', label: `${name} actions` });
  }

  async function policyAct(act, name, opener) {
    const item = policyItems(page.state.policy, page.state.plugins).find((i) => i.name === name);
    if (!item) return undefined;
    // P4's open({ name, marketplace }) resolves the snapshot the policy names (marketplace id, name or URL), opens the
    // manage sheet when the plugin is installed, and says itself when no synced marketplace lists it.
    if (act === 'policy-install') return page.act('openPlugin', { name, marketplace: item.marketplace });
    if (act === 'policy-setup') return page.act('openManage', name, { section: 'settings', seeds: item.config, opener });
    return withButton(opener, async () => {   // policy-on: one request per click
      const r = await deps.api('POST', `/api/plugins/${enc(name)}/enable`, { enabled: true });
      if (!r.ok) { fail(r.data?.error || 'toggle failed'); return { ok: false }; }
      await changed();
      return { ok: true };
    }, { busy: 'Turning on…', done: 'Turned on' });
  }

  function onClick(e) {
    const browse = e.target instanceof win.Element ? e.target.closest('a.mk-browse-all') : null;
    if (browse) {   // SM63: tabs switch through setTab only; a modified click stays the browser's (P3's onTabClick)
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return undefined;
      e.preventDefault();
      return page.setTab('browse');
    }
    const t = e.target instanceof win.Element ? e.target.closest('button') : null;
    if (!t || t.disabled) return undefined;
    const name = t.dataset.name;
    if (t.matches('button.mk-name')) return page.act('openManage', name, { opener: t });
    if (t.matches('button.mk-more')) return openRowMenu(t);
    if (t.matches('button.mk-policy-setup')) return deps.openSetupChecklist();
    switch (t.dataset.act) {
      case 'update': return updateOne(name, { opener: t });
      case 'review': return page.act('openUpdateReview', [name], { opener: t });
      case 'setup': return page.act('openManage', name, { section: 'settings', opener: t });
      case 'health': return page.act('checkHealth', name);
      case 'purge': return openPurge(name, t);
      case 'policy-update': return updateOne(name, { opener: t });
      case 'policy-install': case 'policy-on': case 'policy-setup': return policyAct(t.dataset.act, name, t);
      default: return undefined;
    }
  }

  function render(state, el) {
    if (!el.dataset.mkInstalled) {
      el.dataset.mkInstalled = '1';
      el.addEventListener('click', onClick);
      el.addEventListener('change', (e) => { if (e.target.matches?.('input.mk-enable')) void setEnabled(e.target); });
    }
    el.replaceChildren(renderInstalledTab(doc, state));
  }
  function header(state, el) {
    const [refresh, all] = renderInstalledHeader(doc, { updates: updatable(state.plugins).length });
    if (state.refreshing) {   // P3's header pattern: keep the focus, refuse the click (not `disabled`)
      refresh.setAttribute('aria-disabled', 'true');
      refresh.setAttribute('aria-busy', 'true');
    }
    refresh.addEventListener('click', () => { if (!state.refreshing) void page.load({ refresh: true }); });
    all?.addEventListener('click', () => page.act('openUpdateReview', undefined, { opener: all }));
    el.replaceChildren(...[refresh, all].filter(Boolean));
  }
  page.registerTab('installed', {
    label: 'Installed', render, header,
    count: (s) => (s.plugins || []).length,
    chip: (s) => updatesChip(doc, updatable(s.plugins).length),
  });
  page.provide('updateOne', updateOne);
  page.provide('openRemove', (name, o) => openRemove(name, o));
  return { updateOne, checkForUpdate, openRemove: (name, o) => openRemove(name, o) };
}
