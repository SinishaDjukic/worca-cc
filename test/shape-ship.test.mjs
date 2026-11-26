// test/shape-ship.test.mjs — Ship as (D24) and the changelog entry (D25): src/core/shape/ship.mjs, pure, with recorded
// fake deps. Shaper small runs slice 4 (R-ux-3, R-qa-6): the list rule `shipChain` (pure), then the same rule read by
// Ship on real git branches in the temp home.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withEnv as withEnvVars } from './helpers/with-env.mjs';
import { GITCONFIG } from './helpers/base-world.mjs';
import { commitFile, g, head, isAncestorExit, minute, record, siblingKit, siblingRunsFeature } from './helpers/shape-sixteen-runs.mjs';
import { getDb } from '../src/core/db.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { chainBaseBranchesOf, getTicket } from '../src/core/scheduler.mjs';
import { featureView, shipOrder, smallRunsPrBase, stackedPrBase } from '../src/core/shape/features.mjs';
import { sliceSourceOf } from '../src/core/shape/chain.mjs';
import { shipFeature, onePrBody, SHIP_MODES, SHIP_CARD_VERBS, shipCardVerb } from '../src/core/shape/ship.mjs';
// A namespace read, so a missing new export (shipChain) fails only its own tests, not the whole file.
import * as SHIP from '../src/core/shape/ship.mjs';

useTempHome(after, 'worca-shape-ship-');
const root = mkdtempSync(join(tmpdir(), 'worca-shape-ship-proj-'));
after(() => rmSync(root, { recursive: true, force: true }));
before(() => { getDb(); });
// File-wide: every git command in this file reads a temp global config, not the machine's.
const GIT_ENV = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
const gitEnvBefore = Object.fromEntries(GIT_ENV.map((k) => [k, process.env[k]]));
before(() => {
  process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, GITCONFIG);
});
after(() => {
  for (const [k, v] of Object.entries(gitEnvBefore)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const pr = (n) => ({ url: `https://github.com/o/r/pull/${n}` });
const FEATURE = () => ({ id: 'feat_1', title: 'Charts', slices: [1, 2, 3].map((i) => ({
  index: i, title: `Slice ${i}`, pipelineId: `p${i}`, pr: pr(i), summary: `Did ${i}. More.`,
  checklistMd: `## Perspective checklist\n\n- [x] **product-${i}** ok` })) });

/** Fake deps that record every call; `over` replaces one. */
function fake(over = {}) {
  const calls = [];
  const rec = (name, answer) => async (...args) => { calls.push([name, ...args]); return typeof answer === 'function' ? answer(...args) : answer; };
  const deps = {
    commitChangelog: rec('commitChangelog', { ok: true }),
    push: rec('push', { ok: true }),
    openOnePr: rec('openOnePr', { ok: true, url: 'https://github.com/o/r/pull/9' }),
    adoptOnePr: rec('adoptOnePr', { ok: true }),
    markReady: rec('markReady', { ok: true }),
    close: rec('close', { ok: true }),
    refreshBody: rec('refreshBody', undefined),
    ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, rec(k, v)])),
  };
  return { deps, calls, names: () => calls.map((c) => c[0]) };
}

test('stacked: changelog, push, ready ×3 in slice order, then the body refresh; no one-PR calls', async () => {
  const f = fake();
  const out = await shipFeature({ feature: FEATURE(), mode: 'stacked' }, f.deps);
  assert.deepEqual(out, { ok: true, mode: 'stacked', prUrl: null, warnings: [] });
  assert.deepEqual(f.names(), ['commitChangelog', 'push', 'markReady', 'markReady', 'markReady', 'refreshBody', 'refreshBody', 'refreshBody']);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'markReady').map((c) => c[1]), [pr(1).url, pr(2).url, pr(3).url]);
  assert.equal(f.calls[0][1], 'p3', 'the changelog goes on the last slice\'s branch');
});

