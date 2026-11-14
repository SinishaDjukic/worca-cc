// test/ui-design-view.test.mjs — the Design page (ui/public/design/view.mjs): the library on `#design`, the
// studio on `#design/<id>` (the chat column beside the stage), a bad id, the frames' route to the nav count, the stage
// and the chat, and P5's chat seam. The rig is a JSDOM page holding the sidebar's Design row and `#design-host`, its
// window on the fake clock (as test/helpers/design-stage-rig.mjs), and a fake `fetch` by route.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { DID, BID, A1, build, plan, agent, snapshot } from './helpers/design-stage-frames.mjs';
import { mountDesignView } from '../ui/public/design/view.mjs';

const trackDom = useDomRelease(afterEach);
const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().destroy(); });

const NS = 'worca-design';
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
function rig({ detail, detailStatus, createChat, createAnswer, promptAnswers = [], confirmAnswers, pictures } = {}) {
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
  const ws = [];
  const prompts = [];
  const confirms = [];
  const view = mountDesignView({
    doc, win, host: doc.getElementById('design-host'), fetch,
    sendWs: (m) => { ws.push(m); },
    route: (p) => { route.push(p); },
    prompt: (o) => { prompts.push(o); return Promise.resolve(promptAnswers.shift() ?? null); },
    ...(confirmAnswers ? { confirm: (o) => { confirms.push(o); return Promise.resolve(confirmAnswers.shift() ?? false); } } : {}),
    ...(createChat ? { createChat } : {}),
  });
  mounted.push(view);

  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => doc.querySelectorAll(sel);
  // A C-6 message from the stage's current frame (the one that is not `.is-next`). The frame host believes a frame only
  // after its `ready`, so the first message from a frame says `ready` first, in the mode its `src` names.
  const readied = new WeakSet();
  const post = (f, data) => {
    win.dispatchEvent(Object.assign(new win.Event('message'), { source: f.contentWindow, origin: 'null', data }));
  };
  const fireStageMsg = (t, fields = {}) => {
    const f = [...doc.querySelectorAll('iframe')].find((x) => !x.classList.contains('is-next'));
    const n = /#n=([^&#]*)$/.exec(f.getAttribute('src'))[1];
    if (!readied.has(f)) {
      readied.add(f);
      f.contentWindow.postMessage = () => {};
      const mode = /\/(build|run)\/#n=/.exec(f.getAttribute('src'))[1];
      post(f, { ns: NS, v: 1, n, t: 'ready', mode, vw: 1440, vh: 900, dpr: 1 });
    }
    post(f, { ...fields, ns: NS, v: 1, n, t });
  };
  const setList = (v) => { list = v; };
  return {
    view, win, doc, clock, q, qa, route, posts, gets, sent, ws, prompts, confirms, setList, hold, fireStageMsg,
    paint: () => clock.frame(), tick: flush,
  };
}

