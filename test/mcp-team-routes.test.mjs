// test/mcp-team-routes.test.mjs — the Team consent routes (MCP registry spec §11.2, §11.3, §12):
// definition, values and hash from the cached policy only; 409 on a stale expectHash; seeded values;
// Team state removed only by a Team action on a present doc that no longer lists the entry; Forget.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs, readTeamPolicyPrefs } from '../src/core/config.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';
import { entryHash } from '../src/core/mcp/team.mjs';
import { setTeamState, putMember, mcpDir } from '../src/core/mcp/store.mjs';
import { loadCatalog } from '../src/core/mcp/catalog.mjs';
import { removeProject } from '../src/core/projects.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'platform-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const HOME = 'acme/platform';
const KEY = projectKey(dir);
const GH = `policy:${HOME}/github`; const LIN = `policy:${HOME}/linear`; const SENTRY = 'plugin:acme-tools/sentry';
const GITHUB = { name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_HOST: { field: 'host' }, GITHUB_PERSONAL_ACCESS_TOKEN: { field: 'token' } },
  fields: [{ key: 'host', label: 'Host', required: true }, { key: 'token', label: 'Token', secret: true, required: true }],
  values: { host: 'github.acme.io' } };
// Offline fixtures: a background Test (§7.3) of what these tests install must never reach the network —
// linear points at a closed loopback port, probe runs `node --version`, github waits for its token.
const LINEAR = { name: 'linear', type: 'http', url: 'http://127.0.0.1:9/mcp', fields: [] };
// No fields and a command that exits at once: a real background Test fails fast and records it.
const PROBE = { name: 'probe', type: 'stdio', command: 'node', args: ['--version'], fields: [] };
const doc = (value) => ({ schema: 1, fields: { 'plugins.required': { kind: 'soft', value: [{ name: 'acme-tools' }] }, 'mcp.required': { kind: 'soft', value } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } });
const cache = (d, warnings = []) => writeTeamPolicyPrefs(KEY, { present: true, hasOrigin: true, docKnown: true, unknownSchema: false, slug: HOME, headSha: '8c1d2e0', delegateTo: null, checkedAt: new Date().toISOString(), doc: d, warnings });
// The lead published for a newer Worca: this one cannot read the doc (discovery caches it with `unknownSchema`).
const cacheUnreadable = () => writeTeamPolicyPrefs(KEY, { unknownSchema: true, doc: null, warnings: ['policy.json schema 2 needs a newer Worca (this one reads 1)'] });
const hashOf = (d, name) => entryHash(normalizePolicyDoc(d).doc.fields['mcp.required'].value.find((e) => (e.name || e.server) === name));
const file = (f) => JSON.parse(readFileSync(join(mcpDir(), `${f}.json`), 'utf8'));
const enc = encodeURIComponent;
let srv, base, setId;
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const act = (action, id, body) => post(`/api/mcp/teams/${enc(HOME)}/members/${enc(id)}/${action}`, body);

before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = appServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });

const D1 = doc([GITHUB, LINEAR, PROBE, { plugin: 'acme-tools', server: 'sentry' }]);

