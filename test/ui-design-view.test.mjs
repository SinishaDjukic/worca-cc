// test/ui-design-view.test.mjs — the Design page (ui/public/design/view.mjs): `#design` draws nothing of its own (app.js
// sends it to the design start, test/ui-design-route.test.mjs), a design's address handed to `openDesign` (its chat opens
// on the Chat page: test/ui-design-studio.test.mjs), a bad id, and the frames' route to the nav count. The rig is a
// JSDOM page holding the sidebar's Design row and `#design-host`, its window on the fake clock (as
// test/helpers/design-stage-rig.mjs), and a fake `fetch` by route.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { DID, build } from './helpers/design-stage-frames.mjs';
import { mountDesignView } from '../ui/public/design/view.mjs';

const trackDom = useDomRelease(afterEach);
const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().destroy(); });

const NEW_ID = 'd_0000000000aa';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function reply(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

/**
 * @param {{detail?: object, detailStatus?: number, createChat?: Function, createAnswer?: [number, object],
 *   promptAnswers?: Array<object|null>, confirmAnswers?: boolean[], pictures?: object[]}} [o]
 *   `detail` answers `GET /api/design/:id`, `detailStatus` answers it with that error instead; `pictures` answers
 *   `GET /api/design/<DID>/pictures` (absent: 404); `createAnswer` is what
 *   `POST /api/design` gets instead of its 201. `hold(url)` keeps the next GET of `url` until the returned release
 *   runs; that GET answers what was set when it was asked. The page's prompt resolves `promptAnswers` in order, then
 *   null; with `confirmAnswers` the page has a confirm that resolves them in order. PATCH and DELETE land in `sent`.
 */
function rig({ detail, detailStatus, createAnswer, pictures } = {}) {
  const clock = fakeClock();
  const dom = trackDom(new JSDOM(`<!doctype html><html><body>
    <nav class="nav"><button type="button" data-nav="design">Design<span class="nav-count n-grey" id="nav-design-count" hidden></span></button></nav>
    <main class="main"><section class="view" data-view="design"><div id="design-host"></div></section></main>
  </body></html>`, { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  win.Element.prototype.scrollIntoView = function scrollIntoView() {};
  Object.assign(win, {
    setTimeout: clock.set, clearTimeout: clock.clear, requestAnimationFrame: clock.raf, cancelAnimationFrame: clock.cancelRaf,
  });
  Object.defineProperty(win, 'performance', { configurable: true, value: { now: () => clock.now, timeOrigin: 0 } });
  win.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });

  let list = [];
  const posts = [];
  const gets = [];
  const sent = [];
  const holds = new Map();   // url -> the promise the next GET of it waits for
  const hold = (url) => {
    let release;
    holds.set(url, new Promise((resolve) => { release = resolve; }));
    return () => release();
  };
  async function fetch(url, init = {}) {
    const method = String(init.method ?? 'GET').toUpperCase();
    if (method === 'PATCH' || method === 'DELETE') {
      const body = init.body == null ? null : JSON.parse(init.body);
      sent.push({ method, url, ...(body ? { body } : {}) });
      return method === 'PATCH' ? reply(200, { ...detail?.design, ...body }) : reply(200, { ok: true });
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body ?? '{}');
      posts.push({ url, body });
      if (url === '/api/design') {
        if (createAnswer) return reply(...createAnswer);
        return reply(201, { design: { id: NEW_ID, kind: body.kind, title: 'Untitled design', version: 0, threadId: null }, threadId: null });
      }
      if (/^\/api\/design\/d_[0-9a-f]{12}\/preview-token$/.test(url)) {
        return reply(200, { base: '/design-preview/TOK', expiresAt: clock.now + 43200000 });
      }
      return reply(404, { error: 'not found' });
    }
    gets.push(url);
    const answer = list;
    const held = holds.get(url);
    holds.delete(url);
    if (held) await held;
    if (url === '/api/design') return answer === null ? reply(500, { error: 'boom' }) : reply(200, answer);
    if (/^\/api\/design\/d_[0-9a-f]{12}$/.test(url)) {
      if (detailStatus) return reply(detailStatus, { error: 'Design not found' });
      return reply(200, detail);
    }
    if (url === `/api/design/${DID}/pictures` && pictures !== undefined) return reply(200, pictures);
    return reply(404, { error: 'not found' });
  }
  const route = [];
  const opened = [];
  const view = mountDesignView({
    doc, win, host: doc.getElementById('design-host'), fetch,
    route: (p) => { route.push(p); },
    openDesign: (id) => { opened.push(id); },
  });
  mounted.push(view);

  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => doc.querySelectorAll(sel);
  const setList = (v) => { list = v; };
  return {
    view, win, doc, clock, q, qa, route, opened, posts, gets, sent, setList, hold,
    paint: () => clock.frame(), tick: flush,
  };
}

const DETAIL = { design: { id: DID, kind: 'web', title: 'Apsida landing page', version: 0, threadId: 'ask_1' }, plan: null, build: null, sections: [], versions: [] };
test('#design draws no page of its own: nothing is fetched and its host stays empty', async () => {
  const { view, doc, gets } = rig();
  await view.show('');
  assert.equal(doc.getElementById('design-host').childElementCount, 0);
  assert.deepEqual(gets, []);
  view.pushFrame(build('done'));
  view.leave();
});
test('#design/<id> opens that design\'s chat; a bad id leads back to #design', async () => {
  const { view, q, route, opened } = rig({ detail: DETAIL });
  await view.show(DID);
  assert.deepEqual(opened, [DID]);
  assert.equal(q('.dz-studio'), null, 'no studio page: the design opens as its chat');
  await view.show('not-an-id');
  assert.deepEqual([opened.length, route.at(-1)], [1, '']);
});
test('frames count toward the nav; leave is cheap and idempotent; hello sets the count', async () => {
  const { view, doc } = rig();
  view.leave(); view.leave();
  view.pushFrame({ ...build('building'), designId: 'd_other' });
  assert.equal(doc.getElementById('nav-design-count').textContent, '1');
  view.onHello([], { rebooted: false });
  assert.equal(doc.getElementById('nav-design-count').hidden, true);
});

