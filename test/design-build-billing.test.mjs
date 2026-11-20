// test/design-build-billing.test.mjs
// Design P8 Task 5 (L8.11, L8.12, L8.13, L8.28): P2's billing context reaches every spawn of a round (the person who
// started or continued it pays, the design owner's agent runs it), the per-run cap is what a spawn may spend and no
// budget left means no spawn, and every design is claimed for its owner's agent at creation, start and Continue, a
// folder that cannot be claimed stopping it with a reason that names no path. Registries over the mock engine.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import express from 'express';
import { framesOf, newDesign, useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { currentBillTo, currentOwner, withBillTo } from '../src/core/billing.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { processBudgetUsd } from '../src/core/design/cost.mjs';
import { designDir, designWorkDir } from '../src/core/design/paths.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { getBuild, getDesign, updateBuild } from '../src/core/design/store.mjs';

const registries = [];
const servers = [];
after(async () => {
  for (const r of registries) { r.pauseAll(); await r.settled(); }
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});
useDesignEnv(after);

/** A registry whose every spawn is recorded as `{bill, owner, max, kind}`, read inside the spawn's own context. */
function mk({ claimDir = () => {}, deps = {} } = {}) {
  const frames = [];
  const spawns = [];
  const r = createDesignBuilds({
    broadcast: (f) => frames.push(f),
    claimDir,
    deps: {
      staggerMs: 0,
      retryDelayMs: 0,
      ...deps,
      runClaude: (o) => {
        spawns.push({ bill: currentBillTo(), owner: currentOwner(), max: o.maxBudgetUsd, kind: o.spawnKind });
        return runClaude({ ...o, mock: true });
      },
    },
  });
  registries.push(r);
  return { r, frames, spawns };
}

/** A recording `claimDir` that throws `fail` while it is set. */
function claims() {
  const seen = [];
  const rec = { seen, fail: null, claimDir: (dir, opts) => { seen.push([dir, opts]); if (rec.fail) throw rec.fail; } };
  return rec;
}

/** The two claims of one design, as `registry.claim` makes them. */
const claimed = (id, owner) => [
  [designDir(id), { owner, mode: 0o2750, sharedFallback: true }],
  [designWorkDir(id), { owner, sharedFallback: true }],
];

const ELOOP = () => Object.assign(new Error('/secret/path'), { code: 'ELOOP' });
const SAFE = "Could not prepare this design's folder (ELOOP)";

/** A build of `design` paused with `total-limit` before its first spawn: worca's total limit is open for `start`,
 *  reached at the spend gate, and open again for the Continue (`blocked` is asked once per check). */
async function pausedBeforeSpawn(readCaps) {
  let asked = 0;
  const reg = mk({ deps: { readCaps, budgetStatus: () => ({ blocked: (asked += 1) === 2 }) } });
  const d = newDesign({ createdBy: 'ada@example.com' });
  const { buildId } = await reg.r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'ada@example.com' });
  await reg.r.settled();
  assert.deepEqual([getBuild(buildId).status, getBuild(buildId).reason, reg.spawns.length], ['paused', 'total-limit', 0]);
  return { ...reg, d, buildId };
}

test('every spawn bills the round\'s person, as the design owner\'s agent', async () => {
  const { r, spawns } = mk();
  const d = newDesign({ createdBy: 'ada@example.com' });
  await withBillTo('someone-else@example.com', () => r.start({ designId: d.id, brief: 'MOCK_SECTIONS=2', by: 'ada@example.com' }));
  await r.settled();
  assert.ok(spawns.length >= 3, `spawns: ${spawns.length}`);
  for (const s of spawns) assert.deepEqual([s.bill, s.owner, s.kind], ['ada@example.com', 'ada@example.com', 'phase']);
  r.pauseAll(); await r.settled();
});

test('continue bills who pressed it, and keeps the owner\'s agent', async () => {
  const { r, spawns } = mk();
  const d = newDesign({ createdBy: 'ada@example.com' });
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'ada@example.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  r.pauseAll();
  await r.settled();
  assert.equal(getBuild(buildId).status, 'paused');
  const before = spawns.length;
  withBillTo('ada@example.com', () => r.continueBuild({ designId: d.id, buildId, by: 'bob@example.com' }));
  await waitUntil(() => spawns.length > before);
  assert.deepEqual([spawns.at(-1).bill, spawns.at(-1).owner], ['bob@example.com', 'ada@example.com']);
  r.pauseAll(); await r.settled();
});

