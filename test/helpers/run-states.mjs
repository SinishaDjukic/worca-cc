// test/helpers/run-states.mjs — the 10 spec §2.1 states as raw runs, built from the recorded wf_default replay
// (test/fixtures/run-replay/wf_default.json): a running frame, the frame with the Clarify question, the final frame.
import { readFileSync } from 'node:fs';

const REPLAY = JSON.parse(readFileSync(new URL('../fixtures/run-replay/wf_default.json', import.meta.url), 'utf8'));
const frame = (f) => ({ ...f, stepper: REPLAY.stepper, pr: null });
const asking = REPLAY.frames.findIndex((f) => f.pendingQuestion);
const working = REPLAY.frames.findIndex((f, i) => i > asking && f.status === 'running' && !f.pendingQuestion && (f.active || []).length);
const last = REPLAY.frames.length - 1;
const PR = { url: 'https://github.com/acme/app/pull/759', number: 759, state: 'OPEN' };
export const NOW = Date.parse('2026-10-18T12:00:00Z');
export const REPLAY_FRAMES = REPLAY.frames.map(frame);

/** The working frame with its running step turned into an error (the Failed row). */
const failedSteps = (f) => { const s = [...(f.steps || [])]; const i = s.findLastIndex((x) => x.status === 'start'); if (i >= 0) s[i] = { ...s[i], status: 'error' }; return s; };

/** [{ state, run, dot, symbol, bar }]: `bar` = the current run bar shows (D20). */
export const RUN_STATE_ROWS = [
  { state: 'starting', run: { ...frame(REPLAY.frames[0]), status: 'starting', steps: [], active: [] }, dot: 'peach', symbol: null, bar: true },
  { state: 'working', run: frame(REPLAY.frames[working]), dot: 'peach', symbol: null, bar: true },
  { state: 'needs-you', run: frame(REPLAY.frames[asking]), dot: 'amber', symbol: 'question', bar: true },
  { state: 'paused', run: { ...frame(REPLAY.frames[working]), status: 'paused', active: [], pauseReason: 'usage_limit' }, dot: 'grey', symbol: null, bar: true },
  { state: 'waiting', run: { ticket: { status: 'scheduled', runAt: '2026-10-18T21:00:00Z' } }, dot: 'grey-ring', symbol: null, bar: false },
  { state: 'failed', run: { ...frame(REPLAY.frames[working]), status: 'error', active: [], steps: failedSteps(REPLAY.frames[working]) }, dot: 'red', symbol: 'alert', bar: false },
  { state: 'stopped', run: { ...frame(REPLAY.frames[working]), status: 'stopped', active: [] }, dot: 'dark-grey', symbol: null, bar: false },
  { state: 'ready', run: frame(REPLAY.frames[last]), dot: 'green', symbol: null, bar: false },
  { state: 'in-review', run: { ...frame(REPLAY.frames[last]), pr: PR }, dot: 'green', symbol: null, bar: false },
  { state: 'merged', run: { ...frame(REPLAY.frames[last]), pr: { ...PR, state: 'MERGED' } }, dot: 'violet', symbol: null, bar: false },
];
