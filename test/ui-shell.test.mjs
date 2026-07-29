import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');

test('exactly eleven routed views', () => {
  assert.equal((html.match(/data-view/g) || []).length, 11);
});
test('eleven views include composer + the two workspace views + the two agent views + projects + plugins', () => {
  for (const v of ['new', 'running', 'history', 'composer', 'workspaces', 'workspace-create', 'agents', 'agent-create', 'projects', 'plugins', 'settings'])
    assert.ok(html.includes(`data-view="${v}"`), `missing data-view=${v}`);
});
test('nav targets: the base set + workspaces + projects (workspace-create is NOT a nav target)', () => {
  for (const v of ['new', 'running', 'history', 'composer', 'workspaces', 'projects', 'settings'])
    assert.ok(html.includes(`data-nav="${v}"`), `missing data-nav=${v}`);
  // workspace-create is reached via location.hash only — no nav link.
  assert.ok(!html.includes('data-nav="workspace-create"'), 'workspace-create must not be a nav target');
});
test('shell hooks present (base + workspace surfaces)', () => {
  for (const id of [
    'run-card-tpl', 'hist-card-tpl', 'run-list', 'nav-running-count', 'nav-history-count', 'ws-dot',
    'nav-workspaces-count', 'ws-card-tpl', 'ws-list', 'target-seg', 'target-project-pane',
    'target-workspace-pane', 'workspaceSelect', 'ws-members', 'wiz-close', 'wiz-abort', 'wiz-desc',
  ])
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});
test('run-card template: 6 steps + qpanel + stop', () => {
  const m = html.match(/<template id="run-card-tpl">([\s\S]*?)<\/template>/);
  assert.ok(m, 'missing run-card-tpl');
  const tpl = m[1];
  // The pipeline graph is JS-built: the template carries only the empty
  // .run-flow-wrap > .run-flow container the run/history graph renders into.
  assert.ok(/class="run-flow-wrap"><div class="run-flow"><\/div><\/div>/.test(tpl), 'tpl missing empty .run-flow container');
  assert.ok(!tpl.includes('data-step'), 'tpl should no longer carry static data-step stages');
  assert.ok(tpl.includes('qpanel'), 'tpl missing qpanel slot');
  assert.ok(tpl.includes('btn-stop'), 'tpl missing btn-stop');
});
test('scan loader carries role=status + aria-live=polite (A11y)', () => {
  const m = html.match(/class="ws-loader"[^>]*>/);
  assert.ok(m, 'missing .ws-loader');
  assert.match(m[0], /role="status"/, '.ws-loader missing role="status"');
  assert.match(m[0], /aria-live="polite"/, '.ws-loader missing aria-live="polite"');
});
test('old shell removed', () => {
  assert.ok(!html.includes('class="layout"'), 'old .layout present');
  assert.ok(!html.includes('<ol id="steps"'), 'old #steps present');
});
