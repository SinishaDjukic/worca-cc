// src/core/ask/schedule-card.mjs
// An Ask run card that was scheduled (docs/scheduled-runs.md "Chat"), as a firing ticket sees it. Pure: the card
// block, the ticket and the schedule are passed in; followSeriesCard's readers and its one writer are injected.
//
// A one-off card waits as ONE ticket: `block.runId` is that ticket, and the fire flips it to `started`.
// A card that became a repeating schedule follows the SERIES: `block.runId` is null and `block.scheduleId`
// names the series, so each occurrence's ticket owns it through the schedule id (#1567) — the card stays
// `scheduled`, and its time follows the occurrence materialised next.

/** May this ticket start the card? Only a `scheduled` card is anyone's: the one-off it was scheduled as, or the series it follows. */
export function cardOwnedByTicket(block, ticket) {
  if (!block || !ticket || block.state !== 'scheduled') return false;
  if (block.runId === ticket.id) return true;
  return cardFollowsSeries(block, ticket);
}

/** True when the card follows the ticket's repeating schedule rather than this one occurrence. */
export function cardFollowsSeries(block, ticket) {
  return !!(block && ticket && ticket.scheduleId && block.scheduleId === ticket.scheduleId);
}

/** Does the card outlive a failure of a run linked to it? A card that follows a series does (one occurrence failing
 *  is the thread's notice and the schedule's streak, never a `failed` card that would refuse the next occurrence), and
 *  so does a card handed back as `proposed` (the series was deleted while an occurrence ran). Read from the card at
 *  fail time, never from the launch: a resumed occurrence re-attaches its follower from the link row alone. */
export function cardOutlivesRunFailure(block) {
  if (!block) return false;
  if (block.state === 'proposed') return true;
  return block.state === 'scheduled' && !!block.scheduleId;
}

/** The 409 for a Start by hand of a card that is not `proposed`: its state, and for a scheduled card the way on. */
export function cardStateRefusal(block) {
  if (block.state !== 'scheduled') return `card is ${block.state}`;
  return block.scheduleId
    ? 'card is scheduled: it is a repeating schedule now. Use Run now on the card, or manage it in Schedules'
    : 'card is scheduled: it already waits as a scheduled run. Use Run now on the card, or cancel the schedule to start it by hand';
}

/** The card patch that moves a series card's time to its schedule's next occurrence (null when there is nothing
 *  to change: not this series' card, no longer `scheduled`, or already showing that time). A paused or ended
 *  series has no next time, and the card shows none. */
export function seriesCardTimePatch(block, schedule) {
  if (!block || !schedule || block.state !== 'scheduled' || block.scheduleId !== schedule.id) return null;
  const next = schedule.nextRunAt || null;
  if ((block.scheduledFor || null) === next) return null;
  return { scheduledFor: next };
}

/** After a scheduler tick fired, failed or skipped a series' ticket, the series card's time follows the schedule.
 *  `getSchedule(id)` and `findCard(threadId, cardId)` → `{ block }` read; `flipCard(threadId, cardId, patch)` writes.
 *  Best effort: a throw is logged, never raised. Returns the patch written, or null. */
export function followSeriesCard(ticket, { getSchedule, findCard, flipCard, log = () => {} }) {
  try {
    const s = ticket && ticket.scheduleId ? getSchedule(ticket.scheduleId) : null;
    const found = s && s.askThreadId && s.askCardId ? findCard(s.askThreadId, s.askCardId) : null;
    const patch = found ? seriesCardTimePatch(found.block, s) : null;
    if (patch) flipCard(s.askThreadId, s.askCardId, patch);
    return patch;
  } catch (err) {
    log(`[worca-ui] ask series card follow failed: ${err && err.message ? err.message : err}`);
    return null;
  }
}
