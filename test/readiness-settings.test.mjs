// test/readiness-settings.test.mjs — the project-only `readiness.ignore` setting (a list of check ids to skip).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { readinessIgnore, SETTING_CHECKS } from '../src/core/settings.mjs';
import { writeProjectSettings, assertProjectSettingsPatch, resolveSetting, settingEntry } from '../src/core/settings-cascade.mjs';

useTempHome(after);
const dir = mkdtempSync(join(tmpdir(), 'worca-readiness-settings-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const scope = { projectDir: dir };

test('stringArray accepts arrays of strings only', () => {
  assert.equal(SETTING_CHECKS.stringArray([]), true);
  assert.equal(SETTING_CHECKS.stringArray(['a', 'b']), true);
  assert.equal(SETTING_CHECKS.stringArray('a'), false);
  assert.equal(SETTING_CHECKS.stringArray(null), false);
  assert.equal(SETTING_CHECKS.stringArray(['a', 1]), false);
  assert.equal(SETTING_CHECKS.stringArray([{}]), false);
});

test('readinessIgnore is empty by default and without a scope', () => {
  assert.deepEqual(readinessIgnore(scope), []);
  assert.deepEqual(readinessIgnore(null), []);
});

test('readiness.ignore round-trips through the project layer, keeping unknown ids', () => {
  writeProjectSettings(scope, { 'readiness.ignore': ['commands.test', 'future-check-xyz'] });
  assert.deepEqual(readinessIgnore(scope), ['commands.test', 'future-check-xyz']);
  const resolved = resolveSetting('readiness.ignore', scope);
  assert.equal(resolved.source, 'project');
  assert.deepEqual(resolved.value, ['commands.test', 'future-check-xyz']);
  writeProjectSettings(scope, { 'readiness.ignore': null });
  assert.deepEqual(readinessIgnore(scope), []);
  assert.equal(resolveSetting('readiness.ignore', scope).source, 'default');
});

test('readiness.ignore is project-only: no user or team layer', () => {
  const entry = settingEntry('readiness.ignore');
  assert.equal(entry.team, null);
  assert.equal(entry.readUser(), undefined);
  assert.deepEqual(entry.default, []);
});

test('a non-array or non-string element is a 400 and writes nothing', () => {
  for (const bad of ['commands.test', 7, { a: 1 }, ['ok', 3]]) {
    assert.throws(() => assertProjectSettingsPatch({ 'readiness.ignore': bad }), (e) => e.status === 400 && /readiness\.ignore/.test(e.message));
    assert.throws(() => writeProjectSettings(scope, { 'readiness.ignore': bad }), (e) => e.status === 400);
  }
  assert.deepEqual(readinessIgnore(scope), []);
});

test('a workspace scope has no project layer to write', () => {
  assert.throws(() => writeProjectSettings({ workspace: true }, { 'readiness.ignore': [] }), (e) => e.status === 400);
  assert.deepEqual(readinessIgnore({ workspace: true }), []);
});
