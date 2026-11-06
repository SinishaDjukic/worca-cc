// ui/public/workflows/export-use.mjs — the Export dialog's Version field (plans/workflow-tests-plan.md D17; canvas
// board 21): which saved version, or the draft, an export exports. Read from the Versions page's overview
// (GET /api/workflows/:id/versions). Pure: the dialog wiring lives in app.js (openExportModal).

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
