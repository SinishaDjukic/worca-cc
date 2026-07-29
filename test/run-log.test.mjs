// test/run-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunLogWriter, RUN_LOG_FILE } from '../src/core/run-log.mjs';

function readLines(text) {
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('buffers before bind, then flushes the full ordered stream on close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-rlw-'));
  try {
    const w = createRunLogWriter({ flushMs: 5 });
    w.push({ source: 'preflight', level: 'info', text: 'before dir', ts: 't0' }); // pre-bind
    w.bind(dir);
    for (let i = 0; i < 500; i++) w.push({ source: 'planner', level: 'info', text: `line ${i}`, ts: `t${i}` });
    await w.close();

    const lines = readLines(await readFile(join(dir, RUN_LOG_FILE), 'utf8'));
    assert.equal(lines.length, 501, 'every pushed line persisted, uncapped');
    assert.equal(lines[0].text, 'before dir', 'pre-bind line flushed first');
    assert.equal(lines[1].text, 'line 0');
    assert.equal(lines[500].text, 'line 499', 'append order preserved (serialized chain)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('push after close is a no-op; second close is safe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-rlw-'));
  try {
    const w = createRunLogWriter({ flushMs: 5 });
    w.bind(dir);
    w.push({ source: 'a', level: 'info', text: 'kept', ts: 't' });
    await w.close();
    w.push({ source: 'a', level: 'info', text: 'dropped', ts: 't' });
    await w.close(); // idempotent
    const lines = readLines(await readFile(join(dir, RUN_LOG_FILE), 'utf8'));
    assert.deepEqual(lines.map((l) => l.text), ['kept']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('close() with no bind never throws and writes nothing', async () => {
  const w = createRunLogWriter();
  w.push({ source: 'x', level: 'info', text: 'no dir', ts: 't' });
  await assert.doesNotReject(w.close());
});
