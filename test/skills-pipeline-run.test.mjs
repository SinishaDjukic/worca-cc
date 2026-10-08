// test/skills-pipeline-run.test.mjs — skills registry design §4.3: the set-skill layer of a pipeline
// run. Mock runs through the real dispatcher with custom runners (they receive the full _execCtx),
// detached and legacy run roots, and sets built through the real store and library APIs under a temp
// WORCA_HOME. `_skillRegistry` / `_skillHostFacts` are the harness seams for crafted resolver
// results and host facts. No claude spawn anywhere (a POSIX stub answers the capability probe).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { skillFolder, skillSetFixture as fixture, spawnRecord, scratchDir as tmp, scratchGitDir as gitDir } from './helpers/skill-sets.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipeline } from '../src/core/artifacts.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { readPolicyState } from '../src/core/policy/state.mjs';
import * as policyEffective from '../src/core/policy/effective.mjs';
import { skillSkipMessage, skillSkipReasonText, skillLayerText } from '../src/core/skills-registry/texts.mjs';
import { WORKSPACE_SCAN_WORKFLOW_ID, MEMORY_DEFRAG_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { renderSkillAudit } from '../src/core/run-context.mjs';

useTempHome(after);   // detached run roots are the default

/** Runners that record, at spawn time, the plugin dirs each dispatch carries and what is on disk there. */
function runners(seen) {
  const record = (ctx) => seen.push(spawnRecord(ctx));
  return {
    producer: async (ctx) => { record(ctx); return { status: 'ok', summary: 'ok' }; },
    verifier: async (ctx) => { record(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
}
const RO = { role: 'planner', prompt: 'p', systemPrompt: '', allowedTools: ['Read'] };
const auditOf = async (orch) => (await readPipeline(orch.projectDir, orch.state.id)).auditMarkdown;

/** A crafted resolver result: `alpha` mounted in Billing (renamed), and five skips. */
function crafted(alphaDir) {
  return {
    mounted: [{ id: 'skill:library:alpha', name: 'alpha', qualifiedName: 'billing-set:alpha', pluginName: 'billing-set', setId: 'billing', setName: 'Billing', setSlug: 'billing', dir: alphaDir, projects: [], description: 'a', plugin: null }],
    plugins: [{ setId: 'billing', setName: 'Billing', pluginName: 'billing-set', renamedPlugin: true, skills: ['alpha'] }],
    skipped: [
      { setId: 'billing', setName: 'Billing', skillId: 'skill:library:gone', name: 'gone', reason: 'missing-skill' },
      { setId: 'billing', setName: 'Billing', skillId: 'skill:library:late', name: 'late', reason: 'cap' },
      { setId: 'billing', setName: 'Billing', skillId: 'skill:library:quiet', name: 'quiet', reason: 'off' },
      { setId: 'billing', setName: 'Billing', skillId: 'skill:library:mine', name: 'mine', reason: 'opted-out' },
      { setId: 'team-acme-platform-9333', setName: 'Team · acme/platform', skillId: 'skill:plugin:acme/deploy-checklist', name: 'deploy-checklist', reason: 'needs-consent' },
    ],
    sets: [{ id: 'billing', name: 'Billing', group: 'set', routes: [], skills: 4, started: 1 }, { id: 'team-acme-platform-9333', name: 'Team · acme/platform', group: 'team', routes: [], skills: 1, started: 0 }],
  };
}
const RENAMED = 'set Billing loads as `billing-set:` here — a Claude Code plugin named billing is installed';

test('a run mounts its target\'s set skills, one plugin per set, before the first spawn; the opt-out holds; run.json, state and the audit say so', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen), mcpOptOut: [`${set.id}|skill:library:release-notes`] });
  assert.equal((await orch.run()).status, 'done');
  const base = join(orch.getState().pipelineDir, 'skills');
  const plugin = join(base, set.slug);
  assert.ok(seen.length >= 2);
  for (const r of seen) {
    assert.deepEqual(r.dirs, [plugin], 'every dispatch carries the set plugin');
    assert.ok(r.present, 'the plugin is on disk when the agent spawns (the CLI ignores a missing --plugin-dir path)');
    assert.deepEqual(r.skills, [['deploy-checklist']], 'the opted-out skill is not copied');
  }
  assert.deepEqual(runOpts(seen[0].ctx, RO).pluginDirs, [plugin]);
  assert.deepEqual(JSON.parse(readFileSync(join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')), { name: set.slug, version: '1.0.0', description: `Worca set ${set.name}` });
  const record = {
    base, plugins: [{ setId: set.id, setName: set.name, pluginName: set.slug, renamedPlugin: false, skills: ['deploy-checklist'] }],
    skipped: [{ setId: set.id, setName: set.name, skillId: 'skill:library:release-notes', name: 'release-notes', qualifiedName: `${set.slug}:release-notes`, reason: 'opted-out', why: skillSkipReasonText({ reason: 'opted-out' }) }],
    layer: { blocked: null, text: null },
  };
  assert.deepEqual((await readRunManifest(orch.getState().pipelineDir)).skillMount, record);
  assert.deepEqual(orch.getState().skillMount, record, 'the run page reads it off the state');
  assert.equal(orch._capsProbe, undefined, 'a mock run never probes claude');
  assert.match(await auditOf(orch), /Context: .*, 1 set skill in 1 plugin \(1 skipped\)\./);
  assert.ok(!(await readRunManifest(orch.getState().pipelineDir)).warnings.some((w) => /release-notes/.test(w)), 'an opt-out is a choice, not a warning');
});

test('a target with no set skill: no layer, no mount, no record, the audit line unchanged', async () => {
  const dir = gitDir('skills-none');
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen) });
  assert.equal((await orch.run()).status, 'done');
  assert.equal(orch.skillLayer, null);
  assert.ok(seen.length && seen.every((r) => r.dirs === undefined && runOpts(r.ctx, RO).pluginDirs === undefined));
  assert.equal(existsSync(join(orch.getState().pipelineDir, 'skills')), false);
  assert.equal('skillMount' in (await readRunManifest(orch.getState().pipelineDir)), false);
  assert.equal('skillMount' in orch.getState(), false);
  assert.doesNotMatch(await auditOf(orch), /set skill/);
});

