// ui/public/design/chat-cards.mjs — a design's cards in the Chat page's transcript (docs/design.md, "In the chat"). A
// chat with a design is a plain chat: its messages, and the design's cards among them (a round's receipt with Back to
// before this, the design questions, the sound card), are the chat's. Each card is a host element the chat keeps; the
// design open beside the chat (design/studio.mjs paintCard) draws into it, and repaints it when the build or a Back
// changes what it shows (`repaint`). Without an open design (Design switched off, the design deleted, its studio still
// loading) a card is one quiet line. Registered with the chat's card registry before the chat mounts. Nothing runs
// when this file loads.
import { registerChatCard } from '../chat/extensions.mjs';
import { buildChatReceipt } from '../chat/question.mjs';
import { roundRowText } from './chat.mjs';

export const DESIGN_CARD_TYPES = Object.freeze(['design-round', 'design-questions', 'design-sound']);

/** The line a design card shows when no design is open to draw it. */
export function designCardFallback(block) {
  const c = block && block.card && typeof block.card === 'object' ? block.card : {};
  if (c.type === 'design-round') return Number.isSafeInteger(c.round) ? roundRowText(c, block.state) : 'A design round';
  if (c.type === 'design-sound') return 'Sound for the video';
  return typeof c.heading === 'string' && c.heading ? c.heading : 'Design questions';
}

/**
 * @param {{ doc: Document, studio: () => ({ paintCard: (host: HTMLElement, block: object) => boolean,
 *   dropCard?: (id: string) => void } | null) }} deps  `studio()`: the design open beside the chat on screen, or null.
 * @returns {{ repaint: () => void, size: () => number }}
 */
export function registerDesignChatCards({ doc, studio }) {
  const hosts = new Map();   // card id -> { el, block }: the transcript's current element for that card
  function paint(entry) {
    let drawn = false;
    try { drawn = studio()?.paintCard(entry.el, entry.block) === true; } catch { drawn = false; }
    if (drawn) return;
    const line = buildChatReceipt(doc, designCardFallback(entry.block));
    line.classList.add('dsc-card-fallback');
    entry.el.replaceChildren(line);
  }
  function build(block) {
    const el = doc.createElement('div');
    el.className = 'dsc-card-host';
    el.dataset.designCard = String(block.id);
    const entry = { el, block };
    hosts.set(block.id, entry);
    paint(entry);
    return {
      el,
      handle: { blockChanged(b) { entry.block = b; paint(entry); } },
      // A rebuild makes the new host before the old one goes: only this host's own entry is dropped.
      dispose() {
        if (hosts.get(block.id) !== entry) return;
        hosts.delete(block.id);
        try { studio()?.dropCard?.(block.id); } catch { /* the design's own trouble */ }
      },
    };
  }
  for (const type of DESIGN_CARD_TYPES) registerChatCard(type, (block) => build(block));
  return {
    /** The open design changed what its cards show (it opened, a build went live or ended, a Back ran). */
    repaint() { for (const entry of hosts.values()) paint(entry); },
    size: () => hosts.size,
  };
}
