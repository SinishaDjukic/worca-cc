import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { sections, splitCss, chunk } from '../tools/split-by-feature/css.mjs';
import { loadMap } from '../tools/split-by-feature/plan.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

test('a marker inside a rule body is not a section', () => {
  assert.deepEqual(sections('/* ---------- A ---------- */\n.a{\n/* ---------- B ---------- */\n}\n').map((s) => s.title), ['A']);
});
test('banner box titles come from the next line', () => {
  assert.deepEqual(sections('/* ==========================\n   Workspaces\n   ========================== */\n.w{}\n').map((s) => s.title), ['Workspaces']);
});
test('chunk cuts only at depth-0 blank lines and keeps every byte', () => {
  const css = Array.from({ length: 30 }, (_, i) => `.r${i}{\n  a: b;\n}\n`).join('\n');
  const parts = chunk(css, 20);
  assert.equal(parts.map((p) => p.text).join(''), css);
  assert.ok(parts.length > 1 && parts.every((p) => p.text.split('\n').length <= 21));
  assert.ok(parts.every((p) => css.startsWith(p.text, p.offset)));
});
test('real style.css: parts concatenate to the original, every part is ≤ 1,000 lines, no problem', () => {
  const css = readStyleCss();
  const { parts, problems } = splitCss(css, loadMap(ROOT));
  assert.deepEqual(problems, []);
  assert.equal(parts.map((p) => p.text).join(''), css);
  for (const p of parts) assert.ok(p.text.split('\n').length - 1 <= 1000, `${p.file} over the cap`);
  assert.equal(new Set(parts.map((p) => p.file)).size, parts.length);
});
