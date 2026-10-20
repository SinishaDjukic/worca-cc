// test/ui-schedule-sheet-subdaily.test.mjs
// The schedule sheet's "Times a day" row: a list of times, or every N minutes/hours in an optional
// time range. The sentence proves the rule, an under-15-minute rule is refused, and Edit reopens it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const sheetPath = fileURLToPath(new URL('../ui/public/schedule-sheet.mjs', import.meta.url));
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));

async function open(opts) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  const { window } = dom;
  for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'KeyboardEvent']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  const mod = await import(pathToFileURL(sheetPath).href + `?b=${Date.now()}_${Math.random()}`);
  const done = mod.openScheduleSheet(opts);
  await tick(2);
  return { doc: window.document, window, done };
}
const setVal = (win, el, v, ev = 'input') => { el.value = v; el.dispatchEvent(new win.Event(ev, { bubbles: true })); };
const TZ_RULE = { tz: 'Europe/Berlin' };

test('every 15 minutes between 09:00 and 18:00 on weekdays', async () => {
  const { doc, window, done } = await open({ mode: 'create', initial: { rule: { freq: 'daily', interval: 1, time: '02:00', ...TZ_RULE } } });
  doc.querySelector('button[data-preset="weekdays"]').click();
  setVal(window, doc.getElementById('sched-plan'), 'step', 'change');
  assert.equal(doc.getElementById('sched-time'), null); // the single time field leaves the sheet
  const between = doc.getElementById('sched-between');
  between.checked = true; between.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('.sched-sentence b').textContent, 'Every 15 minutes, 09:00–18:00, weekdays');
  doc.querySelector('.sched-ok').click();
  const out = await done;
  assert.deepEqual(out.repeat.rule.step, { minutes: 15, from: '09:00', to: '18:00' });
  assert.equal('time' in out.repeat.rule, false);
});

test('a list of times, and a rule under 15 minutes is refused', async () => {
  const { doc, window, done } = await open({ mode: 'create', initial: { rule: { freq: 'daily', interval: 1, time: '02:00', ...TZ_RULE } } });
  setVal(window, doc.getElementById('sched-plan'), 'times', 'change');
  setVal(window, doc.getElementById('sched-times'), '17:00, 09:00,13:00');
  assert.equal(doc.querySelector('.sched-sentence b').textContent, 'Every day at 09:00, 13:00 and 17:00');
  setVal(window, doc.getElementById('sched-times'), '09:00, 09:10');
  assert.match(doc.querySelector('.sched-err').textContent, /at least 15 minutes apart: 09:00 and 09:10 are 10 minutes apart/);
  assert.equal(doc.querySelector('.sched-ok').disabled, true);
  setVal(window, doc.getElementById('sched-plan'), 'step', 'change');
  setVal(window, doc.getElementById('sched-step'), '5');
  assert.match(doc.querySelector('.sched-err').textContent, /every 5 minutes is too often/);
  doc.querySelector('.sched-cancel').click();
  assert.equal(await done, null);
});

test('Edit reopens a stored step rule in hours with its time range', async () => {
  const rule = { freq: 'daily', interval: 1, step: { minutes: 120, from: '08:00', to: '20:00' }, anchor: '2026-09-18', end: { type: 'never' }, ...TZ_RULE };
  const { doc, done } = await open({ mode: 'series', initial: { rule } });
  assert.equal(doc.getElementById('sched-plan').value, 'step');
  assert.equal(doc.getElementById('sched-step').value, '2');
  assert.equal(doc.getElementById('sched-step-unit').value, 'hours');
  assert.equal(doc.getElementById('sched-between').checked, true);
  assert.equal(doc.getElementById('sched-from').value, '08:00');
  doc.querySelector('.sched-ok').click();
  assert.deepEqual((await done).repeat.rule.step, rule.step);
});

test('the "Only between" row wraps so From/To keep a readable width', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  const rule = (sel) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\{([^}]*)\\}')) || [])[1] || '';
  assert.match(rule('.sched-range'), /flex-wrap:wrap/);
  assert.match(rule('.sched-range > .sched-between'), /flex:1 0 100%/); // the label takes its own line
  assert.match(rule('.sched-range > input[type="time"]'), /min-width:7\.5em/);
});
