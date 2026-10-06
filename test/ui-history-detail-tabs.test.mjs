// test/ui-history-detail-tabs.test.mjs
// History detail: the Overview, Agents, Clarify, Logs, form, glance and bar sections, and the
// Actions tab. Shared boot and fixtures: helpers/history-detail-boot.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT, boot, settle, go, KEY, ROW, DETAIL, PAUSED_DETAIL, RESULTS, retainedRow, blockedBudget, ok,
  fail, DETAIL_URL, detailHash, bootDetail, openDetail, deliverRows, click, secOf, badgeOf, PATCH,
  diffResults, diffDetail, patchArm, filesOf, paneOf, confirmDialog, proposalFor,
} from './helpers/history-detail-boot.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { checkRows } from './helpers/rows.mjs';
import { useAppTimers } from './helpers/app-timers.mjs';

// Click the action button of the newest toast (Retry | Details).
const clickToastAction = (window) => {
  const all = window.document.querySelectorAll('#toasts > .toast');
  click(window, all[all.length - 1].querySelector('.toast-act'));
};

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

// Two steps across two cycles so the DURATION subtitle carries real numbers
// rather than the shared fixture's empty `steps: []`.
const OV_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    steps: [{ key: 'plan', cycle: 1 }, { key: 'implement', cycle: 2 }],
  },
  results: RESULTS,
};

// Persisted results make Diff the default tab, so Overview has to be clicked;
// a results-null run opens on Overview already and must NOT be re-clicked (that
// would be a no-op anyway, but asserting the state keeps the intent explicit).
async function openOverview(ctx) {
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tab = doc.querySelector('#hist-detail .hd-tab[data-sec="overview"]');
  if (!tab.classList.contains('active')) click(ctx.window, tab);
  await settle(ctx.window);
  return secOf(doc, 'overview');
}

test('Overview: clean verdict + stat cards + task card; a non-done run shows the status verdict line', async () => {
  await checkRows([
    { name: 'Overview: clean verdict + stat cards + task card', run: async () => {
      const ctx = await bootDetail({ detail: OV_DETAIL });
      const sec = await openOverview(ctx);

      const verdict = sec.querySelector('.hd-ov-verdict');
      assert.ok(verdict, 'the verdict banner renders');
      assert.ok(verdict.classList.contains('clean'), 'an empty keyThingsToCheck is a clean verdict');
      assert.match(verdict.textContent, /Clean — no blocking issues flagged\./);
      assert.equal(sec.querySelector('ul.issues'), null, 'nothing to list when there are no findings');

      const dur = sec.querySelector('.hd-ov-card-duration');
      assert.match(dur.textContent, /1h 40m/);
      assert.match(dur.querySelector('.hd-ov-sub').textContent, /\d+ steps? · \d+ cycles?/);

      const cost = sec.querySelector('.hd-ov-card-cost');
      assert.match(cost.textContent, /\$153\.21/);
      assert.match(cost.querySelector('.hd-ov-value').title, /Estimated cost/);

      // The worktree is a one-line row under the cards: its path only while it is on disk.
      const wt = sec.querySelector('.hd-ov-wt');
      assert.match(wt.textContent, /retained|released/);
      if (/retained/.test(wt.textContent)) assert.equal(wt.querySelector('.hd-ov-wt-path').title, '/tmp/wt');
      else assert.equal(wt.querySelector('.hd-ov-wt-path'), null, 'a released worktree has no path to show');

      const task = sec.querySelector('.hd-ov-task');
      assert.ok(task, 'the task card renders');
      assert.match(task.textContent, /Fix the log UX\./);
      assert.equal(task.querySelector('.hd-ov-more'), null, 'a short prompt needs no Show more');
      const chips = [...sec.querySelectorAll('.hd-ov-tag')].map((c) => c.textContent);
      assert.ok(chips.includes('feat/log-ux'), `the source branch is a chip — got ${JSON.stringify(chips)}`);
      assert.ok(chips.includes('Alpha'), 'and so is the project name');

      // D6: the LLM "Generate overview" UI is gone from History for good.
      assert.equal(sec.querySelector('.results-overview-btn'), null,
        'D6: no Generate-overview button anywhere in the section');

      // Carried over from the retired ui-history-diff-overview suite: the verdict
      // line is a judgement, never a count restatement. `+A −R` belongs to the header
      // meta (.hd-diffcounts) and to the Diff tab's file-list head — nowhere else.
      assert.doesNotMatch(verdict.textContent, /[+−]/, 'the verdict carries no raw diff counts');
    } },
    { name: 'Overview: non-done run shows the status verdict line', run: async () => {
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'stopped' }],
        detail: { ...OV_DETAIL, results: null, state: { ...OV_DETAIL.state, status: 'stopped' } },
      });
      await openDetail(ctx);
      const sec = await openOverview(ctx);

      const verdict = sec.querySelector('.hd-ov-verdict');
      assert.ok(verdict.classList.contains('none'));
      assert.match(verdict.textContent, /No review results captured — the run did not complete\./);
      const chip = sec.querySelector('.hd-ov-chip');
      assert.ok(chip.classList.contains('st-stopped'), 'the chip wears the status family class');
      assert.equal(chip.textContent, 'Stopped');
      assert.equal(sec.querySelector('ul.issues'), null);
    } },
  ]);
});

test('Overview findings: keyThingsToCheck render, workspace findings collected from perProject and prefixed', async () => {
  await checkRows([
    { name: 'Overview: findings render when keyThingsToCheck is non-empty', run: async () => {
      const results = {
        ...RESULTS,
        keyThingsToCheck: [
          { id: 'c1', severity: 'major', title: 'Check X', detail: 'the retry path is untested', location: 'a.js:1' },
        ],
      };
      const ctx = await bootDetail({ detail: { ...OV_DETAIL, results } });
      const sec = await openOverview(ctx);

      const verdict = sec.querySelector('.hd-ov-verdict');
      assert.ok(verdict.classList.contains('warn'));
      assert.match(verdict.textContent, /1 thing to check/);
      assert.equal(sec.querySelector('.hd-ov-chip').textContent, '1');

      const list = sec.querySelector('ul.issues');
      assert.ok(list, 'the findings list renders beneath the verdict');
      assert.equal(list.querySelectorAll('li.issue').length, 1);
      assert.match(list.textContent, /Check X/);
      assert.equal(list.querySelector('.issue-loc').textContent, 'a.js:1');
      assert.equal(list.querySelector('.issue-origin').textContent, 'review');
    } },
    { name: 'Overview: workspace findings are collected from perProject and prefixed', run: async () => {
      // A workspace results object has NO top-level keyThingsToCheck — the findings
      // live under perProject[<key>], and the rollup summary only COUNTS them. Without
      // the collection every workspace run would falsely read "Clean".
      const results = {
        summary: {
          filesNew: 0, filesChanged: 1, filesDeleted: 0,
          linesAdded: 1, linesRemoved: 1, blockingIssues: 1, nitpicks: 0,
        },
        perProject: {
          'proj-a-00000001': {
            summary: {}, newFiles: [], changedFiles: [],
            keyThingsToCheck: [{ severity: 'critical', title: 'T', location: 'x.js:2' }],
          },
          'proj-b-00000002': { summary: {}, newFiles: [], changedFiles: [], keyThingsToCheck: [] },
        },
      };
      const ctx = await bootDetail({ detail: { ...OV_DETAIL, results } });
      const sec = await openOverview(ctx);

      const verdict = sec.querySelector('.hd-ov-verdict');
      assert.ok(verdict.classList.contains('warn'), 'a perProject finding is not "Clean"');
      assert.match(verdict.textContent, /1 thing to check/);
      assert.equal(sec.querySelector('.issue-loc').textContent, 'proj-a-00000001: x.js:2',
        'the location is prefixed with its project key');
    } },
  ]);
});

test('the WORKTREE card reads retained while running and flips released -> retained in place', async () => {
  await checkRows([
    { name: 'the WORKTREE card flips released -> retained without leaving the tab', run: async () => {
      // The carried-over phase-4 assertion. A tab body is built exactly ONCE, so the
      // one body that reads mutable record fields only tracks the authoritative row
      // because refreshHdFromRow calls refreshHdOverviewTab() — without it this card
      // would read `released` for the life of the screen.
      const ctx = await bootDetail({ rows: [], detail: DETAIL, deepLink: true });
      await settle(ctx.window, 5);
      const doc = ctx.window.document;

      const sec = secOf(doc, 'overview');
      assert.equal(sec.hidden, false, 'results-null -> Overview is the default tab');
      assert.match(sec.querySelector('.hd-ov-wt .hd-ov-wt-state').textContent, /^released$/,
        'the deep-link stub carries no retainedWork');

      await deliverRows(ctx, [retainedRow()]);
      assert.equal(secOf(doc, 'overview'), sec, 'the SAME section node is repainted in place');
      assert.equal(sec.hidden, false, 'and the user never left the tab');
      assert.equal(sec.querySelector('.hd-ov-wt .hd-ov-wt-state').textContent, 'retained');
      assert.equal(sec.querySelectorAll('.hd-ov-wt').length, 1, 'the repaint replaces, never stacks');
    } },
    { name: 'the WORKTREE card reads retained while the run is still running', run: async () => {
      // Running pipelines DO appear in History (listAllPipelines filters only
      // `archived_at IS NULL`), and their worktree is very much still on disk — the
      // card printed the live path under the word "released".
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'running' }],
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } },
      });
      await openDetail(ctx, 'details/overview');
      const sec = secOf(ctx.window.document, 'overview');
      const row = sec.querySelector('.hd-ov-wt');
      assert.equal(row.querySelector('.hd-ov-wt-state').textContent, 'retained');
      assert.match(row.textContent, /\/tmp\/wt/, 'and it names the worktree it just called retained');
    } },
  ]);
});

test('rapid selection does not stack two bodies in the pane', async () => {
  const results = diffResults({
    summary: { filesChanged: 2, linesAdded: 2, linesRemoved: 1 },
    results: {
      changedFiles: [
        { path: 'src/a.js', status: 'M', added: 1, removed: 1 },
        { path: 'src/b.js', status: 'M', added: 1, removed: 0 },
      ],
    },
  });
  const TWO = `${PATCH}diff --git a/src/b.js b/src/b.js
--- a/src/b.js
+++ b/src/b.js
@@ -0,0 +1 @@
+two
`;
  // The patch stays in flight until release() so both selections are mid-await
  // together — the exact race selEpoch exists for.
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = await bootDetail({
    detail: diffDetail(results),
    arms: (url) => (url.endsWith('/diff')
      ? gate.then(() => ({ ok: true, status: 200, text: async () => TWO }))
      : null),
  });
  await openDetail(ctx);
  const { window } = ctx;
  const doc = window.document;

  const rows = filesOf(doc);
  assert.equal(rows.length, 2, 'the rows render before the patch arrives');
  assert.equal(doc.querySelectorAll('#hist-detail .hd-diff-body').length, 0);

  click(window, rows[0]);
  click(window, rows[1]);
  release();
  await settle(window, 6);

  assert.equal(doc.querySelectorAll('#hist-detail .hd-diff-body').length, 1);
  assert.equal(paneOf(doc).querySelector('.hd-dl-add .hd-dl-code').textContent, '+two',
    'the LAST selection owns the pane');
  // One fetch for three selections: the promise is memoized, not re-issued.
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/diff')).length, 1);
});

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

// Everything the roster has to survive at once: a row whose duration exists only
// as finishedAt − startedAt, a row whose cost is null, a halted row, one typed
// row, one graphify user and one skill user. `stepper: null` on purpose —
// A FROZEN v1 manifest whose 'refine' node IS an 'agents' node, so the step row
// really does open the group. (There is no built-in legacy default any more:
// manifestFor(null) is an EMPTY manifest.)
const AG_STEPPER = {
  version: 1, feedbacks: [],
  steps: [{ kind: 'agents', nodes: [{ id: 'refine', uiPhase: 'refine', label: 'Refine', color: 'green' }] }],
};
const AG_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    stepper: AG_STEPPER,
    steps: [{ nodeId: 'refine', cycle: 1, status: 'done', skills: [], graphifyCount: 0 }],
    subAgents: [
      {
        id: 't1', label: 'Codebase surveyor', nodeId: 'refine', cycle: 1, status: 'finished',
        startedAt: '2026-08-17T20:55:00Z', finishedAt: '2026-08-17T20:58:00Z',
        durationMs: null, costUsd: 1.5, skills: [], subagentType: 'Explore', graphifyCount: null,
      },
      {
        id: 't2', label: 'Risk annotator', nodeId: 'refine', cycle: 1, status: 'error',
        startedAt: null, finishedAt: null, durationMs: 5000, costUsd: null, skills: ['skill:tdd'],
        subagentType: null, graphifyCount: 2,
      },
    ],
  },
};

// results is null on these fixtures, so the screen opens on Overview and the tab
// under test always has to be clicked.
async function openTab(ctx, key) {
  await openDetail(ctx);
  const doc = ctx.window.document;
  const tab = doc.querySelector(`#hist-detail .hd-tab[data-sec="${key}"]`);
  if (!tab.classList.contains('active')) click(ctx.window, tab);
  await settle(ctx.window);
  return secOf(doc, key);
}

