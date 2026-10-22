// test/schedules-view-notify.test.mjs — #555 §7.1: the Schedules view reports a series action's
// result through `deps.notify`: an ok toast titled by the action, an err toast on failure.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#schedules' });
for (const k of ['document', 'location', 'DOMParser']) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
const { createSchedulesView } = await import('../ui/public/schedules-view.mjs');
const { UNREACHABLE_DETAIL } = await import('../ui/public/action-errors.mjs');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const SOON = new Date(Date.now() + 3600_000).toISOString();
const summary = { target: 'project', workflowId: 'wf_default', prompt: 'p', source: null, sourceBranch: null, mock: false };
const SERIES = { id: 'sch_1', kind: 'recurring', title: 'Nightly', rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' }, sentence: 'Every day at 02:00',
  tz: 'UTC', overlap: 'skip', maxFailures: 3, failureStreak: 0, ifMissed: 'run', graceMin: 360, status: 'active', pauseReason: null, nextRunAt: SOON, lastResult: null, summary };
const TICKET = { id: 't_1', kind: 'once', scheduleId: null, title: 'Upgrade', runAt: SOON, scheduledFor: SOON, status: 'scheduled', ifMissed: 'run', graceMin: 360, summary };

function mount({ routes = {} } = {}) {
  const calls = [];
  const toasts = [];
  globalThis.fetch = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${String(url).split('?')[0]}`;
    calls.push(key);
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (routes[key] === 'offline') throw new TypeError('Failed to fetch');
    if (Object.hasOwn(routes, key)) return json(...routes[key]);
    if (key === 'GET /api/schedules') return json(200, { schedules: [SERIES], tickets: [TICKET], counts: {} });
    if (key === 'GET /api/notifications') return json(200, { notifications: [], unread: 0 });
    if (key === 'GET /api/schedules/dependents') return json(200, { dependents: [] });
    if (key.endsWith('/run-now')) return json(200, { status: 'queued' });
    return json(200, {});
  };
  const hosts = { feedHost: document.createElement('div'), onceHost: document.createElement('div'), repeatingHost: document.createElement('div') };
  const msgEl = document.createElement('p');
  document.body.replaceChildren(hosts.feedHost, hosts.onceHost, hosts.repeatingHost, msgEl);
  const deps = { confirmModal: async () => true, targetLabel: () => '', workflowLabel: () => '', notify: (o) => toasts.push(o) };
  const view = createSchedulesView({ ...hosts, msgEl, deps });
  return { view, toasts, msgEl, calls, ...hosts };
}
const btn = (host, text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

test('series actions toast their okText; a failed action is an err toast', async () => {
  await checkRows([
    { name: 'series actions toast their okText: Paused, Run started, Next run skipped, Schedule deleted', run: async () => {
      const m = mount();
      await m.view.load();
      m.repeatingHost.querySelector('.switch').click();
      await settle();
      btn(m.repeatingHost, 'Run now').click();
      await settle();
      btn(m.repeatingHost, 'Skip next').click();
      await settle();
      btn(m.repeatingHost, 'Delete').click();
      await settle();
      assert.deepEqual(m.toasts, ['Paused', 'Run started', 'Next run skipped', 'Schedule deleted'].map((title) => ({ tone: 'ok', title, detail: '' })));
      assert.equal(m.msgEl.textContent, '');
      m.view.destroy();
    } },
    { name: 'a failed action is an err toast', run: async () => {
      const m = mount({ routes: { 'POST /api/schedules/sch_1/skip-next': [409, { error: 'nothing to skip' }] } });
      await m.view.load();
      btn(m.repeatingHost, 'Skip next').click();
      await settle();
      assert.deepEqual(m.toasts, [{ tone: 'err', title: 'nothing to skip', detail: '' }]);
      assert.equal(m.msgEl.textContent, '');
      m.view.destroy();
    } },
  ]);
});

test('a waiting run\'s Cancel and Run now failures say what failed and the next step (D8)', async () => {
  await checkRows([
    { name: 'Cancel with the server unreachable', run: async () => {
      const m = mount({ routes: { 'DELETE /api/schedules/t_1': 'offline' } });
      await m.view.load();
      btn(m.onceHost, 'Cancel').click();
      await settle();
      assert.deepEqual(m.toasts, [{ tone: 'err', title: 'Could not cancel the waiting run', detail: UNREACHABLE_DETAIL }]);
      assert.equal(m.msgEl.textContent, '');
      m.view.destroy();
    } },
    { name: 'Run now answered 404', run: async () => {
      const m = mount({ routes: { 'POST /api/schedules/t_1/run-now': [404, { error: 'no such ticket' }] } });
      await m.view.load();
      btn(m.onceHost, 'Run now').click();
      await settle();
      assert.deepEqual(m.toasts, [{ tone: 'err', title: 'Could not start the run now', detail: 'no such ticket. Reload the list to see what is there now.' }]);
      m.view.destroy();
    } },
    { name: 'a repeating schedule\'s Run now with the server unreachable', run: async () => {
      const m = mount({ routes: { 'POST /api/schedules/sch_1/run-now': 'offline' } });
      await m.view.load();
      btn(m.repeatingHost, 'Run now').click();
      await settle();
      assert.deepEqual(m.toasts, [{ tone: 'err', title: 'Could not start the run now', detail: UNREACHABLE_DETAIL }]);
      assert.equal(m.msgEl.textContent, '');
      m.view.destroy();
    } },
    { name: 'a missed run\'s Run now in the feed with the server unreachable', run: async () => {
      const missed = { ...TICKET, id: 't_m', status: 'missed' };
      const m = mount({ routes: {
        'GET /api/schedules': [200, { schedules: [], tickets: [missed], counts: {} }],
        'GET /api/notifications': [200, { notifications: [{ id: 'n_1', kind: 'missed', ticketId: 't_m', scheduleId: null, at: SOON, title: 'Upgrade', resolvedAt: null }], unread: 1 }],
        'POST /api/schedules/t_m/run-now': 'offline',
      } });
      await m.view.load();
      btn(m.feedHost, 'Run now').click();
      await settle();
      assert.deepEqual(m.toasts, [{ tone: 'err', title: 'Could not start the run now', detail: UNREACHABLE_DETAIL }]);
      m.view.destroy();
    } },
  ]);
});
