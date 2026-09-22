// The per-step evidence collector (money-saved design §3): cumulative numstat over the
// members (after intent-to-add staging — a new file is invisible to `git diff` otherwise),
// per-step delta, produced md/json outputs, verifier reads, and the serial queue that keeps
// concurrent terminals from crediting one delta twice. Uses real git repos.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';
import { diffNumstat } from '../src/core/git-info.mjs';
import { serialQueue, measureCodeCursor, codeDelta, collectStepEvidence } from '../src/core/graph/human-evidence.mjs';

const scratch = [];
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const head = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
const lines = (n, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n') + '\n';
/** The harness's _stageWorkingTree: intent-to-add, so `git diff <checkpoint>` sees new files. */
const stageAll = (dirs) => () => { for (const d of dirs) execFileSync('git', ['add', '-A', '-N'], { cwd: d }); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

test('serialQueue runs fns one after another and survives a rejection', async () => {
  const run = serialQueue();
  const order = [];
  await Promise.all([
    run(async () => { await delay(30); order.push('a'); }),
    run(async () => { order.push('b'); }),
    run(async () => { throw new Error('boom'); }).catch((e) => order.push(e.message)),
    run(async () => { order.push('c'); }),
  ]);
  assert.deepEqual(order, ['a', 'b', 'boom', 'c']);
});

test('measureCodeCursor: NEW files count only after staging; sums over every member; null without a checkpoint', async () => {
  const a = gitDir('hev-a'); const b = gitDir('hev-b'); scratch.push(a, b);
  const refs = { pa: head(a), pb: head(b) };
  writeFileSync(join(a, 'x.js'), lines(10));
  writeFileSync(join(b, 'y.js'), lines(5));
  writeFileSync(join(b, 'z.js'), lines(2));
  const workDirs = new Map([['pa', a], ['pb', b]]);
  const bare = await measureCodeCursor({ workDirs, checkpointRefs: refs, excludeFor: () => [], numstat: diffNumstat });
  assert.deepEqual(bare, { files: 0, insertions: 0, deletions: 0 }, 'untracked files are invisible to git diff');
  const cur = await measureCodeCursor({ workDirs, checkpointRefs: refs, excludeFor: () => [], numstat: diffNumstat, stage: stageAll([a, b]) });
  assert.deepEqual(cur, { files: 3, insertions: 17, deletions: 0 });
  assert.equal(await measureCodeCursor({ workDirs: new Map([['pa', a]]), checkpointRefs: {}, excludeFor: () => [], numstat: diffNumstat }), null);
});

test('measureCodeCursor honours the exclude pathspecs and survives a failing stage', async () => {
  const a = gitDir('hev-ex'); scratch.push(a);
  const refs = { pa: head(a) };
  writeFileSync(join(a, 'keep.js'), lines(4));
  mkdirSync(join(a, '.worca-cc'), { recursive: true });
  writeFileSync(join(a, '.worca-cc', 'noise.md'), lines(100));
  const cur = await measureCodeCursor({ workDirs: new Map([['pa', a]]), checkpointRefs: refs, excludeFor: () => [':(exclude).worca-cc'], numstat: diffNumstat, stage: stageAll([a]) });
  assert.deepEqual(cur, { files: 1, insertions: 4, deletions: 0 });
  const again = await measureCodeCursor({ workDirs: new Map([['pa', a]]), checkpointRefs: refs, excludeFor: () => [':(exclude).worca-cc'], numstat: diffNumstat, stage: () => { throw new Error('git gone'); } });
  assert.deepEqual(again, { files: 1, insertions: 4, deletions: 0 }, 'a failing stage still measures what is already visible');
});

test('codeDelta subtracts the previous cursor and clamps at zero', () => {
  assert.deepEqual(codeDelta({ files: 5, insertions: 100, deletions: 10 }, { files: 2, insertions: 40, deletions: 12 }), { files: 3, insertions: 60, deletions: 0 });
  assert.deepEqual(codeDelta({ files: 5, insertions: 100, deletions: 10 }, null), { files: 5, insertions: 100, deletions: 10 });
  assert.equal(codeDelta(null, null), null);
});

function fakeCtx(over = {}) {
  return {
    node: { kind: 'agent', key: 'acmeAnalyst' },
    ordinal: 1,
    meta: { runnerType: 'producer', sideEffect: undefined, humanEffort: undefined },
    ports: { inputs: [], outputs: [] },
    outputs: {}, bindings: {}, verdict: null,
    ...over,
  };
}

test('collectStepEvidence: md outputs count prose words, {vsuffix} -vN paths and cycle>1 are revisions, json counts items', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hev-out-')); scratch.push(dir);
  const plan = join(dir, 'feature.md'); writeFileSync(plan, 'a b c\n```\nx y z w\n```\nd');
  const planV2 = join(dir, 'feature-v2.md'); writeFileSync(planV2, 'one two');
  const verdict = join(dir, 'review-cycle1.json'); writeFileSync(verdict, JSON.stringify({ findings: [{}, {}, {}] }));
  const ctx = fakeCtx({
    ports: { inputs: [], outputs: [{ id: 'plan', type: 'md', filename: '{base}{vsuffix}.md' }, { id: 'revise', type: 'md', filename: '{base}{vsuffix}.md' }, { id: 'pass', type: 'void' }] },
    outputs: { plan: { path: plan }, revise: { path: plan } },
    verdict: { path: verdict },
  });
  const e = await collectStepEvidence({ ctx, cursorPrev: null, cursorNow: null });
  assert.equal(e.nodeKind, 'agent');
  assert.deepEqual(e.agent, { runnerType: 'producer', sideEffect: undefined, humanEffort: undefined });
  assert.equal(e.cycle, 1);
  assert.equal(e.code, null);
  assert.deepEqual(e.outputs, [{ type: 'md', words: 4, revision: false }, { type: 'json', items: 3 }]);  // one path → one output
  assert.equal(e.reads, null);
  const rev = await collectStepEvidence({ ctx: fakeCtx({ ports: { inputs: [], outputs: [{ id: 'plan', type: 'md', filename: '{base}{vsuffix}.md' }] }, outputs: { plan: { path: planV2 } } }), cursorPrev: null, cursorNow: null });
  assert.deepEqual(rev.outputs, [{ type: 'md', words: 2, revision: true }]);
  // A base name that happens to end in -v2 is NOT a revision when the template carries no {vsuffix}.
  const named = await collectStepEvidence({ ctx: fakeCtx({ ports: { inputs: [], outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }] }, outputs: { plan: { path: planV2 } } }), cursorPrev: null, cursorNow: null });
  assert.deepEqual(named.outputs, [{ type: 'md', words: 2, revision: false }]);
  const c2 = await collectStepEvidence({ ctx: fakeCtx({ ordinal: 2, ports: { inputs: [], outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }] }, outputs: { plan: { path: plan } } }), cursorPrev: null, cursorNow: null });
  assert.deepEqual(c2.outputs, [{ type: 'md', words: 4, revision: true }]);
});