test('legacy runs get the layer too: the mount needs only the pipeline dir; their own audit line', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  await withEnv({ WORCA_RUN_ROOT: 'legacy' }, async () => {
    const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen) });
    assert.equal((await orch.run()).status, 'done');
    assert.equal(orch.runRoot, null);
    const plugin = join(orch.getState().pipelineDir, 'skills', set.slug);
    assert.ok(seen.length && seen.every((r) => r.present && r.dirs?.[0] === plugin));
    assert.deepEqual(seen[0].skills, [['deploy-checklist', 'release-notes']]);
    assert.match(await auditOf(orch), /Skills: 2 set skills in 1 plugin \(0 skipped\)\./);
  });
});

test('_resolveSkills: workspace scans and memory-defrag runs get none; the input is the run\'s target, Team skills, opt-out and the 24 cap', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-skip'), claude: { mock: true }, mcpOptOut: ['billing|skill:library:alpha'] });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  const calls = [];
  orch._skillRegistry = async (opts) => { calls.push(opts); return { mounted: [], plugins: [], skipped: [], sets: [] }; };
  orch.workflowId = MEMORY_DEFRAG_WORKFLOW_ID;
  assert.equal(await orch._resolveSkills(), null);
  assert.equal(calls.length, 0, 'a memory-defrag run never resolves');
  orch.workflowId = 'wf_default';
  orch.policyRun = { home: 'acme/platform', fields: { 'skills.required': { kind: 'soft', value: [{ plugin: 'acme', skill: 'deploy-checklist' }] } }, deviations: [] };
  assert.equal(await orch._resolveSkills(), null, 'nothing resolved ⇒ no layer');
  const m = orch.members[0];
  assert.deepEqual(calls[0], {
    surface: 'pipeline', targets: [{ kind: 'project', key: m.projectKey, name: m.projectName, rank: 0 }],
    teams: { [m.projectKey]: { home: 'acme/platform', required: [{ plugin: 'acme', skill: 'deploy-checklist' }] } },
    optOut: ['billing|skill:library:alpha'], skillCap: 24,
  });
  // A workspace run: the members bring their own sets (F7); the Team set is the workspace policy's.
  const [a, b] = [gitDir('skills-ws-a'), gitDir('skills-ws-b')];
  const ws = createOrchestrator({
    workspace: { id: 'wks-skills-00000001', key: 'wks-skills-00000001', name: 'shop', projects: [a, b].map((d, i) => ({ projectDir: d, projectKey: `p${i}-0000000${i}`, projectName: `p${i}` })) },
    claude: { mock: true },
  });
  ws.pipeline = { dir: tmp('worca-skills-pipe-') };
  ws.policyRun = { home: 'acme/shop', fields: {}, deviations: [] };
  ws._skillRegistry = async (opts) => { calls.push(opts); return { mounted: [], plugins: [], skipped: [], sets: [] }; };
  ws.workflowId = WORKSPACE_SCAN_WORKFLOW_ID;
  assert.equal(await ws._resolveSkills(), null);
  assert.equal(calls.length, 1, 'a workspace scan never resolves');
  ws.workflowId = 'wf_default';
  await ws._resolveSkills();
  assert.deepEqual(calls[1].targets, [{ kind: 'workspace', id: 'wks-skills-00000001', name: 'shop', members: [{ key: 'p0-00000000', name: 'p0' }, { key: 'p1-00000001', name: 'p1' }], rank: 0 }]);
  assert.deepEqual(calls[1].teams, { 'ws:wks-skills-00000001': null }, 'no skills.required ⇒ no Team input');
});

