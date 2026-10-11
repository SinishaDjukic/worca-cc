// test/limit-resume-decision.test.mjs
// limitResumeDecision(): when (and whether) a usage-limit pause is resumed automatically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitResumeDecision, AUTO_LIMIT_RESUMES_MAX } from '../src/core/limit-resume.mjs';
import { LIMIT_RESUME_MARGIN_MS } from '../src/core/recoverable-error.mjs';

const NOW = Date.parse('2026-10-11T11:00:00Z');
const HOUR = 3_600_000;
const rp = (over = {}) => ({
  pauseReason: 'usage_limit',
  limitResetAt: new Date(NOW + 2 * HOUR).toISOString(),
  ...over,
});
const decide = (over = {}, o = {}) => limitResumeDecision({ enabled: true, rp: rp(over), now: NOW, ...o });

test('the automatic-resume streak cap is three', () => {
  assert.equal(AUTO_LIMIT_RESUMES_MAX, 3);
});

test('skips when the setting is off', () => {
  const d = limitResumeDecision({ enabled: false, rp: rp(), now: NOW });
  assert.equal(d.skip, true);
  assert.ok(d.why);
});

test('skips when there is no recoverable pause', () => {
  assert.equal(limitResumeDecision({ enabled: true, rp: null, now: NOW }).skip, true);
});

test('skips when the pause is not a usage limit', () => {
  assert.equal(decide({ pauseReason: 'rate_limit' }).skip, true);
  assert.equal(decide({ pauseReason: undefined }).skip, true);
});

test('skips when the reset time is missing or unparsable', () => {
  assert.equal(decide({ limitResetAt: undefined }).skip, true);
  assert.equal(decide({ limitResetAt: 'not a date' }).skip, true);
});

test('skips after three automatic resumes in a row, saying so', () => {
  const d = decide({ autoLimitResumes: 3 });
  assert.equal(d.skip, true);
  assert.match(d.why, /3/);
  assert.match(d.why, /times in a row/);
});

test('schedules with two automatic resumes behind it', () => {
  assert.equal(decide({ autoLimitResumes: 2 }).schedule, true);
});

test('schedules the reset plus the margin', () => {
  const d = decide();
  assert.equal(d.schedule, true);
  assert.equal(d.resetAt, NOW + 2 * HOUR);
  assert.equal(d.at, NOW + 2 * HOUR + LIMIT_RESUME_MARGIN_MS);
  assert.equal(d.at, NOW + 2 * HOUR + 300000);
});

test('a reset long past schedules now, never in the past', () => {
  const d = decide({ limitResetAt: new Date(NOW - 10 * 60_000).toISOString() });
  assert.equal(d.schedule, true);
  assert.equal(d.at, NOW);
});

test('a reset just past still waits out the remainder of the margin', () => {
  const d = decide({ limitResetAt: new Date(NOW - 60_000).toISOString() });
  assert.equal(d.schedule, true);
  assert.equal(d.at, NOW - 60_000 + LIMIT_RESUME_MARGIN_MS);
});
