// test/ask-schedule-card.test.mjs
// The pure half of a scheduled Ask card at fire time (#1567): which ticket owns it (a one-off by its run id, a
// series by its schedule id), the refusal a Start by hand gets, and the patch that moves a series card's time on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';

import { cardOwnedByTicket, cardFollowsSeries, cardOutlivesRunFailure, cardStateRefusal, seriesCardTimePatch, followSeriesCard } from '../src/core/ask/schedule-card.mjs';

const oneOff = { state: 'scheduled', runId: 'tk-1', scheduleId: null };
const series = { state: 'scheduled', runId: null, scheduleId: 'sch_aaaa1111', scheduledFor: '2026-11-30T17:00:00.000Z' };
const occurrence = (id) => ({ id, scheduleId: 'sch_aaaa1111' });

test('a scheduled Ask card is owned by its one-off ticket or by any occurrence of the series it follows', async () => {
  await checkRows([
    { name: 'one-off: the ticket it was scheduled as, and no other', run: () => {
      assert.equal(cardOwnedByTicket(oneOff, { id: 'tk-1', scheduleId: null }), true);
      assert.equal(cardOwnedByTicket(oneOff, { id: 'tk-2', scheduleId: null }), false);
      assert.equal(cardOwnedByTicket(oneOff, occurrence('tk-1x')), false, 'a series ticket never owns a one-off card');
      assert.equal(cardFollowsSeries(oneOff, occurrence('tk-1x')), false);
    } },
    { name: 'series: every occurrence (timed or Run now), by the schedule id — the card carries no run id', run: () => {
      assert.equal(cardOwnedByTicket(series, occurrence('tk-a')), true);
      assert.equal(cardOwnedByTicket(series, occurrence('tk-b')), true, 'the second occurrence as well');
      assert.equal(cardFollowsSeries(series, occurrence('tk-b')), true);
      assert.equal(cardOwnedByTicket(series, { id: 'tk-a', scheduleId: 'sch_bbbb2222' }), false, 'another series');
      assert.equal(cardOwnedByTicket(series, { id: 'tk-a', scheduleId: null }), false, 'a one-off ticket');
    } },
    { name: 'only a scheduled card is anyone\'s; missing pieces answer false, never throw', run: () => {
      for (const state of ['proposed', 'started', 'failed', 'declined']) {
        assert.equal(cardOwnedByTicket({ ...series, state }, occurrence('tk-a')), false, state);
        assert.equal(cardOwnedByTicket({ ...oneOff, state }, { id: 'tk-1' }), false, state);
      }
      assert.equal(cardOwnedByTicket(null, occurrence('tk-a')), false);
      assert.equal(cardOwnedByTicket(series, null), false);
      assert.equal(cardFollowsSeries(undefined, undefined), false);
    } },
  ]);
});

test('cardOutlivesRunFailure: a card that follows a series, or was handed back, is never failed by one occurrence — read at fail time, so a resumed occurrence decides the same', () => {
  assert.equal(cardOutlivesRunFailure(series), true, 'following the series');
  assert.equal(cardOutlivesRunFailure({ ...series, scheduledFor: null }), true, 'following a paused series');
  assert.equal(cardOutlivesRunFailure({ state: 'proposed', runId: null, scheduleId: null }), true, 'the series was deleted while the occurrence ran: the card was handed back');
  assert.equal(cardOutlivesRunFailure({ state: 'started', runId: 'tk-1', scheduleId: null }), false, 'a one-off the fire started is this run\'s card');
  assert.equal(cardOutlivesRunFailure(oneOff), false, 'a one-off still waiting is one run\'s, not a series\'');
  assert.equal(cardOutlivesRunFailure({ ...series, state: 'failed' }), false);
  assert.equal(cardOutlivesRunFailure(null), false, 'no card: the flip is left to the writer, which no-ops');
  assert.equal(cardOutlivesRunFailure(undefined), false);
});

test('a Start by hand of a card that is not proposed is told its state, and a scheduled card the way on', () => {
  assert.equal(cardStateRefusal({ state: 'started' }), 'card is started');
  assert.equal(cardStateRefusal({ state: 'declined' }), 'card is declined');
  assert.match(cardStateRefusal(oneOff), /^card is scheduled: .*Run now.*cancel the schedule/);
  assert.match(cardStateRefusal(series), /^card is scheduled: .*repeating schedule.*Run now.*Schedules/);
});

test('seriesCardTimePatch: the card\'s time follows the series\' next occurrence, and only when it changed', async () => {
  const schedule = { id: 'sch_aaaa1111', nextRunAt: '2026-12-01T17:00:00.000Z' };
  await checkRows([
    { name: 'moved on → the patch; the same time → nothing to write', run: () => {
      assert.deepEqual(seriesCardTimePatch(series, schedule), { scheduledFor: '2026-12-01T17:00:00.000Z' });
      assert.equal(seriesCardTimePatch({ ...series, scheduledFor: '2026-12-01T17:00:00.000Z' }, schedule), null);
    } },
    { name: 'a paused or ended series has no next time: the card shows none (and only once)', run: () => {
      assert.deepEqual(seriesCardTimePatch(series, { ...schedule, nextRunAt: null }), { scheduledFor: null });
      assert.equal(seriesCardTimePatch({ ...series, scheduledFor: null }, { ...schedule, nextRunAt: null }), null);
    } },
    { name: 'not this series\' card, or no longer scheduled: untouched', run: () => {
      assert.equal(seriesCardTimePatch(series, { ...schedule, id: 'sch_bbbb2222' }), null);
      assert.equal(seriesCardTimePatch({ ...series, state: 'proposed' }, schedule), null, 'the series was deleted and the card handed back');
      assert.equal(seriesCardTimePatch(oneOff, schedule), null);
      assert.equal(seriesCardTimePatch(null, schedule), null);
      assert.equal(seriesCardTimePatch(series, null), null);
    } },
    { name: 'followSeriesCard: reads the series and its card through the deps, writes the patch once, and never throws', run: () => {
      const writes = [];
      const deps = {
        getSchedule: (id) => (id === 'sch_aaaa1111' ? { ...schedule, askThreadId: 'ask_t1', askCardId: 'card_1' } : null),
        findCard: (threadId, cardId) => (threadId === 'ask_t1' && cardId === 'card_1' ? { block: series } : null),
        flipCard: (threadId, cardId, patch) => writes.push([threadId, cardId, patch]),
      };
      assert.deepEqual(followSeriesCard(occurrence('tk-a'), deps), { scheduledFor: '2026-12-01T17:00:00.000Z' });
      assert.deepEqual(writes, [['ask_t1', 'card_1', { scheduledFor: '2026-12-01T17:00:00.000Z' }]]);
      assert.equal(followSeriesCard({ id: 'tk-1', scheduleId: null }, deps), null, 'a one-off ticket');
      assert.equal(followSeriesCard({ id: 'tk-z', scheduleId: 'sch_bbbb2222' }, deps), null, 'a series with no card');
      assert.equal(followSeriesCard(null, deps), null);
      assert.equal(writes.length, 1);
      const logged = [];
      assert.equal(followSeriesCard(occurrence('tk-a'), { ...deps, flipCard: () => { throw new Error('store closed'); }, log: (m) => logged.push(m) }), null);
      assert.match(logged[0], /ask series card follow failed: store closed/);
    } },
  ]);
});
