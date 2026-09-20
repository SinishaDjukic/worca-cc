// test/ui-theme-tokens.test.mjs — the theme token contract (spec §4.1, D12, D13):
// every colour token is a light-dark() pair (six equal-arm bases excepted), both
// arms clear the spec's contrast minimums, no --gv-* name outside the geometry
// set, and (Task 2) no colour literal survives outside the token blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');            // comments stripped

/** The declarations of the FIRST block opened by `selector` (the house ruleBody idiom). */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = bare.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}
function declarations(body) {
  return body.split(';').map((s) => s.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
  }).filter(([k]) => k.startsWith('--'));
}
/** 'light-dark(A, B)' → [A, B] at the top-level comma; anything else → null. */
export function arms(value) {
  const m = /^light-dark\(([\s\S]*)\)$/.exec(value.trim());
  if (!m) return null;
  let depth = 0; const inner = m[1];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '(') depth += 1; else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
  }
  return null;
}
/** Remove every balanced `light-dark(…)` call from a value. */
function stripLightDark(value) {
  let out = value;
  for (;;) {
    const at = out.indexOf('light-dark(');
    if (at === -1) return out;
    let depth = 0; let end = -1;
    for (let i = at + 'light-dark'.length; i < out.length; i += 1) {
      if (out[i] === '(') depth += 1; else if (out[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return out;
    out = out.slice(0, at) + out.slice(end + 1);
  }
}
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/i;
const EQUAL_ARMS = ['--green', '--peach', '--red', '--blue', '--violet', '--amber',   // D13's allowlist …
  '--teal', '--pink', '--indigo', '--lime', '--cocoa', '--slate'];                     // … + the six script-only bases (script-wizard plan S10)

const rootBody = ruleBody(':root');
// `.hd-diff{display:grid;…}` precedes the token block of the same selector — take the block that OPENS with the token.
const hdBody = (bare.match(/\.hd-diff\s*\{\s*(--hd-count-add[^}]*)\}/) || [])[1] || null;
const synBody = (bare.match(/\.hd-diff-pane,\.ask-md[^{]*\{\s*(--hd-syntax-comment[^}]*)\}/) || [])[1] || null;
const tokens = new Map([...declarations(rootBody), ...declarations(hdBody), ...declarations(synBody)]);
const arm = (name, which) => { const v = tokens.get(name); if (v == null) return null; const a = arms(v); return a ? a[which === 'dark' ? 1 : 0] : v; };

test('theme: the :root block opens the scheme and the two [data-theme] rules force it', () => {
  assert.ok(rootBody, ':root block missing');
  assert.ok(hdBody && synBody, 'the two scoped diff token blocks');
  assert.match(rootBody, /(^|;)\s*color-scheme:\s*light dark\s*(;|$)/);
  assert.match(bare, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;?\s*\}/);
  assert.match(bare, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;?\s*\}/);
  assert.ok(!/prefers-color-scheme/.test(bare), 'no @media (prefers-color-scheme) anywhere — color-scheme does that job (D5)');
  assert.match(bare, /@media print\s*\{\s*:root\s*\{\s*color-scheme:\s*light;?\s*\}\s*\}/, 'paper is white: print in the light scheme');
});

