// test/stillhet-chat-cards-tone-host-3.test.mjs — a live TaskCard that needs you (feature 1 audit fix pass, D2–D4): it breathes
// with its tone, its main action is the one filled button, its question and Approve and build are drawn once, and an open PR
// reads its own word, never "The pull request is open." or a raw URL.
// Part 3 of 4: split so each file stays well under CI's 300 s per file.
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

test('c18: a passing, approved PR reads Ready to merge, its checks and Merge PR; Merge asks first, then posts dev\'s merge', async () => {
  const { w, d, calls } = await prHost(TASK_DETAILS.approved.checks);
  await go(w, '#chat/ask_1', 400);
  const card = chat(d).querySelector('[data-anchor="card_run"]');
  assert.match(card.textContent, /Ready to merge/);
  assert.match(card.textContent, /All 12 checks pass/);
  const merge = [...card.querySelectorAll('button')].find((b) => /^Merge PR$/.test(b.textContent.trim()));
  assert.ok(merge, 'Merge PR'); merge.click();
  for (let i = 0; i < 40 && !/Merge #\d+ into [^?]+\?/.test(chat(d).textContent); i++) await settle(50);   // a slow CI runner draws the confirm later
  assert.ok(!posts(calls).some(([, u]) => u === '/api/pr/merge'), 'nothing is posted before the confirm');
  assert.match(chat(d).textContent, /Merge #\d+ into [^?]+\?/);
  chat(d).querySelector('[data-card-yes]').click(); await settle(60);
  assert.ok(posts(calls).some(([, u]) => u === '/api/pr/merge'), 'dev\'s merge after the confirm');
});

test('every open-PR case reads its own word; none shows "The pull request is open." or a URL as text', async () => {
  const base = TASK_DETAILS.approved.checks;
  for (const [checks, kase] of [[{ ...base, checks: { ...base.checks, state: 'pending', pending: 2 }, mergeable: 'UNKNOWN' }, 'checks'], [{ ...base, checks: { ...base.checks, state: 'failing', failed: 2 } }, 'failing'], [{ ...base, mergeable: 'CONFLICTING' }, 'conflicts']]) {
    const word = C.needsReason(C.stateIds().includes(kase) ? kase : 'checks');
    const { w, d } = await prHost(checks);
    await go(w, '#chat/ask_1', 400);
    const text = chat(d).textContent;
    assert.ok(text.includes(word), `${kase}: ${word}`);
    assert.doesNotMatch(text, /The pull request is open\./);
    assert.doesNotMatch(text, /https:\/\//);
    closeHosts();
  }
});
