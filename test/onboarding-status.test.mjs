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
    { name: 'adding a project ticks "project"; a finished, paid run ticks "run" and "realRun"', run: async () => {
      const proj = join(home, 'proj');
      mkdirSync(proj, { recursive: true });
      await addProject({ name: 'proj', path: proj });
      let s = await onboardingStatus();
      assert.equal(s.steps.project, true);
      assert.equal(s.steps.run, false);

      await seedPipeline(proj, { title: 'free', status: 'done', totalCostUsd: 0 });
      s = await onboardingStatus();
      assert.equal(s.steps.run, false, 'a $0 run is not a real run');
      assert.equal(s.steps.realRun, false, 'no spend yet');

      await seedPipeline(proj, { title: 'real', status: 'done', totalCostUsd: 0.42 });
      s = await onboardingStatus();
      assert.equal(s.steps.run, true, 'a finished run that cost something is a real run');
      assert.equal(s.steps.realRun, true);
    } },
    { name: 'run/realRun ticks ignore demo and $0 runs; deleted runs and the no-project key behave as documented', run: async () => {
      const { getDb } = await import('../src/core/db.mjs');
      const { NO_PROJECT_KEY } = await import('../src/shared/no-project.mjs');
      const db = getDb();
      db.exec('DELETE FROM pipeline_steps; DELETE FROM pipelines');
      const proj = join(home, 'proj');
      for (let i = 0; i < 10; i++) {
        const { id } = await seedPipeline(proj, { title: `demo${i}`, status: 'done', totalCostUsd: 1 });
        db.prepare('UPDATE pipelines SET run_setup = ? WHERE id = ?').run(JSON.stringify({ mock: true }), id);
      }
      await seedPipeline(proj, { title: 'free', status: 'done', totalCostUsd: 0 });
      let s = await onboardingStatus();
      assert.equal(s.steps.run, false, 'demo and $0 runs never tick "run"');
      assert.equal(s.steps.realRun, false, 'nor "realRun"');

      const real = await seedPipeline(proj, { title: 'real', status: 'done', totalCostUsd: 0.3 });
      db.prepare('UPDATE pipelines SET project_key = ? WHERE id = ?').run(NO_PROJECT_KEY, real.id);
      s = await onboardingStatus();
      assert.equal(s.steps.run, true, 'a real run with no project still ticks "run" (install-wide)');
      assert.equal(s.steps.realRun, false, '...but not "realRun", which needs a project');

      db.prepare('UPDATE pipelines SET project_key = ?, deleted_at = ? WHERE id = ?').run(real.key, new Date().toISOString(), real.id);
      s = await onboardingStatus();
      assert.equal(s.steps.run, true, 'deleted runs still count');
      assert.equal(s.steps.realRun, true);
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

test('the claude block carries where the CLI checked (configDirectory) to /api/onboarding', async () => {
  const detect = async () => ({ ready: true, bin: '/usr/local/bin/claude', hint: null, auth: 'signed-out', connected: false, configDirectory: '/tmp/scratch/.claude' });
  const s = await onboardingStatus({ detect, signedIn: async () => ({ signedIn: false, via: [] }) });
  assert.deepEqual(s.claude, { bin: '/usr/local/bin/claude', hint: null, auth: 'signed-out', configDirectory: '/tmp/scratch/.claude' });
  assert.equal(s.steps.claude, false);
});

test('claude step ticks for a non-Claude provider ("Connect a model")', async () => {
  const detect = async () => ({ ready: false, bin: 'claude', hint: null, auth: null, connected: false, configDirectory: null });
  const signedOut = await onboardingStatus({ detect, signedIn: async () => ({ signedIn: false, via: [] }) });
  assert.equal(signedOut.steps.claude, false);
  assert.equal(signedOut.providerSignedIn, false);
  const copilotOnly = await onboardingStatus({ detect, signedIn: async () => ({ signedIn: true, via: ['copilot'] }) });
  assert.equal(copilotOnly.steps.claude, true, 'a Copilot-only install ticks the step');
  assert.equal(copilotOnly.providerSignedIn, true);
});

// ---- stored flags ----

test('onboarding prefs: booleans only, unknown keys refused, all-false drops the key', async () => {
  assert.throws(() => assertOnboardingPrefsInput({ hidden: 'yes' }), /true or false/);
  assert.throws(() => assertOnboardingPrefsInput({ workspaceGuideSeen: 1 }), /onboarding\.workspaceGuideSeen must be true or false/);
  assert.throws(() => assertOnboardingPrefsInput({ nope: true }), /unknown onboarding key/);
  assert.throws(() => assertOnboardingPrefsInput(null), /object/);
  assert.deepEqual(await setOnboardingPrefs({ hidden: true }), { hidden: true, welcomeSeen: false, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} });
  assert.deepEqual(await setOnboardingPrefs({ welcomeSeen: true }), { hidden: true, welcomeSeen: true, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} });
  assert.deepEqual(await setOnboardingPrefs({ hidden: false }), { hidden: false, welcomeSeen: true, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} }, 'Show again keeps the welcome seen');
  assert.deepEqual(await setOnboardingPrefs({ welcomeSeen: false }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} });
  assert.deepEqual(await setOnboardingPrefs({ workspaceGuideSeen: true }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: true, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} }, 'the walkthrough flag alone keeps the key');
  assert.equal((await onboardingStatus()).workspaceGuideSeen, true, 'GET /api/onboarding carries it');
  assert.deepEqual(await setOnboardingPrefs({ workspaceGuideSeen: false }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} });
  assert.deepEqual(onboardingPrefs(), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: false, guidesSeen: {} });
  const s = await onboardingStatus();
  assert.equal(s.hidden, false);
  assert.deepEqual(s.guidesSeen, {}, 'GET /api/onboarding always carries the map');
});

