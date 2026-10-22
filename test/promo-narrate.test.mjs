// test/promo-narrate.test.mjs
// The `promoNarrate` card (promo video workflow, lane B2): the narration script becomes the
// film's timeline — spoken by ElevenLabs (per-line TTS with timestamps, a music bed per
// section, the kit's SFX) or, for a silent video, timed from the pace. Every failure of the
// narrated path falls back to the silent timeline with the reason in the report; the key never
// reaches a file or a log line. Offline: ElevenLabs, ffmpeg and the kit tools are injected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import promoNarrate, { layoutTimeline, musicSections, LAYOUT } from '../scripts/promo-narrate.mjs';
import { WORDS_PER_SEC } from '../scripts/promo-common.mjs';
import { findFfmpeg } from '../assets/promo-kit/tools/find-tools.mjs';
const FINISH_FF = findFfmpeg();
import { KEY, assertNoKey, stubFetch, apiFor, writeSetup, fakeMp3, fakeMp3Seconds } from './helpers/promo-fixtures.mjs';

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const SCRIPT = {
  version: 1, title: 'Meet Acme', tone: 'Playful', lengthSec: 30,
  lines: [
    { id: 'v01', scene: 'hook', text: 'Here is a task: ship the dark mode toggle.' },
    { id: 'v02', scene: 'hook', text: 'Easy, right? Somebody still has to plan it.' },
    { id: 'v03', scene: 'title', text: 'Meet Acme. It does the boring parts for you.' },
    { id: 'v04', scene: 'demo', text: 'Pick a board, drag a card, and watch it move.' },
  ],
  scenes: [
    { id: 'hook', beats: 'a task card lands' },
    { id: 'title', chapter: { num: '01', title: 'Meet Acme' }, beats: 'logo', minSec: 6 },
    { id: 'demo', chapter: { num: '02', title: 'The board' }, beats: 'drag a card' },
  ],
};
const SFX_SPECS = {
  pop: { prompt: 'Soft round bubble pop', seconds: 0.5, variants: 1, maxTrim: 0.25 },
  whoosh: { prompt: 'Airy whoosh', seconds: 0.8, variants: 2, maxTrim: 0.6 },
};
const NARRATED = { audio: 'Narrated (ElevenLabs)', voiceGender: 'Female', apiKey: '[secret]', music: true, pace: 'Lively', tone: 'Playful' };

/** A pipeline dir with the script written where promoWriter puts it, plus the script port file. */
function fixture({ setup = null, voiceId = 'VoiceFemaleNarr01', script = SCRIPT } = {}) {
  const p = tmp('worca-promo-narrate-');
  mkdirSync(join(p, 'promo'), { recursive: true });
  writeFileSync(join(p, 'promo', 'script.json'), JSON.stringify(script, null, 2));
  const scriptPort = join(p, 'promo-script.json');
  writeFileSync(scriptPort, JSON.stringify(script, null, 2));
  if (setup) writeSetup(p, setup);
  let voicePort = null;
  if (voiceId) {
    voicePort = join(p, 'promo-voice.json');
    writeFileSync(voicePort, JSON.stringify({ form: 'promo-voice', version: 1, values: { voiceId } }));
  }
  const inputs = { script: { type: 'json', path: scriptPort } };
  if (voicePort) inputs.answers = { type: 'json', path: voicePort };
  const outputs = {
    timeline: { type: 'json', path: join(p, 'promo-timeline.json') },
    report: { type: 'md', path: join(p, 'promo-narrate-cycle1.md') },
  };
  return { p, inputs, outputs };
}

/** The kit tools, recorded. */
function stubKit() {
  const calls = { init: [], build: [] };
  return {
    calls,
    kit: {
      initFilm: async ({ filmDir }) => { calls.init.push(filmDir); mkdirSync(filmDir, { recursive: true }); return { copied: ['index.html'] }; },
      buildData: async ({ promoDir }) => { calls.build.push(promoDir); return { scenes: 3, plates: 0, voLines: 4 }; },
    },
  };
}

