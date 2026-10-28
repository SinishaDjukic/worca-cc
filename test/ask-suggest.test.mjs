import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeSuggestion, suggestionModel, suggestionPrompt, generateSuggestion,
  claimSuggestion, releaseSuggestion, cancelSuggestion, CODEX_SUGGESTION_MODEL,
} from '../src/core/ask/suggest.mjs';

// Never the developer's real binary: every call below goes through the `run` seam.
const offline = { bin: '/nonexistent/claude-must-not-spawn', mock: false };

test('sanitizeSuggestion: one short line; labels, quotes, trailing dots and refusals go', () => {
  assert.equal(sanitizeSuggestion('Start the run.'), 'Start the run');
  assert.equal(sanitizeSuggestion('"Open a PR"\nextra'), 'Open a PR');
  assert.equal(sanitizeSuggestion('Suggestion: Show the failing test'), 'Show the failing test');
  assert.equal(sanitizeSuggestion('What failed in the last run?'), 'What failed in the last run?', 'a question to Ask is a valid next prompt');
  assert.equal(sanitizeSuggestion('NONE'), '');
  assert.equal(sanitizeSuggestion("I'm not sure what you want next"), '');
  assert.equal(sanitizeSuggestion('one two three four five six seven eight nine ten eleven twelve thirteen'), '');
  assert.equal(sanitizeSuggestion(''), '');
});

test('suggestionModel: Haiku on Claude only while catalogued and ready; the small model on Codex', () => {
  assert.equal(suggestionModel('claude', { inCatalog: () => true, ready: () => true }), 'claude-haiku-4-5');
  assert.equal(suggestionModel('claude', { inCatalog: () => false, ready: () => true }), null);
  assert.equal(suggestionModel('claude', { inCatalog: () => true, ready: () => false }), null);
  assert.equal(suggestionModel('codex'), CODEX_SUGGESTION_MODEL);
});

test('generateSuggestion: hardened aux call, sanitized, never throws', async () => {
  const seen = [];
  const run = async (o) => { seen.push(o); return { text: 'Open a PR.' }; };
  const s = await generateSuggestion({ userText: 'summarize the diff', replyText: 'The diff adds X.' },
    { ...offline, run, model: 'claude-haiku-4-5', cwd: '/tmp', tools: [], permissionMode: 'dontAsk' });
  assert.equal(s, 'Open a PR');
  assert.equal(seen[0].model, 'claude-haiku-4-5');
  assert.equal(seen[0].permissionMode, 'dontAsk');
  assert.match(seen[0].prompt, /summarize the diff[\s\S]*The diff adds X\./);
  const errors = [];
  assert.equal(await generateSuggestion({ userText: 'a', replyText: 'b' }, { ...offline, run: async () => { throw new Error('down'); }, model: 'm', onError: (e) => errors.push(e) }), '');
  assert.equal(errors.length, 1);
  assert.equal(await generateSuggestion({ userText: 'a', replyText: '' }, { ...offline, run, model: 'm' }), '', 'no reply, no call');
  assert.equal(await generateSuggestion({ userText: 'a', replyText: 'b' }, { ...offline, run, model: null }), '', 'no model, no call');
  assert.equal(seen.length, 1);
});

test('claim/cancel: a newer claim or a cancel aborts the older call; release only frees its own slot', () => {
  const a = claimSuggestion('t1');
  const b = claimSuggestion('t1');
  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, false);
  releaseSuggestion('t1', a);              // stale release: b keeps the slot
  cancelSuggestion('t1');
  assert.equal(b.signal.aborted, true);
});

test('suggestionPrompt keeps the reply tail', () => {
  const p = suggestionPrompt('u', `${'x'.repeat(5000)}END`);
  assert.match(p, /END/);
});
