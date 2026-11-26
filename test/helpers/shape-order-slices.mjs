// test/helpers/shape-order-slices.mjs — literal featureView slice rows of the 16-run feature
// (test/helpers/shape-sixteen-runs.mjs), as the run order map reads them: no database, no server.
import { SIXTEEN_RUN_LINKS, SIXTEEN_RUN_STATES } from './shape-sixteen-runs.mjs';

const NOT_STARTED = new Set(['planned', 'held']);
const atStop = (reason, extra = {}) => ({ state: 'approval', stop: { reason, held: false, ...extra } });

/**
 * Slice rows from `[run, buildsOn]` pairs: every run is `planned` unless it is `done` or `states[run]` says otherwise.
 * A run not started gets `waitsFor`, its unfinished builds-on runs.
 */
export function slicesOf(links, { done = [], states = {} } = {}) {
  const finished = new Set([...done, ...links.map(([run]) => run).filter((run) => states[run]?.state === 'done')]);
  return links.map(([run, buildsOn]) => {
    const s = { index: run, title: `Run ${run}`, kind: null, buildsOn: [...buildsOn],
      state: finished.has(run) ? 'done' : 'planned', ...(states[run] || {}) };
    if (NOT_STARTED.has(s.state) && !s.waitsFor) s.waitsFor = buildsOn.filter((d) => !finished.has(d));
    return s;
  });
}

export const SIXTEEN_PAIRS = SIXTEEN_RUN_LINKS.map(({ run, dependsOn }) => [run, [...dependsOn]]);

/** The fixture's walked state as slice rows: `{stop}` is a run at that stop, `{pipe}` a run in that state. */
const fromFixture = ({ done, states }, extra = {}) => ({ done, states: { ...Object.fromEntries(Object.entries(states)
  .map(([run, how]) => [run, how.stop ? atStop(how.stop) : { state: how.pipe }])), ...extra } });

/** The walked states, as `{done, states}` for slicesOf: the 16-run fixture's, plus run 9 next and the held world. */
export const ORDER_STATES = Object.freeze({
  none: {},
  base: fromFixture(SIXTEEN_RUN_STATES.base, { 9: { nextTurn: true } }),
  busy: fromFixture(SIXTEEN_RUN_STATES.busy, { 9: { nextTurn: true } }),
  held: { done: [1], states: { 2: atStop('requirement'), 3: { state: 'running' }, 4: atStop('check', { held: true, after: 3 }) } },
});

/** The 16 slice rows in a named state, or in a literal `{done, states}`. */
export function sixteenSlices(spec = 'none') {
  return slicesOf(SIXTEEN_PAIRS, typeof spec === 'string' ? ORDER_STATES[spec] : spec);
}
