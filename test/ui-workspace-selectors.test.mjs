// test/ui-workspace-selectors.test.mjs
// Static-string guard: the IDs/classes the workspace JS in app.js addresses MUST
// exist in index.html, and the markup the JS depends on (templates, panes, the
// segmented control + hidden radios) is present. This catches a markup/selector
// drift that the jsdom behavior tests would otherwise only surface indirectly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const js = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');

// IDs the el{} cache + the wizard/management/target code query by #id.
const IDS = [
  'nav-workspaces-count',
  'target-seg', 'target-project-pane', 'target-workspace-pane', 'workspaceSelect', 'ws-members',
  'sourceBranchHint',
  'sourceBranchWrap', 'ws-source-branches',
  'ws-create-btn', 'ws-msg', 'ws-list', 'ws-card-tpl',
  'wiz-name', 'wiz-projects', 'wiz-step1-hint', 'wiz-start-scan', 'wiz-status', 'wiz-progress',
  'wiz-phases', 'wiz-abort', 'wiz-desc', 'wiz-graphify-note', 'wiz-msg', 'wiz-rescan', 'wiz-save',
  'wiz-close', 'wiz-title',
  'wiz-step-1', 'wiz-step-2', 'wiz-step-3',
];

test('every workspace #id the JS addresses exists in index.html', () => {
  for (const id of IDS) assert.ok(html.includes(`id="${id}"`), `markup missing #${id}`);
});

test('ws-card template carries the classes buildWorkspaceCard/delegation use', () => {
  const m = html.match(/<template id="ws-card-tpl">([\s\S]*?)<\/template>/);
  assert.ok(m, 'missing ws-card-tpl template');
  const tpl = m[1];
  for (const cls of [
    'ws-head', 'ws-name', 'ws-projects', 'ws-stale', 'ws-edit', 'ws-rescan', 'ws-delete',
    'ws-detail', 'ws-desc-view', 'ws-desc-edit', 'ws-desc-input', 'ws-desc-save', 'ws-desc-cancel',
  ])
    assert.ok(tpl.includes(cls), `ws-card-tpl missing .${cls}`);
  // The description view is a <pre> (verbatim markdown; #viewer pattern).
  assert.ok(/class="ws-desc-view viewer"/.test(tpl), 'ws-desc-view should reuse the .viewer <pre> pattern');
});

test('target segmented control uses the .seg button[data-target] + hidden-radio idiom', () => {
  assert.ok(/#target-seg/.test(js) || js.includes("'#target-seg'"), 'JS should query #target-seg');
  assert.ok(html.includes('data-target="project"'), 'missing data-target=project button');
  assert.ok(html.includes('data-target="workspace"'), 'missing data-target=workspace button');
  assert.ok(/<input type="radio" name="target" value="project"[^>]*hidden/.test(html), 'missing hidden project radio');
  assert.ok(/<input type="radio" name="target" value="workspace"[^>]*hidden/.test(html), 'missing hidden workspace radio');
});

test('phase track exposes graph/investigate/synthesize data-phase chips', () => {
  for (const p of ['graph', 'investigate', 'synthesize'])
    assert.ok(html.includes(`data-phase="${p}"`), `missing phase chip ${p}`);
});

test('beginRun is positional with an opts 4th arg (C2), single legacy call site passes {} ', () => {
  assert.match(js, /function beginRun\(runId, projectDir, title, opts = \{\}\)/, 'beginRun must stay positional with opts=4th');
  // The project-mode call site passes {} (byte-identical project behavior).
  assert.match(js, /beginRun\(data\.runId, projectDir, title,\s*target === 'workspace' \? \{ workspaceId, workspaceName, projectNames: workspaceProjectNames \} : \{\}\)/);
});

test('VIEW_NAMES is the 11-entry array with composer preserved + projects + plugins (C1)', () => {
  assert.match(js, /const VIEW_NAMES = \['new', 'running', 'history', 'composer', 'workspaces', 'workspace-create', 'agents', 'agent-create', 'projects', 'plugins', 'settings'\];/);
});

test('composer-core is imported INSIDE app.js via ES6 import (C7), not a separate script tag', () => {
  assert.match(js, /import \{[\s\S]*?\} from '\.\/composer-core\.mjs';/);
  assert.ok(!html.includes('composer-core.mjs'), 'composer-core.mjs must not be a <script> in index.html');
});
