// test/marketplace-manage-view.test.mjs — the installed plugin sheet's pieces (board 3.3), detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { landing } from '../ui/public/marketplace/kinds.mjs';
import {
  renderManageHead, healthSummary, renderHealth, renderAdds, sourceLine, renderSource, renderRemoveRow,
  renderTestResult,
} from '../ui/public/marketplace/manage-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
import { ROW, INVENTORY, DETAIL, CHECKS } from './helpers/marketplace-manage-fixtures.mjs';

test('head: big tile, name, "0.2.0 · Worca CC Official", the Enabled switch, Update chip + Review update', () => {
  const head = renderManageHead(doc, ROW);
  assert.ok(head.querySelector('.mk-mt.mk-mt-lg.mk-t-src'));
  assert.equal(head.querySelector('.mk-sheet-id h2#mk-sheet-title.subpage-title').textContent, 'github-source');
  assert.equal(text(head.querySelector('.mk-manage-meta')), '0.2.0 · Worca CC Official');
  assert.equal(head.querySelector('.mk-manage-meta .mk-ver').textContent, '0.2.0');
  const sw = head.querySelector('label.switch-row.mk-manage-switch input.sw-input.mk-manage-enable[type="checkbox"][role="switch"]');
  assert.equal(sw.checked, true);
  assert.ok(sw.nextElementSibling.classList.contains('switch'), 'the .switch track follows the input (style.css .sw-input + .switch)');
  assert.equal(text(sw.closest('label')), 'Enabled');
  const upd = head.querySelector('.mk-manage-upd');
  assert.equal(text(upd.querySelector('.mk-chip')), 'Update 0.3.0');
  const review = upd.querySelector('button.btn.btn-sm.mk-review-update');
  assert.deepEqual([review.type, review.textContent], ['button', 'Review update']);
  assert.equal(head.querySelector('button[aria-label="Close"]'), null, "P3's sheet header owns Close");
});

test('head: no update row without latest; linked shows the linked chip; disabled is unticked', () => {
  const head = renderManageHead(doc, { ...ROW, latest: null, enabled: false, linked: true, version: 'dev', marketplace: null, marketplaceName: null });
  assert.equal(head.querySelector('.mk-manage-upd'), null);
  assert.equal(head.querySelector('input.mk-manage-enable').checked, false);
  assert.equal(text(head.querySelector('.mk-manage-meta')), 'dev · linked');
});

test('health: "8 of 8 checks passed" and one row per check, in Doctor order', () => {
  const sec = renderHealth(doc, { report: { ok: true, checks: CHECKS } });
  assert.equal(sec.dataset.sec, 'health');
  assert.equal(sec.querySelector('h3').textContent, 'Health');
  assert.equal(sec.querySelector('button.mk-health-run').textContent.trim(), 'Run again');
  const chip = sec.querySelector('.mk-chip');
  assert.deepEqual([chip.textContent.trim(), chip.classList.contains('mk-chip-ok')], ['8 of 8 checks passed', true]);
  const ul = sec.querySelector('ul.mk-checks[aria-label="Health checks"]');
  assert.deepEqual([...ul.querySelectorAll('li.mk-check .mk-check-id')].map((n) => n.textContent),
    ['installed', 'current', 'manifest', 'api', 'module:github', 'agents-api', 'contributions', 'config:github']);
  assert.equal(ul.querySelectorAll('[role="img"][aria-label="ok"]').length, 8);
  assert.equal(text(ul.querySelector('li.mk-check')), 'installed lockfile entry present');
});

test('health: failures are their own rows and the chip turns red; before a run, "Run checks"; running is a chip', () => {
  const report = { ok: false, checks: [...CHECKS.slice(0, 3), { id: 'config:github', ok: false, detail: 'token rejected (401)' }] };
  assert.deepEqual(healthSummary(report), { passed: 3, total: 4, ok: false });
  const sec = renderHealth(doc, { report });
  const chip = sec.querySelector('.mk-chip');
  assert.deepEqual([chip.textContent.trim(), chip.classList.contains('mk-chip-bad')], ['3 of 4 checks passed', true]);
  const bad = sec.querySelector('li.mk-check.mk-check-fail');
  assert.deepEqual([bad.dataset.check, bad.querySelector('[role="img"]').getAttribute('aria-label'), bad.querySelector('.mk-meta').textContent],
    ['config:github', 'fail', 'token rejected (401)']);
  const idle = renderHealth(doc, {});
  assert.equal(idle.querySelector('button.mk-health-run').textContent.trim(), 'Run checks');
  assert.equal(idle.querySelector('ul.mk-checks'), null);
  const running = renderHealth(doc, { running: true });
  assert.equal(running.querySelector('button.mk-health-run').disabled, true);
  assert.equal(running.querySelector('.mk-chip').textContent.trim(), 'Running checks…');
});

