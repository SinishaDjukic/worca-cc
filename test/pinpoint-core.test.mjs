// Pinpoint (#669): src/core/pinpoint.mjs — input validation, the prompts, the alternatives parser, and runPinpoint's
// no-tools spawn (an injected runner stands in for the Claude CLI).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validatePinpointInput, buildExplainPrompt, buildAlternativesPrompt, parseAlternatives, runPinpoint, PINPOINT_QUOTE_MAX,
  PINPOINT_CONTEXT_MAX, pinpointCwd,
} from '../src/core/pinpoint.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'pinpoint-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('validatePinpointInput', () => {
  assert.equal(validatePinpointInput(null).ok, false);
  assert.match(validatePinpointInput({ action: 'summarize', quote: 'x' }).error, /action/);
  assert.match(validatePinpointInput({ action: 'explain', quote: '  ' }).error, /quote is required/);
  assert.match(validatePinpointInput({ action: 'explain', quote: 'x'.repeat(PINPOINT_QUOTE_MAX + 1) }).error, /at most/);
  assert.match(validatePinpointInput({ action: 'explain', quote: 'x', context: 3 }).error, /context/);
  const v = validatePinpointInput({ action: 'alternatives', quote: ' q ', context: 'c'.repeat(PINPOINT_CONTEXT_MAX + 5), surface: 'evil', source: ' plan.md\n' });
  assert.equal(v.ok, true);
  assert.deepEqual({ ...v.value, context: v.value.context.length }, { action: 'alternatives', quote: 'q', context: PINPOINT_CONTEXT_MAX, surface: 'chat', source: 'plan.md' });
});

test('the prompts carry the span, its context and its source; the span is fenced as data', () => {
  const input = { quote: 'fails open', context: 'If Redis is down, the middleware fails open.', surface: 'artifact', source: 'plan.md' };
  const e = buildExplainPrompt(input);
  assert.match(e, /run artifact .*\(plan\.md\)/);
  assert.match(e, /## Context\n<<<\nIf Redis is down/);
  assert.match(e, /## Highlighted span\n<<<\nfails open\n>>>/);
  const a = buildAlternativesPrompt(input);
  assert.match(a, /"alternatives"/);
  assert.doesNotMatch(buildExplainPrompt({ ...input, context: 'fails open' }), /## Context/, 'no context block that only repeats the span');
});

test('parseAlternatives reads bare, fenced and wrapped JSON, and drops junk', () => {
  const one = { title: 'Fail closed', detail: 'Answer 503.', tradeoffs: [{ tone: 'bad', text: 'Outage spreads' }, { tone: '?', text: 'x' }] };
  assert.deepEqual(parseAlternatives(JSON.stringify({ alternatives: [one] })), [{ title: 'Fail closed', detail: 'Answer 503.', tradeoffs: [{ tone: 'bad', text: 'Outage spreads' }, { tone: 'warn', text: 'x' }] }]);
  assert.equal(parseAlternatives('```json\n' + JSON.stringify({ alternatives: [one, one, one, one] }) + '\n```').length, 3);
  assert.equal(parseAlternatives('Sure! ' + JSON.stringify({ alternatives: [one] }) + ' Hope that helps.').length, 1);
  assert.deepEqual(parseAlternatives('no json here'), []);
  assert.deepEqual(parseAlternatives(JSON.stringify({ alternatives: [{ detail: 'untitled' }] })), []);
});

/** A fake runClaude: records its options, plays `events` through onEvent, resolves with `text`. */
function fakeRun({ events = [], text = '' } = {}) {
  const calls = [];
  const run = async (o) => {
    calls.push(o);
    for (const e of events) o.onEvent(e);
    return { text };
  };
  return { run, calls };
}
const delta = (t) => ({ raw: { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } } });

test('runPinpoint explain: streams deltas, no tools, no MCP, scrubbed env', async () => {
  const { run, calls } = fakeRun({ events: [delta('It lets '), delta('requests through.')], text: 'It lets requests through.' });
  const got = [];
  const out = await runPinpoint({ action: 'explain', quote: 'fails open', context: '', surface: 'chat', source: '' }, { cwd: pinpointCwd(scratch), model: 'claude-haiku', run, onDelta: (t) => got.push(t) });
  assert.deepEqual(got, ['It lets ', 'requests through.']);
  assert.deepEqual(out, { text: 'It lets requests through.' });
  const o = calls[0];
  assert.deepEqual(o.tools, []);
  assert.deepEqual(o.allowedTools, []);
  assert.equal(o.strictMcpConfig, true);
  assert.equal(o.envScrub, true);
  assert.equal(o.disableSlashCommands, true);
  assert.equal(o.permissionMode, 'dontAsk');
  assert.equal(o.includePartialMessages, true);
  assert.equal(o.model, 'claude-haiku');
  assert.equal(o.cwd, join(scratch, 'tmp', 'pinpoint'));
});

test('runPinpoint explain without partial messages still answers once; an empty answer throws', async () => {
  const got = [];
  const { run } = fakeRun({ text: 'Whole answer.' });
  assert.deepEqual(await runPinpoint({ action: 'explain', quote: 'q' }, { cwd: pinpointCwd(scratch), run, onDelta: (t) => got.push(t) }), { text: 'Whole answer.' });
  assert.deepEqual(got, ['Whole answer.']);
  await assert.rejects(runPinpoint({ action: 'explain', quote: 'q' }, { cwd: pinpointCwd(scratch), run: fakeRun({ text: ' ' }).run }), /no answer/);
});

test('runPinpoint alternatives: parsed cards, no streaming; none parsed throws', async () => {
  const { run, calls } = fakeRun({ text: JSON.stringify({ alternatives: [{ title: 'Drop it', detail: 'Leave it out.', tradeoffs: [] }] }) });
  const out = await runPinpoint({ action: 'alternatives', quote: 'q' }, { cwd: pinpointCwd(scratch), run });
  assert.deepEqual(out, { alternatives: [{ title: 'Drop it', detail: 'Leave it out.', tradeoffs: [] }] });
  assert.equal(calls[0].includePartialMessages, false);
  await assert.rejects(runPinpoint({ action: 'alternatives', quote: 'q' }, { cwd: pinpointCwd(scratch), run: fakeRun({ text: 'nope' }).run }), /no alternatives/);
});
