// test/promo-voices.test.mjs
// The `promoVoices` card (promo video workflow, lane B1) and the helpers every promo
// script shares (scripts/promo-common.mjs). Offline by construction: ElevenLabs is a
// stubbed fetch (unit) or a local node:http server (the one end-to-end case through the
// real node harness). The API key must never reach a file, a log line or the frame.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import promoVoices, { rankVoices } from '../scripts/promo-voices.mjs';
import {
  readSetup, redactKey, elevenFetch, mp3Duration, wordsFromAlignment, estimateWords, kitSfxNames, FALLBACK_SFX, WORDS_PER_SEC,
} from '../scripts/promo-common.mjs';
import { loadScriptRegistry, DEFAULT_SCRIPTS_DIR } from '../src/core/script-registry.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { effectiveScriptParams } from '../src/shared/graph/script-meta.mjs';
import { KEY, assertNoKey, stubFetch, apiFor, writeSetup, fakeMp3 } from './helpers/promo-fixtures.mjs';

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const NARRATED = { audio: 'Narrated (ElevenLabs)', voiceGender: 'Female', apiKey: '[secret]', music: true };
const ACCOUNT = {
  voices: [
    { voice_id: 'VoiceFemaleNarr01', name: 'Ada', category: 'premade', labels: { gender: 'female', accent: 'british', use_case: 'narration', description: 'warm' }, preview_url: 'https://cdn.example/ada.mp3' },
    { voice_id: 'VoiceMaleNarr0002', name: 'Bob', category: 'premade', labels: { gender: 'male', accent: 'american', use_case: 'narration' }, preview_url: 'https://cdn.example/bob.mp3' },
    { voice_id: 'VoiceFemaleChat03', name: 'Cleo', category: 'premade', labels: { gender: 'female', accent: 'american', use_case: 'conversational' }, preview_url: 'https://cdn.example/cleo.mp3' },
  ],
  has_more: false,
};
const PREVIEW = Buffer.from('ID3-fake-mp3-bytes');

function elevenRoute({ account = ACCOUNT, shared = { voices: [] }, status = 200 } = {}) {
  return (url) => {
    if (url.startsWith('https://cdn.example/')) return { body: PREVIEW };
    if (status !== 200) return { status, json: { detail: { status: 'invalid_api_key', message: `Invalid API key: ${KEY}` } } };
    if (url.includes('/v2/voices')) return { json: account };
    if (url.includes('/v1/shared-voices')) return { json: shared };
    return { status: 404, json: { detail: 'not found' } };
  };
}

function outPaths(pipelineDir) {
  return { voices: { type: 'json', path: join(pipelineDir, 'promo-voice-list.json') } };
}

// ── shared helpers ─────────────────────────────────────────────────────────────

test('readSetup: defaults when nothing is on disk; the setup form wrapper and a flat object both normalize', () => {
  const p = tmp('worca-promo-setup-');
  assert.deepEqual(readSetup(p), {
    tone: 'Playful', lengthSec: 60, pace: 'Lively', mascots: true, mascotSource: 'design', mascotImage: null,
    mascotAmount: 40, narrated: false, voiceGender: 'either', music: true,
  });
  writeSetup(p, { tone: 'Calm', length: '2.5 min', pace: 'Fast', mascots: false, mascotSource: 'Use my attached image',
    mascotImage: 'img-2', mascotAmount: 140, audio: 'Narrated (ElevenLabs)', voiceGender: 'Male', music: false });
  assert.deepEqual(readSetup(p), {
    tone: 'Calm', lengthSec: 150, pace: 'Fast', mascots: false, mascotSource: 'attached', mascotImage: 'img-2',
    mascotAmount: 100, narrated: true, voiceGender: 'male', music: false,
  });
  // the spec's promo/setup.json (flat values) is the fallback when the port file is absent
  const q = tmp('worca-promo-setup-');
  mkdirSync(join(q, 'promo'));
  writeFileSync(join(q, 'promo', 'setup.json'), JSON.stringify({ length: '30 s', audio: 'Silent video', pace: 'relaxed' }));
  const s = readSetup(q);
  assert.equal(s.lengthSec, 30);
  assert.equal(s.pace, 'Relaxed');
  assert.equal(s.narrated, false);
  // an explicit answers file (a bound input) wins over the pipeline-dir files
  const a = join(q, 'answers.json');
  writeFileSync(a, JSON.stringify({ values: { audio: 'Narrated (ElevenLabs)', tone: 'bold' } }));
  assert.equal(readSetup(q, { answersPath: a }).narrated, true);
  assert.equal(readSetup(q, { answersPath: a }).tone, 'Bold');
  // garbage is the defaults, never a throw
  writeFileSync(a, 'not json');
  assert.equal(readSetup(tmp('worca-promo-setup-'), { answersPath: a }).lengthSec, 60);
  assert.deepEqual(WORDS_PER_SEC, { Relaxed: 2.2, Lively: 2.5, Fast: 2.8 });
});

