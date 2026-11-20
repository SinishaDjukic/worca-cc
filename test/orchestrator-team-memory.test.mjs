// test/orchestrator-team-memory.test.mjs — team memory (phase 1a) through a real mock run: an opted-in project's team
// notes load from the rules copy's team/ folder (a same-named local note shadows one), the pointer block says how to
// change one. A note the run writes is a PROPOSAL (#943): the run itself never writes the store and never queues a note
// for the team — sharing happens when a person approves it (the server route, not the harness); a defragment run and
// an opted-out project mount no team folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useGitSandbox, makeOrigin, cloneAs, git, branchFiles } from './helpers/metrics-git.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedQuickFix } from './helpers/engines.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { addProject } from '../src/core/projects.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { memoryRoot, projectScope, writeMemory, readMemory } from '../src/core/memory-store.mjs';
import {
  drainTeamMemoryFlushes, queueTeamChanges, flushTeamMemory, deleteTeamNote, refreshTeamLayer, TEAM_MEMORY_BRANCH, TEAM_NOTES_REL, TEAM_MARKER_KEY,
  teamMemoryRoot,
} from '../src/core/memory-team.mjs';
import { RUN_LOG_FILE } from '../src/core/run-log.mjs';
import { listProposals, approveProposal } from '../src/core/memory-proposals.mjs';

const skip = process.platform === 'win32' ? 'sh not portable to win32' : false;
const root = mkdtempSync(join(tmpdir(), 'worca-orch-team-'));
const HERMETIC_ROOT = mkdtempSync(join(tmpdir(), 'worca-orch-team-proot-'));
useGitSandbox(before, after);
useTempHome(after);
const prevEnv = {};
before(async () => {
  for (const k of ['WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_RUN_ROOT']) prevEnv[k] = process.env[k];
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = HERMETIC_ROOT;
  delete process.env.WORCA_RUN_ROOT;
  await seedQuickFix();
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(root, { recursive: true, force: true });
  rmSync(HERMETIC_ROOT, { recursive: true, force: true });
});
const NOW = '2026-10-16T10:00:00.000Z';
const note = (description, body) => `---\nname: x\ndescription: ${description}\n---\n${body}\n`;
/** A teammate's notes on the branch, written with plain git. */
function pushTeamNotes(bare, notes) {
  const w = mkdtempSync(join(root, 'mate-'));
  git(w, 'init', '-q', '-b', 'main'); git(w, 'config', 'user.name', 'mate'); git(w, 'config', 'user.email', 'mate@t');
  git(w, 'checkout', '-q', '--orphan', TEAM_MEMORY_BRANCH);
  const dir = join(w, ...TEAM_NOTES_REL.split('/'));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(notes)) writeFileSync(join(dir, `${name}.md`), text.replace('name: x', `name: ${name}`));
  git(w, 'add', '-A'); git(w, 'commit', '-qm', 'memory: teammate notes');
  git(w, 'push', '-q', bare, TEAM_MEMORY_BRANCH);
  rmSync(w, { recursive: true, force: true });
}
/** The run queued nothing for the team: no outbox entry, nothing being pushed. */
function assertQueuedNothing(key, msg) {
  for (const sub of ['outbox', 'inflight']) {
    const d = join(teamMemoryRoot(), 'projects', key, sub);
    assert.deepEqual(existsSync(d) ? readdirSync(d) : [], [], `${msg} (${sub})`);
  }
}
const proposalsOf = (orch) => listProposals(memoryRoot(), { runId: orch.pipeline.id });
async function approveAll(orch) {
  const items = await proposalsOf(orch);
  for (const p of items) assert.ok(await approveProposal(memoryRoot(), p.id, { now: NOW }), p.name);
  return items;
}
const ls = async (p) => (existsSync(p) ? (await readdir(p)).sort() : []);
async function project(name, { team = true } = {}) {
  const bare = makeOrigin(root, name);
  const dir = cloneAs(root, 'machineA', bare, name);
  const p = (await addProject({ name, path: dir })).find((x) => x.name === name);
  if (team) writeProjectSettings({ projectDir: dir }, { 'memory.team': true });
  return { bare, dir, key: p.key };
}

