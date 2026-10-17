// test/ui-runs-archive.test.mjs — the archive rules shared by the row menu, Select and the age rule
// (ui/public/runs-archive.mjs, #739). Rows are built with the real runs-list.mjs row builders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { histRow, liveRow, schedRow } from '../ui/public/runs-list.mjs';
import { archiveBlock, canArchive, archivePlan, archiveConfirm, missedLine, olderThan, archiveEach, archiveReport, rowMenuItems, nothingToArchive } from '../ui/public/runs-archive.mjs';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const DAY = 86400000;
const hist = (id, extra = {}) => histRow({ id, projectKey: 'proj-0000abcd', title: id, status: 'done', startedAt: NOW - DAY, mtime: NOW - DAY, ...extra }, NOW);
const live = (runId, extra = {}) => liveRow({ runId, pipelineId: `p-${runId}`, title: runId, status: 'running', startedAt: NOW, ...extra }, NOW);

test('eligible: finished, stopped, failed and merged runs; a finished live run too', () => {
  assert.equal(canArchive(hist('done')), true);
  assert.equal(canArchive(hist('stopped', { status: 'stopped' })), true);
  assert.equal(canArchive(hist('failed', { status: 'error' })), true);
  assert.equal(canArchive(hist('merged', { pr: { state: 'MERGED', number: 7 } })), true);
  assert.equal(canArchive(live('r1', { status: 'done' })), true);
});

test('never eligible: live, paused, waiting, scheduled, retained work, archived', () => {
  assert.equal(archiveBlock(live('r2')), 'live');
  assert.equal(archiveBlock(hist('running', { status: 'running' })), 'live');
  assert.equal(archiveBlock(hist('paused', { status: 'paused', pauseReason: 'cost_pipeline' })), 'paused');
  assert.equal(archiveBlock(hist('manual', { status: 'paused' })), 'paused');
  assert.equal(archiveBlock(live('r3', { ask: { kind: 'form', step: 'Plan' } })), 'waiting');
  assert.equal(archiveBlock(schedRow({ id: 't1', title: 'Next', status: 'scheduled', after: { title: 'r2' } }, NOW)), 'waiting');
  assert.equal(archiveBlock(schedRow({ id: 't2', title: 'Nightly', status: 'scheduled', runAt: NOW + DAY }, NOW)), 'scheduled');
  assert.equal(archiveBlock(hist('kept', { retained: true })), 'retained');
  assert.equal(archiveBlock(hist('old', { archived: true })), 'archived');
});

test('3 eligible runs and 1 live run: "Archive 3 runs?" naming the skipped live run', () => {
  const plan = archivePlan([hist('A'), hist('B'), live('Live thing'), hist('C')]);
  assert.deepEqual(plan.eligible.map((r) => r.title), ['A', 'B', 'C']);
  const copy = archiveConfirm(plan);
  assert.equal(copy.title, 'Archive 3 runs?');
  assert.equal(copy.confirmLabel, 'Archive 3 runs');
  assert.match(copy.message, /Removed: the local branch, the worktree and the run files/);
  assert.match(copy.message, /Kept: the remote branch, any open PR and the cost in Statistics\. You can restore them/);
  assert.match(copy.message, /Skipped \(1\): Live thing \(still running\)\./);
});

test('one run: "Archive 1 run?" opening with its title; nothing eligible: no dialog', () => {
  const copy = archiveConfirm(archivePlan([hist('Merged thing')]));
  assert.equal(copy.title, 'Archive 1 run?');
  assert.equal(copy.message.split('\n')[0], 'Merged thing');
  assert.equal(archiveConfirm(archivePlan([live('x')])), null);
  assert.equal(nothingToArchive(archivePlan([live('x')])).detail, 'Skipped (1): x (still running).');
});

test('a scheduled run waiting for an archived run is named as marked missed', () => {
  const plan = archivePlan([hist('Old thing'), hist('B')]);
  const copy = archiveConfirm(plan, { waiting: [{ row: plan.eligible[0], titles: ['Nightly'] }] });
  assert.match(copy.message, /\nMarked missed: “Nightly” \(waits for Old thing\)\.$/);
  assert.equal(missedLine([]), '');
  assert.doesNotMatch(archiveConfirm(plan).message, /Marked missed/);
});

test('the age rule with 30 days: only finished runs older than 30 days, never one with retained work', () => {
  const rows = [
    hist('old', { mtime: NOW - 40 * DAY }),
    hist('old-stopped', { status: 'stopped', mtime: NOW - 31 * DAY }),
    hist('old-kept', { mtime: NOW - 40 * DAY, retained: true }),
    hist('young', { mtime: NOW - 10 * DAY }),
    hist('old-paused', { status: 'paused', pauseReason: 'error', mtime: NOW - 60 * DAY }),
    hist('no-time', { mtime: 0, startedAt: '' }),
  ];
  const plan = olderThan(rows, 30, NOW);
  assert.deepEqual(plan.eligible.map((r) => r.title), ['old', 'old-stopped']);
  assert.deepEqual(plan.skipped.map((s) => [s.row.title, s.why]), [['old-kept', 'retained']]);
  assert.deepEqual(olderThan(rows, 7, NOW).eligible.map((r) => r.title), ['old', 'old-stopped', 'young']);
});

test('archiveEach: one at a time; a failure is kept by name and the rest still go', async () => {
  let inFlight = 0;
  const seen = [];
  const request = async (row) => {
    inFlight += 1;
    assert.equal(inFlight, 1, 'never two requests at once');
    seen.push(row.title);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    if (row.title === 'B') throw new Error('boom');
    return { ok: true };
  };
  const done = [];
  const result = await archiveEach([hist('A'), hist('B'), hist('C')], request, { onDone: (r) => done.push(r.title) });
  assert.deepEqual(seen, ['A', 'B', 'C']);
  assert.deepEqual(done, ['A', 'C']);
  assert.deepEqual(result.failed.map((f) => [f.row.title, f.error]), [['B', 'boom']]);
  assert.deepEqual(archiveReport(result), { tone: 'err', title: 'Archived 2 runs · 1 failed', detail: 'B: boom', key: 'runs-archive' });
  assert.equal(archiveReport({ done: [hist('A')], failed: [] }).title, 'Archived 1 run');
});

test('row menu items: finished 3, archived 2, live/paused/scheduled none; a retained Archive is disabled with why', () => {
  assert.deepEqual(rowMenuItems(hist('A')).map((i) => i.id), ['archive', 'new-run', 'copy-id']);
  assert.deepEqual(rowMenuItems(hist('Z', { archived: true })).map((i) => i.id), ['restore', 'copy-id']);
  assert.deepEqual(rowMenuItems(live('r')), []);
  assert.deepEqual(rowMenuItems(hist('P', { status: 'paused' })), []);
  assert.deepEqual(rowMenuItems(schedRow({ id: 't', status: 'scheduled', runAt: NOW + DAY }, NOW)), []);
  const kept = rowMenuItems(hist('K', { retained: true }))[0];
  assert.equal(kept.disabled, true);
  assert.equal(kept.why, 'Recover or discard the retained work first');
});
