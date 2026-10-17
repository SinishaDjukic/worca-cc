// test/helpers/promo-fixtures.mjs
// Shared fixtures for the promo video script cards (promoVoices, promoNarrate, promoRender):
// a fake ElevenLabs key that must never leak, a recording fetch stub, the api object the
// node harness builds, the setup answers file, and a synthetic MP3.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KEY = 'sk_test_0123456789abcdef0123456789abcdef01234567';

/** Every file under `dir`, recursively. */
export function allFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allFiles(p)); else out.push(p);
  }
  return out;
}

/** Assert the key appears in no file under `dir` and in none of the extra strings. */
export function assertNoKey(dir, ...texts) {
  for (const f of allFiles(dir)) assert.ok(!readFileSync(f, 'latin1').includes(KEY), `the key leaked into ${f}`);
  for (const t of texts) assert.ok(!String(t).includes(KEY), `the key leaked into ${String(t).slice(0, 120)}`);
}

/** A fetch stub: `route(url, init)` returns {status, json} | {status, body} | an Error to throw. Records every call. */
export function stubFetch(route) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', headers: { ...(init.headers || {}) }, body: init.body ?? null });
    const r = await route(u, init);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status, headers: { 'content-type': 'application/json' } });
    return new Response(r.body ?? '', { status });
  };
  return { impl, calls };
}

/** The api object the node harness (script-child.mjs) hands a program. */
export function apiFor(pipelineDir, { inputs = {}, outputs = {}, logs = [], platform = process.platform } = {}) {
  return {
    inputs, outputs, params: {}, verdictPath: null, node: {}, execution: { ordinal: 1 },
    ctx: { pipelineDir, cwd: pipelineDir, platform, mock: false },
    log: (level, msg) => logs.push(`[${level}] ${msg}`),
  };
}

/** `P/promo-setup.json` exactly as the clarifier writes it (the setup answers port file). */
export function writeSetup(pipelineDir, values) {
  const p = join(pipelineDir, 'promo-setup.json');
  writeFileSync(p, JSON.stringify({ form: 'promo-setup', version: 1, values }, null, 2));
  return p;
}

/** N MPEG-1 Layer III frames at 128 kbps / 44.1 kHz (418 bytes each, no padding) behind an ID3v2 tag. */
export function fakeMp3(frames, { xing = false } = {}) {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]);
  const frame = (tag) => {
    const f = Buffer.alloc(418);
    f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64;
    if (tag) f.write(tag, 36, 'latin1');
    return f;
  };
  const list = [];
  if (xing) list.push(frame('Info'));
  for (let i = 0; i < frames; i += 1) list.push(frame(null));
  return Buffer.concat([id3, ...list]);
}

/** Seconds of `fakeMp3(frames)`. */
export const fakeMp3Seconds = (frames) => (frames * 1152) / 44100;
