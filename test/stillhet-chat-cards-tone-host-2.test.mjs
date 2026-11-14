// test/stillhet-chat-cards-tone-host-2.test.mjs — a live TaskCard that needs you (feature 1 audit fix pass, D2–D4): it breathes
// with its tone, its main action is the one filled button, its question and Approve and build are drawn once, and an open PR
// reads its own word, never "The pull request is open." or a raw URL.
// Part 2 of 4: split so each file stays well under CI's 300 s per file.
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

test('the demo kind\'s plan chat shows one Approve and build (the act arm of below)', (t) => {
  const w = stillhetHost({ hash: '#chat/c6', after: (fn) => t.after(fn) });
  const root = w.document.querySelector('#route-chat');
  assert.ok(root && /CSV export/.test(root.textContent), 'the plan chat is open');
  assert.equal(count(root, /Approve and build/g), 1);
  // a demo task held at its plan (act, the pencil) with an ask under it: the ask speaks for it, the card offers no
  // second Approve and build
  const w2 = stillhetHost({ hash: '#chat', after: (fn) => t.after(fn) });
  const t1 = w2.RailChats.data().chats.find((c) => c.id === 'c1').tasks.find((t) => t.id === 't1');
  t1.case = 'plan';
  w2.location.hash = '#chat/c1';
  w2.dispatchEvent(new w2.HashChangeEvent('hashchange'));
  const card = w2.document.querySelector('#route-chat [data-anchor="a2"]');
  assert.ok(card, 'the plan-state TaskCard');
  assert.match(card.querySelector('.tp-kicker').textContent, /Needs approval/);
  assert.ok(!card.querySelector('.tp-actions button'), 'no main action while the ask below speaks for it');
});
