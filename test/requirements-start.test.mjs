// test/requirements-start.test.mjs — Start in Worca, revert and readiness on the views (A2 D5–D11).
// A bare express app with the requirements routes and fake run-handler deps: no server, no real run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import {
  createFeature, updateFeature, appendTurn, listTurns, listStarts, latestStart, getFeature, setContext, createStart,
  beginBrief, saveBriefResult, deleteBrief, listAttachments, updateAttachment, getAttachment, saveExportLink,
} from '../src/core/requirements/store.mjs';
import { addAttachments, readsSettled, replaceAttachment, removeAttachment, attachmentFile } from '../src/core/requirements/attachment-job.mjs';
import { startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';
import { startFeature, startView } from '../src/core/requirements/start.mjs';
import { markExporting, unmarkExporting } from '../src/core/requirements/starting.mjs';
import { registerRequirementsRoutes } from '../src/core/requirements/routes.mjs';
import { buildRoundPrompt } from '../src/core/requirements/round.mjs';

useTempHome(after, 'worca-req-start-');
const prevFlags = process.env.WORCA_FLAGS;
process.env.WORCA_FLAGS = 'requirements';

const scratch = [];
let srv; let base; let projKey; let projDir; let goneKey;
const calls = [];
let runImpl = async () => ({ status: 200, body: {} });
let summaryImpl = () => null;
let n = 0;

before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-start-shop-')); scratch.push(projDir);
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  const gone = mkdtempSync(join(tmpdir(), 'req-start-gone-'));
  goneKey = (await addProject({ name: 'gone', path: gone })).find((p) => p.name === 'gone').key;
  rmSync(gone, { recursive: true, force: true });
  const app = express();
  app.use(express.json());
  registerRequirementsRoutes(app, { broadcast: () => {}, deps: {
    startRun: async (body, opts) => { calls.push({ body, opts }); return runImpl(body, opts); },
    runSummary: (q) => summaryImpl(q),
  } });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

const readySpec = () => ({ ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' },
  criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }, { id: 'R-po-2', text: 'Refund in 3 days' }],
  assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] });

