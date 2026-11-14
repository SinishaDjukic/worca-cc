// test/prompt-check-improve-view.test.mjs — the Improve view (ui/public/prompt-check/improve-view.mjs) through the chip
// host (ui/public/prompt-check/chip-host.mjs): click-only requests, the busy, ready, used and failed states, focus,
// Use this / Undo / Keep mine on the field, and late replies that never paint. A bare JSDOM per test, closed when the
// test ends; fake timers; the grade and improve fetches are held per call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { mountPromptCheckChip, setPromptCheckPref } from '../ui/public/prompt-check/chip-host.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';
import { normalizeRewrite, rewriteText } from '../src/shared/prompt-check/improve.mjs';

const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
const OTHER = 'Build a Slack notifier that posts a message when a run fails, with the run title, the step and a link.';
const THIRD = 'Rename the Statistics page to Insights everywhere in the navigation, the page head and the docs links.';
const URL_IMPROVE = '/api/prompt-check/improve';

function fakeTimers() {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (i) => { jobs.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (j.at <= now) { jobs.delete(i); j.fn(); }
    },
  };
}

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

function okReply(call, { kind = 'requirement', sections = [{ id: 'problem', text: 'Finance needs the weekly cost.' }], paths = [], model = 'Sonnet 5.5' } = {}) {
  const rewrite = normalizeRewrite({ sections }, kind);
  return { requestId: call.body.requestId, source: 'model', kind, model, rewrite, text: rewriteText(rewrite), paths };
}

function setup(t, { kind = 'requirement' } = {}) {
  const w = new JSDOM('<!doctype html><body><textarea id="f"></textarea><button id="send">Send</button><div id="host"></div></body>');
  const doc = w.window.document;
  const host = doc.getElementById('host');
  const field = doc.getElementById('f');
  const send = doc.getElementById('send');
  const timers = fakeTimers();
  const grades = [];
  const improves = [];
  const said = [];
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    const call = { url, body: JSON.parse(opts.body), aborted: false };
    opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    call.reply = (o, status = 200) => resolve({ ok: status < 400, status, json: async () => o });
    call.fail = () => reject(new Error('network'));
    (url === URL_IMPROVE ? improves : grades).push(call);
  });
  setPromptCheckPref(true);
  let m = null;
  const inputs = [];
  // The surface's input path: a write lands in the field and the chip hears it, as a typed edit would.
  const onInput = () => { inputs.push(field.value); m.input(field.value); };
  field.addEventListener('input', onInput);
  m = mountPromptCheckChip({
    doc, host, surface: { kind: 'chat', id: 'ask_1' }, ids: { threadId: 'ask_1' }, announce: (x) => said.push(x), fetchImpl, timers,
    field: { read: () => field.value, write: (x) => { field.value = x; field.dispatchEvent(new w.window.Event('input')); }, focus: () => field.focus() },
    project: () => 'proj-1',
  });
  t.after(() => { m.dispose(); setPromptCheckPref(false); w.window.close(); });
  const type = (x) => { field.value = x; field.dispatchEvent(new w.window.Event('input')); };
  const grade = async (assessment = {}) => {
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    const call = grades.at(-1);
    call.reply({ requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
      assessment: { isTask: true, kind, grade: 'needs-detail', continuesRequirement: true, openDecisions: ['who signs off?'], ...assessment } });
    await flush();
  };
  const graded = async (x = TASK, assessment = {}) => { type(x); await grade(assessment); };
  const improveBtn = () => m.el.querySelector('[data-prompt-improve-open]');
  const view = () => host.querySelector('[data-prompt-improve]');
  const actBtn = (name) => host.querySelector(`[data-improve-act="${name}"]`);
  const click = async (b) => { b.click(); await flush(); };
  return { w, doc, host, field, send, timers, grades, improves, said, m, type, grade, graded, improveBtn, view, actBtn, click, inputs };
}

test('Improve shows for needs-detail only, is disabled while Busy and hidden in Ready and Used', async (t) => {
  const s = setup(t);
  await s.graded(TASK, { grade: 'clear' });
  assert.equal(s.improveBtn(), null);
  await s.graded(OTHER);
  assert.ok(s.improveBtn());
  assert.equal(s.improveBtn().disabled, false);
  await s.click(s.improveBtn());
  assert.equal(s.improveBtn().disabled, true);
  s.improves[0].reply(okReply(s.improves[0]));
  await flush();
  assert.equal(s.improveBtn(), null, 'hidden in Ready');
  await s.click(s.actBtn('use'));
  assert.equal(s.improveBtn(), null, 'hidden in Used');
});

