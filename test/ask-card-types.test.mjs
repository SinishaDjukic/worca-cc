// test/ask-card-types.test.mjs — every `type: '…'` literal in dev's chat card sources is a card type (ASK_CARD_TYPES) or a
// listed non-card (a frame, a JSON-schema or MCP type), so a new card type is neither missed nor confused with a frame (D4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ASK_CARD_TYPES } from '../src/shared/ask-card-types.mjs';

const NOT_CARD_TYPES = Object.freeze({
  object: 'a JSON-schema type in a tool definition', array: 'a JSON-schema type', string: 'a JSON-schema type',
  integer: 'a JSON-schema type', boolean: 'a JSON-schema type',
  text: 'an MCP content part', image: 'an MCP content part', resource: 'an MCP content part', stdio: 'an MCP server transport',
  void: 'a workflow port type (script ports)', until: 'a schedule end rule', count: 'a schedule end rule',
  result: "an engine reducer event (turn.mjs)", meta: 'a script approval detail row',
  plugin: "a run proposal's task source (card.source, source-spec.mjs), not a card of its own",
  'round-changed': 'a WS frame', 'ask-title': 'a WS frame', 'ask-suggestion': 'a WS frame', 'ask-start': 'a WS frame',
  'ask-error': 'a WS frame', 'ask-done': 'a WS frame', 'ask-command-summary': 'a WS frame',
  'ask-message': 'a WS frame (cross-chat messages, chat-messages.mjs)',
});
const LITERAL = /\btype:\s*'([a-z][a-z0-9-]*)'/g;
/** The literals of `src` that are neither cards nor listed non-cards. */
const unclassified = (src) => [...new Set([...src.matchAll(LITERAL)].map((m) => m[1]))].filter((t) => !ASK_CARD_TYPES.includes(t) && !(t in NOT_CARD_TYPES));

const sources = () => {
  const dir = 'src/core/ask';
  return [['ui/routes/chat/thread-cards.mjs', readFileSync('ui/routes/chat/thread-cards.mjs', 'utf8')],
    ...readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => [join(dir, f), readFileSync(join(dir, f), 'utf8')])];
};

test('every type literal of thread-cards.mjs and src/core/ask/ is a card type or a listed non-card', () => {
  for (const [file, src] of sources()) assert.deepEqual(unclassified(src), [], file);
});

test('an unclassified literal fails; the two lists never overlap', () => {
  assert.deepEqual(unclassified("const card = { type: 'brand-new-card', x: 1 };"), ['brand-new-card']);
  assert.deepEqual(ASK_CARD_TYPES.filter((t) => t in NOT_CARD_TYPES), []);
  assert.ok(Object.isFrozen(ASK_CARD_TYPES));
});
