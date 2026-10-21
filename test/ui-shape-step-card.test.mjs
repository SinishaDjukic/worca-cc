// test/ui-shape-step-card.test.mjs — the one chrome every Shaper step card shares (shaper-cards D2–D4, D12, D13, D15):
// kind chips, titles, the gate and recovery cards that bind their own buttons, and stepSender's failure rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SEND_FAILED, stepChip, stepTitle, stepKind, isStepCard, stepSender, stepHead, renderGateCard, renderRecoveryCard, questionFocusTarget }
  from '../ui/public/shape/step-card.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));

const PLAN = { id: 'p1', kind: 'plan', plan: { round: 1 } };
const SPLIT = { id: 'o1', kind: 'plan', plan: { round: 1, outline: { why: '', slices: [] } } };
const GATE = { id: 'g1', kind: 'gate', issues: [{ severity: 'major', title: 'Flaky test', detail: 'retries', location: 'a.mjs:3' }] };
const recovery = (options) => ({ id: 'r1', kind: 'recovery', recovery: { cls: 'auth', message: 'token expired', options } });
const CLARIFY = { id: 'c1', kind: 'questions', questions: [] };
const SHAPING = { shaping: { rounds: [] } };

test('stepChip: Plan · run k once the run belongs to a split feature, else the kind\'s chip', () => {
  assert.equal(stepChip(PLAN, { shaping: { feature: { id: 'f', index: 2, total: 3 } } }), 'Plan · run 2');
  assert.equal(stepChip(PLAN, { shaping: { feature: { id: 'f', index: 1, total: 3 } } }), 'Plan · run 1');
  assert.equal(stepChip(PLAN, SHAPING), 'Plan');
  assert.equal(stepChip(PLAN, null), 'Plan');
  assert.equal(stepChip(SPLIT, { shaping: { feature: { id: 'f', index: 1, total: 3 } } }), 'Runs');
  assert.equal(stepChip(GATE, {}), 'Gate');
  assert.equal(stepChip(recovery([]), {}), 'Recovery');
  assert.equal(stepChip(CLARIFY, SHAPING), 'Clarify');
});

test('stepTitle and stepKind name each step', () => {
  assert.equal(stepKind(SPLIT), 'outline');
  assert.equal(stepKind(PLAN), 'plan');
  assert.equal(stepTitle(CLARIFY), 'A few questions before the plan');
  assert.equal(stepTitle(PLAN), 'Your turn: approve the plan');
  assert.equal(stepTitle(SPLIT), 'Your turn: approve the runs');
  assert.equal(stepTitle(GATE, 'Review'), 'Review needs a decision');
  assert.equal(stepTitle(GATE), 'A decision is needed');
  assert.equal(stepTitle(recovery([]), 'Build'), 'Build failed');
  assert.equal(stepTitle(recovery([])), 'A step failed');
  assert.equal(stepTitle({ id: 'f', kind: 'form' }), '');
});

test('isStepCard: plan, gate and recovery always; Clarify only for a shaping run with the gate on', () => {
  assert.equal(isStepCard(PLAN, {}, false), true);
  assert.equal(isStepCard(GATE, {}, false), true);
  assert.equal(isStepCard(recovery([]), {}, false), true);
  assert.equal(isStepCard(CLARIFY, SHAPING, true), true);
  assert.equal(isStepCard(CLARIFY, SHAPING, false), false);
  assert.equal(isStepCard(CLARIFY, {}, true), false, 'a non-shaping Clarify');
  assert.equal(isStepCard({ id: 'f', kind: 'form' }, SHAPING, true), false);
});

test('stepHead: the metrics card head, title + kind chip', () => {
  const head = stepHead(doc, 'Your turn: approve the plan', 'Plan');
  assert.ok(head.classList.contains('ask-mcard-head'));
  assert.equal(head.querySelector('.ask-mcard-title').textContent, 'Your turn: approve the plan');
  assert.equal(head.querySelector('.ask-mcard-kind').textContent, 'Plan');
});

