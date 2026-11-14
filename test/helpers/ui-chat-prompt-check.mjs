// test/helpers/ui-chat-prompt-check.mjs — shared setup for test/ui-chat-prompt-check-1/-2.test.mjs: the prompt check
// chip inside the real Ask panel, fake timers, the grade fetch held on a deferred promise per call. open() closes its
// window with t.after inside the test that opened it.
import { makePanel } from './ask-panel-harness.mjs';
import { registerComposerAddon } from '../../ui/public/chat/extensions.mjs';
import { installIntentAddon } from '../../ui/public/chat/intent.mjs';
import { installPromptCheckAddon } from '../../ui/public/chat/prompt-check.mjs';
import { setPromptCheckPref } from '../../ui/public/prompt-check/chip-host.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../../src/shared/prompt-check/filter.mjs';

export const TID = 'ask_00000001';
export const NEW_TID = 'ask_00000777';
export const THREAD = { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };
export const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
export const REWRITE = 'Change: Add the export.\nWhere: [Architect · decide: which files or modules?]';
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

export function api(rec) {
  rec.grades = [];
  rec.corrections = [];
  rec.calls = [];
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    rec.calls.push(`${method} ${url}`);
    if (url === '/api/prompt-check/grade') {
      return new Promise((resolve, reject) => {
        const call = { body: JSON.parse(opts.body), aborted: false };
        opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        call.reply = (assessment = {}) => resolve({ ok: true, status: 200, json: async () => ({
          requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
          assessment: { isTask: true, kind: 'implementation', grade: 'needs-detail', continuesRequirement: true, ...assessment },
        }) });
        rec.grades.push(call);
      });
    }
    if (url === '/api/prompt-check/improve') {
      const b = JSON.parse(opts.body);
      (rec.improves ||= []).push(b);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ requestId: b.requestId, source: 'model', kind: b.kind, model: 'Sonnet 5.5',
        rewrite: { kind: b.kind, sections: [{ id: 'change', label: 'Change', text: 'Add the export.', gaps: [] }] }, text: REWRITE, paths: [] }) });
    }
    if (url === '/api/prompt-check/kind-correction') {
      rec.corrections.push(JSON.parse(opts.body));
      return { ok: true, status: 201, json: async () => ({ ok: true, at: 't' }) };
    }
    if (url === '/api/ask/threads' && method === 'POST') {
      if (rec.refuseCreate) return { ok: false, status: 500, json: async () => ({ error: 'no' }) };
      return { ok: true, status: 201, json: async () => ({ thread: { ...THREAD, id: NEW_TID } }) };
    }
    if (/\/api\/ask\/threads\/[^/]+\/messages$/.test(url) && method === 'POST') {
      if (rec.refuseMessage) return { ok: false, status: 429, json: async () => ({ error: 'slow down' }) };
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', attachments: [], contexts: [] }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

export async function open(t, { on = true, thread = true, extra = null } = {}) {
  const timers = fakeTimers();
  const intent = installIntentAddon({ win: { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} } });
  installPromptCheckAddon({ intent, timers });
  if (extra) registerComposerAddon(extra);
  setPromptCheckPref(on);
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  t.after(() => { ctx.panel.destroy(); setPromptCheckPref(false); ctx.window.close(); });
  if (thread) ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  const input = ctx.doc.querySelector('textarea.ask-input');
  const type = (text) => { input.value = text; input.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };
  const settle = async () => { for (let i = 0; i < 4; i++) await ctx.tick(); ctx.flush(); };
  const graded = async (text = TASK, assessment = {}) => {
    type(text);
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    rec.grades.at(-1).reply(assessment);
    await settle();
  };
  return { ctx, rec, timers, intent, input, type, settle, graded, doc: ctx.doc };
}
export const chips = (s) => s.doc.querySelectorAll('[data-prompt-check]');
export const lead = (s) => s.doc.querySelector('.chat-composer-lead');
export const promptCheckCalls = (s) => s.rec.calls.filter((c) => c.includes('/api/prompt-check/'));
export const pickKind = async (s, label) => {
  chips(s)[0].querySelector('button').click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === label).click();
  await s.settle();
};
