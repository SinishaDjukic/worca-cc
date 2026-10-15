// test/ui-export-marketplace.test.mjs
// Export… → Worca plugin → Marketplace (#717): the pure DOM helpers of ui/public/export-marketplace.mjs,
// driven under jsdom without booting app.js (the style of test/plugins-view.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fillMarketplaceSelect, marketplaceExportBody, marketplaceNameProblem, marketplacePlanExtras, marketplaceDoneView } from '../ui/public/export-marketplace.mjs';

const doc = () => new JSDOM('<!doctype html><body><select id="s"></select></body>').window.document;
const RES = {
  marketplace: { id: 'acme', name: 'Acme', forge: 'github', repo: 'acme/market', url: 'https://github.com/acme/market' },
  name: 'shared-flow', subdir: 'plugins/shared-flow', branch: 'worca/plugin/shared-flow', base: 'main',
  update: true, oldVersion: '0.1.0', newVersion: '0.1.1', versionText: '0.1.0 → 0.1.1',
  files: { created: ['plugins/shared-flow/agents/a.md'], updated: ['plugins/shared-flow/worca-cc-plugin.json'], noop: [], skipped: [] },
  index: { present: true, added: false }, warnings: [], pushTo: 'marketplace', fork: null, draft: false,
};

test('fillMarketplaceSelect: options, kept selection, empty state', () => {
  const d = doc(); const s = d.getElementById('s');
  const targets = [{ id: 'a', name: 'Acme', repo: 'acme/market', ref: 'dev' }, { id: 'b', name: 'Beta', repo: 'b/m', ref: null }];
  assert.equal(fillMarketplaceSelect(s, targets, { doc: d, keep: 'b' }), 2);
  assert.deepEqual([...s.options].map((o) => [o.value, o.textContent]), [['a', 'Acme — acme/market (dev)'], ['b', 'Beta — b/m']]);
  assert.equal(s.value, 'b');
  assert.equal(fillMarketplaceSelect(s, [], { doc: d }), 0);
  assert.equal(s.options.length, 1);
  assert.equal(s.options[0].disabled, true);
  assert.match(s.options[0].textContent, /add one on the Marketplace page/);
});

test('marketplaceExportBody: draft only when ticked', () => {
  assert.deepEqual(marketplaceExportBody({ marketplaceId: 'acme', pluginName: 'x', draft: false }), { destination: 'marketplace', marketplaceId: 'acme', pluginName: 'x' });
  assert.deepEqual(marketplaceExportBody({ marketplaceId: 'acme', pluginName: '', draft: true }), { destination: 'marketplace', marketplaceId: 'acme', draft: true });
});

test('marketplaceNameProblem: a typed name with no letter or digit stops the export instead of falling back to the pipeline name', () => {
  assert.match(marketplaceNameProblem({ raw: '!!!', name: '' }), /at least one letter or digit/);
  assert.equal(marketplaceNameProblem({ raw: 'My Plugin!', name: 'my-plugin' }), '');
  assert.equal(marketplaceNameProblem({ raw: '', name: '' }), '');
  // the server's PLUGIN_NAME_RE starts with a letter: "2fa" would be a 400 after the click, so say so up front
  assert.match(marketplaceNameProblem({ raw: '2fa', name: '2fa' }), /start with a letter/);
  assert.match(marketplaceNameProblem({ raw: '2FA flow', name: '2fa-flow' }), /start with a letter/);
  assert.equal(marketplaceNameProblem({ raw: 'fa2', name: 'fa2' }), '');
});