test('theme: every colour token is a light-dark() pair, both arms colours; the six bases are plain and equal to the spec', () => {
  assert.ok(tokens.size >= 66, `expected ≥66 tokens across the three blocks, got ${tokens.size}`);
  const bad = [];
  for (const [name, value] of tokens) {
    if (EQUAL_ARMS.includes(name)) { if (!/^#[0-9A-Fa-f]{6}$/.test(value)) bad.push(`${name} must stay a plain 6-digit hex (D13)`); continue; }
    const isColor = COLOR_LITERAL.test(value) || value.includes('light-dark(');
    if (!isColor) continue;                                              // radii, fonts, sizes
    const rest = stripLightDark(value);
    if (COLOR_LITERAL.test(rest)) bad.push(`${name}: colour outside light-dark(): ${value}`);
    const a = arms(value);
    if (a && !(COLOR_LITERAL.test(a[0]) && COLOR_LITERAL.test(a[1]))) bad.push(`${name}: an arm is not a colour: ${value}`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(EQUAL_ARMS.map((n) => tokens.get(n)), ['#5BAE5B', '#EFA63C', '#E76A5A', '#5BA6CC', '#8C7FD6', '#E6962A',
    '#4FB3A9', '#E27BA8', '#6A7FD8', '#A3BF3A', '#B08A5E', '#8A96A3']);
});

test('theme: no new --gv-* or stray --hd-* token names (D12)', () => {
  const gv = [...tokens.keys()].filter((k) => k.startsWith('--gv-'));
  assert.deepEqual(gv, [], '--gv-* is the composer geometry namespace (injectGeometry)');
  const hd = [...declarations(rootBody)].map(([k]) => k).filter((k) => k.startsWith('--hd-'));
  assert.deepEqual(hd, [], '--hd-* tokens live only in the two diff scopes');
});

// ---- WCAG math on the declared pairs (spec §3.1 minimums), both arms ----------
const L = (hex) => {
  const h = hex.replace('#', ''); const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS = [
  ['--ink', '--bg', 4.5], ['--ink', '--panel', 4.5], ['--ink', '--field', 4.5], ['--ink', '--surface', 4.5], ['--ink', '--canvas-2', 4.5],
  ['--ink-2', '--panel', 4.5], ['--ink-2', '--bg', 4.5], ['--ink-2', '--field', 4.5],
  ['--on-ink', '--ink', 4.5],
  ...['green', 'peach', 'red', 'blue', 'violet', 'amber', 'teal', 'pink', 'indigo', 'lime', 'cocoa', 'slate'].flatMap((f) => [[`--${f}-ink`, `--${f}-bg`, 3.3], [`--${f}-ink`, '--panel', 3.8]]),
  ['--ink', '--amber-wash', 4.5], ['--ink-2', '--amber-wash', 4.5], ['--ink', '--field-focus', 4.5], ['--ink', '--surface', 4.5], ['--ink-2', '--surface', 4.5],
  ['--hd-count-add', '--panel', 4.5], ['--hd-count-del', '--panel', 4.5],
  ...['comment', 'keyword', 'type', 'string', 'literal', 'title'].map((s) => [`--hd-syntax-${s}`, '--panel', 4.5]),
  ['--chip-ink', '--field', 4.5], ['--trunc-ink', '--panel', 4.5], ['--h-blue-ink', '--blue-bg', 4.5], ['--h-peach-ink', '--peach-bg', 4.5],
];
const DARK_ONLY = [   // light fails these today (spec §7.4 baseline); dark must not
  ['--ink-3', '--panel', 4.5], ['--ink-3', '--bg', 4.5], ['--ink-3', '--field', 4.5], ['--ink-3', '--field-focus', 4.5], ['--ink-3', '--surface', 4.5], ['--ink-3', '--canvas-2', 4.5], ['--ink-3', '--amber-wash', 4.5],
  ['--on-ink', '--ink-3', 4.5], ['--h-green-ink', '--green-bg', 4.5],
  ...['green', 'peach', 'red', 'blue', 'violet', 'amber', 'teal', 'pink', 'indigo', 'lime', 'cocoa', 'slate'].flatMap((f) => [[`--${f}-ink`, `--${f}-bg`, 4.5], [`--${f}-ink`, '--panel', 4.5], [`--${f}`, '--panel', 3], [`--${f}`, '--surface', 3], ['--on-status', `--${f}`, 4.5]]),
  ['--amber-ink', '--amber-wash', 4.5], ['--seq', '--panel', 3], ['--seq', '--canvas-2', 3],
  ['--line-2', '--panel', 1.5], ['--amber-wash', '--panel', 1.08], ['--surface', '--field', 1.1], ['--panel', '--bg', 1.1],
];
for (const which of ['light', 'dark']) {
  test(`theme: ${which} arms clear the spec minimums`, () => {
    const fails = [];
    for (const [fg, bg, need] of [...PAIRS, ...(which === 'dark' ? DARK_ONLY : [])]) {
      const a = arm(fg, which); const b = arm(bg, which);
      assert.ok(a && b, `${fg} / ${bg} missing`);
      const r = contrast(a, b);
      if (r < need) fails.push(`${fg} on ${bg} (${which}): ${r.toFixed(2)} < ${need}`);
    }
    assert.deepEqual(fails, []);
  });
}

test('theme: the dark arms are the warm-charcoal palette and none of the removed theme', () => {
  assert.equal(arm('--bg', 'dark'), '#161614');
  assert.equal(arm('--panel', 'dark'), '#222220');
  assert.equal(arm('--ink', 'dark'), '#ECECE8');
  assert.equal(arm('--ink-3', 'dark'), '#9E9E98');
  assert.equal(arm('--surface', 'dark'), '#34342F');
  assert.equal(arm('--line-2', 'dark'), '#494944');
  for (const dead of ['#0e1116', '#0a0d12', '#232c38', '#4f9cf9']) assert.ok(!css.toLowerCase().includes(dead), dead);
});

test('theme: no colour literal outside the token blocks (spec §4.2; Task 2 codemod)', () => {
  const noData = bare.replace(/url\("data:[^"]*"\)/g, 'url(DATA)');              // :805 keeps stroke='%23fff' inside its SVG
  const withoutTokens = noData.replace(rootBody, '').replace(hdBody, '').replace(synBody, '');
  const bodies = withoutTokens.match(/\{[^{}]*\}/g) || [];
  const offenders = [];
  for (const b of bodies) {
    const m = b.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/gi);
    if (m) offenders.push(`${m.join(' ')}  ←  ${b.slice(0, 110).replace(/\s+/g, ' ')}`);
  }
  assert.deepEqual(offenders, []);
});
