import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp as boot, helloRun, runCard, runPanel, openRunPanel } from './helpers/run-page-boot.mjs';
import { checkRows } from './helpers/rows.mjs';

// Behavior tests for the clarify/gate question panel. The panel mounts ONLY on
// the run page (#running/<id>, `#run-detail .rd-questions .qpanel`); the Runs
// list row just puts the run in Needs you and names the wait in its subline
// ("Question", "Workflow review"), and its click opens the page. We boot the REAL
// app.js against the REAL index.html under jsdom (test/helpers/run-page-boot.mjs),
// dispatch server frames through the captured WebSocket and capture POST
// /api/answer via a fetch stub.
//
// Each test gets a fresh DOM + a fresh module import (cache-busted) so module
// top-level state can't leak between cases.

const RUN_ID = 'run-aaa';

function clarifyEvent() {
  return {
    id: 'clarify-1',
    kind: 'clarify',
    questions: [
      // options padded to 3 slots with '' per the clarify contract — UI must filter.
      { id: 'q1', question: 'Where to store sessions?', options: ['Redis', 'Postgres', ''], allowFreeText: true },
      { id: 'q2', question: 'How to handle invalid input?', options: ['Fail fast', '', ''], allowFreeText: true },
    ],
  };
}

const click = (ctx, el) => el.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));

// The run's row when it sits in Needs you (null when nothing waits on you), and a row's line head, before
// " · <time>". In Needs you a waiting row reads its stage, or "Needs you" before it has one (runs redesign §3.1).
const needsRow = (ctx, runId) =>
  ctx.window.document.querySelector(`#runs-list .runs-sec[data-section="needs"] .runs-row[data-run-id="${runId}"]`);
const rowWord = (row) => row.querySelector('.runs-row-sub').textContent.split(' · ')[0];

