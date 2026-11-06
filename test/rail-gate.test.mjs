// test/rail-gate.test.mjs — new UI code that skips the design system fails here, like the feature flag tests
// (docs/rail/gate.md). Old pages are frozen by a ratchet that can only shrink. To fix a failure: call the library
// (docs/rail/README.md) instead of writing its markup or its words. After moving a page: node tools/rail-gate.mjs --update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BASELINE, ROOT, compare, scanText, scanTree } from '../tools/rail-gate.mjs';

const baseline = () => JSON.parse(readFileSync(BASELINE, 'utf8'));

test('no UI code rebuilds what the library owns beyond the frozen count, and new files rebuild nothing', () => {
  const { grew } = compare(scanTree(), baseline());
  assert.deepEqual(grew, [], `These skip the design system. Use ui/public/design-system/components/ instead:\n${grew.map((g) => `  ${g.file}: ${g.was} → ${g.now}`).join('\n')}`);
});

test('the ratchet only shrinks: a file that moved to the library lowers the baseline in the same change', () => {
  const { shrank } = compare(scanTree(), baseline());
  assert.deepEqual(shrank, [], `Good work; now run: node tools/rail-gate.mjs --update\n${shrank.map((s) => `  ${s.file}: ${s.was} → ${s.now}`).join('\n')}`);
});

test('the gate catches each thing by hand, and passes a page that calls the library', () => {
  assert.deepEqual(scanText('`<button class="btn btn-sm">Go</button>`'), { Button: 1 });
  assert.deepEqual(scanText("const b = document.createElement('button'); b.className = 'menu-item';"), { Button: 1, CompactMenu: 1 });
  assert.deepEqual(scanText("el.classList.add('status-dot');"), { StatusLine: 1 });
  assert.deepEqual(scanText('`<div class="list-row"></div><span class="status-dot is-amber"></span>`'), { Row: 1, StatusLine: 1 });
  assert.deepEqual(scanText('`<input type="checkbox">`'), { Checkbox: 1 });
  assert.deepEqual(scanText("const word = 'Needs you';"), { States: 1 });
  assert.deepEqual(scanText('`Could not merge. Nothing changed.`'), { 'Step flow': 1 });
  assert.deepEqual(scanText('`<svg width="14" viewBox="0 0 24 24"></svg>`'), { 'Inline icon': 1 });
  assert.deepEqual(scanText("import { button, runState } from './design-system/components/index.mjs'; el.innerHTML = button({ label: 'Go' }) + runState(id).word;"), {});
});

test('the prototype\'s pages write nothing the library owns: no frozen count for them', () => {
  const dir = join(ROOT, 'plans/rail/prototype');
  const hits = {};
  for (const d of ['runs', 'pulse', 'settings', 'shell', 'chat']) for (const f of readdirSync(join(dir, d))) if (f.endsWith('.js')) { const h = scanText(readFileSync(join(dir, d, f), 'utf8')); if (Object.keys(h).length) hits[`${d}/${f}`] = h; }
  assert.deepEqual(hits, {});
});

test('compare: a new file with a hit grows; an old file may not grow; a lower count is reported', () => {
  assert.deepEqual(compare({ 'new.mjs': 1 }, {}).grew, [{ file: 'new.mjs', was: 0, now: 1 }]);
  assert.deepEqual(compare({ 'a.mjs': 3 }, { 'a.mjs': 2 }).grew, [{ file: 'a.mjs', was: 2, now: 3 }]);
  assert.deepEqual(compare({ 'a.mjs': 2 }, { 'a.mjs': 2 }), { grew: [], shrank: [] });
  assert.deepEqual(compare({}, { 'a.mjs': 2 }).shrank, [{ file: 'a.mjs', was: 2, now: 0 }]);
});

test('every Settings sentence reads right for every option: no markup, no 1 runs, no after never (no browser needed)', () => {
  execFileSync(process.execPath, [join(ROOT, 'plans/rail/prototype/gates/settings-sentences.mjs')], { stdio: 'pipe' });
});
