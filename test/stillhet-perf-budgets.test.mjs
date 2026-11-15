// test/stillhet-perf-budgets.test.mjs — B2.4 C1 (plans/rail/test-results/PLAN.md §3C, D19): the performance budgets'
// ratchet itself, with no host. test/fixtures/stillhet-perf-budgets.json holds the measured numbers the host tests
// (stillhet-perf-budgets-chat-host, -tasks-host) pin; a number only goes down, and the exclusion list only shrinks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readBudgets, checkBudget, tasksScaleSources } from './helpers/stillhet-perf.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// The first exclusion set, as measured when the budgets were written (D7a). NEVER add to it: a new ticker is a redraw the
// budget must hold, not something to hide. A fix that removes a ticker drops its entry here and in the JSON.
const FIRST_EXCLUSIONS = Object.freeze({
  'think-step': '[data-think-at] .think-w',
  'think-secs': '[data-think-at] .think-t',
  orb: 'canvas[data-orb]',
});
const KEYS = ['chatIdleMutations', 'prNoChangeWorldChanges', 'prNoChangeShellRenders', 'prNoChangeConvoPaints', 'liveUpdateTurnsReplaced', 'tasksIdleMutations', 'shellNoChangeMutations', 'projectsNoChangeMutations', 'settingsNoChangeMutations', 'tasksNoChangeMutations'];
const B = { budgets: { a: { value: 5, target: 0 } } };

test('B2.4 C1 D19: checkBudget fails a number that grew, with "budgets only go down"', () => {
  const r = checkBudget('a', 6, B.budgets);
  assert.deepEqual({ ok: r.ok, grew: r.grew, shrank: r.shrank }, { ok: false, grew: true, shrank: false });
  assert.equal(r.message, 'a grew: measured 6 > budget 5 (D19: budgets only go down; fix the redraw, never raise the budget)');
});

test('B2.4 C1 D19: checkBudget fails a shrink not yet written down, passes an equal number, fails an unknown key', () => {
  const s = checkBudget('a', 3, B.budgets);
  assert.deepEqual({ ok: s.ok, grew: s.grew, shrank: s.shrank }, { ok: false, grew: false, shrank: true });
  assert.equal(s.message, 'a shrank to 3 (budget 5): good, now lower it in test/fixtures/stillhet-perf-budgets.json');
  const e = checkBudget('a', 5, B.budgets);
  assert.deepEqual({ ok: e.ok, grew: e.grew, shrank: e.shrank }, { ok: true, grew: false, shrank: false });
  const u = checkBudget('b', 0, B.budgets);
  assert.equal(u.ok, false);
  assert.equal(u.message, 'no budget "b" in test/fixtures/stillhet-perf-budgets.json');
});

test('B2.4 C1 F-a1-02 F-a1-10: the budgets file has every key, integer values at or above target, real test files and finding ids', () => {
  const { budgets } = readBudgets();
  assert.deepEqual(Object.keys(budgets).sort(), [...KEYS].sort());
  for (const k of KEYS) {
    const b = budgets[k];
    assert.ok(Number.isInteger(b.value) && b.value >= 0, `${k}.value is a non-negative integer`);
    assert.ok(Number.isInteger(b.target) && b.value >= b.target, `${k}.value ${b.value} >= target ${b.target}`);
    assert.ok(existsSync(ROOT + b.test), `${k}.test ${b.test} exists`);
    assert.ok(Array.isArray(b.findings) && b.findings.length, `${k} names its findings`);
    for (const f of b.findings) assert.match(f, /^F-[\w-]+$/);
  }
});

test('B2.4 C1 D7: the exclusions are a subset of the first set, each with its first selector (the list only shrinks)', () => {
  const { exclusions } = readBudgets();
  assert.ok(Array.isArray(exclusions));
  const ids = exclusions.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'no id twice');
  for (const x of exclusions) {
    assert.ok(Object.hasOwn(FIRST_EXCLUSIONS, x.id), `exclusion "${x.id}" was added: the list only shrinks (D19); count the redraw instead`);
    assert.equal(x.selector, FIRST_EXCLUSIONS[x.id], `exclusion "${x.id}" changed its selector`);
    assert.ok(typeof x.why === 'string' && x.why, `exclusion "${x.id}" says why`);
  }
});

test('B2.4 C1 D7: no exclusion selector is broad enough to hide a regression', () => {
  const { exclusions } = readBudgets();
  for (const { id, selector } of exclusions) {
    assert.ok(!['*', 'body', '#app'].includes(selector.trim()), `exclusion "${id}" is ${selector}`);
    assert.ok(!selector.includes(','), `exclusion "${id}" is a selector list`);
  }
});

test('B2.4 C1 F-a1-02: tasksScaleSources gives a real-size Tasks world, keyed rows, a fresh clone each call', () => {
  const s = tasksScaleSources();
  const rows = s.history.pipelines.length + s.hello.runs.length;
  assert.ok(rows >= 300, `${rows} tasks`);
  assert.ok(s.history.pipelines.every((p) => p.projectKey && p.mtime), 'every history row has its project key and mtime');
  assert.ok(s.hello.runs.every((r) => r.runId && r.projectDir), 'every live row has its run id and project dir');
  const again = tasksScaleSources();
  assert.notEqual(again, s);
  assert.notEqual(again.history.pipelines, s.history.pipelines);
  assert.deepEqual(again, s);
});
