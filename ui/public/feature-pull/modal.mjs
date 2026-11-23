// ui/public/feature-pull/modal.mjs — the document modal adapter the run-setup overlay and the feature picker open on
// where the page has no modal of its own (New Run, Chat). `createDocumentModal({ document })` returns
// `{ open(card, { trigger, first, canClose, onClose }), close(restore) }`: the card goes into a
// `.viewer-modal.req-dlg-wrap` wrapper on `document.body` under a 'form' guard, so a backdrop click never closes it
// (a refusal or a stray double-click keeps the overlay up), Escape closes it unless `canClose()` says a submit is out,
// Tab stays inside the card, and focus goes back to `trigger` on close. `onClose` fires exactly once, however it closes.

import { guardModal } from '../modal-guard.mjs';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((n) => (
    !n.disabled && n.getAttribute('tabindex') !== '-1' && !n.hidden && n.getAttribute('aria-hidden') !== 'true'
  ));
}

export function createDocumentModal({ document: doc = globalThis.document } = {}) {
  let current = null;   // { wrap, guard, trigger, onClose }

  function close(restore = true) {
    const cur = current;
    if (!cur) return;
    current = null;
    cur.guard.release();
    cur.wrap.removeEventListener('keydown', cur.onKeydown);
    cur.wrap.remove();
    const { trigger } = cur;
    if (restore && trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
    if (typeof cur.onClose === 'function') cur.onClose();
  }

  function open(card, { trigger = null, first = null, canClose, onClose } = {}) {
    close(false);
    const wrap = doc.createElement('div');
    wrap.className = 'viewer-modal req-dlg-wrap';
    wrap.append(card);

    const onKeydown = (e) => {
      if (e.key !== 'Tab') return;
      const items = focusables(wrap);
      if (!items.length) { e.preventDefault(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      const at = doc.activeElement;
      if (e.shiftKey && (at === head || !wrap.contains(at))) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && (at === tail || !wrap.contains(at))) { e.preventDefault(); head.focus(); }
    };
    wrap.addEventListener('keydown', onKeydown);

    const guard = guardModal(wrap, {
      kind: 'form',
      close: () => close(true),
      busy: () => (typeof canClose === 'function' ? !canClose() : false),
      isDirty: () => false,   // Escape closes at once; the overlay owns its own unsaved-note handling
    });
    current = { wrap, guard, trigger, onClose, onKeydown };
    doc.body.append(wrap);
    guard.opened();
    const target = first && wrap.contains(first) ? first : focusables(wrap)[0];
    target?.focus?.();
  }

  return { open, close };
}
