// src/core/worca-levels/view.mjs
// The WorcaLevelView (view v2): what GET /api/worca-level serves, built from a person's record, the evaluation
// and the facts. Pure; the service owns the reads and the record writes. Level 0 (no level yet) is `level: null`
// with `setup.missing` naming what is left to finish.
import { WORCA_LEVELS, WORCA_LEVEL_COUNT, WORCA_THRESHOLDS } from '../../shared/worca-levels.mjs';
import { pickNudge } from './nudge.mjs';

const levelView = ({ index, key, name, tint, hue, tagline, description, hat, phrase, recap, avatar }) =>
  ({ index, key, name, tint, hue, tagline, description, hat, phrase, recap, avatar });

/** reached / current / next / later; at level 0 the first level is `next` and the rest `later`. */
export function ladderState(index, level) {
  if (index < level) return 'reached';
  if (index === level) return 'current';
  return index === level + 1 ? 'next' : 'later';
}

function celebrationView(current, ev) {
  const { index, key, name, tint, hue, hat, phrase, recap, avatar } = current;
  return {
    index, key, name, tint, hue, hat, phrase, recap, avatar,
    nextName: ev.nextLevel?.name ?? null,
    nextTotal: ev.progress?.total ?? null,
    nextUnit: ev.progress?.unit ?? null,
  };
}

/** What is left before level 1: 'setup' and/or 'provider'. Empty once any level is held. */
function setupView(facts, level) {
  const finished = facts.setupFinished === true;
  const providerSignedIn = facts.providerSignedIn === true;
  const missing = level >= 1 ? [] : [...(finished ? [] : ['setup']), ...(providerSignedIn ? [] : ['provider'])];
  return { finished, providerSignedIn, missing };
}

/** The labels of what is done in one ladder level: a pick item contributes its done choices, not its own label. */
const doneLabels = (items) => items.flatMap((v) => (v.kind === 'pick' ? v.choices : [v]).filter((c) => c.done).map((c) => c.label));

/** The one summary of a first v2 evaluation: the levels credited (from, to] with their dates, and what was done in them. */
function summaryView(summary, ev) {
  if (!summary || summary.shownAt !== null) return null;
  const credited = WORCA_LEVELS.filter(({ index }) => index > summary.from && index <= summary.to);
  return {
    from: summary.from,
    to: summary.to,
    levels: credited.map(({ index, name, avatar }) => ({ index, name, avatar, reachedAt: ev.reachedAt?.[index] ?? null })),
    items: credited.flatMap(({ index }) => doneLabels(ev.levels[index])),
  };
}

/** The interface mode worth offering now: Expert from level 4, else Advanced from level 3, each until it is answered
 *  (D-16). A dismissed Expert is not followed by Advanced: the offer does not step down. */
export function modeSuggestionOf(record, level) {
  const answered = record?.modeSuggestion ?? {};
  if (level >= 4 && !answered.expert) return 'expert';
  if (level >= 3 && !answered.advanced && answered.expert !== 'dismissed') return 'advanced';
  return null;
}

export function toView(record, ev, facts) {
  const current = ev.level >= 1 ? WORCA_LEVELS[ev.level - 1] : null;
  const celebrating = !!current && ev.level > record.celebrated;
  return {
    count: WORCA_LEVEL_COUNT,
    level: current ? levelView(current) : null,
    setup: setupView(facts, ev.level),
    progress: ev.progress,
    next: ev.next,
    nextLevel: ev.nextLevel,
    top: ev.top,
    ladder: WORCA_LEVELS.map(({ index, key, name, tint, hue, description, avatar }) => ({
      index, key, name, tint, hue, description, avatar, state: ladderState(index, ev.level),
      reachedAt: index <= ev.level ? (ev.reachedAt?.[index] ?? null) : null,
      items: ev.levels[index],
    })),
    runner: {
      realRuns: facts.realRuns ?? 0,
      of: WORCA_THRESHOLDS.runnerRealRuns,
      stepsDone: facts.runnerSteps?.done ?? 0,
      stepsOf: WORCA_THRESHOLDS.runnerSteps,
    },
    onTeam: facts.teamMetricsOn === true || facts.teamPolicyOn === true,
    celebration: celebrating ? celebrationView(current, ev) : null,
    summary: summaryView(record.summary, ev),
    nudge: pickNudge(ev, record),
    modeSuggestion: modeSuggestionOf(record, ev.level),
  };
}