test('typing, 10 debounce periods, a kind correction and a re-check send 0 improve requests; one click sends exactly 1', async (t) => {
  const s = setup(t);
  for (let i = 0; i < 10; i++) { s.type(`${TASK} v${i}`); s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS); }
  await s.grade();
  s.m.el.querySelector('.spick button, button').click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Bug report').click();
  await flush();
  await s.grade({ kind: 'bug' });
  await s.graded(OTHER, { kind: 'bug' });
  assert.equal(s.improves.length, 0);
  await s.click(s.improveBtn());
  assert.equal(s.improves.length, 1);
  assert.equal(s.improves[0].body.kind, 'bug');
  assert.equal(s.improves[0].body.text, OTHER);
  assert.equal(s.improves[0].body.projectKey, 'proj-1');
  assert.deepEqual(s.improves[0].body.surface, { kind: 'chat', id: 'ask_1' });
  await s.click(s.improveBtn());
  assert.equal(s.improves.length, 1, 'a second click while busy does nothing');
});

test('Busy: Rewriting…, Improve disabled, focus on the busy region even when a disabled button blurs; field and Send unchanged', async (t) => {
  const s = setup(t);
  await s.graded();
  const proto = s.w.window.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get: desc.get, set(v) { if (v) this.blur(); desc.set.call(this, v); } });
  t.after(() => Object.defineProperty(proto, 'disabled', desc));
  s.improveBtn().focus();
  await s.click(s.improveBtn());
  assert.match(s.view().textContent, /Suggested rewrite: requirement/);
  assert.match(s.view().textContent, /Rewriting…/);
  assert.equal(s.improveBtn().disabled, true);
  assert.notEqual(s.doc.activeElement, s.doc.body);
  assert.equal(s.doc.activeElement, s.actBtn('busy'));
  assert.equal(s.field.value, TASK);
  assert.equal(s.send.disabled, false);
  assert.equal(s.field.readOnly, false);
});

test('a regrade to clear during Busy closes the view and aborts; an edit while Failed closes the view and Improve returns', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  await s.graded(`${TASK} Done when the file downloads.`, { grade: 'clear' });
  assert.equal(s.improves[0].aborted, true);
  assert.equal(s.view(), null);
  await s.graded(`${TASK} B.`);
  await s.click(s.improveBtn());
  s.improves[1].reply({ requestId: s.improves[1].body.requestId, source: 'failed', error: 'unreadable reply', model: 'Sonnet 5.5' });
  await flush();
  assert.ok(s.view());
  assert.equal(s.improveBtn(), null);
  s.type(`${TASK} C.`);
  assert.equal(s.view(), null);
  assert.ok(s.improveBtn(), 'Improve is back while the grade is still needs-detail');
});

test('Ready: the head, amber gap marks and the foot; run-change reads "change to a run"', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  s.improves[0].reply(okReply(s.improves[0], { paths: [{ path: 'lib/old.mjs', inRepo: false }, { path: 'src/a.mjs', inRepo: true }] }));
  await flush();
  const v = s.view();
  assert.equal(v.querySelector('.pd-rewrite-head').textContent, 'Suggested rewrite: requirement');
  const gaps = [...v.querySelectorAll('.pd-gap')].map((g) => g.textContent);
  assert.ok(gaps.includes('Product · decide: who uses it?'), gaps.join('|'));
  assert.match(v.textContent, /Rewritten by Sonnet 5\.5 · your language and intent kept/);
  assert.equal(v.querySelector('.pd-rewrite-missing').textContent, 'Not in the repo: lib/old.mjs');
  assert.equal(s.doc.activeElement, s.actBtn('use'));
  assert.ok(s.said.includes('Suggested rewrite ready'));
  assert.equal((v.textContent.match(/Sonnet 5\.5/g) || []).length, 1, 'the model name once');

  const r = setup(t, { kind: 'run-change' });
  await r.graded();
  await r.click(r.improveBtn());
  r.improves[0].reply(okReply(r.improves[0], { kind: 'run-change', sections: [{ id: 'change', text: 'Skip the review.' }] }));
  await flush();
  assert.equal(r.view().querySelector('.pd-rewrite-head').textContent, 'Suggested rewrite: change to a run');
});

test('a section text holding <img onerror> shows literally and creates 0 img elements', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  const bad = '<img src=x onerror=alert(1)>';
  s.improves[0].reply(okReply(s.improves[0], { sections: [{ id: 'who', text: bad, gaps: [{ perspective: 'qa', decide: bad }] }], model: bad }));
  await flush();
  assert.equal(s.view().querySelectorAll('img').length, 0);
  assert.ok(s.view().textContent.includes(bad));
});

test('Use this writes the rewrite text; Undo restores the earlier text byte-identical; Keep mine leaves the field byte-identical', async (t) => {
  const s = setup(t);
  const original = `${TASK}\n  trailing  `;
  await s.graded(original);
  await s.click(s.improveBtn());
  const rep = okReply(s.improves[0]);
  s.improves[0].reply(rep);
  await flush();
  await s.click(s.actBtn('use'));
  assert.equal(s.field.value, rep.text);
  assert.equal(s.doc.activeElement, s.field);
  assert.match(s.view().textContent, /Rewrite used\./);
  await s.click(s.actBtn('undo'));
  assert.equal(s.field.value, original);
  assert.equal(s.view(), null);
  assert.equal(s.doc.activeElement, s.field);

  await s.graded(`${TASK} K.`);
  await s.click(s.improveBtn());
  s.improves[1].reply(okReply(s.improves[1]));
  await flush();
  await s.click(s.actBtn('keep'));
  assert.equal(s.field.value, `${TASK} K.`);
  assert.equal(s.view(), null);
  assert.ok(s.improveBtn());
  assert.equal(s.doc.activeElement, s.field);
});

