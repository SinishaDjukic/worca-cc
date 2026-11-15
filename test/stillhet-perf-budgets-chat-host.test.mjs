// test/stillhet-perf-budgets-chat-host.test.mjs — B2.4 C1 (plans/rail/test-results/PLAN.md §3C, D19): Chat's performance
// budgets in the live Stillhet host (jsdom) on virtual time (test/helpers/stillhet-perf.mjs). An idle 200-turn chat, a
// history-pr frame that changes nothing and one live update are measured and held to test/fixtures/stillhet-perf-budgets.json:
// a number above its budget fails, one below fails until the JSON is lowered (budgets only go down).
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts, clone, SOURCES } from './helpers/stillhet-chat-live-host.mjs';
import { perfHost, longThread, readBudgets, checkBudget, countMutations, shellRenders, turnNodes, replacedTurns } from './helpers/stillhet-perf.mjs';

const { budgets, exclusions } = readBudgets();
afterEach(() => closeHosts());
/** Holds one measured number to its budget; the measurement is always printed (D12). */
function pin(t, key, measured, extra = '') {
  t.diagnostic(`budget ${key}: measured ${measured}, pinned ${budgets[key]?.value}`);
  const r = checkBudget(key, measured, budgets);
  assert.ok(r.ok, r.message + extra);
}
const openChat = (o = {}) => perfHost({ hash: '#chat/ask_1', thread: longThread(200), ...o });
// h2 under its project's key, as dev's history rows carry it, so a history-pr frame for it lands on its row. Deviation
// from the plan's web-1: h2 belongs to api in SOURCES and onPrs matches rows by projectKey|id, so a web-1 item would never
// land on h2 (the draw counts were the same, 1/2/1, either way)
const prSources = () => { const s = clone(SOURCES); s.history.pipelines = s.history.pipelines.map((p) => (p.id === 'h2' ? { ...p, projectKey: 'api-2' } : p)); return s; };
const PR = { url: 'https://github.com/acme/api/pull/7', state: 'OPEN', number: 7 };

// one idle window, measured once for the budget and the exclusions' use (R5)
let idle;
before(async () => {
  const h = await openChat();
  const m = countMutations(h.w, h.d.body, exclusions);
  await h.clock.advance(10_000);
  idle = m.stop();
  closeHosts();
});

test('B2.4 C1 harness: the long chat draws 200 turns and the virtual clock drives its thinking row', async () => {
  const h = await openChat();
  assert.equal(turnNodes(h.d).size, 200);
  const secs = h.d.querySelector('#route-chat [data-think-at] .think-t');
  assert.ok(secs, 'the reply being written shows its working row');
  const was = secs.textContent;
  await h.clock.advance(2000);   // the row started 0.1 s ago and reads 1s until its second second
  assert.notEqual(secs.textContent, was, 'a virtual second moved the seconds');
});

test('B2.4 C1 F-a1-02 F-a1-10: an idle 200-turn chat for 10 s makes no more DOM mutations than its budget', (t) => {
  t.diagnostic(`idle chat: ${idle.total} records, by exclusion ${JSON.stringify(idle.byExclusion)}`);
  pin(t, 'chatIdleMutations', idle.counted, `\n${idle.sample.join('\n')}`);
});

test('B2.4 C1 D7: every exclusion still matches something in the idle chat window (else drop it)', () => {
  for (const x of exclusions) assert.ok(idle.byExclusion[x.id] > 0, `drop exclusion "${x.id}": it no longer matches anything`);
});

/** Primes h2's PR, then sends `items` and the lookup's done frame, and counts the draws they cause. */
async function prFrame(h, items) {
  const token = h.w.RailTaskLive.prLookup().token;
  h.send({ type: 'history-pr', token, items: [{ projectKey: 'api-2', id: 'h2', pr: PR }] });
  await h.settleAll();
  let world = 0;
  h.w.RailWorld.onChange(() => { world++; });
  const shell = shellRenders(h.w), convo = h.convoPaints();
  h.send({ type: 'history-pr', token, items });
  h.send({ type: 'history-pr', token, done: true, items: [] });
  await h.settleAll();
  return { world, shell: shell.stop(), convo: h.convoPaints() - convo };
}

test('B2.4 C1 F-a1-02: a history-pr frame that changes nothing draws no more than its budget', async (t) => {
  const h = await openChat({ sources: prSources() });
  const n = await prFrame(h, [{ projectKey: 'api-2', id: 'h2', pr: PR }]);
  pin(t, 'prNoChangeWorldChanges', n.world);
  pin(t, 'prNoChangeShellRenders', n.shell);
  pin(t, 'prNoChangeConvoPaints', n.convo);
});

test('B2.4 C1 F-a1-02: a history-pr frame that does change a PR registers in the world and shell counters', async () => {
  const h = await openChat({ sources: prSources() });
  const n = await prFrame(h, [{ projectKey: 'api-2', id: 'h2', pr: { ...PR, state: 'MERGED' } }]);
  assert.ok(n.world >= 1, `world changes ${n.world}`);
  assert.ok(n.shell >= 1, `shell renders ${n.shell}`);
});

test('B2.4 C1 F-a1-10: one live update on a 200-turn chat replaces no more turns than its budget, and keeps the first', async (t) => {
  const h = await openChat();
  const was = turnNodes(h.d), first = was.get('anchor:u0');
  h.send({ type: 'ask-block', threadId: 'ask_1', messageId: 'mS', seq: 1, block: { kind: 'tool', id: 'tb1', name: 'Tool 1', status: 'running' } });
  h.frame();
  await h.settleAll();
  const now = turnNodes(h.d);
  pin(t, 'liveUpdateTurnsReplaced', replacedTurns(was, now), ` (${[...was].filter(([k, el]) => now.get(k) !== el).map(([k]) => k).join(', ')})`);
  assert.equal(now.get('anchor:u0'), first, 'the first turn is the same node');
});

test('B2.4 C1 F-a1-10: a live update for another chat replaces no turn of this one', async () => {
  const h = await openChat();
  const was = turnNodes(h.d);
  h.send({ type: 'ask-block', threadId: 'ask_2', messageId: 'mX', seq: 1, block: { kind: 'tool', id: 'tb2', name: 'Tool 2', status: 'running' } });
  h.frame();
  await h.settleAll();
  assert.equal(replacedTurns(was, turnNodes(h.d)), 0);
});
