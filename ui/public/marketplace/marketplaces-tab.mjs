// ui/public/marketplace/marketplaces-tab.mjs — the Marketplaces tab (marketplace P7, board 4.1): one card per marketplace,
// the header's Refresh all and Add marketplace, each card's Browse / refresh / Retry / ⋯ (Copy URL, Open repository,
// Remove… in its own dialog), and P3's "No marketplaces yet" inline add (SM20). One delegated click listener per paint.
import { createDialog } from './layers.mjs';
import { kindTile } from './kinds.mjs';
import { renderNoMarketplaces } from './browse.mjs';
import { renderMarketplaceCards, repoWebUrl } from './marketplaces-view.mjs';
import { icon } from '../icons.mjs';

const enc = encodeURIComponent;

/** @returns {{ spec: object, focus(id: string): void }} */
export function createMarketplacesTab({ doc, win, deps, page }) {
  const busyIds = new Set();   // the marketplaces whose refresh is in flight: a re-render keeps their button busy
  let pending = null;          // focus(id) asked for a card the page has not painted yet
  let removing = null;         // the open remove dialog

  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text) => { const b = make('button', cls, text); b.type = 'button'; return b; };
  const busy = (b, on) => {
    if (on) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-busy', 'true'); }
    else { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); }
  };
  const byId = (id) => (page.state.marketplaces || []).find((m) => m?.id === id) || null;

  // SM70: leaving #marketplace closes the remove dialog without asking — the user left (add-dialog.mjs).
  win.addEventListener('hashchange', () => {
    if (removing && !String(win.location?.hash ?? '').startsWith('#marketplace')) removing.close();
  });
  // A focus(id) for a card the page has not painted yet waits only until the user acts: a later paint never takes the
  // focus from where the user moved it.
  const dropPending = () => { pending = null; };
  doc.addEventListener('pointerdown', dropPending, true);
  doc.addEventListener('keydown', dropPending, true);

  function applyFocus() {
    if (pending == null) return;
    const card = [...doc.querySelectorAll('#mk-root section.mk-mkt')].find((n) => n.dataset.id === pending);
    if (!card) return;
    pending = null;
    card.focus({ focusVisible: true });   // a mouse "Open it" still rings the card it found
    card.scrollIntoView?.({ block: 'nearest' });
  }

  async function refreshOne(btn, m) {
    if (busyIds.has(m.id)) return;
    busyIds.add(m.id);
    busy(btn, true);
    try {
      const r = await deps.api('POST', `/api/marketplaces/${enc(m.id)}/refresh`, {});
      // A 404 is a marketplace removed meanwhile (its own Remove…, another tab): the reload drops the card, nothing to say.
      if (!r?.ok && r?.status !== 404) deps.notify({ tone: 'err', title: r?.data?.error || 'refresh failed' });
    } catch (e) {
      deps.notify({ tone: 'err', title: e?.message || 'refresh failed' });
    } finally {
      busyIds.delete(m.id);
      // A reload that fails paints nothing: neither this button nor its rebuilt twin (a re-render meanwhile) stays busy.
      for (const b of [btn, ...doc.querySelectorAll('#mk-root .mk-mkt-refresh, #mk-root .mk-mkt-retry')]) if (b.dataset.id === m.id) busy(b, false);
    }
    await page.load();    // the re-render repaints the card; its refresh:<id> focus key keeps the focus
  }

  async function copyUrl(url) {
    try {
      await win.navigator.clipboard.writeText(String(url ?? ''));
      deps.notify({ tone: 'ok', title: 'URL copied.' });
    } catch {
      deps.notify({ tone: 'err', title: 'Could not copy the URL.' });
    }
  }

  function openRemove(m, opener) {
    const name = m.name || m.id;
    const dlg = createDialog({ doc, win, width: 'md', onClose: () => {
      if (removing === dlg) removing = null;
      // Back / Forward inside #marketplace can switch the tab behind the dialog (P7-y): the ⋯ then sits in a hidden
      // panel, which a browser never focuses. A shown control takes the focus first; focusBack still moves it to a shown ⋯.
      (doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt') || doc.querySelector('#mk-root a.mk-tab[aria-current="page"]'))?.focus();
    } });
    dlg.panel.dataset.kind = 'remove-marketplace';
    dlg.panel.setAttribute('aria-labelledby', 'mk-rm-title');
    const title = make('h2', 'section-title', `Remove ${name}?`);
    title.id = 'mk-rm-title';
    const close = button('btn btn-quiet btn-icon mk-dlg-close');
    close.setAttribute('aria-label', 'Close');
    close.append(icon(doc, 'x', 16));
    close.addEventListener('click', () => dlg.close());
    const err = make('p', 'hint err mk-dlg-err');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    const body = make('div', 'mk-dlg-body');
    body.append(make('p', 'mk-meta mk-consequence', 'Installed plugins keep working.'), err);
    const cancel = button('btn btn-quiet', 'Cancel');
    cancel.addEventListener('click', () => dlg.close());
    const confirm = button('btn btn-danger mk-confirm', 'Remove');
    // A browser drops the focus from a button that turns disabled (to <body>, and Tab then leaves the dialog): the
    // panel holds it while the DELETE runs.
    const hold = (on) => { if (on && dlg.panel.contains(doc.activeElement)) dlg.panel.focus(); dlg.setBusy(on); cancel.disabled = on; confirm.disabled = on; };
    confirm.addEventListener('click', async () => {
      if (confirm.disabled) return;
      hold(true);
      let r;
      try { r = await deps.api('DELETE', `/api/marketplaces/${enc(m.id)}`); } catch (e) { r = { ok: false, data: { error: e?.message } }; }
      if (r?.ok) {
        dlg.close();
        deps.notify({ tone: 'ok', title: 'Marketplace removed. Installed plugins remain.' });
        // Browse filtered to this marketplace would show an empty grid with no pressed From facet: drop the filter.
        if (page.state.filters?.from === m.id) page.setFilters({ from: null });
        await page.load();
        const a = doc.activeElement;   // the card left with the reload: focus never falls to <body>
        if (!a || a === doc.body) doc.querySelector('#mk-root .mk-head-actions .mk-add-mkt')?.focus();
        return;
      }
      const msg = r?.data?.error || 'remove failed';
      if (!dlg.isOpen()) { deps.notify({ tone: 'err', title: msg }); return; }   // the dialog left with the page (SM70)
      hold(false);
      err.textContent = msg;
      err.hidden = false;
      confirm.focus();   // a browser drops the focus from the disabled button: it comes back inside the dialog
    });
    dlg.replace({ head: [kindTile(doc, 'mkt', { size: 'md' }), title, close], body, foot: [cancel, confirm] });
    removing = dlg;
    dlg.open(opener);
  }

  function openMore(btn, m) {
    const items = [{ label: 'Copy URL', icon: 'copy', onSelect: () => { void copyUrl(m.url); } }];
    const web = repoWebUrl(m.url);
    if (web) items.push({ label: 'Open repository', icon: 'external', onSelect: () => win.open(web, '_blank', 'noopener') });
    items.push({ sep: true }, { label: 'Remove…', icon: 'trash', danger: true, onSelect: () => openRemove(m, btn) });
    deps.openMenu({ doc, anchor: btn, align: 'end', label: m.name || m.id, items });   // SM17
  }

  function onClick(e) {
    const btn = e.target instanceof win.Element ? e.target.closest('button[data-id]') : null;
    const m = btn ? byId(btn.dataset.id) : null;
    if (!m) return;
    if (btn.matches('.mk-mkt-browse')) {
      page.act('browse', { from: m.id });
      // The pressed button stays behind in the now hidden panel (a browser drops that focus to <body>): the From facet
      // it set takes the focus.
      [...doc.querySelectorAll('#mk-root button.mk-facet[data-from]')].find((f) => f.dataset.from === m.id)?.focus();
    }
    else if (btn.matches('.mk-mkt-refresh, .mk-mkt-retry')) { if (btn.getAttribute('aria-disabled') !== 'true') void refreshOne(btn, m); }
    else if (btn.matches('.mk-mkt-more')) openMore(btn, m);
  }

  function header(state, el) {
    const all = button('btn mk-refresh-all');
    all.dataset.focusKey = 'refresh-all';
    all.append(icon(doc, 'refresh', 16), 'Refresh all');
    if (state.refreshing) busy(all, true);   // P3's Refresh pattern: keep the focus, refuse the click (never `disabled`)
    all.addEventListener('click', () => { if (!page.state.refreshing) void page.load({ refresh: true }); });
    const add = button('btn btn-primary mk-add-mkt');
    add.dataset.focusKey = 'add-mkt';
    add.append(icon(doc, 'plus', 16), 'Add marketplace');
    add.addEventListener('click', () => page.act('openAddMarketplace', { opener: add }));
    el.replaceChildren(all, add);
  }

  function render(state, el) {
    const list = state.marketplaces || [];
    if (!list.length) {
      // Kept across renders (browse.mjs): a background re-read never drops what was typed, or the focus.
      if (!el.firstElementChild?.classList.contains('mk-empty-mkts')) {
        el.replaceChildren(renderNoMarketplaces(doc, { onAdd: (url, opener) => page.act('openAddMarketplace', { url, opener }) }));
      }
    } else {
      // Notes the user opened stay open through a re-render (a refresh, another tab's change). Focus that loses its
      // control here (the empty state's field, a removed card) is P3's keepFocus: a twin, else the header's Add.
      const notesOpen = new Set([...el.querySelectorAll('section.mk-mkt')]
        .filter((c) => c.querySelector('.mk-disc')?.getAttribute('aria-expanded') === 'true').map((c) => c.dataset.id));
      const cards = renderMarketplaceCards(doc, list, { now: Date.now(), busy: busyIds, notesOpen });
      cards.addEventListener('click', onClick);
      el.replaceChildren(cards);
    }
    applyFocus();
  }

  return {
    spec: { label: 'Marketplaces', count: (state) => (state.marketplaces || []).length, header, render },
    focus(id) {
      pending = id;
      page.setTab('marketplaces');   // also moves the address to #marketplace/marketplaces (SM63)
      applyFocus();
    },
  };
}
