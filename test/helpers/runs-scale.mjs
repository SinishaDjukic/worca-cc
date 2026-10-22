// test/helpers/runs-scale.mjs — spec §5a.8: 300 runs in 20 groups, built from the recorded §2.1 states
// (test/helpers/run-states.mjs). 200 single runs cycle the states (live ones as live items); 20 features of 5
// members each, the last member waiting.
import { RUN_STATE_ROWS, NOW } from './run-states.mjs';

const LIVE = new Set(['starting', 'working', 'needs-you', 'paused']);
const at = (ms) => new Date(NOW - ms).toISOString();

export function scaleRuns({ singles = 200, groups = 20, perGroup = 5, shift = 0 } = {}) {
  const live = [];
  const history = [];
  const groupItems = [];
  for (let i = 0; i < singles; i++) {
    const s = RUN_STATE_ROWS[(i + shift) % RUN_STATE_ROWS.length];
    const st = s.state === 'waiting' ? RUN_STATE_ROWS.find((x) => x.state === 'ready') : s;
    if (LIVE.has(st.state)) {
      live.push({ runId: `r${i}`, pipelineId: `p${i}`, title: `Run ${i}`, status: st.run.status, startedAt: at(i * 6e4), run: st.run,
        ask: st.state === 'needs-you' ? { kind: 'questions', step: '', outline: false } : null });
    } else {
      history.push({ id: `p${i}`, projectKey: `k${i % 6}`, title: `Run ${i}`, status: st.run.status, run: st.run, startedAt: at(i * 36e5) });
    }
  }
  for (let g = 0; g < groups; g++) {
    const members = [];
    for (let j = 0; j < perGroup; j++) {
      const id = `g${g}m${j}`;
      const s = j === perGroup - 1 ? RUN_STATE_ROWS.find((x) => x.state === 'waiting')
        : RUN_STATE_ROWS.find((x) => x.state === ((g + j + shift) % 4 === 0 ? 'needs-you' : 'ready'));
      if (s.state !== 'waiting') history.push({ id, projectKey: 'k1', title: id, status: s.run.status, run: s.run, startedAt: at(g * 72e5) });
      members.push({ position: j + 1, title: `Slice ${j + 1}`, pipelineId: s.state === 'waiting' ? '' : id,
        ticketId: s.state === 'waiting' ? `t${g}` : '', kind: s.state === 'waiting' ? 'sched' : 'hist', run: s.run });
    }
    groupItems.push({ id: `feat_${g}`, groupKind: 'feature', title: `Feature ${g}`, members });
  }
  return { live, history, groups: groupItems };
}
