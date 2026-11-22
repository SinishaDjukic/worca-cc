// Shared labels for the "pull from Requirements" feature: the displayed state, the readiness text and the live-run test.
// The Requirements page imports these.

// The displayed state, always the server's `f.state`. `started` is drawn as the latest run's pill elsewhere.
export const STATE = Object.freeze({
  looking: { label: 'Looking', cls: 'running' },
  thinking: { label: 'Thinking', cls: 'running' },
  your_turn: { label: 'Your turn', cls: 'amber' },
  decide: { label: 'Decide', cls: 'amber' },
  ready: { label: 'Ready', cls: 'green' },
  started: { label: 'Started', cls: '' },
  archived: { label: 'Archived', cls: '' },
});

/** The readiness checks a feature is held against (the server's value). */
export const READY_CHECKS = 6;

/** Run statuses that count as live; equals the server's DRAIN_ACTIVE_STATUSES (src/core/drain.mjs). */
export const RUN_LIVE = Object.freeze(['created', 'starting', 'running', 'pausing']);

/** "Ready N of 6", or "—" when the summary carries no numeric `ready`. */
export const readyText = (summary) => (summary && typeof summary.ready === 'number' && Number.isFinite(summary.ready)
  ? `Ready ${summary.ready} of ${READY_CHECKS}` : '—');

/** The first start whose run is live, else null. */
export const liveStart = (starts) => (Array.isArray(starts)
  ? starts.find((s) => s && s.run && RUN_LIVE.includes(s.run.status)) || null : null);
