// src/core/engines/chat-descriptor.mjs
// The shape of a chat descriptor: how Chat (Ask Worca) runs on an engine other than Claude. Each adapter that worca can
// lock down for a chat exports one, built here so every field has a value; src/core/engines/chat.mjs collects them, and
// turn.mjs, ask/models.mjs, ask/spawn.mjs and ask/prompt.mjs read them instead of naming engines. Import-light on
// purpose: the adapters import it.
import { ENGINES, engineLabel } from '../../shared/engine-switch.mjs';

const DOCS = 'https://github.com/SinishaDjukic/worca-cc/blob/dev/docs/models.md';
const never = () => false;
const ready = async () => ({});

/**
 * A chat descriptor with every field filled.
 *   engine              the adapter's name
 *   label               the engine's display name (engine-switch.mjs)
 *   lockdown()          truthy when worca has a verified lockdown for this engine (null/false: Chat is unavailable)
 *   noLockdownMessage   the turn's error when lockdown() is falsy
 *   askSupport(o)       the installed binary has every flag the lockdown needs: resolves {refusal} or {} (never rejects)
 *   selfTest(o)         null, or the runtime proof that the lockdown holds on this binary and this user's config
 *                       (engines/chat-selftest.mjs): resolves {refusal} or {}
 *   preflight({model})  the binary runs and is signed in: resolves {refusal} | {warning} | {}
 *   modelPriced(model)  for an engine that reports a cost: worca knows this model's price (a per-turn cost cap needs one)
 *   resumeNotFound(err) the turn's error says the stored session is gone (the turn retries once from history)
 *   notReady            {code, docsUrl, setupLabel, flag}: the not-ready notice and its error code; `flag` is the notice's
 *                       marker the panel opens the setup docs from
 *   shellTrippedMessage the error when the watchdog saw a shell call
 *   images, pdfs        what a chat takes (engine-switch.mjs `chat`)
 *   titles              the chat's title is a call on this engine (else it is the prompt's own words)
 *   suggestionModel     the model of the next-prompt suggestion, or null (none)
 *   prompt              the system prompt's words for this engine: {cli, attachments, composerBinary, webOff}
 */
export function makeChatDescriptor({
  engine, lockdown, askSupport = ready, selfTest = null, preflight = ready, modelPriced = null, resumeNotFound = never,
  docsAnchor, setupLabel, noLockdownMessage, shellTrippedMessage, titles = false, suggestionModel = null, prompt = {},
  notReadyFlag,
}) {
  const label = engineLabel(engine);
  const chat = ENGINES[engine]?.chat || { images: false, pdfs: false };
  const short = setupLabel || label;
  return Object.freeze({
    engine, label,
    lockdown: typeof lockdown === 'function' ? lockdown : () => lockdown,
    noLockdownMessage: noLockdownMessage || `Chat on ${label} is unavailable: worca cannot lock this ${label} down for a chat. Use a Claude chat.`,
    askSupport, selfTest, preflight,
    reportsCost: ENGINES[engine]?.cost === true,
    modelPriced: typeof modelPriced === 'function' ? modelPriced : () => false,
    resumeNotFound,
    notReady: Object.freeze({ code: `${engine}-not-ready`, docsUrl: `${DOCS}#${docsAnchor || engine}`, prefix: `${short} isn't ready`, setupLabel: `${short} setup`, flag: notReadyFlag || `${engine}Setup` }),
    shellTrippedMessage: shellTrippedMessage || `${label} tried to run a shell command although it was given none — worca stopped the turn.`,
    images: chat.images === true, pdfs: chat.pdfs === true,
    titles: titles === true,
    suggestionModel: typeof suggestionModel === 'string' && suggestionModel ? suggestionModel : null,
    prompt: Object.freeze({
      cli: prompt.cli || `${label} with its own sign-in`,
      attachments: prompt.attachments || `Image and PDF attachments are different: a ${label} chat cannot view them, and read_attachment returns only their kind and size. Tell the user they need a Claude chat (a Codex chat sees images).`,
      composerBinary: prompt.composerBinary || `A ${label} chat cannot view images or PDFs: read_attachment returns only their kind and size, and they need a Claude chat.`,
      webOff: prompt.webOff || `${label}'s own web tools stay off.`,
    }),
  });
}

/** The error a per-turn cost cap gives a chat on `d` for `model`, or null when worca can keep the turn under it. */
export function chatCostCapRefusal(d, model, modelPriced = d.modelPriced) {
  if (!d.reportsCost) return `A per-turn cost cap is set, and ${d.label} reports no cost, so worca cannot keep this turn under it. Turn the cap off (Settings › Chat), or use a Claude or Codex chat.`;
  if (!modelPriced(model)) return `A per-turn cost cap is set, and ${model} has no known price on ${d.label}, so worca cannot keep this turn under it. Pick a priced ${d.label} model, or turn the cap off (Settings › Chat).`;
  return null;
}