/** A feature that passes all six checks (when its target exists). */
function readyFeature({ scopeType = 'project', scopeKey = projKey, title = 'Cancel order' } = {}) {
  const f = createFeature({ scopeType, scopeKey, title, description: 'Before it ships' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  return updateFeature(f.seq, { status: 'done', criteriaSeq: 2, assumptionSeq: 1, spec: readySpec() });
}
/** Interview not finished, one open question, one open assumption. */
function notReadyFeature() {
  const f = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Half', description: 'd' });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: false } });
  return updateFeature(f.seq, { status: 'done', spec: { ...readySpec(), openQuestions: ['Who pays?'],
    assumptions: [{ id: 'A-1', text: 'a', status: 'open' }] } });
}
const ok = (runId) => async (_b, opts) => ({ status: 200, body: { runId: runId || opts.runId } });
const reset = () => { calls.length = 0; runImpl = ok(); summaryImpl = () => null; };

test('a Ready project feature starts through the run handler with the D6 body; version 1, a start turn', async () => {
  reset();
  const f = readyFeature();
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(calls.length, 1);
  const { body, opts } = calls[0];
  assert.match(body.promptMarkdown, /^Build this feature\./);
  assert.match(body.promptMarkdown, new RegExp(`# FEAT-${f.seq} v1: Cancel order`));
  assert.match(body.promptMarkdown, /R-po-1/);
  assert.match(body.promptMarkdown, /R-po-2/);
  assert.equal(body.title, `FEAT-${f.seq}: Cancel order`);
  assert.equal(body.projectDir, projDir);
  assert.equal(body.workflowId, 'wf_auto');
  assert.equal(body.guardrailsId, 'normal');
  for (const k of ['workspaceId', 'sourceBranch']) assert.equal(k in body, false, k);
  assert.match(opts.runId, /^[0-9a-f-]{36}$/);
  assert.equal(opts.startedBy, 'local');
  assert.equal(r.json.runId, opts.runId);
  assert.equal(r.json.version, 1);
  assert.equal(r.json.feature.seq, f.seq);
  assert.equal(r.json.feature.state, 'started');
  const s = latestStart(f.seq);
  assert.deepEqual([s.version, s.runId, s.ready, s.failing, s.reason, s.workflowId, s.sourceBranch, s.title],
    [1, opts.runId, true, [], null, 'wf_auto', null, 'Cancel order']);
  assert.deepEqual(s.spec, getFeature(f.seq).spec);
  const t = listTurns(f.seq).at(-1);
  assert.equal(t.kind, 'start');
  assert.deepEqual(t.payload, { version: 1, runId: opts.runId, override: false });
});

test('the run id the handler answers with is the one stored', async () => {
  reset();
  runImpl = ok('11111111-2222-3333-4444-555555555555');
  const f = readyFeature();
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(r.json.runId, '11111111-2222-3333-4444-555555555555');
  assert.equal(latestStart(f.seq).runId, '11111111-2222-3333-4444-555555555555');
});

test('a workspace feature sends workspaceId and no projectDir', async () => {
  reset();
  const f = readyFeature({ scopeType: 'workspace', scopeKey: 'ws-abc' });
  const r = await startFeature(f.seq, {}, { by: 'po' },
    { startRun: async (b, o) => { calls.push({ body: b, opts: o }); return { status: 200, body: { runId: o.runId } }; },
      target: { ok: true, name: 'Team', label: 'Workspace Team exists' }, newRunId: () => `run-${++n}` });
  assert.deepEqual(r, { runId: `run-${n}`, version: 1 });
  assert.equal(calls[0].body.workspaceId, 'ws-abc');
  assert.equal('projectDir' in calls[0].body, false);
  assert.match(calls[0].body.promptMarkdown, /\*\*Workspace:\*\* Team/);
  assert.deepEqual(calls[0].opts, { runId: `run-${n}`, startedBy: 'po' });
});

test('sourceBranch and workflowId pass through; a bad workflowId is a 400 and no call', async () => {
  reset();
  const f = readyFeature();
  const r = await call('POST', `/api/requirements/${f.seq}/start`, { sourceBranch: 'main', workflowId: 'wf_full' });
  assert.equal(r.status, 201);
  assert.equal(calls[0].body.sourceBranch, 'main');
  assert.equal(calls[0].body.workflowId, 'wf_full');
  assert.deepEqual([latestStart(f.seq).workflowId, latestStart(f.seq).sourceBranch], ['wf_full', 'main']);
  reset();
  const g = readyFeature();
  const bad = await call('POST', `/api/requirements/${g.seq}/start`, { workflowId: 'x;rm' });
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
  assert.equal(latestStart(g.seq), null);
  const blank = await call('POST', `/api/requirements/${g.seq}/start`, { sourceBranch: '  ' });
  assert.equal(blank.status, 201);
  assert.equal('sourceBranch' in calls[0].body, false);
});

test('not Ready: refused without a reason (409 NOT_READY, failing keys); with one, the override is stored', async () => {
  reset();
  const f = notReadyFeature();
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { error: 'This feature is not Ready. Give a reason to start it anyway.', failing: ['interview', 'openQuestions', 'assumptions'] });
  assert.equal(calls.length, 0);
  assert.equal(latestStart(f.seq), null);
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, { reason: '   ' })).status, 409);
  const long = await call('POST', `/api/requirements/${f.seq}/start`, { reason: 'x'.repeat(501) });
  assert.equal(long.status, 400);
  assert.equal(calls.length, 0);
  const go = await call('POST', `/api/requirements/${f.seq}/start`, { reason: '  Demo on Friday  ' });
  assert.equal(go.status, 201);
  const s = latestStart(f.seq);
  assert.deepEqual([s.ready, s.failing, s.reason], [false, ['interview', 'openQuestions', 'assumptions'], 'Demo on Friday']);
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { version: 1, runId: s.runId, override: true });
  assert.equal(go.json.feature.starts[0].reason, 'Demo on Friday');
});

test('a Ready start ignores a reason', async () => {
  reset();
  const f = readyFeature();
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, { reason: 'because' })).status, 201);
  assert.equal(latestStart(f.seq).reason, null);
});

test('busy, archived and a missing target are refused even with a reason', async () => {
  reset();
  // archived
  const a = readyFeature();
  assert.equal((await call('POST', `/api/requirements/${a.seq}/archive`, {})).status, 200);
  const ra = await call('POST', `/api/requirements/${a.seq}/start`, { reason: 'please' });
  assert.equal(ra.status, 409);
  // target missing: folder gone, and an unknown project
  for (const key of [goneKey, 'nope-1234abcd']) {
    const g = readyFeature({ scopeKey: key });
    const rg = await call('POST', `/api/requirements/${g.seq}/start`, { reason: 'please' });
    assert.equal(rg.status, 409, key);
    assert.equal(rg.json.failing, undefined);
    assert.equal(latestStart(g.seq), null);
  }
  // busy: an interview job runs
  const b = readyFeature();
  setContext('project', projKey, { lookAtCode: false });
  let release;
  const gate = new Promise((res) => { release = res; });
  const d = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const p = startOrientation(b.seq, {}, d);
  assert.equal(isBusy(b.seq), true);
  const rb = await call('POST', `/api/requirements/${b.seq}/start`, { reason: 'please' });
  assert.equal(rb.status, 409);
  release();
  await p;
  await settled(b.seq);
  assert.equal(calls.length, 0);
  assert.equal(latestStart(b.seq), null);
});

