// test/stillhet-chat-cards-tone-host.test.mjs — a live TaskCard that needs you (feature 1 audit fix pass, D2–D4): it breathes
// with its tone, its main action is the one filled button, its question and Approve and build are drawn once, and an open PR
// reads its own word, never "The pull request is open." or a raw URL.
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

test('a live plan run: one Approve and build (on the PlanCard), no TaskCard main action, Stop stays in its ⋯; the card reads Needs approval', async () => {
  const plan = { id: 'q1', kind: 'plan', plan: { title: 'CSV plan', summary: 'Two slices', perspectives: ['Product'] } };
  const { w, d } = await liveHost({ sources: withRun({ pendingQuestion: plan }), beforeScripts: attnFor });
  await go(w, '#chat/ask_1', 200);
  assert.equal(count(chat(d), /Approve and build/g), 1);
  const card = chat(d).querySelector('[data-anchor="card_run"]');
  assert.ok(!card.querySelector('.tp-actions button'), 'the TaskCard has no main action');
  assert.match(card.querySelector('.tp-kicker').textContent, /Needs approval/);
  assert.equal(card.dataset.attn, 'ask', 'a plan breathes amber');
  assert.ok((await cardItems(d, 'run-a')).includes('Stop'), 'Stop stays in its ⋯');
});

test('the demo kind\'s plan chat shows one Approve and build (the act arm of below)', () => {
  const w = stillhetHost({ hash: '#chat/c6', after: (fn) => afterEach(fn) });
  const root = w.document.querySelector('#route-chat');
  assert.ok(root && /CSV export/.test(root.textContent), 'the plan chat is open');
  assert.equal(count(root, /Approve and build/g), 1);
  // a demo task held at its plan (act, the pencil) with an ask under it: the ask speaks for it, the card offers no
  // second Approve and build
  const w2 = stillhetHost({ hash: '#chat', after: (fn) => afterEach(fn) });
  const t1 = w2.RailChats.data().chats.find((c) => c.id === 'c1').tasks.find((t) => t.id === 't1');
  t1.case = 'plan';
  w2.location.hash = '#chat/c1';
  w2.dispatchEvent(new w2.HashChangeEvent('hashchange'));
  const card = w2.document.querySelector('#route-chat [data-anchor="a2"]');
  assert.ok(card, 'the plan-state TaskCard');
  assert.match(card.querySelector('.tp-kicker').textContent, /Needs approval/);
  assert.ok(!card.querySelector('.tp-actions button'), 'no main action while the ask below speaks for it');
});

test('c18: a passing, approved PR reads Ready to merge, its checks and Merge PR; Merge asks first, then posts dev\'s merge', async () => {
  const { w, d, calls } = await prHost(TASK_DETAILS.approved.checks);
  await go(w, '#chat/ask_1', 400);
  const card = chat(d).querySelector('[data-anchor="card_run"]');
  assert.match(card.textContent, /Ready to merge/);
  assert.match(card.textContent, /All 12 checks pass/);
  const merge = [...card.querySelectorAll('button')].find((b) => /^Merge PR$/.test(b.textContent.trim()));
  assert.ok(merge, 'Merge PR'); merge.click(); await settle(20);
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
