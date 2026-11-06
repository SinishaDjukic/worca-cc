// ui/public/worca-level/dialogs.mjs — the three worca level dialogs: welcome-new (first open),
// welcome-existing (first open with past activity) and celebration (a new highest level). Each is a
// read-only .viewer-modal built from the caller's WorcaLevelView; closing it acknowledges it once.
// Which one opens, and when, is model.mjs pickDialog's call. This module never fetches a view and
// never touches <html data-level>.
import { guardModal } from '../modal-guard.mjs';
import { layoutDialog } from '../dialog-layout.mjs';
import { ackWorcaLevel, setAvatarSrc } from './model.mjs';

const BACKDROP_GRACE_MS = 450;
const TOP_LINE = 'You are at the top level. Keep leading the pod.';

const KINDS = Object.freeze({
  'welcome-new': { ack: 'welcome', title: 'Welcome to Worca', button: 'Get started' },
  'welcome-existing': { ack: 'welcome', title: 'Welcome to Worca levels', button: 'Got it' },
  celebration: { ack: 'celebration', title: 'You reached a new level', button: 'Nice' },
});

function leadFor(kind, view) {
  const name = view.level.name;
  if (kind === 'welcome-new') return `You start as ${name}. Worca grows with you as you use more of it.`;
  if (kind === 'welcome-existing') return `Based on what you have already done, you are ${name}.`;
  return `You are now ${name}. ${view.level.description || ''}`.trim();
}

function nextStepText(view) {
  if (view.top === true) return TOP_LINE;
  const next = (Array.isArray(view.next) ? view.next : []).find((a) => !a.done);
  return next ? `Next step: ${next.label}` : null;
}

/**
 * Build, show and guard one worca level dialog. `kind` is 'welcome-new' | 'welcome-existing' |
 * 'celebration'; `view` is the served WorcaLevelView. Closing (button, Escape, a backdrop click
 * after a short grace) acknowledges 'welcome' or 'celebration' once, removes the modal and calls
 * onClose(). Returns the modal element.
 */
export function renderWorcaDialog(kind, view, { onClose = () => {}, doc = globalThis.document } = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown worca level dialog: ${kind}`);
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const avatar = el('img', 'worca-dlg-avatar');
  setAvatarSrc(avatar, view.level.avatar);
  avatar.alt = `${view.level.name} avatar`;
  avatar.width = 96;
  avatar.height = 96;
  const levelName = el('p', 'worca-dlg-level', view.level.name);
  const title = el('h2', 'worca-dlg-title', spec.title);
  title.id = `worca-dlg-title-${kind}`;
  const lead = el('p', 'worca-dlg-lead', leadFor(kind, view));
  const body = [lead];
  const nextText = nextStepText(view);
  if (nextText) body.push(el('p', 'worca-dlg-next', nextText));
  const close = el('button', 'btn btn-primary worca-dlg-close', spec.button);
  close.type = 'button';
  const actions = el('div', 'confirm-actions worca-dlg-actions');
  actions.append(close);

  const card = el('div', 'card worca-dlg-card');
  card.append(avatar, levelName, title, ...body, actions);
  layoutDialog(card, { head: [avatar, levelName, title], foot: [actions] });
  const modal = el('div', 'viewer-modal worca-dlg');
  modal.dataset.dialog = kind;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', title.id);
  modal.append(card);

  // A double-click on whatever opened this lands its second click on the new scrim; ignore the
  // backdrop for the first moments.
  const openedAt = Date.now();
  let closed = false;
  const guard = guardModal(modal, {
    kind: 'viewer',
    close: () => { if (Date.now() - openedAt >= BACKDROP_GRACE_MS) teardown(); },
  });
  function teardown() {
    if (closed) return;
    closed = true;
    guard.release();
    modal.remove();
    const shown = spec.ack === 'celebration' ? view.celebration?.index ?? view.level.index : undefined;
    ackWorcaLevel(spec.ack, shown).catch((err) => {
      console.warn(`worca level: could not acknowledge ${spec.ack}: ${err.message}`);
    });
    onClose();
  }
  close.addEventListener('click', teardown);
  // Escape is a deliberate key, not a stray click: it closes at once and stops here so the
  // document-level guard does not also act on it.
  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    teardown();
  });

  doc.body.append(modal);
  guard.opened();
  close.focus({ preventScroll: true });
  return modal;
}
