// src/core/skills-registry/texts.mjs
// The words for a set skill that was not mounted, for a skill layer that was not loaded (skills registry design
// §4.1 host gates, §4.2 skip reasons) and for a skill that declares hooks, shared by run warnings, the run Context
// card, the previews, the Ask picker, the import preview and the catalog badges. Pure.

import { parseSkillId } from './ids.mjs';

/** Skip reasons that warn (the others are the user's choices: needs-consent, off, opted-out, chat-off). */
export const SKILL_PROBLEM_REASONS = ['missing-skill', 'plugin-disabled', 'invalid-skill', 'name-taken', 'cap'];
/** Why a whole skill layer is skipped on a host (`layer.blocked`). */
export const SKILL_LAYER_REASONS = ['sideload-disabled', 'cli-no-plugin-dir'];
/** A skill whose SKILL.md frontmatter declares `hooks:` is mounted, and says so everywhere it is shown. */
export const SKILL_HOOKS_TEXT = "declares hooks — they run shell commands outside Worca's guardrails when the skill is used";

const WHY = {
  'missing-skill': 'the skill is no longer installed',
  'plugin-disabled': 'plugin disabled',
  'invalid-skill': 'the skill is invalid — check it in Connectors › Skills',
  'needs-consent': 'turn it on in the team checklist',
  off: 'off',
  'opted-out': 'opted out for this run',
  'chat-off': 'switched off for this chat',
  'name-taken': 'another skill of this set has the same name',
  cap: 'over the skill limit for one spawn',
};

const LAYER_WHY = {
  'sideload-disabled': "this machine's managed Claude Code settings turn off --plugin-dir (disableSideloadFlags)",
  'cli-no-plugin-dir': 'this Claude Code has no --plugin-dir option',
};

/** The reason part of a skip's line, e.g. "plugin disabled". An unknown reason reads as itself. */
export function skillSkipReasonText(skip) {
  const reason = skip?.reason;
  return Object.hasOwn(WHY, reason) ? WHY[reason] : String(reason ?? 'skipped');
}

/** One line for a skipped set skill, e.g. "deploy-checklist in Billing skipped: plugin disabled". */
export function skillSkipMessage(skip) {
  const name = skip?.name || parseSkillId(skip?.skillId)?.name || skip?.skillId || 'a skill';
  return `${name} in ${skip?.setName ?? skip?.setId} skipped: ${skillSkipReasonText(skip)}`;
}

/** Why a blocked skill layer was not loaded — the part after "skills from sets not loaded on this machine: ", which
 *  every surface writes itself (run warning, run Context card, previews, Ask picker). An unknown reason reads as itself. */
export function skillLayerText(reason) {
  return Object.hasOwn(LAYER_WHY, reason) ? LAYER_WHY[reason] : String(reason);
}
