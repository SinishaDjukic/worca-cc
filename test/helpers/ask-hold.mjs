// test/helpers/ask-hold.mjs — hold a MOCK_SLOW Ask turn open at a chosen frame until the test releases it.
import { _testing } from '../../src/core/engines/mock.mjs';

/** Install a hold. Returns release(); release.reached() counts the frames held so far, and
 *  release.dispose() releases AND uninstalls the hook. Await reached() (e.g.
 *  waitFor(() => release.reached() >= 1)) before a mid-turn assertion: if the predicate stopped
 *  matching, the test then fails instead of becoming a 0 ms race that passes.
 *  `t` is the test context, and t.after() disposes. Inside a checkRows row (a test Tasks 4-7
 *  merged), pass null and call release.dispose() in that row's own finally: t.after runs only
 *  after the LAST row, so the hook would stay installed for every row after this one. */
export function holdMockTurn(t, at = (_f, i) => i === 0) {
  let release; const gate = new Promise((r) => { release = r; });
  let reached = 0;
  const hook = (f, i) => (at(f, i) ? (reached += 1, gate) : null);
  _testing.holdFrame = hook;
  const dispose = () => { release(); if (_testing.holdFrame === hook) _testing.holdFrame = null; };
  if (t) t.after(dispose);
  return Object.assign(() => release(), { reached: () => reached, dispose });
}
export const isTextDelta = (f) => f.type === 'stream_event' && f.event?.delta?.type === 'text_delta';
export const isAssistant = (f) => f.type === 'assistant';
export const isToolResult = (f) => f.type === 'user';
