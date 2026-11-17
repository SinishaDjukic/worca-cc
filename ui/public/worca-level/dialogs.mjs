// ui/public/worca-level/dialogs.mjs — the three worca level dialogs: welcome-new (first open),
// welcome-existing (first open with past activity) and celebration (a new highest level). Each is a
// read-only .viewer-modal built from the caller's WorcaLevelView. Closing calls onClose() once;
// the caller (app-wiring) owns acknowledging the server. Which dialog opens, and when, is
// model.mjs pickDialog's call. This module never fetches and never touches <html data-level>.
import { guardModal } from '../modal-guard.mjs';
import { layoutDialog } from '../dialog-layout.mjs';
import { isHashHref, setAvatarSrc } from './model.mjs';
import { renderSegments } from './segments.mjs';
import { WORCA_LEVELS, WORCA_LEVEL_COUNT, WORCA_THRESHOLDS } from '../../../src/shared/worca-levels.mjs';

const BACKDROP_GRACE_MS = 450;
const MAX_LINKS = 2;
const COUNCIL_INDEX = WORCA_LEVEL_COUNT;
const DIALOG_KINDS = Object.freeze(['welcome-new', 'welcome-existing', 'celebration']);

const ladderEntry = (index) => WORCA_LEVELS[index - 1] || null;

function welcomeNewParagraph() {
  const names = WORCA_LEVELS.map((l) => l.name);
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    `There are five levels of orchestration know-how: ${list}. Worca moves you up as you learn to ` +
    'orchestrate more, and your character gets a new hat and tool with each level. Hover your avatar ' +
    "in the corner any time to see what's next."
  );
}

const openActions = (view) =>
  (Array.isArray(view.next) ? view.next : []).filter((a) => !a.done && isHashHref(a.href)).slice(0, MAX_LINKS);

/** The line under a celebration: what comes next, or nothing at the top. */
function celebrationNext(view, entry) {
  const next = view.top === true ? null : ladderEntry(entry.index + 1);
  if (!next) return null;
  if (next.index === COUNCIL_INDEX) return `Next: ${next.name} · ${WORCA_THRESHOLDS.councilDays} days in a row`;
  return `Next: ${next.name} · ${next.actions.length} actions`;
}

/**
 * Build, show and guard one worca level dialog. `kind` is 'welcome-new' | 'welcome-existing' |
 * 'celebration'; `view` is the served WorcaLevelView. Closing (button, Escape, a backdrop click
 * after a short grace) removes the modal and calls onClose() once. Returns the modal element.
 */
export function renderWorcaDialog(kind, view, { onClose = () => {}, doc = globalThis.document } = {}) {
  if (!DIALOG_KINDS.includes(kind)) throw new Error(`Unknown worca level dialog: ${kind}`);
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const link = (action) => {
    const a = el('a', 'worca-dlg-link', action.label);
    a.setAttribute('href', action.href);
    return a;
  };
  const linkList = (actions) => {
    const list = el('div', 'worca-dlg-links');
    list.append(...actions.map(link));
    return list;
  };
  const em = (name) => el('em', 'worca-dlg-em', name);

  const index = view.level.index;
  const entry = ladderEntry(index) || ladderEntry(1);
  const levelName = view.level.name;
  const ack = el('button', 'btn btn-primary worca-dlg-close', 'Got it');
  ack.type = 'button';
  const actions = el('div', 'confirm-actions worca-dlg-actions');
  const head = [];
  const body = [];

  const avatar = el('img', 'worca-dlg-avatar');
  setAvatarSrc(avatar, view.level.avatar);
  avatar.alt = `${levelName} avatar`;
  avatar.width = 96;
  avatar.height = 96;

  const title = el('h2', 'worca-dlg-title');
  title.id = `worca-dlg-title-${kind}`;

  if (kind === 'welcome-new') {
    const upNext = ladderEntry(index + 1);
    title.append('You start out ', em(levelName));
    head.push(avatar, el('p', 'worca-dlg-level', 'Welcome to Worca'), title);
    body.push(el('p', 'worca-dlg-lead', welcomeNewParagraph()));
    if (upNext) {
      body.push(el('p', 'worca-dlg-next', `Your first steps toward ${upNext.name}`));
      body.push(linkList(openActions(view)));
    }
    actions.append(ack);
  } else if (kind === 'welcome-existing') {
    title.append('Your work so far makes you ', em(entry.phrase));
    head.push(avatar, el('p', 'worca-dlg-level', 'New in Worca: levels'), title);
    body.push(el('p', 'worca-dlg-lead', `You already ${entry.recap}. That's level ${index} of ${WORCA_LEVEL_COUNT}.`));
    body.push(renderSegments(doc, { done: index, total: WORCA_LEVEL_COUNT }, { size: 'lg' }));
    const nextEntry = view.top === true ? null : ladderEntry(index + 1);
    if (nextEntry) {
      const progress = view.progress || { done: 0, total: nextEntry.actions.length };
      body.push(el('p', 'worca-dlg-next', `Next up: ${nextEntry.name} · ${progress.done} of ${progress.total} done`));
      body.push(linkList(openActions(view)));
    }
    body.push(el('p', 'worca-dlg-note', 'Only you can see your level.'));
    actions.append(ack);
  } else {
    const art = el('div', 'worca-dlg-art');
    art.style.setProperty('--wl-hue', String(entry.hue));
    art.append(avatar);
    title.textContent = `You're ${entry.phrase}`;
    head.push(art, el('p', 'worca-dlg-level', `New level · ${index} of ${WORCA_LEVEL_COUNT}`), title);
    body.push(el('p', 'worca-dlg-lead', `You've ${entry.recap}. Your avatar now wears the ${entry.hat}.`));
    const nextLine = celebrationNext(view, entry);
    if (nextLine) body.push(el('p', 'worca-dlg-next', nextLine));
    const see = el('a', 'btn worca-dlg-see', 'See your level');
    see.setAttribute('href', '#profile/level');
    ack.textContent = 'Carry on';
    actions.append(see, ack);
  }

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
