// test/helpers/stillhet-chat-prompt-check.mjs — the live Chat host (stillhet-chat-live-host.mjs) with the prompt check
// wired: Settings › Chat › Prompt check from the /api/settings source, dev's fake timers through
// __worcaTestHooks.promptCheckTimers, the composer's module import handed to the host, and every /api/prompt-check/* POST
// held until the test answers it. Shared by test/stillhet-chat-prompt-check-chip.test.mjs, -improve.test.mjs and -scope.test.mjs.
import { liveHost, SOURCES, clone, settle, go } from './stillhet-chat-live-host.mjs';
import { fakeTimers, reply, TASK } from './prompt-check-chip-host.mjs';
import { PROMPT_CHECK_DEBOUNCE_MS } from '../../src/shared/prompt-check/filter.mjs';
import { normalizeRewrite, rewriteText } from '../../src/shared/prompt-check/improve.mjs';

export { TASK, reply, settle, PROMPT_CHECK_DEBOUNCE_MS };
export const PC = '/api/prompt-check/';

/** The default answers of the chat routes: Chat home's send makes ask_new. `ask(url, body, method)` may answer first. */
const chatWrite = (url, body, method) => {
  if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
  if (url.endsWith('/messages')) return [202, { userMessageId: 'u1', assistantMessageId: 'a1' }];
  return [200, {}];
};

export async function pcHost({ on = true, sources = SOURCES, ask = null, hash = '#chat', ...rest } = {}) {
  const src = clone(sources);
  src.settings = { ...(src.settings || {}), chat: { ...(src.settings?.chat || {}), promptCheck: on } };
  const timers = fakeTimers();
  const held = [];   // every /api/prompt-check/* POST, answered by the test: answer(data, status)
  const write = async (url, body, method) => {
    if (url.startsWith(PC)) return new Promise((resolve) => { held.push({ url, body, answer: (data, status = 200) => resolve([status, data]) }); });
    return (ask && (await ask(url, body, method))) || chatWrite(url, body, method);
  };
  const h = await liveHost({ sources: src, write, hash, beforeScripts: (win) => { win.__worcaTestHooks = { promptCheckTimers: timers }; }, ...rest });
  h.w.RailConversation.importPromptCheck = () => import('../../ui/public/stillhet/chat/prompt-check.mjs');
  const where = rest.where || '#route-chat';
  const q = (sel) => h.d.querySelector(`${where} ${sel}`);
  const box = () => q('[data-composer-t]');
  const type = async (text) => { const t = box(); t.focus(); t.value = text; t.dispatchEvent(new h.w.Event('input', { bubbles: true })); await settle(10); };
  const quiet = async () => { timers.advance(PROMPT_CHECK_DEBOUNCE_MS); await settle(10); };
  const grades = () => held.filter((c) => c.url === `${PC}grade`);
  const pcCalls = () => h.calls.filter((c) => c.url.startsWith(PC));
  /** Type, wait out the debounce and answer the grade with `assessment` (an implementation task that needs detail). */
  const graded = async (text = TASK, assessment = {}) => {
    await type(text); await quiet();
    const call = grades().at(-1);
    call.answer(reply(call, assessment));
    await settle(20);
    return call;
  };
  /** Settings › Chat › Prompt check turned on or off: the store reads the settings again, then Settings' event. */
  const setOn = async (v) => {
    src.settings.chat.promptCheck = v;
    h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'settings-changed' }) });
    await settle(400);
    h.w.dispatchEvent(new h.w.Event('rail-settings'));
    await settle(10);
  };
  return { ...h, src, timers, held, q, box, type, quiet, grades, pcCalls, graded, setOn };
}
export const pcNode = (s) => s.q('[data-pc]');
export const picker = (s) => s.q('[data-pc] [data-menu="cp-pcheck"]');
export const gradeText = (s) => s.q('[data-pc] [data-pc-say]')?.textContent || '';

/** Improve: a model rewrite for an /improve call, the held calls, the button, the suggestion, and the host with Improve pressed (opened) or answered (ready). */
export function okReply(call, { kind = 'implementation', sections = [{ id: 'change', text: 'Add a CSV export button to Insights.' }], paths = [], model = 'Sonnet 5.5' } = {}) {
  const rewrite = normalizeRewrite({ sections }, kind);
  return { requestId: call.body.requestId, source: 'model', kind, model, rewrite, text: rewriteText(rewrite), paths };
}
export const improves = (s) => s.held.filter((c) => c.url === `${PC}improve`);
export const improveBtn = (s) => s.q('[data-pc] [data-pc-improve-open]');
export const view = (s) => s.q('[data-pc-improve] [data-prompt-improve]');
/** Needs detail, then Improve pressed: the request is out. */
export async function opened(o = {}) {
  const s = await pcHost(o);
  if (o.chat) await go(s.w, `#chat/${o.chat}`);
  await s.graded(TASK, { grade: 'needs-detail', openDecisions: ['Which columns?'] });
  improveBtn(s).click(); await settle(10);
  return s;
}
export async function ready(o = {}) {
  const s = await opened(o);
  const call = improves(s).at(-1);
  call.answer(okReply(call, o.reply)); await settle(20);
  return s;
}
