// test/api-memory-team.test.mjs — the team-memory surface phase 1b consumes: GET /api/memory/team/:key, the memory.team
// switch through PATCH /api/projects/:key/settings (refused without origin), sync, team delete, and the REST / Ask
// writers queueing what they change; then phase 1b's own routes: seeding, Compare, Undo and the one-time offer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useGitSandbox, makeOrigin, cloneAs, branchFiles, git } from './helpers/metrics-git.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { memoryRoot, projectScope, scopeDir, writeMemory, readMemory } from '../src/core/memory-store.mjs';
import { drainTeamMemoryFlushes, queueTeamChanges, TEAM_MEMORY_BRANCH, TEAM_NOTES_REL } from '../src/core/memory-team.mjs';
import { UI_TOKEN_HEADER } from '../src/core/ui-instance.mjs';

const skip = process.platform === 'win32' ? 'sh not portable to win32' : false;
const root = mkdtempSync(join(tmpdir(), 'worca-api-team-'));
useGitSandbox(before, after);
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
const JSONH = { 'Content-Type': 'application/json' };
let srv, base, mod, bare, shop, plain;
const call = async (method, p, body) => { const r = await fetch(`${base}${p}`, { method, headers: JSONH, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json() }; };
const addProjectOf = async (name, path) => (await (await import('../src/core/projects.mjs')).addProject({ name, path })).find((p) => p.name === name);
const notes = () => (branchFiles(bare, TEAM_MEMORY_BRANCH) || []).filter((p) => p.startsWith(`${TEAM_NOTES_REL}/`));

before(async () => {
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  bare = makeOrigin(root, 'shop');
  const dir = cloneAs(root, 'm', bare, 'shop');
  shop = (await addProject({ name: 'shop', path: dir })).find((p) => p.name === 'shop');
  plain = (await addProject({ name: 'plain', path: gitDir('team-plain') })).find((p) => p.name === 'plain');
});
after(async () => { await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }); });

test('GET /api/memory/team/:key: off by default (nothing read); 404 for an unknown key', { skip }, async () => {
  const r = await call('GET', `/api/memory/team/${shop.key}`);
  assert.equal(r.status, 200);
  assert.deepEqual({ enabled: r.json.enabled, notes: r.json.notes, branch: r.json.branch }, { enabled: false, notes: [], branch: 'worca-memory' });
  assert.equal((await call('GET', '/api/memory/team/nope-00000000')).status, 404);
});

test('the switch: memory.team is refused 400 without origin; with origin it turns on', { skip }, async () => {
  // Off, the status says whether the switch can turn on and why not — the Team view disables it then (m11).
  const pst = (await call('GET', `/api/memory/team/${plain.key}`)).json;
  assert.deepEqual([pst.canStart, pst.startError?.code], [false, 'NO_ORIGIN']);
  assert.deepEqual([(await call('GET', `/api/memory/team/${shop.key}`)).json.canStart, (await call('GET', `/api/memory/team/${shop.key}`)).json.startError], [true, null]);
  const no = await call('PATCH', `/api/projects/${plain.key}/settings`, { 'memory.team': true });
  assert.equal(no.status, 400);
  assert.match(no.json.error, /origin/);
  assert.equal(no.json.code, 'NO_ORIGIN');   // the code passes through, so the client can say why
  await writeMemory(memoryRoot(), projectScope(shop.key), 'legacy', '---\nname: legacy\ndescription: Written before the switch\n---\nOld trap.\n', { source: 'user' });
  const yes = await call('PATCH', `/api/projects/${shop.key}/settings`, { 'memory.team': true });
  assert.equal(yes.status, 200);
  assert.equal(yes.json.effective['memory.team'].value, true);
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.enabled, true);
  // A note that existed before the switch, saved again without an edit: no change, nothing uploaded (D1).
  const legacy = (await call('GET', `/api/memory/projects/${shop.key}/files/legacy`)).json.text;
  assert.equal((await call('PUT', `/api/memory/projects/${shop.key}/files/legacy`, { text: legacy })).status, 200);
  await drainTeamMemoryFlushes();
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.notes.find((n) => n.name === 'legacy').state, 'local');
  // Both → Team ("only"): what loads changes, nothing else — the note keeps its opt-in baseline, nothing is re-recorded.
  const only = await call('PATCH', `/api/projects/${shop.key}/settings`, { 'memory.team': 'only' });
  assert.equal(only.status, 200);
  const st = (await call('GET', `/api/memory/team/${shop.key}`)).json;
  assert.deepEqual([st.enabled, st.load], [true, 'team']);
  const legacyRow = st.notes.find((n) => n.name === 'legacy');
  assert.deepEqual([legacyRow.state, legacyRow.mounted], ['local', false], 'not loaded: Team loads team notes only');
  assert.equal((await call('PATCH', `/api/projects/${plain.key}/settings`, { 'memory.team': 'only' })).json.code, 'NO_ORIGIN', 'Team from off is a switch-on: the same refusal');
  assert.equal((await call('PATCH', `/api/projects/${shop.key}/settings`, { 'memory.team': 'all' })).status, 400);
  assert.equal((await call('PATCH', `/api/projects/${shop.key}/settings`, { 'memory.team': true })).status, 200, 'back to Both for the next test');
});

