// test/usage-limits.test.mjs — the provider plan-limit store (src/core/usage-limits.mjs): converters, change-only
// persistence, reset drops, the corrupt-file guard, the usage-limit pause override and the Claude limit events.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  KINDS, ENGINES, toUsagePct, toResetMs, recordUsageReading, recordClaudeLimit, loadUsageLimits, usageLimits,
  usageLimitsAnswer, onUsageLimitsChanged, _resetUsageLimitsForTests, breakStaleLock, withStoreLock,
} from '../src/core/usage-limits.mjs';
import { createClaudeNormalizer } from '../src/core/engines/claude-events.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after, 'worca-usage-limits-');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeFile = () => path.join(worcaHome(), 'usage-limits.json');
const T0 = 1_700_000_000_000;
const H = 3_600_000;

beforeEach(() => { fs.rmSync(storeFile(), { force: true }); _resetUsageLimitsForTests(); });

const line = (rel, n) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n')[n - 1]);
const limitsOf = (raw) => createClaudeNormalizer()({ type: 'event', raw }).filter((e) => e.type === 'limit');

test('the fixed engine and window orders', () => {
  assert.deepEqual(KINDS, ['session', 'week', 'day']);
  assert.deepEqual(ENGINES, ['claude', 'codex', 'gemini']);
});

test('no reading yet', () => {
  assert.deepEqual(usageLimits({ now: T0 }), { harnesses: [] });
  assert.deepEqual(usageLimitsAnswer({ now: T0 }), { harnesses: [] });
});

test('rounding at .5', () => {
  assert.equal(toUsagePct(0.485, 'fraction'), 49);
  assert.equal(toUsagePct(48.5, 'percent'), 49);
  assert.equal(toUsagePct(1.7, 'fraction'), 100);
  assert.equal(toUsagePct(0.25, 'fraction-left'), 75);
  assert.equal(toUsagePct(-0.2, 'fraction'), 0);
  assert.equal(toUsagePct(NaN, 'fraction'), null);
  assert.equal(toUsagePct('0.5', 'fraction'), null);
  assert.equal(toUsagePct(0.5, 'bogus'), null);
});

test('seconds, ms and ISO resets', () => {
  const ms = Date.parse('2026-11-18T14:50:00Z');
  assert.equal(toResetMs(ms / 1000), ms);
  assert.equal(toResetMs(ms), ms);
  assert.equal(toResetMs('2026-11-18T14:50:00Z'), ms);
  assert.equal(toResetMs('not a date'), null);
  assert.equal(toResetMs(null), null);
  assert.equal(toResetMs(Infinity), null);
});

test('a reading replaces only the kinds it names', () => {
  assert.equal(recordUsageReading('codex', { observedAt: T0, windows: [
    { kind: 'session', pct: 10, resetsAt: T0 + H }, { kind: 'week', pct: 30, resetsAt: T0 + 100 * H }] }, { now: T0 }), true);
  assert.equal(recordUsageReading('codex', { observedAt: T0 + 1, windows: [{ kind: 'session', pct: 20, resetsAt: T0 + H }] }, { now: T0 }), true);
  assert.deepEqual(usageLimits({ now: T0 }), { harnesses: [{ engine: 'codex', observedAt: T0 + 1, windows: [
    { kind: 'session', pct: 20, resetsAt: T0 + H }, { kind: 'week', pct: 30, resetsAt: T0 + 100 * H }] }] });
});

test('invalid windows and unknown engines are skipped', () => {
  assert.equal(recordUsageReading('copilot', { observedAt: T0, windows: [{ kind: 'session', pct: 1, resetsAt: T0 + H }] }), false);
  assert.equal(recordUsageReading('codex', { observedAt: T0, windows: [
    { kind: 'month', pct: 1, resetsAt: T0 + H }, { kind: 'session', pct: 1.5, resetsAt: T0 + H },
    { kind: 'session', pct: 101, resetsAt: T0 + H }, { kind: 'week', pct: 5, resetsAt: null }] }), false);
  assert.equal(fs.existsSync(storeFile()), false);
});

test('a repeat changes nothing', () => {
  const calls = [];
  const off = onUsageLimitsChanged((v) => calls.push(v));
  try {
    const reading = { observedAt: T0, windows: [{ kind: 'session', pct: 41, resetsAt: T0 + H }] };
    assert.equal(recordUsageReading('codex', reading, { now: T0 }), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], usageLimits({ now: T0 }));
    const past = new Date(T0 - 60_000);
    fs.utimesSync(storeFile(), past, past);
    const mtime = fs.statSync(storeFile()).mtimeMs;
    assert.equal(recordUsageReading('codex', { ...reading, observedAt: T0 + 5000 }, { now: T0 + 5000 }), false);
    assert.equal(fs.statSync(storeFile()).mtimeMs, mtime);
    assert.equal(calls.length, 1);
    assert.equal(usageLimits({ now: T0 + 5000 }).harnesses[0].observedAt, T0 + 5000);
  } finally { off(); }
});

