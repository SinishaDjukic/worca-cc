// test/cli-sessions.test.mjs — the terminal view of a run's sessions.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { formatSessionHostLine, formatSessionsReport } from '../src/cli/render.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { getDb } from '../src/core/db.mjs';
import { projectStorePath } from '../src/core/store.mjs';
import { createSessionTrace, sessionsReport, sessionHostEvent } from '../src/core/session-trace.mjs';
import { cmdSessions } from '../src/cli/sessions.mjs';

const SID = 's_aaaaaaaa';
const ev = (transition, f = {}) => ({ sid: SID, transition, engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H', ts: 'x', ...f });

test('live lines for the transitions that matter, nothing for the rest', () => {
  assert.equal(formatSessionHostLine(ev('open')), `◇ session ${SID} · opened (sub-agents on Claude)`);
  assert.equal(formatSessionHostLine(ev('dispatch', { nodeId: 'n_impl', attempt: 2, turnId: `t:${SID}:4` }), { labelOf: () => 'Implementation' }), `◇ session ${SID} · dispatch Implementation (attempt 2, turn 4)`);
  assert.equal(formatSessionHostLine(ev('degrade', { reason: 'Cursor has no sub-agents' })), `◇ session ${SID} · runs as separate sessions — Cursor has no sub-agents`);
  assert.equal(formatSessionHostLine(ev('watchdog', { dispatchId: 'd:x:n_impl:2:a1', reason: 'SESSION_HOST_NO_DISPATCH' })), `◇ session ${SID} · dispatch d:x:n_impl:2:a1 failed — SESSION_HOST_NO_DISPATCH`);
  for (const t of ['turn_start', 'member_bound', 'member_done', 'turn_end', 'cost', 'reconcile', 'verdict']) assert.equal(formatSessionHostLine(ev(t)), null, t);
});

test('the report table', () => {
  const report = { sessions: [{ sid: SID, label: 'One session', mode: 'subagents', engine: 'claude', hostModel: null, hostSessionId: 'mock-host-1', hostEpoch: 1, turns: 1,
    turnRows: [{ turnId: `t:${SID}:1`, nodeId: 'n_impl', attempt: 1, durationMs: 0, tokens: { in: 5000, out: 700, cr: 0, cw: 0 }, memberUsd: 0, hostOverheadUsd: 0, costSource: 'harness', verdict: 'none' }],
    dispatches: 1, rotations: 0, restarts: 0, costUsd: 0, hostOverheadUsd: 0, reconciled: true, history: [], reconcile: { ok: true, mismatches: [] }, integrity: { torn: 0, invalid: 0, seqGaps: 0 } }] };
  const lines = formatSessionsReport(report, { labelOf: () => 'Implementation' }).split('\n');
  assert.equal(lines[0], `Session ${SID} · One session · sub-agents · Claude · main agent default model`);
  assert.match(lines[1], /host mock-host-1 \(epoch 1\) · 1 turn · 1 dispatch · 0 rotations · 0 restarts · \$0\.00 \(steps \$0\.00, hand-offs \$0\.00\) · reconciled/);
  assert.match(lines[3], /^ {2}1 {5}Implementation {10}1 {8}0s {8}5\.0k\/700\/0 {11}\$0\.00 {3}harness {2}none$/);
});

// ── v2: the lines the master leaves open, the unknown-cost rule, the wiring ──

test('v2 — live lines: a watchdog warning, close, resume, restart, rotate, a reasonless degrade, a separate open', async () => {
  await checkRows([
    { name: 'a warn-level watchdog prints nothing (the audit line agrees)', run: () => assert.equal(formatSessionHostLine(ev('watchdog', { dispatchId: 'd', reason: 'model-mismatch', level: 'warn' })), null) },
    { name: 'an error-level watchdog prints', run: () => assert.match(formatSessionHostLine(ev('watchdog', { dispatchId: 'd', reason: 'X', level: 'error' })), /failed — X$/) },
    { name: 'close: turns and cost', run: () => assert.equal(formatSessionHostLine(ev('close', { turns: 7, costUsd: 2.41 })), `◇ session ${SID} · closed · 7 turns · $2.41`) },
    { name: 'close: one turn, cost unknown is never $0.00', run: () => assert.equal(formatSessionHostLine(ev('close', { turns: 1, costUsd: null })), `◇ session ${SID} · closed · 1 turn · cost unknown`) },
    { name: 'a separate session: no open line, no close line without a host turn (its degrade line says it once)', run: () => {
      assert.equal(formatSessionHostLine(ev('open', { mode: 'separate' })), null);
      assert.equal(formatSessionHostLine(ev('close', { turns: 0, costUsd: null, mode: 'separate' })), null);
      assert.equal(formatSessionHostLine(ev('close', { turns: 2, costUsd: 0.5, mode: 'separate' })), `◇ session ${SID} · closed · 2 turns · $0.50`, 'degraded after two turns');
      assert.equal(formatSessionHostLine(ev('close', { turns: 0, costUsd: null })), `◇ session ${SID} · closed · 0 turns`, 'sub-agents that never dispatched');
    } },
    { name: 'resume', run: () => assert.equal(formatSessionHostLine(ev('resume', { reason: 'crash' })), `◇ session ${SID} · resumed after crash`) },
    { name: 'restart', run: () => assert.equal(formatSessionHostLine(ev('restart', { reason: 'vanished' })), `◇ session ${SID} · restarted fresh (vanished)`) },
    { name: 'rotate', run: () => assert.equal(formatSessionHostLine(ev('rotate', { reason: 'dispatches' })), `◇ session ${SID} · rotated to a fresh host (dispatches)`) },
    { name: 'degrade with no reason', run: () => assert.equal(formatSessionHostLine(ev('degrade')), `◇ session ${SID} · runs as separate sessions`) },
    { name: 'v4: the flag is named by its Labs title, never its key', run: () => assert.equal(formatSessionHostLine(ev('degrade', { reason: 'the Labs flag sessionGroups is off' })),
      `◇ session ${SID} · runs as separate sessions — the One session Labs flag is off`) },
    { name: 'open as one conversation', run: () => assert.equal(formatSessionHostLine(ev('open', { mode: 'shared' })), `◇ session ${SID} · opened (one conversation on Claude)`) },
    { name: 'pause and mode print nothing', run: () => assert.deepEqual([formatSessionHostLine(ev('pause')), formatSessionHostLine(ev('mode'))], [null, null]) },
    { name: 'a session that never had a host: no resume or restart line (every restore writes one)', run: () => {
      assert.equal(formatSessionHostLine(ev('resume', { mode: 'separate', hostSessionId: null, reason: 'pause' })), null);
      assert.equal(formatSessionHostLine(ev('restart', { mode: 'separate', hostSessionId: null, reason: 'engine-switch' })), null);
      assert.equal(formatSessionHostLine(ev('resume', { mode: 'separate', reason: 'pause' })), `◇ session ${SID} · resumed after pause`, 'degraded at runtime: its host is real');
    } },
  ]);
});

test('v2 — the sessionHost event carries what the lines need: a watchdog level, the close turns, the resume cause', () => {
  const rec = (kind, f) => ({ v: 1, ts: '2026-10-28T10:00:00.000Z', seq: 1, kind, runId: 'r', sid: SID, hostEpoch: 1, hostSessionId: 'H', ...f });
  const sum = { sid: SID, engine: 'claude', mode: 'subagents', transport: 'turns', hostEpoch: 1, hostSessionId: 'H' };
  const warn = sessionHostEvent(rec('watchdog', { turnId: 't', dispatchId: 'd', code: 'model-mismatch', level: 'warn' }), sum);
  assert.deepEqual([warn.reason, warn.level, formatSessionHostLine(warn)], ['model-mismatch', 'warn', null]);
  const close = sessionHostEvent(rec('close', { status: 'done', turns: 7, costUsd: 2.41, hostOverheadUsd: 0.06 }), sum);
  assert.equal(formatSessionHostLine(close), `◇ session ${SID} · closed · 7 turns · $2.41`);
  assert.equal(formatSessionHostLine(sessionHostEvent(rec('resume', { after: 'crash' }), sum)), `◇ session ${SID} · resumed after crash`);
  assert.equal('level' in sessionHostEvent(rec('dispatch', { turnId: 't', dispatchId: 'd' }), sum), false, 'only a watchdog carries a level');
});

test('v2 — the report: unknown cost, a failed check, skipped trace lines, history, a separate session', () => {
  const row = { turnId: `t:${SID}:2`, nodeId: 'n_review', attempt: 1, durationMs: 131000, tokens: { in: 3000, out: 400, cr: 100, cw: 20 }, memberUsd: 0.65, hostOverheadUsd: 0.03, costSource: 'harness', verdict: 'blocking', issues: 2 };
  const s = { sid: SID, label: 'Build', mode: 'subagents', engine: 'claude', hostModel: 'claude-haiku-4-5', hostSessionId: 'H', hostEpoch: 2, turns: 2, dispatches: 3, rotations: 1, restarts: 1,
    turnRows: [row, { ...row, turnId: `t:${SID}:3`, memberUsd: null, hostOverheadUsd: null, costSource: 'none', tokens: null, durationMs: null, verdict: null }],
    costUsd: 0.68, hostOverheadUsd: 0.03, history: [{ kind: 'rotate', reason: 'dispatches' }, { kind: 'pause', reason: 'pause' }, { kind: 'resume', reason: 'pause' }, { kind: 'degrade', reason: null }],
    reconcile: { ok: false, mismatches: [{ turnId: `t:${SID}:2`, method: 'estimate', harnessUsd: 0.65, otherUsd: 0.9 }, { turnId: null, method: 'epoch', harnessUsd: 1.2, otherUsd: 1.2004, epoch: 1 }] },
    integrity: { torn: 1, invalid: 2, seqGaps: 0 } };
  const lines = formatSessionsReport({ sessions: [s] }, { labelOf: (id) => ({ n_review: 'Review' })[id] }).split('\n');
  assert.equal(lines[0], `Session ${SID} · Build · sub-agents · Claude · main agent claude-haiku-4-5`);
  assert.equal(lines[1], '  host H (epoch 2) · 2 turns · 3 dispatches · 1 rotation · 1 restart · $0.68 (steps $0.65, hand-offs $0.03) · not reconciled');
  // Task 66: one conversation has no main agent: neither its model nor a hand-off split is printed; it names its
  // conversation, and it has no dispatch or rotation to count (v4).
  const shared = formatSessionsReport({ sessions: [{ ...s, mode: 'shared', hostOverheadUsd: 0 }] }, { labelOf: (id) => ({ n_review: 'Review' })[id] }).split('\n');
  assert.equal(shared[0], `Session ${SID} · Build · one conversation · Claude`);
  assert.equal(shared[1], '  conversation H (epoch 2) · 2 turns · 1 restart · $0.68 · not reconciled');
  const none = formatSessionsReport({ sessions: [{ ...s, mode: 'shared', hostSessionId: null, turns: 0, restarts: 0, costUsd: null, reconcile: null, reconciled: null }] }).split('\n');
  assert.equal(none[1], '  no conversation · 0 turns · 0 restarts · no turn · not checked');
  // v5: on an engine without cost its turns list no tokens either, so it is not checked, never "tokens only".
  const sharedCopilot = formatSessionsReport({ sessions: [{ ...s, mode: 'shared', engine: 'copilot', turnRows: [], reconcile: { ok: true, mismatches: [] }, history: [], integrity: {} }] }).split('\n');
  assert.match(sharedCopilot[1], / · cost unknown · not checked$/);
  assert.match(lines[3], /^ {2}2 {5}Review {18}1 {8}2m11s {5}3\.0k\/400\/120 {9}\$0\.68 {3}harness {2}blocking · 2 issues$/);
  assert.match(lines[4], /^ {2}3 {5}Review {18}1 {8}— {9}— {20}— {7}none {5}—$/, 'unknown is a dash, never $0.00');
  assert.equal(lines[5], `  ⚠ t:${SID}:2: harness $0.65 vs estimate $0.90`);
  assert.equal(lines[6], '  ⚠ host epoch 1: harness $1.2000 vs booked $1.2004', 'figures equal to the cent print four decimals');
  assert.equal(lines[7], '  ⚠ trace: 1 torn line, 2 invalid lines, 0 seq gaps (skipped lines are not shown)');
  assert.equal(lines[8], '  history: rotated to a fresh host (dispatches) · paused · resumed after pause · runs as separate sessions', 'no reason that repeats its kind, no dangling dash');
  const sep = formatSessionsReport({ sessions: [{ ...s, mode: 'separate', modeReason: 'the Labs flag is off', hostSessionId: null, turns: 0, dispatches: 0, rotations: 0, restarts: 0, turnRows: [],
    costUsd: null, hostOverheadUsd: null, history: [{ kind: 'degrade', reason: 'the Labs flag is off' }], reconcile: { ok: true, mismatches: [] }, integrity: { torn: 0, invalid: 0, seqGaps: 0 } }] }).split('\n');
  assert.deepEqual(sep, [`Session ${SID} · Build · separate sessions — the Labs flag is off · Claude`,
    '  no host session · 0 turns · 0 dispatches · 0 rotations · 0 restarts · no host turn · not checked'], 'no main agent, no cost of its own, its degrade (a real separate trace has one) is not repeated, and nothing was compared (v4)');
  const flagOff = formatSessionsReport({ sessions: [{ ...s, mode: 'separate', modeReason: 'the Labs flag sessionGroups is off', hostSessionId: null, turns: 0, dispatches: 0, rotations: 0, restarts: 0, turnRows: [],
    costUsd: null, hostOverheadUsd: null, history: [{ kind: 'degrade', reason: 'the Labs flag sessionGroups is off' }], reconcile: { ok: true, mismatches: [] }, integrity: {} }] }).split('\n');
  assert.equal(flagOff[0], `Session ${SID} · Build · separate sessions — the One session Labs flag is off · Claude`, 'v4: never the flag key ("never \'group\'")');
  const restored = formatSessionsReport({ sessions: [{ ...s, mode: 'separate', modeReason: 'the Labs flag is off', hostSessionId: null, turns: 0, dispatches: 0, rotations: 0, restarts: 1, turnRows: [],
    costUsd: null, hostOverheadUsd: null, reconcile: { ok: true, mismatches: [] }, integrity: {},
    history: [{ kind: 'degrade', reason: 'the Labs flag is off' }, { kind: 'pause', reason: 'pause' }, { kind: 'resume', reason: 'pause' }, { kind: 'restart', reason: 'engine-switch' }] }] }).split('\n');
  assert.deepEqual(restored.slice(1), ['  no host session · 0 turns · 0 dispatches · 0 rotations · 0 restarts · no host turn · not checked', '  history: paused'],
    'v5: a session that never had a host lists no resume or restart (every restore writes one for it)');
  const torn = formatSessionsReport({ sessions: [{ sid: SID, label: null, mode: null, engine: null, hostModel: null, hostSessionId: null, hostEpoch: 0, turns: 0, dispatches: 0, rotations: 0, restarts: 0,
    turnRows: [], costUsd: null, hostOverheadUsd: null, startedAt: null, reconciled: null, history: [], reconcile: { ok: null, mismatches: [] }, integrity: { torn: 2, invalid: 0, seqGaps: 0 } }] }).split('\n');
  assert.equal(torn[0], `Session ${SID} · One session · mode unknown`, 'no valid open: no engine, no main agent made up');
  assert.match(torn[1], / · no host turn · not checked$/, 'nothing was checked: never "reconciled"');
  assert.equal(formatSessionsReport({ sessions: [] }), '');
  const cut = formatSessionsReport({ sessions: [{ ...s, turnRows: [], hostOverheadUsd: null, costUsd: 0.12, reconcile: { ok: true, mismatches: [] }, history: [], integrity: { torn: 0, invalid: 0, seqGaps: 0 } }] }).split('\n');
  const unread = formatSessionsReport({ sessions: [{ ...s, turns: 0, dispatches: 0, rotations: 0, restarts: 0, hostSessionId: null, turnRows: [], costUsd: null, hostOverheadUsd: null, reconciled: null,
    reconcile: { ok: null, mismatches: [] }, history: [], integrity: { torn: 0, invalid: 0, seqGaps: 0, unreadable: true } }] }).split('\n');   // as Task 54 lists it
  assert.match(cut[1], /\$0\.12 \(steps \$0\.12, hand-offs unknown\)/, 'an unknown hand-off share is not $0.00 (a cut booked as an estimate)');
  assert.match(unread[1], / · not checked$/);
  assert.equal(unread[2], '  ⚠ trace: the file could not be read');
  const copilot = formatSessionsReport({ sessions: [{ ...s, engine: 'copilot', turnRows: [], reconcile: { ok: true, mismatches: [] }, history: [], integrity: {} }] }).split('\n');
  assert.match(copilot[1], / · cost unknown · tokens only$/, 'an engine without cost: no figure, no nested label, nothing compared (v4)');
  const copilotRows = formatSessionsReport({ sessions: [{ ...s, engine: 'copilot', turnRows: [{ ...row, memberUsd: 0, hostOverheadUsd: 0, costSource: 'harness' }], reconcile: { ok: true, mismatches: [] }, history: [], integrity: {} }] }).split('\n');
  assert.doesNotMatch(copilotRows[3], /\$/, 'v4: an engine without cost books $0 as harness on its turns: the row prints a dash, never $0.00');
  const big = formatSessionsReport({ sessions: [{ ...s, turnRows: [{ ...row, tokens: { in: 999960, out: 1, cr: 0, cw: 0 } }], reconcile: { ok: true, mismatches: [] }, history: [], integrity: {} }] }).split('\n');
  assert.match(big[3], / 1\.0M\/1\/0 /, 'never 1000.0k');
});

// ── cmdSessions in-process (`fail` throws here; the real one exits 2), and one spawn for the main() wiring ──
const home = useTempHome(after);
const c = (_k, x) => x;
const fail = (m) => { throw Object.assign(new Error(m), { code: 'CLI_FAIL' }); };
const failedWith = (re) => (e) => e.code === 'CLI_FAIL' && re.test(e.message);
const MANIFEST = { version: 2, graph: { nodes: [{ id: 'n_impl', kind: 'agent', label: 'Implementation' }], wires: [] } };
function seedRun(id, { trace = true, turns = 1 } = {}) {
  const iso = new Date().toISOString();
  getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at, stepper)
    VALUES (?, 'proj-s', 'project', 'sessions demo', 'done', 'plan', 1, ?, ?, ?)`).run(id, iso, iso, JSON.stringify(MANIFEST));
  const dir = join(projectStorePath('proj-s'), 'pipelines', `run-${id}`);
  mkdirSync(dir, { recursive: true });
  if (!trace) return dir;
  const t = createSessionTrace({ pipelineDir: dir, sid: SID, runId: id });
  t.append('open', { engine: 'claude', mode: 'subagents', transport: 'turns', members: ['n_impl'], label: 'One session' });
  for (let n = 1; n <= turns; n++) {
    t.append('turn_start', { hostEpoch: 1, turnId: `t:${SID}:${n}` });
    t.append('dispatch', { hostEpoch: 1, turnId: `t:${SID}:${n}`, dispatchId: `d:x:n_impl:${n}:a1`, executionId: `x:n_impl:${n}`, nodeId: 'n_impl', attempt: 1 });
    t.append('turn_end', { hostEpoch: 1, hostSessionId: 'H', turnId: `t:${SID}:${n}`, durationMs: 1000 });
    t.append('cost', { hostEpoch: 1, hostSessionId: 'H', turnId: `t:${SID}:${n}`, memberUsd: 0.4, hostOverheadUsd: 0.01, costSource: 'harness' });
  }
  return t.flush().then(() => dir);
}

test('v2 — worca sessions: an unknown run, a bad option, no sessions, the table, --json', async () => {
  const lines = [];
  const io = { out: (x) => lines.push(x), c, fail };
  await assert.rejects(cmdSessions(['zzzz9999'], io), failedWith(/^no run matches "zzzz9999"/));
  await assert.rejects(cmdSessions(['--tail'], io), failedWith(/^unknown option --tail/));
  await seedRun('5e550001', { trace: false });
  assert.equal(await cmdSessions(['5e550001'], io), 0);
  assert.deepEqual(lines.splice(0), ['Run 5e550001 has no sessions.']);
  const dir = await seedRun('5e550002');
  assert.equal(await cmdSessions(['5e550002'], io), 0);
  const text = lines.splice(0).join('\n').split('\n');
  assert.equal(text[0], `Session ${SID} · One session · sub-agents · Claude · main agent default model`);
  assert.match(text[3], /^ {2}1 {5}Implementation {10}1 {8}1s {8}—/, 'the step label comes from the run manifest');
  assert.equal(await cmdSessions(['5e550002', '--json'], io), 0);
  assert.deepEqual(JSON.parse(lines.splice(0).join('\n')), await sessionsReport(dir), 'the API report, verbatim');
  await assert.rejects(cmdSessions(['5e55000'], io), failedWith(/^"5e55000" matches 2 runs/), 'v5: an id prefix goes through resolveRunRef');
  const locked = await seedRun('5e660001');
  if (process.getuid?.() !== 0) {                              // root reads a 000 folder
    await chmod(join(locked, 'sessions'), 0o000);
    try {
      await assert.rejects(cmdSessions(['5e660001'], io), failedWith(/^the run's sessions could not be read \(EACCES\)$/), 'v5: one line, not a stack trace');
    } finally { await chmod(join(locked, 'sessions'), 0o755); }
  }
});

test('v2 — a foreground run prints its session\'s lines (the orch.on(\'sessionHost\') wiring)', { timeout: 120000 }, async () => {
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { SEED_TEMPLATES } = await import('../src/core/graph/seed-templates.mjs');
  const { gitDir } = await import('./helpers/git-dir.mjs');
  const t = structuredClone(SEED_TEMPLATES.find((x) => x.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  await writeGraphWorkflow({ ...t, id: 'wf_cli_sess', name: 'CLI sessions' });
  const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home, WORCA_FLAGS: 'sessionGroups' };
  delete env.WORCA_SESSIONS_DISABLE;                         // a developer's kill switch must not reach the child
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '..', 'src', 'cli', 'worca-cc.mjs'),
    '--project', gitDir('cli-sess'), '--prompt', 'demo', '--workflow', 'wf_cli_sess', '--mock', '--yes'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 110000 });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (b) => { stdout += b; });
  child.stderr.on('data', (b) => { stderr += b; });
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, stderr);
  assert.match(stdout, new RegExp(`◇ session ${SID} · opened \\(sub-agents on Claude\\)`));
  assert.match(stdout, new RegExp(`◇ session ${SID} · dispatch Implementation \\(attempt 1, turn 1\\)`), 'the label from the run manifest');
  assert.match(stdout, new RegExp(`◇ session ${SID} · closed · \\d+ turns · \\$`));
});

test('v2 — `worca sessions` is a subcommand (main() routes it, not a prompt)', async () => {
  const env = { ...process.env, WORCA_HOME: home, HOME: home, USERPROFILE: home };
  const cli = (...args) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, '..', 'src', 'cli', 'worca-cc.mjs'), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
  await seedRun('5e550003', { turns: 400 });                  // v5: a report past the 64 KiB pipe buffer
  const r = await cli('sessions', '5e550003', '--json');
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.length > 65536, `the report is past 64 KiB (${r.stdout.length})`);
  assert.equal(JSON.parse(r.stdout).sessions[0].turnRows.length, 400, 'v5: --json is flushed whole on a pipe (flushed), never cut at 64 KiB');
  const help = await cli('--help');
  assert.match(help.stdout, /^ {2}sessions <id> \[--json\] +A run's sessions/m, 'v5: worca --help lists the verb');
});