test('Agents tab groups: duration fallback/blank cost, rolled-up header, v2 names from the ledger, a main agent with no subs still gets a group', async () => {
  await checkRows([
    { name: 'Agents tab groups rows with duration fallback and blank cost', run: async () => {
      const ctx = await bootDetail({ detail: AG_DETAIL });
      const sec = await openTab(ctx, 'agents');

      const rows = [...sec.querySelectorAll('.hd-ag-row')];
      assert.equal(rows.length, 2);
      assert.match(rows[0].textContent, /Codebase surveyor/);
      assert.match(rows[0].textContent, /3m/);          // finishedAt − startedAt fallback ('3m 0s')
      assert.match(rows[0].textContent, /\$1\.5/);      // fmtUsd4 -> '$1.5000'
      assert.ok(rows[0].querySelector('.agent-type-pill'), 'subagentType paints its violet pill');
      assert.equal(rows[0].querySelector('.graphify-pill'), null, 'a null graphifyCount paints nothing');

      assert.match(rows[1].textContent, /Risk annotator/);
      assert.equal(rows[1].querySelector('.hd-ag-cost').textContent, '', 'a null costUsd leaves the cell blank');
      assert.match(rows[1].textContent, /5s/);          // durationMs wins outright
      assert.ok(rows[1].querySelector('.st.stop'), "subRowStatus('error') === 'stop'");
      assert.ok(rows[1].querySelector('.graphify-pill'));
      assert.equal(rows[1].querySelector('.agent-type-pill'), null, 'an untyped row paints no pill');
      // skillPillsHtml is emitted LAST, exactly as renderSubsTree does it: the CSS
      // gives `.hd-ag-row .subs-skills` flex:0 0 100%, so a mid-row pill block would
      // force-wrap the line and strand the status chip on a row of its own.
      const kids = [...rows[1].children];
      assert.ok(kids[kids.length - 1].classList.contains('subs-skills'), 'the pill row closes the row');
      assert.equal(rows[1].querySelector('.subs-skills .skill-pill').textContent, 'tdd');
    } },
    { name: 'Agents group header carries the rolled-up status and meta', run: async () => {
      const ctx = await bootDetail({ detail: AG_DETAIL });
      const sec = await openTab(ctx, 'agents');

      const heads = [...sec.querySelectorAll('.hd-ag-head')];
      assert.equal(heads.length, 1, 'one group per main agent that ran');
      assert.match(heads[0].textContent, /Refine/, 'the group wears its node label');
      assert.ok(heads[0].querySelector('.subs-stat.stop'), 'one errored row rolls the group up to stopped');
      assert.match(heads[0].textContent, /2 sub-agents/);
      assert.match(heads[0].textContent, /3m 5s/, 'durations sum across the group');
      assert.match(heads[0].textContent, /\$1\.5/);
    } },
    { name: 'Agents tab names a v2 group from the ledger (buildHdAgents passes st.steps)', run: async () => {
      const ctx = await bootDetail({ detail: AG_V2_DETAIL });
      // Seed the catalog so the head's model pill exercises the LABEL arm of
      // stepModelPillHtml (the raw-id fallback arm is ui-running-detail's).
      ctx.window.__np._setModels([{ id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['max'] }]);
      const sec = await openTab(ctx, 'agents');
      const heads = [...sec.querySelectorAll('.hd-ag-group .hd-ag-head b')].map((b) => b.textContent);
      // The OR node wrote a ledger row too and must not become an Agents group.
      assert.deepEqual(heads, ['Implementer #1', 'Implementer #1 · Add schema'],
        'the 4th argument (st.steps) reaches cycleAwareLabel');
      const groups = [...sec.querySelectorAll('.hd-ag-group')];
      assert.equal(groups[1].querySelector('.hd-ag-row .hd-ag-name').textContent, 'Slice worker',
        'the sub-agent row landed in the SLICE group, keyed by its v2 stepKey');
      // The manifest node's configured model · effort shows on the step title line.
      assert.equal(groups[0].querySelector('.hd-ag-head .sub-model-pill').textContent, 'Fable 5.1 (1M) · max');
      assert.equal(groups[1].querySelector('.hd-ag-head .sub-model-pill').textContent, 'Fable 5.1 (1M) · max');
    } },
    { name: 'a main agent that spawned nothing still gets a group, coloured by its step', run: async () => {
      const ctx = await bootDetail({
        detail: {
          ...DETAIL,
          state: {
            ...DETAIL.state,
            stepper: { version: 1, feedbacks: [], steps: [{ kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan', color: 'violet' }] }] },
            steps: [{ nodeId: 'plan', cycle: 1, status: 'error', skills: [], graphifyCount: 3 }],
            subAgents: [],
          },
        },
      });
      const sec = await openTab(ctx, 'agents');
      const head = sec.querySelector('.hd-ag-head');
      // No rows to roll up, so the colour comes from stepStatusByKey, not subGroupStatus.
      assert.ok(head.querySelector('.subs-stat.stop'));
      assert.equal(head.querySelector('.sub-model-pill'), null,
        'a v1 stepper recorded no per-node model — no pill, never a guess');
      assert.match(head.textContent, /0 sub-agents/);
      assert.equal(head.querySelector('.graphify-pill').textContent, 'graphify ×3');
      assert.match(sec.querySelector('.hd-ag-none').textContent, /No sub-agents spawned/);
    } },
  ]);
});

// P6b Task 14 (C3): the History Agents tab's own call site passes st.steps, so a
// v2 group is named from the ledger row its key's tail points at. Without the 4th
// argument every head here reads a bare "Implementer".
const AG_V2_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    stepper: {
      version: 2,
      template: { id: 'wf', name: 'WF' },
      graph: {
        nodes: [
          { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, model: 'claude-fable-5-1', effort: 'max', ports: { inputs: [], outputs: [], await: true } },
          { id: 'n_or', kind: 'or', key: null, label: 'OR', x: 0, y: 0, ports: { inputs: [], outputs: [], await: false } },
        ],
        wires: [],
      },
    },
    steps: [
      { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
      { key: 'x:n_impl:1:p1t3', executionId: 'x:n_impl:1:p1t3', nodeId: 'n_impl', ordinal: 1, kind: 'task', title: 'Add schema', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
      { key: 'x:n_or:1', executionId: 'x:n_or:1', nodeId: 'n_or', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
    ],
    subAgents: [
      { id: 't1', label: 'Slice worker', nodeId: 'n_impl', cycle: 1, stepKey: 'x:n_impl:1:p1t3',
        status: 'finished', durationMs: 2000, costUsd: 0.5, skills: [], subagentType: null, graphifyCount: null },
    ],
  },
};

// ---------------------------------------------------------------------------
// Clarify tab
// ---------------------------------------------------------------------------

const CL_DETAIL = {
  ...DETAIL,
  clarify: {
    questions: [{ id: 'q1', question: 'Which DB?', options: ['a', 'b'], allowFreeText: true }],
    answers: [{ id: 'q1', question: 'Which DB?', choice: 'sqlite' }],
  },
  stepQuestions: [{
    stepKey: '3:impl#2', round: 1, nodeId: 'impl', agentKey: 'implementer',
    questions: [{ id: 's1', question: 'Keep flag?' }], answers: [],
  }],
};

test('Clarify tab: Q/A cards + step rounds, caption without cycle when the stepKey has none, rounds that asked nothing skipped', async () => {
  await checkRows([
    { name: 'Clarify tab renders Q/A cards + step rounds', run: async () => {
      const ctx = await bootDetail({ detail: CL_DETAIL });
      const sec = await openTab(ctx, 'clarify');
      const doc = ctx.window.document;

      assert.equal(badgeOf(doc, 'clarify'), '2', 'the badge counts run + step questions together');
      const cards = [...sec.querySelectorAll('.hd-cl-card')];
      assert.equal(cards.length, 2);
      assert.match(cards[0].textContent, /Which DB\?/);
      assert.match(cards[0].textContent, /sqlite/);
      assert.equal(cards[0].querySelector('.hd-cl-chip.ask').textContent, 'Q');
      assert.equal(cards[0].querySelector('.hd-cl-chip.ans').textContent, 'A');
      // An unanswered step question keeps its ANS row and says so.
      assert.match(cards[1].textContent, /Keep flag\?/);
      assert.match(cards[1].textContent, /\(none\)/);
      assert.match(sec.querySelector('.hd-cl-caption').textContent, /implementer — round 1 · cycle 2/);
    } },
    { name: 'Clarify caption drops the cycle when the stepKey carries none', run: async () => {
      const ctx = await bootDetail({
        detail: {
          ...DETAIL,
          stepQuestions: [{
            stepKey: 'plan', round: 2, nodeId: 'plan', agentKey: null,
            questions: [{ id: 's1', question: 'Ship it?' }],
            answers: [{ id: 's1', question: 'Ship it?', choice: '   ' }],
          }],
        },
      });
      const sec = await openTab(ctx, 'clarify');
      assert.equal(sec.querySelector('.hd-cl-caption').textContent, 'plan — round 2');
      // A whitespace-only choice is not an answer.
      assert.match(sec.querySelector('.hd-cl-card').textContent, /\(none\)/);
    } },
    { name: 'Clarify skips a step round that asked nothing', run: async () => {
      const ctx = await bootDetail({
        detail: {
          ...DETAIL,
          clarify: { questions: [{ id: 'q1', question: 'Which DB?' }], answers: [] },
          stepQuestions: [{ stepKey: '1:plan', round: 1, nodeId: 'plan', agentKey: 'planner', questions: [], answers: [] }],
        },
      });
      const sec = await openTab(ctx, 'clarify');
      assert.equal(sec.querySelectorAll('.hd-cl-card').length, 1);
      assert.equal(sec.querySelector('.hd-cl-caption'), null, 'no questions -> no caption either');
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

// Cycle-less first line, then cycle 1, then cycle 2: exactly one boundary, and the
// leading cycle-less record proves `cycleSeparatorBefore` draws no header above the
// first cycled line.
const LOG_NDJSON = [
  '{"source":"orchestrator","level":"system","text":"pipeline start","ts":"2026-08-17T20:54:42Z"}',
  '{"source":"refiner","level":"phase","text":"Refine Plan","ts":"2026-08-17T20:54:43Z","stepIndex":1,"cycle":1}',
  '{"source":"refiner","level":"phase","text":"Refine Plan (re-run)","ts":"2026-08-17T21:04:12Z","stepIndex":1,"cycle":2}',
].join('\n');

// The shared DETAIL fixture ships `artifacts: []`, and the Logs tab's `visible`
// predicate requires a 'live-log' entry. results stays null, so the screen opens on
// Overview and the Logs tab always has to be clicked.
const LOGS_DETAIL = { ...DETAIL, artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }] };

// Twin of patchArm: `arms` runs BEFORE the shared base (bootDetail:186), whose own
// /log arm answers 404.
const logArm = (body) => (url) => (
  url.endsWith('/log') ? Promise.resolve({ ok: true, status: 200, text: async () => body }) : null
);

test('Logs tab: shared filter bar, lines, cycle separator, and filtering through the shared selects', async () => {
  await checkRows([
    { name: 'Logs tab renders the shared filter bar + lines + cycle separator', run: async () => {
      const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
      const sec = await openTab(ctx, 'logs');

      assert.ok(sec.querySelector('.log-filters'), 'the shared bar, cloned from #log-bar-tpl');
      assert.equal(sec.querySelectorAll('.log-line').length, 3);
      const seps = sec.querySelectorAll('.log-sep');
      assert.equal(seps.length, 1, 'one separator at the cycle 1 -> 2 boundary');
      assert.equal(seps[0].textContent, 'Cycle 2');
      // The URL is the same historyLogUrl the list card uses, fetched exactly once.
      const logCalls = ctx.calls.filter((c) => c.url.endsWith('/log'));
      assert.equal(logCalls.length, 1);
      assert.equal(logCalls[0].url, `/api/history/${KEY}/${ROW.id}/log`);
    } },
    { name: 'Logs tab filters via the shared selects', run: async () => {
      const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
      const sec = await openTab(ctx, 'logs');

      const cycleSel = sec.querySelector('.log-f-cycle');
      assert.deepEqual([...cycleSel.options].map((o) => o.textContent), ['all cycles', 'cycle 1', 'cycle 2']);
      cycleSel.value = '2';
      // The change listener is delegated on the BAR, not the select (app.js:9403), so a
      // non-bubbling event is silently ignored. Same idiom as ui-history-logs.test.mjs:244.
      cycleSel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
      assert.equal(sec.querySelectorAll('.log-line').length, 1);
      assert.equal(sec.querySelectorAll('.log-sep').length, 0, 'no orphan separator');
      assert.match(sec.querySelector('.log-line').textContent, /Refine Plan \(re-run\)/);
    } },
  ]);
});

test('a failed log fetch re-arms the Logs tab for a retry', async () => {
  let logCalls = 0;
  const ctx = await bootDetail({
    detail: LOGS_DETAIL,
    arms: (url) => {
      if (!url.endsWith('/log')) return null;
      logCalls += 1;
      return logCalls === 1
        ? fail(500, { error: 'boom' })
        : Promise.resolve({ ok: true, status: 200, text: async () => LOG_NDJSON });
    },
  });
  const sec = await openTab(ctx, 'logs');
  assert.match(sec.querySelector('.log').textContent, /Could not load logs: HTTP 500/);
  // loadLiveLogs clears panel.dataset.loaded on failure — the SAME flag initHdTabs
  // stamps — which is what re-arms the tab. That composition is the retry contract.
  assert.equal(sec.dataset.loaded, '', 'the failed load un-stamped the section');

  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="overview"]'));
  click(ctx.window, doc.querySelector('#hist-detail .hd-tab[data-sec="logs"]'));
  await settle(ctx.window);

  assert.equal(logCalls, 2, 'switching back re-issued the fetch');
  assert.equal(secOf(doc, 'logs'), sec, 'the section node is reused, never re-created');
  assert.equal(sec.querySelectorAll('.log-line').length, 3, 'the retry paints the lines');
  assert.equal(sec.dataset.loaded, '1');
});

// ---------------------------------------------------------------------------
// Retained work, continued — folded in from the retired test/ui-history-delete
// and test/ui-history-diff-overview suites (the banner and its actions moved
// from the card accordion onto this screen).
// ---------------------------------------------------------------------------

test('discard confirms honestly, POSTs the keyed route and shows/links the saved recovery patch', async () => {
  await checkRows([
    { name: 'discard confirms honestly, POSTs the keyed route, and shows the saved recovery patch', run: async () => {
      let request = null;
      const ctx = await bootDetail({
        rows: [retainedRow()],
        arms: (url, opts) => {
          if (url.includes('/discard-worktree')) {
            request = { url, method: opts.method };
            return ok({ ok: true, discarded: true, remaining: 0, patches: ['/store/p1/retained-work.patch'] });
          }
          return null;
        },
      });
      await openDetail(ctx);
      const doc = ctx.window.document;
      click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
      const confirmText = await confirmDialog(ctx.window);
      await settle(ctx.window, 5);

      assert.equal(request.method, 'POST');
      assert.match(request.url, /\/api\/runs\/fcec04e8\/discard-worktree\?projectKey=/);
      assert.match(confirmText, /exists only in the retained worktree/);
      assert.match(confirmText, /recovery patch of uncommitted changes will be saved/);
      assert.deepEqual(lastToast(doc), { tone: 'ok', title: 'Retained worktree discarded',
        detail: '1 recovery patch saved.', action: 'Details' });
      clickToastAction(ctx.window);
      assert.equal(doc.querySelector('#viewer-title').textContent, 'Retained worktree discarded');
      assert.match(doc.querySelector('#viewer').textContent, /retained-work\.patch/,
        'the saved patch path is surfaced, not swallowed');
    } },
    { name: 'the retained banner links the recovery patch honestly (retained-work name + label)', run: async () => {
      const ctx = await bootDetail({
        rows: [retainedRow()],
        detail: { ...DETAIL, artifacts: [{ kind: 'retained-work-patch', relPath: 'retained-work.patch' }] },
      });
      await openDetail(ctx);
      const link = ctx.window.document.querySelector('#hist-detail .retained-patch-link a');
      assert.ok(link, 'the alternate-recovery link renders for a retained-work-patch artifact');
      assert.equal(link.download, `retained-work-${ROW.id}.patch`, 'download name matches what the route prefers');
      assert.match(link.textContent, /recovery patch \(snapshot taken when the work was retained\)/);
    } },
  ]);
});

test('a failed or refused discard keeps the banner, badge and Archive block and offers a Retry that asks again', async () => {
  await checkRows([
    { name: 'a failed discard keeps the banner, the badge and the Archive block — and lets the user retry', run: async () => {
      const ctx = await bootDetail({
        rows: [retainedRow()],
        arms: (url) => (url.includes('/discard-worktree')
          ? ok({
            ok: true, discarded: false, remaining: 1,
            patches: ['/store/p1/retained-work.patch'],
            warnings: [`${KEY}: worktree still exists at /tmp/retained-p1`],
          })
          : null),
      });
      await openDetail(ctx);
      const doc = ctx.window.document;
      click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
      await confirmDialog(ctx.window);
      await settle(ctx.window, 5);

      assert.equal(doc.querySelector('#hist-detail .hist-retained-badge').hidden, false, 'badge stays');
      assert.equal(doc.querySelector('#hist-detail .retained-banner').hidden, false, 'banner stays');
      assert.equal(doc.querySelector('#hist-detail .hd-archive').disabled, true, 'Archive stays blocked');
      const discardBtn = doc.querySelector('#hist-detail .hist-discard');
      assert.equal(discardBtn.disabled, false, 'the user can retry');
      assert.match(discardBtn.textContent, /Discard/);
      assert.deepEqual(lastToast(doc), { tone: 'warn', title: 'Discard incomplete',
        detail: 'The retained checkout is still on disk.', action: 'Details' });
      clickToastAction(ctx.window);
      assert.equal(doc.querySelector('#viewer-title').textContent, 'Discard incomplete');
      assert.match(doc.querySelector('#viewer').textContent, /worktree still exists/);
      assert.ok(![...doc.querySelectorAll('*')].some((n) => n.textContent.includes('Saved: Discard')),
        'the viewer title carries no "Saved: " prefix');
    } },
    { name: 'a discard the server refuses raises an error toast whose Retry asks again', run: async () => {
      let posts = 0;
      const ctx = await bootDetail({
        rows: [retainedRow()],
        arms: (url) => {
          if (!url.includes('/discard-worktree')) return null;
          posts++;
          return fail(500, { error: 'disk on fire' });
        },
      });
      await openDetail(ctx);
      const doc = ctx.window.document;
      click(ctx.window, doc.querySelector('#hist-detail .hist-discard'));
      await confirmDialog(ctx.window);
      await settle(ctx.window, 5);

      assert.equal(posts, 1);
      assert.deepEqual(lastToast(doc), { tone: 'err', title: 'Could not discard the retained worktree',
        detail: 'disk on fire', action: 'Retry' });
      const discardBtn = doc.querySelector('#hist-detail .hist-discard');
      assert.equal(discardBtn.disabled, false, 'the user can retry');
      assert.match(discardBtn.title, /disk on fire/, 'the button keeps its title');
      clickToastAction(ctx.window);
      await confirmDialog(ctx.window);
      await settle(ctx.window, 5);
      assert.equal(posts, 2, 'Retry runs the discard again');
    } },
  ]);
});

// Ported from the retired test/ui-history-logs suite: the log cap and the
// copy-on-empty flash cover loadLiveLogs/copyLogToClipboard, both of which the
// Logs tab reuses unchanged.
test('Logs copy: huge logs tail-render but copy takes everything; a filtered-empty pane copies nothing and says so', async (t) => {
  await checkRows([
    { name: 'the Logs tab tail-renders huge logs and says so; copy still takes everything', run: async () => {
      const N = 4005;
      let NDJSON = '';
      for (let i = 0; i < N; i++) {
        NDJSON += `{"source":"planner","level":"info","text":"line ${i}","ts":"2026-06-20T00:00:01Z","stepIndex":0,"cycle":1}\n`;
      }
      const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(NDJSON) });
      const sec = await openTab(ctx, 'logs');

      assert.equal(sec.querySelectorAll('.log .log-line').length, 4000, 'DOM bounded like the live card');
      assert.match(sec.querySelector('.log').textContent, /showing the last 4000 of 4005 matching lines/);
      const writes = [];
      Object.defineProperty(ctx.window.navigator, 'clipboard',
        { configurable: true, value: { writeText: async (t) => { writes.push(t); } } });
      click(ctx.window, sec.querySelector('.log-copy'));
      await settle(ctx.window);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].split('\n').length, N, 'copy is the FULL filtered set, not the tail render');
    } },
    { name: 'copy on a filtered-empty Logs pane flashes "nothing to copy" and leaves the clipboard alone', run: async () => {
      const ctx = await bootDetail({ detail: LOGS_DETAIL, arms: logArm(LOG_NDJSON) });
      const sec = await openTab(ctx, 'logs');
      const writes = [];
      Object.defineProperty(ctx.window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (t) => { writes.push(t); } },
      });
      const timers = useAppTimers(t);
      try {
        const search = sec.querySelector('.log-search');
        search.value = 'zz-no-match-zz';
        search.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
        await timers.advance(200);   // > LOG_SEARCH_DEBOUNCE_MS (120)
        const copyBtn = sec.querySelector('.log-copy');
        click(ctx.window, copyBtn);
        await timers.settle();
        assert.equal(copyBtn.textContent, 'nothing to copy');
        assert.deepEqual(writes, [], 'clipboard untouched');
        await timers.advance(1300);   // > flashCopyBtn's 1200 ms
        assert.equal(copyBtn.textContent, 'copy', 'label restored after the flash');
      } finally {
        t.mock.timers.reset();
      }
    } },
  ]);
});

// P8a: V24 NULLs a retired v1 resume point, so a run can be paused/interrupted
// and still not resumable. Offering Resume would 409 (ENGINE_RETIRED).
test('Resume is hidden when the resume point was retired and offered when one survives', async () => {
  await checkRows([
    { name: 'Resume is hidden for a paused run whose resume point was retired', run: async () => {
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'paused' }],
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'interrupted', resumable: false } },
      });
      await openDetail(ctx);
      assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, true);
    } },
    { name: 'Resume is still offered when a resume point survives', run: async () => {
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'paused' }],
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'paused', resumable: true } },
      });
      await openDetail(ctx);
      assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').hidden, false);
    } },
  ]);
});

