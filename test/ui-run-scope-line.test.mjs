// test/ui-run-scope-line.test.mjs — E9 on the run page: every scope notice of a run is ONE quiet line under the banners,
// with an inline Details list grouped by step; real warnings stay amber banners; a legacy warning string folds in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { paintRunScope } from '../ui/public/run-scope-line.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: { nodes: [
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 0, y: 0, label: 'Implementer', color: 'violet', ports: { inputs: [], outputs: [], await: true } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 0, y: 0, label: 'Reviewer', color: 'violet', ports: { inputs: [], outputs: [], await: true } },
  ], wires: [] },
};
const notice = (nodeId, executionId, notable, extra = {}) => ({ nodeId, executionId, count: notable.length, expectedCount: 9, cross: false, notable, ...extra });
const decorOf = (over) => decorFromState({ stepper: MANIFEST, status: 'running', steps: [], active: [], warnings: [], ...over }, { live: true, now: 0 });
const line = (host) => host.querySelectorAll(':scope > .run-scope');

test('E9: the run page\'s scope line', async () => {
  await checkRows([
    { name: 'many notices render as ONE muted line; Details expands an inline list grouped by step', run: () => {
      const host = doc.createElement('div');
      const d = decorOf({ scopeNotices: [
        notice('n_impl', 'x:n_impl:1', [{ path: '/etc/hosts', tool: 'Bash' }, { path: '/Users/me/.zshrc', tool: 'Read' }]),
        notice('n_impl', 'x:n_impl:2', [{ path: '/etc/hosts', tool: 'Bash' }]),
        notice('n_rev', 'x:n_rev:1', [{ path: '/opt/x', tool: 'Grep' }], { count: 4 }),
      ] });
      paintRunScope(host, d.scope, { doc });
      paintRunScope(host, d.scope, { doc });
      assert.equal(line(host).length, 1, 'one line, idempotent');
      const el = line(host)[0];
      assert.equal(el.classList.contains('run-warn'), false, 'not an amber banner');
      assert.equal(el.classList.contains('run-scope-cross'), false);
      assert.equal(el.querySelector('.run-scope-sum').textContent, '2 steps touched 6 files outside the checkout');
      const btn = el.querySelector('button.run-scope-toggle');
      assert.equal(btn.textContent, 'Details');
      assert.equal(btn.getAttribute('aria-expanded'), 'false');
      const details = el.querySelector('.run-scope-details');
      assert.equal(details.hidden, true);
      btn.click();
      assert.equal(details.hidden, false);
      assert.equal(btn.getAttribute('aria-expanded'), 'true');
      assert.equal(btn.getAttribute('aria-controls'), details.id);
      const steps = [...details.querySelectorAll('.run-scope-step')];
      assert.deepEqual(steps.map((s) => s.querySelector('.run-scope-step-name').textContent), ['Implementer', 'Reviewer']);
      assert.deepEqual([...steps[0].querySelectorAll('li')].map((li) => li.textContent), ['/etc/hosts Bash', '/Users/me/.zshrc Read']);
      assert.deepEqual([...steps[1].querySelectorAll('li')].map((li) => li.textContent), ['/opt/x Grep', 'and 3 more']);
      assert.match(details.querySelector('.run-scope-note').textContent, /executions\.ndjson/);
      // A repaint (every state event) keeps it open.
      paintRunScope(host, d.scope, { doc });
      assert.equal(line(host)[0].querySelector('.run-scope-details').hidden, false, 'a repaint keeps Details open');
      btn.click();
      assert.equal(details.hidden, true);
    } },
    { name: 'only expected paths (no notice): nothing at all, and a line that was there goes', run: () => {
      const host = doc.createElement('div');
      paintRunScope(host, decorOf({}).scope, { doc });
      assert.equal(line(host).length, 0);
      paintRunScope(host, decorOf({ scopeNotices: [notice('n_impl', 'x', [{ path: '/etc/hosts', tool: 'Bash' }])] }).scope, { doc });
      assert.equal(line(host).length, 1);
      paintRunScope(host, null, { doc });
      assert.equal(line(host).length, 0);
    } },
    { name: 'another run\'s or session\'s files: the ONE line turns amber and marks the path', run: () => {
      const host = doc.createElement('div');
      const d = decorOf({ scopeNotices: [
        notice('n_impl', 'x:n_impl:1', [{ path: '/private/tmp/claude-501/s/other/a.mjs', tool: 'Read', cross: true }], { cross: true }),
        notice('n_impl', 'x:n_impl:2', [{ path: '/etc/hosts', tool: 'Bash' }]),
      ] });
      paintRunScope(host, d.scope, { doc });
      const el = line(host)[0];
      assert.equal(line(host).length, 1);
      assert.equal(el.classList.contains('run-scope-cross'), true);
      assert.match(el.querySelector('.run-scope-sum').textContent, /another run or session/);
      assert.equal(el.querySelectorAll('.run-scope-x').length, 1, 'the cross path is marked');
      paintRunScope(host, decorOf({ scopeNotices: [notice('n_impl', 'x', [{ path: '/etc/hosts', tool: 'Bash' }])] }).scope, { doc });
      assert.equal(line(host)[0].classList.contains('run-scope-cross'), false, 'a repaint drops the amber');
    } },
    { name: 'a legacy warning folds into the same quiet line; a legacy line names no tool', run: () => {
      const host = doc.createElement('div');
      const d = decorOf({ warnings: ['n_impl read or wrote 2 paths outside its checkout: /tmp/a.py, /tmp/o. (see executions.ndjson)'] });
      assert.deepEqual(d.warnings, []);
      paintRunScope(host, d.scope, { doc });
      assert.equal(line(host)[0].querySelector('.run-scope-sum').textContent, '1 step touched 2 files outside the checkout');
      assert.deepEqual([...line(host)[0].querySelectorAll('li')].map((li) => li.textContent), ['/tmp/a.py', '/tmp/o.']);
    } },
    { name: 'style.css styles the line muted, the cross variant amber', run: () => {
      const css = readStyleCss();
      for (const sel of ['.run-scope{', '.run-scope-cross{', '.run-scope-toggle{', '.run-scope-details[hidden]{', '.run-scope-x{']) assert.ok(css.includes(sel), `missing ${sel}`);
      const rule = css.slice(css.indexOf('.run-scope{')).split('}')[0];
      assert.ok(!rule.includes('amber'), 'the plain line is not amber');
      assert.ok(css.slice(css.indexOf('.run-scope-cross{')).split('}')[0].includes('amber'));
    } },
  ]);
});
