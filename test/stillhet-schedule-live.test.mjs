// test/stillhet-schedule-live.test.mjs — schedule-live.mjs: each Schedules action sends its one request, a refusal resolves
// {ok:false} with no retry, a double press sends one, detail caches until schedules-changed, Delete waits out its Undo
// window (D4, D8); and no Stillhet file outside live/ names /api/schedules (R-arch-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startScheduleLive, SCHEDULE_ACTIONS } from '../ui/public/stillhet/live/schedule-live.mjs';

function rig(answer = () => [200, { ok: true }]) {
  const calls = [], timers = [], hooks = {};
  const fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url, init.body ? JSON.parse(init.body) : undefined, !!init.keepalive]);
    const [status, data] = await answer(url, init);
    if (status === 0) throw new TypeError('Failed to fetch');
    return { ok: status < 400, status, json: async () => data };
  };
  const live = startScheduleLive({ fetch, setTimeout: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].on = false; }, on: (ev, fn) => { hooks[ev] = fn; } });
  const expire = () => { for (const t of timers) if (t.on) { t.on = false; t.fn(); } };
  return { live, calls, expire, hooks };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const ROWS = {
  run: [{ id: 'sch_1' }, ['POST', '/api/schedules/sch_1/run-now', {}]],
  stop: [{ id: 'sch_1', pipelineId: 'p-9' }, ['POST', '/api/stop', { pipelineId: 'p-9' }]],
  pause: [{ id: 'sch_1' }, ['POST', '/api/schedules/sch_1/pause', {}]],
  resume: [{ id: 'sch_1' }, ['POST', '/api/schedules/sch_1/resume', {}]],
  skip: [{ id: 'sch_1' }, ['POST', '/api/schedules/sch_1/skip-next', {}]],
  keep: [{ id: 'sch_1' }, ['POST', '/api/schedules/sch_1/keep-next', {}]],
  delete: [{ id: 'sch_1' }, ['DELETE', '/api/schedules/sch_1', undefined]],
  save: [{ id: 'sch_1', kind: 'recurring', draft: { every: 'every Monday', at: '09:00', tz: 'UTC', overlap: 'queue' } },
    ['PATCH', '/api/schedules/sch_1', { rule: { freq: 'weekly', interval: 1, time: '09:00', tz: 'UTC', weekdays: ['mo'] }, overlap: 'queue' }]],
  new: [{ projectDir: '/src/web', prompt: 'Lint', title: 'Lint', every: 'every day', at: '02:00', tz: 'UTC' },
    ['POST', '/api/run', { projectDir: '/src/web', prompt: 'Lint', title: 'Lint', repeat: { rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' } } }]],
};

test('each of the 9 actions sends its one request: the table\'s method, URL and body', async () => {
  assert.deepEqual(Object.keys(SCHEDULE_ACTIONS).sort(), Object.keys(ROWS).sort());
  for (const [id, [args, want]] of Object.entries(ROWS)) {
    const { live, calls } = rig();
    const r = await live.act(id, args);
    assert.equal(r.ok, true, id);
    assert.deepEqual(calls.map((c) => c.slice(0, 3)), [want], id);
  }
});

test('a 409 and a network failure resolve {ok:false} with the reason and are never retried', async () => {
  for (const id of Object.keys(ROWS)) {
    const a = rig(() => [409, { error: 'this schedule is paused' }]);
    assert.deepEqual(await a.live.act(id, ROWS[id][0]), { ok: false, status: 409, error: 'this schedule is paused' }, id);
    assert.equal(a.calls.length, 1, id);
    const b = rig(() => [0]);
    assert.deepEqual(await b.live.act(id, ROWS[id][0]), { ok: false, status: 0, error: 'Worca is not answering' }, id);
    assert.equal(b.calls.length, 1, id);
  }
});

test('a double press sends one request; a word with no rule is refused before any request', async () => {
  let release;
  const { live, calls } = rig(() => new Promise((r) => { release = () => r([200, {}]); }));
  const first = live.act('skip', { id: 'sch_1' });
  assert.deepEqual(await live.act('skip', { id: 'sch_1' }), { ok: false, status: 0, error: 'busy' });
  await tick(); release(); await first;
  assert.equal(calls.length, 1);
  const bad = await live.act('save', { id: 'sch_1', kind: 'recurring', draft: { every: 'every fortnight', at: '09:00', tz: 'UTC' } });
  assert.equal(bad.ok, false);
  assert.equal(calls.length, 1);
});

test('detail is read once and again after schedules-changed', async () => {
  const { live, calls } = rig(() => [200, { item: { id: 'sch_1' }, history: [{ id: 't1' }], notifications: [] }]);
  const a = await live.detail('sch_1');
  await live.detail('sch_1');
  assert.deepEqual(a.history, [{ id: 't1' }]);
  assert.equal(calls.length, 1);
  live.frame({ type: 'schedules-changed', action: 'updated' });
  await live.detail('sch_1');
  assert.equal(calls.length, 2);
});

test('deferDelete: undo sends nothing; expiry, the next notice and pagehide each send the one DELETE', async () => {
  let r = rig();
  let h = r.live.deferDelete('sch_1');
  assert.equal(h.undo(), true);
  r.expire();
  assert.deepEqual(await h.done, { undone: true });
  assert.equal(r.calls.length, 0);

  r = rig();
  h = r.live.deferDelete('sch_1');
  assert.equal(r.live.pending(), h);
  r.expire(); r.expire();
  assert.deepEqual(await h.done, { ok: true, body: { ok: true } });
  assert.deepEqual(r.calls.map((c) => c.slice(0, 2)), [['DELETE', '/api/schedules/sch_1']]);
  assert.equal(h.undo(), false, 'too late to undo');

  r = rig();
  h = r.live.deferDelete('sch_1');
  r.live.pending().flush();   // what Pulse's say does when the next notice replaces this one
  r.expire();
  await h.done;
  assert.equal(r.calls.length, 1);

  r = rig();
  h = r.live.deferDelete('sch_1');
  r.hooks.pagehide();
  await h.done;
  assert.deepEqual(r.calls.map((c) => [c[0], c[3]]), [['DELETE', true]], 'sent with keepalive');

  r = rig(() => [409, { error: 'gone' }]);
  h = r.live.deferDelete('sch_1');
  r.expire();
  assert.deepEqual(await h.done, { ok: false, status: 409, error: 'gone' });
});

test('no file under ui/public/stillhet/ outside live/ names /api/schedules', () => {
  const root = new URL('../ui/public/stillhet/', import.meta.url).pathname, bad = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'live') walk(p); } else if (/\.(m?js|html)$/.test(f) && readFileSync(p, 'utf8').includes('/api/schedules')) bad.push(p.slice(root.length)); } };
  walk(root);
  assert.deepEqual(bad, []);
});

