/**
 * Tier 1 event renderers — map pipeline event envelopes to NormalizedMessage.
 * @module renderers
 */

// ---------------------------------------------------------------------------
// Segment constructors
// ---------------------------------------------------------------------------

/** @param {string} value @returns {import('./adapter.js').MessageSegment} */
const t = (value) => ({ kind: 'text', value });

/** @param {string} value @returns {import('./adapter.js').MessageSegment} */
const b = (value) => ({ kind: 'bold', value });

/** @param {string} value @returns {import('./adapter.js').MessageSegment} */
const c = (value) => ({ kind: 'code', value });

/** @param {string} value @param {string} href @returns {import('./adapter.js').MessageSegment} */
const link = (value, href) => ({ kind: 'link', value, href });

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

function fmtUsd(usd) {
  return `$${Number(usd).toFixed(2)}`;
}

function runLabel(envelope) {
  return envelope.run_id ?? 'run';
}

// ---------------------------------------------------------------------------
// Per-event renderers
// ---------------------------------------------------------------------------

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunCompleted(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [
      b('✓'),
      t(' '),
      c(runLabel(envelope)),
      t(` done · ${fmtMs(p.duration_ms)} · ${fmtUsd(p.total_cost_usd)}`),
    ],
    severity: 'success',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunFailed(envelope) {
  const p = envelope.payload;
  const errLabel = p.error_type ?? p.error ?? 'error';
  const stage = p.failed_stage ?? 'unknown';
  return {
    title: null,
    body: [
      b('✗'),
      t(' '),
      c(runLabel(envelope)),
      t(' failed at '),
      c(stage),
      t(' · '),
      t(errLabel),
    ],
    severity: 'error',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunInterrupted(envelope) {
  const p = envelope.payload;
  const stage = p.interrupted_stage ?? 'unknown';
  return {
    title: null,
    body: [
      b('⏸'),
      t(' '),
      c(runLabel(envelope)),
      t(' interrupted at '),
      c(stage),
      t(` (${fmtMs(p.elapsed_ms)} in)`),
    ],
    severity: 'warning',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderGitPrCreated(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [
      b('🔀 PR opened'),
      t(': '),
      link(`#${p.pr_number}`, p.pr_url),
      t(` — ${p.title}`),
    ],
    severity: 'info',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderGitPrMerged(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [b('✅ PR merged'), t(': '), link(`#${p.pr_number}`, p.pr_url)],
    severity: 'success',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderCbTripped(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [
      b('⚠'),
      t(` ${p.consecutive_failures}× `),
      c(p.category),
      t(' — run halted'),
    ],
    severity: 'error',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderCostBudgetWarning(envelope) {
  const p = envelope.payload;
  const pct = Math.round(p.pct_used * 100);
  return {
    title: null,
    body: [
      b('💸'),
      t(' '),
      c(runLabel(envelope)),
      t(` at ${pct}% of ${fmtUsd(p.budget_usd)} budget`),
    ],
    severity: 'warning',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunStarted(envelope) {
  const p = envelope.payload;
  const title = p.title ?? p.prompt ?? '';
  const label = title.length > 60 ? `${title.slice(0, 60)}…` : title;
  return {
    title: null,
    body: [
      b('▶'),
      t(' '),
      c(runLabel(envelope)),
      t(' started'),
      ...(label ? [t(' — '), t(label)] : []),
    ],
    severity: 'info',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunPaused(envelope) {
  const p = envelope.payload;
  const stage = p.stage ?? '';
  return {
    title: null,
    body: [
      b('⏸'),
      t(' '),
      c(runLabel(envelope)),
      t(' paused'),
      ...(stage ? [t(' at '), c(stage)] : []),
    ],
    severity: 'warning',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunResumed(envelope) {
  return {
    title: null,
    body: [b('▶'), t(' '), c(runLabel(envelope)), t(' resumed')],
    severity: 'info',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderRunResumedFromPause(envelope) {
  return {
    title: null,
    body: [b('▶'), t(' '), c(runLabel(envelope)), t(' resumed from pause')],
    severity: 'info',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderStageStarted(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [
      t('⚙ '),
      c(runLabel(envelope)),
      t(' → '),
      b(p.stage ?? 'unknown'),
      ...(p.iteration ? [t(` (iter ${p.iteration})`)] : []),
    ],
    severity: 'info',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderStageCompleted(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [
      t('✓ '),
      c(runLabel(envelope)),
      t(' '),
      b(p.stage ?? 'unknown'),
      t(' done'),
      ...(p.duration_ms ? [t(` · ${fmtMs(p.duration_ms)}`)] : []),
    ],
    severity: 'success',
  };
}

/** @param {object} envelope @returns {import('./adapter.js').NormalizedMessage} */
function renderStageInterrupted(envelope) {
  const p = envelope.payload;
  return {
    title: null,
    body: [
      b('⏸'),
      t(' '),
      c(runLabel(envelope)),
      t(' '),
      b(p.stage ?? 'unknown'),
      t(' interrupted'),
    ],
    severity: 'warning',
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const EVENT_RENDERERS = {
  'pipeline.run.started': renderRunStarted,
  'pipeline.run.completed': renderRunCompleted,
  'pipeline.run.failed': renderRunFailed,
  'pipeline.run.interrupted': renderRunInterrupted,
  'pipeline.run.paused': renderRunPaused,
  'pipeline.run.resumed': renderRunResumed,
  'pipeline.run.resumed_from_pause': renderRunResumedFromPause,
  'pipeline.stage.started': renderStageStarted,
  'pipeline.stage.completed': renderStageCompleted,
  'pipeline.stage.interrupted': renderStageInterrupted,
  'pipeline.git.pr_created': renderGitPrCreated,
  'pipeline.git.pr_merged': renderGitPrMerged,
  'pipeline.circuit_breaker.tripped': renderCbTripped,
  'pipeline.cost.budget_warning': renderCostBudgetWarning,
};

export const TIER1_EVENTS = Object.keys(EVENT_RENDERERS);

/**
 * Map a pipeline event envelope to a NormalizedMessage.
 * Returns null for unrecognised event types.
 *
 * @param {object|null|undefined} envelope - event envelope (event_type, run_id, payload)
 * @returns {import('./adapter.js').NormalizedMessage|null}
 */
export function renderEvent(envelope) {
  const renderer = EVENT_RENDERERS[envelope?.event_type];
  if (!renderer) return null;
  return renderer(envelope);
}
