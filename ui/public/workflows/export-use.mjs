// ui/public/workflows/export-use.mjs — the Export dialog's Version field (plans/workflow-tests-plan.md D17; canvas
// board 21): which saved version, or the draft, an export exports. Read from the Versions page's overview
// (GET /api/workflows/:id/versions). The helpers are pure; createExportUse is the field's controller, which app.js's
// Export dialog (openExportModal, bindExportModal) calls.
import { flagOn } from '../flags.mjs';

/**
 * The options, newest version first and Your draft last, and the default (the version new runs use; without one,
 * the draft). null when there is no version: the field stays hidden and the export sends no `use`.
 * @param {{liveVersionNo?: number|null, draft?: {changed?: boolean}|null, versions?: Array<{versionNo: number, note?: string|null}>}|null} overview
 * @returns {{options: Array<{value: string, label: string}>, selected: string, liveVersionNo: number|null, draftDiffers: boolean}|null}
 */
export function exportUseChoices(overview) {
  const versions = overview && Array.isArray(overview.versions)
    ? overview.versions.filter((v) => v && Number.isInteger(v.versionNo) && v.versionNo > 0) : [];
  if (!versions.length) return null;
  const liveVersionNo = Number.isInteger(overview.liveVersionNo) ? overview.liveVersionNo : null;
  const draftDiffers = liveVersionNo !== null && !!(overview.draft && overview.draft.changed);
  const options = [...versions].sort((a, b) => b.versionNo - a.versionNo).map((v) => {
    const note = typeof v.note === 'string' ? v.note.trim() : '';
    const parts = [`v${v.versionNo}`, ...(note ? [note] : []), ...(v.versionNo === liveVersionNo ? ['new runs use this'] : [])];
    return { value: String(v.versionNo), label: parts.join(' · ') };
  });
  options.push({ value: 'draft', label: draftDiffers ? 'Your draft (not saved as a version)' : 'Your draft' });
  const selected = liveVersionNo !== null && options.some((o) => o.value === String(liveVersionNo)) ? String(liveVersionNo) : 'draft';
  return { options, selected, liveVersionNo, draftDiffers };
}

/** The line under the select: only when Your draft is picked and it differs from the version in use. */
export function exportUseHint(choices, value) {
  if (!choices || value !== 'draft' || !choices.draftDiffers) return '';
  return `Your draft differs from v${choices.liveVersionNo}, which new runs use.`;
}

/** The select's value as the request's `use`: a version number, 'draft', or undefined (no field: send nothing). */
export function exportUseValue(value) {
  if (value === 'draft') return 'draft';
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
}

/**
 * Paint the field from `choices` (null hides it and empties the select). `keep`: a repaint keeps the user's pick
 * when it is still an option; otherwise the default is selected.
 * @param {{field: HTMLElement, select: HTMLSelectElement, hint: HTMLElement}} els
 */
export function paintExportUse({ field, select, hint }, choices, { doc = globalThis.document, keep = false } = {}) {
  const prev = select.value;
  select.replaceChildren();
  for (const o of (choices && choices.options) || []) {
    const opt = doc.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  }
  if (choices) select.value = keep && choices.options.some((o) => o.value === prev) ? prev : choices.selected;
  field.classList.toggle('hidden', !choices);
  const text = exportUseHint(choices, choices ? select.value : '');
  hint.textContent = text;
  hint.classList.toggle('hidden', !text);
}

/**
 * The Version field's controller. deps: { doc, readVersions: gvApi.versionsRead, modalHidden: exportModalHidden,
 * guard: () => exportGuard, syncButtons: () => exportSyncMarketplaceButtons() }.
 * `choices`: the field's choices, null while it is hidden (flag off, no version, the versions not read yet) — then no
 * `use` is sent and the export is of the draft, as before. `seq`: bumped by every open and close only (not by a plan
 * invalidation): a versions read that lands after a bump is for another open. `loading`: that read is out; Download,
 * Preview and Export wait for it (hold), so nothing is exported as the draft while the default (the version new runs
 * use) is still unknown.
 */
export function createExportUse({ doc, readVersions, modalHidden, guard, syncButtons }) {
  const st = { choices: null, seq: 0, loading: false };
  const byId = (id) => doc.getElementById(id);
  const els = () => ({ field: byId('export-use-field'), select: byId('export-use'), hint: byId('export-use-hint') });
  /** openExportModal, before the dialog paints: the field is read afresh (a version may have been saved since). */
  function open(item) {
    st.choices = null;
    st.seq++;
    st.loading = flagOn('workflowTests') && !!item.versionable;   // D17: the Version field
    paintExportUse(els(), null, { doc });
  }
  /** openExportModal, once the dialog shows: read the versions when the field may show. */
  function opened(workflowId) {
    if (st.loading) void load(workflowId);
  }
  /** Read the workflow's versions (the Versions page's call) and show the field when it has one, defaulting to the
   *  version new runs use. A failed read or no version keeps it hidden: the export is of the draft, as before.
   *  Download, Preview and Export wait for the answer (loading), so no request is ever built before it. An answer for
   *  an earlier open is dropped. */
  async function load(workflowId) {
    const ticket = st.seq;
    const r = await readVersions(workflowId);
    if (ticket !== st.seq || modalHidden()) return;
    st.loading = false;
    const choices = r.ok ? exportUseChoices(r.overview) : null;
    if (choices) {
      st.choices = choices;
      paintExportUse(els(), choices, { doc });
      const g = guard();
      if (g && !g.touched) g.markClean();   // a filled-in default is no change of the user's
    }
    // The buttons back, by the dialog's own rules (the marketplace's: targets and busy).
    byId('export-plan-btn').disabled = false;
    byId('export-apply-btn').disabled = false;
    syncButtons();
  }
  /** closeExportModal: a versions read still out has no dialog to land in. */
  function close() {
    st.seq++;
  }
  /** While the versions read is out (loading), Download, Preview and Export stay disabled; every sync that enables
   *  them ends here. */
  function hold() {
    if (!st.loading) return;
    byId('export-plan-btn').disabled = true;
    byId('export-apply-btn').disabled = true;
  }
  /** The request's `use`: the field's pick, or undefined while the field is hidden (send nothing). */
  const now = () => (st.choices ? exportUseValue(byId('export-use').value) : undefined);
  /** The export request body: the format's own fields plus `use` when the field is shown. */
  function withUse(opts) {
    const use = now();
    return use === undefined ? opts : { ...opts, use };
  }
  /** The JSON download's address: of the stored graph, or of the version picked. */
  function jsonUrl(url) {
    const use = now();
    return `${url}${use === undefined ? '' : `?use=${encodeURIComponent(use)}`}`;
  }
  /** bindExportModal: a new pick repaints the draft's hint and invalidates a shown plan. */
  function bind(invalidatePlan) {
    byId('export-use').addEventListener('change', () => {
      paintExportUse(els(), st.choices, { doc, keep: true });   // the draft's hint
      invalidatePlan();
    });
  }
  return { open, opened, close, hold, loading: () => st.loading, withUse, jsonUrl, bind };
}
