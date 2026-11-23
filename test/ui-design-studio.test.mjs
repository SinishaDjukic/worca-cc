// test/ui-design-studio.test.mjs — a design chat on the Chat page (ui/public/design/studio.mjs, docs/design.md "In the
// chat"): the dock in the chat column with its bar (kind, All designs, More), the stage in the tool panel's Design tab
// (attachStage / detachStage), the frames' route to both, pins, the plan list's Retry, Export, pictures, and the new
// design's start. The rig is a JSDOM page holding the chat slot and the tab's host, its window on the fake clock (as
// test/helpers/design-stage-rig.mjs), and a fake `fetch` by route.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { DID, BID, A1, build, plan, agent, snapshot } from './helpers/design-stage-frames.mjs';
import { createDesignStudio, createDesignStartPage } from '../ui/public/design/studio.mjs';

const trackDom = useDomRelease(afterEach);
const mounted = [];
afterEach(() => { while (mounted.length) mounted.pop().destroy(); });

const NS = 'worca-design';
const NEW_ID = 'd_0000000000aa';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const reply = (status, body) => {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
};
const DETAIL = { design: { id: DID, kind: 'web', title: 'Apsida landing page', version: 0, threadId: 'ask_1' }, plan: null, build: null, sections: [], versions: [] };
const ROW = { id: BID, designId: DID, round: 1, kind: 'first', status: 'building', reason: null, agentsTotal: 1, layers: 0, costUsd: 0, costKnown: true, startedAt: '2026-11-05T10:00:00Z', endedAt: null };

/**
 * @param {{detail?: object, detailStatus?: number, createChat?: Function, promptAnswers?: Array<object|null>,
 *   confirmAnswers?: boolean[], pictures?: object[], attach?: boolean, designId?: string, start?: boolean}} [o]
 *   `attach` (default true) mounts the Design tab at once; `showStage` attaches it on demand otherwise. `start` mounts
 *   the new design's start page instead of a studio.
 */
