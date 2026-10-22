// ui/public/marketplace/manage-sheet.mjs — the installed plugin sheet (marketplace P6, board 3.3, F8) on P3's shared sheet
// host: the Enabled switch, the update row, Settings (P4's fields), Health (Doctor), Adds, Source and Remove…. Errors
// stay inside the sheet (P4's error wash); every dependency is injected (CONTRACT §3.5), so the tests drive it with a
// fake page and api.
import { createSheet } from './layers.mjs';
import { askDiscard } from '../modal-guard.mjs';
import { withButton, fieldError, clearFieldErrors } from '../feedback.mjs';
import { icon } from '../icons.mjs';
import { chip } from './kinds.mjs';
import { setupSections, renderSetupFields, collectSetupFields, flagMissing } from './setup-fields.mjs';
import { errorWash } from './install-view.mjs';
import { channelBadge } from '../plugins-view.mjs';
import { renderManageHead, renderHealth, renderAdds, renderSource, renderRemoveRow, renderTestResult } from './manage-view.mjs';

export const TEST_POLL_MS = 5000;
export const TEST_MAX_MS = 5 * 60 * 1000;

const list = (v) => (Array.isArray(v) ? v : []);

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(doc, act, label, cls) {
  const b = make(doc, 'button', cls, label);
  b.type = 'button';
  b.dataset.act = act;
  return b;
}

const groupKey = (s) => (s.kind === 'source' ? `source:${s.id}` : s.kind === 'channel' ? `channel:${s.id}` : 'models');

