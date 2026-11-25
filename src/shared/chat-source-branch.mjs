// src/shared/chat-source-branch.mjs
// "Chat runs: source branch": which branch a chat-proposed run card starts from when the chat names none.
// The modes, labels, default and every hint and refusal sentence, shared by the core (settings, the gate,
// the proposal check) and the browser (the run card, Settings › Runs, the project Settings). Pure: no imports, no I/O.

export const CHAT_SOURCE_BRANCH_ID = 'chat.sourceBranch';
export const CHAT_SOURCE_BRANCH_SETTING = 'Chat runs: source branch';
export const CHAT_SOURCE_BRANCH_MODES = Object.freeze(['current', 'ask', 'require']);
export const DEFAULT_CHAT_SOURCE_BRANCH = 'ask';
export const CHAT_SOURCE_BRANCH_LABELS = Object.freeze({
  current: 'Current (checked out)', ask: 'Ask me on the card', require: 'Only when the chat names one',
});
export const CHAT_SOURCE_BRANCH_ROW = 'When the chat names no branch';
export const CHAT_SOURCE_BRANCH_INFO = `${CHAT_SOURCE_BRANCH_LABELS.current}: a chat run with no branch starts from the branch the project has checked out. `
  + `${CHAT_SOURCE_BRANCH_LABELS.ask}: the run card asks you to pick a branch before it starts. `
  + `${CHAT_SOURCE_BRANCH_LABELS.require}: the chat must ask you for a branch before it proposes the run.`;

/** A stored or posted value → one of the modes; anything else reads as 'ask', the safe side. */
export function normalizeChatSourceBranch(value) {
  return CHAT_SOURCE_BRANCH_MODES.includes(value) ? value : DEFAULT_CHAT_SOURCE_BRANCH;
}

/** The `current` option and sub-line: names the checked-out branch, never a detached 'HEAD'. */
export function currentBranchLabel(name) {
  return name && name !== 'HEAD' ? `${CHAT_SOURCE_BRANCH_LABELS.current}: ${name}` : CHAT_SOURCE_BRANCH_LABELS.current;
}

const WHERE_PROJECT = `Set in this project's Settings › Chat › ${CHAT_SOURCE_BRANCH_SETTING}.`;
const WHERE_USER = `Set in Settings › Runs › ${CHAT_SOURCE_BRANCH_SETTING}.`;
/** A project or member name in assistant-facing text, rendered as data: hard quotes, newlines and quotes escaped. */
const quoteName = (name) => JSON.stringify(String(name));

export const SOURCE_BRANCH_TEXT = Object.freeze({
  pick: 'Pick a source branch to start this run.',
  members: (names) => `Pick a source branch for: ${names.join(', ')}.`,
  empty: 'No branches found. Ask in the chat which branch to use.',
  failed: 'Could not load the branches. Ask in the chat which branch to use.',
  /** Where the mode was set: the project variant only when every source given is 'project' (D16). */
  where: (sources) => {
    const list = Array.isArray(sources) ? sources : [sources];
    return list.length && list.every((s) => s === 'project') ? WHERE_PROJECT : WHERE_USER;
  },
  invalid: `${CHAT_SOURCE_BRANCH_ID} must be one of ${CHAT_SOURCE_BRANCH_MODES.join(' | ')}`,
  option: 'Pick a branch…',
  loading: 'Loading branches…',
  notPicked: 'not picked',
});

/** The `require` refusal of a project proposal with no branch: tells the assistant to ask the user. */
export function proposalSourceRequired(name) {
  return `No source branch for ${quoteName(name)}: its "${CHAT_SOURCE_BRANCH_SETTING}" setting is "${CHAT_SOURCE_BRANCH_LABELS.require}". `
    + 'Ask the user in the chat which branch to start from, then propose again with sourceBranch.';
}

/** The workspace variant: names every member the setting refuses. */
export function proposalSourceRequiredMembers(names) {
  return `No source branch for ${names.map(quoteName).join(', ')}: their "${CHAT_SOURCE_BRANCH_SETTING}" setting is "${CHAT_SOURCE_BRANCH_LABELS.require}". `
    + 'Ask the user in the chat which branch to start from, then propose again with sourceBranch or sourceBranchByKey.';
}
