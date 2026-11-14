// test/onboarding-status.test.mjs
// src/core/onboarding.mjs — every Getting-started tick is DERIVED from product
// state (store + PATH), never stored; the two stored flags live in settings.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const home = useTempHome(after);

// settings.json lives under defaultRoot() = HOME (settings.mjs:58), not WORCA_HOME:
// point HOME at the temp dir too, or the flags would read/write the real file.
const REAL_HOME = process.env.HOME;
process.env.HOME = home;
after(() => { process.env.HOME = REAL_HOME; });

const { claudeReady, onboardingStatus } = await import('../src/core/onboarding.mjs');
const { onboardingPrefs, setOnboardingPrefs, assertOnboardingPrefsInput } = await import('../src/core/settings.mjs');
const { addProject } = await import('../src/core/projects.mjs');
const { createThread, appendMessage, finishMessage } = await import('../src/core/ask/store.mjs');
const { setActiveWorkflow, writeTeamPolicyPrefs } = await import('../src/core/config.mjs');
const { projectKey } = await import('../src/core/store.mjs');

// ---- claudeReady: pure, injectable, never spawns ----

test('claudeReady (POSIX): a bare name walks PATH (first hit wins); an explicit path is checked as-is', async () => {
  await checkRows([
    { name: 'claudeReady: a bare name is found on PATH (first hit wins), or not', run: () => {
      const exists = (p) => p === '/opt/bin/claude';
      assert.deepEqual(claudeReady('claude', { platform: 'linux', pathEnv: '/usr/bin:/opt/bin', exists }),
        { ready: true, bin: '/opt/bin/claude', hint: null });
      assert.deepEqual(claudeReady('claude', { platform: 'darwin', pathEnv: '/usr/bin', exists }),
        { ready: false, bin: 'claude', hint: null });
    } },
    { name: 'claudeReady: an explicit path is checked as-is', run: () => {
      const exists = (p) => p === '/x/claude';
      assert.equal(claudeReady('/x/claude', { platform: 'linux', pathEnv: '', exists }).ready, true);
      assert.equal(claudeReady('/y/claude', { platform: 'linux', pathEnv: '', exists }).ready, false);
    } },
  ]);
});

test('claudeReady (Windows): a .cmd shim alone is not ready (hint); a real claude.exe is', async () => {
  await checkRows([
    { name: 'claudeReady: Windows — the npm .cmd shim with no native binary is NOT ready and carries the preflight hint', run: () => {
      // preflight joins with the HOST's path.join, so match on the tail, not the exact string.
      const exists = (p) => /claude\.cmd$/.test(p);
      const r = claudeReady('claude', { platform: 'win32', pathEnv: 'C:\\npm', exists });
      assert.equal(r.ready, false);
      assert.match(r.hint || '', /script shim/);
    } },
    { name: 'claudeReady: Windows — a real claude.exe on PATH is ready', run: () => {
      const exists = (p) => /claude\.exe$/.test(p) && !p.includes('node_modules');
      const r = claudeReady('claude', { platform: 'win32', pathEnv: 'C:\\tools', exists });
      assert.equal(r.ready, true);
      assert.equal(r.hint, null);
    } },
    { name: 'claudeReady: Windows — the npm shim with the native claude.exe next to it is ready, at that path', run: () => {
      const exists = (p) => /claude\.cmd$/.test(p) || /claude-code[\\/]bin[\\/]claude\.exe$/.test(p);
      const r = claudeReady('claude', { platform: 'win32', pathEnv: 'C:\\npm', exists, isNativeExe: () => true });
      assert.equal(r.ready, true);
      assert.match(r.bin, /claude\.exe$/);
      assert.equal(r.hint, null);
    } },
    { name: 'claudeReady: Windows — an explicit .cmd path resolves next to itself', run: () => {
      const exists = (p) => /claude\.cmd$/.test(p) || /claude-code[\\/]bin[\\/]claude\.exe$/.test(p);
      const r = claudeReady('C:\\npm\\claude.cmd', { platform: 'win32', pathEnv: '', exists, isNativeExe: () => true });
      assert.equal(r.ready, true);
    } },
  ]);
});

// ---- onboardingStatus: derived ticks on a fresh store ----

