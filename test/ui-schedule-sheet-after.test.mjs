// test/ui-schedule-sheet-after.test.mjs
// The schedule sheet's kind switch (run chains): At a time keeps today's sheet; After a run shows
// only the candidates select, the policy switch and the sentence. Candidates come from the host;
// the result is the wire shape; the empty and loading states disable OK; ticket mode switches
// kinds; a stored pick that is no longer a candidate is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  return { doc: window.document, window, done, mod };
}
const CANDS = async () => ({
  runs: [{ pipelineId: 'p1', runId: 'r1', title: 'Refactor', status: 'running' }],
  tickets: [{ id: 't1', title: 'Nightly lint', status: 'scheduled', after: null }],
});
const kinds = (doc) => [...doc.querySelectorAll('.sched-kind button')].map((b) => b.dataset.kind);
const kindOn = (doc) => doc.querySelector('.sched-kind button.on')?.dataset.kind;

test('After a run: the kind switch hides the time controls, candidates fill the select, the result is the wire shape', async () => {
  const { doc, window, done } = await open({ mode: 'create', candidates: CANDS });
  assert.deepEqual(kinds(doc), ['time', 'after']);
  assert.equal(kindOn(doc), 'time', 'a fresh sheet opens on At a time');
  assert.equal(doc.querySelector('.sched-presets').hidden, false, 'the presets are today\'s under At a time');
  doc.querySelector('button[data-kind="after"]').click();
  await tick(2);
  assert.equal(kindOn(doc), 'after');
  assert.equal(doc.querySelector('.sched-presets').hidden, true, 'no time presets under After a run');
  const sel = doc.getElementById('sched-after');
  assert.ok(sel, 'the predecessor select is there');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Running', 'Scheduled']);
  assert.deepEqual([...sel.options].map((o) => o.value), ['pipeline:p1', 'ticket:t1']);
  assert.equal(doc.getElementById('sched-date').closest('.field').closest('.sched-once').hidden, true, 'no date for an after-run');
  assert.equal(doc.getElementById('sched-missed').closest('.field-grid-2').hidden, true, 'no missed policy either');
  assert.equal(doc.querySelector('.sched-sentence b').textContent, 'After ‘Refactor’ finishes');
  sel.value = 'ticket:t1';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(doc.querySelector('.sched-sentence b').textContent, 'After ‘Nightly lint’ finishes');
  doc.getElementById('sched-after-any').click();
  doc.querySelector('.sched-ok').click();
  assert.deepEqual(await done, { after: { kind: 'ticket', id: 't1', title: 'Nightly lint' }, afterPolicy: 'any' });
});

test('back to At a time: the time controls return and the result is a time', async () => {
  const { doc, done } = await open({ mode: 'create', candidates: CANDS });
  doc.querySelector('button[data-kind="after"]').click();
  await tick(2);
  doc.querySelector('button[data-kind="time"]').click();
  await tick();
  assert.equal(doc.querySelector('.sched-presets').hidden, false);
  assert.equal(doc.querySelector('.sched-once').hidden, false);
  assert.equal(doc.querySelector('.sched-after').hidden, true);
  doc.querySelector('.sched-ok').click();
  const out = await done;
  assert.ok(out.scheduledFor && !out.after, 'a time, no predecessor');
});

test('nothing to wait for: the error line says so and OK is disabled; no candidates or allowAfter:false means no switch', async () => {
  const a = await open({ mode: 'create', candidates: async () => ({ runs: [], tickets: [] }) });
  a.doc.querySelector('button[data-kind="after"]').click();
  await tick(2);
  assert.equal(a.doc.querySelector('.sched-err').textContent, 'Nothing is running or scheduled for this project.');
  assert.equal(a.doc.querySelector('.sched-ok').disabled, true);
  a.mod.closeScheduleSheet(); await a.done;
  const b = await open({ mode: 'create', allowAfter: false, candidates: CANDS });
  assert.equal(b.doc.querySelector('.sched-kind'), null, 'allowAfter:false hides the switch');
  b.mod.closeScheduleSheet(); await b.done;
  const c = await open({ mode: 'create' });
  assert.equal(c.doc.querySelector('.sched-kind'), null, 'no candidates: today\'s sheet');
  assert.equal(c.doc.querySelector('.sched-presets').hidden, false);
  c.mod.closeScheduleSheet(); await c.done;
});

