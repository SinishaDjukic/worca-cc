// test/skills-team.test.mjs — required skills in the Team set (skills registry spec §5, §7, F8): the consent hash,
// one checklist row per `skills.required` entry, Turn on (the only consent write) and Forget.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeMcpPlugin } from './helpers/mcp-plugin-fixture.mjs';
import { put } from './helpers/mcp-store-fixtures.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';
import { canonicalJson, sha256Hex } from '../src/core/mcp/definitions.mjs';
import { mcpDir } from '../src/core/mcp/store.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { reconcileMcpStore } from '../src/core/mcp/catalog.mjs';
import { skillSkipReasonText } from '../src/core/skills-registry/texts.mjs';
import { skillConsentHash, teamSkillRows, teamSkillAction, teamSkillConsent, teamForget, isTeamSkillId } from '../src/core/mcp/team.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-skills-team-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const HOME = 'acme/platform';
const TEAM_ID = 'team-acme-platform-9333';
const DIR = mkdtempSync(join(scratch, 'platform-'));
const KEY = projectKey(DIR);
const DEPLOY = { plugin: 'acme', skill: 'deploy-checklist' };
const NOTES = { plugin: 'acme', skill: 'release-notes' };
const QA = { plugin: 'acme-qa', skill: 'qa-runbook' };
const ID = (e) => `skill:plugin:${e.plugin}/${e.skill}`;
const policy = (skills, extra = {}) => ({ schema: 1, fields: {
  'plugins.required': { kind: 'soft', value: [{ name: 'acme' }, { name: 'acme-qa' }] },
  'skills.required': { kind: 'soft', value: skills }, ...extra }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } });
const cache = (d, warnings = []) => writeTeamPolicyPrefs(KEY, { present: true, hasOrigin: true, docKnown: true, unknownSchema: false,
  slug: HOME, headSha: '8c1d2e0', delegateTo: null, checkedAt: new Date().toISOString(), doc: d, warnings });
const sets = () => JSON.parse(readFileSync(join(mcpDir(), 'sets.json'), 'utf8'));
const DEPLOY_MD = '---\nname: deploy-checklist\ndescription: Pre-deploy checks\nallowed-tools: Read\n---\n# Deploy\nRun scripts/preflight.sh first.\nTag: !`git describe --tags`\n';
let linked = false;
async function linkAcme() {
  if (linked) return;
  linked = true;
  await linkPlugin('acme', writeMcpPlugin(join(scratch, 'acme'), { name: 'acme', mcpServers: {}, files: {
    'skills/deploy-checklist/SKILL.md': DEPLOY_MD,
    'skills/deploy-checklist/scripts/preflight.sh': '#!/bin/sh\necho ok\n',
    'skills/release-notes/SKILL.md': '---\nname: release-notes\ndescription: Draft release notes\n---\n# Notes\n',
  } }));
}

test('consent hash: sha256 of canonical { plugin, skill } — key order never changes it; a plugin skill id is the only Team skill id', () => {
  assert.equal(skillConsentHash(DEPLOY), sha256Hex(canonicalJson({ plugin: 'acme', skill: 'deploy-checklist' })));
  assert.equal(skillConsentHash({ skill: 'deploy-checklist', plugin: 'acme' }), skillConsentHash(DEPLOY));
  assert.notEqual(skillConsentHash(NOTES), skillConsentHash(DEPLOY));
  assert.match(skillConsentHash(DEPLOY), /^[0-9a-f]{64}$/);
  assert.equal(isTeamSkillId(ID(DEPLOY)), true);
  for (const bad of ['skill:library:release-notes', 'plugin:acme/sentry', 'skill:plugin:Acme/x', '', null, 7]) assert.equal(isTeamSkillId(bad), false, String(bad));
});

// A synthetic catalog (the §3.3 entry shape) and snapshot: the rows are pure.
const entry = (e, over = {}) => ({ id: ID(e), source: 'plugin', plugin: e.plugin, name: e.skill, dir: `/x/${e.skill}`, description: `${e.skill} text`,
  whenToUse: null, frontmatter: { allowedTools: null, hooks: false, shell: false, disableModelInvocation: false, pluginRootRefs: false },
  files: 3, bytes: 1200, scripts: ['scripts/a.sh'], shellBlocks: 1, hash: 'h', code: '3f9a1c2', pluginEnabled: true, valid: true, problems: [], ...over });