test('derived ticks: project, run, realRun, ask, workflows, teamPolicy (one store, sequential)', async () => {
  await checkRows([
    { name: 'adding a project ticks "project"; a done pipeline ticks "run"; spend ticks "realRun"', run: async () => {
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
    } },
    { name: 'an answer in a chat ticks "ask", a failed turn does not; a picked workflow (the persisted picker choice) ticks "workflows"', run: async () => {
      let s = await onboardingStatus();
      assert.equal(s.steps.ask, false);
      assert.equal(s.steps.workflows, false, 'nothing picked yet');
      const thread = createThread({ title: 'hello' });
      const failed = appendMessage(thread.id, { role: 'assistant', status: 'streaming' });
      finishMessage(failed.id, { status: 'error' });
      assert.equal((await onboardingStatus()).steps.ask, false, 'a turn that failed showed nothing');
      const ok = appendMessage(thread.id, { role: 'assistant', status: 'streaming' });
      finishMessage(ok.id, { status: 'done' });
      await setActiveWorkflow(join(home, 'proj'), 'wf_auto');
      s = await onboardingStatus();
      assert.equal(s.steps.ask, true);
      assert.equal(s.steps.workflows, true, 'Auto counts: knowing the picker is the step');
      assert.equal(s.done, 5 + (s.steps.claude ? 1 : 0), 'project, run, realRun, ask, workflows (+ the CLI if on PATH)');
    } },
    { name: 'a project that resolves a team policy from the cached branch reads ticks "teamPolicy" — no discovery', run: async () => {
      let s = await onboardingStatus();
      assert.equal(s.steps.teamPolicy, false, 'nothing carries a policy yet');
      // What an enable + fetch leaves behind in project_config.extra.teamPolicy: the branch is present,
      // its document read. The folder is not even a git repository — the tick never spawns git.
      writeTeamPolicyPrefs(projectKey(join(home, 'proj')), { slug: 'acme/proj', hasOrigin: true, present: true, docKnown: true, headSha: 'abc1234', checkedAt: new Date().toISOString(), doc: { schema: 1, title: 'Acme', fields: {} } });
      s = await onboardingStatus();
      assert.equal(s.steps.teamPolicy, true);
      assert.equal(s.done, 6 + (s.steps.claude ? 1 : 0));
    } },
  ]);
});

// ---- stored flags ----

test('onboarding prefs: booleans only, unknown keys refused, all-false drops the key', async () => {
  assert.throws(() => assertOnboardingPrefsInput({ hidden: 'yes' }), /true or false/);
  assert.throws(() => assertOnboardingPrefsInput({ workspaceGuideSeen: 1 }), /onboarding\.workspaceGuideSeen must be true or false/);
  assert.throws(() => assertOnboardingPrefsInput({ nope: true }), /unknown onboarding key/);
  assert.throws(() => assertOnboardingPrefsInput(null), /object/);
  assert.deepEqual(await setOnboardingPrefs({ hidden: true }), { hidden: true, welcomeSeen: false, workspaceGuideSeen: false, stillhetAsked: false });
  assert.deepEqual(await setOnboardingPrefs({ welcomeSeen: true }), { hidden: true, welcomeSeen: true, workspaceGuideSeen: false, stillhetAsked: false });
  assert.deepEqual(await setOnboardingPrefs({ hidden: false }), { hidden: false, welcomeSeen: true, workspaceGuideSeen: false, stillhetAsked: false }, 'Show again keeps the welcome seen');
  assert.deepEqual(await setOnboardingPrefs({ welcomeSeen: false }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, stillhetAsked: false });
  assert.deepEqual(await setOnboardingPrefs({ workspaceGuideSeen: true, stillhetAsked: false }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: true, stillhetAsked: false }, 'the walkthrough flag alone keeps the key');
  assert.equal((await onboardingStatus()).workspaceGuideSeen, true, 'GET /api/onboarding carries it');
  assert.deepEqual(await setOnboardingPrefs({ workspaceGuideSeen: false, stillhetAsked: false }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, stillhetAsked: false });
  assert.deepEqual(onboardingPrefs(), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, stillhetAsked: false });
  const s = await onboardingStatus();
  assert.equal(s.hidden, false);
});

test('resetWorkspaceGuideIfNoWorkspaces: clears the flag only when it is set AND no workspace is left', async () => {
  const { resetWorkspaceGuideIfNoWorkspaces } = await import('../src/core/onboarding.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const now = new Date().toISOString();
  const seed = (id) => getDb().prepare("INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)").run(id, id, now, now);
  const drop = (id) => getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  await checkRows([
    { name: 'seen + a workspace left: unchanged, false', run: async () => {
      await setOnboardingPrefs({ workspaceGuideSeen: true });
      seed('wks-guide-0000000a');
      assert.equal(await resetWorkspaceGuideIfNoWorkspaces(), false);
      assert.equal(onboardingPrefs().workspaceGuideSeen, true);
      drop('wks-guide-0000000a');
    } },
    { name: 'seen + none left: cleared, true', run: async () => {
      assert.equal(await resetWorkspaceGuideIfNoWorkspaces(), true);
      assert.equal(onboardingPrefs().workspaceGuideSeen, false);
    } },
    { name: 'not seen + none left: nothing to undo, false (no write)', run: async () => {
      assert.equal(await resetWorkspaceGuideIfNoWorkspaces(), false);
      assert.equal(onboardingPrefs().workspaceGuideSeen, false);
    } },
  ]);
});
