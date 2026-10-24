// test/memory-team-seed.test.mjs — team memory 1b against a real origin: sharing existing notes as ONE commit, the
// same-name clashes (keep mine / take team / skip — a case variant too), a teammate's push between the review and the
// commit, Compare on a held note, Undo putting this machine's notes back while the team keeps what was shared, and Take
// team's opt-in baseline outliving a local deletion whose team delete landed.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useGitSandbox, makeOrigin, cloneAs, git } from './helpers/metrics-git.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { memoryRoot, projectScope, writeMemory, readMemory, removeMemory, listMemory, listSnapshots, restoreSnapshot } from '../src/core/memory-store.mjs';
import { withStoreLock } from '../src/core/memory-sync.mjs';
import { _testing as metricsTesting } from '../src/core/metrics/sync.mjs';
import {
  previewTeamSeed, seedTeamMemory, resolveTeamClash, undoTeamSeed, queueTeamChanges, flushTeamMemory, refreshTeamLayer,
  teamMemoryStatus, switchTeamMemoryOn, changedNoteNames, TEAM_MEMORY_BRANCH, TEAM_NOTES_REL, TEAM_MARKER_KEY, _testing,
} from '../src/core/memory-team.mjs';

const skip = process.platform === 'win32' ? 'sh not portable to win32' : false;
const root = mkdtempSync(join(tmpdir(), 'worca-team-seed-'));
useGitSandbox(before, after);
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { _testing.reset(); metricsTesting.reset(); });

const NOW = '2026-10-17T10:00:00.000Z';
const LATER = '2026-10-17T11:00:00.000Z';
const note = (description, body) => `---\nname: x\ndescription: ${description}\n---\n${body}\n`;
let mates = 0;

/** A project whose `notes` existed before the switch-on (each gets its opt-in baseline), switched on the product's way. */
async function project(name, notes) {
  const bare = makeOrigin(root, name);
  const dir = cloneAs(root, 'me', bare, name);
  const key = (await addProject({ name, path: dir })).find((p) => p.name === name).key;
  for (const [n, [desc, body]] of Object.entries(notes)) await writeMemory(memoryRoot(), projectScope(key), n, note(desc, body), { source: 'user', now: NOW });
  await switchTeamMemoryOn(key, dir, () => writeProjectSettings({ projectDir: dir }, { 'memory.team': true }));
  return { bare, dir, key };
}
/** A teammate pushes `notes` to worca-memory with plain git from another clone — starting the branch when origin has none. */
function teammate(p, notes) {
  const m = cloneAs(root, `mate-${++mates}`, p.bare, 'w');
  if (git(m, 'ls-remote', 'origin', TEAM_MEMORY_BRANCH).trim()) {
    git(m, 'fetch', '-q', 'origin', `${TEAM_MEMORY_BRANCH}:${TEAM_MEMORY_BRANCH}`);
    git(m, 'checkout', '-q', TEAM_MEMORY_BRANCH);
  } else {
    git(m, 'checkout', '-q', '--orphan', TEAM_MEMORY_BRANCH);
    git(m, 'rm', '-rqf', '.');
  }
  const dir = join(m, ...TEAM_NOTES_REL.split('/'));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(notes)) writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: About ${name}\nupdated: 2026-10-17T09:00:00.000Z\nauthor: Ana\n---\n${body}\n`);
  git(m, 'add', '-A'); git(m, 'commit', '-qm', 'memory: a teammate'); git(m, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
}
const commits = (p) => Number(git(p.bare, 'rev-list', '--count', TEAM_MEMORY_BRANCH).trim());
const onTeam = (p, name) => { try { return git(p.bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/${name}.md`); } catch { return null; } };
const local = (p, name) => readMemory(memoryRoot(), projectScope(p.key), name);
const decisionsOf = (pv) => (name, action) => { const n = pv.notes.find((x) => x.name === name); return { name, action, hash: n.hash, teamHash: n.team?.hash ?? null }; };
const states = async (p, names) => { const st = await teamMemoryStatus(p.key); return names.map((n) => st.notes.find((x) => x.name === n)?.state); };

