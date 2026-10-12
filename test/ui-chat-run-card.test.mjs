// test/ui-chat-run-card.test.mjs — worca Chat P3: the chat run card view (createChatRunCard) over plain snapshots with
// stub controls and a stub card ctx — header, stats, agent chips, the Workflows graph well, the run controls, the
// inline question (answer, receipt, failure) and the result region; plus the pure helpers.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { snapshotFromState } from '../ui/public/ask-run-card.mjs';
import { createChatRunCard, resultWord, answerReceipt, autoChip, midTrunc, progressIdent, runRefOf } from '../ui/public/chat/run-card.mjs';
import { registerAskRenderer } from '../ui/public/ask/registry.mjs';

const trackDom = useDomRelease(afterEach);

const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over,
});
const END = { id: 'n_end', kind: 'end', key: null, x: 600, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } };
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: {
  nodes: [agent('n_plan', 'planner'), agent('n_impl', 'implementer', { x: 300, color: 'green' }), END],
  wires: [
    { id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false },
  ] } };
const step = (over) => ({ key: over.executionId, stepIndex: null, cycle: over.ordinal ?? 1, status: 'done', activeMs: 1000, costUsd: 0.1, startedAt: '2026-08-26T10:00:00Z', ...over });
const STATE = (over = {}) => ({ id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'running', stepper: MANIFEST,
  steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'running', runningSince: null, trigger: { wireIds: ['w1'] } })],
  active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }], totalCostUsd: 0.42, totalActiveMs: 65_000, startedAt: '2026-09-07T10:00:00Z', ...over });
const IDENT = { cardId: 'card_00000001', pipelineId: 'abcd1234', runId: 'run-uuid-1', projectKey: 'proj-00000001', workspaceId: null, title: 'Fix login', label: 'proj' };
const live = (over = {}, stateOver = {}, extras = null) => ({ ...snapshotFromState(STATE(stateOver), { now: 0, extras }), source: 'live', runId: 'run-uuid-1', ...over });
const done = (extras, over = {}) => live({ terminal: true, active: [], ...over }, { status: 'done', active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1 })] }, extras);
const settle = () => new Promise((r) => setTimeout(r, 0));

function mk({ controls = {} } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><html><body></body></html>'));
  const doc = dom.window.document;
  const calls = [];
  const ctx = { openRunPanel: (...a) => calls.push(['panel', ...a]), openArtifact: (...a) => calls.push(['artifact', ...a]), announce: (t) => calls.push(['announce', t]) };
  const refreshed = [];
  const card = createChatRunCard({ doc, win: dom.window, snapshot: null, ctx, controls, ident: { ...IDENT }, refresh: () => refreshed.push(1) });
  doc.body.appendChild(card.el);
  const $ = (sel) => card.el.querySelector(sel);
  return { dom, doc, card, calls, refreshed, $, win: dom.window };
}

// The run page's clarify registrant, as far as the card uses it: collect() reads the panel's answer slots.
registerAskRenderer('clarify', { render() {}, collect: (panel) => ({ answers: ((panel && panel.__answers) || []).map((s) => ({ id: s.id, question: s.question, choice: s.choice })) }) });

/** A stub controls.paintQuestion that mounts a fake question body the way app.js's renderQpanel would. */
function questionStub(q, html, answers = null) {
  const log = { painted: 0, released: 0 };
  return { log,
    paintQuestion(ref, host) {
      log.painted += 1;
      const panel = host.querySelector('.qpanel');
      if (panel.dataset.qid !== q.id) { panel.innerHTML = html; panel.classList.remove('hidden'); panel.dataset.qid = q.id; panel.__answers = answers; }
      return q;
    },
    releaseQuestion(host) { log.released += 1; const p = host.querySelector('.qpanel'); p.innerHTML = ''; delete p.dataset.qid; },
  };
}