test('while the candidates are still loading OK is disabled, no error line is shown, and the list is requested once', async () => {
  // A never-settling loader: state.cands stays null, so the OK gate's second term holds.
  let calls = 0;
  const { doc, done, mod } = await open({ mode: 'create', candidates: () => { calls++; return new Promise(() => {}); } });
  doc.querySelector('button[data-kind="after"]').click();
  await tick(2);
  assert.equal(doc.querySelector('.sched-ok').disabled, true, 'nothing can be confirmed before the list lands');
  assert.equal(doc.querySelector('.sched-err').textContent, '', 'loading is not an error');
  doc.getElementById('sched-after-any').click();   // repaints while the request is in flight
  doc.getElementById('sched-after-any').click();
  await tick(2);
  assert.equal(calls, 1, 'repaints never fire a second request');
  mod.closeScheduleSheet(); await done;
});

test('Change… on an after-ticket opens on the After side and can switch to a time', async () => {
  const { doc, done } = await open({ mode: 'ticket', candidates: CANDS, initial: { after: { kind: 'pipeline', id: 'p1', title: 'Refactor' }, afterPolicy: 'done' } });
  assert.equal(doc.getElementById('sched-title').textContent, 'Change when it starts');
  assert.deepEqual(kinds(doc), ['time', 'after']);
  assert.equal(kindOn(doc), 'after');
  assert.equal(doc.querySelector('.sched-presets'), null, 'ticket mode never shows presets');
  assert.equal(doc.getElementById('sched-after').value, 'pipeline:p1');
  doc.querySelector('button[data-kind="time"]').click();
  await tick();
  assert.equal(doc.querySelector('.sched-once').hidden, false);
  doc.querySelector('.sched-ok').click();
  const out = await done;
  assert.ok(out.scheduledFor && !out.after, 'a time, no predecessor');
});

test('Change time without candidates is today\'s sheet: no switch, the old heading', async () => {
  const { doc, mod, done } = await open({ mode: 'ticket', initial: { scheduledFor: new Date(Date.now() + 3600_000).toISOString(), ifMissed: 'run', graceMin: 360 } });
  assert.equal(doc.getElementById('sched-title').textContent, 'Change time');
  assert.equal(doc.querySelector('.sched-kind'), null);
  mod.closeScheduleSheet(); await done;
});

test('Change… on a ticket waiting for a FINISHED pipeline keeps that predecessor', async () => {
  const { doc, done } = await open({
    mode: 'ticket',
    candidates: CANDS,
    initial: { after: { kind: 'pipeline', id: 'p9', title: 'Old', status: 'done' }, afterPolicy: 'done' },
  });
  const sel = doc.getElementById('sched-after');
  assert.equal(sel.value, 'pipeline:p9', 'the stored pick is never silently replaced');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Current', 'Running', 'Scheduled']);
  assert.equal(doc.querySelector('.sched-sentence b').textContent, 'After ‘Old’ finishes');
  doc.querySelector('.sched-ok').click();
  assert.deepEqual(await done, { after: { kind: 'pipeline', id: 'p9', title: 'Old' }, afterPolicy: 'done' });
});

// JSDOM reads the `hidden` PROPERTY, not the cascade — it cannot see that an author display rule
// (`.sched-presets{display:flex}`, `.sched-after{display:grid}`) beats the UA [hidden]{display:none}
// and leaves both blocks visible in a real browser. Pin the restatement by source, the
// test/ui-running-pause-fixes.test.mjs idiom.
test('style.css restates [hidden] for the presets seg and the After block', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.sched-presets\[hidden\],\.sched-after\[hidden\]\{display:none;\}/);
  assert.match(css, /\.sched-kind\{display:flex;/);
});
