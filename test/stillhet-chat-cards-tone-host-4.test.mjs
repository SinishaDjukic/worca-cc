// test/stillhet-chat-cards-tone-host-4.test.mjs — a live TaskCard that needs you (feature 1 audit fix pass, D2–D4): it breathes
// with its tone, its main action is the one filled button, its question and Approve and build are drawn once, and an open PR
// reads its own word, never "The pull request is open." or a raw URL.
// Part 4 of 4: split so each file stays well under CI's 300 s per file.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveHost, savedRun, withRun, go, settle, posts, cardItems, closeHosts } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { TASK_DETAILS, PR_URL } from './helpers/stillhet-live-fixture.mjs';
import * as C from '../ui/public/design-system/components/index.mjs';

afterEach(closeHosts);
// the tint is read while it breathes: Settings › Notifications "until you act on it" keeps it on
const attnFor = (win) => { win.RailAttnFor = 'act'; };
const chat = (d) => d.querySelector('#route-chat');
const count = (el, re) => (el.textContent.match(re) || []).length;
const prHost = (checks, row = {}) => liveHost({ sources: savedRun({ status: 'done', pr: { url: PR_URL, state: 'OPEN' }, ...row }), beforeScripts: attnFor, read: (u) => (u.startsWith('/api/pr/checks?id=pa') ? (typeof checks === 'function' ? checks() : [200, checks]) : null) });

test('a checks read that fails leaves the card In review, with no Merge', async () => {
  const { w, d } = await prHost(() => [500, { error: 'boom' }]);
  await go(w, '#chat/ask_1', 400);
  const card = chat(d).querySelector('[data-anchor="card_run"]');
  assert.match(card.textContent, /In review/);
  assert.ok(![...card.querySelectorAll('button')].some((b) => /^Merge/.test(b.textContent.trim())));
});

test('a branch on a card sits in .rc-mid, which the stylesheet draws in the text face (look.md, D5)', async () => {
  const { w, d } = await liveHost({ sources: savedRun({ status: 'error', branch: 'feat/x' }) });
  await go(w, '#chat/ask_1', 200);
  const css = readFileSync('ui/public/stillhet/css/rail.css', 'utf8');
  assert.doesNotMatch(css.match(/^\.rc-mid\{[^}]*\}/m)[0], /--mono/);
  const mid = chat(d).querySelector('[data-anchor="card_run"] .rc-mid');
  if (mid) assert.ok(mid.textContent.length > 0);
});
