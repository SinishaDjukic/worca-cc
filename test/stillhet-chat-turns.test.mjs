// test/stillhet-chat-turns.test.mjs — dev's thread (messages, blocks, cards) into the prototype's turns
// (ui/public/stillhet/live/chat-turns.mjs, Step 4's table): every card type of ASK_CARD_TYPES maps to its turn, every turn
// meets TURN_SHAPES, an unknown type is a notice naming it, and a run's TaskCard counts stages, never agents.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnsOf, turnOfBlock, cardTurn, taskOfRunCard, CARD_TURN, partsOf } from '../ui/public/stillhet/live/chat-turns.mjs';
import { turnErrors } from '../ui/public/stillhet/live/model-shape.mjs';
import { ASK_CARD_TYPES } from '../src/shared/ask-card-types.mjs';
import { snapshotFromState } from '../src/shared/ask-run-snapshot.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { RUN_STATE, THREAD, NOW } from './helpers/stillhet-live-fixture.mjs';

// Step 4's table, card by card: the turn `t` (and the change's kind where it names one)
const EXPECT = {
  question: 'question', progress: 'task', workflow: 'change', 'workflow-build': 'change', 'run-stop': 'act', 'pull-request': 'act',
  ship: 'ship', changes: 'act', route: 'act', 'scope-switch': 'change', model: 'change', schedule: 'change', away: 'change',
  proxy: 'change', web: 'change', clone: 'change', project: 'change', workspace: 'change', actions: 'change', metrics: 'change',
  policy: 'change', receipt: 'change', 'script-approval': 'act', command: 'cmd', files: 'filesgrid',
};
const ctx = { tasks: [{ id: 'run-a', run: 'run-a', title: 'Ask me', case: 'working', detail: 'Working' }], runLinks: [{ runId: 'run-a', pipelineId: 'pa', cardId: 'card_run', started: true }], now: NOW };
const block = (card, state = 'proposed', id = `card_${card.type || 'run'}`) => ({ kind: 'card', id, state, card });

test('every ASK_CARD_TYPES entry has a mapped turn, of the kind Step 4 names, that meets TURN_SHAPES', () => {
  assert.deepEqual(Object.keys(CARD_TURN).sort(), [...ASK_CARD_TYPES].sort(), 'the mapper lists exactly dev\'s card types');
  for (const type of ASK_CARD_TYPES) {
    const turn = cardTurn(block({ type, title: 'T', summary: 'S', question: 'Q?', answer: 'choice', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], runId: 'run-a', pipelineId: 'pa', command: 'ls', blockId: 'b1', items: [{ attId: 'f1', name: 'x.png', kind: 'image', bytes: 2048 }], changes: [{ label: 'Away on', before: 'Never', after: 'Weekends' }] }), ctx);
    assert.equal(turn.t, EXPECT[type], type);
    assert.deepEqual(turnErrors(turn), [], type);
  }
});

test('blocks and messages: you, words, think, notice, divider, the run proposal, and a failed reply', () => {
  const turns = turnsOf(THREAD, ctx);
  for (const x of turns) assert.deepEqual(turnErrors(x), [], `${x.t} ${x.id || ''}`);
  const ts = turns.map((x) => x.t);
  assert.deepEqual(ts, ['you', 'think', 'words', 'proposal', 'task', 'notice', 'divider', 'you', 'failed']);
  const you = turns[0];
  assert.equal(you.text, 'Add a CSV export');
  assert.deepEqual(you.files, ['spec.md']);
  assert.equal(turns[2].html, 'I will start a task: &lt;b&gt;safe&lt;/b&gt;<br>with two lines', 'answer text is escaped, never raw HTML');
  assert.equal(turns[3].title, 'CSV export', 'a card with no type is the run proposal');
  assert.equal(turns[4].task, 'run-a', 'a started proposal is its run\'s TaskCard, through its link');
  assert.equal(turns.at(-1).detail, 'model overloaded');
  assert.equal(turns.at(-1).text, 'Worca could not answer this time.');
  assert.equal(turnOfBlock({ kind: 'where', label: 'Tasks' }, ctx), null, 'a block the person never sees maps to nothing');
});

test('a reply in flight is one working row; an unknown card type is a calm notice from its own title, never its type id (fail.no-raw)', () => {
  const live = turnsOf({ ...THREAD, messages: [...THREAD.messages.slice(0, 1), { id: 'm9', role: 'assistant', text: '', status: 'streaming', blocks: [], createdAt: '2026-11-12T13:59:00Z' }], inFlight: { messageId: 'm9' } }, ctx);
  assert.equal(live.at(-1).t, 'working');
  const odd = cardTurn(block({ type: 'brand-new', title: 'Check the backups' }), ctx);
  assert.deepEqual([odd.t, odd.text], ['notice', 'Check the backups']);
  const bare = cardTurn(block({ type: 'brand-new' }), ctx);
  assert.equal(bare.t, 'notice');
  assert.doesNotMatch(bare.text, /brand-new|draw/);
});