test('chat run card: head, sub-line, stats, agent chips with model + cycle, Auto, the Workflows well, Open run and Expand', async () => {
  await checkRows([
    { name: 'a live snapshot paints the head, stats and chips; the graph is the run-hosts card well', run: async () => {
      const { card, $, calls } = mk();
      card.update(live());
      assert.ok(card.el.classList.contains('ask-card') && card.el.classList.contains('chat-rc'));
      assert.equal($('.ask-rc-kicker').textContent, 'Pipeline run');
      assert.equal($('.ask-rc-pill').className, 'ask-rc-pill st-green');
      assert.equal($('.ask-rc-pill-text').textContent, 'Implementer');
      assert.equal($('.ask-rc-title').textContent, 'Fix login');
      assert.equal($('.ask-rc-sub').textContent, 'proj · #abcd1234');
      assert.equal($('.ask-rc-time').textContent, '1m 5s');
      assert.equal($('.ask-rc-cost').textContent, '$0.42');
      assert.equal($('.ask-rc-prog').textContent, '1/2 agents');
      assert.equal($('.chat-rc-agent .chat-rc-agent-name').textContent, 'Implementer');
      const well = $('.chat-rc-well');
      assert.equal(well.hidden, false);
      assert.ok(well.classList.contains('run-flow-wrap') && well.classList.contains('gv-wrap-card'), 'the run-hosts card mode, inside a .run-flow-wrap');
      assert.ok($('.chat-rc-graph .node[data-node-id="n_impl"]').classList.contains('is-active'));
      assert.equal(well.getAttribute('aria-label'), 'Workflow graph: Planner → Implementer');
      $('a.ask-rc-open').click();
      $('.chat-rc-expand').click();
      assert.equal(calls[0][0], 'panel');
      assert.deepEqual({ runId: calls[0][1].runId, pipelineId: calls[0][1].pipelineId, projectKey: calls[0][1].projectKey }, { runId: 'run-uuid-1', pipelineId: 'abcd1234', projectKey: 'proj-00000001' });
      assert.deepEqual(calls[0][2], {});
      assert.deepEqual(calls[1][2], { tab: 'workflow' });
      assert.equal($('.chat-rc-expand').getAttribute('aria-label'), 'Expand');
      assert.equal($('a.ask-rc-open').textContent, 'Open run ›');
    } },
    { name: 'chips name the model and the cycle; the agent a question waits on turns amber', run: async () => {
      const { card, $ } = mk();
      card.update(live({ active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2', label: 'Implementer', color: 'green', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', cycle: 2 }],
        pendingQuestion: { id: 'q-1', kind: 'questions', nodeId: 'n_impl', questions: [{}] } }));
      const chip = $('.chat-rc-agent');
      assert.equal(chip.querySelector('.chat-rc-agent-model').textContent, 'Opus 5.5');
      assert.equal(chip.querySelector('.chat-rc-agent-model').title, 'Opus 5.5', 'a model id the chip cuts off stays readable');
      assert.equal(chip.querySelector('.chat-rc-agent-cycle').textContent, 'cycle 2');
      assert.ok(chip.classList.contains('is-waiting'));
      assert.equal(chip.style.getPropertyValue('--c'), 'var(--amber)');
      assert.equal($('.ask-rc-pill-text').textContent, 'Waiting for your answer');
    } },
    { name: 'Auto: the sub-line chip names the adopted workflow; while deciding the well says so and draws no graph — and, like the run page, says when the run waits, is parked or never decided', run: async () => {
      const { card, $ } = mk();
      card.update(live({ auto: { status: 'decided', via: 'created' } }));
      assert.equal($('.chat-rc-auto').hidden, false);
      assert.equal($('.chat-rc-auto').textContent, 'Auto → T');
      card.update(live({ auto: { status: 'deciding' }, stepper: null, decor: null, progress: null, active: [] }));
      assert.equal($('.chat-rc-auto').textContent, 'Auto');
      assert.equal($('.chat-rc-deciding').hidden, false);
      assert.equal($('.chat-rc-deciding').textContent, 'Auto is deciding the workflow');
      assert.equal($('.chat-rc-well').getAttribute('aria-label'), 'Auto is deciding the workflow', 'the deciding well is a named group');
      assert.equal($('.chat-rc-graph .gv-stage'), null);
      // The run page's A24 words (app.js paintAutoDeciding): never "deciding" on a run that waits, is parked or is over.
      const deciding = { auto: { status: 'deciding' }, stepper: null, decor: null, progress: null, active: [] };
      card.update(live({ ...deciding, pendingQuestion: { id: 'w-1', kind: 'workflow' } }));
      assert.equal($('.chat-rc-deciding').textContent, 'Waiting for your decision');
      card.update(live({ ...deciding, status: 'paused' }));
      assert.equal($('.chat-rc-deciding').textContent, 'Paused before deciding');
      card.update(live({ ...deciding, status: 'interrupted' }));
      assert.equal($('.chat-rc-deciding').textContent, 'Paused before deciding');
      card.update(live({ ...deciding, status: 'stopped', terminal: true }));
      assert.equal($('.chat-rc-deciding').textContent, 'Auto did not decide a workflow');
      assert.equal($('.chat-rc-well').getAttribute('aria-label'), 'Auto did not decide a workflow');
      card.update(live({ ...deciding, status: 'running' }));
      assert.equal($('.chat-rc-deciding').textContent, 'Auto is deciding the workflow', 'a resumed run decides again');
    } },
    { name: 'an engine that reports no cost reads "cost unknown"; a null update keeps the last paint', run: async () => {
      const { card, $ } = mk();
      card.update(live({ costUsd: null }));
      assert.equal($('.ask-rc-cost').textContent, 'cost unknown');
      card.update(null);
      assert.equal($('.ask-rc-title').textContent, 'Fix login', 'D24: never regress to Starting');
    } },
  ]);
});

