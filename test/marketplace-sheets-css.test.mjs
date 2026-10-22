// test/marketplace-sheets-css.test.mjs — P6's style block: every mk- class the P6 renderers emit has a rule (P3/P4's
// shared ones included), [hidden] panels stay hidden, the block sits right after P5's (SM56/SM69), tokens only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { newCard } from '../ui/public/marketplace/update-model.mjs';
import { renderUpdateCard, renderUpdateFoot } from '../ui/public/marketplace/update-view.mjs';
import { renderManageHead, renderHealth, renderAdds, renderSource, renderRemoveRow, renderTestResult } from '../ui/public/marketplace/manage-view.mjs';
import { SRC_ROW as ROW, SRC_PREVIEW as PREVIEW } from './helpers/marketplace-update-fixtures.mjs';
import { DETAIL } from './helpers/marketplace-manage-fixtures.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
// JS / test hooks that need no rule of their own.
const HOOKS = new Set(['mk-include', 'mk-reviewed', 'mk-upd-err', 'mk-disc-n', 'mk-upd-meta', 'mk-upd-only', 'mk-upd-go',
  'mk-manage-enable', 'mk-review-update', 'mk-health-run', 'mk-remove', 'mk-upd-when', 'mk-head-err', 'mk-sec-err', 'mk-src-sha']);
const DETAIL_GH = { ...DETAIL, webUrl: 'https://github.com/x' };

test('every mk- class the P6 renderers and controllers emit has a rule in style.css', () => {
  const trees = [
    renderUpdateCard(doc, { ...newCard(ROW), state: 'review', preview: PREVIEW, expanded: true }),
    renderUpdateCard(doc, { ...newCard(ROW), state: 'review', preview: { ...PREVIEW, access: [] } }),
    renderUpdateCard(doc, { ...newCard(ROW), state: 'failed', error: { message: 'x', gitMissing: false, phase: 'apply' } }),
    ...renderUpdateFoot(doc, { meta: '1 of 2 ready', only: 'Update x only', primary: 'Update 2 plugins', enabled: false, finished: false }),
    renderManageHead(doc, ROW),
    renderHealth(doc, { report: { ok: false, checks: [{ id: 'installed', ok: true, detail: 'ok' }, { id: 'api', ok: false, detail: 'no' }] } }),
    renderAdds(doc, { taskSources: [{ id: 'github', displayName: 'GitHub Issues' }] }), renderSource(doc, DETAIL_GH),
    renderRemoveRow(doc, 'github-source'), renderTestResult(doc, { ok: false, errors: [{ message: 'x' }] }),
  ];
  const used = new Set(trees.flatMap((t) => [t, ...t.querySelectorAll('*')]).flatMap((n) => [...n.classList]).filter((c) => c.startsWith('mk-')));
  for (const c of ['mk-manage-body', 'mk-setup-group', 'mk-profile-actions', 'mk-test-row', 'mk-chan-row', 'mk-upd-list', 'mk-broker']) used.add(c);
  const missing = [...used].filter((c) => !HOOKS.has(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(css));
  assert.deepEqual(missing, []);
});

test('the P6 block: after P5 (marketplace blocks follow the in-card override, SM56); hidden panels stay hidden; tokens only', () => {
  const at = css.indexOf('/* ── marketplace P6 ── */');
  assert.ok(css.indexOf('/* ── marketplace P5 ── */') > -1 && at > css.indexOf('/* ── marketplace P5 ── */'), 'right after P5');
  const end = css.indexOf('/* ── marketplace ', at + 10);                       // the next plan's marker, else EOF (SM69)
  const block = css.slice(at, end === -1 ? undefined : end);
  assert.match(block, /\.mk-upd-panel\[hidden\]\{display:none;\}/);
  assert.match(block, /\.mk-upd\{[^}]*border:1px solid var\(--line-2\);[^}]*border-radius:var\(--r-md\);[^}]*overflow:hidden;/);
  assert.match(block, /\.mk-delta\.is-red\{background:var\(--red-bg\);color:var\(--red-ink-strong\);\}/);
  assert.match(block, /\.mk-manage-body>\.mk-sec\+\.mk-sec\{border-top:1px solid var\(--line\);\}/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(|box-shadow|border-left:\s*[2-9]px|font-size:\s*\d/);
});
