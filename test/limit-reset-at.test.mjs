// test/limit-reset-at.test.mjs
// limitResetAt(): when a plan's usage limit comes back, read from the limit message.
// Every case passes `now` and `tz` explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitResetAt, LIMIT_RESUME_MARGIN_MS } from '../src/core/recoverable-error.mjs';

const NOW = Date.parse('2026-10-11T11:00:00Z');   // 14:00 Europe/Sofia (EEST), a Sunday
const TZ = 'Europe/Sofia';
const at = (msg, now = NOW, tz = TZ) => limitResetAt(msg, { now, tz });
const iso = (s) => Date.parse(s);

test('the resume margin is five minutes', () => {
  assert.equal(LIMIT_RESUME_MARGIN_MS, 300000);
});

test('clock times: today when still ahead, tomorrow when past', () => {
  assert.equal(at("You've hit your session limit · resets 6pm"), iso('2026-10-11T15:00Z'));
  assert.equal(at("You've hit your session limit · resets 6:30pm (Europe/Sofia)"), iso('2026-10-11T15:30Z'));
  assert.equal(at("You've hit your session limit · resets 11am"), iso('2026-10-12T08:00Z'));
  assert.equal(at("You've hit your session limit · resets 6pm (America/New_York)"), iso('2026-10-11T22:00Z'));
  assert.equal(at('quota resets at 02:00'), iso('2026-10-11T23:00Z'));
});

test('weekday and month-day forms', () => {
  assert.equal(at("You've hit your weekly limit · resets Mon 9am"), iso('2026-10-12T06:00Z'));
  assert.equal(at("You've hit your weekly limit · resets Oct 12, 3pm"), iso('2026-10-12T12:00Z'));
});

test('phrasings: "resets at", "try again at", 24h, "it resets"', () => {
  assert.equal(at("You've hit your usage limit. It resets at 5pm."), iso('2026-10-11T14:00Z'));
  assert.equal(at("You've hit your usage limit. Try again at 6pm"), iso('2026-10-11T15:00Z'));
  assert.equal(at("You've hit your usage limit · try again at 3:47 PM"), iso('2026-10-11T12:47Z'));
  assert.equal(at('codex: You hit your usage limit. Try again at 15:47.'), iso('2026-10-11T12:47Z'));
  assert.equal(at("You've hit your usage limit for this period, it resets 6pm"), iso('2026-10-11T15:00Z'));
  assert.equal(at('You have hit your usage limit · resets 5pm'), iso('2026-10-11T14:00Z'));
  assert.equal(at('Claude usage limit reached. Your limit will reset at 3pm (America/New_York).'), iso('2026-10-11T19:00Z'));
});

test('relative durations', () => {
  assert.equal(at("You've hit your usage limit · try again in 2 hours 13 minutes"), iso('2026-10-11T13:13Z'));
  assert.equal(at('You hit your usage limit. Upgrade to Pro or try again in 3 days 1 hour.'), iso('2026-10-14T12:00Z'));
  assert.equal(at('session limit exhausted — resets in 2min'), iso('2026-10-11T11:02Z'));
});

test('OpenRouter free-daily: the reset it names', () => {
  assert.equal(at('Rate limit exceeded: free-models-per-day-high-balance. resets 2026-10-12T00:00:00Z'), iso('2026-10-12T00:00Z'));
});

test('no readable time → null', () => {
  assert.equal(at('usage limit reached'), null);
  assert.equal(at("You've hit your session limit."), null);
  assert.equal(at('Try again at Oct 14th, 2026 3:47 PM.'), null);
});

test('an unknown zone falls back to tz', () => {
  assert.equal(at("You've hit your session limit · resets 6pm (Mars/Olympus)"), iso('2026-10-11T15:00Z'));
});

test('a zone with several segments is honoured', () => {
  assert.equal(at('limit resets 6pm (America/Argentina/Buenos_Aires)'), iso('2026-10-11T21:00Z'));
});

test('out of window or impossible → null', () => {
  assert.equal(at("You've hit your session limit · resets Oct 25, 3pm"), null);
  assert.equal(at("You've hit your session limit · resets Oct 1, 3pm"), null);
  assert.equal(at("You've hit your session limit · resets Feb 30, 3pm"), null);
  for (const bad of ['resets 6', 'resets 13pm', 'resets 25:00', 'resets 6:75pm']) {
    assert.equal(at(`You've hit your session limit · ${bad}`), null, bad);
  }
});

test('junk input never throws', () => {
  for (const v of [undefined, null, {}, 42, { message: 5 }]) {
    assert.equal(limitResetAt(v, { now: NOW, tz: TZ }), null);
  }
  assert.equal(limitResetAt(new Error('resets 6pm'), { now: NOW, tz: TZ }), iso('2026-10-11T15:00Z'));
});

test('12am and 12pm', () => {
  const late = Date.parse('2026-10-11T20:50:00Z');   // 23:50 Sofia
  assert.equal(at('limit resets 12am', late), iso('2026-10-11T21:00Z'));
  assert.equal(at('limit resets 12pm', late), iso('2026-10-12T09:00Z'));
});

test('DST fall-back in Sofia (2026-10-25)', () => {
  const now = iso('2026-10-24T22:00Z');
  assert.equal(at('limit resets 6pm', now), iso('2026-10-25T16:00Z'));
  assert.equal(at('limit resets 3:30am', now), iso('2026-10-25T00:30Z'));
});
