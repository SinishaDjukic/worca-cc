// src/shared/ask-card-types.mjs — every card type dev's Chat draws in a thread (a message block `{kind: 'card', card: {type}}`).
// The one list Stillhet's turn mapper (ui/public/stillhet/live/chat-turns.mjs) is tested against; test/ask-card-types.test.mjs
// fails when ui/routes/chat/thread-cards.mjs or src/core/ask/ gains a `type: '…'` literal that is neither here nor a
// known non-card type. The Workflows composer's cards (agent-draft, script-draft, canvas-edit) live in composer threads,
// which Chat never lists, so they are not here. A run proposal (src/core/ask/proposal.mjs validateProposal) carries no
// `type` at all: chat-turns.mjs reads it as the card without one.
export const ASK_CARD_TYPES = Object.freeze([
  // a question Worca asks
  'question',
  // a run: the live run card (server.mjs `progress`), a task proposal (`workflow`, mode task or shape), its stop, PR and ship
  'progress', 'workflow', 'workflow-build', 'run-stop', 'pull-request', 'ship', 'changes', 'route',
  // settings proposals, then the receipt an applied one leaves
  'scope-switch', 'model', 'schedule', 'away', 'proxy', 'web', 'clone', 'project', 'workspace', 'actions', 'metrics', 'policy',
  'receipt',
  // a script to approve, a command Worca ran, files it shows
  'script-approval', 'command', 'files',
]);
