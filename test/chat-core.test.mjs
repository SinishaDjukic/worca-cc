// test/chat-core.test.mjs — pure chat-core ports (chat-connectivity-design.md
// §4.5/§4.6): command parser, allowlist, per-chat context, rate limiter, and
// the 1.0 event renderers. Assertion matrices ported from the pre-1.0 vitest
// siblings (parser.test.js, rate_limiter.test.js, chat_context.test.js).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { parseCommand } from '../src/core/chat/parser.mjs';
import { createAllowlistGuard, parseIdList } from '../src/core/chat/allowlist.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createRateLimiter, RingBuffer, TokenBucket } from '../src/core/chat/rate-limiter.mjs';
import { renderDone, renderError, renderQuestion, renderTest, runRef, fmtMs, fmtUsd } from '../src/core/chat/renderers.mjs';
import { isValidMessage } from '../src/core/chat/channel-protocol.mjs';

useTempHome(after);

// ── parser (ported matrix) ───────────────────────────────────────────────────

test('parseCommand: commands, @bot suffix, mentions, non-commands', () => {
  assert.deepEqual(parseCommand('/status'), { command: 'status', args: [] });
  assert.deepEqual(parseCommand('/status *a1b2'), { command: 'status', args: ['*a1b2'] });
  assert.deepEqual(parseCommand('/STATUS'), { command: 'status', args: [] });
  assert.deepEqual(parseCommand('/status@worca_bot now'), { command: 'status', args: ['now'] });
  assert.deepEqual(parseCommand('@worca_bot /pause *77'), { command: 'pause', args: ['*77'] });
  assert.deepEqual(parseCommand('/mute 30m @worca_bot'), { command: 'mute', args: ['30m'] });
  assert.deepEqual(parseCommand('/fleet-halt'), { command: 'fleet-halt', args: [] }, 'hyphenated names parse');
  assert.equal(parseCommand('hello there'), null);
  assert.equal(parseCommand('//nope'), null);
  assert.equal(parseCommand('/-bad'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand('   '), null);
  assert.equal(parseCommand('@mention only'), null, 'mention plus non-command');
});

// ── allowlist ────────────────────────────────────────────────────────────────

test('allowlist: deny-by-default, exact string match, parseIdList trims', () => {
  const empty = createAllowlistGuard([]);
  assert.equal(empty.isAllowed({ platform: 'telegram', chatId: '42' }), false, 'empty allowlist denies ALL');
  const dropped = [];
  const guard = createAllowlistGuard(['42', '  77 '], { debug: (m) => dropped.push(m) });
  assert.equal(guard.isAllowed({ platform: 'telegram', chatId: '42' }), true);
  assert.equal(guard.isAllowed({ platform: 'telegram', chatId: 42 }), true, 'numeric ids stringify');
  assert.equal(guard.isAllowed({ platform: 'telegram', chatId: '77' }), true, 'ids are trimmed');
  assert.equal(guard.isAllowed({ platform: 'telegram', chatId: '43' }), false);
  assert.equal(dropped.length, 1);
  assert.deepEqual(parseIdList(' 1, 2 ,,3 '), ['1', '2', '3']);
  assert.deepEqual(parseIdList(null), []);
});

// ── chat context ─────────────────────────────────────────────────────────────

test('chat context: defaults, patch persistence across instances, muting', () => {
  const file = join(worcaHome(), 'chat-context.json');
  const ctx = createChatContext(file);
  assert.deepEqual(ctx.get('telegram:42'), { active_project: null, mute_until: null, muted_messages: 0 });

  ctx.set('telegram:42', { active_project: 'worca' });
  const reloaded = createChatContext(file);
  assert.equal(reloaded.get('telegram:42').active_project, 'worca', 'atomic write survives reload');

  assert.equal(ctx.isMuted('telegram:42'), false);
  ctx.set('telegram:42', { mute_until: new Date(Date.now() + 60000).toISOString() });
  assert.equal(ctx.isMuted('telegram:42'), true);
  ctx.incrementMuted('telegram:42');
  ctx.incrementMuted('telegram:42');
  assert.equal(ctx.get('telegram:42').muted_messages, 2);
  ctx.set('telegram:42', { mute_until: new Date(Date.now() - 1000).toISOString() });
  assert.equal(ctx.isMuted('telegram:42'), false, 'expired mute lifts');
});

// ── rate limiter (ported matrix) ─────────────────────────────────────────────

test('rate limiter: FIFO order, 429 ladder retries then drops, ring records', async () => {
  const sleeps = [];
  const rl = createRateLimiter({ ratePerMin: 6000, _sleep: async (ms) => { sleeps.push(ms); } });

  const sent = [];
  assert.equal(await rl.send('a', async (m) => { sent.push(m); }), true);
  assert.equal(await rl.send('b', async (m) => { sent.push(m); }), true);
  assert.deepEqual(sent, ['a', 'b']);
  assert.deepEqual(rl.getRing(), ['a', 'b']);

  // two 429s then success -> ladder slept 1s, 5s
  let attempts = 0;
  const flaky = async () => { attempts++; if (attempts <= 2) { const e = new Error('429'); e.status = 429; throw e; } };
  sleeps.length = 0;
  assert.equal(await rl.send('c', flaky), true);
  assert.deepEqual(sleeps, [1000, 5000]);

  // kind:'rate-limit' (PluginOpError vocabulary) also retries; exhausted -> false + dropped counter
  const always429 = async () => { const e = new Error('slow down'); e.kind = 'rate-limit'; throw e; };
  assert.equal(await rl.send('d', always429), false);
  assert.equal(rl.getStats().dropped_messages, 1);

  // non-429 errors propagate
  await assert.rejects(rl.send('e', async () => { throw new Error('boom'); }), /boom/);
});

test('TokenBucket paces; RingBuffer wraps with drop counting', () => {
  let t = 0;
  const bucket = new TokenBucket(2, { now: () => t });
  assert.equal(bucket.tryConsume(), true);
  assert.equal(bucket.tryConsume(), true);
  assert.equal(bucket.tryConsume(), false, 'empty until refill');
  t += 30000; // half a minute at 2/min -> one token back
  assert.equal(bucket.tryConsume(), true);

  const ring = new RingBuffer(2);
  ring.push(1); ring.push(2); ring.push(3);
  assert.deepEqual(ring.toArray(), [2, 3]);
  assert.equal(ring.dropped, 1);
});

// ── renderers ────────────────────────────────────────────────────────────────

const META = { runId: 'pipe-c56e2951', title: 'Fix the login redirect loop on mobile Safari and desktop too', totalCostUsd: 1.234, totalActiveMs: 754000 };

test('helpers: runRef wildcard suffix, fmtMs, fmtUsd', () => {
  assert.equal(runRef('pipe-c56e2951'), '*2951');
  assert.equal(runRef('ab'), 'ab');
  assert.equal(runRef(null), 'run');
  assert.equal(fmtMs(754000), '12m34s');
  assert.equal(fmtMs(9000), '9s');
  assert.equal(fmtMs(null), null);
  assert.equal(fmtUsd(1.234), '$1.23');
  assert.equal(fmtUsd(undefined), null);
});

test('renderDone: done/stopped/paused(+reason) — valid messages, right severity', () => {
  const done = renderDone(META, { status: 'done' });
  assert.equal(isValidMessage(done), true);
  assert.equal(done.severity, 'success');
  const text = done.body[0].value;
  assert.match(text, /\*2951/);
  assert.match(text, /Fix the login redirect loop/);
  assert.match(text, /12m34s/);
  assert.match(text, /\$1\.23/);
  const longTitle = renderDone({ ...META, title: 'T'.repeat(70) }, { status: 'done' });
  assert.match(longTitle.body[0].value, new RegExp(`T{60}…`), 'title truncated at 60');

  const stopped = renderDone(META, { status: 'stopped' });
  assert.equal(stopped.severity, 'warning');
  assert.match(stopped.body[0].value, /stopped/);

  const paused = renderDone(META, { status: 'paused', reason: 'cost_pipeline' });
  assert.equal(paused.severity, 'warning');
  assert.match(paused.body[0].value, /pipeline cost limit reached/);
  assert.match(paused.body[0].value, /\/resume \*2951/);
  const pausedFree = renderDone(META, { status: 'paused', reason: null });
  assert.doesNotMatch(pausedFree.body[0].value, / — /);
});

test('renderError truncates long messages', () => {
  const err = renderError(META, { message: 'x'.repeat(500) });
  assert.equal(isValidMessage(err), true);
  assert.equal(err.severity, 'error');
  assert.match(err.body[0].value, /x{300}…/);
});

test('renderQuestion gate: issues + /approve + /retry instructions', () => {
  const msg = renderQuestion(META, {
    id: 'gate-2', kind: 'gate', agent: 'reviewer',
    issues: [
      { severity: 'critical', summary: 'SQL injection in the search endpoint' },
      { severity: 'major', summary: 'Missing tests' },
    ],
  });
  assert.equal(isValidMessage(msg), true);
  assert.equal(msg.severity, 'warning');
  const text = msg.body[0].value;
  assert.match(text, /waiting for approval \(reviewer\)/);
  assert.match(text, /\[critical\] SQL injection/);
  assert.match(text, /\/approve \*2951 to continue/);
  assert.match(text, /\/retry \*2951 for another cycle/);
});

test('renderQuestion clarify: ordinals per option + /answer instructions', () => {
  const msg = renderQuestion(META, {
    id: 'clarify-1', kind: 'clarify',
    questions: [
      { id: 'q1', question: 'Which storage backend?', options: ['sqlite', 'postgres'] },
      { id: 'q2', question: 'Enable telemetry?', options: ['yes', 'no'] },
    ],
  });
  const text = msg.body[0].value;
  assert.match(text, /\*\*Q1\.\*\* Which storage backend\?/);
  assert.match(text, /1\. sqlite/);
  assert.match(text, /2\. postgres/);
  assert.match(text, /\*\*Q2\.\*\* Enable telemetry\?/);
  assert.match(text, /\/answer \*2951 1 1 {2}\(one choice per question, in order\)/);
});

test('renderQuestion recovery: cause + approve/retry; renderTest is valid', () => {
  const msg = renderQuestion(META, {
    id: 'rec-1', kind: 'recovery',
    recovery: { message: 'claude exited 1: context canceled' },
    issues: [],
  });
  assert.match(msg.body[0].value, /recovery decision/);
  assert.match(msg.body[0].value, /\*\*Cause:\*\* claude exited 1/);
  assert.equal(isValidMessage(renderTest()), true);
});