test('onboarding guidesSeen: validated whole-patch, merged (true sets, false deletes), reset composes, empty drops the key', async () => {
  const { settingsFile, isSeenOnlyPatch } = await import('../src/core/settings.mjs');
  const { readFileSync, existsSync } = await import('node:fs');
  const onDisk = () => (existsSync(settingsFile()) ? JSON.parse(readFileSync(settingsFile(), 'utf8')) : {});
  await checkRows([
    { name: 'every new refusal has its own words', run: () => {
      assert.throws(() => assertOnboardingPrefsInput({ guidesSeen: [] }), /onboarding\.guidesSeen must be an object/);
      assert.throws(() => assertOnboardingPrefsInput({ guidesSeen: 'runs' }), /onboarding\.guidesSeen must be an object/);
      assert.throws(() => assertOnboardingPrefsInput({ guidesSeen: null }), /onboarding\.guidesSeen must be an object/);
      assert.throws(() => assertOnboardingPrefsInput({ guidesSeen: { nope: true } }), /unknown how-it-works area "nope"/);
      assert.throws(() => assertOnboardingPrefsInput({ guidesSeen: { runs: 'yes' } }), /onboarding\.guidesSeen\.runs must be true or false/);
      assert.throws(() => assertOnboardingPrefsInput({ guidesReset: 1 }), /onboarding\.guidesReset must be true or false/);
      assert.throws(() => assertOnboardingPrefsInput({ other: true }), /unknown onboarding key "other"/);
      assert.doesNotThrow(() => assertOnboardingPrefsInput({ guidesSeen: { runs: true, chat: false }, guidesReset: false }));
    } },
    { name: 'isSeenOnlyPatch: only guidesSeen / workspaceGuideSeen keys', run: () => {
      assert.equal(isSeenOnlyPatch({ guidesSeen: { runs: true } }), true);
      assert.equal(isSeenOnlyPatch({ workspaceGuideSeen: true }), true);
      assert.equal(isSeenOnlyPatch({ guidesSeen: { runs: true }, workspaceGuideSeen: false }), true);
      assert.equal(isSeenOnlyPatch({ guidesSeen: { runs: true }, hidden: true }), false);
      assert.equal(isSeenOnlyPatch({}), false, 'an empty body keeps today\'s pin');
      assert.equal(isSeenOnlyPatch({ welcomeSeen: true }), false);
      assert.equal(isSeenOnlyPatch({ guidesReset: true }), false);
      assert.equal(isSeenOnlyPatch({ guidesSeen: { runs: true }, guidesReset: true }), false);
    } },
    { name: 'true sets a key, false deletes it, other keys stay', run: async () => {
      let p = await setOnboardingPrefs({ guidesSeen: { runs: true, chat: true } });
      assert.deepEqual(p.guidesSeen, { runs: true, chat: true });
      assert.deepEqual(onDisk().onboarding.guidesSeen, { runs: true, chat: true });
      p = await setOnboardingPrefs({ guidesSeen: { chat: false } });
      assert.deepEqual(p.guidesSeen, { runs: true });
      assert.equal(p.hidden, false, 'booleans untouched');
    } },
    { name: 'a refused patch writes nothing (prefs and file unchanged)', run: async () => {
      const before = onboardingPrefs();
      const fileBefore = readFileSync(settingsFile(), 'utf8');
      await assert.rejects(setOnboardingPrefs({ hidden: true, guidesSeen: { runs: true, nope: true } }), /unknown how-it-works area/);
      assert.deepEqual(onboardingPrefs(), before);
      assert.equal(readFileSync(settingsFile(), 'utf8'), fileBefore);
    } },
    { name: 'the returned prefs are a fresh object (mutating them changes nothing stored)', run: () => {
      const p = onboardingPrefs();
      p.guidesSeen.design = true;
      assert.deepEqual(onboardingPrefs().guidesSeen, { runs: true });
    } },
    { name: 'stored junk is ignored on read (unknown area, non-true value)', run: async () => {
      const { writeFileSync } = await import('node:fs');
      const file = onDisk();
      writeFileSync(settingsFile(), JSON.stringify({ ...file, onboarding: { guidesSeen: { runs: true, bogus: true, chat: 'yes', design: false } } }));
      assert.deepEqual(onboardingPrefs().guidesSeen, { runs: true });
    } },
    { name: 'guidesReset clears the map and workspaceGuideSeen, and composes with the same patch', run: async () => {
      await setOnboardingPrefs({ workspaceGuideSeen: true, hidden: true });
      const p = await setOnboardingPrefs({ guidesReset: true, guidesSeen: { stats: true } });
      assert.deepEqual(p.guidesSeen, { stats: true }, 'the reset runs first, then the patch map');
      assert.equal(p.workspaceGuideSeen, false);
      assert.equal(p.hidden, true, 'other flags stay');
      const q = await setOnboardingPrefs({ guidesReset: true });
      assert.deepEqual(q.guidesSeen, {});
    } },
    { name: 'the onboarding key drops only when every flag is false AND the map is empty', run: async () => {
      await setOnboardingPrefs({ hidden: false, guidesSeen: { runs: true } });
      assert.ok(onDisk().onboarding, 'a map alone keeps the key');
      await setOnboardingPrefs({ guidesSeen: { runs: false } });
      assert.equal('onboarding' in onDisk(), false);
      await setOnboardingPrefs({ hidden: true });
      assert.equal('guidesSeen' in onDisk().onboarding, false, 'an empty map is omitted');
      await setOnboardingPrefs({ hidden: false });
      assert.equal('onboarding' in onDisk(), false);
    } },
  ]);
});