function mount(render, pq, submit = async () => true) {
  const parent = doc.createElement('div');
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  parent.appendChild(panel);
  doc.body.appendChild(parent);
  const posts = [];
  const parentClicks = [];
  parent.addEventListener('click', () => parentClicks.push(1));
  render(panel, pq, { doc, title: 'Review needs a decision', chip: 'Gate', wireCopy: ' on A → B (w1)', tagLevel: (el, l) => { el.dataset.minLevel = l; },
    submit: (p) => { posts.push(p); return submit(p); } });
  return { panel, posts, parentClicks, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}

test('the gate card: head, intro twins, issues, and its own Accept as is / Run another cycle (A14)', async () => {
  const { $, $$, posts, parentClicks } = mount(renderGateCard, GATE);
  assert.equal($('.ask-mcard-kind').textContent, 'Gate');
  assert.equal($('.ask-mcard-title').textContent, 'Review needs a decision');
  assert.match($$('.gate-intro')[0].textContent, /reached its limit on A → B \(w1\) with open issues/);
  assert.equal($$('.gate-intro')[0].dataset.minLevel, 'advanced');
  assert.equal($$('.gate-intro')[1].dataset.maxLevel, 'simple');
  assert.equal($$('.issues .issue.sev-major').length, 1);
  assert.equal($('.issue-loc').textContent, 'a.mjs:3');
  assert.deepEqual($$('.qpanel-foot button').map((b) => b.textContent), ['Accept as is', 'Run another cycle']);
  assert.ok($('.gate-continue').classList.contains('btn-quiet'));
  assert.ok($('.gate-another').classList.contains('btn-primary'));
  assert.equal($$('.qpanel-foot').length, 1, 'the Simple-mode twin reads the same two buttons');
  assert.match($$('.gate-intro')[0].textContent, /Run another cycle to keep iterating, or accept the result as is\./);
  $('.gate-continue').click();
  await flush();
  $('.gate-another').click();
  await flush();
  assert.deepEqual(posts, [{ decision: 'continue' }, { decision: 'another' }]);
  assert.equal(parentClicks.length, 0, 'the click never reaches a host delegate');
});

test('the recovery card shows Abort when the options name abort, else Pause — never both', async () => {
  const a = mount(renderRecoveryCard, recovery([{ id: 'retry' }, { id: 'abort' }]));
  assert.deepEqual(a.$$('.qpanel-foot button').map((b) => b.textContent), ['Abort', 'Retry']);
  assert.equal(a.$('.recovery-pause'), null);
  assert.match(a.$('.issue-detail').textContent, /token expired/);
  a.$('.recovery-abort').click();
  await flush();
  assert.deepEqual(a.posts, [{ decision: 'abort' }]);
  assert.equal(a.parentClicks.length, 0);

  const p = mount(renderRecoveryCard, recovery([{ id: 'retry' }, { id: 'pause' }]));
  assert.deepEqual(p.$$('.qpanel-foot button').map((b) => b.textContent), ['Pause', 'Retry']);
  assert.equal(p.$('.recovery-abort'), null);
  p.$('.recovery-pause').click();
  await flush();
  p.$('.recovery-retry').click();
  await flush();
  assert.deepEqual(p.posts, [{ decision: 'pause' }, { decision: 'retry' }]);

  const old = mount(renderRecoveryCard, recovery(undefined));
  assert.deepEqual(old.$$('.qpanel-foot button').map((b) => b.textContent), ['Pause', 'Retry']);
});

test('the recovery card keeps the network note', () => {
  const pq = recovery([{ id: 'retry' }, { id: 'pause' }]);
  pq.recovery.network = { host: 'api.example.com', until: Date.now() + 60_000 };
  const { $ } = mount(renderRecoveryCard, pq);
  assert.match($('.recovery-network').textContent, /api\.example\.com is unreachable/);
});

function sender(submit) {
  const err = doc.createElement('div');
  err.hidden = true;
  const btn = doc.createElement('button');
  doc.body.append(btn, err);
  return { err, btn, send: stepSender({ doc, submit }, err) };
}

test('stepSender: a reason string reads "Not sent: …"; false reads SEND_FAILED; true hides the line', async () => {
  const s = sender(async () => 'this question is no longer pending');
  assert.equal(await s.send({ decision: 'approve' }), false);
  assert.equal(s.err.hidden, false);
  assert.equal(s.err.textContent, 'Not sent: this question is no longer pending');

  const f = sender(async () => false);
  await f.send({});
  assert.equal(f.err.textContent, SEND_FAILED);

  const ok = sender(async () => true);
  assert.equal(await ok.send({}), true);
  assert.equal(ok.err.hidden, true);
});

test('stepSender: a synchronous throw shows SEND_FAILED and the next click is accepted', async () => {
  let n = 0;
  const s = sender(() => { n += 1; if (n === 1) throw new Error('boom'); return Promise.resolve(true); });
  assert.equal(await s.send({}), false);
  assert.equal(s.err.textContent, SEND_FAILED);
  assert.equal(await s.send({}), true);
  assert.equal(n, 2);
});

test('stepSender: a second click while busy posts nothing', async () => {
  let release;
  const calls = [];
  const s = sender((p) => { calls.push(p); return new Promise((r) => { release = r; }); });
  const first = s.send({ a: 1 });
  assert.equal(await s.send({ a: 2 }), false);
  release(true);
  assert.equal(await first, true);
  assert.deepEqual(calls, [{ a: 1 }]);
});

test('stepSender: a 422 that already painted the line keeps it', async () => {
  const s = sender(async () => { s.err.hidden = false; s.err.textContent = 'feedback: too short'; return false; });
  await s.send({});
  assert.equal(s.err.textContent, 'feedback: too short');
});

// Chromium blurs a focused button when it is disabled (focus-after-disable); jsdom does not, so mimic it.
function blurOnDisable(btn) {
  const proto = Object.getPrototypeOf(btn);
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'disabled');
  Object.defineProperty(btn, 'disabled', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); if (v) this.blur(); },
  });
}

