// test/ui-exec-env-status.test.mjs — the execution environment status chip (ui/public/exec-env-status.mjs): its words
// per state, the painter, and the self-updating poll (no buttons) that only fetches while a chip is on screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { execEnvStatusText, paintExecEnvStatusChip, watchExecEnvStatus } from '../ui/public/exec-env-status.mjs';

const SERVER = 'http://localhost:3000 (key e2b_…ab12)';
const entry = (server, state = server.state) => ({ name: 'e2b', label: 'E2B sandbox', title: 'E2B', state, servers: [{ label: SERVER, ...server }] });

test('the chip reads connected with the count, full with the queue, unreachable, key refused, not set up', () => {
  let t = execEnvStatusText(entry({ state: 'connected', running: 1, cap: 4, waiting: 0 }));
  assert.equal(t.text, 'connected · 1 of 4 in use'); assert.equal(t.tone, 'ok');
  assert.match(t.title, /^E2B: http:\/\/localhost:3000 \(key e2b_…ab12\)/);
  t = execEnvStatusText(entry({ state: 'connected', running: 4, cap: 4, waiting: 2 }));
  assert.equal(t.text, 'connected · 4 of 4 in use · 2 waiting'); assert.equal(t.tone, 'warn');
  assert.match(t.title, /2 runs wait for a slot/);
  t = execEnvStatusText(entry({ state: 'unreachable', running: null, cap: 4, waiting: 0, error: 'ECONNREFUSED' }));
  assert.equal(t.text, 'unreachable'); assert.equal(t.tone, 'bad'); assert.match(t.title, /ECONNREFUSED/);
  t = execEnvStatusText(entry({ state: 'key-refused', running: null, cap: 4, waiting: 0, error: 'Unauthorized' }));
  assert.equal(t.text, 'key refused'); assert.equal(t.tone, 'bad');
  t = execEnvStatusText(entry({ state: 'not-configured', running: null, cap: 4, waiting: 0, error: 'E2B_API_KEY is not set' }));
  assert.equal(t.text, 'not set up'); assert.equal(t.tone, 'muted');
  t = execEnvStatusText(null);
  assert.equal(t.text, 'checking…'); assert.equal(t.tone, 'muted');
});

test('paintExecEnvStatusChip sets the words, the tone and the tooltip; null hides it', () => {
  const { window } = new JSDOM('<!doctype html><span id="c" hidden></span>');
  const chip = window.document.getElementById('c');
  paintExecEnvStatusChip(chip, entry({ state: 'connected', running: 0, cap: 2, waiting: 0 }));
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, 'connected · 0 of 2 in use');
  assert.equal(chip.dataset.tone, 'ok');
  assert.match(chip.title, /localhost:3000/);
  paintExecEnvStatusChip(chip, undefined, { hide: true });
  assert.equal(chip.hidden, true);
});

test('the watch polls only while active: at once, then every 5 s; inactive leaves no timer; stop() ends it', async () => {
  const timers = []; const fetched = []; const seen = [];
  const list = [entry({ state: 'connected', running: 1, cap: 4, waiting: 0 })];
  const w = watchExecEnvStatus({
    fetchFn: async (url) => { fetched.push(url); return { ok: true, json: async () => ({ execEnvs: list }) }; },
    schedule: (f, ms) => { timers.push({ f, ms }); return f; },
    cancel: (f) => { const i = timers.findIndex((x) => x.f === f); if (i >= 0) timers.splice(i, 1); },
    onStatus: (l) => seen.push(l), intervalMs: 5000,
  });
  const settle = () => new Promise((r) => setImmediate(r));
  assert.equal(timers.length, 0, 'nothing runs until a chip is on screen');
  w.setActive(true); await settle();
  assert.deepEqual(fetched, ['/api/exec-envs/status'], 'a chip coming on screen polls at once');
  assert.deepEqual(seen, [list]);
  assert.equal(timers.length, 1); assert.equal(timers[0].ms, 5000);
  await timers.shift().f();
  assert.equal(fetched.length, 2); assert.equal(timers.length, 1, 'keeps polling while active');
  w.setActive(true); await settle();
  assert.equal(fetched.length, 2, 'already active: no extra poll');
  w.setActive(false);
  assert.equal(timers.length, 0, 'off screen: no timer left');
  w.setActive(true); w.setActive(false); w.setActive(true); await settle();
  assert.equal(timers.length, 1, 'flapping leaves one loop');
  w.stop();
  assert.equal(timers.length, 0);
  w.setActive(true); await w.refresh(); await settle();
  assert.equal(timers.length, 0, 'a stopped watch never schedules');
});

test('a failed fetch keeps the last status and keeps polling', async () => {
  const timers = []; const seen = [];
  let fail = false;
  const w = watchExecEnvStatus({
    fetchFn: async () => { if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ execEnvs: [] }) }; },
    schedule: (f) => { timers.push(f); return f; }, cancel: () => {}, onStatus: (l) => seen.push(l),
  });
  w.setActive(true); await new Promise((r) => setImmediate(r));
  fail = true; await timers.shift()();
  assert.equal(seen.length, 1, 'no repaint from a failed poll');
  assert.equal(timers.length, 1, 'still scheduled');
  w.stop();
});
