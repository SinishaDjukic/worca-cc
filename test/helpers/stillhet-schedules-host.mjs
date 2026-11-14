// test/helpers/stillhet-schedules-host.mjs — the live Schedules page host the stillhet-schedules-{actions,delete,tickets}-host
// test files share. The cases are split in three files: every file runs in its own process, so one file's jsdom windows
// (never freed while the process lives) cannot slow the next case past CI's 300 s per file.
import { liveHost, go, settle, clone, SOURCES, THREAD, posts } from './stillhet-chat-live-host.mjs';

export const toastText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).filter(Boolean).join(' | ');
export const RULE = { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' };
export function sources(over = {}) {
  const s = clone(SOURCES);
  s.schedules.schedules[0] = { ...s.schedules.schedules[0], rule: RULE, overlap: 'skip', maxFailures: 3, ifMissed: 'run', tz: 'UTC', ...over };
  return s;
}
// GET /api/schedules/:id: a series' fires; sr1's newest fire is run-b, still running (its ticket id is its run id)
export const HISTORY = { sr1: [{ id: 'run-b', status: 'fired', pipelineId: 'pb', runAt: new Date(2026, 10, 12, 14, 20).toISOString(), title: 'Nightly' }, { id: 'tk8', status: 'failed', runAt: new Date(2026, 10, 11, 2).toISOString(), failReason: 'the project folder is gone', title: 'Nightly' }] };
const read = (history) => (u) => { const m = /^\/api\/schedules\/([\w-]+)$/.exec(u); return m ? [200, { kind: 'recurring', item: { id: m[1] }, history: history[m[1]] || [], notifications: [] }] : null; };
export const sent = (calls) => posts(calls).filter(([, u]) => /^\/api\/(schedules|stop|run)\b/.test(u));
// a thread whose proposal card dev flipped to `scheduled` for `scheduleId` (POST /api/run with askCardId): its Chat card
export function scheduledThread(scheduleId) {
  const t = clone(THREAD);
  t.messages.push({ id: 'm9', role: 'assistant', text: 'Scheduled.', status: 'done', createdAt: new Date(2026, 10, 12, 13, 10).toISOString(), blocks: [{ kind: 'card', id: `card_${scheduleId}`, state: 'scheduled', card: { title: scheduleId, scheduleId } }] });
  return t;
}
export async function page(id, { src = sources(), write = () => [200, { ok: true }], history = {}, beforeScripts, thread } = {}) {
  const h = await liveHost({ sources: src, read: read(history), write, ...(beforeScripts ? { beforeScripts } : {}), ...(thread ? { thread: () => [200, thread] } : {}) });
  await go(h.w, `#schedule/${id}`, 150); await settle(300);
  h.src = src;
  h.frame = async (f) => { h.sockets.at(-1).onmessage({ data: JSON.stringify(f) }); await settle(400); };
  return h;
}
export const head = (d) => ['.place-head', '.convo-card-line'].map((q) => d.querySelector(`#route-schedule ${q}`)?.textContent || '').join(' · ');
export const more = async (d, v) => { d.querySelector('#route-schedule [data-menu="sc-more"]').click(); await settle(5); d.querySelector(`#route-schedule [data-menu-pick="sc-more|${v}"]`).click(); await settle(80); };
