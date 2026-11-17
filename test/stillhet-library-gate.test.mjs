// test/stillhet-library-gate.test.mjs — new UI code that skips the design system fails here, like the feature flag tests
// (docs/stillhet/gate.md). Old pages are frozen by a ratchet that can only shrink. To fix a failure: call the library
// (docs/stillhet/README.md) instead of writing its markup or its words. After moving a page: node tools/stillhet-library-gate.mjs --update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BASELINE, ROOT, compare, scanText, scanTree } from '../tools/stillhet-library-gate.mjs';

const baseline = () => JSON.parse(readFileSync(BASELINE, 'utf8'));

test('no UI code rebuilds what the library owns beyond the frozen count, and new files rebuild nothing', () => {
  const { grew } = compare(scanTree(), baseline());
  assert.deepEqual(grew, [], `These skip the design system. Use ui/public/design-system/components/ instead:\n${grew.map((g) => `  ${g.file}: ${g.was} → ${g.now}`).join('\n')}`);
});

test('the ratchet only shrinks: a file that moved to the library lowers the baseline in the same change', () => {
  const { shrank } = compare(scanTree(), baseline());
  assert.deepEqual(shrank, [], `Good work; now run: node tools/stillhet-library-gate.mjs --update\n${shrank.map((s) => `  ${s.file}: ${s.was} → ${s.now}`).join('\n')}`);
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

test('a sentence that holds a picker is never a paragraph: the parser would throw its menu out (comp.sentence-block)', () => {
  const dir = join(ROOT, 'ui/public/stillhet');
  const files = readdirSync(dir, { recursive: true }).filter((f) => /\.js$/.test(f) && !/(^|\/)(components|today|graph)\.js$/.test(f));
  const inP = /<p[ >](?:(?!<\/p>).)*(?:sentencePicker|listSentence)\(/;
  assert.deepEqual(files.filter((f) => readFileSync(join(dir, f), 'utf8').split('\n').some((l) => inP.test(l))), []);
});

test('the prototype\'s pages write nothing the library owns: no frozen count for them', () => {
  const dir = join(ROOT, 'ui/public/stillhet');
  const hits = {};
  for (const d of ['runs', 'pulse', 'settings', 'shell', 'chat']) for (const f of readdirSync(join(dir, d))) if (f.endsWith('.js')) { const h = scanText(readFileSync(join(dir, d, f), 'utf8')); if (Object.keys(h).length) hits[`${d}/${f}`] = h; }
  assert.deepEqual(hits, {});
});

// list.one-line: a row is one line; a second line is drawn only where page code names the fact it holds (`keepLine: '…'`).
// The kept lines are frozen by file: a new one fails here until it is decided and written into the fixture, and a removed
// one lowers the fixture in the same change. To fix a failure: put the fact on the row's one line as its value, or in its hint.
const KEPT = join(ROOT, 'test/fixtures/stillhet-kept-lines.json');
const keptLines = (text) => (text.match(/\bkeepLine\s*:\s*(?!['"`]{2})\S/g) || []).length;
function keptTree() {
  const dir = join(ROOT, 'ui/public/stillhet'), out = {};
  for (const f of readdirSync(dir, { recursive: true })) { if (!/\.m?js$/.test(f) || /(^|\/)(components|today|graph)\.js$/.test(f)) continue; const n = keptLines(readFileSync(join(dir, f), 'utf8')); if (n) out[f.split('\\').join('/')] = n; }
  return out;
}

test('list.one-line: no page keeps a second line beyond the ones decided, file by file', () => {
  assert.deepEqual(keptTree(), JSON.parse(readFileSync(KEPT, 'utf8')).files, 'A second line is a decision: name its fact in keepLine and add it to test/fixtures/stillhet-kept-lines.json, or take the line away and lower the count');
});

test('list.one-line: the count sees a kept line and not an empty or passed-through one', () => {
  assert.equal(keptLines("R.listRow({ title: 'a', meta: 'b', keepLine: 'why it needs you' })"), 1);
  assert.equal(keptLines("R.pulseRow({ meta, keepLine: fix ? 'why it needs you' : '' })"), 1);
  assert.equal(keptLines("R.listRow({ title: 'a', meta: 'b', keepLine: '' })"), 0);
  assert.equal(keptLines("R.listRow({ title: 'a', meta: 'b' })"), 0);
});

test('compare: a new file with a hit grows; an old file may not grow; a lower count is reported', () => {
  assert.deepEqual(compare({ 'new.mjs': 1 }, {}).grew, [{ file: 'new.mjs', was: 0, now: 1 }]);
  assert.deepEqual(compare({ 'a.mjs': 3 }, { 'a.mjs': 2 }).grew, [{ file: 'a.mjs', was: 2, now: 3 }]);
  assert.deepEqual(compare({ 'a.mjs': 2 }, { 'a.mjs': 2 }), { grew: [], shrank: [] });
  assert.deepEqual(compare({}, { 'a.mjs': 2 }).shrank, [{ file: 'a.mjs', was: 2, now: 0 }]);
});

test('every Settings sentence reads right for every option: no markup, no 1 runs, no after never (no browser needed)', () => {
  execFileSync(process.execPath, [join(ROOT, 'plans/stillhet/prototype/gates/settings-sentences.mjs')], { stdio: 'pipe' });
});
