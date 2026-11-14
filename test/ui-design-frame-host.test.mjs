// The Design stage's frame host (ui/public/design/frame-host.mjs): the preview iframe's attributes, the C-6 message
// gate (source, origin, nonce, shape), the swap to a new doc, the lost frame (P3, R16), and the shared fake clock
// (test/helpers/design-clock.mjs) that Tasks 9, 11 and 14 drive too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFrameHost, validFrameMessage } from '../ui/public/design/frame-host.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { checkRows } from './helpers/rows.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// `refuse`: how many of the first mints reject (a server that answers 404 or is down). `hold`: every mint waits until
// the test calls `held[i](base)`.
function rig({ refuse = 0, hold = false } = {}) {
  const clock = fakeClock();
  // With a URL and no resource loader, JSDOM gives each iframe a real contentWindow and fires no `load` of its own.
  const dom = new JSDOM('<!doctype html><html><body><div class="frame-box"></div></body></html>', { url: 'http://localhost/' });
  const doc = dom.window.document;
  const mount = doc.querySelector('.frame-box');
  const win = Object.assign(new EventTarget(), { setTimeout: clock.set, clearTimeout: clock.clear, crypto: globalThis.crypto });
  const listeners = new Set();
  const add = win.addEventListener.bind(win); const remove = win.removeEventListener.bind(win);
  win.addEventListener = (type, fn, o) => { listeners.add(type); add(type, fn, o); };
  win.removeEventListener = (type, fn, o) => { listeners.delete(type); remove(type, fn, o); };
  const mints = []; const msgs = []; const swaps = []; const lost = []; const posted = []; const held = [];
  const host = createFrameHost({
    doc, win, mount, now: () => clock.now,
    mint: async () => {
      const token = { base: '/design-preview/TOK', expiresAt: clock.now + 43200000 };
      mints.push(token);
      if (mints.length <= refuse) throw new Error('design not found');
      if (hold) return new Promise((resolve) => held.push((base) => resolve({ ...token, base })));
      return token;
    },
    onMessage: (m) => msgs.push(m), onSwap: (s) => swaps.push(s), onLost: (l) => lost.push(l),
  });
  const patched = new WeakSet();
  const frames = () => [...mount.querySelectorAll('iframe')].map((f) => {
    if (f.contentWindow && !patched.has(f)) { patched.add(f); f.contentWindow.postMessage = (m, o) => posted.push([m, o]); }
    return f;
  });
  const nonce = (f) => /#n=([^&#]*)$/.exec(f.getAttribute('src'))[1];
  const fire = (frame, data, over = {}) => {
    win.dispatchEvent(Object.assign(new Event('message'), { source: frame.contentWindow, origin: 'null', data, ...over }));
  };
  return { host, frames, nonce, fire, clock, mints, msgs, swaps, lost, posted, held, listeners, tick };
}
const modes = (frames) => frames.map((f) => f.getAttribute('src').split('/')[3]);
const loadEvent = (f) => f.dispatchEvent(new f.ownerDocument.defaultView.Event('load'));

