// src/core/engines/chat-descriptor.mjs
// The shape of a chat descriptor: how Chat (Ask Worca) runs on an engine other than Claude. Each adapter that worca can
// lock down for a chat exports one, built here so every field has a value; src/core/engines/chat.mjs collects them, and
// turn.mjs, ask/models.mjs, ask/spawn.mjs and ask/prompt.mjs read them instead of naming engines. Import-light on
// purpose: the adapters import it.
import { ENGINES, engineLabel, chatEnginesTaking } from '../../shared/engine-switch.mjs';
import { CODEX_PRICES, codexCachedRate, listPriceFor } from '../list-prices.mjs';
import { resolveModelRoute } from '../exec-env/credentials.mjs';

const DOCS = 'https://github.com/SinishaDjukic/worca-cc/blob/dev/docs/models.md';
/** A descriptor's `suggestionModel` that means "the chat's own model". */
export const CHAT_MODEL = 'chat';
const never = () => false;
const ready = async () => ({});

/**
 * A chat descriptor with every field filled: the adapter's code hooks, and the catalog's chat data (engine-switch.mjs
 * ENGINES[engine].chat), the one source of the data fields.
 * From the adapter (code):
 *   engine              the adapter's name
 *   lockdown()          truthy when worca has a verified lockdown for this engine (null/false: Chat is unavailable)
 *   askSupport(o)       the installed binary has every flag the lockdown needs: resolves {refusal} or {} (never rejects)
 *   selfTest(o)         null, or the runtime proof that the lockdown holds on this binary and this user's config
 *                       (engines/chat-selftest.mjs): resolves {refusal} or {}
 *   preflight({model})  the binary runs and is signed in: resolves {refusal} | {warning} | {}
 *   listRates(model)    the list price (per-million-token rates) the engine's provider bills `model` at, or null; the
 *                       Models page price wins over it (ask/chat-price.mjs chatModelRates)
 *   resumeNotFound(err) the turn's error says the stored session is gone (the turn retries once from history)
 *   modelProblem(id)    why a model of this engine cannot run a chat (a provider that is itself an agent CLI, one that
 *                       refuses a request without the shell), or null; the picker leaves such a model out
 *   signInMode(model, env)  the catalog sign-in mode (engine-switch.mjs `signIn.modes[].id`) a chat on `model` signs in
 *                       with (default: the route resolver's pick, as for a pipeline spawn), or null for every mode's: its exact names, and the engine's endpoint names, are handed on
 *                       to worca's own MCP child too (chatSignInEnv), whose Auto classifier runs on the chat's engine
 * From the catalog (data):
 *   label               the engine's display name
 *   noLockdownMessage   the turn's error when lockdown() is falsy
 *   notReady            {code, docsUrl, setupLabel, flag}: the not-ready notice and its error code (docsUrl from the
 *                       catalog's `docsAnchor`); `flag` is the notice's marker the panel opens the setup docs from
 *   shellTrippedMessage the error when the watchdog saw a shell call
 *   images, pdfs        what a chat takes: read_attachment and read_file send an image / a PDF as an MCP content block
 *                       of their result, which this engine forwards to its model
 *   turnImages          the user's images also ride the turn that carried them (Codex: `exec -i`)
 *   titles              the chat's title is a call on this engine (else it is the prompt's own words); like the
 *                       suggestion, it runs locked down with no MCP server (title.mjs auxTextCall askLockdown)
 *   suggestionModel     the model of the next-prompt suggestion: a model id, CHAT_MODEL (the chat's own), or null (none)
 *   prompt              the system prompt's words for this engine: {cli, attachments, composerBinary, webOff}
 *   media               where a media block of a tool result reaches the model ({kind}: 'images' or 'PDFs'), or null
 *   metaTools           the engine's own tools a chat keeps (named and justified in plans/), as the stream names them:
 *                       the watchdog and the self-test allow them beside worca's (Goose: load_skill)
 *   ownFolder           a chat runs in a folder of its own under the scratch dir (the engine keeps sessions per folder)
 *   minVersion, flags   the oldest CLI the lockdown was verified on, and the --help flags it needs (askSupport)
 */
