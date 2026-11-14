// test/prompt-check-chip-host.test.mjs — the prompt check chip's controller (ui/public/prompt-check/chip-host.mjs):
// one node per mount patched in place, the kind menu, the correction (ids only), the announcement and the setting.
// A bare JSDOM per test, closed when the test ends; fake timers and a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { mountPromptCheckChip, setPromptCheckPref, promptCheckOn } from '../ui/public/prompt-check/chip-host.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';

const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
const THIRD = 'Rename the Statistics page to Insights everywhere in the navigation, the page head and the docs links.';
const OTHER = 'Build a Slack notifier that posts a message when a run fails, with the run title, the step and a link.';

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

function fakeFetch() {
  const grades = [];
  const posts = [];
  const fetchImpl = (url, opts) => {
    if (url === '/api/prompt-check/kind-correction') {
      posts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ ok: true, at: 'x' }) });
    }
    return new Promise((resolve, reject) => {
      const call = { url, body: JSON.parse(opts.body), aborted: false };
      opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      call.reply = (o) => resolve({ ok: true, status: 200, json: async () => o });
      grades.push(call);
    });
  };
  return { grades, posts, fetchImpl };
}

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const reply = (call, assessment = {}, extra = {}) => ({
  requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
  assessment: { isTask: true, kind: 'implementation', grade: 'needs-detail', continuesRequirement: true, ...assessment }, ...extra,
});

function setup(t, o = {}) {
  const w = new JSDOM('<!doctype html><body><textarea id="f"></textarea><div id="host"></div></body>');
  t.after(() => { m.dispose(); setPromptCheckPref(false); w.window.close(); });
  const doc = w.window.document;
  const host = doc.getElementById('host');
  const field = doc.getElementById('f');
  field.focus();
  const timers = fakeTimers();
  const f = fakeFetch();
  const said = [];
  setPromptCheckPref(o.on ?? true);
  const m = mountPromptCheckChip({ doc, host, surface: { kind: 'chat', id: 'ask_1' }, ids: { threadId: 'ask_1' },
    announce: (s) => said.push(s), fetchImpl: f.fetchImpl, timers, ...o.mount });
  const graded = async (text = TASK, assessment = {}, extra = {}) => {
    m.input(text);
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    const call = f.grades.at(-1);
    call.reply(reply(call, assessment, extra));
    await flush();
    return call;
  };
  return { w, doc, host, field, timers, said, m, graded, ...f };
}
const chips = (s) => s.host.querySelectorAll('[data-prompt-check]');
const badge = (el) => el.querySelector('.pcheck-grade');
const picker = (el) => el.querySelector('button');

test('a graded task shows one chip: the kind picker (named Prompt kind: …) and the grade badge; the node is created at mount', async (t) => {
  const s = setup(t);
  assert.equal(s.m.el.isConnected, false, 'nothing shows before a result');
  await s.graded();
  assert.equal(chips(s).length, 1);
  assert.equal(chips(s)[0], s.m.el);
  assert.equal(s.m.el.dataset.kind, 'implementation');
  assert.equal(s.m.el.dataset.grade, 'needs-detail');
  assert.equal(picker(s.m.el).textContent, 'Implementation task');
  assert.equal(picker(s.m.el).getAttribute('aria-label'), 'Prompt kind: Implementation task');
  assert.equal(badge(s.m.el).textContent, 'Needs detail');
  assert.ok(badge(s.m.el).classList.contains('is-needs-detail'));
  assert.equal(s.m.el.querySelectorAll('button').length, 1, 'no Improve button in this slice');
});

test('a re-check keeps the same node, label and badge while it is pending and in flight; the reply patches in place', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  const b = badge(node);
  s.m.input(OTHER);
  assert.equal(chips(s)[0], node);
  assert.equal(b.textContent, 'Needs detail');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(chips(s)[0], node, 'in flight: same node');
  assert.equal(picker(node).textContent, 'Implementation task');
  s.grades.at(-1).reply(reply(s.grades.at(-1), { kind: 'bug', grade: 'clear' }));
  await flush();
  assert.equal(chips(s)[0], node);
  assert.equal(badge(node), b, 'the badge node is patched, not replaced');
  assert.equal(picker(node).textContent, 'Bug report');
  assert.equal(b.textContent, 'Clear');
  assert.ok(b.classList.contains('is-clear') && !b.classList.contains('is-needs-detail'));
});

test('a deterministic reply (model unavailable, grade null) shows the picker and 0 badges', async (t) => {
  const s = setup(t);
  await s.graded(TASK, { grade: null, source: 'deterministic' }, { source: 'deterministic', error: 'model unavailable' });
  assert.equal(chips(s).length, 1);
  assert.equal(picker(s.m.el).textContent, 'Implementation task');
  assert.equal(badge(s.m.el), null);
  assert.equal(s.m.el.dataset.grade, '');
});