test('checklist rows: one per entry in policy order, the first state that applies', () => {
  const OFF = { plugin: 'acme', skill: 'off-one' }; const BAD = { plugin: 'acme', skill: 'bad-one' }; const OLD = { plugin: 'acme-old', skill: 'x' };
  const PEND = { plugin: 'acme', skill: 'pending-one' }; const NOSHIP = { plugin: 'acme', skill: 'not-shipped' }; const BADNEW = { plugin: 'acme', skill: 'bad-new' };
  const doc = normalizePolicyDoc(policy([QA, DEPLOY, NOTES, OFF, BAD, OLD, PEND, NOSHIP, BADNEW], { 'plugins.required': { kind: 'soft', value: [{ name: 'acme' }, { name: 'acme-qa' }, { name: 'acme-old' }] } })).doc;
  const snapshot = { teams: { [HOME]: { id: TEAM_ID, slug: 'team-platfor', name: 'Team · acme/platform', members: {}, skills: {
    [ID(NOTES)]: { enabled: true, consent: skillConsentHash(NOTES) },
    [ID(OFF)]: { enabled: false, consent: skillConsentHash(OFF) },
    [ID(BAD)]: { enabled: true, consent: skillConsentHash(BAD) },
    [ID(DEPLOY)]: { enabled: true, consent: 'an-older-formula' },
    [ID(OLD)]: { enabled: true, consent: skillConsentHash(OLD) },
    [ID(PEND)]: { enabled: true, consent: skillConsentHash(PEND), pending: true },
  } } } };
  const catalog = [entry(DEPLOY), entry(NOTES, { code: 'linked', scripts: [], shellBlocks: 0 }), entry(OFF), entry(BAD, { valid: false, problems: ['x'] }), entry(OLD), entry(PEND), entry(BADNEW, { valid: false, problems: ['x'] })];
  const rows = teamSkillRows({ slug: HOME, sha: '8c1d2e0', doc }, { catalog, snapshot, pluginStates: { acme: 'ok', 'acme-qa': 'missing', 'acme-old': 'outdated' } });
  assert.deepEqual(rows.map((r) => [r.name, r.state, r.working]), [
    ['qa-runbook', 'needs-plugin', false],      // the plugin is not installed: its own required row is the action
    ['deploy-checklist', 'never-consented', false],   // a consent that is not this entry's hash counts for nothing
    ['release-notes', 'ok', true],
    ['off-one', 'off', false],
    ['bad-one', 'skipped', false],
    ['x', 'needs-plugin', true],                // below the policy's floor: the plugin row is the action, yet the resolver
                                                // has no floor, so it still mounts (and counts for "Yours")
    ['pending-one', 'off', false],              // an interrupted write is off, as the resolver reads it
    ['not-shipped', 'skipped', false],          // the plugin is ok but ships no skill of that name
    ['bad-new', 'skipped', false],              // invalid and never consented: never offered Turn on (the resolver's order)
  ]);
  const notes = rows[2];
  assert.deepEqual(notes, { home: HOME, sha: '8c1d2e0', setId: TEAM_ID, setName: 'Team · acme/platform', skillId: ID(NOTES), name: 'release-notes',
    plugin: 'acme', state: 'ok', working: true, hash: skillConsentHash(NOTES), problem: null, code: 'linked', files: 3, bytes: 1200, scripts: [],
    shellBlocks: 0, description: 'release-notes text' });
  assert.equal(rows[4].problem, skillSkipReasonText({ setId: TEAM_ID, setName: 'Team · acme/platform', skillId: ID(BAD), name: 'bad-one', reason: 'invalid-skill' }));
  assert.equal(rows[0].code, null, 'no catalog entry: no facts');
  assert.equal(rows[0].problem, null, 'needs-plugin: the plugin row says why');
  assert.equal(rows[7].problem, 'acme does not ship a skill named not-shipped');
  assert.equal(rows[8].problem, skillSkipReasonText({ setId: TEAM_ID, setName: 'Team · acme/platform', skillId: ID(BADNEW), name: 'bad-new', reason: 'invalid-skill' }));
  const none = teamSkillRows({ slug: 'other/home', sha: null, doc }, { catalog, snapshot, pluginStates: { acme: 'ok' } });
  assert.equal(none[1].state, 'never-consented', 'another home\'s Team state never counts');
  assert.match(none[1].setId, /^team-other-home-/, 'a home without a record is named as a write would persist it');
  const offCatalog = catalog.map((c) => (c.plugin === 'acme' ? { ...c, pluginEnabled: false } : c));
  const disabled = teamSkillRows({ slug: HOME, sha: null, doc }, { catalog: offCatalog, snapshot, pluginStates: { acme: 'disabled' } });
  assert.deepEqual([disabled[2].state, disabled[2].working], ['needs-plugin', false], 'a disabled plugin: the plugin row is the action, nothing mounts');
});

