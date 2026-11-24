// ui/public/workflows/tests-app.mjs — the Tests page's controller (plans/workflow-tests-part2-plan.md): its state, the
// server calls, the actions of each view (list, example editor, progress, Compare, side by side), the address it keeps
// (F35) and the WS frame (D33). Task 10 is the list and first use; Task 11 adds the example editor, Task 12 Add from a
// past run, Task 13 Test a version and the progress page, Task 14 Compare and side by side. The views themselves are
// tests-view, example-editor, test-progress, test-compare and test-dialogs. app.js builds one controller per page load
// (createWorkflowTests) and calls it from its own functions.
import { notify } from '../feedback.mjs';
import { flagOn } from '../flags.mjs';
import { bytesToBase64 } from '../attach-files.mjs';
import { isGitRun, isNoProjectRun } from '../run-kind.mjs';
import { isReservedWorkflowId } from '../graph/composer.mjs';
import { toggleMenu } from './menu.mjs';
import { renderTestsPage, testsAddress, TESTS_ROUTE_RE } from './tests-view.mjs';
import { sentence as wftSentence, closeTestDialogs } from './test-ui.mjs';
import { renderExampleEditor, BLANK_EXAMPLE } from './example-editor.mjs';
import { openFromRunDialog, openPickRunDialog, canUseAsExample, openTestVersionDialog, defaultPicks } from './test-dialogs.mjs';
import { renderTestProgress } from './test-progress.mjs';
import { renderCompare, renderSideBySide, openWholeResult, askMoreTries } from './test-compare.mjs';
import { renderChecker, renderTrustReport } from './criteria-pages.mjs';
import { SAVE_FIRST_TEXT, CHANGES_NOT_READ_TITLE, NO_DIFF_TEXT, PATCH_CUT_TEXT } from '../../../src/shared/workflow-tests/project-text.mjs';
import { useLabel as wftUseLabel } from '../../../src/shared/workflow-tests/compare.mjs';
import { NO_SOURCE_TEXT, NO_PASSED_TRY_TEXT, TOO_LONG_TEXT } from '../../../src/shared/workflow-tests/criteria-text.mjs';
import { EXAMPLE_FILE_MAX_BYTES } from '../../../src/shared/workflow-tests/checks.mjs';

const WFT_EMPTY = Object.freeze({ view: 'list', workflowId: null, overview: null, error: null, example: null, runId: null,
  exampleId: null, tryIndex: 0, data: null, scripts: [], perTryUsd: null, editorToken: 0, roundId: null });
/** Task 22: what Check the checker keeps besides its round, reset whenever it opens. */
const WFT_CHECKER_FRESH = Object.freeze({ checkerEmpty: null, checkerCrit: null, checkerName: null, reworded: null, answering: null, rewording: null,
  checkerFrom: null });   // final review M12: the trust report or Compare that opened it ({ view, runId }), else null (the example)
const wftBase = (id) => `/api/workflows/${encodeURIComponent(id)}/tests`;
export const DELETED_MEANWHILE = 'This example was deleted, perhaps in another tab, so your changes were not saved. Copy what you need, then go back to Tests.';
const wftDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

/**
 * The Tests page controller. deps: { doc, win, fetch, safeJson, composer: () => gvComposer, api: gvApi,
 * versions: () => the versions-app.mjs controller, currentView, confirmModal, openNewPipeline, hdMarkdown,
 * mock: () => serverMock.on, runPageShows: (pipelineId) => whether that run's saved page is still open }.
 */
