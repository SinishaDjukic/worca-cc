// test/executor-claude-fake.test.mjs — the real Claude adapter (runClaudeProcess) on a worker: a
// stub `claude` runs on an in-process worker over a real socket; the staged system prompt is a
// file under the shared staging dir, the prompt rides stdin, and the child's HOME and host-guard
// pid are the worker's. Nothing about the adapter knows it is remote.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createWorkerRegistry } from '../src/core/executor/registry.mjs';
import { createInProcessBackend } from '../src/core/executor/backends/in-process.mjs';
import { installExecutor, stagingBase } from '../src/core/executor/index.mjs';
import { withExecutorScope } from '../src/core/executor/scope.mjs';
import { runClaudeProcess } from '../src/core/engines/claude.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const CAPS = { engines: { claude: { bin: '/stub/claude', version: 'stub' } }, platform: process.platform, node: process.version, user: null };
const RUN = { kind: 'run', id: 'r-claude' };
let registry; let backend; let rec;

before(async () => {
  rec = mkdtempSync(join(tmpdir(), 'worca-claude-rec-'));
  backend = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS });
  registry = createWorkerRegistry({ backend, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, log: () => {} });
  await registry.listen();
  installExecutor({ kind: 'docker', registry });
});
after(async () => { installExecutor(null); await registry.closeAll(); rmSync(rec, { recursive: true, force: true }); });

function stubClaude() {
  const bin = join(rec, 'claude');
  writeFileSync(bin, `#!/bin/sh
env > "${rec}/env.txt"
printf '%s\\n' "$@" > "${rec}/args.txt"
cat > "${rec}/stdin.txt"
for f in "$@"; do case "$f" in /*) [ -f "$f" ] && cp "$f" "${rec}/staged-$(basename "$f")" ;; esac; done
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"sess-remote-1","model":"stub"}'
printf '%s\\n' '{"type":"result","result":"done on the worker"}'
exit 0
`);
  chmodSync(bin, 0o755);
  return bin;
}

test('runClaudeProcess inside a run scope executes on the worker with staged files on the shared volume', POSIX, async () => {
  const bin = stubClaude();
  const events = [];
  const out = await withExecutorScope(RUN, () => runClaudeProcess({
    cwd: tmpdir(), prompt: 'P'.repeat(300), systemPrompt: 'SYSTEM-PROMPT-TEXT', permissionMode: 'acceptEdits',
    onEvent: (e) => events.push(e), bin, argvInlineLimit: 10,
  }));
  assert.equal(out.exitCode, 0);
  assert.equal(out.text, 'done on the worker');
  assert.equal(backend.started.length, 1, 'one worker for the run');

  const args = readFileSync(join(rec, 'args.txt'), 'utf8').split('\n');
  const i = args.indexOf('--append-system-prompt-file');
  assert.ok(i > 0, `system prompt is a file (args: ${args.join(' ')})`);
  assert.ok(args[i + 1].startsWith(join(worcaHome(), 'tmp', 'stage')), `staged under the shared volume, not the OS tmpdir: ${args[i + 1]}`);
  assert.equal(stagingBase(), join(worcaHome(), 'tmp', 'stage'));
  // The adapter prepends its host-guard preamble; the caller's text ends the file.
  assert.ok(readFileSync(join(rec, 'staged-' + args[i + 1].split('/').pop()), 'utf8').endsWith('SYSTEM-PROMPT-TEXT'), 'the worker could read the staged file');
  assert.equal(readFileSync(join(rec, 'stdin.txt'), 'utf8'), 'P'.repeat(300), 'the prompt rode stdin');

  const env = Object.fromEntries(readFileSync(join(rec, 'env.txt'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  assert.equal(env.HOME, join(worcaHome(), 'worker-homes', 'run', 'r-claude'), 'HOME is the scope home on the shared volume');
  assert.equal(env.WORCA_HOST_PID, String(process.pid), 'the host-guard pid is the worker process');
  assert.equal(env.WORCA_WORKER_TOKEN, undefined);

  assert.ok(events.some((e) => e.type === 'session' && e.sessionId === 'sess-remote-1'), `session event from the stub: ${JSON.stringify(events.map((e) => e.type))}`);
  const left = existsSync(stagingBase()) ? readdirSync(stagingBase()).filter((n) => n.startsWith('worca-claude-')) : [];
  assert.deepEqual(left, [], 'the staged dir is removed after the spawn');
});
