// test/demo-scenario.test.mjs — the demo-video scenario: inert without WORCA_DEMO_SCENARIO, first-match, titles, chunks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoAskReply, demoPinpointReply, demoChunks, loadDemoScenario, TITLE_PROMPT_PREFIX } from '../src/core/demo-scenario.mjs';

const dir = mkdtempSync(join(tmpdir(), 'demo-sc-'));
const file = join(dir, 's.json');
writeFileSync(file, JSON.stringify({ chunkMs: 40,
  ask: [{ match: 'fix first', title: 'Pricing page review', answer: 'Three things stand out.', costUsd: 0.04 }, { match: 'fix', answer: 'later' }],
  pinpoint: [{ match: '$348', explain: '$348 is 12 × $29: no discount.' }] }));
const env = { WORCA_DEMO_SCENARIO: file };

test('inert without the env var', () => {
  assert.equal(loadDemoScenario({}), null);
  assert.equal(demoAskReply('What would you fix first?', {}), null);
  assert.equal(demoPinpointReply('$348', {}), null);
});
test('a missing or malformed file is inert, never a throw', () => {
  assert.equal(loadDemoScenario({ WORCA_DEMO_SCENARIO: join(dir, 'nope.json') }), null);
});
test('Ask: first matching entry on the typed first line, case-insensitive', () => {
  const r = demoAskReply('What would you FIX FIRST on this page?\n\n```attachment a1 page-text.md\nfix\n```', env);
  assert.equal(r.answer, 'Three things stand out.');
  assert.equal(r.chunkMs, 40);
  assert.equal(demoAskReply('hello there', env), null);
});
test('the title prompt gets the entry title', () => {
  assert.deepEqual(demoAskReply(`${TITLE_PROMPT_PREFIX}\n\nWhat would you fix first on this page?`, env), { title: 'Pricing page review' });
});
test('Pinpoint matches the quote; chunks rejoin to the text', () => {
  assert.match(demoPinpointReply('Billed $348 per year', env).explain, /no discount/);
  assert.equal(demoChunks('a b c d e f g').join(''), 'a b c d e f g');
});
test.after(() => rmSync(dir, { recursive: true, force: true }));