test('install: expectHash required and checked; the definition and values come from the cached policy, never the body', async () => {
  cache(D1);
  assert.equal((await act('install', GH, {})).status, 400);
  assert.equal((await act('install', GH, { expectHash: 'abc' })).status, 400, 'a malformed expectHash');
  assert.equal((await act('install', GH, { expectHash: 'f'.repeat(64), consent: 'x' })).status, 400, 'bodies never set consent (§12)');
  const stale = await act('install', GH, { expectHash: 'f'.repeat(64) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'the team definition changed, review it again');
  const hash = hashOf(D1, 'github');
  const r = await act('install', GH, { expectHash: hash, def: { type: 'stdio', command: '/bin/evil' }, values: { host: 'evil' } });
  assert.equal(r.status, 200, await r.clone().text());
  ({ setId } = await r.json());
  const servers = file('servers');
  assert.equal(servers.policy[`${HOME}/github`].def.command, 'npx');
  assert.equal(servers.policy[`${HOME}/github`].hash, hash);
  assert.equal(servers.bases[GH], 'github');
  assert.deepEqual(file('sets').teams[HOME].members[GH], { enabled: true, values: { host: 'github.acme.io' }, seeded: { host: 'github.acme.io' }, consent: hash });
  assert.equal((await act('install', GH, { expectHash: hash })).status, 409, 'already installed');
});

test('Install re-tests the new member in the background (§7.3)', async () => {
  const id = `policy:${HOME}/probe`;
  assert.equal((await act('install', id, { expectHash: hashOf(D1, 'probe') })).status, 200);
  let tested = false;
  for (let i = 0; i < 100 && !tested; i++) { await new Promise((res) => setTimeout(res, 100)); try { tested = Object.hasOwn(file('tests').tests, `${setId}|${id}`); } catch { /* not yet */ } }
  assert.ok(tested, 'a Test result for the new member, without a click on Test');
});

test('unknown home or entry: 404; an entry not installed here: 409', async () => {
  const r = await post(`/api/mcp/teams/${enc('acme/nope')}/members/${enc(GH)}/turn-on`, { expectHash: 'a'.repeat(64) });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'no project here follows acme/nope');
  assert.equal((await act('turn-on', `policy:${HOME}/other`, { expectHash: 'a'.repeat(64) })).status, 404);
  assert.equal((await act('turn-on', SENTRY, { expectHash: hashOf(D1, 'sentry') })).status, 409, 'its plugin is not installed here');
  assert.equal((await act('install', SENTRY, { expectHash: hashOf(D1, 'sentry') })).status, 409, 'a plugin reference comes with its plugin: never installed here');
  assert.equal((await post(`/api/mcp/teams/${enc('Acme/Platform')}/forget`)).status, 400);
  assert.equal((await post(`/api/mcp/teams/${enc(`acme/${'a'.repeat(300)}`)}/members/${enc(GH)}/turn-on`, { expectHash: 'a'.repeat(64) })).status, 404, 'a long slug (deep subgroups) is a home too: never refused as malformed');
  assert.equal((await act('turn-on', 'policy:Acme/x', { expectHash: 'a'.repeat(64) })).status, 400, 'a bad server id is refused before any lookup');
});

test('Update: a changed team definition keeps the consented copy until Update; untouched seeds follow', async () => {
  const lin = await act('install', LIN, { expectHash: hashOf(D1, 'linear') });
  assert.equal(lin.status, 200);
  const D2 = doc([{ ...GITHUB, args: ['-y', '@modelcontextprotocol/server-github@2'], values: { host: 'github.acme.com' } }, LINEAR, { plugin: 'acme-tools', server: 'sentry' }]);
  cache(D2);
  const newHash = hashOf(D2, 'github');
  const on = await act('turn-on', GH, { expectHash: newHash });
  assert.equal(on.status, 409, 'Turn on never slips in a new definition');
  assert.equal(file('servers').policy[`${HOME}/github`].def.args[1], '@modelcontextprotocol/server-github', 'still the consented copy');
  assert.equal((await act('update', LIN, { expectHash: hashOf(D2, 'linear') })).status, 409, 'nothing to update');
  const up = await act('update', GH, { expectHash: newHash });
  assert.equal(up.status, 200, await up.clone().text());
  assert.equal(file('servers').policy[`${HOME}/github`].def.args[1], '@modelcontextprotocol/server-github@2');
  assert.deepEqual(file('sets').teams[HOME].members[GH], { enabled: true, values: { host: 'github.acme.com' }, seeded: { host: 'github.acme.com' }, consent: newHash });
  // A value the user changed is kept through an Update; only its seed follows the team (§11.2).
  await setTeamState(HOME, GH, { values: { host: 'mine.example' } });
  const D2b = doc([{ ...GITHUB, args: ['-y', '@modelcontextprotocol/server-github@3'], values: { host: 'github.acme.net' } }, LINEAR, { plugin: 'acme-tools', server: 'sentry' }]);
  cache(D2b);
  assert.equal((await act('update', GH, { expectHash: hashOf(D2b, 'github') })).status, 200);
  const m = file('sets').teams[HOME].members[GH];
  assert.deepEqual([m.values, m.seeded], [{ host: 'mine.example' }, { host: 'github.acme.net' }]);
});

