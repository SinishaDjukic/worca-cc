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
test('naming.cssBlocks: rules move to their own feature by selector prefix, at-rules stay with the rule before, the bytes keep their order', () => {
  const css = '/* ---------- Plugins P7 ---------- */\n.mk-a{}\n/* the setup assistant */\n.setup-card{}\n@media (x){.setup-card{}}\n.mk-b{}\n/* naming */\n.sn-a{}\n.hint.warn{}\n';
  const blocks = [{ section: '^Plugins P7$', selectors: ['.setup-card'], feature: 'setup-assistant', name: 'setup-wizard' },
    { section: '^Plugins P7$', selectors: ['.mk-b'], feature: 'marketplace', name: 'marketplace-dialogs' },
    { section: '^Plugins P7$', selectors: ['.sn-', '.hint.warn'], feature: 'runs', name: 'smart-naming' }];
  const map = { features: [{ name: 'marketplace', cssRe: [/^Plugins P/] }], naming: { minLines: 1, cssBlocks: blocks } };
  const { parts, problems } = splitCss(css, map);
  assert.deepEqual(problems, []);
  assert.equal(parts.map((p) => p.text).join(''), css);
  assert.deepEqual(parts.map((p) => [p.file, p.text]), [
    ['marketplace/plugins.css', '/* ---------- Plugins P7 ---------- */\n.mk-a{}\n'],
    ['setup-assistant/setup-wizard.css', '/* the setup assistant */\n.setup-card{}\n@media (x){.setup-card{}}\n'],
    ['marketplace/marketplace-dialogs.css', '.mk-b{}\n'],
    ['runs/smart-naming.css', '/* naming */\n.sn-a{}\n.hint.warn{}\n']]);
  assert.throws(() => splitCss(css, { ...map, naming: { minLines: 1, cssBlocks: blocks.slice(0, 1) } }), /no naming\.cssBlocks entry claims them/);
});
test('real style.css: the setup, smart-naming, proxy and screensaver rules of marketplace P7 live in their own features', () => {
  const { parts } = splitCss(readStyleCss(), loadMap(ROOT));
  const owner = (sel) => parts.find((p) => p.text.split('\n').some((l) => l.startsWith(sel)))?.file;
  assert.equal(owner('.setup-card .sa-step{'), 'setup-assistant/setup-wizard.css');
  assert.equal(owner('.sn-adorn{'), 'runs/smart-naming.css');
  assert.equal(owner('#network-proxy-settings-card .hint{'), 'network-proxy/proxy-settings.css');
  assert.equal(owner('.ss-net{'), 'settings/away-screensaver.css');
  assert.equal(owner('.mk-mkts{'), 'marketplace/marketplaces-tab.css');
});
