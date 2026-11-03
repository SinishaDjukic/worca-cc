// tools/parity/timing.mjs — #919 slice 2: boot and page-load timings, interleaved, median of N, 10% budget.
import { startTarget } from './launch.mjs';

export const BUDGET_PCT = 10;
export const RUNS = 5;
export const NOISE_FLOOR_MS = { boot: 100, page: 50 };
export function median(v) { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function withinBudget(a, b, { pct = BUDGET_PCT, floorMs = 0 } = {}) {
  const deltaMs = b - a;
  const deltaPct = Math.round((deltaMs / a) * 1000) / 10;
  return { pass: b <= a * (1 + pct / 100) || deltaMs <= floorMs, deltaPct, deltaMs };
}

/** Interleaved boots, A then B, `runs` times: shared machine noise lands on both. */
export async function measureBoot(specA, specB, runs = RUNS, log = () => {}) {
  const a = []; const b = [];
  for (let i = 0; i < runs; i += 1) {
    for (const [name, spec, into] of [['A', specA, a], ['B', specB, b]]) {
      const t = await startTarget(spec); into.push(t.bootMs); await t.stop();
      log(`parity: ${name} ${spec.kind}:${spec.ref} — boot ${i + 1}/${runs} ${t.bootMs} ms`);
    }
  }
  return { a, b };
}

/** Navigation start → the boot marker (window.__np.getRun), interleaved over two pages already on their servers. */
export async function measurePageLoad(pageA, urlA, pageB, urlB, runs = RUNS) {
  const one = async (page, url) => {
    await page.goto('about:blank');   // a fresh document every sample: a hash-only goto is same-document, no load at all
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!(window.__np && window.__np.getRun));
    return page.evaluate(() => Math.round(performance.now()));
  };
  const a = []; const b = [];
  for (let i = 0; i < runs; i += 1) { a.push(await one(pageA, urlA)); b.push(await one(pageB, urlB)); }
  return { a, b };
}