test('maxBudgetUsd is what is left under the per-run cap', async () => {
  const capped = await pausedBeforeSpawn(async () => ({ perRunCapUsd: 10, totalCapUsd: null }));
  updateBuild(capped.buildId, { costUsd: 4 });
  capped.r.continueBuild({ designId: capped.d.id, buildId: capped.buildId, by: 'ada@example.com' });
  await capped.r.settled();
  assert.ok(capped.spawns.length > 0);
  assert.equal(capped.spawns[0].max, 6);

  // M13: Design has no spending limit of its own, so no per-run cap means no budget flag.
  const open = await pausedBeforeSpawn(async () => ({ perRunCapUsd: null, totalCapUsd: null }));
  updateBuild(open.buildId, { costUsd: 4 });
  open.r.continueBuild({ designId: open.d.id, buildId: open.buildId, by: 'ada@example.com' });
  await open.r.settled();
  assert.ok(open.spawns.length > 0);
  assert.equal(open.spawns[0].max, null);
  for (const { r } of [capped, open]) { r.pauseAll(); await r.settled(); }
});

test('no budget left means no spawn, never an uncapped one', async () => {
  const { r, frames, spawns, d, buildId } = await pausedBeforeSpawn(async () => ({ perRunCapUsd: 10, totalCapUsd: null }));
  updateBuild(buildId, { costUsd: 10 });
  const from = frames.length;
  r.continueBuild({ designId: d.id, buildId, by: 'ada@example.com' });
  await r.settled();
  assert.equal(spawns.length, 0, 'nothing spawns at the cap');
  const after = framesOf(frames.slice(from), 'design-build').filter((f) => f.buildId === buildId);
  assert.ok(after.length > 0, 'the Continue drove the round');
  assert.deepEqual([after.at(-1).status, after.at(-1).reason], ['paused', 'total-limit']);
  // A remaining budget at or below zero still caps the process at a cent: a non-positive one would mean no flag.
  assert.equal(processBudgetUsd({ remainingUsd: -1 }), 0.01);
  r.pauseAll(); await r.settled();
});

test('a folder that cannot be claimed stops the start, with a safe reason', async () => {
  const c = claims();
  const { r, spawns } = mk({ claimDir: c.claimDir });
  const d = newDesign({ createdBy: 'ada@example.com' });
  const paused = newDesign({ createdBy: 'ada@example.com' });
  const { buildId } = await r.start({ designId: paused.id, brief: 'MOCK_HANG_LEAD', by: 'ada@example.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  r.pauseAll();
  await r.settled();
  const ran = spawns.length;

  c.fail = ELOOP();
  await assert.rejects(r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'ada@example.com' }), (err) => {
    assert.deepEqual([err.status, err.message], [500, SAFE]);
    return true;
  });
  assert.equal(getDesign(d.id).currentBuild, null, 'the claim runs before the build is created');
  const rehydrate = DesignBuild.rehydrate;
  let rehydrated = 0;
  DesignBuild.rehydrate = (...a) => { rehydrated += 1; return rehydrate.apply(DesignBuild, a); };
  try {
    assert.throws(() => r.continueBuild({ designId: paused.id, buildId, by: 'ada@example.com' }), (err) => {
      assert.deepEqual([err.status, err.message], [500, SAFE]);
      return true;
    });
  } finally {
    DesignBuild.rehydrate = rehydrate;
  }
  assert.equal(rehydrated, 0, 'the claim runs before any rehydrate');
  assert.deepEqual([r.get(buildId), getBuild(buildId).status, spawns.length], [null, 'paused', ran], 'a refused Continue drives nothing');
  r.pauseAll(); await r.settled();
});