test('opted in: team notes load read-only, local shadows team by name, the block says how to change one, the run\'s notes are proposals it never shares', { skip, timeout: 120000 }, async () => {
  const { bare, dir, key } = await project('shop');
  pushTeamNotes(bare, { 'deploy-trap': note('Read before deploying', 'Migrate first.'), conventions: note('House style', 'Team version.') });
  await writeMemory(memoryRoot(), projectScope(key), 'conventions', note('House style', 'My version.'), { source: 'user', now: NOW });
  const seen = [];
  let wrote = false;
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo', claude: { mock: true }, auto: true, runners: { producer: async (ctx) => {
    seen.push({ key: ctx.node.key, block: ctx.memoryBlock, rules: ctx.memoryRules,
      team: existsSync(join(ctx.memoryRules, 'team')) ? (await readdir(join(ctx.memoryRules, 'team'))).sort() : null });
    if (ctx.node.key === 'implementer' && !wrote) {
      wrote = true;
      await writeFile(join(ctx.memoryMount, 'project', 'ci-trap.md'), note('Read when CI is red', 'Pin TZ=UTC.'));
      await writeFile(join(ctx.memoryMount, 'global', 'style.md'), note('Commit style', 'Terse subjects.'));
    }
    return runAgentExecution(ctx);
  } } });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual(seen[0].team, ['deploy-trap.md'], 'conventions is shadowed by the local note');
  assert.ok(seen[0].block.includes(`Teammates' shared notes (team memory) also load as rules, from ${join(seen[0].rules, 'team')}`));
  assert.equal(existsSync(join(orch.getState().memoryMount, 'team')), false, 'never in the writable copy');
  await drainTeamMemoryFlushes();
  assertQueuedNothing(key, 'the run queues nothing for the team');
  const files = branchFiles(bare, TEAM_MEMORY_BRANCH);
  assert.ok(!files.some((f) => f.endsWith('/ci-trap.md') || f.endsWith('/style.md')), `nothing the run wrote reached the team: ${files.join(',')}`);
  assert.equal(await readMemory(memoryRoot(), projectScope(key), 'ci-trap'), null, 'nor the store');
  const pending = await proposalsOf(orch);
  assert.deepEqual(pending.map((p) => `${p.scope}/${p.name}`).sort(), ['global/style', `projects/${key}/ci-trap`]);
  await approveAll(orch);
  const ci = await readMemory(memoryRoot(), projectScope(key), 'ci-trap');
  assert.equal(ci.meta.source, `run:${orch.pipeline.id}`, 'approving writes the store');
  assert.equal(ci.meta.extra[TEAM_MARKER_KEY], undefined, 'approveProposal itself shares nothing (the server route does)');
  assertQueuedNothing(key, 'approveProposal queues nothing either');
});