test('_resolveSkills: one warning per renamed plugin and per problem skip (choices say nothing), kept in run.json once; a reported line is not logged again', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-warn'), claude: { mock: true } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch.runRoot = tmp('worca-skills-rr-');
  const result = crafted(skillFolder('alpha'));
  orch._skillRegistry = async () => result;
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const layer = await orch._resolveSkills();
  const expected = [RENAMED, skillSkipMessage(result.skipped[0]), skillSkipMessage(result.skipped[1])];
  assert.deepEqual(logs.filter((l) => l.level === 'warn').map((l) => l.text), expected);
  assert.deepEqual((await readRunManifest(orch.runRoot)).warnings, expected);
  assert.deepEqual(layer.pluginDirs, [join(orch.pipeline.dir, 'skills', 'billing-set')]);
  assert.ok(existsSync(join(orch.pipeline.dir, 'skills', 'billing-set', 'skills', 'alpha', 'SKILL.md')));
  assert.equal(orch.state.skillMount.plugins[0].renamedPlugin, true);
  logs.length = 0;
  await orch._resolveSkills({ reported: new Set(expected) });
  assert.deepEqual(logs.filter((l) => l.level === 'warn'), [], 'a resumed run does not repeat what it reported');
  assert.deepEqual((await readRunManifest(orch.runRoot)).warnings, expected, 'nor doubles it in run.json');
});

