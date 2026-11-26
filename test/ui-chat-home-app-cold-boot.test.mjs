// test/ui-chat-home-app-cold-boot.test.mjs — the cold-boot test of test/ui-chat-home-app.test.mjs: on a page just
// loaded onto Chat, the home's default tab waits for the run list, so a run that waits on you wins over the chats. The
// app counts its runs as known once its first hello and its first History answer are in, which happens once per app, so
// this test has an app of its own (test/helpers/shared-app-boot.mjs) whose first History load never answers.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn, helloRun } from './helpers/run-page-boot.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';
import { RUNS_COALESCE_MS } from '../ui/public/chat/home.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const QUESTION = { kind: 'clarify', questions: [{ id: 'q1', text: 'Which?' }] };

// The app loaded on Chat, the run list not known yet: the first hello (the reset's) asked History, which never
// answers here, so the home cannot tell an empty Needs you from "not yet".
const THREADS = [{ id: 'ask_000000b1', title: 'Old chat', createdAt: 't', updatedAt: '2026-10-11T00:00:00Z', runLinks: 0 }];
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: (url, opts) => (url === '/api/history' ? new Promise(() => {}) : arms({ threads: THREADS })(url, opts)),
});
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
const bootChat = async (o = {}) => {
  const ctx = await bootApp({ fetchHandler: arms(o) });
  ctx.go('chat/new');                           // P1: #chat/new is always the home (a bare #chat from another page reopens the last chat)
  await ctx.settle(6);
  return ctx;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const selected = (doc) => (doc.querySelector('.chat-home-tab[aria-selected="true"]') || { dataset: {} }).dataset.tab || null;

test('a cold boot onto Chat: the default tab waits for the run list, so a run that waits on you wins over the chats', async () => {
  const ctx = await bootChat({ threads: THREADS });
  const doc = ctx.window.document;
  assert.equal(selected(doc), null, 'the chats answered first; the runs are not known until the hello');
  helloRun(ctx, { runId: 'r9', title: 'Waits', pendingQuestion: QUESTION });
  await wait(RUNS_COALESCE_MS + 60);
  await ctx.settle(4);
  assert.equal(selected(doc), 'needs');
});
