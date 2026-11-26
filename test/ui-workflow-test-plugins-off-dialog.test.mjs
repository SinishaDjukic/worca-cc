// test/ui-workflow-test-plugins-off-dialog.test.mjs — workflow tests 3b, Task 12 (board 34, P43, P44): Test a version says what
// Pretend switches off: the person's own plugins, skills and hooks; the project's hooks and plugins; other engines' own setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openTestVersionDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { icon } from '../ui/public/icons.mjs';
import { PLUGINS_OFF_PERSONAL, PLUGINS_OFF_PROJECT, pluginsEngineNoteLine } from '../src/shared/workflow-tests/project-text.mjs';
import { pluginsEngineNoteLine as serverLine } from '../src/core/workflow-tests/connectors.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const sideOf = (use, short) => ({ use, label: short, short, want: 1, reusable: 0, reusableAt: null, perTryUsd: 1, savesUsd: 0 });
function dialog({ projectName = null, connectors = {} } = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const plan = { a: sideOf(2, 'v2'), b: sideOf('draft', 'v3 draft'), examples: 1, tries: 1, perTryMs: null, project: null,
    connectors: { mode: 'pretend', pretend: [], off: [], scripts: [], quickScripts: [], engines: [], personalOff: true, ...connectors } };
  openTestVersionDialog({ doc: window.document, win: window, options: [{ use: 2, label: 'v2' }, { use: 'draft', label: 'v3 draft' }], a: 2, b: 'draft',
    examples: [{ id: 1, name: 'Ticket 482', tries: 1, ready: true, projectName }], dateText: () => '24 Oct',
    loadPlan: async ({ connectors: mode }) => ({ ...plan, connectors: { ...plan.connectors, mode } }), onStart: async () => ({ ok: true }) });
  return { doc: window.document, window };
}

test('the words, the same on server and browser', () => {
  assert.equal(PLUGINS_OFF_PERSONAL, 'Your personal Claude Code plugins, skills and hooks are switched off.');
  assert.equal(PLUGINS_OFF_PROJECT, "The project's own instructions stay on. Its hooks and plugins are switched off.");
  assert.equal(pluginsEngineNoteLine('Codex'), "Steps on Codex still use Codex's own plugins and settings. Pretend switches off only Claude Code's.");
  assert.equal(serverLine('Codex'), pluginsEngineNoteLine('Codex'));
  assert.match(icon(new JSDOM('').window.document, 'off', 13).innerHTML, /<circle/);
});

test('board 34: Pretend, no project: the personal line only, with the off icon', async () => {
  const { doc } = dialog();
  await tick(); await tick();
  const lines = texts(doc, '.wft-conn-notes li');
  assert.ok(lines.includes(PLUGINS_OFF_PERSONAL));
  assert.ok(!lines.includes(PLUGINS_OFF_PROJECT));
  const li = [...doc.querySelectorAll('.wft-conn-notes li')].find((x) => x.textContent === PLUGINS_OFF_PERSONAL);
  assert.ok(li.querySelector('svg'));
});

test('board 34: Pretend with a project example: both lines, in order; another engine adds its line; Real shows none', async () => {
  const { doc, window } = dialog({ projectName: 'worca-cc', connectors: { engines: ['Codex'] } });
  await tick(); await tick();
  const lines = texts(doc, '.wft-conn-notes li');
  const i = lines.indexOf(PLUGINS_OFF_PERSONAL);
  assert.ok(i >= 0);
  assert.equal(lines[i + 1], PLUGINS_OFF_PROJECT);
  assert.ok(lines.includes(pluginsEngineNoteLine('Codex')));
  const real = doc.querySelector('#wft-tv-conn-real');
  real.checked = true;
  real.dispatchEvent(new window.Event('change'));
  await tick(); await tick();
  assert.ok(!texts(doc, '.wft-conn-notes li').some((t) => t === PLUGINS_OFF_PERSONAL || t === PLUGINS_OFF_PROJECT));
});

test('board 34: Pretend, but no step on Claude Code: no personal line', async () => {
  const { doc } = dialog({ connectors: { personalOff: false, engines: ['Codex'] } });
  await tick(); await tick();
  assert.ok(!texts(doc, '.wft-conn-notes li').includes(PLUGINS_OFF_PERSONAL));
});