test('Turn on: the entry, plugin and hash come from the cached policy; 404/409/400 before anything is written', async () => {
  await linkAcme();
  await assert.rejects(() => teamSkillAction('turn-on', HOME, ID(DEPLOY), { expectHash: skillConsentHash(DEPLOY) }), { status: 404, message: `no project here follows ${HOME}` });
  cache(policy([DEPLOY, NOTES, QA]));
  await assert.rejects(() => teamSkillAction('update', HOME, ID(DEPLOY), { expectHash: skillConsentHash(DEPLOY) }), { status: 400 });
  await assert.rejects(() => teamSkillAction('turn-on', HOME, 'skill:library:release-notes', { expectHash: 'x' }), { status: 400 });
  await assert.rejects(() => teamSkillAction('turn-on', HOME, 'skill:plugin:acme/other', { expectHash: 'x' }), { status: 404, message: `skill:plugin:acme/other is not required by ${HOME}` });
  await assert.rejects(() => teamSkillAction('turn-on', HOME, ID(DEPLOY), { expectHash: skillConsentHash(NOTES) }), { status: 409, message: 'the team definition changed, review it again' });
  await assert.rejects(() => teamSkillAction('turn-on', HOME, ID(QA), { expectHash: skillConsentHash(QA) }), { status: 409, message: `${ID(QA)} is not installed` });
  let threw = null;
  try { sets(); } catch (err) { threw = err; }
  assert.equal(threw?.code, 'ENOENT', 'a refused Turn on writes nothing');
  assert.deepEqual(await teamSkillAction('turn-on', HOME, ID(DEPLOY), { expectHash: skillConsentHash(DEPLOY) }), { setId: TEAM_ID, skillId: ID(DEPLOY) });
  assert.deepEqual(sets().teams[HOME].skills[ID(DEPLOY)], { enabled: true, consent: skillConsentHash(DEPLOY) });
});

test('Turn on an off member: consent stays, the switch goes on', async () => {
  const s = sets();
  s.teams[HOME].skills[ID(DEPLOY)].enabled = false;
  put('sets', s);
  await teamSkillAction('turn-on', HOME, ID(DEPLOY), { expectHash: skillConsentHash(DEPLOY) });
  assert.deepEqual(sets().teams[HOME].skills[ID(DEPLOY)], { enabled: true, consent: skillConsentHash(DEPLOY) });
});

test('consent payload: SKILL.md text, scripts, shell blocks, allowed tools, plugin @ code, the set it joins', async () => {
  const c = await teamSkillConsent(HOME, ID(DEPLOY));
  assert.equal(c.skillMd, DEPLOY_MD);
  assert.deepEqual([c.name, c.plugin, c.code, c.setId, c.setName, c.sha, c.hash], ['deploy-checklist', 'acme', 'linked', TEAM_ID, 'Team · acme/platform', '8c1d2e0', skillConsentHash(DEPLOY)]);
  assert.deepEqual([c.scripts, c.shellBlocks, c.allowedTools, c.files, c.hooks, c.pluginRootRefs], [['scripts/preflight.sh'], 1, 'Read', 2, false, false]);
  await assert.rejects(() => teamSkillConsent(HOME, ID(QA)), { status: 409, message: `${ID(QA)} is not installed` });
  await assert.rejects(() => teamSkillConsent(HOME, 'skill:plugin:acme/other'), { status: 404 });
  await assert.rejects(() => teamSkillConsent('other/home', ID(DEPLOY)), { status: 404 });
  await assert.rejects(() => teamSkillConsent(HOME, 'plugin:acme/sentry'), { status: 400 });
});

