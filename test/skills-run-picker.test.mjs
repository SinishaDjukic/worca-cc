// test/skills-run-picker.test.mjs — New Pipeline › Advanced › Sets (skills registry design §6 board 7,
// §4.5): the label counts servers and skills, the popover lists a set's skill rows after its server
// rows under the names agents call, skipped skills are disabled rows with their reason, and a blocked
// layer is one muted line with no skill rows. Pure DOM (mcp-run-picker.mjs), jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mcpRunsLabel, renderMcpRunsPop } from '../ui/public/mcp-run-picker.mjs';
import { checkRows } from './helpers/rows.mjs';
import { skillLayerText } from '../src/core/skills-registry/texts.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const TEAM = 'team-acme-platform-9333';
const mounted = (name, setId, pluginName) => ({ id: `skill:library:${name}`, name, qualifiedName: `${pluginName}:${name}`, pluginName, setId, projects: [] });
// The blocked layer's text as the preview carries it: P1's reason part (the picker writes the prefix).
const BLOCKED = { blocked: 'sideload-disabled', text: skillLayerText('sideload-disabled') };
const preview = (layer = { blocked: null, text: null }) => ({
  sets: [
    { id: 'billing', name: 'Billing', group: 'set', routes: [{ project: 'billing-1a2b3c4d' }] },
    { id: TEAM, name: 'Team · acme/platform', group: 'team', routes: [] },
    { id: 'docs', name: 'Docs', group: 'set', routes: [] },
  ],
  copies: [{ name: 'pg_billing', copy: 'pg_billing', setId: 'billing', serverId: 'manual:pg' }],
  skipped: [],
  skills: {
    mounted: [mounted('deploy-checklist', 'billing', 'billing'), mounted('release-notes', 'billing', 'billing'), mounted('style-guide', 'docs', 'docs')],
    plugins: [], started: layer.blocked ? 0 : 3, layer, newer: false,
    skipped: [
      { setId: 'billing', setName: 'Billing', pluginName: 'billing', qualifiedName: 'billing:gone', skillId: 'skill:library:gone', name: 'gone', reason: 'missing-skill', why: 'no longer installed' },
      { setId: TEAM, setName: 'Team · acme/platform', pluginName: 'team-platfor', skillId: 'skill:plugin:acme/triage', name: 'triage', reason: 'needs-consent', why: 'turn it on in the team checklist' },
      { setId: 'billing', setName: 'Billing', pluginName: 'billing', qualifiedName: 'billing:quiet', skillId: 'skill:library:quiet', name: 'quiet', reason: 'off', why: 'off' },
    ],
  },
});

test('New Pipeline Sets picker: skills beside servers — label, rows, keys, skips and the blocked layer', async () => {
  await checkRows([
    { name: 'label: "N of M servers · K of L skills"; an opted-out skill leaves K; a preview without skills reads as before', run: () => {
      assert.equal(mcpRunsLabel(preview(), []), '1 of 1 server · 3 of 3 skills');
      assert.equal(mcpRunsLabel(preview(), ['billing|skill:library:release-notes', 'billing|manual:pg']), '0 of 1 server · 2 of 3 skills');
      assert.equal(mcpRunsLabel({ ...preview(), skills: null }, []), '1 of 1 MCP server');
      assert.equal(mcpRunsLabel({ ...preview(), skills: { ...preview().skills, mounted: [] } }, []), '1 of 1 MCP server', 'no startable skill: the MCP label');
      assert.equal(mcpRunsLabel(preview(BLOCKED), []), '1 of 1 server · 0 of 3 skills');
    } },
    { name: 'popover: per set, server rows then skill rows (qualified names); skipped skills are disabled with their reason; choices are not problems', run: () => {
      const pop = renderMcpRunsPop(preview(), ['billing|skill:library:release-notes'], { doc, onToggle: () => {} });
      assert.deepEqual([...pop.querySelectorAll('.mcp-runs-set')].map((l) => l.textContent), ['Billing', 'Team · acme/platform', 'Docs'], 'a set with only skills (or only a skipped skill) is listed');
      const rows = [...pop.querySelectorAll('.mcp-runs-row')].map((r) => [r.querySelector('.mono').textContent, r.querySelector('input') ? r.querySelector('input').checked : r.querySelector('.hint').textContent]);
      assert.deepEqual(rows, [
        ['pg_billing', true], ['billing:deploy-checklist', true], ['billing:release-notes', false], ['billing:gone', 'no longer installed'], ['billing:quiet', 'off'],
        ['team-platfor:triage', 'off — turn it on in the team checklist'],
        ['docs:style-guide', true],
      ]);
      assert.deepEqual([...pop.querySelectorAll('.mcp-runs-row.is-skill')].length, 6, 'skill rows are marked');
      assert.deepEqual([...pop.querySelectorAll('.mcp-runs-row.is-problem .mono')].map((n) => n.textContent), ['billing:gone'], 'skipped rows read the name agents call (qualifiedName, else pluginName:name)');
      const billing = pop.querySelector('.mcp-runs-set input');
      assert.equal(billing.dataset.keys, 'billing|manual:pg billing|skill:library:deploy-checklist billing|skill:library:release-notes', 'the set box spans servers and skills');
      assert.equal(billing.indeterminate, true);
      assert.equal(pop.querySelectorAll('.mcp-runs-set input')[1].disabled, true, 'nothing startable in the Team set');
    } },
    { name: 'toggles report skill membership keys', run: () => {
      const calls = [];
      const pop = renderMcpRunsPop(preview(), [], { doc, onToggle: (keys, on) => calls.push([keys, on]) });
      doc.body.replaceChildren(pop);
      [...pop.querySelectorAll('.mcp-runs-row input')].find((i) => i.dataset.keys === 'docs|skill:library:style-guide').click();
      assert.deepEqual(calls, [[['docs|skill:library:style-guide'], false]]);
    } },
    { name: 'another engine: a skill row shows the name its .agents/skills would give it', run: () => {
      const p = preview();
      p.skills.mounted = p.skills.mounted.map((m) => ({ ...m, agentName: m.name === 'deploy-checklist' ? 'billing-deploy-checklist' : m.name }));
      const pop = renderMcpRunsPop(p, [], { doc, onToggle: () => {} });
      const names = [...pop.querySelectorAll('.mcp-runs-row.is-skill:not(.is-skipped)')].map((r) => r.textContent);
      assert.ok(names.some((t) => t.includes('billing-deploy-checklist')));
      assert.ok(names.some((t) => t.includes('release-notes') && !t.includes('billing:release-notes')));
    } },
    { name: 'a blocked layer: one muted line naming why, no skill rows, the set box over servers only', run: () => {
      const pop = renderMcpRunsPop(preview(BLOCKED), [], { doc, onToggle: () => {} });
      const first = pop.firstElementChild;
      assert.ok(first.classList.contains('mcp-runs-blocked'));
      assert.equal(first.textContent, `skills from sets not loaded: ${skillLayerText('sideload-disabled')}`);
      assert.doesNotMatch(first.textContent, /loaded: skills from sets/, 'the prefix is written once');
      assert.equal(pop.querySelectorAll('.mcp-runs-row.is-skill').length, 0);
      assert.deepEqual([...pop.querySelectorAll('.mcp-runs-set')].map((l) => l.textContent), ['Billing'], 'sets with nothing but skills drop out');
      assert.equal(pop.querySelector('.mcp-runs-set input').dataset.keys, 'billing|manual:pg');
    } },
  ]);
});
