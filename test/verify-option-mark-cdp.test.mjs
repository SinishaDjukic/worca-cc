// The browser check of the pick-one option mark is a CDP script that needs Chrome, so it is not part of `npm test`.
// This needle test pins what the script proves, so a change that drops a tile user, a theme or a measurement fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../tools/verify-option-mark-cdp.mjs', import.meta.url);
const src = () => readFileSync(FILE, 'utf8');

test('the script opens one card of each of the five option tile users', () => {
  assert.ok(existsSync(FILE));
  const s = src();
  for (const user of ["'chat-question'", "'runs-clarify'", "'requirements-round'", "'shaper-role-rows'", "'design-sound'"]) {
    assert.ok(s.includes(`user: ${user}`), user);
  }
  assert.match(s, /\.chat-rc \.qpanel \.qopt/, 'the chat question card');
  assert.match(s, /post\('\/api\/run', /, 'a mock run waiting at Clarify');
  assert.match(s, /post\('\/api\/requirements', /);
  assert.match(s, /\.plan-decision button\.qopt/);
  assert.match(s, /\/sound\/ask`/);
});

test('both themes, each card before and after a pick: a 16px circle, an ink dot, the same row heights', () => {
  const s = src();
  assert.match(s, /const THEMES = \['light', 'dark'\];/);
  assert.match(s, /getComputedStyle\(t, '::before'\)/);
  assert.match(s, /m\.radius === '50%' && m\.width === '16px' && m\.height === '16px'/);
  assert.match(s, /m\.fill === m\.ink && m\.ring === m\.ink/);
  assert.match(s, /m\.fill === CLEAR/);
  assert.match(s, /t\.row === after\[i\]\.row/);
  assert.match(s, /-unpicked`\)/);
  assert.match(s, /-picked`\)/);
});

test('a hard cap, a free port and a sandboxed HOME', () => {
  const s = src();
  assert.match(s, /const CAP_MS = 30 \* 60 \* 1000;/);
  assert.doesNotMatch(s, /process\.env\.PORT\b/);
  assert.match(s, /'--remote-debugging-port=0'/);
  assert.match(s, /process\.env\.HOME = home/);
});
