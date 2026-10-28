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

/** A command that ended with a non-zero exit code. */
export function isFailed(v) { return !!v && v.status === 'done' && v.exitCode != null && v.exitCode !== 0; }

/** Still running. A view not loaded yet (null) counts only in the live turn (D5): on a reload it is a finished one. */
const isRunning = (v, live) => (v ? v.status === 'running' : !!live);

/** The group head's parts: `{ lead, count, failed, dur, running }`. `current`: the running command's summary line, which
 *  leads the head while it runs (`count` then says how many: '3 commands'); else 'Ran 3 commands' / 'Running 3 commands'. */
export function groupHeadParts(views, now = Date.now(), live = false, current = '') {
  const total = views.reduce((s, v) => s + elapsedMs(v, now), 0);
  const running = views.some((v) => isRunning(v, live));
  const n = `${views.length} commands`;
  const lead = running && current ? current : `${running ? 'Running' : 'Ran'} ${n}`;
  return { lead, count: running && current ? n : '', failed: views.filter(isFailed).length, dur: fmtCmdDur(total), running };
}

/** The group head: "Ran 3 commands · 1 failed · 6.1s" (no failed part at 0). */
export function groupHead(views, now = Date.now(), live = false, current = '') {
  const p = groupHeadParts(views, now, live, current);
  return [p.lead, p.count, p.failed ? `${p.failed} failed` : '', p.dur].filter(Boolean).join(' · ');
}

/** Whether a group shows its rows: folded to its head line, running or failed, until the person opens it. */
export function groupOpen(choice) {
  return choice === true;
}
