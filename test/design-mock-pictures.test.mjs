// test/design-mock-pictures.test.mjs — Design pictures (P2 Task B5b): the mock lead's picture tokens.
// `MOCK_PICTURE=<name>:<shape>` (and `MOCK_PICTURE_FAIL=`, which adds `MOCK_REFUSE` to the description) in a brief make
// the mock lead run the picture kit through a real `node .kit/picture.mjs` child process, as a real lead does with its
// shell, but only when its prompt carries the `Picture kit:` line. A `3` (still in the making) is waited on with the
// name alone. Tests 1-3 run whole builds against the round's picture desk; 4 and 5 run the mock lead alone against a
// stub kit that records its arguments and answers queued exit codes. Test 2 reaches the real `imagesReady` and
// `generatePicture` in mock mode, so the file moves `HOME` to its own sandbox (settings.json follows HOME).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { picturesDir } from '../src/core/design/paths.mjs';
import { listPictures } from '../src/core/design/store.mjs';
import { imagesReady } from '../src/core/images.mjs';
import { updateImages } from '../src/core/settings.mjs';


useDesignEnv(after);
const png = (w, h) => Buffer.from(encodePNG(w, h, new Uint8Array(w * h * 3).fill(90)));

const gen = Object.assign(async (o) => { gen.calls.push(o); return { bytes: png(384, 256), ext: 'png', w: 384, h: 256, model: 'gpt-image-2.6-flare', ms: 5, costUsd: 0.04 }; }, { calls: [] });
beforeEach(() => { gen.calls.length = 0; });
const on = { imagesReady: () => true, generatePicture: gen };