test('redactKey: every occurrence of the key and anything key-shaped is masked', () => {
  assert.equal(redactKey(`a ${KEY} b ${KEY}`, KEY), 'a [redacted] b [redacted]');
  assert.equal(redactKey('xi sk_ffffffffffffffffffffffffffffffffffffffffffff here', ''), 'xi [redacted] here');
  assert.equal(redactKey('nothing', KEY), 'nothing');
  assert.equal(redactKey(undefined, KEY), '');
});

test('elevenFetch: the key rides the xi-api-key header only; HTTP and network failures are redacted errors with a status', async () => {
  const ok = stubFetch(() => ({ json: { voices: [] } }));
  const res = await elevenFetch('/v2/voices', { key: KEY, query: { page_size: 100 }, fetchImpl: ok.impl, base: 'https://el.test' });
  assert.equal(res.status, 200);
  assert.equal(ok.calls[0].url, 'https://el.test/v2/voices?page_size=100');
  assert.equal(ok.calls[0].headers['xi-api-key'], KEY);
  assert.ok(!ok.calls[0].url.includes(KEY));
  const post = stubFetch(() => ({ json: {} }));
  await elevenFetch('/v1/music', { key: KEY, method: 'POST', body: { prompt: 'x' }, fetchImpl: post.impl, base: 'https://el.test' });
  assert.equal(post.calls[0].method, 'POST');
  assert.equal(post.calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(post.calls[0].body), { prompt: 'x' });

  const bad = stubFetch(() => ({ status: 401, json: { detail: { status: 'invalid_api_key', message: `bad key ${KEY}` } } }));
  await assert.rejects(elevenFetch('/v2/voices', { key: KEY, fetchImpl: bad.impl }), (e) => {
    assert.equal(e.status, 401);
    assert.equal(e.code, 'invalid_api_key');
    assert.match(e.message, /HTTP 401/);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
  const down = stubFetch(() => Object.assign(new Error(`connect ECONNREFUSED ${KEY}`), { code: 'ECONNREFUSED' }));
  await assert.rejects(elevenFetch('/v2/voices', { key: KEY, fetchImpl: down.impl }), (e) => {
    assert.equal(e.status, 0);
    assert.match(e.message, /network error \(ECONNREFUSED\)/);
    assert.ok(!e.message.includes(KEY));
    return true;
  });
});

test('mp3Duration: counts MPEG frames (skipping ID3 and a Xing/Info header) — no afinfo, no ffprobe', () => {
  assert.equal(mp3Duration(fakeMp3(100)).toFixed(4), (100 * 1152 / 44100).toFixed(4));
  assert.equal(mp3Duration(fakeMp3(38, { xing: true })).toFixed(4), (38 * 1152 / 44100).toFixed(4));
  assert.equal(mp3Duration(Buffer.from('not audio at all')), null);
  assert.equal(mp3Duration(Buffer.alloc(0)), null);
});

test('wordsFromAlignment groups characters into words with a lowercase [a-z0-9-] key; estimateWords paces a line', () => {
  const text = 'Hi, worca-cc!';
  const chars = [...text];
  const al = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1) };
  assert.deepEqual(wordsFromAlignment(al), [
    { w: 'Hi,', key: 'hi', t0: 0, t1: 0.3 },
    { w: 'worca-cc!', key: 'worca-cc', t0: 0.4, t1: 1.3 },
  ]);
  assert.deepEqual(wordsFromAlignment(null), []);
  const est = estimateWords('One two three four five six seven eight nine ten.', 2.5);
  assert.equal(est.words.length, 10);
  const speech = est.speechEnd - est.speechStart;
  assert.ok(speech >= 10 / 2.5 * 0.8 && speech <= 10 / 2.5 * 1.3, `speech ${speech}`);
  assert.ok(est.dur > est.speechEnd);
  for (let i = 1; i < est.words.length; i += 1) assert.ok(est.words[i].t0 >= est.words[i - 1].t1);
});

