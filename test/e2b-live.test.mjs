// test/e2b-live.test.mjs
// LIVE: a real (self-hosted) E2B. Skipped unless E2B_API_URL and E2B_API_KEY are set;
// proves what the fake cannot (plans/e2b-execution-design.md §15). Needs the template built
// (npm run e2b:build). Never calls a model.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadE2b } from '../src/core/exec-env/e2b-sdk.mjs';
import { e2bConnection } from '../src/core/exec-env/e2b-config.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { shq } from '../src/core/exec-env/shell.mjs';
import { pinnedClaudeCodeVersion } from '../tools/docker-build.mjs';
import { scratchDirs, fixture } from './helpers/e2b-fixture.mjs';

const LIVE = process.env.E2B_API_URL && process.env.E2B_API_KEY ? false : 'needs E2B_API_URL and E2B_API_KEY (live E2B)';
const { tmp, cleanup } = scratchDirs(); after(cleanup);

test('live: sandbox lifecycle, pinned claude, mirrored path, bundle clone, metadata list, kill', { skip: LIVE, timeout: 300_000 }, async () => {
  const sdk = await loadE2b();
  const conn = e2bConnection();
  const f = fixture(tmp);     // same git fixture as exec-env-sync
  const env = new E2bExecEnv({ sdk, conn, worktreeDir: f.repo, pipelineDir: f.pipelineDir, storeRoots: [f.plans],
    injected: ['.claude/rules/worca'], supportFiles: [join(f.runRoot, 'CLAUDE.md')],
    metadata: { worca: '1', worcaInstance: 'live-test', worcaRunId: `live-${Date.now()}` }, scratchDir: tmp('e2b-live-'), log: () => {} });
  try {
    await env.start();                                     // proves root mkdir of /Users/… or /tmp/… mirrored dirs
    assert.equal((await env._sh('claude --version')).trim().split(' ')[0], pinnedClaudeCodeVersion());
    const staged = tmp('worca-claude-'); writeFileSync(join(staged, 'p.md'), 'x');
    await env.uploadPath(staged);                          // the os.tmpdir() staged-dir case
    await env.beforeSpawn();
    await env._sh(`cd ${shq(f.repo)} && echo live > live.txt && echo out > ${shq(join(f.pipelineDir, 'out.md'))}`);
    await env.afterSpawn();
    assert.equal(readFileSync(join(f.repo, 'live.txt'), 'utf8'), 'live\n');
    assert.equal(readFileSync(join(f.pipelineDir, 'out.md'), 'utf8'), 'out\n');
    const listed = await sdk.Sandbox.list({ ...conn.opts, query: { metadata: { worcaInstance: 'live-test' } } }).nextItems();
    assert.ok(listed.some((s) => s.sandboxId === env.sandboxId));
  } finally { await env.close('live test'); }
});
