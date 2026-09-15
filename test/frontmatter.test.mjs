import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, stripFrontmatter, readFrontmatterSync, FRONTMATTER_HEAD_BYTES, FRONTMATTER_RE } from '../src/core/frontmatter.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const file = (name, body) => { const d = mkdtempSync(join(tmpdir(), 'worca-fm-')); dirs.push(d); const p = join(d, name); writeFileSync(p, body); return p; };
const FM = 'name: worca-cc-x\ndescription: Does X for the pipeline. Never asks questions.\ntools: Read, Write, Bash, mcp__plugin_playwright_playwright__browser_click\nmodel: inherit\n';

test('parseFrontmatter reads the four keys, splits tools, keeps unknown keys, and stops at the fence', () => {
  const p = parseFrontmatter(`---\n${FM}color: red\n---\nBODY-MUST-NOT-LEAK\n`);
  assert.equal(p.name, 'worca-cc-x');
  assert.equal(p.description, 'Does X for the pipeline. Never asks questions.');
  assert.deepEqual(p.tools, ['Read', 'Write', 'Bash', 'mcp__plugin_playwright_playwright__browser_click']);
  assert.equal(p.model, 'inherit');
  assert.equal(p.fields.color, 'red');
  assert.ok(!JSON.stringify(p).includes('BODY-MUST-NOT-LEAK'));
});

test('CRLF and a UTF-8 BOM parse; quoted scalars unquote; block scalars degrade to empty', () => {
  const crlf = parseFrontmatter(`---\r\n${FM.replace(/\n/g, '\r\n')}---\r\nbody\r\n`);
  assert.equal(crlf.description, 'Does X for the pipeline. Never asks questions.');
  assert.deepEqual(crlf.tools, ['Read', 'Write', 'Bash', 'mcp__plugin_playwright_playwright__browser_click']);
  const bom = parseFrontmatter(`\uFEFF---\nname: b\ndescription: "Quoted: colons, fine."\n---\n`);
  assert.equal(bom.name, 'b');
  assert.equal(bom.description, 'Quoted: colons, fine.');
  const folded = parseFrontmatter(`---\nname: f\ndescription: >-\n  folded body\n  continues\n---\n`);
  assert.equal(folded.description, '', 'the block-scalar indicator is never stored');
  assert.equal(parseFrontmatter(`---\nname: only\n---\n`).tools.length, 0);
});

test('no fence, an unclosed fence, a fence not at byte 0, or a non-string all yield null', () => {
  assert.equal(parseFrontmatter('# heading\n---\nname: x\n---\n'), null);
  assert.equal(parseFrontmatter('---\nname: x\nno closing fence\n'), null);
  assert.equal(parseFrontmatter(''), null);
  assert.equal(parseFrontmatter(null), null);
  assert.equal(parseFrontmatter(42), null);
});

test('stripFrontmatter returns the body (whole text when there is no fence)', () => {
  assert.equal(stripFrontmatter(`---\n${FM}---\n\n# Body\n`), '\n# Body\n');
  assert.equal(stripFrontmatter('# Body only\n'), '# Body only\n');
  assert.match(FRONTMATTER_RE.source, /uFEFF/, 'the fence regex tolerates a BOM');
});

test('readFrontmatterSync reads the HEAD of the file only and never throws', () => {
  const big = file('big.md', `---\n${FM}---\n${'BODY-MUST-NOT-LEAK '.repeat(2000)}`);
  const p = readFrontmatterSync(big);
  assert.equal(p.name, 'worca-cc-x');
  assert.ok(!JSON.stringify(p).includes('BODY-MUST-NOT-LEAK'));
  // A fence that closes beyond the window is "no frontmatter", not a partial parse.
  const late = file('late.md', `---\nname: late\n${'# filler\n'.repeat(2000)}---\n`);
  assert.equal(readFrontmatterSync(late), null);
  assert.equal(readFrontmatterSync(late, 64 * 1024).name, 'late', 'a wider window finds it');
  assert.equal(FRONTMATTER_HEAD_BYTES, 8192);
  assert.equal(readFrontmatterSync(join(tmpdir(), 'worca-fm-does-not-exist.md')), null);
});
