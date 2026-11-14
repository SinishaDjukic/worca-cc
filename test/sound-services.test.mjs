// test/sound-services.test.mjs — Design sound (P1 Task A2): the shared constants and helpers of
// src/shared/sound-services.mjs (SPEC §5, §7). SPEC's literals and words are written out here, never read from the
// module under test. The film fixture is shared with the browser's sound player test (P3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MUSIC_FADE_IN, MUSIC_FADE_OUT, MUSIC_GAIN, MUSIC_KEEP_SLACK, MUSIC_KINDS, MUSIC_STYLES, MUSIC_TAIL, SOUND_DRIFT,
  SOUND_LIMITS, SOUND_SERVICE, VOICE_LEAD, VOICE_TAIL,
  musicLabel, musicPrompt, musicUsd, soundAt, soundSummary, voiceUsd,
} from '../src/shared/sound-services.mjs';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const FILM = JSON.parse(readFileSync(new URL('./fixtures/film-sound-cases.json', import.meta.url), 'utf8'));

// SPEC §5 "Shared constants".
const SPEC_SERVICE = { id: 'elevenlabs', label: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io', voiceModel: 'eleven_multilingual_v2', voiceFormat: 'mp3_44100_128', musicModel: 'music_v2_5', voiceUsdPer1kChars: 0.08, musicUsdPerMinute: 0.15 };
const SPEC_LIMITS = { say: 1500, musicText: 300, voices: 6, atOnce: 2, musicMinSec: 3, musicMaxSec: 300, voiceCallMs: 120000, musicCallMs: 300000, audioBytes: 41943040, sampleBytes: 8388608, manifestBytes: 262144 };
const SPEC_KINDS = ['none', 'calm', 'upbeat', 'cinematic', 'playful', 'custom'];

// SPEC §7 "Music labels" and "Music prompts".
const SPEC_STYLES = {
  calm: { label: 'Calm', prompt: 'Instrumental calm warm ambient underscore, 90 bpm, 4/4, key of F major. Soft felt piano, warm pads, gentle mallets, light brushed percussion. Relaxed and clear.' },
  upbeat: { label: 'Upbeat', prompt: 'Instrumental energetic modern product-launch underscore, 124 bpm, 4/4, key of A minor. Punchy drums, driving synth bass, bright synth stabs, claps. Exciting and confident.' },
  cinematic: { label: 'Cinematic', prompt: 'Instrumental cinematic underscore, 90 bpm, key of D minor. Warm strings, soft piano, deep slow pulses, a slow build with a gentle lift at the end. Wide and confident, never bombastic.' },
  playful: { label: 'Playful', prompt: 'Instrumental playful bouncy modern explainer underscore, 120 bpm, 4/4, key of C major. Pizzicato strings, marimba, plucky synth, warm round bass, soft finger snaps. Quirky but polished, never cheesy.' },
};
const SPEC_TAIL = ' No vocals, no choir, no distortion. Light, spacious mix that leaves room for a narrator.';

test('soundAt: every case of the shared film fixture, and no music when the tracks have none', () => {
  assert.ok(FILM.cases.length > 0);
  for (const c of FILM.cases) {
    const at = soundAt(FILM.tracks, c.t, FILM.dur);
    assert.deepEqual(at.clips.map((x) => [x.on, r6(x.on ? x.local : 0)]), c.clips, `clips at t=${c.t}`);
    if (c.music === null) { assert.equal(at.music, null, `music at t=${c.t}`); continue; }
    const { on, local, volume } = at.music;
    assert.deepEqual([on, r6(on ? local : 0), r6(on ? volume : 0)], c.music, `music at t=${c.t}`);
  }
  assert.equal(soundAt({ clips: [], music: null }, 1, 10).music, null);
});

test('the constants are SPEC §5 literals, and the styles and the tail are SPEC §7 words', () => {
  assert.deepEqual(SOUND_SERVICE, SPEC_SERVICE);
  assert.deepEqual(SOUND_LIMITS, SPEC_LIMITS);
  assert.deepEqual(
    [VOICE_LEAD, VOICE_TAIL, MUSIC_GAIN, MUSIC_FADE_IN, MUSIC_FADE_OUT, SOUND_DRIFT, MUSIC_KEEP_SLACK],
    [0.35, 0.45, 0.16, 0.5, 1.5, 0.25, 0.5],
  );
  assert.deepEqual(MUSIC_KINDS, SPEC_KINDS);
  assert.deepEqual(Object.keys(MUSIC_STYLES), ['calm', 'upbeat', 'cinematic', 'playful']);
  assert.deepEqual(MUSIC_STYLES, SPEC_STYLES);
  assert.equal(MUSIC_TAIL, SPEC_TAIL);
});

test('music words: musicPrompt and musicLabel', () => {
  assert.equal(musicPrompt({ kind: 'none' }), null);
  assert.equal(musicPrompt({ kind: 'custom', text: '  ' }), null);
  assert.equal(musicPrompt({ kind: 'jazz' }), null);
  assert.equal(musicPrompt({ kind: 'calm' }), SPEC_STYLES.calm.prompt + SPEC_TAIL);
  assert.equal(musicPrompt({ kind: 'custom', text: ' Soft piano ' }), `Soft piano.${SPEC_TAIL}`);
  assert.equal(musicPrompt({ kind: 'custom', text: 'Soft piano!' }), `Soft piano!${SPEC_TAIL}`);
  assert.deepEqual(
    [musicLabel({ kind: 'none' }), musicLabel({ kind: 'upbeat' }), musicLabel({ kind: 'custom' }), musicLabel(null)],
    ['No music', 'Upbeat', 'Own music', 'No music'],
  );
});

test('soundSummary: Off unless sound is on with a voice name', () => {
  assert.equal(soundSummary(null), 'Off');
  assert.equal(soundSummary({ on: false }), 'Off');
  assert.equal(soundSummary({ on: true, voice: { id: 'v', name: 'Rachel' }, music: { kind: 'calm' } }), 'Rachel · Calm');
  assert.equal(soundSummary({ on: true }), 'Off');
});

test('prices: voiceUsd per 1000 characters and musicUsd per minute, rounded to 6 decimals', () => {
  assert.deepEqual([voiceUsd(1000), voiceUsd(125), musicUsd(60), musicUsd(42)], [0.08, 0.01, 0.15, 0.105]);
});
