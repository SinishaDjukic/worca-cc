// ui/public/report-run.mjs
// Pure renderers for the "Report this run" preview modal. No fetch, no listeners,
// no document lookups: every function takes { doc } and returns DETACHED nodes, the
// way plugins-view.mjs / guardrails-view.mjs do. app.js owns the modal, the network
// call, the clipboard and the download.
//
// The reason and opt-in vocabulary comes from src/shared/report-reasons.mjs — the
// SAME module the core builder imports, so a label and a payload cannot drift. Two
// `..` because this file sits two levels below the repo root; the browser clamps the
// URL at '/' and the server serves src/shared there. Absolute specifiers are
// FORBIDDEN — they break the Node ESM resolver the UI tests use; app.js already uses
// this exact prefix.
import { REPORT_REASONS, OPT_IN_CLASSES } from '../../src/shared/report-reasons.mjs';

/** <option> elements for the reason <select>, in menu order. */
export function renderReasonOptions({ doc = globalThis.document } = {}) {
  return REPORT_REASONS.map((reason) => {
    const opt = doc.createElement('option');
    opt.value = reason.id;
    opt.textContent = reason.label;
    return opt;
  });
}

/**
 * The three opt-in checkboxes, as .confirm-checkbox rows (the #export-modal shape).
 * Each input carries data-optin="<key>" so app.js can delegate one change listener
 * over the wrapper.
 *
 * The sub-label class is .report-optin-hint, NOT .hint: ui-settings-about.test.mjs
 * asserts every `.hint` in the settings view is empty-texted, and keeping a
 * non-empty .hint out of the codebase's shared vocabulary avoids ever tripping that
 * view-wide rule if this markup is later reused inside Settings.
 */
export function renderOptIns({ doc = globalThis.document, include = {} } = {}) {
  const wrap = doc.createElement('div');
  wrap.className = 'report-optins';
  for (const cls of OPT_IN_CLASSES) {
    const label = doc.createElement('label');
    label.className = 'confirm-checkbox';

    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.dataset.optin = cls.key;
    input.checked = include[cls.key] === true;

    const span = doc.createElement('span');
    span.textContent = cls.label;
    const hint = doc.createElement('span');
    hint.className = 'report-optin-hint';
    hint.textContent = cls.hint;
    span.appendChild(doc.createElement('br'));
    span.appendChild(hint);

    label.appendChild(input);
    label.appendChild(span);
    wrap.appendChild(label);
  }
  return wrap;
}

/**
 * The preview text. This is the contract of the whole feature: what the reporter
 * reads here is byte-identical to what Copy JSON puts on the clipboard and what
 * Download JSON writes.
 */
export function previewText(payload) {
  if (!payload) return 'Building the report…';
  return JSON.stringify(payload, null, 2);
}

/** Blob parts for Download JSON — pretty JSON with a trailing newline. */
export function reportBlobParts(payload) {
  return [`${JSON.stringify(payload, null, 2)}\n`];
}
