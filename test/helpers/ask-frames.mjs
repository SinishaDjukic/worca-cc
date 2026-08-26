// test/helpers/ask-frames.mjs — build realistic ask-* frame streams for UI tests.
//
// The committed fixtures (test/fixtures/ask/*.jsonl) are RAW claude stream-json
// frames, not ask-* frames (spec §17 "P3 FIXTURE FRAMES"). Replaying one through
// createTurnReducer yields the BARE job frames the reducer emits (ask-label /
// ask-delta / ask-block / ask-usage, + ask-card via onProposal); turn.mjs owns
// ask-start / ask-done / ask-error and the server stamps {threadId, messageId,
// seq}. This helper reproduces both sides so a UI test gets exactly what the
// panel would see on the wire. Hand-authored arrays through stampFrames() are
// the right tool for card flips, ask-error, out-of-turn frames and gap
// sequences — the "never hand-write fixtures" rule covers the captured CLI
// files, not test frame arrays.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTurnReducer } from '../../src/core/ask/events.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/ask/', import.meta.url));

export function stampFrames(bare, { threadId, messageId, seqStart = 1 } = {}) {
  let seq = seqStart;
  return bare.map((f) => ({ ...f, threadId, messageId, seq: seq++ }));
}

export function replayFixture(name, {
  threadId = 'ask_11111111',
  messageId = 'askm_00000001',
  userMessageId = 'askm_u0000001',
  model = 'claude-haiku-4-5',
  effort = 'high',
  threadTotals = null,
  card = null,
  cardId = 'card_00000001',
} = {}) {
  const lines = readFileSync(`${FIXTURE_DIR}${name}.jsonl`, 'utf8').split('\n').filter(Boolean);
  const raws = lines.map((l) => JSON.parse(l));
  const bare = [];
  const reducer = createTurnReducer({
    onFrame: (f) => bare.push(f),
    // turn.mjs's proposal hook validates then addBlock()s the card; the helper
    // mirrors the success path when the caller supplies a card payload.
    onProposal: () => {
      if (card) reducer.addBlock({ kind: 'card', id: cardId, state: 'proposed', card });
      return null;
    },
    setTimeout: (fn) => (fn(), 1),
    clearTimeout() {},
  });
  const init = raws.find((f) => f.type === 'system' && f.subtype === 'init');
  if (init) reducer.push({ type: 'session', sessionId: init.session_id });
  for (const raw of raws) reducer.push({ type: raw.type, raw }); // envelope, never bare — the replay-code precedent at ask-events-fixtures.test.mjs:25-26
  reducer.flush();
  // turn.mjs adds the limit notice BEFORE finish() (turn.mjs:211-217, defaults 40 / $2).
  const sub = reducer.snapshot().resultSubtype || '';
  if (/error_max_budget/.test(sub)) {
    reducer.addBlock({ kind: 'notice', text: 'Stopped: reached the $2 per-turn cap (Settings → Ask Worca)' });
  } else if (/error_max_turns/.test(sub)) {
    reducer.addBlock({ kind: 'notice', text: 'Stopped: reached the 40-turn limit (Settings → Ask Worca)' });
  }
  const summary = reducer.finish();
  const start = { type: 'ask-start', userMessageId, model, effort, startedAt: '2026-08-23T00:00:00.000Z' };
  const done = {
    type: 'ask-done',
    text: summary.text,
    blocks: summary.blocks,
    usage: summary.usage,
    costUsd: summary.costUsd,
    durationMs: summary.durationMs ?? 0,
    model,
    status: summary.status,
    ...(summary.reason ? { reason: summary.reason } : {}),
    threadTotals,
  };
  return { frames: stampFrames([start, ...bare, done], { threadId, messageId }), summary };
}