test('Team state goes only in a Team action on a present doc that no longer lists the entry; listed-but-absent or unreadable keeps it', async () => {
  await setTeamState(HOME, SENTRY, { enabled: true, consent: 'c'.repeat(64) });   // listed, plugin not installed here
  // linear still listed, in a shape this build drops (a newer rule, a typo): discovery cached the doc without it, with
  // its warning. That is not "no longer listed": its state stays.
  const unread = normalizePolicyDoc(doc([GITHUB, { plugin: 'acme-tools', server: 'sentry' }, { ...LINEAR, values: { nope: 'x' } }]));
  cache(unread.doc, unread.warnings);
  assert.equal((await act('turn-on', LIN, { expectHash: hashOf(D1, 'linear') })).status, 404, 'not required in a shape this build reads');
  assert.ok(file('sets').teams[HOME].members[LIN], 'an entry this build drops keeps its state');
  const D3 = doc([GITHUB, { plugin: 'acme-tools', server: 'sentry' }]);   // linear dropped
  cache(D3);
  // Reading the cache alone never removes anything.
  assert.equal((await fetch(`${base}/api/policy/scopes`)).status, 200);
  assert.ok(file('sets').teams[HOME].members[LIN], 'linear\'s state survives a read');
  const r = await act('turn-on', LIN, { expectHash: hashOf(D1, 'linear') });
  assert.equal(r.status, 404, 'no longer required');
  const members = file('sets').teams[HOME].members;
  assert.equal(members[LIN], undefined, 'removed by the Team action');
  assert.ok(members[SENTRY], 'listed but not installed: kept');
  assert.ok(members[GH]);
});

test('Forget: a home still requiring servers keeps what it lists; one this Worca cannot read keeps all (409); a home that requires nothing or has no cached doc goes whole, record too', async () => {
  const def = (await loadCatalog()).find((c) => c.id === GH).def;
  await putMember(setId, GH, { secrets: { token: 'ghp_x' } }, { team: { home: HOME }, def });
  const kept = await post(`/api/mcp/teams/${enc(HOME)}/forget`);
  assert.equal(kept.status, 200);
  assert.deepEqual(Object.keys(file('sets').teams[HOME].members).sort(), [GH, SENTRY].sort(), 'the cached doc still lists github and sentry');
  assert.ok(file('secrets').sets[setId][GH].token);
  cacheUnreadable();
  const unread = await post(`/api/mcp/teams/${enc(HOME)}/forget`);
  assert.equal(unread.status, 409);
  assert.equal((await unread.json()).error, 'this Worca cannot read every MCP server the policy of acme/platform lists — nothing was removed');
  assert.ok(file('secrets').sets[setId][GH].token, 'a policy this Worca cannot read removes nothing');
  // Every entry of the cached doc is one this build drops: the set greys (it requires nothing readable), yet the team
  // still lists them — Forget removes nothing either.
  const allDropped = normalizePolicyDoc(doc([{ ...GITHUB, values: { nope: 'x' } }]));
  cache(allDropped.doc, allDropped.warnings);
  assert.equal((await post(`/api/mcp/teams/${enc(HOME)}/forget`)).status, 409);
  assert.ok(file('secrets').sets[setId][GH].token, 'the token of an entry the team still lists stays');
  // The team stopped requiring MCP servers: the Team set is greyed (P6 teamSetsOf) and Forget drops the whole home —
  // its record too, so the greyed set leaves the list instead of staying there empty.
  cache(doc([]));
  const r = await post(`/api/mcp/teams/${enc(HOME)}/forget`);
  assert.equal(r.status, 200);
  assert.equal(file('sets').teams?.[HOME], undefined, 'the greyed set leaves the list');
  assert.equal(file('secrets').sets[setId]?.[GH], undefined);
  assert.equal(Object.keys(file('tests').tests).some((k) => k.startsWith(`${setId}|`)), false);
  // No cached doc (no project here follows the home): the whole home goes too.
  await setTeamState(HOME, SENTRY, { enabled: true, consent: 'c'.repeat(64) });
  writeTeamPolicyPrefs(KEY, { present: false, docKnown: false, doc: null });
  assert.equal((await post(`/api/mcp/teams/${enc(HOME)}/forget`)).status, 200);
  assert.equal(file('sets').teams?.[HOME], undefined);
});

