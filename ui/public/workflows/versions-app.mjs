// ui/public/workflows/versions-app.mjs — workflow versions in the Workflows view (plans/workflow-tests-plan.md Part 1):
// the Canvas · Versions · Tests switch, the top-bar status line, Save version and the Versions page's actions, plus the
// gvApi calls they use. app.js builds one controller per page load (createWorkflowVersions) and calls it from its own
// functions; the Tests page is tests-app.mjs.
import { notify } from '../feedback.mjs';
import { flagOn, onFlagChange } from '../flags.mjs';
import { isReservedWorkflowId, pluginOriginName } from '../graph/composer.mjs';
import { openSaveVersionDialog, openUseVersionDialog, statusText } from './version-dialogs.mjs';
import { renderVersionsPage } from './versions-view.mjs';

/** Plugin rows and the built-ins never have versions (D5); a format-1 row is not a graph (isVersionableRow). */
export function workflowCanHaveVersions(w) {
  return !!w && Number(w.version) === 2 && !isReservedWorkflowId(w.id) && !String(w.origin || '').startsWith('plugin:');
}

/** The versions calls app.js spreads into gvApi. `fetch` and `safeJson` are app.js's. */
export function workflowVersionsApi({ fetch, safeJson }) {
  const api = {
    // {ok, overview} | {ok: false, status, error}: never throws (a refused fetch is status 0). 400 = this row cannot
    // have versions (a plugin's, or not a graph).
    versionsRead: async (id) => {
      try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/versions`);
        const d = await safeJson(res);
        return res.ok ? { ok: true, overview: d } : { ok: false, status: res.status, error: (d && d.error) || `versions failed (${res.status})` };
      } catch (e) { return { ok: false, status: 0, error: `Worca did not answer (${e.message}).` }; }
    },
    versions: async (id) => { const r = await api.versionsRead(id); return r.ok ? r.overview : null; },
    saveVersion: async (id, body) => {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const d = await safeJson(res);
      return res.ok ? { ok: true, overview: d } : { ok: false, error: d && d.error };
    },
    useVersion: async (id, no) => {
      const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/versions/${no}/use`, { method: 'POST' });
      const d = await safeJson(res);
      return res.ok ? { ok: true, overview: d } : { ok: false, error: d && d.error };
    },
    restoreRevision: async (id, rev) => {
      try {
        const res = await fetch(`/api/workflows/${encodeURIComponent(id)}/history/${rev}/restore`, { method: 'POST' });
        const d = await safeJson(res);
        return res.ok ? { ok: true, ...d } : { ok: false, status: res.status, error: d && d.error, errors: d && d.errors };
      } catch (e) { return { ok: false, status: 0, error: `Worca did not answer (${e.message}).` }; }
    },
  };
  return api;
}

/** A row read with GET ?use=live (flag workflowTests) carries the versionNo of the version in use. */
export const hasVersionInUse = (row) => Boolean(row && Number.isInteger(row.versionNo));

/** Save as workflow defaults while a version is in use: the defaults went into the draft, and new runs keep using the
 *  version in use, which does not have them. The project's picks are therefore kept, so new runs keep running them;
 *  the toast says where the defaults went (user decision, final review). `repaint` repaints the step rows. */
export async function keepPicksForVersionInUse(repaint) {
  notify({ tone: 'ok', title: 'Saved to your draft. New runs keep these picks until you use a new version.' });
  await repaint();
}

/**
 * The versions controller. deps: { doc, win, composer: () => gvComposer, els: wfvEls, api: gvApi,
 * confirmModal, tests: () => the tests-app.mjs controller }.
 */
