// ui/public/freeze.mjs — the frozen state gallery (a dev inspection tool).
//
// Open  /?freeze#running  and the UI renders one pipeline per reachable card
// state — every Running-card state (executing, needs-input, the three pause
// flavours, done/stopped/error lingerers, provisional title, parallel cell)
// and every History-row state (done, interrupted, error, paused × 2, looped,
// PR open/merged, plugin-sourced, legacy minimal) — and then goes SILENT, so
// nothing advances and every state can be inspected at leisure, including the
// navigation between Running, History and #pipeline/<id> detail pages.
//
// Mechanism: the module runs BEFORE app.js (script order in index.html) and,
// only when ?freeze is present, replaces WebSocket with a stub that plays a
// scripted set of frames once, and wraps fetch to serve fixture /api/history
// data. Every other endpoint passes through to the real server. Without the
// flag this module is a no-op, byte-for-byte inert for normal use.
//
// Frozen-in-time is a property of the DATA, not a patched clock: every step
// carries runningSince:null and a fixed activeMs, so the duration tickers
// recompute the same numbers forever.

if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('freeze')) installFreeze();

export {};

function installFreeze() {
  // Acknowledging a lingering fixture card persists its runId; on the next load
  // that state would be gone from the gallery. Reset the two persisted id-sets
  // so EVERY reload starts from the full set of frozen states.
  try {
    localStorage.removeItem('worca-cc.ackRuns');
    localStorage.removeItem('worca-cc.lingerRuns');
  } catch { /* storage may be unavailable; the gallery still works once */ }

  // ── shared fixture vocabulary ─────────────────────────────────────────────
  const P = {
    key: 'calculator-5918f720',
    name: 'calculator',
    dir: '/Volumes/Apps/dev/tests-worca-cc-1.0/calculator',
  };
  const T0 = '2026-08-17T09:15:00.000Z'; // every fixture starts here

  // The default 7-cell manifest, snapshotted from a real pipeline.
  const STEPPER = {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
      { kind: 'agents', nodes: [{ id: 's_clarify', key: 'clarify', uiPhase: 'clarify', label: 'Clarify', color: 'red', sub: 'Turns hidden decisions into questions before planning. Multiple-choice, so later steps never guess.', cycles: false, model: 'claude-haiku-4-5', effort: '' }] },
      { kind: 'agents', nodes: [{ id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan', color: 'violet', sub: 'Explores the codebase and writes the implementation plan. Architecture, task breakdown, concrete code snippets; can ask clarifying questions first.', cycles: false, model: 'claude-haiku-4-5', effort: '' }] },
      { kind: 'agents', nodes: [{ id: 's1_0', key: 'refiner', uiPhase: 'refine', label: 'Refine Plan', color: 'green', sub: 'Rewrites the latest plan into a tighter version. Fixes structure, correctness, and code snippets until no blocking issues remain.', cycles: true, model: 'claude-haiku-4-5', effort: '' }] },
      { kind: 'agents', nodes: [{ id: 's2_0', key: 'implementer', uiPhase: 'implement', label: 'Implementation', color: 'peach', sub: 'Writes the code from the approved plan, strict TDD. In fix mode, addresses only the issues a review flagged.', cycles: true, model: 'claude-haiku-4-5', effort: '' }] },
      { kind: 'agents', nodes: [{ id: 's3_0', key: 'reviewer', uiPhase: 'review', label: 'Review Implementation', color: 'blue', sub: 'Reviews the implementation diff against the plan. Honest verdict; blocking findings loop back to the implementer.', cycles: false, model: 'claude-haiku-4-5', effort: '' }] },
      { kind: 'done', nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] },
    ],
    feedbacks: [
      { id: 'fb_refine', from: 's1_0', to: 's1_0', maxCycles: 3 },
      { id: 'fb_review', from: 's3_0', to: 's2_0', maxCycles: 3 },
    ],
  };

  // A variant whose implement cell runs two agents in parallel.
  const STEPPER_PAR = JSON.parse(JSON.stringify(STEPPER));
  STEPPER_PAR.steps[4] = {
    kind: 'agents',
    label: 'Build',
    nodes: [
      { ...STEPPER.steps[4].nodes[0], id: 's2_0', label: 'Implement API' },
      { ...STEPPER.steps[4].nodes[0], id: 's2_1', label: 'Implement UI' },
    ],
  };

  // One steps[] entry (the persisted shape). runningSince stays null → frozen.
  const step = (nodeId, phase, cycle, status, stepIndex, activeMs, costUsd) => ({
    key: `${stepIndex}:${nodeId}`, phase, cycle, status,
    startedAt: T0, updatedAt: T0, activeMs, runningSince: null, costUsd,
    skills: [], nodeId, stepIndex,
  });
  const preflightStep = { key: 'preflight', phase: 'preflight', cycle: 0, status: 'done', startedAt: T0, updatedAt: T0, activeMs: 900, runningSince: null, costUsd: 0, skills: [] };

  // steps[] for a run whose frontier is `upto` (cell index into STEPPER), with
  // per-node costs. Cells before the frontier are done; the frontier runs.
  const NODE_SEQ = [
    ['s_clarify', 'clarify'], ['s0_0', 'plan'], ['s1_0', 'refine'],
    ['s2_0', 'implement'], ['s3_0', 'review'],
  ];
  function stepsUpTo(frontierIdx, { frontierStatus = 'start', cycle = 1 } = {}) {
    const out = [preflightStep];
    NODE_SEQ.forEach(([nodeId, phase], i) => {
      if (i < frontierIdx) out.push(step(nodeId, phase, 1, 'done', i, 20000 + i * 13000, 0.04 * (i + 1)));
      if (i === frontierIdx) out.push(step(nodeId, phase, cycle, frontierStatus, i, 47000, 0.11));
    });
    return out;
  }

  const sub = (id, nodeId, cycle, label, status) => ({
    id, label, nodeId, stepIndex: 3, cycle, stepKey: `${cycle}:${nodeId}`,
    status, startedAt: T0, finishedAt: status === 'running' ? undefined : T0,
    durationMs: status === 'running' ? null : 8200, tokens: 1200, costUsd: 0.02,
    uiPhase: 'implement', skills: ['skill:brainstorming'], subagentType: 'general-purpose',
  });

  const q = (id, question, options) => ({ id, question, options, allowFreeText: true });

  // ── the Running gallery: one run per live-card state ──────────────────────
  // Each entry: hello summary + follow-up frames, then silence. Terminal states
  // are reached VIA a frame (not declared in hello) so the cards linger in the
  // Running list the way a watched finish does, instead of being auto-acked.
  const phase = (runId, name, cycle, status, extra = {}) => ({ type: 'phase', runId, phase: name, cycle, status, ...extra });
  // list: [phaseName, status, cycle][] — mirrors the server's own phase frames
  // ("implement #2 (start)"), so loop-backs resolve the active node correctly.
  const phases = (runId, list) => list.map(([name, status, cycle, extra]) => phase(runId, name, cycle, status, extra));
  const stateFrame = (runId, pipelineId, over = {}) => ({
    type: 'state', runId, id: pipelineId, status: 'running', stepper: STEPPER,
    branch: { feature: `worca-cc/frozen-${pipelineId}` }, ...over,
  });

  const RUNS = [];   // hello entries
  const FRAMES = []; // post-hello frames, in order
  const run = (n, title, { stepper = STEPPER, status = 'running' } = {}) => {
    const runId = `fz-run-${n}`;
    const pipelineId = `f2ee000${n.toString(16)}`;
    RUNS.push({ runId, title, projectDir: P.dir, status, startedAt: T0, kind: 'run', stepper, pipelineId });
    return { runId, pipelineId };
  };

  const DONE_TO_REVIEW = [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'done', 1], ['implement', 'done', 1], ['review', 'done', 1]];
  {
    const { runId, pipelineId } = run(1, 'R1 · Executing — implement, cycle 2, sub-agents');
    FRAMES.push(...phases(runId, [...DONE_TO_REVIEW, ['implement', 'start', 2]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(3, { cycle: 2 }), totalCostUsd: 1.27 }),
      { type: 'subagent', runId, transition: 'spawn', ...sub('fz-s1', 's2_0', 2, 'wire the endpoint', 'running') },
      { type: 'subagent', runId, transition: 'spawn', ...sub('fz-s2', 's2_0', 2, 'write the tests', 'running') },
      { type: 'subagent', runId, transition: 'spawn', ...sub('fz-s3', 's2_0', 2, 'survey call sites', 'finished') });
  }
  {
    const { runId, pipelineId } = run(2, 'R2 · Needs input — clarify questions');
    FRAMES.push(...phases(runId, [['clarify', 'start', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(0), totalCostUsd: 0.02 }),
      { type: 'question', runId, kind: 'clarify', questions: [
        q('q1', 'How should the feature handle invalid input?', ['Fail fast with a clear error', 'Coerce to a safe default', 'Ignore and continue']),
        q('q2', 'Hard delete or soft delete?', ['Hard delete', 'Soft delete']),
      ] });
  }
  {
    const { runId, pipelineId } = run(3, 'R3 · Needs input — review question, cycle 2');
    FRAMES.push(...phases(runId, [...DONE_TO_REVIEW, ['implement', 'done', 2], ['review', 'start', 2]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(4, { cycle: 2 }), totalCostUsd: 2.4 }),
      { type: 'question', runId, kind: 'review', questions: [
        q('q1', 'The fix changes a public API — accept the break?', ['Yes, accept', 'No, add a shim']),
      ] });
  }
  {
    const { runId, pipelineId } = run(4, 'R4 · Paused — by the user');
    FRAMES.push(...phases(runId, [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'done', 1], ['implement', 'start', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(3), totalCostUsd: 0.9 }),
      { type: 'done', runId, status: 'paused' },
      phase(runId, 'implement', 1, 'paused'));  // after the pause lands: nodeKindFor reads r.status
  }
  {
    const { runId, pipelineId } = run(5, 'R5 · Paused — pipeline cost limit');
    FRAMES.push(...phases(runId, [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'done', 1], ['implement', 'start', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(3), totalCostUsd: 5.02 }),
      { type: 'done', runId, status: 'paused', reason: 'cost_pipeline' },
      phase(runId, 'implement', 1, 'paused'));  // after the pause lands: nodeKindFor reads r.status
  }
  {
    const { runId, pipelineId } = run(6, 'R6 · Paused — total budget');
    FRAMES.push(...phases(runId, [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'done', 1], ['implement', 'start', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(3), totalCostUsd: 12.55 }),
      { type: 'done', runId, status: 'paused', reason: 'cost_total' },
      phase(runId, 'implement', 1, 'paused'));  // after the pause lands: nodeKindFor reads r.status
  }
  {
    const { runId, pipelineId } = run(7, 'R7 · Finished while watched — lingers');
    FRAMES.push(...phases(runId, [...DONE_TO_REVIEW, ['done', 'done', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(5), totalCostUsd: 1.86 }),
      { type: 'done', runId, status: 'done' });
  }
  {
    const { runId, pipelineId } = run(8, 'R8 · Stopped by the user');
    FRAMES.push(...phases(runId, [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'start', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(2), totalCostUsd: 0.31 }),
      { type: 'done', runId, status: 'stopped' });
  }
  {
    const { runId, pipelineId } = run(9, 'R9 · Errored');
    FRAMES.push(...phases(runId, [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'done', 1], ['implement', 'start', 1]]),
      stateFrame(runId, pipelineId, { steps: stepsUpTo(3), totalCostUsd: 0.77 }),
      { type: 'error', runId });
  }
  {
    const { runId } = run(10, 'R10 · Just started — provisional title', { status: 'starting' });
    FRAMES.push({ type: 'title', runId, title: 'R10 · Just started — provisional title', provisional: true });
  }
  {
    const { runId, pipelineId } = run(11, 'R11 · Parallel implementers', { stepper: STEPPER_PAR });
    FRAMES.push(...phases(runId, [['clarify', 'done', 1], ['plan', 'done', 1], ['refine', 'done', 1],
      ['implement', 'start', 1, { nodeId: 's2_0' }], ['implement', 'start', 1, { nodeId: 's2_1' }]]),
      { ...stateFrame(runId, pipelineId, { steps: stepsUpTo(3), totalCostUsd: 0.6 }), stepper: STEPPER_PAR },
      { type: 'subagent', runId, transition: 'spawn', ...sub('fz-p1', 's2_1', 1, 'markup pass', 'running') });
  }

  // ── the History gallery: one row per row state ────────────────────────────
  const row = (n, title, over = {}) => ({
    id: `f2aa00${String(n).padStart(2, '0')}`,
    dir: `/frozen/pipelines/${n}`,
    title, status: 'done', phase: 'done', cycle: 0, startedAt: T0,
    branch: `worca-cc/frozen-h${n}`, sourceBranch: 'master', guardrailsId: 'permissive',
    pauseReason: null, survived: true, added: 42, removed: 7,
    totalCostUsd: 1.87, totalActiveMs: 12 * 60000 + 23000, mtime: Date.parse(T0),
    stepper: STEPPER,
    projectKey: P.key, projectName: P.name, projectDir: P.dir,
    ...over,
  });

  const ROWS = [
    row(1, 'H1 · Done — full record'),
    row(2, 'H2 · Interrupted at implement', { status: 'interrupted', phase: 'implement', cycle: 1, added: 10, removed: 2, totalCostUsd: 0.61, totalActiveMs: 4 * 60000 }),
    row(3, 'H3 · Errored at plan', { status: 'error', phase: 'plan', cycle: 1, added: 0, removed: 0, totalCostUsd: 0.12, totalActiveMs: 90000 }),
    row(4, 'H4 · Paused — cost limit (resumable)', { status: 'paused', phase: 'implement', cycle: 1, pauseReason: 'cost_pipeline', totalCostUsd: 5.0, totalActiveMs: 6 * 60000 }),
    row(5, 'H5 · Paused — total budget', { status: 'paused', phase: 'refine', cycle: 1, pauseReason: 'cost_total', totalCostUsd: 12.55, totalActiveMs: 9 * 60000 }),
    row(6, 'H6 · Done — looped 3 cycles', { cycle: 3 }),
    row(7, 'H7 · Done — PR open', { pr: { state: 'OPEN', url: 'https://github.com/example/repo/pull/42', number: 42 } }),
    row(8, 'H8 · Done — PR merged', { pr: { state: 'MERGED', url: 'https://github.com/example/repo/pull/41', number: 41 } }),
    row(9, 'H9 · Plugin-sourced task', { source_type: 'plugin', source_ref: JSON.stringify({ plugin: 'github-tasks', taskId: 'T-123', url: 'https://example.com/task/123' }) }),
    row(10, 'H10 · Legacy minimal row', { branch: null, stepper: null, added: 0, removed: 0, survived: false, totalCostUsd: 0, totalActiveMs: 0 }),
    // The two terminal LIVE cards also exist here, under the SAME durable id, so
    // Running↔History identity (one #pipeline url, owner flips) can be inspected.
    row(11, 'R7 · Finished while watched — lingers', { id: 'f2ee0007', totalCostUsd: 1.86 }),
    row(12, 'R8 · Stopped by the user', { id: 'f2ee0008', status: 'stopped', phase: 'refine', cycle: 1, totalCostUsd: 0.31 }),
  ];

  // Detail payload for an expanded/opened History row.
  function detailFor(id) {
    const p = ROWS.find((x) => x.id === id);
    if (!p) return null;
    const frontier = { plan: 1, refine: 2, implement: 3, review: 4 }[p.phase];
    const steps = p.stepper
      ? (p.status === 'done' ? stepsUpTo(5) : stepsUpTo(frontier ?? 1, { frontierStatus: p.status === 'error' ? 'error' : 'stopped', cycle: p.cycle || 1 }))
      : [];
    const done = p.status === 'done';
    return {
      state: {
        id: p.id, title: p.title, projectKey: p.projectKey, status: p.status, phase: p.phase,
        cycle: p.cycle, startedAt: p.startedAt, updatedAt: p.startedAt,
        totalCostUsd: p.totalCostUsd, totalActiveMs: p.totalActiveMs,
        prompt: 'Frozen gallery fixture', branch: p.branch, stepper: p.stepper,
        guardrailsId: p.guardrailsId, steps,
        subAgents: done ? [sub('fz-h1', 's2_0', 1, 'wire the endpoint', 'finished'), sub('fz-h2', 's2_0', 1, 'write the tests', 'finished')] : [],
        projectDir: p.projectDir,
      },
      auditMarkdown: `# ${p.title}\n\nFrozen gallery fixture — not a real run.`,
      artifacts: [{ kind: 'live-log', relPath: 'live-log.ndjson' }],
      results: done ? {
        summary: { filesNew: 1, filesChanged: 3, filesDeleted: 1, linesAdded: 120, linesRemoved: 34, blockingIssues: 1, nitpicks: 2 },
        newFiles: [{ status: 'A', path: 'src/frozen/new-module.mjs', added: 84, removed: 0 }],
        changedFiles: [
          { status: 'M', path: 'src/core/example.mjs', added: 30, removed: 20 },
          { status: 'M', path: 'test/example.test.mjs', added: 6, removed: 2 },
          { status: 'D', path: 'src/old/retired.mjs', added: 0, removed: 12 },
        ],
        keyThingsToCheck: [{ severity: 'major', title: 'Unbounded retry loop', detail: 'The new client retries forever on 429.', location: 'src/frozen/new-module.mjs:41' }],
        nitpicks: [{ severity: 'minor', title: 'Comment drift', detail: 'Docstring still names the old flag.', location: 'src/core/example.mjs:12' }],
      } : { summary: null },
      overview: null,
      clarify: {
        questions: [q('q1', 'How should the feature handle invalid input?', ['Fail fast', 'Coerce'])],
        answers: [{ id: 'q1', question: 'How should the feature handle invalid input?', choice: 'Fail fast' }],
      },
      reviews: [],
      stepQuestions: [],
    };
  }

  const LOG_NDJSON = [
    { ts: T0, source: 'phase', level: 'phase', text: 'preflight (done)' },
    { ts: T0, source: 'planner', level: 'info', text: 'exploring the codebase', nodeId: 's0_0', stepIndex: 1, cycle: 1 },
    { ts: T0, source: 'planner', level: 'warn', text: 'retrying after 429', nodeId: 's0_0', stepIndex: 1, cycle: 1, stream: 'err' },
    { ts: T0, source: 'implementer', level: 'info', text: 'wrote src/frozen/new-module.mjs', nodeId: 's2_0', stepIndex: 3, cycle: 1 },
    { ts: T0, source: 'reviewer', level: 'info', text: 'verdict: 1 major, 2 nitpicks', nodeId: 's3_0', stepIndex: 4, cycle: 1 },
  ].map((l) => JSON.stringify(l)).join('\n');

  // ── WebSocket stub: play the script once, then silence ────────────────────
  class FrozenSocket {
    constructor() {
      this.readyState = 1;
      this._listeners = {};
      setTimeout(() => {
        this._emit('open', {});
        this._emit('message', { data: JSON.stringify({ type: 'hello', runs: RUNS }) });
        for (const f of FRAMES) this._emit('message', { data: JSON.stringify(f) });
      }, 0);
    }
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    removeEventListener() {}
    send() {}
    close() {}
    _emit(t, ev) { for (const fn of this._listeners[t] || []) fn(ev); }
  }
  window.WebSocket = FrozenSocket;

  // ── fetch wrap: fixture history endpoints, real everything else ───────────
  const realFetch = window.fetch.bind(window);
  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (input, opts) => {
    const url = String(input && input.url ? input.url : input);
    const path = url.replace(location.origin, '');
    if (/^\/api\/history(\?|$)/.test(path)) return json({ pipelines: ROWS, ghAvailable: true });
    let m = /^\/api\/history\/[^/]+\/([^/?]+)\/log$/.exec(path);
    if (m && detailFor(m[1])) return Promise.resolve(new Response(LOG_NDJSON, { status: 200 }));
    m = /^\/api\/history\/[^/]+\/([^/?]+)$/.exec(path) || /^\/api\/runs\/([^/?]+)\?/.exec(path);
    if (m && detailFor(m[1])) return json(detailFor(m[1]));
    if (path === '/api/pr/mergeable' && String(opts && opts.body || '').includes('frozen-h7')) return json({ mergeable: 'MERGEABLE' });
    // Absorb control POSTs aimed at fixture runs — frozen means frozen.
    if (/^\/api\/(answer|stop|pause|resume)$/.test(path) && String(opts && opts.body || '').includes('fz-run-')) return json({ ok: true });
    return realFetch(input, opts);
  };

  console.info('[freeze] state gallery active — %d live runs, %d history rows', RUNS.length, ROWS.length);
}