test('Update runs the §4.6 field migration (a field the team dropped loses its value; a kept secret stays) and re-tests only switched-on memberships', async () => {
  const MIG = { name: 'mig', type: 'stdio', command: 'node', args: ['--version'],
    env: { MIG_HOST: { field: 'host' }, MIG_TOKEN: { field: 'token' } },
    fields: [{ key: 'host', label: 'Host', required: true }, { key: 'token', label: 'Token', secret: true, required: true }],
    values: { host: 'a.example' } };
  const id = `policy:${HOME}/mig`;
  const A = doc([GITHUB, MIG]);
  cache(A);
  assert.equal((await act('install', id, { expectHash: hashOf(A, 'mig') })).status, 200);
  const def = (await loadCatalog()).find((c) => c.id === id).def;
  await putMember(setId, id, { secrets: { token: 'tok-12345678' } }, { team: { home: HOME }, def });
  // A user set holds it too (Add to set), switched on; the Team member is switched off.
  await putMember('general', id, { enabled: true, values: { host: 'a.example' }, secrets: { token: 'tok-general1' } }, { def });
  await setTeamState(HOME, id, { enabled: false });
  const B = doc([GITHUB, { name: 'mig', type: 'stdio', command: 'node', args: ['--version'], env: { MIG_TOKEN: { field: 'token' } }, fields: [MIG.fields[1]] }]);
  cache(B);
  assert.equal((await act('update', id, { expectHash: hashOf(B, 'mig') })).status, 200);
  assert.deepEqual(file('sets').teams[HOME].members[id].values, {}, 'host is no field any more');
  assert.equal(file('sets').teams[HOME].members[id].enabled, false, 'Update keeps the switch');
  assert.ok(file('secrets').sets[setId][id].token, 'token is still a secret field: kept');
  // §7.3: Update re-tests the switched-on memberships of the new definition (the user set's); a switched-off one starts nothing.
  let tested = false;
  for (let i = 0; i < 100 && !tested; i++) { await new Promise((res) => setTimeout(res, 100)); try { tested = Object.hasOwn(file('tests').tests, `general|${id}`); } catch { /* not yet */ } }
  assert.ok(tested, 'the user set holding the updated definition is re-tested');
  await new Promise((res) => setTimeout(res, 500));
  assert.equal(Object.hasOwn(file('tests').tests, `${setId}|${id}`), false, 'the switched-off Team member is not started');
});

test('a Turn on that replaces an older consented copy re-tests every switched-on membership of the server (§7.3)', async () => {
  const id = `policy:${HOME}/mig`;
  const before = file('tests').tests[`general|${id}`]?.fingerprint;
  assert.ok(before, 'the previous test tested the user set\'s membership');
  // The team stops listing mig: a Team action (here Forget) drops its Team state; the stored copy and the user set stay.
  cache(doc([GITHUB]));
  assert.equal((await post(`/api/mcp/teams/${enc(HOME)}/forget`)).status, 200);
  assert.equal(file('sets').teams[HOME].members[id], undefined);
  // Listed again with a new definition: the first Turn on stores it in place of the old copy.
  const C = doc([GITHUB, { name: 'mig', type: 'stdio', command: 'node', args: ['-v'], env: { MIG_TOKEN: { field: 'token' } }, fields: [{ key: 'token', label: 'Token', secret: true, required: true }] }]);
  cache(C);
  assert.equal((await act('turn-on', id, { expectHash: hashOf(C, 'mig') })).status, 200);
  assert.deepEqual(file('servers').policy[`${HOME}/mig`].def.args, ['-v']);
  let after = before;
  for (let i = 0; i < 100 && after === before; i++) { await new Promise((res) => setTimeout(res, 100)); after = file('tests').tests[`general|${id}`]?.fingerprint; }
  assert.notEqual(after, before, 'the user set holding the replaced copy is re-tested');
});

