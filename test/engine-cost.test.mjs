// test/engine-cost.test.mjs — Codex cost (cascading-settings-design.md §4.5): live rates for the
// built-ins, and a Codex run hands codex its resolved model so a known model is priced.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { liveCostRates, CODEX_BUILTIN_MODELS } from '../src/core/config.mjs';
import { CODEX_PRICES, estimateCodexCostUsd } from '../src/core/engines/codex.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { runOpts } from '../src/core/phases.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';

useTempHome(after);
const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('every Codex built-in has live rates and a non-null estimate', () => {
  for (const { id } of CODEX_BUILTIN_MODELS) {
    const [input, output] = CODEX_PRICES[id];
    assert.deepEqual(liveCostRates(id), { input, output, cacheRead: input / 10, cacheWrite: input, cacheWrite1h: input }, id);
    assert.ok(Number.isFinite(estimateCodexCostUsd(id, { input: 1000, cached: 0, output: 100 })), id);
  }
  assert.equal(liveCostRates('gpt-5.2-codex'), null, 'an id no table knows still has no estimate');
});

test('a node spawn on codex carries its model to the adapter, which prices the turn', POSIX, async () => {
  const opts = runOpts({ projectDir: '/p', claudeOpts: { engine: 'codex', model: 'gpt-5.6-sol' } }, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: [] });
  assert.equal(opts.model, 'gpt-5.6-sol');
  const dir = mkdtempSync(join(tmpdir(), 'worca-eng-cost-'));
  dirs.push(dir);
  const codex = fakeCodex(dir, 'done');
  const events = [];
  await runClaude({ ...opts, bin: codex.bin, cwd: dir, onEvent: (e) => events.push(e) });
  const result = events.find((e) => e.type === 'result');
  assert.ok(result && Number.isFinite(result.costUsd), JSON.stringify(result));
  assert.ok(Math.abs(result.costUsd - (1000 * 5 + 20 * 30) / 1e6) < 1e-12);
});
