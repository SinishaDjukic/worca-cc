// test/ui-question-delegate.test.mjs — the one click delegate for a run's inline question (Known bug 7,
// ui/public/question-delegate.mjs): the chat run card and the group page bind it.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { delegateQuestion, questionPayload } from '../ui/public/question-delegate.mjs';

const trackDom = useDomRelease(afterEach);

test('gate and recovery buttons map to their decisions; workflow panels and disabled buttons are ignored', () => {
  const doc = trackDom(new JSDOM(`<!doctype html><body><div id="h"><div class="qpanel">
    <button class="gate-continue">Continue</button><button class="gate-another">Approve another</button>
    <button class="recovery-retry">Retry</button><button class="gate-another" disabled>x</button></div>
    <div class="qpanel qpanel-workflow"><button class="gate-continue">w</button></div></div></body>`)).window.document;
  const sent = [];
  const off = delegateQuestion(doc.getElementById('h'), { question: () => ({ id: 'gate-n_review-2', kind: 'gate', issues: [] }),
    send: (payload, pq) => sent.push([pq.id, payload]) });
  const btns = doc.querySelectorAll('button');
  btns[1].click(); btns[0].click(); btns[2].click(); btns[3].click(); btns[4].click();
  assert.deepEqual(sent, [['gate-n_review-2', { decision: 'another' }], ['gate-n_review-2', { decision: 'continue' }],
    ['gate-n_review-2', { decision: 'retry' }]]);
  off();
  btns[1].click();
  assert.equal(sent.length, 3, 'the disposer unbinds');
  assert.deepEqual(questionPayload(btns[1], { kind: 'gate' }), { decision: 'another' });
});
