// test/ui-chat-home-app-cold-history.test.mjs — the cold-boot test of test/ui-chat-home-app.test.mjs where the hello
// alone does not settle the home's tab: a paused History row still on its way wins over the chats. The app counts its
// runs as known once its first hello and its first History answer are in, which happens once per app, so this test has
// an app of its own (test/helpers/shared-app-boot.mjs) whose first History load waits for the test.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn } from './helpers/run-page-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { RUNS_TICK_MS } from '../ui/public/chat/home.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
// GET /api/history rows as src/core/artifacts.mjs listAllPipelines builds them (a workspace row has no workspaceId).
const HROW = (o) => ({ id: 'aaaa0001', title: 'T', status: 'done', startedAt: '2026-10-10T10:00:00.000Z', pauseReason: null, runEngine: 'claude',
  totalCostUsd: 0.5, totalActiveMs: 60000, mtime: Date.parse('2026-10-10T11:00:00.000Z'), projectKey: 'k1', projectName: 'Proj A', projectDir: '/tmp/p', ...o });

// The app loaded on Chat: its first hello (the reset's) asks History, held until the test lets it answer.
const held = [];
const base = arms({ threads: [{ id: 'ask_000000b1', title: 'Old chat', createdAt: 't', updatedAt: '2026-10-11T00:00:00Z', runLinks: 0 }],
  history: [HROW({ id: 'dddd0004', status: 'paused', pauseReason: 'cost_pipeline', title: 'Paused proj' })] });
const heldHistory = (url, opts) => (url === '/api/history'
  ? new Promise((r) => { held.push(() => r(base(url, opts))); })
  : base(url, opts));
const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: heldHistory });
const bootApp = runPageOn(app);

const SITE = { key: 'site-00000001', name: 'site', path: '/w/p/site', displayPath: '/w/p/site', exists: true, vcs: 'none' };
function arms({ history = [], threads = [], settings = { chat: { scriptTools: false } }, sources = [], workflows = [], create = false } = {}) {
  return (url, opts = {}) => {
    if (create && url === '/api/projects/create') {
      const b = JSON.parse(opts.body || '{}');
      if (b.dryRun) return ok({ ok: true, root: '/w/p', rootDisplay: '/w/p' });
      const p = { ...SITE, key: `${b.name}-00000001`, name: b.name, path: `/w/p/${b.name}`, displayPath: `/w/p/${b.name}` };
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ project: p, projects: [p], root: '/w/p', rootDisplay: '/w/p' }) });
    }
    if (url === '/api/history') return ok({ pipelines: history, ghAvailable: false, prHosts: {} });
    if (url.startsWith('/api/ask/threads?limit=')) return ok({ threads, total: threads.length });
    if (url === '/api/settings') return ok(settings);
    if (url === '/api/sources') return ok({ sources });
    if (url === '/api/workflows') return ok({ workflows });
    return null;
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const selected = (doc) => (doc.querySelector('.chat-home-tab[aria-selected="true"]') || { dataset: {} }).dataset.tab || null;

test('a cold boot: the hello alone does not settle the tab — a paused History row still on its way wins over the chats', async () => {
  const ctx = await bootApp({ fetchHandler: heldHistory });
  ctx.go('chat/new');
  await ctx.settle(6);
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
  await wait(RUNS_TICK_MS + 150);                                   // the 1 s re-read ran: the hello is in, History is not
  const doc = ctx.window.document;
  assert.equal(selected(doc), null, 'until History answers, an empty Needs you is "not yet"');
  assert.ok(held.length > 0, 'the first hello asked History');
  for (const go of held) go();
  await ctx.settle(6);
  await wait(RUNS_TICK_MS + 150);
  assert.equal(selected(doc), 'needs');
});
