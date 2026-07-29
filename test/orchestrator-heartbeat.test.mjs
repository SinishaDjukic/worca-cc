// test/orchestrator-heartbeat.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-hb-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

const okRunner = async () => ({ status: 'ok', summary: 'done' });
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

const ownerCols = (id) =>
  getDb().prepare('SELECT owner_pid, owner_host, heartbeat_at FROM pipelines WHERE id = ?').get(id);

test('a finished run has NULL owner columns (cleared by finally)', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: okRunner, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const cols = ownerCols(orch.state.id);
  assert.equal(cols.owner_pid, null);
  assert.equal(cols.owner_host, null);
  assert.equal(cols.heartbeat_at, null);
});

test('a stopped run also has NULL owner columns', async () => {
  const dir = gitDir();
  let orch;
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async () => { orch.stop(); return { status: 'ok', summary: 'done' }; },
      verifier: okVerifier,
    },
  });
  const res = await orch.run();
  assert.ok(['stopped', 'done'].includes(res.status));
  const cols = ownerCols(orch.state.id);
  assert.equal(cols.owner_pid, null);
  assert.equal(cols.owner_host, null);
  assert.equal(cols.heartbeat_at, null);
});
