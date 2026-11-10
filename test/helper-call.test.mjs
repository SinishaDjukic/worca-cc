// The helper call (plans/requirements-9c-design.md §4, D12, D13). Fake run and fake gate only: no CLI is spawned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { helperCall, HelperCallError } from '../src/core/helper-call/index.mjs';

const RETRY = { WORCA_RECOVERY_BACKOFF_MS: '0' };
const ok = async () => null;
const base = { model: 'm', cwd: '/w', systemPrompt: 's', prompt: 'p', timeoutMs: 5000 };
const result = (extra = {}) => ({ type: 'result', ...extra });
const runner = (events = [], text = 'hi') => {
  const calls = [];
  const run = async (o) => { calls.push(o); for (const e of events) o.onEvent(e); return { text }; };
  return { run, calls };
};
const spy = (fn) => { const f = (...a) => { f.calls.push(a); return fn(...a); }; f.calls = []; return f; };

test('claude: options pass through unchanged plus signal and onEvent, no gate', async () => {
  const { run, calls } = runner([result({ costUsd: 0.03 })]);
  const gate = spy(ok);
  const claudeOptions = { cwd: '/w', prompt: 'p', model: 'sonnet', tools: ['Read'], spawnKind: 'aux' };
  const copy = structuredClone(claudeOptions);
  const r = await helperCall({ ...base, engine: 'claude', profile: 'none', claudeOptions }, { run, gate, retryEnv: RETRY });
  assert.equal(gate.calls.length, 0);
  assert.deepEqual(claudeOptions, copy);
  const { signal, onEvent, ...rest } = calls[0];
  assert.deepEqual(rest, copy);
  assert.ok(signal instanceof AbortSignal);
  assert.equal(typeof onEvent, 'function');
  assert.equal(r.text, 'hi');
  assert.equal(r.engine, 'claude');
});

test('cursor is refused before any spawn', async () => {
  const { run, calls } = runner();
  await assert.rejects(helperCall({ ...base, engine: 'cursor', profile: 'none' }, { run, gate: ok }), (e) => e instanceof HelperCallError && e.code === 'NOT_OFFERED');
  assert.equal(calls.length, 0);
});

test('an engine outside the offered list is NOT_OFFERED', async () => {
  const { run, calls } = runner();
  await assert.rejects(helperCall({ ...base, engine: 'codex', profile: 'none' }, { run, gate: ok, engines: ['claude'] }), (e) => e.code === 'NOT_OFFERED');
  assert.equal(calls.length, 0);
});

