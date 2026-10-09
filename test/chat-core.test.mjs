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
import { renderDone, renderError, renderQuestion, renderSchedule, renderTest } from '../src/core/chat/renderers.mjs';
import { isValidMessage } from '../src/core/chat/channel-protocol.mjs';
import { renderToHtml } from '../plugins/telegram-chat/channel/worker.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

// ── parser (ported matrix) ───────────────────────────────────────────────────

test('parseCommand: commands, @bot suffix, @name and wire mentions, non-commands', async () => {
  await checkRows([
    { name: 'parseCommand: commands, @bot suffix, mentions, non-commands', run: () => {
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
    } },
    { name: 'parseCommand strips Slack/Discord wire mentions, not just @name', run: () => {
      assert.deepEqual(parseCommand('<@U0123ABC> /approve *ab12'), { command: 'approve', args: ['*ab12'] });
      assert.deepEqual(parseCommand('<@!123456789> /status'), { command: 'status', args: [] });
      assert.deepEqual(parseCommand('<@&987> /runs'), { command: 'runs', args: [] });
      assert.deepEqual(parseCommand('<@U0123ABC|worca> /runs'), { command: 'runs', args: [] });
      assert.deepEqual(parseCommand('@worca /approve'), { command: 'approve', args: [] }, 'plain @name still works');
      assert.equal(parseCommand('<@U0123ABC> hello there'), null, 'a mention alone does not make a command');
    } },
  ]);
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

test('rate limiting: FIFO + 429 ladder, TokenBucket pacing, RingBuffer drop counting', async () => {
  await checkRows([
    { name: 'rate limiter: FIFO order, 429 ladder retries then drops, ring records', run: async () => {
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
    } },
    { name: 'TokenBucket paces; RingBuffer wraps with drop counting', run: () => {
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
    } },
  ]);
});

// ── renderers ────────────────────────────────────────────────────────────────

const META = { runId: 'pipe-c56e2951', title: 'Fix the login redirect loop on mobile Safari and desktop too', totalCostUsd: 1.234, totalActiveMs: 754000 };

test('renderQuestion: gate, workflow, clarify and recovery messages carry their reply commands and survive Telegram HTML', async () => {
  await checkRows([
    { name: 'renderQuestion gate: issues + /approve + /retry instructions', run: () => {
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
      assert.match(text, /`\/approve \*2951` — no more cycles, continue/);
      assert.match(text, /`\/retry \*2951` — run another cycle/);
    } },
    { name: 'gate/recovery reply lines survive Telegram HTML: refs keep their *, no stray italics', run: () => {
      for (const payload of [
        { id: 'g', kind: 'gate', issues: [] },
        { id: 'r', kind: 'recovery', recovery: { message: 'x' } },
      ]) {
        const html = renderToHtml(renderQuestion(META, payload));
        assert.doesNotMatch(html, /<i>/, payload.kind);
        assert.match(html, /<code>\/approve \*2951<\/code>/, payload.kind);
      }
    } },
    { name: 'renderQuestion workflow: names the proposal and the three replies', run: () => {
      const msg = renderQuestion(META, { id: 'auto-1', kind: 'workflow', workflow: { name: 'Fix *login* flow', nodes: { a: {}, b: {}, c: {} } } });
      const body = msg.body[0].value;
      assert.equal(msg.severity, 'warning');
      assert.match(body, /proposed workflow \*\*Fix login flow\*\* \(3 agents\)/, 'markdown chars stripped from the name');
      assert.match(body, /`\/approve \*2951` to accept/);
      assert.match(body, /`\/answer \*2951 <what to change>` to revise/);
      assert.match(body, /`\/cancel \*2951` to cancel the run/);
      assert.doesNotMatch(body, /has questions/);
    } },
    { name: 'renderQuestion clarify: ordinals per option, /answer instructions, <your answer> form for free text', run: async () => {
      await checkRows([
        { name: 'renderQuestion clarify: ordinals per option + /answer instructions', run: async () => {
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
          assert.match(text, /\/answer \*2951 1 \| 1 {2}\(one answer per question, in order, separated by \|\)/);
        } },
        { name: 'renderQuestion instructs the pipe form when a question is free-text', run: async () => {
          const msg = renderQuestion({ runId: 'r-ab12' }, { kind: 'clarify', questions: [{ id: 'k', question: 'Name?', options: [] }] });
          assert.match(msg.body[0].value, /\/answer \*ab12 <your answer>/);
        } },
      ]);
    } },
    { name: 'renderQuestion recovery: cause + retry/pause reply line; renderTest is valid', run: () => {
      const msg = renderQuestion(META, {
        id: 'rec-1', kind: 'recovery',
        recovery: { message: 'claude exited 1: context canceled' },
        issues: [],
      });
      assert.match(msg.body[0].value, /recovery decision/);
      assert.match(msg.body[0].value, /\*\*Cause:\*\* claude exited 1/);
      assert.equal(isValidMessage(renderTest()), true);

      const q = renderQuestion(META, { id: 'r1', kind: 'recovery', recovery: { cls: 'auth', message: 'x' } });
      assert.match(q.body[0].value, /`\/abort \*2951` to pause the run/);
    } },
  ]);
});

test('renderDone/renderError: severity per outcome, truncation, unread directions and Away-mode answers', async () => {
  await checkRows([
    { name: 'renderDone: done/stopped/paused(+reason) — valid messages, right severity', run: () => {
      const done = renderDone(META, { status: 'done' });
      assert.equal(isValidMessage(done), true);
      assert.equal(done.severity, 'success');
      const text = done.body[0].value;
      assert.match(text, /\*2951/);
      assert.match(text, /Fix the login redirect loop/);
      assert.match(text, /12m34s/);
      assert.match(text, /\$1\.23/);
      assert.match(renderDone({ ...META, runEngine: 'cursor', totalCostUsd: 0 }, { status: 'done' }).body[0].value, /\*\*Cost:\*\* cost unknown/, 'Cursor: never $0.00');
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

      const errored = renderDone(META, { status: 'paused', reason: 'error', detail: 'claude exited with code 1: disk full' });
      assert.equal(errored.severity, 'error');
      assert.match(errored.body[0].value, /\*\*Status:\*\* paused — a step failed/);
      assert.match(errored.body[0].value, /\*\*Error:\*\* claude exited with code 1: disk full/);
      assert.match(errored.body[0].value, /\/resume \*2951/);

      // A self-parked recoverable pause is a WARNING with a cause, not a failure.
      const recoverable = renderDone(META, { status: 'paused', reason: 'recoverable', detail: 'auth: API Error: 401' });
      assert.equal(recoverable.severity, 'warning');
      assert.match(recoverable.body[0].value, /\*\*Status:\*\* paused — recoverable error/);
      assert.match(recoverable.body[0].value, /\*\*Cause:\*\* auth: API Error: 401/);

      // The detail is already bounded and MIDDLE-clipped upstream so the runner's
      // trailing cause survives; the message must not head-clip it away again.
      const long = `${'x'.repeat(133)}…${'y'.repeat(260)} THE CAUSE`;
      const tail = renderDone(META, { status: 'paused', reason: 'error', detail: long });
      assert.match(tail.body[0].value, /THE CAUSE/);
    } },
    { name: 'renderError truncates long messages', run: () => {
      const err = renderError(META, { message: 'x'.repeat(500) });
      assert.equal(isValidMessage(err), true);
      assert.equal(err.severity, 'error');
      assert.match(err.body[0].value, /x{300}…/);
    } },
    // ROUND 3, F8. _finalizeDirections was moved onto EVERY terminal path — its call
    // sites say "report an unread inbox on every terminal outcome" — but the line that
    // reports it was reachable only from the completed branch: `stopped` returns above
    // it and renderError never had it at all. On the two outcomes that comment singles
    // out (a run that is then stopped, or errors) the person who posted the direction
    // was never told it went unread, while the CLI and the audit line report it
    // regardless of status.
    { name: 'renderDone/renderError: an unread direction is reported on every terminal outcome', run: () => {
      const meta = { ...META, directions: { pending: [{ id: 'd1' }, { id: 'd2' }] } };
      for (const status of ['done', 'stopped']) {
        assert.match(renderDone(meta, { status }).body[0].value, /\*\*Directions pending:\*\* 2/,
          `${status} does not report the unread inbox`);
      }
      assert.match(renderError(meta, { message: 'boom' }).body[0].value, /\*\*Directions pending:\*\* 2/,
        'a failed run does not report the unread inbox');

      // ...and no line at all when the inbox was read, on any of them.
      for (const r of [renderDone(META, { status: 'done' }), renderDone(META, { status: 'stopped' }),
        renderError(META, { message: 'boom' })]) {
        assert.doesNotMatch(r.body[0].value, /Directions pending/);
      }
    } },
    { name: 'renderDone: a run Away mode answered says so, with how many to check', run: () => {
      for (const status of ['done', 'stopped', 'paused']) {
        const m = renderDone({ ...META, night: { decisions: 5, flagged: 2 } }, { status, reason: status === 'paused' ? 'manual' : undefined });
        assert.match(m.body[0].value, /\*\*Away mode:\*\* 5 answers while you were away — 2 to check/, status);
      }
      assert.match(renderError({ ...META, night: { decisions: 1, flagged: 1 } }, { message: 'x' }).body[0].value, /\*\*Away mode:\*\* 1 answer while you were away — 1 to check/);
      assert.doesNotMatch(renderDone(META, { status: 'done' }).body[0].value, /Away mode/);
    } },
  ]);
});

// Scheduled-run notifications render as chat messages.
// (/runs listing scheduled runs is covered in chat-command-router.test.mjs.)
test('renderSchedule: problem vs info, clipped', () => {
  const p = renderSchedule({ severity: 'problem', title: 'Nightly', message: 'was due at 02:00. Worca was not running.' });
  assert.equal(p.severity, 'warning');
  assert.match(JSON.stringify(p.body), /Schedule:\*\* Nightly/);
  const i = renderSchedule({ severity: 'info', title: 'x'.repeat(90), message: 'y'.repeat(400) });
  assert.equal(i.severity, 'info');
  assert.match(JSON.stringify(i.body), /…/);
});

test('renderDone: a usage limit an engine hit also offers /resume on each other engine', () => {
  const limit = renderDone(META, { status: 'paused', reason: 'usage_limit', detail: "You've hit your usage limit", limitEngine: 'codex' });
  assert.equal(isValidMessage(limit), true);
  assert.match(limit.body[0].value, /reply: \/resume \*2951\n/);
  assert.match(limit.body[0].value, /Or continue now on Claude: \/resume \*2951 claude \(may need Allow unguarded in the worca-cc UI\)\n   Or continue now on Cursor: \/resume \*2951 cursor \(may need Allow unguarded in the worca-cc UI\)\n   Or resume with another model from the worca-cc UI \(Resume › Resume with another model…\)$/);
  for (const payload of [
    { status: 'paused', reason: 'usage_limit', detail: "OpenRouter's free-model requests for today are used up" },
    { status: 'paused', reason: 'error', detail: 'disk full', limitEngine: 'codex' },
  ]) assert.doesNotMatch(renderDone(META, payload).body[0].value, /continue now on/, payload.reason);
});
