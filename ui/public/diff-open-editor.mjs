// ui/public/diff-open-editor.mjs — the Diff tab's open-in-editor controls, shared by History's Diff tab and the
// live run page's (docs/runs.md, docs/actions.md "Built-ins"). Which control a run's Actions model allows, the
// tooltip texts, the line a file opens at, and the two buttons. The fetches live in app.js (openInEditor).
import { icon } from './icons.mjs';
import { feedbackIcon } from './feedback.mjs';

const editorOf = (m) => (Array.isArray(m?.builtins) ? m.builtins.find((b) => b && b.key === 'editor') : null) || null;

/**
 * The per-file icon for one member of a run, or null when none shows.
 * @returns {null | { label: string, mode: 'open'|'checkout'|'use-folder', member: string, heldBy?: string }}
 */
export function editorOpenFor(model, { projectKey = null, archived = false } = {}) {
  if (!model || !model.enabled || archived) return null;
  const members = Array.isArray(model.members) ? model.members : [];
  const m = projectKey ? members.find((x) => x.projectKey === projectKey) : (members.length === 1 ? members[0] : null);
  const ed = editorOf(m);
  if (!m || !ed) return null;
  const out = (mode) => ({ label: ed.label, mode, member: m.projectKey });
  if (!model.finished) return out('open');                       // live or paused: the server opens the worktree
  if (m.state === 'checked-out') return out('open');
  if (m.state === 'no-branch' || model.checkoutBlocked) return null;
  if (m.heldBy) return { ...out('use-folder'), heldBy: m.heldBy };
  return out('checkout');
}

/** The live tab's "Open in <Editor>" button (the run's whole folder), or null. */
export function runFolderOpenFor(model) {
  if (!model || !model.enabled || model.finished) return null;
  const members = Array.isArray(model.members) ? model.members : [];
  if (!members.length || !members.every((m) => editorOf(m))) return null;
  return { label: editorOf(members[0]).label };
}

/** The icon's tooltip and aria-label. */
export function openFileTitle(fileName, label, mode) {
  if (mode === 'checkout') return `Check out this run, then open ${fileName} in ${label}`;
  if (mode === 'use-folder') return `Use the folder that has this branch, then open ${fileName} in ${label}`;
  return `Open ${fileName} in ${label}`;
}

/** The line a file opens at: its first hunk's new-side start (a pure deletion gives 1); null without hunks. */
export function firstChangedLine(parsed) {
  if (!parsed || parsed.binary || !Array.isArray(parsed.hunks) || !parsed.hunks.length) return null;
  return Math.max(1, parsed.hunks[0].newStart || 0);
}

/** Remove the error shown under `anchor`, if any. */
export function clearOpenError(anchor) {
  const next = anchor?.nextElementSibling;
  if (next && next.classList.contains('field-error') && next.classList.contains('diff-open-error')) next.remove();
}

/** Show `message` under `anchor` (the design system's .field-error), replacing an earlier one. */
export function showOpenError(anchor, message) {
  clearOpenError(anchor);
  const doc = anchor.ownerDocument;
  const msg = doc.createElement('span');
  msg.className = 'field-error diff-open-error';
  msg.setAttribute('role', 'alert');
  const text = doc.createElement('span');
  text.className = 'fe-text';
  text.textContent = String(message || 'Request failed');
  msg.append(feedbackIcon(doc, 'err', 'fe-ic'), text);
  anchor.after(msg);
  return msg;
}

function wireOpen(btn, onOpen, anchorSel) {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const anchor = btn.closest(anchorSel) || btn;
    clearOpenError(anchor);
    const hadFocus = btn.ownerDocument.activeElement === btn;   // read before disabling: Chromium blurs a disabled button
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    let r;
    try { r = await onOpen(); } catch (e) { r = { ok: false, error: e?.message || String(e) }; }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (hadFocus && btn.isConnected) btn.focus();
    if (!r || !r.ok) showOpenError(btn.closest(anchorSel) || anchor, r?.error);
  });
  return btn;
}

/** The quiet icon after a file head's counts. `onOpen()` resolves { ok, error? }. */
export function buildOpenFileButton(doc, { fileName, label, mode, onOpen }) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm btn-quiet btn-icon hd-diff-open';
  const title = openFileTitle(fileName, label, mode);
  b.setAttribute('aria-label', title);
  b.title = title;
  b.append(icon(doc, 'external', 14));
  return wireOpen(b, onOpen, '.hd-diff-pane-head');
}

/** The live tab's "Open in <Editor>" button, on the right of its note row. */
export function buildOpenRunButton(doc, { label, onOpen }) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm rd-diff-open';
  b.append(icon(doc, 'external', 14), doc.createTextNode(`Open in ${label}`));
  return wireOpen(b, onOpen, '.rd-diff-note');
}