test('_resolveSkills: a resolver or mount fault leaves the run without set skills and says so; an emptied target removes the old mount and record', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-fault'), claude: { mock: true } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch.runRoot = tmp('worca-skills-rr-');
  const base = join(orch.pipeline.dir, 'skills');
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  /** A segment that mounts: a layer, a plugin on disk, a record in state and run.json. */
  const mounts = async () => {
    orch._skillRegistry = async () => crafted(skillFolder('alpha'));
    assert.ok(await orch._resolveSkills());
    assert.ok(existsSync(join(base, 'billing-set')));
    assert.ok((await readRunManifest(orch.runRoot)).skillMount, 'a record the next segment must not keep');
  };
  /** No layer, no mount, no record — in state, or in run.json (History reads its durable copy). */
  const none = async (why) => {
    assert.equal(orch.skillLayer, null, why);
    assert.equal(existsSync(base), false, `${why}: no stale plugin is left for a later spawn`);
    assert.equal('skillMount' in orch.state, false, why);
    assert.equal('skillMount' in (await readRunManifest(orch.runRoot)), false, `${why}: run.json`);
  };
  await mounts();
  orch._skillRegistry = async () => { throw new Error('sets.json is damaged\nmore'); };
  assert.equal(await orch._resolveSkills(), null);
  await none('a resolver fault');
  const damaged = 'skills from sets not loaded: sets.json is damaged';
  assert.ok(logs.some((l) => l.level === 'warn' && l.text === damaged));
  assert.ok((await readRunManifest(orch.runRoot)).warnings.includes(damaged), 'kept with the run\'s warnings');
  const said = logs.length;
  assert.equal(await orch._resolveSkills({ reported: new Set([damaged]) }), null);
  assert.equal(logs.length, said, 'a resumed run does not repeat a fault it reported');
  await mounts();
  orch._skillRegistry = async () => crafted(join(tmp('worca-skill-gone-'), 'alpha'));   // the catalog dir vanished
  assert.equal(await orch._resolveSkills(), null);
  await none('a mount fault');
  const prepare = `skills from sets not loaded: could not prepare ${base}`;
  assert.ok(logs.some((l) => l.level === 'warn' && l.text.startsWith(prepare)));
  assert.ok((await readRunManifest(orch.runRoot)).warnings.some((w) => w.startsWith(prepare)));
  await mounts();
  orch._skillRegistry = async () => ({ mounted: [], plugins: [], skipped: [], sets: [] });   // the sets lost their skills
  assert.equal(await orch._resolveSkills(), null);
  await none('an emptied target');
});

test('_resolveSkills: the host gates apply only when a skill would load', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-gate'), claude: { mock: true } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch._skillRegistry = async () => ({ ...crafted(skillFolder('alpha')), mounted: [], plugins: [] });   // every skill skipped
  orch._skillHostFacts = () => ({ installedPluginNames: [], sideloadDisabled: true });
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const layer = await orch._resolveSkills();
  assert.equal(layer.blocked, null, 'nothing would load: no gate, no "skills from sets not loaded"');
  assert.deepEqual(layer.pluginDirs, []);
  assert.ok(!logs.some((l) => /skills from sets not loaded/.test(l.text)));
  assert.equal(existsSync(join(orch.pipeline.dir, 'skills')), false);
  assert.equal(orch.state.skillMount.skipped.length, 5, 'the skips are still recorded');
});