test('team notes only ("only"): the plain local notes stay out of both copies, the team\'s version of a clash loads, a note the run writes is a proposal no later agent loads', { skip, timeout: 120000 }, async () => {
  const { bare, dir, key } = await project('teamonly');
  writeProjectSettings({ projectDir: dir }, { 'memory.team': 'only' });
  pushTeamNotes(bare, { 'deploy-trap': note('Read before deploying', 'Migrate first.'), conventions: note('House style', 'Team version.') });
  await writeMemory(memoryRoot(), projectScope(key), 'conventions', note('House style', 'My version.'), { source: 'user', now: NOW });
  await writeMemory(memoryRoot(), projectScope(key), 'private', note('Mine only', 'Never shared.'), { source: 'user', now: NOW });
  const seen = [];
  let wrote = false;
  let mount = null;
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo', claude: { mock: true }, auto: true, runners: { producer: async (ctx) => {
    mount ??= (await readdir(join(ctx.memoryMount, 'project'))).sort();
    seen.push({ key: ctx.node.key, project: await ls(join(ctx.memoryRules, 'project')), team: await ls(join(ctx.memoryRules, 'team')),
      conventions: existsSync(join(ctx.memoryRules, 'team', 'conventions.md')) ? readFileSync(join(ctx.memoryRules, 'team', 'conventions.md'), 'utf8') : null });
    if (ctx.node.key === 'implementer' && !wrote) {
      wrote = true;
      await writeFile(join(ctx.memoryMount, 'project', 'ci-trap.md'), note('Read when CI is red', 'Pin TZ=UTC.'));
    }
    return runAgentExecution(ctx);
  } } });
  assert.equal((await orch.run()).status, 'done');
  assert.deepEqual([seen[0].project, seen[0].team], [[], ['conventions.md', 'deploy-trap.md']], 'no plain local note; the team\'s notes, unshadowed');
  assert.match(seen[0].conventions, /Team version\./);
  assert.deepEqual(mount, [], 'the writable copy leaves them out too');
  const after = seen.slice(seen.findIndex((x) => x.key === 'implementer') + 1);
  assert.ok(after.length && after.every((x) => !x.project.includes('ci-trap.md') && !x.project.includes('private.md')), `frozen: ${JSON.stringify(seen)}`);
  const log = await readFile(join(orch.getState().pipelineDir, RUN_LOG_FILE), 'utf8');
  assert.match(log, /team memory: Project teamonly loads team notes only — 2 local note\(s\) not loaded/);
  await drainTeamMemoryFlushes();
  assertQueuedNothing(key, 'the run queues nothing');
  assert.ok(!branchFiles(bare, TEAM_MEMORY_BRANCH).includes(`${TEAM_NOTES_REL}/ci-trap.md`), 'not shared by the run');
  assert.deepEqual((await proposalsOf(orch)).map((p) => p.name), ['ci-trap']);
  await approveAll(orch);
  assert.ok(await readMemory(memoryRoot(), projectScope(key), 'ci-trap'), 'approved: in the store');
  assert.ok(await readMemory(memoryRoot(), projectScope(key), 'private'), 'the notes that do not load stay in the store');
});

test('a defragment run mounts no team folder; an opted-out project fetches and mounts nothing', { skip, timeout: 120000 }, async () => {
  const { bare, dir, key } = await project('billing');
  pushTeamNotes(bare, { 'billing-trap': note('Read before invoicing', 'Round half-even.') });
  await writeMemory(memoryRoot(), projectScope(key), 'a', note('A', 'Rule A.'), { source: 'user', now: NOW });
  await writeMemory(memoryRoot(), projectScope(key), 'b', note('B', 'Rule B.'), { source: 'user', now: NOW });
  let rules = null;
  const defrag = createOrchestrator({ projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'project', prompt: 'Defragment.', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => { if (ctx.node.key === 'memoryDefragmenter') rules = (await readdir(ctx.memoryRules)).sort(); return runAgentExecution(ctx); } } });
  assert.equal((await defrag.run()).status, 'done');
  assert.deepEqual(rules, ['.gitignore', 'project']);
  await drainTeamMemoryFlushes();
  assert.deepEqual(branchFiles(bare, TEAM_MEMORY_BRANCH).filter((f) => f.startsWith(`${TEAM_NOTES_REL}/`)), [`${TEAM_NOTES_REL}/billing-trap.md`],
    'a defragment run shares nothing (D15): its merge and its emptied file stay on this machine');
  const off = await project('edge', { team: false });
  pushTeamNotes(off.bare, { 'edge-trap': note('x', 'y') });
  let offTeam = null;
  const run = createOrchestrator({ projectDir: off.dir, workflowId: 'wf_quick-fix', prompt: 'demo', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => { offTeam ??= existsSync(join(ctx.memoryRules, 'team')); return runAgentExecution(ctx); } } });
  assert.equal((await run.run()).status, 'done');
  assert.equal(offTeam, false);
  assert.equal(existsSync(join(teamMemoryRoot(), 'projects', off.key)), false, 'off: no team-memory state on this machine');
  // Not `for-each-ref refs/remotes/origin/worca-memory`: the post-run base check (`_checkBaseAfterRun` → a plain
  // `git fetch origin`) fetches every branch of origin, the team branch included — that is the harness, not team memory.
  assert.doesNotMatch(git(off.dir, 'worktree', 'list'), /team-memory/, 'off: no team worktree was added');
});

