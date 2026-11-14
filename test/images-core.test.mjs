// test/images-core.test.mjs
// src/core/images.mjs against an injected fetch (no network, no live service): the body per
// preset, the answer checks, the SPEC §7 reasons, the two ways out (a service reason or an
// AbortError), the deadline, the stored key's origin rule, the Test picture, and mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { updateImages, settingsFile } from '../src/core/settings.mjs';
import {
  ImagesError, imagesState, imagesReady, generatePicture, testImages, pictureSize,
  IMAGES_TIMEOUT_MS, IMAGES_MAX_BYTES,
} from '../src/core/images.mjs';
import { mockEnabled } from '../src/core/claude-runner.mjs';

delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-imagescore-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A PNG header: signature, IHDR length 13, `IHDR`, w at 16, h at 20 (33 bytes), then `pad` zeros. */
function png(w, h, pad = 0) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
/** A JPEG: SOI + an APP0 of length 4, then an SOF0 of h x w, then 9 zeros. */
function jpeg(w, h) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03]),
    Buffer.alloc(9),
  ]);
}
/** A WebP (VP8X): 30 bytes, `w - 1` and `h - 1` as 3-byte little-endian at 24 and 27. */
function webp(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
const ok = (bytes, extra) => json(200, { data: [{ b64_json: bytes.toString('base64') }], ...extra });
/** A fetch that records each call and answers the next item (a function is called, so it can throw). */
function spy(...answers) {
  const calls = [];
  const f = (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = answers.shift();
    return typeof next === 'function' ? next(url, init) : next;
  };
  f.calls = calls;
  return f;
}

test('pictureSize: PNG, JPEG and WebP headers; anything else is null', () => {
  assert.deepEqual(pictureSize(png(1536, 1024)), { ext: 'png', w: 1536, h: 1024 });
  assert.deepEqual(pictureSize(jpeg(1024, 1536)), { ext: 'jpg', w: 1024, h: 1536 });
  assert.deepEqual(pictureSize(webp(1024, 1024)), { ext: 'webp', w: 1024, h: 1024 });
  for (const b of [Buffer.from('GIF89a\x01\x00\x01\x00'), Buffer.from('<!doctype html><title>Error</title>'), Buffer.alloc(0), png(0, 10)]) assert.equal(pictureSize(b), null);
});
test('imagesState carries no key; ready (synchronously) = address, model, price, and a key that resolves or no key on a local address', async () => {
  await withSandbox(async () => {
    assert.deepEqual(imagesState(), { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: null, configured: false, settable: true, keySet: false, keySource: null, keyRef: null, keyMasked: null, keyMissing: false });
    process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
    try { assert.equal(imagesState().settable, false, 'the broker on: no key can be stored'); } finally { delete process.env.WORCA_BROKER_URL; }
    await updateImages({ apiKey: 'sk-img-abcdef1234', price: 0.04 });
    const s = imagesState();
    assert.deepEqual([s.configured, s.keySource, s.keyMasked, 'apiKey' in s, JSON.stringify(s).includes('sk-img')], [true, 'stored', '••••••1234', false, false]);
    await updateImages({ apiKey: '${IMG_KEY_UNSET_X}' });
    assert.deepEqual([imagesState().keyMissing, imagesState().keyRef, imagesReady()], [true, '${IMG_KEY_UNSET_X}', false]);
    await updateImages({ service: 'other', baseUrl: 'http://127.0.0.1:7860/v1', model: 'sd', apiKey: '', price: 0 });
    assert.equal(imagesReady(), true, 'no key: a local server');
    assert.equal(typeof imagesReady(), 'boolean', 'synchronous, never a promise');
    await updateImages({ model: '' });
    assert.equal(imagesReady(), false, 'no model');
    await updateImages({ model: 'sd', baseUrl: 'https://img.example/v1' });
    assert.equal(imagesReady(), false, 'a remote address needs a key');
    await updateImages({ apiKey: 'mock-key' });
    assert.equal(imagesReady(), true, 'any non-empty key that resolves');
    await writeFile(settingsFile(), JSON.stringify({ providers: { images: { service: 'other', baseUrl: 'http://127.0.0.1:7860/v1', model: 'sd', apiKey: 'mock-key' } } }));
    assert.equal(imagesReady(), false, 'a hand-edited row without a price is not ready (D9: no unknown price)');
  });
});
test('the body per preset: size and quality for OpenAI and never response_format; aspect_ratio and response_format for xAI; /images for OpenRouter', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-openai-12345678', price: 0.04 });
    const f = spy(ok(png(1536, 1024)));
    const r = await generatePicture({ prompt: 'A pottery studio, no text', shape: 'wide', fetch: f });
    assert.equal(f.calls[0].url, 'https://api.openai.com/v1/images/generations');
    assert.deepEqual(f.calls[0].body, { model: 'gpt-image-2.6-flare', prompt: 'A pottery studio, no text', n: 1, size: '1536x1024', quality: 'medium' });
    assert.equal(f.calls[0].init.headers.authorization, 'Bearer sk-openai-12345678');
    assert.deepEqual([r.ext, r.w, r.h, r.model, r.costUsd, typeof r.ms], ['png', 1536, 1024, 'gpt-image-2.6-flare', 0.04, 'number']);
    await updateImages({ service: 'xai', baseUrl: '', model: '', apiKey: 'xai-12345678' });
    const x = spy(ok(jpeg(1024, 1536)));
    assert.equal((await generatePicture({ prompt: 'p', shape: 'tall', fetch: x })).ext, 'jpg');
    assert.deepEqual(x.calls[0].body, { model: 'grok-imagine-image-2.0', prompt: 'p', n: 1, aspect_ratio: '2:3', response_format: 'b64_json' });
    await updateImages({ service: 'openrouter', baseUrl: '', model: 'vendor/picture-model', apiKey: 'or-12345678', price: 0.05 });
    const o = spy(ok(png(1024, 1024), { usage: { cost: 0.0391 } }));
    assert.equal((await generatePicture({ prompt: 'p', shape: 'square', fetch: o })).costUsd, 0.0391, "the answer's usage.cost wins over the row's price");
    assert.equal(o.calls[0].url, 'https://openrouter.ai/api/v1/images');
    assert.deepEqual(o.calls[0].body, { model: 'vendor/picture-model', prompt: 'p', n: 1, size: '1024x1024' });
    for (const cost of [-1, 'x', null]) assert.equal((await generatePicture({ prompt: 'p', shape: 'square', fetch: spy(ok(png(4, 4), { usage: { cost } })) })).costUsd, 0.05, `usage.cost ${cost}: the row's price`);
  });
});
test('a url answer is fetched at once with User-Agent worca and no key; the type comes from the bytes', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'other', baseUrl: 'http://127.0.0.1:7860/v1', model: 'sd', apiKey: 'local-12345678', price: 0 });
    const f = spy(json(200, { data: [{ url: 'https://cdn.example/x/pic.png?sig=1' }] }), new Response(jpeg(256, 256)));
    const r = await generatePicture({ prompt: 'p', shape: 'square', fetch: f });
    assert.deepEqual([f.calls[1].url, f.calls[1].init.headers['user-agent'], f.calls[1].init.headers.authorization], ['https://cdn.example/x/pic.png?sig=1', 'worca', undefined]);
    assert.deepEqual([r.ext, r.w, r.costUsd], ['jpg', 256, 0]);
  });
});
test('the answer is checked: an HTML page with 200, a url to a non-picture, 20 MiB and one byte, no data', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-12345678', price: 0.04 });
    assert.equal(IMAGES_MAX_BYTES, 20 * 1024 * 1024);
    const NOT = 'the image service answered with something that is not a picture';
    const fail = (...a) => assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: spy(...a) }), (e) => e instanceof ImagesError && e.message === NOT);
    await fail(new Response('<!doctype html><title>Oops</title>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await fail(json(200, { data: [{ url: 'https://cdn.example/a.png' }] }), new Response('<html>not found</html>'));
    await fail(ok(png(10, 10, IMAGES_MAX_BYTES - 32)));
    await fail(json(200, { data: [] }));
    await fail(json(200, { data: [{ url: 'https://cdn.example/b.png' }] }), new Response(png(8, 8), { status: 404 }));
    await fail(json(200, { data: [{ b64_json: 42 }] }));
    await fail(json(200, { data: [{ b64_json: 42, url: 'https://cdn.example/c.png' }] }), new Response(png(8, 8)));
    await fail(json(200, null));
  });
});
test('HTTP failures read as the reasons of SPEC §7; a busy service is tried once more when Retry-After is 30 s or less', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-12345678', price: 0.04 });
    const reason = async (...a) => { try { await generatePicture({ prompt: 'p', shape: 'square', fetch: spy(...a) }); return 'made'; } catch (e) { return e.message; } };
    const busy = (s, ra) => new Response('{}', { status: s, headers: ra === undefined ? {} : { 'retry-after': ra } });
    assert.equal(await reason(json(401, {})), 'the image service rejected the key');
    assert.equal(await reason(json(403, {})), 'the image service rejected the key');
    assert.equal(await reason(json(400, { error: { code: 'moderation_blocked', message: 'x'.repeat(300) } })), `the image service refused this description: ${'x'.repeat(200)}`);
    assert.equal(await reason(json(500, {})), 'the image service answered 500');
    assert.equal(await reason(() => { throw new TypeError('fetch failed'); }), 'the image service could not be reached');
    assert.equal(await reason(busy(429, '0'), ok(png(4, 4))), 'made');
    assert.equal(await reason(busy(503, '31'), ok(png(4, 4))), 'the image service answered 503');
    assert.equal(await reason(busy(429, '0'), busy(429, '0')), 'the image service answered 429');
    assert.equal(await reason(busy(503)), 'the image service answered 503');
    const broken = new Response(new ReadableStream({ pull(c) { c.error(new Error('socket reset')); } }), { status: 200 });
    assert.equal(await reason(broken), 'the image service could not be reached', 'a body that breaks mid-read');
  });
});
test('only two ways out: an ImagesError with a service reason, or an AbortError when the caller stops', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-12345678', price: 0.04 });
    const SERVICE = [/^the image service rejected the key$/, /^the image service refused this description: /, /^the image service answered \d{3}$/, /^the image service could not be reached$/, /^the image service did not answer in 180 s$/, /^the image service answered with something that is not a picture$/];
    for (const a of [json(401, {}), json(400, 'nope'), json(418, {}), () => { throw new SyntaxError('x'); }, new Response('{"data":'), json(200, { data: [{ url: 'ftp://x' }] }), json(200, null)]) {
      await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: spy(a) }), (e) => e instanceof ImagesError && SERVICE.some((re) => re.test(e.message)));
    }
    const hang = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('anything'))));
    const stop = new AbortController();
    const q = generatePicture({ prompt: 'p', shape: 'square', fetch: spy(hang), signal: stop.signal });
    stop.abort('custom reason');
    await assert.rejects(q, (e) => e.name === 'AbortError' && !(e instanceof ImagesError) && !/round/.test(e.message));
    const before = spy(ok(png(4, 4)));
    await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: before, signal: AbortSignal.abort() }), (e) => e.name === 'AbortError');
    assert.equal(before.calls.length, 0, 'an aborted signal never calls');
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const armed = timers();
    await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: before, signal: {} }), (e) => e instanceof ImagesError, 'a signal that is not an AbortSignal: still a reason');
    assert.ok(timers() <= armed, 'and no deadline timer is left running');
    assert.equal(before.calls.length, 0);
    const endless = new AbortController();
    const body = generatePicture({ prompt: 'p', shape: 'square', fetch: spy(new Response(new ReadableStream({ pull: () => new Promise(() => {}) }))), signal: endless.signal });
    setTimeout(() => endless.abort(), 20);
    await assert.rejects(body, (e) => e.name === 'AbortError' && !(e instanceof ImagesError), 'a body that never ends: the stop ends the read');
    await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: spy(json(200, { data: [{ url: 'https://cdn.example/slow.png' }] }), hang), timeoutMs: 30 }), (e) => e instanceof ImagesError && /^the image service did not answer in /.test(e.message), 'the deadline covers the url fetch');
    const waiting = new AbortController();
    const retry = spy(new Response('{}', { status: 429, headers: { 'retry-after': '1' } }), ok(png(4, 4)));
    const wait = generatePicture({ prompt: 'p', shape: 'square', fetch: retry, signal: waiting.signal });
    setTimeout(() => waiting.abort(), 20);
    await assert.rejects(wait, (e) => e.name === 'AbortError' && !(e instanceof ImagesError), 'a stop during the Retry-After wait');
    assert.equal(retry.calls.length, 1, 'the stop came before the second try');
    const patient = new AbortController();
    const long = generatePicture({ prompt: 'p', shape: 'square', fetch: spy(new Response('{}', { status: 503, headers: { 'retry-after': '30' } }), ok(png(4, 4))), signal: patient.signal });
    const t1 = Date.now();
    setTimeout(() => patient.abort(), 20);
    await assert.rejects(long, (e) => e.name === 'AbortError' && !(e instanceof ImagesError));
    assert.ok(Date.now() - t1 < 5000, 'the stop ends a 30 s Retry-After wait at once');
    const late = new AbortController();
    const deaf = spy(() => new Promise((_, no) => late.signal.addEventListener('abort', () => no(new Error('late')))));
    const both = generatePicture({ prompt: 'p', shape: 'square', fetch: deaf, signal: late.signal, timeoutMs: 20 });
    setTimeout(() => late.abort(), 80);
    await assert.rejects(both, (e) => e.name === 'AbortError' && !(e instanceof ImagesError), 'the caller stops after the deadline fired: the stop still wins');
    await updateImages({ apiKey: '${IMG_KEY_GONE_X}' });
    await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: before }), (e) => e instanceof ImagesError && e.message === 'pictures are off for this design');
  });
});
test('the call ends after 180 s by default, and after timeoutMs when given', { timeout: 5000 }, async (t) => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-12345678', price: 0.04 });
    const hang = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(init.signal.reason)));
    await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: spy(hang), timeoutMs: 30 }), (e) => e instanceof ImagesError && /^the image service did not answer in /.test(e.message));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const p = generatePicture({ prompt: 'p', shape: 'square', fetch: spy(hang) });
    await new Promise((r) => setImmediate(r));
    let done = false; p.then(() => { done = true; }, () => { done = true; });
    t.mock.timers.tick(IMAGES_TIMEOUT_MS - 1);
    await new Promise((r) => setImmediate(r));
    assert.equal(done, false, 'still waiting at 179.999 s');
    t.mock.timers.tick(1);
    await assert.rejects(p, (e) => e.message === 'the image service did not answer in 180 s');
  });
});
test('a stored key never leaves its origin; testImages answers size, time and a data URL, and never throws', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-stored-99999999', price: 0.04 });
    const f = spy(ok(png(1024, 1024)), ok(png(8, 8)), ok(png(8, 8)));
    const r = await testImages({ baseUrl: 'https://api.openai.com/v1/', apiKey: '••••••9999' }, f);
    assert.deepEqual([r.ok, r.w, r.h, typeof r.ms, f.calls[0].body.size, f.calls[0].init.headers.authorization], [true, 1024, 1024, 'number', '1024x1024', 'Bearer sk-stored-99999999']);
    assert.match(r.dataUrl, /^data:image\/png;base64,iVBORw0KGgo/);
    await testImages({ service: 'xai', baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', apiKey: '••••••9999' }, f);
    assert.deepEqual([f.calls[1].url, f.calls[1].init.headers.authorization], ['https://api.x.ai/v1/images/generations', undefined]);
    await testImages({ baseUrl: 'https://other.example/v1', apiKey: 'typed-key' }, f);
    assert.equal(f.calls[2].init.headers.authorization, 'Bearer typed-key');
    // A typed ${VAR} is read from worca's environment only for the picked preset's origin, a local address, or as the saved reference itself.
    const shut = spy(ok(png(8, 8)));
    assert.deepEqual(await testImages({ baseUrl: 'https://x.example/v1', apiKey: '${HOME}' }, shut), { ok: false, message: 'Save the row before testing a key kept in a variable' });
    assert.equal(shut.calls.length, 0, 'no call: the server secret never leaves');
    process.env.IMG_TEST_VAR_X = 'from-env';
    try {
      const open = spy(ok(png(8, 8)), ok(png(8, 8)), ok(png(8, 8)));
      await testImages({ apiKey: '${IMG_TEST_VAR_X}' }, open);                                                          // the saved origin, the OpenAI preset's
      await testImages({ service: 'xai', baseUrl: 'https://api.x.ai/v1', model: 'grok-imagine-image-2.0', apiKey: '${IMG_TEST_VAR_X}' }, open);   // the preset's origin
      await testImages({ baseUrl: 'http://127.0.0.1:7860/v1', apiKey: '${IMG_TEST_VAR_X}' }, open);                   // local
      assert.deepEqual(open.calls.map((c) => c.init.headers.authorization), ['Bearer from-env', 'Bearer from-env', 'Bearer from-env']);
      assert.deepEqual(await testImages({ baseUrl: 'http://192.168.1.5:7860/v1', apiKey: '${IMG_TEST_VAR_X}' }, shut), { ok: false, message: 'Save the row before testing a key kept in a variable' }, 'a private address is not loopback');
      assert.equal(shut.calls.length, 0, 'no call to the LAN address');
      const preset = spy(ok(png(8, 8)));
      await testImages({ service: 'xai' }, preset);
      assert.deepEqual([preset.calls[0].url, preset.calls[0].body.model, preset.calls[0].init.headers.authorization], ['https://api.x.ai/v1/images/generations', 'grok-imagine-image-2.0', undefined], 'a typed preset fills what is not typed; the stored key stays on its origin');
      assert.deepEqual(await testImages({ apiKey: '${IMG_UNSET_Y}' }, shut), { ok: false, message: "the key's ${VAR} is not set in worca's environment" });
      assert.equal(shut.calls.length, 0);
    } finally { delete process.env.IMG_TEST_VAR_X; }
    assert.deepEqual(await testImages({}, spy(json(401, {}))), { ok: false, message: 'the image service rejected the key' });
    await updateImages({ service: 'other', baseUrl: '', model: '', apiKey: '', price: 0 });
    assert.deepEqual(await testImages({}, f), { ok: false, message: 'Enter a base URL' });
  });
});
test('a typed ${VAR} never reaches an address the caller chose: a keyless save opens no origin, and the broker on refuses every one', async () => {
  await withSandbox(async () => {
    const REFUSED = { ok: false, message: 'Save the row before testing a key kept in a variable' };
    process.env.IMG_SERVER_SECRET_X = 'server-secret';
    try {
      // A keyless save moves the address to the caller's server: the old key is dropped, and the new origin opens nothing.
      await updateImages({ service: 'openai', apiKey: 'sk-stored-99999999', price: 0.04 });
      await updateImages({ service: 'other', baseUrl: 'https://evil.example/v1', model: 'm', price: 0 });
      const shut = spy(ok(png(8, 8)));
      assert.deepEqual(await testImages({ apiKey: '${IMG_SERVER_SECRET_X}' }, shut), REFUSED, 'broker off: a keyless save to another origin');
      process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
      try {
        assert.deepEqual(await testImages({ apiKey: '${IMG_SERVER_SECRET_X}' }, shut), REFUSED, 'broker on: the saved address');
        assert.deepEqual(await testImages({ baseUrl: 'http://127.0.0.1:9999/v1', apiKey: '${IMG_SERVER_SECRET_X}' }, shut), REFUSED, 'broker on: loopback');
        assert.deepEqual(await testImages({ service: 'xai', apiKey: '${IMG_SERVER_SECRET_X}' }, shut), REFUSED, "broker on: a preset's own origin");
        await assert.rejects(generatePicture({ prompt: 'p', shape: 'square', fetch: shut, typed: { baseUrl: 'http://127.0.0.1:9999/v1', apiKey: '${IMG_SERVER_SECRET_X}' } }), (e) => e instanceof ImagesError && e.message === 'pictures are off for this design', 'broker on: generatePicture refuses too');
      } finally { delete process.env.WORCA_BROKER_URL; }
      assert.equal(shut.calls.length, 0, 'no call: the server secret never left');
      // The saved reference itself, typed back: it goes to the saved address, as every provider's saved key does.
      await updateImages({ apiKey: '${IMG_SERVER_SECRET_X}' });
      const open = spy(ok(png(8, 8)));
      assert.equal((await testImages({ apiKey: '${IMG_SERVER_SECRET_X}' }, open)).ok, true);
      assert.deepEqual([open.calls[0].url, open.calls[0].init.headers.authorization], ['https://evil.example/v1/images/generations', 'Bearer server-secret']);
      assert.deepEqual(await testImages({ apiKey: '${HOME}' }, shut), REFUSED, 'another variable at the saved address');
      assert.deepEqual(await testImages({ baseUrl: 'https://evil2.example/v1', apiKey: '${IMG_SERVER_SECRET_X}' }, shut), REFUSED, 'the saved reference at another origin');
      assert.equal(shut.calls.length, 0);
    } finally { delete process.env.IMG_SERVER_SECRET_X; }
  });
});
test('bad input never reaches the service', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-12345678', price: 0.04 });
    const f = spy(ok(png(4, 4)));
    await assert.rejects(generatePicture({ prompt: 'p', shape: 'banner', fetch: f }), (e) => e.message === 'the shape must be wide, tall or square');
    await assert.rejects(generatePicture({ prompt: '  ', shape: 'wide', fetch: f }), (e) => e.message === 'say what the picture shows');
    await assert.rejects(generatePicture({ prompt: 'x'.repeat(4001), shape: 'wide', fetch: f }), (e) => e.message === 'the description is longer than 4000 characters');
    assert.equal(f.calls.length, 0);
    assert.equal((await generatePicture({ prompt: 'x'.repeat(4000), shape: 'wide', fetch: f })).w, 4);
  });
});
test('mock: no network at all, even with a fetch in hand; a flat PNG of the shape, coloured by the description', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'sk-12345678', price: 0.04 });
    const prev = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK }; const was = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('network'); };
    const never = spy();
    try {
      for (const k of ['WORCA_MOCK', 'ORCH_MOCK']) {
        delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK; process.env[k] = '1';
        assert.equal(mockEnabled(), true, `${k}: mockEnabled's own rule`);
        assert.equal((await generatePicture({ prompt: 'a', shape: 'wide', fetch: never })).w, 384, k);
        assert.equal((await testImages({}, never)).ok, true, k);
      }
      await updateImages({ apiKey: 'mock-key' });
      assert.equal(imagesReady(), true, 'a mock-mode worca set up with a dummy key is ready');
      assert.equal((await generatePicture({ prompt: 'a', shape: 'square', fetch: never })).w, 256);
      assert.equal(never.calls.length, 0, 'neither generatePicture nor testImages called out; mock-key went nowhere');
      const got = {};
      for (const shape of ['wide', 'tall', 'square']) { const r = await generatePicture({ prompt: 'a', shape }); got[shape] = [r.ext, r.w, r.h, r.costUsd]; }
      assert.deepEqual(got, { wide: ['png', 384, 256, 0.04], tall: ['png', 256, 384, 0.04], square: ['png', 256, 256, 0.04] });
      const [a1, a2, b] = await Promise.all(['a', 'a', 'b'].map((prompt) => generatePicture({ prompt, shape: 'square' })));
      assert.ok(a1.bytes.equals(a2.bytes) && !a1.bytes.equals(b.bytes));
      assert.equal(crc32(a1.bytes.subarray(12, 29)), a1.bytes.readUInt32BE(29), 'a real IHDR');
      const i = a1.bytes.indexOf('IDAT');
      assert.equal(inflateSync(a1.bytes.subarray(i + 4, i + 4 + a1.bytes.readUInt32BE(i - 4))).length, 256 * (1 + 3 * 256));
      assert.equal((await testImages({})).w, 256);
    } finally {
      for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      globalThis.fetch = was;
    }
    assert.equal(mockEnabled(), false);
    assert.equal((await generatePicture({ prompt: 'a', shape: 'square', fetch: spy(ok(png(4, 4))) })).w, 4, 'mock off: the injected fetch answers');
  });
});
test('MOCK_DELAY_MS=<n> slows only the mock, and a stop ends the wait', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'mock-key', price: 0.04 });
    const prev = process.env.WORCA_MOCK;
    try {
      process.env.WORCA_MOCK = '1';
      let t0 = Date.now();
      const r = await generatePicture({ prompt: 'a calm sea MOCK_DELAY_MS=300', shape: 'square' });
      assert.equal(r.w, 256);
      assert.ok(Date.now() - t0 >= 290, 'waited about 300 ms (timers may fire a little early)');
      assert.ok(Number.isInteger(r.ms) && r.ms >= 290, 'ms is a whole number and holds the wait');
      const stop = new AbortController();
      const slow = generatePicture({ prompt: 'MOCK_DELAY_MS=10000 a calm sea', shape: 'square', signal: stop.signal });
      setTimeout(() => stop.abort(), 20);
      await assert.rejects(slow, (e) => e.name === 'AbortError' && !(e instanceof ImagesError) && !/round/.test(e.message));
      delete process.env.WORCA_MOCK;
      const f = spy(ok(png(4, 4)));
      t0 = Date.now();
      await generatePicture({ prompt: 'a calm sea MOCK_DELAY_MS=300', shape: 'square', fetch: f });
      assert.ok(Date.now() - t0 < 300, 'not mock: no wait');
      assert.equal(f.calls[0].body.prompt, 'a calm sea MOCK_DELAY_MS=300', 'not mock: plain words, sent as they are');
    } finally { if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev; }
  });
});
test('MOCK_REFUSE makes only the mock refuse, in the service reason of a 400', async () => {
  await withSandbox(async () => {
    await updateImages({ service: 'openai', apiKey: 'mock-key', price: 0.04 });
    const prev = process.env.WORCA_MOCK;
    try {
      process.env.WORCA_MOCK = '1';
      await assert.rejects(generatePicture({ prompt: 'a calm sea MOCK_REFUSE', shape: 'wide' }), (e) => e instanceof ImagesError && e.message === 'the image service refused this description: mock');
      assert.equal((await testImages({})).ok, true, 'the Test prompt holds no token');
      delete process.env.WORCA_MOCK;
      const f = spy(ok(png(4, 4)));
      assert.equal((await generatePicture({ prompt: 'a calm sea MOCK_REFUSE', shape: 'wide', fetch: f })).w, 4, 'not mock: plain words');
      assert.equal(f.calls[0].body.prompt, 'a calm sea MOCK_REFUSE');
    } finally { if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev; }
  });
});