// ── Auto (spec §7.5 / §7.7) ───────────────────────────────────────────────────

test('Auto badge: an Auto run is badged with classifier rows under Preflight, a non-Auto run is not, a run frozen while deciding shows the still line (A24)', async () => {
  await checkRows([
    { name: 'History detail header badges an Auto run and its Agents tab labels the classifier rows under "Preflight"', run: async () => {
      const p = proposalFor();
      const stepper = { ...p.manifest, template: { id: 'wf_quick-fix', name: 'Quick fix' }, auto: { status: 'decided', via: 'reused', rounds: 2, humanInLoop: true, workflowId: 'wf_quick-fix' } };
      const subAgents = [{ id: 'auto-classify-1', label: 'Auto workflow (round 1)', subagentType: 'auto-classify', status: 'finished', nodeId: 'preflight', uiPhase: 'preflight', stepKey: 'x:preflight:1', costUsd: 0.02, runModel: 'claude-sonnet-5' }];
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, stepper, subAgents } } });
      await openDetail(ctx);
      const badge = ctx.window.document.querySelector('#hist-detail .hd-row1 .auto-badge');
      assert.equal(badge.hidden, false); assert.equal(badge.textContent, 'Auto → Quick fix'); assert.equal(badge.title, 'Auto reused the saved workflow "Quick fix"');
      ctx.window.document.querySelector('#hd-tab-agents').click(); await settle(ctx.window);
      const names = [...ctx.window.document.querySelectorAll('#hist-detail .hd-ag-name')].map((n) => n.textContent);
      assert.deepEqual(names, ['Auto workflow (round 1)']);
      const head = ctx.window.document.querySelector('#hist-detail .hd-ag-head').textContent;
      assert.match(head, /Preflight/); assert.doesNotMatch(head, /\bpreflight\b/, 'the bookend label, never the raw id');
    } },
    { name: 'a non-Auto History run shows no badge', run: async () => {
      const ctx = await bootDetail(); await openDetail(ctx);
      assert.equal(ctx.window.document.querySelector('#hist-detail .hd-row1 .auto-badge').hidden, true);
    } },
    { name: 'a History run frozen while Auto was still deciding: the still line, no orb (A24)', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, stepper: DECIDING_BOOTSTRAP } } });
      await openDetail(ctx);
      const host = ctx.window.document.querySelector('#hist-detail .run-flow');
      assert.ok(host.classList.contains('auto-deciding-host'), 'the placeholder, not an empty graph');
      assert.equal(host.querySelector('.auto-deciding-label').textContent, 'Auto did not decide a workflow');
      assert.equal(host.querySelector('.ask-orb'), null, 'no orb on a frozen run');
    } },
  ]);
});

// A24: a finished run whose manifest is STILL the Auto bootstrap never adopted a
// workflow. History is frozen, so the placeholder says so and paints no orb — a
// spinning canvas on a dead run would lie, and would run for the life of the page.
// The bootstrap manifest exactly as buildGraphManifest() emits it for the empty Auto template.
const DECIDING_BOOTSTRAP = { version: 2, template: { id: 'wf_auto', name: 'Auto' }, auto: { status: 'deciding', humanInLoop: true }, graph: { nodes: [], wires: [] }, bookends: { preflight: true, done: true }, steps: [{ kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] }, { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }], feedbacks: [] };

// ---------------------------------------------------------------------------
// The overflow menu — Archive + Report this run live behind one ⋯ trigger
// ---------------------------------------------------------------------------
// The two buttons keep their own classes inside it, so every gate, busy-label swap
// and assertion above still addresses them directly; only their PLACEMENT moved.

const hdMore = (doc) => doc.querySelector('#hist-detail .hd-more');
const hdMenu = (doc) => doc.querySelector('#hist-detail .hd-menu');

