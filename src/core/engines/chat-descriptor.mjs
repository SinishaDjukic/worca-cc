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
 *   metaTools           the engine's own tools a chat keeps (named and justified in plans/), as the stream names them:
 *                       the watchdog and the self-test allow them beside worca's (Goose: load_skill)
 *   modelProblem(id)    why a model of this engine cannot run a chat (a provider that is itself an agent CLI, one that
 *                       refuses a request without the shell), or null; the picker leaves such a model out
 *   ownFolder           a chat runs in a folder of its own under the scratch dir (the engine keeps sessions per folder)
 */
export function makeChatDescriptor({
  engine, lockdown, askSupport = ready, selfTest = null, preflight = ready, modelPriced = null, resumeNotFound = never,
  docsAnchor, setupLabel, noLockdownMessage, shellTrippedMessage, titles = false, suggestionModel = null, prompt = {},
  notReadyFlag, metaTools = [], modelProblem = null, ownFolder = false,
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
    metaTools: Object.freeze([...metaTools]),
    modelProblem: typeof modelProblem === 'function' ? modelProblem : () => null,
    ownFolder: ownFolder === true,
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

/** Extra env prefixes a provider's key and settings go by, beyond its own upper-cased name. */
const PROVIDER_ENV_EXTRA = Object.freeze({
  google: ['GEMINI_'], gemini: ['GOOGLE_'], gcp_vertex_ai: ['GOOGLE_', 'GCP_'], 'google-vertex': ['GOOGLE_', 'GCP_'], vertex: ['GOOGLE_', 'GCP_'],
  aws_bedrock: ['AWS_'], 'amazon-bedrock': ['AWS_'], bedrock: ['AWS_'], azure_openai: ['AZURE_'], azure: ['AZURE_OPENAI_'],
});
/**
 * The env prefixes of a chat model's provider (`provider/model`): the ones a chat on Goose or OpenCode keeps through its
 * env scrub, so a key in worca's environment reaches that provider and no other's. A chat has no shell, so the engine
 * reads them only to call its provider (and worca's MCP child inherits them).
 */
export function providerEnvPrefixes(modelId) {
  const p = String(modelId || '').split('/')[0].trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(p) || !String(modelId).includes('/')) return [];
  return [...new Set([`${p.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`, ...(PROVIDER_ENV_EXTRA[p] || [])])];
}
