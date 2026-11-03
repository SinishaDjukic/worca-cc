// test/split-catch-up-fixture.test.mjs — the fixture "old" PR: three edits at mapped anchors, and where they must land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureEdits, checkFixture, FIXTURE_ROUTE, FIXTURE_CSS, FIXTURE_HTML } from '../tools/split-catch-up/fixture.mjs';

const SRC = { server: "const app = x;\napp.get('/api/settings', async (req, res) => {\n  res.json({});\n});\n",
  css: '.x{}\n/* ---------- Settings cards ---------- */\n.settings-card{max-width:760px;}\n/* ---------- Last ---------- */\n.z{}\n',
  html: '<main></main>\n<!-- Action results -->\n<div id="toasts" class="toasts" role="status"></div>\n<script src="/app.js"></script>\n' };

test('the route goes before the settings GET, the rule right under the Settings cards title, the span right after #toasts', () => {
  const e = fixtureEdits(SRC);
  assert.ok(e.server.includes(`${FIXTURE_ROUTE}\napp.get('/api/settings', `));
  assert.ok(e.css.includes(`/* ---------- Settings cards ---------- */\n${FIXTURE_CSS}\n.settings-card`));
  assert.ok(e.css.endsWith('.z{}\n'));   // the file's last rule stays last (style.css keeps a rule that must stay LAST)
  assert.ok(e.html.includes(`role="status"></div>\n${FIXTURE_HTML}\n<script`));
});
test('a missing anchor is an error naming it, never a silent no-op', () => {
  assert.throws(() => fixtureEdits({ ...SRC, server: 'nothing' }), /no route anchor/);
  assert.throws(() => fixtureEdits({ ...SRC, css: '.a{}\n' }), /no CSS anchor/);
  assert.throws(() => fixtureEdits({ ...SRC, html: '<main></main>' }), /no markup anchor/);
});
// only an unsplit tree has the monoliths: after the migration (ui/public/parts.json) the fixture's base is pre-split dev
const SPLIT = existsSync(new URL('../ui/public/parts.json', import.meta.url));
test('the real monoliths carry all three anchors, each exactly once', { skip: SPLIT && 'this tree is split: no monoliths' }, async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const e = fixtureEdits({ server: read('ui/server.mjs'), css: read('ui/public/style.css'), html: read('ui/public/index.html') });
  for (const [k, v] of [['server', FIXTURE_ROUTE], ['css', FIXTURE_CSS], ['html', FIXTURE_HTML]]) assert.equal(e[k].split(v).length, 2, k);
});
test('checkFixture: each edit in exactly one split file, none left in the residual server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cu-fix-'));
  const put = (p, s) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  put('ui/server.mjs', 'residual\n'); put('ui/routes/settings/config.mjs', FIXTURE_ROUTE);
  put('ui/public/shell/sidebar.css', FIXTURE_CSS); put('ui/public/shell/main.html', FIXTURE_HTML);
  const ok = checkFixture(dir);
  assert.deepEqual([ok.ok, ok.routes, ok.css, ok.html], [true, ['ui/routes/settings/config.mjs'], ['ui/public/shell/sidebar.css'], ['ui/public/shell/main.html']]);
  put('ui/server.mjs', FIXTURE_ROUTE);
  assert.match(checkFixture(dir).problems.join('\n'), /stayed in ui\/server\.mjs/);
});
