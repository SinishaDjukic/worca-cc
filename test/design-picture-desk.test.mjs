// test/design-picture-desk.test.mjs — Design pictures (P2 Task B3c): a round's picture desk. It polls `work/.pictures/`
// for the kit command's asks, makes each picture once (3 at once, 40 a round), saves it, books it, records its row,
// answers with `<name>.done.json` and sends a frame; the ask file is an agent's, never trusted (SPEC D8, §5, §7, §8).
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync, lstatSync, mkdirSync, mkdtempSync as makeTemp, openSync, readdirSync, readFileSync, renameSync, rmSync,
  statSync, symlinkSync, truncateSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { designDir, designWorkDir, ensureDesignFolders, madeDir, picturesDir } from '../src/core/design/paths.mjs';
import { createPictureDesk, PICTURE_FAILED_ROWS, savePicture } from '../src/core/design/pictures.mjs';
import { addPicture, listPictures } from '../src/core/design/store.mjs';
import { ImagesError } from '../src/core/images.mjs';

useTempHome(after, 'worca-design-picture-desk-');
// Test 3's folder outside the design: each one made is recorded and removed by its exact path.
const outs = [];
const mkdtempSync = (prefix) => { const d = makeTemp(prefix); outs.push(d); return d; };
after(() => { for (const d of outs) rmSync(d, { recursive: true, force: true }); });
const D = 'd_0000000000a1';
const png = (w, h) => Buffer.from(encodePNG(w, h, new Uint8Array(w * h * 3).fill(90)));
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

const POSIX = process.platform !== 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 5000) => { const end = Date.now() + ms; while (!(await pred())) { if (Date.now() > end) throw new Error('timed out'); await sleep(10); } };
const lexists = (p) => { try { lstatSync(p); return true; } catch { return false; } };
const answer = (bytes = png(384, 256), extra = {}) => ({ bytes, ext: 'png', w: 1, h: 1, model: 'm', ms: 5, costUsd: 0.04, ...extra });
const desks = [];
beforeEach(() => { rmSync(designDir(D), { recursive: true, force: true }); ensureDesignFolders(D); });
afterEach(async () => { for (const d of desks.splice(0)) await d.close(); });
function rig(over = {}) {
  const r = { books: [], rows: [], frames: [], calls: [], kept: [] };
  r.desk = createPictureDesk({ designId: D, buildId: 'b_000000000001', workDir: designWorkDir(D), pollMs: 20,
    generate: async (o) => { r.calls.push(o); return answer(); }, save: (o) => savePicture({ designId: D, ...o }),
    keep: (o) => r.kept.push(o), book: (o) => r.books.push(o), emit: (f) => r.frames.push(f),
    record: (row) => { r.rows.push({ ...row, id: r.rows.length + 1 }); return r.rows.at(-1); }, ...over });
  desks.push(r.desk); return r;
}
const ask = (name, fields = {}) => {
  const body = { v: 1, name, shape: 'wide', prompt: 'A studio, no text', at: new Date().toISOString(), ...fields };
  const t = join(picturesDir(D), `.${name}.${process.hrtime.bigint()}.tmp`); writeFileSync(t, JSON.stringify(body)); renameSync(t, join(picturesDir(D), `${name}.ask.json`));
  return body.at;
};
/** A call the test opens through `gates` (`open()` is its answer). The desk's abort rejects it, and so does a 10 s
 *  bound, so a failed assertion never leaves afterEach's close() waiting on it for ever. */
