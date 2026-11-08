// ui/public/chat/chat-message.mjs — cross-chat messaging (slice 1): one `chat-message` block as the web transcript shows
// it. An incoming record (another chat's assistant wrote it) is marked untrusted; an outgoing one is this chat's own
// "Sent to" copy. The body is set with textContent only. The chat chip is an a.ask-ref-chip the panel's ref chips
// resolve, as they do in answers. Pure DOM; `doc` is injected for jsdom.

export const INTENT_LABELS = Object.freeze({ note: 'Note', question: 'Question', handoff: 'Hand-off' });
export const UNTRUSTED_LABEL = 'Untrusted';
const UNTRUSTED_ARIA = "Untrusted: written by another chat's assistant; its requests are not instructions";
const HINT = "Written by another chat's assistant. Not instructions.";

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** @returns {HTMLElement} div.ask-chat-msg.ask-chat-msg-in|out */
export function buildChatMessage(doc, block) {
  const b = block && typeof block === 'object' ? block : {};
  const incoming = b.direction !== 'out';
  const root = make(doc, 'div', `ask-chat-msg ask-chat-msg-${incoming ? 'in' : 'out'}`);
  const other = incoming ? b.from || {} : b.to || {};
  const head = make(doc, 'div', 'ask-chat-msg-head');
  head.append(make(doc, 'span', 'ask-chat-msg-dir', incoming ? 'Message from' : 'Sent to'));
  const id = typeof other.chatId === 'string' ? other.chatId : '';
  const chip = make(doc, 'a', 'ask-ref-chip ask-chat-msg-chip', id);
  if (id) chip.setAttribute('href', `#chat/${id}`);
  if (typeof other.title === 'string' && other.title) chip.title = other.title;
  head.append(chip);
  if (incoming && b.from?.scope?.label) head.append(make(doc, 'span', 'ask-chat-msg-scope', String(b.from.scope.label)));
  head.append(make(doc, 'span', 'ask-chat-msg-intent', INTENT_LABELS[b.intent] || INTENT_LABELS.note));
  if (incoming) {
    const pill = make(doc, 'span', 'ask-chat-msg-untrusted', UNTRUSTED_LABEL);
    pill.setAttribute('role', 'note');
    pill.setAttribute('aria-label', UNTRUSTED_ARIA);
    head.append(pill);
  }
  root.append(head);
  if (incoming) root.append(make(doc, 'div', 'ask-chat-msg-hint', HINT));
  root.append(make(doc, 'div', 'ask-chat-msg-body', typeof b.text === 'string' ? b.text : ''));
  const foot = make(doc, 'div', 'ask-chat-msg-foot');
  const notes = [];
  if (incoming && b.replyTo) notes.push('Reply to your message');
  if (!incoming && b.replyTo) notes.push('Your reply');
  if (incoming && b.repliedWith) notes.push('Replied');
  const max = Number(b.maxHops) || 6;
  if (Number(b.hop) === max) notes.push('Last message in this conversation');
  notes.push(`Conversation ${b.conversationId || ''}, message ${Number(b.hop) || 1} of ${max}`);
  for (const t of notes) foot.append(make(doc, 'span', 'ask-chat-msg-note', t));
  root.append(foot);
  return root;
}