test('adding a project discovers its team policy at once: a re-cloned home never greys until the background discovery (§11.2)', async () => {
  const one = mkdtempSync(join(tmpdir(), 'reclone-')); const two = mkdtempSync(join(tmpdir(), 'reclone-'));
  for (const d of [one, two]) execFileSync('git', ['init', '-q', d]);
  const discovered = async (d) => {
    let prefs = null;
    for (let i = 0; i < 50 && !prefs?.checkedAt; i++) { await new Promise((res) => setTimeout(res, 100)); prefs = readTeamPolicyPrefs(projectKey(d)); }
    return !!prefs?.checkedAt;
  };
  try {
    const r = await post('/api/projects', { name: 'reclone', path: one });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(await discovered(one), 'POST /api/projects runs discoverPolicy for the project');
    const b = await post('/api/projects/bulk', { projects: [{ name: 'reclone-bulk', path: two }] });
    assert.equal(b.status, 200, await b.clone().text());
    assert.ok(await discovered(two), 'so does the multi-folder add');
  } finally {
    await removeProject('reclone'); await removeProject('reclone-bulk');
    for (const d of [one, two]) rmSync(d, { recursive: true, force: true });
  }
});

// ---- retired policy servers (Task 6) -----------------------------------------------------------
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

test('a policy server no cached home requires is retired: flagged, still in the catalog, Remove deletes it everywhere', async () => {
  cacheUnreadable();
  assert.deepEqual((await loadCatalog()).filter((c) => c.retired).map((c) => c.id), [], 'a home whose policy this Worca cannot read retires nothing');
  cache(doc([GITHUB, { ...LINEAR, values: { nope: 'x' } }]));   // linear still listed, in a shape this build drops
  assert.deepEqual((await loadCatalog()).filter((c) => c.retired).map((c) => c.id), [], 'a home listing an entry this build cannot read retires nothing');
  cache(doc([GITHUB]));
  const cat = await loadCatalog();
  assert.deepEqual(cat.filter((c) => c.retired).map((c) => c.id), [LIN, `policy:${HOME}/mig`, `policy:${HOME}/probe`]);
  assert.equal(cat.find((c) => c.id === GH).retired, undefined, 'still required');
  await putMember('general', LIN, { enabled: true }, { def: cat.find((c) => c.id === LIN).def });
  const { resolveSet, viewContext } = await import('../src/core/mcp/views.mjs');
  assert.ok(resolveSet({ ...(await viewContext()), setId: 'general' }).copies.some((c) => c.serverId === LIN), 'retired: still works in your own sets');
  const still = await del(`/api/mcp/servers/${enc(GH)}`);   // P6's route: a required policy server stays
  assert.equal(still.status, 400);
  assert.equal((await still.json()).error, 'a server team policy requires cannot be removed here');
  assert.equal((await del(`/api/mcp/servers/${enc(`policy:${HOME}/nope`)}`)).status, 404);
  const r = await del(`/api/mcp/servers/${enc(LIN)}`);
  assert.equal(r.status, 200);
  assert.equal(file('servers').policy[`${HOME}/linear`], undefined);
  assert.equal((await loadCatalog()).some((c) => c.id === LIN), false);
});

test('reconcile persists the Team record of every cached home with entries (§4.4)', async () => {
  const { reconcileMcpStore } = await import('../src/core/mcp/catalog.mjs');
  cache(doc([GITHUB]));
  const sets = join(mcpDir(), 'sets.json');
  const before = JSON.parse(readFileSync(sets, 'utf8'));
  delete before.teams[HOME];
  writeFileSync(sets, JSON.stringify(before));
  await reconcileMcpStore();
  assert.deepEqual(Object.keys(file('sets').teams[HOME]).sort(), ['id', 'members', 'name', 'slug']);
  assert.equal(file('sets').teams[HOME].id, setId);
  // A home that requires no MCP server gets no Team record (§4.4: one with ≥1 entry).
  writeTeamPolicyPrefs('other-0123abcd', { present: true, hasOrigin: true, docKnown: true, unknownSchema: false, slug: 'acme/other', headSha: '1111111', delegateTo: null, checkedAt: new Date().toISOString(), doc: { schema: 1, fields: {} }, warnings: [] });
  try { await reconcileMcpStore(); assert.equal(file('sets').teams?.['acme/other'], undefined); }
  finally { writeTeamPolicyPrefs('other-0123abcd', { present: false, docKnown: false, doc: null }); }
});