/** The manage sheet controller: open(name, { section, seeds, opener }), close(), isOpen(), current(). */
export function createManageSheet({ doc, win, page, deps, wait = (ms) => new Promise((r) => win.setTimeout(r, ms)), now = () => Date.now() }) {
  const cache = new Map();    // plugin name -> its last Doctor report (one page session)
  const doctors = new Map();  // plugin name -> its Doctor request still out (a reopened sheet waits on it, never a second run)
  let token = 0;              // bumped by open() and on close: an answer from an earlier opening paints nothing
  let name = null;
  let from = null;            // the opener this sheet was opened from (Review update hands it on)
  let view = null;            // what this open painted: { head, body, settings, groups }
  let saving = 0;             // the token of the open whose Save is out: its hand-offs and Test connection wait (no second PUT)
  // A real close (not a hand-off) parks focus on the Installed tab first; P3 then moves it to the opener, and when the
  // opener is gone or hidden (a removed row, a Browse tile behind the Installed tab) it stays there, never on <body>.
  const sheet = createSheet({ doc, win, onClose: () => {
    token += 1; name = null; view = null;
    const a = doc.activeElement;
    if (sheet.root.classList.contains('hidden') && (!a || a === doc.body || sheet.root.contains(a))) doc.querySelector('.mk-tab[data-tab="installed"]')?.focus();
  } });

  const enc = (n) => encodeURIComponent(n);
  const url = (tail = '') => `/api/plugins/${enc(name)}${tail}`;
  const live = (t = token) => sheet.isOpen() && sheet.panel.dataset.mode === 'manage' && t === token;
  const baselineOf = (g) => JSON.stringify(collectSetupFields(g.setup));
  const changed = (g) => !!g.setup && baselineOf(g) !== g.baseline;
  const isDirty = () => !!view && view.groups.some(changed);
  const rowOf = (n) => list(page.state.plugins).find((p) => p?.name === n) || null;

  function close() { sheet.close(); }

  function secEl(key, { busy = false } = {}) {
    const s = make(doc, 'section', 'mk-sec');
    s.dataset.sec = key;
    if (busy) s.setAttribute('aria-busy', 'true');
    return s;
  }

  function hooked(text, hook) {
    const w = errorWash(doc, text);
    w.classList.add(hook);
    return w;
  }

  // ── Health ────────────────────────────────────────────────────────────────
  function paintHealth(opts) {
    const old = view.body.querySelector('[data-sec="health"]');
    const had = !!old && (old.contains(doc.activeElement) || doc.activeElement === doc.body || doc.activeElement === sheet.panel);
    const fresh = renderHealth(doc, opts);
    old?.replaceWith(fresh);
    // While Doctor runs its button is held: the panel keeps focus (never <body>), the report gives it back.
    if (had) (opts.running ? sheet.panel : fresh.querySelector('.mk-health-run'))?.focus();
    return fresh;
  }

  async function runHealth(t) {
    const n = name;
    paintHealth({ running: true, report: cache.get(n) || null });   // a re-run keeps "Run again" on the held button
    let req = doctors.get(n);
    if (!req) {
      req = deps.api('POST', `/api/plugins/${enc(n)}/doctor`).catch(() => null).then((r) => {
        const report = r?.ok ? r.data : { ok: false, checks: [{ id: 'request', ok: false, detail: r?.data?.error || 'doctor failed' }] };
        cache.set(n, report);
        doctors.delete(n);
        return report;
      });
      doctors.set(n, req);
    }
    const report = await req;
    if (live(t)) paintHealth({ report });
  }

  // ── Enabled ───────────────────────────────────────────────────────────────
  async function toggle(t, input) {
    const enabled = input.checked;
    const had = doc.activeElement === input;
    input.disabled = true;   // one request at a time, as P5's row switch
    if (had) sheet.panel.focus();   // a browser drops focus from a disabled control: the panel holds it meanwhile
    const r = await deps.api('POST', url('/enable'), { enabled });
    input.disabled = false;
    // Give it back, unless the person has moved on meanwhile.
    const a = doc.activeElement;
    if (had && live(t) && (!a || a === doc.body || a === sheet.panel)) input.focus();
    if (r?.ok) {
      deps.invalidateAgentCaches?.();
      if (live(t)) view.head.querySelector('.mk-head-err')?.remove();
      await page.load();
      return;
    }
    if (!live(t)) return;
    input.checked = !enabled;
    view.head.querySelector('.mk-head-err')?.remove();
    view.head.append(hooked(r?.data?.error || 'toggle failed', 'mk-head-err'));
  }

  // ── hand-offs ─────────────────────────────────────────────────────────────
  async function reviewUpdate(t) {
    if (saving === t) return;   // the changes are being saved; the sheet closes on its own
    if (isDirty() && !(await askDiscard(doc))) return;
    if (!live(t)) return;
    page.act('openUpdateReview', [name], { opener: from });
  }

  async function followLink(t, a) {
    const href = a.getAttribute('href');
    if (saving === t) return;
    if (isDirty() && !(await askDiscard(doc))) return;
    if (!live(t)) return;
    close();
    deps.navigate(href);
  }

  function remove(t, btn) {
    if (saving === t) return;
    page.act('openRemove', name, { opener: btn, onRemoved: () => { if (t === token) close(); } });
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  function profileActions() {
    const row = make(doc, 'div', 'mk-profile-actions');
    const add = make(doc, 'button', 'btn btn-sm mk-profile-add', 'Add profile');
    add.type = 'button';
    const del = make(doc, 'button', 'btn btn-sm btn-quiet mk-profile-del', 'Remove profile…');
    del.type = 'button';
    row.append(add, del);
    return row;
  }

  // Model secrets with the credential broker on (setupSections leaves them out): the broker chip and the key page. A
  // value still saved here (worca refuses to start until it is cleared) gets "Clear saved values", never a form: the
  // server refuses a typed key while the broker is on, and only `null` clears a stored one.
  function brokerParts(section) {
    const parts = [make(doc, 'h4', 'subsection-title mk-setup-h', 'Model secrets')];
    const row = make(doc, 'div', 'mk-broker');
    row.append(chip(doc, 'n', 'Credential broker'));
    if (section.broker.keyPage) {
      const a = make(doc, 'a', 'mk-link', 'Key page');
      a.href = section.broker.keyPage;
      a.target = '_blank';
      a.rel = 'noopener';
      a.append(icon(doc, 'external', 14));
      row.append(a);
    }
    parts.push(row);
    if (Object.values(section.values || {}).some((v) => v?.set === true)) {
      const clear = make(doc, 'button', 'btn btn-sm mk-clear-secrets', 'Clear saved values');
      clear.type = 'button';
      row.append(chip(doc, 'warn', 'Clear these values'), clear);
    }
    return { parts, setup: null };
  }

  // PUT null for every broker-held key still saved, then re-read the config and repaint this group only (typed edits in
  // the other groups stay).
  async function clearSecrets(t, g, btn) {
    const keys = Object.entries(g.section.values || {}).filter(([, v]) => v?.set === true).map(([k]) => k);
    if (!keys.length) return;
    const pending = withButton(btn, async () => {
      const put = await deps.api('PUT', url('/config'), { target: 'modelSecrets', values: Object.fromEntries(keys.map((k) => [k, null])) });
      if (!live(t)) return { ok: false };
      if (!put?.ok) { groupErr(g, put?.data?.error || 'save failed'); return { ok: false }; }
      return { ok: true };
    }, { busy: 'Clearing…', done: 'Cleared' });
    // "Clearing…" is disabled (a browser drops its focus to <body>) and the repaint removes it: the panel holds focus.
    if (doc.activeElement === btn || !sheet.panel.contains(doc.activeElement)) sheet.panel.focus();
    const r = await pending;
    if (!r.ok && live(t) && doc.activeElement === sheet.panel && btn.isConnected) btn.focus();
    if (!r.ok || !live(t)) return;
    const cfg = await deps.api('GET', url('/config'));
    if (!live(t) || !g.el.isConnected) return;
    const m = cfg?.ok ? cfg.data?.models : null;
    const next = m?.broker && list(m.schema).length
      ? { kind: 'modelSecrets', id: '', title: 'Model secrets', schema: m.schema, values: m.values, broker: m.broker }
      : cfg?.ok ? setupSections(cfg.data, { names: view.names }).find((x) => x.kind === 'modelSecrets') : null;
    if (!next) { groupErr(g, cfg?.data?.error || 'config load failed'); return; }
    fillGroup(g, next);
  }

  function fillGroup(g, section) {
    g.section = section;
    if (section.broker) {
      const { parts, setup } = brokerParts(section);
      g.setup = setup;
      g.el.replaceChildren(...parts);
    } else {
      g.setup = renderSetupFields(doc, section, { mode: 'manage' });
      g.setup.querySelector('.mk-profile-sel')?.closest('.field')?.append(profileActions());
      g.el.replaceChildren(g.setup);
      if (section.kind === 'source' && (!section.multiProfile || section.profile)) g.el.append(testRow());
      if (section.kind === 'channel') {
        const st = list(page.state.channelStatus).find((c) => c?.plugin === name && c?.channelId === section.id);
        if (st) {
          const row = make(doc, 'div', 'mk-chan-row');
          row.append(channelBadge(doc, st));
          g.el.append(row);
        }
      }
    }
    if (g.single) g.el.querySelector('.mk-setup-h')?.remove();
    g.baseline = g.setup ? baselineOf(g) : '';
  }

  function makeGroup(section) {
    const el = make(doc, 'div', 'mk-setup-group');
    el.dataset.group = groupKey(section);
    return { el, title: section.title, section, setup: null, baseline: '', single: false };
  }

  function testRow() {
    const row = make(doc, 'div', 'mk-test-row');
    const b = make(doc, 'button', 'btn btn-sm mk-test', 'Test connection');
    b.type = 'button';
    const out = make(doc, 'div', 'mk-test-out');
    out.setAttribute('aria-live', 'polite');
    row.append(b, out);
    return row;
  }

  // Test connection: save the group's changes first, then poll validateConfig every TEST_POLL_MS while the connector
  // answers pending, for up to TEST_MAX_MS; a newer click or closing the sheet stops the older loop.
  async function testConnection(t, g) {
    const out = g.el.querySelector('.mk-test-row > .mk-test-out');
    if (!out || !g.setup || saving === t) return;
    const run = (Number(out.dataset.run) || 0) + 1;
    out.dataset.run = String(run);
    const owns = () => live(t) && out.isConnected && out.dataset.run === String(run);
    const show = (el) => out.replaceChildren(...el.childNodes);
    const n = name;
    clearFieldErrors(g.el);
    show(renderTestResult(doc, { testing: true }));
    if (changed(g)) {
      const c = collectSetupFields(g.setup);
      const { newProfile, ...req } = c;
      const put = await deps.api('PUT', url('/config'), req);
      if (!owns()) return;
      if (!put?.ok) { show(renderTestResult(doc, { ok: false, errors: [{ message: put?.data?.error || 'save failed' }] })); return; }
      g.baseline = JSON.stringify(c);   // what was sent: an edit typed while the PUT was out stays a change
    }
    const profile = g.setup.dataset.profile || null;
    const started = now();
    for (;;) {
      const r = await deps.api('POST', '/api/sources/call', { plugin: n, sourceId: g.section.id, op: 'validateConfig', ...(profile ? { profile } : {}) });
      if (!owns()) return;
      const result = r?.ok && r.data?.ok ? r.data.result : { ok: false, ...(r?.data || {}) };
      const placed = [];
      for (const e of list(result?.errors)) {
        const input = [...g.setup.querySelectorAll('[data-key]')].find((c) => c.dataset.key === e?.field);
        if (input) { fieldError(input, e.message, { focus: false }); placed.push(e.field); }
      }
      show(renderTestResult(doc, result, { placed }));
      if (result?.ok || !result?.pending) return;
      if (now() - started > TEST_MAX_MS) {
        show(renderTestResult(doc, { ok: false, errors: [{ message: 'Timed out waiting for the sign-in' }] }));
        return;
      }
      await wait(TEST_POLL_MS);
      if (!owns()) return;
    }
  }

  const groupOf = (node) => { const el = node.closest?.('.mk-setup-group'); return view?.groups.find((g) => g.el === el) || null; };

  function groupErr(g, text) {
    g.el.querySelector(':scope > .mk-group-err')?.remove();
    g.el.prepend(hooked(text, 'mk-group-err'));
  }

  // Re-read one source group (a profile switch, a new or deleted profile) and paint it from the server's answer.
  async function reread(t, g, profile) {
    const r = await deps.api('GET', url(`/config${profile ? `?profile=${enc(profile)}` : ''}`));
    if (!live(t) || !g.el.isConnected) return false;
    const next = r?.ok ? setupSections(r.data, { names: view.names }).find((x) => x.kind === 'source' && x.id === g.section.id) : null;
    if (!next) { groupErr(g, r?.data?.error || 'config load failed'); return false; }
    fillGroup(g, next);
    g.el.querySelector('.mk-profile-sel')?.focus();
    return true;
  }

  // #confirm-modal gives no focus back when it closes (a browser parks it on <body>): the sheet's control that asked takes it.
  const refocus = (t, el) => { if (live(t) && el?.isConnected && !sheet.panel.contains(doc.activeElement)) el.focus(); };

  async function switchProfile(t, g, sel) {
    const prev = g.setup?.dataset.profile ?? '';
    const wanted = sel.value;
    if (changed(g) && !(await deps.confirmModal({ title: 'Discard unsaved changes?',
      message: 'Switching profiles discards the edits you have not saved.', confirmLabel: 'Discard and switch' }))) {
      sel.value = prev;
      refocus(t, sel);
      return;
    }
    if (!live(t)) return;
    if (!(await reread(t, g, wanted)) && sel.isConnected) { sel.value = prev; refocus(t, sel); }
  }

  async function addProfile(t, g, btn) {
    let answers = { id: '', label: '' };
    let error = '';
    for (;;) {
      const a = await deps.promptModal({
        title: 'New profile', confirmLabel: 'Create', message: error, messageTone: error ? 'err' : null,
        fields: [
          { id: 'id', label: 'Profile id', placeholder: 'work', mono: true, required: true, value: answers.id,
            hint: 'Lowercase letters, digits and dashes — e.g. "work".' },
          { id: 'label', label: 'Display name', placeholder: 'optional', value: answers.label },
        ],
      });
      if (!a || !live(t)) { refocus(t, btn); return; }
      answers = a;
      const r = await deps.api('POST', url('/profiles'), { sourceId: g.section.id, id: a.id, label: a.label });
      if (!live(t)) return;
      if (r?.ok) break;
      error = r?.data?.error || 'could not create the profile';
    }
    await reread(t, g, answers.id);
  }

  async function deleteProfile(t, g, btn) {
    const p = g.setup?.dataset.profile;
    if (!p) return;
    const yes = await deps.confirmModal({ title: 'Delete profile', danger: true, confirmLabel: 'Delete',
      message: `Delete profile "${p}"?\n\nIts settings, token and any project bound to it are removed.` });
    if (!yes || !live(t)) { refocus(t, btn); return; }
    const r = await deps.api('DELETE', url(`/profiles/${enc(p)}?sourceId=${enc(g.section.id)}`));
    if (!live(t)) return;
    if (!r?.ok) { groupErr(g, r?.data?.error || 'could not delete the profile'); refocus(t, btn); return; }
    await reread(t, g, null);
  }

  // Save: one PUT per changed group (an untouched stored secret is never sent; a channel PUT restarts its worker).
  async function save(t, btn) {
    if (!live(t) || btn.dataset.fbState === 'busy') return;
    const todo = view.groups.filter(changed);
    if (!todo.length) { close(); return; }
    const cancel = sheet.foot.querySelector('[data-act="cancel"]');
    const settings = view.settings;
    sheet.setBusy(true);
    if (cancel) cancel.disabled = true;
    saving = t;
    const pending = withButton(btn, async () => {
      settings.querySelector('.mk-save-err')?.remove();
      clearFieldErrors(view.body);
      if (todo.reduce((n, g) => n + flagMissing(g.setup), 0)) return { ok: false };
      let sent = false;
      for (const g of todo) {
        const c = collectSetupFields(g.setup);
        if (c.newProfile) {
          const p = await deps.api('POST', url('/profiles'), { sourceId: c.sourceId, id: c.profile, label: '' });
          if (!live(t)) return { ok: false };
          if (!p?.ok) { fieldError(g.setup.querySelector('.mk-profile-id'), p?.data?.error || 'could not create the profile'); return { ok: false }; }
        }
        const { newProfile, ...req } = c;
        const put = await deps.api('PUT', url('/config'), req);
        if (!live(t)) return { ok: false };
        if (!put?.ok) {
          const wash = hooked(put?.data?.error || 'save failed', 'mk-save-err');
          settings.querySelector('.mk-sec-head').after(wash);
          wash.scrollIntoView?.({ block: 'nearest' });
          return { ok: false, sent };
        }
        sent = true;
        g.baseline = JSON.stringify(c);   // what was sent, never what was typed meanwhile
      }
      return { ok: true, sent };
    }, { busy: 'Saving…', done: 'Saved' });
    // "Saving…" is disabled, and a browser then drops its focus to <body>, from where Tab reaches the page behind the
    // sheet: the panel holds focus while the PUTs are out, and a refusal gives it back to Save.
    if (doc.activeElement === btn || !sheet.panel.contains(doc.activeElement)) sheet.panel.focus();
    const r = await pending;
    if (saving === t) saving = 0;
    if (t !== token) { if (r.sent) void page.load(); return; }
    sheet.setBusy(false);
    if (cancel) cancel.disabled = false;
    const back = () => { if (doc.activeElement === sheet.panel && btn.isConnected) btn.focus(); };
    if (!r.ok) { back(); return; }
    const typed = isDirty();   // typed while Save ran (each baseline is what was sent): still a change, the sheet stays
    if (typed) back(); else close();
    if (r.sent) {
      deps.notify({ tone: 'ok', title: 'Settings saved.' });
      // The reload can take the opener away (a "Set up" whose setup is now complete): the Installed tab, never <body>.
      void page.load().then(() => { const a = doc.activeElement; if (!typed && (!a || a === doc.body)) doc.querySelector('.mk-tab[data-tab="installed"]')?.focus(); });
    }
  }

  function settingsHead(title) {
    const head = make(doc, 'div', 'mk-sec-head');
    const h = make(doc, 'h3', 'section-title', 'Settings');
    h.id = 'mk-sec-settings';
    head.append(h);
    if (title) head.append(make(doc, 'span', 'mk-meta', title));
    return head;
  }

  function paintSettings(t, r, names, { seeds = null, focus = false } = {}) {
    const ph = view.body.querySelector('[data-sec="settings"]');
    if (!r?.ok) {
      const sec = secEl('settings');
      sec.append(settingsHead(null), hooked(r?.data?.error || 'config load failed', 'mk-sec-err'));
      ph.replaceWith(sec);
      view.settings = sec;
      return;
    }
    const sections = setupSections(r.data, { names });
    const m = r.data?.models;
    if (m?.broker && list(m.schema).length) sections.push({ kind: 'modelSecrets', id: '', title: 'Model secrets', schema: m.schema, values: m.values, broker: m.broker });
    const groups = sections.map(makeGroup);
    if (!groups.length) { ph.remove(); return; }
    const single = groups.length === 1;
    for (const g of groups) { g.single = single; fillGroup(g, g.section); }
    const sec = secEl('settings');
    sec.setAttribute('aria-labelledby', 'mk-sec-settings');
    const head = settingsHead(single ? groups[0].title : null);
    sec.append(head, ...groups.map((g) => g.el));
    ph.replaceWith(sec);
    view.settings = sec;
    view.groups = groups;
    if (seeds && typeof seeds === 'object') {
      let filled = 0;
      for (const c of sec.querySelectorAll('input[data-key]:not([type="password"]):not([data-set="1"]), select[data-key]')) {
        if (!Object.hasOwn(seeds, c.dataset.key) || String(c.value ?? '').trim()) continue;
        c.value = String(seeds[c.dataset.key]);
        if (c.value === String(seeds[c.dataset.key])) filled += 1;   // a select without that option takes nothing
      }
      if (filled) head.append(chip(doc, 'n', 'From team policy'));
    }
    if (groups.some((g) => g.setup)) {   // a broker chip alone has nothing to save: no foot (LC-P6-13)
      const cancel = button(doc, 'cancel', 'Cancel', 'btn btn-quiet');
      const saveBtn = button(doc, 'save', 'Save', 'btn btn-primary');
      cancel.addEventListener('click', () => { if (live(t)) close(); });
      saveBtn.addEventListener('click', () => { void save(t, saveBtn); });
      sheet.replace({ foot: [cancel, saveBtn] });
    }
    if (focus) sec.querySelector('[data-key], .mk-profile-id')?.focus();
  }

  // ── Adds + Source ─────────────────────────────────────────────────────────
  function paintAdds(r) {
    const ph = view.body.querySelector('[data-sec="adds"]');
    if (!r?.ok) {
      const sec = secEl('adds');
      sec.append(make(doc, 'h3', 'section-title', 'Adds'), hooked(r?.data?.error || 'plugin not found', 'mk-sec-err'));
      ph.replaceWith(sec);
      return;
    }
    const adds = renderAdds(doc, r.data?.inventory);
    ph.replaceWith(...[adds, renderSource(doc, r.data)].filter(Boolean));
  }

  // ── listeners on what one open painted ────────────────────────────────────
  function wire(t, head, body) {
    head.addEventListener('click', (ev) => {
      if (!live(t)) return;
      if (ev.target.closest?.('.mk-review-update')) void reviewUpdate(t);
    });
    head.addEventListener('change', (ev) => {
      if (live(t) && ev.target.classList?.contains('mk-manage-enable')) void toggle(t, ev.target);
    });
    body.addEventListener('click', (ev) => {
      if (!live(t)) return;
      const run = ev.target.closest?.('.mk-health-run');
      if (run) { void runHealth(t); return; }
      const rm = ev.target.closest?.('.mk-remove');
      if (rm) { remove(t, rm); return; }
      const test = ev.target.closest?.('.mk-test');
      if (test && groupOf(test)) { void testConnection(t, groupOf(test)); return; }
      const add = ev.target.closest?.('.mk-profile-add');
      if (add && groupOf(add)) { void addProfile(t, groupOf(add), add); return; }
      const del = ev.target.closest?.('.mk-profile-del');
      if (del && groupOf(del)) { void deleteProfile(t, groupOf(del), del); return; }
      const clr = ev.target.closest?.('.mk-clear-secrets');
      if (clr && groupOf(clr)) { void clearSecrets(t, groupOf(clr), clr); return; }
      const a = ev.target.closest?.('a.mk-link[href^="#"]');
      if (a) { ev.preventDefault(); void followLink(t, a); }
    });
    body.addEventListener('change', (ev) => {
      if (!live(t) || !ev.target.classList?.contains('mk-profile-sel')) return;
      const g = groupOf(ev.target);
      if (g) void switchProfile(t, g, ev.target);
    });
  }

  async function open(n, { section = null, seeds = null, opener = null } = {}) {
    let row = rowOf(n);
    if (!row) {   // a caller ahead of the page's reload (P4's "already installed", LC-P4-19): read the page once
      const t0 = token;
      opener = opener || doc.activeElement;
      await page.load();
      // SM70: the person left #marketplace while the page re-read: no sheet over the page they moved to.
      row = t0 === token && String(win.location?.hash ?? '').startsWith('#marketplace') ? rowOf(n) : null;
      if (!row) return;
    }
    const t = ++token;
    name = n;
    from = opener || doc.activeElement;
    const head = renderManageHead(doc, row);
    const body = make(doc, 'div', 'mk-manage-body');
    body.append(secEl('settings', { busy: true }), renderHealth(doc, { report: cache.get(n) || null }), secEl('adds', { busy: true }),
      renderRemoveRow(doc, n));
    view = { head, body, settings: null, groups: [], names: {} };
    wire(t, head, body);
    sheet.setBusy(false);
    sheet.setKind('form', { isDirty });
    sheet.panel.dataset.mode = 'manage';
    sheet.replace({ head, body, foot: null });
    sheet.open(from);
    if (section === 'health') body.querySelector('[data-sec="health"]')?.scrollIntoView?.({ block: 'nearest' });
    if (section === 'health' || doctors.has(n)) void runHealth(t);   // a Doctor run from an earlier opening still out: show it
    const [det, cfg] = await Promise.all([deps.api('GET', url()), deps.api('GET', url('/config'))]);
    if (!live(t)) return;
    paintAdds(det);
    const names = Object.fromEntries(list(det?.ok ? det.data?.inventory?.taskSources : [])
      .filter((s) => s?.id && s.displayName).map((s) => [s.id, s.displayName]));
    view.names = names;
    paintSettings(t, cfg, names, { seeds, focus: section === 'settings' });
  }

  // A background refresh repaints only the head (the switch and the update row); a plugin gone closes the sheet.
  page.onChange((state) => {
    if (!live()) return;
    const row = list(state.plugins).find((p) => p?.name === name);
    if (!row) {
      close();
      // The page renders right after this change and can take the opener's row away: the Installed tab, never <body>.
      void Promise.resolve().then(() => { const a = doc.activeElement; if (!a || a === doc.body) doc.querySelector('.mk-tab[data-tab="installed"]')?.focus(); });
      return;
    }
    const sw = view.head.querySelector('input.mk-manage-enable');
    if (sw && !sw.disabled) sw.checked = row.enabled !== false;   // held: its own request decides
    const fresh = renderManageHead(doc, row).querySelector('.mk-manage-upd');
    const old = view.head.querySelector('.mk-manage-upd');
    const had = !!old?.contains(doc.activeElement);   // the rebuilt row takes the focus the old one held
    if (old && fresh) old.replaceWith(fresh);
    else if (old) old.remove();
    else if (fresh) view.head.querySelector('.mk-sheet-id').after(fresh);
    if (had) (fresh?.querySelector('.mk-review-update') || sw || sheet.panel).focus();
  });

  // SM70: leaving #marketplace closes the sheet without asking — the user left.
  win.addEventListener('hashchange', () => {
    if (live() && !String(win.location?.hash ?? '').startsWith('#marketplace')) close();
  });

  return { open, close, isOpen: () => live(), current: () => (live() ? name : null) };
}
