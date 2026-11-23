// ui/public/feature-pull/run-flow.mjs — the pick → confirm → overlay → start flow used by New Run and Chat after a feature is
// picked from Requirements. It checks the feature's readiness and live runs, opens the run-setup overlay with its note step (the
// contradiction check included), and POSTs the start to the SAME server path the Requirements page uses
// (POST /api/requirements/:seq/start). It never posts /api/run: the server owns what a start of a feature means.
//
// `fetchJson(url, { method, body, signal })` resolves the parsed JSON body and throws on a non-2xx answer with `err.status`
// and `err.data` (the parsed body), like the Requirements page's own `api`.
import { openRunSetupOverlay, RUN_IN_PROGRESS_TEXT, AUTO_WORKFLOW_ID } from '../run-setup-overlay.mjs';
import { liveStart } from './labels.mjs';
import { createDocumentModal } from './modal.mjs';

export const ARCHIVED_TEXT = 'This feature is archived. Restore it on the Requirements page to start a run from it.';
export const LOAD_FAILED_TEXT = 'Worca could not load this feature. Try again.';
export const START_FAILED_TEXT = 'Worca could not start the run. Try again.';
export const START_AGAIN_TEXT = ' Press Start again to start another.';
export const NOT_STARTABLE_TEXT = 'This feature cannot be started yet. Fix this on the Requirements page: ';
export const OTHER_WORKFLOW_COPY = 'To use another workflow, start this feature from the Requirements page.';
export const REASON_MAX = 500;   // the server's reason cap (REASON_MAX in src/core/requirements/start.mjs, and the Requirements start dialog's)

function h(doc, tag, attrs = {}, ...kids) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

const errText = (err) => (err && err.data && typeof err.data.error === 'string' && err.data.error ? err.data.error : START_FAILED_TEXT);

/** The labels of the checks that stop a start: the server's keys looked up in the readiness, else every failing check. */
function failingLabels(readiness, keys = null) {
  const checks = (readiness && Array.isArray(readiness.checks)) ? readiness.checks : [];
  if (!keys) return checks.filter((c) => c && !c.ok).map((c) => c.label || c.key);
  return keys.map((k) => { const c = checks.find((x) => x && x.key === k); return (c && c.label) || String(k); });
}

/** A card with a title, text lines, and Cancel + a confirm button. Resolves true on confirm, false on cancel or any close. */
function confirmCard({ modal, doc, trigger, title, lines, confirmText }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const cancel = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'feature-flow-cancel', text: 'Cancel' });
    const go = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'feature-flow-confirm', text: confirmText });
    cancel.addEventListener('click', () => { settle(false); modal.close(true); });
    go.addEventListener('click', () => { settle(true); modal.close(false); });
    const card = h(doc, 'section', { class: 'card req-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'feature-flow-title' },
      h(doc, 'h2', { id: 'feature-flow-title', text: title }), ...lines, h(doc, 'div', { class: 'req-dlg-btns' }, cancel, go));
    modal.open(card, { trigger, first: cancel, canClose: () => true, onClose: () => settle(false) });
  });
}

/** A one-button notice (the archived feature, a feature that could not load). */
function notice({ modal, doc, trigger, text }) {
  const ok = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'feature-flow-ok', text: 'OK' });
  ok.addEventListener('click', () => modal.close(true));
  const card = h(doc, 'section', { class: 'card req-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Feature' },
    h(doc, 'p', { class: 'form-msg err', role: 'alert', 'data-ui': 'feature-flow-notice', text }), h(doc, 'div', { class: 'req-dlg-btns' }, ok));
  modal.open(card, { trigger, first: ok, canClose: () => true });
}

/**
 * The start-before-Ready dialog: the failing checks and a required reason. Resolves the reason, or null on cancel/close.
 * With `submit(reason)` (→ `{ error? }`) the dialog stays open on an error and shows it; without, it closes on Continue.
 */
