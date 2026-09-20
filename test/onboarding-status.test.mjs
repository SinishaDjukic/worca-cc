// test/onboarding-status.test.mjs
// src/core/onboarding.mjs — every Getting-started tick is DERIVED from product
// state (store + PATH), never stored; the two stored flags live in settings.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const home = useTempHome(after);

// settings.json lives under defaultRoot() = HOME (settings.mjs:58), not WORCA_HOME:
// point HOME at the temp dir too, or the flags would read/write the real file.
const REAL_HOME = process.env.HOME;
process.env.HOME = home;
after(() => { process.env.HOME = REAL_HOME; });

const { claudeReady, onboardingStatus, ONBOARDING_STEPS } = await import('../src/core/onboarding.mjs');
const { onboardingPrefs, setOnboardingPrefs, assertOnboardingPrefsInput } = await import('../src/core/settings.mjs');
const { addProject } = await import('../src/core/projects.mjs');
const { createThread } = await import('../src/core/ask/store.mjs');
const { setActiveWorkflow, writeTeamPolicyPrefs } = await import('../src/core/config.mjs');
const { projectKey } = await import('../src/core/store.mjs');

// ---- claudeReady: pure, injectable, never spawns ----

test('claudeReady: a bare name is found on PATH (first hit wins), or not', () => {
  const exists = (p) => p === '/opt/bin/claude';
  assert.deepEqual(claudeReady('claude', { platform: 'linux', pathEnv: '/usr/bin:/opt/bin', exists }),
    { ready: true, bin: '/opt/bin/claude', hint: null });
  assert.deepEqual(claudeReady('claude', { platform: 'darwin', pathEnv: '/usr/bin', exists }),
    { ready: false, bin: 'claude', hint: null });
});

test('claudeReady: an explicit path is checked as-is', () => {
  const exists = (p) => p === '/x/claude';
  assert.equal(claudeReady('/x/claude', { platform: 'linux', pathEnv: '', exists }).ready, true);
  assert.equal(claudeReady('/y/claude', { platform: 'linux', pathEnv: '', exists }).ready, false);
});

test('claudeReady: Windows — the npm .cmd shim with no native binary is NOT ready and carries the preflight hint', () => {
  // preflight joins with the HOST's path.join, so match on the tail, not the exact string.
  const exists = (p) => /claude\.cmd$/.test(p);
  const r = claudeReady('claude', { platform: 'win32', pathEnv: 'C:\\npm', exists });
  assert.equal(r.ready, false);
  assert.match(r.hint || '', /script shim/);
});

test('claudeReady: Windows — a real claude.exe on PATH is ready', () => {
  const exists = (p) => /claude\.exe$/.test(p) && !p.includes('node_modules');
  const r = claudeReady('claude', { platform: 'win32', pathEnv: 'C:\\tools', exists });
  assert.equal(r.ready, true);
  assert.equal(r.hint, null);
});

// ---- onboardingStatus: derived ticks on a fresh store ----

test('a fresh store: nine steps, none done except (maybe) the CLI; flags default false', async () => {
  const s = await onboardingStatus();
  assert.deepEqual(Object.keys(s.steps).sort(), [...ONBOARDING_STEPS].sort());
  assert.equal(s.total, 9);
  for (const id of ONBOARDING_STEPS) if (id !== 'claude') assert.equal(s.steps[id], false, `${id} starts undone`);
  assert.equal(typeof s.steps.claude, 'boolean');
  assert.equal(s.done, s.steps.claude ? 1 : 0);
  assert.equal(s.hidden, false);
  assert.equal(s.welcomeSeen, false);
  assert.equal(typeof s.claude.bin, 'string');
});

test('adding a project ticks "project"; a done pipeline ticks "run"; spend ticks "realRun"', async () => {
  const proj = join(home, 'proj');
  mkdirSync(proj, { recursive: true });
  await addProject({ name: 'proj', path: proj });
  let s = await onboardingStatus();
  assert.equal(s.steps.project, true);
  assert.equal(s.steps.run, false);

  await seedPipeline(proj, { title: 'mock', status: 'done', totalCostUsd: 0 });
  s = await onboardingStatus();
  assert.equal(s.steps.run, true, 'a finished run, free or not, is "end to end"');
  assert.equal(s.steps.realRun, false, 'no spend yet');

  await seedPipeline(proj, { title: 'real', status: 'error', totalCostUsd: 0.42 });
  s = await onboardingStatus();
  assert.equal(s.steps.realRun, true, 'any spend is a real run, whatever its outcome');
});

test('an Ask thread ticks "ask"; a picked workflow (the persisted picker choice) ticks "workflows"', async () => {
  let s = await onboardingStatus();
  assert.equal(s.steps.ask, false);
  assert.equal(s.steps.workflows, false, 'nothing picked yet');
  createThread({ title: 'hello' });
  await setActiveWorkflow(join(home, 'proj'), 'wf_auto');
  s = await onboardingStatus();
  assert.equal(s.steps.ask, true);
  assert.equal(s.steps.workflows, true, 'Auto counts: knowing the picker is the step');
  assert.equal(s.done, 5 + (s.steps.claude ? 1 : 0), 'project, run, realRun, ask, workflows (+ the CLI if on PATH)');
});

test('a project that resolves a team policy from the cached branch reads ticks "teamPolicy" — no discovery', async () => {
  let s = await onboardingStatus();
  assert.equal(s.steps.teamPolicy, false, 'nothing carries a policy yet');
  // What an enable + fetch leaves behind in project_config.extra.teamPolicy: the branch is present,
  // its document read. The folder is not even a git repository — the tick never spawns git.
  writeTeamPolicyPrefs(projectKey(join(home, 'proj')), { slug: 'acme/proj', hasOrigin: true, present: true, docKnown: true, headSha: 'abc1234', checkedAt: new Date().toISOString(), doc: { schema: 1, title: 'Acme', fields: {} } });
  s = await onboardingStatus();
  assert.equal(s.steps.teamPolicy, true);
  assert.equal(s.done, 6 + (s.steps.claude ? 1 : 0));
});

// ---- stored flags ----

test('onboarding prefs: booleans only, unknown keys refused, both-false drops the key', async () => {
  assert.throws(() => assertOnboardingPrefsInput({ hidden: 'yes' }), /true or false/);
  assert.throws(() => assertOnboardingPrefsInput({ nope: true }), /unknown onboarding key/);
  assert.throws(() => assertOnboardingPrefsInput(null), /object/);
  assert.deepEqual(await setOnboardingPrefs({ hidden: true }), { hidden: true, welcomeSeen: false });
  assert.deepEqual(await setOnboardingPrefs({ welcomeSeen: true }), { hidden: true, welcomeSeen: true });
  assert.deepEqual(await setOnboardingPrefs({ hidden: false }), { hidden: false, welcomeSeen: true }, 'Show again keeps the welcome seen');
  assert.deepEqual(await setOnboardingPrefs({ welcomeSeen: false }), { hidden: false, welcomeSeen: false });
  assert.deepEqual(onboardingPrefs(), { hidden: false, welcomeSeen: false });
  const s = await onboardingStatus();
  assert.equal(s.hidden, false);
});
