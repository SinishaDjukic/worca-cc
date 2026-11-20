// test/design-sound-routes.test.mjs — Design sound (P2 Task B8, SPEC §5 "Design routes", §7 "Route refusals" and
// "Gear errors"): a design's sound state, its files and the gear's ask, on a bare Express app. The files are an agent's
// to write, so the file route serves only the names `soundTracks` lists, from a handle, never cached. `soundState()`
// reads settings through HOME, so this file moves HOME and USERPROFILE itself; `useDesignEnv` owns WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { newDesign, useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { createThread } from '../src/core/ask/store.mjs';
import { silentWav } from '../src/core/sound.mjs';
import { musicUsd, voiceUsd } from '../src/shared/sound-services.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { makeSound } from '../src/core/design/sound.mjs';
import { getDesign, updateDesign } from '../src/core/design/store.mjs';

const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const home = mkdtempSync(join(tmpdir(), 'worca-design-sound-routes-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const servers = [];
const registries = [];
after(async () => {
  for (const r of registries) { r.pauseAll(); await r.settled(); }
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});
useDesignEnv(after);
after(() => {
  for (const [k, v] of Object.entries(savedHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

/** `mock: true` keeps every spawn on the mock; nothing here starts a build. */
const designBuilds = createDesignBuilds({ broadcast: () => {}, deps: { mock: true, staggerMs: 0, retryDelayMs: 0 } });
registries.push(designBuilds);

/** A bare app with these deps: `call(method, path, body)` -> `{status, json}`; `raw(path, headers)` -> status, headers
 *  and the body's bytes. */
async function mkApp(deps) {
  const app = express();
  app.use(express.json());
  registerDesignRoutes(app, { broadcast: () => {}, deps });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const raw = async (path, headers = {}) => {
    const r = await fetch(`${base}${path}`, { headers });
    return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
  };
  return { call, raw };
}

/** Part C's `soundCards`, stubbed: `ok` is what `available` answers, `next` what `openFromGear` resolves; both record
 *  their calls. */
const soundCards = {
  ok: true,
  next: { cardId: 'c1' },
  seen: [],
  opened: [],
  available(design) { this.seen.push(design.id); return this.ok; },
  async openFromGear(arg) { this.opened.push(arg); return this.next; },
};
const resetCards = () => { soundCards.ok = true; soundCards.next = { cardId: 'c1' }; soundCards.seen = []; soundCards.opened = []; };

let call, raw, bare;
before(async () => {
  ({ call, raw } = await mkApp({ designBuilds, soundCards }));
  ({ call: bare } = await mkApp({ designBuilds }));
});

const ON_CALM = { on: true, voice: { id: 'mock-voice-1', name: 'Ana' }, music: { kind: 'calm' } };

/** B3's first test's plan: three scenes, two with words. Its scenes have `parts: ['html']`, as `validatePlan` asks, so
 *  the route's `planOf` reads it. */
const PLAN = {
  v: 1, kind: 'video', title: 'T', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '',
  sections: [['open', 4, 'Meet worca. It plans.'], ['mid', 6], ['close', 3, 'Try it today.']].map(([id, duration, say]) => ({
    id, job: `the ${id} scene`, brief: `Show the ${id} scene.`, parts: ['html'], duration, ...(say === undefined ? {} : { say }),
  })),
};
/** P1's `speak`, stubbed: a silent clip as long as B3's first test's (or `ext` bytes that are never sniffed). */
const speakAs = (ext) => async ({ text }) => {
  const s = { 'Meet worca. It plans.': 4.82, 'Try it today.': 2 }[text] ?? 2;
  const bytes = ext === 'wav' ? silentWav(s) : new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...new Array(300).fill(7)]);
  return { bytes, ext, seconds: s, costUsd: voiceUsd(text.length), model: 'elevenlabs/eleven_multilingual_v2' };
};
/** P1's `compose`, stubbed: a silent track of the asked length. */
async function compose({ seconds }) {
  return { bytes: silentWav(seconds), ext: 'wav', seconds, costUsd: musicUsd(seconds), model: 'elevenlabs/music_v2_5' };
}

/** A video design with B3's files in `work/`, made by `makeSound`, and a valid `work/plan.json` from its grown plan. */
async function soundDesign({ ext = 'wav' } = {}) {
  const d = newDesign({ kind: 'video' });
  updateDesign(d.id, { sound: ON_CALM });
  const workDir = designWorkDir(d.id);
  const r = await makeSound({ designId: d.id, workDir, plan: PLAN, sound: ON_CALM, speak: speakAs(ext), compose, book: () => {} });
  assert.deepEqual(r.failed, []);
  writeFileSync(join(workDir, 'plan.json'), JSON.stringify(r.plan));
  return { id: d.id, workDir, file: (name) => join(workDir, 'assets', 'sound', name) };
}

const TRACKS = {
  clips: [{ id: 'open', file: 'voice-open.wav', start: 0.35, seconds: 4.82 }, { id: 'close', file: 'voice-close.wav', start: 12.05, seconds: 2 }],
  music: { file: 'music.wav', seconds: 14.7, gain: 0.16 },
};
const NO_FILE = { error: 'sound file not found' };

let made;
before(async () => { made = await soundDesign(); });

test('GET sound: a silent design has no sound and no tracks', async () => {
  const d = newDesign({ kind: 'video' });
  const r = await call('GET', `/api/design/${d.id}/sound`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { available: true, sound: null, tracks: null });
  assert.deepEqual((await call('GET', '/api/design/d_000000000000/sound')).json, { error: 'design not found' });
});

test('GET sound: the choice and the tracks of the plan on disk (the grown scenes: close starts at 12.05)', async () => {
  const r = await call('GET', `/api/design/${made.id}/sound`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { available: true, sound: ON_CALM, tracks: TRACKS });
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    assert.equal((await call('GET', `/api/design/${made.id}/sound`)).json.available, false, "soundState's available");
  } finally { delete process.env.WORCA_BROKER_URL; }
});

test('GET sound file: a listed file, whole and by one range, never cached', async () => {
  const bytes = readFileSync(made.file('voice-open.wav'));
  const r = await raw(`/api/design/${made.id}/sound/files/voice-open.wav`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/wav');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.equal(r.headers.get('etag'), null);
  assert.equal(r.headers.get('last-modified'), null);
  assert.ok(r.bytes.equals(bytes), 'the file as made');

  const part = await raw(`/api/design/${made.id}/sound/files/voice-open.wav`, { range: 'bytes=0-99' });
  assert.equal(part.status, 206);
  assert.equal(part.bytes.length, 100);
  assert.ok(part.bytes.equals(bytes.subarray(0, 100)));
  assert.equal(part.headers.get('content-range'), `bytes 0-99/${bytes.length}`);
  assert.equal(part.headers.get('cache-control'), 'no-store');
  assert.equal(part.headers.get('etag'), null);

  const late = await raw(`/api/design/${made.id}/sound/files/voice-open.wav`, { range: `bytes=${bytes.length + 10}-` });
  assert.equal(late.status, 416);
  assert.equal(late.headers.get('content-range'), `bytes */${bytes.length}`);

  const music = await raw(`/api/design/${made.id}/sound/files/music.wav`);
  assert.equal(music.status, 200);
  assert.ok(music.bytes.equals(readFileSync(made.file('music.wav'))));
});

test('GET sound file: an mp3 is audio/mpeg', async () => {
  const mp3 = await soundDesign({ ext: 'mp3' });
  const r = await raw(`/api/design/${mp3.id}/sound/files/voice-close.mp3`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.ok(r.bytes.equals(readFileSync(mp3.file('voice-close.mp3'))));
});

test('GET sound file: only a listed name; anything else is 404 in its own words', async () => {
  writeFileSync(made.file('voice-stray.wav'), silentWav(1));
  for (const name of ['sound.json', '..%2F..%2Fplan.json', 'voice-nope.wav', 'voice-stray.wav', 'voice-mid.wav']) {
    const r = await call('GET', `/api/design/${made.id}/sound/files/${name}`);
    assert.equal(r.status, 404, name);
    assert.deepEqual(r.json, NO_FILE, name);
  }
  const silent = newDesign({ kind: 'video' });
  assert.deepEqual(await call('GET', `/api/design/${silent.id}/sound/files/voice-open.wav`), { status: 404, json: NO_FILE });
  assert.deepEqual(await call('GET', '/api/design/d_000000000000/sound/files/voice-open.wav'), { status: 404, json: { error: 'design not found' } });
});

test('GET sound file: a clip replaced by a link to another file is not served', async () => {
  const linked = await soundDesign();
  const other = join(home, 'other.wav');
  writeFileSync(other, silentWav(3));
  unlinkSync(linked.file('voice-open.wav'));
  symlinkSync(other, linked.file('voice-open.wav'));
  const r = await call('GET', `/api/design/${linked.id}/sound/files/voice-open.wav`);
  assert.deepEqual(r, { status: 404, json: NO_FILE });
  assert.equal((await raw(`/api/design/${linked.id}/sound/files/voice-close.wav`)).status, 200, 'the other clip still plays');
});

test('GET sound file: two ranges are the whole file; a zero-byte listed file is empty, and any range of it is 416', async () => {
  const z = await soundDesign();
  const bytes = readFileSync(z.file('voice-open.wav'));
  const multi = await raw(`/api/design/${z.id}/sound/files/voice-open.wav`, { range: 'bytes=0-1,5-9' });
  assert.equal(multi.status, 200);
  assert.ok(multi.bytes.equals(bytes), 'the whole file, never the first range');
  assert.equal(multi.headers.get('content-range'), null);
  assert.equal(multi.headers.get('content-length'), String(bytes.length));
  const items = await raw(`/api/design/${z.id}/sound/files/voice-open.wav`, { range: 'items=0-1' });   // a unit other than bytes
  assert.deepEqual([items.status, items.bytes.equals(bytes), items.headers.get('content-range')], [200, true, null]);
  writeFileSync(z.file('voice-close.wav'), '');                                         // still listed: the listing reads no size
  const empty = await raw(`/api/design/${z.id}/sound/files/voice-close.wav`);
  assert.equal(empty.status, 200);
  assert.equal(empty.bytes.length, 0);
  assert.equal(empty.headers.get('content-length'), '0');
  for (const range of ['bytes=0-3', 'bytes=0-', 'bytes=-5', 'bytes']) {                  // 'bytes' is malformed: only the size-0 arm refuses it
    const r = await raw(`/api/design/${z.id}/sound/files/voice-close.wav`, { range });
    assert.equal(r.status, 416, range);
    assert.equal(r.headers.get('content-range'), 'bytes */0', range);
  }
});

/** The open file handles of this process: the server runs in it, so a handle the route leaks is counted here. */
const openFds = () => readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').length;
test('GET sound file: an aborted stream, a HEAD and a 416 each close their file handle', { skip: process.platform === 'win32' ? 'no fd listing' : false }, async () => {
  const z = await soundDesign();
  writeFileSync(z.file('music.wav'), Buffer.alloc(32 << 20));                            // too big to be buffered before the abort
  const port = servers[0].address().port;
  for (const srv of servers) srv.closeAllConnections?.();                                // fetch's kept-alive sockets close first
  let prev = -1;
  let same = 0;
  await waitUntil(() => { const n = openFds(); same = n === prev ? same + 1 : 0; prev = n; return same >= 4; });
  const base = openFds();
  const send = (path, { method = 'GET', headers = {}, onRes } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false },
      (res) => (onRes ? onRes(req, res, resolve) : (res.resume(), res.on('end', () => resolve(res.statusCode)))));
    req.on('error', (e) => (onRes ? undefined : reject(e)));
    req.end();
  });
  const back = async (what) => {
    try {
      await waitUntil(() => openFds() === base, 3000);
    } catch {
      assert.fail(`${what}: ${openFds() - base} handle(s) left open`);
    }
  };
  const url = `/api/design/${z.id}/sound/files/music.wav`;
  assert.equal(await send(url, { onRes: (req, res, done) => res.once('data', () => { req.destroy(); done(res.statusCode); }) }), 200);
  await back('an aborted GET');
  assert.equal(await send(url, { method: 'HEAD' }), 200);
  await back('a HEAD');
  assert.equal(await send(url, { headers: { range: 'bytes=99999999-' } }), 416);
  await back('a 416');
});

test('POST sound/ask: a video only, then available, then a chat; the card or the one already open', async () => {
  resetCards();
  const web = newDesign({ kind: 'web' });
  assert.deepEqual(await call('POST', `/api/design/${web.id}/sound/ask`, {}), { status: 400, json: { error: 'Only a video has sound' } });
  const video = newDesign({ kind: 'video' });
  assert.deepEqual(await bare('POST', `/api/design/${video.id}/sound/ask`, {}), { status: 409, json: { error: 'Sound is not available here' } },
    'no soundCards');
  assert.deepEqual(soundCards.seen, [], 'the kind is checked before the cards are asked');

  soundCards.ok = false;
  assert.deepEqual(await call('POST', `/api/design/${video.id}/sound/ask`, {}), { status: 409, json: { error: 'Sound is not available here' } });
  assert.deepEqual(soundCards.seen, [video.id]);
  soundCards.ok = true;
  assert.deepEqual(await call('POST', `/api/design/${video.id}/sound/ask`, {}), { status: 409, json: { error: 'This design has no chat' } });
  assert.deepEqual(soundCards.opened, [], 'nothing opened on a refusal');

  const t = createThread({ mode: 'design', title: video.title });
  updateDesign(video.id, { threadId: t.id });
  assert.deepEqual(await call('POST', `/api/design/${video.id}/sound/ask`, {}), { status: 201, json: { cardId: 'c1' } });
  assert.deepEqual(soundCards.opened, [{ design: getDesign(video.id), threadId: t.id }]);

  soundCards.next = null;
  assert.deepEqual(await call('POST', `/api/design/${video.id}/sound/ask`), { status: 409, json: { error: 'A sound card is already open in the chat.' } });
  assert.equal(soundCards.opened.length, 2);
  assert.deepEqual(await call('POST', '/api/design/d_000000000000/sound/ask', {}), { status: 404, json: { error: 'design not found' } });
  assert.equal(soundCards.opened.length, 2);
});