function askReason({ modal, doc, trigger, labels, submit = null }) {
  return new Promise((resolve) => {
    let settled = false;
    let busy = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const area = h(doc, 'textarea', { id: 'feature-flow-reason', rows: '3', maxlength: String(REASON_MAX), 'aria-required': 'true', 'data-ui': 'feature-flow-reason' });
    const msg = h(doc, 'p', { class: 'form-msg err', role: 'alert', 'data-ui': 'feature-flow-msg' });
    const cancel = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'feature-flow-cancel', text: 'Keep deciding' });
    const go = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'feature-flow-confirm', text: 'Continue', disabled: true });
    const sync = () => { go.disabled = busy || !area.value.trim(); };
    area.addEventListener('input', sync);
    cancel.addEventListener('click', () => { if (busy) return; settle(null); modal.close(true); });
    go.addEventListener('click', async () => {
      const reason = area.value.trim();
      if (busy || !reason) return;
      busy = true; msg.textContent = ''; sync();
      let result = {};
      if (submit) {
        try { result = (await submit(reason)) || {}; } catch (err) { result = { error: errText(err) }; }
      }
      busy = false; sync();
      if (result.error) { msg.textContent = result.error; return; }
      settle(reason); modal.close(false);
    });
    const card = h(doc, 'section', { class: 'card req-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'feature-flow-title' },
      h(doc, 'h2', { id: 'feature-flow-title', text: "Start before it's Ready?" }),
      h(doc, 'p', { class: 'req-dlg-lead', text: labels.length === 1 ? 'One check does not pass yet:' : `${labels.length} checks do not pass yet:` }),
      h(doc, 'ul', { 'data-ui': 'feature-flow-failing' }, ...labels.map((l) => h(doc, 'li', { text: l }))),
      h(doc, 'label', { for: 'feature-flow-reason', text: 'Why start now? (required)' }), area, msg,
      h(doc, 'div', { class: 'req-dlg-btns' }, cancel, go));
    modal.open(card, { trigger, first: area, canClose: () => !busy, onClose: () => settle(null) });
  });
}

/**
 * The start POST and what each answer means. Resolves `{}` (started), `{ error }` (shown where the person is) or
 * `{ error, notReady: [keys] }` (the server's NOT_READY: the caller asks for a reason).
 */
function makeSender({ seq, fetchJson, workflowId, sourceBranch, onStarted }) {
  let confirmRunning = false;
  let inflight = null;
  async function post(parts) {
    const { reason, overlay, note, noteOverrides } = parts;
    const body = { workflowId, ...(reason ? { reason } : {}), ...(sourceBranch ? { sourceBranch } : {}),
      ...(overlay && workflowId !== AUTO_WORKFLOW_ID ? { overlay } : {}), ...(note ? { note } : {}),
      ...(note && noteOverrides ? { noteOverrides: true } : {}), ...(confirmRunning ? { confirmRunning: true } : {}) };
    let data;
    try {
      data = await fetchJson(`/api/requirements/${seq}/start`, { method: 'POST', body });
    } catch (err) {
      const errData = (err && err.data) || {};
      if (err && err.status === 409 && errData.code === 'RUN_IN_PROGRESS') {
        confirmRunning = true;
        return { error: RUN_IN_PROGRESS_TEXT + START_AGAIN_TEXT };
      }
      if (err && err.status === 409 && Array.isArray(errData.failing)) return { error: errText(err), notReady: errData.failing };
      return { error: errText(err) };
    }
    // the run exists now: a caller that throws must not turn a started run into "could not start"
    try { onStarted({ runId: data && data.runId, version: data && data.version, feature: data && data.feature }); } catch (err) { console.warn('[worca] after-start handler failed', err); }
    return {};
  }
  const send = (parts) => {
    if (inflight) return inflight;   // a double Start posts once
    inflight = post(parts).finally(() => { inflight = null; });
    return inflight;
  };
  return { send, arm: () => { confirmRunning = true; } };
}