test("the run handler's refusals map to BUDGET / BAD_REQUEST / CONFLICT / 500 and store nothing", async () => {
  const f = readyFeature();
  for (const [status, want, error] of [[403, 409, 'total cost limit reached'], [400, 400, 'bad branch'], [409, 409, 'engine refused'], [503, 500, 'draining'], [500, 500, null]]) {
    reset();
    runImpl = async () => ({ status, body: error ? { error } : {} });
    const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
    assert.equal(r.status, want, String(status));
    assert.equal(r.json.error, error || `the run could not start (HTTP ${status})`);
    assert.equal(calls.length, 1);
    assert.equal(latestStart(f.seq), null);
  }
  assert.equal(listTurns(f.seq).filter((t) => t.kind === 'start').length, 0);
  reset();
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(r.json.version, 1);
});

test('a second start is version 2; two concurrent starts: one succeeds, one is BUSY', async () => {
  reset();
  const f = readyFeature();
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, {})).json.version, 1);
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, {})).json.version, 2);
  assert.deepEqual(listStarts(f.seq).map((s) => s.version), [2, 1]);
  reset();
  const g = readyFeature();
  let release;
  const gate = new Promise((res) => { release = res; });
  runImpl = async (_b, o) => { await gate; return { status: 200, body: { runId: o.runId } }; };
  const first = call('POST', `/api/requirements/${g.seq}/start`, {});
  // bounded: a start that never reaches the run handler fails the test instead of hanging the run
  for (let i = 0; calls.length === 0; i += 1) {
    if (i >= 1000) { release(); assert.fail('the first start never reached the run handler (5 s)'); }
    await new Promise((r) => setTimeout(r, 5));
  }
  const second = await call('POST', `/api/requirements/${g.seq}/start`, {});
  assert.equal(second.status, 409);
  assert.match(second.json.error, /already starting/);
  release();
  assert.equal((await first).status, 201);
  assert.equal(calls.length, 1);
  assert.equal(listStarts(g.seq).length, 1);
  runImpl = ok();
  assert.equal((await call('POST', `/api/requirements/${g.seq}/start`, {})).json.version, 2, 'the in-flight mark is released');
});

test('without a startRun dep the route answers 500', async () => {
  const app = express();
  app.use(express.json());
  registerRequirementsRoutes(app, { broadcast: () => {} });
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try {
    const f = readyFeature();
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/requirements/${f.seq}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'starting runs is not available' });
  } finally { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
});

test('scope change: allowed before a start, 409 after', async () => {
  reset();
  const { addProject } = await import('../src/core/projects.mjs');
  const other = mkdtempSync(join(tmpdir(), 'req-start-other-')); scratch.push(other);
  const otherKey = (await addProject({ name: 'other', path: other })).find((p) => p.name === 'other').key;
  const f = readyFeature();
  const before = await call('PATCH', `/api/requirements/${f.seq}`, { scopeType: 'project', scopeKey: otherKey });
  assert.equal(before.status, 200);
  assert.equal(before.json.feature.scopeKey, otherKey);
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, {})).status, 201);
  const after = await call('PATCH', `/api/requirements/${f.seq}`, { scopeType: 'project', scopeKey: projKey });
  assert.equal(after.status, 409);
  assert.equal(after.json.error, 'this feature has been started; its project or workspace can no longer change');
  assert.equal((await call('PATCH', `/api/requirements/${f.seq}`, { title: 'Still editable' })).status, 200);
  assert.equal((await call('PATCH', `/api/requirements/${f.seq}`, { scopeType: 'project', scopeKey: otherKey, title: 'Same scope' })).status, 200);
});

