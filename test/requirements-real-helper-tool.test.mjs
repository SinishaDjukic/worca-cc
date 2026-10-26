// test/requirements-real-helper-tool.test.mjs — the real-helper tool without spending (plans/requirements-a3-design.md §8 "Real calls"):
// it refuses mock mode, its dry run sends nothing and makes no folder, routing is refused before any call and before the sandbox,
// and every call gets the budget that is left (the tool stops at the cap).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { main, MESSAGES } from '../tools/requirements-real-helper.mjs';

useTempHome(after, 'worca-a3-realhelper-test-');
const sandboxNames = () => readdirSync(tmpdir()).filter((n) => n.startsWith('worca-a3-real-'));
const existing = new Set(sandboxNames());
const noClaude = mkdtempSync(join(tmpdir(), 'worca-a3-rh-none-'));   // a home without Claude Code settings
after(() => {
  _resetForTests();
  rmSync(noClaude, { recursive: true, force: true });
  for (const n of sandboxNames()) if (!existing.has(n)) { try { rmSync(join(tmpdir(), n), { recursive: true, force: true }); } catch { /* best effort */ } }
});
const none = () => { throw new Error('no call'); };
const quiet = { home: noClaude, managedPaths: [join(noClaude, 'managed-settings.json')], modelEnvOf: () => ({}) };

test('mock mode is refused; the dry run lists the five messages, calls nothing and makes no folder; a bad cap is usage', async () => {
  const out = [];
  assert.equal(await main([], { log: (l) => out.push(l), env: { WORCA_MOCK: '1' }, runner: none, ...quiet }), 2);
  assert.match(out.join('\n'), /measures the real model; unset WORCA_MOCK/);
  out.length = 0;
  const before = sandboxNames().length;
  assert.equal(await main([], { log: (l) => out.push(l), env: {}, runner: none, ...quiet }), 0);
  assert.equal(sandboxNames().length, before, 'a dry run makes no sandbox folder');
  assert.equal(MESSAGES.length, 5);
  assert.equal(out.filter((l) => l.startsWith('message: ')).length, 5);
  assert.match(out.at(-1), /^Dry run: nothing was sent\. Add --yes .*hard cap \$1\.00/);
  assert.equal(await main(['--max-usd', '0'], { log: () => {}, env: {}, runner: none, ...quiet }), 2);
});

test("routing in this shell's environment is refused before any call and before the sandbox, naming keys only", async () => {
  const out = [];
  const before = sandboxNames().length;
  assert.equal(await main(['--yes'], { log: (l) => out.push(l), env: { ANTHROPIC_BASE_URL: 'https://example.invalid', ANTHROPIC_API_KEY: 'sk-secret' }, runner: none, ...quiet }), 2);
  assert.equal(sandboxNames().length, before);
  assert.match(out.join('\n'), /ANTHROPIC_BASE_URL/);
  assert.doesNotMatch(out.join('\n'), /sk-secret|example\.invalid/);
});

test('the hard cap: every call gets the budget left as maxBudgetUsd; the tool stops once nothing is left and reports cache use', async () => {
  const budgets = [];
  const usage = { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 };
  const runner = async (opts) => {
    budgets.push(opts.maxBudgetUsd);
    const text = JSON.stringify({ text: 'I suggest a criterion for partly shipped orders.', drafts: [], proposals: [] });
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.4, result: text, usage }, costUsd: 0.4 });
    return { text };
  };
  const out = [];
  assert.equal(await main(['--yes', '--max-usd', '1.00'], { log: (l) => out.push(l), env: {}, runner, ...quiet }), 1, 'the cap stopped it');
  assert.deepEqual(budgets, [1, 0.6, 0.2]);
  const rows = out.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.skipped || r.parsed), [true, true, true, 'max-usd', 'max-usd']);
  assert.deepEqual([rows[0].cacheReadTokens, rows[0].cacheWriteTokens, rows[0].costUsd], [900, 100, 0.4]);
  assert.match(out.at(-1), /^spent \$1\.2000 of \$1\.00/);
});
