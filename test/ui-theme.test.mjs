import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'), 'utf8');
const tokenValue = (name) => { const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`)); return m ? m[1].trim().toLowerCase() : null; };

test('refined palette: warm off-white canvas + white panels', () => {
  assert.equal(tokenValue('bg'), '#f1f1ef');
  assert.equal(tokenValue('panel'), '#ffffff');
  assert.equal(tokenValue('ink'), '#19191b');
});

test('refined palette: status families present', () => {
  for (const [t, v] of Object.entries({
    'green':'#5bae5b','peach':'#efa63c','red':'#e76a5a','blue':'#5ba6cc','violet':'#8c7fd6','amber':'#e6962a',
  })) assert.equal(tokenValue(t), v, `--${t}`);
  for (const fam of ['green','peach','red','blue','violet','amber']) {
    assert.ok(tokenValue(`${fam}-bg`), `--${fam}-bg missing`);
    assert.ok(tokenValue(`${fam}-ink`), `--${fam}-ink missing`);
  }
});

test('refined shape tokens', () => {
  assert.equal(tokenValue('r-card'), '24px');
  assert.equal(tokenValue('r-ctrl'), '14px');
});

test('self-hosted webfonts declared', () => {
  assert.match(css, /@font-face[\s\S]*Poppins[\s\S]*\.woff2/i);
  assert.match(css, /@font-face[\s\S]*JetBrains Mono[\s\S]*\.woff2/i);
});

test('old dark/blue theme fully removed', () => {
  for (const dead of ['#0e1116','#0a0d12','#232c38','#4f9cf9']) assert.ok(!css.includes(dead), `stale color ${dead} still present`);
});

test('log surface styled', () => {
  assert.match(css, /\.log\s*\{[^}]*background:/);
});

test('pipeline config: .acc swatch covers all six registry colors', () => {
  for (const fam of ['green', 'peach', 'red', 'blue', 'violet', 'amber']) {
    assert.match(
      css,
      new RegExp(`\\.acc\\.${fam}\\s*\\{[^}]*background:\\s*var\\(--${fam}\\)`),
      `.acc.${fam} swatch rule missing — agents colored "${fam}" render a blank pill`,
    );
  }
});