test('collectStepEvidence: a missing output file is simply not listed; unreadable json is 0 items', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hev-miss-')); scratch.push(dir);
  const bad = join(dir, 'v.json'); writeFileSync(bad, '{not json');
  const ctx = fakeCtx({ ports: { inputs: [], outputs: [{ id: 'plan', type: 'md', filename: 'x.md' }] }, outputs: { plan: { path: join(dir, 'never.md') } }, verdict: { path: bad } });
  const e = await collectStepEvidence({ ctx, cursorPrev: null, cursorNow: null });
  assert.deepEqual(e.outputs, [{ type: 'json', items: 0 }]);
});

test('collectStepEvidence: code delta only for agent nodes; verifiers read the diff at step start and their md inputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hev-read-')); scratch.push(dir);
  const planIn = join(dir, 'plan.md'); writeFileSync(planIn, 'w '.repeat(600));
  const prev = { files: 2, insertions: 300, deletions: 5 };
  const now = { files: 4, insertions: 900, deletions: 20 };
  const producer = await collectStepEvidence({ ctx: fakeCtx(), cursorPrev: prev, cursorNow: now });
  assert.deepEqual(producer.code, { files: 2, insertions: 600, deletions: 15 });
  assert.equal(producer.reads, null);
  const verifier = await collectStepEvidence({
    ctx: fakeCtx({
      meta: { runnerType: 'verifier' },
      ports: { inputs: [{ id: 'plan', type: 'md' }, { id: 'done', type: 'void', as: 'worktree' }], outputs: [] },
      bindings: { plan: { type: 'md', path: planIn }, done: { type: 'void', path: null } },
    }),
    cursorPrev: prev, cursorNow: now,
  });
  assert.deepEqual(verifier.reads, { diffLines: 305, words: 600 });
  const noWorktree = await collectStepEvidence({
    ctx: fakeCtx({ meta: { runnerType: 'verifier' }, ports: { inputs: [{ id: 'plan', type: 'md' }], outputs: [] }, bindings: { plan: { type: 'md', path: planIn } } }),
    cursorPrev: prev, cursorNow: now,
  });
  assert.deepEqual(noWorktree.reads, { diffLines: 0, words: 600 });
  const script = await collectStepEvidence({ ctx: fakeCtx({ node: { kind: 'script', key: 'fmt' }, meta: {} }), cursorPrev: prev, cursorNow: now });
  assert.equal(script.nodeKind, 'script');
  assert.equal(script.agent, null);
  assert.equal(script.code, null);
});
