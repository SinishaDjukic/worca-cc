// test/stillhet-shell.test.mjs — renderStillhetShell and the shell page it fills (ui/public/stillhet/shell.html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderStillhetShell, missingStillhetBundles } from '../src/core/stillhet-shell.mjs';
import { INDEX_THEME_ANCHOR } from '../src/core/index-html.mjs';

const html = readFileSync(new URL('../ui/public/stillhet/shell.html', import.meta.url), 'utf8');

test('renderStillhetShell fills the theme, level and git anchor and throws without it', () => {
  assert.equal(html.split(INDEX_THEME_ANCHOR).length - 1, 1);
  const out = renderStillhetShell(html, 'dark', 'expert', { git: false });
  assert.match(out, /<html lang="en" data-theme="dark" data-level="expert" data-git="off" data-adapter="live">/);
  assert.equal(renderStillhetShell(html, 'light'), html.replace(INDEX_THEME_ANCHOR, '<html lang="en" data-theme="light" data-adapter="live">'));
  assert.throws(() => renderStillhetShell('<html lang="en">', 'dark'), /stillhet shell anchor missing/);
});

test('the stamp picks the data: data-adapter="live" by default, "demo" only when asked (WORCA_STILLHET_DEMO=1)', () => {
  assert.match(renderStillhetShell(html, 'dark', 'simple'), / data-adapter="live">/);
  assert.match(renderStillhetShell(html, 'dark', 'simple', { adapter: 'demo' }), / data-adapter="demo">/);
  assert.match(renderStillhetShell(html, 'dark', 'simple', { adapter: '?state=empty' }), / data-adapter="live">/, 'nothing else picks demo');
  const src = readFileSync(new URL('../src/core/stillhet-shell.mjs', import.meta.url), 'utf8');
  assert.match(src, /process\.env\.WORCA_STILLHET_DEMO === '1' \? 'demo' : 'live'/);
});

test('the stamp says when rail is locked by WORCA_FLAGS, so the switch is drawn disabled (nav.design-switch)', () => {
  assert.match(renderStillhetShell(html, 'dark', 'simple', { railLocked: true }), / data-adapter="live" data-rail-locked="true">/);
  assert.doesNotMatch(renderStillhetShell(html, 'dark', 'simple'), /data-rail-locked/);
});

test('the shell runs no inline script and holds no handler attribute (the shell CSP allows only same-origin scripts)', () => {
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(attrs, /\bsrc="\/stillhet\//);
    assert.equal(body.trim(), '');
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
});

test('missingStillhetBundles names the generated files that are absent', () => {
  assert.deepEqual(missingStillhetBundles('/nonexistent-public-dir'), ['components.js', 'graph.js', 'app.css']);
});

test('staleStillhetBundles: a bundle older than its sources is stale in a source checkout, never in an installed package', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, utimesSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { staleStillhetBundles } = await import('../src/core/stillhet-shell.mjs');
  const root = mkdtempSync(join(tmpdir(), 'stillhet-stale-'));
  const pub = join(root, 'ui', 'public');
  mkdirSync(join(pub, 'stillhet'), { recursive: true });
  mkdirSync(join(pub, 'design-system', 'components'), { recursive: true });
  const old = new Date(Date.now() - 60000);
  for (const f of ['components.js', 'graph.js', 'app.css']) { writeFileSync(join(pub, 'stillhet', f), ''); utimesSync(join(pub, 'stillhet', f), old, old); }
  writeFileSync(join(pub, 'design-system', 'components', 'a.mjs'), '');
  assert.deepEqual(staleStillhetBundles(pub), [], 'an installed package (no tools/) is never stale');
  mkdirSync(join(root, 'tools'));
  writeFileSync(join(root, 'tools', 'stillhet-build.mjs'), '');
  assert.deepEqual(staleStillhetBundles(pub), ['components.js', 'graph.js', 'app.css']);
});

test('railStamp falls back to a default stamp when git cannot run', async () => {
  const { railStamp } = await import('../plans/rail/prototype/gates/components-js.mjs');
  const was = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try { assert.equal(railStamp().sha, 'unknown'); } finally { process.env.PATH = was; }
});

test('the 760px rule hides names only in the .pz-side mock rail, never in the app\'s drawer (#1266)', () => {
  const css = readFileSync(new URL('../ui/public/stillhet/pulse/pulse.css', import.meta.url), 'utf8');
  const at = css.indexOf('@media (max-width: 760px)'), open = css.indexOf('{', at);
  assert.ok(at >= 0, 'pulse.css has its 760px block');
  let depth = 0, end = open;
  for (; end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}' && --depth === 0) break; }
  const block = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
  const nav = sels.filter((x) => /\.pz-nav(-i|-l)?\b/.test(x));
  assert.ok(nav.length >= 3, `the block names the nav rows: ${nav.join(' | ')}`);
  for (const x of nav) assert.match(x, /^\.pz-side /, x);
});
