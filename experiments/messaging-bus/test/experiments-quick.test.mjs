// T-quick: every experiment script in --quick mode: exit 0 in budget, documented JSON, correctness flags.
// Performance thresholds are machine-dependent and judged in RESULTS.md, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'bus-quick-'));
test.after(() => rmSync(out, { recursive: true, force: true }));

function runScript(name, budgetMs, extra = []) {
  const file = join(out, `${name}${extra.join('')}.json`);
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [join(ROOT, `${name}.mjs`), '--quick', ...extra, '--out', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error(`${name} over ${budgetMs} ms\n${stderr}`)); }, budgetMs);
    c.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${name} exit ${code}\n${stderr}`));
      const lines = stdout.trim().split('\n');
      assert.equal(lines.length, 1, 'one JSON line on stdout');
      const line = JSON.parse(lines[0]);
      const json = JSON.parse(readFileSync(file, 'utf8'));
      assert.deepEqual(line, json.summary);
      resolve(json);
    });
  });
}

function assertDead(pids) {
  for (const pid of pids) {
    assert.throws(() => process.kill(pid, 0), (e) => e.code === 'ESRCH', `pid ${pid} still alive`);
  }
}

test('e1 --quick: a crash mid-row: transactional duplicates nothing, naive duplicates that row', { timeout: 60_000 }, async () => {
  const r = await runScript('e1-outbox-bench', 60_000);
  const s = r.summary;
  for (const k of ['e1.publish.single.msgsPerSec', 'e1.publish.batch100.msgsPerSec', 'e1.publish.twoWriters.msgsPerSec',
    'e1.latency.poll-50.p99Ms', 'e1.latency.watch.p99Ms', 'e1.latency.emitter.p99Ms', 'e1.prune.ms']) {
    assert.equal(typeof s[k], 'number', k);
  }
  assert.equal(s['e1.publish.twoWriters.seqGapFree'], true);
  assert.equal(s['e1.restart.transactional.lost'], 0);
  assert.equal(s['e1.restart.transactional.duplicateEffects'], 0);
  assert.equal(s['e1.restart.naive.lost'], 0);
  // the child dies after one row's effect and before its ack/commit: only the naive kind repeats that effect
  assert.equal(s['e1.restart.naive.duplicateEffects'], 1);
  for (const kind of ['transactional', 'naive']) {
    assert.equal(r.restart[kind].firstRun, 'killed', kind);
    assert.equal(s[`e1.restart.${kind}.redeliveries`], 1, kind);
  }
  assert.ok(r.pids.length >= 5);
  assertDead(r.pids);
});

test('e2 --quick: an empty mailbox injects 0 bytes; a burst is delivered whole, once', { timeout: 60_000 }, async () => {
  const r = await runScript('e2-mailbox-tokens', 60_000);
  const s = r.summary;
  assert.equal(s['e2.none.hook.totalBytes'], 0);
  assert.ok(s['e2.none.mcp-poll.totalTokens'] > 0);
  assert.equal(s['e2.burst.hook.allDelivered'], true);
  assert.equal(s['e2.burst.hook.maxShowsPerId'], 1);
  assert.ok(s['e2.burst.hook.maxDelayCalls'] <= 2);
  for (const k of ['e2.steady.hook.totalTokens', 'e2.steady.hook.headerOverheadTokens', 'e2.hook.p99Ms']) assert.equal(typeof s[k], 'number', k);
  for (const run of r.runs) {
    if (run.mode === 'step-start') continue;
    assert.equal(run.idsDelivered, run.idsPublished, `${run.schedule}/${run.mode}`);
    assert.equal(run.maxShowsPerId, run.idsPublished ? 1 : 0, `${run.schedule}/${run.mode}`);
  }
});

test('e3 --quick: 12 cases, measured = predicted, every arm correct, sub-agents synced', { timeout: 120_000 }, async () => {
  const r = await runScript('e3-contract-change', 120_000);
  const s = r.summary;
  assert.equal(s['e3.cases'], 12);
  assert.equal(s['e3.allMeasuredEqualsPredicted'], true);
  assert.equal(s['e3.allCorrect'], true);
  assert.equal(s['e3.ignoreEqualsReview'], true);
  assert.equal(s['e3.subagents.deliveredOnce'], true);
  assert.equal(s['e3.subagents.selfShows'], 0);
  assert.equal(s['e3.subagents.cursorsUnmovedByA'], true);
  assert.equal(s['e3.subagents.reworkEqualsDecompose'], true);
  assert.equal(s['e3.busAct.reviewCycles'], 0);
  for (const c of r.cases.filter((x) => x.topology === 'subagents' && x.arm !== 'review')) {
    assert.equal(c.deliveries.A, 0);
    assert.equal(c.deliveries.B, 1);
    assert.equal(c.deliveries.C, 1);
    if (c.arm === 'bus-act') assert.equal(c.deliveries.D, 1);
  }
});

test('e4 --quick: 0 loss, 0 re-pulled rows, 0 order violations, refused requests change nothing', { timeout: 60_000 }, async () => {
  const r = await runScript('e4-two-host', 60_000);
  const s = r.summary;
  for (const k of ['e4.partition.loss', 'e4.partition.rePulled', 'e4.partition.orderViolations', 'e4.crash.loss', 'e4.crash.rePulled',
    'e4.total.loss', 'e4.total.rePulled', 'e4.total.orderViolations', 'e4.auth.rowsChanged']) {
    assert.equal(s[k], 0, k);
  }
  // the seam killed B inside the 3rd page's ingest (100-row pages): pages 1-2 committed, page 3 rolled back
  assert.equal(r.crash.killedBySeam, true);
  assert.equal(s['e4.crash.rowsAtKill'], 200);
  assert.equal(s['e4.auth.refused'], s['e4.auth.requests']);
  assert.ok(s['e4.auth.requests'] > 0);
  assert.equal(typeof s['e4.steady.lagP99Ms'], 'number');
  assert.equal(typeof s['e4.partition.catchUpMs'], 'number');
  assert.ok(r.pids.length >= 3);
  assertDead(r.pids);
});

test('e4 --quick --split-cursor: a cursor outside the ingest transaction re-pulls the crashed page', { timeout: 60_000 }, async () => {
  const r = await runScript('e4-two-host', 60_000, ['--split-cursor']);
  const s = r.summary;
  assert.equal(r.crash.killedBySeam, true);
  assert.equal(s['e4.crash.rowsAtKill'], 300);
  assert.equal(s['e4.crash.rePulled'], 100);
  assert.equal(s['e4.crash.loss'], 0);
  assertDead(r.pids);
});

test('e5 --quick: detector precision/recall numbers, 0 leaks, the behaviour cases', { timeout: 180_000 }, async () => {
  const r = await runScript('e5-detector', 180_000);
  const s = r.summary;
  for (const k of ['e5.cases.contract', 'e5.cases.ordinary', 'e5.precision', 'e5.recall', 'e5.falsePositiveRate', 'e5.maxBodyChars',
    'e5.maxDataBytes', 'e5.addedMs.edit.p50', 'e5.addedMs.edit.p99', 'e5.addedMs.bash.p50', 'e5.addedMs.bash.p99', 'e5.inProcessMs.p99']) {
    assert.equal(typeof s[k], 'number', k);
  }
  assert.equal(s['e5.secretLeaks'], 0);
  assert.equal(s['e5.dedup.publishes'], 1);
  assert.equal(s['e5.revert.publishes'], 2);
  assert.equal(s['e5.revert.lastReverted'], true);
  assert.equal(s['e5.debounce.messages'], 2);
  assert.equal(s['e5.stateMatchesFinal'], true);
  assert.ok(s['e5.loop.maxHop'] <= 2);
  assert.ok(s['e5.maxBodyChars'] <= 600);
  assert.ok(s['e5.maxDataBytes'] <= 1024);
});

test('e6 --quick: the detector-triggered E3 grid equals the scripted one, with no false publishes', { timeout: 180_000 }, async () => {
  const r = await runScript('e6-detector-e3', 180_000);
  const s = r.summary;
  assert.equal(s['e6.cases'], 12);
  assert.equal(s['e6.equalsScripted'], true);
  assert.equal(s['e6.falsePublishes'], 0);
  assert.equal(s['e6.selfShows'], 0);
  assert.equal(s['e6.allCorrect'], true);
  assert.ok(s['e6.busAct.maxLeadTime'] <= 1);
  assert.equal(s['e6.autoPublishes.perCase'], 1);
  assert.equal(typeof s['e6.meanBodyTokens'], 'number');
});

// E7 seeds its tree from this repository's history; a shallow clone or a copy without it cannot run it.
const REPLAY = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'test', 'fixtures', 'replay-decompose.json.gz'))).toString('utf8'));
const firstBase = REPLAY.files.find((f) => f.baseBlob)?.baseBlob;
const basesHere = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', firstBase]).status === 0;

test('e7 --quick: phase 2 replayed on the real base blobs: a valid replay, no leaks, no lifecycle shown to its own step',
  { timeout: 180_000, skip: basesHere ? false : `base blob ${firstBase} is not in this repository (shallow clone?)` }, async () => {
    const r = await runScript('e7-noise', 180_000);
    const s = r.summary;
    assert.equal(s['e7.lifecycleShownToOwnStep'], 0);
    assert.equal(s['e7.secretLeaks'], 0);
    assert.equal(s['e7.detectErrors'], 0);
    assert.ok(Object.hasOwn(s, 'e7.replay.unapplied'));
    assert.equal(s['e7.replay.unapplied'], 0);
    assert.equal(s['e7.replay.baseMissing'], 0);
    assert.equal(s['e7.replay.finalMismatch'], 0);
    assert.equal(s['e7.replay.degraded'], false);
    assert.ok(s['e7.replay.armedCalls'] > 0);
    for (const k of ['e7.layer1.messages', 'e7.layer2.messages', 'e7.perReader.meanTokens', 'e7.perReader.maxTokens', 'e7.headerTokensPerMessage', 'e7.layer3.promptTokens']) {
      assert.equal(typeof s[k], 'number', k);
    }
    assert.ok(Array.isArray(r.layer2));
  });
