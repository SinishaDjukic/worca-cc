// test/ui-run-presets-save.test.mjs — Save setup as preset on a run's page (ui/public/run-presets-save.mjs + app.js):
// the scope options, the request body, and the button shown only with the flag on and a stored setup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPresetScopeOptions, runPresetRequest, runPresetErrorText } from '../ui/public/run-presets-save.mjs';
import { bootApp } from './helpers/run-page-boot.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

test('scope options: the run\'s own target first (the default), then Any project', () => {
  assert.deepEqual(runPresetScopeOptions({ projectKey: 'api-1' }, { 'project:api-1': 'api' }),
    [{ value: 'project', text: 'Only api' }, { value: 'global', text: 'Any project' }]);
  assert.deepEqual(runPresetScopeOptions({ target: 'workspace', workspaceId: 'wks-x', workspaceName: 'Platform', projectKey: 'api-1' }).map((o) => o.text),
    ['Only workspace Platform', 'Any project']);
  assert.deepEqual(runPresetScopeOptions(null), [{ value: 'global', text: 'Any project' }]);
});

test('the request names only the scope kind and a trimmed name', () => {
  assert.deepEqual(runPresetRequest('  Quick fix ', 'project'), { name: 'Quick fix', scope: { kind: 'project' } });
  assert.deepEqual(runPresetRequest('x', 'elsewhere'), { name: 'x', scope: { kind: 'global' } });
});

test('error text: duplicate and no-setup have their own words; anything else is the server message', () => {
  assert.equal(runPresetErrorText(409, { error: 'a preset with this name already exists' }), 'A preset with this name already exists');
  assert.equal(runPresetErrorText(409, { code: 'no-run-setup', error: 'x' }), 'This run started before Worca kept run setups, so there is nothing to save');
  assert.equal(runPresetErrorText(400, { error: 'name is required' }), 'name is required');
  assert.equal(runPresetErrorText(500, null), 'HTTP 500');
});

// The app-level part boots the app on a history run page: the button's visibility depends on setupHdActions, the flag
// and a fetch together.
const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const DETAIL = (id) => ({ state: { id, title: 'Fix login', status: 'done', projectKey: 'k1', projectDir: '/tmp/p', startedAt: '2026-10-10T10:00:00.000Z', steps: [], subAgents: [], tags: [] }, artifacts: [] });

let offPrev = null;
async function openRun({ setup, flag = true }) {
  if (offPrev) offPrev();   // flags.mjs's listener map is shared across boots: drop the previous app's subscription
  const posted = [];
  const ctx = await bootApp({ fetchHandler: (url, opts = {}) => {
    if (url === '/api/history/k1/aaaa0001' || url.startsWith('/api/history/k1/aaaa0001?')) return ok(DETAIL('aaaa0001'));
    if (url === '/api/pipelines/aaaa0001/setup') return ok({ setup, target: { kind: 'project', ref: 'k1' } });
    if (url === '/api/pipelines/aaaa0001/preset') { posted.push(JSON.parse(opts.body)); return ok({ preset: { id: 'rp_aaaaaaaaaaaa', name: 'From run', scope: { kind: 'project', ref: 'k1' }, setup } }, 201); }
    if (url === '/api/presets') return ok({ presets: [] });
    if (url === '/api/projects') return ok({ projects: [{ name: 'p', key: 'k1', path: '/tmp/p', exists: true }] });
    return null;
  } });
  offPrev = ctx.window.__np && ctx.window.__np.offPresetsFlag;
  const doc = ctx.window.document;
  applyFlags({ runPresets: flag }, doc);
  ctx.go('history/k1/aaaa0001');
  await ctx.settle(8);
  return { ctx, doc, posted, btn: () => doc.querySelector('.hd-save-preset') };
}

test('the button shows for a run with a stored setup and saves with the run\'s project scope', async () => {
  const { ctx, doc, posted, btn } = await openRun({ setup: { workflowId: 'wf_default' } });
  assert.equal(btn().hidden, false);
  btn().click();
  await ctx.settle(2);
  assert.equal(doc.getElementById('confirm-f-scope').value, 'project', 'the run\'s own project is the default scope');
  const name = doc.getElementById('confirm-f-name');
  name.value = 'From run';
  name.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));   // `required` keeps OK disabled until input
  doc.getElementById('confirm-ok').click();
  await ctx.settle(4);
  assert.deepEqual(posted, [{ name: 'From run', scope: { kind: 'project' } }]);
});

test('a pre-migration run (setup null) and the flag off both leave the button hidden', async () => {
  assert.equal((await openRun({ setup: null })).btn().hidden, true);
  assert.equal((await openRun({ setup: { workflowId: 'wf_default' }, flag: false })).btn().hidden, true);
});

test('the run page button reads "Save as preset" (A14: 1–3 words, verb first); the tooltip keeps the long form', async () => {
  const { btn } = await openRun({ setup: { workflowId: 'wf_default' } });
  const b = btn();
  assert.equal(b.hidden, false);
  assert.equal(b.querySelector('.hd-btn-label').textContent, 'Save as preset');
  assert.equal(b.getAttribute('aria-label'), 'Save as preset');
  assert.equal(b.title, "Save this run's setup as a run preset");
});
