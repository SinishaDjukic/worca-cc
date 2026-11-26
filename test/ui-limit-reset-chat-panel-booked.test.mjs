// test/ui-limit-reset-chat-panel-booked.test.mjs — the Chat panel test of test/ui-limit-reset.test.mjs where a resume
// already booked keeps "Resume at" out of the Resume menu once the schedules load.
// It needs an app that has never loaded the schedules (Chat is the boot view, no Runs view loaded them), which only a
// freshly loaded app is, so it has an app of its own (test/helpers/shared-app-boot.mjs), with the fetch router of
// test/ui-limit-reset.test.mjs.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const PROJECT = '/tmp/proj-limit-reset';

const MIN = 60_000;
const DETAIL_TEXT = 'Claude hit its session limit';

/** Mutable server state the fetch router reads. */
function makeServer() {
  return { tickets: [], settings: { resumeAfterUsageLimit: false }, resumeStatus: 200, posts: [], deletes: [] };
}

// The fetch router over the test's server state (boot() swaps it in); the file's answers, at the boot and after.
let server = makeServer();
const json = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
function route(url, opts = {}) {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  if (u.includes('/api/schedules/resume')) {
    const body = JSON.parse(opts.body);
    server.posts.push(body);
    if (server.resumeStatus !== 200 && server.resumeStatus !== 202) return json({ error: 'boom' }, server.resumeStatus);
    return json({ runId: 'ticket-1', status: 'scheduled', scheduledFor: body.scheduledFor, resumePipelineId: body.pipelineId }, 202);
  }
  if (u.includes('/api/schedules/') && method === 'DELETE') {
    server.deletes.push(u);
    return json({ ok: true });
  }
  if (u.includes('/api/schedules')) {
    return json({ schedules: [], tickets: server.tickets, counts: {}, defaults: { ifMissed: 'run', graceMin: 360, maxFailures: 3 } });
  }
  if (u.includes('/api/settings') && method === 'POST') {
    server.posts.push({ settings: JSON.parse(opts.body) });
    return json({ ...server.settings, ...JSON.parse(opts.body) });
  }
  if (u.includes('/api/settings')) return json(server.settings);
  if (u.includes('/api/resume')) return json({ ok: true, runId: 'r-new', pipelineId: 'pl_1' });
  if (u.includes('/api/projects')) return json({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
  return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
}
const app = useSharedApp({ before, beforeEach, after }, { fetchHandler: route });

// The one shared app, reset to the test's UI level and server state.
async function boot({ level, server: state = makeServer() } = {}) {
  server = state;
  await app.fresh(level ? { level } : {});
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window: app.window, doc: app.document, recv: app.recv, settle, go: app.go, fetchCalls: app.calls, server };
}

const iso = (ms) => new Date(ms).toISOString();
const ticket = (over = {}) => ({ id: 'ticket-9', runAt: iso(Date.now() + 3 * 60 * MIN), status: 'scheduled', resumePipelineId: 'pl_1', scheduleId: null, ...over });

/** A usage-limit-paused run is open in the Chat run panel. Chat is the boot view: no Runs view loaded the schedules. */
async function pausedPanel(ctx, { limitResetAt }) {
  const { doc, recv, settle, go } = ctx;
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }] });
  await settle();
  recv({ type: 'done', runId: 'r1', status: 'paused', reason: 'usage_limit', detail: DETAIL_TEXT, limitEngine: 'claude', limitResetAt });
  await settle(8);
  assert.equal(ctx.fetchCalls.some((c) => c.url.split('?')[0].endsWith('/api/schedules')), false, 'nothing loaded the schedules yet');
  go('chat/new/run/r1');
  await settle(10);
  const screen = doc.querySelector('[data-chat-panel] .crp-host > .rd');
  assert.ok(screen, 'the run is open in the Chat panel');
  return screen;
}

test('Chat panel: a resume already booked keeps "Resume at" out of the Resume menu once the schedules load', async () => {
  const server = makeServer();
  server.tickets = [ticket()];
  const ctx = await boot({ level: 'advanced', server });
  const screen = await pausedPanel(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  assert.equal(screen.querySelector('.rd-resume-limit').hidden, true, 'C: the booked ticket hides the item');
});
