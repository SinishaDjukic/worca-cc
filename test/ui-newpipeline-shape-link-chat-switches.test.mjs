// test/ui-newpipeline-shape-link-chat-switches.test.mjs — the test of test/ui-newpipeline-shape-link.test.mjs that
// needs the Chat home's switches (the chat settings and the task sources) as app.js fetched them when it loaded: a
// hello while home is open re-pushes them without re-fetching. They are fetched once per app, so this test lives in its
// own file, booted with them (test/helpers/shared-app-boot.mjs).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn } from './helpers/run-page-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

function arms({ settings = { chat: { scriptTools: true } }, sources = [] } = {}) {
  return (url, opts) => {
    const method = String(opts.method || 'GET').toUpperCase();
    const path = url.split('?')[0];
    if (method !== 'GET') return null;
    if (url === '/api/history') return ok({ pipelines: [], ghAvailable: false, prHosts: {} });
    if (url.startsWith('/api/ask/threads?limit=')) return ok({ threads: [], total: 0 });
    if (url === '/api/settings') return ok(settings);
    if (url === '/api/sources') return ok({ sources });
    if (path.endsWith('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }] });
    if (path.endsWith('/api/config')) return ok({ config: { steps: {}, customModels: [], activeWorkflowId: 'wf_default' }, models: [], efforts: [] });
    if (path.endsWith('/api/guardrails')) return ok({ guardrails: [{ id: 'normal', name: 'Normal' }] });
    if (path.endsWith('/api/branches')) return ok({ branches: ['main'], current: 'main' });
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] });
    return null;
  };
}
const SWITCHES = { settings: { chat: { scriptTools: false } }, sources: [{ type: 'plugin', plugin: 'jira', sourceId: 'issues' }] };
const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: arms(SWITCHES) });
const bootApp = runPageOn(app);

async function boot(o = {}) {
  const ctx = await bootApp({ fetchHandler: arms(o) });
  ctx.wsBox.ws.dispatch('open', {});
  return ctx;
}
const hello = (ctx) => ctx.dispatch({ type: 'hello', runs: [] });

test('Chat home: the shape tile shows at once, and a hello while home is open re-pushes the switches without re-fetching them', async () => {
  const ctx = await boot(SWITCHES);
  ctx.go('chat/new');
  await ctx.settle(8);
  const doc = ctx.window.document;
  const tile = (id) => doc.querySelector(`.chat-home-act[data-intent="${id}"]`);
  assert.equal(tile('shape').hidden, false, 'Shaper is always on');
  assert.equal(tile('script').hidden, true, 'scriptTools:false');
  const switches = () => ctx.calls.filter((c) => c.url === '/api/settings' || c.url === '/api/sources').length;
  const before = switches();
  hello(ctx);
  await ctx.settle(6);
  assert.equal(tile('shape').hidden, false, 'still there after the hello');
  assert.equal(switches(), before, 'flags re-pushed, not re-fetched');
  assert.equal(tile('script').hidden, true, 'scripts kept its state');
  doc.querySelector('.chat-home-act.is-more').click();
  assert.ok([...doc.querySelectorAll('.wfv-menu .wfv-menu-l')].some((n) => n.textContent === 'Find tasks'), 'tasks kept its state');
});
