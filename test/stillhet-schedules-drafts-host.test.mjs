// test/stillhet-schedules-drafts-host.test.mjs — what is left of the schedule page's edits. The page is an inspect view now
// (a change is asked for in its chat), so its draft pickers and their Save are gone; Delete still names the one-offs that wait.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const RULE = { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' };
const toastText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).filter(Boolean).join(' | ');
const sent = (calls) => posts(calls).filter(([, u]) => /^\/api\/schedules\b/.test(u));
async function page({ write = () => [200, { kind: 'recurring', item: {} }], rule = RULE, id = 'sr1', tickets = null, read = () => null } = {}) {
  const src = clone(SOURCES);
  src.schedules.schedules[0] = { ...src.schedules.schedules[0], rule, overlap: 'skip', maxFailures: 3, ifMissed: 'run', graceMin: 360, tz: 'UTC' };
  if (tickets) src.schedules.tickets.push(...tickets);
  const h = await liveHost({ sources: src, write, read });
  await go(h.w, `#schedule/${id}`, 150); await settle(300);
  h.src = src;
  h.pick = async (menu, v) => { h.d.querySelector(`#route-schedule [data-menu="${menu}"]`).click(); await settle(5); h.d.querySelector(`#route-schedule [data-menu-pick="${menu}|${v}"]`).click(); await settle(40); };
  h.bar = () => h.d.querySelector('#route-schedule .draft-bar')?.textContent || '';
  return h;
}

const WAITERS = [
  { id: 'tk_w', kind: 'once', title: 'A waiter', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', createdAt: new Date(2026, 10, 12, 1).toISOString(), after: { kind: 'ticket', id: 'tk2', title: 'Later today', policy: 'done' }, projectKey: 'web-1', projectDir: '/src/web' },
  { id: 'tk3', kind: 'once', title: 'Another one', status: 'scheduled', runAt: new Date(2026, 10, 12, 20).toISOString(), createdAt: new Date(2026, 10, 12, 1).toISOString(), projectKey: 'web-1', projectDir: '/src/web' },
];
// GET /api/schedules/after-candidates for web (ui/routes/scheduled-runs/schedules.mjs): its live runs and open one-offs, tk_w itself among them

test('Delete names the one-offs that wait for it', async () => {
  const { d } = await page({ id: 'tk2', tickets: WAITERS, write: () => [202, { runId: 'tk_new' }] });
  d.querySelector('#route-schedule [data-menu="sc-more"]').click(); await settle(5);
  d.querySelector('#route-schedule [data-menu-pick="sc-more|delete"]').click(); await settle(40);
  assert.match(toastText(d), /^Deleted Later today · “A waiter” was waiting for it/);
});