test('a teammate deleting a followed note is logged at run start; an agent emptying a shared note is a deletion proposal, never a removal from the team', { skip, timeout: 120000 }, async () => {
  const { bare, dir, key } = await project('ledger');
  const run = async (write) => {
    let done = false;
    const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo', claude: { mock: true }, auto: true, runners: { producer: async (ctx) => {
      if (ctx.node.key === 'implementer' && !done) { done = true; await write(ctx); }
      return runAgentExecution(ctx);
    } } });
    assert.equal((await orch.run()).status, 'done');
    await drainTeamMemoryFlushes();
    return { orch, lines: (await readFile(join(orch.getState().pipelineDir, RUN_LOG_FILE), 'utf8')).split('\n').filter((l) => /team memory/.test(l)) };
  };
  const { orch: o1, lines: first } = await run(async (ctx) => {
    await writeFile(join(ctx.memoryMount, 'project', 'ci-trap.md'), note('Read when CI is red', 'Pin TZ=UTC.').replace('name: x', 'name: ci-trap'));
    await writeFile(join(ctx.memoryMount, 'project', 'gone-trap.md'), note('Read before a release', 'Tag first.').replace('name: x', 'name: gone-trap'));
  });
  assert.ok(!first.some((l) => /team memory: (sharing|removing)/.test(l)), `a run shares nothing:\n${first.join('\n')}`);
  assertQueuedNothing(key, 'the first run queued nothing');
  // A person approves both, and shares them (what the server route does on approval).
  assert.deepEqual((await approveAll(o1)).map((p) => p.name).sort(), ['ci-trap', 'gone-trap']);
  await queueTeamChanges(key, ['ci-trap', 'gone-trap'], { flush: false });
  assert.equal((await flushTeamMemory(key, { projectDir: dir })).ok, true);
  assert.deepEqual(branchFiles(bare, TEAM_MEMORY_BRANCH).filter((f) => f.startsWith(`${TEAM_NOTES_REL}/`)).sort(), [`${TEAM_NOTES_REL}/ci-trap.md`, `${TEAM_NOTES_REL}/gone-trap.md`]);
  // A teammate removes gone-trap; this machine's unedited tracked copy follows that at the next run start.
  const w = join(root, 'mate-rm');
  git(root, 'clone', '-q', '-b', TEAM_MEMORY_BRANCH, bare, w); git(w, 'config', 'user.name', 'mate'); git(w, 'config', 'user.email', 'mate@t');
  git(w, 'rm', '-q', `${TEAM_NOTES_REL}/gone-trap.md`); git(w, 'commit', '-qm', 'memory: remove gone-trap'); git(w, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
  rmSync(w, { recursive: true, force: true });
  const snap = join(teamMemoryRoot(), 'projects', key, 'team.json');
  writeFileSync(snap, JSON.stringify({ ...JSON.parse(readFileSync(snap, 'utf8')), fetchedAt: new Date(Date.now() - 10 * 60_000).toISOString() }));
  const { orch: o2, lines: second } = await run((ctx) => writeFile(join(ctx.memoryMount, 'project', 'ci-trap.md'), ''));   // emptied = deleted (B19)
  assert.ok(!second.some((l) => /team memory: (sharing|removing)/.test(l)), `the run neither shares nor removes:\n${second.join('\n')}`);
  assert.ok(second.some((l) => /removed gone-trap\.md here too: a teammate deleted it from the team/.test(l)), second.join('\n'));
  assert.equal(await readMemory(memoryRoot(), projectScope(key), 'gone-trap').catch(() => null), null, 'the followed deletion removed the local copy');
  assertQueuedNothing(key, 'the second run queued nothing');
  const [del] = await proposalsOf(o2);
  assert.deepEqual([del.name, del.kind], ['ci-trap', 'delete']);
  assert.ok(await readMemory(memoryRoot(), projectScope(key), 'ci-trap'), 'still in the store until approved');
  assert.deepEqual(branchFiles(bare, TEAM_MEMORY_BRANCH).filter((f) => f.startsWith(`${TEAM_NOTES_REL}/`)), [`${TEAM_NOTES_REL}/ci-trap.md`], 'and still on the team');
  await approveProposal(memoryRoot(), del.id, { now: NOW });
  assert.equal(await readMemory(memoryRoot(), projectScope(key), 'ci-trap'), null, 'approving the deletion removes the note here');
});