test('the ⋯ header menu opens/closes (outside click, Escape, choosing) and its trigger hides when the menu would be empty', async () => {
  await checkRows([
    { name: 'the ⋯ trigger opens and closes the header menu', run: async () => {
      const ctx = await bootDetail();
      await openDetail(ctx);
      const doc = ctx.window.document;

      const more = hdMore(doc);
      const menu = hdMenu(doc);
      assert.ok(more && menu, 'the trigger and its menu are in the detail template');
      assert.equal(menu.hidden, true, 'the menu starts closed');
      assert.equal(more.getAttribute('aria-expanded'), 'false');
      assert.equal(more.getAttribute('aria-haspopup'), 'menu');

      click(ctx.window, more);
      await settle(ctx.window);
      assert.equal(menu.hidden, false, 'clicking opens it');
      assert.equal(more.getAttribute('aria-expanded'), 'true');
      assert.ok(menu.contains(doc.querySelector('#hist-detail .hd-archive')), 'Archive lives inside');
      const report = doc.querySelector('#hist-detail .hd-report');
      assert.ok(menu.contains(report), 'so does Report this run');
      assert.ok(report.querySelector('svg'), 'Report carries a warning-triangle icon, like Archive carries a bin');
      assert.equal(report.querySelector('.hd-btn-label').textContent, 'Report this run',
        'and its label lives in the same span Archive uses, so the two rows line up');
      assert.equal(menu.contains(doc.querySelector('#hist-detail .hd-resume')), false,
        'Resume is the primary action and sits in the bar');

      click(ctx.window, more);
      await settle(ctx.window);
      assert.equal(menu.hidden, true, 'clicking again closes it');
    } },
    { name: 'the menu closes on an outside click, on Escape, and on choosing an item', run: async () => {
      const ctx = await bootDetail();
      await openDetail(ctx);
      const { window: w } = ctx;
      const doc = w.document;
      const open = async () => { click(w, hdMore(doc)); await settle(w); };

      await open();
      click(w, doc.querySelector('#hist-detail .hd-meta'));
      await settle(w);
      assert.equal(hdMenu(doc).hidden, true, 'a click anywhere else dismisses it');

      await open();
      doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(w);
      assert.equal(hdMenu(doc).hidden, true, 'Escape dismisses it');
      assert.equal(doc.activeElement, hdMore(doc), 'and hands focus back to the trigger');

      await open();
      click(w, doc.querySelector('#hist-detail .hd-report'));
      await settle(w);
      assert.equal(hdMenu(doc).hidden, true, 'choosing an item dismisses it');
      assert.equal(doc.getElementById('report-modal').classList.contains('hidden'), false,
        'and the item still does its job');
    } },
    { name: 'the ⋯ trigger hides when it would open an empty menu', run: async () => {
      // A live run can be neither archived nor reported. An always-present trigger that
      // opens onto nothing is worse than no trigger.
      const live = { ...ROW, status: 'running', survived: false };
      const ctx = await bootDetail({ rows: [live],
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } } });
      await openDetail(ctx);
      const doc = ctx.window.document;

      assert.equal(doc.querySelector('#hist-detail .hd-archive').hidden, true);
      assert.equal(doc.querySelector('#hist-detail .hd-report').hidden, true);
      assert.equal(hdMore(doc).hidden, true, 'so the trigger goes too');

      // The gate is set once per visit (setupHdActions) — refreshHdFromRow re-runs only
      // the DISABLED gate, so a run going terminal under an open screen offers the
      // trigger on the next visit, exactly as Archive and Report already do.
      const done = await bootDetail();
      await openDetail(done);
      assert.equal(hdMore(done.window.document).hidden, false,
        'a finished run opens the screen with the trigger in place');
    } },
  ]);
});

// ---------------------------------------------------------------------------
// Clarify tab — a kind:'form' ask (ask-forms design §9): the SAME renderer, in
// readonly mode, seeded with the stored values. Legacy rows are untouched.
// ---------------------------------------------------------------------------

const FORM_ASK = {
  kind: 'form', askId: 'questions-x_1-r1', form: 'review-mockups', version: 1,
  title: 'Review mockups', surface: 'any',
  data: { summary: 'Two directions.', images: [{ id: 'a', caption: 'Option A', file: 'mockups/a.png' }] },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'gallery', field: 'picked', bind: 'data.images', captionKey: 'caption', fileKey: 'file' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } },
  ],
  answerSchema: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    picked: { type: 'string', enum: ['a'] },
    notes: { type: 'string' },
  } },
  fileRefs: [{ path: 'data.images[0].file', rel: 'mockups/a.png' }],
  files: [{ index: 0, rel: 'mockups/a.png', name: 'a.png', mime: 'image/png', bytes: 2048, sha256: 'z' }],
  // X3: the reader merges the stored `values` into `ask` and puts the raw answer in
  // `formAnswer`; the legacy arrays stay empty for a form round.
  values: { verdict: 'changes', picked: 'a', notes: 'tighten the spacing' },
};
const FORM_ANSWER = { kind: 'form', form: 'review-mockups', version: 1, values: FORM_ASK.values };
const FORM_DETAIL = { ...DETAIL,
  clarify: { questions: [], answers: [], ask: FORM_ASK, formAnswer: FORM_ANSWER } };

test('Clarify: a form ask renders readonly with its stored answer', async () => {
  const ctx = await bootDetail({ detail: FORM_DETAIL });
  const sec = await openTab(ctx, 'clarify');
  const card = sec.querySelector('.hd-cl-form');
  assert.ok(card, 'the form ask gets its own card');
  assert.match(card.querySelector('.hd-cl-caption').textContent, /review-mockups/);
  const form = card.querySelector('.af-form');
  assert.ok(form.classList.contains('af-readonly'));
  assert.equal(form.querySelector('textarea').value, 'tighten the spacing');
  assert.equal(form.querySelector('textarea').closest('.af-fld').hidden, false,
    '`when` is evaluated against the STORED values');
  const picked = [...form.querySelectorAll('.af-choice[aria-pressed="true"]')];
  assert.equal(picked.length, 1);
  for (const n of form.querySelectorAll('button, input, textarea, select')) assert.equal(n.disabled, true);
});

test('Clarify form file URLs use the History twin route (and the /api/workspaces arm for workspace records), never the live run route', async () => {
  await checkRows([
    { name: 'Clarify: a form file URL uses the History twin, not the live run route', run: async () => {
      const ctx = await bootDetail({ detail: FORM_DETAIL });
      const sec = await openTab(ctx, 'clarify');
      const img = sec.querySelector('.af-gal-card img');
      assert.equal(img.getAttribute('src'),
        `/api/history/${encodeURIComponent(KEY)}/${encodeURIComponent(ROW.id)}/ask-files/questions-x_1-r1/0`);
    } },
    { name: 'Clarify: a workspace record uses the /api/workspaces arm for ask files', run: async () => {
      // A workspace row opens at #history/workspaces/<wid>/<id> and its detail comes from
      // GET /api/workspaces/<wid>/runs/<id> (test/ui-history-workspace.test.mjs pins both),
      // so this case routes itself instead of openTab's project-keyed hash.
      const wsRow = { ...ROW, target: 'workspace', workspaceName: 'IoT', projectName: 'svc', projectKey: 'workspaces/wk1' };
      const ctx = await bootDetail({ rows: [wsRow], detail: FORM_DETAIL,
        arms: (url) => (new URL(url, 'http://localhost:4317').pathname === `/api/workspaces/wk1/runs/${ROW.id}` ? ok(FORM_DETAIL) : null) });
      go(ctx.window, `history/workspaces/wk1/${ROW.id}`);
      await settle(ctx.window);
      const doc = ctx.window.document;
      const tab = doc.querySelector('#hist-detail .hd-tab[data-sec="clarify"]');
      if (!tab.classList.contains('active')) click(ctx.window, tab);
      await settle(ctx.window);
      const sec = secOf(doc, 'clarify');
      assert.equal(sec.querySelector('.af-gal-card img').getAttribute('src'),
        `/api/workspaces/wk1/runs/${encodeURIComponent(ROW.id)}/ask-files/questions-x_1-r1/0`);
    } },
  ]);
});

test('Clarify badge counts a form ask; legacy-only rows render exactly as before', async () => {
  await checkRows([
    { name: 'Clarify: the badge counts a form ask, and legacy rows still render as Q/A', run: async () => {
      const mixed = { ...DETAIL,
        clarify: { questions: [{ id: 'q1', question: 'Which DB?' }], answers: [{ id: 'q1', choice: 'Postgres' }] },
        stepQuestions: [{ stepKey: 'impl#1', round: 1, nodeId: 'impl', agentKey: 'implementer',
          questions: [], answers: [],
          ask: { ...FORM_ASK, askId: 'questions-x_2-r1', form: 'pick-approach' },
          formAnswer: { ...FORM_ANSWER, form: 'pick-approach' } }] };
      const ctx = await bootDetail({ detail: mixed });
      const sec = await openTab(ctx, 'clarify');
      assert.equal(badgeOf(ctx.window.document, 'clarify'), '2', 'one legacy question + one form ask');
      assert.equal(sec.querySelectorAll('.hd-cl-card').length, 1);
      assert.equal(sec.querySelector('.hd-cl-q').textContent, 'QWhich DB?');
      assert.equal(sec.querySelector('.hd-cl-a').textContent, 'APostgres');
      assert.equal(sec.querySelectorAll('.hd-cl-form').length, 1);
      assert.match(sec.querySelector('.hd-cl-form .hd-cl-caption').textContent, /implementer/);
      assert.match(sec.querySelector('.hd-cl-form .hd-cl-caption').textContent, /pick-approach/);
    } },
    { name: 'Clarify: a run with ONLY legacy rows is byte-for-byte what it was', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL,
        clarify: { questions: [{ id: 'q1', question: 'Which DB?' }], answers: [] } } });
      const sec = await openTab(ctx, 'clarify');
      assert.equal(sec.querySelectorAll('.hd-cl-form').length, 0);
      assert.equal(sec.querySelector('.hd-cl-a').textContent, 'A(none)');
    } },
  ]);
});

// --- the glance (same two modes as the Running page) ------------------------

const G_MANIFEST = {
  version: 2, template: { id: 'wf', name: 'WF' },
  graph: {
    nodes: [
      { id: 'n_plan', kind: 'agent', key: 'planner', label: 'Plan', color: 'blue', x: 0, y: 0, ports: { inputs: [], outputs: [], await: true } },
      { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implement', color: 'blue', x: 300, y: 0, ports: { inputs: [], outputs: [], await: true } },
    ],
    wires: [],
  },
};
const gRow = (node, ord, m0, m1) => ({ key: `x:${node}:${ord}`, executionId: `x:${node}:${ord}`, nodeId: node, ordinal: ord, cycle: ord,
  kind: 'cycle', status: 'done', startedAt: `2026-08-17T20:0${m0}:00Z`, endedAt: `2026-08-17T20:0${m1}:00Z`, activeMs: 60000, costUsd: 0.1 });
const GLANCE_DETAIL = {
  ...DETAIL,
  state: { ...DETAIL.state, stepper: G_MANIFEST, steps: [gRow('n_plan', 1, 0, 1), gRow('n_impl', 1, 1, 2), gRow('n_impl', 2, 2, 3)] },
  results: { ...RESULTS, keyThingsToCheck: [{ id: 'c1', severity: 'major', title: 'Uploads fall back to IP' }] },
};

test('History opens on the glance: page title, status line, facts, the tab rows; Details is a route', async () => {
  const ctx = await bootDetail({ detail: GLANCE_DETAIL });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const hd = doc.querySelector('#hist-detail .hd');
  assert.equal(hd.dataset.mode, 'glance');
  assert.equal(hd.querySelector('.hd-glance').hidden, false);
  assert.equal(hd.querySelector('.hd-details').hidden, true);
  // The run's name is the page title; the bar repeats it (shown only once scrolled away),
  // with no status word and no Details button of its own.
  const name = hd.querySelector('.hd-title').textContent;
  assert.ok(name, 'the run has a name');
  assert.equal(hd.querySelector('.rd-page-title').textContent, name);
  assert.equal(hd.querySelector('.hd-bar .rd-bar-title').textContent, name);
  assert.equal(hd.querySelector('.hd-bar-word'), null, 'the state lives in the status line, not the bar');
  assert.equal(hd.querySelector('.rd-to-details'), null, 'every tab is a row on the glance: no Details button');
  // A finished run: the state word alone (its own glyph), no trail, the facts as tiles.
  assert.ok(hd.querySelector('.rd-now-title .rd-now-state'), 'the state word leads the status line');
  assert.equal(hd.querySelector('.rd-trail-btn'), null, 'no trail of dots');
  assert.equal(hd.querySelectorAll('.rd-facts .rd-stats > div').length, 3, 'time · cost · changes');
  assert.deepEqual([...hd.querySelectorAll('.rd-facts .rd-stats > div > span')].map((s) => s.textContent).slice(0, 2), ['time', 'cost']);
  assert.equal(hd.querySelector('.hd-result .issues'), null, 'the things to check live in Overview only');
  assert.equal(hd.querySelector('.rd-nowlist').textContent, '', 'no step list on a finished run');
  // Every tab is a row, in tab order, under Results and How it ran.
  const groups = [...hd.querySelectorAll('.hd-result .rd-sgroup')];
  assert.deepEqual(groups.map((g) => g.querySelector('.rd-slabel').textContent), ['Results', 'How it ran']);
  const rows = [...hd.querySelectorAll('.hd-result [data-rd-tab]')].map((b) => b.dataset.rdTab);
  const tabs = [...doc.querySelectorAll('#hist-detail .hd-tab')].map((b) => b.dataset.sec);
  assert.deepEqual(rows, tabs, 'one row per tab, in the tab bar\'s order');
  assert.ok([...hd.querySelectorAll('.hd-result [data-rd-tab]')].every((b) => b.querySelector('svg.rd-srow-ico')), 'each row carries its tab icon');
  assert.doesNotMatch(hd.querySelector('.hd-glance').textContent, /\b\d+ of \d+\b/);

  // A row deep-links into Details › that tab; the graph moved into Workflow.
  hd.querySelector('.hd-result [data-rd-tab="overview"]').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(ctx.window, 4);
  assert.equal(ctx.window.location.hash, `#${detailHash}/details/overview`);
  assert.equal(hd.dataset.mode, 'details');
  assert.ok(doc.querySelector('#hist-detail .hd-tab[data-sec="overview"]').classList.contains('active'));
  doc.querySelector('#hist-detail .hd-tab[data-sec="workflow"]').dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
  assert.ok(secOf(doc, 'workflow').querySelector('.hd-graph .run-flow'), 'the graph lives in Workflow');
  assert.equal(ctx.window.location.hash, `#${detailHash}/details/workflow`, 'a tab click rewrites the address');

  // Escape: Details -> glance -> the list.
  doc.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await settle(ctx.window, 4);
  assert.equal(ctx.window.location.hash, `#${detailHash}`);
  assert.equal(hd.dataset.mode, 'glance');
});

// The saved run's bar carries the Running bar's controls in its order (Run after, the
// Resume split, Models, Pause, Stop, then the terminal button), in both modes. The Details header keeps
// only the PR controls and the ⋯ menu, and the glance card carries no run control.
const HD_BAR_ORDER = ['hd-after', 'hd-resume-split', 'hd-models', 'hd-pause', 'hd-stop', 'term-opener'];
test('History bar per finished/paused status: Run after, Resume split only when resumable, Stop only when paused, no Pause without a live run', async () => {
  const rows = [];
  for (const [status, resumable, finished] of [
    ['done', false, true], ['paused', true, false], ['interrupted', true, false],
    ['stopped', false, true], ['error', false, true],
  ]) {
    rows.push({ name: `History bar, ${status} run: Run after${resumable ? ' and the Resume split' : ''}, ${status === 'paused' ? 'Stop' : 'no Stop'} and no Pause without a live run`, run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, status } }, rows: [{ ...ROW, status }] });
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const hd = ctx.window.document.querySelector('#hist-detail .hd');
      const end = hd.querySelector('.hd-bar .rd-bar-end');
      assert.deepEqual([...end.children].map((c) => HD_BAR_ORDER.find((k) => c.classList.contains(k)) || c.className), HD_BAR_ORDER);
      const after = end.querySelector('.hd-after');
      assert.equal(after.hidden, false, 'a saved run can always be waited for');
      assert.equal(after.dataset.minLevel, 'advanced');
      assert.equal(after.textContent.trim(), 'Run after');
      assert.ok(after.querySelector('svg'), 'the Running bar\'s arrow leads the label');
      const title = finished ? 'Start a follow-up run' : 'Schedule a run after this';
      assert.equal(after.title, title);
      assert.equal(after.getAttribute('aria-label'), title);
      assert.equal(end.querySelector('.hd-resume-split').hidden, !resumable);
      assert.equal(end.querySelector('.hd-resume').hidden, !resumable);
      assert.ok(end.querySelector('.hd-resume svg'), 'Resume leads with the play glyph');
      assert.equal(end.querySelector('.hd-models').hidden, status !== 'paused', 'Models is for a PAUSED run only');
      assert.equal(end.querySelector('.hd-pause').hidden, true, 'no live run: nothing to pause');
      assert.equal(end.querySelector('.hd-stop').hidden, status !== 'paused',
        status === 'paused' ? 'a paused saved run is stopped through its row' : 'no live run: nothing to stop');
      const header = hd.querySelector('.hd-header');
      for (const sel of ['.hd-after', '.hd-resume-split', '.hd-resume', '.hd-pause', '.hd-stop']) {
        assert.equal(header.querySelector(sel), null, `${sel} is not in the Details header`);
      }
      assert.ok(header.querySelector('.hd-pr') && header.querySelector('.hd-pr-link') && header.querySelector('.hd-more'),
        'the Details header keeps the PR controls and the ⋯ menu');
      assert.equal(hd.querySelector('.hd-result [class*="hd-g-resume"], .hd-result .hd-g-after'), null, 'the card carries no run control');
      click(ctx.window, after);
      assert.equal(ctx.window.location.hash, `#new/after/${ROW.id}`);
    } });
  }
  await checkRows(rows);
});

