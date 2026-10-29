// test/api-run-sessions.test.mjs — every session of a run, and its raw trace, over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, appendFile, symlink, link, chmod, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { createSessionTrace, sessionsReport, sessionReport, reconcileMismatches, TRACE_READ_MAX } from '../src/core/session-trace.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
let srv, base, home, runId, plainId;
const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-sess-api-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_FLAGS']) prev[k] = process.env[k];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_MOCK: '1', WORCA_FLAGS: 'sessionGroups' });
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_sess_api', name: 'Sess API' });
  const o = createOrchestrator({ projectDir: gitDir('sess-api'), workflowId: 'wf_sess_api', prompt: 'demo', auto: true, claude: { mock: true } });
  assert.equal((await o.run()).status, 'done');
  runId = o.getState().id;
  const p = createOrchestrator({ projectDir: gitDir('sess-api-plain'), prompt: 'demo', auto: true, claude: { mock: true } });
  await p.run(); plainId = p.getState().id;
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => setTimeout(r, 500).unref?.())]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true }).catch(() => {});
});

test('GET /sessions: the summary, one turn row per dispatch, history, reconcile', async () => {
  const r = await fetch(`${base}/api/runs/${runId}/sessions`);
  assert.equal(r.status, 200);
  const { sessions } = await r.json();
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.sid, SID);
  assert.equal(s.mode, 'subagents', 'v4: the members ran hosted (a 0-turn separate session passes every row below)');
  assert.ok(s.turns > 0, 'v4: at least one host turn');
  assert.equal(typeof s.turns, 'number', 'the Summary count');
  assert.equal(s.turnRows.length, s.turns);
  assert.ok(s.turnRows.every((t) => t.dispatchId && t.memberAgentId));
  assert.deepEqual(Object.keys(s.reconcile), ['ok', 'mismatches']);
  assert.deepEqual(s.integrity, { torn: 0, invalid: 0, seqGaps: 0 });
});

test('GET /sessions on a run without one: an empty list; an unknown run: 404', async () => {
  assert.deepEqual(await (await fetch(`${base}/api/runs/${plainId}/sessions`)).json(), { sessions: [] });
  assert.equal((await fetch(`${base}/api/runs/nope/sessions`)).status, 404);
});

test('GET /sessions/:sid/trace streams ndjson; a bad sid is 400', async () => {
  const r = await fetch(`${base}/api/runs/${runId}/sessions/${SID}/trace`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/x-ndjson/);
  const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].kind, 'open');
  assert.equal((await fetch(`${base}/api/runs/${runId}/sessions/..%2F..%2Fetc/trace`)).status, 400);
});

// ── v2: the report's own rules (no server), the flag, and path safety on the raw route ──

async function writeTrace(dir, sid, recs, { tail = '', at = {} } = {}) {
  let ts = '2026-10-28T10:00:00.000Z';                       // `at[kind]`: that record's time (every host opens in the same ms)
  const t = createSessionTrace({ pipelineDir: dir, sid, runId: 'r1', now: () => ts });
  for (const [kind, f] of recs) { ts = at[kind] ?? '2026-10-28T10:00:00.000Z'; t.append(kind, f); }
  await t.flush();
  if (tail) await appendFile(join(dir, 'sessions', sid, 'trace.ndjson'), tail);
}