test('chat run card controls: Pause / Resume / Stop through `controls`, disabled by status, errors shown in the card', async () => {
  await checkRows([
    { name: 'running: Pause calls controls.pause(ref, button); a refusal is shown in the card', run: async () => {
      const seen = [];
      const { card, $ } = mk({ controls: { pause: (ref, btn) => { seen.push([ref.runId, btn]); return Promise.resolve('CANNOT_PAUSE'); } } });
      card.update(live());
      assert.equal($('.chat-rc-foot').hidden, false);
      assert.equal($('.chat-rc-pause').textContent, 'Pause');
      assert.equal($('.chat-rc-pause').disabled, false);
      assert.equal($('.chat-rc-stop').hidden, false);
      $('.chat-rc-pause').click();
      await settle();
      assert.deepEqual(seen, [['run-uuid-1', $('.chat-rc-pause')]]);
      assert.equal($('.chat-rc-err').hidden, false);
      assert.equal($('.chat-rc-err').textContent, 'Could not pause: CANNOT_PAUSE');
    } },
    { name: 'an accepted pause keeps Pause off while the run still reads running (one POST); the next status re-arms the button', run: async () => {
      let n = 0;
      const { card, $ } = mk({ controls: { pause: () => { n += 1; return Promise.resolve(null); } } });
      card.update(live());
      $('.chat-rc-pause').click();
      await settle();
      assert.equal($('.chat-rc-pause').disabled, true, 'the pausing frame has not landed yet');
      assert.equal($('.chat-rc-pause').textContent, 'Pausing…');
      card.update(live());                                   // another frame, still `running`
      $('.chat-rc-pause').click();
      await settle();
      assert.equal(n, 1, 'one controls.pause call');
      assert.equal($('.chat-rc-err').hidden, true);
      card.update(live({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-pause').textContent, 'Resume');
      assert.equal($('.chat-rc-pause').disabled, false);
    } },
    { name: 'starting and pausing disable Pause; paused and interrupted offer Resume; interrupted hides Stop (R7)', run: async () => {
      const resumed = [];
      const { card, $ } = mk({ controls: { resume: (ref, btn) => { resumed.push(btn); return Promise.resolve(); } } });
      card.update(live({ status: 'starting', active: [] }));
      assert.equal($('.chat-rc-pause').disabled, true);
      card.update(live({ status: 'pausing' }));
      assert.equal($('.chat-rc-pause').textContent, 'Pausing…');
      assert.equal($('.chat-rc-pause').disabled, true);
      card.update(live({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-pause').textContent, 'Resume');
      assert.equal($('.chat-rc-pause').disabled, false);
      $('.chat-rc-pause').click();
      await settle();
      assert.deepEqual(resumed, [$('.chat-rc-pause')]);
      card.update(live({ status: 'interrupted', active: [] }));
      assert.equal($('.chat-rc-pause').textContent, 'Resume');
      assert.equal($('.chat-rc-stop').hidden, true, 'an interrupted run is never stoppable');
    } },
    { name: 'a run this tab holds no live model of (a REST snapshot) offers Stop only while paused: /api/stop {pipelineId} stops a paused row, never a run another process drives', run: async () => {
      const { card, $ } = mk();
      const rest = (over) => ({ ...live(over), source: 'rest', runId: null });
      for (const status of ['starting', 'running', 'pausing']) {
        card.update(rest({ status }));
        assert.equal($('.chat-rc-foot').hidden, false, status);
        assert.equal($('.chat-rc-stop').hidden, true, `${status}: nothing in this tab can stop it`);
      }
      card.update(rest({ status: 'paused', active: [] }));
      assert.equal($('.chat-rc-stop').hidden, false, 'a paused row stops by pipeline id');
      card.update(live());
      assert.equal($('.chat-rc-stop').hidden, false, 'the live model arrived (hello): Stop is back');
    } },
    { name: 'Stop calls controls.stop(ref, onStopped); onStopped asks the owner to refresh; a finished run has no footer', run: async () => {
      let stopped = null;
      const { card, $, refreshed } = mk({ controls: { stop: (ref, onStopped) => { stopped = [ref.pipelineId, onStopped]; } } });
      card.update(live());
      $('.chat-rc-stop').click();
      assert.equal(stopped[0], 'abcd1234');
      stopped[1]();
      assert.equal(refreshed.length, 1);
      card.update(done(null));
      assert.equal($('.chat-rc-foot').hidden, true);
    } },
  ]);
});

test('chat run card question: the run page body mounts through controls.paintQuestion, answers go to controls.answer, a receipt follows the resolution', async () => {
  const CLARIFY = { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  const PQ = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?' }] };
  const BODY = '<button class="qopt">Postgres</button><div class="qpanel-foot"><button class="btn-go">Submit</button></div>';
  await checkRows([
    { name: 'a clarify answer posts the collected answers under the QUESTION id, then the receipt counts them', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: 'Postgres' }]);
      const answers = [];
      const { card, $, calls } = mk({ controls: { ...q, answer: (ref, id, payload) => { answers.push([ref.runId, id, payload]); return Promise.resolve(true); } } });
      card.update(live({ pendingQuestion: PQ }));
      assert.equal($('.chat-rc-q').hidden, false);
      assert.equal($('.chat-rc-q-head').textContent, 'A question from Planner');
      $('.chat-rc-q .btn-go').click();
      await settle();
      assert.deepEqual(answers, [['run-uuid-1', 'q-1', { answers: [{ id: 'q1', question: 'Which database?', choice: 'Postgres' }] }]]);
      assert.deepEqual(calls.at(-1), ['announce', 'Answer sent']);
      card.update(live());
      assert.equal($('.chat-rc-receipt').hidden, false);
      assert.equal($('.chat-rc-receipt summary').textContent, '1 answer sent · Planner');
      assert.equal($('.chat-rc-receipt li').textContent, 'Which database? → Postgres');
      assert.ok(q.log.released >= 1, 'the panel was handed back');
    } },
    { name: 'an answer that does not land says so in the card and keeps the question', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: '' }]);
      const { card, $ } = mk({ controls: { ...q, answer: () => Promise.resolve(false) } });
      card.update(live({ pendingQuestion: PQ }));
      $('.chat-rc-q .btn-go').click();
      await settle();
      assert.equal($('.chat-rc-q-err').hidden, false);
      assert.equal($('.chat-rc-q-err').textContent, 'Answer not sent');
      assert.equal($('.chat-rc-receipt').hidden, true);
      assert.ok($('.chat-rc-q .btn-go'), 'the form is still there');
    } },
    { name: 'a question that goes away because the run paused or was interrupted leaves no "Answered" receipt; one answered elsewhere while the run goes on does', run: async () => {
      const q = questionStub(CLARIFY, BODY, []);
      const { card, $ } = mk({ controls: q });
      card.update(live({ pendingQuestion: PQ }));
      card.update(live({ status: 'paused', pendingQuestion: null, active: [] }));
      assert.equal($('.chat-rc-receipt').hidden, true);
      assert.equal($('.chat-rc-q').hidden, true);
      card.update(live({ pendingQuestion: PQ }));
      card.update(live({ status: 'interrupted', pendingQuestion: null, active: [] }));
      assert.equal($('.chat-rc-receipt').hidden, true);
      card.update(live({ pendingQuestion: PQ }));
      card.update(live());
      assert.equal($('.chat-rc-receipt').hidden, false);
      assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Planner');
    } },
    { name: 'a cycle gate posts {decision} and the receipt names the choice', run: async () => {
      const q = questionStub({ id: 'g-1', kind: 'gate', heading: 'Implementer needs a decision', step: 'Implementer' },
        '<div class="qpanel-foot gate-actions"><button class="btn gate-continue">No</button><button class="btn btn-primary gate-another">Yes</button></div>');
      const answers = [];
      const { card, $ } = mk({ controls: { ...q, answer: (ref, id, payload) => { answers.push([id, payload]); return Promise.resolve(true); } } });
      card.update(live({ pendingQuestion: { id: 'g-1', kind: 'gate', issues: [] } }));
      $('.gate-another').click();
      await settle();
      assert.deepEqual(answers, [['g-1', { decision: 'another' }]]);
      card.update(live());
      assert.equal($('.chat-rc-receipt summary').textContent, 'One more fix round · Cycle gate');
    } },
    { name: 'the workflow body owns its buttons; a REST snapshot never mounts a question; a run that ends while asking leaves no receipt', run: async () => {
      const q = questionStub({ id: 'w-1', kind: 'workflow', heading: 'Review the workflow', step: '' }, '<button class="btn-go">Accept</button>');
      const answers = [];
      const { card, $ } = mk({ controls: { ...q, answer: (...a) => { answers.push(a); return Promise.resolve(true); } } });
      card.update(live({ pendingQuestion: { id: 'w-1', kind: 'workflow' } }));
      $('.chat-rc-q .qpanel').classList.add('qpanel-workflow');
      $('.chat-rc-q .btn-go').click();
      await settle();
      assert.deepEqual(answers, [], 'the workflow arm is not the card\'s delegate');
      card.update(live({ status: 'stopped', terminal: true, pendingQuestion: null, active: [] }));
      assert.equal($('.chat-rc-receipt').hidden, true);
      assert.equal($('.chat-rc-q').hidden, true);
      const before = q.log.painted;
      card.update({ ...live({ pendingQuestion: PQ }), source: 'rest' });
      assert.equal(q.log.painted, before, 'no live run model, no question body');
    } },
  ]);
});