test('a listener that throws does not stop the others', () => {
  const seen = [];
  const a = onUsageLimitsChanged(() => { throw new Error('boom'); });
  const b = onUsageLimitsChanged(() => seen.push(1));
  try {
    assert.equal(recordUsageReading('codex', { observedAt: T0, windows: [{ kind: 'day', pct: 3, resetsAt: T0 + H }] }, { now: T0 }), true);
    assert.equal(seen.length, 1);
  } finally { a(); b(); }
});

test('a passed reset drops the window, and the provider with none left', () => {
  recordUsageReading('codex', { observedAt: T0, windows: [
    { kind: 'session', pct: 10, resetsAt: T0 + H }, { kind: 'week', pct: 30, resetsAt: T0 + 2 * H }] }, { now: T0 });
  assert.deepEqual(usageLimits({ now: T0 + H }).harnesses[0].windows.map((w) => w.kind), ['week']);
  assert.deepEqual(usageLimits({ now: T0 + 2 * H }), { harnesses: [] });
});

test('a corrupt store reads as empty', () => {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  for (const text of ['{nope', JSON.stringify({ version: 1, harnesses: { codex: { observedAt: T0, windows: 'nope' } } }),
    JSON.stringify({ version: 1, harnesses: { copilot: { observedAt: T0, windows: { session: { pct: 5, resetsAt: T0 + H } } } } }),
    JSON.stringify({ version: 1, harnesses: { codex: { observedAt: T0, windows: { session: { pct: 'x', resetsAt: T0 + H } } } } }),
    'null']) {
    fs.writeFileSync(storeFile(), text);
    _resetUsageLimitsForTests();
    assert.deepEqual(loadUsageLimits(), {}, text);
  }
});

test('a restart reads back the stored reading', () => {
  recordUsageReading('gemini', { observedAt: T0, windows: [{ kind: 'day', pct: 52, resetsAt: T0 + H }] }, { now: T0 });
  const before = usageLimits({ now: T0 });
  _resetUsageLimitsForTests();
  assert.deepEqual(usageLimits({ now: T0 }), before);
});

test('another process writing the store is read back and merged, not overwritten', () => {
  recordUsageReading('codex', { observedAt: T0, windows: [{ kind: 'session', pct: 41, resetsAt: T0 + H }] }, { now: T0 });
  // Another Worca process (a CLI run) writes Claude's reading behind this process's cache.
  const disk = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
  disk.harnesses.claude = { observedAt: T0, windows: { session: { pct: 12, resetsAt: T0 + H } } };
  fs.writeFileSync(storeFile(), JSON.stringify(disk));
  assert.deepEqual(usageLimits({ now: T0 }).harnesses.map((h) => h.engine), ['claude', 'codex']);
  fs.writeFileSync(storeFile(), JSON.stringify({ version: 1, harnesses: { ...disk.harnesses,
    gemini: { observedAt: T0, windows: { day: { pct: 7, resetsAt: T0 + H } } } } }));
  recordUsageReading('codex', { observedAt: T0, windows: [{ kind: 'session', pct: 42, resetsAt: T0 + H }] }, { now: T0 });
  const stored = JSON.parse(fs.readFileSync(storeFile(), 'utf8')).harnesses;
  assert.deepEqual(Object.keys(stored).sort(), ['claude', 'codex', 'gemini']);
  assert.equal(stored.codex.windows.session.pct, 42);
});

