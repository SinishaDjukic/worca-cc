// test/stillhet-schedule-rule.test.mjs — schedule-rule.mjs: the picker's words and dev's rule, both ways (D7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleOf, repeatOf, atOf } from '../ui/public/stillhet/live/schedule-rule.mjs';
import { REPEATS } from '../ui/public/design-system/components/list-parts.mjs';
import { normalizeRule } from '../src/shared/schedule/recurrence.mjs';

const WORDS = REPEATS.filter((w) => w !== 'once');

test('the 12 repeat words round-trip through a rule dev accepts, and keep the zone', () => {
  assert.equal(WORDS.length, 12);
  for (const every of WORDS) {
    const rule = ruleOf({ every, at: '07:30', tz: 'Europe/Berlin' });
    assert.equal(rule.error, undefined, every);
    assert.equal(rule.tz, 'Europe/Berlin');
    const norm = normalizeRule(rule, { todayLocal: '2026-11-14' });
    assert.ok(norm.ok, `${every}: ${norm.error}`);
    assert.equal(repeatOf(norm.rule), every, every);
    assert.equal(atOf(norm.rule), every === 'every hour' ? '' : '07:30');
  }
});

test('once, an unknown word and a bad time return { error }; a rule with no word returns null', () => {
  assert.ok(ruleOf({ every: 'once', at: '07:30', tz: 'UTC' }).error);
  assert.ok(ruleOf({ every: 'every fortnight', at: '07:30', tz: 'UTC' }).error);
  assert.ok(ruleOf({ every: 'every day', at: '7', tz: 'UTC' }).error);
  assert.equal(repeatOf({ freq: 'daily', interval: 2, time: '02:00', tz: 'UTC' }), null);
  assert.equal(repeatOf({ freq: 'daily', interval: 1, times: ['02:00', '14:00'], tz: 'UTC' }), null);
  assert.equal(repeatOf({ freq: 'weekly', interval: 1, weekdays: ['mo', 'we'], time: '02:00', tz: 'UTC' }), null);
  assert.equal(repeatOf({ freq: 'monthly', interval: 1, monthDay: 'last', time: '02:00', tz: 'UTC' }), null);
  assert.equal(repeatOf(null), null);
});

test('endOf: the New schedule form\'s end words as dev\'s rule.end', async () => {
  const { endOf } = await import('../ui/public/stillhet/live/schedule-rule.mjs');
  assert.equal(endOf('no end date'), null);
  assert.deepEqual(endOf('after 10 runs'), { type: 'count', count: 10 });
  assert.deepEqual(endOf('after 30 days', { today: new Date(2026, 10, 14) }), { type: 'until', until: '2026-12-14' });
  const norm = normalizeRule({ freq: 'daily', time: '02:00', tz: 'UTC', end: endOf('after 30 days', { today: new Date(2026, 10, 14) }) }, { todayLocal: '2026-11-14' });
  assert.ok(norm.ok, norm.error);
});
