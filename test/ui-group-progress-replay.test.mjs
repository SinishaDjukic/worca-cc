// test/ui-group-progress-replay.test.mjs — spec §5.4: a group shows the continuous group bar plus the current run's
// four-section bar on the card and the page; over the recorded replay neither fill ever goes down.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { createChatRunCard } from '../ui/public/chat/run-card.mjs';
import { buildGroupPage, paintGroupPage } from '../ui/public/group-page.mjs';
import { REPLAY_FRAMES, NOW } from './helpers/run-states.mjs';

const trackDom = useDomRelease(afterEach);
const pct = (e) => Number.parseFloat(e.style.width);          // jsdom normalises "50.00%" to "50%" (project rule)

test('§5.4 group replay: group bar + current run bar on card and page, monotonic, equal', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
  const done = { status: 'done', endReached: true };
  const waiting = { ticket: { status: 'scheduled', after: { index: 2 } } };
  const memo = {};
  const gmemo = {};
  let row = null;
  const card = createChatRunCard({ doc, win: doc.defaultView, ident: { cardId: 'c', runId: 'r2', pipelineId: 'p2', title: 'Run tags' }, snapshot: null, ctx: {},
    controls: { memoFor: () => ({}), groupOf: () => row, paintQuestion: () => null, releaseQuestion: () => {} } });
  const page = buildGroupPage(doc);
  const deps = { onAction: () => {}, onTab: () => {}, mountQuestion: () => {}, mountOverview: () => {}, mountDecisions: () => {}, logsHref: () => '#' };
  let last = { group: -1, run: -1 };
  let frames = 0;
  for (const [i, f] of REPLAY_FRAMES.entries()) {
    if (f.status !== 'running') continue;                        // the running frames: the member is the current run
    const model = groupModel({ kind: 'feature', title: 'Run tags', members: [done, { ...f, memo }, waiting], memo: gmemo }, { now: NOW });
    row = { kind: 'chain', groupKind: 'feature', groupId: 'feat_1', title: 'Run tags', model, count: model.count.text, planning: null,
      members: model.members.map((m, k) => ({ position: k + 1, title: `Slice ${k + 1}`, href: '#runs', model: m })) };
    card.update({ source: 'live', runId: 'r2', pipelineId: 'p2', status: f.status, pendingQuestion: f.pendingQuestion || null, run: f });
    paintGroupPage(page, { row, project: '', tab: 'runs', overview: false }, deps);
    for (const [where, root] of [['card', card.el], ['page', page]]) {
      const g = root.querySelector('.run-status-group');
      const bar = root.querySelector('.run-status-bar');
      assert.equal(g.hidden, false, `${where} frame ${i}: the group bar shows`);
      assert.equal(bar.hidden, false, `${where} frame ${i}: the current run bar shows`);
      assert.equal(bar.querySelectorAll('.run-prog-sec').length, 4, `${where}: four sections`);
      assert.ok(Math.abs(pct(g.querySelector('.run-prog-fill')) - model.progress.fraction * 100) < 0.01, `${where}: group fill = model`);
    }
    const gw = pct(card.el.querySelector('.run-status-group .run-prog-fill'));
    assert.equal(gw, pct(page.querySelector('.run-status-group .run-prog-fill')), `frame ${i}: card and page group fills match`);
    const rw = [...card.el.querySelectorAll('.run-status-bar .run-prog-fill')].reduce((a, e) => a + pct(e), 0);
    assert.ok(gw >= last.group - 1e-9, `frame ${i}: the group fill never decreases`);
    assert.ok(rw >= last.run - 1e-9, `frame ${i}: the run fill never decreases`);
    last = { group: gw, run: rw };
    frames += 1;
  }
  assert.ok(frames >= 20, 'the replay drove at least 20 running frames');
});