/** Resolves after `ms`, or at once when the signal aborts. */
const sleep = (ms, signal) => new Promise((r) => {
  const t = setTimeout(r, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
});

const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const sandbox = mkdtempSync(join(tmpdir(), 'worca-mock-pictures-'));
before(() => { process.env.HOME = sandbox; process.env.USERPROFILE = sandbox; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1'; });
after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(sandbox, { recursive: true, force: true }); });
const seenRun = (texts) => async (o) => { const r = await runClaude({ ...o, mock: true }); texts.push(r?.text ?? ''); return r; };
test('1 a slow picture: the command ends with 3, the lead waits again with the name alone, one ask, one picture', async () => {
  const slow = { ...on, generatePicture: async (o) => { await sleep(900, o.signal); return gen(o); } };
  const d = newDesign(); const texts = [];
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_PICTURE=hero:wide MOCK_PICTURE_WAIT_MS=250', deps: { ...slow, runClaude: seenRun(texts) } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.match(texts[0], /Pictures: hero 3(,3)*,0\./, 'first 3, then the name alone until 0');
  assert.deepEqual(readdirSync(picturesDir(d.id)).filter((n) => n.endsWith('.ask.json')), ['hero.ask.json'], 'the name alone wrote no ask');
  assert.deepEqual([listPictures(d.id).length, gen.calls.length], [1, 1]);
  assert.equal(gen.calls[0].prompt, 'Mock picture of hero, no text');
});
test('2 a refused description in mock mode: a failed row and frame, the reason printed, the round goes on', async () => {
  await updateImages({ service: 'other', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock-model', apiKey: 'mock-key', price: 0.02 });   // the sandbox home's service
  assert.equal(imagesReady(), true);
  const d = newDesign(); const texts = [];
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_PICTURE_FAIL=bad:wide MOCK_PICTURE=good:square', deps: { runClaude: seenRun(texts) } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const rows = listPictures(d.id); const bad = rows.find((r) => r.name === 'bad');
  assert.deepEqual([bad.state, bad.reason, bad.file, bad.costUsd], ['failed', 'the image service refused this description: mock', null, null]);
  const good = rows.find((r) => r.name === 'good');
  assert.deepEqual([good.state, good.costUsd], ['made', 0.02], 'the mock answers no usage.cost, so the sandbox price is booked');
  const failed = framesOf(frames, 'design-picture').find((f) => f.state === 'failed');
  assert.deepEqual([failed.id, failed.reason, failed.file], [bad.id, bad.reason, null]);
  assert.match(texts[0], /Pictures: bad 1\./);
  assert.equal(JSON.parse(readFileSync(join(picturesDir(d.id), 'bad.done.json'), 'utf8')).reason, 'the image service refused this description: mock');
});
test('3 no Picture kit line: the tokens do nothing', async () => {
  const d = newDesign({ pictures: false }); const texts = [];
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_PICTURE=hero:wide', deps: { ...on, runClaude: seenRun(texts) } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.doesNotMatch(texts[0], /Pictures:/); assert.equal(gen.calls.length, 0);
});

// A stub kit in `<w>/.kit/picture.mjs`: it appends its arguments to `<w>/argv.ndjson` and ends with the next code
// queued in `<w>/codes.json` (0 once the queue is empty); `hang` keeps it alive 30 s.
const STUB_KIT = [
  "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
  "const at = (f) => new URL(`../${f}`, import.meta.url);",
  "appendFileSync(at('argv.ndjson'), `${JSON.stringify(process.argv.slice(2))}\\n`);",
  "const codes = JSON.parse(readFileSync(at('codes.json'), 'utf8'));",
  'const code = codes.length ? codes.shift() : 0;',
  "writeFileSync(at('codes.json'), JSON.stringify(codes));",
  "if (code === 'hang') setTimeout(() => {}, 30000); else process.exitCode = code;",
  '',
].join('\n');
const KIT_LINE = '\nPicture kit: .kit/picture.mjs';
function stubWork(codes) {
  const w = mkdtempSync(join(sandbox, 'kit-'));
  mkdirSync(join(w, '.kit'));
  writeFileSync(join(w, '.kit', 'picture.mjs'), STUB_KIT);
  writeFileSync(join(w, 'codes.json'), JSON.stringify(codes));
  return w;
}
const argvOf = (w) => (existsSync(join(w, 'argv.ndjson')) ? readFileSync(join(w, 'argv.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const lead = (w, prompt, extra = {}) => { const ev = []; return runClaude({ mock: true, cwd: w, systemPrompt: 'MOCK_ROLE: design-lead', prompt, onEvent: (e) => ev.push(e), ...extra }).then((r) => ({ r, ev })); };

test('4 the kit gets one argument per field, the name alone after a 3, a wait only from 1 to 100000, once per session', async () => {
  const w = stubWork([1, 3, 0]);
  const brief = 'MOCK_SECTIONS=1 MOCK_PICTURE_FAIL=bad:tall MOCK_PICTURE=hero:wide MOCK_PICTURE=hero:square MOCK_PICTURE_DELAY_MS=700 MOCK_PICTURE_WAIT_MS=0';
  const a = await lead(w, `${brief}${KIT_LINE}`);
  assert.equal(a.r.text, 'Planned 1 sections. Pictures: bad 1. Pictures: hero 3,0.');
  assert.deepEqual(argvOf(w), [
    ['bad', 'tall', 'Mock picture of bad, no text MOCK_DELAY_MS=700 MOCK_REFUSE'],
    ['hero', 'wide', 'Mock picture of hero, no text MOCK_DELAY_MS=700'],
    ['hero'],
  ], 'in brief order; a wait of 0 is ignored, the second hero is skipped');
  const sid = a.ev.find((e) => e.type === 'session').sessionId;
  const again = await lead(w, `${brief}${KIT_LINE}`, { resumeSessionId: sid });
  assert.equal(again.r.text, 'Planned 1 sections.');
  assert.equal(argvOf(w).length, 3, 'the same session never asks again');
  const b = await lead(w, `MOCK_SECTIONS=1 MOCK_PICTURE=hero:wide MOCK_PICTURE_WAIT_MS=100000${KIT_LINE}`);
  assert.equal(b.r.text, 'Planned 1 sections. Pictures: hero 0.');
  assert.deepEqual(argvOf(w).slice(3), [['--wait-ms', '100000', 'hero', 'wide', 'Mock picture of hero, no text']], 'a new session asks again');
  const c = stubWork([]);
  await lead(c, `MOCK_SECTIONS=1 MOCK_PICTURE=sky:square MOCK_PICTURE_WAIT_MS=100001${KIT_LINE}`);
  assert.deepEqual(argvOf(c), [['sky', 'square', 'Mock picture of sky, no text']], 'a wait above 100000 is ignored');
  const d = stubWork([]);
  const off = await lead(d, 'MOCK_SECTIONS=1 MOCK_PICTURE=sky:square');
  assert.deepEqual([off.r.text, argvOf(d)], ['Planned 1 sections.', []], 'no Picture kit line, no command');
});

test('5 a last code other than 0 or 1 fails the lead, the name alone runs 20 times at most, a stop is no failure', async () => {
  const prompt = `MOCK_SECTIONS=1 MOCK_PICTURE=hero:wide${KIT_LINE}`;
  const w = stubWork(Array(25).fill(3));
  await assert.rejects(lead(w, prompt), /mock failure/);
  assert.deepEqual([argvOf(w).length, argvOf(w).slice(1).every((a) => a.length === 1)], [21, true]);
  assert.equal(existsSync(join(w, 'plan.json')), false, 'the failed lead writes no plan');
  const u = stubWork([2]);
  await assert.rejects(lead(u, prompt), /mock failure/);
  assert.equal(argvOf(u).length, 1);
  const h = stubWork(['hang']);
  const ac = new AbortController(); const ev = [];
  const p = runClaude({ mock: true, cwd: h, systemPrompt: 'MOCK_ROLE: design-lead', prompt, signal: ac.signal, onEvent: (e) => ev.push(e) });
  await waitUntil(() => existsSync(join(h, 'argv.ndjson')));
  const t0 = Date.now();
  ac.abort();
  await assert.rejects(p, { name: 'AbortError' });
  assert.ok(Date.now() - t0 < 10000, 'the stop ends the command');
  assert.equal(ev.some((e) => e.type === 'result'), false, 'a stop sends no error result');
});
