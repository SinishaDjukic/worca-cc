// test/ui-palette-scripts.test.mjs — the Scripts palette group (spec §10.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { paletteEntries, renderPalette, applyFilter, SCRIPTS_GROUP } from '../ui/public/graph/palette.mjs';

const AGENTS = [
  { key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1, inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md' }] },
  { key: 'writer', displayName: 'Writer', domain: 'general', color: 'green', order: 9, inputs: [], outputs: [{ id: 'doc', type: 'md' }] },
];
const SCRIPTS = [
  { key: 'gitDiff', displayName: 'Git diff', runtime: 'node', color: 'green', order: 30, inputs: [{ id: 'done', type: 'void' }], outputs: [{ id: 'diff', type: 'md' }] },
  { key: 'shell', displayName: 'Shell', runtime: 'shell', color: 'amber', order: 10, ports: 'config', defaultPorts: { inputs: [{ id: 'in', type: 'md' }], outputs: [{ id: 'log', type: 'md' }] } },
  { key: 'hidden', displayName: 'Hidden', runtime: 'node', order: 1, placeable: false, inputs: [], outputs: [] },
];

test('paletteEntries: the Scripts group sits between the domain groups and the pinned Flow group, ordered, placeable only', () => {
  const groups = paletteEntries(AGENTS, { scripts: SCRIPTS });
  assert.deepEqual(groups.map((g) => g.domain), ['coding', 'general', SCRIPTS_GROUP, 'flow']);
  const s = groups[2];
  assert.equal(s.scripts, true);
  assert.equal(s.flow, false);
  assert.deepEqual(s.agents.map((e) => [e.key, e.kind, e.chip, e.portLine]), [['shell', 'script', 'shell', 'in/out (per card)'], ['gitDiff', 'script', 'node', 'in done · out diff']]);
  assert.equal(paletteEntries(AGENTS, {}).some((g) => g.scripts), false, 'no scripts: no group');
});

test('renderPalette: script pills carry data-kind="script", the key, a runtime chip and the sidecar colour; the filter matches the runtime', () => {
  const doc = new JSDOM('<!doctype html><body><div id="host"></div></body>').window.document;
  const host = doc.getElementById('host');
  renderPalette(host, { agents: AGENTS, scripts: SCRIPTS, doc });
  const sec = host.querySelector(`.pal-group[data-domain="${SCRIPTS_GROUP}"]`);
  assert.equal(sec.querySelector('.pal-grp .lab').textContent, 'Scripts');
  assert.equal(sec.dataset.minLevel, 'expert', 'placing a command-running card is authoring (docs/ui-levels.md)');
  assert.equal(host.querySelector('.pal-group[data-domain="coding"]').dataset.minLevel, undefined);
  assert.equal(sec.querySelector('.pal-grp .chip').textContent, '2');
  const shell = sec.querySelector('.ap[data-key="shell"]');
  assert.equal(shell.dataset.kind, 'script');
  assert.equal(shell.dataset.rt, 'shell');
  assert.equal(shell.querySelector('.d').dataset.color, 'amber');
  assert.equal(shell.querySelector('.n').textContent, 'Shell', 'the name text stays clean for the drag ghost');
  assert.equal(shell.querySelector('.chip.rt').textContent, 'shell');
  assert.equal(shell.querySelector('.p').textContent, 'in/out (per card)');
  assert.equal(host.querySelector('.ap[data-key="planner"]').dataset.kind, undefined, 'agent pills are unchanged');
  applyFilter(host, 'node');
  assert.equal(host.querySelector('.ap[data-key="gitDiff"]').hidden, false);
  assert.equal(host.querySelector('.ap[data-key="shell"]').hidden, true);
  assert.equal(host.querySelector('.ap[data-key="planner"]').hidden, true);
  assert.equal(sec.hidden, false);
});