test('the preview: what passes the check, what it blocks (with the reason), every same-name clash beside the team\'s version (a case variant too); a note identical to the team\'s is just tracked; nothing is written', { skip }, async () => {
  const p = await project('pv', {
    alpha: ['Read before deploying', 'Migrate first.'], leaky: ['On-call', 'Page ops-lead@acme.io.'],
    build: ['How to build', 'Mine: make all.'], deploy: ['Deploy steps', 'Mine: ./deploy.sh'], twin: ['About twin', 'Same everywhere.'],
  });
  teammate(p, { build: 'Theirs: npm run build.', Deploy: 'Theirs: npm run deploy.', twin: 'Same everywhere.' });
  const snaps = (await listSnapshots(memoryRoot(), projectScope(p.key))).length;
  const pv = await previewTeamSeed(p.key);
  assert.deepEqual([pv.fetchError, pv.branchExists, pv.offer], [null, true, 'pending']);
  const by = Object.fromEntries(pv.notes.map((n) => [n.name, n]));
  assert.deepEqual(Object.keys(by).sort(), ['alpha', 'build', 'deploy', 'leaky'], 'twin was adopted by the fetch: already shared');
  assert.deepEqual([by.alpha.blocked, by.alpha.team], [null, null]);
  assert.match(by.leaky.blocked.reason, /line \d+: an email address/);
  assert.deepEqual([by.build.team.name, by.build.team.same], ['build', false]);
  assert.match(by.build.text, /Mine: make all\./); assert.match(by.build.team.text, /Theirs: npm run build\./);
  assert.equal(by.deploy.team.name, 'Deploy');
  assert.deepEqual([...(await _testing.queuedNames(p.key))], []);
  assert.equal((await listSnapshots(memoryRoot(), projectScope(p.key))).length, snaps, 'the preview writes nothing');
});

test('the commit shares the picked notes as ONE commit, each a tracked copy; keep mine replaces the team\'s version; take team replaces mine (a case variant) and pushes nothing; skip holds the clash; an unpicked note stays here', { skip }, async () => {
  const p = await project('sd', {
    alpha: ['Read before deploying', 'Migrate first.'], beta: ['Tests', 'Run npm ci first.'], gamma: ['Unpicked', 'Stays here.'],
    build: ['How to build', 'Mine: make all.'], lint: ['How to lint', 'Mine: eslint .'], deploy: ['Deploy steps', 'Mine: ./deploy.sh'],
  });
  teammate(p, { build: 'Theirs: npm run build.', lint: 'Theirs: npm run lint.', Deploy: 'Theirs: npm run deploy.' });
  const before = commits(p);
  const d = decisionsOf(await previewTeamSeed(p.key));
  const r = await seedTeamMemory(p.key, [d('alpha', 'share'), d('beta', 'share'), d('build', 'share'), d('lint', 'skip'), d('deploy', 'take-team')]);
  assert.deepEqual([[...r.shared].sort(), r.tookTeam, r.held, r.flush.ok], [['alpha', 'beta', 'build'], ['Deploy'], ['lint'], true]);
  assert.equal(commits(p), before + 1, 'one commit for the whole seeding');
  assert.deepEqual(git(p.bare, 'show', '--name-only', '--format=', TEAM_MEMORY_BRANCH).trim().split('\n').sort(), ['alpha', 'beta', 'build'].map((n) => `${TEAM_NOTES_REL}/${n}.md`));
  assert.match(onTeam(p, 'build'), /Mine: make all\./, 'keep mine replaced the teammate\'s version');
  assert.match(onTeam(p, 'lint'), /Theirs: npm run lint\./, 'a held clash leaves the team\'s version alone');
  assert.equal(onTeam(p, 'gamma'), null, 'an unpicked note never leaves the machine');
  assert.deepEqual(await states(p, ['alpha', 'beta', 'build', 'Deploy', 'lint', 'gamma']), ['shared', 'shared', 'shared', 'shared', 'held', 'local']);
  for (const n of ['alpha', 'beta', 'build']) assert.ok((await local(p, n)).meta.extra[TEAM_MARKER_KEY], `${n}: a tracked copy`);
  assert.match((await local(p, 'Deploy')).body, /Theirs: npm run deploy\./);
  const st = await teamMemoryStatus(p.key);
  assert.deepEqual([st.seed.offer, st.seed.last.shared, st.seed.last.tookTeam, st.seed.last.held], ['done', 3, 1, 1]);
  assert.ok((await listSnapshots(memoryRoot(), projectScope(p.key))).some((s) => s.id === r.snapshotId && /-seed(-\d+)?$/.test(s.id)));
  // The held clash stays held: an edit of it — here an agent's — is not pushed.
  await writeMemory(memoryRoot(), projectScope(p.key), 'lint', (await local(p, 'lint')).text.replace('eslint .', 'eslint --fix .'), { source: 'run:r1', now: LATER });
  assert.deepEqual(await queueTeamChanges(p.key, ['lint'], { flush: false }), { queued: [], blocked: [] });
  assert.equal((await flushTeamMemory(p.key)).pushed, 0);
  assert.match(onTeam(p, 'lint'), /Theirs: npm run lint\./);
});

