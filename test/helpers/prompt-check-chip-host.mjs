// test/helpers/prompt-check-chip-host.mjs — shared setup for test/prompt-check-chip-host-1/-2.test.mjs: a bare JSDOM
// per test (setup() closes it with t.after inside the test), fake timers and a fake fetch.
import { JSDOM } from 'jsdom';

import { mountPromptCheckChip, setPromptCheckPref } from '../../ui/public/prompt-check/chip-host.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../../src/shared/prompt-check/filter.mjs';

export const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
export const THIRD = 'Rename the Statistics page to Insights everywhere in the navigation, the page head and the docs links.';
export const OTHER = 'Build a Slack notifier that posts a message when a run fails, with the run title, the step and a link.';

export function fakeTimers() {
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

export function fakeFetch() {
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

export const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
export const reply = (call, assessment = {}, extra = {}) => ({
  requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
  assessment: { isTask: true, kind: 'implementation', grade: 'needs-detail', continuesRequirement: true, ...assessment }, ...extra,
});

export function setup(t, o = {}) {
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
export const chips = (s) => s.host.querySelectorAll('[data-prompt-check]');
export const badge = (el) => el.querySelector('.pcheck-grade');
export const picker = (el) => el.querySelector('button');
