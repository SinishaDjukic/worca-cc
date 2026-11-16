// test/artifacts-pr-state.test.mjs
// Phase 3.6 — withPr enrichment is unchanged (still shells out via git-info), now
// fed DB rows. Fixtures seed pipelines rows via the production writers (seedPipeline
// -> createPipeline + writeState) + store_meta instead of state.json + meta.json.
// seedPipeline mints the id; look up by the RETURNED id (A15(3)).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let home, prevHome, repo;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-prs-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests(); // open the DB under this temp home
  repo = await mkdtemp(join(tmpdir(), 'worca-cc-prs-repo-'));
});
after(async () => {
  gitInfo.reset();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});
beforeEach(() => gitInfo.reset());

// Fake runner: gh present, branch survives, and a PR (state/url, plus the draft and
// mergeability fields when given) exists for the head. Every `gh pr …` argv lands in `prCalls`.
function stubGh({ state = 'OPEN', url = 'https://gh/x/pull/5', number = 5, ...more } = {}, prCalls = []) {
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr') prCalls.push(args);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list')
      return Promise.resolve({ ok: true, stdout: JSON.stringify([{ number, state, url, ...more }]), stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

// Seed one finished pipeline (branch points at worca-cc/feat-1) via the production
// writers and return its MINTED id for lookups (A15(3)).
async function seed() {
  const { id } = await seedPipeline(repo, {
    title: 'Feat', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-1', branchKept: true },
  });
  return id;
}

test('withPr: live state when on, absent (no gh) when off, null when gh is missing or the PR closed', async () => {
  await checkRows([
    { name: 'withPr:true attaches the live PR state to each row', run: async () => {
      const { listPipelines } = await import('../src/core/artifacts.mjs');
      stubGh({ state: 'MERGED', url: 'https://gh/x/pull/5', number: 5 });
      const id = await seed();
      const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
      assert.deepEqual(row.pr, { state: 'MERGED', url: 'https://gh/x/pull/5', number: 5, isDraft: false, mergeable: 'UNKNOWN' });
    } },
    { name: 'withPr defaults off: no pr field, no gh call', run: async () => {
      gitInfo.reset(); // the beforeEach this row had as its own test
      const { listPipelines } = await import('../src/core/artifacts.mjs');
      let ghCalled = false;
      gitInfo.setRunner((cmd) => {
        if (cmd === 'gh') ghCalled = true;
        return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      });
      const id = await seed();
      const row = (await listPipelines(repo)).find((r) => r.id === id);
      assert.equal(row.pr, undefined);
      assert.equal(ghCalled, false);
    } },
    { name: 'withPr:true yields pr=null when gh is unavailable or the PR is closed', run: async () => {
      gitInfo.reset(); // the beforeEach this row had as its own test
      await checkRows([
        { name: 'withPr:true but gh unavailable -> pr is null, never throws', run: async () => {
          const { listPipelines } = await import('../src/core/artifacts.mjs');
          gitInfo.setRunner((cmd, args) =>
            Promise.resolve(cmd === 'gh' && args[0] === '--version'
              ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
              : { ok: true, stdout: '', stderr: '', code: 0 }));
          const id = await seed();
          const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
          assert.equal(row.pr, null);
        } },
        { name: 'withPr:true with only a closed PR -> pr is null (button re-appears)', run: async () => {
          gitInfo.reset(); // the beforeEach this row had as its own test
          const { listPipelines } = await import('../src/core/artifacts.mjs');
          stubGh({ state: 'CLOSED', url: 'https://gh/x/pull/6', number: 6 });
          const id = await seed();
          const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
          assert.equal(row.pr, null);
        } },
      ]);
    } },
  ]);
});

test('enrichPipelinesPr batches {projectKey,id,pr} with a final done; one empty batch without gh', async () => {
  await checkRows([
    { name: 'enrichPipelinesPr emits {projectKey,id,pr} batches; pr says draft and mergeability from the one gh call; final done=true', run: async () => {
      const { enrichPipelinesPr, writeStoreMeta } = await import('../src/core/artifacts.mjs');
      const { projectKey } = await import('../src/core/store.mjs');
      const prCalls = [];
      stubGh({ state: 'OPEN', url: 'https://gh/x/pull/7', number: 7, isDraft: false, mergeable: 'CONFLICTING' }, prCalls);
      const idA = await seed();
      await seed();
      // listAllPipelines derives each row's projectDir from the store_meta row; pin it
      // to the literal `repo` so the rows are PR-enrich targets.
      writeStoreMeta(projectKey(repo), 'project', { key: projectKey(repo), path: repo, name: 'Repo' });
      const collected = [];
      let finalDone = null;
      await enrichPipelinesPr((items, done) => { collected.push(...items); finalDone = done; }, { batchSize: 1 });
      const a = collected.find((x) => x.id === idA);
      assert.ok(a, 'seeded branch row was enriched');
      assert.deepEqual(Object.keys(a).sort(), ['id', 'pr', 'projectKey'], 'only {projectKey,id,pr}');
      assert.deepEqual(a.pr, { state: 'OPEN', url: 'https://gh/x/pull/7', number: 7, isDraft: false, mergeable: 'CONFLICTING' });
      const lists = prCalls.filter((a) => a[1] === 'list');
      assert.equal(lists.length, collected.length, 'one lookup per PR: no separate mergeability read');
      assert.ok(lists.every((args) => args.includes('number,state,url,isDraft,mergeable')));
      assert.ok(prCalls.filter((a) => a[1] !== 'list').every((a) => a[1] === 'view' && a[4] === 'isDraft,reviewDecision,mergeable,statusCheckRollup'),
        'the only other call is the OPEN PR’s CI verdict (D31)');
      assert.equal(finalDone, true, 'the final batch flags done=true');
    } },
    { name: 'enrichPipelinesPr sends a closed-only PR (the Runs list draws it) but never records it', run: async () => {
      gitInfo.reset(); // the beforeEach this row had as its own test
      const { enrichPipelinesPr, readPrState } = await import('../src/core/artifacts.mjs');
      stubGh({ state: 'CLOSED', url: 'https://gh/x/pull/8', number: 8 });
      const id = await seed();
      const collected = [];
      await enrichPipelinesPr((items) => { collected.push(...items); });
      const it = collected.find((x) => x.id === id);
      assert.ok(it, 'the new row was enriched');
      assert.equal(it.pr.state, 'CLOSED');
      assert.equal(it.pr.url, 'https://gh/x/pull/8');
      assert.equal(readPrState(id), null, 'pr_url keeps naming an open or merged PR only');
    } },
    { name: 'enrichPipelinesPr records the recorded PR itself closing, so it stops counting as open', run: async () => {
      gitInfo.reset();
      const { enrichPipelinesPr, readPrState, persistPrState } = await import('../src/core/artifacts.mjs');
      const id = await seed();
      persistPrState(id, { url: 'https://gh/x/pull/9', number: 9, state: 'OPEN' });
      stubGh({ state: 'CLOSED', url: 'https://gh/x/pull/9', number: 9 });
      await enrichPipelinesPr(() => {});
      assert.equal(readPrState(id).state, 'CLOSED');
      assert.equal(readPrState(id).url, 'https://gh/x/pull/9');
    } },
    { name: 'enrichPipelinesPr with gh unavailable emits exactly one empty final batch', run: async () => {
      gitInfo.reset(); // the beforeEach this row had as its own test
      const { enrichPipelinesPr } = await import('../src/core/artifacts.mjs');
      gitInfo.setRunner((cmd, args) =>
        Promise.resolve(cmd === 'gh' && args[0] === '--version'
          ? { ok: false, stdout: '', stderr: 'not found', code: 127 }
          : { ok: true, stdout: '', stderr: '', code: 0 }));
      await seed();
      const batches = [];
      await enrichPipelinesPr((items, done) => batches.push({ items, done }));
      assert.equal(batches.length, 1, 'exactly one batch when gh is unavailable');
      assert.deepEqual(batches[0], { items: [], done: true });
    } },
  ]);
});

// Quota stub: gh is present, but every `gh pr …` call fails as an exhausted GraphQL quota does.
function stubQuota() {
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr') return Promise.resolve({ ok: false, stdout: '', stderr: 'GraphQL: API rate limit exceeded', code: 1 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}

test('enrichPipelinesPr: a failed lookup never clears a known PR (F-3-01, F-7a-01, C-2)', async () => {
  const { enrichPipelinesPr, readPrState, persistPrState, writeStoreMeta } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  writeStoreMeta(projectKey(repo), 'project', { key: projectKey(repo), path: repo, name: 'Repo' });
  const url = 'https://gh/x/pull/5';
  const run = async () => {
    const batches = [];
    await enrichPipelinesPr((items, done) => batches.push({ items, done }), { batchSize: 1 });
    return batches;
  };
  const itemOf = (batches, id) => batches.flatMap((b) => b.items).find((x) => x.id === id);
  await checkRows([
    { name: 'a stored MERGED PR comes back stale on a quota failure, and the DB keeps it', run: async () => {
      gitInfo.reset();
      const id = await seed();
      persistPrState(id, { url, number: 5, state: 'MERGED' });
      stubQuota();
      const it = itemOf(await run(), id);
      assert.ok(it, 'the row is sent');
      assert.equal(it.pr.state, 'MERGED');
      assert.equal(it.pr.url, url);
      assert.equal(it.pr.stale, true);
      assert.equal(readPrState(id).state, 'MERGED');
    } },
    { name: 'a failed lookup with nothing stored omits the row; the final batch still says done', run: async () => {
      gitInfo.reset();
      const id = await seed();
      stubQuota();
      const batches = await run();
      assert.equal(itemOf(batches, id), undefined, 'never a null for a failed lookup');
      assert.equal(batches.at(-1).done, true);
      assert.equal(batches.filter((b) => b.done).length, 1, 'exactly one final batch');
    } },
    { name: 'a successful empty list after a stored MERGED PR still sends null', run: async () => {
      gitInfo.reset();
      const id = await seed();
      persistPrState(id, { url, number: 5, state: 'MERGED' });
      gitInfo.setRunner((cmd, args) => {
        if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
        if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') return Promise.resolve({ ok: true, stdout: JSON.stringify({ number: 5, state: 'CLOSED', url }), stderr: '', code: 0 });
        if (cmd === 'gh' && args[0] === 'pr') return Promise.resolve({ ok: true, stdout: '[]', stderr: '', code: 0 });
        return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      });
      const it = itemOf(await run(), id);
      assert.ok(it);
      // includeClosed: the recorded PR, now closed, is the last resort — a known answer, never stale.
      assert.equal(it.pr?.state ?? null, 'CLOSED');
      assert.equal('stale' in it.pr, false);
      gitInfo.setRunner((cmd, args) => {
        if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
        if (cmd === 'gh' && args[0] === 'pr') return Promise.resolve({ ok: true, stdout: '[]', stderr: '', code: 0 });
        return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      });
      const fresh = await seed();
      assert.equal(itemOf(await run(), fresh).pr, null, 'a genuine no PR still clears');
    } },
    { name: 'a successful lookup carries no stale key (classic unchanged)', run: async () => {
      gitInfo.reset();
      const id = await seed();
      stubGh({ state: 'MERGED', url, number: 5 });
      const it = itemOf(await run(), id);
      assert.equal(it.pr.state, 'MERGED');
      assert.equal('stale' in it.pr, false);
    } },
  ]);
});

// ── C-2 / F-X-02: the shared PR-status store and the quota window ───────────────────────────
import { _testing as prStatus, prStatusKey, writePrStatus } from '../src/core/pr-status-cache.mjs';
import { _testing as ghQuota } from '../src/core/github-quota.mjs';
import { getDb } from '../src/core/db.mjs';

// A GHE base remote: the store key is shared (ghe.corp/o/r) and the lookup is today's gh pr list.
const GHE_REMOTE = 'origin\tgit@ghe.corp:o/r.git (fetch)\norigin\tgit@ghe.corp:o/r.git (push)\n';
function stubShared({ list, calls = [] }) {
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'remote') return Promise.resolve({ ok: true, stdout: GHE_REMOTE, stderr: '', code: 0 });
    if (cmd === 'gh' && args[0] === 'pr') { calls.push(args); return list(args); }
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
}
async function ownRepo(branch) {
  const { writeStoreMeta } = await import('../src/core/artifacts.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-prs-own-'));
  writeStoreMeta(projectKey(dir), 'project', { key: projectKey(dir), path: dir, name: 'Own' });
  const { id } = await seedPipeline(dir, { title: 'Own', status: 'done', startedAt: '2026-06-01T00:00:00Z',
    branch: { source: 'main', feature: branch, branchKept: true } });
  return { dir, id };
}
const enrichAll = async () => {
  const { enrichPipelinesPr } = await import('../src/core/artifacts.mjs');
  const items = [];
  await enrichPipelinesPr((batch) => items.push(...batch), { batchSize: 4 });
  return items;
};

test('C-2: a known PR survives an exhausted quota on every history path', async () => {
  await checkRows([
    { name: 'C-2: listing a run (withPr) whose MERGED PR is stored shows it stale while the quota is exhausted, never null/Ready', run: async () => {
      gitInfo.reset();
      const { listPipelines, persistPrState } = await import('../src/core/artifacts.mjs');
      const id = await seed();
      persistPrState(id, { url: 'https://gh/x/pull/5', number: 5, state: 'MERGED' });
      stubQuota();
      const row = (await listPipelines(repo, { withPr: true })).find((r) => r.id === id);
      assert.equal(row.pr?.state, 'MERGED');
      assert.equal(row.pr.url, 'https://gh/x/pull/5');
      assert.equal(row.pr.stale, true);
      // Nothing known: still null (looked, cannot say), never a thrown error.
      const fresh = await seed();
      assert.equal((await listPipelines(repo, { withPr: true })).find((r) => r.id === fresh).pr, null);
    } },
    { name: 'C-2: with nothing in the DB, enrich sends the shared cache\'s last PR stale instead of omitting the row', run: async () => {
      gitInfo.reset();
      const branch = 'worca-cc/shared-last';
      stubShared({ list: () => Promise.resolve({ ok: false, stdout: '', stderr: 'HTTP 502', code: 1 }) });
      const tmpStore = await mkdtemp(join(tmpdir(), 'worca-cc-prs-store-'));
      prStatus.useDir(tmpStore); ghQuota.useDir(tmpStore);
      const { dir, id } = await ownRepo(branch);
      try {
        const open = { state: 'OPEN', url: 'https://ghe.corp/o/r/pull/4', number: 4, isDraft: false, mergeable: 'MERGEABLE' };
        await writePrStatus(prStatusKey({ repo: 'ghe.corp/o/r', head: branch }), { checkedAt: Date.now() - 11 * 60_000, live: open, closed: null, verdict: null });
        const it = (await enrichAll()).find((x) => x.id === id);
        assert.ok(it, 'the row is sent, not omitted');
        assert.equal(it.pr.state, 'OPEN');
        assert.equal(it.pr.url, open.url);
        assert.equal(it.pr.stale, true);
        const { readPrState } = await import('../src/core/artifacts.mjs');
        assert.equal(readPrState(id), null, 'the last state is never persisted');
      } finally {
        await rm(dir, { recursive: true, force: true }); await rm(tmpStore, { recursive: true, force: true });
      }
    } },
    { name: 'runEndedAt reaches the lookup: a month-old run with no PR is re-asked after 24 h, not 10 min', run: async () => {
      gitInfo.reset();
      const branch = 'worca-cc/month-old';
      const calls = [];
      stubShared({ calls, list: () => Promise.resolve({ ok: true, stdout: '[]', stderr: '', code: 0 }) });
      const tmpStore = await mkdtemp(join(tmpdir(), 'worca-cc-prs-store-'));
      prStatus.useDir(tmpStore);
      const { dir, id } = await ownRepo(branch);
      try {
        await writePrStatus(prStatusKey({ repo: 'ghe.corp/o/r', head: branch }), { checkedAt: Date.now() - 11 * 60_000, live: null, closed: null });
        const mine = () => calls.filter((a) => a.includes(branch)).length;
        getDb().prepare('UPDATE pipelines SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - 40 * 86_400_000).toISOString(), id);
        assert.equal((await enrichAll()).find((x) => x.id === id).pr, null);
        assert.equal(mine(), 0, 'a month-old run: "no PR" 11 minutes ago is still fresh');
        getDb().prepare('UPDATE pipelines SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
        await enrichAll();
        assert.equal(mine(), 1, 'a recent run: asked again after 10 min');
      } finally {
        await rm(dir, { recursive: true, force: true }); await rm(tmpStore, { recursive: true, force: true });
      }
    } },
  ]);
});

test('C1: a PR Worca recorded as MERGED never reads OPEN again from a cached or late answer', async () => {
  gitInfo.reset();
  const branch = 'worca-cc/merged-by-worca';
  const open = { state: 'OPEN', url: 'https://ghe.corp/o/r/pull/9', number: 9, isDraft: false, mergeable: 'MERGEABLE' };
  stubShared({ list: () => Promise.resolve({ ok: true, stdout: JSON.stringify([open]), stderr: '', code: 0 }) });
  const tmpStore = await mkdtemp(join(tmpdir(), 'worca-cc-prs-store-'));
  prStatus.useDir(tmpStore);
  const { dir, id } = await ownRepo(branch);
  try {
    const { persistPrState, readPrState, listPipelines } = await import('../src/core/artifacts.mjs');
    await enrichAll(); await enrichAll();            // the OPEN answer is cached, by branch and by URL
    assert.equal(readPrState(id).state, 'OPEN');
    persistPrState(id, { url: open.url, number: 9, state: 'MERGED' });   // what /api/pr/merge records
    const it = (await enrichAll()).find((x) => x.id === id);
    assert.equal(it.pr.state, 'MERGED');
    assert.equal(readPrState(id).state, 'MERGED', 'the DB row is not rewritten to OPEN');
    assert.equal((await listPipelines(dir, { withPr: true })).find((r) => r.id === id).pr.state, 'MERGED');
  } finally {
    await rm(dir, { recursive: true, force: true }); await rm(tmpStore, { recursive: true, force: true });
  }
});
