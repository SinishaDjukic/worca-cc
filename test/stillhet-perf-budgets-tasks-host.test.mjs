// test/stillhet-perf-budgets-tasks-host.test.mjs — B2.4 C1 (plans/rail/test-results/PLAN.md §3C, D19): the Tasks page's
// idle budget in the live Stillhet host (jsdom) on virtual time (test/helpers/stillhet-perf.mjs). #runs with a real-size
// world (300 tasks), every fold and "Show N more" opened, idle for 10 s: its DOM mutations, counted with Chat's
// exclusions, are held to tasksIdleMutations in test/fixtures/stillhet-perf-budgets.json (budgets only go down).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts } from './helpers/stillhet-chat-live-host.mjs';
import { perfHost, tasksScaleSources, readBudgets, checkBudget, countMutations } from './helpers/stillhet-perf.mjs';

const { budgets, exclusions } = readBudgets();
afterEach(() => closeHosts());
const ROWS = '#runs-root .list-row';
/** #runs on the real-size world, with every shut section and every "Show N more" opened: the list draws all its rows. */
async function openTasks() {
  const h = await perfHost({ hash: '#runs', sources: tasksScaleSources() });
  const root = h.d.getElementById('runs-root');
  for (let k = 0; k < 40; k++) {
    const b = root.querySelector('[data-fold-section][aria-expanded="false"], [data-more]');
    if (!b) break;
    b.click();
    await h.settleAll();
  }
  return h;
}

test('B2.4 C1 harness: #runs on the real-size world draws every task the page counts, and far more than 50', async () => {
  const h = await openTasks();
  const drawn = h.d.querySelectorAll(ROWS).length;
  const counted = [...h.d.querySelectorAll('#runs-root .list-h .n')].reduce((s, n) => s + Number(n.textContent), 0);
  assert.ok(counted >= 300, `the section heads count ${counted} tasks`);
  assert.ok(drawn >= counted, `${drawn} rows drawn of the ${counted} the page counts`);
  assert.ok(drawn > 50);
  assert.equal(h.d.querySelector('#runs-root [data-more]'), null, 'nothing left behind Show N more');
});

test('B2.4 C1 F-a1-02: an idle Tasks page (300 tasks) for 10 s makes no more DOM mutations than its budget', async (t) => {
  const h = await openTasks();
  // only Chat's window judges the exclusions (D7b): a ticker seen only here is never excluded, its records count
  const m = countMutations(h.w, h.d.body, exclusions);
  await h.clock.advance(10_000);
  const r = m.stop();
  t.diagnostic(`budget tasksIdleMutations: measured ${r.counted}, pinned ${budgets.tasksIdleMutations?.value} (${r.total} records over ${h.d.querySelectorAll(ROWS).length} rows)`);
  const c = checkBudget('tasksIdleMutations', r.counted, budgets);
  assert.ok(c.ok, `${c.message}\n${r.sample.join('\n')}`);
});

test('B2.7 C1 F-a1-02 F-a4-02: a no-change shell redraw with the Pulse popover open makes no more DOM mutations than its budget', async (t) => {
  const h = await perfHost({ hash: '#runs', sources: tasksScaleSources() });
  h.w.RailPulse.open('updates'); h.w.RailPulse.refresh();   // open, then drawn once more: its opening fade is gone
  await h.settleAll();
  const m = countMutations(h.w, h.d.body, exclusions);
  h.w.RailPulse.refresh(); h.w.RailPulse.refresh();
  await h.settleAll();
  const r = m.stop();
  t.diagnostic(`budget shellNoChangeMutations: measured ${r.counted}, pinned ${budgets.shellNoChangeMutations?.value} (${r.total} records)`);
  const c = checkBudget('shellNoChangeMutations', r.counted, budgets);
  assert.ok(c.ok, `${c.message}\n${r.sample.join('\n')}`);
});

test('B2.8 F-fm-01: a project-sync-changed frame that changes no task keeps every Tasks row and makes no more DOM mutations than its budget', async (t) => {
  const h = await openTasks();
  const rows = [...h.d.querySelectorAll(ROWS)];
  const m = countMutations(h.w, h.d.getElementById('runs-root'), exclusions);   // the Tasks list; the other bars and the center are theirs
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'project-sync-changed', projectKey: 'web-1' }) });
  await new Promise((r) => setTimeout(r, 400)); await h.settleAll();   // the adapter reads a source 250 ms after its frame
  const r = m.stop();
  t.diagnostic(`budget tasksNoChangeMutations: measured ${r.counted}, pinned ${budgets.tasksNoChangeMutations?.value} (${r.total} records)`);
  assert.ok(rows.length > 50 && rows.every((el) => el.isConnected), 'every row keeps its node');
  const c = checkBudget('tasksNoChangeMutations', r.counted, budgets);
  assert.ok(c.ok, `${c.message}\n${r.sample.join('\n')}`);
});