test('v2 — sessionsReport: failed checks (turn and epoch, once each), skipped lines, odd dirs, links, order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-sess-report-'));
  try {
    const epochBad = { epoch: 1, harnessTotalUsd: 1.2, bookedUsd: 0.9, tolerance: 0.024, ok: false };
    const epochOk = { epoch: 2, harnessTotalUsd: 0.5, bookedUsd: 0.5, tolerance: 0.01, ok: true };
    await writeTrace(dir, 's_bbbbbbbb', [['open', { engine: 'claude', mode: 'subagents', label: 'B', members: ['n_a', 'n_b'] }],
      ['turn_start', { turnId: 't:s_bbbbbbbb:1' }],
      ['reconcile', { turnId: 't:s_bbbbbbbb:1', ok: false, checks: [{ method: 'hook', harnessUsd: 0.4, otherUsd: 0.5, tolerance: 0.008, ok: false }, { method: 'estimate', harnessUsd: 0.4, otherUsd: 0.41, tolerance: 0.06, ok: true }] }],
      ['rotate', { reason: 'dispatches', fromEpoch: 1, epochCheck: epochBad }],
      ['close', { status: 'done', epochChecks: [epochBad, epochOk], reconciled: false }]],
    { tail: '{"torn\n' + JSON.stringify({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 6, kind: 'open', prompt: 'leak' }) + '\n'
      + JSON.stringify({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 9, kind: 'pause', runId: 'r1', sid: 's_bbbbbbbb', hostEpoch: 1, hostSessionId: 'H', reason: 'manual' }) + '\n' });
    await writeTrace(dir, 's_aaaaaaaa', [['open', { engine: 'claude', mode: 'separate', label: 'A', members: ['n_c', 'n_d'] }]]);
    await mkdir(join(dir, 'sessions', 'not-a-sid'), { recursive: true });
    await writeFile(join(dir, 'sessions', 'not-a-sid', 'trace.ndjson'), '{}\n');
    await mkdir(join(dir, 'sessions', 's_cccccccc'), { recursive: true });                 // no trace yet
    await mkdir(join(dir, 'sessions', 's_dddddddd'), { recursive: true });
    await writeFile(join(dir, 'secret.ndjson'), '{"v":1}\n');
    await symlink(join(dir, 'secret.ndjson'), join(dir, 'sessions', 's_dddddddd', 'trace.ndjson'));   // a planted link
    await mkdir(join(dir, 'sessions', 's_eeeeeeee'), { recursive: true });
    await writeFile(join(dir, 'sessions', 's_eeeeeeee', 'trace.ndjson'), 'torn only\n');
    await writeTrace(join(dir, 'elsewhere'), 's_gggggggg', [['open', { engine: 'claude', mode: 'subagents', label: 'G', members: [] }]]);
    await symlink(join(dir, 'elsewhere', 'sessions', 's_gggggggg'), join(dir, 'sessions', 's_gggggggg'));   // a linked sid folder
    await writeTrace(dir, 's_hhhhhhhh', [['open', { engine: 'claude', mode: 'subagents', label: 'H', members: [] }]]);
    await chmod(join(dir, 'sessions', 's_hhhhhhhh', 'trace.ndjson'), 0o000);                                 // exists, cannot be read
    await writeTrace(dir, 's_00000000', [['open', { engine: 'claude', mode: 'subagents', label: 'Z', members: ['n_e', 'n_f'] }], ['turn_start', { turnId: 't:s_00000000:1' }]],
      { at: { turn_start: '2026-10-28T10:05:00.000Z' } });                                                     // opened with the others, ran later
    await writeTrace(dir, 's_iiiiiiii', [['open', { engine: 'claude', mode: 'subagents', label: 'I', members: [] }]]);
    await truncate(join(dir, 'sessions', 's_iiiiiiii', 'trace.ndjson'), TRACE_READ_MAX + 1);                 // a planted giant file (sparse)
    await writeTrace(dir, 's_jjjjjjjj', [['open', { engine: 'claude', mode: 'subagents', label: 'J', members: [] }]]);
    await chmod(join(dir, 'sessions', 's_jjjjjjjj'), 0o000);                                                  // v4: a folder that cannot be read
    await mkdir(join(dir, 'sessions', 's_kkkkkkkk'), { recursive: true });
    await link(join(dir, 'secret.ndjson'), join(dir, 'sessions', 's_kkkkkkkk', 'trace.ndjson'));               // v4: a planted hard link

    const { sessions } = await sessionsReport(dir);
    const root = process.getuid?.() === 0;                     // root reads a 000 file
    assert.deepEqual(sessions.map((x) => x.sid), root ? ['s_bbbbbbbb', 's_00000000', 's_aaaaaaaa', 's_hhhhhhhh', 's_jjjjjjjj', 's_eeeeeeee', 's_iiiiiiii'] : ['s_bbbbbbbb', 's_00000000', 's_aaaaaaaa', 's_eeeeeeee', 's_hhhhhhhh', 's_iiiiiiii', 's_jjjjjjjj'],
      'the ones that ran by their first turn, then the rest by the open, then by sid; unstarted last; no link (at the name, a folder, or a hard link), no non-sid dir, no empty dir');
    const by = (sid) => sessions.find((x) => x.sid === sid);
    const unchecked = (x) => [x.reconciled, x.reconcile.ok, x.reconcile.mismatches.length];
    if (!root) {
      assert.deepEqual(by('s_hhhhhhhh').integrity, { torn: 0, invalid: 0, seqGaps: 0, unreadable: true }, 'an unreadable trace is listed, the report does not fail');
      assert.deepEqual(unchecked(by('s_hhhhhhhh')), [null, null, 0], 'an unreadable trace was never checked: not "reconciled"');
      assert.equal(by('s_jjjjjjjj').integrity.unreadable, true, 'v4: a folder that cannot be read is listed, not dropped');
    }
    assert.deepEqual([by('s_iiiiiiii').integrity.unreadable, ...unchecked(by('s_iiiiiiii'))], [true, null, null, 0], 'over TRACE_READ_MAX: listed, never parsed');
    assert.deepEqual(unchecked(by('s_eeeeeeee')), [null, null, 0], 'no valid line: nothing checked');
    assert.deepEqual(unchecked(by('s_aaaaaaaa')), [true, true, 0]);
    const b = by('s_bbbbbbbb');
    assert.deepEqual(b.reconcile, { ok: false, mismatches: [
      { turnId: 't:s_bbbbbbbb:1', method: 'hook', harnessUsd: 0.4, otherUsd: 0.5 },
      { turnId: null, method: 'epoch', harnessUsd: 1.2, otherUsd: 0.9, epoch: 1 }] }, 'the epoch the close repeats is listed once, with its number');
    assert.deepEqual(b.integrity, { torn: 1, invalid: 1, seqGaps: 1 }, 'a torn line, a forged line (forbidden key) and the gap it leaves');
    assert.equal(b.reconciled, false);
    assert.deepEqual(b.history.map((h) => h.kind), ['rotate', 'pause'], 'the line after the gap is read');
    assert.equal(JSON.stringify(sessions).includes('leak'), false, 'a forged line is counted, never shown');
    assert.deepEqual([by('s_eeeeeeee').integrity.torn, by('s_eeeeeeee').turns], [1, 0], 'a session with no valid line keeps its dir name');
    assert.deepEqual(await sessionsReport(join(dir, 'nope')), { sessions: [] });
    const other = join(dir, 'other-run');
    await mkdir(other);
    await symlink(join(dir, 'sessions'), join(other, 'sessions'));                                             // a linked sessions folder
    assert.deepEqual(await sessionsReport(other), { sessions: [] }, 'another run\'s sessions are not this run\'s');
    const looped = join(dir, 'looped-run');
    await mkdir(looped);
    await symlink('sessions', join(looped, 'sessions'));                                                       // v5: a link loop
    assert.deepEqual(await sessionsReport(looped), { sessions: [] }, 'v5: a sessions link loop is no session, not a failed report');
    const budget = join(dir, 'budget-run');                    // v5: TRACE_READ_MAX is the whole report's budget
    await writeTrace(budget, 's_mmmmmmmm', [['open', { engine: 'claude', mode: 'subagents', label: 'M', members: [] }]]);
    for (const sid of ['s_nnnnnnnn', 's_oooooooo']) {
      await writeTrace(budget, sid, [['open', { engine: 'claude', mode: 'subagents', label: sid, members: [] }]]);
      await truncate(join(budget, 'sessions', sid, 'trace.ndjson'), Math.floor(TRACE_READ_MAX * 0.6));       // each under the cap
    }
    const big = (await sessionsReport(budget)).sessions;
    assert.deepEqual(big.filter((x) => x.integrity.unreadable).length, 1, 'v5: two traces at 60% of the cap: the second is listed unreadable, never read');
    assert.equal(big.find((x) => x.sid === 's_mmmmmmmm').integrity.unreadable, undefined, 'v5: a small trace is still read');
    assert.deepEqual(reconcileMismatches([{ kind: 'reconcile', turnId: 't', ok: true, checks: [] }]), []);
    const resumedClose = reconcileMismatches([                 // closed, crashed, resumed from the closed snapshot, closed again
      { kind: 'close', hostEpoch: 1, epochChecks: [{ epoch: 1, harnessTotalUsd: 1, bookedUsd: 0.5, tolerance: 0.02, ok: false }] },
      { kind: 'resume', hostEpoch: 1, after: 'crash' },
      { kind: 'close', hostEpoch: 1, epochChecks: [{ epoch: 1, harnessTotalUsd: 0, bookedUsd: 0, tolerance: 0.001, ok: true }] }]);
    assert.deepEqual(resumedClose, [{ turnId: null, method: 'epoch', harnessUsd: 1, otherUsd: 0.5, epoch: 1 }], 'a failed epoch check sticks');
    const lost = sessionReport({ records: [{ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind: 'open', sid: 's_llllllll', engine: 'claude', mode: 'subagents', members: [] },
      { v: 1, ts: '2026-10-28T10:00:01.000Z', seq: 2, kind: 'turn_start', sid: 's_llllllll', turnId: 't:s_llllllll:1' },
      { v: 1, ts: '2026-10-28T10:01:00.000Z', seq: 4, kind: 'close', sid: 's_llllllll', status: 'done', reconciled: false }], seqGaps: 1 });
    assert.deepEqual([lost.reconciled, lost.reconcile.ok], [false, false], 'v4: the close says not reconciled (its failed record was lost): never "reconciled"');
  } finally {
    await chmod(join(dir, 'sessions', 's_jjjjjjjj'), 0o755).catch(() => {});
    await chmod(join(dir, 'sessions', 's_hhhhhhhh', 'trace.ndjson'), 0o644).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('v2 — the routes are not flag-gated; the trace route answers 404 for an unknown run, an unknown sid and a planted link', async () => {
  const flags = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try {
    const r = await fetch(`${base}/api/runs/${runId}/sessions`);
    assert.equal(r.status, 200, 'a run made with the flag on stays inspectable');
    assert.equal((await r.json()).sessions.length, 1);
    assert.equal((await fetch(`${base}/api/runs/${runId}/sessions/${SID}/trace`)).status, 200);
  } finally { process.env.WORCA_FLAGS = flags; }
  assert.equal((await fetch(`${base}/api/runs/nope/sessions/${SID}/trace`)).status, 404);
  assert.equal((await fetch(`${base}/api/runs/${runId}/sessions/s_zzzzzzzz/trace`)).status, 404);
  const { findPipelineRowById, runDirForRow } = await import('../src/core/artifacts.mjs');
  const runDir = await runDirForRow(findPipelineRowById(plainId));
  await mkdir(join(runDir, 'sessions', 's_ffffffff'), { recursive: true });
  await symlink(join(runDir, 'run.json'), join(runDir, 'sessions', 's_ffffffff', 'trace.ndjson')).catch(() => {});
  assert.equal((await fetch(`${base}/api/runs/${plainId}/sessions/s_ffffffff/trace`)).status, 404, 'a link is never served');
  await writeFile(join(runDir, 'secret.txt'), 'SECRET\n');
  await mkdir(join(runDir, 'sessions', 's_kkkkkkkk'), { recursive: true });
  await link(join(runDir, 'secret.txt'), join(runDir, 'sessions', 's_kkkkkkkk', 'trace.ndjson'));
  assert.equal((await fetch(`${base}/api/runs/${plainId}/sessions/s_kkkkkkkk/trace`)).status, 404, 'v4: a hard link is never served');
  assert.deepEqual(await (await fetch(`${base}/api/runs/${plainId}/sessions`)).json(), { sessions: [] });
});