function rig({ detail = DETAIL, detailStatus, createChat, promptAnswers = [], confirmAnswers = [], pictures, attach = true, designId = DID, start = false, setComposer, onCards } = {}) {
  const clock = fakeClock();
  const dom = trackDom(new JSDOM('<!doctype html><html><body><header id="head"><span id="hs"></span></header><div id="slot"></div><div id="tab"></div></body></html>', { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  win.Element.prototype.scrollIntoView = function scrollIntoView() {};
  Object.assign(win, { setTimeout: clock.set, clearTimeout: clock.clear, requestAnimationFrame: clock.raf, cancelAnimationFrame: clock.cancelRaf });
  Object.defineProperty(win, 'performance', { configurable: true, value: { now: () => clock.now, timeOrigin: 0 } });
  win.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  const posts = []; const gets = []; const sent = []; const ws = []; const nav = []; const titles = []; let shown = 0;
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
      if (url === '/api/design') return reply(201, { design: { id: NEW_ID, kind: body.kind, title: 'Untitled design', version: 0, threadId: 'ask_2' }, threadId: 'ask_2' });
      if (/\/preview-token$/.test(url)) return reply(200, { base: '/design-preview/TOK', expiresAt: clock.now + 43200000 });
      return reply(404, { error: 'not found' });
    }
    gets.push(url);
    if (/^\/api\/design\/d_[0-9a-f]{12}$/.test(url)) return detailStatus ? reply(detailStatus, { error: 'Design not found' }) : reply(200, detail);
    if (url === `/api/design/${DID}/pictures` && pictures !== undefined) return reply(200, pictures);
    return reply(404, { error: 'not found' });
  }
  const slot = doc.getElementById('slot');
  const tab = doc.getElementById('tab');
  const deps = { doc, win, host: slot, fetch, navigate: (h) => nav.push(h), ...(setComposer ? { setComposer } : {}), ...(onCards ? { onCards } : {}) };
  if (start) {
    const page = createDesignStartPage(deps);
    mounted.push(page);
    return { page, win, doc, q: (s) => doc.querySelector(s), posts, nav, tick: flush };
  }
  let studio = null;
  studio = createDesignStudio({
    ...deps, designId, headSlot: doc.getElementById('hs'), sendWs: (m) => ws.push(m),
    // The real dock puts the plan list in its column; the stand-in does the same.
    createChat: createChat || ((o) => { o.host.append(o.planList.el); return { destroy() {} }; }),
    prompt: () => Promise.resolve(promptAnswers.shift() ?? null),
    confirm: () => Promise.resolve(confirmAnswers.shift() ?? false),
    showStage: () => { shown += 1; return studio.attachStage(tab); },
    setTitle: (t) => titles.push(t),
  });
  mounted.push(studio);
  if (attach) void studio.attachStage(tab);
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => doc.querySelectorAll(sel);
  const readied = new WeakSet();
  const post = (f, data) => { win.dispatchEvent(Object.assign(new win.Event('message'), { source: f.contentWindow, origin: 'null', data })); };
  const fireStageMsg = (t, fields = {}) => {
    const f = [...doc.querySelectorAll('iframe')].find((x) => !x.classList.contains('is-next'));
    const n = /#n=([^&#]*)$/.exec(f.getAttribute('src'))[1];
    if (!readied.has(f)) {
      readied.add(f);
      f.contentWindow.postMessage = () => {};
      post(f, { ns: NS, v: 1, n, t: 'ready', mode: /\/(build|run)\/#n=/.exec(f.getAttribute('src'))[1], vw: 1440, vh: 900, dpr: 1 });
    }
    post(f, { ...fields, ns: NS, v: 1, n, t });
  };
  const settle = async () => { await studio.ready; for (let i = 0; i < 6; i += 1) await flush(); };
  return { studio, win, doc, clock, q, qa, posts, gets, sent, ws, nav, titles, shown: () => shown, fireStageMsg, settle, paint: () => clock.frame(), tick: flush, slot, tab };
}

test('one head row: the kind and ⋯ sit beside the title, ⋯ leads to All designs; the dock is made with P5\'s names', async () => {
  const made = [];
  const { q, nav, settle } = rig({ createChat: (o) => { made.push(o); return { destroy() {} }; }, attach: false });
  await settle();
  assert.equal(q('#hs .chat-head-kind').textContent, 'Web page');
  assert.equal(q('#slot .dz-chat-bar'), null, 'no bar of its own over the dock');
  for (const k of ['confirm', 'design', 'doc', 'fetch', 'host', 'initial', 'onRestored', 'planList', 'renderMarkdown', 'sendWs', 'setPick', 'unpin', 'pictures']) assert.ok(k in made[0], k);
  assert.ok(made[0].host.classList.contains('dz-chat-slot'));
  q('#hs [data-dz-more]').click();
  q('.menu.dz-more .menu-item').click();
  assert.deepEqual([q('.menu.dz-more .menu-item').textContent, nav], ['All designs', ['#design']]);
  assert.equal(q('#tab').children.length, 0, 'no stage until the Design tab mounts');
});
test('a missing design says so with All designs; a failed load has Try again', async () => {
  let r = rig({ detailStatus: 404 });
  await r.settle();
  assert.match(r.q('#slot').textContent, /Design not found/);
  assert.equal(r.q('#slot [data-dz-retry]'), null);
  r = rig({ detailStatus: 500 });
  await r.settle();
  assert.match(r.q('#slot').textContent, /Could not load the design/);
  assert.ok(r.q('#slot [data-dz-retry]'));
});
test('the Design tab: attach builds the stage there and subscribes; detach leaves no timer, frame or window listener (review M9)', async () => {
  const live = new Map();
  const { studio, win, clock, q, ws, settle, fireStageMsg } = rig({ detail: { ...DETAIL, build: ROW }, attach: false });
  await settle();   // the chat column's own listeners (More's menu) stay with the chat: counted from here on
  const add = win.addEventListener.bind(win); const remove = win.removeEventListener.bind(win);
  win.addEventListener = (t, fn, o) => { live.set(fn, t); add(t, fn, o); };
  win.removeEventListener = (t, fn, o) => { live.delete(fn); remove(t, fn, o); };
  await studio.attachStage(q('#tab')); await settle();
  assert.ok(q('#tab > .dz-stage'));
  assert.ok(ws.some((m) => m.type === 'subscribe' && m.designBuildId === BID));
  fireStageMsg('rects', { scrollX: 0, scrollY: 0, vw: 1440, vh: 900, docH: 4000, sections: [] });
  studio.pushFrame(plan(['hero']));
  assert.ok(clock.pending() > 0);
  studio.detachStage();
  // focusin, keyup and mouseout are jsdom's selector engine's own (@asamuzakjp/dom-selector), registered on first use.
  const ours = [...live.values()].filter((t) => !['focusin', 'keyup', 'mouseout'].includes(t));
  assert.deepEqual([ours, clock.pending(), studio.hasStage()], [[], 0, false]);
  assert.ok(q('.dz-chat-slot'), 'the chat stays');
});
test('frames: only this design reaches the stage and the dock; the plan list follows; design-restored too; a pick becomes a labelled pin', async () => {
  const frames = []; const pins = [];
  const createChat = (o) => { o.host.append(o.planList.el); return { pushDesignFrame: (f) => frames.push(f), addPin: (p) => pins.push(p), destroy() {} }; };
  const { studio, q, settle, paint, fireStageMsg } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, version: 1 } }, createChat });
  await settle();
  studio.pushFrame(build('building', { designId: 'd_other' }));
  assert.equal(frames.length, 0);
  studio.pushFrame(build('building'));
  studio.pushFrame(plan(['hero', 'price'])); paint();
  assert.equal(q('.dz-plan .dz-meta').textContent, '2 sections');
  studio.pushFrame({ type: 'design-restored', designId: DID, version: 3, restoredFrom: 1, ts: 1 });
  assert.equal(frames.at(-1).type, 'design-restored');
  fireStageMsg('picked', { id: 'hero', path: 'p', tag: 'h1', text: 'Ship it', html: 'h', rect: [1, 2, 3, 4] });
  assert.equal(pins[0].id, 'hero');
  assert.match(pins[0].label, /"Ship it"/);
});
test('Point at the page with the Design tab away opens it first; unpin and onRestored reach the stage', async () => {
  let chat = null;
  const { studio, qa, settle, shown, tick } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, version: 1 } }, createChat: (o) => { chat = o; return { destroy() {} }; }, attach: false });
  await settle();
  chat.setPick(true); await settle();
  assert.equal(shown(), 1, 'the Design tab opens');
  assert.equal(studio.stage().model().wantPick, true);
  chat.unpin('hero', 'p');
  assert.deepEqual(studio.stage().model().pins, []);
  const docs = qa('iframe').length;
  chat.onRestored(); await tick();
  assert.equal(qa('iframe').length, docs + 1, 'onRestored loads the run doc again');
});
test('More: Rename PATCHes and repaints the Chat head; Delete is off while the build is open, paused too, and leads to the Library', async () => {
  const { studio, q, qa, sent, nav, titles, settle, tick } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, status: 'building' } }, promptAnswers: [{ title: 'Ship radar' }], confirmAnswers: [true] });
  await settle();
  const btn = q('#hs [data-dz-more]');
  assert.equal(btn.getAttribute('aria-label'), 'More');
  const items = () => [...qa('.menu.dz-more .menu-item')].slice(1);   // after All designs: Rename, Delete
  btn.click();
  assert.equal(items()[1].getAttribute('aria-disabled'), 'true', 'building');
  btn.click();
  studio.pushFrame(build('paused'));
  btn.click();
  assert.equal(items()[1].getAttribute('aria-disabled'), 'true', 'paused');
  btn.click();
  studio.pushFrame(build('stopped'));
  btn.click();
  assert.equal(items()[1].hasAttribute('aria-disabled'), false, 'stopped');
  items()[0].click(); await tick(); await tick();
  assert.deepEqual(sent.at(-1), { method: 'PATCH', url: `/api/design/${DID}`, body: { title: 'Ship radar' } });
  assert.deepEqual(titles, ['Ship radar']);
  btn.click(); items()[1].click(); await tick(); await tick();
  assert.deepEqual(sent.at(-1), { method: 'DELETE', url: `/api/design/${DID}` });
  assert.equal(nav.at(-1), '#design');
});
test('the Plan list\'s Retry posts continue once and shows the refusal', async () => {
  const { studio, win, q, posts, settle, tick, paint } = rig({ detail: { ...DETAIL, build: ROW } });
  await settle();
  studio.pushFrame(plan(['hero'])); studio.pushFrame(build('stopped'));
  studio.pushFrame({ type: 'design-section', designId: DID, buildId: BID, seq: 9000, ts: 1, sectionId: 'hero', status: 'stopped', agentId: null, summary: '' });
  paint();
  const b = q('.dz-retry-row button');
  b.click(); b.dispatchEvent(new win.Event('click'));
  await tick();
  assert.deepEqual(posts.filter((p) => p.url.endsWith('/continue')).map((p) => p.body), [{ sections: ['hero'] }]);
  await tick(); await tick();
  assert.equal(q('.dz-retry-row small').textContent, 'Could not retry');
  assert.equal(b.disabled, false);
});
test('Export follows the round: hidden until done, shown by a done frame or a restore; the HUD Export opens its menu', async () => {
  const { studio, win, q, settle, paint } = rig({ detail: { ...DETAIL, build: ROW } });
  await settle();
  const head = q('.dz-stage-head .dz-menu-anchor > button');
  assert.equal(head.hidden, true);
  studio.pushFrame(build('done')); paint();
  assert.equal(head.hidden, false);
  const hudExport = [...win.document.querySelectorAll('.dz-hud button')].find((b) => b.textContent === 'Export');
  hudExport.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(q('.menu.dz-export').hidden, false);
  studio.pushFrame(build('building', { round: 2, kind: 'change' }));
  assert.equal(head.hidden, true, 'a new round: nothing to export');
  studio.pushFrame({ type: 'design-restored', designId: DID, version: 1, restoredFrom: 1, ts: 1 });
  assert.equal(head.hidden, false);
});
test('a snapshot moves Export as a design-build frame does; another design\'s or an older round\'s moves nothing', async () => {
  const { studio, q, settle, paint } = rig({ detail: { ...DETAIL, design: { ...DETAIL.design, status: 'building' }, build: ROW } });
  await settle();
  const head = q('.dz-stage-head .dz-menu-anchor > button');
  studio.pushFrame(snapshot({ build: { ...snapshot().build, status: 'done' } })); paint();
  assert.equal(head.hidden, false, 'the round ended while the socket was down');
  studio.pushFrame({ ...snapshot({ build: { ...snapshot().build, status: 'building' } }), designId: 'd_0000000000bb' }); paint();
  assert.equal(head.hidden, false);
  studio.pushFrame(build('building', { buildId: 'b_000000000002', round: 2, kind: 'change' })); paint();
  studio.pushFrame(snapshot({ build: { ...snapshot().build, status: 'done' } })); paint();
  assert.equal(head.hidden, true);
});
test('the chat composer: a chat\'s design lends it its pins, Point, gear and payload, nothing more; a new design\'s kind buttons pick the kind its send makes, its first message reaching the dock once (takeStart)', async () => {
  const handed = [];
  const own = { lead: 'pins', nodes: ['point', 'gear'], payload: () => ({}), sent: () => {} };
  const docks = [];
  let cards = 0;
  const lend = (o) => { docks.push(o); return { composer: own, destroy() {} }; };
  await rig({ createChat: lend, attach: false, setComposer: (e) => { handed.push(e); return null; }, onCards: () => { cards += 1; } }).settle();
  assert.equal(docks[0].inline, true, 'inline: the chat draws the messages and the composer');
  assert.deepEqual(handed.map((e) => [e.lead, e.nodes, e.payload, e.send, e.scope, e.sets, e.placeholder]),
    [['pins', ['point', 'gear'], own.payload, undefined, undefined, undefined, undefined]], 'the chat keeps its scope, Sets and placeholder');
  assert.ok(cards >= 1, 'the transcript\'s design cards are drawn once the dock is up');
  await rig({ createChat: lend, attach: false }).settle();
  assert.equal(docks[1].inline, false, 'with no chat composer to lend, the dock keeps its own');
  let ext = null;
  const s = rig({ start: true, setComposer: (e) => { ext = e; return { refresh() {}, restore() {} }; } });
  assert.equal(s.q('.dz-input'), null, 'no composer of its own');
  assert.equal(ext.composerSlot, s.q('.dz-start-composer'), 'the chat composer goes under the heading');
  assert.deepEqual([ext.sets, ext.nodes, ext.endNodes.map((n) => n.className)], [false, undefined, ['dz-set']], 'the gear joins the row; Sets do not');
  // The kind: the Design page's row of buttons under the composer (not a pill in it).
  assert.equal(ext.pills, undefined, 'no Kind pill in the composer');
  const btn = (k) => s.q(`.dz-kinds .dz-kind-btn[data-kind="${k}"]`);
  assert.deepEqual([...s.q('.dz-kinds').querySelectorAll('.dz-kind-btn')].map((b) => b.dataset.kind), ['web', 'presentation', 'pitch', 'video', 'document']);
  assert.equal(btn('web').getAttribute('aria-pressed'), 'true');
  btn('video').click();
  assert.deepEqual([btn('video').getAttribute('aria-pressed'), btn('web').getAttribute('aria-pressed')], ['true', 'false']);
  const r = await ext.send({ text: 'A launch page', files: [], projectKey: null });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(s.posts.map((p) => p.url), ['/api/design']);
  assert.deepEqual([s.posts[0].body.kind, s.posts[0].body.title, s.posts[0].body.fast], ['video', 'A launch page', true]);
  assert.equal(s.nav.at(-1), `#design/${NEW_ID}`, 'the 201 opens the new design (its chat)');
  s.q('[data-dz-all]').click();
  assert.equal(s.nav.at(-1), '#design');
  const made = [];
  const createChat = (o) => { made.push(o); return { destroy() {} }; };
  const detail = { ...DETAIL, design: { ...DETAIL.design, id: NEW_ID } };
  await rig({ designId: NEW_ID, detail, createChat, attach: false }).settle();
  await rig({ designId: NEW_ID, detail, createChat, attach: false }).settle();
  assert.deepEqual(made.map((o) => o.initial), [{ text: 'A launch page', files: [] }, null]);
});
test('pictures: one GET at open and one at hello; a design-picture frame is in the log before the dock hears it; a hello starts the quiet tiles over', async () => {
  const seen = []; let log = null;
  const createChat = (o) => { log = o.pictures; return { pushDesignFrame: (fr) => seen.push([fr.type, o.pictures.tally(1).made]), destroy() {} }; };
  const row = { id: 1, buildId: BID, round: 1, name: 'a', shape: 'wide', state: 'made', prompt: 'p', file: 'assets/made/a.png', w: 384, h: 256, model: 'm', costUsd: 0.04, ms: 1, reason: null, createdAt: '2026-11-11T10:00:01.000Z' };
  const { studio, gets, settle } = rig({ createChat, pictures: [row], attach: false });
  await settle();
  const n = () => gets.filter((u) => u === `/api/design/${DID}/pictures`).length;
  assert.equal(n(), 1);
  const { createdAt, ...fields } = row;
  studio.pushFrame({ ...fields, type: 'design-picture', designId: DID, id: 2, name: 'b', file: 'assets/made/b.png' });
  assert.deepEqual(seen.at(-1), ['design-picture', 2]);
  const making = { type: 'design-picture', designId: DID, buildId: BID, round: 1, name: 'c', shape: 'wide', state: 'making', prompt: 'p' };
  studio.pushFrame(making);
  const makingNow = () => log.shown(1, { live: true }).filter((p) => p.state === 'making').map((p) => p.name);
  assert.deepEqual(makingNow(), ['c']);
  studio.onHello({ rebooted: false }); await settle();
  assert.equal(n(), 2);
  assert.deepEqual(makingNow(), [], 'a gap may have missed its finished frame');
});
test('pictures reach the stage too: the Agents popover ends with the round\'s pictures', async () => {
  const row = { id: 1, buildId: BID, round: 1, name: 'a', shape: 'wide', state: 'made', prompt: 'p', file: 'assets/made/a.png', w: 384, h: 256, model: 'm', costUsd: 0.04, ms: 1, reason: null, createdAt: '2026-11-11T10:00:01.000Z' };
  const { studio, q, settle, paint } = rig({ detail: { ...DETAIL, build: ROW }, pictures: [row] });
  await settle();
  studio.pushFrame(build('building')); studio.pushFrame(plan(['hero'])); studio.pushFrame(agent(A1, 'writing')); paint();
  const { createdAt, ...fields } = row;
  studio.pushFrame({ ...fields, type: 'design-picture', designId: DID, id: 2, name: 'b', file: 'assets/made/b.png' });
  studio.stage().showAgent(A1);
  assert.deepEqual([q('.dz-arow-pics .dz-aact')?.textContent, q('.dz-arow-pics .dz-acost')?.textContent], ['2 made', '$0.08']);
});
