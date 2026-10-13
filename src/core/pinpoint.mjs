// src/core/pinpoint.mjs
// Pinpoint (#669): the one-shot answers behind the selection toolbar's Explain and Alternatives. A selected span (and
// the text around it) goes to a no-tools Claude call: Explain streams a short plain answer, Alternatives returns 2–3
// option cards as JSON. Nothing is stored; the "Go deeper in chat" path is an ordinary Ask turn.
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { runClaude } from './claude-runner.mjs';
import { normalizingOnEvent } from './engines/claude-events.mjs';
import { resolveModelEnv } from './config.mjs';
import { safeParseJson } from './protocol.mjs';
import { AUX_EFFORT } from './model-env.mjs';

export const PINPOINT_QUOTE_MAX = 4000;
export const PINPOINT_CONTEXT_MAX = 12000;
export const PINPOINT_SOURCE_MAX = 200;
export const PINPOINT_ACTIONS = Object.freeze(['explain', 'alternatives']);
const SURFACES = new Set(['chat', 'artifact', 'diff']);

const SURFACE_WORDS = {
  chat: 'an assistant answer in a chat about software runs',
  artifact: 'a run artifact written by a coding agent (a plan or a review)',
  diff: 'a code diff produced by a coding agent',
};

export const EXPLAIN_SYSTEM_PROMPT =
  'You explain one highlighted span of text to a busy software engineer. Answer in 2-4 short sentences of plain prose ' +
  '(inline `code` is fine; no headings, no lists, no preamble, no restating the question). Explain what the span means ' +
  'in its context and why it matters there. If the context does not say, say what it most likely means and that it ' +
  'is a guess.';

export const ALTERNATIVES_SYSTEM_PROMPT =
  'You propose alternatives to one highlighted span of a plan, answer or code change. Output ONLY a JSON object, ' +
  'nothing else.';

/**
 * Validate a request body. → { ok:true, value:{action, quote, context, surface, source} } | { ok:false, error }.
 */
export function validatePinpointInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!PINPOINT_ACTIONS.includes(b.action)) return { ok: false, error: `action must be one of ${PINPOINT_ACTIONS.join(', ')}` };
  if (typeof b.quote !== 'string' || !b.quote.trim()) return { ok: false, error: 'quote is required' };
  if (b.quote.length > PINPOINT_QUOTE_MAX) return { ok: false, error: `quote must be at most ${PINPOINT_QUOTE_MAX} characters` };
  if (b.context != null && typeof b.context !== 'string') return { ok: false, error: 'context must be a string' };
  if (b.source != null && typeof b.source !== 'string') return { ok: false, error: 'source must be a string' };
  const surface = SURFACES.has(b.surface) ? b.surface : 'chat';
  return {
    ok: true,
    value: {
      action: b.action,
      quote: b.quote.trim(),
      context: String(b.context ?? '').slice(0, PINPOINT_CONTEXT_MAX),
      surface,
      source: String(b.source ?? '').replace(/\s+/g, ' ').trim().slice(0, PINPOINT_SOURCE_MAX),
    },
  };
}

function framing({ quote, context, surface, source }) {
  return [
    `The text comes from ${SURFACE_WORDS[surface]}${source ? ` (${source})` : ''}.`,
    '',
    ...(context && context !== quote ? ['## Context', '<<<', context, '>>>', ''] : []),
    '## Highlighted span',
    '<<<',
    quote,
    '>>>',
  ].join('\n');
}

export function buildExplainPrompt(input) {
  return `${framing(input)}\n\nExplain the highlighted span.`;
}

export function buildAlternativesPrompt(input) {
  return [
    framing(input),
    '',
    'Propose 3 concrete alternatives to what the highlighted span says or does. Each alternative changes only that',
    'part. Give each a short title (at most 6 words), a one-sentence detail saying what would change, and 1-3',
    'tradeoffs of at most 4 words each, tagged ok (a benefit), warn (a cost) or bad (a real risk).',
    '',
    'Return ONLY this JSON object:',
    '{ "alternatives": [ { "title": "...", "detail": "...", "tradeoffs": [ { "tone": "ok|warn|bad", "text": "..." } ] } ] }',
  ].join('\n');
}

const TONES = new Set(['ok', 'warn', 'bad']);

/** The model's JSON (possibly fenced or with prose around it) → 1–3 clean alternatives. */
export function parseAlternatives(text) {
  let parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object') {
    const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
    parsed = m ? safeParseJson(m[0]) : null;
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.alternatives) ? parsed.alternatives : []);
  const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return list.map((a) => ({
    title: clean(a && a.title, 120),
    detail: clean(a && a.detail, 600),
    tradeoffs: (Array.isArray(a && a.tradeoffs) ? a.tradeoffs : [])
      .map((t) => ({ tone: TONES.has(t && t.tone) ? t.tone : 'warn', text: clean(t && t.text, 60) }))
      .filter((t) => t.text).slice(0, 3),
  })).filter((a) => a.title).slice(0, 3);
}

/**
 * Run one Pinpoint call. Explain streams its text through `onDelta` (and resolves with the full text); Alternatives
 * resolves with the parsed cards. No tools, no MCP servers, no slash commands, a scrubbed env — the span is data,
 * never instructions the call could act on. Throws when the call fails or yields nothing.
 * @param {{action:string, quote:string, context?:string, surface?:string, source?:string}} input  validated
 * @param {{cwd:string, model?:string, signal?:AbortSignal, onDelta?:(t:string)=>void, run?:Function}} opts
 */
export async function runPinpoint(input, { cwd, model, signal, onDelta = () => {}, run = runClaude } = {}) {
  await mkdir(cwd, { recursive: true });
  const explain = input.action === 'explain';
  let streamed = '';
  const { text } = await run({
    cwd,
    systemPrompt: explain ? EXPLAIN_SYSTEM_PROMPT : ALTERNATIVES_SYSTEM_PROMPT,
    prompt: explain ? buildExplainPrompt(input) : buildAlternativesPrompt(input),
    model: model || undefined,
    modelEnv: resolveModelEnv(model || undefined),
    effort: AUX_EFFORT,
    allowedTools: [],
    tools: [],
    strictMcpConfig: true,
    settingSources: ['project'],
    disableSlashCommands: true,
    envScrub: true,
    envAllowlist: [],
    permissionMode: 'dontAsk',
    includePartialMessages: explain,
    spawnKind: 'aux',
    signal,
    onEvent: normalizingOnEvent((e) => {
      if (!explain || e.type !== 'text' || !e.delta || e.from !== 'assistant' || typeof e.text !== 'string') return;
      streamed += e.text;
      onDelta(e.text);
    }),
  });
  const full = String(text ?? '').trim();
  if (explain) {
    // A run that streamed nothing (an engine without partial messages) still answers: the final text in one piece.
    if (!streamed && full) onDelta(full);
    const out = (streamed || full).trim();
    if (!out) throw new Error('no answer');
    return { text: out };
  }
  const alternatives = parseAlternatives(full);
  if (!alternatives.length) throw new Error('no alternatives');
  return { alternatives };
}

/** Where the calls run: an empty scratch dir under WORCA_HOME, never a project. */
export const pinpointCwd = (home) => join(home, 'tmp', 'pinpoint');