test('chat run card result region: words, churn, top files → Diff, artifact chips → viewer, Create PR → Ship-it, View PR', async () => {
  const EXTRAS = { results: { filesChanged: 2, additions: 12, deletions: 3, checks: 0, topFiles: [
    { path: 'src/a.mjs', additions: 10, deletions: 2, status: 'M' }, { path: 'img/x.png', additions: 0, deletions: 0, status: 'A', binary: true }] },
  artifacts: [{ kind: 'prompt', relPath: 'prompt.md', bytes: 10, nodeId: null, cycle: null },
    { kind: 'review', relPath: 'reviews/a-very-long-implementation-review-cycle1.json', bytes: 20, nodeId: 'n_impl', cycle: 1 }],
  moreArtifacts: true, pr: null };
  await checkRows([
    { name: 'Ready to ship: the verdict, churn, files, chips and Create pull request (no card link)', run: async () => {
      const shipped = [];
      const { card, $, calls, refreshed } = mk({ controls: { prHost: () => true, openShipIt: (...a) => { shipped.push(a); return Promise.resolve(null); } } });
      card.update(done(EXTRAS));
      assert.equal($('.chat-rc-result').hidden, false);
      assert.equal($('.chat-rc-res-title').textContent, 'Ready to ship');
      assert.equal($('.chat-rc-res-sub').textContent, 'Clean — no blocking issues flagged');
      assert.equal($('.chat-rc-res-churn').textContent, '+12 −3 · 2 files changed');
      const files = [...card.el.querySelectorAll('.chat-rc-file')];
      assert.deepEqual(files.map((f) => f.textContent), ['src/a.mjs+10−2', 'img/x.png']);
      files[0].click();
      assert.deepEqual(calls.at(-1).slice(0, 1).concat([calls.at(-1)[2]]), ['panel', { tab: 'diff' }]);
      const chips = [...card.el.querySelectorAll('.chat-rc-art')];
      assert.deepEqual(chips.map((c) => c.textContent), ['prompt.md', midTrunc('a-very-long-implementation-review-cycle1.json'), 'All artifacts']);
      chips[1].click();
      assert.equal(calls.at(-1)[0], 'artifact');
      assert.equal(calls.at(-1)[2].relPath, 'reviews/a-very-long-implementation-review-cycle1.json');
      assert.equal(calls.at(-1)[1].pipelineId, 'abcd1234');
      assert.equal(calls.at(-1)[1].nodeLabel('n_impl'), 'Implementer', 'P5: the step label rides on the artifact ref');
      chips[2].click();
      assert.deepEqual(calls.at(-1)[2], { tab: 'artifacts' });
      $('.chat-rc-create-pr').click();
      await settle();
      assert.equal(shipped.length, 1);
      assert.equal(shipped[0].length, 1, 'no card link from the run card (R9)');
      assert.equal(shipped[0][0].pipelineId, 'abcd1234');
      assert.equal(refreshed.length, 1, 're-read the PR once Ship-it is done');
      assert.equal($('.chat-rc-res-err').hidden, true);
    } },
    { name: 'a Ship it that cannot open ({opened:false, error}) says why in the card, and the PR is still re-read', run: async () => {
      const { card, $, refreshed } = mk({ controls: { prHost: () => true, openShipIt: async () => ({ opened: false, error: 'This run is not in History yet.' }) } });
      card.update(done(EXTRAS));
      $('.chat-rc-create-pr').click();
      await settle();
      assert.equal($('.chat-rc-res-err').hidden, false);
      assert.equal($('.chat-rc-res-err').textContent, 'This run is not in History yet.');
      assert.equal($('.chat-rc-create-pr').disabled, false);
      assert.equal(refreshed.length, 1);
    } },
    { name: 'no PR host → no Create; checks → "N things to check"; nothing changed → Done', run: async () => {
      const { card, $ } = mk({ controls: { prHost: () => false } });
      card.update(done({ ...EXTRAS, results: { ...EXTRAS.results, checks: 2 } }));
      assert.equal($('.chat-rc-create-pr'), null);
      assert.equal($('.chat-rc-res-sub').textContent, '2 things to check');
      card.update(done({ ...EXTRAS, results: { filesChanged: 0, additions: 0, deletions: 0, checks: 0, topFiles: [] } }));
      assert.equal($('.chat-rc-res-title').textContent, 'Done');
      assert.equal($('.chat-rc-res-sub').textContent, 'No files changed');
    } },
    { name: 'an open PR is In review with a View link; merged reads Merged; a non-http URL is never linked', run: async () => {
      const { card, $ } = mk({ controls: { prHost: () => true } });
      card.update(done({ ...EXTRAS, pr: { url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN' } }));
      assert.equal($('.chat-rc-res-title').textContent, 'In review');
      const a = $('a.chat-rc-view-pr');
      assert.equal(a.getAttribute('href'), 'https://github.com/o/r/pull/7');
      assert.equal(a.target, '_blank');
      assert.equal(a.rel, 'noopener');
      assert.equal($('.chat-rc-create-pr'), null);
      card.update(done({ ...EXTRAS, pr: { url: 'https://github.com/o/r/pull/7', number: 7, state: 'MERGED' } }));
      assert.equal($('.chat-rc-res-title').textContent, 'Merged');
      card.update(done({ ...EXTRAS, pr: { url: 'javascript:alert(1)', number: 1, state: 'OPEN' } }));
      assert.equal($('a.chat-rc-view-pr'), null);
    } },
    { name: 'Stopped and Failed (naming the failed step)', run: async () => {
      const { card, $ } = mk();
      card.update(live({ status: 'stopped', terminal: true, active: [] }));
      assert.equal($('.chat-rc-res-title').textContent, 'Stopped');
      assert.equal($('.chat-rc-res-sub').textContent, 'Stopped before it finished');
      const failed = snapshotFromState(STATE({ status: 'error', active: [], steps: [step({ executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1 }), step({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'error' })] }), { now: 0 });
      card.update(failed);
      assert.equal($('.chat-rc-res-title').textContent, 'Failed');
      assert.equal($('.chat-rc-res-sub').textContent, 'Step: Implementer · see Logs for the error');
    } },
  ]);
});

test('card wells: the footer accordion, rows and result link take no pointer (nothing is bound in a card)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('.gv-wrap-card .run-flow.gv-host .gv-world .xtoggle,.gv-wrap-card .run-flow.gv-host .gv-world .xrow,'
    + '.gv-wrap-card .run-flow.gv-host .gv-world .xresult a{pointer-events:none;cursor:inherit;}'));
});

test('chat run card helpers: progressIdent, runRefOf, autoChip, resultWord, answerReceipt, midTrunc; destroy releases the graph and the question', async () => {
  await checkRows([
    { name: 'progressIdent: a track_run card and a started proposal', run: async () => {
      assert.deepEqual(progressIdent({ id: 'card_1', state: 'tracked', card: { type: 'progress', pipelineId: 'abcd1234', runId: 'r', projectKey: 'p', title: 'T', label: 'L' } }),
        { cardId: 'card_1', pipelineId: 'abcd1234', runId: 'r', projectKey: 'p', workspaceId: null, title: 'T', label: 'L' });
      assert.deepEqual(progressIdent({ id: 'card_2', state: 'started', runId: 'run-9', card: { projectKey: 'p', projectName: 'proj', brief: 'Fix it' } }),
        { cardId: 'card_2', pipelineId: null, runId: 'run-9', projectKey: 'p', workspaceId: null, title: 'Fix it', label: 'proj' });
    } },
    { name: 'runRefOf prefers the snapshot, falls back to the identity', run: async () => {
      assert.deepEqual(runRefOf(IDENT, null), { runId: 'run-uuid-1', pipelineId: 'abcd1234', projectKey: 'proj-00000001', workspaceId: null, projectDir: '', title: 'Fix login', branch: '', status: '' });
      assert.equal(runRefOf(IDENT, { runId: 'run-2', status: 'paused' }).runId, 'run-2');
    } },
    { name: 'autoChip / resultWord / answerReceipt / midTrunc tables', run: async () => {
      assert.equal(autoChip(null), null);
      assert.deepEqual(autoChip({ auto: { status: 'decided' }, stepper: { template: { name: 'Quick fix' } } }), { text: 'Auto → Quick fix', deciding: false });
      assert.equal(resultWord(null), null);
      assert.equal(resultWord({ status: 'running' }), null);
      assert.equal(resultWord({ status: 'interrupted' }), null, 'resumable: no result region');
      assert.equal(answerReceipt({ kind: 'gate', payload: { decision: 'continue' } }, { step: 'Review' }), 'Continued · Cycle gate');
      assert.equal(answerReceipt({ kind: 'clarify', payload: { answers: [{ choice: 'a' }, { choice: '' }] } }, { step: 'Plan' }), '1 of 2 answered · Plan');
      assert.equal(answerReceipt({ kind: 'clarify', payload: { answers: [{ choice: '' }] } }, { step: 'Plan' }), 'Sent without answers · Plan');
      assert.equal(answerReceipt({ kind: 'form', payload: { values: {} } }, { heading: 'Review mockups' }), 'Answer sent · Review mockups');
      assert.equal(answerReceipt(null, { step: 'Plan' }), 'Answered · Plan');
      assert.equal(midTrunc('abcdefghij', 5), 'ab…ij');
      assert.equal(midTrunc('short.md'), 'short.md');
    } },
    { name: 'destroy tears the graph down and hands the question host back', run: async () => {
      const q = questionStub({ id: 'q-1', kind: 'clarify', heading: 'H', step: 'S' }, '<button class="btn-go">Submit</button>');
      const { card, $ } = mk({ controls: q });
      card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
      assert.ok($('.chat-rc-graph .gv-world'));
      const released = q.log.released;
      card.destroy();
      assert.equal($('.chat-rc-graph .gv-world'), null);
      assert.ok(q.log.released > released);
    } },
  ]);
});

test('chat run card: an answer whose question-resolved frame lands before its 200 still names what was sent', async () => {
  let release;
  const q = questionStub({ id: 'q-1', kind: 'clarify', heading: '2 questions from Plan', step: 'Plan' }, '<button class="btn-go">Submit</button>', [{ id: 'a', question: 'Q1', choice: 'x' }]);
  const { card, $ } = mk({ controls: { ...q, answer: () => new Promise((r) => { release = r; }) } });
  card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
  $('.chat-rc-q .btn-go').click();
  card.update(live({ pendingQuestion: null }));            // ui/server.mjs answerRun: question-resolved goes out before the 200
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Plan');
  release(true);
  await settle();
  assert.equal($('.chat-rc-receipt summary').textContent, '1 answer sent · Plan');
});

test('chat run card: what the card sent and its error survive same-question frames; Create PR only for a run with changes to ship; the gate pip focuses the question', async () => {
  const CLARIFY = { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  const PQ = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?' }] };
  const BODY = '<button class="qopt">Postgres</button><div class="qpanel-foot"><button class="btn-go">Submit</button></div>';
  await checkRows([
    { name: 'a tick between the 200 and question-resolved keeps the receipt counted', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: 'Postgres' }]);
      const { card, $ } = mk({ controls: { ...q, answer: () => Promise.resolve(true) } });
      card.update(live({ pendingQuestion: PQ }));
      $('.chat-rc-q .btn-go').click();
      await settle();
      card.update(live({ pendingQuestion: PQ }));          // the controller's 1 s tick before the run resumes
      card.update(live());
      assert.equal($('.chat-rc-receipt summary').textContent, '1 answer sent · Planner');
    } },
    { name: '"Answer not sent" survives the next tick', run: async () => {
      const q = questionStub(CLARIFY, BODY, [{ id: 'q1', question: 'Which database?', choice: '' }]);
      const { card, $ } = mk({ controls: { ...q, answer: () => Promise.resolve(false) } });
      card.update(live({ pendingQuestion: PQ }));
      $('.chat-rc-q .btn-go').click();
      await settle();
      card.update(live({ pendingQuestion: PQ }));
      assert.equal($('.chat-rc-q-err').hidden, false);
    } },
    { name: 'no Create pull request on Done (nothing changed), Stopped or Failed', run: async () => {
      const { card, $ } = mk({ controls: { prHost: () => true } });
      card.update(done({ results: { filesChanged: 0, additions: 0, deletions: 0, checks: 0, topFiles: [] }, artifacts: [], moreArtifacts: false, pr: null }));
      assert.equal($('.chat-rc-res-title').textContent, 'Done');
      assert.equal($('.chat-rc-create-pr'), null);
      card.update(live({ status: 'stopped', terminal: true, active: [] }));
      assert.equal($('.chat-rc-res-title').textContent, 'Stopped');
      assert.equal($('.chat-rc-create-pr'), null);
      card.update(snapshotFromState(STATE({ status: 'error', active: [] }), { now: 0 }));
      assert.equal($('.chat-rc-res-title').textContent, 'Failed');
      assert.equal($('.chat-rc-create-pr'), null);
    } },
    { name: 'the gate pip moves focus to the card\'s own question', run: async () => {
      const q = questionStub({ id: 'g-1', kind: 'gate', heading: 'Implementer needs a decision', step: 'Implementer' },
        '<div class="qpanel-foot gate-actions"><button class="btn gate-continue">No</button><button class="btn btn-primary gate-another">Yes</button></div>');
      const { card, $, doc, win } = mk({ controls: q });
      card.update(live({ pendingQuestion: { id: 'g-1', kind: 'gate', issues: [] } }, { gate: { wireId: 'w1', fromNode: 'n_plan', askId: 'g-1' } }));
      const pip = $('.chat-rc-graph .ngate');
      assert.ok(pip, 'a gate pip on the wire');
      pip.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      assert.equal(doc.activeElement, $('.chat-rc-q .gate-continue'));
    } },
  ]);
});