test('a gate refusal is NOT_READY in the D13 words, with the docs link and no spawn', async () => {
  const { run, calls } = runner();
  const gate = async () => ({ message: 'codex is not signed in — run `codex login`', notReady: true });
  await assert.rejects(helperCall({ ...base, engine: 'codex', profile: 'none' }, { run, gate }), (e) => {
    assert.equal(e.code, 'NOT_READY');
    assert.equal(e.message, "Codex isn't signed in. Sign in, or change the model.");
    assert.match(e.docsUrl, /codex/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('none on gemini launches with askLockdown and envScrub', async () => {
  const { run, calls } = runner();
  const gate = spy(ok);
  await helperCall({ ...base, engine: 'gemini', profile: 'none' }, { run, gate, mock: () => false });
  assert.equal(calls[0].askLockdown, true);
  assert.equal(calls[0].envScrub, true);
  assert.equal(calls[0].engine, 'gemini');
  assert.equal(gate.calls[0][1].model, 'm');
});

test('repo on codex writes the files server for the look roots', async () => {
  const { run, calls } = runner();
  const w = spy(() => '/scratch/mcp.json');
  await helperCall({ ...base, engine: 'codex', profile: 'repo', roots: ['/r1', '/r2'] }, { run, gate: ok, writeFilesMcpConfig: w, scratch: '/scratch', removeCodexThread: () => true });
  assert.equal(w.calls.length, 1);
  assert.deepEqual(w.calls[0][0].roots, ['/r1', '/r2']);
  assert.equal(w.calls[0][0].name, 'requirements');
  assert.equal(w.calls[0][0].dir, join('/scratch', 'files-mcp'));
  assert.equal(calls[0].mcpConfigPath, '/scratch/mcp.json');
});

test('a rate-limit error then success spawns twice', async () => {
  let n = 0;
  const run = async () => { n += 1; if (n === 1) throw new Error('429 rate limit exceeded'); return { text: 'ok' }; };
  const r = await helperCall({ ...base, engine: 'gemini', profile: 'none' }, { run, gate: ok, retryEnv: RETRY });
  assert.equal(n, 2);
  assert.equal(r.text, 'ok');
});

test('a timeout throws TIMEOUT carrying the cost so far', async () => {
  const run = (o) => new Promise((_, rej) => {
    o.onEvent(result({ costUsd: 0.02 }));
    o.signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
  });
  await assert.rejects(helperCall({ ...base, engine: 'goose', profile: 'none', timeoutMs: 30 }, { run, gate: ok }), (e) => {
    assert.equal(e.code, 'TIMEOUT');
    assert.equal(e.message, 'Worca got no reply within 0 seconds. Try again.');
    assert.equal(e.costUsd, 0.02);
    assert.equal(e.costKind, 'billed');
    return true;
  });
});

test('a failed call still reports the money spent', async () => {
  const run = async (o) => { o.onEvent(result({ costUsd: 0.05 })); throw new Error('boom'); };
  await assert.rejects(helperCall({ ...base, engine: 'goose', profile: 'none' }, { run, gate: ok }), (e) => e.message === 'boom' && e.costUsd === 0.05 && e.costKind === 'billed');
});

test('a gemini result with usage and rates is estimated, with the notice', async () => {
  const { run } = runner([result({ usage: { input_tokens: 1000, output_tokens: 500 } })]);
  const r = await helperCall({ ...base, engine: 'gemini', profile: 'none' }, { run, gate: ok, ratesFor: () => ({ input: 1, output: 2 }) });
  assert.equal(r.costKind, 'estimated');
  assert.ok(r.costUsd > 0);
  assert.equal(r.inputTokens, 1000);
  assert.ok(r.notices.includes('Cost estimated: Gemini CLI reports none.'));
});

test('a codex call removes its session file and has no keeps-copy notice', async () => {
  const home = mkdtempSync(join(tmpdir(), 'codex-helper-'));
  const dir = join(home, 'sessions', '2026', '11', '10');
  mkdirSync(dir, { recursive: true });
  const prev = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = home;
    const mine = join(dir, 'rollout-2026-11-10T10-00-00-thr-1.jsonl');
    const other = join(dir, 'rollout-2026-11-10T10-00-01-thr-2.jsonl');
    writeFileSync(mine, '{}\n'); writeFileSync(other, '{}\n');
    const run = async (o) => { o.onEvent({ type: 'session', sessionId: 'codex:thr-1' }); return { text: 'x' }; };
    const r = await helperCall({ ...base, engine: 'codex', profile: 'none' }, { run, gate: ok });
    assert.equal(existsSync(mine), false);
    assert.equal(existsSync(other), true);
    assert.ok(!r.notices.some((n) => /keeps its own copy/.test(n)));
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test('a codex call that finds no file keeps the keeps-copy notice', async () => {
  const run = async (o) => { o.onEvent({ type: 'session', sessionId: 'codex:thr-9' }); return { text: 'x' }; };
  const r = await helperCall({ ...base, engine: 'codex', profile: 'none' }, { run, gate: ok, removeCodexThread: () => false });
  assert.ok(r.notices.includes('Codex keeps its own copy of this step in its history on this computer.'));
});

test('the session is removed on failure too', async () => {
  const removed = [];
  const run = async (o) => { o.onEvent({ type: 'session', sessionId: 'codex:thr-5' }); throw new Error('boom'); };
  await assert.rejects(helperCall({ ...base, engine: 'codex', profile: 'none' }, { run, gate: ok, removeCodexThread: (t) => { removed.push(t); return true; } }));
  assert.deepEqual(removed, ['thr-5']);
});

test('aborting via signal stops the call', async () => {
  const ac = new AbortController();
  const run = (o) => new Promise((_, rej) => { o.signal.addEventListener('abort', () => rej(new Error('stopped')), { once: true }); });
  const p = helperCall({ ...base, engine: 'goose', profile: 'none', signal: ac.signal }, { run, gate: ok });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (e) => e.message === 'stopped' && e.code !== 'TIMEOUT');
});
