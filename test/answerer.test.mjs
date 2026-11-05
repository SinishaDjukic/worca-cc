// test/answerer.test.mjs — the answerer profile's words (src/shared/answerer.mjs): code tokens out for a
// plain-register lead, the plain twin first, the fallback, and no change without a lead. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERER_LEADS, isAnswererLead, plainWords, wordsFor } from '../src/shared/answerer.mjs';

test('the leads and their register', () => {
  assert.deepEqual(Object.keys(ANSWERER_LEADS), ['product', 'architect', 'ux', 'qa', 'security', 'devops']);
  assert.equal(isAnswererLead('ux'), true);
  assert.equal(isAnswererLead('boss'), false);
  assert.equal(isAnswererLead('toString'), false);
});

test('plainWords drops scope tokens, backticks, snake_case and name() tokens; keeps times and URLs', () => {
  const out = plainWords('needs project:read and `--force`');
  assert.doesNotMatch(out, /project:read|`/);
  assert.equal(out, 'needs and');
  assert.equal(plainWords('meet at 10:30, see https://x.io'), 'meet at 10:30, see https://x.io');
  assert.equal(plainWords('call run_command or exportRuns() now'), 'call or now');
});

const OPTION = { value: 'members', label: 'Require project:read', plain: 'Anyone who can see the project' };
const NO_TWIN = { value: 'read', label: 'project:read' };

test('wordsFor with strip: the plain twin for product, the label for architect, Option n when too little is left', () => {
  assert.equal(wordsFor(OPTION, 'label', 'product', { strip: true, n: 1 }), 'Anyone who can see the project');
  assert.equal(wordsFor(OPTION, 'label', 'architect', { strip: true, n: 1 }), 'Require project:read');
  assert.equal(wordsFor(NO_TWIN, 'label', 'product', { strip: true, n: 2 }), 'Option 2');
  assert.equal(wordsFor({ text: '`project:read`?' }, 'text', 'ux', { strip: true }), 'This decision');
  assert.equal(wordsFor({ text: 'Gate the export on project:read' }, 'text', 'product', { strip: true }), 'Gate the export on');
});

test('wordsFor with no lead returns the entry\'s own words, backticks and plain twin alike', () => {
  const entry = { label: 'Use `--force`', plain: 'Force it' };
  assert.equal(wordsFor(entry, 'label', null), 'Use `--force`');
  assert.equal(wordsFor(entry, 'label', undefined, { strip: true }), 'Use `--force`');
  assert.equal(wordsFor(entry, 'label', 'product'), 'Force it', 'no strip: the twin, unstripped');
});
