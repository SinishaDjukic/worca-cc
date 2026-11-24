// src/core/ask/verbosity.mjs — the Chat reply-style blocks (#1230). Pure. buildSystemPrompt appends the block of a
// non-normal level as the prompt's last section; `normal` (and anything unknown) adds nothing, so the prompt stays
// byte-identical. ASK_SYSTEM_RULES rule 5 is NOT reworded (its text anchors the Codex rewrites): each block says it
// replaces that length guidance instead. No block may name a sub-agent or hold a rewrite anchor (test-pinned).

/** Every non-normal block ends with this: the style never shortens what the rules require in full. */
export const VERBOSITY_CARVE_OUT = 'This style applies to your own prose only. It never changes: tool arguments; the brief you pass to propose_run or any other proposal text the user confirms; code, commands, ids, paths and links; chips and #history links; and the warnings and confirmations these rules require. Write those in full, exactly as you would at the normal style.';

const block = (body) => `## Reply style\n${body}\n\n${VERBOSITY_CARVE_OUT}`;

export const VERBOSITY_BLOCKS = Object.freeze({
  detailed: block('The user chose the detailed reply style; it replaces the general length guidance above. Give full explanations: the context behind the answer, your reasoning, the alternatives you considered with their trade-offs, and the next steps. Use headings and lists where they help.'),
  concise: block('The user chose the concise reply style; it replaces the general length guidance above. Lead with the answer, then at most a few short sentences. Skip background, alternatives and recaps unless asked.'),
  terse: block('The user chose the terse reply style; it replaces the general length guidance above. Answer in fragments and short bullets. No greeting, no recap, no restating the question, no closing offer.'),
  caveman: block('The user chose the caveman reply style; it replaces the general length guidance above. Use minimal words: drop articles, filler, pleasantries and hedging. Fragments are fine, for example: "Run failed. Test timeout. Fix: raise limit."'),
});

/** The block for `level`, or '' for normal, null, undefined or an unknown value. */
export function verbosityBlock(level) {
  return typeof level === 'string' && Object.hasOwn(VERBOSITY_BLOCKS, level) ? VERBOSITY_BLOCKS[level] : '';
}
