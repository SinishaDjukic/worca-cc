// test/ui-design-view.test.mjs — the Design page (ui/public/design/view.mjs): the Library on `#design`, a design's
// address handed to `openDesign` (its chat opens on the Chat page: test/ui-design-studio.test.mjs), a bad id, and the
// frames' route to the nav count and the Library. The rig is a JSDOM page holding the sidebar's Design row and `#design-host`, its
// window on the fake clock (as test/helpers/design-stage-rig.mjs), and a fake `fetch` by route.
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
test('#design opens the real library', async () => {
  const { view, q, qa, route, setList } = rig();
  setList([{ id: DID, title: 'Apsida', kind: 'web', status: 'done', updatedAt: 'x', costUsd: 4.2, thumb: null }]);
  await view.show('');
  assert.ok(q('.dz-lib .dz-hero'));
  assert.equal(qa('.dz-lib a.dz-tile').length, 1);
  assert.equal(q('.dz-lib a.dz-tile .dz-tile-t').textContent, 'Apsida');
  q('.dz-lib a.dz-tile').click();
  assert.deepEqual(route.at(-1), DID, 'the tile\'s #design/<id> reaches P4\'s route as the id');
  setList([]); await view.show('');
  assert.equal(q('.dz-lib-body').hidden, true);
  setList(null); await view.show('');
  assert.match(q('.dz-lib-err').textContent, /^Could not load designs/);
  assert.ok([...qa('.dz-lib-err button')].some((b) => b.textContent === 'Try again'));
});
test('the open library takes the C-5 frames: a round\'s end loads the list again; a left library takes none', async () => {
  const { view, q, gets, clock, tick, setList } = rig({ detail: DETAIL });
  setList([{ id: DID, title: 'Apsida', kind: 'web', status: 'building', updatedAt: 'x', costUsd: 0, thumb: null }]);
  await view.show('');
  const listed = () => gets.filter((u) => u === '/api/design').length;
  const n = listed();
  view.pushFrame(build('paused'));
  assert.match(q('.dz-lib a.dz-tile .dz-tile-m').textContent, /Paused/, 'in place');
  view.pushFrame(build('done'));
  clock.tick(200); await tick();
  assert.equal(listed(), n + 1);
  view.leave();
  view.pushFrame(build('done'));
  clock.tick(1000); await tick();
  assert.equal(listed(), n + 1, 'the left library is gone');
});
test('#design/<id> opens that design\'s chat; a bad id leads back to the Library', async () => {
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
test('the library: nothing for 300 ms, then one loading line; a failure says so with Try again; an older answer paints nothing', async () => {
  const { view, q, qa, clock, hold, tick, setList } = rig();
  await view.show('');
  clock.tick(1000);
  assert.equal(q('.dz-lib-load'), null, 'a list that came in time is not covered by the loading line');
  const release = hold('/api/design');
  const shown = view.show('');
  await tick();
  clock.tick(299);
  assert.equal(q('.dz-lib-load'), null, 'nothing changes for 300 ms');
  clock.tick(1);
  assert.equal(q('.dz-lib-load').textContent, 'Loading designs…');
  assert.equal(q('.dz-lib-load').getAttribute('aria-busy'), 'true');
  release(); await shown;
  assert.equal(q('.dz-lib-load'), null);
  setList(null); await view.show('');
  assert.match(q('.dz-lib-err').textContent, /^Could not load designs/);
  setList([]);
  [...qa('.dz-lib-err button')].find((b) => b.textContent === 'Try again').click(); await tick();
  assert.equal(q('.dz-lib-err'), null, 'Try again loads the list again');
  setList(null);
  const late = hold('/api/design');
  const older = view.show('');
  setList([{ id: DID, title: 'Apsida', kind: 'web', status: 'empty', updatedAt: 'x', costUsd: 0, thumb: null }]);
  await view.show('');
  late(); await older;
  assert.equal(qa('.dz-lib a.dz-tile').length, 1, 'an older failure does not paint over the newer list');
  assert.equal(q('.dz-lib-err'), null);
});
test('the Library\'s Send creates the design and opens it: its address goes to the route, then to its chat', async () => {
  const { view, win, q, posts, route, opened, tick } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, id: NEW_ID } } });
  await view.show(''); await tick();
  const input = q('.dz-hero textarea.dz-input');
  input.value = 'A launch page';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  q('.dz-hero .ask-send').click(); await tick();
  assert.deepEqual(posts.map((p) => p.url), ['/api/design']);
  assert.equal(route.at(-1), NEW_ID, 'the 201 opens the new design');
  await view.show(NEW_ID);
  assert.deepEqual(opened, [NEW_ID]);
});
