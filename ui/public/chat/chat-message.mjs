// ui/public/chat/chat-message.mjs — cross-chat messaging (slice 1): one `chat-message` block as the web transcript shows
// it. An incoming record is what another chat's assistant (or a person in its channel) wrote; an outgoing one is this
// chat's own "Sent to" copy. The body is set with textContent only. The chat chip is an a.ask-ref-chip the panel's ref
// chips resolve, as they do in answers. Pure DOM; `doc` is injected for jsdom.
// Slice 2: a run's post (`from.kind === 'run'`) shows a run chip, "Update" or "Question", and for a question the Runs
// page's answer form (painted by the injected `paintRunQuestion`) or what became of it. Import-free on purpose.

export const INTENT_LABELS = Object.freeze({ note: 'Note', question: 'Question', handoff: 'Hand-off' });
const RUN_INTENT_LABELS = Object.freeze({ note: 'Update', question: 'Question' });
const LIVE_RUN_RE = /^[0-9a-f-]{36}$/;
const PIPELINE_RE = /^[0-9a-f]{8}$/;
const SCOPE_KEY_RE = /^[A-Za-z0-9._-]+$/;
const CLOSED_TEXT = Object.freeze({ stopped: 'the run stopped', paused: 'the run paused', error: 'the run failed', done: 'the run finished' });

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** The run's History route (ask-run-card.mjs progressRoute's rule), or null when the key or id is not safe. */
function historyHref(from) {
  const key = from?.scope?.key;
  if (typeof key !== 'string' || !SCOPE_KEY_RE.test(key) || typeof from.runId !== 'string' || !PIPELINE_RE.test(from.runId)) return null;
  return `#history/${from.scope.kind === 'workspace' ? `workspaces/${key}` : key}/${from.runId}`;
}

/** A run question's part: the painted form, the run-page fallback, or the answered / closed status. */
function runQuestionPart(doc, b, body, paintRunQuestion) {
  const q = b.question;
  const part = make(doc, 'div', 'ask-chat-msg-q');
  if (q.state === 'answered') {
    const a = q.answer || {};
    const by = a.actedBy?.kind === 'away' ? 'Away mode' : String(a.actedBy?.label || 'worca');
    const line = make(doc, 'div', 'ask-chat-msg-answer', `Answered by ${by}`);
    line.setAttribute('role', 'status');
    part.append(line);
    for (const x of Array.isArray(a.answers) ? a.answers : []) {
      part.append(make(doc, 'div', 'ask-chat-msg-answer-line', `${String(x?.question ?? '')} → ${String(x?.choice ?? '')}`));
    }
    return part;
  }
  if (q.state === 'closed') {
    const why = Object.hasOwn(CLOSED_TEXT, q.closedReason) ? `No longer waiting: ${CLOSED_TEXT[q.closedReason]}` : 'No longer waiting';
    const line = make(doc, 'div', 'ask-chat-msg-answer', why);
    line.setAttribute('role', 'status');
    part.append(line);
    return part;
  }
  const panel = make(doc, 'div', 'qpanel hidden');
  panel.setAttribute('aria-label', "Answer the run's question");
  part.append(panel);
  const ref = { runId: typeof b.from.liveRunId === 'string' ? b.from.liveRunId : null, pipelineId: b.from.runId, askId: q.askId };
  part.__runRef = ref;   // repaintRunQuestion paints it later, when the run's question frame comes after this record
  const painted = typeof paintRunQuestion === 'function' && paintRunQuestion(ref, part) === true;
  if (painted) { body.hidden = true; return part; }
  const fb = make(doc, 'div', 'ask-chat-msg-q-fallback', 'Answer it on the run page: ');
  const open = make(doc, 'a', 'ask-chat-msg-open', 'Open run');
  const href = historyHref(b.from);
  if (href) open.setAttribute('href', href);
  fb.append(open);
  part.append(fb);
  return part;
}

/**
 * An open run question's record still showing the "Open run" fallback: try `paintRunQuestion` again. The server posts the
 * record before the run's question frame, so the first paint usually misses; the panel calls this on each run frame.
 * @returns {boolean} true when the form is now painted
 */
