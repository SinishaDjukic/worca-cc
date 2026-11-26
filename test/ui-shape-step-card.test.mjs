// test/ui-shape-step-card.test.mjs — the one chrome every Shaper step card shares (shaper-cards D2–D4, D12, D13, D15):
// kind chips, titles, the gate and recovery cards that bind their own buttons, and stepSender's failure rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { SEND_FAILED, smallRunsAsk, stepChip, stepTitle, stepKind, isStepCard, isRequirementsAsk, stepSender, stepHead, renderGateCard, renderRecoveryCard, questionFocusTarget }
  from '../ui/public/shape/step-card.mjs';
import { gateStop, planStop, concernStop } from '../src/shared/shape/run-stops.mjs';

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
  const css = await readStyleCss();
  assert.match(css, /\.chat-rc-q \.qpanel-head\{display:none;\}/);
  assert.match(css, /\.rd-details > \.rd-questions \.qpanel-head\{display:none;\}/);   // the question sits above the tabs
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

test('U10: a requirements ask (plan.criteria or plan.error) is titled "Your turn: agree the requirements", chipped Requirements, and still a plan kind', () => {
  const REQ = { id: 'r1', kind: 'plan', plan: { round: 1, criteria: { ok: true, passed: 1, total: 1, items: [], criteria: [] }, decisions: [] } };
  const ERR = { id: 'r2', kind: 'plan', plan: { round: 1, error: { message: 'boom' } } };
  for (const pq of [REQ, ERR]) {
    assert.equal(isRequirementsAsk(pq), true);
    assert.equal(stepKind(pq), 'plan');
    assert.equal(stepTitle(pq), 'Your turn: agree the requirements');
    assert.equal(stepChip(pq, { shaping: { feature: { id: 'f', index: 2, total: 3 } } }), 'Requirements');
    assert.equal(isStepCard(pq, null, false), true);
  }
  for (const pq of [PLAN, SPLIT, GATE, CLARIFY, null]) assert.equal(isRequirementsAsk(pq), false);
  assert.equal(stepTitle(PLAN), 'Your turn: approve the plan');
  assert.equal(stepChip(PLAN, SHAPING), 'Plan');
});

test('B2: the care ask is a step card: chip Start, title "Your turn: how much care?"', () => {
  const CARE = { id: 'care-1', kind: 'care', care: { pick: { position: 'balanced' } } };
  assert.equal(isStepCard(CARE, {}, false), true);
  assert.equal(stepChip(CARE, {}), 'Start');
  assert.equal(stepTitle(CARE), 'Your turn: how much care?');
  assert.equal(stepKind(CARE), 'care');
});

test('smallRunsAsk: the small-runs marker is read from the open ask alone (Care, or a plan stamped smallRuns)', () => {
  assert.equal(smallRunsAsk({ kind: 'care' }), true);
  assert.equal(smallRunsAsk({ kind: 'plan', plan: { smallRuns: true } }), true);
  assert.equal(smallRunsAsk({ kind: 'plan', plan: {} }), false);
  assert.equal(smallRunsAsk({ kind: 'clarify', questions: [] }), false);
  assert.equal(smallRunsAsk(null), false);
  assert.equal(smallRunsAsk(undefined), false);
});

test('C1: the prototype chip and titles; a prototype ask is a step card and a small-runs ask', () => {
  const pq = (moment) => ({ id: 'proto-1', kind: 'prototype', prototype: { moment } });
  assert.equal(stepChip(pq('offered'), {}), 'Prototype');
  assert.equal(isStepCard(pq('offered'), {}, false), true);
  assert.equal(smallRunsAsk(pq('built')), true);
  assert.deepEqual(['offered', 'built', 'remark', 'failed'].map((m) => stepTitle(pq(m))),
    ['Prototype the screens first?', 'Your turn: look, remark, confirm', 'Change the requirement?', 'The prototype did not build']);
});