test('#1450: roleDefaultsNoticeSeen is an onboarding flag; an unknown flag is still refused', async () => {
  assert.deepEqual(await setOnboardingPrefs({ roleDefaultsNoticeSeen: true }), { hidden: false, welcomeSeen: false, workspaceGuideSeen: false, setupFinished: false, setupChecked: false, roleDefaultsNoticeSeen: true, guidesSeen: {} });
  assert.equal((await onboardingStatus()).roleDefaultsNoticeSeen, true, 'GET /api/onboarding carries it');
  assert.throws(() => assertOnboardingPrefsInput({ roleDefaultsNoticeSeen: 'yes' }), /true or false/);
  assert.throws(() => assertOnboardingPrefsInput({ roleDefaultsNotice: true }), /unknown onboarding key/);
  await setOnboardingPrefs({ roleDefaultsNoticeSeen: false });
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
    { name: 'seen + none left: the one write also marks the workspaces area as seen (D-5)', run: async () => {
      await setOnboardingPrefs({ workspaceGuideSeen: true });
      assert.equal(await resetWorkspaceGuideIfNoWorkspaces(), true);
      assert.equal(onboardingPrefs().workspaceGuideSeen, false);
      assert.equal(onboardingPrefs().guidesSeen.workspaces, true);
    } },
    { name: 'not seen + none left: nothing to undo, false (no write)', run: async () => {
      assert.equal(await resetWorkspaceGuideIfNoWorkspaces(), false);
      assert.equal(onboardingPrefs().workspaceGuideSeen, false);
    } },
  ]);
});

test('ensureSetupMarker credits a non-fresh install once, leaves a fresh install unfinished, never rewrites', async () => {
  const { ensureSetupMarker } = await import('../src/core/onboarding.mjs');
  const { settingsFile } = await import('../src/core/settings.mjs');
  const { readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const reset = () => rmSync(settingsFile(), { force: true });
  const raw = () => readFileSync(settingsFile(), 'utf8');
  await checkRows([
    { name: 'a non-fresh install is credited once: written, then unchanged', run: async () => {
      reset();
      assert.equal(await ensureSetupMarker({ isFresh: false }), 'written');
      assert.equal(onboardingPrefs().setupFinished, true);
      assert.equal(onboardingPrefs().setupChecked, true);
      assert.equal((await onboardingStatus()).setupFinished, true);
      const before = raw();
      assert.equal(await ensureSetupMarker({ isFresh: false }), 'unchanged');
      assert.equal(raw(), before, 'no second write');
    } },
    { name: 'a fresh install is checked but stays unfinished, and a later non-fresh boot never credits it', run: async () => {
      reset();
      assert.equal(await ensureSetupMarker({ isFresh: true }), 'written');
      assert.equal(onboardingPrefs().setupFinished, false);
      assert.equal(onboardingPrefs().setupChecked, true);
      assert.equal((await onboardingStatus()).setupFinished, false);
      assert.equal(await ensureSetupMarker({ isFresh: false }), 'unchanged');
      assert.equal(onboardingPrefs().setupFinished, false, 'never rewritten after the first check');
    } },
    { name: 'a setup already finished by the user is left alone', run: async () => {
      reset();
      writeFileSync(settingsFile(), JSON.stringify({ onboarding: { setupFinished: true, setupChecked: true } }));
      assert.equal(await ensureSetupMarker({ isFresh: true }), 'unchanged');
      assert.equal(onboardingPrefs().setupFinished, true);
    } },
  ]);
});