export function repaintRunQuestion(rec, paintRunQuestion) {
  const part = rec && typeof rec.querySelector === 'function' ? rec.querySelector('.ask-chat-msg-q') : null;
  const fb = part && part.querySelector('.ask-chat-msg-q-fallback');
  if (!fb || !part.__runRef || typeof paintRunQuestion !== 'function') return false;
  if (paintRunQuestion(part.__runRef, part) !== true) return false;
  fb.remove();
  const body = rec.querySelector('.ask-chat-msg-body');
  if (body) body.hidden = true;
  return true;
}

/** @returns {HTMLElement} div.ask-chat-msg.ask-chat-msg-in|out */
export function buildChatMessage(doc, block, opts = {}) {
  const b = block && typeof block === 'object' ? block : {};
  const incoming = b.direction !== 'out';
  if (incoming && b.from?.kind === 'run') return buildRunMessage(doc, b, opts);
  const root = make(doc, 'div', `ask-chat-msg ask-chat-msg-${incoming ? 'in' : 'out'}`);
  const other = incoming ? b.from || {} : b.to || {};
  const head = make(doc, 'div', 'ask-chat-msg-head');
  head.append(make(doc, 'span', 'ask-chat-msg-dir', incoming ? 'Message from' : 'Sent to'));
  const id = typeof other.chatId === 'string' ? other.chatId : '';
  const chip = make(doc, 'a', 'ask-ref-chip ask-chat-msg-chip', id);
  if (id) chip.setAttribute('href', `#chat/${id}`);
  head.append(chip);
  if (incoming && b.from?.scope?.label) head.append(make(doc, 'span', 'ask-chat-msg-scope', String(b.from.scope.label)));
  head.append(make(doc, 'span', 'ask-chat-msg-intent', INTENT_LABELS[b.intent] || INTENT_LABELS.note));
  root.append(head);
  // Slice 3: a person wrote it from the sender chat's channel thread; the record names them.
  const person = incoming && b.by?.kind === 'person' && typeof b.by.label === 'string' && b.by.label ? b.by.label : null;
  if (person) root.append(make(doc, 'div', 'ask-chat-msg-by', `Written by ${person} in another chat.`));
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

/** A run's post: the run chip (live run page while that id is UUID-shaped) and the intent. */
function buildRunMessage(doc, b, { paintRunQuestion } = {}) {
  const from = b.from;
  const root = make(doc, 'div', 'ask-chat-msg ask-chat-msg-in ask-chat-msg-run');
  const head = make(doc, 'div', 'ask-chat-msg-head');
  head.append(make(doc, 'span', 'ask-chat-msg-dir', 'Message from'));
  const chip = make(doc, 'a', 'ask-ref-chip ask-ref-chip-run ask-chat-msg-chip', typeof from.runId === 'string' ? from.runId : '');
  if (typeof from.liveRunId === 'string' && LIVE_RUN_RE.test(from.liveRunId)) chip.setAttribute('href', `#running/${from.liveRunId}`);
  if (typeof from.title === 'string' && from.title) chip.title = from.title;
  head.append(chip);
  if (from.scope?.label) head.append(make(doc, 'span', 'ask-chat-msg-scope', String(from.scope.label)));
  head.append(make(doc, 'span', 'ask-chat-msg-intent', RUN_INTENT_LABELS[b.intent] || RUN_INTENT_LABELS.note));
  root.append(head);
  const body = make(doc, 'div', 'ask-chat-msg-body', typeof b.text === 'string' ? b.text : '');
  root.append(body);
  if (b.question && typeof b.question === 'object') root.append(runQuestionPart(doc, b, body, paintRunQuestion));
  const foot = make(doc, 'div', 'ask-chat-msg-foot');
  foot.append(make(doc, 'span', 'ask-chat-msg-note', `Conversation ${b.conversationId || ''}, message ${Number(b.hop) || 1} of ${Number(b.maxHops) || 6}`));
  root.append(foot);
  return root;
}