test('M6: a work/ that cannot be claimed stops the start and the Continue, the design folder claimed first', async () => {
  const c = claims();
  const { r, spawns } = mk({ claimDir: c.claimDir });
  const d = newDesign({ createdBy: 'ada@example.com' });
  const paused = newDesign({ createdBy: 'ada@example.com' });
  const { buildId } = await r.start({ designId: paused.id, brief: 'MOCK_HANG_LEAD', by: 'ada@example.com' });
  await waitUntil(() => r.liveAgentCount() === 1);
  r.pauseAll();
  await r.settled();
  const ran = spawns.length;
  // Only a work/ refuses (swapped for a folder or link worca does not own): the design folder's claim passes.
  const workOnly = (id) => (dir, opts) => { c.seen.push([dir, opts]); if (dir === designWorkDir(id)) throw ELOOP(); };

  c.seen.length = 0;
  r._claimDir = workOnly(d.id);
  await assert.rejects(r.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'ada@example.com' }), (err) => {
    assert.deepEqual([err.status, err.message], [500, SAFE]);
    return true;
  });
  assert.deepEqual(c.seen.map(([dir]) => dir), [designDir(d.id), designWorkDir(d.id)]);
  assert.equal(getDesign(d.id).currentBuild, null, 'no build is created');

  c.seen.length = 0;
  r._claimDir = workOnly(paused.id);
  const rehydrate = DesignBuild.rehydrate;
  let rehydrated = 0;
  DesignBuild.rehydrate = (...x) => { rehydrated += 1; return rehydrate.apply(DesignBuild, x); };
  try {
    assert.throws(() => r.continueBuild({ designId: paused.id, buildId, by: 'ada@example.com' }), (err) => {
      assert.deepEqual([err.status, err.message], [500, SAFE]);
      return true;
    });
  } finally {
    DesignBuild.rehydrate = rehydrate;
  }
  assert.deepEqual(c.seen.map(([dir]) => dir), [designDir(paused.id), designWorkDir(paused.id)]);
  assert.deepEqual([rehydrated, r.get(buildId), getBuild(buildId).status, spawns.length], [0, null, 'paused', ran], 'a refused Continue drives nothing');
  r.pauseAll(); await r.settled();
});

test('a design is claimed for its owner at creation, start and continue', async () => {
  const c = claims();
  const { r } = mk({ claimDir: c.claimDir });

  // Creation: the creator, once the design's thread is linked.
  const app = express();
  app.use(express.json());
  registerDesignRoutes(app, { deps: { designBuilds: r } });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((res) => srv.once('listening', res));
  servers.push(srv);
  const post = async (body) => {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/design`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'ada@example.com' }, body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const prevHeader = process.env.WORCA_IDENTITY_HEADER;
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  let made;
  let refused;
  try {
    made = await post({ kind: 'web' });
    assert.equal(made.status, 201);
    assert.deepEqual(c.seen, claimed(made.json.design.id, 'ada@example.com'));
    c.seen.length = 0;
    c.fail = ELOOP();
    refused = await post({ kind: 'web' });
  } finally {
    if (prevHeader === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prevHeader;
  }
  assert.deepEqual([refused.status, refused.json], [500, { error: SAFE }]);
  const kept = basename(c.seen[0][0]);
  assert.equal(typeof getDesign(kept)?.threadId, 'string', 'the refused design stays whole, its thread linked');
  await assert.rejects(r.start({ designId: kept, brief: 'MOCK_SECTIONS=1', by: 'ada@example.com' }), (err) => err.status === 500 && err.message === SAFE);
  c.fail = null;

  // Start and Continue: the design's owner, whoever pressed it; a design with no maker, the person.
  c.seen.length = 0;
  const d = newDesign({ createdBy: 'ada@example.com' });
  const { buildId } = await r.start({ designId: d.id, brief: 'MOCK_HANG_LEAD', by: 'bob@example.com' });
  assert.deepEqual(c.seen, claimed(d.id, 'ada@example.com'));
  await waitUntil(() => r.liveAgentCount() === 1);
  r.pauseAll();
  await r.settled();
  c.seen.length = 0;
  r.continueBuild({ designId: d.id, buildId, by: 'bob@example.com' });
  assert.deepEqual(c.seen, claimed(d.id, 'ada@example.com'));
  r.pauseAll();
  await r.settled();

  c.seen.length = 0;
  const orphan = newDesign({ createdBy: null });
  await r.start({ designId: orphan.id, brief: 'MOCK_HANG_LEAD', by: 'bob@example.com' });
  assert.deepEqual(c.seen, claimed(orphan.id, 'bob@example.com'));
  r.pauseAll(); await r.settled();
  assert.equal(made.json.design.createdBy, 'ada@example.com');
});