test('kitSfxNames reads F.SFX from the kit, and falls back to the built-in list when the kit is absent', () => {
  const d = tmp('worca-promo-kit-');
  const kit = join(d, 'kit.js');
  writeFileSync(kit, "  F.SFX = ['pop', 'whoosh',\n 'ding'];\n");
  assert.deepEqual(kitSfxNames(kit), ['pop', 'whoosh', 'ding']);
  assert.deepEqual(kitSfxNames(join(d, 'missing.js')), FALLBACK_SFX);
  assert.ok(FALLBACK_SFX.includes('whoosh') && FALLBACK_SFX.length >= 30);
});

// ── the card ──────────────────────────────────────────────────────────────────

test('silent setup: voices [] with skipped "silent" — no network call at all', async () => {
  const p = tmp('worca-promo-voices-');
  const answers = writeSetup(p, { audio: 'Silent video' });
  const f = stubFetch(() => { throw new Error('no call expected'); });
  const r = await promoVoices(apiFor(p, { inputs: { answers: { type: 'json', path: answers } }, outputs: outPaths(p) }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY } });
  assert.equal(f.calls.length, 0);
  const doc = JSON.parse(readFileSync(join(p, 'promo-voice-list.json'), 'utf8'));
  assert.deepEqual(doc, { version: 1, voices: [], skipped: 'silent' });
  assert.deepEqual(JSON.parse(readFileSync(join(p, 'promo', 'voices.json'), 'utf8')), doc);
  assert.match(r.summary, /skipped \(silent video\)/);
  assert.equal(r.verdict, undefined);
});

test('narrated without a key: skipped "no-key", the run goes on silent', async () => {
  const p = tmp('worca-promo-voices-');
  const answers = writeSetup(p, NARRATED);
  const f = stubFetch(() => { throw new Error('no call expected'); });
  const r = await promoVoices(apiFor(p, { inputs: { answers: { type: 'json', path: answers } }, outputs: outPaths(p) }), { fetchImpl: f.impl, env: {} });
  assert.equal(f.calls.length, 0);
  assert.equal(JSON.parse(readFileSync(join(p, 'promo-voice-list.json'), 'utf8')).skipped, 'no-key');
  assert.match(r.summary, /no ElevenLabs API key/);
});