test('one PR: changelog, push, one PR with a section per slice, then every draft closed with its URL', async () => {
  const f = fake();
  const out = await shipFeature({ feature: FEATURE(), mode: 'one' }, f.deps);
  assert.equal(out.prUrl, 'https://github.com/o/r/pull/9');
  assert.equal(out.closed, 3);
  assert.deepEqual(f.names(), ['commitChangelog', 'push', 'openOnePr', 'close', 'close', 'close']);
  const open = f.calls[2][1];
  assert.equal(open.pipelineId, 'p3');
  assert.equal(open.title, 'Charts');
  assert.equal(open.body.match(/^## Slice \d/gm).length, 3);
  assert.equal(open.body.match(/Draft: https:\/\/github\.com\/o\/r\/pull\/\d \(closed\)/g).length, 3);
  assert.ok(!open.body.startsWith('Part of'));
  for (const c of f.calls.filter((x) => x[0] === 'close')) assert.equal(c[2], 'Shipped as one pull request: https://github.com/o/r/pull/9');
});

test('one PR where the forge answers with slice 3\'s draft: it is adopted, not closed', async () => {
  const f = fake({ openOnePr: { ok: true, url: pr(3).url, existed: true } });
  const out = await shipFeature({ feature: FEATURE(), mode: 'one' }, f.deps);
  assert.equal(out.prUrl, pr(3).url);
  const adopt = f.calls.find((c) => c[0] === 'adoptOnePr')[1];
  assert.equal(adopt.url, pr(3).url);
  assert.match(adopt.body, /## Slice 3: Slice 3[\s\S]*Draft: this pull request/);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'close').map((c) => c[1]), [pr(1).url, pr(2).url]);
  assert.equal(out.closed, 2);
});

test('refusals: no PR yet (409, nothing called), changelog (409) and push (500) failures stop before any PR call, a bad mode 400', async () => {
  const f = fake();
  const noPr = FEATURE(); noPr.slices[1].pr = null;
  // One ship flow: only stacked needs every slice PR (One makes its own).
  assert.deepEqual(await shipFeature({ feature: noPr, mode: 'stacked' }, f.deps), { ok: false, status: 409, error: 'slice 2 has no pull request yet' });
  assert.deepEqual(f.calls, []);
  const cl = fake({ commitChangelog: { ok: false, error: 'dirty' } });
  assert.equal((await shipFeature({ feature: FEATURE(), mode: 'one' }, cl.deps)).status, 409);
  assert.deepEqual(cl.names(), ['commitChangelog']);
  const push = fake({ push: { ok: false, error: 'rejected' } });
  assert.equal((await shipFeature({ feature: FEATURE(), mode: 'stacked' }, push.deps)).status, 500);
  assert.deepEqual(push.names(), ['commitChangelog', 'push']);
  assert.equal((await shipFeature({ feature: FEATURE(), mode: 'both' }, fake().deps)).status, 400);
  assert.deepEqual(SHIP_MODES, ['stacked', 'one']);
});

test('a failed ready on slice 2 stops: 500, slice 3 untouched', async () => {
  const f = fake({ markReady: (url) => (url === pr(2).url ? { ok: false, error: 'nope' } : { ok: true }) });
  const out = await shipFeature({ feature: FEATURE(), mode: 'stacked' }, f.deps);
  assert.deepEqual(out, { ok: false, status: 500, error: 'could not mark slice 2\'s PR ready: nope' });
  assert.deepEqual(f.calls.filter((c) => c[0] === 'markReady').map((c) => c[1]), [pr(1).url, pr(2).url]);
});

test('the changelog update: one ### Charts entry on an empty file, unchanged on its own output', async () => {
  let update = null;
  const f = fake({ commitChangelog: (pid, fn) => { update = fn; return { ok: true }; } });
  await shipFeature({ feature: FEATURE(), mode: 'stacked' }, f.deps);
  const once = update('');
  assert.equal(once.match(/^### Charts$/gm).length, 1);
  assert.match(once, /- Slice 1: Did 1\./);
  assert.equal(update(once), once);
});

test('the changelog names the carried runs too, in run order; they get no PR call', async () => {
  let update = null;
  const f = fake({ commitChangelog: (pid, fn) => { update = fn; return { ok: true }; } });
  const feature = FEATURE();
  const listed = [feature.slices[0], feature.slices[2]];
  await shipFeature({ feature: { ...feature, slices: listed, carried: [feature.slices[1]] }, mode: 'stacked' }, f.deps);
  assert.deepEqual(update('').match(/^- Slice \d/gm), ['- Slice 1', '- Slice 2', '- Slice 3']);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'markReady').map((c) => c[1]), [pr(1).url, pr(3).url]);
});

test('onePrBody: over maxBody the checklists are left out with a note; without it every checklist is kept', () => {
  const slices = FEATURE().slices.map((s) => ({ ...s, checklistMd: `## Perspective checklist\n\n${'- [x] item\n'.repeat(50)}` }));
  const full = onePrBody(slices);
  assert.equal(full.match(/## Perspective checklist/g).length, 3);
  const small = onePrBody(slices, null, { maxChars: 400 });
  assert.ok(!small.includes('## Perspective checklist'));
  assert.ok(small.endsWith('Each slice\'s checklist is in its closed draft.'));
});

// ── One ship flow (slice 2): slices open no PR on their own, so One may meet slices without one ──────────────────
const slice = (index, sp) => ({ index, title: `S${index}`, pipelineId: `p${index}`, pr: sp, summary: `sum ${index}`, checklistMd: '' });

test('one: no slice has a PR → 1 openOnePr, 0 close, a body with no Draft line', async () => {
  const f = fake();
  const feature = { id: 'f', title: 'Charts', slices: [slice(1, null), slice(2, null)] };
  const out = await shipFeature({ feature, mode: 'one' }, f.deps);
  assert.equal(out.ok, true);
  const opened = f.calls.filter((c) => c[0] === 'openOnePr');
  assert.equal(opened.length, 1);
  assert.doesNotMatch(opened[0][1].body, /Draft:/);
  assert.equal(f.calls.filter((c) => c[0] === 'close').length, 0);
});

test('one: only the slices that have a PR are closed; stacked still needs every slice PR', async () => {
  const f = fake();
  const feature = { id: 'f', title: 'Charts', slices: [slice(1, { url: 'https://github.com/o/r/pull/1' }), slice(2, null)] };
  const out = await shipFeature({ feature, mode: 'one' }, f.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'close').map((c) => c[1]), ['https://github.com/o/r/pull/1']);
  assert.match(f.calls.find((c) => c[0] === 'openOnePr')[1].body, /Draft: https:\/\/github\.com\/o\/r\/pull\/1 \(closed\)/);
  assert.equal((await shipFeature({ feature, mode: 'stacked' }, fake().deps)).status, 409);
});

test('one: a slice whose PR is already closed is neither closed again nor listed as a draft', async () => {
  const f = fake();
  const closed = { url: 'https://github.com/o/r/pull/1', state: 'CLOSED' };
  const feature = { id: 'f', title: 'Charts', slices: [slice(1, closed), slice(2, { url: 'https://github.com/o/r/pull/2', state: 'OPEN' })] };
  const out = await shipFeature({ feature, mode: 'one' }, f.deps);
  assert.equal(out.ok, true);
  assert.equal(out.closed, 1);
  assert.deepEqual(f.calls.filter((c) => c[0] === 'close').map((c) => c[1]), ['https://github.com/o/r/pull/2']);
  assert.doesNotMatch(f.calls.find((c) => c[0] === 'openOnePr')[1].body, /pull\/1/);
});

test('onePrBody: a slice without a PR gets its section and no Draft line', () => {
  const body = onePrBody([slice(1, null), slice(2, { url: 'u2' })], 'u2');
  assert.match(body, /## Slice 1: S1\n\nsum 1/);
  assert.equal((body.match(/Draft:/g) || []).length, 1);
  assert.match(body, /Draft: this pull request/);
});

test('shipCardVerb (s4): ship-one / ship-stacked / not-now, every other body 400', () => {
  assert.deepEqual(Object.keys(SHIP_CARD_VERBS), ['ship-one', 'ship-stacked', 'not-now']);
  for (const [body, mode] of [[{ verb: 'ship-one' }, 'one'], [{ verb: 'ship-stacked' }, 'stacked'], [{ verb: 'not-now' }, null]]) {
    const v = shipCardVerb(body);
    assert.equal(v.ok, true, JSON.stringify(body));
    assert.equal(v.mode, mode);
    assert.equal(v.release, null);
  }
  assert.deepEqual(shipCardVerb({ verb: 'ship-one', release: { version: 'v1.12.0' } }).release, { version: 'v1.12.0' });
  for (const body of [{ state: 'applied' }, { verb: 'revert' }, {}, null, [], { verb: 'not-now', release: { version: 'v1.0.0' } },
    { verb: 'ship-one', release: { version: 'bad' } }, { verb: 'toString' }]) {
    assert.equal(shipCardVerb(body).status, 400, JSON.stringify(body));
  }
});

test('onePrBody lists Satisfies under each slice with ids', () => {
  const body = onePrBody([
    { index: 1, title: 'One', summary: 'did one', pr: null, requirements: { ids: ['R-po-1', 'R-ux-1'], check: null } },
    { index: 2, title: 'Two', summary: 'did two', pr: null, requirements: { ids: [], check: null } },
    { index: 3, title: 'Three', summary: '', pr: null },
  ]);
  assert.ok(body.startsWith('## Slice 1: One\n\nSatisfies: R-po-1, R-ux-1\n\ndid one\n\n'), body);
  assert.equal(body.match(/Satisfies:/g).length, 1);
  const plain = [{ index: 1, title: 'One', summary: 'did one', pr: null }];
  assert.equal(onePrBody([{ ...plain[0], requirements: { ids: [], check: null } }]), onePrBody(plain));
});

test('headPipelineId: the changelog, push and one PR use that slice', async () => {
  const f = fake();
  await shipFeature({ feature: FEATURE(), mode: 'one', headPipelineId: 'p2' }, f.deps);
  assert.deepEqual(f.calls.filter((c) => ['commitChangelog', 'push'].includes(c[0])).map((c) => c[1]), ['p2', 'p2']);
  assert.equal(f.calls.find((c) => c[0] === 'openOnePr')[1].pipelineId, 'p2');
  // Without it (or naming no slice) the last row ships.
  for (const head of [undefined, 'p9']) {
    const g = fake();
    await shipFeature({ feature: FEATURE(), mode: 'one', ...(head ? { headPipelineId: head } : {}) }, g.deps);
    assert.equal(g.calls.find((c) => c[0] === 'openOnePr')[1].pipelineId, 'p3');
  }
});

// ---- Slice 4 (R-ux-3): the pure list rule. Rows are the finished runs in finish order; the last one is the head. -------
// A row of run `n`: on `feat/run-n`, based on `from` (a run number, or a branch name), carrying the runs `carries`.
const branchName = (x) => (typeof x === 'number' ? `feat/run-${x}` : x);
const row = (n, from, { carries = [], ...over } = {}) => ({ index: n, pipelineId: `p${n}`, branch: branchName(n),
  source: branchName(from), carries: carries.map(branchName), merged: false, pending: false, ...over });
const chainOfRows = (rows) => SHIP.shipChain(rows, { root: 'dev' });
const listed = (out) => out.order.map((o) => [o.index, o.base]);
const carriedBy = (out) => out.carried.map((c) => [c.index, c.by]).sort((a, b) => a[0] - b[0]);

test('shipChain: 7, 9, 8, 10 along the sources', () => {
  const out = chainOfRows([row(7, 'dev'), row(9, 7), row(8, 9, { carries: [9] }), row(10, 8)]);
  assert.deepEqual(out, { order: [
    { index: 7, pipelineId: 'p7', base: 'dev' }, { index: 9, pipelineId: 'p9', base: 'feat/run-7' },
    { index: 8, pipelineId: 'p8', base: 'feat/run-9' }, { index: 10, pipelineId: 'p10', base: 'feat/run-8' }], carried: [] });
});

test('shipChain: combine shape lists 7, 9, 10 and carries 8 by 10', () => {
  const out = chainOfRows([row(7, 'dev'), row(8, 7), row(9, 7), row(10, 9, { carries: [8] })]);
  assert.deepEqual(listed(out), [[7, 'dev'], [9, 'feat/run-7'], [10, 'feat/run-9']]);
  assert.deepEqual(out.carried, [{ index: 8, pipelineId: 'p8', by: 'p10' }]);
  assert.ok(out.order.every((o) => o.base !== 'feat/run-8'), 'no listed PR is based on a carried run\'s branch');
});

test('shipChain: the mirror lists 7, 8, 10 and carries 9', () => {
  const out = chainOfRows([row(7, 'dev'), row(9, 7), row(8, 7), row(10, 8, { carries: [9] })]);
  assert.deepEqual(listed(out), [[7, 'dev'], [8, 'feat/run-7'], [10, 'feat/run-8']]);
  assert.deepEqual(out.carried, [{ index: 9, pipelineId: 'p9', by: 'p10' }]);
});

test('shipChain: a run carried by a carried run is carried too, by the listed run', () => {
  const out = chainOfRows([row(1, 'dev'), row(2, 1), row(3, 1, { carries: [2] }), row(4, 1), row(5, 4, { carries: [3] })]);
  assert.deepEqual(listed(out), [[1, 'dev'], [4, 'feat/run-1'], [5, 'feat/run-4']]);
  assert.deepEqual(carriedBy(out), [[2, 'p5'], [3, 'p5']]);
});

test('shipChain: an unexplained finished run returns null', () => {
  assert.equal(chainOfRows([row(7, 'dev'), row(8, 7), row(9, 7), row(10, 9)]), null, 'nothing says run 8\'s work is in a listed run');
  // Carried by a run that is itself neither listed nor carried explains nothing.
  assert.equal(chainOfRows([row(1, 'dev'), row(2, 1), row(3, 1, { carries: [2] }), row(4, 1)]), null);
});

test('shipChain: a MERGED predecessor puts the next on the root', () => {
  const out = chainOfRows([row(7, 'dev'), row(9, 7, { merged: true }), row(8, 9), row(10, 8)]);
  assert.deepEqual(listed(out), [[7, 'dev'], [9, 'feat/run-7'], [8, 'dev'], [10, 'feat/run-8']]);
});

test('shipChain: a pending predecessor puts the next on the root', () => {
  const out = chainOfRows([row(7, 'dev'), row(9, 7, { pending: true }), row(8, 9), row(10, 8)]);
  assert.deepEqual(listed(out), [[7, 'dev'], [9, 'feat/run-7'], [8, 'dev'], [10, 'feat/run-8']], 'the pending run is still listed');
});

test('shipChain: two rows on one work branch walk the later finisher first', () => {
  // Run 8 changed nothing and kept no branch: its work branch is its source, run 7's.
  const out = chainOfRows([row(7, 'dev'), row(8, 7, { branch: 'feat/run-7' }), row(10, 7)]);
  assert.deepEqual(listed(out), [[7, 'dev'], [8, 'feat/run-7'], [10, 'feat/run-7']]);
  assert.deepEqual(out.carried, []);
});

test('shipChain: a cycle in sources stops (bounded)', () => {
  const out = chainOfRows([row(7, 8), row(8, 7)]);
  assert.deepEqual(listed(out), [[7, 'dev'], [8, 'feat/run-7']], 'each run is walked once');
  assert.equal(chainOfRows([row(6, 'dev'), row(7, 8), row(8, 7)]), null, 'a run the cycle never reaches is unexplained');
});

test('shipChain: a row with no branch or source is not walkable, and nothing throws', () => {
  assert.equal(chainOfRows([{ index: 1, pipelineId: 'p1' }, row(2, 1)]), null);
  assert.deepEqual(listed(chainOfRows([{ index: 1, pipelineId: 'p1' }])), [[1, 'dev']]);
  // A missing source never matches a missing branch.
  for (const none of [undefined, null]) {
    const bare = (n) => ({ index: n, pipelineId: `p${n}`, branch: none, source: none, carries: [], merged: false, pending: false });
    assert.equal(chainOfRows([bare(1), bare(2)]), null, String(none));
  }
});

test('shipChain: empty rows', () => {
  assert.deepEqual(chainOfRows([]), { order: [], carried: [] });
});

test('shipChain (R-arch-6): pure: no db, git or scheduler import; the same rows give the same answer and are not changed', () => {
  const src = readFileSync(new URL('../src/core/shape/ship.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports.filter((p) => /db\.mjs|git|scheduler|child_process|artifacts|features\.mjs/.test(p)), []);
  const rows = [row(7, 'dev'), row(8, 7), row(9, 7), row(10, 9, { carries: [8] })];
  const was = structuredClone(rows);
  assert.deepEqual(chainOfRows(rows), chainOfRows(rows));
  assert.deepEqual(rows, was);
});

// ---- Slice 4 (R-qa-6): Ship on real git branches. Runs 8 and 9 build on run 7, run 10 builds on 8 and 9. ---------------
const ON = { WORCA_FLAGS: 'shaperSmallRuns' };
const { siblingWorld, waitedRunHarness, doneSiblings, runTen } = siblingKit({ root, RunHarness });
const recordOf = (pid) => JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid).branch);
/** What Ship lists for the feature (the card's rows), what it opens (shipOrder) and the base of each of `runs`' PRs. */
function shipRead({ fx }, runs) {
  const view = featureView(fx.featureId);
  return {
    card: view.ship.smallRuns.order.map((o) => o.pipelineId),
    opened: shipOrder(view).map((s) => s.pipelineId),
    bases: runs.map((run) => stackedPrBase(fx.pipelineOf(run))),
    along: view.ship.smallRuns.along,
  };
}

test('R-qa-6: run 8 waits, takes in run 9; Ship lists 7 on the base, 9 on 7, 8 on 9, 10 on 8', () => withEnvVars(ON, async () => {
  const w = siblingWorld();
  const { repo, wt9, fx } = w;
  // Run 9 finishes while run 8 waits at its stop.
  g(wt9, 'add', '-A');
  g(wt9, 'commit', '-qm', 'nine.txt');
  fx.finish(9, { at: minute(1), branch: record(9) });
  // Run 8 takes run 9 in before it goes on, then finishes with that record (the harness's _persist is a stand-in).
  const eight = waitedRunHarness(w);
  assert.equal((await eight.h.takeInBeforeAnswer()).ok, true);
  fx.finish(8, { at: minute(2), branch: eight.record() });
  // Run 10 starts where the fire path picks.
  assert.equal(sliceSourceOf(getTicket(fx.ticketOf(10))).sourceBranch, 'feat/run-8');
  const wt10 = join(dirname(repo), 'wt10');
  g(repo, 'worktree', 'add', '-q', '-b', 'feat/run-10', wt10, 'feat/run-8');
  commitFile(wt10, 'ten.txt');
  fx.start(10, { branch: record(10, 'feat/run-8') });
  fx.finish(10, { at: minute(3) });

  const nine = head(repo, 'feat/run-9');
  assert.equal(isAncestorExit(repo, nine, 'feat/run-8'), 0, 'run 9\'s commit is in run 8\'s branch');
  assert.equal(isAncestorExit(repo, nine, 'feat/run-10'), 0, 'run 9\'s commit is in run 10\'s branch');

  const pids = [7, 9, 8, 10].map((run) => fx.pipelineOf(run));
  const ship = shipRead(w, [7, 9, 8, 10]);
  assert.deepEqual(ship.card, pids, 'runs 7, 9, 8 and 10, and no other pull request');
  assert.deepEqual(ship.opened, pids, 'Ship opens what the card lists');
  assert.deepEqual(ship.bases, ['dev', 'feat/run-7', 'feat/run-9', 'feat/run-8']);
  assert.equal(recordOf(fx.pipelineOf(8)).source, 'feat/run-9', 'run 8\'s recorded base');
  assert.equal(smallRunsPrBase(fx.pipelineOf(8)), recordOf(fx.pipelineOf(8)).source, 'Ship bases run 8 on its recorded base');
  assert.equal(ship.along, true, 'the list came from the real branches, not from the finish order');
}));

test('combine shape (no wait): Ship lists 7, 9, 10 and no PR for run 8', () => withEnvVars(ON, async () => {
  const w = doneSiblings({ eightAt: minute(1), nineAt: minute(2) });
  const { repo, fx } = w;
  assert.equal(sliceSourceOf(getTicket(fx.ticketOf(10))).sourceBranch, 'feat/run-9');
  const ten = runTen(w, 'feat/run-9');
  await ten.combine();   // merges run 8 in
  assert.equal(isAncestorExit(repo, w.eight, 'feat/run-10'), 0, 'run 8\'s work is in run 10\'s branch');
  // runTen seeds a pipeline row of its own: persist its record into the feature's run 10.
  fx.start(10, { branch: ten.record() });
  fx.finish(10, { at: minute(3), branch: ten.record() });
  assert.deepEqual(recordOf(fx.pipelineOf(10)).combined, [{ index: 2, branch: 'feat/run-8' }], 'run 10\'s record names what it combined');

  const pids = [7, 9, 10].map((run) => fx.pipelineOf(run));
  const ship = shipRead(w, [7, 9, 10]);
  assert.deepEqual(ship.card, pids, 'run 10\'s pull request carries run 8\'s work: run 8 gets none');
  assert.deepEqual(ship.opened, pids, 'Ship opens what the card lists');
  assert.deepEqual(ship.bases, ['dev', 'feat/run-7', 'feat/run-9']);
  assert.equal(ship.along, true);
}));

// A pin: it holds before and after the change.
test('unmarked feature: flag on lists the same PRs as flag off', async () => {
  const projectDir = mkdtempSync(join(root, 'unmarked-'));
  // The combine shape, where the small-runs rule would drop run 8.
  const fx = siblingRunsFeature({ projectDir, smallRuns: false });
  fx.finish(7, { at: minute(0) });
  for (const [run, branch] of [[8, record(8)], [9, record(9)],
    [10, { ...record(10, 'feat/run-9'), combined: [{ index: 2, branch: 'feat/run-8' }] }]]) {
    fx.start(run, { branch });
    fx.finish(run, { at: minute(run - 7) });
  }
  const read = () => {
    const view = featureView(fx.featureId);
    return { opened: shipOrder(view), ship: view.ship,
      bases: [7, 8, 9, 10].map((run) => stackedPrBase(fx.pipelineOf(run), chainBaseBranchesOf(fx.pipelineOf(run)))) };
  };
  const on = await withEnvVars(ON, read);
  const off = await withEnvVars({ WORCA_FLAGS: undefined }, read);
  assert.deepEqual(on, off);
  assert.equal(on.opened.length, 4, 'every run keeps its pull request');
  assert.equal(on.ship.smallRuns, undefined);
});