// Pause and Stop act on the pipeline's LIVE run (POST /api/pause and /api/stop need its
// runId); a paused one shows Resume only.
test('History bar of a live pipeline: Pause and Stop act on its live run', async () => {
  const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } }, rows: [{ ...ROW, status: 'running' }] });
  const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  frame({ type: 'hello', runs: [{ runId: 'r-live', title: ROW.title, projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: ROW.id }] });
  await settle(ctx.window, 4);
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const end = doc.querySelector('#hist-detail .hd-bar .rd-bar-end');
  const pause = end.querySelector('.hd-pause');
  const stop = end.querySelector('.hd-stop');
  assert.equal(pause.hidden, false, 'a live run can be paused');
  assert.equal(stop.hidden, false, 'a live run can be stopped');
  assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'nothing to resume while it runs');
  assert.equal(end.querySelector('.hd-after').title, 'Schedule a run after this');
  click(ctx.window, pause);
  await settle(ctx.window);
  const pauses = ctx.calls.filter((c) => c.url.endsWith('/api/pause'));
  assert.equal(pauses.length, 1);
  assert.deepEqual(JSON.parse(pauses[0].opts.body), { runId: 'r-live' });
  // C16: a frame landing before the run flips to `pausing` never re-arms Pause mid-request.
  frame({ type: 'state', runId: 'r-live', id: ROW.id, status: 'running' });
  await settle(ctx.window, 4);
  assert.equal(pause.disabled, true, 'the pause request still owns the button');
  click(ctx.window, pause);
  await settle(ctx.window);
  assert.equal(ctx.calls.filter((c) => c.url.endsWith('/api/pause')).length, 1, 'no second POST');
  click(ctx.window, stop);
  const modal = doc.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'Stop confirms first');
  assert.equal(modal.dataset.runId, 'r-live');
  click(ctx.window, modal.querySelector('.stop-cancel'));
  // The pause lands: the request's disable holds while the run is pausing.
  frame({ type: 'state', runId: 'r-live', id: ROW.id, status: 'pausing' });
  await settle(ctx.window, 4);
  assert.equal(pause.hidden, false);
  assert.equal(pause.disabled, true, 'no second POST while it pauses');
  // The run parks: Pause goes, Resume comes, Stop stays (a paused run can still be discarded),
  // as on the run page, although this screen loaded on a running pipeline.
  frame({ type: 'done', runId: 'r-live', status: 'paused' });
  await settle(ctx.window, 6);
  assert.equal(pause.hidden, true, 'a paused run is not paused again');
  assert.equal(end.querySelector('.hd-resume-split').hidden, false, 'a paused run can be resumed');
  assert.equal(end.querySelector('.hd-resume').hidden, false);
  assert.equal(stop.hidden, false);
  // It ends: neither control is left.
  frame({ type: 'state', runId: 'r-live', id: ROW.id, status: 'stopped' });
  await settle(ctx.window, 6);
  assert.equal(pause.hidden, true);
  assert.equal(stop.hidden, true, 'a finished run cannot be stopped');
  assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'a stopped run is not resumed');
  // A resume elsewhere mints a new live run: Pause is armed again, and greys out while that
  // run pauses even though this page sent nothing.
  frame({ type: 'run-created', runId: 'r-live2', title: ROW.title, projectDir: PROJECT, status: 'running', kind: 'run' });
  frame({ type: 'state', runId: 'r-live2', id: ROW.id, status: 'running' });
  await settle(ctx.window, 4);
  assert.equal(pause.hidden, false);
  assert.equal(pause.disabled, false, 'the new run can be paused');
  assert.equal(stop.hidden, false);
  assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'nothing to resume while it runs');
  frame({ type: 'state', runId: 'r-live2', id: ROW.id, status: 'pausing' });
  await settle(ctx.window, 4);
  assert.equal(pause.disabled, true, 'pausing: as on the run page');
  click(ctx.window, stop);
  assert.equal(modal.dataset.runId, 'r-live2', 'Stop reads the live run at click time');
});

// D23: a resumed pipeline can leave its superseded paused run in the runs map, FIRST in Map
// order (another tab resumed it, or a scheduled "Resume at…" fired). The bar follows the
// newest lineage: Pause and Stop target it, and both go once it ends.
test('History bar of a resumed pipeline: Pause/Stop and the Resume split follow the newest live run, never the superseded one', async () => {
  await checkRows([
    { name: 'History bar of a resumed pipeline: Pause and Stop act on the newest run, never the superseded one', run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } }, rows: [{ ...ROW, status: 'running' }] });
      const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
      frame({ type: 'hello', runs: [
        { runId: 'r-old', title: ROW.title, projectDir: PROJECT, status: 'paused', startedAt: '00:00:00', pipelineId: ROW.id, pauseReason: 'manual' },
        { runId: 'r-new', title: ROW.title, projectDir: PROJECT, status: 'running', startedAt: '00:01:00', pipelineId: ROW.id },
      ] });
      await settle(ctx.window, 4);
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const doc = ctx.window.document;
      const end = doc.querySelector('#hist-detail .hd-bar .rd-bar-end');
      const pause = end.querySelector('.hd-pause');
      const stop = end.querySelector('.hd-stop');
      assert.equal(pause.hidden, false, 'the running lineage can be paused');
      assert.equal(stop.hidden, false);
      assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'the dead paused entry offers no Resume');
      click(ctx.window, stop);
      const modal = doc.getElementById('stop-modal');
      assert.equal(modal.dataset.runId, 'r-new', 'Stop targets the live run, not the superseded one');
      click(ctx.window, modal.querySelector('.stop-cancel'));
      click(ctx.window, pause);
      await settle(ctx.window);
      const pauses = ctx.calls.filter((c) => c.url.endsWith('/api/pause'));
      assert.deepEqual(pauses.map((c) => JSON.parse(c.opts.body)), [{ runId: 'r-new' }]);
      // The newest run finishes: the stale paused entry does not bring Pause or Stop back.
      frame({ type: 'done', runId: 'r-new', status: 'done' });
      await settle(ctx.window, 6);
      assert.equal(pause.hidden, true, 'a done pipeline cannot be paused');
      assert.equal(stop.hidden, true, 'a done pipeline cannot be stopped');
      assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'nor resumed through its dead entry');
    } },
    // Resume follows the live run too: a pipeline that pauses after this screen loaded offers it
    // (with its caret, gated on the run's own pause reason), and one resumed elsewhere stops
    // offering it beside Pause and Stop.
    { name: 'History bar: the Resume split follows the pipeline\'s live run', run: async () => {
      const posts = [];
      const ctx = await bootDetail({
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } }, rows: [{ ...ROW, status: 'running' }],
        arms: (url, opts) => {
          if (url === '/api/resume') { posts.push(JSON.parse(opts.body)); return ok({ ok: true, runId: 'r-9', pipelineId: ROW.id }); }
          return null;
        },
      });
      const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
      frame({ type: 'hello', runs: [{ runId: 'r-live', title: ROW.title, projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: ROW.id }] });
      await settle(ctx.window, 4);
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const end = ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end');
      const split = end.querySelector('.hd-resume-split');
      assert.equal(split.hidden, true);
      // It parks on a pipeline cost cap, which no schedule may continue past.
      frame({ type: 'done', runId: 'r-live', status: 'paused', reason: 'cost_pipeline' });
      await settle(ctx.window, 6);
      assert.equal(split.hidden, false, 'paused after load: Resume is offered');
      assert.equal(end.querySelector('.hd-pause').hidden, true);
      assert.equal(end.querySelector('.hd-stop').hidden, false);
      const more = end.querySelector('.hd-resume-more');
      click(ctx.window, more);
      assert.equal(end.querySelector('.hd-resume-menu').hidden, false, 'the caret opens its menu');
      assert.equal(end.querySelector('.hd-resume-at-item').disabled, true, 'a cap pause is never scheduled');
      click(ctx.window, end.querySelector('.hd-resume'));
      await settle(ctx.window, 5);
      assert.deepEqual(posts, [{ pipelineId: ROW.id, baseCheck: true }], 'Resume is wired although the screen loaded running');
      assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running/r-9');
    } },
  ]);
});

// The run page logs a failed pause into the run's log, which this page does not show: the
// saved run says it under its bar. And the stop dialog, a top-level overlay, leaves with it.
test('History bar failures: a failed pause is said inline, a refused Resume keeps its title and toasts Retry; the stop dialog closes with the screen', async () => {
  await checkRows([
    { name: 'History bar: a failed pause is said inline, and the stop dialog closes with the screen', run: async () => {
      let pauses = 0;
      const ctx = await bootDetail({
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } }, rows: [{ ...ROW, status: 'running' }],
        arms: (url) => (url !== '/api/pause' ? null : ++pauses === 1 ? fail(409, { error: 'run is not live' }) : ok({ ok: true })),
      });
      const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
      frame({ type: 'hello', runs: [{ runId: 'r-live', title: ROW.title, projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: ROW.id }] });
      await settle(ctx.window, 4);
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const doc = ctx.window.document;
      const hd = doc.querySelector('#hist-detail .hd');
      const pause = hd.querySelector('.hd-bar .hd-pause');
      click(ctx.window, pause);
      await settle(ctx.window, 4);
      const err = hd.querySelector('.hd-error');
      assert.equal(err.hidden, false, 'the failure is shown');
      assert.equal(err.textContent, 'Could not pause: run is not live');
      assert.equal(pause.disabled, false, 'and Pause can be tried again');
      click(ctx.window, pause);
      await settle(ctx.window, 4);
      assert.equal(pauses, 2);
      assert.equal(err.hidden, true, 'a pause that went through takes its failure away');
      click(ctx.window, hd.querySelector('.hd-bar .hd-stop'));
      const modal = doc.getElementById('stop-modal');
      assert.equal(modal.classList.contains('hidden'), false);
      go(ctx.window, 'new');
      await settle(ctx.window, 6);
      assert.equal(ctx.window.location.hash, '#new');
      assert.equal(modal.classList.contains('hidden'), true, 'leaving the saved run closes its stop dialog');
    } },
    { name: 'a refused Resume on the saved run keeps the button title and raises a toast with Retry', run: async () => {
      const bodies = [];
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'paused' }],
        detail: { ...DETAIL, state: { ...DETAIL.state, status: 'paused', resumable: true } },
        arms: (url, opts) => {
          if (url !== '/api/resume') return null;
          bodies.push(JSON.parse(opts.body));
          return fail(400, { error: 'pipeline not found' });
        },
      });
      await openDetail(ctx);
      const doc = ctx.window.document;
      const btn = doc.querySelector('#hist-detail .hd-resume');
      click(ctx.window, btn);
      await settle(ctx.window, 6);
      assert.equal(bodies.length, 1);
      assert.match(btn.title, /Could not resume: pipeline not found/);
      assert.deepEqual(lastToast(doc), { tone: 'err', title: 'Could not resume the run',
        detail: 'pipeline not found', action: 'Retry' });
      clickToastAction(ctx.window);
      await settle(ctx.window, 6);
      assert.equal(bodies.length, 2, 'Retry resumes again');
    } },
  ]);
});