test('a teammate\'s push between the review and the commit: STALE — nothing pushed, no snapshot, no seeding recorded', { skip }, async () => {
  const p = await project('st', { build: ['How to build', 'Mine.'] });
  teammate(p, { build: 'Theirs, v1.' });
  const d = decisionsOf(await previewTeamSeed(p.key));
  teammate(p, { build: 'Theirs, v2.' });
  const head = git(p.bare, 'rev-parse', TEAM_MEMORY_BRANCH).trim();
  const snaps = (await listSnapshots(memoryRoot(), projectScope(p.key))).length;
  await assert.rejects(seedTeamMemory(p.key, [d('build', 'share')]), (err) => err.code === 'STALE' && err.names.includes('build'));
  assert.equal(git(p.bare, 'rev-parse', TEAM_MEMORY_BRANCH).trim(), head);
  assert.equal((await listSnapshots(memoryRoot(), projectScope(p.key))).length, snaps);
  assert.equal((await teamMemoryStatus(p.key)).seed.last, null);
});

test('Undo: my notes come back — also one a teammate updated since — nothing is pushed, what the seeding shared stays on the team, and a re-save of a note put back uploads nothing', { skip }, async () => {
  const p = await project('ud', { alpha: ['About alpha', 'Mine, alpha.'], beta: ['About beta', 'Mine, beta.'], build: ['How to build', 'Mine: make.'] });
  teammate(p, { build: 'Theirs: npm run build.' });
  const d = decisionsOf(await previewTeamSeed(p.key));
  await seedTeamMemory(p.key, [d('alpha', 'share'), d('beta', 'share'), d('build', 'take-team')]);
  teammate(p, { alpha: 'Ana rewrote alpha.' });
  await refreshTeamLayer(p.key, { maxAgeMs: 0 });
  assert.match((await local(p, 'alpha')).body, /Ana rewrote alpha\./, 'precondition: my tracked copy followed the team');
  const head = git(p.bare, 'rev-parse', TEAM_MEMORY_BRANCH).trim();
  const u = await undoTeamSeed(p.key);
  assert.deepEqual([[...u.restored].sort(), u.cancelled, u.failed], [['alpha', 'build'], [], []]);
  assert.match((await local(p, 'alpha')).body, /Mine, alpha\./);
  assert.match((await local(p, 'build')).body, /Mine: make\./);
  assert.ok((await local(p, 'beta')).meta.extra[TEAM_MARKER_KEY], 'a landed share as it was stays a tracked copy');
  assert.equal(git(p.bare, 'rev-parse', TEAM_MEMORY_BRANCH).trim(), head, 'the undo pushed nothing');
  assert.match(onTeam(p, 'alpha'), /Ana rewrote alpha\./); assert.match(onTeam(p, 'beta'), /Mine, beta\./);
  await writeMemory(memoryRoot(), projectScope(p.key), 'alpha', (await local(p, 'alpha')).text, { source: 'user', now: LATER });
  assert.deepEqual((await queueTeamChanges(p.key, ['alpha'], { flush: false })).queued, []);
  assert.deepEqual(await states(p, ['alpha', 'build', 'beta']), ['local', 'local', 'shared']);
  await assert.rejects(undoTeamSeed(p.key), (err) => err.code === 'ENOSEED');
});