test('marketplaceDoneView: PR link, version, fork; "No changes" without a PR', () => {
  const d = doc();
  const v = marketplaceDoneView({ ...RES, status: 'opened', prUrl: 'https://github.com/acme/market/pull/9', pushTo: 'fork', fork: { repo: 'me/market' }, draft: true }, { doc: d });
  assert.equal(v.title, 'Pull request opened for plugin "shared-flow" v0.1.1');
  const pr = v.lines.find(([k]) => k === 'Pull request')[1];
  assert.equal(pr.tagName, 'A');
  assert.equal(pr.getAttribute('href'), 'https://github.com/acme/market/pull/9');
  assert.equal(pr.getAttribute('rel'), 'noopener');
  assert.deepEqual(v.lines.find(([k]) => k === 'Version'), ['Version', '0.1.0 → 0.1.1']);
  assert.match(v.lines.find(([k]) => k === 'Branch')[1], /from me\/market/);
  assert.deepEqual(v.lines.find(([k]) => k === 'Draft'), ['Draft', 'yes']);
  const none = marketplaceDoneView({ ...RES, status: 'unchanged', newVersion: '0.1.0', prUrl: null }, { doc: d });
  assert.equal(none.title, 'No changes');
  assert.equal(none.lines.some(([k]) => k === 'Pull request'), false);
  const same = marketplaceDoneView({ ...RES, status: 'up-to-date', prUrl: 'https://github.com/acme/market/pull/9', index: { present: true, added: true } }, { doc: d });
  assert.match(same.title, /^No changes — the open pull request already has/);
  // nothing was pushed: no "N changed" / version-bump claim, but the PR link and branch stay
  assert.equal(same.lines.some(([k]) => k === 'Files' || k === 'Version'), false);
  assert.equal(same.lines.some(([k]) => k === 'Pull request'), true);
  assert.equal(same.lines.some(([k]) => k === 'Branch'), true);
  // a hand-authored plugin without a version (D18): never "vnull" / "null (new)"
  const unv = marketplaceDoneView({ ...RES, status: 'opened', prUrl: 'https://github.com/acme/market/pull/9', oldVersion: null, newVersion: null, versionText: 'unversioned (unchanged)' }, { doc: d });
  assert.equal(unv.title, 'Pull request opened for plugin "shared-flow"');
  assert.deepEqual(unv.lines.find(([k]) => k === 'Version'), ['Version', 'unversioned (unchanged)']);
  assert.doesNotMatch(JSON.stringify(unv.lines.filter(([, v]) => typeof v === 'string')), /null/);
});

test('marketplaceDoneView: the server\'s warnings reach the done screen (a user who skips Preview must still see them)', () => {
  const d = doc();
  const warn = (v) => v.lines.filter(([k]) => k === 'Warning').map(([, t]) => t);
  const upd = marketplaceDoneView({ ...RES, status: 'updated', prUrl: 'https://github.com/acme/market/pull/9',
    warnings: ['Azure DevOps: the existing pull request\'s description was not refreshed', 'lint: agents/a.md has no description'] }, { doc: d });
  assert.deepEqual(warn(upd), ['Azure DevOps: the existing pull request\'s description was not refreshed', 'lint: agents/a.md has no description']);
  const same = marketplaceDoneView({ ...RES, status: 'up-to-date', prUrl: 'https://github.com/acme/market/pull/9', warnings: ['w1'] }, { doc: d });
  assert.deepEqual(warn(same), ['w1']);
  const none = marketplaceDoneView({ ...RES, status: 'unchanged', warnings: ['w2'] }, { doc: d });
  assert.deepEqual(warn(none), ['w2']);
  assert.deepEqual(warn(marketplaceDoneView({ ...RES, status: 'opened', prUrl: 'https://github.com/acme/market/pull/9', warnings: [] }, { doc: d })), []);
  assert.deepEqual(warn(marketplaceDoneView({ ...RES, status: 'opened', prUrl: 'https://github.com/acme/market/pull/9', warnings: undefined }, { doc: d })), []);
});

test('marketplacePlanExtras: index row + collapsible PR preview on a dry run', () => {
  const d = doc();
  const frag = marketplacePlanExtras({ ...RES, status: 'dry-run', index: { present: true, added: true }, title: 'Add plugin shared-flow v0.1.0', body: '## Plugin\n…', pushTo: 'fork' }, { doc: d });
  const host = d.createElement('div'); host.appendChild(frag);
  assert.match(host.querySelector('.export-row code').textContent, /worca-cc-marketplace\.json \+ "plugins\/shared-flow"/);
  assert.match(host.querySelector('details.export-pr-preview summary').textContent, /Add plugin shared-flow v0\.1\.0 \(from your fork\)/);
  assert.equal(host.querySelector('details pre').textContent, '## Plugin\n…');
});