test('History bar of a paused pipeline resumed elsewhere: Pause and Stop replace Resume', async () => {
  const ctx = await bootDetail({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const end = ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end');
  const split = end.querySelector('.hd-resume-split');
  assert.equal(split.hidden, false, 'paused: Resume');
  assert.equal(end.querySelector('.hd-pause').hidden, true);
  assert.equal(end.querySelector('.hd-stop').hidden, false, 'paused: Stop through its row');
  // Its menu is open when another tab resumes the run.
  click(ctx.window, end.querySelector('.hd-resume-more'));
  const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  frame({ type: 'run-created', runId: 'r-2', title: ROW.title, projectDir: PROJECT, status: 'running', kind: 'run' });
  frame({ type: 'state', runId: 'r-2', id: ROW.id, status: 'running' });
  await settle(ctx.window, 6);
  assert.equal(split.hidden, true, 'a running pipeline offers no Resume');
  assert.equal(end.querySelector('.hd-resume-menu').hidden, true, 'and closes its menu');
  assert.equal(end.querySelector('.hd-resume-more').getAttribute('aria-expanded'), 'false');
  assert.equal(end.querySelector('.hd-pause').hidden, false);
  assert.equal(end.querySelector('.hd-stop').hidden, false);
  // That run finishes: the pipeline is over, so the load-time pause does not bring Resume back.
  frame({ type: 'done', runId: 'r-2', status: 'done' });
  await settle(ctx.window, 6);
  assert.equal(split.hidden, true, 'a done pipeline offers no Resume');
  assert.equal(end.querySelector('.hd-pause').hidden, true);
  assert.equal(end.querySelector('.hd-stop').hidden, true);
});

// A restarted server lists none of the old process's runs, but the tab keeps their entries
// (onHello only upserts). Such an entry is neither the pipeline's live run nor its newest run
// that ended: the saved run keeps its working Resume, never a Pause or Stop on a runId the new
// server does not know. A run the new boot starts for the pipeline is live again.
test("History bar after a server restart: an old boot's running/paused/stopped run is not the pipeline's run; a run the new server lists is still live", async () => {
  const rows = [];
  for (const [stale, saved] of [['running', 'interrupted'], ['paused', 'paused'], ['stopped', 'paused']]) {
    rows.push({ name: `History bar after a server restart: the old boot's ${stale} run is not the pipeline's run`, run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, status: saved } }, rows: [{ ...ROW, status: saved }] });
      const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
      const entry = { runId: 'r-old', title: ROW.title, projectDir: PROJECT, status: stale, startedAt: '00:00:00', pipelineId: ROW.id };
      frame({ type: 'hello', bootId: 'b1', runs: [entry] });
      await settle(ctx.window, 4);
      frame({ type: 'hello', bootId: 'b1', runs: [entry] });   // a reconnect to the same server changes nothing
      frame({ type: 'hello', bootId: 'b2', runs: [] });
      await settle(ctx.window, 4);
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const doc = ctx.window.document;
      const end = doc.querySelector('#hist-detail .hd-bar .rd-bar-end');
      const resume = end.querySelector('.hd-resume');
      const pause = end.querySelector('.hd-pause');
      const stop = end.querySelector('.hd-stop');
      assert.equal(end.querySelector('.hd-resume-split').hidden, false, `the ${saved} run can still be resumed`);
      assert.equal(resume.hidden, false);
      assert.equal(resume.disabled, false);
      assert.equal(pause.hidden, true, 'no Pause on a run the server lost');
      assert.equal(stop.hidden, saved !== 'paused',
        saved === 'paused' ? 'a paused saved run is stopped through its row' : 'no Stop on an interrupted run');
      // The new server resumes the pipeline: that run is live.
      frame({ type: 'run-created', runId: 'r-2', title: ROW.title, projectDir: PROJECT, status: 'running', kind: 'run' });
      frame({ type: 'state', runId: 'r-2', id: ROW.id, status: 'running' });
      await settle(ctx.window, 6);
      assert.equal(pause.hidden, false);
      assert.equal(stop.hidden, false);
      assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'nothing to resume while it runs');
      click(ctx.window, stop);
      const modal = doc.getElementById('stop-modal');
      assert.equal(modal.dataset.runId, 'r-2');
      click(ctx.window, modal.querySelector('.stop-cancel'));
      click(ctx.window, pause);   // no live run when the screen loaded: Pause reads it at click time
      await settle(ctx.window);
      assert.deepEqual(ctx.calls.filter((c) => c.url.endsWith('/api/pause')).map((c) => JSON.parse(c.opts.body)), [{ runId: 'r-2' }]);
    } });
  }
  // The tab can learn of a run before the restarted server's hello (this tab's own resume POST
  // answered while the socket was down): the hello lists it, so it stays the pipeline's live run.
  rows.push({ name: 'History bar after a server restart: a run the new server lists is still live', run: async () => {
    const ctx = await bootDetail({ detail: PAUSED_DETAIL, rows: [{ ...ROW, status: 'paused' }] });
    const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
    const run = (runId, status) => ({ runId, title: ROW.title, projectDir: PROJECT, status, startedAt: '00:00:00', pipelineId: ROW.id });
    frame({ type: 'hello', bootId: 'b1', runs: [run('r-old', 'paused')] });
    frame({ type: 'run-created', runId: 'r-new', title: ROW.title, projectDir: PROJECT, status: 'running', kind: 'run' });
    frame({ type: 'state', runId: 'r-new', id: ROW.id, status: 'running' });
    frame({ type: 'hello', bootId: 'b2', runs: [run('r-new', 'running')] });
    await settle(ctx.window, 4);
    await openDetail(ctx, '');
    await settle(ctx.window, 6);
    const end = ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end');
    assert.equal(end.querySelector('.hd-pause').hidden, false, 'the listed run can be paused');
    assert.equal(end.querySelector('.hd-stop').hidden, false);
    assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'nothing to resume while it runs');
    click(ctx.window, end.querySelector('.hd-pause'));
    await settle(ctx.window);
    assert.deepEqual(ctx.calls.filter((c) => c.url.endsWith('/api/pause')).map((c) => JSON.parse(c.opts.body)), [{ runId: 'r-new' }]);
  } });
  await checkRows(rows);
});

test('History bar, paused saved run: Stop settles it (and a pre-restart copy in this tab) through its row, then the page reloads stopped', async () => {
  await checkRows([
    { name: 'History bar, paused saved run: Stop settles it through its row, then the page reloads stopped', run: async () => {
      const ctx = await bootDetail({
        rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL,
        arms: (url, opts, box) => {
          if (!url.endsWith('/api/stop')) return null;
          box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };
          box.rows = [{ ...ROW, status: 'stopped' }];
          return ok({ ok: true, pipelineId: ROW.id, runId: null, status: 'stopped' });
        },
      });
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const doc = ctx.window.document;
      const stop = doc.querySelector('#hist-detail .hd-bar .hd-stop');
      assert.equal(stop.hidden, false);
      click(ctx.window, stop);
      const modal = doc.getElementById('stop-modal');
      assert.equal(modal.classList.contains('hidden'), false, 'Stop confirms first');
      assert.equal(modal.dataset.pipelineId, ROW.id);
      assert.equal(modal.dataset.runId, undefined);
      assert.equal(modal.querySelector('.stop-ident-title').textContent, ROW.title);
      assert.equal(modal.querySelector('.stop-ident-branch').textContent, ROW.branch);
      assert.equal(modal.querySelector('.stop-cancel').textContent, 'Keep paused');
      const fetchesBefore = ctx.calls.filter((c) => c.url.endsWith(DETAIL_URL)).length;
      click(ctx.window, modal.querySelector('.stop-confirm'));
      await settle(ctx.window, 10);
      assert.deepEqual(ctx.calls.filter((c) => c.url.endsWith('/api/stop')).map((c) => JSON.parse(c.opts.body)), [{ pipelineId: ROW.id }]);
      assert.ok(modal.classList.contains('hidden'), 'closed on success');
      assert.ok(ctx.calls.filter((c) => c.url.endsWith(DETAIL_URL)).length > fetchesBefore, 'the saved run was fetched again');
      const end = doc.querySelector('#hist-detail .hd-bar .rd-bar-end');
      assert.equal(end.querySelector('.hd-stop').hidden, true, 'stopped: nothing left to stop');
      assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'stopped: nothing to resume');
    } },
    { name: 'History bar, paused saved run with a pre-restart copy in this tab: Stop settles that copy too', run: async () => {
      const ctx = await bootDetail({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL,
        arms: (url, opts, box) => {
          if (!url.endsWith('/api/stop')) return null;
          box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };
          box.rows = [{ ...ROW, status: 'stopped' }];
          return ok({ ok: true, pipelineId: ROW.id, runId: null, status: 'stopped' });
        } });
      const send = (m) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(m) });
      ctx.wsBox.ws.dispatch('open', {});
      // A paused run this tab learnt of in the old boot; the new boot (a restart) no longer holds it.
      send({ type: 'hello', bootId: 'b1', runs: [{ runId: 'old1', title: ROW.title, projectDir: ROW.projectDir,
        status: 'paused', startedAt: ROW.startedAt, kind: 'run', pipelineId: ROW.id }] });
      send({ type: 'done', runId: 'old1', status: 'paused' });
      send({ type: 'hello', bootId: 'b2', runs: [] });
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const doc = ctx.window.document;
      click(ctx.window, doc.querySelector('#hist-detail .hd-bar .hd-stop'));
      click(ctx.window, doc.getElementById('stop-modal').querySelector('.stop-confirm'));
      await settle(ctx.window, 10);
      assert.equal(doc.getElementById('nav-needs-count').hidden, true, 'the old copy no longer reads Paused');
    } },
  ]);
});

test('History bar, paused saved run stopped from elsewhere: the row refresh takes Stop and Resume away', async () => {
  const ctx = await bootDetail({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const end = ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end');
  assert.equal(end.querySelector('.hd-stop').hidden, false);
  assert.equal(end.querySelector('.hd-resume-split').hidden, false);
  // Its Stop dialog is open when the run is stopped elsewhere: it closes with the page it was opened on.
  click(ctx.window, end.querySelector('.hd-stop'));
  const modal = ctx.window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false);
  ctx.box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };   // what the server now holds
  await deliverRows(ctx, [{ ...ROW, status: 'stopped' }]);   // another tab / the CLI / chat stopped it
  assert.ok(modal.classList.contains('hidden'), 'no dialog left asking to stop a stopped run');
  const end2 = ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end');   // the page was re-read
  assert.equal(end2.querySelector('.hd-stop').hidden, true, 'no Stop on a stopped run');
  assert.equal(end2.querySelector('.hd-resume-split').hidden, true, 'no Resume on a stopped run');
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-status-word').textContent, 'Stopped', 'the page reads stopped, not Paused');
});

test('History bar, paused saved run stopped from elsewhere under an open comment draft: the page keeps the draft', async () => {
  const ctx = await bootDetail({ rows: [{ ...ROW, status: 'paused' }], detail: PAUSED_DETAIL });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const fetches = () => ctx.calls.filter((c) => c.url.endsWith(DETAIL_URL)).length;
  const before = fetches();
  ctx.box.detail = { ...DETAIL, state: { ...DETAIL.state, status: 'stopped' } };
  // A reply draft in a thread, then a new comment's composer: each lives only in the page.
  for (const [cls, key] of [['hd-cmt-thread', 'draft'], ['hd-cmt-block', 'composer']]) {
    const draft = doc.createElement('div');
    draft.className = cls;
    draft.dataset[key] = '1';
    doc.querySelector('#hist-detail').firstElementChild.appendChild(draft);
    await deliverRows(ctx, [{ ...ROW, status: 'stopped' }]);
    assert.equal(fetches(), before, `not re-read under an open ${cls} draft`);
    assert.ok(draft.isConnected, 'the draft is kept');
    draft.remove();
  }
  const end = doc.querySelector('#hist-detail .hd-bar .rd-bar-end');
  assert.equal(end.querySelector('.hd-stop').hidden, true, 'the bar still drops Stop');
  assert.equal(end.querySelector('.hd-resume-split').hidden, true, 'and Resume');
  await deliverRows(ctx, [{ ...ROW, status: 'stopped' }]);
  assert.ok(fetches() > before, 'with no draft open, the next row refresh re-reads the page');
});

