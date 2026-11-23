// ui/public/worca-level/dialogs.mjs — the worca level dialogs: celebration (a new highest level) and summary (the levels
// credited at the first v2 evaluation, each once with its date). There is no
// levels welcome: a fresh install meets the setup assistant and the first-run welcome only. It is a
// read-only .viewer-modal built from the caller's WorcaLevelView. Closing calls onClose() once;
// the caller (app-wiring) owns acknowledging the server. Which dialog opens, and when, is
// model.mjs pickDialog's call. This module never fetches and never touches <html data-level>.
import { guardModal } from '../modal-guard.mjs';
import { layoutDialog } from '../dialog-layout.mjs';
import { setAvatarSrc } from './model.mjs';
import { WORCA_LEVELS, WORCA_LEVEL_COUNT } from '../../../src/shared/worca-levels.mjs';

const BACKDROP_GRACE_MS = 450;
const DIALOG_KINDS = Object.freeze(['celebration', 'summary']);

const ladderEntry = (index) => WORCA_LEVELS[index - 1] || null;

/** The line under a celebration: what comes next (from the served celebration), or nothing at the top. */
function celebrationNext(celebration) {
  if (!celebration.nextName || !Number.isFinite(celebration.nextTotal)) return null;
  const what = celebration.nextUnit === 'days' ? 'active days' : 'actions';
  return `Next: ${celebration.nextName} · ${celebration.nextTotal} ${what}`;
}

/** "2 Mar 2026" in the person's locale; a level credited without a known date shows none. */
function formatReached(iso) {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The earned levels of a summary, each index once, lowest first. */
function earnedLevels(summary) {
  const seen = new Map();
  for (const l of summary?.levels ?? []) if (ladderEntry(l.index) && !seen.has(l.index)) seen.set(l.index, l);
  return [...seen.values()].sort((a, b) => a.index - b.index);
}

/** The art of a summary: the highest earned level's tint and avatar. */
function shownOfSummary(view, earned) {
  const top = earned[earned.length - 1] || { index: 1 };
  const entry = ladderEntry(top.index) || ladderEntry(1);
  return { index: entry.index, key: entry.key, hue: entry.hue, avatar: top.avatar || entry.avatar };
}

/**
 * Build, show and guard the worca level dialog. `kind` is 'celebration' or 'summary'; `view` is the served
 * WorcaLevelView. Closing (button, Escape, a backdrop click after a short grace) removes the modal and calls onClose() once. Returns the modal element.
 */
export function renderWorcaDialog(kind, view, { onClose = () => {}, doc = globalThis.document } = {}) {
  if (!DIALOG_KINDS.includes(kind)) throw new Error(`Unknown worca level dialog: ${kind}`);
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const earned = kind === 'summary' ? earnedLevels(view.summary) : [];
  // A celebration is about the level just reached, which can differ from the current one; a summary shows the highest earned.
  const shown = kind === 'summary' ? shownOfSummary(view, earned) : view.celebration;
  const entry = ladderEntry(shown.index) || ladderEntry(1);
  const ack = el('button', 'btn btn-primary worca-dlg-close', 'Carry on');
  ack.type = 'button';
  const actions = el('div', 'confirm-actions worca-dlg-actions');
  const head = [];
  const body = [];

  const avatar = el('img', 'worca-dlg-avatar');
  setAvatarSrc(avatar, shown.avatar);
  avatar.alt = `${entry.name} avatar`;
  avatar.width = 96;
  avatar.height = 96;

  const title = el('h2', 'worca-dlg-title', `You're ${entry.phrase}`);
  title.id = `worca-dlg-title-${kind}`;

  const art = el('div', 'worca-dlg-art');
  art.dataset.worcaLevel = shown.key;
  art.style.setProperty('--wl-hue', String(shown.hue));
  art.append(avatar);
  const kicker = kind === 'summary' ? 'Your work so far' : `New level · ${shown.index} of ${WORCA_LEVEL_COUNT}`;
  head.push(art, el('p', 'worca-dlg-level', kicker), title);
  if (kind === 'summary') {
    const list = el('ul', 'worca-dlg-levels');
    for (const l of earned) {
      const row = el('li', 'worca-dlg-level-row');
      row.append(el('span', 'worca-dlg-level-name', l.name || ladderEntry(l.index).name));
      const date = formatReached(l.reachedAt);
      if (date) row.append(el('span', 'worca-dlg-level-date', date));
      list.append(row);
    }
    body.push(list, el('p', 'worca-dlg-lead', 'Only you can see your level.'));
  } else {
    body.push(el('p', 'worca-dlg-lead', `You've ${entry.recap}. Your avatar now wears the ${entry.hat}.`));
    const nextLine = celebrationNext(shown);
    if (nextLine) body.push(el('p', 'worca-dlg-next', nextLine));
  }
  const see = el('a', 'btn worca-dlg-see', 'See your level');
  see.setAttribute('href', '#profile/level');
  actions.append(see, ack);

  const card = el('div', 'card worca-dlg-card');
  card.append(...head, ...body, actions);
  layoutDialog(card, { head, foot: [actions] });
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
    onClose();
  }
  ack.addEventListener('click', teardown);
  // "See your level" navigates by its href and closes, so the dialog does not sit over the page.
  modal.querySelector('.worca-dlg-see')?.addEventListener('click', teardown);
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
  ack.focus({ preventScroll: true });
  return modal;
}