test('narrated + key + Female: the female voices only, narration first, previews downloaded WITHOUT the key header', async () => {
  const p = tmp('worca-promo-voices-');
  const answers = writeSetup(p, NARRATED);
  const f = stubFetch(elevenRoute());
  const logs = [];
  const r = await promoVoices(apiFor(p, { inputs: { answers: { type: 'json', path: answers } }, outputs: outPaths(p), logs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY } });
  const doc = JSON.parse(readFileSync(join(p, 'promo', 'voices.json'), 'utf8'));
  assert.deepEqual(doc.voices.map((v) => [v.id, v.name, v.gender]), [['VoiceFemaleNarr01', 'Ada', 'female'], ['VoiceFemaleChat03', 'Cleo', 'female']]);
  assert.deepEqual(doc.voices[0], { id: 'VoiceFemaleNarr01', name: 'Ada', gender: 'female', accent: 'british', description: 'warm',
    preview: 'promo/voices/VoiceFemaleNarr01.mp3', source: 'account' });
  for (const v of doc.voices) assert.deepEqual(readFileSync(join(p, v.preview)), PREVIEW);
  assert.equal(doc.error, undefined);
  assert.equal(doc.skipped, undefined);
  const previewCalls = f.calls.filter((c) => c.url.startsWith('https://cdn.example/'));
  assert.equal(previewCalls.length, 2);
  for (const c of previewCalls) assert.equal(c.headers['xi-api-key'], undefined, 'the key never goes to the preview host');
  for (const c of f.calls.filter((c) => c.url.startsWith('https://api.elevenlabs.io/'))) assert.equal(c.headers['xi-api-key'], KEY);
  // two account voices < 6: the shared library is asked to fill up, filtered by gender
  const lib = f.calls.find((c) => c.url.includes('/v1/shared-voices'));
  assert.ok(lib, 'the shared library was searched');
  assert.match(lib.url, /gender=female/);
  assert.match(r.summary, /2 voice/);
  assertNoKey(p, r.summary, ...logs);
});

test('the shared library fills the list up to six; a library voice carries its owner id', async () => {
  const p = tmp('worca-promo-voices-');
  const answers = writeSetup(p, { ...NARRATED, voiceGender: 'Either' });
  const shared = { voices: Array.from({ length: 8 }, (_, i) => ({
    voice_id: `LibVoice${i}xxxxxxxxxx`, public_owner_id: `owner${i}`, name: `Lib ${i}`, gender: i % 2 ? 'male' : 'female',
    accent: 'american', use_case: 'narrative_story', description: 'library', preview_url: `https://cdn.example/lib${i}.mp3`,
  })) };
  const f = stubFetch(elevenRoute({ shared }));
  await promoVoices(apiFor(p, { inputs: { answers: { type: 'json', path: answers } }, outputs: outPaths(p) }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY } });
  const doc = JSON.parse(readFileSync(join(p, 'promo-voice-list.json'), 'utf8'));
  assert.equal(doc.voices.length, 6);
  assert.deepEqual(doc.voices.slice(0, 3).map((v) => v.source), ['account', 'account', 'account']);
  const lib = doc.voices.find((v) => v.source === 'library');
  assert.equal(lib.publicOwnerId, 'owner0');
  assert.ok(!f.calls.find((c) => c.url.includes('/v1/shared-voices')).url.includes('gender='), '"Either" asks the library for every gender');
});