test('a Memory-page save is queued, gated and pushed; a team delete removes it from the branch', { skip }, async () => {
  assert.equal((await call('PUT', `/api/memory/projects/${shop.key}/files/deploy-trap`, { text: '---\nname: deploy-trap\ndescription: Read before deploying\n---\nMigrate first.\n' })).status, 200);
  await drainTeamMemoryFlushes();
  assert.deepEqual(notes(), [`${TEAM_NOTES_REL}/deploy-trap.md`]);
  const st = await call('GET', `/api/memory/team/${shop.key}`);
  assert.equal(st.json.notes.find((n) => n.name === 'deploy-trap').state, 'shared');
  const del = await call('DELETE', `/api/memory/team/${shop.key}/notes/deploy-trap`);
  assert.equal(del.status, 200);
  await drainTeamMemoryFlushes();
  assert.deepEqual(notes(), []);
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.notes.find((n) => n.name === 'deploy-trap').state, 'local', 'the local copy stays, untracked');
});

test('an Ask remember on the project is shared through the server sink; a blocked one is reported, not pushed', { skip }, async () => {
  await writeMemory(memoryRoot(), projectScope(shop.key), 'from-ask', '---\nname: from-ask\ndescription: Saved by Ask\n---\nUse the staging DB for tests.\n', { source: 'ask:t1' });
  mod._testing.askMemoryMutation({ scope: `projects/${shop.key}`, tool: 'remember', name: 'from-ask', threadId: 't1' });
  await writeMemory(memoryRoot(), projectScope(shop.key), 'leaky', '---\nname: leaky\ndescription: Saved by Ask\n---\nDB at 192.168.4.10.\n', { source: 'ask:t1' });
  mod._testing.askMemoryMutation({ scope: `projects/${shop.key}`, tool: 'remember', name: 'leaky', threadId: 't1' });
  // The sink queues fire-and-forget (the turn never waits on it): poll the status until both verdicts are in.
  const state = async (name) => (await call('GET', `/api/memory/team/${shop.key}`)).json.notes.find((n) => n.name === name)?.state;
  for (const t0 = Date.now(); Date.now() - t0 < 10_000;) {
    await drainTeamMemoryFlushes();
    if ((await state('from-ask')) === 'shared' && (await state('leaky')) === 'blocked') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(await state('from-ask'), 'shared');
  assert.equal(await state('leaky'), 'blocked');
  assert.ok(notes().includes(`${TEAM_NOTES_REL}/from-ask.md`));
  assert.ok(!notes().includes(`${TEAM_NOTES_REL}/leaky.md`), 'a blocked note never reaches the branch');
  const r = await call('POST', `/api/memory/team/${shop.key}/sync`);
  assert.equal(r.status, 200);
  assert.equal(r.json.flush.ok, true);
});

test('a Memory-page restore undoes this machine\'s own shared write: the older tracked version it brings back is shared over that push (D13)', { skip }, async () => {
  const put = (body) => call('PUT', `/api/memory/projects/${shop.key}/files/rollback`, { text: `---\nname: rollback\ndescription: Read before a rollback\n---\n${body}\n` });
  assert.equal((await put('Version one.')).status, 200);
  await drainTeamMemoryFlushes();
  assert.equal((await put('Version two.')).status, 200);
  await drainTeamMemoryFlushes();
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/rollback.md`), /Version two\./);
  // The newest snapshot is the scope right before "Version two": rollback.md there is v1 WITH its v1 marker.
  const snap = (await call('GET', `/api/memory/projects/${shop.key}/history`)).json.snapshots.at(-1);
  assert.equal((await call('POST', `/api/memory/projects/${shop.key}/history/${snap.id}/restore`)).status, 200);
  await drainTeamMemoryFlushes();
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/rollback.md`), /Version one\./, 'forced over this machine\'s own push of version two');
});

// ── refine cycle 7 (writers): the stored form at opt-in, and the editor's `team:` line ─────────────────────────────
const stateOf = async (key, name) => (await call('GET', `/api/memory/team/${key}`)).json.notes.find((n) => n.name === name)?.state;
/** A teammate's push of a newer version of `name` (this machine has not fetched it). */
function teammatePush(name, body) {
  const m2 = cloneAs(root, `t-${name}`, bare, 'shop');
  git(m2, 'fetch', '-q', 'origin', `${TEAM_MEMORY_BRANCH}:${TEAM_MEMORY_BRANCH}`);
  git(m2, 'checkout', '-q', TEAM_MEMORY_BRANCH);
  writeFileSync(join(m2, ...TEAM_NOTES_REL.split('/'), `${name}.md`), `---\nname: ${name}\ndescription: About ${name}\nupdated: 2026-10-17T09:00:00.000Z\nauthor: Ana\n---\n${body}\n`);
  git(m2, 'commit', '-qam', `memory: update ${name}`);
  git(m2, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
}

test('a restore that only undoes a blocked edit of a note that existed before the switch uploads nothing (D1)', { skip }, async () => {
  const legacy = (await call('GET', `/api/memory/projects/${shop.key}/files/legacy`)).json.text;
  assert.equal((await call('PUT', `/api/memory/projects/${shop.key}/files/legacy`, { text: legacy.replace('Old trap.', 'Old trap. Page ops-lead@acme.io.') })).status, 200);
  await drainTeamMemoryFlushes();
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.notes.find((n) => n.name === 'legacy').state, 'blocked');
  const snap = (await call('GET', `/api/memory/projects/${shop.key}/history`)).json.snapshots.at(-1);   // right before that save
  assert.equal((await call('POST', `/api/memory/projects/${shop.key}/history/${snap.id}/restore`)).status, 200);
  await drainTeamMemoryFlushes();
  assert.ok(!notes().includes(`${TEAM_NOTES_REL}/legacy.md`), 'the restore uploaded a note that existed before the switch');
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.notes.find((n) => n.name === 'legacy').state, 'local');
});