test('chat run card result words follow the run page: Ready to review when the review flagged something, PR closed, Finished without facts; an archived run offers no pull request; workspace files name their project', async () => {
  const facts = (over = {}) => ({ results: { filesChanged: 2, additions: 3, deletions: 1, checks: 0,
    topFiles: [{ path: 'srv.mjs', additions: 3, deletions: 1, status: 'M', projectKey: 'api-00000001' }], ...over }, artifacts: [], moreArtifacts: false, pr: null });
  const { card, $ } = mk({ controls: { prHost: () => true } });
  card.update(done(facts({ checks: 2 })));
  assert.equal($('.chat-rc-res-title').textContent, 'Ready to review');
  assert.equal($('.chat-rc-res-sub').textContent, '2 things to check');
  assert.ok($('.chat-rc-create-pr'), 'a flagged run can still open its pull request');
  assert.equal($('.chat-rc-file-path').textContent, 'api-00000001/srv.mjs', 'the Overview\'s workspace rule');
  card.update(done({ ...facts(), pr: { url: 'https://github.com/o/r/pull/9', number: 9, state: 'CLOSED' } }));
  assert.equal($('.chat-rc-res-title').textContent, 'PR closed');
  assert.equal($('.chat-rc-res-sub').textContent, 'Closed without merging');
  assert.equal($('a.chat-rc-view-pr').getAttribute('href'), 'https://github.com/o/r/pull/9');
  card.update(done({ results: null, artifacts: [], moreArtifacts: false, pr: null }));
  assert.equal($('.chat-rc-res-title').textContent, 'Finished');
  assert.equal($('.chat-rc-res-sub'), null, 'no facts, no sub-line');
  assert.ok($('.chat-rc-create-pr'));
  card.update(done(facts(), { archived: true }));
  assert.equal($('.chat-rc-res-title').textContent, 'Ready to ship');
  assert.equal($('.chat-rc-create-pr'), null, 'an archived run has no branch to ship');
});