test('a skip or a non-task hides the chip (node detached, kept); the next task shows the same node at the same spot', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  s.m.input('What does the review step do?');
  assert.equal(chips(s).length, 0);
  await s.graded(OTHER, { isTask: false, kind: 'conversation' });
  assert.equal(chips(s).length, 0);
  await s.graded(TASK, { kind: 'bug' });
  assert.equal(chips(s)[0], node);
  assert.equal(node.parentNode, s.host);
});

test('off: no fetch at all, and turning the setting off hides a shown chip and cancels its check', async (t) => {
  const s = setup(t, { on: false });
  assert.equal(promptCheckOn(), false);
  s.m.input(TASK);
  s.timers.advance(10_000);
  assert.equal(s.grades.length, 0);
  setPromptCheckPref(true);
  await s.graded();
  assert.equal(chips(s).length, 1);
  s.m.input(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const inflight = s.grades.at(-1);
  setPromptCheckPref(false);
  assert.equal(chips(s).length, 0);
  assert.equal(inflight.aborted, true);
});

test('turning the setting on re-checks a field already filled while it was off, silently (a card mounted before the pref)', async (t) => {
  const s = setup(t, { on: false });
  s.m.input(TASK, { silent: true });
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 0);
  setPromptCheckPref(true);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 1);
  assert.equal(s.grades[0].body.text, TASK);
  s.grades[0].reply(reply(s.grades[0]));
  await flush();
  assert.equal(chips(s).length, 1);
  assert.deepEqual(s.said, [], 'the re-check is a mount-time check: shown, not announced');
  setPromptCheckPref(true);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, 1, 'on while already on: nothing re-checked');
});

test('the same text after a hidden chip is checked again: a short question, a clear, or the setting off and on', async (t) => {
  const s = setup(t);
  await s.graded();
  s.m.input('What does the review step do?');
  assert.equal(chips(s).length, 0);
  await s.graded(TASK);
  assert.equal(chips(s).length, 1, 'after a short question');
  s.m.input('');
  assert.equal(chips(s).length, 0);
  await s.graded(TASK);
  assert.equal(chips(s).length, 1, 'after a clear');
  setPromptCheckPref(false);
  setPromptCheckPref(true);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.grades.at(-1).reply(reply(s.grades.at(-1)));
  await flush();
  assert.equal(chips(s).length, 1, 'after off and on');
  const n = s.grades.length;
  s.m.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.length, n, 'a shown chip still skips the same text');
});

test('a kind pick: the new label at once, the badge removed, a regrade with the kind, and one POST of ids only', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  picker(node).click();
  const menu = s.doc.querySelector('[role="menu"]');
  assert.equal(menu.getAttribute('aria-label'), 'Prompt kind');
  const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
  assert.equal(items.length, 7);
  assert.equal(items.find((i) => i.getAttribute('aria-checked') === 'true').textContent, 'Implementation task');
  items.find((i) => i.textContent === 'Bug report').click();
  assert.equal(chips(s)[0], node);
  assert.equal(picker(node).textContent, 'Bug report');
  assert.equal(badge(node), null);
  assert.equal(s.grades.at(-1).body.kind, 'bug');
  await flush();
  assert.deepEqual(s.posts, [{ surface: 'chat', threadId: 'ask_1', proposedKind: 'implementation', chosenKind: 'bug' }]);
  s.grades.at(-1).reply(reply(s.grades.at(-1), { kind: 'bug', grade: 'clear' }));
  await flush();
  assert.equal(badge(node).textContent, 'Clear');
  picker(node).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Bug report').click();
  await flush();
  assert.equal(s.posts.length, 1, 'picking the same kind does nothing');
});

test('a deferred correction: no POST at the pick; the last pick is flushed once with the run id; it survives sent()', async (t) => {
  const s = setup(t, { mount: { surface: { kind: 'new-run', id: 'form' }, ids: {}, deferCorrection: true } });
  assert.equal(await s.m.flushCorrection({ runId: 'run_1' }), undefined);
  assert.equal(s.posts.length, 0, 'no pick, no POST');
  await s.graded();
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Idea').click();
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Plan').click();
  await flush();
  assert.equal(s.posts.length, 0);
  assert.deepEqual(s.m.pendingCorrection(), { proposedKind: 'implementation', chosenKind: 'plan' });
  s.m.sent(TASK);
  assert.equal(chips(s).length, 0);
  await s.m.flushCorrection({ runId: 'run_1' });
  assert.deepEqual(s.posts, [{ surface: 'new-run', runId: 'run_1', proposedKind: 'implementation', chosenKind: 'plan' }]);
  assert.equal(s.m.pendingCorrection(), null);
  await s.m.flushCorrection({ runId: 'run_2' });
  assert.equal(s.posts.length, 1);
});

