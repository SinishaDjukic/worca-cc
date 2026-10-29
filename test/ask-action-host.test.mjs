// test/ask-action-host.test.mjs — worca Chat P2 Task 4: the parent applies what the child validated with the same
// in-process functions the routes use, re-checking the run first (Review Focus 2), and reverts only an unchanged value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatActionHost } from '../src/core/ask/action-deps.mjs';
import { receiptCard } from '../src/core/ask/receipt.mjs';
import { checkRows } from './helpers/rows.mjs';

function setup(over = {}) {
  const calls = [];
  const runs = new Map();
  const rows = new Map();
  const resumeOpts = [];
  const away = { toggle: 'auto' };
  const night = (status, override = 'auto') => ({ state: { status, night: { override } } });
  const liveRun = (id) => runs.get(id) || [...runs.values()].find((e) => e.pipelineId === id) || null;
  const deps = {
    settings: {
      apply: async (r) => { calls.push(['settings.apply', r]); return r.value === 'bad' ? { ok: false, error: 'theme must be system, light or dark' }
        : { ok: true, card: receiptCard({ kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' } }) }; },
      revert: async (card) => { calls.push(['settings.revert', card.target.settingId]); return { ok: true, notice: 'Reverted: Theme back to System (default)' }; },
    },
    liveRun,
    findRow: (id) => rows.get(id) || null,
    pauseRun: async (runId, by) => { calls.push(['pauseRun', runId, by]); runs.get(runId).status = 'pausing'; },
    resumeRun: async (pipelineId, o) => { calls.push(['resumeRun', pipelineId, o.by]); resumeOpts.push(o); return { ok: true, runId: 'uuid-new', pipelineId }; },
    stopRun: async (runId, by) => { calls.push(['stopRun', runId, by]); return { ok: true }; },
    stopPausedPipeline: async (pipelineId, by) => { calls.push(['stopPausedPipeline', pipelineId, by]); return { ok: true }; },
    postDirection: async (pipelineId, text, source) => { calls.push(['postDirection', pipelineId, text, source]); return { id: 'd1' }; },
    scheduleVerb: async (verb, id, body, o) => { calls.push(['scheduleVerb', verb, id, o.by]); return { status: 200, body: {} }; },
    getSchedule: (id) => (id === 'sch_00000001' ? { id, status: 'paused' } : null),
    awaySwitchFor: (person) => async (req, o) => {
      calls.push(['away', person, req, o.actor]);
      if (req.kind === 'global') { away.toggle = req.toggle; return { ok: true, line: 'Right now you count as away.' }; }
      liveRun(req.runId).orch.state.night.override = req.mode;
      return { ok: true, line: 'on run Fix login: never' };
    },
    awayStatusFor: () => away.toggle,
    prState: (id) => (id === 'cccc0002' ? { url: 'https://x/pull/3' } : null),
    prCardFacts: async (row) => ({ pipelineId: row.id, projectKey: row.project_key, title: row.title, branch: 'worca/feat', base: 'main', filesChanged: 3, additions: 10, deletions: 2 }),
    ...over,
  };
  const live = (id, pipelineId, status, extra = {}) => { const e = { id, pipelineId, status, title: 'Fix login', orch: night(status), ...extra }; runs.set(id, e); return e; };
  const row = (id, status, extra = {}) => { const r = { id, status, title: 'Fix login', project_key: 'shop-1a2b3c4d', target: 'project', branch: JSON.stringify({ feature: 'worca/fix-login', source: 'main' }), ...extra }; rows.set(id, r); return r; };
  return { h: createChatActionHost(deps), calls, runs, rows, away, live, row, resumeOpts };
}
const A = { actor: 'worca chat' };

test('apply: settings go through the registry; a refusal is a notice', async () => {
  const { h, calls } = setup();
  const ok = await h.apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'dark' }, A);
  assert.equal(ok.ok, true); assert.equal(ok.block.state, 'applied'); assert.equal(ok.block.card.type, 'receipt');
  assert.deepEqual(calls[0], ['settings.apply', { id: 'theme', scope: 'user', projectKey: null, value: 'dark' }]);
  assert.deepEqual(await h.apply({ kind: 'setting', id: 'theme', scope: 'user', value: 'bad' }, A), { ok: false, notice: 'Could not change theme: theme must be system, light or dark' });
});

test('apply: pause / resume call the run functions as the chat actor and post revertible receipts', async () => {
  await checkRows([
    { name: 'pause a running run', run: async () => {
      const { h, calls, live, row } = setup();
      live('uuid-1', 'aaaa0001', 'running'); row('aaaa0001', 'running');
      const r = await h.apply({ kind: 'pause', runId: 'aaaa0001' }, A);
      assert.deepEqual(calls, [['pauseRun', 'uuid-1', 'worca chat']]);
      assert.deepEqual(r.block.card, { type: 'receipt', kind: 'pause', label: 'Run', target: { runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login' },
        before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' }, revertible: true });
    } },
    { name: 'a stale request (the run is paused by now) is refused, nothing called (Review Focus 2)', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-1', 'aaaa0001', 'paused');
      assert.deepEqual(await h.apply({ kind: 'pause', runId: 'uuid-1' }, A), { ok: false, notice: 'Could not pause Fix login: it is paused' });
      assert.deepEqual(calls, []);
    } },
    { name: 'resume a paused run', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0002', 'paused');
      const r = await h.apply({ kind: 'resume', runId: 'aaaa0002' }, A);
      assert.deepEqual(calls, [['resumeRun', 'aaaa0002', 'worca chat']]);
      assert.equal(r.block.card.kind, 'resume'); assert.equal(r.block.card.target.runId, 'uuid-new');
      assert.deepEqual(r.block.card.raw, { before: 'paused', after: 'running' });
    } },
    { name: 'a resume that needs the user names the run card (R8)', run: async () => {
      const { h, row } = setup({ resumeRun: async () => { throw Object.assign(new Error('pipeline cost limit reached'), { body: { error: 'pipeline cost limit reached', needsOverride: true } }); } });
      row('aaaa0002', 'paused');
      assert.deepEqual(await h.apply({ kind: 'resume', runId: 'aaaa0002' }, A), { ok: false, notice: 'Could not resume Fix login: pipeline cost limit reached — press Resume on the run card to confirm.' });
    } },
    { name: 'an unknown run', run: async () => {
      const { h } = setup();
      assert.deepEqual(await h.apply({ kind: 'pause', runId: 'ffff0000' }, A), { ok: false, notice: 'Could not find run ffff0000' });
    } },
  ]);
});

test('apply: stop and pull request only PROPOSE a card; a direction is sent and receipted, not revertible', async () => {
  await checkRows([
    { name: 'stop: a run-stop card with the run\'s branch', run: async () => {
      const { h, calls, live, row } = setup();
      live('uuid-1', 'aaaa0001', 'running'); row('aaaa0001', 'running');
      const r = await h.apply({ kind: 'stop', runId: 'aaaa0001' }, A);
      assert.deepEqual(r.block, { state: 'proposed', card: { type: 'run-stop', runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login', branch: 'worca/fix-login', status: 'running' } });
      assert.deepEqual(calls, [], 'nothing stops until the user clicks');
    } },
    { name: 'stop: an interrupted or finished run gets a notice', run: async () => {
      const { h, row } = setup();
      row('aaaa0003', 'interrupted'); row('aaaa0005', 'done');
      assert.deepEqual(await h.apply({ kind: 'stop', runId: 'aaaa0003' }, A), { ok: false, notice: "Fix login is interrupted: it stays resumable and can't be stopped" });
      assert.deepEqual(await h.apply({ kind: 'stop', runId: 'aaaa0005' }, A), { ok: false, notice: 'Fix login is already done' });
    } },
    { name: 'stop: an archived paused run gets a notice, never a Stop card (impl review m3)', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0009', 'paused', { archived_at: '2026-10-01T00:00:00Z' });
      assert.deepEqual(await h.apply({ kind: 'stop', runId: 'aaaa0009' }, A), { ok: false, notice: 'Fix login is archived — restore it from History first' });
      assert.deepEqual(calls, []);
    } },
    { name: 'direction to a saved run (paused, not in this server\'s runs): its inbox', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0001', 'paused');
      const r = await h.apply({ kind: 'direction', runId: 'aaaa0001', text: 'skip the docs' }, A);
      assert.deepEqual(calls, [['postDirection', 'aaaa0001', 'skip the docs', 'chat']]);
      assert.equal(r.block.card.kind, 'direction'); assert.equal(r.block.card.after, 'skip the docs'); assert.equal(r.block.card.revertible, false);
    } },
    { name: 'direction to a live run still starting (no saved row yet): straight to its orchestrator (review P2-5)', run: async () => {
      const { h, calls, live } = setup();
      const seen = [];
      live('uuid-9', null, 'starting', { orch: { state: { status: 'starting', night: { override: 'auto' } }, direct: async (text, source) => { seen.push([text, source]); return { id: 'd1' }; } } });
      const r = await h.apply({ kind: 'direction', runId: 'uuid-9', text: 'skip the docs' }, A);
      assert.deepEqual(seen, [['skip the docs', 'chat']]);
      assert.deepEqual(calls, [], 'postDirection is not needed');
      assert.equal(r.block.card.kind, 'direction');
    } },
    { name: 'direction: a finished run, or nothing recorded', run: async () => {
      const { h, row } = setup({ postDirection: async () => null });
      row('aaaa0005', 'done');
      assert.deepEqual(await h.apply({ kind: 'direction', runId: 'aaaa0005', text: 'x' }, A), { ok: false, notice: 'Fix login is already done: a direction would never be read' });
      row('aaaa0002', 'paused');
      assert.deepEqual(await h.apply({ kind: 'direction', runId: 'aaaa0002', text: 'x' }, A), { ok: false, notice: 'Could not send the direction to Fix login: it has no saved record yet — try again in a moment' });
    } },
    { name: 'pull request: a proposed card from the run\'s facts; an existing PR is a notice', run: async () => {
      const { h, row } = setup();
      row('cccc0001', 'done'); row('cccc0002', 'done'); row('cccc0003', 'running');
      assert.deepEqual((await h.apply({ kind: 'pull-request', runId: 'cccc0001' }, A)).block, { state: 'proposed', card: { type: 'pull-request', pipelineId: 'cccc0001', projectKey: 'shop-1a2b3c4d', title: 'Fix login', branch: 'worca/feat', base: 'main', filesChanged: 3, additions: 10, deletions: 2 } });
      assert.deepEqual(await h.apply({ kind: 'pull-request', runId: 'cccc0002' }, A), { ok: false, notice: 'Fix login already has a pull request: https://x/pull/3' });
      assert.deepEqual(await h.apply({ kind: 'pull-request', runId: 'cccc0003' }, A), { ok: false, notice: 'Fix login is running: a pull request is for a finished run' });
    } },
    { name: 'schedule receipts come from what the child already did', run: async () => {
      const { h, calls } = setup();
      const r = await h.apply({ kind: 'schedule-pause', schedule: { id: 'sch_00000001', title: 'Nightly', status: 'paused' } }, A);
      assert.deepEqual(r.block.card, { type: 'receipt', kind: 'schedule-pause', label: 'Schedule', target: { scheduleId: 'sch_00000001', title: 'Nightly' },
        before: 'Active', after: 'Paused', raw: { before: 'active', after: 'paused' }, revertible: true });
      assert.deepEqual(calls, []);
    } },
  ]);
});

test('awaySwitch: the switch\'s own result plus a receipt when the status changed', async () => {
  const { h, live } = setup();
  const g = await h.awaySwitch({ kind: 'global', toggle: 'on' }, { actor: 'ada', person: 'ada' });
  assert.equal(g.line, 'Right now you count as away.');
  assert.deepEqual(g.receipt, { type: 'receipt', kind: 'away-now', label: 'Away mode', target: {}, before: 'Following away hours', after: "I'm away now",
    raw: { before: 'auto', after: 'on', person: 'ada' }, revertible: true });
  assert.equal((await h.awaySwitch({ kind: 'global', toggle: 'on' }, { actor: 'ada', person: 'ada' })).receipt, undefined, 'no change, no receipt');
  live('uuid-1', 'aaaa0001', 'running');
  const r = await h.awaySwitch({ kind: 'run', runId: 'uuid-1', mode: 'off' }, { actor: 'ada' });
  assert.deepEqual(r.receipt.raw, { before: 'auto', after: 'off' });
  assert.equal(r.receipt.before, 'As set up'); assert.equal(r.receipt.after, 'Never on this run');
});

test('revert: each kind re-reads first; CHANGED_SINCE writes nothing; a direction is never revertible', async () => {
  await checkRows([
    { name: 'pause → resume', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0001', 'paused');
      const card = receiptCard({ kind: 'pause', label: 'Run', target: { runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: true, notice: 'Reverted: Run (Fix login) back to Running' });
      assert.deepEqual(calls, [['resumeRun', 'aaaa0001', 'ada']]);
    } },
    { name: 'pause revert while still pausing is a retry, while running again is CHANGED_SINCE', run: async () => {
      const { h, calls, live } = setup();
      const e = live('uuid-1', 'aaaa0001', 'pausing');
      const card = receiptCard({ kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0001', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' } });
      assert.equal((await h.revert(card, { actor: 'ada' })).code, 'REVERT_FAILED');
      e.status = 'running';
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'resume → pause', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-new', 'aaaa0002', 'running');
      const card = receiptCard({ kind: 'resume', label: 'Run', target: { runId: 'uuid-new', pipelineId: 'aaaa0002', title: 'Fix login' }, before: 'Paused', after: 'Running', raw: { before: 'paused', after: 'running' } });
      assert.equal((await h.revert(card, { actor: 'ada' })).ok, true);
      assert.deepEqual(calls, [['pauseRun', 'uuid-new', 'ada']]);
    } },
    { name: 'schedule pause → resume through scheduleVerb', run: async () => {
      const { h, calls } = setup();
      const card = receiptCard({ kind: 'schedule-pause', label: 'Schedule', target: { scheduleId: 'sch_00000001', title: 'Nightly' }, before: 'Active', after: 'Paused', raw: { before: 'active', after: 'paused' } });
      assert.equal((await h.revert(card, { actor: 'ada' })).ok, true);
      assert.deepEqual(calls, [['scheduleVerb', 'resume', 'sch_00000001', 'ada']]);
    } },
    { name: 'away now: the person\'s own switch, back to what it was', run: async () => {
      const { h, calls, away } = setup();
      away.toggle = 'on';
      const card = receiptCard({ kind: 'away-now', label: 'Away mode', before: 'Following away hours', after: "I'm away now", raw: { before: 'auto', after: 'on', person: 'ada' } });
      assert.equal((await h.revert(card, { actor: 'bob' })).ok, true);
      assert.deepEqual(calls, [['away', 'ada', { kind: 'global', toggle: 'auto' }, 'bob']]);
      away.toggle = 'off';
      assert.equal((await h.revert(card, { actor: 'bob' })).code, 'CHANGED_SINCE');
    } },
    { name: 'per-run Away on a run that finished since → CHANGED_SINCE, nothing written (review P2-2)', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-1', 'aaaa0001', 'done', { orch: { state: { status: 'done', night: { override: 'off' } } } });
      const card = receiptCard({ kind: 'run-away', label: 'Away mode on this run', target: { runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login' },
        before: 'As set up', after: 'Never on this run', raw: { before: 'auto', after: 'off' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'settings delegate to the registry; a direction is NOT_REVERTIBLE', run: async () => {
      const { h, calls } = setup();
      const s = receiptCard({ kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' } });
      assert.equal((await h.revert(s, { actor: 'ada' })).notice, 'Reverted: Theme back to System (default)');
      assert.deepEqual(calls, [['settings.revert', 'theme']]);
      const d = receiptCard({ kind: 'direction', label: 'Direction', after: 'x', revertible: false });
      assert.deepEqual(await h.revert(d, { actor: 'ada' }), { ok: false, code: 'NOT_REVERTIBLE', error: 'This change cannot be reverted' });
    } },
  ]);
});

test('stop: live → stopRun, paused row → stopPausedPipeline, interrupted refused (R7)', async () => {
  await checkRows([
    { name: 'live', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-1', 'aaaa0001', 'running');
      assert.deepEqual(await h.stop({ type: 'run-stop', runId: 'uuid-1', pipelineId: 'aaaa0001' }, { actor: 'ada' }), { ok: true });
      assert.deepEqual(calls, [['stopRun', 'uuid-1', 'ada']]);
    } },
    { name: 'paused, not in this server\'s runs', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0002', 'paused');
      assert.deepEqual(await h.stop({ type: 'run-stop', runId: null, pipelineId: 'aaaa0002' }, { actor: 'ada' }), { ok: true });
      assert.deepEqual(calls, [['stopPausedPipeline', 'aaaa0002', 'ada']]);
    } },
    { name: 'interrupted', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0003', 'interrupted');
      assert.deepEqual(await h.stop({ type: 'run-stop', pipelineId: 'aaaa0003' }, { actor: 'ada' }), { ok: false, code: 'INTERRUPTED', error: "An interrupted run can't be stopped — it stays resumable" });
      assert.deepEqual(calls, []);
    } },
  ]);
});

test('mutation killers (refine audit): resume re-checks the run; every revert re-reads; stop re-checks at the click', async () => {
  await checkRows([
    { name: 'a stale resume (running again by now) is refused, nothing called (Review Focus 2)', run: async () => {
      const { h, calls, live, row } = setup();
      live('uuid-1', 'aaaa0002', 'running'); row('aaaa0002', 'running');
      assert.deepEqual(await h.apply({ kind: 'resume', runId: 'aaaa0002' }, A), { ok: false, notice: 'Could not resume Fix login: it is running' });
      assert.deepEqual(calls, []);
    } },
    { name: 'an interrupted run resumes (R8)', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0003', 'interrupted');
      const r = await h.apply({ kind: 'resume', runId: 'aaaa0003' }, A);
      assert.deepEqual(calls, [['resumeRun', 'aaaa0003', 'worca chat']]);
      assert.deepEqual(r.block.card.raw, { before: 'interrupted', after: 'running' });
    } },
    { name: 'pull request: facts with no feature branch are a notice (a workspace row the child cannot check)', run: async () => {
      const { h, row } = setup({ prCardFacts: async (r) => ({ pipelineId: r.id, projectKey: 'workspaces/wks-a', title: r.title, branch: null }) });
      row('cccc0004', 'done', { target: 'workspace', branch: null });
      assert.deepEqual(await h.apply({ kind: 'pull-request', runId: 'cccc0004' }, A), { ok: false, notice: 'Fix login has no feature branch to create a PR from' });
    } },
    { name: 'per-run Away: no change, no receipt', run: async () => {
      const { h, live } = setup();
      live('uuid-1', 'aaaa0001', 'running');
      const r = await h.awaySwitch({ kind: 'run', runId: 'uuid-1', mode: 'auto' }, { actor: 'ada' });
      assert.equal(r.ok, true); assert.equal(r.receipt, undefined);
    } },
    { name: 'per-run Away changed again since → CHANGED_SINCE, nothing written (R6)', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-1', 'aaaa0001', 'running', { orch: { state: { status: 'running', night: { override: 'on' } } } });
      const card = receiptCard({ kind: 'run-away', label: 'Away mode on this run', target: { runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login' },
        before: 'As set up', after: 'Never on this run', raw: { before: 'auto', after: 'off' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'resume revert while still starting is a retry; paused again since is CHANGED_SINCE', run: async () => {
      const { h, calls, live } = setup();
      const e = live('uuid-new', 'aaaa0002', 'starting');
      const card = receiptCard({ kind: 'resume', label: 'Run', target: { runId: 'uuid-new', pipelineId: 'aaaa0002', title: 'Fix login' }, before: 'Paused', after: 'Running', raw: { before: 'paused', after: 'running' } });
      assert.equal((await h.revert(card, { actor: 'ada' })).code, 'REVERT_FAILED');
      e.status = 'paused';
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'schedule resumed on the Schedules page since → CHANGED_SINCE, scheduleVerb not called', run: async () => {
      const { h, calls } = setup({ getSchedule: (id) => ({ id, status: 'active' }) });
      const card = receiptCard({ kind: 'schedule-pause', label: 'Schedule', target: { scheduleId: 'sch_00000001', title: 'Nightly' }, before: 'Active', after: 'Paused', raw: { before: 'active', after: 'paused' } });
      assert.equal((await h.revert(card, { actor: 'ada' })).code, 'CHANGED_SINCE');
      assert.deepEqual(calls, []);
    } },
    { name: 'a receipt marked not revertible is refused whatever its kind', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0001', 'paused');
      const card = receiptCard({ kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0001', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' }, revertible: false });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'NOT_REVERTIBLE', error: 'This change cannot be reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'stop: a run that finished since the card was proposed is refused, nothing called', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0005', 'done');
      assert.deepEqual(await h.stop({ type: 'run-stop', pipelineId: 'aaaa0005' }, { actor: 'ada' }), { ok: false, code: 'FINISHED', error: 'The run is already done' });
      assert.deepEqual(calls, []);
    } },
    { name: 'stop: a paused run still in this server\'s runs stops in place (stopRun), like POST /api/stop', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-2', 'aaaa0002', 'paused');
      assert.deepEqual(await h.stop({ type: 'run-stop', runId: 'uuid-2', pipelineId: 'aaaa0002' }, { actor: 'ada' }), { ok: true });
      assert.deepEqual(calls, [['stopRun', 'uuid-2', 'ada']]);
    } },
  ]);
});

test('base check, chat source, and runs the server cannot act on (refine cycle 1)', async () => {
  const PAUSED_RECEIPT = receiptCard({ kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0002', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' } });
  await checkRows([
    { name: 'resume and the pause revert ask resumeRun for the base check, like every Resume button (R8)', run: async () => {
      const { h, row, resumeOpts } = setup();
      row('aaaa0002', 'paused');
      assert.equal((await h.apply({ kind: 'resume', runId: 'aaaa0002' }, A)).ok, true);
      assert.equal((await h.revert(PAUSED_RECEIPT, { actor: 'ada' })).ok, true);
      assert.deepEqual(resumeOpts.map((o) => o.baseCheck), [true, true]);
    } },
    { name: 'a moved base sends the user to the run card, from apply and from Revert', run: async () => {
      const moved = () => Object.assign(new Error('base moved'), { body: { error: 'main moved since this run started', code: 'base-moved' } });
      const { h, row } = setup({ resumeRun: async () => { throw moved(); } });
      row('aaaa0002', 'paused');
      assert.deepEqual(await h.apply({ kind: 'resume', runId: 'aaaa0002' }, A), { ok: false, notice: 'Could not resume Fix login: main moved since this run started — press Resume on the run card to confirm.' });
      assert.deepEqual(await h.revert(PAUSED_RECEIPT, { actor: 'ada' }), { ok: false, code: 'REVERT_FAILED', error: 'main moved since this run started — press Resume on the run card to confirm' });
    } },
    { name: 'reverting the resume of an interrupted run says Paused (it is paused now)', run: async () => {
      const { h, live } = setup();
      live('uuid-new', 'aaaa0003', 'running');
      const card = receiptCard({ kind: 'resume', label: 'Run', target: { runId: 'uuid-new', pipelineId: 'aaaa0003', title: 'Fix login' }, before: 'Interrupted', after: 'Running', raw: { before: 'interrupted', after: 'running' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: true, notice: 'Reverted: Run (Fix login) back to Paused' });
    } },
    { name: 'pause a run this server did not start (a CLI run): said so, nothing called', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0001', 'running');
      assert.deepEqual(await h.apply({ kind: 'pause', runId: 'aaaa0001' }, A), { ok: false, notice: 'Could not pause Fix login: it was not started here' });
      assert.deepEqual(calls, []);
    } },
    { name: 'stop: a workspace run names its member branch', run: async () => {
      const { h, row } = setup();
      row('aaaa0008', 'paused', { target: 'workspace', branch: null, workspace_meta: JSON.stringify({ branches: { 'api-11111111': { source: 'main', feature: 'worca/ws-api' } } }) });
      assert.equal((await h.apply({ kind: 'stop', runId: 'aaaa0008' }, A)).block.card.branch, 'worca/ws-api');
    } },
    { name: 'stop: a running run this server did not start (a CLI run) gets a notice, never a card it could not apply', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0001', 'running');
      assert.deepEqual(await h.apply({ kind: 'stop', runId: 'aaaa0001' }, A), { ok: false, notice: 'Could not stop Fix login: it was not started here' });
      assert.deepEqual(calls, []);
    } },
    { name: 'direction to a run whose orchestrator has no pipeline yet: try again, not an internal error', run: async () => {
      const { h, live } = setup();
      live('uuid-8', null, 'starting', { orch: { state: { status: 'starting', night: { override: 'auto' } }, direct: async () => { throw new Error('direct(): the run has no pipeline dir yet'); } } });
      assert.deepEqual(await h.apply({ kind: 'direction', runId: 'uuid-8', text: 'x' }, A), { ok: false, notice: 'Could not send the direction to Fix login: it has no saved record yet — try again in a moment' });
    } },
    { name: 'pull request: an archived run', run: async () => {
      const { h, row } = setup();
      row('cccc0005', 'done', { archived_at: '2026-10-01T00:00:00Z' });
      assert.deepEqual(await h.apply({ kind: 'pull-request', runId: 'cccc0005' }, A), { ok: false, notice: 'Fix login is archived — restore it from History first' });
    } },
  ]);
});

test('refine cycle 2 mutation killers: each Revert writes raw.before through its own path; every R8 gate names the run card; runs the server cannot act on', async () => {
  await checkRows([
    { name: 'per-run Away Revert: the run switch goes back to raw.before (not a default), as the clicker', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-1', 'aaaa0001', 'running', { orch: { state: { status: 'running', night: { override: 'off' } } } });
      const card = receiptCard({ kind: 'run-away', label: 'Away mode on this run', target: { runId: 'uuid-1', pipelineId: 'aaaa0001', title: 'Fix login' },
        before: 'Answer for me now', after: 'Never on this run', raw: { before: 'on', after: 'off' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: true, notice: 'Reverted: Away mode on this run (Fix login) back to Answer for me now' });
      assert.deepEqual(calls, [['away', null, { kind: 'run', runId: 'uuid-1', mode: 'on' }, 'ada']]);
    } },
    { name: 'per-run Away Revert: a run no longer in this server\'s runs is CHANGED_SINCE, nothing written', run: async () => {
      const { h, calls } = setup();
      const card = receiptCard({ kind: 'run-away', label: 'Away mode on this run', target: { runId: 'uuid-gone', pipelineId: 'aaaa0009', title: 'Fix login' },
        before: 'As set up', after: 'Never on this run', raw: { before: 'auto', after: 'off' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'Away now Revert: writes raw.before whatever it was, not the default', run: async () => {
      const { h, calls, away } = setup();
      away.toggle = 'off';
      const card = receiptCard({ kind: 'away-now', label: 'Away mode', before: "I'm away now", after: 'Paused', raw: { before: 'on', after: 'off', person: null } });
      assert.deepEqual(await h.revert(card, { actor: 'bob' }), { ok: true, notice: "Reverted: Away mode back to I'm away now" });
      assert.deepEqual(calls, [['away', null, { kind: 'global', toggle: 'on' }, 'bob']]);
    } },
    { name: 'schedule Revert: a "Schedule resumed" receipt pauses it again', run: async () => {
      const { h, calls } = setup({ getSchedule: (id) => ({ id, status: 'active' }) });
      const card = receiptCard({ kind: 'schedule-resume', label: 'Schedule', target: { scheduleId: 'sch_00000001', title: 'Nightly' }, before: 'Paused', after: 'Active', raw: { before: 'paused', after: 'active' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: true, notice: 'Reverted: Schedule (Nightly) back to Paused' });
      assert.deepEqual(calls, [['scheduleVerb', 'pause', 'sch_00000001', 'ada']]);
    } },
    { name: 'schedule Revert: a verb scheduleVerb refuses is REVERT_FAILED with its words, never "Reverted"', run: async () => {
      const { h } = setup({ scheduleVerb: async () => ({ status: 409, body: { error: 'this schedule is active' } }) });
      const card = receiptCard({ kind: 'schedule-pause', label: 'Schedule', target: { scheduleId: 'sch_00000001', title: 'Nightly' }, before: 'Active', after: 'Paused', raw: { before: 'active', after: 'paused' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'REVERT_FAILED', error: 'this schedule is active' });
    } },
    { name: 'every confirmation resumeRun asks for sends the user to the run card (R8: base missing, engine, team cap)', run: async () => {
      for (const extra of [{ code: 'base-missing' }, { code: 'engine-refused' }, { needsPolicyAck: true }, { needsPolicyOverride: true }]) {
        const { h, row } = setup({ resumeRun: async () => { throw Object.assign(new Error('x'), { body: { error: 'needs you', ...extra } }); } });
        row('aaaa0002', 'paused');
        assert.deepEqual(await h.apply({ kind: 'resume', runId: 'aaaa0002' }, A), { ok: false, notice: 'Could not resume Fix login: needs you — press Resume on the run card to confirm.' }, JSON.stringify(extra));
      }
    } },
    { name: 'pause: a live run still starting is refused by the host, pauseRun never called', run: async () => {
      const { h, calls, live } = setup();
      live('uuid-9', null, 'starting');
      assert.deepEqual(await h.apply({ kind: 'pause', runId: 'uuid-9' }, A), { ok: false, notice: 'Could not pause Fix login: it is starting' });
      assert.deepEqual(calls, []);
    } },
    { name: 'the live entry wins over a lagging row: a run pausing right now is not paused again', run: async () => {
      const { h, calls, live, row } = setup();
      live('uuid-1', 'aaaa0001', 'pausing'); row('aaaa0001', 'running');
      assert.deepEqual(await h.apply({ kind: 'pause', runId: 'aaaa0001' }, A), { ok: false, notice: 'Could not pause Fix login: it is pausing' });
      assert.deepEqual(calls, []);
    } },
    { name: 'pause Revert: a run interrupted since is CHANGED_SINCE, never resumed', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0002', 'interrupted');
      const card = receiptCard({ kind: 'pause', label: 'Run', target: { pipelineId: 'aaaa0002', title: 'Fix login' }, before: 'Running', after: 'Paused', raw: { before: 'running', after: 'paused' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'resume Revert: a run that is running but not in this server\'s runs is CHANGED_SINCE', run: async () => {
      const { h, calls, row } = setup();
      row('aaaa0002', 'running');
      const card = receiptCard({ kind: 'resume', label: 'Run', target: { runId: 'uuid-new', pipelineId: 'aaaa0002', title: 'Fix login' }, before: 'Paused', after: 'Running', raw: { before: 'paused', after: 'running' } });
      assert.deepEqual(await h.revert(card, { actor: 'ada' }), { ok: false, code: 'CHANGED_SINCE', error: 'Changed since — not reverted' });
      assert.deepEqual(calls, []);
    } },
    { name: 'stop: a run gone from both the rows and the runs Map is NOT_FOUND, nothing called', run: async () => {
      const { h, calls } = setup();
      assert.deepEqual(await h.stop({ type: 'run-stop', runId: null, pipelineId: 'ffff0000' }, { actor: 'ada' }), { ok: false, code: 'NOT_FOUND', error: 'The run is gone' });
      assert.deepEqual(calls, []);
    } },
  ]);
});

test('the Away switch and an away-now Revert run inside the settings write queue (refine cycle 2: set_away_now writes settings.json too)', async () => {
  const order = [];
  const serial = (fn) => { order.push('queued'); return fn(); };
  const { h, away } = setup({ serial });
  const r = await h.awaySwitch({ kind: 'global', toggle: 'on' }, { actor: 'ada', person: null });
  assert.equal(r.ok, true);
  assert.deepEqual(order, ['queued']);
  assert.equal(away.toggle, 'on');
  assert.equal((await h.revert(r.receipt, { actor: 'ada' })).ok, true);
  assert.deepEqual(order, ['queued', 'queued']);
  const s = receiptCard({ kind: 'setting', label: 'Theme', target: { settingId: 'theme', scope: 'user' }, before: 'System (default)', after: 'Dark', raw: { before: null, after: 'dark' } });
  await h.revert(s, { actor: 'ada' });
  assert.deepEqual(order, ['queued', 'queued'], 'a setting Revert is queued by the registry itself — never twice (one chain would deadlock)');
});

test('refine cycle 3 mutation killer: a run another process drives gets no stop card in ANY live status — only a paused row stops from here', async () => {
  for (const status of ['starting', 'pausing', 'created']) {
    const { h, calls, row } = setup();
    row('aaaa0001', status);
    assert.deepEqual(await h.apply({ kind: 'stop', runId: 'aaaa0001' }, A), { ok: false, notice: 'Could not stop Fix login: it was not started here' }, status);
    assert.deepEqual(calls, [], status);
  }
});