test('a held store lock skips the file write but keeps the reading in memory', () => {
  const lock = `${storeFile()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '');
  try {
    assert.equal(recordUsageReading('codex', { observedAt: T0, windows: [{ kind: 'session', pct: 41, resetsAt: T0 + H }] }, { now: T0 }), true);
    assert.equal(fs.existsSync(storeFile()), false);
    assert.equal(usageLimits({ now: T0 }).harnesses[0].windows[0].pct, 41);
    assert.equal(fs.existsSync(lock), true);
  } finally { fs.rmSync(lock, { force: true }); }
});

test('a stale store lock is broken, the write lands and the lock is gone', () => {
  const lock = `${storeFile()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  assert.equal(recordUsageReading('codex', { observedAt: T0, windows: [{ kind: 'session', pct: 41, resetsAt: T0 + H }] }, { now: T0 }), true);
  assert.equal(JSON.parse(fs.readFileSync(storeFile(), 'utf8')).harnesses.codex.windows.session.pct, 41);
  assert.equal(fs.existsSync(lock), false);
});

test('two breakers of one stale lock: only the first wins, the second leaves the winner\'s fresh lock alone', () => {
  const lock = `${storeFile()}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  const seen = fs.statSync(lock); // both breakers saw the same stale lock
  try {
    assert.equal(breakStaleLock(lock, seen), true);
    assert.equal(fs.existsSync(lock), false);
    fs.closeSync(fs.openSync(lock, 'wx')); // the winner takes a fresh lock
    const fresh = fs.statSync(lock);
    assert.equal(breakStaleLock(lock, seen), false);
    assert.equal(fs.statSync(lock).ino, fresh.ino);
    assert.deepEqual(fs.readdirSync(path.dirname(lock)).filter((n) => n.startsWith('usage-limits.json.lock')), ['usage-limits.json.lock']);
  } finally { fs.rmSync(lock, { force: true }); }
});

test('a holder whose lock was replaced does not unlink the new holder\'s lock', () => {
  const lock = `${storeFile()}.lock`;
  let ran = false;
  try {
    assert.equal(withStoreLock(storeFile(), () => {
      ran = true;
      fs.renameSync(lock, `${lock}.gone`); // a breaker took ours away …
      fs.writeFileSync(lock, 'other');      // … and another process holds it now
    }), true);
    assert.equal(ran, true);
    assert.equal(fs.readFileSync(lock, 'utf8'), 'other');
  } finally { fs.rmSync(lock, { force: true }); fs.rmSync(`${lock}.gone`, { force: true }); }
});

test('the store file holds only engine, kind, pct and times', () => {
  recordUsageReading('codex', { observedAt: T0, windows: [{ kind: 'session', pct: 41, resetsAt: T0 + H }] }, { now: T0 });
  recordUsageReading('gemini', { observedAt: T0, windows: [{ kind: 'day', pct: 52, resetsAt: T0 + H }] }, { now: T0 });
  const keys = new Set();
  const walk = (o, isMap) => { for (const [k, v] of Object.entries(o)) { if (!isMap) keys.add(k); if (v && typeof v === 'object') walk(v, k === 'harnesses' || k === 'windows'); } };
  walk(JSON.parse(fs.readFileSync(storeFile(), 'utf8')), false);
  assert.deepEqual([...keys].sort(), ['harnesses', 'observedAt', 'pct', 'resetsAt', 'version', 'windows']);
});

test('paused run shows 100% over a lower reading and ends at its reset', () => {
  recordUsageReading('claude', { observedAt: T0, windows: [{ kind: 'session', pct: 41, resetsAt: T0 + 5 * H }] }, { now: T0 });
  const bytes = fs.readFileSync(storeFile(), 'utf8');
  const pauses = [{ engine: 'claude', resetsAt: T0 + 2 * H, pausedAt: T0 - H }];
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses }).harnesses[0].windows, [{ kind: 'session', pct: 100, resetsAt: T0 + 2 * H }]);
  assert.deepEqual(usageLimitsAnswer({ now: T0 + 2 * H, pauses }).harnesses[0].windows, [{ kind: 'session', pct: 41, resetsAt: T0 + 5 * H }]);
  assert.equal(fs.readFileSync(storeFile(), 'utf8'), bytes);
  assert.deepEqual(usageLimits({ now: T0 }).harnesses[0].windows[0].pct, 41);
});

test('a paused run with no reading shows Session 100% with observedAt = pausedAt', () => {
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses: [{ engine: 'claude', resetsAt: T0 + H, pausedAt: T0 - 7 }] }),
    { harnesses: [{ engine: 'claude', observedAt: T0 - 7, windows: [{ kind: 'session', pct: 100, resetsAt: T0 + H }] }] });
});

test("each engine's pause fills the window it has", () => {
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses: [{ engine: 'codex', resetsAt: T0 + H, pausedAt: T0 }] }).harnesses[0].windows,
    [{ kind: 'session', pct: 100, resetsAt: T0 + H }]);
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses: [{ engine: 'gemini', resetsAt: T0 + H, pausedAt: T0 }] }),
    { harnesses: [{ engine: 'gemini', observedAt: T0, windows: [{ kind: 'day', pct: 100, resetsAt: T0 + H }] }] });
  recordUsageReading('gemini', { observedAt: T0, windows: [{ kind: 'day', pct: 52, resetsAt: T0 + 5 * H }] }, { now: T0 });
  const pauses = [{ engine: 'gemini', resetsAt: T0 + H, pausedAt: T0 }];
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses }).harnesses[0].windows, [{ kind: 'day', pct: 100, resetsAt: T0 + H }]);
  assert.deepEqual(usageLimitsAnswer({ now: T0 + H, pauses }).harnesses[0].windows, [{ kind: 'day', pct: 52, resetsAt: T0 + 5 * H }]);
});

test('a pause without a reset adds nothing', () => {
  recordUsageReading('claude', { observedAt: T0, windows: [{ kind: 'week', pct: 12, resetsAt: T0 + H }] }, { now: T0 });
  const pauses = [{ engine: 'claude', resetsAt: null, pausedAt: T0 }, { engine: 'codex', resetsAt: T0 - 1, pausedAt: T0 }];
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses }), usageLimits({ now: T0 }));
});

test('a stored 100 keeps its own reset under a pause', () => {
  recordUsageReading('claude', { observedAt: T0, windows: [{ kind: 'session', pct: 100, resetsAt: T0 + 3 * H }] }, { now: T0 });
  assert.deepEqual(usageLimitsAnswer({ now: T0, pauses: [{ engine: 'claude', resetsAt: T0 + H, pausedAt: T0 }] }).harnesses[0].windows,
    [{ kind: 'session', pct: 100, resetsAt: T0 + 3 * H }]);
});

// ── Claude ──────────────────────────────────────────────────────────────────

test('Claude: both event shapes', () => {
  const top = limitsOf(line('test/fixtures/ask/plain-text.jsonl', 3));
  assert.equal(top.length, 1);
  assert.equal(recordClaudeLimit(top[0], { now: T0 }), true);
  assert.deepEqual(usageLimits({ now: T0 }).harnesses, [{ engine: 'claude', observedAt: T0,
    windows: [{ kind: 'week', pct: 48, resetsAt: 1787947200000 }] }]);
  fs.rmSync(storeFile(), { force: true }); _resetUsageLimitsForTests();
  const unified = limitsOf(line('test/fixtures/hooks/subagent-foreground.jsonl', 8));
  assert.equal(recordClaudeLimit(unified[0], { now: T0 }), true);
  assert.deepEqual(usageLimits({ now: T0 }).harnesses[0].windows, [
    { kind: 'session', pct: 28, resetsAt: 1790439000000 }, { kind: 'week', pct: 15, resetsAt: 1790956800000 }]);
});

test('Claude: a top-level reading updates only its window', () => {
  recordClaudeLimit(limitsOf(line('test/fixtures/hooks/subagent-foreground.jsonl', 8))[0], { now: T0 });
  recordClaudeLimit(limitsOf(line('test/fixtures/ask/plain-text.jsonl', 3))[0], { now: T0 });
  assert.deepEqual(usageLimits({ now: T0 }).harnesses[0].windows, [
    { kind: 'session', pct: 28, resetsAt: 1790439000000 }, { kind: 'week', pct: 48, resetsAt: 1787947200000 }]);
});

test('Claude: seven_day_opus, seven_day_sonnet, overage are ignored', () => {
  for (const t of ['seven_day_opus', 'seven_day_sonnet', 'overage', 'seven_day_overage_included']) {
    const [e] = limitsOf({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: t, utilization: 0.9, resetsAt: 1790439000 } });
    assert.equal(recordClaudeLimit(e, { now: T0 }), false, t);
  }
  assert.deepEqual(usageLimits({ now: T0 }), { harnesses: [] });
});

test('Claude: utilization above 1 shows 100', () => {
  const [e] = limitsOf({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 1.7, resetsAt: 1790439000 } });
  recordClaudeLimit(e, { now: T0 });
  assert.equal(usageLimits({ now: T0 }).harnesses[0].windows[0].pct, 100);
});

test('Claude: a sub-agent frame yields no limit', () => {
  assert.deepEqual(limitsOf({ type: 'rate_limit_event', parent_tool_use_id: 'toolu_x',
    rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1790439000 } }), []);
});

test('Claude: a missing rate_limit_info gives no windows', () => {
  assert.deepEqual(limitsOf({ type: 'rate_limit_event' }), [{ type: 'limit', status: null, windows: [] }]);
});

test('only the Claude normaliser names rate_limit_event under src/', () => {
  const hits = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.m?js$/.test(d.name) && /rate_limit_event|rate_limit_info/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(path.join(ROOT, 'src'), p).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(hits, ['core/engines/claude-events.mjs']);
});