const DETAIL = { design: { id: DID, kind: 'web', title: 'Apsida landing page', version: 0, threadId: 'ask_1' }, plan: null, build: null, sections: [], versions: [] };
const ROW = { id: BID, designId: DID, round: 1, kind: 'first', status: 'building', reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null };
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
test('the open library takes the C-5 frames: a round\'s end loads the list again; the studio\'s frames do not reach a closed library', async () => {
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
  await view.show(DID); await tick();
  view.pushFrame(build('done'));
  clock.tick(1000); await tick();
  assert.equal(listed(), n + 1, 'the studio replaced the library');
});
test('#design/<id> shows the studio: chat column with title and kind, the stage beside it', async () => {
  const { view, q, tick } = rig({ detail: DETAIL });
  await view.show(DID); await tick();
  assert.equal(q('.dz-chat .dz-chat-title').textContent, 'Apsida landing page');
  assert.equal(q('.dz-chat .dz-kind').textContent, 'Web page');
  assert.ok(q('.dz-studio > .dz-chat + .dz-stage'));
  assert.ok(q('.chat-head-btn'));
  assert.ok(q('.dz-chat-slot .dz-plan'), 'the Plan list sits in the chat slot until the dock mounts it');
});
test('a bad or missing id says so and leads back', async () => {
  const { view, q, route, tick } = rig({ detailStatus: 404 });
  await view.show(DID); await tick();
  assert.match(q('#design-host').textContent, /Design not found/);
  q('#design-host button').click();
  assert.equal(route.at(-1), '');
  await view.show('not-an-id');
  assert.equal(route.at(-1), '');
});
test('frames: all count toward the nav; only the open design reaches the stage; the plan list follows them', async () => {
  const { view, q, doc, tick, paint } = rig({ detail: DETAIL });
  await view.show(DID); await tick();
  view.pushFrame({ ...build('building'), designId: 'd_other' });
  assert.equal(doc.getElementById('nav-design-count').textContent, '1');
  assert.equal(view.stage().model().status ?? null, null);
  view.pushFrame(build('building'));
  view.pushFrame(plan(['hero', 'price'])); paint();
  assert.equal(q('.dz-plan .dz-meta').textContent, '2 sections');
});
test('the chat seam: makes the chat with P5\'s names; forwards every C-5 frame including design-restored; picked goes to addPin; setPick and onRestored reach the stage', async () => {
  const made = []; const frames = []; const pins = [];
  const createChat = (o) => { made.push(o); return { pushDesignFrame: (f) => frames.push(f), addPin: (p) => pins.push(p), destroy() { made.destroyed = true; } }; };
  const { view, tick, fireStageMsg } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, version: 1 } }, createChat });   // a built design, so a frame exists to post from
  await view.show(DID); await tick();
  for (const k of ['confirm', 'design', 'doc', 'fetch', 'host', 'initial', 'onRestored', 'planList', 'renderMarkdown', 'sendWs', 'setPick', 'unpin']) assert.ok(k in made[0], k);   // P6 Task 9 added `initial`
  assert.ok(made[0].host.classList.contains('dz-chat-slot'));
  view.pushFrame({ type: 'design-restored', designId: DID, version: 3, restoredFrom: 1, ts: 1 });
  assert.equal(frames.at(-1).type, 'design-restored');
  view.pushFrame(build('building', { designId: 'd_other' }));
  assert.equal(frames.at(-1).type, 'design-restored', 'another design is not forwarded');
  fireStageMsg('picked', { id: 'hero', path: 'p', tag: 'h1', text: 't', html: 'h', rect: [1, 2, 3, 4] });
  assert.equal(pins[0].id, 'hero');
  view.leave();
  assert.equal(made.destroyed, true);
});
test('leave is cheap and idempotent; coming back opens fresh; hello forwards to the open stage', async () => {
  const { view, tick, ws } = rig({ detail: { ...DETAIL, build: ROW } });
  view.leave(); view.leave();
  await view.show(DID); await tick();
  const n = ws.length;
  view.onHello([], { rebooted: false });
  assert.equal(ws.length, n + 1);
  view.leave();
  view.onHello([], { rebooted: false });
  assert.equal(ws.length, n + 1);
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
test('the chat head\'s More: Rename repaints the title; Delete is off while the build is open, paused too, and leads to the library', async () => {
  const { view, q, qa, route, sent, tick } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, status: 'building' } }, promptAnswers: [{ title: 'Ship radar' }], confirmAnswers: [true] });
  await view.show(DID); await tick();
  const btn = q('.dz-chat .chat-head > .chat-head-btn');
  assert.deepEqual([btn.getAttribute('aria-label'), btn.title, btn.previousElementSibling.className], ['More', 'More', 'chat-head-spacer']);
  const items = () => [...qa('.menu.dz-more .menu-item')];
  btn.click();
  assert.equal(items()[1].getAttribute('aria-disabled'), 'true', 'opened building');
  btn.click();
  view.pushFrame(build('paused'));
  btn.click();
  assert.equal(items()[1].getAttribute('aria-disabled'), 'true', 'paused');
  btn.click();
  view.pushFrame(build('stopped'));
  btn.click();
  assert.equal(items()[1].hasAttribute('aria-disabled'), false, 'stopped');
  items()[0].click(); await tick();
  assert.deepEqual(sent.at(-1), { method: 'PATCH', url: `/api/design/${DID}`, body: { title: 'Ship radar' } });
  assert.deepEqual([q('.dz-chat-title').textContent, q('.dz-chat-title').title], ['Ship radar', 'Ship radar']);
  btn.click(); items()[1].click(); await tick();
  assert.deepEqual(sent.at(-1), { method: 'DELETE', url: `/api/design/${DID}` });
  assert.equal(route.at(-1), '', 'navigate(\'#design\') reaches P4\'s route as the library');
});
test('a slow GET paints nothing after a leave or a newer show; a second route keeps the open stage; the proof hook; a pin carries its tag', async () => {
  const pins = []; let chat = null;
  const createChat = (o) => { chat = o; return { addPin: (p) => pins.push(p) }; };
  const { view, win, q, qa, hold, tick, route, fireStageMsg } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, version: 1 } }, createChat });
  assert.equal(win.__design.view, view);
  assert.equal(win.__design.stage(), null);
  let release = hold(`/api/design/${DID}`);
  let slow = view.show(DID);
  await tick();
  view.leave();
  release(); await slow; await tick();
  assert.equal(q('#design-host').children.length, 0, 'the old show paints nothing after the leave');
  release = hold(`/api/design/${DID}`);
  slow = view.show(DID);
  await tick();
  await view.show('');
  release(); await slow; await tick();
  assert.equal(q('.dz-studio'), null, 'the old show paints nothing over a newer one');
  assert.ok(q('.dz-lib'));
  await view.show(DID); await tick();
  const stage = view.stage();
  assert.ok(stage);
  assert.equal(win.__design.stage(), stage);
  await view.show(DID);
  assert.equal(view.stage(), stage, 'a second route to the open design keeps its stage');
  fireStageMsg('picked', { id: 'hero', path: 'p', tag: 'h1', text: 'Ship it', html: 'h', rect: [1, 2, 3, 4] });
  assert.equal(pins[0].label, 'hero › "Ship it"', 'no plan: the section id stands for the job');
  chat.setPick(true);
  assert.equal(stage.model().wantPick, true, 'setPick reaches the stage');
  chat.unpin('hero', 'p');
  assert.deepEqual(stage.model().pins, [], 'unpin reaches the stage');
  const docs = qa('iframe').length;
  chat.onRestored(); await tick();
  assert.equal(qa('iframe').length, docs + 1, 'onRestored loads the run doc again');
  const n = route.length;
  await view.show('not-an-id');
  assert.deepEqual(route.slice(n), ['']);
  assert.equal(view.stage(), null);
  view.destroy();
  assert.equal(win.__design, undefined);
});
test('the Plan list\'s Retry posts continue once and shows the refusal (review M6: view passes the promise through)', async () => {
  const { view, win, q, posts, tick, paint } = rig({ detail: { ...DETAIL, build: ROW } });
  await view.show(DID); await tick();
  view.pushFrame(plan(['hero'])); view.pushFrame(build('stopped')); view.pushFrame({ type: 'design-section', designId: DID, buildId: BID, seq: 9000, ts: 1, sectionId: 'hero', status: 'stopped', agentId: null, summary: '' });
  paint();
  const b = q('.dz-retry-row button');
  b.click(); b.dispatchEvent(new win.Event('click'));
  assert.deepEqual(posts.filter((p) => p.url.endsWith('/continue')).map((p) => p.body), [{ sections: ['hero'] }]);
  await tick(); await tick();
  assert.equal(q('.dz-retry-row small').textContent, 'Could not retry');
  assert.equal(q('.dz-retry-row small').title, 'not found', 'the route\'s refusal, word for word');
  assert.equal(b.disabled, false);
});
test('leave destroys the stage: no timer, no animation frame and no window listener is left (review M9)', async () => {
  const { view, win, clock, tick, fireStageMsg } = rig({ detail: { ...DETAIL, build: ROW } });
  const live = new Map();
  const add = win.addEventListener.bind(win); const remove = win.removeEventListener.bind(win);
  win.addEventListener = (t, fn, o) => { live.set(fn, t); add(t, fn, o); };
  win.removeEventListener = (t, fn, o) => { live.delete(fn); remove(t, fn, o); };
  await view.show(DID); await tick();
  fireStageMsg('rects', { scrollX: 0, scrollY: 0, vw: 1440, vh: 900, docH: 4000, sections: [] });
  view.pushFrame(plan(['hero']));
  assert.ok([...live.values()].includes('message'), 'the stage\'s frame host listens');
  assert.ok(clock.pending() > 0, 'and has timers or a paint due');
  view.leave();
  assert.deepEqual([[...live.values()], clock.pending()], [[], 0]);
});
test('the head Export follows the round: hidden until done, shown by a done frame or a restore; the HUD Export opens its menu', async () => {
  const { view, win, q, tick, paint } = rig({ detail: { ...DETAIL, build: ROW } });
  await view.show(DID); await tick();
  const head = q('.dz-stage-head .dz-menu-anchor > button');
  assert.equal(head.hidden, true, 'a design that is not done has no Export');
  view.pushFrame(build('done')); paint();
  assert.equal(head.hidden, false);
  const hudExport = [...win.document.querySelectorAll('.dz-hud button')].find((b) => b.textContent === 'Export');
  assert.equal(hudExport.disabled, false, 'the HUD has its onExport now');
  hudExport.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(q('.menu.dz-export').hidden, false);
  view.pushFrame(build('building', { round: 2, kind: 'change' }));
  assert.deepEqual([head.hidden, q('.menu.dz-export').hidden], [true, true], 'a new round: nothing to export');
  view.pushFrame({ type: 'design-restored', designId: DID, version: 1, restoredFrom: 1, ts: 1 });
  assert.equal(head.hidden, false);
});
test('a snapshot moves Export and Delete as a design-build frame does: a reconnect or a late join that finds the round ended', async () => {
  const { view, win, q, qa, tick, paint } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, status: 'building' }, build: ROW } });
  await view.show(DID); await tick();
  const head = q('.dz-stage-head .dz-menu-anchor > button');
  const more = q('.dz-chat .chat-head > .chat-head-btn');
  const deleteOff = () => { more.click(); const off = [...qa('.menu.dz-more .menu-item')][1].getAttribute('aria-disabled') === 'true'; more.click(); return off; };
  assert.deepEqual([head.hidden, deleteOff()], [true, true]);
  view.pushFrame(snapshot({ build: { ...snapshot().build, status: 'done' } })); paint();
  assert.deepEqual([head.hidden, deleteOff()], [false, false], 'the round ended while the socket was down');
  const hudExport = [...win.document.querySelectorAll('.dz-hud button')].find((b) => b.textContent === 'Export');
  hudExport.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(q('.menu.dz-export').hidden, false, 'the end-state Export opens the menu');
  view.pushFrame(snapshot({ build: { ...snapshot().build, status: 'building' } })); paint();
  assert.deepEqual([head.hidden, q('.menu.dz-export').hidden, deleteOff()], [true, true, true]);
  view.pushFrame({ ...snapshot({ build: { ...snapshot().build, status: 'done' } }), designId: 'd_0000000000bb' }); paint();
  assert.equal(head.hidden, true, 'another design\'s snapshot moves nothing');
  view.pushFrame(build('building', { buildId: 'b_000000000002', round: 2, kind: 'change' })); paint();
  view.pushFrame(snapshot({ build: { ...snapshot().build, status: 'done' } })); paint();
  assert.deepEqual([head.hidden, deleteOff()], [true, true], 'an older round\'s snapshot, answering a rejoin late, moves nothing');
});
test('a design opened done shows Export at once; switching designs or going to the library leaves no window listener', async () => {
  const { view, win, q, tick, setList } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, status: 'done' } } });
  setList({ designs: [] });
  const live = new Map();
  const add = win.addEventListener.bind(win); const remove = win.removeEventListener.bind(win);
  win.addEventListener = (t, fn, o) => { live.set(fn, t); add(t, fn, o); };
  win.removeEventListener = (t, fn, o) => { live.delete(fn); remove(t, fn, o); };
  await view.show(DID); await tick();
  assert.equal(q('.dz-stage-head .dz-menu-anchor > button').hidden, false);
  await view.show('d_0000000000bb'); await tick();
  await view.show(''); await tick();
  view.leave();
  assert.deepEqual([...live.values()], []);
});
test('the Library\'s first message reaches the new design\'s chat once, as its initial (P6 Task 9)', async () => {
  const made = [];
  const createChat = (o) => { made.push(o); return { destroy() {} }; };
  const { view, win, q, posts, route, tick } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, id: NEW_ID } }, createChat });
  await view.show(''); await tick();
  const input = q('.dz-hero textarea.dz-input');
  input.value = 'A launch page';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  q('.dz-hero .ask-send').click(); await tick();
  assert.deepEqual(posts.map((p) => p.url), ['/api/design']);
  assert.equal(route.at(-1), NEW_ID, 'the 201 opens the new design');
  await view.show(NEW_ID); await tick();
  assert.deepEqual(made[0].initial, { text: 'A launch page', files: [] });
  view.leave();
  await view.show(NEW_ID); await tick();
  assert.equal(made[1].initial, null, 'a second open sends nothing again');
});

