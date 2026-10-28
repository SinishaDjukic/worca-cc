// test/shape-ship.test.mjs — Ship as (D24) and the changelog entry (D25): src/core/shape/ship.mjs, pure, with recorded
// fake deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipFeature, onePrBody, SHIP_MODES, SHIP_CARD_VERBS, shipCardVerb } from '../src/core/shape/ship.mjs';

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
