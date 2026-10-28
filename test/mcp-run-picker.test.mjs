// test/mcp-run-picker.test.mjs — New Pipeline › MCP servers (MCP registry design §6.2, D16,
// Appendix B 4–5): grouped by set, a tri-state set box over its startable memberships, one row per
// membership, skipped memberships disabled with their reason and never counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mcpRunsLabel, renderMcpRunsPop } from '../ui/public/mcp-run-picker.mjs';
import { checkRows } from './helpers/rows.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const TEAM = 'team-acme-platform-9333';
const copy = (name, setId, serverId, provisional = false) => ({ name, copy: name, setId, serverId, provisional });
const preview = {
  sets: [
    { id: 'billing', name: 'Billing', group: 'set', routes: [{ project: 'billing-1a2b3c4d' }] },
    { id: TEAM, name: 'Team · acme/platform', group: 'team', routes: [] },
  ],
  copies: [
    copy('postgres-ro_billing', 'billing', 'manual:postgres-ro'),
    copy('sentry_billing', 'billing', 'plugin:acme-tools/sentry'),
    copy('datadog_team-platfor', TEAM, 'policy:acme/platform/datadog', true),
  ],
  skippedTools: [{ name: 'sentry_billing', tool: 'search_issues', reason: 'tool-name-too-long:search_issues' }],
  skipped: [
    { setId: 'billing', setName: 'Billing', serverId: 'manual:gone', copy: null, reason: 'missing-server', why: 'the server is no longer installed' },
    { setId: 'billing', setName: 'Billing', serverId: 'plugin:acme-tools/jira', copy: 'jira_billing', reason: 'missing:token', why: 'API token not set' },
    { setId: TEAM, setName: 'Team · acme/platform', serverId: 'policy:acme/platform/github', copy: 'github_team-platfor', reason: 'missing:token', why: 'token not set' },
    { setId: TEAM, setName: 'Team · acme/platform', serverId: 'plugin:acme-tools/sentry', copy: 'sentry_team-platfor', reason: 'needs-consent', why: 'turn it on in the team checklist' },
  ],
};

test('New Pipeline MCP picker: label, tri-state set rows, skipped rows, workspace members, and the keys each toggle reports', async () => {
  await checkRows([
    { name: 'label: startable memberships only (Appendix B 4 — "3 of 3"), opted-out ones drop from N', run: () => {
      assert.equal(mcpRunsLabel(preview, []), '3 of 3 MCP servers');
      assert.equal(mcpRunsLabel(preview, ['billing|manual:postgres-ro']), '2 of 3 MCP servers');
    } },
    { name: 'popover: set rows are tri-state over startable memberships; skipped rows are disabled with their reason, problems marked', run: () => {
      const pop = renderMcpRunsPop(preview, ['billing|manual:postgres-ro'], { doc, onToggle: () => {} });
      const sets = [...pop.querySelectorAll('.mcp-runs-set')];
      assert.deepEqual(sets.map((l) => l.textContent), ['Billing', 'Team · acme/platform']);
      const billingBox = sets[0].querySelector('input');
      assert.equal(billingBox.checked, false);
      assert.equal(billingBox.indeterminate, true, 'one of two opted out ⇒ mixed');
      assert.equal(sets[1].querySelector('input').checked, true);
      const rows = [...pop.querySelectorAll('.mcp-runs-row')].map((r) => [r.querySelector('.mono').textContent, r.querySelector('input') ? r.querySelector('input').checked : r.querySelector('.hint').textContent]);
      assert.deepEqual(rows, [
        ['postgres-ro_billing', false], ['sentry_billing', true], ['manual:gone', 'the server is no longer installed'], ['jira_billing', 'API token not set'],
        ['datadog_team-platfor', true], ['github_team-platfor', 'token not set'], ['sentry_team-platfor', 'off: turn it on in the team checklist'],
      ]);
      assert.equal(pop.querySelectorAll('.mcp-runs-row.is-skipped input').length, 0, 'a skipped membership is never a checkbox');
      assert.deepEqual([...pop.querySelectorAll('.mcp-runs-row.is-problem .mono')].map((n) => n.textContent), ['manual:gone', 'jira_billing', 'github_team-platfor'], '§5.7: off / needs-consent read as choices; a missing server shows its id');
      const hintOf = (name) => [...pop.querySelectorAll('.mcp-runs-row')].find((r) => r.querySelector('.mono').textContent === name).querySelector('.hint')?.textContent;
      assert.equal(hintOf('datadog_team-platfor'), 'name provisional', '§4.4');
      assert.equal(hintOf('sentry_billing'), 'tool-name-too-long:search_issues', '§5.6: a withheld tool is shown; the copy still starts');
      assert.equal(hintOf('postgres-ro_billing'), undefined);
    } },
    { name: 'workspace targets name the member projects that bring each set', run: () => {
      const pop = renderMcpRunsPop(preview, [], { doc, projectName: (k) => (k === 'billing-1a2b3c4d' ? 'billing' : k), onToggle: () => {} });
      assert.equal(pop.querySelector('.mcp-runs-set').textContent, 'Billing · billing');
    } },
    { name: 'toggles: a membership box and a set box report the membership keys and the new state', run: () => {
      const calls = [];
      const pop = renderMcpRunsPop(preview, ['billing|manual:postgres-ro'], { doc, onToggle: (keys, on) => calls.push([keys, on]) });
      doc.body.replaceChildren(pop);                   // change events fire on connected inputs
      const [billingSet] = pop.querySelectorAll('.mcp-runs-set input');
      assert.equal(billingSet.dataset.keys, 'billing|manual:postgres-ro billing|plugin:acme-tools/sentry', 'app.js refocuses a box by its keys and kind');
      assert.deepEqual([...pop.querySelectorAll('input')].map((i) => i.dataset.kind), ['set', 'row', 'row', 'set', 'row'],
        'the Team set has one startable membership: its set box and its row box share keys, not kind');
      billingSet.click();                               // mixed → every startable membership back on
      pop.querySelectorAll('.mcp-runs-row input')[1].click();   // sentry_billing off
      assert.deepEqual(calls, [
        [['billing|manual:postgres-ro', 'billing|plugin:acme-tools/sentry'], true],
        [['billing|plugin:acme-tools/sentry'], false],
      ]);
    } },
  ]);
});
