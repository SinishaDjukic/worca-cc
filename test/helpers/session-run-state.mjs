// test/helpers/session-run-state.mjs — a run state with one session (Task 56's fixture as a builder): Plan → Implementation
// → Review, the last two in session s_aaaaaaaa, Review running, the session at turn 5.
export const SID = 's_aaaaaaaa';

const node = (id, label, session) => ({ id, kind: 'agent', key: label.toLowerCase(), x: 0, y: 0, label, color: '', config: session ? { session: SID } : {},
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });

export const SESSION_STEPPER = { version: 2, template: { id: 'wf', name: 'W' }, bookends: { preflight: true, done: true }, graph: {
  nodes: [node('n_plan', 'Plan'), node('n_impl', 'Implementation', true), node('n_review', 'Review', true)],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_review', port: 'task' }, loop: false }] } };

const row = (nodeId, status, ord = 1) => ({ key: `x:${nodeId}:${ord}`, executionId: `x:${nodeId}:${ord}`, nodeId, ordinal: ord, cycle: ord, status, activeMs: 60000, costUsd: 0.5 });

export function groupedRunningState() {
  return { stepper: SESSION_STEPPER, status: 'running', runEngine: 'claude',
    steps: [row('n_plan', 'done'), row('n_impl', 'done'), row('n_review', 'running')],
    active: [{ nodeId: 'n_review', executionId: 'x:n_review:1' }],
    sessionHosts: { [SID]: { sid: SID, label: 'One session', mode: 'subagents', modeReason: 'ok', engine: 'claude', transport: 'turns', hostEpoch: 1, hostSessionId: 'H',
      hostModel: null, status: 'busy', turns: 5, dispatches: 5, rotations: 0, restarts: 0, costUsd: 2.41, hostOverheadUsd: 0.06, members: ['n_impl', 'n_review'], reconciled: true } } };
}