test('Save keeps the saved rule\'s end; a time-only change keeps a rule no picker word reads; graceMin is sent', async () => {
  const { patchOf } = await import('../ui/public/stillhet/live/schedule-live.mjs');
  const saved = { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC', end: { type: 'count', count: 10 } };
  assert.deepEqual(patchOf({ kind: 'recurring', draft: { every: 'every Monday', at: '09:00', tz: 'UTC', rule: saved } }).rule,
    { freq: 'weekly', interval: 1, time: '09:00', tz: 'UTC', weekdays: ['mo'], end: { type: 'count', count: 10 } });
  const twoDays = { freq: 'daily', interval: 2, time: '02:00', tz: 'UTC', end: { type: 'until', until: '2027-01-01' } };
  assert.deepEqual(patchOf({ kind: 'recurring', draft: { every: 'every 2 days', at: '07:30', tz: 'UTC', rule: twoDays, onlyAt: true } }).rule, { ...twoDays, time: '07:30' });
  assert.ok(patchOf({ kind: 'recurring', draft: { every: 'every 2 days', at: '7', tz: 'UTC', rule: twoDays, onlyAt: true } }).rule.error);
  assert.deepEqual(patchOf({ kind: 'recurring', draft: { graceMin: 60 } }), { graceMin: 60 });
});

test('New schedule sends its run fields, the end, overlap and failures; noProject only when asked for', async () => {
  const { newBodyOf } = await import('../ui/public/stillhet/live/schedule-live.mjs');
  const body = newBodyOf({ projectDir: '/src/web', prompt: 'Lint', title: 'Lint', every: 'every day', at: '02:00', tz: 'Europe/Berlin', end: { type: 'count', count: 10 }, overlap: 'queue', maxFailures: 0, run: { workflowId: 'wf_x', engine: 'codex', sourceBranch: 'dev' } });
  assert.deepEqual(body, { projectDir: '/src/web', workflowId: 'wf_x', engine: 'codex', sourceBranch: 'dev', prompt: 'Lint', title: 'Lint',
    repeat: { rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'Europe/Berlin', end: { type: 'count', count: 10 } }, overlap: 'queue', maxFailures: 0 } });
  assert.equal(newBodyOf({ prompt: 'x', every: 'every day', at: '02:00' }).noProject, undefined);
  assert.equal(newBodyOf({ noProject: true, prompt: 'x', every: 'every day', at: '02:00' }).noProject, true);
});

test('Run now answered 200 with status failed is a refusal with its reason', async () => {
  const { live } = rig(() => [200, { runId: 'tk1', status: 'failed', failReason: 'card is scheduled' }]);
  assert.deepEqual(await live.act('run', { id: 'sch_1' }), { ok: false, status: 200, error: 'card is scheduled' });
  const b = rig(() => [200, { runId: 'tk1', status: 'failed', failReason: null }]);
  assert.deepEqual(await b.live.act('run', { id: 'sch_1' }), { ok: false, status: 200, error: 'it could not start' });
});
