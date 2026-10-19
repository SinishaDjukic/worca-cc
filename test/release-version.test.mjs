// Shaper s4: the release row's version suggestion (src/shared/release-version.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMinor, suggestReleaseVersion, parseReleaseChoice, isReleaseVersion } from '../src/shared/release-version.mjs';

test('the suggestion: last tag + minor, else package.json, else typed', () => {
  for (const [input, want] of [
    [{ lastTag: 'v1.11.0' }, { version: 'v1.12.0', from: 'tag' }],
    [{ lastTag: '1.11.0', packageVersion: '9.0.0' }, { version: '1.12.0', from: 'tag' }],
    [{ lastTag: 'v2.0.0-rc.1' }, { version: 'v2.1.0', from: 'tag' }],
    [{ lastTag: null, packageVersion: '1.4.0' }, { version: 'v1.4.0', from: 'package' }],
    [{ lastTag: 'release-2024', packageVersion: '1.4.0' }, { version: 'v1.4.0', from: 'package' }],
    [{}, { version: null, from: null }],
  ]) assert.deepEqual(suggestReleaseVersion(input), want, JSON.stringify(input));
  assert.equal(nextMinor('v1.11.0'), 'v1.12.0');
  assert.equal(nextMinor('nope'), null);
});

test('a request\'s release choice: absent → null, a version → { version }, anything else → error', () => {
  assert.ok(parseReleaseChoice({ version: 'v1' }).error);
  assert.ok(parseReleaseChoice({ version: 'nope' }).error);
  assert.ok(parseReleaseChoice('v1.12.0').error);
  assert.deepEqual(parseReleaseChoice({ version: ' v1.12.0 ' }), { value: { version: 'v1.12.0' } });
  assert.deepEqual(parseReleaseChoice(undefined), { value: null });
  assert.deepEqual(parseReleaseChoice(null), { value: null });
  assert.equal(isReleaseVersion('v1.12.0-rc.1'), true);
  assert.equal(isReleaseVersion(`v1.0.0-${'a'.repeat(70)}`), false);
});
