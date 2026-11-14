// experiments/messaging-bus/lib/prompts.mjs — layer 3's per-role prompt texts (plan §3.4, §4.8).
// The fixtures in prompts/*.md are embedded byte-identically in docs/design/messaging-bus.md
// (pinned by test/design-doc.test.mjs); E7 loads them for the fixed prompt cost.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BusError } from './envelope.mjs';
import { estimateTokens } from './render.mjs';

const DIR = fileURLToPath(new URL('../prompts/', import.meta.url));

/** `receive` is appended for every role that has a mailbox. */
export const PROMPT_ROLES = Object.freeze(['receive', 'implementer', 'reviewer', 'decomposer', 'in-agent-parent', 'planner', 'chat-assistant']);

export function loadPrompt(role) {
  if (!PROMPT_ROLES.includes(role)) throw new BusError('BUS_BAD_CONFIG', `unknown prompt role ${JSON.stringify(String(role).slice(0, 40))}`);
  return readFileSync(`${DIR}${role}.md`, 'utf8');
}

export function promptTokens(role) {
  return estimateTokens(loadPrompt(role));
}