// An in-flight resume owns its button: neither a run frame (paintHdLive), a budget refresh nor
// the row landing (refreshHistResumeGating) re-enables it, so a second click cannot land (a
// disabled button takes no click; jsdom's synthetic one would, so the pin is `disabled`).
test('History bar: a resume in flight is never re-armed by a frame, a budget refresh or a row', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const posts = [];
  const ctx = await bootDetail({
    detail: PAUSED_DETAIL, rows: [{ ...ROW, status: 'paused' }],
    arms: (url, opts) => {
      if (url !== '/api/resume') return null;
      posts.push(JSON.parse(opts.body));
      return held.then(() => ok({ ok: true, runId: 'r-9', pipelineId: ROW.id }));
    },
  });
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  const resume = ctx.window.document.querySelector('#hist-detail .hd-bar .hd-resume');
  click(ctx.window, resume);
  await settle(ctx.window);
  assert.equal(resume.disabled, true, 'the resume claims its button');
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'budget-changed' }) });
  await deliverRows(ctx, [{ ...ROW, status: 'paused' }]);
  assert.equal(resume.disabled, true, 'nothing re-arms it mid-POST');
  assert.equal(resume.textContent.trim(), 'Resuming…', 'nor repaints its label');
  release();
  await settle(ctx.window, 6);
  assert.deepEqual(posts, [{ pipelineId: ROW.id, baseCheck: true }]);
  assert.equal(ctx.window.location.hash.replace(/^#/, ''), 'running/r-9');
});

// A run frame can land while the saved run's details are still loading: the bar waits for them.
test('History bar: a run frame during the detail fetch is painted once the details land', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const ctx = await bootDetail({
    detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } }, rows: [{ ...ROW, status: 'running' }],
    arms: (url, _opts, box) => (url.endsWith(DETAIL_URL) ? held.then(() => ok(box.detail)) : null),
  });
  const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
  frame({ type: 'hello', runs: [{ runId: 'r-live', title: ROW.title, projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: ROW.id }] });
  await openDetail(ctx, '');
  await settle(ctx.window, 4);
  assert.doesNotThrow(() => frame({ type: 'state', runId: 'r-live', id: ROW.id, status: 'running' }));
  release();
  await settle(ctx.window, 6);
  const end = ctx.window.document.querySelector('#hist-detail .hd-bar .rd-bar-end');
  assert.equal(end.querySelector('.hd-pause').hidden, false);
  assert.equal(end.querySelector('.hd-stop').hidden, false);
});

// Resume is gated on the LIVE run's pause, which the screen never loaded: an error pause's
// cause rides its title, and a total-budget pause is blocked once the budget runs out.
test('History bar: a live pause after load (error cause named / total-budget pause blocked)', async () => {
  const rows = [];
  for (const [label, done, check] of [
    ['an error pause names its cause', { reason: 'error', detail: 'disk full' },
      (btn) => { assert.equal(btn.disabled, false); assert.match(btn.title, /Paused after an error: disk full/); }],
    ['a total-budget pause is blocked by the budget', { reason: 'cost_total' },
      (btn) => { assert.equal(btn.disabled, true); assert.match(btn.title, /Total budget reached/); }],
  ]) {
    rows.push({ name: `History bar: a live pause after load, ${label}`, run: async () => {
      const ctx = await bootDetail({ detail: { ...DETAIL, state: { ...DETAIL.state, status: 'running' } }, rows: [{ ...ROW, status: 'running' }] });
      const frame = (msg) => ctx.wsBox.ws.dispatch('message', { data: JSON.stringify(msg) });
      frame({ type: 'hello', runs: [{ runId: 'r-live', title: ROW.title, projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: ROW.id }] });
      await settle(ctx.window, 4);
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      frame({ type: 'done', runId: 'r-live', status: 'paused', ...done });
      await settle(ctx.window, 6);
      const resume = ctx.window.document.querySelector('#hist-detail .hd-bar .hd-resume');
      assert.equal(resume.hidden, false);
      if (done.reason === 'cost_total') {
        ctx.box.budget = blockedBudget();
        frame({ type: 'budget-changed' });
        await settle(ctx.window, 6);
      }
      check(resume);
    } });
  }
  await checkRows(rows);
});

// The card's bottom: one pull request button at most, each state in its own colour.
test('History glance carries exactly one PR button (eligible / open / merged)', async () => {
  const rows = [];
  for (const [label, pr, cls, icon, text] of [
    ['eligible', null, 'hd-g-pr', 'pr-create', 'Create pull request'],
    ['open', { state: 'OPEN', url: 'https://github.com/o/r/pull/7' }, 'pr-view', 'external', 'View pull request'],
    ['merged', { state: 'MERGED', url: 'https://github.com/o/r/pull/7' }, 'pr-merged', 'merged', 'View pull request'],
  ]) {
    rows.push({ name: `History glance, ${label} PR: the card carries exactly one PR button`, run: async () => {
      const row = { ...ROW, pr };
      const ctx = await bootDetail({
        rows: [row],
        arms: (url) => (url.endsWith('/api/history') ? ok({ pipelines: [row], ghAvailable: true }) : null),
      });
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const slot = ctx.window.document.querySelector('#hist-detail .hd-glance .rd-pr-slot');
      assert.ok(slot, 'the card has its pull request slot');
      assert.equal(slot.closest('.hd-result'), null, 'outside the result host paintHdGlance rebuilds');
      assert.equal(slot.hidden, false);
      // Known at first paint (a cached row): the button directly, no placeholder and no morph.
      assert.equal(slot.classList.contains('is-pending') || slot.classList.contains('is-morph'), false, slot.className);
      assert.equal(slot.querySelector('.rd-pr-spin, .rd-pr-fill'), null);
      const ctas = [...slot.children];
      assert.equal(ctas.length, 1, 'one button, the pull request');
      const [cta] = ctas;
      assert.ok(cta.classList.contains('rd-cta') && cta.classList.contains(cls), `${cls}: ${cta.className}`);
      assert.equal(cta.classList.contains('alt'), false, 'no grey secondary');
      assert.equal(cta.firstElementChild.dataset.icon, icon);
      assert.equal(cta.textContent, text);
      if (pr) {
        assert.equal(cta.tagName, 'A');
        assert.equal(cta.getAttribute('href'), pr.url);
        assert.equal(cta.target, '_blank', 'GitHub opens in a new tab');
      }
    } });
  }
  await checkRows(rows);
});

// The PR lookup still running: a placeholder in the slot, which then morphs in place.
// gh's answer for the open run, as the server pushes it (onHistoryPr drops a stale token).
function prBatch(ctx, items) {
  const token = ctx.calls.filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body)
    .map((c) => JSON.parse(c.opts.body).token).at(-1);
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', token, done: true, items }) });
}
// Longer than the morph and the exit (paintPrCta's PR_CTA_MORPH_MS / PR_CTA_OUT_MS).
const MORPH_MS = 600;
async function pendingGlance(shared = ROW, { ghAvailable = true, level = '' } = {}) {
  // A copy without `pr` (the lookup has not answered): patchHistoryPr writes `pr` into the row
  // object it is handed, and an earlier test's PR watchdog (finalizeHistoryPr, 15 s) can still
  // write `pr: null` into the shared ROW during a slow run.
  const { pr: _answered, ...row } = shared;
  const ctx = await bootDetail({
    rows: [row],
    arms: (url) => (url.endsWith('/api/history') ? ok({ pipelines: [row], ghAvailable }) : null),
  });
  if (level) ctx.window.document.documentElement.dataset.level = level;
  await openDetail(ctx, '');
  await settle(ctx.window, 6);
  return { ctx, slot: ctx.window.document.querySelector('#hist-detail .hd-glance .rd-pr-slot') };
}

test('History glance PR lookup pending: a busy placeholder morphs in place into the link, or into Create forwarding to the header button', async (t) => {
  await checkRows([
    { name: 'History glance, PR lookup pending: a busy placeholder, then the SAME slot morphs into the link', run: async () => {
      const { ctx, slot } = await pendingGlance();
      assert.equal(slot.hidden, false);
      assert.ok(slot.classList.contains('is-pending'), slot.className);
      assert.equal(slot.getAttribute('aria-busy'), 'true');
      assert.ok(slot.querySelector('.rd-pr-spin'), 'a spinner');
      assert.match(slot.textContent, /Checking the pull request…/);
      assert.equal(slot.querySelector('button, a, .rd-cta'), null, 'not clickable');
      const url = 'https://github.com/o/r/pull/7';
      const timers = useAppTimers(t);
      try {
        prBatch(ctx, [{ projectKey: KEY, id: ROW.id, pr: { state: 'MERGED', url } }]);
        await timers.settle();
        assert.equal(ctx.window.document.querySelector('#hist-detail .hd-glance .rd-pr-slot'), slot, 'the slot is never replaced');
        assert.ok(slot.classList.contains('is-morph'), slot.className);
        assert.equal(slot.getAttribute('aria-busy'), null);
        assert.ok(slot.querySelector('.rd-pr-fill.pr-merged'), 'the merged colour grows from the spinner');
        const link = slot.querySelector('a.rd-cta.hd-g-pr-link.pr-merged');
        assert.ok(link, slot.innerHTML);
        assert.equal(link.getAttribute('href'), url);
        assert.equal(link.target, '_blank');
        assert.equal(link.rel, 'noopener');
        await timers.advance(MORPH_MS);
        assert.equal(slot.classList.contains('is-morph'), false);
        assert.deepEqual([...slot.children], [link], 'the spinner and the colour layer are removed');
        // paintHdGlance repaints on every PR batch for this run: no rebuild, no replay.
        prBatch(ctx, [{ projectKey: KEY, id: ROW.id, pr: { state: 'MERGED', url } }]);
        await timers.settle();
        assert.equal(slot.classList.contains('is-morph'), false, 'the morph plays once');
        assert.equal(slot.querySelector('a.rd-cta'), link, 'the same link');
      } finally {
        t.mock.timers.reset();
      }
    } },
    { name: 'History glance: a pending lookup that finds no PR morphs into Create, which forwards to the header\'s button', run: async () => {
      const { ctx, slot } = await pendingGlance();
      prBatch(ctx, [{ projectKey: KEY, id: ROW.id, pr: null }]);
      await settle(ctx.window, 4);
      assert.ok(slot.classList.contains('is-morph'), slot.className);
      const btn = slot.querySelector('button.rd-cta.hd-g-pr');
      assert.ok(btn, slot.innerHTML);
      assert.equal(btn.textContent, 'Create pull request');
      let forwarded = 0;
      ctx.window.document.querySelector('#hist-detail .hd-pr').onclick = () => { forwarded += 1; };
      click(ctx.window, btn);
      assert.equal(forwarded, 1, 'the one wiring: .hd-pr opens the ship-it modal');
    } },
  ]);
});

test('History glance meta: a feature-branch chip that copies it, none without a branch', async () => {
  await checkRows([
    { name: 'History glance: the meta line carries the feature branch as a chip that copies it', run: async () => {
      const ctx = await bootDetail();
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      const { window } = ctx;
      const meta = window.document.querySelector('#hist-detail .hd-glance .rd-page-meta');
      const chip = meta.querySelector('.rd-page-branch');
      assert.ok(chip, 'the chip is in the meta line');
      assert.equal(chip.hidden, false);
      assert.equal(chip.dataset.minLevel, 'advanced', 'the Details branch button\'s level');
      assert.equal(chip.querySelector('.rd-page-branch-name').textContent, ROW.branch);
      assert.equal(chip.title, ROW.branch, 'the full name in the tooltip');
      assert.equal(meta.firstChild.nodeType, 3, 'paintPageHead\'s text stays the line\'s first node');
      assert.match(meta.firstChild.data, /^proj · /);
      const writes = [];
      Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { writes.push(t); } } });
      click(window, chip);
      await settle(window, 2);
      assert.deepEqual(writes, [ROW.branch]);
      assert.ok(chip.classList.contains('copied'), 'the copied tick, as in Details');
      // The row repaints the header (refreshHdFromRow): the same chip, bound once.
      await deliverRows(ctx, [{ ...ROW }]);
      assert.equal(meta.querySelectorAll('.rd-page-branch').length, 1);
      assert.equal(meta.querySelector('.rd-page-branch'), chip);
      click(window, chip);
      await settle(window, 2);
      assert.deepEqual(writes, [ROW.branch, ROW.branch], 'one copy per click');
    } },
    { name: 'History glance: a run without a feature branch shows no chip', run: async () => {
      const ctx = await bootDetail({
        rows: [{ ...ROW, branch: undefined }],
        detail: { ...DETAIL, state: { ...DETAIL.state, branch: null } },
      });
      await openDetail(ctx, '');
      await settle(ctx.window, 6);
      assert.equal(ctx.window.document.querySelector('#hist-detail .hd-glance .rd-page-branch').hidden, true);
    } },
  ]);
});

test('a deep link to a History Details tab opens it once the run loads', async () => {
  const ctx = await bootDetail({ detail: GLANCE_DETAIL });
  go(ctx.window, `${detailHash}/details/agents`);
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#hist-detail .hd').dataset.mode, 'details');
  assert.ok(doc.querySelector('#hist-detail .hd-tab[data-sec="agents"]').classList.contains('active'));
});

// ---------------------------------------------------------------------------
// Actions (issue #529): the tab, the Overview strip and the running-service surfaces
// ---------------------------------------------------------------------------

const ACT_MODEL = {
  runId: ROW.id, workspace: false, finished: true, enabled: true,
  members: [{ projectKey: KEY, projectName: 'Alpha', branch: ROW.branch, checkout: null, actions: [], builtins: [] }],
  instances: [], stacks: [], stackStates: [],
};
const ACT_RUNNING = [{
  instanceId: `act:${ROW.id}:${KEY}:run`, runId: ROW.id, member: KEY, actionId: 'run', label: 'Run', kind: 'service',
  status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: Date.now(),
  histKey: KEY, workspaceId: null, runTitle: 'Log UX',
}];
function actionArms(running = []) {
  return (url) => {
    if (url.endsWith('/api/actions/running')) return ok(running);
    if (url.includes(`/api/runs/${ROW.id}/actions?`)) return ok(ACT_MODEL);
    if (url.includes('/api/actions/instances/')) return ok({ ok: true });
    return null;
  };
}

