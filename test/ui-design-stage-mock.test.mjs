// test/ui-design-stage-mock.test.mjs: real frames from P2's mock engine, no browser.
// The stage model (ui/public/design/stage-model.mjs) reduces every frame a real mock build emits, in emit order, and
// its browser copies of P2's status lists and draft paths are checked against P2's own (src/core/design/*).
// `recordMockBuild` needs a temp WORCA_HOME: run this file through `node tools/test.mjs`, which mints one per call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ON_STAGE, LIVE_BUILD, END_BUILD, initialStage, reduceFrame, selectCursors, selectHud, selectPlanRows, draftTarget,
} from '../ui/public/design/stage-model.mjs';
import { recordMockBuild } from './helpers/design-fixture.mjs';

test('a real mock build: U3 holds at every frame, revs have no gap, and it ends with no cursor and its true count', async () => {
  const frames = await recordMockBuild({ brief: 'MOCK_SECTIONS=3', kind: 'web', fast: false });
  const first = frames[0];
  let s = initialStage({ designId: first.designId, kind: 'web', canvas: { w: 1440 } });
  let maxBuilders = 0; let leadWith = false;
  for (const f of frames) {
    const r = reduceFrame(s, f, f.ts); s = r.state;
    const cursors = selectCursors(s); const h = selectHud(s);
    assert.equal(h.agents, cursors.length, f.type);
    const builders = cursors.filter((c) => c.role === 'builder');
    maxBuilders = Math.max(maxBuilders, builders.length);
    if (builders.length && cursors.some((c) => c.role === 'lead')) leadWith = true;
    assert.equal(s.resyncing, false, `${f.type} ${f.path ?? ''}`);
  }
  assert.ok(maxBuilders <= 3, 'M6: off shows at most 3');
  assert.equal(leadWith, false, 'M6: never alongside in a first build');
  const h = selectHud(s);
  assert.equal(h.phase, 'end');
  assert.equal(selectCursors(s).length, 0);
  assert.match(h.text, /^Built by 4 agents in /, 'M6: 1 + 3 sections');
  assert.deepEqual(selectPlanRows(s).rows.map((r) => r.state), ['done', 'done', 'done']);
});
test('the status lists the browser copies are P2\'s', async () => {
  const st = await import('../src/core/design/store.mjs');
  assert.deepEqual(ON_STAGE, st.AGENT_STATUSES.filter((s) => !st.TERMINAL_AGENT_STATUSES.includes(s)));
  assert.deepEqual(LIVE_BUILD, st.OPEN_BUILD_STATUSES.filter((s) => s !== 'paused'));
  assert.deepEqual(END_BUILD, st.BUILD_STATUSES.filter((s) => !st.OPEN_BUILD_STATUSES.includes(s)));
});
test('every path P2 can send, draftTarget reads the same way as classifyDraftPath', async () => {
  const { classifyDraftPath } = await import('../src/core/design/draft.mjs');
  for (const p of ['sections/hero/index.html', 'sections/hero/style.css', 'sections/hero/script.js', 'tokens.css', 'global.css', 'plan.json', 'shell.html', 'assets/a.png']) {
    const a = classifyDraftPath(p); const b = draftTarget(p);
    assert.equal(b?.sectionId ?? null, a?.sectionId ?? null, p);
    assert.equal(b?.part ?? null, a?.part ?? null, p);
  }
});