test('chat run card question: a pause from any surface leaves no "Answered" receipt — the server resolves the question AFTER the `pausing` frame', () => {
  const CLARIFY = { id: 'q-1', kind: 'clarify', heading: 'A question from Planner', step: 'Planner' };
  const PQ = { id: 'q-1', kind: 'questions', nodeId: 'n_plan', questions: [{ id: 'q1', question: 'Which database?' }] };
  const q = questionStub(CLARIFY, '<div class="qpanel-foot"><button class="btn-go">Submit</button></div>', []);
  const { card, $ } = mk({ controls: q });
  card.update(live({ pendingQuestion: PQ }));
  card.update(live({ status: 'pausing', pendingQuestion: PQ }));   // ui/server.mjs pauseRun: orch.pause() emits `pausing` …
  card.update(live({ status: 'pausing', pendingQuestion: null }));  // … then resolvePending(entry, { reason: 'paused' })
  assert.equal($('.chat-rc-receipt').hidden, true);
  card.update(live({ status: 'paused', pendingQuestion: null, active: [] }));
  assert.equal($('.chat-rc-receipt').hidden, true, 'not answered: the pause took the question away');
  assert.equal($('.chat-rc-q').hidden, true);
});

test('chat run card controls: the second click of a double-click never undoes the first (Resume flips to Pause in place)', async () => {
  const calls = [];
  const { card, $, win } = mk({ controls: {
    resume: () => { calls.push('resume'); return Promise.resolve(); },
    pause: () => { calls.push('pause'); return Promise.resolve(null); },
  } });
  card.update(live({ status: 'paused', active: [] }));
  $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 1 }));
  await settle();
  card.update(live());                                    // the resumed lineage is running: the same button now says Pause
  assert.equal($('.chat-rc-pause').textContent, 'Pause');
  $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 2 }));
  await settle();
  assert.deepEqual(calls, ['resume'], 'the double-click\'s second press posts nothing');
  $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 0 }));   // keyboard activation
  await settle();
  assert.deepEqual(calls, ['resume', 'pause']);
});

test('chat run card CSS: the run page question chrome a card needs; a narrow card wraps the result head and the answer buttons', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  for (const rule of [
    '.chat-rc-q .qpanel .qbody,.chat-rc-q .qpanel .qbody > :first-child{margin-top:0;}',
    '.chat-rc-q .issue{border-color:var(--line);border-left-width:1px;}',
    '.chat-rc-q .issue-loc{color:var(--ink-2);}',
    '.chat-rc-q .qtune .select-wrap select{padding:0 40px 0 12px;font-size:14px;}',
    '.chat-rc-q .qpanel-foot{flex-wrap:wrap;row-gap:8px;}',
    '.chat-rc-q .qpanel-foot > button{max-width:100%;white-space:normal;text-wrap:balance;}',
    '.chat-rc-res-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;}',
    '.chat-rc-res-text{flex:1 1 200px;min-width:0;}',
    '.chat-rc-res-sub{margin-top:2px;font-size:12px;color:var(--ink-2);}',
    '.chat-rc-res-churn{flex:0 0 auto;margin-left:auto;font-family:var(--mono);font-size:11.5px;color:var(--ink-2);}',
  ]) assert.ok(p3.includes(rule), rule);
});

test('chat run card: a receipt with nothing to expand is no tab stop and does not toggle; one with answers is a disclosure', async () => {
  const gate = questionStub({ id: 'g-1', kind: 'gate', heading: 'Review needs a decision', step: 'Review' }, '<button class="btn gate-another">I approve another cycle</button>');
  const g = mk({ controls: { ...gate, answer: async () => true } });
  g.card.update(live({ pendingQuestion: { id: 'g-1', kind: 'gate', nodeId: 'n_impl', issues: [] } }));
  g.$('.chat-rc-q .gate-another').click();
  await settle();
  g.card.update(live({ pendingQuestion: null }));
  const sum = g.$('.chat-rc-receipt summary');
  assert.equal(sum.textContent, 'One more fix round · Cycle gate');
  assert.equal(sum.tabIndex, -1);
  sum.click();
  assert.equal(g.$('.chat-rc-receipt').open, false);
  const clar = questionStub({ id: 'q-1', kind: 'clarify', heading: 'A question from Plan', step: 'Plan' }, '<button class="btn-go">Submit</button>', [{ id: 'a', question: 'Q1', choice: 'x' }]);
  const c = mk({ controls: { ...clar, answer: async () => true } });
  c.card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
  c.$('.chat-rc-q .btn-go').click();
  await settle();
  c.card.update(live({ pendingQuestion: null }));
  assert.equal(c.$('.chat-rc-receipt summary').tabIndex, 0);
  c.$('.chat-rc-receipt summary').click();
  assert.equal(c.$('.chat-rc-receipt').open, true);
});

