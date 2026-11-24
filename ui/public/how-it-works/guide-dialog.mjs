// The shared "How it works" dialog shell: dots, "N of M", Skip / Back / Next, the × (inline SVG),
// arrow keys, the Tab trap, Escape, a backdrop with a grace window and focus returning to the
// opener. Workspaces (workspace-guide.mjs) and every module explainer open through it, so they
// look and behave alike. It paints the steps it is given; the caller decides what a close means.
import { layoutDialog } from '../dialog-layout.mjs';
import { guardModal } from '../modal-guard.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
const X_PATH = 'M6 6l12 12M18 6L6 18';

/** A backdrop click this soon after opening is a double-click's second press on the new scrim. */
export const BACKDROP_GRACE_MS = 450;

function makeEl(doc) {
  return (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
}

function closeIcon(doc) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', X_PATH);
  svg.append(path);
  return svg;
}

/**
 * Open a walkthrough over the current page. onClose(how) runs once, AFTER the modal is gone, the
 * guard released and focus restored: 'finish' | 'skip' | 'close' (×, Escape, backdrop) | 'tour'.
 * @returns {{ close:(how?:string)=>void, goTo:(i:number)=>void, index:()=>number, modal:HTMLElement }}
 */
export function openGuideDialog({
  doc, id, steps, buildArt = () => [], finishLabel = 'Done', tour = null, tourPlacement = 'primary', dataset = {}, onClose = () => {},
}) {
  const el = makeEl(doc);
  const btn = (text, cls, on) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', on); return b; };
  const last = steps.length - 1;
  const opener = doc.activeElement;
  const titleId = `${id}-title`;
  let at = 0;
  let closed = false;

  const dots = el('span', 'wg-dots');
  dots.setAttribute('aria-hidden', 'true');                 // "N of M" says the same to a screen reader
  for (const s of steps) { const d = el('span', 'wg-dot'); d.dataset.step = s.id; dots.append(d); }
  const stepOf = el('span', 'wg-step-of');
  stepOf.setAttribute('aria-live', 'polite');
  const closeX = btn('', 'btn btn-quiet btn-icon btn-sm wg-close', () => teardown('close'));
  closeX.append(closeIcon(doc));
  closeX.setAttribute('aria-label', 'Close');
  const head = el('div', 'wg-head');
  head.append(dots, stepOf, closeX);
  const title = el('h2', 'wg-title');
  title.id = titleId;
  const body = el('div', 'wg-step');
  const skip = btn('Skip', 'btn btn-quiet wg-skip', () => teardown('skip'));
  const back = btn('Back', 'btn wg-back', () => goTo(at - 1));
  const next = btn('Next', 'btn btn-primary wg-next', () => (at === last ? teardown('finish') : goTo(at + 1)));
  const tourBtn = tour ? btn(tour.label, 'btn wg-tour', () => teardown('tour')) : null;
  const actions = el('div', 'confirm-actions wg-actions');
  const card = el('div', 'card wg-card');
  card.append(head, title, body, actions);
  layoutDialog(card, { head: [head, title], foot: [actions] });
  const modal = el('div', 'viewer-modal wg-modal');
  modal.id = id;
  for (const [k, v] of Object.entries(dataset)) modal.dataset[k] = v;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.append(card);
  // On the modal itself: a key typed here is handled here and goes no further, so neither
  // modal-guard's nor the spotlight tour's nor a page's document listener also acts on it.
  modal.addEventListener('keydown', onKey);
  const openedAt = Date.now();
  const guard = guardModal(modal, {
    kind: 'decision',
    close: () => { if (Date.now() - openedAt >= BACKDROP_GRACE_MS) teardown('close'); },
  });

  function onKey(e) {
    handleKey(e);
    e.stopPropagation();
  }
  function handleKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); teardown('close'); return; }
    if (e.key === 'Tab') { trapTab(e); return; }
    if (e.key === 'ArrowRight' && at < last) { e.preventDefault(); goTo(at + 1); }
    else if (e.key === 'ArrowLeft' && at > 0) { e.preventDefault(); goTo(at - 1); }
  }
  function trapTab(e) {
    const list = [...card.querySelectorAll(FOCUSABLE)];
    if (!list.length) return;
    const first = list[0];
    const end = list[list.length - 1];
    const active = doc.activeElement;
    if (!card.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && active === end) { e.preventDefault(); first.focus(); }
  }
  function goTo(i) {
    if (closed) return;
    at = Math.max(0, Math.min(last, i));
    paint();
  }
  function paintActions() {
    const onLast = at === last;
    const showTour = onLast && tourBtn;
    const tourFirst = tourPlacement === 'secondary';
    next.textContent = onLast ? finishLabel : 'Next';
    next.classList.toggle('btn-primary', !showTour || tourFirst);
    if (tourBtn) tourBtn.classList.toggle('btn-primary', !tourFirst);
    const tail = showTour ? (tourFirst ? [tourBtn, next] : [next, tourBtn]) : [next];
    actions.replaceChildren(skip, el('span', 'wg-spacer'), back, ...tail);
  }
  function paint() {
    const s = steps[at];
    modal.dataset.step = s.id;
    stepOf.textContent = `${at + 1} of ${steps.length}`;
    [...dots.children].forEach((d, i) => { d.dataset.state = i < at ? 'done' : i === at ? 'current' : 'todo'; });
    title.textContent = s.title;
    body.replaceChildren(...s.paras.map((t) => el('p', null, t)), ...buildArt(doc, s.art));
    back.disabled = at === 0;
    paintActions();
    const a = doc.activeElement;
    if (!a || a === doc.body || !card.contains(a) || a.disabled) next.focus({ preventScroll: true });
  }
  function teardown(how) {
    if (closed) return;
    closed = true;
    guard.release();
    modal.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    onClose(how);
  }

  doc.body.append(modal);
  guard.opened();
  paint();
  return { close: (how = 'close') => teardown(how), goTo, index: () => at, modal };
}