export function createWorkflowVersions(deps) {
  const { doc, win, api: gvApi, confirmModal } = deps;
  const composer = () => deps.composer();
  const wfvEls = () => deps.els();
  const tests = () => deps.tests();
  let wfvVersionsOverview = null;
  let wfvVersionsError = null;     // {status, error} of the last failed read (status 0: no answer, 400: cannot have versions)
  /** Read the open workflow's versions, paint the status line and (when shown) the Versions page. Never rejects. */
  async function wfvRefreshVersions() {
    const els = wfvEls();
    const paintPage = () => { if (els.versions && !els.versions.hidden) wfvRenderVersionsPage(); };
    const t = composer() && composer().template();
    if (!flagOn('workflowTests') || !t || !t.id) {
      wfvVersionsOverview = null; wfvVersionsError = null;
      if (els.vstatus) els.vstatus.hidden = true;
      paintPage();
      if (els.tests && !els.tests.hidden) void tests().refresh();   // a new, unsaved canvas: the Tests page says so (C15)
      return null;
    }
    // Another workflow is open now: the page drops the rows of the one that left at once ("Reading the versions…").
    if (!wfvVersionsOverview || wfvVersionsOverview.workflowId !== t.id) paintPage();
    const r = await gvApi.versionsRead(t.id);
    // Another workflow opened while this one was asked for: its own refresh paints the line, not this late answer.
    const now = composer().template();
    if (!now || now.id !== t.id) return null;
    wfvVersionsOverview = r.ok ? r.overview : null;
    wfvVersionsError = r.ok ? null : { status: r.status, error: r.error, workflowId: t.id };
    const text = statusText(wfvVersionsOverview);
    // M5: #wfv-vstatus is aria-live: a repeat of the same text after every save is not news, so only a change is written.
    if (els.vstatus) { if (els.vstatus.textContent !== text) els.vstatus.textContent = text; els.vstatus.hidden = !text; }
    paintPage();
    if (els.tests && !els.tests.hidden) void tests().refresh();   // another workflow, or a save: the Tests page follows
    return wfvVersionsOverview;
  }
  function wfvShowPage(page) {
    const els = wfvEls();
    for (const b of els.pages ? els.pages.querySelectorAll('button[data-page]') : []) {
      const on = b.dataset.page === page;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (els.versions) els.versions.hidden = page !== 'versions';
    if (els.tests) els.tests.hidden = page !== 'tests';
    if (page === 'tests') {
      composer()?.select(null);
      els.tests?.focus();
      tests().enterList();          // the list view, its address, then the read
      return;
    }
    tests().syncHash();
    if (page !== 'versions') return;
    // The canvas keys skip only targets inside [data-canvas-keys="off"]: nothing stays selected on the hidden canvas,
    // and the focus sits on the page (tabindex -1), so a click on its text never hands Delete or the arrows to <body>.
    composer()?.select(null);
    els.versions?.focus();
    void wfvRefreshVersions();       // paints the page (it is shown now)
  }
  async function wfvSaveVersion({ afterSave = false } = {}) {
    // Save the draft first when the canvas has unsaved changes: the same path Export… takes (wfvShellActions
    // exportCurrent → gvComposer.openSaveDialog({ then })), so an unsaved canvas is never versioned by surprise.
    // A plugin's row and the built-ins never have versions: their Save is Save a copy (composer saveMode), and the copy can.
    const t = composer().template();
    const copyFirst = !t || !t.id || isReservedWorkflowId(t.id) || Boolean(pluginOriginName(composer().origin()));
    // afterSave is the loop guard: a save that still left nothing to version (an edit during the save) stops here.
    const stop = () => notify({ tone: 'err', title: 'Save version did not start', detail: 'Save the pipeline, then press Save version again.' });
    if (composer().isDirty() || copyFirst) {
      if (afterSave) { stop(); return; }
      composer().openSaveDialog({ then: () => void wfvSaveVersion({ afterSave: true }) });
      return;
    }
    const o = await wfvRefreshVersions();
    if (composer().template().id !== t.id) return;            // another workflow opened meanwhile
    if (!o && wfvVersionsError && wfvVersionsError.status === 400) {
      // The server says this row cannot have versions: save it (a copy where the composer must) first. After that save
      // a 400 again is the server's verdict on this row, not a save left undone: its reason is the useful text.
      if (afterSave) { notify({ tone: 'err', title: 'Save version did not start', detail: wfvVersionsError.error }); return; }
      composer().openSaveDialog({ then: () => void wfvSaveVersion({ afterSave: true }) });
      return;
    }
    if (!o) {
      notify({ tone: 'err', title: 'Versions are not available', detail: (wfvVersionsError && wfvVersionsError.error) || 'Worca did not answer.' });
      return;
    }
    // What Save version compares against: the latest version (null: this will be the first).
    const since = o.sinceLatest || null;
    openSaveVersionDialog({ doc, win, nextNo: (since ? since.versionNo : 0) + 1,
      sinceNo: since ? since.versionNo : null, changes: since ? since.changes : [], unchanged: !!since && since.changed === false,
      onSubmit: async (body) => { const r = await gvApi.saveVersion(t.id, body); if (r.ok) await wfvRefreshVersions(); return r; } });
  }
  /** Paint the Versions page (versions-view.mjs) from the last overview; without one, wfvVersionsError says why. */
  function wfvRenderVersionsPage() {
    const els = wfvEls();
    if (!els.versions || !composer()) return;
    const t = composer().template();
    const id = t && t.id;
    const o = id && wfvVersionsOverview && wfvVersionsOverview.workflowId === id ? wfvVersionsOverview : null;
    // A repaint replaces the page's buttons: the focus they held goes to the same button again (its data-focus-key),
    // else to the page, never <body>, where the canvas keys would answer.
    const focused = doc.activeElement;
    const hadKey = focused && focused !== els.versions && els.versions.contains(focused) ? (focused.dataset.focusKey || '') : null;
    try { wfvPaintVersions(els, id, o); } finally {
      if (hadKey !== null && !els.versions.contains(doc.activeElement)) {
        const again = hadKey ? [...els.versions.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === hadKey) : null;
        (again || els.versions).focus();
      }
    }
  }
  function wfvPaintVersions(els, id, o) {
    const err = wfvVersionsError && wfvVersionsError.workflowId === id ? wfvVersionsError : null;
    renderVersionsPage(els.versions, o, {
      saveVersion: () => void wfvSaveVersion(),
      useVersion: (no) => {
        if (!o) return;
        const target = o.versions.find((v) => v.versionNo === no);
        const inUse = o.versions.find((v) => v.inUse);
        openUseVersionDialog({ doc, win, versionNo: no,
          // What changes for new runs: the version in use → this one (server changesFromInUse), not this version's own changes.
          // null: no version is in use yet (a workflow deleted and saved again), never "Nothing differs".
          changes: target && Array.isArray(target.changesFromInUse) ? target.changesFromInUse : null,
          // D6: every version runs today's Library text; say so once when either version recorded older text.
          libraryEdited: Boolean((target && target.libraryEdited) || (inUse && inUse.libraryEdited)),
          onConfirm: async () => {
            const r = await gvApi.useVersion(id, no);
            // Another workflow opened meanwhile: its overview is not this answer.
            if (r.ok && composer().template().id === id) { wfvVersionsOverview = r.overview; await wfvRefreshVersions(); }
            return r;
          } });
      },
      restore: async (rev, label) => {
        // #721: restoring the workflow open on the canvas while it has unsaved changes asks first. That one question
        // covers the canvas too: the restored draft loads with loadTemplate, not openTemplate, whose own
        // "Discard changes?" would ask the same thing a second time.
        if (composer().isDirty()) {
          const ok = await confirmModal({ title: 'Restore into your draft?', confirmLabel: 'Restore',
            message: 'Your canvas has unsaved changes. Restoring replaces them with the saved state.' });
          if (!ok) return;
        }
        const r = await gvApi.restoreRevision(id, rev);
        if (!r.ok) { notify({ tone: 'err', title: 'Not restored', detail: wfvRestoreRefusal(r) }); return; }
        if (composer().template().id !== id) {
          // Another workflow opened meanwhile: the canvas keeps it, and the toast says which workflow's draft changed.
          notify({ tone: 'ok', title: `Restored ${label} into the draft of "${(o && o.name) || id}"` });
          return;
        }
        composer().loadTemplate(r.workflow);
        wfvVersionsOverview = r.overview || wfvVersionsOverview;
        wfvRenderVersionsPage();
        notify({ tone: 'ok', title: `Restored ${label} into your draft` });
      },
      openCanvas: () => wfvShowPage('canvas'),
    }, { doc, error: id && !o && err ? err.error : null, loading: Boolean(id && !o && !err) });
  }
  /** A refused restore in plain words. A 422 carries the validator's issues under the bare message 'invalid graph':
   *  name the agents and scripts they cite (display names where Worca knows them), never the code words. */
  function wfvRestoreRefusal(r) {
    const errors = Array.isArray(r.errors) ? r.errors : [];
    if (!errors.length && r.error && r.error !== 'invalid graph') return r.error;
    const agents = (composer().getAgents && composer().getAgents()) || {};
    const scripts = (composer().getScripts && composer().getScripts()) || {};
    const names = [];
    for (const e of errors) {
      const m = /\b(?:agent|script) "([^"]+)"/.exec(String((e && e.message) || ''));
      if (!m) continue;
      const meta = agents[m[1]] || scripts[m[1]];
      const name = (meta && meta.displayName) || m[1];
      if (!names.includes(name)) names.push(name);
    }
    if (!names.length) return 'This saved state no longer fits the agents and steps it uses.';
    const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
    return `This saved state no longer fits the agents it uses: ${list}.`;
  }
  /** initWorkflows, once the shell and the composer exist: the page switch, Save version, and the version line. */
  function mount() {
    const e = wfvEls();
    e.pages?.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-page]'); if (b) wfvShowPage(b.dataset.page); });
    e.saveVersion?.addEventListener('click', () => void wfvSaveVersion());
    // Every new document on the canvas (a Library row's Open, an address, New canvas, a chat build) repaints the
    // version line, so it never shows the previous workflow's version.
    composer().hooks.onDocChange = () => { void wfvRefreshVersions(); };
  }
  /** The Library's row actions. `openSaved` is app.js's wfvOpenSaved. */
  function libraryActions(openSaved) {
    return {
      // A row that can have versions is the user's own, so it opens in place (Edit), then on its Versions page.
      openVersions: async (id) => {
        if (await openSaved(id)) wfvShowPage('versions');
      },
      // Plugin rows and the built-ins never have versions (D5); their ⋯ menu has no Versions….
      // A format-1 row is not a graph and cannot have versions either (isVersionableRow).
      versionsEnabled: (w) => flagOn('workflowTests') && workflowCanHaveVersions(w),
    };
  }
  // ⌘Z / ⇧⌘Z reach the canvas even from a fenced button (composer.mjs onKeyDown, before its data-canvas-keys fence).
  // While the Versions page covers the canvas, an undo there would edit a graph nobody sees: it does nothing. Capture
  // phase, so the composer's document listener sees defaultPrevented and returns. Fields keep their own undo.
  doc.addEventListener('keydown', (ev) => {
    if (!(ev.metaKey || ev.ctrlKey) || (ev.key !== 'z' && ev.key !== 'Z')) return;
    const page = ['wfv-versions', 'wfv-tests'].map((x) => doc.getElementById(x)).find((p) => p && !p.hidden && !p.closest('.view.hidden'));
    if (!page) return;                                                    // the Workflows view, its Versions or Tests page shown
    const t = ev.target;
    if (t && ((t.matches && t.matches('input, textarea, select')) || t.isContentEditable)) return;
    ev.preventDefault();
  }, true);
  // The flag flips live: off leaves the Versions page (its markup hides, the canvas tools come back); on paints the line.
  onFlagChange('workflowTests', (on) => { if (!on) wfvShowPage('canvas'); void wfvRefreshVersions(); });
  return { refresh: wfvRefreshVersions, showPage: wfvShowPage, mount, libraryActions };
}