test('Compare on a held note: keep mine shares it over the team\'s version; take team on another replaces mine; neither is a seeding', { skip }, async () => {
  const p = await project('cp', { build: ['How to build', 'Mine: make.'], lint: ['How to lint', 'Mine: eslint.'] });
  teammate(p, { build: 'Theirs: build.', lint: 'Theirs: lint.' });
  const pv = await previewTeamSeed(p.key);
  await seedTeamMemory(p.key, pv.notes.map((n) => ({ name: n.name, action: 'skip', hash: n.hash, teamHash: n.team.hash })));
  const b = (await previewTeamSeed(p.key, { name: 'build' })).notes[0];
  const r1 = await resolveTeamClash(p.key, { name: 'build', action: 'share', hash: b.hash, teamHash: b.team.hash });
  assert.deepEqual([r1.shared, r1.flush.ok], [['build'], true]);
  assert.match(onTeam(p, 'build'), /Mine: make\./);
  const l = (await previewTeamSeed(p.key, { name: 'lint' })).notes[0];
  const r2 = await resolveTeamClash(p.key, { name: 'lint', action: 'take-team', hash: l.hash, teamHash: l.team.hash });
  assert.deepEqual([r2.tookTeam, r2.flush], [['lint'], null]);
  assert.match((await local(p, 'lint')).body, /Theirs: lint\./);
  assert.deepEqual(await states(p, ['build', 'lint']), ['shared', 'shared']);
  assert.equal((await teamMemoryStatus(p.key)).seed.last.held, 2, 'the journal is still the seeding\'s');
});

test('Take team, then a local deletion of the taken copy whose team delete lands: the opt-in baseline outlives the note — a History restore of the seeding\'s snapshot brings my text back and uploads nothing (D1)', { skip }, async () => {
  const p = await project('tk', { build: ['How to build', 'Mine, from before opt-in.'] });
  teammate(p, { build: 'Theirs: npm run build.' });
  const r = await seedTeamMemory(p.key, [decisionsOf(await previewTeamSeed(p.key))('build', 'take-team')]);
  const scope = projectScope(p.key);
  // The Memory page's Delete (an Ask forget, a run's agent removing the note: the same queue call) is a team delete (D12).
  await removeMemory(memoryRoot(), scope, 'build', { source: 'user' });
  assert.deepEqual((await queueTeamChanges(p.key, ['build'], { flush: false })).queued, ['build']);
  assert.equal((await flushTeamMemory(p.key)).pushed, 1);
  assert.equal(onTeam(p, 'build'), null, 'precondition: the team delete landed');
  // The restore route's shape: one store lock for the restore, its diff and its queue call.
  const q = await withStoreLock(memoryRoot(), async () => {
    const before = await listMemory(memoryRoot(), scope);
    await restoreSnapshot(memoryRoot(), scope, r.snapshotId, { source: 'user' });
    return queueTeamChanges(p.key, changedNoteNames(before, await listMemory(memoryRoot(), scope)), { restore: true, source: 'user', flush: false });
  });
  assert.match((await local(p, 'build')).body, /Mine, from before opt-in\./);
  assert.deepEqual([q, [...(await _testing.queuedNames(p.key))]], [{ queued: [], blocked: [] }, []]);
  assert.equal((await flushTeamMemory(p.key)).pushed, 0);
  assert.equal(onTeam(p, 'build'), null, 'my text from before opt-in never goes to the team');
});