test('a restore that leaves a tracked copy at its last synced version never pushes it over a teammate\'s newer version (D13)', { skip }, async () => {
  const path = `/api/memory/projects/${shop.key}/files/steady`;
  assert.equal((await call('PUT', path, { text: '---\nname: steady\ndescription: Read first\n---\nShared once.\n' })).status, 200);
  await drainTeamMemoryFlushes();
  assert.equal((await call('PUT', path, { text: (await call('GET', path)).json.text })).status, 200);   // a Save without an edit (its snapshot first)
  await drainTeamMemoryFlushes();
  teammatePush('steady', 'The teammate\'s newer version.');                                            // not fetched here yet
  const snap = (await call('GET', `/api/memory/projects/${shop.key}/history`)).json.snapshots.at(-1);    // right before that Save
  assert.equal((await call('POST', `/api/memory/projects/${shop.key}/history/${snap.id}/restore`)).status, 200);
  await drainTeamMemoryFlushes();
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/steady.md`), /The teammate's newer version\./, 'the restore changed no content: nothing to push');
});

test('D1: a note that existed at opt-in in a form the store repairs (no frontmatter; a hook over today\'s cap) is not uploaded by a Save without an edit', { skip }, async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const lbare = makeOrigin(root, 'legacy');
  const p = (await addProject({ name: 'legacy', path: cloneAs(root, 'm', lbare, 'legacy') })).find((x) => x.name === 'legacy');
  const dir = scopeDir(memoryRoot(), projectScope(p.key));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'raw-legacy.md'), 'Use pnpm, never npm, in this repo.\n');   // hand-dropped: the page lists it as "no frontmatter"
  await writeMemory(memoryRoot(), projectScope(p.key), 'long-hook', `---\nname: long-hook\ndescription: ${'Read this before you touch the deploy scripts '.repeat(4).trim()}\n---\nMigrate first.\n`, { source: 'user', caps: { hookMaxChars: 400 } });
  assert.equal((await call('PATCH', `/api/projects/${p.key}/settings`, { 'memory.team': true })).status, 200);
  for (const name of ['raw-legacy', 'long-hook']) {
    const text = (await call('GET', `/api/memory/projects/${p.key}/files/${name}`)).json.text;
    assert.equal((await call('PUT', `/api/memory/projects/${p.key}/files/${name}`, { text })).status, 200);   // the store repairs it
  }
  await drainTeamMemoryFlushes();
  assert.equal(branchFiles(lbare, TEAM_MEMORY_BRANCH), null, 'nothing that existed at opt-in reached the team (no branch was even started)');
  assert.deepEqual([await stateOf(p.key, 'raw-legacy'), await stateOf(p.key, 'long-hook')], ['local', 'local']);
});

test('D13: the Memory page Saves again with the text it reloaded before the push marked the copy (no team: line, or the old one) — nothing is pushed over a teammate\'s newer version, and the copy still follows', { skip }, async () => {
  for (const [name, old] of [['twice', false], ['edited', true]]) {
    const put = (text) => call('PUT', `/api/memory/projects/${shop.key}/files/${name}`, { text });
    const file = () => call('GET', `/api/memory/projects/${shop.key}/files/${name}`);
    assert.equal((await put(`---\nname: ${name}\ndescription: About ${name}\n---\nOne.\n`)).status, 200);
    if (old) { await drainTeamMemoryFlushes(); assert.equal((await put((await file()).json.text.replace('One.', 'Two.'))).status, 200); }   // an edit of a tracked copy
    const editor = (await file()).json.text;   // the page's reload right after Save: the push has not marked it yet
    await drainTeamMemoryFlushes();
    assert.equal(await stateOf(shop.key, name), 'shared');
    assert.notEqual((await file()).json.text.match(/^team: (\w+)/m)?.[1], editor.match(/^team: (\w+)/m)?.[1], `precondition (${name}): the editor's team: line is stale`);
    teammatePush(name, 'Then a teammate\'s line.');
    assert.equal((await put(editor)).status, 200);   // Save again, no edit
    await drainTeamMemoryFlushes();
    assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/${name}.md`), /a teammate's line/, `${name}: the teammate's version is not reverted`);
    assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);
    assert.match((await file()).json.body, /a teammate's line/, `${name}: still a tracked copy — it follows the team`);
  }
});

