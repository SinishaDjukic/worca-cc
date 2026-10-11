// test/night-cascade.test.mjs — Away mode on the shared resolver (plans/cascading-settings-design.md D6, §4.4):
// effectiveNightConfig and nightLayers answer exactly what the per-field resolver answered before.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { effectiveNightConfig, nightLayers, effectiveNightConfigLocalOnly } from '../src/core/night/effective.mjs';
import { nightRawLayers } from '../src/core/settings-cascade.mjs';
import { resolveNightConfig, teamNightLayer } from '../src/core/night/config.mjs';
import { nightModeSettings } from '../src/core/settings.mjs';
import { writeTeamPolicyPrefs, readNightModePrefs } from '../src/core/config.mjs';
import { teamDefault } from '../src/core/policy/cache.mjs';
import { getDb, prepare } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const home = mkdtempSync(join(tmpdir(), 'worca-night-cascade-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
const dir = mkdtempSync(join(tmpdir(), 'worca-night-cascade-proj-'));
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true });
});

/** What night/effective.mjs computed before the rewrite — the reference the new code must match. */
const reference = (projectDir) => resolveNightConfig({
  project: projectDir ? readNightModePrefs(projectKey(projectDir)) : null,
  user: nightModeSettings(),
  team: projectDir ? teamNightLayer((k) => teamDefault(projectDir, k)) : {},
});

test('identical output across project, user, team and default, invalid values included', () => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({
    nightMode: { window: '22:00-07:00', timeZone: 'UTC', strategy: 'analysis', minMargin: 'wide', spendCapUsd: 4 },
  }));
  getDb();
  // A hand-edited project layer: one valid field, one out of range, one a project may not set.
  prepare(`INSERT INTO project_config (project_key, steps, custom_models, active_workflow_id, extra) VALUES (?, '{}', '[]', NULL, ?)
    ON CONFLICT(project_key) DO UPDATE SET extra = excluded.extra`)
    .run(projectKey(dir), JSON.stringify({ nightMode: { strategy: 'weights', minConfidence: 500, spendCapUsd: 3, graceMinutes: 45 } }));
  writeTeamPolicyPrefs(projectKey(dir), {
    present: true, docKnown: true, slug: 'acme/night', headSha: 'abc1234', delegateTo: null,
    doc: { schema: 1, fields: { 'night.maxDecisions': { kind: 'default', value: 7 }, 'night.criteria': { kind: 'default', value: { cost: 5 } }, 'night.strategy': { kind: 'default', value: 'mixed' } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } },
  });
  const ref = reference(dir);
  assert.equal(ref.sources.strategy, 'project');
  assert.equal(ref.sources.maxDecisions, 'team');
  assert.deepEqual(effectiveNightConfig(dir), ref);
  assert.deepEqual(effectiveNightConfig(null), reference(null));
  assert.deepEqual(effectiveNightConfig(undefined), reference(null));
  assert.deepEqual(nightLayers(dir), {
    project: readNightModePrefs(projectKey(dir)), user: nightModeSettings(), team: teamNightLayer((k) => teamDefault(dir, k)),
  });
  assert.deepEqual(nightLayers(null), { project: null, user: nightModeSettings(), team: {} });
  assert.deepEqual(nightRawLayers(dir), nightLayers(dir), 'one reader for both');
  assert.deepEqual(effectiveNightConfigLocalOnly(dir), resolveNightConfig({ project: readNightModePrefs(projectKey(dir)), user: nightModeSettings() }));
});