/** ffmpeg, recorded: a `-f null` probe answers a volumedetect line, anything else writes its last argument. */
function stubFfmpeg() {
  const calls = [];
  return {
    calls,
    ffmpeg: '/fake/bin/ffmpeg',
    runFfmpeg: (args) => {
      calls.push(args);
      if (args.includes('null')) return { status: 0, stderr: '[Parsed_volumedetect_0] max_volume: -6.0 dB\n' };
      const out = args[args.length - 1];
      // '-' is stdout (finishSfx's decode check): hand back 0.5 s of 8 kHz s16 PCM, never a file named '-'
      if (out === '-') return { status: 0, stderr: '', stdout: Buffer.alloc(8000) };
      writeFileSync(out, Buffer.from('ffmpeg-out'));
      return { status: 0, stderr: '' };
    },
  };
}

const CHAR = 0.06;
/** A TTS with-timestamps response for `text`: one char every 60 ms after a 0.1 s lead. */
function ttsResponse(text) {
  const chars = [...text];
  const frames = Math.ceil((0.1 + chars.length * CHAR + 0.25) / fakeMp3Seconds(1));
  return {
    audio_base64: fakeMp3(frames).toString('base64'),
    alignment: {
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => +(0.1 + i * CHAR).toFixed(3)),
      character_end_times_seconds: chars.map((_, i) => +(0.1 + (i + 1) * CHAR).toFixed(3)),
    },
  };
}

