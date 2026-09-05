// test/ui-theme-fixture.test.mjs — the theme audit's kitchen-sink fixture uses
// only class names style.css really styles, so the audit cannot rot silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./fixtures/theme-kitchen-sink.html', import.meta.url));
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

test('the kitchen-sink fixture exists and is a fragment (no <html>, no <script>)', () => {
  assert.ok(existsSync(fixturePath), 'test/fixtures/theme-kitchen-sink.html missing');
  const html = readFileSync(fixturePath, 'utf8');
  assert.ok(!/<html|<script|<style/i.test(html), 'fragment only — no document, script or style');
  assert.ok(html.includes('id="theme-kitchen"'), 'root host id');
});

const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const classSet = (html) => { const set = new Set(); for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) set.add(c); return set; };
const styled = (c) => new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![-\\w])').test(bare);   // .on must not pass via .online

test('every class the fixture uses is styled by style.css (whole-name match)', () => {
  const classes = classSet(readFileSync(fixturePath, 'utf8'));
  assert.ok(classes.size >= 60, `expected a rich fixture, got ${classes.size} classes`);
  const missing = [...classes].filter((c) => !styled(c));
  assert.deepEqual(missing, [], `classes with no rule in style.css: ${missing.join(' ')}`);
});

test('the fixture covers every log level, status family and the diff/syntax classes (as class tokens, not substrings)', () => {
  const classes = classSet(readFileSync(fixturePath, 'utf8'));
  for (const c of ['lvl-phase', 'lvl-artifact', 'lvl-error', 'lvl-warn', 'lvl-system', 'sub-agent',
    'n-amber', 'n-run', 'n-paused', 'rc-sic', 'rc-status-word', 'rc-step-chip', 'rd-ov-chip', 'st-green', 'st-peach', 'st-red', 'st-blue', 'st-violet', 'st-amber',
    'hd-dl-add', 'hd-dl-del', 'hd-dl-hunk', 'hljs-comment', 'hljs-keyword', 'hljs-type', 'hljs-string', 'hljs-literal', 'hljs-title',
    'qpanel', 'qopt', 'sel', 'ask-md', 'ask-answer', 'results-trunc', 'retained-banner', 'run-warn', 'viewer', 'info-bubble', 'chart-tip',
    'switch', 'seg', 'h-blue', 'h-green', 'h-peach', 'h-flow', 'dot', 'void', 'any', 'gdot'])
    assert.ok(classes.has(c), `fixture lacks .${c}`);
});
