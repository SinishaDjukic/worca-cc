// src/shared/sound-services.mjs
// Design sound: the one sound service (ElevenLabs), its bounds, the music
// words and the timing a film's voice and music follow (SPEC §5, §7). The
// server, the build side and the browser share it. Pure data and small
// helpers: no imports, no module state.

/** The sound service: the only origin the key goes to, the models and the list prices. */
export const SOUND_SERVICE = Object.freeze({ id: 'elevenlabs', label: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io', voiceModel: 'eleven_multilingual_v2', voiceFormat: 'mp3_44100_128', musicModel: 'music_v2_5', voiceUsdPer1kChars: 0.08, musicUsdPerMinute: 0.15 });

/** The bounds: characters, counts, seconds, call timeouts in ms and sizes in bytes. */
export const SOUND_LIMITS = Object.freeze({ say: 1500, musicText: 300, voices: 6, atOnce: 2, musicMinSec: 3, musicMaxSec: 300, voiceCallMs: 120000, musicCallMs: 300000, audioBytes: 41943040, sampleBytes: 8388608, manifestBytes: 262144 });

/** Seconds into its scene a voice starts (D9). */
export const VOICE_LEAD = 0.35;
/** Seconds at least between a voice's end and its scene's end (D9). */
export const VOICE_TAIL = 0.45;
/** The music's volume under the voice (0 to 1). */
export const MUSIC_GAIN = 0.16;
/** Seconds the music takes to fade in at the film's start. */
export const MUSIC_FADE_IN = 0.5;
/** Seconds the music takes to fade out before the film's end. */
export const MUSIC_FADE_OUT = 1.5;
/** Seconds a playing clip or music track may be off its film time before it is set right (D13). */
export const SOUND_DRIFT = 0.25;
/** Seconds a kept music track may fall short of the film (D10). */
export const MUSIC_KEEP_SLACK = 0.5;

/** What a person can pick for the music, in the order the card shows them. */
export const MUSIC_KINDS = Object.freeze(['none', 'calm', 'upbeat', 'cinematic', 'playful', 'custom']);

const style = (label, prompt) => Object.freeze({ label, prompt });

/** The music styles: the label people read and the description ElevenLabs gets. */
export const MUSIC_STYLES = Object.freeze({
  calm: style('Calm', 'Instrumental calm warm ambient underscore, 90 bpm, 4/4, key of F major. Soft felt piano, warm pads, gentle mallets, light brushed percussion. Relaxed and clear.'),
  upbeat: style('Upbeat', 'Instrumental energetic modern product-launch underscore, 124 bpm, 4/4, key of A minor. Punchy drums, driving synth bass, bright synth stabs, claps. Exciting and confident.'),
  cinematic: style('Cinematic', 'Instrumental cinematic underscore, 90 bpm, key of D minor. Warm strings, soft piano, deep slow pulses, a slow build with a gentle lift at the end. Wide and confident, never bombastic.'),
  playful: style('Playful', 'Instrumental playful bouncy modern explainer underscore, 120 bpm, 4/4, key of C major. Pizzicato strings, marimba, plucky synth, warm round bass, soft finger snaps. Quirky but polished, never cheesy.'),
});

/** Added to every music description, a style's or a person's own. */
export const MUSIC_TAIL = ' No vocals, no choir, no distortion. Light, spacious mix that leaves room for a narrator.';

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const styleOf = (music) => {
  const kind = music?.kind;
  return typeof kind === 'string' && Object.hasOwn(MUSIC_STYLES, kind) ? MUSIC_STYLES[kind] : null;
};

/**
 * The description ElevenLabs gets for a music pick, tail included. null for
 * `none`, an unknown kind, or a `custom` pick with no text.
 */
export function musicPrompt(music) {
  const picked = styleOf(music);
  if (picked) return picked.prompt + MUSIC_TAIL;
  if (music?.kind !== 'custom' || typeof music.text !== 'string') return null;
  const text = music.text.trim();
  if (!text) return null;
  return (/[.!?]$/.test(text) ? text : `${text}.`) + MUSIC_TAIL;
}

/** The label people read for a music pick; `No music` for anything unreadable. */
export function musicLabel(music) {
  const picked = styleOf(music);
  if (picked) return picked.label;
  return music?.kind === 'custom' ? 'Own music' : 'No music';
}

/** A design's sound in one line: `Off`, or the voice's name and the music's label. */
export function soundSummary(sound) {
  const name = sound?.on === true ? sound.voice?.name : null;
  if (typeof name !== 'string' || name === '') return 'Off';
  return `${name} · ${musicLabel(sound.music)}`;
}

/** The list price of a voice clip of `chars` characters, in USD. */
export function voiceUsd(chars) {
  return round6(chars * SOUND_SERVICE.voiceUsdPer1kChars / 1000);
}

/** The list price of `seconds` of music, in USD. */
export function musicUsd(seconds) {
  return round6(seconds / 60 * SOUND_SERVICE.musicUsdPerMinute);
}

/**
 * What plays at film time `t` of a film `dur` seconds long. A clip plays from
 * its `start` up to (not including) `start + seconds`; `local` is its own time.
 * The music plays the whole film, looping, at its gain, faded in at the start
 * and out at the end. `music` is null when the tracks have none.
 */
export function soundAt(tracks, t, dur) {
  const clips = (Array.isArray(tracks?.clips) ? tracks.clips : []).map((clip) => {
    const on = clip.start <= t && t < clip.start + clip.seconds;
    return { on, local: on ? t - clip.start : 0 };
  });
  const music = tracks?.music;
  if (!music) return { clips, music: null };
  const on = 0 <= t && t < dur;
  if (!on) return { clips, music: { on, local: 0, volume: 0 } };
  const fade = Math.min(1, t / MUSIC_FADE_IN, (dur - t) / MUSIC_FADE_OUT);
  return { clips, music: { on, local: t % music.seconds, volume: music.gain * clamp01(fade) } };
}
