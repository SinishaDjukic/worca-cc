// ui/public/chat/keep-focus.mjs — Chat keeps the control the user is in (#958). Lifted from the live run card's S9
// focus keeping (run-card.mjs kept/keptRestore) and the question card's copy (question.mjs keepFocus): ask-panel
// installs it ONCE on the transcript column, so every row and every card keeps its focused control across a repaint.

/**
 * While a control inside `root` has the focus, watch for a repaint that MOVES it: a removed node is the control or
 * holds it. Removing a focused element drops the focus to <body>; once the control is back in the page, focus it
 * again (the browser restores a text field's caret with the focus), only when the focus fell to nothing. A press
 * outside the control, a Tab out of `root`, a control that is gone or cannot take the focus ends the watch.
 * Returns { stop, destroy }: stop() ends the current watch, destroy() also removes the listeners on `root`.
 */
export function keepFocus(root, doc) {
  const MO = doc.defaultView && doc.defaultView.MutationObserver;
  let kept = null;                                   // the control that has the focus
  let mo = null;
  function stop() {
    kept = null;
    if (mo) { mo.disconnect(); mo = null; }
    doc.removeEventListener('pointerdown', press, true);
  }
  function press(e) { if (kept && !(e.target && kept.contains(e.target))) stop(); }
  function moved(records) {
    for (const r of records) for (const n of r.removedNodes) if (n === kept || (n.contains && n.contains(kept))) return true;
    return false;
  }
  function restore(records) {
    const node = kept;
    if (!node || doc.activeElement === node || !moved(records)) return;   // still in it, or it did not move
    const a = doc.activeElement;
    if (!node.isConnected || (a && a !== doc.body)) { stop(); return; }   // gone, or the focus went somewhere
    node.focus({ preventScroll: true });             // its focusin records it again
    if (doc.activeElement !== node) stop();          // it cannot take the focus now (disabled while a post is in flight)
  }
  function onIn(e) {
    kept = e.target;
    if (!mo && MO) {
      mo = new MO(restore);
      mo.observe(root, { childList: true, subtree: true });
      doc.addEventListener('pointerdown', press, true);
    }
  }
  // Chrome blurs a control that is being moved (focusout, no relatedTarget): that is not the user leaving it.
  function onOut(e) { if (e.relatedTarget && !root.contains(e.relatedTarget)) stop(); }
  root.addEventListener('focusin', onIn);
  root.addEventListener('focusout', onOut);
  return {
    stop,
    destroy() { stop(); root.removeEventListener('focusin', onIn); root.removeEventListener('focusout', onOut); },
  };
}
