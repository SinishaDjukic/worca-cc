// test/export-slug.test.mjs
// The export modal's slug preview (ui/public/export-slug.mjs) reproduces the core's
// slug resolution in the browser, where src/core/skills.mjs (pulls node:fs) can't be
// imported. Guard the browser copy against drifting from isValidSkillName — the core's
// assertName rejects on Apply exactly what this must report invalid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSlugPreview, slugifyLocal } from '../ui/public/export-slug.mjs';
import { isValidSkillName } from '../src/core/skills.mjs';

test('an explicit slug is used verbatim; validity matches isValidSkillName', () => {
  for (const raw of ['ok-slug', 'Good_1.2', 'has space', 'bad/slug', '..', '.', 'a'.repeat(60), 'дефолт']) {
    const { slug, preview, valid } = exportSlugPreview(raw, 'Ignored Name');
    assert.equal(slug, raw.trim());
    assert.equal(preview, `/${raw.trim()}`);
    assert.equal(valid, isValidSkillName(raw.trim()), `drift for explicit slug ${JSON.stringify(raw)}`);
  }
});

test('no explicit slug → slugified workflow name, capped at 48, always valid', () => {
  const { slug, valid } = exportSlugPreview('', 'Fix: login bug #123');
  assert.equal(slug, 'fix-login-bug-123');
  assert.equal(valid, true);
  assert.equal(isValidSkillName(slug), true);
  // Capped at 48 characters.
  const long = exportSlugPreview('', 'x'.repeat(80));
  assert.equal(long.slug.length, 48);
  assert.equal(isValidSkillName(long.slug), true);
  // A name with no slug-able characters falls back to slugifyLocal's 'untitled' default.
  assert.equal(slugifyLocal('!!!'), 'untitled');
  assert.equal(exportSlugPreview('', '!!!').slug, 'untitled');
  assert.equal(isValidSkillName(exportSlugPreview('', '!!!').slug), true);
});