export function makeChatDescriptor({
  engine, lockdown, askSupport = ready, selfTest = null, preflight = ready, listRates = null, resumeNotFound = never,
  modelProblem = null, signInMode = null,
}) {
  const label = engineLabel(engine);
  const chat = ENGINES[engine]?.chat || { images: false, pdfs: false };
  // A prompt word's {images} / {pdfs}: the chat engines that view that kind, as words (chatEnginesTaking).
  const fill = (t) => (typeof t === 'string' && t ? t.replace(/\{(images|pdfs)\}/g, (_, w) => chatEnginesTaking(w)) : null);
  const prompt = chat.prompt || {};
  return Object.freeze({
    engine, label,
    lockdown: typeof lockdown === 'function' ? lockdown : () => lockdown,
    noLockdownMessage: chat.noLockdownMessage || `Chat on ${label} is unavailable: worca cannot lock this ${label} down for a chat. Use a Claude chat.`,
    askSupport, selfTest, preflight,
    reportsCost: ENGINES[engine]?.cost === true,
    listRates: typeof listRates === 'function' ? listRates : () => null,
    resumeNotFound,
    notReady: Object.freeze({ code: `${engine}-not-ready`, docsUrl: `${DOCS}#${chat.docsAnchor || engine}`, prefix: `${label} isn't ready`, setupLabel: `${label} setup`, flag: `${engine}Setup` }),
    shellTrippedMessage: chat.shellTrippedMessage || `${label} tried to run a shell command although it was given none — worca stopped the turn.`,
    images: chat.images === true, pdfs: chat.pdfs === true, turnImages: chat.turnImages === true,
    titles: chat.titles !== false,
    metaTools: Object.freeze([...(chat.metaTools || [])]),
    modelProblem: typeof modelProblem === 'function' ? modelProblem : () => null,
    ownFolder: chat.ownFolder === true,
    signInMode: typeof signInMode === 'function' ? signInMode : (model, env) => routeSignInMode(engine, model, env),
    suggestionModel: chat.suggestionModel === undefined ? CHAT_MODEL : (typeof chat.suggestionModel === 'string' && chat.suggestionModel ? chat.suggestionModel : null),
    media: typeof chat.media === 'string' ? chat.media : null,
    prompt: Object.freeze({
      cli: fill(prompt.cli) || `${label} with its own sign-in`,
      attachments: fill(prompt.attachments) || attachmentWords(label, chat),
      composerBinary: fill(prompt.composerBinary) || composerBinaryWords(label, chat),
      webOff: fill(prompt.webOff) || `${label}'s own web tools stay off.`,
    }),
  });
}

/** Rule 6's attachment sentence for a chat on `label` that takes `chat.images` / `chat.pdfs` (read_attachment sends them
 *  as blocks of its result). */
export function attachmentWords(label, { images = false, pdfs = false } = {}) {
  const view = 'whether your model can view it is up to the model: when the result says it could not, tell the user';
  if (images && pdfs) return `Image and PDF attachments are different: read_attachment returns the image or PDF itself, as a block of its result beside its kind and size — read one to look at it (${view}).`;
  if (images) return `Image attachments are different: read_attachment returns the image itself, as a block of its result beside its kind and size — read one to look at it (${view}). A ${label} chat cannot view a PDF: read_attachment returns only its kind and size, and ${chatEnginesTaking('pdfs')} chats can.`;
  return `Image and PDF attachments are different: a ${label} chat cannot view them, and read_attachment returns only their kind and size. Tell the user ${chatEnginesTaking('images')} chats can view images${chatEnginesTaking('pdfs') !== chatEnginesTaking('images') ? ` (PDFs: ${chatEnginesTaking('pdfs')})` : ' and PDFs'}.`;
}
/** The composer's line for the same. */
export function composerBinaryWords(label, { images = false, pdfs = false } = {}) {
  if (images && pdfs) return 'For an image or PDF, read_attachment returns the image or PDF itself as a block of its result: read it to look at it.';
  if (images) return `For an image, read_attachment returns the image itself as a block of its result: read it to look at it; a ${label} chat cannot view a PDF (read_attachment returns only its kind and size).`;
  return `A ${label} chat cannot view images or PDFs: read_attachment returns only their kind and size.`;
}

/** The sign-in mode the route resolver picks for a spawn of `engine` on `model` (credentials.mjs resolveModelRoute, the
 *  rule every spawn's childEnv follows); '' (no names) when the route is refused, as the spawn itself is. */
function routeSignInMode(engine, model, env = process.env) {
  try {
    const d = resolveModelRoute({ engine, serverEnv: env, model: model || null, checkModel: false });
    return d.refusal ? '' : d.signInMode;
  } catch { return ''; }
}

/** The names in `env` that a chat on `d` signs in with for `model`, exact names only (decision 3): the catalog sign-in
 *  mode its descriptor's `signInMode` names (null: every mode's), plus the engine's endpoint names (its `env.relayOwned`
 *  that no mode holds as a credential). Never a WORCA_ name. */
export function chatSignInEnv(d, model, env = process.env) {
  const entry = d ? ENGINES[d.engine] : null;
  if (!entry?.signIn) return [];
  const modes = entry.signIn.modes;
  const id = d.signInMode(model, env);
  const creds = new Set(modes.filter((m) => m.kind !== 'own').flatMap((m) => m.env));
  const want = new Set([...(id == null ? modes : modes.filter((m) => m.id === id)).flatMap((m) => m.env),
    ...entry.env.relayOwned.filter((k) => !creds.has(k))]);
  return Object.keys(env).filter((k) => want.has(k) && !/^WORCA_/.test(k) && typeof env[k] === 'string' && env[k] !== '').sort();
}

/** OpenAI's list price of a model id as per-million-token rates (list-prices.mjs CODEX_PRICES), or null. */
export function openaiListRates(id) {
  const row = typeof id === 'string' && Object.hasOwn(CODEX_PRICES, id) ? CODEX_PRICES[id] : null;
  return row ? { input: row[0], output: row[1], cacheRead: codexCachedRate(row) } : null;
}
/** The list price of a `provider/model` id that worca knows its provider's prices for: `anthropic/<Claude id>`
 *  (Anthropic's list price) and `openai/<id>` (OpenAI's); else null. Goose and OpenCode call those providers directly. */
export function providerListRates(id) {
  const m = /^([a-z0-9_.-]+)\/(.+)$/i.exec(String(id || '').trim());
  if (!m) return null;
  const p = m[1].toLowerCase();
  if (p === 'anthropic') return listPriceFor(m[2]);
  if (p === 'openai') return openaiListRates(m[2]);
  return null;
}
