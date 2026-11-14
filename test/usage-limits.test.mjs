// test/usage-limits.test.mjs — the usage rings' source (D7, D8): the CLI's own rate_limit_event, normalised once in the
// Claude normaliser as a `limit` event, kept per engine in usage-limits.json under WORCA_HOME, expired windows dropped.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';
import { recordUsageLimit, usageLimits, loadUsageLimits, onUsageLimitsChanged, _resetUsageLimitsForTests } from '../src/core/usage-limits.mjs';

const line = (file, n) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8').split('\n')[n - 1]);
const SINGLE = line('ask/plain-text.jsonl', 3);            // seven_day 0.48, resets 1787947200 s
const UNIFIED = line('hooks/subagent-foreground.jsonl', 8); // five_hour 0.28 and seven_day 0.15
const limitOf = (raw) => createClaudeNormalizer()({ type: 'event', raw });
const BEFORE = 1787940000000;                               // before every fixture reset

let home, prev;
before(async () => { home = await mkdtemp(join(tmpdir(), 'worca-usage-')); prev = process.env.WORCA_HOME; process.env.WORCA_HOME = home; });
after(async () => { if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev; await rm(home, { recursive: true, force: true }); });
const FILE = () => join(home, '.worca-cc', 'usage-limits.json');   // worcaHome() is WORCA_HOME/.worca-cc
beforeEach(async () => { await rm(FILE(), { force: true }); _resetUsageLimitsForTests(); });

test('the Claude normaliser turns each rate_limit_event into one limit event; resetsAt in ms; a sub-agent\'s frame is none', () => {
  assert.deepEqual(limitOf(SINGLE), [{ type: 'limit', status: 'allowed_warning', windows: [{ window: 'seven_day', utilization: 0.48, resetsAt: 1787947200000 }] }]);
  assert.deepEqual(limitOf(UNIFIED), [{ type: 'limit', status: 'allowed', windows: [
    { window: 'five_hour', utilization: 0.28, resetsAt: 1790439000000 }, { window: 'seven_day', utilization: 0.15, resetsAt: 1790956800000 }] }]);
  assert.deepEqual(limitOf({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), [{ type: 'limit', status: 'allowed', windows: [] }]);
  assert.deepEqual(limitOf({ ...SINGLE, parent_tool_use_id: 'T1' }), [], 'main stream only');
});

test('recordUsageLimit: seven_day 0.48 is week 48, five_hour is session; a repeat changes nothing; no utilisation draws nothing', () => {
  const seen = [];
  const off = onUsageLimitsChanged((v) => seen.push(v));
  assert.equal(recordUsageLimit('claude', limitOf(SINGLE)[0], { now: BEFORE }), true);
  assert.equal(recordUsageLimit('claude', limitOf(SINGLE)[0], { now: BEFORE + 1 }), false, 'the same reading');
  assert.deepEqual(usageLimits({ now: BEFORE }), { harnesses: [{ engine: 'claude', observedAt: BEFORE, windows: [{ kind: 'week', pct: 48, resetsAt: 1787947200000 }] }] });
  assert.equal(recordUsageLimit('claude', limitOf(UNIFIED)[0], { now: BEFORE + 2 }), true);
  assert.deepEqual(usageLimits({ now: BEFORE }).harnesses[0].windows, [{ kind: 'session', pct: 28, resetsAt: 1790439000000 }, { kind: 'week', pct: 15, resetsAt: 1790956800000 }]);
  assert.equal(recordUsageLimit('codex', { type: 'limit', status: 'allowed', windows: [{ window: 'five_hour', utilization: null, resetsAt: null }] }), false);
  assert.equal(recordUsageLimit('claude', { type: 'limit', windows: [{ window: 'overage', utilization: 0.9, resetsAt: null }] }), false, 'other window types are ignored');
  assert.equal(recordUsageLimit('', limitOf(SINGLE)[0]), false);
  assert.deepEqual(usageLimits({ now: BEFORE }).harnesses.map((h) => h.engine), ['claude']);
  assert.equal(seen.length, 2, 'one change event per change');
  off();
  assert.equal(recordUsageLimit('claude', { type: 'limit', windows: [{ window: 'five_hour', utilization: 1.7, resetsAt: 1790439000000 }] }, { now: BEFORE + 3 }), true);
  assert.equal(usageLimits({ now: BEFORE }).harnesses[0].windows[0].pct, 100, 'clamped to 0-100');
  assert.equal(seen.length, 2, 'an unsubscribed listener hears nothing');
});

test('an expired window is dropped, and a harness with none left is too', () => {
  recordUsageLimit('claude', limitOf(UNIFIED)[0], { now: BEFORE });
  assert.deepEqual(usageLimits({ now: 1790500000000 }).harnesses[0].windows.map((w) => w.kind), ['week'], 'the session reset has passed');
  assert.deepEqual(usageLimits({ now: 1791000000000 }), { harnesses: [] });
});

test('persist and re-read gives the same readings; a missing or corrupt file reads as empty, never a throw', () => {
  assert.deepEqual(usageLimits({ now: BEFORE }), { harnesses: [] }, 'no file yet');
  recordUsageLimit('claude', limitOf(UNIFIED)[0], { now: BEFORE });
  const file = FILE();
  assert.ok(existsSync(file));
  assert.deepEqual(readdirSync(join(home, '.worca-cc')).filter((f) => f.endsWith('.tmp')), [], 'temp file renamed away');
  const was = usageLimits({ now: BEFORE });
  _resetUsageLimitsForTests();
  assert.deepEqual(loadUsageLimits() && usageLimits({ now: BEFORE }), was);
  const mtime = statSync(file).mtimeMs;
  recordUsageLimit('claude', limitOf(UNIFIED)[0], { now: BEFORE + 5 });
  assert.equal(statSync(file).mtimeMs, mtime, 'no write without a change');
  writeFileSync(file, '{not json');
  _resetUsageLimitsForTests();
  assert.deepEqual(usageLimits({ now: BEFORE }), { harnesses: [] });
  writeFileSync(file, JSON.stringify({ harnesses: { claude: { windows: 'nope' } } }));
  _resetUsageLimitsForTests();
  assert.deepEqual(usageLimits({ now: BEFORE }), { harnesses: [] });
});

test('needle: only the Claude normaliser names rate_limit_event or rate_limit_info under src/', () => {
  const root = new URL('../src/', import.meta.url).pathname;
  const hits = [];
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p); else if (/\.m?js$/.test(f.name) && /rate_limit_(event|info)/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
  } };
  walk(root);
  assert.deepEqual(hits, ['core/engines/claude-events.mjs']);
});