const env = (n, t, o) => ({ ns: 'worca-design', v: 1, n, t, ...o });
const R = [10, 20, 30, 40];
test('the frame: sandbox allow-scripts only, no referrer, a titled served URL with the nonce in the hash', async () => {
  const { host, frames } = rig();
  await host.load('build');
  const f = frames()[0];
  assert.equal(f.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(f.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(f.title, 'Design preview');
  assert.match(f.getAttribute('src'), /^\/design-preview\/TOK\/build\/#n=[0-9a-f]{32}$/);
});
test('ready is accepted only with the right source, origin and nonce; then send carries the envelope to *', async () => {
  const { host, frames, nonce, fire, msgs, swaps } = rig();
  await host.load('build');
  const f = frames()[0]; const ready = env(nonce(f), 'ready', { mode: 'build', vw: 1440, vh: 900, dpr: 2 });
  fire(f, ready, { source: {} }); fire(f, ready, { origin: 'http://localhost' }); fire(f, { ...ready, n: 'x' });
  assert.equal(msgs.length, 0);
  fire(f, ready);
  assert.deepEqual(swaps, [{ mode: 'build', vw: 1440, vh: 900, dpr: 2 }]);
  const sent = []; f.contentWindow.postMessage = (m, o) => sent.push([m, o]);
  host.send('hello', { mode: 'build' });
  assert.deepEqual(sent, [[{ ns: 'worca-design', v: 1, n: nonce(f), t: 'hello', mode: 'build' }, '*']]);
});
test('the swap: the old frame stays, and takes messages, until the new one is ready; no flash', async () => {
  const { host, frames, nonce, fire, msgs } = rig();
  await host.load('build');
  const a = frames()[0];
  fire(a, env(nonce(a), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  await host.load('run');
  assert.equal(frames().length, 2);
  const b = frames()[1];
  assert.ok(b.classList.contains('is-next'));
  assert.deepEqual([host.mode(), host.pendingMode()], ['build', 'run']);
  fire(a, env(nonce(a), 'rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 1, sections: [] }));
  assert.equal(msgs.at(-1).t, 'rects');
  fire(b, env(nonce(b), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 }));
  assert.deepEqual(frames(), [b]);
  assert.equal(b.classList.contains('is-next'), false);
  assert.deepEqual([host.mode(), host.pendingMode()], ['run', null]);
});
test('a newer load replaces a pending one', async () => {
  const { host, frames } = rig();
  await host.load('build'); await host.load('run');
  assert.deepEqual(frames().map((f) => f.getAttribute('src').split('/')[3]), ['build', 'run'], 'the first is current at once, the second waits');
  await host.load('build');
  assert.deepEqual(frames().map((f) => f.getAttribute('src').split('/')[3]), ['build', 'build']);
});
test('P3: no ready re-mints and reloads once; a second failure is lost, and the old frame stays', async () => {
  const { host, frames, nonce, fire, clock, mints, lost } = rig();
  await host.load('build');
  const a = frames()[0]; fire(a, env(nonce(a), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  await host.load('run');
  clock.tick(6000); await tick();
  assert.equal(mints.length, 2);
  assert.deepEqual(lost, []);
  clock.tick(6000); await tick();
  assert.deepEqual(lost, [{ mode: 'run' }]);
  assert.deepEqual(frames(), [a]);
});
test('R16: a load its doc did not report as loaded, after the first ready, is a page that left; a reload with its bridge is fine', async () => {
  const { host, frames, nonce, fire, clock, lost, msgs } = rig();
  await host.load('run');
  const f = frames()[0]; const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 });
  const done = env(nonce(f), 'loaded', { mode: 'run' });
  fire(f, ok); fire(f, done); f.dispatchEvent(new f.ownerDocument.defaultView.Event('load'));
  clock.tick(5000);
  assert.deepEqual(lost, [], 'the normal load after ready');
  f.dispatchEvent(new f.ownerDocument.defaultView.Event('load'));
  fire(f, ok); fire(f, done); clock.tick(5000);
  assert.deepEqual(lost, [], 'a reload that came back');
  f.dispatchEvent(new f.ownerDocument.defaultView.Event('load'));
  clock.tick(1500); await tick(); const g = frames().at(-1);
  const n = msgs.length; fire(f, env(nonce(f), 'rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 1, sections: [] }));
  assert.equal(msgs.length, n, 'a navigated frame is no longer believed');
  clock.tick(6000); await tick();
  assert.ok(g && lost.length === 1);
});
test('Review Focus 4: forged and malformed messages are refused, strings capped', async () => {
  const n = 'N'; const V = (t, o) => validFrameMessage(env(n, t, o), n);
  await checkRows([
    ['not an object', null, () => validFrameMessage('hi', n)], ['wrong ns', null, () => validFrameMessage({ ...env(n, 'visible', { id: 'a' }), ns: 'x' }, n)],
    ['wrong v', null, () => validFrameMessage({ ...env(n, 'visible', { id: 'a' }), v: 2 }, n)], ['wrong nonce', null, () => validFrameMessage(env('z', 'visible', { id: 'a' }), n)],
    ['unknown t', null, () => V('eval', { code: 'x' })], ['__proto__ t', null, () => V('__proto__', {})],
    ['NaN rect', null, () => V('applied', { id: 'a', rev: 1, added: 1, layers: 1, rect: [NaN, 0, 1, 1], marks: [] })],
    ['huge rect', null, () => V('applied', { id: 'a', rev: 1, added: 1, layers: 1, rect: [2e5 + 1, 0, 1, 1], marks: [] })],
    ['short rect', null, () => V('applied', { id: 'a', rev: 1, added: 1, layers: 1, rect: [0, 0, 1], marks: [] })],
    ['bad section id', null, () => V('applied', { id: '../x', rev: 1, added: 1, layers: 1, rect: R, marks: [] })],
    ['negative layers', null, () => V('applied', { id: 'a', rev: 1, added: 1, layers: -1, rect: R, marks: [] })],
    ['bad mode', null, () => V('ready', { mode: 'evil', vw: 1, vh: 1, dpr: 1 })], ['Infinity scroll', null, () => V('rects', { scrollX: 0, scrollY: Infinity, vw: 1, vh: 1, docH: 1, sections: [] })],
    ['NaN zoom', null, () => V('zoom', { dy: NaN, y: 0 })],
  ].map(([name, want, fn]) => ({ name, run: () => assert.equal(fn(), want) })));
  const a = V('applied', { id: 'a', rev: 0, added: 0, layers: 2, rect: R, overflow: 'yes', extra: 1, tail: { rect: R, tag: '<img src=x>', box: R }, marks: Array.from({ length: 30 }, () => ({ rect: R, tag: 'p', kind: 'el' })) });
  assert.equal(a.marks.length, 24);
  assert.deepEqual([a.overflow, a.extra, a.tail.tag, a.t], [false, undefined, 'el', 'applied']);
  const p = V('picked', { id: 'a', path: 'x'.repeat(600), tag: 'h1', text: 'y'.repeat(300), html: 'z'.repeat(3000), rect: R });
  assert.deepEqual([p.path.length, p.text.length, p.html.length], [512, 200, 2048]);
  assert.equal(V('err', { code: 'c', message: 'm'.repeat(400) }).message.length, 300);
  assert.equal(V('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 1, sections: Array.from({ length: 50 }, () => ({ id: 'a', rect: R })) }).sections.length, 40);
  assert.deepEqual(V('zoom', { dy: 5000, y: 10 }), { t: 'zoom', dy: 1000, y: 10 });
  assert.ok(V('applied', { id: 'a', rev: 0, added: 0, layers: 0, rect: [2e5, -2e5, 0, 0], tail: { rect: R, tag: 'p' }, marks: [] }), 'P3 clamps to exactly ±2e5');
  assert.ok(V('ready', { mode: 'run', vw: 1366, vh: 768, dpr: 1.25 }), 'a fractional dpr');
});
test('destroy removes the listener, the frames and the timers', async () => {
  const { host, frames, nonce, fire, clock, msgs } = rig();
  await host.load('build'); const f = frames()[0];
  host.destroy();
  assert.deepEqual([frames().length, clock.pending()], [0, 0]);
  fire(f, env(nonce(f), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  assert.equal(msgs.length, 0);
});

// Beyond the plan's list: the branches the host adds around it.
test('after destroy: no message listener on the window, and a load makes nothing', async () => {
  const { host, frames, mints, listeners } = rig();
  assert.deepEqual([...listeners], ['message']);
  await host.load('build');
  host.destroy();
  await host.load('run');
  assert.deepEqual([[...listeners], frames().length, mints.length], [[], 0, 1]);
});
test('two loads at once: only the newer one makes a frame', async () => {
  const { host, frames } = rig();
  await Promise.all([host.load('build'), host.load('run')]);
  assert.deepEqual(modes(frames()), ['run']);
});
test('an overtaken mint does not keep its token', async () => {
  const { host, frames, held, mints } = rig({ hold: true });
  const first = host.load('build'); const second = host.load('run', { fresh: true });
  await tick(); held[1]('/design-preview/NEW'); await second;
  held[0]('/design-preview/OLD'); await first;
  await host.load('build');
  assert.deepEqual([mints.length, frames().map((f) => f.getAttribute('src').split('/')[2])], [2, ['NEW', 'NEW']]);
});
test('a mint that fails is a failed try: one more mint, then lost', async () => {
  const once = rig({ refuse: 1 });
  await once.host.load('build');
  assert.deepEqual([once.mints.length, modes(once.frames()), once.lost], [2, ['build'], []]);
  const twice = rig({ refuse: 2 });
  await twice.host.load('build');
  assert.deepEqual([twice.mints.length, twice.frames().length, twice.lost], [2, 0, [{ mode: 'build' }]]);
});
test('the token is reused until a minute before it expires; fresh mints again', async () => {
  const { host, frames, nonce, fire, clock, mints } = rig();
  const readyAll = () => { for (const f of frames()) fire(f, env(nonce(f), 'ready', { mode: modes([f])[0], vw: 1, vh: 1, dpr: 1 })); };
  await host.load('build'); readyAll();
  clock.tick(43200000 - 60000 - 1);
  await host.load('run'); readyAll();
  assert.equal(mints.length, 1, 'a minute and a millisecond left');
  clock.tick(1);
  await host.load('build');
  assert.equal(mints.length, 2, 'a token a minute from expiry is not used');
  await host.load('run', { fresh: true });
  assert.equal(mints.length, 3);
});
test('the doc\'s own load before its first ready (the real order) is owed its report; a load on a dead frame does not stretch its grace (review cycle 2)', async () => {
  const { host, frames, nonce, fire, clock, swaps, mints, msgs, posted } = rig();
  await host.load('build');
  const f = frames()[0]; const ok = env(nonce(f), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 });
  loadEvent(f); fire(f, ok);
  assert.deepEqual([swaps.length, msgs.map((m) => m.t)], [1, ['ready']], 'the ready swaps in and reaches the stage');
  assert.equal(host.send('hello', {}), true);
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.deepEqual([posted.length, msgs.length], [0, 1], 'held both ways while that load is owed its report');
  fire(f, env(nonce(f), 'loaded', { mode: 'build' }));
  assert.deepEqual([posted.map(([m]) => m.t), msgs.map((m) => m.t)], [['hello'], ['ready', 'visible']], 'the report pays for the load and delivers what waited');
  loadEvent(f); loadEvent(f);
  clock.tick(1000); loadEvent(f); clock.tick(500); await tick();
  assert.equal(mints.length, 2, 'the grace ends 1500 ms after the first load with no loaded report');
});
test('a first doc whose ready comes after READY_TIMEOUT_MS stays refused; its reload replaces it', async () => {
  const { host, frames, nonce, fire, clock, swaps, msgs } = rig();
  await host.load('build');
  const f = frames()[0];
  clock.tick(6000); await tick();
  fire(f, env(nonce(f), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  assert.deepEqual([swaps.length, msgs.length], [0, 0]);
  const g = frames()[1]; fire(g, env(nonce(g), 'ready', { mode: 'build', vw: 2, vh: 2, dpr: 1 }));
  assert.deepEqual([swaps, frames()], [[{ mode: 'build', vw: 2, vh: 2, dpr: 1 }], [g]]);
});
test('more message rules: an absent tail, a bad box or mark, an odd kind, the error code, a missing string', async () => {
  const n = 'N'; const V = (t, o) => validFrameMessage(env(n, t, o), n);
  const A = { id: 'a', rev: 1, added: 1, layers: 1, rect: R, marks: [] };
  await checkRows([
    ['no tail reads null', () => assert.equal(V('applied', A).tail, null)],
    ['a bad tail box refuses', () => assert.equal(V('applied', { ...A, tail: { rect: R, tag: 'p', box: [0, 0, NaN, 0] } }), null)],
    ['a bad tail rect refuses', () => assert.equal(V('applied', { ...A, tail: { tag: 'p' } }), null)],
    ['a five-number rect refuses', () => assert.equal(V('applied', { ...A, rect: [0, 0, 1, 1, 1] }), null)],
    ['a bad mark rect refuses',() => assert.equal(V('applied', { ...A, marks: [{ rect: [0, 0], tag: 'p', kind: 'el' }] }), null)],
    ['an odd kind is el, media stays', () => assert.deepEqual(V('applied', { ...A, marks: [{ rect: R, tag: 'img', kind: 'x' }, { rect: R, tag: 'video', kind: 'media' }] }).marks.map((m) => m.kind), ['el', 'media'])],
    ['the error code is capped', () => assert.equal(V('err', { code: 'c'.repeat(100), message: 'm' }).code.length, 64)],
    ['a pick with no text refuses', () => assert.equal(V('picked', { id: 'a', path: 'p', tag: 'h1', html: '<h1>', rect: R }), null)],
    ['a rects section with a bad id refuses', () => assert.equal(V('rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 1, sections: [{ id: 'A', rect: R }] }), null)],
    ['zoom clamps down too', () => assert.equal(V('zoom', { dy: -5000, y: 0 }).dy, -1000)],
    ['a visible with a bad id refuses', () => assert.equal(V('visible', { id: '__proto__' }), null)],
    ['loaded carries only its mode', () => assert.deepEqual(V('loaded', { mode: 'run', vw: 1 }), { t: 'loaded', mode: 'run' })],
    ['a loaded with a bad mode refuses', () => assert.equal(V('loaded', { mode: 'evil' }), null)],
  ].map(([name, run]) => ({ name, run })));
});
test('after the first ready: a load its doc reported is fine, a self-reload whose reports lost the race ends the grace, onSwap only once', async () => {
  const { host, frames, nonce, fire, clock, mints, msgs, swaps } = rig();
  await host.load('run');
  const f = frames()[0]; const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 });
  const done = env(nonce(f), 'loaded', { mode: 'run' });
  fire(f, ok); fire(f, done); loadEvent(f);
  clock.tick(5000); await tick();
  assert.equal(mints.length, 1, 'the boot\'s own load after its report');
  fire(f, ok); fire(f, done); loadEvent(f);
  loadEvent(f); fire(f, ok); fire(f, done);
  clock.tick(5000); await tick();
  assert.deepEqual([mints.length, frames().length, swaps.length], [1, 1, 1]);
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.equal(msgs.at(-1).t, 'visible', 'believed again');
});
test('a ready after the grace ran out does not bring the frame back', async () => {
  const { host, frames, nonce, fire, clock, msgs } = rig();
  await host.load('run');
  const f = frames()[0]; const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 });
  fire(f, ok); fire(f, env(nonce(f), 'loaded', { mode: 'run' })); loadEvent(f); loadEvent(f);
  clock.tick(1500); await tick();
  const n = msgs.length; fire(f, ok); fire(f, env(nonce(f), 'loaded', { mode: 'run' })); fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.equal(msgs.length, n, 'neither a ready nor a loaded report brings it back');
  assert.equal(host.mode(), 'run');
});
test('send reaches only a believed frame: none before its ready, none after it left', async () => {
  const { host, frames, nonce, fire, msgs } = rig();
  await host.load('build');
  const f = frames()[0]; const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t);
  host.send('early', {});
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.equal(msgs.length, 0, 'nothing but ready is believed before ready');
  fire(f, env(nonce(f), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  host.send('hello', { ns: 'x', n: 'forged', t: 'forged' });
  loadEvent(f); loadEvent(f);
  host.send('late', {});
  assert.deepEqual(sent, ['hello']);
});
test('a ready whose mode is not the slot\'s is refused, and the frame stays unswapped', async () => {
  const { host, frames, nonce, fire, swaps } = rig();
  await host.load('build');
  const a = frames()[0]; fire(a, env(nonce(a), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  await host.load('run');
  const b = frames()[1]; fire(b, env(nonce(b), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  assert.deepEqual([swaps.length, frames().length, host.mode()], [1, 2, 'build']);
});
test('the fake clock: tick fires due timers in order, also ones set while ticking; jump fires the due ones once', () => {
  const clock = fakeClock(); const log = [];
  clock.set(() => { log.push(`b${clock.now}`); clock.set(() => log.push(`c${clock.now}`), 10); }, 20);
  clock.set(() => log.push(`a${clock.now}`), 5);
  clock.set(() => log.push('tie'), 20);
  clock.tick(30);
  assert.deepEqual([log, clock.now, clock.pending()], [['a5', 'b20', 'tie', 'c30'], 30, 0]);
  const late = fakeClock(); const seen = [];
  late.set(() => { seen.push(`x${late.now}`); late.set(() => seen.push('set during the jump'), 0); }, 100);
  const gone = late.set(() => seen.push('cleared by an earlier timer'), 200);
  late.set(() => late.clear(gone), 150);
  late.set(() => seen.push('not due'), 5000);
  late.jump(1000);
  assert.deepEqual([seen, late.now, late.pending()], [['x1000'], 1000, 2]);
  const id = late.raf(() => seen.push('cancelled')); late.raf((t) => seen.push(`frame ${t}`)); late.cancelRaf(id);
  assert.equal(late.pending(), 3, 'two timers and one frame');
  late.frame();
  assert.deepEqual([seen.slice(1), late.pending()], [['frame 1000'], 2]);
});

// Review fix cycle 2.
test('R16 (review M4): a page that leaves after its ready (a DOMContentLoaded-time navigation) is caught by its one unreported load', async () => {
  const { host, frames, nonce, fire, clock, lost, msgs, mints } = rig();
  await host.load('run');
  const f = frames()[0]; const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t);
  fire(f, env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 }));
  assert.equal(host.send('hello', {}), true);
  loadEvent(f);   // the foreign page's load: the doc's own load was aborted, so no loaded came
  const n = msgs.length;
  fire(f, env(nonce(f), 'picked', { id: 'hero', path: 'p', tag: 'h1', text: 'x', html: '<h1>', rect: R }));
  fire(f, env(nonce(f), 'rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 1, sections: [] }));
  assert.equal(msgs.length, n, 'a forged message from the page that came is not believed');
  host.send('scroll', { y: 1 });
  assert.deepEqual(sent, ['hello'], 'nothing is posted to the page that came');
  clock.tick(1500); await tick();
  assert.equal(mints.length, 2, 'the grace ran out: one reload');
  assert.deepEqual([sent, msgs.length, host.send('late', {})], [['hello'], n, false], 'what waited is dropped, never delivered');
  clock.tick(6000); await tick();
  assert.deepEqual(lost, [{ mode: 'run' }], 'the reload never says ready: Reload is offered');
});
test('R16 (review cycle 2): load, ready, loaded, then a page that leaves after its own load: the foreign load is not believed, and the frame ends lost', async () => {
  const { host, frames, nonce, fire, clock, lost, msgs, mints, posted } = rig();
  await host.load('run');
  const f = frames()[0];
  loadEvent(f); fire(f, env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 })); fire(f, env(nonce(f), 'loaded', { mode: 'run' }));
  assert.equal(host.send('hello', {}), true);
  assert.deepEqual(posted.map(([m]) => m.t), ['hello'], 'the report paid for the doc\'s own load: believed');
  loadEvent(f);   // a section script set `location` after the page loaded: the foreign page's load
  const n = msgs.length;
  fire(f, env(nonce(f), 'picked', { id: 'hero', path: 'p', tag: 'h1', text: 'x', html: '<h1>', rect: R }));
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  host.send('scroll', { y: 1 });
  assert.deepEqual([msgs.length, posted.map(([m]) => m.t)], [n, ['hello']], 'nothing passes either way: no spare credit');
  clock.tick(1500); await tick();
  assert.equal(mints.length, 2, 'the grace ran out: one reload');
  clock.tick(6000); await tick();
  assert.deepEqual([lost, msgs.length], [[{ mode: 'run' }], n], 'the reload never says ready: Reload is offered, and what waited is dropped');
});
test('R16 (review cycle 3 M1): load, ready, a foreign load while the report is owed, then the old doc\'s loaded: one report pays one load, and the frame ends lost', async () => {
  const { host, frames, nonce, fire, clock, lost, msgs, mints, posted } = rig();
  await host.load('run');
  const f = frames()[0];
  loadEvent(f); fire(f, env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 }));
  assert.equal(host.send('hello', {}), true);
  clock.tick(1000);
  loadEvent(f);   // the foreign page's load, before the old doc's loaded
  fire(f, env(nonce(f), 'loaded', { mode: 'run' }));
  const n = msgs.length;
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  host.send('scroll', { y: 1 });
  assert.deepEqual([msgs.length, posted.map(([m]) => m.t)], [n, []], 'still owed: nothing passes either way');
  clock.tick(500); await tick();
  assert.equal(mints.length, 2, 'the grace from the first ready ran out, not stretched by the foreign load: one reload');
  clock.tick(6000); await tick();
  assert.deepEqual([lost, msgs.length, posted.length], [[{ mode: 'run' }], n, 0], 'Reload is offered, and what waited is dropped');
});
test('R16 (review cycle 4 M1): a self-reload that leaves at its DOMContentLoaded, and whose ready comes after the foreign load: that ready does not vouch for the page, and the frame ends lost', async () => {
  const { host, frames, nonce, fire, clock, lost, msgs, mints } = rig();
  await host.load('run');
  const f = frames()[0]; const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t);
  const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 });
  fire(f, ok); fire(f, env(nonce(f), 'loaded', { mode: 'run' })); loadEvent(f);   // doc0, believed
  loadEvent(f);   // the foreign page's load: doc1 left at its DOMContentLoaded, so it has no load and no report
  fire(f, ok);    // doc1's ready, delivered after that load
  const n = msgs.length;
  fire(f, env(nonce(f), 'rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 999, sections: [] }));
  host.send('scroll', { y: 1 });
  assert.deepEqual([msgs.length - n, sent], [0, []], 'nothing passes either way');
  clock.tick(1500); await tick();
  assert.equal(mints.length, 2, 'the grace ran out: one reload');
  clock.tick(6000); await tick();
  assert.deepEqual([lost, sent], [[{ mode: 'run' }], []], 'Reload is offered, and what waited is dropped');
});
test('R16 (review cycle 4 M1): a self-reload whose load beat its ready, then a foreign load, then its ready and loaded: one report pays one load, and the frame ends lost', async () => {
  const { host, frames, nonce, fire, clock, lost, msgs, mints } = rig();
  await host.load('run');
  const f = frames()[0]; const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t);
  const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 }); const done = env(nonce(f), 'loaded', { mode: 'run' });
  fire(f, ok); fire(f, done); loadEvent(f);   // doc0, believed
  loadEvent(f);   // doc1's own load, before its ready
  loadEvent(f);   // doc1 left after its load: the foreign page's load, before doc1's messages
  fire(f, ok); fire(f, done);   // doc1's ready and report, late
  const n = msgs.length;
  fire(f, env(nonce(f), 'rects', { scrollX: 0, scrollY: 0, vw: 1, vh: 1, docH: 999, sections: [] }));
  host.send('scroll', { y: 1 });
  assert.deepEqual([msgs.length - n, sent], [0, []], 'nothing passes either way');
  clock.tick(1500); await tick();
  assert.equal(mints.length, 2, 'the grace ran out: one reload');
  clock.tick(6000); await tick();
  assert.deepEqual([lost, sent], [[{ mode: 'run' }], []], 'Reload is offered, and what waited is dropped');
});
test('a trip away that comes back within the grace (Back) reloads when the grace ends: no load stays owed while the frame is believed (review cycle 4)', async () => {
  const { host, frames, nonce, fire, clock, mints } = rig();
  await host.load('run');
  const f = frames()[0];
  const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 }); const done = env(nonce(f), 'loaded', { mode: 'run' });
  fire(f, ok); fire(f, done); loadEvent(f);   // doc0, believed
  loadEvent(f);   // the foreign page's load
  loadEvent(f); fire(f, ok); fire(f, done);   // the doc again, its load first
  clock.tick(1500); await tick();
  assert.equal(mints.length, 2, 'the trip\'s load is never paid: one reload');
});
test('a loaded report that lost the race with its load brings the frame back within the grace, not after it; what waited lands in order', async () => {
  const { host, frames, nonce, fire, clock, msgs, mints } = rig();
  await host.load('build');
  const f = frames()[0]; const done = env(nonce(f), 'loaded', { mode: 'build' });
  const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t === 'scroll' ? `scroll:${m.y}` : m.t);
  fire(f, env(nonce(f), 'ready', { mode: 'build', vw: 1, vh: 1, dpr: 1 }));
  loadEvent(f);   // Chrome: the frame's load before its doc's report
  assert.equal(host.send('scroll', { y: 1 }), true, 'held while its report is owed');
  host.send('scroll', { y: 2 });
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.deepEqual([sent, msgs.map((m) => m.t)], [[], ['ready']], 'nothing passes either way yet');
  fire(f, env(nonce(f), 'loaded', { mode: 'run' }));
  assert.deepEqual(sent, [], 'a report of another mode pays nothing');
  fire(f, done);
  assert.deepEqual([sent, msgs.map((m) => m.t)], [['scroll:1', 'scroll:2'], ['ready', 'visible']], 'the report delivers both, in order');
  host.send('x', {});
  assert.equal(sent.at(-1), 'x', 'believed again');
  fire(f, done); loadEvent(f);   // a later load its doc reported, in order
  assert.deepEqual(msgs.map((m) => m.t), ['ready', 'visible'], 'loaded is the host\'s own: it never reaches the stage');
  clock.tick(5000); await tick();
  assert.equal(mints.length, 1);
  loadEvent(f); clock.tick(1500); await tick();
  assert.equal(mints.length, 2);
  fire(f, done);
  const n = msgs.length; fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.equal(msgs.length, n, 'a report after the grace changes nothing');
});
test('a self-reload whose ready came during the grace drops what waited: the reloaded doc starts from its ready', async () => {
  const { host, frames, nonce, fire, msgs } = rig();
  await host.load('run');
  const f = frames()[0]; const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 });
  const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t);
  fire(f, ok); fire(f, env(nonce(f), 'loaded', { mode: 'run' })); loadEvent(f);
  loadEvent(f); host.send('stale', {}); fire(f, env(nonce(f), 'visible', { id: 'old' }));
  fire(f, ok);
  fire(f, env(nonce(f), 'loaded', { mode: 'run' }));
  assert.deepEqual([sent, msgs.map((m) => m.t)], [[], ['ready', 'ready']]);
});
test('a self-reload whose load beat its ready is believed at its report, not its ready: what waited lands, and a later page that leaves is still caught (review cycle 4)', async () => {
  const { host, frames, nonce, fire, clock, mints, msgs, lost } = rig();
  await host.load('run');
  const f = frames()[0]; const sent = []; f.contentWindow.postMessage = (m) => sent.push(m.t);
  const ok = env(nonce(f), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 });
  const done = env(nonce(f), 'loaded', { mode: 'run' });
  fire(f, ok); fire(f, done); loadEvent(f);
  loadEvent(f); fire(f, ok);   // a self-reload whose ready lost the race with its load: the stage still gets the ready
  assert.equal(host.send('hello', {}), true, 'held while its load is owed its report');
  fire(f, env(nonce(f), 'visible', { id: 'hero' }));
  assert.deepEqual([sent, msgs.map((m) => m.t)], [[], ['ready', 'ready']], 'not believed before its report: both wait');
  fire(f, done);               // its report pays that load, and nothing more
  assert.deepEqual([sent, msgs.map((m) => m.t)], [['hello'], ['ready', 'ready', 'visible']], 'believed again: what waited lands');
  clock.tick(9000); await tick();
  assert.deepEqual([mints.length, lost], [1, []], 'no reload');
  loadEvent(f);                // then the page leaves
  clock.tick(1500); await tick();
  assert.equal(mints.length, 2);
});
test('a current doc that fails while a newer one waits leaves the swap to it (review M5)', async () => {
  const { host, frames, nonce, fire, clock, mints, lost } = rig();
  await host.load('build');
  const a = frames()[0];        // a slow build doc: no ready yet
  clock.tick(3000);
  await host.load('run');
  const b = frames()[1];
  clock.tick(3000); await tick();   // the build doc's READY_TIMEOUT_MS
  assert.deepEqual([frames(), modes(frames()), host.pendingMode(), mints.length, lost], [[a, b], ['build', 'run'], 'run', 1, []]);
  fire(b, env(nonce(b), 'ready', { mode: 'run', vw: 1, vh: 1, dpr: 1 }));
  assert.deepEqual([frames(), host.mode()], [[b], 'run']);
});
test('a current doc that fails with nothing waiting reloads the mode asked for last', async () => {
  const { host, frames, clock, held } = rig({ hold: true });
  const first = host.load('build'); await tick(); held[0]('/design-preview/TOK'); await first;
  const second = host.load('run', { fresh: true }); await tick();   // its mint is still out
  clock.tick(6000); await tick();
  assert.equal(held.length, 3, 'the retry mints');
  held[2]('/design-preview/TOK'); held[1]('/design-preview/TOK'); await second; await tick();
  assert.deepEqual([modes(frames()), host.pendingMode()], [['build', 'run'], 'run']);
});