test('after a failed send the pressed button has the focus again', async () => {
  const { $, panel } = mount(renderGateCard, GATE, async () => {
    for (const b of panel.querySelectorAll('button')) b.disabled = true;     // setPanelBusy(r, true)
    await flush();
    for (const b of panel.querySelectorAll('button')) b.disabled = false;    // the failure re-enables
    return 'the server answered 500';
  });
  const another = $('.gate-another');
  blurOnDisable(another);
  another.focus();
  another.click();
  await flush(); await flush();
  assert.equal($('.plan-err').textContent, 'Not sent: the server answered 500');
  assert.equal(doc.activeElement, another);
});

test('the step head is the only title in every host: the old .qpanel-head is hidden on the chat card, run page and feature page (style.css)', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.chat-rc-q \.qpanel-head\{display:none;\}/);
  assert.match(css, /\.rd-glance > \.rd-questions \.qpanel-head\{display:none;\}/);
  assert.match(css, /\.shape-feature-ask \.qpanel:has\(\.step-head\) \.qpanel-head\{display:none;\}/);
});

test('run 4 D4: a waiting card takes the focus on its primary, never on a row ⋯', () => {
  const { window: w } = new JSDOM(`<div id="h"><div class="qpanel"><ol><li><button class="outline-row-more" aria-haspopup="menu">⋯</button></li></ol>
    <div class="plan-actions"><button class="plan-ask-changes">Ask for changes</button><button class="btn-primary outline-approve">Approve 2 runs</button></div></div></div>
    <div id="c"><div class="qpanel"><button class="qopt">Postgres</button><button class="btn-go">Answer</button></div></div>`);
  const d = w.document;
  assert.equal(questionFocusTarget(d.getElementById('h')).textContent, 'Approve 2 runs');
  assert.equal(questionFocusTarget(d.getElementById('c')).textContent, 'Postgres', 'a Clarify card: its first option');
  assert.equal(questionFocusTarget(null), null);
  const m = new JSDOM('<div id="m"><div class="qpanel"><button aria-haspopup="menu" tabindex="0">⋯</button><div tabindex="0" id="t">row</div></div></div>').window.document;
  assert.equal(questionFocusTarget(m.getElementById('m')).id, 't', 'a menu trigger with a tabindex is skipped too');
});
