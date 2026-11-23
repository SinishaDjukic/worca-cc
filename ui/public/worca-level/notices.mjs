// ui/public/worca-level/notices.mjs — the run-finished message: when the viewer's own run finishes, a toast says
// how many real runs count toward Runner, or that a demo run does not. Pure; app.js queues, app-wiring shows.

/** Real runs Runner asks for. */
export const REAL_RUNS_FOR_RUNNER = 3;
const RUNNER_LEVEL = 2;
export const DEMO_RUN_COPY = "Demo runs don't count. Try one on your project.";

/** True when `r` is the viewer's own run: any run on a local install, else one `viewer.name` started. */
function isOwnRun(r, viewer) {
  if (!viewer || !viewer.shared) return true;
  const by = r && typeof r.startedBy === 'string' ? r.startedBy : '';
  return !!viewer.name && !!by && by.toLowerCase() === viewer.name.toLowerCase();
}

/**
 * What to queue when a run finishes: `{ runId, real }` for the viewer's own run that finished `done` on a frame
 * that says `real`; else null (error, stopped and paused runs, someone else's run, a frame with no `real` such as
 * the recovery broadcast).
 */
export function ownFinishedRun(r, status, frame, viewer) {
  if (status !== 'done' || !r || !frame || typeof frame.real !== 'boolean') return null;
  if (!isOwnRun(r, viewer)) return null;
  return { runId: r.runId, real: frame.real };
}

/** The real-run count the refreshed view reports: the Runner `realRuns` item, on the ladder or as the next step. */
function realRunCount(view) {
  const items = [...(view.next || []), ...((view.ladder || []).find((l) => l.index === RUNNER_LEVEL)?.items || [])];
  const item = items.find((i) => i && i.id === 'realRuns');
  return Number.isFinite(item?.count) ? item.count : null;
}

/** The toast for a queued finish, or null: nothing at Runner or above, nothing without a view. */
export function runFinishedNotice(view, queued) {
  if (!view || !queued) return null;
  if ((view.level?.index ?? 0) >= RUNNER_LEVEL) return null;
  if (!queued.real) return { title: DEMO_RUN_COPY };
  const n = realRunCount(view);
  if (n === null) return null;
  return { title: `${Math.min(n, REAL_RUNS_FOR_RUNNER)} of ${REAL_RUNS_FOR_RUNNER} real runs toward Runner` };
}

/** The almost-there toast for a served view: `{ id, title }`, or null when the view offers none. */
export function nudgeNotice(view) {
  const n = view && view.nudge;
  if (!n || typeof n.id !== 'string' || !n.id || typeof n.text !== 'string' || !n.text) return null;
  return { id: n.id, title: n.text };
}
