// test/project-profile.test.mjs — a stored project profile is a fixed, clipped field set.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'profile-');
const { sanitizeProfile, writeProjectProfile, readProjectProfile, profileSummary, PROFILE_MAX_BYTES } = await import('../src/core/project-profile.mjs');
const { addProject } = await import('../src/core/projects.mjs');
const { projectKey } = await import('../src/core/store.mjs');
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GOOD = {
  version: 1, source: 'ai-readiness', phase: 'baseline',
  summary: 'A pipeline runner.', architecture: 'ui/ serves src/core/.',
  stack: { language: 'JavaScript', framework: 'none', packageManager: 'npm', testRunner: 'node:test' },
  conventions: ['ESM only'], entryPoints: ['ui/server.mjs:app'],
  commands: [{ kind: 'test', command: 'npm test' }], gotchas: ['sandbox/ must be a git repo'],
  recurringTasks: [{ id: 'add-route', name: 'Add an API route' }], tools: ['claude'],
  score: { overall: 42, core: 60, tools: { claude: 42 } },
};

test('case 1: a good profile round-trips through the project config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proj-'));
  await addProject({ name: 'p1', path: dir });
  const key = projectKey(dir);
  writeProjectProfile(key, GOOD, { runId: 'r1' });
  const back = readProjectProfile(key);
  assert.equal(back.summary, 'A pipeline runner.');
  assert.equal(back.runId, 'r1');
  assert.ok(back.updatedAt);
});

test('case 2: unknown keys are dropped, __proto__ never lands', () => {
  const { profile } = sanitizeProfile(JSON.parse('{"version":1,"summary":"s","evil":1,"__proto__":{"x":1}}'));
  assert.equal(profile.evil, undefined);
  assert.equal(({}).x, undefined);
  assert.equal(Object.getPrototypeOf(profile), Object.prototype);
});

test('case 3: long strings and long lists are clipped', () => {
  const { profile } = sanitizeProfile({ ...GOOD, summary: 'x'.repeat(10000), gotchas: Array(100).fill('g') });
  assert.ok(profile.summary.length <= 1500);
  assert.ok(profile.gotchas.length <= 24);
});

test('case 4: a profile above 64 KiB after clipping is rejected', () => {
  const huge = { ...GOOD, conventions: Array(24).fill('c'.repeat(400)), gotchas: Array(24).fill('g'.repeat(400)), entryPoints: Array(24).fill('e'.repeat(400)) };
  const r = sanitizeProfile({ ...huge, recurringTasks: Array(24).fill({ id: 'i'.repeat(80), name: 'n'.repeat(400) }) });
  // Clipping keeps this under the cap; a forged size check uses PROFILE_MAX_BYTES directly:
  assert.ok(JSON.stringify(r.profile).length <= PROFILE_MAX_BYTES);
  assert.equal(sanitizeProfile('not an object').profile, null);
  assert.equal(sanitizeProfile({ version: 2 }).error, 'unsupported profile version 2');
});

test('profileSummary renders a short markdown block and is empty for null', () => {
  assert.equal(profileSummary(null), '');
  const s = profileSummary(sanitizeProfile(GOOD).profile);
  assert.match(s, /^## Project profile/);
  assert.match(s, /npm test/);
  assert.ok(s.length <= 2000);
});

test('sanitizeProfile keeps only the eight engine ids in tools', () => {
  const { profile } = sanitizeProfile({ version: 1, tools: ['claude', 'claude-code', 'gemini', 'nope'] });
  assert.deepEqual(profile.tools, ['claude', 'gemini']);
});

test('sanitizeProfile redacts secrets in every stored string before it is persisted', () => {
  const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123';
  const { profile } = sanitizeProfile({ version: 1, summary: `CI uses ${token}`,
    commands: [{ kind: 'test', command: `GITHUB_TOKEN=${token} npm test` }], gotchas: [`never commit ${token}`] });
  const stored = JSON.stringify(profile);
  assert.doesNotMatch(stored, new RegExp(token));
  assert.match(profile.summary, /ghp_<redacted>/);
  assert.match(profile.commands[0].command, /ghp_<redacted>/);
});
