// test/api-skills-pipeline.test.mjs — skills registry design §4.3, §4.5, §7: POST /api/mcp/preview's
// `skills` block and set counts, and the skill keys of `mcpOptOut` (validated by the widened
// membership grammar, unknown ones dropped, the rest reaching the run). App imported (no port bind),
// real fetch, WORCA_MOCK=1, temp WORCA_HOME, sets and library skills through the real APIs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { skillSetFixture, addSkills, scratchDir, scratchGitDir as gitDir } from './helpers/skill-sets.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addManualServer, putMember } from '../src/core/mcp/store.mjs';
import { skillSkipMessage, skillSkipReasonText, skillLayerText } from '../src/core/skills-registry/texts.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import * as policyEffective from '../src/core/policy/effective.mjs';

useTempHome(after);
let srv, base, runs, dir, key, set;
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

before(async () => {
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = gitDir('skills-api');
  await addProject({ name: 'skills-api', path: dir });
  key = projectKey(dir);
  ({ set } = await skillSetFixture(['deploy-checklist', 'release-notes'], { dir }));
  const docs = await addManualServer('docs', { type: 'http', url: 'https://docs.example.com/mcp', fields: [], description: 'Docs' });
  await putMember(set.id, 'manual:docs', { enabled: true, values: {} }, { def: docs });
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  await rm(dir, { recursive: true, force: true });
});

test('POST /api/mcp/preview: the set skills a run would mount beside its servers; the opt-out skips one; sets count both', async () => {
  const body = await (await post('/api/mcp/preview', { target: { projectKey: key } })).json();
  assert.deepEqual(body.copies.map((c) => c.name), [`docs_${set.slug}`], 'the servers\' answer is unchanged');
  assert.deepEqual(body.skills.mounted.map((m) => [m.qualifiedName, m.setId]), [[`${set.slug}:deploy-checklist`, set.id], [`${set.slug}:release-notes`, set.id]]);
  assert.deepEqual(body.skills.plugins.map((p) => [p.pluginName, p.skills]), [[set.slug, ['deploy-checklist', 'release-notes']]]);
  assert.ok(body.skills.mounted.every((m) => !('dir' in m)), 'no host path reaches the browser');
  assert.equal(body.skills.started, 2);
  assert.deepEqual(body.skills.layer, { blocked: null, text: null });
  assert.equal(body.skills.newer, false);
  assert.deepEqual(body.sets.map((s) => [s.id, s.skills, s.startedSkills]), [[set.id, 2, 2]]);

  const opted = await (await post('/api/mcp/preview', { target: { projectKey: key }, mcpOptOut: [`${set.id}|skill:library:release-notes`] })).json();
  assert.equal(opted.skills.started, 1);
  const skip = opted.skills.skipped.find((s) => s.skillId === 'skill:library:release-notes');
  assert.equal(skip.reason, 'opted-out');
  assert.deepEqual([skip.message, skip.why], [skillSkipMessage(skip), skillSkipReasonText(skip)]);
  assert.deepEqual(opted.sets.map((s) => s.startedSkills), [1]);
  assert.equal(opted.started, 1, 'a skill key opts no server out');
});

test('POST /api/mcp/preview: a target whose sets hold no skill answers an empty skills block; a skill-only set still lists', async () => {
  const other = gitDir('skills-api-none');
  await addProject({ name: 'skills-api-none', path: other });
  const none = await (await post('/api/mcp/preview', { target: { projectKey: projectKey(other) } })).json();
  assert.deepEqual([none.skills.mounted, none.skills.skipped, none.skills.started], [[], [], 0]);
  const { set: only } = await skillSetFixture(['deploy-checklist'], { dir: other });
  const body = await (await post('/api/mcp/preview', { target: { projectKey: projectKey(other) } })).json();
  assert.deepEqual(body.copies, []);
  assert.deepEqual(body.sets.map((s) => [s.id, s.skills, s.startedSkills]), [[only.id, 1, 1]], 'the popover groups skill rows under it');
  await rm(other, { recursive: true, force: true });
});

test('POST /api/mcp/preview: a workspace target unions its members\' set skills, each with the projects that bring it', async () => {
  const other = gitDir('skills-api-ws');
  const ws = await createWorkspace({ name: 'skills preview', projectPaths: [dir, other] });
  const body = await (await post('/api/mcp/preview', { target: { workspaceId: ws.id } })).json();
  assert.deepEqual(body.skills.mounted.map((m) => [m.name, m.projects]), [['deploy-checklist', [key]], ['release-notes', [key]]]);
  await rm(other, { recursive: true, force: true });
});