// ── Small runs C3 (D11–D13): a stop is one question on the card, its findings only in the panel ──────────────────
const G_STOP = { ...GATE, id: 'gate-w9-3', stop: gateStop({ run: 8, issues: GATE.issues, fixCycles: 3, nodeId: 'n_review' }) };
const P_STOP = { id: 'plan-n_refine-2', kind: 'plan', plan: { round: 2, check: { ok: false, passed: 3, total: 5, items: [{ label: 'Has tests', pass: false, detail: 'none' }, { label: 'Ok', pass: true }] } },
  stop: planStop({ run: 4, check: { ok: false, passed: 3, total: 5, items: [] } }) };
const C_STOP = { id: 'plan-concern-n_impl-c2', kind: 'plan', concern: { title: 'Use the DB' }, plan: { round: 2 },
  stop: concernStop({ run: 5, concern: { title: 'Use the DB' }, decidedBefore: true }) };
function mountStop(pq, extra = {}, submit = async () => true) {
  const parent = doc.createElement('div');
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  parent.appendChild(panel);
  doc.body.appendChild(parent);
  const posts = [];
  renderGateCard(panel, pq, { doc, title: stepTitle(pq), chip: stepChip(pq), tagLevel: () => {}, submit: (p) => { posts.push(p); return submit(p); }, ...extra });
  return { panel, posts, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}
const runCount = (panel) => {
  // Per text node: the log row's run span and text sit side by side, so the whole textContent reads "Run 8another …".
  const walk = panel.ownerDocument.createTreeWalker(panel, 4);
  let n = 0;
  for (let t = walk.nextNode(); t; t = walk.nextNode()) n += (t.data.match(/Run 8\b/g) || []).length;
  return n;
};

test('C3: a stop title is its head and its chip names no run, for a gate and a plan stop', () => {
  assert.equal(stepTitle(G_STOP, 'Review'), 'Run 8 · Code review objects');
  assert.equal(stepChip(G_STOP, { shaping: { feature: { id: 'f', index: 8 } } }), 'Gate');
  assert.equal(stepTitle(P_STOP), 'Run 4 · the plan check did not pass');
  assert.equal(stepChip(P_STOP, { shaping: { feature: { id: 'f', index: 4 } } }), 'Plan');
  assert.ok(smallRunsAsk(G_STOP));
});

test('C3: the stop card: one primary naming the pick, two option rows with sub, the pick preset and recommended, focus on the primary', () => {
  for (const pq of [G_STOP, P_STOP, C_STOP]) {
    const { panel, $, $$ } = mountStop(pq);
    const prim = $$('.btn-primary');
    assert.equal(prim.length, 1, pq.id);
    const pick = pq.stop.options.find((o) => o.value === pq.stop.pick);
    assert.equal(prim[0].textContent, pick.go);
    assert.equal($$('.qopt').length, 2);
    assert.equal($$('.chat-q-opt-sub').length, 2);
    assert.deepEqual($$('.qopt[data-preset="1"]').map((t) => t.dataset.value), [pq.stop.pick]);
    assert.deepEqual($$('.qopt .qrec').map((r) => r.closest('.qopt').dataset.value), [pq.stop.pick]);
    assert.equal(questionFocusTarget(panel), prim[0]);
    const other = $$('.qopt').find((t) => t.dataset.value !== pq.stop.pick);
    other.click();
    assert.equal(prim[0].textContent, pq.stop.options.find((o) => o.value === other.dataset.value).go);
    assert.equal($('.qanswered').textContent, '1 of 1 answered');
  }
});

test('C3: picking Accept as is posts continue; the card says run, finding and cycles once', async () => {
  const { panel, $, $$, posts } = mountStop(G_STOP);
  assert.equal(runCount(panel), 1);
  assert.equal((panel.textContent.match(/3 fix cycles/g) || []).length, 1);
  assert.equal((panel.textContent.match(/Code review: Flaky test/g) || []).length, 1, 'who objects to what, once');
  $$('.qopt').find((t) => t.dataset.value === 'continue').click();
  $('.btn-primary').click();
  await flush();
  assert.deepEqual(posts, [{ decision: 'continue' }]);
});

test('C3: a refused answer re-enables the tiles and primary and shows the reason once', async () => {
  const { $, $$ } = mountStop(G_STOP, {}, async () => 'not one of the options');
  $('.btn-primary').click();
  await flush(); await flush();
  const err = $('.chat-rc-q-err');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'Not sent: not one of the options');
  assert.equal($$('.chat-rc-q-err:not([hidden])').length, 1);
  assert.ok($$('.qopt').every((t) => !t.disabled));
  assert.equal($('.btn-primary').disabled, false);
});