test('adds: one row per contribution in kind order (P4 addsRows titles), its own tile, kind label and landing link; old shapes count 0', () => {
  const inv = { taskSources: [{ id: 'github', displayName: 'GitHub Issues' }], models: [{ id: 'm1', label: 'Fast' }],
    agents: [{ key: 'reviewer' }], skills: ['style'], workflows: ['Release notes'] };            // no scripts / mcpServers keys
  assert.deepEqual([...renderAdds(doc, inv).querySelectorAll('.mk-add-row')].map((r) => [r.dataset.kind, r.querySelector('.mk-add-name').textContent]),
    [['taskSources', 'GitHub Issues'], ['models', 'Fast'], ['agents', 'reviewer'], ['skills', 'style'], ['workflows', 'Release notes']]);
  const sec = renderAdds(doc, INVENTORY);
  assert.equal(sec.querySelector('h3').textContent, 'Adds');
  const row = sec.querySelector('.mk-wash.mk-add-row[data-kind="taskSources"]');
  assert.ok(row.querySelector('.mk-mt.mk-mt-sm.mk-t-src'));
  assert.equal(row.querySelector('.mk-add-name').textContent, 'GitHub Issues');
  assert.equal(row.querySelector('.mk-meta').textContent, 'Task source');
  const a = row.querySelector('a.mk-link');
  assert.deepEqual([a.textContent.trim(), a.getAttribute('href')], ['Pick it in New run', '#new']);
  const many = renderAdds(doc, inv);
  assert.deepEqual([...many.querySelectorAll('a.mk-link')].map((x) => [x.textContent.trim(), x.getAttribute('href')]),
    ['taskSources', 'models', 'agents', 'skills', 'workflows'].map((k) => [landing(k).label, landing(k).href]));
  assert.equal(renderAdds(doc, {}), null, 'nothing loaded → no Adds section');
});

test('source: "url · path", "@ sha7", View on GitHub only with a web url; linked has no source line', () => {
  assert.equal(sourceLine(DETAIL), 'github.com/SinishaDjukic/worca-cc · plugins/github-source');
  assert.equal(sourceLine({ ...DETAIL, repo: 'https://github.com/acme/one.git', subdir: '' }), 'github.com/acme/one');
  assert.equal(sourceLine({ ...DETAIL, repo: null }), null);
  const sec = renderSource(doc, DETAIL);
  assert.equal(sec.querySelector('h3').textContent.trim(), 'Source');
  assert.equal(sec.querySelector('.mk-src .mk-src-url.mk-mono').textContent, 'github.com/SinishaDjukic/worca-cc · plugins/github-source');
  assert.equal(sec.querySelector('.mk-src .mk-src-sha.mk-mono').textContent, '@ d12b77f');
  const gh = sec.querySelector('a.mk-link');
  assert.deepEqual([gh.textContent.trim(), gh.getAttribute('href'), gh.getAttribute('target'), gh.getAttribute('rel')],
    ['View on GitHub', DETAIL.webUrl, '_blank', 'noopener']);
  assert.equal(renderSource(doc, { ...DETAIL, webUrl: null }).querySelector('a.mk-link'), null);
  const linked = renderSource(doc, { ...DETAIL, repo: null, subdir: '', sha: null, webUrl: null });
  assert.deepEqual([linked.querySelector('.mk-src-url'), text(linked.querySelector('.mk-chip'))], [null, 'linked']);
});

test('remove row: "Remove github-source…" is a danger button that only opens the dialog', () => {
  const b = renderRemoveRow(doc, 'github-source').querySelector('button.btn.btn-danger.mk-remove');
  assert.deepEqual([b.type, b.textContent.trim(), b.dataset.name], ['button', 'Remove github-source…', 'github-source']);
});

test('test result: connected (identity, instance), waiting (connector message), not connected (unplaced errors)', () => {
  const okEl = renderTestResult(doc, { ok: true, identity: 'dprinov', instance: { baseUrl: 'https://api.github.com', project: 'acme/one' } });
  assert.equal(okEl.querySelector('.mk-chip.mk-chip-ok').textContent.trim(), 'Connected · signed in as dprinov');
  assert.equal(okEl.querySelector('.mk-mono').textContent, 'https://api.github.com · acme/one');
  assert.equal(renderTestResult(doc, { ok: true }).querySelector('.mk-chip').textContent.trim(), 'Connected');
  const wait = renderTestResult(doc, { ok: false, pending: true, message: 'Finish signing in in the browser' });
  assert.deepEqual([wait.querySelector('.mk-chip').textContent.trim(), wait.querySelector('.mk-meta').textContent], ['Waiting', 'Finish signing in in the browser']);
  assert.equal(renderTestResult(doc, { testing: true }).querySelector('.mk-chip').textContent.trim(), 'Testing…');
  const bad = renderTestResult(doc, { ok: false, errors: [{ field: 'token', message: 'bad token' }, { message: 'rate limited' }] }, { placed: ['token'] });
  assert.equal(bad.querySelector('.mk-chip.mk-chip-bad').textContent.trim(), 'Not connected');
  assert.deepEqual([...bad.querySelectorAll('.mk-test-err')].map((n) => n.textContent), ['rate limited']);
  const raw = renderTestResult(doc, { ok: false, error: { kind: 'auth', message: 'token expired' } });
  assert.deepEqual([...raw.querySelectorAll('.mk-test-err')].map((n) => n.textContent), ['token expired']);
});

test('a caller error (400 / 404 / 500) is a plain string; a Doctor answer without checks is 0 of 0', () => {
  const caller = renderTestResult(doc, { ok: false, error: 'task source not found' });
  assert.deepEqual([...caller.querySelectorAll('.mk-test-err')].map((n) => n.textContent), ['task source not found']);
  assert.deepEqual(healthSummary({}), { passed: 0, total: 0, ok: false });
  const sec = renderHealth(doc, { report: {} });
  assert.equal(sec.querySelector('.mk-chip').textContent.trim(), '0 of 0 checks passed');
  assert.equal(sec.querySelectorAll('li.mk-check').length, 0);
});

test('Adds and Source are labelled by their headings', () => {
  for (const [sec, id] of [[renderAdds(doc, INVENTORY), 'mk-sec-adds'], [renderSource(doc, DETAIL), 'mk-sec-source']]) {
    assert.deepEqual([sec.getAttribute('aria-labelledby'), sec.querySelector('h3').id], [id, id]);
  }
});
