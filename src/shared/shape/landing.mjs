// src/shared/shape/landing.mjs — Shaper s5: where "Ask for changes" lands (runs spec §3.6). Pure, no imports: the server
// mints the changes card from it and the tests assert it directly.
export const isMerged = (pr) => !!pr && String(pr.state || '').toUpperCase() === 'MERGED';
/** The branch a round commits onto: the run's feature branch, or its source when it ran on the source branch. */
export const roundHead = (b) => (b ? (b.sameAsSource ? b.source : b.feature) || null : null);
const prRef = (pr) => (pr && pr.url ? { number: pr.number ?? null, url: pr.url } : null);
const NOT_STARTED = new Set(['planned', 'missed']);
const HALTED = new Set(['stopped', 'error', 'failed', 'paused']);   // features.mjs HALTS

function round({ origin, label, rounds = 1, pr, before = false }) {
  const head = roundHead(origin && origin.branch);
  if (!head) return null;
  const n = (Number(rounds) || 1) + 1;
  const where = before ? 'same branch, before Ship' : pr ? 'same branch, same PR' : 'same branch';
  return { kind: 'round', title: `Changes to ${label} · ${where}`, start: `Start round ${n}`,
    target: { roundOf: origin.pipelineId, round: n, sourceBranch: head, pr: prRef(pr) } };
}

/**
 * @param {{run?: {pipelineId: string, title: string, label?: string, finished?: boolean, branch: object|null, pr: object|null, rounds?: number}|null,
 *   feature?: {id: string, title: string, base: string|null, shipPr: object|null,
 *     slices: Array<{index: number, state: string, pipelineId: string|null, title: string, branch: object|null, pr: object|null, rounds?: number}>}|null}} facts
 * @returns {{kind: 'round'|'next-plan'|'extra-run'|'follow-up', title: string, start: string, target: object}|null}
 */
export function landingFor({ run = null, feature = null } = {}) {
  if (feature) {
    const all = feature.slices || [];
    const n = all.length;                                         // numbering counts every row, canceled ones too
    const slices = all.filter((s) => s.state !== 'canceled');
    const last = slices[slices.length - 1] || null;
    if (!last) return null;
    if (slices.some((s) => HALTED.has(s.state))) return null;     // resume or re-plan first (the card's own buttons, s3)
    const allDone = slices.every((s) => s.state === 'done');
    if (allDone && (isMerged(feature.shipPr) || isMerged(last.pr))) {
      return { kind: 'follow-up', title: `Follow-up to ${feature.title} · Run ${n + 1} from ${feature.base || 'the base'}, own PR`,
        start: `Start Run ${n + 1}`, target: { featureId: feature.id, sourceBranch: feature.base || null, index: n + 1 } };
    }
    const next = slices.find((s) => NOT_STARTED.has(s.state));
    if (next) {
      return { kind: 'next-plan', title: `Changes to ${feature.title} · into Run ${next.index}'s plan`,
        start: `Add to Run ${next.index}'s plan`, target: { featureId: feature.id, index: next.index } };
    }
    if (!allDone) {
      const going = [...slices].reverse().find((s) => s.state !== 'done') || last;
      return { kind: 'extra-run', title: `Changes to ${feature.title} · as Run ${n + 1} after Run ${going.index}`,
        start: `Add Run ${n + 1}`, target: { featureId: feature.id, index: n + 1 } };
    }
    return round({ origin: last, label: `Run ${last.index}`, rounds: last.rounds, pr: last.pr, before: !feature.shipPr });
  }
  if (!run || run.finished === false || !roundHead(run.branch)) return null;
  if (isMerged(run.pr)) {
    const base = run.branch.source || 'the base';
    return { kind: 'follow-up', title: `Follow-up to ${run.title} · from ${base}, own PR`, start: 'Start follow-up',
      target: { featureId: null, sourceBranch: run.branch.source || null, index: null } };
  }
  return round({ origin: run, label: run.label || run.title, rounds: run.rounds, pr: run.pr });
}
