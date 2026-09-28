// src/broker/limits.mjs
// Spend and load limits (plans/credential-broker-design.html §6.4 step 4): the
// worst a rogue agent can do is burn credits, and these cap how many. In memory:
// concurrency per token and per person+slot, requests per minute per person+slot.
// Budgets read the usage table (cached briefly) against the person's own cap, the
// operator default, and the token's own budget.

const DAY_MS = 86_400_000;
const SPEND_CACHE_MS = 10_000;

export function startOfUtcDay(now) { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime(); }
export function startOfUtcMonth(now) { const d = new Date(now); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.getTime(); }

export function createLimits({ store, config, now = Date.now }) {
  const active = new Map();        // key -> count
  const windows = new Map();       // person|slot -> [timestamps]
  const spendCache = new Map();    // person|slot|period -> {at, usd}

  const inc = (k) => active.set(k, (active.get(k) || 0) + 1);
  const dec = (k) => { const n = (active.get(k) || 1) - 1; if (n <= 0) active.delete(k); else active.set(k, n); };

  function spent(billTo, slot, period) {
    const key = `${billTo}|${slot}|${period}`;
    const t = now();
    const hit = spendCache.get(key);
    if (hit && t - hit.at < SPEND_CACHE_MS) return hit.usd;
    const since = period === 'day' ? startOfUtcDay(t) : startOfUtcMonth(t);
    const usd = store.spentSince(billTo, slot, since);
    spendCache.set(key, { at: t, usd });
    return usd;
  }

  return {
    /**
     * Admit one request, or say why not. On admission the caller MUST call release().
     * @returns {{release: () => void} | {status:number, kind:'rate'|'budget', message:string, retryAfter?:number}}
     */
    acquire({ tokenRow, slot, credentialRow = null }) {
      const person = tokenRow.bill_to;
      const lim = slot.limits || {};
      const perToken = Number(lim.concurrencyPerToken) || 8;
      const perPerson = Number(lim.concurrencyPerPerson) || 16;
      const rpm = Number(lim.rpmPerPerson) || 240;

      // Budgets first: a spent budget is not cleared by waiting.
      if (tokenRow.budget_usd != null && tokenRow.spent_usd >= tokenRow.budget_usd) {
        return { status: 403, kind: 'budget', message: `quota reached: this spawn's budget of $${fmt(tokenRow.budget_usd)} is spent` };
      }
      const daily = credentialRow?.daily_usd ?? config.defaultDailyUsd;
      if (daily != null && spent(person, slot.id, 'day') >= daily) {
        return { status: 403, kind: 'budget', message: `quota reached: daily budget of $${fmt(daily)} for ${person} on ${slot.id}` };
      }
      const monthly = credentialRow?.monthly_usd ?? config.defaultMonthlyUsd;
      if (monthly != null && spent(person, slot.id, 'month') >= monthly) {
        return { status: 403, kind: 'budget', message: `quota reached: monthly budget of $${fmt(monthly)} for ${person} on ${slot.id}` };
      }

      const tk = `t:${tokenRow.hash}`;
      const pk = `p:${person}|${slot.id}`;
      if ((active.get(tk) || 0) >= perToken || (active.get(pk) || 0) >= perPerson) {
        return { status: 429, kind: 'rate', message: 'too many concurrent requests, retry after 2 seconds', retryAfter: 2 };
      }
      const t = now();
      const w = (windows.get(pk) || []).filter((x) => t - x < 60_000);
      if (w.length >= rpm) {
        const wait = Math.max(1, Math.ceil((60_000 - (t - w[0])) / 1000));
        windows.set(pk, w);
        return { status: 429, kind: 'rate', message: `too many requests per minute, retry after ${wait} seconds`, retryAfter: wait };
      }
      w.push(t);
      windows.set(pk, w);
      inc(tk); inc(pk);
      let released = false;
      return { release() { if (released) return; released = true; dec(tk); dec(pk); } };
    },
    /** Forget cached spend for a person (after a usage row lands, budgets see it within 10 s anyway). */
    invalidate(billTo, slot) {
      for (const p of ['day', 'month']) spendCache.delete(`${billTo}|${slot}|${p}`);
    },
    _active: active,
  };
}

function fmt(n) {
  return Number(n).toFixed(2).replace(/\.00$/, '');
}

export { DAY_MS };