test('revert: changes since the start show, undo restores the frozen spec, counters stay', async () => {
  reset();
  const f = readyFeature();
  await call('POST', `/api/requirements/${f.seq}/start`, {});
  const frozen = latestStart(f.seq).spec;
  await call('PUT', `/api/requirements/${f.seq}/criteria/R-po-1`, { text: 'Cancel while unpaid or pending' });
  const added = await call('POST', `/api/requirements/${f.seq}/criteria`, { text: 'Email the buyer' });
  assert.equal(added.json.feature.spec.criteria.at(-1).id, 'R-po-3');
  const v = (await call('GET', `/api/requirements/${f.seq}`)).json.feature;
  assert.deepEqual(v.changedSinceStart.map((c) => [c.kind, c.id, c.change]), [['criterion', 'R-po-1', 'edited'], ['criterion', 'R-po-3', 'added']]);
  const r = await call('POST', `/api/requirements/${f.seq}/revert`, { version: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.feature.spec, frozen);
  assert.deepEqual(r.json.feature.changedSinceStart, []);
  assert.equal(r.json.feature.criteriaSeq, 3, 'the counter never goes back');
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual([t.kind, t.payload], ['edit', { reverted: 1 }]);
  assert.match(buildRoundPrompt({ feature: getFeature(f.seq), turns: listTurns(f.seq) }), /The product owner undid their changes since build v1: the spec went back to build v1 \(criteria and assumptions as they were then\)\./);
  assert.equal((await call('POST', `/api/requirements/${f.seq}/criteria`, { text: 'again' })).json.feature.spec.criteria.at(-1).id, 'R-po-4');
  assert.equal((await call('POST', `/api/requirements/${f.seq}/revert`, { version: 9 })).status, 404);
  for (const version of [0, -1, 1.5, '1', undefined]) {
    assert.equal((await call('POST', `/api/requirements/${f.seq}/revert`, { version })).status, 400, String(version));
  }
});

test('feature view: readiness, state, unasked rejections, starts with the newest spec and its run', async () => {
  reset();
  const f = notReadyFeature();
  updateFeature(f.seq, { spec: { ...getFeature(f.seq).spec, assumptions: [{ id: 'A-1', text: 'a', status: 'open' }, { id: 'A-2', text: 'b', status: 'rejected' }] } });
  appendTurn(f.seq, { kind: 'assumption', payload: { id: 'A-2', status: 'rejected' } });
  let v = (await call('GET', `/api/requirements/${f.seq}`)).json.feature;
  assert.equal(v.readiness.total, 6);
  assert.equal(v.readiness.ok, false);
  assert.equal(v.readiness.overridable, true);
  assert.equal(v.readiness.checks.find((c) => c.key === 'target').label, 'Project shop is registered');
  assert.equal(v.state, 'decide');
  assert.deepEqual(v.unaskedRejections, ['A-2']);
  assert.deepEqual(v.starts, []);
  assert.deepEqual(v.changedSinceStart, []);

  const g = readyFeature();
  assert.equal((await call('GET', `/api/requirements/${g.seq}`)).json.feature.state, 'ready');
  await call('POST', `/api/requirements/${g.seq}/start`, {});
  await call('POST', `/api/requirements/${g.seq}/start`, {});
  const [s2, s1] = listStarts(g.seq);
  summaryImpl = ({ runId, pipelineId }) => (runId === s2.runId
    ? { status: 'running', phase: 'implement', costUsd: 0.42, pipelineId: pipelineId || 'abcd1234' } : null);
  v = (await call('GET', `/api/requirements/${g.seq}`)).json.feature;
  assert.equal(v.state, 'started');
  assert.deepEqual(v.starts.map((s) => s.version), [2, 1]);
  assert.deepEqual(v.starts[0].spec, s2.spec);
  assert.equal('spec' in v.starts[1], false, 'only the newest start carries its spec');
  assert.deepEqual(v.starts[0].run, { status: 'running', phase: 'implement', costUsd: 0.42, href: `#running/${s2.runId}` });
  assert.equal(v.starts[0].pipelineId, 'abcd1234');
  assert.equal(v.starts[1].run, null);
  assert.equal(v.starts[1].runId, s1.runId);
  assert.equal(listStarts(g.seq)[0].pipelineId, 'abcd1234', 'linkPipeline filled the row');
  for (const k of ['version', 'runId', 'pipelineId', 'startedBy', 'startedAt', 'ready', 'failing', 'reason', 'workflowId', 'sourceBranch', 'run']) {
    assert.ok(k in v.starts[1], k);
  }
});

test('startView: a throwing or async runSummary; an existing pipeline id is not relinked', async () => {
  const f = readyFeature();
  const s = createStart({ featureSeq: f.seq, version: 1, runId: 'r-view-1', spec: f.spec, title: 't', ready: true });
  assert.equal((await startView(s, () => { throw new Error('x'); })).run, null);
  const v = await startView(s, async () => ({ status: 'done', phase: null, costUsd: 1, pipelineId: 'deadbeef' }));
  assert.deepEqual(v.run, { status: 'done', phase: null, costUsd: 1, href: '#running/r-view-1' });
  assert.equal(v.pipelineId, 'deadbeef');
  const again = await startView(listStarts(f.seq)[0], () => ({ status: 'done', pipelineId: 'ffffffff' }));
  assert.equal(again.pipelineId, 'deadbeef');
  assert.equal(listStarts(f.seq)[0].pipelineId, 'deadbeef');
});

test('list: state, ready, latestRun; lookCostUsd and spend', async () => {
  reset();
  const f = readyFeature({ title: 'Listed' });
  await call('POST', `/api/requirements/${f.seq}/start`, {});
  const runId = latestStart(f.seq).runId;
  summaryImpl = ({ runId: id }) => (id === runId ? { status: 'running', phase: 'plan', costUsd: 0.1, pipelineId: null } : null);
  const g = notReadyFeature();
  const r = await call('GET', '/api/requirements');
  assert.equal(r.status, 200);
  const row = r.json.features.find((x) => x.seq === f.seq);
  assert.equal(row.state, 'started');
  assert.equal(row.ready, 6);
  assert.deepEqual(row.latestRun, { status: 'running', phase: 'plan', costUsd: 0.1, href: `#running/${runId}` });
  assert.equal(row.spec, undefined);
  const other = r.json.features.find((x) => x.seq === g.seq);
  assert.deepEqual([other.state, other.ready, other.latestRun], ['decide', 3, null]);
  assert.equal(r.json.lookCostUsd, null);
  assert.deepEqual(Object.keys(r.json.spend).sort(), ['resetPeriod', 'totalLimitUsd', 'windowUsd']);
  assert.equal(r.json.spend.resetPeriod, 'monthly', 'the budget period (the default)');
  assert.equal(r.json.spend.totalLimitUsd, null);
  const w0 = r.json.spend.windowUsd;
  for (const c of [0.3, 0.1, 0.2, 0.5]) appendTurn(g.seq, { kind: 'orientation', payload: {}, costUsd: c });
  assert.equal((await call('GET', '/api/requirements')).json.lookCostUsd, 0.25);
  appendTurn(g.seq, { kind: 'orientation', payload: {}, costUsd: 0.9 });
  assert.equal((await call('GET', '/api/requirements')).json.lookCostUsd, 0.3);
  const { recordRequirementsCostDelta } = await import('../src/core/cost-budget.mjs');
  recordRequirementsCostDelta({ featureSeq: g.seq, amountUsd: 0.07 });
  recordRequirementsCostDelta({ featureSeq: g.seq, amountUsd: 0.5, tsMs: Date.UTC(2000, 0, 1) });
  assert.equal((await call('GET', '/api/requirements')).json.spend.windowUsd, Math.round((w0 + 0.07) * 1e4) / 1e4);
});

test('startView: the summary\'s href wins (a resumed or settled run); #running/<runId> only without one', async () => {
  const f = readyFeature();
  const s = createStart({ featureSeq: f.seq, version: 1, runId: 'r-href-1', spec: f.spec, title: 't', ready: true });
  const live = await startView(s, () => ({ status: 'running', phase: 'plan', costUsd: 0, pipelineId: 'beadbead', href: '#running/new-uuid' }));
  assert.equal(live.run.href, '#running/new-uuid');
  const gone = await startView(s, () => ({ status: 'done', phase: null, costUsd: 1, pipelineId: 'beadbead', href: '#history/shop-key/beadbead' }));
  assert.equal(gone.run.href, '#history/shop-key/beadbead');
  const bare = await startView(s, () => ({ status: 'done', phase: null, costUsd: 1, pipelineId: 'beadbead' }));
  assert.equal(bare.run.href, '#running/r-href-1');
});

test('a store write failing after the run handler said yes is logged with the run id (an orphan run), then thrown', async () => {
  reset();
  const f = readyFeature();
  createStart({ featureSeq: f.seq, version: 9, runId: 'r-taken', spec: f.spec, title: 't', ready: true });
  runImpl = ok('r-taken');   // run_id is UNIQUE: the start row cannot be written
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await assert.rejects(startFeature(f.seq, {}, { by: 'po' }, { startRun: runImpl, target: { ok: true, path: projDir, name: 'shop' } }));
  } finally { console.error = orig; }
  assert.equal(logged.length, 1, logged.join('\n'));
  assert.match(logged[0], /^\[worca-ui\] /);
  assert.match(logged[0], /r-taken/);
  assert.equal(listTurns(f.seq).some((t) => t.kind === 'start'), false, 'the turn rolled back with the row');
});

