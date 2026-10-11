// test/api-limit-resume.test.mjs
// "Resume after a usage limit": the done-hook schedules a resume ticket just after the reset,
// and firing it resumes the run flagged as an automatic limit resume.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { gitDir } from './helpers/git-dir.mjs';

let homeDir, dir, mod, getDb, runs, resumeTicketsFor, getTicket, setResumeAfterUsageLimit;
let prevHome, prevMock;
const HOUR = 3600_000;
const MARGIN = 5 * 60_000;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-limit-resume-'));
  prevHome = process.env.WORCA_HOME; prevMock = process.env.WORCA_MOCK;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ resumeTicketsFor, getTicket } = await import('../src/core/scheduler.mjs'));
  ({ setResumeAfterUsageLimit } = await import('../src/core/settings.mjs'));
  const { addProject } = await import('../src/core/projects.mjs');
  dir = gitDir('limit-resume');
  await addProject({ name: 'limit-resume', path: dir });
});

after(() => {
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
});

/** A paused usage-limit run: v2 resume point + a real on-disk worktree dir. */
async function limitFixture({ resetAt, pauseReason = 'usage_limit', autoLimitResumes, archived = false } = {}) {
  const wt = await mkdtemp(join(tmpdir(), 'limit-resume-wt-'));
  const branch = { source: 'main', feature: 'feat/x', worktreeDir: wt, reusedExisting: false };
  const limitResetAt = resetAt || new Date(Date.now() + 2 * HOUR).toISOString();
  const resumePoint = graphResumePoint({
    pipelineDir: dir, pauseReason, limitResetAt,
    ...(autoLimitResumes !== undefined ? { autoLimitResumes } : {}),
  });
  const { id } = await seedPipeline(dir, { title: 'Limited feat', status: 'paused', branch, resumePoint });
  if (archived) getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return { id, limitResetAt };
}

function wired(pipelineId) {
  const orch = new EventEmitter();
  const entry = {
    id: `uuid-${pipelineId}`, orch, projectDir: dir, title: 't', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null, pipelineId,
  };
  runs.set(entry.id, entry);
  mod._testing.wireRun(entry);
  return entry;
}

const donePaused = (limitResetAt) => ({ status: 'paused', reason: 'usage_limit', limitResetAt });
const auditOf = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id).map((r) => r.text).join('\n');

async function emitDone(entry, limitResetAt) {
  entry.orch.emit('done', donePaused(limitResetAt));
  await entry._limitResumeP;
}

async function withSetting(on, fn) {
  await setResumeAfterUsageLimit(on);
  try { return await fn(); } finally { await setResumeAfterUsageLimit(false); }
}

test('setting on: a usage-limit pause gets one ticket just after the reset', async () => {
  const { id, limitResetAt } = await limitFixture();
  await withSetting(true, async () => {
    const entry = wired(id);
    try {
      await emitDone(entry, limitResetAt);
      const tickets = resumeTicketsFor(id);
      assert.equal(tickets.length, 1);
      const t = getTicket(tickets[0].id, { withRequest: true });
      assert.equal(new Date(t.runAt).getTime(), Date.parse(limitResetAt) + MARGIN);
      assert.equal(t.ifMissed, 'run');
      assert.equal(t.graceMin, 360);
      assert.equal(t.request.internal.autoLimitResume, true);
      assert.equal(t.request.internal.resumePipelineId, id);
      assert.match(t.title, /\(after usage limit\)$/);
      assert.match(auditOf(id), /Resume scheduled automatically for/);
    } finally { runs.delete(entry.id); }
  });
});

test('two done emits back to back still leave one ticket', async () => {
  const { id, limitResetAt } = await limitFixture();
  await withSetting(true, async () => {
    const entry = wired(id);
    try {
      entry.orch.emit('done', donePaused(limitResetAt));
      const first = entry._limitResumeP;
      entry.orch.emit('done', donePaused(limitResetAt));
      await Promise.all([first, entry._limitResumeP]);
      assert.equal(resumeTicketsFor(id).length, 1);
    } finally { runs.delete(entry.id); }
  });
});

test('setting off: no ticket', async () => {
  const { id, limitResetAt } = await limitFixture();
  await setResumeAfterUsageLimit(false);
  const entry = wired(id);
  try {
    await emitDone(entry, limitResetAt);
    assert.equal(resumeTicketsFor(id).length, 0);
  } finally { runs.delete(entry.id); }
});

test('archived run: no ticket', async () => {
  const { id, limitResetAt } = await limitFixture({ archived: true });
  await withSetting(true, async () => {
    const entry = wired(id);
    try {
      await emitDone(entry, limitResetAt);
      assert.equal(resumeTicketsFor(id).length, 0);
    } finally { runs.delete(entry.id); }
  });
});

test('cost-cap pause: no ticket', async () => {
  const { id, limitResetAt } = await limitFixture({ pauseReason: 'cost_pipeline' });
  await withSetting(true, async () => {
    const entry = wired(id);
    try {
      await emitDone(entry, limitResetAt);
      assert.equal(resumeTicketsFor(id).length, 0);
    } finally { runs.delete(entry.id); }
  });
});

test('three automatic resumes in a row: no ticket, and the audit says why', async () => {
  const { id, limitResetAt } = await limitFixture({ autoLimitResumes: 3 });
  await withSetting(true, async () => {
    const entry = wired(id);
    try {
      await emitDone(entry, limitResetAt);
      assert.equal(resumeTicketsFor(id).length, 0);
      assert.match(auditOf(id), /Not resumed automatically/);
    } finally { runs.delete(entry.id); }
  });
});

test('firing an auto ticket resumes the run flagged as an automatic limit resume', async () => {
  const { id, limitResetAt } = await limitFixture();
  await withSetting(true, async () => {
    const entry = wired(id);
    let fired = null;
    try {
      await emitDone(entry, limitResetAt);
      const [open] = resumeTicketsFor(id);
      assert.ok(open, 'ticket was scheduled');
      const ticket = getTicket(open.id, { withRequest: true });
      const out = await mod._testing.fireResumeTicket(ticket, id);
      assert.equal(out.ok, true, JSON.stringify(out));
      fired = [...runs.values()].find((e) => e.pipelineId === id && e !== entry);
      assert.ok(fired, 'the resume made a new live entry');
      assert.equal(fired.orch.opts.autoLimitResume, true);
    } finally {
      runs.delete(entry.id);
      if (fired) {
        try { await fired.orch.stop?.(); } catch { /* best effort */ }
        runs.delete(fired.id);
      }
    }
  });
});

test('a manual fire (no flag) does not mark the resume automatic', async () => {
  const { id } = await limitFixture();
  const ticket = { id: 'tk-manual', createdBy: 'local', request: { internal: { resumePipelineId: id } } };
  let fired = null;
  try {
    const out = await mod._testing.fireResumeTicket(ticket, id);
    assert.equal(out.ok, true, JSON.stringify(out));
    fired = [...runs.values()].find((e) => e.pipelineId === id);
    assert.ok(!fired.orch.opts.autoLimitResume);
  } finally {
    if (fired) {
      try { await fired.orch.stop?.(); } catch { /* best effort */ }
      runs.delete(fired.id);
    }
  }
});