test('a deferred correction dies with its draft: clearing and retyping, or disposing, leaves 0 corrections to flush', async (t) => {
  const s = setup(t, { mount: { surface: { kind: 'new-run', id: 'form' }, ids: {}, deferCorrection: true } });
  await s.graded();
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Plan').click();
  await flush();
  assert.ok(s.m.pendingCorrection());
  s.m.input('');
  assert.equal(s.m.pendingCorrection(), null, 'a cleared draft drops it');
  await s.graded(OTHER);
  await s.m.flushCorrection({ runId: 'run_1' });
  assert.deepEqual(s.posts, []);
  picker(s.m.el).click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === 'Idea').click();
  await flush();
  s.m.dispose();
  await s.m.flushCorrection({ runId: 'run_2' });
  assert.deepEqual(s.posts, [], 'a disposed chip drops it');
});

test('announce: once per changed kind or grade, politely, focus untouched; a silent mount-time result and a hidden chip say nothing', async (t) => {
  const s = setup(t);
  s.m.input(TASK, { silent: true });
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.grades.at(-1).reply(reply(s.grades.at(-1)));
  await flush();
  assert.equal(chips(s).length, 1);
  assert.deepEqual(s.said, [], 'the mount-time grade is silent');
  await s.graded(OTHER);
  assert.deepEqual(s.said, [], 'same kind and grade: nothing new to say');
  await s.graded(`${OTHER} With a CSV export and a chart for the finance team.`, { grade: 'clear' });
  assert.deepEqual(s.said, ['Prompt check: Implementation task, clear']);
  assert.equal(s.doc.activeElement, s.field);
  await s.graded(TASK, { isTask: false, kind: 'question' });
  assert.equal(s.said.length, 1, 'hidden: nothing said');
});

test('typing aborts the in-flight check (its signal aborted)', async (t) => {
  const s = setup(t);
  s.m.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const first = s.grades.at(-1);
  s.m.input(OTHER);
  assert.equal(first.aborted, true);
});

test('a stale reply (an older request, or another text) is dropped: node, label, data-grade and badge unchanged', async (t) => {
  const s = setup(t);
  await s.graded();
  const node = s.m.el;
  s.m.input(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const call = s.grades.at(-1);
  call.reply({ ...reply(call, { kind: 'bug', grade: 'clear' }), requestId: 'chat-0' });
  await flush();
  s.m.input(THIRD);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const c2 = s.grades.at(-1);
  c2.reply({ ...reply(c2, { kind: 'bug', grade: 'clear' }), textHash: textHash(OTHER) });
  await flush();
  assert.equal(chips(s)[0], node);
  assert.equal(picker(node).textContent, 'Implementation task');
  assert.equal(node.dataset.grade, 'needs-detail');
  assert.equal(badge(node).textContent, 'Needs detail');
});

test('continuesRequirement false empties the window of the next check', async (t) => {
  const s = setup(t);
  await s.graded();
  s.m.sent(TASK);
  await s.graded(OTHER, { continuesRequirement: false });
  s.m.input(`${TASK} And a PDF too, for the board.`);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.deepEqual(s.grades.at(-1).body.window, []);
});

test('the chip markup comes from the library and dispose removes the node and stops the grader', async (t) => {
  const s = setup(t, { mount: { forceTask: true, surface: { kind: 'run-card', id: 'card_1' }, ids: { threadId: 'ask_1', cardId: 'card_1' } } });
  s.m.input('Fix it?');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  assert.equal(s.grades.at(-1).body.forceTask, true, 'a forced surface grades a short question');
  s.grades.at(-1).reply(reply(s.grades.at(-1)));
  await flush();
  assert.ok(s.m.el.querySelector('.spick > .spick-b[data-menu]'));
  assert.ok(s.m.el.querySelector('.kind-chip.pcheck-grade'));
  assert.ok(s.m.el.classList.contains('pcheck'));
  s.m.input(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  const live = s.grades.at(-1);
  s.m.dispose();
  assert.equal(live.aborted, true);
  assert.equal(chips(s).length, 0);
});

test('narrow widths: no .pcheck rule clips or ellipsizes a label or fixes a width, and both host rows keep flex-wrap: wrap', async () => {
  const { readFileSync } = await import('node:fs');
  const css = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const ds = css('ui/public/design-system/design-system.css');
  const rules = [...ds.matchAll(/([^{}]*\.pcheck[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 2, 'the .pcheck rules exist');
  for (const [, sel, body] of rules) {
    assert.doesNotMatch(body, /text-overflow|overflow\s*:\s*hidden|(?:^|;)\s*width\s*:|(?:min|max)-width\s*:\s*\d+(?:px|em|rem|ch)/, sel);
  }
  assert.match(rules.find(([, sel]) => /(?:^|\s)\.pcheck$/.test(sel.trim()))[2], /flex-wrap:\s*wrap/);
  for (const [file, sel] of [['ui/public/chat/chat-shell.css', 'chat-composer-lead'], ['ui/public/chat/run-proposal.css', 'ask-rp-brief-foot']]) {
    const body = new RegExp(`\\.${sel}\\{([^}]*)\\}`).exec(css(file))[1];
    assert.match(body, /flex-wrap:\s*wrap/, sel);
    assert.doesNotMatch(body, /overflow\s*:\s*hidden/, sel);
  }
});
