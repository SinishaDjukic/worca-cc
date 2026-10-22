// ui/public/marketplace/install-sheet.mjs — the plugin sheet in install mode (marketplace P4): Review → Install → Set up →
// Done for one CatalogItem, on P3's shared sheet host (createSheet). Errors stay inside the sheet; every dependency is
// injected (CONTRACT §3.5), so the tests drive it with a fake page and api.
import { createSheet } from './layers.mjs';
import { withButton, fieldError, clearFieldErrors } from '../feedback.mjs';
import { setupSections, renderSetupFields, collectSetupFields, flagMissing } from './setup-fields.mjs';
import { renderSheetHead, renderReview, renderSetupStep, renderDone, errorWash } from './install-view.mjs';

export const STALE_SNAPSHOT = 'This plugin snapshot is stale — Refresh the marketplace and try again.';
const STALE_RE = /not a valid object name|not a tree object|does not exist/;
const list = (v) => (Array.isArray(v) ? v : []);

function button(doc, act, label, cls) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.act = act;
  b.textContent = label;
  return b;
}

/** The install sheet controller. open(target) takes a CatalogItem or { name, marketplace }; it returns true when the
 *  sheet opened (false: installed → openManage, or not found → a toast). */
export function createInstallSheet({ doc, win, page, deps }) {
  let sheet = null;
  let item = null;
  let needsGit = false;
  let saved = {};            // channelId -> the values its Save sent (Done's "Notifies …" line)
  let names = {};            // task source id -> displayName (Set up headings)
  let epoch = 0;             // bumped by open(): an answer from an earlier opening paints and sends nothing
  let installing = false;    // an install POST is out, or its Set up still loads: one at a time (LC-P4-30)
  const edited = new WeakSet();   // .mk-setup sections typed in since they were rendered

  const mine = () => !!sheet && sheet.panel.dataset.mode === 'install';
  const live = (e = epoch) => mine() && sheet.isOpen() && e === epoch;
  const inventory = (it = item) => it?.entry?.inventory || {};
  const url = (it, tail) => `/api/plugins/${encodeURIComponent(it.name)}${tail}`;

  function resolve(target) {
    if (target?.key) return target;
    const name = target?.name;
    if (!name) return null;
    const same = list(page.state.catalog).filter((i) => i?.name === name);
    const hint = target.marketplace || '';
    if (hint) {
      const ids = new Set(list(page.state.marketplaces).filter((m) => m && (m.id === hint || m.name === hint || m.url === hint)).map((m) => m.id));
      const hit = same.find((i) => ids.has(i.marketplace?.id));
      if (hit) return hit;
    }
    return same[0] ?? null;
  }

  // Safari leaves focus on <body> after a mouse click: the opener is then the tile that carries the item's key.
  function openerFor(key) {
    const active = doc.activeElement;
    if (active && active !== doc.body) return active;
    for (const n of doc.getElementsByClassName('mk-tile')) if (n.dataset.key === key) return n;
    return active;
  }

  // One repaint: head (steps), body, foot. Focus goes to `focus`, else — when the repaint took it out of the sheet's
  // controls (or holdFocus parked it on the panel) — to the foot's last action, so it never falls to the page behind
  // the modal sheet (review B M4).
  function paint(step, body, buttons, { focus = null } = {}) {
    sheet.replace({ head: renderSheetHead(doc, item, { step }), body, foot: buttons });
    sheet.setKind(step === 2 ? 'form' : 'viewer');
    if (!sheet.isOpen()) return;
    const inside = doc.activeElement !== sheet.panel && sheet.panel.contains(doc.activeElement);
    const target = focus || (inside ? null : buttons[buttons.length - 1]);
    target?.focus();
  }

  // Chromium moves focus to <body> when the focused button turns disabled (busy): park it on the panel instead.
  function holdFocus() {
    const a = doc.activeElement;
    if (!a || a === doc.body || a.disabled) sheet.panel.focus();
  }

  function paintReview({ step = 0, error = null, retry = false } = {}) {
    const cancel = button(doc, 'cancel', 'Cancel', 'btn btn-quiet');
    const canInstall = !needsGit && !!item.source?.sha && !installing;   // another install still out: Cancel only (LC-P4-30)
    const buttons = canInstall ? [cancel, button(doc, 'install', retry ? 'Try again' : 'Install', 'btn btn-primary')] : [cancel];
    paint(step, renderReview(doc, item, { needsGit, error }), buttons);
  }

  async function install(ev) {
    if (ev.detail > 1 || ev.target.closest?.('[data-act]')?.dataset.fbState) return;   // a dblclick's 2nd half; ✓ Install until Set up paints
    const e = epoch;
    const it = item;
    if (installing) return;   // one install at a time (LC-P4-30): SM70 may close the sheet mid-install, ✓ Install turns idle
    installing = true;
    try {
      const cancel = button(doc, 'cancel', 'Cancel', 'btn btn-quiet');
      const go = button(doc, 'install', 'Install', 'btn btn-primary');
      paint(1, renderReview(doc, item, { needsGit }), [cancel, go], { focus: go });
      cancel.disabled = true;
      sheet.setBusy(true);
      const out = await withButton(go, async () => {
        holdFocus();
        const r = await deps.api('POST', '/api/plugins/install', { repoUrl: it.source.repoUrl, subdir: it.source.subdir,
          name: it.name, sha: it.source.sha, marketplace: it.marketplace.id });
        return { ok: !!r?.ok, r };
      }, { busy: 'Installing…', done: 'Install' });
      if (e === epoch) { sheet.setBusy(false); cancel.disabled = false; }
      const r = out.r;
      if (!r?.ok) installing = false;   // a refusal frees it before the repaint offers Try again
      if (r?.ok) {
        deps.invalidateAgentCaches?.();
        void page.load();
        if (live(e)) await enterSetup(e);
        return;
      }
      if (!live(e)) return;
      if (r?.status === 409 && r.data?.code === 'GIT_MISSING') { needsGit = true; paintReview(); return; }
      const msg = r?.data?.error || '';
      if (/is already installed/.test(msg)) {   // the catalog was stale (installed elsewhere): manage it (LC-P4-19)
        void page.load();
        close();
        page.act('openManage', it.name);
        return;
      }
      paintReview({ step: 1, retry: true, error: STALE_RE.test(msg) ? STALE_SNAPSHOT : msg || 'install failed' });
    } finally {
      installing = false;
    }
  }

  async function enterSetup(e) {
    const r = await deps.api('GET', url(item, '/config'));
    if (!live(e)) return;
    const skip = button(doc, 'skip', 'Skip for now', 'btn btn-quiet mk-foot-start');
    if (!r?.ok) {
      paint(2, renderSetupStep(doc, item, [], { error: r?.data?.error || 'config load failed' }), [skip]);
      return;
    }
    names = Object.fromEntries(list(inventory().taskSources).filter((s) => s?.id && s.displayName).map((s) => [s.id, s.displayName]));
    const sections = setupSections(r.data, { names });
    if (!sections.length) { await goDone(e); return; }
    const body = renderSetupStep(doc, item, sections);
    paint(2, body, [skip, button(doc, 'save', 'Save', 'btn btn-primary')], { focus: body.querySelector('input, select') });
  }

  async function save(btn) {
    if (btn.dataset.fbState === 'busy') return;
    const e = epoch;
    const it = item;
    const body = sheet.body;
    const skip = sheet.foot.querySelector('[data-act="skip"]');
    if (skip) skip.disabled = true;      // Skip closes at once (layer.close ignores busy): never while a save is out
    sheet.setBusy(true);
    const r = await withButton(btn, async () => {
      holdFocus();
      clearFieldErrors(body);
      for (const w of body.querySelectorAll('.mk-wash-bad')) w.remove();
      const secs = [...body.querySelectorAll('.mk-setup')];
      if (secs.reduce((n, el) => n + flagMissing(el), 0)) {
        body.querySelector('.field-invalid')?.focus();
        return { ok: false };
      }
      for (const el of secs) {
        const c = collectSetupFields(el);
        if (c.newProfile) {
          const p = await deps.api('POST', url(it, '/profiles'), { sourceId: c.sourceId, id: c.profile, label: '' });
          if (!live(e)) return { ok: false };
          if (!p?.ok) { fieldError(el.querySelector('.mk-profile-id'), p?.data?.error || 'could not create the profile'); return { ok: false }; }
        }
        const { newProfile, ...req } = c;   // model secrets: { target, values }
        const put = await deps.api('PUT', url(it, '/config'), req);
        if (!live(e)) return { ok: false };
        if (!put?.ok) {
          const wash = errorWash(doc, put?.data?.error || 'save failed');
          const ok = body.querySelector('.mk-wash-ok');
          if (ok) ok.after(wash); else body.prepend(wash);
          return { ok: false };
        }
        if (c.channelId) saved[c.channelId] = c.values;
      }
      return { ok: true };
    }, { busy: 'Saving…', done: 'Saved' });
    if (e !== epoch) return;
    sheet.setBusy(false);
    if (skip) skip.disabled = false;
    if (doc.activeElement === sheet.panel) btn.focus();       // a refused PUT: back on Save
    if (r.ok && live(e)) { sheet.setKind('form'); await goDone(e); }   // saved: Escape no longer asks while Done loads
  }

  async function switchProfile(sel) {
    const sec = sel.closest('.mk-setup');
    if (!sec) return;
    const e = epoch;
    const prev = sec.dataset.profile ?? '';
    if (edited.has(sec) && !(await deps.confirmModal({ title: 'Discard unsaved changes?',
      message: 'Switching profiles discards the edits you have not saved.', confirmLabel: 'Discard and switch' }))) {
      sel.value = prev;
      return;
    }
    const r = await deps.api('GET', url(item, `/config?profile=${encodeURIComponent(sel.value)}`));
    if (!live(e) || !sec.isConnected) return;
    const next = r?.ok ? setupSections(r.data, { names }).find((s) => s.kind === 'source' && s.id === sec.dataset.sourceId) : null;
    if (!next) {
      sel.value = prev;
      sec.before(errorWash(doc, r?.data?.error || 'config load failed'));
      return;
    }
    const fresh = renderSetupFields(doc, next, { mode: 'install' });
    sec.replaceWith(fresh);
    fresh.querySelector('.mk-profile-sel')?.focus();         // the old select left with focus (review B M4)
    if (![...sheet.body.querySelectorAll('.mk-setup')].some((x) => edited.has(x))) sheet.setKind('form');   // a switch reads; it is no edit
  }

  async function goDone(e) {
    const chat = list(inventory().chatChannels);
    let channels = [];
    if (chat.length) {
      const r = await deps.api('GET', '/api/chat/status');
      if (!live(e)) return;
      channels = r?.ok ? list(r.data?.channels) : [];
    }
    const done = button(doc, 'done', 'Done', 'btn btn-primary');
    const buttons = chat.length ? [button(doc, 'test', 'Send test message', 'btn'), done] : [done];
    paint(3, renderDone(doc, item, { channels, values: saved }), buttons, { focus: done });
  }

  async function sendTest(btn) {
    const e = epoch;
    const it = item;
    const body = sheet.body;
    const fail = (title, detail) => {
      if (live(e)) body.querySelector('.mk-done-hero')?.after(errorWash(doc, detail, { title }));
      return { ok: false, error: detail };
    };
    await withButton(btn, async () => {
      holdFocus();
      for (const w of body.querySelectorAll('.mk-wash-bad')) w.remove();
      for (const c of list(inventory(it).chatChannels)) {
        if (!live(e)) return { ok: false };
        const r = await deps.api('POST', '/api/chat/test', { plugin: it.name, channelId: c.id });
        if (!r?.ok) return fail('Test message not sent', r?.data?.error || `The server answered ${r?.status}.`);
        const failed = list(r.data?.results).filter((x) => !x?.ok);
        if (failed.length) return fail(`Delivery failed for ${failed.map((f) => f.chatId).join(', ')}`, failed[0].error?.message || failed[0].error?.kind || '');
      }
      return { ok: true };
    }, { busy: 'Sending…', done: 'Delivered' });
    if (live(e) && doc.activeElement === sheet.panel && btn.isConnected) btn.focus();
  }

  function close() { sheet?.close(); }

  // SM70: leaving #marketplace (Back, a shortcut) closes the sheet; an install already out still finishes server-side.
  function onHash() {
    if (live() && !String(win.location?.hash ?? '').startsWith('#marketplace')) close();
  }

  function onLink(ev, a) {
    const kind = a.dataset.link;
    if (kind === 'manage') {
      ev.preventDefault();
      close();
      page.setTab('installed');
      page.act('openManage', item.name);
    } else if (kind === 'browse') {
      ev.preventDefault();
      close();
      page.act('browse', { adds: item.iconKind });
    } else {
      close();                 // landing / connectors: the link navigates on its own (SM70)
    }
  }

  function onClick(ev) {
    if (!mine()) return;       // SM55: P6's manage and update sheets share this panel
    const a = ev.target.closest?.('[data-link]');
    if (a && sheet.panel.contains(a)) { onLink(ev, a); return; }
    const b = ev.target.closest?.('[data-act]');
    if (!b || !sheet.panel.contains(b) || b.dataset.act === 'close') return;   // P3's closeButton closes the layer itself
    const act = b.dataset.act;
    if (act === 'cancel' || act === 'done') close();
    else if (act === 'install') void install(ev);
    else if (act === 'skip') { close(); page.setTab('installed'); }
    else if (act === 'save') void save(b);
    else if (act === 'test') void sendTest(b);
  }

  function onInput(ev) {
    if (!mine() || ev.target.classList?.contains('mk-profile-sel')) return;   // a select fires input too
    const sec = ev.target.closest?.('.mk-setup');
    if (sec) edited.add(sec);
  }

  function onChange(ev) {
    if (mine() && ev.target.classList?.contains('mk-profile-sel')) void switchProfile(ev.target);
  }

  function open(target) {
    const found = resolve(target);
    if (!found) {
      const name = target?.name;
      if (name && list(page.state.plugins).some((p) => p?.name === name)) { page.act('openManage', name); return false; }   // installed; no marketplace lists it now
      const hint = target?.marketplace || '';
      if (name) deps.notify({ tone: 'err', title: name, detail: `not found in a synced marketplace — refresh marketplaces${hint ? ` (the policy names ${hint})` : ''}.` });
      return false;
    }
    if (live() && item?.key === found.key) return true;   // already on screen for it: keep its step and what was typed (LC-P4-31)
    if (found.installed) { page.act('openManage', found.name); return false; }
    const opener = openerFor(found.key);
    item = found;
    needsGit = !!list(page.state.marketplaces).find((m) => m?.id === item.marketplace?.id)?.needsGit;
    saved = {};
    names = {};
    epoch += 1;
    if (!sheet) {
      sheet = createSheet({ doc, win });
      win.addEventListener('hashchange', onHash);
      sheet.panel.addEventListener('click', onClick);
      sheet.panel.addEventListener('input', onInput);
      sheet.panel.addEventListener('change', onChange);
    }
    sheet.setBusy(false);                 // a busy flag left by an opening another controller took over
    sheet.panel.dataset.mode = 'install';
    paintReview();
    sheet.open(opener);
    return true;
  }

  return { open, close, isOpen: () => live() };
}