test('a start in flight: isStarting; archive and a scope change are BUSY until it is stored; the title is not', async () => {
  reset();
  const { isStarting } = await import('../src/core/requirements/start.mjs');
  const { updateHeader, setArchived } = await import('../src/core/requirements/edits.mjs');
  const f = readyFeature();
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = startFeature(f.seq, {}, { by: 'po' }, {
    startRun: async (_b, opts) => { await gate; return { status: 200, body: { runId: opts.runId } }; },
    target: { ok: true, path: projDir, name: 'shop' } });
  assert.equal(isStarting(f.seq), true);
  assert.throws(() => setArchived(f.seq, true), (e) => e.code === 'BUSY');
  assert.throws(() => updateHeader(f.seq, { scopeType: 'project', scopeKey: 'elsewhere-1' }), (e) => e.code === 'BUSY');
  assert.equal(updateHeader(f.seq, { title: 'Cancel order now' }).title, 'Cancel order now', 'a title change is fine');
  release();
  await p;
  assert.equal(isStarting(f.seq), false);
  assert.equal(getFeature(f.seq).status, 'done');
  assert.equal(getFeature(f.seq).scopeKey, projKey);
  assert.equal(setArchived(f.seq, true).status, 'archived', 'after the start, archive works');
});

test('startView: run.waiting only when the summary says so', async () => {
  const f = readyFeature();
  const s = createStart({ featureSeq: f.seq, version: 1, runId: 'r-wait-1', spec: f.spec, title: 't', ready: true });
  assert.equal((await startView(s, () => ({ status: 'running', phase: 'idle', costUsd: 0, waiting: true }))).run.waiting, true);
  assert.equal('waiting' in (await startView(s, () => ({ status: 'running', phase: 'idle', costUsd: 0, waiting: false }))).run, false);
});

