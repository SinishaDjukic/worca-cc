// ui/public/chat/rounds.mjs — Shaper s5 (D16, D21, D23): a plain run card's rounds (snap.rounds from GET /api/ask/runs/:id
// extras) and its stopped watch (snap.watch). Pure: the controller hands each round's live snapshot through `snapOf`.
// The live round's status line is runModel's (its `round` input, from liveRound), not this module's.
import { roundText } from '../../../src/shared/shape/feature-log.mjs';
import { watchStoppedText } from './pr-watch-words.mjs';

/** @returns {{log: Array<{key: string, run: null, text: string, detail: string[]}>, watch: {text: string, prUrl: string|null}|null}} */
export function roundsModel(snap) {
  const list = (snap && Array.isArray(snap.rounds)) ? snap.rounds : [];
  const lastFix = [...list].reverse().find((r) => r.by === 'watch');
  const wText = watchStoppedText(snap && snap.watch, lastFix ? lastFix.kinds : []);
  const watch = wText ? { text: wText, prUrl: snap.watch.prUrl || null } : null;
  if (!list.length) return { log: [], watch };
  const log = [{ key: 'round-1', run: null, text: roundText(1, snap.title || ''), detail: [] },
    ...list.map((r) => ({ key: `round-${r.round}`, run: null, text: roundText(r.round, r.request, r.status, r.outcome), detail: [] }))];
  return { log, watch };
}

/** The round that is live now, for runModel's `round` input: `{ r, m }` (m: its live snapshot, or null), else null. */
export function liveRound(snap, snapOf = () => null) {
  const list = snap && Array.isArray(snap.rounds) ? snap.rounds : [];
  for (const r of [...list].reverse()) {
    const m = snapOf(r.pipelineId);
    if (m ? m.source === 'live' && !m.terminal : r.status === 'running' || r.status === 'starting') return { r, m };
  }
  return null;
}