test('pictures: one GET at open and one at hello; a design-picture frame is in the log before the chat hears it', async () => {
  const seen = [];
  const createChat = (o) => ({ pushDesignFrame: (fr) => seen.push([fr.type, o.pictures.tally(1).made]), destroy() {} });
  const row = { id: 1, buildId: BID, round: 1, name: 'a', shape: 'wide', state: 'made', prompt: 'p', file: 'assets/made/a.png', w: 384, h: 256, model: 'm', costUsd: 0.04, ms: 1, reason: null, createdAt: '2026-11-11T10:00:01.000Z' };
  const { view, tick, gets } = rig({ detail: DETAIL, createChat, pictures: [row] });   // GET …/pictures answers [row]
  await view.show(DID); await tick();
  const n = () => gets.filter((u) => u === `/api/design/${DID}/pictures`).length;
  assert.equal(n(), 1);
  const { createdAt, ...fields } = row;
  view.pushFrame({ ...fields, type: 'design-picture', designId: DID, id: 2, name: 'b', file: 'assets/made/b.png' });
  assert.deepEqual(seen.at(-1), ['design-picture', 2]);
  view.onHello([], { rebooted: false }); await tick();
  assert.equal(n(), 2);
});
test('pictures: a hello starts the quiet tiles over; a making frame after it stays', async () => {
  let log = null;
  const createChat = (o) => { log = o.pictures; return { destroy() {} }; };
  const { view, tick } = rig({ detail: DETAIL, createChat, pictures: [] });
  await view.show(DID); await tick();
  const making = { type: 'design-picture', designId: DID, buildId: BID, round: 1, name: 'a', shape: 'wide', state: 'making', prompt: 'p' };
  view.pushFrame(making);
  assert.deepEqual(log.shown(1, { live: true }).map((p) => p.state), ['making']);
  view.onHello([], { rebooted: false });
  assert.deepEqual(log.shown(1, { live: true }), [], 'a gap may have missed its finished frame');
  view.pushFrame({ ...making, name: 'b' }); await tick();
  assert.deepEqual(log.shown(1, { live: true }).map((p) => p.name), ['b']);
});
test('pictures, in the real app: the stage gets the same log, so the Agents popover ends with the round\'s pictures (a row at open, a frame after)', async () => {
  const row = { id: 1, buildId: BID, round: 1, name: 'a', shape: 'wide', state: 'made', prompt: 'p', file: 'assets/made/a.png', w: 384, h: 256, model: 'm', costUsd: 0.04, ms: 1, reason: null, createdAt: '2026-11-11T10:00:01.000Z' };
  const { view, q, tick, paint } = rig({ detail: { ...DETAIL, build: ROW }, pictures: [row] });   // no createChat: only the stage reads the log here
  await view.show(DID); await tick();
  view.pushFrame(build('building')); view.pushFrame(plan(['hero'])); view.pushFrame(agent(A1, 'writing')); paint();
  const { createdAt, ...fields } = row;
  view.pushFrame({ ...fields, type: 'design-picture', designId: DID, id: 2, name: 'b', file: 'assets/made/b.png' });
  view.stage().showAgent(A1);
  assert.deepEqual([q('.dz-arow-pics .dz-aact')?.textContent, q('.dz-arow-pics .dz-acost')?.textContent], ['2 made', '$0.08'],
    'view.mjs hands its picture log to createStage, not only to the chat');
  view.pushFrame(build('building', { buildId: 'b_000000000002', round: 2, kind: 'change' })); paint();
  assert.equal(q('.dz-arow-pics .dz-aact')?.textContent, undefined, 'the open popover counts the round on the stage: round 2 made none yet');
});
