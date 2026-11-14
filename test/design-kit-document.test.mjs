// test/design-kit-document.test.mjs — the document kit's worca look (assets/design-kit/document/): its colours come
// from the shipped UI's own palette, global.css reads tokens only, every class and token the contract names exists,
// its fonts load only from assets/worca/, and the licences are the fonts' own. Pure file reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WORCA_FONTS } from '../src/core/design/kit.mjs';

const R = new URL('../', import.meta.url);
const text = (p) => readFileSync(new URL(p, R), 'utf8');
const LOOK = 'assets/design-kit/document/worca-look/';
const tokens = text(`${LOOK}tokens.css`);
const global = text(`${LOOK}global.css`);
const contract = text('assets/design-kit/document/CONTRACT.md');
/** CSS without its comments. */
const code = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** CSS without var(...) calls (their fallbacks included), innermost first. */
const noVars = (css) => { let s = code(css); for (let prev = ''; prev !== s;) { prev = s; s = s.replace(/var\([^()]*\)/g, ''); } return s; };

test('every colour in tokens.css is a colour of the shipped UI', () => {
  const ui = text('ui/public/shell/self-hosted.css').toLowerCase();
  const hexes = code(tokens).match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  assert.ok(hexes.length >= 20, 'the look sets its colours');
  for (const hex of hexes) assert.ok(ui.includes(hex.toLowerCase()), hex);
  assert.doesNotMatch(code(tokens), /rgba?\(|hsla?\(/, 'colours are hex, traceable to self-hosted.css');
  assert.match(tokens, /:root\s*\{[^}]*color-scheme:\s*light dark/);
});

test('global.css reads tokens only: no colour or font-size literal', () => {
  const bare = noVars(global);
  assert.doesNotMatch(bare, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(bare, /\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(bare, /font-size\s*:\s*[\d.]+px/i);
  assert.doesNotMatch(bare, /\burl\(/, 'only tokens.css loads files');
});

test('every token the contract or global.css names is defined in tokens.css', () => {
  const defined = new Set([...code(tokens).matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]));
  const named = new Set([...contract.matchAll(/(?<![\w!-])(--[a-z][a-z0-9-]*)/g), ...code(global).matchAll(/var\((--[a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  assert.ok(named.size >= 30, 'the contract lists the token names');
  for (const name of named) assert.ok(defined.has(name), name);
  for (const must of ['--doc-bg', '--doc-surface', '--doc-ink', '--doc-ink-2', '--doc-line', '--doc-accent', '--font-sans', '--font-mono', '--fs-1', '--fs-7', '--lh-body', '--lh-title',
    '--space-1', '--space-7', '--r-1', '--r-3', '--shadow-1', '--chart-1', '--chart-6', '--chart-ink', '--tone-info-bg', '--tone-risk-ink']) assert.ok(defined.has(must), must);
});

test('every class the contract uses has a rule in global.css', () => {
  const classes = new Set([...contract.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  assert.ok(classes.size >= 8, 'the contract shows the patterns');
  for (const c of classes) assert.match(code(global), new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`), c);
});

test('tokens.css loads only worca\'s fonts, from assets/worca/', () => {
  const urls = [...code(tokens).matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
  assert.equal(urls.length, WORCA_FONTS.length);
  for (const u of urls) {
    assert.match(u, /^assets\/worca\/[^/]+$/, u);
    assert.ok(WORCA_FONTS.includes(u.slice('assets/worca/'.length)), u);
  }
  assert.doesNotMatch(tokens, /\.kit\//);
});

test('the licences are the fonts\' own', () => {
  for (const [font, file] of [['poppins', 'LICENSE-poppins.txt'], ['jetbrains-mono', 'LICENSE-jetbrains-mono.txt']]) {
    const src = new URL(`node_modules/@fontsource/${font}/LICENSE`, R);
    if (!existsSync(src)) continue;
    assert.deepEqual(readFileSync(new URL(`${LOOK}${file}`, R)), readFileSync(src), file);
  }
});
