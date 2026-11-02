// ui/public/chat/run-graph-overlay.mjs
//
// The chat run card's Expand: the same run's live workflow graph, large, in an overlay over the chat. It is the app's
// large workflow pop-up (app.js openWorkflowPopup: a body-level .viewer-modal.wf-pop, a head with the title and Close,
// the dotted canvas) holding a run-hosts `monitor` host with `fill`, so the run monitor's status styling, its .gv-nav
// cluster, drag to pan and ⌘/ctrl+wheel zoom apply, fitted to the larger box. The card feeds it the same
// (runId, stepper, decor) it paints its own well with, so it stays live. Read-only: Escape, Close or a backdrop click
// close it (modal-guard 'viewer') and the focus goes back to the opener. Nothing navigates; Open run is the one way on.
import { mountRunGraph } from '../graph/run-hosts.mjs';
import { guardModal } from '../modal-guard.mjs';

let seq = 0;

/**
 * @param {{doc: Document, title?: string, opener?: HTMLElement|null, onOpenRun?: (() => void)|null,
 *   onGateClick?: ((wireId: string) => void)|null, onClose?: (() => void)|null}} opts
 * @returns {{el: HTMLElement, update(runId: string, stepper: object, decor: object): void, repaint(): void, close(): void, readonly open: boolean}}
 */
export function openRunGraphOverlay({ doc, title = '', opener = null, onOpenRun = null, onGateClick = null, onClose = null }) {
  const h = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, text) => { const b = h('button', cls, text); b.type = 'button'; return b; };
  const titleId = `chat-rc-zoom-title-${++seq}`;
  const ov = h('div', 'viewer-modal wf-pop chat-rc-zoom');
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-labelledby', titleId);
  const card = h('div', 'card wf-pop-card');
  const head = h('div', 'wf-pop-head');
  const heading = h('h2', null, title || 'Workflow');
  heading.id = titleId;
  const acts = h('div', 'chat-rc-zoom-acts');
  const openRun = typeof onOpenRun === 'function' ? button('btn chat-rc-zoom-open', 'Open run') : null;
  const closeBtn = button('btn chat-rc-zoom-close', 'Close');
  acts.append(...[openRun, closeBtn].filter(Boolean));
  head.append(heading, acts);
  const wrap = h('div', 'run-flow-wrap wf-pop-canvas');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Workflow graph');
  const host = h('div', 'run-flow');
  wrap.append(host);
  card.append(head, wrap);
  ov.append(card);
  doc.body.append(ov);

  let open = true;
  // A gate pip does what it does in the card (the card scrolls to its question): the overlay steps aside first.
  const graph = mountRunGraph(host, { mode: 'monitor', fill: true, doc,
    onGateClick: (wireId) => { close(); if (typeof onGateClick === 'function') onGateClick(wireId); } });
  const guard = guardModal(ov, { kind: 'viewer', close: () => close() }).opened();

  function close() {
    if (!open) return;
    open = false;
    guard.release();
    graph.destroy();
    ov.remove();
    if (typeof onClose === 'function') onClose();
    // A hidden or detached opener cannot take the focus (the graph went away, the card was torn down); no scroll either.
    if (opener && opener.isConnected && !opener.closest('[hidden]') && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }
  closeBtn.addEventListener('click', close);
  if (openRun) openRun.addEventListener('click', () => { close(); onOpenRun(); });
  // The focus stays in the dialog: Tab and shift+Tab wrap around its controls (the head's buttons, the zoom cluster).
  ov.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const stops = [...card.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter((n) => !n.closest('[hidden]'));
    if (!stops.length) { e.preventDefault(); return; }
    const first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  closeBtn.focus();

  return {
    el: ov,
    update(runId, stepper, decor) { if (open) graph.update(runId, stepper, decor); },
    repaint() { if (open) graph.repaint(); },
    close,
    get open() { return open; },
  };
}