test('C3: a held answer draws the one answered line as a finished-step row: no head, chip, box or control', () => {
  const { $$, panel } = mountStop(G_STOP, { held: { value: 'another' } });
  assert.equal($$('button').length, 0);
  assert.equal($$('.step-head, .ask-mcard-head, .ask-mcard-chip').length, 0, 'no head and no chip');
  assert.equal($$('.chat-rc-receipt').length, 0, 'no receipt box');
  const rows = $$('ol.chat-rc-log > li.chat-rc-log-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.chat-rc-log-run').textContent, 'Run 8');
  assert.equal(rows[0].querySelector('.chat-rc-log-text').textContent, 'another cycle · decided by you', 'drawn like the delivered row');
  assert.equal(runCount(panel), 1, 'the row is the only "Run 8" in the stop area');
});

test('C3: readOnly (the side panel) draws 0 buttons, no question and exactly one findings list', () => {
  for (const pq of [G_STOP, P_STOP, C_STOP]) {
    const { $$, panel } = mountStop(pq, { readOnly: true });
    assert.equal($$('button').length, 0, pq.id);
    assert.equal($$('.qopt').length, 0);
    assert.equal(panel.textContent.includes(pq.stop.text), false, 'no question text');
    assert.equal($$('.issues, .plan-checks').length, 1);
    assert.equal(runCount(panel), 0, 'the run number is on the card');
  }
});

test('C5: readOnly (the side panel) draws the Verifier stop\'s gaps as its one findings list', async () => {
  const { verifyStop } = await import('../src/shared/shape/verifier.mjs');
  const gaps = [{ id: 'R-po-2', why: 'sign-up never calls the email service' }, { id: 'R-po-3', why: 'the export skips empty charts' }];
  const pq = { id: 'verify-3', kind: 'gate', nodeId: 'n_verify', issues: [], stop: verifyStop({ gaps, round: 3, fixCycles: 2 }) };
  const { $$ } = mountStop(pq, { readOnly: true });
  assert.equal($$('button').length, 0);
  assert.equal($$('.issues, .plan-checks').length, 1);
  assert.deepEqual($$('.verify-gaps .plan-check-id').map((e) => e.textContent), ['R-po-2', 'R-po-3']);
});

// The run page of a stopped run (flag on): the same interactive card as the feature card, with the one-column head marker.
test('the run page (runPage, not readOnly): the stop\'s head with data-stop, then the question with every option, Worca\'s pick preset and one primary naming it', async () => {
  const { verifyStop } = await import('../src/shared/shape/verifier.mjs');
  const V_STOP = { id: 'verify-3', kind: 'gate', nodeId: 'n_verify', issues: [], stop: verifyStop({ gaps: [{ id: 'R-po-2', why: 'no email' }], round: 3, fixCycles: 2 }) };
  for (const pq of [G_STOP, P_STOP, C_STOP, V_STOP]) {
    const { panel, $$, $ } = mountStop(pq, { runPage: true });
    assert.equal($('.ask-mcard-title').textContent, pq.stop.head, pq.id);
    assert.equal($$('.ask-mcard-title').length, 1);
    assert.ok([...panel.children][0].matches('.ask-mcard-head[data-stop]'), 'the head carries the one-column marker (shape-it.css)');
    assert.equal($$('.qopt').length, pq.stop.options.length);
    assert.deepEqual($$('.qopt[data-preset="1"]').map((t) => t.dataset.value), [pq.stop.pick]);
    const prim = $$('.btn-primary');
    assert.equal(prim.length, 1);
    assert.equal(prim[0].textContent, pq.stop.options.find((o) => o.value === pq.stop.pick).go);
    assert.equal(panel.textContent.includes(pq.stop.text), true, 'the question text');
    assert.equal($$('.stop-home, a.rd-fact-link').length, 0, 'no line to elsewhere: the stop is answered here');
  }
  assert.equal(mountStop(V_STOP, { runPage: true }).panel.querySelectorAll('.verify-gaps .plan-check-id').length, 1, "the Verifier's gaps");
  assert.equal(mountStop(P_STOP, {}).panel.querySelector(':scope > [data-stop]'), null, 'no marker off the run screen');
  const held = mountStop(G_STOP, { runPage: true, held: { value: 'another' } });
  assert.equal(held.$$('.ask-mcard-title, .stop-home, button, .qopt').length, 0, 'held: no head and no control');
  assert.equal(held.$$('.chat-rc-log-row').length, 1);
  assert.equal(held.$('.chat-rc-log-text').textContent, 'another cycle · decided by you');
});