test('dev\'s own words and bodies: Stop run / Keep running, a changes card\'s Start verb, a route card\'s choice, a ship card\'s count', () => {
  const stop = cardTurn(block({ type: 'run-stop', title: 'CSV', status: 'running' }), ctx);
  assert.deepEqual(stop.actions.map((a) => a[0]), ['Stop run', 'Keep running']);
  assert.equal(cardTurn(block({ type: 'run-stop', title: 'CSV', status: 'paused' }), ctx).actions[1][0], 'Keep paused');
  const ch = cardTurn(block({ type: 'changes', text: 'Use ISO dates', landing: { kind: 'round', title: 'Changes to CSV · round 2', start: 'Start round 2' } }), ctx);
  assert.deepEqual([ch.actions[0][0], ch.ids[0], ch.bodies[0], ch.bodies[1]], ['Start round 2', 'card-verb', { verb: 'start' }, { verb: 'not-now' }]);
  const rt = cardTurn(block({ type: 'route', text: 'Add a filter', featureTitle: 'Billing', hasNext: true, guess: { choice: 'add', where: 'next', reason: 'it fits' } }), ctx);
  assert.deepEqual([rt.actions[0][0], rt.bodies[0]], ['Add to Billing', { verb: 'add', where: 'next' }]);
  assert.ok(rt.actions.some((a) => a[0] === 'Own run now'));
  const ship = cardTurn(block({ type: 'ship', title: 'Billing', files: '<img src=x onerror=1>' }), ctx);
  assert.equal(ship.files, 0, 'a count that is not a number is none');
  assert.equal(cardTurn(block({ type: 'ship', title: 'Billing', files: 3 }), ctx).files, 3);
  // panel.ship-card: dev's agreed requirements with their marks, and Worca's suggested way to ship
  const full = cardTurn(block({ type: 'ship', featureId: 'f1', title: 'Billing', suggested: 'stacked', acceptance: { agreed: [{ id: 'R-1', text: 'Totals' }, { id: 'R-2', text: 'ISO dates' }], entries: [{ id: 'R-2', mark: 'not-met', target: 'next feature' }] } }), ctx);
  assert.deepEqual([full.featureId, full.how, full.reqs], ['f1', 'as stacked PRs', [{ id: 'R-1', text: 'R-1 · Totals', mark: '', v: 'Mark it' }, { id: 'R-2', text: 'R-2 · ISO dates', mark: 'not-met', v: 'Not met: next feature' }]]);
  assert.equal(cardTurn(block({ type: 'ship', title: 'Billing', result: { prUrl: 'https://x/pr/1' } }, 'applied'), ctx).done, 'Shipped: https://x/pr/1');
});

test('a live run TaskCard: one status line and step [n, m] from the stages, never an agents ratio', () => {
  const snap = snapshotFromState(RUN_STATE(), { now: 0, decorOf: decorFromState });
  assert.equal(snap.active.length, 4, 'four agents are at work');
  const t = taskOfRunCard(snap);
  assert.deepEqual(t.step, [2, 4], 'Build is stage 2 of Plan, Build, Review, Ready');
  assert.equal(t.stage, 1);
  assert.equal(typeof t.detail, 'string');
  const text = JSON.stringify(t);
  assert.doesNotMatch(text, /agents?\b/i, 'no "N of M agents"');
  assert.doesNotMatch(text, /\b\d+ of \d+\b/);
});

test('a started card whose run has ended names its task by the link\'s pipeline id (the store keeps an ended run by it)', () => {
  const turns = turnsOf(THREAD, { ...ctx, tasks: [{ id: 'pa', run: 'pa', title: 'Ask me', case: 'stopped' }] });
  assert.equal(turns.find((x) => x.id === 'card_run').task, 'pa');
});

test('a resumed run (a new run id, same pipeline) still names the card\'s task: the chat task carries the pipeline id', () => {
  const turns = turnsOf(THREAD, { ...ctx, tasks: [{ id: 'run-new', run: 'run-new', pid: 'pa', title: 'Ask me', case: 'working' }] });
  assert.equal(turns.find((x) => x.id === 'card_run').task, 'run-new');
});

test('panel.answer-refs: Worca\'s words split into words and dev\'s refs (a run candidate, a chat, owner/repo#N, a PR link); none while it streams', () => {
  const parts = partsOf('It is like 0a1b2c3d, see ask_0123abcd and acme/web#7 or https://github.com/acme/web/pull/9.');
  assert.deepEqual(parts.filter((p) => p.ref).map((p) => [p.ref.kind, p.ref.key]), [['run', 'run:0a1b2c3d'], ['chat', 'chat:ask_0123abcd'], ['gh', 'gh:acme/web#7'], ['gh', 'gh:acme/web#9']]);
  assert.equal(parts.map((p) => p.text).join(''), 'It is like 0a1b2c3d, see ask_0123abcd and acme/web#7 or https://github.com/acme/web/pull/9.', 'nothing is lost or added');
  assert.equal(parts.find((p) => p.ref?.key === 'gh:acme/web#9').ref.url, 'https://github.com/acme/web/pull/9');
  assert.equal(partsOf('No refs here.'), null);
  const msg = (status) => ({ messages: [{ id: 'm', role: 'assistant', status, text: 'See ask_0123abcd', blocks: [] }] });
  const done = turnsOf(msg('done')).find((x) => x.t === 'words');
  assert.ok(done.parts && turnErrors(done).length === 0);
  assert.equal(turnsOf(msg('streaming')).find((x) => x.t === 'words').parts, undefined);
});