// ── A8 D14: the files go to the run ─────────────────
const file = (name, text) => { const data = Buffer.from(text); return { name, kind: 'text', mime: 'text/markdown', data, text, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; };
const MOCK = { mockEnabled: () => true };
async function withFiles(f, files) {
  updateFeature(f.seq, { status: 'your_turn' });   // mid-interview (D8 a): no follow-up round starts when the reads end
  const rows = addAttachments({ type: 'feature', id: f.seq }, files, {}, MOCK);
  await readsSettled({ type: 'feature', id: f.seq });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true, files: rows.map((r) => r.id) } });   // the next round carried them
  updateFeature(f.seq, { status: 'done' });
  return rows;
}
/** A made brief for the shop project with these documents (read in mock mode); `on` names the ones sent with every run. */
async function briefWith(files, on = []) {
  const brief = beginBrief('project', projKey);
  saveBriefResult(brief.id, { sections: { product: 'P', users: [], terms: [], areas: [] } });
  const owner = { type: 'brief', id: brief.id, scopeType: 'project', scopeKey: projKey };
  const rows = addAttachments(owner, files, {}, MOCK);
  await readsSettled(owner);
  for (const r of rows) if (on.includes(r.name)) updateAttachment(r.id, { sendWithRun: true });
  return rows;
}
const dropBrief = () => deleteBrief('project', projKey);

test('Start sends the switched-on files and documents as extrasFiles and records them on the start row', async () => {
  reset();
  const f = readyFeature();
  const [a, b] = await withFiles(f, [file('notes.md', 'notes'), file('left-out.md', 'out')]);
  updateAttachment(a.id, { sendWithRun: true });
  try {
    const [g] = await briefWith([file('glossary.md', 'g'), file('not-sent.md', 'n')], ['glossary.md']);
    const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const { opts } = calls[0];
    assert.deepEqual(opts.extrasFiles.map((x) => x.name), ['notes.md', 'glossary.md']);
    assert.ok(opts.extrasFiles.every((x) => typeof x.path === 'string' && x.path.endsWith('.txt')));
    assert.deepEqual(opts.extrasFiles.map((x) => x.sha256), [a.sha256, g.sha256], 'the staging checks each copy against its hash');
    assert.deepEqual(opts.extrasFiles.map((x) => x.id), [a.id, g.id], 'and asks its row whether a failed copy is a change or a damaged body');
    assert.deepEqual(latestStart(f.seq).files, [{ id: a.id, name: 'notes.md', sha256: a.sha256, from: 'feature' }, { id: g.id, name: 'glossary.md', sha256: g.sha256, from: 'brief' }]);
    assert.deepEqual(r.json.feature.starts[0].files.map((x) => x.name), ['notes.md', 'glossary.md']);
    assert.equal(b.sendWithRun, false);
  } finally { dropBrief(); }
});

test('a start in flight refuses Add files (409, isStarting)', async () => {
  reset();
  const f = readyFeature();
  let open;
  const gate = new Promise((res) => { open = res; });
  runImpl = async (_b, opts) => { await gate; return { status: 200, body: { runId: opts.runId } }; };
  const start = call('POST', `/api/requirements/${f.seq}/start`, {});
  await new Promise((res) => setTimeout(res, 30));
  const add = await call('POST', `/api/requirements/${f.seq}/attachments`, { attachments: [{ name: 'x.md', dataBase64: Buffer.from('x').toString('base64') }] });
  assert.deepEqual([add.status, add.json.error], [409, 'this feature is starting a run. Try again in a moment.']);
  open();
  assert.equal((await start).status, 201);
  assert.deepEqual(listAttachments('feature', f.seq), []);
});

test('a start without files sends no extrasFiles key; a request body cannot hand the start files', async () => {
  reset();
  const f = readyFeature();
  await call('POST', `/api/requirements/${f.seq}/start`, { extrasFiles: [{ name: 'x', path: projDir }], _extrasPaths: [projDir] });
  assert.equal('extrasFiles' in calls[0].opts, false);
  assert.deepEqual(Object.keys(calls[0].opts).sort(), ['runId', 'startedBy']);
  assert.deepEqual(latestStart(f.seq).files, []);
});

