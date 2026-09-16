import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunRecord, cleanText, redactPaths, RECORD_FIELDS, TEXT_MAX,
} from '../src/core/metrics/record.mjs';
import {
  NOW, projectDone, workspaceTouched, workspaceUntouched, failedBudget, stoppedRun, stoppedAfterBudget, resumedRun, preflightFailed,
} from './fixtures/team-metrics/snapshots.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);   // Step 3 hoists sync/ledger imports into record.mjs; ledger resolves worcaHome()

test('single-project done → exact RunRecord v1', () => {
  const rec = buildRunRecord(projectDone, { attribution: 'git-user', now: new Date(NOW) });
  assert.deepEqual(rec, {
    v: 1,
    id: 'a1b2c3d4',
    worca: '1.2.0',
    recordedAt: '2026-09-15T14:41:03Z',
    startedAt: '2026-09-15T14:30:12Z',
    endedAt: '2026-09-15T14:40:58Z',
    wallMs: 646986,
    activeMs: 512340,
    result: 'done',
    failure: null,
    workflow: { id: 'wf_auto', name: 'Auto', version: 2, rev: '1a2b3c4d' },
    target: { kind: 'project', project: 'acme/billing-api' },
    title: 'Add idempotency keys to POST /invoices',
    source: { type: 'github-issues', ref: '#412', url: 'https://github.com/acme/billing-api/issues/412', title: 'Idempotency keys for invoices' },
    cost: { usd: 3.42, byPhase: { plan: 0.61, implement: 2.15, review: 0.66 } },
    agents: { count: 4, keys: ['planner', 'implementer', 'reviewer', 'refiner'], models: ['claude-opus-5', 'claude-sonnet-5'] },
    steps: 5,
    cycles: { plan: 1, implement: 2, review: 2 },
    interventions: { questions: 1, pauses: 0, resumes: 0 },
    pr: null,
    git: { branch: 'worca/idempotency-keys', head: '8067ff25', base: 'dev', filesChanged: 12, insertions: 340, deletions: 25 },
    actor: 'Siniša Đukić',
  });
});

test('field order is fixed (serialised key order == RECORD_FIELDS)', () => {
  const rec = buildRunRecord(projectDone, { now: new Date(NOW) });
  assert.deepEqual(Object.keys(rec), RECORD_FIELDS);
  assert.ok(JSON.stringify(rec).startsWith('{"v":1,"id":"a1b2c3d4","worca":'));
});

test('title and failure.message are truncated to 200 chars and stripped of control chars/newlines', () => {
  const long = `line one\nline\ttwo\u0007 ${'x'.repeat(400)}`;
  const rec = buildRunRecord({ ...failedBudget, title: long, error: long }, { now: new Date(NOW) });
  assert.equal(Array.from(rec.title).length, TEXT_MAX);
  assert.equal(Array.from(rec.failure.message).length, TEXT_MAX);
  assert.doesNotMatch(rec.title, /[\u0000-\u001F\u007F]/);
  assert.ok(rec.title.startsWith('line one line two '));
  assert.equal(JSON.stringify(rec).includes('\\n'), false);
  assert.equal(cleanText('a\u2028b'), 'a b');
});

test('failure.message never carries a local path (§4.12, decision 34); URLs survive', () => {
  // Real text from run-harness.mjs:~1333 — verified leaking "/Users/<name>/…" in a scratch resume-error run.
  const err = "worktree missing: /Users/me/.worca-cc/runs/ab/repos/x — cannot resume; ENOENT open 'C:\\Users\\me\\p.md'; see https://github.com/a/b/issues/1";
  const rec = buildRunRecord({ ...failedBudget, lastPause: null, error: err }, { now: new Date(NOW) });
  assert.equal(rec.failure.message, "worktree missing: <path> — cannot resume; ENOENT open '<path>'; see https://github.com/a/b/issues/1");
  assert.equal(redactPaths('at ~/dev/worca/x.mjs:12'), 'at <path>');
  assert.equal(redactPaths('see https://github.com/a/b/pull/7'), 'see https://github.com/a/b/pull/7');
  assert.equal(redactPaths(null), null);
});

test('attribution none → actor null', () => {
  assert.equal(buildRunRecord(projectDone, { attribution: 'none', now: new Date(NOW) }).actor, null);
});

