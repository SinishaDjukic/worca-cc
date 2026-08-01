// test/config-guardrails.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { GUARDRAIL_PRESETS, DEFAULT_GUARDRAILS } from '../src/core/guardrails.mjs';

let proj, homeDir, prevHome, cfg;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-guard-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-guard-'));
  cfg = await import('../src/core/config.mjs');
});
after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(proj, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

test('unset project: permissive level, empty effective policy', async () => {
  assert.deepEqual(await cfg.readGuardrails(proj), { ...DEFAULT_GUARDRAILS });
  assert.deepEqual(await cfg.readGuardrailsConfig(proj), {
    level: 'permissive', custom: null, effective: { ...DEFAULT_GUARDRAILS },
  });
});

test('setGuardrails: preset level persists; effective comes from the code table', async () => {
  const r = await cfg.setGuardrails(proj, { level: 'normal' });
  assert.equal(r.level, 'normal');
  assert.equal(r.custom, null);
  assert.deepEqual(r.effective, { ...GUARDRAIL_PRESETS.normal });
  assert.deepEqual(await cfg.readGuardrails(proj), { ...GUARDRAIL_PRESETS.normal });
});

test('setGuardrails: custom level with payload persists and round-trips', async () => {
  const custom = {
    honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'],
    protectedPaths: ['.env*'], deny: ['Bash(curl:*)'],
  };
  const r = await cfg.setGuardrails(proj, { level: 'custom', custom });
  assert.equal(r.level, 'custom');
  assert.deepEqual(r.custom, custom);
  assert.deepEqual(r.effective, custom);
  assert.deepEqual(await cfg.readGuardrails(proj), custom);
});

test('persist-alongside: switching to a preset keeps the custom blob dormant; switching back restores it', async () => {
  const r1 = await cfg.setGuardrails(proj, { level: 'secure' });   // no custom in the payload
  assert.equal(r1.level, 'secure');
  assert.deepEqual(r1.custom.deny, ['Bash(curl:*)'], 'dormant custom survives');
  assert.deepEqual(r1.effective, { ...GUARDRAIL_PRESETS.secure }, 'but does not affect enforcement');
  const r2 = await cfg.setGuardrails(proj, { level: 'custom' });   // no payload: restore stored custom
  assert.deepEqual(r2.effective.deny, ['Bash(curl:*)']);
});

test('setGuardrails: invalid payloads throw and persist nothing', async () => {
  const before_ = await cfg.readGuardrailsConfig(proj);
  await assert.rejects(() => cfg.setGuardrails(proj, { level: 'paranoid' }), /level must be one of/);
  await assert.rejects(
    () => cfg.setGuardrails(proj, { level: 'custom', custom: { deny: ['rm -rf /'] } }),
    /not a valid permission rule/,
  );
  assert.deepEqual(await cfg.readGuardrailsConfig(proj), before_);
});

test('custom level with nothing stored anywhere -> throws', async () => {
  const proj2 = await mkdtemp(join(tmpdir(), 'worca-cc-guard2-'));
  try {
    await assert.rejects(() => cfg.setGuardrails(proj2, { level: 'custom' }), /custom guardrail settings required/);
  } finally {
    await rm(proj2, { recursive: true, force: true });
  }
});

test('setGuardrails preserves sibling extra keys; v1 legacy blob reads as custom', async () => {
  const { prepare, tx } = await import('../src/core/db.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const key = projectKey(proj);
  tx(() => {
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    const extra = JSON.parse(row?.extra || '{}');
    extra.webUiTesting = { enabled: true };
    prepare('UPDATE project_config SET extra = ? WHERE project_key = ?').run(JSON.stringify(extra), key);
  });
  await cfg.setGuardrails(proj, { level: 'normal' });
  const rc = await cfg.readRunConfig(proj);
  assert.deepEqual(rc.webUiTesting, { enabled: true });            // sibling preserved

  // v1-era bare 5-key blob (no level) resolves as custom — lossless upgrade
  tx(() => {
    const row = prepare('SELECT extra FROM project_config WHERE project_key = ?').get(key);
    const extra = JSON.parse(row?.extra || '{}');
    extra.guardrails = { envScrub: true, protectedPaths: ['.env*'], deny: [], envAllowlist: [] };
    prepare('UPDATE project_config SET extra = ? WHERE project_key = ?').run(JSON.stringify(extra), key);
  });
  const legacy = await cfg.readGuardrailsConfig(proj);
  assert.equal(legacy.level, 'custom');
  assert.equal(legacy.effective.envScrub, true);
  assert.deepEqual(legacy.effective.protectedPaths, ['.env*']);
});