test('Changed since the run started lists file lines; Undo turns the feature switches back, not the bodies', async () => {
  reset();
  const f = readyFeature();
  const [a, b] = await withFiles(f, [file('a.md', 'a'), file('b.md', 'b')]);
  updateAttachment(a.id, { sendWithRun: true });
  await call('POST', `/api/requirements/${f.seq}/start`, {});
  await call('PATCH', `/api/requirements/${f.seq}/attachments/${a.id}`, { sendWithRun: false });
  const v = (await call('PATCH', `/api/requirements/${f.seq}/attachments/${b.id}`, { sendWithRun: true })).json.feature;
  assert.deepEqual(v.changedSinceStart, [{ kind: 'file', change: 'added', name: 'b.md' }, { kind: 'file', change: 'removed', name: 'a.md' }]);
  const u = (await call('POST', `/api/requirements/${f.seq}/revert`, { version: 1 })).json.feature;
  assert.deepEqual(u.attachments.map((x) => [x.name, x.sendWithRun]), [['a.md', true], ['b.md', false]]);
  assert.deepEqual(u.changedSinceStart, []);
});

test('Start sees the files no round asked about (D8): Interview finished fails, so a start needs a reason', async () => {
  reset();
  const f = readyFeature();
  updateFeature(f.seq, { status: 'your_turn' });
  addAttachments({ type: 'feature', id: f.seq }, [file('late.md', 'late')], {}, MOCK);
  await readsSettled({ type: 'feature', id: f.seq });
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });   // a round that did not carry the file
  updateFeature(f.seq, { status: 'done' });
  const no = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.deepEqual([no.status, no.json.failing], [409, ['interview']]);
  assert.equal(calls.length, 0);
  const go = await call('POST', `/api/requirements/${f.seq}/start`, { reason: 'the file repeats the description' });
  assert.equal(go.status, 201, JSON.stringify(go.json));
  assert.deepEqual([latestStart(f.seq).ready, latestStart(f.seq).failing], [false, ['interview']]);
});

test('a switched-on file Worca cannot open refuses the start, naming it; a file whose read failed still goes', async () => {
  const refusal = (name) => `${name} cannot go with the run: Worca could not open the stored file. Replace it, or leave it out of the run.`;
  const f = readyFeature();
  const [a, b, c, e] = await withFiles(f, [file('a.md', 'a'), file('b.md', 'b'), file('c.md', 'c'), file('e.md', 'e')]);
  for (const r of [a, b, c, e]) updateAttachment(r.id, { sendWithRun: true });
  const body = (r) => attachmentFile(getAttachment(r.id));
  const tries = [
    // a replace whose new body could not be stored (D11): the row is STORE_FAILED, and whatever is on disk is not its version
    [a, () => updateAttachment(a.id, { status: 'failed', error: { code: 'STORE_FAILED', message: 'Worca could not store the new version. Replace it again.', at: 'now' } }),
      () => updateAttachment(a.id, { status: 'done', error: null })],
    [b, () => rmSync(body(b)), () => writeFileSync(body(b), 'b')],                // the body is gone
    [c, () => writeFileSync(body(c), 'cc'), () => writeFileSync(body(c), 'c')],   // the body is not the row's (another size)
  ];
  for (const [r, spoil, mend] of tries) {
    reset();
    spoil();
    const no = await call('POST', `/api/requirements/${f.seq}/start`, {});
    assert.deepEqual([no.status, no.json], [409, { error: refusal(r.name) }], r.name);
    assert.doesNotMatch(JSON.stringify(no.json), /[\\/]/, 'never a path');
    assert.deepEqual([calls.length, latestStart(f.seq)], [0, null], 'nothing started, nothing stored');
    mend();
  }
  reset();
  updateAttachment(e.id, { status: 'failed', error: { code: 'FAILED', message: 'Worca could not read it. Try again.', at: 'now' } });
  const go = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(go.status, 201, JSON.stringify(go.json));
  assert.deepEqual(calls[0].opts.extrasFiles.map((x) => x.name), ['a.md', 'b.md', 'c.md', 'e.md']);
});