/** The overlay's `checkNote`: the server's verdict mapped to the overlay's `{ conflicts }` / `{ skipped }`. */
const noteChecker = (fetchJson, seq) => async (note, signal) => {
  const res = await fetchJson(`/api/requirements/${seq}/note-check`, { method: 'POST', body: { note }, signal });
  if (res && res.skipped) return { skipped: true };
  return { conflicts: res && Array.isArray(res.conflicts) ? res.conflicts : [] };
};

/** The feature the flow starts from, or the text that stops the flow. */
async function loadFeature(fetchJson, seq) {
  let feature;
  try {
    const data = await fetchJson(`/api/requirements/${seq}`);
    feature = data && data.feature;
  } catch { feature = null; }
  if (!feature) return { stop: LOAD_FAILED_TEXT };
  if (feature.status === 'archived' || feature.state === 'archived') return { stop: ARCHIVED_TEXT };
  return { feature };
}

/**
 * Start a run from the Requirements feature `seq`. Resolves once the overlay is open (after any reason / live-run confirm the
 * person answered), or when the flow stopped before it; the start itself completes later, through
 * `onStarted({ runId, version, feature })`.
 * @returns {Promise<{ close():void }|null>} the overlay's handle, or null when the flow stopped before it
 */
export async function startFromFeature({ seq, modal = null, fetchJson, projectDir = null, scopeRef = null, trigger = null, onStarted = () => {}, document: docArg = null }) {
  const doc = docArg || globalThis.document;
  const dialogs = modal || createDocumentModal({ document: doc });
  const { feature, stop } = await loadFeature(fetchJson, seq);
  if (stop) { notice({ modal: dialogs, doc, trigger, text: stop }); return null; }
  const starts = Array.isArray(feature.starts) ? feature.starts : [];
  let reason = '';
  if (feature.readiness && feature.readiness.ok === false) {
    if (!feature.readiness.overridable) {
      notice({ modal: dialogs, doc, trigger, text: NOT_STARTABLE_TEXT + failingLabels(feature.readiness).join(', ') + '.' });
      return null;
    }
    reason = await askReason({ modal: dialogs, doc, trigger, labels: failingLabels(feature.readiness) });
    if (!reason) return null;
  }
  let confirmRunning = false;
  if (liveStart(starts)) {
    if (!await confirmCard({ modal: dialogs, doc, trigger, title: 'A run is already going', lines: [h(doc, 'p', { text: RUN_IN_PROGRESS_TEXT })], confirmText: 'Start another' })) return null;
    confirmRunning = true;
  }
  const workflowId = (starts[0] && starts[0].workflowId) || AUTO_WORKFLOW_ID;
  const sourceBranch = String((starts[0] && starts[0].sourceBranch) || '').trim();
  const sender = makeSender({ seq, fetchJson, workflowId, sourceBranch, onStarted });
  if (confirmRunning) sender.arm();

  const checkNote = noteChecker(fetchJson, seq);
  let handle = null;
  const onConfirm = async (overlay, { note = '', noteOverrides = false } = {}) => {
    const parts = { reason, overlay, note, noteOverrides };
    const res = await sender.send(parts);
    if (!res.notReady) return res.error ? { error: res.error } : {};
    // the server holds the feature as not Ready after all: the overlay closes, the reason is asked, and the same start goes again
    handle.close();
    const labels = failingLabels(feature.readiness, res.notReady);
    void askReason({ modal: dialogs, doc, trigger, labels,
      submit: async (why) => { const again = await sender.send({ ...parts, reason: why }); return again.notReady ? { error: again.error } : again; } });
    return {};
  };
  handle = openRunSetupOverlay({
    modal: dialogs, workflowId, workflowName: workflowId === AUTO_WORKFLOW_ID ? 'Auto' : '', copy: { otherWorkflowText: OTHER_WORKFLOW_COPY }, projectDir,
    scopeRef: scopeRef || (feature.scopeType ? { kind: feature.scopeType === 'workspace' ? 'workspace' : 'project', ref: feature.scopeKey } : null),
    trigger, note: true, checkNote, onConfirm, onCancel: () => {}, document: doc,
  });
  return handle;
}