test('rankVoices: "either" interleaves genders; narration-like use cases rank first', () => {
  const vs = [
    { id: 'a', gender: 'female', useCase: 'conversational' }, { id: 'b', gender: 'female', useCase: 'narration' },
    { id: 'c', gender: 'male', useCase: 'advertisement' }, { id: 'd', gender: 'male', useCase: '' },
  ];
  assert.deepEqual(rankVoices(vs, 'either').map((v) => v.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(rankVoices(vs, 'male').map((v) => v.id), ['c', 'd']);
});

test('401 from ElevenLabs: voices [] with an error naming 401, a clean finish, and the key nowhere', async () => {
  const p = tmp('worca-promo-voices-');
  const answers = writeSetup(p, NARRATED);
  const f = stubFetch(elevenRoute({ status: 401 }));
  const logs = [];
  const r = await promoVoices(apiFor(p, { inputs: { answers: { type: 'json', path: answers } }, outputs: outPaths(p), logs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, sleep: async () => {} });
  const doc = JSON.parse(readFileSync(join(p, 'promo-voice-list.json'), 'utf8'));
  assert.deepEqual(doc.voices, []);
  assert.match(doc.error, /401/);
  assert.equal(f.calls.filter((c) => c.url.includes('/v2/voices')).length, 1, 'an auth failure is never retried');
  assert.equal(r.verdict, undefined, 'no blocking verdict: the run falls back to silent');
  assert.match(r.summary, /silent/);
  assertNoKey(p, r.summary, JSON.stringify(r), ...logs);
});

test('network down: voices [] with an error after the retries, never a throw', async () => {
  const p = tmp('worca-promo-voices-');
  const answers = writeSetup(p, NARRATED);
  const f = stubFetch(() => Object.assign(new Error('getaddrinfo ENOTFOUND api.elevenlabs.io'), { code: 'ENOTFOUND' }));
  const sleeps = [];
  const r = await promoVoices(apiFor(p, { inputs: { answers: { type: 'json', path: answers } }, outputs: outPaths(p) }),
    { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, sleep: async (ms) => { sleeps.push(ms); } });
  const doc = JSON.parse(readFileSync(join(p, 'promo-voice-list.json'), 'utf8'));
  assert.deepEqual(doc.voices, []);
  assert.match(doc.error, /network error \(ENOTFOUND\)/);
  assert.equal(f.calls.length, 3, 'one call + two retries');
  assert.equal(sleeps.length, 2);
  assert.match(r.summary, /silent/);
});

// ── through the real node harness (the engine path): key from the held secret env ─

test('end to end through runScriptExecution: the typed key reaches the child via secretEnv and nothing on disk or in the log', async (t) => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers['xi-api-key'] || null });
    if (req.url.startsWith('/preview/')) { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(PREVIEW); return; }
    if (req.headers['xi-api-key'] !== KEY) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"detail":{"status":"invalid_api_key"}}'); return; }
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url.startsWith('/v2/voices')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ voices: ACCOUNT.voices.map((v) => ({ ...v, preview_url: `${base}/preview/${v.voice_id}.mp3` })) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"voices":[]}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const REG = loadScriptRegistry({ scriptsDir: DEFAULT_SCRIPTS_DIR, userScriptsDir: null, includePlugins: false, agentKeys: [] });
  const meta = REG.promoVoices;
  assert.ok(meta, 'promoVoices is a built-in card');
  const pipelineDir = tmp('worca-promo-voices-e2e-');
  const answers = writeSetup(pipelineDir, { ...NARRATED, voiceGender: 'Male' });
  const ports = { inputs: meta.inputs, outputs: meta.outputs, verdict: meta.verdict };
  const outputs = {};
  for (const p of ports.outputs) if (p.filename) outputs[p.id] = { path: join(pipelineDir, p.filename.replace('{cycle}', '1')), store: 'run' };
  const events = [];
  const r = await runScriptExecution({
    node: { id: 'n_voices', kind: 'script', key: 'promoVoices' }, executionId: 'x:n_voices:1', ordinal: 1, pipelineDir, pipelineId: 'p1',
    projectDir: pipelineDir, ports, outputs, verdict: null,
    runCtx: { pipelineDir, projectDir: pipelineDir, secretEnv: { ELEVENLABS_API_KEY: KEY, WORCA_PROMO_ELEVENLABS_BASE: `http://127.0.0.1:${server.address().port}` } },
    bindings: { answers: { seq: 1, type: 'json', path: answers } }, trigger: { wireIds: [], freshPorts: ['answers'] },
    script: { meta, runtime: meta.runtime, file: meta.scriptPath, params: effectiveScriptParams(meta, {}), timeoutMs: meta.timeoutMs, mock: null },
    claudeOpts: {}, onEvent: (e) => events.push(e),
  });
  const doc = JSON.parse(readFileSync(outputs.voices.path, 'utf8'));
  assert.deepEqual(doc.voices.map((v) => v.id), ['VoiceMaleNarr0002']);
  assert.ok(existsSync(join(pipelineDir, 'promo', 'voices', 'VoiceMaleNarr0002.mp3')));
  for (const s of seen.filter((x) => x.url.startsWith('/preview/'))) assert.equal(s.key, null);
  assert.ok(seen.some((s) => s.url.startsWith('/v2/voices') && s.key === KEY), 'the child got the key from the held secret env');
  assertNoKey(pipelineDir, JSON.stringify(r), JSON.stringify(events));
});
