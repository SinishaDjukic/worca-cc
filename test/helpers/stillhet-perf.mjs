// test/helpers/stillhet-perf.mjs — B2.4 C1 (plans/rail/test-results/PLAN.md §3C, D19): the performance budgets' harness.
// The ratchet (readBudgets, checkBudget), the fixtures (longThread, tasksScaleSources) and a live Stillhet host on virtual
// time: setInterval is a registry that runs only when the clock advances, Date.now, a no-argument new Date() and
// performance.now read that clock and requestAnimationFrame is a manual queue. setTimeout stays real, so boot, fetch and
// debounce run as in the other hosts. Limit: Date called without new (a string) still reads real time.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { liveHost, go, settle, clone, SOURCES, THREAD, NOW } from './stillhet-chat-live-host.mjs';
import { scaleRuns } from './runs-scale.mjs';

export const BUDGETS_PATH = fileURLToPath(new URL('../fixtures/stillhet-perf-budgets.json', import.meta.url));
const REL = 'test/fixtures/stillhet-perf-budgets.json';

/** The ratchet file: `{budgets, exclusions}`. A missing or broken file throws; there is no fallback. */
export function readBudgets(path = BUDGETS_PATH) {
  const { budgets, exclusions } = JSON.parse(readFileSync(path, 'utf8'));
  return { budgets, exclusions };
}

/** One measured number against its budget (D6): above fails (grew), below fails until the JSON is lowered (shrank). */
export function checkBudget(key, measured, budgets) {
  const b = budgets?.[key];
  if (!b) return { ok: false, grew: false, shrank: false, message: `no budget "${key}" in ${REL}` };
  if (measured > b.value) return { ok: false, grew: true, shrank: false, message: `${key} grew: measured ${measured} > budget ${b.value} (D19: budgets only go down; fix the redraw, never raise the budget)` };
  if (measured < b.value) return { ok: false, grew: false, shrank: true, message: `${key} shrank to ${measured} (budget ${b.value}): good, now lower it in ${REL}` };
  return { ok: true, grew: false, shrank: false, message: `${key}: ${measured}` };
}

const iso = (ms) => new Date(ms).toISOString();
/** A `turns`-turn chat (D9): you/reply pairs, then one you turn and the reply being written (its working row, the orb). */
export function longThread(turns = 200) {
  const th = clone(THREAD), pairs = (turns - 2) / 2;
  th.messages = [];
  for (let i = 0; i < pairs; i++) {
    th.messages.push({ id: `u${i}`, role: 'user', text: `Question ${i}`, status: 'done', createdAt: iso(NOW - 3600e3 + i * 2000), blocks: [] });
    th.messages.push({ id: `a${i}`, role: 'assistant', text: `Answer ${i}`, status: 'done', createdAt: iso(NOW - 3600e3 + i * 2000 + 1000), blocks: [] });
  }
  th.messages.push({ id: 'uS', role: 'user', text: 'One more question', status: 'done', createdAt: iso(NOW - 200), blocks: [] });
  th.messages.push({ id: 'mS', role: 'assistant', text: '', status: 'streaming', createdAt: iso(NOW - 100), blocks: [] });
  th.runLinks = []; th.inFlight = { messageId: 'mS' };
  return th;
}

/**
 * SOURCES with a real-size Tasks world (D10): runs-scale's generator as history rows and live runs, 300 tasks.
 * Deviation from D10's `singles: 200`: each group's last member is a waiting schedule ticket, never a history row, so 200
 * singles give 280 tasks; 220 give the 300 the plan asks for (304 rows with the page's own Missed schedule row).
 */
export function tasksScaleSources() {
  const { live, history } = scaleRuns({ singles: 220, groups: 20, perGroup: 5 });
  const src = clone(SOURCES);
  src.history = { pipelines: history.map((p) => ({ id: p.id, title: p.title, status: p.status, projectName: 'web', projectKey: 'web-1', startedAt: p.startedAt, mtime: Date.parse(p.startedAt) })) };
  src.hello = { type: 'hello', runs: live.map((r) => ({ runId: r.runId, pipelineId: r.pipelineId, projectDir: '/src/web', title: r.title, status: r.status, startedAt: r.startedAt })) };
  return src;
}

