// test/runs-redesign-shots.test.mjs — spec §5 item 8: the runs redesign's changelog entry carries its 32 before/after
// screenshots (tools/runs-redesign-shots.mjs), every one linked from docs/changelog/unreleased.md and committed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { shotPlan, SHOT_DIR } from '../tools/runs-redesign-shots.mjs';

const ROOT = new URL('..', import.meta.url);

test('the shot plan: 4 surfaces × light/dark × 1440/375 × before/after = 32 unique JPEGs', () => {
  const plan = shotPlan();
  assert.equal(plan.length, 32);
  assert.equal(new Set(plan.map((s) => s.file)).size, 32);
  assert.deepEqual([...new Set(plan.map((s) => s.surface))], ['runs', 'run', 'group', 'card']);
  assert.ok(plan.every((s) => s.file.startsWith(`${SHOT_DIR}/`) && s.file.endsWith('.jpg')));
  assert.ok(plan.every((s) => (s.width === 375) === s.mobile));
});

test('unreleased.md has the Runs redesign section and links every shot, and every shot is committed', () => {
  const md = readFileSync(new URL('docs/changelog/unreleased.md', ROOT), 'utf8');
  const sec = md.split(/^## /m).find((s) => s.startsWith('Runs redesign'));
  assert.ok(sec, 'a "## Runs redesign" section');
  for (const s of shotPlan()) {
    assert.ok(sec.includes(s.file.replace(/^docs\/changelog\//, '')), `${s.file} is linked`);
    assert.ok(existsSync(new URL(s.file, ROOT)), `${s.file} is committed`);
  }
});
