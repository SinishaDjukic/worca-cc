// test/ui-shape-req-change.test.mjs — Shaper small runs C4: the notice and the "How a change lands" fold
// (ui/public/shape/req-change.mjs), and the fold under a requirement stop with a proposal (step-card.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderReqChange, renderChangeRule, paintReqChange } from '../ui/public/shape/req-change.mjs';
import { renderGateCard, stepChip, stepTitle } from '../ui/public/shape/step-card.mjs';
import { planStop } from '../src/shared/shape/run-stops.mjs';
import { CHANGE_RULE_LINE, CHANGE_CASES } from '../src/shared/shape/req-change.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));
const E = (over = {}) => ({ id: 'R-arch-2', from: 'members only', to: 'reset emails retry once, within 20 seconds', at: '2026-11-22T15:03:00Z',
  by: 'ann', source: { kind: 'run', run: 5 }, case: 'finished', run: 2, added: 9, ...over });

test('renderChangeRule: a .srows fold, open, under the rule line; 3 rows; one "this change" mark (none for none)', () => {
  for (const c of CHANGE_CASES) {
    const el = renderChangeRule(doc, c);
    assert.ok(el.classList.contains('srows'));
    assert.equal(el.querySelector('.plan-fold-text').textContent, CHANGE_RULE_LINE);
    assert.equal(el.querySelector('.plan-check-line').getAttribute('aria-expanded'), 'true');
    assert.equal(el.querySelector('.plan-checks').hidden, false);
    const rows = [...el.querySelectorAll('.plan-check-row')];
    assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-id').textContent), ['Not started', 'Running', 'Finished']);
    const labels = rows.map((r) => r.querySelector('.plan-check-mark').getAttribute('aria-label'));
    assert.equal(labels.filter((l) => l === 'this change').length, c === 'none' ? 0 : 1, c);
    assert.equal(labels.filter((l) => l === 'not this change').length, c === 'none' ? 3 : 2, c);
  }
});

test('renderReqChange: the head, one .cap line, the fold; no button but the fold line, no question', () => {
  const el = renderReqChange(doc, E(), { time: '15:03' });
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'R-arch-2 changed · run 2 is finished');
  const caps = el.querySelectorAll('.cap');
  assert.equal(caps.length, 1);
  assert.equal(caps[0].textContent, 'Changed from run 5\'s review at 15:03: “reset emails retry once, within 20 seconds”. Run 9, a small change run, takes the next turn. You are told, not asked.');
  assert.equal(el.querySelectorAll('button:not(.plan-fold)').length, 0);
  assert.equal(el.querySelectorAll('.qpanel, .qopt').length, 0);
  const marked = [...el.querySelectorAll('.plan-check-row')].filter((r) => r.querySelector('[aria-label="this change"]'));
  assert.deepEqual(marked.map((r) => r.querySelector('.plan-check-id').textContent), ['Finished']);
  assert.equal((el.textContent.match(/run 2\b/gi) || []).length, 1, 'the owner run once');
});

test('paintReqChange: only on the Build step with a change; emptied once it lands', () => {
  const host = doc.createElement('div');
  paintReqChange(doc, host, { step: 'build', change: E({ case: 'running', added: undefined }) });
  assert.equal(host.hidden, false);
  assert.equal(host.querySelectorAll('.req-change').length, 1);
  paintReqChange(doc, host, { step: 'done', change: E() });
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  paintReqChange(doc, host, { step: 'build', change: null });
  assert.equal(host.hidden, true);
});

const REQ_STOP = (landsAs) => {
  const stop = planStop({ run: 5, concern: { title: 'retries are too few', kind: 'requirement', requirements: ['R-arch-2'],
    proposals: [{ id: 'R-arch-2', from: 'members only', text: 'reset emails retry once, within 20 seconds', landsAs }] } });
  return { id: 'plan-n_refine-2', kind: 'plan', plan: { round: 2 }, concern: { title: 'retries are too few' }, stop };
};
function mount(pq, submit) {
  const panel = doc.createElement('div'); panel.className = 'qpanel';
  doc.body.appendChild(panel);
  const posts = [];
  renderGateCard(panel, pq, { doc, title: stepTitle(pq), chip: stepChip(pq), tagLevel: () => {}, submit: (p) => { posts.push(p); return submit(p); } });
  return { panel, posts };
}

test('the requirement stop with a proposal: the fold below the options, the mark on the owner\'s case; the id once', () => {
  const { panel } = mount(REQ_STOP('finished'), async () => true);
  const rule = panel.querySelector('.req-change-rule');
  assert.ok(rule, 'the fold is drawn');
  const opts = panel.querySelector('.qopt:last-of-type') || panel.querySelector('.qopt');
  assert.ok(opts.compareDocumentPosition(rule) & 4, 'below the options');
  const marked = [...rule.querySelectorAll('.plan-check-row')].filter((r) => r.querySelector('[aria-label="this change"]'));
  assert.deepEqual(marked.map((r) => r.querySelector('.plan-check-id').textContent), ['Finished']);
  const texts = panel.querySelector('.req-change-texts');
  assert.ok(texts.compareDocumentPosition(rule) & 4, 'the new text above the fold');
  const tr = [...texts.querySelectorAll('.plan-check-row')];
  assert.deepEqual(tr.map((r) => [r.querySelector('.plan-check-id').textContent, r.querySelector('.plan-check-label').textContent]),
    [['R-arch-2', '“reset emails retry once, within 20 seconds”']]);
  const noStop = planStop({ run: 5, concern: { title: 'x', kind: 'requirement', requirements: ['R-arch-2'] } });
  const plain = mount({ ...REQ_STOP('none'), stop: noStop }, async () => true);
  assert.equal(plain.panel.querySelector('.req-change-rule'), null, 'C3\'s stop has no fold');
});

test('the requirement stop shows every proposed text in full, unclipped, one row each', () => {
  const long = `${'x'.repeat(200)} end`;
  const stop = planStop({ run: 5, concern: { title: 't', kind: 'requirement', requirements: ['R-arch-2', 'R-po-1'],
    proposals: [{ id: 'R-arch-2', from: 'a', text: long }, { id: 'R-po-1', from: 'b', text: 'second' }] } });
  const { panel } = mount({ ...REQ_STOP('running'), stop }, async () => true);
  const labels = [...panel.querySelectorAll('.req-change-texts .plan-check-label')].map((l) => l.textContent);
  assert.deepEqual(labels, [`“${long}”`, '“second”']);
});

test('a refused Change answer keeps the question open, shows the refusal and re-enables the primary', async () => {
  const { panel, posts } = mount(REQ_STOP('running'), async () => 'R-arch-2 changed since: read it again');
  [...panel.querySelectorAll('.qopt')].find((t) => t.dataset.value === 'change').click();
  panel.querySelector('.btn-primary').click();
  await flush(); await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].source, 'requirement');
  assert.match(panel.textContent, /Not sent: R-arch-2 changed since: read it again/);
  assert.equal(panel.querySelector('.btn-primary').disabled, false);
  assert.ok(panel.querySelector('.qopt'), 'the question stays open');
});