test('consent payload: declared hooks are named; a SKILL.md that is not a regular file is never read (P1 readSkillMd rule)', async () => {
  const md = join(scratch, 'acme', 'skills', 'release-notes', 'SKILL.md');   // the linked plugin's live folder
  const text = readFileSync(md, 'utf8');
  try {
    writeFileSync(md, '---\nname: release-notes\ndescription: Draft release notes\nhooks:\n  PreToolUse: []\n---\n# Notes\nRun ${CLAUDE_PLUGIN_ROOT}/bin/notes first.\n');
    const named = await teamSkillConsent(HOME, ID(NOTES));
    assert.deepEqual([named.hooks, named.pluginRootRefs], [true, true], 'U1: the dialog names declared hooks; §4.1: and a reference to its plugin\'s other files');
    if (process.platform !== 'win32') {
      const outside = join(scratch, 'outside-secret.md');
      writeFileSync(outside, '---\nname: release-notes\ndescription: x\n---\nTOP SECRET\n');
      rmSync(md);
      symlinkSync(outside, md);
      const c = await teamSkillConsent(HOME, ID(NOTES));
      assert.deepEqual([c.name, c.skillMd], ['release-notes', ''], 'a link is never followed (nor a FIFO, /dev/zero or a > 1 MB file): the facts show, the text does not');
    }
  } finally {
    rmSync(md, { force: true });
    writeFileSync(md, text);
  }
});

test('a Team action on a present doc forgets the skills it no longer lists — never while an entry was dropped', async () => {
  await teamSkillAction('turn-on', HOME, ID(NOTES), { expectHash: skillConsentHash(NOTES) });
  cache(policy([NOTES, { plugin: 'acme', skill: 'Bad' }]), ['skills.required: acme/Bad: skill "Bad" is not a valid skill name — entry dropped']);
  await teamSkillAction('turn-on', HOME, ID(NOTES), { expectHash: skillConsentHash(NOTES) });
  assert.deepEqual(Object.keys(sets().teams[HOME].skills).sort(), [ID(DEPLOY), ID(NOTES)], 'an incomplete list removes nothing');
  cache(policy([NOTES]));
  await teamSkillAction('turn-on', HOME, ID(NOTES), { expectHash: skillConsentHash(NOTES) });
  assert.deepEqual(Object.keys(sets().teams[HOME].skills), [ID(NOTES)], 'deploy-checklist is no longer required: its Team state goes');
});

test('Forget: unlisted skills while the doc still requires any; the whole record once it requires nothing; 409 on a list it cannot read', async () => {
  put('sets', { ...sets(), teams: { [HOME]: { ...sets().teams[HOME], skills: { ...sets().teams[HOME].skills, [ID(DEPLOY)]: { enabled: true, consent: skillConsentHash(DEPLOY) } } } } });
  cache(policy([NOTES]), ['skills.required: acme/Bad: skill "Bad" is not a valid skill name — entry dropped']);
  await assert.rejects(() => teamForget(HOME), { status: 409, message: `this Worca cannot read every skill the policy of ${HOME} lists — nothing was removed` });
  assert.equal(Object.keys(sets().teams[HOME].skills).length, 2);
  cache(policy([NOTES]));
  await teamForget(HOME);
  assert.deepEqual(Object.keys(sets().teams[HOME].skills), [ID(NOTES)], 'a doc that still requires skills: only the unlisted go');
  cache({ schema: 1, fields: [], workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } }, ['fields: not an object — ignored']);
  await assert.rejects(() => teamForget(HOME), { status: 409 });
  assert.deepEqual(Object.keys(sets().teams[HOME].skills), [ID(NOTES)], 'a fields block this build cannot read removes nothing');
  cache(policy([]));
  await teamForget(HOME);
  assert.equal(sets().teams[HOME], undefined, 'nothing required any more: the record and its state go');
});

