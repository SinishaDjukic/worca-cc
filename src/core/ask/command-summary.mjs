// src/core/ask/command-summary.mjs — Command summaries (#911 slice 2, flag commandSummaries): the Models › Helper jobs
// job that writes a chat command's one-line summary when the chat gave none. It sees the command alone, secrets
// redacted (redactAskText, the card's own redaction), never the output. Repeats are cached by the redacted command.
import { auxTextCall, isRefusalTitle } from '../title.mjs';
import { redactAskText } from './redact.mjs';
import { cleanCommandSummary } from './commands.mjs';
import { ASK_LIMITS } from './limits.mjs';

export const COMMAND_SUMMARY_SYSTEM = [
  'You describe one shell command for a chat transcript.',
  'Reply with ONE line and nothing else: what the command does in 3-10 words, starting with an -ing verb',
  '(for example "Syncing the latest code from dev"), no quotes, no trailing period.',
  'You see only the command, never its output. Never run anything, never ask questions, never add commentary.',
].join(' ');

const PROMPT_MAX = 2000;
const CACHE_MAX = 500;
const PICK_TTL_MS = 60_000;
const MAX_IN_FLIGHT = 4;

/** The command as the model may see it: secrets replaced by the chat's redaction marker. */
export const redactCommand = (command) => redactAskText(String(command ?? '')).trim();

/** The whole request: the system rule and the redacted command. Nothing else is ever added. */
export function buildSummaryPrompt(redacted) {
  return { systemPrompt: COMMAND_SUMMARY_SYSTEM, prompt: `Command:\n${String(redacted).slice(0, PROMPT_MAX)}` };
}

/** The model's reply → one clean line, or null for empty / refusal / question. */
export function parseSummary(raw, max = ASK_LIMITS.commandSummaryMaxChars) {
  const first = String(raw || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const line = first.replace(/^["'`“]+|["'`”]+$/g, '').replace(/\.+$/, '').trim();
  if (!line || isRefusalTitle(line)) return null;
  return cleanCommandSummary(line, max);
}

/** The job's gate (pure, so each input is tested): the Labs flag on, the person's switch not off, no mock, the cost limit not reached. */
export function commandSummariesWanted({ flag, summariseCommands, mock, blocked } = {}) {
  return flag === true && summariseCommands !== false && !mock && !blocked;
}

/**
 * @param {object} o
 * @param {() => Promise<{model:string|null, effort:string|null}|null>} o.pickModel  resolveNamingModel over the catalog
 * @param {Function} [o.run]      the spawn (auxTextCall's opts.run; tests inject it)
 * @param {Function} [o.onCost]   the cost sink ({ costUsd, usage, model })
 * @returns {{ summarise(command:string, opts?:{signal?:AbortSignal}): Promise<string|null>, size(): number }}
 */
export function createCommandSummariser({ pickModel, run, onCost, now = Date.now, cacheMax = CACHE_MAX, maxInFlight = MAX_IN_FLIGHT } = {}) {
  const cache = new Map();          // redacted command → string (answered) | Promise<string|null> (in flight)
  let picked = null;
  let pickedAt = -Infinity;
  let inFlight = 0;
  const remember = (key, value) => {
    cache.delete(key); cache.set(key, value);
    if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
  };
  async function pick() {
    if (now() - pickedAt > PICK_TTL_MS) { picked = await pickModel(); pickedAt = now(); }
    return picked;
  }
  async function summarise(command, { signal } = {}) {
    const key = redactCommand(command);
    if (!key) return null;
    if (cache.has(key)) {                                   // a hit, or the same command still in flight: one call
      const hit = cache.get(key);
      if (typeof hit === 'string') remember(key, hit);
      return hit;
    }
    if (inFlight >= maxInFlight) return null;               // a burst beyond the cap keeps its raw commands
    inFlight += 1;
    const job = (async () => {
      const chosen = await pick();
      if (!chosen || !chosen.model) return null;            // no ready Claude model: the row keeps the raw command
      const out = await auxTextCall({ ...buildSummaryPrompt(key), model: chosen.model },
        { run, onCost, signal, effortOverride: chosen.effort || undefined });
      return parseSummary(out);
    })().catch(() => null).finally(() => { inFlight -= 1; });
    cache.set(key, job);
    const summary = await job;
    if (summary) remember(key, summary); else cache.delete(key);   // a miss is never cached
    return summary;
  }
  return { summarise, size: () => cache.size };
}

/** The server's side, per command card: gate → summarise → patch the stored card → tell the open chat. Never throws. */
export async function summariseCommandCard({ threadId, cardId, blockId, command }, { enabled, summariser, flipCard, broadcast }) {
  try {
    if (!enabled()) return null;
    const summary = await summariser.summarise(command);
    if (!summary || !enabled()) return null;                // a switch turned off mid-call writes nothing
    if (!flipCard(threadId, cardId, { card: { summary } })) return null;
    broadcast({ type: 'ask-command-summary', threadId, blockId, summary });
    return summary;
  } catch { return null; }
}
