// test/ui-exec-env-panel.test.mjs — the project page's sandbox environment panel (ui/public/exec-env-project-view.mjs)
// and the "Runs in" picker list (ui/public/exec-envs.mjs), under jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountExecEnvPanel } from '../ui/public/exec-env-project-view.mjs';
import { loadExecEnvs, fillExecEnvSelect, setExecEnvSelectValue, setExecEnvListForTests, execEnvLabel, execEnvTitle } from '../ui/public/exec-envs.mjs';

const VIEW = (over = {}) => ({ projectKey: 'proj-1', spec: { version: 1, tools: [{ name: 'node', version: '24.21.0' }], apt: [], hash: 'sha256:a' },
  backends: [{ name: 'e2b', label: 'E2B sandbox', title: 'E2B', environmentNoun: 'template', canBuild: true, buildName: 'worca-agent-proj-1',
    fields: [{ key: 'template', label: 'E2B template', hint: 'h', value: null }],
    effective: { name: 'worca-agent', source: 'default', from: 'the default' }, build: null, stale: null, elsewhere: null, job: null, ...over }] });

const tick = () => new Promise((r) => setTimeout(r, 0));
function harness(view, { onPatch = (b) => view } = {}) {
  const { window } = new JSDOM('<!doctype html><div id="host"></div>');
  const calls = []; const polls = [];
  const fetchFn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase(); const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), method, body });
    const data = method === 'PATCH' ? onPatch(body) : method === 'POST' ? { job: { id: 'envb_1', state: 'running' } } : view;
    return { ok: true, status: method === 'POST' ? 202 : 200, json: async () => data };
  };
  const host = window.document.getElementById('host');
  const panel = mountExecEnvPanel(host, { projectKey: 'proj-1', fetchFn,
    schedule: (f) => { polls.push(f); return f; }, cancel: (t) => { const i = polls.indexOf(t); if (i >= 0) polls.splice(i, 1); } });
  return { host, calls, polls, panel };
}

test('shows the template in use, the read-only spec and Build; Save PATCHes only the fields', async () => {
  const { host, calls } = harness(VIEW());
  for (let i = 0; i < 3; i++) await tick();
  const input = host.querySelector('[data-backend="e2b"] .exec-env-field');
  assert.equal(input.placeholder, 'worca-agent (the default)');
  assert.match(host.querySelector('.exec-env-spec pre').textContent, /24\.21\.0/);
  assert.equal(host.querySelector('.exec-env-build').textContent, 'Build environment');
  assert.equal(host.querySelector('.exec-env-build').disabled, false);
  input.value = 'mine';
  host.querySelector('.exec-env-save').click();
  for (let i = 0; i < 3; i++) await tick();
  assert.deepEqual(calls.at(-1), { url: '/api/projects/proj-1/exec-env/config', method: 'PATCH', body: { backend: 'e2b', values: { template: 'mine' } } });
});

test('a stale build says why and offers Rebuild; a running job disables the button and polls', async () => {
  const build = { name: 'worca-agent-proj-1', builtAt: '2026-10-18T10:00:00.000Z', buildId: 'b1' };
  let h = harness(VIEW({ build, stale: { stale: true, reasons: ['the environment spec changed since the build'] } }));
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(h.host.querySelector('.exec-env-build').textContent, 'Rebuild environment');
  assert.match(h.host.querySelector('.exec-env-build-status').textContent, /Out of date: the environment spec changed/);
  h = harness(VIEW({ build, job: { id: 'envb_1', state: 'running', tail: ['step 1'] } }));
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(h.host.querySelector('.exec-env-build').disabled, true);
  assert.equal(h.host.querySelector('.exec-env-log').textContent, 'step 1');
  assert.equal(h.polls.length, 1, 'a running build is polled');
  h.panel.stop();
  assert.equal(h.polls.length, 0, 'stop() cancels the pending poll');
  const calls = h.calls.length; await h.panel.reload();
  assert.equal(h.calls.length, calls, 'a stopped panel fetches nothing');
});

test('a build made on another E2B server says so and offers Rebuild', async () => {
  const build = { name: 'worca-agent-proj-1', builtAt: '2026-10-18T10:00:00.000Z', buildId: 'b1' };
  const h = harness(VIEW({ build, elsewhere: { builtOn: 'http://localhost:3000 (key e2b_…key1)', here: 'http://localhost:3000 (key e2b_…ey99)' } }));
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(h.host.querySelector('.exec-env-build').textContent, 'Rebuild environment');
  assert.match(h.host.querySelector('.exec-env-build-status').textContent,
    /^Built worca-agent-proj-1 on another E2B server \(http:\/\/localhost:3000 \(key e2b_…key1\)\) — Rebuild for this server \(http:\/\/localhost:3000 \(key e2b_…ey99\)\)\. Runs use worca-agent until then\.$/);
});

test('a failed build says the previous template stays in use; no spec disables Build and names the CLI', async () => {
  let h = harness(VIEW({ job: { id: 'envb_2', state: 'error', error: 'boom', tail: [] } }));
  for (let i = 0; i < 3; i++) await tick();
  assert.match(h.host.querySelector('.exec-env-build-status').textContent, /Last build failed: boom\. The previous template stays in use\./);
  h = harness({ ...VIEW(), spec: null });
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(h.host.querySelector('.exec-env-build').disabled, true);
  assert.match(h.host.querySelector('.exec-env-spec-missing').textContent, /worca exec-env spec --project proj-1 --set spec\.json/);
});

test('fillExecEnvSelect lists registered backends and keeps a listed value; unknown names fall back', async () => {
  const { window } = new JSDOM('<!doctype html><select id="s"><option value="e2b">E2B sandbox</option></select>');
  const select = window.document.getElementById('s'); select.value = 'e2b';
  await loadExecEnvs(async () => ({ ok: true, json: async () => ({ execEnvs: [{ name: 'local', label: 'Local' }, { name: 'e2b', label: 'E2B sandbox', title: 'E2B' }, { name: 'daytona', label: 'Daytona sandbox', title: 'Daytona' }] }) }));
  fillExecEnvSelect(select);
  assert.deepEqual([...select.options].map((o) => o.value), ['local', 'e2b', 'daytona']);
  assert.equal(select.value, 'e2b');
  const other = window.document.createElement('select'); other.dataset.want = 'nope';
  fillExecEnvSelect(other);
  assert.equal(other.value, 'local', 'an unlisted name falls back to Local');
  assert.equal(execEnvLabel('daytona'), 'Daytona sandbox'); assert.equal(execEnvTitle('e2b'), 'E2B'); assert.equal(execEnvLabel('nope'), 'nope');
});

test('a saved backend painted before the list arrives survives the fill (no silent clear on Save)', async () => {
  const { window } = new JSDOM('<!doctype html><select id="s"><option value="local">Local</option><option value="e2b">E2B sandbox</option></select>');
  const select = window.document.getElementById('s');
  setExecEnvListForTests(null);                          // back to the Local + E2B fallback
  setExecEnvSelectValue(select, 'modal');                // the saved default names a backend not listed yet
  assert.equal(select.value, 'local');                   // displayed as Local until the list arrives …
  await loadExecEnvs(async () => ({ ok: true, json: async () => ({ execEnvs: [{ name: 'local', label: 'Local' }, { name: 'modal', label: 'Modal sandbox' }] }) }));
  fillExecEnvSelect(select);
  assert.equal(select.value, 'modal');                   // … then shown, so a Save sends 'modal', not null
});
