// ui/public/chat/rounds.mjs — Shaper s5 (D16, D21, D23): a plain run card's rounds (snap.rounds from GET /api/ask/runs/:id
// extras) and its stopped watch (snap.watch). Pure: the controller hands each round's live snapshot through `snapOf`.
import { liveRowState } from '../runs-list.mjs';
import { ICON_WORD } from '../shape/feature-card.mjs';
import { roundText } from '../../../src/shared/shape/feature-log.mjs';
import { watchStoppedText } from './pr-watch-words.mjs';

/** @returns {{status: string|null, log: Array<{key: string, run: null, text: string, detail: string[]}>, watch: {text: string, prUrl: string|null}|null,
 *   icon?: string, word?: string, run?: object|null}} icon, word and run only while a round is live */
export function roundsModel(snap, snapOf = () => null) {
  const list = (snap && Array.isArray(snap.rounds)) ? snap.rounds : [];
  const lastFix = [...list].reverse().find((r) => r.by === 'watch');
  const wText = watchStoppedText(snap && snap.watch, lastFix ? lastFix.kinds : []);
  const watch = wText ? { text: wText, prUrl: snap.watch.prUrl || null } : null;
  if (!list.length) return { status: null, log: [], watch };
  const log = [{ key: 'round-1', run: null, text: roundText(1, snap.title || ''), detail: [] },
    ...list.map((r) => ({ key: `round-${r.round}`, run: null, text: roundText(r.round, r.request, r.status, r.outcome), detail: [] }))];
  const live = [...list].reverse().find((r) => { const m = snapOf(r.pipelineId); return m ? m.source === 'live' && !m.terminal : r.status === 'running'; });
  if (!live) return { status: null, log, watch };
  const m = snapOf(live.pipelineId);
  const icon = m ? liveRowState({ status: m.status, ask: !!m.pendingQuestion }).icon : 'run';
  // A Watch PR fix round says what it fixes; any other round names its stage.
  const doing = live.by === 'watch' ? live.request : (m && m.stageProgress && m.stageProgress.label) || 'Build';
  // icon/word/run: the live round's runs-list glyph, its word and its progress (the card's head shows the round, D16).
  return { status: [ICON_WORD[icon] || 'Running', `Round ${live.round}`, doing].join(' · '), log, watch,
    icon, word: ICON_WORD[icon] || 'Running', run: (m && m.stageProgress) || null };
}