test('reconcile persists the Team record of a home that requires only skills (its slug names the plugin skills load under)', async () => {
  const key2 = projectKey(mkdtempSync(join(scratch, 'only-skills-')));
  writeTeamPolicyPrefs(key2, { present: true, hasOrigin: true, docKnown: true, unknownSchema: false, slug: 'acme/only-skills', headSha: 'aa11bb2',
    delegateTo: null, checkedAt: new Date().toISOString(), doc: policy([NOTES]), warnings: [] });
  await reconcileMcpStore();
  const rec = sets().teams['acme/only-skills'];
  assert.match(rec.id, /^team-acme-only-skills-[0-9a-f]{4}$/);
  assert.equal(typeof rec.slug, 'string');
  assert.equal(rec.name, 'Team · acme/only-skills');
  assert.equal(rec.skills, undefined, 'a record, no consent: nothing turns on by itself');
  writeTeamPolicyPrefs(key2, { present: false, docKnown: false, doc: null });
});

// ---- "Yours", the scopes payload and the routes (Task 4) -----------------------------------------
import { appServer } from './helpers/app-server.mjs';
import { skillRequirements, withMcpLocal } from '../src/core/policy/local.mjs';

let srv = null; let base = '';
async function server() {
  if (srv) return base;
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  return base;
}
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });
const enc = encodeURIComponent;
const post = async (p, body) => fetch(`${await server()}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const turnOn = (id, body, prefix = '/api/sets') => post(`${prefix}/teams/${enc(HOME)}/skills/${enc(id)}/turn-on`, body);

test('skillRequirements: every cached home\'s rows; "Yours" lists the Team skills that mount here', async () => {
  cache(policy([DEPLOY, NOTES, QA]));
  assert.deepEqual((await skillRequirements()).map((r) => [r.name, r.state]), [['deploy-checklist', 'never-consented'], ['release-notes', 'never-consented'], ['qa-runbook', 'needs-plugin']]);
  await teamSkillAction('turn-on', HOME, ID(NOTES), { expectHash: skillConsentHash(NOTES) });
  const home = { slug: HOME, sha: '8c1d2e0', doc: normalizePolicyDoc(policy([DEPLOY, NOTES, QA])).doc };
  assert.deepEqual((await withMcpLocal({}, home))['skills.required'], { value: [NOTES], set: true });
  assert.deepEqual(await withMcpLocal({}, { slug: HOME, sha: null, doc: normalizePolicyDoc(policy([])).doc }), {}, 'a home that requires no skill adds nothing');
  assert.deepEqual(await skillRequirements([]), []);
});

test('GET /api/policy/scopes carries skillRequirements next to mcpRequirements', async () => {
  const body = await (await fetch(`${await server()}/api/policy/scopes`)).json();
  assert.deepEqual(body.skillRequirements.map((r) => [r.home, r.skillId, r.state]),
    [[HOME, ID(DEPLOY), 'never-consented'], [HOME, ID(NOTES), 'ok'], [HOME, ID(QA), 'needs-plugin']]);
  assert.ok(Array.isArray(body.mcpRequirements));
});

test('Turn on route: ids, home and expectHash checked first; the body never sets consent; /api/mcp answers too', async () => {
  const hash = skillConsentHash(DEPLOY);
  assert.equal((await post(`/api/sets/teams/${enc('Acme/Platform')}/skills/${enc(ID(DEPLOY))}/turn-on`, { expectHash: hash })).status, 400);
  assert.equal((await turnOn('skill:library:release-notes', { expectHash: hash })).status, 400);
  assert.equal((await turnOn('plugin:acme/sentry', { expectHash: hash })).status, 400);
  assert.equal((await turnOn(ID(DEPLOY), {})).status, 400);
  assert.equal((await turnOn(ID(DEPLOY), { expectHash: 'abc' })).status, 400);
  assert.equal((await turnOn(ID(DEPLOY), { expectHash: hash, consent: 'x' }, '/api/mcp')).status, 400, 'bodies never set consent');
  assert.equal((await turnOn(ID(DEPLOY), { expectHash: hash, consent: 'x' })).status, 400, 'the canonical /api/sets path refuses it too');
  const stale = await turnOn(ID(DEPLOY), { expectHash: 'f'.repeat(64) });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'the team definition changed, review it again');
  assert.equal((await turnOn(ID(QA), { expectHash: skillConsentHash(QA) })).status, 409, 'its plugin is not installed');
  assert.equal(sets().teams[HOME].skills[ID(DEPLOY)], undefined, 'nothing was written');
  const ok = await turnOn(ID(DEPLOY), { expectHash: hash });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.deepEqual(await ok.json(), { ok: true, setId: TEAM_ID, skillId: ID(DEPLOY) });
  assert.deepEqual(sets().teams[HOME].skills[ID(DEPLOY)], { enabled: true, consent: hash });
  assert.equal((await turnOn(ID(NOTES), { expectHash: skillConsentHash(NOTES) }, '/api/mcp')).status, 200, 'the /api/mcp path answers too');
});

test('consent route: the dialog\'s payload from the cached policy and the catalog', async () => {
  const get = async (p) => fetch(`${await server()}${p}`);
  for (const prefix of ['/api/sets', '/api/mcp']) {
    const r = await get(`${prefix}/teams/${enc(HOME)}/skills/${enc(ID(DEPLOY))}/consent`);
    assert.equal(r.status, 200, prefix);
    const c = await r.json();
    assert.deepEqual([c.skillMd, c.hash, c.code, c.scripts], [DEPLOY_MD, skillConsentHash(DEPLOY), 'linked', ['scripts/preflight.sh']]);
  }
  assert.equal((await get(`/api/sets/teams/${enc(HOME)}/skills/${enc('skill:plugin:acme/other')}/consent`)).status, 404);
  assert.equal((await get(`/api/sets/teams/${enc(HOME)}/skills/${enc('skill:library:x')}/consent`)).status, 400);
  assert.equal((await get(`/api/sets/teams/${enc('Acme/Platform')}/skills/${enc(ID(DEPLOY))}/consent`)).status, 400);
});

// ---- the policy page and the New Pipeline notes carry the Team set's skill deviations (Task 4) ----
import { addProject } from '../src/core/projects.mjs';

test('the policy page\'s off-policy card and the New Pipeline notes list the skill deviations (§2b-13); never-consented reads as off', async () => {
  await addProject({ name: 'platform', path: DIR });
  cache(policy([]));
  await teamForget(HOME);   // nothing required: a clean Team set
  cache(policy([DEPLOY, NOTES, QA]));
  await teamSkillAction('turn-on', HOME, ID(NOTES), { expectHash: skillConsentHash(NOTES) });
  const skillDevs = (list) => list.filter((d) => d.code.startsWith('skill-'));
  const card = await (await fetch(`${await server()}/api/policy?scope=project:${KEY}`)).json();
  assert.deepEqual(skillDevs(card.deviations), [
    { code: 'skill-off:acme/deploy-checklist', level: 'warn', text: 'Required skill acme/deploy-checklist is off.' },
    { code: 'skill-missing:acme-qa/qa-runbook', level: 'warn', text: 'Required skill acme-qa/qa-runbook is not installed.' },
  ], 'deploy-checklist is required but never consented here; qa-runbook\'s plugin is not installed; release-notes mounts');
  const q = (optOut) => fetch(`${base}/api/policy/notes?${new URLSearchParams({ scope: `project:${KEY}`, ...(optOut ? { mcpOptOut: optOut } : {}) })}`);
  assert.deepEqual(skillDevs((await (await q()).json()).notes).map((d) => d.code), ['skill-off:acme/deploy-checklist', 'skill-missing:acme-qa/qa-runbook']);
  const opted = skillDevs((await (await q(`${TEAM_ID}|${ID(NOTES)}`)).json()).notes);
  assert.deepEqual(opted.map((d) => d.code), ['skill-off:acme/deploy-checklist', 'skill-opted-out:acme/release-notes', 'skill-missing:acme-qa/qa-runbook'],
    'a run that opts a Team skill out is off-policy for it');
  cache(policy([]));
  assert.deepEqual(skillDevs((await (await fetch(`${base}/api/policy?scope=project:${KEY}`)).json()).deviations), [], 'no skills.required: no skill deviations');
});