function elevenRoute({ ttsStatus = 200, failLine = null } = {}) {
  return (url, init) => {
    if (url.includes('/v1/text-to-speech/')) {
      const body = JSON.parse(init.body);
      if (ttsStatus !== 200) return { status: ttsStatus, json: { detail: { status: 'invalid_api_key', message: `key ${KEY} rejected` } } };
      if (failLine && body.text === failLine) return { status: 500, json: { detail: 'boom' } };
      return { json: ttsResponse(body.text) };
    }
    if (url.includes('/v1/music')) return { body: fakeMp3(400) };
    if (url.includes('/v1/sound-generation')) return { body: fakeMp3(20) };
    return { status: 404, json: { detail: 'not found' } };
  };
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sceneOf = (tl, id) => tl.scenes.find((s) => s.id === id);

/** The layout invariants every timeline keeps, narrated or not. */
function assertLayout(tl, script = SCRIPT) {
  const ids = script.lines.map((l) => l.id);
  assert.deepEqual(Object.keys(tl.vo), ids, 'every line, in script order');
  for (let i = 1; i < ids.length; i += 1) {
    const prev = tl.vo[ids[i - 1]];
    const cur = tl.vo[ids[i]];
    assert.ok(cur.start - (prev.start + prev.dur) >= 0.4 - 1e-9, `gap before ${ids[i]}: ${cur.start - (prev.start + prev.dur)}`);
  }
  for (const id of ids) {
    const v = tl.vo[id];
    const sc = sceneOf(tl, v.scene);
    assert.ok(sc, `${id} names a scene`);
    assert.ok(v.start >= sc.start && v.start + v.dur <= sc.end + 1e-9, `${id} sits inside scene ${sc.id}`);
    for (const w of v.words) assert.ok(w.t0 >= 0 && w.t1 >= w.t0 && w.t1 <= v.dur + 1e-9, `${id} word timing is relative to the line`);
  }
  for (const sc of tl.scenes.filter((s) => s.chapter)) {
    const first = ids.map((id) => tl.vo[id]).find((v) => v.scene === sc.id);
    if (first) assert.ok(first.start - sc.start >= LAYOUT.chapterLead - 1e-9, `chapter ${sc.id} gets its lead`);
  }
  for (let i = 1; i < tl.scenes.length; i += 1) assert.equal(tl.scenes[i].start, tl.scenes[i - 1].end, 'scenes are contiguous');
  assert.equal(tl.scenes[0].start, 0);
  assert.equal(tl.duration, tl.scenes[tl.scenes.length - 1].end);
  const lastLine = tl.vo[ids[ids.length - 1]];
  assert.ok(tl.duration - (lastLine.start + lastLine.dur) >= LAYOUT.finalHold - 1e-9, 'the final hold');
  assert.equal(tl.fps, 60);
  assert.equal(tl.version, 1);
}

// ── silent ─────────────────────────────────────────────────────────────────────

test('silent setup: a timeline from estimated word timing, the film initialised and data.js built, no network', async () => {
  const { p, inputs, outputs } = fixture({ setup: { audio: 'Silent video', pace: 'Lively' } });
  const f = stubFetch(() => { throw new Error('no call expected'); });
  const { kit, calls } = stubKit();
  const r = await promoNarrate(apiFor(p, { inputs, outputs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit, ffmpeg: null });
  assert.equal(f.calls.length, 0);
  const tl = read(outputs.timeline.path);
  assert.deepEqual(read(join(p, 'promo', 'timeline.json')), tl, 'the port file and promo/timeline.json agree');
  assert.equal(tl.narrated, false);
  assert.equal(tl.music, false);
  assert.equal(tl.voiceId, undefined);
  assertLayout(tl);
  for (const l of SCRIPT.lines) {
    const v = tl.vo[l.id];
    const n = l.text.split(/\s+/).length;
    const speech = v.speechEnd - v.speechStart;
    assert.ok(speech >= (n / WORDS_PER_SEC.Lively) * 0.8 && speech <= (n / WORDS_PER_SEC.Lively) * 1.4, `${l.id} speech ${speech} for ${n} words`);
    assert.equal(v.text, l.text);
    assert.equal(v.words.length, n);
  }
  assert.ok(sceneOf(tl, 'title').end - sceneOf(tl, 'title').start >= 6, 'minSec holds');
  assert.deepEqual(sceneOf(tl, 'title').chapter, { num: '01', title: 'Meet Acme' });
  assert.deepEqual(calls.init, [join(p, 'promo', 'film')]);
  assert.deepEqual(calls.build, [join(p, 'promo')]);
  assert.equal(existsSync(join(p, 'promo', 'audio')), false, 'no audio files for a silent video');
  const report = readFileSync(outputs.report.path, 'utf8');
  assert.match(report, /^# Narration/);
  assert.match(report, /Silent/);
  assert.match(r.summary, /silent/);
});

test('the default setup (nothing on disk) is silent too, and a slower pace makes a longer film', async () => {
  const a = fixture({ setup: { audio: 'Silent video', pace: 'Relaxed' } });
  const b = fixture({ setup: { audio: 'Silent video', pace: 'Fast' } });
  const d = fixture({ setup: null });
  const run = async (fx) => { await promoNarrate(apiFor(fx.p, fx), { env: {}, kit: stubKit().kit, ffmpeg: null }); return read(fx.outputs.timeline.path); };
  const [relaxed, fast, dflt] = [await run(a), await run(b), await run(d)];
  assert.equal(dflt.narrated, false);
  assert.ok(relaxed.duration > fast.duration, `${relaxed.duration} > ${fast.duration}`);
});

test('narrated without a key, or without a voice: the silent timeline, and the report says why', async () => {
  const noKey = fixture({ setup: NARRATED });
  await promoNarrate(apiFor(noKey.p, noKey), { env: {}, kit: stubKit().kit, ffmpeg: null });
  assert.equal(read(noKey.outputs.timeline.path).narrated, false);
  assert.match(readFileSync(noKey.outputs.report.path, 'utf8'), /no ElevenLabs API key/);

  const noVoice = fixture({ setup: NARRATED, voiceId: null });
  const f = stubFetch(() => { throw new Error('no call expected'); });
  await promoNarrate(apiFor(noVoice.p, noVoice), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null });
  assert.equal(f.calls.length, 0);
  assert.equal(read(noVoice.outputs.timeline.path).narrated, false);
  assert.match(readFileSync(noVoice.outputs.report.path, 'utf8'), /no voice/);
});

// ── narrated ───────────────────────────────────────────────────────────────────

test('narrated: per-line TTS with timestamps and continuity, words from the alignment, music per section, the kit SFX', async () => {
  const { p, inputs, outputs } = fixture({ setup: NARRATED });
  const f = stubFetch(elevenRoute());
  const ff = stubFfmpeg();
  const logs = [];
  const r = await promoNarrate(apiFor(p, { inputs, outputs, logs }), {
    fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: ff.ffmpeg, runFfmpeg: ff.runFfmpeg,
    sfxNames: ['pop', 'whoosh'], sfxSpecs: SFX_SPECS, sleep: async () => {},
  });
  const tl = read(outputs.timeline.path);
  assert.equal(tl.narrated, true);
  assert.equal(tl.music, true);
  assert.equal(tl.voiceId, 'VoiceFemaleNarr01');
  assertLayout(tl);

  const tts = f.calls.filter((c) => c.url.includes('/v1/text-to-speech/'));
  assert.equal(tts.length, 4);
  for (const c of tts) {
    assert.match(c.url, /\/v1\/text-to-speech\/VoiceFemaleNarr01\/with-timestamps\?output_format=mp3_44100_128$/);
    assert.equal(c.headers['xi-api-key'], KEY);
  }
  const bodies = tts.map((c) => JSON.parse(c.body));
  assert.equal(bodies[0].previous_text, undefined);
  assert.equal(bodies[0].next_text, SCRIPT.lines[1].text);
  assert.equal(bodies[1].previous_text, SCRIPT.lines[0].text);
  assert.equal(bodies[3].next_text, undefined);
  assert.equal(bodies[0].model_id, 'eleven_multilingual_v2');

  // words come from the alignment, relative to the line's start
  const v01 = tl.vo.v01;
  assert.deepEqual(v01.words[0], { w: 'Here', key: 'here', t0: 0.1, t1: 0.34 });
  assert.equal(v01.speechStart, 0.1);
  const frames = Math.ceil((0.1 + [...SCRIPT.lines[0].text].length * CHAR + 0.25) / fakeMp3Seconds(1));
  assert.equal(v01.dur, Math.round(fakeMp3Seconds(frames) * 1000) / 1000, 'dur is the mp3 length, from its frames');
  assert.ok(existsSync(join(p, 'promo', 'audio', 'vo', 'v01.mp3')));
  const voJson = read(join(p, 'promo', 'audio', 'vo', 'v01.json'));
  assert.equal(voJson.text, SCRIPT.lines[0].text);
  assert.equal(voJson.speechStart, 0.1);
  assert.deepEqual(voJson.words, v01.words);

  // music: one segment per section (chapters start sections), stitched by ffmpeg into music.mp3
  const music = f.calls.filter((c) => c.url.includes('/v1/music'));
  assert.deepEqual(musicSections(tl.scenes, tl.duration).map((s) => s.at), [0, sceneOf(tl, 'title').start, sceneOf(tl, 'demo').start]);
  assert.equal(music.length, 3);
  for (const c of music) {
    const b = JSON.parse(c.body);
    assert.ok(b.music_length_ms >= 10000 && b.music_length_ms <= 300000);
    assert.equal(b.force_instrumental, true);
    assert.match(c.url, /output_format=mp3_44100_128/);
  }
  assert.ok(existsSync(join(p, 'promo', 'audio', 'music', 'music.mp3')));
  const stitch = ff.calls.find((a) => a.join(' ').includes('amix'));
  assert.ok(stitch, 'the segments are stitched in one ffmpeg pass');
  assert.match(stitch.join(' '), /afade=t=out/);

  // SFX: every kit name, one file per variant, the kit's prompt
  const sfx = f.calls.filter((c) => c.url.includes('/v1/sound-generation'));
  assert.equal(sfx.length, 3);
  for (const n of ['pop.mp3', 'whoosh.mp3', 'whoosh-2.mp3']) assert.ok(existsSync(join(p, 'promo', 'audio', 'sfx', n)), n);
  assert.equal(existsSync(join(p, 'promo', 'audio', 'sfx', 'pop.mp3.raw.mp3')), false, 'the raw download is cleaned up');
  const sfxBodies = sfx.map((c) => JSON.parse(c.body));
  assert.ok(sfxBodies.some((b) => b.text.startsWith('Soft round bubble pop.')));
  assert.ok(sfxBodies.some((b) => b.text.startsWith('Airy whoosh, variation 2.')));
  assert.ok(sfxBodies.every((b) => b.duration_seconds >= 0.5));
  assert.equal(tl.sfx, true);

  const report = readFileSync(outputs.report.path, 'utf8');
  assert.match(report, /Narrated/);
  assert.match(r.summary, /narrated/);
  assertNoKey(p, r.summary, JSON.stringify(r), ...logs);

  // a second run reuses every clip: no TTS, no music, no SFX call
  const f2 = stubFetch(elevenRoute());
  await promoNarrate(apiFor(p, { inputs, outputs }), {
    fetchImpl: f2.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: ff.ffmpeg, runFfmpeg: ff.runFfmpeg, sfxNames: ['pop', 'whoosh'], sfxSpecs: SFX_SPECS,
  });
  assert.deepEqual(f2.calls.map((c) => c.url), []);
  assert.deepEqual(read(outputs.timeline.path).vo, tl.vo);
});

test('music off: narration only — no /v1/music and no /v1/sound-generation calls', async () => {
  const { p, inputs, outputs } = fixture({ setup: { ...NARRATED, music: false } });
  const f = stubFetch(elevenRoute());
  await promoNarrate(apiFor(p, { inputs, outputs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null, sfxNames: ['pop'] });
  assert.equal(f.calls.filter((c) => c.url.includes('/v1/music') || c.url.includes('/v1/sound-generation')).length, 0);
  const tl = read(outputs.timeline.path);
  assert.equal(tl.narrated, true);
  assert.equal(tl.music, false);
  assert.equal(tl.sfx, false);
});

test('no ffmpeg: one music segment for the whole film, written as is', async () => {
  const { p, inputs, outputs } = fixture({ setup: NARRATED });
  const f = stubFetch(elevenRoute());
  await promoNarrate(apiFor(p, { inputs, outputs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null, sfxNames: [] });
  const music = f.calls.filter((c) => c.url.includes('/v1/music'));
  assert.equal(music.length, 1);
  const tl = read(outputs.timeline.path);
  assert.ok(JSON.parse(music[0].body).music_length_ms >= Math.round(tl.duration * 1000));
  assert.deepEqual(readFileSync(join(p, 'promo', 'audio', 'music', 'music.mp3')), fakeMp3(400));
  assert.equal(tl.music, true);
});

test('TTS 401: the silent timeline, the report names the refusal, no music or SFX spend, the key nowhere', async () => {
  const { p, inputs, outputs } = fixture({ setup: NARRATED });
  const f = stubFetch(elevenRoute({ ttsStatus: 401 }));
  const logs = [];
  const r = await promoNarrate(apiFor(p, { inputs, outputs, logs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null, sfxNames: ['pop'], sleep: async () => {} });
  const tl = read(outputs.timeline.path);
  assert.equal(tl.narrated, false);
  assert.equal(tl.music, false);
  assertLayout(tl);
  assert.equal(f.calls.filter((c) => c.url.includes('/v1/text-to-speech/')).length, 1, 'a refusal is not retried, and the other lines are not tried');
  assert.equal(f.calls.filter((c) => !c.url.includes('/v1/text-to-speech/')).length, 0);
  const report = readFileSync(outputs.report.path, 'utf8');
  assert.match(report, /HTTP 401/);
  assert.match(report, /silent/i);
  assert.equal(r.verdict, undefined);
  assertNoKey(p, r.summary, JSON.stringify(r), report, ...logs);
});

test('a line that keeps failing mid-script: the whole film goes silent (never half narrated)', async () => {
  const { p, inputs, outputs } = fixture({ setup: NARRATED });
  const f = stubFetch(elevenRoute({ failLine: SCRIPT.lines[2].text }));
  await promoNarrate(apiFor(p, { inputs, outputs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null, sfxNames: [], sleep: async () => {} });
  const tl = read(outputs.timeline.path);
  assert.equal(tl.narrated, false);
  assert.match(readFileSync(outputs.report.path, 'utf8'), /v03/);
});

test('a library voice the account does not hold yet is added once, then spoken', async () => {
  const { p, inputs, outputs } = fixture({ setup: { ...NARRATED, music: false }, voiceId: 'LibVoice0xxxxxxxxxx' });
  mkdirSync(join(p, 'promo'), { recursive: true });
  writeFileSync(join(p, 'promo', 'voices.json'), JSON.stringify({ version: 1, voices: [
    { id: 'LibVoice0xxxxxxxxxx', name: 'Lib 0', gender: 'female', accent: '', description: '', preview: 'promo/voices/x.mp3', source: 'library', publicOwnerId: 'owner0' },
  ] }));
  const f = stubFetch((url, init) => {
    if (url.includes('/v1/voices/add/owner0/LibVoice0xxxxxxxxxx')) return { json: { voice_id: 'AddedVoice000000001' } };
    if (url.includes('/v1/text-to-speech/LibVoice0xxxxxxxxxx/')) return { status: 400, json: { detail: { status: 'voice_not_found', message: 'A voice with this id was not found' } } };
    if (url.includes('/v1/text-to-speech/AddedVoice000000001/')) return { json: ttsResponse(JSON.parse(init.body).text) };
    return { status: 404, json: {} };
  });
  await promoNarrate(apiFor(p, { inputs, outputs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null, sfxNames: [] });
  const tl = read(outputs.timeline.path);
  assert.equal(tl.narrated, true);
  assert.equal(tl.voiceId, 'AddedVoice000000001');
  assert.equal(f.calls.filter((c) => c.url.includes('/v1/voices/add/')).length, 1);
  assert.match(readFileSync(outputs.report.path, 'utf8'), /added/i);
  // a second attempt reuses the added voice and its clips: no second add, no TTS
  const again = f.calls.length;
  await promoNarrate(apiFor(p, { inputs, outputs }), { fetchImpl: f.impl, env: { ELEVENLABS_API_KEY: KEY }, kit: stubKit().kit, ffmpeg: null, sfxNames: [] });
  assert.equal(f.calls.length, again);
  assert.equal(read(outputs.timeline.path).voiceId, 'AddedVoice000000001');
});

test('a kit tool that cannot run is a warning in the report, not a crashed run', async () => {
  const { p, inputs, outputs } = fixture({ setup: { audio: 'Silent video' } });
  const kit = { initFilm: async () => { throw new Error('gsap is not installed'); }, buildData: async () => ({}) };
  await promoNarrate(apiFor(p, { inputs, outputs }), { env: {}, kit, ffmpeg: null });
  assert.equal(read(outputs.timeline.path).narrated, false);
  assert.match(readFileSync(outputs.report.path, 'utf8'), /gsap is not installed/);
});

// ── the layout (pure) ──────────────────────────────────────────────────────────

test('layoutTimeline: scenes in order, minSec and the final hold, a line naming no scene joins the scene before it', () => {
  const lines = { a: { dur: 2, speechStart: 0.1, speechEnd: 1.9, words: [] }, b: { dur: 1, speechStart: 0, speechEnd: 1, words: [] }, c: { dur: 1.5, speechStart: 0, speechEnd: 1.5, words: [] } };
  const script = {
    lines: [{ id: 'a', scene: 's1', text: 'A' }, { id: 'b', scene: 'nope', text: 'B' }, { id: 'c', scene: 's2', text: 'C' }],
    scenes: [{ id: 's1', minSec: 10 }, { id: 's2', chapter: { num: '01', title: 'Two' } }, { id: 's3' }],
  };
  const tl = layoutTimeline({ script, lines });
  assert.deepEqual(tl.scenes.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(tl.vo.b.scene, 's1');
  assert.ok(tl.warnings.some((w) => /nope/.test(w)));
  assert.equal(tl.scenes[0].end, 10, 'minSec wins over the lines');
  assert.equal(tl.vo.c.start, 10 + LAYOUT.chapterLead);
  assert.equal(tl.vo.b.start, tl.vo.a.start + 2 + LAYOUT.lineGap);
  const s3 = tl.scenes[2];
  assert.ok(s3.end - s3.start >= LAYOUT.emptySceneSec - 1e-9, 'a scene with no line still gets screen time');
  assert.ok(tl.duration - (tl.vo.c.start + 1.5) >= LAYOUT.finalHold);
  // no scenes at all: one scene holds every line
  const one = layoutTimeline({ script: { lines: [{ id: 'a', scene: 'x', text: 'A' }] }, lines: { a: lines.a } });
  assert.deepEqual(one.scenes.map((s) => s.id), ['x']);
});

test('finishSfx keeps a quiet, very short clip audible: never trims it to nothing (the pop-high bug)', { skip: !FINISH_FF }, async () => {
  const { finishSfx } = await import('../scripts/promo-narrate.mjs');
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'promo-sfx-'));
  try {
    const raw = join(dir, 'raw.mp3'), out = join(dir, 'pop-high.mp3');
    // a 0.12 s blip at -52 dBFS inside 0.4 s of near-silence: the old trim (-45 dB start, -55 dB end) removed all of it
    spawnSync(FINISH_FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1200:duration=0.12:sample_rate=44100', '-af', 'volume=-52dB,apad=pad_dur=0.28', '-c:a', 'libmp3lame', '-b:a', '128k', raw]);
    const run = (args, o = {}) => spawnSync(FINISH_FF, args, o.binary ? { maxBuffer: 1 << 26 } : { encoding: 'utf8' });
    finishSfx({ raw, file: out, keep: 0.16, ffmpeg: FINISH_FF, runFfmpeg: run });
    assert.ok(existsSync(out));
    const pcm = spawnSync(FINISH_FF, ['-v', 'error', '-i', out, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 1 << 24 });
    assert.equal(pcm.status, 0, String(pcm.stderr));
    assert.ok(pcm.stdout.length / 2 / 8000 >= 0.03, `decoded ${pcm.stdout.length / 2 / 8000} s`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
