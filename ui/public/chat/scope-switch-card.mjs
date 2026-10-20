// ui/public/chat/scope-switch-card.mjs — Projects, any way P4b: the project switch card (canvas SwitchAsk; CONTRACT §4
// `scope-switch`, SEAMS S17). When a No-project chat's message is fairly certainly about one onboarded project, P4a's
// model asks with propose_scope_switch and the parent mints this card. It asks in the Runs page's ask-card grammar
// (chat/question.mjs) and answers `{ choice: <projectKey> | 'none' }` on the existing card route. The card never
// changes the scope itself: P4a's `ask-scope` frame moves the pill and its divider row says it.
import { registerChatCard } from './extensions.mjs';
import { buildChatQuestion, buildChatReceipt } from './question.mjs';
import { kindChip, projectKind } from './scope-ui.mjs';

export const SCOPE_SWITCH_TYPE = 'scope-switch';

const MAX_CANDIDATES = 3;                            // U14: one to three projects
const NONE = 'none';
const NONE_LABEL = 'Continue without project';

/** card.candidates → [{ projectKey, name, shown, vcs }]: a key string, or a row with a non-empty projectKey; at most 3. */
function norm(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (out.length >= MAX_CANDIDATES) break;
    if (typeof c === 'string' && c) out.push({ projectKey: c, name: c, shown: '', vcs: null });
    else if (c && typeof c === 'object' && typeof c.projectKey === 'string' && c.projectKey) {
      out.push({ projectKey: c.projectKey, name: c.name || c.projectKey, shown: c.displayPath || c.path || '', vcs: c.vcs });
    }
  }
  return out;
}

/** build(block, ctx) for the chat card registry (CONTRACT §2) → { el, dispose }. */
export function buildScopeSwitchCard(block, ctx) {
  const doc = ctx.doc;
  const card = (block && block.card) || {};
  const cands = norm(card.candidates);
  const nameOf = (v) => (v === NONE ? NONE_LABEL : ((cands.find((c) => c.projectKey === v) || {}).name || v));
  const choice = typeof card.choice === 'string' && card.choice ? card.choice : null;
  if (block.state !== 'proposed' && !(block.state === 'answered' && choice)) {
    // S17: P4a closes an open card when the scope is set another way; an answer without a choice reads the same.
    return { el: buildChatReceipt(doc, 'Not answered'), dispose: () => {} };
  }
  const options = cands.map((c) => {
    const chip = kindChip(doc, projectKind(c));
    return { value: c.projectKey, label: c.name, ...(chip ? { chip } : {}), sub: c.shown };
  });
  options.push({ value: NONE, label: NONE_LABEL, chip: kindChip(doc, 'none') });
  const { el, destroy } = buildChatQuestion(doc, {
    id: `chat-q-${block.id}`,
    heading: 'Your turn: pick a project',
    questions: [{ id: 'project', text: 'Which project is this for?', why: card.reason || '', options }],
    submitLabel: (picks) => {
      const v = picks.get('project');
      if (!v) return 'Switch';
      return v === NONE ? 'Continue' : `Switch to ${nameOf(v)}`;
    },
    // The route answers { block, turn }: the flipped block re-renders this card. A 409 (card is closed, card is being
    // applied, PROJECT_GONE) rejects with its `error`, which buildChatQuestion shows in the card's line.
    onSubmit: async (picks) => {
      const v = picks.get('project');
      await ctx.postCard(block, { choice: v });
      if (typeof ctx.announce === 'function') ctx.announce(v === NONE ? 'Answer sent' : `Switched to ${nameOf(v)}`);
      if (typeof ctx.focusComposer === 'function') ctx.focusComposer();
    },
    ...(block.state === 'answered' ? { answered: new Map([['project', choice]]) } : {}),   // B9: the card stays, its pick marked
  });
  return { el, dispose: destroy };
}

/** Registers the card type (app.js, before the chat mounts). Calling it again replaces the builder. */
export function registerScopeSwitchCard() {
  registerChatCard(SCOPE_SWITCH_TYPE, buildScopeSwitchCard);
}