test('the run page: the primary posts the pick; a stop already answered elsewhere shows "Not sent" and keeps the options', async () => {
  const ok = mountStop(G_STOP, { runPage: true });
  ok.$('.btn-primary').click();
  await flush();
  assert.deepEqual(ok.posts, [G_STOP.stop.options.find((o) => o.value === G_STOP.stop.pick).payload]);
  const refused = mountStop(G_STOP, { runPage: true }, async () => 'this stop is already answered');
  refused.$('.btn-primary').click();
  await flush(); await flush();
  assert.equal(refused.$('.chat-rc-q-err').textContent, 'Not sent: this stop is already answered');
  assert.equal(refused.$$('.qopt').length, G_STOP.stop.options.length);
  assert.ok(refused.$$('.qopt').every((t) => !t.disabled));
});

test('C3: a gate without stop still draws the two dev buttons; renderRecoveryCard is unchanged', () => {
  const { $$ } = mountStop(GATE);
  assert.deepEqual($$('.qpanel-foot button').map((b) => b.textContent), ['Accept as is', 'Run another cycle']);
});

// ── An outline change: a short question line, then the Planner's note as a formatted, folding body ───────────────────
const FIRST = 'A prerequisite is not in this tree';
const NOTE = [`## Slice 2: ${FIRST}`, '', 'Run 1 did not add the tags table. '.repeat(8), '', 'The list route reads it. '.repeat(11), '',
  'Missing:', '', '- `src/core/db.mjs`', '- `src/core/tags.mjs`', '- `ui/public/tags.mjs`', '- `test/tags.test.mjs`', '- `docs/tags.md`',
  '- `ui/server.mjs`'].join('\n');
const outlineStop = (id, outlineChange = NOTE) => ({ id, kind: 'plan', plan: { round: 1, outlineChange }, stop: planStop({ run: 2, outlineChange }) });

test('outline stop: the question line, then the note body, then the options', () => {
  const { panel, $, $$ } = mountStop(outlineStop('plan-outline-1'));
  assert.equal($('.qtext-t').textContent, 'The Planner says this run cannot be built as outlined: a prerequisite is not in this tree.');
  assert.deepEqual([...$('.qblock').children].map((c) => c.classList[0]), ['qtext', 'note-body', 'qopts']);
  assert.equal($$('.note-body').length, 1);
  assert.equal($('.note-body').textContent.includes(FIRST), false, 'the title is in the question line only');
  assert.equal((panel.textContent.match(/prerequisite is not in this tree/gi) || []).length, 1);
  assert.equal($$('.qopt').length, 2);
  assert.equal($$('.btn-primary').length, 1);
  assert.equal($('.btn-primary').textContent, 'Keep it');
  assert.equal($('.note-toggle').textContent, 'Show the full note');
});