test('the Actions tab loads the run model with the run scope and offers Check out', async () => {
  const ctx = await bootDetail({ arms: actionArms() });
  await openDetail(ctx, 'details/actions');
  await settle(ctx.window, 4);
  const doc = ctx.window.document;
  assert.ok(doc.querySelector('#hist-detail .hd-tab[data-sec="actions"]').classList.contains('active'));
  const get = ctx.calls.find((c) => c.url.startsWith(`/api/runs/${ROW.id}/actions?`));
  assert.ok(get, 'GET /api/runs/:id/actions');
  assert.match(get.url, new RegExp(`projectKey=${KEY}`));
  const card = secOf(doc, 'actions').querySelector('.act-card');
  assert.ok(card, 'one card per member');
  assert.equal(card.dataset.state, 'not-checked-out');
  assert.ok([...card.querySelectorAll('button')].some((b) => b.textContent === 'Check out'));
});

test('the Overview Actions strip on a finished run follows actions-changed without opening the Actions tab', async () => {
  await checkRows([
    { name: 'the Overview carries the Actions strip on a finished run, with "Open tab ›"', run: async () => {
      const ctx = await bootDetail({ arms: actionArms() });
      await openDetail(ctx, 'details/overview');
      await settle(ctx.window, 4);
      const strip = secOf(ctx.window.document, 'overview').querySelector('.act-strip');
      assert.ok(strip, 'the strip is mounted');
      assert.equal(strip.dataset.runId, ROW.id);
      assert.equal(strip.dataset.minLevel, 'advanced');
      const open = [...strip.querySelectorAll('button')].find((b) => b.textContent === 'Open tab ›');
      assert.ok(open);
      click(ctx.window, open);
      assert.equal(ctx.window.location.hash, `#${detailHash}/details/actions`);
    } },
    { name: 'the Overview strip follows actions-changed without the Actions tab ever opening', run: async () => {
      const running = { ...ACT_MODEL, members: [{ ...ACT_MODEL.members[0], checkout: { setup: { status: 'ok' } } }], instances: [ACT_RUNNING[0]] };
      let model = running;
      const ctx = await bootDetail({ arms: (url) => (url.includes(`/api/runs/${ROW.id}/actions?`) ? ok(model) : actionArms()(url)) });
      await openDetail(ctx, 'details/overview');
      await settle(ctx.window, 4);
      const strip = () => secOf(ctx.window.document, 'overview').querySelector('.act-strip');
      assert.match(strip().textContent, /Running :4417/);
      model = { ...running, instances: [{ ...ACT_RUNNING[0], status: 'stopped' }] };   // stopped from the sidebar, or it crashed
      ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'actions-changed', action: 'stopped' }) });
      await settle(ctx.window, 4);
      assert.doesNotMatch(strip().textContent, /Running :4417/);
      assert.ok(![...strip().querySelectorAll('button')].some((b) => b.textContent === 'Stop'));
    } },
  ]);
});

test('a running service shows in the sidebar, the header pill and the tab dot; Stop goes by instance id', async () => {
  const ctx = await bootDetail({ arms: actionArms(ACT_RUNNING) });
  await openDetail(ctx, 'details/overview');
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'actions-changed', action: 'start' }) });
  await settle(ctx.window, 4);
  const doc = ctx.window.document;
  const side = doc.getElementById('side-actions');
  assert.equal(side.hidden, false);
  assert.match(side.textContent, /Run :4417/);
  assert.match(side.textContent, /Log UX/);
  assert.equal(doc.querySelector('#hist-detail .hd-row1 .act-pill').textContent, 'Run :4417');
  assert.ok(doc.querySelector('#hist-detail .hd-tab[data-sec="actions"] .tab-dot'), 'the Actions tab carries a dot');
  click(ctx.window, side.querySelector('.act-stop'));
  await settle(ctx.window);
  const stop = ctx.calls.find((c) => c.url.includes('/api/actions/instances/'));
  assert.equal(stop.url, `/api/actions/instances/${encodeURIComponent(ACT_RUNNING[0].instanceId)}/stop`);
  assert.equal(stop.opts.method, 'POST');
});

test('Terminal before Check out opens the confirm dialog with the branch and the setup command in bold', async () => {
  const model = { ...ACT_MODEL, members: [{ ...ACT_MODEL.members[0], setup: 'npm ci', builtins: [{ key: 'terminal', label: 'Terminal' }] }] };
  const ctx = await bootDetail({ arms: (url) => (url.includes(`/api/runs/${ROW.id}/actions?`) ? ok(model) : actionArms()(url)) });
  await openDetail(ctx, 'details/actions');
  await settle(ctx.window, 4);
  const doc = ctx.window.document;
  const term = [...secOf(doc, 'actions').querySelectorAll('.act-card button')].find((b) => b.textContent === 'Terminal');
  assert.equal(term.disabled, false);
  click(ctx.window, term);
  await settle(ctx.window, 2);
  const msg = doc.querySelector('#confirm-message');
  assert.equal(doc.querySelector('#confirm-title').textContent, 'Check out to open Terminal?');
  assert.deepEqual([...msg.querySelectorAll('strong')].map((s) => s.textContent), [ROW.branch, 'npm ci']);
  assert.match(msg.textContent, new RegExp(`Worca checks out ${ROW.branch.replace(/[/.]/g, '\\$&')} first`));
  click(ctx.window, doc.querySelector('#confirm-cancel'));
  await settle(ctx.window, 2);
  assert.ok(!ctx.calls.some((c) => c.url.includes('/checkout')), 'cancel posts nothing');
});

// #555: the saved run's Archive, like its Resume, reports its result in a toast.
test('Archive confirms with a toast; a refused archive raises an error toast with Retry', async () => {
  let deletes = 0;
  const ctx = await bootDetail({
    arms: (url, opts) => {
      if (!(url.startsWith(`/api/runs/${ROW.id}`) && opts.method === 'DELETE')) return null;
      return ++deletes === 1 ? fail(500, { error: 'branch is checked out' }) : ok({ ok: true });
    },
  });
  await openDetail(ctx);
  const doc = ctx.window.document;
  click(ctx.window, doc.querySelector('#hist-detail .hd-archive'));
  await settle(ctx.window);
  doc.querySelector('#confirm-ok').click();
  await settle(ctx.window, 6);
  assert.deepEqual(lastToast(doc), { tone: 'err', title: 'Could not archive the run',
    detail: 'branch is checked out', action: 'Retry' });
  assert.equal(doc.querySelector('#hist-detail .hd-error').hidden, true, 'no inline error behind the toast');
  clickToastAction(ctx.window);
  await settle(ctx.window);
  doc.querySelector('#confirm-ok').click();
  await settle(ctx.window, 6);
  assert.equal(deletes, 2);
  assert.equal(lastToast(doc).title, 'Run archived');
  assert.equal(lastToast(doc).tone, 'ok');
});

// Uses the file's own bootDetail / openTab / DETAIL. Fixture: one agent execution whose only rows are
// worca's Away mode reviews (an OLD "Night decider" row + a NEW stopped one), a second execution with an
// ordinary sub-agent that reported tokens but no cost, and the preflight bookend's two Auto workflow
// rounds + the run-title row.
const AW_MANIFEST = {
  version: 2, template: { id: 'wf', name: 'WF' },
  graph: { nodes: [{ id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementer', color: 'blue', x: 0, y: 0, ports: { inputs: [], outputs: [], await: true } }], wires: [] },
  // The bookend cells every v2 manifest carries (buildGraphManifest): the preflight group's label comes from here.
  steps: [{ kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] }, { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] }],
};
const AW_DETAIL = {
  ...DETAIL,
  state: {
    ...DETAIL.state,
    stepper: AW_MANIFEST,
    steps: [
      { key: 'x:preflight:1', executionId: 'x:preflight:1', nodeId: 'preflight', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
      { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, kind: 'cycle', cycle: 1, status: 'done', skills: [], graphifyCount: 0 },
      { key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, kind: 'cycle', cycle: 2, status: 'done', skills: [], graphifyCount: 0 },
    ],
    subAgents: [
      { id: 'auto-classify-1', label: 'Auto workflow (round 1)', subagentType: 'auto-classify', uiPhase: 'preflight', nodeId: 'preflight', stepKey: 'x:preflight:1', status: 'finished', costUsd: 0.03, tokens: 2100, skills: [] },
      { id: 'auto-classify-2', label: 'Auto workflow (round 2)', subagentType: 'auto-classify', uiPhase: 'preflight', nodeId: 'preflight', stepKey: 'x:preflight:1', status: 'finished', costUsd: 0.0098, tokens: 900, skills: [] },
      { id: 'run-title-0a0b0c0d', label: 'Run title', subagentType: 'run-title', uiPhase: 'preflight', nodeId: 'preflight', stepKey: 'x:preflight:1', status: 'finished', costUsd: 0.0021, tokens: 98, skills: [] },
      { id: 'night-decider-1', label: 'Night decider (questions)', subagentType: 'night-decider', nodeId: 'n_impl', stepKey: 'x:n_impl:1', status: 'finished', costUsd: 0.05, tokens: 4200, runModel: 'claude-opus-5-5', skills: [] },
      { id: 'night-decider-ab12cd34', label: 'Away mode review (questions)', subagentType: 'night-decider', nodeId: 'n_impl', stepKey: 'x:n_impl:1', status: 'stopped', costUsd: null, tokens: 18400, runModel: 'claude-opus-5-5', skills: [] },
      { id: 'sub-1', label: 'Explore repo', subagentType: 'Explore', nodeId: 'n_impl', stepKey: 'x:n_impl:2', status: 'finished', costUsd: null, tokens: 5000, skills: [] },
    ],
  },
};

test("worca's own AI calls: named in the Agents tab (stopped review tokens shown, never stopping the step) and not counted as sub-agents in the Overview", async () => {
  await checkRows([
    { name: "Agents tab: worca's own calls are named, a stopped review shows its tokens, and none of them stop the step", run: async () => {
      const ctx = await bootDetail({ detail: AW_DETAIL });
      const sec = await openTab(ctx, 'agents');
      assert.doesNotMatch(sec.textContent, /night[ -]decider/i, 'UI never says "night decider" (stored labels and types are mapped)');
      const groups = [...sec.querySelectorAll('.hd-ag-group')];
      const byHead = new Map(groups.map((g) => [g.querySelector('.hd-ag-head b').textContent, g]));
      // The preflight bookend's group keeps its spec'd caption (Auto spec §7.5/§7.7; the "Preflight" test above).
      assert.deepEqual([...byHead.keys()], ['Implementer #1', 'Implementer #2', 'Preflight #1']);
      const names = (g) => [...g.querySelectorAll('.hd-ag-row .hd-ag-name')].map((n) => n.textContent);
      const pills = (g) => [...g.querySelectorAll('.hd-ag-row .agent-type-pill')].map((n) => n.textContent);
      // An OLD row ("Night decider (questions)", COALESCE-frozen) reads the new label; the kind survives.
      assert.deepEqual(names(byHead.get('Implementer #1')), ['Away mode review (questions)', 'Away mode review (questions)']);
      assert.deepEqual(pills(byHead.get('Implementer #1')), ['Away mode', 'Away mode']);
      // The stopped review: no cost (it never reached its result frame) — '—', never a blank — its tokens, the honest state word.
      const stopped = byHead.get('Implementer #1').querySelectorAll('.hd-ag-row')[1];
      assert.equal(stopped.querySelector('.hd-ag-cost').textContent, '—');
      assert.equal(stopped.querySelector('.sub-tok-pill').textContent, '18.4k tok');
      assert.equal(stopped.querySelector('.st').textContent, 'stopped');
      // ...but a review the user's own answer cut short never rolls the agent's group up to "stopped".
      assert.ok(byHead.get('Implementer #1').querySelector('.hd-ag-head .subs-stat.done'), 'the step finished: the group reads done');
      // An ordinary sub-agent with tokens and no cost keeps today's row: blank cost, no token pill.
      assert.equal(byHead.get('Implementer #2').querySelector('.sub-tok-pill'), null);
      assert.equal(byHead.get('Implementer #2').querySelector('.hd-ag-cost').textContent, '');
      // The preflight bookend's rows: one group, each Auto round keeps its own label, the title row, the sum.
      const setup = byHead.get('Preflight #1');
      assert.deepEqual(names(setup), ['Auto workflow (round 1)', 'Auto workflow (round 2)', 'Run title']);
      assert.deepEqual(pills(setup), ['Auto workflow', 'Auto workflow', 'Run title']);
      assert.match(setup.querySelector('.hd-ag-meta').textContent, /\$0\.0419/);
    } },
    { name: "Overview: worca's own AI calls are not counted as the run's sub-agents", run: async () => {
      const ctx = await bootDetail({ detail: AW_DETAIL });
      const sec = await openTab(ctx, 'overview');
      // AW_DETAIL: two Auto workflow rounds, the run title and two Away mode reviews are worca's; one Explore row is the agent's.
      assert.deepEqual([...sec.querySelectorAll('.hd-ov-tag')].map((c) => c.textContent).filter((t) => /sub-agent/.test(t)), ['1 sub-agent']);
    } },
  ]);
});
