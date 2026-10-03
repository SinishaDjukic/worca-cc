// test/ask-capture-runner.test.mjs — tools/ask-capture-fixtures.mjs records the RAW
// stream-json frames of a turn (the fixtures are raw captures). runClaude emits the
// normalized vocabulary, so the tool must spawn through the Claude adapter's raw
// entry point; this pins that with a fake claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCaptureTurn } from '../tools/ask-capture-fixtures.mjs';

const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixture' } : {};
const dir = mkdtempSync(join(tmpdir(), 'worca-capture-runner-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('a capture turn records the raw frames (system/init first) and the stderr lines', POSIX, async () => {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s1","model":"m"}'
echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"hi"}]}}'
echo '{"type":"result","subtype":"success","result":"hi","total_cost_usd":0}'
echo 'mcp chatter' 1>&2
`);
  chmodSync(bin, 0o755);
  const { frames, stderr, result } = await runCaptureTurn({ bin, cwd: dir, prompt: 'P', systemPrompt: 'S', permissionMode: 'dontAsk' });
  assert.deepEqual(frames.map((f) => `${f.type}${f.subtype ? `/${f.subtype}` : ''}`), ['system/init', 'assistant', 'result/success']);
  assert.deepEqual(stderr, ['mcp chatter']);
  assert.equal(result.exitCode, 0);
});

test('a capture turn with no bin spawns WORCA_CLAUDE_BIN, as runClaude does, not the PATH claude', POSIX, async () => {
  const { execFileSync } = await import('node:child_process');
  const onPath = join(dir, 'path-bin');
  mkdirSync(onPath, { recursive: true });
  const fake = (file, marker) => {
    writeFileSync(file, `#!/bin/sh\necho '{"type":"result","subtype":"success","result":"${marker}"}'\n`);
    chmodSync(file, 0o755);
  };
  fake(join(onPath, 'claude'), 'from-path');
  fake(join(dir, 'configured-claude'), 'from-env');
  const tool = new URL('../tools/ask-capture-fixtures.mjs', import.meta.url).href;
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
    `const { runCaptureTurn } = await import(${JSON.stringify(tool)});
     const { result } = await runCaptureTurn({ cwd: ${JSON.stringify(dir)}, prompt: 'P', systemPrompt: 'S', permissionMode: 'dontAsk' });
     console.log(result.text);`], {
    env: { ...process.env, PATH: `${onPath}:${process.env.PATH}`, WORCA_CLAUDE_BIN: join(dir, 'configured-claude'), ORCH_CLAUDE_BIN: '' },
    encoding: 'utf8',
  });
  assert.equal(out.trim(), 'from-env');
});