test('opening the note keeps the person\'s pick', () => {
  const { $, $$, posts } = mountStop(outlineStop('plan-outline-2'));
  $$('.qopt').find((t) => t.dataset.value === 'change').click();
  for (const open of ['true', 'false']) {
    $('.note-toggle').click();
    assert.equal($('.note-toggle').getAttribute('aria-expanded'), open);
    assert.deepEqual($$('.qopt.sel').map((t) => [t.dataset.value, t.getAttribute('aria-pressed')]), [['change', 'true']]);
    assert.equal($('.btn-primary').textContent, 'Change it');
  }
  assert.deepEqual(posts, [], 'folding never answers');
});

test('a repaint keeps the note open', () => {
  const pq = outlineStop('plan-outline-3');
  mountStop(pq).$('.note-toggle').click();
  const again = mountStop(pq);
  assert.equal(again.$('.note-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(again.$('.note-body li[hidden]:not(.note-more)'), null);
  assert.equal(mountStop(outlineStop('plan-outline-4')).$('.note-toggle').getAttribute('aria-expanded'), 'false');
});

test('a note that is only its title adds no body; a note with no usable title shows whole under the short question', () => {
  assert.equal(mountStop(outlineStop('plan-outline-5', 'The split is stale')).$('.note-body'), null);
  const { $ } = mountStop(outlineStop('plan-outline-6', '- the tags table\n- the route'));
  assert.equal($('.qtext-t').textContent, 'The Planner says this run cannot be built as outlined.');
  assert.deepEqual([...$('.note-body').querySelectorAll('li')].map((li) => li.textContent), ['the tags table', 'the route']);
});

test('readOnly outline stop: the note\'s title is the finding title, the rest is the body; no title → "The outline no longer fits"', () => {
  const { $, $$ } = mountStop(outlineStop('plan-outline-7'), { readOnly: true });
  assert.equal($$('.issues, .plan-checks').length, 1);
  assert.deepEqual($$('.issues > li.issue > .issue-head > .issue-title').map((t) => t.textContent), [FIRST]);
  assert.ok($('li.issue > .note-body'));
  assert.equal($('.issue-detail'), null);
  assert.equal($('.note-body').textContent.includes(FIRST), false);
  assert.deepEqual($$('button').map((b) => b.className), ['btn btn-sm btn-quiet note-toggle'], 'the fold is its only control');
  const long = `${'a'.repeat(121)}\n\nMore.`;
  const bare = mountStop(outlineStop('plan-outline-8', long), { readOnly: true });
  assert.equal(bare.$('.issue-title').textContent, 'The outline no longer fits');
  assert.deepEqual(bare.$$('.note-body p').map((p) => p.textContent), ['a'.repeat(121), 'More.']);
  const only = mountStop(outlineStop('plan-outline-9', 'The split is stale'), { readOnly: true });
  assert.equal(only.$('.issue-title').textContent, 'The split is stale');
  assert.equal(only.$('.note-body'), null);
});

test('the card and the finding of one ask remember their own fold', () => {
  const pq = outlineStop('plan-outline-10');
  mountStop(pq).$('.note-toggle').click();
  assert.equal(mountStop(pq, { readOnly: true }).$('.note-toggle').getAttribute('aria-expanded'), 'false');
});

test('a concern requirement stop draws no .note-body, and its text and finding are unchanged', () => {
  const concern = { kind: 'requirement', title: 'Members only is too strict', detail: 'R-arch-2: too strict', requirements: ['R-arch-2'] };
  const pq = { id: 'plan-concern-9', kind: 'plan', concern, plan: { round: 1, outlineChange: NOTE }, stop: planStop({ run: 2, concern, outlineChange: NOTE }) };
  const card = mountStop(pq);
  assert.equal(card.$('.qtext-t').textContent, 'A reviewer wants R-arch-2 changed: Members only is too strict.');
  assert.equal(card.$('.note-body'), null);
  const panel = mountStop(pq, { readOnly: true });
  assert.equal(panel.$('.issue-title').textContent, concern.title);
  assert.equal(panel.$('.issue-detail').textContent, concern.detail);
  assert.equal(panel.$('.note-body'), null);
});