const held = (gates, { signal }, open) => new Promise((res, rej) => {
  const hung = setTimeout(() => rej(new Error('hung')), 10000);
  gates.push(() => { clearTimeout(hung); res(open()); });
  signal.addEventListener('abort', () => { clearTimeout(hung); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
});
const doneOf = async (name, { at, ms = 5000 } = {}) => { let d; await until(() => { try { d = JSON.parse(readFileSync(join(picturesDir(D), `${name}.done.json`), 'utf8')); return !at || d.at === at; } catch { return false; } }, ms); return d; };

test('1 one ask: the design\'s file, its kept copy, booked once, recorded, answered, framed', async () => {
  const r = rig(); r.desk.start(); const at = ask('hero');
  assert.deepEqual(await doneOf('hero'), { v: 1, name: 'hero', at, ok: true, file: 'assets/made/hero.png', w: 384, h: 256 });
  assert.deepEqual(r.books, [{ costUsd: 0.04, model: 'm' }]);
  assert.deepEqual(r.rows.map((x) => [x.name, x.state, x.file, x.w, x.h, x.costUsd, x.model, x.reason]), [['hero', 'made', 'assets/made/hero.png', 384, 256, 0.04, 'm', null]]);
  assert.deepEqual(r.kept.map((k) => [k.id, k.ext, k.bytes.equals(png(384, 256))]), [[1, 'png', true]]);
  assert.deepEqual(r.frames.map((f) => f.state), ['making', 'made']);
  assert.equal('id' in r.frames[0], false, 'a making frame has no id');
  assert.deepEqual([r.frames[1].id, r.frames[1].file, r.frames[1].ms, r.frames[1].reason], [1, r.rows[0].file, r.rows[0].ms, null]);
  assert.match(r.frames[1].file, /^assets\/made\/hero\.png$/, 'forward slashes, on Windows too');
  assert.deepEqual([r.calls[0].prompt, r.calls[0].shape, r.calls[0].signal instanceof AbortSignal], ['A studio, no text', 'wide', true]);
  assert.deepEqual(readdirSync(madeDir(D)), ['hero.png']); assert.equal(r.desk.made, 1);
  if (POSIX) assert.equal(statSync(join(madeDir(D), 'hero.png')).mode & 0o777, 0o660);
});
test('2 start() clears what an earlier drive left: an old ask is never made or booked again', async () => {
  mkdirSync(picturesDir(D), { recursive: true }); ask('old'); writeFileSync(join(picturesDir(D), 'old.done.json'), '{}');
  const r = rig(); r.desk.start();
  assert.deepEqual(readdirSync(picturesDir(D)), []);
  await sleep(200); assert.deepEqual([r.calls.length, r.books.length, r.rows.length], [0, 0, 0]);
});
test('3 the ask file is an agent\'s: never followed, never read past 16 KiB, never used in a path', { skip: !POSIX }, async () => {
  const r = rig(); r.desk.start(); const P = picturesDir(D);
  const out = join(mkdtempSync(join(tmpdir(), 'pic-out-')), 'outside.json');
  const outText = JSON.stringify({ v: 1, name: 'a', shape: 'wide', prompt: 'p', at: 't' }); writeFileSync(out, outText);
  symlinkSync(out, join(P, 'a.ask.json'));
  assert.equal(spawnSync('mkfifo', [join(P, 'b.ask.json')]).status, 0);
  writeFileSync(join(P, 'c.ask.json'), ' '.repeat(16385));
  writeFileSync(join(P, 'd.ask.json'), ''); truncateSync(join(P, 'd.ask.json'), 2 ** 31);
  writeFileSync(join(P, 'e.ask.json'), 'not json');
  writeFileSync(join(P, 'f.ask.json'), JSON.stringify({ v: 1, name: '../x', shape: 'wide', prompt: 'p', at: 't' }));
  ask('ok'); await doneOf('ok');
  assert.deepEqual(r.calls.map((c) => c.prompt), ['A studio, no text'], 'only the good ask; the FIFO held nothing up');
  await until(() => ['a', 'b', 'c', 'd', 'e', 'f'].every((n) => !lexists(join(P, `${n}.ask.json`))));
  assert.equal(readFileSync(out, 'utf8'), outText);
  assert.equal(lexists(join(designWorkDir(D), 'x.png')) || lexists(join(designDir(D), 'x.png')), false);
  assert.deepEqual(r.rows.map((x) => x.name), ['ok']);
});
test('4 checks: off, empty and the 40 get a row, a done file and a frame; a bad shape or a long description only a done file; a failing record still answers', async () => {
  let on = true; const r = rig({ allowed: () => on, perRound: 1 }); r.desk.start();
  ask('round', { shape: 'round' }); ask('long', { prompt: 'x'.repeat(4001) });
  assert.equal((await doneOf('round')).reason, 'the shape must be wide, tall or square');
  assert.equal((await doneOf('long')).reason, 'the description is longer than 4000 characters');
  ask('empty', { prompt: '  ' }); assert.equal((await doneOf('empty')).reason, 'say what the picture shows');
  ask('max', { prompt: 'x'.repeat(4000) }); assert.equal((await doneOf('max')).ok, true);
  ask('over'); assert.equal((await doneOf('over')).reason, 'this round has made its 1 pictures');
  on = false; ask('off'); assert.equal((await doneOf('off')).reason, 'pictures are off for this design');
  assert.deepEqual(r.rows.map((x) => [x.name, x.state]), [['empty', 'failed'], ['max', 'made'], ['over', 'failed'], ['off', 'failed']]);
  assert.equal(r.calls.length, 1);
  const failed = r.frames.filter((f) => f.state === 'failed');
  assert.deepEqual(failed.map((f) => [f.name, f.id, f.file, f.ms, f.reason]), r.rows.filter((x) => x.state === 'failed').map((x) => [x.name, x.id, null, null, x.reason]));
  await r.desk.close();
  const b = rig({ record: () => { throw new Error('db'); }, emit: () => { throw new Error('ws'); } }); b.desk.start();
  ask('still'); assert.equal((await doneOf('still')).ok, true, 'logged, and the answer is still written');
  ask('none', { prompt: '' }); assert.equal((await doneOf('none')).reason, 'say what the picture shows');
});
test('5 bounds: 3 in the making at once; madeBefore counts what earlier drives made', async () => {
  let now = 0; let most = 0; const gates = [];
  const r = rig({ generate: (o) => { now += 1; most = Math.max(most, now); return held(gates, o, () => { now -= 1; return answer(); }); } });
  r.desk.start(); for (const n of ['a', 'b', 'c', 'd', 'e']) ask(n);
  await until(() => gates.length === 3); await sleep(100); assert.equal(gates.length, 3, 'the 4th waits');
  for (let i = 0; i < 5; i += 1) { await until(() => gates.length > 0); gates.shift()(); }
  await doneOf('e'); assert.equal(most, 3);
  await r.desk.close();
  const m = rig({ perRound: 2, madeBefore: 1 }); m.desk.start();
  ask('one'); assert.equal((await doneOf('one')).ok, true);
  ask('two'); assert.equal((await doneOf('two')).reason, 'this round has made its 2 pictures');
  assert.equal(m.calls.length, 1);
});
test('6 the answer is checked: not a picture, too large, a type its bytes are not', async () => {
  const bad = [answer(Buffer.from('<html>no</html>')), answer(Buffer.concat([png(1, 1), Buffer.alloc(20 * 2 ** 20)])), answer(png(8, 8), { ext: 'jpg' })];
  const r = rig({ generate: async () => bad.shift() }); r.desk.start();
  for (const n of ['x', 'y', 'z']) { ask(n); assert.equal((await doneOf(n)).reason, 'the image service answered with something that is not a picture', n); }
  assert.deepEqual([r.books, readdirSync(madeDir(D)), r.kept], [[], [], []]);
});
test('7 a service failure keeps its own words; anything else is "could not be reached"', async () => {
  const errs = [Object.assign(new ImagesError('the image service rejected the key'), { status: 401 }), new TypeError('bug')];
  const r = rig({ generate: async () => { throw errs.shift(); } }); r.desk.start();
  ask('k'); assert.equal((await doneOf('k')).reason, 'the image service rejected the key');
  ask('t'); assert.equal((await doneOf('t')).reason, 'the image service could not be reached');
  assert.deepEqual(r.books, []);
});
test('8 close() mid-call: aborted, nothing booked, no file, "the round stopped" for in-flight, queued and unread asks', async () => {
  const gen = ({ signal }) => new Promise((res, rej) => {
    const t = setTimeout(() => res(answer(png(8, 8), { costUsd: 1 })), 2000);
    signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  });
  const r = rig({ generate: gen }); r.desk.start();
  for (const n of ['a', 'b', 'c', 'd']) ask(n);
  await until(() => r.frames.filter((f) => f.state === 'making').length === 4);
  ask('late'); await r.desk.close();
  for (const n of ['a', 'b', 'c', 'd', 'late']) assert.equal((await doneOf(n, { ms: 500 })).reason, 'the round stopped', n);
  assert.deepEqual([r.books, readdirSync(madeDir(D)), r.kept], [[], [], []]);
  assert.deepEqual(r.rows.map((x) => [x.name, x.reason]).sort(), ['a', 'b', 'c', 'd'].map((n) => [n, 'the round stopped']), 'late: a done file, no row; the queued ask\'s abort fires first, so rows come in no fixed order');
});
test('9 a remake replaces the file whole; two asks under one name never run at once; another type removes the old', async () => {
  let inCall = 0; let most = 0; const gates = [];
  const outs = [answer(png(8, 8)), answer(png(16, 16)), answer(png(24, 24)), answer(jpg(384, 256), { ext: 'jpg' })];
  const r = rig({ generate: (o) => { inCall += 1; most = Math.max(most, inCall); return held(gates, o, () => { inCall -= 1; return outs.shift(); }); } });
  r.desk.start();
  ask('hero'); await until(() => gates.length === 1); gates.shift()(); await doneOf('hero');
  const p = join(madeDir(D), 'hero.png'); const first = readFileSync(p); const ino = statSync(p).ino; const fd = POSIX ? openSync(p, 'r') : null;
  ask('hero'); await until(() => gates.length === 1); await sleep(5);
  const atB = ask('hero'); await sleep(100); assert.equal(gates.length, 1, 'B waits for A');
  gates.shift()(); await until(() => gates.length === 1); gates.shift()();
  await doneOf('hero', { at: atB }); assert.equal(most, 1);
  assert.notEqual(statSync(p).ino, ino);
  if (fd !== null) { assert.deepEqual(readFileSync(fd), first, 'renamed over, never truncated'); closeSync(fd); }
  const atC = ask('hero'); await until(() => gates.length === 1); gates.shift()();
  assert.equal((await doneOf('hero', { at: atC })).file, 'assets/made/hero.jpg');
  assert.deepEqual(readdirSync(madeDir(D)), ['hero.jpg']);
  assert.deepEqual(r.kept.map((k) => [k.id, k.ext]), [[1, 'png'], [2, 'png'], [3, 'png'], [4, 'jpg']], 'each row keeps its own copy');
});
// Beyond the plan's cases: the failed-row bound (LEAD-CALLS), pictures in the making counted in the 40, and the close.
test('10 failed rows stop at PICTURE_FAILED_ROWS: past them a refusal is answered in its done file only; a failed call still ends its making frame', async () => {
  let on = false;
  const r = rig({ allowed: () => on, generate: async () => { throw new ImagesError('the image service answered 500'); } }); r.desk.start();
  const names = Array.from({ length: PICTURE_FAILED_ROWS + 1 }, (_, i) => `n${i}`);
  for (const n of names) ask(n);
  for (const n of names) assert.equal((await doneOf(n)).reason, 'pictures are off for this design', n);
  assert.equal(r.rows.length, PICTURE_FAILED_ROWS);
  assert.equal(r.frames.length, PICTURE_FAILED_ROWS, 'no frame for a refusal with no row');
  on = true; ask('late'); assert.equal((await doneOf('late')).reason, 'the image service answered 500');
  assert.equal(r.rows.length, PICTURE_FAILED_ROWS);
  assert.deepEqual(r.frames.slice(-2).map((f) => [f.name, f.state, f.id]), [['late', 'making', undefined], ['late', 'failed', null]]);
});
test('11 close(): an ask waiting behind its name ends "the round stopped" with no row and no frame; an answer written stays', async () => {
  const gates = [];
  // A call the abort never reaches ends `hung` after 3 s, so close() is never awaited forever.
  const r = rig({ generate: ({ signal }) => new Promise((res, rej) => {
    const hung = setTimeout(() => rej(new Error('hung')), 3000);
    gates.push(() => { clearTimeout(hung); res(answer()); });
    signal.addEventListener('abort', () => { clearTimeout(hung); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  }) });
  r.desk.start();
  const atDone = ask('done'); await until(() => gates.length === 1); gates.shift()(); await doneOf('done', { at: atDone });
  ask('hero'); await until(() => gates.length === 1); await sleep(5);
  const atB = ask('hero'); await sleep(100); assert.equal(gates.length, 1, 'B waits for A');
  await r.desk.close();
  assert.equal((await doneOf('hero', { at: atB, ms: 500 })).reason, 'the round stopped');
  assert.deepEqual(r.rows.map((x) => [x.name, x.state, x.reason]), [['done', 'made', null], ['hero', 'failed', 'the round stopped']]);
  assert.deepEqual(r.frames.filter((f) => f.name === 'hero').map((f) => f.state), ['making', 'failed']);
  assert.deepEqual(await doneOf('done'), { v: 1, name: 'done', at: atDone, ok: true, file: 'assets/made/done.png', w: 384, h: 256 });
});
test('12 the 40 counts the pictures still in the making', async () => {
  const gates = [];
  const r = rig({ perRound: 2, generate: (o) => held(gates, o, () => answer()) }); r.desk.start();
  for (const n of ['a', 'b', 'c']) ask(n);
  assert.equal((await doneOf('c')).reason, 'this round has made its 2 pictures');
  assert.equal(gates.length, 2);
  while (gates.length) gates.shift()();
  assert.deepEqual([(await doneOf('a')).ok, (await doneOf('b')).ok, r.desk.made], [true, true, 2]);
});
test('13 a save that fails: booked once (the service was paid), a failed row that keeps the dollars, "could not be saved"', async () => {
  const r = rig({ save: () => { throw new Error('disk'); } }); r.desk.start();
  ask('hero'); assert.equal((await doneOf('hero')).reason, 'the picture could not be saved');
  assert.deepEqual(r.books, [{ costUsd: 0.04, model: 'm' }]);
  assert.deepEqual(r.rows.map((x) => [x.state, x.file, x.costUsd, x.model, x.reason]), [['failed', null, 0.04, 'm', 'the picture could not be saved']]);
  assert.deepEqual([r.kept, r.desk.made], [[], 0]);
  assert.deepEqual(r.frames.map((f) => [f.state, f.id ?? null, f.costUsd ?? null]), [['making', null, null], ['failed', 1, 0.04]]);
});
test('13b a picture booked but not saved still counts toward the round\'s pictures: the service was paid', async () => {
  const r = rig({ perRound: 1, save: () => { throw new Error('disk'); } }); r.desk.start();
  ask('hero'); assert.equal((await doneOf('hero')).reason, 'the picture could not be saved');
  ask('next'); assert.equal((await doneOf('next')).reason, 'this round has made its 1 pictures');
  assert.deepEqual([r.calls.length, r.books.length, r.desk.made], [1, 1, 0]);
});
test('14 an ask\'s fields: `at` text of at most 40 and `v` 1, else removed; a shape or description that is not text is refused', async () => {
  const r = rig(); r.desk.start(); const P = picturesDir(D);
  const put = (name, body) => writeFileSync(join(P, `${name}.ask.json`), JSON.stringify({ v: 1, name, shape: 'wide', prompt: 'p', at: 't', ...body }));
  put('g', { at: 'x'.repeat(41) }); put('h', { v: 2 }); put('i', { at: 7 });
  put('j', { shape: 5 }); put('k', { prompt: 7 }); put('m', { at: 'x'.repeat(40) });
  assert.equal((await doneOf('j')).reason, 'the shape must be wide, tall or square');
  assert.equal((await doneOf('k')).reason, 'say what the picture shows');
  assert.equal((await doneOf('m')).ok, true);
  await until(() => ['g', 'h', 'i'].every((n) => !lexists(join(P, `${n}.ask.json`))));
  assert.deepEqual([r.calls.length, r.rows.map((x) => [x.name, x.prompt])], [1, [['k', ''], ['m', 'p']]]);
});
test('15 the 16 KiB bound holds for a whole ask too: 16384 bytes are made, 16385 are removed', async () => {
  const r = rig(); r.desk.start(); const P = picturesDir(D);
  const sized = (name, n) => {
    const body = { v: 1, name, shape: 'wide', prompt: 'A studio, no text', at: new Date().toISOString(), pad: '' };
    body.pad = 'x'.repeat(n - JSON.stringify(body).length); const text = JSON.stringify(body);
    assert.equal(Buffer.byteLength(text), n); writeFileSync(join(P, `${name}.ask.json`), text);
  };
  sized('big', 16385); sized('edge', 16384);
  assert.equal((await doneOf('edge')).ok, true);
  await until(() => !lexists(join(P, 'big.ask.json')));
  assert.deepEqual([lexists(join(P, 'big.done.json')), r.calls.length, r.rows.map((x) => x.name)], [false, 1, ['edge']]);
});
test('16 an answer whose bytes break the picture check is not a picture: answered, nothing booked, its making frame ended', async () => {
  const hostile = new Proxy(png(8, 8), { get(t, k) { if (k === 'length') return t.length; throw new Error('bug'); } });
  const r = rig({ generate: async () => answer(hostile) }); r.desk.start();
  ask('odd'); assert.equal((await doneOf('odd')).reason, 'the image service answered with something that is not a picture');
  assert.deepEqual([r.books, r.kept, readdirSync(madeDir(D))], [[], [], []]);
  assert.deepEqual(r.rows.map((x) => [x.name, x.state, x.reason]), [['odd', 'failed', 'the image service answered with something that is not a picture']]);
  assert.deepEqual(r.frames.map((f) => f.state), ['making', 'failed']);
});
test('17 every row the desk writes is one the store keeps: made, refused, failed by the service, not saved', async () => {
  const warned = []; const warn = console.warn; console.warn = (...a) => { warned.push(a.join(' ')); };
  try {
    const store = (row) => addPicture({ ...row, designId: D, buildId: 'b_000000000001', round: 1 });
    const long = `the image service refused this description: ${'x'.repeat(200)}`;
    const outs = [() => { throw new ImagesError(long); }, () => answer()];
    const r = rig({ record: store, perRound: 1, generate: async () => outs.shift()() }); r.desk.start();
    ask('fail'); assert.equal((await doneOf('fail')).reason, long);
    ask('made'); assert.equal((await doneOf('made')).ok, true);
    ask('over'); assert.equal((await doneOf('over')).reason, 'this round has made its 1 pictures');
    ask('blank', { prompt: '  ' }); assert.equal((await doneOf('blank')).reason, 'say what the picture shows');
    await r.desk.close();
    let on = false;
    const s = rig({ record: store, allowed: () => on, save: () => { throw new Error('disk'); } }); s.desk.start();
    ask('off'); assert.equal((await doneOf('off')).reason, 'pictures are off for this design');
    on = true; ask('unsaved'); assert.equal((await doneOf('unsaved')).reason, 'the picture could not be saved');
    assert.deepEqual(listPictures(D).map((p) => [p.name, p.state, p.reason, p.costUsd]), [
      ['fail', 'failed', long, null], ['made', 'made', null, 0.04], ['over', 'failed', 'this round has made its 1 pictures', null],
      ['blank', 'failed', 'say what the picture shows', null], ['off', 'failed', 'pictures are off for this design', null],
      ['unsaved', 'failed', 'the picture could not be saved', 0.04],
    ]);
    assert.deepEqual(warned.filter((t) => t.includes(': the row (')), [], 'no row was refused');
  } finally {
    console.warn = warn;
  }
});
test('18 each ask is made once: a touched ask, or one written again with the same bytes, is never made or booked again', async () => {
  const r = rig(); r.desk.start(); const P = picturesDir(D); const f = join(P, 'hero.ask.json');
  const at = ask('hero'); await doneOf('hero', { at });
  const later = new Date(Date.now() + 60000); utimesSync(f, later, later);
  await sleep(200);
  const t = join(P, '.hero.again.tmp'); writeFileSync(t, readFileSync(f)); renameSync(t, f);
  await sleep(200);
  assert.deepEqual([r.calls.length, r.books.length, r.rows.length, r.kept.length], [1, 1, 1, 1]);
});
