// A rig for the Design stage controller (ui/public/design/stage.mjs): a JSDOM page holding the view's
// `section.dz-stage`, its window's timers, animation frames and `performance` on the shared fake clock
// (test/helpers/design-clock.mjs), `matchMedia` answering the reduced-motion query, a fake `fetch` by route table, and
// spies for the socket, the prompt, the chat's pins and the Plan list's rows. `rig` opens the stage on `detail` and paints once.
//
//   readyFrame(mode)   the newest iframe says `ready`; what the stage posts to it from then on lands in `sent()`
//   fireMsg(t, fields) a C-6 message from the frame host's current frame (the one that is not `.is-next`)
//   paint()            one animation frame, or 500 ms of the clock under reduced motion (the stage paints at 2 Hz)
//   tick()             flushes microtasks (a fetch, a mint)
import { JSDOM } from 'jsdom';
import { fakeClock } from './design-clock.mjs';
import { createStage } from '../../ui/public/design/stage.mjs';

const NS = 'worca-design';
const TOKEN_BASE = '/design-preview/TOK';
const TOKEN_TTL_MS = 43200000;

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reply(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

/**
 * @param {object} detail `GET /api/design/:id`'s answer
 * @param {{size?: number[], reduced?: boolean, files?: Record<string, string>,
 *   answers?: Record<string, [number, object]>, epoch?: number}} [o] `size` is the `.dz-wrap`'s
 *   `[clientWidth, clientHeight]`; `files` maps GET paths to the text served there; `answers` maps a POST path to the
 *   status and body it gets instead of its route's success; `epoch` is the page's `performance.timeOrigin`, so the
 *   mint's `expiresAt` is epoch ms as P3's is
 */
export async function rig(detail, { size = [1096, 900], reduced = false, files = {}, answers = {}, epoch = 0 } = {}) {
  const clock = fakeClock();
  const dom = new JSDOM('<!doctype html><html><body><section class="dz-stage"></section></body></html>', { url: 'http://localhost/' });
  const win = dom.window;
  const doc = win.document;
  // JSDOM has no scrollIntoView (the Agents popover scrolls its picked row into view).
  win.Element.prototype.scrollIntoView = function scrollIntoView() {};
  Object.assign(win, {
    setTimeout: clock.set, clearTimeout: clock.clear, requestAnimationFrame: clock.raf, cancelAnimationFrame: clock.cancelRaf,
  });
  // The page starts at the fake clock's 0, so its wall clock (`timeOrigin + now()`) is `epoch + clock.now`, the clock the
  // mint's `expiresAt` below is in.
  Object.defineProperty(win, 'performance', { configurable: true, value: { now: () => clock.now, timeOrigin: epoch } });
  win.matchMedia = (query) => ({
    matches: reduced && /prefers-reduced-motion:\s*reduce/.test(query), media: query,
    addEventListener() {}, removeEventListener() {},
  });

  const designId = detail?.design?.id;
  const posts = [];
  const gets = [];
  let minted = 0;
  async function fetch(url, init = {}) {
    if (String(init.method ?? 'GET').toUpperCase() === 'POST') {
      posts.push({ url, body: JSON.parse(init.body ?? '{}') });
      if (Object.hasOwn(answers, url)) return reply(...answers[url]);
      if (url === `/api/design/${designId}/preview-token`) {
        minted += 1;
        return reply(200, { base: TOKEN_BASE, expiresAt: epoch + clock.now + TOKEN_TTL_MS });
      }
      if (url.endsWith('/continue')) return reply(202, { ok: true });
      if (url.endsWith('/stop')) return reply(200, { ok: true });
      return reply(404, { error: 'not found' });
    }
    gets.push(url);
    if (Object.hasOwn(files, url)) return reply(200, files[url]);
    if (url === `/api/design/${designId}`) return reply(200, detail);
    return reply(404, { error: 'not found' });
  }
  const ws = [];
  const prompts = [];
  const picks = [];
  const plans = [];

  const host = doc.querySelector('.dz-stage');
  const stage = createStage({
    doc, win, host, design: detail.design, fetch,
    sendWs: (m) => { ws.push(m); },
    prompt: (o) => { prompts.push(o); return Promise.resolve(null); },
    onPicked: (p) => { picks.push(p); },
    onPlan: (rows) => { plans.push(rows); },
  });
  const wrap = doc.querySelector('.dz-wrap');
  Object.defineProperty(wrap, 'clientWidth', { configurable: true, get: () => size[0] });
  Object.defineProperty(wrap, 'clientHeight', { configurable: true, get: () => size[1] });

  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => doc.querySelectorAll(sel);
  const frames = () => [...doc.querySelectorAll('iframe')];
  const nonce = (f) => /#n=([^&#]*)$/.exec(f.getAttribute('src'))[1];
  const sent = [];
  const fire = (f, data) => {
    win.dispatchEvent(Object.assign(new win.Event('message'), { source: f.contentWindow, origin: 'null', data }));
  };
  const readyFrame = (mode) => {
    const f = frames().at(-1);
    f.contentWindow.postMessage = (m) => { sent.push(m); };
    fire(f, { ns: NS, v: 1, n: nonce(f), t: 'ready', mode, vw: 1440, vh: 900, dpr: 1 });
  };
  const fireMsg = (t, fields = {}) => {
    const f = frames().find((x) => !x.classList.contains('is-next'));
    fire(f, { ...fields, ns: NS, v: 1, n: nonce(f), t });
  };
  const paint = () => {
    if (reduced) clock.tick(500);
    else clock.frame();
  };

  await stage.open(detail);
  await flush();
  paint();
  return {
    stage, win, doc, clock, posts, gets, ws, prompts, picks, plans, mints: () => minted,
    frames, readyFrame, fireMsg, sent: () => sent, paint, tick: flush, q, qa,
  };
}
