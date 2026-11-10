// removeCodexThread (9c D12): deletes one thread's session file and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeCodexThread } from '../src/core/engines/codex.mjs';

test('removes only the matching rollout, reports it, and never throws', () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-rm-'));
  const prev = process.env.CODEX_HOME;
  try {
    const dir = join(home, 'sessions', '2026', '11', '10');
    mkdirSync(dir, { recursive: true });
    const mine = join(dir, 'rollout-2026-11-10T10-00-00-thread-aaa.jsonl');
    const other = join(dir, 'rollout-2026-11-10T10-00-01-thread-bbb.jsonl');
    writeFileSync(mine, '{}\n'); writeFileSync(other, '{}\n');
    process.env.CODEX_HOME = home;
    assert.equal(removeCodexThread('thread-aaa'), true);
    assert.equal(existsSync(mine), false);
    assert.equal(existsSync(other), true);
    assert.equal(removeCodexThread('thread-aaa'), false);
    assert.equal(removeCodexThread(''), false);
    assert.equal(removeCodexThread(null), false);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});