test("after a start: a document's switch is no change and Undo leaves it; a feature file replaced or removed is, and stays so", async () => {
  reset();
  const f = readyFeature();
  const [a, b] = await withFiles(f, [file('a.md', 'a'), file('b.md', 'b')]);
  updateAttachment(a.id, { sendWithRun: true });
  updateAttachment(b.id, { sendWithRun: true });
  try {
    const [g, h] = await briefWith([file('g.md', 'g'), file('h.md', 'h')], ['g.md']);
    assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, {})).status, 201);
    assert.deepEqual(latestStart(f.seq).files.map((x) => [x.name, x.from]), [['a.md', 'feature'], ['b.md', 'feature'], ['g.md', 'brief']]);
    updateAttachment(g.id, { sendWithRun: false });   // the documents' switches: a setting of the whole scope
    updateAttachment(h.id, { sendWithRun: true });
    assert.deepEqual((await call('GET', `/api/requirements/${f.seq}`)).json.feature.changedSinceStart, []);
    const own = { type: 'feature', id: f.seq };
    replaceAttachment(own, a.id, file('a-v2.md', 'a2'), {}, MOCK);
    await readsSettled(own);
    removeAttachment(own, b.id, {}, MOCK);
    const lines = [{ kind: 'file', change: 'replaced', name: 'a-v2.md' }, { kind: 'file', change: 'removed', name: 'b.md' }];
    assert.deepEqual((await call('GET', `/api/requirements/${f.seq}`)).json.feature.changedSinceStart, lines);
    await call('PATCH', `/api/requirements/${f.seq}/attachments/${a.id}`, { sendWithRun: false });
    const u = (await call('POST', `/api/requirements/${f.seq}/revert`, { version: 1 })).json.feature;
    assert.deepEqual(u.attachments.map((x) => [x.name, x.sendWithRun]), [['a-v2.md', true]], 'the switch goes back; the body stays the new one');
    assert.deepEqual(u.changedSinceStart, lines, 'Undo cannot bring back a removed or replaced body');
    assert.deepEqual(u.briefDocuments.map((x) => [x.name, x.sendWithEveryRun]), [['g.md', false], ['h.md', true]], "the documents' switches stay");
    assert.equal(listTurns(f.seq).filter((t) => t.kind === 'followup').length, 0, 'no follow-up round after a start');
  } finally { dropBrief(); }
});

test('Start again with v2 sends the files switched on now and records them', async () => {
  reset();
  const f = readyFeature();
  const [a, b] = await withFiles(f, [file('a.md', 'a'), file('b.md', 'b')]);
  updateAttachment(a.id, { sendWithRun: true });
  await call('POST', `/api/requirements/${f.seq}/start`, {});
  updateAttachment(a.id, { sendWithRun: false });
  updateAttachment(b.id, { sendWithRun: true });
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.deepEqual([r.status, r.json.version], [201, 2]);
  assert.deepEqual(calls.map((c) => c.opts.extrasFiles.map((x) => x.name)), [['a.md'], ['b.md']]);
  assert.deepEqual(r.json.feature.starts.map((s) => [s.version, s.files.map((x) => x.name)]), [[2, ['b.md']], [1, ['a.md']]]);
  assert.deepEqual(r.json.feature.changedSinceStart, [], 'compared with the newest start');
});

// ---- A6 D15: Report back ----
const linkTicket = (seq) => saveExportLink(seq, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', trackerProject: 'SHOP', key: 'SHOP-123',
  url: 'https://acme.test/browse/SHOP-123', createdAt: '2026-10-26T10:42:00.000Z', exportedAt: '2026-10-26T10:42:00.000Z', spec: readySpec(), fingerprint: 'f' });

test('A6 D15: a feature with a ticket reports back by default: reportTo names the link\'s own connection and turns write-back on', async () => {
  reset();
  const f = readyFeature({ title: 'Report me' });
  linkTicket(f.seq);
  const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(calls[0].opts.reportTo, { plugin: 'jira-source', sourceId: 'jira', profile: 'acme', taskId: 'SHOP-123',
    url: 'https://acme.test/browse/SHOP-123', title: 'Report me', inputs: { writeBack: 'yes' } });
  assert.equal(calls[0].body.promptMarkdown.includes('# FEAT-'), true, 'the task is still the spec');
});

test('A6 D15: reportBack false sends no reportTo; no ticket sends none; a non-boolean is 400', async () => {
  reset();
  const f = readyFeature({ title: 'Quiet' });
  linkTicket(f.seq);
  assert.equal((await call('POST', `/api/requirements/${f.seq}/start`, { reportBack: false })).status, 201);
  assert.equal('reportTo' in calls[0].opts, false);
  reset();
  const g = readyFeature({ title: 'No ticket' });
  assert.equal((await call('POST', `/api/requirements/${g.seq}/start`, { reportBack: true })).status, 201);
  assert.equal('reportTo' in calls[0].opts, false);
  reset();
  const h = readyFeature({ title: 'Bad flag' });
  const bad = await call('POST', `/api/requirements/${h.seq}/start`, { reportBack: 'yes' });
  assert.deepEqual([bad.status, bad.json.error, calls.length], [400, 'reportBack must be true or false', 0]);
});

test('A6 D13: Start is refused while the feature is being exported', async () => {
  reset();
  const f = readyFeature({ title: 'Exporting' });
  markExporting(f.seq);
  try {
    const r = await call('POST', `/api/requirements/${f.seq}/start`, {});
    assert.deepEqual([r.status, r.json.error, calls.length], [409, 'Worca is exporting this feature. Try again in a moment.', 0]);
  } finally { unmarkExporting(f.seq); }
});
