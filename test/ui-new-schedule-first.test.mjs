// test/ui-new-schedule-first.test.mjs
// Schedules › "Schedule a run" (#new/schedule): the time is picked FIRST, then the task. The pick
// waits on the New pipeline form, Start run reads as Schedule, the submit carries it, and
// "Start now instead" / the menu's "Start run now" drop it (docs/scheduled-runs.md "UI").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }];
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));

async function boot(hash = '#new/schedule') {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash}` });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const runBodies = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: PROJECTS }) });
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      runBodies.push(body);
      return Promise.resolve({ ok: true, status: body.scheduledFor || body.repeat ? 202 : 200,
        json: async () => (body.scheduledFor || body.repeat ? { runId: 'r-1', status: 'scheduled', scheduledFor: body.scheduledFor } : { runId: 'run-1' }) });
    }
    if (u.includes('/api/schedules')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ schedules: [], tickets: [], counts: { scheduled: 0, missed: 0, recurring: 0, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 } }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(5);
  return { window, runBodies };
}

/** Confirm the open sheet as a one-off run tomorrow at 02:00. */
function pickTomorrow(window) {
  const doc = window.document;
  const modal = doc.getElementById('schedule-modal');
  assert.ok(modal, 'the schedule sheet is open');
  const d = new Date(Date.now() + 86_400_000);
  const date = doc.getElementById('sched-date');
  date.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  date.dispatchEvent(new window.Event('change', { bubbles: true }));
  const time = doc.getElementById('sched-time');
  time.value = '02:00';
  time.dispatchEvent(new window.Event('change', { bubbles: true }));
  modal.querySelector('.sched-ok').click();
}

test('#new/schedule opens the sheet first; the pick waits on the form and the hash becomes plain #new', async () => {
  const { window, runBodies } = await boot();
  const doc = window.document;
  assert.equal(doc.querySelector('[data-view="new"]').classList.contains('hidden'), false, 'New pipeline is shown');
  assert.equal(window.location.hash, '#new', 'the intent is consumed — a reload is a plain form');
  pickTomorrow(window);
  await tick();
  assert.equal(doc.getElementById('schedule-modal'), null, 'the sheet closed');
  const line = doc.getElementById('new-sched');
  assert.equal(line.hidden, false);
  assert.equal(doc.getElementById('new-sched-badge').textContent, 'Scheduled');
  assert.match(doc.getElementById('new-sched-text').textContent, /^Starts [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, 02:00$/);
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Schedule');
  assert.equal(doc.getElementById('start-btn-clock').hasAttribute('hidden'), false);
  assert.equal(doc.getElementById('start-btn-play').hasAttribute('hidden'), true, 'the attribute, not the property — an <svg> has no .hidden');

  // The task, then the primary button: ONE click schedules.
  const psel = doc.querySelector('#projectSelect');
  psel.value = '/a/svc-iam';
  psel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#prompt').value = 'upgrade deps';
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(20);
  assert.equal(runBodies.length, 1);
  assert.match(runBodies[0].scheduledFor, /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the pick rode the POST');
  assert.equal(runBodies[0].ifMissed, 'run');
  assert.equal(doc.querySelector('[data-view="schedules"]').classList.contains('hidden'), false, 'lands on Schedules');
  assert.equal(line.hidden, true, 'the form is a plain Start run form again');
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Start run');
});

test('cancelling the sheet leaves a plain form; "Start now instead" and "Start run now" drop a pending pick', async () => {
  const { window, runBodies } = await boot();
  const doc = window.document;
  doc.getElementById('schedule-modal').querySelector('.sched-cancel').click();
  await tick();
  assert.equal(doc.getElementById('new-sched').hidden, true);
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Start run');
  // Change… on the form (the only entry point besides the route) opens it again.
  doc.getElementById('new-sched-change').click();
  await tick();
  pickTomorrow(window);
  await tick();
  assert.equal(doc.getElementById('new-sched').hidden, false);
  doc.getElementById('new-sched-clear').click();
  assert.equal(doc.getElementById('new-sched').hidden, true, 'Start now instead drops the pick');
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Start run');
  doc.getElementById('new-sched-change').click();
  await tick();
  pickTomorrow(window);
  await tick();
  // The menu's "Start run now" starts NOW even with a pick waiting.
  const psel = doc.querySelector('#projectSelect');
  psel.value = '/a/svc-iam';
  psel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#prompt').value = 'upgrade deps';
  doc.getElementById('start-menu-now').click();
  await tick(20);
  assert.equal(runBodies.length, 1);
  assert.equal('scheduledFor' in runBodies[0], false);
  assert.equal(doc.getElementById('new-sched').hidden, true);
});

test('a plain #new never opens the sheet; the split menu\'s Schedule… opens it before any prompt, as a mode', async () => {
  const { window, runBodies } = await boot('#new');
  const doc = window.document;
  assert.equal(doc.getElementById('schedule-modal'), null);
  assert.equal(doc.getElementById('new-sched').hidden, true);
  assert.equal(doc.querySelector('#prompt').value, '', 'no prompt yet');
  doc.getElementById('start-menu-schedule').click();
  await tick();
  assert.ok(doc.getElementById('schedule-modal'), 'the sheet opens without validating the form');
  assert.equal(doc.getElementById('form-msg').textContent, '', 'no "provide a prompt" complaint');
  pickTomorrow(window);
  await tick();
  assert.equal(doc.getElementById('new-sched').hidden, false);
  assert.equal(doc.getElementById('start-btn-label').textContent, 'Schedule');
  assert.equal(runBodies.length, 0, 'nothing posted yet — the task comes next');
  // Schedule with no prompt: the form's own validation still gates the POST.
  const psel = doc.querySelector('#projectSelect');
  psel.value = '/a/svc-iam';
  psel.dispatchEvent(new window.Event('change', { bubbles: true }));
  doc.querySelector('#run-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(5);
  assert.equal(runBodies.length, 0);
  assert.match(doc.getElementById('form-msg').textContent, /prompt/i);
  assert.equal(doc.getElementById('new-sched').hidden, false, 'the pick survives a validation error');
});
