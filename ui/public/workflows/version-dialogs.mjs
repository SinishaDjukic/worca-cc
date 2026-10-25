// ui/public/workflows/version-dialogs.mjs — Save version and Use dialogs + the top-bar status line
// (plans/workflow-tests-plan.md Task 7; canvas boards 7 and 8). Pure DOM on the shared dialog layout.
import { createDialog } from '../marketplace/layers.mjs';

/** The top-bar line next to the name (D10 words). */
export function statusText(o) {
  if (!o || !Number.isInteger(o.liveVersionNo)) return '';
  return o.draft && o.draft.changed ? `Draft · new runs use v${o.liveVersionNo}` : `v${o.liveVersionNo} in use`;
}

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function changesList(doc, changes, none) {
  if (!Array.isArray(changes) || !changes.length) return el(doc, 'p', 'hint wfv-changes-none', none);
  const ul = el(doc, 'ul', 'wfv-changes');
  for (const c of changes) ul.append(el(doc, 'li', '', c));
  return ul;
}

function frame({ doc, win, title, body, confirmLabel, onConfirm }) {
  const dlg = createDialog({ doc, win, width: 'md' });
  const h = el(doc, 'h2', 'mk-dialog-title', title); h.id = 'mk-dialog-title';
  const error = el(doc, 'p', 'hint err wfv-dlg-error'); error.setAttribute('aria-live', 'polite');
  const cancel = el(doc, 'button', 'btn', 'Cancel'); cancel.type = 'button';
  const ok = el(doc, 'button', 'btn btn-primary', confirmLabel); ok.type = 'button';
  cancel.addEventListener('click', () => dlg.close());
  ok.addEventListener('click', async () => {
    dlg.setBusy(true); ok.disabled = true; error.textContent = '';
    let res;
    try { res = await onConfirm(); } catch (e) { res = { ok: false, error: e && e.message ? e.message : String(e) }; }
    dlg.setBusy(false); ok.disabled = false;
    if (res && res.ok) dlg.close(); else error.textContent = (res && res.error) || 'That did not work. Try again.';
  });
  dlg.replace({ head: [h], body: [...body, error], foot: [cancel, ok] });
  dlg.open();
  return dlg;
}

/** Save version N: what changed since the last version, a short note, and "Also use vN for new runs". */
export function openSaveVersionDialog({ doc, win, nextNo, changes, onSubmit }) {
  const label = el(doc, 'label', 'label', 'What changed, in a few words '); label.htmlFor = 'wfv-sv-note';
  label.append(el(doc, 'span', 'opt', 'optional'));
  const note = el(doc, 'input'); note.type = 'text'; note.id = 'wfv-sv-note'; note.maxLength = 200;
  const useWrap = el(doc, 'label', 'wfv-check');
  const use = el(doc, 'input'); use.type = 'checkbox'; use.id = 'wfv-sv-use';
  useWrap.append(use, el(doc, 'span', '', ` Also use v${nextNo} for new runs`));
  const field = el(doc, 'div', 'field'); field.append(label, note);
  return frame({
    doc, win, title: `Save version ${nextNo}`, confirmLabel: `Save version ${nextNo}`,
    body: [el(doc, 'p', 'hint', 'What changed since the last version:'), changesList(doc, changes, 'No changes since the last version.'), field, useWrap],
    onConfirm: () => onSubmit({ note: note.value.trim(), use: use.checked }),
  });
}

/** Use vN for new runs? (board 8, D2/D12: no gate — the person decides). */
export function openUseVersionDialog({ doc, win, versionNo, changes, onConfirm }) {
  return frame({
    doc, win, title: `Use v${versionNo} for new runs?`, confirmLabel: `Use v${versionNo}`,
    body: [
      el(doc, 'p', '', `Runs you start from now on use v${versionNo}: from the Runs page, schedules and chats. Runs already going keep their version. You can switch back at any time.`),
      el(doc, 'p', 'hint', `Compared with the version in use now:`),
      changesList(doc, changes, 'Nothing differs from the version in use.'),
    ],
    onConfirm,
  });
}