test('failed after a cost-cap pause → failure.kind budget; plain error → error; preflight-only row → preflight', () => {
  const b = buildRunRecord(failedBudget, { now: new Date(NOW) });
  assert.equal(b.result, 'failed');
  assert.deepEqual(b.failure, { kind: 'budget', message: 'resume failed: worktree gone' });
  const e = buildRunRecord({ ...failedBudget, lastPause: null, error: 'scheduler exploded' }, { now: new Date(NOW) });
  assert.deepEqual(e.failure, { kind: 'error', message: 'scheduler exploded' });
  const p = buildRunRecord(preflightFailed, { now: new Date(NOW) });
  assert.equal(p.failure.kind, 'preflight');
  assert.equal(p.steps, 0);
  // A cost cap can trip on the classifier's preflight cost before any agent step: budget wins.
  const pb = buildRunRecord({ ...preflightFailed, lastPause: { reason: 'cost_total', detail: 'total cost cap reached' } }, { now: new Date(NOW) });
  assert.equal(pb.failure.kind, 'budget');
});

test('agents.models holds full model ids from agent steps only (sub-agent aliases ignored)', () => {
  const rec = buildRunRecord({ ...projectDone, subAgents: [{ runModel: 'haiku' }] }, { now: new Date(NOW) });
  assert.deepEqual(rec.agents.models, ['claude-opus-5', 'claude-sonnet-5']);
});

test('stopped → result stopped, failure null, git counts null when no results.json', () => {
  const rec = buildRunRecord(stoppedRun, { now: new Date(NOW) });
  assert.equal(rec.result, 'stopped');
  assert.equal(rec.failure, null);
  assert.deepEqual(rec.git, { branch: 'worca/x', head: null, base: 'main', filesChanged: null, insertions: null, deletions: null });
});

test('stopped while parked by a cost cap → failure.kind budget with the pause detail', () => {
  const rec = buildRunRecord(stoppedAfterBudget, { now: new Date(NOW) });
  assert.equal(rec.result, 'stopped');
  assert.deepEqual(rec.failure, { kind: 'budget', message: 'pipeline cost cap $5.00 reached' });
});

test('workflow.rev keeps only an 8-hex revision', () => {
  assert.equal(buildRunRecord({ ...projectDone, workflow: { ...projectDone.workflow, rev: 'nope' } }, { now: new Date(NOW) }).workflow.rev, null);
});

test('resumed run carries pause/resume interventions', () => {
  assert.deepEqual(buildRunRecord(resumedRun, { now: new Date(NOW) }).interventions, { questions: 2, pauses: 1, resumes: 1 });
});

test('workspace target: projects = member set, touched = changed subset (touched / untouched)', () => {
  const t = buildRunRecord(workspaceTouched, { now: new Date(NOW) });
  assert.deepEqual(t.target, { kind: 'workspace', workspace: 'IoT SP Platform', workspaceId: null, projects: ['acme/device-registry', 'acme/gateway'], touched: ['acme/gateway'], touchedFiles: {} });
  const u = buildRunRecord(workspaceUntouched, { now: new Date(NOW) });
  assert.deepEqual(u.target.touched, []);
  // Per-member file counts (additive): kept when they are non-negative integers keyed by slug, anything else dropped.
  const counted = buildRunRecord({ ...workspaceTouched, target: { ...workspaceTouched.target, touchedFiles: { 'acme/gateway': 7, 'acme/device-registry': -1, 'acme/x': 'many', '': 3 } } }, { now: new Date(NOW) });
  assert.deepEqual(counted.target.touchedFiles, { 'acme/gateway': 7 });
  assert.deepEqual(buildRunRecord({ ...workspaceTouched, target: { ...workspaceTouched.target, touchedFiles: ['nope'] } }, { now: new Date(NOW) }).target.touchedFiles, {});
  // The stable identity travels when the harness knows it (additive v1 field; the reader
  // matches on it first and falls back to the name for older records).
  const withId = buildRunRecord({ ...workspaceTouched, target: { ...workspaceTouched.target, workspaceId: 'wks-iot-sp-0123abcd' } }, { now: new Date(NOW) });
  assert.equal(withId.target.workspaceId, 'wks-iot-sp-0123abcd');
  assert.equal(withId.target.workspace, 'IoT SP Platform', 'the display name stays alongside the id');
});

test('non-terminal status is rejected', () => {
  assert.throws(() => buildRunRecord({ ...projectDone, status: 'paused' }), RangeError);
});
