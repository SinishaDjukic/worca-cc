// src/core/limit-resume.mjs
// The automatic usage-limit resume's pure decision (D6/D7). The server's validateResumeTarget owns
// the guards it shares with every scheduled resume (archived, cap pause, an existing ticket).
import { LIMIT_RESUME_MARGIN_MS } from './recoverable-error.mjs';

/** D7: automatic limit resumes in a row before Worca stops scheduling them. */
export const AUTO_LIMIT_RESUMES_MAX = 3;

/**
 * @param {{ enabled: boolean, rp: object|null, now?: number }} o
 * @returns {{ schedule: true, at: number, resetAt: number } | { skip: true, why: string }}
 */
export function limitResumeDecision({ enabled, rp, now = Date.now() }) {
  if (!enabled) return { skip: true, why: 'the setting is off' };
  if (!rp || rp.pauseReason !== 'usage_limit') return { skip: true, why: 'not a usage-limit pause' };
  const resetAt = Date.parse(rp.limitResetAt ?? '');
  if (!Number.isFinite(resetAt)) return { skip: true, why: 'the reset time is unknown' };
  const streak = Number.isSafeInteger(rp.autoLimitResumes) ? rp.autoLimitResumes : 0;
  if (streak >= AUTO_LIMIT_RESUMES_MAX) {
    return { skip: true, why: `the run already resumed automatically ${streak} times in a row after a usage limit` };
  }
  return { schedule: true, at: Math.max(resetAt + LIMIT_RESUME_MARGIN_MS, now), resetAt };
}