test('a run never takes a note\'s team: line from its writable copy: a copy a team delete untracked while the run was live stays a local note (D12)', { skip, timeout: 120000 }, async () => {
  const { dir, key } = await project('ledger-keep');
  await writeMemory(memoryRoot(), projectScope(key), 'kept-note', note('Read first', 'Shared, then removed from the team during a run.').replace('name: x', 'name: kept-note'), { source: 'user', now: NOW });
  await queueTeamChanges(key, ['kept-note'], { flush: false });
  assert.equal((await flushTeamMemory(key, { projectDir: dir })).ok, true);
  let done = false;
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo', claude: { mock: true }, auto: true, runners: { producer: async (ctx) => {
    if (ctx.node.key === 'implementer' && !done) {
      done = true;
      await deleteTeamNote(key, 'kept-note', { flush: false });                     // `worca memory team rm` while the run is live…
      assert.equal((await flushTeamMemory(key, { projectDir: dir })).ok, true);     // …and it lands
      const p = join(ctx.memoryMount, 'project', 'kept-note.md');
      await writeFile(p, `${await readFile(p, 'utf8')}\n`);                          // the agent rewrites the note, content unchanged
    }
    return runAgentExecution(ctx);
  } } });
  assert.equal((await orch.run()).status, 'done');
  await drainTeamMemoryFlushes();
  await refreshTeamLayer(key, { projectDir: dir, maxAgeMs: 0 });
  const kept = await readMemory(memoryRoot(), projectScope(key), 'kept-note');
  assert.ok(kept, 'the local copy stays (D12): the sync-back never re-marked it with the writable copy\'s old team: line');
  assert.equal(kept.meta.extra[TEAM_MARKER_KEY], undefined);
});

test('a note edited in one node and emptied in a later one: the last change is the run\'s proposal, the store and the team keep the note until it is approved', { skip, timeout: 120000 }, async () => {
  const { bare, dir, key } = await project('ledger-del');
  await writeMemory(memoryRoot(), projectScope(key), 'ci-trap', note('Read when CI is red', 'Pin TZ=UTC.').replace('name: x', 'name: ci-trap'), { source: 'user', now: NOW });
  await queueTeamChanges(key, ['ci-trap'], { flush: false });
  assert.equal((await flushTeamMemory(key, { projectDir: dir })).ok, true);
  assert.ok(branchFiles(bare, TEAM_MEMORY_BRANCH).includes(`${TEAM_NOTES_REL}/ci-trap.md`), 'precondition: on the team');
  const frozen = (await readMemory(memoryRoot(), projectScope(key), 'ci-trap')).text;
  let did1 = false; let did2 = false; let reviewerSaw = null;
  const hook = async (ctx) => {
    const p = join(ctx.memoryMount, 'project', 'ci-trap.md');
    if (ctx.node.key === 'implementer' && !did1) {
      did1 = true;
      await writeFile(p, frozen.replace('Pin TZ=UTC.', 'Pin TZ=UTC and LANG=C.'));
    } else if (ctx.node.key === 'reviewer' && !did2) {
      did2 = true;
      reviewerSaw = await readFile(p, 'utf8');
      await writeFile(p, '');   // emptied = deleted (B19)
    }
    return runAgentExecution(ctx);
  };
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo', claude: { mock: true }, auto: true, runners: { producer: hook, verifier: hook } });
  assert.equal((await orch.run()).status, 'done');
  assert.ok(did2, 'the reviewer node ran');
  assert.equal(reviewerSaw, frozen, 'the reviewer loads the frozen note, not the implementer\'s edit');
  await drainTeamMemoryFlushes();
  assertQueuedNothing(key, 'the run queued nothing');
  const items = await proposalsOf(orch);
  assert.equal(items.length, 1, 'one proposal per note per run');
  assert.deepEqual([items[0].name, items[0].kind, items[0].agentKey], ['ci-trap', 'delete', 'reviewer'], 'the later change replaced the edit');
  assert.ok(await readMemory(memoryRoot(), projectScope(key), 'ci-trap'), 'the store keeps it');
  assert.ok(branchFiles(bare, TEAM_MEMORY_BRANCH).includes(`${TEAM_NOTES_REL}/ci-trap.md`), 'and so does the team');
  await approveAll(orch);
  assert.equal(await readMemory(memoryRoot(), projectScope(key), 'ci-trap'), null, 'approved: the deletion is applied here');
});