/** The live host on virtual time (D2), opened on `hash` and settled. */
export async function perfHost({ hash = '#chat', sources = SOURCES, thread = THREAD } = {}) {
  let now = NOW, ids = 0;
  const intervals = new Map(), raf = new Map();
  const h = await liveHost({ sources, thread: () => [200, clone(thread)], beforeScripts: (win) => {
    const RealDate = win.Date, t0 = now;
    win.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
    Object.defineProperty(win.performance, 'now', { configurable: true, value: () => now - t0 });
    win.setInterval = (fn, ms = 0, ...args) => { const id = ++ids, every = Math.max(1, Number(ms) || 0); intervals.set(id, { fn, args, every, due: now + every }); return id; };
    win.clearInterval = (id) => { intervals.delete(id); };
    win.requestAnimationFrame = (f) => { raf.set(++ids, f); return ids; };
    win.cancelAnimationFrame = (id) => { raf.delete(id); };
  } });
  const { w, d, sockets, calls } = h;
  const paints = [];
  const orig = w.RailUI.patchKeyed;
  w.RailUI.patchKeyed = (c, items, opt) => { const r = orig(c, items, opt); paints.push(c); return r; };
  /** Runs the animation frames asked for so far (one frame: what they ask for runs at the next). */
  const frame = () => { const l = [...raf.values()]; raf.clear(); for (const f of l) f(now); };
  const pending = () => raf.size;
  const microtasks = async () => { for (let k = 0; k < 5; k++) await null; };
  const clock = {
    now: () => now,
    /** Moves the clock `ms` on in `step` slices: each slice runs the intervals due by then, in due order, then a frame. */
    advance: async (ms, step = 250) => {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + step);
        for (;;) {
          let next = null;
          for (const [id, it] of intervals) if (it.due <= now && (!next || it.due < next[1].due)) next = [id, it];
          if (!next) break;
          next[1].due += next[1].every;
          next[1].fn(...next[1].args);
        }
        await microtasks();
        frame();
        await microtasks();
      }
    },
  };
  /** Real settles and frames until no frame waits and nothing was fetched for 2 rounds. */
  const settleAll = async () => {
    let quiet = 0, seen = calls.length;
    for (let k = 0; k < 50; k++) {
      await settle(30); frame(); await microtasks();
      quiet = !pending() && calls.length === seen ? quiet + 1 : 0;
      seen = calls.length;
      if (quiet >= 2) return;
    }
    throw new Error('host never settled');
  };
  const send = (f) => sockets.at(-1).onmessage({ data: JSON.stringify(f) });
  const convoPaints = () => paints.filter((c) => c.matches('#route-chat .convo-col')).length;
  await go(w, hash);
  const id = hash.startsWith('#chat/') ? hash.split('/')[1] : '';   // a chat's first read has landed and is drawn
  for (let k = 0; id && k < 100 && !(w.RailChatLive?.state?.(id) === 'ready' && d.querySelector('#route-chat .convo-col')?.children.length > 3); k++) { frame(); await settle(20); }
  await settleAll();
  return { ...h, clock, frame, pending, settleAll, send, convoPaints };
}

const describe = (el) => {
  if (!el?.tagName) return String(el?.nodeName || el);
  const data = [...el.attributes].find((a) => a.name.startsWith('data-'));
  return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].slice(0, 2).map((c) => `.${c}`).join('') + (data ? `[${data.name}]` : '');
};
/**
 * Counts the mutation records under `root` (D3) until `stop()`: `counted` leaves out the records whose target (a text
 * node's parent element) matches an exclusion's selector, and `sample` names up to 10 counted ones.
 */
export function countMutations(w, root, exclusions = []) {
  const recs = [];
  const mo = new w.MutationObserver((l) => recs.push(...l));
  mo.observe(root, { childList: true, characterData: true, attributes: true, subtree: true });
  return {
    stop() {
      recs.push(...mo.takeRecords()); mo.disconnect();
      const byExclusion = Object.fromEntries(exclusions.map((x) => [x.id, 0])), sample = [];
      let counted = 0;
      for (const r of recs) {
        const el = r.type === 'characterData' ? r.target.parentElement : r.target;
        const hit = el?.matches && exclusions.find((x) => el.matches(x.selector));
        if (hit) { byExclusion[hit.id]++; continue; }
        counted++;
        if (sample.length < 10) sample.push(`${r.type} ${describe(el)}${r.attributeName ? ` ${r.attributeName}` : ''}`);
      }
      return { total: recs.length, counted, byExclusion, sample };
    },
  };
}

/**
 * Pulse's shell renders (D4): renderInShell patches #rail-pulse-slot with RailUI.patchParts once a call (B2.7 D8), so a
 * render is counted even when it writes nothing. `stop()` puts the original back.
 */
export function shellRenders(w) {
  let n = 0;
  const orig = w.RailUI.patchParts, slot = w.document.getElementById('rail-pulse-slot');
  w.RailUI.patchParts = (c, parts, opt) => { if (c === slot) n++; return orig(c, parts, opt); };
  return { stop() { w.RailUI.patchParts = orig; return n; } };
}

const TURN = '[data-anchor], [data-words-turn], [data-fold-turn], [data-think-at]';
/** The chat's turn nodes: the direct children of #route-chat .convo-col that are turns, keyed by what they carry. */
export function turnNodes(d) {
  const out = new Map();
  for (const el of d.querySelector('#route-chat .convo-col')?.children || []) {
    const t = el.matches(TURN) ? el : el.querySelector(TURN);
    if (!t) continue;
    const key = t.dataset.anchor ? `anchor:${t.dataset.anchor}` : t.dataset.wordsTurn ? `words:${t.dataset.wordsTurn}` : t.dataset.foldTurn ? `fold:${t.dataset.foldTurn}` : 'think';
    if (!out.has(key)) out.set(key, el);
  }
  return out;
}
/** Turns whose node was replaced or dropped between two `turnNodes` snapshots; one only in `after` is added, not counted. */
export function replacedTurns(before, after) {
  let n = 0;
  for (const [k, el] of before) if (after.get(k) !== el) n++;
  return n;
}