// P5 adds the `skills.required` policy field (normalizePolicyDoc drops it as unknown before) and skillDeviations:
// until it lands no cached policy can require a skill, so this test has nothing to observe.
const P5 = typeof policyEffective.skillDeviations === 'function';
test('POST /api/mcp/preview: the Team set\'s required skills come from the cached policy — a missing one is an off-policy deviation', { skip: !P5 && 'needs P5 (skills.required field, skillDeviations)' }, async () => {
  const other = gitDir('skills-api-team');
  await addProject({ name: 'skills-api-team', path: other });
  const k = projectKey(other);
  const fields = {
    'plugins.required': { kind: 'soft', value: [{ name: 'acme', marketplace: 'acme' }] },
    'skills.required': { kind: 'soft', value: [{ plugin: 'acme', skill: 'deploy-checklist' }] },
  };
  // What a policy fetch leaves in project_config.extra.teamPolicy (no git, no network).
  writeTeamPolicyPrefs(k, { slug: 'acme/team', hasOrigin: true, present: true, docKnown: true, headSha: 'abc1234', checkedAt: new Date().toISOString(), doc: { schema: 1, title: 'Acme', fields } });
  const body = await (await post('/api/mcp/preview', { target: { projectKey: k } })).json();
  assert.ok(body.deviations.some((d) => d.code === 'skill-missing:acme/deploy-checklist'), JSON.stringify(body.deviations));
  await rm(other, { recursive: true, force: true });
});

test('POST /api/mcp/preview: managed settings that disable sideloading block the layer — what would load stays listed, none starts', async () => {
  const file = join(scratchDir('worca-managed-'), 'managed-settings.json');
  writeFileSync(file, JSON.stringify({ disableSideloadFlags: true }));
  const prev = process.env.WORCA_CLAUDE_MANAGED_SETTINGS;
  process.env.WORCA_CLAUDE_MANAGED_SETTINGS = file;
  try {
    const body = await (await post('/api/mcp/preview', { target: { projectKey: key } })).json();
    assert.deepEqual(body.skills.layer, { blocked: 'sideload-disabled', text: skillLayerText('sideload-disabled') });
    assert.equal(body.skills.started, 0);
    assert.equal(body.skills.mounted.length, 2, 'the label reads "0 of 2 skills"');
    assert.deepEqual(body.sets.map((s) => [s.skills, s.startedSkills]), [[2, 0]]);
  } finally {
    if (prev === undefined) delete process.env.WORCA_CLAUDE_MANAGED_SETTINGS; else process.env.WORCA_CLAUDE_MANAGED_SETTINGS = prev;
  }
});

test('POST /api/mcp/preview on another engine: each set skill shows the name .agents/skills would give it; Claude keeps <plugin>:<skill>', async () => {
  const own = join(dir, '.claude', 'skills', 'deploy-checklist');
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'SKILL.md'), '---\nname: deploy-checklist\ndescription: the project\'s own\n---\n');
  try {
    const codex = await (await post('/api/mcp/preview', { target: { projectKey: key }, engine: 'codex' })).json();
    const names = Object.fromEntries(codex.skills.mounted.map((m) => [m.name, m.agentName]));
    assert.deepEqual(names, { 'deploy-checklist': `${set.slug}-deploy-checklist`, 'release-notes': 'release-notes' }, 'renamed only on a clash');
    assert.deepEqual(codex.skills.layer, { blocked: null, text: null });
    const claude = await (await post('/api/mcp/preview', { target: { projectKey: key }, engine: 'claude' })).json();
    assert.ok(claude.skills.mounted.every((m) => !('agentName' in m)), 'Claude agents call <plugin>:<skill>');
    const bad = await post('/api/mcp/preview', { target: { projectKey: key }, engine: 'gemini' });
    assert.equal(bad.status, 400);
  } finally {
    await rm(join(dir, '.claude'), { recursive: true, force: true });
  }
});

test('POST /api/run: skill keys in mcpOptOut pass validation; unknown ones are dropped; the rest reaches the run', async () => {
  await addSkills(set.id, ['incident-triage']);
  await addSkills(set.id, ['quiet-hours'], { enabled: false });   // a skipped membership is known too
  const bad = await post('/api/mcp/preview', { target: { projectKey: key }, mcpOptOut: [`${set.id}|skill:library:Bad_Name`] });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /mcpOptOut must be at most 100 "<setId>\|<serverId>" or "<setId>\|<skillId>" entries/);
  const r = await post('/api/run', { projectDir: dir, prompt: 'x', mock: true, mcpOptOut: [`${set.id}|skill:library:incident-triage`, `${set.id}|skill:library:ghost`, `gone|skill:library:release-notes`, `${set.id}|manual:docs`, `${set.id}|skill:library:quiet-hours`] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(runs.get((await r.json()).runId).orch.mcpOptOut, [`${set.id}|skill:library:incident-triage`, `${set.id}|manual:docs`, `${set.id}|skill:library:quiet-hours`]);
});