// ---- /api/policy/scopes carries mcpRequirements; MCP deviations on the policy page (Task 7) -----
import { addProject } from '../src/core/projects.mjs';

test('GET /api/policy/scopes carries mcpRequirements for every cached home, hashed as the routes check them', async () => {
  const j = await (await fetch(`${base}/api/policy/scopes`)).json();
  assert.deepEqual(j.mcpRequirements.map((r) => [r.home, r.serverId, r.state]), [[HOME, GH, 'never-consented']]);
  assert.equal(j.mcpRequirements[0].hash, hashOf(doc([GITHUB]), 'github'));
});

test('the policy page\'s off-policy card and the New Pipeline notes list the Team set\'s MCP deviations (§11.4, §6.2)', async () => {
  await addProject({ name: 'platform', path: dir });
  const D = doc([GITHUB, LINEAR, PROBE]);
  cache(D);
  assert.equal((await act('turn-on', `policy:${HOME}/probe`, { expectHash: hashOf(D, 'probe') })).status, 200);
  const card = await (await fetch(`${base}/api/policy?scope=project:${KEY}`)).json();
  assert.deepEqual(card.deviations.map((d) => d.code).filter((c) => c.startsWith('mcp-')), ['mcp-off:github', 'mcp-missing:linear']);
  const notes = await (await fetch(`${base}/api/policy/notes?scope=project:${KEY}&mcpOptOut=${enc(`${setId}|policy:${HOME}/probe`)}`)).json();
  assert.ok(notes.notes.some((n) => n.code === 'mcp-opted-out:probe'), JSON.stringify(notes.notes));
});

test('a live Team set through P6 and P4 routes: project tab and usedBy, Duplicate, a run opting out of a Team member (§8, §12, §6.2)', async () => {
  const PR = `policy:${HOME}/probe`;
  assert.equal((await act('turn-on', GH, { expectHash: hashOf(doc([GITHUB, LINEAR, PROBE]), 'github') })).status, 200);
  const def = (await loadCatalog()).find((c) => c.id === GH).def;
  await putMember(setId, GH, { secrets: { token: 'ghp_team12345' } }, { team: { home: HOME }, def });
  assert.deepEqual((await (await fetch(`${base}/api/mcp/projects/${KEY}`)).json()).team, { id: setId, name: `Team · ${HOME}`, home: HOME });
  assert.deepEqual((await (await fetch(`${base}/api/mcp/sets/${setId}`)).json()).set.usedBy, [{ key: KEY, name: 'platform' }]);
  const dup = await post(`/api/mcp/sets/${setId}/duplicate`, { name: 'Platform copy' });
  assert.equal(dup.status, 200, await dup.clone().text());
  const { id } = await dup.json();
  assert.deepEqual(file('sets').sets[id].members, [{ server: GH, enabled: true, values: { host: 'github.acme.io' } }, { server: PR, enabled: true, values: {} }]);
  assert.equal(file('secrets').sets[id][GH].token.value, 'ghp_team12345');
  const { runs } = await import('../ui/server.mjs');
  const r = await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, mcpOptOut: [`${setId}|${PR}`] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(runs.get((await r.json()).runId).orch.mcpOptOut, [`${setId}|${PR}`], 'a Team membership is known to the run-start check');
});

test('a workspace scope\'s policy card lists its Team set\'s MCP deviations too (§11.4)', async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'platform2-'));
  try {
    for (const d of [dir, dir2]) execFileSync('git', ['init', '-q', d]);
    await addProject({ name: 'platform2', path: dir2 });
    const cr = await post('/api/workspaces', { name: 'Platform WS', projectPaths: [dir, dir2] });
    assert.ok(cr.status === 200 || cr.status === 201, await cr.clone().text());
    const wsId = (await cr.json()).workspace.id;
    const up = await fetch(`${base}/api/workspaces/${wsId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policyProject: dir }) });
    assert.equal(up.status, 200, await up.clone().text());
    const ws = await (await fetch(`${base}/api/policy?scope=workspace:${wsId}`)).json();
    assert.ok(ws.deviations.some((d) => d.code.startsWith('mcp-')), JSON.stringify(ws.deviations));
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});