export function createWorkflowTests(deps) {
  const { doc, win, safeJson, api: gvApi, currentView, confirmModal, openNewPipeline, hdMarkdown } = deps;
  const composer = () => deps.composer();
  const wfvEls = () => ({ tests: doc.getElementById('wfv-tests') });   // the Tests page (workflows.html)
  const wfvShowPage = (page) => deps.versions().showPage(page);
  const mock = () => deps.mock();
  let wft = { ...WFT_EMPTY };
  /** {ok, data} | {ok:false, status, error} (the server's reason as a sentence); never throws. */
  async function wftCall(method, path, body) {
    try {
      const res = await deps.fetch(path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const d = await safeJson(res);
      return res.ok ? { ok: true, data: d } : { ok: false, status: res.status, error: wftSentence((d && d.error) || `That did not work (${res.status})`), body: d };
    } catch (e) { return { ok: false, status: 0, error: `Worca did not answer (${e.message}).` }; }
  }
  const wftWorkflowId = () => { const t = composer() && composer().template(); return t && t.id ? t.id : null; };
  const wftStorage = () => { try { return win.localStorage; } catch { return null; } };

  /** Read what the current view shows and paint it; never repaints over the editor. Never rejects. */
  async function wftRefresh() {
    const els = wfvEls();
    if (!els.tests || els.tests.hidden) return;
    const id = wftWorkflowId();
    if (!flagOn('workflowTests') || !id) {
      wft = { ...WFT_EMPTY };
      renderTestsPage(els.tests, null, wftListActions(), { doc, unsaved: true, error: 'Save the workflow first: tests belong to a saved workflow.' });   // C15, F31
      wftSyncHash();
      return;
    }
    if (wft.workflowId !== id) wft = { ...WFT_EMPTY, workflowId: id };
    wftSyncHash();
    if (wft.view === 'editor') return;
    const view = wft.view;
    const page = `${wft.runId}|${wft.exampleId}|${wft.roundId}`;     // which test, example and checker round the view shows
    if (view === 'list' && !wft.overview) renderTestsPage(els.tests, null, wftListActions(), { doc, loading: true });
    const r = view === 'list' ? await wftCall('GET', wftBase(id)) : await wftReadView(id);
    if (wftWorkflowId() !== id || wft.view !== view || `${wft.runId}|${wft.exampleId}|${wft.roundId}` !== page) return;   // another workflow, view or test meanwhile
    if (!r.ok && r.status === 404 && view !== 'list') { wftShow('list', { overview: null }); return; }   // F35: an address naming a test that is gone: the list
    if (view === 'list') wft.overview = r.ok ? r.data : null; else wft.data = r.ok ? r.data : null;
    wft.error = r.ok ? null : r.error;
    wftRender();
  }
  function wftReadView(id) {
    if (wft.view === 'checker') {   // Task 22: no round yet (P4-M3's no good result, the limit) reads nothing
      return wft.roundId ? wftCall('GET', `${wftBase(id)}/examples/${wft.exampleId}/checker/${wft.roundId}`) : Promise.resolve({ ok: true, data: null });
    }
    if (wft.view === 'trust') return wftCall('GET', `${wftBase(id)}/trust`);   // Task 23: board 13
    const base = `${wftBase(id)}/runs/${wft.runId}`;
    if (wft.view === 'progress') return wftCall('GET', base);
    if (wft.view === 'compare') return wftCompareRead(base);
    if (wft.view === 'detail') return wftCall('GET', `${base}/examples/${wft.exampleId}`);
    return Promise.resolve({ ok: false, error: 'This page does not exist.' });
  }
  /** Boards 5, 12 (Part 4): the compare read, with its criteria (counts, rows) beside it. A failed criteria read leaves Compare as it was. */
  async function wftCompareRead(base) {
    const [r, crit] = await Promise.all([wftCall('GET', `${base}/compare`), wftCall('GET', `${base}/criteria`)]);
    return r.ok && crit.ok ? { ...r, data: { ...r.data, criteria: crit.data } } : r;
  }
  function wftRenderView(root) {
    if (wft.view === 'checker' && (wft.data || wft.checkerEmpty)) {
      renderChecker(root, wft.data, wftCheckerActions(), { doc, exampleName: (wft.data && wft.data.exampleName) || wft.checkerName || '',
        criterion: wft.checkerCrit || null, empty: wft.checkerEmpty || null, reworded: wft.reworded || null, dateText: wftDate,
        // fix round 1: one answer, and one request for clearer words, at a time per round (`answering` / `rewording` = its round id)
        busy: wft.roundId != null && (wft.answering === wft.roundId || wft.rewording === wft.roundId), rewording: wft.roundId != null && wft.rewording === wft.roundId });
      wftPollChecker();
      return;
    }
    if (!wft.data) { renderTestsPage(root, null, wftListActions(), { doc, error: wft.error }); return; }
    if (wft.view === 'trust') { renderTrustReport(root, wft.data, wftTrustActions(), { doc, dateText: wftDate }); return; }
    if (wft.view === 'progress') { renderTestProgress(root, wft.data, wftProgressActions(), { doc, dateText: wftDate, mock: mock() }); return; }
    if (wft.view === 'compare') { renderCompare(root, wft.data, wftCompareActions(), { doc, mock: mock(), checkStopped: wft.checkStopped || null }); return; }
    if (wft.view === 'detail') {
      renderSideBySide(root, wft.data, wftDetailActions(), { doc, tryIndex: wft.tryIndex || 0, renderMarkdown: wftMarkdown,
        patches: wft.patches || (wft.patches = new Map()), picked: wft.picked || {}, dateText: wftDate, mock: mock() });
      return;
    }
    wft.view = 'list';
    void wftRefresh();
  }
  /** Board 5's actions. The workflow and the test are read when the page paints: an answer that lands after the page moved
   *  on (another workflow, another view or test) changes nothing. Each returns its promise, so its button stays busy. */
  function wftCompareActions() {
    const id = wftWorkflowId();
    const run = wft.data.run;
    const still = () => currentView() === 'workflows' && wftWorkflowId() === id && wft.view === 'compare' && wft.runId === run.id && !wfvEls().tests?.hidden;
    return {
      back: () => wftShow('list', { overview: null }),
      testAgain: () => wftTestVersion({ a: run.a, b: run.b, exampleIds: run.exampleIds }),
      open: (exampleId) => wftShow('detail', { runId: run.id, exampleId, tryIndex: 0, picked: {} }),
      editExample: (exampleId) => void wftOpenExample(exampleId),   // U8: "Look at the example or its checks."
      tryMore: async (exampleId) => {   // G15 + U-T6 (F12, D6): reusing the tries made and the connectors choice, after a confirm with the estimate
        const ask = await askMoreTries({ run, labels: wft.data.labels, exampleId, confirm: confirmModal,
          exampleName: (wft.data.model.examples.find((x) => x.id === exampleId) || {}).name || 'this example',
          loadPlan: async (q) => { const p = await wftCall('GET', `${wftBase(id)}/plan?${new URLSearchParams(q)}`); return p.ok ? p.data : null; } });
        if (!ask) return;
        const r = await wftCall('POST', `${wftBase(id)}/runs`, { a: run.a, b: run.b, exampleIds: [exampleId], tries: ask.tries,
          reuseA: true, reuseB: true, quickCheck: false, capUsd: ask.capUsd, connectors: run.connectors });
        if (!r.ok) { notify({ tone: 'err', title: 'More tries did not start', detail: r.error }); return; }
        if (still()) wftShow('progress', { runId: r.data.run.id });   // elsewhere by now: the results-ready toast opens it (C13)
      },
      checkCriteria: async () => {   // P4-Q15, P4-M5: "Check them on these tries"; the page shows the check at once, then polls
        const r = await wftCall('POST', `${wftBase(id)}/runs/${run.id}/criteria/check`, {});
        if (!r.ok) { notify({ tone: 'err', title: 'Worca did not start checking', detail: r.error }); return; }
        if (still()) { wft.checkStopped = null; await wftRefresh(); wftPollCriteria(id, run.id); }   // board 59 C: a new check ends the line
      },
      // Board 59 C: "Stop checking" (the stop route ends a check of these tries at once); the band then says how many tries it checked.
      stopCheck: async () => {
        const r = await wftCall('POST', `${wftBase(id)}/runs/${run.id}/stop`, { only: 'criteria' });   // review M5: never the test itself
        if (!r.ok) { notify({ tone: 'err', title: 'Not stopped', detail: r.error }); return; }
        const n = r.data && r.data.run ? r.data.run.checked : null;
        // Round 5 review M6: a stop with no count is kept too (no line), so the band that follows takes the Stop button's focus.
        if (still()) { wft.checkStopped = n ? { runId: run.id, done: n.done, of: n.of } : { runId: run.id }; await wftRefresh(); }
      },
      // Task 22 (board 12): By criterion's Confirm 4 results and Fix it
      confirmCriterion: (exampleId, c) => wftConfirmCriterion(exampleId, c, { exampleName: c.exampleName }),
      trust: () => wftShow('trust'),   // Task 23: By criterion's "How Worca tests its own checking"
    };
  }
  /** Board 13's "What to do" (Task 23): Fix the criterion and Confirm 4 results both start Check the checker of it (D97, Task 22). */
  function wftTrustActions() {
    const open = (exampleId, criterionId, c = {}) => wftConfirmCriterion(exampleId, { id: criterionId, text: c.text || '' }, { exampleName: c.exampleName || null });
    return { fix: open, confirm: open, back: () => wftShow('list', { overview: null }) };
  }
  /** P4-Q15: while Worca checks an older test's criteria, read again every 2 s; stops when the view moves on. The runner's
   *  workflow-tests-changed frame (wftChanged) also repaints Compare when the check ends. */
  function wftPollCriteria(id, runId) {
    const still = () => currentView() === 'workflows' && wftWorkflowId() === id && wft.view === 'compare' && wft.runId === runId;
    const tick = async () => {
      if (!still()) return;
      const r = await wftCall('GET', `${wftBase(id)}/runs/${runId}/criteria`);
      if (!still()) return;
      if (r.ok && r.data.checking) { win.setTimeout(tick, 2000); return; }
      void wftRefresh();
    };
    win.setTimeout(tick, 2000);
  }
  /** D97 (Task 22): Check the checker of one saved criterion. A 422 is P4-M3's no good result, the spending limit or a result too long to break (the page, no
   *  round); a 409 (a round of it runs), and every other refusal, a toast in the server's words. */
  async function wftConfirmCriterion(exampleId, criterion, { exampleName = null } = {}) {
    const id = wftWorkflowId();
    if (!id || exampleId == null || !criterion || !criterion.id) return;
    const r = await wftCall('POST', `${wftBase(id)}/examples/${exampleId}/checker`, { criterionId: criterion.id });
    if (wftWorkflowId() !== id) return;
    const from = wft.view === 'checker' ? wft.checkerFrom : ['trust', 'compare'].includes(wft.view) ? { view: wft.view, runId: wft.runId ?? null } : null;
    const keep = { ...WFT_CHECKER_FRESH, exampleId, checkerCrit: { id: criterion.id, text: criterion.text || '' }, checkerName: exampleName || null, checkerFrom: from };
    if (r.ok) { wftShow('checker', { ...keep, roundId: r.data.round.id }); return; }
    if (r.status === 422) {
      // Board 59 A: 'tried'; user decision 2026-11-22: 'long', a result too long to break on purpose.
      const kind = r.error === NO_SOURCE_TEXT ? 'none' : r.error === NO_PASSED_TRY_TEXT ? 'tried' : r.error === TOO_LONG_TEXT ? 'long' : 'limit';
      wftShow('checker', { ...keep, roundId: null, checkerEmpty: { kind, text: r.error } });
      return;
    }
    notify({ tone: r.status === 409 ? 'info' : 'err', title: 'Check the checker did not start', detail: r.error });
  }
  let wftCheckerTimer = null;
  /** D97: while Worca makes the round, read it again every 2 s; stops when the view, the workflow or the round changes. */
  function wftPollChecker() {
    if (wftCheckerTimer) { win.clearTimeout(wftCheckerTimer); wftCheckerTimer = null; }
    if (wft.view !== 'checker' || !wft.data || wft.data.round.status !== 'making') return;
    const key = `${wftWorkflowId()}|${wft.roundId}`;
    wftCheckerTimer = win.setTimeout(() => {
      wftCheckerTimer = null;
      if (currentView() === 'workflows' && wft.view === 'checker' && `${wftWorkflowId()}|${wft.roundId}` === key) void wftRefresh();
    }, 2000);
  }
  /** Board 11's and P4-M3's actions. An answer that lands after the page moved on (another round, view or workflow) changes nothing. */
  function wftCheckerActions() {
    const id = wftWorkflowId();
    const { exampleId, roundId } = wft;
    const v = wft.data;
    const base = `${wftBase(id)}/examples/${exampleId}/checker/${roundId}`;
    const still = () => wft.view === 'checker' && wft.roundId === roundId && wft.exampleId === exampleId && wftWorkflowId() === id;
    const crit = { id: v ? v.round.criterionId : wft.checkerCrit && wft.checkerCrit.id, text: v ? v.criterion : wft.checkerCrit && wft.checkerCrit.text };
    const name = (v && v.exampleName) || wft.checkerName || null;
    const toExample = () => { void wftOpenExample(exampleId); };
    const from = wft.checkerFrom;   // M12: Back and Use go where Check the checker was opened; the crumb names the example
    const back = from ? () => wftShow(from.view, from.view === 'compare' ? { runId: from.runId } : {}) : toExample;
    /** Task 15: Worca's clearer words are only offered (P4-M3); the reword route saves nothing. */
    const reword = async () => {
      if (wft.rewording === roundId) return;   // fix round 1: one paid request at a time; a second press is ignored
      wft.rewording = roundId;
      wft.reworded = null;
      wftRender();
      try {
        const r = await wftCall('POST', `${base}/reword`, {});
        if (!still()) return;
        wft.reworded = r.ok ? { text: String(r.data.text || '') } : { error: r.error, limit: r.status === 422 };
      } finally { if (wft.rewording === roundId) wft.rewording = null; }
      if (still()) wftRender();
    };
    return {
      answer: async (judgementId, right) => {
        if (wft.answering === roundId || wft.rewording === roundId) return;   // fix round 1: one answer at a time (the cards wait)
        wft.answering = roundId;
        if (still()) wftRender();
        let r;
        try { r = await wftCall('POST', `${base}/answers`, { judgementId, right }); } finally { if (wft.answering === roundId) wft.answering = null; }
        if (!r.ok) { notify({ tone: 'err', title: r.error }); if (still()) wftRender(); return; }
        if (!still()) return;
        // A reply that knows of fewer answers than the page already shows is older: it never repaints over a newer one.
        if (!(wft.data && Number.isInteger(wft.data.left) && r.data.left > wft.data.left)) wft.data = r.data;
        if (right === false) { await reword(); return; }   // board 11: "If you say "wrong", Worca suggests clearer words …"
        wftRender();
      },
      reword,
      keepWords: () => { if (still()) { wft.reworded = null; wftRender(); } },
      // "Use these words and check again": the criterion is saved through the example's save (its id kept), then a new round starts.
      useWords: async (text) => {
        const ex = await wftCall('GET', `${wftBase(id)}/examples/${exampleId}`);
        if (!ex.ok) { notify({ tone: 'err', title: ex.error }); return; }
        const criteria = (ex.data.example.criteria || []).map((c) => (c.id === crit.id ? { ...c, text } : c));
        const s = await wftCall('PUT', `${wftBase(id)}/examples/${exampleId}`, { criteria });
        if (!s.ok) { notify({ tone: 'err', title: s.error }); return; }
        if (still()) await wftConfirmCriterion(exampleId, { id: crit.id, text }, { exampleName: name });
      },
      retry: () => wftConfirmCriterion(exampleId, crit, { exampleName: name }),
      tryOnce: async () => {   // P4-M3's "Try your draft once now": a try of the example, then its progress (G2)
        const r = await wftCall('POST', `${wftBase(id)}/examples/${exampleId}/try-once`, {});
        if (!r.ok) { notify({ tone: 'err', title: 'The test did not start', detail: r.error }); return; }
        if (wft.view === 'checker' && wftWorkflowId() === id) wftShow('progress', { runId: r.data.run.id });
      },
      pickLiked: () => { void wftOpenExample(exampleId, { liked: true }); },   // board 59 A: the example's "A result you liked"
      back,
      use: back,
      example: toExample,
    };
  }
  /** Board 31's excerpt (M1): a try's result through hdMarkdown (marked + DOMPurify, ask-markdown.mjs); plain text until the
   *  renderer has loaded, then the open side by side repaints once. */
  function wftMarkdown(text, mount) {
    const out = hdMarkdown.render(text);
    if (out && out.kind === 'md') { mount.classList.add('ask-md'); mount.replaceChildren(out.frag); return; }
    mount.textContent = text;
    if (!hdMarkdown.isReady() && !hdMarkdown.isFailed()) void hdMarkdown.ensure().then((ok) => { if (ok && wft.view === 'detail' && wft.data) wftRender(); });
  }
  /** Board 6's actions (G2: a Try it once now goes back to the Tests list). */
  function wftDetailActions() {
    const id = wftWorkflowId();
    const s = wft.data;
    const still = () => currentView() === 'workflows' && wftWorkflowId() === id && wft.view === 'detail' && wft.runId === s.run.id
      && wft.exampleId === s.example.id && !wfvEls().tests?.hidden;
    return {
      back: () => (s.run.kind === 'once' ? wftShow('list', { overview: null }) : wftShow('compare', { runId: s.run.id })),
      pick: (k) => { if (!still()) return; wft.tryIndex = k; wftRender(); },
      readWhole: async (tryId, title) => {
        const shown = wft.tryIndex;                                     // the try on screen when Read was clicked
        const r = await wftCall('GET', `${wftBase(id)}/runs/${s.run.id}/tries/${tryId}/result`);
        if (!still() || wft.tryIndex !== shown) return;                 // another try shows by now: not its dialog
        if (!r.ok) { notify({ tone: 'err', title: 'Could not read the result', detail: r.error }); return; }
        openWholeResult({ doc, win, title, name: r.data.name, text: r.data.text, renderMarkdown: wftMarkdown });
      },
      // 3a (board 36): a project try's diff, read once per try (wft.patches: a string, '' when none was kept, null when it
      // could not be read); the page repaints when it lands.
      loadChanges: async (tryId) => {
        const cache = wft.patches || (wft.patches = new Map());
        if (cache.has(tryId) || wftPatchLoading.has(tryId)) return;
        wftPatchLoading.add(tryId);
        const r = await wftCall('GET', `${wftBase(id)}/runs/${s.run.id}/tries/${tryId}/changes`);
        wftPatchLoading.delete(tryId);
        if (wftWorkflowId() !== id) return;                            // another workflow: its wft has its own cache
        cache.set(tryId, r.ok ? String(r.data.patch || '') : null);
        if (r.ok && r.data.cut) wftPatchCut.add(tryId);
        if (still()) wftRender();
      },
      pickFile: (side, path) => { if (!still()) return; wft.picked = { ...(wft.picked || {}), [side]: path }; wftRender(); },
      readChanges: async (tryId, title) => {
        const cache = wft.patches || (wft.patches = new Map());
        let patch = cache.get(tryId);
        if (typeof patch !== 'string') {
          if (patch === null) cache.delete(tryId);                       // Fix 1: a failed read is tried again, here and in the card
          wftPatchLoading.add(tryId);                                    // a repaint meanwhile (empty cache) sends no second GET
          const r = await wftCall('GET', `${wftBase(id)}/runs/${s.run.id}/tries/${tryId}/changes`);   // never rejects
          wftPatchLoading.delete(tryId);
          if (!r.ok) {
            if (wftWorkflowId() === id && !cache.has(tryId)) cache.set(tryId, null);
            notify({ tone: 'err', title: CHANGES_NOT_READ_TITLE, detail: r.error });
            return;
          }
          patch = String(r.data.patch || '');
          if (r.data.cut) wftPatchCut.add(tryId);
          if (wftWorkflowId() === id) cache.set(tryId, patch);
          if (still()) wftRender();                                       // the card shows the diff it could not read before
        }
        if (!still()) return;
        // Text, never markup: the diff is the project's data (openWholeResult shows it in a <pre> without a renderer).
        openWholeResult({ doc, win, title, name: wftPatchCut.has(tryId) ? PATCH_CUT_TEXT : null, text: patch || NO_DIFF_TEXT });
      },
      commandOutput: (title, output) => openWholeResult({ doc, win, title, text: output || '' }),
      // Part 4 (D96, boards 6, 36): Agree / Disagree on one verdict (null takes it back); resolves { answer, trust }, or undefined.
      answer: async (judgementId, agree) => {
        const r = await wftCall('POST', `${wftBase(id)}/judgements/${judgementId}/answer`, { agree });
        if (!r.ok) { notify({ tone: 'err', title: r.error }); return undefined; }
        if (still()) void wftRefresh();
        return r.data;
      },
    };
  }
  /** Board 20's actions. The workflow and the test are read when the page paints: an answer that lands after the page
   *  moved on (another workflow, another view) repaints nothing. */
  function wftProgressActions() {
    const id = wftWorkflowId();
    const runId = wft.runId;
    const run = wft.data && wft.data.run;
    const still = () => wftWorkflowId() === id && wft.view === 'progress' && wft.runId === runId;
    return {
      back: () => wftShow('list', { overview: null }),
      stop: async () => {
        const r = await wftCall('POST', `${wftBase(id)}/runs/${runId}/stop`, {});
        if (!r.ok) notify({ tone: 'err', title: 'Not stopped', detail: r.error });
        if (still()) await wftRefresh();   // U-T8: the stopped page first, then the button is given back
      },
      continue: async (capUsd) => {
        if (Number.isNaN(capUsd)) { notify({ tone: 'err', title: 'The rest did not start', detail: 'Give the cost limit in dollars, such as $15.' }); return; }
        const r = await wftCall('POST', `${wftBase(id)}/runs/${runId}/continue`, capUsd != null ? { capUsd } : {});
        if (!r.ok) { notify({ tone: 'err', title: 'The rest did not start', detail: r.error }); return; }   // boards 27, 29 (C18)
        if (still()) void wftRefresh();
      },
      open: () => {
        if (run && run.kind === 'once') wftShow('detail', { runId, exampleId: run.exampleIds[0], tryIndex: 0 });   // G2
        else wftShow('compare', { runId });
      },
      // P36: the same versions, examples and tries. P38: a Try it once run has no version a: it reopens Try it once on the
      // same example (the draft), never a two-version compare at twice the cost.
      startNew: async () => {
        if (!(run && run.kind === 'once')) { wftTestVersion({ a: run.a, b: run.b, exampleIds: run.exampleIds, tries: run.tries }); return; }
        const r = await wftCall('POST', `${wftBase(id)}/examples/${run.exampleIds[0]}/try-once`, {});
        if (!r.ok) { notify({ tone: 'err', title: 'The test did not start', detail: r.error }); return; }
        if (still()) wftShow('progress', { runId: r.data.run.id });
      },
      editExample: (exampleId) => void wftOpenExample(exampleId),   // board 35: a setup that failed is fixed in the example
    };
  }
  /** D33: a test changed (a try ended, the test finished): the toast for a finished test (C13), and the open page. */
  function wftChanged(msg) {
    if (msg.finished && msg.title) {
      notify({ tone: msg.status === 'done' ? 'ok' : 'info', title: msg.status === 'done' ? 'Test results are ready' : 'Test stopped', detail: msg.title,
        key: `wft-${msg.testRunId}`, action: { label: 'Open', run: () => wftOpenTest(msg.workflowId, msg.testRunId) } });
    }
    // Only the Tests page on screen repaints; leaving it hidden behind another view, it repaints on re-entry (enterWorkflowsView).
    if (currentView() !== 'workflows') return;
    const els = wfvEls();
    if (!els.tests || els.tests.hidden || wftWorkflowId() !== msg.workflowId) return;
    // The list, the trust report (Task 23: a check or a try changes its counts), or the open page of the test that changed.
    if (wft.view === 'list' || wft.view === 'trust' || (['progress', 'compare', 'detail'].includes(wft.view) && wft.runId === msg.testRunId)) void wftRefresh();
  }
  /** The toast's Open: the test's page. Its workflow already open on the canvas: only the Tests page changes (no reload,
   *  no discard question); anywhere else the address opens it (routeWorkflows). */
  function wftOpenTest(workflowId, testRunId) {
    if (currentView() === 'workflows' && wftWorkflowId() === workflowId) {
      if (wfvEls().tests?.hidden) wfvShowPage('tests');
      wftShow('progress', { runId: testRunId });
      return;
    }
    win.location.hash = `workflows/${workflowId}/tests/run/${testRunId}`;
  }
  function wftRender() {
    const els = wfvEls();
    if (!els.tests) return;
    if (wft.view === 'editor') { wftRenderEditor(els.tests); return; }
    if (wft.view !== 'list') { wftRenderView(els.tests); return; }
    renderTestsPage(els.tests, wft.overview, wftListActions(), { doc, storage: wftStorage(), error: wft.error, dateText: wftDate, mock: mock() });
  }
  // Final review M6: the opened diffs (up to 5 MB each) are let go on every move; the side by side reads them again.
  // Board 59 C: any page change (leaving Compare, a test starting) ends the line after a stopped check (checkStopped).
  // Pre-merge QA: a page change also ends an example that is still opening (wftOpenSeq), so it never takes the page over later.
  function wftShow(view, extra = {}) { closeTestDialogs(); wftPatchCut.clear(); wftOpenSeq += 1; wft = { ...wft, view, data: null, patches: null, checkStopped: null, openingExample: null, ...extra }; wftSyncHash(); void wftRefresh(); }
  /** F35: the address names the Tests page that shows, so a reload comes back to it. replaceState: no history entry, Back and Forward keep their meaning.
   *  Shown only while the Workflows view is (els.tests stays unhidden when it is left): a late load never rewrites another view's address. */
  function wftSyncHash() {
    const els = wfvEls();
    const shown = currentView() === 'workflows' && !!(els.tests && !els.tests.hidden) && flagOn('workflowTests');
    const opening = wft.view === 'list' && wft.openingExample != null ? wft.openingExample : null;   // B1: the example that opens
    const h = testsAddress({ workflowId: wftWorkflowId(), shown, view: opening != null ? 'editor' : wft.view, runId: wft.runId,
      exampleId: opening != null ? opening : wft.view === 'checker' ? wft.exampleId : wft.example ? wft.example.id : null, roundId: wft.roundId });
    if (win.location.hash === h || (!shown && !/^#workflows\/[A-Za-z0-9_-]+\/tests(\/|$)/.test(win.location.hash))) return;
    try { win.history.replaceState(null, '', h); } catch { /* sandboxed */ }
  }

  function wftListActions() {
    return {
      newExample: () => void wftOpenExample(null),
      saveWorkflow: () => composer().openSaveDialog(),   // F31
      addFromRun: () => wftPickRun(),
      runOnce: () => wftRunOnce(),   // U-T4 (F4, D4): New run opens with this workflow chosen, also in Simple mode
      testVersion: () => void wftTestVersion(),
      openExample: (exampleId) => void wftOpenExample(exampleId),
      exampleMenu: (anchor, e) => toggleMenu({ doc, anchor, align: 'end', label: `More for ${e.name}`, items: [   // G18
        { label: 'Edit', onSelect: () => void wftOpenExample(e.id) },
        { label: 'Delete', danger: true, onSelect: () => void wftDeleteExample(e) },
      ] }),
      openRun: (runId) => wftShow('progress', { runId }),
      openLatest: (runId) => wftShow('compare', { runId }),
      openTrust: () => wftShow('trust'),   // Task 23: board 1's card
      // → {ok}: the view's Add button stays busy until the post answers (one post per click, withButton).
      addPastRuns: async (pipelineIds) => {
        const id = wftWorkflowId();                                  // the workflow the picks belong to, before any await
        if (!id) return { ok: false };
        const r = await wftCall('POST', `${wftBase(id)}/examples/from-runs`, { pipelineIds });
        if (!r.ok) { notify({ tone: 'err', title: 'Examples not added', detail: r.error }); return { ok: false }; }
        const n = r.data.examples.length;
        notify({ tone: 'ok', title: n === 1 ? 'Added 1 example' : `Added ${n} examples`, detail: 'Open each to say what a good result needs.' });   // G4
        if (r.data.skipped.length) notify({ tone: 'info', title: 'Some files were left out', detail: `${r.data.skipped.join(', ')}: larger than 5 MB, or more than 8 files.` });
        if (wftWorkflowId() === id) wftShow('list', { overview: null });   // another workflow opened meanwhile: its page stays
        return { ok: true };
      },
    };
  }
  const wftRunOnce = () => { const id = wftWorkflowId(); if (id) openNewPipeline({ workflowId: id, pinWorkflow: true }); };
  /** G7: which past run (the overview's pastRuns), then board 3 while the same workflow's list still shows. */
  function wftPickRun() {
    const o = wft.overview;
    const id = wftWorkflowId();
    if (!o || !id) return;
    const live = () => currentView() === 'workflows' && wftWorkflowId() === id && wft.view === 'list' && !wfvEls().tests?.hidden;
    openPickRunDialog({ doc, win, workflowName: o.name, runs: o.pastRuns || [], dateText: wftDate, needsProject: !!o.needsProject,
      onPick: (pid) => void wftAddFromRun(pid, { live }), onRunOnce: wftRunOnce, onWrite: () => void wftOpenExample(null) });
  }
  /** Board 3 from a run page or the picker: read what the run keeps, ask, create, then open the example in the editor.
   *  `live()`: the opener still shows once the run is read (else no dialog over another page). */
  async function wftAddFromRun(pipelineId, { live = () => true } = {}) {
    const r = await wftCall('GET', `/api/workflow-tests/past-run/${encodeURIComponent(pipelineId)}`);
    if (!live()) return;
    if (!r.ok) { notify({ tone: 'err', title: 'Could not read the run', detail: r.error }); return; }
    const past = r.data;
    if (!past.testable) { notify({ tone: 'err', title: 'This run cannot become a test example', detail: past.reasonText || '' }); return; }
    // Task 24 (P4-M7, D102): the criteria Worca reads in the note, a paid call the dialog sends one at a time; only offered.
    const onSuggest = async (note) => {
      const s = await wftCall('POST', '/api/workflow-tests/suggest-criteria', { workflowId: past.workflowId, pipelineId: past.pipelineId, note });
      return s.ok ? { suggestions: Array.isArray(s.data.suggestions) ? s.data.suggestions : [] } : { error: s.error };
    };
    openFromRunDialog({ doc, win, past, dateText: wftDate, onSuggest, onSubmit: async (body) => {
      const s = await wftCall('POST', `${wftBase(past.workflowId)}/examples/from-run`, { pipelineId: past.pipelineId, ...body });
      if (!s.ok) return s;
      if (s.data.skipped.length) notify({ tone: 'info', title: 'Some files were left out', detail: `${s.data.skipped.join(', ')}: larger than 5 MB, or more than 8 files.` });
      if (currentView() === 'workflows' && wftWorkflowId() === past.workflowId) {
        if (wfvEls().tests?.hidden) wfvShowPage('tests');
        void wftOpenExample(s.data.example.id);
      } else win.location.hash = `workflows/${past.workflowId}/tests/${s.data.example.id}`;   // routeWorkflows opens the editor
      return { ok: true };
    } });
  }
  /** G6: the saved run page's ⋯ item. `data.state.stepper` is the run's manifest (artifacts.mjs rowToState). 3a (D65): a
   *  single-project git run too; never a Folder or workspace run (the server would only refuse it). */
  function wftRunMenuItems(record, data) {
    const st = data && data.state;
    const tpl = st && st.stepper && st.stepper.template;
    const noProject = !!st && !!record && isNoProjectRun({ ...record, state: st });
    const projectRun = !!st && !!record && !noProject && record.target !== 'workspace' && st.target !== 'workspace' && isGitRun({ ...record, state: st });
    const ok = !!record && canUseAsExample({ flag: flagOn('workflowTests'), noProject, projectRun,
      status: st && st.status, templateId: tpl && tpl.id, reserved: !!(tpl && tpl.id && isReservedWorkflowId(tpl.id)) });
    if (!ok) return [];
    const pid = record.id;
    return [{ label: 'Use as test example', onSelect: () => void wftAddFromRun(pid, { live: () => deps.runPageShows(pid) }) }];
  }
  /** Board 4. `a`/`b`/`exampleIds` prefill it (Compare's Test again). The workflow is read before any await: the dialog
   *  opens, and Start shows the progress page, only while that workflow's Tests page still shows. */
  async function wftTestVersion({ a, b, exampleIds = null, tries = null } = {}) {
    const id = wftWorkflowId();
    if (!id) return;
    const live = () => currentView() === 'workflows' && wftWorkflowId() === id && !wfvEls().tests?.hidden;
    const fresh = await wftCall('GET', wftBase(id));                 // fresh examples (another tab may have added one)
    const o = fresh.ok ? fresh.data : (wft.workflowId === id ? wft.overview : null);
    const vr = o ? await gvApi.versionsRead(id) : null;              // {ok, overview} | {ok: false, error}
    const versions = vr && vr.ok ? vr.overview : null;
    if (!live()) return;
    if (!o) { notify({ tone: 'err', title: 'Could not open Test a version', detail: fresh.error }); return; }
    // A failed versions read is not "No saved version yet" (C16): say why instead.
    if (!versions) { notify({ tone: 'err', title: 'Could not open Test a version', detail: wftSentence(vr && vr.error) }); return; }
    const nos = versions.versions.map((v) => v.versionNo).sort((x, y) => x - y);
    const options = [...nos.map((no) => ({ use: no, label: wftUseLabel(no, o.ctx, 'select') })), { use: 'draft', label: wftUseLabel('draft', o.ctx, 'select'), sameAs: o.draftSameAs ?? null }];
    const picks = defaultPicks({ nos, liveNo: o.ctx.liveVersionNo, sameAs: o.draftSameAs ?? null }); openTestVersionDialog({ doc, win, options, a: a !== undefined ? a : picks.a, b: b !== undefined ? b : picks.b,   // U-T7 (D7): an identical draft is never a default side
      examples: o.examples.map((e) => ({ id: e.id, name: e.name, tries: e.tries, ready: e.ready !== false, reason: e.reason || null, projectName: e.project ? e.project.name : null })),
      exampleIds, tries, dateText: wftDate,
      loadPlan: async (q) => { const r = await wftCall('GET', `${wftBase(id)}/plan?${new URLSearchParams(q).toString()}`); return r.ok ? r.data : null; },
      onStart: async (body) => {
        const r = await wftCall('POST', `${wftBase(id)}/runs`, body);
        if (!r.ok) return r;                                         // the dialog stays open and says why
        if (live()) wftShow('progress', { runId: r.data.run.id });   // elsewhere by now: the results-ready toast opens it (C13)
        return { ok: true };
      } });
  }

  // The example editor (Task 11). Each painted editor is a session {workflowId, exampleId, token}: its actions save to
  // session.exampleId (set by the G17 auto-save), and write wft / change the view only while that editor still shows. A
  // slow upload that lands after Cancel and another Open never retargets the next editor.
  let wftEditorSeq = 0;
  /** Board 36: the tries whose diff is being read (one read each), and those whose diff is longer than the server reads. */
  const wftPatchLoading = new Set();
  const wftPatchCut = new Set();
  let wftOpenSeq = 0;
  const wftEditorLive = (s) => wft.view === 'editor' && wft.editorToken === s.token && wftWorkflowId() === s.workflowId;
  let wftEditorHandle = null;   // the shown editor's { value, changed } (renderExampleEditor)
  const wftEditorChanged = () => wft.view === 'editor' && !!wftEditorHandle && !wfvEls().tests?.hidden && wftEditorHandle.changed();
  /** Pre-merge QA (B5): leaving an example with changes not saved asks first, as the canvas does. → true: go ahead. */
  async function wftLeaveEditor() {
    if (!wftEditorChanged()) return true;
    return !!(await confirmModal({ title: 'Discard your changes to this example?', confirmLabel: 'Discard', danger: true,
      message: 'You changed this example and did not save it. Leaving now drops those changes.' }));
  }
  // Closing or reloading the tab with such changes: the browser's own "Leave site?" question.
  win.addEventListener?.('beforeunload', (e) => { if (wftEditorChanged()) { e.preventDefault(); e.returnValue = ''; } });
  // B3: the Tests page writes its own address with replaceState (no event), so a hashchange is the person going
  // elsewhere (Back, Forward, a typed address): no Tests dialog stays open over the page that comes.
  // B2: Back (or a typed address) to the bare workflow, #workflows or #workflows/<this id>, while the Tests page shows:
  // the page follows the address to the canvas, after the editor's question; kept editing, the address names the page again.
  win.addEventListener?.('hashchange', () => {
    closeTestDialogs();
    const id = wftWorkflowId();
    if (!id || currentView() !== 'workflows' || wfvEls().tests?.hidden !== false) return;
    if (!new RegExp(`^#workflows(/${id})?/?$`).test(win.location.hash)) return;   // a Tests address, or elsewhere: routed there
    void wftLeaveEditor().then((go) => { if (go) wfvShowPage('canvas'); else wftSyncHash(); });
  });
  function wftRenderEditor(root) {
    const session = { workflowId: wftWorkflowId(), exampleId: wft.example && wft.example.id ? wft.example.id : null, token: ++wftEditorSeq };
    wft.editorToken = session.token;
    const o = wft.overview;
    const row = o && wft.example && wft.example.id ? o.examples.find((e) => e.id === wft.example.id) : null;
    const openLiked = !!wft.openLiked;   // board 59 A: once, on the first paint of the editor
    wft.openLiked = false;
    wftEditorHandle = renderExampleEditor(root, wft.example, wftEditorActions(session), { doc, win, scripts: wft.scripts, perTryUsd: wft.perTryUsd, openLiked,
      draftLabel: o ? wftUseLabel('draft', o.ctx) : 'your draft', testRunning: !!(o && o.running), runningExampleIds: o && o.running ? o.running.exampleIds || [] : [], confirm: confirmModal,   // G19; F17
      // 3a (boards 32, 39): the projects to pick, whether the workflow needs one, and the overview's drift of this example's pin
      projects: wft.projects || null, needsProject: !!(o && o.needsProject), workflowName: o ? o.name : '',
      projectView: row ? row.project : null, dateText: wftDate,
      judgeModels: wft.judgeModels, criteriaTrust: wft.criteriaTrust || {},
      // Task 22: Confirm 4 results and Fix it open Check the checker. The editor offers them only on a saved example's saved criteria
      // (a trust line needs the example's id and the criterion's), and saves its changes first (saveQuiet), so the round runs on
      // the words shown.
      onConfirmCriterion: (c) => wftConfirmCriterion(session.exampleId, c, { exampleName: wft.example && wft.example.name }),
      // Task 24 (P4-M2): the overview's latest finished tries of this example, as "v4 · try 2 · 14 Oct · passed"
      likedTries: (row && row.likedTries ? row.likedTries : []).map((t) => ({ id: t.id, label: [t.use, `try ${t.tryNo}`, t.at ? wftDate(t.at) : null, t.status].filter(Boolean).join(' · ') })) });
  }
  /** `liked`: board 59 A, the editor opens with the example's "A result you liked" dialog. */
  async function wftOpenExample(exampleId, { liked = false } = {}) {
    const id = wftWorkflowId();
    if (!id) return;
    const seq = ++wftOpenSeq;                                         // a later Open wins over this one
    const stale = () => seq !== wftOpenSeq || wftWorkflowId() !== id;
    // Pre-merge QA (B1): while it opens, the address already names the example, so a reload then comes back to it.
    if (exampleId != null) {
      wft = { ...wft, openingExample: exampleId };
      wftSyncHash();
      const els = wfvEls();   // the page's own loading state meanwhile, so a click visibly did something
      if (els.tests && wft.view === 'list') renderTestsPage(els.tests, null, wftListActions(), { doc, loading: true });
    }
    const opened = () => { if (seq === wftOpenSeq && wft.openingExample != null) wft = { ...wft, openingExample: null }; };
    // Pre-merge QA: the reads are independent. One after another they took about 5 s where git is slow (the projects read
    // asks git about each project), and a click or a reload looked lost. They are read together.
    const [r, scripts, pj, plan, o, jm, ct] = await Promise.all([
      exampleId != null ? wftCall('GET', `${wftBase(id)}/examples/${exampleId}`) : null,
      // null: the Library did not load (no "left the Library" claims)
      Promise.resolve().then(() => gvApi.scripts()).then((list) => list.filter((s) => s && s.placeable !== false)).catch(() => null),
      wftCall('GET', '/api/workflow-tests/projects'),                 // 3a: the Project select (board 32); null when not read
      wftCall('GET', `${wftBase(id)}/plan?b=draft&tries=1`),
      wftCall('GET', wftBase(id)),                                    // fresh: G19 reads whether a test runs
      // Part 4 (Task 18): the "Checked with" list, and how far Worca's checking of a saved example's criteria is trusted.
      wftCall('GET', `${wftBase(id)}/judge-models`),
      exampleId != null ? wftCall('GET', `${wftBase(id)}/examples/${exampleId}/criteria`) : null,
    ]);
    opened();
    if (stale()) return;
    let example = { ...BLANK_EXAMPLE, basics: { ...BLANK_EXAMPLE.basics } };
    if (exampleId != null) {
      if (!r.ok) { wftSyncHash(); wftRender(); notify({ tone: 'err', title: 'Could not open the example', detail: r.error }); return; }
      example = r.data.example;
    }
    wft = { ...wft, workflowId: id, view: 'editor', example, scripts, ...(o.ok ? { overview: o.data } : {}),
      judgeModels: jm.ok ? jm.data : { models: [], suggested: null }, criteriaTrust: ct && ct.ok ? ct.data.trust : {},
      perTryUsd: plan.ok && plan.data.b ? plan.data.b.perTryUsd : null, projects: pj.ok ? pj.data.projects : null, openLiked: liked };
    wftSyncHash();
    wftRender();
  }
  /** Save the session's example: PUT when it has an id, else POST (and remember the new id). */
  async function wftSaveExample(session, value) {
    const base = wftBase(session.workflowId);
    const r = session.exampleId ? await wftCall('PUT', `${base}/examples/${session.exampleId}`, value) : await wftCall('POST', `${base}/examples`, value);
    // Pre-merge QA (B7): an example deleted meanwhile (in another tab) said only "No example 1.".
    if (!r.ok && r.status === 404 && session.exampleId) return { ...r, error: DELETED_MEANWHILE };
    if (!r.ok) return r;
    session.exampleId = r.data.example.id;
    if (wftEditorLive(session)) wft.example = r.data.example;
    return { ok: true, example: r.data.example };
  }
  function wftEditorActions(session) {
    const base = wftBase(session.workflowId);
    const keep = (example) => { if (wftEditorLive(session)) wft.example = example; };
    return {
      back: async () => { if (wftEditorLive(session) && await wftLeaveEditor() && wftEditorLive(session)) wftShow('list', { overview: null }); },
      // 3a: the start point dialog's branches (P2) and "Start from the latest" (D63, board 32)
      branches: (key) => wftCall('GET', `/api/workflow-tests/projects/${encodeURIComponent(key)}/branches`),
      startLatest: async () => {
        if (!session.exampleId) return { ok: false, error: SAVE_FIRST_TEXT };
        const r = await wftCall('POST', `${base}/examples/${session.exampleId}/project/latest`, {});
        if (!r.ok) return r;
        keep(r.data.example);
        return { ok: true, example: r.data.example };
      },
      saveQuiet: (value) => wftSaveExample(session, value),   // Task 22: Confirm's save first, staying in the editor
      save: async (value) => {
        const r = await wftSaveExample(session, value);
        if (r.ok) { notify({ tone: 'ok', title: 'Example saved' }); if (wftEditorLive(session)) wftShow('list', { overview: null }); }
        return r;
      },
      tryOnce: async (value) => {
        const s = await wftSaveExample(session, value);
        if (!s.ok) return s;
        const r = await wftCall('POST', `${base}/examples/${session.exampleId}/try-once`, {});
        if (!r.ok) return r;
        if (wftEditorLive(session)) wftShow('progress', { runId: r.data.run.id });   // G2
        return { ok: true };
      },
      // → the example as the store has it after the last file that went up, also with the error of the one that did not.
      addFiles: async (files, value) => {
        // Pre-merge QA (B6): a file over the store's 5 MB never reached its rule (the request body limit answered first,
        // "Request body too large."). It is said here, in the store's words, before anything is saved or sent.
        const big = files.find((f) => Number(f.size) > EXAMPLE_FILE_MAX_BYTES);
        if (big) return { ok: false, error: `The file ${big.name} is larger than 5 MB.` };   // "The file": a sentence starts with a capital, a file name keeps its own
        let example = null;
        if (!session.exampleId) {                                     // G17: an example never saved is saved first
          const s = await wftSaveExample(session, value);
          if (!s.ok) return s;
          example = s.example;
        }
        for (const f of files) {
          const dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
          const r = await wftCall('POST', `${base}/examples/${session.exampleId}/files`, { name: f.name, dataBase64 });
          if (!r.ok) return { ...r, ...(example ? { example } : {}) };
          example = r.data.example;
          keep(example);
        }
        return { ok: true, example };
      },
      stopTest: () => { const t = wft.overview && wft.overview.running; return t ? wftCall('POST', `${base}/runs/${t.runId}/stop`, {}) : Promise.resolve({ ok: true }); },   // F17: as the progress page
      removeFile: async (name) => {
        const r = await wftCall('DELETE', `${base}/examples/${session.exampleId}/files/${encodeURIComponent(name)}`);
        if (!r.ok) return r;
        keep(r.data.example);
        return { ok: true, example: r.data.example };
      },
      // Task 24 (P4-M2, Task 12's route): a result you liked, kept at once ({ file } uploaded, or { tryId }); the server's words on a refusal.
      putLiked: async ({ file = null, tryId = null } = {}) => {
        if (!session.exampleId) return { ok: false, error: SAVE_FIRST_TEXT };
        const body = file ? { name: file.name, dataBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) } : { tryId };
        const r = await wftCall('PUT', `${base}/examples/${session.exampleId}/liked`, body);
        if (!r.ok) return r;
        keep(r.data.example);
        return { ok: true, example: r.data.example };
      },
      removeLiked: async () => {
        const r = await wftCall('DELETE', `${base}/examples/${session.exampleId}/liked`);
        if (!r.ok) { notify({ tone: 'err', title: 'Not removed', detail: r.error }); return r; }
        keep(r.data.example);
        return { ok: true, example: r.data.example };
      },
    };
  }

  async function wftDeleteExample(e) {
    const id = wftWorkflowId();                                      // the example's workflow, before any await
    if (!id) return;
    const ok = await confirmModal({ title: `Delete "${e.name}"?`, confirmLabel: 'Delete', danger: true,
      message: 'Its request, files, answers and checks are removed. The tries already made stay in the tests they belong to.' });
    if (!ok) return;
    const r = await wftCall('DELETE', `${wftBase(id)}/examples/${e.id}`);
    if (!r.ok) { notify({ tone: 'err', title: 'Not deleted', detail: r.error }); return; }
    if (wftWorkflowId() === id) wftShow('list', { overview: null });
  }

  /** The page switch shows the Tests page: its list, its address, then the read. */
  function enterList() {
    closeTestDialogs();                                                // B3: no dialog outlives its page
    wftOpenSeq += 1;                                                   // pre-merge QA: ends an example still opening (wftShow)
    wft = { ...wft, view: 'list', openingExample: null };
    wftSyncHash();
    void wftRefresh();
  }
  /** routeWorkflows, after it opened `head`: #workflows/<id>/tests[/<example>|/run/<test>|/<example>/checker/<round>|/trust] (Use as test example, the
   *  results-ready toast). Only when the canvas holds that row itself: a built-in or plugin row opens as an unsaved copy
   *  (#1127), which has no tests. */
  function route(head, sub, opened) {
    const m = TESTS_ROUTE_RE.exec(sub);
    if (opened && m && flagOn('workflowTests') && composer().template().id === head) {
      wfvShowPage('tests');
      if (m[1]) void wftOpenExample(Number(m[1]));
      else if (m[2]) wftShow('progress', { runId: Number(m[2]) });
      else if (m[3]) wftShow('checker', { exampleId: Number(m[3]), roundId: Number(m[4]), ...WFT_CHECKER_FRESH });
      else if (m[5]) wftShow('trust');
    }
  }
  return { refresh: wftRefresh, syncHash: wftSyncHash, enterList, changed: wftChanged, runMenuItems: wftRunMenuItems, route, guardLeave: wftLeaveEditor, editorChanged: wftEditorChanged };
}
