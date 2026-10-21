// test/limit-notice.test.mjs
// The usage-limit pause notice's model (states A–D). Every case passes `now` explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT_RESUME_MARGIN_MS as CORE_MARGIN } from '../src/core/recoverable-error.mjs';
import {
  LIMIT_RESUME_MARGIN_MS, limitNoun, resumeTicketOf, limitNotice, countdownText,
} from '../ui/public/limit-notice.mjs';

const t = (hhmm) => Date.parse(`2026-10-11T${hhmm}:00Z`);
const NOW = t('13:46');
const RESET = '2026-10-11T15:00:00Z';
const WHOSE = "Claude's ";
const DETAIL = 'Claude hit its session limit';

test('the browser mirror of the resume margin equals the core constant', () => {
  assert.equal(LIMIT_RESUME_MARGIN_MS, CORE_MARGIN);
});

test('limitNoun reads the noun from the pause detail', () => {
  assert.equal(limitNoun('You have hit your weekly limit'), 'weekly limit');
  assert.equal(limitNoun('5-hour session limit reached'), 'session limit');
  assert.equal(limitNoun('usage limit reached'), 'usage limit');
  assert.equal(limitNoun(null), 'usage limit');
});

test('resumeTicketOf finds the open resume ticket of a pipeline only', () => {
  const tickets = [
    { id: 'a', resumePipelineId: 'p1', scheduleId: 's', status: 'scheduled' },
    { id: 'b', resumePipelineId: 'p2', status: 'scheduled' },
    { id: 'c', resumePipelineId: 'p1', status: 'fired' },
    { id: 'd', resumePipelineId: 'p1', status: 'missed' },
  ];
  assert.equal(resumeTicketOf(tickets, 'p1').id, 'd');
  assert.equal(resumeTicketOf(tickets, 'p2').id, 'b');
  assert.equal(resumeTicketOf(tickets, 'p3'), null);
  assert.equal(resumeTicketOf(null, 'p1'), null);
});

test('A: no known reset time leaves the lead to the caller', () => {
  const n = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, limitResetAt: null, now: NOW });
  assert.equal(n.state, 'A');
  assert.equal(n.lead, null);
  assert.equal(n.action, null);
  assert.equal(n.repaintAt, null);
});

test('B: reset ahead — sentence, countdown to the reset, schedule at reset + margin', () => {
  const n = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, limitResetAt: RESET, now: NOW });
  assert.equal(n.state, 'B');
  assert.equal(n.lead, "Paused: Claude's session limit.");
  assert.equal(n.sentence, 'It resets at {t}');
  assert.equal(n.timeAt, t('15:00'));
  assert.equal(n.countdownTo, t('15:00'));
  assert.equal(countdownText(n.countdownTo, NOW), 'in 1h 14m');
  assert.equal(n.repaintAt, t('15:00'));
  assert.deepEqual(n.action, { kind: 'schedule', at: t('15:05') });
});

test('B inside the margin: "It reset at", button kept, repaint at the one-click time', () => {
  const n = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, limitResetAt: RESET, now: t('15:02') });
  assert.equal(n.state, 'B');
  assert.equal(n.sentence, 'It reset at {t}');
  assert.equal(n.countdownTo, null);
  assert.equal(n.repaintAt, t('15:05'));
  assert.deepEqual(n.action, { kind: 'schedule', at: t('15:05') });
});

test('B2: past reset + margin — no action, resume to continue', () => {
  const n = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, limitResetAt: RESET, now: t('15:06') });
  assert.equal(n.state, 'B2');
  assert.equal(n.sentence, 'It reset at {t}. Resume to continue');
  assert.equal(n.timeAt, t('15:00'));
  assert.equal(n.action, null);
  assert.equal(n.repaintAt, null);
});

test('C: a scheduled ticket — resumes automatically, countdown, cancel', () => {
  const ticket = { id: 'tk1', runAt: '2026-10-11T15:05:00Z', status: 'scheduled' };
  const n = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, limitResetAt: RESET, ticket, now: NOW });
  assert.equal(n.state, 'C');
  assert.equal(n.sentence, 'Resumes automatically at {t}');
  assert.equal(n.timeAt, t('15:05'));
  assert.equal(countdownText(n.countdownTo, NOW), 'in 1h 19m');
  assert.equal(n.repaintAt, t('15:05'));
  assert.deepEqual(n.action, { kind: 'cancel', ticketId: 'tk1' });
});

test('C2: a missed ticket — cancel only', () => {
  const ticket = { id: 'tk1', runAt: '2026-10-11T15:05:00Z', status: 'missed' };
  const n = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, limitResetAt: RESET, ticket, now: t('15:30') });
  assert.equal(n.state, 'C2');
  assert.equal(n.sentence, 'The scheduled resume at {t} was missed');
  assert.equal(n.countdownTo, null);
  assert.equal(n.repaintAt, null);
  assert.deepEqual(n.action, { kind: 'cancel', ticketId: 'tk1' });
});

test('D: a due or firing ticket is resuming', () => {
  const due = { id: 'tk1', runAt: '2026-10-11T15:05:00Z', status: 'scheduled' };
  const d1 = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, ticket: due, now: t('15:05') });
  assert.equal(d1.state, 'D');
  assert.equal(d1.lead, 'Paused: resuming…');
  assert.equal(d1.action, null);
  const firing = { id: 'tk1', runAt: '2026-10-11T15:05:00Z', status: 'firing' };
  const d2 = limitNotice({ pauseDetail: DETAIL, whose: WHOSE, ticket: firing, now: NOW });
  assert.equal(d2.state, 'D');
  assert.equal(d2.lead, 'Paused: resuming…');
});

test('OpenRouter detail: B has its own lead, a button only', () => {
  const detail = "OpenRouter's free-model requests are used up until 00:00 UTC";
  const n = limitNotice({ pauseDetail: detail, whose: '', limitResetAt: RESET, now: NOW });
  assert.equal(n.state, 'B');
  assert.equal(n.lead, `Paused: ${detail}.`);
  assert.equal(n.sentence, '');
  assert.equal(n.countdownTo, null);
  assert.equal(n.timeAt, null);
  assert.equal(n.repaintAt, t('15:05'));
  assert.deepEqual(n.action, { kind: 'schedule', at: t('15:05') });
});

test('countdownText says "under a minute" near zero', () => {
  assert.equal(countdownText(NOW + 30_000, NOW), 'in under a minute');
});