test('D12: a team delete keeps the local copy — also when an editor opened before it Saves the old text (with its team: line) afterwards', { skip }, async () => {
  const put = (text) => call('PUT', `/api/memory/projects/${shop.key}/files/keep-me`, { text });
  assert.equal((await put('---\nname: keep-me\ndescription: About keep-me\n---\nMine.\n')).status, 200);
  await drainTeamMemoryFlushes();
  const editor = (await call('GET', `/api/memory/projects/${shop.key}/files/keep-me`)).json.text;   // open in the page
  assert.match(editor, /^team: /m);
  assert.equal((await call('DELETE', `/api/memory/team/${shop.key}/notes/keep-me`)).status, 200);   // CLI rm, 1b's Team tab
  await drainTeamMemoryFlushes();
  assert.equal(await stateOf(shop.key, 'keep-me'), 'local');
  assert.equal((await put(editor)).status, 200);   // Save in that editor, no edit
  await drainTeamMemoryFlushes();
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);   // the next refresh
  assert.equal((await call('GET', `/api/memory/projects/${shop.key}/files/keep-me`)).status, 200, 'the local copy stays (D12)');
});

// ── refine cycle 8 (writers): an editor that missed a follow ───────────────────────────────────────────────────────
test('D13: an editor that missed a follow (a CLI-hosted run followed in its own process: no frame reached the page) Saves without an edit — the teammate\'s version stays, and the copy follows it again', { skip }, async () => {
  const path = `/api/memory/projects/${shop.key}/files/stale-ed`;
  assert.equal((await call('PUT', path, { text: '---\nname: stale-ed\ndescription: About stale-ed\n---\nOne.\n' })).status, 200);
  await drainTeamMemoryFlushes();
  const editor = (await call('GET', path)).json.text;                                                  // the page shows the tracked copy
  assert.match(editor, /^team: /m);
  teammatePush('stale-ed', 'A teammate\'s newer version.');
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);                // the follow (elsewhere, unseen by the page)
  assert.match((await call('GET', path)).json.body, /A teammate's newer version\./, 'followed');
  assert.equal((await call('PUT', path, { text: editor })).status, 200);                               // Save in the stale editor, no edit
  await drainTeamMemoryFlushes();
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/stale-ed.md`), /A teammate's newer version\./, 'not reverted for the team');
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);
  assert.match((await call('GET', path)).json.body, /A teammate's newer version\./, 'still a tracked copy: it follows the team again');
});

test('D13: a restore is whole-scope — restoring the snapshot a follow took never reverts the teammate\'s version for the team; the copy follows it again', { skip }, async () => {
  const path = `/api/memory/projects/${shop.key}/files/collateral`;
  assert.equal((await call('PUT', path, { text: '---\nname: collateral\ndescription: About collateral\n---\nMine.\n' })).status, 200);
  await drainTeamMemoryFlushes();
  teammatePush('collateral', 'The teammate\'s newer version.');
  const history = async () => (await call('GET', `/api/memory/projects/${shop.key}/history`)).json.snapshots.map((x) => x.id);
  const had = new Set(await history());
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);                // followed: its snapshot holds the scope before
  assert.match((await call('GET', path)).json.body, /The teammate's newer version\./);
  // Not `.at(-1)`: ids are second-resolution stamps, and within one second `…-team` sorts before `…-user-NN`.
  const snap = { id: (await history()).find((id) => !had.has(id)) };
  assert.match(snap.id, /-team(-\d+)?$/, 'the follow\'s own snapshot');
  // The user restores it — say, to undo an agent's write to ANOTHER note made since.
  assert.equal((await call('POST', `/api/memory/projects/${shop.key}/history/${snap.id}/restore`)).status, 200);
  await drainTeamMemoryFlushes();
  assert.match(git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/collateral.md`), /The teammate's newer version\./, 'not reverted for the team');
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);
  assert.match((await call('GET', path)).json.body, /The teammate's newer version\./, 'the copy follows the team again');
});