test('after Use this the input path and the re-check keep Undo; a different edit hides Undo and keeps the edit', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  const rep = okReply(s.improves[0]);
  s.improves[0].reply(rep);
  await flush();
  await s.click(s.actBtn('use'));
  s.m.input(rep.text);   // the re-check
  await s.grade();
  assert.ok(s.actBtn('undo'), 'Undo still shown');
  s.type(`${rep.text} mine`);
  assert.equal(s.actBtn('undo'), null);
  assert.equal(s.field.value, `${rep.text} mine`);
});

test('an edit during Busy, then Use this, then Undo leaves the field equal to the edited text', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  const edited = `${TASK} Edited while busy.`;
  s.type(edited);
  s.improves[0].reply(okReply(s.improves[0]));
  await flush();
  await s.click(s.actBtn('use'));
  await s.click(s.actBtn('undo'));
  assert.equal(s.field.value, edited);
});

test('late replies never paint: an older request, and replies after close() or dispose()', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  s.improves[0].reply({ requestId: s.improves[0].body.requestId, source: 'failed', error: 'timeout', model: 'Sonnet 5.5' });
  await flush();
  await s.click(s.actBtn('retry'));
  assert.equal(s.improves.length, 2);
  s.improves[0].reply(okReply(s.improves[0]));   // a stale duplicate of the first request
  await flush();
  assert.equal(s.actBtn('use'), null);
  assert.equal(s.field.value, TASK);

  await s.graded(OTHER, { grade: 'clear' });   // closes the busy view
  s.improves[1].reply(okReply(s.improves[1]));
  await flush();
  assert.equal(s.view(), null);
  assert.equal(s.field.value, OTHER);

  await s.graded(THIRD);
  await s.click(s.improveBtn());
  s.m.dispose();
  s.improves[2].reply(okReply(s.improves[2]));
  await flush();
  assert.equal(s.host.querySelector('[data-prompt-improve]'), null);
  assert.equal(s.field.value, THIRD);
});

test('Failed: the retry note with focus on Try again and the field unchanged; Try again sends 1 new request; no retry on cost limit or no model', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  s.improves[0].reply({ requestId: s.improves[0].body.requestId, source: 'failed', error: 'timeout', model: 'Sonnet 5.5' });
  await flush();
  assert.match(s.view().textContent, /Could not rewrite it: no answer from Sonnet 5\.5 in 60s\. Your text is as it was\./);
  assert.equal(s.doc.activeElement, s.actBtn('retry'));
  assert.equal(s.field.value, TASK);
  assert.ok(s.said.includes('Could not rewrite it: no answer from Sonnet 5.5 in 60s. Your text is as it was.'), s.said.join('|'));
  await s.click(s.actBtn('retry'));
  assert.equal(s.improves.length, 2);
  for (const error of ['total cost limit reached', 'model unavailable']) {
    const call = s.improves.at(-1);
    call.reply({ requestId: call.body.requestId, source: 'failed', error, model: null });
    await flush();
    assert.equal(s.actBtn('retry'), null, error);
    assert.equal(s.doc.activeElement, s.view().querySelector('.pd-fail'), error);
    assert.equal(s.field.value, TASK);
    if (error === 'total cost limit reached') { s.type(`${TASK} X`); s.type(TASK); await s.click(s.improveBtn()); }
  }
  s.type(`${TASK} Y`);
  await s.click(s.improveBtn());
  s.improves.at(-1).reply({ error: 'prompt check is off' }, 409);
  await flush();
  assert.match(s.view().textContent, /Could not rewrite it\. Your text is as it was\. Try again/);
});

test('a superseded answer to the latest request paints Failed with Try again, never a stuck Busy', async (t) => {
  const s = setup(t);
  await s.graded();
  await s.click(s.improveBtn());
  s.improves[0].reply({ requestId: s.improves[0].body.requestId, source: 'superseded' });
  await flush();
  assert.equal(s.actBtn('busy'), null);
  assert.equal(s.doc.activeElement, s.actBtn('retry'));
  assert.equal(s.field.value, TASK);
  await s.click(s.actBtn('retry'));
  assert.equal(s.improves.length, 2);
});

test('emptying the field, sending, and the setting turning off close the view and abort the busy request', async (t) => {
  const s = setup(t);
  for (const end of ['empty', 'sent', 'off']) {
    setPromptCheckPref(true);
    await s.graded(`${TASK} ${end}.`);
    await s.click(s.improveBtn());
    const call = s.improves.at(-1);
    if (end === 'empty') s.type('');
    else if (end === 'sent') s.m.sent(s.field.value);
    else setPromptCheckPref(false);
    assert.equal(call.aborted, true, end);
    assert.equal(s.view(), null, end);
  }
});
