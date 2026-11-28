// test/ui-chat-role-setting-app-flag-off.test.mjs — the flag-off test of test/ui-chat-role-setting-app.test.mjs: an
// app loaded with shaperSmallRuns off never asks for the saved role. The flag is read when the app loads and the
// record below starts at that load, so this test has an app of its own (test/helpers/shared-app-boot.mjs).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// Every /api/answerer request since the app loaded.
const answerer = [];
const app = useSharedApp({ before, beforeEach, after }, {
  url: 'http://localhost:4317/#settings/ask',
  flags: { shaperSmallRuns: false },
  fetchHandler: (u, opts) => {
    const path = u.split('?')[0];
    if (path === '/api/answerer') { answerer.push((opts.method || 'GET').toUpperCase()); return ok({ lead: 'compliance' }); }
    if (path.endsWith('/api/history')) return ok({ pipelines: [], ghAvailable: false });
    if (path.includes('/api/ask/')) return ok({ threads: [] });
    return null;
  },
});

test('R-arch-1 in the app: flag off, Settings › Chat has an empty Your role host and makes no /api/answerer request', async () => {
  app.go('settings/general'); await app.settle(8);
  app.go('settings/ask'); await app.settle(12);
  const host = app.document.getElementById('chatRoleHost');
  assert.ok(host, '#chatRoleHost');
  assert.equal(host.childNodes.length, 0);
  assert.deepEqual(answerer, []);
});
