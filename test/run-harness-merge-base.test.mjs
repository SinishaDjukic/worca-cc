// test/run-harness-merge-base.test.mjs
// A run's diff counts only its own work when its branch picks up base-branch commits during the run. A merge of a
// commit a base ref contains (the source branch, the default branch, their remote-tracking refs, a conflict run's
// `mergeIn`) moves the diff base to a deterministic synthetic commit whose tree is `git merge-tree --write-tree
// <start> <theirs>`; a fast-forward moves it to the newest base commit; a rebase or reset onto a newer base moves it to
// git's own replay of the start onto that base, or the base itself. Its own world (bare origin + clone A + teammate),
// so a new file: run-harness-sync is about Sync.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
// A namespace read, so a missing new export fails only its own test, not the whole file.
import * as HARNESS from '../src/core/run-harness.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { projectKey } from '../src/core/store.mjs';
import { getDb } from '../src/core/db.mjs';
import { autoMergeBase, DIFF_BASE_REF_PREFIX } from '../src/core/worktree.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateWorld } from './helpers/git-dir.mjs';

useTempHome(after);

const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-rhmb-'));
const envKeys = ['HOME', 'USERPROFILE', 'WORCA_RUN_ROOT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
const prevEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
writeFileSync(join(scratch, 'gitconfig'), '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n');
process.env.HOME = scratch;
process.env.USERPROFILE = scratch;
process.env.GIT_CONFIG_GLOBAL = join(scratch, 'gitconfig');
process.env.GIT_CONFIG_NOSYSTEM = '1';
delete process.env.WORCA_RUN_ROOT;
after(() => {
  for (const k of envKeys) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(scratch, { recursive: true, force: true });
});

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${cwd}): ${r.stderr}`);
  return r.stdout.trim();
}
const gitStatus = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).status;
const sha = (cwd, ref) => git(cwd, ['rev-parse', ref]);
const lines = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n') + '\n';
const SHARED = (mid) => ['s0', 's1', 's2', 's3', 's4', mid, 's6', 's7', 's8', 's9'].join('\n') + '\n';
const MATES = ['mate1.txt', 'mate2.txt', 'mate3.txt', 'mate4.txt', 'mate5.txt'];

/** The template: origin (dev, feat), clone A (`proj`, on dev, fetched) and teammate clone B.
 *  `feat` forks from dev's seed with 30 PR lines and an edit of shared.txt; the teammate pushes 400 lines in 5 files
 *  plus the conflicting edit of shared.txt; A has a local `side` branch that merges cleanly into feat. */
function buildWorld(root) {
  const origin = join(root, 'origin.git');
  const a = join(root, 'proj');
  git(root, ['init', '-q', '--bare', '-b', 'dev', origin]);
  mkdirSync(a);
  git(a, ['init', '-q', '-b', 'dev']);
  writeFileSync(join(a, 'seed.txt'), 'seed\n');
  writeFileSync(join(a, 'shared.txt'), SHARED('s5'));
  git(a, ['add', '-A']); git(a, ['commit', '-qm', 'seed']);
  git(a, ['remote', 'add', 'origin', origin]);
  git(a, ['push', '-q', '-u', 'origin', 'dev']);
  git(a, ['checkout', '-q', '-b', 'feat']);
  writeFileSync(join(a, 'pr.txt'), lines('pr', 30));
  writeFileSync(join(a, 'shared.txt'), SHARED('FEAT'));
  git(a, ['add', '-A']); git(a, ['commit', '-qm', 'the PR']);
  git(a, ['push', '-q', '-u', 'origin', 'feat']);
  git(a, ['checkout', '-q', '-b', 'side', 'dev']);
  writeFileSync(join(a, 'side.txt'), lines('side', 3));
  git(a, ['add', '-A']); git(a, ['commit', '-qm', 'side work']);
  git(a, ['checkout', '-q', 'dev']);
  const b = join(root, 'teammate');
  git(root, ['clone', '-q', origin, b]);
  for (const f of MATES) writeFileSync(join(b, f), lines(f, 80));
  writeFileSync(join(b, 'shared.txt'), SHARED('DEV'));
  git(b, ['add', '-A']); git(b, ['commit', '-qm', 'teammate work']);
  git(b, ['push', '-q', 'origin', 'dev']);
  git(a, ['fetch', '-q', 'origin']);
}
const worlds = [];
after(() => { for (const d of worlds) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });
let n = 0;
function world() {
  const root = templateWorld('run-harness-merge-base', buildWorld, 'rhmb');
  worlds.push(root);
  const a = join(root, `proj${++n}`);
  renameSync(join(root, 'proj'), a);
  return { root, a, b: join(root, 'teammate'), key: projectKey(a) };
}
/** The teammate pushes one more file to dev; A fetches it. */
function teammateAgain(w, file = 'late.txt') {
  writeFileSync(join(w.b, file), lines(file, 7));
  git(w.b, ['add', '-A']); git(w.b, ['commit', '-qm', `add ${file}`]); git(w.b, ['push', '-q', 'origin', 'dev']);
  git(w.a, ['fetch', '-q', 'origin']);
}

/** The v2 executor ABI: one entry per declared output port. */
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}
const ok = (ctx) => ({ outputs: outsOf(ctx), verdict: null, summary: 'x' });
const codeExpect = (files, ls) => Math.round((0.5 + 0.1 * files + Math.pow(ls, 0.85) / 25) * 100) / 100;

/** `git merge --no-ff <ref>` in the worktree, then the resolution of shared.txt, staged. → merge exit status */
function mergeAndResolve(dir, ref = 'origin/dev') {
  const st = gitStatus(dir, ['merge', '--no-ff', '--no-edit', ref]);
  writeFileSync(join(dir, 'shared.txt'), SHARED('FEAT+DEV'));
  git(dir, ['add', 'shared.txt']);
  return st;
}

/** One run on the reused `feat` of world `w` through the PR fix workflow (implementer → reviewer). `implement(ctx, orch)`
 *  does the implementer's git work once; the reviewer passes and records the code cursor it started from. */
function orchFor(w, { implement, mergeIn = { ref: 'origin/dev' }, extra = {} } = {}) {
  const seen = { reviewPrev: null, implemented: false };
  let orch;
  orch = createOrchestrator({
    projectDir: w.a, prompt: 'Resolve the merge conflicts', auto: true, claude: { mock: true }, workflowId: 'wf_pr_fix',
    branch: { feature: 'feat', source: 'dev', ...(mergeIn ? { mergeIn } : {}) },
    runners: {
      producer: async (ctx) => {
        if (ctx.node.key === 'implementer' && !seen.implemented) {
          seen.implemented = true;
          const r = await implement(ctx, orch);
          if (r !== undefined) return r;
        }
        return ok(ctx);
      },
      verifier: async () => {
        seen.reviewPrev = orch._humanCursor ? { ...orch._humanCursor } : null;
        return { status: 'ok', issues: [], review: { issues: [] }, summary: '' };
      },
    },
    ...extra,
  });
  return { orch, seen };
}
const auditText = (id) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(id).map((r) => r.text).join('\n');
const stepRow = (id, key) => getDb().prepare('SELECT human_hours, human_signals FROM pipeline_steps WHERE pipeline_id = ? AND agent_key = ? ORDER BY rowid').all(id, key)[0];
const resultsOf = (dir) => JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
const patchOf = (dir) => (existsSync(join(dir, 'diff-patch.patch')) ? readFileSync(join(dir, 'diff-patch.patch'), 'utf8') : '');
/** `git diff --numstat a b` → { files, added, removed, paths } */
function numstat(cwd, a, b) {
  const rows = git(cwd, ['diff', '--numstat', a, b]).split('\n').filter(Boolean).map((l) => l.split('\t'));
  return { files: rows.length, added: rows.reduce((t, r) => t + Number(r[0]), 0), removed: rows.reduce((t, r) => t + Number(r[1]), 0), paths: rows.map((r) => r[2]).sort() };
}
const totals = (r) => ({ added: r.summary.linesAdded, removed: r.summary.linesRemoved });
const MOVED_RE = /Diff base for `[^`]+` moved to git's own merge of the run's start `[0-9a-f]{10}` and `[0-9a-f]{10}` \(`origin\/dev`\), the newest base commit on the branch: `[0-9a-f]{10}`\. Base-branch commits do not count; the conflict resolution and the run's own work do\./;
const MOVED_RE_ALL = new RegExp(MOVED_RE.source, 'g');

test('validMergeIn refuses \'-x\', \'a..b\', a non-string; a fresh branch records no mergeIn', { timeout: 60000 }, async () => {
  const w = world();
  for (const bad of [{ ref: '-x' }, { ref: 'a..b' }, { ref: 7 }, { ref: '' }, { ref: 'a b' }, { ref: 'x'.repeat(201) }, 'origin/dev', null]) {
    const o = createOrchestrator({ projectDir: w.a, prompt: 'x', auto: true, claude: { mock: true }, branch: { feature: 'feat', source: 'dev', mergeIn: bad } });
    assert.equal(o.branchOpts.mergeIn, null, JSON.stringify(bad));
  }
  const good = createOrchestrator({ projectDir: w.a, prompt: 'x', auto: true, claude: { mock: true }, branch: { feature: 'feat', source: 'dev', mergeIn: { ref: 'origin/dev', at: 'zz' } } });
  assert.deepEqual(good.branchOpts.mergeIn, { ref: 'origin/dev' });
  // A fresh branch starts from the source: merging the source would be a no-op, so nothing is recorded.
  const { orch } = orchFor(w, { implement: () => {}, extra: { branch: { feature: 'brand-new', source: 'dev', mergeIn: { ref: 'origin/dev' } } } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  assert.equal(orch.getState().branch.mergeIn, undefined);
  assert.equal(orch.getState().branch.reusedExisting, false);
});

test('A: merging origin/dev and committing: results.json, the patch, run size and the implementer\'s code credit cover only the resolution', { timeout: 90000 }, async () => {
  const w = world();
  const devAt = sha(w.a, 'origin/dev');
  const { orch, seen } = orchFor(w, { implement: (ctx) => {
    assert.equal(mergeAndResolve(ctx.projectDir), 1, 'the merge conflicts on shared.txt');
    git(ctx.projectDir, ['commit', '-q', '--no-edit']);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  const tip = sha(w.a, 'feat');
  const m = tip;                                          // the merge commit
  assert.equal(git(w.a, ['rev-list', '--parents', '-n', '1', m]).split(' ').length, 3);
  assert.equal(st.branch.mergeIn.ref, 'origin/dev');
  assert.equal(st.branch.mergeIn.at, devAt);
  assert.equal(st.branch.autoMerge.theirs, devAt);
  assert.equal(st.branch.autoMerge.ref, 'origin/dev');
  const W = st.checkpointRef;
  assert.equal(W, st.branch.autoMerge.sha);
  assert.equal(st.checkpointRefs[w.key], W);
  assert.notEqual(W, st.branch.diffBase, 'the fork point stays recorded as diffBase');
  assert.equal(sha(w.a, `${W}^1`), sha(w.a, `${m}^1`));
  assert.equal(sha(w.a, `${W}^2`), sha(w.a, `${m}^2`));
  const mt = spawnSync('git', ['merge-tree', '--write-tree', '--no-messages', sha(w.a, `${m}^1`), sha(w.a, `${m}^2`)], { cwd: w.a, encoding: 'utf8' });
  assert.equal(mt.status, 1, 'git\'s own merge conflicts');
  assert.equal(sha(w.a, `${W}^{tree}`), mt.stdout.split('\n')[0]);
  const want = numstat(w.a, W, tip);
  assert.deepEqual(want.paths, ['shared.txt']);
  const r = resultsOf(res.pipelineDir);
  assert.deepEqual(totals(r), { added: want.added, removed: want.removed });
  assert.ok(want.added + want.removed < 20, 'far below the teammate\'s 400 lines');
  assert.deepEqual([...r.newFiles, ...r.changedFiles].map((f) => f.path), ['shared.txt']);
  const patch = patchOf(res.pipelineDir);
  assert.match(patch, /FEAT\+DEV/);
  for (const f of [...MATES, 'pr.txt']) assert.doesNotMatch(patch, new RegExp(f.replace('.', '\\.')));
  assert.ok(st.runSize, 'run size is sized from the same summary');
  assert.match(auditText(st.id), MOVED_RE);
  const impl = JSON.parse(stepRow(st.id, 'implementer').human_signals);
  assert.equal(impl.code, codeExpect(1, want.added + want.removed), 'the implementer is credited the resolution, not 0');
  assert.equal(seen.reviewPrev.insertions + seen.reviewPrev.deletions, want.added + want.removed, 'the reviewer reads the resolution');
  // A diff read after teardown removed the checkout (a late live-diff poll) leaves the frozen base alone.
  await orch.liveDiff().catch(() => null);
  assert.equal(orch.checkpointRef, W);
  assert.doesNotMatch(auditText(st.id), /moved back/);
});

test('B: --no-commit merge left pending: live diff and step credit are the resolution mid-run; teardown\'s merge commit gives the same W', { timeout: 90000 }, async () => {
  const w = world();
  const live = {};
  const { orch } = orchFor(w, { implement: async (ctx, o) => {
    mergeAndResolve(ctx.projectDir);
    const d = await o.liveDiff();
    live.totals = totals(d.results);
    live.paths = [...d.results.newFiles, ...d.results.changedFiles].map((f) => f.path);
    live.base = o.checkpointRef;
    live.audit = auditText(o.pipeline.id);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  const tip = sha(w.a, 'feat');
  const parents = git(w.a, ['rev-list', '--parents', '-n', '1', tip]).split(' ');
  assert.equal(parents.length, 3, 'teardown\'s _commitWork concluded the pending merge');
  const again = await autoMergeBase(w.a, { ours: parents[1], theirs: parents[2], pipelineId: 'check', key: 'k' });
  assert.equal(again.sha, live.base, 'the in-progress base is git\'s own merge of the same parents');
  assert.equal(st.checkpointRef, live.base);
  assert.match(live.audit, MOVED_RE);
  assert.equal(auditText(st.id).match(MOVED_RE_ALL).length, 1, 'in progress → committed: the same W, no second line');
  const want = numstat(w.a, live.base, tip);
  assert.deepEqual(want.paths, ['shared.txt']);
  assert.deepEqual(live.totals, { added: want.added, removed: want.removed });
  assert.deepEqual(live.paths, ['shared.txt']);
  assert.deepEqual(totals(resultsOf(res.pipelineDir)), { added: want.added, removed: want.removed });
  const impl = JSON.parse(stepRow(st.id, 'implementer').human_signals);
  assert.equal(impl.code, codeExpect(1, want.added + want.removed));
});

test('C: a commit after the merge still counts', { timeout: 90000 }, async () => {
  const w = world();
  const { orch } = orchFor(w, { implement: (ctx) => {
    mergeAndResolve(ctx.projectDir);
    git(ctx.projectDir, ['commit', '-q', '--no-edit']);
    writeFileSync(join(ctx.projectDir, 'extra.txt'), lines('extra', 12));
    git(ctx.projectDir, ['add', '-A']); git(ctx.projectDir, ['commit', '-qm', 'more']);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  const want = numstat(w.a, st.checkpointRef, sha(w.a, 'feat'));
  assert.deepEqual(want.paths, ['extra.txt', 'shared.txt']);
  const r = resultsOf(res.pipelineDir);
  assert.deepEqual(totals(r), { added: want.added, removed: want.removed });
  assert.equal(r.summary.linesAdded, numstat(w.a, st.checkpointRef, sha(w.a, 'feat^1')).added + 12);
});

test('D: a merge of an unrelated branch keeps today\'s base (committed and --no-commit, with and without mergeIn)', { timeout: 180000 }, async () => {
  for (const [commit, mergeIn] of [[true, { ref: 'origin/dev' }], [false, { ref: 'origin/dev' }], [true, null]]) {
    const w = world();
    const live = {};
    const { orch } = orchFor(w, { mergeIn, implement: async (ctx, o) => {
      git(ctx.projectDir, ['merge', '--no-ff', ...(commit ? ['--no-edit'] : ['--no-commit']), 'side']);
      await o.liveDiff();
      live.base = o.checkpointRef;
    } });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const st = orch.getState();
    assert.equal(live.base, st.branch.diffBase, `mid-run base (commit=${commit})`);
    assert.equal(st.checkpointRef, st.branch.diffBase, `the fork point (commit=${commit})`);
    assert.equal(st.branch.autoMerge, undefined);
    assert.doesNotMatch(auditText(st.id), /git's own merge/);
    assert.match(patchOf(res.pipelineDir), /side\.txt/, 'the side merge is this run\'s work');
  }
});

test('D2: no mergeIn on the run (the agent merges origin/dev on its own): the base still moves to git\'s own merge', { timeout: 90000 }, async () => {
  const w = world();
  const { orch } = orchFor(w, { mergeIn: null, implement: (ctx) => {
    mergeAndResolve(ctx.projectDir);
    git(ctx.projectDir, ['commit', '-q', '--no-edit']);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.mergeIn, undefined);
  assert.equal(st.branch.startHead, st.branch.autoMerge.ours, 'git\'s own merge of the run\'s start and the merged commit');
  assert.equal(st.checkpointRef, st.branch.autoMerge.sha);
  assert.equal(st.branch.autoMerge.ref, 'origin/dev');
  assert.ok(st.branch.baseRefs['origin/dev'], 'the base refs at the start are recorded');
  const want = numstat(w.a, st.checkpointRef, sha(w.a, 'feat'));
  assert.deepEqual(want.paths, ['shared.txt']);
  assert.deepEqual(totals(resultsOf(res.pipelineDir)), { added: want.added, removed: want.removed });
  assert.doesNotMatch(patchOf(res.pipelineDir), /mate1\.txt/);
  assert.match(auditText(st.id), MOVED_RE);
  assert.equal(git(w.a, ['for-each-ref', '--format=%(refname)', 'refs/worca/']), '', 'the pin is gone after teardown');
});

test('E: resume keeps the moved base', { timeout: 120000 }, async () => {
  const w = world();
  let paused = false;
  const pausing = (getOrch) => async (ctx) => {
    if (ctx.node.key !== 'implementer' || paused) return ok(ctx);
    mergeAndResolve(ctx.projectDir);
    git(ctx.projectDir, ['commit', '-q', '--no-edit']);
    await getOrch().liveDiff();                       // the base moves before the pause, so the point carries W
    paused = true;
    queueMicrotask(() => getOrch().pause());
    return new Promise((_r, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
  const pass = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });
  let orch;
  orch = createOrchestrator({ projectDir: w.a, prompt: 'Resolve', auto: true, claude: { mock: true }, workflowId: 'wf_pr_fix',
    branch: { feature: 'feat', source: 'dev', mergeIn: { ref: 'origin/dev' } }, runners: { producer: pausing(() => orch), verifier: pass } });
  const first = await orch.run();
  assert.equal(first.status, 'paused', JSON.stringify(first));
  const id = orch.pipeline.id;
  const W = orch.getState().checkpointRef;
  assert.notEqual(W, orch.getState().branch.diffBase);
  const saved = readPipelineForResume(id);
  assert.equal(saved.resumePoint.checkpointRef, W, 'the point carries the moved base');
  let orch2;
  orch2 = createOrchestrator({ projectDir: w.a, auto: true, claude: { mock: true }, resume: saved, runners: { producer: pausing(() => orch2), verifier: pass } });
  const atResume = {};
  const realRe = orch2._reconcileDiffBases.bind(orch2);
  orch2._reconcileDiffBases = async () => { await realRe(); atResume.base = orch2.checkpointRef; };
  const second = await orch2.resume();
  assert.equal(second.status, 'done', JSON.stringify(second));
  assert.equal(atResume.base, W, 'reconcile keeps a mergeIn member\'s base');
  assert.equal(orch2.checkpointRef, W);
  assert.equal(orch2.getState().checkpointRefs[w.key], W);
  assert.doesNotMatch(auditText(id), /corrected to the worktree's start/);
  const want = numstat(w.a, W, sha(w.a, 'feat'));
  assert.deepEqual(want.paths, ['shared.txt']);
  assert.deepEqual(totals(resultsOf(second.pipelineDir || first.pipelineDir)), { added: want.added, removed: want.removed });
});

test('F: the base ref moves after the merge: the merged sha still qualifies; a tip fetched before the merge too', { timeout: 120000 }, async () => {
  for (const when of ['after', 'before']) {
    const w = world();
    const { orch } = orchFor(w, { implement: (ctx) => {
      if (when === 'before') teammateAgain(w);
      mergeAndResolve(ctx.projectDir);
      git(ctx.projectDir, ['commit', '-q', '--no-edit']);
      if (when === 'after') teammateAgain(w);
    } });
    const res = await orch.run();
    assert.equal(res.status, 'done', JSON.stringify(res));
    const st = orch.getState();
    assert.ok(st.branch.autoMerge, `a qualifying merge (${when})`);
    assert.equal(st.checkpointRef, st.branch.autoMerge.sha, `still W, not moved back (${when})`);
    assert.deepEqual(numstat(w.a, st.checkpointRef, sha(w.a, 'feat')).paths, ['shared.txt']);
    assert.doesNotMatch(patchOf(res.pipelineDir), /mate1\.txt|late\.txt/);
  }
});

test('G: an aborted merge moves the base back', { timeout: 90000 }, async () => {
  const w = world();
  const live = {};
  const { orch } = orchFor(w, { implement: async (ctx, o) => {
    mergeAndResolve(ctx.projectDir);
    await o.liveDiff();
    live.moved = o.checkpointRef;
    git(ctx.projectDir, ['merge', '--abort']);
    await o.liveDiff();
    live.back = o.checkpointRef;
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.notEqual(live.moved, st.branch.diffBase);
  assert.equal(live.back, st.branch.diffBase);
  assert.equal(st.checkpointRef, st.branch.diffBase);
  assert.equal(st.branch.autoMerge, undefined);
  const audit = auditText(st.id);
  assert.match(audit, MOVED_RE);
  assert.match(audit, new RegExp(`Diff base for \`${w.key}\` moved back to \`${st.branch.diffBase.slice(0, 10)}\`: the branch holds no base-branch commit newer than the run's start\\.`));
});

test('H: teardown removes refs/worca/diff-base/<id>/* (detached and legacy run roots)', { timeout: 120000 }, async () => {
  for (const mode of ['detached', 'legacy']) {
    process.env.WORCA_RUN_ROOT = mode;
    try {
      const w = world();
      const live = {};
      const { orch } = orchFor(w, { implement: async (ctx, o) => {
        mergeAndResolve(ctx.projectDir);
        git(ctx.projectDir, ['commit', '-q', '--no-edit']);
        await o.liveDiff();
        live.refs = git(w.a, ['for-each-ref', '--format=%(refname) %(objectname)', `${DIFF_BASE_REF_PREFIX}${o.pipeline.id}/`]);
        live.base = o.checkpointRef;
      } });
      const res = await orch.run();
      assert.equal(res.status, 'done', JSON.stringify(res));
      assert.equal(live.refs, `${DIFF_BASE_REF_PREFIX}${orch.pipeline.id}/${w.key} ${live.base}`, `pinned while the run lives (${mode})`);
      assert.equal(git(w.a, ['for-each-ref', '--format=%(refname)', 'refs/worca/']), '', `gone after teardown (${mode})`);
    } finally { delete process.env.WORCA_RUN_ROOT; }
  }
});

test('J: _buildResults refreshes first: a merge nothing measured yet is still counted from git\'s own merge', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['checkout', '-q', 'feat']);
  mergeAndResolve(w.a);                                   // pending: MERGE_HEAD = origin/dev
  const fork = sha(w.a, 'dev');
  const dir = mkdtempSync(join(scratch, 'pipe-'));
  const h = Object.create(RunHarness.prototype);
  h.isWorkspace = false;
  h.workMode = 'git';
  h.workDirs = new Map([[w.key, w.a]]);
  h.members = [{ projectKey: w.key, projectDir: w.a }];
  h.memberByKey = new Map(h.members.map((m) => [m.projectKey, m]));
  h.injectedPaths = {};
  h.memoryChanges = [];
  h.checkpointRefs = { [w.key]: fork };
  h.pipeline = { id: 'pidresults1', dir };
  const logs = [];
  h._log = (...a) => logs.push(a.join(' '));
  h.state = { branch: { worktreeDir: w.a, diffBase: fork, startHead: sha(w.a, 'feat'), mergeIn: { ref: 'origin/dev', at: sha(w.a, 'origin/dev') } }, branches: {} };
  await h._buildResults();
  assert.ok(existsSync(join(dir, 'results.json')), logs.join('\n'));
  assert.notEqual(h.checkpointRefs[w.key], fork);
  const r = resultsOf(dir);
  assert.deepEqual([...r.newFiles, ...r.changedFiles].map((f) => f.path), ['shared.txt']);
  rmSync(dir, { recursive: true, force: true });
});

test('K: a paused setup\'s replay keeps mergeIn (resume passes no branch options)', { timeout: 120000 }, async () => {
  process.env.WORCA_RUN_ROOT = 'legacy';
  try {
    const w = world();
    const devAt = sha(w.a, 'origin/dev');
    const { orch } = orchFor(w, { implement: () => {} });
    const realCp = orch._ensureGitCheckpoint.bind(orch);
    let blocker = null;
    orch._ensureGitCheckpoint = async () => {
      await realCp();
      blocker = join(w.a, '.worca-cc', 'worktrees', orch.pipeline.id);   // createWorktree finds the path taken: a pausable failure
      mkdirSync(blocker, { recursive: true });
      writeFileSync(join(blocker, 'block'), 'x');
    };
    const res = await orch.run();
    assert.equal(res.status, 'paused', JSON.stringify(res));
    assert.deepEqual(orch.getState().branch.mergeIn, { ref: 'origin/dev', at: devAt }, 'the pending record carries it');
    rmSync(blocker, { recursive: true, force: true });
    teammateAgain(w);                                       // the ref moves while paused: `at` is the setup's answer
    const saved = readPipelineForResume(orch.pipeline.id);
    const orch2 = createOrchestrator({ projectDir: w.a, auto: true, claude: { mock: true }, resume: saved,
      runners: { producer: async (ctx) => ok(ctx), verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }) } });
    const res2 = await orch2.resume();
    assert.equal(res2.status, 'done', JSON.stringify(res2));
    assert.equal(orch2.getState().branch.reusedExisting, true);
    assert.deepEqual(orch2.getState().branch.mergeIn, { ref: 'origin/dev', at: devAt });
  } finally { delete process.env.WORCA_RUN_ROOT; }
});

test('I: per member: a two-member harness moves only the member with mergeIn', { timeout: 60000 }, async () => {
  const w1 = world(); const w2 = world();
  for (const w of [w1, w2]) {
    git(w.a, ['checkout', '-q', 'feat']);
    assert.equal(mergeAndResolve(w.a), 1);
    git(w.a, ['commit', '-q', '--no-edit']);
  }
  const fork = sha(w1.a, 'dev');
  const h = Object.create(RunHarness.prototype);
  h.isWorkspace = true;
  h.workDirs = new Map([['a', w1.a], ['b', w2.a]]);
  h.members = [{ projectKey: 'a', projectDir: w1.a }, { projectKey: 'b', projectDir: w2.a }];
  h.memberByKey = new Map(h.members.map((m) => [m.projectKey, m]));
  h.checkpointRefs = { a: fork, b: fork };
  h.pipeline = { id: 'pidmerge1', dir: null };
  h._log = () => {};
  h.state = { branches: {
    a: { worktreeDir: w1.a, diffBase: fork, startHead: sha(w1.a, 'feat^1'), mergeIn: { ref: 'origin/dev', at: sha(w1.a, 'origin/dev') } },
    b: { worktreeDir: w2.a, diffBase: fork },                // a record from before startHead without mergeIn: left alone
  } };
  const changed = await h._refreshMergeBases();
  assert.deepEqual([...changed], ['a']);
  assert.notEqual(h.checkpointRefs.a, fork);
  assert.equal(h.checkpointRefs.a, h.state.branches.a.autoMerge.sha);
  assert.equal(h.checkpointRefs.b, fork);
  assert.equal(h.state.branches.b.autoMerge, undefined);
  assert.equal(h.checkpointRef, h.checkpointRefs.a, 'the scalar mirrors the primary');
  assert.deepEqual(h.state.checkpointRefs, h.checkpointRefs);
  assert.deepEqual([...(await h._refreshMergeBases())], [], 'a second refresh moves nothing');
  assert.equal(git(w2.a, ['for-each-ref', '--format=%(refname)', 'refs/worca/']), '');
  // Teardown removed a member's checkout but has not dropped its workDirs entry yet: a refresh in that window keeps
  // the frozen base (no "moved back" to the fork point).
  const gone = join(w1.root, 'removed-checkout');
  h.workDirs.set('a', gone);
  h.state.branches.a.worktreeDir = gone;
  const frozen = h.checkpointRefs.a;
  assert.deepEqual([...(await h._refreshMergeBases())], []);
  assert.equal(h.checkpointRefs.a, frozen);
});

// ── Base-branch merges and rebases on any run (no mergeIn) ────────────────────────────────────────────────────
const REBASED_RE = /Diff base for `[^`]+` moved to `[0-9a-f]{10}`: the branch (?:was rebased or reset|moved) onto `([^`]+)` at `[0-9a-f]{10}`/;

/** A fresh-branch run off `source` (no mergeIn): `implement(ctx, orch)` is the implementer's git work. */
function freshOrch(w, { source = 'dev', implement, runners = null } = {}) {
  return orchFor(w, { mergeIn: null, implement, extra: { branch: { feature: 'brand-new', source }, ...(runners ? { runners } : {}) } });
}
const commitFile = (dir, file, n) => {
  writeFileSync(join(dir, file), lines(file, n));
  git(dir, ['add', '-A']); git(dir, ['commit', '-qm', `add ${file}`]);
};

test('L: merge by the agent on a fresh branch: dev moved during the run, the agent works, then merges origin/dev; only its own work counts', { timeout: 90000 }, async () => {
  const w = world();
  const live = {};
  const { orch } = freshOrch(w, { implement: async (ctx, o) => {
    commitFile(ctx.projectDir, 'own.txt', 9);
    teammateAgain(w);                                       // dev moves while the run works
    git(ctx.projectDir, ['merge', '--no-ff', '--no-edit', 'origin/dev']);
    const d = await o.liveDiff();
    live.paths = [...d.results.newFiles, ...d.results.changedFiles].map((f) => f.path);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.reusedExisting, false);
  assert.equal(st.branch.startHead, st.branch.baseSha);
  assert.equal(st.checkpointRef, sha(w.a, 'origin/dev'), 'a branch cut from dev: the merged dev commit itself, as on GitHub');
  assert.equal(auditText(st.id).match(REBASED_RE)?.[1], 'origin/dev');
  assert.deepEqual(live.paths, ['own.txt'], 'the live diff is the run\'s own work');
  const r = resultsOf(res.pipelineDir);
  assert.deepEqual([...r.newFiles, ...r.changedFiles].map((f) => f.path), ['own.txt']);
  assert.deepEqual(totals(r), { added: 9, removed: 0 });
  const impl = JSON.parse(stepRow(st.id, 'implementer').human_signals);
  assert.equal(impl.code, codeExpect(1, 9), 'the implementer is credited its own 9 lines, not late.txt');
});

test('M: fast-forward onto a newer dev before any commit (git merge --ff-only) moves the base too', { timeout: 90000 }, async () => {
  const w = world();
  const { orch } = freshOrch(w, { implement: (ctx) => {
    teammateAgain(w);
    git(ctx.projectDir, ['merge', '-q', '--ff-only', 'origin/dev']);
    commitFile(ctx.projectDir, 'own.txt', 4);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.checkpointRef, sha(w.a, 'origin/dev'));
  assert.deepEqual(totals(resultsOf(res.pipelineDir)), { added: 4, removed: 0 });
  assert.equal(auditText(st.id).match(REBASED_RE)?.[1], 'origin/dev');
});

test('N: rebase of a reused branch onto origin/dev with a conflict: only the resolution and later work count; a resume keeps the base', { timeout: 150000 }, async () => {
  const w = world();
  let paused = false;
  const live = {};
  const pausing = (getOrch) => async (ctx) => {
    if (ctx.node.key !== 'implementer' || paused) return ok(ctx);
    const dir = ctx.projectDir;
    assert.notEqual(gitStatus(dir, ['rebase', 'origin/dev']), 0, 'the rebase stops on shared.txt');
    writeFileSync(join(dir, 'shared.txt'), SHARED('FEAT+DEV'));
    git(dir, ['add', 'shared.txt']);
    git(dir, ['-c', 'core.editor=true', 'rebase', '--continue']);
    commitFile(dir, 'extra.txt', 6);
    await getOrch().liveDiff();
    live.base = getOrch().checkpointRef;
    paused = true;
    queueMicrotask(() => getOrch().pause());
    return new Promise((_r, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
  const pass = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });
  let orch;
  orch = createOrchestrator({ projectDir: w.a, prompt: 'Rebase onto dev', auto: true, claude: { mock: true }, workflowId: 'wf_pr_fix',
    branch: { feature: 'feat', source: 'dev' }, runners: { producer: pausing(() => orch), verifier: pass } });
  const first = await orch.run();
  assert.equal(first.status, 'paused', JSON.stringify(first));
  const id = orch.pipeline.id;
  const start = orch.getState().branch.startHead;
  assert.equal(start, sha(w.a, 'origin/feat'), 'a reused branch records its tip as the start');
  const W = live.base;
  assert.notEqual(W, orch.getState().branch.diffBase);
  assert.equal(sha(w.a, `${W}^1`), sha(w.a, 'origin/dev'));
  assert.equal(sha(w.a, `${W}^2`), start, 'git\'s own replay of the start onto origin/dev');
  assert.equal(auditText(id).match(REBASED_RE)?.[1], 'origin/dev');
  const saved = readPipelineForResume(id);
  let orch2;
  orch2 = createOrchestrator({ projectDir: w.a, auto: true, claude: { mock: true }, resume: saved, runners: { producer: pausing(() => orch2), verifier: pass } });
  const second = await orch2.resume();
  assert.equal(second.status, 'done', JSON.stringify(second));
  assert.equal(orch2.checkpointRef, W, 'recomputed from the record after the restart: the same commit');
  assert.doesNotMatch(auditText(id), /corrected to the worktree's start|moved back/);
  const want = numstat(w.a, W, sha(w.a, 'feat'));
  assert.deepEqual(want.paths, ['extra.txt', 'shared.txt']);
  assert.deepEqual(totals(resultsOf(second.pipelineDir || first.pipelineDir)), { added: want.added, removed: want.removed });
  assert.doesNotMatch(patchOf(second.pipelineDir || first.pipelineDir), /mate1\.txt|pr\.txt/);
});

test('O: reset onto origin/dev dropping the source\'s own commits (a fresh branch off feat): only the work after it counts', { timeout: 90000 }, async () => {
  const w = world();
  const { orch } = freshOrch(w, { source: 'feat', implement: (ctx) => {
    git(ctx.projectDir, ['reset', '-q', '--hard', 'origin/dev']);
    commitFile(ctx.projectDir, 'own.txt', 5);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.checkpointRef, sha(w.a, 'origin/dev'), 'dev itself is closer to the result than the start replayed onto it');
  assert.deepEqual(totals(resultsOf(res.pipelineDir)), { added: 5, removed: 0 });
});

test('P: a restarted harness recomputes the same base from the record and moves nothing', { timeout: 60000 }, async () => {
  const w = world();
  git(w.a, ['checkout', '-q', 'feat']);
  const start = sha(w.a, 'feat');
  commitFile(w.a, 'own.txt', 3);
  assert.equal(mergeAndResolve(w.a), 1);
  git(w.a, ['commit', '-q', '--no-edit']);
  const fork = sha(w.a, 'dev');
  const mk = (refs) => {
    const h = Object.create(RunHarness.prototype);
    h.isWorkspace = false;
    h.workMode = 'git';
    h.workDirs = new Map([[w.key, w.a]]);
    h.members = [{ projectKey: w.key, projectDir: w.a }];
    h.memberByKey = new Map(h.members.map((m) => [m.projectKey, m]));
    h.projectDir = w.a;
    h.checkpointRefs = { [w.key]: refs };
    h.pipeline = { id: 'pidrestart1', dir: null };
    h._log = () => {};
    h.state = { branch: { worktreeDir: w.a, source: 'dev', diffBase: fork, startHead: start }, branches: {} };
    return h;
  };
  const h1 = mk(fork);
  assert.deepEqual([...(await h1._refreshMergeBases())], [w.key]);
  const W = h1.checkpointRefs[w.key];
  assert.deepEqual(numstat(w.a, W, 'HEAD').paths, ['own.txt', 'shared.txt'], 'pre-merge work still counts');
  const h2 = mk(W);
  assert.deepEqual([...(await h2._refreshMergeBases())], []);
  assert.equal(h2.checkpointRefs[w.key], W);
});

test('Q: a merge of another branch that already contains newer dev: dev\'s commits do not count, the other branch\'s own work does (as on GitHub)', { timeout: 90000 }, async () => {
  const w = world();
  const { orch } = freshOrch(w, { implement: (ctx) => {
    const dir = ctx.projectDir;
    commitFile(dir, 'own.txt', 9);
    teammateAgain(w);
    git(dir, ['branch', 'carrier', 'origin/dev']);         // someone else's branch, cut from the newer dev
    git(dir, ['checkout', '-q', 'carrier']);
    commitFile(dir, 'carrier.txt', 4);
    git(dir, ['checkout', '-q', '-']);
    git(dir, ['merge', '--no-ff', '--no-edit', 'carrier']);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.checkpointRef, sha(w.a, 'origin/dev'));
  const r = resultsOf(res.pipelineDir);
  assert.deepEqual([...r.newFiles, ...r.changedFiles].map((f) => f.path).sort(), ['carrier.txt', 'own.txt']);
  assert.doesNotMatch(patchOf(res.pipelineDir), /late\.txt/);
});

test('R: a merge with the parents swapped (dev merged into, the branch reset to it) is measured like any other', { timeout: 90000 }, async () => {
  const w = world();
  const { orch } = freshOrch(w, { source: 'feat', implement: (ctx) => {
    const dir = ctx.projectDir;
    commitFile(dir, 'own.txt', 6);
    teammateAgain(w);
    const run = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '--detach', 'origin/dev']);
    gitStatus(dir, ['merge', '--no-ff', '--no-edit', run]);   // shared.txt conflicts: dev is the first parent
    writeFileSync(join(dir, 'shared.txt'), SHARED('FEAT+DEV'));
    git(dir, ['add', 'shared.txt']);
    git(dir, ['commit', '-q', '--no-edit']);
    const merged = git(dir, ['rev-parse', 'HEAD']);
    git(dir, ['checkout', '-q', '-']);
    git(dir, ['reset', '-q', '--hard', merged]);
  } });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  const st = orch.getState();
  assert.equal(st.branch.autoMerge.ours, st.branch.startHead);
  assert.equal(st.branch.autoMerge.theirs, sha(w.a, 'origin/dev'));
  const r = resultsOf(res.pipelineDir);
  const paths = [...r.newFiles, ...r.changedFiles].map((f) => f.path).sort();
  assert.deepEqual(paths, ['own.txt', 'shared.txt'], 'the run\'s work and the resolution, not dev\'s files or feat\'s pr.txt');
});

test('combinesDependencies: a slice of a feature, a fresh start, a single project and small runs, all four', () => {
  const on = { slice: { feature: 'feat-1', index: 4 }, freshStart: true, isWorkspace: false, smallRuns: true };
  assert.equal(HARNESS.combinesDependencies(on), true);
  for (const [why, over] of [['no slice', { slice: null }], ['a slice with no feature', { slice: { index: 4 } }],
    ['a reused branch', { freshStart: false }], ['a workspace run', { isWorkspace: true }],
    ['the flag off or the feature unmarked', { smallRuns: false }]]) {
    assert.equal(HARNESS.combinesDependencies({ ...on, ...over }), false, why);
  }
});
