// src/core/chat/receipts.mjs — the bot's own reaction on ONE inbound chat message: ⏳ while worca works on it, then ✅
// (its reply or action was delivered), ❌ (it failed), ⏹️ (it was stopped) or nothing (a refusal whose posted text is
// the answer). In memory only: a worca restart mid-turn can leave a stale ⏳ (documented limit).
// Reaction calls never block or change message handling. Each message has its own promise chain, so ⏳ is never removed
// before it was added and two messages never cross; transient failures retry a bounded number of times; every failure
// is logged (once per channel and error text) and never thrown.

export const MARK = Object.freeze({ work: '⏳', ok: '✅', fail: '❌', stop: '⏹️' });
/** Waits before the 2nd and 3rd try of a transient failure (the worker already retried 429s itself). */
export const REACT_RETRY_MS = Object.freeze([2000, 10000]);
const RETRY_AFTER_CAP_MS = 60 * 1000;
const LOGGED_KEEP = 200;
const FINAL = new Set(['ok', 'fail', 'stop']);

/** Set by the command router on a reply that reports a completed action although it renders as a warning (`/pause`,
 *  `/stop`). A symbol key: never serialized, never seen by a platform. */
export const ACTION_DONE = Symbol('worca.chat.actionDone');

/** A command reply → the mark its message ends with: an error reply failed, a warning is a refusal (no mark) unless it
 *  reports a completed action (ACTION_DONE), anything else (or no reply at all) completed. */
export function commandOutcome(reply) {
  if (reply && reply.severity === 'error') return 'fail';
  if (reply && reply.severity === 'warning' && reply[ACTION_DONE] !== true) return null;
  return 'ok';
}

const validTarget = (t) => !!t && typeof t === 'object' && typeof t.plugin === 'string' && typeof t.channelId === 'string'
  && typeof t.chatId === 'string' && t.chatId !== '' && typeof t.messageId === 'string' && t.messageId !== '';

/** deps: react({plugin, channelId, chatId, messageId, emoji, on}) → Promise (channelHost.react), log(level, msg),
 *  sleep(ms) (tests). A missing `react` makes every call a no-op. */
export function createReceipts({ react = null, log = () => {}, sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); }) } = {}) {
  const chains = new Map();
  const logged = new Set();

  function warnOnce(t, err, what) {
    const text = String(err?.message || err);
    const key = `${t.plugin}/${t.channelId}\u0000${text}`;
    if (logged.has(key)) return;
    if (logged.size >= LOGGED_KEEP) logged.clear();
    logged.add(key);
    log('warn', `reaction ${what} on message ${t.messageId} failed: ${text}`);
  }

  async function call(t, emoji, on) {
    for (let i = 0; ; i++) {
      try {
        await react({ plugin: t.plugin, channelId: t.channelId, chatId: t.chatId, messageId: t.messageId, emoji, on });
        return;
      } catch (err) {
        if (err?.permanent === true || i >= REACT_RETRY_MS.length) { warnOnce(t, err, `${on ? 'add' : 'remove'} ${emoji}`); return; }
        const after = Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0 ? Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS) : REACT_RETRY_MS[i];
        await sleep(after);
      }
    }
  }

  function enqueue(t, steps) {
    if (typeof react !== 'function' || !validTarget(t)) return Promise.resolve();
    const key = `${t.plugin}\u0000${t.channelId}\u0000${t.chatId}\u0000${t.messageId}`;
    const run = (chains.get(key) || Promise.resolve()).then(async () => { for (const [emoji, on] of steps) await call(t, emoji, on); });
    chains.set(key, run);
    run.finally(() => { if (chains.get(key) === run) chains.delete(key); });
    return run;
  }

  return {
    /** The message was accepted: ⏳. */
    ack: (t) => enqueue(t, [[MARK.work, true]]),
    /** Remove ⏳, then add the final mark ('ok' | 'fail' | 'stop'); null (a refusal) adds none. */
    settle: (t, outcome) => enqueue(t, [[MARK.work, false], ...(FINAL.has(outcome) ? [[MARK[outcome], true]] : [])]),
    /** Tests: every queued reaction call has finished. */
    idle: () => Promise.all([...chains.values()]).then(() => {}),
  };
}