// A fetch stub that records /api/answer bodies.
function answerRecorder() {
  const captured = [];
  const fetchHandler = (url, opts) => {
    if (url.includes('/api/answer')) {
      captured.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    return null;
  };
  return { captured, fetchHandler };
}

test('clarify question renders on the run page with lettered options (empty slots filtered); the list row is in Needs you and reads "Question", no panel', async () => {
  const ctx = await boot();
  const panel = await openRunPanel(ctx, { runId: RUN_ID, question: clarifyEvent() });
  // Captured before the first row leaves for the Runs list (a static NodeList keeps the blocks).
  const blocks = panel.querySelectorAll('.qblock');
  await checkRows([
    { name: 'clarify question renders on the run page; the list row is in Needs you and reads "Question", no panel', run: async () => {
      assert.ok(panel, 'qpanel present on the run page');
      assert.equal(panel.classList.contains('hidden'), false, 'qpanel is visible (not hidden)');

      const blocks = panel.querySelectorAll('.qblock');
      assert.equal(blocks.length, 2, 'one .qblock per question');

      // q1 has 2 real options, q2 has 1 (the '' slots are filtered) => 3 total.
      const opts = panel.querySelectorAll('.qopt');
      assert.equal(opts.length, 3, 'empty option slots are filtered out');

      // Head: count chip + title with the phase label (defaults to phaseKey label).
      assert.ok(panel.querySelector('.qcount'), 'qcount chip present');
      assert.match(panel.querySelector('.qcount').textContent, /2 questions/);
      assert.ok(panel.querySelector('.qpanel-foot .btn-primary'), 'submit button present');

      // The list row only points at it (Needs you + its word) — the panel is not mounted there.
      ctx.showRunning();
      await ctx.settle();
      const card = runCard(ctx, RUN_ID);
      assert.ok(card, 'run row exists in its project group');
      assert.ok(needsRow(ctx, RUN_ID), 'the run is in Needs you');
      assert.equal(card.querySelector('.qpanel'), null, 'no question panel on the list row');
      assert.equal(needsRow(ctx, RUN_ID).querySelector('.qpanel'), null, 'nor on its Needs-you copy');
      assert.equal(rowWord(card), 'Needs you', 'the row names the wait');
    } },
    { name: 'each option carries a letter key (A, B, ...) so it can be referenced by name', run: async () => {
      // The letter rides data-key (the stylesheet draws it as the option's key square);
      // the text node is the option itself, so the key is never printed twice.
      // q1: 2 real options -> A Redis, B Postgres.
      const q1opts = blocks[0].querySelectorAll('.qopt');
      assert.equal(q1opts[0].dataset.key, 'A');
      assert.equal(q1opts[0].textContent, 'Redis');
      assert.equal(q1opts[1].dataset.key, 'B');
      assert.equal(q1opts[1].textContent, 'Postgres');

      // q2: 1 real option, letters restart per-question -> A Fail fast.
      const q2opts = blocks[1].querySelectorAll('.qopt');
      assert.equal(q2opts[0].dataset.key, 'A');
      assert.equal(q2opts[0].textContent, 'Fail fast');
    } },
  ]);
});

test('selecting an option marks it + submit posts {runId,id,payload:{answers}} with the choice', async () => {
  const { captured, fetchHandler } = answerRecorder();
  const ctx = await boot({ fetchHandler });
  const panel = await openRunPanel(ctx, { runId: RUN_ID, question: clarifyEvent() });
  const blocks = panel.querySelectorAll('.qblock');

  // Click the first option of q1 ("Redis").
  const q1opt = blocks[0].querySelectorAll('.qopt')[0];
  click(ctx, q1opt);
  assert.ok(q1opt.classList.contains('sel'), 'clicked option marked .sel');
  assert.equal(q1opt.getAttribute('aria-pressed'), 'true', 'clicked option aria-pressed=true');
  // Sibling stays unselected.
  const q1opt2 = blocks[0].querySelectorAll('.qopt')[1];
  assert.equal(q1opt2.getAttribute('aria-pressed'), 'false', 'sibling stays unpressed');

  // Click q2's only option ("Fail fast").
  click(ctx, blocks[1].querySelectorAll('.qopt')[0]);

  // Click submit.
  click(ctx, panel.querySelector('.qpanel-foot .btn-primary'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(captured.length, 1, 'one POST /api/answer issued');
  const body = captured[0];
  assert.equal(body.runId, RUN_ID, 'body carries runId');
  assert.equal(body.id, 'clarify-1', 'body carries the question id');
  assert.ok(body.payload && Array.isArray(body.payload.answers), 'payload.answers is an array');
  assert.equal(body.payload.answers.length, 2, 'one answer per question');
  assert.equal(body.payload.answers[0].id, 'q1');
  assert.equal(body.payload.answers[0].choice, 'Redis', 'chosen option text captured as choice');
  assert.equal(body.payload.answers[1].id, 'q2');
  assert.equal(body.payload.answers[1].choice, 'Fail fast');

  // 200 must NOT immediately clear the panel — keep pendingQuestion until resume.
  assert.equal(runPanel(ctx).classList.contains('hidden'), false, 'panel still visible after 200');
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-questions').hidden, false, 'question host stays up');
  ctx.showRunning();
  await ctx.settle();
  assert.ok(needsRow(ctx, RUN_ID), 'still in Needs you until a resume event confirms');

  // A following `state` event confirms resume -> panel clears, Needs you drops it.
  // (The v1 `phase` frame is gone; onState is the client's single resume seam.)
  ctx.dispatch({ type: 'state', runId: RUN_ID, status: 'running' });
  await ctx.settle();
  assert.equal(needsRow(ctx, RUN_ID), null, 'out of Needs you on resume');
  assert.equal(runCard(ctx, RUN_ID).closest('.runs-sec').dataset.section, 'running', 'the row is back under Running');
  ctx.go(`running/${RUN_ID}`);
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('#run-detail .rd-questions').hidden, true, 'question host hidden on resume');
  assert.equal(runPanel(ctx).innerHTML, '', 'panel emptied on resume');
});

test('free-text answer overrides option selection and is captured as the choice', async () => {
  const { captured, fetchHandler } = answerRecorder();
  const ctx = await boot({ fetchHandler });
  const panel = await openRunPanel(ctx, { runId: RUN_ID, question: clarifyEvent() });
  const blocks = panel.querySelectorAll('.qblock');

  // Select an option in q1, then type free text -> the option must clear.
  const q1opt = blocks[0].querySelectorAll('.qopt')[0];
  click(ctx, q1opt);
  const free = blocks[0].querySelector('.qfree');
  free.value = 'DynamoDB';
  free.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  assert.equal(q1opt.classList.contains('sel'), false, 'typing free text clears the option selection');

  click(ctx, panel.querySelector('.qpanel-foot .btn-primary'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(captured[0].payload.answers[0].choice, 'DynamoDB', 'free-text value captured as the choice');
});

test('A2: a hello-seeded pendingQuestion renders the panel when the run page opens (no question event)', async () => {
  const ctx = await boot();
  // hello seeds the run WITH a pendingQuestion (mid-pause reload: the original
  // question event is past the replay buffer). No separate `question` dispatched.
  const panel = await openRunPanel(ctx, {
    runId: RUN_ID,
    run: { title: 'Reloaded run', pendingQuestion: { ...clarifyEvent(), type: 'question', runId: RUN_ID } },
  });

  assert.ok(panel, 'panel built for the seeded run');
  assert.equal(panel.classList.contains('hidden'), false, 'panel rendered from the seed');
  assert.equal(panel.querySelectorAll('.qblock').length, 2, 'seeded questions rendered');

  // The list row points at it: Needs you plus its word.
  ctx.showRunning();
  await ctx.settle();
  assert.ok(needsRow(ctx, RUN_ID), 'the seeded question puts the run in Needs you');
  assert.equal(rowWord(runCard(ctx, RUN_ID)), 'Needs you', 'the row names the seeded question');
});

test('gate question renders issues + two decision buttons; approve posts {decision:"another"}', async () => {
  const { captured, fetchHandler } = answerRecorder();
  const ctx = await boot({ fetchHandler });
  const panel = await openRunPanel(ctx, {
    runId: RUN_ID,
    question: {
      id: 'gate-refine-5',
      kind: 'gate',
      issues: [
        { severity: 'critical', title: 'Missing tests', detail: 'No coverage for X', location: 'src/x.js:10' },
        { severity: 'minor', title: 'Naming', detail: 'foo -> bar' },
      ],
    },
  });

  assert.equal(panel.classList.contains('hidden'), false, 'gate panel visible');
  assert.equal(panel.querySelectorAll('.issues .issue').length, 2, 'both issues rendered');
  assert.ok(panel.querySelector('.issue.sev-critical'), 'critical severity class applied');
  assert.ok(panel.querySelector('.gate-continue'), 'continue button present');
  assert.ok(panel.querySelector('.gate-another'), 'approve-another button present');

  click(ctx, panel.querySelector('.gate-another'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(captured.length, 1, 'gate POST issued');
  assert.equal(captured[0].id, 'gate-refine-5');
  assert.deepEqual(captured[0].payload, { decision: 'another' }, 'approve posts decision:another');
});

test('multi-tab: a question-resolved event clears the run page WITHOUT this tab having answered', async () => {
  const ctx = await boot();
  const panel = await openRunPanel(ctx, { runId: RUN_ID, question: clarifyEvent() }); // this tab never submits (_answering stays false)
  const host = ctx.window.document.querySelector('#run-detail .rd-questions');
  assert.equal(host.hidden, false, 'the run page shows the question first');
  assert.equal(panel.classList.contains('hidden'), false, 'panel visible first');

  // Answered in ANOTHER tab -> the server broadcasts the resolution to this one.
  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'clarify-1' });

  assert.equal(host.hidden, true, 'question host hides for the non-answering tab');
  assert.equal(panel.innerHTML, '', 'panel emptied');
  ctx.showRunning();
  await ctx.settle();
  assert.ok(runCard(ctx, RUN_ID), 'the run is still listed');
  assert.equal(needsRow(ctx, RUN_ID), null, 'it leaves Needs you');
  assert.equal(runCard(ctx, RUN_ID).dataset.state === 'needs-you', false, 'and its row no longer names a question');
});

test('a question-resolved for a STALE id leaves a newer pending question untouched', async () => {
  const ctx = await boot();
  const panel = await openRunPanel(ctx, { runId: RUN_ID, question: clarifyEvent() }); // pending = clarify-1

  ctx.dispatch({ type: 'question-resolved', runId: RUN_ID, id: 'clarify-OLD' });

  assert.equal(ctx.window.document.querySelector('#run-detail .rd-questions').hidden, false, 'mismatched id leaves the question up');
  assert.equal(panel.querySelectorAll('.qblock').length, 2, 'panel still rendered');
  ctx.showRunning();
  await ctx.settle();
  assert.ok(needsRow(ctx, RUN_ID), 'the run stays in Needs you');
  assert.equal(rowWord(runCard(ctx, RUN_ID)), 'Needs you', 'and its row still names the question');
});

test('the row names the wait ("Needs you" with the ? symbol, for a clarify and a workflow ask), sits in Needs you, and opens the run page without posting', async () => {
  // Each row boots its own app (a clarify ask, then a workflow ask).
  await checkRows([
    { name: 'a pending question puts the run in Needs you reading "Needs you", and its row opens the run page', run: async () => {
      const ctx = await boot();
      helloRun(ctx, { runId: RUN_ID });
      ctx.dispatch({ type: 'question', runId: RUN_ID, ...clarifyEvent() });
      ctx.showRunning();
      await ctx.settle();

      const card = runCard(ctx, RUN_ID);
      assert.ok(card, 'the run is listed in its project group');
      assert.equal(card.dataset.state, 'needs-you', 'a question gives the row the Needs you state (the ? symbol)');
      assert.equal(rowWord(card), 'Needs you', 'clarify row line');
      assert.equal(card.querySelector('.qpanel'), null, 'the panel is not mounted on the row');
      const needs = needsRow(ctx, RUN_ID);
      assert.ok(needs, 'and listed in Needs you');

      click(ctx, needs);
      assert.equal(ctx.window.location.hash, `#running/${RUN_ID}`, 'the row opens the run page');
      await ctx.settle();
      assert.ok(runPanel(ctx).querySelector('.qblock'), 'and the question is there');
      assert.match(runPanel(ctx).querySelector('.qcount').textContent, /2 questions/, 'the page counts them');
      assert.equal(ctx.calls.filter((c) => c.url.includes('/api/answer')).length, 0, 'navigating never POSTs an answer');
    } },
    { name: 'a workflow question puts the row in Needs you; with no question it is not there', run: async () => {
      const ctx = await boot();
      helloRun(ctx, { runId: RUN_ID });
      ctx.showRunning();
      await ctx.settle();
      assert.equal(needsRow(ctx, RUN_ID), null, 'not in Needs you while nothing waits');
      assert.equal(runCard(ctx, RUN_ID).closest('.runs-sec').dataset.section, 'running', 'a plain running row');

      ctx.dispatch({
        type: 'question', runId: RUN_ID, id: 'wf-1', kind: 'workflow',
        workflow: { name: 'web-task', agents: [] },
      });
      await ctx.settle();
      const card = runCard(ctx, RUN_ID);
      assert.ok(needsRow(ctx, RUN_ID), 'the workflow ask puts it in Needs you');
      assert.equal(rowWord(card), 'Needs you');
      assert.equal(card.dataset.state, 'needs-you');
    } },
  ]);
});

// kind:'questions' (per-agent user questions) in the question panel on the run page.
function questionsEvent() {
  return {
    id: 'questions-1:s0_0-r1',
    kind: 'questions',
    agent: 'Plan',
    nodeId: 's0_0',
    questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'], allowFreeText: true }],
  };
}

test('kind:questions renders the clarify-style body with the agent name in the head', async () => {
  const ctx = await boot({
    fetchHandler: (url, opts) => {
      if (url.includes('/api/answer') && opts && opts.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return null;
    },
  });
  const panel = await openRunPanel(ctx, { runId: RUN_ID, question: questionsEvent() });
  assert.equal(panel.querySelector('.qpanel-head b').textContent, 'Plan has questions');
  assert.equal(panel.querySelectorAll('.qopt').length, 2, 'options rendered');
  assert.ok(panel.querySelector('.qfree'), 'free text rendered');
  // Submit posts the standard answers payload.
  panel.querySelector('.qopt').click();
  panel.querySelector('.qpanel-foot .btn-primary').click();
  await new Promise((r) => setTimeout(r, 0));
  const post = ctx.calls.find((c) => c.url.includes('/api/answer'));
  assert.ok(post, 'POST /api/answer fired');
  const body = JSON.parse(post.opts.body);
  assert.equal(body.runId, RUN_ID);
  assert.equal(body.id, 'questions-1:s0_0-r1');
  assert.equal(body.payload.answers[0].choice, 'Redis');
});

// The clarify panel shows the agent's confidence per option and preselects its recommendation
// (night mode, Step 14). Each row boots its own app; the runs here use their own id.
test('a recommendation shows confidence bars and a Recommended badge, is preselected and posted without a click, a real click confirms it; no confidence renders plain options with nothing preselected', async () => {
  const RUN_ID = 'run-rec-1';
  await checkRows([
    { name: 'confidence bars per option, a Recommended badge, and the recommendation is preselected', run: async () => {
      const ctx = await boot({ fetchHandler: (url) => (url.includes('/api/answer') ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }) : null) });
      const panel = await openRunPanel(ctx, { runId: RUN_ID, question: { id: 'clarify-1', kind: 'clarify',
        questions: [{ id: 'q1', question: 'Pick?', options: ['A', 'B'], confidence: [70, 30], recommended: 'B', allowFreeText: true }] } });
      const opts = [...panel.querySelectorAll('.qopt')];
      assert.equal(opts.length, 2);
      assert.deepEqual(opts.map((b) => b.dataset.key), ['A', 'B'], 'the letter keys stay');
      assert.deepEqual(opts.map((b) => b.querySelector('.qconf').textContent), ['70%', '30%'], 'figures keyed by option order');
      assert.equal(panel.querySelector('.qconf-fill'), null, 'run 4 D6: a figure, never a bar');
      assert.equal(panel.querySelector('.qfree').placeholder, 'Or type your own answer…');
      assert.equal(opts[0].querySelector('.qrec'), null);
      assert.equal(opts[1].querySelector('.qrec').textContent, 'Recommended');
      assert.ok(opts[1].classList.contains('sel'));
      assert.equal(opts[1].getAttribute('aria-pressed'), 'true');
      assert.equal(opts[0].getAttribute('aria-pressed'), 'false');
      // Preselected is not answered: the "Answered" pill waits for a real click.
      assert.equal(opts[1].dataset.preset, '1');
      panel.querySelector('.btn-primary').dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
      const post = ctx.calls.find((c) => c.url.includes('/api/answer'));
      assert.ok(post, 'the answer was posted without a click on an option');
      assert.equal(JSON.parse(post.opts.body).payload.answers[0].choice, 'B');
    } },
    { name: 'a real click turns the preselected recommendation into an answer', run: async () => {
      const ctx = await boot();
      const panel = await openRunPanel(ctx, { runId: RUN_ID, question: { id: 'clarify-3', kind: 'clarify',
        questions: [{ id: 'q1', question: 'Pick?', options: ['A', 'B'], confidence: [30, 70], recommended: 'B', allowFreeText: true }] } });
      const opts = [...panel.querySelectorAll('.qopt')];
      opts[1].dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
      assert.ok(opts.every((b) => b.dataset.preset === undefined), 'clicking the recommendation itself confirms it');
      assert.ok(opts[1].classList.contains('sel'));
    } },
    { name: 'a question without confidence renders plain options, nothing preselected', run: async () => {
      const ctx = await boot();
      const panel = await openRunPanel(ctx, { runId: RUN_ID, question: { id: 'clarify-2', kind: 'clarify',
        questions: [{ id: 'q1', question: 'Pick?', options: ['A', 'B'], allowFreeText: true }] } });
      assert.equal(panel.querySelectorAll('.qconf, .qrec, .qopt.sel').length, 0);
      assert.equal([...panel.querySelectorAll('.qopt .qopt-txt')].map((s) => s.textContent).join(','), 'A,B');
    } },
  ]);
});