test('chat run card: the question section is shown BEFORE controls.paintQuestion mounts the run page body (a workflow body measures its host as it attaches)', () => {
  const seen = [];
  const { card } = mk({ controls: {
    paintQuestion(ref, host) { seen.push([host.hidden, host.closest('.chat-rc-q').hidden]); return { id: 'w-1', kind: 'workflow', heading: 'Review the workflow', step: '' }; },
    releaseQuestion() {} } });
  card.update(live({ pendingQuestion: { id: 'w-1', kind: 'workflow' } }));
  card.update(live());                                     // resolved: the body is hidden again
  card.update(live({ pendingQuestion: { id: 'w-2', kind: 'workflow' } }));
  assert.deepEqual(seen, [[false, false], [false, false]]);
});

test('chat run card: an answer that does not land announces nothing and is never named as sent', async () => {
  const q = questionStub({ id: 'q-1', kind: 'clarify', heading: 'A question from Plan', step: 'Plan' }, '<button class="btn-go">Submit</button>', [{ id: 'a', question: 'Q1', choice: 'x' }]);
  const { card, $, calls } = mk({ controls: { ...q, answer: () => Promise.resolve(false) } });
  card.update(live({ pendingQuestion: { id: 'q-1', kind: 'questions', questions: [{}] } }));
  $('.chat-rc-q .btn-go').click();
  await settle();
  assert.deepEqual(calls.filter((c) => c[0] === 'announce'), []);
  card.update(live());                                     // answered elsewhere after all
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answered · Plan');
});

test('chat run card: an accepted pause lets go when the run is interrupted, or when a newer lineage of it is already running', async () => {
  const { card, $ } = mk({ controls: { pause: () => Promise.resolve(null) } });
  card.update(live());
  $('.chat-rc-pause').click();
  await settle();
  card.update(live({ status: 'interrupted', active: [] }));
  assert.equal($('.chat-rc-pause').textContent, 'Resume');
  assert.equal($('.chat-rc-pause').disabled, false, 'interrupted: Resume is offered');
  card.update(live());
  $('.chat-rc-pause').click();
  await settle();
  card.update(live({ runId: 'run-uuid-2' }));
  assert.equal($('.chat-rc-pause').textContent, 'Pause');
  assert.equal($('.chat-rc-pause').disabled, false, 'the pause was asked of another lineage');
});

test('chat run card: one flagged thing reads "Ready to review · 1 thing to check"; the agent and artifact boxes are labelled groups; a workspace file\'s tooltip names its project; PR closed and Finished words', () => {
  const { card, $ } = mk({ controls: { prHost: () => true } });
  card.update(live());
  assert.equal($('.ask-rc-active').getAttribute('role'), 'group');
  card.update(done({ results: { filesChanged: 1, additions: 1, deletions: 0, checks: 1, topFiles: [{ path: 'srv.mjs', additions: 1, deletions: 0, status: 'M', projectKey: 'api-00000001' }] },
    artifacts: [{ kind: 'prompt', relPath: 'prompt.md', bytes: 1, nodeId: null, cycle: null }], moreArtifacts: false, pr: null }));
  assert.equal($('.chat-rc-res-title').textContent, 'Ready to review');
  assert.equal($('.chat-rc-res-sub').textContent, '1 thing to check');
  assert.equal($('.chat-rc-file').title, 'api-00000001/srv.mjs');
  assert.equal($('.chat-rc-arts').getAttribute('role'), 'group');
  assert.deepEqual(resultWord({ status: 'done', pr: { url: 'https://github.com/o/r/pull/9', state: 'CLOSED' } }),
    { key: 'closed', tone: 'red', glyph: 'stop', title: 'PR closed', sub: 'Closed without merging' });
  assert.deepEqual(resultWord({ status: 'done', results: null }), { key: 'ship', tone: 'green', glyph: 'check', title: 'Finished', sub: '' });
});

test('chat run card CSS: an answer label wider than the whole row wraps inside its button, never out of the card', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  // Chrome, 360 px: under `white-space:nowrap` the gate's "Don't approve another cycle and continue" (330 px wide)
  // sat at x -26..304 in a 20..340 card and read "n't approve …". flex-wrap already moves WHOLE buttons to the next row.
  assert.doesNotMatch(p3, /\.chat-rc-q \.qpanel-foot > button\{[^}]*white-space:nowrap/);
  assert.ok(p3.includes('.chat-rc-q .qpanel-foot > button{max-width:100%;white-space:normal;text-wrap:balance;}'));
});

test('chat run card CSS: the result counts and error, a hovered file row or Stop, the "K of N answered" lead, the agent model label and the Auto well\'s words reach 4.5:1 in both themes', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
  const pair = (name) => {
    const m = root.match(new RegExp(`${name}:light-dark\\((#[0-9A-Fa-f]{6}),\\s*(#[0-9A-Fa-f]{6})\\)`));
    assert.ok(m, `${name} is a light-dark() token`);
    return [m[1], m[2]].map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  };
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // Chrome, light theme, as plain status inks: −d on --field 4.45, on a hovered row 4.03; +a on a hovered row 4.44; a
  // hovered Stop (--red-ink on --hover) 4.03; .qanswered (--ink-3 on the question's --amber-wash) 2.63.
  const mixed = (tok) => `color-mix(in srgb, var(${tok}) 85%, var(--ink))`;
  for (const rule of [
    `.chat-rc-add{color:${mixed('--green-ink')};}`,
    `.chat-rc-del{color:${mixed('--red-ink')};}`,
    `.chat-rc-res-err{margin-right:auto;font-size:12px;color:${mixed('--red-ink')};}`,
    '.chat-rc-stop:hover{background:var(--panel);border-color:var(--red);}',
    '.chat-rc-q .qanswered{color:var(--ink-2);}',
    '.chat-rc-agent-model{min-width:0;flex:0 100000 auto;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2);font-family:var(--mono);font-size:10.5px;font-weight:500;}',
    '.chat-rc-deciding{padding:28px 16px;text-align:center;color:var(--ink-2);font-size:12.5px;}',
  ]) assert.ok(p3.includes(rule), rule);
  const ink = pair('--ink');
  for (const [fg, mix, bgs] of [['--green-ink', true, ['--field', '--hover']], ['--red-ink', true, ['--field', '--hover']],
    ['--red-ink', false, ['--panel']], ['--ink-2', false, ['--amber-wash']]]) {
    for (const bg of bgs) {
      for (const t of [0, 1]) {
        const c = mix ? pair(fg)[t].map((v, i) => v * 0.85 + ink[t][i] * 0.15) : pair(fg)[t];
        const r = ratio(c, pair(bg)[t]);
        assert.ok(r >= 4.5, `${fg}${mix ? ' (85% with --ink)' : ''} on ${bg}, ${t ? 'dark' : 'light'}: ${r.toFixed(2)}:1`);
      }
    }
  }
  // The agent chip's model label sits on the chip wash (P1 .ask-rc-agent: color-mix(in srgb, var(--c) 12%, var(--panel)),
  // --c a node colour or --ink-3); the Auto well's words sit on --canvas-2. As --ink-3: 2.47–2.57:1 and 2.70:1 in light.
  const hex = (name) => {
    const m = root.match(new RegExp(`\\s${name}:(#[0-9A-Fa-f]{6});`));
    assert.ok(m, `${name} is one hex`);
    return [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  };
  for (const t of [0, 1]) {
    const washes = [...['--violet', '--blue', '--green', '--red', '--peach', '--amber'].map(hex), pair('--ink-3')[t]]
      .map((c) => c.map((v, i) => v * 0.12 + pair('--panel')[t][i] * 0.88));
    for (const bg of [...washes, pair('--canvas-2')[t]]) {
      const r = ratio(pair('--ink-2')[t], bg);
      assert.ok(r >= 4.5, `--ink-2 on rgb(${bg.map(Math.round).join(',')}), ${t ? 'dark' : 'light'}: ${r.toFixed(2)}:1`);
    }
  }
});