test('_resolveSkills: a skill that could not be copied leaves the layer and the record and is warned once; the rest loads', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-partial'), claude: { mock: true } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch.runRoot = tmp('worca-skills-rr-');
  const result = crafted(skillFolder('alpha'));
  const beta = { ...result.mounted[0], id: 'skill:library:beta', name: 'beta', qualifiedName: 'billing-set:beta', dir: join(tmp('worca-skill-gone-'), 'beta') };
  result.mounted.push(beta);
  result.plugins[0].skills = ['alpha', 'beta'];
  // A second set whose only skill cannot be copied: its plugin is not written, listed or passed.
  result.mounted.push({ ...result.mounted[0], id: 'skill:library:gamma', name: 'gamma', qualifiedName: 'docs:gamma', pluginName: 'docs', setId: 'docs', setName: 'Docs', setSlug: 'docs', dir: join(tmp('worca-skill-gone-'), 'gamma') });
  result.plugins.push({ setId: 'docs', setName: 'Docs', pluginName: 'docs', renamedPlugin: false, skills: ['gamma'] });
  orch._skillRegistry = async () => result;
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const layer = await orch._resolveSkills();
  assert.deepEqual(layer.mounted.map((m) => m.qualifiedName), ['billing-set:alpha'], 'only what was copied is delivered');
  assert.deepEqual(layer.pluginDirs, [join(orch.pipeline.dir, 'skills', 'billing-set')]);
  assert.deepEqual(orch.state.skillMount.plugins.map((p) => [p.pluginName, p.skills]), [['billing-set', ['alpha']]]);
  const row = orch.state.skillMount.skipped.find((s) => s.name === 'beta');
  assert.deepEqual([row.reason, row.qualifiedName, row.skillId, row.setName], ['mount-failed', 'billing-set:beta', 'skill:library:beta', 'Billing']);
  assert.ok(row.why.length, 'the copy error is its reason');
  const line = `billing-set:beta in Billing not loaded: ${row.why}`;
  assert.equal(logs.filter((l) => l.level === 'warn' && l.text === line).length, 1);
  assert.ok((await readRunManifest(orch.runRoot)).warnings.includes(line));
  assert.ok(orch.state.skillMount.skipped.some((s) => s.qualifiedName === 'docs:gamma' && s.reason === 'mount-failed' && s.setName === 'Docs'));
  assert.equal(renderSkillAudit(layer), '1 set skill in 1 plugin (7 skipped)');
});

test('_resolveSkills: required Team skills that do not reach the run are off-policy — logged and persisted with the policy\'s own codes', async () => {
  const { dir } = await fixture(['deploy-checklist']);
  const fields = { 'skills.required': { kind: 'soft', value: [{ plugin: 'acme', skill: 'deploy-checklist' }] } };
  const result = crafted(skillFolder('alpha'));
  // P5's skillDeviations is the rule; this pins the harness side: its input, the log lines, the persisted codes.
  const expected = [{ code: 'skill-missing:acme/deploy-checklist', level: 'warn', text: 'Required skill acme/deploy-checklist is not installed.' }];
  const calls = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners([]) });
  orch._resolvePolicy = async function () {
    this.policyRun = { home: 'acme/platform', homeDir: dir, sha: 'abc1234', fields, deviations: ['guardrails-minimum'], unattended: true };
    this._policyPersisted = true;
    this._policyWarned = new Set();
  };
  orch._skillRegistry = async () => result;
  orch._skillDeviations = (f, r, describe) => { calls.push({ f, r, why: describe(r.skipped[0]) }); return expected; };
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  assert.equal((await orch.run()).status, 'done');
  assert.equal(calls.length, 1, 'once per assembly');
  assert.equal(calls[0].f, fields, 'the run\'s policy fields');
  assert.equal(calls[0].r, result, 'the resolver result');
  assert.equal(calls[0].why, skillSkipReasonText(result.skipped[0]), 'skips described by P1\'s reason text');
  assert.deepEqual(orch.policyRun.deviations, ['guardrails-minimum', ...expected.map((d) => d.code)]);
  for (const d of expected) assert.ok(logs.some((l) => l.text === `off-policy: ${d.text}`));
  assert.deepEqual(readPolicyState(orch.state.id).deviations, ['guardrails-minimum', ...expected.map((d) => d.code)]);
});

test('_skillDeviations: P5\'s skillDeviations when it is present, none without it', () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-dev'), claude: { mock: true } });
  const fields = { 'skills.required': { kind: 'soft', value: [{ plugin: 'acme', skill: 'deploy-checklist' }] } };
  const result = crafted('/nowhere/alpha');
  const describe = (s) => skillSkipReasonText(s);
  const rule = policyEffective.skillDeviations;
  assert.deepEqual(orch._skillDeviations(fields, result, describe), typeof rule === 'function' ? rule(fields, result, describe) : []);
  assert.deepEqual(orch._skillDeviations({}, result, describe), [], 'no skills.required: nothing');
});

