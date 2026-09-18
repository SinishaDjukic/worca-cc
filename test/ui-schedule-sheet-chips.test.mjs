// test/ui-schedule-sheet-chips.test.mjs
// The schedule sheet's quick chips (Once): In 1 hour, 22:00 (today's while it is ahead, else
// tomorrow's), Tomorrow 02:00, Monday 06:00 — always in chronological order, whatever the hour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const sheetPath = fileURLToPath(new URL('../ui/public/schedule-sheet.mjs', import.meta.url));
const { zonedToUtc, zonedParts } = await import('../src/shared/schedule/recurrence.mjs');

async function sheetAt(localHour) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  const { window } = dom;
  for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'KeyboardEvent']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  // "Now" = today at localHour:30 in this machine's zone (the sheet reads the browser's zone).
  const today = zonedParts(Date.now(), tz);
  const nowMs = zonedToUtc({ y: today.y, m: today.m, d: today.d, hh: localHour, mm: 30 }, tz);
  const realNow = Date.now;
  Date.now = () => nowMs;
  const mod = await import(pathToFileURL(sheetPath).href + `?b=${nowMs}_${Math.random()}`);
  const done = mod.openScheduleSheet({ mode: 'create' });
  const chips = [...window.document.querySelectorAll('.sched-chip')].map((b) => {
    b.click();
    return { label: b.textContent, at: zonedToUtc({ y: +window.document.getElementById('sched-date').value.slice(0, 4), m: +window.document.getElementById('sched-date').value.slice(5, 7), d: +window.document.getElementById('sched-date').value.slice(8, 10), hh: +window.document.getElementById('sched-time').value.slice(0, 2), mm: +window.document.getElementById('sched-time').value.slice(3, 5) }, tz) };
  });
  mod.closeScheduleSheet();
  await done;
  Date.now = realNow;
  return { chips, nowMs };
}

test('before 22:00: In 1 hour, Today 22:00, Tomorrow 02:00, Monday 06:00 — chronological', async () => {
  const { chips, nowMs } = await sheetAt(9);
  assert.deepEqual(chips.map((c) => c.label), ['In 1 hour', 'Today 22:00', 'Tomorrow 02:00', 'Monday 06:00']);
  for (let i = 1; i < chips.length; i++) assert.ok(chips[i].at > chips[i - 1].at, `${chips[i - 1].label} < ${chips[i].label}`);
  assert.ok(chips.every((c) => c.at > nowMs), 'every chip is in the future');
});

test('after 22:00: the 22:00 chip is tomorrow\'s and sorts after Tomorrow 02:00; In 1 hour stays first', async () => {
  const { chips } = await sheetAt(22);
  assert.deepEqual(chips.map((c) => c.label), ['In 1 hour', 'Tomorrow 02:00', 'Tomorrow 22:00', 'Monday 06:00'].filter((l, i, all) => all.indexOf(l) === i)
    .sort((a, b) => chips.findIndex((c) => c.label === a) - chips.findIndex((c) => c.label === b)));
  assert.ok(chips.some((c) => c.label === 'Tomorrow 22:00'), 'a 22:00 chip is always offered');
  for (let i = 1; i < chips.length; i++) assert.ok(chips[i].at > chips[i - 1].at, `${chips[i - 1].label} < ${chips[i].label}`);
});

test('at 21:30 "In 1 hour" (22:30) sorts AFTER Today 22:00', async () => {
  const { chips } = await sheetAt(21);
  assert.deepEqual(chips.slice(0, 2).map((c) => c.label), ['Today 22:00', 'In 1 hour']);
});
