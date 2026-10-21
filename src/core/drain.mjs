// Stopping and starting without losing work (B2 graceful drain, B3 auto-resume).
//
// Drain: on SIGTERM (a container stop: redeploy, upgrade, a hosted platform suspending the
// instance) or POST /api/drain, the server refuses new runs and scheduled starts, pauses every
// active run with the reason 'drain' (the resume point is saved as on any pause), waits up to
// WORCA_DRAIN_TIMEOUT_MS for the pauses to land, then shuts down as before. Every deployment gets
// this: a stop used to leave runs `interrupted`, needing a manual Resume from an older point.
//
// Auto-resume (runs redesign Known bug 11): on the next start, runs a drain paused continue by
// themselves, as the person who last started or resumed them. WORCA_AUTO_RESUME=0 turns that off;
// WORCA_AUTO_RESUME=1 also resumes runs a crash left `interrupted`.
//
// Pure helpers only; ui/server.mjs owns the live state.

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());

export const DRAIN_TIMEOUT_DEFAULT_MS = 20_000;
const DRAIN_TIMEOUT_MAX_MS = 600_000;

/**
 * How long a drain waits for the runs' pauses to land. 20 s by default: Docker's `stop` and
 * Railway's default give a container 10–30 s between SIGTERM and SIGKILL, and the rest of the
 * shutdown (chat channels, actions, terminals) needs a few seconds after it. Raise it together
 * with the platform's grace period (docker stop -t, Railway's draining time).
 */
export function drainTimeoutMs(env = process.env) {
  return boundedMs(env.WORCA_DRAIN_TIMEOUT_MS);
}

/**
 * How long a CLI run (`worca --yes`, `worca resume`) waits after SIGTERM for its pause to land before it exits
 * anyway (143). The same 20 s default as the drain, for the same platforms: a wedged pause must end before the
 * supervisor's SIGKILL does. Raise WORCA_SIGTERM_GRACE_MS together with the platform's grace period.
 */
export function sigtermGraceMs(env = process.env) {
  return boundedMs(env.WORCA_SIGTERM_GRACE_MS);
}

function boundedMs(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DRAIN_TIMEOUT_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), DRAIN_TIMEOUT_MAX_MS) : DRAIN_TIMEOUT_DEFAULT_MS;
}

/** WORCA_AUTO_RESUME (B3, runs redesign Known bug 11): a start resumes the runs the last stop's drain paused, by
 *  default. '0'/'false' turns it off; '1'/'true' also resumes the runs this start found interrupted (a crash). */
export function autoResumeMode(env = process.env) {
  const v = String(env.WORCA_AUTO_RESUME ?? '').trim();
  if (!v) return 'drain';
  return truthy(v) ? 'all' : 'off';
}

/** Run statuses that a drain waits for (a run still on its way to a pause or a start). */
export const DRAIN_ACTIVE_STATUSES = new Set(['created', 'starting', 'running', 'pausing']);

/**
 * The runs to resume on start, oldest first. `rows`: pipelines rows with id, status,
 * started_by, archived_at and the parsed `resumePoint`. A paused run qualifies only when a drain
 * paused it ('drain'): a person's own pause, a cost cap, a usage limit or an error waits for a
 * person. An interrupted run qualifies only when this start found it running and relabelled it
 * (`interruptedNow`, the ids reconcileStaleRunning returned at boot): the process died under it.
 * An older interrupted run waits for a person, as before. `includeInterrupted: false` (the default
 * mode, autoResumeMode 'drain') leaves every interrupted run to a person. A run with a pending
 * scheduled resume is left to that ticket.
 * @returns {{pipelineId: string, by: string, why: 'drain'|'interrupted'}[]}
 */
export function autoResumeCandidates(rows, { interruptedNow = new Set(), hasResumeTicket = () => false, includeInterrupted = true } = {}) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.id !== 'string' || r.archived_at) continue;
    const rp = r.resumePoint;
    if (!rp || typeof rp !== 'object' || rp.version !== 2) continue;
    let why = null;
    if (r.status === 'paused' && rp.pauseReason === 'drain') why = 'drain';
    else if (includeInterrupted && r.status === 'interrupted' && interruptedNow.has(r.id)) why = 'interrupted';
    if (!why || hasResumeTicket(r.id)) continue;
    const by = (why === 'drain' && typeof rp.resumeAs === 'string' && rp.resumeAs) || r.started_by || 'local';
    out.push({ pipelineId: r.id, by, why });
  }
  return out;
}
