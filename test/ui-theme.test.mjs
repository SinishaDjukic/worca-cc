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

test('running-redesign tokens: the four genuinely new literals', () => {
  assert.equal(tokenValue('amber-wash'), '#fef7ec');
  assert.equal(tokenValue('amber-wash-2'), '#fefaf3');
  assert.equal(tokenValue('amber-line'), '#f5d9a8');
  assert.equal(tokenValue('radio-ring'), '#d6d6d2');
});

test('the running redesign spends tokens, not raw hex', () => {
  // Each new literal may appear exactly ONCE — in its own :root declaration.
  for (const lit of ['#FEF7EC', '#FEFAF3', '#F5D9A8', '#D6D6D2'])
    assert.equal((css.match(new RegExp(lit, 'gi')) || []).length, 1,
      `${lit} may appear only in its :root token`);
  // Spec §9 lists these two as "new". They are not: they are --violet (:24) and
  // --peach-ink (:21). Each must still appear exactly once — its own token.
  for (const lit of ['#8C7FD6', '#B5751A'])
    assert.equal((css.match(new RegExp(lit, 'gi')) || []).length, 1,
      `${lit} already has a token — use var(), do not restate it`);
  assert.ok(!/#FFFDF8/i.test(css), 'the old .qpanel wash literal is gone');
});

test('the four wr-* keyframes are declared exactly once each', () => {
  for (const n of ['wr-spin', 'wr-pulse', 'wr-rise', 'wr-blink'])
    assert.equal((css.match(new RegExp(`@keyframes\\s+${n}\\b`, 'g')) || []).length, 1,
      `@keyframes ${n} must be declared exactly once`);
});

test('the reduced-motion guard comes AFTER every wr-* animation it neutralizes', () => {
  // @media contributes NO specificity, so source order is the only thing that
  // makes `animation:none` win — the same reason the legacy block at
  // style.css:748-763 and the ship-it one at :1927-1940 give for their placement.
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(guard > 0, 'no reduced-motion block found');
  const lastUse = Math.max(...['wr-spin', 'wr-pulse', 'wr-rise', 'wr-blink']
    .map((n) => css.lastIndexOf(`animation:${n}`)));
  assert.ok(lastUse > 0, 'no `animation:wr-*` declaration found at all');
  assert.ok(lastUse < guard,
    'every `animation:wr-*` rule must precede the final prefers-reduced-motion block');
  assert.ok(css.slice(guard).includes('animation:none'),
    'the final reduced-motion block must actually neutralize something');
});

test('the redesign orphans are gone from the stylesheet', () => {
  // Strip comments first. Two SURVIVING comments in the History Agents block
  // legitimately mentioned `.subs-step:first-of-type` and `.subs-tree li .st` while
  // explaining rules that stay — Task 4 Step 7 rewords them, but a raw substring
  // test over the whole file would still be brittle against any future prose.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const dead of ['.run-foot', '.chip.qcount', '.run-top', '.subs-bar', '.subs-panel',
    '.btn-subs', '.subs-legend', '.subs-step', '.subs-tree'])
    assert.ok(!bare.includes(dead), `${dead} still present in style.css`);
  // …but the halves History's Agents tab still emits survive.
  assert.ok(css.includes('.hd-ag-head .subs-stat'), '.subs-stat kept for the History Agents tab');
  assert.ok(css.includes('.hd-ag-row .st'), '.st kept for the History Agents tab');
  assert.ok(/\.subs-skills\s*\{/.test(css), '.subs-skills kept — skillPillsHtml still emits it');
  assert.ok(css.includes('.skill-pill'), '.skill-pill kept');
  assert.ok(css.includes('.agent-type-pill'), '.agent-type-pill kept');
  assert.ok(css.includes('.graphify-pill'), '.graphify-pill kept');
});