test('_resolveSkills: a deviation rule that throws never stops the run — the layer still loads, the run says so', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-dev-throw'), claude: { mock: true } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch.policyRun = { home: 'acme/platform', fields: {}, deviations: [] };
  orch._skillRegistry = async () => crafted(skillFolder('alpha'));
  orch._skillDeviations = () => { throw new Error('rule broke\nat stack'); };
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  const layer = await orch._resolveSkills();
  assert.deepEqual(layer.pluginDirs, [join(orch.pipeline.dir, 'skills', 'billing-set')]);
  assert.ok(logs.some((l) => l.source === 'policy' && l.level === 'warn' && l.text === 'skill deviations not checked: rule broke'));
  assert.deepEqual(orch.policyRun.deviations, []);
});

test('a host whose managed settings disable sideloading: the layer is skipped with one warning, nothing is mounted, no flag is emitted', async () => {
  const { dir, set } = await fixture();
  const seen = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true }, runners: runners(seen) });
  orch._skillHostFacts = () => ({ installedPluginNames: [], sideloadDisabled: true });
  assert.equal((await orch.run()).status, 'done');
  const pdir = orch.getState().pipelineDir;
  const line = `skills from sets not loaded: ${skillLayerText('sideload-disabled')}`;
  assert.doesNotMatch(skillLayerText('sideload-disabled'), /^skills from sets/, 'the layer text is the reason only: the run writes the prefix once');
  assert.ok(seen.length && seen.every((r) => runOpts(r.ctx, RO).pluginDirs === undefined));
  assert.equal(existsSync(join(pdir, 'skills')), false);
  const m = await readRunManifest(pdir);
  assert.deepEqual(m.skillMount.layer, { blocked: 'sideload-disabled', text: skillLayerText('sideload-disabled') });
  assert.equal(m.skillMount.base, null);
  assert.deepEqual(m.skillMount.plugins.map((p) => [p.pluginName, p.skills]), [[set.slug, ['deploy-checklist', 'release-notes']]], 'what would have loaded');
  assert.equal(m.warnings.filter((w) => w === line).length, 1);
  assert.match(await auditOf(orch), /2 set skills not loaded \(sideload-disabled; 0 skipped\)\./);
});

test('a claude without --plugin-dir: the layer is skipped (`cli-no-plugin-dir`); the CLI is probed once per run', { skip: process.platform === 'win32' && 'POSIX shell stub' }, async () => {
  const stubDir = tmp('worca-skills-cap-');
  const count = join(stubDir, 'calls');
  const bin = join(stubDir, 'claude');
  writeFileSync(bin, `#!/bin/sh\necho "$1" >> "${count}"\necho "2.1.100 (Claude Code)"\n`, { mode: 0o755 });
  const orch = createOrchestrator({ projectDir: gitDir('skills-cap'), claude: { bin } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch.runRoot = tmp('worca-skills-rr-');
  orch._skillRegistry = async () => crafted(skillFolder('alpha'));
  await orch._recordCapabilities();
  const layer = await orch._resolveSkills();
  assert.equal(layer.blocked, 'cli-no-plugin-dir');
  assert.deepEqual(layer.pluginDirs, []);
  assert.equal(existsSync(join(orch.pipeline.dir, 'skills')), false);
  assert.ok((await readRunManifest(orch.runRoot)).warnings.includes(`skills from sets not loaded: ${skillLayerText('cli-no-plugin-dir')}`));
  assert.ok(!(await readRunManifest(orch.runRoot)).warnings.includes(RENAMED), 'a blocked layer loads nothing: no rename to report');
  assert.deepEqual(readFileSync(count, 'utf8').trim().split('\n').sort(), ['--help', '--version'], 'one probe serves both gates');
});
