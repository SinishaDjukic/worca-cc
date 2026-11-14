// test/stillhet-chat-cards-tone-host-1.test.mjs — a live TaskCard that needs you (feature 1 audit fix pass, D2–D4): it breathes
// with its tone, its main action is the one filled button, its question and Approve and build are drawn once, and an open PR
// reads its own word, never "The pull request is open." or a raw URL.
// Part 1 of 4: split so each file stays well under CI's 300 s per file.
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

test('a failed saved run: its card breathes red and Retry is the filled button', async () => {
  const { w, d } = await liveHost({ sources: savedRun({ status: 'error' }), beforeScripts: attnFor });
  await go(w, '#chat/ask_1', 200);
  const card = chat(d).querySelector('[data-anchor="card_run"]');
  assert.ok(card.classList.contains('is-attn'), 'the failed card is tinted');
  assert.equal(card.dataset.attn, 'fail');
  const main = card.querySelector('.tp-actions .btn-primary');
  assert.ok(main, 'its main action is filled'); assert.match(main.textContent, /Retry/);
  assert.equal(chat(d).querySelectorAll('.is-attn').length, 1);
});

test('a question run: the card breathes amber, one tinted turn, one filled button; the question is drawn once, in its OptionList', async () => {
  const { w, d } = await liveHost({ beforeScripts: attnFor });
  await go(w, '#chat/ask_1', 200);
  const card = chat(d).querySelector('[data-anchor="card_run"]');
  assert.ok(card.classList.contains('is-attn')); assert.equal(card.dataset.attn, 'ask');
  assert.equal(chat(d).querySelectorAll('.is-attn').length, 1);
  assert.equal(chat(d).querySelectorAll('.convo-scroll .btn-primary, [data-anchor] .btn-primary').length <= 1, true, 'calmCards leaves one filled button');
  const why = card.querySelector('.tp-why');
  assert.equal(why ? count(why, /Which format\?/g) : 0, 0, 'the status line never repeats the question');
  assert.ok(!card.querySelector('.tp-actions button'), 'no TaskCard main action while the question speaks for it');
  assert.equal(count(chat(d), /Which format\?/g), 1, 'once, over its OptionList');
});