test('chat run card CSS: an agent chip never runs out of a narrow card (a long model id ellipsizes first, the cycle label never shrinks)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  // Chrome, 390 px, Expert: "Review Implementation claude-sonnet-4-5-20250929 cycle 3" (a REST card's raw model id) spanned
  // x 39..439 in a 20..370 card under P1's `.ask-rc-agent{white-space:nowrap}`.
  for (const rule of ['.chat-rc-agent{max-width:100%;}', '.chat-rc-agent-name{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;}',
    '.chat-rc-agent-model{min-width:0;flex:0 100000 auto;overflow:hidden;text-overflow:ellipsis;', '.chat-rc-agent-cycle{flex:none;']) {
    assert.ok(p3.includes(rule), rule);
  }
});

test('chat run card levels (docs/ui-levels.md): the agent model, the artifacts and the pull-request actions are Advanced, a cycle label Expert; the controls, the question and the result words show in Simple', () => {
  const q = questionStub({ id: 'q-1', kind: 'clarify', heading: 'A question from Implementer', step: 'Implementer' }, '<button class="btn-go">Submit</button>');
  const { card, $ } = mk({ controls: { ...q, prHost: () => true } });
  card.update(live({ active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2', label: 'Implementer', color: 'green', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', cycle: 2 }],
    pendingQuestion: { id: 'q-1', kind: 'questions', nodeId: 'n_impl', questions: [{}] } }));
  assert.equal($('.chat-rc-agent-model').dataset.minLevel, 'advanced', 'the run page\'s model · effort pill');
  assert.equal($('.chat-rc-agent-cycle').dataset.minLevel, 'expert', 'a loop badge');
  for (const sel of ['.chat-rc-agent', '.chat-rc-agent-name', '.chat-rc-foot', '.chat-rc-pause', '.chat-rc-stop', '.chat-rc-q', '.chat-rc-well']) {
    assert.equal($(sel).closest('[data-min-level]'), null, `${sel}: shown in Simple`);
  }
  card.update(done({ results: { filesChanged: 1, additions: 1, deletions: 0, checks: 0, topFiles: [{ path: 'a.mjs', additions: 1, deletions: 0, status: 'M' }] },
    artifacts: [{ kind: 'plan', relPath: 'plan.md', bytes: 1, nodeId: null, cycle: null }], moreArtifacts: true, pr: null }));
  assert.ok($('.chat-rc-create-pr'), 'precondition: Create pull request is painted');
  assert.equal($('.chat-rc-arts').dataset.minLevel, 'advanced', 'the run page\'s Artifacts tab');
  assert.equal($('.chat-rc-res-foot').dataset.minLevel, 'advanced', 'the run page\'s Create PR / View PR');
  for (const sel of ['.chat-rc-result', '.chat-rc-res-title', '.chat-rc-res-churn', '.chat-rc-files']) {
    assert.equal($(sel).closest('[data-min-level]'), null, `${sel}: shown in Simple (the "Files changed" stand-in)`);
  }
  const gated = [...card.el.querySelectorAll('[data-min-level]')].filter((n) => !n.closest('.chat-rc-well')).map((n) => n.className);
  assert.deepEqual(gated, ['chat-rc-arts', 'chat-rc-res-foot']);
  // View pull request carries the same level as Create (an open PR paints only the link).
  card.update(done({ results: null, artifacts: [], moreArtifacts: false, pr: { url: 'https://github.com/o/r/pull/9', number: 9, state: 'OPEN' } }));
  assert.ok($('.chat-rc-view-pr'), 'precondition: View pull request is painted');
  assert.equal($('.chat-rc-view-pr').closest('[data-min-level]').dataset.minLevel, 'advanced', 'View PR: the run page\'s level');
});

test('chat run card controls: a triple-click\'s third press never undoes the first either', async () => {
  const calls = [];
  const { card, $, win } = mk({ controls: {
    resume: () => { calls.push('resume'); return Promise.resolve(); },
    pause: () => { calls.push('pause'); return Promise.resolve(null); },
  } });
  card.update(live({ status: 'paused', active: [] }));
  for (const detail of [1, 2, 3]) {
    $('.chat-rc-pause').dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail }));
    await settle();
    if (detail === 1) card.update(live());                // the resumed lineage runs: the same button now says Pause
  }
  assert.deepEqual(calls, ['resume']);
});

test('chat run card: an answer whose 200 lands before the question goes away keeps its receipt when the run then pauses (a recovery "Pause")', async () => {
  const q = questionStub({ id: 'r-1', kind: 'recovery', heading: 'Implementer failed', step: 'Implementer' }, '<button class="btn recovery-pause">Pause</button>');
  const { card, $ } = mk({ controls: { ...q, answer: async () => true } });
  card.update(live({ pendingQuestion: { id: 'r-1', kind: 'recovery', nodeId: 'n_impl' } }));
  $('.chat-rc-q .recovery-pause').click();
  await settle();                                          // the 200 landed while the question still showed
  card.update(live({ status: 'pausing', pendingQuestion: null }));
  assert.equal($('.chat-rc-receipt').hidden, false, 'the card names what it sent');
  assert.equal($('.chat-rc-receipt summary').textContent, 'Answer sent · Implementer');
});