/** A teammate's removal of `name` from the branch (plain git; this machine has not fetched it). */
function teammateRemove(name) {
  const m2 = cloneAs(root, `t-rm-${name}`, bare, 'shop');
  git(m2, 'fetch', '-q', 'origin', `${TEAM_MEMORY_BRANCH}:${TEAM_MEMORY_BRANCH}`);
  git(m2, 'checkout', '-q', TEAM_MEMORY_BRANCH);
  git(m2, 'rm', '-q', `${TEAM_NOTES_REL}/${name}.md`);
  git(m2, 'commit', '-qm', `memory: remove ${name}`);
  git(m2, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
}

test('D3, D13: a restore that undoes an agent\'s bad write to ONE note undoes it for the team — and never reverts a teammate\'s update of another note, nor brings back one a teammate deleted', { skip }, async () => {
  const showOn = (name) => { try { return git(bare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/${name}.md`); } catch { return null; } };
  for (const [n, b] of [['alpha', 'Alpha, the good version.'], ['beta', 'Beta one.'], ['gamma', 'Gamma one.']]) {
    assert.equal((await call('PUT', `/api/memory/projects/${shop.key}/files/${n}`, { text: `---\nname: ${n}\ndescription: About ${n}\n---\n${b}\n` })).status, 200);
  }
  await drainTeamMemoryFlushes();
  // An agent's bad write to alpha (a run's sync-back): the store snapshots the scope first, then writes; it is shared.
  const scope = projectScope(shop.key);
  const a = await readMemory(memoryRoot(), scope, 'alpha');
  await writeMemory(memoryRoot(), scope, 'alpha', a.text.replace('Alpha, the good version.', 'Alpha, the BAD version.'), { source: 'run:badrun' });
  await queueTeamChanges(shop.key, ['alpha'], { source: 'run:badrun' });
  await drainTeamMemoryFlushes();
  assert.match(showOn('alpha'), /BAD version/);
  // Then a teammate updates beta and deletes gamma, and this machine follows both (the tick, a run start, /sync).
  teammatePush('beta', 'Beta two, from Ana.');
  teammateRemove('gamma');
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);
  assert.match((await readMemory(memoryRoot(), scope, 'beta')).body, /Beta two, from Ana\./, 'precondition: beta followed the team');
  assert.equal(await readMemory(memoryRoot(), scope, 'gamma'), null, 'precondition: gamma followed the teammate\'s deletion');
  // The user undoes the agent's write: the snapshot taken right before it.
  const snap = (await call('GET', `/api/memory/projects/${shop.key}/history`)).json.snapshots.find((x) => x.id.endsWith('-run-badrun'));
  assert.ok(snap);
  assert.equal((await call('POST', `/api/memory/projects/${shop.key}/history/${snap.id}/restore`)).status, 200);
  await drainTeamMemoryFlushes();
  assert.match(showOn('alpha'), /the good version/, 'this machine\'s own shared write is undone for the team');
  assert.match(showOn('beta') || '', /Beta two, from Ana\./, 'the teammate\'s update of beta is not reverted for the team');
  assert.equal(showOn('gamma'), null, 'the note the teammate deleted does not come back to the team');
  assert.equal((await call('POST', `/api/memory/team/${shop.key}/sync`)).status, 200);
  assert.match((await readMemory(memoryRoot(), scope, 'beta')).body, /Beta two, from Ana\./, 'here, beta follows the team again');
  assert.equal(await readMemory(memoryRoot(), scope, 'gamma'), null, 'and gamma follows its deletion again');
});

// ── phase 1b: seeding existing notes, Compare, Undo, the offer ─────────────────────────────────────────────────────
/** http.request, so a test can send the Origin of a page served by another localhost port (fetch would not). */
const raw = (method, p, { origin = null, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p, headers: { ...headers, ...(origin ? { origin } : {}) } }, (res) => {
    let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, json: body ? JSON.parse(body) : null }));
  });
  req.on('error', reject);
  req.end();
});
/** A teammate starts worca-memory on `bare` with `notes` (plain git, an orphan commit). */
function teammateStarts(bare, notes) {
  const w = mkdtempSync(join(root, 'mate-'));
  git(w, 'init', '-q', '-b', 'main'); git(w, 'config', 'user.name', 'Ana'); git(w, 'config', 'user.email', 'ana@t');
  git(w, 'checkout', '-q', '--orphan', TEAM_MEMORY_BRANCH);
  mkdirSync(join(w, ...TEAM_NOTES_REL.split('/')), { recursive: true });
  for (const [name, body] of Object.entries(notes)) writeFileSync(join(w, ...TEAM_NOTES_REL.split('/'), `${name}.md`), `---\nname: ${name}\ndescription: About ${name}\nupdated: 2026-10-17T09:00:00.000Z\nauthor: Ana\n---\n${body}\n`);
  git(w, 'add', '-A'); git(w, 'commit', '-qm', 'memory: teammate notes');
  git(w, 'push', '-q', bare, TEAM_MEMORY_BRANCH);
  rmSync(w, { recursive: true, force: true });
}
let seedp, sbare;

test('1b: the preview lists what can be shared, the check\'s verdicts and the clashes; the commit shares only what was picked, takes the team\'s version, holds a skipped clash; Undo puts my note back and pushes nothing', { skip }, async () => {
  sbare = makeOrigin(root, 'seedapi');
  seedp = (await addProjectOf('seedapi', cloneAs(root, 'm', sbare, 'seedapi')));
  for (const [n, body] of [['alpha', 'Migrate first.'], ['leaky', 'Page ops-lead@acme.io.'], ['build', 'Mine: make.'], ['lint', 'Mine: eslint.']]) {
    await writeMemory(memoryRoot(), projectScope(seedp.key), n, `---\nname: ${n}\ndescription: About ${n}\n---\n${body}\n`, { source: 'user' });
  }
  assert.equal((await call('PATCH', `/api/projects/${seedp.key}/settings`, { 'memory.team': true })).status, 200);
  assert.equal((await call('GET', `/api/memory/team/${seedp.key}`)).json.seed.offer, 'pending');
  teammateStarts(sbare, { build: 'Theirs: build.', lint: 'Theirs: lint.' });
  const pv = await call('GET', `/api/memory/team/${seedp.key}/seed`);
  assert.equal(pv.status, 200);
  const by = Object.fromEntries(pv.json.notes.map((n) => [n.name, n]));
  assert.deepEqual(Object.keys(by).sort(), ['alpha', 'build', 'leaky', 'lint']);
  assert.match(by.leaky.blocked.reason, /an email address/);
  assert.deepEqual([by.alpha.team, by.build.team.same], [null, false]);
  const d = (name, action) => ({ name, action, hash: by[name].hash, teamHash: by[name].team?.hash ?? null });
  const r = await call('POST', `/api/memory/team/${seedp.key}/seed`, { decisions: [d('alpha', 'share'), d('build', 'take-team'), d('lint', 'skip')] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.shared, r.json.tookTeam, r.json.held, r.json.flush.ok], [['alpha'], ['build'], ['lint'], true]);
  const files = (branchFiles(sbare, TEAM_MEMORY_BRANCH) || []).filter((x) => x.startsWith(`${TEAM_NOTES_REL}/`));
  assert.deepEqual(files, ['alpha', 'build', 'lint'].map((n) => `${TEAM_NOTES_REL}/${n}.md`), 'leaky never left the machine');
  const state = (st, n) => st.notes.find((x) => x.name === n)?.state;
  assert.deepEqual(['alpha', 'build', 'lint', 'leaky'].map((n) => state(r.json.status, n)), ['shared', 'shared', 'held', 'local']);
  assert.equal(r.json.status.seed.offer, 'done');
  const head = git(sbare, 'rev-parse', TEAM_MEMORY_BRANCH).trim();
  const u = await call('POST', `/api/memory/team/${seedp.key}/seed/undo`);
  assert.equal(u.status, 200);
  assert.deepEqual([u.json.restored, u.json.released], [['build'], ['lint']]);
  assert.equal(git(sbare, 'rev-parse', TEAM_MEMORY_BRANCH).trim(), head, 'Undo pushes nothing');
  assert.match((await call('GET', `/api/memory/projects/${seedp.key}/files/build`)).json.body, /Mine: make\./);
  assert.match(git(sbare, 'show', `${TEAM_MEMORY_BRANCH}:${TEAM_NOTES_REL}/alpha.md`), /Migrate first\./, 'what the seeding shared stays on the team');
  const again = await call('POST', `/api/memory/team/${seedp.key}/seed/undo`);
  assert.deepEqual([again.status, again.json.code], [404, 'ENOSEED']);
});

test('1b refusals: 400 for a bad body, 502 when a share cannot fetch first, 409 STALE when a note changed since the review, 403 for a page served elsewhere, 409 when off, 404 for an unknown project', { skip }, async () => {
  const base = `/api/memory/team/${seedp.key}`;
  assert.equal((await call('POST', `${base}/seed`, {})).status, 400);
  assert.equal((await call('POST', `${base}/seed`, { decisions: [{ name: 'alpha', action: 'publish', hash: 'a'.repeat(40) }] })).status, 400);
  assert.equal((await call('GET', `${base}/seed?name=${encodeURIComponent('my note')}`)).status, 400);
  const lint = (await call('GET', `${base}/seed?name=lint`)).json.notes[0];   // released by the Undo: a local clash again
  assert.equal(lint.team.same, false);
  assert.equal((await call('POST', `${base}/resolve`, { name: 'lint', action: 'skip', hash: lint.hash, teamHash: lint.team.hash })).status, 400);
  // A share is checked against the branch as it is now (E3): origin out of reach, keep mine shares nothing.
  const url = git(seedp.path, 'remote', 'get-url', 'origin').trim();
  git(seedp.path, 'remote', 'set-url', 'origin', join(root, 'gone.git'));
  const offline = await call('POST', `${base}/resolve`, { name: 'lint', action: 'share', hash: lint.hash, teamHash: lint.team.hash });
  const offlineSeed = await call('POST', `${base}/seed`, { decisions: [{ name: 'lint', action: 'share', hash: lint.hash, teamHash: lint.team.hash }] });
  git(seedp.path, 'remote', 'set-url', 'origin', url);
  assert.deepEqual([offline.status, offline.json.code], [502, 'FETCH_FAILED']);
  assert.deepEqual([offlineSeed.status, offlineSeed.json.code], [502, 'FETCH_FAILED'], 'a seeding too');
  assert.equal((await call('GET', `${base}`)).json.notes.find((n) => n.name === 'lint').state, 'local', 'nothing was queued');
  const path = `/api/memory/projects/${seedp.key}/files/lint`;
  await call('PUT', path, { text: (await call('GET', path)).json.text.replace('Mine: eslint.', 'Mine: eslint --fix.') });
  const stale = await call('POST', `${base}/resolve`, { name: 'lint', action: 'share', hash: lint.hash, teamHash: lint.team.hash });
  assert.deepEqual([stale.status, stale.json.code, stale.json.names], [409, 'STALE', ['lint']]);
  // B23, like every memory write: while a defragment run is live on the scope, the routes that rewrite notes wait for it.
  mod.runs.set('fake-defrag', { id: 'fake-defrag', orch: { memoryScope: 'project', pause: () => ({}) }, projectDir: seedp.path, kind: 'run', status: 'running', events: [], pendingQuestion: null });
  try {
    for (const [p, body] of [[`${base}/seed`, { decisions: [{ name: 'lint', action: 'skip', hash: lint.hash, teamHash: lint.team.hash }] }],
      [`${base}/resolve`, { name: 'lint', action: 'take-team', hash: lint.hash, teamHash: lint.team.hash }], [`${base}/seed/undo`]]) {
      const locked = await call('POST', p, body);
      assert.deepEqual([locked.status, locked.json.runId], [409, 'fake-defrag'], p);
    }
  } finally { mod.runs.delete('fake-defrag'); }
  // Every route that pushes notes off the machine or rewrites them answers only pages served by this Worca (E8).
  // Also the seed preview (it fetches and follows: m7) and, opted in, a History restore (it pushes to the team: m2).
  const guarded = [['POST', `${base}/sync`], ['DELETE', `${base}/notes/nope`], ['GET', `${base}/seed`], ['POST', `${base}/seed`], ['POST', `${base}/resolve`],
    ['POST', `${base}/seed/undo`], ['POST', `${base}/seed/dismiss`], ['POST', `/api/memory/projects/${seedp.key}/history/20261024-031500-team/restore`]];
  for (const [method, p] of guarded) {
    const cross = await raw(method, p, { origin: 'http://127.0.0.1:4401' });
    assert.equal(cross.status, 403, `${method} ${p}`);   // G10: the global Origin check answers first, with a bare 403
  }
  const img = await raw('GET', `${base}/seed`, { headers: { 'sec-fetch-site': 'same-site' } });   // an <img> on another port: no Origin
  assert.deepEqual([img.status, img.json.code], [403, 'CROSS_ORIGIN']);
  assert.equal((await raw('GET', `${base}/seed`, { headers: { 'sec-fetch-site': 'same-origin' } })).status, 200, 'this Worca\'s own page');
  const offRestore = await raw('POST', `/api/memory/projects/${plain.key}/history/20261024-031500-team/restore`, { headers: { 'sec-fetch-site': 'same-site' } });
  assert.notEqual(offRestore.status, 403, 'off: the restore of before team memory (D1)');
  // A possible agent (agent isolation on, no signed-in person) is refused like on the Update routes: seeding is consent (m6).
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(root, 'agent-home');
  try {
    for (const [method, p] of guarded) {
      const agent = await raw(method, p);
      assert.deepEqual([agent.status, agent.json.code], [403, 'AGENT_CALLER_BLOCKED'], `${method} ${p}`);   // G1: the global gate answers first
    }
    assert.equal((await raw('GET', base, { headers: { [UI_TOKEN_HEADER]: mod._testing.uiToken() } })).status, 200, 'the status stays readable');
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; }
  assert.equal((await call('GET', `/api/memory/team/${plain.key}/seed`)).status, 409);
  assert.equal((await call('GET', '/api/memory/team/nope-00000000/seed')).status, 404);
});

test('1b: a seeding, a Compare and an Undo that rewrite notes tell open Memory views to refetch (memory-changed); Undo\'s flush drops an intent another writer queued on a note it put back', { skip }, async () => {
  const obare = makeOrigin(root, 'seedframes');
  const op = await addProjectOf('seedframes', cloneAs(root, 'm', obare, 'seedframes'));
  for (const [n, body] of [['build', 'Mine: make.'], ['lint', 'Mine: eslint.']]) {
    await writeMemory(memoryRoot(), projectScope(op.key), n, `---\nname: ${n}\ndescription: About ${n}\n---\n${body}\n`, { source: 'user' });
  }
  assert.equal((await call('PATCH', `/api/projects/${op.key}/settings`, { 'memory.team': true })).status, 200);
  teammateStarts(obare, { build: 'Theirs: build.', lint: 'Theirs: lint.' });
  const base = `/api/memory/team/${op.key}`;
  const frames = [];
  const ws = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m.type === 'memory-changed' && m.scope === `projects/${op.key}`) frames.push(m); } catch { /* not a frame */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const framesReach = async (n) => {
    for (const t0 = Date.now(); frames.length < n && Date.now() - t0 < 5000;) await new Promise((r) => setTimeout(r, 15));
    assert.equal(frames.length, n);
  };
  try {
    const pv = Object.fromEntries((await call('GET', `${base}/seed`)).json.notes.map((n) => [n.name, n]));
    const d = (name, action) => ({ name, action, hash: pv[name].hash, teamHash: pv[name].team.hash });
    assert.deepEqual((await call('POST', `${base}/seed`, { decisions: [d('build', 'take-team')] })).json.tookTeam, ['build']);
    await framesReach(1);
    assert.deepEqual((await call('POST', `${base}/resolve`, d('lint', 'take-team'))).json.tookTeam, ['lint']);
    await framesReach(2);
    // An agent's edit of the taken copy, queued while offline: Undo puts my note back over it, and Undo's own flush drops
    // that intent — my note is at its baseline, so nothing is left to push.
    await writeMemory(memoryRoot(), projectScope(op.key), 'build', '---\nname: build\ndescription: About build\n---\nAn agent\'s edit, its push still waiting.\n', { source: 'run:1' });
    assert.deepEqual((await queueTeamChanges(op.key, ['build'], { flush: false })).queued, ['build']);
    const head = git(obare, 'rev-parse', TEAM_MEMORY_BRANCH).trim();
    assert.deepEqual((await call('POST', `${base}/seed/undo`)).json.restored, ['build']);
    await framesReach(3);
    await drainTeamMemoryFlushes();
    assert.equal((await call('GET', base)).json.notes.find((n) => n.name === 'build').state, 'local', 'nothing waits to be pushed');
    assert.equal(git(obare, 'rev-parse', TEAM_MEMORY_BRANCH).trim(), head, 'and nothing was pushed');
  } finally { ws.close(); }
});

test('1b: Not now closes the offer for good — it survives switching off and on', { skip }, async () => {
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.seed.offer, 'pending');
  const r = await call('POST', `/api/memory/team/${shop.key}/seed/dismiss`);
  assert.deepEqual([r.status, r.json.status.seed.offer], [200, 'dismissed']);
  assert.equal((await call('PATCH', `/api/projects/${shop.key}/settings`, { 'memory.team': null })).status, 200);
  assert.equal((await call('PATCH', `/api/projects/${shop.key}/settings`, { 'memory.team': true })).status, 200);
  assert.equal((await call('GET', `/api/memory/team/${shop.key}`)).json.seed.offer, 'dismissed');
});

// ── E10: a team already sharing — the check after an add, the project list's offer, Not now and Turn on ──────────
const projectRow = async (key) => (await call('GET', '/api/projects')).json.projects.find((p) => p.key === key);
async function offerOf(key, want) {
  for (const t0 = Date.now(); Date.now() - t0 < 10_000;) {
    const p = await projectRow(key);
    if (!!(p && p.teamMemoryOffer) === want) return want;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !want;
}

test('E10: Add and the bulk import check origin in the background; the project list carries the offer only where the branch is', { skip }, async () => {
  const shared = makeOrigin(root, 'addshared');
  teammateStarts(shared, { build: 'make' });
  const lonely = makeOrigin(root, 'addlonely');
  const one = await call('POST', '/api/projects', { name: 'addshared', path: cloneAs(root, 'e10', shared, 'addshared') });
  assert.equal(one.status, 200);
  const key = one.json.projects.find((p) => p.name === 'addshared').key;
  assert.equal(await offerOf(key, true), true);
  const st = (await call('GET', `/api/memory/team/${key}`)).json;
  assert.deepEqual([st.enabled, st.available.branchOnOrigin, st.available.offer], [false, true, true], 'offered, never switched on');
  const bulk = await call('POST', '/api/projects/bulk', { projects: [
    { name: 'bulkshared', path: cloneAs(root, 'e10b', shared, 'bulkshared') },
    { name: 'bulklonely', path: cloneAs(root, 'e10b', lonely, 'bulklonely') },
  ] });
  assert.equal(bulk.status, 200);
  const [bs, bl] = bulk.json.results.map((r) => r.key);
  assert.equal(await offerOf(bs, true), true);
  for (const t0 = Date.now(); (await call('GET', `/api/memory/team/${bl}`)).json.available.branchOnOrigin === null && Date.now() - t0 < 10_000;) await new Promise((r) => setTimeout(r, 25));
  assert.equal((await call('GET', `/api/memory/team/${bl}`)).json.available.branchOnOrigin, false);
  assert.equal((await projectRow(bl)).teamMemoryOffer, undefined);
});

test('E10: a remote that never answers does not hold or fail the add', { skip }, async () => {
  const { _testing: mt } = await import('../src/core/metrics/sync.mjs');
  mt.setGit(() => new Promise(() => {}));   // every network git call hangs
  try {
    const bare = makeOrigin(root, 'hangs');
    const t0 = Date.now();
    const r = await call('POST', '/api/projects', { name: 'hangs', path: cloneAs(root, 'e10h', bare, 'hangs') });
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 5000, 'answered without waiting for origin');
    assert.ok(r.json.projects.some((p) => p.name === 'hangs'));
  } finally { mt.reset(); }
});

test('E10: Not now is guarded, closes the offer for good; Turn on is the normal switch and the line goes', { skip }, async () => {
  const shared = makeOrigin(root, 'e10turn');
  teammateStarts(shared, { lint: 'eslint' });
  const later = (await call('POST', '/api/projects', { name: 'e10later', path: cloneAs(root, 'e10t', shared, 'e10later') })).json.projects.find((p) => p.name === 'e10later');
  const turn = (await call('POST', '/api/projects', { name: 'e10turn', path: cloneAs(root, 'e10u', shared, 'e10turn') })).json.projects.find((p) => p.name === 'e10turn');
  assert.equal(await offerOf(later.key, true), true);
  assert.equal(await offerOf(turn.key, true), true);
  const cross = await raw('POST', `/api/memory/team/${later.key}/available/dismiss`, { origin: 'http://127.0.0.1:4401' });
  assert.equal(cross.status, 403);   // G10: the global Origin check answers first, with a bare 403
  assert.equal((await projectRow(later.key)).teamMemoryOffer, true, 'a refused dismiss changes nothing');
  const d = await call('POST', `/api/memory/team/${later.key}/available/dismiss`);
  assert.deepEqual([d.status, d.json.available.state, d.json.available.offer], [200, 'dismissed', false]);
  assert.equal((await projectRow(later.key)).teamMemoryOffer, undefined);
  assert.equal((await call('GET', `/api/memory/team/${later.key}`)).json.enabled, false, 'Not now switches nothing');
  // Turn on: PATCH memory.team — switchTeamMemoryOn's checks, then the fetch at once.
  const on = await call('PATCH', `/api/projects/${turn.key}/settings`, { 'memory.team': true });
  assert.equal(on.status, 200);
  const st = (await call('GET', `/api/memory/team/${turn.key}`)).json;
  assert.deepEqual([st.enabled, st.available.state, st.available.offer], [true, 'accepted', false]);
  assert.equal((await projectRow(turn.key)).teamMemoryOffer, undefined, 'the line is hidden once on');
  assert.equal((await call('PATCH', `/api/projects/${turn.key}/settings`, { 'memory.team': null })).status, 200);
  assert.equal((await projectRow(turn.key)).teamMemoryOffer, undefined, 'and stays hidden after a switch-off');
  assert.equal((await call('POST', '/api/memory/team/nope-00000000/available/dismiss')).status, 404);
});
