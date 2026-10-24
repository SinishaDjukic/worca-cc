// ui/public/ask-command-group.mjs
// Command summaries (#911): which consecutive chat command cards share one card, and the group head's words. Pure.
import { fmtDur } from './graph/run-decor.mjs';

/** `isCommand[i]`: card i is a command card. `pieces`: the answer cut at each card (pieces[i] is the text before card i,
 *  as answerPieces returns it). Returns [start, end] index ranges of 2+ consecutive command cards with only blank
 *  text between them. */
export function commandRuns(isCommand, pieces) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < isCommand.length; i += 1) {
    const joins = start >= 0 && isCommand[i] && !String(pieces[i] || '').trim();
    if (joins) continue;
    if (start >= 0 && i - 1 > start) runs.push([start, i - 1]);
    start = isCommand[i] ? i : -1;
  }
  if (start >= 0 && isCommand.length - 1 > start) runs.push([start, isCommand.length - 1]);
  return runs;
}

/** `1.4s` under 10 s, else the run cards' `38s` / `2m 10s`. */
export function fmtCmdDur(ms) {
  const n = Math.max(0, Number(ms) || 0);
  return n < 10_000 ? `${(n / 1000).toFixed(1)}s` : fmtDur(n);
}

/** Elapsed time of one command view: its duration when ended, else since it started. */
export function elapsedMs(v, now = Date.now()) {
  if (v && Number.isFinite(v.durationMs)) return v.durationMs;
  const t0 = v ? (typeof v.startedAt === 'number' ? v.startedAt : Date.parse(v.startedAt)) : NaN;
  return Number.isFinite(t0) ? Math.max(0, now - t0) : 0;
}

/** The group head: "3 commands · 6.1s". */
export function groupHead(views, now = Date.now()) {
  const total = views.reduce((s, v) => s + elapsedMs(v, now), 0);
  return `${views.length} commands · ${fmtCmdDur(total)}`;
}
